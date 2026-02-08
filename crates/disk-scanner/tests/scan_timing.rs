//! 扫描耗时测试：对指定卷（**默认 F 盘** `F:\`）分别使用 MFT 与普通遍历扫描，统计并输出耗时。
//!
//! - **MFT 扫描**：使用已实现的 `scan_path_with_progress(..., use_mft: true)`（卷根时走 MFT，需管理员权限）。
//! - **普通扫描**：使用已实现的 `scan_path_with_progress(..., use_mft: false)`（目录递归遍历）。
//!
//! 仅 Windows 下运行。**必须加 `--nocapture` 才能看到耗时输出。**
//!
//! 运行（默认扫 F:\）：
//!   cargo test -p ai-disk-scanner scan_timing_mft_vs_normal -- --nocapture
//!
//! 指定其他盘符（PowerShell 用单引号）：
//!   $env:SCAN_PATH = 'C:\'
//!   cargo test -p ai-disk-scanner scan_timing_mft_vs_normal -- --nocapture
//!
//! 仅跑 MFT 并统计时间、跳过普通扫描（适合无管理员或盘很大时快速看 MFT 耗时）：
//!   $env:SCAN_NORMAL = '0'
//!   cargo test -p ai-disk-scanner scan_timing_mft_vs_normal -- --nocapture
//!
//! 查找损坏/无法读取的路径：
//!   cargo test -p ai-disk-scanner find_bad_paths -- --nocapture
//!
//! 分别在 C 盘与 F 盘上跑 MFT 扫描并输出耗时（同一测试顺序跑 C: 再 F:）：
//!   cargo test -p ai-disk-scanner scan_timing_c_and_f -- --nocapture
//!
//! 查看 C 盘 MFT 扫描各阶段耗时（获取 MFT / 枚举 / 建树）及可并行化建议：
//!   $env:MFT_TIMING = '1'; $env:SCAN_PATH = 'C:\'; $env:SCAN_NORMAL = '0'
//!   cargo test -p ai-disk-scanner scan_timing_mft_vs_normal -- --nocapture
//!
//! C 盘与 F 盘：MFT（多线程优化）vs 普通扫描 对比耗时（耗时长，建议 15 分钟以上超时）：
//!   cargo test -p ai-disk-scanner scan_timing_mft_vs_normal_c_and_f -- --nocapture
//!
//! 仅取「前 500 大文件」：C/F 盘下 MFT(top500) vs 普通扫描(全盘后取 top500)，输出表格：
//!   cargo test -p ai-disk-scanner scan_timing_top500_c_and_f -- --nocapture

use std::fs;
use std::path::Path;
use std::time::Instant;

use ai_disk_scanner::{scan_path_with_progress, scan_volume_mft_top_files, FileNode, ScanResult};

/// 默认扫描盘符：F 盘
const DEFAULT_SCAN_PATH: &str = "F:\\";

fn scan_path() -> String {
    let from_env = std::env::var("SCAN_PATH").unwrap_or_else(|_| String::new());
    let s = from_env.trim();
    if s.is_empty() {
        return DEFAULT_SCAN_PATH.to_string();
    }
    let s = s.replace('/', "\\").trim_end_matches('\\').to_string();
    // 仅为盘符时补根，如 "F:" -> "F:\"
    if s.len() == 2 && s.as_bytes()[0].is_ascii_alphabetic() && s.as_bytes()[1] == b':' {
        return format!("{}\\", s);
    }
    s
}

#[test]
#[cfg(windows)]
fn scan_timing_mft_vs_normal() {
    let path = scan_path();
    if let Ok(v) = std::env::var("SCAN_PATH") {
        eprintln!("[scan_timing] SCAN_PATH env: {:?}", v);
    }
    eprintln!("[scan_timing] path: {:?} {}", path, if path == DEFAULT_SCAN_PATH { "(default F:)" } else { "" });
    if !Path::new(&path).exists() {
        eprintln!("[scan_timing] path does not exist, skipping test");
        return;
    }
    eprintln!("[scan_timing] ----------------------------------------");

    // 1) 使用 MFT 扫描
    let t0 = Instant::now();
    let result_mft = scan_path_with_progress(&path, None, true, true);
    let elapsed_mft = t0.elapsed();

    match &result_mft {
        Ok((r, used_mft)) => {
            let ms = elapsed_mft.as_millis();
            eprintln!(
                "[scan_timing] MFT scan: done, used_mft={}, file_count={}, elapsed={} ms ({:.2} s)",
                used_mft,
                r.file_count,
                ms,
                elapsed_mft.as_secs_f64()
            );
        }
        Err(e) => {
            eprintln!("[scan_timing] MFT scan: failed, elapsed={:?}, error={}", elapsed_mft, e);
        }
    }

    eprintln!("[scan_timing] ----------------------------------------");

    // 2) 不使用 MFT（普通目录遍历，使用现有 scan_path_with_progress）
    let run_normal = std::env::var("SCAN_NORMAL").map_or(true, |v| v != "0" && v != "false");
    let (result_normal, elapsed_normal) = if run_normal {
        let t1 = Instant::now();
        let res = scan_path_with_progress(&path, None, true, false);
        let elapsed = t1.elapsed();
        match &res {
            Ok((r, _)) => {
                let ms = elapsed.as_millis();
                eprintln!(
                    "[scan_timing] normal walk: done, file_count={}, elapsed={} ms ({:.2} s)",
                    r.file_count,
                    ms,
                    elapsed.as_secs_f64()
                );
            }
            Err(e) => {
                eprintln!(
                    "[scan_timing] normal walk: failed, elapsed={:?}, error={}",
                    elapsed, e
                );
            }
        }
        eprintln!("[scan_timing] ----------------------------------------");
        (res, elapsed)
    } else {
        eprintln!("[scan_timing] SCAN_NORMAL=0 set, skipping normal scan");
        eprintln!("[scan_timing] ----------------------------------------");
        (
            Ok((
                ScanResult {
                    root: FileNode {
                        path: String::new(),
                        name: String::new(),
                        size: 0,
                        is_dir: true,
                        modified: None,
                        children: vec![],
                    },
                    scan_time_ms: 0,
                    file_count: 0,
                    total_size: 0,
                    scan_warning: None,
                    volume_total_bytes: None,
                    volume_free_bytes: None,
                },
                false,
            )),
            std::time::Duration::ZERO,
        )
    };

    // 3) 汇总（有成功结果时才算比例）
    let (ms_mft, ms_normal) = (elapsed_mft.as_millis(), elapsed_normal.as_millis());
    if result_mft.is_ok() && result_normal.is_ok() && run_normal {
        if ms_normal > 0 {
            let ratio = ms_mft as f64 / ms_normal as f64;
            eprintln!(
                "[scan_timing] summary: MFT={} ms, normal={} ms, ratio(MFT/normal)={:.2}",
                ms_mft, ms_normal, ratio
            );
        } else {
            eprintln!("[scan_timing] summary: MFT={} ms, normal={} ms", ms_mft, ms_normal);
        }
    } else if result_mft.is_ok() && !run_normal {
        eprintln!("[scan_timing] summary: MFT elapsed={} ms ({:.2} s)", ms_mft, elapsed_mft.as_secs_f64());
    } else if result_mft.is_err() && result_normal.is_err() && run_normal {
        eprintln!("[scan_timing] summary: both scans failed, see errors above; test skips assert");
    }

    // 不因扫描异常而让测试失败：仅作耗时统计，遇到异常已输出并继续
}

/// 分别在 C 盘与 F 盘上执行 MFT 扫描，输出各自耗时（与标准模式一致的文件结构）。
#[test]
#[cfg(windows)]
fn scan_timing_c_and_f() {
    let paths = ["C:\\", "F:\\"];
    let mut results: Vec<(String, Option<u64>, Option<String>)> = Vec::new();

    for path in &paths {
        if !Path::new(path).exists() {
            eprintln!("[scan_timing_c_and_f] {} 不存在，跳过", path);
            results.push((path.to_string(), None, Some("路径不存在".to_string())));
            continue;
        }
        eprintln!("[scan_timing_c_and_f] ---------- {} ----------", path);
        let t0 = std::time::Instant::now();
        let res = scan_path_with_progress(path, None, true, true);
        let elapsed_ms = t0.elapsed().as_millis();
        match &res {
            Ok((r, used_mft)) => {
                eprintln!(
                    "[scan_timing_c_and_f] {} MFT={} file_count={} total_size={} elapsed={} ms ({:.2} s)",
                    path,
                    used_mft,
                    r.file_count,
                    r.total_size,
                    elapsed_ms,
                    t0.elapsed().as_secs_f64()
                );
                results.push((path.to_string(), Some(elapsed_ms as u64), None));
            }
            Err(e) => {
                eprintln!("[scan_timing_c_and_f] {} 失败: {} (elapsed={} ms)", path, e, elapsed_ms);
                results.push((path.to_string(), None, Some(e.to_string())));
            }
        }
    }

    eprintln!("[scan_timing_c_and_f] ---------- 汇总 ----------");
    for (path, ms, err) in &results {
        match (ms, err) {
            (Some(ms), None) => {
                eprintln!("[scan_timing_c_and_f] {} 耗时: {} ms ({:.2} s)", path, ms, *ms as f64 / 1000.0);
            }
            (_, Some(e)) => {
                eprintln!("[scan_timing_c_and_f] {} 失败: {}", path, e);
            }
            _ => {}
        }
    }
}

/// C 盘与 F 盘：MFT（多线程优化）vs 无 MFT 普通扫描 对比。每盘先跑 MFT 再跑普通扫描，输出耗时与倍数。
#[test]
#[cfg(windows)]
fn scan_timing_mft_vs_normal_c_and_f() {
    let paths = ["C:\\", "F:\\"];
    #[derive(Default)]
    struct DriveResult {
        mft_ms: Option<u64>,
        mft_err: Option<String>,
        normal_ms: Option<u64>,
        normal_err: Option<String>,
    }
    let mut per_drive: std::collections::HashMap<String, DriveResult> =
        std::collections::HashMap::new();

    for path in &paths {
        if !Path::new(path).exists() {
            eprintln!("[MFT_vs_normal] {} 不存在，跳过", path);
            continue;
        }
        let entry = per_drive.entry(path.to_string()).or_default();

        eprintln!("[MFT_vs_normal] ---------- {} ----------", path);

        let t0 = std::time::Instant::now();
        let res_mft = scan_path_with_progress(path, None, true, true);
        let mft_ms = t0.elapsed().as_millis() as u64;
        match &res_mft {
            Ok((r, used_mft)) => {
                eprintln!(
                    "[MFT_vs_normal] {} MFT(优化)  used_mft={} file_count={} total_size={} 耗时={} ms ({:.2} s)",
                    path, used_mft, r.file_count, r.total_size, mft_ms, mft_ms as f64 / 1000.0
                );
                entry.mft_ms = Some(mft_ms);
            }
            Err(e) => {
                eprintln!("[MFT_vs_normal] {} MFT 失败: {} 耗时={} ms", path, e, mft_ms);
                entry.mft_err = Some(e.to_string());
            }
        }

        let t1 = std::time::Instant::now();
        let res_normal = scan_path_with_progress(path, None, true, false);
        let normal_ms = t1.elapsed().as_millis() as u64;
        match &res_normal {
            Ok((r, _)) => {
                eprintln!(
                    "[MFT_vs_normal] {} 普通扫描 file_count={} total_size={} 耗时={} ms ({:.2} s)",
                    path, r.file_count, r.total_size, normal_ms, normal_ms as f64 / 1000.0
                );
                entry.normal_ms = Some(normal_ms);
            }
            Err(e) => {
                eprintln!("[MFT_vs_normal] {} 普通扫描 失败: {} 耗时={} ms", path, e, normal_ms);
                entry.normal_err = Some(e.to_string());
            }
        }

        if let (Some(mft), Some(norm)) = (entry.mft_ms, entry.normal_ms) {
            if norm > 0 {
                let ratio = mft as f64 / norm as f64;
                eprintln!(
                    "[MFT_vs_normal] {} 对比: MFT={} ms, 普通={} ms, MFT/普通={:.2}x",
                    path, mft, norm, ratio
                );
            }
        }
    }

    eprintln!("[MFT_vs_normal] ---------- 汇总 ----------");
    eprintln!("[MFT_vs_normal] 盘符 | MFT(优化) 耗时(ms) | 普通扫描 耗时(ms) | MFT/普通");
    eprintln!("[MFT_vs_normal] -----+---------------------+---------------------+--------");
    let default_result = DriveResult::default();
    for path in &paths {
        let entry = per_drive.get(*path).unwrap_or(&default_result);
        let mft_s = entry
            .mft_ms
            .map(|m| m.to_string())
            .unwrap_or_else(|| entry.mft_err.as_deref().unwrap_or("-").to_string());
        let norm_s = entry
            .normal_ms
            .map(|m| m.to_string())
            .unwrap_or_else(|| entry.normal_err.as_deref().unwrap_or("-").to_string());
        let ratio_s = match (entry.mft_ms, entry.normal_ms) {
            (Some(m), Some(n)) if n > 0 => format!("{:.2}x", m as f64 / n as f64),
            _ => "-".to_string(),
        };
        eprintln!("[MFT_vs_normal] {:4} | {:>19} | {:>19} | {}", path, mft_s, norm_s, ratio_s);
    }
}

const TOP_N: usize = 500;

/// 从 ScanResult 树中收集所有文件节点（不含目录），按 size 降序取前 n 个。
fn top_files_from_tree(root: &FileNode, n: usize) -> Vec<(String, u64, Option<u64>)> {
    let mut files: Vec<(String, u64, Option<u64>)> = Vec::new();
    fn collect(node: &FileNode, out: &mut Vec<(String, u64, Option<u64>)>) {
        if !node.is_dir {
            out.push((node.path.clone(), node.size, node.modified));
        }
        for c in &node.children {
            collect(c, out);
        }
    }
    collect(root, &mut files);
    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(n);
    files
}

/// 仅取前 500 大文件：C 盘与 F 盘下 MFT(top500) vs 普通扫描(全盘后取 top500)，输出表格数据。
#[test]
#[cfg(windows)]
fn scan_timing_top500_c_and_f() {
    let paths = ["C:\\", "F:\\"];
    #[derive(Default)]
    struct Row {
        mft_ms: Option<u64>,
        mft_err: Option<String>,
        normal_ms: Option<u64>,
        normal_err: Option<String>,
    }
    let mut table: std::collections::HashMap<String, Row> = std::collections::HashMap::new();

    eprintln!("[top500] 目标：仅取按大小前 {} 个文件", TOP_N);
    eprintln!("[top500] ----------------------------------------");

    for path in &paths {
        if !Path::new(path).exists() {
            eprintln!("[top500] {} 不存在，跳过", path);
            continue;
        }
        let row = table.entry(path.to_string()).or_default();

        eprintln!("[top500] ---------- {} ----------", path);

        let t0 = Instant::now();
        let res_mft = scan_volume_mft_top_files(path, TOP_N, None);
        let mft_ms = t0.elapsed().as_millis() as u64;
        match &res_mft {
            Ok(list) => {
                eprintln!(
                    "[top500] {} MFT(top{})  耗时={} ms ({:.2} s)  得到 {} 条",
                    path, TOP_N, mft_ms, mft_ms as f64 / 1000.0, list.len()
                );
                row.mft_ms = Some(mft_ms);
            }
            Err(e) => {
                eprintln!("[top500] {} MFT 失败: {}  耗时={} ms", path, e, mft_ms);
                row.mft_err = Some(e.to_string());
            }
        }

        let t1 = Instant::now();
        let res_normal = scan_path_with_progress(path, None, true, false);
        let normal_ms = t1.elapsed().as_millis() as u64;
        match &res_normal {
            Ok((r, _)) => {
                let top = top_files_from_tree(&r.root, TOP_N);
                eprintln!(
                    "[top500] {} 普通(全盘→top{})  耗时={} ms ({:.2} s)  得到 {} 条",
                    path, TOP_N, normal_ms, normal_ms as f64 / 1000.0, top.len()
                );
                row.normal_ms = Some(normal_ms);
            }
            Err(e) => {
                eprintln!("[top500] {} 普通扫描 失败: {}  耗时={} ms", path, e, normal_ms);
                row.normal_err = Some(e.to_string());
            }
        }

        if let (Some(mft), Some(norm)) = (row.mft_ms, row.normal_ms) {
            if norm > 0 {
                eprintln!(
                    "[top500] {} 对比: MFT={} ms, 普通={} ms, MFT/普通={:.2}x",
                    path, mft, norm, mft as f64 / norm as f64
                );
            }
        }
    }

    eprintln!("[top500] ----------------------------------------");
    eprintln!("[top500] 表格数据（仅取前 {} 大文件）", TOP_N);
    eprintln!("[top500]");
    eprintln!("[top500] | 盘符 | MFT (top{}) 耗时 (ms) | 普通扫描 (全盘→top{}) 耗时 (ms) | MFT/普通 |", TOP_N, TOP_N);
    eprintln!("[top500] |------|--------------------------|----------------------------------|----------|");
    let default_row = Row::default();
    for path in &paths {
        let row = table.get(*path).unwrap_or(&default_row);
        let mft_s = row
            .mft_ms
            .map(|m| m.to_string())
            .unwrap_or_else(|| row.mft_err.as_deref().unwrap_or("-").to_string());
        let norm_s = row
            .normal_ms
            .map(|m| m.to_string())
            .unwrap_or_else(|| row.normal_err.as_deref().unwrap_or("-").to_string());
        let ratio_s = match (row.mft_ms, row.normal_ms) {
            (Some(m), Some(n)) if n > 0 => format!("{:.2}x", m as f64 / n as f64),
            _ => "-".to_string(),
        };
        eprintln!("[top500] | {:4} | {:>24} | {:>32} | {:>8} |", path, mft_s, norm_s, ratio_s);
    }
    eprintln!("[top500]");
}

/// Windows: 拒绝访问 (ERROR_ACCESS_DENIED)，遇到时直接跳过不报告
const WIN_ERROR_ACCESS_DENIED: i32 = 5;

/// 遍历目录，遇到无法读取的路径就输出并继续（用于定位损坏部分）。
/// 拒绝访问 (os error 5) 的目录/文件直接跳过，不计数、不递归。
fn find_bad_paths_impl(path: &Path, depth: usize, max_depth: usize, max_report: &mut usize) {
    if *max_report <= 0 || depth > max_depth {
        return;
    }
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(e) => {
            if e.raw_os_error() == Some(WIN_ERROR_ACCESS_DENIED) {
                return; // 拒绝访问，静默跳过
            }
            let code = e.raw_os_error().unwrap_or(0);
            eprintln!(
                "[find_bad_paths] cannot read dir: {} | error: {} (os error {})",
                path.display(),
                e,
                code
            );
            *max_report = max_report.saturating_sub(1);
            return;
        }
    };
    for entry in entries.filter_map(|e| e.ok()) {
        if *max_report <= 0 {
            return;
        }
        let p = entry.path();
        let meta = match fs::metadata(&p) {
            Ok(m) => m,
            Err(e) => {
                if e.raw_os_error() == Some(WIN_ERROR_ACCESS_DENIED) {
                    continue; // 拒绝访问，静默跳过
                }
                let code = e.raw_os_error().unwrap_or(0);
                eprintln!(
                    "[find_bad_paths] cannot read metadata: {} | error: {} (os error {})",
                    p.display(),
                    e,
                    code
                );
                *max_report = max_report.saturating_sub(1);
                continue;
            }
        };
        if meta.is_dir() {
            find_bad_paths_impl(&p, depth + 1, max_depth, max_report);
        }
    }
}

#[test]
#[cfg(windows)]
fn find_bad_paths() {
    let path = scan_path();
    eprintln!("[find_bad_paths] checking path for bad/unreadable entries: {}", path);
    eprintln!("[find_bad_paths] max depth 8, max 50 reports");
    eprintln!("[find_bad_paths] ----------------------------------------");
    if !Path::new(&path).exists() {
        eprintln!("[find_bad_paths] path does not exist, skip");
        return;
    }
    let mut max_report = 50usize;
    find_bad_paths_impl(Path::new(&path), 0, 8, &mut max_report);
    eprintln!("[find_bad_paths] ----------------------------------------");
    eprintln!("[find_bad_paths] done");
}
