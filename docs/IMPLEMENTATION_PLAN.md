# Grok Build Desktop 实施计划

> 本文件保存获批实施计划。每次实行前必须阅读本文件、`FEATURE_MATRIX.md`、`CLI_COMPATIBILITY.md` 与根目录 `CHANGELOG.md`。

## 完成状态（2026-07-15）

- [x] 1. 计划和项目基线
- [x] 2. 桌面骨架
- [x] 3. CLI/ACP 核心
- [x] 4. 登录和账号保险库
- [x] 5. 会话和聊天还原
- [x] 6. 工具、Diff 与模式
- [x] 7. 更新、脚本和本地交付
- [x] TypeScript 类型检查、69 项自动化测试、依赖审计
- [x] 本机 Grok CLI `initialize + session/new` 探针
- [x] 真实 Grok 4.5 对话、关闭后恢复会话、可见窗口和桌面快捷方式验收

## 0.1.1 体验修复与整体复审（2026-07-15）

- [x] 推理强度选择即应用；CLI 0.2.101 六档热切换实测，无需重启
- [x] 保留旧 CLI/默认空值的重启兼容路径，并加入失败回滚
- [x] 移除 Renderer 原生同步确认框，恢复输入框焦点并阻止重复发送
- [x] 发送后强制到底部、流式回复跟随、用户上滚保护及返回底部按钮
- [x] 文字大小与界面密度拆分；本机 70% 迁移为 100% + 紧凑
- [x] 修复普通 `turn_completed` 被误显示为运行中子 Agent
- [x] 补齐后台任务完成、退出码、输出截断和子 Agent 收敛
- [x] 合并流式事件、按需加载重组件并减少会话切换竞态
- [x] 加固 Plan Gate、Electron 导航/IPC、JSON 并发写、更新互斥与日志脱敏
- [x] 复查桌面文件：仅保留一个 `Grok Build Desktop.lnk`
- [x] 最终打包、全部自动化验证和可见窗口交互验收（2026-07-16 续审完成）

## 一、目标与已确定方案

- 应用名暂定 **Grok Build Desktop**，采用 **Electron 独立桌面窗口**，界面为简体中文。
- 视觉采用 **Codex 桌面端布局 + Grok VS Code 插件能力**：
  - 左侧：工作区、会话列表、运行状态。
  - 中间：聊天、思考、工具调用、权限与计划卡片。
  - 底部：附件、上下文用量、模型、推理强度、模式、发送/停止。
- Windows 本机源码交付，不做正式安装器；构建本地可执行程序并创建桌面快捷方式，双击后必须直接弹出可见窗口。
- Grok CLI 继续拥有模型、对话和原始会话数据；应用作为 ACP 图形客户端，不复制模型服务。参考 [Grok Build VS Code 社区插件](https://github.com/phuryn/grok-build-vscode) 的行为，并使用 [官方 ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk) 隔离标准协议与 Grok 私有扩展。
- 开始编码前，必须先将本计划原文保存到 `<repository-root>\docs\IMPLEMENTATION_PLAN.md`；根目录建立 `<repository-root>\AGENTS.md`，要求后续实行前先读计划、功能矩阵和更新日志。

## 二、首版功能边界

### 必须实现

- **登录与账号**
  - 浏览器/设备码 OAuth 登录：应用主动打开浏览器，同时在窗口中始终显示登录网址、验证码、复制和重新打开按钮。
  - 支持退出后重新登录。
  - 支持多个 OAuth 账号和 xAI API Key 配置档。
  - OAuth 凭据及 API Key 使用 Electron `safeStorage`/Windows DPAPI 加密，不保存明文。
  - 快速切号采用全局单账号：切换前停止全部 Grok 进程、保存当前凭据、原子替换目标凭据并验证；失败自动恢复原账号。
  - 所有账号共享 `%USERPROFILE%\.grok\sessions` 会话历史，不做账号间会话隔离。
  - 继承 `HTTP_PROXY`/`HTTPS_PROXY`，设置页允许手动覆盖；当前机器的 `<proxy-host>:<port>` 可直接沿用。

- **工作区与会话**
  - 选择文件夹、最近工作区、每个会话固定 `cwd`。
  - 新建、恢复、搜索、重命名、删除、清空会话。
  - 多个实时会话可在后台运行，显示工作中、等待操作、未读完成、未读错误、空闲状态。
  - 最多保留约 8 个实时进程，空闲 60 分钟回收；不得回收当前、工作中或等待用户的会话。
  - 应用退出时若有任务运行，弹出确认；退出后停止进程，历史仍可恢复，不做托盘常驻。

- **完整对话体验**
  - 用户消息、流式回答、思考状态/思考内容、停止生成、错误恢复。
  - Markdown/GFM、代码高亮与复制、表格、链接、LaTeX、Mermaid。
  - 文件拖放和选择、图片粘贴/拖放、最多 20 MiB 的常见图片格式。
  - Grok 生成的图片和视频内嵌显示，可打开原文件或复制路径。
  - Slash Command 自动补全、`/compact`、上下文 Token 用量圆环。
  - 从 CLI 恢复时还原消息、思考、工具调用、媒体和计划状态。

- **模型与执行模式**
  - 模型列表从 `session/new`/`session/load` 返回值动态获取，不硬编码当前模型。
  - 支持实时切换模型；跨 Agent 或 CLI 不支持热切换时，提示并重启后恢复同一会话。
  - 推理强度支持 CLI 已接受的 `none/minimal/low/medium/high/xhigh`；参数放在 `grok agent --reasoning-effort <值> stdio` 的正确位置。
  - 支持 Agent、Plan、自动批准三种模式。
  - CLI `0.2.101` 通过私有 `session/set_model` 元数据直接切换推理强度；仅在旧版 CLI、不支持热切换或回到空白 CLI 默认值时，才使用重启并恢复原会话的兼容路径。

- **工具、权限和计划**
  - 完整实现 ACP 必需的文件读写与终端生命周期处理。
  - 显示工具组、文件读写、命令、完整输出、退出码、失败状态和行级 Diff。
  - Agent 模式提供仅本次允许、始终允许、拒绝。
  - 自动批准模式自动响应权限请求，但仍完整显示执行记录。
  - Plan 模式在客户端额外拦截工作区写入和非只读命令；显示批准、继续规划、取消及备注输入。
  - 支持 Grok 的 `x.ai/ask_user_question`、计划退出和子 Agent 状态扩展。
  - 未识别的服务端请求记录日志并安全确认，避免 CLI 因等待响应而卡死。

- **诊断与设置**
  - CLI 路径自动发现顺序：用户配置、`%USERPROFILE%\.grok\bin\grok.exe`、`PATH`。
  - 设置模型、默认强度、默认模式、代理、思考显示、工具详情展开、字体缩放。
  - 日志查看和导出；自动脱敏 Token、API Key、刷新令牌及授权头。
  - 关于页显示应用版本、CLI 版本、渠道、更新历史和应用更新日志。

### 明确不做

- 语音输入和 xAI Speech-to-Text。
- 遥测和匿名统计。
- VS Code 专属的活动编辑器、选区、命令面板、侧栏移动。
- Codex 工作树、Git 变更面板和内置代码编辑器。
- 浏览器运行模式、正式 Windows 安装器及 macOS/Linux 构建。
- 订阅剩余额度：当前 CLI 没有可靠额度接口；只显示会话上下文 Token 用量。

## 三、技术架构与接口

- 固定技术栈：Electron `43.1.1`、React `19.2.7`、Vite `8.1.4`、TypeScript `6.0.3`、ACP SDK `1.2.1`，使用 npm 和锁文件固定全部版本。
- **Electron 主进程**
  - `GrokProcessManager`：每个实时会话一个 `grok agent stdio`，负责超时、取消、进程树清理和恢复。
  - `GrokAcpAdapter`：标准 ACP 使用官方 SDK；Grok 的 `x.ai/*` 方法在单独适配层解析，避免 CLI 更新影响 UI。
  - `TerminalService`、文件服务、权限代理和 `PlanGate`：处理命令、文件、Diff 和权限。
  - `AuthService`/`AccountVault`：加密账号、OAuth/API Key 登录、代理和原子切号。
  - `SessionCatalog`：读取 Grok 会话目录，应用只保存重命名、未读状态、最近工作区等 UI 元数据。
  - `CliUpdateService`：检查、安装、验证、回滚和写更新日志。
- **Renderer**
  - React + Zustand 管理工作区、会话、流式事件和设置。
  - 长会话使用虚拟列表；Markdown 使用安全白名单，外部链接交给系统浏览器。
  - Monaco Diff 仅用于文件变更预览；Shiki、Mermaid、KaTeX 分别处理代码、图表和公式。
- **安全边界**
  - Renderer 禁用 Node 集成，启用 `contextIsolation` 和 CSP。
  - Preload 只暴露类型化 `window.grokDesktop` API，不暴露任意文件系统或进程执行能力。
  - 核心接口包括账号、工作区、会话、权限、问题、CLI 更新、设置和日志导出。
  - 共享类型包括 `AccountProfile`、`SessionSummary`、`LiveSessionState`、`ChatEvent`、`ToolCallState`、`PermissionRequest`、`CliUpdateStatus` 和 `AppSettings`。

## 四、实施阶段

1. **计划和项目基线**
   - 将本计划落盘，建立功能矩阵、`CHANGELOG.md`、第三方声明及 CLI 兼容矩阵。
   - 记录参考基线：插件 `1.5.11`、本机 Grok CLI `0.2.101`。
   - 若复用插件代码，保留 MIT 版权与许可证；UI 不直接复制，主要复用协议行为与测试思路。
2. **桌面骨架**
   - 建立 Electron 主进程、Preload、React Renderer 和类型化 IPC。
   - 完成 Codex 风格三段布局、主题基础、工作区选择和错误边界。
   - 构建 `win-unpacked` 本地程序，验证双击能稳定弹窗。
3. **CLI/ACP 核心**
   - 实现 CLI 定位、环境和代理继承、进程管理、初始化、新建/加载会话。
   - 接入流式消息、思考、模型、模式、命令列表、取消和进程异常恢复。
   - 完整实现文件、终端、权限以及 Grok 私有请求处理。
4. **登录和账号保险库**
   - 完成设备码登录、浏览器打开及可见备用链接。
   - 登录成功必须同时验证进程退出码、`auth.json`、`grok models` 和 ACP 初始化。
   - 完成 DPAPI 加密、多账号导入、API Key 配置档、快速切换、失败回滚和日志脱敏。
5. **会话和聊天还原**
   - 完成历史索引、分页搜索、重命名、删除、恢复和实时会话池。
   - 实现流式聊天、Markdown、代码、公式、Mermaid、Token 用量、compact 和 Slash Command。
   - 增加附件、图片输入、媒体输出以及恢复后的内容重建。
6. **工具、Diff 与模式**
   - 完成工具卡片、命令输出、Monaco Diff、权限操作和用户问题卡。
   - 完成 Agent/Plan/自动批准行为，验证 Plan Gate 阻止写入与修改命令。
   - 完成模型与推理强度热切换，并保留跨 Agent/旧 CLI 的重启恢复兼容路径。
7. **更新、脚本和交付**
   - 启动时执行 `grok update --check --json`，只显示提示，不自动安装。
   - 用户更新时：确认任务状态 → 停止所有进程树 → 更新 → 验证 `initialize + session/new` → 清理探测会话 → 恢复原会话。
   - 新 CLI 验证失败时自动执行 `grok update --version <旧版本>` 并再次验证。
   - CLI 更新记录写入 `%APPDATA%\Grok Build Desktop\cli-update-history.jsonl`，并在关于页展示。
   - 提供 `bootstrap.ps1`、`update-grok.ps1`、`rebuild-app.ps1`、`verify.ps1`，桌面快捷方式直接指向本地 Electron 可执行文件。

## 五、测试与验收

- **单元测试**：CLI 参数顺序、版本解析、事件归并、会话索引、Plan Gate、路径规范化、凭据和日志脱敏、更新兼容逻辑。
- **ACP 合同测试**：假 Grok 进程覆盖初始化、新建会话、流式消息、未知请求确认和进程树清理。
- **本机真实 CLI 测试**：临时工作区 `initialize`、`session/new`、真实短消息、关闭与恢复、模型和 Token 元数据。
- **最终验收标准**
  - 双击桌面图标后出现独立窗口，无需手动开终端。
  - 登录即使没有自动打开浏览器，也能在应用中看到并复制网址和验证码。
  - 账号、会话、模型、推理强度、模式和工具权限均可从 GUI 操作。
  - 关闭并重新打开后能恢复 Grok 已保存的会话。
  - CLI 更新不会因 Windows 文件锁留下孤儿进程；不兼容版本可自动回滚。
  - 自动化测试和真实 CLI 冒烟测试通过后才标记首版完成。

## 六、默认约定

- 源码保存在 `<repository-root>`。
- Grok 数据继续使用 `%USERPROFILE%\.grok`，不迁移原有会话。
- 应用元数据保存在 `%APPDATA%\Grok Build Desktop`。
- 每个阶段完成后更新本文件的勾选状态和根目录 `CHANGELOG.md`；不得只改代码而不记录更新内容。

---

# Grok Build Desktop v0.2.0 实施计划（2026-07-16）

## 目标与基线

- [x] 实施前保存本计划并将应用版本提升到 `0.2.0`。
- [x] 记录实施基线：69 个测试、类型检查、生产构建和 v0.1.1 桌面可见冒烟均已通过。
- [x] 将扁平消息流改为 Codex 风格的按回合、多层折叠对话。
- [x] 增加项目范围 Codex 会话只读镜像，以及一键创建独立 Grok 接力会话。
- [x] 自动发现 Grok/Codex 已有工作区，支持置顶和失效路径提示。
- [x] 增加 Grok OAuth 周额度、月度账单与按量付费额度显示。
- [x] 完成草稿、输入历史、通知、最终回复复制、Markdown 导出、会话置顶和快捷键。
- [x] 清理桌面遗留文件，更新工程文件、兼容矩阵、声明与验证脚本。

## 1. Codex 风格回合与多层折叠

- [x] 引入 `ChatTurnState` / `TurnActivityGroup`，按用户请求结算回合。
- [x] 用户消息和最终回复留在执行过程外；中间助手说明、思考、文件、命令、子 Agent、其他工具归入执行过程。
- [x] 当前执行过程默认展开；`turn_completed` 后自动折叠，并汇总文件、命令、工具、子 Agent 和失败数。
- [x] 权限、提问和计划在待处理时外露，处理后折叠；完成、停止和崩溃统一结算后台工具。
- [x] 按回合虚拟化，并保持自动跟随底部和手动上滚暂停。

## 2. Codex 项目会话桥接

- [x] 侧栏分别显示可折叠的 Grok 会话与 Codex 会话，记住折叠/归档开关状态。
- [x] 只读发现当前工作区及其子目录内的 Codex 主任务；先查 `state_*.sqlite`，无记录时扫描 JSONL。
- [x] 优先通过 Grok 自带 `session_reader.py ... codex show` 读取，读取器失效时使用隔离兼容解析器。
- [x] 镜像内容只在内存读取；隐藏、刷新、删除接力副本不得修改 Codex 原文件。
- [x] “在 Grok 中继续”通过 `/resume-codex` 创建独立 Grok 会话，并用前后哈希验证只读约束。

## 3. 工作区自动发现

- [x] 合并置顶/最近工作区、Grok 历史路径和 Codex 项目路径。
- [x] 工作区菜单分组显示，空白页也能异步列出已有项目。
- [x] 支持置顶/取消置顶、缓存扫描与失效路径提示，不阻塞窗口启动和切换。

## 4. Grok OAuth 额度

- [x] 主进程并行查询 `/v1/billing?format=credits` 与 `/v1/billing`，凭据不进入 Renderer 或日志。
- [x] 使用真实 CLI 版本、架构、`x-userid`、Bearer Token 和应用代理。
- [x] 缓存五分钟，支持强制刷新、部分成功、保留上次成功数据与错误分类。
- [x] 显示周额度、重置时间、月度赠送/已用/剩余金额和按量付费上限；API Key 明确显示不支持。

## 5. 精选易用增强

- [x] 每会话草稿、`Alt+↑/↓` 最近 50 条输入历史。
- [x] 后台完成/失败 Windows 通知，点击聚焦对应会话。
- [x] 最终回复复制、会话导出 Markdown、会话置顶。
- [x] `Ctrl+N`、`Ctrl+F`、`Ctrl+L`、`Esc` 快捷键。
- [x] 明确本版不做 `@文件` 补全、消息排队、会话归档和完整命令面板。

## 6. 工程整理、更新与交付

- [x] 将桌面 `Codex.lnk.icon-backup-20260715-222541` 移至 `%USERPROFILE%\.codex\backups`，验证当前快捷方式目标和图标未变。
- [x] 新增 `.gitignore`，排除依赖、构建物、日志和临时文件；不自动创建 Git 提交。
- [x] 延迟加载重型 Markdown、Diff 和 Codex 镜像模块。
- [x] CLI 更新探测 Codex 读取器和额度适配器；可选能力失败只显示诊断，ACP 核心失败继续回滚。
- [x] 更新 `CHANGELOG.md`、功能矩阵、CLI 兼容矩阵、第三方声明和 PowerShell 脚本。

## 7. 测试与验收

- [x] 单元测试覆盖回合归并、分类、失败折叠、子 Agent 结算、工作区/Codex 发现和额度缓存/解析。
- [x] Electron/E2E 覆盖折叠、最终回复、滚动/焦点、发现、只读镜像、草稿、历史、通知、导出、快捷键和置顶。
- [x] 真实 OAuth 周/月额度查询通过。
- [x] 临时 Codex 接力创建/删除前后，原 JSONL 哈希不变。
- [x] `verify.ps1`、`win-unpacked` 重建、快捷方式刷新和双击可见窗口通过。
- [x] 桌面遗留文件已移走且桌面无多余 Grok 文件。
- [x] 仅在以上全部通过后标记 v0.2.0 完成。

---

# Grok Build Desktop v0.2.1 媒体创作与 Codex 滚动修复计划（2026-07-16）

## 目标

- [x] 修复长 Codex 只读镜像无法在窗口内向下滚动的问题。
- [x] 将 Grok CLI 官方 `/imagine` 与 `/imagine-video` 能力做成独立“创作”功能，不要求用户手写 Slash Command。
- [x] 保持生成任务、文件落盘和媒体能力由 Grok CLI 管理，应用只负责安全构造命令、展示进度和内嵌结果。

## 实现

- [x] 收紧 `main-pane`、`codex-mirror` 和 `codex-turns` 的 Grid/Flex 最小高度与滚动链，支持鼠标滚轮、触控板、拖动滚动条、Home/End/PageUp/PageDown。
- [x] 增加“创作”面板，支持图片/视频模式、提示词、图片比例，以及视频时长和分辨率说明。
- [x] 图片模式发送 ACP 公布的 `/imagine <description>`；视频优先使用 `/imagine-video`，CLI 0.2.101 未向 ACP 公布该别名时，使用已公布的 `/imagine` 技能及其 `image_to_video` 工作流。
- [x] 无活动 Grok 会话时自动在当前工作区新建会话；Codex 镜像中打开创作时创建独立 Grok 会话，不修改 Codex 原任务。
- [x] 生成后继续使用现有 ACP 媒体事件，将图片/视频内嵌显示，并保留打开原文件、复制路径。
- [x] 若 CLI 未公布相应 Slash Command，则在面板中显示兼容诊断，不发送伪造请求。

## 测试与交付

- [x] 增加媒体创作命令构造和能力识别单元测试。
- [x] 验证长 Codex 镜像可滚至最后一条内容，且顶部只读操作栏保持可见。
- [x] 运行类型检查、全部自动化测试、生产构建和 `win-unpacked` 重建。
- [x] 刷新桌面快捷方式并验证独立窗口中的滚动与创作入口。

---

# Grok Build Desktop v0.3.0：扩展中心与 Grok Computer Use 完整实施计划（2026-07-17）

## 一、研究结论与方案调整

- 官方 Computer Use 采用“获取截图/界面结构 → 模型判断 → 执行动作 → 返回新截图”的持续视觉循环，而不是简单的鼠标键盘 MCP。
- Codex Windows 版运行在当前前台桌面，采用按应用授权、敏感操作二次确认，并优先使用专用插件/MCP，只有结构化工具不足时才使用视觉控制。
- xAI 暂未公布 Grok Build 原生桌面 Computer Use，但 Grok 已支持插件、Skills、MCP、会话级 `pluginDirs` 和扩展市场；官方市场已有 Chrome DevTools 浏览器插件。
- Grok Build 开源代码已包含 MCP 图片内容传输、会话级插件目录、插件热重载和 MCP 管理扩展，因此以 clean-room 方式实现独立的 Grok 原生视觉控制 Harness。
- 本机 Codex Computer Use 插件依赖 Codex 专有宿主、`@oai/sky`、可信 REPL 和内部授权通道，不作为普通 MCP 移植或重新分发。

方案约定：

1. 不调用 OpenAI API，不需要 OpenAI/Codex 账号；推理仍全部由 Grok Build 完成。
2. 不复制 Codex 专有插件，采用 clean-room 方式实现 **Grok Computer Use（实验性）**。
3. 采用“结构化插件优先，视觉控制兜底”：浏览器优先 xAI 官方 `chrome-devtools`；有专用 MCP/插件的应用优先结构化操作；原生桌面应用、像素验证和无专用接口的场景才使用 Computer Use。
4. Computer Use 随应用内置，无需用户另行安装；默认可用但保持休眠，只有选择 `@Computer`、指定应用或明确要求视觉操作时才激活。
5. 按应用“仅本次允许／始终允许／拒绝”，高影响操作另行即时确认。
6. Computer Use 步骤、截图和结果归入现有多层“执行过程”折叠组，不设置常驻右侧预览栏。

基线为 v0.2.1、92 项测试通过。实施版本提升至 `0.3.0`。

## 二、主要实施内容

### 1. Grok 扩展中心

- [x] 新增“扩展”入口并延迟加载插件、市场、Skills、MCP、Hooks、Computer Use、Codex 兼容标签页。
- [x] 插件页支持已安装组件详情、启用、禁用、更新、卸载和重新加载。
- [x] 市场页动态调用 `grok plugin list --available --json`，展示官方及用户市场。
- [x] Skills 页显示名称、来源、说明和“在聊天中使用”；MCP 页显示服务、工具、启停、OAuth、诊断、添加和删除；Hooks 页显示来源、触发事件、所属插件启停和重载。
- [x] 当前 CLI 优先使用 `x.ai/plugins/*`、`x.ai/marketplace/*`、`x.ai/mcp/*` 和 `x.ai/commands/list` 私有 ACP 方法；旧 CLI 回退 CLI 子命令，仅重载空闲会话，运行中的扩展变更排队到回合结束。
- [x] 官方市场插件安装前确认来源和固定提交；Git/本地插件先静态读取 manifest、Skills、Hooks、MCP、命令、许可证及可执行脚本，不执行代码，确认指纹后才进入可信安装流程，禁止后台静默信任。
- [x] MCP 密钥进入 `AccountVault/safeStorage`，Grok 配置仅保存 `${GROK_DESKTOP_MCP_*}` 引用；OAuth 复用 Grok MCP OAuth 与现有浏览器/备用链接界面。

### 2. Grok Computer Use Harness

- [x] 内置 Grok 插件包含 `/computer` Skill 和完整操作规则，同时通过 `session/new`/`session/load` 的 `_meta.pluginDirs` 与进程级 `--plugin-dir` 注入；两种能力都缺失时禁用并显示诊断。
- [x] Electron 主进程使用固定版本 `@modelcontextprotocol/sdk` 启动 loopback MCP Server，仅监听 `127.0.0.1` 随机端口；每个实时会话使用独立高熵令牌和会话 ID，通过 ACP `mcpServers` 注入，不修改全局 Grok MCP 配置。
- [x] 工具响应返回文本、UI Automation 结构与 PNG 图片内容。
- [x] 新增 clean-room C# Windows x64 辅助程序 `GrokComputerHost.exe`，使用 UI Automation、Win32 `SendInput`、窗口枚举和 DPI API；截图优先 Electron `desktopCapturer` 精确 HWND 捕获，失败回退 `PrintWindow`，不引入 Electron ABI 原生 Node 插件。
- [x] 首版实现 `list_apps`、`list_windows`、`launch_app`、`activate_window`、`get_window_state`、`click`、`double_click`、`scroll`、`press_key`、`type_text`、`set_value`、`drag`、`perform_secondary_action`、`wait`。
- [x] 界面状态包含 `stateId`、窗口 ID/进程/标题/物理边界/DPI、默认最长边不超过 1600 像素的截图、裁剪 UIA 树、可交互元素和一次性 `elementId`。
- [x] `get_window_state` 已支持可选原始分辨率局部截图参数；默认全窗口截图继续限制最长边，局部原图限制为最多 200 万像素并作为第二张 MCP 图片返回。
- [x] 所有改变界面的动作必须携带最新 `stateId`；窗口、前台或界面状态过期时拒绝并要求重新观察。优先 UIA `InvokePattern`/`ValuePattern`/`ScrollPattern`，不可用时才用坐标。
- [x] 每次仅执行一个改变界面的动作，响应自动附带操作后的新状态和截图。

### 3. 使用体验

- [x] 输入区 `+` 菜单增加“控制电脑”：选择应用和精确窗口，出现 `@Computer · 应用名` 芯片；发送时转换为内置 `/computer` Skill。
- [x] 支持直接输入 `@Computer` 或位于提示词开头的精确 `@应用名`；内置 Skill 先搜索结构化工具，浏览器任务优先建议安装/调用 `chrome-devtools`。
- [x] 首次控制应用显示“仅本次允许／始终允许／拒绝”。任务开始把目标应用置前且主窗口不遮挡目标；注册紧急停止快捷键 `Ctrl+Alt+Esc`。
- [x] 返回 Grok Build Desktop 后可暂停、继续或终止。完成、停止、进程崩溃或应用退出时立即清理输入状态和辅助进程，不自动恢复未完成 GUI 操作。
- [x] Computer Use 作为单独执行分类；运行时展开步骤，完成后折叠为应用、步数和结果摘要。
- [x] 截图不写应用日志；审计只记录应用 ID、动作类型、时间和结果，不记录输入文本。截图进入 Grok CLI 会话上下文时不额外复制。

### 4. 权限模型

- [x] Plan 模式只允许列出窗口和读取截图/UI 结构，禁止点击、输入、启动和其他修改。
- [x] Agent 模式要求应用授权；自动批准模式只自动执行已授权应用的普通动作，不绕过高影响确认。
- [x] 删除数据、外发/发布/提交、金融与订阅、安装下载的软件/脚本/扩展、权限与共享/API Key、VPN/安全/隐私/密码设置、向第三方传输敏感数据必须在动作前即时确认。
- [x] 密码/验证码、CAPTCHA、UAC/管理员/Windows 安全与隐私窗口、密码修改最终确认必须交还用户手动完成。
- [x] 禁止控制 Grok Build Desktop、Codex/ChatGPT、终端模拟器、PowerShell、CMD、Windows Terminal、UAC 和安全桌面；高权限窗口和非活动桌面明确报错。

### 5. Codex 插件兼容

- [x] 只读扫描 `~/.codex/plugins`，不修改、启停或删除原插件。
- [x] 分类为可适配（纯 Skill/资源/标准 MCP）、部分适配（需环境变量或认证 MCP）、不可适配（Codex Apps、App Templates、可信 REPL、专用宿主、私有授权）。
- [x] “创建 Grok 适配副本”仅复制兼容组件到应用数据目录，记录源路径、哈希、版本、许可证和更新时间；源变化只提示刷新，由用户明确操作后以新副本替换。
- [x] Codex Computer Use 固定显示“不可直接移植”，提供“使用内置 Grok Computer Use”。

## 三、接口与数据

新增主要类型：

- `PluginSummary`、`PluginDetails`
- `MarketplaceSource`、`MarketplacePlugin`
- `McpServerSummary`、`McpDiagnostic`
- `CodexPluginCompatibility`
- `ComputerApp`、`ComputerWindow`
- `ComputerState`、`ComputerElement`
- `ComputerActionRequest`、`ComputerTaskState`
- `ComputerAppPermissionRequest`
- `ComputerRiskConfirmation`
- `ComputerUseSettings`

新增 IPC：

- `extensions.plugins.*`
- `extensions.marketplace.*`
- `extensions.skills.list/use`
- `extensions.mcp.*`
- `extensions.hooks.*`
- `extensions.codex.scan/adapt/removeAdapter`
- `computer.capability`
- `computer.listApps/listWindows`
- `computer.start/pause/resume/stop`
- `computer.respondAppPermission`
- `computer.respondRisk`
- `computer.settings.get/update`
- `computer.onStateChanged`

数据位置与安全：

- Grok 插件、市场和 MCP 继续由 `%USERPROFILE%\.grok` 管理。
- Computer Use 设置、应用允许列表、适配副本和审计元数据保存在应用数据目录。
- MCP 密钥使用 DPAPI 加密。
- 原生辅助程序和内置插件作为 Electron `extraResources` 打包。
- Renderer 保持 `nodeIntegration: false`、`contextIsolation: true`，不获得任意截图、进程或输入注入能力。

## 四、实施阶段与测试

1. **计划与基线**
   - [x] 保存本计划、更新版本，并记录当前 Grok CLI `0.2.101` 与官方源码兼容参考。
   - [x] 更新功能矩阵、CLI 兼容矩阵和 Changelog。
2. **扩展中心**
   - [x] 接入插件、市场、Skills、MCP、Hooks 私有 ACP 方法与 CLI 回退。
   - [x] 完成热重载/忙碌会话排队、信任确认、OAuth 和加密环境变量。
3. **Computer Use 可行性门槛**
   - [x] 验证 tokenized loopback MCP、进程/会话 `pluginDirs`、MCP PNG 图片结果和真实 Grok CLI 工具初始化回调。
   - [x] 24 个确定性安全流程全部通过；另以真实 Grok 模型完成一次视觉单击验证和一次高影响拒绝验证。
   - [x] Calculator 已完成截图→UIA 元素→单击→新截图/新状态闭环，并验证旧 `stateId` 被拒绝。
   - [x] 本地确定性测试页完成 24/24 闭环，并提供原始分辨率局部截图与动作哨兵。
4. **Windows Harness**
   - [x] 实现窗口/UIA/截图/DPI 映射/输入/过期保护/活动桌面保护和 x64 自检。
   - [x] 实机验证 100%（DPI 96）与 125%（DPI 120）；150%（DPI 144）和双显示器负坐标使用同一运行时坐标函数完成参数化矩阵；窗口移动、最小化/恢复均通过。验收机仅有一个物理显示器，详见验收记录。
5. **权限与界面**
   - [x] 完成应用选择、芯片、授权、风险确认、前台接管、紧急停止和执行折叠。
6. **Codex 兼容与更新**
   - [x] 完成只读扫描、安全适配副本和源哈希变更提示；CLI 更新探针增加扩展、进程/会话 `pluginDirs` 和辅助程序自检，且可选失败不触发核心 ACP 回滚。
   - [x] MCP 图片合同、辅助程序自检和确定性测试页闭环纳入仓库验证/命令行更新脚本；真实模型视觉动作保持显式 opt-in，避免 CLI 更新时产生未授权模型调用。
7. **构建交付**
   - [x] `bootstrap.ps1` 编译并自检辅助程序；`verify.ps1` 增加扩展、原生辅助程序和 Computer Use 测试。
   - [x] 重建 `win-unpacked`、刷新唯一桌面快捷方式并完成可见窗口验收。

测试门槛：

- [x] 单元测试覆盖 CLI 参数、扩展 JSON、静态预览/信任指纹、密钥引用、状态过期、截图/DPI 坐标、风险分类、禁止应用、扩展排队和日志脱敏。
- [x] ACP/MCP 合同测试覆盖鉴权、工具清单、PNG 图片结果、Computer Use 初始化与取消/清理；真实 CLI opt-in 合同验证 `/computer` 和 MCP 注入。
- [x] 暂停/恢复、授权等待、辅助程序异常结算和空闲会话扩展重载完成自动化或打包版 Electron 覆盖。
- [x] Electron E2E 覆盖扩展中心、静态安装确认、授权卡、真实风险卡、全局停止、输入焦点和 Computer 会话生命周期。
- [x] 官方 `chrome-devtools-mcp` 验收记录原状态，临时禁用/启用后恢复版本、来源、提交和启用状态。
- [x] Computer Use 完成 24 个确定性安全流程：24/24 成功，单步正确率 100%，错误窗口动作 0，高影响无确认执行 0。
- [x] 验收门槛达到后移除开发解锁要求；功能保留“实验性”标签，默认可用且休眠，仍受应用授权和逐动作高影响确认约束。

## 五、明确边界

- 首版仅支持 Windows x64 当前前台桌面，设备必须解锁。
- 不支持后台桌面、锁屏、远程控制、Windows Sandbox/VM 自动创建。
- 不控制管理员窗口、终端、Grok Build Desktop、Codex 或 ChatGPT。
- 不提供宏录制、定时 GUI 自动化或跨设备接管。
- 不复用或分发 Codex Computer Use 专有文件。
- 不增加 OpenAI API 调用或第二套模型账号。
- 不实现独立内置浏览器；网页结构化操作优先使用 xAI 官方 Chrome DevTools 插件。

# Grok Build Desktop v0.3.1：Computer Use 可见性与交互修复计划

## 一、问题复核与调整原则

- [x] 复核 v0.3.0：普通 `click` 对支持 `InvokePattern` 的控件会在后台直接调用，鼠标不移动；应用授权默认逐应用弹窗；界面只有会话内折叠卡和 `Ctrl+Alt+Esc`，缺少全局活动指示。
- [x] 复核官方资料：Codex Windows Computer Use 在当前前台桌面工作，用户应能看到鼠标移动、键入和前台接管；UAC 安全桌面不属于普通前台桌面控制。OpenAI 的 Windows 沙箱安装可通过专用受信任二进制跨越 UAC 边界，不等同于模型可点击 UAC 同意框。
- [x] 版本提升至 `0.3.1`，将普通应用控制改为默认直接可用；保留可选的“控制新应用前确认”设置和不可控制应用清单。
- [x] 高影响动作的逐动作确认继续保留，不再与普通应用授权混在一起。

## 二、可见控制体验

- [x] Computer Use 运行、暂停或等待高影响确认时，在目标显示器显示不抢焦点、鼠标穿透的蓝色发光边框与顶部状态条。
- [x] 顶部状态条显示“Grok 正在控制”、目标应用、当前动作、步骤数和“Esc 停止”；活动期间动态注册全局 `Esc`，结束后立即注销，并继续保留 `Ctrl+Alt+Esc` 备用紧急停止。
- [x] 主窗口顶部同步显示紧凑的 Computer Use 状态条，包含当前动作、步数、暂停/继续和停止按钮；截图和完整记录仍归入执行过程折叠组。
- [x] 每个观察和动作调用前先发布中文动作说明，不显示输入文本或其他敏感值；执行结束后发布结果状态。
- [x] 点击、双击、右键和拖动优先使用 UIA 定位，但实际通过系统指针与输入事件执行；移动鼠标后短暂停留，蓝色点击光标提示目标位置，避免后台 `InvokePattern` 造成“看不见点击”。

## 三、UAC 与高权限窗口

- [x] 保持 UAC、安全桌面、高权限窗口不可自动控制；检测到此类边界时暂停 Computer Use，明确提示用户手动完成 UAC/安全确认。
- [x] 用户完成后可点击“继续”重新激活和观察原目标窗口；不修改 Windows UAC 策略，不引入未签名 UIAccess 或绕过安全桌面的实现。

## 四、测试与交付

- [x] 单元测试覆盖默认无应用授权、可选授权、动作说明、活动状态判定、叠层 HTML 转义、UAC 人工接管提示和鼠标目标映射。
- [x] 原生确定性测试验证真实鼠标位置到达目标、动作仍为单步且 24/24 安全流程无回归。
- [x] 打包版 Electron 验证普通应用不弹授权框、蓝色边框/状态条出现、主窗口状态条、`Esc` 停止、暂停/继续和真实高影响确认。
- [x] 通过类型检查、全部单元测试、生产构建、真实 CLI 探针、打包版可见窗口与桌面快捷方式验收后，更新功能矩阵、兼容矩阵、验收记录和 Changelog，并标记本计划完成。

# Grok Build Desktop v0.4.x：公开发布、隐私清理与 Windows 中文适配计划

## 一、发布方案

- [x] 版本提升至 `0.4.0`，保留产品名 **Grok Build Desktop**，公开页面和关于页明确标注非官方社区客户端。
- [x] 继续使用 MIT License；只维护一套源码，公开构建使用无本机信息默认配置，本地开发差异仅进入被 Git 忽略的 `app.local.json`。
- [x] 配置 Windows 10 22H2/Windows 11 x64 和简体中文发布目标，生成 NSIS 安装 EXE、免安装 ZIP、SHA-256 和 SBOM；源码归档与构建溯源由 GitHub 标签工作流生成。
- [x] 首版不签名；应用只检查并展示 GitHub 新版本，不自动执行安装包；`v*` 标签生成 Draft Release，经人工验收后发布。

## 二、公开发布与工程

- [x] 清除源码、测试、文档和构建产物中的真实用户名、邮箱、绝对路径、代理、账号、工作区、会话和桌面验收信息。
- [x] 扩充 `.gitignore`，排除环境文件、本地配置、凭据、用户数据、证书、日志、证据、快捷方式、构建目录和生成的原生程序。
- [x] 增加公开安全扫描脚本及 Gitleaks CI；生成的 `GrokComputerHost.exe` 不进入源码仓库。
- [x] 增加公开默认配置、本地配置示例和无本机信息的 `BuildInfo`；生产构建拒绝包含本地配置。
- [x] 固定 `appId`/AUMID 为 `io.github.grokbuilddesktop.community`，配置简体中文、当前用户、可选目录、桌面/开始菜单快捷方式且保留用户数据的 NSIS 安装器。
- [x] 固定 Node.js 24 LTS 构建环境，完善 bootstrap/package/release/hash/SBOM/license 脚本。
- [x] 新增中文 README、贡献、安全、隐私、Issue/PR 模板、CI、Release、CodeQL、Dependabot 与 Artifact Attestation。
- [x] 启用 Electron Fuses、ASAR 完整性和内置插件/Computer Host 资源校验；默认验证完全离线，真实 CLI 验收移入显式脚本。

## 三、部署体验与兼容性

- [x] 实现首次运行向导：系统/DPAPI/CLI/ACP/登录/工作区/Computer Use 分步检测，CLI 缺失时提供官方安装说明和重新检测。
- [x] 实现兼容诊断中心、复制摘要和导出前可预览的脱敏支持包。
- [x] 实现 GitHub 稳定 Release 低频检查、关于页状态及外部 Release 页面；无签名版本禁止静默下载和自动执行。
- [x] 实现中文 IME、中文/空格/非系统盘路径、长路径索引、普通用户/代理逻辑、响应式窄窗口和 100% 至 200% DPI CSS；OneDrive/4K/多显示器保留外部设备矩阵验收。

## 四、v0.4.1 易用增强

- [x] 实现遵循忽略规则的异步 `@文件` 模糊搜索和附件芯片。
- [x] 对工作区外、环境、私钥和凭据类附件显示一次隐私确认。
- [x] 实现 `Ctrl+Shift+F` 当前会话内搜索、匹配计数和虚拟列表定位。
- [x] 增加单实例锁、异常恢复入口和 UI 元数据迁移前备份。

新增主要类型：`BuildInfo`、`SystemCompatibilityReport`、`OnboardingState`、`SupportBundlePreview`、`AppReleaseStatus`、`WorkspaceFileCandidate`、`AttachmentPrivacyFinding`。

新增 IPC：`app.getBuildInfo`、`onboarding.get/update/reset`、`diagnostics.run/previewSupportBundle/exportSupportBundle`、`appUpdate.check/openRelease`、`workspace.searchFiles`、`attachment.inspectPrivacy`。

## 五、测试与发布门槛

- [x] 自动化覆盖配置隔离、敏感扫描、支持包脱敏、Windows 路径、向导、更新、文件搜索、隐私提醒、IPC 和资源哈希；打包脚本额外强制 Fuses/产物扫描，IME/会话搜索由 Renderer 实现并列入发布 UI 回归。
- [ ] 在 Windows 10 22H2 与 Windows 11 x64、中文用户名、标准权限、不同 CLI/代理/路径/DPI/显示器和安装/ZIP 场景完成验收。
- [x] 本地公开源码和最终产物通过敏感信息扫描；已在干净 `npm ci` 后用一条 fail-fast 命令生成完整产物；默认验证已拆分为不触碰真实 Grok/Codex 数据的离线流程。
- [x] 首次公开仓库标签已通过 GitHub CI、Gitleaks、CodeQL、版本一致性、公开产物扫描、干净 Windows Runner 的 NSIS 安装/覆盖升级/卸载/AppData 保留、EXE/ZIP 构建溯源，并成功创建 Draft Release。
- [x] 发布负责人于 2026-07-20 明确要求公开可见的 EXE/ZIP，已将通过 CI、哈希、溯源、安装生命周期和回下载冒烟验证的 `v0.4.0` Draft 转为正式 Release；未完成的 Windows 10/多物理设备矩阵继续由上一项单独跟踪，不将发布动作冒充为该矩阵已通过。
- [x] `v0.4.1` 修复源码构建者的 PowerShell 5.1 快捷方式/冒烟脚本默认路径和发布哈希稳定性，重新生成本机包与唯一桌面快捷方式，并在标签工作流全部通过后作为最新公开 Release 发布。
