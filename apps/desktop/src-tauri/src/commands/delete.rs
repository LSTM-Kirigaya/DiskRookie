use std::fs;
use std::path::Path;

#[tauri::command]
pub async fn delete_item(path: String) -> Result<String, String> {
    let path_buf = Path::new(&path);
    
    if !path_buf.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    // 安全检查：禁止删除系统关键目录
    let forbidden_paths = if cfg!(windows) {
        vec![
            "C:\\Windows",
            "C:\\Program Files",
            "C:\\Program Files (x86)",
            "C:\\System Volume Information",
        ]
    } else {
        vec![
            "/System",
            "/Library",
            "/bin",
            "/sbin",
            "/usr",
            "/etc",
            "/var",
        ]
    };

    let canonical = fs::canonicalize(path_buf)
        .map_err(|e| format!("无法解析路径: {}", e))?;
    
    let canonical_str = canonical.to_string_lossy().to_string();
    
    for forbidden in forbidden_paths {
        if canonical_str.starts_with(forbidden) {
            return Err(format!("禁止删除系统目录: {}", forbidden));
        }
    }

    // 执行删除
    if path_buf.is_dir() {
        fs::remove_dir_all(path_buf)
            .map_err(|e| format!("删除目录失败: {}", e))?;
        Ok(format!("已删除目录: {}", path))
    } else {
        fs::remove_file(path_buf)
            .map_err(|e| format!("删除文件失败: {}", e))?;
        Ok(format!("已删除文件: {}", path))
    }
}
