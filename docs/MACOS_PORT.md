# macOS 移植说明（社区 port/macos）

> 上游为 Windows-first 官方公开目标。本分支在 macOS（Apple Silicon / Intel）上做社区移植。

## 当前状态

| 能力 | 状态 |
|------|------|
| Electron 主进程 / Renderer 启动 | 进行中 |
| 定位本机 Grok CLI（`~/.grok/bin/grok`） | 已支持（上游已有非 win32 分支） |
| 账号凭据加密 | Electron `safeStorage` → macOS Keychain |
| 会话 / ACP / 自定义 Provider UI | 预期可用（与平台无关） |
| 自定义 Provider 用户环境变量持久化 | 进程内 `process.env`；跨重启待补 Keychain/文件存储 |
| 持久定时任务 | 暂不支持（上游用 Task Scheduler；后续可接 launchd） |
| Computer Use 原生宿主 | 未移植（Windows UI Automation / C#） |
| 安装包 | 计划 `electron-builder --mac` dmg/zip |

## 本地开发

```bash
# 建议 Node 22+（上游锁定 24；本分支放宽到 >=22）
npm ci
npm run build:resources   # 跨平台；macOS 跳过 Computer Host
npm run build
npm run dev
# 或
npm run dev:local         # APP_BUILD_PROFILE=local
```

前置：本机已安装 [Grok Build CLI](https://docs.x.ai/build/overview)。

## 平台差异摘要

1. **凭据**：`safeStorage` 在 macOS 使用 Keychain，不再写 “DPAPI”。
2. **诊断**：`platform` 检查接受 `darwin`；Computer Use / 定时任务标记为 limited。
3. **资源清单**：不再强制 `GrokComputerHost.exe`。
4. **自动化**：`WindowsTaskScheduler.supported()` 在非 Windows 为 false → `registrationStatus: unsupported`。
5. **打包**：`package:mac` 生成 dmg（未签名）。

## 后续工作

- [ ] launchd 版 AutomationScheduler
- [ ] Provider 环境变量持久化（Keychain 或加密 JSON）
- [ ] macOS Computer Use（Accessibility + CGEvent，长期）
- [ ] 公证 / 签名与 Sparkle 或 GitHub 更新通道
- [ ] 同步上游 main 的定期 rebase
