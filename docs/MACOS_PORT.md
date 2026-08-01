# macOS 移植说明（社区 port/macos）

> 上游为 Windows-first 官方公开目标。本分支在 macOS（Apple Silicon / Intel）上做社区移植。

## 当前状态

| 能力 | 状态 |
|------|------|
| Electron 主进程 / Renderer 启动 | ✅ |
| 定位本机 Grok CLI（`~/.grok/bin/grok`） | ✅ |
| 账号凭据加密 | ✅ Electron `safeStorage` → macOS Keychain |
| 会话 / ACP / 自定义 Provider UI | ✅ |
| 自定义 Provider 凭据跨重启 | ✅ `provider-env.vault.json` + safeStorage |
| 持久定时任务 | ✅ launchd LaunchAgents（`gui/$UID`） |
| Computer Use 原生宿主 | ❌ 未移植（Windows UI Automation / C#） |
| 安装包 | ✅ `npm run package:mac` / `package:mac:dmg`（未签名） |

## 本地开发

```bash
# 建议 Node 22+（上游锁定 24；本分支放宽到 >=22）
npm ci
# 若 Electron 下载慢：
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm run build:resources
npm run build
npm run dev
# 或
npm run dev:local
```

前置：本机已安装 [Grok Build CLI](https://docs.x.ai/build/overview)。

## 打包

```bash
# 仅生成 .app 目录（快，便于本机验证）
npm run package:mac

# 正式 dmg + zip + SHA256SUMS-mac.txt
npm run package:mac:dmg
```

产物在 `release/`。当前 **无 Apple 代码签名 / 公证**，首次打开需在「系统设置 → 隐私与安全性」允许，或：

```bash
xattr -cr "release/mac/Grok Build Desktop.app"
```

## 平台差异摘要

1. **凭据**：`safeStorage` 在 macOS 使用 Keychain。
2. **Provider 密钥**：非 Windows 写入 `~/Library/Application Support/Grok Build Desktop/provider-env.vault.json`（加密），并镜像到当前进程 `process.env`。
3. **自动化**：`LaunchdTaskScheduler` 在 `~/Library/LaunchAgents/io.github.grokbuilddesktop.automation.<id>.plist` 注册；`LimitLoadToSessionType=Aqua`，关主窗口后仍可由 launchd 唤醒 worker。
4. **Computer Use**：诊断显示不可用；不阻塞核心会话。
5. **诊断**：`platform` 检查接受 `darwin`。

## 同步上游

```bash
git fetch upstream main
git checkout port/macos
git rebase upstream/main
# 解决冲突后
git push --force-with-lease origin port/macos
```

建议每隔上游小版本发布后 rebase 一次。

## 后续工作

- [ ] macOS Computer Use（Accessibility + CGEvent）
- [ ] Apple 公证 / 签名与 Sparkle 或 GitHub 更新通道
- [ ] launchd 任务在「一次」触发后自动注销（可选）
- [ ] CI：macOS runner 上 `verify` + `package:mac`
