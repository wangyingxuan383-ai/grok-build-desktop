# Development roadmap

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

## Live capability acceptance

Authenticated end-to-end CLI media editing, Computer Hook proof consumption and native subagent cancellation require separate live acceptance. Anonymous handshakes and fixture tests do not prove model behavior. The CLI is installed separately and is not automatically upgraded by this work.

## Delivery

Source changes, local installations and public releases are distinct. The version, build timestamp and release marker are displayed in About. Release procedures remain in the repository scripts and workflows.
