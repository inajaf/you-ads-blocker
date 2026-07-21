# Project status

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
  new `extension/account-back.js` that detects Noirva desktop app mode and
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
