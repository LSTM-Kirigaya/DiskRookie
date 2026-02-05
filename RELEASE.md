# 发布指南

本文档说明如何构建和发布 DiskRookie 的新版本。

## 发布流程

### 方式一：Commit Message 触发（推荐）

最简单的发布方式，只需在 commit message 中包含 `[release]` 标记：

```bash
# 1. 更新版本号（如果需要）
# 编辑 apps/desktop/src-tauri/tauri.conf.json 中的 "version" 字段

# 2. 提交并推送
git add .
git commit -m "feat: 新增功能 [release]"
git push origin main
```

GitHub Actions 会自动：
1. 检测到 `[release]` 标记
2. 从 `tauri.conf.json` 读取版本号
3. 构建 Windows x86_64 和 macOS ARM64 版本
4. 创建 GitHub Release 并上传安装包

### 方式二：Git Tag 触发

```bash
# 1. 确保所有更改已提交
git add .
git commit -m "准备发布 v0.2.0"

# 2. 创建并推送标签
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

### 方式三：手动触发

1. 前往 [GitHub Actions](https://github.com/LSTM-Kirigaya/DiskRookie/actions) 页面
2. 选择 "Build and Release" 工作流
3. 点击 "Run workflow"
4. 输入版本标签（如 `v0.2.0`）
5. 点击 "Run workflow" 按钮

## 本地构建

由于项目使用 Cargo Workspace，`target` 目录位于**项目根目录**。

### 前置要求

- Node.js 20+
- Rust (stable)
- Tauri CLI: `npm install -g @tauri-apps/cli@latest`

### Windows x86_64

```bash
# 安装 Rust target（如果没有）
rustup target add x86_64-pc-windows-msvc

# 构建
cd apps/desktop/frontend
npm ci
npm run build
cd ..
npm install
npx tauri build --target x86_64-pc-windows-msvc
```

构建产物位于：`target/x86_64-pc-windows-msvc/release/bundle/msi/`

### macOS ARM64 (Apple Silicon)

```bash
# 安装 Rust target（如果没有）
rustup target add aarch64-apple-darwin

# 构建
cd apps/desktop/frontend
npm ci
npm run build
cd ..
npm install
npx tauri build --target aarch64-apple-darwin
```

构建产物位于：`target/aarch64-apple-darwin/release/bundle/dmg/`

### macOS x86_64 (Intel)

```bash
rustup target add x86_64-apple-darwin
npx tauri build --target x86_64-apple-darwin
```

### Universal macOS (同时支持 Intel 和 Apple Silicon)

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npx tauri build --target universal-apple-darwin
```

## 版本号规范

遵循 [语义化版本](https://semver.org/)：
- **主版本号**：不兼容的 API 修改
- **次版本号**：向下兼容的功能性新增
- **修订号**：向下兼容的问题修正

示例：`0.1.0` → `0.1.1` → `0.2.0` → `1.0.0`

**注意**：MSI 安装包要求版本号必须是纯数字格式（如 `0.1.0`），不支持预发布后缀（如 `-beta`、`-alpha`）。

## GitHub Secrets 配置

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中配置：

### 必需（如需代码签名）

| Secret 名称 | 说明 |
|------------|------|
| `TAURI_PRIVATE_KEY` | Tauri 更新私钥 |
| `TAURI_KEY_PASSWORD` | 私钥密码 |

### 可选（云存储 OAuth）

| Secret 名称 | 说明 |
|------------|------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `BAIDU_CLIENT_ID` | 百度网盘 API Key |
| `BAIDU_CLIENT_SECRET` | 百度网盘 Secret Key |
| `ALIYUN_CLIENT_ID` | 阿里云盘 Client ID |
| `ALIYUN_CLIENT_SECRET` | 阿里云盘 Client Secret |
| `DROPBOX_CLIENT_ID` | Dropbox App Key |
| `DROPBOX_CLIENT_SECRET` | Dropbox App Secret |

如果不配置 OAuth secrets，应用仍可正常构建，但用户需要在应用设置中手动配置云存储凭据。

## 注意事项

1. **构建时间**：完整构建约需 10-20 分钟，请耐心等待

2. **版本号同步**：发布前确保以下文件的版本号一致：
   - `apps/desktop/src-tauri/tauri.conf.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/package.json`（可选）

3. **发布检查清单**：
   - [ ] 所有功能测试通过
   - [ ] 版本号已更新
   - [ ] README 已更新（如有新功能）

4. **macOS 代码签名**：未签名的应用在 macOS 上会显示"无法验证开发者"警告，用户需要在系统偏好设置中手动允许运行。

## 故障排查

### 构建失败：找不到 bundle 目录

确认 `tauri build` 命令成功执行。查看 GitHub Actions 日志中的 "Build Tauri app" 步骤。

### 版本号格式错误

MSI 打包器不支持非数字版本后缀。使用 `0.1.0` 而不是 `0.1.0-beta`。

### OAuth 环境变量错误

代码使用 `option_env!()` 宏，如果环境变量未设置会使用空字符串，不会导致编译失败。
