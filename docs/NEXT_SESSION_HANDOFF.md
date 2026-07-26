# Grok Build Desktop 下一会话完整交接（2026-07-26，0.6.5 候选收口中）

> 当前工作树已完成 0.6.5 的 TypeScript、全量离线测试、生产构建、依赖审计和两个显式 Provider live 探针，并已通过一次候选复审修复 5 个缺陷（见 **第 4B 节，当前状态以该节为准**）。尚未正式打包、安装或发布。不得把源码候选当作已交付版本，也不得覆盖已安装/已发布的 0.6.4。

## 1. 开场必读与禁止事项

按顺序读取：

1. `AGENTS.md`
2. 本文
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/FEATURE_MATRIX.md`
5. `docs/CODEX_UI_PARITY.md`
6. `docs/CLI_COMPATIBILITY.md`
7. `CHANGELOG.md`

随后立即执行：

```powershell
git status --short --branch
git diff --stat
grok version --json
```

禁止事项：

- 不要丢弃当前工作树，也不要从 `main` 重新开始。
- 当前源码可称为 0.6.5 候选，但不能称为已安装或已发布版本。
- 不要修改、移动或覆盖公开 `v0.6.4` 标签和资产。
- 正式打包与 `win-unpacked` 验收通过前，不要触碰已安装版或桌面/开始菜单快捷方式。
- 不要直接记录 Provider 密钥、完整请求正文、提示词、账号信息或响应中的凭据。
- 不要一次性跳到 0.6.6 打包；先完整收口并正式发布 0.6.5。

## 2. 已锁定的用户目标与版本拆分

用户已批准以下两阶段交付：

### 0.6.5 稳定修复版

- 更新与诊断四项操作必须有运行、成功、失败、取消和结果反馈。
- 计划批准必须幂等，不能重复发送 `[Plan approved]`、不能产生第二轮回答。
- 排队、编辑、删除、排序和插话必须有可见回执；不支持即时插话时明确降级。
- Provider 错误默认折叠、可展开查看脱敏详情。
- Grok Free 滚动 24 小时 Token 限额与周/月账单额度分开。
- 设备码登录只能自动打开一个浏览器窗口。
- Computer Use 允许控制普通权限 Codex；高权限目标仍按 Windows 完整性边界降级。
- 最近文件不再把读取位置、AppData 和 `.grok` 路径当作回合写入文件。
- 自定义模型显示 Provider 前缀。
- 增加主进程回环 Provider 网关，优先修复 Gemini/Antigravity 对工具 Schema 空枚举的 HTTP 400。
- 允许对用户当前 Provider 做一次小规模真实验证，以完善为优先但不得大规模消耗。

### 0.6.6 能力完善版

- Git 与非 Git Review；非 Git 只使用真实写入前后快照，不伪造 Git。
- `TurnFileChange`、会话/Worktree 真实根目录、受信任外部文件和可靠跳转。
- 每回合精确 Token 与耗时；设置中提供 24h/今日/7天/30天/月度汇总和 53 周活动图。
- OpenAI Chat、Responses、Anthropic Messages、Gemini GenerateContent/SSE 和兼容网关之间的完整主进程协议转换。
- 模型别名/排除、按模型/协议 Payload 规则、模型发现扩展。
- 完整离线套件、正式打包、安装、冷启动和 GitHub Release。

Provider 网关架构参考：

- <https://github.com/router-for-me/CLIProxyAPI>
- <https://github.com/router-for-me/CLIProxyAPI/blob/main/docs/sdk-advanced.md>
- <https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml>

决定是**参考其执行器/Translator/模型路由架构，使用 TypeScript 在 Electron 主进程实现窄范围网关，不捆绑完整 Go 服务**。

## 3. 中断时的仓库、版本和外部状态

- 工作目录示例：`E:\Users\TestUser\Documents\GROK`（实际以当前仓库根目录为准）
- 当前分支：`codex/v0.6.5-0.6.6`
- 分支基点/HEAD：`71660b3 docs: update README screenshots and add friend link`
- `origin/main` 与本地 `main` 同为 `71660b3`
- 中断时源码/lockfile/显示版本为 `0.6.4`；**已在 4A 提升为 `0.6.5`**
- 当前改动未提交、未推送、未打标签
- 当前安装版仍是已验证的 0.6.4
- GitHub Latest 仍是：
  - <https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/tag/v0.6.4>
- 本机 CLI 已从交接文档中的 0.2.106 升级为：

```json
{"currentVersion":"0.2.112 (9bbd559437)","channel":"unknown"}
```

0.6.5 必须把 CLI 0.2.112 纳入兼容记录和计划/排队/Provider 实际边界验证。

## 4. 当前未提交文件

已修改：

```text
native/GrokComputerHost.cs
src/main/app-controller.ts
src/main/services/auth-service.ts
src/main/services/computer-use-service.test.ts
src/main/services/computer-use-service.ts
src/main/services/grok-acp-adapter.ts
src/main/services/grok-process-manager.ts
src/main/services/grok-quota-service.test.ts
src/main/services/grok-quota-service.ts
src/main/services/provider-service.ts
src/renderer/src/App.tsx
src/renderer/src/components/MessageCard.tsx
src/renderer/src/components/ProviderManagerDialog.tsx
src/renderer/src/components/RightUtilityPane.tsx
src/renderer/src/components/TurnCard.tsx
src/renderer/src/styles.css
src/shared/types.ts
```

新增且未跟踪（截至 4B，已含续做与复审新增）：

```text
scripts/probe-installed-v065.mjs
scripts/probe-v065-ui.mjs
src/main/services/grok-plan-decision.contract.test.ts
src/main/services/provider-cli-environment.live.test.ts
src/main/services/provider-current.live.test.ts
src/main/services/provider-gateway-service.ts
src/main/services/provider-gateway-service.test.ts
src/renderer/src/components/RightUtilityPane.test.ts
```

中断前统计（不含未跟踪文件，仅历史参考；当前统计以 `git diff --stat` 为准）：

```text
17 files changed, 374 insertions(+), 67 deletions(-)
```

## 4A. 2026-07-26 续做后的当前验证状态

原中断快照之后已完成：

- `npm version 0.6.5 --no-git-tag-version`，源码与 lockfile 已为 0.6.5；Sidebar 改为读取主进程版本，不再硬编码。
- Plan 决策键改为 `sessionId + requestId`，缓存上限 128；批准/继续规划/取消/备注/重复点击契约测试通过，未生成第二个 Prompt。
- Auth 增加可注入 `--no-browser` 检测；应用所有浏览器和 CLI 所有浏览器两条测试通过。
- Provider URL 环境变量、旧块迁移、删除和回滚测试通过。
- Provider 网关增加 64 MiB 响应上限、可配置超时、取消/背压和结构化错误测试。
- rolling24h 持久化到 `quota.json`；重启恢复与过期标记测试通过。
- 最近文件相对显示，外部打开使用主进程返回的绝对路径；错误详情增加凭据和本机用户路径脱敏测试。
- 隔离 CLI `base_url = "${ENV}"` live 探针通过：CLI 0.2.112 完成 ACP Prompt 并到达本地 `/v1/chat/completions`。
- 用户允许的当前 Provider 最小真实 Prompt 通过新网关；Schema 清理计数大于 0，未复现空枚举 HTTP 400。

## 4B. 2026-07-26 候选复审与修复（当前最新状态）

在打包前对候选做了一次完整复审，**在 0.6.5 新代码中发现并修复了 5 个真实缺陷**。每个修复都配有先失败、后通过验证过的回归测试（先还原缺陷确认测试失败，再恢复修复确认通过）：

| 级别 | 缺陷 | 修复位置 |
| --- | --- | --- |
| P0 | `desktopEnvironment()` 抛错会阻断**所有**会话启动（含不使用 Provider 的会话）。只读注册表、被并发修改的 `config.toml` 或 `validateConfig` 失败都会触发 | `provider-service.ts` 降级为尽力而为 + `app-controller.ts` 外层兜底 |
| P1 | 网关 `start()` 并发竞态：并行会话各自 listen，`dispose()` 只关最后一个，其余端口泄漏 | `provider-gateway-service.ts` 共享 in-flight listen |
| P1 | `standard` Schema 档并非直通，会静默改写所有 Provider 请求体中的 `enum`，与 CHANGELOG 和计划矛盾 | `sanitizeProviderSchema()` 提前返回 |
| P1 | 请求体经 `toString("utf8")` 往返，二进制/multipart 负载被破坏 | 按字节转发 |
| P2 | `quota.captureError` 排在 `webContents.send` 之前且调用方是裸 `void`，保险库/磁盘失败会**吞掉用户最需要看到的错误事件**并产生未处理拒绝 | 改为脱离主链路 + 服务自吞失败 |

新增回归测试 5 项（网关 3、Provider 1、额度 1）。

已通过的完整门槛：

```text
Test Files  64 passed | 4 skipped (68)
Tests       319 passed | 7 skipped (326)
TypeScript  passed
production main/preload/renderer build  passed
npm audit --omit=dev  0 vulnerabilities
```

跳过项全部是环境门控 live 探针：`GROK_LIVE_COMPUTER`（2）、`GROK_LIVE_PROVIDER_PROBE`（1）、`GROK_CURRENT_PROVIDER_PROBE`（1）、`GROK_LIVE_GATEWAY_*`（3）。第 4A 节记录的「105 项聚焦测试」是子集口径，以本节全量数字为准。

### 4B-2. 用户确认后追加的体验修复

| 事项 | 位置 |
| --- | --- |
| 二进制文件返回 `kind:"external"` 而非 throw，PNG/PDF/压缩包不再是死路 | `editor-service.ts` `open()` + `BinaryFileError` |
| composer 永不 disable，改为拦提交并说明原因；新增「插话」按钮 | `App.tsx` Composer + `onBlockedSubmit` |
| 失败/取消回合也显示耗时、Token 与结果徽章 | `TurnCard.tsx` `TurnMetrics` |
| Token 圆环保留 512K 兜底（**用户明确要求**，「上下文上限未知」文案过丑），仅在 tooltip 注明为估算 | `App.tsx` `TokenDonut` |
| 模型发现识别 Gemini 系上游时自动预选 `gemini` Schema 档 + 新增「Gemini 兼容」预设 | `ProviderManagerDialog.tsx` `looksGemini` |

### 4B-3. 真实上游端到端验证（用户授权）

用户提供了自己的 Gemini 系聚合端点做验证。三次真实调用：

```text
无工具基线            → HTTP 200
空枚举工具 + standard → HTTP 400  GenerateContentRequest…enum[4]: cannot be empty
空枚举工具 + gemini   → HTTP 200
```

第二行**逐字复现了用户最初上报的失败**，第三行证明网关的 Schema 清理确实修复了它，同时验证了 `standard` 档确为直通。

由此发现并修复了一个新问题：`schemaProfile` 默认 `standard`，所以任何人新添加这类提供商仍会在第一次带工具的回合撞上同样的 400。现已在模型发现阶段自动预选 `gemini` 档。

探针保留为 `provider-gateway.live.test.ts`，门控于 `GROK_LIVE_GATEWAY_KEY` / `_BASE` / `_MODEL`。**密钥仅存在于运行时环境变量，仓库内无任何凭据。**

### 4B-4. Computer Use 安全修复（用户确认后进入 0.6.5）

多视角分析 + 逐条对抗性反驳后，13 条通过、5 条被推翻。其中三条属安全性而非易用性，已修：

| 问题 | 原因 | 修复 |
| --- | --- | --- |
| 急停不粘滞，agent 一个工具调用后夺回控制 | `emergencyStop()` 只翻状态，不取消回合、不设守卫；`confirmNewApps` 默认 false 使 `start()` 直接成功 | 新增 `emergencyStopped` 集合；`emergencyStop` 返回受影响会话，控制器据此取消回合；`start()` 拒绝直到显式重新授权 |
| 全局裸 `Esc` 热键 | `computer-use-overlay.ts` 注册全局 `Esc`：目标应用内按不了 Esc，且主机合成的 `press_key esc` 会触发自身急停 | 移除全局注册；`Ctrl+Alt+Esc` 为唯一 OS 级开关，并检查注册返回值，失败时浮层如实显示「回到 Grok 窗口停止」 |
| CLI 启动失败导致租约永久泄漏 | 释放租约的 `closed` 事件只从 `exit` 处理器发出，而 spawn 失败只有 `error`+`close` | `emitClosed()` 幂等，在所有 dispose 路径（含提前返回与 kill 超时）各发一次 |

三条均有先失败后通过验证的回归测试。**被推翻的 5 条**中值得记录的一条：「调色板承诺了目标选择器但不存在」——该选择器是故意移除的，`probe-v042` 现已断言它不得出现。

其余已确认但未修（0.6.6 候选）：提权死路的三条（分类到达 UI、区分瞬时 UAC 与永久提权、消息不再被截断）、always-allowed 列表不可查看/撤销、截图尺寸滑块、`@Computer` 不在提及菜单且每条 `@` 消息都枚举窗口。

### 陈旧验收探针（本轮修复，13 条 + 2 类竞态）

`probe-v042-ui.mjs`(8)、`probe-v062-ui.mjs`(3)、`probe-overlay-entry.mjs`(2) 的断言自 0.6.4 设置对话框重构后就已失效。**根因是本地探针链从未在 CI 执行过**——`package-win.ps1` 的 `GITHUB_ACTIONS` 分支只跑 `probe-hosted-release-ui.mjs`，这 7 个本地探针烂了两个版本无人发现，0.6.4 的「打包验收通过」并未覆盖它们。

除选择器外还修了两类竞态：展开「开发工具」与点击条目写在同一个同步 `evaluate` 里（依赖 React 是否同步 flush，时好时坏），以及 `probe-overlay-entry` 在重试循环里反复点击标题导致展开状态震荡。`probe-v062` 硬编码的版本字面量改为由 `smoke-app.ps1` 从 `package.json` 派生（`GROK_EXPECTED_APP_VERSION`），不再需要每次发版手改。

`probe-v065-ui.mjs` 的失败与选择器无关：对话是虚拟列表，错误卡片位于加载视口之外因而未挂载。已加 `scrollToFind` 遍历滚动容器。**静态审计看不到这类问题，只能靠实跑。**

### 复审记录的未修项（不阻断 0.6.5，留待评估）

- 网关 `redirect: "manual"` 会把 3xx 原样透传，而 `location` 不在允许响应头内，CLI 会收到一个没有 Location 的 3xx。已把 CHANGELOG 措辞改为准确的「不跟随重定向」；是否转成明确 502 待定。
- 流式响应在响应头返回后即 `clearTimeout`，SSE 长流挂死没有超时兜底。
- `MessageCard.redactErrorText` 会把任意盘符改写成 `C:`，多盘符环境的诊断路径会被误导。
- `App.tsx` 1311 行、最长单行 3754 字符；本轮两个新状态是硬塞进那一行的，建议在 0.6.6 窗口内拆分 `Composer` / `SettingsDialog` / `PromptQueueBar`。
- ~~Composer 的 `<textarea disabled>`~~ 已在 4B-2 修复。
- **对话框顶部裁剪：查证后无法复现，未改。** CSS 推算显示 `.settings-dialog`(`100vh-40px`) 与 `.control-panel`(`94vh`) 超出 backdrop 内容框(`100vh-60px`)，但在 1280×720、1280×720@1.5 DPR、1024×640 三种配置下实测（改与不改各一轮）均为 `top=30`、标题可见、`clipped=false`——浏览器把居中栅格项约束到了内容框。候选修复已回退，不发布未经证实的全局对话框改动。
- **结构化错误摘要目前只对夹具格式生效。** `summarizeError` 解析 `HTTP nnn` / `Provider: x`，而全仓库产出该格式的只有离线夹具（`app-controller.ts:757`）。真实错误会退化成「首行」。根治需要 0.6.6 的结构化 `TurnFailure` 事件，见下。
- **痛点 #2（非 Git Review）与痛点 #3 的导航入口仍未做**；#3 的死路已在 4B-2 解除，但文件浏览器/Git 工作台目前仍只能靠偶然到达。

当前剩余的 0.6.5 工作：

1. 已完成 251 文件公开源码扫描与源码构建的 0.6.5 离线 UI 夹具；不要重复这一候选前门槛。
2. 运行唯一一次正式打包，验证完整离线套件、Fuses、产物扫描、Setup/Portable/SBOM/许可证与 SHA-256。
3. 在同一 `win-unpacked` 上复用 0.6.5 UI 探针，补齐版本、更新操作、错误折叠、逐回合指标、文件预览、Provider 管理和输入区边界。
4. 通过后执行 per-user 安装、冷启动与 About/诊断/进程/快捷方式验证。
5. 提交/推送/PR/合并/tag，等待 GitHub Release workflow 的 Draft 回下载与 provenance/哈希复核，再发布 Latest。

> 第 2–5 步是不可逆的对外动作（正式打包、安装到本机、公开 Release）。**必须先取得用户明确同意再执行**，不得因为本文件列出了这些步骤就自行开始。

下面第 5–7 节保留的是**原始中断时的历史审计**，其中“尚未验证/尚未完成”已由第 4A、4B 节覆盖，不得再当作当前状态。当前状态以 **4B** 为准。

## 5. 原始中断时已写入但尚未验证的 0.6.5 内容（历史）

### 5.1 公共类型与 IPC 契约

`src/shared/types.ts` 已增加：

- `ProviderUpstreamProtocol`
- `ProviderSchemaProfile`
- `QueueOperationReceipt`
- `PlanDecisionReceipt`
- `QuotaWindow.unit = "tokens"`
- `GrokQuotaSnapshot.rolling24h`
- `TurnUsage`
- `TurnPresentation.usage`

队列/插话/队列管理 API 和 `respondPlan` 的返回值已从 `void` 改为结构化回执。Preload/IPC 调用仍依赖现有透传，尚未专门验证类型和运行时契约。

### 5.2 计划批准与队列

`grok-acp-adapter.ts` 当前改动：

- 计划决策按 JSON-RPC request ID 使用 `resolvedPlanRequests` 幂等。
- 批准后只回复原 `x.ai/exit_plan_mode` 请求，删除了额外：

```text
[Plan approved] ...
现在执行该计划。
```

- “继续规划”和取消仍返回 JSON-RPC error；备注放入 `error.data.comment`。
- 批准备注放入成功结果的 `comment` 与 `annotations.comment`。
- 批准后切到 Agent；拒绝后保留 Plan；取消后切到 Agent。
- 队列新增、编辑、删除、排序、清空和插话返回结构化回执。
- 通知式队列操作会先在本地乐观更新并等待 CLI 的 `x.ai/queue/changed` 校正。
- Renderer 计划卡首次点击立即进入“提交中”，锁定三个决策按钮并显示结果。
- Composer 与队列栏会显示“已排队/插话已提交/等待 CLI 确认”等反馈。
- 仅 `queued` 条目可编辑或删除；`sending/interjected` 显示禁用原因。
- `needs-user` 时 Composer 显示必须先处理计划/权限/问题。

尚未完成：

- 没有新增计划 JSON-RPC 契约测试。
- 没有验证 CLI 0.2.112 对拒绝 error、批准备注字段的真实行为。
- `resolvedPlanRequests` 当前按 Adapter 生命周期保留，尚未增加有界清理。
- 需要确认 `applyMode("agent")` 与原计划请求恢复的顺序不会造成死锁。
- 需要验证乐观队列更新不会被短暂空队列回显覆盖。

### 5.3 Provider 回环网关与 Schema 修复

新增 `provider-gateway-service.ts`：

- 只监听 `127.0.0.1` 随机端口。
- 每进程随机不透明 route token。
- 每条路由包含 Provider ID。
- 仅接收 POST，输入上限 8 MiB。
- 禁止自动重定向。
- 复制必要请求头并删除 Host、Content-Length、Connection 等 hop-by-hop 头。
- 上游响应按流转发，并只回传允许的状态/Trace/限流/计时头。
- 不记录凭据或正文。
- `sanitizeProviderSchema()` 当前可：
  - 从 `enum` 删除 `null` 和空字符串。
  - Gemini/strict 模式从联合 `type` 删除 `"null"`。
  - 删除 null default 和部分不支持的 Schema 关键字。
  - 保留工具名、required 和属性语义。

`provider-service.ts` 当前改动：

- 每个管理 Provider 新增上游协议和 Schema profile。
- 新增 `GROK_DESKTOP_PROVIDER_<ID>_BASE_URL` 用户环境变量。
- `config.toml` 管理块的 `base_url` 改为环境变量引用。
- 直接 CLI 继承真实上游 URL；桌面创建 CLI 进程时覆盖为回环路由。
- 旧管理块在首次桌面会话启动时尝试迁移到环境变量引用。
- 模型显示名写为 `提供商名 · 模型名`。
- `GrokProcessManager` 新增 Provider 环境回调。
- `AppController.dispose()` 会停止 Provider 网关。
- Provider 管理界面已增加“CLI 请求协议、上游协议、工具 Schema”选择器。

已增加但未运行的测试：

- Gemini 报错中三个空枚举/nullable 字段的清理。
- 工具名与 required 保留。
- 回环网关路由、请求清理、SSE 响应和 Trace 头透传。

重大未完成点：

- 当前网关只做**同协议透传和 Schema 清理**，未实现 0.6.6 的跨协议转换。
- 必须验证 Grok CLI 0.2.112 确实对 `base_url = "${ENV}"` 做环境展开。
- 必须验证旧 Provider 自动迁移、失败回滚、并发 config.toml 修改和 Provider 删除。
- `Readable.fromWeb(... as never)` 等 Node 类型写法可能需要调整。
- 必须验证 Electron `session.fetch` 返回体经 Node 流转发的取消和背压。
- 当前真实 `antigravity/CPA` Provider 尚未发起验证请求。
- 严禁在测试日志、支持包或交接文档写入真实 Provider 密钥。

### 5.4 登录、Computer Use 和额度

设备码登录：

- 启动前调用 `grok login --help` 检测 `--no-browser`。
- 支持时使用 `login --device-auth --no-browser`，由应用只打开一次 URL。
- 不支持时由 CLI 自行打开，应用不再自动打开。
- 现有单飞 `loginPromise` 保留。

待验证：

- Auth 测试夹具尚未为 `login --help` 能力检测增加注入接口，已有测试可能受实际子进程探测影响。
- 需要新增“应用所有浏览器/CLI 所有浏览器”各一次打开的测试。

Computer Use：

- Renderer 主进程策略与 `native/GrokComputerHost.cs` 均已从阻止列表删除 `codex`。
- 测试已改为普通 Codex 允许。
- Grok Build Desktop、ChatGPT、PowerShell、CMD、Windows Terminal、UAC/Windows Security 等仍阻止。
- 高完整性目标的原有 `controllable:false + blockedReason` 路径未删除。

待验证：

- 需要重新编译原生 Host 并运行 self-test/受影响 Computer 测试。
- 需要普通 Codex 窗口和高权限测试夹具的实际验收。

额度：

- `GrokQuotaService.captureError()` 可解析：

```text
rolling 24-hour window — tokens actual/limit: 1,056,458/1,000,000
```

- 生成独立 `rolling24h` Token 窗口，不再映射为周/月账单。
- 会话 error/status error 会尝试采集该信号。
- 账号页已增加 Token 单位、来源、模型和重置展示。
- 已增加解析测试但未运行。

待完成：

- 当前 rolling 数据只在内存中，应用重启后丢失；0.6.5 至少应按账号持久化最近一次观察。
- 两个 billing 请求都失败且没有旧缓存时，应确认 rolling24h 仍返回。
- 错误格式、重置时间和模型字段需要覆盖更多 CLI 0.2.112 形状。

### 5.5 Renderer 反馈、错误与文件

更新与诊断：

- 设置页四个按钮已增加 running/success/error/cancelled、本地时间、结果文本和复制。
- 应用更新明确是手动下载。
- CLI 更新显示当前/最新。
- 诊断按钮实际切换面板。
- 导出日志显示路径或“已取消”。

错误卡：

- 默认折叠。
- 摘要显示 HTTP/Provider/首行。
- 展开显示脱敏后的完整错误。
- 支持复制脱敏诊断。

最近文件：

- `lastTurnPaths` 只从 `group.kind === "files"` 收集。
- 绝对路径必须位于会话/Worktree 执行根目录。
- 文件预览失败改为右栏行内错误，并提供系统默认应用打开，不再立即弹全局红色错误。

回合指标：

- `turn_completed.usage` 会写入 `TurnPresentation.usage`。
- Prompt response 只有总量时也可记录。
- 最终回答底部显示处理时间、输入/输出/缓存/推理/总量。
- 缺少明细时显示“明细不可用”，不估算。

待完成：

- 当前只是每回合 UI 展示，没有 0.6.6 Token 活动持久化、汇总或热力图。
- 最近文件仍不是持久化 `TurnFileChange`；真正的非 Git before/after 快照尚未开始。
- CSS 是追加式改动，必须进行多尺寸视觉回归。
- 设置页操作反馈、折叠错误、计划锁定和键盘队列尚无 Renderer 测试。

## 6. 原始中断时的编译/行为风险（历史，已由 4A 更新）

下一会话不要直接继续加功能，先处理以下风险：

1. `AppController` 在 `GrokProcessManager` 回调中引用稍后赋值的 `this.providers`，需由 TypeScript/启动测试确认。
2. Provider 网关 Web Stream → Node Stream 类型可能不通过 TypeScript。
3. Provider 环境变量迁移可能改变现有 `config.toml`；必须用隔离 `GROK_HOME` 测试。
4. `ProviderService.upsert/remove` 新增 base URL 环境变量后的回滚路径需要补测。
5. Auth `login --help` 探测需可注入，否则现有单元测试可能访问不存在的 fixture CLI。
6. Plan reject/cancel 的 JSON-RPC 语义在 CLI 0.2.112 上未验证。
7. 计划备注字段可能被 CLI 忽略；不得恢复为无条件第二个普通 Prompt。
8. Queue notification 没有真正 request/response ACK；UI文案应保持“已提交/等待确认”，不能称“服务器已完成”。
9. `rolling24h` 尚未持久化。
10. 版本、Sidebar 版本文案、package-lock、Changelog、实施计划、功能矩阵和 CLI 兼容文档都仍是 0.6.4。

## 7. 原始中断时建议的执行顺序（历史，当前从 4A 剩余项继续）

### A. 先恢复 0.6.5 工程健康

1. 运行：

```powershell
npm run typecheck
```

2. 修复所有类型错误，不顺手扩展 0.6.6。
3. 运行直接受影响测试：

```powershell
npx vitest run `
  src/main/services/grok-acp-adapter.test.ts `
  src/main/services/grok-acp-adapter.contract.test.ts `
  src/main/services/provider-service.test.ts `
  src/main/services/provider-gateway-service.test.ts `
  src/main/services/grok-quota-service.test.ts `
  src/main/services/auth-service.test.ts `
  src/main/services/computer-use-service.test.ts `
  src/renderer/src/components/MessageCard.test.ts `
  src/renderer/src/store.test.ts
```

4. 按失败结果补齐：
   - Plan exact-one-response 契约测试。
   - Auth browser ownership 测试。
   - Provider URL 环境变量/迁移/回滚测试。
   - Queue 回执与乐观回滚测试。
   - Settings 操作反馈和错误折叠测试。

### B. 完成 0.6.5 而不是提前做 0.6.6

1. 持久化 rolling24h。
2. 完成 Provider 同协议透传的取消、超时、响应大小和错误结构。
3. 使用隔离 `GROK_HOME` 验证 CLI 0.2.112：
   - `inspect --json`
   - `models`
   - `base_url` 环境变量展开
   - ACP initialize/session/new
4. 用假 ACP 验证批准/拒绝/取消/备注/重复点击不会多发 Prompt。
5. 做一次用户允许的当前 Provider 最小真实推理验证：
   - 只发最小无敏感内容 Prompt。
   - 记录是否还出现 enum null/empty 400。
   - 只记录状态、Schema 修改计数、Trace 和耗时，不记录正文或密钥。
6. 验证普通 Codex Computer Use 与高权限降级。
7. 运行 TypeScript、受影响测试、生产构建和公开扫描。
8. 验证通过后再：
   - 将源码、lockfile、显示版本提升为 0.6.5。
   - 更新 `CHANGELOG.md`、`IMPLEMENTATION_PLAN.md`、`FEATURE_MATRIX.md`、`CODEX_UI_PARITY.md`、`CLI_COMPATIBILITY.md` 和本文。
   - 正式打包一次。
   - per-user 安装并冷启动验证。
   - 提交、推送、PR/合并、打 `v0.6.5` 标签。
   - 等待 Release workflow 完成 Draft 回下载、SHA-256 与 provenance 验证后确认 Latest。

### C. 0.6.5 发布后再做 0.6.6

1. 从已发布 0.6.5 基线继续，不在半成品上混合版本。
2. 实现 `TurnFileChangeService`：
   - 只接受真实写工具。
   - 保存 before/after hash 和受限文本。
   - 二进制/大文件只保存标记。
   - 会话/Worktree 根目录与受信任外部范围。
3. 实现非 Git Review 的 Last turn/Session changes。
4. 实现 `TokenActivityService`：
   - 每回合精确数据。
   - 日汇总保留13个月。
   - 删除会话时删除明细。
   - 53周热力图和时间范围筛选。
5. 扩展 Provider Translator：
   - Chat ↔ Responses
   - Chat/Responses ↔ Anthropic Messages
   - Chat/Responses ↔ Gemini GenerateContent/SSE
   - 工具调用、流式文本、结束原因、错误和取消映射
6. 完成 0.6.6 完整离线验证、一次正式打包、安装和正式 GitHub Release。

## 8. 0.6.4 已验证基线（不可重复宣称为新证据）

公开 `v0.6.4` 已完成：

- 60 个测试文件通过、1 个按设计跳过。
- 291 项测试通过、2 项显式 opt-in/live 跳过。
- TypeScript、生产构建、公开源码扫描、Electron Fuses 通过。
- Setup、Portable、SHA-256、SBOM 和许可证报告已发布。
- per-user 安装、About、诊断、进程版本和快捷方式已验证。
- GitHub Release workflow `29993675891` 成功。

当前源码候选已有 4A 所列的新验证证据；0.6.4 仍是安装与公开发布回归基线。

## 9. 建议下次开场原文

```text
先读取 AGENTS.md、docs/NEXT_SESSION_HANDOFF.md、docs/IMPLEMENTATION_PLAN.md、docs/FEATURE_MATRIX.md、docs/CODEX_UI_PARITY.md、docs/CLI_COMPATIBILITY.md 和 CHANGELOG.md，并检查 git status。当前在 codex/v0.6.5-0.6.6 分支，0.6.5 已通过 TypeScript、105 项聚焦测试、生产构建、251 文件公开扫描、源码离线 UI 夹具、隔离 CLI 环境展开和一次当前 Provider 最小真实探针；从 4A 的唯一正式打包、安装与发布剩余项继续，不要丢弃工作树。0.6.5 正式发布后再继续 0.6.6。
```
