# Project memory (Claude Code)

Core project rules: @AGENTS.md

## Claude Code only

- Code review → proactively delegate to the code-reviewer subagent before committing.
- Changed UI → proactively delegate to the ui-tester subagent (or /ui-check).
- A hook blocks pushing to main — use a branch + PR, don't bypass it.
- Full feature/bugfix cycles → /team-dev <goal>: agent team (developer + reviewer + qa)
  loops until the goal is reached, all bugs fixed, and QA signs off after
  hand-testing the UI/UX in a real browser.
