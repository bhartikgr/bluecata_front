#!/usr/bin/env bash
# Patch v12 Day 3 — End-to-end ship-gate smoke test.
#
# Procedure:
#   1. Fresh boot with ENABLE_DEMO_SEED=1 SQLITE_PATH=./data_smoke.db on port 5194
#   2. Signup a new founder
#   3. Create a company (ShipTest Inc)
#   4. Create a round (Seed)
#   5. Add a founder CRM contact (Sample VC)
#   6. Kill server
#   7. Restart WITHOUT ENABLE_DEMO_SEED, same SQLITE_PATH
#   8. Login → list companies → list rounds → list CRM contacts → list audit log
#   9. Verify sqlite row counts directly
#
# Stdout is the proof-of-persistence dump consumed by PROOF_OF_FIX_V12.md.

set -euo pipefail
cd /home/user/workspace/avi_v12_tree

PORT=5194
DB=./data_smoke.db
COOKIE=/tmp/v12_smoke_cookies.txt
LOG_BOOT1=/tmp/v12_smoke_boot1.log
LOG_BOOT2=/tmp/v12_smoke_boot2.log
EMAIL="d3smoke_$(date +%s)@local.dev"

echo "=== Phase B smoke test ==="
echo "Port: $PORT"
echo "DB: $DB"
echo "Email: $EMAIL"

rm -f "$DB" "$DB-wal" "$DB-shm" "$COOKIE"

# Helper: wait for port
wait_for_port() {
  local p=$1
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://localhost:$p/api/health" 2>/dev/null \
       || curl -fsS -o /dev/null "http://localhost:$p/" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "Server did not come up on $p"
  return 1
}

echo "--- Boot 1: ENABLE_DEMO_SEED=1 SQLITE_PATH=$DB PORT=$PORT ---"
ENABLE_DEMO_SEED=1 SQLITE_PATH="$DB" PORT="$PORT" NODE_ENV=development \
  npx tsx server/index.ts > "$LOG_BOOT1" 2>&1 &
PID1=$!
trap "kill $PID1 2>/dev/null || true" EXIT

if ! wait_for_port $PORT; then
  echo "BOOT1_FAILED"
  tail -30 "$LOG_BOOT1"
  exit 1
fi
echo "Boot 1 up (pid=$PID1)"

# ---- 1. Signup ----
echo "--- 1. SIGNUP ---"
SIGNUP=$(curl -sS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "http://localhost:$PORT/api/auth/signup" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"TestPass123!\",\"role\":\"founder\",\"name\":\"Smoke Test\"}")
echo "Signup: $SIGNUP"

# ---- 2. Create company ----
echo "--- 2. CREATE COMPANY ---"
CO=$(curl -sS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "http://localhost:$PORT/api/founder/companies/new" \
  -d '{"name":"ShipTest Inc","coLegalName":"ShipTest Inc.","jurisdiction":"DE-US"}')
echo "Company: $CO"
COMPANY_ID=$(echo "$CO" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("companyId") or d.get("id") or d.get("company",{}).get("id",""))')
echo "companyId=$COMPANY_ID"

# ---- 3. Create round ----
echo "--- 3. CREATE ROUND ---"
ROUND=$(curl -sS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "http://localhost:$PORT/api/rounds" \
  -d "{\"companyId\":\"$COMPANY_ID\",\"name\":\"Seed\",\"targetUsd\":1000000,\"instrument\":\"safe\"}")
echo "Round: $ROUND"

# ---- 4. Add CRM contact ----
echo "--- 4. ADD CRM CONTACT ---"
CRM=$(curl -sS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "http://localhost:$PORT/api/founder/investor-crm" \
  -d "{\"companyId\":\"$COMPANY_ID\",\"name\":\"Sample VC\",\"firmName\":\"Sample Capital\",\"email\":\"sv@sample.test\",\"stage\":\"lead\",\"region\":\"US\"}")
echo "CRM: $CRM"

# ---- 5. Sanity GET before restart ----
echo "--- 5. PRE-RESTART CRM LIST ---"
curl -sS -b "$COOKIE" "http://localhost:$PORT/api/founder/investor-crm?companyId=$COMPANY_ID" | head -c 1000
echo ""

# ---- 6. Kill server ----
echo "--- 6. KILL BOOT 1 ---"
kill $PID1 || true
wait $PID1 2>/dev/null || true
sleep 1

# ---- 7. Boot 2 WITHOUT demo seed ----
echo "--- 7. Boot 2: SQLITE_PATH=$DB (no ENABLE_DEMO_SEED) ---"
SQLITE_PATH="$DB" PORT="$PORT" NODE_ENV=development \
  npx tsx server/index.ts > "$LOG_BOOT2" 2>&1 &
PID2=$!
trap "kill $PID2 2>/dev/null || true" EXIT

if ! wait_for_port $PORT; then
  echo "BOOT2_FAILED"
  tail -40 "$LOG_BOOT2"
  exit 1
fi
echo "Boot 2 up (pid=$PID2)"

# ---- 8. Login ----
echo "--- 8. LOGIN AFTER RESTART ---"
rm -f "$COOKIE"
LOGIN=$(curl -sS -c "$COOKIE" -b "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "http://localhost:$PORT/api/auth/login" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"TestPass123!\"}")
echo "Login: $LOGIN"

# ---- 9. List companies ----
echo "--- 9. LIST COMPANIES (must include ShipTest Inc) ---"
curl -sS -b "$COOKIE" "http://localhost:$PORT/api/founder/companies" | head -c 2000
echo ""

# ---- 9b. List rounds ----
echo "--- 9b. LIST ROUNDS (must include Seed) ---"
curl -sS -b "$COOKIE" "http://localhost:$PORT/api/rounds?companyId=$COMPANY_ID" | head -c 2000
echo ""

# ---- 10. List CRM contacts ----
echo "--- 10. LIST CRM CONTACTS (must include Sample VC) ---"
curl -sS -b "$COOKIE" "http://localhost:$PORT/api/founder/investor-crm?companyId=$COMPANY_ID" | head -c 2000
echo ""

# ---- 11. Audit log ----
echo "--- 11. AUDIT LOG (must include crm.contact.created) ---"
curl -sS -b "$COOKIE" "http://localhost:$PORT/api/admin/audit-log?limit=20" 2>&1 | head -c 2000 || true
echo ""

# ---- 12. SQLite direct queries ----
echo "--- 12. SQLITE DIRECT ROW COUNTS ---"
python3 - <<PY
import sqlite3, json
con = sqlite3.connect("$DB")
cur = con.cursor()
for q in [
    ("companies WHERE name='ShipTest Inc'",
     "SELECT id, name FROM companies WHERE name='ShipTest Inc'"),
    ("founder_crm_contacts WHERE name='Sample VC'",
     "SELECT id, name, company_id FROM founder_crm_contacts WHERE name='Sample VC'"),
    ("sync_round (Day 1 sync infrastructure)",
     "SELECT id, company_id, state FROM sync_round LIMIT 5"),
    ("audit_log WHERE action LIKE 'crm.contact%'",
     "SELECT id, action, actor_id, created_at FROM audit_log WHERE action LIKE 'crm.contact%' LIMIT 5"),
]:
    label, sql = q
    try:
        rows = cur.execute(sql).fetchall()
        print(f"{label}: {len(rows)} row(s)")
        for r in rows: print(" ", r)
    except Exception as e:
        print(f"{label}: ERROR {e}")
PY

# ---- 13. Cleanup ----
echo "--- 13. CLEANUP ---"
kill $PID2 || true
wait $PID2 2>/dev/null || true
trap - EXIT
echo "=== Phase B smoke complete ==="
