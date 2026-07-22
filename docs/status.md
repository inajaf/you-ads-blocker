# Project status

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
user: home feed, search, watch, Shorts, You/sign-in, Settings, shield toggle,
back button at every level, fullscreen, rotation, app resume.

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
- Shield toggle (pause/resume protection reloads the page, label/color/knob
  animate correctly both directions).
- Settings page (gear icon on You tab → General/History & privacy, back
  returns correctly).
- App resume from background (home button → relaunch) preserves WebView
  state, no unwanted reload (verified via marker-variable test).
- Ad-block hooks (`[Noirva Shield] page hooks active`, `[Noirva] DOM layer
  active`) fire on every navigation per logcat, unaffected by the above
  changes.

### Known issues (out of scope, documented not fixed)
- **Landscape device rotation without tapping the in-player fullscreen
  button** leaves the "Protection active" banner + YouTube header visible,
  eating a large fraction of the pillarboxed landscape frame instead of
  giving the video more space. This matches how the underlying mobile-web
  page behaves in a plain browser tab (rotation alone doesn't trigger
  YouTube's own fullscreen layout — only tapping the in-player fullscreen
  icon does, which correctly goes through `onShowCustomView`/`hideCustomView`
  and hides all native chrome, verified hands-on). Making the native
  banner/header collapse or auto-hide on landscape orientation regardless of
  fullscreen state would be a product/design decision (always-hide vs.
  hide-only-during-playback vs. leave as-is) — `needs-decision` rather than a
  clear bug fix, not applied here.
- No Kotlin/JUnit test infrastructure exists in `android/` (no test source
  set was ever set up); the fixes above were verified by hands-on emulator
  reproduction (marker-variable tests over chrome-devtools-protocol) rather
  than an automated test suite. `npm test` (96/96) and `npm run build` are
  green — untouched, since this task only changed `android/Noirva/`.

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