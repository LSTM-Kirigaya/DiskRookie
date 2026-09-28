//! 诊断 MFT record 0 读取与 fixup：以 C 盘为输入，逐步执行并打印反馈，便于定位 corrupt MFT record 0。
//!
//! 需**管理员权限**。运行：
//!   cargo test -p ai-disk-scanner mft_record0_diagnostic -- --nocapture
//!   cargo test -p ai-disk-scanner mft_record0_same_flow_as_app -- --nocapture
//!   cargo test -p ai-disk-scanner mft_scan_volume_mft_with_progress -- --nocapture
//!
//! 指定其他盘（如 F）：
//!   $env:NTFS_VOLUME = 'F'
//!   cargo test -p ai-disk-scanner mft_record0_diagnostic -- --nocapture
//!
//! 修复说明：曾因在消费者循环中对每块做 fixup 再在 from_raw 中二次 fixup，导致部分卷上
//! "corrupt MFT record 0"。现改为仅在 from_raw 中做一次 fixup，消费者仅用 bitmap+is_valid 统计数量。
//!
//! ntfs-reader 0.5 起，裸读、fixup、is_valid、get_record_fs 均不再对外公开（Mft::new 内部
//! 完成，见 CHANGELOG "the modules are private"）。诊断因此改走 Mft::new + Mft::record(0)：
//! 仍能定位「record 0 打不开」这一类问题，但拿不到旧版本那样的字节级细节（signature、USA、
//! 各扇区比对）。

#![cfg(windows)]

use ai_disk_scanner::mft_scan::scan_volume_mft;
use ntfs_reader::{Mft, Volume};

fn volume_path() -> String {
    let drive = std::env::var("NTFS_VOLUME")
        .unwrap_or_else(|_| "C".to_string())
        .trim()
        .to_uppercase();
    let letter = drive.chars().next().unwrap_or('C');
    format!(r"\\.\{}:", letter)
}

#[test]
#[cfg(windows)]
fn mft_record0_diagnostic() {
    let path = volume_path();
    eprintln!("[mft_diag] 卷: {}", path);

    // 1) Volume::new（打开卷、读引导扇区）
    let volume = match Volume::new(path.as_str()) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[mft_diag] Volume::new 失败 (需管理员): {}", e);
            panic!("Volume::new failed");
        }
    };
    eprintln!(
        "[mft_diag] 卷已打开: size={}, file_record_size={}, mft_position={}",
        volume.volume_size(),
        volume.file_record_size(),
        volume.mft_position()
    );

    // 2) Mft::new 一次性完成裸读、fixup、record 0 的解析与校验（is_valid 等价于 record(0)
    // 返回 Some：一个通不过 fixup 或头部校验的 record 0 会让整次加载失败）。
    let mft = match Mft::new(volume) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[mft_diag] Mft::new 失败: {}", e);
            panic!("Mft::new failed");
        }
    };
    eprintln!(
        "[mft_diag] Mft::new 成功: record_count={}, corrupt_records={}",
        mft.record_count(),
        mft.corrupt_records()
    );
    match mft.record(0) {
        Some(_) => eprintln!("[mft_diag] record(0) 有效"),
        None => eprintln!("[mft_diag] record(0) 无效（fixup 或头部校验未通过）"),
    }
    eprintln!("[mft_diag] ---------- 诊断结束 ----------");
}

/// 在独立线程中执行与 scan_volume_mft 相同的打开+加载流程，迭代多次以观察是否偶发失败。
/// 模拟 Tauri 的 spawn_blocking 场景。
#[test]
#[cfg(windows)]
fn mft_record0_same_flow_as_app() {
    let path = volume_path();
    eprintln!("[mft_app_flow] 卷: {} (迭代 5 次，模拟 app 流程)", path);

    for iter in 0..5 {
        eprintln!("[mft_app_flow] ---------- iter {} ----------", iter);
        let path_clone = path.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let handle = std::thread::spawn(move || {
            let volume = match Volume::new(path_clone.as_str()) {
                Ok(v) => v,
                Err(e) => {
                    let _ = tx.send(Err(format!("Volume::new: {}", e)));
                    return;
                }
            };
            eprintln!(
                "[mft_app_flow] iter {} volume opened: {} bytes",
                iter,
                volume.volume_size()
            );

            match Mft::new(volume) {
                Ok(mft) => {
                    eprintln!(
                        "[mft_app_flow] iter {} Mft::new 成功, record_count={}",
                        iter,
                        mft.record_count()
                    );
                    let _ = tx.send(Ok(()));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Mft::new: {}", e)));
                }
            }
        });

        let result = rx.recv().expect("thread must send once");
        if let Err(e) = result {
            let _ = handle.join();
            panic!("iter {} failed: {}", iter, e);
        }
        if handle.join().is_err() {
            panic!("iter {} thread panicked", iter);
        }
    }
    eprintln!("[mft_app_flow] ---------- 5 次迭代均成功 ----------");
}

/// 直接调用 scan_volume_mft（与 app 相同入口），带 progress，迭代 2 次。
#[test]
#[cfg(windows)]
fn mft_scan_volume_mft_with_progress() {
    let path = volume_path();
    let path_str = format!(
        "{}:\\",
        path.trim_end_matches(':').trim_start_matches(r"\\.\")
    );
    eprintln!(
        "[mft_scan] 调用 scan_volume_mft({:?}, progress, true) 共 2 次",
        path_str
    );

    let progress = std::sync::Arc::new(Box::new(|count: u64, msg: &str| {
        eprintln!("[mft_scan] progress: {} | {}", count, msg);
    }) as Box<dyn Fn(u64, &str) + Send + Sync>);

    for iter in 0..2 {
        eprintln!("[mft_scan] ---------- iter {} ----------", iter);
        match scan_volume_mft(path_str.as_str(), Some(progress.clone()), true) {
            Ok(result) => eprintln!(
                "[mft_scan] iter {} 成功: file_count={}",
                iter, result.file_count
            ),
            Err(e) => panic!("[mft_scan] iter {} 失败: {}", iter, e),
        }
    }
    eprintln!("[mft_scan] ---------- 2 次 scan_volume_mft 均成功 ----------");
}
