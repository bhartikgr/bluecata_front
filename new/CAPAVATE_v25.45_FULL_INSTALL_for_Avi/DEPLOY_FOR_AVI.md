# DEPLOY_FOR_AVI.md — Capavate v23.2 deployment, single-source-of-truth

> **Audience:** Avi.
> **Promise:** every step is in this one file. No "see other doc" rabbit holes.
> If something here looks wrong vs the code, the code wins — and run
> `bash scripts/install_verifier.sh` to find out what's drifted.

---

## Part 1 — Quick start (4 commands)

```bash
unzip capavate_v23.2_FINAL_24_may.zip
cd capavate_v23.2_FINAL_24_may/capavate_app

# First time only — copy and edit env values
cp .env.example .env && $EDITOR .env

# One-shot install + verify
bash scripts/install_avi.sh

# (Re-run any time to re-verify, e.g. after env changes)
bash scripts/install_verifier.sh
```

If `install_avi.sh` ends with `Install complete!`, you are ready to
`npm start`. If it doesn't, read the line right above the error — it
tells you exactly what to fix.

---

## Part 2 — What `install_avi.sh` does (transparency)

It runs these 7 steps, in order, with strict error handling (`set -euo pipefail`):

1. **Verify zip extracted correctly** — checks `package.json`, `server/`,
   `client/`, `migrations/`, `server/db/migrate.ts`, `scripts/seed_demo.ts`
   are present. **The single most common failure mode** is an old zip
   that's missing `server/db/migrate.ts` (added in Wave A). The script
   catches that immediately.
2. **Install npm deps** — runs `npm install` (skips if `node_modules`
   is newer than `package.json`).
3. **Check .env** — copies from `.env.example` if missing, then stops and
   asks you to fill it in. You cannot proceed past this step with an empty
   `.env`.
4. **Run migrations** — `npm run db:migrate`. Idempotent. Tracks applied
   migrations in `__drizzle_migrations_applied`, so partial runs resume cleanly.
5. **Seed demo data** — only when `NODE_ENV != production`. Creates
   `admin@capavate.io / adminpass` and demo founders/investors. Skipped
   automatically in prod.
6. **Build production bundle** — `npm run build` → `dist/index.cjs` +
   `dist/public/`.
7. **Run the verifier** — `scripts/install_verifier.sh`. Prints PASS/WARN/FAIL
   for every check; exits non-zero if anything failed.

---

## Part 3 — Manual install (if the script fails)

Use this if `install_avi.sh` won't run for any reason. The script is doing
exactly these steps; running them by hand gives you finer-grained control.

### Step 1: Verify the zip

```bash
unzip capavate_v23.2_FINAL_24_may.zip
cd capavate_v23.2_FINAL_24_may/capavate_app
ls server/db/migrate.ts scripts/seed_demo.ts package.json migrations/0050_*.sql
```

**Expected output:** all four paths exist.

**If you see `cannot access 'server/db/migrate.ts'`:**
> You have an OLD zip from before Wave A. The migrate runner is missing.
> Re-download `capavate_v23.2_FINAL_24_may.zip` from Ozan and start over.
> This is the #1 root cause of past deploys ending in `ERR_MODULE_NOT_FOUND`.

### Step 2: Install dependencies

```bash
node --version   # must be 20.x or newer
npm  --version   # must be 10.x or newer
npm install
```

**Expected output:** ends with `added N packages, audited N packages in Xs`.

**If you see `EACCES` / `permission denied`:**
> Don't run with sudo. Fix ownership: `sudo chown -R $USER ~/.npm`.

**If you see `npm ERR! peer dep` warnings:**
> Safe to ignore. The package-lock pins compatible versions.

### Step 3: Configure environment

```bash
cp .env.example .env
$EDITOR .env
```

Fill in at minimum: `NODE_ENV`, `SESSION_SECRET`, `DATABASE_URL` (if Postgres),
`STRIPE_*`, `AIRWALLEX_*`. See **Part 4** below for every variable.

### Step 4: Run migrations

```bash
npm run db:migrate
```

**Expected output:**
```
[migrate] Connecting to sqlite at ./data.db ...
[migrate] Found 50 migrations on disk, 0 already applied
[migrate] Applying 0000_numerous_roxanne_simpson.sql ... OK
[migrate] Applying 0001_windy_mockingbird.sql        ... OK
...
[migrate] Applying 0050_users_title_displayname.sql  ... OK
[migrate] Done. 50 applied, 0 skipped.
```

**If you see `ERR_MODULE_NOT_FOUND: server/db/migrate.ts`:**
> The new migrate script is missing. You're running an OLD zip.
> Re-download `capavate_v23.2_FINAL_24_may.zip` from Ozan.

**If you see `ECONNREFUSED 127.0.0.1:5432`:**
> Postgres isn't reachable. Check `DATABASE_URL`, check the DB is up,
> check the host/port. Or leave `DATABASE_URL` blank to use SQLite for dev.

**If you see `readonly database`:**
> The `./data.db` file isn't writable. `chmod 664 data.db && chmod 775 .`

### Step 5: Seed demo data (dev / staging only — NOT prod)

```bash
ENABLE_DEMO_SEED=1 npm run db:seed:demo
```

**Expected output:** ends with `Demo seed complete: 1 admin, 5 founders, 4 investors, ...`

After this you can log in with:
- `admin@capavate.io` / `adminpass` → admin dashboard
- `founder1@capavate.io` / `founderpass` → founder dashboard
- `investor1@capavate.io` / `investorpass` → investor dashboard

**Do NOT run this in production.** It will overwrite users.

### Step 6: Build

```bash
npm run build
```

**Expected output:**
```
[build] bundling server -> dist/index.cjs
[build] bundling client -> dist/public/
[build] done in 12.3s
```

Sanity check:
```bash
ls -la dist/index.cjs dist/public/index.html
```

### Step 7: Start

```bash
npm start
```

**Expected:** `[server] listening on http://0.0.0.0:5000`.

In another shell:
```bash
curl http://localhost:5000/api/health
# {"status":"ok","db":"ok","migrations":50,...}
```

### Step 8: Verify

```bash
bash scripts/install_verifier.sh
```

Read every PASS/WARN/FAIL line. Fix any FAIL before declaring the deploy done.

---

## Part 4 — Environment variable reference (CRITICAL)

| Env var | Required? | Production value | Dev value | Where to get / Notes |
|---|---|---|---|---|
| `NODE_ENV` | required | `production` | `development` | n/a — controls many security defaults |
| `PORT` | optional | `5000` (or reverse-proxy upstream) | `5000` | n/a |
| `DATABASE_URL` | optional | `postgres://user:pass@host:5432/capavate_prod` | unset → falls back to `./data.db` | Your DB provider (RDS, Supabase, Neon, etc.) |
| `SESSION_SECRET` | **REQUIRED** | 64 hex chars | `dev_secret_change_me_in_production_min_32_chars_xxxxxx` | Generate: `openssl rand -hex 32` |
| `DISABLE_DEV_BYPASS` | **REQUIRED prod** | `1` | `0` | Must be `1` in prod — disables the dev login bypass |
| `ALLOW_DEV_BYPASS` | **REQUIRED prod** | `0` | `0` or `1` | Must be `0` in prod — second safety gate |
| `COLLECTIVE_ENABLED` | required | `1` | `1` | Toggles the Collective subscription product |
| `CONSORTIUM_ENABLED` | required | `1` | `1` | Toggles the Consortium application flow |
| `PAYMENT_GATEWAY_DEFAULT` | required | `airwallex` | `airwallex` | **Ozan's directive (May 2025): AirWallex is default.** Set `stripe` only if explicitly told. |
| `AIRWALLEX_API_KEY` | required if AirWallex active | `sk_...` | mock works for dev | https://www.airwallex.com/app/api → "API keys" |
| `AIRWALLEX_CLIENT_ID` | required if AirWallex active | UUID-ish string | mock | AirWallex dashboard → API page (next to API key) |
| `AIRWALLEX_WEBHOOK_SECRET` | required if AirWallex active | `whsec_...` | mock | AirWallex dashboard → Developer → Webhooks → secret |
| `AIRWALLEX_API_BASE` | optional | `https://api.airwallex.com` | same | n/a — only change for sandbox |
| `STRIPE_SECRET_KEY` | **REQUIRED** (Collective billing) | `sk_live_...` | `sk_test_...` | https://dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | **REQUIRED** | `whsec_...` | `whsec_test_...` | Stripe → Developers → Webhooks → endpoint → "Signing secret" |
| `STRIPE_COLLECTIVE_BASIC_PRICE_ID` | required | `price_...` | `price_test_...` | Stripe → Products → Collective Basic → API ID |
| `STRIPE_COLLECTIVE_STANDARD_PRICE_ID` | required | `price_...` | `price_test_...` | Stripe → Products → Collective Standard |
| `STRIPE_COLLECTIVE_PREMIUM_PRICE_ID` | required | `price_...` | `price_test_...` | Stripe → Products → Collective Premium |
| `SENTRY_DSN` | optional (recommended in prod) | `https://...@sentry.io/...` | unset | Sentry project settings → Client Keys (DSN) |
| `GIT_SHA` | optional | commit hash (CI sets this) | `dev` | Surfaced on `/api/health`; useful for cache-busting |
| `LOG_LEVEL` | optional | `info` | `debug` | `error \| warn \| info \| debug` |
| `CAPTCHA_SECRET` | optional | provider secret | unset | Only set if you turn on captcha |
| `SMTP_HOST` | optional | SES / SendGrid / Postmark host | unset → console.log fallback | Provider docs |
| `SMTP_PORT` | optional | `587` | `587` | n/a |
| `SMTP_USER` | optional | provider username | unset | Provider |
| `SMTP_PASS` | optional | provider password | unset | Provider |
| `SMTP_FROM` | optional | `Capavate <no-reply@yourdomain>` | same | n/a |
| `RESOURCES_STORAGE_PROVIDER` | optional | `s3` (for binary uploads) | unset → local disk | n/a |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | required if S3 used | from AWS | unset | AWS IAM |

### What each "REQUIRED prod" var actually does

- **`SESSION_SECRET`** — signs session cookies. If it's short or empty,
  sessions break and Avi can't stay logged in. Anything under 32 chars is rejected.
- **`DISABLE_DEV_BYPASS=1`** — turns OFF the "log in as anyone" dev shortcut.
  If left as `0` in prod, anyone can impersonate any user. Catastrophic.
- **`ALLOW_DEV_BYPASS=0`** — second-line guard against the same bypass.
  Both must be set correctly.
- **`PAYMENT_GATEWAY_DEFAULT=airwallex`** — Ozan's May 2025 directive.
  Routes all new subscriptions through AirWallex. Stripe remains available
  for Collective price IDs (subscription products) only.

---

## Part 5 — Verification (post-deploy)

After `npm start` is running behind your domain, do these **9 EXACT checks** in order:

1. **Browser:** open `https://<yourdomain>/api/health`
   → expect JSON with `"status":"ok"`. If you see a 502, the server isn't up.
2. **Browser:** open `https://<yourdomain>/#/admin/login`
   → expect the admin login form (Capavate logo + "Admin sign in").
3. **Log in** as `admin@capavate.io` / `adminpass` (only works if demo seed ran)
   → expect to land on `/admin/dashboard`.
4. **Admin dashboard top-right:** the persona switcher shows **4 options**
   (Admin, Founder, Investor, Partner).
5. **`/admin/pricing` → Pricing Models tab:** exactly **one tier "Capavate Annual" $840/year**.
6. **`/admin/pricing` → Payment Gateway tab:** **AirWallex** shown as default.
7. **`/admin/audit/verify-chain`** renders (not a 404). This was a regression we keep watching.
8. **`/#/partner/login`** renders the partner login form.
9. **`/#/apply/consortium`** → fill in a test app, submit
   → expect HTTP 201 (not 401). Confirms `CONSORTIUM_ENABLED=1` and routes are wired.

**If any of those 9 fail:**
```bash
bash scripts/install_verifier.sh
```
Read every FAIL line. Each one comes with a copy-paste fix.

---

## Part 6 — Common errors + fixes

| Symptom | Root cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: server/db/migrate.ts` | Old zip from before Wave A | Re-download `capavate_v23.2_FINAL_24_may.zip` from Ozan |
| `Migration X failed` / `ECONNREFUSED` | DB unreachable | Check `DATABASE_URL` host/port; ensure DB is up |
| `Migration X failed` / `readonly database` | SQLite file not writable | `chmod 664 data.db && chmod 775 .` |
| `Migration X failed` / `duplicate column` | Previous partial run | Safe to re-run — migrations are idempotent |
| `Login fails for admin@capavate.io` | Demo seed never ran | `ENABLE_DEMO_SEED=1 npm run db:seed:demo` (dev only) |
| Admin sidebar links 404 | Migrations not applied | `npm run db:migrate && npm start` |
| `AirWallex webhook signature invalid` | Wrong secret | Re-copy `AIRWALLEX_WEBHOOK_SECRET` from AirWallex dashboard → Webhooks |
| Stripe live mode shows test data | Test secret in prod | `STRIPE_SECRET_KEY` must start with `sk_live_`, not `sk_test_` |
| `/api/health` returns 502 | Server didn't start | `npm start` in foreground; read the actual error |
| `Session expired immediately` | `SESSION_SECRET` < 32 chars or changed between restarts | Generate: `openssl rand -hex 32`, set once, keep stable |
| Old code on live site after deploy | Browser / CDN cache, or old `dist/` | Hard refresh, bust CDN, confirm `dist/index.cjs` mtime is recent, restart server |
| Verifier says "0 of 50 migrations applied" but app works | DB was migrated by a previous app version that didn't write to `__drizzle_migrations_applied` | Run `npm run db:migrate` — idempotent migrations will no-op on the existing schema and backfill the tracking table |
| `EADDRINUSE :::5000` | Port in use | `lsof -i :5000` to find the process, kill it, or set `PORT=5001` |
| Persona switcher only shows 1 option | User isn't a global admin | Re-run demo seed, or update user's `role` in DB |

---

## Part 7 — Rollback procedure

> ### ⚠️ ⚠️ ⚠️  BACKUP THE DATABASE **BEFORE** RUNNING MIGRATIONS  ⚠️ ⚠️ ⚠️
>
> ```bash
> # SQLite:
> cp data.db data.db.backup_$(date +%Y%m%d_%H%M%S)
>
> # Postgres:
> pg_dump "$DATABASE_URL" > capavate_backup_$(date +%Y%m%d_%H%M%S).sql
> ```
>
> Migrations CAN drop columns or rename tables. There is NO undo button.
> If you skip the backup and a migration corrupts data, the only recovery is
> whatever your DB provider has in nightly snapshots — and those may be hours old.

If something goes catastrophically wrong:

1. **Stop the new server.**
   ```bash
   # Find it
   ps aux | grep 'node dist/index.cjs'
   # Or, if you used a process manager
   pm2 stop capavate     # or: systemctl stop capavate
   ```

2. **Roll back the code.**
   - If you're on git: `git checkout <previous-deploy-commit>` then `npm install && npm run build`.
   - If you deployed from a zip: re-extract the **previous** zip into a sibling
     directory and switch your reverse proxy / symlink to point at it.

3. **Roll back the DB.**
   ```bash
   # SQLite:
   cp data.db.backup_<timestamp> data.db
   # Postgres:
   psql "$DATABASE_URL" < capavate_backup_<timestamp>.sql
   ```

4. **Restart the previous server.**
   ```bash
   npm start
   ```

5. **Re-verify:**
   ```bash
   bash scripts/install_verifier.sh
   curl http://localhost:5000/api/health
   ```

6. **Tell Ozan immediately.** Include: which zip you rolled back to, the
   tail of the server log, and which of the 9 Part-5 checks were failing.

---

## TL;DR Cheat sheet

```bash
# Install
bash scripts/install_avi.sh

# Re-verify
bash scripts/install_verifier.sh

# Re-run migrations (idempotent)
npm run db:migrate

# Re-seed demo (dev/staging only)
ENABLE_DEMO_SEED=1 npm run db:seed:demo

# Rebuild
npm run build

# Start
npm start

# Health
curl http://localhost:5000/api/health
```
