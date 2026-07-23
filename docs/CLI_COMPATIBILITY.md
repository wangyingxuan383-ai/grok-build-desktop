# Grok CLI Compatibility

| Date | CLI | Plugin reference | Status | Evidence |
|---|---:|---:|---|---|
| 2026-07-15 | 0.2.101 | 1.5.11 | Verified | `version --json`, `update --check --json`, `models`, ACP `initialize/session/new`, real Grok 4.5 reply, persisted reload/context, and live `none/minimal/low/medium/high/xhigh` effort switches confirmed by `_x.ai/session_notification.model_changed` |
| 2026-07-16 | 0.2.101 | 1.5.11 | Verified for v0.2 adapters | Bundled `session_reader.py codex show --json` parsed the current Codex task; OAuth weekly and monthly billing endpoints both returned HTTP 200 through the configured proxy; no token was printed |
| 2026-07-16 | 0.2.101 | 1.5.11 | Verified for v0.2.1 media | ACP publishes `/imagine`; local CLI docs describe `/imagine-video`, while the advertised Imagine skill contains `image_gen`, `image_edit` and `image_to_video`. The desktop uses the ACP-advertised `/imagine` skill for video rather than assuming the unadvertised alias |
| 2026-07-17 | 0.2.101 | Grok Build source `8adf9013a0929e5c7f1d4e849492d2387837a28d` | v0.3 optional extension compatibility | Both process-level `grok agent --plugin-dir <path> stdio` and `session/new._meta.pluginDirs` load the packaged plugin and publish `/computer`. This installed CLI returns `Method not found` for `x.ai/plugins/list`, `x.ai/mcp/list` and `x.ai/commands/list`; the desktop therefore uses CLI JSON fallback. Loopback MCP token/tool inventory and PNG result contracts are verified independently. |
| 2026-07-18 | 0.2.101 | Grok Build source `8adf9013a0929e5c7f1d4e849492d2387837a28d` | v0.3 Computer Use accepted | Real Grok completed the injected Skill/MCP visual click and client-rejected delete-risk loops. The xAI Official `chrome-devtools-mcp` 1.6.0 disable/enable probe restored source/version/commit/status. Packaged Electron authorization, risk dialog, lifecycle and global emergency stop passed. |
| 2026-07-18 | 0.2.101 | Built-in Computer plugin/host 0.3.1 | v0.3.1 visible-control compatibility | Real Grok repeated the one-click and rejected-risk loops with default ordinary-app access. Packaged Electron verified the blue overlay, live action strip and dynamic `Esc`; the native 24-flow probe verified physical cursor arrival. UAC remains a Windows secure-desktop handoff rather than a model action. |
| 2026-07-19 | capability-probed | Public app 0.4.0 | v0.4 public compatibility layer | Unknown CLI versions are accepted after non-billable `version/models/ACP initialize` probes. Agent help dynamically selects `--effort` or `--reasoning-effort`; optional reader/quota/media/plugin/Computer failures only disable their surface. Default verification is offline; previous 0.2.101 live evidence remains valid until `verify-live.ps1` is explicitly rerun. |
| 2026-07-20 | 0.2.101 | Public app 0.4.2 local candidate | v0.4.2 changes the Electron startup, composer, menu and theme clients without changing ACP/Grok wire contracts. Offline verification passed 167 tests, packaged content/UI probes and the one-shot `/computer <instruction>` composition contract. The explicit real Grok loop was also rerun: the fixture reached `increment:1`, stopped normally, and the delete-risk sentinel requested confirmation and remained untouched after rejection. |
| 2026-07-20 | 0.2.106 (`bde89716f6`) | Grok Build source `ba76b0a683fa52e4e60685017b85905451be17bc` | v0.5 queue/provider/task compatibility | Generated provider overrides pass isolated `inspect --json` and `models` probing. Non-billable ACP initialization/session creation publishes `/imagine` and the injected `/computer`; live effort switching succeeds. Queue changes are driven by `x.ai/queue/changed`; mutations use versioned notifications, same-turn input uses `x.ai/interject`, fork/rewind use their official request shapes, and task/sub-Agent inventory unwraps `ExtMethodResult`. Private plugin/MCP/command inventory remains optional and falls back to CLI JSON on this build. |

| 2026-07-21 | 0.2.106 (`bde89716f6`) | Public app 0.5.12 release | No Grok wire or application-runtime change from the locally accepted 0.5.11 build. The release-only change removes unsupported Hosted Runner GUI/InteractiveToken repetition; provider, automation, plugin, marketplace and MCP probing is unchanged. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.13 hotfix | No ACP or Grok CLI wire change. The fix copies Chromium Local State into the headless worker's isolated session before Electron ready and updates task-center presentation; an existing encrypted task passed a non-executing DPAPI probe. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.14 hotfix | No ACP wire change. The worker now synchronizes rotated OAuth credentials by matching the canonical `auth.json` identity to the task's fixed account and preserves concurrent CLI refreshes. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Local app 0.5.15 hotfix | Packaged OAuth automation completed a real file-read turn and returned a resumable session. This CLI returns `Method not found` for `x.ai/rewind/points`; the adapter now treats that private method as optional and returns an empty capability result instead of failing the UI. Auto-mode ACP permission requests are answered directly. |
| 2026-07-21 | 0.2.106 (`bde89716f6`) | Public app 0.5.16 release | `session/load` reopened a packaged scheduled task's fixed OAuth/model session for a second real run. Both runs completed with the same session ID; manual context cleanup then deleted the dedicated Grok session. No ACP wire extension was added. Release workflow `29846404781` succeeded for commit `e4dfb62`, and `v0.5.16` is the public Latest release. |
| 2026-07-22 | 0.2.106 (`bde89716f6`) | Local app 0.6.1 candidate | No new required CLI method. Pasted images still reach ACP as standard image content blocks; `clientMessageId`, durable previews, queue/interjection presentation and cache cleanup are desktop contracts. ACP image replay is merged client-side and cache paths are excluded from prompt text. Final package/installed acceptance is offline and sends no model prompt. |
| 2026-07-22 | 0.2.106 (`bde89716f6`) | Local app 0.6.2 development candidate | No new paid/private ACP requirement. Turn duration/outcome is Desktop presentation metadata. Review uses local Git through fixed main-process argument arrays and stdin; Renderer sends only typed scope/file/hunk IDs. Last turn intersects current Git changes with actual ACP write locations. |
| 2026-07-23 | 0.2.106 (`bde89716f6`) | Local app 0.6.3 installed hotfix | No ACP wire change. Scheduler decoding/diagnostics and unified Renderer navigation are Desktop/Windows fixes; non-Git Review capability checks use local Git only. |
| 2026-07-23 | 0.2.106 (`bde89716f6`) | Public app 0.6.4 release | No new ACP/private-method requirement. Lazy Review index/detail remains local fixed-argument Git. Provider draft testing/discovery is a bounded main-process GET to the configured model-list endpoint and never sends inference content; Renderer receives typed candidates without credentials. PR #13 and Release workflow `29993675891` passed; `v0.6.4` is the public Latest release at `df5db6b`. |

Every accepted CLI update must pass `initialize` and `session/new`; a version banner alone is not sufficient.

## v0.6 accepted capability snapshot (2026-07-23)

Installed CLI `0.2.106 (bde89716f6)` advertises Worktree creation/resume flags, `grok worktree list/show/rm/gc`, experimental cross-session Memory, Agent definitions, Personas and the Agent Dashboard. Its bundled official ACP guide lists `x.ai/git/*` and `x.ai/git/worktree/create|remove|apply|list|gc`, while `grok inspect --json` reports agents, skills, plugins, MCP/LSP servers, configuration sources and project trust. The v0.6 client capability-probes private methods and provides the controlled Git/read-only-history fallbacks defined below; it never launches `grok dashboard`.

Memory remains disabled by default. The approved desktop behavior enables it per workspace without silently modifying global `config.toml`; Memory layout or command incompatibility disables only the Memory surface. Agent and Persona files remain owned by Grok's documented user/project directories, with built-in and plugin definitions treated as read-only.

The first v0.6 implementation slice now exposes a version-cached `CliCapabilitySnapshot`. Static probing is limited to root/Agent/Worktree/Memory help and `inspect --json`; it does not send a prompt or infer private ACP support. On CLI `0.2.106`, live non-billable help verification confirmed `--worktree`, `--worktree-ref`, `worktree list/show/rm/gc`, `--experimental-memory`, `--no-memory`, `memory clear`, Agent flags and `dashboard`; `inspect --json` returned the documented agents/plugins/MCP/config/trust sections. Four focused snapshot tests and TypeScript pass.

The v0.6 Git workbench uses the installed system Git independently from Grok ACP and therefore does not change the CLI wire compatibility boundary. Local verification used Git `2.52.0.windows.1`, temporary repositories and a local bare remote for porcelain-v2 status, Diff, stage/unstage, stdin commit, branch/conflict handling and Pull/Push. A loopback stalled HTTP fixture verified explicit cancellation; no real remote was contacted.

Worktree inventory/create/apply/remove/GC is wired to prefer `x.ai/git/worktree/*` when an idle ACP session supplies direct runtime evidence; method-not-found or unavailable-session cases use the controlled system-Git compatibility layer. The fallback passed temporary-repository create/recovery/apply/conflict/retention/removal/GC tests. This session verified official inventory preference with a mock contract, but did not claim a live private-ACP Worktree mutation on CLI `0.2.106`.

The Memory center now follows CLI `0.2.106` source-compatible storage exactly: normalized `org/repo` identity when `origin` exists, ASCII slug plus the first eight BLAKE3 hex characters, global/project `MEMORY.md`, and per-project `sessions/`. Isolated tests confirmed identical identity for a repository, subdirectory, clone and Git Worktree. The desktop leaves global `config.toml` untouched, stores default-off enablement in AppData, injects `GROK_MEMORY=1|0` per process, disables `GROK_MEMORY_LOG`, constrains main-process I/O to `GROK_HOME/memory`, and calls `grok memory clear` only with fixed documented arguments. Confirmed remember actions are dispatched through the active ACP session as native `/remember`; `/flush` and `/dream` support explicit actions plus the configured idle session-end policy. Exact-entry deletion remains a desktop-side conflict-checked edit of the same native file layout. The offline candidate intentionally did not repeat a paid live Memory rewrite.

The Agent/Persona center follows CLI `0.2.106` discovery precedence and file formats: project `.grok/agents/*.md` and `.grok/personas/*.toml`, user `GROK_HOME/agents|personas`, bundled definitions, plus read-only plugin Agent directories reported by `inspect`. Agent frontmatter uses native snake-case fields such as `prompt_mode`, `permission_mode`, `disallowed_tools` and boolean `agents_md`; Persona parsing accepts `instructions_file`, `reasoning_effort`, `default_capability_mode`, `default_fork_context`, `default_isolation = "none"|"worktree"` and `[[inputs]]`/`[[outputs]]`. Every mutation uses fixed `grok inspect --json` arguments after an atomic write and persistent backup, then rolls back on failure. The installed CLI does not advertise a definition hot-reload method, so only idle sessions are restarted; running or waiting sessions are left intact. An isolated `GROK_HOME` Electron/CDP probe created user-scoped Agent and Persona definitions through typed IPC, confirmed inspect acceptance, rendered both raw formats in bundled Monaco and preserved unknown fields without editing `config.toml`; project-scope paths and priority are covered by isolated service tests.

Execution profiles compile to `grok agent --model`, the detected effort spelling, `--always-approve`, `--agent-profile`, protected environment values and `session/new._meta.rules`. The installed `grok agent --help` publishes model/effort/always-approve/agent-profile, while the root TUI publishes `--max-turns` but ACP Agent stdio does not. Consequently the desktop visibly marks profile `maxTurns` unsupported and refuses to launch a non-empty value rather than silently dropping it. Persona allow-lists and default child isolation are labelled degraded rule mappings because CLI `0.2.106` does not publish hard session fields for them.

The desktop Agent Dashboard is an application projection of ACP status/tool/meta/sub-Agent events, task inventory and the existing session catalog. When live child inventory is absent, persisted history is forced to `unknown`/terminal states and labelled read-only; no historical record is presented as running. Stop requests use the existing ACP task/sub-Agent cancellation path, not the TUI Dashboard command.

Local app `0.6.0` candidate verification retained CLI `0.2.106` as the accepted boundary. One temporary-repository integration flow passed without sending a prompt, the packaged Profiles/Dashboard/new-session/task-health probe passed, and one formal Setup/Portable build passed Fuses and public-artifact scanning. No live private Worktree mutation, paid `/remember` rewrite, CLI rollback, tag or public Release was claimed; the Windows version/upgrade/DPI/display matrix remains a separate release gate.

Local app `0.6.1` changes only the desktop presentation and attachment lifecycle above. Standard ACP image blocks, queue notifications and interjection behavior remain compatible with the same CLI boundary. The installed Setup and Portable pass offline shell/image-reopen acceptance, but no new private ACP capability or paid model behavior is inferred from that evidence.

Local app `0.6.3` changes Windows task decoding and application navigation only. Local app `0.6.4` changes the right-pane/Review presentation and provider management. Model discovery is deliberately outside ACP: the main process performs only a bounded model-list GET using the user's draft provider configuration, rejects redirects and oversized responses, and returns sanitized model candidates. Neither version expands the accepted CLI boundary or sends a paid prompt during offline acceptance.

## Private effort extension

CLI `0.2.101` accepts a live request shaped as:

```json
{
  "method": "session/set_model",
  "params": {
    "sessionId": "...",
    "modelId": "grok-4.5",
    "_meta": { "reasoningEffort": "high" }
  }
}
```

The client considers the switch complete only after a matching
`_x.ai/session_notification` with `sessionUpdate: "model_changed"`. Because
this is a Grok-private extension rather than standard ACP, older or changed
CLI builds fall back to a controlled process restart with rollback.

## Optional v0.2 capability probes

- `scripts/probe-v020-compatibility.ps1` probes the bundled Codex reader and the allow-listed OAuth weekly/monthly billing endpoints.
- `scripts/verify-live.ps1` can require both quota calls for an explicitly selected real OAuth profile; default `verify.ps1` never reads real auth data or queries billing.
- CLI update verification keeps ACP `initialize/session/new` as the rollback boundary. Codex-reader or quota-adapter failure is recorded as an optional compatibility diagnostic and does not roll back an otherwise valid ACP CLI.

## Media capability rule

- `scripts/probe-grok.mjs --require-media` requires the live ACP session to publish a usable Imagine workflow.
- Direct `/imagine-video` is preferred only when ACP advertises it.
- On CLI `0.2.101`, ACP advertises `/imagine` but not `/imagine-video`; the app submits an explicit `image_to_video` request through the advertised Imagine skill.
- The Renderer never calls image/video endpoints or receives media credentials directly.

## v0.3 extension and Computer Use rule

- `scripts/probe-grok.mjs --require-extensions --plugin-dir <path>` verifies session-level plugin injection and records private extension availability without treating optional methods as the ACP rollback boundary.
- On CLI `0.2.101`, plugin and marketplace inventory use `grok plugin ... --json`, and MCP inventory/diagnostics use `grok mcp ... --json` when private ACP methods are absent.
- `@modelcontextprotocol/sdk` is pinned directly. The per-session Streamable HTTP endpoint binds only to `127.0.0.1` and requires a distinct random Bearer token.
- Optional plugin/MCP/Computer capability loss disables or diagnoses only the extension surface. ACP `initialize + session/new` remains the automatic CLI rollback boundary.
- The in-app updater and `scripts/update-grok.ps1` probe process/session `pluginDirs` and the packaged x64 helper as optional capabilities after the core ACP probe. Optional probe failure is logged but does not trigger a CLI rollback.
- The in-app updater now runs the native helper's JSON self-test rather than checking file existence only. The repository update script additionally runs the 24-flow deterministic test application and reversible official-plugin state probe.
- Live model visual/risk acceptance is deliberately opt-in (`verify-live.ps1 -RequireLiveComputerAction`) so default CI and ordinary CLI checks never start a billable or foreground-changing model task.
- The packaged `/computer` Skill and Windows helper do not call OpenAI APIs and do not reuse Codex proprietary Computer Use files.
- From app `0.3.1`, ordinary non-protected applications do not require a per-app prompt unless the user enables `confirmNewApps`; high-impact confirmation and the protected-process denylist are unchanged.
- Pointer actions visibly move the physical Windows cursor. The blue overlay and temporary global `Esc` are Electron client features and do not depend on a private Grok CLI method.
- UAC secure desktop and higher-integrity targets pause for manual user completion. The updater treats this as an intentional Windows boundary, not a failed CLI compatibility probe.
