---
name: computer
description: Use the available Windows GUI tools when a task requires observing or operating desktop applications; natural-language requests are sufficient.
---

# Grok Computer Use

Select this skill when GUI interaction is needed within the user’s requested task; `@Computer` is optional. A disabled capability must never be bypassed. The available `grok_desktop_computer` MCP tools implement an observe → one action → observe loop.

## Tool choice

1. Prefer a dedicated plugin or MCP whenever it offers the needed structured operation.
2. For browser inspection and automation, prefer the official `chrome-devtools` Grok plugin. Use visual Computer Use only for browser chrome, pixel verification, or when structured tools cannot complete the request.
3. Never attempt to control Grok Build Desktop, ChatGPT, a terminal, PowerShell, CMD, Windows Terminal, UAC, Windows Security, an elevated window, or a non-interactive desktop.

## Loop

1. Call `list_apps` or `list_windows`, select the exact target, and call `start`.
2. Call `get_window_state`. Treat `elementId` values and `stateId` as single-observation capabilities.
3. Prefer accessible elements and `set_value`/`click` over pixel coordinates. Pointer actions are intentionally visible: the host moves the real system mouse and the desktop overlay explains the current step.
4. Execute exactly one state-changing action. Every action response contains the new state and screenshot; examine it before the next action.
5. If a tool reports stale state, wrong foreground window, pause, or permission denial, do not retry blindly. Observe again or ask the user. If the task pauses for UAC/Windows Security, ask the user to complete it manually, then call `resume` only after the user confirms completion.
6. Call `stop` when complete. Use `pause`/`resume` only when the user asks, and stop immediately when the user interrupts.

## Permissions and risk

- Plan mode is observation-only.
- Ordinary applications are available by default. A user may optionally enable confirmation for new applications; Agent mode requests high-impact confirmation; Auto mode follows the user’s automatic-approval choice. Protected targets and manual-secret boundaries still apply.
- Set `risk` and `riskSummary` before any deletion, external communication/publication/submission, financial or subscription action, software/script/extension installation, account permission/API-key change, security/privacy/VPN/password change, or sensitive-data transfer.
- Never enter passwords, one-time codes, or CAPTCHA answers. Hand UAC, Windows Security/privacy prompts, and final password changes back to the user.
- Do not place secrets or full typed text into progress summaries.
