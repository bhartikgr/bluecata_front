# Capavate — Production Deployment Handoff
**Sprint 28 Pass 4 | For: Avinay (DevOps)**

---

## 1. Build Steps

```bash
# 1. Install dependencies (no dev deps, audit fixes)
npm ci --omit=dev

# 2. Build frontend (Vite) + backend (esbuild)
npm run build
# Output:
#   dist/public/    — static frontend (served by nginx or CDN)
#   dist/index.cjs  — Express server bundle
```

**Node.js**: 20 LTS minimum. 22 LTS recommended.

---

## 2. Production Server Start

```bash
NODE_ENV=production node dist/index.cjs
```

The server listens on `$PORT` (default 5000). It serves:
- `GET /api/*`  — REST API
- `GET /api/events/stream` — SSE realtime channel
- `GET /api/healthz` — Healthcheck (no auth)
- Static files via nginx (see §5)

---

## 3. Process Manager — PM2

```bash
npm install -g pm2

# Start
pm2 start ecosystem.config.cjs --env production

# Save to system startup
pm2 save
pm2 startup
```

**ecosystem.config.cjs**:
```js
module.exports = {
  apps: [
    {
      name: "capavate",
      script: "dist/index.cjs",
      instances: "max",           // one per CPU core
      exec_mode: "cluster",
      env_production: {
        NODE_ENV: "production",
        PORT: 5000,
      },
      // Restart if memory exceeds 512 MB
      max_memory_restart: "512M",
      // Log rotation
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: "/var/log/capavate/app.log",
      error_file: "/var/log/capavate/error.log",
      merge_logs: true,
    },
    {
      // Bridge outbox worker (processes queued bridge events in background)
      name: "capavate-bridge-worker",
      script: "dist/bridge-worker.cjs",
      instances: 1,
      env_production: { NODE_ENV: "production" },
    },
  ],
};
```

---

## 4. Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name app.capavate.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.capavate.com;

    ssl_certificate     /etc/letsencrypt/live/app.capavate.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.capavate.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options    nosniff always;
    add_header X-Frame-Options           SAMEORIGIN always;
    add_header Referrer-Policy           strict-origin-when-cross-origin always;

    # Gzip
    gzip on;
    gzip_types text/plain application/json application/javascript text/css image/svg+xml;

    # Static frontend (built by Vite)
    root /var/www/capavate/public;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass 1;
    }

    # SSE realtime channel — disable buffering
    location /api/events/stream {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Connection '';
        proxy_set_header   Host $host;
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
    }

    # File uploads proxy
    location /uploads/ {
        proxy_pass         http://127.0.0.1:5000;
        client_max_body_size 50m;
    }

    # SPA fallback — all non-/api routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 5. SSL — Let's Encrypt

```bash
# Install certbot
apt install certbot python3-certbot-nginx

# Issue certificate
certbot --nginx -d app.capavate.com -d collective.capavate.com

# Auto-renew (add to crontab or use systemd timer)
certbot renew --quiet
```

For AWS: use **ACM** (AWS Certificate Manager) with an ALB in front of EC2/ECS — no certbot needed.

---

## 6. PostgreSQL Setup

```bash
# Install PostgreSQL 16
apt install postgresql-16 postgresql-16-pgvector

# Create database and user
sudo -u postgres psql <<SQL
  CREATE USER capavate_app WITH PASSWORD 'STRONG_PASSWORD';
  CREATE DATABASE capavate_prod OWNER capavate_app;
  \c capavate_prod
  CREATE EXTENSION IF NOT EXISTS pgvector;
  CREATE EXTENSION IF NOT EXISTS pg_crypto;
SQL

# Run Drizzle migrations
DATABASE_URL="postgresql://capavate_app:STRONG_PASSWORD@localhost/capavate_prod" \
  npx drizzle-kit migrate:pg --schema=shared/schema.ts

# Verify with healthcheck
curl https://app.capavate.com/api/healthz
# Expected: {"ok":true,"dbConnected":true,...}
```

**Migration from in-memory to Postgres**:
1. Each server store (`subscriptionsStore.ts`, `adminContactsStore.ts`, etc.) has a `seedFromCanonical*()` helper.
2. Write a one-time seed script that calls these helpers and bulk-inserts the JSON into Postgres tables using Drizzle.
3. After migration, replace the in-memory `Map<>` stores with Drizzle queries (one store at a time, behind a feature flag).

---

## 7. SMTP Setup

**Recommended providers** (in order):

| Provider | Best for | Notes |
|---|---|---|
| AWS SES | High volume, low cost | ~$0.10/1000 emails; requires domain verification |
| SendGrid | Marketing + transactional | Good dashboards, 100/day free tier |
| Postmark | Transactional only | Highest deliverability, no bulk |

**DNS records** (required for all providers):

```
# SPF
TXT  capavate.com  "v=spf1 include:amazonses.com ~all"

# DKIM (provided by your email provider — add to DNS)
TXT  mail._domainkey.capavate.com  "v=DKIM1; k=rsa; p=..."

# DMARC
TXT  _dmarc.capavate.com  "v=DMARC1; p=quarantine; rua=mailto:dmarc@capavate.com"

# MX (for receiving bounce reports)
MX   capavate.com  10  inbound-smtp.us-east-1.amazonaws.com
```

Set `SMTP_MODE=smtp` in production. For staging: `SMTP_MODE=console`.

---

## 8. Payment Gateway Setup

The Collective gateway adapter (`server/paymentGatewayAdapter.ts`) is provider-agnostic. To wire real Stripe:

1. Set `PAYMENT_GATEWAY_API_KEY=sk_live_...` and `PAYMENT_GATEWAY_WEBHOOK_SECRET=whsec_...`.
2. Replace the mock `chargeSubscription()` implementation with a real Stripe SDK call:
   ```ts
   import Stripe from "stripe";
   const stripe = new Stripe(process.env.PAYMENT_GATEWAY_API_KEY!);
   const paymentIntent = await stripe.paymentIntents.create({ ... });
   ```
3. Register the webhook endpoint in the Stripe dashboard: `POST https://app.capavate.com/api/webhooks/payment-gateway`.
4. The existing webhook handler already verifies signatures via `PAYMENT_GATEWAY_WEBHOOK_SECRET`.

---

## 9. Monitoring

### Logging — pino (structured JSON)

```bash
npm install pino pino-http pino-pretty
```

```ts
// server/index.ts — add pino HTTP logger
import pino from "pino";
import pinoHttp from "pino-http";
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
app.use(pinoHttp({ logger }));
```

Ship logs to CloudWatch Logs (AWS) or Datadog.

### Error Tracking — Sentry

```bash
npm install @sentry/node
```

```ts
import * as Sentry from "@sentry/node";
Sentry.init({ dsn: process.env.SENTRY_DSN });
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### Healthcheck

```
GET /api/healthz
→ { ok: true, version, uptimeSec, dbConnected, bridgeOutboxBacklog, emailOutboxBacklog, timestamp }
```

Use this endpoint as your load-balancer health target (AWS ALB: path `/api/healthz`, 200 = healthy).

---

## 10. Backup Strategy

```bash
# Daily pg_dump to S3 (add to cron)
#!/bin/bash
DATE=$(date +%Y%m%d)
pg_dump \
  -h localhost \
  -U capavate_app \
  -d capavate_prod \
  -Fc \
  -f "/tmp/capavate_${DATE}.dump"

aws s3 cp "/tmp/capavate_${DATE}.dump" \
  "s3://capavate-backups-prod/${DATE}/capavate.dump" \
  --storage-class STANDARD_IA

# Remove local copy
rm "/tmp/capavate_${DATE}.dump"
```

- **Retention**: 30 days (S3 lifecycle rule: delete after 30 days)
- **Point-in-time recovery**: Enable Postgres WAL archiving + pg_basebackup for PITR
- **RTO target**: < 4 hours  
- **RPO target**: < 24 hours (daily backup), < 5 minutes (with WAL streaming)

---

## 11. Scaling Notes

### Horizontal scaling (stateless)

- The Express server is **stateless** — no sticky sessions required (sessions stored in Postgres `sessions` table).
- The in-memory stores (`Map<>`) are **single-instance only** and must be migrated to Postgres before horizontal scaling.
- Bridge outbox should be processed by a **separate worker process** (`capavate-bridge-worker`) to avoid blocking the API tier.

### Worker separation

The bridge outbox drain loop should run as an independent PM2 process:

```ts
// dist/bridge-worker.cjs
import { drainOutbox } from "./bridgeStore.js";
setInterval(async () => {
  await drainOutbox(async (env, hmac) => {
    // HTTP POST to BRIDGE_OUTBOUND_URL
  });
}, 5_000); // drain every 5 seconds
```

### Caching

- Add Redis for session caching once traffic exceeds ~500 concurrent users.
- Use `connect-redis` as the session store backend.
- Cache `/api/admin/companies/full` (expensive JOIN) for 30 seconds.

---

## 12. Known Limitations (Open Items for Next Sprint)

See `PRODUCTION_READINESS.md` for the full list.

---

## 13. Sprint 29 — New Environment Variables & Production Notes

### New Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `REDIS_URL` | No (Yes for horizontal scaling) | none | Redis connection URL for `connect-redis` session store. Format: `redis://user:pass@host:6379`. When unset, falls back to in-memory session store. |
| `BRIDGE_WORKER_ENABLED` | No | `true` | Set to `"false"` in the main API process to disable the built-in drain interval (use when running a dedicated bridge worker process). |
| `BRIDGE_WORKER_ONLY` | No | none | Set to `"1"` in a dedicated bridge worker PM2 process. See below. |
| `PAYMENT_GATEWAY_MODE` | No | `test` | Set to `"live"` to enable real Stripe API calls (requires `PAYMENT_GATEWAY_API_KEY`). |
| `PAYMENT_GATEWAY_API_KEY` | No | none | Stripe secret key (`sk_live_...`). If absent, payment calls fall back to simulation. |
| `PAYMENT_GATEWAY_WEBHOOK_SECRET` | No | none | Stripe webhook signing secret (`whsec_...`) for `POST /api/webhooks/stripe`. |

### Stripe Webhook URL

Register in the Stripe Dashboard:
```
https://yourdomain.com/api/webhooks/stripe
```
Supported events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `customer.subscription.deleted`.

### Bridge Worker Separation (Production)

In production, disable the built-in worker in the API process and run as a separate PM2 process:

```bash
# ecosystem.config.cjs
apps: [
  {
    name: "capavate-api",
    script: "dist/index.cjs",
    env: { BRIDGE_WORKER_ENABLED: "false" }
  },
  {
    name: "capavate-bridge-worker",
    script: "dist/index.cjs",
    env: { BRIDGE_WORKER_ONLY: "1", BRIDGE_WORKER_ENABLED: "true" }
  }
]
```

### Redis Session Store (Horizontal Scaling)

Set `REDIS_URL=redis://...` and sessions are automatically shared across all PM2 workers via `ioredis`. The `connect-redis` SessionStore adapter is plugged in automatically when `REDIS_URL` is detected.

### Database Hydration

On startup, `hydrateAllStores()` is called before the HTTP server starts listening. In sandbox (no `DATABASE_URL`), this is a no-op. In production, Avinay activates the Drizzle pg queries in `server/lib/hydrateStores.ts` to load each store's initial state from Postgres.

### Stripe API Key Safety

The Stripe adapter never throws — if the API key is invalid, Stripe returns 401 and the code falls back to the simulation adapter. This makes the app safe to deploy with a placeholder key before going live.
