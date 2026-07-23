# Feature Matrix

## v0.6.3 installed hotfix / v0.6.4 installed local candidate

| Area | Status | Notes |
|---|---|---|
| Scheduler diagnostics | 0.6.3 installed/verified | UTF-8/UTF-16/GB18030-compatible Buffer decoding, structured stable diagnostics and damaged-history replacement remove task-center mojibake; focused encoding/health tests pass. |
| Conversation navigation/layout | 0.6.3 installed + 0.6.4 source UI verified | Unified target opening and fixed conversation grid preserve the Virtuoso viewport, composer and focus. The 0.6.4 fixture passes Dashboard→chat→file preview→explicit editor→chat→task center→chat. |
| Multi-tool right pane | Source UI verified | On-demand launcher exposes only Review, plan/result, recent files and side tasks. Width is 420–760 px per tool; 1100 px uses a visible overlay drawer instead of CSS-hiding the panel. |
| Scalable Review | Focused/source UI verified | Lightweight index plus one selected `GitReviewFileDetail`; search/status/stats and lazy hunks handle the 850-file fixture. Five scopes, stale-snapshot protection, hunk actions and comments remain main-process-backed. Non-Git is an ordinary empty state. |
| Provider manager | Focused/source UI verified | Independent searchable manager with five presets, unsaved-draft probe/discovery, structured environment headers, candidate multi-select/import, editable collision-safe local IDs, manual fallback and unknown context windows. |
| Provider probe security | Focused-tested | Main process performs bounded model-list GET only, rejects redirects, limits timeout/2 MiB response, supports OpenAI/Anthropic/Ollama list shapes and keeps credentials out of logs/diagnostics. |
| Windows path aliases | Focused/Hosted regression verified | Existing absolute paths are canonicalized before workspace comparison, so 8.3 `%TEMP%` aliases and long `realpath` results refer to the same Editor/Memory/Agent/Git boundary. Symlink and junction escapes remain rejected. |
| 0.6.4 delivery | Installed and verified | Source/lockfile/display/File/Product/Main/About are 0.6.4. TypeScript, production build, 7 focused files / 55 tests, expanded source/packaged/installed UI fixtures, one final offline suite (291 pass/2 opt-in skip), Fuses, the final 243-file source scan and artifact scans pass. Per-user install, diagnostics ready, attachment privacy and both shortcut targets pass; final hashes are in `release/SHA256SUMS.txt` and the Changelog. |

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
| Public release evidence | Published and externally verified | `v0.5.16` is the Latest public Release at commit `e4dfb62`; workflow `29846404781` succeeded and published Setup/Portable, SHA-256, SBOM, licenses and provenance |

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
