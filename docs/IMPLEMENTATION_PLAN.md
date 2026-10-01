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

## Capability acceptance still required

Authenticated end-to-end CLI media editing, Computer Hook proof consumption and native subagent cancellation require separate live acceptance. Anonymous handshakes and fixture tests do not prove model behavior. The CLI is installed separately and is not automatically upgraded by this work.

## Delivery

Source changes, local installations and public releases are distinct. The version, build timestamp and release marker are displayed in About. Release procedures remain in the repository scripts and workflows.
