# Feature Matrix

## 0.7.0 累计变更一致性审计（2026-08-09）

| Area | Status | Evidence / boundary |
|---|---|---|
| Cumulative source audit | Source verified | Audited 5 commits / 150 changed files from `origin/main`; no parallel production scanner or projection replay store was found. CSS has one ordered entrypoint; 71 pre-existing base/shell selector overrides are documented cascade debt, not a second mounted shell. |
| Provider scan cancellation | Focused verified | Cancellation no longer depends on `updatedAt`; Job ID/generation invalidates late responses and both queued and controller-not-yet-installed cancellation paths are checked before the first request. |
| Compatibility IPC | Source verified | Legacy `deep-scan/cancel-scan` remains a compatibility wrapper around the single `deepScan()` core; new Renderer uses Job API. |
| Media inactivity semantics | Focused verified | A bounded startup grace is separate from the configured post-output inactivity timer; continuous output re-arms inactivity and there is no wall-clock ceiling. |
| Reopen attachment fixture | UI probe verified | Offline reopen restores through the same main-process attachment ledger as production; the virtualized probe scrolls to the image turn before asserting mounted previews. |
| Post-fix source candidate | Offline verified | 94 test files/677 tests pass; 6 live files/9 tests skip by design. TypeScript, production/resources, 342-file public scan, chunks, native self-test and high-severity audit gate pass. Packaging/install is deliberately not claimed after the E-drive failure. |

## v0.7.0 ACP 0.2.120 forward-compatibility A–D (2026-08-06)

| Area | Status | Evidence / boundary |
|---|---|---|
| Runtime session capability evidence | Focused verified | Sanitized 0.2.120 initialize fixture and CLI update tests record `session/list`, `session/resume` and `session/close`; the installed stable CLI is still 0.2.118. |
| Resume-first session lifecycle | Contract verified | Resume is attempted only when declared, falls back to `session/load` only for capability errors, preserves the requested ID when the resume response omits it, and sends best-effort standard close before child teardown. |
| Plan model switching | Contract verified | The model selector remains enabled only while an interactive Plan decision is pending; permission/question waits remain locked and managed Provider identity is retained. |
| ACP attachment/media replay | Focused + renderer verified | User-message replay carries stable IDs and attachment previews; resource links/direct images/MCP extracted images are merged and content-deduplicated; source-less media events remain independent. |
| Capability-gated `/btw` | Contract + focused verified | Official `session_id`/`question` wire shape, answer receipt and unsupported fallback are covered; the Composer exposes the action only when the current runtime advertises the command. |
| Official Session surfaces | Contract + UI verified | `session/list`, `x.ai/session/info` and `x.ai/session/usage` are normalized in the main process and exposed in the right-side Session tool; missing declarations remain an explicit empty state. |
| Mermaid Plan actions | Source + build verified | Strict Mermaid rendering now offers copy source, copy image and open image after successful render; no claim is made that every future CLI emits Mermaid blocks. |
| Current milestone boundary | Local candidate | 94 test files/676 tests pass, 9 tests skip by design; TypeScript and production build pass. Stable 0.2.119/0.2.120 live evidence, provider acceptance and `doctor fix` remain deferred; no push or Release is made. |

## v0.7.0 comprehensive audit candidate (local, not released)

| Area | Status | Evidence / boundary |
|---|---|---|
| CLI controlled updates | Focused + installed verified | Every managed ACP/probe path uses `--no-auto-update`; exact stable target, concurrent click coalescing/rejection, verification, rollback and session restoration are unit-tested. This machine updated exactly from 0.2.117 to stable 0.2.118 and rechecked current/no-update. |
| CLI runtime capability snapshot | Fixture + live handshake verified | Sanitized real 0.2.117/0.2.118 handshakes plus 0.2.118 lifecycle and official-source 0.2.120 forward fixtures cover Session/Prompt/MCP, models/efforts, commands, Recap/Rewind/plugins and unknown fields. Runtime declaration/probe/event evidence outranks version hints. |
| CLI 0.2.118 lifecycle | Focused + minimal Plan live verified | Completion-before-background, Compact cancellation, Recap hash dedupe, unknown-event redaction and official-first session deletion are covered. One read-only Plan turn completed in 19.28s with no permission card and no workspace writes. |
| CLI 0.2.118 custom-model TOML | Focused verified | Managed `reasoning_efforts` use CLI-native strings rather than rejected array-of-table output; upstream-only `auto/none` remain Desktop metadata and legacy object arrays are migrated on managed Provider launch. |
| CLI 0.2.119–0.2.120 forward parse | Fixture + capability-gated UI | Follow-ups, models/settings updates and runtime timeline events parse only when observed; `/btw` and Session info/usage/list surfaces are now wired behind evidence. MCP/plugin status, official Git UI and doctor fixes remain deferred until stable runtime evidence. |
| Session runtime identity | Focused verified | Session-scoped Provider/local model/upstream alias/effort/mode/profile; failed managed-provider launch is fail-closed; fork inherits parent runtime. |
| Plan/permission/stop lifecycle | Focused + live Plan + installed fixture verified | Plan receipt closes the old gate before async mode reconciliation; stable turn IDs settle duplicate/late terminal events; isolated responder covers three Plan decisions, permission allow/deny and Stop. CLI 0.2.118 minimal read-only Plan passed live; an existing long-session Stop remains user acceptance. |
| Persisted queue | Focused verified | accepted/running entries survive restart and move atomically to terminal; late snapshots cannot resurrect or duplicate user messages. |
| Conversation projection replay | Focused verified | V2 projection stores visible blocks and merges ACP replay by stable user turn/content suffix; partial answers and re-chunked complete answers are covered. |
| Store/automation concurrency | Focused verified | Cross-process transaction lock/owner fencing and explicit cancellation API; no fixed 24-hour total runtime, optional ACP inactivity is separate. |
| IPC/path/media boundaries | Focused verified | Runtime schemas, Picker/session/workspace binding, junction/symlink checks, executable-open rejection, session-bound media handles and explicit Provider-Origin remote fetch. |
| UI and delivery gates | Packaged + installed verified | Current v0.7 probe, Plan/permission/Stop fixture wiring, physical 125%–200% scaling, layout regression and renderer chunk/worker gates pass against the packaged and per-user installed binaries. |
| Release/install | Installed locally for acceptance | 94 test files/676 offline tests pass; 6 live files/9 tests skip by design. Production/resources and the previous package/install checks remain valid; the current source/build still needs the final post-change package refresh. No push or Release before user acceptance. |

## v0.6.25 local Plan permission and terminal-recovery hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Plan command gate | Focused verified | Script blocks, subexpressions, static-call syntax, redirection, expansion and mutating pipeline stages are rejected before any read-only allowlist decision. |
| Plan tool gate | Focused verified | Auto-approval uses explicit normalized ACP kinds or a parsed bounded command; display titles and tool names cannot turn an unknown/mutating request into a read operation. |
| Plan filesystem gate | Focused verified | Only the exact persisted session `plan.md` can be written while Plan is active. Other workspace/external paths and an existing symlink target are denied in the main process. |
| Permission cancellation | Contract verified | A denied request without a CLI-provided reject option receives ACP `outcome=cancelled` and clears the waiting interaction rather than returning a JSON-RPC error. |
| Queued terminal settlement | Contract verified | A Desktop-owned queued prompt is tied to its prompt ID, so `turn_completed` clears it even if the CLI omits the Prompt response. |
| Stop feedback | Packaged/source verified | Renderer awaits the existing bounded cancel/recovery path and exposes success or failure beside the Composer. Real stuck-CLI timing remains user acceptance. |
| Delivery | Installed locally for acceptance | 82 offline files/488 tests pass; 6 live files/9 tests skip by design. TypeScript, production/resources, 303-file scans, native host, Fuses, packaged/Portable UI, scheduler, installed main/About/diagnostics, File/Product and shortcuts pass. No GitHub push or Release. |

## v0.6.24 local Plan wire/state and queue-ownership hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Plan decision wire | Official-source + contract verified | Desktop maps implement/continue/abandon to the current successful `approved`/`cancelled`/`abandoned` ext-method results. Feedback is emitted only on `cancelled`; duplicate decisions remain idempotent. |
| Plan mode authority | Contract + live handshake verified | Replayed mode updates are authoritative, failed `session/set_mode` cannot produce a false UI mode, and direct/queued Prompts pin `_meta.mode`. Installed CLI 0.2.117 accepted a real `session/set_mode=plan`. |
| Plan permissions | Real isolated turn verified | One real read-only Plan turn produced no Renderer permission event and no workspace mutation. Read-only selection and mutation/unknown rejection still retain the independent fs/terminal main-process gates. |
| Direct-vs-queued lifecycle | Regression + real turn verified | Server-generated internal queue IDs from ordinary Prompts are hidden from Desktop queue ownership and cannot start a phantom second turn. The reproduced live turn ends with no active turn and `working=false`. |
| Workspace picker focus | Packaged UI verified | The close callback is stable across Sidebar rerenders, preserving the original workspace-button return-focus target. The packaged workspace-picker focus/Escape probe passes. |
| Delivery | Installed locally for acceptance | 82 offline files/483 tests pass; 6 live files/9 tests skip by design. TypeScript, production/resources, 303-file public scans, Fuses, packaged/Portable UI, scheduler, File/Product, shortcuts and installed main/About/diagnostics pass. The real isolated Plan turn also ends idle without a permission card or write. Existing long-conversation Plan/Stop behavior remains user acceptance; no GitHub push or Release. |

## v0.6.23 local Plan terminal-state and Stop hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Terminal turn settlement | Focused verified | A turn-scoped `_x.ai/session/update.turn_completed` settles a missing `session/prompt` response, clears `working` and cannot settle a later queued/interjected turn. |
| Stop recovery | Unit/source verified | ACP cancel remains first choice; an unacknowledged cancel replaces only the affected session adapter after eight seconds and reloads its persisted conversation. |
| Plan permissions | Unit/source verified | Plan shows no permission surface: recognized read-only tools/queries are selected, mutation/unknown tools are rejected, and main-process fs/terminal gates remain enforced. |
| Delivery | Installed locally for acceptance | 5 focused files/80 tests and the final 81 offline files/478 tests pass; 5 live files/8 tests skip by design. TypeScript, production/resources, public scans, Fuses, packaged/Portable UI, Task Scheduler, File/Product, shortcuts and installed main/About/diagnostics pass. Real “continue planning”, Stop and Plan read-only behavior remain user acceptance; no paid request, GitHub push or Release. |

## Post-v0.6.22 unlimited interactive-turn hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Interactive turn lifetime | Focused/source verified | Ordinary and queued ACP prompts use no Desktop wall-clock timer. They end on CLI completion, explicit Stop/cancel, process exit or a real transport/provider failure; Provider idle silence detection remains independent. |
| Delivery | Source-only GitHub update | Focused adapter tests, TypeScript and public scan are the intended gate. The published `v0.6.22` assets/tag remain unchanged and no Release is created for this small patch. |

## v0.6.22 local media transport and interject lifecycle hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Historical/generated media display | Focused/source verified | Existing media is served through a bounded main-process `grok-media:` protocol rather than blocked Renderer `file://`; supported roots and a 256 MiB read ceiling remain enforced. |
| CLI media artifact ownership | Focused verified | Only the exact transient CLI session root is added to the job allow-list; a sibling session is rejected and the artifact is copied before transient cleanup. |
| Video ZDR diagnosis | Unit/source verified | The first `output.upload_url` error is preserved, retries stop, and the UI identifies the upstream ZDR team limitation. Desktop cannot synthesize the required upload callback for the installed CLI tool. |
| Interject semantics | Unit/source verified | A submitted interject remains committed and non-removable, then becomes its own turn inside the same ACP session after the prior turn settles. It does not launch an independent Desktop Agent. |
| Delivery | Published Latest + installed locally | 80 offline files/465 tests pass; 5 live files/8 tests skip by design. TypeScript, production/resources, native self-test, public scans, diff check, Fuses, packaged/Portable UI, scheduler, File/Product, shortcuts and installed main/About/diagnostics pass. PR #19/#20 passed Windows, Gitleaks, CodeQL and code-scanning gates; workflow `30693283048` rebuilt, scanned, attested and downloaded/verified the cloud assets before publishing `v0.6.22` as Latest. The installed historical 1024x1024 image loads through `grok-media:`; new paid media and live interject order remain user acceptance. |

## v0.6.21 local concurrent-conversation hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Renderer submission isolation | Unit/source verified | Prompt transport locks are keyed by conversation/new-draft identity; a pending turn in session A cannot disable session B. The first session-scoped working status releases the short transport lock. |
| Main-process concurrency | Unit/source verified | Separate sessions remain separate live adapters and Provider scopes. Two working adapters coexist; the existing resident cap is eight and does not reap working/waiting sessions. |
| Background navigation safety | Source verified | A background rejection persists its own draft but restores UI state, focus and scrolling only when that conversation is still active. |
| Concurrent visibility | Renderer regression verified | Session rows expose running/waiting/completed/failed labels and the project header reports live-session count. |
| Delivery | Installed locally for acceptance | 80 offline files/462 tests pass; 5 live files/8 tests skip by design. TypeScript, production/resource build, native self-test, 299-file public scan, diff check, Fuses, formal assets, File/Product, shortcuts and installed main/About/diagnostics pass. Real two-session turns remain user acceptance; no GitHub release. |

## v0.6.20 local media/session/Plan hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Media artifact paths | Focused verified | Ordinary relative paths including `images/1.jpg` remain rooted in the execution workspace and pass the existing canonical-path boundary before cache copy. |
| Media session ownership | Source/focused verified | Active Grok sessions are reused even while working/waiting. CLI media uses a transient explicit session ID that is cleaned only after cache materialization; no-session creation is disclosed in the studio. |
| Multi-media presentation | Renderer regression verified | Results are aggregated into a bounded two-column gallery, initially limited to four with expand/collapse and internal scrolling. |
| Empty-turn semantics | Renderer regression verified | Working and waiting turns use live-state text; only terminal/history cases use missing-body recovery text. |
| Plan permissions | Unit verified | Read/search/fetch/think and allow-listed read-only commands receive one-time approval in Plan; edits, arbitrary execution and unknown tools are not auto-approved. |
| Delivery | Installed locally for acceptance | 79 offline files/457 tests pass; 5 live files/8 tests skip by design. TypeScript, production/resource build, 297-file public scans, diff check, Fuses, formal assets, File/Product, shortcuts and installed main/About/diagnostics pass. Real media generation and live Plan permission behavior remain user acceptance; no GitHub release. |

## v0.6.19 local Codex decision-surface and Agent-diff hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Agent-change readability | Focused/source verified | The dock uses unified Diff, wrapping, bounded Monaco layout and a responsive file-list split rather than two code panes inside the remaining narrow width. |
| Permission/plan presentation | Focused/source verified | Current Codex structure was inspected read-only: compact elevated request surface, leading scoped action, trailing reject/primary actions and narrow stacking. Grok maps only actual ACP options and the real plan response. |
| Interaction lifecycle | Existing focused verification retained | 0.6.18 stable request IDs, main-process pending sets, `interaction-resolved`, stale-request expiry and idempotent plan receipts remain unchanged. Real user-triggered permission/plan turns remain acceptance. |
| Delivery | Installed locally for acceptance | 2 files/32 focused Renderer tests, TypeScript, production build, native resources, 295-file public scans, Fuses, File/Product/ASAR, shortcuts and installed main/About/diagnostics probes pass. Real permission/plan turns and dock readability remain user acceptance; no GitHub push or Release. |

## v0.6.18 local interaction and Agent-change hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Permission/plan lifecycle | Focused verified | Actionable RPC requests have stable IDs and explicit resolution events; read-only plan updates cannot replace them. Successful/stale cards disappear and repeated decisions do not send another response. |
| Message delivery | Focused/source verified | `sent` is emitted after the local CLI request is written. Queue execution cannot leave the user bubble in `sending` for the duration of the model turn. |
| ACP file changes | Focused + official-source verified | Current nested ACP Diff blocks are parsed and preserved across streamed updates. Read/search operations are excluded from write counts; additions/deletions are exact for captured text. |
| Non-Git Agent changes | Focused verified | `kind=edit` writes feed Last turn/Session changes and rebuild from the private projection after restart. No Git staging/commit capability is fabricated. |
| Overflow and accounts | Source/regression verified | Plan/code/table content scrolls within its card. Account collections are counted, internally scrollable, active-first and responsive rather than expanding or squeezing the dialog. |
| Delivery | Installed locally for acceptance | 78 files/447 offline tests passed; 5 live files/8 tests skipped by design. TypeScript, production build, 295-file public scan, diff check, formal packaging, Fuses, File/Product/ASAR, both shortcuts and installed main/About/diagnostics probes passed. Real permission/plan/model turns remain user acceptance; no GitHub push or Release. |

## v0.6.17 local acceptance hotfix

| Area | Status | Evidence / boundary |
|---|---|---|
| Legacy Provider TOML migration | Focused verified | A markerless Desktop-owned model table is removed by private-store model ID before one managed block is written; unrelated comments/tables survive and the result parses. |
| Manual media configuration | Focused/source verified | Explicit image transport or video endpoint is sufficient to enter the Provider media route. “Verified” still requires an actual returned media asset and is not inferred from the model name. |
| Media-only scan and context UX | Source/type verified | One-model media checks use only that model/current protocol. Normal scans never cross the selected Provider. Automatic context probing is absent from the normal UI; metadata/manual values remain. |
| Media presentation | Source/regression verified | Missing cached files show an unavailable state; copy/save controls remain in layout and cannot cover the preview. Existing missing files are not fabricated or recoverable. |
| Right-file preview | Source/regression verified | Preview content has `min-width:0`, `max-width:100%`, an internal scroller and wrap toggle, preventing long lines from being clipped behind the dock edge. |
| Delivery | Installed locally for acceptance | 78 files/436 offline tests passed; 5 live files/8 tests skipped by design. TypeScript, production build, 295-file public scan, formal packaging, Fuses, File/Product/ASAR, both shortcuts, installed main/About/diagnostics probes and read-only main/settings/Provider-manager UI inspection passed. Real Provider/media inference remains user acceptance. No GitHub push or Release before acceptance. |

## v0.6.16 local reliability and UI acceptance candidate

| Area | Status | Evidence / boundary |
|---|---|---|
| Provider scan jobs | Focused verified | Main-process jobs expose progress, recovery, one-model/provider scopes and generation-isolated cancellation. A late upstream response cannot persist evidence after cancellation. |
| Context probes | Focused/source verified | Safe metadata/lower-bound and explicitly confirmed bounded exact modes are separate. Without exact usage, only character/byte evidence is reported. Exact-limit probing is never automatic. |
| Provider/model lifecycle | Focused verified | Enabled state migrates to true, disabled entries leave routing/defaults/CLI configuration, and a zero-model Provider can remain saved as disabled. |
| Capability application | Source/type verified | Protocol, reasoning, context, tools, continuation, usage, media, aliases and family are presented as a selectable draft; unchecked fields are unchanged. |
| Conversation projection | Focused verified | Visible blocks and partial assistant streams persist in a main-process append log plus atomic snapshot, merge by stable IDs with replay and survive failure/cancel/reset/reopen. Original Grok history is not rewritten. |
| Media routing | Focused/fake-CLI verified | Auto/CLI/Provider routing and streaming-json artifact parsing are covered with fixtures. Real installed CLI/provider media generation remains a user-acceptance boundary. |
| Open/copy/long text | Focused/source verified | Typed open targets, trusted native image actions, selectable message text and 12K draft attachments are main-process constrained. |
| Codex-style shell | Type/build verified | Shell, composer, sidebar, top bar, media dialog and layered CSS compile in production; full multi-resolution visual acceptance remains local-user work. |
| Delivery | Installed locally for acceptance | 78 files/432 offline tests passed; 5 live files/8 tests skipped by design. TypeScript, production build, public scan, Fuses, packaged/Portable UI, Task Scheduler, File/Product/ASAR, shortcuts and installed cold start passed. Real Provider/CLI media inference remains user acceptance. No GitHub Release before acceptance. |

## v0.6.15 local Provider compatibility candidate

| Area | Status | Evidence / boundary |
|---|---|---|
| Protocol translator | Focused + live verified | Main-process Chat/Responses/Messages/Gemini request and response mapping covers text, images, tools, tool results, reasoning and exact usage. Same-protocol SSE remains direct; cross-protocol SSE emits keep-alive comments while preserving ordered terminal conversion. |
| Capability discovery | Focused + live verified | Bounded scans record per-model/per-protocol non-streaming, SSE, tool call, tool continuation, usage, returned model and accepted effort evidence. Partial rescans merge; HTTP acceptance is labelled as such and is not semantic proof. |
| Reasoning transport | Focused + live verified | Effort enum, Anthropic adaptive, token budget, model suffix, fixed and unsupported mappings are configurable per model/upstream protocol. Grok 4.5 has a five-level exact-ID migration; unknown models remain undeclared until metadata, scan or manual input exists. |
| Provider manager | Source/type verified | UI exposes compatibility family, per-model client/upstream protocol, timeout, effort/transport mapping, capability matrix, scan/cancel and explicit application of verified levels. Models are displayed with Provider prefixes. |
| Local grok2api | Live verified for text/tools | Grok 4.5 passed direct three-protocol scans and a full Grok CLI ACP Responses xhigh turn. Image generation currently returns HTTP 502 and is not claimed. |
| Remote CPA | Live verified with current route limits | Grok 4.5 passed Responses scan and xhigh ACP; Gemini passed all three protocol/tool scans and Chat ACP. The current Claude route returns HTTP 502, so Claude is not claimed available merely because `/models` lists it. |
| Delivery | Installed locally for acceptance | Source/lock, Setup and installed File/Product/ASAR report 0.6.15. Setup/Portable/SBOM/licenses match `SHA256SUMS.txt`; Fuses, compatibility markers, both shortcuts and a four-process cold start passed. Public Latest remains 0.6.6 pending user acceptance. |

## v0.6.14 local audit-fix source candidate

| Area | Status | Evidence / boundary |
|---|---|---|
| Gateway completion attribution | Focused verified | Successful, failed and downstream-closed requests have bounded body-free process-scope observations. Caller-side stream closes are no longer counted as Provider failures; HTTP 200 routes can still identify a later CLI parser failure. |
| Anthropic unsigned thinking semantics | Focused verified | Only malformed unsigned thinking is marker-carried through the CLI and incrementally restored to ACP `thought`; valid signed SSE remains byte-for-byte pass-through. No signature is forged. |
| Windows CLI home | Focused/type verified | Missing `HOME` is synthesized from `USERPROFILE`/OS home without overriding explicit `HOME` or changing `GROK_HOME`. |
| Persistent log privacy | Focused verified | AppData logs redact secrets, URL details, email, local/UNC paths before persistence, sanitize an existing file, cap entries and keep one 8 MiB rotation backup. |
| JSON recovery | Focused verified | Malformed stores are preserved as recovery backups; non-ENOENT read failures propagate; stale same-store atomic temps older than 24 hours are removed. |
| 0.6.14 delivery | Offline-verified source candidate | Version/lockfile are 0.6.14. 72 files/391 tests, TypeScript, native resource self-test, production build, 273-file public scan, diff check and npm audit pass. The current default model's local upstream is intentionally excluded from live acceptance; packaging, installation and GitHub Release are not claimed. |
| Renderer dependency chunks | Known performance follow-up | Monaco/Shiki/Mermaid are already lazy surfaces, but their generated dependency chunks still exceed Vite's 500 KiB warning. The warning remains visible; this candidate does not disguise it by raising the limit. |

## v0.6.12 local Provider transport-routing candidate

| Area | Status | Evidence |
|---|---|---|
| Timeout ownership | Source/live-log verified | Installed CLI reference declares a 600s inference-idle default. ACP total turn is 1800s and gateway response-header timeout is 600s; the observed 58/88s failures were `ERR_CONNECTION_CLOSED`, not either timer. |
| Provider network route | Focused verified | Each managed Provider can inherit the app proxy or use a direct Electron partition. Discovery and inference receive the same mode; missing historical values safely inherit. |
| Gateway transport diagnosis | Focused verified | Safe request IDs distinguish header timeout, downstream request/response cancellation, upstream connect failure, upstream stream truncation and HTTP failure without logging URLs, credentials or bodies. A synthetic post-header stream truncation is covered. |
| Current CPA | Reachability only | `/models` returned HTTP 200 both direct and via the configured local proxy; current long inference was still running under 0.6.11 during source work. A completed long-stream result is deliberately not claimed. |
| Delivery | Installed locally | 5 files/41 focused tests, TypeScript, public scan, production/resources, Fuses, installed-ASAR markers, current CPA direct/600s migration, CLI inspect, shortcuts and cold start passed. Setup SHA-256 is `78729332967a5c51d1203d3fc7c8a36ca72c256161be196ba1462591b69d575b`; app is closed and public Latest remains 0.6.6. |

## v0.6.11 local installed inference idle-timeout hotfix

| Area | Status | Evidence |
|---|---|---|
| Timeout ownership | Historical/corrected in 0.6.12 | Interactive ACP prompt is 1800s and Provider gateway header ceiling is 600s. CLI accepted 360, but its native default was later verified as 600; 360 did not explain the observed early disconnect. |
| Managed Provider models | Historical | 0.6.11 resolved missing values to 360s and migrated the managed block. 0.6.12 restores 600 while retaining explicit 30–3600s values. |
| Provider manager | Focused/packaged verified | Each managed model exposes the idle-stream timeout and effective details value without changing the longer total turn ceiling; installed ASAR markers and validation tests passed. |
| Delivery | Installed locally | Source/lock/File/Product are 0.6.11. 6 files/47 tests, TypeScript, production/resources, Fuses, shortcuts, installed ASAR and cold start passed. Setup SHA-256 is `cf8f4f6a97e120c82ef243c35eb701a32da8bf779e45b4b16e9263886e3e9475`; public Latest remains 0.6.6. |

## v0.6.10 local per-model Provider capabilities candidate

| Area | Status | Evidence |
|---|---|---|
| CPA Responses | Live verified | Current CPA returned HTTP 200 SSE for default and none/minimal/low/medium/high/xhigh Responses requests. One isolated full ACP Responses turn also passed; HTTP acceptance alone is not treated as proof that upstream honored the value. |
| Capability resolution | Focused/live verified | Upstream metadata and explicit per-model settings override exact-ID suggestions; explicit empty lists remain empty and unknown models are not guessed. Common direct, supported-* and nested capability field shapes are parsed. |
| Effort hot switch | Live verified | Custom ACP metadata exposed high/medium/low; one session changed low → high through the private confirmation event and completed a real turn without restart. |
| Per-model protocol/effort | Focused verified | Every managed model can override the Provider protocol and select any subset of six vocabulary values. Config generation and launch-time migration preserve the per-model protocol and manual effort list. |
| Current CPA profile | Locally migrated | Only `openai-compatible-grok-4.5` now overrides to Responses with xhigh/high/medium/low/minimal; sibling models keep the Provider's Chat default. Credential ownership is unchanged and a TOML backup exists. |
| Delivery | Local acceptance installed | Source/lock/File/Product are 0.6.10. 47 focused tests, TypeScript, production build, native resource self-test, Fuses, shortcuts, installed ASAR markers and cold start passed. Setup SHA-256 is `2ae08474303b0f5a0d3b44c9f689f03618c4a17c0f6a8fee020f6d36763b2057`; the app is closed and public Latest remains 0.6.6. |

## v0.6.9 local Provider authentication hotfix candidate

| Area | Status | Evidence |
|---|---|---|
| Gateway credential boundary | Focused + live verified | Incoming CLI `Authorization`, `x-api-key` and managed extra-header values are discarded. The main process freshly reads and injects only the selected Provider's environment values; missing credentials stop before upstream. |
| Current CPA direct request | Live verified | The configured credential returned HTTP 200 for `/models` (11 entries including `grok-4.5`) and for a minimal streaming `/chat/completions` request. No credential or response body was recorded. |
| Current CPA ACP request | Live verified | One isolated Grok CLI → loopback gateway → current Provider → `grok-4.5` minimal turn completed successfully after the fix. |
| Delivery | Local acceptance installed | Source/lock/File/Product are 0.6.9. 43 focused tests, TypeScript, production build, native resource self-test and Fuse verification passed. Setup SHA-256 is `2a0cc83d69c6cfe2053f23e2d224986f057b28af1c2086d015bfe6f71259c70c`; per-user install, both shortcuts and installed-ASAR marker checks passed. Public Latest remains 0.6.6. |

## v0.6.8 local routing hotfix candidate

| Area | Status | Notes |
|---|---|---|
| Resumed custom-model routing | Focused verified | A resumed session whose persisted ACP model is the upstream `grok-4.5` now sends a real `session/set_model` for `openai-compatible-grok-4.5`; alias preservation no longer skips the route change. |
| Reasoning effort capability | Focused/type verified | ACP-declared effort values drive the composer. Provider models without `reasoning_efforts` keep their startup value and expose no fake hot-switch choices. |
| Non-destructive effort failure | Focused verified | Missing/unsupported private effort confirmation leaves the existing process and session intact instead of restarting into the historical effort/model. |
| Provider failure attribution | Source verified | Provider name/status/trace enrichment requires a recent gateway record from the same process scope. A local selector ID alone is no longer treated as proof that CPA received the turn. |
| Delivery | Local acceptance installed | Source/lock/File/Product are 0.6.8. 28 focused tests, TypeScript, production build and native resource self-test passed. Setup SHA-256 is `c0cff8253878d2c794b79a12370e677ad06a3315eab68ba12896c861a4353bd6`; per-user installation and both shortcut targets passed. The app remains closed for user acceptance; public Latest remains 0.6.6. |

## v0.6.7 local acceptance candidate

| Area | Status | Notes |
|---|---|---|
| Provider launch credentials | Focused + live verified | Desktop session launch refreshes credential and custom-header environment variables from the Windows user scope before spawning CLI. The current Provider returned HTTP 200 for a minimal `grok-4.5` ACP turn through the loopback gateway. |
| Custom model identity | Focused + live verified | The explicitly selected local ID survives ACP updates that publish only the upstream route ID, preventing `openai-compatible-grok-4.5` from becoming the official `grok-4.5` after a turn. |
| Prompt error details | Contract verified | Normal Prompt rejection emits one structured failure; snake-case `http_status` is retained and the unstructured duplicate status card is suppressed. |
| Claude session catalog | Focused verified | Main-process-only read-only indexing covers primary Claude Code JSONL sessions, title/model/workspace metadata, sidechain/subagent exclusion, fallback parsing, continuation mapping and source hash stability. |
| Claude mirror and relay | Source/type verified | Sidebar and workspace discovery expose Claude sessions separately; the mirror reuses the Codex review layout and continuation invokes Grok CLI's bundled `/resume-claude` skill. No transcript is copied into a synthetic approval prompt. |
| Delivery | Local acceptance installed | Source/lock/display and the installed executable are 0.6.7. The 36 affected tests, TypeScript, production build and packaging resource self-test passed. The app remains closed for user acceptance; expanded tests, app-driven live acceptance, formal Portable/SBOM/license reports and GitHub upload wait for that feedback. Public Latest remains 0.6.6. |

## v0.6.6 public stable release / installed local build

| Area | Status | Notes |
|---|---|---|
| Structured failures | Focused/source verified | Evidence-based classifications, scoped Provider/gateway observations, trace/retry/schema facts, class-specific diagnosis and expandable redacted error details. Concurrent CLI processes cannot borrow one another's failure record, and arbitrary gateway exceptions never cross the loopback response boundary; the detailed redacted diagnostic remains main-process-only. |
| Non-Git Agent changes | Focused/UI verified | Real tool-call before/after snapshots provide last-turn/session review without Git staging/commit/branch controls; missing baselines are stated rather than fabricated. |
| Token activity | Focused/UI verified | Exact Provider/CLI usage only, per-turn metrics, 24h/today/7d/30d/month rollups, coverage counts and a 371-day/53-week heatmap. Session detail deletion and 13-month anonymous retention are enforced. |
| Storage/cleanup integrity | Focused verified | JsonStore mutation queues prevent lost updates; workspace/session deletion removes all associated local projections while unrelated running sessions remain alive. |
| Retry and streaming | Focused/source verified | ACP retry lifecycle is visible, Prompt budget expiry cancels the real turn, and growing final text remains plain until one completed Markdown render. |
| Computer Use action integrity | Native/focused verified | Per-action MCP schemas, punctuation-aware key mapping, window-bounded pointer/drag, horizontal wheel and unknown-outcome timeout handling supplement the existing same-integrity safety boundary. |
| Plan decision idempotency | Focused/ACP-contract verified | One `sessionId + requestId` decision answers the original server request once. Duplicate clicks return a duplicate receipt and no synthetic approval prompt is created. |
| Queue/interjection | Focused/contract verified | Queue and mutation receipts are visible; Enter queues, Ctrl+Enter interjects, unsupported same-turn input visibly falls back to the queue head, and only queued entries are editable. |
| Update/diagnostics actions | Packaged/installed UI verified | App/CLI checks, diagnostics navigation and redacted-log export expose running/success/error/cancelled state, re-entry protection, timestamp and copyable result. The installed probe opened diagnostics and received “可以使用”. |
| Provider gateway | Focused + three live probes verified | Loopback-only opaque routing, bounded same-protocol streaming, cancellation/timeouts, selected Trace headers and Gemini/strict Schema cleaning. Anthropic Messages additionally preserves valid signed thinking byte-for-byte and downgrades only malformed unsigned thinking to ordinary text without forging a signature. Isolated CLI 0.2.112 local ACP, current CPA and current Kiro Claude 4.8 thinking minimal turns passed. |
| 0.6.13 local delivery | Installed candidate | File/Product and installed ASAR report 0.6.13; the ASAR contains the unsigned-thinking adapter, Fuses and both shortcut targets passed, and Kiro-Go remained running across installation. Setup SHA-256 is `7172de9ee614afb4afea471703cc5106aa294cbe93ec2471f996716675311a1f`. The app is open for user acceptance; broad UI/full-suite and GitHub publication are intentionally not claimed. |
| Provider isolation | Focused verified | Credentials/upstream remain main-process environment values; Desktop CLI sees only the loopback override. Literal managed blocks migrate atomically; config, secret and URL rollback/remove tests pass. |
| Errors and quota | Focused/source verified | Provider errors default collapsed with redacted details. Rolling 24h Token limits are separate from weekly/monthly billing, persisted per account and marked expired. |
| Auth and Computer Use | Focused verified | Device login has one browser owner. Ordinary Codex is allowed while self/terminal/UAC/security and Windows integrity boundaries remain enforced. |
| Recent file access | Focused/source verified | Only paths in the real execution root are listed, project paths are relative, and external-open uses the canonical path returned by the main process. |
| 0.6.6 delivery | Published Latest + public Setup installed and verified | Source/lock/display/File/Main/About are 0.6.6. The corrected local gate passed 359 tests with 7 explicit live skips plus production/native/Fuses/UI/Scheduler/Portable checks. PR #15 merged at `2d413d4` after Windows, Gitleaks, CodeQL and code-scanning gates. Release workflow `30216468056` rebuilt, scanned, attested, draft-downloaded and hash/provenance-verified all five assets before publishing `v0.6.6` as Latest. Public Setup SHA-256 is `911d5350d7c24999d2c17fc6a9fa8513a5173dc6304d873c8a9fe2f112f28416`; Portable is `5b6dc4ccc0e44f7a65b44508b8c3e17d35302cd961d61d3ac72dfe4e692688ca`. The downloaded public Setup was installed per-user and its version, channel, diagnostics, support-bundle exclusions and both shortcuts passed again. |

## v0.6.4 public stable release / installed local build

| Area | Status | Notes |
|---|---|---|
| Scheduler diagnostics | 0.6.3 installed/verified | UTF-8/UTF-16/GB18030-compatible Buffer decoding, structured stable diagnostics and damaged-history replacement remove task-center mojibake; focused encoding/health tests pass. |
| Conversation navigation/layout | Public source + installed UI verified | Unified target opening and fixed conversation grid preserve the Virtuoso viewport, composer and focus. The 0.6.4 fixture passes Dashboard→chat→file preview→explicit editor→chat→task center→chat. |
| Multi-tool right pane | Public source + installed UI verified | On-demand launcher exposes only Review, plan/result, recent files and side tasks. Width is 420–760 px per tool; 1100 px uses a visible overlay drawer instead of CSS-hiding the panel. |
| Scalable Review | Public/focused/UI verified | Lightweight index plus one selected `GitReviewFileDetail`; search/status/stats and lazy hunks handle the 850-file fixture. Five scopes, stale-snapshot protection, hunk actions and comments remain main-process-backed. Non-Git is an ordinary empty state. |
| Provider manager | Public/focused/UI verified | Independent searchable manager with five presets, unsaved-draft probe/discovery, structured environment headers, candidate multi-select/import, editable collision-safe local IDs, manual fallback and unknown context windows. |
| Provider probe security | Focused-tested | Main process performs bounded model-list GET only, rejects redirects, limits timeout/2 MiB response, supports OpenAI/Anthropic/Ollama list shapes and keeps credentials out of logs/diagnostics. |
| Windows path aliases | Focused/Hosted regression verified | Existing absolute paths are canonicalized before workspace comparison, so 8.3 `%TEMP%` aliases and long `realpath` results refer to the same Editor/Memory/Agent/Git boundary. Symlink and junction escapes remain rejected. |
| 0.6.4 delivery | Published Latest + installed and verified | PR #13 merged at `df5db6b` after Windows, gitleaks, CodeQL and code-scanning gates. Release workflow `29993675891` rebuilt, scanned, attested, draft-downloaded and hash/provenance-verified all five assets before publishing `v0.6.4` as Latest. Public Setup SHA-256 is `ab4d037a8398ec8c12fc2365efba5ea8c4fae582486dd95f5cd27f8fc8eea1ab`; Portable is `635147fafa85b9a0bd4c7d61c9a36a9bb50e4c83410c225ddddccee769945b71`. |

## v0.6.2 local candidate

| Area | Status | Notes |
|---|---|---|
| Codex Review workflow | Focused/UI verified | On-demand resizable ReviewPane replaces the generic summary rail. Unstaged/Staged/Commit/Branch/Last turn scopes, parsed unified hunks, file/hunk stage/unstage/revert, stale snapshot rejection and visible line-comment drafts map to real Git/main-process operations. |
| Reliable navigation/editor | Focused/Computer Use verified | `NavigationIntent` carries session, real execution root, path, line/column and target surface. Review and tool locations share the same path; live Review→AGENTS.md opened the correct read-only Monaco surface with an explicit “编辑文件” action. |
| Turn lifecycle/history | Focused/UI verified | New turns persist monotonic duration and outcome in AppData; duplicate completion is idempotent. The 30-segment fixture renders one historical record, and a timed turn renders “已处理 1分23秒”. |
| Shell/settings/background | Automated/Computer Use verified | 272 px task-first sidebar, default-collapsed development tools, searchable/closable focus-contained workspace popover, task menu, Review toggle, 920×680 categorized settings and exact 100% opacity/0 blur/0 dim background mapping pass source UI acceptance. |
| 0.6.1 image regression | Source UI verified | Durable attachment cache, send/reopen preview, failed restore, missing-source fallback and support-bundle exclusions pass the 0.6.2 fixture, including pasted image visibility after failed send and Renderer reload. |
| Local 0.6.2 delivery | Installed and verified | TypeScript, production build, 9 focused files / 48 tests, final 238-file public scan, isolated Computer Use and the one final suite (284 pass/2 opt-in skip) pass. One formal package produced Setup/Portable/SBOM/licenses and hashes; Fuses/artifact scans, per-user install, Main/About/diagnostics, shortcut targets and installed 0.6.2 UI/image-reopen fixture pass. |

## v0.6.1 local candidate

| Area | Status | Notes |
|---|---|---|
| Codex UI parity | Source-live verified | Sanitized read-only audit drives direct left navigation, collapsible project tools, task header controls, 760 px conversation, 320 px summary rail, bottom changes panel and real Git/branch/Worktree/Commit/Push environment entry points. Unsupported Codex controls are intentionally absent. |
| Conversation and composer | Focused/UI verified | User copy, attachment gallery/lightbox, delivery state and failure restore; collapsible process/file groups; final-answer copy; real permission/question/plan/computer cards; floating idle/running/queue/interjection/stop composer; custom background retains stable readability layers. |
| Durable pasted-image messages | Focused/UI verified | Main-process session cache, `clientMessageId` merge, PNG/JPEG/WebP/GIF content validation, 20 MiB main-process limit, text+image/pure-image/multi-image/queue/interjection/failure contracts, missing-source fallback, reopen restore and session/orphan/capacity cleanup. Image paths are not duplicated into prompts. |
| Attachment privacy | Implemented and tested | Attachment bodies, Base64, cache files and complete paths are excluded from logs, notifications and support bundles. Renderer receives only typed preview metadata through the sandboxed Preload bridge. |
| Responsive/offline fixture | Automated and Computer Use verified | Opt-in no-model fixture covers left/right/bottom shell, message/process/file/plan/final cards, image before/after send, failure recovery, lightbox, 1100×720/1440×810 transitions and renderer reopen. Widths below 1200 px remove the summary rail while preserving its header button. |
| Local 0.6.1 delivery | Installed and verified | Final suite: 270 pass/2 opt-in skip. Setup/Portable/SBOM/licenses, Fuses, source/artifact scans, 4K and responsive UI, overlays, Task Scheduler and Chinese/space Portable pass. The per-user executable, About and main process report 0.6.1; diagnostics reports ready; desktop/Start Menu shortcuts target the install directory; installed fixture preserves the pasted image after send and Renderer reopen. Hashes are in `release/SHA256SUMS.txt` and the Changelog. |

## v0.6.0 local candidate

| Area | Status | Notes |
|---|---|---|
| Codex-aligned desktop shell | Implemented and source-live verified | Read-only Computer Use comparison informed a quieter single sidebar, labelled workbench menu, compact context header, centered task surface, floating composer, restrained empty state, consistent SVG controls and a labelled session overflow menu with outside-click close. Custom conversation backgrounds now retain a minimum readability scrim. The existing packaged candidate predates this shell revision. |
| Lightweight editor | Implemented and focused-tested | Bundled offline Monaco, lazy file tree, tabs/edit/atomic save, UTF-8/BOM/GB18030 and line-ending preservation, size/path boundaries, disk Diff conflict flow, chat references and tested tool-card file/line navigation; no LSP/debugger/terminal |
| Git workbench | Implemented and focused/live-tested | Main-process fixed-argument Git service, porcelain-v2 status, sanitized remote, worktree/index Diff, stage/unstage/commit, history/details, branches, bounded cancellable pull/push, exact-list discard and subdirectory-repository trust; no force push or history rewriting |
| Grok Worktrees | Implemented and focused/live-tested | Official `x.ai/git/worktree/*` route with controlled Git fallback, inventory/recovery, new-session/fork/profile selectors, Worktree source group, preview-token safe apply, conflict preservation, optional cleanup, previewed GC and exact native shared-Memory identity across clones/Worktrees |
| Workspace Memory | Implemented and focused/UI-tested | Exact native `org/repo` + BLAKE3 layout, default-off AppData setting, per-process `GROK_MEMORY`, global/project/session browser/search, Monaco atomic/conflict editing, previewed native `/remember`, exact structured-entry deletion, session deletion, fixed-argument clear, Flush/Dream controls/status, session-end Flush/auto-Dream and `GROK_HOME/memory` confinement; the paid native rewrite was not repeated during offline candidate work |
| Agent/Persona center | Implemented and focused/live-tested | Built-in/plugin read-only discovery, project/user priority, Agent Markdown and Persona TOML structured/raw editing, contracts, exact comment/unknown-field preservation, copy/toggle/rename/delete, external hash conflicts, persistent backup, atomic `grok inspect --json` validation/rollback and idle-session-only reload fallback |
| Agent Dashboard | Implemented and focused/UI-tested | Desktop-native parent/child tree from ACP/task events and session history, status/model/effort/tools/context/Worktree metadata, stop/open/jump/filter/UI-clear actions and clearly labelled non-running history fallback; never starts the TUI Dashboard |
| Session execution profiles | Implemented and focused/UI-tested | Five presets plus global/project AppData precedence; Agent/model/effort/mode/tools/sandbox/web/subagents/Memory/Worktree/rules drive new sessions, forks and persistent tasks; unsupported max-turn mapping is visibly disabled and rejected |
| Persistent-task health | Implemented and focused/UI-tested | Read-only check plus repair for registration/current executable mapping/stale session metadata; missing account/provider/model/workspace/profile requires explicit configuration and prompt content is never read or sent |
| v0.6 typed foundation | Implemented and focused-tested | Shared workbench contracts, documented main-process module boundaries and a version-cached three-state CLI capability snapshot exposed through trusted IPC; private ACP methods remain unknown until runtime evidence exists |
| v0.6 verification | Source newer than packaged candidate | Every workbench slice passed focused automation, TypeScript and production build; isolated Electron/CDP acceptance covers Editor, Git, Worktree, Memory, Agent/Persona, Profiles, Dashboard, launch selector and task-health UI. The single full offline run recorded 262 pass/2 opt-in skip plus one original 5-second test-harness timeout; after changing only that timeout, the focused Memory file passed 7/7 and the Worktree→Editor/Git→Dashboard→Memory→Apply→conflict→cleanup integration passed 1/1. Exactly one pre-redesign candidate package passed Fuses, artifact scanning, packaged UI and Chinese/space-path Portable launch. The newer shell separately passed affected TypeScript/build/Renderer tests and live Computer Use source acceptance; it has not been repackaged. External Windows version/DPI/dual-display and v0.5.16 upgrade preservation remain separate release gates. |

## v0.5.16 session lifecycle

| Area | Status | Notes |
|---|---|---|
| Session origin groups | Implemented and packaged-UI verified | Ordinary, task, Codex-continuation and future other sources use durable metadata, visible badges and independently persisted collapse state |
| Codex continuation identity | Implemented and focused-tested | New Grok continuations preserve the exact original Codex title; multiple continuation mappings migrate without modifying source JSONL |
| Reusable task sessions | Packaged-live verified | Reuse is the default; two consecutive real OAuth task runs completed against the same resumable Grok session instead of creating two sessions |
| Task context lifecycle | Implemented and tested | Per-task retain/fresh policy, direct open, manual permanent cleanup, stale/history migration and task-lock protection; packaged live cleanup removed the dedicated session and mapping |
| Historical public release evidence | Published and externally verified | `v0.5.16` was published at commit `e4dfb62` by workflow `29846404781` with Setup/Portable, SHA-256, SBOM, licenses and provenance; it was superseded as Latest by `v0.6.4` on 2026-07-23. |

## v0.5.15 hotfix

| Area | Status | Notes |
|---|---|---|
| Optional fork/rewind compatibility | Fixed and packaged-live verified | Installed CLI 0.2.106 lacks rewind points; the panel now shows its empty state without a global toast, while action errors stay inline |
| Auto-mode permissions | Fixed and focused-tested | Auto mode overrides obsolete secondary task policies, approves ACP tool requests, and suppresses optional Computer Use app/risk confirmations; protected targets and Windows/manual-secret boundaries remain enforced |
| Persistent prompt duration | Fixed | Scheduled turns use a 23-hour ceiling below Task Scheduler's 24-hour limit; interactive turns retain their existing timeout |
| Persistent automation | Packaged-live verified | A real packaged OAuth worker read `package.json`, completed in about 40 seconds, created a resumable session, released locks and cleaned the temporary task/session without a permission wait |
| Task editor policy clarity | Fixed and packaged-UI verified | Auto mode is labelled unrestricted, forces the effective policy to auto and disables the redundant permission selector with explanatory text |

## v0.5.14 hotfix

| Area | Status | Notes |
|---|---|---|
| Scheduled OAuth selection | Fixed and focused-tested | A fixed OAuth task uses newer canonical credentials only when the parsed account identity matches; other stored accounts remain isolated |
| OAuth refresh reconciliation | Fixed and focused-tested | Worker refreshes update the DPAPI vault and canonical auth atomically, while compare-before-write preserves credentials rotated concurrently by another Grok process |
| Authentication error presentation | Fixed | Existing raw `Authentication required` history is rendered as Chinese retry/re-login guidance |

## v0.5.13 hotfix

| Area | Status | Notes |
|---|---|---|
| Scheduled prompt decryption | Fixed and focused-live verified | Before Electron ready, headless workers copy the canonical Chromium `Local State` into an isolated `sessionData`, allowing `safeStorage` to reuse the GUI encryption key without sharing its active profile; the affected task decrypted without exposing or executing its prompt |
| Automation editor options | Fixed and packaged-UI verified | Computer Use, wake and completion notification are three aligned cards with descriptions, accessible checkboxes and a narrow-window single-column layout |
| Automation error presentation | Fixed | Run states are Chinese; legacy raw safeStorage errors and new decryption failures show concise Chinese recovery guidance without task content |

## v0.5.0–v0.5.12 additions

| Area | Status | Notes |
|---|---|---|
| Overlay root and layering | Implemented, automated | Settings, accounts/quota, extensions, diagnostics, onboarding, media, confirmations, notifications and Computer dialogs render in the dedicated overlay root; whole-window backgrounds no longer alter modal positioning |
| Custom providers | Implemented, automated | Chat Completions, Responses, Messages, local/remote presets, model discovery/test, user-env credentials, marked TOML block, conflict detection, five backups, validation and rollback |
| Persistent automations | Implemented, automated | Current-user least-privilege Task Scheduler registration, once/daily/weekly/interval, encrypted prompts, headless worker, locks, two-run global default, notifications, confirmation timeout and registration repair |
| Prompt queue/interjection | Implemented, contract tested | Server `x.ai/queue/changed` is authoritative; edit/remove/reorder/clear/interject use official identifiers and versions; old CLI interjection has a compatible send-now fallback |
| Fork, rewind and archive | Implemented, contract tested | Official fork plus conversation/all/files rewind; file-impact confirmation; archive is application metadata only and leaves Grok session files intact |
| Unified task center | Implemented | Queued prompts, command/monitor jobs, running sub-Agents, loops, persistent automations and confirmation/completion inbox |
| v0.5 local gate | Passed | 195 offline tests, 24/24 deterministic Computer Use flows, CLI 0.2.106 non-billable capability/provider probes, content/background/task-center smokes, Task Scheduler wakeup, Chinese-space Portable launch, Fuses, public artifact scan and NSIS install/upgrade/uninstall retention all passed; final hashes are recorded in the implementation plan |
| v0.5.12 release pipeline | Superseded by v0.5.16 | Product acceptance remains the passed local/CI gate above. GitHub generated unsigned Setup/Portable, hashes, SBOM/licenses and provenance; unsupported hosted virtual-desktop and InteractiveToken checks are not repeated. `v0.5.16` is now Latest and is recorded in the session-lifecycle section above |

## v0.4.2 local candidate

| Area | Status | Notes |
|---|---|---|
| Packaged startup recovery | Implemented and locally accepted | Packaged `loadFile()` works with ASAR integrity/OnlyLoadAppFromAsar; a Chinese recovery surface replaces permanent black screens; temporary-profile CDP smoke requires `.app-shell`, visible core content and no Renderer startup error |
| Composer add palette | Implemented and packaged-UI verified | Top-level Portal, large responsive scroll surface, keyboard navigation/focus return, files/images/path-only folders/workspace files, enabled Skills and extension management; verified at 1280×720 and 4K probe sizes |
| One-shot capabilities | Implemented and packaged-UI verified | Computer/Skill is selected as a draft chip and only converted on send; selecting Computer does not enumerate a window or start control early; successful sends clear it and failed sends preserve it |
| Chinese native menu | Implemented and tested | File/Edit/Session/View/Feature/Help menus use typed commands; repository, releases and issues are exact allow-listed links under `wangyingxuan383-ai/grok-build-desktop` |
| Theme modes | Implemented and tested | Classic dark/light, live Windows system following, custom dark/light base and six semantic colors; applied before React mounts and synchronized with `nativeTheme` |
| Theme backgrounds | Implemented and packaged-UI verified | Validated app-owned PNG/JPEG/WebP/GIF, exact read-only custom protocol, conversation/window scope, fit/position/opacity/blur/adaptive mask and deletion; background paths/content stay out of logs and support bundles |
| Rendering/theme integration | Implemented | Semantic variables cover shell/chat/Markdown/tables/KaTeX/scrollbars/palettes/cards/onboarding/diagnostics/extensions; Shiki, Mermaid and Monaco switch with the effective theme |
| Local Windows package | Passed | 167 offline tests passed with 2 opt-in live cases skipped by default; the real Grok visual-click/risk-rejection loop was then run explicitly and passed. Fuse, public-safety, content/UI smokes, portable Chinese-space-path launch, setup/ZIP/SBOM/licenses/hashes and the sole desktop shortcut cold launch also passed |
| Scheduled tasks | Planned for v0.5.0 only | Windows Task Scheduler plus Grok headless/ACP design is documented in `docs/SCHEDULED_TASKS_ROADMAP.md`; no scheduler runtime ships in v0.4.2 |

## v0.4.0 public release and v0.4.1 convenience set

| Area | Status | Notes |
|---|---|---|
| Public/private configuration | Implemented and tested | One source tree; public defaults plus ignored local override; production rejects mock CLI/local secrets; machine-neutral BuildInfo |
| Windows distribution | Implemented and locally packaged | Stable appId/AUMID, unsigned per-user Simplified Chinese assisted NSIS and portable ZIP; uninstall preserves AppData/Grok data |
| Release evidence | Implemented, generated and published | SHA256SUMS, CycloneDX SBOM, third-party licenses; public GitHub Release and verified artifact attestations from the latest `v0.4.1` tag |
| Public-source safety | Implemented and passed | Repository/artifact scanner, Gitleaks workflow, expanded ignore rules; generated host/evidence/runtime data excluded |
| First-run wizard | Implemented | System/DPAPI/CLI/models/ACP/account/workspace/Computer checks; official install command, skip/rerun and capability degradation |
| Diagnostics/support bundle | Implemented and tested | Copyable result, preview before export, only versions/capabilities/redacted logs; no prompts/sessions/screenshots/content/full paths/proxy address |
| Application updates | Implemented and tested | Stable configured-repository Release API, six-hour cache, no unsigned download/execution, manual SHA-256 instructions |
| Dynamic effort flag | Implemented and tested | Detects current CLI help and chooses `--effort` or `--reasoning-effort` without rejecting unknown versions |
| Resource/Fuse hardening | Implemented and packaged | Plugin/host SHA-256 manifest; RunAsNode/NODE_OPTIONS/inspect off, cookie/ASAR integrity/OnlyLoadAppFromAsar on; file privilege retained for packaged `loadFile`; content-aware Renderer smoke required |
| Chinese/compact-device UX | Implemented | Segoe UI/YaHei stack, IME composition guard, 820×620 minimum, responsive sidebar, 100–200% OS DPI-compatible CSS |
| `@文件` reference | Implemented and tested | Cached async Chinese fuzzy index, `.gitignore`, hard directory/size limits and attachment-chip output |
| Attachment privacy | Implemented and tested | One-time warning for outside-workspace, `.env`, credential, private-key/certificate names |
| In-session search | Implemented | `Ctrl+Shift+F`, result count, previous/next and Virtuoso turn positioning |
| Stability recovery | Implemented | Existing single-instance lock, UI error reload/diagnostics actions, per-version UI metadata backup without copying Grok sessions |
| GitHub project files | Implemented | Chinese README, sanitized SVG preview, CONTRIBUTING/SECURITY/privacy, templates, CI/Release/CodeQL/Dependabot |
| Cross-device release gate | Partially verified | Windows 11/local portable smoke and clean Windows Runner NSIS lifecycle passed; Windows 10 and multiple physical DPI/display configurations remain pending |

## v0.3.1 Computer Use UX fixes

| Area | v0.3.1 status | Notes |
|---|---|---|
| Ordinary app authorization | Implemented | Default allow for non-protected apps; optional per-app confirmation toggle; high-impact confirmation unchanged |
| Visible control overlay | Implemented and packaged-UI verified | Click-through blue display border, top current-action banner, step count, app name and pointer halo; never steals target focus |
| Visible physical pointer | Implemented and native-verified | UIA locates the target, then the real system mouse moves, dwells and clicks; deterministic probe validates final cursor coordinates |
| Activity explanation | Implemented | Overlay plus in-app live strip explain observation/action/result without exposing typed text; full screenshot history remains folded in the turn |
| Emergency stop | Implemented and packaged-UI verified | Global `Esc` exists only during active control; `Ctrl+Alt+Esc` remains available |
| UAC/elevated handoff | Implemented within Windows boundary | Secure desktop/high-integrity UI is not automated; task pauses, asks for manual completion and re-observes on resume |
| v0.3.1 acceptance | Passed | 137 default tests, 24/24 deterministic flows, real Grok visual/risk loops and packaged UI with blue overlay/no default permission prompt |

## v0.3 additions

| Area | v0.3 status | Notes |
|---|---|---|
| Extension Center shell | Implemented | Lazy Renderer chunk; Plugins, Marketplace, Skills, MCP, Hooks, Computer Use and Codex compatibility tabs |
| Plugin/marketplace inventory | Implemented with fallback | Prefers private ACP on supporting CLIs; CLI `--json` fallback verified on 0.2.101 |
| Plugin mutation/trust | Implemented | Enable/disable/update/uninstall; Git/local sources are statically inspected in a bare/temp context, pinned to a commit/fingerprint and require explicit trust |
| MCP management | Implemented | List, diagnose, add/update, toggle when private ACP is present, OAuth trigger and delete; DPAPI secret environment references |
| Hooks management | Implemented | Inventory, source/event status, owning-plugin enable/disable and hot reload; Hooks are never executed by the preview scanner |
| Built-in `/computer` Skill | Implemented, accepted experimental | Process `--plugin-dir` plus session `_meta.pluginDirs` injection verified on CLI 0.2.101; default available/idle without a developer unlock |
| Loopback Computer MCP | Implemented, accepted experimental | Random port, 256-bit per-session token, stateful Streamable HTTP, text/UIA/full PNG plus optional original-resolution detail crop; no global Grok MCP change |
| Windows Computer Host | Implemented, accepted experimental | Clean-room C# x64 helper, UIA, Electron exact-window capture with PrintWindow fallback, DPI-aware single actions, x64-correct Unicode SendInput, active-desktop and stale-state guards |
| Computer permissions | Implemented | Per-app once/always/deny, Plan observation-only, high-impact confirmation, protected-process denylist and emergency stop |
| Computer conversation UI | Implemented | `+ → 控制电脑`, direct leading `@Computer`/exact `@应用名`, exact window chooser, chip, pause/resume/stop and folded screenshot/action card |
| Codex plugin compatibility | Implemented | Read-only concurrent scan/classification/hash, stale-source indication and isolated adapter copies; proprietary Computer Use is visibly non-portable and never copied |
| Computer Use acceptance | Passed | 24/24 deterministic flows, 100% single-action accuracy, real Grok visual click/risk rejection, packaged UI/global stop, actual 96/120 DPI and synthetic 144 DPI/negative-display matrix; see `docs/COMPUTER_USE_ACCEPTANCE.md` |

| Area | v0.2 status | Notes |
|---|---|---|
| Electron desktop window | Implemented | Windows local build, visible-window smoke test and desktop shortcut |
| OAuth/device-code login | Implemented | Always shows URL/code fallback and re-open/copy actions |
| Encrypted account vault | Implemented | Electron safeStorage / Windows DPAPI, rollback-safe switch |
| API-key profiles | Implemented | Encrypted and injected only into child environment |
| Shared Grok session history | Implemented | Uses `%USERPROFILE%\.grok\sessions`, case-compatible with VS Code history |
| Concurrent live sessions | Implemented | Cap 8, idle TTL 60 minutes |
| Streaming/thinking/tool calls | Implemented | Official ACP constants plus isolated Grok `x.ai/*` adapter |
| Codex-style folded turns | Implemented | Per-user-turn virtualization, running-open/completed-collapsed execution groups and final answer outside process details |
| Codex project bridge | Implemented | Read-only SQLite/JSONL discovery, bundled-reader fallback, hide/refresh and independent `/resume-codex` handoff with SHA-256 guard |
| Claude Code project bridge | 0.6.7 local candidate | Read-only primary-JSONL discovery, bundled-reader/fallback parsing, sidechain/subagent exclusion, hide/refresh and independent `/resume-claude` handoff with SHA-256 guard |
| Codex mirror scrolling | Implemented | Bounded internal scroller keeps the read-only toolbar visible and supports wheel, touchpad, scrollbar and keyboard navigation |
| Workspace discovery | Implemented | Merges pinned/recent, Grok history and Codex projects; missing paths are disabled and labelled |
| Agent/Plan/Auto accept | Implemented | Client-side Plan write/command gate |
| Attachments/media | Implemented | Picker, drag/drop, pasted images, 20 MiB limit, generated media inline |
| Media Studio | Implemented | Independent image/video UI; `/imagine` image generation and ACP-safe `image_to_video` workflow with aspect, duration and resolution controls |
| Markdown/LaTeX/Mermaid | Implemented | Sanitized renderer and selected-language Shiki bundle |
| Model/reasoning controls | Implemented | Dynamic models; six effort values hot-switch on CLI 0.2.101; restart/restore only for old/unsupported CLI fallback |
| Composer focus and scrolling | Implemented | Non-blocking dialogs, focus restoration, forced-on-send and stream-aware bottom following |
| Text size / UI density | Implemented | Independent 85–130% text scale and Compact/Balanced/Comfortable layout density |
| Sub-agent/background tasks | Implemented | Explicit lifecycle routing; ordinary turn completion cannot create a sub-agent card |
| Context usage/compact | Implemented | Live and restored session context usage |
| OAuth billing quota | Implemented | Weekly/monthly/on-demand allow-listed calls, partial results, five-minute cache, proxy and one-time 401 retry; API keys explicitly unsupported |
| Drafts/history/notifications | Implemented | Per-session drafts, 50 prompts per workspace, Alt history, background Windows notifications and click navigation |
| Session convenience | Implemented | Pin, final-answer copy, Markdown export and Ctrl+N/F/L/Esc shortcuts |
| CLI update/rollback log | Implemented | Prompt, process suspension, ACP probe, rollback, session restore, JSONL history |
| Electron trust boundary | Implemented | Local/loopback renderer policy, top-frame IPC validation, navigation and external-protocol guards |
| Voice/telemetry | Excluded | No STT or analytics |
| VS Code integrations | Excluded | Standalone file picker and in-app diff instead |
| Worktrees/Git panel | Excluded | Not part of v1 |
| Installer/cross-platform | Excluded | Local Windows source build only |
