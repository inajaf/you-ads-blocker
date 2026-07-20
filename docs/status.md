# Project status

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

## 2026-07-20 — Desktop app Google account pages support
- Fixed separate Chrome window opening on YouTube Account/Your data pages:
  added `parseTrustedGoogleAccountUrl` to `extension/desktop-window-guard.js`
  and extended `isAllowedDesktopAppTabUrl` to accept `accounts.google.com`
  and `myaccount.google.com`.
- Added back button on Google account pages: new content script entry in
  `manifest.json` for `*://accounts.google.com/*` and `*://myaccount.google.com/*`,
  new `extension/account-back.js` that detects Noirva desktop app mode and
  injects a fixed-position back button styled consistently with the existing UI.
- npm test 76/76, npm run build, npm run build:extension all green.

## Known issues
-
