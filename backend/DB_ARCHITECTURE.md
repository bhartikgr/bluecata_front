# Capavate — Database Architecture
**Sprint 28 Pass 4 | Author: Platform Engineering**

---

## 1. Recommended Database

**PostgreSQL 16+** with the **pgvector** extension (for future investor/company embedding search).

| Concern | Choice | Rationale |
|---|---|---|
| Primary RDBMS | PostgreSQL 16+ | ACID, row-level security, JSON operators, pgvector |
| Dev / CI | SQLite (via better-sqlite3) | Zero-config, same Drizzle schema |
| ORM | Drizzle ORM | Type-safe, same schema for SQLite + Postgres |
| Migrations | drizzle-kit | `drizzle-kit push` (dev) · `drizzle-kit migrate` (prod) |
| Extensions | pgvector, pg_crypto | Embeddings · crypto hash helpers |

**Driver swap**: `shared/schema.ts` defines all tables as `sqliteTable(...)`. In production, swap the Drizzle driver import from `drizzle-orm/better-sqlite3` to `drizzle-orm/postgres-js` — no schema changes required.

---

## 2. Tables — Full DDL

### 2.1 Identity & Tenancy

```sql
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,              -- e.g. "tenant_acme"
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('founder', 'investor', 'admin'))
);

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('founder', 'investor', 'admin')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email  ON users(email);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  tenant_id   TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  user_agent  TEXT,
  ip          TEXT,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
```

### 2.2 Companies

```sql
CREATE TABLE companies (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  name          TEXT NOT NULL,
  legal_name    TEXT,
  sector        TEXT,
  stage         TEXT,
  hq            TEXT,
  hq_country    TEXT,            -- ISO 3166-1 alpha-2
  website_url   TEXT,
  description   TEXT,
  logo_url      TEXT,
  founded       TEXT,
  employees     INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_tenant  ON companies(tenant_id);
CREATE INDEX idx_companies_stage   ON companies(stage);
CREATE INDEX idx_companies_country ON companies(hq_country);

CREATE TABLE company_members (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL,   -- founder | co-founder | board | exec | viewer
  title       TEXT
);
CREATE INDEX idx_company_members_company ON company_members(company_id);
CREATE INDEX idx_company_members_user    ON company_members(user_id);
```

### 2.3 Cap Table

```sql
CREATE TABLE securities (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  instrument  TEXT NOT NULL,   -- common | preferred | safe_post | safe_pre | note | warrant
  authorized  BIGINT,
  issued      BIGINT,
  currency    TEXT NOT NULL DEFAULT 'USD'
);
CREATE INDEX idx_securities_company ON securities(company_id);

CREATE TABLE rounds (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id),
  type            TEXT NOT NULL,
  state           TEXT NOT NULL,   -- open | closed | funded
  target_amount   BIGINT,          -- minor units
  raised_amount   BIGINT,          -- minor units
  currency        TEXT NOT NULL DEFAULT 'USD',
  pre_money       BIGINT,
  price_per_share NUMERIC(20,10),
  open_date       DATE,
  close_date      DATE
);
CREATE INDEX idx_rounds_company ON rounds(company_id);
CREATE INDEX idx_rounds_state   ON rounds(state);

CREATE TABLE round_invitations (
  id              TEXT PRIMARY KEY,
  round_id        TEXT NOT NULL REFERENCES rounds(id),
  company_id      TEXT NOT NULL,
  invitee_email   TEXT NOT NULL,
  invitee_name    TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,   -- SHA-256 of raw token; never store raw
  issued_at       TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  redeemed        BOOLEAN NOT NULL DEFAULT FALSE,
  redeemed_at     TIMESTAMPTZ,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_invitations_round  ON round_invitations(round_id);
CREATE INDEX idx_invitations_email  ON round_invitations(invitee_email);
CREATE INDEX idx_invitations_token  ON round_invitations(token_hash);

CREATE TABLE soft_circles (
  id          TEXT PRIMARY KEY,
  round_id    TEXT NOT NULL REFERENCES rounds(id),
  investor_id TEXT NOT NULL,
  amount      BIGINT NOT NULL,   -- minor units
  currency    TEXT NOT NULL DEFAULT 'USD',
  status      TEXT NOT NULL,     -- pending | funded | lapsed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
CREATE INDEX idx_soft_circles_round    ON soft_circles(round_id);
CREATE INDEX idx_soft_circles_investor ON soft_circles(investor_id);
```

### 2.4 Billing

```sql
CREATE TABLE subscriptions (
  company_id            TEXT PRIMARY KEY REFERENCES companies(id),
  status                TEXT NOT NULL,
  plan                  TEXT NOT NULL,
  annual_amount_minor   BIGINT NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'USD',
  renews_on             DATE NOT NULL,
  card_last4            TEXT,
  invoices_count        INTEGER NOT NULL DEFAULT 0,
  past_due_minor        BIGINT,
  trial_ends_on         DATE,
  version               INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash    TEXT NOT NULL,
  revision_hash         TEXT NOT NULL,
  updated_at            TIMESTAMPTZ NOT NULL,
  updated_by            TEXT NOT NULL
);

-- Append-only history for audit / M&A diligence
CREATE TABLE subscriptions_history (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  snapshot_json       JSONB NOT NULL,
  version             INTEGER NOT NULL,
  revision_hash       TEXT NOT NULL,
  prev_revision_hash  TEXT NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by         TEXT NOT NULL
);
CREATE INDEX idx_sub_history_company ON subscriptions_history(company_id);
CREATE INDEX idx_sub_history_version ON subscriptions_history(company_id, version);

CREATE TABLE invoices (
  id                  TEXT PRIMARY KEY,
  invoice_number      TEXT NOT NULL UNIQUE,
  company_id          TEXT NOT NULL REFERENCES companies(id),
  plan_label          TEXT NOT NULL,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  amount_minor        BIGINT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  tax_minor           BIGINT NOT NULL DEFAULT 0,
  total_minor         BIGINT NOT NULL,
  status              TEXT NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL,
  paid_at             TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash  TEXT NOT NULL,
  revision_hash       TEXT NOT NULL
);
CREATE INDEX idx_invoices_company ON invoices(company_id);
CREATE INDEX idx_invoices_status  ON invoices(status);

CREATE TABLE pricing_models (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  description               TEXT,
  status                    TEXT NOT NULL DEFAULT 'draft',
  base_price_minor          BIGINT NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'USD',
  billing_cycle             TEXT NOT NULL DEFAULT 'annual',
  features_json             JSONB,
  regional_multipliers_json JSONB,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                TEXT NOT NULL,
  updated_by                TEXT NOT NULL,
  version                   INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash        TEXT NOT NULL,
  revision_hash             TEXT NOT NULL
);
```

### 2.5 Contacts CRM

```sql
CREATE TABLE contacts (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL,   -- investor | founder | consortium_partner
  legal_name          TEXT NOT NULL,
  display_name        TEXT,
  email               TEXT,
  phone               TEXT,
  region              TEXT,
  status              TEXT NOT NULL DEFAULT 'active',
  verification        TEXT NOT NULL DEFAULT 'unverified',
  metadata_json       JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT NOT NULL,
  updated_by          TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  prev_revision_hash  TEXT NOT NULL,
  revision_hash       TEXT NOT NULL
);
CREATE INDEX idx_contacts_kind         ON contacts(kind);
CREATE INDEX idx_contacts_email        ON contacts(email);
CREATE INDEX idx_contacts_verification ON contacts(verification);

CREATE TABLE contacts_history (
  id                  TEXT PRIMARY KEY,
  contact_id          TEXT NOT NULL REFERENCES contacts(id),
  snapshot_json       JSONB NOT NULL,
  version             INTEGER NOT NULL,
  revision_hash       TEXT NOT NULL,
  prev_revision_hash  TEXT NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by         TEXT NOT NULL
);
CREATE INDEX idx_contacts_history_contact ON contacts_history(contact_id);
```

### 2.6 Regions

```sql
CREATE TABLE region_extensions (
  id                  TEXT PRIMARY KEY,
  region_code         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'research',
  title               TEXT NOT NULL,
  pricing_multiplier  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  currency_override   TEXT,
  config_json         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT NOT NULL,
  updated_by          TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  revision_hash       TEXT NOT NULL
);
CREATE INDEX idx_regions_code   ON region_extensions(region_code);
CREATE INDEX idx_regions_status ON region_extensions(status);
```

### 2.7 Notifications & Email

```sql
CREATE TABLE notification_campaigns (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  audience_type    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  content_json     JSONB,
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  recipient_count  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT NOT NULL
);
CREATE INDEX idx_notif_campaigns_status ON notification_campaigns(status);

CREATE TABLE email_campaigns (
  id               TEXT PRIMARY KEY,
  subject          TEXT NOT NULL,
  from_name        TEXT NOT NULL,
  from_email       TEXT NOT NULL,
  audience_type    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  html_body        TEXT,
  text_body        TEXT,
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  recipient_count  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT NOT NULL
);
CREATE INDEX idx_email_campaigns_status ON email_campaigns(status);

CREATE TABLE outbox_emails (
  id               TEXT PRIMARY KEY,
  to_address       TEXT NOT NULL,
  subject          TEXT NOT NULL,
  html_body        TEXT,
  text_body        TEXT,
  status           TEXT NOT NULL DEFAULT 'queued',
  attempts         INTEGER NOT NULL DEFAULT 0,
  idempotency_key  TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at          TIMESTAMPTZ,
  error_message    TEXT,
  campaign_id      TEXT REFERENCES email_campaigns(id)
);
CREATE INDEX idx_outbox_status     ON outbox_emails(status);
CREATE INDEX idx_outbox_idem       ON outbox_emails(idempotency_key);
CREATE INDEX idx_outbox_campaign   ON outbox_emails(campaign_id);
```

### 2.8 Bridge / Sync

```sql
CREATE TABLE bridge_outbox (
  id               TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,
  aggregate_kind   TEXT NOT NULL,
  envelope_json    JSONB NOT NULL,
  hmac             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued',
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_retry_at    TIMESTAMPTZ,
  enqueued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at     TIMESTAMPTZ,
  last_error       TEXT
);
CREATE INDEX idx_bridge_outbox_status  ON bridge_outbox(status);
CREATE INDEX idx_bridge_outbox_agg     ON bridge_outbox(aggregate_id);
CREATE INDEX idx_bridge_outbox_retry   ON bridge_outbox(next_retry_at) WHERE status IN ('queued','delivering');

CREATE TABLE sync_inbox (
  id               TEXT PRIMARY KEY,
  event_id         TEXT NOT NULL UNIQUE,
  event_type       TEXT NOT NULL,
  aggregate_id     TEXT NOT NULL,
  envelope_json    JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,
  handler          TEXT
);
CREATE INDEX idx_sync_inbox_status ON sync_inbox(status);
CREATE INDEX idx_sync_inbox_type   ON sync_inbox(event_type);
```

### 2.9 Formulas

```sql
CREATE TABLE formulas (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  region          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  version         TEXT NOT NULL,
  source_code     TEXT,
  citation_source TEXT,
  citation_url    TEXT,
  def_hash        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT NOT NULL,
  is_built_in     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_formulas_region   ON formulas(region);
CREATE INDEX idx_formulas_category ON formulas(category);
CREATE INDEX idx_formulas_status   ON formulas(status);
```

### 2.10 Audit Log (Append-Only Hash-Chain)

```sql
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  target_id   TEXT,
  payload_json JSONB,
  prior_hash  TEXT NOT NULL,   -- SHA-256 of previous record (or 0x000...0 for first)
  hash        TEXT NOT NULL,   -- SHA-256(prior_hash || id || action || target || ts || payload)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_tenant   ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_actor    ON audit_log(actor_id);
CREATE INDEX idx_audit_log_action   ON audit_log(action);
CREATE INDEX idx_audit_log_created  ON audit_log(created_at);

-- The audit_log table is append-only.
-- Enforce with a trigger that prevents UPDATE and DELETE:
CREATE OR REPLACE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;
```

---

## 3. Hash-Chain / Revision Storage Pattern

Every mutable entity (subscriptions, contacts, invoices, pricing_models) uses:

| Column | Purpose |
|---|---|
| `version` | Monotonic integer, increments on every mutation |
| `prev_revision_hash` | SHA-256 of the previous revision's canonical body |
| `revision_hash` | SHA-256(`prev_revision_hash` ‖ JSON.stringify(canonical body)) |

A separate `*_history` table (e.g. `subscriptions_history`) stores the full JSON snapshot at each version. The chain is verifiable offline: replay all revisions in version order and recompute hashes.

**Audit log** is a special case: the chain is the table itself (no separate history table). Every `INSERT` appends to the chain; no `UPDATE` or `DELETE` is allowed.

---

## 4. Row-Level Security (Multi-Tenancy)

PostgreSQL RLS policies enforce data isolation:

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE companies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts        ENABLE ROW LEVEL SECURITY;

-- Founders see only their own company's data
CREATE POLICY founder_rls ON companies
  USING (id = current_setting('app.active_company_id', true));

-- Investors see only companies where they have a soft-circle or cap-table position
CREATE POLICY investor_company_rls ON companies
  USING (
    id IN (
      SELECT company_id FROM soft_circles WHERE investor_id = current_setting('app.user_id', true)
      UNION
      SELECT company_id FROM round_invitations WHERE invitee_email = current_setting('app.user_email', true)
    )
  );

-- Admins bypass RLS
CREATE POLICY admin_bypass ON companies
  USING (current_setting('app.role', true) = 'admin');
```

Set `app.*` session variables in the database connection pool initialiser before each request.

---

## 5. Migration Tooling

drizzle-kit is already declared as a dependency. Commands:

```bash
# Generate migration SQL from schema changes
npx drizzle-kit generate:pg --schema=shared/schema.ts --out=drizzle/migrations

# Apply migrations to the target database
npx drizzle-kit migrate:pg --schema=shared/schema.ts

# Push to dev SQLite (no migration file)
npx drizzle-kit push:sqlite
```

**Production deploy migration plan** (in-memory → Postgres):
1. Export each in-memory store via its `seedFromCanonical*()` helper to JSON.
2. Run `npx drizzle-kit migrate:pg` against the new Postgres instance.
3. Load the JSON seed data via migration seed scripts.
4. Smoke-test with `GET /api/healthz` — `dbConnected: true`.
5. Cut over DNS / environment variables.

---

## 6. pgvector (Future)

For investor–company matching and deal-recommendation embeddings:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE companies ADD COLUMN embedding VECTOR(1536);
ALTER TABLE contacts  ADD COLUMN embedding VECTOR(1536);

CREATE INDEX idx_companies_embedding ON companies USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

Embeddings are generated asynchronously by a background worker calling the OpenAI `text-embedding-3-small` model on company description + sector fields.
