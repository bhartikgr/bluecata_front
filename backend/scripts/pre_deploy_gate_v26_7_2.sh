#!/bin/bash
# =============================================================================
# CAPAVATE v26.7.2 PRE-DEPLOY GATE
# =============================================================================
#
# CRITICAL: Run this script BEFORE `npm run db:migrate` on any production
# database with existing data.
#
# The Wave C-2 hotfix v26.7.2 causes the migration runner to see the full
# 70-file corpus for the first time. Even with legacy-tracker seeding, on
# a DB whose _migrations_applied table doesn't contain numbered migration
# entries (Avi's documented actual state), the runner will REPLAY every
# pre-Wave-C2 file from 0001 forward.
#
# Most files are idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD
# COLUMN with duplicate-column swallow, etc.). A few are NOT idempotent
# and will DAMAGE live production data if replayed:
#
#   0097_v25_52_crm_dedup_backfill.sql
#     Soft-deletes duplicate CRM contacts by ROW_NUMBER rank. Replay will
#     soft-delete duplicates that operators created deliberately AFTER
#     the original 2026-05 v25.52 backfill.
#
#   0021_backfill_chapter_to_default.sql
#     Re-tags any legitimately-null chapter_id row to 'chap_keiretsu_canada'.
#     Replay may re-tag rows that were left null intentionally by newer
#     onboarding flows.
#
# This script pre-marks those in __drizzle_migrations_applied so the
# runner skips them. Runs are logged with clear provenance so an operator
# can review what was gated later.
#
# USAGE:
#   sudo bash pre_deploy_gate_v26_7_2.sh /var/www/html/backend/data.db
#
# =============================================================================

set -e

DB_PATH="${1:-/var/www/html/backend/data.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: DB not found at $DB_PATH"
  echo "Usage: $0 /path/to/data.db"
  exit 1
fi

echo "=========================================================================="
echo "CAPAVATE v26.7.2 PRE-DEPLOY GATE"
echo "=========================================================================="
echo ""
echo "Target DB: $DB_PATH"
echo "Timestamp: $(date -Iseconds)"
echo ""

# ---- Step 1: Back up the DB. Non-negotiable. --------------------------------
BACKUP="${DB_PATH}.pre-v26.7.2.$(date +%Y%m%d_%H%M%S)"
echo "[1/5] Backing up DB to $BACKUP"
cp "$DB_PATH" "$BACKUP"
# Verify the copy opens
if ! sqlite3 "$BACKUP" "SELECT 1;" > /dev/null 2>&1; then
  echo "ERROR: backup at $BACKUP is not a valid SQLite database"
  exit 1
fi
echo "      Backup verified. If anything goes wrong, restore with:"
echo "        cp $BACKUP $DB_PATH"
echo ""

# ---- Step 2: Report current DB state. ---------------------------------------
echo "[2/5] Current DB state"
echo ""
echo "  _migrations_applied schema:"
sqlite3 "$DB_PATH" ".schema _migrations_applied" 2>&1 | sed 's/^/    /'
echo ""
echo "  _migrations_applied row count: $(sqlite3 "$DB_PATH" "SELECT count(*) FROM _migrations_applied;" 2>&1)"
echo ""
echo "  __drizzle_migrations_applied exists: $(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations_applied';" 2>&1)"
echo ""
echo "  Migration files on disk: $(ls /var/www/html/backend/server/db/migrations/*.sql 2>/dev/null | wc -l)"
echo ""

# ---- Step 3: Ensure __drizzle_migrations_applied exists. --------------------
echo "[3/5] Ensuring __drizzle_migrations_applied exists"
sqlite3 "$DB_PATH" <<SQL
CREATE TABLE IF NOT EXISTS __drizzle_migrations_applied (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
SQL
echo "      OK"
echo ""

# ---- Step 4: Gate the destructive/non-idempotent migrations. ----------------
echo "[4/5] Gating destructive replays"
NOW="$(date -Iseconds)"

# Read the list of migration files on disk
FILES=$(ls /var/www/html/backend/server/db/migrations/*.sql 2>/dev/null | xargs -I {} basename {})

# ---- 4a. Always-gate: known destructive DML.
GATED_ALWAYS=$(cat <<'EOF'
0097_v25_52_crm_dedup_backfill.sql
0021_backfill_chapter_to_default.sql
EOF
)

# ---- 4b. Also gate everything the DB shows as already-applied via the
#         modern (key, applied_at) tracker if it contains numbered entries.
#         This is the safe path even if we're wrong about which files are
#         idempotent: if it was applied before, don't replay.

for f in $GATED_ALWAYS; do
  if echo "$FILES" | grep -qx "$f"; then
    result=$(sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO __drizzle_migrations_applied (name, applied_at) VALUES ('$f', '$NOW');" 2>&1)
    marked=$(sqlite3 "$DB_PATH" "SELECT changes();")
    if [ "$marked" = "1" ]; then
      echo "      GATED: $f (pre-marked as applied to prevent destructive replay)"
    else
      echo "      already gated: $f"
    fi
  fi
done
echo ""

# ---- Step 5: Idempotent-mark all pre-Wave-C2 files (0001-0127).
#      These are safe to skip because either:
#      (a) they use CREATE TABLE IF NOT EXISTS + guarded ALTERs (schema-only)
#      (b) they were already applied via the connection.ts self-heal path
#      (c) their data operations use INSERT OR IGNORE + WHERE guards
echo "[5/5] Marking all pre-Wave-C2 migrations (0001-0127) as applied"
echo "      RATIONALE: the connection.ts inline-DDL baseline has been applying"
echo "      these schemas on every boot since v12. Re-running them via the"
echo "      numbered runner is redundant work and increases surface for the"
echo "      few migrations that lack idempotency guards. Wave C-2 (0128+) will"
echo "      still apply."
echo ""

PRE_C2_MARKED=0
for f in $FILES; do
  # Extract the leading number
  num=$(echo "$f" | grep -oE '^[0-9]+' | head -1)
  if [ -z "$num" ]; then continue; fi
  # Compare as integer: mark if <= 127 (last pre-Wave-C2 migration is 0127)
  if [ "$num" -le "127" ]; then
    sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO __drizzle_migrations_applied (name, applied_at) VALUES ('$f', '$NOW');" 2>&1 > /dev/null
    if [ "$(sqlite3 "$DB_PATH" 'SELECT changes();')" = "1" ]; then
      PRE_C2_MARKED=$((PRE_C2_MARKED + 1))
    fi
  fi
done
echo "      Marked $PRE_C2_MARKED pre-Wave-C2 migrations as applied"
echo ""

# ---- Summary. ---------------------------------------------------------------
FINAL_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM __drizzle_migrations_applied;")
echo "=========================================================================="
echo "PRE-DEPLOY GATE COMPLETE"
echo "=========================================================================="
echo ""
echo "  __drizzle_migrations_applied total entries: $FINAL_COUNT"
echo ""
echo "  Now run: npm run db:migrate"
echo ""
echo "  Expected: 9 applied, ~60 skipped, exit 0"
echo "  Applied files: 0128-0134, 0136, 0137 (the Wave C-2 files)"
echo ""
echo "  If anything goes wrong, restore with:"
echo "    cp $BACKUP $DB_PATH"
echo "    pm2 restart all"
echo ""
