use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, UNIX_EPOCH};

use ai_disk_common::DiskAnalyzerError;
use ai_disk_domain::{FileNode, ScanResult};
use rayon::prelude::*;

const MAX_DEPTH: usize = 10;
const MAX_CHILDREN_PER_DIR: usize = 500;

/// Windows: 文件或目录损坏且无法读取，遇到时跳过该路径继续扫描
#[cfg(windows)]
fn is_corruption_io_error(e: &std::io::Error) -> bool {
    match e.raw_os_error() {
        Some(1392) => true, // ERROR_FILE_CORRUPT
        Some(1393) => true, // ERROR_DISK_CORRUPT
        _ => false,
    }
}

#[cfg(not(windows))]
fn is_corruption_io_error(_e: &std::io::Error) -> bool {
    false
}

/// 遇到这些目录名时只统计总大小，不递归子项（常见包管理器/缓存目录）
pub(crate) const SHALLOW_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".github",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "vendor",
    ".npm",
    ".yarn",
    ".pnpm",
    "bower_components",
    "jspm_packages",
];

pub(crate) type ProgressCb = Box<dyn Fn(u64, &str) + Send + Sync>;

/// 可共享的进度回调，用于 MFT 加载时在后台线程中上报进度。
pub(crate) type ProgressCbArc = std::sync::Arc<ProgressCb>;

/// 仅统计目录总大小，不构建子树（用于 shallow 目录）
fn dir_size_only(
    path: &Path,
    counter: &AtomicU64,
    progress: Option<&ProgressCb>,
) -> Result<u64, DiskAnalyzerError> {
    let mut total: u64 = 0;
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Ok(0);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // 路径不存在（符号链接失效、文件被删除等），跳过
            return Ok(0);
        }
        Err(e) if is_corruption_io_error(&e) => {
            return Ok(0); // 损坏，跳过该目录
        }
        Err(e) => return Err(DiskAnalyzerError::Io(e)),
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if let Ok(size) = dir_size_only(&path, counter, progress) {
                total = total.saturating_add(size);
            }
        } else {
            total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }
    counter.fetch_add(1, Ordering::Relaxed);
    if let Some(ref cb) = progress {
        cb(
            counter.load(Ordering::Relaxed),
            path.display().to_string().as_str(),
        );
    }
    Ok(total)
}

fn build_tree(
    path: &Path,
    name: &str,
    depth: usize,
    counter: &AtomicU64,
    progress: Option<&ProgressCb>,
    shallow_dirs: bool,
) -> Result<(FileNode, u64), DiskAnalyzerError> {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(DiskAnalyzerError::PermissionDenied(
                path.display().to_string(),
            ));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(DiskAnalyzerError::PermissionDenied(format!(
                "{} [路径不存在]",
                path.display()
            )));
        }
        Err(e) if is_corruption_io_error(&e) => {
            return Ok((
                FileNode {
                    path: path.display().to_string(),
                    name: format!("{} [损坏]", name),
                    size: 0,
                    is_dir: false,
                    modified: None,
                    children: vec![],
                },
                0u64,
            ));
        }
        Err(e) => return Err(DiskAnalyzerError::Io(e)),
    };

    let is_dir = metadata.is_dir();
    let mut size = if is_dir { 0u64 } else { metadata.len() };
    let mut file_count = if is_dir { 0u64 } else { 1u64 };
    let mut children = Vec::new();

    if is_dir && depth < MAX_DEPTH {
        let entries = match std::fs::read_dir(path) {
            Ok(iter) => iter,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(DiskAnalyzerError::PermissionDenied(
                    path.display().to_string(),
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(DiskAnalyzerError::PermissionDenied(format!(
                    "{} [路径不存在]",
                    path.display()
                )));
            }
            Err(e) if is_corruption_io_error(&e) => {
                return Ok((
                    FileNode {
                        path: path.display().to_string(),
                        name: name.to_string(),
                        size: 0,
                        is_dir: true,
                        modified: metadata
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs()),
                        children: vec![],
                    },
                    0u64,
                ));
            }
            Err(e) => return Err(DiskAnalyzerError::Io(e)),
        };
        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();

        entries.sort_by(|a, b| {
            let a_is_dir = a.path().is_dir();
            let b_is_dir = b.path().is_dir();
            match (a_is_dir, b_is_dir) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a
                    .file_name()
                    .cmp(&b.file_name())
                    .then_with(|| a.path().as_os_str().cmp(b.path().as_os_str())),
            }
        });

        let entries: Vec<_> = entries.into_iter().take(MAX_CHILDREN_PER_DIR).collect();

        // 并行处理子项；shallow_dirs 开启时，常见包管理器/缓存目录只计大小不递归
        let results: Vec<_> = entries
            .par_iter()
            .map(|entry| {
                let child_path = entry.path();
                let child_name = entry.file_name().to_string_lossy().to_string();
                let is_shallow_dir = child_path.is_dir()
                    && shallow_dirs
                    && SHALLOW_DIR_NAMES
                        .iter()
                        .any(|&s| s.eq_ignore_ascii_case(&child_name));
                let entry_modified = entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());
                if is_shallow_dir {
                    match dir_size_only(&child_path, counter, progress) {
                        Ok(size) => Ok((
                            FileNode {
                                path: child_path.display().to_string(),
                                name: child_name.clone(),
                                size,
                                is_dir: true,
                                modified: entry_modified,
                                children: vec![],
                            },
                            1u64,
                        )),
                        Err(DiskAnalyzerError::PermissionDenied(_)) => Ok((
                            FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [无权限]", child_name),
                                size: 0,
                                is_dir: true,
                                modified: None,
                                children: vec![],
                            },
                            0u64,
                        )),
                        Err(DiskAnalyzerError::Io(ref e)) if is_corruption_io_error(e) => Ok((
                            FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [损坏]", child_name),
                                size: 0,
                                is_dir: true,
                                modified: None,
                                children: vec![],
                            },
                            0u64,
                        )),
                        Err(e) => Err(e),
                    }
                } else {
                    match build_tree(
                        &child_path,
                        &child_name,
                        depth + 1,
                        counter,
                        progress,
                        shallow_dirs,
                    ) {
                        Ok((node, cnt)) => Ok((node, cnt)),
                        Err(DiskAnalyzerError::PermissionDenied(_)) => Ok((
                            FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [无权限]", child_name),
                                size: 0,
                                is_dir: child_path.is_dir(),
                                modified: None,
                                children: vec![],
                            },
                            0u64,
                        )),
                        Err(DiskAnalyzerError::Io(ref e)) if is_corruption_io_error(e) => Ok((
                            FileNode {
                                path: child_path.display().to_string(),
                                name: format!("{} [损坏]", child_name),
                                size: 0,
                                is_dir: child_path.is_dir(),
                                modified: None,
                                children: vec![],
                            },
                            0u64,
                        )),
                        Err(e) => Err(e),
                    }
                }
            })
            .collect();

        for r in results {
            let (node, cnt) = r?;
            size += node.size;
            file_count += cnt;
            children.push(node);
        }

        counter.fetch_add(file_count, Ordering::Relaxed);
        if let Some(ref cb) = progress {
            let total_so_far = counter.load(Ordering::Relaxed);
            cb(total_so_far, path.display().to_string().as_str());
        }
    }

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    Ok((
        FileNode {
            path: path.display().to_string(),
            name: name.to_string(),
            size,
            is_dir,
            modified,
            children,
        },
        file_count,
    ))
}

/// 规范化路径（支持正斜杠、去除首尾空白）
pub(crate) fn normalize_path(path: &str) -> std::path::PathBuf {
    let s = path.trim();
    #[cfg(windows)]
    let s = s.replace('/', "\\");
    std::path::PathBuf::from(s)
}

/// 通过操作系统 API 获取该路径所在卷的总容量与剩余空间（仅 Windows 有效）。
fn get_volume_space_for_result_path(path: &std::path::Path) -> (Option<u64>, Option<u64>) {
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        match crate::mft_scan::get_volume_space_bytes(&s) {
            Some((t, f)) => (Some(t), Some(f)),
            None => (None, None),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        (None, None)
    }
}

/// 判断本次扫描是否会使用 MFT（在真正开始扫描前可调用，用于提前打日志）。
/// 条件：use_mft 为 true、路径存在、为 Windows 卷根（如 C:\）。
pub fn scan_will_use_mft(path: &str, use_mft: bool) -> bool {
    if !use_mft {
        return false;
    }
    let path_buf = normalize_path(path);
    if !path_buf.exists() {
        return false;
    }
    let canonical = match std::fs::canonicalize(&path_buf) {
        Ok(p) => p,
        Err(_) => return false,
    };
    #[cfg(windows)]
    return crate::mft_scan::is_windows_volume_root(&canonical);
    #[cfg(not(windows))]
    {
        let _ = canonical;
        false
    }
}

/// 执行磁盘扫描（支持进度回调；shallow_dirs 为 true 时对 node_modules/.git 等只计大小不递归）。
/// 当 use_mft 为 true 且路径为 Windows 磁盘卷根（如 C:\）时，优先使用 MFT 加速扫描。
/// 返回 `(ScanResult, used_mft)`，其中 `used_mft` 表示本次是否成功使用了 MFT。
pub fn scan_path_with_progress(
    path: &str,
    progress: Option<&ProgressCbArc>,
    shallow_dirs: bool,
    use_mft: bool,
) -> Result<(ScanResult, bool), DiskAnalyzerError> {
    let start = Instant::now();
    let path_buf = normalize_path(path);

    if !path_buf.exists() {
        return Err(DiskAnalyzerError::InvalidPath(format!(
            "路径不存在: {}",
            path
        )));
    }

    let path_buf = std::fs::canonicalize(&path_buf)
        .map_err(|e| DiskAnalyzerError::InvalidPath(format!("无法解析路径: {}", e)))?;

    #[allow(unused_mut, unused_assignments)]
    let mut mft_fallback_reason: Option<String> = None;
    let _ = use_mft; // used only on windows
    #[cfg(windows)]
    if use_mft && crate::mft_scan::is_windows_volume_root(&path_buf) {
        eprintln!(
            "[scan] path is volume root, attempting MFT full scan: {}",
            path_buf.display()
        );
        match crate::mft_scan::scan_volume_mft(path, progress.cloned(), shallow_dirs) {
            Ok(result) => return Ok((result, true)),
            Err(e) => {
                let msg: String = e.to_string();
                eprintln!(
                    "[scan] MFT scan unavailable, falling back to normal walk. reason: {} (on Windows, reading $MFT often needs admin)",
                    msg
                );
                mft_fallback_reason = Some(msg);
            }
        }
    }

    eprintln!("[scan] using normal directory walk: {}", path_buf.display());
    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string();

    let counter = AtomicU64::new(0);
    let (root, file_count) = build_tree(
        &path_buf,
        &name,
        0,
        &counter,
        progress.map(std::sync::Arc::as_ref),
        shallow_dirs,
    )?;
    let scan_time_ms = start.elapsed().as_millis() as u64;
    let total_size = root.size;

    let (volume_total_bytes, volume_free_bytes) = get_volume_space_for_result_path(&path_buf);

    Ok((
        ScanResult {
            root,
            scan_time_ms,
            file_count,
            total_size,
            scan_warning: mft_fallback_reason,
            volume_total_bytes,
            volume_free_bytes,
            top_files: None,
        },
        false,
    ))
}

/// 执行磁盘扫描（无进度；默认开启 shallow_dirs；默认开启 MFT 加速卷根）
pub fn scan_path(path: &str) -> Result<ScanResult, DiskAnalyzerError> {
    scan_path_with_progress(path, None::<&ProgressCbArc>, true, true).map(|(r, _)| r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    fn create_test_dir() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().to_string_lossy().to_string();
        let sub = dir.path().join("subdir");
        fs::create_dir_all(&sub).unwrap();
        File::create(sub.join("a.txt"))
            .unwrap()
            .write_all(b"hello")
            .unwrap();
        File::create(dir.path().join("b.txt"))
            .unwrap()
            .write_all(b"world")
            .unwrap();
        (dir, path)
    }

    #[test]
    fn test_normalize_path() {
        let pb = normalize_path("  /a/b/c  ");
        #[cfg(windows)]
        assert!(pb.to_string_lossy().contains('\\') || pb.to_string_lossy().contains('/'));
        #[cfg(not(windows))]
        assert!(pb.to_string_lossy().contains('/'));
    }

    #[test]
    fn test_scan_invalid_path() {
        let err = scan_path("/nonexistent/path/12345").unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }

    #[test]
    fn test_scan_nonexistent_path() {
        #[cfg(windows)]
        let bad_path = "C:\\nonexistent_xyz_12345_folder";
        #[cfg(not(windows))]
        let bad_path = "/nonexistent_xyz_12345_folder";
        let err = scan_path(bad_path).unwrap_err();
        assert!(matches!(err, DiskAnalyzerError::InvalidPath(_)));
    }

    #[test]
    fn test_scan_temp_dir() {
        let (_guard, path) = create_test_dir();
        let result = scan_path(&path).unwrap();
        assert!(result.file_count >= 2);
        assert!(result.total_size >= 10);

        assert!(!result.root.children.is_empty());
    }

    #[test]
    #[cfg(windows)]
    fn test_scan_academic_path() {
        let path = "C:\\Users\\K\\Academic";
        if std::path::Path::new(path).exists() {
            let result = scan_path(path).unwrap();
            assert!(result.root.name == "Academic" || !result.root.path.is_empty());
        }
    }
}
