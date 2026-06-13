#!/usr/bin/env bash
# =============================================================================
# Capavate v23.2 — install verifier (Avi-proof)
# =============================================================================
# Run AFTER deploying / installing. Prints PASS / WARN / FAIL for every check
# Avi needs to confirm before the deploy can be called "done".
#
# Exit codes:
#   0 — every check PASSed (warnings allowed)
#   1 — at least one FAIL (deploy is NOT safe; fix and re-run)
#
# Safe to re-run. Doesn't modify state. Doesn't touch math-sacred code.
# Compatible with macOS bash 3.2+ and Linux bash 4+.
# =============================================================================
set -uo pipefail
# NOTE: intentionally NOT using `set -e` — we want to keep checking after a
# failure so Avi sees the full picture in one pass.

# ----- pretty output --------------------------------------------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  C_GREEN="$(tput setaf 2)"; C_YELLOW="$(tput setaf 3)"; C_RED="$(tput setaf 1)"
  C_BLUE="$(tput setaf 4)"; C_BOLD="$(tput bold)"; C_RESET="$(tput sgr0)"
else
  C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
FIX_NOTES=()

pass()  { echo "  ${C_GREEN}PASS${C_RESET}  $1"; PASS_COUNT=$((PASS_COUNT+1)); }
warn()  { echo "  ${C_YELLOW}WARN${C_RESET}  $1"; WARN_COUNT=$((WARN_COUNT+1));
          [ "${2:-}" != "" ] && FIX_NOTES+=("${C_YELLOW}WARN${C_RESET} $2"); }
fail()  { echo "  ${C_RED}FAIL${C_RESET}  $1"; FAIL_COUNT=$((FAIL_COUNT+1));
          [ "${2:-}" != "" ] && FIX_NOTES+=("${C_RED}FAIL${C_RESET} $2"); }
section(){ echo ""; echo "${C_BOLD}${C_BLUE}== $1 ==${C_RESET}"; }
info()   { echo "  ${C_BLUE}info${C_RESET}  $1"; }

# ----- locate repo root -----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo "${C_BOLD}Capavate v23.2 — install verifier${C_RESET}"
echo "Repo root: $ROOT"
echo "Host:      $(uname -s) $(uname -m)"
echo "Node:      $(command -v node >/dev/null 2>&1 && node --version || echo 'NOT INSTALLED')"
echo "npm:       $(command -v npm  >/dev/null 2>&1 && npm  --version || echo 'NOT INSTALLED')"

# Load .env into the script's environment.
# Be defensive about CRLF line endings (a classic Windows-edited .env footgun):
# strip \r before sourcing, otherwise PORT="5000\r" breaks URLs and the server.
ENV_HAS_CRLF=0
if [ -f .env ]; then
  if grep -q $'\r' .env 2>/dev/null; then
    ENV_HAS_CRLF=1
    # Source from a sanitized temp copy so the script's own env is clean.
    _ENV_TMP="$(mktemp -t avi_env.XXXXXX)"
    tr -d '\r' < .env > "$_ENV_TMP"
    set -o allexport
    # shellcheck disable=SC1090
    . "$_ENV_TMP" 2>/dev/null || true
    set +o allexport
    rm -f "$_ENV_TMP"
  else
    set -o allexport
    # shellcheck disable=SC1091
    . ./.env 2>/dev/null || true
    set +o allexport
  fi
fi

# ===========================================================================
# 1. BUILD ARTIFACTS
# ===========================================================================
section "1. Build artifacts"

[ -f dist/index.cjs ] \
  && pass "dist/index.cjs present ($(wc -c < dist/index.cjs | tr -d ' ') bytes)" \
  || fail "dist/index.cjs missing — server not built" "Run: npm run build"

[ -f dist/public/index.html ] \
  && pass "dist/public/index.html present" \
  || fail "dist/public/index.html missing — client not built" "Run: npm run build"

if [ -d migrations ]; then
  MIG_COUNT=$(ls migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  if [ "$MIG_COUNT" -ge 50 ]; then
    pass "migrations/ contains $MIG_COUNT SQL files (expected >= 50)"
  else
    fail "migrations/ contains only $MIG_COUNT files (expected >= 50)" \
         "Re-extract capavate_v23.2_FINAL_24_may.zip — you have an incomplete copy"
  fi
else
  fail "migrations/ directory missing" "Re-extract the full zip"
fi

[ -f scripts/seed_demo.ts ] \
  && pass "scripts/seed_demo.ts present" \
  || fail "scripts/seed_demo.ts missing" "Re-extract the zip"

[ -f server/db/migrate.ts ] \
  && pass "server/db/migrate.ts present (Wave A migration runner)" \
  || fail "server/db/migrate.ts missing — old zip!" \
          "Re-download capavate_v23.2_FINAL_24_may.zip from Ozan"

if [ -f package.json ]; then
  if grep -q '"db:migrate"' package.json && grep -q '"db:seed:demo"' package.json; then
    pass "package.json declares db:migrate + db:seed:demo scripts"
  else
    fail "package.json missing db:migrate or db:seed:demo script" "Re-extract the zip"
  fi
else
  fail "package.json missing" "Re-extract the zip"
fi

if [ -f .env ]; then
  pass ".env file present"
  if [ "$ENV_HAS_CRLF" = "1" ]; then
    warn ".env has CRLF line endings (looks like it was edited on Windows)" \
         "Run: sed -i 's/\\r//' .env   (CRLF breaks PORT, URLs and the server)"
  fi
  # warn if any required values still look like placeholders
  if grep -Eq '^(STRIPE_SECRET_KEY|AIRWALLEX_API_KEY)=(sk_test_REPLACE|pk_live_REPLACE|REPLACE_ME|change_me)' .env 2>/dev/null; then
    warn ".env contains placeholder values (REPLACE_ME / change_me / sk_test_REPLACE)" \
         "Edit .env and replace placeholders before going live"
  fi
else
  fail ".env file missing — server will not start correctly" \
       "Run: cp .env.example .env  then edit values"
fi

# ===========================================================================
# 2. ENV VARS
# ===========================================================================
section "2. Environment variables"

IS_PROD=0
if [ "${NODE_ENV:-development}" = "production" ]; then IS_PROD=1; fi

# NODE_ENV
case "${NODE_ENV:-}" in
  production)  pass "NODE_ENV=production" ;;
  development|"") warn "NODE_ENV=${NODE_ENV:-<unset>} (OK for staging; FAIL for prod)" ;;
  *)           warn "NODE_ENV=${NODE_ENV} (unusual)" ;;
esac

# DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  warn "DATABASE_URL not set → app falls back to SQLite ./data.db" \
       "Production should use Postgres — set DATABASE_URL=postgres://..."
else
  if echo "${DATABASE_URL}" | grep -Eq '^postgres(ql)?://'; then
    pass "DATABASE_URL is set (Postgres)"
  else
    pass "DATABASE_URL is set (${DATABASE_URL%%:*})"
  fi
fi

# SESSION_SECRET
if [ -z "${SESSION_SECRET:-}" ]; then
  fail "SESSION_SECRET is empty — sessions will not work" \
       "Generate one: openssl rand -hex 32"
elif [ "${#SESSION_SECRET}" -lt 32 ]; then
  fail "SESSION_SECRET too short (${#SESSION_SECRET} chars; must be >= 32)" \
       "Generate a stronger one: openssl rand -hex 32"
else
  pass "SESSION_SECRET length ok (${#SESSION_SECRET} chars)"
fi

# JWT_SECRET — v25.17 Lane E NC1 / v25.18 hard close.
# Server REFUSES TO BOOT in production without this.
if [ -z "${JWT_SECRET:-}" ]; then
  if [ "$IS_PROD" = "1" ]; then
    fail "JWT_SECRET is empty — server will refuse to boot in production" \
         "Generate one: openssl rand -hex 32   (then add JWT_SECRET=... to .env)"
  else
    warn "JWT_SECRET unset (dev fallback ok; prod will refuse to boot)" \
         "Set JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo '<32+ random chars>') in .env"
  fi
elif [ "${#JWT_SECRET}" -lt 32 ]; then
  fail "JWT_SECRET too short (${#JWT_SECRET} chars; must be >= 32)" \
       "Generate a stronger one: openssl rand -hex 32"
else
  pass "JWT_SECRET length ok (${#JWT_SECRET} chars)"
fi

# v25.17 Lane E NH1 — if COLLECTIVE_WEBHOOK_URL is set, the secret is required
# (in production the server refuses to boot otherwise).
if [ -n "${COLLECTIVE_WEBHOOK_URL:-}" ] && [ -z "${COLLECTIVE_WEBHOOK_SECRET:-}" ]; then
  if [ "$IS_PROD" = "1" ]; then
    fail "COLLECTIVE_WEBHOOK_URL is set but COLLECTIVE_WEBHOOK_SECRET is empty — server will refuse to boot in production" \
         "Set COLLECTIVE_WEBHOOK_SECRET (same value used by your Collective inbound verifier)"
  else
    warn "COLLECTIVE_WEBHOOK_URL set without COLLECTIVE_WEBHOOK_SECRET (LIVE_MODE disabled in dev)" \
         "Set COLLECTIVE_WEBHOOK_SECRET to enable bridge LIVE_MODE"
  fi
fi

# DISABLE_DEV_BYPASS / ALLOW_DEV_BYPASS
if [ "$IS_PROD" = "1" ]; then
  [ "${DISABLE_DEV_BYPASS:-0}" = "1" ] \
    && pass "DISABLE_DEV_BYPASS=1 (prod-locked)" \
    || fail "DISABLE_DEV_BYPASS must be 1 in production (got '${DISABLE_DEV_BYPASS:-<unset>}')" \
            "Set DISABLE_DEV_BYPASS=1 in .env"
  [ "${ALLOW_DEV_BYPASS:-0}" = "0" ] \
    && pass "ALLOW_DEV_BYPASS=0 (prod-locked)" \
    || fail "ALLOW_DEV_BYPASS must be 0 in production (got '${ALLOW_DEV_BYPASS:-<unset>}')" \
            "Set ALLOW_DEV_BYPASS=0 in .env"
else
  info "DISABLE_DEV_BYPASS=${DISABLE_DEV_BYPASS:-0}  ALLOW_DEV_BYPASS=${ALLOW_DEV_BYPASS:-0} (dev — not strict)"
fi

# Feature flags
info "COLLECTIVE_ENABLED=${COLLECTIVE_ENABLED:-<unset>}"
info "CONSORTIUM_ENABLED=${CONSORTIUM_ENABLED:-<unset>}"

# Payment gateway
GATEWAY="${PAYMENT_GATEWAY_DEFAULT:-airwallex}"
if [ "$GATEWAY" = "airwallex" ]; then
  pass "PAYMENT_GATEWAY_DEFAULT=airwallex (Ozan's directive)"
elif [ "$GATEWAY" = "stripe" ]; then
  warn "PAYMENT_GATEWAY_DEFAULT=stripe (Ozan directed AirWallex)" \
       "Set PAYMENT_GATEWAY_DEFAULT=airwallex unless Ozan changed this"
else
  warn "PAYMENT_GATEWAY_DEFAULT='${GATEWAY}' (expected airwallex or stripe)"
fi

# AirWallex creds (required if gateway=airwallex)
if [ "$GATEWAY" = "airwallex" ]; then
  for v in AIRWALLEX_API_KEY AIRWALLEX_CLIENT_ID AIRWALLEX_WEBHOOK_SECRET; do
    val="${!v:-}"
    if [ -z "$val" ]; then
      if [ "$IS_PROD" = "1" ]; then
        fail "$v not set — AirWallex gateway will not work" \
             "See DEPLOY_FOR_AVI.md section 4 — get from AirWallex dashboard"
      else
        warn "$v not set (dev fallback OK)"
      fi
    else
      pass "$v set"
    fi
  done
fi

# Stripe creds (always needed for Collective subscription price IDs)
for v in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
         STRIPE_COLLECTIVE_BASIC_PRICE_ID STRIPE_COLLECTIVE_STANDARD_PRICE_ID \
         STRIPE_COLLECTIVE_PREMIUM_PRICE_ID; do
  val="${!v:-}"
  if [ -z "$val" ]; then
    if [ "$IS_PROD" = "1" ] && [ "${COLLECTIVE_ENABLED:-1}" = "1" ]; then
      fail "$v not set — Collective billing will fail" \
           "Get from https://dashboard.stripe.com — see DEPLOY_FOR_AVI.md section 4"
    else
      warn "$v not set (OK for dev / when Collective billing disabled)"
    fi
  else
    # Warn on test keys in prod
    if [ "$IS_PROD" = "1" ] && [ "$v" = "STRIPE_SECRET_KEY" ] && echo "$val" | grep -q '^sk_test_'; then
      warn "STRIPE_SECRET_KEY is a TEST key (sk_test_…) in production" \
           "Use sk_live_… in prod"
    fi
    pass "$v set"
  fi
done

# Sentry
if [ -z "${SENTRY_DSN:-}" ]; then
  warn "SENTRY_DSN not set — error tracking disabled" \
       "Recommended in prod. Get DSN from your Sentry project settings."
else
  pass "SENTRY_DSN set"
fi

# ===========================================================================
# 3. DB CONNECTIVITY
# ===========================================================================
section "3. Database connectivity"

DB_URL="${DATABASE_URL:-file:./data.db}"
DB_OK=0
if echo "$DB_URL" | grep -Eq '^postgres(ql)?://'; then
  # Try psql first; fall back to node-postgres via npx
  if command -v psql >/dev/null 2>&1; then
    if psql "$DB_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
      pass "Connected to Postgres and SELECT 1 returned"
      DB_OK=1
    else
      fail "Cannot connect to Postgres at \$DATABASE_URL" \
           "Check host/port/password and that the DB is reachable"
    fi
  else
    # Node fallback
    if node -e "
      const {Client} = require('pg');
      const c = new Client({connectionString: process.env.DATABASE_URL});
      c.connect().then(()=>c.query('SELECT 1')).then(()=>c.end()).then(()=>process.exit(0))
       .catch(e=>{console.error(e.message);process.exit(1);});
    " >/dev/null 2>&1; then
      pass "Connected to Postgres via node-pg"
      DB_OK=1
    else
      fail "Cannot connect to Postgres (psql + node-pg both failed)" \
           "Verify DATABASE_URL and DB is up"
    fi
  fi
else
  # SQLite (file)
  SQLITE_FILE="${DB_URL#file:}"
  [ "$SQLITE_FILE" = "$DB_URL" ] && SQLITE_FILE="./data.db"
  if node -e "
    try {
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[1], { fileMustExist: false });
      const r = db.prepare('SELECT 1 AS one').get();
      if (r && r.one === 1) process.exit(0);
      process.exit(2);
    } catch(e){ console.error(e.message); process.exit(1); }
  " "$SQLITE_FILE" >/dev/null 2>&1; then
    pass "SQLite reachable at $SQLITE_FILE, SELECT 1 OK"
    DB_OK=1
  else
    fail "Cannot open SQLite file $SQLITE_FILE" \
         "Ensure file is writable; remove any stale data.db-shm/data.db-wal locks"
  fi
fi

# ===========================================================================
# 4. MIGRATIONS APPLIED
# ===========================================================================
section "4. Migrations applied"

if [ "$DB_OK" = "1" ] && [ -d migrations ]; then
  TOTAL_MIG=$(ls migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  if echo "$DB_URL" | grep -Eq '^postgres(ql)?://'; then
    APPLIED_LIST=$(node -e "
      const {Client}=require('pg');
      (async ()=>{
        const c=new Client({connectionString:process.env.DATABASE_URL});
        await c.connect();
        let rows=[];
        try { const r = await c.query(\"SELECT name FROM __drizzle_migrations_applied\"); rows=r.rows.map(x=>x.name); }
        catch(e){ /* table may not exist yet */ }
        await c.end();
        console.log(rows.join('\\n'));
      })().catch(e=>{console.error(e.message);process.exit(1);});
    " 2>/dev/null || echo "")
  else
    SQLITE_FILE="${DB_URL#file:}"
    [ "$SQLITE_FILE" = "$DB_URL" ] && SQLITE_FILE="./data.db"
    APPLIED_LIST=$(node -e "
      try {
        const Database = require('better-sqlite3');
        const db = new Database(process.argv[1], { fileMustExist: false });
        let rows=[];
        try { rows = db.prepare('SELECT name FROM __drizzle_migrations_applied').all().map(r=>r.name); }
        catch(e){}
        console.log(rows.join('\\n'));
      } catch(e){ process.exit(1); }
    " "$SQLITE_FILE" 2>/dev/null || echo "")
  fi

  MISSING_LIST=""
  MISSING_COUNT=0
  APPLIED_COUNT=0
  for f in migrations/*.sql; do
    base="$(basename "$f")"
    if echo "$APPLIED_LIST" | grep -Fxq "$base"; then
      APPLIED_COUNT=$((APPLIED_COUNT+1))
    else
      MISSING_LIST="${MISSING_LIST}    - $base\n"
      MISSING_COUNT=$((MISSING_COUNT+1))
    fi
  done

  if [ "$MISSING_COUNT" = "0" ]; then
    pass "All $TOTAL_MIG migrations applied"
  else
    fail "$MISSING_COUNT of $TOTAL_MIG migrations not yet applied" \
         "Run: npm run db:migrate"
    printf "$MISSING_LIST" | head -10
    [ "$MISSING_COUNT" -gt 10 ] && echo "    ... ($((MISSING_COUNT-10)) more)"
  fi
else
  warn "Skipping migration check (DB not reachable or migrations/ missing)"
fi

# ===========================================================================
# 5. SERVER STARTS
# ===========================================================================
section "5. Server starts + responds"

SERVER_PORT="${PORT:-5000}"
SERVER_LOG="$(mktemp -t avi_verifier_server.XXXXXX.log)"
SERVER_PIDFILE="$(mktemp -t avi_verifier_server.XXXXXX.pid)"

cleanup_server() {
  # Kill any node process bound to our port we may have started
  if [ -s "$SERVER_PIDFILE" ]; then
    while read -r pid; do
      [ -n "$pid" ] || continue
      kill -TERM "$pid" 2>/dev/null || true
    done < "$SERVER_PIDFILE"
    sleep 1
    while read -r pid; do
      [ -n "$pid" ] || continue
      kill -KILL "$pid" 2>/dev/null || true
    done < "$SERVER_PIDFILE"
  fi
  # Belt-and-suspenders: kill anything that looks like our built server
  pkill -KILL -f 'node dist/index.cjs' 2>/dev/null || true
  rm -f "$SERVER_PIDFILE"
}
trap cleanup_server EXIT INT TERM

SERVER_OK=0
if [ -f dist/index.cjs ]; then
  info "Spawning: npm start  (port $SERVER_PORT, log $SERVER_LOG)"
  # Start in background. Use nohup so it survives if our shell gets a HUP.
  # We track the child PIDs by inspecting the port after spawn (more reliable
  # than $! when npm forks several children).
  # Detach STDIN (</dev/null) so npm doesn't inherit our pipe and stall waiting
  # for input on some terminals. Redirect stdout+stderr to the log file.
  nohup npm start </dev/null >"$SERVER_LOG" 2>&1 &
  echo "$!" > "$SERVER_PIDFILE"

  # Wait for the server to bind. Primary signal: the "serving on port" line
  # in the server log (deterministic, doesn't depend on network). Then we do
  # ONE confirmation HTTP probe with a longer timeout.
  HEALTH_OK=0
  LOG_SAW_LISTEN=0
  for i in $(seq 1 60); do
    sleep 1
    if grep -qE 'serving on port|listening on' "$SERVER_LOG" 2>/dev/null; then
      LOG_SAW_LISTEN=1
      break
    fi
  done
  [ "${AVI_VERIFIER_DEBUG:-0}" = "1" ] && echo "    [debug] LOG_SAW_LISTEN=$LOG_SAW_LISTEN after ${i}s"

  if [ "$LOG_SAW_LISTEN" = "1" ]; then
    # Give the route table a couple seconds to finish wiring up after bind.
    sleep 3
    if [ "${AVI_VERIFIER_DEBUG:-0}" = "1" ]; then
      echo "    [debug] port state: $(ss -ltn 2>/dev/null | grep -E ":${SERVER_PORT}\b" || echo 'NOT BOUND')"
      echo "    [debug] pids on port: $(lsof -ti tcp:${SERVER_PORT} 2>/dev/null | tr '\n' ' ' || true)"
    fi
    # Confirmation probe — try a few times in case the route guard takes a moment.
    for probe in 1 2 3 4 5; do
      curl_err=$(curl -sS -o /dev/null -4 --connect-timeout 3 --max-time 6 \
               -w '%{http_code}' "http://127.0.0.1:${SERVER_PORT}/api/healthz" 2>&1)
      code="${curl_err:-000}"
      [ "${AVI_VERIFIER_DEBUG:-0}" = "1" ] && echo "    [debug] confirm probe $probe → [$code]"
      if [ "$code" = "200" ]; then HEALTH_OK=1; break; fi
      sleep 2
    done
  fi

  # Record any PIDs bound to our port for cleanup. lsof preferred; fall back to fuser/ss.
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"$SERVER_PORT" 2>/dev/null >> "$SERVER_PIDFILE" || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$SERVER_PORT" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' >> "$SERVER_PIDFILE" || true
  fi

  if [ "$HEALTH_OK" = "1" ]; then
    HEALTHZ_BODY=$(curl -sS -4 -m 3 "http://127.0.0.1:${SERVER_PORT}/api/healthz" 2>/dev/null || echo "")
    if echo "$HEALTHZ_BODY" | grep -q '"ok":true'; then
      pass "Server started + /api/healthz returned ok:true"
      SERVER_OK=1
    else
      fail "/api/healthz responded but did not contain ok:true"
      echo "    Body: $(echo "$HEALTHZ_BODY" | head -c 200)"
    fi
  else
    fail "Server didn't respond on http://localhost:${SERVER_PORT}/api/healthz within 60s" \
         "Inspect log: $SERVER_LOG  (also try: npm start manually)"
    echo "    --- last 20 lines of server log ---"
    tail -20 "$SERVER_LOG" 2>/dev/null | sed 's/^/    /'
  fi
else
  fail "dist/index.cjs missing — cannot test server" "Run: npm run build"
fi

# ===========================================================================
# 6. CRITICAL ENDPOINTS
# ===========================================================================
section "6. Critical endpoints"

check_endpoint() {
  local method="$1" path="$2" expect="$3" label="$4" data="${5:-}"
  local url="http://127.0.0.1:${SERVER_PORT}${path}"
  local code
  if [ "$method" = "POST" ]; then
    code=$(curl -s -o /dev/null -4 --max-time 8 -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' --data "$data" "$url" 2>/dev/null)
  else
    code=$(curl -s -o /dev/null -4 --max-time 8 -w '%{http_code}' "$url" 2>/dev/null)
  fi
  code="${code:-000}"
  if echo "$expect" | grep -qw "$code"; then
    pass "$label  →  HTTP $code"
  else
    fail "$label  →  HTTP $code (expected $expect)"
  fi
}

if [ "$SERVER_OK" = "1" ]; then
  # /api/healthz — public liveness
  check_endpoint GET  /api/healthz                "200"     "GET /api/healthz (public liveness)"

  # /api/health — auth-gated detailed health. 200 (signed in) or 401 (anon)
  # both prove the route is wired and the auth middleware is working. 500 is bad.
  check_endpoint GET  /api/health                 "200 401" "GET /api/health (auth-gated; 200 or 401 both OK)"

  # Login with garbage creds — must NOT 500
  check_endpoint POST /api/auth/login             "400 401" \
                 "POST /api/auth/login (garbage creds → 400/401, not 500)" \
                 '{"email":"nobody@nowhere.xyz","password":"definitely_wrong"}'

  # Admin pricing tiers — 200 if seeded, 401/403 if anon
  check_endpoint GET  /api/admin/pricing-tiers    "200 401 403" "GET /api/admin/pricing-tiers"

  # Admin login HTML page (SPA route — hash-based, server returns shell)
  HTML=$(curl -sS -4 -m 5 "http://127.0.0.1:${SERVER_PORT}/" 2>/dev/null || echo "")
  if [ -n "$HTML" ] && echo "$HTML" | grep -qiE 'capavate|<!doctype|<html'; then
    pass "GET / (SPA shell) returns HTML (admin login loads client-side)"
  else
    warn "GET / did not return HTML — SPA admin login may not load"
  fi
else
  warn "Skipping endpoint checks (server didn't start)"
fi

# Stop the server before continuing
cleanup_server

# ===========================================================================
# 7. DEMO SEED AVAILABILITY
# ===========================================================================
section "7. Demo seed availability"

if [ -f scripts/seed_demo.ts ] && grep -q '"db:seed:demo"' package.json 2>/dev/null; then
  pass "scripts/seed_demo.ts + db:seed:demo npm script present"
  info "Run dev seed:  ENABLE_DEMO_SEED=1 npm run db:seed:demo"
else
  fail "Demo seed missing" "Re-extract the zip"
fi

# ===========================================================================
# FINAL REPORT
# ===========================================================================
echo ""
echo "${C_BOLD}============================================================${C_RESET}"
echo "${C_BOLD} VERIFIER SUMMARY${C_RESET}"
echo "${C_BOLD}============================================================${C_RESET}"
echo "  ${C_GREEN}PASS${C_RESET} : $PASS_COUNT"
echo "  ${C_YELLOW}WARN${C_RESET} : $WARN_COUNT"
echo "  ${C_RED}FAIL${C_RESET} : $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" = "0" ] && [ "$WARN_COUNT" = "0" ]; then
  echo "${C_GREEN}${C_BOLD}ALL GREEN — deploy is healthy.${C_RESET}"
elif [ "$FAIL_COUNT" = "0" ]; then
  echo "${C_YELLOW}${C_BOLD}PASS WITH WARNINGS — review the items above.${C_RESET}"
else
  echo "${C_RED}${C_BOLD}FAIL — do NOT consider this deploy done.${C_RESET}"
fi

if [ ${#FIX_NOTES[@]} -gt 0 ]; then
  echo ""
  echo "${C_BOLD}Suggested fixes (copy-paste):${C_RESET}"
  for n in "${FIX_NOTES[@]}"; do
    echo "  • $n"
  done
fi

echo ""
echo "${C_BOLD}Cheat sheet:${C_RESET}"
echo "  Missing migrations?   npm run db:migrate"
echo "  Empty dev DB?         ENABLE_DEMO_SEED=1 npm run db:seed:demo"
echo "  Rebuild bundle?       npm run build"
echo "  AirWallex env vars?   See DEPLOY_FOR_AVI.md section 4"
echo "  Full reinstall?       bash scripts/install_avi.sh"
echo ""

[ "$FAIL_COUNT" = "0" ] && exit 0 || exit 1
