// server/lib/applyD25Slice3CollectiveEnvFallbackSchema.ts
//
// D2.5 Slice 3, Fix 3 — adds ONE additive, nullable-with-default column to the
// existing `collective_subscription_configs` table (created by Wave 4,
// server/db/connection.ts ~:2256): `use_env_fallback INTEGER NOT NULL DEFAULT 1`.
//
// WHY DEFAULT 1 (true): before this patch, `airwallexCollective.ts:157-162`
// read the Collective tier price ONLY from `process.env` — never the DB.
// Defaulting every EXISTING row to `use_env_fallback = 1` means every row
// that existed before this migration keeps reading from env exactly as it
// did previously (byte-identical behavior for any deploy that has already
// authored Collective packages). An admin opts a specific package INTO
// DB-authoritative pricing by explicitly flipping this flag to 0 — a
// deliberate, auditable action, never an implicit side effect of this
// migration.
//
// Follows the house idempotent-ALTER pattern (see
// applyWaveCFdPreMoneySharesSchema, server/db/connection.ts:1090): PRAGMA
// table_info guard first (cheaper than attempting the ALTER and swallowing
// the duplicate-column error), then ALTER, then a belt-and-suspenders catch
// that only swallows "duplicate column name" / "no such table" — any other
// error is logged and swallowed too (V33-1-B1 pattern: this must never take
// down DB boot), never rethrown here since this is a self-heal, not a
// required migration step.
import { log } from "./logger";

export function applyD25Slice3CollectiveEnvFallbackSchema(db: any): void {
  try {
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collective_subscription_configs'")
      .get();
    if (!tableExists) return; // fresh DB, table not created yet this boot — safe no-op

    const cols = db.prepare("PRAGMA table_info(collective_subscription_configs)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "use_env_fallback")) return; // already migrated

    db.exec(
      "ALTER TABLE collective_subscription_configs ADD COLUMN use_env_fallback INTEGER NOT NULL DEFAULT 1",
    );
    log.info("[d2.5-slice-3] collective_subscription_configs.use_env_fallback added (default 1 — env fallback preserved for all existing rows)");
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (!/duplicate column name|no such table/i.test(msg)) {
      log.warn("[d2.5-slice-3] applyD25Slice3CollectiveEnvFallbackSchema self-heal skipped:", msg);
    }
  }
}
