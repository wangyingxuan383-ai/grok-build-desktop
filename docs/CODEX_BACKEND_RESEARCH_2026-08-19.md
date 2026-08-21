# Codex 底层与新功能学习记录（2026-08-19）

## 范围和方法

本轮按 `grok build desktop`、`grok build vscode`、`AI coding agent desktop`、`ACP client` 等关键词做广泛粗筛，再对官方 Grok Build 的 1.0.4–1.0.5 源码和协议行为深审。第三方项目只用于比较交互、状态与兼容策略；没有复制第三方代码。`phuryn/grok-build-vscode` 使用 FSL-1.1-MIT，尤其不得复制实现。

实际查询分成四组：

1. `"grok build" desktop in:name,description,readme`
2. `"grok build" vscode in:name,description,readme`
3. `"grok cli" desktop in:name,description,readme`
4. `"ACP client" desktop agent in:name,description,readme`

每组先按 stars 排序，再按以下标准去噪：是否真的连接官方 Grok Build/ACP、近期开发表现、是否有可审计源码、许可证能否学习、是否包含 Windows/Desktop 生命周期、是否与现有能力重复。搜索命中大量 API 路由、提示词合集、排行榜和 SEO 仓库，它们不进入深学清单。Stars 只负责发现候选，不负责证明设计正确。

粗筛的高关注项目包括：

- `xai-org/grok-build`（官方、协议与运行时权威）
- `openai/codex`、`anomalyco/opencode`、`block/goose`（成熟 coding-agent 生命周期和状态边界）
- `phuryn/grok-build-vscode`、`dandandujie/Grox`
- `Jane-o-O-o-O/grok-build-desktop`、`rimusz/grok-build-desktop`、`JaydenCJ/grok-build-desktop`、`nct88/Grok-Build-Desktop`
- `vastsa/PI-Desktop`、`mits-pl/wove`

补充发现但未进入本轮实现的候选包括 `gallifre/grok-build-desktop`、`Rushour0/grok-build-desktop`、`formulahendry/vscode-acp`、`xenodium/agent-shell`、`farion1231/cc-switch`。前两者值得后续分别审计安全工作台和轻量新手流程；后几者与当前“官方 Grok CLI Windows 壳”的边界较远，暂不因为 stars 高就引入产品范围。

Stars 只用于粗筛，不作为正确性证据。功能结论必须回到官方源码、运行时声明、成功探测或已观察事件。

## 官方 1.0.4–1.0.5 的直接结论

1. **会话推理档位**：1.0.5 的 ACP session new/load 路径会消费附加元数据中的 `reasoningEffort`。Desktop 应在每次附加时传递当前会话快照，避免只靠进程启动参数或后续设置。
2. **图片读取**：1.0.4 的 CLI 内部读取已能识别图片。如果 ACP Host 宣称文本 `readTextFile`，读取可能被宿主文本接口截获。Desktop 对已经审计的 1.0.4–1.0.5 不声明该文本读取能力，让 CLI 保留图片感知；写入仍由主进程控制。
3. **Stop 与终态**：上游继续强化取消、Hook 和后台任务终态。Desktop 不增加第二套自动重试，只确保未决交互先被结算，终态保持单次所有权。
4. **后台身份**：上游任务/子 Agent ID 优先。历史或不完整回放缺 ID 时，展示层应使用确定性身份，不能每次刷新生成 UUID。
5. **配置覆盖**：1.0.5 的 `GROK_CONFIG`/`GROK_CONFIG_PATH` 有利于会话隔离，但当前 Desktop 已有 Provider、环境和受保护工作区覆盖层。未经独立威胁模型与迁移测试前不叠加第二套配置写入。

## Grox 最近两周的学习结果

按 2026-08-05 之后的提交历史审计，真正有迁移价值的不是外观，而是：

- 把 ACP 解码、权限权威、媒体生命周期、投影回放、Host Stream 和崩溃恢复逐步收回宿主层；这与本项目“Renderer 无权访问文件/进程/凭据”的边界一致，证明现有方向正确。
- 1.0.5 适配把 resume 的推理档位作为会话附加快照，而不是重选模型；本轮 Desktop 已采用相同的协议结论并独立实现。
- `GROK_CONFIG`/`GROK_CONFIG_PATH` 只展示来源和覆盖提示，不把 inline secret 送进 Renderer；此项列入后续诊断设计，不直接照搬。
- Provider profile 缺失时先恢复身份，再拆分 Provider domain/service，避免界面列表、模型路由和持久化各自猜一个 ID。Desktop 已有集中 Provider 身份，但大型 Provider Service 仍值得后续按存储、目录、扫描、网关拆分。
- 上游跟踪将“已观察版本”“待验证目标”“已验证版本”分开，避免新版本号直接覆盖验证基线；Desktop 本轮也保持 stable=1.0.5、live=1.0.3 两套证据。

## phuryn 最近变更的学习结果

- 1.0.5 实测再次确认：Host 声明文本 read 会截获图片读取；CLI 自读能返回 ACP image block。此项已落实。
- 其兼容报告指出 child 的 `available_commands_update` 可能从父连接到达但携带 child `sessionId`。Desktop 下一轮需验证事件路由，不能让子 Agent 命令目录覆盖父会话 Composer。
- 大会话 `session/load` 会回放数千事件。加载期间逐事件滚到底部会造成布局抖动，重叠 load 还可能交错。Desktop 已有投影优先、generation、回放缓冲和单次 restore，但需要补“重叠 load + 滚动锚点”专项回归，而不是另建存储。
- `session/prompt` 不适合固定总时长超时；有流量就应视为活跃。本项目当前交互 Prompt 已是无固定超时，仅保留首事件软诊断，避免重新引入 30 分钟强杀。
- MCP 真实服务可能把主要数据放在 `structuredContent` 而把 `content` 只写成简短确认。Desktop 应先捕获 Grok 1.0.5 真实 Wire，再审计 ToolCard 是否完整显示，且在序列化前做有界输出，避免大对象内存膨胀与 64 位整数二次解析失真。
- 其项目采用离线大套件和显式 live 套件分离；本项目已经使用相同验证原则，仍需把 1.0.5 live 证据与离线 Fixture 分开标注。

## 本轮采用

- 1.0.4/1.0.5 Wire Fixture 和失败关闭门禁。
- session 附加推理档位。
- 精确版本范围内的图片感知读取握手。
- ask-user 自定义文字答案。
- About CLI 更新检查的可见状态。
- 后台任务/子 Agent 稳定身份。
- mode/Stop/Usage 回归审计。

## 暂缓，等待运行时证据

- StopCancelled Hook、请求前工具改写、follow-up 新语义：先保存真实 1.0.5 Wire 证据，再决定是否增加用户入口。
- `GROK_CONFIG`/`GROK_CONFIG_PATH`：需要先证明不会与 Provider Gateway、凭据隔离和会话恢复冲突。
- 任何 1.0.6+ 行为：版本号不能启用能力，未知版本继续失败关闭。
- 本机 1.0.5 live 验证：用户未授权升级，因此 `liveVerifiedVersion` 保持 1.0.3。

## 下一轮底层实施顺序

1. **P0 事件归属**：保存脱敏 child-session 命令/任务 Fixture；所有通知按 envelope/sessionId 路由，后台子会话不得改父会话命令、模式、忙碌或 Composer。
2. **P0 大会话恢复**：补重叠 open/load、迟到 replay、快速切换、滚动锚点和失败 join 测试；复用 ConversationProjection V2 与 generation，不新增第二套历史。
3. **P1 MCP 工具结果**：捕获 1.0.5 `content`/`structuredContent`/错误形态，设计有字节硬上限、保真字符串优先的规范化层。
4. **P1 配置覆盖诊断**：只显示 `GROK_CONFIG`/`GROK_CONFIG_PATH` 是否存在、验证结果和路径来源；inline 内容、凭据不进入 Renderer/日志。
5. **P1 Provider 拆分**：在不改变 wire 的前提下将存储、身份/目录、扫描和网关生命周期拆开，先加契约测试再移动代码。
6. **P2 实机门禁**：只有用户授权才固定升级到 1.0.5；验证 image read、effort resume、自定义问题、Stop、双会话和更新回滚后，才提升 liveVerifiedVersion。
7. **独立 UI 轮**：由 Grok 重新进行真正的 UI 学习和视觉计划，不把上述底层条目算作 UI 成果。

## 明确留给 Grok 的 UI 轮

以下内容不属于本轮底层实现，也不能用协议/状态修补冒充完成：

- 重新学习 Codex、Grox 和成熟桌面 Agent 的视觉层级、布局、正文阅读宽度、字体、密度、留白与主题。
- 对话卡、Plan/权限/问题卡、空状态、右栏、弹层、侧栏和输入框的统一视觉系统。
- 多尺寸与高缩放下的视觉验收、键盘焦点和交互可发现性。
- 清理历史 CSS 覆盖和进行真正的设计令牌收口。

## 证据边界

- 聚焦自动化：4 文件、99 项通过；TypeScript 与生产构建通过。
- 本机 stable 只读检查：当前 1.0.3，可更新 1.0.5。
- 未运行 `grok update`、付费推理、媒体生成、正式打包、安装、推送或 Release。
