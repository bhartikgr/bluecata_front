// server/lib/applicationFeeMirror.ts
/**
 * WAVE 153 · BATCH 2 · ITEM F — ONE RULE FOR THE COLLECTIVE APPLICATION FEE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 * The Collective application fee lives in TWO tables and always has:
 *
 *   · `collective_application_fee_config` (id = 'default') — AUTHORITATIVE for
 *     founders. `getApplicationFeeMinor` (collectiveApplicationFeeResolver.ts:96)
 *     reads this row and nothing else.
 *   · `platform_fees` key `collective_application_fee` — what the ADMIN edits and
 *     what `GET /api/admin/platform-fees` lists back.
 *
 * Two routes wrote them, each with its own idea of the rule:
 *
 *   1. `PUT /api/admin/platform-fees/:key` (adminPlatformFeesRoutes.ts) wrote
 *      `platform_fees`, then mirrored into the config table inside a `try` whose
 *      `catch` logged `"(non-fatal)"` and RETURNED 200. When that mirror failed
 *      the administrator was told the price had changed and founders kept paying
 *      the old one — indefinitely, and with no signal anywhere. R115.2 #5.
 *   2. `PUT /api/admin/collective/application-fee` (adminCollectiveFeeRoutes.ts)
 *      wrote the config table and NEVER touched `platform_fees` at all, so after
 *      any use of it the admin console listed a stale figure and invalidated no
 *      cache. "One source" was not achieved in either direction.
 *
 * That pair of behaviours is the mechanism behind the $240/$300 divergence.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE GUARANTEES — AND WHAT IT HONESTLY DOES NOT
 * ══════════════════════════════════════════════════════════════════════════════
 * GUARANTEED (F-C1/F-C2/F-C3): a write through EITHER route moves BOTH rows or
 * NEITHER. One better-sqlite3 transaction wraps both writes; both rows are then
 * RE-READ and compared before commit (the read-back pattern
 * `consortiumFeesStore.setSpvDeploymentFee:141` already uses); any mismatch or
 * any thrown error rolls the whole thing back and the caller answers
 * `500 APPLICATION_FEE_MIRROR_FAILED` with a plain sentence (R77). An
 * administrator's change that cannot be mirrored DOES NOT HAPPEN — that is the
 * only outcome in which a stale price cannot be served.
 *
 * NOT GUARANTEED (F-C5, stated rather than implied): **SQLite cannot express a
 * cross-table equality CHECK**, so there is NO database-level constraint keeping
 * these two rows equal. The invariant is enforced by the transaction here and by
 * the named tests in `server/__tests__/wave153_application_fee_single_source.test.ts`.
 * Migration 0201 repairs a pre-existing divergence once and records this fact in a
 * comment; it does not — and cannot — enforce it.
 *
 * UNITS: both columns are TRUE MINOR UNITS. There is no `/ 100` on this path and
 * no `Number()`/`parseInt`/`parseFloat` on money anywhere in this file; the
 * amount arrives already validated as a non-negative safe integer by the route,
 * and is re-validated by `updateApplicationFee`.
 *
 * DEFAULTS: `DEFAULT_APPLICATION_FEE_MINOR` (30000) is NOT imported here. It is a
 * reference figure that no read path may return (R107.1 / R108.2) and this writer
 * never substitutes it for an absent value.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";
import { setFee, getFee, invalidateFeeCache, type PlatformFee } from "../platformFeesStore";
import {
  updateApplicationFee as updateApplicationFeeConfig,
  type ResolvedApplicationFee,
} from "./collectiveApplicationFeeResolver";

/** The one `platform_fees` key that mirrors the Collective application fee. */
export const APPLICATION_FEE_PLATFORM_KEY = "collective_application_fee";

/** The one error code both routes report, and the one sentence a human reads. */
export const APPLICATION_FEE_MIRROR_FAILED = "APPLICATION_FEE_MIRROR_FAILED";

/**
 * The refusal an administrator sees. A plain sentence naming what happened and
 * what to do next, never a bare code (R77). The code travels beside it for logs.
 */
export const APPLICATION_FEE_MIRROR_MESSAGE =
  "The application fee was not changed. It is held in two places — the founder-facing " +
  "configuration and the platform fee register — and both have to move together, or " +
  "founders would keep paying the old amount while this screen showed the new one. " +
  "Nothing was saved. Try again, and if it fails a second time the database needs " +
  "attention before this price can be edited.";

export class ApplicationFeeMirrorError extends Error {
  readonly code = APPLICATION_FEE_MIRROR_FAILED;
  /** What actually went wrong, for the log and the audit entry — not for the UI. */
  readonly detail: string;
  constructor(detail: string) {
    super(APPLICATION_FEE_MIRROR_MESSAGE);
    this.name = "ApplicationFeeMirrorError";
    this.detail = detail;
  }
}

/**
 * The mirror write into `collective_application_fee_config`.
 *
 * It is INJECTABLE for one reason, recorded so nobody "cleans it up": the byte
 * pin at `server/__tests__/wave131_one_pricing_console.test.ts:461-467` asserts
 * that `server/adminPlatformFeesRoutes.ts` literally contains the text
 * `updateApplicationFee(\n          amountMinor,` — it is how wave 131 froze the
 * fix for a 100× understatement on that exact call. Moving the call wholesale
 * into this module would delete the pinned bytes from that file and lower a
 * protection, which is forbidden. So that route keeps its own call site and hands
 * it to the transaction here, and both routes still obey ONE rule.
 */
export type ApplicationFeeConfigWriter = (
  amountMinor: number,
  currency: string,
  actor: string,
) => ResolvedApplicationFee;

export interface WriteApplicationFeeInput {
  /** Non-negative safe integer, TRUE minor units. Validated by the caller. */
  amountMinor: number;
  /** ISO-4217 code, already upper-cased by the caller. */
  currency: string;
  /** Human/actor string recorded in `collective_application_fee_config.updated_by`. */
  actor: string;
  /** User id recorded in `platform_fees.updated_by_user_id`; null is allowed. */
  userId: string | null;
  /** Present only so a route can keep its own pinned call site (see above). */
  configWriter?: ApplicationFeeConfigWriter;
}

export interface WriteApplicationFeeResult {
  fee: PlatformFee;
  config: ResolvedApplicationFee;
}

interface ConfigRowRaw {
  amount_minor: unknown;
  currency: unknown;
  updated_by: unknown;
}

/**
 * Write the application fee to BOTH sources atomically, verify them, or write
 * neither. Throws `ApplicationFeeMirrorError` on any failure — including a
 * successful-looking pair of writes that did not end up equal.
 *
 * The caller is responsible for cache invalidation AFTER this returns, because a
 * cache must never be invalidated for a change that was rolled back.
 */
export function writeApplicationFeeBothSources(
  input: WriteApplicationFeeInput,
): WriteApplicationFeeResult {
  const { amountMinor, currency, actor, userId } = input;
  const writeConfig = input.configWriter ?? updateApplicationFeeConfig;

  let handle: any;
  try {
    handle = rawDb();
  } catch (err) {
    /* Postgres mode or no connection: there is no transaction to be had, so the
       write is REFUSED rather than performed half-way. */
    throw new ApplicationFeeMirrorError(`raw handle unavailable: ${String(err)}`);
  }

  let out: WriteApplicationFeeResult;
  try {
    out = handle.transaction(() => {
      /* 1 — the platform fee register (what the admin console lists). */
      const fee = setFee({
        key: APPLICATION_FEE_PLATFORM_KEY,
        amountMinor,
        currency,
        updatedByUserId: userId,
      });

      /* 2 — the founder-authoritative config row, through the EXISTING writer.
             No new SQL statement: `updateApplicationFee` re-validates the amount
             and owns the UPSERT. */
      const config = writeConfig(amountMinor, currency, actor || "admin");

      /* 3 — READ BACK BOTH ROWS AND COMPARE BEFORE COMMIT. A write that
             "succeeded" and left the two rows disagreeing is precisely the state
             this item exists to make impossible, so it is checked rather than
             assumed. Both columns are true minor units; no conversion. */
      const feeRow = handle
        .prepare(
          `SELECT amount_minor, currency FROM platform_fees
            WHERE key = ? AND deleted_at IS NULL`,
        )
        .get(APPLICATION_FEE_PLATFORM_KEY) as
        | { amount_minor: unknown; currency: unknown }
        | undefined;
      const configRow = handle
        .prepare(
          `SELECT amount_minor, currency, updated_by FROM collective_application_fee_config
            WHERE id = 'default'`,
        )
        .get() as ConfigRowRaw | undefined;

      if (!feeRow) {
        throw new ApplicationFeeMirrorError("platform_fees row absent after write");
      }
      if (!configRow) {
        throw new ApplicationFeeMirrorError(
          "collective_application_fee_config row absent after write",
        );
      }
      if (feeRow.amount_minor !== amountMinor) {
        throw new ApplicationFeeMirrorError(
          `platform_fees holds ${String(feeRow.amount_minor)} after writing ${amountMinor}`,
        );
      }
      if (configRow.amount_minor !== amountMinor) {
        throw new ApplicationFeeMirrorError(
          `collective_application_fee_config holds ${String(configRow.amount_minor)} after writing ${amountMinor}`,
        );
      }
      if (feeRow.amount_minor !== configRow.amount_minor) {
        throw new ApplicationFeeMirrorError(
          `the two sources disagree after the write: platform_fees=${String(feeRow.amount_minor)}, ` +
            `config=${String(configRow.amount_minor)}`,
        );
      }
      const feeCurrency = String(feeRow.currency ?? "").toUpperCase();
      const configCurrency = String(configRow.currency ?? "").toUpperCase();
      if (feeCurrency !== configCurrency) {
        throw new ApplicationFeeMirrorError(
          `the two sources disagree on currency after the write: platform_fees=${feeCurrency}, config=${configCurrency}`,
        );
      }
      return { fee, config };
    })();
  } catch (err) {
    /* The rolled-back write must not survive in a read-through cache: `setFee`
       ran (and cached) inside the transaction that has just been undone, so the
       cache is dropped before the error leaves this function. Otherwise the very
       failure path that exists to prevent a stale price could serve one. */
    try {
      invalidateFeeCache();
    } catch {
      /* A cache that will not clear must not mask the real error below. */
    }
    if (err instanceof ApplicationFeeMirrorError) {
      log.error(
        `[applicationFeeMirror] REFUSED and rolled back: ${err.detail} — nothing was saved, ` +
          `so no stale price can be served.`,
      );
      throw err;
    }
    const wrapped = new ApplicationFeeMirrorError(String((err as Error)?.message ?? err));
    log.error(
      `[applicationFeeMirror] REFUSED and rolled back: ${wrapped.detail} — nothing was saved.`,
    );
    throw wrapped;
  }

  log.info(
    `[applicationFeeMirror] application fee set to ${amountMinor} ${currency} in BOTH sources ` +
      `by ${actor || "admin"} (platform_fees.${APPLICATION_FEE_PLATFORM_KEY} and ` +
      `collective_application_fee_config.default), verified equal before commit.`,
  );
  return out;
}

/**
 * Report whether the two sources currently agree, WITHOUT changing anything.
 * Used by the tests and available to an operator; an unreadable source is
 * reported as such and never treated as agreement.
 */
export function readApplicationFeeSources(): {
  platformFeeMinor: number | null;
  configMinor: number | null;
  agree: boolean;
  readable: boolean;
} {
  let platformFeeMinor: number | null = null;
  let configMinor: number | null = null;
  let readable = true;
  try {
    platformFeeMinor = getFee(APPLICATION_FEE_PLATFORM_KEY).amountMinor;
  } catch {
    readable = false;
  }
  try {
    const row = rawDb()
      .prepare(`SELECT amount_minor FROM collective_application_fee_config WHERE id = 'default'`)
      .get() as { amount_minor: unknown } | undefined;
    configMinor =
      row && typeof row.amount_minor === "number" && Number.isInteger(row.amount_minor)
        ? row.amount_minor
        : null;
  } catch {
    readable = false;
  }
  return {
    platformFeeMinor,
    configMinor,
    /* Two absences are NOT an agreement about a price; they are two absences. */
    agree: readable && platformFeeMinor !== null && platformFeeMinor === configMinor,
    readable,
  };
}
