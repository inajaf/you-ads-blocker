# Tube — Android WebView wrapper

A minimal native Android app that loads the **real** `m.youtube.com` full-screen
(no browser chrome — looks like the YouTube app) and blocks ads **Brave-style**,
using the exact same ad-block core as the browser extension and the desktop app.

Two layers of blocking, both consumed from `/adblock` (single source of truth):

1. **Network layer** — `WebViewClient.shouldInterceptRequest` returns an empty
   response for any request whose URL contains a substring from
   `assets/hosts.json` (doubleclick, `/pagead/`, `/api/stats/ads`, …).
2. **Page layer** — `assets/inject.js` runs in the page's main world at
   **document-start** and strips `adPlacements` / `playerAds` / `adSlots` out of
   the player responses (patching `JSON.parse` / `fetch` / `XHR`) before ads can
   be scheduled. It logs `[Tube Shield] page hooks active`.

You stay logged into your Google account; subscriptions, history and
recommendations are untouched.

---

## Version matrix (all mutually compatible)

| Component                  | Version | Where set |
|----------------------------|---------|-----------|
| Android Gradle Plugin      | 8.5.2   | `build.gradle` (plugins block) |
| Gradle                     | 8.7     | `gradle/wrapper/gradle-wrapper.properties` |
| Kotlin                     | 1.9.24  | `build.gradle` (plugins block) |
| compileSdk / targetSdk     | 34      | `app/build.gradle` |
| minSdk                     | 24      | `app/build.gradle` |
| Java / Kotlin JVM target   | 17      | `app/build.gradle` |
| androidx.webkit            | 1.11.0  | `app/build.gradle` |
| androidx.core:core-ktx     | 1.13.1  | `app/build.gradle` |
| androidx.appcompat         | 1.7.0   | `app/build.gradle` |

Why these are compatible:

- **AGP 8.5.x requires Gradle 8.7+** and supports compileSdk 34 — so Gradle 8.7
  and compileSdk 34 are the matched pair.
- **AGP 8.x requires JDK 17** to run and to compile (`sourceCompatibility` /
  `jvmTarget = 17`). Android Studio Jellyfish/Koala ship a bundled JDK 17.
- **Kotlin 1.9.24** is the last 1.9.x release and is fully supported by
  AGP 8.5.x (AGP 8.5 bundles Kotlin-Gradle-plugin support for 1.9.x).
- **androidx.webkit 1.11.0** provides `WebViewCompat.addDocumentStartJavaScript`,
  `WebViewClientCompat`, and the `WebViewFeature.DOCUMENT_START_SCRIPT` check
  used for the document-start injection, with a graceful runtime fallback.

---

## Prerequisites

You need a real Android toolchain:

- **JDK 17** (Temurin/Zulu/Oracle) — or just use the JDK bundled with Android
  Studio.
- **Android Studio** (Koala or newer) **or** the Android command-line tools with
  SDK Platform 34 + Build-Tools 34 installed.
- **Node.js** (only needed to re-sync the ad-block assets — optional; copies are
  already committed).

You will also need a `local.properties` pointing at your SDK (Android Studio
creates it for you). If building from the CLI, create `android/local.properties`:

```properties
sdk.dir=/Users/<you>/Library/Android/sdk
```

---

## Build & run

```sh
cd android

# (Optional) refresh the ad-block assets from the shared /adblock core.
# The copies under app/src/main/assets/ are already committed, so this is only
# needed after you edit /adblock/hosts.json or /adblock/inject.js.
node scripts/sync-adblock.mjs

# Build the debug APK.
./gradlew assembleDebug

# Install onto a connected device / emulator.
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The APK lands at `app/build/outputs/apk/debug/app-debug.apk`.

> The shared ad-block core lives at `/adblock/hosts.json` and `/adblock/inject.js`.
> The files in `app/src/main/assets/` are **generated copies** kept in sync by
> `scripts/sync-adblock.mjs`. Edit the originals, not the copies.

---

## Verifying the ad-block works

1. Connect the device and watch logcat filtered to the page console:

   ```sh
   adb logcat -s chromium:I | grep "Tube Shield"
   ```

   You should see `[Tube Shield] page hooks active` shortly after the app opens
   a page. (WebView routes `console.info` through the `chromium` logcat tag.)

2. Open an ad-heavy video (music videos and long uploads are good tests). There
   should be **no pre-roll ad** and no mid-roll interruptions. The video starts
   at 0:00 on the real content.

3. To confirm network blocking, you can temporarily enable WebView remote
   debugging (`WebView.setWebContentsDebuggingEnabled(true)` in `MainActivity`)
   and inspect from `chrome://inspect` on a desktop Chrome — ad requests to
   `doubleclick.net` / `/pagead/` return an empty 200.

---

## Project layout

```
android/
├── settings.gradle
├── build.gradle                      # AGP 8.5.2 + Kotlin 1.9.24 (apply false)
├── gradle.properties
├── gradlew  /  gradlew.bat           # standard Gradle 8.x wrapper scripts
├── gradle/wrapper/
│   ├── gradle-wrapper.jar            # Gradle wrapper bootstrap
│   └── gradle-wrapper.properties     # -> gradle-8.7-bin.zip
├── scripts/
│   └── sync-adblock.mjs              # copies /adblock -> app assets
└── app/
    ├── build.gradle                  # com.android.application + kotlin-android
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml       # INTERNET, single launcher Activity
        ├── assets/
        │   ├── hosts.json            # generated copy of /adblock/hosts.json
        │   └── inject.js             # generated copy of /adblock/inject.js
        ├── java/app/tube/
        │   └── MainActivity.kt       # WebView + blocking + injection
        └── res/
            ├── values/{strings,colors,themes}.xml
            ├── drawable/ic_launcher_foreground.xml
            ├── mipmap-anydpi-v26/ic_launcher.xml   # adaptive icon (API 26+)
            └── mipmap/ic_launcher.xml              # layer-list fallback (API 24-25)
```

---

## How `MainActivity.kt` works (key logic)

- Full-screen edge-to-edge `WebView` set as the content view; a
  `Theme.AppCompat.DayNight.NoActionBar` theme removes the title bar and a black
  window background avoids a white flash.
- `WebSettings`: `javaScriptEnabled`, `domStorageEnabled`,
  `mediaPlaybackRequiresUserGesture = false` (so playback can start),
  `useWideViewPort` + `loadWithOverviewMode`, `MIXED_CONTENT_NEVER_ALLOW`, and a
  current mobile Chrome user-agent so YouTube serves the phone site.
- **Blocklist**: `hosts.json` is read from assets at startup into a
  `List<String>`. `shouldInterceptRequest(view, request)` returns an empty
  `WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))`
  when `request.url.toString()` contains any blocklist substring, else `null`.
- **Injection at document-start**: if
  `WebViewFeature.isFeatureSupported(DOCUMENT_START_SCRIPT)`, the app calls
  `WebViewCompat.addDocumentStartJavaScript(webView, injectScript, setOf("*"))`
  **before** the first `loadUrl`. On older WebViews without that feature, it
  falls back to `evaluateJavascript` in `onPageStarted` (document-start-ish).
- Loads `https://m.youtube.com`.
- **Back button**: an `OnBackPressedCallback` calls `webView.goBack()` while
  `canGoBack()`, otherwise defers to the default (finish) behaviour.
- **Cookies persist**: `CookieManager.setAcceptCookie(true)` +
  `setAcceptThirdPartyCookies(webView, true)`, flushed in `onDestroy`, so Google
  login sticks across restarts.
- State is saved/restored via `webView.saveState`/`restoreState` so rotation and
  process death don't reload from scratch.

---

## Known limitations & notes

- **Ad-block is an arms race.** YouTube changes its player payloads frequently.
  The json-prune approach here is robust against most rollouts but any given day
  a new format can slip an ad through until `/adblock/inject.js` is updated. When
  that happens, update the shared core and re-run `scripts/sync-adblock.mjs`.
- **Neutral naming for trademark reasons.** The app is named "Tube" and the
  package is `app.tube` deliberately — it is an unofficial personal wrapper, not
  affiliated with or endorsed by YouTube/Google, and must not use their marks.
- **Personal use.** This wrapper is intended for your own device. It is not
  suitable for distribution on Google Play (both the trademark and the
  ad-block-on-YouTube policy make that a non-starter).
- **WebView version matters.** `addDocumentStartJavaScript` needs a reasonably
  recent Android System WebView (Chrome 83+ era). On very old devices the
  `onPageStarted` fallback runs slightly later, so the very first frames of the
  first navigation could theoretically slip an ad; in practice the network-layer
  block covers those.
