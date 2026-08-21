# 学习对照与候选 Backlog（第 1 轮深度学习）

日期：2026-08-17
范围：官方 Grok CLI 的 Windows 桌面壳。不做多 Agent 工作台、不做手机遥控。
本轮只出文档，不改功能。

**用户反馈（2026-08-17）：** 这份对照 **不是** 所要的 UI 方向（观感、布局、阅读、密度、主题）。G1–G6 不要当 UI 实施包。Grok 之后必须另开真正的 UI 学习。底层/新功能改由 Codex 先做，见 `docs/CODEX_SESSION_HANDOFF.md`。

学习方式：读 README / CHANGELOG / 架构说明，并对照本仓库源码。不复制第三方代码。`phuryn/grok-build-vscode` 为 FSL-1.1-MIT，只能学交互。

---

## 1. 深度学习结论（先读这个）

同赛道最值得学的是两个，不是 180 个仓库：

1. **phuryn/grok-build-vscode（148★，更新到 2026-08-16 / CLI 1.0.4）**
   日常对话壳标杆。真正强的是：工具过程分组、子 Agent 独立卡片、权限卡先看 Diff、会话费用只在完整可记账时显示、以及一份很长的「宿主自己会摔的坑」清单。
2. **joeynyc/Grok-UI（129★）**
   不是替代桌面壳。强在诚实：用量必须带出处、Stop 要等到确认、workflow 只接受 CLI 给出的显示名、不把上下文占用当成花费。

本仓库 **0.9.0 已经有不少别人当卖点的东西**，实施轮不要重做：

| 别人宣传的点 | 本仓库已有 |
|---|---|
| 会话状态点：运行 / 等你 / 排队 / 后台完成 / 失败 | `Sidebar` 的 `status-dot` + `unread`/`error`；`markUnread` 在回合结束写入 |
| Enter 排队、Ctrl+Enter 插话 | `Composer`：忙碌时「加入队列 / 置顶跟进 / 旁路提问」 |
| 上下文占用环 | `TokenDonut`：只用模型声明的窗口，没有上限就显示 `?`，不伪造 512K |
| 权限/计划/问题决策卡 | `PermissionCard` / `PlanCard` / `QuestionCard`，对齐过 Codex 批准面 |
| Review / Worktree / 投影先显 / 草稿优先 | 0.7–0.9 已落地 |
| 媒体能力按工具证据 | 1.0.3 `bundled:imagine` 等 |
| 视频 Range 请求 | `grok-media` 已处理字节范围（phuryn 3.2.10 才修同类 bug） |

浅层看起来「缺」的，很多是 **发现性** 或 **默认折叠**，不是缺后端。

---

## 2. 对照过往 bug（实施时必须对照）

这些是别人刚修过、或我们修过的同类坑。下一包 UI 若碰到，先查本仓库是否已有测试。

| 来源 | 坑 | 本仓库 | 归属 |
|---|---|---|---|
| phuryn 3.10.1 | Plan/Auto 徽章跟点击走，RPC 失败后名实不符 | 0.8.3 已修 Resume 冲掉 Auto；仍要保证切模式失败不改徽章 | Codex 复核 |
| phuryn 3.10.1 | `set_mode` 成功与 `terminal/create` 同一 stdout 块，门还没抬就放行 | 我们 Plan 已改为自动批准写入，门语义不同；Agent 权限路径仍要防竞态 | Codex |
| phuryn 3.10.1 | 图片 `read_file` 被宿主拦到纯文本路径，CLI 1.0.4 才能看图 | 我们把 FS 放在主进程；要确认图片读是否走 CLI 自己的图像路径 | Codex |
| phuryn 3.9 | 并行子 Agent 字流交织，对话被打乱 | 我们有 teardown/列表，**对话内没有子 Agent 卡** | Grok 卡 + Codex 数据 |
| phuryn 3.7 / 3.0 | Stop 没回执会卡死队列；插话消息显示两遍 | 我们有 8 秒单会话恢复；队列以服务端广播为准 | 实施时回归 |
| phuryn 3.3 | Worktree 确认落到已切走的会话 | 我们 worktree 绑定 sessionId，实施时加「会话不一致拒绝」文案即可 | Grok 文案 |
| phuryn 3.1 / 2.1 | 权限卡命令无限长撑破对话；Plan 被 `$(…)` / 环境变量绕过 | 我们有命令滚动和只读门（0.8.3 后 Plan 不再当沙箱） | 不回退 0.8.3 产品决定 |
| phuryn 3.2.10 | 视频不支持 Range，播一秒就死 | 已有 | 保持 |
| phuryn 3.0.1 | 空会话刷出 Untitled | 我们草稿先于会话，不要为了「列表更满」去预创建 CLI 会话 | 保持 |
| Grok-UI 0.6 | Stop 同时取消未决权限，未确认要可重试 | 对照 `cancelSession` | Codex |
| Grok-UI 0.9 | 禁止把 context occupancy 当成累计花费 | TokenDonut 已分开；账本若做必须带出处 | Codex |
| 本仓库 0.8.1–0.9.0 | IPC 未知字段、额度 0 值、清理错误盖住主因 | 已修 | 新 UI 字段必须进白名单 |

---

## 3. Grok 候选（壳上的真实使用，不依赖新 CLI）

只收「现有 ACP/投影就能做」的项。优先级按每天是否碰到。

### G1. 工具过程默认像日志，而不是一叠打开的卡 — P1

- **来源：** phuryn「Explored 5 / Edited 2」、失败行变红、编辑显示 `+N −M`。
- **现状：** `ToolCard` 一条工具一张卡，摘要里是标题+状态；`expandToolDetails` 默认关，但分组弱，长命令/JSON 仍容易把对话撑满。
- **做：** 同一回合把 read/search 收成一组、edit 收成一组、shell 单独；摘要用已有 `kind`/`readOnly`/`additions`，**不靠猜工具名**。点开仍用现有 Diff/命令。
- **不做什么：** 不新写一套 Git；不把未知工具当成只读。
- **风险：** 分组错了会藏失败。失败和权限相关工具必须露在外面。

### G2. 权限卡「先看这次要改什么」 — P1

- **来源：** phuryn 权限卡 → 打开完整 Diff 再批。
- **现状：** 卡上只有动作摘要和完整命令；文件 Diff 在工具卡或右侧 Review，批准前要自己找。
- **做：** 若这次 `toolCall` 已有 path / ACP Diff，卡上加「查看改动」滚到对应工具或打开已有 Review/编辑器。没有 path 就不要假按钮。
- **不做什么：** 不在批准前把文件写到磁盘；不新开第三套 Diff。
- **风险：** 工具还没给出 path 时按钮会骗人。

### G3. 会话列表状态点更好认 — P2

- **来源：** phuryn 蓝/黄/绿/红/灰，绿=未读完成。
- **现状：** 已有点 +「运行中 / 等待操作 / 后台已完成 / 运行失败」。冷会话和草稿都是冷点，绿未读不够跳。
- **做：** 加强 `unread`/`needs-user` 对比度；顶栏或列表汇总「N 个等你 / N 个未读」。不要新状态机。
- **风险：** 颜色无文字会不合格。必须保留现有文字标签。

### G4. 排队 / 置顶跟进的发现性 — P2

- **来源：** phuryn Queue vs Steer，默认可改。
- **现状：** 忙碌时已有三按钮和 placeholder。任务中心才解释 Enter/Ctrl+Enter。新用户不一定知道「置顶跟进」= 不取消当前回合。
- **做：** 队列条上给已排队项一个「改为置顶跟进」；忙碌占位写短一句。不要改默认键位，除非你以后点头。
- **风险：** 和「旁路提问 /btw」抢概念。文案必须分开：队列=回合后发送，置顶=同一会话下一拍，旁路=不进主对话。

### G5. 会话费用只在 CLI 完整上报时显示 — P2

- **来源：** phuryn 2.3「部分数字不如没有」；Grok-UI 出处标签。
- **现状：** Donut 是窗口占用。设置里有 Token 活动热图（覆盖率诚实）。会话/回合 **USD 费用** 没有进 Composer。
- **做：** 若 `session/usage` 或回合事件已有 cost，点 Donut 展开已有字段。没有 cost 就不画 `$`。
- **不做什么：** 不按 token 估美元；不做 Grok-UI 那种跨项目账本（留给 Codex）。
- **风险：** 把 occupancy 画成花费。Donut 主数字必须仍是窗口占用。

### G6. 对话密度与窄窗（续 CODEX_UI_PARITY） — P3

- **来源：** Grok-UI 0.8.1 字号/对比度；phuryn 窄窗藏文字留图标。
- **现状：** 已有对话宽度/字号、窄栏 unified Diff、决策卡换行。
- **做：** 只修走查里仍挤的：工具摘要一行、权限命令默认 6 行、空状态。不重做主题引擎。

### G7. 子 Agent / 后台任务在对话里的卡片 — P2，需 Codex 数据

- **来源：** phuryn 3.9 并行子 Agent 卡；官方 TUI 子 Agent 视图。
- **现状：** 右栏任务 + 关闭 teardown。主对话把子 Agent 输出揉进父回合。
- **Grok：** 有稳定 `subagentId` 再画折叠卡（状态、计时、结果）。
- **Codex：** 从 ACP/`x.ai/subagent` 抽出稳定身份，禁止用标题猜。
- **没有身份就不画卡。**

---

## 4. 留给 Codex

| ID | 项 | 为何不是 Grok 先做 |
|---|---|---|
| C1 | 子 Agent / 后台任务的结构化身份与事件 | 没有稳定 ID，卡片会串 |
| C2 | Workflow Pause/Resume/Stop：只接受 CLI 显示名，重启后禁用控件 | 协议 + 注入面 |
| C3 | 用量账本：项目/模型/出处；occupancy ≠ 花费 | 新持久化 |
| C4 | CLI 1.0.4+：图片 read 是否被宿主文本路径吞掉 | 主进程 FS |
| C5 | 切模式失败不得改徽章；set_mode 与下一请求竞态 | ACP 时序 |
| C6 | Stop：取消未决权限、未确认可重试（对照 Grok-UI 0.6） | 生命周期 |
| C7 | 历史同类：IPC 新字段白名单、额度 0 值测试、清理错误不盖主因 | 回归 |
| C8 | 远程/手机批权威胁模型 | 默认不做，只评估 |

---

## 5. 明确不做（近 2～3 轮）

- 改成 Tauri / Theia / 内嵌完整 IDE（phuryn 文件树是另一产品）
- 聚合 Claude / Codex / OpenCode 会话（Codeg）
- 语音输入（付费 STT + ffmpeg）
- AFK Pilot / Lucarne / Codeg 手机遥控
- 应用静默自动安装（他们做了；我们只检测 GitHub Release）
- 回退 0.8.3：Plan 再当只读写门
- 为列表好看而预创建空 CLI 会话

Jane / fanghui-li / xiaokaige / PinkCode / krakenunbound：README 与本仓库重叠（多会话、Diff、权限、深色）。未发现必须抄的独特面。PinkCode 任务板、kraken 托盘放到更后面。

OpenCode / Goose / Codex App：只记「会话切换不锁死应用、批准面清晰」。本仓库 0.6.21 已对齐并行任务。不换 runtime。

---

## 6. 建议的实施顺序（你验收本文之后）

**Grok 第一包（小、可走查）：** G1 工具分组 → G2 权限看改动 → G3 状态点对比度 → G4 队列文案。
**同一包回归：** 权限、Stop、队列不串会话、窄窗 Diff、未读点仍可读。
**Grok 第二包：** G5 Donut 展开真实费用（有数据才做）、G6 密度。
**并行 Codex：** C1/C5/C6 先于 G7；C2/C3 独立；C4 等本机 CLI 到 1.0.4 再测。

---

## 7. 证据索引

- phuryn README / CHANGELOG 3.0–3.10.1（2026-08-16）
- joeynyc/Grok-UI README / CHANGELOG 0.1–0.11
- 本仓库 `Sidebar.tsx`、`Composer.tsx`、`MessageCard.tsx`、`session-catalog.ts`、`CHANGELOG` 0.6–0.9、`CODEX_UI_PARITY.md`
- 浅层筛选见会话计划文件（GitHub topics `grok-build` 180+）
