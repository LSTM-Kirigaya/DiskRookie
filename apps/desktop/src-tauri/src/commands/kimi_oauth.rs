//! Kimi Code OAuth — Device Code Flow (`auth.kimi.com`).
//! User-Agent must match Kimi CLI pattern to avoid 403.

use serde::Serialize;

const KIMI_CODE_CLIENT_ID: &str = "17e5f671-d194-4dfb-9706-5516cb48c098";
const DEFAULT_OAUTH_HOST: &str = "https://auth.kimi.com";

fn kimi_user_agent() -> String {
    format!("KimiCLI/{}", env!("CARGO_PKG_VERSION"))
}

fn kimi_headers() -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    if let Ok(v) = reqwest::header::HeaderValue::from_str(&kimi_user_agent()) {
        h.insert(reqwest::header::USER_AGENT, v);
    }
    h.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    h.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/x-www-form-urlencoded"),
    );
    h
}

/// POST /api/oauth/device_authorization — returns JSON from Kimi (user_code, device_code, verification_uri_complete, …).
#[tauri::command]
pub async fn kimi_code_request_device() -> Result<serde_json::Value, String> {
    let url = format!(
        "{}/api/oauth/device_authorization",
        DEFAULT_OAUTH_HOST.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .headers(kimi_headers())
        .form(&[("client_id", KIMI_CODE_CLIENT_ID)])
        .send()
        .await
        .map_err(|e| format!("请求设备授权失败: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::json!({ "raw": text }));

    if !status.is_success() {
        return Err(format!(
            "device_authorization HTTP {}: {}",
            status.as_u16(),
            body
        ));
    }

    Ok(body)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiPollTokenResult {
    pub status: u16,
    pub body: serde_json::Value,
}

/// POST /api/oauth/token — poll until access_token (frontend loops). Non-2xx still returns body for authorization_pending etc.
#[tauri::command]
pub async fn kimi_code_poll_token(device_code: String) -> Result<KimiPollTokenResult, String> {
    let url = format!(
        "{}/api/oauth/token",
        DEFAULT_OAUTH_HOST.trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .headers(kimi_headers())
        .form(&[
            ("client_id", KIMI_CODE_CLIENT_ID),
            ("device_code", &device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("轮询 token 失败: {}", e))?;

    let status = res.status().as_u16();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let body: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::json!({ "raw": text }));

    Ok(KimiPollTokenResult { status, body })
}
