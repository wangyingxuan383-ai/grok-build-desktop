# Architecture

Electron's sandboxed renderer owns presentation only. Main-process services validate IPC, filesystem identities, credential changes, media handles, ACP lifecycles and Windows host operations. Usage queries run in a dedicated SQLite worker.

Sessions, image conversations and view tabs have distinct identities. Closing a view does not delete history or stop its process. Native child sessions are inspected read-only; absent history is shown as a summary, never substituted with parent content.

Scheduling separates task definitions from runtime mappings. A task revision guards late writes; terminal run records are immutable, repeat OS wakes deduplicate by occurrence, and windowless workers publish results to the shared inbox. History retention is 30 days, up to 100 completed records per task and 1000 overall; active runs remain.

Image results are accepted from known successful media tools, checked and cached in main. The original, output copy and preview share an artifact identity. Changed or unproven files are retained during deletion. Network and model failures do not trigger automatic paid re-submission.

ZCode (Apache-2.0), reference commit `872ad960de7ec172591f7e1952f7849229f94521`, informed interaction and workspace organization. Product components are independently authored; its backend, accounts and branding are not redistributed.
