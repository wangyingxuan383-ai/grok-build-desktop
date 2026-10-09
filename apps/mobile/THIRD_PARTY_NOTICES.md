# Third-party notices

The mobile companion is independently implemented on React Native and Expo.

The pairing-target state helper in `src/remote-model.ts` is adapted from Paseo's `packages/app/src/components/pair-link-credentials.ts`, copyright 2025-present Mohamed Boudra, licensed under Apache-2.0. Reference: https://github.com/getpaseo/paseo at stable v0.10.3 (`b4af508e2a9e5a34a8b0ffb8dfaff6fd679da6c7`). Changes adapt host identity to the Grok Desktop certificate fingerprint and pairing-link contract. The complete upstream license is provided in `LICENSE-APACHE-2.0.txt`.

Paseo informed the device-pairing and conversation workflow. HAPI was reviewed for Grok ACP and native-client behavior; no HAPI AGPL code is incorporated. Their complete daemons, account services, branding and hosted relays are not bundled.

React, React Native, Expo, react-native-url-polyfill, react-native-safe-area-context and AsyncStorage retain their respective license notices in their packages. OkHttp is Apache-2.0. Distribution should preserve the dependency inventory and notices alongside the APK.

Markdown rendering uses markdown-it 14.1.0 (MIT), copyright 2014 Vitaly Puzrin and Alex Kocharin. Clipboard access uses Expo Clipboard (MIT). The Android build includes `GROK_REMOTE_NOTICES.txt` in its assets, with these notices, the adapted helper's Apache-2.0 license and available dependency licenses.

The 0.4 interaction layer uses React Native Gesture Handler, Reanimated, Worklets, Shopify FlashList, Expo Image, Haptics, Local Authentication and Vector Icons. Their packaged license texts are included in GROK_REMOTE_NOTICES.txt. Android cloud delivery uses Firebase Messaging under its distributed license terms. The design study of other apps informed interaction rules only; no AGPL source code was copied.
