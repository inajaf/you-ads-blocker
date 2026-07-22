---
name: android-webview-patterns
description: Recurring risk patterns in android/AdVoid's WebView-injected JS (pull-to-refresh, CSS/JS injection on SPA nav)
metadata:
  type: project
---

`android/AdVoid/app/src/main/java/com/advoid/app/MainActivity.kt` wraps
`m.youtube.com` in a plain `android.app.Activity` WebView (no Jetpack/AppCompat),
with behavior-tweaking JS/CSS injected as Kotlin raw-string constants
(`VIDEO_WATCH_SCRIPT`, `PULL_REFRESH_SCRIPT`, `STYLE_SCRIPT`) re-run on every
`onPageFinished` **and** `doUpdateVisitedHistory` (YouTube is an SPA — most
navigation is `pushState`/`replaceState`, which never fires `onPageFinished`).

Two risk patterns worth checking on future changes to this file:

1. **JS-state vs. native-UI-state desync.** Injected scripts store gesture
   state on `window` (e.g. `window._advoidPull`) so it survives SPA nav, and
   the re-injection resets that state on every nav to avoid state leaking
   across pages. But if a nav-triggered reset clobbers state (e.g.
   `P.pulling`/`P.shown`) *while* the native side already reflects the old
   state (e.g. a `ProgressBar` made visible via a `@JavascriptInterface`
   call), nothing tells native to revert — the visible-but-orphaned UI stays
   stuck until the next full gesture cycle. When reviewing changes to
   `PULL_REFRESH_SCRIPT`-style code: check whether every JS state reset that
   crosses a native-visible boolean (`shown`, `visible`, etc.) also fires the
   matching bridge call to keep native in sync, not just the JS variable.

2. **CSS selector-list fragility from mixing modern/legacy selectors.**
   `STYLE_SCRIPT` puts a `:has()` selector in the same comma-separated rule
   as plain attribute selectors. One unsupported/unparseable selector in a
   (non-forgiving) CSS selector list invalidates the *entire* rule, not just
   that selector — so pairing a bleeding-edge pseudo-class with basic
   selectors risks silently breaking the basic ones too on older WebView.
   Flag this combination if seen again; the fix is to give newer pseudo-class
   selectors (`:has()`, `:is()` used non-forgivingly, etc.) their own
   separate rule block.

Both patterns showed up together in the 2026-07-22 review of the
pull-to-refresh / Open-App-upsell / back-button fixes
([[code-reviewer-index]]) — worth re-checking if `PULL_REFRESH_SCRIPT` or
`STYLE_SCRIPT` change again.
