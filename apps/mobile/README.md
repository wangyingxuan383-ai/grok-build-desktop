# Grok Remote Android companion

Grok Remote 0.3.6 pairs with Grok Build Desktop 0.11.5. The phone follows and controls the computer's existing Grok execution owner. Credentials and model execution remain on Windows; no Expo Go or developer address is required. Install over the existing app to retain pairing and drafts. This candidate adds a compact composer, grouped navigation/settings, history refresh and safer asynchronous navigation between paired computers.

## Download and updates

[Download the signed Android APK](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/download/v0.11.5/Grok-Remote-v0.3.6.apk) or find Windows and Android together on the [latest release](https://github.com/wangyingxuan383-ai/grok-build-desktop/releases/latest). Desktop onboarding and connection settings show download QR codes.

From 0.3.6, the Devices screen and unpaired welcome screen can check public updates without an online computer. APK downloads report progress, support cancellation and require SHA-256, size, package, version and original signing identity verification before Android asks for installation consent. Pairing and drafts remain when updating with the same signature. Older clients can install this APK manually first.

## Install and connect

1. Install the matching Desktop package and the signed Android APK. Upgrading an existing phone installation requires the same signing identity.
2. On Windows, open Settings → 手机连接 and enable the gateway. Generate a QR, scan it in Grok Remote, and approve the phone on the computer. Advanced address and port selection is optional.
3. Both devices must share a reachable LAN or an existing VPN. Addresses are discovered at runtime. If the address changes, use Device → rediscover or scan a fresh QR; the original computer certificate remains the identity.
4. Choose a known project and conversation, or create a new conversation. A new Windows installation needs a separately installed CLI, a usable account and a project configured on the computer.

Windows network permission and guest-network isolation can affect reachability. The computer must be awake. With phone access enabled, closing the Desktop window keeps it in the tray; choose Exit to end connectivity. Running tasks use the existing shutdown confirmation.

## Four work areas

- **Conversations:** project groups, recent/favorite/archive filters, independent model/mode/effort overrides, actual effective configuration, readable plans and native progress. Create, rename, archive, delete, quote, search and branch through the original owner. Read-only history never starts a second process or changes Desktop focus.
- **Tasks:** active sessions and background jobs, confirmations, scheduled definitions and run history. Create/edit schedules, time zones, workspace, account, profile, context and notification choices; pause, run or cancel explicitly. A saved definition with failed scheduler registration retains its ID and is not reported as success.
- **Works:** independent image conversations and successful-picture gallery, explicit failed/all/code-artifact views, local favorites and two-picture comparison. Continue from a generated reference, reuse parameters, cancel or delete records. Original-file deletion requires a separate confirmation. Coding-image generation stays in its code project.
- **Devices:** paired computers, identity-preserving rediscovery, accounts, optional notifications, cache cleanup, redacted diagnostic export, versions and Desktop/CLI update status. Phone APK checks are enabled by default and can be disabled; only actual APK assets in the configured public Release can produce an update notice. Account credentials, login and installation remain on the computer.

## Materials and results

Upload files, photos or camera captures in resumable chunks. System sharing first asks for a destination conversation and adds materials to its draft; it never submits a model request automatically. Files, directories, declared CLI commands, Skills and connected MCP tools remain distinct selections. Computer selection does not grant permission or prove an operation occurred.

Project files and changes use original Desktop services. Images support zoom, system save and share; text/Markdown, isolated HTML, PDF pages and audio/video use suitable viewers. Office previews extract text and retain external-opening access. Large binaries load on demand, with a 50 MB transfer limit; they are not embedded in each history snapshot.

Tool updates use real call IDs. Child views use verified child IDs and are read-only unless an original native operation is actually exposed. Child Token reports remain separate; missing parent-inclusion evidence is never filled by adding counters. Computer state distinguishes observations, window control and application operations.

## Recovery and notifications

Drafts, materials, per-computer preferences and uncertain receipts survive navigation. Cached history is marked with its timestamp. Reconnection only restores reads; a model submission with unknown outcome retains the same operation ID for explicit reconciliation.

Android uses its normal multiline keyboard and one resize path. Foreground refresh does not recreate the composer. Offline history uses a bounded SQLite cache; preview copies use a 200 MB eviction budget, excluding an actively opened file. Clear-cache keeps drafts, receipts, uploads and computer originals.

Enable **background follow-up** explicitly for a visible Android foreground service over LAN/VPN. Completion, failure and attention channels can be managed in system notification settings; local follow-up also honors app/session notification choices. The service is not a public relay and does not wake the computer. Re-enable it after the system stops it.

Optional FCM requires a Firebase project with Android configuration on the computer and Google Play services on the phone. Select the service-account and Android configuration JSON files only in Desktop advanced connection settings; private credentials are encrypted there. Register the phone separately. Cloud messages contain generic event notifications and original target IDs, not conversation bodies. Cloud notifications do not make the computer reachable from the internet; their channels are managed by Android.

## Requirements and evidence

Windows 11 x64; Android API 24+ on ARM64 or x86-64. Modern Android is the primary target; system save uses Android 10+ MediaStore, with sharing as the fallback on older versions. Notification permission is requested when needed.

Version 0.3.1 passed physical-device cold startup and user verification that Conversations, Tasks, Works and Devices open normally. Version 0.3.2 retains the signing identity, passes native startup checks and adds packaged thumbnail/original transfer and browser-rendered reading checks. These remain separate evidence: they do not prove a particular Android IME, background policy, Google account or authenticated model behavior. No paid model call or real scheduled trigger is required for offline acceptance. Native child messaging, direct phone terminal/mouse control, automatic CLI upgrades and a hosted relay are outside this client contract.

## Build

Use Node 24, JDK 17 and an Android SDK/NDK compatible with Expo SDK 54. On Windows the SDK path should contain no spaces.

```powershell
npm ci
npm run typecheck
npm run test:startup
npm test
npm run prebuild
cd android
.\gradlew.bat :app:assembleRelease '-PreactNativeArchitectures=arm64-v8a,x86_64'
```

Set `JAVA_HOME`, `ANDROID_HOME` and optionally `GRADLE_USER_HOME`. For a private stable signature, provide `GROK_ANDROID_KEYSTORE`, `GROK_ANDROID_STORE_PASSWORD` and `GROK_ANDROID_KEY_PASSWORD`; alias `grokremote`. Keep keys outside source control. Metro reads pure shared command helpers from the repository's shared directory; Desktop process code is not bundled into the phone.

Prebuild and Gradle preBuild verify the selected native dependencies against Expo's installed SDK matrix, including transitive modules. Use compatible Expo packages rather than upgrading a wildcard peer dependency independently. After packaging, run `node ../../scripts/check-mobile-artifact.mjs <APK>` to check missing Expo core type definitions and bundled notices; `scripts/build-android.ps1` performs this automatically. Native crashes before React starts cannot be caught by the JavaScript recovery screen; a physical-device cold-start check is required separately.

See [third-party notices](THIRD_PARTY_NOTICES.md). Public examples and artifacts exclude personal addresses, private handovers and signing material.
