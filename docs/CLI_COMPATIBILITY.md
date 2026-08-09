# Grok CLI Compatibility

## Desktop 0.7.1 session-foundation note (2026-08-09)

- No new ACP method or wire shape is introduced. New Task remains Desktop-local until first send, then uses the existing configured `session/new` path exactly once.
- Reopening sends the existing local ConversationProjection V2 to the Renderer before the established capability-gated `session/resume` / `session/load` flow starts. ACP replay is still merged by stable block identity.
- A reconnect failure with a valid local projection is reported as `offline`; it does not create a replacement session or silently change the persisted Provider/model identity. Hydration generations discard late UI state from older navigation attempts.
- The 0.7.1 offline suite passes 95 test files/686 tests with 6 live files/9 tests skipped by design. Installed CLI/provider acceptance remains a separate user-verification boundary.

## Cumulative 0.7.0 audit note (2026-08-09)

- The legacy `providers:deep-scan` IPC is retained only for compatibility and delegates to the same `ProviderService.deepScan()` implementation used by the asynchronous Job API; it is not a second network scanner.
- Provider scan cancellation now uses Job ID/generation fencing rather than a mutable timestamp. The job state is checked again after the provider store read and before controller installation, so cancellation during that await cannot issue a probe; late responses are discarded.
- The post-change offline gate passes 94 test files/677 tests with 6 live files/9 tests skipped by design, plus TypeScript, production/resources, public scan, chunk and high-severity dependency gates. Prior 0.7.0 package hashes do not include this source revision and are not reused as evidence.

## ACP session resume/close forward shape (0.2.120 source, Desktop 0.7.0)

- The official 0.2.120 source advertises standard `session/list`, `session/resume` and `session/close` capabilities. The sanitized `initialize-0.2.120.json` fixture records those declarations without retaining account, prompt or filesystem data.
- `session/resume` is capability-gated and is the preferred re-attach path. Its current response may contain only modes/configuration and no `sessionId` or model list; Desktop keeps the requested session identity and uses the runtime handshake as a model fallback.
- A resume failure falls back to `session/load` only for explicit method/parameter capability errors (`-32601`, `-32602` or equivalent unsupported-method text). Timeouts and transport failures are surfaced instead of issuing a second attach that could create an ambiguous session.
- `session/close` is a best-effort resource release before an ACP child is terminated. It is not session deletion; the existing official-first `grok sessions delete` path remains responsible for deletion and local projection cleanup.
- The local stable CLI remains `0.2.118`; 0.2.119/0.2.120 source behavior is forward-parsed and contract-tested only until the stable channel actually offers it.

## 0.2.118 stable adapter / 0.2.119–0.2.120 forward compatibility (Desktop 0.7.0)

- Desktop-managed Grok processes use `--no-auto-update`. Only the update service may mutate the CLI, and it requires an exact version that still matches the stable feed immediately before installation. Public Changelog versions are display-only until the stable feed offers them.
- `initialize` is normalized into a non-sensitive runtime handshake. Session/Prompt/MCP markers, models and reasoning efforts, commands, Recap/Rewind, plugin directories and observed private methods are stored as evidence; unknown response fields are discarded.
- Capability precedence is runtime declaration, successful bounded probe, observed event, then version hint. An observed method can enable its own surface; a version number alone cannot.
- 0.2.118 event handling covers completion-before-background ordering, Auto Compact lifecycle/cancellation and Recap hash deduplication. Unknown events log only method name, schema version and serialized byte size.
- Session deletion is official-first (`grok --no-auto-update sessions delete <id>`). Desktop data is removed only after official success, or after a separate explicit local-only confirmation when the CLI operation fails.
- Forward fixtures parse `x.ai/follow_ups`, `x.ai/models/update` and `x.ai/settings/update`. Model updates keep a managed Provider's local model ID and current selected effort; they do not silently rename it to an upstream or official Grok model.
- `/btw` now has a capability-gated Composer action using the official `session_id` + `question` wire shape; an answer receipt is shown without creating a fake queue/assistant turn, and unsupported CLIs return an explicit unsupported state.
- Standard `session/list` plus optional `x.ai/session/info` and `x.ai/session/usage` are normalized in the main process and exposed through the right-side Session tool. The tool never infers missing model, mode, effort or Token values from Desktop defaults.
- Mermaid Plan blocks now expose copy source/image and open image actions only after strict rendering succeeds. MCP/plugin status, official Git interfaces and automatic doctor fixes remain deferred until stable runtime evidence; a version number alone does not enable them.
- Live acceptance on 2026-08-05 installed exactly `0.2.118 (1e1687c1cf)`, then passed initialize/session/new and official empty-session deletion. A single read-only Plan turn completed in 19.28 seconds with no permission request and an unchanged empty workspace.
- 0.2.118 rejects TOML object arrays serialized as `[[model.*.reasoning_efforts]]`. Desktop now emits the CLI-native string-list form, filters upstream-only `auto/none` from the CLI menu, and keeps richer protocol-specific reasoning evidence in Desktop provider metadata.

## 0.7.0 audit candidate: session identity, terminal settlement and Plan fixture

- Desktop persists the session's local Provider/model identity separately from the upstream alias reported by `session-ready`. Reopening a managed session therefore cannot silently select the global Grok 4.5 default; if the recorded Provider is disabled, missing or cannot establish its gateway, sending is blocked with a structured error.
- `turn_completed`, Prompt RPC completion, cancellation and process exit are reconciled by a stable turn ID. A late event from an earlier turn cannot settle a later queued/interjected turn. Desktop-owned accepted/running queue entries are persisted and atomically moved to terminal state.
- Current CLI Plan behavior is exercised both through a test-only in-memory responder in the packaged/installed UI probe and one isolated live 0.2.118 read-only Plan turn. This does not claim every installed model, Provider or existing long session has been live-tested; those remain user acceptance.
- ACP replay is merged with the local ConversationProjection V2. A partially persisted assistant body receives only a missing suffix; a complete body with different chunk boundaries is not duplicated. If no reliable turn boundary exists, Desktop retains the local projection and marks recovery as unavailable instead of inventing text.
- Provider protocol translation and media/path boundaries remain evidence-based: unsupported capabilities are not inferred, remote media requires an explicit configured Provider Origin, and Renderer-submitted arbitrary local paths are rejected by the main process.

## 0.2.117 Plan permission cancellation and exact-plan-file note (Desktop 0.6.25)

- No new private ACP method is required. A mutating/unknown `session/request_permission` that has no explicit reject option is answered with the standard successful `{ outcome: { outcome: "cancelled" } }` shape; a JSON-RPC error is reserved for real transport/protocol failures.
- Plan auto-approval no longer trusts human-readable tool titles. Explicit read/search/list/fetch/think kinds remain eligible, while execute calls must pass Desktop's bounded command parser; script blocks, subexpressions and static-call syntax are denied before pipeline analysis.
- `fs/write_text_file` in Plan mode is restricted to the exact `plan.md` below the active persisted session directory. This keeps Grok Build's plan artifact available without granting a general workspace or external-path write exception.
- A queued Desktop Prompt is associated with its client prompt ID, allowing the existing `turn_completed` event to settle it if Grok Build omits the original JSON-RPC response. This is lifecycle recovery, not a new queue protocol.

## 0.2.117 Plan ext-method and internal-queue note (Desktop 0.6.24)

- Current open-source Grok Build defines `x.ai/exit_plan_mode` as a successful ext-method response with `outcome` equal to `approved`, `cancelled` or `abandoned`; optional `feedback` is valid only for `cancelled`. A JSON-RPC error is a transport/tool-loop failure, not the wire representation of “continue planning” or “abandon”.
- Current `session/prompt` consumes `_meta.mode`. Desktop sends the per-request Plan/Agent snapshot in addition to `session/set_mode`, treats replayed `current_mode_update` as authoritative and surfaces a failed mode change.
- `_x.ai/queue/changed.runningPromptId` can identify Grok Build's internal execution queue entry for an ordinary direct Prompt. Desktop only creates a follow-up presentation turn when the ID belongs to an explicit Desktop queue/interject operation.
- Live evidence on installed CLI `0.2.117 (f1c0609308)`: `session/set_mode=plan` succeeded, and one isolated real read-only Plan turn emitted no UI permission request, wrote no workspace file and ended idle. This is a narrow Plan lifecycle acceptance, not a claim that every model/tool combination has been exercised.

## 0.2.117 terminal-event and Plan permission note (Desktop 0.6.23)

- Current CLI may publish `_x.ai/session/update` with `sessionUpdate=turn_completed` after the complete visible answer without resolving the original `session/prompt` JSON-RPC request. Desktop treats that turn-scoped event as authoritative completion and ignores a later duplicate response.
- `session/cancel` remains a notification rather than an acknowledged request. Desktop waits eight seconds, then replaces only the affected CLI adapter and reloads the persisted session if it is still working.
- Plan mode uses the existing `session/request_permission` options without a new private method. Read-only calls are selected automatically; mutating/unknown calls are rejected automatically and still face the independent main-process filesystem/terminal gates. Underscore-style kinds and bounded read-only PowerShell pipelines are normalized locally.

## Unlimited interactive-turn note (post-Desktop 0.6.22)

- Desktop no longer places a 30-minute wall-clock timer around `session/prompt` or queued follow-up Prompt requests. This does not require a new ACP method and does not change the CLI's own completion/cancellation behavior.
- Explicit user Stop, process exit and real transport errors still terminate a turn. Managed Provider `inference_idle_timeout_secs` remains the independent no-data timeout and is not a total-turn ceiling.

## 0.2.117 media transport and interject note (Desktop 0.6.22)

- `grok --single --session-id <UUID>` stores relative media artifacts below that transient Grok session rather than necessarily below the execution `cwd`. Desktop now treats only that exact transient session directory as an additional job root, copies validated assets into its conversation cache, and removes the temporary session afterward.
- Zero Data Retention video generation currently fails in the installed CLI tool when the team requires `output.upload_url`; this is an upstream team/API contract, not content moderation. Desktop preserves the first error and stops retrying, but cannot claim CLI video support for that team without a non-ZDR team or a Provider path that implements the upload callback.
- `x.ai/interject` does not create a second Desktop ACP process. It submits a high-priority follow-up in the same session. Queue notifications may omit a state, so Desktop preserves its locally accepted `interjected` state, makes it non-removable, and creates a separate presentation turn when `runningPromptId` announces execution.

## 0.2.117 concurrent-conversation note (Desktop 0.6.21)

- No new ACP method is required. Each Desktop conversation continues to own an independent Grok CLI ACP process; the change removes a Renderer-global Promise lock that incorrectly serialized otherwise independent adapters.
- `session:send` still resolves at terminal turn completion. Desktop now treats the existing session-scoped `status=working` event as request acceptance, allowing queue/interject operations while preserving the original in-flight request and its errors.
- The process manager retains up to eight resident adapters and only reaps idle, non-focused sessions. Working and permission-waiting conversations are not evicted by the cap or the idle reaper.

## 0.2.117 media-session and Plan read-only note (Desktop 0.6.20)

- No new private ACP method is required. Plan mode answers the existing `session/request_permission` only for ACP kinds `read`, `search`, `fetch`, `think`, or an `execute` command accepted by Desktop's bounded read-only gate. Mutating and unknown requests are not auto-approved.
- Fixed CLI media invocation now adds the public `--session-id <UUID>` option to `--single`. The temporary CLI session is deleted after concrete artifacts have been validated and copied to Desktop's per-conversation media cache, preventing the headless task from becoming a normal sidebar conversation.
- Relative streaming-json artifacts such as `images/1.jpg` are resolved against the actual execution `cwd`; canonical workspace validation is still performed before the file is copied.

## 0.2.117 approval presentation note (Desktop 0.6.19)

- No ACP or private-method change. Permission buttons are still generated from the CLI-provided `options`, and interactive plans still answer the original `x.ai/exit_plan_mode` request exactly once.
- Unified Agent Diff and compact Codex-style decision surfaces are Renderer presentation changes. Successful decisions continue to be removed only after the existing main-process response write and `interaction-resolved` event; restored process-local IDs remain expired.

## 0.2.117 interaction and ACP Diff note (Desktop 0.6.18)

- Installed CLI `0.2.117 (f1c0609308)` still uses the existing permission/question/`x.ai/exit_plan_mode` request-response boundary. Desktop adds no private method; it now keeps read-only plan notifications separate from the actionable JSON-RPC request and expires process-local request IDs after transport rebuild.
- The current open-source Grok Build ACP conversion emits file edits as `ToolCallContent::Diff` with a path, new text and optional old text. Desktop consumes the wire `content` block directly, preserves it across sparse streamed updates and calculates presentation-only line statistics.
- Non-Git Agent changes remain a Desktop projection of ACP tool writes. Git-only staging, commit and branch operations are not synthesized when the workspace is not a repository.

## 0.2.112 Provider/media hotfix note (Desktop 0.6.17)

- No ACP or CLI wire method changes. The hotfix only reconciles Desktop-owned legacy TOML model tables before emitting one current managed block.
- Explicit Provider media configuration may be used without scan evidence, but success still requires a concrete validated image/video asset. A model name or an asynchronous job ID is never treated as generated media.
- The normal Provider manager no longer launches automatic context-limit probes. Context values come from model-list metadata or explicit user input; the existing bounded main-process probe implementation is not part of the normal UI path.
- The per-model media-only scan uses that model's current protocol and does not scan other models or Providers.

## 0.2.112 projection/media note (Desktop 0.6.16)

- Desktop 0.6.16 adds no required ACP method or private CLI wire contract. Conversation projection is local presentation persistence and never rewrites the original Grok session history.
- Fixed CLI media invocation uses `grok --single <prompt> --output-format streaming-json --always-approve --tools <fixed allow-list>`, where the allow-list is limited to `image_gen`, `video_gen`, `image_to_video` and `reference_to_video` for the selected media operation.
- A CLI media run is successful only when streaming JSON yields a concrete validated file or URL artifact. Command availability or a model name alone is not treated as media capability evidence.
- Context metadata and bounded lower-bound probes are compatibility evidence only. Exact context-limit probing is explicit, single-model and user-bounded; it is not part of automatic compatibility detection.

## 0.2.112 Provider translation note (Desktop 0.6.15 locally installed candidate)

- The ACP method boundary is unchanged. Desktop-spawned custom models still use ordinary CLI model configuration and the existing confirmed private effort switch; filesystem, credentials, network and translation remain in the Electron main process.
- The loopback gateway can now translate Chat Completions, Responses, Anthropic Messages and Gemini GenerateContent. Same-protocol SSE is streamed directly. Cross-protocol SSE sends legal comments during bounded ordered conversion so it does not create a silent idle interval.
- Model effort vocabulary comes from CLI/upstream metadata, an explicit model setting or a live capability scan. Exact `grok-4.5` migrates the old generated three-level value to five locally verified selectable values; unknown/future models are not assigned a guessed universal list.
- Current controlled live evidence: local grok2api Grok 4.5 completed a Responses xhigh ACP turn; remote CPA Grok 4.5 completed a Responses xhigh ACP turn; remote CPA Gemini completed a Chat ACP turn after strict Schema cleanup. Current CPA Claude and local image generation return HTTP 502 and remain unavailable boundaries.

## 0.2.112 audit-fix note (Desktop 0.6.14 source candidate)

- The CLI/ACP method boundary is unchanged. The Desktop gateway keeps body-free terminal observations for successful and failed same-protocol routes so a CLI-side parser failure after HTTP 200 can still be attributed without exposing request/response bodies.
- A downstream caller closing a stream is cancellation evidence, not an upstream Provider failure. It remains visible as a bounded in-memory observation but is excluded from the Provider failure ring.
- The 0.6.13 unsigned Anthropic response repair now uses internal markers that the Desktop ACP adapter restores as `thought` events. Valid signed blocks remain unchanged, no signature is forged, and this is still response-shape repair rather than cross-protocol translation.
- No live compatibility claim is added in this candidate: the current default model's local upstream was not running and the user explicitly deferred that acceptance.

## 0.2.112 Anthropic Messages note (Desktop 0.6.13)

- Grok CLI strictly deserializes Anthropic `thinking` content blocks and rejects a streaming `content_block_start` that omits `signature`. The Desktop same-protocol gateway now preserves valid signed streams and downgrades only that malformed unsigned block to ordinary `<think>` text; this is response-shape repair, not Chat/Responses/Messages cross-protocol translation. An isolated `kiro-claude-opus-4.8-thinking` xhigh ACP turn through the current local Kiro endpoint completed after the repair.

## 0.2.112 inference transport note (Desktop 0.6.12)

- The installed CLI's embedded configuration reference declares `inference_idle_timeout_secs = 600` and `max_retries = 8`. Desktop-managed Provider models therefore default to the native 600-second idle value; 0.6.11's 360-second override was not the source of observed 58/88-second disconnects.
- Managed Provider traffic can now either inherit the Desktop proxy or use a direct Electron session partition. This affects only Desktop-spawned Provider discovery/inference; direct terminal use keeps its own environment and configuration.
- Gateway diagnostics distinguish downstream cancellation, gateway response-header timeout, upstream connection failure and post-header stream truncation. Request/response bodies, credentials and full upstream URLs remain excluded.

| Date | CLI | Plugin reference | Status | Evidence |
|---|---:|---:|---|---|
| 2026-07-15 | 0.2.101 | 1.5.11 | Verified | `version --json`, `update --check --json`, `models`, ACP `initialize/session/new`, real Grok 4.5 reply, persisted reload/context, and live `none/minimal/low/medium/high/xhigh` effort switches confirmed by `_x.ai/session_notification.model_changed` |
| 2026-07-16 | 0.2.101 | 1.5.11 | Verified for v0.2 adapters | Bundled `session_reader.py codex show --json` parsed the current Codex task; OAuth weekly and monthly billing endpoints both returned HTTP 200 through the configured proxy; no token was printed |
| 2026-07-16 | 0.2.101 | 1.5.11 | Verified for v0.2.1 media | ACP publishes `/imagine`; local CLI docs describe `/imagine-video`, while the advertised Imagine skill contains `image_gen`, `image_edit` and `image_to_video`. The desktop uses the ACP-advertised `/imagine` skill for video rather than assuming the unadvertised alias |
| 2026-07-17 | 0.2.101 | Grok Build source `8adf9013a0929e5c7f1d4e849492d2387837a28d` | v0.3 optional extension compatibility | Both process-level `grok agent --plugin-dir <path> stdio` and `session/new._meta.pluginDirs` load the packaged plugin and publish `/computer`. This installed CLI returns `Method not found` for `x.ai/plugins/list`, `x.ai/mcp/list` and `x.ai/commands/list`; the desktop therefore uses CLI JSON fallback. Loopback MCP token/tool inventory and PNG result contracts are verified independently. |
| 2026-07-18 | 0.2.101 | Grok Build source `8adf9013a0929e5c7f1d4e849492d2387837a28d` | v0.3 Computer Use accepted | Real Grok completed the injected Skill/MCP visual click and client-rejected delete-risk loops. The xAI Official `chrome-devtools-mcp` 1.6.0 disable/enable probe restored source/version/commit/status. Packaged Electron authorization, risk dialog, lifecycle and global emergency stop passed. |
| 2026-07-18 | 0.2.101 | Built-in Computer plugin/host 0.3.1 | v0.3.1 visible-control compatibility | Real Grok repeated the one-click and rejected-risk loops with default ordinary-app access. Packaged Electron verified the blue overlay, live action strip and dynamic `Esc`; the native 24-flow probe verified physical cursor arrival. UAC remains a Windows secure-desktop handoff rather than a model action. |
| 2026-07-19 | capability-probed | Public app 0.4.0 | v0.4 public compatibility layer | Unknown CLI versions are accepted after non-billable `version/models/ACP initialize` probes. Agent help dynamically selects `--effort` or `--reasoning-effort`; optional reader/quota/media/plugin/Computer failures only disable their surface. Default verification is offline; previous 0.2.101 live evidence remains valid until `verify-live.ps1` is explicitly rerun. |
| 2026-07-20 | 0.2.101 | Public app 0.4.2 local candidate | v0.4.2 changes the Electron startup, composer, menu and theme clients without changing ACP/Grok wire contracts. Offline verification passed 167 tests, packaged content/UI probes and the one-shot `/computer <instruction>` composition contract. The explicit real Grok loop was also rerun: the fixture reached `increment:1`, stopped normally, and the delete-risk sentinel requested confirmation and remained untouched after rejection. |
| 2026-07-20 | 0.2.106 (`bde89716f6`) | Grok Build source `ba76b0a683fa52e4e60685017b85905451be17bc` | v0.5 queue/provider/task compatibility | Generated provider overrides pass isolated `inspect --json` and `models` probing. Non-billable ACP initialization/session creation publishes `/imagine` and the injected `/computer`; live effort switching succeeds. Queue changes are driven by `x.ai/queue/changed`; mutations use versioned notifications, same-turn input uses `x.ai/interject`, fork/rewind use their official request shapes, and task/sub-Agent inventory unwraps `ExtMethodResult`. Private plugin/MCP/command inventory remains optional and falls back to CLI JSON on this build. |

| 2026-07-21 | 0.2.106 (`bde89716f6`) | Public app 0.5.12 release | No Grok wire or application-runtime change from the locally accepted 0.5.11 build. The release-only change removes unsupported Hosted Runner GUI/InteractiveToken repetition; provider, automation, plugin, marketplace and MCP probing is unchanged. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.13 hotfix | No ACP or Grok CLI wire change. The fix copies Chromium Local State into the headless worker's isolated session before Electron ready and updates task-center presentation; an existing encrypted task passed a non-executing DPAPI probe. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.14 hotfix | No ACP wire change. The worker now synchronizes rotated OAuth credentials by matching the canonical `auth.json` identity to the task's fixed account and preserves concurrent CLI refreshes. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.15 hotfix | Packaged OAuth automation completed a real file-read turn and returned a resumable session. This CLI returns `Method not found` for `x.ai/rewind/points`; the adapter now treats that private method as optional and returns an empty capability result instead of failing the UI. Auto-mode ACP permission requests are answered directly. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Public app 0.5.16 release | `session/load` reopened a packaged scheduled task's fixed OAuth/model session for a second real run. Both runs completed with the same session ID; manual context cleanup then deleted the dedicated Grok session. No ACP wire extension was added. Release workflow `29846404781` succeeded for commit `e4dfb62`, and `v0.5.16` is the public Latest release. |
| 2026-07-22 | 0.2.106 (`bde89716f6`) | Local app 0.6.1 candidate | No new required CLI method. Pasted images still reach ACP as standard image content blocks; `clientMessageId`, durable previews, queue/interjection presentation and cache cleanup are desktop contracts. ACP image replay is merged client-side and cache paths are excluded from prompt text. Final package/installed acceptance is offline and sends no model prompt. |
| 2026-07-22 | 0.2.106 (`bde89716f6`) | Local app 0.6.2 development candidate | No new paid/private ACP requirement. Turn duration/outcome is Desktop presentation metadata. Review uses local Git through fixed main-process argument arrays and stdin; Renderer sends only typed scope/file/hunk IDs. Last turn intersects current Git changes with actual ACP write locations. |
| 2026-07-23 | 0.2.106 (`bde89716f6`) | Local app 0.6.3 installed hotfix | No ACP wire change. Scheduler decoding/diagnostics and unified Renderer navigation are Desktop/Windows fixes; non-Git Review capability checks use local Git only. |
| 2026-07-23 | 0.2.106 (`bde89716f6`) | Public app 0.6.4 release | No new ACP/private-method requirement. Lazy Review index/detail remains local fixed-argument Git. Provider draft testing/discovery is a bounded main-process GET to the configured model-list endpoint and never sends inference content; Renderer receives typed candidates without credentials. PR #13 and Release workflow `29993675891` passed; `v0.6.4` is the public Latest release at `df5db6b`. |
| 2026-07-26 | 0.2.112 (`9bbd559437`) | App 0.6.5 release candidate | Plan decisions answer the original `x.ai/exit_plan_mode` request exactly once and no longer emit a synthetic Prompt. Queue/interjection retains the published private-method shapes. An isolated `GROK_HOME` ACP turn proved environment-backed model `base_url` expansion against a local endpoint, and one authorized minimal current-Provider turn passed through the loopback Schema gateway without the former empty-enum HTTP 400. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.6 public stable release | No new required ACP method. `retry_state` is now presented when this CLI publishes it, Prompt timeout sends the existing standard cancel notification, and failure records are scoped to one spawned CLI process. Non-Git Review, Token rollups and Computer Use action-schema changes are Desktop-local contracts. Cross-protocol Provider translation remains explicitly deferred; same-protocol streaming and Gemini/strict Schema cleanup retain the verified 0.6.5 boundary. PR #15 and release workflow `30216468056` passed the hosted gates and published `v0.6.6` as Latest. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | Post-0.6.6 Provider hotfix source | ACP reports the upstream route ID after a custom-model turn, so the Desktop now preserves the explicitly requested local model ID. Session launch also refreshes Windows user-level Provider environment values. A current-Provider `grok-4.5` minimal ACP turn passed through the same-protocol gateway and retained the local ID; no new ACP method or cross-protocol translation is introduced. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.7 local acceptance candidate | No new ACP or paid inference requirement. The installed CLI already bundles the `resume-claude` Skill and the approved `session_reader.py <claude|codex|cursor> <list|show>` interface. Desktop invokes `/resume-claude` only after creating a normal ACP session, keeps Claude JSONL read-only and records the continuation locally. Targeted parser/catalog contracts pass; expanded and installed-app acceptance is intentionally deferred until user feedback. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.8 local routing hotfix candidate | `session/load` can return the persisted upstream model ID even when the process was launched with a provider-prefixed local configuration ID. Desktop now reapplies the local ID before sending. Effort controls consume `_meta.supportsReasoningEffort` and `_meta.reasoningEfforts`; an undeclared Provider model is not assumed to support arbitrary values. Failed private effort confirmation is non-destructive rather than process-restart based. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.9 local Provider authentication hotfix candidate | No ACP method or protocol translation is added. The loopback gateway no longer forwards CLI authentication to custom upstreams; the main process injects the selected Provider's freshly read environment credential. Direct `/models`, direct streaming Chat Completions and one full current-Provider ACP turn all returned successfully. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.10 local per-model Provider capability candidate | CPA `/responses` accepted default and all six vocabulary values; an isolated ACP Responses session confirmed low → high and completed one turn. Provider defaults may now be overridden per model in CLI config, while the gateway remains same-protocol pass-through and does not claim hidden translation. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.11 locally installed inference idle-timeout hotfix | CLI accepted both an isolated Desktop-style model entry and the migrated current managed config with `inference_idle_timeout_secs = 360`; the latter passes `inspect --json`. ACP method contracts are unchanged; the setting extends only consecutive inference-stream silence and does not reduce the existing 1800s interactive turn ceiling. |
| 2026-07-27 | 0.2.112 (`9bbd559437`) | App 0.6.12 locally installed Provider transport candidate | Desktop restores the CLI-native 600-second inference idle default and lets a managed Provider use an isolated direct or app-proxy Electron route. No ACP method or cross-protocol translation is added. |
| 2026-07-28 | 0.2.112 (`9bbd559437`) | App 0.6.13 locally installed Anthropic compatibility candidate | The current Kiro Claude 4.8 xhigh ACP turn exposed a malformed Anthropic SSE thinking block without `signature`. The same-protocol Desktop gateway now preserves valid signed events and downgrades only unsigned thinking to ordinary text. The isolated real turn completed, and the installed ASAR contains the repair; no new ACP method is required. |
| 2026-08-01 | 0.2.117 (`f1c0609308`) | App 0.6.22 public stable release | No new mandatory ACP method is introduced. Provider translation, conversation projection, media caching, multi-session submission isolation and non-Git Agent Diff remain Desktop contracts around the documented/optional CLI methods recorded above. PR #19/#20 and release workflow `30693283048` passed hosted verification and published `v0.6.22` as Latest. |

Every accepted CLI update must pass `initialize` and `session/new`; a version banner alone is not sufficient.

## v0.6 accepted capability snapshot (2026-07-23)

Installed CLI `0.2.106 (bde89716f6)` advertises Worktree creation/resume flags, `grok worktree list/show/rm/gc`, experimental cross-session Memory, Agent definitions, Personas and the Agent Dashboard. Its bundled official ACP guide lists `x.ai/git/*` and `x.ai/git/worktree/create|remove|apply|list|gc`, while `grok inspect --json` reports agents, skills, plugins, MCP/LSP servers, configuration sources and project trust. The v0.6 client capability-probes private methods and provides the controlled Git/read-only-history fallbacks defined below; it never launches `grok dashboard`.

Memory remains disabled by default. The approved desktop behavior enables it per workspace without silently modifying global `config.toml`; Memory layout or command incompatibility disables only the Memory surface. Agent and Persona files remain owned by Grok's documented user/project directories, with built-in and plugin definitions treated as read-only.

The first v0.6 implementation slice now exposes a version-cached `CliCapabilitySnapshot`. Static probing is limited to root/Agent/Worktree/Memory help and `inspect --json`; it does not send a prompt or infer private ACP support. On CLI `0.2.106`, live non-billable help verification confirmed `--worktree`, `--worktree-ref`, `worktree list/show/rm/gc`, `--experimental-memory`, `--no-memory`, `memory clear`, Agent flags and `dashboard`; `inspect --json` returned the documented agents/plugins/MCP/config/trust sections. Four focused snapshot tests and TypeScript pass.

The v0.6 Git workbench uses the installed system Git independently from Grok ACP and therefore does not change the CLI wire compatibility boundary. Local verification used Git `2.52.0.windows.1`, temporary repositories and a local bare remote for porcelain-v2 status, Diff, stage/unstage, stdin commit, branch/conflict handling and Pull/Push. A loopback stalled HTTP fixture verified explicit cancellation; no real remote was contacted.

Worktree inventory/create/apply/remove/GC is wired to prefer `x.ai/git/worktree/*` when an idle ACP session supplies direct runtime evidence; method-not-found or unavailable-session cases use the controlled system-Git compatibility layer. The fallback passed temporary-repository create/recovery/apply/conflict/retention/removal/GC tests. This session verified official inventory preference with a mock contract, but did not claim a live private-ACP Worktree mutation on CLI `0.2.106`.

The Memory center now follows CLI `0.2.106` source-compatible storage exactly: normalized `org/repo` identity when `origin` exists, ASCII slug plus the first eight BLAKE3 hex characters, global/project `MEMORY.md`, and per-project `sessions/`. Isolated tests confirmed identical identity for a repository, subdirectory, clone and Git Worktree. The desktop leaves global `config.toml` untouched, stores default-off enablement in AppData, injects `GROK_MEMORY=1|0` per process, disables `GROK_MEMORY_LOG`, constrains main-process I/O to `GROK_HOME/memory`, and calls `grok memory clear` only with fixed documented arguments. Confirmed remember actions are dispatched through the active ACP session as native `/remember`; `/flush` and `/dream` support explicit actions plus the configured idle session-end policy. Exact-entry deletion remains a desktop-side conflict-checked edit of the same native file layout. The offline candidate intentionally did not repeat a paid live Memory rewrite.

The Agent/Persona center follows CLI `0.2.106` discovery precedence and file formats: project `.grok/agents/*.md` and `.grok/personas/*.toml`, user `GROK_HOME/agents|personas`, bundled definitions, plus read-only plugin Agent directories reported by `inspect`. Agent frontmatter uses native snake-case fields such as `prompt_mode`, `permission_mode`, `disallowed_tools` and boolean `agents_md`; Persona parsing accepts `instructions_file`, `reasoning_effort`, `default_capability_mode`, `default_fork_context`, `default_isolation = "none"|"worktree"` and `[[inputs]]`/`[[outputs]]`. Every mutation uses fixed `grok inspect --json` arguments after an atomic write and persistent backup, then rolls back on failure. The installed CLI does not advertise a definition hot-reload method, so only idle sessions are restarted; running or waiting sessions are left intact. An isolated `GROK_HOME` Electron/CDP probe created user-scoped Agent and Persona definitions through typed IPC, confirmed inspect acceptance, rendered both raw formats in bundled Monaco and preserved unknown fields without editing `config.toml`; project-scope paths and priority are covered by isolated service tests.

Execution profiles compile to `grok agent --model`, the detected effort spelling, `--always-approve`, `--agent-profile`, protected environment values and `session/new._meta.rules`. The installed `grok agent --help` publishes model/effort/always-approve/agent-profile, while the root TUI publishes `--max-turns` but ACP Agent stdio does not. Consequently the desktop visibly marks profile `maxTurns` unsupported and refuses to launch a non-empty value rather than silently dropping it. Persona allow-lists and default child isolation are labelled degraded rule mappings because CLI `0.2.106` does not publish hard session fields for them.

The desktop Agent Dashboard is an application projection of ACP status/tool/meta/sub-Agent events, task inventory and the existing session catalog. When live child inventory is absent, persisted history is forced to `unknown`/terminal states and labelled read-only; no historical record is presented as running. Stop requests use the existing ACP task/sub-Agent cancellation path, not the TUI Dashboard command.

Local app `0.6.0` candidate verification retained CLI `0.2.106` as the accepted boundary. One temporary-repository integration flow passed without sending a prompt, the packaged Profiles/Dashboard/new-session/task-health probe passed, and one formal Setup/Portable build passed Fuses and public-artifact scanning. No live private Worktree mutation, paid `/remember` rewrite, CLI rollback, tag or public Release was claimed; the Windows version/upgrade/DPI/display matrix remains a separate release gate.

Local app `0.6.1` changes only the desktop presentation and attachment lifecycle above. Standard ACP image blocks, queue notifications and interjection behavior remain compatible with the same CLI boundary. The installed Setup and Portable pass offline shell/image-reopen acceptance, but no new private ACP capability or paid model behavior is inferred from that evidence.

Local app `0.6.3` changes Windows task decoding and application navigation only. Local app `0.6.4` changes the right-pane/Review presentation and provider management. Model discovery is deliberately outside ACP: the main process performs only a bounded model-list GET using the user's draft provider configuration, rejects redirects and oversized responses, and returns sanitized model candidates. Neither version expands the accepted CLI boundary or sends a paid prompt during offline acceptance.

Local app `0.6.5` keeps the Renderer/ACP trust boundary unchanged. The Provider compatibility gateway is a main-process loopback transport override for Desktop-spawned CLI sessions; direct command-line use continues to see the configured upstream environment value. The isolated 0.2.112 probe completed `initialize`, `session/new` and a local-only Prompt through `${ENV}` `base_url`. The separately authorized current-Provider probe sent one minimal Prompt and recorded only the Schema-change count, status path and timing—not the credential or request/response bodies.

Local app `0.6.6` does not widen that CLI requirement. It consumes an optional private retry lifecycle only when present and otherwise degrades to the existing working status; standard ACP cancel is used for an expired Prompt budget. Provider routing in that public release remains same-protocol, loopback-only and process-scoped.

Local app `0.6.9` keeps the same protocol and CLI boundary. Authentication at the loopback edge is now authoritative: CLI-supplied bearer/API-key values are removed and only the selected Provider's main-process environment values are sent upstream. This prevents CLI xAI auth recovery from replacing a valid custom-Provider credential.

Local app `0.6.10` keeps effort switching on the already documented private `session/set_model` extension and requires its `model_changed` confirmation. Capability selection is model-scoped: declared upstream metadata or an explicit user list wins, exact `grok-4.5` receives the installed CLI catalog's high/medium/low only as a missing-metadata suggestion, an explicit empty list remains empty, and unknown future models remain undeclared. The current CPA profile uses a manual five-value list and a Responses override only on its Grok 4.5 model; this is ordinary persisted Provider configuration rather than a host-specific branch.

Local app `0.6.15` keeps the same ACP and effort-confirmation boundary while adding a main-process protocol translator and capability evidence store. A scan proves request/response behavior only for the tested Provider/model/protocol at that time; accepted effort parameters are not presented as proof of hidden upstream reasoning semantics.

## Private effort extension

CLI `0.2.101` accepts a live request shaped as:

```json
{
  "method": "session/set_model",
  "params": {
    "sessionId": "...",
    "modelId": "grok-4.5",
    "_meta": { "reasoningEffort": "high" }
  }
}
```

The client considers the switch complete only after a matching
`_x.ai/session_notification` with `sessionUpdate: "model_changed"`. Because
this is a Grok-private extension rather than standard ACP, 0.6.8 offers only
the values declared by the active model and leaves the current session intact
when confirmation is absent. Restarting and loading a persisted session is not
a valid effort fallback: the CLI restores the historical effort and upstream
model alias from that session.

## Optional v0.2 capability probes

- `scripts/probe-v020-compatibility.ps1` probes the bundled Codex reader and the allow-listed OAuth weekly/monthly billing endpoints.
- `scripts/verify-live.ps1` can require both quota calls for an explicitly selected real OAuth profile; default `verify.ps1` never reads real auth data or queries billing.
- CLI update verification keeps ACP `initialize/session/new` as the rollback boundary. Codex-reader or quota-adapter failure is recorded as an optional compatibility diagnostic and does not roll back an otherwise valid ACP CLI.

## Media capability rule

- `scripts/probe-grok.mjs --require-media` requires the live ACP session to publish a usable Imagine workflow.
- Direct `/imagine-video` is preferred only when ACP advertises it.
- On CLI `0.2.101`, ACP advertises `/imagine` but not `/imagine-video`; the app submits an explicit `image_to_video` request through the advertised Imagine skill.
- The Renderer never calls image/video endpoints or receives media credentials directly.

## v0.3 extension and Computer Use rule

- `scripts/probe-grok.mjs --require-extensions --plugin-dir <path>` verifies session-level plugin injection and records private extension availability without treating optional methods as the ACP rollback boundary.
- On CLI `0.2.101`, plugin and marketplace inventory use `grok plugin ... --json`, and MCP inventory/diagnostics use `grok mcp ... --json` when private ACP methods are absent.
- `@modelcontextprotocol/sdk` is pinned directly. The per-session Streamable HTTP endpoint binds only to `127.0.0.1` and requires a distinct random Bearer token.
- Optional plugin/MCP/Computer capability loss disables or diagnoses only the extension surface. ACP `initialize + session/new` remains the automatic CLI rollback boundary.
- The in-app updater and `scripts/update-grok.ps1` probe process/session `pluginDirs` and the packaged x64 helper as optional capabilities after the core ACP probe. Optional probe failure is logged but does not trigger a CLI rollback.
- The in-app updater now runs the native helper's JSON self-test rather than checking file existence only. The repository update script additionally runs the 24-flow deterministic test application and reversible official-plugin state probe.
- Live model visual/risk acceptance is deliberately opt-in (`verify-live.ps1 -RequireLiveComputerAction`) so default CI and ordinary CLI checks never start a billable or foreground-changing model task.
- The packaged `/computer` Skill and Windows helper do not call OpenAI APIs and do not reuse Codex proprietary Computer Use files.
- From app `0.3.1`, ordinary non-protected applications do not require a per-app prompt unless the user enables `confirmNewApps`; high-impact confirmation and the protected-process denylist are unchanged.
- Pointer actions visibly move the physical Windows cursor. The blue overlay and temporary global `Esc` are Electron client features and do not depend on a private Grok CLI method.
- UAC secure desktop and higher-integrity targets pause for manual user completion. The updater treats this as an intentional Windows boundary, not a failed CLI compatibility probe.
