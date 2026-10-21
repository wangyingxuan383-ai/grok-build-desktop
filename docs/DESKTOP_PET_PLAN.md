# Desktop companion delivery plan

The desktop companion is a staged Windows feature. Character review precedes animation production and application integration. No companion window, background probe or model call is enabled by this planning milestone.

## Visual review

Two candidates use silver-white, charcoal and restrained ice-blue accents: an original softly shaded anime character, and a local recolor study of the previously selected DeepSeek-Pet character. Each candidate has a transparent full-body master, four static expression previews, light/dark backgrounds and 128/192/256 CSS-pixel comparisons. Preview scaling uses the visible silhouette rather than transparent canvas margins.

Candidate artwork, source references, prompts and local review evidence stay outside package inputs during art review. Preserve upstream attribution and notices for the adapted route: character design by ZipZipPipe, original pet material by PC2005-cloud / 宇宙之外的浩瀚宇, and integration reference by nanonocturne-altago. See the [upstream source and material notice](https://github.com/nanonocturne-altago/DeepSeek-Pet#五许可说明). Artwork attribution and provenance remain separate from the application's source-code license.

The character must be selected before producing full animation sets. Contact sheets are visual studies, not runtime animation atlases.

### Static milestone accepted for review — 2026-10-20

Both candidates now have transparent masters and four-expression raster sheets. One spacing-only revision removed neighboring-cell fragments from the sheet previews. The local comparison page normalizes visible silhouettes, supports light/dark backgrounds and separate A/B views, and displays exact 128/192/256 CSS-pixel samples. PNG decoding, controls, equal-height previews and a 393px layout passed a sandboxed Electron check; the resulting light/dark screenshots were visually inspected.

These are simulated desktop backgrounds for character comparison, not evidence of a working overlay, click-through or physical-device behavior. The original route has more slender proportions; the adapted route retains the larger head and shorter body. Generated recolor studies are not pixel-identical copies. At this static milestone, no animation had been accepted and no runtime or package had changed. Artwork and detailed local evidence remain outside the public repository.

### Dual-character direction

Both visual routes continue to the initial animation pilots. They remain alternatives for one active companion; this does not add two simultaneous desktop windows. The small character's whale motif is replaced by the application's circular G mark, softly embroidered in charcoal and ice blue on the original apron. The same change applies to its expression sheet and every animation frame.

Production still proceeds through idle, awaiting-input and pickup/landing pilots before the remaining action set or runtime integration. Retain original credits and material notices as part of asset provenance.

### Initial animation pilots delivered

Each route has four idle blink frames, four awaiting-input frames and six pickup/fall/landing/recovery frames. The local review player offers independent actions, three sizes, light/dark backgrounds, pause, frame stepping, reduced motion and card-bounded drag/drop. It uses the untouched generated PNG sheets, alpha-derived foot anchors and one visibility-aware animation scheduler; action images are predecoded in separate nodes to avoid displaying a previous atlas while switching.

Sandboxed Electron verification covers image completeness/transparency, route isolation, actual displayed reference heights, playback, pointer-input threshold and landing position, pause/reduced-motion behavior, visibility suspension, atlas switching and a 393px layout. Screenshots were visually reviewed. These remain sparse-keyframe pilots with minor generated detail changes, requiring art feedback and smoothing before production animation. They do not certify native overlay, multi-display/DPI or real session integration, and no runtime/package budget has changed.

## Animation and native validation

The expanded local review now includes work, celebration, error/help, pat, wave and doze for both routes. Together with the initial groups this provides nine selectable action groups and 38 keyframes per character. Additional actions use a grouped selector rather than a larger permanent button grid; a separate overview compares representative frames on light/dark backgrounds. A light tap triggers pat without starting a drag, and replay remembers the last explicitly requested action after a one-shot returns to idle.

Work loops, doze has an introduction followed by a quiet loop, celebration/pat/wave play once and return to idle, and error holds until explicitly changed. Both settled error previews stop the shared scheduler. All these triggers remain manual review behavior, with no connection to real task or notification events. The expanded page passes 16 documented Electron flow checks, and the overview verifies all 12 representative frames through its loopback server and narrow layout. Raw review PNGs are not a production art package; native integration and the unchanged final resource target remain separate gates.

After selection, validate idle, awaiting-input and pickup/landing samples before completing working, success, failure and pat reactions. Keep one character identity, canvas, body proportion and foot anchor across clips. Use PNG/WebP for stills or short frame sequences and transparent VP9 WebM where continuous motion is useful.

Use one small transparent Electron window with a restricted sandboxed preload. It must not steal focus; transparent areas pass clicks through, and the tray retains hide/reset/disable controls. Persist location within the owning display work area and recover from display removal and mixed DPI. Hide during lock, sleep, full-screen use and Computer Use execution. A restricted read-only mode in the existing native helper provides environment detection without a new native dependency.

The accepted implementation defaults to enabled (B, 192 DIP); explicit saved disables survive restart and upgrade. First visibility and explicit show use a one-second greeting; explicit hide/disable/normal quit use a bounded 800ms farewell. Lock, suspend, fullscreen, Computer Use and capture suppression hide immediately. Restoring from automatic suppression does not replay a greeting. Do not raise the renderer JavaScript budget; both built-in art packs together must remain within 8 MiB.

### Runtime artwork preparation — 2026-10-21

Both routes now include separate illustrated entrance and farewell sheets, alongside the nine earlier action groups. The runtime atlases use fixed standing-reference scale and foot anchors, encoded as WebP. Two complete eleven-group packs plus manifests and attribution total about 3.53 MiB. Masters and prompts stay outside the package; the development-only preparation script accepts a review source directory. This milestone establishes resource preparation, not Windows input acceptance.

## Useful behavior

Reuse the desktop activity and inbox event paths: awaiting input, failure, completion, running, idle. Completion reactions require a real terminal event and event-ID deduplication; configuration changes, queries and replay stay quiet. Waiting lasts until the interaction resolves. The companion opens the relevant conversation or existing task center; permission decisions remain in the main window.

Reuse existing quick-question and explicit system-screenshot/clipboard flows. Show task/unread/phone status and already-enabled quota warnings without additional polling or billing inference. Head/body taps, double-click navigation, pickup after 6 DIP, landing, hover controls and context menus share one interaction state machine. Quiet companionship is the default when enabled: blink/breathe/tap reactions, with autonomous roaming, sound and unsolicited bubbles off.

## Custom characters and later generation

First support local transparent PNG/WebP and data-only animation packs, with preview, size, foot alignment and explicit fallback for missing actions. A still image uses limited motion and state markers rather than claiming complete character animation. Reject executable content, unsafe paths and oversized media.

A later workshop reuses the application's existing image sessions: description/reference, one base image, preview/selection, then an explicit next generation step. Retries are user-triggered. Development artwork uses the conversation's built-in image-generation tool; the application does not depend on that tool.

## Delivery gates

1. Deliver both static candidates and verified local comparisons; obtain character selection.
2. Accept initial animation samples, then actual Windows native interaction/performance checks.
3. Integrate event-driven status, read-only navigation and existing quick-entry flows with default-enabled quiet companionship, while preserving saved disables.
4. Add safe local imports, followed by the separately accepted generation workshop.
5. Run regression, security/content and unchanged resource-budget gates; create a local inspection package before public publishing.

Windows single-character support is the first target. Mobile floating pets, Live2D/3D, punitive care mechanics, autonomous chat and large downloadable animation libraries are deferred.
