# Grok Build Desktop 0.9.0 最终审核

日期：2026-08-14  
状态：本地候选已完成源码、生产、实机契约、打包和安装门禁；等待用户验收，尚未推送或发布。

## 1. 高频使用路径

| 路径 | 结论 | 证据/边界 |
|---|---|---|
| 启动与窗口恢复 | 已实现 | 原子保存窗口 bounds/maximized；失效坐标回退到可见显示器。 |
| 登录与账号 | 保留既有单浏览器所有者和凭据隔离 | 本轮未改变认证协议；安装版诊断通过，账号交互留给用户验收且不破坏现有凭据。 |
| 新任务与历史会话 | 已实现 | 草稿优先、投影先显示、后台 ACP 确定性合并、失败时保留本地正文。 |
| 官方/自定义模型 | 已实现 | 目录由 ACP 更新；Provider 本地 ID 不被上游别名替换；当前暂时缺失模型不自动切换。 |
| Agent/Auto/Plan | 已实现 | Agent 询问；Auto/Plan 选择 CLI allow 选项。Plan 决定、Stop 与终态均有回归覆盖。 |
| 队列/插话/并行会话 | 已实现 | 队列持久化、CLI ID 合并和后台会话隔离沿用 0.8.x 门禁；两个真实 ACP 会话并行启动通过，具体交互顺序留给用户验收。 |
| 额度与 Usage | 本轮重建 | 官方 credits/currentPeriod；不再伪造月额度。live 契约只保存字段/周期成功状态。 |
| Compact | 已实现 | 继承 CLI 或按会话 60%–95%，支持手动、开始/完成/失败/取消及真实 Token（有返回时）。 |
| 文件/Review/重绑定 | 已实现 | Git 与非 Git 分离；Rewind 只回退对话；路径变化可离线查看或事务重绑定。 |
| 图片/视频 | 能力检测已修复 | CLI 1.0.3 工具证据已确认；真实生成仍由服务能力/账号决定，失败必须显示结构化原因。 |
| 更新与诊断 | 已实现 | 应用只检查 Release；CLI 固定目标手动更新；`du` 与显式 trace 可用。 |

## 2. 0.9.0 计划对账

- CLI 1.0.3：版本范围、Fixture、stable 更新、未知版本失败关闭和 `--no-auto-update` 已完成。
- Rewind：1.0.1+ 对话语义已完成；文件恢复不冒充官方 Rewind。
- 额度：`x.ai/billing` / credits、一个 current period、PAYG/预付/滚动限制/档位/自动充值分离已完成。
- 权限：显式 `readOnly` 元数据消费完成；不按名称猜测。
- 模型：动态目录、未来新模型、当前缺失模型和 Provider 身份测试已保留。
- 后台工作：关闭前 task teardown 与 subagent cancel 已完成。
- 诊断：`du` 与高敏 trace 分离完成。
- 媒体：1–15 秒、4:3/3:4、实际工具证据已完成；未宣称服务端一定允许视频/ZDR。
- 架构/性能：主进程功能仍由独立服务承载，Renderer 大型工作台/Monaco/Markdown/Mermaid 均懒加载。`App.tsx` 与 Controller 仍偏大，但本轮不再引入第二套状态、会话或 Provider 实现；后续拆分必须保持行为不变，不能作为 0.9.0 假完成项。

## 3. 官方 Grok Build 与 Grox 增量

- 官方 stable、crate 和本机均为 1.0.3。公开接口中本轮应跟进的 billing、Rewind、模型更新、任务 teardown、媒体工具注册、`du`/trace 已映射。
- Grox `8981a5a` 的长工具不中断和终态忙碌原则，本项目已有无固定总时长、空闲监控、终态单结算与后台迟到隔离。
- Grox `57bc84d` 的草稿优先、项目去重、投影恢复、过程折叠和非阻塞首屏，本项目已有对应实现；没有复制其 Tauri 单体。
- Grox `0577a36` 窗口恢复、`8deeca2` 未跟踪文件、`74c911f/90dd185` 上游快照隔离已映射。
- Grox 一键应用回滚未复制：本项目应用更新明确只打开签名/哈希可核对的 GitHub Release，CLI 更新已有精确回滚。这是产品边界，不是假按钮缺口。

## 4. 尚不能宣称的事项

- 0.9.0 已作为本地安装候选交付，但用户验收前不能宣称已公开发布。
- Provider、图片、视频和账号额度的真实结果仍受用户上游/服务策略影响；能力检测成功不等于生成请求必然成功。
- 6 个 live 测试文件/9 项不会在普通离线 `npm test` 自动执行；本轮已补 CLI/额度/媒体、Provider 回环、Plan 和双 ACP 并行证据，真实当前 Provider、媒体生成与 Computer Use 动作仍以用户环境和服务能力为准。
- 应用未引入静默自动安装；这是已锁定的安全更新策略。

## 5. 当前证据

- `npm test`：104 个文件、759 项通过；6 个文件/9 项显式 live 跳过。
- TypeScript、生产构建、公开扫描、Renderer 分块、当前 UI、Fuses、ASAR 与零漏洞依赖审计：通过。
- CLI：`1.0.3 (1a29d5bc12)`；stable 检查无更新。
- live credits 契约：读取成功，当前周期类型为服务端返回的 weekly；未保存凭据或余额。
- live 媒体能力探针：读取到 `bundled:imagine` 及真实图片/视频工具；未执行付费生成。
- live 官方 Plan：Grok 4.6 只读工作区回合提交/取消完成，无权限卡、无文件写入；当前默认 CPA 的 `403 cpa_local_only` 被隔离为 Provider 边界。
- 双 ACP：两个并行进程返回不同 Session ID。
- 安装版：File `0.9.0` / Product `0.9.0.0`，About、诊断、支持包隐私、Fuses、桌面/开始菜单快捷方式通过。
- Setup SHA-256：`d24391d79fa565adf08dbcdb68cb0ce3ee6f58b8cb535a580f43ada0227e4359`。
- Portable SHA-256：`85aac34d177a646e247a13ceacb48289f46aaf48d7dcebf4dbb5a6db5887f2b4`。
