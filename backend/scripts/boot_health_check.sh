#!/usr/bin/env bash
# v24.2 gate: boot the built server with AIRWALLEX env vars and assert /api/health == 24.2.0
set -u
cd /home/user/workspace/avi_v24_2_tree
pkill -f "dist/index.cjs" 2>/dev/null || true
sleep 1
mkdir -p /tmp/capdb
rm -f /tmp/capdb/health.db

AIRWALLEX_API_KEY=test_key \
AIRWALLEX_CLIENT_ID=test_cid \
AIRWALLEX_WEBHOOK_SECRET=test_secret \
DATABASE_URL="file:/tmp/capdb/health.db" \
APP_VERSION=24.2.0 \
PORT=5099 \
NODE_ENV=production \
node dist/index.cjs > /tmp/boot_health.log 2>&1 &
BOOT_PID=$!
echo "server pid=$BOOT_PID"

# Poll health for up to ~25s
VERSION=""
for i in $(seq 1 25); do
  sleep 1
  BODY=$(curl -s http://127.0.0.1:5099/api/health 2>/dev/null || true)
  if [ -n "$BODY" ]; then
    echo "health body: $BODY"
    VERSION=$(echo "$BODY" | grep -oE '"version":"[^"]*"' | head -1)
    [ -n "$VERSION" ] && break
  fi
done

echo "----- boot log tail -----"
grep -vE "durable-map" /tmp/boot_health.log | tail -15
echo "----- result -----"
echo "VERSION_FIELD=$VERSION"

kill "$BOOT_PID" 2>/dev/null || true
pkill -f "dist/index.cjs" 2>/dev/null || true

if echo "$VERSION" | grep -q '24.2.0'; then
  echo "HEALTH_GATE=PASS"
  exit 0
else
  echo "HEALTH_GATE=FAIL"
  exit 1
fi
