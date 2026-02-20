/// 扫描过滤器（预留）
#[derive(Default)]
pub struct ScanFilters {
    pub exclude_patterns: Vec<String>,
    pub max_depth: Option<usize>,
}
