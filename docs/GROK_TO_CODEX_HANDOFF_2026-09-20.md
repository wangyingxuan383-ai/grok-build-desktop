# Grok → Codex 交接（2026-09-20）

给 **Codex** 用。可整份当作新会话上下文，文末有可粘贴提示词。

这是 Grok 在 **v0.9.6 已正式发布之后**，对这一轮 Desktop 能力更新做的只读审查。未改产品代码、未注册真实 Windows 任务、未调用模型、未升级 CLI、未再打包或发布。

---

## 0. 先读，再动手

当前仓库：`D:\grok zhuo\grok-build-desktop`

- 分支：`main`，与 `origin/main` 一致，工作区干净
- 标签：`v0.9.6` → `4dc09db71563b76ef096a2a68951ebdff86e31d7`（PR #52）
- 发布页：https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/tag/v0.9.6 （Latest，非草稿）
- 正式工作流：https://github.com/wangyingxuan383-ai/grok-build-desktop/actions/runs/35488946469 成功（约 8 分 45 秒）

动手前读：

1. 本文件
2. `docs/DESKTOP_CAPABILITIES_IMPLEMENTATION_2026-09-18.md`（先读顶部 09-19 修正）
3. `docs/releases/v0.9.6.md`
4. `docs/NEXT_SESSION_HANDOFF.md`（历史很长；下方旧「未发布 / 1.0.3 / 1.0.25」不是当前结论）
5. `docs/IMPLEMENTATION_PLAN.md` 顶部 v0.9.6 与 09-18/09-19 清单

**不要** `git reset`。不要把 v0.9.5 交接或旧电脑实测当成这一轮已验收。

**未经用户新授权不要：** 再发版、替换安装版、升级本机 CLI、注册真实计划任务、付费模型调用、重跑全量测试、改 UI 皮肤。用户上一轮明确：不要做重复和多余测试；绑定任务工作区可编辑是有意保留的。

用户三份仓库根 `_tmp_*` 不读写、不提交。

---

## 1. 用户目标（不要再偏）

对齐方向仍是：

**自然语言提出任务 → LLM 发现并选择能力 → 执行过程可观察 → 结果可核验 → 失败可恢复**

三项能力：子智能体、Computer Use、持久定时任务。不以复制 Codex 界面或私有实现为目标。官方 `/loop` 不是桌面持久任务的替代。

v0.9.6 已把离线闭环和发布做完。Grok 审查结论：**主干修对了，对话式能力还不能当可用。** 下一刀应是可靠性收口 + CLI 合同探针 + 安全默认，而不是再加面板或加长 Skill。

---

## 2. 当前事实（已核对，勿与文档旧标题混淆）

| 项 | 事实 |
|---|---|
| 产品版本 | `package.json` = `0.9.6` |
| Git | `main` 干净，`v0.9.6` 已推送 |
| GitHub Release | Latest，5 个附件已上传（Setup / Portable / SHA256SUMS / SBOM / 许可证） |
| 本机 `release/` | 有同名安装包，**体积和哈希与 GitHub 不一致**（本地打包 vs CI 重建）。对外下载只用 GitHub 发布页 |
| 文档标题 | `CHANGELOG` 仍写「发布准备中」；实施记录 / 交接 / 功能矩阵仍写「未发布」。以 Git 标签和 Release 为准 |
| CLI | 新电脑受管路径曾读到 **1.0.30**。桌面实际选中路径、哈希、Provider、hook 合同 **本轮未验收** |
| 离线证据 | 实施阶段全量 971 通过 / 9 live 跳过；09-19 修正后 58 项定向 + typecheck + 任务中心 DOM + 未注册 XML 解析。修正后 **没有** 重跑全量 |
| 对话能力 | Desktop MCP / Computer 工具要求 CLI `PreToolUse` + `updatedInput`。缺证明则拒绝。Skill 仍教模型去调这些工具 |

---

## 3. v0.9.6 已经做对的（不要回滚）

| 方向 | 现状 | 主要位置 |
|---|---|---|
| 任务完成不再覆盖编辑/暂停/删除 | 定义与运行映射拆开，`revision` + `deletedAt` | `automation-service.ts`；测试 `does not overwrite a concurrent %s on completion` |
| 权限与启动模式一致 | 冻结同一份执行配置 | `automation-effective-profile.ts`；Worker `app-controller.ts` ~2260 |
| `computerEnabled` 真关门 | 关闭时不注入 Computer MCP，服务端再拒 | `computer-use-service.ts` `createSessionInjection` / `mcpCall` |
| 能力不再显示历史验收为当前成功 | `accepted: false`，`liveVerified: false` | `computer-use-service.ts` ~83 |
| 日历重复触发 + IANA/DST | 不依赖 Worker 再登记下一次 | `automation-schedule.ts`；`admitCalendarOccurrence` |
| 绑定工作区可编辑 | 下次空闲迁移同一会话，历史保留 | `TaskCenterPanel.tsx`；`rebindSession` |
| Desktop MCP | list/create/update/pause/delete/runs/cancel；Plan 不能改任务 | `desktop-tools-service.ts` |
| 调用证明 | 主会话 hook 一次性 proof；无证明失败关闭 | `desktop-tool-authority.ts` |
| 子智能体取消 | 必须有原生 ID；未知 Agent 字段和 `mcpInheritance` 保留 | `agent-dashboard-service.ts`；`execution-profile-service.ts` |
| 桌面互斥 | `Local\GrokBuildDesktop.ComputerUse`，崩溃可回收 | `native/GrokComputerHost.cs`；`computer-desktop-lease.test.ts` |

绑定任务工作区可编辑是用户明确要求，**不要再改回只读**。

---

## 4. 审查发现（按优先级修）

只读审查，源码行号以 2026-09-20 的 `v0.9.6` 树为准。

### P1 可靠性

**R1. `fresh`/配置变化时清会话映射不看 revision**

`src/main/app-controller.ts:2304-2308` 调用 `setExecutionSession(task.id, undefined)` 不传 `expectedRevision`。完成写回 `automation-service.ts:269` 是带 revision 的；中间这次清理不是。运行中改名/暂停仍可能清掉 runtime 映射。服务层并发测试只覆盖 executor 结束路径，不覆盖这条 Worker 清理。

**R2. 「等待当前会话不占槽」有竞态**

拿槽前 `ready()` 会等空闲（`app-controller.ts:2387-2396`，`automation-service.ts:378-391`）。拿到槽后，已加载会话还有 `while (adapter.working \|\| adapter.needsUser)`（`app-controller.ts:2273`）。空闲窗口里会话又忙，会占着全局槽干等。与 09-19「等待不占槽」不完全一致。

**R3. 定时 Computer 确认在 Host 挂掉后仍可能被批准**

Worker 走持久收件箱，`confirmRisk`（`computer-use-service.ts:426-433`）不登记 `pendingRisks`。Host 退出只 resolve 进程内 pending（`:486-490`）。收件箱仍在；之后「允许」会把任务拨回 `running` 并在新 Host 上继续。

**R4. 间隔任务 OS 触发约 10 年截止**

日历已改永久重复。间隔仍是 `P3650D`（`automation-service.ts:565`）。到期后除非重新注册，Windows 不再唤醒。

### P1 默认策略 / 隔离

**R5. 对话创建任务会继承 Computer，缺省还可能是开的**

界面新建默认 `computerEnabled: false`（`TaskCenterPanel.tsx:45`）。MCP 创建是 `snapshot.processOptions?.computerEnabled ?? true`（`app-controller.ts:530-534`）。普通会话注入同样 `computerEnabled ?? true`（`:411`）。Auto 会话里说「明天提醒我」，可能生成无人值守且允许操作桌面的任务。

**R6. Auto 模式跳过 Computer 高影响确认**

`shouldConfirmComputerRisk`（`computer-use-service.ts:510-512`）在 `auto` 下对 delete 等风险返回 false。任务表单默认又是 Auto。Skill 与实现一致，但和「定时任务也要二次确认」冲突。不要把「Auto 跳过确认」本身当回归；按产品选择统一默认，避免定时任务静默拿到桌面控制。

**R7. 子智能体隔离依赖 CLI 是否填写 `subagentType`**

`desktop-tool-authority.ts:47-49`：`subagentType` 为空当作主会话。无 proof 会拒绝（这点对）。若子调用共用父 `sessionId` 且不填类型，就能拿到证明。本机 1.0.30 的 PreToolUse / `updatedInput` / `subagentType` **尚未实测**。

### P2 体验 / 卫生

**R8. 定时确认不好找。** 通知和收件箱标题都是「定时任务等待确认」（`app-controller.ts:2687`、`:3400`）。入口在任务中心「队列与后台」。覆盖层只显示等待，没有批准按钮。Computer 高影响和普通工具权限看起来一样。

**R9. 任务表单没有时区。** 后端和 Skill 用 IANA；`ScheduleEditor` 无时区字段。MCP 能改，UI 不能。

**R10. 扩展中心 Computer 证据不是按当前会话。** MCP `capabilities` 按 session；`ipc.ts:267` 的 `computer:capability` 不传 sessionId，任意会话的 requested/discovered 会显示成当前状态。

**R11. 文档仍写未发布。** `CHANGELOG.md`「发布准备中」；`DESKTOP_CAPABILITIES_IMPLEMENTATION_2026-09-18.md`、`NEXT_SESSION_HANDOFF.md`、`FEATURE_MATRIX.md` 仍写 Unreleased。发布补记应写成：工作流 35488946469 成功，v0.9.6 为 Latest。不要把修正后的 58 项冒充全量 971。

**R12. MCP 可能把 `futureIntent` 写进任务 JSON。** create 校验后整份 input 进入 `createOne`，没有剥离 MCP 专用字段。

**R13. 删除 tombstone 永不回收。** `deletedAt` 文件和 runtime/cursor 会一直留着。迟到 Worker 对已删除任务抛「任务已删除」，不一定写 skipped 运行记录。

**R14. 调用证明 TTL 125 分钟**（`desktop-tool-authority.ts:54`）。一次性有帮助，未消费 proof 窗口过长。Hook 超时是 5 秒。

**R15. `computerEnabled=false` 仍创建 MCP server/lease**，只是不注入。可发现性已关，面仍偏大。

**R16. 当前会话任务跑完后恢复 Computer 用 `adapter.processOptions.computerEnabled ?? true`**（`app-controller.ts:2288`）。`processOptions` 缺字段时会把 Computer 重新打开。

**R17. Persona / 默认 Worktree 隔离仍是 `degraded` rules。** 不要写成强制沙箱。官方新版默认可继承父 MCP，桌面证明必须实测，不能假定子智能体天然隔离。

**R18. `NativeAgentCapabilities` 只观察 `title` / `rawInput.name`，没有 continue 映射，也没有单测。** Dashboard 停止按钮不看 CLI 是否宣告 cancel。

---

## 5. 建议实施顺序（用户未另指定时按此）

### 第一刀：先证明对话工具能不能用（隔离、不升级 CLI）

固定桌面**实际选中**的 CLI 路径、版本、SHA-256。不自动升级。隔离目录：

1. 父会话调 Desktop MCP（如 `capabilities` / `automation_list`）成功
2. 子智能体同样调用被拒绝
3. `computerEnabled=false` 时 Computer 工具不可发现且服务端拒绝
4. hook 缺 `updatedInput` 时明确失败，不降级继续

把结果写进 `CLI_COMPATIBILITY.md` 和能力证据。若合同不成立：UI/Skill 标明不可用，不要再扩对话式任务。

### 第二刀：可靠性（R1 R2 R3 R4）

- 所有 `setExecutionSession` 带 revision，对不上 no-op
- 绑定会话真正空闲后再占全局槽；或发现又忙了就放槽再等
- Host/Worker 退出时否决桥接中的确认；批准时若状态已不是 `awaiting-risk-confirmation` 则拒绝
- 间隔触发可续期，或到期前重新注册；删除成功后 GC tombstone

### 第三刀：安全默认（R5 R6 R7）

- MCP 创建默认 `computerEnabled: false`，与界面新建对齐
- 定时任务若允许 Computer：默认 Agent，或 Auto 下高影响仍确认
- `subagentType` 缺失时失败关闭，除非 CLI 有明确主会话字段（需第一刀证据）
- 当前会话任务结束时按原 `processOptions` 恢复，缺省不要 `?? true`

### 第四刀：体验与文档（R8–R11，可与上并行的小改）

- 收件箱区分「Computer 高影响」和普通工具权限；覆盖层或当前会话给批准入口
- 任务表单 IANA 时区；扩展中心能力按当前会话
- Changelog / 实施记录 / 功能矩阵改成「已随 v0.9.6 发布，CLI/模型验收未完成」

不要为这些改动重跑全量。沿用 09-19：定向测试 + 相关 DOM/XML。不要新增无关 UI 测试。

---

## 6. 可做的优化（非必须，可夹在对应 P1 里）

1. MCP 写入前丢掉 `futureIntent` 等未知临时字段
2. Plan 模式不向模型暴露会改任务的工具，而不是调了再报错
3. Dashboard：CLI 未宣告 cancel 时禁用停止，并说明缺原生 ID
4. 原生工具观察不要只靠显示名；补 `native-agent-capabilities` 单测
5. 绑定工作区用目录选择，保存时提示「下次空闲迁移同一会话」
6. 缩短 proof TTL 到 hook 超时 + 工具延迟量级
7. `computerEnabled=false` 时不要创建空 MCP server

---

## 7. 新想法（需用户点头再做，本轮不是必须）

- **对话创建任务的安全默认：** 关 Computer、Agent 模式；需要桌面控制时显式说
- **人能看懂的能力灯：** 当前会话四格：已配置 / 已注入 / 已发现 / 已实测，带 CLI 版本和 hook 结果
- **「稍后继续」向导：** 当前会话排队 vs 持久任务 vs 独立新会话，减少模型造重复任务
- **确认回到当前对话：** 不要只塞任务中心队列
- **只验合同、先不跑 GUI：** 比完整视觉验收便宜，却能决定对话能力是否可用

独立虚拟桌面、云端多机、分段下载器、自动升 CLI **仍不在范围**。分段下载器状态见 `docs/SESSION_TRANSFER_2026-09-17.md`，不要和本轮混在一个 PR。

---

## 8. 验证口径

- 声称修好 R1：要有 Worker/app-controller 级测试，不能只靠现有 `automation-service` 并发测试
- 声称修好 R2：要覆盖「ready 为真之后会话又变忙」
- 声称修好 R3：Host 退出 + 桥接确认 + 事后批准不得把任务拨回 running
- 声称对话式任务可用：必须有本机选中 CLI 的 hook/`updatedInput`/父子隔离记录；离线合成 hook 不够
- XML 解析 ≠ Windows 真触发；Host `--lease-probe` ≠ 模型能完成 GUI
- 不要把 09-18 的 971 项说成 09-19 修正后的全量结果
- 不要改皮肤、不要趁机重构 `App.tsx` 发送/队列、不要动用户 `_tmp_*`

Renderer 继续：`nodeIntegration: false`、`contextIsolation: true`、sandbox。FS / 进程 / 凭据 / ACP / schtasks 只在主进程。不要让模型直接改任务 JSON 或生成 `schtasks`。

---

## 9. 关键路径

```
src/main/app-controller.ts
src/main/services/automation-service.ts
src/main/services/automation-schedule.ts
src/main/services/automation-effective-profile.ts
src/main/services/desktop-tools-service.ts
src/main/services/desktop-tool-authority.ts
src/main/services/computer-use-service.ts
src/main/services/session-relay-service.ts
src/main/services/native-agent-capabilities.ts
src/main/services/agent-dashboard-service.ts
src/renderer/src/components/TaskCenterPanel.tsx
src/renderer/src/components/ExtensionsPanel.tsx
src/main/ipc.ts
native/GrokComputerHost.cs
resources/plugins/grok-desktop/skills/persistent-tasks/SKILL.md
resources/plugins/grok-computer-use/skills/computer/SKILL.md
```

---

## 10. 提示词（可直接粘贴）

```
继续 Grok Build Desktop。仓库 D:\grok zhuo\grok-build-desktop，当前 main / v0.9.6（4dc09db）已发布为 GitHub Latest。

先读 docs/GROK_TO_CODEX_HANDOFF_2026-09-20.md。那是 v0.9.6 发布后的只读审查交接，不是再做一轮功能堆叠。

不要 reset，不要再发版，不要升级 CLI，不要替换安装版，不要重跑全量测试，不要改 UI 皮肤，不要动仓库根 _tmp_*。绑定任务工作区可编辑必须保留。

优先顺序：
1. 用隔离目录验证本机实际选中 CLI 的 PreToolUse / updatedInput / 父子 Desktop MCP 隔离。不支持就明确失败并在能力展示里标明，不要降级绕过。
2. 修 R1–R4：setExecutionSession 清映射必须带 revision；绑定会话空闲后再占全局槽；Host/Worker 退出后否决桥接确认；间隔任务 P3650D。
3. 修 R5–R7：MCP 创建默认 computerEnabled=false；定时 Computer 不要在 Auto 下静默高影响；subagentType 缺失的处理以实测合同为准。
4. 文档补记 v0.9.6 已发布（工作流 35488946469），区分 971 实施全量和 58 项修正回归。

声称修好必须有对应定向测试。离线合成 hook 不能当成 CLI 合同已验收。XML 解析不能当成 Windows 已触发。
```
