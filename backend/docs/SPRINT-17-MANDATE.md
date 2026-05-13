# Sprint 17 — Full Site Readiness Mandate

**Mandate**: Make Capavate launch-ready, end-to-end. No mock data. No "for show" surfaces. Every button works. Real-time data sync between Capavate ↔ Collective and across all surfaces. Cybersecurity hardened. Real database architecture. The user is delegating decision authority — pick global best practices.

## Audit baseline (live walk by parent agent on 2026-05-09 11:06 EDT)

39/42 routes render cleanly. Only 3 routes show non-fatal API 404 warnings (founder/messages, investor/messages, investor/crm). Remaining issues are deeper: button-by-button "for show" surfaces, no real persistence, security gaps, sync coverage holes.

## NON-NEGOTIABLES (preserve, never regress)

1. **Cap-table math 73/73 gate** — `bash scripts/check-math-integrity.sh` must pass
2. **Sandbox-safe** — no localStorage/sessionStorage/indexedDB runtime calls
3. **Light-mode locked** — Sprint 11 mandate
4. **Deploy gate** — `node scripts/check-deploy.mjs <URL>` must pass after every deploy
5. **All 727 prior tests must still pass** (Sprint 16 baseline)

## DELIVERABLES (priority order)

### D1. Real persistence layer (Postgres-shape, in-memory backend with migration path)

- Add Drizzle schemas for ALL stores (companies, rounds, cap-table, soft-circles, investors, comms, CRM, dataroom, payments, notifications, audit-log, etc.)
- Create `server/db/schema.ts` with full table definitions matching the 24 sync entities
- Create `server/db/migrations/` with auto-generated SQL (we'll use SQLite-in-memory for preview, with Postgres-compatible SQL ready)
- Update every store to use the DB layer instead of in-memory `Map`s where possible (keep existing Map fallback for sandbox)
- Add `server/db/connection.ts` reading `DATABASE_URL` env var; falls back to better-sqlite3 in-memory if unset

### D2. Cybersecurity hardening

- **CSRF tokens**: every state-mutating endpoint requires a CSRF token issued on session start, rotated on login
- **Rate limits**: per-user-per-endpoint sliding window. Specifically: 60 req/min per user on read, 10 req/min on write, hard cap on auth attempts (5 failures → 15 min lockout)
- **Input validation**: every endpoint runs zod-validated request bodies. Path/query params validated. Reject unknown fields.
- **Auth token handling**: replace persona-string approach with JWT tokens (session in httpOnly cookies, signed with HS256, 30-min sliding expiry, refresh flow). Add `server/lib/auth.ts` with `signSession()`, `verifySession()`, `requireAuth()` middleware.
- **Password hashing**: argon2id for any persisted passwords. Currently passwords are accepted without hashing (Sprint 15 deferred); fix.
- **Secret rotation**: `COLLECTIVE_WEBHOOK_SECRET` rotates on schedule with version chaining
- **Audit-log every mutation**: hash-chained per Sprint 14
- **Content Security Policy** headers on every response: strict, no inline scripts (already enforced by deploy proxy but tighten our backend too)
- **CORS**: tighten — only the deployed origin + localhost can call /api
- **SQL injection**: parameterized queries everywhere via Drizzle (no string concatenation)
- **XSS**: zod-validated text fields; no `dangerouslySetInnerHTML` anywhere
- **Sensitive log redaction**: never log full tokens, passwords, KYC docs, full SSN/EIN in audit log — redact to last 4
- Add `server/__tests__/security.test.ts` with: CSRF reject, rate-limit hit, JWT tamper rejection, replay attack, weak password reject, SQL-injection attempt blocked

### D3. Fix the 3 known-bug routes (the only ones with real errors)

- `founder/messages`, `investor/messages`, `investor/crm` — fix `/api/comms/channels-tiered` and `/api/investor/crm/{notes,tasks}` so they go through the port-rewrite proxy via `apiRequest()` helper, not raw fetch. Or stop hitting the absolute proxy URL.
- Verify SSE notifications stream gracefully degrades (no console error spam)

### D4. Wire real-time data sharing (no stale caches)

- Server-side `EventEmitter` on every mutation
- Client subscribes via SSE (`/api/events/stream`) — pushes invalidation hints for queryClient
- Founder edits company → investor view + admin view + Collective preview re-render within 1 second
- Cap-table commit → eligibility recompute → toggle visibility recompute live
- Test: spawn two browser contexts (founder + investor), edit on one, assert update on the other within 2s

### D5. Audit + fix every "for show" button platform-wide

For EVERY button on every route, verify the click does something real:
- Walks every screen with playwright
- For each `<button>` and CTA, click it and assert the next state is meaningful (toast appears, modal opens, navigation occurs, or visible UI updates)
- Buttons that no-op or render placeholder text get either fixed (real action wired) or removed
- Inventory in `SPRINT-17-DEAD-BUTTONS.md`, then fix

### D6. Login + entitlement hardening

- Real password hashing (argon2id) on signup + login
- JWT sessions in httpOnly cookies (replace string-persona)
- Multi-company picker persists active company in server-side session, NOT client memory
- Token-redemption flow: validate 256-bit token, set password, mint JWT, rotate
- Entitlement middleware reads from JWT claims + DB lookups
- `/auth/me` returns full UserContext with current entitlement state
- Logout invalidates session server-side
- Add 2FA scaffold (TOTP setup screen, code verification — actual enforcement deferred to Sprint 18 per user)

### D7. Admin user management (NEW page)

- `/admin/users` — currently bare; build full user management
- List: id, email, name, roles[], MFA status, last login, status (active/suspended)
- Search + filter by role + status
- Per-user actions: edit roles, suspend, force-logout, reset password, view audit trail, impersonate (with audit + warning banner)
- Bulk actions: invite, export CSV, suspend
- Backed by `usersStore` with hash-chained audit on every change

### D8. Term Sheet Builder (enhance)

- Generate, version, sign, send. Currently has the 9-region templates + SES from Sprint 6. Enhance:
  - WYSIWYG editor for clause-level edits
  - Term comparison: side-by-side diff between drafts
  - Counter-offer flow: investor proposes redlines, founder accepts/declines per clause
  - Send-to-investor: routes to investor's "Your Decision" tab with embedded preview
  - Auto-attach to round: terms feed into cap-table on close

### D9. CRM + Comms enhancements (anchored on transaction-scaling thesis)

- Warm-intro broker: full state machine pending → accepted → declined → completed (Sprint 14 wired the schema; build the UI fully and wire feedback into CRM contact)
- Cross-cohort DM (Sprint 16): verify hard cap 3/round/soft-circler, verify mute, verify rate-limit error UX
- Transaction-prep channel: 30 anchor threads, archived state, member roster
- Soft-circle IOI Pulse: aggregate to founder, never individual

### D10. Final personal walkthrough

After all above ship: parent agent walks every route on the deployed proxy URL again, captures screenshots of each persona × each route, asserts zero blanks/zero pageerror/every CTA clickable. Saves to `SPRINT-17-VERIFY/`.

### D11. Server transfer handoff doc

`DEPLOYMENT_PLAN.md` describing:
- Required environment variables (DATABASE_URL, COLLECTIVE_WEBHOOK_URL/SECRET, AUTH0_*, JWT_SECRET, etc.)
- Postgres provisioning steps (Drizzle migrations)
- Backup/restore procedure
- Monitoring recommendations
- Rollback plan
- Cutover sequence from live capavate.com

## QUALITY BAR

- 100% real, no "for show"
- Every button does what its label promises (auditable per-route)
- Real-time sync verified across surfaces
- Cybersecurity hardened (10 specific protections above)
- Database layer in place
- Math 73/73 preserved
- 727+ tests still pass; add ~150 new (security, real-time, dead-button regressions)
- Sandbox-safe preserved
- `node scripts/check-deploy.mjs <URL>` GATE PASSES on every deploy

## RETURN FORMAT

Save progress to `/home/user/workspace/SPRINT-17-PROGRESS.md`. Final report:

1. Files created + modified by D-number
2. Test count delta + math gate result
3. Routes added/changed
4. Database schemas defined (count of tables)
5. Security tests proof
6. Real-time sync proof (timing measurements)
7. Dead-button audit results (before/after)
8. Deploy URL + final `check-deploy.mjs` output
9. DEPLOYMENT_PLAN.md preview
10. Deferred items with explicit reasoning
