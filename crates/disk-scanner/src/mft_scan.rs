//! Windows NTFS volume scan via MFT (Everything-style): use ntfs-reader to open
//! volume `\\.\X:`, read $MFT into memory, and enumerate files with path cache.
//! Requires admin (elevated) privileges.
//!
//! **当前限制**：ntfs-reader 的 `Mft::new(volume)` 会一次性将整个 $MFT 读入内存，因此
//! “volume opened” 与 “MFT loaded” 之间会有较长等待；真正的边读边处理需自实现分块读 $MFT
//! 或改用支持流式读取的库。
//!
//! **阶段耗时**：设置环境变量 `MFT_TIMING=1` 后扫描会打印三阶段耗时（获取 MFT / 枚举 / 建树）
//! 及可并行化建议。参见 tests/scan_timing.rs 中的运行示例。
//!
//! **仅要前 N 大文件**：使用 `scan_volume_mft_top_files(path, n, progress)`，只做枚举 + 最小堆，
//! 不建树，默认 N=100 时显著省时省内存。

use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use ai_disk_common::DiskAnalyzerError;
use ai_disk_domain::{FileNode, ScanResult, TopFileEntry};
use ntfs_reader::errors::NtfsReaderError;
use ntfs_reader::file_info::{FileInfo, HashMapCache};
use ntfs_reader::mft::Mft;
use ntfs_reader::volume::Volume;
use rayon::prelude::*;

use crate::scanner::{normalize_path, ProgressCb, ProgressCbArc, SHALLOW_DIR_NAMES};

/// 通过 Windows API GetDiskFreeSpaceExW 获取卷总容量与剩余空间（字节）。
/// 仅 Windows 有效；path 为卷上任意路径（如 "C:\" 或 "C:\Users"）。
pub fn get_volume_space_bytes(path: &str) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = std::path::Path::new(path)
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let mut total = 0u64;
    let mut free = 0u64;
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            &mut total,
            &mut free,
        )
    };
    if ok != 0 {
        Some((total, free))
    } else {
        None
    }
}

/// Resolve drive letter from volume root path (e.g. `F:\` or `\\?\F:\` -> `"F"`).
fn drive_letter_from_volume_root(volume_root: &Path) -> Option<String> {
    let s = volume_root.to_string_lossy();
    let s = s.trim_end_matches('\\');
    let drive = if s.len() == 2 && s.as_bytes()[1] == b':' {
        &s[..1]
    } else if s.len() >= 4 && s.starts_with("\\\\?\\") {
        let rest = &s[4..];
        if rest.len() == 2 && rest.as_bytes()[1] == b':' {
            &rest[..1]
        } else {
            return None;
        }
    } else {
        return None;
    };
    if !drive.as_bytes()[0].is_ascii_alphabetic() {
        return None;
    }
    Some(drive.to_uppercase())
}

fn to_disk_analyzer_error(e: NtfsReaderError) -> DiskAnalyzerError {
    let msg = match &e {
        NtfsReaderError::ElevationError => {
            "NTFS volume access requires elevated (admin) privileges".to_string()
        }
        NtfsReaderError::IOError(io) => format!("MFT read I/O error: {}", io),
        _ => format!("MFT error: {}", e),
    };
    DiskAnalyzerError::Io(std::io::Error::new(std::io::ErrorKind::Other, msg))
}

/// Normalize path from ntfs-reader (e.g. `\\.\F:\dir\file` 或 `C:\dir\file`) to `F:\dir\file`，
/// 保证盘符后必有反斜杠以便正确做父路径切分（如 `C:\Windows` 的 parent 为 `C:\`）。
fn normalize_ntfs_path(path_str: &str, drive: &str) -> String {
    let path_str = path_str.trim_end_matches('\\').replace('/', "\\");
    let prefix = format!(r"\\.\{}:", drive);
    let rest = if path_str.as_str().starts_with(&prefix) {
        path_str[prefix.len()..].trim_start_matches('\\')
    } else if path_str.starts_with("\\\\?\\") && path_str.len() >= 6 {
        let rest = &path_str[4..];
        if rest.starts_with(&format!("{}:", drive)) {
            rest[2..].trim_start_matches('\\')
        } else {
            return path_str;
        }
    } else if path_str.len() >= 2 && path_str.as_bytes()[1] == b':' {
        let c = path_str.chars().next().unwrap();
        if drive
            .chars()
            .next()
            .map(|d| c.eq_ignore_ascii_case(&d))
            .unwrap_or(false)
        {
            let after = path_str[2..].trim_start_matches('\\');
            return if after.is_empty() {
                format!(r"{}:\", drive)
            } else {
                format!(r"{}:\{}", drive, after)
            };
        }
        return path_str;
    } else {
        return path_str;
    };
    if rest.is_empty() {
        format!(r"{}:\", drive)
    } else {
        format!(r"{}:\{}", drive, rest)
    }
}

const MAX_DEPTH: usize = 10;
const MAX_CHILDREN_PER_DIR: usize = 500;
/// 返回给前端的树与 Treemap 一致：只保留 6 层、每层最多 250 子节点，减小 payload 与解析时间
const MAX_DEPTH_RETURN: usize = 6;
const MAX_CHILDREN_PER_DIR_RETURN: usize = 250;
/// 进度回调间隔（增大以略减 IPC 次数）
const PROGRESS_EVERY: u64 = 10_000;
/// build_tree 阶段每构建多少节点上报一次进度
const BUILD_TREE_PROGRESS_EVERY: u64 = 10_000;
/// 供前端摘要与 AI 分析的前 N 大文件数量
const TOP_FILES_FOR_RESULT: usize = 500;

/// Check if path is under volume (ASCII case-insensitive prefix match).
#[inline]
fn path_under_volume_ascii(path: &str, vol_trim: &str) -> bool {
    if path.eq_ignore_ascii_case(vol_trim) {
        return true;
    }
    let trim_len = vol_trim.len();
    if path.len() <= trim_len {
        return false;
    }
    if !path.is_char_boundary(trim_len) {
        return false;
    }
    let rest = &path[trim_len..];
    if !rest.starts_with('\\') {
        return false;
    }
    path.as_bytes()[..trim_len]
        .iter()
        .zip(vol_trim.as_bytes().iter())
        .all(|(a, b)| a.eq_ignore_ascii_case(b))
}

/// Whether path is a Windows volume root (e.g. `C:\`, `D:\`).
pub fn is_windows_volume_root(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let s = s.trim_end_matches('\\');
    if s.len() == 2 {
        let b = s.as_bytes();
        return b[0].is_ascii_alphabetic() && b[1] == b':';
    }
    if s.len() >= 4 && s.starts_with("\\\\?\\") {
        let rest = &s[4..];
        return rest.len() == 2
            && rest.as_bytes()[0].is_ascii_alphabetic()
            && rest.as_bytes()[1] == b':';
    }
    false
}

/// 「前 N 大文件」功能的默认 N（如 100）。
pub const TOP_FILES_DEFAULT_N: usize = 100;

/// 仅获取卷上按文件大小最大的前 N 个**文件**（不含目录）。
/// 优化：枚举时用最小堆维护前 N，**不构建整棵树**，省去阶段 3，内存仅 O(N)。
/// 若只需“最大的 100 个文件”场景，比完整 `scan_volume_mft` 快且省内存。
pub fn scan_volume_mft_top_files(
    path: &str,
    n: usize,
    progress: Option<&ProgressCb>,
) -> Result<Vec<TopFileEntry>, DiskAnalyzerError> {
    let path_buf = normalize_path(path);
    if !path_buf.exists() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "path does not exist: {}",
            path
        )));
    }
    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("cannot resolve path: {}", e)))?;
    if !is_windows_volume_root(&path_buf) {
        return Err(DiskAnalyzerError::InvalidPath(
            "not a volume root".to_string(),
        ));
    }

    let drive = drive_letter_from_volume_root(&path_buf).ok_or_else(|| {
        DiskAnalyzerError::InvalidPath("cannot get drive letter from volume root".to_string())
    })?;

    let volume_path = format!(r"\\.\{}:", drive);
    let volume = Volume::new(volume_path.as_str()).map_err(to_disk_analyzer_error)?;
    let mft = Mft::new(volume).map_err(to_disk_analyzer_error)?;

    let vol_trim_for_filter = format!("{}:", drive);
    let cap = n.saturating_add(1).min(1_000_000);
    let mut heap: BinaryHeap<Reverse<(u64, String, Option<u64>)>> = BinaryHeap::with_capacity(cap);
    let mut cache = HashMapCache::default();
    let counter = AtomicU64::new(0);

    mft.iterate_files(|file| {
        let info = FileInfo::with_cache(&mft, file, &mut cache);
        if info.is_directory {
            return;
        }
        let path_str = info.path.to_string_lossy();
        let full_path = normalize_ntfs_path(&path_str, &drive);
        if !path_under_volume_ascii(&full_path, &vol_trim_for_filter) {
            return;
        }
        let modified = info.modified.and_then(|t| {
            let s = t.unix_timestamp();
            if s > 0 {
                Some(s as u64)
            } else {
                None
            }
        });
        let c = counter.fetch_add(1, Ordering::Relaxed);
        if c > 0 && c % PROGRESS_EVERY == 0 {
            if let Some(ref cb) = progress {
                cb(c, &full_path);
            }
        }
        let size = info.size;
        heap.push(Reverse((size, full_path, modified)));
        while heap.len() > n {
            heap.pop();
        }
    });

    if let Some(ref cb) = progress {
        cb(counter.load(Ordering::Relaxed), path);
    }

    let mut list: Vec<_> = heap
        .into_iter()
        .map(|Reverse((size, path, modified))| TopFileEntry {
            path,
            size,
            modified,
        })
        .collect();
    list.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(list)
}

/// Single MFT-derived record for tree building.
struct MftRecord {
    full_path: String,
    size: u64,
    is_dir: bool,
    modified: Option<u64>,
}

/// 从直接大小与子索引一次性汇总递归大小（避免枚举时每文件 O(深度) 的祖先更新）
fn compute_recursive_sizes(
    records: &[MftRecord],
    child_index: &HashMap<String, Vec<usize>>,
    direct_sizes: &HashMap<String, u64>,
    volume_root_trim: &str,
    volume_root_key: &str,
) -> HashMap<String, u64> {
    let mut paths: Vec<String> = records
        .iter()
        .map(|r| r.full_path.trim_end_matches('\\').to_string())
        .collect();
    if !paths
        .iter()
        .any(|p| p.eq_ignore_ascii_case(volume_root_trim))
    {
        paths.push(volume_root_trim.to_string());
    }
    paths.sort();
    paths.dedup();
    paths.sort_by_cached_key(|p| std::cmp::Reverse(p.matches('\\').count()));
    let mut recursive_sizes: HashMap<String, u64> = HashMap::new();
    for path in paths {
        let direct = direct_sizes.get(&path).copied().unwrap_or(0);
        let child_sum: u64 = {
            let key = if path.eq_ignore_ascii_case(volume_root_trim) {
                volume_root_key
            } else {
                &path
            };
            child_index
                .get(key)
                .map(|indices| {
                    indices
                        .iter()
                        .map(|&i| {
                            let c = records[i].full_path.trim_end_matches('\\').to_string();
                            recursive_sizes.get(&c).copied().unwrap_or(0)
                        })
                        .sum()
                })
                .unwrap_or(0)
        };
        recursive_sizes.insert(path, direct.saturating_add(child_sum));
    }
    recursive_sizes
}

/// Scan volume root via MFT using ntfs-reader (Everything-style). Opens `\\.\X:`,
/// reads $MFT into memory, iterates files with path cache, then builds tree.
pub fn scan_volume_mft(
    path: &str,
    progress: Option<ProgressCbArc>,
    shallow_dirs: bool,
) -> Result<ScanResult, DiskAnalyzerError> {
    let start = Instant::now();
    let path_buf = normalize_path(path);
    if !path_buf.exists() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "path does not exist: {}",
            path
        )));
    }
    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("cannot resolve path: {}", e)))?;
    if !is_windows_volume_root(&path_buf) {
        return Err(DiskAnalyzerError::InvalidPath(
            "not a volume root".to_string(),
        ));
    }

    let volume_root_str = path_buf
        .to_string_lossy()
        .trim_end_matches('\\')
        .to_string();
    let volume_root_str = if volume_root_str.ends_with(':') {
        format!("{}\\", volume_root_str)
    } else {
        volume_root_str
    };

    let drive = drive_letter_from_volume_root(&path_buf).ok_or_else(|| {
        DiskAnalyzerError::InvalidPath("cannot get drive letter from volume root".to_string())
    })?;

    eprintln!(
        "[scan:mft] starting MFT full scan for volume {} (drive {})",
        path_buf.display(),
        drive
    );
    if let Some(ref cb) = progress {
        cb(0, "[scan:mft] opening volume...");
    }
    let volume_path = format!(r"\\.\{}:", drive);
    let volume_root_trim = format!("{}:", drive);
    let volume_root_key = format!(r"{}:\", drive);
    // 使用上游 ntfs-reader API：Mft::new 一次性加载 $MFT，再 iterate_files 枚举。
    let volume = Volume::new(volume_path.as_str()).map_err(to_disk_analyzer_error)?;
    eprintln!("[scan:mft] volume opened: {} bytes", volume.volume_size);
    let mft = Mft::new(volume).map_err(to_disk_analyzer_error)?;
    eprintln!(
        "[scan:mft] MFT loaded into memory, max_records={}",
        mft.max_record
    );
    let vol_trim_for_filter = format!("{}:", drive);
    let mut records: Vec<MftRecord> = Vec::with_capacity(2_000_000);
    let mut child_index: HashMap<String, Vec<usize>> = HashMap::new();
    let mut direct_sizes: HashMap<String, u64> = HashMap::new();
    let mut cache = HashMapCache::default();
    let counter = AtomicU64::new(0);
    mft.iterate_files(|file| {
        let info = FileInfo::with_cache(&mft, file, &mut cache);
        let path_str = info.path.to_string_lossy();
        let full_path = normalize_ntfs_path(&path_str, &drive);
        if !path_under_volume_ascii(&full_path, &vol_trim_for_filter) {
            return;
        }
        let modified = info.modified.and_then(|t| {
            let s = t.unix_timestamp();
            if s > 0 {
                Some(s as u64)
            } else {
                None
            }
        });
        let c = counter.fetch_add(1, Ordering::Relaxed);
        if c > 0 && c % PROGRESS_EVERY == 0 {
            if let Some(ref cb) = progress {
                cb(c, &full_path);
            }
        }
        records.push(MftRecord {
            full_path: full_path.clone(),
            size: info.size,
            is_dir: info.is_directory,
            modified,
        });
        let idx = records.len() - 1;
        let path_trim = full_path.trim_end_matches('\\');
        if !path_trim.eq_ignore_ascii_case(&volume_root_trim) {
            if let Some(i) = full_path.rfind('\\') {
                let parent = full_path[..i].to_string();
                child_index.entry(parent).or_default().push(idx);
            }
        }
        let s = info.size;
        direct_sizes
            .entry(path_trim.to_string())
            .and_modify(|v| *v = v.saturating_add(s))
            .or_insert(s);
    });
    let n_records = counter.load(Ordering::Relaxed);
    if let Some(ref cb) = progress {
        cb(n_records, &volume_root_str);
    }
    let _volume = mft.volume.clone();
    let recursive_sizes = compute_recursive_sizes(
        &records,
        &child_index,
        &direct_sizes,
        &volume_root_trim,
        &volume_root_key,
    );
    let t_after_mft_read = Instant::now();
    let t_after_iterate = t_after_mft_read;

    // 与标准模式一致：根节点 name/path 与 scan_path_with_progress -> build_tree 一致
    let root_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .map(String::from)
        .unwrap_or_else(|| path.to_string());
    let root_path_str = path_buf.display().to_string();

    let (root, file_count, total_size) = build_tree_from_mft_records(
        &records,
        &child_index,
        &recursive_sizes,
        &volume_root_trim,
        &volume_root_key,
        &root_name,
        &root_path_str,
        shallow_dirs,
        progress.as_ref(),
        n_records,
    )?;
    let t_after_build_tree = Instant::now();
    let scan_time_ms = start.elapsed().as_millis() as u64;
    eprintln!(
        "[scan:mft] build_tree done: file_count={}, total_size={}, elapsed_ms={}",
        file_count, total_size, scan_time_ms
    );

    if std::env::var("MFT_TIMING").is_ok() {
        let get_mft_ms = t_after_mft_read.duration_since(start).as_millis();
        let iterate_ms = t_after_iterate.duration_since(t_after_mft_read).as_millis();
        let build_tree_ms = t_after_build_tree
            .duration_since(t_after_iterate)
            .as_millis();
        let total_ms = scan_time_ms as u128;
        eprintln!("[MFT_TIMING] ---------- MFT scan phase timing (ms) ----------");
        eprintln!(
            "[MFT_TIMING] 1. get MFT content (Volume + Mft::new): {:>8} ms  ({:>5.1}%)",
            get_mft_ms,
            100.0 * get_mft_ms as f64 / total_ms as f64
        );
        eprintln!(
            "[MFT_TIMING] 2. iterate_files + collect records:    {:>8} ms  ({:>5.1}%)",
            iterate_ms,
            100.0 * iterate_ms as f64 / total_ms as f64
        );
        eprintln!(
            "[MFT_TIMING] 3. build_tree (parallel):              {:>8} ms  ({:>5.1}%)",
            build_tree_ms,
            100.0 * build_tree_ms as f64 / total_ms as f64
        );
        eprintln!(
            "[MFT_TIMING] total:                                {:>8} ms  records={}",
            total_ms,
            records.len()
        );
        eprintln!("[MFT_TIMING] ---------- parallelization notes ----------");
        eprintln!("[MFT_TIMING] - phase 1: disk I/O, not parallelizable.");
        eprintln!("[MFT_TIMING] - phase 2: ntfs-reader is single-threaded.");
        eprintln!("[MFT_TIMING] - phase 3: already parallel (chunked map/index + par_iter).");
    }

    let (volume_total_bytes, volume_free_bytes) =
        match get_volume_space_bytes(&format!(r"{}:\", drive)) {
            Some((t, f)) => (Some(t), Some(f)),
            None => (None, None),
        };

    let root_pruned = prune_tree_for_display(root, 0);
    let top_files = Some(build_top_files_from_records(&records, TOP_FILES_FOR_RESULT));

    Ok(ScanResult {
        root: root_pruned,
        scan_time_ms,
        file_count,
        total_size,
        scan_warning: None,
        volume_total_bytes,
        volume_free_bytes,
        top_files,
    })
}

/// 从 records + index( indices ) 取根节点信息，再构建子树；建树过程中用 display_count 上报进度，避免前端数字回跳。
fn build_tree_from_mft_records(
    records: &[MftRecord],
    child_index: &HashMap<String, Vec<usize>>,
    recursive_sizes: &HashMap<String, u64>,
    volume_root_trim: &str,
    volume_root_key: &str,
    root_name: &str,
    root_path_str: &str,
    shallow_dirs: bool,
    progress: Option<&ProgressCbArc>,
    display_count: u64,
) -> Result<(FileNode, u64, u64), DiskAnalyzerError> {
    let root_record = records.iter().find(|r| {
        r.full_path
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(volume_root_trim)
    });
    let (root_size, root_modified) = root_record
        .map(|r| (r.size, r.modified))
        .unwrap_or((0u64, None));

    let direct_indices: Vec<usize> = child_index
        .get(volume_root_key)
        .or_else(|| child_index.get(volume_root_trim))
        .or_else(|| {
            child_index
                .keys()
                .find(|k| {
                    k.eq_ignore_ascii_case(volume_root_key)
                        || k.eq_ignore_ascii_case(volume_root_trim)
                })
                .and_then(|k| child_index.get(k))
        })
        .cloned()
        .unwrap_or_default();

    let nodes_built = AtomicU64::new(0);
    let last_reported = AtomicU64::new(0);

    let child_nodes: Vec<FileNode> = direct_indices
        .par_iter()
        .map(|&idx| {
            let rec = &records[idx];
            let name = rec
                .full_path
                .rsplit('\\')
                .next()
                .unwrap_or(rec.full_path.as_str());
            let is_shallow = shallow_dirs
                && rec.is_dir
                && SHALLOW_DIR_NAMES
                    .iter()
                    .any(|&s| s.eq_ignore_ascii_case(name));
            let path = rec.full_path.as_str();
            if is_shallow {
                let size = recursive_sizes
                    .get(path.trim_end_matches('\\'))
                    .copied()
                    .unwrap_or(rec.size);
                FileNode {
                    path: path.to_string(),
                    name: name.to_string(),
                    size,
                    is_dir: true,
                    modified: rec.modified,
                    children: vec![],
                }
            } else {
                let (node, _cnt) = build_subtree_from_indices(
                    records,
                    child_index,
                    recursive_sizes,
                    path,
                    name,
                    1,
                    shallow_dirs,
                    &nodes_built,
                    &last_reported,
                    progress,
                    display_count,
                );
                node
            }
        })
        .collect();

    let mut total_size = root_size;
    let mut file_count = 1u64;
    for c in &child_nodes {
        total_size += c.size;
        file_count += count_nodes(c);
    }

    let root = FileNode {
        path: root_path_str.to_string(),
        name: root_name.to_string(),
        size: total_size,
        is_dir: true,
        modified: root_modified,
        children: child_nodes,
    };
    Ok((root, file_count, total_size))
}

fn count_nodes(n: &FileNode) -> u64 {
    if n.children.is_empty() {
        return 1;
    }
    1 + n.children.iter().map(count_nodes).sum::<u64>()
}

/// 剪枝树以匹配前端 Treemap（深度 6、每层最多 250 子节点，按 size 取 top），减小 payload 与解析时间
fn prune_tree_for_display(root: FileNode, depth: usize) -> FileNode {
    if depth >= MAX_DEPTH_RETURN {
        return FileNode {
            path: root.path,
            name: root.name,
            size: root.size,
            is_dir: root.is_dir,
            modified: root.modified,
            children: vec![],
        };
    }
    let mut children = root.children;
    if children.len() > MAX_CHILDREN_PER_DIR_RETURN {
        children.sort_by(|a, b| b.size.cmp(&a.size));
        children.truncate(MAX_CHILDREN_PER_DIR_RETURN);
    }
    let children: Vec<FileNode> = children
        .into_iter()
        .map(|c| prune_tree_for_display(c, depth + 1))
        .collect();
    FileNode {
        path: root.path,
        name: root.name,
        size: root.size,
        is_dir: root.is_dir,
        modified: root.modified,
        children,
    }
}

/// 从 records 中取前 N 大文件（仅文件，不含目录），供前端摘要与 AI 分析
fn build_top_files_from_records(records: &[MftRecord], n: usize) -> Vec<TopFileEntry> {
    let mut files: Vec<(&MftRecord, u64)> = records
        .iter()
        .filter(|r| !r.is_dir)
        .map(|r| (r, r.size))
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files
        .into_iter()
        .take(n)
        .map(|(r, _)| TopFileEntry {
            path: r.full_path.clone(),
            size: r.size,
            modified: r.modified,
        })
        .collect()
}

/// 使用 indices 版 index 建子树，并周期性上报进度（用 display_count 保持前端数字不变），避免前端长时间无响应。
fn build_subtree_from_indices(
    records: &[MftRecord],
    index: &HashMap<String, Vec<usize>>,
    recursive_sizes: &HashMap<String, u64>,
    path_prefix: &str,
    name: &str,
    depth: usize,
    shallow_dirs: bool,
    nodes_built: &AtomicU64,
    last_reported: &AtomicU64,
    progress: Option<&ProgressCbArc>,
    display_count: u64,
) -> (FileNode, u64) {
    let children_indices = index.get(path_prefix).map(|v| v.as_slice()).unwrap_or(&[]);
    let mut size = 0u64;
    let mut file_count = 0u64;
    let modified: Option<u64> = None;

    let mut children: Vec<FileNode> =
        Vec::with_capacity(children_indices.len().min(MAX_CHILDREN_PER_DIR));
    for &idx in children_indices {
        let rec = &records[idx];
        if rec.full_path.eq_ignore_ascii_case(path_prefix) {
            continue;
        }
        let child_name = rec
            .full_path
            .rsplit('\\')
            .next()
            .unwrap_or(rec.full_path.as_str());
        let child_path = rec.full_path.as_str();
        let is_shallow = shallow_dirs
            && rec.is_dir
            && SHALLOW_DIR_NAMES
                .iter()
                .any(|&s| s.eq_ignore_ascii_case(child_name));
        if is_shallow {
            let child_size = recursive_sizes
                .get(child_path.trim_end_matches('\\'))
                .copied()
                .unwrap_or(rec.size);
            size += child_size;
            file_count += 1;
            children.push(FileNode {
                path: child_path.to_string(),
                name: child_name.to_string(),
                size: child_size,
                is_dir: true,
                modified: rec.modified,
                children: vec![],
            });
        } else if depth < MAX_DEPTH {
            let (child_node, cnt) = build_subtree_from_indices(
                records,
                index,
                recursive_sizes,
                child_path,
                child_name,
                depth + 1,
                shallow_dirs,
                nodes_built,
                last_reported,
                progress,
                display_count,
            );
            size += child_node.size;
            file_count += cnt;
            children.push(child_node);
        } else {
            size += rec.size;
            file_count += 1;
            children.push(FileNode {
                path: child_path.to_string(),
                name: child_name.to_string(),
                size: rec.size,
                is_dir: rec.is_dir,
                modified: rec.modified,
                children: vec![],
            });
        }
        if children.len() >= MAX_CHILDREN_PER_DIR {
            break;
        }
    }

    let cur = nodes_built.fetch_add(1, Ordering::Relaxed) + 1;
    if let Some(ref cb) = progress {
        let last = last_reported.load(Ordering::Relaxed);
        if cur.saturating_sub(last) >= BUILD_TREE_PROGRESS_EVERY
            && last_reported
                .compare_exchange(last, cur, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            cb(display_count, "[scan:mft] building tree...");
        }
    }

    let node = FileNode {
        path: path_prefix.to_string(),
        name: name.to_string(),
        size,
        is_dir: true,
        modified,
        children,
    };
    (node, file_count + 1)
}
