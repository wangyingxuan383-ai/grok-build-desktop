# Paired Windows and Android releases

Stable Desktop releases contain Windows Setup, Portable, a signed `Grok-Remote-v<version>.apk`, its `-build.json` record, a shared `SHA256SUMS.txt`, SBOM and licenses.

The Android signing key remains outside Git and CI. Build and scan the APK with the documented private signing environment. Its build record contains the APK name, size, SHA-256, package name, version/versionCode, signing certificate SHA-256, actual source commit, architectures and `maintainer-local-private-signing` origin. Never replace the source commit merely because the Desktop version changes.

Before pushing a new Desktop tag, supply the current signed APK and build record in a draft release for that tag. If Android and shared sources are unchanged, the workflow can reuse the current public companion instead. Full Git history is checked: the `apps/mobile` and `src/shared` trees must match the original APK source commit exactly. Missing files, changed trees, mismatched identity or signing certificate stop publication. Changed mobile functionality requires a new version/versionCode and a new signed build.

The Windows build job preserves the acquired companion, constructs all checksums and uploads both products together. An independent job downloads the draft attachments, checks all hashes, verifies Windows GitHub provenance and the actual APK certificate/package/version/DEX contract, then publishes as Latest. It does not claim GitHub Actions compiled the private-signed APK.

For an existing release, dispatch the **正式发布** workflow with `verify_tag` set to its tag, for example `v0.11.6`. This job is read-only: it re-downloads and checks both products without rebuilding, installing, changing the release or calling a model. Mobile CI also runs native dependency guards, typechecks, model/workflow/UI and startup tests.
