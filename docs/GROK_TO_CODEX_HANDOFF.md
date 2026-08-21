# Grok → Codex 交接（2026-08-20）

> **状态更新（2026-08-21）：** 本文件记录的是 Grok UI 撤回当时的历史边界。其所称“下一刀阶段 B”现已由 Codex 完成；最新状态以 `docs/NEXT_SESSION_HANDOFF.md` 顶部为准。不得据此恢复已否决的 UI 皮肤。

给 **Codex** 用。可整份当作新会话上下文，文末有可粘贴提示词。

这是 Grok 这一轮 **实际做完、又被用户叫停并撤回** 之后的仓库真相。`docs/CODEX_CONTINUE_HANDOFF.md` 已改为明确的过期声明；当前实现状态仍以 `docs/NEXT_SESSION_HANDOFF.md` 为准。

---

## 0. 先读，再动手

当前分支：`codex/v0.9.1-cli-1.0.5-foundation`（相对 `v0.9.0`，工作区 **未提交**）。

动手前读：

1. `docs/NEXT_SESSION_HANDOFF.md`
2. `docs/IMPLEMENTATION_PLAN.md`
3. `docs/FEATURE_MATRIX.md`
4. `CHANGELOG.md`、`docs/CLI_COMPATIBILITY.md`
5. 阶段 B 依据：`docs/CODEX_MULTI_PROJECT_RESEARCH_2026-08-19.md`、`docs/CODEX_BACKEND_RESEARCH_2026-08-19.md`

**禁止** `git reset` / 还原丢掉阶段 A。先 `git status` 看清哪些是你的底层、哪些是 Grok 留下的隔离代码。

本机 live CLI 仍是 **1.0.3**。不要跑裸 `grok update`，不要打包、安装、推送、Release、付费生成。Plan 保持 Auto/Plan 自动批准（含写入）。不要拷 `phuryn/grok-build-vscode` 的 FSL 源码。

---

## 1. 分工（用户拍板，不要再偏）

| 谁 | 做 | 不做 |
|---|---|---|
| **Grok** | UI、观感、真实好不好用 | 用协议/状态/队列冒充 UI |
| **Codex** | 底层、新功能 | 视觉改版、主题、CSS 大改、对话区美化 |

用户原话方向：Grok = UI/comfort；Codex = backend/new features。近 2～3 轮不做多 Agent 工作台、不做手机遥控。产品仍是官方 Grok CLI 的 Windows-first Electron 壳。Renderer：`nodeIntegration: false`、`contextIsolation: true`、sandbox。FS / 进程 / 凭据 / ACP 只在主进程。

**现在**：用户已经对 Grok 说「别干了，改回去」。Grok **停止视觉轮**。Codex **不要接盘皮肤**，去做阶段 B。

---

## 2. Grok 这一轮实际经过（按时间）

用户要的是很多小细节组成的舒适度，不是「几个阶段」。Codex 当时额度不够 / 阶段 A 未提交，用户先让 Grok 继续做 UI，并说过「codex不用做，你继续做，做完为止」。后来验收失败，叫停。

| 尝试 | 用户反应 | 结果 |
|---|---|---|
| 自编 `reading.css` + 图标/结构铬 | 「真是越改越丑…以前好歹中规中矩，现在不仅丑还改出来 BUG」 | **已撤回**。不要恢复 |
| 照抄 `joeynyc/Grok-UI` Minimal Calm 到现有 class | 先说改太少；补完网格/鼠尾草/去框后又说「抄都不会抄，别干了，改回去」 | **已撤回**。不要恢复 |
| 为了给用户看又不关安装版：未打包身份隔离 | 「关掉安装版会话那会话不就终止了」「我要双击打开的应用」「还继续0.9.0？不会混」 | **保留**。这是唯一还留在树上的 Grok 产物 |

用户还明确过：

- 不要把协议/状态/队列当成 UI。
- 不要杀安装版 `Grok Build Desktop.exe` 来「启动开发版」。
- 不要给一串命令代替双击路径。
- `package.json` 仍是 `0.9.0` 只是版本标签，**不等于**和安装版共用 AppData。
- 照抄可以，但不要生搬 HUD / Operator 荧光黄 / Event Horizon / Syne / 8–11px / 雷达，也不要改出发送钮、权限卡、Codex 行为的 bug。

---

## 3. 现在仓库里还剩什么（Grok 留下的）

视觉已经回到 **0.9.0 青蓝石板**：

- `DARK_COLORS` / `LIGHT_COLORS` 恢复 `#0d0f12` / `#45a9df` 与浅色 `#f6f7f9` / `#1677a8`
- `tokens.css` 首屏 fallback 同步恢复
- 没有 `reading.css`、没有 `calm.css`、`styles.css` 不再额外 `@import` overlay
- 窗口冷启动底色恢复 `#0f1115` / `#f6f7f9`
- 发送钮、`.codex-request-card` `border-radius: 22px`、图标集、侧栏/顶栏结构 **按 0.9.0**

**仍保留、请不要删**的未打包隔离（避免 `electron .` 和安装版抢 `requestSingleInstanceLock`）：

| 路径 | 作用 |
|---|---|
| `src/main/source-preview-identity.ts` | 未打包才返回身份；打包返回 `undefined` |
| `src/main/source-preview-identity.test.ts` | 打包不变、未打包 AppData 不指向安装目录 |
| `src/main/index.ts` | `setName` / `setPath('userData')` / `setAppUserModelId` 在 **单实例锁之前**；预览窗 `page-title-updated` 锁标题 |
| `scripts/create-source-preview-shortcut.mjs` | 生成仓库根目录 `.lnk`，指向 `node_modules/electron/dist/electron.exe`，参数 `.` |

身份常量：

- 安装版：`Grok Build Desktop`，AUMID `io.github.grokbuilddesktop.community`，AppData `%AppData%\Grok Build Desktop`
- 未打包：`Grok Build Desktop Source`，AUMID `io.github.grokbuilddesktop.community.source`，AppData `%AppData%\Grok Build Desktop Source`

本地快捷方式（gitignore 的 `*.lnk`，需要时再跑脚本）：

`<repo>\Grok Build Desktop 源码预览.lnk`

自动化工人 / 卸载计划任务仍显式写安装版目录 `join(app.getPath("appData"), "Grok Build Desktop")`，不要改成 Source。

Grok **没有**改你的阶段 A 行为文件（见下一节）。文档里 Grok 只改了 Visual 说明和阶段 E 状态，**不要删**你的 0.9.1 Added/Changed/Fixed。

---

## 4. 不要恢复的东西

这些已经从树上拿掉。再加回去等于无视用户叫停。

- `src/renderer/src/styles/reading.css` 以及任何「阅读层」overlay
- `src/renderer/src/styles/calm.css`、石色 `#20231f` / 鼠尾草 `#58705d` / `#8aa08e` 经典色、72px 网格
- 全局把 `.primary` 改成 `text-strong` 实心
- 改发送钮、改权限卡 22px、换图标集、给 session 行加 `role=button`、`window.prompt` 重命名、藏空的 Codex 分组
- 把 Grok-UI 的 Operator 荧光黄 `#d9ff43`、Event Horizon HUD、Syne、8–11px、雷达/扫描线搬进本应用
- 为了看 UI 去 `taskkill` 安装版进程

`layout-regression` 仍要求拼接 CSS 里存在：

`.codex-request-card { border-radius: 22px; background: var(--input-bg); }`

---

## 5. Codex 自己的未提交成果（必须保留）

阶段 A，已完成未发布：

- 主进程：`app-controller.ts`、`grok-acp-adapter.ts`、`grok-process-manager.ts`、`cli-update-service.ts`、`cli-locator.ts`、`runtime-task-identity.ts`
- Fixture：`cli-wire/initialize-1.0.4.json`、`events-1.0.4.json`、`initialize-1.0.5.json`、`events-1.0.5.json`、`session-ownership-interleaved.json`
- Renderer 行为（不是皮肤）：`App.tsx` 草稿 claim/send generation、`use-session-draft.ts`、`session-ui-guards.ts`、`MessageCard.tsx` 问题卡「其他（自行输入）」、`AppAuxiliaryPanels.tsx` CLI 检查中/最新/错误
- 文档里的 0.9.1 / 阶段 A 段落

兼容：离线 1.0.0–1.0.5，未知版本失败关闭。live 仍钉 1.0.3。

下一底层是 **阶段 B**（`IMPLEMENTATION_PLAN`）：

1. 有界 MCP `structuredContent`（同时保存 `content` 与 `structuredContent`；字符串保真；大对象限长；64 位 ID 不二次解析）。先规范化层和测试；ToolCard 只在有证据时加最小入口，**不要趁机改工具卡皮肤**。
2. Context/Usage/Compact 语义回归：`totalTokens: 0` 占位、Compact 回放、per-prompt sibling、partial cost、代理/日志双来源去重。费用只读明确 cost 字段。
3. Provider Route Receipt：冻结 Provider ID、Origin、credential source、local/upstream model ID、协议和档位；错误按路由/认证/翻译/上游分阶段。
4. Provider 恢复对抗测试：profile ID + 规范 endpoint + schema 全匹配才允许从备份恢复；不得覆盖现有主文件。

阶段 C/D 先别做。阶段 E（UI）**暂停**，直到用户另开 Grok 视觉轮。

新功能若必须露一点界面：现有组件最小诚实入口，不要改视觉语言。和任何将来的 UI 改动 **不要同一 PR**。

---

## 6. 文档怎么改

做完阶段 B 时：

- 更新 `CHANGELOG.md`、`docs/FEATURE_MATRIX.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/CLI_COMPATIBILITY.md`（若契约变了）、`docs/NEXT_SESSION_HANDOFF.md`
- **保留** Changelog 里 Visual 那条「撤回 Minimal Calm / 阅读层」
- **不要**把隔离身份写成用户功能；它只是未打包预览不抢安装版锁
- 不要把 `LEARNING_BACKLOG.md` 的 G1–G6 当成本轮任务

---

## 7. 验证口径

Grok 撤回后跑过：`layout-regression` 17、`theme` 7、`source-preview-identity` 2；随后 `npm run build` 通过。不要声称阶段 B 已完成，除非你的测试或文档化 live 证据过了。

用户验收视觉失败，**不要**再交一版皮肤让用户「看看」。安装版 0.9.0 才是用户正在用的皮肤。

---

## 8. 提示词（可直接粘贴）

```
继续当前仓库的 `codex/v0.9.1-cli-1.0.5-foundation` 分支。

先读 docs/GROK_TO_CODEX_HANDOFF.md（以它为准，不要信 docs/CODEX_CONTINUE_HANDOFF.md 里关于 reading.css 的旧说明），再读 docs/NEXT_SESSION_HANDOFF.md、docs/IMPLEMENTATION_PLAN.md、docs/FEATURE_MATRIX.md、CHANGELOG.md、docs/CLI_COMPATIBILITY.md。

先 git status。阶段 A（会话归属、load single-flight、草稿 claim、「其他（自行输入）」、CLI 检查 UI、1.0.4/1.0.5 fixture）是未提交成果，禁止 reset/还原。

Grok 的视觉轮已被用户否决并撤回：没有 reading.css / calm.css，经典色回到 0.9.0 青蓝石板。不要做 UI 美化，不要恢复那些 overlay，不要改发送钮和 .codex-request-card 22px。

Grok 留下的未打包隔离必须保留：src/main/source-preview-identity.ts 以及 index.ts 里在单实例锁之前的 setName/userData/AUMID。打包身份不变。不要 taskkill 安装版 Grok Build Desktop.exe。

你的任务是阶段 B，见 docs/IMPLEMENTATION_PLAN.md 与 docs/CODEX_MULTI_PROJECT_RESEARCH_2026-08-19.md：
1) 有界 MCP structuredContent 规范化 + 测试
2) Context/Usage/Compact 语义回归（0≠未知，费用只读 cost 字段）
3) Provider Route Receipt
4) Provider 备份恢复对抗测试

不要：grok update、打包、安装、push、Release、付费请求、UI 美化、G1–G6、多 Agent、手机遥控。
做完更新 CHANGELOG / FEATURE_MATRIX / IMPLEMENTATION_PLAN / NEXT_SESSION_HANDOFF，保留 Grok 的 Visual 撤回说明。跑聚焦测试和 tsc。未验证过的功能不要写成已完成。
```
