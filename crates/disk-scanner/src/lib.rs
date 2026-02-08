pub mod scanner;
pub mod node;
pub mod filters;

#[cfg(windows)]
pub mod mft_scan;

pub use scanner::{scan_path, scan_path_with_progress, scan_will_use_mft};
pub use node::*;
pub use filters::*;
pub use ai_disk_domain::ScanResult;

#[cfg(windows)]
pub use mft_scan::{scan_volume_mft_top_files, TopFileEntry, TOP_FILES_DEFAULT_N};
