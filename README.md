# Grok Build Desktop

> 非官方社区客户端，与 xAI 无隶属关系。Grok、Grok Build 与相关商标归其权利人所有。

Grok Build Desktop 是面向 Windows 用户的 Grok Build CLI 图形客户端。在一个工作台里管理代码会话、独立图像创作、项目文件、产物预览和持久定时任务。应用通过 ACP 连接你安装的 Grok CLI，沿用其原生模型、工具与子智能体机制。

[下载桌面与安卓](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/latest) · [界面展示](docs/SHOWCASE.md) · [功能与边界](docs/FEATURE_MATRIX.md) · [CLI 兼容说明](docs/CLI_COMPATIBILITY.md) · [反馈问题](https://github.com/wangyingxuan383-ai/grok-build-desktop/issues)

![编程工作台：项目、会话、标签与消息](docs/assets/coding-workspace.png)

当前桌面版本为 0.12.0，配套 Grok Remote 为 0.4.0；下方桌面截图展示 0.10.4 的工作流。截图使用隔离演示数据；示例文字与插画不代表真实模型生成或性能结果。公开安装包以 Releases 中的版本为准。

## 手机连接与更新

[下载 Android APK 0.4.0](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/download/v0.12.0/Grok-Remote-v0.4.0.apk)。手机安装后，在电脑“设置 → 手机连接”开启配对，手机扫码并由电脑允许。支持局域网或已有 VPN；电脑负责模型和任务执行。手机提供会话、任务、作品与设备四个入口，以及收藏、长按菜单和全屏看图。

桌面安装版可在应用内下载安装更新；手机 0.3.6 起可独立检查和下载 APK，校验后打开系统安装确认。覆盖安装保留数据，便携版通过替换目录升级。详见[中文手机指南](apps/mobile/README.md)。

## 工作流

| 场景 | 可以做什么 |
|---|---|
| 编程 | 项目与会话管理、原生 ACP 对话、模型/effort/模式选择、消息队列、工具结果、Diff、Git 与 Worktree |
| 图像创作 | 独立图像会话、参考图、比例与模型选择、完整草稿、请求复用、图库筛选、单张/批量删除与两图对比 |
| 预览与反馈 | 右侧图片、Markdown、代码、PDF、Office 文本与交互 HTML；手动开发服务器预览、网页截图和区域反馈 |
| 任务与提醒 | Windows 持久定时任务、运行记录、确认收件箱、完成/失败提醒及返回对应会话 |
| 扩展能力 | Skills、插件、MCP、Hooks、Agent/Persona、配置档及实验性的 Windows Computer Use |
| 账号与用量 | OAuth/API Key、多账号、自定义 Provider、明确来源的 Token 汇总与账号额度 |

编程模式也可强调选择生图能力，结果留在当前代码项目中；切换图像模式不会重新分类旧会话。

### 图像会话与图库

每个图像会话保存自己的请求、草稿和作品。图库用于跨会话浏览，默认只显示图片；失败记录在独立筛选中保留，方便诊断和清理。

![独立图像会话：作品与后续描述](docs/assets/image-conversation.png)

![图库：图片优先，失败记录单独筛选](docs/assets/image-gallery.png)

### 右侧产物预览

项目 HTML 可使用同目录相对 CSS、JS、图片与 JSON。需要开发服务器或外部接口的页面，可打开手动网页预览，并将截图和说明加入会话草稿。

![项目文件与右侧交互 HTML 预览](docs/assets/artifact-preview.png)

### 持久任务

选择执行位置、任务指令和时间，查看运行记录与待确认事项。Windows Worker 可在主窗口关闭后执行；电脑仍需开机，Computer 操作要求活动且解锁的桌面。

![持久任务：工作日预设与高级配置](docs/assets/scheduled-tasks.png)

## 能力边界

- 子智能体由 Grok CLI 原生调度；桌面展示状态、结果和可读取的子会话。跟进、取消与恢复按所选 CLI 的实际合同开放。
- Computer 的能力选择、观察与实际操作分别记录；本机 Host 就绪不代表模型已完成操作。
- 终端与内嵌浏览器提供手动操作和预览；当前不宣称模型拥有专用浏览器或终端控制工具。
- 本机历史 Token、当前回合/进程累计和账号额度分别展示，不推算缺失的官方总量。
- 多轮续图、Computer 与部分原生子智能体操作仍需对应 CLI、模型与登录环境的实际验收。
- 完成提醒受 Windows 通知权限影响；PR/CI 状态需要已安装并登录的 GitHub CLI。

## 系统要求

- Windows 10 22H2 或 Windows 11，x64。
- 简体中文界面；Windows ARM64 模拟、网络盘和 UNC 仅提供诊断提示。
- [Grok Build CLI](https://docs.x.ai/build/overview)（应用不重新分发 CLI）。

## 安装

从[Releases](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases)页面选择：

- `Grok-Build-Desktop-Setup-vX.Y.Z-x64.exe`：当前用户 NSIS 安装版，无需管理员权限。
- `Grok-Build-Desktop-Portable-vX.Y.Z-x64.zip`：解压后直接运行，其中的用户数据仍写入 `%APPDATA%\Grok Build Desktop`。

本项目首批 Release **没有代码签名**。Windows 可能显示 SmartScreen 提示。请从本仓库 Release 下载，并使用同一 Release 中的 `SHA256SUMS.txt` 校验：

```powershell
Get-FileHash .\Grok-Build-Desktop-Setup-vX.Y.Z-x64.exe -Algorithm SHA256
```

应用不会静默下载或自动执行未签名安装包。

## 安装与登录 Grok CLI

在 PowerShell 中执行 xAI 官方安装命令：

```powershell
irm https://x.ai/cli/install.ps1 | iex
```

首次运行向导会从用户配置、`%USERPROFILE%\.grok\bin\grok.exe` 和 `PATH` 查找 CLI，并提供 OAuth 或 API Key 登录。设置页也可指定自定义路径。

## 从源码构建

需要 Node.js 24 LTS、npm 11+、PowerShell 5.1+ 和 Windows x64。仓库固定依赖版本并提交 `package-lock.json`。

```powershell
git clone https://github.com/wangyingxuan383-ai/grok-build-desktop.git
cd grok-build-desktop
npm ci
npm run verify
npm run package:win
```

一键脚本：

```powershell
.\scripts\bootstrap.ps1
```

一键脚本会尝试验收 Windows Task Scheduler；若本机策略禁止创建任务，会明确警告并继续生成 Setup/Portable。正式发布维护者直接运行 `npm run package:win` 时仍把任务调度验收作为强制门禁。

默认不会修改贡献者桌面；只有显式传入 `-CreateShortcut` 才创建开发版快捷方式。

本地调试可将 `app.local.example.json` 复制为被 Git 忽略的 `app.local.json`，然后使用 `npm run dev:local`。该文件不得保存 Token、API Key 或账号。

## 代理和数据位置

- 应用设置与加密账号：`%APPDATA%\Grok Build Desktop`
- 自定义背景副本：`%APPDATA%\Grok Build Desktop\themes`（应用只保存自己的副本，不持续依赖原图片）
- Grok CLI、插件与原始会话：`%USERPROFILE%\.grok`
- 持久任务定义与运行记录：`%APPDATA%\Grok Build Desktop\automations`（提示词使用 Windows DPAPI 加密）
- Codex 镜像：只读访问 Codex 本地会话；不会修改原文件。

应用继承 `HTTP_PROXY` / `HTTPS_PROXY`，也可在设置页覆盖。诊断支持包只记录代理“是否配置”，不导出地址或认证。

## 验证

```powershell
npm run verify       # 默认离线：不读取真实 auth.json，不调用模型，不查询额度
npm run verify:live  # 显式真实 CLI / 账号 / 插件 / Computer Use 验收
npm run check:public # 扫描个人路径、邮箱、代理与凭据模式
```

## 常见问题

**会自动更新吗？** 默认在每次启动后检查应用稳定 Release 和 CLI stable 通道；持续打开时每天检查一次，有更新时在两种模式的侧栏显示红点。可在“设置 → 更新与诊断”关闭检查和提醒。检查不下载安装；应用打开正式 Release 页面，CLI 更新需手动确认并验证兼容性。

**卸载会删除对话吗？** NSIS 默认保留 `%APPDATA%`、`%USERPROFILE%\.grok` 和 Grok 会话。若要完全清理，请在确认备份后手动删除。

**Computer Use 能点 UAC 吗？** 不能。UAC、Windows 安全、验证码与安全桌面必须由用户手动完成，之后再让任务继续。

**如何切换浅色或自定义背景？** 打开“功能 → 设置 → 外观与背景”。主题即时生效；背景图片不会进入日志或诊断支持包。

**定时任务在应用关闭后会运行吗？** 会。启用的持久任务由当前用户、最低权限的 Windows Task Scheduler 唤醒无窗口 Worker；Computer Use 任务仍要求桌面已解锁，确认行为遵循所选执行模式与服务端规则。

**自定义提供商的密钥保存在哪里？** 默认保存为 Windows 当前用户环境变量，`config.toml` 只保存变量名。相同 Windows 用户下的其他进程也可能读取用户环境变量。

**支持 macOS / Linux / 英文吗？** 当前目标是 Windows x64 与简体中文。

## 贡献与安全

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [隐私说明](docs/PRIVACY.md)。Bug 报告不得附带真实 Token、完整日志、工作区源码或未脱敏截图。

仓库入口：[GitHub](https://github.com/wangyingxuan383-ai/grok-build-desktop) · [版本发布](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases) · [问题反馈](https://github.com/wangyingxuan383-ai/grok-build-desktop/issues)

## 许可证

[MIT](LICENSE)。第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，Release 同时提供 CycloneDX SBOM 和许可证报告。

## 友链

学AI 上L站！ [L站链接](https://linux.do/)
