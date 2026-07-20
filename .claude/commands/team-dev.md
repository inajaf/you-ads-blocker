---
description: Full agent-team development cycle — plan → build → review → hands-on QA — looping until the goal is reached and all bugs are fixed
---

Run a complete development cycle as an agent team for: $ARGUMENTS
(If no goal was given, take the open items from docs/status.md.)

This requires agent teams (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1). If team
tools are not available in this session, say so and fall back to the subagent
flow (code-reviewer + qa-tester via the Agent tool) instead of silently doing
everything yourself.

## Setup
1. Read docs/status.md and AGENTS.md. Break the goal into concrete tasks in the
   shared task list.
2. Work on a feature branch — never on main.
3. Create a team with these roles:
   - **developer** — implements tasks, runs `npm test` after each change.
   - **reviewer** — reviews every change like the code-reviewer agent
     (correctness, proxy/extension security, tests); criticals go back to the
     developer as tasks.
   - **qa** — follows the qa-tester agent's playbook: hand-tests each affected
     functionality's UI/UX in a real browser via Playwright MCP, files bugs as
     tasks with repro steps and screenshots.

## The cycle (repeat until done)
1. Developer implements the next task; unit tests must pass.
2. Reviewer reviews the diff; 🔴 findings become tasks and block progress.
3. QA hand-tests every flow the change touches (full pass before final sign-off);
   each bug becomes a task assigned to the developer.
4. Fixes are retested by QA — a bug is closed only after retest.
5. Loop. If the same bug survives 5 fix attempts, stop the loop and report it
   to me instead of thrashing.

## Done means
- Goal reached, task list empty, no open 🔴/🟡 bugs.
- `npm test`, `npm run build`, and `./scripts/ui-check.sh` all green.
- QA has given explicit sign-off after a final full hand-test pass.
- docs/status.md updated (done / remaining / known issues).

Then show me the summary and propose a commit + PR — do NOT push to main, and
do not commit without my confirmation.
