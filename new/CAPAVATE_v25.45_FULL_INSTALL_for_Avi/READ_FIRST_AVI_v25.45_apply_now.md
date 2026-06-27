# READ FIRST — Avi, your install is still v25.41

**For:** Avi
**From:** Ozan
**Date:** Friday, June 26, 2026
**Status:** URGENT — the three bugs you reported are already fixed in v25.45 but your install is still v25.41. You need to apply the v25.45 patch.

---

## What the audit of your zip showed

After unpacking the zip you sent (`capavateAIzip-45.zip`), four things confirm your running install is still v25.41:

| Check | What we found | What it means |
|---|---|---|
| `package.json` `"version"` | `25.41.0` | Not v25.45 |
| `data.db` → `_migrations_applied` table | Most-recent rows are both from June 16, 2026 (`cp_b_promotion_moderation_backfill_v1` and `cp_a_crm_chain_stitch_v1` — Consortium Partners Phase B from v25.31) | No v25.42 / v25.43 / v25.44 / v25.45 migration has run |
| `data.db` tables | `workspace_archive_state` MISSING · `round_chain_head_freezes` MISSING | v25.45 schema not applied |
| `capavate_subscriptions` rows | All 28 rows have `status='pending'` and `activated_at=NULL` | The Airwallex activation pipeline has never fired since v25.26. This is exactly Bug A — and v25.45 ships the fix. |

The v25.45 patch files (`userPrivacyResolver.ts`, `capTableMembership.ts`, migrations 0062 + 0063, `CompanyManagement.tsx`) are sitting in your filesystem, but `npm run db:migrate` and `npm run build` were never run. So none of the v25.45 code is actually live in your process.

---

## Your three bug reports — already fixed in v25.45

| # | Your report | Why it's happening on v25.41 | v25.45 fix |
|---|---|---|---|
| 1 | Module Company Management — please resolve error | v25.45 F8 added a new left-nav Company Management parent. v25.41 has no route mounted, so the page errors. | F8: `client/src/pages/founder/CompanyManagement.tsx` (NEW) + AppShell route + `Settings.tsx` tab restructure + invite-email bug fixed |
| 2 | Billing subscription detail not in table; worked 16-06-2026 (v25.26.0), broken after | Your 28 `capavate_subscriptions` rows are all `pending` with `activated_at=NULL`. The Billing table renders only `status='active'` rows, so it stays empty. | Bug A: new `POST /api/founder/subscription/reconcile` (idempotent, ownership-checked, atomic; shares the webhook's `finalizeWebhookSuccessInTx`) + new `GET /api/founder/subscription/status?companyId=` contract. `BillingReturn.tsx` calls reconcile on each poll, so the platform unlocks even if the webhook never fires. |
| 3 | Settings tabs save in memory, not DB | v25.41 `server/profileStore.ts` Zod email validator rejects empty strings before persistence — Steps 1–4 silently fall back to in-memory. | F2 (CRITICAL): `profileStore.ts` Zod validator fix · F5: Full Page DB audit · F13: Privacy DB-backed · F14: Public DB-backed · Bug B: admin reads DB-authoritative; both `POST /api/founder/companies` callers re-throw persist failure (no false 201) |

---

## What to do right now — exact apply sequence

```bash
cd /path/to/capavate

# 1. Apply patch on top of v25.41 (files only — does not run yet)
unzip -o CAPAVATE_v25.45_PATCH_for_Avi.zip

# 2. Install / refresh dependencies
npm install

# 3. CRITICAL — run all 4 migrations
#    Adds: ma_privacy_json column · declined_reason column ·
#          workspace_archive_state table · round_chain_head_freezes table
npm run db:migrate

# 4. Build the new production bundle (otherwise the F8 route is unmounted)
npm run build

# 5. Restart the production server
pm2 restart capavate
# or: NODE_ENV=production node dist/index.cjs
```

**The recommended path is `deploy_v25_45_LIVE.sh`** — it does all 5 steps in one shot and backs up `dist/`, `.env`, `migrations/`, and `data.db` first.

```bash
chmod +x deploy_v25_45_LIVE.sh
./deploy_v25_45_LIVE.sh /path/to/capavate
```

---

## How to verify v25.45 is actually live after restart

```bash
# 1. package.json should say 25.45.0
grep version package.json
# expected: "version": "25.45.0",

# 2. _migrations_applied should have the v25.45 migration entries
sqlite3 data.db "SELECT key FROM _migrations_applied ORDER BY applied_at DESC LIMIT 5;"
# expected to include the 0062 + 0063 migration keys

# 3. The two new v25.45 tables should exist
sqlite3 data.db ".tables" | tr ' ' '\n' | grep -E "workspace_archive|round_chain_head"
# expected:
#   round_chain_head_freezes
#   workspace_archive_state

# 4. The Company Management page should load
#    Browse to /founder/company-management

# 5. Run reconcile against your existing pending subscriptions
#    They should move from status='pending' to status='active' and
#    appear in the Billing & Subscription table

# 6. Save any tab in Settings, restart the process, re-open the tab —
#    the value should persist (DB-backed, not in-memory)
```

---

## If anything still misbehaves AFTER v25.45 is actually live

We have triple-verified regression coverage for all three behaviors — **779 e2e tests passing**, including 4 new fail-closed regression tests for Bug A / Bug B / Bug C. If a behavior is broken on v25.45, it is either a fresh bug or an environment issue.

For each remaining issue, please send:

1. A screenshot of the error in the UI
2. The matching server log line(s) (`pm2 logs capavate` or equivalent)
3. The browser console output if relevant
4. The result of `grep version package.json` so we confirm the running version

We will diagnose immediately and dispatch top-model fixes (Opus 4.8 + Gemini 3.1 Pro + GPT-5.5 triple-verify) the same way the v25.45 wave was handled.

---

## Bundle contents reminder

Files you should have from yesterday's ship:

- `CAPAVATE_v25.45_PATCH_for_Avi.zip` (590 KB · 147 files vs v25.43)
- `CAPAVATE_v25.45_FULL_INSTALL_for_Avi.zip` (6.0 MB · 1,671 files — fresh install if preferred)
- `INSTALL_v25.45.md` (detailed install + surface list)
- `deploy_v25_45_LIVE.sh` (automated deploy script)
- `capavate_master_report_v25_45.md` (full release report)

Ozan can resend any of these on WhatsApp if you don't have them.

Please confirm once v25.45 is live on your end (`package.json` says `25.45.0` and the two new tables are present) so we can run a clean QA pass together.

— Ozan
