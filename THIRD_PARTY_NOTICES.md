# Third-Party Notices

## v0.2.0 implementation references

- **[CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus)** (`seakee/CPA-Manager-Plus`, MIT): xAI/Grok billing endpoint request and response-shape compatibility reference. No credentials, branding, or UI code are copied.
- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** (`router-for-me/CLIProxyAPI`, MIT): controlled authenticated API-call and proxy-behavior reference. Grok Build Desktop keeps its own typed, allow-listed quota client.

The implementation is behaviorally informed by **Grok Build for VS Code (Community)** by Paweł Huryn, licensed under the MIT License: https://github.com/phuryn/grok-build-vscode

The application uses the Agent Client Protocol TypeScript SDK, Electron, React, Vite, and other packages under their respective licenses. Exact versions and transitive license data are recorded in `package-lock.json` after dependency installation.

## v0.3.0 implementation references

- **xAI Grok Build** (`xai-org/grok-build`): compatibility reference commit `8adf9013a0929e5c7f1d4e849492d2387837a28d` for session `pluginDirs`, private extension response shapes and MCP image-content support. Grok Build Desktop uses an independent TypeScript/C# implementation.
- **Model Context Protocol TypeScript SDK** (`@modelcontextprotocol/sdk` 1.29.0): loopback Streamable HTTP MCP server and typed image tool results, under its published license.
- **OpenAI Computer Use documentation**: behavioral safety and observe/action-loop research reference only. No OpenAI API is called and no Codex Computer Use package, `@oai/sky` component or private host file is copied or redistributed.
- The Windows helper uses public Windows UI Automation, Win32 input/window and DPI APIs and is authored clean-room in this repository.

## v0.4.0 release tooling

- **Electron Fuses** (`@electron/fuses` 2.1.3): deterministic Windows executable hardening during packaging.
- **fflate** (0.8.3): local support-bundle ZIP creation; support bundles are never uploaded automatically.
- **electron-builder** and NSIS: unsigned per-user Windows installer and ZIP packaging under their respective licenses.
- **CycloneDX npm SBOM** and `license-checker-rseidelsohn`: release inventory generation. Exact production dependency licenses are emitted as `THIRD_PARTY_LICENSES.json` with each Release.
- GitHub Actions, CodeQL, Gitleaks and artifact-attestation workflows provide public CI/release scanning and provenance; no third-party service receives application telemetry.

## v0.4.2 / v0.5.0 implementation references

- **fanghui-li/Grok-Desktop**: product-behavior reference for the large add palette, one-shot capability chips, folder attachments and automation discoverability. The implementation in this repository is clean-room and does not copy its source code or redistribute its assets.
- **smol-toml** (1.7.0, BSD-3-Clause): parses and serializes only the application-owned Grok model configuration block. Surrounding user configuration and comments are retained as text.
- **xAI Grok Build**: protocol compatibility reference commit `ba76b0a683fa52e4e60685017b85905451be17bc` for prompt queue, interjection, fork, rewind, background-task and sub-Agent extension shapes. The CLI remains separately installed and is not redistributed.
- Windows Task Scheduler, DPAPI and user-environment storage use public Windows APIs. Scheduled task prompts and pending confirmations are encrypted for the current Windows user.
