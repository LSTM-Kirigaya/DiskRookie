# 前 500 大文件：MFT vs 普通扫描 性能对比

每次扫描只取「按大小前 500 个文件」，在 C 盘与 F 盘上对比 **MFT(top500)** 与 **普通扫描(全盘后取 top500)** 的耗时。

## 运行方式

在项目根目录执行（需管理员权限以便 MFT 成功；先关闭占用 `scan_timing-*.exe` 的进程）：

```bash
cargo test -p ai-disk-scanner scan_timing_top500_c_and_f -- --nocapture
```

测试会依次执行：

1. **C:\\** — MFT 只取前 500 大文件 → 计时  
2. **C:\\** — 普通全盘扫描 → 从树中取前 500 大文件 → 计时  
3. **F:\\** — 同上 MFT(top500)  
4. **F:\\** — 同上 普通(全盘→top500)  

最后在 stderr 中打印**表格数据**。

## 表格格式（运行完成后会输出）

| 盘符 | MFT (top500) 耗时 (ms) | 普通扫描 (全盘→top500) 耗时 (ms) | MFT/普通 |
|------|--------------------------|-------------------------------------|----------|
| C:\  | XXXXX                    | XXXXX                               | X.XXx    |
| F:\  | XXXXX                    | XXXXX                               | X.XXx    |

- **MFT (top500)**：`scan_volume_mft_top_files(path, 500, None)`，只枚举 + 最小堆，不建树。  
- **普通扫描 (全盘→top500)**：`scan_path_with_progress(..., use_mft: false)` 全盘建树，再从树中收集所有文件、按大小排序取前 500。  

将终端里以 `[top500]` 开头的表格行复制到 Markdown 或 Excel 即可得到表格数据。
