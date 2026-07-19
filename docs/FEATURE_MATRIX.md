# Feature Matrix

## v0.4.0 public release and v0.4.1 convenience set

| Area | Status | Notes |
|---|---|---|
| Public/private configuration | Implemented and tested | One source tree; public defaults plus ignored local override; production rejects mock CLI/local secrets; machine-neutral BuildInfo |
| Windows distribution | Implemented and locally packaged | Stable appId/AUMID, unsigned per-user Simplified Chinese assisted NSIS and portable ZIP; uninstall preserves AppData/Grok data |
| Release evidence | Implemented and generated | SHA256SUMS, CycloneDX SBOM, third-party licenses; GitHub Draft Release and artifact attestations run on `v*` tags |
| Public-source safety | Implemented and passed | Repository/artifact scanner, Gitleaks workflow, expanded ignore rules; generated host/evidence/runtime data excluded |
| First-run wizard | Implemented | System/DPAPI/CLI/models/ACP/account/workspace/Computer checks; official install command, skip/rerun and capability degradation |
| Diagnostics/support bundle | Implemented and tested | Copyable result, preview before export, only versions/capabilities/redacted logs; no prompts/sessions/screenshots/content/full paths/proxy address |
| Application updates | Implemented and tested | Stable configured-repository Release API, six-hour cache, no unsigned download/execution, manual SHA-256 instructions |
| Dynamic effort flag | Implemented and tested | Detects current CLI help and chooses `--effort` or `--reasoning-effort` without rejecting unknown versions |
| Resource/Fuse hardening | Implemented and packaged | Plugin/host SHA-256 manifest; RunAsNode/NODE_OPTIONS/inspect off, cookie/ASAR integrity/OnlyLoadAppFromAsar on; final window smoke passed |
| Chinese/compact-device UX | Implemented | Segoe UI/YaHei stack, IME composition guard, 820×620 minimum, responsive sidebar, 100–200% OS DPI-compatible CSS |
| `@文件` reference | Implemented and tested | Cached async Chinese fuzzy index, `.gitignore`, hard directory/size limits and attachment-chip output |
| Attachment privacy | Implemented and tested | One-time warning for outside-workspace, `.env`, credential, private-key/certificate names |
| In-session search | Implemented | `Ctrl+Shift+F`, result count, previous/next and Virtuoso turn positioning |
| Stability recovery | Implemented | Existing single-instance lock, UI error reload/diagnostics actions, per-version UI metadata backup without copying Grok sessions |
| GitHub project files | Implemented | Chinese README, sanitized SVG preview, CONTRIBUTING/SECURITY/privacy, templates, CI/Release/CodeQL/Dependabot |
| Cross-device release gate | Pending external matrix | Windows 11/local portable smoke passed; Windows 10, clean-VM NSIS lifecycle, multiple hardware DPI/displays and public Actions require release-operator execution |

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
