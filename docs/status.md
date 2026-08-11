# Project status

## 2026-08-11 — macOS desktop parity with Windows tabs (branch codex/macos-windows-tabs-parity)

The shared Electron multi-tab implementation is now explicitly packaged and
integrated for macOS. Darwin windows use an inset native title bar, the tab
strip reserves space for the traffic lights, empty strip space drags the
window, and tabs/buttons remain interactive. Overflow scrolling now lives on
the actual tab container instead of being clipped by it. User-visible Electron
window, onboarding, and managed Chrome runtime branding say AdVoid rather than
the legacy Noirva name; the existing runtime/profile paths remain unchanged so
saved sign-in data is preserved. The Electron-only guide explains tabs without
showing unsupported tab instructions in Chrome App Mode.

macOS tab shortcuts use native application-menu accelerators: Cmd+T creates a
tab and Cmd+W closes only the active tab, including the last-tab replacement
path. Windows/Linux retain the existing renderer shortcut handling.

macOS packaging now follows the working Windows path and rebuilds the shared
extension from the repository root before invoking electron-builder. The old
Windows-only workflow was replaced by a cross-platform macOS/Windows artifact
build for pull requests and manual runs; it has no broad `v*` trigger and does
not publish partial releases automatically.

Validation completed: full repository tests 177/177, production build, targeted
desktop tests, isolated web UI check 12/12, code review, valid x64/arm64 DMG
checksums, and strict codesign verification. Hands-on Apple Silicon QA covered
the five-step AdVoid onboarding, traffic-light spacing, strip dragging,
Cmd+T/Cmd+W, plus/select/close, last-tab replacement, 20+ tab overflow, and
Dock window recreation; all passed with no crash. The local packages are
Apple Development-signed but not notarized, so a public macOS release still
needs Developer ID distribution signing and Apple notarization.

## 2026-08-11 — Android v1.3.3 release cut: player control stability and round branding

PR #35 (`Android player control stability and round branding`) merged to `main`
(`4fecd85`) and release `v1.3.3-android` cut with the signed `app-release.apk`
(CN=AdVoid). The six branch commits land the stability and branding work below;
see the entries after this one for details:
- **Player control reliability** — robust play/pause/seek handling in the WebView
  wrapper; fullscreen top controls sit below Android's transient system-bar touch
  zone so Playback Settings stays tappable; loading overlay clears only after
  `currentTime` actually advances; Shorts gain a narrow bottom seek range tied to
  the active reel's duration.
- **Fullscreen settings** — YouTube's delegated settings sheet (gear/Quality/
  Speed/Captions) is bridged across fullscreen DOM isolation instead of breaking.
- **Round branding** — one circular midnight-navy AdVoid emblem (cyan rim +
  shield/play mark) across launcher adaptive/round icons, the Android 12 splash,
  and the WebView loading plate; the loading emblem keeps its original square
  logo proportions with the compact spinner.
- Validated on the branch: `npm test` 165/165, `npm run build`, Android
  `testDebugUnitTest` + `assembleDebug`, web UI check 12/12; gates re-verified
  on merged main: `npm test` 165/165, `npm run build`, Android
  `testDebugUnitTest`, and signed `assembleRelease` (CN=AdVoid).
- Asset: `app-release.apk` (signed, CN=AdVoid); landing page
  `releases/latest/download/app-release.apk` link keeps resolving to the new
  release.

## 2026-08-11 — Android loading recovery review fixes

Loading recovery now hides a stalled-video overlay only after `currentTime`
actually advances; a queued `timeupdate` at the same timestamp leaves genuine
buffering visible. Regression coverage exercises both the unchanged and
advancing timestamp paths. Review also confirmed that the Android 12 splash
references the complete round shield/play emblem already present in the branch.

Release QA also found that the earlier 28px fullscreen control inset placed the
gear centre exactly on Android's 137-physical-pixel mandatory-gesture boundary
at 2.625 DPR, so real taps could still be intercepted. The fullscreen top row is
now inset 56 CSS px, keeping the complete 48px gear target below that system
touch zone.

## 2026-08-11 — Unified round Android app and video-loading emblem

Android branding now uses one polished circular AdVoid emblem: a midnight navy
disc with a thin cyan rim and the existing pink-purple shield/play mark enlarged
and optically centred. Adaptive and round icon resources remove the launcher's
white plate/square-within-a-circle treatment; transparent legacy mipmaps cover
older launchers, and the Android 12 splash uses the same emblem on navy.

Video loading now presents the 88px circular emblem in a concentric 104px
cyan/magenta orbit on a navy-to-black radial plate. The emblem and spinner share
one positioned wrapper, preventing the detached/off-centre ring seen in the
earlier treatment. Loading lifecycle behavior is unchanged.

Validation: `npm test` 165/165, `npm run build`, Android
`testDebugUnitTest` + `assembleDebug`, and the web UI check 12/12 passed. The
final debug APK was installed on `emulator-5554`; the Android splash and the
real-YouTube loading plate were visually checked, and the overlay remained
non-interactive while clearing normally after loading.

## 2026-08-11 — Android fullscreen YouTube settings made interactive

YouTube's mobile settings sheet is delegated under `<ytm-app>`, outside the
`.player-container` that AdVoid fullscreens on landscape rotation. The gear
received real taps, but YouTube could neither open nor operate the sheet inside
that isolated fullscreen tree. AdVoid now replays settings clicks through
YouTube's normal in-page DOM, immediately returns to fullscreen, and mounts the
populated bottom-sheet host inside the visible fullscreen layer. The same bridge
handles Quality/Speed/Captions submenu taps and restores the host to its exact
original DOM position when fullscreen ends. Verified on real YouTube in the
installed debug APK: the gear opened the settings sheet in auto-fullscreen and
the Quality row opened the 1080p/720p/480p/360p/240p submenu without leaving
fullscreen. Regression suite: 162/162; web UI check: 12/12; Android unit tests
and debug APK assembly passed.

## 2026-08-11 — Android loading logo restored to original proportions

The circular loading-logo treatment was reverted after hands-on review: the
source asset is square artwork, so `border-radius: 50%` plus the oversized
112px spinner ring made the shield look smaller and optically off-centre. The
loading plate now uses the original 88×88 square logo without clipping and the
original compact 36×36 spinner below it. Loading-state logic, fullscreen control
insets, and Shorts seeking are unchanged.

## 2026-08-10 — Android player controls and loading stability (branch codex/android-player-controls-stability)

Three Android WebView playback defects were fixed in `android/AdVoid`:
- YouTube's fullscreen top controls now sit below Android's transient system-bar
  touch zone, so the top-right Playback Settings button remains tappable.
- The AdVoid loading plate is cleared when a YouTube SPA navigation leaves
  `/watch`, and advancing `timeupdate` events clear stale post-buffer overlays.
- Shorts now have a narrow bottom range control tied to the active visible
  video's duration/currentTime; it supports seeking, follows reel changes, and
  leaves the rest of the viewport available for vertical navigation.

Regression coverage was added in `tests/advoid-video-loading.test.mjs` and
`tests/advoid-shorts-seek.test.mjs`. Gates: `npm test` 157/157, `npm run build`,
Android `testDebugUnitTest` + `assembleDebug`, oxlint (pre-existing warnings
only), and `./scripts/ui-check.sh` 12/12 on an isolated port. The final debug APK
was installed side-by-side as `com.advoid.app.debug` on emulator-5554; no crash
or ANR was found. Real YouTube reproduced the fullscreen hit-zone defect before
the emulator lost DNS. The fixed inset was then verified with a fullscreen
WebView fixture and a real ADB tap; real-site loading/Shorts retesting remains
pending until the emulator's `ERR_NAME_NOT_RESOLVED` network fault clears.

## 2026-08-02 — Loading overlay redesigned: dark plate + logo ring (branch fm/android-loading-redesign)

The captain rejected the v1.3.x loading overlay (88px logo + small spinner floating over
YouTube's grey player as an obvious overlay). New design in `MainActivity.kt`:
- The overlay (`#advoid-loading-overlay`) is now a full-player dark plate
  (`width/height: 100%`, `background: rgba(0,0,0,0.6)`), so the grey background and
  centre play button are fully covered — nothing shows through.
- The logo sits centered inside a thin ring that spins around it (`.advoid-logo-ring`
  frame wrapping the `<img>` + an absolutely-positioned `.advoid-spinner` circular
  border) — one visual element, no longer logo + spinner stacked.
- Fades in on show (`advoid-fade-in`, 0.25s). `pointer-events: none` unchanged, so taps
  still reach the player.
- `readyState`-based loading-vs-pause logic, Shorts exclusion, and rotation fullscreen
  untouched. `createOverlay` still builds with DOM APIs (Trusted-Types-safe).
- Tests: `tests/advoid-video-loading.test.mjs` updated for the frame/ring markup (was
  asserting `overlay.children = [img, spinner]`) and gained a new suite asserting the
  STYLE_SCRIPT contains the dark plate + fade-in + ring rules.
- Gates: `npm test` 149/149, `npm run build`, oxlint clean, Android `testDebugUnitTest`
  + `assembleDebug` green. Still to verify hands-on in an emulator: the plate visually
  hides the grey player during real cold-start/SPA loads.

## 2026-08-02 — Android v1.3.1 release cut: loading overlay now actually shows

PR #33 (`fix(android): build loading overlay with DOM APIs, not innerHTML`) fixes the
v1.3.0 loading-logo bug the captain reproduced on a real phone — the AdVoid logo + spinner
never appeared and the grey YouTube play button stayed on screen instead.

- Root cause: m.youtube.com enforces a Trusted Types policy, so `createOverlay`'s
  `el.innerHTML = …` assignment threw
  (`This document requires 'TrustedHTML' assignment`) and the overlay was never created.
  Reproduced live via CDP on emulator-5554; the injected script's node-test DOM shim
  doesn't enforce Trusted Types, which is why tests passed but the real page failed.
- Fix: `createOverlay` builds the overlay with DOM APIs (`document.createElement`,
  `img.src`, `spinner.className`, `setAttribute`) — Trusted-Types-safe. `advoid-spinner`
  tests updated to assert the DOM-API construction.
- Verified hands-on: debug build installed on emulator-5554 → cold start and SPA
  transition show `#advoid-loading-overlay` (`display:flex`) with the grey button hidden
  while `readyState < 2`, then the overlay clears once data arrives (`readyState` 4) —
  full appear→clear cycle captured via CDP sampling on `m.youtube.com/watch` (both the
  logo-and-spinner and a working-playback video). dex inspection confirms the release APK
  contains the new `setAttribute` code and no `innerHTML` HTML string.
- Release `v1.3.1-android` created with the signed release APK asset `app-release.apk`
  (CN=AdVoid verified), so the landing page's `releases/latest/download/app-release.apk`
  link resolves to the fixed build.
- Gates on merged main: Android `testDebugUnitTest` 6/6 and signed `assembleRelease`; web
  `npm test` 147/147, `npm run build` green.

## 2026-08-02 — Android v1.3.0 release cut

New Android release cut for phone testing after the loading-logo feature merged:
- PR #31 (`feat(android): show AdVoid logo while a video loads`) — replaces the grey YouTube play button with the AdVoid logo + spinner during real loading (cold start, SPA transition, buffering); explicit pause keeps the grey play button.
- Release `v1.3.0-android` created at `a169010` with the signed release APK asset `app-release.apk` (CN=AdVoid verified, 10,746,761 bytes), so the landing page's `releases/latest/download/app-release.apk` link now resolves to it.
- Includes the v1.2.0 changes too: seek bar reachable in rotation fullscreen (PR #29) and protection always on / header removed (PR #28).
- Gates on merged main: Android `testDebugUnitTest` 6/6 (`PlaybackUiCoordinatorTest` 5 + `AutoFullscreenScriptTest` 1) and signed `assembleRelease`; web `npm test` 139/139, `npm run build` green.
- no-mistakes could not run (Codex out of credits until 2026-08-08); gates verified directly.

## 2026-08-02 — Android v1.2.0 release cut (both Android fixes merged to main)

Both open Android PRs merged to `main` and a new Android release cut for phone testing:
- PR #28 (protection always on / header removed) and PR #29 (seek bar reachable in rotation fullscreen) — see the two entries below.
- Release `v1.2.0-android` created with the signed release APK asset `app-release.apk` (CN=AdVoid verified, dex contains no header strings), so the landing page's `releases/latest/download/app-release.apk` link now resolves to it.
- Gates on merged main: Android `testDebugUnitTest` 6/6 (`PlaybackUiCoordinatorTest` 5 + `AutoFullscreenScriptTest` 1) and signed `assembleRelease`; web `npm test` 139/139, `npm run build` green.
- The no-mistakes pipeline could not run for either PR (Codex out of credits until 2026-08-08); gates were verified directly and both PRs were pushed/merged manually.
- Known issue: the parallel rotate-seek worktree holds the machine-local release files (`android/AdVoid/advoid-release.keystore` + `keystore.properties`); they were copied into this worktree for the signed build and are gitignored everywhere.

## 2026-08-02 — Rotation fullscreen: seek bar unreachable in fullscreen (fixed)

Reproduced: rotate to landscape with a video playing → auto-fullscreen engaged, letterboxed correctly, header hidden — but the seek bar was dead. In the rotation-fullscreen the fullscreened element was the bare `.html5-video-player`; YouTube's mobile controls (seek bar) live in `.player-container`, a wrapper that collapses to zero height in the top layer, so the fullscreen view contained no controls at all (verified via CDP: controls `visibility:hidden`, `YT-PROGRESS-BAR` 0×0, drags never fired a `seeking` event). The same video in the in-page portrait player scrubbed fine.

### Done
- `AUTO_FULLSCREEN_SCRIPT` now fullscreens `video.closest('.player-container')` (the element YouTube's own expand button fullscreens), falling back to `.html5-video-player`, then the bare video. The wrapper contains both the letterboxed player AND the mobile controls, so the seek bar is reachable in fullscreen. Letterboxing unchanged (still 16:9 via the player, verified ratio 1.777).
- Defensive: `onShowCustomView` now evaluates a one-liner removing any lingering `#advoid-fs-target` prep overlay, so a stale overlay can never sit at `z-index:2147483647` swallowing touches in fullscreen.
- New Kotlin regression test `AutoFullscreenScriptTest` guarding the target-selection priority (`.player-container` before `.html5-video-player`, bare `video` last-resort).
- Verified hands-on in emulator-5554 (Pixel 9, API 37): rotation → fullscreen engages on `.player-container`, controls visible, seek drag seeks the playhead; play/pause toggle works in fullscreen; portrait exits; a second rotation cycle re-enters and seek still works; Shorts never fullscreen on rotation; no `#advoid-fs-target` left behind on any path. Real-touch gestures via adb + CDP touch injection; seek verified via the video `seeking` event and currentTime jumps.
- Gate green: `./gradlew testDebugUnitTest assembleDebug assembleRelease` (android/AdVoid), `npm test` 139/139, `npm run build`.

### Known issues
- Emulator rotation delivery remains flaky (`settings put system user_rotation` sometimes rotates the display without firing a config change) — verified with a retrying helper, not an app defect. Some Shorts URLs redirect to `/watch` on m.youtube.com and therefore legitimately auto-fullscreen.
- Release-APK behavior on a real phone still to be confirmed by the captain (the fix is in shared `MainActivity.kt`, so debug and release build identically).

## 2026-08-02 — Android: AdVoid logo + spinner replace the grey play button while a video loads

While a watch video is actually loading (cold start, SPA transition to the next
video, buffering) YouTube shows its grey centre play button (`.ytp-large-play-button`)
even though the video isn't playable yet. The WebView injection now distinguishes
real loading from an explicit pause and swaps the grey button for the AdVoid logo
plus a spinner.

### Done
- `VIDEO_WATCH_SCRIPT` (in `MainActivity.kt`) tracks loading via media events
  (`emptied`/`loadstart`/`waiting` → show; `loadeddata`/`canplay`/`playing`/`seeking`
  → hide) and gates on `readyState < HAVE_CURRENT_DATA`, so a paused video with a
  frame on screen keeps its normal grey button. `waiting` is suppressed while
  `video.seeking` so landscape seeking never flashes the overlay.
- Overlay = `#advoid-loading-overlay` appended inside `.html5-video-player`
  (logo `img` + CSS spinner), toggled by an `.advoid-loading` class on the player;
  the class also hides `.ytp-large-play-button`. `pointer-events: none`, so taps
  still reach the player.
- Logo embedded as a base64 data URI (`ADVOID_LOGO_DATA_URI`, from
  `extension/icons/noirva-logo-v2-128.png`) so the overlay needs no local files;
  the JS template substitutes the placeholder via a computed `VIDEO_WATCH_SCRIPT`.
- Watch-page only (`/watch`), and only the main `.html5-video-player` video — feed
  preview thumbnails and Shorts are untouched.
- New node:test suite `tests/advoid-video-loading.test.mjs` (8 tests) extracts the
  injected script verbatim from the Kotlin source and drives it through a DOM shim.
- Verified: `npm test` (147/147), `npm run build`, oxlint clean, and
  `./gradlew :app:compileDebugKotlin` + `:app:testDebugUnitTest` pass. Still to
  verify hands-on in an emulator: the actual grey-button swap timing on real YouTube.

## 2026-08-02 — Android protection is always on; native header removed

The AdVoid Android app is entirely a YouTube ad blocker, so blocking is always
active by design — the native "Protection active" header (status card, shield
icon, toggle, privacy line) was removed and the WebView now fills from the top
of the screen with nothing above it.

### Done
- Removed the header UI from `MainActivity.onCreate` entirely: no status card,
  no shield icon/label, no toggle/knob, no privacy line, no header layout above
  the WebView.
- Protection is now permanently on: `shouldInterceptRequest` and `onPageStarted`
  block and inject scripts unconditionally (no `shieldEnabled` guard). Removed
  `shieldEnabled`, `toggleShield`, `updateShieldUI`, `animateShield`, the
  `ShieldDrawable` class, and their click listeners.
- `PlaybackUiCoordinator` no longer tracks `headerHidden`/fullscreen; it only
  drives `FLAG_KEEP_SCREEN_ON` (`activityVisible && videoPlaying`). The
  `onFullscreenChanged` call sites in the WebChromeClient custom-view path were
  removed as dead. Unit tests rewritten around keep-screen-on only
  (`PlaybackUiCoordinatorTest`, 5 tests).
- Everything else untouched: WebView setup, keep-screen-on lifecycle,
  rotation auto-fullscreen (letterboxing, Shorts exclusion), back button,
  pull-to-refresh, and all desktop/web code.
- Verified: `./gradlew testDebugUnitTest` and `assembleDebug` pass, plus
  `npm test` / `npm run build` from the repo root (no web changes).

## 2026-08-01 — Android auto-fullscreen on landscape rotation (branch fm/android-rotate-fullscreen)

Rotating to landscape while a YouTube video plays now expands it to fullscreen via the existing `onShowCustomView` path, matching YouTube's expand button (16:9 letterboxed, no cropping); rotating back to portrait (or pressing Back) exits it. No-op when no video is playing and on Shorts (native YouTube never expands a 9:16 Short on rotation).

### Done
- `onConfigurationChanged` (manifest already opts into `orientation|screenSize|keyboardHidden`): landscape + no active custom view → `requestAutoFullscreen()`; portrait + active custom view → `hideCustomView()`. No `videoPlaying` gate — the JS-fed coordinator flag lags fresh SPA navigations; `FULLSCREEN_PREP_SCRIPT` re-checks the page for a playing video itself.
- **User activation**: rotation alone gives no transient activation, so `requestFullscreen()` from plain `evaluateJavascript` fails (`TypeError: Permissions check failed`). `FULLSCREEN_PREP_SCRIPT` covers the viewport with a transparent overlay (`#advoid-fs-target`), waits for the landscape layout to settle (polling + tap retries, since a tap injected mid-relayout is silently dropped), then hands a visible on-overlay point to `AdVoidBridge.onRotationAutoFullscreen(x,y)`, which injects a synthetic `ACTION_DOWN`/`ACTION_UP` (`injectRotationTap`) and runs `AUTO_FULLSCREEN_SCRIPT`. The overlay is always removed (try/finally) and never leaks.
- **Cropping fix**: fullscreen targets `video.closest('.html5-video-player')` (the element YouTube's expand button fullscreens), not the bare `<video>` — the bare video keeps in-page `object-fit: cover` and renders cropped in the fullscreen view; the player letterboxes to 16:9.
- Header hiding, keep-screen-on, Back, and portrait-exit all ride the existing `PlaybackUiCoordinator` fullscreen path; added two regression tests (`rotation fullscreen hides header even when playback flag is stale`, `leaving rotation fullscreen restores header when video is paused`).
- Verified on emulator-5554 (Pixel 9, SDK 36): 5/5 landscape rotations → fullscreen, 16:9 (732×412) video, header hidden, `KEEP_SCREEN_ON` set, portrait/Back exit, paused → no fullscreen, Shorts → no fullscreen, no overlay leak.
- Memory convention: merged `CLAUDE.md` (Claude-Code-specific agent rules) into `AGENTS.md` and symlinked `CLAUDE.md → AGENTS.md` per `fm-ensure-agents-md.sh`.

### Known issues
- Emulator rotation delivery is flaky (`settings put system user_rotation` sometimes rotates the display without firing a config change; `wm user-rotation lock` never delivers one) — verified with a retrying helper, not an app defect.
- Still to verify hands-on on a real device (screen size/aspect differences).

## 2026-08-01 — Desktop multi-tab feature: WebContentsView tabs, per-tab ad blocking, Chrome click conventions, native context menu

Browser-style tabs for the desktop app (`desktop/`, branch `fm/desktop-video-tabs`), implemented and locally validated for the no-mistakes pipeline.

### Done
- **Multi-tab architecture**: each tab is its own `WebContentsView` (`contextIsolation: true`, `sandbox: false`, `nodeIntegration: false`, shared `session.defaultSession`), managed by `desktop/tab-model.js`; the in-window strip is a `WebContentsView` below `STRIP_HEIGHT = 42`, rendered by `tab-strip.html`/`tab-strip.js`/`tab-strip-preload.js` (plain DOM, no framework).
- **Per-tab ad blocking**: network needles from `adblock/hosts.json` (`registerNetworkBlocking`) plus JSON pruning via `adblock/inject.js`, injected into every tab's MAIN world from `desktop/preload.js`.
- **Pre-roll ad race fixed**: on full-page loads a 50ms `hookInitial()` poll raced the player's first read of the inline `ytInitialPlayerResponse` (old SPA flow pruned via wrapped fetch/XHR, so new-tab full loads were the trigger). Fixed with accessor properties so any assignment is pruned synchronously at write time; reproduced, fixed, and verified clean in Electron.
- **Chrome click conventions**: plain click = same-tab SPA navigation; Cmd/Ctrl+click = new tab; middle-click (`auxclick`) = new tab (`desktop/desktop-tab-open.js`). The old video-URL → new-tab `will-navigate` hijack was removed — full navigations stay in the current tab.
- **Native context menu**: `desktop/tab-context-menu.js` (`buildContextMenuItems`) + `contents.on('context-menu')` in `main.js` → native `Menu.popup()` (Open in New Tab, Copy Link Address/Copy selection, Back/Forward/Reload). macOS needs this wired manually — otherwise Electron shows no menu.
- **Review hardening**: explicit open gestures always create distinct tabs; the context menu accepts every allowlisted YouTube link; gesture detection stays in the isolated preload and rejects synthetic events; the strip scrolls to its active tab; HTML fullscreen hides the strip; failed tab loads log tab and URL context.
- **Dock icon sizing fix**: `app.dock.setIcon` used a full-bleed PNG (glyph 100% of canvas → rendered larger than neighbouring apps). Regenerated `assets/brand/noirva-logo-v2-rounded-512.png` with the glyph at 80% (410px centered in 512, 51px transparent margin/side), squircle-masked. Packaged `.icns`/`.ico` untouched.
- **Windows verification**: modifier detection is platform-agnostic (`event.metaKey || event.ctrlKey`); context-menu wiring is cross-platform (not darwin-gated); `runtime-paths.mjs` supports win32 (`LOCALAPPDATA`/`chrome-win64`/`chrome.exe`); strip CSS is cross-platform. `npx electron-builder --win --dir` cross-packed successfully.
- Tests: 135/135 (`tests/adblock-inject`, `tests/tab-open`, `tests/tab-context-menu`, `tests/tab-model`, `tests/desktop-tabs`). `npm run build` green, oxlint clean.

### Known issues
- The `--win --dir` cross-pack produced win-arm64 and was **not executed on a real Windows host** — real-Windows runtime verification (icon, modifiers, context menu) is still pending.
- The first-run guide overlay (`#tube-desktop-guide`) is full-page and intercepts right-clicks while shown; dismiss it first for the context menu to hit content.
- Dev/test dock icon uses the padded rounded PNG; the packaged app still ships the full-bleed `.icns` (confirmed rendering correctly).

## 2026-07-26 — Android playback header and screen-wake lifecycle

Done:
- Replaced independent per-video `onVideoPlay`/`onVideoPause` window mutations
  with aggregate JavaScript playback reporting plus a testable Kotlin
  `PlaybackUiCoordinator`. (The `Protection active` header this entry was
  originally about was removed entirely on 2026-08-02 — protection is always
  on; only the coordinator's keep-screen-on behavior remains, see the entry at
  the top of this file.)
- `FLAG_KEEP_SCREEN_ON` is now conditional on both active playback and a started
  Activity. Stopping releases it, while `onResume` re-syncs the actual WebView
  state; paused-but-visible multi-window Activities retain the playback UI and
  wake flag, and callbacks received after stopping cannot reacquire it.
- Added eight JVM unit tests for playback, pause, fullscreen, background, and
  resume transitions.
- Debug builds now install as `com.advoid.app.debug`, beside the signed
  `com.advoid.app`, so emulator QA does not require removing release cookies or
  login state.

Verified:
- `testDebugUnitTest` and `assembleDebug` pass.
- Installed and exercised the debug APK on the existing API 37 emulator.
- Real YouTube playback hides the header and sets `KEEP_SCREEN_ON`; real pause
  restores the header and clears the flag.
- Aggregate two-video check stays active when one video is paused.
- Web fullscreen opens successfully; Back exits fullscreen without finishing
  the Activity.
- With the system screen timeout temporarily reduced to 10 seconds, the device
  remained awake after 13 seconds of real playback. The original timeout was
  restored afterward.
- No crash, FATAL EXCEPTION, or ANR appeared in the app log.

Known issue:
- The emulator/WebView logged transient Chromium `SharedImageManager` GPU
  mailbox errors during video/fullscreen rendering, without a crash or visible
  playback failure.

## 2026-07-22 — Android release signing set up (new keystore)

Follow-up to the Noirva→AdVoid rename below. The user asked how the current
published `app-release.apk` was signed/released before, so this could be
reproduced for `android/AdVoid`. Investigation via git history found a
`signingConfigs` block was added once (`5be8a51`, "chore: add release
signing config and gitignore for secrets") but **that commit is on a branch
that was never merged into `main`** — the actual signing setup (keystore
file + `local.properties` passwords) only ever existed locally on the user's
machine, deliberately gitignored, and was never recoverable (no private key
can be extracted from an already-built APK). A filesystem search turned up
nothing but the standard Android SDK debug keystore.

Since the Noirva→AdVoid `applicationId` rename (below) already breaks
in-place upgrades for any existing `com.noirva.app` install regardless of
signing key, there was no additional cost to generating a fresh keystore
rather than needing to recover the old one — the user confirmed this
tradeoff explicitly.

Done:
- Generated `android/AdVoid/advoid-release.keystore` (PKCS12, alias
  `advoid`, RSA 2048, 25-year/10000-day validity) with a random 30-char
  password via `keytool`.
- `android/AdVoid/keystore.properties` holds `KEYSTORE_FILE` /
  `KEYSTORE_PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD`, gitignored.
- `app/build.gradle.kts`: reads `keystore.properties`, applies a
  `signingConfigs["release"]` to the `release` build type **only when the
  keystore file actually exists** — so a fresh checkout or CI without the
  secret configured still builds (unsigned) instead of hard-failing.
- Also disabled `lintVitalAnalyzeRelease` (`lint { checkReleaseBuilds =
  false; abortOnError = false }` — same fix the abandoned branch had
  independently arrived at): AGP 8.7.3's lint tooling fails outright under
  this machine's JDK 26 (Homebrew, newer than AGP 8.7.3 supports for that
  specific check); this is a packaging build, not a lint gate, so skipping
  it here is appropriate.
- Added `.gitignore` entries repo-wide for `*.keystore`/`*.jks` plus the
  specific `keystore.properties`/`local.properties` paths, and untracked
  `android/AdVoid/local.properties` (was previously tracked by mistake —
  only ever held the machine-local `sdk.dir`, not a secret itself, but
  shouldn't have been tracked to begin with).
- Verified hands-on: `./gradlew assembleRelease` produces a signed APK
  (`apksigner verify --print-certs` confirms the `CN=AdVoid` cert), old
  `com.advoid.app` debug install replaced with this **signed release build**
  in the emulator, installed and launched successfully.

**The keystore/password are local-only, not in this PR's diff** (by
design — see the `.gitignore` entries above). The user needs to back up
`android/AdVoid/advoid-release.keystore` and the password from
`keystore.properties` somewhere durable (password manager, secrets vault)
outside this git history — losing them again means repeating this whole
process and breaking upgrades a second time. Also not done: actually
uploading a new build to the GitHub release (the `app-release.apk` asset
the landing page links to) — that's a deliberate, separate step for the
user or a future task, not automated here.

## 2026-07-22 — Android app renamed Noirva → AdVoid (directory + package ID)

Follow-up to the Android UX review below, requested when setting up release
signing for the Android app. The Android wrapper's directory and Gradle/Kotlin
identity still said "Noirva" even though the app's user-visible label was
already "AdVoid" — done:

- `android/Noirva/` → `android/AdVoid/` (`git mv`).
- Kotlin package `com.noirva.app` → `com.advoid.app`, including moving
  `MainActivity.kt`/`AdBlocker.kt` to the new
  `app/src/main/java/com/advoid/app/` path.
- `app/build.gradle.kts`: `namespace`/`applicationId` → `com.advoid.app`.
- `settings.gradle.kts`: `rootProject.name` → `"AdVoid"`.
- `AGENTS.md` and code-reviewer agent memory updated to the new path.

**Deliberately left unchanged:** `app/src/main/assets/inject.js` and
`dom-layer.js` still log `[Noirva Shield]` / `[Noirva] DOM layer active` —
these files are byte-identical copies of `/adblock/inject.js` (the shared
source of truth also consumed by `desktop/`, the legacy `android/` wrapper,
and `extension/`, none of which were touched here). Renaming only this
Android copy's internal strings would diverge it from that shared source for
a purely cosmetic debug-log string with no user-visible effect. Fixing the
Noirva branding leak in the shared `/adblock/` source (and its consumers) is
a separate, wider-reaching cleanup, not part of this change.

**Consequence users should know:** this is an `applicationId` change, so
Android treats it as a completely different app from the previously-shipped
`com.noirva.app` build — anyone with the old package installed needs to
uninstall it first; there's no in-place upgrade path across this rename. Not
applied to iOS/desktop/extension, which already use their own IDs
(unaffected).

Verified hands-on in the emulator after the rename: clean `assembleDebug`
build, old `com.noirva.app` uninstalled and new `com.advoid.app` installed
fresh, ad-block hooks still fire (`[Noirva Shield] page hooks active` in
logcat — expected per above), search works, opening a video hides the "Open
App" banner (`#advoid-style` present), and the back button still navigates
WebView history instead of exiting (all three fixes from the entry below
re-confirmed working under the new package).

**Release signing:** resolved in the entry above — the old keystore was
confirmed unrecoverable and a fresh one was generated instead.

## 2026-07-22 — Android hands-on UX review: refresh, Open App, and back-navigation fixes

Native Android wrapper is `android/Noirva/` (package `com.noirva.app`) — this is
the actively-developed app; the older `android/` wrapper (`app.tube`) predates
it and was not touched. Built and tested hands-on in an Android emulator
(Pixel 9, API 36) via `adb`/CDP (chrome://inspect over `adb forward` +
`webview_devtools_remote_<pid>`), clicking through every main flow as a real
user: home feed, search, watch, Shorts, You/sign-in, Settings, back button at
every level, fullscreen, rotation, app resume. (The shield toggle exercised
here was removed on 2026-08-02 — protection is always on, see the top entry.)

### Done — reported bugs, reproduced and fixed
- **Refresh bug** (repro: tap a video from home → back → swipe-down-to-refresh
  on the feed silently did nothing). Root cause: `PULL_REFRESH_SCRIPT`'s
  pull-gesture state (`pulling`/`shown`/`lastScrollTs`) lived in JS closure
  variables that were only initialized once (guarded by
  `window._advoidRefreshSetup`, since listeners must attach only once but
  YouTube's SPA navigations don't reload the page/JS context). Any
  interrupted gesture or navigation-timing edge case could leave `pulling`
  wedged, silently breaking every future pull on that page's lifetime. Fixed
  in `MainActivity.kt` by moving that state onto a `window._advoidPull`
  object that's explicitly reset on every `injectPageScripts()` call (i.e.
  every SPA navigation via the new `doUpdateVisitedHistory` override), while
  listener attachment remains a one-time no-op guard. Also added Shorts-aware
  eligibility: refresh only fires on the *entry* Short of a reel (tracked via
  `window._advoidShortsEntry`), not mid-reel, so swipe-down mid-Shorts
  correctly goes to the previous Short instead of refreshing; `/watch` is
  excluded entirely so scrolling a video's description never triggers a
  reload. Verified hands-on: marker-variable test (set a `window.__marker`,
  perform the exact swipe, confirm marker survives/is destroyed as expected)
  on home-after-back-nav, Shorts entry, mid-reel Shorts, and `/watch`.
  code-reviewer subagent caught a follow-up edge case: a pushState navigation
  landing mid-gesture could reset `P.shown`/`P.pulling` without telling
  native, leaving the refresh `ProgressBar` stuck visible — fixed by calling
  `AdVoidBridge.onRefreshRelease(false)` before the per-navigation reset when
  the indicator was showing. Re-verified hands-on after the fix.
- **"Open App" banner visible during video watch.** It's YouTube's own
  mobile-web upsell (`<a href="intent://...">Open App</a>`, `ytm-button-renderer`
  in the topbar), not a PWA/InstallBanner component from `src/` — nothing in
  `src/` renders it since this is a raw `m.youtube.com` WebView, not the React
  app. Fixed via injected CSS (`a[href^="intent:"]` and related upsell
  renderers → `display:none`) plus a `shouldOverrideUrlLoading` override that
  swallows non-http(s) schemes so a stray tap on one can't bounce to the Play
  Store or error out. The `:has()` selector for a nested case is split into
  its own CSS rule (code-reviewer catch: sharing a comma list means one
  unsupported selector on an older WebView invalidates the whole rule,
  silently un-hiding even the plain `intent:` links — mitigated regardless by
  `shouldOverrideUrlLoading`, but kept isolated anyway). Verified hands-on on
  `/watch` (topbar button gone,
  `document.querySelectorAll('a[href^="intent:"]')` present in DOM but
  `display:none`/zero-size) and confirmed it doesn't regress `/` or `/shorts`
  (checked no other legitimate button matches the selector).

### Done — additional bug found in click-through and fixed
- **Hardware/gesture back button exited the app instead of navigating back**
  (repro: home → tap video → press back → app exits to launcher instead of
  returning to the feed). Root cause: `MainActivity` extends plain
  `android.app.Activity` (not `AppCompatActivity`/`ComponentActivity`) and
  targets `compileSdk`/`targetSdk` 36, where Android's predictive-back
  dispatcher is active by default; with no `OnBackInvokedCallback`
  registered, the system now finishes the activity directly and never calls
  `onBackPressed()`. Fixed by adding
  `android:enableOnBackInvokedCallback="false"` to the manifest's
  `<application>` tag (restores legacy dispatch) and implementing
  `onBackPressed()`: exit fullscreen custom view if active, else
  `webView.goBack()` if there's history, else default finish. Verified
  hands-on: home → video → back → back on the feed (not exit); fullscreen →
  back → exits fullscreen only, not the app; two backs from home → app exits
  cleanly.

### Verified working, no changes needed
- Search (type query, results render, no ads/Open App visible, back returns
  to results/previous page correctly).
- Ad blocking always on (protection is permanent by design — the toggle this
  entry verified was removed on 2026-08-02, see the top entry).
- Settings page (gear icon on You tab → General/History & privacy, back
  returns correctly).
- App resume from background (home button → relaunch) preserves WebView
  state, no unwanted reload (verified via marker-variable test).
- Ad-block hooks (`[Noirva Shield] page hooks active`, `[Noirva] DOM layer
  active`) fire on every navigation per logcat, unaffected by the above
  changes.

### Follow-up
The landscape playback-header limitation and missing Kotlin unit-test coverage
were resolved by the 2026-07-26 playback lifecycle work; see
`docs/decisions.md` for the current contract.

## 2026-07-21 — Renamed Noirva to AdVoid

### Done
- Renamed all user-visible references from "Noirva" to "AdVoid" across:
  - Android: app label, theme names, manifest, strings.xml
  - iOS: log messages, app struct name (NoirvaApp → AdVoidApp)
  - Desktop: productName, description in package.json
  - Landing page: all UI text, FAQ, content sections
  - Components: UpdateToast, InstallBanner, HomePage, WatchPage, SettingsPage
  - Extension: manifest name/description (Noirva Shield → AdVoid Shield)
  - Config: vite.config.ts PWA names, root package.json description
  - Documentation: all READMEs, AGENTS.md, decisions.md, status.md
  - Tests: updated assertions to match new name
- Created new GitHub release v1.2.0 with renamed assets:
  - AdVoid-1.0.0-arm64.dmg (macOS)
  - AdVoid-Setup-1.0.0.exe (Windows)
  - AdVoid-iOS-Source.zip (iOS source)
  - app-release.apk (Android, unchanged for compatibility)
- Updated landing page download links in `src/landing/platforms.ts` to use new asset names
- Pushed all changes to origin/main (2 commits)

### Known issues
- Old v1.1.0 release still exists with Noirva-named assets (kept for backwards compatibility)
- Android APK keeps name `app-release.apk` to avoid breaking existing install links
- iOS README still references actual Xcode project filesystem paths (Noirva.xcodeproj) - renaming would break project structure
- Android build cache artifacts still contain old Noirva references (will be cleaned on next clean build)

## Previous status entries...

## 2026-07-21 — Compact hero buttons with platform dropdown

### Done
- Replaced the flat row of hero download buttons with a compact layout:
  primary button for the visitor's detected platform (e.g. "Download for
  Android" on an Android device) and an "Other platforms" dropdown for the
  remaining download options.
- Dropdown closes on outside click, uses `aria-expanded`/`aria-haspopup`
  for accessibility, and renders menu items as `<a>` links for keyboard
  navigation.
- Detection + reordering logic unchanged (from `detectPlatform.ts` /
  `orderByDetectedPlatform`); only the hero rendering changed.
- CSS additions: `.nv-dropdown`, `.nv-dropdown-trigger`, `.nv-dropdown-menu`,
  `.nv-dropdown-item` scoped under `.noirva-landing` (no style leakage).
- Verified: `npm test` 96/96, `npm run build` green, UI check 12/12.

### Known issues
- None from this change.

## 2026-07-21 — Fixed broken Android download link, data-driven landing platforms

### Done
- Fixed 404'd Android download link: was hardcoded to `AdVoid-v1.0.0.apk`,
  real asset is `app-release.apk`. All download hrefs now use
  `releases/latest/download/<filename>` so a version bump alone can't break
  them again (verified with `curl -sI` — both resolve 302, not 404).
- Documented in `docs/decisions.md` (and README) that future releases must
  keep asset filenames stable across versions, since the landing links to
  them by exact name.
- Refactored the hero CTA row + `#download` cards (previously duplicated
  JSX) into a single `src/landing/platforms.ts` data list consumed by both;
  adding a platform (Windows, once its build lands) is now a one-entry
  addition. Windows deliberately **not** added yet — no release asset exists.
- Added `src/landing/detectPlatform.ts` (pure, unit-tested): client-side OS
  detection reorders/highlights the hero row toward the visitor's platform,
  falls back to default order (Android primary) for unknown/iOS/Windows.
  Detection runs in a `useEffect` on mount, not at module load.
- 8 new unit tests (`tests/landing-platforms.test.mjs`) — 96/96 total pass.
  `npm run build` green. UI check green (12/12). Manual browser verification
  via chrome-devtools-axi with emulated Android/macOS/Windows/iOS user
  agents confirmed correct reordering/highlighting and working download
  links; download-section cards visually match the original design.

### Known issues
- None from this change.

## 2026-07-21 — Marketing landing page + `/app` route move + GitHub Pages deploy

### Done
- New marketing landing page ported from the `.dc` design source into idiomatic
  React/TS: `src/landing/Landing.tsx` + scoped `src/landing/landing.css`,
  `content.ts` (layers/steps/marquee/download URLs), `faq.ts` (accordion data +
  pure `toggleFaq`/`faqVisual` helpers), `useRevealOnScroll.ts`
  (IntersectionObserver in `useEffect`, disconnected in cleanup, respects
  `prefers-reduced-motion`). Fonts loaded via injected `<link>` on mount
  (removed on unmount), not globally. Apple glyph rendered as inline SVG.
- Routing: landing owns `/`; the whole video app moved under `/app` via
  `<BrowserRouter basename="/app">` (see `src/appRoutes.ts` + decisions.md).
  Zero churn on internal links — they auto-prefix; deep links `/app/watch/:id`
  stay shareable.
- PWA manifest: `start_url`/`id` → `/app`, `share_target.action` →
  `/app/import`, `scope` stays `/`.
- GitHub Pages: landing-only static bundle — `landing.html` +
  `src/landing/landing-entry.tsx`, `npm run build:pages` (base
  `/you-ads-blocker/` → `dist-pages/`, `scripts/pages-index.mjs` renames to
  `index.html`), workflow `.github/workflows/pages.yml`. Netlify `npm run
  build` unchanged.
- Tests: `tests/landing-faq.test.mjs` covers `toggleFaq`/`faqVisual` and
  `isAppPath`. `tests/ui/smoke.spec.ts` updated to the new routes (`/`, `/app`,
  `/app/*`).
- Verified: `npm test` 88/88, `npm run build` + `npm run build:pages` green,
  UI check 12/12. Hands-on browser pass — landing renders (fonts, animations,
  gradient, device mock, FAQ accordion toggles with 45° icon rotation),
  relocated app works (`/app` home, search `/app/search?q=…`, watch deep link
  `/app/watch/:id`, BottomNav client-nav), Pages bundle serves under
  `/you-ads-blocker/` with correctly-prefixed assets and no console errors.

### Known issues
- None from this change. (`/app/watch/:id` still shows the pre-existing
  "Desktop protection required" gate in desktop browsers without the Shield
  extension — unchanged behaviour, unrelated to the route move.)

## Done
- 2026-07-19: AI-dev setup installed (AGENTS.md, Playwright UI checks, Claude agents/hooks).
- 2026-07-19: Committed on branch ai-setup-and-studio-back: AI-dev setup + window-guard
  child-surface support (2 commits, reviewed).
- 2026-07-19: Fixed desktop back arrow on YouTube Studio / "create video" surfaces —
  resolveBackNavigation() in extension/desktop-guide-ui.js now falls back to
  youtube.com/?tube_app=1 (app mode) instead of plain youtube.com on fresh surfaces.
  Restored stale-registration cleanup in desktop-window-guard.js; added takeover-path
  test. Team cycle: reviewer approved (no criticals), QA signed off after real-browser
  hand-tests. npm test 76/76, build green, ui-check 10/10.

## In progress / remaining
- Back-arrow fix is uncommitted on ai-setup-and-studio-back — awaiting commit
  confirmation, then push + PR (user asked to hold the push).

## 2026-07-20 — Desktop app Google account pages support + back-arrow polish
- Fixed separate Chrome window opening on YouTube Account/Your data pages:
  added `parseTrustedGoogleAccountUrl` to `extension/desktop-window-guard.js`
  and extended `isAllowedDesktopAppTabUrl` to accept `accounts.google.com`
  and `myaccount.google.com`.
- Added back button on Google account pages: new content script entry in
  `manifest.json` for `*://accounts.google.com/*` and `*://myaccount.google.com/*`,
  new `extension/account-back.js` that detects AdVoid desktop app mode and
  injects a fixed-position back button styled consistently with the existing UI.
- Added fallback navigation bar for YouTube pages without masthead (Account,
  Your data on YouTube, etc.) in `desktop-guide-ui.js` — back button stays
  reachable via fixed-position nav element instead of being hidden.
- Dock-reopen URL forwarding: when a new Chrome window (e.g. from Dock click)
  is detected and closed, its URL is forwarded to the active app tab so the
  user doesn't lose navigation to account or settings pages.
- 6 new unit tests for Google account URL parsing, app-window sender recognition,
  Dock-reopen URL forwarding, and untrusted URL rejection.
- npm test 82/82, npm run build, npm run build:extension green. Playwright UI
  check 10/10 (5 pages × 2 checks).

## 2026-07-21 — Windows desktop build (build infra only, on fm/noirva-windows-build)
- Added `win` (nsis, x64) electron-builder target to `desktop/package.json`
  using the existing `assets/brand/noirva-logo-v2.ico`, plus a `dist:win` script.
- Added `.github/workflows/desktop-windows-build.yml`: builds on `windows-latest`
  (`workflow_dispatch` + `v*` tags) and uploads the resulting `.exe` to the
  existing `v1.0.0` release via `gh release upload --clobber`. See
  `docs/decisions.md` for the "attach to existing release" rationale.
- README: added a "Desktop app (Windows)" section (download + SmartScreen
  bypass, mirrors the macOS Gatekeeper note).
- Not run: the workflow itself was not triggered from here (no Windows build
  credentials available in this session) — needs a manual `workflow_dispatch`
  run post-merge to confirm the `.exe` lands on the v1.0.0 release.
- Out of scope / untouched: `src/landing/`, `vite.config.ts`,
  `.github/workflows/pages.yml` (parallel `noirva-landing` task owns those).
- npm test / npm run build: no-op check, this task doesn't touch `src/`.

## Known issues
-
