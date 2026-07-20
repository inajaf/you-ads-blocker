---
name: crew
description: Firstmate-style parallel crew for this repo — dispatch several independent tasks at once, each crewmate in its own git worktree, ship (branch + PR) or scout (report only). Use /crew when the user lists multiple unrelated tasks; for ONE goal with a tight build→review→QA loop use /team-dev instead.
---

# /crew — parallel task crew (adapted from kunchenguid/firstmate)

Model: the main session is the **first mate** — the user's single point of
contact. It does not implement project work itself while a crew is live; it
dispatches, supervises, and reports. Crewmates do the work in isolation.

Adapted for Noirva: Claude Code agent teams + worktree isolation replace
firstmate's tmux windows and bash watchers; this repo's AGENTS.md rules and
Definition of Done replace firstmate's project modes (we are effectively
"direct-PR": a hook blocks pushing to main).

## Prime directives (ported from firstmate, binding)

1. While a crew is live, the first mate never edits project files —
   crewmates own all changes. (Exception: docs/status.md bookkeeping.)
2. Never merge or push without the user's explicit word. Proposing a
   commit/PR is the first mate's job; executing it needs confirmation.
3. Never tear down unlanded work: a worktree with uncommitted or unmerged
   changes is only discarded when the user explicitly says so.
4. Crewmates never address the user; everything flows through the first
   mate, who relays outcomes plainly — failures included, with evidence.

## Task shapes

- **ship** — delivers a change. Crewmate: general-purpose agent,
  `isolation: "worktree"`, follows AGENTS.md (plain JS in extension/,
  unit tests in tests/*.test.mjs, npm test green before done). Result:
  a commit-ready diff in its worktree, described to the first mate.
- **scout** — investigates, reproduces, plans, or audits; changes nothing.
  Crewmate: Explore or Plan agent (read-only). Result: a report the first
  mate relays (and saves to docs/ if durable).

## Dispatch protocol

1. Split the user's request into independent tasks; TaskCreate each with a
   full self-contained description (crewmates start cold). Mark shape
   ship/scout in the subject. Dependencies via addBlockedBy.
2. Spawn all independent crewmates **in one message** (parallel), named
   `ship-<slug>` / `scout-<slug>`, background. Ship tasks get
   `isolation: "worktree"`; scouts stay read-only in the main checkout.
3. Supervise: on each completion message, verify claims independently
   (run npm test / read the diff) before marking tasks completed.
4. Gates before proposing any ship result to the user: code-reviewer
   subagent on the diff; UI-touching diffs also get ui-tester or qa-tester
   (see CLAUDE.md). Findings become tasks back to the same crewmate
   (SendMessage resumes it with context).
5. Report: one summary per task — outcome, files, test results, and the
   proposed next action (commit/PR text ready). Then stop and await the
   user's word per directive 2.

## Definition of Done (unchanged from AGENTS.md)

`npm test && npm run build && ./scripts/ui-check.sh` green in the merged
result, docs/status.md updated, work on a branch, meaningful commits.
