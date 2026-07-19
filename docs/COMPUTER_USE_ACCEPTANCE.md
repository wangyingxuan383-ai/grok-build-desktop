# Grok Computer Use v0.3.1 验收记录

验收日期：2026-07-18
适用范围：Windows x64、已解锁的当前前台桌面、非管理员目标窗口
结论：**通过 v0.3.1 可见控制修复与 v0.3.0 原计划的软件、本机和打包版验收门槛。** 功能仍以“实验性”标识呈现并保持休眠，只有显式选择 `@Computer`、应用或 `/computer` 时才启动。普通非保护应用默认直接可用，高影响动作继续逐动作确认。

## 0. v0.3.1 可见性修复结论

- 旧实现的普通按钮 `click` 会优先执行 UIA `InvokePattern`，因此可能不移动鼠标；v0.3.1 改为 UIA 定位后通过系统指针执行真实点击，并在点击前可见停留。
- 目标显示器出现不抢焦点、鼠标穿透的蓝色发光边框和顶部状态条；主窗口同步显示动作、步骤、暂停/继续/停止。
- 活动期间动态注册 `Esc`，停止后注销；`Ctrl+Alt+Esc` 继续作为备用。
- 打包版证据 `out/computer-test/ui-acceptance.json` 记录：默认应用授权弹窗为 false、蓝色叠层和主窗口状态条为 true、`Esc` 停止为 true、真实高影响确认卡为 true。
- UAC、安全桌面和高权限窗口保持人工接管：任务暂停并解释当前状态，用户完成 Windows 确认后点击“继续”重新观察。未修改 UAC 策略，未使用未签名 UIAccess，也不声称模型可点击安全桌面。

## 1. 确定性 Windows Harness 流程

证据文件：`<repository-root>\out\computer-test\acceptance.json`

- 24/24 流程通过，单步正确率 100%。
- 错误窗口动作：0。
- 未确认的高影响动作：0。
- 覆盖：窗口发现/激活、缩放 PNG、原始分辨率局部截图、过期状态拒绝、可见真实鼠标点击及坐标校验、UIA Value、Unicode 输入、键盘、真正双击、右键、拖动、滚动、等待、窗口移动、最小化/恢复、错误前台拒绝及受控应用启动。

测试使用应用由 `native/GrokComputerTestPage.cs` 构建，窗口标题和控件状态会对错误动作留下确定性哨兵，测试结束后自动关闭且不进入安装包。

## 2. Grok 模型视觉与风险闭环

证据文件：`<repository-root>\out\computer-test\live-grok-acceptance.json`

- 真实 Grok CLI `0.2.101` 加载内置 `/computer` Skill 和会话级 tokenized loopback MCP。
- 模型观察 PNG/UIA 状态后只点击一次 `Increment`，新窗口标题验证为 `increment:1`，任务以 1 步停止。
- 第二回合尝试 `Delete data` 时产生一次高影响确认；客户端拒绝后执行步数为 0，删除哨兵未激活。
- 同一风险流程又通过打包版 Electron UI 执行，确认“高影响操作确认”“取消并停止/确认执行一次”卡片正常，拒绝后目标仍未改变。

## 3. 打包版 Electron UI

脚本：`scripts/probe-v030-ui.ps1 -LiveRisk`

- 七个扩展标签页、已安装插件、市场来源/固定提交、Skills、MCP、Hooks、Computer Use 和 Codex 兼容列表均通过 CDP 验收。
- 本地插件仅静态预览，展示 Skill/Hook/MCP/脚本/许可证，并在取消后未安装或执行。
- 普通应用默认无授权弹窗；可选逐应用授权仍由单元测试覆盖。暂停/恢复/停止和输入焦点恢复均通过。
- 蓝色显示器边框、顶部动作条、主窗口活动条与默认无授权弹窗通过打包版 CDP 验收。
- 真实全局 `Esc` 由独立 native helper 发送到测试应用；Electron 动态快捷键将活动任务标记为紧急停止。`Ctrl+Alt+Esc` 备用快捷键仍注册。
- 授权后的首次观察与立即停止竞态已修复，终止状态不会再被异步 Host 回调覆盖为错误。

## 4. DPI 与显示坐标

- 实机 100%：测试页报告 DPI 96，24 条流程通过。
- 实机 125%：Windows Calculator 报告 DPI 120，截图 → 35 个 UIA 元素 → 单击 → 新状态闭环通过。
- 150%：DPI 144 的截图/物理坐标换算由参数化单元测试覆盖。
- 双显示器/负坐标：左侧副屏 `x=-1920`、DPI 144、缩放截图和绝对 UIA 边界的转换矩阵由单元测试覆盖。
- 验收机器当前只有一个物理显示器（`DISPLAY1`，1536×864），因此没有虚构“物理双屏实测”；负坐标和 150% 使用与运行时代码相同的纯坐标函数进行硬件无关测试。

## 5. 官方插件与恢复

证据文件：`<repository-root>\out\computer-test\plugin-acceptance.json`

- 官方 `chrome-devtools-mcp` 1.6.0，来源 `xAI Official`。
- 验收前记录启用状态、路径、来源、版本及 Git 提交。
- 临时禁用后重新启用，身份、提交和原启用状态全部恢复。
- 未卸载、覆盖或静默信任用户插件。

## 6. 自动化基线

- TypeScript 类型检查通过。
- 默认测试：24 个测试文件通过、1 个 opt-in 文件跳过；137 项通过、2 项 opt-in 跳过。
- opt-in 真实 Grok Computer Use：1 项通过、1 项非动作兼容探针按环境开关跳过。
- `npm audit --audit-level=high` 在最终总验证中报告 0 个漏洞。
- `verify.ps1 -RequireLiveComputerAction -RequirePackagedUi` 整体通过；最终 `win-unpacked` 再打包后可见窗口冒烟通过。
- `%USERPROFILE%\Desktop\Grok Build Desktop.lnk` 指向最终本地 EXE；桌面不存在 Codex 图标备份，备份保存在 `%USERPROFILE%\.codex\backups`；验收后 Computer Host、测试页、桌面应用进程和测试会话残留均为 0。

## 7. 保留边界

“通过”只适用于计划定义的首版边界：当前前台桌面、设备解锁、普通权限窗口。管理员/UAC/安全桌面、终端、Grok Build Desktop、Codex/ChatGPT、后台桌面、锁屏、远程控制、宏录制和定时 GUI 自动化仍明确不支持。
