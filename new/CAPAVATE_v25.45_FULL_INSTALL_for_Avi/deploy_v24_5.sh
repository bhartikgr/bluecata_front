#!/usr/bin/env bash
# Capavate v24.5 deploy script — run inside capavate-app/.
# Idempotent: safe to re-run.

set -e

echo "[deploy_v24_5] ============================================="
echo "[deploy_v24_5] Capavate v24.5 deploy"
echo "[deploy_v24_5] Running in: $(pwd)"
echo "[deploy_v24_5] ============================================="

if [ ! -f "package.json" ]; then
  echo "[deploy_v24_5] FATAL: no package.json found in $(pwd)"
  echo "[deploy_v24_5] Run this script from inside capavate-app/"
  exit 1
fi

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
if [ "$VERSION" != "24.5.0" ]; then
  echo "[deploy_v24_5] WARNING: package.json reports version=$VERSION (expected 24.5.0)"
  sleep 3
fi
echo "[deploy_v24_5] package.json version = $VERSION"

if [ ! -d "node_modules" ]; then
  echo "[deploy_v24_5] node_modules missing — running npm install..."
  npm install --omit=dev
else
  echo "[deploy_v24_5] node_modules present — skipping install"
fi

if [ -f "dist/index.cjs" ]; then
  echo "[deploy_v24_5] dist/index.cjs already exists (shipped in bundle) — skipping build"
else
  echo "[deploy_v24_5] Running npm run build..."
  npm run build
fi
echo "[deploy_v24_5] ✓ build OK"

if [ -f "data.db" ]; then
  BACKUP="data.db.predeploy.v24_5.$(date +%Y%m%d_%H%M%S).bak"
  cp data.db "$BACKUP"
  echo "[deploy_v24_5] Backed up data.db -> $BACKUP"
fi

# db:doctor via smoke boot
echo "[deploy_v24_5] running db:doctor..."
SMOKE_LOG="/tmp/v25_dbdoctor.log"
rm -f "$SMOKE_LOG"
NODE_ENV=production node dist/index.cjs > "$SMOKE_LOG" 2>&1 &
SMOKE_PID=$!
sleep 5
if grep -q "db:doctor passed" "$SMOKE_LOG"; then
  echo "[deploy_v24_5] ✓ db:doctor OK"
else
  echo "[deploy_v24_5] ✗ db:doctor did NOT pass — check $SMOKE_LOG"
  kill $SMOKE_PID 2>/dev/null || true
  tail -30 "$SMOKE_LOG"
  exit 2
fi
kill $SMOKE_PID 2>/dev/null || true
sleep 1

echo "[deploy_v24_5] ============================================="
echo "[deploy_v24_5] ✓ v24.5 ready to start"
echo "[deploy_v24_5] ============================================="
echo ""
echo "Next: restart via pm2/systemd"
echo "  pm2 restart capavate"
echo "  sudo systemctl restart capavate"
echo ""
echo "Then verify: curl -s https://capavate.com/api/health | jq .version"
echo "Expected: \"24.5.0\""
