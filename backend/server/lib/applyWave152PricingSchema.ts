/**
 * WAVE 152 · ITEM G — INLINE-SQLITE PARITY FOR MIGRATIONS 0160 AND 0200.
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT IN `server/db/connection.ts`.
 *
 * `connection.ts` is where this repo has historically put "mirror the numbered
 * migration so a database bootstrapped WITHOUT `npm run db:migrate` still has
 * the right shape" — see `applyV2545_4Schema`, whose own comment describes the
 * production defect that arises when a column exists in a migration and not in
 * the bootstrap. THAT FILE IS SACRED AND FROZEN. Editing it fails
 * `npm run sacred`, and a sacred edit needs an owner waiver, which wave 152 does
 * not have. So the same job is done here, in a NON-SACRED module that the
 * relevant read/write paths call for themselves.
 *
 * WHAT IT INSTALLS, AND WHAT BREAKS WITHOUT IT.
 *
 * 1. `platform_fees.intentional_zero` (+ reason/by/at) and the same four columns
 *    on `collective_payment_schedules` — migration 0200.
 *
 *    A price of 0 is ambiguous, and the ambiguity costs money in both
 *    directions: read as a real free price, the platform charges nothing for
 *    something it meant to charge for; read as an absence, a genuinely free
 *    product refuses to transact. Before wave 152 the resolver GUESSED from
 *    `updated_by_user_id IS NULL` — "somebody touched it, so they meant it" —
 *    which any seed stamping `system:seed` defeats. The guess is replaced by a
 *    column an administrator writes on purpose. Without these columns
 *    `resolveAuthoritativeSpvDeploymentFee` reads `undefined`, treats it as "not
 *    declared" (safe), and the distinction simply cannot be recorded.
 *
 * 2. `spv.deployment_fee_minor` / `_currency` / `_payer` / `_paid_at` /
 *    `_schedule_id` — migration 0160 lines 73-77.
 *
 *    This one is not cosmetic. `connection.ts` mirrors these five columns for
 *    the `spvs` table and NEVER DID for the canonical engine table `spv`, which
 *    is the one the charge path stamps (`spvEngineDeploymentFeeHook.ts:448`
 *    passes `stampTable: "spv"`). On any database bootstrapped without the
 *    numbered runner — every fresh dev and test database — the SPV launch fee
 *    charge failed at `SELECT deployment_fee_paid_at ... FROM spv` and the hook
 *    returned CHARGE_FAILED. No money was lost, because the obligation is still
 *    recorded PENDING before the attempt, but the fee could not be collected and
 *    NO TEST COULD OBSERVE THE CHARGED AMOUNT. That is a large part of why three
 *    consecutive specs reasoned about this path from docblocks instead of from a
 *    passing test, and why one of them shipped a claim that was simply false.
 *
 * HOW IT BEHAVES.
 *
 * Additive only: nullable columns, or NOT NULL with a DEFAULT that preserves the
 * safe existing reading (`intentional_zero DEFAULT 0` = "a zero is an absence
 * until somebody says otherwise"). SQLite has no `ADD COLUMN IF NOT EXISTS`, so
 * "duplicate column name" is tolerated — that is the success case on a database
 * that already ran the migration. "no such table" is tolerated too, because a
 * caller may reach this before some unrelated installer has created a table.
 * NOTHING ELSE IS SWALLOWED: any other error is logged loudly, because an
 * install that did not happen must be visible in the run it did not happen in.
 *
 * Memoised per DRIVER OBJECT via a WeakSet, never a module-level boolean: a test
 * that opens a second in-memory database must get a real install rather than a
 * stale "already done". Memoising on a module boolean is precisely how earlier
 * waves ended up with tests passing vacuously against absent columns.
 */
import { log } from "./logger";

interface DbLike {
  prepare: (sql: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => unknown };
  exec: (sql: string) => unknown;
}

/** Every statement this installer applies, in the order it applies them. */
export const WAVE152_ADDITIVE_COLUMNS: ReadonlyArray<string> = [
  /* Migration 0200 — the zero declaration, on both zero-bearing money tables. */
  `ALTER TABLE platform_fees ADD COLUMN intentional_zero INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE platform_fees ADD COLUMN intentional_zero_reason TEXT`,
  `ALTER TABLE platform_fees ADD COLUMN intentional_zero_by TEXT`,
  `ALTER TABLE platform_fees ADD COLUMN intentional_zero_at TEXT`,
  `ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_reason TEXT`,
  `ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_by TEXT`,
  `ALTER TABLE collective_payment_schedules ADD COLUMN intentional_zero_at TEXT`,
  /* Migration 0160 — the five columns the engine charge path stamps on `spv`. */
  `ALTER TABLE spv ADD COLUMN deployment_fee_minor INTEGER`,
  `ALTER TABLE spv ADD COLUMN deployment_fee_currency TEXT`,
  `ALTER TABLE spv ADD COLUMN deployment_fee_payer TEXT`,
  `ALTER TABLE spv ADD COLUMN deployment_fee_paid_at TEXT`,
  `ALTER TABLE spv ADD COLUMN deployment_fee_schedule_id TEXT`,
];

export interface Wave152InstallResult {
  added: string[];
  alreadyPresent: string[];
  tableMissing: string[];
  failed: Array<{ sql: string; message: string }>;
  /** R121.2 — what the one-time seed correction did, and why. */
  seedCorrection: Wave152SeedCorrectionResult;
}

/* ══════════════════════════════════════════════════════════════════════════
 * R121.2 — THE ONE-TIME CORRECTIVE UPDATE OF THE KNOWN-BAD $5,000 SEED.
 *
 * `server/db/connection.ts` seeds `platform_fees` key
 * `consortium.spv_deployment_fee` with `INSERT OR IGNORE … 500000 … 'system:seed'
 * … '2026-06-28T00:00:00.000Z'` when a database is opened WITHOUT the numbered
 * migration runner. That row is the row the live charge path resolves
 * (`spvDeploymentFeeSource.ts:148`), so on such a database a partner launching an
 * SPV is charged $5,000.00 instead of the $240.00 the owner set — a 20×
 * overcharge, invisible to the person who set the price (R116.1).
 *
 * The obvious fix — change the literal in `connection.ts` — needs a TENTH sacred
 * waiver. R121.1 REFUSED it: the nine waivers are owner-ratified, `connection.ts`
 * is the database bootstrap, and the exposure excludes the live server, which is
 * migrated. So the correction happens HERE, in non-sacred code, exactly as R121.2
 * directs.
 *
 * THE CRITICAL CONSTRAINT, AND WHY IT IS THE MORE IMPORTANT HALF.
 *
 * The correction applies ONLY to a row no human has ever edited. If an admin has
 * ever set that price, it is left untouched. R116 exists so that the price the
 * owner chooses reaches the charge path; code that overwrites an admin-set price
 * is a WORSE defect than the one being fixed, and it would make the owner's
 * pricing flexibility a lie. When in doubt this function does NOTHING and says
 * why — the safe direction, because `npm run db:migrate` (migration 0200) still
 * corrects the row on every install and upgrade (R121.3).
 *
 * HOW "NEVER EDITED BY A HUMAN" IS DETERMINED — measured, not assumed.
 *
 * `platform_fees` was inspected before this predicate was written. Its real
 * columns are `key, amount_minor, currency, updated_at, updated_by_user_id,
 * billing_period, deleted_at`. **THERE IS NO `created_at` COLUMN**, so R121.2's
 * literal `created_at = updated_at` test cannot be evaluated as written. The
 * available equivalent, and what is implemented:
 *
 *   1. `updated_by_user_id` is a MACHINE author (`NULL`, `system:*`, `seed*`, or
 *      `migration_*`) — i.e. no admin author is recorded. A human write always
 *      arrives through `platformFeesStore.setFee`, which stamps the admin's user
 *      id.
 *   2. `updated_at` is still the seed's own hardcoded creation stamp
 *      (`SEED_UPDATED_AT` below, byte-copied from the frozen seed statement).
 *      `setFee` stamps `new Date().toISOString()` on every write, so an unchanged
 *      seed stamp IS `created_at = updated_at` for this table: the row has never
 *      been written since it was seeded.
 *   3. The amount is still exactly the known-bad seed amount. A row holding any
 *      other figure is somebody's decision and is not this function's business.
 *   4. The row is not soft-deleted.
 *
 * All four must hold. Every outcome — corrected or skipped — is LOGGED with the
 * before and after amounts and the reason, because money is never mutated
 * silently.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The row the charge path resolves (`spvDeploymentFeeSource.ts:83`). */
export const WAVE152_SEED_CORRECTION_KEY = "consortium.spv_deployment_fee";
/** The known-bad amount the frozen bootstrap seeds, in minor units. */
export const WAVE152_BAD_SEED_MINOR = 500_000;
/** The ruled amount (R110.1 / R116.2), identical to migration 0200's value. */
export const WAVE152_RULED_SEED_MINOR = 24_000;
/** The seed's own creation stamp, copied from the frozen seed statement. */
export const WAVE152_SEED_UPDATED_AT = "2026-06-28T00:00:00.000Z";
/** Provenance written onto a corrected row, so the repair is greppable in data. */
export const WAVE152_SEED_CORRECTION_AUTHOR = "wave152:r121_2_seed_correction";

export type Wave152SeedCorrectionOutcome =
  | "corrected"
  | "no_row"
  | "already_ruled"
  | "admin_set_left_untouched"
  | "edited_since_seed_left_untouched"
  | "soft_deleted_left_untouched"
  | "unreadable";

export interface Wave152SeedCorrectionResult {
  outcome: Wave152SeedCorrectionOutcome;
  key: string;
  beforeMinor: number | null;
  afterMinor: number | null;
  author: string | null;
  updatedAt: string | null;
  /** A plain sentence, suitable for an operator to read (R77). */
  message: string;
}

function isMachineAuthor(author: string | null): boolean {
  if (author === null || author === undefined) return true;
  const a = String(author).trim();
  if (a === "") return true;
  return /^(system[:_]|seed|migration_)/i.test(a);
}

/**
 * Correct the known-bad $5,000 seed to the ruled $240.00 — but ONLY on a row no
 * human has ever edited (R121.2). An admin-set price always survives.
 */
export function correctWave152BadSeed(db: DbLike): Wave152SeedCorrectionResult {
  const base = {
    key: WAVE152_SEED_CORRECTION_KEY,
    beforeMinor: null as number | null,
    afterMinor: null as number | null,
    author: null as string | null,
    updatedAt: null as string | null,
  };
  let row: any;
  try {
    row = db
      .prepare(
        `SELECT amount_minor, currency, updated_at, updated_by_user_id, deleted_at
           FROM platform_fees WHERE key = ?`,
      )
      .get(WAVE152_SEED_CORRECTION_KEY);
  } catch (err) {
    const message = `The SPV launch fee row could not be read, so the wave 152 seed correction did not run: ${(err as Error)?.message ?? String(err)}. Run "npm run db:migrate" — migration 0200 sets this price.`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...base, outcome: "unreadable", message };
  }
  if (!row) {
    const message =
      "There is no SPV launch fee row on this database, so there was nothing to correct. Migration 0200 creates it.";
    return { ...base, outcome: "no_row", message };
  }
  const before = Number(row.amount_minor);
  const author: string | null = row.updated_by_user_id ?? null;
  const updatedAt: string | null = row.updated_at ?? null;
  const found = { ...base, beforeMinor: before, afterMinor: before, author, updatedAt };

  const deleted = row.deleted_at !== null && row.deleted_at !== undefined && String(row.deleted_at) !== "";
  if (deleted) {
    const message = `The SPV launch fee row is retired (soft-deleted ${String(row.deleted_at)}), so it was left exactly as it is.`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...found, outcome: "soft_deleted_left_untouched", message };
  }
  if (before === WAVE152_RULED_SEED_MINOR) {
    return {
      ...found,
      outcome: "already_ruled",
      message: "The SPV launch fee already holds the ruled amount; no correction was needed.",
    };
  }
  if (before !== WAVE152_BAD_SEED_MINOR) {
    /* Not the known-bad seed. Somebody chose this figure; it is not ours. */
    const message = `The SPV launch fee holds ${before} minor units, which is not the known-bad seed amount, so it was LEFT UNTOUCHED. Only the untouched ${WAVE152_BAD_SEED_MINOR} seed is corrected (R121.2).`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...found, outcome: "admin_set_left_untouched", message };
  }
  if (!isMachineAuthor(author)) {
    /* THE CONSTRAINT THAT MATTERS: an admin set this price. Leave it alone. */
    const message = `The SPV launch fee was set by "${String(author)}" and was LEFT UNTOUCHED. An administrator's price is never overwritten (R121.2); overwriting one would make the owner's pricing flexibility a lie.`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...found, outcome: "admin_set_left_untouched", message };
  }
  if (updatedAt !== WAVE152_SEED_UPDATED_AT) {
    /* Machine author, but the row has moved since it was seeded. `platform_fees`
       has no `created_at`, so this stamp is the only evidence of "never edited"
       and it no longer matches. Refusing to act is the safe direction: migration
       0200 still corrects the row (R121.3). */
    const message = `The SPV launch fee still holds the bad seed amount but its timestamp (${String(updatedAt)}) is no longer the seed's own, so something has written it since seeding and it was LEFT UNTOUCHED. Run "npm run db:migrate" — migration 0200 corrects it.`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...found, outcome: "edited_since_seed_left_untouched", message };
  }

  const now = new Date().toISOString();
  try {
    db.prepare(
      `UPDATE platform_fees
          SET amount_minor = ?, currency = 'USD', billing_period = NULL,
              updated_at = ?, updated_by_user_id = ?
        WHERE key = ? AND amount_minor = ? AND updated_at = ?
          AND (updated_by_user_id IS NULL OR updated_by_user_id = ?)`,
    ).run(
      WAVE152_RULED_SEED_MINOR,
      now,
      WAVE152_SEED_CORRECTION_AUTHOR,
      WAVE152_SEED_CORRECTION_KEY,
      WAVE152_BAD_SEED_MINOR,
      WAVE152_SEED_UPDATED_AT,
      author,
    );
  } catch (err) {
    const message = `The wave 152 seed correction could not be written: ${(err as Error)?.message ?? String(err)}. The price is unchanged. Run "npm run db:migrate".`;
    log.warn(`[wave152SeedCorrection] ${message}`);
    return { ...found, outcome: "unreadable", message };
  }
  const message = `Corrected the untouched SPV launch fee seed on key "${WAVE152_SEED_CORRECTION_KEY}" from ${WAVE152_BAD_SEED_MINOR} to ${WAVE152_RULED_SEED_MINOR} minor units (R110.1 / R116.2 / R121.2). Previous author "${String(author)}", previous timestamp "${String(updatedAt)}". No administrator had ever set this price.`;
  log.warn(`[wave152SeedCorrection] ${message}`);
  return {
    ...found,
    afterMinor: WAVE152_RULED_SEED_MINOR,
    outcome: "corrected",
    message,
  };
}

/** Apply the additive columns once against `db`, reporting exactly what happened. */
export function applyWave152PricingSchema(db: DbLike): Wave152InstallResult {
  const out: Wave152InstallResult = {
    added: [],
    alreadyPresent: [],
    tableMissing: [],
    failed: [],
    /* Replaced below. Declared here so the shape is never partially built. */
    seedCorrection: {
      outcome: "no_row",
      key: WAVE152_SEED_CORRECTION_KEY,
      beforeMinor: null,
      afterMinor: null,
      author: null,
      updatedAt: null,
      message: "The seed correction has not run yet.",
    },
  };
  for (const sql of WAVE152_ADDITIVE_COLUMNS) {
    try {
      db.exec(sql);
      out.added.push(sql);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (/duplicate column name/i.test(msg)) out.alreadyPresent.push(sql);
      else if (/no such table/i.test(msg)) out.tableMissing.push(sql);
      else {
        out.failed.push({ sql, message: msg });
        log.warn(`[wave152Schema] ${sql} failed: ${msg}`);
      }
    }
  }
  /* R121.2 — the one-time corrective update runs AFTER the columns, because the
     `platform_fees` read it performs must not be the thing that fails on a
     database whose columns are still being installed. */
  out.seedCorrection = correctWave152BadSeed(db);
  return out;
}

const _installed = new WeakSet<object>();

/**
 * Install once per database handle. Safe and cheap to call from a read path: the
 * WeakSet lookup is the only cost after the first call.
 */
export function ensureWave152PricingSchema(db: DbLike | null | undefined): void {
  if (!db) return;
  const keyed = db as unknown as object;
  if (_installed.has(keyed)) return;
  /* Marked BEFORE the attempt, deliberately. If the install throws for an
     unforeseen reason, a read path that calls this on every request must not
     retry the same failing DDL on every request; the failure is logged above and
     the caller's own error handling reports the missing column honestly. */
  _installed.add(keyed);
  try {
    applyWave152PricingSchema(db);
  } catch (err) {
    log.warn(`[wave152Schema] install threw: ${(err as Error).message}`);
  }
}

/** Test-only: forget the memo so a suite can force a re-install and assert on it. */
export function __resetWave152SchemaMemoForTests(db: DbLike): void {
  _installed.delete(db as unknown as object);
}
