# Grok Build Desktop 多项目深度学习报告（2026-08-19）

## 1. 本轮不是再列一页仓库名

用户指出上一轮学习范围和深度不足是正确的。本轮把方法改为：

1. 用 `grok build desktop`、`grok build vscode`、`ACP client`、`AI agent desktop`、`provider switch`、`LLM protocol proxy` 等组合词在 GitHub 广泛粗筛。
2. Stars 只用于发现候选，不当作质量证明。
3. 对进入深学名单的项目至少检查：最近 Release/Changelog、最近提交、架构文档、与本项目高风险点直接相关的实现或测试。
4. 把“项目做了什么”进一步拆成可验证的行为、不适合迁移的部分，以及本仓库已经实现/仍缺失的映射。
5. 官方 [xai-org/grok-build](https://github.com/xai-org/grok-build) 始终是协议和 CLI 行为的第一权威；第三方项目只能提供宿主实现、交互和测试思路。

本轮没有复制第三方代码。AGPL、GPL、FSL/source-available 项目只学习行为和契约；即使是 MIT/Apache 项目，也优先 clean-room 重做并沿用本项目的 Electron 主进程安全边界。

## 2. 粗筛结果

以下数据是 2026-08-19 的 GitHub 只读快照：

| 项目 | Stars | 许可证 | 深学定位 |
| --- | ---: | --- | --- |
| [farion1231/cc-switch](https://github.com/farion1231/cc-switch) | 128245 | MIT | Provider/账号/配置切换、用量去重、升级迁移与 Windows 可靠性 |
| [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) | 50766 | AGPL-3.0 | Provider Registry、推理控制、流式所有权、Usage 事实模型 |
| [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | 47889 | MIT | 多协议翻译、SSE、错误归一化、模型别名和冷却路由 |
| [xai-org/grok-build](https://github.com/xai-org/grok-build) | 25682 | Apache-2.0 | Grok Build CLI/ACP 唯一协议权威 |
| [xenodium/agent-shell](https://github.com/xenodium/agent-shell) | 1749 | GPL-3.0 | 通用 ACP 会话恢复、输入所有权、队列和 heartbeat |
| [RongleCat/grok-app](https://github.com/RongleCat/grok-app) | 971 | MIT | 当前最值得深学的 Grok 桌面宿主：会话连续性、快速切换、媒体和项目迁移 |
| [formulahendry/vscode-acp](https://github.com/formulahendry/vscode-acp) | 356 | MIT | 标准 ACP 会话分页、动态配置、早到通知 |
| [phuryn/grok-build-vscode](https://github.com/phuryn/grok-build-vscode) | 157 | FSL/source-available | Grok ACP 边缘行为、大会话、MCP 结果和 Context/Usage 语义 |
| [dandandujie/Grox](https://github.com/dandandujie/Grox) | 75 | Apache-2.0 | Windows Grok 宿主恢复、Provider profile、发布完整性 |
| [rimusz/grok-build-desktop](https://github.com/rimusz/grok-build-desktop) | 26 | Apache-2.0 | 原生会话状态、输出清洗、进程隔离 |
| [JaydenCJ/grok-build-desktop](https://github.com/JaydenCJ/grok-build-desktop) | 20 | source-available | 流式事件队列、SQLite 队列、能力检查器；仅验证产品主张 |
| [Jane-o-O-o-O/grok-build-gui](https://github.com/Jane-o-O-o-O/grok-build-gui) | 13 | Apache-2.0 | 轻量 Grok GUI 对照 |
| [gallifre/grok-build-desktop](https://github.com/gallifre/grok-build-desktop) | 3 | Apache-2.0 | 安全工作台、幂等事务和 Review 架构护栏 |
| [Rushour0/grok-build-desktop](https://github.com/Rushour0/grok-build-desktop) | 1 | Apache-2.0 | 生成文件右栏、阅读布局和执行收据的旧版行为参考 |

没有把搜索结果中大量 API 转发、提示词合集、排行榜、SEO 仓库和停止维护的壳层写进计划。它们增加名单长度，但不能提高实现质量。

## 3. RongleCat/grok-app 深学结论

审计快照：`e9502bc`。检查了 `CHANGELOG.md` 的 Unreleased、0.2.18–0.2.22，`session-continuity.md`、`session-api.md`、`model-routing.md`、`media-delivery.md`、`providers.md`、`settings-ia.md`、更新流程文档和实际的 session move、send claim、图片缩略图、Provider route auth 代码。

### 3.1 会话身份不是一个字符串

它明确区分应用会话 ID 和 CLI agent session ID。对本项目最重要的不是命名，而是以下约束：

- 事件必须同时按进程、agent session 和当前 UI 所有者路由；无法确定归属时应丢弃或隔离，不能“猜到当前会话”。
- `session/load` 的回放期与 live prompt 的副作用期分开；没有真实 live turn 时，回放的 stream/tool/journal 不能重新触发正在运行状态。
- UI 当前查看的会话和 transcript 写入所有者分离；切换目标后先改变所有权，再载入磁盘，避免旧加载把正文写入新会话或反过来。
- 快速切换使用 generation token、本地 journal 先显、延后 reconcile 和连接防抖。

本项目已有 Projection V2、hydration generation、后台会话视图隔离，但还缺“进程 + CLI session + Desktop session”三元路由的集中审计，以及重叠 history load 的 single-flight 屏障。

### 3.2 草稿到真实会话需要原子认领

该项目近期修复了两个很容易被表面 UI 测试漏掉的问题：

- 所有空草稿不能共用同一个空身份；使用单调 view/focus epoch 区分它们。
- `__draft__` 的发送认领必须原子迁移到真实 session ID，否则首次发送成功后，迟到的 autosave/heal 仍可能把已发送正文当成草稿恢复。
- 每次发送有独立 send epoch；迟到或悬挂的异步发送不能修改当前输入框、忙碌状态或失败提示。
- 如果 optimistic assistant 一直为空、宿主也从未真正进入 turn，才在 30 秒后执行 ghost-stream heal；恢复输入并提升 epoch，而不是把旧异步任务继续当作当前任务。

本项目已有 `use-session-draft` 的 generation 和“用户编辑后拒绝迟到 hydration”，这覆盖了一部分；仍要补“首次发送的草稿身份迁移 + 发送 epoch + 自动保存回调”组合测试。

### 3.3 移动项目不能把旧 cwd 的 CLI session 硬装进新目录

它的 move 流程先验证目标、拒绝移动忙碌会话、释放旧 agent 身份、清理 worktree 绑定，然后在新项目下走 `session/new + journal bootstrap`。它刻意不在新 cwd 对旧 CLI session 直接 `session/load`。

本项目已有项目重新绑定事务、离线查看和官方能力回退。后续需要审计的不是再加一个“重新绑定”按钮，而是：忙碌门、附件/媒体/Review 根目录是否同事务切换、失败时 agent identity 是否完整回滚，以及旧 session 是否可能在新 cwd 被错误 Resume。

### 3.4 长任务按“无活动”而不是绝对年龄判死

- prompt 等待使用 30 分钟无活动超时，不设置总年龄强杀。
- 长工具约每 25 秒 heartbeat；最老工具有 3 小时安全边界，避免永久僵尸。
- prompt 返回后 journal 可能稍迟落盘，因此终态后的 reconcile 有有界重试。
- Host 崩溃会落一个明确 `host_exit`/cancelled 标记；用户继续是新 prompt，不复活旧权限 RPC。

这与本项目已移除绝对 30 分钟任务上限的决定一致。可吸收的是“活动证据”和“终态后短重试”测试，而不是重新加入总时长上限。

### 3.5 大会话性能不是只加虚拟列表

该项目在 48 条以上启用虚拟列表，同时专门处理：

- 内联工具折叠后出现 0 高度 plateau；
- thinking 展开/折叠导致的锚点变化；
- 高度仅变 1px 时不 remount；
- 滚动锚点按高度差修正，而不是每条回放都滚到底部。

本项目已有虚拟列表，但需要把“重叠 load 只 settle 一次”“工具折叠 0 高度”“用户正在查看历史时不恢复 stick-to-bottom”加入当前版本专属探针。

### 3.6 媒体采用缩略图、受控句柄和 Range

- 聊天图片由 Host 生成不超过 480px 的 JPEG 缩略图，缓存键包含 path、mtime、size；Lightbox 才加载原图。
- loopback 媒体服务使用随机 token 和 allowlist。
- 图片允许完整读取但有 40MiB 上限；视频、音频、PDF 以最大 2MiB Range 读取。
- 只有结构化工具输出经过会话作用域验证后才变成媒体卡；终端里出现的任意 URL/文件名不能自动升级成图片。

本项目有 `MediaAccessHandle` 和受控缓存，但没有通用聊天缩略图服务。用户先前多图、重开、图片占位问题正好说明这是高价值 P1，而不是纯视觉优化。

### 3.7 Provider 路由必须决定认证所有者

官方路由复制 xAI OIDC；自定义路由删除 agent-home auth，并跳过缓存 token authenticate。其关键点是 `providerMode` 显式存在，不能靠域名或模型名猜。

这对本项目 Provider Gateway 的含义是：Provider 身份、上游 Origin、凭据来源和模型别名要在会话启动前冻结；自定义 relay 失败时绝不能把官方 OIDC 或别的环境变量凭据发送过去。

## 4. phuryn/grok-build-vscode 深学结论

该项目许可证不允许直接复制，本轮只吸收经过源码/测试证实的行为。

### 4.1 MCP `structuredContent` 不能丢

近期 3.12.4 修复了 MCP 服务把真正结果只放在 `structuredContent`、`content` 只给一句说明的情况。还强调：

- 大对象必须在格式化过程中限长，而不是先完整 pretty-print 再截断。
- JSON 字符串不应为了美化而 parse 后再 stringify，否则 64 位整数可能失真。

本仓库当前未找到显式 `structuredContent` 规范化，这是确定的功能缺口。实现时应保留原始字符串、对象采用有界遍历、正文/结构化内容分别标注来源。

### 4.2 重叠 load 和滚动回归

- 同一会话同时发生的 load 由后来的调用 join 前一个；owner 失败要传播给全部 joiner。
- 旧实现会在大会话回放中约 1500 次强制滚到底部，修复后只在载入 settle 时决定一次。
- 最近使用时间应看真实 append 的 `updates.jsonl`；会被 `session/load` 重写的文件不能作为用户活动时间。

本项目虽有 generation 防迟到，但没有明确的 per-session single-flight load。generation 只防旧结果覆盖，不防两次昂贵加载、重复回放和 owner 失败语义分叉。

### 4.3 Context、Usage、Compact 三者不能混算

- prompt `_meta.usage` 是该 prompt 的账单事实；平铺 sibling 可能只是最后一次模型调用。
- session update 的 `_meta.totalTokens` 可能是上下文占用，不等于账单累计。
- `/compact` 或 `/session-info` 之后的 `totalTokens:0` 可能只是占位，不能把 UI 真实占用清零。
- `/compact` 可能回放旧回合的 billing sibling，不能重复入账。
- Grok 只观察到 cached read 时，不能凭空制造 cache creation/write。

本项目已禁止把 context occupancy 当花费，但仍需补 `0 placeholder`、Compact 回放去重和 per-prompt/sibling 归属测试。

### 4.4 早到通知和子会话通知

通知可能先于 `activeSessionId` 到达；child 的 `available_commands_update` 也可能从父连接上到达但携带 child session ID。正确做法是按 envelope/candidate session 暂存和路由，不能写入“当前会话”。这直接进入下一阶段 P0。

## 5. Grox、rimusz、Rushour、通用 ACP 客户端

### 5.1 Grox

[Grox](https://github.com/dandandujie/Grox) 最近版本最值得吸收的是恢复纪律：

- Provider 主文件缺失时，只能从当前 schema、活动 profile ID 和规范 endpoint 均匹配的备份恢复；已有主文件绝不覆盖，旧版明文或身份不匹配备份直接拒绝，发布采用排他原子写入。
- 永久删除不能被下一次目录扫描“复活”。
- 本地路径缺失与 CLI 连接失败分开呈现。
- Release 保持 Draft，直到资产、哈希和验证齐全。

本项目已有原子 JSON Store、Provider 身份和发布门禁，但 Provider profile 缺失恢复仍应按“身份 + endpoint + schema”三重匹配补对抗性测试。

### 5.2 rimusz/grok-build-desktop

[rimusz/grok-build-desktop](https://github.com/rimusz/grok-build-desktop) 使用原生 Swift，界面不能直接迁移，但数据层有三个好做法：

- 每聊天一个进程/会话，配 LRU 上限；后台完成只更新所属会话。
- live chunk、raw stdout、导入和恢复都经过同一 sanitizer，避免协议 JSON/工具原始标题泄漏到正文。
- 上下文占用和账单用量明确分离，ACP 不返回成本就不宣称成本。

### 5.3 Rushour0/grok-build-desktop

[Rushour0/grok-build-desktop](https://github.com/Rushour0/grok-build-desktop) 虽然 stars 低且较旧，但 Changelog 给了可验证的产品行为参考：生成文件完成后自动进入可调整宽度的右侧只读预览，图片/PDF/视频/文档统一进入同一工作台；执行收据集中消息、工具、Diff、计划和 Usage。可迁移的是“结果与右栏联动”，不是复刻旧 UI。

### 5.4 formulahendry/vscode-acp

[formulahendry/vscode-acp](https://github.com/formulahendry/vscode-acp) 对标准 ACP 的处理值得纳入兼容层：

- `session/list` 使用 cursor pagination；不支持时才退到本地缓存。
- session config options 动态渲染；旧 mode/model 是回退，不是主路径。
- commands/config/title 等通知早于 active session 时先按候选 session 暂存。

### 5.5 xenodium/agent-shell

[xenodium/agent-shell](https://github.com/xenodium/agent-shell) 最近修复揭示一个与本项目草稿恢复高度相关的边缘条件：用户在 history hydration 期间输入的文字，必须继续属于 live composer；异步 replay 不能把它当成历史输出或用恢复稿覆盖。它还只在明确 Markdown image 语义下解析相对图片，不把任意裸文件名升级成媒体。GPL 项目仅学习行为。

### 5.6 gallifre/grok-build-desktop

[gallifre/grok-build-desktop](https://github.com/gallifre/grok-build-desktop) 更像架构样板而非成熟产品，适合用作安全审查清单：

- session create/send/permission/patch/close 都有幂等键；
- event delta 16–50ms 批处理，但 final/tool/permission 立即投递；
- hunk ID 由 repo/path/blob/patch hash 构成，不依赖易漂移的行号；
- 文件恢复用校验过期的 reverse patch，不执行宽泛 `git checkout -- file`；
- PTY input 有 owner lease 和 sequence/gap；
- 路径显式处理 symlink、UNC、大小写碰撞。

这些是后续审计护栏，不是近期要扩成 PTY/多 Agent 工作台的理由。

## 6. Cherry Studio 深学结论

审计快照：`c1fa9a6`。检查了 2.0.2–2.0.7 Release、Provider Registry/Reasoning Control 文档、Stream Manager、AI Usage Records 以及相关测试。

### 6.1 推理档位必须拆成四层

[Cherry Studio](https://github.com/CherryHQ/cherry-studio) 的 reasoning-control 不是“按模型名写 if”：

1. 模型声明能做什么：effort/budget/toggle 和可选值。
2. endpoint 声明如何编码：Responses、Chat、Anthropic、Gemini 等 wire profile。
3. 用户选择是统一意图：`default/none/auto/minimal/low/medium/high/xhigh/max`。
4. 每次发送冻结不可变 request snapshot；队列和插话执行时不能读取之后变化的 UI 当前值。

特别重要的是“能力”和“wire dialect”是独立轴：同一个模型可有 effort UI，但某代协议仍要求 budget wire。Provider/model 的精确异常以 endpoint-keyed contract 覆盖，而不是往 Renderer 暴露任意 JSONPath。

这比本项目“扫描后直接写档位/传输字段”更稳定。后续 Provider 重构应采用：模型能力、上游协议编码、单次会话选择三层分离；扫描证据只能更新证据，用户确认后才更新能力配置。

### 6.2 Registry 采用“当前基线 + 稀疏用户差异”

预设 Provider 行只存身份和用户拥有的字段；Registry 连接配置每次读取时解析。预设模型行只持久化相对当前 Registry 的非空差异：

`用户非空差异 > provider-model override > model catalog`

这样上游目录更新能自动到达现有模型，用户自定义又不会被覆盖，也不需要每次目录变化都跑数据迁移。这个思路适合本项目未来的官方/已知 Provider catalog，但不应在 0.9.1 直接重写现有 TOML 和 profile 数据。

### 6.3 流式有单一所有者和统一终态

- Main 的 Stream Manager 持有执行循环和多播；Renderer 只是 listener。
- persistence、窗口、通知、SSE 都是 listener；终态按 persistence → notification → cleanup 排序。
- success、paused、error 都携带同一个已经累积到当前停止点的 `finalMessage`，失败不丢半段正文。
- 终态保留在共享状态，UI 用 read receipt 决定未读，而不是一结束就清掉。
- abort signal 继续传播进运行中的 MCP 工具。

本项目 Projection V2 和一次终态所有权方向一致；后续应重点核对 Stop 是否贯穿 Provider fetch、MCP tool 和投影提交，而不是增加第二套 Stream Manager。

### 6.4 Usage 是不可变调用事实，不是消息估算

- 一次真实 Provider 调用一条 insert-only record，`requestId` 幂等。
- Provider/model/credential/pricing 在请求前冻结，完成时不看“当前配置”。
- 每调用时长与整条消息时长分开；工具等待不写成 Provider latency。
- null 表示未知，显式 0 表示观察到 0。
- 账单记录只在调用成功并返回使用量后落事实；失败调用不伪造成功用量。

本项目的 Token 活动仍以 CLI 的精确数据为准；可吸收的是“请求前冻结归属”和“0/unknown”纪律，不需要复制它的 SQLite 模型。

### 6.5 最近 Release 给出的实际细节

- 2.0.7 修复 Provider Registry 不同尺寸模型误匹配。
- 2.0.5 修复带前缀、尺寸碰撞的模型 ID，跨助手移动改为原子操作，并限制后台 tab 内存。
- 2.0.4 将 abort signal 传播到进行中的 MCP tool，并限制 trace 保存。
- 2.0.3 降低 tab 切换 IPC/重渲染，Composer 显示 context usage。
- 2.0.2 修补目录 tree snapshot→stream 之间的丢事件窗口。

这些变化共同说明：目录归一化、快照→增量交接、后台保留上限和取消传播，比单纯增加 Provider 预设更重要。

## 7. CC Switch 深学结论

审计快照：`0b5da51`。检查了 3.18.0–3.20.0 Release、Grok Build config/provider/session usage 实现和 Windows 相关提交。

### 7.1 配置切换必须区分身份、live projection 和凭据

[CC Switch](https://github.com/farion1231/cc-switch) 的 Grok 配置实现给出几个具体教训：

- 官方登录态允许没有自定义 `[models]`；但只要出现残缺的自定义模型痕迹就必须报真实错误，不能误判为官方态吞掉。
- `base_url` 和 credential 独立解析；环境变量没注入 GUI 时，不能连带把已配置 endpoint 清空。
- `env_key` 未取到时失败关闭，绝不偷偷退到通用 `XAI_API_KEY`，否则会把另一个账号的密钥发给任意自定义 endpoint。
- MCP projection 和 Provider-owned config 分离，写回 Provider snapshot 前移除数据库拥有的 MCP 区域。

这与本项目之前出现的 Provider “Internal error/请求没到上游”直接相关：诊断页应分别显示 route、credential source、gateway scope，而不是只给一个“Provider 失败”。

### 7.2 Grok Usage 导入的正确性细节

它的 `updates.jsonl` 解析明确把 `turn_completed.usage` 当作逐回合总量，而不是会话累计；不做相邻事件差分。还做了：

- 使用 session + prompt + model 组成幂等 request ID；
- 只认终态 usage，忽略中途快照，避免双算；
- 接管代理和会话日志之间设置沉降窗，避免竞态双记；
- 单文件 50MiB 上限、目录深度 16、无条件跳过 symlink；
- `costIsPartial` 只显示下界，不伪装成完整成本；
- 按模型排序，保证反复重扫结果确定。

本项目不需要照搬其 Usage 数据库，但应补“同一轮代理 + CLI 投影双来源”去重测试，并把 partial cost 明确显示为不完整。

### 7.3 最近 Release 的高价值变化

- 3.20.0：数据库迁移前自动备份；多账号绑定保证切换不串账；环境检查不允许永久挂起。
- 3.19.2：从近 1900 个真实会话回放修复交错计数器导致的 6–8 倍虚高；所有无界读取加上限。
- 3.19.1：优先直连原生 Responses，只有服务不支持时才走本地协议转换；能力按 endpoint/厂商，不按模型名猜。
- 3.19.0：图片在协议桥中保持原生媒体，不序列化成工具文本导致 token 膨胀；应用更新可用镜像但仍保持资产来源和版本验证。
- 3.18.0：Grok Build Provider、OAuth、用量和代理接管；诊断日志跨重启、按大小轮转、全面脱敏。

## 8. CLIProxyAPI 深学结论

审计快照：`55397bf`。检查了 translator pipeline、stream forwarder、Responses streaming error、conductor stream/selection/cooldown、模型能力和配置示例。

### 8.1 Translator 只处理协议，路由/认证/冷却是另一层

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 把 request/response translation 建成注册表管线，并允许受控 middleware；credential selection、alias、cooldown 和执行结果在 conductor 层。这验证了本项目 `clientProtocol/upstreamProtocol/schemaProfile` 的方向，但还需要避免把“Provider 不健康”与“协议翻译失败”合成一个错误。

### 8.2 SSE 需要真实增量、背压和终态错误

- 每个 chunk 写完立即 flush；客户端取消沿 context 传播。
- keepalive 是独立事件，不冒充正文。
- upstream 数据通道关闭时先检查 pending error，再决定写 DONE。
- 流已经提交 HTTP headers 后，Responses 错误必须输出客户端能解析的顶层 `type:error` 或 `response.failed`，不能塞普通 `{"error":...}`。
- 空 stream source 是 retryable bootstrap error；只为判断能否启动而缓冲到第一个有效 payload，之后持续流式转发。

本项目已经有跨协议增量状态机，但应对照补“数据通道先关闭、错误通道稍后到达”“只有空 chunk”“headers 已提交后的 401/429/5xx”“别名重写尾包”的专项测试。

### 8.3 模型能力必须是精确配置

其配置将 alias、display name、max context、force mapping、兼容模式、thinking levels 和 excluded models 分开；支持前缀/通配排除和精确五档。最近提交又补了 `video_url`、OpenAI→Claude 的 `stop` 数组和 `max_completion_tokens` 兼容。

对本项目的结论不是增加更多任意字段，而是：

- Provider 模型身份与上游 alias 分离；响应可按需要映回本地身份。
- 推理档位优先使用用户确认或运行时证据，扫描不能偷偷覆盖。
- 协议差异形成有测试的 closed mapping；不允许用户编辑任意 request transform 脚本。
- request-scoped error action 应区分 retry/continue/cooldown，不能把所有 400/429 都归为“额度已用尽”。

## 9. 跨项目对照矩阵

| 主题 | 最成熟做法 | 本项目现状 | 结论 |
| --- | --- | --- | --- |
| 会话身份/事件路由 | RongleCat、phuryn：进程+session+UI owner，早到通知暂存 | 已有 session view/generation，child 通知仍需专项审计 | P0 补路由 Fixture 和失败关闭 |
| history load | RongleCat、phuryn：local-first、single-flight、失败 join、settle 一次 | 已有 Projection V2/local-first/generation；无明确 single-flight | P0 增加 per-session load barrier |
| 草稿首次发送 | RongleCat：draft claim 原子迁移、send epoch、ghost heal | 已有 hydration/touched generation、草稿迁移 | P0 补发送认领/迟到 autosave 组合测试 |
| Stop/终态 | Cherry：单一 owner、partial finalMessage；RongleCat：host-exit lease | 已有一次结算和先取消门 | P1 补 Host crash/终态后 reconcile，不建第二套状态机 |
| MCP 结果 | phuryn：content + structuredContent，有界保真 | 当前未显式消费 structuredContent | P1 实现规范化层 |
| Context/Usage | phuryn、Cherry、CC Switch：事实源分离、0≠未知、去重 | 已分开 Context/费用；Compact/0 placeholder 仍需回归 | P1 补语义测试 |
| Provider 推理 | Cherry：能力/endpoint wire/request snapshot | 当前已有协议/档位/扫描，但证据应用仍可更清晰 | P1 渐进重构，先不改持久格式 |
| Provider 安全恢复 | Grox、CC Switch：身份+endpoint+schema、凭据无静默回退 | 有集中 Provider 服务和原子存储 | P1 对抗性恢复和 route receipt |
| 媒体 | RongleCat：缩略图、handle、Range、结构化来源 | 有 handle/cache，缺聊天通用缩略图 | P1 实现 Host thumbnail service |
| 大会话/滚动 | RongleCat、phuryn：虚拟高度边缘、load settle、锚点 | 已有虚拟列表，旧 UI 探针不足 | P2 增当前版本夹具 |
| 文件/右栏 | Rushour、RongleCat：结果自动进入只读右栏 | 已有 Right Dock/Review/最近文件 | UI 轮优化，不再建新工作台 |
| 发布/更新 | Grox、CC Switch：原子迁移、Draft 资产门、版本验证 | 已有固定目标 CLI 更新和 Release 门禁 | 只补失败恢复证据 |

## 10. 研究后的实施计划

### 阶段 A：P0 会话归属与恢复（2026-08-19 已按本计划实现并聚焦验证）

1. **通知路由合同**
   - 为父/子/后台会话的 commands、mode、model、MCP、task、turn 事件保存脱敏 Fixture。
   - 所有事件先解析 envelope session ID，再映射 Desktop session；未知/歧义事件隔离，不能落到 active session。
   - 后台会话不得改变当前 Composer、停止按钮、模式徽章或命令目录。
2. **同会话 history load single-flight**
   - 同一 session 的重叠 load 只运行一次，后来的调用 join；owner 失败/取消传播给 joiner。
   - generation 继续负责“旧结果不得覆盖新会话”，single-flight 负责“同会话不重复昂贵加载”。
   - 回放结束只做一次滚动 settle，不在每个块上滚到底部。
3. **草稿/发送所有权**
   - 为首次发送增加显式 draft claim receipt 和 send generation。
   - 迟到 autosave、失败恢复、快速删除/重建草稿不得复活正文或清空用户新输入。
   - hydration 期间用户输入继续属于 Composer。

验收：聚焦自动化覆盖三会话交错、child 早到通知、重叠 load owner 失败、首次发送迟到回调和用户在恢复时输入；不发送付费请求。

### 阶段 B：P1 MCP、Usage 与 Provider 正确性

> 2026-08-21 实施状态：第 1–3 项已完成并通过聚焦测试；第 4 项因当前不存在独立持久化的预期身份/endpoint/schema 可信锚点而安全延期，现有主 Provider 配置不会被候选备份自动覆盖。

1. **MCP Tool Result V2**：同时保存有界 `content` 与 `structuredContent`，字符串保真，大对象流式/遍历限长，64 位 ID 不二次解析。
2. **Context/Usage 合同**：补 `totalTokens:0` placeholder、Compact 回放、per-prompt sibling、partial cost 和代理/日志双来源去重测试。
3. **Provider Route Receipt**：冻结 Provider ID、Origin、credential source、local/upstream model ID、协议和档位；错误详情分别显示路由、认证、翻译和上游阶段。
4. **Provider 恢复对抗测试**：profile ID、规范 endpoint、schema 全匹配才允许从备份恢复；不得覆盖现有主文件。

### 阶段 C：P1 媒体和长会话性能

1. Host 图片缩略图服务：会话媒体句柄 + path/mtime/size cache key + 受限 JPEG/WEBP 缩略图；Lightbox 才取原图。
2. 视频/音频/PDF 保持 Range；不把文件整体送进 Renderer。
3. 大会话探针覆盖：折叠工具 0 高度、thinking 展开、图片重挂载、load settle、用户离开底部后的锚点保持。
4. 媒体来源只接受结构化工具/Provider 产物和受信任 attachment ledger；裸终端 URL/路径不自动转图片。

### 阶段 D：P2 恢复、更新与架构收口

1. Host-exit turn lease 和明确中断标记；Continue 创建新 prompt，不复活旧权限/问题 ID。
2. 项目重新绑定事务复审：忙碌拒绝、agent identity、附件/媒体/Review 根、失败回滚。
3. Provider Service 先按存储、目录、扫描、网关生命周期拆测试，再移动代码；IPC 不变。
4. 上游跟踪继续以 official stable/changelog/source/runtime 四源为准；未知版本失败关闭。

### 阶段 E：交给 Grok 的独立 UI 轮

本轮不把这些算作底层成果：

- 会话正文视觉层级、字体、留白、密度和背景可读性；
- Plan/权限/问题/错误卡的统一视觉；
- 右侧只读文件/媒体预览的尺寸、工具条和空状态；
- 对话内搜索 UI、请求导航和大图画廊；
- Provider/设置的信息架构和高缩放视觉验收。

可借鉴的行为来源是 RongleCat 的阅读/媒体布局、Rushour 的可调右栏和 Cherry 的设置 registry；Grok 必须重新做真正的视觉审计，不能再用协议修补冒充 UI 学习。

## 11. 明确不纳入近期范围

- 宠物、手机遥控、IM 遥控和本地公开 Session API。
- 完整多 Agent 工作台和第二套任务编排器。
- 内置通用 PTY/终端工作台。
- 复制第三方 Provider 数据库或协议代理服务。
- 因版本号或模型名自动启用未验证能力。
- 为了视觉“像”而创建没有官方/本地真实后端的按钮。

## 12. 证据边界

- 本文是源代码、测试、Changelog 和 Release 的只读研究结果；没有运行第三方二进制。
- 本轮研究没有执行 `grok update`、付费推理、媒体生成、打包、安装、推送或 Release。
- 本轮没有宣称阶段 A–D 已实现；完成状态以 `docs/IMPLEMENTATION_PLAN.md` 后续复选项和实际测试证据为准。
