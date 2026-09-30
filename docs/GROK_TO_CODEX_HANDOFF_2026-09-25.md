# Grok → Codex 交接（2026-09-25）

> **后续：** 能力计数与 Token 口径之后的审查见 `docs/GROK_TO_CODEX_HANDOFF_2026-09-25-followup.md`。本文件仍是工作台/CLI 对齐那一轮的边界，不要把它当成最新任务。

给 **Codex** 用。可整份当作新会话上下文，文末有可粘贴提示词。

这是对 **v0.9.6 之上、尚未提交** 的工作区做的只读审查。对照了 Codex 会话 `01a0af53-2e30-72e1-8d54-05a201e427d0` 在 09-20 之后的决定，以及当前源码。本次未改产品代码、未重跑测试、未再替换安装版。

上一份审查交接 `docs/GROK_TO_CODEX_HANDOFF_2026-09-20.md` 仍有效作历史。Codex 已按自己的判断做完其中一部分，**不要把 R1–R18 再整表重做**。

---

## 0. 先读，再动手

仓库：`D:\grok zhuo\grok-build-desktop`

- Git HEAD：`main` = `origin/main` = 标签 `v0.9.6`（`4dc09db`）
- 工作区：**脏**。55 个已跟踪文件约 +1714/−267，外加未跟踪的工作台、测试和两份实施记录
- 本机桌面已被这套构建替换：`D:\grok zhuo\Grok Build Desktop\Grok Build Desktop.exe`
- 当前最新回退副本：`D:\grok zhuo\out\grok-desktop-rollback-before-capability-refresh-2026-09-25\`；更早的 09-20 回退副本仍保留
- `package.json` 版本仍是 **0.9.6**。GitHub Latest 也是 0.9.6，但内容和本机安装版不是同一份

先读：

1. 本文件
2. `docs/CLI_1_0_40_ALIGNMENT_2026-09-21.md`（CLI 证据；其中「未替换桌面」已过时）
3. `docs/ZCODE_UI_REDESIGN.md`（以 09-25 小节为准，文末「下一批」有重复）
4. `docs/IMPLEMENTATION_PLAN.md` 顶部

**未经新授权不要：** 再发 GitHub Release、再覆盖安装目录、升级 CLI、注册真实计划任务、付费模型调用、重跑全量测试、把终端/浏览器做成 LLM 工具、回滚绑定工作区可编辑、改 Auto 为强制二次确认。

用户三份仓库根 `_tmp_*` 不读写、不提交。

---

## 1. 用户已经拍板的取舍（不要翻案）

Codex 在 09-20 对 Grok 审查的结论，用户已说「按照你说的修复」：

| 采纳 | 不采纳 |
|---|---|
| R1 清映射带 revision | 不把定时任务改成 Agent，不让 Auto 再弹高影响确认 |
| R2 变忙后放槽再等 | 不因缺少 `subagentType` 拒绝父会话 |
| R3 Host 退出后旧确认失效 | 不把 `P3650D`、证明 TTL、tombstone GC 当本轮 P1 |
| 会话里能看到定时确认；表单显示时区 | MCP 不是无开关地一律关 Computer：默认关，显式 `computerEnabled: true` 可开 |
| 用代理把本机 CLI 升到当时 stable | 不把合成 hook 当成模型已能调用工具 |

随后用户又要求借鉴 ZCode 做 UI，并在 09-25 要求 **替换本机桌面程序**。这两件事都已做，但是未提交、未发版。

---

## 2. 源码里已经对上的部分（保留）

抽查当前树，不是复跑测试：

- `setExecutionSession` 清映射和写回都带 `task.revision`（`app-controller.ts` 约 2278、2344、2393）
- 绑定会话变忙时调用 `waitUntilReady()`，槽位先释放再重新竞争（`automation-service.ts` 约 274–282，`app-controller.ts` 约 2308、2319）
- `confirmRisk` 在批准前核对任务仍是 `awaiting-risk-confirmation`；Host 退出会 `invalidateBridgeWaits`（`computer-use-service.ts` 约 435–443、496–506）
- `configureSession` 返回恢复函数，任务结束恢复进入前的策略，不再用 `?? true` 盖回去
- MCP 创建只挑选字段，`futureIntent` 不落盘；`computerEnabled === true` 才打开（`desktop-tools-service.ts` 约 82，`app-controller.ts` 约 535–540）
- 终端创建先 `requireToolWorkspace`，必须是应用已打开的工作区
- 浏览器只要 `http/https`、无账号口令、权限请求拒绝、`sandbox` + 无 Node
- HTML 产物用空 `sandbox` 加 `default-src 'none'`
- 1.0.40 的 Hook 空列表会 reload 再查：`desktop-hook-readiness.ts`

CLI 记录（来自对齐文档，本次未重测）：默认 `%USERPROFILE%\.grok\bin\grok.exe` 为 **1.0.40 `eb1a2256660d`**。核心 ACP 与 Hook 发现通过。`updatedInput` 证明消费、父子隔离、真实模型、GUI、到时触发 **仍未验收**。

---

## 3. 这次审查要改的问题

### P1 交付状态是错位的

**D1. 本机 0.9.6 ≠ GitHub 0.9.6。**
安装目录已换成本工作区构建，版本号没加。用户和以后的排错会把本机现象当成已发布版。回退副本在上面的 `out` 路径。

**D2. 一棵脏树里有两条产品线。**
CLI/定时任务修复和 ZCode 工作台（Radix、四窗格、`node-pty`、浏览器、产物）混在一起。不能一次提交或一次发版假装是同一项改动。

**D3. 对话工具仍不能宣称可用。**
Hook 能被 `hooks/list` 看见，不等于 PreToolUse 把 `updatedInput` 写回、MCP 消费证明成功、子调用被拒绝。缺证明继续失败关闭。

### P2 新工作台的安全与完成度

**D4. 终端继承整个 `process.env`。**
`workspace-terminal-service.ts` 约 18 行把主进程环境原样交给 PowerShell。工作区路径有校验，但应用进程里的代理、令牌类变量会进 shell。终端还不是 LLM 工具；在变成工具之前，先从 spawn 环境删掉已知密钥变量。

**D5. 内置浏览器没有下载策略，分区是持久的。**
`persist:grok-workspace-browser` 会留下 Cookie。没有 `will-download` 限制，网页仍可能把文件写到默认下载目录。权限拒绝和协议限制是对的，下载和持久登录还没产品化。

**D6. 放槽之后仍有一小段竞态。**
第二次 `waitUntilReady` 返回后，到 `configureSession` / `prompt` 之间会话还能再变忙。比 09-20 的「占着槽空等」好，但不要写成完全没有窗口。

**D7. 文档互相打架。**

- `CLI_1_0_40_ALIGNMENT_2026-09-21.md` 仍写未替换桌面
- `ZCODE_UI_REDESIGN.md` 09-25 已写文件/审查窗格接入，文末「下一批」又把同一项列为未做
- `IMPLEMENTATION_PLAN.md` 仍写未授权发布；本地替换已经发生，GitHub 发布仍未授权。两件事要分开写

**D8. 分屏还不是完整工作台。**
非焦点窗格是长度受限的只读投影。Office 不保留版式。任务—子智能体—确认—恢复链没做。第一阶段「全部现有页面」的主题、窄屏、长文本验收没收口。不要在 Changelog 里写成阶段完成。

**D9. 依赖用了 `^`。**
Radix、xterm、node-pty 与仓库其余固定版本不一致。发版前应收成确切版本，并确认 `node-pty` 进安装包（本机 unpacked 里已经有一份，不能代替 CI 验证）。

---

## 4. 整改顺序

### 第一刀：把事实写清，先别发版

- 对齐说明补上 09-25 本地替换、回退路径、版本号仍为 0.9.6
- 实施记录删掉已经完成又被列进「下一批」的重复项；留下真正没做的
- 计划里区分：本地替换已做；GitHub Release **未授权**
- 若用户要发版：版本升到 0.9.7（或用户指定号），**不要覆盖 v0.9.6 标签**

建议拆成两个提交，仍等用户说提交再做：

1. CLI 1.0.40 对齐与 R1–R3 / 确认 / 时区
2. ZCode 工作台

### 第二刀：工作台收口前的安全项

- 终端 spawn 环境去掉密钥类变量，保留用户自己的 PATH/代理若产品需要；写进测试
- 浏览器：要么拒绝下载，要么下载进工作区并经用户确认；说明 Cookie 是否故意持久
- 不要把终端、浏览器注册成模型工具

### 第三刀：把 UI 阶段切成可交付边界

做完再谈发版，不要无限延伸：

- 第一阶段：现有页面在深色/浅色、1366 与 150% 下主路径可用，错误态可见
- 第二阶段：焦点窗格可编辑；非焦点若仍是预览，界面要标明只读
- 明确不做进这一版：Office 排版、任务恢复全链路、LLM 驱动终端/浏览器

### 第四刀：仍单独排期的实机验收

固定 CLI `1.0.40` 哈希，隔离目录：

1. 父会话 Desktop 工具调用证明被消费
2. 子会话同样调用被拒绝
3. 不发提示词的部分到此为止；模型选择工具、GUI、Windows 到时触发另要授权

122 项定向测试是 09-21 的记录。改完第二刀再跑受影响文件，不要重跑全量。

---

## 5. 验证口径

- 声称 R1/R2/R3 已在树里：以本节第 2 节的代码路径为准；本次没有重跑 `automation-worker-races.test.ts`
- 声称本机就是 GitHub 0.9.6：不成立
- 声称对话式定时任务/Computer 已端到端可用：不成立，直到第四刀有记录
- 声称分屏、Office、任务恢复已完成：不成立
- XML 解析、Hook list、页面截图都不能代替上面三条

Renderer 继续沙箱。文件、PTY、浏览器、凭据、schtasks 只在主进程。

---

## 6. 提示词（可直接粘贴）

```
继续 Grok Build Desktop。仓库 D:\grok zhuo\grok-build-desktop。HEAD 仍是已发布的 v0.9.6（4dc09db）。工作区有未提交的 CLI 1.0.40 对齐和 ZCode 工作台。本机桌面程序已被这套构建替换，版本号仍显示 0.9.6。回退副本在 D:\grok zhuo\out\grok-desktop-rollback-0.9.6-2026-09-25\。

先读 docs/GROK_TO_CODEX_HANDOFF_2026-09-25.md。不要重做 09-20 交接里已经按你判断修过的 R1–R3，也不要推翻 Auto 语义、绑定工作区可编辑、或「缺少 subagentType 不拒绝父会话」。

未经新授权不要发 GitHub Release、不要再次覆盖安装目录、不要升级 CLI、不要重跑全量、不要把终端或浏览器做成 LLM 工具。

先做：
1. 改正三份文档里「未替换桌面 / 下一批重复项 / 未授权发布」的互相矛盾。本地替换和 GitHub 发布分开写。
2. 终端不要把主进程密钥环境变量交给 PowerShell。浏览器补下载策略，并写明持久 Cookie 是否故意保留。
3. 把未提交改动在说明里拆成「CLI 对齐」和「工作台」两块。用户没说提交就不要提交。
4. UI 只收口已承诺的主路径和只读分屏说明。Office 排版和任务恢复链不要假装完成。

真实 updatedInput 证明、父子隔离、模型调用、GUI 和 Windows 到时触发仍未验收，缺证明继续失败关闭。
```

---

## 2026-09-25 增补：能力计数与 Token 口径实施状态

以下内容是在本审查之后按用户批准的专项计划完成的源码更新；不改变前文有关 0.9.6 本机替换、GitHub 未发布、UI 未收口及真实 CLI/模型边界的事实。

- Computer Use 与子 Agent 卡片不再根据自由文本标题归类；只接受精确 MCP/CLI 工具身份和 Computer Host 状态证据。零步空闲状态不生成操作卡。
- Token 历史只累计提供方明确返回的总量；日期使用系统时区，数字窗口及热图共用筛选。旧 UTC 匿名汇总明确标记，已删除会话数据不参与可筛选明细。
- 子 Agent 能力快照绑定当前 ACP 连接、CLI 路径指纹、版本、可读时的二进制 SHA-256 和 initialize 响应。源代码中候选的 `x.ai/subagent/message` 尚未映射；排队、即时发送、唤醒语义未知。
- Grok 官方用量页入口已加到账号额度面板；无经过验证的手动重置接口，未加重置按钮或虚构次数。
- 4 个受影响测试文件中，筛选运行的 12 项回归通过（另 136 项未执行），`npm run typecheck` 通过；没有全量测试、模型调用、GUI 操作、真实任务注册或额度重置。后续仍需验收 1.0.40 的真实工具调用、子 Agent 身份/消息/取消、Computer Use 与 Windows 定时触发。

本交接之后，用户再次授权本机桌面替换：当前安装目录已更新为包含本轮能力计数/Token 修正的工作区构建并显示 0.9.6，回退副本见上方路径。构建/替换证据及 chunk 预算遗留见 `docs/IMPLEMENTATION_PLAN.md` 顶部；没有升级 CLI 或发布 Desktop。
