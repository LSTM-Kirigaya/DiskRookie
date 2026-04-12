/**
 * 使用 Tauri HTTP 插件发起请求，走 Rust 端网络栈，不受 WebView 同源策略（CORS）限制。
 * 外部 LLM API（如 Kimi）未对 http://localhost:5173 返回 CORS 头时，浏览器 fetch 会报 “Load failed”。
 */
export { fetch as httpFetch } from '@tauri-apps/plugin-http'
