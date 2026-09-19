# Desktop 能力实施记录（2026-09-18，未发布）

基线为 v0.9.5。本轮修改源码、测试和内置资源，保留原有交接文档补记；未升级 CLI、安装应用、注册真实 Windows 任务、调用模型或发布版本。

## 2026-09-19 审查后修正

- 按用户要求保留绑定任务的工作区编辑。下一次执行在会话空闲后复用已有迁移事务，在新目录打开同一会话；保留历史和目标 ID，失败不静默转成新会话。当前会话迁移会改变该会话自身的工作区。其余原本被服务端禁止的绑定执行字段在表单中只读，避免保存后才报错。
- 修复完整表单保存重置 interval 锚点；名称/提示词等编辑不改变原有节奏，调度规则或时区变化才重置。
- daily/weekly 使用永久重复的 UTC CalendarTrigger，覆盖保存时区的季节偏移；Worker 按 IANA 时间和持久执行游标判断是否真的到期，合并重复触发。不再依赖前一次 Worker 登记下一次。无夏令时通常只有一个触发器；夏令时通常两个，非当前季节的额外唤醒直接退出、不调用模型或产生空运行历史。未来时区政策变动需重新注册以刷新规则，不能保证安装时未知的政策。
- 等待绑定会话时不占全局执行槽，同进程不同任务对同一会话按预留顺序执行；可取消等待。已加载会话与冷启动 Worker 共用无活动超时实现。
- MCP 新增 contextPolicy：独立任务可选 fresh/reuse，当前会话固定 reuse；移动工作区后，绑定的原会话仍能管理其任务。
- Computer 能力按当前会话过滤；收到请求与主会话身份校验通过分开记录。新增连接级 hook/MCP 联合校验证据；未把本机 CLI 合同标记为已验收。

定向验证：6 个相关测试文件、58 项通过；类型检查通过；只运行任务中心 DOM 分组，验证工作区可编辑并保留绑定 ID、固定字段、时间与提交数据。两份生成 XML（上海 daily、纽约 DST weekly）经 Windows Task Scheduler COM 的未注册任务定义解析通过，分别含 1/2 个重复触发器；未调用注册接口。未重跑全量或无关 UI 测试。

真实 CLI 对迁移后的会话恢复、hook、模型选择工具及 Windows 到时执行仍按既有边界待验收。XML 解析不是实际触发成功证明。

收尾：生产构建与 `git diff --check` 通过；更新内置 Skill 的资源哈希清单，未重编译未改动的原生 Host。

调度 XML 依据：[Microsoft CalendarTrigger](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-calendartrigger-triggergroup-element)。

## 实现

### 定时任务

- 定义增加 revision，运行会话映射分开存储。修改、注册和删除使用跨进程事务；删除保留 tombstone，迟到 Worker 不能恢复旧定义。
- 完成时只按预期 revision 更新运行映射。运行终态不可被迟到写入覆盖；取消中的活进程继续占有资源，直到退出。崩溃运行标记失败，同一运行 ID 不自动重放。
- 统一解析配置档与任务字段，冻结同一份配置供展示和启动。Worker 的模型、模式、effort 和权限保持一致；配置变化时重建独立任务环境。
- interval 使用持久锚点；daily/weekly 使用 IANA 时区，覆盖跨日与 DST；一次性时间存为绝对时间，编辑框转换为本地时间。
- 日历任务最初使用 UTC 单次触发；该设计在 09-19 修正为独立于 Worker 的重复 CalendarTrigger，详见上方修正记录。

### MCP 与会话

- Desktop MCP 提供 capabilities、automation_list/create/update/pause/delete/runs/cancel_run，复用现有业务服务。绑定调用会话与工作区，Plan 不允许修改任务；注册失败返回工具错误。
- current-session 显式保存 targetSessionId，通过本地认证 relay 交给已加载进程。忙碌时等待，同一任务触发合并；跨进程锁阻止同时打开同一 CLI 会话。账号/模型/模式/effort 不符时明确失败。
- standalone 的 fresh 每次建立新会话并保留历史。当前会话任务不能清除用户原会话；全局配置批量应用只覆盖独立任务。

### Computer Use

- computerEnabled 控制注入及服务端调用。取消或禁用清理等待；重载关闭旧租约。
- Worker/relay 的 Computer 确认接入持久收件箱，使用既有超时和取消信号；避免额外显示不可响应的进程内确认。
- 原生 Host 使用 Windows Local 命名 mutex；进程退出后由系统释放。同一进程也串行校验并发 start。
- GUI/Worker 急停入口取消共享 AppData 中的 Computer 计划任务。跨进程取消依赖既有轮询，未进行真实热键验收。
- Skill 支持自然语言任务，优先专用集成、结构化浏览器，再使用 Windows GUI；统一 Auto/Agent/Plan 语义。保护目标、过期状态、密码输入和活动桌面边界继续由服务端执行。
- 能力展示区分配置、注入、调用请求和模型实测，不再固定 accepted=true。

### 子智能体与扩展

- 使用原生 Grok 调度器。能力映射区分未知、CLI 宣告及观察到调用；消息与恢复不凭文档推定可用。
- 分开保存原生子智能体 ID、子会话 ID、父会话、结果及 Worktree，合并列表与进度。取消必须使用原生 ID，缺少时隐藏停止操作。
- 编译运行 Agent 时保留未知 frontmatter、注释及嵌套配置；结构化读取 mcpInheritance 的 all/none/named/except。
- 新增 persistent-tasks 和 collaborative-follow-up Skills，纳入资源哈希与打包资源。

## 调用身份边界

继承 MCP token 不能单独授予 Desktop 权限。新增 loopback PreToolUse hook：核对绑定 sessionId，拒绝 subagentType，通过 updatedInput 写入一次性证明。MCP 服务端校验工具名、参数摘要、时效和是否消费；hook 缺失或失败时拒绝调用。

这保护文档化 CLI 合同下的调用路由，不是对同一 Windows 用户的恶意进程实施 OS 沙箱。子智能体可能仍发现继承的工具名称，但直接使用父 MCP 连接不能取得有效调用证明。

**本机 CLI 1.0.30 尚未验证该合同。** 离线测试使用合成 hook 请求及真实 MCP SDK transport。若所选 CLI 不支持 PreToolUse updatedInput，工具将明确拒绝，不能降低校验继续执行。

官方设计依据（2026-09-18 读取，不等于本机版本验证）：[Hooks](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)、[Plugins](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/09-plugins.md)、[Subagents](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md)。

## 验证

- 最终全量测试：126 个文件通过、6 个文件跳过；971 项通过、9 项实机测试跳过（共 980 项）。包含运行期间编辑/暂停/删除、取消与确认竞争、跨进程租约、MCP CRUD 与身份校验、时区/DST 和 Agent 配置保留回归。
- `npm run typecheck`、`npm run build`、资源构建、分块预算检查、公开内容检查及 `git diff --check` 通过。
- Electron DOM 回归通过，新增任务表单检查覆盖保留会话历史、一次性时间本地显示及提交时剔除运行元数据。

原生 --lease-probe 仅测试 mutex 占有和崩溃回收，不读取截图或操作桌面；Computer MCP 合同使用假 Host。以上结果不替代真实 CLI、模型、Windows 调度器和 GUI 验收。

## 后续真实验收（本轮不执行）

固定桌面实际选中的 CLI 路径、版本、SHA-256、模型及 Provider，不自动升级；使用隔离项目和测试应用：

1. 验证插件/MCP 发现、parent/child hook 身份及 updatedInput；父调用成功、子调用拒绝、失败 hook 不能绕过。
2. 自然语言触发两个原生子智能体，核对结果、消息、取消、ID 和 Worktree。
3. 不写工具名或 @Computer，让模型选择工具完成可核验 GUI 操作。
4. 创建、编辑、暂停持久任务，核验实际 Windows 重复触发、正确会话、工作区迁移、忙碌合并和 DST/错过触发。
5. 验证 GUI/多 Worker 的桌面互斥、确认收件箱、超时、急停及崩溃回收。

独立虚拟桌面、云端多机常驻、分段下载器、安装和发布不在此次范围内。
