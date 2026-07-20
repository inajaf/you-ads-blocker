---
description: Run the cyclic UI check (check → fix → re-check)
---

Delegate a full cyclic UI check to the ui-tester subagent.

Pass into its task:
- the list of changed files from `git diff --name-only HEAD` (if empty — full check of all key pages)
- the goal: $ARGUMENTS (if empty — standard full run)
- the requirement: work in a loop until green, max 5 iterations

After its report:
1. Show me a summary: checked / fixed / remaining.
2. If there were fixes — run `npm test && npm run build`.
3. Propose a commit with a meaningful message, but do NOT commit without my confirmation.
