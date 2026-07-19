# Repository Instructions

Before changing this repository:

1. Read `docs/IMPLEMENTATION_PLAN.md`.
2. Read `docs/FEATURE_MATRIX.md`.
3. Read `CHANGELOG.md` and `docs/CLI_COMPATIBILITY.md`.
4. Keep the implementation-plan checklist and changelog current with every completed milestone.
5. Do not claim a feature works until its automated test or documented live verification passes.

The application is a Windows-first Electron GUI for the locally installed Grok Build CLI. Keep the renderer sandboxed (`nodeIntegration: false`, `contextIsolation: true`) and put filesystem, process, credential, and ACP work in the Electron main process.
