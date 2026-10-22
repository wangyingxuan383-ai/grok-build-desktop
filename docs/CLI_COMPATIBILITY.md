# Grok CLI compatibility

The application uses a separately installed Grok Build CLI and ACP protocol. It does not redistribute the CLI or silently select a different billing route.

## Runtime policy

- Account login is independent of a version allowlist.
- An unverified release may attempt a core ACP handshake; protocol failures carry their actual method and cause.
- A retained, failed update transaction blocks execution until verification or rollback resolves it.
- Compatibility evidence is bound to executable path, normalized version and binary SHA-256. Version-only historical snapshots require fresh evidence and are not assigned a new binary identity.
- Optional tools are enabled from actual runtime declarations and responses. Source documentation is a candidate contract, not proof for an installed version.

## Current evidence

The selected 1.0.40 runtime has recorded core ACP and Desktop Hook discovery evidence. An isolated 1.0.46 binary initialized ACP protocol 1, without credentials; authenticated create/resume/delete, model tasks, Computer proof consumption and child isolation were not verified by that check.

On October 16, 2026, the stable distribution and an isolated Windows runtime were 1.0.60. Its ACP protocol-1 initialize response is retained as a redacted contract fixture: runtime model capacities, reasoning levels and session marker capabilities are parsed independently of version numbers. This initialization evidence does not certify authenticated model or tool behavior. Earlier upstream snapshots retain their original verification dates and scope.

Optional capability probes are cached by canonical executable path, normalized version and SHA-256. A changed executable or forced probe invalidates runtime evidence; a late result from an older connection cannot approve its replacement. Missing legacy Memory flags mean unknown session-switch support, not removal of Memory management or a change to saved workspace settings.

Native tools own subagent lifecycle. Child usage is displayed separately while parent inclusion is uncertain. Desktop history inspection does not launch a CLI or reconcile pending interactions.

On October 17, the stable distribution was 1.0.62; its published changes concern the terminal interface and command-line tools. Native Goal pause/resume/clear and Workflow pause/resume/stop passed through the Desktop adapter against the official Windows 1.0.60 and 1.0.62 binaries, using an isolated loopback provider, and two identically titled workflows kept independent full IDs and controls. Controls are enabled for CLI 1.0.60 and later, as reported by the running agent, and every action still requires a declared command, an exact native ID, a live revision and a native receipt; an unconfirmed outcome is reported as pending and is never retried automatically. Desktop leaves the user's leader configuration unchanged and never adopts independent terminal sessions. See the redacted behavior records for [1.0.60](upstream-snapshots/grok-build-1.0.60-review.json) and [1.0.62](upstream-snapshots/grok-build-1.0.62-review.json). This evidence does not certify authenticated official-model execution or physical Android behavior.

## Revalidation

Desktop 0.13.0 does not change the minimum CLI version or auto-upgrade the runtime. The existing interjection extension remains the first control path; if the CLI reports it missing, the message remains in the ordinary removable next-turn queue and does not stop the active turn. External configuration observation affects displayed catalogs and future launches, retaining the last valid parse without reconnecting current sessions.

Use the update center to preview, verify or roll back a specific version. CLI replacement invalidates identity-bound caches. Never infer successful GUI operations from tool selection, replayed messages or display titles.
