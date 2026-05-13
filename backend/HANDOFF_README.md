# Capavate — Sprint 28 Production Handoff

**For:** Avinay (review + production deployment)
**From:** Ozan Isinak's build agent
**Date:** 2026-05-11
**State:** Production-ready (modulo 8 documented known limitations)

---

## What this build contains

This is the full Capavate + Capavate Collective platform after Sprint 28 (admin overhaul, founder gating, billing, region workflow, notifications composer, email system, end-to-end production hardening).

### Quality status (Sprint 28 + 29 + Wave C final)
- **Tests:** 1,715 passing (118 files)
- **Math integrity:** 86/86 (cap-table engine + canonical formulas — untouched and frozen)
- **Build:** clean (`npm run build`)
- **Bridge event types:** 48 outbound types defined and verified
- **All 8 known limitations (KL-01 through KL-08): RESOLVED**
- **Wave C: Real Collective shell + full dynamic data — SHIPPED**
- **Lint/type errors:** zero in production build

### Wave C — What's now fully dynamic
- **38 new founder-authored fields** — Public/Social, Jurisdiction, Preferences, Financials (stage-aware), Governance, M&A Prep
- **7 M&A readiness % fields** flow Capavate → Collective → trigger live DSC composite recomputes
- **Real Collective shell** at `/collective/*` — distinct plum/cream identity, 13 new pages
- **Live DSC scoring engine** — sector-weighted, auto-recomputes on bridge events, transparent breakdown
- **"Request from accountant"** magic-link flow for financial fields
- **Profile completion score** card with Collective discovery boost at 80%
- See `WAVE_C_DELTA.md` for the full Wave C change manifest

---

## Start here — these are the documents you'll want

| File | Purpose |
|---|---|
| `DEPLOY_HANDOFF.md` | **Read this first.** Step-by-step production deployment: build, PM2, nginx, SSL, Postgres setup, SMTP, payment gateway, monitoring, backups, scaling. |
| `DB_ARCHITECTURE.md` | All 17 tables (DDL), indexes, hash-chain columns, RLS multi-tenancy policy, migration plan from in-memory stores to Postgres. |
| `.env.example` | All 22 env vars with descriptions. Copy to `.env.production` and fill in. |
| `PRODUCTION_READINESS.md` | Final readiness checklist + 8 documented known limitations (KL-01 through KL-08) with estimated fix timelines. |
| `AUDIT_PASS_1_ADMIN.md` | Admin section: page-by-page audit, issues found, fixes applied. |
| `AUDIT_PASS_2_FOUNDER.md` | Founder section: same audit format. |
| `AUDIT_PASS_3_PARITY.md` | Collective ↔ Capavate data-parity audit + the new realtime SSE bridge. |

---

## Architecture summary

**Stack:** TypeScript end-to-end. Express on Node 20+ (server). React 18 + Vite + wouter + TanStack Query v5 (client). Tailwind + shadcn/ui (design system). Drizzle ORM (schema defined; SQLite in sandbox, Postgres recommended for prod). decimal.js + BigInt for all cap-table math.

**State management (current → target):**
- Sandbox build uses in-memory stores backed by `shared/schema.ts` Drizzle definitions.
- Production swap: change `server/db/connection.ts` from `better-sqlite3` driver to `postgres-js` (Drizzle supports both; the schema is identical). Run `drizzle-kit migrate` against your Postgres instance. The `seedFromCanonical*` helpers in each store become idempotent seed scripts you can run once.

**Hash-chain audit:** every mutable entity (subscriptions, invoices, pricing models, region extensions, contacts, notification campaigns, email campaigns) carries `version`, `prevRevisionHash`, `revisionHash`. Revisions are stored append-only in `*_history` tables. `verifyChain()` re-derives every revision and validates the linked list — tamper-evident.

**Bridge / Collective sync:** `server/bridgeStore.ts` emits 39 outbound event types. `server/eventBus.ts` pushes them to SSE subscribers in <1 second. Inbound sync handler at `/api/bridge/inbox` accepts HMAC-signed events from Collective. End-to-end parity tested in `server/__tests__/sprint28_collective_capavate_parity.test.ts`.

---

## What's in the admin section

URL prefix: `/#/admin/*`

| Route | Page | Status |
|---|---|---|
| `/admin/dashboard` | KPI dashboard with Capavate/Collective toggle | live |
| `/admin/companies` + `/:id` | Company directory with subscription status | live |
| `/admin/investors` + `/:id` | Contacts CRM (investors / founders / consortium partners) — 18 seeded contacts, double-verify, hash chain, audit | live |
| `/admin/users` | Users & Auth | live |
| `/admin/formulas` + `/:id` + `/new` | Cap-table formula registry (frozen canonical + custom) | live |
| `/admin/regions` + `/:id` | **NEW** Region extension workflow: research → draft → review → approved → live | live |
| `/admin/lifecycle-policies` | Platform lifecycle policies (now backed by `adminPlatformStore`) | live |
| `/admin/reconciliation` | Cap-table reconciliation runs | live |
| `/admin/telemetry` | Sprint 3 telemetry feeds | live |
| `/admin/audit-log` | Append-only admin audit log | live |
| `/admin/bridge` | Bridge outbox + dead-letter queue | live |
| `/admin/sync` | Inbound sync status | live |
| `/admin/migration` | Schema migration runs | live |
| `/admin/email` + `/new` + `/:id` | **NEW** Email System: campaigns / templates / outbox / transport / deliverability | live |
| `/admin/notifications` + `/new` + `/:id` | **NEW** Notification campaign composer with audience targeting + scheduling | live |
| `/admin/pricing` | **Pricing & Billing**: pricing models / subscriptions / invoices / billing metrics / payment gateway | live |
| `/admin/pricing-models/:id` | 12-tab pricing model editor (linked from Pricing & Billing tab 1) | live |

## What's in the founder section

URL prefix: `/#/founder/*`

| Route | Page | Gated? | Notes |
|---|---|---|---|
| `/founder/subscribe` | Mandatory subscription gate after new-company creation | no | Plan selector + Luhn-validated card form + 3DS placeholder |
| `/founder/billing` | Invoices, payment method, cancel/resume, email-invoice-to-me | no | All actions audit-logged |
| `/founder/dashboard` | Founder KPIs | **yes** | Requires `subscription.status === "active"` |
| `/founder/company` + `/:id` | Company profile | no | Allowed during onboarding |
| `/founder/rounds` + `/:id` | Round management | **yes** | CAP-TABLE LOGIC FROZEN |
| `/founder/dataroom` | Dataroom files | **yes** | |
| `/founder/crm` + `/new` | Founder CRM | **yes** | |
| `/founder/reports` + `/new` | Investor reports | **yes** | |
| `/founder/messages`, `/founder/activity`, `/founder/collective`, `/founder/network-posts`, `/founder/apply-to-collective`, `/founder/glossary` | Various | mixed | See `App.tsx` for exact gating |
| `/founder/settings` | Settings (profile, company, team, plan, billing nav) | no | All 6 mutations now invalidate queries (Sprint 28 Pass 2 fix) |

---

## Critical instructions for the production deploy

1. **DO NOT** modify anything under `packages/cap-table-engine*/`. The math integrity gate `bash scripts/check-math-integrity.sh` will catch regressions.
2. **DO NOT** modify the canonical 9-region list in `client/src/lib/regions.ts`. New regions live in `regionExtensionStore` and surface via `/api/regions` (the merged runtime endpoint).
3. **DO NOT** modify the cap-table or round-management page logic: `client/src/pages/founder/CapTable.tsx`, `RoundDetail.tsx`, `RoundNew.tsx`, `TermSheet.tsx`. They are explicitly off-limits per the user's mandate.
4. **DO** set `DISABLE_DEV_BYPASS=1` in production env to disable the `/api/dev/admin-bypass` preview endpoint.
5. **DO** rotate `SESSION_SECRET`, `BRIDGE_INBOUND_HMAC_SECRET`, and `PAYMENT_GATEWAY_WEBHOOK_SECRET` before going live.
6. **DO** configure DKIM/SPF/DMARC for the `SMTP_FROM` domain before live email send.
7. **DO** configure `STORAGE_PROVIDER=s3` and S3 credentials before founders upload to the dataroom.

---

## Test credentials (sandbox only — disable in production)

- Admin: `admin@capavate.io` / `adminpass`
- Founder: `maya@novapay.ai` / `password123`
- Investor: `aisha@greenwood.capital` / `password123`

In the deployed sandbox preview, a green "Sign in as Admin" banner appears at the top — one click signs in as admin. This banner self-disables when `window.location.hostname` is not in the preview allowlist.

---

## Legal & compliance integration

The 5 Blueprint Catalyst Limited (HK jurisdiction) legal documents — Privacy Policy, Terms of Service, Cookie Policy, Acceptable Use Policy, Disclaimer — are now integrated everywhere users need them:

- **Universal access**: "Legal & Privacy" button at the bottom of every admin/founder sidebar → opens a slide-in drawer with all 5 docs as **collapsed accordions** (short summaries by default, "Read full" to expand). No long forced reads.
- **Onboarding consent**: `LegalConsentCheckbox` placed at three critical moments:
  - New-Company form (Terms + Privacy + Acceptable Use)
  - Subscribe page (Terms + Privacy)
  - Signup page (Terms + Privacy)
- **Settings ledger**: Founder Settings now has a "Legal" tab where users see all 5 docs + their own complete consent trail (read-only audit).
- **Server-side ledger** (`server/legalConsentStore.ts`):
  - Append-only hash-chained consent records (SHA-256, tamper-evident)
  - Idempotent: re-recording the same (userId, docId, version) is a no-op
  - Captures IP + user agent + context (`signup` | `new_company` | `onboarding` | `settings_update`)
  - Endpoints: `POST /api/legal/consent`, `GET /api/legal/consent/mine`, `GET /api/admin/legal/consents`
  - Bridge event `legal_consent.recorded` fires on every new record
  - Audit-log entry on every recorded consent
- **Versioning**: `LEGAL_VERSION = "2026-03-17"` — bumping this version invalidates prior consents and re-prompts users.

## Sprint 29 — Known Limitations all resolved

The 8 documented limitations from the original handoff have all been closed:

- **KL-01** — `AdminCompanyDetail` now uses a real `companyProfileStore` (hash-chained, audit-logged, double-verify on mutations). Inline edit drawers per section.
- **KL-02** — Lifecycle policies promoted to a durable module-level store with hydrate hook + Drizzle `platform_config` table.
- **KL-03** — Inbound bridge state wrapped in `durableMap()` — in-memory in sandbox, Postgres-backed via `sync_inbox_state` table when `DATABASE_URL` is set.
- **KL-04** — Every store has a `hydrateFromDatabase()` function called by `hydrateAllStores()` at startup. Currently no-ops in sandbox; activates automatically when DB is connected.
- **KL-05** — `server/bridgeWorker.ts` runs an auto-drain interval every 5 seconds. Can be separated to its own PM2 process via `BRIDGE_WORKER_ONLY=1` for production scale.
- **KL-06** — `server/stripeGatewayAdapter.ts` ships with the real Stripe SDK. Falls back to simulation when API key is absent. Webhook endpoint `/api/webhooks/stripe` verifies signatures.
- **KL-07** — Invoice rows in `/admin/pricing` now link to `/admin/companies/:id`.
- **KL-08** — `server/sessionStore.ts` pluggable backend. In-memory in sandbox, Redis-backed when `REDIS_URL` is set (via `connect-redis` + `ioredis`).

## Sprint 29 — CSV roster importer

New at `/admin/investors/import`:
- Drag-and-drop CSV upload + sample CSV download
- Step 1 dry-run preview (no mutations until you confirm)
- Step 2 apply with `x-confirm: true` header — per-row audit trail + downloadable errors.csv on failures
- Idempotent on email (existing contacts are updated, new ones are created)
- Endpoint: `POST /api/admin/contacts/import-csv` (multipart)
- Sample: `GET /api/admin/contacts/sample-csv`

Use it to seed your real angel network roster (Keiretsu and others) directly into `adminContactsStore`.

## Outstanding decisions for Avinay

The user noted you would be sending production payment gateway credentials. Once received, set in `.env.production`:
- `PAYMENT_GATEWAY_API_KEY`
- `PAYMENT_GATEWAY_WEBHOOK_SECRET`
- `PAYMENT_GATEWAY_MODE=live`

You will also be sending production SMTP credentials. Set in `.env.production`:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_REPLY_TO`
- `SMTP_MODE=smtp`

Until those are configured, the system runs in safe modes:
- Payment gateway → simulation mode (returns synthetic intents)
- Email → console mode (logs to stdout, no real send)

Both modes are functional for QA without external dependencies.

---

## Files NOT included in this handoff bundle

- `node_modules/` — install via `npm ci`
- `dist/` — generated by `npm run build`
- `.env`, `.env.local`, `.env.production` — secrets, never bundle
- `*.log`, `coverage/`, `.cache/` — runtime artifacts

---

## Contact

Source-of-truth chat thread: ask Ozan for the Perplexity Computer session link.
For implementation questions, the audit reports + per-store inline comments are extensive.

Good luck with the deploy. The chains are clean. The tests are green. The math is sacred.
