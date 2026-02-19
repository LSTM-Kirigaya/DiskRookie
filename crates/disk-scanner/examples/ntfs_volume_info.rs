//! 获取 NTFS 卷信息（MFT 起始位置等）。
//!
//! ## 如何启动
//!
//! 1. **必须以管理员身份运行**（否则打开卷会失败）。
//! 2. 在项目根目录执行：
//!
//!        cargo run -p ai-disk-scanner --example ntfs_volume_info
//!
//! 3. 指定其他盘符（需改源码中的 `r"\\.\C:"` 为 `r"\\.\D:"` 等），或通过环境变量（本示例默认 C:）：
//!
//!        $env:NTFS_VOLUME_DRIVE = "D"
//!        cargo run -p ai-disk-scanner --example ntfs_volume_info
//!
//! 输出示例：
//!
//!        --- NTFS 卷信息 ---
//!        序列号: ...
//!        MFT 起始簇 (LCN): ...
//!        每个簇的字节数: ...
//!        MFT 磁盘物理偏移量: ... 字节

#[cfg(not(windows))]
fn main() {
    eprintln!("This example only works on Windows (NTFS).");
}

#[cfg(windows)]
mod ntfs {
    use std::mem;
    use std::ptr::null_mut;

    use windows_sys::Win32::Foundation::*;
    use windows_sys::Win32::Storage::FileSystem::*;
    use windows_sys::Win32::System::Ioctl::*;
    use windows_sys::Win32::System::IO::DeviceIoControl;

    /// 与 winioctl.h NTFS_VOLUME_DATA_BUFFER 布局一致
    #[repr(C)]
    struct NtfsVolumeDataBuffer {
        volume_serial_number: i64,
        number_sectors: i64,
        total_clusters: i64,
        free_clusters: i64,
        total_reserved: i64,
        bytes_per_sector: u32,
        bytes_per_cluster: u32,
        bytes_per_file_record_segment: u32,
        clusters_per_file_record_segment: u32,
        mft_valid_data_length: i64,
        mft_start_lcn: i64,
        mft2_start_lcn: i64,
        mft_zone_start: i64,
        mft_zone_end: i64,
    }

    pub fn run() {
        let drive_letter = std::env::var("NTFS_VOLUME_DRIVE").unwrap_or_else(|_| "C".to_string());
        let drive_letter = drive_letter.trim().trim_end_matches(':');
        let volume_path = format!(r"\\.\{}:", drive_letter);

        unsafe {
            // 1. 打开卷句柄（必须管理员权限）
            let drive = volume_path
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<u16>>();
            let handle = CreateFileW(
                drive.as_ptr(),
                GENERIC_READ,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                null_mut(),
                OPEN_EXISTING,
                0, // FILE_ATTRIBUTE_NORMAL
                0,
            );

            if handle == INVALID_HANDLE_VALUE {
                let err = std::io::Error::last_os_error();
                eprintln!(
                    "打开卷失败！请检查管理员权限。卷: {} 错误: {}",
                    volume_path, err
                );
                std::process::exit(1);
            }

            // 2. 准备接收 NTFS 卷数据的结构体
            // NTFS_VOLUME_DATA_BUFFER 包含了 MFT 的起始逻辑簇号 (LCN)
            let mut volume_data: NtfsVolumeDataBuffer = mem::zeroed();
            let mut bytes_returned = 0u32;

            let success = DeviceIoControl(
                handle,
                FSCTL_GET_NTFS_VOLUME_DATA,
                null_mut(),
                0,
                &mut volume_data as *mut _ as *mut _,
                mem::size_of::<NtfsVolumeDataBuffer>() as u32,
                &mut bytes_returned,
                null_mut(),
            );

            if success != 0 {
                println!("--- NTFS 卷信息 ---");
                println!("卷: {}", volume_path);
                println!("序列号: {:X}", volume_data.volume_serial_number);
                println!("MFT 起始簇 (LCN): {}", volume_data.mft_start_lcn);
                println!("每个簇的字节数: {}", volume_data.bytes_per_cluster);

                // 计算 MFT 的物理偏移量
                let mft_offset = volume_data.mft_start_lcn * volume_data.bytes_per_cluster as i64;
                println!("MFT 磁盘物理偏移量: {} 字节", mft_offset);
            } else {
                let err = std::io::Error::last_os_error();
                eprintln!("获取卷数据失败，错误: {}", err);
                std::process::exit(1);
            }

            CloseHandle(handle);
        }
    }
}

#[cfg(windows)]
fn main() {
    ntfs::run();
}
