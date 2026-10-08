# Development roadmap

## Desktop 0.11.5 / Grok Remote 0.3.6 release review

- [x] Review completion gating, image isolation, phone gestures, gallery layout and update entry points.
- [x] Fix narrow gallery controls, album favorite/rotation stability, bounded original cache, cached metadata and late image draft hydration.
- [x] Add independent Android update downloads and explicit system installation with hash, size, package and signing checks.
- [x] Fix Desktop installer concurrency, filesystem/launch failures and media-task update protection.
- [x] Provide phone downloads in Desktop onboarding/settings and mobile updates before pairing.
- [x] Add mobile CI checks and signed APK staging/signature/checksum gates to public releases.
- [ ] Complete final artifact verification and publish Windows plus Android attachments together.
- [ ] Record physical Android keyboard/gesture/system-install acceptance separately.

## Feedback candidate 0.11.4 / Grok Remote 0.3.5

- [x] Raise completion notices only for live prompt turns; configuration switches and session restore stay silent (regression test).
- [x] Make session notices reliable: leave image mode, fall back to the session catalog, explain missing sessions.
- [x] Keep image-conversation CLI folders out of coding projects on Desktop and phone; flag sessions whose project folder is missing.
- [x] In-app application update with verified download (size, SHA-256, trusted redirect hosts) and installer hand-off; portable copies keep the release link.
- [x] First-run checklist with CLI install/update, phone download QR and pairing, notification test and usage tips.
- [x] Desktop quoting from text selection and per-message quote actions.
- [x] Embedded tray icon with live phone-connection badge.
- [x] Mobile: IME-aware composer on edge-to-edge Android, swipe and long-press session actions with archive undo, message and picture long-press menus, collapsed new-session steps, photo grid and full-screen viewer, quiet transient retries, queue reordering.
- [x] Verify desktop typecheck and full suite, mobile typecheck and all mobile suites, and rendered light/dark flows in isolated fixtures.
- [ ] Accept keyboard overlap, swipe/long-press feel, photo paging/zoom and notification behaviour on a physical phone and Desktop install.

## UI review candidate 0.11.3 / Grok Remote 0.3.4

- [x] Review the conversation, sheet, device and desktop panel changes against their existing execution owners.
- [x] Isolate late overview responses and caches by computer/endpoint; share pending refreshes and remove the task editor's redundant account polling.
- [x] Guard manual connection changes during unresolved submissions and ignore late child, artifact and discovery navigation results.
- [x] Add conversation pull refresh/error retry, pairing back navigation, per-receipt failure dismissal and reading-preference race protection.
- [x] Narrow page close-control styling and restore useful task-center keyboard focus.
- [x] Verify mobile types, startup/native contracts, submission workflows and 11 UI/async regressions; retain the Desktop renderer budget.
- [x] Build and verify same-signature Android 0.3.4 and Desktop 0.11.3 local candidates; pass packaged UI/remote flows, portable startup and artifact checks.
- [ ] Record physical Android IME/gestures and authenticated image-generation acceptance separately.

## UI and interaction overhaul

- [x] Add mobile design tokens (spacing, radius, type) and shared primitives: chip, segmented control, list row, grouped section, banner and empty state.
- [x] Move back-gesture layering, child-session trail, banner priority and reading clean-ups into a framework-free model with unit tests.
- [x] Split the mobile shell into header, tab bar, status banners, a sheet host with in-sheet back navigation and a grouped device screen.
- [x] Rebuild the conversation screen: header jump and actions, one-row composer with contextual status chips, per-message actions on the label row or long press, no duplicated plan heading, and a message list isolated from draft typing.
- [x] Restyle session list, tasks and works with status indicators, segmented filters, counts, pull-to-refresh and empty states.
- [x] Desktop: one wording for execution modes in every picker, no duplicate close control on full-page panels, centered jump-to-latest control and quieter image composer options.
- [x] Register the remote push-configuration IPC channel with a runtime schema and align the gateway history test with around-navigation.
- [x] Verify mobile typecheck and tests, desktop typecheck, the full desktop suite, renderer chunk budget and rendered light/dark flows in isolated fixtures.
- [ ] Split the mobile remote hook into a framework-free client with selector subscriptions and share one overview subscription across tabs.
- [ ] Migrate remaining mobile forms (pairing, new session, configuration, task editor, image creation) to the shared primitives.
- [ ] Split the desktop application shell, consolidate duplicated page-surface styles and replace native selects with a shared picker.
- [ ] Accept the new mobile interaction on a physical Android phone (IME, long press, back gesture, keyboard overlap) separately from rendered verification.

## Companion catalog and navigation correction

- [x] Separate model-only requests from project enumeration; retain working options when stale project paths or profiles fail.
- [x] Localize and coalesce model-picker refresh; use the native declared default only for new, unbound requests.
- [x] Distinguish an idle CLI disconnect from an interrupted active turn; preserve real failure evidence and omit routine conversation status badges.
- [x] Build read-only, full-projection question navigation with searchable answer previews, bounded pagination and target-turn loading.
- [x] Reduce composer action clutter with a shared tools sheet and release image submission state after preparation failures.
- [x] Verify rendered navigation, unavailable-project model discovery and the current native CLI catalog through the packaged application, without sending a model prompt.
- [x] Verify final signed Android 0.3.3 and Desktop 0.11.2 artifacts; replace Desktop locally with a verified rollback and unchanged conversation, image and pairing data.
- [ ] Install Android 0.3.3 on a physical phone and record native interaction acceptance separately from rendered-browser verification.
- [ ] Record authenticated image generation and physical-phone gestures separately.

## Companion reliability follow-up

- [x] Fetch current CLI models independently of the focused coding view; expose nonblocking remote catalog refresh.
- [x] Validate stale image model selections before invoking generation.
- [x] Use stored media-handle ownership for remote thumbnails and originals.
- [x] Preserve message/status event order and reconcile historical delivery displays.
- [x] Separate computer connectivity, history synchronization and durable send receipts.
- [x] Add compact reading, detail preferences, question outline, long-content expansion and latest-message positioning.
- [x] Verify signed Android 0.3.2 and packaged Desktop 0.11.1 candidates; install both locally with the original identities and a verified data-preserving rollback.
- [ ] Verify authenticated generation and physical keyboard behavior separately; automated UI/navigation checks do not establish those outcomes.

## Current reliability work

- [x] Coordinate account changes with active coding and CLI media tasks.
- [x] Record child-agent usage separately from parent totals; deduplicate cumulative updates.
- [x] Bound scheduled-run history; expose task filters, results, retries and cleanup.
- [x] Deliver scheduled-run results from windowless workers and surface declined operations.
- [x] Separate Computer observation, window control and application actions.
- [x] Permit common source formats and isolated interactive HTML previews.
- [x] Keep public documentation focused on product behavior; exclude local handovers.
- [x] Targeted regressions and packaged startup/IPC acceptance passed for the 0.10.2 release candidate; live capability acceptance remains separate.

## Desktop experience follow-up

- [x] Implement Provider environment boundary fix, unified CLI media launch and explicit image model selection.
- [x] Implement full image drafts, complete-request reuse, staged waits and diagnostics.
- [x] Implement notification preferences and activation targets, task-center edit protection and child follow-up.
- [x] Implement local HTML resources, development previews and screenshot/region feedback.
- [x] Implement usage refresh, explicit image usage, gallery comparison and optional PR/CI monitoring.
- [x] Verify the packaged follow-up candidate and install locally with rollback.

## Update discovery and product overview

- [x] Check updates once per app launch, coalesce repeated requests and retain the daily interval while open.
- [x] Add optional update indicators to coding and image sidebars; keep failed checks distinct from available versions.
- [x] Default the gallery to pictures and retain explicit all/failed views.
- [x] Replace outdated overview screenshots with six isolated demonstrations and document future experience improvements.

See [experience roadmap](EXPERIENCE_ROADMAP.md) for proposed work beyond the current implementation.

## Android companion preview

- [x] Implement optional paired TLS gateway, Desktop consent and device revocation.
- [x] Reuse Desktop history and the existing execution owner for mobile control, without activating tabs on read.
- [x] Add bounded receipts, duplicate suppression, explicit unknown-state recovery and history-window reconciliation.
- [x] Build Android client shell, pinned native transport, conversations, composer and existing interaction UI.
- [x] Validate affected contracts, controller boundaries and isolated real Desktop pairing flows.
- [x] Finish private-signed Android/desktop candidate artifacts and delivery.
- [x] Prefer physical LAN addresses, regenerate stale pairing offers and expose the target address and connection diagnostics.
- [x] Verify pinned native transport with default TLS and TLS 1.2 against the Desktop; retain certificate validation and avoid automatic operation retries.
- [x] Build and verify the 0.1.1 / 0.10.6 connection-fix candidates, including packaged pairing and address switching.
- [ ] Record physical-phone and authenticated model acceptance.
- [x] Record basic pairing/history/send/receive on a physical phone; this does not validate the subsequent UI and keyboard changes.
- [x] Implement mobile session creation/management, grouped navigation, progress, child views, message search/copy and foreground reminders.
- [x] Separate heartbeat and refresh, limit native networking, preserve composer/drafts and add quiet recovery/polling fallback.
- [x] Complete mobile 0.2.0 and Desktop 0.10.7 candidate verification and local delivery; Android IME acceptance remains separate.
- [x] Implement mobile 0.2.1 draft preservation, readable confirmations, recent navigation, refresh feedback and task-reminder routing; targeted regressions passed.
- [x] Verify and deliver the 0.2.1 / 0.10.8 follow-up packages with privacy and identity checks; physical Android IME coverage remains separate.
- [x] Implement independent mobile configuration, plan/history navigation, queue editing and native context controls.
- [x] Implement original-owner task/image/workspace operations and saved-but-unregistered schedule recovery.
- [x] Implement resumable materials, share inbox, on-demand result viewers, per-computer drafts and bounded caches.
- [x] Implement LAN discovery, tray lifecycle, optional visible background follow-up and configurable FCM adapter.
- [x] Verify the 0.3.0 / 0.11.0 candidate with native builds, affected regressions, rendered workflows, artifact privacy and original identity checks; install Desktop locally with a verified rollback copy.
- [x] Correct the 0.3.0 Android native dependency mismatch found during physical-device cold startup; lock SDK-compatible assets and add native dependency/DEX checks. The earlier build and browser evidence did not establish phone startup.
- [x] Add initialization/render recovery and deferred HTML view loading without changing saved identities or message submission semantics.
- [x] Verify and deliver the same-signature 0.3.1 fix: two physical-device cold starts and startup logs passed; Conversations, Tasks, Works and Devices opened successfully in user verification.
- [ ] Record current physical-phone IME, Android background/FCM and authenticated model acceptance.
- [ ] Design an independently deployed public relay; outside the LAN/VPN client contract.

See [Android preview](MOBILE_REMOTE.md).

## CLI/model acceptance

Authenticated end-to-end CLI media editing, Computer Hook proof consumption and native subagent cancellation require separate live acceptance. Anonymous handshakes and fixture tests do not prove model behavior. The CLI is installed separately and is not automatically upgraded by this work.

## Delivery

- [x] Prepare 0.10.4 public release notes covering the cumulative desktop experience changes.
- [x] Publish the tagged 0.10.4 release after required source checks, artifact construction and remote checksum/provenance verification.

Source changes, local installations and public releases are distinct. The version, build timestamp and release marker are displayed in About. Release procedures remain in the repository scripts and workflows.
