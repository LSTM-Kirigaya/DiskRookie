<div align="center">
  <img src="apps/desktop/app-icon.png" width="128" height="128" alt="AI Disk Analyzer Logo" />

  # DiskRookie 磁盘菜鸟

  <p align="center">
    <img src="https://img.shields.io/badge/Rust-1.86+-orange?style=flat-square&logo=rust" alt="Rust Version" />
    <img src="https://img.shields.io/badge/Node.js-20+-green?style=flat-square&logo=node.js" alt="Node Version" />
    <img src="https://img.shields.io/badge/Tauri-Latest-blue?style=flat-square&logo=tauri" alt="Tauri" />
    <img src="https://img.shields.io/badge/License-Apache%202.0-red?style=flat-square" alt="License" />
  </p>

  让傻子用户也能像电脑糕手一样清理磁盘。

  [快速开始](#快速开始) • [项目架构](#项目架构) • [开发计划](#开发计划) • [贡献指南](#贡献指南)
</div>

---

## ✨ 核心特性

- 🤖 **AI 驱动分析**：不仅仅是统计大小，更懂文件的用途与价值。
- 🚀 **高性能扫描**：基于 Rust 核心，极速遍历千万级文件。
- 🎨 **工业级 UI**：基于 TailwindCSS 打造的现代化、沉浸式交互体验。
- 🛡️ **安全迁移**：所有 AI 建议均需用户确认，确保数据安全。

## 🏗️ 项目架构

项目采用 **Rust Workspace** 管理的多包架构，结构清晰，逻辑解耦：

```text
DiskRookie/
├── 📱 apps/
│   ├── desktop/                # GUI App (Tauri)
│   │   ├── src-tauri/          # Rust 桌面端后端
│   │   └── frontend/           # React + Vite + TailwindCSS
│   └── images/                 # 资源文件与图标处理脚本
├── 📦 crates/
│   ├── disk-scanner/           # 🚀 极速磁盘扫描引擎
│   ├── domain-model/           # 核心领域实体模型
│   ├── ai-engine/              # 🧠 AI 推理与决策层
│   ├── executor/               # 文件操作安全执行层
│   └── common/                 # 工具类与公共模块
└── 📝 docs/                    # UI 设计规范与技术文档

```

---

## 🚀 快速开始

### 🛠️ 环境准备

确保你的开发环境已安装以下工具：

* **Rust**: `rustc 1.86+`
* **Node.js**: `v20+`
* **包管理器**: `npm` 或 `pnpm`

### 🖥️ 开发调试

```bash
# 1. 克隆项目
git clone [https://github.com/your-username/DiskRookie.git](https://github.com/your-username/DiskRookie.git)
cd DiskRookie/apps/desktop

# 2. 安装前端依赖
cd frontend && npm install && cd ..

# 3. 启动开发模式 (自动开启 Rust 后端与 React 前端)
npm run dev

```

### 📦 构建发布

```bash
cd apps/desktop
npm run build

```

---

## 📅 开发计划 (Roadmap)

* [x] 核心 Rust 扫描引擎开发
* [ ] **Phase 1**: 支持更多复杂文件类型深度识别 (Office/CAD/临时缓存)
* [ ] **Phase 2**: 增加文件内容实时预览功能
* [ ] **Phase 3**: AI 自定义清理规则（自然语言配置）
* [ ] **Phase 4**: 多语言 i18n 支持与跨平台分发优化

---

## 🤝 贡献指南

我们非常欢迎 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的改动 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

---

## 📄 许可证

本项目采用 [Apache License 2.0](https://www.google.com/search?q=LICENSE) 许可证。

Copyright © 2026 **AI Disk Analyzer Contributors**.
