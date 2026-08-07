#!/bin/bash
# Capavate v26.7.1 Hotfix — Auto-Install with State Detection
#
# Detects Avi's mf_engagement_event table state and applies the correct
# recovery path automatically. Safe to re-run.
#
# Usage: bash install_v26_7_1.sh /path/to/backend

set -e

BACKEND_DIR="${1:-.}"
DB_PATH="$BACKEND_DIR/data.db"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: No data.db found at $DB_PATH"
  echo "Usage: bash install_v26_7_1.sh /path/to/backend"
  exit 1
fi

echo "=============================================="
echo "Capavate v26.7.1 Hotfix Installer"
echo "Backend directory: $BACKEND_DIR"
echo "Database: $DB_PATH"
echo "=============================================="
echo ""

# Step 1: MANDATORY backup
BACKUP_PATH="${DB_PATH}.pre_v26_7_1.$(date +%Y%m%d_%H%M%S).backup"
echo "[1/6] Creating backup at: $BACKUP_PATH"
cp "$DB_PATH" "$BACKUP_PATH"
echo "      Backup created: $(ls -lh "$BACKUP_PATH" | awk '{print $5}')"
echo ""

# Verify backup restores cleanly
echo "[2/6] Verifying backup integrity..."
sqlite3 "$BACKUP_PATH" "PRAGMA integrity_check;" > /tmp/backup_check.out
if ! grep -q "^ok$" /tmp/backup_check.out; then
  echo "      ERROR: Backup integrity check failed!"
  cat /tmp/backup_check.out
  exit 1
fi
echo "      Backup integrity: ok"
echo ""

# Step 3: Detect mf_engagement_event state
echo "[3/6] Detecting mf_engagement_event table state..."
CURRENT_SCHEMA=$(sqlite3 "$DB_PATH" ".schema mf_engagement_event" 2>&1 || echo "")
if [ -z "$CURRENT_SCHEMA" ]; then
  STATE="absent"
elif echo "$CURRENT_SCHEMA" | grep -q "company_id"; then
  COL_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('mf_engagement_event');")
  if [ "$COL_COUNT" -eq 8 ]; then
    STATE="canonical"
  else
    STATE="partial_mid_state"
  fi
else
  STATE="malformed_missing_company_id"
fi

echo "      State detected: $STATE"
echo "      Current schema:"
sqlite3 "$DB_PATH" ".schema mf_engagement_event" | sed 's/^/        /'
echo ""

# Step 4: Apply recovery based on state
echo "[4/6] Applying recovery for state: $STATE"
case "$STATE" in
  canonical)
    echo "      No table reset needed. Table is in the expected 8-column shape."
    ;;
  absent|malformed_missing_company_id|partial_mid_state)
    echo "      Dropping malformed mf_engagement_event and mf_engagement_event_new..."
    sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS mf_engagement_event_new;"
    sqlite3 "$DB_PATH" "DROP TABLE IF EXISTS mf_engagement_event;"
    echo "      Resetting partial 0128-0131 migration entries..."
    sqlite3 "$DB_PATH" "DELETE FROM __drizzle_migrations_applied WHERE name LIKE '0128%' OR name LIKE '0129%' OR name LIKE '0130%' OR name LIKE '0131%';" 2>/dev/null || echo "      (tracker table not found — will be created by migrate)"
    echo "      Reset complete. mf_engagement_event will be recreated by buildProductionTableStatements on next boot."
    ;;
  *)
    echo "      ERROR: Unknown state. Manual recovery required."
    exit 1
    ;;
esac
echo ""

# Step 5: Confirm hotfix files are present
echo "[5/6] Verifying hotfix files are in place..."
if [ ! -f "$BACKEND_DIR/server/db/connection.ts" ]; then
  echo "      ERROR: server/db/connection.ts not found. Extract the hotfix zip first."
  exit 1
fi
if ! grep -q "v26.7.1 POST-DEPLOY FIX" "$BACKEND_DIR/server/db/connection.ts"; then
  echo "      ERROR: connection.ts does not contain the v26.7.1 fix marker."
  echo "      Please extract capavate_v26.7.1_HOTFIX_CHANGED_FILES.zip into $BACKEND_DIR first."
  exit 1
fi
echo "      Hotfix file present and contains fix marker."
echo ""

# Step 6: Run the migration
echo "[6/6] Running npm run db:migrate..."
echo ""
cd "$BACKEND_DIR"
npm run db:migrate
MIGRATE_EXIT=$?

if [ $MIGRATE_EXIT -eq 0 ]; then
  echo ""
  echo "=============================================="
  echo "SUCCESS: v26.7.1 hotfix installed."
  echo "=============================================="
  echo ""
  echo "Next steps:"
  echo "  1. Restart the server (systemctl or pm2 depending on your setup)"
  echo "  2. Verify capavate.com loads correctly"
  echo "  3. Test the smoke-test scenarios in AVI_DEPLOY_RUNBOOK_v26.7.0_PRODUCTION_ONLY.md"
  echo ""
  echo "If any issues, restore from: $BACKUP_PATH"
else
  echo ""
  echo "=============================================="
  echo "MIGRATION FAILED with exit code $MIGRATE_EXIT"
  echo "=============================================="
  echo ""
  echo "Rollback:"
  echo "  cp $BACKUP_PATH $DB_PATH"
  echo ""
  echo "Send the full output of this script (including any errors above)"
  echo "to Ozan for further diagnosis."
  exit $MIGRATE_EXIT
fi
