# Feature Matrix

## v0.5.0 / v0.5.1 / v0.5.2 additions

| Area | Status | Notes |
|---|---|---|
| Overlay root and layering | Implemented, automated | Settings, accounts/quota, extensions, diagnostics, onboarding, media, confirmations, notifications and Computer dialogs render in the dedicated overlay root; whole-window backgrounds no longer alter modal positioning |
| Custom providers | Implemented, automated | Chat Completions, Responses, Messages, local/remote presets, model discovery/test, user-env credentials, marked TOML block, conflict detection, five backups, validation and rollback |
| Persistent automations | Implemented, automated | Current-user least-privilege Task Scheduler registration, once/daily/weekly/interval, encrypted prompts, headless worker, locks, two-run global default, notifications, confirmation timeout and registration repair |
| Prompt queue/interjection | Implemented, contract tested | Server `x.ai/queue/changed` is authoritative; edit/remove/reorder/clear/interject use official identifiers and versions; old CLI interjection has a compatible send-now fallback |
| Fork, rewind and archive | Implemented, contract tested | Official fork plus conversation/all/files rewind; file-impact confirmation; archive is application metadata only and leaves Grok session files intact |
| Unified task center | Implemented | Queued prompts, command/monitor jobs, running sub-Agents, loops, persistent automations and confirmation/completion inbox |
| v0.5 local gate | Passed | 193 offline tests, 24/24 deterministic Computer Use flows, CLI 0.2.106 non-billable capability/provider probes, content/background/task-center smokes, Task Scheduler wakeup, Chinese-space Portable launch, Fuses, public artifact scan and NSIS install/upgrade/uninstall retention all passed; final hashes are recorded in the implementation plan |
| Hosted Runner UI probe | Fixed, v0.5.2 retry pending | v0.5.0 exposed an unbounded CDP wait; v0.5.1 bounded it and identified the synthetic 4K virtual-GPU hang in five minutes. Local packaging retains real 3840×2160 coverage while GitHub's virtual desktop verifies 1920×1080; both failed tags stopped before Draft creation and published no assets |

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
