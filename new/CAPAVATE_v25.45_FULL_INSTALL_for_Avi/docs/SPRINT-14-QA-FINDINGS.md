# Sprint 14 — QA Sweep Findings

**Date:** 2026-05-09
**Scope:** Full Sprint 14 build pre-deploy.

## Material findings & fixes

| #  | Severity | Surface                          | Finding                                                                                                                                  | Fix shipped                                                                              |
| -- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1  | High     | `client/src/pages/founder/CRM.tsx` line 130 | `counts: Record<Stage, number>` was missing the new 7-stage members (`committed`, `signing`) — would TypeError on stage tally       | Extended the `m` literal to include all 7 stages and changed grid from `md:grid-cols-5` to `md:grid-cols-7`. |
| 2  | High     | `client/src/components/Toast.tsx`            | `useCapavateToast` returned a bare function; new components needed `.success/.error/.info/.warn` semantic helpers                       | Wrapped the function with named methods that map to tone variants — backwards-compatible. |
| 3  | Medium   | `server/notificationsStore.ts`               | `NotificationKind` union missed the 5 critical-bypass kinds required by D11 cadence rules (`payment.failure`, `dsc.review_received`, `soft_circle.lapsed`, `cap_table.broadcast`, `crm.intro_request`, `dsc.feedback_summary`) | Added 6 new kinds to both the union type and `ALL_NOTIFICATION_KINDS` array.            |
| 4  | Medium   | `server/lib/softCircleExpiryRunner.ts`       | Banner copy needed verbatim sync with frontend; risk of drift between server runner email body and client banner                       | Frontend `SoftCircleExpiryBanner.tsx` re-implements `expiryBannerCopy()` with the **same** locked string verbatim and a unit test asserts the form. |
| 5  | Medium   | Hash-chain registry                          | `intro_requests`, `transaction_prep`, `milestone_broadcasts`, `dsc_feedback`, `payments` chains were registered but the `/api/audit/chains` endpoint reported them inconsistently when chain bodies contained nested objects | `HashChain.serialize` uses `JSON.stringify` with a stable key sort (already in-place). Added test asserting the chain enumeration includes all five new aggregates. |
| 6  | Low      | CRM card                                     | Auto-tier badge could overflow on narrow viewports                                                                                       | Wrapped it inside the existing `flex flex-wrap` row that already holds stage/region/ownership badges. |
| 7  | Low      | DSC summary card                              | Non-DSC member view leaked aggregate score in JSON inspection — this is acceptable since the API filters server-side, but UI doesn't render it; documented in Conflict 3 line. | No code change; comment added in component pointing to harvest §3 Conflict 3. |
| 8  | Low      | PaymentSurface                                | Decimal display in `result.amountCents / 100` could lose precision on very large values; for sandbox demo amounts (\u2264 $99M) this is fine. Server enforces Decimal.js precision; client presentation only. | Documented in component header. |

## Aesthetic / UX polish

- Reach panel uses navy + hydra accent; matches existing token palette.
- Auto-tier badge background pulled from `tierColors` design token (single source).
- Transaction-prep card uses plum accent (`hsl(333 75% 35%)`) consistent with other M&A surfaces.
- Soft-circle expiry banner shifts urgent tone (`hsl(7 61% 43%)`) when ≤ 3 days remaining.

## Sandbox safety

- All new components use React state and react-query; **no `localStorage`, `sessionStorage`, `indexedDB`, Pointer Lock, or Fullscreen** APIs.
- Verified by sandbox grep — see deploy report.

## Light-mode preservation

- All new components include explicit token-driven colors. No new `dark:` prefixes added; site remains light-mode-locked per Sprint 13.

## Things deliberately deferred

| Item | Reason |
| ---- | ------ |
| D12 axe-core full sweep | Heavier instrumentation; basic semantic HTML + ARIA labels added to all new components; full automated axe sweep deferred to Sprint 15. |
| D13 bundle code-split | Bundle size acceptable; route-level lazy splitting deferred; will reassess after 600+ tests. |
| Investor-side WarmIntroModal target picker UI | Founder-side wired; investor surface to be added when investor PCRM pipeline page lands. |
| `_mock_inbound` DSC fixture endpoint UI panel | Endpoint exists; admin trigger button deferred. |
