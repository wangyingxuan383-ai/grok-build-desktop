# Grok Build Desktop 实施计划

> 本文件保存获批实施计划。每次实行前必须阅读本文件、`FEATURE_MATRIX.md`、`CLI_COMPATIBILITY.md` 与根目录 `CHANGELOG.md`。

## v0.6.3 稳定热修 → v0.6.4 UI/提供商重构（2026-07-23）

### A. 隔离复现

- [x] 建立任务乱码、非 Git Review、长会话、Dashboard/文件/任务中心往返和 850 文件变更夹具；全部使用隔离 AppData，不发送模型请求。

### B. v0.6.3 稳定热修

- [x] Scheduler 输出改为 Buffer 解码并新增结构化注册诊断；识别历史替换字符，健康检查可覆盖损坏旧文本。
- [x] 引入统一会话目标打开流程、固定会话网格、ResizeObserver/导航完成刷新和所有工作台“返回会话”；删除重复底部环境栏。
- [x] 非 Git Review 改为普通能力空状态；修复窄窗可点击但不可见；聚焦测试、TypeScript、构建和公开扫描通过。
- [x] 拒绝首个暴露 720 px 输入框越界的候选；修复后正式生成并 per-user 安装 0.6.3，冷启动/版本/快捷方式和安装版导航夹具通过。

### C. v0.6.4 右栏与审核

- [x] 右栏统一为按需工具容器，提供真实 Review、计划/结果、最近文件和侧边任务；宽度按工具持久化，窄窗为覆盖抽屉。
- [x] Review 拆分为轻量 `GitReviewIndex` 和按选中文件加载的 `GitReviewFileDetail`；保留五类范围、快照校验、文件/区块操作与行级批注。
- [x] 左栏移除常驻文件/Review；最近文件先只读预览，只有显式“编辑文件”才进入 Monaco。
- [x] 离线 UI 夹具通过 Dashboard→会话→最近文件→编辑器→会话→任务中心→会话、非 Git Review、850 文件索引及多尺寸/缩放验收。

### D. v0.6.4 提供商中心

- [x] 设置和账号页统一进入独立提供商管理弹窗；列表/搜索/详情、五类预设、健康/默认状态和删除/编辑流程已实现。
- [x] 新增草稿探测与模型发现 IPC；保存前可测试、获取/刷新/搜索/多选导入或手工补充模型，本地 ID 可编辑且冲突使用稳定哈希。
- [x] 模型列表探测只执行主进程 GET；限制超时、2 MiB 响应和重定向，支持 OpenAI/Responses、Anthropic、Ollama 与兼容网关，凭据不写日志。
- [x] 本地回环测试覆盖三种列表结构、401、超时、超量响应、重复模型和未知上下文；Provider UI 离线夹具通过。

### E. 最终交付

- [x] 源码、lockfile 和显示版本提升为 0.6.4；Changelog、实施计划、功能矩阵、Codex 对照矩阵和 CLI 兼容说明已进入候选状态。
- [x] 唯一一次完整离线套件通过：60 个文件通过、1 个按设计跳过，291 项通过、2 项显式 opt-in/live 跳过；加入安装版版本探针后的最终公开源码扫描通过 243 个文本文件。
- [x] 唯一一次正式 0.6.4 打包通过 Electron Fuses、源码/产物扫描并生成 Setup、Portable、SHA-256、SBOM 和许可证报告；0.6.0–0.6.3 命名资产全部保留。
- [x] `win-unpacked` 夹具通过后完成 per-user 安装；文件/Product/Main/About 为 0.6.4，诊断为“可以使用”，桌面/开始菜单快捷方式指向安装目录，安装版 0.6.4 UI 夹具通过。
- [x] 正式发布 PR 的 Hosted Windows `%TEMP%` 8.3 路径暴露长短路径比较问题；统一 canonical path 边界后，Editor、Memory、Agent/Persona、Git 四组 27 项测试在普通与显式短路径临时目录下均通过，符号链接/目录联接逃逸继续拒绝。
- [x] 正式发布安全门禁发现新公布的 `@hono/node-server` 路径穿越与 `fast-uri` 主机混淆公告；固定到已修复版本后 `npm audit` 为 0，TypeScript 与完整 291 项离线测试继续通过，等待 Hosted Windows 复核后合并发布。

### v0.6.4 最终候选说明

- 未发送付费提示词；提供商 UI 验收没有点击真实网络探测，服务测试只访问本地回环假端点。
- 最终哈希：Setup `be0080e4ce0d44528840fa6923e469b26407327d246bbf140e6f761bd76a8ca5`；Portable `1d6104e3ffdad4ae1cc5ca7c80f5352a3e8c63d7e72cb69df55bbc16837480c6`；SBOM `feb7207c0ed97e931fa31a54090658a5ba3aea701fb9af41add6f12817532b67`；许可证 `fb8469bdbecff72100bd94c44b2f67f1b596ade9854d95ce862a7559d3b1d82e`。

## v0.6.2：Codex 深度对齐与审核工作流重构（2026-07-22）

- [x] 将对齐基准修正为 Codex 的按需 Review 工作流；Review 支持 Unstaged、Staged、Commit、Branch、Last turn 五类范围，不再把 0.6.1 自造通用摘要栏视为 Codex 对齐。
- [x] 新增主进程 `GitReviewScope`、快照、文件、区块、行与区块操作契约；Patch 在主进程解析，区块操作重新校验快照并通过固定 Git 参数与 stdin 执行，恢复要求明确确认。
- [x] Renderer 新增 380–620 px 可调 ReviewPane：文件状态/统计、紧凑 unified diff、文件/区块暂存与取消暂存、恢复、完整 Diff、显式编辑入口和行级批注草稿。
- [x] 引入 `NavigationIntent`，工具卡、Review 文件/行和编辑器统一使用会话/Worktree 实际执行根目录；主进程继续执行路径边界校验，Monaco 挂载后同步定位行。
- [x] 新回合发出并持久化真实开始、完成、单调时钟耗时和完成/失败/取消状态；重复完成合并，旧会话无可靠时间时仅显示“已处理”。连续孤立过程合并成一个“历史执行记录（N 段）”。
- [x] 文件写入按回合聚合并可打开 Last turn Review；最终回答保留复制与真实分叉入口，生成媒体移到结果区并支持大图。
- [x] 左栏删除常驻的文件/Git/Worktree 列表，统一放入默认折叠的“开发工具”；当前项目任务展开，其他项目只显示折叠头并在选择后按需加载。
- [x] 工作区选择器增加标题、搜索、显式关闭、Escape、外部点击关闭、焦点返回与受限滚动区；标题栏改为任务菜单、打开位置和 Review 开关，并移除重复底部面板开关。
- [x] 设置改为约 920×680 的分类对话框，覆盖常规、外观、模型与会话、项目与 Git、Worktree 与 Memory、Agent、账号与提供商、Computer Use、更新与诊断及已归档会话；背景参数实时预览。
- [x] 删除与设置遮罩无关的固定 72% 主色覆盖；背景 opacity、blur、dim 一一映射，dim=0 时不再额外压暗，只由消息、过程、Review 和输入框局部表面保证可读性。
- [x] 0.6.2 离线夹具扩展到 30 段旧过程、真实耗时、文件修改、生成图片、多图消息、失败恢复和 Review 入口。
- [x] 运行受影响测试、生产构建、公开源码扫描和 Grok 应用 Computer Use 多尺寸/键盘/背景/Review 验收：9 个受影响文件 / 48 项测试、TypeScript、生产构建和最终 238 文件源码扫描通过；隔离离线窗口实测 Review Diff、文件跳转、设置 Escape、背景 100%/0 遮罩、历史 30 段折叠和图片重开。
- [x] 最终完整离线套件一次通过（60 个文件通过、1 个按设计跳过；284 项通过、2 项跳过）；唯一一次正式打包生成并核验 0.6.2 Setup、Portable、SHA-256、SBOM和许可证报告，Fuses及两次产物扫描通过，0.6.1 命名资产保留。
- [x] 完成 per-user 安装和冷启动；文件/Main/About 为 0.6.2、诊断为“可以使用”，桌面/开始菜单快捷方式指向安装目录；安装版图片消息发送失败保留/重开、Review、背景、设置和响应式夹具通过。

### v0.6.2 最终候选说明

- 正式打包只执行一次，并在同一构建的 `win-unpacked` 与安装版上运行 0.6.2 离线夹具。未调用付费模型；夹具中的发送失败是刻意验证图片失败保留链路。
- 最终 0.6.2 哈希：Setup `8a2d7508296ee5846bb589c01ce4fa64a2194cd40a1ae5ba6d96a733432ca8d7`；Portable `9aa7251857c2c33044354ee8c51ade36f9d18409946a16f47d8d1a11d7532f83`；SBOM `e00f6eb90a5fd33ac0aebb953283fb59d924c339d4bede8467305deddfe4d714`；许可证 `e5e4edd9035f514d7b111bd3417db46ce86f3f51396b11b05fb8db1d677ecdff`。

## v0.6.1：Codex UI 深度对齐与图片消息修复（2026-07-22）

- [x] 以只读 Computer Use 和可访问树采样完成 Codex 桌面基准审计；将脱敏结构、交互、响应式断点和 Grok 功能映射记录到 `docs/CODEX_UI_PARITY.md`，不提交 Codex 截图、账号、任务标题、绝对路径或会话正文。
- [x] 左侧栏改为产品/搜索/新任务、直接导航、可折叠项目工具、项目会话和固定账号/版本/设置；会话悬停将置顶、归档与必要更多菜单分层。
- [x] 标题栏增加左侧栏、任务历史、打开位置、右侧摘要和底部面板开关；新增约 320 px 摘要栏、真实 Git/Worktree 底部环境栏和变更面板，小于 1200 px 自动收起摘要。
- [x] 会话正文收敛为约 760 px；用户消息增加复制、图片网格/文件卡/大图、发送状态与失败恢复，处理过程和文件修改保持折叠，最终回答仅提供真实支持的操作。
- [x] 输入框统一粘贴缩略图、附件、上下文、模型、强度、模式、排队、插话、停止与发送状态；继续支持自定义会话背景，并以稳定遮罩和独立消息/输入底色保证可读性。
- [x] 新增 `clientMessageId`、`UserMessageAttachmentPreview`、发送状态、队列附件和恢复事件；Renderer 按客户端消息合并 ACP 回显，不再随输入框清空图片。
- [x] 主进程将内嵌图片写入按会话哈希隔离的缓存，验证 PNG/JPEG/WebP/GIF 内容、MIME 和 20 MiB 上限；图片不重复写入提示文字，缺失源显示降级卡，删除会话和孤立/超量扫描会清理缓存。
- [x] 支持包明确排除附件正文、Base64、缓存文件和完整路径；Renderer 继续使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- [x] 单元/集成测试已覆盖附件持久化、MIME/大小/路径边界、ACP 重复回显、纯图片、失败状态、恢复与支持包排除；离线 0.6.1 UI 夹具覆盖导航、摘要、环境栏、消息卡、粘贴前预览、发送失败后消息可见、大图、重载和窄窗口。
- [x] TypeScript、受影响的 5 个测试文件 / 28 项测试、生产构建、228 文件公开扫描和一次 Computer Use 主界面/摘要/底部面板/大图验收通过，未发送付费模型提示词。
- [x] 最终完整离线套件通过 270 项、2 项显式在线用例跳过；Windows 集成测试限制为 4 个 Worker、20 秒用例超时以避免 Git/ACP 子进程争用。生成 Setup、Portable、SHA-256、SBOM 和许可证报告，Electron Fuses、4K/覆盖层、Task Scheduler、中文空格 Portable 与两次流式产物公开扫描通过；0.6.0 命名资产及原哈希保持不变。
- [x] 已执行 per-user 安装并从 `%LOCALAPPDATA%\Programs\Grok Build Desktop` 冷启动；主进程、About 和诊断均报告 0.6.1，诊断结果为“可以使用”。安装版离线夹具通过粘贴图片→发送失败仍在消息中可见→Renderer 重开仍可见；桌面和开始菜单快捷方式均指向安装目录。最终哈希见 Changelog 与 `release\SHA256SUMS.txt`。

### v0.6.1 最终候选说明

- 首次完整套件预检暴露 5 秒 Memory 测试框架超时；第二次在本会话异常 `TEMP` 与高并发下出现临时 Git/ACP 子进程失败。修正测试运行器资源上限并使用规范用户临时目录后，最终成功套件为 57 个文件通过、1 个文件按设计跳过，270 项通过、2 项跳过。
- 第一个打包输出在 0.6.1 UI 重载探针中发现启动时孤立缓存扫描与夹具图片写入存在竞态；该输出未交付。将扫描改为在 `bootstrap` 返回前完成后，TypeScript 与 3 个相关文件/23 项测试通过，随后重新生成并只保留当前最终 0.6.1 资产。
- 发布资产扫描由整文件双编码解码改为分块 UTF-8/UTF-16 扫描，规则不变；在低提交内存环境中仍完成最终 229 个源码文本文件及整个 `release` 目录检查。
- 最终 0.6.1 哈希：Setup `dfc9d2a3feb62a4ac49d7fe76bf9bd07e3cf8289f2966a0fd85837a06a4043ba`；Portable `553bc500f3f8da69406fea56798c3c2b5b6317db272a0e154d192a8332982316`；SBOM `fafef7cc7197b6f0dc4a7de4c6260725487c825623f94ba67e32ffdf9f45dbbb`；许可证 `5a82814c8a9a7147c245f09b3d992e7923fd5550d1fe3617df8f969a82acacc2`。

## v0.5.16：公开发布证据回写（2026-07-22）

- [x] 确认 `main`、`origin/main` 与 `v0.5.16` 均指向提交 `e4dfb62d38de2505c8c8920d4e9f0ae70577f2b6`；当前源码版本为 `0.5.16`。
- [x] 确认 GitHub Release `v0.5.16` 已于 2026-07-21 公开并标记为 Latest，Release Workflow `29846404781` 在同一提交上成功完成。
- [x] 确认公开资产包含 Setup、Portable、SHA-256、CycloneDX SBOM 和第三方许可证；GitHub 资产摘要记录 Setup 为 `8f7ec0af2d6dda7cb75878f5e544d538eed394ef49b6920f901b1d4afede539f`，Portable 为 `a94cf86c973688f47d6565fd66590f3d8250b4b7c997ed5b379b5a505360fcf1`。
- [x] 将功能矩阵、CLI 兼容矩阵和 Changelog 从“本地 v0.5.16 / Latest v0.5.12”的历史状态统一到公开稳定版 `v0.5.16`；未重复完整测试、打包或真实模型验收。

## v0.5.14：持久任务 OAuth 同步修复（2026-07-21）

- [x] 确认 DPAPI 修复后任务已成功解密并进入 Grok，会话失败点转为 `Authentication required`。
- [x] 只比较账号 ID、过期时间和不可逆哈希，确认受影响任务固定账号与当前规范 `auth.json` 为同一账号，但保险库中的 refresh token 已被 CLI 后续刷新轮换。
- [x] Worker 启动前按账号身份选择更新的规范 OAuth 凭据并同步加密保险库；不把 Token、任务指令或认证头写入日志和 Renderer。
- [x] Worker 完成后的新凭据通过比较后原子回写；若其他 Grok 进程已并发刷新，则保留更晚的规范凭据，禁止旧 Worker 覆盖。
- [x] 将历史 `Authentication required` 转换为中文恢复说明。
- [x] 仅运行 TypeScript 和 4 个相关测试文件 / 26 项测试；完成一次本地目录版重建和可见窗口启动，不重复完整 Release 矩阵，也不自动执行用户任务。

## v0.5.13：持久任务 DPAPI 与任务表单修复（2026-07-21）

- [x] 复核失败记录并确认任务密文未损坏：无窗口 Worker 曾把 Chromium `sessionData` 指向临时目录，因而无法打开 GUI 创建密文时使用的 `safeStorage` Local State 密钥。
- [x] 在 Electron ready 前把规范目录的 Chromium `Local State` 复制到 Worker 的隔离 `sessionData`，复用正确的加密密钥且避免与正在运行的 GUI 共享活动 Profile；退出时清理临时目录。
- [x] 捕获后续 DPAPI 解密异常并返回不含任务内容的中文恢复说明；旧英文失败记录在界面中转换为中文说明。
- [x] 将三个零散复选框重构为对齐的选项卡片，加入标题、说明、悬停态和窄窗口单列布局。
- [x] 仅执行本次改动需要的门槛：TypeScript、3 个相关测试文件 / 14 项测试、一次 `win-unpacked` 重建、一次打包任务表单 CDP 探针和一次可见窗口启动；不重复已经通过的完整 Release/安装生命周期/Computer Use 矩阵。
- [x] 使用现有受影响任务完成只解密不执行的 DPAPI 探针，成功得到非空指令且未输出指令内容、未调用模型；原任务及历史记录均保留。
- [x] 刷新唯一桌面快捷方式到本地 `v0.5.13`，冷启动窗口可见。本轮未创建 Git 标签或 GitHub Release。

## v0.5.0–v0.5.12：稳定性、提供商、自动化与正式发布（2026-07-20）

> 以 v0.4.2 本地候选为基线；全部本地门槛通过后才允许推送标签，GitHub Draft 产物回下载验收通过后才公开 Release。`v0.5.0`–`v0.5.3` 的云端任务均在创建 Draft 前暴露 Hosted Runner 专属的 CDP、虚拟 GPU 与离线 Skills 契约问题；遵守标签/产物不可静默替换约定，发布修复版本依次提升；后续运行逐步隔离扩展中心、复合 Renderer、任务中心系统数据和 Hosted Windows 虚拟图形无法执行重型模态点击的边界，`v0.5.10` 又证明图形进程退出后同一 Runner 的计划任务 Electron 入口可能无法启动；`v0.5.11` 进一步确认 Hosted Runner 不提供可靠的交互令牌计划任务唤醒；当前最终候选为 `v0.5.12`。

- [x] 审查 v0.4.2 工作树并记录基线：TypeScript 通过，34 个测试文件 / 167 项测试通过，2 项 live 测试按设计跳过。
- [x] 使用独立 Overlay Portal 修复全窗口背景下所有根级弹层的定位、层级、焦点和滚动锁定；布局回归及打包 CDP 探针覆盖整个窗口背景组合。
- [x] 实现 Grok CLI 共享配置的安全自定义提供商、环境变量凭据、原子 TOML 修改、验证与回滚；本地三协议假服务和 CLI 隔离配置探针通过。
- [x] 实现 Windows Task Scheduler 持久自动化、无窗口 Worker、加密任务、并发锁、通知和注册修复；单元测试覆盖 XML/计划/锁/确认，发布探针验证真实计划任务唤醒。
- [x] 实现服务端权威消息队列/插话、会话分叉、回退、应用级归档和统一任务中心；假 Grok 合同测试对齐当前官方扩展线格式。
- [x] 完成离线测试、live 验收、公开安全扫描、安装版/Portable 打包、中文路径冷启动与桌面快捷方式验收。最终复审同时补齐提供商完整事务回滚、原子并发槽位、固定弹层焦点陷阱、通知唤醒、自动化终态收件箱去重及 DPAPI 解密失败结算；37 个测试文件 / 193 项通过，2 项显式 live 测试按设计跳过，24/24 Computer Use 确定性流程通过。
- [x] 推送 `v0.5.0` 源码和标签，确认 main CI、Gitleaks 与 CodeQL 全绿；首次 Release Run `29745906101` 在已完成打包和首次内容冒烟后因 CDP `Input.dispatchKeyEvent` 在 Hosted Runner 无返回而触发 60 分钟超时，未创建 Draft/资产。
- [x] 将 CDP 请求改为 15 秒显式超时，并用当前焦点元素上的冒泡键盘事件覆盖添加面板、Escape 和焦点陷阱交互；修复后的完整 UI 探针已在本机打包程序通过。
- [x] `v0.5.1` Run `29751461174` 在五分钟内确认第二个根因：Hosted Runner 虚拟 GPU 在模拟 3840×2160 后不再响应 CDP；仍未创建 Draft/资产。保留本机真实 4K 路径，GitHub 无物理 4K 桌面的 Runner 改测 1920×1080，分支探针已用 `GITHUB_ACTIONS=true` 本机复现通过。
- [x] `v0.5.2` Run `29752880805` 确认第三次打开面板时仍反复向无 CLI 的隔离环境请求 Skills。修正 `GROK_DESKTOP_OFFLINE_SMOKE=1` 契约为直接返回空 Skills 并增加“不调用 CLI/插件索引”回归测试；该标签仍未创建 Draft/资产。
- [x] `v0.5.3` Run `29754367995` 的离线日志已无 CLI/IPC 异常，但虚拟桌面的第二个 Electron 实例仍停止响应。GitHub Actions 冒烟实例增加 `--disable-gpu`，正常用户构建不变；探针加入逐阶段日志，Hosted Runner 分支在本机复现通过。该标签仍未创建 Draft/资产。
- [x] `v0.5.4` Run `29755908468` 通过构建、测试、打包和基础内容冒烟，并由阶段日志把最后一个阻塞定位为扩展中心默认插件页在无 Grok CLI 的 Hosted Runner 上触发插件清单发现；仍在创建 Draft 前停止，无资产。
- [x] `v0.5.5` Run `29757936690` 通过版本、测试、构建、打包和基础内容冒烟；长流程在任务弹层阶段停止响应，仍未创建 Draft/资产。复审发现懒加载扩展的 Suspense 占位替换后没有重新建立模态焦点，并确认 Hosted Runner 不适合把视口、主题与全部重型面板压在同一 Renderer 实例。
- [x] `v0.5.6` Run `29759987661` 已通过复合 UI 流程，但新鲜任务中心 Renderer 在并行读取账号保险库、提供商环境、自动化与收件箱时令 Hosted Runner 的 CDP 主通道停止响应；仍在 Draft 创建前失败，无资产。
- [x] `v0.5.7` Run `29761524715` 通过版本、测试、构建、基础内容和主 UI 流程；新鲜任务面板已挂载，但六个并发 IPC 读取仍使 Hosted Runner 的 Renderer/CDP 通道停止响应。运行在 Draft 创建前失败，无资产。
- [x] `v0.5.8` Run `29763323880` 通过版本、测试、构建、基础内容和主 UI 流程；第三个全新 Electron 实例在任务面板尚未打开、第一次 DOM 查询前即停止响应，确认剩余问题为 Hosted Runner 连续 CDP 进程资源失效。运行在 Draft 创建前失败，无资产。
- [x] `v0.5.9` Run `29764592507` 的唯一云端 Electron 进程成功渲染完整壳层，但点击任务入口后虚拟图形/CDP 通道停止；相同交互在本机硬件、软件渲染、4K 和独立进程全部通过。运行在 Draft 创建前失败，无资产。
- [x] `v0.5.10` Run `29765941455` 已通过版本、195 项测试、构建、打包、Fuses 和唯一 Hosted Renderer 的壳层/入口检查；随后 Task Scheduler 探针在 60 秒内未获得无窗口 marker，运行仍在 Draft 创建前失败，无资产。
- [x] `v0.5.11` Run `29767638527` 在任何 GUI 启动前仍无法由 Hosted Runner 的 `InteractiveToken` 计划任务唤醒探针，证明这是云端环境边界；运行在 Draft 创建前失败，无资产。
- [x] 发布 `v0.5.12`：Run `29768359376` 成功生成 Setup/Portable、Fuses/公开扫描、SBOM、许可证和两份 Attestation；Draft 回下载后的四项 SHA-256 与构建溯源已在本机独立验证，随后于 2026-07-21 公开为 Latest。下载工作流仅因 Windows PowerShell 5.1 解析 UTF-8 中文错误文本失败，已改为 ASCII 并直接完成剩余确定性验证，未重新打包或创建标签。

### v0.5.0–v0.5.12 本地发布候选证据

- 本机兼容探针：Grok CLI `0.2.106 (bde89716f6)`；`initialize`、`session/new`、`/imagine`、注入 `/computer`、实时 `low` 强度切换和隔离自定义模型 TOML 均通过，未发送付费提示词。
- 打包版：内容感知冷启动、全窗口背景/弹层/焦点、`--open-task-center`、Windows Task Scheduler 无窗口唤醒、中文空格路径 Portable、Electron Fuses、NSIS 首装/覆盖升级/卸载保留 AppData 均通过。
- 最终本地发布哈希：
  - Setup EXE：`22ce1a48eba2c23a3fe183829e52d5e4783686bba2df862a351651b981d35694`
  - Portable ZIP：`75544fb82a435f08cc0da026193cf017871b834daf35ee736f065a1941c798f4`
  - CycloneDX SBOM：`88a7cf6ce2e54e553883da704bdf15aa28ac5ffbde173c7e9b81192b70778476`
  - 第三方许可证：`d7e2b822db8393918c63b259ef91f462e8eefe7e031b9756defd7d2cdef943d7`
- `v0.5.1` 修复重建再次通过 193 项离线测试、四组打包窗口/CDP 探针、真实 Task Scheduler 唤醒、中文空格 Portable、Fuses、公开产物扫描和 NSIS 首装/覆盖/卸载；本机产物哈希（云端可复现构建因 BuildInfo 不同会另行生成并以 Release 清单为准）：
  - Setup EXE：`fea8ee8ad911952a80fecc7aff124567252364109f3500ddd74579aa18154d22`
  - Portable ZIP：`082c287e25dbb59599a31c0c6e46575fcf1c259b98c64b9c420dc9929e105af2`
  - CycloneDX SBOM：`77bc7315ef7b1547496d56eefbbba8c62e46b9155b8a23d4a41cb8b703fb3071`
  - 第三方许可证：`4d8b2c1e89264b23808fed43ac1bd11d67c65787e76d8b7510fad79ee4cb7450`
- `v0.5.2` 本机最终重建保持完整 3840×2160 探针并通过同一套门槛；另以 Hosted Runner 分支的 1920×1080 探针复测通过。本机哈希：
  - Setup EXE：`45a4a2159744f30c54b358e5951cdd553b775c041a8b63cb31faa4099aaa412d`
  - Portable ZIP：`9480e0ca110e36a1d8331e716edead0ca99c15bd690aed1390f06d12aeb08321`
  - CycloneDX SBOM：`c84e7932f67f94623529f0315c042492811e00b11a78646281c0d4d2d43547ec`
  - 第三方许可证：`7b29d635ab5569d9e6a816f8c6eedc9383e1140e4d2247d7d48d4d9042a327f2`
- `v0.5.3` 增加离线 Skills 契约回归后共 194 项离线测试通过，并再次通过完整 4K 本机探针、Task Scheduler、Portable、Fuses、产物扫描和 NSIS 生命周期。本机哈希：
  - Setup EXE：`2f372f457223e8485745a85c55c7061faf4ee0909fa2588e1f97529bf466f55c`
  - Portable ZIP：`b48e4970ee16b9ff964b8d9b8653928f45bcfcabb99a33546d0359d04760e716`
  - CycloneDX SBOM：`76fda131c2137981744271cc860e047b32e0b3e6d9241d44a991a91913e63262`
  - 第三方许可证：`454d8334f8d75615a25832b7767cadaf096c4383314ef2c8a275d78b679e2a62`
- `v0.5.4` 增加 Hosted Runner GPU 隔离和阶段诊断后，再次通过 194 项测试、完整本机 4K/GPU 探针、Hosted Runner 参数分支、Task Scheduler、Portable、Fuses、扫描与 NSIS 生命周期。本机哈希：
  - Setup EXE：`c85efe0a27a2a4ea19fe98efc969cbfa51070a4a4487ff6bc446cd27a6eb9811`
  - Portable ZIP：`db60b4899b3d15fbaac35dc1d937b8ad6076f55393367a08d031b2de85b06aa9`
  - CycloneDX SBOM：`d69711635765874e88f69ec13900137ac35d2088146055fff0ff6958d4a42f3f`
  - 第三方许可证：`0edeb3fa72eb6a11b0ce37ca191f972438495ca23489707bee5de96f299f3cc6`
- `v0.5.5` 将离线契约扩展到扩展中心默认插件清单，并给任务、扩展、媒体弹层分别标注探针阶段；194 项测试、类型检查、公开扫描、完整 4K/GPU 与 Hosted Runner 参数分支、真实 Task Scheduler、中文空格 Portable、Fuses 和 NSIS 首装/覆盖/卸载再次通过。本机哈希：
  - Setup EXE：`ee0a0901063cd76d3199e6fc57d676c23588288a97c3504d646e972fb5067a6d`
  - Portable ZIP：`2ded2468f6ead4fd3e26f9335525d51dc3e0a9649e058aa404709e4611230649`
  - CycloneDX SBOM：`5c45358ef6a12761b5b6c987543d09dac0469271e41d75f63a7250741421e8c3`
  - 第三方许可证：`a5b703ccdc91385a34bfd40e3bb61e5ae4ce2913ea6fcf7cd2efd728eb36f303`
- `v0.5.6` 修复 Suspense 占位替换后的模态焦点，并将 Hosted Runner 的任务/扩展/媒体检查拆成三个新鲜 Renderer；194 项测试、完整本机 4K 长流程、Hosted Runner 分层流程、Task Scheduler、Portable、Fuses、扫描及 NSIS 生命周期全部通过。本机哈希：
  - Setup EXE：`a40acbd1b2474bf8c43aab9181ae0ab040b97cf5832582db30391c8aca75c661`
  - Portable ZIP：`b9c414725bbac4ac840a0ebca9e6b95ad8d14fb3fdc65312d04724db1e362d26`
  - CycloneDX SBOM：`e38a4172ce7a69e542666f9ac05d1aae94e4a573ba845580a86af2ff1fc5100d`
  - 第三方许可证：`1ef09e9eb6159ad8d95c83c7a51a01290d68c59d2b3965c8389c192cb8faa906`
- `v0.5.7` 将离线任务中心全部系统数据源改成确定性空数据/默认策略；194 项测试、完整本机 4K 长流程、Hosted Runner 分层流程、Task Scheduler、Portable、Fuses、扫描及 NSIS 生命周期全部通过。本机哈希：
  - Setup EXE：`50e139fbaa39c1e7b8a8005ee5b7f85d81ab509663667da961c74c4fedd6537b`
  - Portable ZIP：`178793972ad73234d8a78f8a89d4dfdde02d9cb5251aff5e3126700e1c3c2fca`
  - CycloneDX SBOM：`34d1126e4ffb4f47f4c1e823d7af23b8bb6dd2e8dba6c25a021187d3cd8f3ab2`
  - 第三方许可证：`aafd7dddb9c97f30afb472957d3f118e83e509e9ccec82a31daa1fd9b091a8ff`
- `v0.5.8` 将任务中心六项系统读取改为顺序快照并在首帧直接建立焦点；195 项测试、完整本机 4K 长流程、精确 Hosted Runner 分层流程、Task Scheduler、中文空格 Portable、Fuses、公开扫描和 NSIS 生命周期全部通过。本机哈希：
  - Setup EXE：`d2324924ad57190b5d680dd3ce728c604ec65b274708297a79921eefbb13bf60`
  - Portable ZIP：`2721b47926a7005042cd9c6d22e4d9e0642ce23022b8ca233d0667e21546dbc4`
  - CycloneDX SBOM：`5eb0b522de8ad93f12ad357329c013f12e79441cc553d99a8ffe1856dc935e1f`
  - 第三方许可证：`447db5672edce97d77857b0bded73172145c26800b2be4c3948c5870228ecab8`
- `v0.5.9` 将 Hosted Runner 的连续 GUI/CDP 验收合并到一个新鲜 Renderer；195 项测试、完整本机 4K/独立进程压力流程、精确 Hosted 单进程流程、Task Scheduler、中文空格 Portable、Fuses、公开扫描和 NSIS 生命周期全部通过。本机哈希：
  - Setup EXE：`ab291137f7a91ba7942ddd289021ca891412857489b904f7e2acf29b6c035746`
  - Portable ZIP：`de9e2d45f6027b5bab5e291816cc60d1f5c1430afb607e7d8fd4e349427792ce`
  - CycloneDX SBOM：`74f62ecc721f602e11a7e0104b8adc5d9c934d9b1b8c286f81b050ada0ca2f13`
  - 第三方许可证：`0e373b97d4ea3aab61e1f5621e0baf004f7a6577ade12e0d696da9119eb393fa`
- `v0.5.10` 明确拆分本机重型弹层验收与 Hosted 壳层/入口验收；195 项测试、完整本机 4K/独立进程弹层流程、精确 Hosted 壳层入口流程、Task Scheduler、中文空格 Portable、Fuses、公开扫描和 NSIS 生命周期全部通过。本机哈希：
  - Setup EXE：`40ffc4ae4dad6fced0c478b7d1d62637dada755fae0c6b330bd8c4465dd1b584`
  - Portable ZIP：`33cfaec76a753011ac1f73f3add3a8cd0880d101535bcdd84335da893c3e1659`
  - CycloneDX SBOM：`42da3884225589fc587b51819706f18634d3a13059801764f119fa8222fbdb2a`
  - 第三方许可证：`9ecfd01636e3bba364f8e96813f984741bb6987cb290010beeedc1121f0c1f02`
- `v0.5.11` 将云端无窗口 Task Scheduler 验收放在唯一 Renderer 之前，构建 Runner 仅对 Portable 做中文空格路径结构验证，真实下载 Portable UI 留给全新回测 Runner；195 项测试、完整本机 4K/独立进程弹层、真实 Task Scheduler、中文空格 Portable、精确 Hosted 顺序、Fuses、公开扫描和 NSIS 生命周期均通过。本机哈希：
  - Setup EXE：`ffcd077f99c51e4cc10e2d358012cc77e44e763efe9297600ad3c51a4c9fa920`
  - Portable ZIP：`6d10f9f4caf40ec9d0187aec36f0ea2ff826ec935cf7b30f38c11c5f857595f4`
  - CycloneDX SBOM：`bfa5314ad6bd40af7b36729f09da30d616d013d0ad21f5d122abd9522ae2b3d1`
  - 第三方许可证：`4724744a28e7cd0ee44a62c3871da2688579cacddb3432166cc61fd4a2a2d0e7`
- `v0.5.12` 公开 Release（云端产物）：
  - 工作流：`https://github.com/wangyingxuan383-ai/grok-build-desktop/actions/runs/29768359376`
  - Release：`https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/tag/v0.5.12`
  - Setup EXE：`fc16c81e9b1d58e9423d6944084593434318449d57dce040625eb21caa2e92e9`
  - Portable ZIP：`9e4e83f922def7c1f3feb2aec4bbc99be74b1d48d340f0372c8b5f93b82643a3`
  - CycloneDX SBOM：`e7e66ec83b04827928b81783cd455a2afc81b6004ee0d6e6cddaeb45968976ce`
  - 第三方许可证：`72336e6005c8a82a57929855c197a5e8a06700201564eba76545a81386515de1`

### 固定实现约定

- 提供商支持 Chat Completions、Responses、Anthropic Messages；应用只管理带标记的 `~/.grok/config.toml` 区块，外部模型只读。
- 提供商密钥默认存入 Windows 当前用户环境变量 `GROK_DESKTOP_PROVIDER_<ID>_KEY`，也可引用已有变量；密钥不得进入 Renderer、CLI 配置、argv、日志或支持包。
- 持久任务支持一次、每日、每周和最短一分钟固定间隔；默认 Grok 4.5、CLI 默认强度、自动批准普通动作、Computer Use 关闭。
- 任务固定创建时的账号/提供商/模型；引用缺失时进入“需要配置”，不静默回退。高影响动作继续逐次确认。
- `/loop` 作为会话级临时任务显示；应用关闭后执行由当前用户、最低权限的 Windows Task Scheduler 提供。
- 活动回合中 Enter 排队、Ctrl+Enter 插话、Shift+Enter 换行；队列以 `x.ai/queue/changed` 为权威。
- 本版不加入完整 Git/工作树、内置编辑器/终端/浏览器/SSH、Memory 管理和媒体库。

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

# Grok Build Desktop v0.6.0：Git、编辑器与 Grok 原生生产力工作台（2026-07-22）

> 本节是下一会话的当前获批实施计划，完整替换此前提出的 v0.5.17 收口方案与早期 v0.6.0 草案。实施前先读 `docs/NEXT_SESSION_HANDOFF.md`，再按本节分阶段执行。不得在本地候选验收前创建标签或发布 GitHub Release。

## 一、目标与固定决策

- [x] 增加轻量 Monaco 编辑器和常用完整 Git 面板。
- [x] 增加 Grok 原生 Worktree 隔离工作区、跨会话 Memory 中心、Agent/Persona 管理、Agent Dashboard 以及会话执行配置档。
- [x] Memory 默认关闭，由每个工作区单独启用；Worktree 支持预览后的“一键安全合并”；执行配置档支持全局和项目两级，项目配置保存在 AppData，不自动写入仓库。
- [x] “自动批准”继续自动批准普通工具；账号、提供商、模型或工作区失效时严格暂停，不静默替换。健康检查不发送任务提示词；提示词已被 CLI 接收后不自动重跑整轮。
- [x] 本版不实现语言服务器、调试器、内置终端、SSH、Force Push、Rebase、Cherry-pick、Stash、Tag、GitHub PR/Issue、`--check`、best-of-n 或 JSON Schema 自动化。

## 二、工作台、编辑器与 Git

### 1. 工作台结构

- [x] 新增“对话、文件、源代码管理、Worktree、Agent Dashboard、任务、扩展”活动栏；中央区域在聊天、多标签编辑器、Diff、Dashboard 和 Memory 编辑之间切换。
- [x] 使用 Computer Use 只读观察当前 Codex 桌面的信息架构后，完成可用性重构：单列项目/任务侧栏、带文字的工作台切换菜单、紧凑上下文标题栏、居中内容区、悬浮输入框、克制空状态和单一会话溢出菜单；保留全部 v0.6 工作台入口而不复制 Codex 资产。
- [x] 切换对话/文件视图时保留编辑器标签、光标、未保存缓冲区、会话草稿和聊天滚动状态；窄窗口继续自动隐藏辅助侧栏，编辑与保存保留在中央区域。Dashboard/Memory 视图随对应模块实现。
- [x] 将新增工作台按 Editor、Git、Worktree、Memory、Agents、Dashboard、Profiles 拆为独立主进程服务与 Renderer 组件，保持现有 IPC 和磁盘格式兼容；聊天编排仍由既有 App/Controller/ACP 核心负责。
  - [x] 已固定 `docs/V060_ARCHITECTURE.md` 模块所有权、IPC 命名、能力三态语义和分阶段拆分顺序；首个 `CliCapabilityService` 已从主控制器独立实现。

### 2. 轻量编辑器

- [x] 实现懒加载文件树、多标签、编辑/原子保存、新建文件或目录、重命名、删除、资源管理器定位、Monaco 内置查找替换/跳转行、语法高亮、脏状态和关闭确认。
- [x] 支持 UTF-8、UTF-8 BOM、GB18030 及 CRLF/LF 保持；5 MiB 以内可编辑，5–20 MiB 只读，更大文件转外部打开。
- [x] 所有路径在主进程规范化并通过 `realpath` 验证；拒绝目录穿越和符号链接越界。默认隐藏 `.git`、`node_modules`、构建目录和忽略文件，并提供显示开关。
- [x] 保存前比较哈希与修改时间；外部修改或 Grok 写入与未保存缓冲区冲突时提供磁盘 Diff、重新加载、覆盖和另存副本，不允许静默覆盖。
- [x] 支持“添加文件到对话、添加选中代码到对话、让 Grok 解释、让 Grok 修改”；引用包含工作区相对路径和行号，文件内容仍由 Grok 在发送后按路径读取。
- [x] 工具卡路径与 Diff 可打开编辑器并定位；没有脏缓冲区时自动刷新 Grok 写入，有脏缓冲区时显示冲突。

### 3. Git 面板

- [x] 主进程只用固定参数数组调用系统 `git.exe`，不经过 Shell；支持仓库根目录、分支、上游、领先/落后状态和凭据已脱敏的远程信息。
- [x] 显示未跟踪、已修改、已删除、冲突和已暂存分组；支持工作区/暂存区 Diff，单文件、批量和全部暂存/取消暂存。
- [x] 支持提交、最近提交历史、提交详情、创建/切换分支、Pull、Push、刷新和取消最长五分钟的网络操作；认证继续交给 Git Credential Manager。
- [x] 支持经文件清单确认后丢弃已跟踪修改或删除未跟踪文件；冲突文件在编辑器中解决，暂存后标记已解决。
- [x] 工作区位于仓库子目录时，只读状态可直接查看；首次修改整个仓库前显示真实仓库范围并保存一次性信任决定。
- [x] 切换分支前处理未保存编辑器内容；支持包、日志和通知不得包含源码、Diff、提交信息、完整路径或含凭据远程地址。

## 三、Grok 原生能力

### 1. Worktree

- [x] 优先调用 `x.ai/git/worktree/create|list|apply|remove|gc` 与状态通知，缺失时使用受控 Git 兼容层；能力缺失仅禁用相关入口。
- [x] 新建会话和会话分叉可选择普通工作区或 Worktree，并指定名称与基础分支/提交；Worktree 会话使用独立来源分组。
- [x] Worktree 面板显示路径、分支、基础 Ref、来源会话、变更数量、关联 Agent 和状态；支持在文件、Git或会话视图打开。
- [x] 安全应用流程固定为：检查目标工作区干净 → 预览提交/文件/增删行 → 用户确认 → 官方 apply 或普通 merge → 验证结果。发生冲突立即停止，不删除 Worktree、不丢弃目标修改，并进入编辑器解决。
- [x] 成功后提供“合并后清理 Worktree”复选框，默认不勾选；清理前再次确认无未应用修改。支持只读 GC 预览后清理孤儿/过期 Worktree。
- [x] 同一远程仓库的主工作区和 Worktree 使用 Grok 原生仓库身份共享项目 Memory。

### 2. 跨会话 Memory 中心

- [x] 使用 Grok 原生 Memory 布局及 `/remember`、`/memory`、`/flush`、`/dream`、`grok memory clear`；Memory 默认关闭，工作区启用状态进入应用元数据，不自动改用户全局 `config.toml`。
  - [x] `MemoryService` 已精确复现 `org/repo` 归一化、ASCII slug 与 BLAKE3 `hash8` 布局；默认关闭和工作区设置只写 AppData，清理使用固定参数 `grok memory clear --workspace|--global|--all --yes`。确认后的“记住”通过当前活动 ACP 会话发送原生 `/remember`；离线候选未重复付费模型改写。
- [x] 新会话通过 `--experimental-memory` 或 `GROK_MEMORY=1` 启用；现有会话优先使用原生热切换，旧 CLI 回退为受控重启/恢复。
  - [x] 新建/恢复进程按规范仓库身份注入 `GROK_MEMORY=1|0` 并关闭 Memory 调试日志；启用中的会话走受控重启恢复，禁用优先使用已发布的 `/memory off`，缺失命令时同样受控恢复。进程环境合并和恢复状态机已有聚焦测试；真实付费会话热切换尚未重复执行。
- [x] 分组显示全局 Memory、当前仓库 Memory 和会话摘要；支持浏览、搜索、筛选、Monaco 编辑全局/项目 `MEMORY.md`、原子保存、外部冲突检查及单个会话摘要删除。
- [x] 提供保存前预览的原生 `/remember`、精确删除条目、清空工作区/全局/全部、当前会话 Flush、手动 Dream，以及会话结束 Flush 和自动 Dream 配置。
  - [x] 已实现确认令牌“记住”、原生 ACP `/remember`、结构化条目精确删除及哈希冲突保护、单个会话摘要删除、CLI 清空、当前会话 `/flush`/`/dream` 与设置元数据；正常会话结束按配置执行 Flush/自动 Dream，受控重启和 CLI 更新暂停不触发结束策略。
- [x] 显示启用状态、索引状态、最近 Flush/Dream 时间；Dream 的运行状态必须可见。Memory 内容与路径不得进入日志、通知、支持包或公共构建。
- [x] 所有 Memory 读写必须被限制在解析后的 `GROK_HOME/memory`；CLI 布局无法识别时只禁用管理面板，不影响聊天。

### 3. Agent 与 Persona 中心

- [x] Agent 来源包含内置、用户级、项目级和插件；内置/插件只读，用户/项目 Agent 可创建、复制、编辑、启停、重命名、删除和校验。
- [x] Agent 编辑器支持 `.grok/agents/*.md` 与用户目录同格式，覆盖名称、说明、模型、推理强度、提示模式、权限模式、工具、Skills、`agents_md` 与正文指令，并提供原始 Markdown 预览。
- [x] Persona 来源包含内置、用户级和项目级；支持说明、指令、指令文件、模型、强度、默认能力、默认隔离、输入/输出契约和原始 TOML 编辑。
- [x] 内置 Agent/Persona 可复制为用户或项目副本；应用创建的 Persona 使用独立 TOML 文件，不修改用户现有 `config.toml`。外部文件编辑必须保留注释和未知字段。
- [x] 保存使用临时文件、原子替换和持久备份，并运行 `grok inspect --json` 验证；失败恢复原文件。服务保留可选热重载入口；当前 CLI `0.2.106` 未公布定义热重载能力时只重启空闲会话，运行中/等待操作的会话保持不动并延后加载。

### 4. Agent Dashboard

- [x] 不启动 Grok TUI Dashboard；复用 ACP 任务扩展、会话目录和子 Agent 事件构建桌面原生层级视图。
- [x] 显示主会话、子 Agent、父子关系、Agent/Persona、模型、强度、状态、运行时间、工具数、上下文、普通/Worktree隔离、最近动作、等待/失败原因和完成摘要。
- [x] 支持打开父/子会话、展开执行过程、停止运行 Agent、跳转 Worktree、打开定义、按工作区/状态/Agent/时间筛选，以及清理仅 UI 记录。
- [x] CLI 缺少实时扩展时降级为标明更新时间的只读历史，不伪造“运行中”。

### 5. 会话执行配置档

- [x] 配置档包含名称、说明、Agent、模型、强度、模式、工具允许/禁止、Sandbox、网页搜索、子 Agent、Memory、Worktree与基础 Ref、最大轮次、追加规则、可用 Persona 和子 Agent 默认隔离。
- [x] 全局配置保存在 AppData；项目配置同样保存在 AppData 并绑定规范仓库身份，同名项目配置覆盖全局，不自动修改仓库。
- [x] 内置“普通开发、只读审查、自动修改、Worktree隔离开发、研究与探索”预设；新会话、分叉和持久任务均可选择配置档。
- [x] 配置档必须解析为 Grok 原生进程参数、运行 Agent 定义和 `session/new._meta`；当前 ACP 未公布的 `maxTurns` 明确禁用并拒绝启动，Persona 白名单/子 Agent 隔离显示降级映射，不静默忽略。

## 四、接口与安全边界

- [x] 新增 `WorkspaceTreeNode`、`EditorDocument`、`EditorSaveConflict`、`GitRepositoryStatus`、`GitFileChange`、`GitBranchSummary`、`GrokWorktreeSummary`、`WorktreeApplyPreview`、`MemoryScope`、`MemoryEntry`、`MemorySettings`、`AgentDefinition`、`PersonaDefinition`、`AgentDashboardNode`、`SessionExecutionProfile`、`CliCapabilitySnapshot`、`AutomationHealthReport`。
- [x] 新增类型化 IPC：`editor.*`、`workspace.tree.*`、`git.*`、`worktree.*`、`memory.*`、`agents.*`、`personas.*`、`dashboard.*`、`profiles.*`、`automations.checkHealth/repair`、`diagnostics.getCliCapabilities`。
  - [x] 首批 `diagnostics.getCliCapabilities` 已通过现有受信任 Frame 校验链和最小 Preload API 接入；其他命名空间随对应服务实现。
  - [x] `workspace.tree.*` 与 `editor.*` 已接入同一受信任 IPC/Preload 边界；所有实际路径与写操作仍由主进程服务复核。
  - [x] `git.*`、`worktree.*` 与 `memory.*` 已接入同一发送者验证链；Renderer 只持有展示/编辑状态，文件、Git、进程和 Memory 操作均留在主进程。
  - [x] `agents.*` 与 `personas.*` 已接入同一发送者验证链；路径归属、只读来源、名称、语法、哈希冲突、临时文件、备份、inspect 与回滚均由主进程复核。
- [x] 文件、Git、Memory、Agent/Persona 配置、进程和凭据全部保留在主进程；Renderer 继续 `nodeIntegration: false`、`contextIsolation: true`、sandbox、发送者验证和最小化 Preload API。
  - [x] Agent/Persona 文件发现、解析、写入、启停、重命名、删除、备份、CLI 校验和会话恢复均已留在主进程；Renderer 只持有目录展示与未保存文本。
- [ ] CLI 初始化后按版本缓存 ACP核心、队列/插话、分叉/回退、Git/Worktree、Memory、Agent、插件/MCP、媒体、Codex读取器、额度和Computer能力；缺失功能提前禁用，核心 `initialize/session/new` 失败才触发CLI回滚。
  - [x] 首阶段能力快照已按 CLI 版本缓存 `--help`、Worktree/Memory 子命令帮助和 `inspect --json` 的非付费证据，私有 ACP 方法保持 `unknown`；成功创建/打开会话会叠加 ACP 核心运行时证据。
- [x] 任务健康检查可自动修复计划任务注册、当前可执行路径和已不存在的会话映射；固定账号、提供商、模型、工作区与已删除配置档失效时进入“需要配置”，且检查不解密或发送提示词。

## 五、测试与发布门槛

- [x] 编辑器测试覆盖编码/换行、原子保存、外部冲突、路径越界、大文件、标签/光标恢复、脏状态和等价的外部/Grok并发写入冲突。
- [x] Git 使用临时仓库和本地 bare remote 覆盖状态、Diff、暂存、提交、分支、Pull/Push、取消、冲突、丢弃确认及脱敏；6 项聚焦测试未触碰用户真实仓库或真实 GitHub。
- [x] Worktree覆盖创建、恢复、来源映射、Diff、Apply、冲突、保留、删除、GC和共享Memory；失败时目标与Worktree均不得丢失。
  - [x] 4 项临时仓库聚焦测试已覆盖 Git 兼容层的创建/恢复/来源元数据、预览 Diff、Apply、冲突停止与双端保留、脏状态拒绝、删除、官方清单优先和 GC；Memory 测试另验证同一远程的主目录、子目录、独立克隆和 Worktree 使用完全相同的原生身份与目录键。
- [x] Memory覆盖默认关闭、工作区启停、浏览/编辑/清空、Flush、Dream、路径约束、冲突和支持包排除。
  - [x] 7 项隔离 `GROK_HOME` 测试覆盖原生身份/BLAKE3、默认关闭、设置/进程环境、分组浏览搜索、原子编辑/冲突、原生记住预览、结构化精确删除、会话删除、符号链接越界、固定清空参数和 Flush/Dream 状态；进程/ACP测试覆盖原生会话命令和结束策略，诊断测试验证支持包显式排除 Memory。付费模型改写未重复执行。
- [x] Agent/Persona覆盖来源优先级、内置只读、Markdown/TOML往返、未知字段保持、契约、`grok inspect`回滚和热重载降级。
  - [x] 6 项主进程服务测试、2 项 Renderer 原文补丁测试和 1 项进程管理增量测试覆盖来源/遮蔽、插件只读、结构字段、CRLF/YAML 列表、TOML 契约、外部哈希冲突、复制/启停/重命名/删除、持久备份、inspect 失败回滚、目录链接越界、可选热重载及仅空闲会话重启；隔离 Electron/CDP 探针验证 typed IPC、Agent/Persona 切换、结构化字段、Monaco 原文和未知字段保持。
- [x] Dashboard/配置档覆盖父子生命周期、Worktree跳转、停止、全局/项目覆盖、能力降级及参数/ACP元数据转换。
- [x] 集成流程固定为：创建Worktree配置档 → 启动会话映射 → 文件修改同步编辑器/Git → 查看Dashboard → 保存并恢复项目Memory → 预览并Apply → 人工制造冲突验证停止 → 解决并清理 → 验证自动批准参数只出现一次。临时仓库集成测试通过且不发送付费提示词。
- [ ] 验证 `v0.5.16 → v0.6.0` 覆盖升级，保留DPAPI账号、任务、专属会话、Codex接力、计划任务注册和AppData；覆盖Windows 10 22H2、Windows 11 23H2/24H2、中文用户名、标准权限、安装/Portable、100–200%DPI及双屏。
- [x] 遵循“开发只跑受影响测试、候选只跑一次完整离线套件、只生成一次正式候选包、未改Computer执行层不重复24项或付费验收”的测试纪律。完整套件一次执行得到262项通过、2项显式跳过和1项测试框架超时；仅调整该用例超时后聚焦Memory文件7/7通过，未重复完整套件；正式候选包只生成一次。
- [x] 候选后界面重构只运行受影响门槛：TypeScript、生产构建、4个Renderer文件/8项聚焦测试及 Computer Use 本地源码版验收；已检查空状态、工作台菜单、文件工具栏、会话操作菜单/点击外部关闭和自定义背景可读性，未发送提示词、未重复完整套件、未重新打包。
- [x] 本地版本已提升至`0.6.0`，矩阵/兼容文档/Changelog已更新；唯一候选打包生成无签名Setup、Portable、SHA-256、SBOM和许可证报告，并通过Fuses、产物公开扫描、打包壳层、Profiles/Dashboard/启动选择器/任务健康UI及中文空格路径Portable验收。
- [ ] 仅在上项Windows外部设备/覆盖升级矩阵完成并获得明确发布指令后创建标签、上传GitHub Release和构建溯源；失败不得覆盖已有标签或资产。

---

# Grok Build Desktop v0.5.15：任务可用性与自动批准修复（2026-07-21）

## 修复清单

- [x] 复现当前 CLI `x.ai/rewind/points` 返回 `Method not found`；将私有回退能力改为可选探测，打开面板只显示空状态，不再触发全局错误提示。
- [x] 分叉/回退操作错误改为面板内联提示，避免可选能力问题污染全局恢复通知。
- [x] 将“自动批准”定义为最终执行权限：即使旧任务保存了 `agent`/`read-only` 二级策略，Worker 也直接允许 ACP 工具请求，不再创建待确认项。
- [x] 自动批准会话中的 Computer Use 不再请求可选应用授权或推断风险确认；Plan/Agent、不可控制应用、密码/验证码/CAPTCHA及 UAC/安全桌面限制不变。
- [x] 任务编辑器在自动批准模式下强制有效权限为自动，禁用二级权限选择器并明确显示“无限制”。
- [x] 将持久任务 `session/prompt` 超时提升至 23 小时；普通交互会话仍保持原超时。
- [x] 增加纯策略测试、Computer Use 自动模式测试、ACP 缺失回退方法合同测试及打包版实时任务探针。

## 验收记录

- [x] 类型检查、生产构建和 34 项定向测试通过。
- [x] v0.5.15 `win-unpacked` 使用当前 OAuth 账号创建并运行一次真实临时任务：以自动批准模式读取工作区 `package.json`，约 40 秒后状态为 `completed`，返回真实可恢复会话且未等待权限。
- [x] 实际 Worker 结束后任务锁和全局槽位均释放；验收任务与临时会话已清理。
- [x] 在该真实会话上探测回退能力得到空数组，Renderer 未出现全局错误提示；打包版任务编辑器确认自动批准时二级权限选择器被禁用。
- [x] 本修复仅更新本地候选版和唯一桌面快捷方式，不创建标签、不上传 GitHub Release。

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
- [x] `v0.4.2` 修复 Windows 包内 `loadFile` 因禁用 file-protocol privilege Fuse 返回 `ERR_FILE_NOT_FOUND` 的永久黑屏；保留 ASAR/沙箱/CSP/IPC 等边界，并将窗口冒烟升级为必须检测 `.app-shell` 和非空正文。已撤回黑屏的 `v0.4.0/v0.4.1` Release，只有内容级验证通过后才重新发布。
# Grok Build Desktop v0.4.2：本地修复、交互重构与主题系统计划（2026-07-20）

> 本节为当前获批实施计划。全部改动先在本地完成、测试和重建，不创建标签、不上传 Release、不修改现有 GitHub Draft。

## 实施清单

- [x] 完成打包 Renderer 黑屏修复、可见启动失败页和隔离用户目录内容冒烟测试。
- [x] 清理旧发布产物，生成仅属于当前版本的哈希、SBOM和许可证清单，移除脚本版本硬编码。
- [x] 将输入框“+”重构为 Codex 风格的大型 Portal 添加面板，包含文件、图片、文件夹、工作区文件、Computer Use和已启用 Skills。
- [x] 将 Computer Use 改为单次消息能力芯片，发送前不枚举窗口或启动控制。
- [x] 新增文件夹附件，保持路径级上下文，不递归读取目录。
- [x] 建立全中文 Electron 原生菜单，并固定链接到 `wangyingxuan383-ai/grok-build-desktop` 仓库。
- [x] 实现深色、浅色、跟随系统、自定义颜色和本地背景图片主题；背景范围支持仅对话区或整个窗口。
- [x] 完成主题协议、资源隔离、全部重型渲染组件的深浅适配及支持包隐私约束。
- [x] 将 Windows Task Scheduler + Grok 无头执行的定时任务方案记录为 v0.5.0 路线图，本版不实现。
- [x] 通过类型检查、全部自动化测试、公开安全扫描、生产构建、win-unpacked内容冒烟和桌面快捷方式本机验收后，更新本文、功能矩阵、CLI兼容矩阵及 Changelog。2026-07-20 本地候选验收：167 项离线测试通过（2 项显式在线 Computer Use 用例在默认套件中跳过），并另行完成真实 Grok 视觉点击与高影响拒绝闭环；增强 UI/主题/CDP 冒烟、便携版中文空格路径冒烟、Fuse、安全扫描、最终打包及唯一桌面快捷方式冷启动均通过；未创建标签、未上传 Release。

## 固定产品约定

- 仓库、发布和问题入口分别固定为 `https://github.com/wangyingxuan383-ai/grok-build-desktop`、`/releases` 和 `/issues`，不从 Git remote 或 Fork 动态推断。
- 主题为全局应用设置；背景图片复制到应用数据目录，仅通过固定只读自定义协议提供给 Renderer，不进入日志、支持包或公共构建。
- 参考 `fanghui-li/Grok-Desktop` 的大尺寸添加面板、能力芯片和文件夹附件行为，采用 clean-room 实现，不复制其代码。
- Computer Use 的应用选择由 `/computer` Skill 在实际执行时完成；仅实际控制期间显示蓝色覆盖层和动作状态。
- 本轮版本为 `0.4.2` 本地候选版，GitHub 远端保持不变。

---
# Grok Build Desktop v0.5.16：来源会话归组与持久任务上下文（2026-07-21）

## 实施清单

- [x] Codex 镜像“在 Grok 中继续”创建的会话沿用原任务标题，并标记为“Codex 接力”。
- [x] 左侧会话按普通、定时任务、Codex 接力及其他来源分组；各来源组可独立折叠并持久化状态。
- [x] 定时任务默认复用同一个专属 Grok 会话，不再每次运行都新增会话。
- [x] 任务可选择“保留上下文”或“每次运行前清空上下文”，并可从任务中心主动清理当前专属上下文；历史任务会话仍可在侧栏单独删除。
- [x] 为旧 Codex 接力映射、旧任务与历史运行记录执行兼容迁移，不修改 Codex 原始会话。
- [x] 通过聚焦单元测试、类型检查、生产构建、打包界面冒烟和真实任务连续运行两次复用同一会话的验收后，更新功能矩阵、兼容矩阵与 Changelog。聚焦套件 30 项通过；隔离打包界面验证来源分组、Codex 原标题和标记；真实 OAuth 任务连续两次均完成并返回同一会话，随后清理确认任务映射、任务定义和该会话目录均不存在。

## 固定语义

- “保留上下文”始终加载该任务上次使用的同一 Grok 会话。
- “每次运行前清空上下文”在新一轮开始前删除旧的任务专属 Grok 会话并创建一个替代会话，因此侧栏最多保留一个当前任务会话。
- 手动“清理上下文”删除当前任务专属 Grok 会话并解除映射；下一次运行再创建新会话。
- 删除定时任务不自动删除其历史 Grok 会话；这些会话仍保留在“任务会话”组，可由用户自行删除。

---
