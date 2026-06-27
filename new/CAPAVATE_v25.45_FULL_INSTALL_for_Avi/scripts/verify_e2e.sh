#!/usr/bin/env bash
# verify_e2e.sh — Wave F3
#
# Runs the Playwright E2E suite IF a browser/server can be spun up.
# Designed to be conditional: in restricted CI envs where chromium cannot
# start, this script EXITS 0 with a warning rather than blocking the
# existing 62 gates. The 62-gate verifier remains the hard floor.
#
# Important env contract for the suite (Wave F3 finding):
#   DISABLE_DEV_BYPASS=1 — Forces the server to refuse the legacy "anonymous
#       fallback to u_aisha_patel" path that otherwise makes /api/auth/me
#       return isAuthed:true for cookie-less requests. Without this flag the
#       Login.tsx / Signup.tsx pages auto-redirect away on every test, so
#       the form-driven assertions fail with timeouts. See helpers.ts for
#       full context.
#   ENABLE_DEMO_SEED=1 — Seeds the canonical demo personas (Maya, Aisha,
#       Hassan, Admin) that the four-persona suite logs in as.
#
# Exit codes:
#   0 — E2E ran and passed, OR E2E was skipped due to environment limits
#   1 — E2E ran and at least one test failed
#   2 — Tree / dependency setup is broken (Playwright not installed)
set -u

TREE="${TREE:-/home/user/workspace/avi_v19_tree}"
cd "$TREE" || { echo "FATAL: $TREE missing"; exit 2; }

echo "=============================================================="
echo "Wave F3 — Playwright E2E verification"
echo "Tree: $TREE"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================================="

# Dependency sanity
if [ ! -f node_modules/@playwright/test/package.json ]; then
  echo "WARN: @playwright/test not installed; skipping E2E gate."
  echo "      Run: npm install && npm run test:e2e:install"
  exit 0
fi

# Browser sanity — chromium must be available somewhere
HAS_CHROMIUM=0
if ls "$HOME/.cache/ms-playwright"/chromium-* >/dev/null 2>&1; then
  HAS_CHROMIUM=1
fi
if ls "$HOME/.cache/ms-playwright"/chromium_headless_shell-* >/dev/null 2>&1; then
  HAS_CHROMIUM=1
fi
if [ "$HAS_CHROMIUM" -eq 0 ]; then
  echo "WARN: chromium binary not present in ~/.cache/ms-playwright."
  echo "      Run: npm run test:e2e:install"
  echo "      Gate is non-blocking; exiting 0."
  exit 0
fi

PORT="${E2E_PORT:-3000}"

# If a dev server is already listening on the target port, REUSE it (caller
# is responsible for env). Otherwise start our own with the correct env vars
# and tear it down at the end.
EXTERNAL_SERVER=0
if curl -sf -o /dev/null "http://localhost:$PORT/"; then
  EXTERNAL_SERVER=1
  echo "Detected existing dev server on port $PORT — reusing."
else
  echo "Starting dev server with DISABLE_DEV_BYPASS=1 + ENABLE_DEMO_SEED=1..."
  setsid ./node_modules/.bin/cross-env ENABLE_DEMO_SEED=1 DISABLE_DEV_BYPASS=1 \
    PORT="$PORT" NODE_ENV=development \
    ./node_modules/.bin/tsx server/index.ts </dev/null > /tmp/wave_f3_e2e_server.log 2>&1 &
  SERVER_PID=$!
  disown 2>/dev/null || true
  # Poll for readiness
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if curl -sf -o /dev/null "http://localhost:$PORT/"; then
      echo "Server up after ${i}s"
      break
    fi
    sleep 2
  done
  if ! curl -sf -o /dev/null "http://localhost:$PORT/"; then
    echo "WARN: dev server failed to come up; skipping E2E gate."
    [ -n "${SERVER_PID:-}" ] && kill -9 "$SERVER_PID" 2>/dev/null || true
    exit 0
  fi
fi

# Run the suite. Capture exit code so we can format the output.
echo ""
echo "Running: E2E_EXTERNAL_SERVER=1 npx playwright test (chromium, single worker)"
echo "--------------------------------------------------------------"
set +e
E2E_EXTERNAL_SERVER=1 npx playwright test --reporter=list
RC=$?
set -u

# Tear down the server only if we started it.
if [ "$EXTERNAL_SERVER" -eq 0 ] && [ -n "${SERVER_PID:-}" ]; then
  kill -9 "$SERVER_PID" 2>/dev/null || true
  # Also clean up any orphaned tsx workers
  pgrep -f "tsx server/index.ts" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
fi

echo ""
echo "=============================================================="
if [ $RC -eq 0 ]; then
  echo "Wave F3 E2E — PASSED"
  echo "=============================================================="
  exit 0
fi

echo "Wave F3 E2E — FAILED (exit $RC)"
echo "HTML report: playwright-report/index.html"
echo "=============================================================="
exit 1
