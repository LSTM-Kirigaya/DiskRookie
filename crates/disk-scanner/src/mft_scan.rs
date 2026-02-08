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
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use ai_disk_common::DiskAnalyzerError;
use ai_disk_domain::{FileNode, ScanResult};
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
    DiskAnalyzerError::Io(std::io::Error::new(
        std::io::ErrorKind::Other,
        msg,
    ))
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
        if drive.chars().next().map(|d| c.eq_ignore_ascii_case(&d)).unwrap_or(false) {
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
const PROGRESS_EVERY: u64 = 5000;
/// 阶段 3 并行化：每块记录数，用于 build_recursive_size_map / build_child_index 的分块
const PAR_CHUNK_SIZE: usize = 80_000;

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

/// 单条「按大小排序」结果：路径、大小、修改时间（仅文件，不含目录）。
#[derive(Debug, Clone)]
pub struct TopFileEntry {
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

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
        return Err(DiskAnalyzerError::InvalidPath(format!("path does not exist: {}", path)));
    }
    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("cannot resolve path: {}", e)))?;
    if !is_windows_volume_root(&path_buf) {
        return Err(DiskAnalyzerError::InvalidPath("not a volume root".to_string()));
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
            if s > 0 { Some(s as u64) } else { None }
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
        .map(|Reverse((size, path, modified))| TopFileEntry { path, size, modified })
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
        return Err(DiskAnalyzerError::InvalidPath(format!("path does not exist: {}", path)));
    }
    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("cannot resolve path: {}", e)))?;
    if !is_windows_volume_root(&path_buf) {
        return Err(DiskAnalyzerError::InvalidPath("not a volume root".to_string()));
    }

    let volume_root_str = path_buf.to_string_lossy().trim_end_matches('\\').to_string();
    let volume_root_str = if volume_root_str.ends_with(':') {
        format!("{}\\", volume_root_str)
    } else {
        volume_root_str
    };

    let drive = drive_letter_from_volume_root(&path_buf).ok_or_else(|| {
        DiskAnalyzerError::InvalidPath("cannot get drive letter from volume root".to_string())
    })?;

    eprintln!("[scan:mft] starting MFT full scan for volume {} (drive {})", path_buf.display(), drive);
    if let Some(ref cb) = progress {
        cb(0, "[scan:mft] opening volume...");
    }
    let volume_path = format!(r"\\.\{}:", drive);
    let volume = Volume::new(volume_path.as_str()).map_err(to_disk_analyzer_error)?;
    eprintln!("[scan:mft] volume opened: {} bytes", volume.volume_size);
    // 边读边向前端上报进度：channel + 后台线程调用 progress，主线程用带 progress 的 closure 调 new_with_progress（需 'static）
    let mft = if let Some(ref progress_arc) = progress {
        let (tx, rx) = mpsc::channel();
        let tx_arc = Arc::new(Mutex::new(tx));
        let load_progress = move |bytes: u64, total: u64| {
            let _ = tx_arc.lock().unwrap().send((bytes, total));
        };
        let progress_arc = Arc::clone(progress_arc);
        let join_handle = thread::spawn(move || {
            while let Ok((bytes, total)) = rx.recv() {
                let pct = if total > 0 { (100u64 * bytes / total).min(100) } else { 0 };
                progress_arc(0, &format!("[scan:mft] Loading MFT {}%", pct));
            }
        });
        let mft_res = Mft::new_with_progress(volume, Some(&load_progress as &ntfs_reader::mft::MftLoadProgress))
            .map_err(to_disk_analyzer_error);
        // load_progress 离开作用域时 tx 被关闭，接收线程退出；等待以便最后几条进度能发出
        drop(load_progress);
        let _ = join_handle.join();
        mft_res
    } else {
        Mft::new_with_progress(volume, None).map_err(to_disk_analyzer_error)
    }?;
    eprintln!("[scan:mft] MFT loaded into memory, max_records={}", mft.max_record);
    let t_after_mft_read = Instant::now();

    // 过滤时使用与 normalize 后路径一致的卷前缀（如 "C:"），避免 canonical 的 "\\?\C:" 过滤掉所有记录
    let vol_trim_for_filter = format!("{}:", drive);
    let mut records: Vec<MftRecord> = Vec::with_capacity(2_000_000);
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
            if s > 0 { Some(s as u64) } else { None }
        });
        let c = counter.fetch_add(1, Ordering::Relaxed);
        if c > 0 && c % PROGRESS_EVERY == 0 {
            if let Some(ref cb) = progress {
                cb(c, &full_path);
            }
        }
        records.push(MftRecord {
            full_path,
            size: info.size,
            is_dir: info.is_directory,
            modified,
        });
    });

    if let Some(ref cb) = progress {
        cb(counter.load(Ordering::Relaxed), &volume_root_str);
    }
    let n_records = counter.load(Ordering::Relaxed);
    eprintln!("[scan:mft] iterate done: {} records collected", n_records);
    let t_after_iterate = Instant::now();

    // 与标准模式一致：根节点 name/path 与 scan_path_with_progress -> build_tree 一致
    let root_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .map(String::from)
        .unwrap_or_else(|| path.to_string());
    let root_path_str = path_buf.display().to_string();

    // 与 normalize 后路径一致：根为 "C:"，index 父键为 "C:\"
    let volume_root_trim = format!("{}:", drive);
    let volume_root_key = format!(r"{}:\", drive);
    let (root, file_count, total_size) = build_tree_from_mft_records(
        &records,
        &volume_root_trim,
        &volume_root_key,
        &root_name,
        &root_path_str,
        shallow_dirs,
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
        let build_tree_ms = t_after_build_tree.duration_since(t_after_iterate).as_millis();
        let total_ms = scan_time_ms as u128;
        eprintln!("[MFT_TIMING] ---------- MFT scan phase timing (ms) ----------");
        eprintln!("[MFT_TIMING] 1. get MFT content (Volume + Mft::new): {:>8} ms  ({:>5.1}%)", get_mft_ms, 100.0 * get_mft_ms as f64 / total_ms as f64);
        eprintln!("[MFT_TIMING] 2. iterate_files + collect records:    {:>8} ms  ({:>5.1}%)", iterate_ms, 100.0 * iterate_ms as f64 / total_ms as f64);
        eprintln!("[MFT_TIMING] 3. build_tree (parallel):              {:>8} ms  ({:>5.1}%)", build_tree_ms, 100.0 * build_tree_ms as f64 / total_ms as f64);
        eprintln!("[MFT_TIMING] total:                                {:>8} ms  records={}", total_ms, records.len());
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

    Ok(ScanResult {
        root,
        scan_time_ms,
        file_count,
        total_size,
        scan_warning: None,
        volume_total_bytes,
        volume_free_bytes,
    })
}

type ChildIndex<'a> = HashMap<String, Vec<&'a MftRecord>>;

/// 为每个路径及其所有祖先路径累加大小（多线程分块后合并）。
fn build_recursive_size_map(records: &[MftRecord]) -> HashMap<String, u64> {
    if records.is_empty() {
        return HashMap::new();
    }
    records
        .par_chunks(PAR_CHUNK_SIZE)
        .map(|chunk| {
            let mut map: HashMap<String, u64> = HashMap::new();
            for r in chunk {
                let path = r.full_path.trim_end_matches('\\').to_string();
                if path.is_empty() {
                    continue;
                }
                let s = r.size;
                map.entry(path.clone())
                    .and_modify(|v| *v = v.saturating_add(s))
                    .or_insert(s);
                let mut rest = path.as_str();
                while let Some(i) = rest.rfind('\\') {
                    rest = &rest[..i];
                    if rest.is_empty() {
                        break;
                    }
                    map.entry(rest.to_string())
                        .and_modify(|v| *v = v.saturating_add(s))
                        .or_insert(s);
                }
            }
            map
        })
        .reduce(HashMap::new, |mut a, b| {
            for (k, v) in b {
                *a.entry(k).or_insert(0u64) = a.get(&k).copied().unwrap_or(0u64).saturating_add(v);
            }
            a
        })
}

/// 多线程分块建 parent -> children index，再合并。
fn build_child_index<'a>(
    records: &'a [MftRecord],
    volume_root_trim: &str,
) -> (u64, Option<u64>, ChildIndex<'a>) {
    let root = records.iter().find(|r| {
        r.full_path.trim_end_matches('\\').eq_ignore_ascii_case(volume_root_trim)
    });
    let (root_size, root_modified) = root
        .map(|r| (r.size, r.modified))
        .unwrap_or((0u64, None));

    let index = if records.is_empty() {
        HashMap::new()
    } else {
        records
            .par_chunks(PAR_CHUNK_SIZE)
            .map(|chunk| {
                let mut idx: ChildIndex<'_> = HashMap::new();
                for r in chunk {
                    let p = r.full_path.as_str();
                    let norm = p.trim_end_matches('\\');
                    if norm.eq_ignore_ascii_case(volume_root_trim) {
                        continue;
                    }
                    if let Some(i) = p.rfind('\\') {
                        idx.entry(p[..i].to_string()).or_default().push(r);
                    }
                }
                idx
            })
            .reduce(HashMap::new, |mut a, b| {
                for (k, mut v) in b {
                    a.entry(k).or_default().append(&mut v);
                }
                a
            })
    };
    (root_size, root_modified, index)
}

fn build_tree_from_mft_records(
    records: &[MftRecord],
    volume_root_trim: &str,
    volume_root_key: &str,
    root_name: &str,
    root_path_str: &str,
    shallow_dirs: bool,
) -> Result<(FileNode, u64, u64), DiskAnalyzerError> {
    let (root_size, root_modified, index) = build_child_index(records, volume_root_trim);
    let recursive_sizes = build_recursive_size_map(records);
    // 根的直接子节点在 index 里键为 "F:"（p[..i] 对 "F:\x" 得到 "F:"），不是 "F:\"；故先查 volume_root_key 再查 volume_root_trim
    let direct_children: &[&MftRecord] = index
        .get(volume_root_key)
        .or_else(|| index.get(volume_root_trim))
        .map(|v| v.as_slice())
        .or_else(|| {
            index
                .keys()
                .find(|k| k.eq_ignore_ascii_case(volume_root_key) || k.eq_ignore_ascii_case(volume_root_trim))
                .and_then(|k| index.get(k))
                .map(|v| v.as_slice())
        })
        .unwrap_or(&[]);

    let child_nodes: Vec<FileNode> = direct_children
        .par_iter()
        .map(|rec| {
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
                let (node, _cnt) = build_subtree_from_index(
                    &index,
                    &recursive_sizes,
                    path,
                    name,
                    1,
                    shallow_dirs,
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

fn build_subtree_from_index(
    index: &ChildIndex<'_>,
    recursive_sizes: &HashMap<String, u64>,
    path_prefix: &str,
    name: &str,
    depth: usize,
    shallow_dirs: bool,
) -> (FileNode, u64) {
    let children_slice = index
        .get(path_prefix)
        .map(|v| v.as_slice())
        .unwrap_or(&[]);
    let mut size = 0u64;
    let mut file_count = 0u64;
    let modified: Option<u64> = None;

    let mut children: Vec<FileNode> =
        Vec::with_capacity(children_slice.len().min(MAX_CHILDREN_PER_DIR));
    for rec in children_slice {
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
            let (child_node, cnt) = build_subtree_from_index(
                index,
                recursive_sizes,
                child_path,
                child_name,
                depth + 1,
                shallow_dirs,
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
