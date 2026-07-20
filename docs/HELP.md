# HELP — working with the AI setup in this repo

A practical guide to prompting Claude Code (and other AI tools) effectively in
this project. The rules themselves live in `AGENTS.md`; this file is about how
YOU use the setup.

## Starting a session

Claude automatically loads `CLAUDE.md` → `AGENTS.md`, so it already knows the
stack, commands, and rules. To pick up where you left off:

> Read docs/status.md and continue the remaining work

## Command cheat sheet

| Command | What it does |
|---|---|
| `/team-dev <goal>` | Full agent-team cycle: developer + reviewer + QA loop until goal reached, all bugs fixed, QA signs off after hand-testing the UI |
| `/ui-check` | Cyclic UI verification: run Playwright smoke tests, fix, re-run until green (max 5 iterations) |
| `/code-review` | Deep review of your working diff |
| `/security-review` | Security review of pending changes (use for proxy/extension changes) |
| `/mcp` | Approve/inspect MCP servers (Playwright must be approved once) |
| `/agents` | List available agents (ui-tester, code-reviewer, qa-tester) |
| Shift+Tab | Plan mode — design before building |

Terminal commands (also what "green" means — the Definition of Done):

```bash
npm test                # unit tests (node:test)
npm run build           # typecheck + production build
./scripts/ui-check.sh   # Playwright UI smoke (starts dev server itself)
```

## How to prompt well

**1. Bugs — give symptom, location, expectation.** The more concrete the repro,
the faster the fix:

> Bug: on /watch, seeking past the buffered range freezes the player.
> Expected: it should buffer and resume. Happens in Chrome, dev server.

Weak: "the player is broken, fix it".

**2. Features — give the goal and the constraints, not the implementation:**

> Add a "watch later" queue: add/remove from video cards, persists like the
> library does, shows on /library under a new tab. Keep the extension untouched.

Claude picks the implementation; you review the plan (use plan mode for
anything non-trivial).

**3. Scope decides the tool:**
- Small fix or question → plain prompt.
- Multi-step feature → plan mode first, then build.
- "Grind until everything works and is verified" → `/team-dev <goal>`.
- "Just verify the UI" → `/ui-check`.
- "Test it like a human" → `Run the qa-tester agent on <pages/flows>`.

**4. Reference real things.** File paths (`src/player/…`), routes (`/watch`),
test names — anchors beat descriptions.

**5. State what must NOT change.** "Don't touch the proxy allowlist",
"keep the extension manifest permissions as-is" — constraints prevent
well-meaning collateral edits.

**6. End of a work chunk:** ask for the DoD explicitly if it wasn't run:

> Run the Definition of Done and update docs/status.md

## What happens automatically (don't re-ask for these)

- Code review is delegated to the code-reviewer agent before commits.
- UI changes trigger the ui-tester loop.
- Pushes to main are blocked by a hook — work lands via branch + PR.
- `.env`/secrets are permission-denied to the AI.
- `docs/status.md` gets updated at the end of tasks; `docs/decisions.md`
  records architectural choices.

## Memory: what persists between sessions, and how

Three layers, from repo-visible to personal:

1. **`docs/status.md` + `docs/decisions.md`** (in git) — shared, cross-tool
   memory. Any AI tool reads them at session start and updates them after
   tasks. This is the layer teammates and other tools see.
2. **Agent memories** (managed by Claude Code, outside the repo) — ui-tester,
   code-reviewer, and qa-tester each keep their own MEMORY.md; created
   automatically on first run. They accumulate bug patterns and fragile spots,
   so the agents get sharper over time.
3. **Claude's project memory graph** (outside the repo) — one file per fact
   (a node) with a one-line description, connected by `[[wiki-links]]` (edges),
   indexed by a MEMORY.md that loads each session. Nodes are saved when
   something durable and non-obvious is learned — your preferences,
   corrections, decisions that aren't visible in the code — not after every
   message. Ask "remember that …" to add a node explicitly.

## Graphify — the code knowledge graph

The repo is indexed into a queryable graph at `graphify-out/graph.json`
(631 nodes / 1033 edges: files, functions, components, types, and their
`contains` / `imports` / `calls` relationships, grouped into communities).
It's gitignored and rebuilds itself.

**How nodes are saved and connected:** extraction is AST-based (tree-sitter) —
each source file becomes nodes for the file and its functions/components/types,
and edges are created from real code relationships, labeled `EXTRACTED`
(read from the code) vs `INFERRED`. It does NOT update after every chat
request; it updates on **every git commit** (post-commit hook, incremental,
changed files only, no API cost) and on **branch switches** (post-checkout
hook). To rebuild manually: `graphify . --code-only --update`.

**Using it:**

```bash
graphify query "playback policy"        # BFS context around matching nodes
graphify query "shield" --dfs           # trace a specific path
graphify path "WatchPage" "client.ts"   # shortest path between two concepts
graphify explain "pipedProxyPlugin"     # one node + its exact edges
```

Queries are lexical (no API key configured), so use code-ish terms — file,
function, or component names — not full sentences. In a fresh Claude session,
`/graphify` invokes the skill; Claude also consults the graph automatically for
architecture questions. Open `graphify-out/graph.html` in a browser for the
interactive visualization.

Docs and images are currently NOT in the graph (needs an LLM API key for
semantic extraction of non-code files). If you ever set e.g. `GEMINI_API_KEY`,
rerun `graphify .` to add them and get named communities.

## Troubleshooting

- **"Push to main is blocked"** — intended. Create a branch, push it, open a PR.
- **QA/ui-tester can't drive the browser** — run `/mcp` and approve `playwright`.
- **`/team-dev` says teams unavailable** — restart Claude Code (the env var
  loads at startup); it falls back to subagents meanwhile.
- **Smoke tests flaky on network errors** — dev-environment network noise is
  already filtered in `tests/ui/smoke.spec.ts` (`IGNORED_CONSOLE`); add a
  pattern there only for noise, never to hide a real bug.
- **New route added?** Add it to the `pages` array in `tests/ui/smoke.spec.ts`.
