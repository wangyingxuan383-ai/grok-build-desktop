# 0.7.0 累计变更一致性审计（2026-08-09）

## 审计范围

本次审计以 `origin/main...codex/v0.7.0-audit-hardening` 为边界，覆盖自 0.7.0 审查开始以来的 5 个提交、150 个变更文件（约 `+12,465/-1,402` 行），以及当前工作树中的未提交修复。检查了主进程服务、ACP 适配器、Provider 网关/扫描、会话投影、IPC/Preload、Renderer 壳层、CSS、测试、打包脚本和交接文档。

审计不把“按钮存在”当作功能证据；每个结论区分为源码/契约、离线测试、安装版探针和真实 CLI 验收。当前本机稳定 CLI 为 `0.2.118`，0.2.119/0.2.120 仅有脱敏 Fixture 和前向解析证据，不能当作稳定通道实机能力。

## 冲突与重复检查

### 1. Provider 扫描 API

- `providers:scan:start/get/list/cancel` 是当前 Renderer 使用的异步 Job API，拥有 Job ID、generation、进度推送和取消回执。
- `providers:deep-scan/cancel-scan` 是旧 Preload/测试兼容入口；它们没有第二套网络扫描器，最终进入同一个 `ProviderService.deepScan()` 核心。
- 结论：不存在重复探测请求的两套实现。旧入口保留是为了旧 Renderer/外部自动化兼容，后续应标记为 deprecated，禁止新 UI 继续调用。

### 2. 会话回放与本地投影

- ACP 回放、ConversationProjection V2 和历史恢复分别承担“上游补齐”“本地持久化”“旧会话降级”，通过稳定 block/message/turn ID 以及内容后缀合并。
- 结论：不是重复存储同一消息；无可靠边界时保留本地内容并明确标记不可恢复，不伪造正文。

### 3. CLI 版本与运行时能力

- 0.2.118 稳定适配、0.2.119/0.2.120 前向 Fixture 与能力门控并存，但 UI 启用顺序固定为“运行时声明 → 成功探测 → 已观察事件 → 版本提示”。
- 结论：版本提示不会越权打开 `/btw`、Session 私有扩展、MCP/插件/Git 或 doctor 修复；延期功能不会和已验证功能冲突。

### 4. CSS 与壳层

- `styles.css` 只有一个生产入口，按 tokens → base → shell → workbenches → conversation 的固定顺序加载；旧 `v0616.css` 已改为职责名称 `conversation.css`，没有第二个 Renderer 入口。
- 静态检查发现 71 个跨文件重复选择器，主要来自 `base.css` 的结构默认值与 `shell.css` 的最终紧凑视觉值。它们是当前有意依赖加载顺序的级联，不是两套 React 壳层，但属于历史维护债务；本轮已补充文件职责注释，并确认新增 0.7.0 样式没有再建立第三层覆盖。
- 结论：本轮新功能没有引入并行壳层或循环导入；不在提交前机械搬移 71 组规则，以免改变相同 specificity 规则之间的既有顺序。后续视觉重构应按组件逐组合并并用当前 UI 探针验收，而不是批量删除。

## 本轮发现并修复的问题

### Provider 扫描取消竞态（P1）

异步 `startScan()` 返回后，用户可能在扫描 Worker 安装 `AbortController` 前立即点击取消。旧逻辑用 `updatedAt` 判断取消计时器是否仍有效；Worker 发布 `running` 状态会正常更新 `updatedAt`，导致 Job 长时间停在 `cancelling`，也可能继续启动一次探测。

修复内容：

1. 取消宽限期改用 Job 状态、Provider、Job ID 和 generation 校验，不再依赖易变时间戳。
2. 计时器发现 Controller 已安装时主动 abort，并立即失效 generation，迟到响应不能写入证据。
3. Worker 首次运行前再次检查 `cancelling/cancelled`，已取消任务直接完成为 `cancelled`，消息明确显示“未发送探测请求”。
4. Provider store 的异步读取完成后、安装 Controller 和发出首个请求之前再次检查 Job 状态，覆盖“Worker 已进入但 Controller 尚未存在”的第二个竞态窗口。

### 媒体空闲计时语义（P1）

媒体子进程过去从 `spawn()` 后立即使用同一个空闲阈值。在机器启动负载高或测试刻意使用短阈值时，进程可能尚未产生首字节就被当成“输出中断”。现在无输出启动阶段有最少一秒的有限宽限；收到首个 stdout/stderr 字节后才使用模型配置的空闲超时，并在每个后续字节重新计时。该机制不是总运行时上限，持续输出不会被强制终止。

### 附件重开与虚拟列表验收（P2）

离线 UI 夹具原先直接构造附件消息，不能证明生产使用的附件账本恢复路径。夹具现追加 `user-attachments-restore` 事件并调用真实 `AttachmentCacheService.restore()`；Renderer 重载后，探针先将虚拟会话滚到图片所在回合再断言三张预览，避免“状态存在但节点未挂载”的假失败。

## 证据与剩余边界

- 受影响测试：4 个文件、72 项通过，包含 Provider 启动前取消零请求、迟到响应丢弃、媒体持续输出/静默超时、附件缓存和 Renderer 合并覆盖。
- 完整离线门禁：94 个测试文件、677 项通过；6 个 live 文件、9 项按设计跳过。TypeScript、生产/资源构建、342 文件公开源码扫描、Renderer 分块、Native Host 自检、`git diff --check` 和 `npm audit --omit=dev --audit-level=high` 通过。
- 当前依赖树有 4 个由 Mermaid/Monaco 间接引入且暂无修复版本的 DOMPurify 中危项；没有 high/critical 项，不能写成“0 漏洞”。
- 0.7.0 Setup/Portable 和安装版探针只覆盖本轮源码修复前的历史候选。E 盘故障后没有复用或重新宣称这些资产；新候选必须在 C 盘独立打包、校验和安装。
- 真实长会话 Stop、双并行真实 Provider、0.2.119/0.2.120 stable 能力以及 MCP/插件/Git/doctor 新界面仍属于未宣称的实机边界。

## 后续维护规则

- 新增 IPC 或 Provider 能力必须在统一入口登记，并说明是否是兼容包装；不得再添加第二个并行网络实现。
- 文档中的测试数量、版本和 SHA 只在对应命令重新运行后更新；历史条目不回写为当前证据。
- 兼容旧 CLI 的入口可以保留，但新 Renderer、自动化脚本和测试应优先使用 Job/能力门控 API。
