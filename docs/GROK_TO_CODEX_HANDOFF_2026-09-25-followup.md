# Grok → Codex 交接（2026-09-25 后续）

给 **Codex** 用。可整份当作新会话上下文，文末有可粘贴提示词。

这是对 **能力计数、Token 口径、本机再次替换，以及你自己查出的四项修复** 的只读审查。对照会话 `01a0af53-2e30-72e1-8d54-05a201e427d0` 在上一份 `docs/GROK_TO_CODEX_HANDOFF_2026-09-25.md` 之后的对话，并核对了当前工作区源码。本次未改产品代码、未重跑测试、未再替换安装版。

上一份交接仍然有效，范围是 CLI 1.0.40 对齐和 ZCode 工作台。**不要把那份里的 R1–R18 或 UI 阶段重做一遍。** 本文件只接这轮能力计数之后的事。

---

## 0. 仓库事实

- HEAD 仍是已发布 `v0.9.6`（`4dc09db`），工作区未提交
- 本机安装目录：`D:\grok zhuo\Grok Build Desktop`
- 这次替换前的回退：`D:\grok zhuo\out\grok-desktop-rollback-before-capability-refresh-2026-09-25`
- 版本号仍显示 **0.9.6**，和 GitHub Latest 不是同一构建
- 安装发生在四项修复之前。安装版包含「不再用标题判断 Computer Use」和「Token 只加明确总量」，**不包含** 后面四项源码修复
- Renderer 分块预算未过：入口 JS `582.9/475 KiB`，主 CSS `215.7/210 KiB`。当时按用户要求继续替换，并写明不是发布候选
- 打包时本机没有 Visual Studio Build Tools，`node-pty` 复用了与旧安装哈希相同的预编译二进制

未经新授权不要：发 GitHub Release、再次覆盖安装目录、升级 CLI、重跑全量、发明额度重置按钮、把终端或浏览器做成 LLM 工具、改 Auto 语义、回滚绑定工作区可编辑。

---

## 1. 这轮已经做对、不要回退的

用户先问了 Token、重置额度、子智能体和 Computer Use 误计数，并说 UI 本轮不改。你的取舍用户已批准：

| 决定 | 源码现状 |
|---|---|
| 不用标题推断 Computer / 子智能体 | `store.ts` 的 `isComputerTool` / `isSubagentTool` 看 MCP 服务名、`grok_desktop_computer__` 前缀或结构化工具名 |
| 读 Skill、标题里出现 Computer Use 不算操作电脑 | 与本地 8 条误分类样本的方向一致 |
| Token 总量只加明确的 `totalTokens` | `token-activity-service.ts` 不再把输入+输出+推理拼成总量 |
| 日历用系统时区；筛选同时作用于数字和热图 | 旧 UTC 汇总保留并标记 |
| 不提供未验证的重置按钮 | 只有官方用量页入口 |
| `x.ai/subagent/message` 未在当前握手声明则保持未知 | `native-agent-capabilities.ts` 的 `messageExtension.mapped` 为 false |
| 子智能体仍由 CLI 调度 | 不另建一套任务库 |

随后你自审复现四项，用户说「修复」。工作区里这四项也在：

1. 同一 `toolCallId` 的后续通知沿用上一次工具名，失败会重算 Computer 证据（`grok-acp-adapter.ts` 约 1682–1722，测试名 `merges partial capability updates`）
2. Token 取消 20,000 条数量裁剪，改为 400 天留存（`prune`）
3. `wait` 不加 `stepCount`；Plan 启动不激活窗口、不计操作步（`computer-use-service.ts` 约 349–353、410–420）
4. `handleEvent` 把 `projectionReplaying` 传给能力记录；回放中的工具调用不写入当前 CLI 证据（`app-controller.ts` 约 3206）

你报告 28 个不同定向用例和类型检查通过。本次没有重跑，不要把这个数字写成 Grok 复验。

---

## 2. 还要对齐的问题

**F1. 本机桌面没有这四项修复。**
用户若在已安装程序里看失败状态、Token 长期总量或回放证据，看到的仍是替换当时的构建。源码修复要再替换才会出现。替换前必须再次说明分块预算仍超限。不要把这次安装说成已包含四项修复。

**F2. Host 活动卡仍把「切到前台」显示成已操作。**
MCP 工具侧：`start` / `pause` / `resume` / `stop` 是 `controlled`，`wait` 是 `observed`（`computerToolEvidence`）。活动卡在 `store.ts` 约 500 行只要 `stepCount > 0` 就是 `operated`。Agent 模式 `activateTask` 在激活窗口成功后执行 `stepCount += 1`。所以只把窗口带到前台，活动卡仍会写成操作过应用。应让活动卡使用和控制动作相同的证据，而不是用步数代替。

**F3. 去掉条数上限后，Token 文件会持续变大。**
400 天内的每条明细都留着。这修好了「第 20,001 条丢掉最早总量」，但没有容量方案。不要再靠静默删最早一条来限大小。已被旧上限删掉且无备份的明细无法恢复，文档里保持这句。

**F4. 上一份交接里的两项这轮没做，也不要写成做了。**
终端仍把主进程 `process.env` 交给 PowerShell。浏览器仍是 `persist:grok-workspace-browser`，没有下载限制。你当时的判断是只隔离应用自己的密钥、保留登录 Cookie、补下载和清理。该判断还没落地。

**F5. 实机合同仍空。**
1.0.40 上的模型工具选择、Hook `updatedInput` 消费、父子隔离、子智能体消息的排队/即时/唤醒、取消回执、Computer GUI、Windows 到时触发，都没有新证据。离线回归不能代替。

---

## 3. 建议顺序

1. 若用户要在桌面上看见四项修复：先说清分块预算未过、版本号仍是 0.9.6、与 GitHub 不是同一份，再替换。保留现有回退目录，不要删。
2. 修 F2：活动卡的观察、控制、操作与 `computerToolEvidence` 一致。只切前台不要显示成已操作。补一条活动卡回归，不要重跑全量。
3. F3 先记限制，不在这轮做存储分片，除非明细文件已经大到影响打开。
4. F4 仍按你自己的取舍做：去掉应用注入的密钥变量，保留用户终端需要的环境；浏览器加下载确认或拒绝，并提供清理 Cookie 的入口。不要因此改成不记住登录。
5. F5 继续单独排期。缺证明就拒绝 Desktop 工具，不要用计数修好来宣称 Computer 已能用。

UI 全面改造继续暂停，除非用户重新打开。不要覆盖 `v0.9.6` 标签。

---

## 4. 提示词（可直接粘贴）

```
继续 Grok Build Desktop。仓库 D:\grok zhuo\grok-build-desktop。HEAD 仍是已发布 v0.9.6。先读 docs/GROK_TO_CODEX_HANDOFF_2026-09-25-followup.md。

不要重做 09-25 主交接里的 R1–R3，不要改 Auto，不要回滚绑定工作区编辑，不要发明额度重置按钮，不要重做 ZCode 界面，除非用户重新要求。

当前安装目录是能力计数第一轮之后的构建，不包含后来四项源码修复。回退在 D:\grok zhuo\out\grok-desktop-rollback-before-capability-refresh-2026-09-25。未经用户明确说「替换桌面」，不要再覆盖安装目录，也不要发 GitHub Release。

若继续改代码，优先让 Computer 活动卡与 MCP 证据一致：只把窗口带到前台显示为控制，不要因为 stepCount 大于 0 就写成已操作。Token 不要恢复 20,000 条静默裁剪。终端密钥环境和浏览器下载仍按你已有判断补，不要把它们做成模型工具。

真实 updatedInput、父子隔离、模型调用、GUI 和 Windows 到时触发仍未验收。
```
