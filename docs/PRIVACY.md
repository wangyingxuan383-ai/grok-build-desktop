# 隐私说明

Grok Build Desktop 不提供遥测，不自动上传崩溃报告。

## 本地数据

- UI 设置、草稿索引、账号配置档和脱敏日志保存在 `%APPDATA%\Grok Build Desktop`。
- Grok 原始会话和 CLI 配置继续由 `%USERPROFILE%\.grok` 管理。
- Codex 会话只读扫描；隐藏、索引和接力映射是应用自身元数据，不修改原 JSONL。
- OAuth 与 API Key 使用 Windows DPAPI 加密，Renderer 不获得原始 Token。

## 网络访问

- Grok 对话、登录、额度和插件操作由 Grok CLI / xAI 服务完成。
- 应用更新仅查询配置仓库的 GitHub 稳定 Release。
- 应用不自动上传支持包；导出前会列出内容。

## 支持包

支持包包含应用/Windows/CLI 版本、能力探测和脱敏日志。它明确排除账号、Token、提示词、会话、截图、文件内容、完整工作区路径，以及代理地址和认证。
