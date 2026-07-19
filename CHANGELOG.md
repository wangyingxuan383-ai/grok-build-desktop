# Changelog

## 0.4.0 - 2026-07-19

### Added

- Added a public-release configuration layer with tracked defaults, an ignored local override, machine-neutral `BuildInfo`, stable `io.github.grokbuilddesktop.community` app/AUMID identity and an unsigned Simplified Chinese NSIS/ZIP release pipeline.
- Added a Chinese first-run wizard for Windows/DPAPI/CLI/ACP/account/workspace/Computer Use setup, including the official Grok CLI installation command and a rerun entry.
- Added a compatibility diagnostics center with capability-level degradation, dynamic `--effort`/`--reasoning-effort` probing, copyable summaries and a user-previewed ZIP support bundle that excludes prompts, sessions, screenshots, file contents, credentials, full paths and proxy addresses.
- Added low-frequency stable GitHub Release checks. Unsigned builds only show release notes, the release page and SHA-256 guidance; they never download or execute an installer.
- Added asynchronous `@文件` search with Chinese fuzzy matching, `.gitignore`/hard exclusions and attachment chips; sensitive/out-of-workspace attachments now require a one-time confirmation.
- Added `Ctrl+Shift+F` current-session search with virtual-list positioning, narrow-window sidebar collapse, a UI recovery/diagnostics entry, pre-version UI metadata backup and a product icon made from repository-owned assets.
- Added Chinese README, contribution/security/privacy documentation, sanitized UI preview, Issue/PR templates, CI, Gitleaks, CodeQL, Dependabot, Draft Release and artifact-attestation workflows.
- Added SHA-256, CycloneDX SBOM and third-party license generation plus offline/public-safety/Fuse/resource-integrity verification scripts.
- Added an explicit clean-runner NSIS lifecycle test for first install, overwrite upgrade, uninstall and `%APPDATA%` retention; it refuses to mutate a normal developer machine.

### Changed

- Fixed the public source build on Node.js 24 LTS and npm lockfile. `bootstrap.ps1` now performs Chinese preflight checks and modifies the desktop only when `-CreateShortcut` is explicitly requested.
- Pinned npm 11.6.2 locally and in GitHub Actions so the lockfile is not reinterpreted by a newer npm bundled with a later Node.js 24 patch release.
- Split deterministic offline `verify.ps1` from opt-in `verify-live.ps1`; the default path does not read real auth data, query quota, mutate plugins or invoke a paid model.
- GitHub CI now skips only foreground-desktop Computer Use actions unavailable to hosted service sessions while still compiling and self-testing the native host; local verification continues to run the complete 24-step foreground flow.
- Public packages include only `out/main`, `out/preload` and `out/renderer`; historical test evidence and cleanup scripts can no longer enter `app.asar`.
- Public verification and packaging now prepare Electron's lazy binary once before parallel tests and fail immediately on any non-zero native command instead of continuing to produce a false-success package.
- The default font stack now prioritizes Segoe UI and Microsoft YaHei, Chinese IME composition/virtual-key 229 cannot trigger send, and layouts adapt from 1280×720 through high-DPI displays.
- About and README now identify the app as an unofficial community client with no xAI affiliation.

### Fixed

- Made Computer Use foreground activation temporarily join the relevant Windows input queues and always detach them afterward, eliminating intermittent `SetForegroundWindow` rejection in packaged and CI-launched probes.
- Codex mirror fallback now checks that the bundled reader exists before launching Python, avoiding Windows Store aliases or slow process lookup from consuming the test and UI timeout.

### Security

- Added pre-commit/public-artifact scanning for real user paths, emails, legacy proxy values, local config and credential patterns; expanded `.gitignore` for runtime data, secrets, certificates, logs and generated native files.
- Enabled cookie encryption, ASAR integrity and OnlyLoadAppFromAsar while disabling RunAsNode, `NODE_OPTIONS`, CLI inspect and extra file-protocol privileges. Build verification asserts the fuse wire.
- Added SHA-256 resource manifests for the built-in Computer plugin and generated Windows host; Computer Use is disabled if packaged resources fail verification.
- Kept Renderer sandboxing, CSP, typed IPC sender validation and strict configured-repository update URLs.
- Pinned every GitHub Actions dependency to a verified full commit SHA while retaining the major-version comment for Dependabot updates.

### Verified locally

- A clean `npm ci` followed by the fail-fast public packaging command passed TypeScript, production builds, public safety scanning, zero npm vulnerabilities and 148 tests (2 explicit live cases skipped).
- Unsigned NSIS and portable ZIP were generated with the required names, passed source/artifact scanning, resource and Fuse verification, and produced SHA-256, CycloneDX SBOM and third-party license reports.
- `win-unpacked` and the portable ZIP extracted to a Chinese path containing a space on a non-system drive both opened a visible window. The first Fuse build exposed and fixed a browser-snapshot incompatibility before final packaging.
- After the foreground-activation hardening, the 24-step Computer Use harness passed three consecutive runs with zero wrong-window or unconfirmed high-impact actions.
- The public GitHub CI, Gitleaks, CodeQL v4 and tagged Draft Release workflows passed; the clean Windows runner also passed NSIS install, overwrite upgrade, uninstall and AppData-retention checks, both EXE/ZIP attestations verified, and the uploaded portable ZIP opened visibly after downloading it back into a Chinese path on a non-system drive.
- Windows 10/11 target-device installation plus human login, conversation, recovery, update-prompt and Computer Use checks remain the gate before the Draft Release is made public.

## 0.3.1 - 2026-07-18

### Changed

- Ordinary non-protected applications now enter Computer Use immediately by default. The optional “控制新应用前询问” toggle can restore per-app confirmation; high-impact actions still require a separate one-action confirmation.
- Pointer actions now use UI Automation for target discovery but execute through the real Windows system pointer after a visible 180 ms dwell. Buttons no longer disappear into a background `InvokePattern` path.
- The built-in Computer Skill and Windows helper version are now `0.3.1`; action summaries never include typed text or secret values.

### Added

- Added a click-through, non-focus-stealing blue display-edge overlay with a top status banner, application name, current action, step count, pointer halo and an `Esc` stop hint.
- Added an in-app Computer Use live strip with current activity, pause/resume/stop controls and an explicit “已手动完成，继续” path after Windows security handoff.
- Added a dynamically registered global `Esc` stop while Computer Use is active; `Ctrl+Alt+Esc` remains the fallback shortcut.
- Added explicit UAC/elevated-window handoff state: the task pauses, explains what the user must complete, and re-observes the original target on resume.

### Fixed

- Fixed invisible background clicks, repeated ordinary-app permission prompts, missing global activity visibility, and ambiguous pause/UAC status.
- Fixed the PowerShell 5.1 deterministic probe's optional stream-encoding properties and added persistent packaged-UI acceptance JSON.

### Verified

- 137 default tests passed with 2 opt-in tests skipped; type check, production build and high-level npm audit passed.
- Deterministic Windows acceptance passed 24/24 and now verifies the real system cursor reaches the target point.
- Real Grok visual click and rejected high-impact loops passed; packaged Electron acceptance verified no default app prompt, blue overlay, in-app status, `Esc`, lifecycle, focus restoration and the real risk dialog.
- Full `verify.ps1 -RequireLiveComputerAction -RequirePackagedUi`, final packaging, visible-window smoke and the unique desktop shortcut passed.

## 0.3.0 - 2026-07-18 (Accepted experimental)

### Added

- Added a lazy-loaded Grok Extension Center with installed plugins, marketplace catalogs, Skills, MCP services, Hooks, Computer Use diagnostics and read-only Codex plugin compatibility tabs.
- Added typed extension IPC and a private-ACP-first adapter for `x.ai/plugins/*`, `x.ai/marketplace/*`, `x.ai/mcp/*` and `x.ai/commands/list`, with CLI JSON fallbacks when Grok CLI does not publish those private methods.
- Added DPAPI-backed MCP secret environment values. Grok config receives `${GROK_DESKTOP_MCP_*}` references; the plaintext value is injected only into Grok child-process environments.
- Added a clean-room x64 `GrokComputerHost.exe` built from C# source. It exposes a JSON-lines protocol for window enumeration, UI Automation discovery, per-monitor DPI coordinates, screenshots, foreground activation and single-step input actions.
- Added a token-authenticated `127.0.0.1` Streamable HTTP MCP server per live Grok session. The session receives it through ACP `mcpServers`; the built-in `/computer` Skill is injected with `_meta.pluginDirs` and is packaged as an Electron extra resource.
- Added `@Computer` application/window selection, a composer chip, per-app once/always/deny authorization, high-impact action confirmation, pause/resume/stop controls and the global `Ctrl+Alt+Esc` emergency stop.
- Added Computer Use execution cards with the latest screenshot inside the existing multi-level execution fold. Screenshots are not written to application logs; audit JSONL records only session/app/action/time/result metadata.
- Added read-only Codex plugin classification and safe Grok adapter copies for Skills/resources/standard MCP configuration. Codex Computer Use is explicitly classified as non-portable.
- Added non-executing local/Git plugin previews with bare-clone inspection, fixed commit/fingerprint verification, component/script/license inventory and source-change rejection before trusted installation.
- Added official marketplace commit provenance, direct leading `@Computer`/exact `@应用名` invocation, model-visible pause/resume/stop tools, busy-turn extension mutation queuing and stale Codex adapter refresh indicators.
- Added optional original-resolution detail crops alongside the bounded full-window PNG, plus model-visible UIA values.
- Added a deterministic native test application and 24-flow acceptance harness covering clicks, text, keys, scrolling, drag, window movement, minimize/restore, stale state, wrong foreground, detail crop and controlled launch.
- Added reversible xAI Official plugin acceptance, packaged Electron CDP acceptance and opt-in real Grok visual/risk acceptance scripts. Computer Use is now available by default but remains dormant until explicitly invoked.

### Security

- Plan mode is observation-only. State-changing actions require the latest one-use `stateId`, exact window identity and foreground ownership.
- Exact-window Electron capture is preferred over the native `PrintWindow` fallback; screenshot coordinates are mapped back to physical window coordinates and clamped before input injection.
- Grok Build Desktop, Codex/ChatGPT, terminal processes, UAC/Windows Security and elevated windows are denied in both the native helper and main-process policy.
- Password/OTP/CAPTCHA targets are returned to the user. Delete, send/publish, financial, install, account-access, security-setting and sensitive-transfer intent is classified for immediate one-action confirmation.

### Fixed

- Fixed x64 Unicode `SendInput` structure layout and made failed native input injection return an explicit error.
- Fixed `double_click` incorrectly degrading to a single UIA Invoke action.
- Fixed a race where stopping immediately after application authorization could let the in-flight first observation overwrite `stopped` with a false Computer Host error.
- Fixed CLI fallback extension reload so busy/user-waiting sessions queue the operation, while idle sessions restart and restore their original session IDs.

### Verification

- Final `verify.ps1 -RequireLiveComputerAction -RequirePackagedUi` completed successfully: deterministic/native tests, TypeScript, production build, real ACP/media/extensions/quota, reversible official-plugin state, live Grok visual/risk loops, zero npm vulnerabilities, visible-window smoke and packaged Electron UI all passed in one run.
- TypeScript and the default suite pass: 23 test files, 129 tests passed; the opt-in live file and its two environment-gated cases remain skipped in the default run.
- The current Grok CLI `0.2.101` accepts `_meta.pluginDirs` and publishes the injected `/computer` Skill. Its private extension request methods return `Method not found`, so v0.3.0 uses the documented CLI JSON fallback on this machine.
- The authenticated loopback MCP contract rejects missing tokens and exposes the clean-room tool inventory, PNG and detail-image results. A real Grok model observed the fixture, clicked `Increment` exactly once, verified `increment:1`, and stopped; a second delete attempt produced one risk request, was rejected and executed zero actions.
- The x64 helper passed 24/24 deterministic flows at DPI 96 with 100% single-action accuracy, zero wrong-window actions and zero unconfirmed high-impact actions. Calculator separately passed screenshot → 35 UIA elements → single click → new state at DPI 120. DPI 144 and a negative-origin secondary-display layout are covered by the runtime coordinate-function matrix.
- Packaged Electron acceptance passed all seven Extension Center tabs, non-executing local plugin preview, marketplace provenance, permission actions, pause/resume/stop, global `Ctrl+Alt+Esc`, input focus and a real Grok high-impact risk dialog/rejection.
- Codex plugin tree hashing now runs concurrently and the tab presents an explicit loading state instead of briefly claiming no plugins were found.
- The installed xAI Official `chrome-devtools-mcp` 1.6.0 was temporarily disabled and re-enabled; path, source, version, commit `77e1d3f9616d5b32671da0b9ea094f4929c14a9c` and original enabled state were restored.
- Detailed evidence and the single-physical-display limitation are recorded in `docs/COMPUTER_USE_ACCEPTANCE.md`.

## 0.2.1 - 2026-07-16

### Added

- Added a standalone “Grok 媒体创作” panel with separate image/video tabs, prompt input, aspect ratios, 6/10-second video duration and 480p/720p video controls.
- Added typed media-capability IPC and command construction. The app only submits media workflows advertised by the live Grok ACP session.
- Added media capability and generated-media ACP contract coverage, plus a packaged-renderer probe for Codex scrolling and the media form.

### Changed

- Image creation uses the ACP-advertised `/imagine` command.
- Grok CLI `0.2.101` documents `/imagine-video` but does not publish that alias through ACP. The desktop app therefore uses the advertised `/imagine` skill and explicitly requests its built-in `image_to_video` workflow instead of sending an unadvertised command.
- Available commands received before `session/new` completes are re-emitted with the final session id, so Slash completion and media capability detection no longer lose the initial command snapshot.

### Fixed

- Fixed long Codex read-only mirrors being clipped by the outer application grid and refusing to scroll below the visible window.
- The Codex content pane now has a bounded internal vertical scroller with mouse-wheel, touchpad, scrollbar and keyboard scrolling while the read-only action bar remains visible.

### Verification

- TypeScript, 18 test files / 92 tests and the production build pass.
- Real Grok CLI `0.2.101` ACP probing published `/imagine`; the installed Imagine skill documents `image_gen`, `image_edit` and the `image_to_video` video workflow.
- The packaged renderer scrolled a real Codex mirror from `0/2813` to its `2194`-pixel maximum with a `619`-pixel viewport.
- The packaged renderer opened the independent media panel, focused its prompt, exposed image/video tabs, reported the live `image_to_video` fallback and enabled the complete video form without submitting a billable generation.

## 0.2.0 - 2026-07-16

### Added

- Added Codex-style per-request turns with a multi-level execution fold: thought/process notes, file operations, commands, sub-agents and other tools are grouped below a single summary while the final answer remains outside the fold.
- Added read-only, project-scoped Codex task mirrors with SQLite/JSONL discovery, bundled-reader fallback, hide/refresh controls and an independent `/resume-codex` Grok handoff.
- Added automatic workspace discovery from pinned/recent paths, Grok history and Codex projects, including grouped menus, first-run project cards and missing-path diagnostics.
- Added an OAuth quota panel for weekly credits, monthly included/used/remaining amounts and on-demand limits, with proxy support, five-minute caching, partial-success retention and one-time 401 credential refresh.
- Added per-session drafts, the latest 50 prompts per workspace with `Alt+Up/Down`, background completion/failure notifications, final-answer copy, Markdown export and session pinning.
- Added `Ctrl+N`, `Ctrl+F`, `Ctrl+L` and `Esc` shortcuts, plus typed IPC for Codex, quota, workspace, draft/history, export and notification navigation features.

### Changed

- Virtualized conversations now render by turn; the active execution group opens automatically and completed/stopped/crashed turns converge to a compact summary.
- Markdown, Diff and Codex mirror rendering are lazy-loaded so workspace discovery and session switching do not eagerly load the heaviest renderer modules.
- CLI compatibility verification now probes the bundled Codex reader and allow-listed billing adapters while preserving ACP `initialize + session/new` as the rollback boundary.
- Desktop delivery now keeps only `Grok Build Desktop.lnk`; the old Codex icon-backup file was moved to `%USERPROFILE%\.codex\backups` without changing the live Codex shortcut target or icon.

### Fixed

- Fixed completed or stopped turns retaining running sub-agent/background-tool state; all remaining activity is settled on completion, cancellation or process failure.
- Fixed deleting the active Grok session leaving its old conversation and composer visible after the session had already been removed.
- Fixed `Ctrl+N` using the pre-bootstrap workspace closure and incorrectly opening a folder picker even when an active workspace was already selected.
- Fixed the empty-state top bar saying “请选择工作区” while the sidebar already had an active workspace.

### Verification

- TypeScript, 16 test files / 84 tests, production build and `win-unpacked` packaging pass.
- Real Grok CLI `0.2.101` ACP probing, bundled Codex-reader probing, weekly/monthly OAuth quota calls and high-severity npm audit pass.
- A real Codex task was mirrored, handed off to a temporary Grok session, stopped and deleted; the source JSONL SHA-256 remained unchanged before and after.
- Packaged-window checks passed for grouped/folded turns, final-answer placement/copy, bottom following, composer focus, drafts, prompt history, workspace discovery, Codex mirror/handoff, quota display, session pin/export/delete and keyboard shortcuts.
- The refreshed desktop shortcut launched a visible independent window, and the desktop contains no Grok executable, backup or script artifact.

## 0.1.1 - 2026-07-15

### Changed

- Reasoning effort now changes immediately through Grok CLI 0.2.101's private `session/set_model` metadata extension; all six values were verified live. Restart/restore remains only as a compatibility fallback for an empty CLI-default value or older CLIs that do not confirm the change.
- Replaced every Renderer `window.confirm`/`window.prompt` with non-blocking React dialogs and restored composer focus after dialogs, settings, file pickers, session changes and model controls.
- Split the old scale control into independent text size (85–130%) and Compact/Balanced/Comfortable interface density. Existing 70% settings migrate to 100% text plus Compact density.
- Stream events are batched per animation frame; message/Markdown cards are memoized, Monaco Diff, Mermaid and Shiki are loaded on demand, and cold update checks run after the first window render.
- Conversation scrolling now forces the user's sent message into view, follows a growing streamed reply while at the bottom, explicitly settles both Virtuoso and its native scroller after restore/completion, respects deliberate upward scrolling, and provides a “回到底部” button.

### Fixed

- Fixed ordinary `turn_completed` notifications being misclassified as a forever-running sub-agent. Added explicit sub-agent and background-task lifecycle handling, completion convergence, exit codes and truncation state.
- Fixed a session-open race where the initial bottom-follow timer could run before restored messages reached the Renderer and incorrectly clear the pending follow state.
- Fixed late Markdown measurement leaving the latest restored or completed reply below the viewport even after `scrollToIndex`; the final alignment now also uses the native scroll container and was verified in the packaged window.
- Fixed controls displaying the global default effort instead of the active session's real effort, and prevented model/effort/mode changes while a turn or permission request is active.
- Fixed rapid session-open races, duplicate prompt submission, attachment failures leaving a false working state, startup failures leaking Grok processes, crashed process entries remaining live, and cancel exposing a premature idle state.
- Fixed Plan-mode command-chain/redirection bypasses and hardened Electron navigation, frame ownership, IPC origin, external URL and packaged-renderer trust boundaries.
- Serialized JSON store writes with unique temporary files; coalesced concurrent CLI updates; improved update process-tree cleanup, session restoration reporting and secret redaction.
- Added visible terminal-output truncation state, safe method-not-found replies for unknown ACP requests, and an Auto mode fallback when no allow permission option exists.

### Verification

- Added security-policy, Plan Gate, JSON-store concurrency, CLI-update mutex, live-effort/fallback, ACP lifecycle and Renderer-store regression tests.
- Verified all six live effort values against Grok CLI `0.2.101`, with `model_changed` confirmation and temporary-session cleanup.
- Re-audited the desktop: exactly one project shortcut remains, `Grok Build Desktop.lnk`; no second Grok `.link`, `.url` or shortcut exists.
- Re-ran the full verifier on 2026-07-16: TypeScript, 69 tests, production build, live ACP effort probe, zero-vulnerability audit and packaged visible-window smoke all passed.
- In the packaged window, verified restored/latest reply auto-positioning, a real prompt/reply completion at the bottom, `xhigh → high` without a modal or PID change, and composer focus after effort/settings interactions.

## 0.1.0 - 2026-07-15

### Added

- Added a sandboxed Electron desktop shell with Codex-style workspace/session/chat layout and typed IPC.
- Added Grok CLI discovery, proxy inheritance, ACP process pooling, streaming chat/thinking, cancellation, model/mode switching, reasoning-effort restart and session restore.
- Added official ACP SDK method/version constants plus an isolated Grok `x.ai/*` compatibility layer for questions, plan exit, notifications and sub-agent lifecycle events.
- Added ACP filesystem, terminal, permissions, command output, tool cards, Monaco Diff, Agent/Plan/Auto modes and a client-enforced Plan Gate.
- Added shared Grok history indexing, Windows path-case compatibility, rename/search/delete/clear, unread/live states, restored messages/tools/media/plans and persisted context usage.
- Added Markdown/GFM, selected-language Shiki highlighting, KaTeX, Mermaid, virtualized long conversations, Slash Command completion and Token usage display.
- Added file picker and drag/drop attachments, pasted images with a 20 MiB limit, plus generated image/video display, open-file and copy-path actions.
- Added DPAPI-backed OAuth/API-key account profiles, visible device-code fallback, atomic account switching, ACP login validation and failure rollback.
- Added CLI update check/apply/probe/rollback/history with live-session suspension and restoration.
- Added `bootstrap.ps1`, `update-grok.ps1`, `rebuild-app.ps1`, `verify.ps1`, ACP probe and visible-window smoke scripts.
- Added a `win-unpacked` build and direct desktop shortcut.
- Added 15 automated tests, a fake-CLI ACP contract test and zero-vulnerability npm audit override.

### Fixed

- Fixed production `file://` asset paths that initially produced a blank Electron window.
- Fixed virtualized conversation horizontal overflow and clipped user messages.
- Fixed restored events losing their session id during `session/load`.
- Fixed old VS Code Grok sessions not appearing when Windows drive/path casing differed.
