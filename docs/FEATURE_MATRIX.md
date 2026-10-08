# Feature matrix

| Area | Desktop behavior | Evidence boundary |
|---|---|---|
| Coding | Native ACP sessions, drafts, queue, file review and workspace navigation | Core handshake and offline protocol tests; model behavior depends on selected CLI |
| Images | Separate conversations and gallery, complete drafts, request reuse, staged waits and image comparison | Basic generation reported working; authenticated multi-turn editing is a separate live check |
| Subagents | Native CLI orchestration, inline cards, read-only child viewer and task status | Native identity and actual transcripts preferred; summary-only fallback is labeled |
| Usage | SQLite worker, local dates, explicit parent totals and separate cumulative child reports | No inferred billing or invented totals; direct Provider image usage recorded only when explicitly returned |
| Scheduling | Windows Task Scheduler, encrypted instructions, fixed context, confirmations, run history and notifications | Offline lifecycle coverage; actual timed firing requires Windows live acceptance |
| Computer | Session MCP, call proof, native Windows host, observation/control/action evidence | Selection is not execution; current model/GUI isolation acceptance remains separate |
| Artifacts | Contextual right-pane preview and pinned views | HTML is interactive but isolated, with local relative resources and no external network; Office uses text extraction |
| Terminal | Workspace-bound manual PTY | No model-control tool is exposed |
| Web preview | Manual isolated browser view, workspace preview servers, screenshot feedback, downloads and site-data cleanup | No model browser integration is claimed |
| Notifications | Completion/failure/waiting preferences, inbox and persistent activation targets | Packaged startup activation verified; system toast delivery depends on Windows notification settings |
| PR/CI | Optional read-only GitHub CLI status and completion monitoring | Requires gh installation, login and a branch PR |
| Accounts | Device login and API-key profiles; safe switching | Running official-CLI tasks must complete or stop before mutation |
| Update discovery | Each-launch Desktop/CLI checks, daily interval while open, optional indicators in both modes | Queries stable versions only; never installs automatically or treats network failures as updates |
| In-app updates | Windows Setup downloads with size/SHA-256 and explicit installer hand-off; Android independently downloads and checks APK package/version/signature before system consent | Download regressions, native build and artifact gates; actual device installer flow remains separate |
| Android companion | Paired LAN/VPN access, independent current-model discovery, compact conversation controls, searchable question/answer navigation, plans, queue/context, grouped settings, original-owner tasks/images, result viewers, child views, offline cache and optional monitoring/FCM | Earlier physical-device pairing/read/send/receive and four-area navigation confirmed. The 0.3.4 candidate adds UI/async regressions for computer/endpoint changes, stale navigation, reading preferences and history refresh. Packaged thumbnail/original transfers, stale-project isolation and target-turn loading checked. Authenticated execution, current Android IME and background behavior need separate acceptance |

See [CLI compatibility](CLI_COMPATIBILITY.md), [architecture](ARCHITECTURE.md) and [privacy](PRIVACY.md).
