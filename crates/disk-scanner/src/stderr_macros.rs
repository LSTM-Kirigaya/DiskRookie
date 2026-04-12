//! `eprintln!` 在 stderr 已关闭时（Tauri/GUI、`| head` 等）会因 Broken pipe  panic；
//! 此处用 `writeln!` 并忽略错误，避免扫描任务线程崩溃。

macro_rules! stderr_ln {
    ($($arg:tt)*) => {{
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), $($arg)*);
    }};
}
