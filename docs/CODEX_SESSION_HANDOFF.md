# Codex 会话交接（2026-08-17）

给 **Codex** 用。Grok 这一轮的学习产出方向不对，用户要求 **Codex 先干**。
可粘贴提示词在文末「提示词」一节。

---

## 1. 用户原意（必须按这个分工，不要再偏）

0.9.0 已经可以当稳定基线。下一阶段不是再修一堆小协议项当「产品方向」，而是 **借鉴其他项目：增添功能、美化 UI、优化代码**，并对照过往更新里的同类 bug。

明确分成两条线，循环多轮：

| 谁 | 聚焦 | 也要看 |
|---|---|---|
| **Grok** | **UI**、真实使用是否好用、学完后解决用着别扭的地方 | 底层/新功能有没有该记下来的，记下来留给 Codex |
| **Codex** | **底层代码**、**增添新功能** | UI 有没有该记下来的，记下来留给 Grok |

共同方法：

1. 用 `grok build desktop` 以及 grok-desktop / grok-build-gui / grok-cli desktop 等组合搜 GitHub。
2. **先看 star 高的**，粗筛（是不是官方 `grok` CLI 的 GUI、是不是套网页、是不是 SEO）。
3. 值得学的再深度学习，再出计划。
4. **不要草草学几个就结束。** 广撒网。任务大就分阶段、分很多轮。
5. Grok 先学习并可以先做；做不完或属于底层/新功能的，写成交接让 Codex 按文档和学习内容实行。
6. Codex 做完由 Codex 自己或 Grok 审核。然后再下一轮。

产品边界（已拍板，近 2～3 轮）：

- 继续做 **官方 Grok Build CLI 的 Windows-first Electron 桌面壳**。
- 不做多 Agent 工作台（Codeg 那条路），不做手机遥控。
- 学交互和能力，**不抄第三方源码**。`phuryn/grok-build-vscode` 是 FSL-1.1-MIT。
- Renderer 保持 `nodeIntegration: false`、`contextIsolation: true`、sandbox。文件系统 / 进程 / 凭据 / ACP 只在主进程。

---

## 2. 这一轮 Grok 做错了什么（Codex 不要重复）

用户要的是：**精力聚焦在 UI 上**（观感、布局、密度、主题、空状态、对话阅读、侧栏、卡片、动效、好不好看、好不好点）。

Grok 实际交的是：`docs/LEARNING_BACKLOG.md` 里的工具分组、权限看 Diff、状态点、队列文案，外加一长串协议/Stop/用量账本。
用户明确说：**价值不高，和想要的方向完全不同，没有体现 UI。**

因此：

- **不要把 `LEARNING_BACKLOG.md` 的 G1–G6 当成本轮 Codex 主任务。** 那不是用户要的 UI 方向，也不是你该先做的视觉。
- **不要在这一轮做视觉改版、主题重做、CSS 大改、对话区美化。** 那仍是 Grok 的活；Grok 需要另开一轮真正的 UI 学习后再做。
- `LEARNING_BACKLOG.md` 里的 **C1–C8 和「对照过往 bug」表可以当输入**，但你必须自己再广撒网，按「底层 + 新功能」重新筛，不要只消化 Grok 那一页。

---

## 3. Codex 这一轮要干什么

**你先干。** 不要等 Grok 把 UI 计划重写完。

### 做

1. **自己检索 GitHub**（star 优先，粗筛再深）：包装官方 `grok` CLI 的桌面/扩展、以及高 star 的 ACP 工作台（OpenCode、Goose、Codex CLI 公开部分）。重点看他们 **新功能和底层**（会话生命周期、ACP、子 Agent、workflow、用量数据、权限竞态、更新器、媒体工具、远程协议等），不是抄皮肤。
2. **对照本仓库 0.6–0.9 CHANGELOG 和审核过的同类 bug**：IPC 未知字段、额度 proto3 零值、Stop/队列、Plan/Auto 徽章与真实模式、清理错误盖住主因、set_mode 竞态、图片 read 被文本路径吞掉（phuryn 在 CLI 1.0.4 上修过）。
3. **落地一小包底层或新功能**，要有测试。没有 CLI/ACP 证据不要画假按钮。
4. 新功能若必须露一点界面：用现有组件做 **最小诚实入口**，不要趁机改视觉语言。
5. 更新 `docs/IMPLEMENTATION_PLAN.md`、`CHANGELOG.md`、`docs/FEATURE_MATRIX.md`、`docs/NEXT_SESSION_HANDOFF.md`。给 Grok 留「UI 待做」清单。

### 建议优先（可按证据增删，不要一次做完）

来自已读材料、属于底层/新功能、且不依赖 UI 大改：

| 优先 | 内容 |
|---|---|
| 高 | 切模式失败不得改徽章；`set_mode` 与后续工具请求竞态 |
| 高 | Stop：取消未决权限；CLI 未确认停止时的恢复（对照现有 8 秒路径） |
| 高 | 子 Agent / 后台任务的 **稳定身份**（给以后对话卡用，这轮可以只做数据） |
| 中 | CLI 1.0.4 能力评估：图片 read 是否被宿主 FS 拦成纯文本；未知版本仍失败关闭，不要偷偷把 maxVerified 改到 1.0.4 |
| 中 | Workflow pause/resume/stop 若接：只接受 CLI 显示名，重启后禁用控件 |
| 中 | 用量：会话 usage 真实字段可被读取；禁止把 context occupancy 当成花费 |
| 低 | 远程/手机：只写威胁模型，默认不实现 |

### 不做

- 视觉改版、主题引擎、侧栏/对话「更好看」
- 多 Agent 聚合、语音、静默安装应用更新
- Git push、GitHub Release、付费生成、擅自 `grok update`
- 把 Plan 改回 0.8.3 之前的只读写门（产品已定：Plan 自动批准含写入）

仓库规则：先读 `docs/NEXT_SESSION_HANDOFF.md`、`IMPLEMENTATION_PLAN.md`、`FEATURE_MATRIX.md`、`CHANGELOG.md`、`CLI_COMPATIBILITY.md`。功能未过测试或实机证据不要宣称可用。

---

## 4. 已有材料（参考，不是方向圣经）

- `docs/LEARNING_BACKLOG.md` — Grok 第 1 轮对照；用户不满意其 UI 方向
- `docs/CODEX_UI_PARITY.md` — 旧 Codex 对齐，是交互结构不是本轮视觉任务
- `docs/V090_FINAL_AUDIT.md` / 0.9.0 发版状态
- 粗筛：`phuryn/grok-build-vscode`、`joeynyc/Grok-UI` 值得底层对；AnRkey/Grok-Desktop、Cursor-Grok-free、grok2api 可忽略

当前产品：Windows-first Electron，本机 `grok` CLI，稳定目标 1.0.3。分支以仓库实际 HEAD 为准。

---

## 5. 做完怎么交

1. 写清做了什么、测了什么、没做什么。
2. 单独列出 **留给 Grok 的 UI 项**（不要自己美化）。
3. 用户或 Grok 审核后再进入下一轮。Grok 下一轮必须重新做 **真正的 UI 学习**（观感/布局/阅读），不能继续用 G1–G6 冒充 UI。

---

## 6. 给 Codex 的提示词（整段复制）

```text
你是 Codex，在当前 Grok Build Desktop 仓库工作。这是 Windows-first 的 Electron 桌面壳，包装用户本机已安装的官方 Grok Build CLI（ACP）。Renderer 必须保持 nodeIntegration:false、contextIsolation:true、sandbox；文件系统、进程、凭据、ACP 只放主进程。

先读：
- docs/CODEX_SESSION_HANDOFF.md（本交接，以它为准）
- docs/NEXT_SESSION_HANDOFF.md
- docs/IMPLEMENTATION_PLAN.md
- docs/FEATURE_MATRIX.md
- CHANGELOG.md
- docs/CLI_COMPATIBILITY.md
- docs/LEARNING_BACKLOG.md（仅作参考）

【用户原意，不要再偏】
0.9.0 已是稳定基线。下一阶段要借鉴其他项目：增添功能、美化 UI、优化代码，并看过往更新有没有同类 bug。

两条线循环多轮：
- Grok：聚焦 UI 和真实使用是否好用；学完后改用着别扭的地方。也可以看底层/新功能，但那部分留给你。
- Codex（你）：聚焦底层代码和增添新功能。也可以看 UI，但 UI 美化留给 Grok。
两边都要用 “grok build desktop” 及类似词在 GitHub 广撒网，先看 star 高的粗筛，再深学，不要只学两三个就结束。分阶段、可很多轮。Grok 本应先学并先做；做不完的写成交接你来实行。你做完由你自己或 Grok 审核。

【产品边界】
继续做官方 grok CLI 的 Windows 桌面壳。近 2～3 轮：不做多 Agent 工作台、不做手机遥控、不抄第三方代码（phuryn/grok-build-vscode 是 FSL-1.1-MIT）。不要擅自 git push、不要创建 GitHub Release、不要付费媒体生成、不要执行 grok update 升级本机 CLI。未知 CLI 版本失败关闭；当前验证范围是 1.0.0–1.0.3。

【Grok 这一轮失败了，所以改成你先干】
用户要 Grok 把精力放在 UI（好看、好读、好点、布局/主题/密度/空状态/对话阅读）。Grok 却交了一份偏协议和交互修补的 LEARNING_BACKLOG（工具分组、权限 Diff、状态点、队列文案 + Stop/账本/竞态）。用户明确说价值不高、方向不对、没有体现 UI。

因此你这一轮：
- 不要实现 LEARNING_BACKLOG 的 G1–G6，也不要做视觉改版/CSS 大改/主题重做。那是 Grok 的活，它需要另开一轮真正的 UI 学习。
- 你先做「底层 + 新功能」。自己再去 GitHub 广撒网学这一侧，不要只吃 Grok 那一页。
- LEARNING_BACKLOG 的 C1–C8 和「对照过往 bug」可以当输入。
- 新功能若必须有入口，用现有 UI 做最小诚实表面，不要趁机美化。

【建议切入，按证据增删，不要一次做完】
1. 切模式失败不得改徽章；set_mode 与后续工具请求竞态。
2. Stop：取消未决权限；CLI 未确认停止时的恢复（已有约 8 秒路径，对照补洞）。
3. 子 Agent / 后台任务稳定身份（数据层即可，对话卡留给以后的 UI 轮）。
4. 评估 CLI 1.0.4 图片 read 是否被宿主文本 FS 吞掉；不要把 maxVerifiedVersion 偷偷改成 1.0.4。
5. 若接 workflow pause/resume/stop：只接受 CLI 显示名。
6. 用量只暴露 CLI 真实字段；禁止把 context occupancy 当成花费。
7. 对照本仓库 0.8.x–0.9.0 已修过的 IPC 未知字段、额度 0 值、清理错误盖主因，避免回归。

不要回退 0.8.3 的产品决定：Agent 询问，Auto/Plan 自动批准含写入。

做完：跑相关测试和 typecheck；更新 IMPLEMENTATION_PLAN / CHANGELOG / FEATURE_MATRIX / NEXT_SESSION_HANDOFF；单独列出留给 Grok 的 UI 项。未过测试不要宣称功能可用。
```
