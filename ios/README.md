# AdVoid — iOS WebView wrapper

A minimal native iOS app that loads the **real** `m.youtube.com` full-screen
(no browser chrome — looks like the YouTube app) and blocks ads **Brave-style**,
using the exact same ad-block core as the browser extension, desktop app, and
Android wrapper.

Two layers of blocking, both consumed from `/adblock` (single source of truth):

1. **Network layer** — `WKNavigationDelegate.decidePolicyFor` cancels any
   request whose URL contains a substring from `Resources/hosts.json` (doubleclick,
   `/pagead/`, `/api/stats/ads`, …).
2. **Page layer** — `WKUserScript` injects `Resources/inject.js` at document-end
   in the main world, stripping `adPlacements` / `playerAds` / `adSlots` out of
   player responses before ads can be scheduled. It logs
   `[AdVoid Shield] page hooks active`.

You stay logged into your Google account; subscriptions, history and
recommendations are untouched.

---

## Prerequisites

- **Xcode 15+** (with iOS 17+ SDK)
- **CocoaPods** or **Swift Package Manager** (no external dependencies needed)
- **Node.js** (only needed to re-sync the ad-block assets — optional; copies are
  already committed)

---

## Setup

1. Sync the ad-block assets (already committed, only needed after editing `/adblock/`):

   ```sh
   cd ios
   node scripts/sync-adblock.mjs
   ```

2. Open the Xcode project:

   ```sh
   open AdVoid/Noirva.xcodeproj
   ```

3. Select your development team in **Signing & Capabilities**.

4. Build and run on a simulator or device (⌘R).

---

## Verifying the ad-block works

1. Run the app and open an ad-heavy video (music videos and long uploads are
   good tests). There should be **no pre-roll ad** and no mid-roll interruptions.

2. In Xcode, check the console for `[AdVoid Shield] page hooks active` — this
   confirms the inject script is running.

3. For deeper inspection, enable the Web Inspector:
   - On your device: Settings → Safari → Advanced → Web Inspector (ON)
   - On Mac: Safari → Develop → [your device] → [AdVoid page]

---

## Project layout

```
ios/
├── scripts/
│   └── sync-adblock.mjs              # copies /adblock -> AdVoid/Resources
└── Noirva/
    ├── Noirva.xcodeproj              # Xcode project
└── AdVoid/
        ├── NoirvaApp.swift           # App entry point (SwiftUI)
        ├── ContentView.swift         # Root view
        ├── WebView.swift             # WKWebView wrapper with ad-blocking
        ├── AdBlocker.swift           # Asset loader + blocklist
        ├── Resources/
        │   ├── hosts.json            # generated copy of /adblock/hosts.json
        │   └── inject.js             # generated copy of /adblock/inject.js
        └── Assets.xcassets/          # App icons and colors
```

---

## How it works (key logic)

- **SwiftUI app** with a single `WKWebView` wrapped via `UIViewRepresentable`.
- **Network blocking**: `WKNavigationDelegate.decidePolicyFor` cancels requests
  matching any substring in `hosts.json`.
- **Page injection**: `WKUserScript` loads `inject.js` at document-end, patching
  `JSON.parse`, `fetch`, and `XHR` to strip ad placements from player responses.
- **Cookies persist**: `WKWebsiteDataStore.default()` retains cookies across
  restarts so Google login sticks.
- **Back navigation**: `allowsBackForwardNavigationGestures = true` enables
  swipe-to-go-back.

---

## Known limitations & notes

- **Ad-block is an arms race.** YouTube changes its player payloads frequently.
  The json-prune approach is robust but any given day a new format can slip an
  ad through until `inject.js` is updated.
- **WKUserScript injection time**: iOS WKWebView does not support true
  `document-start` injection via public API. The script runs at
  `document-end` (`atDocumentEnd`) which is early enough in practice — YouTube's
  player scripts load after the DOM is ready.
- **Neutral naming for trademark reasons.** The app is named "AdVoid". It is an
  unofficial personal wrapper, not affiliated with or endorsed by YouTube/Google.
- **Personal use.** This wrapper is intended for your own device. It is not
  suitable for distribution on the App Store (ad-block-on-YouTube policy).
