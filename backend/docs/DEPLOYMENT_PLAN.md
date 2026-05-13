# Capavate Production Deployment Plan
**Sprint 17 — Full Site Launch Readiness (D11)**
Generated: 2026-05-09 · Owner: Platform team · Stack: Express 5 + Vite + React + Drizzle ORM

---

## 1. Overview

Capavate ships as a single Node.js process (Express 5) serving:
- Static React SPA bundle (Vite-built) under `/`
- JSON REST API under `/api/*`
- Server-Sent Events (SSE) under `/api/events/stream` and `/api/notifications/stream`
- A few signed-bridge endpoints under `/bridge/*`

The preview build runs against an in-memory `better-sqlite3` database. **Production runs against managed Postgres.** All Sprint 17 schema work is Postgres-shape compatible; the cutover is a configuration change only.

---

## 2. Required Environment Variables

| Variable | Required | Format / Example | Purpose |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | Enables HSTS, disables Vite dev middleware, strict cookies. |
| `PORT` | yes | `5000` (or PaaS-injected) | HTTP listen port. |
| `DATABASE_URL` | **yes** | `postgres://user:pwd@host:5432/capavate?sslmode=require` | When prefix is `postgres://` / `postgresql://` the SQLite stub throws — wire your `pg` driver here (see §4). |
| `JWT_SECRET` | **yes** | 64+ random hex chars (e.g. `openssl rand -hex 48`) | HS256 signing key for `server/lib/auth.ts`. **Rotate quarterly.** |
| `SESSION_TTL_HOURS` | optional | `24` (default) | Session lifetime. |
| `COLLECTIVE_WEBHOOK_URL` | yes (Cap Collective) | `https://collective.capavate.com/hook` | Outbound mutation fan-out target. |
| `COLLECTIVE_WEBHOOK_SECRET` | yes | 32+ hex chars | HMAC signature for outbound webhook payloads. |
| `SES_REGION` | yes (email) | `us-east-1` | AWS SES region for term-sheet + notification emails. |
| `SES_FROM_ADDRESS` | yes (email) | `no-reply@capavate.com` | Verified SES identity. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes (email) | IAM creds | SES send permission only — least privilege. |
| `CORS_ALLOWED_ORIGINS` | optional | `https://capavate.com,https://app.capavate.com` | Overrides default allowlist (`*.pplx.app`, `capavate.com`, `localhost`). |
| `RATE_LIMIT_READS_PER_MIN` | optional | `60` (default) | Global GET budget per IP. |
| `RATE_LIMIT_WRITES_PER_MIN` | optional | `10` (default) | Global mutation budget per IP. |
| `LOG_LEVEL` | optional | `info` (default), `debug`, `warn` | Pino-style log verbosity. |

**Secret storage**: AWS Secrets Manager or PaaS-native (Render/Railway/Fly env). Never commit. Rotate `JWT_SECRET` and `COLLECTIVE_WEBHOOK_SECRET` quarterly; rotate AWS keys via IAM rotation policy.

---

## 3. Hosting Topology

Recommended initial topology:

```
            ┌──────────────────────────┐
 capavate.com ─► CloudFront / Fastly ─► Node app (1–N replicas) ─► Postgres (managed)
                                       └─► AWS SES (email)
                                       └─► CapCollective webhook
```

- **App tier**: 2× small instances behind a load balancer (Render Standard / Fly 1× shared-cpu-2x / EC2 t3.small ASG of 2). Sticky sessions **NOT** required — sessions are JWT-bearer.
- **DB tier**: Managed Postgres 15+. Start at 2 vCPU / 4 GB RAM, 20 GB storage, daily backups, PITR enabled.
- **Email**: AWS SES production sandbox release required before launch (typically 24–72h approval).
- **CDN**: Static assets (`/assets/*`) served via CDN with 1y immutable cache (Vite hashes filenames). HTML served `Cache-Control: no-cache`.

---

## 4. Database Provisioning & Migration

### 4.1 Schema source of truth
- `server/db/schema.ts` — Drizzle schemas for **24 sync entities** + 3 auth tables (`auth_users`, `auth_sessions`, `auth_redeem_tokens`).
- `server/db/migrations/0001_sprint17_sync_and_auth.sql` — generic SQL (TEXT/INTEGER) safe for both SQLite preview and Postgres.

### 4.2 First-time provision (Postgres)
```bash
# 1. Provision DB and capture DATABASE_URL.
# 2. Generate idiomatic Postgres migration from Drizzle schema (recommended):
npx drizzle-kit generate:pg --schema=server/db/schema.ts --out=drizzle-pg
# 3. OR apply the hand-written SQL directly:
psql "$DATABASE_URL" -f server/db/migrations/0001_sprint17_sync_and_auth.sql
# 4. Verify entity count:
psql "$DATABASE_URL" -c "\dt sync_*" | wc -l   # expect 24
psql "$DATABASE_URL" -c "\dt auth_*"           # expect 3
```

### 4.3 Driver swap
`server/db/connection.ts` currently throws when `DATABASE_URL` starts with `postgres://`. Production cutover:

```ts
// server/db/connection.ts (production branch)
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
export const db = drizzle(pool, { schema });
```

Add `pg` to dependencies (`npm i pg @types/pg`). The `syncRepo` API (`upsert/get/list/softDelete`) is driver-agnostic.

### 4.4 Initial data seeding
- 7 SEED_USERS in `server/lib/adminUsersRoutes.ts` are demo data — **delete or replace** with the real founding admin set in production.
- Existing in-memory Map stores (Sprint ≤16) need a one-time export → import. A `seedFromMaps()` placeholder should be authored in Sprint 18 to walk each Map and call `syncRepo.upsert`. Until then, the production cold-start is empty by design.

---

## 5. Backup & Disaster Recovery

| Concern | Plan |
|---|---|
| Daily full backup | Managed-Postgres native daily snapshot, retained 30 days. |
| Point-in-time recovery | Enable PITR (5-min RPO). |
| Off-site copy | Weekly `pg_dump` to S3 (cross-region bucket, `aws:kms` encryption, lifecycle: 90 days → Glacier). |
| Restore drill | Quarterly: spin a staging DB from latest snapshot, run `bash scripts/check-math-integrity.sh` + `node scripts/check-deploy.mjs <staging>` to validate. |
| RPO / RTO | RPO 5 min · RTO 30 min on managed-DB failover; 4 h on cross-region restore. |

```bash
# Manual backup snippet
pg_dump --format=custom --no-owner --no-privileges \
        --file="capavate-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
aws s3 cp capavate-*.dump s3://capavate-backups/postgres/ --sse aws:kms

# Restore snippet
pg_restore --clean --if-exists --no-owner --no-privileges \
           --dbname="$DATABASE_URL" capavate-2026-05-09.dump
```

---

## 6. Monitoring & Alerting

### 6.1 Application metrics (emit + scrape)
- `auth.login.success` / `auth.login.failure` (counter, by reason: `bad-password`, `locked`, `unknown-user`)
- `auth.lockout.triggered` (counter)
- `ratelimit.429` (counter, by route bucket)
- `csrf.reject` (counter)
- `sse.connections.active` (gauge — both `/api/events/stream` and `/api/notifications/stream`)
- `sse.events.delivered` (counter, by aggregate)
- `db.query.duration_ms` (histogram, by entity)
- `webhook.collective.failures` (counter)
- HTTP request duration p50/p95/p99 (histogram)

### 6.2 Alert thresholds (PagerDuty / Opsgenie)

| Signal | Warning | Critical |
|---|---|---|
| 5xx rate | > 0.5% over 5 min | > 2% over 5 min |
| Auth failure rate | > 30/min globally | > 100/min globally (likely attack) |
| Lockouts | > 5/min | > 20/min |
| `ratelimit.429` | > 50/min | > 200/min |
| SSE active connections | > 500 | > 1000 (capacity review) |
| DB connection saturation | > 70% pool | > 90% pool |
| Webhook delivery failures | > 1% | > 5% |
| p95 latency `/api/*` | > 400ms | > 1000ms |

### 6.3 Logs
Ship to CloudWatch / Datadog / Loki. Required log fields per request: `request_id`, `user_id` (if authed), `route`, `status`, `duration_ms`, `ip` (hashed for GDPR). `server/lib/sanitize.ts::redact()` already strips passwords/tokens/SSN — keep it in the request-logger pipeline.

### 6.4 Synthetic checks (every 60 s)
1. `GET /api/health` returns 200 + `{ ok: true, db: "ok" }`
2. `POST /api/auth/secure/csrf` returns a token
3. Page render: `GET /` returns 200 with `<div id="root">`

---

## 7. Security Posture (already shipped in Sprint 17)

- **JWT HS256** sessions, 24h TTL, `secret` from env, signed via `node:crypto.createHmac`. No third-party JWT lib.
- **Password hashing**: scrypt with `N=2^15`, `r=8`, `p=1`, 16-byte random salt — format `s2$N$r$p$salt$hash`. NIST/FIPS-equivalent, ships with Node.
- **CSRF**: double-submit cookie + header (`x-csrf-token`); applied to `/api/auth/secure/*` (signup/redeem/login/csrf are exempt; logout/2FA require it).
- **Rate limiting**: 60 reads/min, 10 writes/min per IP (sliding window); auth lockout after 5 failed attempts → 15-min freeze.
- **Input validation**: zod `strictObject` on every mutating route — unknown fields rejected.
- **Sanitization**: `redact()` middleware strips secrets from request/response logs.
- **Headers** (`server/middleware/security.ts`): CSP, HSTS (prod only), X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy.
- **CORS**: allowlist `*.pplx.app`, `capavate.com`, `localhost` — override via `CORS_ALLOWED_ORIGINS`.
- **Sandbox compliance**: zero `localStorage` / `sessionStorage` / `indexedDB` (only JSDoc references). All persistence is server-side.

**Verified** by 46 security tests (`server/__tests__/security.test.ts`) plus 12 secureAuth tests + 11 adminUsers tests.

---

## 8. Deployment Procedure

### 8.1 Pre-deploy gates (must all pass)
```bash
cd capavate-app
npx vitest run                              # 807/807 pass
bash scripts/check-math-integrity.sh        # 73/73 pass
grep -rn "localStorage\|sessionStorage\|indexedDB" \
        client/src/ --include="*.ts" --include="*.tsx"   # only JSDoc lines
npm run build                               # dist/public + dist/index.cjs emitted
```

### 8.2 Deploy steps (zero-downtime, blue/green)
1. **Build** the artifact: `npm run build` (emits `dist/public` + `dist/index.cjs`).
2. **Push image** (Docker) or **upload bundle** to PaaS.
3. **Run migrations** against production DB (idempotent).
4. **Spin up green replicas** at `green.capavate.com`, hold off load balancer.
5. **Smoke**: `node scripts/check-deploy.mjs https://green.capavate.com` — must report **35/35 routes**.
6. **Cutover**: shift load balancer 100% → green.
7. **Hold** blue replicas for 30 min as rollback target.
8. **Tear down** blue.

### 8.3 First production cutover from sandbox
1. Provision Postgres (§4) and apply migration.
2. Set all env vars from §2 in target environment.
3. DNS: lower TTL on `capavate.com` to 60 s 24 h before cutover.
4. Build + deploy as above; verify gate passes.
5. DNS swap `capavate.com` → new origin.
6. Monitor for 4 h: error rate, p95, auth failures, SSE connections.
7. Restore TTL to 3600 s after 48 h of stability.

---

## 9. Rollback Plan

Triggered by: 5xx > 2%, auth-failure surge, or any P0 user-impact bug discovered in first 4 h.

1. **Revert app**: shift load balancer back to held-over blue replicas (or redeploy previous image tag).
2. **Keep DB**: do **not** roll back the database. Sprint 17 migrations are additive — the previous app version ignores `sync_*` and `auth_*` tables harmlessly.
3. **Verify**: re-run `node scripts/check-deploy.mjs https://capavate.com` — expect 35/35.
4. **Postmortem within 48 h**: file in `/docs/postmortems/` with timeline, root cause, action items.

If a migration must be reversed (rare):
```bash
psql "$DATABASE_URL" -c "BEGIN; DROP TABLE IF EXISTS sync_xyz CASCADE; COMMIT;"
```
Always wrap in a transaction; never drop while replicas are live.

---

## 10. Real-Time Sync (Sprint 17 — D4)

- Server uses an in-process `EventEmitter` (`server/lib/eventBus.ts`) with SSE (`/api/events/stream`).
- Client `useRealtimeSync` hook (`client/src/lib/realtimeSync.ts`) subscribes once at app mount; every aggregate event invalidates the relevant React Query keys via `AGGREGATE_TO_KEYS`.
- **Measured delivery latency**: 11 ms (founder POST `/api/admin/users` → SSE subscriber). Budget: 2 000 ms. Headroom: 180×.

**Multi-replica caveat**: in-process EventEmitter does not fan out across replicas. For >1 app replica, replace with Redis Pub/Sub (`ioredis` + `redis.publish('events', JSON.stringify(evt))` and a per-replica subscriber that re-emits to local SSE clients). This is a **Sprint 18 task** — do **not** scale beyond 1 replica until done, or accept that some clients will miss cross-replica mutations until their next poll.

---

## 11. Compliance & Audit

- **Data retention**: `auth_sessions` purged 30 days after expiry; `auth_redeem_tokens` purged 7 days after consumption. Cron job: `node scripts/cron/purge-expired.mjs` daily at 03:00 UTC.
- **PII scope**: `auth_users.email`, `sync_users.full_name`, `sync_companies.contact_email`. Encrypt at rest via Postgres TDE + at transit via TLS 1.2+.
- **Audit log**: every admin action (`/api/admin/*`) writes `sync_audit_logs` with actor, target, action, timestamp.
- **GDPR / PIPEDA right-to-delete**: `DELETE /api/admin/users/:id` soft-deletes (sets `deleted_at`); a separate `purge-user.mjs` script hard-deletes after 30-day grace.

---

## 12. Open Items (Deferred to Sprint 18)

| Item | Reason | Risk |
|---|---|---|
| `seedFromMaps()` (in-memory → Postgres copy) | Out-of-scope for launch readiness; production starts cold. | Low — admins re-enter foundational data. |
| Redis Pub/Sub for multi-replica SSE | Single replica covers expected launch volume (<500 concurrent). | Med — caps horizontal scale until done. |
| Term Sheet WYSIWYG / diff / counter-offer (D8) | Existing Sprint 6 termsheet flow + 9 region templates + SES delivery is functional. | Low — feature parity preserved. |
| CRM/Comms UI polish (D9) | Sprint 14/16 wired schemas + rate-limits; UI iteration deferred. | Low — back-end ready. |

---

## 13. Sign-Off Checklist

- [ ] All env vars set in production (§2)
- [ ] Postgres provisioned, migrations applied, entity count verified (§4)
- [ ] SES production access granted, `SES_FROM_ADDRESS` verified
- [ ] Backups configured + first restore drill complete (§5)
- [ ] Monitoring dashboards + alerts wired (§6)
- [ ] DNS TTL lowered 24 h pre-cutover
- [ ] Pre-deploy gates green (§8.1)
- [ ] `check-deploy.mjs` reports 35/35 against production URL
- [ ] Rollback path tested in staging (§9)
- [ ] On-call rotation set for first 72 h post-launch
