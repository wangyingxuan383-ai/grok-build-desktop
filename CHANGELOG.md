# Changelog

## 0.14.4 — Desktop reliability

- Patch the Vite build tool to 8.2.4 without changing application runtime dependencies.
- Bind send preparation, failure restoration and text-to-attachment conversion to their owning draft; switching conversations cannot clear another draft. Preserve the explicit new-task-to-session hand-off.
- Stop cancellation recovery when the original turn ends or changes, preserving the next queued turn and other conversations.
- Keep sessions connected when a saved model is missing from the current CLI catalog. Require an explicit model choice before sending, without silently changing provider or overwriting the saved preference.
- Isolate malformed or unresolved external provider addresses so healthy providers and associated task data remain readable; resolve environment placeholders only for address classification.
- Allow the companion near the screen's top and side edges without reserving invisible margins. Keep edge controls inside the visible area, preserve saved positions and retain the short release fall.

Includes Android companion 0.4.4 (versionCode 16), signed with the existing certificate. Native multi-monitor and mixed-DPI acceptance remain separate.

## 0.14.3 — Short release fall candidate

- Move the companion downward by 20–32 DIP after release, over about 240ms, then play the landing recovery and save the final position.
- Stop near the release point, clamp travel at the work-area bottom, and retain the explicit full “落到底部” command.
- Reuse the same guarded motion controller for both paths; reduced motion positions immediately and new gestures invalidate old callbacks.

Reuse existing art, settings and permissions. No phone changes or public upload.

## 0.14.2 — Companion drag animation follow-up candidate

- Restore the pickup transition before the suspended pose, rather than immediately displaying a held frame.
- Play the release/recovery frames at the saved position after a drag. Keep free placement and explicit menu falling separate.
- Let awaiting-input/error states preempt recovery, honor reduced motion and discard old recovery callbacks on a new gesture or hide.

Reuse existing artwork without adding settings, permissions or dependencies.

## 0.14.1 — Companion placement follow-up candidate

- Keep the companion where it is released instead of automatically dropping it to the bottom; persist its relative monitor position.
- Add “落到底部” to the companion context menu and tray submenu. Cancel an old fall on a new drag, hide, disable, lock, character or size change.
- Mark custom characters and image-workshop drafts as unfinished; retain imports and make the draft-only workshop boundary explicit.
- Merge question and screenshot launchers into one question entry, including tray and shortcut settings. Keep system capture, explicit clipboard attachment and file selection in the question window.

Windows-only local candidate; no automatic installation or public upload. Physical click-through, mixed-DPI and monitor-switch acceptance remain separate from automated window/IPC evidence.

## 0.14.0 — Windows companion inspection candidate

- Add a default-enabled, quiet desktop companion with two illustrated characters and separate greeting/farewell animations; preserve explicit disables across restarts and upgrades.
- Keep temporary hide, persistent disable and application exit distinct. Compose lock/fullscreen/Computer Use/capture suppression without reopening a manually hidden companion.
- Reuse live task/inbox events, exact target navigation, existing quick question and explicit screenshot flows; configuration changes, history and cancelled turns stay quiet.
- Add local PNG/WebP and data-only animation-pack import, sandboxed single-image alignment, and an image-workshop draft flow with no automatic generation.
- Keep both eleven-group WebP packs under the combined 8 MiB target; preserve the circular-G embroidery and upstream artwork attribution.
- Resolve long/8.3 temporary-directory aliases in the isolated scheduler acceptance probe without relaxing its file-name or overwrite restrictions; keep its profile separate from the installed application and exclude Electron's stock demo from local-runtime packages.
- Remove machine-local filesystem fields from the dependency-license report while retaining package licenses and references.

Window/IPC, import and rendered settings checks do not certify physical Windows click-through, lock/unlock or mixed-DPI/multi-monitor input. This is a local inspection candidate, not a public release.

- Keep phone snippets, recipes and bookmarks read-only until their stored contents load successfully; provide explicit retry after a read failure instead of overwriting saved data with defaults.
- Preserve the quick-question draft when Escape cancels input-method composition.
- Bind dropped attachments to the original draft before file preparation; reject late results after conversation/mode changes and merge consecutive image drops.
- Hide the native webpage behind visible export and confirmation dialogs, restoring it after closing; hidden dialogs do not block the webpage.

## 0.13.0 — Grok Remote 0.4.3 (local candidate)

- Add event-driven tray activity, unread inbox counts, named session notifications, temporary quiet mode and a shared close-to-tray/quit transaction.
- Add a sandboxed quick-question window, optional global shortcuts, explicit system-screenshot/clipboard attachments, taskbar activity and opt-in sleep prevention.
- Add a prompt snippet library with explicit variable insertion; the phone can read the paired computer's library while keeping phone snippets private.
- Route dropped image references to the image conversation instead of the coding draft.
- Add selected-element screenshot feedback and exact-line Diff annotations to conversation drafts, without automatically sending them.
- Export stored conversations as redacted Markdown or sandboxed static HTML with a preview before saving.
- Observe valid external CLI configuration changes without restarting active work; preserve last-good configuration and reject late model probes.
- Add compact reported turn statistics, configurable application shortcuts, event-driven phone status and opt-in inbox quota warnings based on explicit current-period data.
- Fix tray inbox navigation, duplicate annotation insertion, Windows aliased draft directories and unsupported interjection fallback; unsupported interjections enter the removable next-turn queue while current work continues.
- Read event-driven phone state as invalidations, so pairing requests and device changes appear without polling; focus quick-entry input after its first rendered frame and support Escape to close.

Local Windows/Android candidates passed their package, content and signing checks, including packaged pairing and Portable startup. Physical-device interaction and system-installer acceptance remain separate; this entry does not claim a public release.

## 0.12.2 — Grok Remote 0.4.2

Includes the changes of the unpublished 0.12.1 / 0.4.1 inspection build. Mobile guides now point to the latest release instead of a fixed version.

- Preserve CLI-declared model context capacity in new-task catalogs and resume fallbacks, without inventing missing limits.
- Display current context occupancy independently of token usage; share event-driven reads, ignore stale responses, and show an empty ring with a tooltip when occupancy is unknown.
- Treat missing legacy Memory flags as unknown support and bind optional capability evidence to the executable that produced it.
- Manage native Goal/Workflow runs from the task center (grouped by conversation, with in-progress and needs-attention filters), the current conversation's right-pane task tab, and on the phone from the task tab, a conversation status chip and the conversation tools.
- Gate native controls on the CLI protocol baseline (1.0.60 or later, as reported by the running agent) with declared commands, exact IDs, live revisions and native receipts, instead of one binary hash. Verified against the official Windows 1.0.60 and 1.0.62 binaries with an isolated loopback provider.
- Respect the user's leader configuration, read goal state without delaying conversation hydration, and let newer live state end an unconfirmed control outcome.
- Keep the last-known status of restored summaries, allow removing finished or restored records, and distinguish identically titled runs with a short ID.
- Announce a background workflow's completion, failure or exhausted budget once; user stops and history replays stay silent.
- Open live native-run conversations normally; restored summaries open as read-only history.
- Show one "not connected" state for cold sessions in the session pane instead of an IPC error, and strip Electron IPC framing from error messages.
- Match session search words in any order on Desktop (sidebar and Ctrl+K) and on the phone, following the CLI resume picker.
- Size composer pickers to their selected value and use design-token text sizes in the right pane.
- Prefer PowerShell 7 for repository scripts and the CLI install window when it is installed, falling back to Windows PowerShell 5.1.
- Phone: tone-matched badge and chip backgrounds, receipt-driven control feedback, and running counts limited to live running work.
- Exclude dependency tests, examples, coverage reports and source maps from Windows packages; rewrite Android native diagnostic source paths during compilation and reject local build paths in APK content checks.

## 0.12.0 — Grok Remote 0.4.0

- Add explicit foreground read acknowledgements while retaining passive history reads for monitoring and locked/background screens.
- Version cloud notification delivery: new companions receive data-only event IDs and share one native reminder ledger with foreground polling and LAN monitoring; previously registered companions retain their compatible delivery format.
- Grok Remote: native gesture and animation primitives, image decoding, a virtual gallery, vector icons, optional application lock and independent screenshot protection.
- Reorganize device settings into searchable, scoped pages with notification/channel/battery health, connection tests, reading previews, quiet hours and per-computer reminder rules.
- Preserve original task workspace bindings and in-progress edits; provide a four-step task editor, native date/time selection, draft retention and a saved-task summary.
- Add inline pending interactions and decision history, send/queue/stop controls, multi-selection, undo actions, message bookmarks, recipes, snippets and launcher shortcuts.
- Use atomic verified media downloads, bounded thumbnail/original caches and request priorities; expose transfer progress, cancellation/retry, cache categories and Wi-Fi-only adjacent-original prefetch.
- Recover from failed database opens, late preferences/update snapshots, cleaned APK downloads and broken-image decoding without repeated automatic downloads.
- Validate 600/2000-image viewport loading, narrow gallery controls, light/dark rendered flows and automated regressions. Native keyboard, touch, biometric, background and system-install behavior require separate physical-device acceptance.
- Preserve the compact mobile styling with consistent headers, switches, search fields, selection marks and action rows; keep gallery view controls visible on narrow screens.
- Honor system-only foreground reminder rules, retain notifications from other computers and hide notification details/recent-app previews when application lock is enabled.
- Clarify HTTPS-request proxy configuration and provide actionable quota connection errors; align the official usage link and help text.
- Patch KaTeX and TOML parser advisories across the Desktop dependency tree, and Markdown parser advisories on Android.
- Publish a Chinese-first mobile guide and paired verified artifacts; omit terminal dependency source maps, tests and maintenance scripts.

## 0.11.6 — proxy origin correction

- Normalize a single standard proxy URL to the Chromium proxy origin; a trailing slash no longer breaks application update checks, installer downloads, inherited Provider requests, quota reads or optional push. Keep direct routes and existing multi-protocol rules intact.
- Verify the packaged application against the public Release and APK QR endpoint with the original proxy setting.
- Keep the signed Grok Remote 0.3.6 binary and its original source/signing record unchanged.

## 0.11.5 — Desktop and Android release

- Publish the signed Grok Remote 0.3.6 APK beside Windows artifacts with source, identity, signing and checksum verification.
- Patch MCP SDK, proxy-addr, http-cache-semantics and source-map-js vulnerabilities without changing CLI or native mobile SDK versions.
- Add independent Android update checks, verified APK downloads with progress/cancel, package/signature checks and explicit system installation consent.
- Provide persistent download links and QR codes in Desktop onboarding and phone connection settings; show updates before mobile pairing as well.
- Preserve the gallery segment style while keeping both view controls visible on narrow screens; cards open the album viewer, favorites retain the viewed photo, and rotation keeps its position.
- Bound original-image caches, preserve cached image metadata and protect image drafts and view preference changes from late hydration.
- Coalesce concurrent Desktop installer downloads, propagate filesystem failures and wait for installer process startup; block application updates while CLI or media work is active.
- See [release notes](docs/releases/v0.11.5.md) for cumulative features and verification limits.

## 0.11.4 — local feedback candidate

- Desktop completion notices, unread marks, inbox entries and phone push now require a real prompt turn; switching model, reasoning effort or mode (including from the phone) no longer reports "会话已完成".
- Clicking a session notice leaves image mode and falls back to the full session list when local preferences are missing; a deleted session shows an explanation instead of failing silently.
- Image conversations run the CLI in their own `image-<uuid>` folders; those folders (live or already deleted) are excluded from coding projects on Desktop and the phone. Sessions whose project folder no longer exists are flagged for the phone.
- In-app update: download the official Setup asset, verify size and the release SHA-256 (asset digest or checksum in the notes), then restart into the installer; portable copies keep the release-page link.
- First-run guide becomes a status checklist: system, CLI (one-click official installer in a visible PowerShell window, or the existing verified CLI update), account, workspace, phone app (APK QR code and pairing), notification test, Computer Use and tips.
- Select any text in a conversation to quote it into the composer; whole replies and user messages also gain a quote action.
- The tray uses the embedded app icon and shows a green badge and phone count while a phone holds the live connection.
- Grok Remote 0.3.5: the composer stays above the keyboard on edge-to-edge Android; swipe a session right to favourite and left for archive (with undo) or delete; long-press menus for sessions, messages and pictures; collapsed, searchable new-session steps with recent projects first; a photo grid with a full-screen viewer (swipe between photos, double-tap/pinch zoom, swipe down to close, save/share); quiet retries for transient network errors and readable missing-folder messages; queue items can move to the top or down.

## 0.11.3 — local UI and interaction candidate

- Update Grok Remote to 0.3.4 while retaining its package and signing identity.
- Bind overview refreshes and cached data to the selected computer and endpoint; share concurrent refreshes and reuse task-editor account data.
- Protect connection changes while a submission is unresolved, discard obsolete child/file/media/discovery results, and reset navigation and editor state between computers.
- Add conversation pull refresh and an explicit history retry, keep newly selected reading density over delayed saved values, and make failed-send banners dismissible per receipt.
- Return from pairing with the Android back gesture and keep segmented controls at a 44 dp minimum height.
- Restrict Desktop page-close styling to marked close controls and focus the task tab when opening the task center as a page.
- Add mobile UI and asynchronous navigation regression coverage to the Android build checks.

- Grok Remote: consistent screen titles, a shared header and tab bar with a pending-response badge, and at most two status banners (connection health plus the most actionable message).
- Conversation reading space grows by about a third (fixed chrome on a 412×915 screen drops from about 380 px to 190 px): jump and session actions move to the header, the composer becomes the input plus one toolbar row, and pending requests, queue, sub-sessions, attachments and receipts appear only when present.
- Message actions sit on the message label row (long press for your own messages); long replies show their length when collapsed; plan cards no longer repeat their title; question previews show plain text.
- Typing no longer re-renders the loaded conversation history.
- Session actions and tools become grouped lists with back navigation between sheets; reading density moves into session actions.
- The device tab becomes one grouped list for the current computer, other computers, reminders, appearance, desktop accounts, updates and maintenance.
- Tasks and works use segmented filters with counts, pull-to-refresh and empty states.
- Desktop: execution modes use the same labels in the composer, new-task draft, settings and execution profiles; full-page panels drop their redundant close button; the jump-to-latest control no longer covers card actions; image composer explanations move into tooltips.
- Register a runtime schema for the remote push-configuration IPC channel.

## 0.11.2 — local companion catalog and navigation correction

- Isolate model discovery from stale projects and broken execution profiles; unavailable creation targets cannot fail the entire catalog.
- Share model-picker refresh requests and show retry feedback locally while retaining working choices and drafts.
- Use the native CLI's declared default for a new unbound request when the saved default is unavailable; explicitly selected and existing conversation models remain bound.
- Treat idle CLI disconnects as connection records, retain active-turn interruption evidence, keep cancellation distinct from failure and remove routine history badges.
- Update Grok Remote to 0.3.3 with searchable question navigation across the full stored projection, answer previews and target-turn loading.
- Move secondary composer actions into a tools sheet, recover submission controls when local preparation fails and handle initial model-refresh failures on image and task screens.

## Grok Remote 0.3.1 — local Android startup fix

- Pin Expo Asset to the SDK 54 dependency matrix and eliminate incompatible transitive native modules.
- Verify installed/autolinked Expo dependencies before native builds and verify required Expo type definitions in APK DEX files.
- Load the HTML view on demand; provide recovery for application initialization/render failures without clearing pairing or drafts.
- Retain the Android signing identity and increment versionCode to 6; Desktop remains 0.11.0.

## 0.11.1 — local companion reliability update

- Load the actual CLI model catalog independently for new coding and image conversations; replace obsolete declarations and report refresh progress without blocking remote requests.
- Reject unavailable image scheduler models before submission and provide an explicit current-model selection.
- Resolve remote image previews by their stored handle owner, including thumbnails; preserve per-device transfer tickets.
- Preserve ACP event order across attachment preparation and reconcile older delivery displays without rewriting conversation journals.
- Separate send receipts, historical read errors and connection health; receipt-cache failures cannot turn an accepted submission into a failed send.
- Update Grok Remote to 0.3.2 with compact reading by default, adjustable detail, folded execution records, long-message expansion, a conversation outline and reliable latest-message positioning.
- Keep public release and authenticated media-generation acceptance separate from local delivery checks.

## 0.11.0 — local companion candidate

- Expand Grok Remote to 0.3.0 with direct model/mode/effort controls, readable plans, queue editing, native compaction and context branches.
- Reuse Desktop owners for task management, confirmed scheduling, image conversations, code images, files, changes and verified child views.
- Add resumable material uploads, system-share drafts, PDF/HTML/audio/video preview, image save/share, local favorites and comparison.
- Add identity-preserving LAN discovery, multiple-computer preferences, bounded offline caches, optional Android foreground monitoring and user-configured FCM.
- Keep phone access in the Desktop tray; preserve account-switch protection, explicit unknown-result recovery and saved-but-unregistered task IDs.
- Add optional phone APK discovery through the existing release checker and export diagnostics without device addresses or conversation bodies.
- Keep runtime addresses and credentials out of public artifacts. Native-device and authenticated-model verification remain separate from offline acceptance.

## 0.10.8 — local companion follow-up

- Update the Android client to 0.2.1 with recent-conversation entry, disambiguated project paths, native catalog summaries and clickable foreground task reminders.
- Preserve the latest draft during fast navigation and keep drafts across re-pairing with the same computer identity. Recovery loads before new submissions are enabled.
- Keep action failures separate from background read errors, make draft restoration idempotent and show actual manual-refresh progress.
- Merge concurrent parent/child refresh targets and retain readable permission titles/inputs when verbose metadata is truncated.

## 0.10.7 — local companion build

- Expand the Android companion to 0.2.0: project-grouped conversations, active/favorite/archive filters, structured Markdown, folded progress, readable child views and focused mobile navigation.
- Add native-owner session creation, rename/archive and queue cancellation through capability-declared, deduplicated remote operations. Creating a session from the phone preserves Desktop focus.
- Keep input and draft ownership stable during streaming; use one Android keyboard resize path and move native network requests off the Expo module queue.
- Separate heartbeat, throttled refresh, reconnect and polling fallback; retain drafts and uncertain submissions without automatic model resubmission.
- Add search, copy, request details, foreground completion reminders and theme preferences. Extend public-content checks to current adapter addresses and native sources.
- Replace React Native's automatically embedded development-host address with a generic value and inspect APK contents for private strings, fixture adapters and bundled license notices.
- Keep accepted operations distinct from completion and prevent late session-creation results from changing a view the user has already selected.

## 0.10.6 — local preview

- Prefer LAN adapters over virtual networks for phone pairing and display the selected computer address on both devices.
- Regenerate the pairing QR when its network address changes; prevent delayed settings refreshes from restoring an obsolete QR.
- Add connection diagnostics and clearer Android errors. Connect directly to the pinned Desktop endpoint and allow a TLS 1.2 fallback only during the read-only connection probe.
- Update the Android preview to 0.1.1 with the same signing identity. No automatic conversation resubmission or CLI update.

## 0.10.5 — local preview

- Add an optional paired HTTPS Android gateway with certificate pinning, Desktop device approval and revocation.
- Reuse the Desktop execution owner for existing-session follow-up, queue, cancel and interaction replies; separate read-only history from session activation.
- Preserve durable, deduplicated operation receipts and bounded histories without automatic paid resubmission.
- Add the independently installable Grok Remote Android preview and private-signature build tooling; live-device acceptance remains separate.

## 0.10.4 — 2026-10-02

- Check Desktop and CLI updates once per launch, then daily while open; show optional update indicators in both modes without automatic installation.
- Default the image gallery to pictures while retaining all/failed filters and cleanup.
- Display Windows workspace folder names correctly in the header.
- Keep weekly schedule controls compact and prevent checkboxes from expanding the task form.
- Refresh the project overview with six isolated UI screenshots, feature boundaries and an experience roadmap.

## 0.10.3 — 2026-10-02

- Fix Windows Provider credential reads and apply Desktop proxy settings to CLI media launches. Bind image dispatch to an explicit model and keep temporary authentication errors separate from missing Provider credentials.
- Preserve full image drafts and reusable request settings; allow extending an existing generation wait, improve failure details, and compare two gallery images.
- Add configurable completion, failure and confirmation notifications with persistent Windows activation targets.
- Improve task-center partial loading, edit protection, instruction editing, quick schedules and result navigation.
- Show child-session evidence and recent work, gate cancellation, and prepare follow-up in the parent conversation.
- Load local HTML resources, add workspace preview servers and screenshot/region feedback, and fix common Windows text decoding.
- Refresh usage after tasks, record explicitly returned Provider image usage and correct cumulative child charts.
- Add optional read-only PR/CI status and CI completion monitoring through GitHub CLI; align terminal colors and clarify process termination.

## 0.10.2 — 2026-10-01

- Update DOMPurify to the 3.4.16 security patch.

- Coordinate account changes with active coding and CLI image tasks; keep login independent of version allowlists.
- Enforce the global run-history limit independently of per-task limits; remove deleted images from pinned views.
- Bound scheduled history, deduplicate repeated scheduled occurrences, notify from workers, and expose filters, results, retries and cleanup. Declined confirmations carry a visible partial-result warning.
- Retain partial usage fields with provenance; show cumulative child-agent reports separately while parent inclusion is unknown. Exclude replay side effects.
- Correct Computer evidence: window control, observation and application actions are distinct.
- Expand source previews; isolate interactive HTML, preserve contextual previews, add original-image recovery and pinned image views.
- Preserve image contexts, fix cleanup ownership, label unproven legacy files, and improve stalled-generation diagnostics without automatic retries.
- Improve contrast, keyboard focus, search reset and preview dismissal. Mark local, unpublished builds in About.
- Replace internal handovers with concise public documentation and preventive source checks.

## 0.10.0 — 2026-10-01

- Add coding/image workspaces, separate image conversations and gallery, read-only child views and contextual artifact previews.
- Fix Windows path aliases, draft restoration and image deletion behavior.
- Move usage to a worker-backed SQLite store with local-date filtering.
- Apply same-major security patches; package locked Windows node-pty runtime files without compiler intermediates.
- See [release notes](docs/releases/v0.10.0.md) for delivered scope and remaining live acceptance.

## Earlier releases

Version-specific product changes are documented under [docs/releases](docs/releases). Private local installation and agent-coordination records are not part of the public documentation.
