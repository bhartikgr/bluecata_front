# Capavate Sprint 10 — Investor Surface Rebuild

**Date**: May 8, 2026
**Tests**: 286/286 passing across 48 files (was 254 across 43 — added 32 tests, 5 files)
**Build**: clean (1.7MB JS / 478KB gzipped)

## Mandate

Rebuild the investor side end-to-end. Take best practices from live Capavate AND Collective, but build for the new Capavate vision: cap-table-gated communications, investor-led M&A, full Collective integration. Remove Discover. 100% accuracy, every CTA works end-to-end.

## What shipped

### D1. Enhanced Investor Dashboard (Dashboard.tsx — rebuilt)

- **KPI strip**: live MOIC, IRR, TVPI, DPI, Total Paper Value, Realized Returns — each with sparkline and YoY delta chip
- **Portfolio analytics block**: by-stage, by-region (9 regions), by-vintage cohort breakdowns
- **M&A Intelligence panel (investor-led)**: per portfolio company — acquirer-fit score 0-100, top-3 strategic-buyer shortlist, comparable exits 24mo, revenue multiple range. Two CTAs per row: "Initiate M&A discussion" (opens cap-table channel) and "Lead M&A initiative" (creates investor-led thread + `ma_initiative_started` telemetry)
- **Round activity stream**: new rounds opening, soft-circle invitations pending, term-sheet drops, close-gate status
- **Cohort benchmarks**: portfolio vs Collective P25/P50/P75/Yours
- **Communications surface**: Sprint 9 Messages widget + Posts feed retained
- All math live from cap-table-engine + ref engine reconciliation — zero mocked KPIs

### D2. Deep Invitations + Your Decision tab (Invitations.tsx, InvitationDetail.tsx, CompanyDetail.tsx investor mode)

- Invitation cards: logo, name, sector chip, stage chip, round size, valuation, instrument, soft-circle countdown, pro-rata badge, founder bio snippet, traction KPIs, M&A signals chip, Review Deal + Pass CTAs
- **Review Deal** routes to `/investor/companies/:id?tab=your-decision` (default tab Your Decision)
- 7 tabs in investor CompanyDetail: Overview · Team · Traction · Financials · Round Terms · Documents · **Your Decision**
- **Your Decision tab** — full state machine implemented:
  - 10-state status banner (pending / viewed / accepted / declined / soft_circled / confirmed / signed / funded / expired / revoked)
  - Accept/Decline radio
  - Soft-circle form on Accept: amount + 7-currency selector (USD/CAD/GBP/EUR/SGD/HKD/CNY) + type radio (Definite / Indication of interest / Conditional on DD) + personal note (max 500 chars)
  - Request Info button
  - Submit Soft-Circle (Hydra Teal) → PATCH `/api/rounds/:rid/invitations/:iid/decision` → emits `soft_circle_submitted`
  - MIM section: Members Interested in this Deal — screen-name chips + total indicated amount
  - Term sheet preview card + expandable full view
  - Signature surface (when `signing_open`) reuses existing SES module

### D3. Investor CRM (CRM.tsx — new, route `/investor/crm`)

- 5 tabs: All Contacts · Founders · Co-Investors · Ecosystem · Connections (kanban with lanes Cap Table / Round / DSC / Angel Network / Social)
- Pipeline kanban: Lead → Met → Diligence → Soft-Circle → Invested → Exited
- Per-contact panel: profile (visibility-gated via Sprint 9 resolver), notes (timestamp log = `pcrm_notes`), tasks (`pcrm_tasks` with due date + status), activity log (auto-pulled messages + soft-circles + term-sheets + posts), tags, "Open thread" → DM/cap-table channel
- Add Contact (manual) + CSV import + CSV export (`capavate-pcrm-YYYY-MM-DD.csv`)
- Schema: `pcrm_contacts`, `pcrm_notes`, `pcrm_tasks`
- Telemetry: `crm_contact_added`, `crm_note_added`, `crm_task_completed`, `crm_pipeline_moved`

### D4. Analytics-grade Portfolio (Portfolio.tsx — rebuilt)

- 8-card KPI strip + sortable holdings table: company, stage, instrument, shares, cost basis, current FMV, ownership %, fully-diluted %, paper gain $, paper gain %, MOIC, IRR
- 4 breakdown charts: Portfolio Value Over Time · Allocation Pie (sector/stage/region toggleable) · MOIC Distribution histogram · Vintage IRR cohort lines
- **Round comparisons**: select 2-4 portfolio cos → side-by-side KPIs, terms, dilution, M&A signals
- **New rounds detector**: portfolio cos with active rounds + pro-rata calculator (`checkUsdM = ownership% × postMoneyM − ownership% × preMoneyM`) + "Exercise pro-rata" → Your Decision tab
- **M&A Intelligence per holding**: acquirer-fit score, comp-set exits, strategic-buyer list, "Lead M&A initiative" CTA
- Each row drills into investor CompanyDetails

### D5. Discover removed, Apply to Collective integrated

- `Discover.tsx` deleted, route removed, nav entry removed
- New `ApplyToCollective.tsx` route `/investor/apply-to-collective` — full 7-step wizard:
  1. Eligibility check (server-side `isEligibleForCollective()`)
  2. Investment thesis (max 1000) + min/max check size + sectors (45 multi-select) + stages + geo + member tier + referral
  3. Passport/gov ID + proof of address + optional KYC docs
  4. Accreditation — jurisdiction-adaptive (US / CA NI 45-106 / UK HNW / EU MiFID II / SG SFA §4A / HK SFO Sch 1)
  5. Stripe placeholder ($1,200/yr) — explicit demo banner; backend records intent only
  6. Status: submitted → reviewing → accepted/rejected/waitlisted
  7. Confirmation + Explore Deal Room CTA
- Outbox event `collective_application_submitted` matching sync schema §9
- Empty-states + onboarding directed here

### D6. Backend wiring

New stores:
- `server/maIntelligenceStore.ts`
- `server/yourDecisionStore.ts`
- `server/crmStore.ts`
- `server/collectiveAppStore.ts`
- `server/portfolioAnalyticsStore.ts`
- `server/sprint10Telemetry.ts`

New endpoints (snake_case API ↔ camelCase client, zod-validated):
- `GET /api/investor/portfolio/analytics`
- `GET /api/investor/ma/intelligence/:companyId`
- `POST /api/investor/ma/initiative`
- `GET/POST/PATCH/DELETE /api/investor/crm/contacts | /notes | /tasks`
- `PATCH /api/rounds/:rid/invitations/:iid/decision`
- `POST /api/collective/applications`
- `GET /api/collective/eligibility`

### D7. Tests (32 new)

- `maIntelligence.test.ts` — 7 (acquirer-fit math, comp-set filter)
- `crm.test.ts` — 4 (pipeline transitions, note add, task complete)
- `portfolioAnalytics.test.ts` — 8 (MOIC/IRR/TVPI/DPI math, cohort grouping)
- `yourDecision.test.ts` — 5 (every valid + invalid 10-state transition)
- `collectiveApplication.test.ts` — 8 (eligibility + 7-step validation + submit)

## Verified CTAs (production curl proofs)

- `GET /api/investor/portfolio/analytics` → `{moic:1.975, tvpi:2.065, dpi:0.089, irr:31.68, paperGain:2291920, ...}` reconciles with sum of investorPortfolio positions
- `GET /api/investor/crm/contacts` → 6-contact seed including Maya Chen / NovaPay AI / soft_circle stage
- `GET /api/collective/eligibility` → `{eligible:true, reasons:[...], passes:{investorOnCapTable:true,...}}`
- Your Decision state machine: every transition in `YOUR_DECISION_TRANSITIONS` validated
- CRM contact add → telemetry envelope `eventType:"crm_contact_added"`, `aggregateKind:"contact"` per sync schema §9
- M&A initiative POST → telemetry `ma_initiative_started` with companyId + buyerShortlist
- Collective application submit → telemetry `collective_application_submitted` with thesis/tier/jurisdiction
- CSV export → `capavate-pcrm-YYYY-MM-DD.csv` blob; CSV import → POSTs each row

## Totals across the app

- Routes: 14 founder + 9 investor (was 8, +1 CRM, +1 Apply, −1 Discover, net +1) + 10 admin
- Tests: 286 across 48 files
- Regions: 9 (US, CA, UK, SG, HK, CN, IN, JP, AU)
- Stack unchanged: Vite + React 18 + wouter + TanStack Query + Tailwind + shadcn + Express + Drizzle/SQLite preview + decimal.js + BigInt + Auth0-locked

## Deferred

- Stripe charge in Apply step 5 — explicit demo banner; backend records intent only
- Bundle 1.7MB (could split via manualChunks — out of scope)
- Pre-existing BigInt literal TS warnings unrelated to Sprint 10

## Three doors open

1. **Sprint 11 — production hardening**: Postgres + RLS, real Auth0 tenant, real DocuSign, real Stripe Connect, real Collective webhook, Fastify migration
2. **Compliance partner brief**: Cooley / Stikeman / AZB / Big-4 outreach pack using 9-region consortium directory
3. **Commercial layer**: pricing, Stripe Connect production, marketing site, GTM
