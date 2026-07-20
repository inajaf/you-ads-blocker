# You Ads Blocker (Noirva)

Cinema-dark React PWA for browsing videos with best-effort ad filtering and no API keys.

## Stack

| Layer | Location | Notes |
|-------|----------|-------|
| UI | `src/` | React 19, TypeScript strict, Vite PWA, HLS.js, IndexedDB |
| Proxy | `vite-plugin-proxy.ts` + `server/` | Media proxy with allowlisted hosts; also `netlify/` functions |
| Extension | `extension/` | Chrome Manifest V3 ad-block companion (Noirva Shield) |
| Desktop | `desktop/` | Chrome App Mode wrapper |
| Android | `android/` | Native WebView wrapper backed by `adblock/` |

## Commands (gate: `npm test && npm run build`)

```bash
npm run dev             # Vite dev server on http://localhost:5173
npm test                # node:test unit tests (tests/*.test.mjs)
npm run build           # tsc -b && vite build
npm run build:extension # pack the browser extension
npx oxlint .            # lint (config in .oxlintrc.json)
./scripts/ui-check.sh   # UI check (Playwright, starts dev server itself)
```

## Code rules

- TypeScript in `src/`; extension/desktop code stays plain JS where it already is — match the file's existing style.
- No swallowed errors: handle promise rejections, log with context, never empty `catch`.
- Clean up side effects: abort fetches, remove listeners/observers in effect cleanup.
- Proxy/server code is security-sensitive: validate/allowlist target URLs (see `tests/proxy-security.test.mjs`), never proxy arbitrary hosts.
- No secrets or API keys in code or logs — the project's premise is "no API keys".
- New logic gets a unit test in `tests/*.test.mjs` (node:test).
- Commits: short imperative messages matching existing history. Work in a branch + PR; do not push to main.
- Forbidden: disabling or deleting failing tests to get green, reading/printing `.env` or secrets.

## UI check loop (mandatory after frontend changes)

Work in a loop until green, max 5 iterations:
1. `./scripts/ui-check.sh`
2. If red — read the output and `playwright-report/` fully, find the root cause,
   fix with the minimal change.
3. Back to step 1.
4. Not green after 5 iterations — stop and report the remaining problems.

Minimum checks: key pages respond 200, no console errors, no horizontal
scroll at 390px width.

## Memory between sessions (for any tool)

- Architectural decisions → `docs/decisions.md` (date + decision + reason).
- At the end of a task update `docs/status.md`: done / remaining / known issues.
- Start a new session by reading `docs/status.md` — continue, don't restart from zero.

## Definition of Done

`npm test && npm run build` — all green, changes in a branch, meaningful commit message.
UI check (`./scripts/ui-check.sh`) required after frontend changes.
