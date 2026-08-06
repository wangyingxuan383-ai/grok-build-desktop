# Grok Build Desktop 下一会话完整交接（2026-08-06，0.7.0 本地候选）

> **CLI 0.2.118 适配进度：** 已建立受控更新、运行时能力快照、官方优先会话删除、Compact/Recap/后台任务乱序兼容，以及 0.2.119/0.2.120 的事件前向解析。所有受管子进程已禁用 CLI 自更新；本机已从 `grok 0.2.117 (f1c0609308)` 精确升级到 stable `0.2.118 (1e1687c1cf)`。真实握手、空会话删除及一次最小 Plan 已通过；0.7.0 已完成全量离线门禁、正式打包、per-user 安装和安装版冷启动，当前是等待用户桌面验收的本地候选，不是公开发布版。

> **接手顺序：** 先由用户验收已安装的 0.7.0，重点检查现有长会话的 Plan/Stop、两个真实并行模型会话和已配置自定义 Provider。受管 Provider 下一次启动时会把旧 `reasoning_efforts` 数组表迁移为 0.2.118 接受的字符串列表。0.2.119/0.2.120 未由 stable 下发时禁止强装；0.7.1 功能只保留 Fixture 前向解析。验收前不要推送或创建 Release。

## 2026-08-06 ACP 0.2.120 前向适配 A–D 已完成

- A：能力证据覆盖标准 `session/list`、`session/resume`、`session/close`，使用脱敏 0.2.120 源码形态 Fixture；本机 stable 仍为 0.2.118。
- B：重开会话优先 `session/resume`，只有明确能力错误才回退 `session/load`；resume 缺字段时保留请求的 session ID并从握手恢复模型；退出尽力 `session/close` 后再释放子进程。
- C：Plan 决策卡等待时允许改模型，权限/问题等待不解锁；Provider 本地模型身份不被上游别名覆盖。
- D：ACP 用户回放携带稳定消息 ID、附件预览、资源链接；直接图片/MCP 提取图片和重复事件合并去重，缺少稳定媒体来源的事件不会被误删。
- 当前证据：8 个聚焦测试文件、121 项通过；随后完整门禁 94 个测试文件、673 项通过（9 项按设计跳过），TypeScript、生产/资源构建、公开扫描和 Renderer 分块门禁通过。首次候选打包暴露离线媒体夹具 PNG 不被 Electron `nativeImage` 接受，已替换为真实 RGBA PNG；同轮还将 Windows `EPERM/EBUSY` 短暂锁竞争纳入重试。最新 Setup/Portable 已从同一构建重新生成，打包版 UI、Fuses、Task Scheduler、中文/空格 Portable 冷启动均通过；未推送、未创建 Release。

> **0.7.0 当前状态：** 工作分支为 `codex/v0.7.0-audit-hardening`，已在 `19cff12 chore: checkpoint v0.7.0 audit candidate` 保存实施前基线，未重置既有改动。源码、lockfile、File/Product、安装版及 About 均为 **0.7.0**；尚未推送、未创建 Release、未覆盖既有 0.6.x 资产。

> **本轮已完成的关键审计修复：** 会话运行时按会话保存 Provider/本地模型/上游别名/思考档位/模式/执行档案，Provider 失败不回退；Plan 决定立即关闭旧交互门并异步切模式；稳定 turnId 结算迟到/重复终态；accepted/running 队列持久化；ConversationProjection V2 对 ACP 回放做缺失尾部合并；JsonStore/自动化采用事务锁和显式取消；附件、媒体句柄、打开位置、CLI 路径及符号链接做主进程可信边界校验。

> **验证证据：** 最新候选完整门禁通过 94 个测试文件、673 项离线测试；6 个 live 文件、9 项按设计跳过。TypeScript、生产/资源构建、341 文件公开扫描、Native/Computer Host、24/24 Computer Use、Electron Fuses、Renderer 分块、0.7.0 打包 UI、Task Scheduler、中文/空格 Portable 冷启动及 `npm audit`（0 漏洞）通过。真实 CLI 0.2.118 最小只读 Plan 在 19.28 秒内完成，无权限卡、无工作区写入。真实自定义 Provider、双模型并行及既有长会话 Stop 仍是用户验收边界。

> **0.7.0 本地产物：** Setup SHA-256 `72570af030c79cc691bf6413eb9f80c49b15282b1eed46863cc52acb71eab851`；Portable SHA-256 `85fbcf62aab193d0277ab47d81424c89ce181494b79413d2db92c09dc186bc7c`；SBOM SHA-256 `5c4a9d715a2262a6101c6a748ee0738defac4dc48d670bdd547b9e5e08f06553`；许可证报告 SHA-256 `382a29a84ec5dcf10c5e4532b34ae419aad97674b4fc36ea2a1ef504eef252c5`。桌面和开始菜单快捷方式均指向 `%LOCALAPPDATA%\Programs\Grok Build Desktop\Grok Build Desktop.exe`，ASAR 与 Fuses 已验证。

> **下一步顺序：** 用户在桌面安装版验收 0.7.0；仅对验收暴露的问题运行受影响测试。通过后再更新公开发布状态、推送分支并创建 Release。0.7.1 继续等待 stable 实际下发 0.2.119/0.2.120 后再做真实能力验收。

> **0.6.25 当前工作状态：** 用户复验 0.6.24 后仍遇到 Plan 长回合持续 Stop、停止无反馈及 Plan 权限问题，并要求排查同类缺口。补充只读审计确认旧门禁仍有四类结构性漏洞：PowerShell 脚本块可藏在看似只读的管道里；工具显示标题可把未知工具伪装成读取；Plan 文件门只拦工作区写入而放过任意外部路径；没有拒绝选项时 Desktop 返回 JSON-RPC error，可能让 CLI 重试或保持等待。源码现改为拒绝优先的命令解析、显式 ACP kind、仅当前会话精确 `plan.md` 可写及标准 `cancelled` 回执。

> **终态/停止修复：** Desktop 排队 Prompt 现在把 client prompt ID 绑定到待决 RPC；即使 CLI 只发 `turn_completed` 而不返回 Prompt response，也能准确清空对应回合。Renderer 的 Stop 改为等待主进程既有的八秒单会话恢复路径，并在 Composer 显示停止中、已停止/已恢复或失败，不再静默 fire-and-forget。

> **0.6.25 交付验证：** 聚焦 4 文件/85 项通过；最终候选 82 文件/488 项离线测试通过，6 个 live 文件/9 项按设计跳过。TypeScript、生产/资源构建、303 文件公开扫描、Computer Host 自检、Fuses、打包版/Portable UI、Task Scheduler、per-user 安装、冷启动、File/Product、主进程/About/诊断、支持包排除和桌面/开始菜单快捷方式均通过。源码/lockfile 与安装版均为 **0.6.25**，应用已打开交给用户复验；公开 Latest 仍是 **v0.6.22**，验收前不推送、不创建 GitHub Release。

> **0.6.25 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.25-x64.exe` SHA-256 `4026ce1d961a0ca7f8c66d0fca0cf48a2c5ce1ecac60174d20d838ddcdce1908`；`release/Grok-Build-Desktop-Portable-v0.6.25-x64.zip` SHA-256 `6041acb6c378cd75d1e7247b1198e45b1803a4f01c448b8deaa9f1a51d3c3477`；SBOM SHA-256 `c325145cae452395436502420ad236b02f3530875f5d1695878bd4f8d75ccd8e`；许可证报告 SHA-256 `38c0f836e6d6f7db676836cf42c2c2baf71f0411bb297718b4d48748ac453a23`。四项与 `release/SHA256SUMS.txt` 一致，旧资产保留。

> **0.6.24 当前工作状态：** 用户指出 0.6.23 仍复现“继续规划后 Stop 永久存在”和 Plan 权限问题，证明此前只靠模拟分类测试的结论不足。对照当前官方 Grok Build 源码后发现三项真实根因：Desktop 把“继续规划/取消”错误地作为 JSON-RPC error 回给 `x.ai/exit_plan_mode`，恢复会话的 `current_mode_update=plan` 只改布尔值且随后可能被全局 Agent 模式覆盖，CLI 为普通 Prompt 发布的内部 `runningPromptId` 又被误当作 Desktop 排队消息，真实回合完成后创建幽灵第二回合。源码现按 `approved/cancelled/abandoned` 成功结果响应，逐 Prompt 固定 `_meta.mode`，模式设置失败不再静默成功，并只允许 Desktop 自有 queue/interject ID 启动后续回合。

> **真实验证：** 本机 CLI `0.2.117 (f1c0609308)` 的 `session/set_mode=plan` 握手通过；隔离空目录的真实只读 Plan 回合在修复前复现“已有完成事件但新 activeTurn/working=true”，加入队列所有权后再次运行通过：无 Renderer 权限事件、目录零写入、计划安全退出、最终无 active turn 且 `working=false`。这是已执行的真实小模型回合，不再只是分类函数测试。

> **0.6.24 交付验证：** 最终候选通过 82 文件/483 项离线测试，6 个 live 文件/9 项按设计跳过；TypeScript、生产/资源构建、303 文件公开扫描、Fuses、打包版/Portable UI、Task Scheduler、per-user 安装、File/Product、主进程/About/诊断和桌面/开始菜单快捷方式通过。首次正式打包探针暴露工作区选择器返回焦点竞态，修复后候选完整通过。

> 当前工作分支为 `main`，源码/lockfile 与 per-user 安装版均为 **0.6.24**，公开 Latest 仍是 **v0.6.22**。应用已打开交给用户复验现有长会话的“继续规划”、Stop 恢复及 Plan 无权限弹层；验收前不推送、不创建 GitHub Release。

> **0.6.24 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.24-x64.exe` SHA-256 `4f2d37bb24822ef0fd83e966205041c00638fed22df5b19126eb45847e4abf92`；`release/Grok-Build-Desktop-Portable-v0.6.24-x64.zip` SHA-256 `afe51b3acbcc5510998b4c869cda1d10f39a9705f88d025952103dda180de6a8`；SBOM SHA-256 `2560a0057063baebc8e08b6a2659483ab35c40434da2567577b9dbebe8a6c2c7`；许可证报告 SHA-256 `cd012783338307b57dbd5186b079252d12494424c286e52fc7b70e5ea48dacb6`。四项与 `release/SHA256SUMS.txt` 一致，旧资产保留。

> **0.6.23 当前工作状态：** 用户在 0.6.22 实机复现“继续规划”后已经出现最终回答，但 Composer 永久保留停止按钮、停止无效且退出被判定仍有任务；同时 Plan 仍弹权限卡。根因是适配器只在队列分支响应 `_x.ai/session/update.turn_completed` 清理 `working`，普通 Prompt 又可能永远收不到原始 RPC response。源码现以 turn ID 用权威终态结算对应 Prompt；Stop 八秒不确认时仅重建该会话 Adapter；Plan 只读自动允许、修改/未知自动拒绝且不再弹权限卡，并识别 underscore ACP kind 与安全 PowerShell 只读管道。聚焦 5 文件/80 项及最终 81 文件/478 项离线测试通过，5 个 live 文件/8 项按设计跳过；TypeScript、生产/资源构建、公开扫描、Fuses、打包版/Portable UI、Task Scheduler、File/Product、快捷方式和安装版主进程/About/诊断均通过。真实“继续规划”、Stop 和 Plan 只读回合仍由用户验收。

> 当前工作分支为 `main`，源码/lockfile 与 per-user 安装版均为 **0.6.23**；公开 Latest 仍为 **v0.6.22**。本地验收完成前不要推送或创建 GitHub Release。

> **0.6.23 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.23-x64.exe` SHA-256 `345753b1d2ab4ade56dff41853ce8cab6c077282929debb42b99f08f73da76c4`；`release/Grok-Build-Desktop-Portable-v0.6.23-x64.zip` SHA-256 `2c5b7d388b67dc45e3622c69965fef0d24eb3b4fd9b1874ef91212f3bccbcc02`；SBOM SHA-256 `38a36fcb19cdb6a5444a23c3777538160d4055fa5c904076b2e24c6751362939`；许可证报告 SHA-256 `cac5f92371edba36011a559dd1e2424e7a0ebe7f55276b6430d7c72227f6a997`。四项与 `release/SHA256SUMS.txt` 一致，旧资产保留。

> **发布后交互超时热修：** 普通 Prompt 与排队后续 Prompt 原先都由 Desktop 在 1800 秒后强制 `cancel`。该总时长上限已移除；长回合现在只会因 CLI 正常完成、用户主动停止、进程退出或真实传输/Provider 失败而结束。Provider 的 `inference_idle_timeout_secs` 仍是独立的无数据超时，不是总回合上限。此项仅作为发布后源码小改动提交 GitHub，不移动 `v0.6.22` 标签，不创建新 Release。

> **0.6.22 公开发布状态：** PR #19 将 v0.6.7-v0.6.22 的已验收源码合并到 `main`；Windows、Gitleaks、CodeQL 和代码扫描通过。首次 Release workflow 在创建草稿前因 Windows PowerShell 5.1 破坏中文脚本字面量而失败，没有产生 Release；PR #20 将该步骤切换到 PowerShell 7。workflow `30693283048` 随后重新构建、公开扫描、生成 attestations、下载并校验 SHA-256/来源证明，已将 `v0.6.22` 发布为 Latest。发布页使用版本专属中文说明，不再展示整份累计英文 Changelog。

> **0.6.22 当前工作状态：** 用户在 0.6.21 验收中再次看到“图片文件不可用”、媒体任务误报工作区外、ZDR 视频错误和插话状态紊乱。只读核验确认生成图片文件仍存在，破图来自 sandboxed Renderer 被 Chromium 拒绝加载 `file://`；无头媒体的实际相对产物属于显式 `--session-id` 的临时 Grok 会话，旧缓存边界只信任 cwd；视频失败是团队启用 Zero Data Retention 后 API 强制要求 `output.upload_url`，当前 CLI 工具没有该参数；插话不是独立 Agent，而是同一 ACP 会话的已提交高优先级后续回合，旧适配器没有给它建立本地队列/turn 边界，叉号只删除了错误的本地表现，不能撤回已接受请求。源码已增加受限 `grok-media:` 协议、精确临时会话信任根、首次媒体失败即停止和 ZDR 分类；插话提交后标为不可撤回，在上一回合收束后建立独立 turn/user-message/status，迟到的上一回合 Promise 不会结算新回合。最终 80 文件/465 项离线测试通过，5 live 文件/8 项按设计跳过；TypeScript、生产/资源构建、Computer Host 自检、公开源码/资产扫描、diff check、Fuses、打包版/Portable UI、任务调度、安装版主进程/About/诊断/File/Product/快捷方式均通过。现有历史图在安装版 `grok-media:` 中实际解码为 1024x1024。0.6.22 已 per-user 安装并正式发布；没有发送新的图片/视频或付费模型请求，真实新媒体和插话顺序仍是用户验收边界。

> **0.6.22 发布时状态：** 正式分支为 `main`，源码/lockfile 与 per-user 安装版当时均为 **0.6.22**。公开 Latest 是 **v0.6.22**，旧本地和公开资产全部保留。

> **0.6.22 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.22-x64.exe` SHA-256 `509899d6f9836e1a5f33966a2736442b0b796d9cdc3b624decfaddca17b32da0`；`release/Grok-Build-Desktop-Portable-v0.6.22-x64.zip` SHA-256 `f764ee0fb49f37f1c8fc97671d3c72e7b918ffcdf581be6920036d564f2f590b`；SBOM SHA-256 `68c2d0b4904492070f20e108605484bda923603c8a3fb0488c81f713296bb130`；许可证报告 SHA-256 `bb132d306dfff20fb1274bf7b1b13d41e1556e04cf5f89f9e00f81b044266a9f`。四项与 `release/SHA256SUMS.txt` 一致；旧资产保留。

> **0.6.21 当前工作状态：** 用户在 0.6.20 验收中指出只能同时运行一个会话。主进程 `GrokProcessManager` 实际已经按会话保存独立 `GrokAcpAdapter`，最多保留 8 个，运行/等待会话不会被回收；真正限制来自 Renderer 的单个全局 `sending`：`session:send` Promise 等到整个模型回合结束，期间切换到任何任务都会禁用 Composer，也让本会话的排队/插话形同不可用。源码已改为会话/新建草稿键级提交状态，收到该会话第一条 `working` 即结算传输锁；后台失败只恢复自己的持久草稿，不覆盖当前任务的 Composer、附件、焦点或滚动。左栏加入逐会话状态文字和项目活动任务数量。聚焦 4 文件/51 项及完整 80 文件/462 项离线测试、TypeScript、生产/资源构建、Computer Host 自检、299 文件公开扫描、diff check、Fuses、正式资产与安装版主进程/About/诊断/快捷方式检查已通过；5 个 live 文件/8 项按设计跳过。0.6.21 已 per-user 安装并打开，真实双会话并行留给用户验收；不推送、不创建 GitHub Release。

> **0.6.20 当前工作状态：** 用户在 0.6.19 验收中复现 CLI 生图返回 `images/1.jpg` 后被误判为工作区外、图片卡不可用、媒体任务另开会话、多图纵向占用过大、运行中回合误报“没有可见正文”、Composer 回执无法关闭，以及 Plan 只读过程持续询问权限。根因已分别定位为媒体路径表达式允许零点前缀并截断到 `/1.jpg`、Renderer 在活动会话为 working/needs-user 时主动放弃原会话、`grok --single` 默认持久化无头会话、媒体卡未聚合、TurnCard 未区分 live/terminal、回执无生命周期，以及 Plan 权限层未识别 ACP 安全只读工具。源码已修复：普通相对路径保持在真实 cwd；媒体复用当前 Grok 会话并用临时 UUID 隔离/清理 CLI 会话；结果四项折叠双列画廊；live 无正文文案与终态分离；提示可关闭且 5 秒自动消失；Plan 默认一次允许明确只读工具/查询命令，写操作和未知工具仍不放行。最终 79 文件/457 项离线测试通过，5 个 live 文件/8 项按设计跳过；TypeScript、生产/资源构建、297 文件公开扫描、diff check、Fuses、正式资产与安装版探针通过。0.6.20 已 per-user 安装并打开供验收；没有发送媒体/付费请求，没有推送 GitHub 或创建 Release。

> **0.6.19 当前工作状态：** 用户在 0.6.18 验收中确认右侧 `Agent 改动` 虽已有真实文件与增删行，但窄 Dock 仍显示不可读的左右并排 Monaco Diff；同时指出权限/计划仍不像 Codex。Renderer 已改为默认 unified Diff、自动换行、紧凑文件操作和 620px 容器级响应式布局。权限/计划按本机当前 Codex 安装包的只读结构核对改为临时抬升决策面：作用域操作在左、拒绝和主操作在右、窄容器堆叠；可选计划说明默认收起。0.6.18 的一次请求、提交成功立即移除和陈旧请求收起语义保持不变。聚焦 Renderer 2 文件/32 项、TypeScript、生产构建、native resources、295 文件公开扫描、Fuses 与资产扫描通过；唯一一次 0.6.19 正式打包、per-user 安装、File/Product/ASAR、快捷方式及安装版主进程/About/诊断夹具通过。应用已打开交给用户实机权限/计划验收。未推送 GitHub，未创建 Release。

> **0.6.18 当前工作状态：** 用户在 0.6.17 验收中复现的权限/计划卡不消失、陈旧计划响应报错、长代码裁切、真实文件写入无增删行且非 Git Agent 改动为空、消息“发送中”不结算及多账号拥挤风险已修复。只读计划通知不再覆盖可响应 RPC；决策成功发出 `interaction-resolved`；CLI stdin 写入即结算消息；当前 Grok Build ACP 的嵌套 `ToolCallContent::Diff` 被正确解析、持久化和恢复；真实写入才计入文件改动。最终门槛为 78 文件/447 项离线测试通过，5 个 live 文件/8 项按设计跳过；TypeScript、生产构建、295 文件公开扫描、diff check、正式打包、Fuses 和安装版探针通过。0.6.18 已 per-user 安装并打开供用户验收；未发送付费提示词，未推送 GitHub，未创建 Release。

> **CLI/接口结论：** 本机 CLI 已是 `0.2.117 (f1c0609308)`。官方开源 Grok Build 的 ACP 转换确实把 Search/Replace 编辑发布为 Diff 内容，包含路径、新文本和可选旧文本；之前空白不是 CLI 没开放接口，而是 Desktop 只读取了非标准顶层字段且没有接受当前 `kind="edit"`。非 Git 改动仍不伪造 staged/commit/branch。

> **0.6.17 当前工作状态：** 用户在 0.6.16 验收中复现了历史生成图破图/悬浮操作遮挡、右栏文件预览越界、手工 Gemini 图片传输保存时 TOML 重复表失败，以及上下文探测慢且无实际价值。工作树已修复旧无标记 Desktop 模型表迁移、显式媒体配置无需扫描、单模型媒体快速检测、图片不可用回退/内联操作和文件预览换行边界；普通 UI 已移除自动上下文探测。最终源码门槛为 78 文件/436 项离线测试通过，5 个 live 文件/8 项按设计跳过；TypeScript、生产构建、295 文件公开扫描与 diff check 通过。唯一一次正式打包、per-user 安装、File/Product/ASAR/Fuses/快捷方式、安装版主进程/About/诊断探针及只读 Computer Use 主界面/设置/Provider 管理界面检查均已通过；应用保持打开供用户验收。

> **重要纠正：** 0.6.16 所称“UI 重构”主要完成了组件/样式分层和可靠性基础，视觉变化不足，用户的批评成立。0.6.17 只完成本次已复现的可见热修，不将其夸大为整体 Codex 视觉重做。用户验收前仍不推送、不创建 GitHub Release，并保留 0.6.15/0.6.16 资产。

> **0.6.21 合并前历史状态：** 工作分支为 `codex/v0.6.14-audit-fixes`，源码/lockfile 与 per-user 安装版当时均为 **0.6.22**，公开 Latest 当时仍为 **0.6.6**；0.6.15–0.6.21 本地资产已保留。

> **0.6.21 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.21-x64.exe` SHA-256 `1cbcab6028a1f80da889c0ade45afe4e2be31aa4a24756091abaf35a1cf9d566`；`release/Grok-Build-Desktop-Portable-v0.6.21-x64.zip` SHA-256 `705804618834e8a9d223e047c49983a5423e1e94d8719697c16d988cbe0ff6e2`；SBOM SHA-256 `e6da6af4ab4e619cf9c593f38c1c5849e8d50bb732bb89908af1efe084c99f95`；许可证报告 SHA-256 `a069226c1c5fb645aa3ac4a34c445bacb70d7eb41704cfbe7006894fabd6a4e6`。四项与 `release/SHA256SUMS.txt` 一致；旧版本资产保留。

> **0.6.20 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.20-x64.exe` SHA-256 `d9e6cb8112ac57650f510614019c2fcbf6e5768282b9f3f89774ff9ae9506e26`；`release/Grok-Build-Desktop-Portable-v0.6.20-x64.zip` SHA-256 `2c6c88afa1b12a279c33d1f796d80773c4beab449ff4571ca433c8b4b3becdc5`；SBOM SHA-256 `a67a3820e87da1a4a97bd8ba054301a85e698081b44b761dc8f0a6152c691773`；许可证报告 SHA-256 `bfd207e11936e3ca0379187c5593a3405886750fe2afaa5befb47b5e973bb8db`。四项与 `release/SHA256SUMS.txt` 一致；0.6.15–0.6.19 资产保留。

> **0.6.19 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.19-x64.exe` SHA-256 `704f6f7800bed7a3b85613a7cbe056edef420051f3c318c9b8c912481d56f114`；`release/Grok-Build-Desktop-Portable-v0.6.19-x64.zip` SHA-256 `f247e8db88c8f18ae91991f8e04321b3ad91eababc76975a30bae21ea08cf9b5`；SBOM SHA-256 `39826d4bdb70ea1048057685ec14bb2cb0e7ad70aa7a4d925e3ee6219cf4ace1`；许可证报告 SHA-256 `8b9a103b47d318eee02349ad396dc7e662bb19bd3c44006a6b383c41f2018787`。四项与 `release/SHA256SUMS.txt` 一致，0.6.15–0.6.18 资产保留。

> **0.6.18 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.18-x64.exe` SHA-256 `964a1bd8147dff0a9f4ab88de66a9b0e223ec5610d51f4e9803226c6a9c6c6dd`；`release/Grok-Build-Desktop-Portable-v0.6.18-x64.zip` SHA-256 `fe866130abdafdaffda6946487436def2c34ebe88b71852ee08eba6c1955030e`；SBOM SHA-256 `53488ed37063c5017751c2c02a56a855bff464aa87d8fda522eb055d8429ebe6`；许可证报告 SHA-256 `0eedf4138938b59a9be06db056dbb372fa91e04cc31a21ad87010abd517044e4`。四项与 `release/SHA256SUMS.txt` 一致，0.6.15–0.6.17 资产保留。

> **0.6.17 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.17-x64.exe` SHA-256 `248b8951e3e6140597e7207aee32163e40dde3ebba83e438bc3d28a8e980a790`；`release/Grok-Build-Desktop-Portable-v0.6.17-x64.zip` SHA-256 `ba0a3ff5e62de2e4be91b294b39f712c346264e176c2bee722c099741f97af7c`；SBOM SHA-256 `8d33ce062366fa31545513f997fef68d14b8b59a3f39c1194deda0f1bddbf46a`；许可证报告 SHA-256 `240dd504f521b61874a9011d127f24d2b58b0bc632086fa3d5d654a9e7b3e8d8`。四项与 `release/SHA256SUMS.txt` 一致，0.6.15/0.6.16 资产保留。

> **2026-07-31 0.6.16 当前状态：** 已实现可恢复 Provider 扫描 Job、逐子阶段进度、单模型入口、generation 隔离取消、安全/精确上下文探测、Provider/模型启停、零模型保存和选择性应用扫描结果；新增会话可见块投影持久化，失败、取消、重置和重开保留已显示的部分回答；媒体支持 Auto/CLI/Provider 路由、固定 CLI 工具白名单和 streaming-json 产物解析；目录/文件/图片打开、原生右键与可信图片操作、12K 长文本附件化及 Renderer 壳层拆分已完成。最终门槛为 78 文件/432 项离线测试通过，5 个 live 文件/8 项按设计跳过；TypeScript、Computer Host 0.3.1、自检资源、生产构建、295 文件公开扫描、Fuses、打包版/Portable UI 和任务调度探针通过。0.6.16 已 per-user 安装，File/Product/ASAR、桌面/开始菜单快捷方式及冷启动的主进程/About/诊断均通过；真实 Provider/CLI 媒体推理留给用户验收。未推送、未创建 GitHub Release。

> **0.6.16 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.16-x64.exe` SHA-256 `240a40edf380462039ae215952e2b86465afe87165e567faed9141f95c0b56b4`；`release/Grok-Build-Desktop-Portable-v0.6.16-x64.zip` SHA-256 `5a33b6f6f7516706bf03607c7181cdfda9482a774692617a7ed4addad5664036`；SBOM SHA-256 `a045e91512b2ad588ce5a526c804360c3c054d060b8578ce1e13b460c50792b9`；许可证报告 SHA-256 `627fbd0405980ce8e85dbb220cd889ca698c737589b145c69b6625dac3d4981f`。四项与 `release/SHA256SUMS.txt` 一致；0.6.15 资产保留。

> **2026-07-31 0.6.15 当前状态：** 已实现 Chat/Responses/Messages/Gemini 主进程协议转换、逐模型客户端/上游协议、兼容家族、六种思考传输、能力扫描/取消/合并/应用、协议矩阵与五档 Grok 4.5 迁移。真实证据：本机 grok2api Grok 4.5 三协议扫描及 Responses+xhigh ACP 通过；远程 CPA Grok 4.5 Responses 扫描及 xhigh ACP 通过；CPA Gemini 三协议/工具续写扫描及 Chat ACP 通过。CPA Claude 当前直返 HTTP 502，本机图片生成当前也为 HTTP 502，不能声称可用。离线门槛为 74 文件/406 项通过，5 live 文件/8 项按设计跳过；TypeScript、生产构建、278 文件公开扫描和 diff check 通过。唯一一次正式本地打包已生成 Setup、Portable、SBOM、许可证与 SHA-256，并完成 per-user 覆盖安装；File/Product/ASAR、Fuses、兼容标记、桌面/开始菜单快捷方式和四进程冷启动均通过。应用已关闭等待用户验收；不要推送或创建 GitHub Release。

> **0.6.15 本地产物：** `release/Grok-Build-Desktop-Setup-v0.6.15-x64.exe` SHA-256 `101441bca66cda47cd6914602cf7f76e2a4a394dd520368d6b328d769f847327`；`release/Grok-Build-Desktop-Portable-v0.6.15-x64.zip` SHA-256 `8c486be2973bf11fdf11cad4f97f0d408f9e03feb5968f7daaede8d0cbaeeeff`；SBOM `064427a935658859b2bc2a941ea264449cb75dd1fb08467b02487d562f0ac032`；许可证 `1a97400171dbb383bf5dc7403d229e568e3e970b29b348d671e75aec709c5464`。四项均已重新计算并与 `release/SHA256SUMS.txt` 一致。

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
- 正式分支：`main`；公开 Latest/标签仍为 `v0.6.22`，本地 0.6.23 验收前不移动标签。
- 分支创建前 HEAD / `origin/main`：`05734cf4bdfef51988197b46d7249fed568696da`
- 分支创建前已有 0.6.7–0.6.13 本地候选的未提交实现；不得丢弃或从公开 0.6.6 重新制作。
- `package.json` / lockfile 已提升为 `0.6.23`。
- 本机 CLI 兼容基准：`0.2.117 (f1c0609308)`。
- 本机 per-user 安装版已覆盖为 0.6.23；File/Product、Fuses、桌面/开始菜单快捷方式以及主进程/About/诊断探针通过。
- GitHub `v0.6.22` 已是正式 Latest；Release workflow `30693283048` 与远端 SHA-256/attestation 校验通过。

## 3. 0.6.5/0.6.6 已实现范围

### 稳定交互

- 计划批准/继续规划/取消按 `sessionId + requestId` 幂等；只回答原 `x.ai/exit_plan_mode` 请求，不再制造 `[Plan approved]` 第二条 Prompt。
- 排队、编辑、删除、重排和插话有回执；不支持即时插话时明确降级到队首。
- 更新、CLI 检查、诊断中心、脱敏日志导出均有运行/成功/失败/取消状态和防重入。
- 设备码登录只有一个浏览器所有者；滚动 24 小时 Token 限额与周/月账单额度分离。
- 自定义模型显示 Provider 前缀；错误默认折叠并显示可复制的脱敏诊断。

### Provider 与结构化失败

- 主进程回环网关使用随机端口、不可猜路由和进程级 scope；Renderer 不接触密钥。
- 0.6.15 当前能力是同协议 SSE 直通，以及 Chat/Responses/Messages/Gemini 的主进程协议转换；取消、大小/超时边界、Trace 头和 Gemini/strict Schema 清理继续保留。
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

- 跨协议 Chat/Responses/Anthropic/Gemini Translator 已在 0.6.15 实现并有聚焦测试；同协议流为逐块直通，跨协议流目前以 SSE 保活维持连接并在终端有序转换，尚不是逐 token 翻译。
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
