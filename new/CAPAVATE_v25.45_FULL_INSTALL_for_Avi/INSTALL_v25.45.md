# INSTALL — Capavate v25.45 (full v25.43 → v25.45 jump)

**Build date:** Thursday, June 25, 2026
**Patch zip:** `CAPAVATE_v25.45_PATCH_for_Avi.zip` (590 KB · 147 files vs v25.43)
**Full install:** `CAPAVATE_v25.45_FULL_INSTALL_for_Avi.zip` (6.0 MB)
**Deploy script:** `deploy_v25_45_LIVE.sh` (drop-in over a v25.43 install — bridges v25.44 + v25.45 in one apply)

**Important:** This patch is calculated against **v25.43** (your last installed version, Avi). It rolls up **both** v25.44 (Collective Wave A + M&A Intelligence + Global Venture Markets) **and** v25.45 (founder QA + privacy hardening + production bug fixes) in one install. You do not need to apply v25.44 separately — it is folded in.

## What's in this drop — full delta since v25.43

This release rolls up:

1. **v25.44 — Collective Wave A + M&A Intelligence + Global Venture Markets** (14 surfaces)
2. **v25.45 — Founder QA wave** (19 surfaces, F1–F20)
3. **9-round counterparty privacy hardening** (single resolver, locked terminology, full sweep)
4. **3 production-blocker bug fixes** from live testing (subscribe unlock, admin company visibility, Round Management DB persistence)
5. **r2 hardening** — closed 4 follow-on fail-open issues GPT-5.5 found in the first verification pass

### v25.44 — Wave A (12 Tier-1 surfaces, additive)

| # | Surface | Endpoint |
|---|---------|----------|
| 1 | Engagement Score widget | `GET /api/collective/me/engagement` |
| 2 | Platform Pulse widget (fail-closed on audit_log unavailable) | `GET /api/collective/platform-pulse` |
| 3 | My Capavate Portfolio widget + page | `GET /api/collective/me/portfolio` |
| 4 | Presentations · chapter widget + page | `GET /api/collective/chapters/:id/presentations` |
| 5 | Network Posts feed widget + page (no new table) | `GET /api/collective/posts` |
| 6 | `/connections` extended (richer co-investor surface) | `GET /api/collective/connections` |
| 7 | `/monthly-meetings` route | `GET /api/collective/monthly-meetings` |
| 8 | `/schedule` route | `POST /api/collective/schedule` |
| 9 | `/syndicate/apply` route | `POST /api/collective/syndicate/apply` |
| 10 | `/admin/deal-statistics` (funnel + conversion) | `GET /api/admin/deal-statistics` |
| 11 | `/admin/deal-approvals` decline-with-reason | `POST /api/admin/applications/:id/decline` |
| 12 | `/admin/regions` rollup card | `GET /api/admin/regions` |

### v25.44 — Surface 13: M&A Intelligence (institutional-grade)

- Three tabs (Pipeline · Comparable Exits · Sector Benchmarks) + dashboard card
- **Privacy gate, default opt-OUT** for cross-Collective sharing (`companies.ma_privacy_json`)
- **K-anonymity floor of 5** — sector benchmarks return `INSUFFICIENT_DATA` when n<5
- **Narrative redaction guaranteed at the type level** — `maReadinessNarrative` absent from aggregate response types; cannot be returned by construction
- **Real Step 4 data binding** — aggregations read `profilestore_company_profile.profile_json.ma`, not mocks
- **Shared `maAuthzGate.ts`** — 4-tier authz (FULL / DETAIL / AGGREGATE / NONE) for BOTH the new `/api/collective/ma-intel` AND the legacy `/api/investor/ma/intelligence/:companyId` endpoints (legacy endpoint previously open — closed in v25.44)
- **CSV export excludes private fields**

### v25.44 — Surface 14: Global Venture & Early-Stage Markets widget

- 11 markets seeded: ChiNext · STAR · BSE · KOSDAQ · KONEX · TSXV · NCM · NYSE American · AIM · First North · Euronext Growth
- Two columns only: Exchange Symbol (flag + bold code + smaller exchange name) · Market Value
- OECD baseline; pending boards return `null` → render `—` (no fake numbers)
- ETL hooks ready for Tier-2 (official exchange) and Tier-3 (Alpha Vantage / Marketstack / Finnhub / Twelve Data)

### v25.45 — Founder QA surfaces (F1–F20)

| # | Surface | Change |
|---|---------|--------|
| F1 | Add Company dialog | New Sector dropdown · Plan picker removed · new copy · defaults to Free plan |
| F2 | Company Profile (CRITICAL) | Fixed in-memory blocker (profileStore.ts Zod email validator) — Step 1–4 now persist to DB end-to-end |
| F3 | Save Profile flow | Checkbox moved · vanish-on-save bug fixed · post-save routing corrected |
| F4 | Investor View modal | Real preview (no mocks) |
| F5 | Full Page DB audit | All Full Page fields now read/write DB |
| F6 | Profile tab | DB-backed · "Privacy & Visibility" sub-tab removed (moved to F13) |
| F7 | Company tab | DELETE button (workspace archive flow) |
| F8 | Team → Company Management | New left-nav parent · invite email bug fixed |
| F9 | Plan tab | DELETED (consolidated into F10) |
| F10 | Billing & Subscription | Renamed · consolidated · left-nav "Billing" duplicate removed |
| F11+F12 | Notifications + Data | UI hidden (code retained per "don't delete widgets" rule) |
| F13 | Privacy | DB-backed · propagated across Founder + Investor surfaces |
| F14 | Public profile | DB-backed |
| F15 | Region | Read-only mirror from Legal Entity Info |
| F16+F17 | Preferences + Financials | UI nuked (columns kept due to FK references) |
| F18 | Governance | Migrated into Full Page scorecard |
| F19 | M&A Prep | Moved to Step 4 (new Section 5: M&A Readiness — qualitative); integrated into `maScore` composite (50/50 with meaningfulness guard) |
| F20 | Delete Workspace | Renamed + **8-year archive** + **self-serve revival** |

### v25.45 — Counterparty privacy contract (9 rounds of triple-verify hardening)

Locked policy: founders **always** see investor legal names on their cap table; everyone else sees **"Private Investor"** (the locked Capavate term); co-investors on a shared cap table see each other's real names by default unless one has explicitly opted out.

- Single resolver `server/lib/userPrivacyResolver.ts` with strict viewer normalization and explicit context split
- Read-only `areCoMembersOnAnyCapTable()` helper derives counterparty status from the SACRED `captable_commits` ledger
- Every external-facing surface routed through the resolver: Collective directory, posts, connections, Q&A, admin channels, reports recipients, cap-table PDF, comms messaging, **DM channel metadata**
- 39 new privacy-specific e2e tests

### v25.45 — Production-blocker bug fixes

| Bug | Symptom | Fix |
|-----|---------|-----|
| **A** | Card charged but platform didn't unlock; subscription not visible on Billing & Subscription page | New `POST /api/founder/subscription/reconcile` (DB-direct, atomic, ownership-checked, idempotent — shares the webhook's `finalizeWebhookSuccessInTx`); new `GET /api/founder/subscription/status?companyId=` contract; `BillingReturn.tsx` calls reconcile on each poll |
| **B** | New company invisible in Admin area | `getAllCompaniesFromDb()` is now **DB-authoritative** (live `companies` table rows define the set; soft-deleted excluded); **both** `POST /api/founder/companies/new` AND `POST /api/founder/companies` now re-throw persist failure (no false 201); admin route reads from DB |
| **C** | Round Management variables not in DB (would corrupt cap table) | Terms PATCH now persists via `roundsStore.updateRound()` with `UPDATE_EXTRAS_WHITELIST`; new `round_chain_head_freezes` table — freeze is **strict/fail-closed inside the close transaction** (failure rolls back the close, no orphan ledger commits); new `legacyInvitationStore` persists to `kv_legacyInvitationStore` **before** exposing tokens; redemption fail-closed on persist failure |

## Schema changes — 4 additive migrations (v25.44 + v25.45), all reversible

```sql
-- 0059_v25_44_ma_privacy_json.sql         (M&A privacy gate, opt-out default)
ALTER TABLE companies ADD COLUMN ma_privacy_json TEXT
  DEFAULT '{"shareWithCollective":false,"shareWithChapter":true,"shareWithAdvisors":true,"redactNarrativeFromAggregates":true}';

-- 0060_v25_44_declined_reason.sql         (Admin decline-with-reason)
ALTER TABLE collective_apps ADD COLUMN declined_reason TEXT;

-- 0062_v25_45_workspace_archive.sql       (F20: 8-year archive flow)
CREATE TABLE IF NOT EXISTS workspace_archive_state (...);

-- 0063_v25_45_bugC_round_chain_head_freezes.sql  (Bug C: round-close audit baseline)
CREATE TABLE IF NOT EXISTS round_chain_head_freezes (...);
```

All migrations are idempotent. Rollback documented in `migrations/ROLLBACK_v25_44.md` and `migrations/ROLLBACK_v25_45.md`.

## Standing gates (all green, independently triple-verified)

| Gate | Result |
|------|--------|
| TypeScript | 613 errors (zero net-new vs v25.44; ceiling is 700) |
| AVI Tier-2 byte-identical (`scripts/verify_avi_preserved.sh`) | PASS, exit 0 |
| Airwallex + partnerFee | 3 files / 45 tests passed |
| Full e2e suite | **135 files / 779 passed / 1 skipped** |
| Vite build | exit 0 |
| `npm run build` | exit 0 |
| home3compo unchanged from v25.43 | PASS |
| Cap-table math + `captable_commits` ledger unchanged | PASS (byte-identical to v25.42 baseline) |

## Hard rules respected

- **AVI Tier-2 patterns (Avi code) — byte-identical** vs v25.42 baseline.
- **`home3compo` — untouched.**
- **Cap-table + round math — no edits.** `areCoMembersOnAnyCapTable()` helper and `round_chain_head_freezes` are read-only / additive audit baselines, not math paths.
- **`COMMISSION_RATE` literal — unchanged.**
- **"Don't delete widgets" rule** — wrapper pattern preserved throughout.
- **"Zero in-memory, 100% DB-driven dynamically"** — explicitly enforced across the Bug A/B/C fixes; GPT-5.5 round-2 verification confirmed no remaining fail-open paths.

## Deploy

```bash
chmod +x deploy_v25_45_LIVE.sh
./deploy_v25_45_LIVE.sh /path/to/capavate
```

The script:
1. Backs up `dist/`, `.env`, `migrations/`, and `data.db` to `.v25_45_backup_<ts>`
2. Unzips the patch on top of the v25.43 install (folds v25.44 + v25.45 together)
3. `npm install` → `npm run db:migrate` (runs migrations 0059 + 0060 + 0062 + 0063) → `npm run build`
4. Restarts via `pm2` or `systemd` (manual fallback otherwise)
5. Runs a `curl /` smoke check

Rollback: stop the server, replace `dist/` from the backup, drop the 4 new tables/columns per the ROLLBACK docs, restart.
