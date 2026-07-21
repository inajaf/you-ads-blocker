#!/usr/bin/env bash
# Universal UI check — runnable by any agent (Claude/Codex/Kimi/Grok) or CI.
# Exit 0 = green. Exit != 0 = problems; details in output and playwright-report/.
# Playwright itself starts (or reuses) the Vite dev server via playwright.config.ts.
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"

echo "==> UI check against $BASE_URL"
BASE_URL="$BASE_URL" npx playwright test --reporter=list
code=$?

if [ $code -eq 0 ]; then
  echo "==> UI GREEN ✔"
else
  echo "==> UI RED ✘ — see output above and playwright-report/ (failure traces)" >&2
fi
exit $code
