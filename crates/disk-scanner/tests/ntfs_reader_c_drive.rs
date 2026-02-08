//! 使用 ntfs-reader 读取 NTFS 卷基本信息的极小示例。
//!
//! 仅 Windows 下运行，且需**管理员权限**（否则 Volume::new 会失败）。
//!
//! 运行（默认 C 盘）：
//!   cargo test -p ai-disk-scanner ntfs_reader_c_drive_basic_info -- --nocapture
//!
//! 指定 F 盘（PowerShell）：
//!   $env:NTFS_VOLUME = 'F'
//!   cargo test -p ai-disk-scanner ntfs_reader_c_drive_basic_info -- --nocapture
//!
//! 仅卷信息、不加载 MFT（大卷如 F 盘可加快完成）：
//!   $env:NTFS_VOLUME = 'F'; $env:NTFS_VOLUME_INFO_ONLY = '1'
//!   cargo test -p ai-disk-scanner ntfs_reader_c_drive_basic_info -- --nocapture

#![cfg(windows)]

use ntfs_reader::mft::Mft;
use ntfs_reader::volume::Volume;

fn volume_path() -> (String, String) {
    let drive = std::env::var("NTFS_VOLUME")
        .unwrap_or_else(|_| "C".to_string())
        .trim()
        .to_uppercase();
    let letter = drive.chars().next().unwrap_or('C');
    let path = format!(r"\\.\{}:", letter);
    let label = format!("{} 盘", letter);
    (path, label)
}

#[test]
#[cfg(windows)]
fn ntfs_reader_c_drive_basic_info() {
    let (volume_path, label) = volume_path();
    eprintln!("[ntfs_reader] 目标卷: {} ({})", label, volume_path);

    let volume = match Volume::new(volume_path.as_str()) {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[ntfs_reader] 无法打开 {} (需管理员权限): {}",
                label, e
            );
            return;
        }
    };

    eprintln!("[ntfs_reader] ---------- {} 卷信息 ----------", label);
    eprintln!("  卷路径: {:?}", volume.path);
    eprintln!("  卷大小: {} 字节 ({:.2} GiB)", volume.volume_size, volume.volume_size as f64 / (1024f64.powi(3)));
    eprintln!("  簇大小: {} 字节", volume.cluster_size);
    eprintln!("  文件记录大小: {} 字节", volume.file_record_size);
    eprintln!("  MFT 位置: {} 字节", volume.mft_position);

    let only_volume_info = std::env::var("NTFS_VOLUME_INFO_ONLY")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if only_volume_info {
        eprintln!("[ntfs_reader] NTFS_VOLUME_INFO_ONLY=1，跳过 MFT 加载");
        eprintln!("[ntfs_reader] ---------- 完成 ----------");
        return;
    }

    let mft = match Mft::new(volume) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[ntfs_reader] 无法打开 MFT: {}", e);
            return;
        }
    };

    eprintln!("[ntfs_reader] ---------- MFT 信息 ----------");
    eprintln!("  MFT 最大记录数: {}", mft.max_record);
    eprintln!("  MFT 数据长度: {} 字节", mft.data.len());
    eprintln!("  位图长度: {} 字节", mft.bitmap.len());
    eprintln!("[ntfs_reader] ---------- 完成 ----------");
}
