# INSTALL — Capavate v24.5

**For:** Avinay
**From:** Ozan
**Date:** 2026-06-10
**Bundle:** `CAPAVATE_v24.5_FULL_BUNDLE_for_Avi.zip`

## TL;DR

This wave is the launch-readiness drop. Builds on v24.4.2 (which fixed your June-10 round-flow + Airwallex bugs) and adds:
- All 7 product gaps that the v24.4.2 audit surfaced — fixed
- 3 new comprehensive E2E suites covering all 3 components × all roles × cross-component data flows × real browser DOM clicks
- 1 product bug found by the new DOM tests — fixed (broken logo asset path)
- Total: **352 PASS / 1 FAIL / 56 SKIP** across 8 E2E suites. The 1 FAIL is a test-orchestration prerequisite, not a product bug.

**No DB migrations to run** — v24.5 schema changes (`bridge_event_history` table) auto-create via CREATE TABLE IF NOT EXISTS. **Time to deploy: ~5 minutes.**

---

## Step 1 — Download the bundle

Ozan will WhatsApp you `CAPAVATE_v24.5_FULL_BUNDLE_for_Avi.zip` (~5.9MB). Save it OUTSIDE the running `capavate-app/` directory.

```
~/Downloads/CAPAVATE_v24.5_FULL_BUNDLE_for_Avi.zip
```

## Step 2 — Take a backup of prod data.db

```bash
cd ~/capavate-app
cp data.db data.db.v24_4_2.bak.$(date +%Y%m%d_%H%M%S)
ls -la data.db*
```

## Step 3 — Stop the running server

```bash
pm2 stop capavate
# or: sudo systemctl stop capavate
# or: pkill -f "node dist/index.cjs"
```

## Step 4 — Extract the new bundle

```bash
cd ~
unzip -o ~/Downloads/CAPAVATE_v24.5_FULL_BUNDLE_for_Avi.zip
```

`data.db` is NOT in the bundle — your existing v24.4.2 prod data is preserved as-is.

## Step 5 — Install deps if package.json changed

```bash
cd ~/capavate-app
npm install --omit=dev
```

## Step 6 — Run the deploy script

```bash
cd ~/capavate-app
bash deploy_v24_5.sh
```

Expected last lines:
```
[deploy_v24_5] ✓ build OK
[deploy_v24_5] ✓ db:doctor OK
[deploy_v24_5] ✓ v24.5 ready to start
```

If db:doctor fails, **STOP** and WhatsApp me with the error.

## Step 7 — Start the server

```bash
pm2 start capavate
```

## Step 8 — Verify

```bash
curl -s https://capavate.com/api/health | jq
```

Expected JSON:
- `"version": "24.5.0"` ← must be exactly this
- `"db": "connected"`
- `"hydrate_state": "ok"`
- `"featureFlags.airwallexMode": "stub"` (since your `.env` has `AIRWALLEX_REAL_NETWORK=0`)

## Step 9 — Smoke checks (5 minutes)

Open https://capavate.com in an incognito window.

### Smoke 1 — Round flow (v24.4.2 Bug H still working)
1. Log in as test founder.
2. Open a round with a confirmed soft-circle.
3. Click **Mark wire funded**. Badge turns violet **Wired**.
4. CommitPipeline's **Commit funded → cap-table** button enables.
5. Click it. Cap-table entries written.

### Smoke 2 — Airwallex stub mode (v24.4.2 Bug F)
1. Fresh founder → billing → pick plan → submit.
2. Lands on `/founder/billing/return` directly (no redirect to Airwallex). Within ~1s, you're at the dashboard with subscription `active`.

### Smoke 3 — Admin Collective members list (v24.5 Gap 1)
1. Admin → Collective Members → click **Bootstrap Member** with a real email.
2. Immediately refresh the page. Member shows in list. (Before v24.5 you'd have to reload twice or restart server.)

### Smoke 4 — Bridge SSE history (v24.5 Gap 2)
1. Admin → navigate to `/api/admin/bridge/history?limit=10`
2. Returns up to 10 most recent bridge events. Empty array OK if no events yet.

### Smoke 5 — Welcome ack route (v24.5 Gap 6)
1. As a founder, open dev console and:
   ```js
   await fetch('/api/welcome/ack', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}).then(r => r.json())
   ```
   → `{ok: true}`
2. Refresh:
   ```js
   await fetch('/api/welcome/ack').then(r => r.json())
   ```
   → `{acknowledged: true}` — persists across server restarts.

### Smoke 6 — Archived partner audit (v24.5 Gap 4)
1. Admin → archive a partner.
2. Navigate to `/api/admin/partners/:partnerId/workspace/audit`
3. Returns full snapshot of team_members + notes + tasks + files even though partner is archived.

### Smoke 7 — SPV commitments/distributions (v24.5 Gap 7)
1. As partner admin, create an SPV → POST a commitment using the returned `pspv_*` id.
2. Before v24.5: 404 NOT_FOUND. After v24.5: 200 with commitment row created.

### Smoke 8 — Durability (still solid from v24.4.1/v24.4.2)
1. Open partner record with team members + notes + tasks.
2. `pm2 restart capavate`. Wait 5s.
3. Re-open. All data still there.

---

## What changed in v24.5 (file-by-file)

### v24.5 product gap fixes
| Gap | File(s) | Change |
|---|---|---|
| 1 | `server/collectiveMembershipStore.ts` | `listActive()` now does DB-fallback read after Map, merges DB rows |
| 2 | `server/db/connection.ts` (schema), `server/bridgeOutbox.ts`, `server/adminBridgeRoutes.ts` | New `bridge_event_history` table + drain-path INSERT + `GET /api/admin/bridge/history` route |
| 3 | `server/collectiveRoutes.ts` | `/api/collective/soft-circles` now accepts `id.isAdmin` in addition to collective members |
| 4 | `server/adminPartnerRoutes.ts` | New `GET /api/admin/partners/:partnerId/workspace/audit` — admin-only snapshot |
| 5 | `scripts/create_partner_admin.ts` | `--partnerId` failure now falls back to `--email` lookup in adminContactsStore |
| 6 | `server/routes.ts` | POST + GET `/api/welcome/ack` wired (auth-required, calls welcomeStore) |
| 7 | `server/spvFundStore.ts` | `shadowPersistFromLegacy()` passes `_overrideId: args.legacyId` so spvFundStore row gets legacy `pspv_*` id; `byLegacyId` lookup for backward compat |

### v24.5 asset fix (broken logo path)
- Added `/dist/public/assets/capavate-logo-dark.png` (copy of `/assets/home/...` version) so home3compo references resolve. Sacred source code NOT modified.
- Added `/dist/public/assets/capavate-logo-white.png` likewise.

### Sacred files NOT modified
- `packages/cap-table-engine/src/**` — all 10 files byte-identical
- `client/src/pages/founder/RoundNew.tsx` STEPS array — byte-identical
- `shared/schema.ts` — byte-identical
- All home3compo `.jsx` files — byte-identical (asset fix done via file path, not code change)
- All 36 sacred SHAs verified.

### TypeScript baseline
- `tsc --noEmit` = **633 errors** — identical to v24.4.2 / v24.4.1 / v24.4 / v24.3.0. Zero new TS errors.

---

## Rollback (if anything goes sideways)

```bash
cd ~/capavate-app
pm2 stop capavate
cp data.db.v24_4_2.bak.<timestamp> data.db
# unzip the v24.4.2 bundle back over the top
pm2 start capavate
```

WhatsApp me with the error log.

---

## Questions?

WhatsApp me. I have the full master report, the gap-fix report, and all 8 E2E suite logs.
