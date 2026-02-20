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

#![cfg(windows)]

use std::io::{Read, Seek, SeekFrom};

use ai_disk_scanner::mft_scan::scan_volume_mft;
use ntfs_reader::api::SECTOR_SIZE;
use ntfs_reader::mft::Mft;
use ntfs_reader::volume::Volume;

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
        volume.volume_size, volume.file_record_size, volume.mft_position
    );

    // 2) open_volume（再次打开，得到 reader）
    let mut reader = match ntfs_reader::aligned_reader::open_volume(volume.path.as_path()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[mft_diag] open_volume 失败: {}", e);
            panic!("open_volume failed");
        }
    };
    eprintln!("[mft_diag] open_volume 成功");

    // 3) 裸读：seek + read file_record_size 字节
    let rs = volume.file_record_size as usize;
    let mut data = vec![0u8; rs];
    if let Err(e) = reader.seek(SeekFrom::Start(volume.mft_position)) {
        eprintln!("[mft_diag] seek(mft_position) 失败: {}", e);
        panic!("seek failed");
    }
    eprintln!("[mft_diag] seek({}) 成功", volume.mft_position);
    if let Err(e) = reader.read_exact(&mut data) {
        eprintln!("[mft_diag] read_exact({} bytes) 失败: {}", rs, e);
        panic!("read_exact failed");
    }
    eprintln!("[mft_diag] 读取 {} 字节成功", rs);

    // 4) 打印前 64 字节（signature、USA 等）（packed 需拷贝到局部再打印）
    let usn_start = u16::from_le_bytes([data[4], data[5]]) as usize;
    let update_sequence_length = u16::from_le_bytes([data[6], data[7]]) as usize;
    eprintln!(
        "[mft_diag] 前 4 字节 (signature): {:?} (期望 FILE)",
        &data[0..4]
    );
    eprintln!("[mft_diag] update_sequence_offset: {}", usn_start);
    eprintln!(
        "[mft_diag] update_sequence_length: {}",
        update_sequence_length
    );
    let usa_start = usn_start + 2;
    let usa_end = usn_start.saturating_add(update_sequence_length.saturating_mul(2));
    eprintln!("[mft_diag] usa 范围: [{}..{})", usa_start, usa_end);
    if usa_end <= data.len() {
        eprintln!(
            "[mft_diag] USA 字节 (前 4 个): {:02x} {:02x} ...",
            data[usn_start],
            data[usn_start + 1]
        );
    }
    // 每个 512 字节扇区末尾 2 字节应与 USA 匹配
    eprintln!("[mft_diag] 各扇区末尾 2 字节 vs USA:");
    let usn0 = if usn_start + 2 <= data.len() {
        data[usn_start]
    } else {
        0
    };
    let usn1 = if usn_start + 2 <= data.len() {
        data[usn_start + 1]
    } else {
        0
    };
    let mut sector_off = SECTOR_SIZE - 2;
    let mut idx = 0;
    while sector_off + 2 <= data.len() && idx < (usa_end.saturating_sub(usa_start) / 2) {
        let d0 = data[sector_off];
        let d1 = data[sector_off + 1];
        let ok = d0 == usn0 && d1 == usn1;
        eprintln!(
            "[mft_diag]   sector {} (offset {}): {:02x} {:02x}  match={}",
            idx, sector_off, d0, d1, ok
        );
        sector_off += SECTOR_SIZE;
        idx += 1;
    }

    // 5) is_valid
    let valid = ntfs_reader::file::NtfsFile::is_valid(&data);
    eprintln!("[mft_diag] NtfsFile::is_valid: {}", valid);
    if !valid {
        eprintln!("[mft_diag] 因 is_valid 为 false，get_record_fs 会返回 InvalidMftRecord");
    }

    // 6) fixup_record
    let fixup_result = Mft::fixup_record(0, &mut data);
    match &fixup_result {
        Ok(()) => eprintln!("[mft_diag] fixup_record(0) 成功"),
        Err(e) => eprintln!("[mft_diag] fixup_record(0) 失败: {}", e),
    }
    if fixup_result.is_err() {
        panic!("fixup failed");
    }

    // 7) 与 Mft::get_record_fs 对比（同一 reader 已移动，需重新打开）
    drop(reader);
    let mut reader2 =
        ntfs_reader::aligned_reader::open_volume(volume.path.as_path()).expect("open again");
    let record = Mft::get_record_fs(
        &mut reader2,
        volume.file_record_size as usize,
        volume.mft_position,
    );
    match &record {
        Ok(_) => eprintln!("[mft_diag] Mft::get_record_fs 成功"),
        Err(e) => eprintln!("[mft_diag] Mft::get_record_fs 失败: {}", e),
    }
    eprintln!("[mft_diag] ---------- 诊断结束 ----------");
}

/// 在独立线程中执行与 scan_volume_mft 相同的打开+读 record 0 流程，迭代多次以观察是否偶发失败。
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
                iter, volume.volume_size
            );

            let mut reader = match ntfs_reader::aligned_reader::open_volume(volume.path.as_path()) {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(Err(format!("open_volume: {}", e)));
                    return;
                }
            };
            match Mft::get_record_fs(
                &mut reader,
                volume.file_record_size as usize,
                volume.mft_position,
            ) {
                Ok(record) => {
                    eprintln!(
                        "[mft_app_flow] iter {} get_record_fs 成功, len={}",
                        iter,
                        record.len()
                    );
                    let _ = tx.send(Ok(()));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("get_record_fs: {}", e)));
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
