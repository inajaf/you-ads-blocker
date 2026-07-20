---
name: desktop-guide-harness
description: How to hand-test the injected desktop back-arrow/guide UI (extension/desktop-guide-ui.js) in the Playwright MCP browser, since the extension can't be loaded directly
metadata:
  type: project
---

The extension isn't loadable into the MCP browser directly. To hand-test `extension/desktop-guide-ui.js` (back button, first-run guide, Studio nav container) against real rendered DOM, use `mcp__playwright__browser_run_code_unsafe` (full Playwright `page` access) rather than the high-level MCP tools, and:

- Serve fake `www.youtube.com` / `studio.youtube.com` pages via **context-level** `context.route(...)`, registered *before* triggering any navigation to those hosts. A route added only on the page object, or added after a `window.open()` call has already fired, is too late — the popup's initial navigation hits the real network and lands on the real `studio.youtube.com`, which enforces Trusted Types and breaks `page.addScriptTag`.
- Inject the real extension source with `page.addScriptTag({ path: '.../extension/desktop-guide.js' })` / `addStyleTag({ path: ... })`, not by embedding file contents in a JS template literal — `desktop-guide-ui.js` itself contains backticks and `${}` (e.g. `confirmTitle: (label) => \`${label}?\``) that break naive string embedding. `require`/`fs` are not available inside `browser_run_code_unsafe`'s sandbox; use Playwright's own `path:` option instead.
- To simulate a genuinely "fresh surface" tab (e.g. YouTube Studio or the create-video upload popup, which the app comment says arrive with `history.length === 1`), open it with `window.open(url)` from inside the opener page and catch it via `context.waitForEvent('page')`. `context.newPage()` followed by `page.goto(url)` gives `history.length === 2` (the initial `about:blank` counts as an entry) and will NOT reproduce the fresh-surface code path — this cost a wasted test iteration.
- `TubeDesktopGuideUI.install()` auto-opens the first-run guide dialog whenever the stubbed storage's `getCompletedVersion()` resolves below `guide.VERSION`, and that dialog visually + pointer-events covers the back button. Pre-seed the stub storage to `{ v: guide.VERSION }` when the test target is the back button/nav, not the guide dialog itself.

**Why:** worth having on hand because this desktop-guide/back-navigation area is likely to be touched again (Studio nav, first-run guide changes), and rebuilding this harness from scratch each time wastes a full QA cycle on Playwright plumbing rather than the actual behavior under test.

**How to apply:** reuse this pattern (context-level route → window.open for fresh tabs / goto-goto for real-history tabs → addScriptTag with path → seed storage → click) whenever asked to hand-test `extension/desktop-guide-ui.js`, `extension/desktop-guide.js`, or anything installed via `TubeDesktopGuideUI.install()`.
