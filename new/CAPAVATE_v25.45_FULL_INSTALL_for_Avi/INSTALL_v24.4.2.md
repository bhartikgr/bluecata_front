# INSTALL — Capavate v24.4.2

**For:** Avinay
**From:** Ozan
**Date:** 2026-06-10
**Bundle:** `CAPAVATE_v24.4.2_FULL_BUNDLE_for_Avi.zip`

## TL;DR

This wave is the **direct response to your June-10 feedback** after you installed v24.4.1. All 3 bugs you reported are fixed:

1. **Bug H — Round flow blocker** — soft-circle now advances through wired → funded-queue → Commit-cap-table enable. The whole money path works end-to-end.
2. **Bug F — Airwallex stub mode** — `AIRWALLEX_REAL_NETWORK=0` now correctly auto-succeeds in test mode. No more blank page. Payment status reaches "active" on first poll.
3. **Bug G — REAL_NETWORK toggle UX** — both =0 and =1 modes now show clear error/status messaging instead of blank pages or generic 500s.

**Time to deploy: ~5 minutes.** No DB migrations to run — the v24.4.2 changes are pure code; the v24.4.1 schema (which is already in your prod DB) is unchanged.

---

## Step 1 — Download the bundle

Ozan will WhatsApp you `CAPAVATE_v24.4.2_FULL_BUNDLE_for_Avi.zip`. Save it OUTSIDE the running `capavate-app/` directory.

Example:
```
~/Downloads/CAPAVATE_v24.4.2_FULL_BUNDLE_for_Avi.zip
```

## Step 2 — Take a backup of prod data.db

**Always do this first.**

```bash
cd ~/capavate-app
cp data.db data.db.v24_4_1.bak.$(date +%Y%m%d_%H%M%S)
ls -la data.db*
```

## Step 3 — Stop the running server

```bash
pm2 stop capavate
# or: sudo systemctl stop capavate
# or: pkill -f "node dist/index.cjs"
```

## Step 4 — Extract the new bundle over the old app

```bash
cd ~
unzip -o ~/Downloads/CAPAVATE_v24.4.2_FULL_BUNDLE_for_Avi.zip
```

`data.db` is NOT in the bundle — your existing v24.4.1 prod data is preserved exactly as-is.

## Step 5 — Install deps (only if package.json changed)

```bash
cd ~/capavate-app
npm install --omit=dev
```

For safety, you can also do:
```bash
rm -rf node_modules
npm install --omit=dev
```

## Step 6 — Run the deploy script

```bash
cd ~/capavate-app
bash deploy_v24_4_2.sh
```

**Expected last lines:**
```
[deploy_v24_4_2] ✓ build OK
[deploy_v24_4_2] ✓ db:doctor OK
[deploy_v24_4_2] ✓ v24.4.2 ready to start
```

If db:doctor fails, **STOP** and WhatsApp me with the error output.

## Step 7 — Start the server

```bash
pm2 start capavate
# or: sudo systemctl start capavate
```

## Step 8 — Verify

```bash
curl -s https://capavate.com/api/health | jq
```

**Expected JSON keys:**
- `"version": "24.4.2"` ← must be exactly this
- `"db": "connected"`
- `"hydrate_state": "ok"`
- `"featureFlags": { ..., "airwallexMode": "stub" }` (since `AIRWALLEX_REAL_NETWORK=0` in your .env)

## Step 9 — Smoke checks for the 3 fixes (5 minutes)

Open https://capavate.com in an incognito window.

### Smoke 1 — Round flow (Bug H)
1. Log in as your test founder.
2. Open an existing round (or create a new one).
3. Find a soft-circle in "confirmed" state. Click **Mark wire funded**.
4. The status badge should now show **Wired** in violet.
5. Scroll down to the **Commit Pipeline** card. The "Commit funded → cap-table" button should now be **enabled**.
6. Click it. Cap-table entries should be written.

Before v24.4.2 you would have been stuck after step 3. The badge stayed "confirmed" and the Commit button never enabled.

### Smoke 2 — Airwallex test-mode payment (Bug F)
With your `.env` still set to `AIRWALLEX_REAL_NETWORK=0` (stub mode):

1. Log in as a fresh founder that hasn't subscribed yet.
2. Go to billing / pick a plan.
3. Submit the plan checkout.

**Before v24.4.2:** the page would redirect to `checkout.airwallex.com` and show blank/404.
**After v24.4.2:** you should land on `/founder/billing/return` directly, see a brief "Activating..." flash, and within ~1 second be redirected to the founder dashboard. Subscription status will be `active`.

You can also verify directly:
```bash
curl -s https://capavate.com/api/health | jq .featureFlags.airwallexMode
# Should print: "stub"
```

### Smoke 3 — REAL_NETWORK toggle (Bug G)
This is optional unless you want to switch to live mode. If `.env` has `AIRWALLEX_REAL_NETWORK=1` and credentials are stale, billing/plan now returns a clear `503 gateway_network_error` with a readable message instead of a generic 500.

### Smoke 4 — Round name editable post-create (carryover from v24.4)
1. Edit any round's terms.
2. Confirm you can change the name.

### Smoke 5 — Durability (v24.4.1 RAM→DB)
1. Open a partner record. See team members, notes, tasks.
2. `pm2 restart capavate`. Wait 5s.
3. Re-open the same partner record. Everything still there.

---

## What changed in v24.4.2 (file-by-file)

| File | Change |
|---|---|
| `package.json` | Version bump 24.4.1 → 24.4.2 |
| `.env` | APP_VERSION bump |
| `server/softCircleStore.ts:31` | Added `"wired"` to SoftCircleStatus type |
| `server/captableCommitStore.ts:746` | `updateSoftCircleStatus(scId, "confirmed")` → `"wired"` (Bug H) |
| `server/routes.ts` (billing/plan) | Stub auto-progression + gateway_network_error handling (Bug F + G) |
| `client/src/components/common.tsx` | Violet "Wired" badge in STATE_COLORS (Bug H) |
| `client/src/components/PaymentSurface.tsx` | gateway_network_error onError handler (Bug G) |
| `client/src/pages/founder/RoundDetail.tsx` | wireFundedMut ledger invalidation + CommitPipeline reads from funded-queue (Bug H) |

### Sacred files NOT modified
- `packages/cap-table-engine/src/**` — all 10 files byte-identical to v24.3.0
- `client/src/pages/founder/RoundNew.tsx` STEPS array — byte-identical
- `shared/schema.ts` — byte-identical
- All 36 sacred SHAs verified pre-shipment.

### TypeScript baseline
- `tsc --noEmit` reports **633 errors** — identical to v24.4.1 / v24.4 / v24.3.0. Zero new TS errors.

---

## Rollback (if anything goes sideways)

```bash
cd ~/capavate-app
pm2 stop capavate
cp data.db.v24_4_1.bak.<timestamp> data.db
# unzip the v24.4.1 bundle back over the top
pm2 start capavate
```

WhatsApp me with the error log.

---

## Questions?

WhatsApp me. I have the full master report, the bug-fix report, and all 5 E2E suite logs.
