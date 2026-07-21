# Architectural decisions

<!-- Format: ## YYYY-MM-DD — Decision
Reason: ...
Alternatives: ... -->

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
(`Noirva-v1.0.0.apk`), but the real uploaded asset is named `app-release.apk`
(the `Noirva-v1.0.0.apk` text was only a GitHub release *label*, not the
filename). The macOS `.dmg` link happened to match and worked, but was pinned
to `v1.0.0` the same fragile way — any future version bump would 404 it too.
Approach: every download href in `src/landing/platforms.ts` now uses GitHub's
"latest release" URL convention —
`https://github.com/inajaf/you-ads-blocker/releases/latest/download/<filename>`
— which always resolves to whatever release is currently tagged latest, so a
version bump alone no longer breaks the link.
**Constraint this places on future releases: asset filenames must stay stable
across versions (e.g. always `app-release.apk` / `Noirva-1.0.0-arm64.dmg`,
never a version-numbered rename like `Noirva-1.1.0-arm64.dmg`).** The landing
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
