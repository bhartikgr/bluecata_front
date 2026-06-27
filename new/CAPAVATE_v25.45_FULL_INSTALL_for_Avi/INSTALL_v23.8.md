# Capavate v23.8.0 — Install & Operate

## Build & run

```bash
npm ci
npm run build              # produces dist/index.cjs + dist/public

# Production boot
COLLECTIVE_ENABLED=1 NODE_ENV=production PORT=5000 \
  DATABASE_URL="file:./data.db" node dist/index.cjs
```

Health check (no auth):

```bash
curl -s http://127.0.0.1:5000/api/health
# {"status":"ok","db":"connected", ... ,"version":"23.8.0", ...}
```

## Environment

| Var | Purpose | Default |
|-----|---------|---------|
| `NODE_ENV` | `production` enables `__Host-` secure cookie | — |
| `PORT` | HTTP listen port | 5000 |
| `DATABASE_URL` | `file:./data.db` (SQLite) or `postgresql://…` | `file:./data.db` |
| `COLLECTIVE_ENABLED` | `1` unlocks the Collective subsystem (waitlist signups work regardless) | off |
| `FORCE_SECURE_COOKIE` | `1` forces the `__Host-` secure cookie outside production | off |
| `INVITATION_BASE_URL` | base for invitation/redeem links | `APP_URL` → `https://capavate.com` |
| `APP_URL` | app base URL (E1 fallback) | `https://capavate.com` |

### Session cookie (BUG-014 / E3)
The session cookie is now bounded to **4 hours** (`Max-Age=14400`). Founders
re-authenticate after the window; shared/abandoned browsers no longer stay
logged in indefinitely. In the `*.pplx.app` sandbox the cookie is emitted as
`__Host-cap_uid`; HTTP dev falls back to the legacy `cap_uid` name.

### Email / SES
Outbound email (invitations, report sends) requires AWS SES credentials to be
configured in the environment. Without them, sends are queued/best-effort and
surface in the bridge outbox backlog (`/api/healthz` → `bridgeOutboxBacklog`).

## E5 — Admin bootstrap
The `u_admin` identity (`admin@capavate.io`) is the platform admin persona.
For a production admin, insert a `users` row with `role='admin'` (and a hashed
password via the auth shell); `getUserContextForId` honors `users.role` so the
admin Users/Companies/Investors and the new **Collective Waitlist** panels
(`/admin/collective/waitlist`) unlock automatically.

## E6 — What changed in 23.8.0
See `/home/user/workspace/V28_REPORT.md` for the full per-fix breakdown (Groups
A–E, ~29 bugs) and the seven release gate results. Headline operator-facing
changes:
- 4-hour session cookie (re-login cadence).
- Invitation links default to `capavate.com` (set `INVITATION_BASE_URL` to override).
- New admin **Collective Waitlist** review page.
- Telemetry actor no longer defaults to a demo investor (`u_unknown`).
- `/api/health` + `/api/healthz` report the real package version.
