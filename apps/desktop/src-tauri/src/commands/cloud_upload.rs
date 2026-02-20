use futures::future;
use log::{debug, error, info, warn};
use reqwest;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadConfig {
    pub provider: String,
    pub name: String,
    pub access_token: String,
    pub target_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadResult {
    pub success: bool,
    pub provider: String,
    pub file_id: Option<String>,
    pub message: String,
    pub source_deleted: bool,
}

/// 上传进度事件的数据结构
#[derive(Debug, Clone, Serialize)]
pub struct UploadProgressEvent {
    pub task_id: String,
    pub provider: String,
    pub progress: u32, // 0-100
    pub uploaded_bytes: u64,
    pub total_bytes: u64,
}

/// 上传文件到云存储
#[tauri::command]
pub async fn upload_to_cloud(
    app: AppHandle,
    file_path: String,
    configs: Vec<UploadConfig>,
    delete_source: Option<bool>,
    task_id: Option<String>,
) -> Result<Vec<UploadResult>, String> {
    info!("开始上传文件到云存储: {}", file_path);
    info!("目标云存储数量: {}", configs.len());
    info!("任务ID: {:?}", task_id);
    debug!("删除源文件选项: {:?}", delete_source);

    let task_id = task_id.unwrap_or_else(|| {
        format!(
            "upload_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        )
    });

    // 并行上传到所有配置的云存储
    let upload_futures: Vec<_> = configs
        .into_iter()
        .map(|config| {
            let file_path_clone = file_path.clone();
            let app_clone = app.clone();
            let task_id_clone = task_id.clone();
            tokio::spawn(async move {
                info!("开始上传到 {} ({})", config.name, config.provider);
                let result = match config.provider.as_str() {
                    "google_drive" => {
                        upload_to_google_drive_resumable(
                            &file_path_clone,
                            &config,
                            &app_clone,
                            &task_id_clone,
                        )
                        .await
                    }
                    _ => Err(format!("不支持的云存储提供商: {}", config.provider)),
                };

                match &result {
                    Ok(file_id) => {
                        info!(
                            "成功上传到 {} ({})，文件ID: {}",
                            config.name, config.provider, file_id
                        );
                    }
                    Err(e) => {
                        error!("上传到 {} ({}) 失败: {}", config.name, config.provider, e);
                    }
                }

                let upload_result = match result {
                    Ok(file_id) => UploadResult {
                        success: true,
                        provider: config.provider.clone(),
                        file_id: Some(file_id),
                        message: format!("成功上传到 {}", config.name),
                        source_deleted: false,
                    },
                    Err(e) => UploadResult {
                        success: false,
                        provider: config.provider.clone(),
                        file_id: None,
                        message: format!("上传失败: {}", e),
                        source_deleted: false,
                    },
                };

                (config.name.clone(), upload_result)
            })
        })
        .collect();

    // 等待所有上传任务完成
    let upload_results: Vec<_> = future::join_all(upload_futures).await;

    let mut results = Vec::new();
    let mut all_success = true;

    for result in upload_results {
        match result {
            Ok((_name, upload_result)) => {
                if !upload_result.success {
                    all_success = false;
                }
                results.push(upload_result);
            }
            Err(e) => {
                error!("上传任务执行失败: {:?}", e);
                all_success = false;
                // 创建一个失败的结果
                results.push(UploadResult {
                    success: false,
                    provider: "unknown".to_string(),
                    file_id: None,
                    message: format!("任务执行失败: {:?}", e),
                    source_deleted: false,
                });
            }
        }
    }

    // 如果所有上传都成功且需要删除源文件
    if all_success && delete_source.unwrap_or(false) {
        info!("所有上传成功，准备删除源文件: {}", file_path);
        let path = Path::new(&file_path);
        if path.exists() {
            let delete_result = if path.is_dir() {
                debug!("删除目录: {}", file_path);
                fs::remove_dir_all(path)
            } else {
                debug!("删除文件: {}", file_path);
                fs::remove_file(path)
            };

            match delete_result {
                Ok(_) => {
                    info!("成功删除源文件: {}", file_path);
                    // 更新所有结果，标记源文件已删除
                    for result in &mut results {
                        result.source_deleted = true;
                        result.message = format!("{} (已删除源文件)", result.message);
                    }
                }
                Err(e) => {
                    warn!("删除源文件失败: {}，错误: {}", file_path, e);
                    // 删除失败，但上传已成功，只在消息中记录
                    for result in &mut results {
                        result.message = format!("{} (删除源文件失败: {})", result.message, e);
                    }
                }
            }
        } else {
            warn!("源文件不存在，无法删除: {}", file_path);
        }
    } else if !all_success {
        warn!("部分上传失败，不删除源文件");
    }

    info!(
        "上传任务完成，成功: {}，失败: {}",
        results.iter().filter(|r| r.success).count(),
        results.iter().filter(|r| !r.success).count()
    );

    Ok(results)
}

/// 使用 Resumable Upload API 上传文件到 Google Drive（支持进度回调）
async fn upload_to_google_drive_resumable(
    file_path: &str,
    config: &UploadConfig,
    app: &AppHandle,
    task_id: &str,
) -> Result<String, String> {
    let path = Path::new(file_path);

    debug!("准备上传文件到 Google Drive (Resumable): {}", file_path);
    debug!("目标路径: {}", config.target_path);

    // 检查文件是否存在
    if !path.exists() {
        error!("文件不存在: {}", file_path);
        return Err(format!("文件不存在: {}", file_path));
    }

    // 获取文件大小
    let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
    info!(
        "文件大小: {} 字节 ({:.2} MB)",
        file_size,
        file_size as f64 / 1024.0 / 1024.0
    );

    // 获取文件名
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "无法获取文件名".to_string())?;

    info!("文件名: {}", file_name);

    // 第一步：获取或创建目标文件夹
    debug!("获取或创建目标文件夹: {}", config.target_path);
    let folder_id = if config.target_path == "/" {
        debug!("使用根目录");
        "root".to_string()
    } else {
        create_or_get_folder(&config.access_token, &config.target_path).await?
    };
    info!("目标文件夹ID: {}", folder_id);

    // 发送初始进度 0%
    let _ = app.emit(
        "upload-progress",
        UploadProgressEvent {
            task_id: task_id.to_string(),
            provider: config.provider.clone(),
            progress: 0,
            uploaded_bytes: 0,
            total_bytes: file_size,
        },
    );

    // 第二步：初始化 Resumable Upload Session
    debug!("初始化 Resumable Upload Session");
    let client = reqwest::Client::new();

    let metadata = serde_json::json!({
        "name": file_name,
        "parents": [folder_id]
    });

    let init_response = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")
        .header("Authorization", format!("Bearer {}", config.access_token))
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("X-Upload-Content-Type", "application/octet-stream")
        .header("X-Upload-Content-Length", file_size.to_string())
        .json(&metadata)
        .send()
        .await
        .map_err(|e| {
            error!("初始化上传会话失败: {}", e);
            format!("初始化上传会话失败: {}", e)
        })?;

    if !init_response.status().is_success() {
        let error_text = init_response.text().await.unwrap_or_default();
        error!("初始化上传会话失败: {}", error_text);
        return Err(format!("初始化上传会话失败: {}", error_text));
    }

    // 获取上传 URI
    let upload_uri = init_response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            error!("响应中没有上传 URI");
            "响应中没有上传 URI".to_string()
        })?
        .to_string();

    info!("获取到上传 URI: {}", upload_uri);

    // 第三步：分块上传文件
    let chunk_size: u64 = 5 * 1024 * 1024; // 5MB 每块
    let mut uploaded: u64 = 0;

    let mut file = std::fs::File::open(path).map_err(|e| {
        error!("打开文件失败: {}", e);
        format!("打开文件失败: {}", e)
    })?;

    let mut last_progress: u32 = 0;

    while uploaded < file_size {
        let remaining = file_size - uploaded;
        let current_chunk_size = std::cmp::min(chunk_size, remaining);

        // 读取当前块
        let mut buffer = vec![0u8; current_chunk_size as usize];
        file.read_exact(&mut buffer).map_err(|e| {
            error!("读取文件块失败: {}", e);
            format!("读取文件块失败: {}", e)
        })?;

        let start_byte = uploaded;
        let end_byte = uploaded + current_chunk_size - 1;

        debug!("上传块: bytes {}-{}/{}", start_byte, end_byte, file_size);

        let response = client
            .put(&upload_uri)
            .header("Content-Length", current_chunk_size.to_string())
            .header(
                "Content-Range",
                format!("bytes {}-{}/{}", start_byte, end_byte, file_size),
            )
            .body(buffer)
            .send()
            .await
            .map_err(|e| {
                error!("上传块失败: {}", e);
                format!("上传块失败: {}", e)
            })?;

        let status = response.status();

        // 308 Resume Incomplete 表示还需要继续上传
        // 200 或 201 表示上传完成
        if status == reqwest::StatusCode::OK || status == reqwest::StatusCode::CREATED {
            // 上传完成
            info!("上传完成!");

            // 发送 100% 进度
            let _ = app.emit(
                "upload-progress",
                UploadProgressEvent {
                    task_id: task_id.to_string(),
                    provider: config.provider.clone(),
                    progress: 100,
                    uploaded_bytes: file_size,
                    total_bytes: file_size,
                },
            );

            // 解析响应获取文件 ID
            let result: serde_json::Value = response.json().await.map_err(|e| {
                error!("解析响应失败: {}", e);
                format!("解析响应失败: {}", e)
            })?;

            let file_id = result["id"]
                .as_str()
                .ok_or_else(|| {
                    error!("响应中没有文件 ID，响应内容: {:?}", result);
                    "响应中没有文件 ID".to_string()
                })?
                .to_string();

            info!("上传成功，文件ID: {}", file_id);
            return Ok(file_id);
        } else if status == reqwest::StatusCode::PERMANENT_REDIRECT || status.as_u16() == 308 {
            // 308 Resume Incomplete - 继续上传
            uploaded += current_chunk_size;

            // 计算并发送进度
            let progress = ((uploaded as f64 / file_size as f64) * 100.0) as u32;
            if progress > last_progress {
                last_progress = progress;
                info!("上传进度: {}% ({}/{} bytes)", progress, uploaded, file_size);

                let _ = app.emit(
                    "upload-progress",
                    UploadProgressEvent {
                        task_id: task_id.to_string(),
                        provider: config.provider.clone(),
                        progress,
                        uploaded_bytes: uploaded,
                        total_bytes: file_size,
                    },
                );
            }
        } else {
            // 其他状态码表示错误
            let error_text = response.text().await.unwrap_or_default();
            error!("上传块失败，状态码: {}，错误: {}", status, error_text);
            return Err(format!("上传失败 ({}): {}", status, error_text));
        }
    }

    Err("上传异常结束".to_string())
}

/// 创建或获取文件夹
async fn create_or_get_folder(access_token: &str, path: &str) -> Result<String, String> {
    debug!("创建或获取文件夹: {}", path);
    let client = reqwest::Client::new();

    // 分割路径
    let parts: Vec<&str> = path
        .trim_matches('/')
        .split('/')
        .filter(|p| !p.is_empty())
        .collect();

    debug!("路径分割为 {} 个部分: {:?}", parts.len(), parts);

    let mut parent_id = "root".to_string();

    // 逐级创建或查找文件夹
    for folder_name in parts {
        debug!("处理文件夹: {}，父文件夹ID: {}", folder_name, parent_id);
        // 查找是否已存在
        debug!("查询文件夹是否存在: {}", folder_name);
        let query = format!(
            "name='{}' and '{}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
            folder_name, parent_id
        );

        let search_url = format!(
            "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id)",
            urlencoding::encode(&query)
        );

        let response = client
            .get(&search_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| {
                error!("查询文件夹失败: {}", e);
                format!("查询文件夹失败: {}", e)
            })?;

        if !response.status().is_success() {
            error!("查询文件夹失败，状态码: {}", response.status());
            return Err(format!("查询文件夹失败: {}", response.status()));
        }

        let result: serde_json::Value = response.json().await.map_err(|e| {
            error!("解析查询响应失败: {}", e);
            format!("解析查询响应失败: {}", e)
        })?;

        // 如果找到了，使用现有的
        if let Some(files) = result["files"].as_array() {
            if !files.is_empty() {
                parent_id = files[0]["id"]
                    .as_str()
                    .ok_or_else(|| {
                        error!("无效的文件夹 ID");
                        "无效的文件夹 ID".to_string()
                    })?
                    .to_string();
                debug!("找到现有文件夹，ID: {}", parent_id);
                continue;
            }
        }

        // 没找到，创建新文件夹
        debug!("文件夹不存在，创建新文件夹: {}", folder_name);
        let metadata = serde_json::json!({
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id]
        });

        let response = client
            .post("https://www.googleapis.com/drive/v3/files")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&metadata)
            .send()
            .await
            .map_err(|e| {
                error!("创建文件夹请求失败: {}", e);
                format!("创建文件夹失败: {}", e)
            })?;

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("创建文件夹失败，状态码: {}，错误: {}", status, error_text);
            return Err(format!("创建文件夹失败: {}", error_text));
        }

        let result: serde_json::Value = response.json().await.map_err(|e| {
            error!("解析创建响应失败: {}", e);
            format!("解析创建响应失败: {}", e)
        })?;

        parent_id = result["id"]
            .as_str()
            .ok_or_else(|| {
                error!("创建的文件夹没有 ID，响应: {:?}", result);
                "创建的文件夹没有 ID".to_string()
            })?
            .to_string();
        info!("成功创建文件夹: {}，ID: {}", folder_name, parent_id);
    }

    info!("文件夹路径处理完成，最终文件夹ID: {}", parent_id);
    Ok(parent_id)
}
