//! 在 Tauri/GUI、无控制台或 stderr 管道已关闭时，默认 panic hook 用 `eprintln!` 可能触发
//! **二次 panic**（`failed printing to stderr: Broken pipe`）。此处改为忽略写入错误。

use std::io::Write;
use std::panic::PanicHookInfo;

pub fn install_broken_pipe_safe_panic_hook() {
    std::panic::set_hook(Box::new(panic_hook_impl));
}

fn panic_hook_impl(info: &PanicHookInfo<'_>) {
    let _ = writeln!(
        std::io::stderr(),
        "thread panicked: {}",
        info_to_string(info)
    );
}

fn info_to_string(info: &PanicHookInfo<'_>) -> String {
    let payload = info.payload();
    let msg = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "Box<dyn Any>".to_string()
    };
    match info.location() {
        Some(loc) => format!("{} at {}:{}:{}", msg, loc.file(), loc.line(), loc.column()),
        None => msg,
    }
}
