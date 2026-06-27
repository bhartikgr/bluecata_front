# Capavate Sprint 12 — Admin + Capavate↔Collective Bridge + Full Platform QA

**Date**: May 9, 2026
**Tests**: 380 passing across 57 files (was 332/56, +48 tests)
**Math integrity**: 53/53 critical tests locked via CI gate
**Build**: clean (505KB gzipped) · 0 TypeScript errors · 0 page errors across 14 walked routes
**Deploy**: live (asset `dea0e0a3-5b44-4f27-bfc9-07e96cd5346a`)

## Mandate

Macro admin overview. Capavate↔Collective toggle with exact audit conditions. Unified login. Full bridge (12 outbound + 4 inbound events). Email + Notify systems matching Collective parity. Pricing dual-engine. Cap-table math integrity NEVER regresses.

## What shipped

### Phase A — Foundation

**A1. Capavate↔Collective Toggle** — global header component visible by audit conditions:
- Admin: always visible
- Investor: visible iff `capTablePositions.length > 0 && isCollectiveMember && !lapsed`
- Founder: visible iff `isCollectiveMember && !lapsed`
- Lapsed renewal hides toggle (matches Sprint 11 rule)
- 8 visibility tests locked

**A2. Unified Login** — single `/login` surface, role-based routing (admin / founder / investor / collective_member), token gating preserved (Sprint 7), multi-company picker preserved (Sprint 11)

**A3. Full Capavate↔Collective Bridge** — `server/lib/bridgeStore.ts`:
- 12 outbound events: `company.profile.updated`, `company.ma_intelligence.updated`, `investor.profile.updated`, `cap_table.mutated`, `eligibility.recomputed`, `lifecycle_policy.changed`, `formula.published`, `audit_log.appended`, `safe.converted`, `note.converted`, `round.closed`, `governance_metric.published`
- 4 inbound: `dsc.scores`, `ma.intelligence_rankings`, `partner.introduction_status`, `network.social_signals`
- HMAC-SHA256 signed envelope · idempotency-key=eventId · exponential backoff · dead-letter queue · hash-chained
- Mock Collective receiver at `/api/_mock_collective/inbound`
- `/admin/bridge/verify-chain` returns ok:true on 11 seeded entries

### Phase B — Admin surfaces

**B1. Admin Dashboard rebuilt** — platform-wide KPIs (companies / investors / $ committed / $ funded / MoM / churn / NRR), health cards, queues, onboarding + soft-circle funnels, top performers, region heatmap (9 regions), real-time activity feed (`refetchInterval: 15s` for KPIs, `10s` for activity)

**B3. Investor Detail rebuild** (the weakest area on live) — per-investor profile with holdings across all companies, soft-circle history, $ committed/funded, IRR contribution, behavior signals, segmentation filters, scoring, bulk actions, LTV + churn risk

**B5. Email System** — `server/lib/emailStore.ts`:
- 14 templates (round_invitation, soft_circle_submitted, round_closed, collective_welcome, kyc_update, form_d_reminder, emi_notification_reminder, 83b_election, etc.)
- Variable preview + test send · queue state machine · sent/delivered/opened/clicked/bounced statuses
- Bulk send + segmentation
- A/B variant preview

**B6. Notify System** — `server/lib/notifyStore.ts` (FIXED broken bell):
- `NotificationBell` wired in header with unread badge
- `NotificationCenter` page at `/notifications`
- 21 notification kinds across 3 channels (in-app / email / push)
- Per-user preferences page
- Admin can broadcast platform-wide notifications
- SSE stream `/api/notifications/stream` (deployed env falls back to 30s polling)
- `/api/notifications/kinds` confirms count: 21

**B9. Audit Log power** — surfaces tamper-evident chain (`priorHash → hash`), Verify Chain Integrity button, divergence indicator, compliance export (SOC 2 / GDPR-ready)

**B10. Pricing dual-engine** — `/admin/pricing`:
- Tab 1: Collective Membership tiers (Standard $1,200/yr + admin-managed variants)
- Tab 2: Capavate Founder Subscription (founder_free $0 / founder_pro $249 / founder_scale $749)
- Per-region pricing matrix (9 regions)
- Per-customer overrides + coupons
- Stripe placeholder demo banner
- Billing reports + revenue dashboard (MRR, ARR, churn $)

### Phase C — Quality

**C1. Bug hunt — 14 routes walked, 3 bugs fixed**:
1. **High**: Raw `fetch()` bypassed `__PORT_5000__` rewrite causing PageError on `/admin/dashboard`. Fixed in 8 files.
2. **Low**: CapCollectiveToggle 404 noise for users without Collective record. Treated as null.
3. **Low**: SSE EventSource didn't stream in deployed env. No-ops, falls back to polling.
- Final walkthrough: **0 page errors across all 14 routes**

**C2. Math Integrity Lock** — `scripts/check-math-integrity.sh` gates 53 tests across 17 files:
- `captableCommit.test.ts` — commit pipeline atomicity
- `ledger.test.ts` — double-entry journal
- `reconcile.test.ts` — cap-table reconciliation
- `ownership-sums-100.test.ts` — property test (all 9 regions × 7 instruments)
- `shares-conserve.test.ts` — property test
- `note.test.ts`, `esop.test.ts` — ref engine
- All pass — math NEVER regresses

**C3. Tests** — 48 new in `sprint12.test.ts` covering toggle, login routing, bridge envelope/HMAC/idempotency/dead-letter, dashboard KPIs, investor segmentation, email templates, notify SSE + 21 kinds, audit chain verification, pricing per-region

## Routes added

`/notifications` · `/admin/bridge` · `/admin/email` · `/admin/notifications` · `/admin/pricing` (rebuild) · `/admin/investors/:id`

## Totals across the app

- **Routes**: 15 founder + 9 investor + 13 admin (+3) + 1 unified login + 1 notifications = 39
- **Tests**: 380 across 57 files
- **Math gate**: 53/53 tests in CI script
- **Bridge**: 12 outbound + 4 inbound events, HMAC + hash chain
- **Notify**: 21 kinds, 3 channels
- **Email**: 14 templates
- **Stack unchanged**

## Deferred (small)

- SSE in deployed env falls back to 30s polling (EventSource URLs not rewritten by deploy proxy)
- Pre-existing TypeScript BigInt-literal warnings in cap-table-engine-ref legacy code
- B2/B4/B7/B8 (Companies/Users/Reconciliation/Telemetry admin pages) intact from Sprint 11 — already use correct apiRequest pattern, no rebuild needed
- Bundle 1.86MB raw / 505KB gzipped — could split with dynamic imports

## Three doors open

1. **Sprint 13 — production hardening**: Postgres + RLS, real Auth0 tenant, real DocuSign, real Stripe Connect, real Collective webhook (replaces mock receiver), Fastify migration, real SSE in deployed env
2. **Compliance partner brief**: Cooley / Stikeman / AZB / Big-4 outreach pack
3. **Commercial layer**: marketing site, public pricing page, GTM motion
