# Sprint 15 — Login + Entitlement Architecture

## Baseline (verified before starting)
- Tests: **588 / 588** passing (69 files)
- Math gate: **73 / 73 OK**
- Sandbox: clean (only JSDoc references to localStorage)
- Light-mode: locked

## Status

- [x] **D1** — `server/lib/userContext.ts` + `getUserContextForId()`
- [x] **D1** — `/api/auth/me` (full UserContext) wired via `lib/authRoutes.ts`
- [x] **D2** — `server/lib/requireEntitlement.ts` middleware + `gate()` helper applied in routes.ts
- [x] **D2** — `__tests__/userContext.test.ts` (15 tests) + `__tests__/entitlementGates.test.ts` (34 tests) pass
- [x] **D5 server** — `/api/auth/login`, `/api/auth/signup`, `/api/auth/forgot`, `/api/auth/redeem/preview`, `/api/auth/redeem` live
- Tests: **637 / 637** (delta +49)
- Math gate: 73/73 OK

## Plan

D1 — `server/lib/userContext.ts` (UserContext + computation + `/api/auth/me` replacement)
D2 — `server/lib/requireEntitlement.ts` (middleware + error codes)
D3 — `client/src/lib/entitlement.tsx` (`useEntitlement` + `<RequireEntitlement>`)
D4 — `client/src/pages/Landing.tsx` (rebuild — two-path layout)
D5 — `client/src/pages/auth/{Login,Signup,Forgot,Redeem}.tsx`
D6 — `client/src/pages/SelectCompany.tsx`
D7 — Investor State 1 nudge dashboard mods
D8 — `CapCollectiveToggle` reads from `useEntitlement`
D9 — Edge case coverage
D10 — Tests
D11 — QA + math lock + build + deploy

## Existing primitives in repo (mapped)
- `getCompaniesForFounder()`, `getActiveCompanyId()` — from `multiCompanyStore.ts`
- `getMembership(userId)`, `isOnCapTable(userId, companyId?)`, `isCollectiveMember(userId)` — from `membershipStore.ts`
- `currentInvestor`, `incomingInvitations`, `investorPortfolio`, `companies`, `rounds` — from `mockData.ts`
- `_testAccess.companyProfiles` — from `profileStore.ts`
- Token store + `/api/invitations/{check,redeem}` — already in `routes.ts` Sprint 7

## Identity model used by /api/auth/me
The platform has 4 demo personas (selectable via `?as=` query param + `?userId=`):
- `u_maya_chen` — founder of co_novapay, co_arboreal, co_kelvin (active = co_novapay)
- `u_aisha_patel` — investor on co_novapay + co_arboreal, active Collective member
- `u_lapsed_lp` — investor on co_novapay only, lapsed Collective
- `u_no_position` — invited only, no cap table (State 1 nudge)
- `u_admin` — admin

## Final Status
- **Tests: 667 / 667 passing (was 588, delta +79)**
- **Math gate: 73 / 73 OK**
- **Sandbox: clean** (only 2 JSDoc references in CapCollectiveToggle.tsx + theme.tsx)
- **Build: OK** (1.4 MB server, 1.9 MB client, gzip 518 KB)
- **Light-mode locked: preserved**
- **Sprint 7 token gating preserved: yes** (registerAuthShellRoutes + invitationStore + sha256Hex)

## All deliverables shipped
- [x] D1 — userContext + /api/auth/me
- [x] D2 — requireEntitlement middleware + gate() helper
- [x] D3 — useEntitlement + RequireEntitlement HOC
- [x] D4 — Landing rebuild (two-path layout)
- [x] D5 — Login / Signup / Forgot / Redeem auth pages
- [x] D6 — SelectCompany picker
- [x] D7 — Investor State 1 nudge
- [x] D8 — CapCollectiveToggle reads UserContext
- [x] D9 — Edge case tests (9/9 from design Part 9)
- [x] D10 — State transitions + token + multi-company tests
- [x] D11 — math gate, sandbox grep, build, Playwright route walk, deploy
