# 安全政策

## 支持版本

安全修复优先覆盖最新公开稳定版本。v0.4.x 首批仅支持 Windows x64。

## 报告漏洞

请使用 GitHub 仓库的 **Private vulnerability reporting**。不要在公开 Issue 中粘贴 Token、OAuth 凭据、API Key、完整日志、会话内容、截图或源代码。

报告建议包含：受影响版本、最小复现、预期与实际安全边界、是否需要已登录账号。路径请写成 `%USERPROFILE%\…`，账号使用 `test-user@example.com`，密钥使用明确的假值。

## 设计边界

- 凭据由 Electron `safeStorage` / Windows DPAPI 加密。
- Renderer 无 Node 权限；IPC 校验来源。
- 默认验证离线且不读取真实账号。
- Computer Use 不控制 UAC、安全桌面、终端、Codex/ChatGPT 或应用自身。
- 未签名版本只展示更新，不自动下载或执行安装器。

安全修复确认后会在发布说明中给出受影响范围与升级建议。
