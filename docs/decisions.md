# Architectural decisions

<!-- Format: ## YYYY-MM-DD — Decision
Reason: ...
Alternatives: ... -->

## 2026-08-01 — Desktop tabs: one `WebContentsView` per tab, shared session
Reason: Browser-style multi-tab support. `BrowserWindow`-based tabs would each need their own window chrome; a `WebContentsView` per tab keeps all tabs inside one window with an in-window strip, and shares `session.defaultSession` so a single sign-in cookie store applies to every tab.
Approach: each tab is a `WebContentsView` (`contextIsolation: true`, `sandbox: false`, `nodeIntegration: false`, `backgroundThrottling: false`) managed by `desktop/tab-model.js`; the strip is a separate `WebContentsView` below `STRIP_HEIGHT = 42`; `desktop/tab-ipc.js` bridges strip clicks to the main process.
Alternatives: (a) one `BrowserWindow` per tab with hidden windows — heavy, no shared UI; (b) a single `WebContentsView` with SPA-tab state — can't isolate ad blocking or page crashes per tab.

## 2026-08-01 — Chrome click conventions for tabs, plus a native context menu
Reason: Users expect browser behaviour: plain click navigates in place, Cmd/Ctrl/middle-click opens a new tab, right-click offers Open-in-new-tab. Earlier builds hijacked video-URL full navigations into new tabs, which was surprising.
Approach: `desktop-tab-open.js` intercepts capture-phase `click`/`auxclick` — `button === 1` (middle) or `button === 0` with `meta||ctrl` (no shift/alt) → open new tab; everything else passes through. A native right-click menu (`desktop/tab-context-menu.js` + `contents.on('context-menu')` → `Menu.popup()`) provides Open in New Tab, Copy Link Address/Copy selection, Back/Forward/Reload. macOS needs this wiring manually — Electron shows no menu otherwise.
Alternatives: (a) a custom HTML context menu — needs positioning/hide-on-outside-click logic, less native-feeling; (b) keeping the old will-navigate hijack — surprising navigation, rejected.

## 2026-08-01 — Pre-roll ads pruned at write time via accessor properties
Reason: on full-page loads a polling hook (50ms `hookInitial()`) raced the player's first read of the inline `ytInitialPlayerResponse`, so a pre-roll sometimes leaked through on new-tab loads (old SPA flow pruned via wrapped fetch/XHR and was unaffected).
Approach: `adblock/inject.js` installs accessor properties on `ytInitialPlayerResponse`/`ytInitialData` so any assignment is JSON-pruned synchronously at write time — no poll, no race. Shared source consumed by desktop, android, and extension.
Alternatives: keep polling faster — still racy; wrap at a lower level (e.g. preload setter on the global) — not available across all consumers.

## 2026-08-01 — macOS Dock icon: padded rounded PNG via `app.dock.setIcon` (dev/test); `.icns`/`.ico` for packaging
Reason: `BrowserWindow.icon` doesn't control the macOS Dock (needs an `.icns` via `build.mac.icon` when packaged), so dev/test launches showed the default Electron icon. A first rounded variant was full-bleed (glyph 100% of canvas) and the Dock rendered it noticeably larger than neighbouring apps.
Approach: `app.dock.setIcon(resolveProjectPath('assets/brand/noirva-logo-v2-rounded-512.png'))` (darwin-gated), where the PNG is the squircle-masked glyph scaled to 80% of the canvas (410px centered in 512, 51px transparent margin/side) so macOS scales it to the same apparent size as neighbouring icons. Packaged `.icns`/`.ico` are unchanged and render correctly.
Alternatives: (a) skip `setIcon` and accept the Electron icon in dev — poor DX; (b) generate a padded `.icns` for dev — overkill; the PNG is enough for a dev/test icon.

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
