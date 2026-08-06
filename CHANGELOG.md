# Changelog

## Unreleased

### 0.7.0 ACP 0.2.120 前向适配补充（2026-08-06）

- `initialize` 能力证据现在记录标准 `session/list`、`session/resume` 与 `session/close`；官方 0.2.120 源码形态以脱敏 Fixture 固定，仍不会把尚未进入本机 stable 通道的版本当作可安装版本。
- 重开会话优先使用运行时声明的 `session/resume`，仅在明确的“方法不存在/参数不支持”错误时回退 `session/load`；传输超时不会盲目重复挂载。退出时尽力发送标准 `session/close`，超时仍会释放 CLI 进程。
- Plan 决策卡等待期间允许切换模型，其他权限/问题等待仍保持锁定；自定义 Provider 的本地模型身份和上游模型状态继续分离，不会切回全局 Grok 4.5。
- ACP 回放的用户消息现在保留稳定消息 ID、附件预览和文件/图片资源；MCP 提取图片、直接图片块和重复回放按内容去重并合并到现有消息，不再生成空白或重复图片消息。
- Windows 文件锁在短暂 `EPERM/EBUSY` 竞争窗口内按锁争用重试，避免并行投影写入偶发失败；真正的权限错误仍立即报告。
- 离线媒体夹具改用 Electron `nativeImage` 可解码的 RGBA PNG，修复打包 UI 探针中生成媒体卡被误判为“图片数据无效”的候选门禁问题。
- A–D 变更已通过 94 个测试文件、673 项测试（9 项按设计跳过）、TypeScript、生产/资源构建、公开扫描和分块门禁；本地 0.7.0 打包已重新执行，验收前仍不推送 GitHub、不创建 Release。

### 0.7.0 本地候选最终复核（2026-08-06）

- Setup、Portable、SBOM、许可证报告、SHA-256、Electron Fuses、Task Scheduler 和中文/空格 Portable 冷启动均通过；Portable 已从最新构建同步，避免旧压缩包掩盖 IPC 修复。
- 当前 0.7.0 UI 门禁覆盖 Plan/权限四种组合、Stop 恢复、多会话隔离、导航、右栏五工具、非 Git Review、文件预览、结构化错误、Token 活动、诊断动作、响应式 Composer/窄栏抽屉和 Provider 管理。
- Setup `release/Grok-Build-Desktop-Setup-v0.7.0-x64.exe` SHA-256：`72570af030c79cc691bf6413eb9f80c49b15282b1eed46863cc52acb71eab851`；Portable `release/Grok-Build-Desktop-Portable-v0.7.0-x64.zip`：`85fbcf62aab193d0277ab47d81424c89ce181494b79413d2db92c09dc186bc7c`；SBOM：`5c4a9d715a2262a6101c6a748ee0738defac4dc48d670bdd547b9e5e08f06553`；许可证报告：`382a29a84ec5dcf10c5e4532b34ae419aad97674b4fc36ea2a1ef504eef252c5`。
- 仍按锁定策略仅交付本地候选，不推送 GitHub、不创建 Release、不覆盖 0.6.x 资产；真实长会话、Provider 与双并行回合继续由用户桌面验收。

### 0.7.0 全面审计与稳定性候选（已本地安装，等待验收）

- Grok Build CLI 适配改为运行时证据驱动：保存脱敏的 `initialize` 能力快照，消费 Agent/协议版本、Session/Prompt/MCP 能力、模型/努力档位、命令、Recap、Rewind 与插件目录；版本号仅作为最后一级提示。
- 所有 Desktop 管理的 ACP、媒体、登录、Memory、Provider、插件和诊断子进程显式传入 `--no-auto-update`。CLI 更新只接受用户确认的 stable 精确目标，更新前再次校验源状态并暂停会话，完成后验证 initialize、session/new、官方空会话删除与基础扩展；失败时精确回滚并恢复会话。
- 区分本机 stable 目标和官方已公布版本：公开 Changelog 高于 stable 时仅提示分批发布状态，不会越过更新通道强制安装。
- 适配 0.2.118 生命周期：快速后台任务完成先于 backgrounded 时不复活任务；Auto Compact 可见且可取消；Recap 按内容哈希去重；未知事件只记录名称、结构版本和大小。
- 会话删除优先使用官方 `grok sessions delete`，成功后才清理 Desktop 投影/附件/媒体/Token；失败时必须显式选择“仅清理 Desktop 数据”。诊断中心增加受限脱敏的 `grok doctor --json` 摘要。
- 为 0.2.119/0.2.120 增加按运行时事件启用的前向解析：follow-ups、模型/设置热更新、Goal、Workflow、Subagent、Retry 和后台任务。自定义 Provider 的本地模型身份不会被上游别名改回官方模型；完整 `/btw`、Session/MCP/Git 新界面延期到 0.7.1 且须 stable 实机证据。
- 本机已按 stable 精确升级到 `grok 0.2.118 (1e1687c1cf)`；真实 `initialize/session/new` 与空会话官方删除完成，最小只读 Plan 回合在 19.28 秒内通过，未出现权限卡或工作区写入。升级过程未安装 0.2.119/0.2.120。
- 0.2.118 收紧了自定义模型 TOML 思考档位解析。Desktop 不再把对象数组序列化成 CLI 拒绝的 `[[model.*.reasoning_efforts]]`，而是写入原生字符串列表，并把 `auto/none` 留在 Desktop 上游能力层而非 CLI 模型菜单。
- 会话运行时按会话保存 Provider、本地模型 ID、上游别名、思考档位、模式和执行档案；恢复旧会话时不再被全局默认模型覆盖。受管 Provider 初始化失败会明确阻止发送，不静默回退到官方模型；分叉会话继承父会话运行时。
- Plan 决定写入成功后立即关闭旧交互门，模式切换异步收敛；普通回合、Plan、权限等待、队列和插话统一按稳定回合 ID结算。accepted/running 队列落盘，重复终态和迟到事件不会复活或重复消息。离线 UI responder 已覆盖 Plan 三决策、权限允许/拒绝和 Stop 终态。
- 会话可见内容升级为本地投影 V2：流式正文、过程、工具、计划/权限/问题、错误、媒体、回合耗时和 Usage 可恢复；ACP 回放与本地投影按用户消息和内容后缀合并，避免重开只剩指标或重复回答。
- JsonStore 使用跨进程事务锁和 owner fencing；自动化任务取消改为显式 API，取消/进程退出/可选 ACP 无活动超时均有持久终态，不再设置 24 小时总时限。支持包日志、IPC 参数、文件路径、媒体和 CLI 路径增加运行时边界校验。
- 附件、媒体、打开位置和系统路径统一绑定会话/工作区/Picker 签发句柄；阻断任意 Renderer 路径、符号链接越界、可执行文件打开和未经允许的远端媒体。媒体远端默认拒绝，只有显式 Provider Origin 才能进入受限抓取。
- Provider Chat/Responses/Messages/Gemini 翻译、SSE 错误/EOF/Usage、工具名称映射和扫描状态保留现有成果；未验证能力不伪造模型档位或媒体能力。
- 最终候选一次完整门禁通过 94 个测试文件、670 项离线测试；6 个 live 文件、9 项按设计跳过。TypeScript、生产/资源构建、341 文件公开扫描、Native/Computer Host、24/24 Computer Use、Electron Fuses、Renderer 分块、打包版与安装版 0.7.0 UI、`npm audit`（0 漏洞）均通过。
- 已生成并 per-user 安装唯一一组 0.7.0 本地产物。Setup SHA-256 为 `61877c2f7585352877a704ac8b06ade61818baa36a06d03a4b05488fdf53bfda`，Portable 为 `3532c406bbfefc41f3af1d727f654d5a434e481a98462d4170cc52b47730395d`；File/Product/ASAR/Fuses、About/诊断、冷启动和桌面/开始菜单快捷方式通过。现有长会话 Stop、双真实模型并行和已配置 Provider 留给用户验收；验收前不推送、不创建 Release。

### 0.6.25 Plan permission hardening and terminal recovery

- Closed the remaining Plan-mode approval bypasses. PowerShell script blocks, subexpressions and static-call syntax are rejected before pipeline classification; read-only auto-approval is based on explicit ACP kinds and parsed commands rather than user-visible titles or tool names.
- Plan filesystem access now allows only the current persisted session's exact `plan.md`. Other workspace paths, arbitrary external paths and an existing symbolic-link plan target are rejected in the main process.
- A rejected permission request that offers no explicit reject option now receives the standard ACP `cancelled` outcome instead of a JSON-RPC error, preventing the CLI from retrying or leaving the session waiting.
- Terminal-only completion can now settle both direct and Desktop-owned queued prompts by their stable prompt ID, so a missing JSON-RPC response cannot leave a queued Plan follow-up permanently working.
- Stop is no longer fire-and-forget in the Renderer. The Composer displays the stop attempt and its success/recovery result, while failures remain visible and copyable instead of silently preserving the Stop state.
- Focused verification passes 4 files / 85 tests. The final candidate passes 82 offline files / 488 tests with 6 live files / 9 tests skipped by design, plus TypeScript, production/resources, 303-file public scans, native-host self-test, Fuses, packaged/Portable UI, Task Scheduler and installed main/About/diagnostics checks. One 0.6.25 Setup/Portable/SBOM/license set is installed per-user; Setup SHA-256 is `4026ce1d961a0ca7f8c66d0fca0cf48a2c5ce1ecac60174d20d838ddcdce1908` and Portable is `6041acb6c378cd75d1e7247b1198e45b1803a4f01c448b8deaa9f1a51d3c3477`. Real long-conversation Plan/Stop behavior remains user acceptance; no GitHub push or Release is performed before that acceptance.

### 0.6.24 Plan wire/state and phantom-queue hotfix

- Corrected the current open-source Grok Build `x.ai/exit_plan_mode` response contract. “批准并执行” returns `outcome=approved`, “继续规划” returns the successful `outcome=cancelled` result with optional `feedback`, and “取消” returns `outcome=abandoned`; legitimate choices are no longer mis-sent as JSON-RPC errors.
- Plan state now remains session-scoped across reload. Replayed `current_mode_update` changes the adapter's authoritative mode, `session/set_mode` failures are surfaced instead of silently claiming success, and every direct or explicitly queued Prompt pins its `mode` snapshot in `_meta`.
- Fixed the persistent Stop button after an otherwise completed turn. Grok Build's server-generated internal queue entry for an ordinary direct Prompt is no longer treated as a Desktop-owned follow-up turn; only IDs submitted by Desktop queue/interject actions can start a queued presentation turn.
- Stabilized workspace-picker focus restoration. Its close callback no longer changes identity on unrelated Sidebar renders, so closing the picker consistently returns keyboard focus to the workspace button.
- Added current-CLI wire contracts plus an opt-in real Plan acceptance. On installed Grok Build `0.2.117`, a real isolated read-only Plan turn completed with no Renderer permission event, no workspace write and `working=false`; this live test also reproduced the phantom second turn before the ownership fix.
- Final local verification passes 82 offline files / 483 tests; 6 live files / 9 tests skip by design. TypeScript, production/resources, 303-file public scans, Electron Fuses, packaged/Portable UI, Task Scheduler and installed main/About/diagnostics checks pass. The first package attempt correctly exposed and led to the workspace-picker focus fix; the resulting candidate then passed the complete formal gate.
- One 0.6.24 Setup/Portable/SBOM/license set is installed per-user. File/Product, main/About/diagnostics, Fuses and desktop/start-menu shortcuts report 0.6.24. Setup SHA-256 is `4f2d37bb24822ef0fd83e966205041c00638fed22df5b19126eb45847e4abf92`; Portable is `afe51b3acbcc5510998b4c869cda1d10f39a9705f88d025952103dda180de6a8`. Existing long-conversation Plan/Stop behavior remains user acceptance; no GitHub push or Release is performed before that acceptance.

### 0.6.23 Plan terminal-state and Stop recovery hotfix

- Fixed a normal/Plan turn remaining permanently `working` after Grok CLI had already streamed the final answer and published `_x.ai/session/update.turn_completed` but omitted the original `session/prompt` JSON-RPC response. The terminal event now settles the matching prompt request by turn ID, clears the Composer Stop state and cannot complete a later queued/interjected turn.
- Stop now has a bounded recovery path. Desktop first sends the standard ACP cancel notification; if that session alone does not acknowledge cancellation within eight seconds, its CLI process is replaced and the persisted conversation is reloaded without interrupting other concurrently running conversations.
- Plan mode no longer opens approval cards. Read-only tools are selected automatically, while mutating or unknown tools are rejected automatically; filesystem writes and non-read-only terminal commands remain independently blocked in the main process. Current underscore-style ACP kinds such as `read_file`, `list_directory` and `search_files`, plus bounded read-only PowerShell pipelines, are recognized.
- Focused regression coverage includes terminal-only completion without a prompt response, idempotent Plan decisions, read/mutation permission routing and acknowledged/stuck cancellation recovery. No paid Provider request is part of the automated gate.
- Final local verification passes 81 offline files / 478 tests; 5 live files / 8 tests skip by design. TypeScript, production/resources, public scans, Electron Fuses, packaged/Portable UI and Task Scheduler probes pass. One 0.6.23 Setup/Portable/SBOM/license set is installed per-user; File/Product, main/About/diagnostics, support-bundle exclusions and both shortcuts report the installed build. Setup SHA-256 is `345753b1d2ab4ade56dff41853ce8cab6c077282929debb42b99f08f73da76c4`; Portable is `2c5b7d388b67dc45e3622c69965fef0d24eb3b4fd9b1874ef91212f3bccbcc02`. Real Plan/Stop behavior remains user acceptance; no GitHub push or Release was performed.

### Post-0.6.22 unlimited interactive turns

- Removed the Desktop's 30-minute wall-clock ceiling from ordinary prompts and queued follow-up prompts. Long-running interactive turns now continue until the CLI/upstream completes, the user presses Stop, the process exits or a real transport/provider failure occurs.
- Provider `inference_idle_timeout_secs` remains a separate silence detector (600 seconds by default and configurable per managed model); bounded maintenance, media and scheduled-task policies are unchanged. This source-only hotfix is pushed for review and does not create or replace the `v0.6.22` Release.

### 0.6.22 local media transport and interject lifecycle hotfix

- Fixed generated images that existed on disk but rendered as “file unavailable”. Sandboxed Renderer media no longer uses blocked `file://` URLs; a main-process `grok-media:` protocol now serves only bounded, supported media inside the per-session caches, Grok session store, active execution root or an explicitly trusted path.
- Fixed CLI media jobs rejecting legitimate artifacts as outside the workspace. Headless `grok --single --session-id` writes into its exact transient Grok session directory, which is now an explicit one-job trust root and is copied into the target conversation cache before that transient session is removed.
- CLI media prompts now permit exactly one selected media-tool call and stop after the first error. The upstream Zero Data Retention `output.upload_url` requirement is preserved and translated into an actionable team/Provider configuration explanation instead of being misreported as moderation or a Desktop path error.
- Interject is now represented as a submitted high-priority follow-up in the same ACP session, not as a removable local draft or a second Desktop Agent. Accepted interjections keep their committed state when the CLI omits a queue state, cannot be falsely removed with the queue close action, and receive their own turn boundary, user message and running/completed presentation after the prior turn settles.
- GitHub releases now require one version-specific Chinese notes file instead of attaching the entire accumulated English `CHANGELOG.md`. The release page starts with a concise summary and keeps the detailed migration notes below it.
- Fixed the public Windows CI gate: trusted media tests now compare canonical paths so 8.3 aliases and long Windows paths are treated as the same file, and legacy TOML model-table parsing is linear-time instead of using a backtracking-prone expression flagged by CodeQL.
- The Chinese Release creation step now runs under UTF-8-aware PowerShell 7; Windows PowerShell 5.1 previously corrupted the Chinese diagnostic/title while parsing the generated workflow script and stopped before creating the draft.
- The final local gate passes 80 offline files / 465 tests; 5 live files / 8 tests skip by design. TypeScript, production/resource build, native Computer Host self-test, 299-file public source/asset scans, `git diff --check`, Electron Fuses, packaged/Portable UI and Task Scheduler probes pass. The first package command generated the only asset set but a virtual-list smoke assertion selected the wrong mounted error card; the probe now walks the list and the same assets passed all remaining gates.
- One 0.6.22 Setup/Portable/SBOM/license set was installed per-user. Main/About/diagnostics, File/Product, shortcuts and an installed real-profile `grok-media:` load of the existing 1024x1024 historical image pass. Setup SHA-256 is `509899d6f9836e1a5f33966a2736442b0b796d9cdc3b624decfaddca17b32da0`; Portable SHA-256 is `f764ee0fb49f37f1c8fc97671d3c72e7b918ffcdf581be6920036d564f2f590b`. Real new image/video generation and live interject ordering remain user acceptance; no paid media request was sent.
- Public PR #19 merged the accepted v0.6.7-v0.6.22 work, and PR #20 corrected the UTF-8 Release step after its first pre-draft failure. Release workflow `30693283048` rebuilt, scanned, attested, draft-downloaded and verified the cloud assets before publishing `v0.6.22` as Latest with version-specific Chinese notes. Public Setup SHA-256 is `be7cb21baaf79bd4a92c452b9bb37c6c0181b7dff7d99e70828ae3e76d776b13`; Portable is `ce8789da20eb470651e2ff89a499617575fdc75d84342445658623aa13dbaa18`.

### 0.6.21 local concurrent-conversation hotfix

- Fixed the Renderer-wide prompt submission lock that remained active until an entire `session:send` turn completed. Submission state is now keyed by conversation/new-draft identity, so a working conversation does not disable another conversation's composer or new-task flow.
- The first per-session `working` status is treated as transport acknowledgement: it releases the short submission lock while the turn itself remains working, allowing that same conversation to use the real queue/interject controls. Switching conversations no longer allows a background completion/failure to overwrite the newly active draft, attachments, focus or scroll position.
- Existing main-process concurrency is preserved rather than replaced: each loaded conversation owns a separate `GrokAcpAdapter`/CLI process and Provider gateway scope; up to eight idle/live adapters are retained, while working or waiting sessions are never reaped to satisfy the idle cap.
- Sidebar rows now label `运行中`, `等待操作`, `后台已完成` and `运行失败`, and the current project heading reports the number of live conversations so concurrent work remains visible after navigation.
- The final deterministic source gate passes 80 offline files / 462 tests; 5 live files / 8 tests skip by design. TypeScript, production/resource build, native Computer Host self-test, 299-file public scan, `git diff --check`, Electron Fuses and installed main/About/diagnostics checks pass. One 0.6.21 Setup/Portable/SBOM/license set was generated and installed per-user; Setup SHA-256 is `1cbcab6028a1f80da889c0ade45afe4e2be31aa4a24756091abaf35a1cf9d566` and Portable SHA-256 is `705804618834e8a9d223e047c49983a5423e1e94d8719697c16d988cbe0ff6e2`. Real simultaneous model turns remain user acceptance; no paid prompt, GitHub push or Release was performed.

### 0.6.20 local media/session/Plan hotfix

- Fixed CLI media artifact parsing for ordinary relative paths such as `images/1.jpg`. The previous expression truncated that value to `/1.jpg`, which made a valid generated file appear outside the workspace and produced both a failed media job and a broken historical image card.
- Media creation now keeps the active Grok conversation even while its turn is working or waiting for user input. Headless `grok --single` media work uses an explicit transient UUID and removes that temporary CLI session only after results are copied into the original conversation cache; when no Grok conversation is open, the studio states that it will create one.
- Multiple media results are grouped into one bounded two-column gallery. Four results are shown initially, further results are folded behind an expand action, and the gallery owns its internal scroll area while preserving per-result preview/copy/save/open actions.
- A live turn without assistant text now says “正在生成回答” or “等待你的操作” instead of claiming historical content is missing. Terminal failed/cancelled/historical recovery states keep their explicit no-body explanation.
- Composer operation notices now disappear after five seconds and have a close button. Plan mode automatically approves only ACP read/search/fetch/think calls and commands accepted by the read-only command gate; writes and unknown operations remain blocked or require an explicit decision, so this is not an unsafe full bypass.
- Final local gate passes 79 offline files / 457 tests; 5 live files / 8 tests are skipped by design. TypeScript, production main/preload/Renderer build, native Computer Host self-test/resources, 297-file public scans, `git diff --check`, Electron Fuses and release-asset scans pass. One 0.6.20 Setup/Portable/SBOM/license set was generated and installed per-user; File/Product, shortcuts and installed main/About/diagnostics report 0.6.20. Setup SHA-256 is `d9e6cb8112ac57650f510614019c2fcbf6e5768282b9f3f89774ff9ae9506e26`; Portable SHA-256 is `2c6c88afa1b12a279c33d1f796d80773c4beab449ff4571ca433c8b4b3becdc5`. Real media generation and a live Plan permission sequence remain user acceptance; no paid prompt, GitHub push or Release has been performed.

### 0.6.19 local Codex decision-surface and Agent-diff hotfix

- The non-Git `Agent changes` dock now defaults to one-column unified Diff with wrapping enabled. The file list yields width responsively, the selected file and Monaco surface remain bounded by the dock, and compact wrap/open controls replace the oversized header action that previously covered useful content.
- Permission and interactive-plan requests now use a compact Codex-style decision surface: 16px content region, quiet elevated input background, scoped/always actions on the leading side, reject and one-time/implement actions on the trailing side, and stacked actions in narrow containers. Optional plan feedback is collapsed until requested.
- This presentation hotfix keeps the 0.6.18 transport lifecycle: a successful permission or plan response emits `interaction-resolved` and removes the card; stale requests close locally; a second click cannot send a second ACP response.
- Focused Renderer regression tests (32 assertions), TypeScript, production main/preload/Renderer build, native resource self-test, 295-file public-source/asset scans and Electron Fuses pass. One 0.6.19 Setup/Portable/SBOM/license set was generated and installed per-user; File/Product/ASAR, shortcuts, main/About/diagnostics and support-bundle exclusions report 0.6.19. Setup SHA-256 is `704f6f7800bed7a3b85613a7cbe056edef420051f3c318c9b8c912481d56f114`; Portable SHA-256 is `f247e8db88c8f18ae91991f8e04321b3ad91eababc76975a30bae21ea08cf9b5`. Real Grok permission/plan requests and the right-dock surface remain user acceptance; this candidate does not claim complete visual parity with every Codex surface and was not pushed or released on GitHub.

### 0.6.18 local interaction and Agent-change acceptance hotfix

- Fixed permission, question and plan decision cards as transport-scoped requests. Plan documents no longer overwrite the actionable `x.ai/exit_plan_mode` request ID; successful decisions emit an explicit resolution event and disappear immediately, restored process-local requests are expired, and stale/repeated plan clicks cannot send a second ACP response.
- User-message delivery now means “written to the local CLI”, rather than waiting for the whole model turn to finish. A queued prompt entering execution is already `sent`, preventing a permanent “发送中” badge.
- Current Grok Build ACP `edit` updates are now parsed from their standard nested `content: [{ type: "diff", path, oldText, newText }]` block. The Desktop preserves streamed diff data across sparse final status updates, computes line additions/deletions, excludes read/search tools from “modified files”, and rebuilds non-Git Agent changes from the private conversation projection after restart.
- Permission/plan cards use a compact decision layout, long plan tables and code blocks own horizontal scrollers, and multi-account lists keep the active profile first with bounded internal scrolling and a narrow-window two-row action layout.
- Final local gate passes 78 files / 447 offline tests; 5 live files / 8 tests are skipped by design. TypeScript, production build, the 295-file public-source scan, `git diff --check`, native Computer Host self-test/resources, Electron Fuses and release-asset scans passed. One 0.6.18 Setup/Portable/SBOM/license set was generated and installed per-user. Setup SHA-256 is `964a1bd8147dff0a9f4ab88de66a9b0e223ec5610d51f4e9803226c6a9c6c6dd`; Portable SHA-256 is `fe866130abdafdaffda6946487436def2c34ebe88b71852ee08eba6c1955030e`; SBOM SHA-256 is `53488ed37063c5017751c2c02a56a855bff464aa87d8fda522eb055d8429ebe6`; the license report SHA-256 is `0eedf4138938b59a9be06db056dbb372fa91e04cc31a21ad87010abd517044e4`. Installed File/Product/ASAR, both shortcuts, main/About/diagnostics and support-bundle exclusions report 0.6.18. No paid prompt, GitHub push or Release was performed; real permission/plan/model turns remain user acceptance.

### 0.6.17 local acceptance hotfix

- Fixed legacy custom-Provider saves that could append a second Desktop-managed `[model.*]` definition and fail TOML validation. Markerless Desktop-owned model tables are now migrated into one bounded managed block while unrelated user tables/comments remain untouched and rollback/backup behavior is preserved.
- Explicit image/video transport configuration is now usable without first completing a deep capability scan. The media model picker labels real scan evidence separately from “manual configuration (unverified)”, while asset validation remains mandatory after a request.
- Added a targeted per-model “media only” probe. Normal compatibility scans remain limited to the selected Provider; automatic context-limit probing was removed from the normal UI in favor of model metadata or a clearly manual context value.
- Missing historical media cache files now render an explicit unavailable state instead of a broken `<img>`. Image actions are in document flow rather than a hover overlay, so copy/save controls no longer cover the preview or neighboring buttons. New real media still uses validated per-session cache files.
- Fixed the recent-file right dock so long source lines cannot expand behind or outside the pane. The preview owns its scroll area and offers an explicit wrap/no-wrap toggle.
- Final source gate passes 78 offline files / 436 tests; 5 live files / 8 tests are skipped by design. TypeScript, production build, 295-file public-source scan and `git diff --check` pass. One formal 0.6.17 package was generated and installed per-user: Setup SHA-256 is `248b8951e3e6140597e7207aee32163e40dde3ebba83e438bc3d28a8e980a790`, Portable SHA-256 is `ba0a3ff5e62de2e4be91b294b39f712c346264e176c2bee722c099741f97af7c`, SBOM SHA-256 is `8d33ce062366fa31545513f997fef68d14b8b59a3f39c1194deda0f1bddbf46a`, and the license report SHA-256 is `240dd504f521b61874a9011d127f24d2b58b0bc632086fa3d5d654a9e7b3e8d8`. File/Product/ASAR/Fuses, both shortcuts, installed main/About/diagnostics probes and a read-only Computer Use inspection of the main/settings/Provider-manager surfaces passed. The app remains open for user acceptance; no GitHub push or Release is part of this hotfix.

### 0.6.16 local reliability and UI acceptance candidate

- Provider deep scans now run as recoverable main-process jobs with per-model entry points, real sub-stage progress, generation-isolated cancellation, partial evidence retention and optional bounded context probes. Provider-wide scans remain explicitly scoped to the selected Provider.
- Custom Providers and individual models now have independent enabled states. Disabled entries are excluded from CLI-managed configuration, routing, defaults and model pickers; a zero-model Provider can be saved as disabled, and deleting a default requires an explicit replacement or clearing it.
- “Apply verified levels” is replaced by a selective capability draft covering protocols, reasoning transports/levels, context evidence, tools, continuation, usage, media, returned aliases and detected compatibility family. Nothing is silently rewritten.
- Added `ConversationProjectionStore`: visible user/assistant/process/tool/plan/error/media blocks are append-persisted and atomically snapshotted. Streaming text is throttled to disk and committed on completion/failure/cancellation/shutdown; local projections merge deterministically with ACP replay and preserve partial answers across resets and restarts.
- Media creation now uses explicit Auto/CLI/Provider routing. CLI media execution is constrained to the supported `image_gen`, `video_gen`, `image_to_video` and `reference_to_video` allow-list, parses streaming JSON artifacts, and only verified outputs are attached to the conversation cache.
- Unified open-target routing distinguishes directories, files, image lightboxes and reveal-in-Explorer operations with local feedback. Native context menus restore text selection/copy and trusted image copy/save/open actions. Pasted text over 12,000 characters becomes a recoverable draft `.txt` attachment instead of duplicating the full prompt.
- The Renderer shell is split into `Composer`, `MediaStudioPanel`, `Sidebar`, `TopBar` and layered style modules. Conversation width, floating composer, right dock, selectable message content, scan progress and offline acceptance fixtures now share one 0.6.16 visual contract.
- Final local gate passed after updating two stale regression probes for the split CSS graph and current package version: 78 offline test files / 432 tests passed, 5 live files / 8 tests were explicitly skipped; TypeScript, native Computer Host 0.3.1 self-test, production main/preload/Renderer build, 295-file public-source scan, Fuses, packaged/Portable UI probes and Task Scheduler probe passed.
- One formal 0.6.16 Setup/Portable/SBOM/license set was generated and installed per-user. Setup SHA-256 is `240a40edf380462039ae215952e2b86465afe87165e567faed9141f95c0b56b4`; Portable SHA-256 is `5a33b6f6f7516706bf03607c7181cdfda9482a774692617a7ed4addad5664036`. Installed File/Product/ASAR report 0.6.16, both shortcuts target the install directory, and a cold-start probe verified main/About version, diagnostics and support-bundle attachment exclusions. No GitHub push or Release was performed.

### 0.6.15 local Provider compatibility acceptance candidate

- Added a main-process protocol translator for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages and Gemini GenerateContent. It preserves text, images, function tools, tool results, reasoning, usage and errors; same-protocol SSE remains byte-streamed, while cross-protocol SSE sends bounded keep-alive comments during ordered terminal conversion so long silent reasoning does not look like a dead connection.
- Provider and every individual model can now declare separate client/upstream protocols, a compatibility family (`CLIProxyAPI`, `grok2api`, `sub2api`, `new-api` or generic), Schema profile and reasoning transport. Supported transports include effort enums, Anthropic adaptive effort, token budgets, model suffixes, fixed effort and explicit unsupported mode.
- Added cancellable, bounded deep compatibility scans across selected models and protocols. Results record non-streaming, SSE, tools, tool-result continuation, exact usage presence, returned model aliases, image generation and every accepted effort value without persisting credentials or request/response bodies. Partial rescans merge with existing evidence, and verified effort menus are applied only through an explicit action.
- The Provider manager now exposes the compatibility family, model-level protocol routing, idle timeout, reasoning mapping, protocol capability matrix, returned-model aliases, scan status and “apply verified levels”. Provider-prefixed display names remain unambiguous.
- Grok 4.5 no longer inherits the obsolete three-level fallback. The exact model exposes the five live-verified selectable levels `xhigh/high/medium/low/minimal`; an exact legacy `high/medium/low` generated value is migrated, explicit alternative subsets remain untouched, and unknown future models are never guessed.
- Provider response/header timeout is 360 seconds, CLI inference-stream idle remains 600 seconds and the complete ACP turn remains 1800 seconds. Cross-protocol SSE bridge heartbeats prevent the converter itself from introducing a new idle gap.
- Authorized live verification passed without logging secrets or bodies: local grok2api `grok-4.5` completed full Chat/Responses/Messages capability scans and an `xhigh` Responses ACP turn; remote CPA `grok-4.5` completed a Responses scan and an `xhigh` ACP turn; CPA Gemini completed all three protocol/tool-continuation scans and a Chat ACP turn. CPA's current Claude route returned upstream HTTP 502, and local grok2api image generation still returned HTTP 502, so neither is claimed working.
- Final source gate passed: 74 offline test files / 406 tests passed, 5 live files / 8 tests were explicitly skipped; TypeScript, production main/preload/Renderer build, 278-file public-source scan and `git diff --check` passed.
- A single local 0.6.15 delivery was generated and installed per-user. Setup, Portable, SBOM and license hashes all match `release/SHA256SUMS.txt`; Setup SHA-256 is `101441bca66cda47cd6914602cf7f76e2a4a394dd520368d6b328d769f847327` and Portable SHA-256 is `8c486be2973bf11fdf11cad4f97f0d408f9e03feb5968f7daaede8d0cbaeeeff`. Electron Fuses, installed File/Product/ASAR version, packaged compatibility markers, Desktop/Start Menu targets and a four-process cold start passed. The app is closed for user acceptance; GitHub push/Release remains deferred.

### 0.6.14 audit-fix source candidate

- Provider gateway downstream closes are now recorded as caller-side terminal observations instead of Provider failures. The in-memory failure ring is larger, and a separate bounded body-free observation ring retains successful HTTP routes so a later CLI parser error can still be attributed to the actual custom Provider instead of degrading to an unexplained `Internal error`.
- Unsigned Anthropic thinking compatibility no longer exposes the recovered reasoning as ordinary assistant prose. The gateway uses process-internal markers only, and the ACP adapter incrementally restores them to the semantic thought channel even when markers are split across chunks; valid signed Anthropic responses remain untouched.
- Windows CLI environments synthesize a missing `HOME` from `USERPROFILE`/the OS home directory without overriding an explicit value or changing `GROK_HOME`, preventing native worktree cleanup from failing only because Windows omitted `HOME`.
- Persistent AppData logs now redact credentials, private URLs, email addresses, local/UNC paths before writing, sanitize an existing log on first access, cap individual entries and rotate at 8 MiB with one backup. Support bundles reuse the same redaction.
- `JsonStore` no longer silently overwrites malformed JSON. It preserves a corrupt file as a uniquely named recovery backup, propagates non-ENOENT read failures, and removes only store-specific atomic temp files older than 24 hours.
- Managed Provider capability migration now removes stale reasoning choices when a model explicitly resolves to no supported choices. Terminal commands invoke the platform shell explicitly with `shell: false`, avoiding Node's deprecated shell-string spawn path.
- Offline verification passes: 72 test files / 391 tests passed, 4 live files / 7 live tests were explicitly skipped; TypeScript, native Computer Host 0.3.1 self-test/resource manifest, production main/preload/Renderer build, 273-file public-source scan, `git diff --check` and npm high-level audit (0 vulnerabilities) passed. The build still reports large lazy dependency chunks for Monaco/Shiki/Mermaid and records that as a performance follow-up rather than hiding the warning.
- The current default model's local upstream is not running and was excluded from acceptance by user request; no Provider inference, paid prompt, packaging, installation or GitHub Release is claimed yet.

### 0.6.13 local Anthropic Messages compatibility candidate

- Added a generic Anthropic Messages response compatibility pass in the main-process Provider gateway. A valid signed `thinking` stream remains byte-for-byte unchanged; only a malformed block that omits the required `signature` field is downgraded to ordinary `<think>` text, including incremental SSE and non-streaming JSON responses. The gateway does not forge an Anthropic signature and the behavior is not tied to a Provider or model name.
- Reproduced the local Kiro failure precisely: `127.0.0.1:8080` returned HTTP 200 and began an Anthropic SSE response, but Grok CLI 0.2.112 rejected `content_block_start` with `missing field signature` and then closed the downstream connection. The current `kiro-claude-opus-4.8-thinking` model with `xhigh` completed an isolated real Grok CLI ACP turn through the corrected Desktop gateway in 8.28 seconds.
- Provider gateway coverage now includes chunk-split malformed Anthropic SSE, valid signed SSE byte preservation and non-streaming unsigned thinking. The focused gateway suite passes 15/15, the opt-in current Kiro live turn passes 1/1, TypeScript, public-source scan, native resource self-test, production build and Electron Fuses pass.
- Local Setup `release/Grok-Build-Desktop-Setup-v0.6.13-x64.exe` (SHA-256 `7172de9ee614afb4afea471703cc5106aa294cbe93ec2471f996716675311a1f`) was installed per-user. File/Product and installed ASAR report 0.6.13, the ASAR contains the unsigned-thinking adapter, both shortcuts target the installation directory, Kiro-Go remained running and a cold start produced the installed 0.6.13 process. Portable/SBOM/license assets were generated, but no broad UI suite or GitHub upload was performed; the app is open for user acceptance.

### 0.6.12 local Provider transport-routing hotfix candidate

- Corrected the 0.6.11 timeout diagnosis using the installed Grok CLI's embedded configuration reference: its native `inference_idle_timeout_secs` default is already 600 seconds. The Desktop default now matches 600 instead of lowering it to 360; explicit 30–3600 second per-model values remain supported.
- Correlated the user's 58/88-second server-side cancellations with Desktop logs and Windows connections. The failing managed Provider requests were routed through Electron's configured local Mihomo proxy and ended as `net::ERR_CONNECTION_CLOSED`; neither the 30-minute ACP turn ceiling nor the 600-second Provider header ceiling fired. Direct and proxied `/models` probes both returned HTTP 200, which proves reachability but not a long streaming inference.
- Added a generic per-Provider network route: **inherit app proxy** or **direct (skip app proxy)**. Model-list probes and inference use the same choice, and separate Electron session partitions prevent concurrent direct/proxied Providers from racing over mutable proxy state.
- Provider gateway diagnostics now assign a body-free request ID and record only safe transport facts: route, endpoint class, elapsed time, phase and whether the downstream caller, gateway header timer, upstream connection or upstream stream ended the call. Stream failures after headers are no longer silently destroyed without a failure record.
- Focused Provider/gateway/diagnostic contracts pass 5 files / 41 tests together with TypeScript, public-source scan, native resource self-test and production build. Setup `release/Grok-Build-Desktop-Setup-v0.6.12-x64.exe` (SHA-256 `78729332967a5c51d1203d3fc7c8a36ca72c256161be196ba1462591b69d575b`) was installed per-user; File/Product, Fuses, installed-ASAR markers, both shortcuts, current CPA direct/600-second migration, `grok inspect --json` and a cold start passed. The app was closed for user acceptance; no paid inference request, broad UI suite or GitHub upload was performed.

### 0.6.11 local inference idle-timeout hotfix candidate

- Historical note corrected by 0.6.12: interactive ACP turns already allowed 30 minutes and the loopback Provider gateway allowed 10 minutes, but the installed CLI's implicit model-level `inference_idle_timeout_secs` default was 600 seconds—not a shorter unknown value.
- 0.6.11 wrote an explicit 360-second inference idle timeout. This controlled consecutive time without a stream event, not total tool-turn duration, but it lowered the CLI-native 600-second default and did not cause or fix the observed 58/88-second proxy transport closures.
- Provider manager exposes a per-model 30–3600 second control and shows the effective value in model details. Existing managed profiles are migrated on the next session launch, while explicit non-default values remain intact.
- Grok CLI 0.2.112 accepted an isolated config containing `inference_idle_timeout_secs = 360`. Focused Provider/ACP/Renderer verification passed 6 files / 47 tests together with TypeScript, production build and native resource self-test; the local Setup is rebuilt separately below without expanding to paid inference or the full UI suite.
- Local Setup `release/Grok-Build-Desktop-Setup-v0.6.11-x64.exe` (SHA-256 `cf8f4f6a97e120c82ef243c35eb701a32da8bf779e45b4b16e9263886e3e9475`) was installed per-user. File/Product, Fuses, both shortcuts, installed-ASAR timeout markers, current managed TOML migration, `grok inspect --json` and a cold start passed. The application was closed again for user acceptance; public Latest remains 0.6.6.

### 0.6.10 local per-model Provider capabilities candidate

- Verified the current CPA endpoint rather than assuming OpenAI compatibility. `/responses` returned HTTP 200 SSE for default and every accepted vocabulary value (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`). HTTP acceptance is deliberately not presented as proof that the final upstream honored a particular effort. A separate Grok CLI ACP Responses session loaded custom metadata, switched low → high in place and completed a real turn.
- CPA's `/models` entry for `grok-4.5` exposes only `created/id/object/owned_by`, and `/models/grok-4.5` returns 404, so its effort list cannot be discovered. Current xAI documentation and the installed CLI catalog describe high/medium/low for the official Grok 4.5 API; this is now only an exact-ID starting suggestion, never a lock.
- Provider model capability resolution is generic: declared upstream metadata or an explicit per-model user setting wins, an explicit empty list remains empty, and unknown/future models are not guessed. Discovery reads `reasoning_efforts`, `reasoningEfforts`, `supported_reasoning_efforts`, `supportedReasoningEfforts` and their common `capabilities` variants.
- Provider manager now exposes protocol and effort controls on every individual model. A single mixed CPA can keep Chat Completions as its Provider default while routing one model through Responses; each model may independently enable any subset of xhigh/high/medium/low/minimal/none. The details view shows the effective protocol and declared choices.
- The current local `CPA 兼容 · grok-4.5` profile was migrated through the same public Provider service—not a machine-only code branch—to per-model Responses with five selectable values (`xhigh/high/medium/low/minimal`). The credential was retained in the Windows user environment and a pre-change TOML backup was created.
- Focused verification passed 6 files / 47 tests, TypeScript, production build, native resource self-test and Electron Fuse verification. The corrected Setup `release/Grok-Build-Desktop-Setup-v0.6.10-x64.exe` replaced the stale pre-redesign artifact and was installed per-user. File/Product, both shortcuts, installed-ASAR capability markers and a cold start passed; the app was closed again for user acceptance.

### 0.6.9 local Provider authentication hotfix candidate

- Fixed the loopback Provider gateway forwarding Grok CLI's incoming `Authorization` header to a managed custom upstream. After CLI auth recovery that header can contain the signed-in xAI session token rather than the Provider key, so a valid CPA key succeeded against `/models` and `/chat/completions` directly while Desktop received HTTP 401.
- The main-process gateway is now the credential boundary: it removes inbound `Authorization` and `x-api-key`, freshly reads the selected Provider's credential and structured Header environment variables, and injects only those values upstream. Missing credentials fail before any upstream request with a fixed safe error.
- Regression tests prove that stale CLI bearer/API-key/extra-header values cannot cross the gateway, that bearer and `x-api-key` schemes receive the correct Provider-owned value, and that a missing key produces no upstream call.
- Live verification used the current CPA configuration without printing credentials or response bodies. The same credential returned HTTP 200 from `/models` (11 models including `grok-4.5`) and from a minimal streaming `/chat/completions` request; a separate full Grok CLI → loopback gateway → current Provider → `grok-4.5` ACP turn also passed.
- Focused verification passed 5 files / 43 tests, TypeScript, production build, native resource self-test and Electron Fuse verification. Local Setup `release/Grok-Build-Desktop-Setup-v0.6.9-x64.exe` (SHA-256 `2a0cc83d69c6cfe2053f23e2d224986f057b28af1c2086d015bfe6f71259c70c`) was installed per-user; File/Product report 0.6.9, both shortcuts target the installation directory, and the installed ASAR contains the credential-boundary build. The app remains closed for user acceptance.

### 0.6.8 local routing hotfix candidate

- Fixed resumed custom-provider sessions that displayed a provider-prefixed local model while still running the persisted upstream alias. Grok CLI stores `grok-4.5` in session history, so the adapter now compares the raw ACP model against `openai-compatible-grok-4.5` and always reapplies the local configuration ID before the next turn.
- Model capability metadata now carries the CLI-declared reasoning-effort list. The composer offers only those declared values; a custom model with no `reasoning_efforts` stays on its startup value and explains where to configure supported values instead of presenting six controls that cannot work.
- A failed private effort switch no longer destroys and reloads the persisted session. The previous restart path restored the historical effort and could also restore the upstream model alias, so failure now leaves both model and effort unchanged with a precise message.
- Provider attribution now requires a recent observation from the same process-scoped loopback gateway. An official xAI quota error can no longer be labelled as a CPA Provider failure merely because the selector still holds a provider-prefixed local ID.
- Focused contracts cover resumed-route reapplication, declared effort capabilities, unsupported-effort rejection without restart, model-ID preservation and structured failures: 5 files / 28 tests, TypeScript, production build and the native resource self-test passed. The current credential retrieved the configured 11-model list over HTTP 200; no successful inference claim is made by that non-billable check.
- Local acceptance Setup `release/Grok-Build-Desktop-Setup-v0.6.8-x64.exe` (SHA-256 `c0cff8253878d2c794b79a12370e677ad06a3315eab68ba12896c861a4353bd6`) was installed per-user. File/Product report 0.6.8 and both Desktop/Start Menu shortcuts target the installation directory; the application remains closed for user acceptance.

### 0.6.7 local acceptance candidate

- Added a Claude Code continuation bridge alongside the existing Codex bridge. The main process indexes primary JSONL sessions below `%USERPROFILE%\.claude\projects`, filters sidechains/subagents, opens them through Grok CLI's bundled `session_reader.py claude` reader, and preserves the source file hash around continuation.
- The sidebar now has an independently collapsible Claude 会话 group with the same read-only mirror, refresh, hide and “在 Grok 中继续” flow as Codex. Continued sessions are labelled and grouped as Claude 接力, and workspace discovery includes Claude project/session counts.
- Claude continuation uses the bundled `/resume-claude "<source-jsonl>"` skill rather than copying a transcript into a synthetic prompt. Foreign transcript content remains inert and filesystem/process access remains in the sandboxed Electron main process.
- Focused verification passed 36 Provider/adapter/Claude/workspace/session-group tests, TypeScript, the production build and the required native-host resource self-test. The bundled Claude reader was also exercised against an existing local session with content suppressed from output.
- Local acceptance Setup `release/Grok-Build-Desktop-Setup-v0.6.7-x64.exe` (SHA-256 `c7b6bd66c480869539aa508e8015268ff1a08781205107fe0e84b38ea20258c2`) was installed per-user. The installed executable reports FileVersion `0.6.7`; the app was deliberately left closed for the user to launch and accept.
- This candidate intentionally stops before expanded regression testing, Computer Use/live UI acceptance, formal Portable/SBOM/license release-asset generation or GitHub upload.

### Custom Provider hotfix

- Desktop-spawned CLI processes now refresh managed Provider credentials and extra-header environment variables from the Windows user environment at every launch. This fixes the case where a rotated key works in another client and in `/models`, while a Grok Build Desktop process that started earlier keeps sending its stale inherited value and receives HTTP 401.
- ACP may report the upstream route name (`grok-4.5`) after a turn even when the selected local model is `openai-compatible-grok-4.5`. The adapter now keeps the explicitly requested local model identity, so the selector no longer jumps to the official Grok model and failure enrichment can still find the correct Provider.
- A normal Prompt rejection now emits one structured `TurnFailure` instead of only a text-bearing error status. Snake-case `http_status` from the CLI JSON-RPC payload is retained, so the expanded card can show HTTP status, Provider, local model and Schema-cleaning evidence instead of repeating only `Internal error`.
- Focused verification passes: the Provider/adapter contracts and Claude/catalog/session-group contracts pass, together with TypeScript. The earlier user-authorized minimal live turn through the current Provider and `grok-4.5` returned successfully, retained the synthetic local model ID after ACP completion, and logged Schema cleaning without persisting credentials or response text.

## 0.6.6 - 2026-07-27

### Release hardening

- Session metadata stores now perform atomic queued read/modify/write mutations. Concurrent Token turns and Agent Dashboard updates no longer overwrite one another; clearing a workspace removes the exact session assignments, token detail, non-Git change snapshots, dashboard records, attachments and turn presentation metadata without stopping unrelated live sessions.
- Provider failure observations are correlated with an opaque per-process scope and a one-sided time window. A nearby failure from another simultaneous session, or a future timestamp, can no longer be attached to the wrong turn. Cancel and process-exit evidence survives the enrichment pass.
- ACP `retry_state` notifications are now visible in the running process block, including attempt, limit, delay and upstream reason where supplied. A Prompt that exceeds its turn budget sends the real ACP cancel notification instead of merely abandoning the Renderer-side Promise.
- Primary chat events reach the Renderer before optional dashboard, Token, attachment or Computer Use projections touch disk. A projection failure is logged and cannot suppress the answer or error that the user is waiting to see.
- The 53-week activity grid is exactly 371 days. UTF-8 change snapshots clip on code-point boundaries, preserve the true earliest-baseline truncation flag and no longer leave NUL bytes in the TypeScript source.
- Streaming final answers use a stable plain-text surface until completion instead of reparsing the entire growing Markdown document every frame. Workbench dialog dependencies are memoized so Git and Worktree effects no longer reload on every App render.
- Computer Use publishes action-specific MCP schemas, clamps element and drag coordinates to the selected window, maps punctuation through the Windows keyboard layout, supports horizontal wheel input, and records a native-host timeout as an unknown outcome that requires re-observation rather than a confirmed failure.

### Interface polish

- The text-size and density settings now apply to every surface. `#overlay-root` is a sibling of `#root`, so every portaled dialog, palette and panel sat outside `.app-shell` and inherited neither — setting the text size visibly did nothing to any of them. Measured in the packaged renderer: the settings dialog went from ignoring the setting to scaling 16px → 24px at 150%.
- Code blocks are no longer re-tokenized on every streaming frame. The highlight effect depended on the growing source text, so a block still arriving was fully re-highlighted each frame; it now waits for the text to settle and shows plain text meanwhile, which is all anyone can read mid-stream anyway.
- The 开发工具 section remembers whether it was open instead of collapsing on every launch.
- The add palette declared `aria-modal` but Tab escaped to the page behind it: the global overlay focus trap keys off a flag that does not include the palette, so it was never armed. Tab is now contained.
- Leaving the chat view no longer leaves the shell reserving space for a right pane that is not rendered there.

### Computer Use: the elevated-target dead end

- Asking to control an already-elevated app used to throw before any task existed, so nothing downstream could classify it, no state was ever published, and neither the live strip nor the desktop overlay appeared. The user's only channel was whatever the model chose to say about a raw tool error. The refusal now publishes a real task state.
- A transient UAC prompt and a permanently elevated target were one state with one message. For the permanent case there is nothing to complete, yet the UI offered "已手动完成，继续" — and `resume` re-activated without checking controllability, hit the identical error and re-armed the identical button, forever. They are now distinct: `uac-handoff` keeps the resume affordance, `elevation-blocked` explains the Windows integrity rule, names the two legitimate remedies, and offers no button that cannot succeed.
- The one message that carried the reason put it in a parenthetical at the end of a long single-line string, and both surfaces that render it clip with `nowrap` + ellipsis — so the reason was never visible. The cause now goes in the headline slot, which neither surface clips.
- The native host reports a machine-readable `blockedCode` so the app distinguishes a permanent integrity boundary from its own blocklist without parsing prose.

### Token activity

- Per-turn usage is now recorded and rolled up: 24h, today, 7d, 30d and month, plus a 53-week activity heatmap with daily, weekly and cumulative views, filterable by model. Reachable from a Token 活动 settings category.
- Every number is a sum of what the CLI or provider actually reported. The app never computes usage itself — it only relays `turn_completed.usage`, and failed or cancelled turns carry none — so coverage is stated alongside each total ("N turns, M of which returned no usage") rather than letting a total silently under-report real work.
- Two tiers of storage with an enforced contract: per-turn detail is deleted when its session is deleted, while the anonymous daily rollup survives and is pruned after roughly 13 months. No prompt text is stored.

### Review outside Git

- Non-Git workspaces can finally review changes. A new Agent 改动 surface is built from the real before/after text the agent's own write tool calls already carried, scoped to the last turn or the whole session, with a side-by-side diff.
- This is not a Git stand-in: nothing stages, commits or branches, and none is implied. It is also strictly more faithful than `git status` for this question — a file the agent edited and then reverted, or one already committed, still appears because the agent really did write it.
- Where no before-text was captured the surface says so and shows the result, rather than diffing against an empty string and implying the file was created.
- Clicking 在 Review 中查看 in a non-Git folder used to silently redirect to an unrelated file list; it now opens this surface.

### Structured failures

- Failures now cross the process boundary as data instead of one free-text string. `TurnFailure` carries a classification, the model, the provider, the HTTP status, the upstream trace id, `retry-after`, the gateway phase and how many tool-schema values were rewritten. Previously the ACP adapter captured the JSON-RPC `data` payload and nothing in the codebase ever read it back, and the `code` was dropped outright — which is why nothing downstream could tell one failure from another.
- Failures are classified from evidence only — status code, process exit code, or a phrase the upstream itself produced — and an unmatched failure stays `unknown` rather than being forced into a bucket. Each class carries its own concrete next actions.
- The provider gateway keeps a bounded, in-memory record of what it observed on 4xx/5xx: status, trace id, `retry-after`, phase and sanitize count. It already forwarded all of it and stored none of it. Nothing is persisted and no credential or body is retained.
- The main process joins the two — it is the only place that can see both the adapter's model and the gateway's trace — redacts the message, and adds a targeted action when a Gemini-family upstream is still on the pass-through schema profile, which is the one case where the remedy is a single setting rather than a retry.
- Diagnostics gained a failure-scoped path. `diagnoseFailure` runs only the checks that bear on the class at hand — the schema profile for a rejected tool schema, the real quota windows for an exhausted quota, the credential source for an expired key, route and proxy for a network failure, and the CLI probes only where a crash makes them the relevant evidence. It deliberately does not re-run the four-subprocess install sweep, which for most classes costs the better part of a minute and then reports all-green.
- The error card renders the classification, the facts that are actually present and the suggested actions. Its previous summary parsed an `HTTP nnn / Provider: x` shape that only the offline fixture ever produced, so against a real failure it degraded to showing the first line.
- A final CodeQL review found that the loopback gateway could return an arbitrary caught exception to its local caller. Public gateway responses now use a small fixed set of safe Chinese messages, while the separately redacted diagnostic remains main-process-only; a regression test injects a fake private path and stack and proves neither crosses the HTTP boundary.

### Verification

- The final corrected local release gate passed: 67 test files passed and 4 explicitly live-gated files skipped; 359 tests passed and 7 skipped. TypeScript, the production main/preload/Renderer build, the native Computer Host build/self-test, Electron Fuses, packaged UI fixtures, Task Scheduler, a Chinese/space Portable path, and both 264-file public-source scans passed.
- The packaged 0.6.6 fixture verified conversation/workbench/task navigation, the five real right-pane tools, recent-file preview, non-Git Agent changes, collapsed structured errors, turn metrics, the exact 371-day Token activity grid, all four update/diagnostic actions, narrow-window drawer behavior and Provider management.
- The same Setup was installed per-user. File/Product, main-process bootstrap and About report 0.6.6; diagnostics reports “可以使用”; attachment-body/full-path support-bundle exclusions remain present; Desktop and Start Menu shortcuts target the installed executable.
- The first PR Windows dependency gate exposed two optional `@emnapi` packages absent from the lockfile under npm 11 strict `npm ci`. The next gate picked up newly published build-time advisories; `brace-expansion` and `tar` are now pinned to 5.0.8 and 7.5.22. A fresh `npm ci` and the full high-level audit report zero vulnerabilities.
- Rebuilding from that clean dependency tree exposed two acceptance-infrastructure defects before publication: Windows PowerShell 5.1 needed UTF-8 BOMs on the modified packaging/smoke scripts, and the 0.6.2 compatibility probe incorrectly required three simultaneous Virtuoso DOM items. The probe now scrolls to and verifies the historical fixture semantically instead of counting virtualized rows. The rejected candidates were not published; the corrected final package reran the complete 359-test and packaged UI gate.
- PR review also rejected that candidate before publication because an arbitrary Provider-gateway exception could reach the loopback response. The response is now a fixed safe classification, with the detailed redacted evidence retained only in local main-process diagnostics; the corrected runtime is rebuilt and reinstalled below before tagging.
- Final local candidate SHA-256: Setup `b4243d6ebc0137291b0fc38df1b948f554a7be41d787a678ea9594fb99a57a5e`; Portable `b8edbe0c7a99717da8956e0e540a73410a8de6c6b1d8ce5d7a529f62bb55b4e6`; SBOM `c4489c6c07492c943db339474d0d5c6fe20ce810dc1b6a0bfce946e436a8bc51`; licenses `1ad863e9d4753397efa8ab297e057882b2f04d665bb5e8ed7062d71b900b8ca5`.
- PR #15 merged to `main` at `2d413d4` after hosted Windows, Gitleaks, CodeQL and the code-scanning policy passed. Tagged workflow `30216468056` rebuilt and scanned the unsigned assets, attested Setup/Portable, created a Draft, downloaded it, verified `SHA256SUMS.txt` and provenance, and published `v0.6.6` as Latest.
- Public SHA-256: Setup `911d5350d7c24999d2c17fc6a9fa8513a5173dc6304d873c8a9fe2f112f28416`; Portable `5b6dc4ccc0e44f7a65b44508b8c3e17d35302cd961d61d3ac72dfe4e692688ca`; SBOM `33882c6a738fc97285e2d41ace5ffadb57da5ba44261d6bf76b79c089387e9d5`; licenses `d18189fbbb412ed10b00a5b47582d8f465751d2a2172968ba824f08515f6a3b3`. Both executable/archive attestations independently verify against tag `v0.6.6`, commit `2d413d4` and GitHub-hosted workflow `30216468056`.
- The downloaded public Setup (SHA-256 `911d5350…`) was then installed per-user over the local candidate. A fresh installed-app probe again reported main/About `0.6.6`, stable channel, usable diagnostics and support-bundle attachment exclusion; Desktop and Start Menu shortcuts still target the installed executable.
- Cross-protocol Provider translation remains deliberately deferred; 0.6.6 supports the verified same-protocol gateway and Gemini/strict Schema profiles.

## 0.6.5 - 2026-07-26 (release candidate)

### Fixed

- Plan decisions are keyed by session/request, locked on the first click and answered exactly once over the original ACP server request. Approval no longer emits a synthetic `[Plan approved]` prompt, so it cannot create a duplicate queued user message or second model turn.
- Queue, edit, remove, reorder and interjection operations return visible operation receipts. `Enter` queues while a turn is running, `Ctrl+Enter` requests same-turn interjection, unsupported interjection visibly falls back to the queue head, and plan/permission/question waits disable the ordinary composer.
- The four update/diagnostic actions now expose running/success/error/cancelled results, prevent re-entry, copy their result and actually open the diagnostics surface or selected export path.
- Provider failures render a compact summary with an expandable, copyable redacted HTTP/Provider/route/Trace body. Managed model names include their provider prefix.
- Device login detects `--no-browser`: either the app opens exactly one browser or the CLI owns browser launch, never both.
- Rolling 24-hour Grok Free Token limits are parsed separately from weekly/monthly billing, persisted locally per account and marked expired rather than being presented as current after their observation window.
- Removed Codex from the Computer Use application blocklist while preserving self/terminal/UAC/security-window restrictions and the same-integrity requirement for control.
- Computer Use emergency stop is now terminal. It marks the session stopped, cancels the Grok turn that is issuing the tool calls, and refuses further `start` calls until the session is explicitly re-armed. Previously it only flipped task status, so the CLI's next tool call re-acquired control roughly one step later.
- The overlay no longer registers a global bare `Esc`. That grab swallowed Escape system-wide for the whole session — so Escape could not dismiss a menu or cancel a dialog in the target app — and the host's own synthesized `press_key esc`, an ordinary UI step, tripped the emergency stop against itself. `Ctrl+Alt+Esc` remains the OS-wide kill switch, its registration result is now checked, and the overlay says "回到 Grok 窗口停止" instead of advertising a hotkey the OS refused.
- A Computer Use lease no longer leaks when the Grok CLI fails to spawn. The `closed` event that releases the lease was emitted only from the process `exit` handler, which never fires for a binary that is missing, renamed or quarantined; it now fires exactly once on every disposal path.
- Recent files are constrained to the real session/Worktree root, shown as relative project paths and retain the main-process external-open path instead of trying to open a broken relative path.
- Binary files are no longer a dead end. Opening a PNG, PDF or archive returns the same external-application escape hatch an oversized file does instead of throwing, so the file tree, tool-call locations, navigation targets and the recent-files pane all offer "open with the system app" rather than a bare error. Write paths still refuse binaries.
- The composer is never disabled. Disabling it mid-IME-composition could swallow `compositionend` and leave Enter permanently dead; typing and drafting now always work and only submission is gated, with a stated reason instead of a silent no-op. Interjection also gained a real button next to 加入队列, so `Ctrl+Enter` is no longer the only way to reach it.
- Failed and cancelled turns now show their duration, token cost and an outcome badge. The metrics footer used to render only inside the final-answer block, hiding the cost of exactly the turns that did not produce one.
- The composer token meter keeps its 512K fallback for models that do not report a context window, but now says so in its tooltip instead of presenting the assumed denominator as measured.
- A provider problem can no longer block launching sessions that use no provider. Persisting the upstream URL for direct CLI use and migrating an older managed block are best-effort: a read-only user environment or a concurrently edited `config.toml` is logged and the session still receives its loopback routes.
- Rolling 24-hour quota capture no longer rides in front of the error event it observes. It runs detached and swallows vault/`quota.json` failures, so a bookkeeping error cannot delay or suppress the failure message the user needs to read.

### Provider compatibility

- Added a loopback-only, random-port Provider gateway with an opaque per-process route. The Renderer never receives the upstream URL or credential; only desktop-launched CLI processes receive the loopback override.
- The gateway performs same-protocol streaming pass-through, cancellation and bounded request/response handling, does not follow redirects, preserves selected Trace/rate-limit headers and emits structured redacted failures. Request bodies are forwarded as bytes, so binary and multipart payloads survive the hop intact.
- Parallel session launches share a single gateway listener. Each caller used to bind its own port and only the last was ever closed.
- Gemini/strict Schema profiles remove null/empty enum members, null types/defaults and unsupported Schema keywords while preserving tool names, required fields and semantics. The default `standard` profile is a true pass-through and never rewrites a request body.
- Model discovery now pre-selects the Gemini Schema profile when the endpoint serves Gemini-family models, and a Gemini 兼容 preset was added. Because `standard` is a genuine pass-through, leaving a Gemini upstream on it reproduces the empty-enum rejection on the first tool-using turn.
- Provider TOML uses an environment-backed `base_url`; old literal managed blocks migrate atomically on desktop launch, and config/credential/base-URL rollback remains transactional.

### Verification

- TypeScript, the production main/preload/Renderer build and the full offline suite pass: 64 test files and 319 tests, with 4 files / 7 tests skipped behind explicit `GROK_LIVE_*` and `GROK_CURRENT_PROVIDER_PROBE` gates. `npm audit --omit=dev` reports zero vulnerabilities.
- A live end-to-end run against a user-authorized Gemini-family endpoint proved the compatibility fix rather than assuming it. Three real calls: a no-tool baseline returned HTTP 200; the same tool schema carrying empty-string enum members returned HTTP 400 `GenerateContentRequest…enum[4]: cannot be empty` on the pass-through `standard` profile, reproducing the originally reported failure verbatim; and the identical request returned HTTP 200 once the `gemini` profile sanitized it. The probe is retained as `provider-gateway.live.test.ts`, gated on `GROK_LIVE_GATEWAY_KEY`/`_BASE`/`_MODEL`, and stores no credential.
- Seven stale local acceptance-probe assertions and two probe race conditions were found and fixed. They had rotted since the 0.6.4 settings refactor because the local probe chain never runs in CI — `package-win.ps1` takes a different branch under `GITHUB_ACTIONS` — so the 0.6.4 packaging gate never exercised them.
- An isolated `GROK_HOME` live test with installed CLI `0.2.112 (9bbd559437)` completed ACP `initialize/session/new/prompt` against a local fake OpenAI endpoint, proving `${ENV}` `base_url` expansion reaches `/v1/chat/completions` without a paid request.
- The user-authorized current managed Provider completed one minimal real ACP turn through the new compatibility gateway; its log recorded Schema sanitization and the former empty-enum HTTP 400 did not recur. The test did not log the credential, request body or response body.
- The 251-file public-source scan, zero-production-vulnerability audit and source-built 0.6.5 UI fixture pass. The fixture verifies collapsed structured Provider errors, exact 1m23s/input-120/output-30 turn metrics, all four update/diagnostic actions, real diagnostics navigation, the workbench return cycle, non-Git Review empty state, Provider manager and responsive composer/drawer.
- Formal packaging, per-user installation and GitHub Release publication are still pending; 0.6.4 remains the installed/public fallback until those gates pass.

## 0.6.4 - 2026-07-23 (public Latest release)

### Changed

- Replaced the Review-only right rail with an on-demand, resizable utility pane for real Review, plan/result, recent-file preview and background/queue task data. Unsupported terminal/browser placeholders remain absent.
- Review now loads a lightweight file index first and only fetches the selected file's hunks. Search, status and line statistics remain usable with an 850-file change set instead of rendering every Patch at once.
- Removed File and Review from the permanent left tool list. Recent files open read-only in the utility pane and enter the central Monaco workbench only after an explicit “编辑文件” action.
- Moved custom providers into a dedicated searchable manager with five presets, draft connection testing, pre-save model discovery, candidate search/multi-select/import, safe editable local IDs and manual-model fallback.

### Fixed

- Conversation navigation now survives Dashboard → conversation → file → conversation → task center → conversation without losing the message viewport or composer.
- The right utility drawer remains visible at narrow widths instead of being hidden by a conflicting media rule. Non-Git Review is an ordinary capability empty state and falls back to recent writes where appropriate.
- Provider discovery keeps unknown context windows unknown instead of fabricating 128K/200K defaults. Draft probes perform bounded main-process model-list GET requests only, reject redirects/oversized responses and keep credentials out of Renderer logs.
- Windows path boundaries now canonicalize existing absolute paths and 8.3 aliases before comparison. Hosted Runner `%TEMP%` values such as `RUNNER~1` no longer make Editor, Memory, Agent/Persona or Git fixtures look outside their real workspace, while symlink/junction escapes remain rejected.
- Pinned patched transitive releases for `@hono/node-server` and `fast-uri` after GitHub's release gate detected newly published path/host-confusion advisories; the application keeps MCP transport work in the sandboxed main process.
- Replaced the Review diff-header backtracking expression with a bounded linear parser, corrected TOML whitespace matching, and moved dynamic CDP probe arguments from generated JavaScript source into `Runtime.callFunctionOn` values.

### Verification

- TypeScript and the production main/preload/Renderer build pass. Seven focused files / 55 tests cover provider draft discovery, local-ID collisions, 401/timeout/oversize handling, Review index/detail/stale snapshots, the 850-file index, Scheduler health and Renderer stores/comments.
- The release PR's first Windows run exposed the 8.3/long-path alias mismatch above. The corrected four affected service suites pass 27/27 both with the ordinary local temp directory and with an explicit 8.3 short-name `%TEMP%` fixture.
- The subsequent hosted security gate exposed the new dependency advisories. After resolving `@hono/node-server` to 2.0.11 and `fast-uri` to 3.1.4, `npm audit` reports zero vulnerabilities; TypeScript and the complete 291-test offline suite still pass locally.
- The pull-request code-scanning policy then surfaced four high and seven medium findings in changed code. The affected parser, TOML patcher and six offline CDP probes were corrected; script syntax checks, TypeScript, 6 focused tests, the 243-file public scan and zero-vulnerability audit pass locally, and hosted CodeQL plus the code-scanning policy completed successfully with no open new PR alerts.
- The isolated 0.6.4 source fixture passes Dashboard → chat → recent file preview → explicit editor → chat → task center → chat, the four-tool right launcher, non-Git Review, 1280×720/1440×810@125%/1920×1080@200% composer bounds, a visible 1100 px drawer and the provider-manager preset/draft workflow. No model request is sent.
- The one final offline suite passed 291 tests with 2 explicit opt-in/live tests skipped (60 files passed, 1 skipped) using one Windows worker. The final public-source scan passed 243 text files after adding the installed-version probe.
- The sole formal package passed Electron Fuses and both public-source/artifact scans. The packaged and installed 0.6.4 fixtures pass the navigation cycle, recent-file preview/editor return, four-tool right pane, non-Git Review, responsive composer/drawer and provider manager.
- Per-user installation succeeded at `%LOCALAPPDATA%\Programs\Grok Build Desktop`. File/Product/Main/About versions report 0.6.4, diagnostics reports “可以使用”, attachment privacy exclusions remain present, and desktop/Start Menu shortcuts target the installation directory.
- Final local artifacts: Setup `be0080e4ce0d44528840fa6923e469b26407327d246bbf140e6f761bd76a8ca5`; Portable `1d6104e3ffdad4ae1cc5ca7c80f5352a3e8c63d7e72cb69df55bbc16837480c6`; CycloneDX SBOM `feb7207c0ed97e931fa31a54090658a5ba3aea701fb9af41add6f12817532b67`; third-party licenses `fb8469bdbecff72100bd94c44b2f67f1b596ade9854d95ce862a7559d3b1d82e`. Named 0.6.0–0.6.3 Setup/Portable/SBOM assets remain in `release`.
- PR #13 merged to `main` at `df5db6b` after Windows, gitleaks, CodeQL and code-scanning checks passed. Tagged workflow `29993675891` rebuilt and scanned the unsigned artifacts, attested Setup/Portable, created a Draft, downloaded it, verified `SHA256SUMS.txt` and provenance, and only then published `v0.6.4` as Latest.
- Public GitHub assets: Setup `ab4d037a8398ec8c12fc2365efba5ea8c4fae582486dd95f5cd27f8fc8eea1ab`; Portable `635147fafa85b9a0bd4c7d61c9a36a9bb50e4c83410c225ddddccee769945b71`; CycloneDX SBOM `5b789491ac459a0119fcf9f3b62e7140c35ef601d271e65fc6dd57b726b6dae0`; third-party licenses `e86a7b4249bd018f743e8c347e7b555cda81c3208c508e32810a91075d49942b`.

## 0.6.3 - 2026-07-23 (installed local hotfix)

### Fixed

- Windows Task Scheduler output is decoded from Buffer through UTF-8/UTF-16/GB18030-compatible paths and stored as structured diagnostics. Historical strings containing replacement characters now show a recoverable encoding-damage message instead of mojibake.
- Unified conversation targeting across sidebar tasks, persistent tasks, Dashboard, menu commands and deep links; returning from workbenches remounts/resizes the virtual conversation and restores the composer.
- Replaced the conversation body with a fixed header / `minmax(0,1fr)` messages / composer grid, added an always-visible “返回会话” action to workbenches and removed the duplicate bottom environment bar.
- Non-Git Review no longer raises a global error, and responsive CSS no longer creates a clickable-but-invisible Review state.

### Verification

- The accepted focused hotfix gate passed 27 tests, TypeScript, production build and public-source scanning. The first package candidate was rejected by the new 720 px composer-bound check and was not installed.
- The corrected 0.6.3 package passed the navigation/composer/non-Git Review fixture and was installed per-user. File/Main/About report 0.6.3, shortcuts target the installation directory, and the installed executable is the stable fallback while 0.6.4 is verified.
- Accepted hashes: Setup `e511290b900eaa2044025789de843d125be140d60804e22de3105bc4a76ec3e1`; Portable `a4eb6af38d742225ef02383483dfbe046c3095a480abc5356c90813e1265d45e`; SBOM `c628bff49c5e2d9b2df5f5860489ea4852e5ec477eced01998913a4a0fae4b95`.

## 0.6.2 - 2026-07-22 (local candidate)

### Changed

- Replaced the generic right summary rail with an on-demand, resizable Review pane covering Unstaged, Staged, Commit, Branch and Last turn scopes, unified hunks, real file/hunk Git actions and line-comment drafts.
- Added a typed execution-root-aware navigation channel shared by tool locations, Review, central Diff and the Monaco editor. File editing is now an explicit mode after read-only inspection.
- Reworked the sidebar into project task groups plus one default-collapsed development-tools section, added a searchable/closable workspace popover and task title menu, and removed the duplicate bottom-panel toggle.
- Added categorized settings and live background preview, and removed the fixed 72% conversation overlay so configured opacity, blur and dim values map directly to the canvas.
- Added persisted turn start/completion metadata with monotonic duration and outcome. Completed work collapses to “已处理”, while legacy process-only segments coalesce into one historical record without fabricated time.

### Fixed

- Tool and Review file jumps now resolve against the active session or Worktree execution root instead of the unrelated global workspace and position Monaco after mount.
- Generated images render in the final result area with large preview; 0.6.1 user-image cache, failed restore and reopen behavior remain intact.

### Verification

- Source version and lockfile are 0.6.2. TypeScript, production main/preload/Renderer builds, 9 focused files / 48 tests and the final 238-file public-source scan pass.
- The opt-in 0.6.2 fixture passes automated 900×720, 1100×720 and 1440×810 checks for default shell state, 30 legacy-process segments coalesced into one record, real elapsed display, Review scopes, ten settings categories, exact background controls, pasted-image failed-send retention and Renderer reopen.
- Computer Use against the isolated Grok window verified the rendered conversation, real unified Review, Review→read-only Monaco navigation, categorized settings, appearance preview and Escape close without sending a paid model prompt.
- The one final offline suite passed 284 tests with 2 explicit opt-in/live tests skipped (60 files passed, 1 skipped) using one Windows worker to avoid Git/ACP child-process contention.
- The sole formal package passed Electron Fuses and two streamed artifact scans. Packaged and installed 0.6.2 fixtures passed Review scopes, settings, exact background controls, responsive layout, pasted-image failure retention and Renderer reopen. Per-user file/Main/About versions report 0.6.2, diagnostics reports “可以使用”, and desktop/Start Menu shortcuts point to the installation directory.
- Final local artifacts: Setup `8a2d7508296ee5846bb589c01ce4fa64a2194cd40a1ae5ba6d96a733432ca8d7`; Portable `9aa7251857c2c33044354ee8c51ade36f9d18409946a16f47d8d1a11d7532f83`; CycloneDX SBOM `e00f6eb90a5fd33ac0aebb953283fb59d924c339d4bede8467305deddfe4d714`; third-party licenses `e5e4edd9035f514d7b111bd3417db46ce86f3f51396b11b05fb8db1d677ecdff`. 0.6.1 named Setup/Portable/SBOM assets remain in `release`.

## 0.6.1 - 2026-07-22 (local candidate)

### Changed

- Rebuilt the application shell around Codex's task-first information architecture: direct left navigation, collapsible project tools, project session groups, task/header controls, a 320 px responsive summary rail, a real Git/Worktree environment bar and a toggleable bottom changes panel.
- Constrained conversation content to a focused 760 px column, refined process/file groupings, and aligned the floating composer across idle, running, queued, interjection and stop states while retaining the configured conversation background with stable readability layers.
- Session hover actions now expose Pin and Archive directly and keep Export/Rename/Delete in the necessary overflow menu. Unsupported PR/site/feedback/voice controls were not added.

### Fixed

- Pasted images now survive send and session reopen. `clientMessageId` and durable attachment previews bind images to the user message; ACP replay merges into that message instead of creating blank or duplicate turns.
- Inline images are validated and materialized in a session-scoped main-process cache before ACP receives standard image blocks. Image paths are no longer duplicated in prompt text; queue/interjection/failure flows use the same attachment presentation.
- Failed messages retain their images and can restore available content to the composer. Missing sources render a named fallback instead of blank space, and deleting a session removes its attachment cache.
- Startup now completes orphan attachment cleanup before Renderer restore/materialization, preventing a fast reload from deleting a newly created session-image directory.
- Public artifact scanning now streams UTF-8/UTF-16 chunks instead of decoding every large EXE/ZIP into memory at once; the same local-path rules remain enforced under constrained Windows commit memory.

### Added

- Added the sanitized `docs/CODEX_UI_PARITY.md` audit matrix and an opt-in packaged offline UI fixture for message cards, navigation, summary/environment panels, pasted-image before/after visibility, lightbox and responsive/reopen acceptance without a paid model prompt.
- Added focused attachment-cache and message-merge tests, main-process PNG/JPEG/WebP/GIF/MIME/20 MiB validation, orphan/capacity cleanup and explicit support-bundle exclusion for attachment bodies, Base64, cache files and full paths.

### Verification

- The accepted full offline suite passed 270 tests with 2 explicit opt-in tests skipped (57 files passed, 1 skipped). Windows Git/ACP integration workers are capped at four with a 20-second harness timeout; after the packaged reload race was fixed, TypeScript and 23 directly affected tests passed again.
- Production main/preload/Renderer builds, Electron Fuses, the final 229-file source scan and two complete streamed artifact scans pass. Packaged acceptance covers the base shell, 1280×720 and 3840×2160 composer/theme/focus flows, Task/Extensions/Media overlays, the 0.6.1 shell fixture, 1100×720 and 1440×810 responsiveness, Task Scheduler headless wakeup and Portable launch from a Chinese/space-containing path.
- The final Setup was installed per-user at `%LOCALAPPDATA%\Programs\Grok Build Desktop`. Desktop and Start Menu shortcuts target that executable; file/product version, main-process bootstrap and About all report 0.6.1, while the diagnostics center reports “可以使用”. The installed offline fixture confirms pasted-image preview, message visibility after send failure and visibility after Renderer reopen without sending a paid model prompt.
- Final local artifacts: Setup `dfc9d2a3feb62a4ac49d7fe76bf9bd07e3cf8289f2966a0fd85837a06a4043ba`; Portable `553bc500f3f8da69406fea56798c3c2b5b6317db272a0e154d192a8332982316`; CycloneDX SBOM `fafef7cc7197b6f0dc4a7de4c6260725487c825623f94ba67e32ffdf9f45dbbb`; third-party licenses `5a82814c8a9a7147c245f09b3d992e7923fd5550d1fe3617df8f969a82acacc2`. The named 0.6.0 Setup/Portable/SBOM assets retain their original hashes and were not overwritten.
- Earlier preflight attempts are not release evidence: one exposed a 5-second Memory harness timeout, one used a malformed session `TEMP` under excessive child-process concurrency, and the first package was rejected by the new reload fixture because it exposed the startup cache race. Only the hashes above identify the accepted 0.6.1 candidate.

## 0.6.0 - 2026-07-22 (local candidate)

### Documentation

- Added the canonical next-session handoff covering the v0.5.16 release baseline, accepted product behavior, resolved regressions, security boundaries and non-repetitive verification discipline.
- Recorded the approved v0.6.0 plan for the lightweight editor, Git panel, Grok Worktrees, workspace-scoped Memory, Agent/Persona management, Agent Dashboard and reusable session execution profiles. Implemented items are marked only after focused automation or documented live acceptance.
- Reconciled the implementation plan, feature matrix and CLI compatibility matrix with the published v0.5.16 release instead of the superseded local-candidate/v0.5.12 Latest status.

### Changed

- Rebuilt the Renderer shell after a read-only Computer Use comparison with the current Codex desktop layout: one quiet project/task sidebar, a labelled workbench switcher, compact context header, centered content column, floating composer and a restrained empty state replace the dense icon grid and oversized welcome treatment.
- Replaced remaining file-workbench glyph controls with consistent inline SVG icons, reduced completed execution-process spacing, and added a minimum readability scrim for user-selected conversation backgrounds.
- Replaced the five cramped per-session hover glyphs with one overflow menu containing labelled Pin/Archive/Export/Rename/Delete actions; clicking outside now closes the menu.
- Updated the v0.6 Electron UI probes to navigate through the labelled workbench menu rather than the removed activity-icon grid.

### Added

- Added the v0.6 shared contracts for workspace trees, editor documents/conflicts, Git, Worktrees, Memory, Agent/Persona definitions, Agent Dashboard nodes, execution profiles, CLI capabilities and automation health.
- Added a main-process `CliCapabilityService` with version caching, explicit `supported`/`unsupported`/`unknown` states, non-billable help/inspect probes and ACP runtime evidence overlays. The snapshot is exposed through sender-validated IPC and the sandboxed Preload bridge.
- Documented v0.6 service ownership and IPC boundaries in `docs/V060_ARCHITECTURE.md`.
- Added the first file workbench: activity switching, lazy ignored-aware file tree, bundled offline Monaco workers, multi-tab editing, cursor/dirty-buffer retention, create/rename/delete/reveal actions and built-in find/replace/go-to-line behavior.
- Added main-process workspace/editor services with canonical `realpath` boundaries, symlink escape rejection, UTF-8/BOM/GB18030 and CRLF/LF preservation, 5/20 MiB thresholds, SHA-256/mtime conflict detection, transient rollback backup and atomic replacement.
- Added disk-conflict Diff/reload/overwrite/save-copy choices and file/line references for “添加到对话 / 解释 / 修改”.
- Added the main-process Git service and source-control workbench: porcelain-v2 status groups, credential-sanitized remotes, worktree/index Diff, single/batch/all stage and unstage, stdin commit, history/details, branch creation/switching, five-minute cancellable Pull/Push and exact-list discard.
- Added one-time full-repository trust for subdirectory workspaces, dirty-editor branch-switch blocking, conflict-to-editor navigation and typed sender-validated `git:*` IPC through the sandboxed Preload API.
- Added the Worktree service and activity view with Grok private-method preference plus a controlled Git fallback, durable source/Agent metadata, create/recovery inventory, commit/file/line-count apply previews, preview tokens, target/source cleanliness gates, merge-result verification and conflict preservation.
- Added optional post-apply cleanup (off by default), rejection of dirty or unmerged Worktree removal, read-only GC preview, file/Git/session navigation and typed `worktree:*` IPC. New sessions and forks can select Worktree execution profiles, names and base refs; Worktree sessions use their own source group, while native repository identity shares project Memory across clones and Worktrees.
- Added the main-process Memory service and center: exact Grok `org/repo` + ASCII slug + BLAKE3 layout, default-off per-workspace AppData settings, `GROK_MEMORY` process injection, global/project/session browsing and search, Monaco editing, atomic conflict-safe saves, preview-token remember, session-summary deletion and fixed-argument `grok memory clear`.
- Added explicit `/flush` and `/dream` controls with visible status/timestamps, native-off/controlled-restart session enablement, strict `GROK_HOME/memory` realpath/symlink boundaries, disabled Memory debug logging and explicit support-bundle exclusion.
- Routed confirmed remembers through the active ACP session's native `/remember`, added exact structured-entry parsing/deletion with fresh preview tokens and hash-conflict protection, and added configured idle session-end Flush/automatic Dream behavior without running these commands during controlled restarts or CLI-update suspension.
- Added the main-process Agent/Persona definition service and central workbench: builtin/plugin/user/project source grouping and precedence, read-only bundled/plugin definitions, structured Agent fields, Persona defaults/contracts, bundled Monaco raw Markdown/TOML editing and typed sender-validated `agents:*`/`personas:*` IPC.
- Added user/project create/copy/edit/toggle/rename/delete, exact comment/unknown-field preservation, Windows-safe name/path and symlink checks, external SHA-256 conflicts, temporary atomic replacement, persistent `.grok-desktop.bak`, fixed-argument `grok inspect --json` validation with rollback, and current-CLI fallback that restarts only idle sessions. Persona creation remains file-based and never edits `config.toml`.
- Added reusable session execution profiles with five built-in presets, global/project AppData precedence, immutable per-session snapshots and native Agent/process/ACP metadata compilation. New sessions, forks and persistent tasks share the same selector; unsupported `maxTurns` is visibly disabled and rejected instead of ignored.
- Added a desktop-native Agent Dashboard backed by ACP status/tool/meta/sub-Agent events, task inventory and session history. It shows parent/child state, Agent/Persona, model/effort, duration, tools/context and Worktree isolation; it supports open/stop/jump/filter/UI-clear actions and never starts the Grok TUI Dashboard.
- Added persistent-task health checks and conservative repair. Registration, current executable mapping and stale session metadata are repairable; missing accounts, providers, models, workspaces or execution profiles require explicit configuration, and health checks never decrypt or send task prompts.

### Verification

- The candidate's one full offline-suite run completed 262 tests with 2 explicit opt-in tests skipped; one structured-Memory deletion case exceeded Vitest's original 5-second per-test harness timeout while the suite was contended. Only that timeout was raised to 20 seconds, after which the focused Memory file passed 7/7. The fixed temporary-repository v0.6 integration flow independently passed 1/1 and covers Worktree profile → Editor/Git → Dashboard → Memory → safe Apply → forced conflict → resolution/cleanup, including exactly one `--always-approve` mapping. The full suite was not repeated.
- TypeScript, the production main/preload/Renderer build and the 223-file public-source scan pass. Isolated Electron/CDP probes cover Editor, Git, Worktree, Memory, Agent/Persona, Profiles, Dashboard, the new-session profile selector and persistent-task health UI without sending a paid prompt. Git/Worktree tests use only temporary repositories, a local bare remote and a local stalled HTTP fixture; Memory/Agent tests use isolated roots.
- The post-candidate shell redesign passed TypeScript, a production build, 8 focused Renderer tests and live Computer Use acceptance of the empty state, workbench switcher, file workbench, session overflow menu/outside-close behavior and custom-background readability. No model prompt was sent.
- Exactly one local v0.6.0 candidate package was generated. Electron Fuses, packaged-artifact scanning, the visible packaged shell, packaged Profiles/Dashboard/launch/task-health flow and Portable launch from a Chinese/space-containing path pass. Setup SHA-256 is `022f54f087c17949fb8048641cb4ad130240d49af5afb1010aba675158db9539`; Portable SHA-256 is `46025264a06f5ac7384c5aa6d993bf7521aa0795f40030cf52103bce9cf6d0f3`. These artifacts predate the post-candidate shell redesign and must not be represented as containing it; no second package was generated.
- `npm audit --omit=dev` still reports the two pre-existing moderate `@modelcontextprotocol/sdk` → `@hono/node-server` findings; the offered forced fix is a breaking MCP SDK downgrade and was not applied.

## 0.5.16 - 2026-07-21

### Added

- Grok sessions now carry a durable origin classification. The sidebar separates ordinary sessions, scheduled-task sessions and Codex continuations into independent collapsible groups, with visible source badges and source text in the title bar.
- Persistent tasks now own one reusable Grok session by default. Each task can instead replace that session before every run, and its current context can be permanently cleared from the task center.
- The task editor shows the context policy and current dedicated session, and can open that session directly.

### Fixed

- “在 Grok 中继续” now names the newly created Grok session exactly after the original Codex task and marks it as a Codex continuation. Multiple continuations of the same Codex task are retained instead of overwriting one mapping.
- Existing task run records and older Codex continuation metadata are migrated into source groups without changing Codex source files. Manually renamed Grok sessions remain user-owned.
- A scheduled task reopens its fixed account/provider/model session on later runs instead of creating unbounded sidebar entries. Fresh-context mode deletes the prior dedicated session before creating its replacement.
- Public-source scanning now skips the intentionally Git-ignored `local/` research cache while continuing to scan every tracked source/document and packaged artifact.

### Verification

- TypeScript, production build and 30 focused catalog, lifecycle, process-manager and grouping tests pass.
- An isolated packaged UI fixture verified the two source groups, persistent collapse UI and Codex title/source badge. The packaged task editor verified reuse is the default.
- A packaged OAuth task completed two consecutive real Grok runs using the same task ID and the same resumable session ID. Manual cleanup then removed the mapping and session directory; the temporary task was deleted.
- GitHub Release `v0.5.16` is public and marked Latest at commit `e4dfb62`; workflow `29846404781` completed successfully and published Setup/Portable, SHA-256, SBOM, licenses and build provenance. The published Setup SHA-256 is `8f7ec0af2d6dda7cb75878f5e544d538eed394ef49b6920f901b1d4afede539f`; Portable is `a94cf86c973688f47d6565fd66590f3d8250b4b7c997ed5b379b5a505360fcf1`.

## 0.5.15 - 2026-07-21

### Fixed

- Opening “分叉与回退” on CLI versions without `x.ai/rewind/points` now degrades to the panel's empty state. Optional private-method absence no longer creates a bottom-right global error toast; action failures remain visible inside the panel.
- “自动批准” is now authoritative. Scheduled workers approve ordinary ACP tool requests without applying a second scheduled permission policy, and Computer Use skips optional per-application and inferred-risk confirmation prompts in this mode. Plan/Agent restrictions, protected applications, password/OTP/CAPTCHA rules and Windows secure-desktop boundaries remain intact.
- Persistent worker prompts may run for up to 23 hours, aligned with the Task Scheduler execution limit, instead of failing healthy long tasks after the interactive 30-minute turn timeout.
- The task editor labels auto mode as “自动批准（无限制）”, disables the redundant permission selector and explains that no secondary confirmation is applied. Existing tasks with stale secondary-policy values are normalized at execution time.
- Added an opt-in packaged live-automation probe that creates, runs and cleans a real scheduled task, verifies a resumable Grok session, and checks optional rewind degradation without exposing credentials or prompts.

### Verification

- TypeScript, production build and 34 focused ACP, automation-policy, Computer Use and task-center tests pass.
- A packaged v0.5.15 worker used the current OAuth account and `grok-4.5` to read this workspace's `package.json` through an auto-mode task. It reached `completed` in about 40 seconds, returned a real resumable session, produced no permission wait, released both task/global locks, and cleaned its temporary task/session.
- The same packaged acceptance opened the generated session against CLI 0.2.106, received an empty optional rewind result, and observed no global error toast. The task editor packaged probe confirmed the secondary permission selector is disabled in auto mode.

## 0.5.14 - 2026-07-21

### Fixed

- Fixed OAuth scheduled tasks failing with `Authentication required` after their stored refresh token had rotated. Before starting a worker session, the app now compares the task's fixed account with the canonical Grok `auth.json` identity and uses the newer canonical credential when they match.
- Worker-side OAuth refreshes are reconciled back to the encrypted account vault and canonical credential file with compare-before-write behavior. A credential refreshed concurrently by another Grok process is preserved instead of being overwritten.
- Existing English authentication failures are presented as actionable Chinese text in the task center.

### Verification

- TypeScript and 26 focused authentication, worker, automation and task-center tests pass, including stale-vault selection, worker refresh persistence and concurrent refresh preservation.
- A local metadata-only probe confirmed the affected task account matches the canonical login while the vault held an older rotated refresh token. No token or prompt was printed and the task was not executed during diagnosis.

## 0.5.13 - 2026-07-21

### Fixed

- Fixed scheduled-task workers failing to decrypt DPAPI-protected prompts. Before Electron becomes ready, the headless worker now copies the canonical Chromium `Local State` into its isolated session directory, so `safeStorage` opens the original encryption key without sharing the GUI's active browser profile.
- Reworked the task editor's Computer Use, wake and notification checkboxes into three aligned option cards with a title and description; the cards collapse to one column on narrow windows.
- Localized automation run states and replaced the old raw `safeStorage.decryptString` failure with an actionable Chinese message. A future decryption failure also reports a concise Chinese recovery instruction without exposing task content.

### Verification

- Targeted TypeScript and 14 automation/task-center tests pass. A packaged v0.5.13 renderer probe opens the task center and verifies all three checkbox cards, their labels, descriptions, alignment and viewport containment.
- A focused live DPAPI probe decrypted the existing affected task with the canonical storage paths without printing its prompt; the task was not executed and no model usage was incurred.
- The local `win-unpacked` build passed the public-safety scan, native-host self-test, production build and visible-window launch. The sole desktop shortcut now targets this v0.5.13 build.

## 0.5.12 - 2026-07-21

### Fixed

- Simplified the GitHub Release workflow to deterministic artifact production: unsigned Setup/Portable packaging, Electron Fuse and public-safety checks, SHA-256, SBOM, license report, provenance, draft download verification and publication.
- Removed repeated hosted GUI/CDP, Windows `InteractiveToken` Task Scheduler and installer lifecycle runs. Those product gates already passed locally and in main CI; GitHub hosted desktops cannot reliably provide the required interactive Windows session.
- `v0.5.11` remained unpublished and created no Draft assets after the hosted scheduler could not wake even when it ran before every GUI process.

### Verification

- Application runtime is unchanged from the locally accepted v0.5.11 candidate. GitHub generated all five release assets and both attestations; the downloaded Setup, Portable, SBOM and license report matched `SHA256SUMS.txt`, provenance verification passed, and v0.5.12 was published as Latest.

## 0.5.11 - 2026-07-21

### Fixed

- Reordered hosted Windows acceptance so the Task Scheduler headless entry runs before the job's sole Renderer; this avoids the hosted desktop resource leak observed only after an Electron GUI exits.
- The build runner now validates the Portable archive in a Chinese/space-containing path without starting a second GUI. The fresh download-verification runner independently executes Task Scheduler first and then launches the downloaded Portable UI, retaining both release gates.
- `v0.5.10` remained unpublished and created no Draft assets: packaging, Fuses and the packaged shell/entry probe passed, while the later scheduled marker did not appear within 60 seconds.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, the physical-GPU 4K and independent-overlay flows, real Task Scheduler wakeup, Chinese-space Portable UI, the exact hosted execution order, Electron Fuses and NSIS install/upgrade/uninstall retention pass locally. Cloud Draft assets will still be downloaded, hash/provenance checked, installed, launched and scheduler-tested before publication.

## 0.5.10 - 2026-07-21

### Fixed

- Scoped the GitHub hosted virtual-desktop gate to what that environment can verify reliably: packaged application content, the rendered shell, the fixed overlay host, and task/extension/media entry availability.
- Heavy modal interaction is still mandatory before a tag: local packaging verifies the physical-GPU 4K flow, whole-window backgrounds, task/extensions/media layout, modal focus, `Esc`, individual Renderer processes, startup routing, Portable launch and Task Scheduler wakeup.
- `v0.5.9` remained unpublished and created no Draft assets. Its only cloud Electron process rendered the complete shell, then the Windows hosted graphics/CDP channel stopped immediately after a task-panel click that passes in every local hardware and software-rendered acceptance path.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted shell/entry flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.9 - 2026-07-21

### Fixed

- Replaced the hosted Windows package gate's chain of six short-lived Electron/CDP sessions with one fresh packaged Renderer that verifies the application shell, task center, extension center and media studio in sequence.
- Local packaging still keeps the physical-GPU 4K long flow, every panel in an independent process, startup task-center routing, Portable launch and Task Scheduler wakeup. The cloud-only consolidation avoids a GitHub virtual-desktop resource failure without reducing product-side acceptance.
- Added a stage-labelled hosted release probe with bounded CDP calls, fixed overlay checks, focus verification and `Esc` close behavior.
- `v0.5.8` remained unpublished and created no Draft assets. Its third Electron instance stopped responding before the first DOM query and before the task button was clicked, proving the remaining failure was repeated hosted CDP process startup rather than task-center data or rendering.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact single-Renderer hosted flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.8 - 2026-07-21

### Fixed

- Changed task-center discovery from six concurrent system-backed IPC reads to a deterministic sequential snapshot. This prevents DPAPI, registry, PowerShell, Task Scheduler and Grok configuration discovery from contending with the first modal frame on slower Windows virtual desktops.
- The task-center close control now receives focus in the mount commit, before asynchronous data discovery. Keyboard focus, `Esc` handling and screen-reader dialog navigation no longer depend on a later timer.
- Added a regression test that delays every task-center source and proves at most one system-backed read is active at a time.
- `v0.5.7` remained unpublished and created no Draft assets; its run passed the main packaged UI flow, then reproduced the task-center renderer/CDP stall after the panel mounted.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted-runner split flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.7 - 2026-07-21

### Fixed

- Made the packaged offline-smoke task center fully deterministic. Providers, automations, run history, global policy, background tasks and inbox now return isolated empty/default data without touching DPAPI, the user environment/registry, PowerShell, real Grok configuration or Task Scheduler state.
- Normal installed and portable behavior is unchanged because the bypass is restricted to the private `GROK_DESKTOP_OFFLINE_SMOKE=1` child-process environment created only by the verification harness.
- `v0.5.6` remained unpublished and created no Draft assets; its split flow proved the long UI sequence was fixed, then isolated the remaining hosted stall to task-center system-data discovery inside an otherwise fresh Renderer.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted-runner split flows, deterministic task-center overlay, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan.

## 0.5.6 - 2026-07-21

### Fixed

- Re-established modal focus after a lazy `Suspense` fallback is replaced. A guarded `MutationObserver` now focuses the first control only when focus is still outside the active overlay, so async panel updates never steal the user’s current focus.
- Kept the full viewport/theme/panel stress sequence for local physical-GPU acceptance, while clean GitHub Windows runners verify task, extension and media overlays in independent fresh Renderer processes. Each probe still checks the dedicated overlay root, fixed backdrop, viewport bounds, focus and `Esc` close behavior.
- `v0.5.5` remained unpublished and created no Draft assets; its run passed packaging and the complete pre-panel flow, then demonstrated that the hosted virtual desktop—not the task feature contract—could not sustain every heavy transition in one Renderer instance.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, the physical-GPU 4K long flow, the exact hosted-runner split flow, Task Scheduler wakeup, Chinese-space Portable, Electron Fuses and NSIS install/upgrade/uninstall retention all pass. Local v0.5.6 hashes are recorded in the implementation plan.

## 0.5.5 - 2026-07-20

### Fixed

- Extended the explicit `GROK_DESKTOP_OFFLINE_SMOKE=1` contract to the default Extensions plugin inventory, so clean GitHub Windows runners render the complete extension overlay without attempting ACP or Grok CLI discovery.
- Added a direct regression assertion that offline plugin and Skill inventory performs zero CLI/ACP calls, and gave each task, extension and media overlay its own packaged-probe progress stage.
- `v0.5.4` remained unpublished and created no Draft assets; its stage-labelled run isolated the final hosted-only stall to the default Extensions tab after all preceding overlay, theme and focus checks had passed.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, 4K and hosted-runner UI paths, Task Scheduler wakeup, Chinese-space Portable, Electron Fuses and NSIS install/upgrade/uninstall retention passed. Local package hashes are recorded in the implementation plan; downloaded GitHub artifact verification follows after tag publication.

## 0.5.4 - 2026-07-20

### Fixed

- Disabled GPU acceleration only for Electron instances launched by GitHub Actions smoke tests. This avoids the hosted Windows virtual-GPU/CDP deadlock while leaving normal local, installed and portable application rendering unchanged.
- Added named progress stages to the comprehensive packaged UI probe. Any future CDP timeout now identifies the exact palette, background, focus, theme or overlay phase instead of reporting only `Runtime.evaluate`.
- `v0.5.3` remained unpublished and created no Draft assets; its clean offline log isolated the remaining failure to the hosted virtual desktop rather than Grok CLI integration.

### Verification

- The hosted-runner path, including `--disable-gpu`, 1920×1080 layout, theme/background switching and all root overlays, passed locally with `GITHUB_ACTIONS=true`. Normal packaging still runs the hardware-backed 3840×2160 path.

## 0.5.3 - 2026-07-20

### Fixed

- Made the isolated packaged-release smoke profile return an empty Skills list without attempting Grok CLI discovery. Reopening the composer palette no longer injects repeated missing-CLI IPC failures into a Windows hosted Renderer that is intentionally running without user software or credentials.
- Added a regression test proving that `GROK_DESKTOP_OFFLINE_SMOKE=1` never invokes the plugin inventory or CLI locator. Normal application and live verification behavior is unchanged.
- `v0.5.2` remained unpublished and created no Draft assets; its run confirmed that the third offline palette load, rather than the selected large viewport alone, was the remaining hosted-only failure.

### Verification

- The normal local release package continues to test the real 3840×2160 path, while the GitHub branch uses 1920×1080 and a strictly offline extension inventory.

## 0.5.2 - 2026-07-20

### Fixed

- Kept the physical 3840×2160 add-palette regression in local packaging acceptance, while using a stable 1920×1080 large-viewport check on GitHub's virtual Windows desktop. The hosted Chromium GPU stopped servicing CDP requests after a synthetic 4K override even though the same packaged UI passed on a real local desktop.
- `v0.5.1` also remained unpublished and produced no Draft assets. Its bounded probe exposed the virtual-GPU failure in five minutes instead of timing out after an hour; the immutable release retry therefore advances to `v0.5.2`.

### Verification

- The hosted-runner branch of the corrected overlay/theme/add-palette probe passed locally with `GITHUB_ACTIONS=true`; normal local packaging continues to exercise the full 3840×2160 path.

## 0.5.1 - 2026-07-20

### Fixed

- Replaced the packaged UI acceptance probe's hosted-runner-dependent CDP input injection with focused bubbling keyboard events. All CDP calls now have explicit timeouts, so a stalled Windows desktop session produces an actionable failure instead of consuming the full Release job timeout.
- `v0.5.0` was never published: its first tag workflow built the application and passed the initial content smoke, but the legacy keyboard probe stalled before any Draft Release or public asset was created. The immutable follow-up is released as `v0.5.1` rather than moving the existing tag.

### Verification

- The corrected full overlay/theme/add-palette probe passed locally against the packaged application before the `v0.5.1` rebuild and GitHub retry.

## 0.5.0 - 2026-07-20

### Added

- Added safe custom model providers for OpenAI Chat Completions, OpenAI Responses and Anthropic Messages, including editable presets, model discovery, connection tests, desktop/CLI defaults and external read-only Grok model discovery.
- Added current-user Windows Task Scheduler automations for one-time, daily, weekly and one-minute-or-longer intervals. Prompts and pending confirmations use Windows DPAPI; workers run without a BrowserWindow and preserve recoverable Grok sessions and run history.
- Added server-authoritative prompt queues, same-turn interjection, queue editing/reordering/removal, session forks, three rewind modes, app-only session archive metadata and a unified task/inbox center.
- Added deterministic Task Scheduler headless probing and a two-stage tagged Release workflow that keeps assets in Draft until downloaded hashes, attestations, installer lifecycle, portable UI and scheduled-worker checks pass.

### Changed

- Custom provider credentials use `GROK_DESKTOP_PROVIDER_<ID>_KEY` user environment variables or explicit existing-variable references. Keys never enter TOML, Renderer payloads, command arguments, logs or support bundles.
- Grok private extensions now follow the current official queue/interjection/fork/rewind/background-task/sub-Agent wire contracts and degrade independently when an older CLI lacks an optional capability.
- The task center now combines queued prompts, terminal/monitor jobs, live sub-Agents, session loops, persistent automations and pending confirmations without adding a permanent right sidebar.

### Fixed

- Fixed whole-window backgrounds overriding fixed overlay positioning. Root dialogs now render under a dedicated `#overlay-root`, preserve viewport bounds and focus, lock background scrolling and close topmost-first with Escape.
- Fixed fixed-position modal visibility detection so keyboard focus trapping remains active when Chromium reports a null `offsetParent`; packaged CDP acceptance now verifies focus establishment and Tab containment.
- Fixed same-format custom-background replacement so the previous app-owned image remains recoverable until the new file has completed its atomic swap.
- Fixed scheduled worker/uninstall startup so they do not race the normal automatic task-registration repair path.
- Fixed provider update/removal failures after model reload so TOML, the application-owned provider index, replacement credentials and removed credentials all roll back as one transaction.
- Fixed queued persistent automations counting one another as active global runs. Distinct atomic slot files now enforce the configured maximum without a three-or-more-task waiting deadlock.
- Pending scheduled-task notifications can launch or focus the interactive app directly into the task center; headless completion notifications no longer claim an unavailable click action.
- Scheduled-task completions and failures now enter the unified inbox exactly once, even when the terminal event is replayed.
- A scheduled worker that can no longer decrypt its DPAPI prompt now records a terminal failed run and releases all locks instead of leaving a stale running record.

### Security

- Provider TOML writes modify only the marked application block, check the original hash, validate the complete file, replace atomically, keep five backups and roll back when Grok validation fails.
- Non-loopback plain HTTP endpoints require an explicit warning confirmation. Provider networking honors the configured Electron proxy without exposing secrets to Renderer code.
- Scheduled tasks run as the current interactive user with least privilege, reject concurrent runs, cap global concurrency, coalesce missed runs and pause high-impact actions for an expiring encrypted confirmation.

### Verification

- TypeScript, the production build, public source safety scan, high-level dependency audit and 193 offline tests passed locally; two explicit live Computer Use tests remain excluded from the default suite by design. Final packaged artifact scanning is repeated after the release files are regenerated.
- Grok CLI `0.2.106 (bde89716f6)` accepted the isolated custom-model TOML, ACP initialization, session creation, live reasoning-effort switch, media command and injected Computer Skill without a paid prompt.
- The packaged application passed content-aware cold startup plus full-window-background overlay probes, real current-user Task Scheduler headless wakeup, NSIS first-install/overwrite/uninstall with AppData retention, portable launch from a Chinese path containing spaces, Fuse verification and the unique desktop-shortcut check.
- The canonical Setup/Portable/SBOM/license hashes are emitted in the accompanying `SHA256SUMS.txt`; the GitHub workflow downloads the Draft assets and verifies this manifest plus both executable attestations before publishing.

## 0.4.2 - 2026-07-20

### Added

- Added a portal-based, keyboard-accessible Codex-style composer palette for files, images, path-only folder attachments, workspace references, Computer Use and Skills from enabled plugins.
- Added one-shot Computer/Skill capability chips with per-session draft restoration. Computer selection now emits a generic `/computer <instruction>` only when the user sends the message and does not enumerate or start a target beforehand.
- Added a fully Chinese native Electron menu with fixed links to the owner's repository, Releases, Issues and xAI documentation.
- Added global dark, light, system and custom-color themes plus application-owned background images with conversation/window scope, fit, position, opacity, blur and adaptive light/dark masking.
- Added the v0.5.0 Windows Task Scheduler design to `docs/SCHEDULED_TASKS_ROADMAP.md`; no scheduling runtime is included in v0.4.2.

### Changed

- Theme colors now use semantic variables across chat, Markdown, Shiki, Mermaid, Monaco Diff, KaTeX, extensions, diagnostics, onboarding, tool cards, scrollbars and the composer. The last known non-sensitive theme is painted before React mounts to avoid a startup theme flash.
- Repository/update destinations are fixed to `wangyingxuan383-ai/grok-build-desktop`; they are not inferred from Git remotes, Actions forks or local environment variables.
- Device-code process cleanup and Windows process-tree termination tests now use deterministic bounded waits instead of real-network timing.

### Fixed

- Fixed the permanent packaged black screen: disabling Electron's file-protocol privilege fuse caused `BrowserWindow.loadFile()` to return `net::ERR_FILE_NOT_FOUND` for the renderer entry inside `app.asar` on Windows.
- Kept ASAR integrity, `OnlyLoadAppFromAsar`, Renderer sandboxing, CSP, navigation restrictions and typed IPC validation enabled while allowing the packaged `file://` renderer to load.
- Added a visible Chinese startup-recovery page with reload, log, diagnostic-export and default-window recovery actions when the Renderer cannot load.
- Removed the clipped legacy composer menu and the pre-send Computer application/window picker; the large palette now lives outside the composer's overflow boundary.

### Security

- Theme images are format/size validated, copied under `%APPDATA%`, and exposed only through the exact read-only `grok-theme://background/current` resource. Paths and image content are excluded from logs and support bundles.
- Native-menu external links pass an exact fixed-destination allowlist before opening; Renderer filesystem, process and shell access remains unavailable.

### Verification

- Packaged smoke testing now connects to a temporary loopback DevTools endpoint and requires a rendered `.app-shell`, non-empty body text and the correct document title; a window handle alone can no longer pass a black screen.
- TypeScript, the production build, the public-safety scanner, npm high-level audit and 167 automated tests passed locally; 2 opt-in live Computer Use cases remain intentionally skipped by the offline suite.
- The opt-in real Grok Computer Use acceptance was also rerun separately: visual control reached the exact fixture result, while the high-impact delete sentinel requested confirmation and was not executed after rejection.
- Final unsigned Setup/portable ZIP, SHA-256, CycloneDX SBOM and license report were regenerated for `0.4.2`; packaged content/UI/theme smokes, the portable Chinese-and-space path launch, Fuse checks and the sole desktop shortcut cold launch all passed locally.
- The broken `v0.4.0` and `v0.4.1` public releases were withdrawn to Draft while the corrected `v0.4.2` package is verified.

## 0.4.1 - 2026-07-20

### Fixed

- Fixed PowerShell 5.1 desktop-shortcut, packaged-window smoke and v0.3 UI probe scripts when the executable argument is omitted; release hashing now uses the .NET SHA-256 implementation instead of relying on cmdlet auto-loading.
- Rebuilt the local self-use package, regenerated the sole desktop shortcut and verified both a cold packaged launch and a shortcut launch expose the visible main window.

### Release history

- Version `0.4.1` passed its original automated, packaging, installer-lifecycle and attestation checks, but the old smoke test only asserted a window handle and missed the empty Renderer document.
- It was withdrawn after the black-screen report and is superseded by `v0.4.2`.

## 0.4.0 - 2026-07-19

### Added

- Added a public-release configuration layer with tracked defaults, an ignored local override, machine-neutral `BuildInfo`, stable `io.github.grokbuilddesktop.community` app/AUMID identity and an unsigned Simplified Chinese NSIS/ZIP release pipeline.
- Added a Chinese first-run wizard for Windows/DPAPI/CLI/ACP/account/workspace/Computer Use setup, including the official Grok CLI installation command and a rerun entry.
- Added a compatibility diagnostics center with capability-level degradation, dynamic `--effort`/`--reasoning-effort` probing, copyable summaries and a user-previewed ZIP support bundle that excludes prompts, sessions, screenshots, file contents, credentials, full paths and proxy addresses.
- Added low-frequency stable GitHub Release checks. Unsigned builds only show release notes, the release page and SHA-256 guidance; they never download or execute an installer.
- Added asynchronous `@文件` search with Chinese fuzzy matching, `.gitignore`/hard exclusions and attachment chips; sensitive/out-of-workspace attachments now require a one-time confirmation.
- Added `Ctrl+Shift+F` current-session search with virtual-list positioning, narrow-window sidebar collapse, a UI recovery/diagnostics entry, pre-version UI metadata backup and a product icon made from repository-owned assets.
- Added Chinese README, contribution/security/privacy documentation, sanitized UI preview, Issue/PR templates, CI, Gitleaks, CodeQL, Dependabot, Draft Release and artifact-attestation workflows.
- Added SHA-256, CycloneDX SBOM and third-party license generation plus offline/public-safety/Fuse/resource-integrity verification scripts.
- Added an explicit clean-runner NSIS lifecycle test for first install, overwrite upgrade, uninstall and `%APPDATA%` retention; it refuses to mutate a normal developer machine.

### Changed

- Fixed the public source build on Node.js 24 LTS and npm lockfile. `bootstrap.ps1` now performs Chinese preflight checks and modifies the desktop only when `-CreateShortcut` is explicitly requested.
- Pinned npm 11.6.2 locally and in GitHub Actions so the lockfile is not reinterpreted by a newer npm bundled with a later Node.js 24 patch release.
- Split deterministic offline `verify.ps1` from opt-in `verify-live.ps1`; the default path does not read real auth data, query quota, mutate plugins or invoke a paid model.
- GitHub CI now skips only foreground-desktop Computer Use actions unavailable to hosted service sessions while still compiling and self-testing the native host; local verification continues to run the complete 24-step foreground flow.
- Public packages include only `out/main`, `out/preload` and `out/renderer`; historical test evidence and cleanup scripts can no longer enter `app.asar`.
- Public verification and packaging now prepare Electron's lazy binary once before parallel tests and fail immediately on any non-zero native command instead of continuing to produce a false-success package.
- The default font stack now prioritizes Segoe UI and Microsoft YaHei, Chinese IME composition/virtual-key 229 cannot trigger send, and layouts adapt from 1280×720 through high-DPI displays.
- About and README now identify the app as an unofficial community client with no xAI affiliation.

### Fixed

- Made Computer Use foreground activation temporarily join the relevant Windows input queues and always detach them afterward, eliminating intermittent `SetForegroundWindow` rejection in packaged and CI-launched probes.
- Codex mirror fallback now checks that the bundled reader exists before launching Python, avoiding Windows Store aliases or slow process lookup from consuming the test and UI timeout.

### Security

- Added pre-commit/public-artifact scanning for real user paths, emails, legacy proxy values, local config and credential patterns; expanded `.gitignore` for runtime data, secrets, certificates, logs and generated native files.
- Enabled cookie encryption, ASAR integrity and OnlyLoadAppFromAsar while disabling RunAsNode, `NODE_OPTIONS`, CLI inspect and extra file-protocol privileges. Build verification asserts the fuse wire.
- Added SHA-256 resource manifests for the built-in Computer plugin and generated Windows host; Computer Use is disabled if packaged resources fail verification.
- Kept Renderer sandboxing, CSP, typed IPC sender validation and strict configured-repository update URLs.
- Pinned every GitHub Actions dependency to a verified full commit SHA while retaining the major-version comment for Dependabot updates.

### Verified locally

- A clean `npm ci` followed by the fail-fast public packaging command passed TypeScript, production builds, public safety scanning, zero npm vulnerabilities and 148 tests (2 explicit live cases skipped).
- Unsigned NSIS and portable ZIP were generated with the required names, passed source/artifact scanning, resource and Fuse verification, and produced SHA-256, CycloneDX SBOM and third-party license reports.
- `win-unpacked` and the portable ZIP extracted to a Chinese path containing a space on a non-system drive both opened a visible window. The first Fuse build exposed and fixed a browser-snapshot incompatibility before final packaging.
- After the foreground-activation hardening, the 24-step Computer Use harness passed three consecutive runs with zero wrong-window or unconfirmed high-impact actions.
- The public GitHub CI, Gitleaks, CodeQL v4 and tagged Draft Release workflows passed; the clean Windows runner also passed NSIS install, overwrite upgrade, uninstall and AppData-retention checks, both EXE/ZIP attestations verified, and the uploaded portable ZIP opened visibly after downloading it back into a Chinese path on a non-system drive.
- At the release owner's explicit request on 2026-07-20, `v0.4.0` was promoted from Draft to a public GitHub Release so the installer and portable ZIP are visible; the broader Windows 10/11 hardware matrix remains tracked separately.

## 0.3.1 - 2026-07-18

### Changed

- Ordinary non-protected applications now enter Computer Use immediately by default. The optional “控制新应用前询问” toggle can restore per-app confirmation; high-impact actions still require a separate one-action confirmation.
- Pointer actions now use UI Automation for target discovery but execute through the real Windows system pointer after a visible 180 ms dwell. Buttons no longer disappear into a background `InvokePattern` path.
- The built-in Computer Skill and Windows helper version are now `0.3.1`; action summaries never include typed text or secret values.

### Added

- Added a click-through, non-focus-stealing blue display-edge overlay with a top status banner, application name, current action, step count, pointer halo and an `Esc` stop hint.
- Added an in-app Computer Use live strip with current activity, pause/resume/stop controls and an explicit “已手动完成，继续” path after Windows security handoff.
- Added a dynamically registered global `Esc` stop while Computer Use is active; `Ctrl+Alt+Esc` remains the fallback shortcut.
- Added explicit UAC/elevated-window handoff state: the task pauses, explains what the user must complete, and re-observes the original target on resume.

### Fixed

- Fixed invisible background clicks, repeated ordinary-app permission prompts, missing global activity visibility, and ambiguous pause/UAC status.
- Fixed the PowerShell 5.1 deterministic probe's optional stream-encoding properties and added persistent packaged-UI acceptance JSON.

### Verified

- 137 default tests passed with 2 opt-in tests skipped; type check, production build and high-level npm audit passed.
- Deterministic Windows acceptance passed 24/24 and now verifies the real system cursor reaches the target point.
- Real Grok visual click and rejected high-impact loops passed; packaged Electron acceptance verified no default app prompt, blue overlay, in-app status, `Esc`, lifecycle, focus restoration and the real risk dialog.
- Full `verify.ps1 -RequireLiveComputerAction -RequirePackagedUi`, final packaging, visible-window smoke and the unique desktop shortcut passed.

## 0.3.0 - 2026-07-18 (Accepted experimental)

### Added

- Added a lazy-loaded Grok Extension Center with installed plugins, marketplace catalogs, Skills, MCP services, Hooks, Computer Use diagnostics and read-only Codex plugin compatibility tabs.
- Added typed extension IPC and a private-ACP-first adapter for `x.ai/plugins/*`, `x.ai/marketplace/*`, `x.ai/mcp/*` and `x.ai/commands/list`, with CLI JSON fallbacks when Grok CLI does not publish those private methods.
- Added DPAPI-backed MCP secret environment values. Grok config receives `${GROK_DESKTOP_MCP_*}` references; the plaintext value is injected only into Grok child-process environments.
- Added a clean-room x64 `GrokComputerHost.exe` built from C# source. It exposes a JSON-lines protocol for window enumeration, UI Automation discovery, per-monitor DPI coordinates, screenshots, foreground activation and single-step input actions.
- Added a token-authenticated `127.0.0.1` Streamable HTTP MCP server per live Grok session. The session receives it through ACP `mcpServers`; the built-in `/computer` Skill is injected with `_meta.pluginDirs` and is packaged as an Electron extra resource.
- Added `@Computer` application/window selection, a composer chip, per-app once/always/deny authorization, high-impact action confirmation, pause/resume/stop controls and the global `Ctrl+Alt+Esc` emergency stop.
- Added Computer Use execution cards with the latest screenshot inside the existing multi-level execution fold. Screenshots are not written to application logs; audit JSONL records only session/app/action/time/result metadata.
- Added read-only Codex plugin classification and safe Grok adapter copies for Skills/resources/standard MCP configuration. Codex Computer Use is explicitly classified as non-portable.
- Added non-executing local/Git plugin previews with bare-clone inspection, fixed commit/fingerprint verification, component/script/license inventory and source-change rejection before trusted installation.
- Added official marketplace commit provenance, direct leading `@Computer`/exact `@应用名` invocation, model-visible pause/resume/stop tools, busy-turn extension mutation queuing and stale Codex adapter refresh indicators.
- Added optional original-resolution detail crops alongside the bounded full-window PNG, plus model-visible UIA values.
- Added a deterministic native test application and 24-flow acceptance harness covering clicks, text, keys, scrolling, drag, window movement, minimize/restore, stale state, wrong foreground, detail crop and controlled launch.
- Added reversible xAI Official plugin acceptance, packaged Electron CDP acceptance and opt-in real Grok visual/risk acceptance scripts. Computer Use is now available by default but remains dormant until explicitly invoked.

### Security

- Plan mode is observation-only. State-changing actions require the latest one-use `stateId`, exact window identity and foreground ownership.
- Exact-window Electron capture is preferred over the native `PrintWindow` fallback; screenshot coordinates are mapped back to physical window coordinates and clamped before input injection.
- Grok Build Desktop, Codex/ChatGPT, terminal processes, UAC/Windows Security and elevated windows are denied in both the native helper and main-process policy.
- Password/OTP/CAPTCHA targets are returned to the user. Delete, send/publish, financial, install, account-access, security-setting and sensitive-transfer intent is classified for immediate one-action confirmation.

### Fixed

- Fixed x64 Unicode `SendInput` structure layout and made failed native input injection return an explicit error.
- Fixed `double_click` incorrectly degrading to a single UIA Invoke action.
- Fixed a race where stopping immediately after application authorization could let the in-flight first observation overwrite `stopped` with a false Computer Host error.
- Fixed CLI fallback extension reload so busy/user-waiting sessions queue the operation, while idle sessions restart and restore their original session IDs.

### Verification

- Final `verify.ps1 -RequireLiveComputerAction -RequirePackagedUi` completed successfully: deterministic/native tests, TypeScript, production build, real ACP/media/extensions/quota, reversible official-plugin state, live Grok visual/risk loops, zero npm vulnerabilities, visible-window smoke and packaged Electron UI all passed in one run.
- TypeScript and the default suite pass: 23 test files, 129 tests passed; the opt-in live file and its two environment-gated cases remain skipped in the default run.
- The current Grok CLI `0.2.101` accepts `_meta.pluginDirs` and publishes the injected `/computer` Skill. Its private extension request methods return `Method not found`, so v0.3.0 uses the documented CLI JSON fallback on this machine.
- The authenticated loopback MCP contract rejects missing tokens and exposes the clean-room tool inventory, PNG and detail-image results. A real Grok model observed the fixture, clicked `Increment` exactly once, verified `increment:1`, and stopped; a second delete attempt produced one risk request, was rejected and executed zero actions.
- The x64 helper passed 24/24 deterministic flows at DPI 96 with 100% single-action accuracy, zero wrong-window actions and zero unconfirmed high-impact actions. Calculator separately passed screenshot → 35 UIA elements → single click → new state at DPI 120. DPI 144 and a negative-origin secondary-display layout are covered by the runtime coordinate-function matrix.
- Packaged Electron acceptance passed all seven Extension Center tabs, non-executing local plugin preview, marketplace provenance, permission actions, pause/resume/stop, global `Ctrl+Alt+Esc`, input focus and a real Grok high-impact risk dialog/rejection.
- Codex plugin tree hashing now runs concurrently and the tab presents an explicit loading state instead of briefly claiming no plugins were found.
- The installed xAI Official `chrome-devtools-mcp` 1.6.0 was temporarily disabled and re-enabled; path, source, version, commit `77e1d3f9616d5b32671da0b9ea094f4929c14a9c` and original enabled state were restored.
- Detailed evidence and the single-physical-display limitation are recorded in `docs/COMPUTER_USE_ACCEPTANCE.md`.

## 0.2.1 - 2026-07-16

### Added

- Added a standalone “Grok 媒体创作” panel with separate image/video tabs, prompt input, aspect ratios, 6/10-second video duration and 480p/720p video controls.
- Added typed media-capability IPC and command construction. The app only submits media workflows advertised by the live Grok ACP session.
- Added media capability and generated-media ACP contract coverage, plus a packaged-renderer probe for Codex scrolling and the media form.

### Changed

- Image creation uses the ACP-advertised `/imagine` command.
- Grok CLI `0.2.101` documents `/imagine-video` but does not publish that alias through ACP. The desktop app therefore uses the advertised `/imagine` skill and explicitly requests its built-in `image_to_video` workflow instead of sending an unadvertised command.
- Available commands received before `session/new` completes are re-emitted with the final session id, so Slash completion and media capability detection no longer lose the initial command snapshot.

### Fixed

- Fixed long Codex read-only mirrors being clipped by the outer application grid and refusing to scroll below the visible window.
- The Codex content pane now has a bounded internal vertical scroller with mouse-wheel, touchpad, scrollbar and keyboard scrolling while the read-only action bar remains visible.

### Verification

- TypeScript, 18 test files / 92 tests and the production build pass.
- Real Grok CLI `0.2.101` ACP probing published `/imagine`; the installed Imagine skill documents `image_gen`, `image_edit` and the `image_to_video` video workflow.
- The packaged renderer scrolled a real Codex mirror from `0/2813` to its `2194`-pixel maximum with a `619`-pixel viewport.
- The packaged renderer opened the independent media panel, focused its prompt, exposed image/video tabs, reported the live `image_to_video` fallback and enabled the complete video form without submitting a billable generation.

## 0.2.0 - 2026-07-16

### Added

- Added Codex-style per-request turns with a multi-level execution fold: thought/process notes, file operations, commands, sub-agents and other tools are grouped below a single summary while the final answer remains outside the fold.
- Added read-only, project-scoped Codex task mirrors with SQLite/JSONL discovery, bundled-reader fallback, hide/refresh controls and an independent `/resume-codex` Grok handoff.
- Added automatic workspace discovery from pinned/recent paths, Grok history and Codex projects, including grouped menus, first-run project cards and missing-path diagnostics.
- Added an OAuth quota panel for weekly credits, monthly included/used/remaining amounts and on-demand limits, with proxy support, five-minute caching, partial-success retention and one-time 401 credential refresh.
- Added per-session drafts, the latest 50 prompts per workspace with `Alt+Up/Down`, background completion/failure notifications, final-answer copy, Markdown export and session pinning.
- Added `Ctrl+N`, `Ctrl+F`, `Ctrl+L` and `Esc` shortcuts, plus typed IPC for Codex, quota, workspace, draft/history, export and notification navigation features.

### Changed

- Virtualized conversations now render by turn; the active execution group opens automatically and completed/stopped/crashed turns converge to a compact summary.
- Markdown, Diff and Codex mirror rendering are lazy-loaded so workspace discovery and session switching do not eagerly load the heaviest renderer modules.
- CLI compatibility verification now probes the bundled Codex reader and allow-listed billing adapters while preserving ACP `initialize + session/new` as the rollback boundary.
- Desktop delivery now keeps only `Grok Build Desktop.lnk`; the old Codex icon-backup file was moved to `%USERPROFILE%\.codex\backups` without changing the live Codex shortcut target or icon.

### Fixed

- Fixed completed or stopped turns retaining running sub-agent/background-tool state; all remaining activity is settled on completion, cancellation or process failure.
- Fixed deleting the active Grok session leaving its old conversation and composer visible after the session had already been removed.
- Fixed `Ctrl+N` using the pre-bootstrap workspace closure and incorrectly opening a folder picker even when an active workspace was already selected.
- Fixed the empty-state top bar saying “请选择工作区” while the sidebar already had an active workspace.

### Verification

- TypeScript, 16 test files / 84 tests, production build and `win-unpacked` packaging pass.
- Real Grok CLI `0.2.101` ACP probing, bundled Codex-reader probing, weekly/monthly OAuth quota calls and high-severity npm audit pass.
- A real Codex task was mirrored, handed off to a temporary Grok session, stopped and deleted; the source JSONL SHA-256 remained unchanged before and after.
- Packaged-window checks passed for grouped/folded turns, final-answer placement/copy, bottom following, composer focus, drafts, prompt history, workspace discovery, Codex mirror/handoff, quota display, session pin/export/delete and keyboard shortcuts.
- The refreshed desktop shortcut launched a visible independent window, and the desktop contains no Grok executable, backup or script artifact.

## 0.1.1 - 2026-07-15

### Changed

- Reasoning effort now changes immediately through Grok CLI 0.2.101's private `session/set_model` metadata extension; all six values were verified live. Restart/restore remains only as a compatibility fallback for an empty CLI-default value or older CLIs that do not confirm the change.
- Replaced every Renderer `window.confirm`/`window.prompt` with non-blocking React dialogs and restored composer focus after dialogs, settings, file pickers, session changes and model controls.
- Split the old scale control into independent text size (85–130%) and Compact/Balanced/Comfortable interface density. Existing 70% settings migrate to 100% text plus Compact density.
- Stream events are batched per animation frame; message/Markdown cards are memoized, Monaco Diff, Mermaid and Shiki are loaded on demand, and cold update checks run after the first window render.
- Conversation scrolling now forces the user's sent message into view, follows a growing streamed reply while at the bottom, explicitly settles both Virtuoso and its native scroller after restore/completion, respects deliberate upward scrolling, and provides a “回到底部” button.

### Fixed

- Fixed ordinary `turn_completed` notifications being misclassified as a forever-running sub-agent. Added explicit sub-agent and background-task lifecycle handling, completion convergence, exit codes and truncation state.
- Fixed a session-open race where the initial bottom-follow timer could run before restored messages reached the Renderer and incorrectly clear the pending follow state.
- Fixed late Markdown measurement leaving the latest restored or completed reply below the viewport even after `scrollToIndex`; the final alignment now also uses the native scroll container and was verified in the packaged window.
- Fixed controls displaying the global default effort instead of the active session's real effort, and prevented model/effort/mode changes while a turn or permission request is active.
- Fixed rapid session-open races, duplicate prompt submission, attachment failures leaving a false working state, startup failures leaking Grok processes, crashed process entries remaining live, and cancel exposing a premature idle state.
- Fixed Plan-mode command-chain/redirection bypasses and hardened Electron navigation, frame ownership, IPC origin, external URL and packaged-renderer trust boundaries.
- Serialized JSON store writes with unique temporary files; coalesced concurrent CLI updates; improved update process-tree cleanup, session restoration reporting and secret redaction.
- Added visible terminal-output truncation state, safe method-not-found replies for unknown ACP requests, and an Auto mode fallback when no allow permission option exists.

### Verification

- Added security-policy, Plan Gate, JSON-store concurrency, CLI-update mutex, live-effort/fallback, ACP lifecycle and Renderer-store regression tests.
- Verified all six live effort values against Grok CLI `0.2.101`, with `model_changed` confirmation and temporary-session cleanup.
- Re-audited the desktop: exactly one project shortcut remains, `Grok Build Desktop.lnk`; no second Grok `.link`, `.url` or shortcut exists.
- Re-ran the full verifier on 2026-07-16: TypeScript, 69 tests, production build, live ACP effort probe, zero-vulnerability audit and packaged visible-window smoke all passed.
- In the packaged window, verified restored/latest reply auto-positioning, a real prompt/reply completion at the bottom, `xhigh → high` without a modal or PID change, and composer focus after effort/settings interactions.

## 0.1.0 - 2026-07-15

### Added

- Added a sandboxed Electron desktop shell with Codex-style workspace/session/chat layout and typed IPC.
- Added Grok CLI discovery, proxy inheritance, ACP process pooling, streaming chat/thinking, cancellation, model/mode switching, reasoning-effort restart and session restore.
- Added official ACP SDK method/version constants plus an isolated Grok `x.ai/*` compatibility layer for questions, plan exit, notifications and sub-agent lifecycle events.
- Added ACP filesystem, terminal, permissions, command output, tool cards, Monaco Diff, Agent/Plan/Auto modes and a client-enforced Plan Gate.
- Added shared Grok history indexing, Windows path-case compatibility, rename/search/delete/clear, unread/live states, restored messages/tools/media/plans and persisted context usage.
- Added Markdown/GFM, selected-language Shiki highlighting, KaTeX, Mermaid, virtualized long conversations, Slash Command completion and Token usage display.
- Added file picker and drag/drop attachments, pasted images with a 20 MiB limit, plus generated image/video display, open-file and copy-path actions.
- Added DPAPI-backed OAuth/API-key account profiles, visible device-code fallback, atomic account switching, ACP login validation and failure rollback.
- Added CLI update check/apply/probe/rollback/history with live-session suspension and restoration.
- Added `bootstrap.ps1`, `update-grok.ps1`, `rebuild-app.ps1`, `verify.ps1`, ACP probe and visible-window smoke scripts.
- Added a `win-unpacked` build and direct desktop shortcut.
- Added 15 automated tests, a fake-CLI ACP contract test and zero-vulnerability npm audit override.

### Fixed

- Fixed production `file://` asset paths that initially produced a blank Electron window.
- Fixed virtualized conversation horizontal overflow and clipped user messages.
- Fixed restored events losing their session id during `session/load`.
- Fixed old VS Code Grok sessions not appearing when Windows drive/path casing differed.
