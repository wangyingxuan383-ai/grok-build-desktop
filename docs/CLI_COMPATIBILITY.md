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

Native tools own subagent lifecycle. Child usage is displayed separately while parent inclusion is uncertain. Desktop history inspection does not launch a CLI or reconcile pending interactions.

## Revalidation

Use the update center to preview, verify or roll back a specific version. CLI replacement invalidates identity-bound caches. Never infer successful GUI operations from tool selection, replayed messages or display titles.
