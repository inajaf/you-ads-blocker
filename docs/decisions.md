# Architectural decisions

## 2026-09-26 — Android: never manipulate YouTube's layout; repair the invisible player

Reason: the reported "the player is not playing, even trying to force the play
button does nothing, something is stuck", plus "lock the screen and sometimes
audio works, sometimes not".

Root cause (measured on the API 37 emulator, reproduced and dumped live):
- The PiP presentation forced inline styles on YouTube's player
  (`position: fixed; inset: 0; width/height: 100%`) and inline `display: none`
  on ~144 sibling elements. YouTube reacted by caching an inline
  **`top: -252px`** (minus its own height) on the `<video>` element, inside an
  `html5-video-container` of height 0: the video sat entirely **above** the
  visible player box. The player therefore looked black/dead, taps landed on the
  page instead of the video (so its controls never appeared and "forcing play"
  did nothing), and it stayed that way until a full page reload.
- That isolation could not restore such state reliably either: it only wrote back
  what it had remembered, so anything YouTube changed *while* isolated was lost.

Decisions:
- **The PiP presentation is a single CSS class toggle** (`html.advoid-pip`) and
  writes nothing inline. STYLE_SCRIPT hides the YouTube top bar and bottom pivot
  bar inside PiP so the player fills the small window; dropping the class
  restores the page exactly, because the browser does the bookkeeping. Verified:
  in PiP the class is set and the player renders at the top of the window; after
  expanding, the class is gone, the player carries no inline styles and playback
  continues.
- **Self-healing repair for the hidden-video state** (`repairHiddenVideo` in the
  watch script): when the page is at the top (never in the mini-player) and the
  main video's rect ends above its own player box, it resets the element's
  `top`/`left` offset. It runs every second and on the resume-time sync, and logs
  `[AdVoid] repaired a hidden video offset`. Verified both ways: forcing
  `top: -252px` is corrected within ~1 s, and a scrolled (mini-player) page is
  left untouched.
- **Nudges are rate limited.** A page report with `playing=false` used to trigger
  a nudge, which produced another report: measured as **ten nudges in 400 ms**,
  each a JS evaluation plus a play attempt, exactly while the platform was
  pausing the media during screen-off. Nudges are now at most one per 1.5 s and
  still capped per PiP session; the log cadence is ~1.8 s.
- **A blocked PiP explains itself.** Background audio is impossible without a PiP
  window in a WebView (platform-level suspend of hidden media, measured), so if
  the entry is requested and no PiP window appears within 1.2 s the app logs it
  and shows a one-time toast pointing at MIUI's "Display pop-up windows while
  running in the background" permission, instead of leaving a silent player.

Verified end to end on the emulator: real taps reach the video
(`videoTop 48`), tapping the ended player replays from 0 (`ended:false`, `ct:0`),
Home → PiP keeps playing with `pipClass:true`, screen-off for 8 s then screen-on
resumes playback, expanding gives `pipClass:false` with no leftover inline
styles, and the nudge log is ~1.8 s apart.

## 2026-09-26 — Android background audio requires PiP; explicit entry + media-card seek

Reason: a Xiaomi/HyperOS phone showed **no PiP window at all** when the Home
button was pressed, and the media card sat paused at `00:00 / 00:00`. Two
separate causes were measured on the API 37 emulator.

Decisions:
- **Enter PiP explicitly on every API level**, keeping `setAutoEnterEnabled`
  armed as well. The previous revision relied on the system's auto-enter alone on
  Android 12+; MIUI/HyperOS evidently does not honour it, so no PiP appeared and
  the backgrounded WebView was suspended. The explicit
  `enterPictureInPictureMode()` is what MIUI accepts, and where the system
  transition does run it either wins first or our call is ignored. The resume
  nudges from the same day keep the audio alive across either transition.
- **Background audio without PiP is impossible in a WebView — do not chase it.**
  Measured with PiP entry disabled in a scratch build: on Home the video stayed
  `paused=true` at its position for 15 s with `readyState=4` (no unload), the
  page's `ensurePlaying()`/keep-alive/`playVideo()` attempts all failed to stick,
  and the platform additionally logged
  `AudioHardening background playback muted … level: partial`. Chromium suspends
  the media pipeline of a hidden WebView at the native layer; JS cannot resume
  it. PiP (or the already-rejected native ExoPlayer pipeline) is therefore
  mandatory for background audio, and a device that cannot show PiP is a support
  case, not a code path: on MIUI the app also needs the
  "Display pop-up windows while running in the background" permission before PiP
  is allowed to appear.
- **Advertise duration and support seeking** so the media card shows real times
  instead of `00:00 / 00:00` and its scrubber works:
  `METADATA_KEY_DURATION` is reported again, `PlaybackState.ACTION_SEEK_TO` is
  advertised, `MediaSession.Callback.onSeekTo` forwards the position through a
  new `PlaybackService.seekListener` into `_advoidMediaAction('seek', ms)`, and
  the page sets `video.currentTime` plus YouTube's `player.seekTo(seconds, true)`
  so the element and the player agree.

Verification: `npm test` 266/266, `npm run build`, `./scripts/ui-check.sh` 12/12,
`npx oxlint` 0 errors, Android `testDebugUnitTest` 43/43. Emulator: Home button →
`mode=pinned` with `paused=false` and `currentTime` advancing 1 s/s for 12 s,
audio `state:started mutedState:none`, session `state=PLAYING` with
`actions=775` (includes seek) and title/artist/duration metadata.

## 2026-09-26 — Android background audio follow-ups: real-device PiP, filter row, FGS churn crash

Reason: real-device testing of the background-audio change reported two defects.
(1) Collapsing with the **Home button** showed the PiP window/audio chip but the
audio stopped, while collapsing with the **finger gesture** kept playing.
(2) YouTube's feed filter row followed the scroll and covered feed content.

Decisions:
- **The system owns the PiP transition on Android 12+.** PiP was entered only by
  our own `enterPictureInPictureMode()` from `onUserLeaveHint`; the gesture path
  uses the system's transition, which keeps the WebView surface alive. The
  params are now state-driven and arm `setAutoEnterEnabled(true)` (plus
  `setSeamlessResizeEnabled`) whenever leaving the app should shrink a *playing*
  main watch video, so the Home button takes the same path as the gesture. The
  legacy call stays for API 26-30.
- **Resume safety net for the hidden window.** Even the system transition can
  hide the WebView for a moment, and Chromium both pauses the media and throttles
  hidden-page timers. The page now re-arms its keep-alive (budget raised to 20)
  and calls `ensurePlaying()` on every real visibility → visible transition, and
  exposes `_advoidEnsurePlaying` so native can nudge it after PiP entry (bounded
  retries, stopped as soon as playback is confirmed, and gated on the coordinator
  still having a session so a nudge can never undo a user pause).
- **YouTube's filter chip row stops following the scroll.** Measured on the home
  feed: `ytm-feed-filter-chip-bar-renderer#filter-chip-bar` is `position: fixed`,
  z-index 3, 48 px tall. `STYLE_SCRIPT` forces it back into document flow
  (`position: static`, `top: auto`, `z-index: auto`), so it scrolls away with the
  feed instead of overlaying thumbnails below AdVoid's bar. Two selectors plus the
  id: a markup rename makes the rule inert rather than breaking anything.
- **Never stop and restart the foreground service in quick succession.** Found
  while verifying (1) in the emulator: a transport pause followed by YouTube
  flapping pause/play made the app call `stopService` and
  `startForegroundService` within milliseconds, and Android killed the app with
  `RemoteServiceException$ForegroundServiceDidNotStartInTimeException` (the
  system was "bringing down service while still waiting for start foreground").
  Stops are now deferred by a 2 s grace period, a start arriving inside that
  window refreshes the *running* service instead of restarting it, explicit STOP
  still stops immediately, and the start call catches `RuntimeException`
  (`RemoteServiceException`, `ForegroundServiceStartNotAllowedException`) before
  rolling the coordinator back. The notification already flips to PAUSED through
  `updatePlayback`, so the deferred stop is not visible as a stale "playing".

Verification: `npm test` 262/262, `npm run build`, `./scripts/ui-check.sh` 12/12,
`npx oxlint` 0 errors, Android `testDebugUnitTest` 43/43. Emulator (API 37):
`auto-enter enabled=true`, Home button → `mode=pinned` with `paused=false` and
`currentTime` advancing 1 s/s for 15-30 s, audio `state:started mutedState:none`,
no new `AudioHardening` entries, nudges stopping ~1.5 s after PiP entry; transport
pause keeps the position, ends the session, removes the notification 2 s later
and no longer crashes; resuming starts a fresh foreground service; Shorts still
never arm the session; feed chip bar computed `position: static` and rect moving
with the scroll (`y=48 → -552 → -1152`).

## 2026-09-26 — Android background audio: foreground service + page bridge + Picture-in-Picture

Decision: background audio in `android/AdVoid` is three cooperating layers, all
started only from user-initiated in-app playback:
1. **Native (required).** `PlaybackService` is a `mediaPlayback` foreground
   service with a platform `MediaSession` and a `MediaStyle` notification
   started while the activity is visible (while-in-use), carrying play/pause/
   stop back into the WebView. It takes no audio focus and no wake lock.
2. **Page bridge.** `BACKGROUND_AUDIO_SCRIPT` reports the document as visible
   and swallows `visibilitychange`/`webkitvisibilitychange`/`pagehide`/`freeze`
   on window capture while a session is armed, keeps a bounded keep-alive, and
   suppresses script pauses of the main watch player while the app is not
   interactively resumed.
3. **Picture-in-Picture.** Leaving the app with a video playing enters PiP, so
   the activity (and the page) stays visible; exiting from PiP restores the
   normal fullscreen app.

Reason — measured on the API 37 `emulator-5554` build, not assumed:
- YouTube's mobile player stops playback from its own `visibilitychange`
  handler: a captured stack is `jmr.stopVideo` → `QJ` →
  `HTMLMediaElement.load()`, which set `paused=true`, `currentTime=0`,
  `readyState=0`. That is the "frozen video" the app showed.
- Without a foreground service Android 17 audio hardening silences the app and
  ignores focus requests: `AudioHardening background playback muted … level:
  partial` and `AudioHardening focus request … ignored … level: partial`. Per
  Google's background-audio-hardening doc, `level: partial` means "no foreground
  service at all"; the same doc exempts PiP-mode apps explicitly.
- In PiP the activity is *paused* but visible, and YouTube's player still calls
  `pauseVideo()` about four times a second from its own state machine (no
  DOM event, no resize), so PiP alone does not keep audio alive. Suppressing
  those script pauses (with a 3 s tap allowance and an explicit action flag)
  plus resuming the element and calling the player's `playVideo()` keeps it
  playing: 20–60 s samples advance `currentTime` at 1 s/s with an `AAudio`
  player `state:started mutedState:none` and no new hardening entries.
- A full-screen-suspended WebView cannot be fixed from JS: with the app fully
  hidden, the pause has no JS stack (Chromium/native) and `play()` resolves but
  the position freezes again. This supersedes the 2026-08-25 assumption that the
  media pipeline suspension was the only cause: YouTube's own unload and the
  platform mute are actionable, the native suspend is not.

Implementation notes: `BackgroundPlaybackCoordinator` is pure logic (started vs
resumed activity, playback state, service transition, spoof/suppression flags)
and unit-tested; the service is never started from the background, so the
hardening exemption (while-in-use) is always valid; the visibility bridge only
spoofs while a session is armed, so in-app behaviour is unchanged; the overflow
menu gained a "Background audio" toggle that restores the previous plain WebView
behaviour exactly.

Details that only became visible during review and emulator QA:
- **Only trusted input is a user gesture.** YouTube synthesises its own
  click/mouse events around player state changes, and rotation auto-fullscreen
  injects a real activation tap. Counting either as user intent made every PiP
  transition look like a user pause and ended the session, so the bridge
  requires `event.isTrusted === true`, and rotation auto-fullscreen now only
  runs while the activity is resumed and not in PiP (its "landscape" in PiP is
  just the window aspect).
- **The page arms pause suppression itself** the moment it really goes hidden,
  in the same task as the event; waiting for the native round trip let YouTube's
  first `pauseVideo()` slip through as if the user had paused.
- **A permitted pause is reported to native** (`userPaused`), so a tap on
  YouTube's controls inside the PiP window ends the session instead of leaving a
  running service with a paused notification.
- **The notification carries its own play/pause action** (`MediaStyle`
  compact action): API 33+ builds controls from the `MediaSession`, but minSdk
  26 platforms render only what the notification holds. Duration/seek metadata
  is deliberately not advertised because the session exposes no `ACTION_SEEK_TO`.
- **POST_NOTIFICATIONS is requested at most once per install** (stored in the
  app's `advoid` preferences, decision in `NotificationPermissionGate`): a
  dialog is itself a top activity, so while it is up Home never reaches AdVoid
  and PiP cannot engage. Background audio works with the permission denied.
- **Screen off** keeps the session alive but paused and preserves the playback
  position (the system media session reports `PAUSED`), instead of ending the
  session — ending it disarmed the bridge before YouTube saw the page hide,
  which made YouTube unload the video and lose the position. Returning to the
  app resumes where it left off. Screen-off *audio* still cannot work.

Alternatives rejected:
- **Native media pipeline (ExoPlayer/media3) fed by stream URLs captured in
  `shouldInterceptRequest`**: fragile (expiring, IP-bound URLs, DASH/`n`
  churn) and it bypasses YouTube playback accounting/ads.
- **Wake lock + audio focus only** (the removed 2026-08-25 attempt): leaves both
  measured causes in place.
- **`SYSTEM_ALERT_WINDOW` overlay to keep the WebView "visible"**: sensitive
  permission and Play policy risk.
- **Chromium flags to disable background media suspension**: not shippable.
- media3 `MediaSessionService` + `SimpleBasePlayer` remains the documented
  upgrade if the platform ever treats a non-media3 foreground service as
  non-compliant.

Known limitation: with the screen off the activity stops, PiP is hidden, and
the native suspend wins — audio stops there (the session stays paused with the
position preserved and resumes on return). Screen-off audio would need the
rejected native pipeline.

## 2026-09-26 — Android privacy link moved into an app menu
Reason: the always-visible Privacy policy pill covered video content and drew
attention away from playback, while Google Play still requires an in-app link.
Approach: `MainActivity.addAppMenu` adds a compact native bar above the WebView.
Its overflow popup contains Privacy policy and retains the guarded public URL
and external-browser behavior. The button has a 48dp touch target and an
accessibility description. The bar keeps the menu clear of YouTube's Shorts,
navigation, and video controls.

<!-- Format: ## YYYY-MM-DD — Decision
Reason: ...
Alternatives: ... -->

## 2026-08-14 — AdVoid Android Play-prep: managed versioning, fail-closed signing, in-app privacy link
Reason: prepare `android/AdVoid` for its first Google Play upload without letting
an unsigned artifact or a mis-versioned build ever ship.
Approach (three independent changes):
- **Managed versioning.** `versionCode`/`versionName` moved out of
  `app/build.gradle.kts` into the tracked `android/AdVoid/version.properties`,
  which is now the single source of truth (`VERSION_CODE=1`, `VERSION_NAME=1.0`
  for the first upload). The build reads them at config time and fails with a
  clear error if the file/keys are missing or `VERSION_CODE` is not an integer.
  Future bumps are a one-line edit in `version.properties`, whose header comment
  documents the Play rule (versionCode must strictly increase per upload).
- **Fail-closed release signing.** Previously a missing gitignored
  `keystore.properties` silently produced an UNSIGNED release APK/AAB. Now a
  `gradle.taskGraph.whenReady` guard fails `assembleRelease`/`bundleRelease`
  with an explicit "Refusing to build an unsigned release" error whenever the
  keystore file or any of KEYSTORE_FILE/KEYSTORE_PASSWORD/KEY_ALIAS/KEY_PASSWORD
  is absent. The guard is task-graph-scoped, so `assembleDebug` and
  `testDebugUnitTest` are completely unaffected and need no keystore. The
  gitignored `keystore.properties` contract is preserved — secrets never enter
  source control.
- **In-app privacy policy link.** Google Play requires a privacy policy
  reachable from the app. The URL constant lives in
  `app/src/main/java/com/advoid/app/PrivacyPolicy.kt`. A pure, unit-tested
  `isValidPrivacyPolicyUrl` guard refuses unsafe or placeholder URLs. The
  hosting decision and current URL are recorded in the 2026-08-25 decision
  below. The original floating pill was moved into the app menu on 2026-09-26.
Alternatives: (a) keep versioning in build.gradle.kts and just comment it —
versionCode is exactly the value most often mis-bumped at release time, so a
single tracked properties file is safer than editing Groovy DSL; (b) fail the
whole configuration when the keystore is missing (throwing inside the `release`
buildType) — rejected because that would also break `assembleDebug` and
`testDebugUnitTest`, which must keep building without secrets; the task-graph
guard fails only actual release-packaging tasks.

## 2026-08-12 — Packaged macOS/Windows apps auto-update from the GitHub release feed
Reason: desktop builds were shipped as static Downloads that never updated,
forcing users to re-download installers manually. The app is already distributed
unsigned (macOS)/uncertified (Windows) through GitHub releases, so
electron-updater's GitHub feed needs no new infrastructure.
Approach: add `electron-updater` (^6.8.9), configured as an optional load in
`desktop/main.js` so Node-only tooling can still require the file; add an
electron-builder `publish` block (provider github, inajaf/you-ads-blocker); add
a `zip` mac target so the `latest-mac.yml` MacUpdater feed is generated. In
`setupAutoUpdate()` `checkForUpdates()` runs only when `app.isPackaged`,
downloads in the background (`autoDownload`), and prompts **Restart now/Later**
via a native dialog that calls `quitAndInstall()`. Every update-check failure
(Gatekeeper, network, stale feed) logs an `[AdVoid][auto-update]` warning and is
never fatal. CI (`.github/workflows/desktop-build.yml`) raises its permission to
`contents: write` and, on manual `workflow_dispatch` runs only, uploads
`latest-mac.yml`/`latest.yml`, the blockmaps, and the installers to the current
latest GitHub release via `gh release upload --clobber` authenticated with
`GITHUB_TOKEN`. Artifact names remain the stable `AdVoid-1.0.0-*` /
`AdVoid-Setup-1.0.0.exe` so the feed and the landing-page links keep resolving;
the app version (currently 1.4.0) only drives the feed's version field.
Alternatives: (a) auto-upload every desktop build to a release on every run —
rejected on 2026-08-11 because `releases/latest` serves all platform links and
a partial build would break the other downloads; the manual-dispatch gate keeps
that guarantee while allowing deliberate feed publishes; (b) a Sparkle/Squirrel
feed — extra infrastructure, electron-updater is the standard electron-builder
companion; (c) keep requiring manual re-downloads — leaves users on stale builds.

## 2026-08-11 — Google sign-in returns to Electron instead of becoming the browsing runtime
Reason: Google blocks direct account authentication inside Electron, so the
previous handoff quit Electron and left the user in Chrome App Mode. That made
the signed-in experience lose AdVoid's `WebContentsView` tab system. AdVoid now
uses its private supported Chrome runtime only as a temporary authentication
surface, reads the resulting cookies through a loopback-only DevTools session,
imports only live Google/YouTube-domain cookies into Electron, closes Chrome,
and reloads every in-app tab. Cookie values are never logged or transmitted.
The extension is launched from a versioned directory so an existing private
Chrome profile cannot keep a stale MV3 service worker after an app update.
Before relaunching the temporary auth window, AdVoid waits for both the main
Chrome process and its profile-owning helper processes to exit; otherwise
Chromium may forward the request to a stale process and silently ignore the
new loopback DevTools port.
Alternatives: keep Chrome App Mode after sign-in (rejected because it cannot
host Electron tabs); use a normal Chrome browser window (rejected because the
user explicitly requires browsing inside AdVoid); bypass Google's unsupported
browser warning (rejected as insecure and unreliable).

## 2026-08-11 — Use one circular emblem for Android launcher, splash, and video loading
Reason: device review showed the legacy square launcher bitmap being shrunk onto a white
system plate, while the separate video-loading logo/spinner treatments lacked a consistent
shape. The approved direction is a circular midnight-navy emblem with a cyan rim and the
existing shield/play mark, used through Android adaptive/round icon resources, transparent
legacy mipmaps, the Android 12 splash, and the WebView loading overlay. The loading emblem
is 88px inside a concentric 104px cyan/magenta orbit on a radial dark plate. This decision
supersedes the earlier same-day square-logo/separate-spinner loading decision below.
Alternatives: rely on launcher masking around the old square bitmap (rejected: produced the
white plate and square centre shown on-device); use independent branding for launcher and
loading (rejected: inconsistent and made alignment regressions more likely).

## 2026-08-11 — Bridge YouTube's delegated settings sheet across fullscreen DOM isolation
Reason: Android fullscreen only displays descendants of the selected fullscreen element,
while mobile YouTube owns its singleton `<bottom-sheet-container>` under `<ytm-app>` and
delegates settings actions through that ancestry. Merely moving the sheet into
`.player-container` makes it visible but breaks Quality, Speed, Captions, and other
delegated actions. For the fullscreen gear and subsequent sheet actions, AdVoid briefly
exits fullscreen, replays the click through YouTube's original tree, immediately requests
fullscreen again using the same trusted activation, and then moves the populated sheet
into the fullscreen top layer. On fullscreen exit it uses a comment marker to restore the
sheet to the exact original DOM position.
Alternatives: maintain a duplicate custom settings UI (rejected as fragile and incomplete),
or exit fullscreen permanently whenever settings are opened (rejected because it breaks
the expected fullscreen workflow).

## 2026-08-11 — Loading overlay keeps the dark plate but restores the square logo and compact spinner
Reason: hands-on review found that wrapping the square 128px source artwork in a 112px
circular ring and applying `border-radius: 50%` made the shield appear smaller and
optically off-centre. The full-player dark plate remains (`width/height: 100%`,
`background: rgba(0,0,0,0.6)`) because it cleanly covers YouTube's grey loading state,
but the branding is restored to its original proportions: an unclipped 88×88 square
image with a separate 36×36 spinner 16px below it. The fade and readyState-based
loading-vs-pause logic are unchanged.
Alternatives: keep the 112px ring around the artwork (rejected after device review:
distorted the perceived logo size); crop the asset into a circle (rejected: the source
artwork is square); remove the dark plate (rejected: exposes YouTube's grey player and
centre play button during loading).

## 2026-08-02 — Loading overlay must be built with DOM APIs, never `innerHTML` (Trusted Types)
Reason: v1.3.0's loading overlay (`createOverlay` in `VIDEO_WATCH_SCRIPT_TEMPLATE`) was built
via `el.innerHTML = '<img …/>' + '<div class="advoid-spinner" …/>'`. On real m.youtube.com
this threw `Failed to set the 'innerHTML' property on 'Element': This document requires
'TrustedHTML' assignment` — YouTube enforces a Trusted Types policy that rejects all
`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` sinks (verified live via CDP:
`window.trustedTypes` present, `el.innerHTML = …` throws). The throw happened before
`p.classList.add('advoid-loading')`, so the overlay never appeared and the grey
`.ytp-large-play-button` stayed visible — the exact bug the user saw. The DOM shim used by
`tests/advoid-video-loading.test.mjs` doesn't enforce Trusted Types, so the node tests
passed while the real page failed.
Approach: `createOverlay` now builds the overlay with `document.createElement`,
`img.src = …`, `spinner.className = 'advoid-spinner'`, and
`spinner.setAttribute('aria-hidden', 'true')` — all Trusted-Types-safe. Verified on the
live emulator: cold start and SPA navigation show the overlay (`#advoid-loading-overlay`
`display:flex`, grey button `display:none`) at `readyState < 2`, and it clears once data
arrives (`readyState` 4, overlay removed, grey button restored).
Alternatives: (a) add a Trusted-Types policy to the page that allows `innerHTML` — fights
YouTube's security policy and can be overwritten; (b) use `insertAdjacentHTML` — same sink
class, still blocked; (c) keep `innerHTML` and swallow the error — leaves the overlay
permanently broken.

## 2026-08-02 — Rotation auto-fullscreen targets `.player-container`, not the bare player
Reason: Rotation fullscreen previously targeted `video.closest('.html5-video-player')`. On m.youtube.com the mobile controls (seek bar, `YTM-WATCH-PLAYER-CONTROLS`) are mounted in `.player-container`, a wrapper *around* the player element. When the player element enters the top layer, the wrapper collapses to zero height, so the fullscreen view rendered only the letterboxed video with no reachable seek bar — play/pause and scrubbing were dead in fullscreen, while the same video in the in-page portrait player scrubbed fine. YouTube's own expand button fullscreens `.player-container`, which contains both the letterboxed player and the controls.
Approach: `AUTO_FULLSCREEN_SCRIPT` now requests fullscreen on `video.closest('.player-container')` first, falling back to `.html5-video-player`, then the bare video. This matches the expand-button element exactly: letterboxing is preserved (the player still letterboxes inside the wrapper, verified 16:9) and the seek bar is inside the fullscreen view. Also defensively removes any lingering `#advoid-fs-target` prep overlay in `onShowCustomView`, so a stale overlay can never sit at `z-index:2147483647` swallowing touches.
Alternatives: (a) keep fullscreening the bare player and inject custom controls — no, fighting YouTube's player; (b) fullscreen the bare `<video>` — reintroduces the `object-fit: cover` cropping the earlier decision deliberately avoided; (c) force `onShowCustomView` to re-parent the controls — invasive and brittle against YouTube DOM changes.

## 2026-08-02 — Android: protection is always on; native header removed
Reason: The Android app is entirely a YouTube ad blocker, so blocking is always
active by design — a user-facing "Protection active" toggle/badge only invites
confusion and wastes screen space. The header consumed vertical space above the
WebView and its controls had nothing to disable, so it was removed outright; the
WebView now fills from the top of the screen.
Approach: `MainActivity` no longer builds the header (status card, shield icon,
label, toggle, privacy line). `shouldInterceptRequest` and `onPageStarted`
blocking/script injection run unconditionally; the `shieldEnabled` field and its
`toggleShield`/`updateShieldUI`/`animateShield` helpers, the `ShieldDrawable`,
and the click listeners are gone. `PlaybackUiCoordinator` drops the now-dead
`headerHidden`/fullscreen tracking and only drives
`FLAG_KEEP_SCREEN_ON` (`activityVisible && videoPlaying`); its unit tests were
rewritten around keep-screen-on only. Rotation auto-fullscreen, letterboxing,
Shorts exclusion, back-button, and pull-to-refresh behavior are untouched.
Alternatives: (a) keep the toggle but default it on — contradicts always-on and
leaves dead UI; (b) move the status into a transient overlay — reintroduces
surface area with no user benefit.

## 2026-08-01 — Desktop tabs: one `WebContentsView` per tab, shared session
Reason: Browser-style multi-tab support. `BrowserWindow`-based tabs would each need their own window chrome; a `WebContentsView` per tab keeps all tabs inside one window with an in-window strip, and shares `session.defaultSession` so a single sign-in cookie store applies to every tab.
Approach: each tab is a `WebContentsView` (`contextIsolation: true`, `sandbox: false`, `nodeIntegration: false`, `backgroundThrottling: false`) managed by `desktop/tab-model.js`; the strip is a separate `WebContentsView` below `STRIP_HEIGHT = 42`; `desktop/tab-ipc.js` bridges strip clicks to the main process.
Alternatives: (a) one `BrowserWindow` per tab with hidden windows — heavy, no shared UI; (b) a single `WebContentsView` with SPA-tab state — can't isolate ad blocking or page crashes per tab.

## 2026-08-11 — macOS uses the shared Electron tabs inside an inset native title bar
Reason: the Windows Electron build already had browser-style tabs, but the
macOS packaging command did not rebuild the shared extension and the default
title bar left the tab strip looking like a second toolbar. A newly built DMG
could therefore miss current extension behavior even though `main.js` was
shared.
Approach: keep one cross-platform tab implementation; on Darwin only, create
the `BrowserWindow` with `titleBarStyle: hiddenInset`, reserve 82px in the strip
for the traffic lights, and make only empty strip space draggable. The tab
buttons remain `no-drag`. Both `dist:mac` and `dist:win` rebuild the root
extension before packaging. The desktop CI builds both platforms on pull
requests/manual dispatch and deliberately has no broad `v*` tag trigger, so an
Android tag cannot publish a stale desktop asset. On macOS, Cmd+T and Cmd+W are
native application-menu accelerators rather than renderer-only listeners; this
prevents the operating system's default Cmd+W behavior from closing the whole
window when focus is inside a `WebContentsView`. The tabs onboarding step is
Electron-only. Visible managed-Chrome metadata is migrated to AdVoid while the
legacy runtime/profile paths stay stable to retain existing sign-in data.
The shipped package identity is `advoid-desktop` / `com.advoid.desktop`, and
new configuration uses `ADVOID_*` environment variables. Pre-existing
`NOIRVA_*` variables and legacy managed-runtime paths remain accepted as
compatibility aliases so users do not lose their private Chrome profile.
Alternatives: (a) duplicate a macOS tab implementation — rejected because the
platforms would drift; (b) keep the standard title bar — functional but wastes
vertical space and makes the shared tabs look bolted on; (c) auto-upload every
desktop build to a release — rejected because `releases/latest` serves all
platform links and a partial release would break the other downloads.

## 2026-08-01 — Explicit desktop tab gestures always create a distinct tab
Reason: Cmd/Ctrl-click, middle-click, context-menu open, and `window.open` express an explicit browser new-tab intent, even when the same URL is already open.
Approach: every explicit entry point passes `forceNew`; allowed context-menu links use the shared YouTube URL allowlist; trusted gestures are captured in the isolated preload without a forgeable page-world event bridge.
Alternatives: deduplicate explicit opens by URL — rejected because it silently changes browser click conventions and prevents deliberate duplicate playback tabs.

## 2026-08-01 — Chrome click conventions for tabs, plus a native context menu
Reason: Users expect browser behaviour: plain click navigates in place, Cmd/Ctrl/middle-click opens a new tab, right-click offers Open-in-new-tab. Earlier builds hijacked video-URL full navigations into new tabs, which was surprising.
Approach: `desktop-tab-open.js` intercepts capture-phase `click`/`auxclick` — `button === 1` (middle) or `button === 0` with `meta||ctrl` (no shift/alt) → open new tab; everything else passes through. A native right-click menu (`desktop/tab-context-menu.js` + `contents.on('context-menu')` → `Menu.popup()`) provides Open in New Tab, Copy Link Address/Copy selection, Back/Forward/Reload. macOS needs this wiring manually — Electron shows no menu otherwise.
Alternatives: (a) a custom HTML context menu — needs positioning/hide-on-outside-click logic, less native-feeling; (b) keeping the old will-navigate hijack — surprising navigation, rejected.

## 2026-08-01 — Pre-roll ads pruned at write time via accessor properties
Reason: on full-page loads a polling hook (50ms `hookInitial()`) raced the player's first read of the inline `ytInitialPlayerResponse`, so a pre-roll sometimes leaked through on new-tab loads (old SPA flow pruned via wrapped fetch/XHR and was unaffected).
Approach: `adblock/inject.js` installs accessor properties on `ytInitialPlayerResponse`/`ytInitialData` so any assignment is JSON-pruned synchronously at write time — no poll, no race. Shared source consumed by desktop, the legacy Android wrapper, and the extension.
Alternatives: keep polling faster — still racy; wrap at a lower level (e.g. preload setter on the global) — not available across all consumers.

## 2026-08-01 — macOS Dock icon: padded rounded PNG via `app.dock.setIcon` (dev/test); `.icns`/`.ico` for packaging
Reason: `BrowserWindow.icon` doesn't control the macOS Dock (needs an `.icns` via `build.mac.icon` when packaged), so dev/test launches showed the default Electron icon. A first rounded variant was full-bleed (glyph 100% of canvas) and the Dock rendered it noticeably larger than neighbouring apps.
Approach: `app.dock.setIcon(resolveProjectPath('assets/brand/noirva-logo-v2-rounded-512.png'))` (darwin-gated), where the PNG is the squircle-masked glyph scaled to 80% of the canvas (410px centered in 512, 51px transparent margin/side) so macOS scales it to the same apparent size as neighbouring icons. Packaged `.icns`/`.ico` are unchanged and render correctly.
Alternatives: (a) skip `setIcon` and accept the Electron icon in dev — poor DX; (b) generate a padded `.icns` for dev — overkill; the PNG is enough for a dev/test icon.

## 2026-07-26 — Android playback state controls screen wake (header since removed)
Reason: The existing per-video play/pause bridge could clear
`FLAG_KEEP_SCREEN_ON` when one paused video reported after another video had
started playing, and did not combine playback with Activity lifecycle. The
native "Protection active" header also consumed video space outside true Web
fullscreen, which was the original motivation for hiding it during playback.
Approach: JavaScript reports the aggregate state of every `<video>` element. A
small Kotlin coordinator combines that state with Activity visibility: the
screen-on flag is active only while the Activity is visible and at least one
video is playing, and backgrounding always releases the flag. Header
visibility was driven from the same coordinator until the header itself was
removed on 2026-08-02 (protection is always on — see the entry above), leaving
only the keep-screen-on behavior. Debug builds use `com.advoid.app.debug`,
allowing emulator QA beside the signed release app without deleting cookies or
login data.
Alternatives: (a) always hide the header — loses visible protection controls on
feeds; (b) keep independent play/pause window-flag calls — races when YouTube
retains multiple video elements; (c) uninstall the signed release for every
debug build — destroys user session data.

## 2026-07-21 — Hero download CTA: primary button + "Other platforms" dropdown
Reason: The previous flat row of two equal-weight buttons (Android + macOS)
didn't visually prioritize the visitor's detected platform. On mobile, two
full-width buttons compete for attention; the user's actual platform should
be the obvious first action.
Approach: render only the detected (or default primary) platform as the
highlighted `.nv-btn-primary` CTA. Remaining download platforms go into an
"Other platforms" dropdown (`.nv-dropdown`), which toggles on click and
closes on outside click. Uses `aria-expanded` / `aria-haspopup` for
accessibility; menu items are `<a>` links for keyboard navigation. Detection
and reordering logic unchanged (`detectPlatform.ts` /
`orderByDetectedPlatform`); only the hero rendering changed.
Alternatives: (a) keep the flat row — simpler, but no visual hierarchy;
(b) show all buttons in a grid — too wide on mobile; (c) tabs — overkill
for two platforms.

## 2026-07-21 — Landing download links use `releases/latest/download/<file>`, and a platform data model replaces hand-coded buttons
Reason: The Android link 404'd — it was hardcoded to `v1.0.0`'s `.apk` filename
(`AdVoid-v1.0.0.apk`), but the real uploaded asset is named `app-release.apk`
(the `AdVoid-v1.0.0.apk` text was only a GitHub release *label*, not the
filename). The macOS `.dmg` link happened to match and worked, but was pinned
to `v1.0.0` the same fragile way — any future version bump would 404 it too.
Approach: every download href in `src/landing/platforms.ts` now uses GitHub's
"latest release" URL convention —
`https://github.com/inajaf/you-ads-blocker/releases/latest/download/<filename>`
— which always resolves to whatever release is currently tagged latest, so a
version bump alone no longer breaks the link.
**Constraint this places on future releases: asset filenames must stay stable
across versions (e.g. always `app-release.apk` / `app-release.aab` /
`AdVoid-1.0.0-arm64.dmg`, never a version-numbered rename like
`AdVoid-1.1.0-arm64.dmg`).** The landing
page links to these exact filenames; renaming an asset on a future release
404s the site regardless of the `latest` convention. Whoever cuts the next
release must keep the filenames unchanged (or update
`src/landing/platforms.ts` in the same PR if a rename is unavoidable).
Also refactored the hero CTA row and `#download` cards (previously two
hand-duplicated blocks of JSX) to render from one `PLATFORMS` list
(`src/landing/platforms.ts`) — adding a platform (Windows, once its build
exists) is a one-entry addition. Added `src/landing/detectPlatform.ts` (pure,
unit-tested) to reorder/highlight the hero row toward the visitor's own OS,
detected client-side on mount (not at module load, to avoid SSR/build-time
issues and layout flash).
Alternatives: patch just the one broken APK URL — leaves the same
version-pinning and filename-drift failure mode for the next release, which is
the actual root cause.

## 2026-07-21 — Marketing landing at `/`, video app relocated under `/app`
Reason: We now have a public marketing front door (`src/landing/Landing.tsx`,
with its own scoped CSS `src/landing/landing.css`, fonts loaded via injected
`<link>` on mount). The landing owns `/`; the whole existing video PWA moved to
`/app`, `/app/search`, `/app/watch/:id`, etc.
Approach: `App.tsx` splits at the top level on `window.location.pathname`
(`isAppPath`, `src/appRoutes.ts`). App paths render `<BrowserRouter
basename="/app">`; everything else renders the router-less `<Landing/>`. The
basename makes every existing internal absolute link (`to="/search"`,
`navigate('/watch/'+id)`) auto-prefix to `/app/...` with **zero churn**, and
`useLocation()` still returns basename-stripped paths so `Shell`'s
`startsWith('/watch/')` chrome-hiding check keeps working unchanged.
Alternatives: (a) rewriting every link to a `/app` prefix helper — more churn,
easy to miss a spot; (b) nested `<Routes>` with relative links — fragile for a
flat nav (relative `to="search"` resolves against the current deep path).
PWA: manifest `start_url`/`id` → `/app` and `share_target.action` →
`/app/import` so the installed app launches into the video app, not the
landing; `scope` stays `/` so the SW controls both.

## 2026-07-21 — Landing-only static bundle deployed to GitHub Pages
Reason: Publish the marketing page at https://inajaf.github.io/you-ads-blocker/
(a project Pages site served from the `/you-ads-blocker/` subpath) without the
app, router, proxy, or service worker (Pages is static-only).
Approach: reuse the same `<Landing/>` via a router-less entry
(`landing.html` + `src/landing/landing-entry.tsx`). `vite build --mode pages`
switches `base` to `/you-ads-blocker/`, `outDir` to `dist-pages/`, and the
single HTML input to `landing.html`; `scripts/pages-index.mjs` renames the
emitted `landing.html` → `index.html`. `npm run build` (Netlify, base `/`, full
SPA → `dist/`) is untouched. Deploy via `.github/workflows/pages.yml` using the
modern Actions Pages flow (`configure-pages@v5 enablement:true`).
Alternatives: a second dedicated Vite config file — more duplication than a
single `mode` branch in `vite.config.ts`.

## 2026-07-21 — Windows desktop build via CI, published to existing v1.0.0 release
Decision: add an `electron-builder` `win` (nsis, x64) target to `desktop/package.json`
and a `.github/workflows/desktop-windows-build.yml` workflow (windows-latest,
`workflow_dispatch` + `v*` tags) that builds the installer and uploads it as an
asset on the existing `v1.0.0` GitHub release via `gh release upload --clobber`,
instead of cutting a new tag/release.
Reason: no Windows machine available locally to build/sign electron-builder's NSIS
installer; CI is the only way to produce a real `.exe`. Attaching to `v1.0.0` keeps
one release with Android/macOS/Windows assets together rather than fragmenting
downloads across tags.
Alternatives: a new `v1.0.1` tag per platform build (rejected — fragments the
release users download from); code-signing the binary (rejected — no cert
available, matches the project's existing unsigned-macOS posture).

## 2026-08-25 — Remove Android background playback until it can work end to end
Decision: remove `PlaybackService`, its foreground-service notification and
wake-lock permissions, the injected `document.visibilityState` override, and
the resume-time play/reload recovery from `android/AdVoid`.
Reason: Android WebView suspends YouTube's media pipeline when the activity is
backgrounded, so keeping the process alive did not keep audio playing. The
service therefore consumed resources, requested extra permissions, and showed
a misleading notification without delivering background sound. Normal WebView
pause/suspension is the least surprising temporary behavior. Reintroducing
background audio requires a native media pipeline with a reliable supported
stream source and proper MediaSession controls, not lifecycle spoofing around
the WebView.

Superseded 2026-09-26: the "media pipeline suspension" diagnosis was incomplete
and the native-pipeline conclusion was too pessimistic. YouTube's own
`visibilitychange` unload, Android 17 audio hardening (`level: partial`), and
YouTube's PiP `pauseVideo()` storm are the actual causes; a foreground service,
a page bridge, and PiP solve the user-visible problem. See the 2026-09-26
background-audio entry (screen-off audio remains unsolved).

## 2026-08-25 — Google Play privacy policy will ship with the public landing bundle

AdVoid's Android privacy-policy link will use the stable GitHub Pages URL
`https://inajaf.github.io/you-ads-blocker/privacy.html`. The standalone policy
is copied from `public/privacy.html` into both normal Vite and landing-only
builds, so it does not depend on SPA routing and remains reachable without an
installed app. The policy reflects the current client: only internet permission,
no AdVoid analytics/telemetry servers, local WebView cookies and site data, and
YouTube/Google handling network and account data under their own policies.
