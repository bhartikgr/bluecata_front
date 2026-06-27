# Capavate Sprint 4 Preview — First-time-founder accessibility + Capitalization Journey

**Build:** Sprint 4 of Q1 (R200.q1 v1.3)
**Date:** 2026-05-15
**Audience:** Ozan (product owner), Avi (lead engineer), prospective hires, fintech-grade investors
**Status:** All Sprint 3 capabilities preserved (dual-engine reconciliation gate, immutable transaction ledger, investor-grade telemetry capture). **Sprint 4 adds plain-English descriptions across every cap-table and round-management surface, a 50-term searchable Glossary dialog, and a multi-panel Capitalization Journey hero visualization on the founder dashboard.** 69 tests still passing across primary + reference + telemetry packages.

---

## What's new in Sprint 4

### 1. Early-stage-friendly descriptions everywhere

Most companies on the platform are early-stage and may be unfamiliar with the jargon or the process. Sprint 4 adds inline help across every cap-table and round-management surface. The voice is **short, plain, jargon-free, never condescending**.

| Surface | What changed |
|---|---|
| `/founder/dashboard` | Glossary link in header. New Capitalization Journey hero (see below). |
| `/founder/captable` | 1-sentence plain explanation in header. View toggle (Basic / Fully Diluted / As Converted) gets a tooltip per tab explaining what each one counts. Instrument legend chips become hover tooltips. "Computed by" badge tooltip explains why provenance matters. New `as_converted` SAFE roll-up: SAFEs are converted to Common-equivalent shares using the lower of cap-implied price and (PPS × (1−discount)). |
| `/founder/rounds/new` | Step-1 instrument cards each gain a `Learn more` collapsible disclosure with **when founders typically use it**, a **worked example** with real numbers, and a **watch-out**. Region selector adds a per-region sub-line description. Every conditional Step-2 field (valuation cap, discount, MFN, liq pref, participating, anti-dilution, pool timing, vesting, cliff, ESOP variant, strike price, expiry, cashless, etc.) gets a `?` HelpTip with a one-line plain definition. |
| `/founder/rounds/:id` | Lifecycle state badge gets a tooltip with state-meaning + what the founder can do at that stage. Soft-circle explanation card surfaces when state is `soft_circle_open`. Pre-money / Post-money / Price-per-share / Min-ticket each get a `?` HelpTip. |
| `/investor/invitations/:id` | Each of the 5 tabs (Overview, Cap Table, Investment Terms, Data Room, Your Decision) gets a one-sentence intro at the top explaining what the investor is supposed to do here. Headline-terms table gets per-row `?` definitions for liq pref, anti-dilution, pro-rata, ESOP top-up, etc. Soft-circle explainer card on the Decision tab. |

### 2. New shared `Glossary` component

`client/src/components/Glossary.tsx` ships a dialog with **53 terms** grouped by category and searchable across term, alt-name, definition, and example:

- **Equity Instruments** — Common, Preferred, SAFE, Convertible Note, Warrant, Option, RSU
- **Round Mechanics** — Pre-money, Post-money, PPS, Valuation cap, Discount, MFN, Soft circle, Subscription docs, Term Sheet, Round close, Lead investor, Pro-rata, Bridge round, Down round, Flat round
- **Investor Rights** — Liq pref, Participating preferred, Non-participating, Anti-dilution, Broad-based weighted average, Full ratchet, Information rights, Board seat, Board observer, Drag-along, Tag-along, ROFR, Protective provisions
- **Regulatory** — NVCA, YC SAFE, Delaware C-Corp, 83(b), Reg D, Accredited investor, EMI, SEIS/EIS
- **ESOP & Vesting** — ESOP, Pool timing pre-money, Pool timing post-money, Vesting, Cliff, Acceleration, ISO, NSO, Strike price, 409A
- **Cap Table Views** — Basic, Fully Diluted, As Converted

A `<GlossaryLink />` is wired into every Sprint-4 page header (founder dashboard, cap table, round wizard, round detail, investor invitation).

### 3. New `<HelpTip />`, `<LabelWithTip />`, `<LearnMore />` primitives

`client/src/components/HelpTip.tsx` standardises the help affordance pattern:

- `HelpTip` — small `HelpCircle h-3.5 w-3.5 text-muted-foreground` icon next to a label that reveals a one-line tooltip on hover.
- `LabelWithTip` — thin wrapper that bundles a `<Label>` and a `HelpTip` adjacent.
- `LearnMore` — collapsible disclosure for longer explanations (use under cards/inputs for worked examples).

### 4. Capitalization Journey hero visualization

`client/src/components/CapitalizationJourney.tsx` is a multi-panel section that lands at the top of `/founder/dashboard`. Built on Recharts (already in deps).

**Panel 1 — Round Timeline + Valuation curve.** Composed line + area chart with X-axis = round close dates, Y-axis = pre-money valuation. Markers at each round close. The current/active round dot pulses. Hover tooltip shows round name, instrument, target, raised, lead investor, close date.

**Panel 2 — Ownership Composition Over Time.** Stacked area chart (X = time, Y = % ownership 0–100%) with stacked bands for Founders, Employee Pool, Preferred, SAFE, Note, Warrant. Vertical reference lines mark each round close. Hover at any point shows the exact composition snapshot. Founders' band shrinking visualises the dilution journey.

**Panel 3 — Round-by-round card carousel.** Horizontal scrollable cards along a connecting timeline. Each card shows round name + instrument badge, pre/post-money, total raised, days from open to close, lead investor + investor count, founder ownership before vs after, and state badge. Click navigates to `/founder/rounds/:id`.

**Panel 4 — KPI strip.** Total raised across all rounds, latest valuation, current founder ownership (FD %), cap-table holders count.

All four panels are wired to `/api/rounds` and `/api/companies/co_novapay/securities` via TanStack Query. An engine attribution badge ("Reconstructed by @capavate/cap-table-engine") sits at the top of the section.

### 5. Demo data — 4-round NovaPay journey + SAFE holders

`server/mockData.ts` now includes a rich 4-round NovaPay timeline:

| Round | Date | State | Pre/Post | Raised | Lead |
|---|---|---|---|---|---|
| Foundation | 2024-01-15 | closed | $0 / $800 | $800 | Founders (8M Common) |
| Pre-Seed SAFE | 2024-09-01 | closed | $5M / $6.05M | $1.05M | Forge Ventures |
| Series Seed | 2025-03-15 | closed | $10.5M / $12M | $1.5M | Hydra Capital |
| Seed Extension | 2026-07-15 | soft-circle open | $18M / $22M | $2.65M | Hydra Capital |
| Series A | 2026-06-30 | signing open | $56M / $68M | $9.4M | Anchor Growth |

Two additional SAFE holders are added so the As-Converted view has multiple SAFEs to roll up:

- **Avocado Angels** — $250k SAFE @ $6M post-money cap, 20% discount
- **Forge Pre-seed** — $300k SAFE @ $5M post-money cap, 20% discount

Under Basic and Fully Diluted views these don't appear (still SAFEs). Under As Converted they appear with computed Common-equivalent share counts using the lower of cap-implied price and (PPS × (1−discount)).

---

## Files changed in Sprint 4

```
client/src/components/Glossary.tsx              (new — 53-term dialog)
client/src/components/HelpTip.tsx               (new — ? tooltip + LearnMore)
client/src/components/CapitalizationJourney.tsx (new — 4-panel hero)
client/src/lib/types.ts                         (new — ApiRound shape)
client/src/lib/engineDemo.ts                    (As-Converted SAFE roll-up adapter)
client/src/pages/founder/Dashboard.tsx          (mount Capitalization Journey)
client/src/pages/founder/CapTable.tsx           (view tooltips, chip tooltips, badge tooltip)
client/src/pages/founder/RoundNew.tsx           (Learn More + Step-2 ? tooltips)
client/src/pages/founder/RoundDetail.tsx        (state-badge tooltip + soft-circle explainer)
client/src/pages/investor/InvitationDetail.tsx  (per-tab intros + ? tooltips)
server/mockData.ts                              (4-round timeline + SAFE holders)
CAPAVATE_README.md                              (this file)
```

---

## What's new in Sprint 3

| Layer | Sprint 2 | Sprint 3 |
|---|---|---|
| Math engine | Primary only (decimal.js) | **Primary + reference engine** (BigInt scaled fixed-point at SCALE=1e38). Both agree to the share / cent on every published worked example. |
| Cap-table integrity | Computed live | **Reconstructed from hash-chained immutable ledger** (`reconstructCapTable` replays every transaction from genesis). |
| Round close | One-click | **Dual-engine reconciliation gate + founder × admin sign-off + immutable close transaction**. |
| Audit | Engine trace | **Audit + telemetry chains unified, sign-off chain visualised, divergence/reconciliation filters**. |
| Telemetry | None | **`@capavate/telemetry` — 38 event types, hash-chained log, derived metrics, cohort benchmarks** with 50 synthetic seeded rounds across 6 cohorts. |
| Admin surface | 10 pages | **+ /admin/reconciliation + /admin/telemetry**, 12 pages total |

---

## Three packages

### `packages/cap-table-engine` (primary, decimal.js)

- 24 pre-existing engine tests (golden-master + property-based)
- **NEW:** `src/ledger/` — append-only event-sourced ledger:
  - `transaction.ts` — typed payloads per type (issue / transfer / cancel / exercise / convert / repurchase / forfeit / amend / round_close), hash-chained, IP + location + identity hash captured.
  - `ledger.ts` — `appendTransaction(handle, entry) → newHandle` and `reconstructCapTable(input) → CapTableResult`. Pure / side-effect-free.
  - `chain.ts` — `verifyChain(entries) → { valid, brokenAt? }` walks every entry, recomputes every hash.
  - **8 ledger tests** (replay matches direct compute · two replays produce identical results · asOf truncation works · tampered entry detected · swapped prevHash detected · deletion detected · empty ledger valid).
- **NEW:** `src/reconcile/`:
  - `reconcile.ts` — runs primary + reference engines on same input, compares HOLDER × INSTRUMENT × SHARES + ownership% to 8 dp, returns `{ status: 'match' | 'divergence', diffs, primaryHash, referenceHash, runDuration }`.
  - `closeGate.ts` — orchestrates the close gate: reconcile → block on divergence → require founder sign-off → require admin sign-off → write immutable close entry to ledger.
  - **9 reconcile/gate tests** (match · divergence detected via buggy injection · 5-holder reconciliation in <500ms · close blocks on divergence · close blocks missing signatures · close permits with both signatures · post-close ledger is tamper-evident).

### `packages/cap-table-engine-ref` (NEW — reference engine)

- Independent re-implementation. Different author voice, different intermediate representation: BigInt scaled fixed-point at SCALE = 10^38. Banker's rounding for `mul`/`div` to mirror decimal.js's `ROUND_HALF_EVEN`.
- Public API: `referenceComputeCapTable(opts)` returns same `CapTableResult` shape as primary.
- Implements: SAFE post + pre-money conversion, note conversion, broad-based weighted-average AD, ESOP top-up (pre + post), liquidation waterfall.
- **15 reference-engine tests** pinned to the same published references as the primary engine (YC SAFE v1.2, Pulley note primer, Carta AD primer, NVCA waterfall, Brad Feld pool shuffle).

### `packages/telemetry` (NEW — investor-grade event capture)

- `events.ts` — discriminated union of **38 event types** across rounds, invitations, soft-circles, documents, cap_table mutations, eligibility, formula registry, lifecycle policies, reconciliations, sign-offs.
- `recorder.ts` — `TelemetryStore` with `recordEvent` (hash-chained, <50ms append target, performance-tested), `verifyChain`, `filter`, `subscribe`.
- `metrics.ts` — derived KPIs:
  - `roundDurationDays(events, roundId)`
  - `invitationToSoftCircleHours`
  - `softCircleToSignedHours`
  - `docGenToSignatureHours`
  - `signatureToFundsHours`
  - `funnelDropoff(events, roundId)` — invited / viewed / soft-circled / signed / funded counts + rates
  - `valuationDelta(events, companyId)`
  - `instrumentMix(events, roundId)`
  - `investorQuality(events, investorId)` — average cheque, follow-on rate, time-to-decide
- `benchmarks.ts` — `BenchmarkStore`: cohort = `(sector, stage, region)` triples, p25/p50/p75/p90 percentiles for round duration, valuation, soft-circle conversion, lead cheque, total raise, time-to-close. **Pre-seeded with 50 synthetic rounds** across 6 cohorts (fintech/seed/US, fintech/series_a/US, saas/seed/US, deeptech/pre_seed/US, fintech/seed/UK, marketplace/seed/SG) so /admin/telemetry has signal immediately.
- **13 telemetry tests** (recorder chains hashes · 100 events appended in <50ms each · filter works · verifyChain detects tamper · 5 metric calculator tests · 4 benchmark tests).

### Test summary

| Package | Tests | Status |
|---|---|---|
| @capavate/cap-table-engine | 41 (24 existing + 17 new) | All green |
| @capavate/cap-table-engine-ref | 15 (all new) | All green |
| @capavate/telemetry | 13 (all new) | All green |
| **Total** | **69 tests** | **69 / 69 passing** |

`npm test` from each package directory runs them.

---

## Reconciliation runtime envelope

Reconciliation runs in **<10ms typical, <500ms required** for a 5-holder cap table (validated by performance test). Telemetry append averages <1ms per event (validated for 100 consecutive appends).

Both engines agree to **38 decimal places** on every golden-master worked example. Ownership-percent comparison tolerance is 8 dp because that's where JS `parseFloat` round-trip noise on arbitrary-precision strings starts to bite — but underlying share counts always match exactly.

---

## /admin/ — twelve pages

| Route | Purpose |
|---|---|
| `/admin/dashboard` | Tenants, formulas, lifecycle policies — operational telemetry for the Capavate control plane |
| `/admin/companies/:id` | Full Company Profile + 30 M&A Intelligence fields |
| `/admin/investors` | Investor directory across tenants |
| `/admin/users` | Auth0 user list, roles, MFA status |
| `/admin/lifecycle-policies` | Configurable thresholds |
| `/admin/formulas` | Regional formula registry with test-status dots |
| **`/admin/reconciliation`** ⟵ NEW | **Belt-and-suspenders dashboard. KPIs, live runner (pick company → "Run reconciliation now" → primary + reference + diff), history table, holder × instrument drift detail.** |
| **`/admin/telemetry`** ⟵ NEW | **Events today/week/all-time + chain status, all-time round funnel (invited → viewed → soft-circled → signed → funded with conversion rates), cohort benchmarks (sector × stage × region with p25/p50/p75/p90), M&A intelligence signal pool (sparse cohorts flagged), event explorer with full JSON inspection.** |
| `/admin/audit-log` | **Extended.** Now unifies the admin audit chain + telemetry chain. Sign-off chains rendered human-readably ("Round X at company Y closed by founder Z, admin W, primary hash …, reference hash …"). Filter by sign-off / reconciliation / divergence events. |

---

## Founder UI — Round close sign-off workflow

In `/founder/rounds/:id`, a new **"Close round"** tab provides:

1. **Step 1 — Run reconciliation.** Click triggers primary + reference compute, shows side-by-side hash cards, and renders a green "Match — both engines agree" or red "Divergence — close blocked" status.
2. **Divergence path:** Blocking red card with full holder × instrument diff visible. "Round close blocked. Contact your platform admin."
3. **Match path → Step 2 sign-offs:**
   - "I, [founder name], confirm the projected post-close cap table is correct." → click captures timestamp + IP + identity hash → emits `signoff.requested` + `signoff.granted` telemetry.
   - "Awaiting admin counter-signature." Switch to admin role chip on landing to counter-sign.
4. **Step 3 — Commit close.** Once both signatures land, the **Close round** button writes the immutable `round_close` entry to the ledger AND emits `round.closed`, `cap_table.mutated` telemetry events. Audit trail visible in `/admin/audit-log`.
5. **After close:** Round is locked, ledger is sealed, audit trail is human-readable in /admin/audit-log.

---

## Telemetry wiring

Wired into existing flows:

| User action | Telemetry events emitted |
|---|---|
| Founder creates round (RoundNew) | `round.created` |
| Founder sends invitation | `invitation.created` |
| Founder bulk-imports CSV | `round.invitations_sent` |
| Investor opens invitation page | `invitation.viewed` |
| Investor confirms soft-circle | `invitation.soft_circled`, `softcircle.created` |
| Investor declines | `invitation.declined` |
| Founder runs close-round reconciliation | `reconciliation.run` (+ `reconciliation.divergence_detected` if applicable) |
| Founder signs off | `signoff.requested`, `signoff.granted` |
| Admin counter-signs | `signoff.requested`, `signoff.granted` |
| Round close commits | `round.closed`, `cap_table.mutated` |

For demo: the telemetry log is **pre-seeded** with realistic events for three companies (Acme · fintech · seed CLOSED, Fluxform · saas · series_a CLOSED, Helio · deeptech · pre_seed OPEN) so /admin/telemetry has 140+ events from the moment you open it.

---

## How to run

```bash
cd capavate-app
npm install
cd packages/cap-table-engine && npm install && cd ../..
cd packages/cap-table-engine-ref && npm install && cd ../..
cd packages/telemetry && npm install && cd ../..
npm run dev          # Express + Vite on port 5000
```

Run all tests:
```bash
(cd packages/cap-table-engine && npm test)        # 41 tests
(cd packages/cap-table-engine-ref && npm test)    # 15 tests
(cd packages/telemetry && npm test)               # 13 tests
```

Production build + serve:
```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

---

## What's still stubbed (Sprint 3+)

| Surface | Status | Sprint where it goes real |
|---|---|---|
| Auth0 JWT validation | Visual only | Sprint 4 |
| Postgres + RLS | SQLite for preview | Sprint 4 |
| Persistent ledger + telemetry log | In-memory; structurally Postgres-ready | Sprint 4 |
| Outbox events to Collective | Schema documented; emitter stub | Sprint 4 |
| Document e-signature | UI cue + telemetry events emit | Sprint 8 |
| Dataroom per-investor grants | UI placeholder | Sprint 9 |

---

## What changes between this preview and production

- Lift the in-memory `LedgerHandle` and `TelemetryStore` into Postgres tables `cap_table_ledger` and `telemetry_events` with the same hash-chain columns (`prev_hash`, `hash`); the verification logic ports unchanged.
- Replace `decimal.js` runtime + reference engine `BigInt fixed` runtime with the same TS code on the server.
- Wire Auth0 in place of the role chooser; admin role enforced via Cedar policy.
- `addToCohort` becomes a server-side cron triggered by `round.closed` events.
- `reconcile.ts` runs as a scheduled job per company per close-projection; results pinned to a `reconciliation_runs` table for the dashboard.
