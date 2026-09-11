# 本机真实 CLI 升级复现（2026-09-09）

## 授权与范围

用户本轮明确要求在本机进行真实 CLI 升级复现，并核查目标是否为非正式版本。这覆盖真实安装、ACP 验证和回滚，不覆盖桌面安装包替换、提交、推送或 Release。未发送模型提示词。

使用本机受管 `grok.exe`，起始版本 **1.0.3 (1a29d5bc12)**；沿用 Desktop 的 HTTP/HTTPS 代理设置。没有修改 GROK_HOME，也没有停止其他用户会话：开始时未发现运行中的 Grok/桌面进程。专门创建无提示词测试会话用于 suspend/restore，Desktop 恢复清单和日志在独立测试目录，不覆盖正式 AppData。

原版组使用 Git 标签 `v0.9.4` 的 `CliUpdateService` 源码，修复组使用当前工作树版本；两组均调用真实 CLI 子进程和真实 `GrokAcpAdapter`，没有注入 `testRuntime` 假下载/假版本/假 ACP。不是在已安装 GUI 中点击按钮，GUI 解锁证据仍来自此前真实 Electron DOM 回归。

## 目标发行性质

- 官方 CLI `update --check --json` 返回：current 1.0.3、latest **1.0.24**、channel **stable**、installer **internal**、autoUpdate false。
- 直接读取官方 `https://x.ai/cli/stable` 和 alpha 通道，当时都返回 **1.0.24**。两个通道相同不等于目标是 alpha-only。
- 官方 Windows 对象 `https://x.ai/cli/grok-1.0.24-windows-x86_64.exe` 返回 HTTP 200，144,390,984 bytes；Last-Modified 为 2026-09-07 22:39:55 GMT。
- 完整下载文件 MD5 与官方响应 ETag 相符：`1733487bdcf2cfbab2941096ba5e8940`。SHA-256：`4dc9038205649ec377ae37e09661e6083ee0a9776b2cc3019e7fc8dc74236ef5`。此校验用于确认缓存与官方传输对象一致，不宣称等同代码签名。
- 文件实际执行返回 **grok 1.0.24 (68e414c661e3)**，`version --json` 也返回相同版本。该命令的 channel=unknown 与安装渠道检查的 stable 是不同字段来源，不用前者推断 alpha。
- 官网 Changelog 页面当时仍显示 1.0.13。这是文档和分发通道不一致的证据，不能据此把 stable 1.0.24 判为非正式文件。

参考：[官方 stable 指针](https://x.ai/cli/stable)、[官方更新日志](https://x.ai/build/changelog)。以上通道值是本次时间点的观测，不保证以后不变。

## 网络试验与缓存边界

首先运行原版更新器的真实网络安装。它长时间停留在 downloading；同一代理下单连接 curl 下载官方文件，120 秒仅接收约 6–7 MB。没有等到 Desktop 的 30 分钟上限，主动停止了经 PID/命令行核对的本次更新子进程；旧版未改变，测试会话正常恢复。这个结果是**人工中止慢下载**，不是宣称更新器自行超时。

随后用 8 段 HTTP Range 下载同一官方对象，经长度和 ETag 校验合并为原始 EXE。为把网络吞吐与安装/兼容问题分开，用仅绑定 127.0.0.1 的白名单缓存提供这份原文件，以及升级前备份的 1.0.3。`GROK_CLI_BASE_URL` / NO_PROXY 仅注入本次子进程，未写用户全局环境或配置。缓存服务器不改写二进制，未伪造版本或 ACP；真实 CLI 仍自行执行下载、安装、替换及回滚。

因此，后续通过项证明**官方字节的真实本机升级和 ACP 恢复**，不证明默认公网单连接下载性能已修复。

## 实际结果

| 步骤 | 结果 |
|---|---|
| 原版更新器安装 1.0.24 | 真实安装成功，进入 verifying；本次没有出现“实际版本不是固定目标” |
| 原版新版本探针 | `hub error: not a git repository`，临时 `grok-desktop-probe-*` 目录触发 |
| 原版自动回滚 1.0.3 | 二进制回滚成功，但旧版探针再次报同一个非 Git 错误 |
| 原版恢复会话 | `retained=true` 残留，运行时门禁拒绝恢复；复现回滚后无法连接的故障链 |
| 修复版接管同一真实失败清单 | 重新验证当前 1.0.3，不下载历史目标；核心通过，同一测试会话恢复，恢复状态清除 |
| 修复版再次升级 1.0.24 | updated；initialize/new/resume/close/delete 全部为 successful-probe，运行时 gate passed/liveVerified true |
| 修复版恢复升级前会话 | 同一 Session ID 成功恢复；未发送或重放 Prompt；测试会话通过官方 delete 删除 |

最后验证回滚到测试前 1.0.3，并检查从 1.0.24 创建的无提示词测试会话在旧版恢复。最终机器状态及校验结果见本文末尾补记。

## 仍未证明的部分

- 用户另一台电脑起始版本是 1.0.0，本机是 1.0.3；本轮没有把本机降到 1.0.0。
- 另一台电脑最初的“实际版本不是固定目标”未在本轮复现；不能把它和已证明的可选探针故障混为同一原因。
- 未完成默认公网路径的无干预整次安装；代理吞吐仍是独立问题。
- 当前桌面安装版未更新，新版实测凭据也未复制到正式 AppData，不借测试绕过正式安装的门禁。

## 本地证据

忽略目录 `out/audit/live-cli-upgrade/` 保存原版/修复版 events 与脱敏 diagnostic 日志、测试恢复清单、缓存请求记录、1.0.24 核心通过快照和校验后的官方文件。测试驱动位于 `out/audit/run-live-update.mjs`、`run-cached-live-update.mjs` 与 `build-live-update.mjs`。它们不是产品更新分发机制，不提交本机文件或日志。

## 最终状态

- 真实回滚至 **1.0.3 (1a29d5bc12)** 后，核心 gate passed；在 1.0.24 创建的无提示词会话由 1.0.3 以同一 Session ID 恢复成功，随后官方 delete 成功。
- 最终受管 EXE 的 SHA-256 与升级前备份完全一致：`d118ddef0e14100c85154c114da77e9074951903ac05753a1df2f3413f55b4f7`。
- 测试恢复状态均结束；本次受管 Grok 子进程已退出。本轮没有替换桌面安装版，也没有向正式 AppData 复制测试授权。
- 本轮只补充实机试验和文档，没有新增产品代码。此前 928 离线测试/9 live 跳过是前一轮套件结果；本轮上述手动无提示词 live 流程是独立证据，不能把套件里的 9 项全部标为已通过。
