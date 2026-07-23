# Changelog

## 0.6.4 - 2026-07-23 (installed local candidate)

### Changed

- Replaced the Review-only right rail with an on-demand, resizable utility pane for real Review, plan/result, recent-file preview and background/queue task data. Unsupported terminal/browser placeholders remain absent.
- Review now loads a lightweight file index first and only fetches the selected file's hunks. Search, status and line statistics remain usable with an 850-file change set instead of rendering every Patch at once.
- Removed File and Review from the permanent left tool list. Recent files open read-only in the utility pane and enter the central Monaco workbench only after an explicit “编辑文件” action.
- Moved custom providers into a dedicated searchable manager with five presets, draft connection testing, pre-save model discovery, candidate search/multi-select/import, safe editable local IDs and manual-model fallback.

### Fixed

- Conversation navigation now survives Dashboard → conversation → file → conversation → task center → conversation without losing the message viewport or composer.
- The right utility drawer remains visible at narrow widths instead of being hidden by a conflicting media rule. Non-Git Review is an ordinary capability empty state and falls back to recent writes where appropriate.
- Provider discovery keeps unknown context windows unknown instead of fabricating 128K/200K defaults. Draft probes perform bounded main-process model-list GET requests only, reject redirects/oversized responses and keep credentials out of Renderer logs.

### Verification

- TypeScript and the production main/preload/Renderer build pass. Seven focused files / 55 tests cover provider draft discovery, local-ID collisions, 401/timeout/oversize handling, Review index/detail/stale snapshots, the 850-file index, Scheduler health and Renderer stores/comments.
- The isolated 0.6.4 source fixture passes Dashboard → chat → recent file preview → explicit editor → chat → task center → chat, the four-tool right launcher, non-Git Review, 1280×720/1440×810@125%/1920×1080@200% composer bounds, a visible 1100 px drawer and the provider-manager preset/draft workflow. No model request is sent.
- The one final offline suite passed 291 tests with 2 explicit opt-in/live tests skipped (60 files passed, 1 skipped) using one Windows worker. The final public-source scan passed 243 text files after adding the installed-version probe.
- The sole formal package passed Electron Fuses and both public-source/artifact scans. The packaged and installed 0.6.4 fixtures pass the navigation cycle, recent-file preview/editor return, four-tool right pane, non-Git Review, responsive composer/drawer and provider manager.
- Per-user installation succeeded at `%LOCALAPPDATA%\Programs\Grok Build Desktop`. File/Product/Main/About versions report 0.6.4, diagnostics reports “可以使用”, attachment privacy exclusions remain present, and desktop/Start Menu shortcuts target the installation directory.
- Final local artifacts: Setup `be0080e4ce0d44528840fa6923e469b26407327d246bbf140e6f761bd76a8ca5`; Portable `1d6104e3ffdad4ae1cc5ca7c80f5352a3e8c63d7e72cb69df55bbc16837480c6`; CycloneDX SBOM `feb7207c0ed97e931fa31a54090658a5ba3aea701fb9af41add6f12817532b67`; third-party licenses `fb8469bdbecff72100bd94c44b2f67f1b596ade9854d95ce862a7559d3b1d82e`. Named 0.6.0–0.6.3 Setup/Portable/SBOM assets remain in `release`.

## 0.6.3 - 2026-07-23 (installed local hotfix)

### Fixed

- Windows Task Scheduler output is decoded from Buffer through UTF-8/UTF-16/GB18030-compatible paths and stored as structured diagnostics. Historical strings containing replacement characters now show a recoverable encoding-damage message instead of mojibake.
- Unified conversation targeting across sidebar tasks, persistent tasks, Dashboard, menu commands and deep links; returning from workbenches remounts/resizes the virtual conversation and restores the composer.
- Replaced the conversation body with a fixed header / `minmax(0,1fr)` messages / composer grid, added an always-visible “返回会话” action to workbenches and removed the duplicate bottom environment bar.
- Non-Git Review no longer raises a global error, and responsive CSS no longer creates a clickable-but-invisible Review state.

### Verification

- The accepted focused hotfix gate passed 27 tests, TypeScript, production build and public-source scanning. The first package candidate was rejected by the new 720 px composer-bound check and was not installed.
- The corrected 0.6.3 package passed the navigation/composer/non-Git Review fixture and was installed per-user. File/Main/About report 0.6.3, shortcuts target the installation directory, and the installed executable is the stable fallback while 0.6.4 is verified.
- Accepted hashes: Setup `e511290b900eaa2044025789de843d125be140d60804e22de3105bc4a76ec3e1`; Portable `a4eb6af38d742225ef02383483dfbe046c3095a480abc5356c90813e1265d45e`; SBOM `c628bff49c5e2d9b2df5f5860489ea4852e5ec477eced01998913a4a0fae4b95`.

## 0.6.2 - 2026-07-22 (local candidate)

### Changed

- Replaced the generic right summary rail with an on-demand, resizable Review pane covering Unstaged, Staged, Commit, Branch and Last turn scopes, unified hunks, real file/hunk Git actions and line-comment drafts.
- Added a typed execution-root-aware navigation channel shared by tool locations, Review, central Diff and the Monaco editor. File editing is now an explicit mode after read-only inspection.
- Reworked the sidebar into project task groups plus one default-collapsed development-tools section, added a searchable/closable workspace popover and task title menu, and removed the duplicate bottom-panel toggle.
- Added categorized settings and live background preview, and removed the fixed 72% conversation overlay so configured opacity, blur and dim values map directly to the canvas.
- Added persisted turn start/completion metadata with monotonic duration and outcome. Completed work collapses to “已处理”, while legacy process-only segments coalesce into one historical record without fabricated time.

### Fixed

- Tool and Review file jumps now resolve against the active session or Worktree execution root instead of the unrelated global workspace and position Monaco after mount.
- Generated images render in the final result area with large preview; 0.6.1 user-image cache, failed restore and reopen behavior remain intact.

### Verification

- Source version and lockfile are 0.6.2. TypeScript, production main/preload/Renderer builds, 9 focused files / 48 tests and the final 238-file public-source scan pass.
- The opt-in 0.6.2 fixture passes automated 900×720, 1100×720 and 1440×810 checks for default shell state, 30 legacy-process segments coalesced into one record, real elapsed display, Review scopes, ten settings categories, exact background controls, pasted-image failed-send retention and Renderer reopen.
- Computer Use against the isolated Grok window verified the rendered conversation, real unified Review, Review→read-only Monaco navigation, categorized settings, appearance preview and Escape close without sending a paid model prompt.
- The one final offline suite passed 284 tests with 2 explicit opt-in/live tests skipped (60 files passed, 1 skipped) using one Windows worker to avoid Git/ACP child-process contention.
- The sole formal package passed Electron Fuses and two streamed artifact scans. Packaged and installed 0.6.2 fixtures passed Review scopes, settings, exact background controls, responsive layout, pasted-image failure retention and Renderer reopen. Per-user file/Main/About versions report 0.6.2, diagnostics reports “可以使用”, and desktop/Start Menu shortcuts point to the installation directory.
- Final local artifacts: Setup `8a2d7508296ee5846bb589c01ce4fa64a2194cd40a1ae5ba6d96a733432ca8d7`; Portable `9aa7251857c2c33044354ee8c51ade36f9d18409946a16f47d8d1a11d7532f83`; CycloneDX SBOM `e00f6eb90a5fd33ac0aebb953283fb59d924c339d4bede8467305deddfe4d714`; third-party licenses `e5e4edd9035f514d7b111bd3417db46ce86f3f51396b11b05fb8db1d677ecdff`. 0.6.1 named Setup/Portable/SBOM assets remain in `release`.

## 0.6.1 - 2026-07-22 (local candidate)

### Changed

- Rebuilt the application shell around Codex's task-first information architecture: direct left navigation, collapsible project tools, project session groups, task/header controls, a 320 px responsive summary rail, a real Git/Worktree environment bar and a toggleable bottom changes panel.
- Constrained conversation content to a focused 760 px column, refined process/file groupings, and aligned the floating composer across idle, running, queued, interjection and stop states while retaining the configured conversation background with stable readability layers.
- Session hover actions now expose Pin and Archive directly and keep Export/Rename/Delete in the necessary overflow menu. Unsupported PR/site/feedback/voice controls were not added.

### Fixed

- Pasted images now survive send and session reopen. `clientMessageId` and durable attachment previews bind images to the user message; ACP replay merges into that message instead of creating blank or duplicate turns.
- Inline images are validated and materialized in a session-scoped main-process cache before ACP receives standard image blocks. Image paths are no longer duplicated in prompt text; queue/interjection/failure flows use the same attachment presentation.
- Failed messages retain their images and can restore available content to the composer. Missing sources render a named fallback instead of blank space, and deleting a session removes its attachment cache.
- Startup now completes orphan attachment cleanup before Renderer restore/materialization, preventing a fast reload from deleting a newly created session-image directory.
- Public artifact scanning now streams UTF-8/UTF-16 chunks instead of decoding every large EXE/ZIP into memory at once; the same local-path rules remain enforced under constrained Windows commit memory.

### Added

- Added the sanitized `docs/CODEX_UI_PARITY.md` audit matrix and an opt-in packaged offline UI fixture for message cards, navigation, summary/environment panels, pasted-image before/after visibility, lightbox and responsive/reopen acceptance without a paid model prompt.
- Added focused attachment-cache and message-merge tests, main-process PNG/JPEG/WebP/GIF/MIME/20 MiB validation, orphan/capacity cleanup and explicit support-bundle exclusion for attachment bodies, Base64, cache files and full paths.

### Verification

- The accepted full offline suite passed 270 tests with 2 explicit opt-in tests skipped (57 files passed, 1 skipped). Windows Git/ACP integration workers are capped at four with a 20-second harness timeout; after the packaged reload race was fixed, TypeScript and 23 directly affected tests passed again.
- Production main/preload/Renderer builds, Electron Fuses, the final 229-file source scan and two complete streamed artifact scans pass. Packaged acceptance covers the base shell, 1280×720 and 3840×2160 composer/theme/focus flows, Task/Extensions/Media overlays, the 0.6.1 shell fixture, 1100×720 and 1440×810 responsiveness, Task Scheduler headless wakeup and Portable launch from a Chinese/space-containing path.
- The final Setup was installed per-user at `%LOCALAPPDATA%\Programs\Grok Build Desktop`. Desktop and Start Menu shortcuts target that executable; file/product version, main-process bootstrap and About all report 0.6.1, while the diagnostics center reports “可以使用”. The installed offline fixture confirms pasted-image preview, message visibility after send failure and visibility after Renderer reopen without sending a paid model prompt.
- Final local artifacts: Setup `dfc9d2a3feb62a4ac49d7fe76bf9bd07e3cf8289f2966a0fd85837a06a4043ba`; Portable `553bc500f3f8da69406fea56798c3c2b5b6317db272a0e154d192a8332982316`; CycloneDX SBOM `fafef7cc7197b6f0dc4a7de4c6260725487c825623f94ba67e32ffdf9f45dbbb`; third-party licenses `5a82814c8a9a7147c245f09b3d992e7923fd5550d1fe3617df8f969a82acacc2`. The named 0.6.0 Setup/Portable/SBOM assets retain their original hashes and were not overwritten.
- Earlier preflight attempts are not release evidence: one exposed a 5-second Memory harness timeout, one used a malformed session `TEMP` under excessive child-process concurrency, and the first package was rejected by the new reload fixture because it exposed the startup cache race. Only the hashes above identify the accepted 0.6.1 candidate.

## 0.6.0 - 2026-07-22 (local candidate)

### Documentation

- Added the canonical next-session handoff covering the v0.5.16 release baseline, accepted product behavior, resolved regressions, security boundaries and non-repetitive verification discipline.
- Recorded the approved v0.6.0 plan for the lightweight editor, Git panel, Grok Worktrees, workspace-scoped Memory, Agent/Persona management, Agent Dashboard and reusable session execution profiles. Implemented items are marked only after focused automation or documented live acceptance.
- Reconciled the implementation plan, feature matrix and CLI compatibility matrix with the published v0.5.16 release instead of the superseded local-candidate/v0.5.12 Latest status.

### Changed

- Rebuilt the Renderer shell after a read-only Computer Use comparison with the current Codex desktop layout: one quiet project/task sidebar, a labelled workbench switcher, compact context header, centered content column, floating composer and a restrained empty state replace the dense icon grid and oversized welcome treatment.
- Replaced remaining file-workbench glyph controls with consistent inline SVG icons, reduced completed execution-process spacing, and added a minimum readability scrim for user-selected conversation backgrounds.
- Replaced the five cramped per-session hover glyphs with one overflow menu containing labelled Pin/Archive/Export/Rename/Delete actions; clicking outside now closes the menu.
- Updated the v0.6 Electron UI probes to navigate through the labelled workbench menu rather than the removed activity-icon grid.

### Added

- Added the v0.6 shared contracts for workspace trees, editor documents/conflicts, Git, Worktrees, Memory, Agent/Persona definitions, Agent Dashboard nodes, execution profiles, CLI capabilities and automation health.
- Added a main-process `CliCapabilityService` with version caching, explicit `supported`/`unsupported`/`unknown` states, non-billable help/inspect probes and ACP runtime evidence overlays. The snapshot is exposed through sender-validated IPC and the sandboxed Preload bridge.
- Documented v0.6 service ownership and IPC boundaries in `docs/V060_ARCHITECTURE.md`.
- Added the first file workbench: activity switching, lazy ignored-aware file tree, bundled offline Monaco workers, multi-tab editing, cursor/dirty-buffer retention, create/rename/delete/reveal actions and built-in find/replace/go-to-line behavior.
- Added main-process workspace/editor services with canonical `realpath` boundaries, symlink escape rejection, UTF-8/BOM/GB18030 and CRLF/LF preservation, 5/20 MiB thresholds, SHA-256/mtime conflict detection, transient rollback backup and atomic replacement.
- Added disk-conflict Diff/reload/overwrite/save-copy choices and file/line references for “添加到对话 / 解释 / 修改”.
- Added the main-process Git service and source-control workbench: porcelain-v2 status groups, credential-sanitized remotes, worktree/index Diff, single/batch/all stage and unstage, stdin commit, history/details, branch creation/switching, five-minute cancellable Pull/Push and exact-list discard.
- Added one-time full-repository trust for subdirectory workspaces, dirty-editor branch-switch blocking, conflict-to-editor navigation and typed sender-validated `git:*` IPC through the sandboxed Preload API.
- Added the Worktree service and activity view with Grok private-method preference plus a controlled Git fallback, durable source/Agent metadata, create/recovery inventory, commit/file/line-count apply previews, preview tokens, target/source cleanliness gates, merge-result verification and conflict preservation.
- Added optional post-apply cleanup (off by default), rejection of dirty or unmerged Worktree removal, read-only GC preview, file/Git/session navigation and typed `worktree:*` IPC. New sessions and forks can select Worktree execution profiles, names and base refs; Worktree sessions use their own source group, while native repository identity shares project Memory across clones and Worktrees.
- Added the main-process Memory service and center: exact Grok `org/repo` + ASCII slug + BLAKE3 layout, default-off per-workspace AppData settings, `GROK_MEMORY` process injection, global/project/session browsing and search, Monaco editing, atomic conflict-safe saves, preview-token remember, session-summary deletion and fixed-argument `grok memory clear`.
- Added explicit `/flush` and `/dream` controls with visible status/timestamps, native-off/controlled-restart session enablement, strict `GROK_HOME/memory` realpath/symlink boundaries, disabled Memory debug logging and explicit support-bundle exclusion.
- Routed confirmed remembers through the active ACP session's native `/remember`, added exact structured-entry parsing/deletion with fresh preview tokens and hash-conflict protection, and added configured idle session-end Flush/automatic Dream behavior without running these commands during controlled restarts or CLI-update suspension.
- Added the main-process Agent/Persona definition service and central workbench: builtin/plugin/user/project source grouping and precedence, read-only bundled/plugin definitions, structured Agent fields, Persona defaults/contracts, bundled Monaco raw Markdown/TOML editing and typed sender-validated `agents:*`/`personas:*` IPC.
- Added user/project create/copy/edit/toggle/rename/delete, exact comment/unknown-field preservation, Windows-safe name/path and symlink checks, external SHA-256 conflicts, temporary atomic replacement, persistent `.grok-desktop.bak`, fixed-argument `grok inspect --json` validation with rollback, and current-CLI fallback that restarts only idle sessions. Persona creation remains file-based and never edits `config.toml`.
- Added reusable session execution profiles with five built-in presets, global/project AppData precedence, immutable per-session snapshots and native Agent/process/ACP metadata compilation. New sessions, forks and persistent tasks share the same selector; unsupported `maxTurns` is visibly disabled and rejected instead of ignored.
- Added a desktop-native Agent Dashboard backed by ACP status/tool/meta/sub-Agent events, task inventory and session history. It shows parent/child state, Agent/Persona, model/effort, duration, tools/context and Worktree isolation; it supports open/stop/jump/filter/UI-clear actions and never starts the Grok TUI Dashboard.
- Added persistent-task health checks and conservative repair. Registration, current executable mapping and stale session metadata are repairable; missing accounts, providers, models, workspaces or execution profiles require explicit configuration, and health checks never decrypt or send task prompts.

### Verification

- The candidate's one full offline-suite run completed 262 tests with 2 explicit opt-in tests skipped; one structured-Memory deletion case exceeded Vitest's original 5-second per-test harness timeout while the suite was contended. Only that timeout was raised to 20 seconds, after which the focused Memory file passed 7/7. The fixed temporary-repository v0.6 integration flow independently passed 1/1 and covers Worktree profile → Editor/Git → Dashboard → Memory → safe Apply → forced conflict → resolution/cleanup, including exactly one `--always-approve` mapping. The full suite was not repeated.
- TypeScript, the production main/preload/Renderer build and the 223-file public-source scan pass. Isolated Electron/CDP probes cover Editor, Git, Worktree, Memory, Agent/Persona, Profiles, Dashboard, the new-session profile selector and persistent-task health UI without sending a paid prompt. Git/Worktree tests use only temporary repositories, a local bare remote and a local stalled HTTP fixture; Memory/Agent tests use isolated roots.
- The post-candidate shell redesign passed TypeScript, a production build, 8 focused Renderer tests and live Computer Use acceptance of the empty state, workbench switcher, file workbench, session overflow menu/outside-close behavior and custom-background readability. No model prompt was sent.
- Exactly one local v0.6.0 candidate package was generated. Electron Fuses, packaged-artifact scanning, the visible packaged shell, packaged Profiles/Dashboard/launch/task-health flow and Portable launch from a Chinese/space-containing path pass. Setup SHA-256 is `022f54f087c17949fb8048641cb4ad130240d49af5afb1010aba675158db9539`; Portable SHA-256 is `46025264a06f5ac7384c5aa6d993bf7521aa0795f40030cf52103bce9cf6d0f3`. These artifacts predate the post-candidate shell redesign and must not be represented as containing it; no second package was generated.
- `npm audit --omit=dev` still reports the two pre-existing moderate `@modelcontextprotocol/sdk` → `@hono/node-server` findings; the offered forced fix is a breaking MCP SDK downgrade and was not applied.

## 0.5.16 - 2026-07-21

### Added

- Grok sessions now carry a durable origin classification. The sidebar separates ordinary sessions, scheduled-task sessions and Codex continuations into independent collapsible groups, with visible source badges and source text in the title bar.
- Persistent tasks now own one reusable Grok session by default. Each task can instead replace that session before every run, and its current context can be permanently cleared from the task center.
- The task editor shows the context policy and current dedicated session, and can open that session directly.

### Fixed

- “在 Grok 中继续” now names the newly created Grok session exactly after the original Codex task and marks it as a Codex continuation. Multiple continuations of the same Codex task are retained instead of overwriting one mapping.
- Existing task run records and older Codex continuation metadata are migrated into source groups without changing Codex source files. Manually renamed Grok sessions remain user-owned.
- A scheduled task reopens its fixed account/provider/model session on later runs instead of creating unbounded sidebar entries. Fresh-context mode deletes the prior dedicated session before creating its replacement.
- Public-source scanning now skips the intentionally Git-ignored `local/` research cache while continuing to scan every tracked source/document and packaged artifact.

### Verification

- TypeScript, production build and 30 focused catalog, lifecycle, process-manager and grouping tests pass.
- An isolated packaged UI fixture verified the two source groups, persistent collapse UI and Codex title/source badge. The packaged task editor verified reuse is the default.
- A packaged OAuth task completed two consecutive real Grok runs using the same task ID and the same resumable session ID. Manual cleanup then removed the mapping and session directory; the temporary task was deleted.
- GitHub Release `v0.5.16` is public and marked Latest at commit `e4dfb62`; workflow `29846404781` completed successfully and published Setup/Portable, SHA-256, SBOM, licenses and build provenance. The published Setup SHA-256 is `8f7ec0af2d6dda7cb75878f5e544d538eed394ef49b6920f901b1d4afede539f`; Portable is `a94cf86c973688f47d6565fd66590f3d8250b4b7c997ed5b379b5a505360fcf1`.

## 0.5.15 - 2026-07-21

### Fixed

- Opening “分叉与回退” on CLI versions without `x.ai/rewind/points` now degrades to the panel's empty state. Optional private-method absence no longer creates a bottom-right global error toast; action failures remain visible inside the panel.
- “自动批准” is now authoritative. Scheduled workers approve ordinary ACP tool requests without applying a second scheduled permission policy, and Computer Use skips optional per-application and inferred-risk confirmation prompts in this mode. Plan/Agent restrictions, protected applications, password/OTP/CAPTCHA rules and Windows secure-desktop boundaries remain intact.
- Persistent worker prompts may run for up to 23 hours, aligned with the Task Scheduler execution limit, instead of failing healthy long tasks after the interactive 30-minute turn timeout.
- The task editor labels auto mode as “自动批准（无限制）”, disables the redundant permission selector and explains that no secondary confirmation is applied. Existing tasks with stale secondary-policy values are normalized at execution time.
- Added an opt-in packaged live-automation probe that creates, runs and cleans a real scheduled task, verifies a resumable Grok session, and checks optional rewind degradation without exposing credentials or prompts.

### Verification

- TypeScript, production build and 34 focused ACP, automation-policy, Computer Use and task-center tests pass.
- A packaged v0.5.15 worker used the current OAuth account and `grok-4.5` to read this workspace's `package.json` through an auto-mode task. It reached `completed` in about 40 seconds, returned a real resumable session, produced no permission wait, released both task/global locks, and cleaned its temporary task/session.
- The same packaged acceptance opened the generated session against CLI 0.2.106, received an empty optional rewind result, and observed no global error toast. The task editor packaged probe confirmed the secondary permission selector is disabled in auto mode.

## 0.5.14 - 2026-07-21

### Fixed

- Fixed OAuth scheduled tasks failing with `Authentication required` after their stored refresh token had rotated. Before starting a worker session, the app now compares the task's fixed account with the canonical Grok `auth.json` identity and uses the newer canonical credential when they match.
- Worker-side OAuth refreshes are reconciled back to the encrypted account vault and canonical credential file with compare-before-write behavior. A credential refreshed concurrently by another Grok process is preserved instead of being overwritten.
- Existing English authentication failures are presented as actionable Chinese text in the task center.

### Verification

- TypeScript and 26 focused authentication, worker, automation and task-center tests pass, including stale-vault selection, worker refresh persistence and concurrent refresh preservation.
- A local metadata-only probe confirmed the affected task account matches the canonical login while the vault held an older rotated refresh token. No token or prompt was printed and the task was not executed during diagnosis.

## 0.5.13 - 2026-07-21

### Fixed

- Fixed scheduled-task workers failing to decrypt DPAPI-protected prompts. Before Electron becomes ready, the headless worker now copies the canonical Chromium `Local State` into its isolated session directory, so `safeStorage` opens the original encryption key without sharing the GUI's active browser profile.
- Reworked the task editor's Computer Use, wake and notification checkboxes into three aligned option cards with a title and description; the cards collapse to one column on narrow windows.
- Localized automation run states and replaced the old raw `safeStorage.decryptString` failure with an actionable Chinese message. A future decryption failure also reports a concise Chinese recovery instruction without exposing task content.

### Verification

- Targeted TypeScript and 14 automation/task-center tests pass. A packaged v0.5.13 renderer probe opens the task center and verifies all three checkbox cards, their labels, descriptions, alignment and viewport containment.
- A focused live DPAPI probe decrypted the existing affected task with the canonical storage paths without printing its prompt; the task was not executed and no model usage was incurred.
- The local `win-unpacked` build passed the public-safety scan, native-host self-test, production build and visible-window launch. The sole desktop shortcut now targets this v0.5.13 build.

## 0.5.12 - 2026-07-21

### Fixed

- Simplified the GitHub Release workflow to deterministic artifact production: unsigned Setup/Portable packaging, Electron Fuse and public-safety checks, SHA-256, SBOM, license report, provenance, draft download verification and publication.
- Removed repeated hosted GUI/CDP, Windows `InteractiveToken` Task Scheduler and installer lifecycle runs. Those product gates already passed locally and in main CI; GitHub hosted desktops cannot reliably provide the required interactive Windows session.
- `v0.5.11` remained unpublished and created no Draft assets after the hosted scheduler could not wake even when it ran before every GUI process.

### Verification

- Application runtime is unchanged from the locally accepted v0.5.11 candidate. GitHub generated all five release assets and both attestations; the downloaded Setup, Portable, SBOM and license report matched `SHA256SUMS.txt`, provenance verification passed, and v0.5.12 was published as Latest.

## 0.5.11 - 2026-07-21

### Fixed

- Reordered hosted Windows acceptance so the Task Scheduler headless entry runs before the job's sole Renderer; this avoids the hosted desktop resource leak observed only after an Electron GUI exits.
- The build runner now validates the Portable archive in a Chinese/space-containing path without starting a second GUI. The fresh download-verification runner independently executes Task Scheduler first and then launches the downloaded Portable UI, retaining both release gates.
- `v0.5.10` remained unpublished and created no Draft assets: packaging, Fuses and the packaged shell/entry probe passed, while the later scheduled marker did not appear within 60 seconds.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, the physical-GPU 4K and independent-overlay flows, real Task Scheduler wakeup, Chinese-space Portable UI, the exact hosted execution order, Electron Fuses and NSIS install/upgrade/uninstall retention pass locally. Cloud Draft assets will still be downloaded, hash/provenance checked, installed, launched and scheduler-tested before publication.

## 0.5.10 - 2026-07-21

### Fixed

- Scoped the GitHub hosted virtual-desktop gate to what that environment can verify reliably: packaged application content, the rendered shell, the fixed overlay host, and task/extension/media entry availability.
- Heavy modal interaction is still mandatory before a tag: local packaging verifies the physical-GPU 4K flow, whole-window backgrounds, task/extensions/media layout, modal focus, `Esc`, individual Renderer processes, startup routing, Portable launch and Task Scheduler wakeup.
- `v0.5.9` remained unpublished and created no Draft assets. Its only cloud Electron process rendered the complete shell, then the Windows hosted graphics/CDP channel stopped immediately after a task-panel click that passes in every local hardware and software-rendered acceptance path.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted shell/entry flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.9 - 2026-07-21

### Fixed

- Replaced the hosted Windows package gate's chain of six short-lived Electron/CDP sessions with one fresh packaged Renderer that verifies the application shell, task center, extension center and media studio in sequence.
- Local packaging still keeps the physical-GPU 4K long flow, every panel in an independent process, startup task-center routing, Portable launch and Task Scheduler wakeup. The cloud-only consolidation avoids a GitHub virtual-desktop resource failure without reducing product-side acceptance.
- Added a stage-labelled hosted release probe with bounded CDP calls, fixed overlay checks, focus verification and `Esc` close behavior.
- `v0.5.8` remained unpublished and created no Draft assets. Its third Electron instance stopped responding before the first DOM query and before the task button was clicked, proving the remaining failure was repeated hosted CDP process startup rather than task-center data or rendering.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact single-Renderer hosted flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.8 - 2026-07-21

### Fixed

- Changed task-center discovery from six concurrent system-backed IPC reads to a deterministic sequential snapshot. This prevents DPAPI, registry, PowerShell, Task Scheduler and Grok configuration discovery from contending with the first modal frame on slower Windows virtual desktops.
- The task-center close control now receives focus in the mount commit, before asynchronous data discovery. Keyboard focus, `Esc` handling and screen-reader dialog navigation no longer depend on a later timer.
- Added a regression test that delays every task-center source and proves at most one system-backed read is active at a time.
- `v0.5.7` remained unpublished and created no Draft assets; its run passed the main packaged UI flow, then reproduced the task-center renderer/CDP stall after the panel mounted.

### Verification

- 195 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted-runner split flows, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan; GitHub download acceptance follows before publication.

## 0.5.7 - 2026-07-21

### Fixed

- Made the packaged offline-smoke task center fully deterministic. Providers, automations, run history, global policy, background tasks and inbox now return isolated empty/default data without touching DPAPI, the user environment/registry, PowerShell, real Grok configuration or Task Scheduler state.
- Normal installed and portable behavior is unchanged because the bypass is restricted to the private `GROK_DESKTOP_OFFLINE_SMOKE=1` child-process environment created only by the verification harness.
- `v0.5.6` remained unpublished and created no Draft assets; its split flow proved the long UI sequence was fixed, then isolated the remaining hosted stall to task-center system-data discovery inside an otherwise fresh Renderer.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, physical-GPU 4K and exact hosted-runner split flows, deterministic task-center overlay, Task Scheduler, Chinese-space Portable, Electron Fuses and NSIS lifecycle all pass. Local hashes are recorded in the implementation plan.

## 0.5.6 - 2026-07-21

### Fixed

- Re-established modal focus after a lazy `Suspense` fallback is replaced. A guarded `MutationObserver` now focuses the first control only when focus is still outside the active overlay, so async panel updates never steal the user’s current focus.
- Kept the full viewport/theme/panel stress sequence for local physical-GPU acceptance, while clean GitHub Windows runners verify task, extension and media overlays in independent fresh Renderer processes. Each probe still checks the dedicated overlay root, fixed backdrop, viewport bounds, focus and `Esc` close behavior.
- `v0.5.5` remained unpublished and created no Draft assets; its run passed packaging and the complete pre-panel flow, then demonstrated that the hosted virtual desktop—not the task feature contract—could not sustain every heavy transition in one Renderer instance.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, the physical-GPU 4K long flow, the exact hosted-runner split flow, Task Scheduler wakeup, Chinese-space Portable, Electron Fuses and NSIS install/upgrade/uninstall retention all pass. Local v0.5.6 hashes are recorded in the implementation plan.

## 0.5.5 - 2026-07-20

### Fixed

- Extended the explicit `GROK_DESKTOP_OFFLINE_SMOKE=1` contract to the default Extensions plugin inventory, so clean GitHub Windows runners render the complete extension overlay without attempting ACP or Grok CLI discovery.
- Added a direct regression assertion that offline plugin and Skill inventory performs zero CLI/ACP calls, and gave each task, extension and media overlay its own packaged-probe progress stage.
- `v0.5.4` remained unpublished and created no Draft assets; its stage-labelled run isolated the final hosted-only stall to the default Extensions tab after all preceding overlay, theme and focus checks had passed.

### Verification

- 194 offline tests (2 opt-in live tests skipped), TypeScript, public scans, 4K and hosted-runner UI paths, Task Scheduler wakeup, Chinese-space Portable, Electron Fuses and NSIS install/upgrade/uninstall retention passed. Local package hashes are recorded in the implementation plan; downloaded GitHub artifact verification follows after tag publication.

## 0.5.4 - 2026-07-20

### Fixed

- Disabled GPU acceleration only for Electron instances launched by GitHub Actions smoke tests. This avoids the hosted Windows virtual-GPU/CDP deadlock while leaving normal local, installed and portable application rendering unchanged.
- Added named progress stages to the comprehensive packaged UI probe. Any future CDP timeout now identifies the exact palette, background, focus, theme or overlay phase instead of reporting only `Runtime.evaluate`.
- `v0.5.3` remained unpublished and created no Draft assets; its clean offline log isolated the remaining failure to the hosted virtual desktop rather than Grok CLI integration.

### Verification

- The hosted-runner path, including `--disable-gpu`, 1920×1080 layout, theme/background switching and all root overlays, passed locally with `GITHUB_ACTIONS=true`. Normal packaging still runs the hardware-backed 3840×2160 path.

## 0.5.3 - 2026-07-20

### Fixed

- Made the isolated packaged-release smoke profile return an empty Skills list without attempting Grok CLI discovery. Reopening the composer palette no longer injects repeated missing-CLI IPC failures into a Windows hosted Renderer that is intentionally running without user software or credentials.
- Added a regression test proving that `GROK_DESKTOP_OFFLINE_SMOKE=1` never invokes the plugin inventory or CLI locator. Normal application and live verification behavior is unchanged.
- `v0.5.2` remained unpublished and created no Draft assets; its run confirmed that the third offline palette load, rather than the selected large viewport alone, was the remaining hosted-only failure.

### Verification

- The normal local release package continues to test the real 3840×2160 path, while the GitHub branch uses 1920×1080 and a strictly offline extension inventory.

## 0.5.2 - 2026-07-20

### Fixed

- Kept the physical 3840×2160 add-palette regression in local packaging acceptance, while using a stable 1920×1080 large-viewport check on GitHub's virtual Windows desktop. The hosted Chromium GPU stopped servicing CDP requests after a synthetic 4K override even though the same packaged UI passed on a real local desktop.
- `v0.5.1` also remained unpublished and produced no Draft assets. Its bounded probe exposed the virtual-GPU failure in five minutes instead of timing out after an hour; the immutable release retry therefore advances to `v0.5.2`.

### Verification

- The hosted-runner branch of the corrected overlay/theme/add-palette probe passed locally with `GITHUB_ACTIONS=true`; normal local packaging continues to exercise the full 3840×2160 path.

## 0.5.1 - 2026-07-20

### Fixed

- Replaced the packaged UI acceptance probe's hosted-runner-dependent CDP input injection with focused bubbling keyboard events. All CDP calls now have explicit timeouts, so a stalled Windows desktop session produces an actionable failure instead of consuming the full Release job timeout.
- `v0.5.0` was never published: its first tag workflow built the application and passed the initial content smoke, but the legacy keyboard probe stalled before any Draft Release or public asset was created. The immutable follow-up is released as `v0.5.1` rather than moving the existing tag.

### Verification

- The corrected full overlay/theme/add-palette probe passed locally against the packaged application before the `v0.5.1` rebuild and GitHub retry.

## 0.5.0 - 2026-07-20

### Added

- Added safe custom model providers for OpenAI Chat Completions, OpenAI Responses and Anthropic Messages, including editable presets, model discovery, connection tests, desktop/CLI defaults and external read-only Grok model discovery.
- Added current-user Windows Task Scheduler automations for one-time, daily, weekly and one-minute-or-longer intervals. Prompts and pending confirmations use Windows DPAPI; workers run without a BrowserWindow and preserve recoverable Grok sessions and run history.
- Added server-authoritative prompt queues, same-turn interjection, queue editing/reordering/removal, session forks, three rewind modes, app-only session archive metadata and a unified task/inbox center.
- Added deterministic Task Scheduler headless probing and a two-stage tagged Release workflow that keeps assets in Draft until downloaded hashes, attestations, installer lifecycle, portable UI and scheduled-worker checks pass.

### Changed

- Custom provider credentials use `GROK_DESKTOP_PROVIDER_<ID>_KEY` user environment variables or explicit existing-variable references. Keys never enter TOML, Renderer payloads, command arguments, logs or support bundles.
- Grok private extensions now follow the current official queue/interjection/fork/rewind/background-task/sub-Agent wire contracts and degrade independently when an older CLI lacks an optional capability.
- The task center now combines queued prompts, terminal/monitor jobs, live sub-Agents, session loops, persistent automations and pending confirmations without adding a permanent right sidebar.

### Fixed

- Fixed whole-window backgrounds overriding fixed overlay positioning. Root dialogs now render under a dedicated `#overlay-root`, preserve viewport bounds and focus, lock background scrolling and close topmost-first with Escape.
- Fixed fixed-position modal visibility detection so keyboard focus trapping remains active when Chromium reports a null `offsetParent`; packaged CDP acceptance now verifies focus establishment and Tab containment.
- Fixed same-format custom-background replacement so the previous app-owned image remains recoverable until the new file has completed its atomic swap.
- Fixed scheduled worker/uninstall startup so they do not race the normal automatic task-registration repair path.
- Fixed provider update/removal failures after model reload so TOML, the application-owned provider index, replacement credentials and removed credentials all roll back as one transaction.
- Fixed queued persistent automations counting one another as active global runs. Distinct atomic slot files now enforce the configured maximum without a three-or-more-task waiting deadlock.
- Pending scheduled-task notifications can launch or focus the interactive app directly into the task center; headless completion notifications no longer claim an unavailable click action.
- Scheduled-task completions and failures now enter the unified inbox exactly once, even when the terminal event is replayed.
- A scheduled worker that can no longer decrypt its DPAPI prompt now records a terminal failed run and releases all locks instead of leaving a stale running record.

### Security

- Provider TOML writes modify only the marked application block, check the original hash, validate the complete file, replace atomically, keep five backups and roll back when Grok validation fails.
- Non-loopback plain HTTP endpoints require an explicit warning confirmation. Provider networking honors the configured Electron proxy without exposing secrets to Renderer code.
- Scheduled tasks run as the current interactive user with least privilege, reject concurrent runs, cap global concurrency, coalesce missed runs and pause high-impact actions for an expiring encrypted confirmation.

### Verification

- TypeScript, the production build, public source safety scan, high-level dependency audit and 193 offline tests passed locally; two explicit live Computer Use tests remain excluded from the default suite by design. Final packaged artifact scanning is repeated after the release files are regenerated.
- Grok CLI `0.2.106 (bde89716f6)` accepted the isolated custom-model TOML, ACP initialization, session creation, live reasoning-effort switch, media command and injected Computer Skill without a paid prompt.
- The packaged application passed content-aware cold startup plus full-window-background overlay probes, real current-user Task Scheduler headless wakeup, NSIS first-install/overwrite/uninstall with AppData retention, portable launch from a Chinese path containing spaces, Fuse verification and the unique desktop-shortcut check.
- The canonical Setup/Portable/SBOM/license hashes are emitted in the accompanying `SHA256SUMS.txt`; the GitHub workflow downloads the Draft assets and verifies this manifest plus both executable attestations before publishing.

## 0.4.2 - 2026-07-20

### Added

- Added a portal-based, keyboard-accessible Codex-style composer palette for files, images, path-only folder attachments, workspace references, Computer Use and Skills from enabled plugins.
- Added one-shot Computer/Skill capability chips with per-session draft restoration. Computer selection now emits a generic `/computer <instruction>` only when the user sends the message and does not enumerate or start a target beforehand.
- Added a fully Chinese native Electron menu with fixed links to the owner's repository, Releases, Issues and xAI documentation.
- Added global dark, light, system and custom-color themes plus application-owned background images with conversation/window scope, fit, position, opacity, blur and adaptive light/dark masking.
- Added the v0.5.0 Windows Task Scheduler design to `docs/SCHEDULED_TASKS_ROADMAP.md`; no scheduling runtime is included in v0.4.2.

### Changed

- Theme colors now use semantic variables across chat, Markdown, Shiki, Mermaid, Monaco Diff, KaTeX, extensions, diagnostics, onboarding, tool cards, scrollbars and the composer. The last known non-sensitive theme is painted before React mounts to avoid a startup theme flash.
- Repository/update destinations are fixed to `wangyingxuan383-ai/grok-build-desktop`; they are not inferred from Git remotes, Actions forks or local environment variables.
- Device-code process cleanup and Windows process-tree termination tests now use deterministic bounded waits instead of real-network timing.

### Fixed

- Fixed the permanent packaged black screen: disabling Electron's file-protocol privilege fuse caused `BrowserWindow.loadFile()` to return `net::ERR_FILE_NOT_FOUND` for the renderer entry inside `app.asar` on Windows.
- Kept ASAR integrity, `OnlyLoadAppFromAsar`, Renderer sandboxing, CSP, navigation restrictions and typed IPC validation enabled while allowing the packaged `file://` renderer to load.
- Added a visible Chinese startup-recovery page with reload, log, diagnostic-export and default-window recovery actions when the Renderer cannot load.
- Removed the clipped legacy composer menu and the pre-send Computer application/window picker; the large palette now lives outside the composer's overflow boundary.

### Security

- Theme images are format/size validated, copied under `%APPDATA%`, and exposed only through the exact read-only `grok-theme://background/current` resource. Paths and image content are excluded from logs and support bundles.
- Native-menu external links pass an exact fixed-destination allowlist before opening; Renderer filesystem, process and shell access remains unavailable.

### Verification

- Packaged smoke testing now connects to a temporary loopback DevTools endpoint and requires a rendered `.app-shell`, non-empty body text and the correct document title; a window handle alone can no longer pass a black screen.
- TypeScript, the production build, the public-safety scanner, npm high-level audit and 167 automated tests passed locally; 2 opt-in live Computer Use cases remain intentionally skipped by the offline suite.
- The opt-in real Grok Computer Use acceptance was also rerun separately: visual control reached the exact fixture result, while the high-impact delete sentinel requested confirmation and was not executed after rejection.
- Final unsigned Setup/portable ZIP, SHA-256, CycloneDX SBOM and license report were regenerated for `0.4.2`; packaged content/UI/theme smokes, the portable Chinese-and-space path launch, Fuse checks and the sole desktop shortcut cold launch all passed locally.
- The broken `v0.4.0` and `v0.4.1` public releases were withdrawn to Draft while the corrected `v0.4.2` package is verified.

## 0.4.1 - 2026-07-20

### Fixed

- Fixed PowerShell 5.1 desktop-shortcut, packaged-window smoke and v0.3 UI probe scripts when the executable argument is omitted; release hashing now uses the .NET SHA-256 implementation instead of relying on cmdlet auto-loading.
- Rebuilt the local self-use package, regenerated the sole desktop shortcut and verified both a cold packaged launch and a shortcut launch expose the visible main window.

### Release history

- Version `0.4.1` passed its original automated, packaging, installer-lifecycle and attestation checks, but the old smoke test only asserted a window handle and missed the empty Renderer document.
- It was withdrawn after the black-screen report and is superseded by `v0.4.2`.

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
- At the release owner's explicit request on 2026-07-20, `v0.4.0` was promoted from Draft to a public GitHub Release so the installer and portable ZIP are visible; the broader Windows 10/11 hardware matrix remains tracked separately.

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
