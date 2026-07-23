# Grok Build Desktop 下一会话交接（2026-07-23）

> 当前目标已完成到本地安装版 0.6.4。后续会话不要重复本轮完整离线套件、正式打包或付费模型验收；先复用本文证据，只验证后续实际改动。本文不含账号、Token、提示词正文、Codex 会话内容或本机绝对附件路径。

## 1. 必读与工作树纪律

1. `AGENTS.md`
2. 本文
3. `docs/IMPLEMENTATION_PLAN.md` 的 v0.6.3→v0.6.4 章节
4. `docs/FEATURE_MATRIX.md`
5. `docs/CODEX_UI_PARITY.md`
6. `docs/CLI_COMPATIBILITY.md`
7. `CHANGELOG.md`

开始前检查 `git status`。0.6.0–0.6.4 的完整功能工作树仍未提交；不得重置、覆盖或与旧基线混合。本轮没有创建提交、标签、PR、推送或 GitHub Release，公开 Latest 仍是 `v0.5.16`。

## 2. 当前版本与本机交付

- 源码、lockfile、应用显示版本：`0.6.4`。
- per-user 安装路径：`%LOCALAPPDATA%\Programs\Grok Build Desktop\Grok Build Desktop.exe`。
- 文件版本 `0.6.4`、产品版本 `0.6.4.0`；Main `app.getVersion()` 与 About 为 `0.6.4`，诊断中心为“可以使用”。
- 桌面与开始菜单快捷方式均指向安装目录，不是 `release\win-unpacked`。
- 当前接受的 Grok CLI 边界仍为 `0.2.106 (bde89716f6)`；0.6.3/0.6.4 未增加必需 ACP 私有方法，也未发送付费模型提示词。

## 3. 0.6.3 热修结果

- Scheduler 输出按 Buffer 经 UTF-8/UTF-16/GB18030 兼容路径解码，注册失败使用结构化稳定诊断；带 `�` 的历史文本改为可恢复说明。
- 所有会话入口使用统一目标打开流程；会话主区为标题/消息/输入框固定网格，工作台有明确“返回会话”，Virtuoso 在返回后重新测量。
- 非 Git Review 为普通能力空状态，窄窗不再出现按钮可点但面板被 CSS 隐藏；重复底部环境栏已删除。
- 0.6.3 已安装验证后才继续 0.6.4。首个暴露 720 px 输入框越界的候选被拒绝，未作为最终资产。

## 4. 0.6.4 已完成能力

- **右侧工具区**：统一启动器只映射真实 Review、计划/结果、最近文件、侧边任务；每工具保存 420–760 px 宽度，窄窗为覆盖抽屉，不含假终端/浏览器。
- **可扩展 Review**：`GitReviewIndex` 先返回轻量文件列表，`GitReviewFileDetail` 只读取选中文件 Patch；850 文件夹具不再一次渲染全部 hunk。五类范围、暂存/取消/恢复、快照过期和行批注保留。
- **导航与文件**：左栏不再常驻 File/Review；最近写入先在右栏只读预览，显式选择“编辑文件”后进入中央 Monaco。Dashboard→会话→文件→会话→任务中心→会话保持输入框、滚动和焦点。
- **提供商中心**：独立列表＋详情弹窗，五类预设；未保存草稿即可测试连接/获取模型，支持搜索、多选导入、可编辑安全本地 ID、重复稳定哈希和手工补充。
- **探测边界**：主进程只向模型列表端点执行有超时、2 MiB 上限、禁止重定向的 GET；支持 OpenAI/Responses、Anthropic、Ollama/本地及兼容网关列表形状。凭据不进日志/诊断，未知上下文保持未知。
- **Windows 路径边界**：绝对路径先统一到 canonical long path，Hosted Runner 的 8.3 `%TEMP%` 别名不再误报 Editor、Memory、Agent/Persona 或 Git 越界；符号链接和目录联接逃逸仍拒绝。
- **保留能力**：0.6.1 图片缓存/发送后预览/失败恢复/重开、0.6.2 回合折叠/真实耗时/背景参数/NavigationIntent 及 Renderer 沙箱边界均保留。

## 5. 最终验证证据

- 聚焦门槛：7 个文件 / 55 项测试通过；覆盖 provider 草稿/三协议/401/超时/超量/冲突 ID、Review index/detail/快照过期/850 文件、Scheduler 健康和 Renderer store/comments。
- TypeScript、生产 main/preload/Renderer 构建和最终 243 文件公开源码扫描通过。
- 唯一一次完整离线套件：60 个文件通过、1 个按设计跳过；291 项通过、2 项显式 opt-in/live 跳过，使用 1 个 Windows Worker。
- 0.6.4 源码、`win-unpacked` 与安装版均通过同一隔离夹具：Dashboard→chat→file preview→explicit editor→chat→tasks→chat、四工具右栏、非 Git Review、1280×720、1440×810@125%、1920×1080@200%、1100 px 抽屉和提供商中心。
- 唯一一次正式打包通过 Electron Fuses、源码/产物扫描并保留 0.6.0–0.6.3 命名 Setup/Portable/SBOM。
- 安装版 Main/About/诊断/支持包附件排除和快捷方式目标均通过。

## 6. 最终本地产物

`release\SHA256SUMS.txt`：

- Setup：`Grok-Build-Desktop-Setup-v0.6.4-x64.exe`
  `be0080e4ce0d44528840fa6923e469b26407327d246bbf140e6f761bd76a8ca5`
- Portable：`Grok-Build-Desktop-Portable-v0.6.4-x64.zip`
  `1d6104e3ffdad4ae1cc5ca7c80f5352a3e8c63d7e72cb69df55bbc16837480c6`
- CycloneDX SBOM：`Grok-Build-Desktop-0.6.4-SBOM.cdx.json`
  `feb7207c0ed97e931fa31a54090658a5ba3aea701fb9af41add6f12817532b67`
- 第三方许可证：`THIRD_PARTY_LICENSES.json`
  `fb8469bdbecff72100bd94c44b2f67f1b596ade9854d95ce862a7559d3b1d82e`

0.6.0–0.6.3 Setup、Portable 与 SBOM 命名资产仍在 `release`。通用许可证报告和 `SHA256SUMS.txt` 按当前候选更新，这是发布目录的既有约定。

## 7. 仍未完成的外部门槛

- Windows 10 22H2、Windows 11 23H2/24H2、中文用户名、标准权限、物理 125–200% DPI 与双屏矩阵。
- 从公开 `v0.5.16` 到 0.6.4 的正式覆盖升级及真实 DPAPI 账号、持久任务、专属会话、Codex 接力和 AppData 保留矩阵。
- Git 提交/标签、GitHub Release、云端构建溯源、回下载和外部签名；必须等待用户明确发布指令。
- 不要把本地 0.6.4 候选描述成公开 Release，不要重复付费 `/remember`、私有 Worktree ACP 或真实提供商推理。

## 8. 后续会话开场指令

```text
先读取 AGENTS.md、docs/NEXT_SESSION_HANDOFF.md、docs/IMPLEMENTATION_PLAN.md 的 v0.6.3→v0.6.4 章节、docs/FEATURE_MATRIX.md、docs/CODEX_UI_PARITY.md、docs/CLI_COMPATIBILITY.md 和 CHANGELOG.md，并检查 git status。0.6.4 已完成本地安装和最终验证，不要重复完整套件、正式打包或付费验收；只处理我明确要求的后续改动、外部矩阵或发布工作，并运行直接受影响的聚焦验证。
```
