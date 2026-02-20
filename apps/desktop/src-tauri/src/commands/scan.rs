//! 扫描命令：当用户勾选「使用 MFT」且当前路径为 Windows 磁盘根（如 C:\）时，
//! 后端通过 scan_path_with_progress(..., use_mft: true) 走 MFT 全量扫描（与普通扫描相同的树结构），
//! 无需只取前 N 个文件，由 ai_disk_scanner 内部根据路径与 use_mft 决定是否调用 scan_volume_mft。

use ai_disk_domain::ScanResult;
use ai_disk_scanner::scan_path_with_progress;
use std::io::Write;
use tauri::{async_runtime, Emitter, Window};

fn stderr_flush() {
    let _ = std::io::stderr().flush();
}

#[tauri::command]
pub async fn scan_path_command(
    window: Window,
    path: String,
    shallow_dirs: Option<bool>,
    use_mft: Option<bool>,
) -> Result<ScanResult, String> {
    let path_trimmed = path.trim().to_string();
    let use_shallow = shallow_dirs.unwrap_or(true);
    // 明确使用传入值：None 视为默认 true，Some(false) 必须为 false
    let use_mft = use_mft.unwrap_or(true);

    let thread_count = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(1);
    if use_mft {
        let _ = writeln!(
            std::io::stderr(),
            "[DiskRookie] scan start (MFT requested), path: {}, threads: {}",
            path_trimmed,
            thread_count
        );
    } else {
        let _ = writeln!(
            std::io::stderr(),
            "[DiskRookie] scan start (normal walk), path: {}",
            path_trimmed
        );
    }
    stderr_flush();

    let path_clone = path_trimmed.clone();
    let window_progress = window.clone();
    let progress = std::sync::Arc::new(Box::new(move |count: u64, path_str: &str| {
        let _ = window_progress.emit("scan-progress", (count, path_str.to_string()));
    }) as Box<dyn Fn(u64, &str) + Send + Sync>);
    let window_emit = window.clone();
    let (result, used_mft) = async_runtime::spawn_blocking(move || {
        scan_path_with_progress(&path_clone, Some(&progress), use_shallow, use_mft)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    if used_mft {
        let _ = writeln!(
            std::io::stderr(),
            "[DiskRookie] scan done (MFT used), path: {}, file_count: {}, total_size: {}",
            path_trimmed,
            result.file_count,
            result.total_size
        );
    } else {
        let _ = writeln!(
            std::io::stderr(),
            "[DiskRookie] scan done (normal walk), path: {}, file_count: {}, total_size: {}",
            path_trimmed,
            result.file_count,
            result.total_size
        );
    }
    stderr_flush();
    let _ = window_emit.emit("scan-mft-status", (path_trimmed.clone(), used_mft));
    Ok(result)
}
