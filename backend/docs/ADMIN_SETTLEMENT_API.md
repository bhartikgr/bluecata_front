# Capavate platform-admin settlement API

**Status: WAVE 2B / MAJOR 2.** Review B recorded that WAVE 1A removed the GP's
"Collection outcome" selector without building an admin UI to replace it, and
the owner **accepted** that: no UI is built in this wave because it is net-new
scope. This document is the other half of that acceptance — it confirms the
API is usable today and records exactly how, so the capability is not lost
between waves and whoever builds the UI is not reverse-engineering it.

Until that UI ships, a Capavate platform admin settles fees with an
authenticated HTTP call (curl, Postman, or an ops script).

---

## Who can call these

Only a **Capavate platform admin**. Authorisation is `isPlatformAdmin()` in
`server/lib/feeSettlementAuthority.ts`, which requires an authenticated session
whose user row resolves to the platform tenant. **WAVE 2B / MAJOR 1** made that
check fail CLOSED: a missing user row, an empty/NULL tenant, or a thrown
database error all deny. A Consortium Partner session never carries `isAdmin`,
so no partner role — `managing_partner` included — can reach any route below.
Coverage: `server/__tests__/wave2b_major1_platform_admin_fail_closed.test.ts`.

The settlement outcome is **minted from the admin's session**, never read as a
plain body field on the object handed to the store. `authorizePlatformAdminSettlement()`
(`feeSettlementAuthority.ts:247`) issues a single-use (or, for carry, two-use)
authorization bound to `{purpose, spvId, obligationId, outcome}`. It cannot be
forged, replayed, or reused against a different obligation — see AC-S-2.c2,
c3 and c4 in `server/__tests__/wave1a_s2_fee_self_mark.test.ts`.

Both `outcome` and `reason` are **mandatory**. There is no silent default:
omitting either returns an error (`SETTLEMENT_OUTCOME_REQUIRED` /
`SETTLEMENT_REASON_REQUIRED`). `outcome` accepts only `"succeeded"` or
`"failed"`, and `"failed"` is a real, recorded outcome — not a no-op.

---

## The four routes

All are registered in `server/spvEngineRoutes.ts`.

### 1. Settle a fixed fee obligation — `spvEngineRoutes.ts:334`

```
POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/settle
{ "outcome": "succeeded", "reason": "wire received 2026-08-09, ref BK-99321" }
→ 200 { "obligation": { …, "state": "paid" } }
```

This is the route that replaces the removed GP selector. Settling also clears
the fail-closed `hasUnsettledFixedFees` commit gate, so the LP subscription can
advance to `committed`. Proven end-to-end by **AC-S-2.h**; the 403 paths for a
`managing_partner` and for an unauthenticated caller are **AC-S-2.i** and
**AC-S-2.i2**; the mandatory-fields behaviour is **AC-S-2.j**; a recorded
`failed` outcome is **AC-S-2.k**.

### 2. Waive a fixed fee obligation — `spvEngineRoutes.ts:353`

```
POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive
{ "reason": "…" }
→ 200 { "obligation": … }
```

Clears the fixed-fee block without recording a collection. Admin-gated by the
same `isAdmin` check.

### 3. Record a distribution, including carry — `spvEngineRoutes.ts:508`

```
POST /api/admin/consortium-spv/:spvId/distributions
{ "event": "exit", "grossProceedsMinor": 1000000, "costBasisMinor": 500000,
  "settlementOutcome": "succeeded", "settlementReason": "carry swept to platform account" }
→ 201 { "distribution": { …, "gpCarryMinor": 100000, "waterfall": [ … ] } }
```

The admin equivalent of the partner distribution route, and the only path that
can settle carry. A partner posting a carry-bearing distribution aborts
fail-closed (**AC-S-2.e2**); the admin route succeeds and marks the carry
obligation `paid` (**AC-S-2b.a**). Both carry legs settle under one
authorization (**AC-S-2b.b**, hence `maxUses: 2` for `distribution_carry`). It
is 403 for a partner (**AC-S-2b.c**), and a `failed` collection outcome records
no distribution row (**AC-S-2b.d**). Smuggled settlement keys in the body are
stripped and rejected (`assertNoSmuggledSettlement`, **AC-S-2.e**).

### 4. Set the platform fee layer — `spvEngineRoutes.ts:849`

```
POST /api/admin/consortium-spv/:spvId/platform-fee
{ "sponsorPartnerId": "…", … }
```

Capavate-admin-only; read-only to the GP. Returns
`SPONSOR_PARTNER_ID_REQUIRED` (400) if the sponsor is missing.

Supporting read: `GET /api/admin/consortium-spv` (`spvEngineRoutes.ts:841`)
lists every SPV across partners, which is how an admin finds `:spvId`.

---

## What this does NOT include

There is **no admin UI** for any of the above. That is the accepted gap
(Review B, MAJOR 2). The GP-facing note now rendered in
`client/src/components/partner/SpvDetailTabs.tsx` tells the partner that carry
settlement is not self-declared and is recorded by the gateway or by a Capavate
platform admin, so the workflow is at least discoverable from the product.

Building the UI is net-new scope for a later wave. When it is built, it should
call exactly these four routes; nothing new is needed on the server.
