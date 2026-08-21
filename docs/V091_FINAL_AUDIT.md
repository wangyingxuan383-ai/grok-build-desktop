# Grok Build Desktop 0.9.1 审核

日期：2026-08-21  
审核人：Grok（对照源码、自动化门禁和本机安装版，不复述 Codex 自审）  
范围：分支 `codex/v0.9.1-cli-1.0.5-foundation` 提交 `17a9582`、本地安装版、离线测试与文档声称。  
状态：**本地候选成立，可以继续给用户用；不是公开 Latest。** 未发现阻断安装回退的 P0。文档对 Host-exit「已提交项绝不重放」写得比代码更满。

## 结论

- 0.9.1 把 Codex 阶段 A–D、插话/队列四条路径拆分、源码预览隔离和 0.9.0 皮肤撤回收成一版。源码、`package.json`、Setup/Portable 哈希和 per-user 安装版 File `0.9.1` / Product `0.9.1.0` 一致。
- 本审核复跑离线套件：119 个测试文件，113 通过、6 个 live 跳过；834 项中 825 通过、9 项 live 跳过。`tsc --noEmit` 通过。`npm audit --audit-level=high` 为 0 漏洞。
- live CLI 仍是 **1.0.3**。兼容档案 `maxVerifiedVersion` 为 1.0.5（离线 Fixture），`liveVerifiedVersion` 为 1.0.3。未执行 `grok update`、未推送、未创建 Release。
- 视觉仍是 0.9.0 青蓝石板。`reading.css` / `calm.css` 不存在。用户否决的皮肤不得恢复。
- 这不是对所有账号、Provider、未来 CLI 和超长真实会话的零缺陷保证。

## 1. 高频使用路径

| 路径 | 结论 | 证据/边界 |
|---|---|---|
| 启动与窗口恢复 | 已实现 | 窗口状态服务保留；安装版冷启动在交付记录中通过。本审核核对本机 EXE 版本，未再做一次冷启动点击。 |
| 登录与账号 | 沿用 0.9.0 | 本轮未改认证协议；凭据仍在主进程。 |
| 新任务与历史会话 | 已实现 | 草稿 claim/generation、投影先显、load single-flight 有测试。 |
| 官方/自定义模型 | 已实现 | 目录由 ACP 更新；Provider 本地 ID 不被上游别名替换。 |
| Agent/Auto/Plan | 已实现 | Agent 询问；Auto/Plan 选 CLI allow。权限卡 22px 未改。 |
| 插话 / 队列 / Send Now | 主路径已实现 | `x.ai/interject` 只注入当前回合；忙碌 Enter 走 `session/prompt` + `x.ai/queue/changed`；缺方法才 `_meta.sendNow=true`。见第 3 节 P1。 |
| 额度与 Usage | 沿用 0.9.0 额度；Usage 有收紧 | 费用仍只读明确 cost。Context occupancy 另列。见 `totalTokens` 回退。 |
| Compact | 主路径已实现 | Compact 前后读 Context used tokens；全零占位不能擦 UI 已有 Usage。卡片未展示 before/after。 |
| 文件 / Review / 重绑定 | 已实现 | 重绑定为 Assignment/Runtime/Projection/Token 事务；不完整回滚不删唯一可用副本。缺少 Controller 集成测试。 |
| 图片/视频 | 能力检测沿用 1.0.3 live | 列表用 512px JPEG 缩略图；Lightbox/复制/另存/打开用原句柄；缩略图失败先回退原图。未付费生成。 |
| 更新与诊断 | 已实现 | 应用只检查 Release；CLI 固定目标手动更新。诊断可报告 `GROK_CONFIG`/`GROK_CONFIG_PATH` 来源（变量名、字节数、basename）。 |

## 2. 0.9.1 计划对账

| 项 | 计划 | 审核 |
|---|---|---|
| 阶段 A 会话归属 / single-flight / 草稿 claim | 完成 | 源码与测试存在。跨会话 fixture `session-ownership-interleaved.json` 存在。 |
| 阶段 B MCP `structuredContent` | 完成 | `content` 2MiB 与 `structuredContent` 256KiB 分界；字符串不二次 `JSON.parse`。`rawInput` 未同等有界（P2）。 |
| 阶段 B Context/Usage/Compact | 完成，有残余 | occupancy 不进 PromptMeta。`normalizeCliSessionInfo` 仍可把 `data.totalTokens` 当成 `contextUsedTokens`（P1）。 |
| 阶段 B Route Receipt | 完成，测试偏薄 | 无凭据、冻结 origin/类别/模型/协议/档位。失败分阶段实现了，缺少 focused 测试（P2/P1 交界）。 |
| 阶段 B Provider 恢复 | 完成，有边角 | 损坏主文件 + 空索引 + 哈希/身份匹配才恢复。遗留 `providers.json.corrupt-*.bak` 加上合法空索引可能误恢复（P1）。 |
| 阶段 C 缩略图 + 300 回合夹具 | 完成 | 主进程 JPEG 缓存、投影二次恢复、空过程组过滤、底部跟随策略有单测。不是真实 Virtuoso/文件重挂载。 |
| 阶段 D Host-exit lease / 重绑定 / 拆分 | 完成，文档过满 | 未完成回合与权限门只结算一次、保留部分正文。已提交队列中断**依赖**存在未匹配 `turn-started`（P1）。 |
| 阶段 E UI | 暂停 | 自编阅读层和 Minimal Calm 已撤回。不要当成本轮成果。 |
| CLI 1.0.4–1.0.5 | 离线完成 | Fixture 覆盖 1.0.0–1.0.5；1.0.6+ 失败关闭。live 仍 1.0.3。 |
| 「其他（自行输入）」 | 完成 | `MessageCard` 对有选项问题提供自定义回答，仍解析同一 ACP request。 |
| 源码预览隔离 | 保留 | 未打包名 `Grok Build Desktop Source`；显式 `--user-data-dir` 不再被覆盖。打包身份不变。 |

## 3. 本审核发现（未改代码）

### P0

无。未发现静默切回官方模型、把 occupancy 直接当成账单、把插话写成第二条用户消息、或 Renderer 打开 `nodeIntegration`。

### P1（不回退安装，但文档不得再写成「已无条件保证」）

1. **Host-exit 队列不重放不是无条件的。** `interruptInflightQueue` 会把 `sending` / `accepted` / `send-now` / `interjecting` / `interjected` 标失败，但 `restore()` 只在 `reconcileHostExitLease` 找到未完成 `turn-started` 时调用它。若上一回合已 `turn-completed` 而队列里仍有已提交项，适配器会把 `interjecting` 改回 `queued`，并把 `send-now` / `accepted` / `sending` / 旧 `interjected` 再提交。`grok-acp-adapter.test.ts` 甚至覆盖了遗留 `interjected` 的重放。FEATURE_MATRIX / Changelog 写「重启不重放已提交项」过满。
2. **`contextUsedTokens` 仍回退 `data.totalTokens` / `data.total_tokens`。** Compact 主路径读 `sessionInfo().contextUsedTokens`。若 session-info 把 `totalTokens` 当花费，占用和 Compact 前后值可能串味。现有测试只覆盖 `context.used`。
3. **Provider 恢复看「目录里是否还有 corrupt bak」，不是「这次 `get()` 刚修好主文件」。** 主索引可读且非空不会被覆盖。主索引合法为空（例如用户清空）且磁盘上留着旧 bak 时，可能把 last-known-good 请回来。

### P2

- Route Receipt 失败分阶段、队列插话「被消费但不是 `runningPromptId`」、超时且 revision 已变、Composer 锁/叉号，自动化偏薄。
- 队列插话 IPC 回执仍可能带 `state: "interjected"`，行状态才是 `interjecting`。
- Compact before/after 在事件里，卡片不展示。
- 300 回合夹具是投影/策略单测，不是安装版长会话。
- 历史 `FEATURE_MATRIX` 0.6.22 行仍写插话会变成自己的下一回合，与 0.9.1 语义矛盾（历史行，易误导）。
- 发送钮是 32px 圆钮，不是权限卡的 22px；22px 只约束 `.codex-request-card`。

## 4. 安全与产品边界

- 主窗口与 Computer Use 浮层：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- Renderer 不碰 FS/进程/凭据/ACP。
- 未知 CLI 主版本和 1.0.6+ 失败关闭。
- 未打包预览与安装版 AppData 分离；计划任务工人仍写安装目录。
- 仓库根三份用户 `_tmp_*` 草稿未纳入候选源码；标准公开扫描会因其中本机路径失败。这是用户文件边界，不是 0.9.1 功能缺口。

## 5. 尚不能宣称

- 未公开发布；公开资产必须由标签工作流重建并核对 SHA-256/Attestation。
- 未做本机 CLI 1.0.5 live ACP。插话四条路径、图片感知读取让位、`reasoningEffort` 恢复在 1.0.5 上只有离线/源码证据。
- Provider、媒体生成、远程 CPA、Computer Use 真实动作仍取决于账号与上游。`403 cpa_local_only` 仍是外部边界。
- 用户否决的 UI 改版未完成；0.9.1 不包含新皮肤。
- 完整 Windows 10/11、DPI、杀毒、组策略矩阵未在本审核复测。

## 6. 本审核直接核对的证据

| 项 | 结果 |
|---|---|
| `npx vitest run` | 834 项：825 通过、9 pending/live 跳过；119 文件：113 通过、6 跳过 |
| `npx tsc --noEmit` | 通过 |
| `npm audit --audit-level=high` | 0 漏洞 |
| 源码皮肤 | 无 `calm.css`/`reading.css`；`DARK_COLORS` `#0d0f12` / `#45a9df`；`.codex-request-card` `border-radius: 22px` |
| 沙箱 | `src/main/index.ts` 主窗口三项隔离为 true |
| 兼容档案 | `maxVerifiedVersion` 1.0.5，`liveVerifiedVersion` 1.0.3 |
| 安装版 EXE | `%LOCALAPPDATA%\Programs\Grok Build Desktop\Grok Build Desktop.exe` File `0.9.1` / Product `0.9.1.0` |
| 产物哈希（与 `release/SHA256SUMS.txt`、交接文档一致） | Setup `ab10cbcf039c72d8f51446c1909ff10a7f7d795fc02d186f16467a4016161522`；Portable `fc3f21b1d240e87124ff69c23849a140344a09cceecd542ef1a7c80a58e87292`；SBOM `3972dcad0fd1eb272e51b732485d420835892adf8cb89b3d2feeb016909bf650`；许可证 `f3989851fa2f026f95aa4d1bfb3e3ad27e64a622c48ce5e2fb9a075d464c13c3` |

未在本审核中重跑：打包、Portable 中文路径、Fuses/ASAR 扫描、付费请求、CLI 升级、Computer Use 实机、安装版 About 点击。这些仍以 2026-08-21 交付记录为准，不升级为本审核新证据。

## 7. 审核后源码收口（同日，未重新打包）

三项 P1 已改源码并补测试，安装版 0.9.1 二进制尚未包含：

1. 非活动 `restore` 始终调用 `interruptQueue`，不依赖未完成 `turn-started`。
2. `normalizeCliSessionInfo` 的 `contextUsedTokens` 不再回退 `data.totalTokens`。
3. `recoverIfEligible` 在 `providers.json` 可读时（包括空数组）直接拒绝，即使旁边有旧 corrupt bak。

## 8. 给下一轮的边界

1. 用户要公开 Release：走 `v0.9.1` 标签工作流，不要把本地 Setup 当 Latest。
2. 用户要 1.0.5 live：固定目标「更新并验证」，通过后再改 `liveVerifiedVersion`。禁止裸 `grok update`。
3. 修 P1 前不要改皮肤。Host-exit 应在「无未完成回合」时也中断已提交队列；`contextUsedTokens` 不要回退花费字段；Provider 恢复不要仅凭磁盘上的旧 bak。
4. Grok 视觉轮保持停止，直到用户另开。
