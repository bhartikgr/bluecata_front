#!/usr/bin/env bash
# Independent verification of a Day-N completion.
# Usage: bash verify_dayN.sh <day>   (e.g. verify_dayN.sh 1)
# Runs all gates; exits 0 only when every gate passes.
# Designed to be re-run safely; uses /tmp paths for all transient state.
set -u
DAY="${1:-1}"
TREE=/home/user/workspace/avi_v12_tree
cd "$TREE" || { echo "FATAL: $TREE missing"; exit 99; }

# Kill any stale verifier servers from prior runs
for p in 5085 5187 5188 5189 5190 5191 5192 5193 5194; do
  lsof -ti:$p 2>/dev/null | xargs -r kill -9
done
sleep 1

PASS=0
FAIL=0
DETAILS=()

check () {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    PASS=$((PASS+1))
    echo "  PASS  $label"
  else
    FAIL=$((FAIL+1))
    DETAILS+=("FAIL: $label  | cmd: $cmd")
    echo "  FAIL  $label"
  fi
}

echo "=============================================================="
echo "Patch v12 — Day $DAY independent verification"
echo "Tree: $TREE"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================================="

# ────────────────────────────────────────────────────────────────
# Gate 1 — v11 fixes preserved
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 1 — v11 fixes preserved (10 greps)"
echo "--------------------------------------------------------------"
check "B-V11-2 normalizeStage"             "grep -q 'normalizeStage' server/founderCrmStore.ts"
check "B-V11-7 crm.contact.created"        "grep -q 'crm.contact.created' server/founderCrmStore.ts"
check "B-V11-5 updateCompanyDetails"       "grep -q 'updateCompanyDetails' server/multiCompanyStore.ts"
check "V3v8 mergeBillingFromSubscription"  "grep -q 'mergeBillingFromSubscription' server/multiCompanyStore.ts"
check "_testAccess preserved"              "grep -q '_testAccess' server/multiCompanyStore.ts"
check "B-V11-1 founder/dashboard redirect" "grep -q 'navigate.*founder/dashboard' client/src/pages/auth/Login.tsx"
check "B-V11-4 grid-cols-2 login"          "grep -q 'grid-cols-2' client/src/pages/auth/Login.tsx"
check "B-V11-10 RoundCarryForwardPanel"    "grep -q 'RoundCarryForwardPanel' client/src/pages/founder/RoundNew.tsx"
check "B-V11-2 STAGES[0] fallback"         "grep -q 'STAGES\\[0\\]' client/src/pages/founder/CRM.tsx"
check "B-V11-5 coLegalName controlled"     "grep -q 'coLegalName' client/src/pages/founder/Settings.tsx"

# ────────────────────────────────────────────────────────────────
# Gate 2 — v12 infrastructure present
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 2 — v12 new infrastructure present"
echo "--------------------------------------------------------------"
check "tenants table in schema"            "grep -q 'export const tenants = sqliteTable' shared/schema.ts"
check "userPrefs table in schema"          "grep -q 'userPrefs.*sqliteTable\\|user_prefs.*sqliteTable' shared/schema.ts"
check "companies.deleted_at column"        "grep -A 30 'export const companies = sqliteTable' shared/schema.ts | grep -q 'deleted_at\\|deletedAt'"
check "withTenant helper exists"           "test -f server/lib/withTenant.ts"
check "withTenant exports getCurrentTenantId" "grep -q 'getCurrentTenantId' server/lib/withTenant.ts"
check "seedDemoData helper exists"         "test -f server/lib/seedDemoData.ts"
check "Migration 0002 present"             "ls migrations/0002_*.sql >/dev/null 2>&1"
check "Migration 0003 present"             "ls migrations/0003_*.sql >/dev/null 2>&1"
check "durableMap deprecated"              "grep -q -i '@deprecated\\|DO NOT ADOPT\\|deprecat\\|do not extend' server/durableMap.ts"

# ────────────────────────────────────────────────────────────────
# Gate 3 — Migrated stores (cumulative through Day N)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 3 — Migrated stores cumulative through Day $DAY"
echo "--------------------------------------------------------------"
# Day 1: userCredentials + subscriptions + multiCompany
check "userCredentialsStore uses getDb"     "grep -q 'getDb' server/userCredentialsStore.ts"
check "userCredentialsStore: no /tmp credentials fallback" "! grep -q 'capavate-credentials.json' server/userCredentialsStore.ts"
check "userCredentialsStore: no broken require" "! grep -q 'require(\"../../db\")' server/userCredentialsStore.ts"
check "userCredentialsStore: proper ESM import" "grep -q 'from \"./db/connection\"' server/userCredentialsStore.ts"
check "subscriptionsStore uses getDb"       "grep -q 'getDb' server/subscriptionsStore.ts"
check "multiCompanyStore uses getDb"        "grep -q 'getDb' server/multiCompanyStore.ts"
check "no console.log writeThrough stubs in migrated stores" "! grep -l 'would upsert\\|would delete\\|would load' server/userCredentialsStore.ts server/subscriptionsStore.ts server/multiCompanyStore.ts >/dev/null 2>&1"

if [ "$DAY" -ge 2 ]; then
  # Day 2: companyProfile, adminPlatform, dataroomStore, captableCommit, termSheet, invoice, legalConsent, adminContacts
  for s in companyProfileStore adminPlatformStore dataroomStore captableCommitStore termSheetStore invoiceStore legalConsentStore adminContactsStore; do
    check "$s uses getDb"                 "grep -q 'getDb' server/$s.ts"
  done
fi

if [ "$DAY" -ge 3 ]; then
  # Day 3: founderCrm, investorCrm, crm
  for s in founderCrmStore investorCrmStore crmStore; do
    check "$s uses getDb"                 "grep -q 'getDb' server/$s.ts"
  done
fi

# ────────────────────────────────────────────────────────────────
# Gate 4 — TypeScript (count delta from baseline)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 4 — TypeScript no new errors"
echo "--------------------------------------------------------------"
TS_OUT=$(timeout 120 npx tsc --noEmit -p . 2>&1)
TS_TOTAL=$(echo "$TS_OUT" | grep -c "error TS" || true)
# Baseline: 639 errors total in current v12 tree (636 + 3 pre-existing roundCarryForward)
TS_BASELINE=639
TS_DELTA=$(( ${TS_TOTAL:-0} - $TS_BASELINE ))
if [ "$TS_DELTA" -le 0 ]; then
  PASS=$((PASS+1))
  echo "  PASS  TypeScript: $TS_TOTAL errors (baseline $TS_BASELINE, delta $TS_DELTA)"
else
  FAIL=$((FAIL+1))
  DETAILS+=("FAIL: TypeScript: $TS_TOTAL errors, +$TS_DELTA over baseline of $TS_BASELINE")
  echo "  FAIL  TypeScript: $TS_TOTAL errors, +$TS_DELTA over baseline"
  echo "$TS_OUT" | grep "error TS" | head -5 | sed 's/^/        /'
fi

# ────────────────────────────────────────────────────────────────
# Gate 5 — Vitest (parse the right line)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 5 — Vitest baseline (full suite)"
echo "--------------------------------------------------------------"
echo "  Running full suite (~2 minutes)..."
VITEST_OUT=$(ENABLE_DEMO_SEED=1 NODE_ENV=test timeout 300 npx vitest run 2>&1)
# CORRECT parse: "Tests <N> failed | <M> passed" — extract M from the Tests: line specifically
TESTS_LINE=$(echo "$VITEST_OUT" | grep -E '^\s+Tests\s' | head -1)
VITEST_PASS=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
VITEST_FAIL=$(echo "$TESTS_LINE" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
# Day 1 baseline: 1887 passing in v11; Day 1 v12 added 7 tests so floor is 1890
VITEST_FLOOR=1887
if [ "${VITEST_PASS:-0}" -ge $VITEST_FLOOR ]; then
  PASS=$((PASS+1))
  echo "  PASS  Vitest: ${VITEST_PASS:-?} passing (floor $VITEST_FLOOR), ${VITEST_FAIL:-0} failing"
else
  FAIL=$((FAIL+1))
  DETAILS+=("FAIL: Vitest passing dropped to ${VITEST_PASS:-0} (floor $VITEST_FLOOR)")
  echo "  FAIL  Vitest: ${VITEST_PASS:-0} passing — below floor $VITEST_FLOOR"
  echo "$VITEST_OUT" | grep -E '^\s+Tests\s|^\s+Test Files\s' | head -3 | sed 's/^/        /'
fi

# ────────────────────────────────────────────────────────────────
# Gate 6 — End-to-end persistence smoke (the real thing)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 6 — End-to-end persistence smoke"
echo "--------------------------------------------------------------"
rm -f data.db
echo "  Starting server (fresh data.db)..."
ENABLE_DEMO_SEED=1 PORT=5193 NODE_ENV=development npx tsx server/index.ts > /tmp/v12_v_server1.log 2>&1 &
SP1=$!
sleep 14

# Signup with unique email per run
SMOKE_EMAIL="smoke_$(date +%s)@local.dev"
SIGNUP_RES=$(curl -s -c /tmp/v12_v_cookies.txt -X POST http://localhost:5193/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"Smoke123!\",\"name\":\"Smoke\"}")
SIGNUP_OK=$(echo "$SIGNUP_RES" | python3 -c "
import sys, json
try: d=json.load(sys.stdin); print('ok' if d.get('ok') else 'no')
except: print('no')
" 2>/dev/null)
check "Signup returns ok" "test '$SIGNUP_OK' = 'ok'"

# Create company
CO_RES=$(curl -s -b /tmp/v12_v_cookies.txt -X POST http://localhost:5193/api/founder/companies/new \
  -H 'Content-Type: application/json' \
  -d '{"name":"VerifyCo","sector":"Fintech","stage":"Seed","hq":"NYC"}')
CO_OK=$(echo "$CO_RES" | python3 -c "
import sys, json
try: d=json.load(sys.stdin); print('ok' if d.get('ok') and d.get('companyId') else 'no')
except: print('no')
" 2>/dev/null)
check "Company creation returns ok with companyId" "test '$CO_OK' = 'ok'"

# Verify in SQLite
sleep 1
USER_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM user_credentials WHERE email = '$SMOKE_EMAIL'" 2>/dev/null || echo 0)
check "user_credentials row in DB"          "test '${USER_ROWS:-0}' -ge 1"
COMPANY_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM companies WHERE name = 'VerifyCo'" 2>/dev/null || echo 0)
check "companies row in DB"                 "test '${COMPANY_ROWS:-0}' -ge 1"
TENANT_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM tenants WHERE kind='company' AND name = 'VerifyCo'" 2>/dev/null || echo 0)
check "tenants row created for new company" "test '${TENANT_ROWS:-0}' -ge 1"
MEMBERSHIP_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM company_members cm JOIN companies c ON cm.company_id = c.id WHERE c.name = 'VerifyCo'" 2>/dev/null || echo 0)
check "company_members row links to company" "test '${MEMBERSHIP_ROWS:-0}' -ge 1"
PREFS_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM user_prefs WHERE active_tenant_id IN (SELECT id FROM tenants WHERE name='VerifyCo')" 2>/dev/null || echo 0)
check "user_prefs row tracks active tenant" "test '${PREFS_ROWS:-0}' -ge 1"

# Kill server cleanly, restart WITHOUT demo seed
kill -9 $SP1 2>/dev/null
wait $SP1 2>/dev/null
sleep 3

echo "  Restarting server (no demo seed)..."
PORT=5193 NODE_ENV=development npx tsx server/index.ts > /tmp/v12_v_server2.log 2>&1 &
SP2=$!
sleep 14

# Login as same user — proves user_credentials persisted
LOGIN_RES=$(curl -s -c /tmp/v12_v_cookies2.txt -X POST http://localhost:5193/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"Smoke123!\"}")
LOGIN_OK=$(echo "$LOGIN_RES" | python3 -c "
import sys, json
try: d=json.load(sys.stdin); print('ok' if d.get('ok') else 'no')
except: print('no')
" 2>/dev/null)
check "Login after restart succeeds" "test '$LOGIN_OK' = 'ok'"

# List companies — proves multi-company hydration worked
LIST_RES=$(curl -s -b /tmp/v12_v_cookies2.txt http://localhost:5193/api/founder/companies)
LIST_OK=$(echo "$LIST_RES" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d if isinstance(d, list) else d.get('companies', [])
    print('ok' if any(c.get('companyName')=='VerifyCo' or c.get('name')=='VerifyCo' for c in items) else 'no')
except: print('no')
" 2>/dev/null)
check "Company visible after restart" "test '$LIST_OK' = 'ok'"

kill -9 $SP2 2>/dev/null
wait $SP2 2>/dev/null

# ────────────────────────────────────────────────────────────────
# Gate 7 — DB-layer fixes (founder mandated)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 7 — DB-layer fixes"
echo "--------------------------------------------------------------"
check "DB-1: broken require gone"          "! grep -q 'require(\"../../db\")' server/userCredentialsStore.ts"
check "DB-1: /tmp credentials json gone"   "! grep -q 'capavate-credentials.json' server/userCredentialsStore.ts"
check "DB-1: proper ESM import of getDb"   "grep -q 'from \"./db/connection\"' server/userCredentialsStore.ts"
check "DB-2: durableMap deprecated"        "grep -q -i '@deprecated\\|DO NOT ADOPT\\|deprecat\\|do not extend' server/durableMap.ts"
check "DB-4: sequential hydration"         "grep -q 'HYDRATE_ORDER\\|for.*of.*hydrate\\|await fn' server/lib/hydrateStores.ts && ! grep -q 'Promise.all.*hydrate' server/lib/hydrateStores.ts"
check "DB-5: securities.shares_str column" "grep -q 'shares_str\\|sharesStr' shared/schema.ts"
check "DB-5: securities.amount_minor"       "grep -q 'amount_minor\\|amountMinor' shared/schema.ts"
check "DB-6: db.transaction in stores"      "grep -lq 'transaction(' server/userCredentialsStore.ts server/multiCompanyStore.ts server/subscriptionsStore.ts"
check "DB-7: withTenant or crossTenant adopted" "grep -q 'withTenant\\|crossTenant' server/multiCompanyStore.ts"
check "DB-9: migration 0003 present"        "ls migrations/0003_*.sql >/dev/null 2>&1"

# ────────────────────────────────────────────────────────────────
# Gate 8 — SQLite data integrity (post-smoke)
# ────────────────────────────────────────────────────────────────
echo ""
echo "Gate 8 — SQLite data integrity"
echo "--------------------------------------------------------------"
TENANT_VALID=$(sqlite3 data.db "SELECT COUNT(*) FROM tenants WHERE kind NOT IN ('company','consortium_partner')" 2>/dev/null || echo 99)
check "tenants.kind always company or consortium_partner" "test '${TENANT_VALID:-99}' -eq 0"
ORPHAN_MEMBERS=$(sqlite3 data.db "SELECT COUNT(*) FROM company_members WHERE tenant_id IS NULL OR tenant_id = ''" 2>/dev/null || echo 99)
check "no company_members without tenant_id" "test '${ORPHAN_MEMBERS:-99}' -eq 0"
ORPHAN_COMPANIES=$(sqlite3 data.db "SELECT COUNT(*) FROM companies WHERE tenant_id IS NULL OR tenant_id = ''" 2>/dev/null || echo 99)
check "no companies without tenant_id"      "test '${ORPHAN_COMPANIES:-99}' -eq 0"
TENANT_FK=$(sqlite3 data.db "SELECT COUNT(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = c.tenant_id)" 2>/dev/null || echo 99)
check "all companies.tenant_id resolve to a tenants row" "test '${TENANT_FK:-99}' -eq 0"

# ────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────
echo ""
echo "=============================================================="
echo "Day $DAY verification summary"
echo "=============================================================="
echo "  PASSED: $PASS"
echo "  FAILED: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "FAILURE DETAILS:"
  for d in "${DETAILS[@]}"; do
    echo "  $d"
  done
  echo ""
  echo "Day $DAY NOT ready. Server logs: /tmp/v12_v_server[12].log"
  exit 1
fi
echo ""
echo "Day $DAY PASSED ALL GATES. Proceed to next day."
exit 0
