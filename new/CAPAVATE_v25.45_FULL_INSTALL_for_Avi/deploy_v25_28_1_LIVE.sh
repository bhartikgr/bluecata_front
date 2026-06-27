#!/bin/bash
# Capavate v25.28.1.1 LIVE deploy — Airwallex money fix + Phases C/D/E
# Target: GoDaddy WHM VPS, AlmaLinux 9.8, PM2 process "backend"
#
# Pre-conditions:
#   - Backend at /var/www/html/backend/, frontend at /var/www/html/frontend/
#   - PM2 process "backend" runs `tsx server/index.ts`
#   - Existing data.db at /var/www/html/backend/data.db
#   - This script is RUN ON THE PROD SERVER from the v25.28.1.1 unzipped tree.

set -e

BACKEND=/var/www/html/backend
FRONTEND=/var/www/html/frontend
SRC=$(pwd)

echo "[v25.28.1.1] Pre-flight checks..."
[ -d "$BACKEND" ] || { echo "ERROR: $BACKEND not found"; exit 1; }
[ -d "$FRONTEND" ] || { echo "ERROR: $FRONTEND not found"; exit 1; }
command -v pm2 >/dev/null || { echo "ERROR: pm2 not installed"; exit 1; }
[ -f "$BACKEND/data.db" ] && echo "[v25.28.1.1] data.db present (preserving)"

echo "[v25.28.1.1] Backing up current backend (without node_modules)..."
TS=$(date +%Y%m%d_%H%M%S)
BAK=/var/www/html/backups/backend_pre_v25_28_1_${TS}
mkdir -p "$BAK"
rsync -a --exclude='node_modules' --exclude='*.db-shm' --exclude='*.db-wal' "$BACKEND/" "$BAK/" >/dev/null
echo "[v25.28.1.1] Backup: $BAK"

echo "[v25.28.1.1] Patching changed server files..."
cp -v "$SRC/server/lib/airwallexGateway.ts"        "$BACKEND/server/lib/airwallexGateway.ts"
cp -v "$SRC/server/routes.ts"                      "$BACKEND/server/routes.ts"
cp -v "$SRC/server/emailStore.ts"                  "$BACKEND/server/emailStore.ts"
cp -v "$SRC/server/lib/hydrateStores.ts"           "$BACKEND/server/lib/hydrateStores.ts"
cp -v "$SRC/server/adminPlatformStore.ts"          "$BACKEND/server/adminPlatformStore.ts"
cp -v "$SRC/server/bridgeStore.ts"                 "$BACKEND/server/bridgeStore.ts"
cp -v "$SRC/server/partnerWorkspaceStore.ts"       "$BACKEND/server/partnerWorkspaceStore.ts"
cp -v "$SRC/package.json"                          "$BACKEND/package.json"

# Updated client bundle for the frontend
echo "[v25.28.1.1] Patching client bundle..."
[ -d "$SRC/dist/public" ] && rsync -a --delete "$SRC/dist/public/" "$FRONTEND/"

# Updated server bundle (in case PM2 runs the cjs build instead of tsx)
[ -f "$SRC/dist/index.cjs" ] && cp -v "$SRC/dist/index.cjs" "$BACKEND/dist/index.cjs"

echo "[v25.28.1.1] Reloading PM2 process 'backend'..."
pm2 reload backend --update-env || pm2 restart backend
sleep 4

echo "[v25.28.1.1] Smoke checks..."
PORT=${PORT:-5000}
HEALTH=$(curl -s --max-time 6 "http://127.0.0.1:${PORT}/api/health")
echo "  /api/health  → ${HEALTH:0:200}"
echo "$HEALTH" | grep -q '"version":"25.28.1' && echo "  ✓ version 25.28.1 detected" || echo "  ⚠ version field not 25.28.1; verify package.json deployed"
echo "$HEALTH" | grep -q '"status":"ok"' && echo "  ✓ server status ok" || { echo "  ✗ server NOT ok"; exit 1; }

echo "[v25.28.1.1] Done. Tail PM2 logs: pm2 logs backend --lines 30"
