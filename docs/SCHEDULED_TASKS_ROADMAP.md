# v0.5.0 Windows 持久定时任务设计与实现记录

> 本路线图最初在 v0.4.2 记录，现已由 v0.5.0 实现。功能仍以本文件所列边界和自动化/打包验收为准。

## 目标架构

- Windows 当前用户的任务计划程序是持久触发源，保证 GUI 关闭后仍能运行；不采用只在 Electron 存活期间工作的 `setInterval`。
- 触发命令为 `Grok Build Desktop.exe --scheduler-worker <taskId> <runId>`；该入口不申请单实例锁、不创建 BrowserWindow，并使用隔离的临时 Electron 用户目录读取规范 AppData 中的任务定义。
- 实际执行继续使用本地 Grok CLI/ACP。可用时复用 Grok 官方 `/loop`、`/tasks` 和无头会话能力，不新增模型 API 或账号体系。

## 产品行为

- 支持一次、每日、每周和固定间隔，提供下次运行、立即运行、暂停、删除和历史。
- 每次执行创建独立 Grok 会话并归组到任务；同一任务禁止并发，错过执行最多补跑一次。
- 默认全自动执行，支持全局权限模板、一键应用到全部任务和单任务覆盖。
- 高影响操作暂停并发送 Windows 通知等待确认。Computer Use 必须单独启用，而且仅在用户已登录、桌面已解锁时运行。
- 使用无需管理员权限的当前用户级计划任务，并支持登录或唤醒后的单次补跑。

## 预留接口

- 类型：`AutomationTask`、`AutomationSchedule`、`ScheduledPermissionPolicy`、`AutomationRunRecord`、`AutomationPendingConfirmation`。
- IPC：`automations.list/create/update/delete/runNow/pause/listRuns`、`automations.getGlobalPolicy/updateGlobalPolicy/applyPolicyToAll/respondPending/repairRegistrations`。

## 验收重点

- GUI 关闭后仍能触发；重复触发不并发；应用升级后任务路径可迁移。
- 无确认的高影响操作为零；锁屏时 Computer Use 不启动。
- 任务历史和日志脱敏，不保存明文凭据、完整提示词或附件内容。
