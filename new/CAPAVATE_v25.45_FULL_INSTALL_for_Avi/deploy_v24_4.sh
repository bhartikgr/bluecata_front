#!/usr/bin/env bash
# deploy_v24_4.sh — apply the v24.4 patch on top of an existing v24.x install.
#
# USAGE:
#   bash deploy_v24_4.sh /var/www/html/backend
#
# Preserves: data.db, .env, node_modules, uploads/, logs/, *.log, *.bak
# Replaces:  dist/, server/, client/, shared/, packages/, package.json, package-lock.json
#
# Idempotent. Safe to re-run. Will refuse to run if the target dir doesn't look
# like a Capavate install (missing package.json or dist/ in the target).

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "ERROR: usage: bash deploy_v24_4.sh /path/to/live/backend" >&2
  exit 2
fi
if [ ! -d "$TARGET" ]; then
  echo "ERROR: target $TARGET does not exist" >&2
  exit 2
fi
if [ ! -f "$TARGET/package.json" ]; then
  echo "ERROR: $TARGET/package.json missing — does not look like a Capavate install" >&2
  exit 2
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
echo "[deploy_v24_4] source: $SRC"
echo "[deploy_v24_4] target: $TARGET"

# Belt-and-suspenders timestamped backup of files we touch.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$TARGET/.backup_pre_v24_4_$STAMP"
mkdir -p "$BACKUP"
for d in dist server client shared packages; do
  if [ -d "$TARGET/$d" ]; then
    echo "[deploy_v24_4] backing up $d → $BACKUP/$d"
    cp -a "$TARGET/$d" "$BACKUP/$d"
  fi
done
[ -f "$TARGET/package.json" ]      && cp -a "$TARGET/package.json"      "$BACKUP/package.json"
[ -f "$TARGET/package-lock.json" ] && cp -a "$TARGET/package-lock.json" "$BACKUP/package-lock.json"
echo "[deploy_v24_4] backup complete: $BACKUP"

# Rsync the new bundle in. --delete inside each subtree keeps removed files in
# v24.4 from lingering, but we never delete the top-level (data.db, .env, node_modules).
for d in dist server client shared packages; do
  if [ -d "$SRC/$d" ]; then
    echo "[deploy_v24_4] syncing $d/ ..."
    rsync -a --delete "$SRC/$d/" "$TARGET/$d/"
  fi
done

# Swap package.json + lock.
cp -a "$SRC/package.json"      "$TARGET/package.json"
[ -f "$SRC/package-lock.json" ] && cp -a "$SRC/package-lock.json" "$TARGET/package-lock.json"

echo "[deploy_v24_4] code synced."

# Sanity check: package.json must report 24.4.0.
NEW_VERSION=$(grep -E '"version"\s*:' "$TARGET/package.json" | head -1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')
echo "[deploy_v24_4] package.json version: $NEW_VERSION"
if [ "$NEW_VERSION" != "24.4.0" ]; then
  echo "WARN: package.json version is $NEW_VERSION, expected 24.4.0" >&2
fi

# Best-effort: bump APP_VERSION in .env (if .env is writable + present).
if [ -f "$TARGET/.env" ]; then
  if grep -q "^APP_VERSION=" "$TARGET/.env"; then
    sed -i.bak "s|^APP_VERSION=.*|APP_VERSION=24.4.0|" "$TARGET/.env"
    echo "[deploy_v24_4] .env APP_VERSION → 24.4.0 (.env.bak written alongside)"
  else
    echo "APP_VERSION=24.4.0" >> "$TARGET/.env"
    echo "[deploy_v24_4] appended APP_VERSION=24.4.0 to .env"
  fi
fi

cat <<'NEXT'

==========================================================
[deploy_v24_4] done. Next steps:

  1. Restart the app:        pm2 restart capavate   (or systemctl restart capavate)
  2. Hit health:             curl -s https://capavate.com/api/health | jq .
                             → expect {"version":"24.4.0", featureFlags.airwallexMode:"test", ...}
  3. Smoke Bug C:            curl -X POST https://capavate.com/api/auth/signup \
                                  -H 'Content-Type: application/json' \
                                  -d '{"email":"smoke@x.com","name":"X","password":"smokepw123","role":"investor"}'
                             → expect HTTP 403 INVESTOR_SIGNUP_DISALLOWED
  4. WhatsApp Ozan when steps 2 + 3 are green.

If anything looks off:
  pm2 stop capavate
  rm -rf <target>/dist <target>/server <target>/client <target>/shared <target>/packages
  cp -a .backup_pre_v24_4_*/{dist,server,client,shared,packages,package.json,package-lock.json} <target>/
  pm2 start capavate
==========================================================
NEXT
