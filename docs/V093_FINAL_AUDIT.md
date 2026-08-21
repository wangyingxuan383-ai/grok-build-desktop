# Grok Build Desktop 0.9.3 最终审计报告

审核日期：2026-08-21  
审核基线：`codex/v0.9.1-cli-1.0.5-foundation`，0.9.3 未发布工作树  
重点：0.9.2 安装版插话/队列、子 Agent、Session Info/Usage 回归，以及同类边界问题

## 1. 结论

- 0.9.2 **不是可继续交付的基线**：它正确补上私有扩展 Wire 前导下划线，但错误地假设 queue edit/remove/reorder/interject 方法存在，直接造成用户看到的叉号报错和插话失真。
- 0.9.3 已删除该假接口依赖。未提交消息由 Desktop 持久管理；当前回合插话只走真实 `x.ai/interject`。两个能力在数据、生命周期和界面状态上不再混用。
- 子 Agent progress-only 和 `child_session_id` 形态现可显示；Session Info/Usage 经实际 CLI 1.0.3 无提示词探针确认可用。
- 完整离线门禁、TypeScript、生产构建、分块预算、依赖安全审计、C 盘隔离打包和安装版冷启动通过。6 个 live 文件/9 项仍是显式 opt-in，未用离线结果冒充付费 Provider、真实 Plan 或 Computer Use 实机证据。

## 2. 用户高频路径审核

| 路径 | 0.9.2 问题 | 0.9.3 行为 | 证据 |
|---|---|---|---|
| 忙碌时 Enter | CLI 队列和 Desktop 队列混用 | 加入所属会话的本地持久 follow-up，空闲后一次提交一条 | adapter/unit/contract/runtime tests |
| 队列叉号 | 调用不存在的 queue/remove，报 Method not found | 只撤回从未提交的本地行，提交后不再显示假撤回 | live no-prompt probe + focused tests |
| 队列编辑/排序 | 同样依赖假接口 | 本地原子更新并同步附件账本 | focused tests |
| Ctrl+Enter / 插话 | 与下一回合、Send Now 混淆 | 活动回合调用真实 `x.ai/interject`；15 秒确认；缺方法才停止并置顶下一回合 | contract + race/fallback tests |
| 插话与回合结束竞态 | 可能丢失或锁死 | 保留为可撤回下一回合；Plan/权限/问题等待时也不误调用 | new regression tests |
| 重开应用 | 已提交/未提交所有权不清 | 只续送 `queued`；`sending/accepted` 结算为中断，不自动重放 | runtime/projection tests |
| 队列图片/附件 | 撤回后可能复活成已发送气泡 | 编辑/撤回/清空/插话同步账本；queued restore 由队列栏独占 | attachment + renderer tests |
| 子 Agent | progress 只有 child_session_id 时丢弃 | progress-only 建卡，spawn/progress/finish 按 child Session 合并 | store/adapter/dashboard tests |
| Session Info/Usage | 错误显示不支持 | 传输层转换为 `_x.ai/...`；1.0.3 实际请求成功 | no-prompt probe |
| 回合完成 | 权威终态和 Prompt RPC 可能重复结算 | 稳定 turn/prompt ID，一次 Meta、一次状态、一次队列终态 | terminal contract tests |

## 3. 同类问题横向审核

- **传输与能力证据**：逻辑名转 Wire 名只证明协议命名正确；每个私有方法仍必须由声明、成功探针或观察事件单独证明。文档已删除“补下划线即可恢复所有队列方法”的错误推论。
- **子会话归属**：父会话继续隔离显式属于其他会话的模式、模型、正文和队列；官方父通道里的 child lifecycle 只生成子 Agent 展示/仪表盘记录，不污染父 Composer。
- **Usage 真实性**：Session Info 的累计 totalTokens 不再映射 Context 占用；费用仍只来自 CLI 明确 cost 字段。
- **Provider 恢复**：可读的空 `providers.json` 被视为用户真实状态，不会因旁边旧 corrupt bak 自动恢复已删除 Provider。
- **Host-exit**：无论上一回合是否已有终态，恢复非活动会话都会中断已提交队列所有权；从未提交的 queued 意图保留。
- **错误归因**：Provider 路由/认证/翻译/上游/下游阶段由独立纯函数分类，避免同类错误再次被统一写成“Internal error”。
- **安全边界**：Renderer 仍为 `nodeIntegration:false`、`contextIsolation:true`、`sandbox:true`；队列、附件、ACP、凭据和持久化均在主进程。

## 4. 门禁结果

- 聚焦：8 个测试文件、173 项通过。
- 完整：119 个测试文件；113 通过、6 个 opt-in live 跳过；844 项通过、9 项跳过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run check:chunks`：通过（大型 Monaco worker 保持独立按需分块）。
- `npm audit --audit-level=high`：0 漏洞。
- `git diff --check`：通过（仅换行格式提醒，无空白错误）。
- 正式候选：Native Host、Fuses、当前版本 UI、覆盖层、任务中心、Task Scheduler、Portable 中文/空格路径及产物公开扫描通过。
- 安装版：File/Product `0.9.3`/`0.9.3.0`；安装 ASAR 与候选 SHA-256 一致；桌面和开始菜单快捷方式目标正确；冷启动通过。
- 产物：Setup `dd21906928b2e5df4c8a222cb18466c5d4b2d0a6bdc16c5c6153d80cb01aa411`；Portable `7d310145755323896bcb55d40e1ddf822b5eec40e1f594b6ea32385c49f5f905`；SBOM `683cd142f90d9d707340af2d44f7f11f04f81c756cbb33d3433f6ca5f53349d6`；许可证 `02b5b721687c6861bb1d7c7a8119d7aae4c202698cfe4c27836ba96c449ea74b`。

## 5. 未伪造的边界

- 本机 CLI 仍为 live-verified 1.0.3；1.0.4–1.0.5 只有源码/Fixture 证据。本轮不执行 `grok update`。
- 未运行付费 Provider、真实媒体生成或真实 Plan 写入。
- 真实 Computer Use 与 Provider live 文件仍需用户显式环境开关。
- 0.9.3 已由 PR #45 合并至 `main`；标签工作流 `32496006287` 从合并提交重新构建资产，验证 SHA-256 与 GitHub Attestation 后发布为 Latest。云端 Setup/Portable SHA-256 为 `eba6523ad33f281eb0889caca481df99de7b7f04a90afe1c9d2197a25c1c2e27` / `f2f07e7713d046b26704e9ed7d3a1aca005287ceb355bdfc70a7af079dbd3718`。

## 6. 留给后续 UI 轮

- 不恢复被用户否决的 `reading.css` 或 Minimal Calm。
- 后续视觉工作只处理对话阅读层级、卡片密度、右栏和设置一致性，不再以协议修复冒充 UI 改版。
- 子 Agent 当前先提供真实数据卡和 Dashboard；更接近 Codex 的时间线样式属于独立 UI 轮，不应改写底层身份与生命周期。
