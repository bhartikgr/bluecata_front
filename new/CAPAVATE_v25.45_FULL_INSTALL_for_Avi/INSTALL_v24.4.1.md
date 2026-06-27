# INSTALL — Capavate v24.4.1

**For:** Avinay
**From:** Ozan
**Date:** 2026-06-09
**Bundle:** `CAPAVATE_v24.4.1_FULL_BUNDLE_for_Avi.zip`

## TL;DR

This wave **fixes the in-memory data loss** that you flagged across multiple waves. Six stores now write directly to the DB, so restarts no longer wipe partner teams, payment ledger, intro requests, transaction-prep channels, welcome acks, or investor profiles. Plus four production bug fixes (Bug 1: collective network 404; Bug 2: partner CLI cross-process; Bug 3: invite redemption URL surfacing; Bug 4: collective member suspend route).

**Time to deploy: ~5 minutes.** No DB migrations to run — all 11 new tables auto-create via `CREATE TABLE IF NOT EXISTS`.

---

## Step 1 — Download the bundle

Ozan will send you `CAPAVATE_v24.4.1_FULL_BUNDLE_for_Avi.zip` via WhatsApp. Save it to your deploy machine, **not inside** the running `capavate-app/` directory.

Example:
```
~/Downloads/CAPAVATE_v24.4.1_FULL_BUNDLE_for_Avi.zip
```

## Step 2 — Take a backup of prod data

**Do this before anything else** — `data.db` holds all live company / cap-table / partner records.

```bash
cd ~/capavate-app           # or wherever capavate-app is on the prod box
cp data.db data.db.v23.4.13.bak.$(date +%Y%m%d_%H%M%S)
ls -la data.db*             # confirm the .bak file exists
```

## Step 3 — Stop the running server

```bash
# If you're using pm2:
pm2 stop capavate

# If you're using systemd:
sudo systemctl stop capavate

# If you're running with node directly:
# find the PID and kill it
pkill -f "node dist/index.cjs"
```

## Step 4 — Extract the new bundle over the old app

```bash
cd ~                                                # parent of capavate-app
unzip -o ~/Downloads/CAPAVATE_v24.4.1_FULL_BUNDLE_for_Avi.zip
# The zip extracts into capavate-app/  (overwrites everything except data.db)
```

The zip does **not** contain `data.db` — your existing `data.db` from step 2 is preserved as-is.

## Step 5 — Install dependencies (only if package.json changed)

```bash
cd ~/capavate-app
npm install --omit=dev
```

If you already have node_modules and want to be safe:
```bash
rm -rf node_modules
npm install --omit=dev
```

## Step 6 — Run the deploy script

We've packaged a one-command deploy script. It builds (if `dist/` not already shipped), runs `db:doctor`, and confirms the schema.

```bash
cd ~/capavate-app
bash deploy_v24_4_1.sh
```

**Expected output (last 10 lines):**
```
[deploy_v24_4_1] ✓ build OK
[deploy_v24_4_1] running db:doctor...
[boot] db:doctor passed — schema is current
[deploy_v24_4_1] ✓ db:doctor OK
[deploy_v24_4_1] ✓ v24.4.1 ready to start
```

If `db:doctor` fails, **STOP** — do not start the server. WhatsApp Ozan with the error output.

## Step 7 — Start the server

```bash
# pm2:
pm2 start capavate

# systemd:
sudo systemctl start capavate

# Or direct:
NODE_ENV=production node dist/index.cjs
```

## Step 8 — Verify the deploy

```bash
# From the same box (or via curl from your machine):
curl -s https://capavate.com/api/health | jq
```

**Expected JSON keys to confirm:**
- `"version": "24.4.1"`  ← MUST be exactly this
- `"db": "connected"`
- `"hydrate_state": "ok"` (or `"partial"` if some legacy stub hydrators warn — that's fine)
- `"status": "ok"`

If `version` is not `24.4.1` you did not actually deploy the new bundle.

## Step 9 — Smoke checks (3 minutes)

Open https://capavate.com in an incognito window and:

1. **Login as an existing admin** (your usual admin account). Confirm the dashboard loads — no blank screen, no console errors.
2. **Open the Collective tab** in admin. Confirm the network endpoint (`/api/collective/network`) loads without a 404 — this is Bug 1.
3. **Open a partner record** (Consortium → Partners → any approved). Confirm team members, notes, and tasks all show as before. **They should still be there** — the DB migration preserves the existing rows.
4. **Try an investor signup** at https://capavate.com/signup. You should get a 403 ("INVESTOR_SIGNUP_DISALLOWED") — investors must come via invitation only. This is the Bug C smoke from earlier waves; it must still block.
5. **Restart the server** (`pm2 restart capavate`). After ~5 seconds, open the same partner record from step 3. **Team members, notes, tasks must still be there.** Before v24.4.1 they would have been wiped. This is the core fix Ozan wanted you to verify.

## Step 10 — If anything goes wrong (rollback)

```bash
cd ~/capavate-app
pm2 stop capavate
cp data.db.v23.4.13.bak.<timestamp> data.db  # restore your backup
# unzip the previous v23.4.13 / v24.3.0 zip over the top
pm2 start capavate
```

Or WhatsApp Ozan immediately.

---

## What changed (file-by-file summary, for your audit)

### v24.4.1 product-bug fixes
- `server/routes.ts` — wired `registerSprint20Wave2Routes(app)` (Bug 1)
- `scripts/create_partner_admin.ts` — `await hydrateAdminContactsStore()` before lookup (Bug 2)
- `server/adminContactsStore.ts` + `server/consortiumApplyStore.ts` — `preferredId` param + `partnerInviteRedeemUrl` in response (Bug 3)
- `server/adminCollectiveRoutes.ts` — new `POST /api/admin/collective/members/:userId/suspend` route (Bug 4)

### v24.4.1 RAM→DB migrations
- `server/db/connection.ts` — 11 new `CREATE TABLE IF NOT EXISTS` blocks
- `server/welcomeStore.ts` — write-through + hydrate
- `server/transactionPrepStore.ts` — write-through + hydrate
- `server/introRequestStore.ts` — write-through + hydrate
- `server/paymentStore.ts` — write-through + hydrate
- `server/profileStore.ts` — write-through + hydrate (investor only; companies already DB-backed in v24.2)
- `server/partnerWorkspaceStore.ts` — write-through for team/notes/tasks/files/settings + hydrate + **DB fallback in `findByUserId`** (this fixes the cross-process CLI issue)
- `server/lib/hydrateStores.ts` — six new hydrators registered in `HYDRATE_ORDER`

### Sacred files (NOT modified)
- `server/lib/capTableEngine.ts` — byte-identical to v24.3.0
- `client/src/pages/founder/RoundNew.tsx` — STEPS array byte-identical to v24.3.0
- All 36 sacred file SHAs verified.

### TypeScript baseline
- `tsc --noEmit` reports 633 errors — **identical** to v24.4 and v24.3.0. No new TS errors introduced by any of the six migrations.

---

## Questions?

WhatsApp Ozan. He has the full master report (`capavate_master_report_v24_4_1.md`) and all four E2E test logs.
