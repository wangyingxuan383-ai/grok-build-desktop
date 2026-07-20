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

Every accepted CLI update must pass `initialize` and `session/new`; a version banner alone is not sufficient.

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
