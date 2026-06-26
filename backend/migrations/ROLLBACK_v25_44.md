# Rollback — v25.44 additive columns

This document is the explicit, reversible rollback path for the two additive
columns introduced in v25.44 (Surface 13 M&A privacy gate + Surface 11
decline-with-reason). Both forward migrations are **additive-only**; rollback is
a single `DROP COLUMN` per migration.

| Migration | Table | Column | Forward | Rollback |
|-----------|-------|--------|---------|----------|
| `0059_v25_44_ma_privacy_json.sql` | `companies` | `ma_privacy_json` | `ADD COLUMN ma_privacy_json TEXT DEFAULT '{…}'` | `ALTER TABLE companies DROP COLUMN ma_privacy_json;` |
| `0060_v25_44_declined_reason.sql` | `collective_apps` | `declined_reason` | `ADD COLUMN declined_reason TEXT` | `ALTER TABLE collective_apps DROP COLUMN declined_reason;` |

## Rollback statements

Run these in **reverse migration order** (0060 then 0059):

```sql
-- Undo 0060 (Surface 11 decline-with-reason)
ALTER TABLE collective_apps DROP COLUMN declined_reason;

-- Undo 0059 (Surface 13 M&A privacy gate)
ALTER TABLE companies DROP COLUMN ma_privacy_json;
```

## Notes / caveats

- **SQLite `DROP COLUMN`** requires SQLite ≥ 3.35.0 (2021-03-09). All supported
  runtimes in this repo exceed that. On older engines, use the standard
  rebuild-table pattern (create a new table without the column, copy rows, swap).
- **Postgres** supports `DROP COLUMN` natively; add `IF EXISTS` for safety:
  ```sql
  ALTER TABLE collective_apps DROP COLUMN IF EXISTS declined_reason;
  ALTER TABLE companies DROP COLUMN IF EXISTS ma_privacy_json;
  ```
- The forward path is ALSO applied via inline DDL in
  `server/db/connection.ts` (applyV12AdditiveAlters) for backwards compat with
  servers that ran the inline path before these migration files existed. After
  a rollback, a subsequent boot of the server will **re-add** the column via the
  inline DDL. To fully roll back, comment out / remove the corresponding inline
  `ALTER TABLE` entries in `server/db/connection.ts` before redeploying.
- Dropping `ma_privacy_json` reverts every company to the application-level
  opt-OUT default (`MA_PRIVACY_DEFAULT`), which is the safest posture — no M&A
  data becomes MORE visible as a result of rollback.
- After rollback, `npm run db:migrate` will re-detect both migrations as
  unapplied (their rows are removed from `__drizzle_migrations_applied` only if
  you also delete those tracking rows) — if you want a clean re-apply, delete
  the matching rows from `__drizzle_migrations_applied` for `0059`/`0060`.
