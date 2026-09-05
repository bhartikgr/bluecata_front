# Capavate Sprint 11 — Founder Surface + Multi-Company Auth + Light-Only

**Date**: May 9, 2026
**Tests**: 332/332 passing across 56 files (was 286/48 — added 46 tests, 8 files)
**Build**: clean (495KB gzipped) · 0 TypeScript errors · 0 console errors across 17 walked routes
**Deploy**: live (asset `dea0e0a3-5b44-4f27-bfc9-07e96cd5346a`)

## Mandate

Rebuild the founder side end-to-end. Multi-company architecture. Light-mode only. Cap-table-led communication is the LIFE of the platform. Investor-led M&A flows. Every CTA works. Every promise delivered.

## What shipped

### Phase 1 — Foundation

**Multi-company auth**
- 3-company seed (NovaPay AI / Arboreal Health / Quanta Robotics)
- `CompanySwitcher` topbar dropdown in `AppShell` — swap company without re-login
- Each company standalone: separate cap table, dataroom, billing, pricing, settings, Collective application
- Endpoints: `GET /api/founder/companies` · `POST /api/founder/companies/:id/activate` · `GET /api/founder/active-company`
- Cross-company query invalidation wired

**Investor strict gating**
- `membershipStore.ts` + `GET /api/investor/membership/:userId`
- 3 personas seeded: active / lapsed / denied
- Lapsed renewal → Collective toggle disappears
- Investor not on cap table → 0 communications, 0 company info access (server-side 403)

**9-region constant lock**
- `client/src/lib/regions.ts` exports `REGION_CODES`, `REGIONS_ALL`, `REGION_NAME`, `isRegion9()`
- All 9 regions (US, CA, UK, SG, HK, CN, IN, JP, AU) in every dropdown
- 4 passing region-coverage tests

**Light-mode only**
- 206 `dark:` Tailwind classes stripped across 35 files
- `.dark { }` block removed from `index.css`
- `theme.tsx` + `main.tsx` enforce light at mount
- Only remaining `dark:` reference is Recharts internal `THEMES = { light: "", dark: ".dark" }` registry (cannot remove without forking Recharts; harmless because `.dark` class never gets added)

**Bugs found + fixed during QA**
1. Badge missing forwardRef (Tooltip incompat)
2. Fragment missing key in `CapTable.tsx` GroupedHoldings
3. `verifyChain()` hash body shape inconsistency in captableCommitStore
4. ReferenceError + missing `shortPlan()` helper + stale flat type in CompanySwitcher
5. Dataroom test schema mismatches (4 sub-fixes)
6. multiCompany role string `"co_founder"` → `"co-founder"`
7. **Investor-side bug root cause**: stale dist artifact. Source code was correct, deployed code was pre-Sprint-11. Fixed with rebuild + redeploy. All Sprint 10 enhancements now visible.

### Phase 2 — 12 Founder UI Surfaces

| # | Surface | Highlights |
|---|---------|------------|
| D1 | **Dashboard v2** | Cap-table comms center, M&A inbound panel (investor-led initiatives), round health funnel (invited→funded), dataroom engagement preview, report read-rate, live cap-table snapshot, activity log preview, Sprint 9 Messages + Posts retained |
| D2 | **Company Profile Investor View Sync** | "Investor View" modal renders exact mirror of `investor/CompanyDetail.tsx` with shared data hook · TanStack Query invalidation on PATCH · Live preview chip |
| D3 | **CapTable enhancements** | Per-holder drill-down · Vesting Gantt charts · ESOP pool tracker · Anti-dilution simulator · Bulk export (PDF/XLSX/CSV) + bulk message |
| D4 | **RoundWizard fixes** | Warrants step (type/exercise price/expiry/holders/vesting) · ESOP top-up step · Smart Term-Sheet conditional (skips for warrants/options, uses Warrant Agreement / Option Agreement instead) · All 9 regions · Glossary (56 terms searchable, HelpTip integration) |
| D5 | **Founder Investor CRM** | Pipeline Lead→Engaged→Soft-Circle→Invested→Long-term · Per-investor card with holdings + soft-circle history + M&A signals + threads + notes + tasks · Bulk + segmented broadcast |
| D6 | **Dataroom (rebuilt from broken)** | Real upload/download/preview · Default folders (Pitch/Financials/Legal/Diligence/Round-Specific) · Permission matrix (investor × folder × view/download) · Engagement stats · Watermarking overlay |
| D7 | **Investor Reports** | 5 templates · 8 sections · Auto-pull metrics from cap-table-engine · Schedule + recurring · Read-receipts + comment threads · Segmented send |
| D8 | **Messages unified linking** | Each thread shows cap-table holder badge + CRM contact link + soft-circle thread + round link · "Open in CRM" / "Open in cap-table" deep-links · 6 inbox filters |
| D9 | **Activity Log** | Audit-grade timeline from telemetry events · Filterable (date/type/actor/entity) · Searchable · CSV export · Per-entity views |
| D10 | **Settings (7 tabs, fully wired)** | Profile · Company · Team & Permissions · Plan & Pricing (reads from `/api/admin/pricing-tiers`) · Billing & Invoicing (per-company isolated) · Notifications · Data Export + Delete |
| D11 | **Apply to Capavate Collective (founder)** | Path A — shareholder-promoted (vouch flow) · Path B — standalone 7-step wizard · Status tracking |
| D12 | **Captable Commit Pipeline** | State machine viz: invited→viewed→soft_circled→confirmed→signed→funded→COMMIT · Founder commit button at signed→funded · Cap-table-engine vs ref reconciliation display · Compliance hold banner |

## QA walk results

All 12 founder routes + 3 investor + 2 admin routes walked: **0 console errors across 17 routes**.

| Route | testids | Console errors |
|-------|---------|----------------|
| /founder/dashboard | 147 | 0 |
| /founder/company | 48 | 0 |
| /founder/captable | 72 | 0 |
| /founder/rounds/new | 42 | 0 |
| /founder/crm | 62 | 0 |
| /founder/dataroom | 51 | 0 |
| /founder/reports | 30 | 0 |
| /founder/messages | 72 | 0 |
| /founder/activity | 37 | 0 |
| /founder/settings | 41 | 0 |
| /founder/apply-to-collective | 29 | 0 |
| /founder/rounds/:id (commit pipeline) | 58 | 0 |
| /investor/dashboard, /investor/companies, /admin/dashboard, /admin/pricing | — | 0 |

## Totals across the app

- **Routes**: 15 founder (was 14, +1 apply-to-collective) · 9 investor · 10 admin
- **Tests**: 332 across 56 files
- **Regions**: 9 (US, CA, UK, SG, HK, CN, IN, JP, AU)
- **Stack unchanged**: Vite + React 18 + wouter + TanStack + Tailwind + shadcn + Express + Drizzle/SQLite preview + decimal.js + BigInt + Auth0-locked

## Deferred (small)

- D4 attach-to-parent uses hardcoded round IDs — should query `/api/rounds`
- D12 CommitPipeline uses raw fetch instead of apiRequest helper (works in production)
- Pre-existing BigInt literal TS warnings in cap-table-engine-ref (unrelated to Sprint 11)

## Three doors open

1. **Sprint 12 — production hardening + Sprint 13 prep**: Postgres + RLS, real Auth0 tenant, real DocuSign, real Stripe Connect, real Collective webhook, Fastify migration
2. **Compliance partner brief**: Cooley / Stikeman / AZB / Big-4 outreach pack
3. **Commercial layer**: pricing pages, marketing site, GTM motion
