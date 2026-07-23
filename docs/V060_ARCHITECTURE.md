# v0.6.0 工作台模块边界

> 本文固定 v0.6.0 的代码所有权和 IPC 边界。它描述接口，不代表尚未通过聚焦测试的功能已经实现。

## 1. 共享契约

- `src/shared/workbench-types.ts`：编辑器、Git、Worktree、Memory、Agent/Persona、Dashboard、执行配置档、CLI 能力快照和任务健康报告的纯数据类型。
- `src/shared/types.ts`：现有桌面 API 总入口，只重新导出工作台类型并声明最小 Preload API；不得加入文件系统或进程实现。
- Renderer 只持有展示状态、未保存缓冲区、标签和筛选条件。绝对路径仍视为受控数据，不写日志、通知或支持包。

## 2. 主进程服务

后续实现按下列独立服务推进，服务之间通过显式构造参数协作，不允许 Renderer 直接访问 Node.js：

| 服务 | 所有权 | 不负责 |
|---|---|---|
| `WorkspaceTreeService` | 工作区规范化、`realpath` 边界、忽略规则、懒加载目录 | 编辑器缓冲区、Git 修改 |
| `EditorService` | 编码/换行检测、大小门槛、哈希冲突、原子保存和文件变更 | Monaco UI、任意命令执行 |
| `GitService` | 固定参数数组、状态/Diff/暂存/提交/分支/Pull/Push、取消和脱敏 | Shell、高级历史改写、凭据存储 |
| `WorktreeService` | 官方 ACP 优先、Git 回退、来源映射、安全 Apply 状态机 | 自动丢弃、冲突时清理 |
| `MemoryService` | `GROK_HOME/memory` 边界、工作区启停、原子编辑、Flush/Dream 状态 | 自动修改全局 `config.toml` |
| `AgentDefinitionService` | Agent Markdown、Persona TOML、来源优先级、备份/校验/回滚 | 修改内置或插件定义 |
| `AgentDashboardService` | ACP/会话事件归一化、父子树和历史降级 | 启动 TUI Dashboard、伪造实时状态 |
| `ExecutionProfileService` | AppData 全局/项目配置、覆盖规则、CLI/ACP 参数转换和不可映射字段拒绝 | 自动写仓库、静默忽略字段 |
| `AutomationHealthService` | 可逆元数据检查与修复、需要配置状态 | 替换账号、提供商、模型或重跑提示词 |
| `CliCapabilityService` | 按 CLI 版本缓存静态帮助/inspect 证据并叠加 ACP 运行时证据 | 把未知私有方法误判为支持或不支持 |

上述服务均已实现并通过对应聚焦自动化或隔离UI验收。Memory 服务复现 Grok 的远程仓库身份、slug/BLAKE3 目录算法，所有读写限制在解析后的 `GROK_HOME/memory`；Agent/Persona 服务在主进程完成来源优先级、只读边界、原文往返、哈希冲突、持久备份、`grok inspect --json` 校验/回滚和仅空闲会话恢复。Execution Profile 已驱动新会话、分叉与持久任务；Worktree来源分组、Dashboard事件投影、任务健康修复和会话结束Memory策略均由主进程持有。

## 3. IPC 命名与验证

- 公开 API 使用既有冒号通道形式承载计划中的点式命名：`editor:*`、`workspace:tree:*`、`git:*`、`worktree:*`、`memory:*`、`agents:*`、`personas:*`、`dashboard:*`、`profiles:*`、`automations:check-health`、`automations:repair`、`diagnostics:cli-capabilities`。
- 所有 handler 继续通过 `registerIpc()` 的顶层 Frame/发送者验证；Preload 只暴露带类型的方法。
- 写操作的参数在对应主进程服务再次验证，不能只依赖 TypeScript 或 Renderer 表单。
- 长时间 Git/Worktree/Memory 操作使用操作 ID 和显式取消，不把任意进程句柄交给 Renderer。

## 4. 能力快照语义

- `supported`：CLI 帮助、`inspect --json` 或实际 ACP 成功调用提供了直接证据。
- `unsupported`：对应探针成功运行但明确没有该公开入口，或实际 ACP 返回方法不存在。
- `unknown`：尚未进行会话级私有 ACP 探测；不得据此显示为可用，也不得触发核心 CLI 回滚。
- `initialize`/`session/new` 是 CLI 接受与回滚边界；Git/Worktree、Memory、Agent、插件/MCP、媒体、Codex 读取器、额度和 Computer 均为局部能力。
- 静态探针只运行 `--help`、子命令帮助和 `inspect --json`，不发送提示词、不访问账单、不修改仓库或 Memory。

## 5. 已完成的实施顺序

1. 公共类型与能力快照。
2. `WorkspaceTreeService` 和 `EditorService`，配套聚焦测试。
3. `GitService`，只操作测试创建的临时仓库和本地 bare remote。
4. Worktree、配置档、Agent/Persona、Dashboard、Memory、任务健康。
5. 工作台 UI 按已验证服务逐面接入；文件、Git、Worktree、Memory、Agent/Persona、Dashboard与Profiles保持独立Renderer组件，编排与生命周期仍由既有Controller统一接线。

本地`0.6.0`候选已完成以上顺序、临时仓库端到端流程和一次正式打包。外部Windows版本/覆盖升级/DPI/双屏矩阵属于发布门槛，不改变本模块边界。
