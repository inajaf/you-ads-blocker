# Architectural decisions

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
  reachable from the app. A floating "Privacy policy" pill (over the WebView,
  sharing the refresh-indicator overlay host) opens the policy in the system
  browser. The URL constant lives in
  `app/src/main/java/com/advoid/app/PrivacyPolicy.kt` and is a clearly-marked
  placeholder (`https://your-site.example/privacy`, TODO(captain)) until the
  real policy is hosted. A pure, unit-tested `isValidPrivacyPolicyUrl` guard
  refuses to open the placeholder so no user is ever sent to a fake policy;
  `PrivacyPolicyTest.kt` locks this down. The affordance was later redesigned
  from a bare text chip into a rounded translucent pill (lock icon + medium
  label + press ripple) so it reads as a proper control — see
  `MainActivity.addPrivacyPolicyAffordance` / `privacyPillBackground`.
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
across versions (e.g. always `app-release.apk` / `AdVoid-1.0.0-arm64.dmg`,
never a version-numbered rename like `AdVoid-1.1.0-arm64.dmg`).** The landing
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
