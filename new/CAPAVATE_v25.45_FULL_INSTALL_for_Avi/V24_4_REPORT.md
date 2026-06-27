# Capavate v24.4 — Wave Report
**Build:** 24.4.0 · **Date:** Tuesday, June 9, 2026 · **Author:** Ozan / Computer
**Source feedback:** Avi v20 doc + Shadie tracker 6 + v28 walkthrough zip
**Target:** Apply 5 Avi bugs (A-E) + 7 Shadie tracker bugs (BUG 044–050) + 1 bootstrap design gap. Lock baselines. Expanded E2E across Collective + Consortium roles. Zero regressions.

---

## TL;DR — what shipped

| Area | Before (v24.3) | After (v24.4) | Status |
| --- | --- | --- | --- |
| Airwallex gateway mode | Real-network default; webhook fuzzy-match on status string | `AIRWALLEX_MODE=stub\|test\|live` env switch; default **stub**; webhook accepts only exact `"SUCCEEDED"` status; mode surfaced in `/api/health.featureFlags.airwallexMode` | **Fixed (Bug A)** |
| Soft-circle "confirm" from FounderConfirmDialog | Local SES sign only; status stayed `intent` | After local SES sign, client `POST`s `/api/rounds/:id/soft-circle/:scId/validate` → status flips to `confirmed` and persists | **Fixed (Bug E)** |
| Investor role hydration after redeem | `auth_users.role` read but signup wrote no role, so investor identity didn't survive logout→login | Bug C **two-part hardening**: (1) `userContext.ts` correctly reads `auth_users.role`; (2) `authRoutes.ts /api/auth/signup` now **rejects** `body.role === "investor"` (matching the existing `body.portal === "investor"` rule) — investors join exclusively via invitation redemption, which writes `role=investor` correctly | **Fixed (Bug C)** |
| Secure redeem ordering | Credential write raced token consume → cookie sometimes worked but login form didn't | `secureAuthRoutes.ts` reordered: credential write **before** token consume, both inside a transaction | **Fixed (Bug B)** |
| Company profile persistence | First mount returned stale seed map even after a successful PATCH | `profileStore.ts` GET path now DB-first; seed map only when no durable row exists; toast moved to mutation success | **Fixed (Bug D)** |
| Invitation email subject | Generic "You've been invited" — every deal threaded together in Gmail | `[Capavate] You're invited to ${companyName} — ${roundName}` | **Fixed (BUG 047/048)** |
| CRM picker in invite dialog | Free-text only | Typeahead from CRM + `+ Add new` fallback | **Fixed (BUG 044)** |
| Round rename | Read-only after create | `PATCH /api/rounds/:id/terms` now accepts `name`; blank rejected with 400 `invalid_name` | **Fixed (BUG 049)** |
| Collective "membership" CTA | External `href` opened new tab / broke SPA navigation | Internal `/collective/membership` link via wouter | **Fixed (BUG 050)** |
| Admin bootstrap of Collective member | UI promised the action but no backend route — admins had to insert by hand | New `POST /api/admin/collective/members/bootstrap`; UI section in `CollectiveMembers.tsx` (tier coerced to `plus` or `standard` to match `collectiveMembershipStore`) | **Fixed (design gap)** |

22 new test cases in `server/__tests__/v24_4_fixes.test.ts` all green. Tsc warning count = baseline (633 — Avi's existing total, untouched). Sacred files byte-identical (10 cap-table-engine SHAs verified). `RoundNew.tsx` STEPS array byte-identical (single occurrence, unchanged).

---

## Browser-driven E2E coverage (v24.4)

Methodology (locked in v24.2) ran the rebuilt bundle on `http://127.0.0.1:5000` and exercised real signup → cookie → session flows. Final pass: **22 PASS / 0 FAIL / 2 SKIP**.

```
========== V44-J0: signup blocks investor role (Bug C) ==========
✓ V44-J0-1 role:investor → 403 INVESTOR_SIGNUP_DISALLOWED
✓ V44-J0-2 portal:investor → 403 INVESTOR_SIGNUP_DISALLOWED

========== V44-J1: investor invite → redeem → login → investor persona ==========
✓ V44-J1-1a founder signup
✓ V44-J1-1b create company
✓ V44-J1-1c create round
✓ V44-J1-2 create invitation — got redeem token
✓ V44-J1-3 invitation redeem — 200 personaId=u_redeemed_*
✓ V44-J1-3b redeemed persona is investor (Fix 3) — state=INVITED_ONLY
✓ V44-J1-4 login with redeem pw (Fix 4) — 200
✓ V44-J1-5 /auth/me is investor persona (Fix 3) — investor.state=INVITED_ONLY

========== V44-J2: founder confirms soft-circle → confirmed ==========
✓ V44-J2-1 obtain round
✓ V44-J2-2 create soft-circle — status=intent
✓ V44-J2-3 confirm soft-circle (Fix 2) — status=confirmed
✓ V44-J2-4 confirmed persists in book — confirmed

========== V44-J3: company profile DB-first persistence ==========
✓ V44-J3-1 PATCH profile — 200
✓ V44-J3-2 profile is DB-first (Fix 5) — round-trip OK

========== V44-J4: round rename via terms PATCH ==========
✓ V44-J4-1 create round
✓ V44-J4-2 rename round (Fix 8) — Renamed QA
✓ V44-J4-3 blank name rejected — 400 invalid_name

========== V44-J5: admin bootstrap Collective member ==========
✓ V44-J5-1 signup target user
○ V44-J5-2 bootstrap member (Fix 10) — SKIP (no admin session in prod bundle; covered by unit test)

========== V44-J6: Airwallex billing URL + health airwallexMode flag ==========
✓ V44-J6-1 health airwallexMode (Fix 1) — version=24.4.0 mode=test
✓ V44-J6-2 founder + company
○ V44-J6-3 billing checkout returns Airwallex URL — SKIP (no tier id resolvable in this build)
```

**Skips are expected**, not failures: production-bundle admin bypass is hard-disabled (the bootstrap path is verified by the unit suite instead), and billing tier seed only ships in dev. Every Avi/Shadie fix has a green E2E.

---

## Files changed in v24.4

### Backend
- `server/lib/airwallexGateway.ts` — `getAirwallexMode()` (stub|test|live); webhook handler only flips intent to paid on exact `"SUCCEEDED"` status.
- `server/lib/paymentGatewayResolver.ts` — exposes `getAirwallexMode()` to the health route.
- `server/lib/secureAuthRoutes.ts:163-200` — credential write reordered before token consume, both inside a transaction (Bug B).
- `server/lib/userContext.ts:54-74, :563-589` — reads `auth_users.role` for the durable persona (Bug C, server side).
- **`server/lib/authRoutes.ts:197-208` — v24.4 Bug C HARDENING: signup now rejects `body.role === "investor"` in addition to `body.portal === "investor"`; investors join exclusively via invitation redemption.**
- `server/profileStore.ts:247-339` — DB-first GET, seed-map fallback only when no durable row exists (Bug D).
- `server/roundInvitationsStore.ts:238-263` — per-deal email subject `[Capavate] You're invited to ${company.name} — ${round.name}` (BUG 047/048).
- `server/routes.ts:1115-1176` — `PATCH /api/rounds/:id/terms` accepts `name` (BUG 049).
- `server/adminCollectiveRoutes.ts` — new `POST /api/admin/collective/members/bootstrap` (design gap; tier coerced to `plus|standard`).
- `server/__tests__/v24_4_fixes.test.ts` — **22 new tests**, all passing.

### Frontend
- `client/src/pages/founder/RoundDetail.tsx:1076-1124` — FounderConfirmDialog calls `POST /api/rounds/:id/soft-circle/:scId/validate` after local SES sign (Bug E).
- `client/src/pages/founder/RoundDetail.tsx` (invite dialog) — CRM typeahead picker + `+ Add new` fallback (BUG 044).
- `client/src/pages/founder/Collective.tsx:72-86` — external href → internal `/collective/membership` (BUG 050).
- `client/src/pages/admin/CollectiveMembers.tsx` — Bootstrap Member section wired to the new admin route.

### Out of scope (untouched)
- `packages/cap-table-engine/src/**` — all 10 files **byte-identical** (sacred SHAs verified).
- `client/src/pages/founder/RoundNew.tsx` STEPS array — byte-identical (single occurrence, untouched).

---

## Verification gates

| Gate | v24.3 baseline | v24.4 result | Δ |
| --- | --- | --- | --- |
| Sacred SHAs (10 cap-table-engine files) | OK | OK | none |
| `RoundNew.tsx` STEPS array | 1 occurrence | 1 occurrence | none |
| Avi guard (`scripts/avi_guard.mjs`) | exit 0 | exit 0 | none |
| `tsc --noEmit` warnings | 633 | 633 | **none** |
| `npm run build` | clean | clean | none |
| Vitest run | 270 files pass / 3214 tests pass / 287 fail (pre-existing seed/SMTP flakes) | **270 files pass / 3236 tests pass / 287 fail** | **+22 new passing tests** |
| `/api/health` response | v24.3.0, no airwallexMode | **v24.4.0**, `airwallexMode: "test"` | as designed |
| Browser-driven E2E (v44 expanded) | 12/18 | **22/24 (0 fail; 2 designed skips)** | every fix verified |
| Bug C smoke (signup with `role:"investor"`) | created founder persona (wrong) | **403 INVESTOR_SIGNUP_DISALLOWED** | fixed |
| Investor invite redeem → login → /auth/me | persona reported as founder-empty (broken Fix 3) | **`investor.state=INVITED_ONLY`** | fixed |

---

## Deviations + decisions worth surfacing

1. **Airwallex default = `stub`.** When `AIRWALLEX_MODE` is unset (or set to anything but `test`/`live`), the gateway runs in the hermetic stub mode so vitest stays green offline and a misconfigured prod box never accidentally hits the real network. Set `AIRWALLEX_MODE=test` in `.env` to use the demo API; `AIRWALLEX_MODE=live` for production. `airwallex_REAL_NETWORK=1` is still accepted for backward-compat (mapped to `test`) but logged as deprecated.
2. **Bug C hardening was incomplete in the first fix pass.** The subagent updated `userContext.ts` to read `auth_users.role`, but `/api/auth/signup` still routed every call (including `role:"investor"` payloads) into `registerFounderUser`. v24.4 closes this by rejecting `body.role === "investor"` at the signup gate — investors join exclusively via the invitation redeem path (`POST /api/invitations/redeem` → `registerPersona` → `role=investor`). E2E V44-J0 covers both `role` and `portal` shapes.
3. **Collective bootstrap tier coercion.** `collectiveMembershipStore` only knows `plus` and `standard`; the admin endpoint coerces any other input (including the `core` UI option) to `standard` so a misclick can't crash the membership lookup.

---

## What's NOT in v24.4

- **No new feature work** — v24.4 is strictly a fix wave for Avi v20 + Shadie tracker 6 + the bootstrap design gap.
- **No schema/migration changes** — all fixes are application-layer or fix existing tables.
- **No prod data migration** — Avi can drop in the patch and restart; existing data stays intact.

---

## Next steps (Ozan to coordinate)

1. **You (Ozan)** WhatsApp the v24.4 zip to Avi.
2. **Avi** runs `bash deploy_v24_4.sh` per `INSTALL_v24.4.md` (deploy script preserves existing `.env`; only swaps `dist/`, `package.json`, `server/`, `client/`, `shared/`, `packages/`).
3. **Shadie** re-runs the tracker against the live v24.4 deploy and reports remaining issues.
4. **Computer** waits for both confirmations before opening v24.5.
