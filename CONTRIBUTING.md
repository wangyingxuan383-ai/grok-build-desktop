# 贡献指南

感谢改进 Grok Build Desktop。

## 开发环境

1. 使用 Windows x64、Node.js 24 LTS、npm 11+ 与 PowerShell 5.1+。
2. 运行 `npm ci`，不要手工放宽锁文件版本。
3. 修改前阅读 `AGENTS.md`、实施计划、功能矩阵、CLI 兼容矩阵和 Changelog。
4. 使用 `npm run verify` 做默认离线验证；真实账号验收必须显式运行 `npm run verify:live`。

## 安全边界

- Renderer 必须保持 `nodeIntegration: false`、`contextIsolation: true` 和 sandbox。
- 文件、进程、凭据、日志、更新和 ACP/MCP 操作必须位于主进程，并通过类型化 IPC 暴露最小接口。
- 不提交 `.env`、`app.local.json`、Token、日志、截图、会话、真实邮箱、完整用户路径或代理地址。
- 新 IPC 必须验证发送者；外部链接必须限制协议和目标来源。
- 不要在默认测试中读取真实 Grok/Codex 数据或调用付费模型。

## 提交前

```powershell
npm run typecheck
npm test
npm run build
npm run check:public
npm audit --audit-level=high
```

更新 `CHANGELOG.md` 与对应计划勾选项。PR 应说明测试证据、用户影响和兼容性退化方式，不要声称未经测试的功能可用。
