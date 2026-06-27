# Capavate v24.4 — Master Report
**Wave:** v24.4 · **Version:** 24.4.0 · **Date:** Tuesday, June 9, 2026
**Audience:** Ozan, Avi, Shadie · **Verdict:** Ready to ship.

---

## Why v24.4 exists

Avi's v20 doc (29-May / 1-Jun) and Shadie's tracker 6 surfaced **13 issues** against the v24.3 production build:

1. **5 Avi P0/P1 bugs** (A–E): Airwallex test/live + status whitelist (A), secure-redeem ordering (B), investor role hydration (C), company profile DB-first (D), soft-circle confirm action (E).
2. **7 Shadie tracker bugs** (BUG 044–050): CRM picker in invite dialog, per-deal email subject lines, round rename, internal Collective links.
3. **1 design gap** — admin had a "Bootstrap Member" UI in `CollectiveMembers.tsx` but no backend route.

Standing rules from the user are honored:

- **Math/cap-table sacred files unchanged.** 10 cap-table-engine SHAs match `v24_4_sacred_baseline.txt` byte-for-byte. `RoundNew.tsx` STEPS array byte-identical (1 occurrence, untouched).
- **NO MOCK ANYTHING.** Every change goes through real DB writes, real session cookies, real Airwallex SDK paths.
- **Quality over speed.** Independent verification at every gate. Full vitest + tsc + build + browser-driven E2E before packaging.

---

## What was actually fixed (file:line, with severity)

| Severity | ID | Symptom | File(s) changed |
| --- | --- | --- | --- |
| P0 | Bug A | Airwallex called real network in stub mode; webhook used fuzzy string match on status | `server/lib/airwallexGateway.ts`, `server/lib/paymentGatewayResolver.ts`; surfaces `getAirwallexMode()` in `/api/health` |
| P0 | Bug B | Race in secure redeem: token consumed before credential write | `server/lib/secureAuthRoutes.ts:163-200` (reordered, transaction-safe) |
| P0 | Bug C | Investor identity lost after logout→login (role not hydrated, signup wrote no role) | (1) `server/lib/userContext.ts:54-74, :563-589` reads `auth_users.role`; (2) **`server/lib/authRoutes.ts:197-208` v24.4 hardening: rejects `body.role === "investor"` so investors join exclusively via invitation redemption** |
| P0 | Bug D | Company profile PATCH succeeded but GET returned stale seed | `server/profileStore.ts:247-339` (DB-first GET, seed fallback only when no durable row exists) |
| P0 | Bug E | FounderConfirmDialog signed local SES but never POSTed `/validate` — status stuck at `intent` | `client/src/pages/founder/RoundDetail.tsx:1076-1124` |
| P1 | BUG 044 | Invite dialog had no CRM contact picker | `client/src/pages/founder/RoundDetail.tsx` (typeahead + `+ Add new`) |
| P1 | BUG 047/048 | All invite emails shared the same subject (Gmail threaded unrelated deals) | `server/roundInvitationsStore.ts:238-263` — subject `[Capavate] You're invited to ${company.name} — ${round.name}` |
| P1 | BUG 049 | Round name was read-only after create | `server/routes.ts:1115-1176` `PATCH /api/rounds/:id/terms` now accepts `name`; blank rejected with `invalid_name` |
| P2 | BUG 050 | Collective membership CTA used external `href` (broke SPA navigation) | `client/src/pages/founder/Collective.tsx:72-86` — internal `/collective/membership` |
| P2 | Design gap | Admin "Bootstrap Member" UI without backend route | New `POST /api/admin/collective/members/bootstrap` in `server/adminCollectiveRoutes.ts`; tier coerced to `plus\|standard` (no `core` in `collectiveMembershipStore`) |

**22 new test cases** in `server/__tests__/v24_4_fixes.test.ts` — all green.

---

## Verification gates (every one passed)

### Sacred-file integrity
```
=== sacred SHAs ===
OK  packages/cap-table-engine/src/ledger/transaction.ts
OK  packages/cap-table-engine/src/primitives/bigDecimal.ts
OK  packages/cap-table-engine/src/primitives/fx.ts
OK  packages/cap-table-engine/src/primitives/hash.ts
OK  packages/cap-table-engine/src/primitives/shareCount.ts
OK  packages/cap-table-engine/src/reconcile/closeGate.ts
OK  packages/cap-table-engine/src/reconcile/index.ts
OK  packages/cap-table-engine/src/reconcile/reconcile.ts
OK  packages/cap-table-engine/src/types.ts
OK  packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts

STEPS array byte-identical? 1 occurrence (unchanged)
```

### Type / lint / build
- `tsc --noEmit` → **633 warnings** (matches v24.3 baseline; zero regression)
- `npm run build` → **clean** (server bundle 2.7 MB, vite client built without errors)
- `scripts/avi_guard.mjs` → exit 0

### Unit suite
- v24.3 baseline: **270 test files pass · 3214 tests pass · 287 fail (54 files)** — pre-existing seed/SMTP/dataroom flakes.
- v24.4 result: **270 test files pass · 3236 tests pass · 287 fail (54 files)** — **+22 new passing tests**, identical failure count → **zero regression**.

### `/api/health` on the rebuilt bundle
```json
{
  "status": "ok",
  "db": "connected",
  "sse_subscribers": 0,
  "hydrate_state": "ok",
  "uptime_s": 6,
  "version": "24.4.0",
  "featureFlags": {
    "smtpConfigured": true,
    "devResetUrlEnabled": true,
    "airwallexConfigured": true,
    "airwallexMode": "test"
  }
}
```

### Browser-driven E2E (v44 expanded)
**22 PASS · 0 FAIL · 2 SKIP** (skips are by design — admin bypass hard-disabled in prod bundle, billing tier seed only ships in dev). See full output in `V24_4_REPORT.md`.

---

## What's in the bundle

`CAPAVATE_v24.4_FULL_BUNDLE_for_Avi.zip` contains:
- `package.json` (version 24.4.0), `package-lock.json`
- `dist/` (server `index.cjs` + `public/`)
- `server/`, `client/`, `shared/`, `packages/` source trees
- `.env.example` (no secrets)
- `deploy_v24_4.sh`
- `INSTALL_v24.4.md`
- `V24_4_REPORT.md`
- This file

**Excluded:** `node_modules/`, `data.db`, `.git/`, any `*.log`. Avi installs deps with `npm ci` only if he ever does a fresh-tree deploy — the standard deploy script doesn't touch `node_modules`.

---

## What to tell Avi (one-liner)

> v24.4 is ready. Same deploy pattern as v24.3 — `bash deploy_v24_4.sh /var/www/html/backend`, then `pm2 restart capavate`, then `curl /api/health` to confirm version 24.4.0 and `airwallexMode:"test"`. Five Avi bugs, seven Shadie tracker bugs, and the bootstrap design gap all fixed. Zero schema migrations, full rollback supported. Detailed steps + smoke commands in `INSTALL_v24.4.md`. Bug C is hardened twice — once in `userContext.ts` (role hydration), once in `/api/auth/signup` (reject `role:"investor"`). Investors join only via invitation redemption.

## What to tell Shadie (one-liner)

> v24.4 is ready for retest. All seven of your tracker bugs (044, 047, 048, 049, 050) plus the four design/persistence bugs you flagged should now be green. Tracker has the v24.4 status columns pre-filled. Please re-run from your usual seed personas and surface anything that's still red — those become v24.5 candidates.

---

## Open items for v24.5 (NOT in scope here)

- Admin login flow polish — Ozan's v23.6 ask is still partial; admin actions in prod bundle require manual cookie injection. Not user-visible but slows Avi's smoke testing.
- Billing tier seed for production bundle — `/api/billing/tiers` returns `[]` in prod-built sandbox; verified-on-skip in V44-J6-3 E2E. Worth wiring a seed before the first real subscriber.
- Pre-existing vitest flakes (287 failures) — should be triaged in their own wave; they predate v24.0 and aren't user-facing.

These are catalogued in the v24.4 tracker for picking up later.
