# Android companion

Grok Remote 0.3.6 pairs with Grok Build Desktop 0.11.5 for compact conversation controls, grouped navigation/settings and identity-bound asynchronous refresh. It retains the signing identity, native startup dependency guard and consistent send receipts. Earlier protocol-1 clients retain basic compatibility; optional operations are declared by the connected computer.

Conversation reading defaults to compact: execution details are folded, long messages can be expanded and message actions are available from their menu. Standard and detailed views remain available. Question navigation reads the full stored projection, supports prompt search and answer previews, and loads the selected turn without starting execution. Unread gaps are distinguished from continuous answers. Opening a conversation targets its latest loaded reply.

The phone presents Conversations, Tasks, Works and Devices. It uses existing Windows session, media, scheduling, confirmation and account services. Model/mode/effort controls are independent of profile selection and report the effective owner configuration. Busy or stale configuration changes fail with a reason instead of silently switching an active task.

Model requests do not require old project directories to remain available. Refresh failures stay in the configuration panel and retain existing choices and drafts. New unbound requests may use the native CLI's declared default when a saved default is unavailable; explicitly selected and existing conversation models are not silently changed. Normal conversations omit idle history badges, while running, waiting and failed work keeps a meaningful status. Secondary composer actions are available from More tools.

Pair by QR and explicit Desktop approval on a reachable LAN or existing VPN. Adapter choices come from each computer at runtime; rediscovery verifies the original certificate before changing its address. Missing CLI, login, project or network conditions are explained on the corresponding screen. Window close keeps an enabled gateway in the tray; Exit follows normal task shutdown protection.

Uploads have device/session provenance, resumable offsets and explicit cancellation. Drafts and uncertain receipts are separate from rebuildable offline caches. Viewing child sessions never substitutes the parent identity or starts another process. Computer counts come from execution state, while child usage is shown separately from parent totals.

Image conversations and scheduled definitions reuse the original stores. Gallery defaults to pictures. Record deletion, original-file deletion and phone cache removal have distinct scope. Scheduler registration failure retains the saved definition ID; retry is through editing that definition.

Local background follow-up is an opt-in foreground service with a visible stop action. Optional user-configured FCM sends generic notifications and target IDs; it does not provide an internet control route. Actual device, background and authenticated model acceptance must be recorded separately from offline fixtures and native builds.

See the [client guide](../apps/mobile/README.md) for installation, supported workflows, limits and build requirements. Credentials stay on Windows. Public source and packages must exclude personal addresses, private handovers and signing material.

## Downloads and online updates

Windows and the signed APK are published together on the [latest release](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/latest). Desktop onboarding and phone connection settings provide APK QR codes. Android 0.3.6 can check and download updates independently, verify their integrity and existing signature, and open the system installer on explicit consent. Windows Setup updates use the application update center; portable copies are replaced manually.
