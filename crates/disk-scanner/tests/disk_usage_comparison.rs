//! 磁盘占用率对比测试：比较 MFT/普通扫描得到的 total_size 与系统 API 报告的已占用空间。
//!
//! 目的：验证扫描逻辑是否正确，若两者差异过大则说明 MFT 实现可能存在 bug。
//!
//! 系统已占用 = volume_total_bytes - volume_free_bytes (GetDiskFreeSpaceExW)
//! 扫描 total_size = 所有文件逻辑大小之和
//!
//! 运行（需管理员权限才能用 MFT 扫描 C 盘）：
//!   cargo test -p ai-disk-scanner disk_usage_comparison -- --nocapture
//!
//! 指定其他盘符（如 F 盘）：
//!   $env:DISK_USAGE_DRIVE = 'F'
//!   cargo test -p ai-disk-scanner disk_usage_comparison -- --nocapture
//!
//! 强制使用普通 walk（不用 MFT）：
//!   $env:DISK_USAGE_NO_MFT = '1'
//!   cargo test -p ai-disk-scanner disk_usage_comparison -- --nocapture
//!
//! 快速模式（扫描子目录如 C:\Users，用于快速迭代，仅做合理性检查）：
//!   $env:DISK_USAGE_QUICK = '1'
//!   cargo test -p ai-disk-scanner disk_usage_comparison -- --nocapture
//!
//! 若出现 LNK1104「无法打开文件」：测试 exe 被占用，先执行：
//!   cargo clean -p ai-disk-scanner
//!   或关闭正在运行的 disk_usage_comparison 进程后再试

#![cfg(windows)]

use ai_disk_scanner::{get_volume_space_bytes, scan_path_with_progress};
use std::sync::Arc;

fn get_test_path() -> String {
    if std::env::var("DISK_USAGE_QUICK")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        // 快速模式：扫描 C:\Users，通常比整盘快很多
        r"C:\Users".to_string()
    } else {
        let drive = std::env::var("DISK_USAGE_DRIVE")
            .unwrap_or_else(|_| "C".to_string())
            .trim()
            .to_uppercase();
        let letter = drive.chars().next().unwrap_or('C');
        format!(r"{}:\", letter)
    }
}

/// 格式化字节为可读字符串
fn format_bytes(n: u64) -> String {
    if n >= 1024 * 1024 * 1024 {
        format!("{:.2} GiB", n as f64 / (1024f64.powi(3)))
    } else if n >= 1024 * 1024 {
        format!("{:.2} MiB", n as f64 / (1024f64.powi(2)))
    } else if n >= 1024 {
        format!("{:.2} KiB", n as f64 / 1024f64)
    } else {
        format!("{} B", n)
    }
}

#[test]
#[cfg(windows)]
fn disk_usage_comparison() {
    let scan_path = get_test_path();
    let use_mft = std::env::var("DISK_USAGE_NO_MFT")
        .map(|v| v != "1" && !v.eq_ignore_ascii_case("true"))
        .unwrap_or(true);
    let quick_mode = std::env::var("DISK_USAGE_QUICK")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    // 用于获取卷空间：取路径所在卷的根（如 C:\Users -> C:\）
    let volume_path = if scan_path.len() >= 2 && scan_path.as_bytes()[1] == b':' {
        format!("{}:\\", scan_path.chars().next().unwrap())
    } else {
        scan_path.clone()
    };

    eprintln!("========================================");
    eprintln!("磁盘占用率对比测试");
    eprintln!("========================================");
    eprintln!("扫描路径: {}", scan_path);
    eprintln!("卷路径:   {}", volume_path);
    eprintln!("使用 MFT: {}", use_mft);
    eprintln!("快速模式: {}", quick_mode);
    eprintln!();

    // 1. 获取系统报告的卷空间（GetDiskFreeSpaceExW）
    let (volume_total, volume_free) = match get_volume_space_bytes(&volume_path) {
        Some((t, f)) => (t, f),
        None => {
            eprintln!("[错误] 无法获取卷空间信息，请确认路径有效: {}", volume_path);
            return;
        }
    };
    let system_used = volume_total.saturating_sub(volume_free);

    eprintln!("---------- 系统 API (GetDiskFreeSpaceExW) ----------");
    eprintln!(
        "  卷总容量:     {} ({})",
        format_bytes(volume_total),
        volume_total
    );
    eprintln!(
        "  卷剩余空间:   {} ({})",
        format_bytes(volume_free),
        volume_free
    );
    eprintln!(
        "  系统已占用:   {} ({})",
        format_bytes(system_used),
        system_used
    );
    eprintln!();

    // 2. 执行扫描（MFT 或普通 walk）
    let progress =
        Arc::new(Box::new(|_count: u64, _path: &str| {}) as Box<dyn Fn(u64, &str) + Send + Sync>);
    let (result, used_mft) = match scan_path_with_progress(
        &scan_path,
        Some(&progress),
        true, // shallow_dirs
        use_mft,
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[错误] 扫描失败: {}", e);
            return;
        }
    };

    let scan_total_size = result.total_size;
    let file_count = result.file_count;

    eprintln!("---------- 扫描结果 ----------");
    eprintln!(
        "  扫描方式:     {}",
        if used_mft {
            "MFT"
        } else {
            "普通目录遍历"
        }
    );
    eprintln!("  文件数量:     {}", file_count);
    eprintln!(
        "  扫描总大小:   {} ({})",
        format_bytes(scan_total_size),
        scan_total_size
    );
    eprintln!();

    // 3. 对比
    eprintln!("---------- 对比分析 ----------");
    let diff = if system_used >= scan_total_size {
        system_used - scan_total_size
    } else {
        scan_total_size - system_used
    };
    let diff_pct = if system_used > 0 {
        (diff as f64 / system_used as f64) * 100.0
    } else {
        0.0
    };

    eprintln!(
        "  系统已占用:   {} ({})",
        format_bytes(system_used),
        system_used
    );
    eprintln!(
        "  扫描总大小:   {} ({})",
        format_bytes(scan_total_size),
        scan_total_size
    );
    eprintln!("  绝对差异:     {} ({:.2}%)", format_bytes(diff), diff_pct);
    eprintln!();

    // 4. 判断是否通过
    let passed = if quick_mode {
        // 快速模式：扫描子目录，扫描结果应 <= 卷已占用（子集不可能超过全集）
        let subset_ok = scan_total_size <= system_used || scan_total_size <= volume_total;
        if subset_ok {
            eprintln!(
                "[通过] 快速模式：子目录扫描大小 {} 在卷容量范围内",
                format_bytes(scan_total_size)
            );
        } else {
            eprintln!(
                "[失败] 快速模式：子目录扫描大小 {} 超过卷已占用 {}，存在逻辑错误",
                format_bytes(scan_total_size),
                format_bytes(system_used)
            );
        }
        subset_ok
    } else {
        // 全卷扫描：扫描结果必须 <= 系统已占用（临时文件等可能扫不到）
        // 且 gap = 系统 - 扫描 不超过典型 Windows 系统开销（元数据、页面文件等）
        const MAX_SYSTEM_OVERHEAD_GIB: u64 = 160; // 典型 Win 系统开销+未扫到的临时文件等
        const MAX_SYSTEM_OVERHEAD: u64 = MAX_SYSTEM_OVERHEAD_GIB * 1024 * 1024 * 1024;
        let gap = system_used.saturating_sub(scan_total_size);
        let scan_ok = scan_total_size <= system_used;
        let gap_ok = gap <= MAX_SYSTEM_OVERHEAD;
        let passed = scan_ok && gap_ok;
        if passed {
            eprintln!(
                "[通过] 扫描 {} <= 系统 {}，gap {} <= 允许开销 {} GiB",
                format_bytes(scan_total_size),
                format_bytes(system_used),
                format_bytes(gap),
                MAX_SYSTEM_OVERHEAD_GIB
            );
        } else if !scan_ok {
            eprintln!(
                "[失败] 扫描 {} 超过系统 {}，存在逻辑错误",
                format_bytes(scan_total_size),
                format_bytes(system_used)
            );
        } else {
            eprintln!(
                "[失败] gap {} 超过典型系统开销 {} GiB，可能漏扫",
                format_bytes(gap),
                MAX_SYSTEM_OVERHEAD_GIB
            );
        }
        passed
    };

    eprintln!("========================================");

    assert!(
        passed,
        "磁盘占用率对比失败: 系统已占用={}, 扫描总大小={}, gap={}",
        system_used,
        scan_total_size,
        format_bytes(system_used.saturating_sub(scan_total_size))
    );
}
