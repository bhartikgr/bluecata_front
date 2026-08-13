/**
 * server/lib/spvDistributionType.ts — WAVE 6 / SC-3 + SC-3b.
 *
 * THE CANONICAL DISTRIBUTION-TYPE DOMAIN, AND THE THIRD PLACE FOR ITS SCHEMA.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `spv_distribution` (SINGULAR, canonical) had no `distribution_type` column
 * while `spv_distributions` (PLURAL, legacy) has had one since
 * server/db/connection.ts:4438. That asymmetry is the reason
 * `client/src/pages/partner/PartnerSpvDetail.tsx`'s Record Distribution panel
 * was disabled outright in WAVE 2 instead of repointed: the GP's tax/accounting
 * classification had nowhere to land on the canonical ledger.
 *
 * migrations/0156_wave6_spv_distribution_type.sql adds the column, backfills it
 * from each row's own `event`, and constrains it with a trigger pair.
 *
 * THE THREE-PLACE RULE, AND WHY THE THIRD PLACE IS HERE
 * ----------------------------------------------------
 * A schema object in this project exists in three places: the canonical
 * `migrations/NNNN.sql`, the byte-identical `server/db/migrations/` mirror, and
 * an idempotent inline bootstrap so the `:memory:` test path has it. The third
 * place is normally `applyInlineMigrations()` in `server/db/connection.ts` —
 * which is SACRED and must not be edited. The bootstrap therefore lives here,
 * in the module that owns the column, exactly as
 * `server/lib/combinedCarryCapPolicy.ts` does for `spv_carry_cap_policy`
 * (WAVE 3D) and `server/lib/feeSettlementAuthorization.ts` does for its table
 * (WAVE 3E).
 *
 * `ensureSpvDistributionTypeColumn()` is genuinely idempotent: it reads
 * `PRAGMA table_info(spv_distribution)` and only ALTERs when the column is
 * absent. It never re-runs the backfill against a column that already exists,
 * so a deliberate later re-classification is never silently reverted.
 *
 * WHY THE DEFAULT IS 'other' AND NOT 'dividend'
 * ---------------------------------------------
 * The plural table defaults to 'dividend'. Copying that would make the platform
 * assert a tax characterisation it has no basis for on every unclassified row.
 * 'other' is honest, is rendered as "Unclassified" in the GP UI, and is
 * distinguishable from a GP who actually chose "Dividend".
 */
import { rawDb, getDbDriver } from "../db/connection";

/** The canonical domain. Mirrors the trigger CHECK in migration 0153 exactly. */
export const SPV_DISTRIBUTION_TYPES = [
  "return_of_capital",
  "dividend",
  "exit",
  "other",
] as const;
export type SpvDistributionType = (typeof SPV_DISTRIBUTION_TYPES)[number];

/** Honest default. NOT 'dividend' — see the header. */
export const SPV_DISTRIBUTION_TYPE_UNKNOWN: SpvDistributionType = "other";

/** GP-facing labels. `other` is named for what it is. */
export const SPV_DISTRIBUTION_TYPE_LABELS: Record<SpvDistributionType, string> = {
  return_of_capital: "Return of Capital",
  dividend: "Dividend",
  exit: "Exit Proceeds",
  other: "Unclassified",
};

/** Canonical error thrown when a caller supplies a value outside the domain. */
export const SPV_DISTRIBUTION_TYPE_INVALID = "SPV_DISTRIBUTION_TYPE_INVALID";

export function isSpvDistributionType(v: unknown): v is SpvDistributionType {
  return typeof v === "string" && (SPV_DISTRIBUTION_TYPES as readonly string[]).includes(v);
}

/**
 * The SAME derivation the migration's backfill performs, expressed once in TS
 * so a freshly recorded distribution and a backfilled legacy row agree.
 * Anything unrecognised returns 'other' — never a guessed 'dividend'.
 */
export function distributionTypeFromEvent(event: string | null | undefined): SpvDistributionType {
  const e = String(event ?? "").trim().toLowerCase();
  if (["return_of_capital", "return of capital", "roc", "capital_return"].includes(e)) return "return_of_capital";
  if (["dividend", "dividends", "income", "interest"].includes(e)) return "dividend";
  if (["exit", "exit_proceeds", "sale", "acquisition", "liquidation", "secondary"].includes(e)) return "exit";
  return "other";
}

/**
 * Resolve the value to persist. An EXPLICIT caller-supplied type always wins;
 * only when the caller supplies nothing do we derive from `event`. An explicit
 * but out-of-domain value THROWS rather than silently degrading to 'other' —
 * a typo in an API client must not quietly mislabel a distribution.
 */
export function resolveDistributionType(
  explicit: unknown,
  event: string | null | undefined,
): SpvDistributionType {
  if (explicit === undefined || explicit === null || explicit === "") {
    return distributionTypeFromEvent(event);
  }
  if (!isSpvDistributionType(explicit)) throw new Error(SPV_DISTRIBUTION_TYPE_INVALID);
  return explicit;
}

let ensured = false;

/**
 * THIRD PLACE. Idempotent; safe to call on every write. Applies exactly what
 * migration 0153 applies, for the `:memory:` / freshly-created test database
 * where the migration runner has not run.
 *
 * Returns true when the column is present afterwards, false when the store is
 * not a SQLite handle we can inspect (Postgres — the migration runner owns it).
 */
export function ensureSpvDistributionTypeColumn(): boolean {
  if (ensured) return true;
  try {
    if (getDbDriver() !== "sqlite") return false;
  } catch {
    return false;
  }
  let db: ReturnType<typeof rawDb>;
  try {
    db = rawDb();
  } catch {
    return false;
  }
  try {
    const cols = db.prepare(`PRAGMA table_info(spv_distribution)`).all() as Array<{ name: string }>;
    if (cols.length === 0) return false; // table itself not created yet; connection.ts owns that
    if (!cols.some((c) => c.name === "distribution_type")) {
      db.exec(`ALTER TABLE spv_distribution ADD COLUMN distribution_type TEXT NOT NULL DEFAULT 'other';`);
      // Same backfill as migration 0153, derived per row from its own `event`.
      db.exec(
        `UPDATE spv_distribution SET distribution_type = 'return_of_capital'
          WHERE distribution_type = 'other'
            AND lower(trim(event)) IN ('return_of_capital','return of capital','roc','capital_return');
         UPDATE spv_distribution SET distribution_type = 'dividend'
          WHERE distribution_type = 'other'
            AND lower(trim(event)) IN ('dividend','dividends','income','interest');
         UPDATE spv_distribution SET distribution_type = 'exit'
          WHERE distribution_type = 'other'
            AND lower(trim(event)) IN ('exit','exit_proceeds','sale','acquisition','liquidation','secondary');`,
      );
    }
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS trg_spv_distribution_type_ins
         BEFORE INSERT ON spv_distribution
         WHEN NEW.distribution_type NOT IN ('return_of_capital','dividend','exit','other')
         BEGIN SELECT RAISE(ABORT, 'SPV_DISTRIBUTION_TYPE_INVALID'); END;
       CREATE TRIGGER IF NOT EXISTS trg_spv_distribution_type_upd
         BEFORE UPDATE OF distribution_type ON spv_distribution
         WHEN NEW.distribution_type NOT IN ('return_of_capital','dividend','exit','other')
         BEGIN SELECT RAISE(ABORT, 'SPV_DISTRIBUTION_TYPE_INVALID'); END;
       CREATE INDEX IF NOT EXISTS idx_spv_distribution_type
         ON spv_distribution(spv_id, distribution_type);`,
    );
    ensured = true;
    return true;
  } catch {
    return false;
  }
}

/** Test-only: forget the memoised "already ensured" flag. */
export const _testSpvDistributionType = {
  reset() {
    ensured = false;
  },
};
