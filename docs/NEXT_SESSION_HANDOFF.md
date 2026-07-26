# Grok Build Desktop 下一会话完整交接（2026-07-27，0.6.6 发布收口）

> 本文替换 0.6.5 阶段的旧交接。当前正式目标是 **0.6.6**；用户已决定延期跨协议 Provider 转换，不能把它写成已实现。完成状态必须以本文的“发布证据”段和 GitHub Release 实际状态为准。

## 1. 必读顺序与安全边界

1. `AGENTS.md`
2. 本文
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/FEATURE_MATRIX.md`
5. `docs/CODEX_UI_PARITY.md`
6. `docs/CLI_COMPATIBILITY.md`
7. `CHANGELOG.md`

随后执行：

```powershell
git status --short --branch
git log --oneline --decorate -12
gh release list --limit 5
```

不要：

- 丢弃未提交工作树或从旧 `main` 重做。
- 覆盖、移动或删除 0.6.4/0.6.5 本地产物和公开 0.6.4 Release。
- 在未通过自动化/实机验证前声称功能、安装或发布成功。
- 将密钥、完整 Provider 请求/响应、提示词、绝对私人路径或附件正文写入日志、支持包或文档。
- 在正式包验证前替换用户正在使用的安装版。
- 关闭正在运行的 Codex。

Renderer 继续保持：

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
```

文件、Git、进程、凭据、网络、Provider 网关、Token 统计和 ACP 都必须留在 Electron 主进程。

## 2. 仓库与版本状态

- 仓库：`C:\Users\TestUser\Documents\GROK`
- 开发分支：`codex/v0.6.5-0.6.6`
- 进入本轮收口前 HEAD：`241c64a`
- 基线 `origin/main`：`71660b3`
- 进入收口前已有 7 个功能提交，涵盖 0.6.5 稳定交互、结构化失败、非 Git Review、Token 活动、Computer Use 提权状态和 UI 体感。
- `package.json` / lockfile 已提升为 `0.6.6`。
- 本机 CLI 兼容基准：`0.2.112 (9bbd559437)`。
- 本机已安装并验证 0.6.6；GitHub `v0.6.6` 已正式发布为 Latest。
- 旧 0.6.5 产物生成于后续提交之前，属于过期候选，不能上传为 0.6.6。

## 3. 0.6.5/0.6.6 已实现范围

### 稳定交互

- 计划批准/继续规划/取消按 `sessionId + requestId` 幂等；只回答原 `x.ai/exit_plan_mode` 请求，不再制造 `[Plan approved]` 第二条 Prompt。
- 排队、编辑、删除、重排和插话有回执；不支持即时插话时明确降级到队首。
- 更新、CLI 检查、诊断中心、脱敏日志导出均有运行/成功/失败/取消状态和防重入。
- 设备码登录只有一个浏览器所有者；滚动 24 小时 Token 限额与周/月账单额度分离。
- 自定义模型显示 Provider 前缀；错误默认折叠并显示可复制的脱敏诊断。

### Provider 与结构化失败

- 主进程回环网关使用随机端口、不可猜路由和进程级 scope；Renderer 不接触密钥。
- 当前正式能力是**同协议透传**、流式响应、取消、大小/超时边界、选定 Trace 头和 Gemini/strict Schema 清理。
- Gemini/Antigravity 空枚举 HTTP 400 已真实复现；相同请求经 Gemini 档清理后通过。
- `TurnFailure` 保留 HTTP、JSON-RPC、进程退出、取消、模型、Provider、Trace、retry-after、网关阶段和清理计数。
- 故障关联要求同 Provider、同 CLI 进程 scope，且网关记录时间不晚于回合错误、差值小于 60 秒。
- 失败诊断按类别执行针对性检查，不再对每个错误运行无关的全量安装诊断。

### Review、文件与 Token

- Git Review 继续提供 Unstaged/Staged/Commit/Branch/Last turn、单文件懒加载 Diff 和受控 Git 操作。
- 非 Git 使用 Agent 工具真实 before/after 写入，提供 Last turn / Session changes；没有基线时明确显示，绝不伪造 Git staged/commit/branch。
- 最近文件、工具位置和编辑器跳转使用会话/Worktree 真实根目录；二进制、外部、缺失和越界以行内原因降级。
- 每回合显示真实耗时和 CLI/Provider 精确 Token；无明细时只显示总量或“未返回用量”。
- Token 活动持久化逐回合明细和匿名日汇总，提供 24h/今日/7天/30天/本月及 371 日（53 周）活动图；会话删除移除明细，匿名日汇总最多保留约 13 个月。

### 会话、流式与 Computer Use

- JsonStore 支持排队的原子 read/modify/write；Token 和 Dashboard 并发记录不再丢失。
- 清空工作区只关闭被删除的会话，并清理 assignment、Token 明细、Agent 改动、Dashboard、附件和回合展示；不停止其他工作区的实时会话。
- 主聊天事件先发 Renderer，Dashboard/Token/附件/Computer Use 等投影失败只记录日志。
- ACP `retry_state` 显示次数、上限、等待和原因；Prompt 超时会发送真实 ACP cancel。
- 流式最终回答显示稳定纯文本，完成后才进行完整 Markdown/公式/代码渲染。
- Computer Use 允许普通权限 Codex，仍阻止应用自身、终端、UAC/安全界面和跨完整性级别控制。
- 原生 Host 按动作公开 Schema，窗口内约束点击/拖动，按当前键盘布局映射标点，支持水平滚轮；Host 超时记为“结果未知，需重新观察”，不记成确定失败。

## 4. 本轮发布前复审修复

Claude 的并行复审原始结果保存在：

```text
<temporary-review-output>
```

已修：

1. 故障 enrich 丢失 cancelled/processExitCode。
2. 网关记录无下界、无会话/进程隔离。
3. Token/Dashboard JsonStore 并发 read-modify-write 覆盖。
4. clearSessions 未清 Token/Agent changes/Dashboard 且误停无关会话。
5. Agent change 最早基线的截断标志不一致。
6. UTF-8/CJK 以 UTF-16 单元裁剪。
7. 热力图 372 日而不是 371 日。
8. ACP retry_state 被丢弃。
9. Prompt 超时只丢 Promise、不取消 CLI。
10. Host 超时误记为确定失败。
11. 元素点击和拖动终点可能越出目标窗口。
12. `press_key "."` 被当作 Delete。
13. `deltaX` 未生效。
14. 所有 Computer Use MCP 工具共享一份“全字段可选”Schema。
15. 流式最终回答每帧重建 Markdown。
16. Git/Worktree 工作台收到每次 App render 新建的 dialogs 对象而反复加载。
17. 可选投影先于 Renderer 发送，磁盘失败可吞掉主事件。

明确延期/已知边界：

- 跨协议 Chat/Responses/Anthropic/Gemini Translator 未做，用户决定暂缓；不能在功能矩阵或 Release Notes 中宣称支持。
- 非 Git before/after 快照当前只覆盖本次应用进程捕获到的真实写入；旧会话没有基线时只读降级。
- Computer Use UIA 树仍是有界扁平交互元素列表；未实现完整父子语义树。
- 原生动作后仍采用有界短等待和重新截图，尚未实现通用像素稳定检测。
- Provider 推理自动重试没有新增：ACP/上游实际发布的 `retry_state` 会显示，但 Desktop 不自行重复可能产生副作用的推理请求。

## 5. 已通过的本地正式候选验证

- `npm run typecheck`
- 7 个聚焦测试文件，82 项通过：
  - JsonStore 并发 mutate
  - Token 并发记录、批量删除与 371 日热力图
  - Agent change CJK 裁剪/截断
  - Provider 网关进程 scope
  - Turn failure
  - Computer Use 超时分类
  - Renderer retry/store
- `npm run build:computer-host`：原生 Host 编译及 `0.3.1 win-x64` 自检通过。
- 最终修正后的 `scripts/package-win.ps1` 正式本地门槛通过：
  - 67 个测试文件通过、4 个显式 live 文件跳过；359 项通过、7 项跳过。
  - TypeScript、生产 main/preload/Renderer 构建、原生 Host、Electron Fuses、打包 UI、Task Scheduler、中文空格 Portable 和前后两次 264 文件公开扫描通过。
  - 0.6.6 UI 夹具覆盖完整导航、五种右栏工具、最近文件、非 Git Agent 改动、结构化错误、回合指标、371 日 Token 活动、四个更新/诊断动作、窄窗抽屉和 Provider 管理。
- PR/clean-install 收口另外确认：
  - npm 11 strict `npm ci` 的可选 `@emnapi` lock 元数据已完整。
  - 新公布的构建期公告通过 `brace-expansion 5.0.8` 与 `tar 7.5.22` 覆盖修复；fresh install 后完整 high-level audit 为 0。
  - Windows PowerShell 5.1 可解析带中文的打包/冒烟脚本；v0.6.2 兼容探针不再依赖 Virtuoso 同时挂载 3 行。
  - 上述修复后的最终包重新跑完 359 项和全部打包 UI 门槛；此前失败候选未发布。
  - CodeQL 随后在发布前发现 Provider 网关可能把任意异常文本返回给回环调用方；公开响应已改为固定安全分类，详细脱敏诊断只留在主进程，并用含私人路径/堆栈的假异常回归测试锁定。包含此运行时修复的新包必须重新完成门槛和安装。
- 同一个 Setup 已完成 per-user 安装：
  - 文件/Product/Main/About 均为 0.6.6，channel 为 stable。
  - 诊断中心报告“可以使用”，支持包继续排除附件正文和完整路径。
  - 桌面与开始菜单快捷方式均指向 `%LOCALAPPDATA%\Programs\Grok Build Desktop\Grok Build Desktop.exe`。

以上本机证据与下节公开发布证据均已完成。

## 6. 正式发布证据

- PR #15：`https://github.com/wangyingxuan383-ai/grok-build-desktop/pull/15`
- 合并提交：`2d413d4e807a7de185c157a7fc89c284530c6b15`
- 标签：`v0.6.6`
- Release workflow：`30216468056`
- Release：`https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/tag/v0.6.6`
- 状态：Latest、非 Draft、非 prerelease。
- Workflow 的 Hosted Windows 构建、公开扫描、Setup/Portable attestation、Draft 创建、回下载、SHA-256/provenance 验证和最终发布全部通过。
- 公开资产另行下载到临时目录复核，五项文件均与 `SHA256SUMS.txt` 一致；Setup/Portable 的 attestations 均验证到 GitHub-hosted `release.yml`、tag `v0.6.6` 和提交 `2d413d4`。
- 已用下载后的公开 Setup（SHA-256 `911d5350…`）再次执行 per-user 覆盖安装；Main/About `0.6.6`、stable channel、诊断可用、支持包附件排除及桌面/开始菜单快捷方式目标均再次通过。

## 7. 本地 0.6.6 资产

```text
release/Grok-Build-Desktop-Setup-v0.6.6-x64.exe
release/Grok-Build-Desktop-Portable-v0.6.6-x64.zip
release/Grok-Build-Desktop-0.6.6-SBOM.cdx.json
release/THIRD_PARTY_LICENSES.json
release/SHA256SUMS.txt
```

- Setup：143,758,221 bytes；SHA-256 `b4243d6ebc0137291b0fc38df1b948f554a7be41d787a678ea9594fb99a57a5e`
- Portable：194,250,848 bytes；SHA-256 `b8edbe0c7a99717da8956e0e540a73410a8de6c6b1d8ce5d7a529f62bb55b4e6`
- SBOM：SHA-256 `c4489c6c07492c943db339474d0d5c6fe20ce810dc1b6a0bfce946e436a8bc51`
- 第三方许可证：SHA-256 `1ad863e9d4753397efa8ab297e057882b2f04d665bb5e8ed7062d71b900b8ca5`

公开 Hosted Windows 资产（与本机候选不同）：

- Setup：143,758,507 bytes；SHA-256 `911d5350d7c24999d2c17fc6a9fa8513a5173dc6304d873c8a9fe2f112f28416`
- Portable：194,251,272 bytes；SHA-256 `5b6dc4ccc0e44f7a65b44508b8c3e17d35302cd961d61d3ac72dfe4e692688ca`
- SBOM：364,228 bytes；SHA-256 `33882c6a738fc97285e2d41ace5ffadb57da5ba44261d6bf76b79c089387e9d5`
- 第三方许可证：139,909 bytes；SHA-256 `d18189fbbb412ed10b00a5b47582d8f465751d2a2172968ba824f08515f6a3b3`
