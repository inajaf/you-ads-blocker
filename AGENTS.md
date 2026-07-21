# You Ads Blocker (Noirva)

Cinema-dark React PWA for browsing videos with best-effort ad filtering and no API keys.

## Stack

| Layer | Location | Notes |
|-------|----------|-------|
| UI | `src/` | React 19, TypeScript strict, Vite PWA, HLS.js, IndexedDB |
| Landing | `src/landing/` | Marketing page at `/` (own scoped CSS + fonts); also the GitHub Pages bundle |
| Proxy | `vite-plugin-proxy.ts` + `server/` | Media proxy with allowlisted hosts; also `netlify/` functions |
| Extension | `extension/` | Chrome Manifest V3 ad-block companion (Noirva Shield) |
| Desktop | `desktop/` | Chrome App Mode wrapper |
| Android | `android/` | Native WebView wrapper backed by `adblock/` |

**Routing:** `/` is the public landing page; the video app lives under `/app`
via `<BrowserRouter basename="/app">` (see `src/appRoutes.ts` and
`docs/decisions.md`). Internal app links stay absolute (`to="/search"`) — the
basename prefixes them. `npm run build:pages` builds the landing-only static
bundle (base `/you-ads-blocker/` → `dist-pages/`) deployed to GitHub Pages by
`.github/workflows/pages.yml`; `npm run build` (Netlify, full SPA) is separate.

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

- Landing page downloads (`src/landing/platforms.ts`) link via
  `releases/latest/download/<filename>` — never pin a version tag. Release
  asset filenames must stay stable across versions (see `docs/decisions.md`,
  2026-07-21) or the landing page's download links 404.
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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
