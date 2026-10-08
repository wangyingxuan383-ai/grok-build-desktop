# Changelog

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
