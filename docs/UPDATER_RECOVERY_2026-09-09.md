# 0.9.4 升级失败恢复审核与补修（2026-09-09，Unreleased）

> 后续用户已授权本机真实升级，原版故障链复现与修复版升级/恢复通过记录见 `CLI_LIVE_UPGRADE_2026-09-09.md`。本文“未升级/实机待验”描述的是最初源码修复阶段，不是后续实机试验后的状态。

## 用户报告与已确定原因

另一台电脑截图显示当前 CLI 1.0.0、stable 目标 1.0.24；更新报目标版本不符，回滚探针报临时目录不是 Git 仓库，随后普通连接被 Desktop 兼容门禁拦截。应用更新检查独立报 GitHub HTTP 403。

1. **动态回滚点**：原实现来自事务开始前读取的版本，恢复时沿用 `previousVersion`，不是写死 1.0.0。界面现明确标注，并在连续升级重试中保留最初回滚点。
2. **可选探针误伤核心**：`probe()` 在临时非 Git 目录调用 `officialGitStatus()`；方法只吞掉能力不存在错误，其余异常传出并终止整次核心验证。Info、Usage、rename 有相同的异常升级风险。现在这些请求失败只记录可选诊断，不伪造支持证据。
3. **回滚后断连**：回滚探针失败导致 `cli-update-recovery.json` 仍为 retained，普通启动即使遇到名单内 1.0.0 也会拒绝。保留隔离规则，修复恢复入口：重新验证当前实际版本，不再要求历史目标 1.0.24 已安装；完整核心成功才清理恢复状态。
4. **升级策略/入口死路**：finally 等待网络 `checkCliUpdate()` 才释放 busy；恢复状态又隐藏更新入口且主进程拒绝新 update。现先按本地事务状态解锁，后台刷新带操作世代保护；恢复时可以新策略预览 stable 目标，仍使用一次性确认和原始回滚点。
5. **应用检查代理缺口**：原 `net.fetch()` 未套用应用设置代理。新增专用 Electron 网络分区，按每次请求读取 HTTPS/HTTP 设置，无设置时使用系统代理；不静默改为直连。403/429 根据限流响应头分类，原因不明时保持不确定；失败返回官方 Release 页链接且不占用六小时成功缓存。

## 没有确定的部分

- 截图不能证明最初目标版本不符的具体原因；缺少那台电脑更新命令输出、CLI 路径、安装来源和 GROK_HOME 状态。未远程操作那台电脑。
- 只读核对本机 CLI help 确认 `update --version <VERSION>` 参数有效；本机仍为 1.0.3。没有用更新命令试错。
- 官方更新器源码存在手动安装不可自更新但成功退出的分支，受管安装又有独立安装目录。它们是需要检查的可能性，不是已证明的截图根因。新增对该明确 no-op 输出的错误识别，并在版本不符时展示目标、实际版本和检查路径；不会自动覆盖用户选定的可执行文件。
- GitHub 403 可以来自限流，也可能来自代理/访问拒绝。未把它一律解释成代理故障，也没有调用用户 GitHub 凭据作为绕过方案。

官方参考：[CLI reference](https://docs.x.ai/build/cli/reference)、[官方 updater 源码](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-update/src/auto_update.rs)、[GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。上游 main 是可变参考，不作为特定历史二进制的验证证据。

## 验证

- 完整 `npm test`：120 文件通过，6 opt-in live 文件跳过；928 项通过、9 项跳过。
- `npm run typecheck`、`npm run build`、`npm run check:chunks`、`git diff --check` 通过。
- `npm run test:regression-dom`：真实隐藏 Electron DOM/CDP；覆盖恢复状态换策略重试、联网刷新无限 pending 时仍解锁、当前版本验证按钮、事务阶段禁用，以及原有菜单/Toast/MCP/草稿回归。
- `cli-probe-cleanup.test.ts`：真实探针编排 + 假 ACP 传输，注入非 Git/Info/Usage/rename 错误仍要求核心 resume/close/delete。
- `cli-update-policy.test.ts`：重启后 1.0.0/目标 1.0.24 状态恢复；不访问 stable 的当前版本验证；连续重试保留原始回滚点和会话；已在盘回滚不重复下载；核心失败继续隔离；同版本哈希变化不当作未改变二进制。
- `cli-update-service.test.ts`：使用 Node 子进程模拟官方 manual-install 成功退出输出，不运行真实 CLI 更新。
- `app-release-service.test.ts`：Electron 网络分区代理切换、403 证据分类、官方页入口、失败后重试与日志失败隔离。

离线日志保留在忽略目录 `out/audit/v094-updater-hotfix-tests.log` 与 `out/audit/v094-updater-hotfix-build.log`。这些验证不代表 1.0.24 安装或另一台电脑代理实测成功。

## 交付边界 / 下次验收

- 当前仍是源码 0.9.4 上的未发布改动；未创建安装候选、提交、推送或 Release，也未变更本机安装版/CLI。
- 获授权生成候选后，另一台电脑先验证“重新验证当前 CLI”能清理该异常恢复状态并恢复原会话；不能删恢复文件来冒充通过门禁。
- 再按选择策略预览固定目标升级。若仍报版本不符，收集经脱敏的更新历史、命令输出与路径/安装来源诊断，先确定真实安装对象；不要盲目强制升级或覆盖另一份 CLI。
- 应用检查单独验证设置代理及 403 提示/发布页入口。无需为此提交认证信息、会话内容或全局环境变量。
