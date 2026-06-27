# Postgres Deployment Guide — Capavate v23.4 (Wave H)

## Status as of v23.4

> **IMPORTANT:** As of v23.4, the **active** database dialect is still **SQLite** (`drizzle.config.ts`).
> The Postgres scaffolding built in Wave H is the *v23.5 migration target* — it is pre-built and tested
> in-process via pglite, but the production switch to Postgres is scoped to v23.5.
>
> **Only non-sacred stores** will run on Postgres in v23.5. The following stores remain SQLite-only
> through v23.4 and require explicit per-file review before Postgres migration:
>
> | Sacred file | Reason deferred |
> |---|---|
> | `server/captableCommitStore.ts` | Uses `rawDb().prepare()` (better-sqlite3 native API); hash-chain determinism requires Postgres replay harness first |
> | `server/roundsStore.ts` | Synchronous `db.transaction()` — async conversion changes tx semantics |
> | `server/lib/roundCloseCascade.ts` | Depends on synchronous transaction from `roundsStore.ts` |
> | `server/spvFundStore.ts` | BigInt arithmetic inside sync transactions |
> | `server/collectiveBillingStore.ts` | Synchronous transaction body |
>
> See `wave_h_audit/SACRED_GUARDRAIL.md` for the v23.5 migration procedure.

---

## Quick Start: SQLite-only (default, no changes needed)

Leave both env vars **unset** (or point `DATABASE_URL` at a file path):

```bash
# Dev default — persists to ./data.db
unset DATABASE_URL

# Or explicit file path
DATABASE_URL=file:./data.db npm run dev

# In-memory (test isolation)
NODE_ENV=test npm test
```

The server auto-detects SQLite when `DATABASE_URL` is absent or begins with `file:` / `sqlite:`.

---

## Deploying on Postgres (v23.5 target)

### 1. Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Full Postgres connection URL, e.g. `postgres://user:pass@host:5432/dbname` |
| `DATABASE_DIALECT` | No | Reserved for future use. Leave unset — dialect is auto-detected from `DATABASE_URL` |

```bash
export DATABASE_URL="postgres://capavate:secret@db.example.com:5432/capavate_prod"
```

### 2. Provision the database

```sql
-- Run once as a Postgres superuser
CREATE DATABASE capavate_prod;
CREATE USER capavate WITH PASSWORD 'secret';
GRANT ALL PRIVILEGES ON DATABASE capavate_prod TO capavate;
```

### 3. Run Postgres migrations

The migration SQL is pre-generated at `migrations-pg/0000_round_revanche.sql` (90 tables).

```bash
# Apply migrations to the target Postgres database
npx drizzle-kit migrate --config=drizzle.pg.config.ts
```

Or apply the SQL directly:

```bash
psql "$DATABASE_URL" -f migrations-pg/0000_round_revanche.sql
```

### 4. Start the server

```bash
DATABASE_URL="postgres://..." npm run dev
# or in production:
DATABASE_URL="postgres://..." npm start
```

The server detects the Postgres URL and connects via `postgres-js` with a connection pool of 10.

---

## Rollback procedure

### Rolling back to SQLite

If you need to revert to SQLite at any point:

```bash
unset DATABASE_URL
# or
DATABASE_URL=file:./data.db npm run dev
```

The SQLite path is always available and unaffected by the Postgres scaffolding. The active Drizzle config (`drizzle.config.ts`) still targets SQLite.

### Rolling back a Postgres migration

Drizzle Kit does not auto-generate down migrations. To roll back `0000_round_revanche.sql`:

```bash
# Drop all Capavate tables (destructive — take a backup first)
psql "$DATABASE_URL" -c "
  DO \$\$
  DECLARE r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END \$\$;
"
```

For a partial rollback, identify the specific `CREATE TABLE` statements in `migrations-pg/0000_round_revanche.sql` and issue matching `DROP TABLE IF EXISTS <tablename> CASCADE;` for only the affected tables.

---

## Connection pool settings

The Postgres connection is created in `server/db/connection.ts` with these defaults:

```typescript
postgres(url, {
  max: 10,           // max concurrent connections
  idle_timeout: 30,  // seconds before idle connection closed
  connect_timeout: 10 // seconds before connection attempt fails
})
```

Adjust via `DATABASE_URL` query params or by editing `connection.ts` for your production workload.

---

## Running the pglite integration tests

The Wave H test harness verifies basic CRUD on all 90 tables using an in-memory Postgres-compatible engine (PGlite/Wasm). These tests are **excluded from `npm test`** because PGlite boot time is ~2–5s.

```bash
npm run test:pglite
```

Expected output: ~20 tests across tenants, users, companies, and portable-helper validation.

---

## Drizzle Kit commands reference

```bash
# Generate Postgres migrations from schema.pg.ts
npx drizzle-kit generate --config=drizzle.pg.config.ts

# Apply migrations (requires DATABASE_URL)
npx drizzle-kit migrate --config=drizzle.pg.config.ts

# Inspect current Postgres schema state
npx drizzle-kit introspect --config=drizzle.pg.config.ts

# Push schema diff without migration files (dev only)
npx drizzle-kit push --config=drizzle.pg.config.ts

# Original SQLite config (still active)
npx drizzle-kit push         # targets ./data.db via drizzle.config.ts
```

---

## File map

| File | Purpose |
|---|---|
| `shared/schema.pg.ts` | Postgres mirror of `shared/schema.ts` (90 tables) |
| `drizzle.pg.config.ts` | Drizzle Kit config for Postgres migrations |
| `migrations-pg/0000_round_revanche.sql` | Initial Postgres schema (90 tables, 1421 lines) |
| `server/db/__tests__/pglite-harness.ts` | In-memory pglite test fixture factory |
| `server/db/__tests__/portable-pglite.test.ts` | CRUD + driver-detection integration tests |
| `server/db/connection.ts` | Runtime DB factory — auto-selects sqlite or postgres from `DATABASE_URL` |
| `server/db/portable.ts` | `pAll`/`pGet`/`pRun` helpers — portable across both drivers |

---

## v23.5 roadmap

1. Build Postgres replay harness for sacred files (already started — `pglite-harness.ts`)
2. Per-sacred-file: unified diff + AST diff showing only async-conversion changes
3. Replay every hash-chain test on both SQLite and pglite; SHAs must match byte-for-byte
4. Ozan reviews each annotated diff and explicitly waives the byte-identical rule
5. Update `SACRED_PRE_MIGRATION_SHAS.txt` only after waiver
6. Switch `drizzle.config.ts` dialect to `postgresql`
