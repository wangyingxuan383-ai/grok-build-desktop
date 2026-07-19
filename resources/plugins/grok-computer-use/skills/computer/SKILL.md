---
name: computer
description: Use Grok Build Desktop's experimental Windows foreground Computer Use harness only when the user explicitly selects @Computer or asks for visual desktop control.
---

# Grok Computer Use

Use this Skill only for an explicit `@Computer` request. The available `grok_desktop_computer` MCP tools implement an observe → one action → observe loop.

## Tool choice

1. Prefer a dedicated plugin or MCP whenever it offers the needed structured operation.
2. For browser inspection and automation, prefer the official `chrome-devtools` Grok plugin. Use visual Computer Use only for browser chrome, pixel verification, or when structured tools cannot complete the request.
3. Never attempt to control Grok Build Desktop, Codex/ChatGPT, a terminal, PowerShell, CMD, Windows Terminal, UAC, Windows Security, an elevated window, or a non-interactive desktop.

## Loop

1. Call `list_apps` or `list_windows`, select the exact target, and call `start`.
2. Call `get_window_state`. Treat `elementId` values and `stateId` as single-observation capabilities.
3. Prefer accessible elements and `set_value`/`click` over pixel coordinates. Pointer actions are intentionally visible: the host moves the real system mouse and the desktop overlay explains the current step.
4. Execute exactly one state-changing action. Every action response contains the new state and screenshot; examine it before the next action.
5. If a tool reports stale state, wrong foreground window, pause, or permission denial, do not retry blindly. Observe again or ask the user. If the task pauses for UAC/Windows Security, ask the user to complete it manually, then call `resume` only after the user confirms completion.
6. Call `stop` when complete. Use `pause`/`resume` only when the user asks, and stop immediately when the user interrupts.

## Permissions and risk

- Plan mode is observation-only.
- Ordinary applications are available by default. A user may optionally enable confirmation for new applications; auto approval never bypasses high-impact confirmation.
- Set `risk` and `riskSummary` before any deletion, external communication/publication/submission, financial or subscription action, software/script/extension installation, account permission/API-key change, security/privacy/VPN/password change, or sensitive-data transfer.
- Never enter passwords, one-time codes, or CAPTCHA answers. Hand UAC, Windows Security/privacy prompts, and final password changes back to the user.
- Do not place secrets or full typed text into progress summaries.
