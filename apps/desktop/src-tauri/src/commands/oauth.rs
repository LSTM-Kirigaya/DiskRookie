use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

// Google OAuth 配置 - 从环境变量读取（编译时嵌入，如果不存在则使用空字符串）
const GOOGLE_CLIENT_ID: &str = match option_env!("GOOGLE_CLIENT_ID") {
    Some(id) => id,
    None => "",
};
const GOOGLE_CLIENT_SECRET: &str = match option_env!("GOOGLE_CLIENT_SECRET") {
    Some(secret) => secret,
    None => "",
};
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES: &str = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

// 百度网盘 OAuth 配置 - 从环境变量读取（编译时嵌入，如果不存在则使用空字符串）
const BAIDU_CLIENT_ID: &str = match option_env!("BAIDU_CLIENT_ID") {
    Some(id) => id,
    None => "",
};
const BAIDU_CLIENT_SECRET: &str = match option_env!("BAIDU_CLIENT_SECRET") {
    Some(secret) => secret,
    None => "",
};
const BAIDU_AUTH_URL: &str = "https://openapi.baidu.com/oauth/2.0/authorize";
const BAIDU_TOKEN_URL: &str = "https://openapi.baidu.com/oauth/2.0/token";
const BAIDU_SCOPES: &str = "netdisk"; // 百度网盘权限范围

// 阿里云盘 OAuth 配置 - 从 .env 文件读取（编译时嵌入）
const ALIYUN_CLIENT_ID: &str = match option_env!("ALIYUN_CLIENT_ID") {
    Some(id) => id,
    None => "",
};
const ALIYUN_CLIENT_SECRET: &str = match option_env!("ALIYUN_CLIENT_SECRET") {
    Some(secret) => secret,
    None => "",
};
const ALIYUN_AUTH_URL: &str = "https://openapi.alipan.com/oauth/authorize";
const ALIYUN_TOKEN_URL: &str = "https://openapi.alipan.com/v2/oauth/token";
const ALIYUN_SCOPES: &str = "user:base,file:all:read,file:all:write"; // 阿里云盘权限范围

// Dropbox OAuth 配置 - 从 .env 文件读取（编译时嵌入）
const DROPBOX_CLIENT_ID: &str = match option_env!("DROPBOX_CLIENT_ID") {
    Some(id) => id,
    None => "",
};
const DROPBOX_CLIENT_SECRET: &str = match option_env!("DROPBOX_CLIENT_SECRET") {
    Some(secret) => secret,
    None => "",
};
const DROPBOX_AUTH_URL: &str = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL: &str = "https://api.dropbox.com/oauth2/token";
const DROPBOX_SCOPES: &str = "files.content.write files.content.read account_info.read"; // Dropbox 权限范围

// OAuth 状态管理（用于管理未来的多账号场景）
#[allow(dead_code)]
pub struct OAuthState {
    #[allow(dead_code)]
    pending_auth: Mutex<Option<PendingAuth>>,
}

impl Default for OAuthState {
    fn default() -> Self {
        Self {
            pending_auth: Mutex::new(None),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone)]
struct PendingAuth {
    code_verifier: String,
    state: String,
    redirect_uri: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
}

// 生成随机字符串
fn generate_random_string(length: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

// 生成 PKCE code verifier
fn generate_code_verifier() -> String {
    generate_random_string(64)
}

// 生成 PKCE code challenge (S256)
fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(hash)
}

// 启动本地服务器并返回端口
fn start_callback_server() -> Result<(tiny_http::Server, u16), String> {
    // 尝试在随机端口上启动服务器
    for _ in 0..10 {
        let port = rand::thread_rng().gen_range(49152..65535);
        let addr = format!("127.0.0.1:{}", port);
        if let Ok(server) = tiny_http::Server::http(&addr) {
            return Ok((server, port));
        }
    }
    Err("无法启动本地回调服务器".to_string())
}

// 等待 OAuth 回调
fn wait_for_callback(server: &tiny_http::Server) -> Result<(String, String), String> {
    // 等待请求，超时 5 分钟
    let timeout = std::time::Duration::from_secs(300);
    let start = std::time::Instant::now();

    println!("等待 OAuth 回调...");

    loop {
        if start.elapsed() > timeout {
            println!("OAuth 授权超时");
            return Err("OAuth 授权超时".to_string());
        }

        match server.recv_timeout(std::time::Duration::from_millis(500)) {
            Ok(Some(request)) => {
                println!("收到回调请求: {}", request.url());
                let url = request.url().to_string();

                // 解析查询参数
                let params: HashMap<String, String> = url
                    .split('?')
                    .nth(1)
                    .unwrap_or("")
                    .split('&')
                    .filter_map(|pair| {
                        let mut parts = pair.split('=');
                        let key = parts.next()?;
                        let value = parts.next().unwrap_or("");
                        Some((
                            urlencoding::decode(key).ok()?.into_owned(),
                            urlencoding::decode(value).ok()?.into_owned(),
                        ))
                    })
                    .collect();

                // 发送成功响应给浏览器
                let response_html = r#"
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <title>授权成功 - DiskRookie</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #2A2A2A;
            color: #ffffff;
            overflow: hidden;
        }

        /* 动态背景粒子效果 */
        .bg-particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
        }

        .particle {
            position: absolute;
            width: 2px;
            height: 2px;
            background: rgba(255, 210, 0, 0.3);
            border-radius: 50%;
            animation: float 20s infinite linear;
        }

        @keyframes float {
            0% {
                transform: translateY(100vh) translateX(0);
                opacity: 0;
            }

            10% {
                opacity: 1;
            }

            90% {
                opacity: 1;
            }

            100% {
                transform: translateY(-100vh) translateX(100px);
                opacity: 0;
            }
        }

        .container {
            text-align: center;
            padding: 60px 50px;
            background: rgba(20, 20, 20, 0.8);
            border-radius: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            box-shadow: 0 0 0 1px rgba(255, 210, 0, 0.1), 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 100px rgba(255, 210, 0, 0.05);
            position: relative;
            z-index: 10;
            max-width: 420px;
            width: 90%;
            animation: slideUp 0.6s ease-out;
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }

            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Logo 区域 */
        .logo-wrapper {
            position: relative;
            width: 80px;
            height: 80px;
            margin: 0 auto 30px;
        }

        .logo-glow {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 100px;
            height: 100px;
            background: radial-gradient(circle, rgba(255, 210, 0, 0.3) 0%, transparent 70%);
            border-radius: 50%;
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {

            0%,
            100% {
                transform: translate(-50%, -50%) scale(1);
                opacity: 0.5;
            }

            50% {
                transform: translate(-50%, -50%) scale(1.2);
                opacity: 0.8;
            }
        }

        .logo {
            width: 80px;
            height: 80px;
            border-radius: 20px;
            position: relative;
            z-index: 2;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        /* 成功图标动画 */
        .success-ring {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            background: linear-gradient(135deg, #FFD200 0%, #FFA500 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 25px auto;
            position: relative;
            animation: scaleIn 0.5s ease-out 0.3s both;
            box-shadow: 0 10px 40px rgba(255, 210, 0, 0.3);
        }

        @keyframes scaleIn {
            0% {
                transform: scale(0);
            }

            50% {
                transform: scale(1.1);
            }

            100% {
                transform: scale(1);
            }
        }

        .success-icon {
            font-size: 32px;
            color: #2A2A2A;
            font-weight: bold;
        }

        .brand-name {
            font-size: 14px;
            color: #FFD200;
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 15px;
            font-weight: 600;
        }

        h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 12px;
            background: linear-gradient(135deg, #ffffff 0%, #a0a0a0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            font-size: 16px;
            color: #888;
            margin-bottom: 35px;
            line-height: 1.6;
        }

        /* 进度条装饰 */
        .progress-bar {
            width: 100%;
            height: 3px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 3px;
            overflow: hidden;
            margin-bottom: 30px;
        }

        .progress-fill {
            height: 100%;
            width: 100%;
            background: linear-gradient(90deg, #FFD200, #ffe77c);
            animation: progress 2s ease-out;
            border-radius: 3px;
        }

        @keyframes progress {
            from {
                width: 0%;
            }

            to {
                width: 100%;
            }
        }

        .close-btn {
            display: inline-block;
            padding: 14px 32px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            font-weight: 500;
        }

        .close-btn:hover {
            background: rgba(255, 210, 0, 0.1);
            border-color: #FFD200;
            color: #FFD200;
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(255, 210, 0, 0.2);
        }

        .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #444;
        }
    </style>
</head>

<body> <!-- 背景粒子 -->
    <div class="bg-particles" id="particles"></div>
    <div class="container"> <!-- Logo -->
        <div class="logo-wrapper">
            <div class="logo-glow"></div> <img src="https://youke.xn--y7xa690gmna.cn/s1/2026/02/05/698383936072d.webp"
                alt="DiskRookie" class="logo">
        </div> <!-- 品牌名 -->
        <div class="brand-name">DiskRookie</div> <!-- 成功图标 -->
        <div class="success-ring"> <span class="success-icon">✓</span> </div>
        <h1>授权成功</h1>
        <p class="subtitle">您的 AI 磁盘清理工具已激活<br>现在可以关闭此窗口返回应用</p> <!-- 进度条 -->
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
        <div class="footer">AI-Powered Disk Cleaning Tool</div>
    </div>
    <script>const particlesContainer = document.getElementById('particles'); for (let i = 0; i < 50; i++) { const particle = document.createElement('div'); particle.className = 'particle'; particle.style.left = Math.random() * 100 + '%'; particle.style.animationDelay = Math.random() * 20 + 's'; particle.style.animationDuration = (15 + Math.random() * 10) + 's'; particlesContainer.appendChild(particle); }      </script>
</body>

</html>
"#;

                let response = tiny_http::Response::from_string(response_html).with_header(
                    tiny_http::Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"text/html; charset=utf-8"[..],
                    )
                    .unwrap(),
                );

                if let Err(e) = request.respond(response) {
                    println!("发送响应失败: {}", e);
                }

                // 检查是否有错误
                if let Some(error) = params.get("error") {
                    let error_desc = params
                        .get("error_description")
                        .cloned()
                        .unwrap_or_else(|| "未知错误".to_string());
                    println!("OAuth 错误: {} - {}", error, error_desc);
                    return Err(format!("OAuth 错误: {} - {}", error, error_desc));
                }

                // 获取授权码和 state
                let code = params.get("code").ok_or("未收到授权码")?.clone();
                let state = params.get("state").ok_or("未收到 state 参数")?.clone();

                println!("成功获取授权码和 state");
                return Ok((code, state));
            }
            Ok(None) => {
                // 超时，继续循环
            }
            Err(e) => {
                println!("接收请求时出错: {}", e);
                // 继续循环，不中断
            }
        }
    }
}

/// 完成 Google OAuth 授权（等待回调并交换 token）
#[tauri::command]
pub async fn complete_google_oauth(
    _oauth_state: State<'_, OAuthState>,
) -> Result<OAuthTokens, String> {
    println!("开始 Google OAuth 授权流程");

    // 启动本地回调服务器
    let (server, port) = start_callback_server()?;
    let redirect_uri = format!("http://127.0.0.1:{}", port);
    println!("本地回调服务器已启动，端口: {}", port);

    // 生成 PKCE 和 state
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state = generate_random_string(32);
    println!("PKCE 参数已生成");

    // 构建授权 URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        GOOGLE_AUTH_URL,
        urlencoding::encode(GOOGLE_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(GOOGLE_SCOPES),
        urlencoding::encode(&code_challenge),
        urlencoding::encode(&state)
    );
    println!("授权 URL: {}", auth_url);

    // 打开浏览器
    println!("正在打开浏览器...");
    open::that(&auth_url).map_err(|e| format!("无法打开浏览器: {}", e))?;

    // 在阻塞线程池中等待回调（避免阻塞 async runtime）
    println!("等待用户授权...");
    println!("回调 URL: {}", redirect_uri);
    let (code, received_state) = tokio::task::spawn_blocking(move || {
        println!("回调服务器正在监听...");
        let result = wait_for_callback(&server);
        println!("回调服务器收到响应: {:?}", result.is_ok());
        result
    })
    .await
    .map_err(|e| format!("等待回调失败: {}", e))??;

    println!("收到授权码，验证 state...");

    // 验证 state
    if received_state != state {
        return Err("State 验证失败，可能存在 CSRF 攻击".to_string());
    }

    // 交换授权码获取 token
    println!("开始交换授权码获取 token...");
    let client = reqwest::Client::new();
    let token_response = client
        .post(GOOGLE_TOKEN_URL)
        .form(&[
            ("client_id", GOOGLE_CLIENT_ID),
            ("client_secret", GOOGLE_CLIENT_SECRET),
            ("code", &code),
            ("code_verifier", &code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| {
            println!("Token 请求发送失败: {}", e);
            format!("Token 请求失败: {}", e)
        })?;

    let status = token_response.status();
    println!("Token 响应状态码: {}", status);

    if !status.is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        println!("Token 请求失败，响应内容: {}", error_text);
        return Err(format!("Token 请求失败 ({}): {}", status, error_text));
    }

    let response_text = token_response.text().await.map_err(|e| {
        println!("读取 token 响应失败: {}", e);
        format!("读取 token 响应失败: {}", e)
    })?;

    println!("Token 响应内容: {}", response_text);

    let tokens: OAuthTokens = serde_json::from_str(&response_text).map_err(|e| {
        println!("解析 token 响应失败: {}", e);
        format!("解析 token 响应失败: {}", e)
    })?;

    println!("成功获取 token！");
    Ok(tokens)
}

/// 刷新 Google OAuth access token
#[tauri::command]
pub async fn refresh_google_token(refresh_token: String) -> Result<OAuthTokens, String> {
    // 创建带超时的 HTTP 客户端（30秒超时）
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    // 重试机制：最多重试3次
    let max_retries = 3;
    let mut last_error = None;

    for attempt in 1..=max_retries {
        let token_response = match client
            .post(GOOGLE_TOKEN_URL)
            .form(&[
                ("client_id", GOOGLE_CLIENT_ID),
                ("client_secret", GOOGLE_CLIENT_SECRET),
                ("refresh_token", refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
        {
            Ok(response) => response,
            Err(e) => {
                last_error = Some(format!(
                    "刷新 token 失败 (尝试 {}/{}): {}",
                    attempt, max_retries, e
                ));
                // 如果不是最后一次尝试，等待后重试
                if attempt < max_retries {
                    tokio::time::sleep(std::time::Duration::from_millis(1000 * attempt as u64))
                        .await;
                    continue;
                }
                return Err(last_error.unwrap());
            }
        };

        // 先保存状态码，因为后续调用 text() 会消费 token_response
        let status_code = token_response.status();
        if !status_code.is_success() {
            let error_text = token_response.text().await.unwrap_or_default();
            let status_u16 = status_code.as_u16();
            last_error = Some(format!(
                "刷新 token 失败 (尝试 {}/{}): HTTP {} - {}",
                attempt, max_retries, status_u16, error_text
            ));
            // 如果是认证错误（401/403），不需要重试
            if status_u16 == 401 || status_u16 == 403 {
                return Err(last_error.unwrap());
            }
            // 如果不是最后一次尝试，等待后重试
            if attempt < max_retries {
                tokio::time::sleep(std::time::Duration::from_millis(1000 * attempt as u64)).await;
                continue;
            }
            return Err(last_error.unwrap());
        }

        // 成功获取响应，解析 token
        match token_response.json::<OAuthTokens>().await {
            Ok(tokens) => return Ok(tokens),
            Err(e) => {
                last_error = Some(format!(
                    "解析 token 响应失败 (尝试 {}/{}): {}",
                    attempt, max_retries, e
                ));
                if attempt < max_retries {
                    tokio::time::sleep(std::time::Duration::from_millis(1000 * attempt as u64))
                        .await;
                    continue;
                }
                return Err(last_error.unwrap());
            }
        }
    }

    Err(last_error.unwrap_or_else(|| "刷新 token 失败：未知错误".to_string()))
}

/// 撤销 Google OAuth 授权
#[tauri::command]
pub async fn revoke_google_token(token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/revoke")
        .form(&[("token", token.as_str())])
        .send()
        .await
        .map_err(|e| format!("撤销 token 失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("撤销 token 失败: {}", error_text));
    }

    Ok(())
}

/// 获取 Google 用户信息
#[tauri::command]
pub async fn get_google_user_info(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("获取用户信息失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取用户信息失败: {}", error_text));
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析用户信息失败: {}", e))?;

    Ok(user_info)
}

/// 获取 Google Drive 存储配额信息
#[tauri::command]
pub async fn get_google_drive_quota(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("https://www.googleapis.com/drive/v3/about?fields=storageQuota,user")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("获取存储配额失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取存储配额失败: {}", error_text));
    }

    let quota_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析存储配额失败: {}", e))?;

    Ok(quota_info)
}

// ========== 百度网盘 OAuth 实现 ==========

/// 完成百度网盘 OAuth 授权（等待回调并交换 token）
/// 注意：百度网盘不支持 PKCE，使用标准的授权码模式
#[tauri::command]
pub async fn complete_baidu_oauth(
    _oauth_state: State<'_, OAuthState>,
) -> Result<OAuthTokens, String> {
    println!("开始百度网盘 OAuth 授权流程");

    // 启动本地回调服务器
    let (server, port) = start_callback_server()?;
    let redirect_uri = format!("http://127.0.0.1:{}", port);
    println!("本地回调服务器已启动，端口: {}", port);

    // 生成 state（用于 CSRF 防护）
    let state = generate_random_string(32);
    println!("State 参数已生成");

    // 构建授权 URL（百度网盘不支持 PKCE）
    let auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        BAIDU_AUTH_URL,
        urlencoding::encode(BAIDU_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(BAIDU_SCOPES),
        urlencoding::encode(&state)
    );
    println!("授权 URL: {}", auth_url);

    // 打开浏览器
    println!("正在打开浏览器...");
    open::that(&auth_url).map_err(|e| format!("无法打开浏览器: {}", e))?;

    // 在阻塞线程池中等待回调（避免阻塞 async runtime）
    println!("等待用户授权...");
    println!("回调 URL: {}", redirect_uri);
    let (code, received_state) = tokio::task::spawn_blocking(move || {
        println!("回调服务器正在监听...");
        let result = wait_for_callback(&server);
        println!("回调服务器收到响应: {:?}", result.is_ok());
        result
    })
    .await
    .map_err(|e| format!("等待回调失败: {}", e))??;

    println!("收到授权码，验证 state...");

    // 验证 state
    if received_state != state {
        return Err("State 验证失败，可能存在 CSRF 攻击".to_string());
    }

    // 交换授权码获取 token（百度网盘使用 GET 请求）
    println!("开始交换授权码获取 token...");
    let client = reqwest::Client::new();
    let token_url = format!(
        "{}?grant_type=authorization_code&code={}&client_id={}&client_secret={}&redirect_uri={}",
        BAIDU_TOKEN_URL,
        urlencoding::encode(&code),
        urlencoding::encode(BAIDU_CLIENT_ID),
        urlencoding::encode(BAIDU_CLIENT_SECRET),
        urlencoding::encode(&redirect_uri)
    );

    let token_response = client.get(&token_url).send().await.map_err(|e| {
        println!("Token 请求发送失败: {}", e);
        format!("Token 请求失败: {}", e)
    })?;

    let status = token_response.status();
    println!("Token 响应状态码: {}", status);

    if !status.is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        println!("Token 请求失败，响应内容: {}", error_text);
        return Err(format!("Token 请求失败 ({}): {}", status, error_text));
    }

    let response_text = token_response.text().await.map_err(|e| {
        println!("读取 token 响应失败: {}", e);
        format!("读取 token 响应失败: {}", e)
    })?;

    println!("Token 响应内容: {}", response_text);

    // 百度网盘返回的 token 格式可能不同，需要适配
    let tokens: OAuthTokens = serde_json::from_str(&response_text).map_err(|e| {
        println!("解析 token 响应失败: {}", e);
        format!("解析 token 响应失败: {}", e)
    })?;

    println!("成功获取 token！");
    Ok(tokens)
}

/// 刷新百度网盘 OAuth access token
#[tauri::command]
pub async fn refresh_baidu_token(refresh_token: String) -> Result<OAuthTokens, String> {
    let client = reqwest::Client::new();
    let token_url = format!(
        "{}?grant_type=refresh_token&refresh_token={}&client_id={}&client_secret={}",
        BAIDU_TOKEN_URL,
        urlencoding::encode(&refresh_token),
        urlencoding::encode(BAIDU_CLIENT_ID),
        urlencoding::encode(BAIDU_CLIENT_SECRET)
    );

    let token_response = client
        .get(&token_url)
        .send()
        .await
        .map_err(|e| format!("刷新 token 失败: {}", e))?;

    if !token_response.status().is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!("刷新 token 失败: {}", error_text));
    }

    let tokens: OAuthTokens = token_response
        .json()
        .await
        .map_err(|e| format!("解析 token 响应失败: {}", e))?;

    Ok(tokens)
}

/// 撤销百度网盘 OAuth 授权
/// 注意：百度网盘可能没有标准的撤销端点，这里提供一个占位实现
#[tauri::command]
pub async fn revoke_baidu_token(_token: String) -> Result<(), String> {
    // 百度网盘可能不支持 token 撤销，或者需要调用特定的 API
    // 这里先返回成功，实际使用时可能需要根据百度网盘的文档调整
    println!("百度网盘 token 撤销（如果支持）");
    Ok(())
}

/// 获取百度网盘用户信息
#[tauri::command]
pub async fn get_baidu_user_info(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let user_info_url = format!(
        "https://openapi.baidu.com/rest/2.0/passport/users/getInfo?access_token={}",
        urlencoding::encode(&access_token)
    );

    let response = client
        .get(&user_info_url)
        .send()
        .await
        .map_err(|e| format!("获取用户信息失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取用户信息失败: {}", error_text));
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析用户信息失败: {}", e))?;

    Ok(user_info)
}

/// 获取百度网盘存储配额信息
#[tauri::command]
pub async fn get_baidu_netdisk_quota(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    // 百度网盘获取容量信息的 API
    let quota_url = format!(
        "https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token={}",
        urlencoding::encode(&access_token)
    );

    let response = client
        .get(&quota_url)
        .send()
        .await
        .map_err(|e| format!("获取存储配额失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取存储配额失败: {}", error_text));
    }

    let quota_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析存储配额失败: {}", e))?;

    Ok(quota_info)
}

// ========== 阿里云盘 OAuth 实现 ==========

/// 完成阿里云盘 OAuth 授权（等待回调并交换 token）
/// 阿里云盘支持 PKCE，使用 PKCE 流程增强安全性
#[tauri::command]
pub async fn complete_aliyun_oauth(
    _oauth_state: State<'_, OAuthState>,
) -> Result<OAuthTokens, String> {
    println!("开始阿里云盘 OAuth 授权流程");

    // 启动本地回调服务器
    let (server, port) = start_callback_server()?;
    let redirect_uri = format!("http://127.0.0.1:{}", port);
    println!("本地回调服务器已启动，端口: {}", port);

    // 生成 PKCE 和 state
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state = generate_random_string(32);
    println!("PKCE 参数已生成");

    // 构建授权 URL（阿里云盘支持 PKCE）
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&login_type=default",
        ALIYUN_AUTH_URL,
        urlencoding::encode(ALIYUN_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(ALIYUN_SCOPES),
        urlencoding::encode(&code_challenge),
        urlencoding::encode(&state)
    );
    println!("授权 URL: {}", auth_url);

    // 打开浏览器
    println!("正在打开浏览器...");
    open::that(&auth_url).map_err(|e| format!("无法打开浏览器: {}", e))?;

    // 在阻塞线程池中等待回调（避免阻塞 async runtime）
    println!("等待用户授权...");
    println!("回调 URL: {}", redirect_uri);
    let (code, received_state) = tokio::task::spawn_blocking(move || {
        println!("回调服务器正在监听...");
        let result = wait_for_callback(&server);
        println!("回调服务器收到响应: {:?}", result.is_ok());
        result
    })
    .await
    .map_err(|e| format!("等待回调失败: {}", e))??;

    println!("收到授权码，验证 state...");

    // 验证 state
    if received_state != state {
        return Err("State 验证失败，可能存在 CSRF 攻击".to_string());
    }

    // 交换授权码获取 token（阿里云盘使用 POST 请求，支持 PKCE）
    println!("开始交换授权码获取 token...");
    let client = reqwest::Client::new();
    let token_response = client
        .post(ALIYUN_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("client_id", ALIYUN_CLIENT_ID),
            ("client_secret", ALIYUN_CLIENT_SECRET),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &code_verifier),
        ])
        .send()
        .await
        .map_err(|e| {
            println!("Token 请求发送失败: {}", e);
            format!("Token 请求失败: {}", e)
        })?;

    let status = token_response.status();
    println!("Token 响应状态码: {}", status);

    if !status.is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        println!("Token 请求失败，响应内容: {}", error_text);
        return Err(format!("Token 请求失败 ({}): {}", status, error_text));
    }

    let response_text = token_response.text().await.map_err(|e| {
        println!("读取 token 响应失败: {}", e);
        format!("读取 token 响应失败: {}", e)
    })?;

    println!("Token 响应内容: {}", response_text);

    let tokens: OAuthTokens = serde_json::from_str(&response_text).map_err(|e| {
        println!("解析 token 响应失败: {}", e);
        format!("解析 token 响应失败: {}", e)
    })?;

    println!("成功获取 token！");
    Ok(tokens)
}

/// 刷新阿里云盘 OAuth access token
#[tauri::command]
pub async fn refresh_aliyun_token(refresh_token: String) -> Result<OAuthTokens, String> {
    let client = reqwest::Client::new();
    let token_response = client
        .post(ALIYUN_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", ALIYUN_CLIENT_ID),
            ("client_secret", ALIYUN_CLIENT_SECRET),
        ])
        .send()
        .await
        .map_err(|e| format!("刷新 token 失败: {}", e))?;

    if !token_response.status().is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!("刷新 token 失败: {}", error_text));
    }

    let tokens: OAuthTokens = token_response
        .json()
        .await
        .map_err(|e| format!("解析 token 响应失败: {}", e))?;

    Ok(tokens)
}

/// 撤销阿里云盘 OAuth 授权
#[tauri::command]
pub async fn revoke_aliyun_token(_token: String) -> Result<(), String> {
    // 阿里云盘可能没有标准的撤销端点，这里提供一个占位实现
    println!("阿里云盘 token 撤销（如果支持）");
    Ok(())
}

/// 获取阿里云盘用户信息
#[tauri::command]
pub async fn get_aliyun_user_info(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let user_info_url = "https://openapi.alipan.com/v2/user/get";

    let response = client
        .get(user_info_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("获取用户信息失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取用户信息失败: {}", error_text));
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析用户信息失败: {}", e))?;

    Ok(user_info)
}

/// 获取阿里云盘存储配额信息
#[tauri::command]
pub async fn get_aliyun_drive_quota(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    // 阿里云盘获取容量信息的 API（与用户信息 API 相同）
    let quota_url = "https://openapi.alipan.com/v2/user/get";

    let response = client
        .get(quota_url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("获取存储配额失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取存储配额失败: {}", error_text));
    }

    let quota_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析存储配额失败: {}", e))?;

    Ok(quota_info)
}

// ========== Dropbox OAuth 实现 ==========

/// 完成 Dropbox OAuth 授权（等待回调并交换 token）
/// Dropbox 支持 PKCE，使用 PKCE 流程增强安全性
#[tauri::command]
pub async fn complete_dropbox_oauth(
    _oauth_state: State<'_, OAuthState>,
) -> Result<OAuthTokens, String> {
    println!("开始 Dropbox OAuth 授权流程");

    // 启动本地回调服务器
    let (server, port) = start_callback_server()?;
    let redirect_uri = format!("http://127.0.0.1:{}", port);
    println!("本地回调服务器已启动，端口: {}", port);

    // 生成 PKCE 和 state
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state = generate_random_string(32);
    println!("PKCE 参数已生成");

    // 构建授权 URL（Dropbox 支持 PKCE）
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        DROPBOX_AUTH_URL,
        urlencoding::encode(DROPBOX_CLIENT_ID),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(DROPBOX_SCOPES),
        urlencoding::encode(&code_challenge),
        urlencoding::encode(&state)
    );
    println!("授权 URL: {}", auth_url);

    // 打开浏览器
    println!("正在打开浏览器...");
    open::that(&auth_url).map_err(|e| format!("无法打开浏览器: {}", e))?;

    // 在阻塞线程池中等待回调（避免阻塞 async runtime）
    println!("等待用户授权...");
    println!("回调 URL: {}", redirect_uri);
    let (code, received_state) = tokio::task::spawn_blocking(move || {
        println!("回调服务器正在监听...");
        let result = wait_for_callback(&server);
        println!("回调服务器收到响应: {:?}", result.is_ok());
        result
    })
    .await
    .map_err(|e| format!("等待回调失败: {}", e))??;

    println!("收到授权码，验证 state...");

    // 验证 state
    if received_state != state {
        return Err("State 验证失败，可能存在 CSRF 攻击".to_string());
    }

    // 交换授权码获取 token（Dropbox 使用 Basic Auth，支持 PKCE）
    println!("开始交换授权码获取 token...");
    let client = reqwest::Client::new();
    let token_response = client
        .post(DROPBOX_TOKEN_URL)
        .basic_auth(DROPBOX_CLIENT_ID, Some(DROPBOX_CLIENT_SECRET))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &code_verifier),
        ])
        .send()
        .await
        .map_err(|e| {
            println!("Token 请求发送失败: {}", e);
            format!("Token 请求失败: {}", e)
        })?;

    let status = token_response.status();
    println!("Token 响应状态码: {}", status);

    if !status.is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        println!("Token 请求失败，响应内容: {}", error_text);
        return Err(format!("Token 请求失败 ({}): {}", status, error_text));
    }

    let response_text = token_response.text().await.map_err(|e| {
        println!("读取 token 响应失败: {}", e);
        format!("读取 token 响应失败: {}", e)
    })?;

    println!("Token 响应内容: {}", response_text);

    let tokens: OAuthTokens = serde_json::from_str(&response_text).map_err(|e| {
        println!("解析 token 响应失败: {}", e);
        format!("解析 token 响应失败: {}", e)
    })?;

    println!("成功获取 token！");
    Ok(tokens)
}

/// 刷新 Dropbox OAuth access token
/// 注意：Dropbox 的 refresh token 流程可能需要特殊处理
#[tauri::command]
pub async fn refresh_dropbox_token(refresh_token: String) -> Result<OAuthTokens, String> {
    let client = reqwest::Client::new();
    let token_response = client
        .post(DROPBOX_TOKEN_URL)
        .basic_auth(DROPBOX_CLIENT_ID, Some(DROPBOX_CLIENT_SECRET))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("刷新 token 失败: {}", e))?;

    if !token_response.status().is_success() {
        let error_text = token_response.text().await.unwrap_or_default();
        return Err(format!("刷新 token 失败: {}", error_text));
    }

    let tokens: OAuthTokens = token_response
        .json()
        .await
        .map_err(|e| format!("解析 token 响应失败: {}", e))?;

    Ok(tokens)
}

/// 撤销 Dropbox OAuth 授权
#[tauri::command]
pub async fn revoke_dropbox_token(token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.dropbox.com/2/auth/token/revoke")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("撤销 token 失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("撤销 token 失败: {}", error_text));
    }

    Ok(())
}

/// 获取 Dropbox 用户信息
#[tauri::command]
pub async fn get_dropbox_user_info(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.dropbox.com/2/users/get_current_account")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("获取用户信息失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取用户信息失败: {}", error_text));
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析用户信息失败: {}", e))?;

    Ok(user_info)
}

/// 获取 Dropbox 存储配额信息
#[tauri::command]
pub async fn get_dropbox_quota(access_token: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.dropbox.com/2/users/get_space_usage")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("获取存储配额失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("获取存储配额失败: {}", error_text));
    }

    let quota_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析存储配额失败: {}", e))?;

    Ok(quota_info)
}
