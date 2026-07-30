# Grok Build Desktop 下一会话完整交接（2026-07-30，0.6.14 审计修复候选）

> 当前工作分支为 `codex/v0.6.14-audit-fixes`。公开 Latest 仍是 **0.6.6**；0.6.7–0.6.13 是本地候选历史，0.6.14 目前只做源码与离线修复。用户明确说明当前默认模型依赖的本地上游没有运行，暂不做该 P1 或真实 Provider 验收，也不创建正式 Release。

> **2026-07-30 0.6.14 当前状态：** 工作树已修正 Provider 下游关闭误报、成功 HTTP 路由后的 `Internal error` Provider 归因、无签名 Anthropic thinking 的 ACP 思考语义、Windows 缺失 `HOME`、持久日志写盘前脱敏/8 MiB 轮转、JsonStore 损坏备份/陈旧临时文件清理、空能力列表迁移及终端 shell 弃用路径。完整离线结果为 72 文件/391 项通过，4 live 文件/7 项按设计跳过；TypeScript、Computer Host 0.3.1 自检/资源、生产构建、273 文件公开扫描、diff check 和 npm audit 通过。生产构建仍明确报告 Monaco/Shiki/Mermaid 大型依赖 chunk，列为后续性能事项。源码已推送到 `origin/codex/v0.6.14-audit-fixes`；不要启动本地上游，不发送真实或付费请求，不打包/安装/发布，除非用户另行要求。

> **2026-07-27 发布后补充（历史状态）：** 用户复现了自定义 `grok-4.5` 在桌面端 401、错误详情仅显示 `Internal error`，以及回合后自动变成官方模型。该阶段工作树加入了会话启动刷新 Windows 用户级 Provider 凭据/Header、保留显式本地模型 ID、普通 Prompt 结构化失败和 `http_status` 解析。此段的“未打包”状态已被后续 0.6.7–0.6.11 本地安装记录取代；公开 Latest 仍为 0.6.6。

> **2026-07-27 Claude 接力补充：** 工作树已提升为 0.6.7，并加入与 Codex 接力并列的 Claude Code 只读会话索引、镜像、隐藏/刷新和“在 Grok 中继续”。实现使用本机 Grok CLI 随附的 `/resume-claude` 与 `session_reader.py claude`，不把完整转录复制进自造提示。Claude 来源 JSONL 只读，continuation 前后校验 SHA-256；侧链和 subagents 被排除。受影响的 36 项测试、TypeScript、生产构建和原生资源自检通过。本地 Setup SHA-256 为 `c7b6bd66c480869539aa508e8015268ff1a08781205107fe0e84b38ea20258c2`，已 per-user 覆盖安装，文件版本 0.6.7；应用保持关闭等待用户自行验收。用户明确要求：**暂不扩大测试、不做代验、不生成正式 Portable/SBOM/许可证 Release 资产、不上传 GitHub；验收后再继续。**

> **2026-07-27 CPA 路由补充：** 用户验收发现，历史会话界面虽显示 `CPA 兼容 · grok-4.5`，实际日志只有官方 xAI Free 额度 429，CPA 无请求记录；推理强度切换又会重启并恢复为 `high`。根因是 CLI 历史只保存上游 `grok-4.5`，本地别名映射跳过了真实 Provider 路由重应用；同时 Renderer 硬编码展示模型未声明的推理档位。0.6.8 恢复会话时比较 ACP 原始 ID 并重新执行本地 `session/set_model`，努力档位改由 ACP 能力声明驱动，未确认切换不再重启会话，Provider 标签也必须有同进程网关观测。5 文件/28 项聚焦测试、TypeScript、生产构建和原生资源自检通过。本地 Setup SHA-256 为 `c0cff8253878d2c794b79a12370e677ad06a3315eab68ba12896c861a4353bd6`，已 per-user 安装为 0.6.8；应用保持关闭等待用户验收。正式资产、实机代验与 GitHub 上传仍按用户要求延期。

> **2026-07-27 CPA 鉴权补充：** 0.6.8 路由修正后请求已到达 CPA，但仍返回 HTTP 401。同一凭据直连 `/models` 和最小流式 `/chat/completions` 均为 HTTP 200，证明账号、密钥和上游正常。根因是回环网关转发了 CLI 传入的 `Authorization`；CLI auth recovery 后它可能是 xAI 会话令牌。0.6.9 改为主进程网关删除 CLI bearer/API-key/受管额外 Header，再从所选 Provider 的 Windows 用户环境变量新鲜读取并注入。Bearer、`x-api-key`、Header 覆盖和缺失密钥回归已通过；当前 CPA `grok-4.5` 的 Grok CLI → 网关 → 上游真实最小 ACP 回合也已通过。5 文件/43 项聚焦测试、TypeScript、生产构建、原生资源自检和 Fuse 校验通过；Setup SHA-256 为 `2a0cc83d69c6cfe2053f23e2d224986f057b28af1c2086d015bfe6f71259c70c`，已 per-user 覆盖安装为 0.6.9，快捷方式和安装 ASAR 检查通过。应用保持关闭等待用户验收；不生成正式完整资产、不上传 GitHub。

> **2026-07-27 逐模型 Provider 能力补充：** 当前 CPA `/models` 的 `grok-4.5` 不返回思考元数据，模型详情端点也不存在；但 `/responses` 默认及 none/minimal/low/medium/high/xhigh 最小流式请求均 HTTP 200。该结果仅证明 CPA 接受参数。隔离 Grok CLI ACP 以 Responses 后端启动，同会话 low → high 热切换并完成真实回合。0.6.10 不再把官方 Grok 4.5 的 high/medium/low 建议当成锁：上游元数据、逐模型用户配置、官方精确型号建议依次降级，未知模型不猜测，显式空列表不回填。Provider 管理器允许每个模型覆盖协议和任意思考档位；当前本机仅把 `CPA 兼容 · grok-4.5` 设为 Responses + xhigh/high/medium/low/minimal，其他 CPA 模型仍继承 Chat 默认。6 文件/47 项聚焦测试、TypeScript、生产构建、原生资源自检和 Fuses 通过。重建 Setup SHA-256 为 `2ae08474303b0f5a0d3b44c9f689f03618c4a17c0f6a8fee020f6d36763b2057`，已 per-user 安装，File/Product、快捷方式、安装 ASAR 能力标记和冷启动通过；应用已关闭等待用户验收，仍不扩大测试、不上传 GitHub。

> **2026-07-27 推理空闲超时补充：** 用户报告大请求遇到网络波动时约 60 秒取消。审计确认 Desktop 交互 ACP 总回合为 1800 秒、Provider 网关为 600 秒；缺失的是自定义模型的 CLI `inference_idle_timeout_secs`。0.6.11 对所有 Desktop 管理模型默认显式写入 360 秒，Provider 管理器允许逐模型设置 30–3600 秒，已有配置在会话启动前迁移，整个工具回合上限不被缩短。6 文件/47 项聚焦测试、TypeScript、生产/资源构建、Fuses、安装 ASAR、当前配置迁移、`grok inspect --json`、快捷方式与冷启动均通过。Setup SHA-256 为 `cf8f4f6a97e120c82ef243c35eb701a32da8bf779e45b4b16e9263886e3e9475`，已 per-user 安装；应用已关闭等待用户验收。日志中的 `ERR_CONNECTION_CLOSED` 仍表示上游/CPA/反代主动断开，若仍固定约 60 秒需同时提高服务端 idle/read timeout 或发送 SSE 心跳。没有扩大完整 UI/付费模型测试，也没有上传 GitHub。

> **2026-07-27 Provider 传输路由纠正：** 服务端随后确认多次失败均由调用方在 58/88 秒主动取消。重新读取当前 Grok CLI 内置配置参考后，确认其 `inference_idle_timeout_secs` 原生默认已经是 600 秒；0.6.11 的 360 秒并未触发，反而降低了默认值。应用日志和 Windows 连接证明受管 CPA 请求由 Electron Provider 网关经应用配置的本机 Mihomo 代理发出，失败为 `net::ERR_CONNECTION_CLOSED`；直连和代理 `/models` 均 HTTP 200，只能证明可达。0.6.12 恢复默认 600 秒，加入逐 Provider“继承应用代理 / 直连”及独立 session partition，并记录安全的请求 ID、路由、端点类别、阶段、耗时和断开来源；流在响应头后截断不再无记录。5 文件/41 项聚焦测试、TypeScript、公开扫描、生产/资源构建与 Fuses 通过。Setup SHA-256 为 `78729332967a5c51d1203d3fc7c8a36ca72c256161be196ba1462591b69d575b`，已 per-user 安装；File/Product、安装 ASAR、快捷方式、当前 CPA `direct`、六模型 600 秒、`grok inspect --json` 与冷启动通过，应用已关闭交给用户验收。不得声称长推理已成功；未发送付费测试、未跑完整 UI 套件、未上传 GitHub。

> **2026-07-28 Kiro Anthropic 兼容补充：** 当前本地 `127.0.0.1:8080` 的 Claude 4.8/5 模型并非不可用。应用日志确认上游已返回 HTTP 200，但 Kiro 的 Anthropic SSE `thinking` 起始块遗漏必需的 `signature`，Grok CLI 0.2.112 报 `missing field signature` 后主动关闭连接。0.6.13 Desktop 主进程网关现对所有 Anthropic Messages Provider 做同一安全适配：合法签名流逐字节透传，仅无签名 thinking 块转换为普通 `<think>` 文本，流式与非流式均覆盖，不伪造签名、不写死 Kiro/模型。聚焦网关测试 15/15、TypeScript、公开扫描、资源/生产构建与 Fuses 通过；当前 `kiro-claude-opus-4.8-thinking`、`xhigh` 经隔离 Grok CLI ACP 最小真实回合 1/1 通过（8.28 秒）。独立 Setup SHA-256 为 `7172de9ee614afb4afea471703cc5106aa294cbe93ec2471f996716675311a1f`，已 per-user 安装；File/Product/ASAR 为 0.6.13、ASAR 含适配标记、两快捷方式正确、Kiro-Go 未停止、冷启动通过，应用已打开等待用户真实会话验收。0.6.12 资产保留，未跑扩大 UI 套件，未上传 GitHub。

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

- 仓库：当前 `<repository-root>`（本机绝对路径不写入公开文档）
- 开发分支：`codex/v0.6.14-audit-fixes`
- 分支创建前 HEAD / `origin/main`：`05734cf4bdfef51988197b46d7249fed568696da`
- 分支创建前已有 0.6.7–0.6.13 本地候选的未提交实现；不得丢弃或从公开 0.6.6 重新制作。
- `package.json` / lockfile 已提升为 `0.6.14`。
- 本机 CLI 兼容基准：`0.2.112 (9bbd559437)`。
- 本机安装版仍是此前验证过的 0.6.13；本轮不覆盖安装。
- GitHub `v0.6.6` 仍为正式 Latest；0.6.14 不得在仅离线验证后发布。

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
