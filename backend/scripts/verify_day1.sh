#!/usr/bin/env bash
# Independent verification of Day 1 completion.
# Run from any directory. Exits 0 only if every gate passes.
# Does NOT trust the subagent's self-report.
set -u
TREE=/home/user/workspace/avi_v12_tree
cd "$TREE" || { echo "FATAL: $TREE missing"; exit 99; }

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
echo "Patch v12 — Day 1 independent verification"
echo "Tree: $TREE"
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=============================================================="

echo ""
echo "Gate 1 — v11 fixes preserved (10 greps)"
echo "--------------------------------------------------------------"
check "v11 B-V11-2 normalizeStage"      "grep -q 'normalizeStage' server/founderCrmStore.ts"
check "v11 B-V11-7 crm.contact.created" "grep -q 'crm.contact.created' server/founderCrmStore.ts"
check "v11 B-V11-5 updateCompanyDetails" "grep -q 'updateCompanyDetails' server/multiCompanyStore.ts"
check "v11 V3v8 mergeBillingFromSubscription" "grep -q 'mergeBillingFromSubscription' server/multiCompanyStore.ts"
check "v11 _testAccess preserved"       "grep -q '_testAccess' server/multiCompanyStore.ts"
check "v11 B-V11-1 founder/dashboard redirect" "grep -q 'navigate.*founder/dashboard' client/src/pages/auth/Login.tsx"
check "v11 B-V11-4 grid-cols-2 login"   "grep -q 'grid-cols-2' client/src/pages/auth/Login.tsx"
check "v11 B-V11-10 RoundCarryForwardPanel" "grep -q 'RoundCarryForwardPanel' client/src/pages/founder/RoundNew.tsx"
check "v11 B-V11-2 STAGES[0] fallback"  "grep -q 'STAGES\\[0\\]' client/src/pages/founder/CRM.tsx"
check "v11 B-V11-5 coLegalName controlled" "grep -q 'coLegalName' client/src/pages/founder/Settings.tsx"

echo ""
echo "Gate 2 — v12 new infrastructure present"
echo "--------------------------------------------------------------"
check "tenants table in schema"          "grep -q 'export const tenants = sqliteTable' shared/schema.ts"
check "userPrefs table in schema"        "grep -q 'userPrefs.*sqliteTable\\|user_prefs.*sqliteTable' shared/schema.ts"
check "companies.deleted_at column"      "grep -A 30 'export const companies = sqliteTable' shared/schema.ts | grep -q 'deleted_at\\|deletedAt'"
check "withTenant helper exists"         "test -f server/lib/withTenant.ts"
check "withTenant exports getCurrentTenantId" "grep -q 'getCurrentTenantId' server/lib/withTenant.ts"
check "seedDemoData helper exists"       "test -f server/lib/seedDemoData.ts"
check "Migration 0002 SQL present"       "ls migrations/0002_*.sql >/dev/null 2>&1"

echo ""
echo "Gate 3 — Day 1 stores migrated (subagent claim)"
echo "--------------------------------------------------------------"
check "userCredentialsStore uses getDb"   "grep -q 'getDb()' server/userCredentialsStore.ts"
check "userCredentialsStore NO /tmp/capavate-credentials.json" "! grep -q 'capavate-credentials.json' server/userCredentialsStore.ts"
check "subscriptionsStore uses getDb"     "grep -q 'getDb()' server/subscriptionsStore.ts"
check "multiCompanyStore uses getDb"      "grep -q 'getDb()' server/multiCompanyStore.ts"
check "no console.log writeThrough stubs in migrated stores" "! grep -l 'would upsert\\|would delete\\|would load' server/userCredentialsStore.ts server/subscriptionsStore.ts server/multiCompanyStore.ts >/dev/null 2>&1"

echo ""
echo "Gate 4 — Compiles clean (TypeScript)"
echo "--------------------------------------------------------------"
# Allow the 3 pre-existing errors in roundCarryForward* files; count new errors
TS_OUT=$(timeout 90 npx tsc --noEmit -p . 2>&1 | grep -E "error TS" || true)
TS_NEW=$(echo "$TS_OUT" | grep -v "roundCarryForwardEngine.ts\|roundCarryForwardRoutes.ts" | grep -c "error TS" || true)
if [ "${TS_NEW:-0}" -eq 0 ]; then
  PASS=$((PASS+1))
  echo "  PASS  TypeScript: $TS_NEW new errors (pre-existing roundCarryForward errors tolerated)"
else
  FAIL=$((FAIL+1))
  DETAILS+=("FAIL: TypeScript has $TS_NEW NEW errors — see below")
  echo "  FAIL  TypeScript: $TS_NEW new errors"
  echo "$TS_OUT" | grep -v "roundCarryForwardEngine.ts\|roundCarryForwardRoutes.ts" | head -10 | sed 's/^/        /'
fi

echo ""
echo "Gate 5 — Vitest baseline (full suite, ENABLE_DEMO_SEED=1)"
echo "--------------------------------------------------------------"
echo "  Running full suite — this takes ~2 minutes..."
VITEST_OUT=$(ENABLE_DEMO_SEED=1 NODE_ENV=development timeout 240 npx vitest run 2>&1 | tail -8)
VITEST_PASS=$(echo "$VITEST_OUT" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+')
VITEST_FAIL=$(echo "$VITEST_OUT" | grep -oE '[0-9]+ failed' | head -1 | grep -oE '[0-9]+')
if [ "${VITEST_PASS:-0}" -ge 1883 ]; then
  PASS=$((PASS+1))
  echo "  PASS  Vitest: $VITEST_PASS passing (≥ 1883 baseline), $VITEST_FAIL failing"
else
  FAIL=$((FAIL+1))
  DETAILS+=("FAIL: Vitest baseline dropped — expected ≥1883 passing, got ${VITEST_PASS:-0}")
  echo "  FAIL  Vitest: only ${VITEST_PASS:-0} passing — below 1883 baseline"
  echo "$VITEST_OUT" | sed 's/^/        /'
fi

echo ""
echo "Gate 6 — End-to-end persistence smoke (the real test)"
echo "--------------------------------------------------------------"
echo "  Starting server with fresh data.db..."
rm -f data.db
ENABLE_DEMO_SEED=1 PORT=5187 NODE_ENV=development npx tsx server/index.ts > /tmp/v12_d1_server1.log 2>&1 &
SP=$!
sleep 10

# Test 1: signup persists across restart
SIGNUP_OUT=$(curl -s -c /tmp/v12_d1_signup.txt -X POST http://localhost:5187/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"v12d1@local.dev","password":"Day1Pass!","name":"Day1 Test"}' 2>/dev/null)
SIGNUP_OK=$(echo "$SIGNUP_OUT" | python3 -c "import sys,json;
try: d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('user') else 'no')
except: print('no')" 2>/dev/null)
check "Signup returns ok" "test '$SIGNUP_OK' = 'ok'"

# Test 2: company creation works
COMPANY_OUT=$(curl -s -b /tmp/v12_d1_signup.txt -X POST http://localhost:5187/api/founder/companies/new \
  -H 'Content-Type: application/json' \
  -d '{"name":"Day1 Inc","sector":"Fintech","stage":"Seed","hq":"Toronto"}' 2>/dev/null)
COMPANY_OK=$(echo "$COMPANY_OUT" | python3 -c "import sys,json;
try: d=json.load(sys.stdin); print('ok' if d.get('ok') or d.get('company') or d.get('companyId') else 'no')
except: print('no')" 2>/dev/null)
check "Company creation returns ok" "test '$COMPANY_OK' = 'ok'"

# Verify in SQLite
sleep 1
USER_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM user_credentials WHERE email = 'v12d1@local.dev'" 2>/dev/null || echo 0)
check "user_credentials row in DB" "test '${USER_ROWS:-0}' -ge 1"
COMPANY_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM companies WHERE name = 'Day1 Inc' OR display_name = 'Day1 Inc'" 2>/dev/null || echo 0)
check "companies row in DB" "test '${COMPANY_ROWS:-0}' -ge 1"
TENANT_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM tenants WHERE kind='company' AND name = 'Day1 Inc'" 2>/dev/null || echo 0)
check "tenants row created for new company" "test '${TENANT_ROWS:-0}' -ge 1"
MEMBERSHIP_ROWS=$(sqlite3 data.db "SELECT COUNT(*) FROM company_members cm JOIN tenants t ON cm.tenant_id = t.id WHERE t.name = 'Day1 Inc'" 2>/dev/null || echo 0)
check "company_members row links user to tenant" "test '${MEMBERSHIP_ROWS:-0}' -ge 1"

# Kill server, restart WITHOUT demo seed
kill -9 $SP 2>/dev/null
sleep 2

PORT=5187 NODE_ENV=development npx tsx server/index.ts > /tmp/v12_d1_server2.log 2>&1 &
SP=$!
sleep 10

# Test 3: login persists
LOGIN_OUT=$(curl -s -c /tmp/v12_d1_login.txt -X POST http://localhost:5187/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"v12d1@local.dev","password":"Day1Pass!"}' 2>/dev/null)
LOGIN_OK=$(echo "$LOGIN_OUT" | python3 -c "import sys,json;
try: d=json.load(sys.stdin); print('ok' if d.get('ok') else 'no')
except: print('no')" 2>/dev/null)
check "Login after restart succeeds" "test '$LOGIN_OK' = 'ok'"

# Test 4: company visible after restart
LIST_OUT=$(curl -s -b /tmp/v12_d1_login.txt "http://localhost:5187/api/founder/companies" 2>/dev/null)
LIST_OK=$(echo "$LIST_OUT" | python3 -c "import sys,json;
try:
  d=json.load(sys.stdin); cs=d.get('companies', [])
  print('ok' if any(c.get('name')=='Day1 Inc' or c.get('displayName')=='Day1 Inc' for c in cs) else 'no')
except: print('no')" 2>/dev/null)
check "Company visible after restart" "test '$LIST_OK' = 'ok'"

kill -9 $SP 2>/dev/null
sleep 1

echo ""

echo ""
echo "Gate 7 — DB-layer fixes (founder mandated)"
echo "--------------------------------------------------------------"
check "DB-1: broken require('../../db') removed" "! grep -q 'require(\"../../db\")' server/userCredentialsStore.ts"
check "DB-1: /tmp/capavate-credentials.json fallback removed" "! grep -q 'capavate-credentials.json' server/userCredentialsStore.ts"
check "DB-1: proper ESM import of getDb" "grep -q 'from \"./db/connection\"\\|from \"./db/connection.js\"' server/userCredentialsStore.ts"
check "DB-2: durableMap.ts has deprecation notice" "grep -q -i 'deprecat\\|legacy\\|do not adopt\\|fossil' server/durableMap.ts"
check "DB-4: hydration is sequential (no Promise.all on hydrate)" "! grep -q 'Promise.all.*hydrate\\|hydrate.*Promise.all' server/lib/hydrateStores.ts || grep -q 'for.*of\\|await.*hydrate' server/lib/hydrateStores.ts"
check "DB-5: securities.shares_str column in schema" "grep -q 'shares_str\\|sharesStr' shared/schema.ts"
check "DB-5: securities.amount_minor column in schema" "grep -q 'amount_minor\\|amountMinor' shared/schema.ts"
check "DB-6: db.transaction wraps writes in migrated stores" "grep -q 'db.transaction\\|getDb().transaction\\|.transaction(' server/userCredentialsStore.ts server/multiCompanyStore.ts server/subscriptionsStore.ts"
check "DB-7: withTenant helper imported in migrated stores" "grep -q 'withTenant' server/multiCompanyStore.ts || grep -q 'withTenant' server/subscriptionsStore.ts"
check "DB-9: migration 0003 backfill exists" "ls migrations/0003_*.sql >/dev/null 2>&1"

# Verify the SQLite data after smoke test has all the new columns populated correctly
echo ""
echo "Gate 8 — SQLite data integrity (post-smoke)"
echo "--------------------------------------------------------------"
TENANT_KIND_OK=$(sqlite3 data.db "SELECT COUNT(*) FROM tenants WHERE kind IN ('company','consortium_partner')" 2>/dev/null || echo 0)
check "tenants.kind values valid" "test '${TENANT_KIND_OK:-0}' -ge 1"
ORPHAN_MEMBERS=$(sqlite3 data.db "SELECT COUNT(*) FROM company_members WHERE tenant_id IS NULL" 2>/dev/null || echo 99)
check "no company_members orphaned (all have tenant_id)" "test '${ORPHAN_MEMBERS:-99}' -eq 0"
ORPHAN_COMPANIES=$(sqlite3 data.db "SELECT COUNT(*) FROM companies WHERE tenant_id IS NULL" 2>/dev/null || echo 99)
check "no companies orphaned (all have tenant_id)" "test '${ORPHAN_COMPANIES:-99}' -eq 0"

echo "=============================================================="
echo "Day 1 verification summary"
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
  echo "Day 1 NOT ready for Day 2. Server logs at /tmp/v12_d1_server[12].log"
  exit 1
fi
echo ""
echo "Day 1 PASSED ALL GATES. Proceed to Day 2."
exit 0
