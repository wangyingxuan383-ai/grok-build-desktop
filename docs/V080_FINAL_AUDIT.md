# Grok Build Desktop 0.8.0 最终再审

日期：2026-08-11
范围：当前 `codex/v0.8.0-cli-1.0-final` 工作树、全部历史实施计划、Grok Build CLI 1.0 stable、官方 main 源码快照及高频桌面工作流。

## 结论

- 在本报告列出的自动化、安装版和实机证据范围内，没有发现仍未实现的 P0/P1 源码缺口，也没有发现 0.8.0 更新引入的已知阻断性回归。
- 这不是对所有硬件、账号、Provider 和未来 CLI 的“零 Bug”数学保证。当前明确未通过的功能边界只有远程 CPA 上游返回 `403 cpa_local_only`；另外，按设计跳过的付费/外部 Provider 测试和更广泛 Windows 硬件矩阵不能被写成已验证。
- 官方公开发行版仍为 1.0.0。官方 main 相对上一快照的重要新增公共能力只有 `x.ai/session/rename` 和标题所有权元数据；Desktop 已前向适配。已安装 stable 1.0.0 尚未提供该方法，因此保留本地重命名并保持能力关闭。

## 历史规划对账

| 领域 | 结论 | 证据/处理 |
|---|---|---|
| Plan、权限、Stop、队列、并行会话 | 已覆盖 | 真实只读 Plan、Stop/Compact、双 ACP 会话实机通过；计划决定一次性回执、权限自动判定、队列持久化和终态幂等有自动化覆盖。 |
| 会话正文、失败半段回答、图片与附件恢复 | 已覆盖 | ConversationProjection V2、稳定 Block ID 合并、附件账本、媒体句柄和第二/第三次重开回归已纳入完整套件与安装版夹具。 |
| Provider、思考档位、协议转换、流式与错误 | 源码/离线覆盖；外部 CPA 受阻 | 四协议转换、增量 SSE、Schema 清理、五档证据、失败关闭和结构化 HTTP 原因已测试；当前 CPA 明确返回 `403 cpa_local_only`。 |
| Review、非 Git 改动、文件/路径/媒体 | 已覆盖 | Git 官方优先/系统回退、TurnFileChangeJournal、OpenTarget、受信任路径、视频范围读取和媒体缓存均有边界测试。 |
| 更新、回滚、诊断 | 已覆盖 | CLI 固定目标更新、跨主版本确认、运行时门禁和回滚；应用只检查正式 Release；自动检查可关闭。此次补齐 Grok Doctor 自动修复安全流程。 |
| 项目迁移、草稿、离线会话、搜索 | 已覆盖 | ProjectIdentity、隐藏/恢复、草稿首次发送迁移、投影先显、generation 隔离、项目重新绑定和本地全文搜索均已实现。 |
| Token、额度、Compact、会话信息 | 按证据展示 | 精确 Usage 才展示，缺失不估算；Compact 可继承/自定义/手动并记录事件；stable 不提供的可选 ACP 数据视图保持不可用。 |
| Computer Use、IPC、凭据、支持包 | 已覆盖 | Renderer 沙箱、集中 IPC Schema、可信路径/媒体句柄、DPAPI/主进程凭据、支持包白名单与对抗性脱敏继续有效。 |
| UI/可访问性/缩放 | 安装版夹具覆盖 | 高频 Plan/权限/停止、会话切换、右栏、Provider、更新中心和 125%–200% 缩放已通过；真实用户长工作流仍由用户验收。 |

旧版计划中仍显示的历史“延期”“待打包”“待用户验收”文字属于当时版本的事实记录，不再代表当前 0.8.0 的平行待办。实施计划的唯一未勾选项已收口为当前 CPA 外部边界。

## 本次再审发现并修复

1. **官方 Session Rename 前向能力**：增加 `x.ai/session/rename`、手动/自动标题所有权通知及本地旧 CLI 回退；同时保存脱敏 Wire Fixture。
2. **标准 ACP 标题通知元数据**：保留 `session/update` 外层 `_meta`，避免 reset-to-auto 丢失 `x.ai/titleIsManual`。
3. **Rewind 能力误报**：`cancelRewind` 不再被当成完整 Rewind；两个能力分别记录。
4. **Grok Doctor 自动修复**：只接受官方报告中的安全 ID，使用五分钟一次性预览令牌、执行前重新检查、明确确认和固定参数调用。
5. **历史计划状态**：将已经由 0.8.0 替代的旧版验收/打包复选项归档，避免把旧候选状态误认为当前功能缺漏。

## 官方上游复核

- 公开 Changelog：<https://x.ai/build/changelog>，最新公开发行仍为 1.0.0。
- 官方源码：<https://github.com/xai-org/grok-build>。
- 固定仓库提交：`b13fa526f5112c0b20dad5f1f2300d3d3b127895`。
- 固定源码修订：`a51a1dc62fe20029ac39a665985bba78edbb870f`。
- 新增公共扩展差异：`x.ai/session/rename`、`x.ai/session/update`/`x.ai/session_notification` 的 `x.ai/titleIsManual` 元数据。
- 安装版 stable 1.0.0 对 Session Rename 返回 method-not-found；因此它只是已准备好的前向兼容，不是稳定版可用声明。
- 其余 main 变化主要是 TUI、会话标题/插话和运行时内部收口，没有发现需要 Desktop 立即新增第二套 UI 或状态系统的重要公共接口。

## 验证证据

| 门禁 | 结果 |
|---|---|
| 聚焦兼容/诊断测试 | 7 个测试文件、127 项通过 |
| 上游快照检查 | 当前快照与官方 main 一致；`--validate` 通过 |
| 完整离线套件 | 101 个测试文件、733 项通过；6 个 live 文件、9 项按设计跳过 |
| TypeScript/生产构建/公开扫描/分块 | 全部通过；公开扫描 365 个文本文件，Renderer 236 个 JS 分块通过预算门禁 |
| 依赖审计/差异检查 | `npm audit` 0 漏洞；`git diff --check` 通过 |
| 当前生产构建 UI | Plan/权限四组合、Stop、双会话隔离、导航、右栏、Provider、诊断和 125%–200% 缩放通过 |
| CLI 无推理探针 | initialize/session-new 通过；Session Rename 如实返回 method-not-found，临时会话和目录已清理 |
| 既有安装版实机门禁 | CLI 1.0 更新、Resume/Close/Delete、只读 Plan、Stop、Compact、MCP、双 ACP 会话通过 |

## 保留边界

1. 远程 CPA Provider 必须由上游解除 `cpa_local_only` 后才能重新声明成功。
2. `verify:live` 中按设计跳过的付费 Provider、媒体或外部状态测试不计入离线通过数。
3. Windows 10/11、不同 GPU、DPI、杀毒软件和企业策略的完整矩阵需要独立机器/CI，不能由本机证明。
4. 未知未来 CLI 主版本继续失败关闭；官方 main Fixture 只证明解析兼容，不证明未来 stable 实机行为。
5. 用户自己的超长会话、特定 MCP 和真实工作区仍需本地候选验收。

本次再审后的源码与生产构建已经通过上述门禁。用户已在 2026-08-11 明确要求正式发布；`v0.8.0` 标签工作流将从最终提交重新生成公开资产，并在草稿回下载、SHA-256 与 Attestation 校验通过后才公开为 Latest。此前本地候选哈希仅作为预发布证据，不作为公开下载校验值。

以上边界均有明确降级或错误呈现，不存在已知的静默切回官方模型、伪造 Token/能力或吞掉正文的设计路径。
