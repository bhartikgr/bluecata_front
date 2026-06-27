#!/usr/bin/env bash
# Capavate v24.4.1 deploy script — to be run inside the capavate-app/ directory.
# Idempotent: safe to re-run.

set -e

# Quick prelude — show what we're doing
echo "[deploy_v24_4_1] ============================================="
echo "[deploy_v24_4_1] Capavate v24.4.1 deploy"
echo "[deploy_v24_4_1] Running in: $(pwd)"
echo "[deploy_v24_4_1] ============================================="

# Sanity check: are we in the right directory?
if [ ! -f "package.json" ]; then
  echo "[deploy_v24_4_1] FATAL: no package.json found in $(pwd)"
  echo "[deploy_v24_4_1] Run this script from inside capavate-app/"
  exit 1
fi

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
if [ "$VERSION" != "24.4.1" ]; then
  echo "[deploy_v24_4_1] WARNING: package.json reports version=$VERSION (expected 24.4.1)"
  echo "[deploy_v24_4_1] Did you extract the right bundle? Continuing anyway in 3s..."
  sleep 3
fi
echo "[deploy_v24_4_1] package.json version = $VERSION"

# Step 1 — Install deps if node_modules missing
if [ ! -d "node_modules" ]; then
  echo "[deploy_v24_4_1] node_modules missing — running npm install..."
  npm install --omit=dev
else
  echo "[deploy_v24_4_1] node_modules already present — skipping install"
fi

# Step 2 — Build (skip if dist/index.cjs already exists from the bundle)
if [ -f "dist/index.cjs" ]; then
  echo "[deploy_v24_4_1] dist/index.cjs already exists (shipped in bundle) — skipping build"
else
  echo "[deploy_v24_4_1] Running npm run build..."
  npm run build
fi
echo "[deploy_v24_4_1] ✓ build OK"

# Step 3 — Backup the existing data.db (just in case the operator forgot)
if [ -f "data.db" ]; then
  BACKUP="data.db.predeploy.v24_4_1.$(date +%Y%m%d_%H%M%S).bak"
  cp data.db "$BACKUP"
  echo "[deploy_v24_4_1] Backed up data.db -> $BACKUP"
fi

# Step 4 — Run db:doctor in dry-run mode to confirm schema is current
echo "[deploy_v24_4_1] running db:doctor..."
# db:doctor runs as part of normal boot — we boot to a quick smoke + kill
# it once it logs success. Output goes to /tmp/v241_dbdoctor.log.
SMOKE_LOG="/tmp/v241_dbdoctor.log"
rm -f "$SMOKE_LOG"
NODE_ENV=production node dist/index.cjs > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
sleep 5
if grep -q "db:doctor passed" "$SMOKE_LOG"; then
  echo "[deploy_v24_4_1] ✓ db:doctor OK"
else
  echo "[deploy_v24_4_1] ✗ db:doctor did NOT pass — check $SMOKE_LOG"
  kill $SMOKE_PID 2>/dev/null || true
  tail -30 "$SMOKE_LOG"
  exit 2
fi
# Kill the smoke server — production should be (re)started via pm2/systemd
kill $SMOKE_PID 2>/dev/null || true
sleep 1

echo "[deploy_v24_4_1] ============================================="
echo "[deploy_v24_4_1] ✓ v24.4.1 ready to start"
echo "[deploy_v24_4_1] ============================================="
echo ""
echo "Next: restart via pm2/systemd"
echo "  pm2 restart capavate          # if using pm2"
echo "  sudo systemctl restart capavate   # if using systemd"
echo ""
echo "Then verify: curl -s https://capavate.com/api/health | jq .version"
echo "Expected: \"24.4.1\""
