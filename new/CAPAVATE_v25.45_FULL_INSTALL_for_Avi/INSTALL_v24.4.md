# Capavate v24.4 — Install & Deploy Guide

**For:** Avinay Kumar (deployment engineer)
**From:** Ozan / Computer
**Build:** 24.4.0
**Date:** Tuesday, June 9, 2026
**Bundle:** `CAPAVATE_v24.4_FULL_BUNDLE_for_Avi.zip` (Ozan WhatsApps you the zip)

---

## 0 — Confirm prereqs

```bash
node --version          # expect v20.x (matches v24.3)
which npm
which sqlite3           # optional — for ad-hoc inspection
```

No new system packages. No schema migrations. No `.env` changes required (existing `DATABASE_URL`, `SMTP_*`, `AIRWALLEX_*`, `APP_VERSION` keep working).

---

## 1 — One-shot deploy (recommended)

```bash
cd /var/www/html
# Stop the running app (use whatever you already use — pm2, systemd, etc.)
pm2 stop capavate         # or: systemctl stop capavate

# Unzip into a staging dir (do NOT overwrite live tree directly).
mkdir -p /var/www/html/capavate-v24.4
cd /var/www/html/capavate-v24.4
unzip /path/to/CAPAVATE_v24.4_FULL_BUNDLE_for_Avi.zip

# Run the deploy script — it preserves your live data.db + .env.
bash deploy_v24_4.sh /var/www/html/backend
```

`deploy_v24_4.sh` copies these directories into your live backend:
- `dist/` — fresh server + client bundle
- `server/` — TypeScript sources (for restart-without-rebuild)
- `client/`, `shared/`, `packages/` — same
- `package.json`, `package-lock.json` — bumps `version` to `24.4.0`

It **never** touches `data.db`, `.env`, `node_modules`, or any user-uploaded asset.

```bash
# After deploy_v24_4.sh succeeds:
pm2 start capavate         # or: systemctl start capavate
```

---

## 2 — Verification (do this before telling the team v24.4 is live)

### 2a — Health endpoint

```bash
curl -s https://capavate.com/api/health | jq .
```

Expect:
```json
{
  "status": "ok",
  "db": "connected",
  "version": "24.4.0",
  "featureFlags": {
    "smtpConfigured": true,
    "devResetUrlEnabled": true,
    "airwallexConfigured": true,
    "airwallexMode": "test"     // <-- new in v24.4
  }
}
```

If `version` shows anything other than `24.4.0`: the bundle didn't land in `dist/` correctly. Re-run `deploy_v24_4.sh`.

If `airwallexMode` is `stub`: set `AIRWALLEX_MODE=test` in `.env` and restart. (`test` hits the Airwallex demo API; `live` hits production.)

### 2b — Bug C smoke (the one the v24.4 hardening closed)

```bash
curl -s -X POST https://capavate.com/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","name":"X","password":"smokepw123","role":"investor"}'
```

Expect HTTP 403 with body `{"ok":false,"error":"INVESTOR_SIGNUP_DISALLOWED","message":"Investors join Capavate by invitation only..."}`. If you see `200 ok` and a founder persona instead, the v24.4 build did not deploy — rerun the script.

### 2c — Smoke an investor invite end-to-end

1. Log in as a founder. Pick any company / round.
2. Invite a test investor (`+ Invite investor`). Confirm the email subject in your inbox reads `[Capavate] You're invited to <company> — <round>` (BUG 047/048).
3. Open the redeem link from the email, set a password, complete redeem.
4. Log out, log back in with the investor email + redeem password.
5. `/api/auth/me` should report `investor.state` in the `INVITED_ONLY` family — **not** an empty founder context.

### 2d — Soft-circle "confirm" (Bug E)

1. As founder on a round, add a soft-circle (intent).
2. Open the FounderConfirmDialog, sign the local SES.
3. The soft-circle row should now show status `confirmed` (not `intent`). Refresh — status persists.

### 2e — Round rename (BUG 049)

1. As founder, open any round.
2. Edit the round name → save. Status 200, new name shows.
3. Try blank — UI rejects, API returns 400 `invalid_name`.

---

## 3 — Rollback

If anything looks wrong, rollback is symmetric:

```bash
pm2 stop capavate
bash deploy_v24_3.sh /var/www/html/backend   # if you kept the prior script
pm2 start capavate
```

Or restore your nightly snapshot of `/var/www/html/backend`. Because v24.4 doesn't migrate schema, rollback is a pure code swap.

---

## 4 — Known carryovers (NOT regressions)

These existed before v24.4 and are not fixed in this wave. They are tracked in `Capavate_QA_Bug_Tracker_v3_with_v24_4_status.xlsx`:

- Vitest baseline: 287 tests fail (54 files) — pre-existing seed/SMTP/dataroom flakes carried since v23.x. Same count in v24.3 and v24.4 (no regression).
- Tsc baseline: 633 type warnings — same in v24.3 and v24.4 (no regression).
- Several admin-only screens still need the admin login flow Ozan flagged in v23.6 (logged as P3 in the tracker).

If you see anything **new** vs v24.3 prod, escalate to Ozan with the URL + payload + response. Ozan will spin a v24.5 hotfix subagent.

---

## 5 — Quick reference

| What | Where |
| --- | --- |
| Bundle zip | `CAPAVATE_v24.4_FULL_BUNDLE_for_Avi.zip` |
| Wave report | `capavate_master_report_v24_4.md` |
| QA tracker (v24.4 column) | `Capavate_QA_Bug_Tracker_v3_with_v24_4_status.xlsx` |
| This guide | `INSTALL_v24.4.md` |
| Deploy script | `deploy_v24_4.sh` |
| Health endpoint | `GET /api/health` (expect `version:"24.4.0"`, `airwallexMode:"test"`) |
| Bug C smoke | `POST /api/auth/signup` with `role:"investor"` → 403 |
| Webhook path (unchanged) | `POST /api/webhooks/payment-gateway/airwallex` |
| Airwallex mode override | `AIRWALLEX_MODE=stub\|test\|live` in `.env` |

Ping Ozan on WhatsApp when steps 1+2 are green. Thanks for the steady deploys.
