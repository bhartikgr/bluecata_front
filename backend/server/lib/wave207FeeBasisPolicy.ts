/**
 * WAVE 207 · ITEM A — THE FEE-BASIS FENCE, INSTALLED FROM A NON-SACRED LAYER.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS AT ALL.
 *
 * Migration `0217_wave207_fee_basis_dimension.sql` adds `partner_fee_schedules.
 * basis_dimension` (with the CHECK that makes a capital basis unrepresentable) and the
 * two triggers that refuse a band on a flat basis. Any database built by
 * `npm run db:migrate` therefore has the fence.
 *
 * A database built WITHOUT the numbered runner does not. That is not a hypothetical:
 * `server/db/connection.ts` bootstraps the whole schema inline — it is what every
 * `:memory:` test database and every fresh dev database is built from — and it is
 * SACRED AND FROZEN (WAVE50 / WAIVER-6). Editing it fails `npm run sacred` and would
 * need a tenth waiver, which R121.1 already refused for a more urgent case. So the same
 * DDL is installed here, in a non-sacred module the fee write path calls for itself.
 * This is exactly the arrangement wave 152 used for migrations 0160 and 0200
 * (`server/lib/applyWave152PricingSchema.ts`), and the reasoning there applies verbatim.
 *
 * WHAT IT INSTALLS — AND WHAT IT REFUSES TO DO.
 *
 * Additive only. One column with a DEFAULT that preserves the existing reading of every
 * row (`'flat_per_vehicle'` = "one amount for the vehicle", which is what every row in
 * the tree already is), plus two BEFORE triggers that only ever RAISE(ABORT). It writes
 * no priced row, alters no amount, and expires nothing. A trigger that refuses a write
 * cannot change an arithmetic result, and a column no resolver reads cannot either — so
 * installing this can not move a charged figure.
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so "duplicate column name" is tolerated:
 * that is the SUCCESS case on a database that already ran 0217. "no such table" is
 * tolerated too, because a caller may reach this before some unrelated installer has
 * created the table. NOTHING ELSE is swallowed — any other error is logged loudly,
 * because an install that did not happen must be visible in the run it did not happen in.
 *
 * Memoised per DRIVER OBJECT via a WeakSet, never a module-level boolean: a test that
 * opens a second in-memory database must get a real install, not a stale "already done".
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO.
 *
 * It does not stop `pickBandRow()` being handed confirmed capital. That plumbing lives in
 * `server/lib/partnerFeeResolver.ts`, `server/lib/spvDeploymentFeeSource.ts` and
 * `server/lib/pricingDisplaySourceRepoint.ts`, which **wave 208 owns**; wave 207 must not
 * edit them. Wave 207's object is the BASIS: what may be stored, and what may be said.
 * The single change a follow-up needs is named in `build_log/wave207/W207_BUILD.md`.
 */
import { log } from "./logger";
import { rawDb } from "../db/connection";
import { ensurePlatformConfigKey } from "./platformConfigWriter";
import {
  DEFAULT_FEE_BASIS_DIMENSION,
  FEE_BASIS_DIMENSION_CONFIG_KEY,
  PERMITTED_FEE_BASIS_DIMENSIONS,
  isPermittedFeeBasisDimension,
  type FeeBasisDimension,
} from "../../shared/wave207FeeBasisDimension";

interface DbLike {
  prepare: (sql: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown };
  exec: (sql: string) => unknown;
}

/**
 * The DDL, in the order it is applied. Kept semantically identical to migration 0217;
 * the wave-207 test parses the migration file and this array and asserts the permitted
 * set in both is the same list, so the two cannot drift apart in silence.
 */
export const WAVE207_FEE_BASIS_DDL: ReadonlyArray<string> = [
  `ALTER TABLE partner_fee_schedules
     ADD COLUMN basis_dimension TEXT NOT NULL DEFAULT 'flat_per_vehicle'
       CHECK (basis_dimension IN (
         'flat_per_vehicle',
         'investor_count',
         'jurisdiction_complexity',
         'document_count',
         'duration'
       ))`,
  `DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_ins`,
  `CREATE TRIGGER w207_fee_basis_no_capital_band_ins
     BEFORE INSERT ON "partner_fee_schedules"
     FOR EACH ROW WHEN NEW."basis_dimension" = 'flat_per_vehicle'
       AND (NEW."size_band_min" IS NOT NULL OR NEW."size_band_max" IS NOT NULL)
     BEGIN SELECT RAISE(ABORT, 'WAVE207/0217 fee basis: a flat per-vehicle fee cannot carry a size band. Bands are read against investors, jurisdictions, documents or duration — never capital. Set basis_dimension to one of those first.'); END`,
  `DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_upd`,
  `CREATE TRIGGER w207_fee_basis_no_capital_band_upd
     BEFORE UPDATE ON "partner_fee_schedules"
     FOR EACH ROW WHEN NEW."basis_dimension" = 'flat_per_vehicle'
       AND (NEW."size_band_min" IS NOT NULL OR NEW."size_band_max" IS NOT NULL)
       AND (IFNULL(NEW."size_band_min", -1) <> IFNULL(OLD."size_band_min", -1)
         OR IFNULL(NEW."size_band_max", -1) <> IFNULL(OLD."size_band_max", -1))
     BEGIN SELECT RAISE(ABORT, 'WAVE207/0217 fee basis: a size band cannot be added to or changed on a flat per-vehicle fee. Bands are read against investors, jurisdictions, documents or duration — never capital.'); END`,
];

export interface Wave207InstallResult {
  applied: string[];
  alreadyPresent: string[];
  tableMissing: string[];
  failed: Array<{ sql: string; message: string }>;
  configKey: "seeded" | "already_present" | "unavailable";
}

function firstLine(sql: string): string {
  return sql.trim().split("\n")[0]!.trim();
}

/** Apply the DDL. Exported for the test, which runs it against a real driver. */
export function applyWave207FeeBasisDimension(db: DbLike): Wave207InstallResult {
  const out: Wave207InstallResult = {
    applied: [],
    alreadyPresent: [],
    tableMissing: [],
    failed: [],
    configKey: "unavailable",
  };
  for (const sql of WAVE207_FEE_BASIS_DDL) {
    try {
      db.exec(sql);
      out.applied.push(firstLine(sql));
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/duplicate column name/i.test(msg)) {
        out.alreadyPresent.push(firstLine(sql));
      } else if (/no such table/i.test(msg)) {
        out.tableMissing.push(firstLine(sql));
      } else {
        /* Loud, never silent: a fence that did not install must be visible. */
        log.warn(`[wave207FeeBasis] DDL failed: ${firstLine(sql)} :: ${msg}`);
        out.failed.push({ sql: firstLine(sql), message: msg });
      }
    }
  }
  return out;
}

const _installed = new WeakSet<object>();

/**
 * Install once per database handle. Cheap to call from a request path: after the first
 * call the WeakSet lookup is the whole cost.
 */
export function ensureWave207FeeBasisDimension(db?: DbLike | null): Wave207InstallResult | null {
  const handle = (db ?? safeRawDb()) as DbLike | null;
  if (!handle) return null;
  const keyed = handle as unknown as object;
  if (_installed.has(keyed)) return null;
  /* Marked BEFORE the attempt, deliberately — a request path must not retry failing DDL
     on every request. The failure is logged above; the caller's own error handling
     reports honestly. */
  _installed.add(keyed);
  let result: Wave207InstallResult | null = null;
  try {
    result = applyWave207FeeBasisDimension(handle);
  } catch (err) {
    log.warn(`[wave207FeeBasis] install threw: ${(err as Error).message}`);
    return null;
  }
  /* The platform-wide record of the basis in force. Written through the EXISTING
     attributed, hash-chained writer — never as raw SQL, because platform_config rows
     carry a revision hash chain (migration 0123) computed in TypeScript.
     `ensurePlatformConfigKey` is a no-op when the key already exists, so this never
     overwrites an administrator's later choice. */
  try {
    const before = readConfigDimension();
    ensurePlatformConfigKey({
      key: FEE_BASIS_DIMENSION_CONFIG_KEY,
      valueJson: JSON.stringify(DEFAULT_FEE_BASIS_DIMENSION),
      valueType: "string",
      description:
        "What a vehicle fee is based on. Permitted: " +
        PERMITTED_FEE_BASIS_DIMENSIONS.join(", ") +
        ". Capital is not a permitted basis (wave 207, R195.1).",
      createdBy: "migration:0217_wave207_fee_basis_dimension",
    });
    result.configKey = before === null ? "seeded" : "already_present";
  } catch (err) {
    /* Not fatal to the fence: the CHECK constraint is what makes a capital basis
       unrepresentable, and it is already installed above. The key is a record, not a
       gate. Logged rather than thrown so a read path is never broken by it. */
    log.warn(`[wave207FeeBasis] platform_config key unavailable: ${(err as Error).message}`);
    result.configKey = "unavailable";
  }
  return result;
}

/**
 * TEST-ONLY. Forget that any handle was installed, so a test can prove that a REQUEST
 * PATH installs the fence for itself rather than relying on a test having installed it.
 * Without this the WeakSet memo makes that impossible to demonstrate honestly — a disarm
 * that removed the route's installer call still came back GREEN, which is exactly the
 * blind spot this exists to remove. It changes no schema and writes no row.
 */
export function resetWave207InstallMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}

function safeRawDb(): DbLike | null {
  try {
    return rawDb() as DbLike;
  } catch {
    return null;
  }
}

function readConfigDimension(): string | null {
  try {
    const row = rawDb()
      .prepare(`SELECT value_json FROM platform_config WHERE key = ?`)
      .get(FEE_BASIS_DIMENSION_CONFIG_KEY) as { value_json?: string } | undefined;
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export interface ActiveFeeBasis {
  dimension: FeeBasisDimension;
  /** Where the answer came from. Never guessed, never blank. */
  source: "platform_config" | "default";
  /** True only when a stored value exists and is NOT one of the permitted dimensions. */
  storedValueRejected: boolean;
}

/**
 * The basis in force platform-wide.
 *
 * R-ASSERT: this never invents an answer. If nothing is stored, it says so by reporting
 * `source: "default"` alongside the documented default, rather than presenting a stored
 * decision that does not exist. If something unrecognised IS stored, it does not silently
 * treat it as permitted — it falls back to the default and flags the rejection, because
 * the alternative is rendering a dimension the permitted set does not contain.
 */
export function readActiveVehicleFeeBasis(): ActiveFeeBasis {
  const stored = readConfigDimension();
  if (stored === null) {
    return { dimension: DEFAULT_FEE_BASIS_DIMENSION, source: "default", storedValueRejected: false };
  }
  if (isPermittedFeeBasisDimension(stored)) {
    return { dimension: stored, source: "platform_config", storedValueRejected: false };
  }
  log.warn(
    `[wave207FeeBasis] platform_config ${FEE_BASIS_DIMENSION_CONFIG_KEY} holds an unpermitted value; ` +
      `falling back to ${DEFAULT_FEE_BASIS_DIMENSION}.`,
  );
  return { dimension: DEFAULT_FEE_BASIS_DIMENSION, source: "default", storedValueRejected: true };
}
