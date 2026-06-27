#!/usr/bin/env bash
#
# Capavate v25.45 LIVE deploy script
# Usage: ./deploy_v25_45_LIVE.sh /path/to/capavate
#
# Applies the v25.45 patch on top of an existing v25.43 install (Avi's last
# installed version). The patch folds in v25.44 + v25.45 — you do NOT need to
# apply v25.44 separately. Runs DB migrations + build, restarts the
# production server, and runs a smoke check.
#
# This release rolls up:
#   - v25.44 Collective Wave A (14 surfaces) + M&A Intelligence + Global
#     Venture Markets widget
#   - v25.45 Founder QA wave (19 surfaces F1–F20)
#   - 9-round counterparty privacy hardening
#   - 3 production-blocker bug fixes (subscribe unlock, admin company
#     visibility, Round Management DB persistence) + r2 fail-closed hardening
# See INSTALL_v25.45.md for the full surface list.

set -euo pipefail

TARGET="${1:-${CAPAVATE_HOME:-/opt/capavate}}"
PATCH_ZIP="${PATCH_ZIP:-$(dirname "$0")/CAPAVATE_v25.45_PATCH_for_Avi.zip}"

if [ ! -d "$TARGET" ]; then
  echo "ERROR: target directory $TARGET does not exist."
  exit 1
fi
if [ ! -f "$PATCH_ZIP" ]; then
  echo "ERROR: patch zip not found at $PATCH_ZIP"
  exit 1
fi

cd "$TARGET"

echo "==> Backing up current state"
BACKUP=".v25_45_backup_$(date +%s)"
mkdir -p "$BACKUP"
cp -r dist "$BACKUP/" 2>/dev/null || true
cp .env "$BACKUP/" 2>/dev/null || true
cp -r migrations "$BACKUP/" 2>/dev/null || true
# Back up data.db so v25.45's workspace_archive migration is reversible.
cp data.db "$BACKUP/" 2>/dev/null || true

echo "==> Applying v25.45 patch ($PATCH_ZIP)"
unzip -oq "$PATCH_ZIP"

echo "==> Updating APP_VERSION in .env to 25.45.0"
# CRITICAL: /api/health resolves version from process.env.APP_VERSION FIRST,
# then falls back to package.json. If .env still has APP_VERSION=25.4x.y from
# a prior install, /api/health will keep reporting the OLD version even after
# the new code is deployed — leading to false-negative install verification.
if [ -f .env ]; then
  # Update if present
  if grep -q "^APP_VERSION=" .env; then
    sed -i.bak_apv 's/^APP_VERSION=.*/APP_VERSION=25.45.0/' .env
    echo "    ✓ APP_VERSION updated to 25.45.0 in .env (previous value backed up to .env.bak_apv)"
  else
    echo "APP_VERSION=25.45.0" >> .env
    echo "    ✓ APP_VERSION=25.45.0 appended to .env"
  fi
  grep "^APP_VERSION=" .env
else
  echo "    WARNING: no .env file found at $TARGET/.env — APP_VERSION will fall back to package.json (25.45.0)"
fi

echo "==> Installing dependencies"
npm install --silent

echo "==> Running DB migrations (4 additive: 0059 ma_privacy_json + 0060 declined_reason + 0062 workspace_archive_state + 0063 round_chain_head_freezes)"
npm run db:migrate

echo "==> Building production bundle"
npm run build

echo "==> Restarting production server"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart capavate || pm2 start dist/index.cjs --name capavate --env production
elif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet capavate; then
  sudo systemctl restart capavate
else
  echo "==> No pm2/systemd found. Start manually:"
  echo "    NODE_ENV=production node dist/index.cjs"
fi

echo "==> Smoke check + version verification"
sleep 6
if command -v curl >/dev/null 2>&1; then
  echo "--- HTTP status ---"
  curl -sS -o /dev/null -w "GET /            HTTP %{http_code}\n" "http://localhost:${PORT:-5000}/" || echo "FAIL: root endpoint not reachable"
  echo "--- /api/health version ---"
  HEALTH=$(curl -sS "http://localhost:${PORT:-5000}/api/health" 2>/dev/null)
  echo "$HEALTH"
  if echo "$HEALTH" | grep -q '"version":"25.45.0"'; then
    echo ""
    echo "    ✓✓✓ v25.45.0 IS LIVE — deploy verified ✓✓✓"
  else
    echo ""
    echo "    !!! FAIL: /api/health did NOT report version 25.45.0"
    echo "    !!! Check (1) .env has APP_VERSION=25.45.0  (2) the server restarted  (3) PORT env var"
  fi
fi

echo "==> v25.45 deploy complete (v25.43 -> v25.45 jump, includes v25.44)."
echo "==> Backup of pre-deploy state at: $TARGET/$BACKUP"
echo "==> Rollback: see migrations/ROLLBACK_v25_44.md and migrations/ROLLBACK_v25_45.md"
