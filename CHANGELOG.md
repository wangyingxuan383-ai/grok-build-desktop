# Changelog

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
