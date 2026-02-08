use serde::{Deserialize, Serialize};

use crate::FileNode;

/// 扫描结果，包含树结构与各项指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub root: FileNode,
    pub scan_time_ms: u64,
    pub file_count: u64,
    /// 本次扫描到的文件总大小（非卷容量）
    pub total_size: u64,
    /// 当 MFT 扫描失败（如 I/O 错误）并回退到普通扫描时，在此标注错误信息，前端可提示「此磁盘的扫描有错误」
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan_warning: Option<String>,
    /// 卷总容量（字节），由操作系统 API 获取，仅 Windows 卷根扫描时可能为 Some
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_total_bytes: Option<u64>,
    /// 卷剩余可用空间（字节），由 GetDiskFreeSpaceEx 获取
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume_free_bytes: Option<u64>,
}
