/**
 * server/lib/spvEngineDeploymentFeeHook.ts
 *
 * WAVE 8 — ORP-029 / DEF-029. The SPV deployment fee, charged for SPVs created
 * by the CANONICAL engine.
 *
 * WHAT WAS WRONG (PLATFORM_ORPHAN_AUDIT #3 / §E1, CRITICAL). The fee itself was
 * built in v25.33 (`server/lib/spvDeploymentFee.ts:58`) and is correct. Its one
 * production call site (`server/spvFundStore.ts:1204`) is guarded by
 * `next.status === "active" && spv.status !== "active"`, but the canonical
 * status enum (`shared/spvEngine.ts:70`) is
 * `draft | open | closed | deployed | distributing | wound_down` — there is no
 * `"active"`. The only route to `"active"` is the legacy adapter mapping, whose
 * client callers are GET-only. So the fee has never been charged. This is not a
 * missing feature; it is a trigger wired to a status that does not exist.
 *
 * THE SINK, NAMED. The engine's deploy transition is
 * `spvEngineStore.markDeployed()` (`server/spvEngineStore.ts:1445`) — the
 * function that sets `status = "deployed"`, writes `deployedAt`, persists the
 * `spv_deployment` row and emits `spv.deployed` (:1455). It has exactly one
 * caller, `POST /api/partner/me/spv/:spvId/deployments/:depId/commit`
 * (`server/spvEngineRoutes.ts:486`), and that route is the only way an engine
 * SPV can reach `deployed`. Putting the charge in `markDeployed` therefore puts
 * it on the single path the data actually flows down; putting it in the route
 * would leave a second door open if a second caller is ever added.
 *
 * THE DB WRITES this produces (both real, both verifiable after a deploy):
 *   1. `partner_billing_entries` — one row, `entry_kind = 'spv_deployment_fee'`,
 *      `spv_fund_id = <spv id>`. This is the money record.
 *   2. `spv.deployment_fee_*` — the stamp on the engine's SPV row (columns
 *      added by migration 0152; the legacy `spvs` table already had them).
 *
 * NO HARD CODING. Not one fee amount, band, currency or tier lives here. The
 * amount is resolved by `resolvePartnerFee(...)` from
 * `partner_fee_schedules` / bands in the DB, fail-closed: if no band is
 * configured, NOTHING is charged and the reason is returned so an admin can
 * configure the band and re-trigger. The committed amount that selects the band
 * is SUMmed from live `spv_subscription` rows, falling back to the SPV's own
 * `target_raise_minor`.
 *
 * FAILURE POLICY. A fee-configuration gap must never roll back a completed
 * cap-table deployment — the ledger line has already been written by
 * `commitFunded` before `markDeployed` runs. Resolution failures degrade to
 * `{ charged: false, reason }` (the v25.33 contract) and unexpected errors are
 * logged and swallowed here for the same reason. Nothing is lost silently: the
 * un-charged SPV is exactly the one with a NULL `deployment_fee_minor`, which
 * is a queryable, reportable state.
 */
import { rawDb } from "../db/connection";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";
import { chargeSpvDeploymentFee } from "./spvDeploymentFee";
import { PartnerTierResolutionError } from "./partnerTierResolver";
import { log } from "./logger";

export interface EngineDeploymentFeeResult {
  charged: boolean;
  reason?: string;
  amountMinor?: number;
  currency?: string;
  /* WAVE 160 · ITEM 0 · R134.1 — WHICH BASIS SELECTED THE BAND.
   * A disputed invoice has to be reconstructable: the band is chosen by an
   * amount, and until now nothing recorded which amount, nor where it came
   * from. Machine identifiers, not user-facing copy (R77 permits them here). */
  feeBasis?: SpvDeploymentFeeBasis;
  /** The `sizeMinor` actually handed to the banded resolver. */
  basisSizeMinor?: number;
}

/**
 * WAVE 160 · ITEM 0 — the three things the deployment-fee band can be priced on.
 *
 *  • `confirmed_capital`      — SUM of `spv_subscription.commitment_minor`
 *                               WHERE status = 'committed'. The only population
 *                               that is actual capital (R131.1, R135.1).
 *  • `target_raise_fallback`  — `spv.target_raise_minor`, used ONLY when there is
 *                               no confirmed capital at all. Deliberately kept
 *                               (V2 §13.2): removing it would change the fee for
 *                               a legitimately zero-subscription vehicle.
 *  • `unavailable`            — neither answered; `resolvePartnerFee` then fails
 *                               closed on the band lookup rather than this
 *                               module inventing a number.
 */
export type SpvDeploymentFeeBasis = "confirmed_capital" | "target_raise_fallback" | "unavailable";

/** The amount that selects the band, together with where it came from. */
export interface EngineFeeBandBasis {
  sizeMinor: number;
  basis: SpvDeploymentFeeBasis;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 3F / ITEM 4 — A FAILED DEPLOYMENT FEE IS NOW DURABLE AND RETRYABLE
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * WHAT WAS WRONG (W10 REVIEW A, MAJOR). The deployment persists BEFORE this
 * hook runs; this hook returned `{ charged: false }` on every failure; and the
 * only commit route answers `409 ALREADY_COMMITTED` on a replay
 * (server/spvEngineRoutes.ts:506). No retry route existed anywhere in the tree,
 * so a transient driver failure, a missing fee band or (now) an unresolvable
 * partner tier left a DEPLOYED SPV PERMANENTLY UNBILLED. The hook's own log
 * line told an admin to "re-trigger" an operation that did not exist.
 *
 * The old defence — "the un-charged SPV is the one with a NULL
 * deployment_fee_minor, which is queryable" — is an ABSENCE. An absence has no
 * reason, no attempt count, no partner and no timestamp, so nothing can act on
 * it. It is not a billing record.
 *
 * WHAT IS HERE NOW. `spv_deployment_fee_billing` (migration 0162) holds ONE
 * durable row per deployed engine SPV:
 *   • written as `pending` BEFORE the charge is attempted, so the obligation
 *     survives a crash mid-charge;
 *   • moved to `charged` only when the charge (or an upstream idempotent
 *     short-circuit) actually settled it;
 *   • otherwise left `pending` with `attempts`, `last_reason` and
 *     `last_attempt_at` recorded, which IS the retry queue.
 * `retryEngineSpvDeploymentFee(spvId)` re-runs collection from that row and is
 * IDEMPOTENT: a `charged` row is a no-op, and even a stale row cannot
 * double-charge because `chargeSpvDeploymentFee` still short-circuits on an
 * existing `partner_billing_entries` row or a non-NULL `deployment_fee_minor`.
 * It is exposed at POST /api/admin/consortium-spv/:spvId/deployment-fee/retry
 * and `listPendingEngineSpvDeploymentFees()` drives an admin view or worker.
 *
 * FAILURE POLICY, UNCHANGED WHERE IT WAS RIGHT: a fee problem still never rolls
 * back a completed cap-table deployment. What changed is that it is no longer
 * SILENT — the money owed is now a row, not the absence of one. */

export const DEPLOYMENT_FEE_BILLING_TABLE = "spv_deployment_fee_billing";

/* Canonical DDL, verbatim from migration 0162 (indexes included). Created on
 * first touch for the `:memory:` test database, whose schema comes from
 * connection.ts's inline bootstrap (SACRED, unedited) and predates this table.
 * Creates an EMPTY table and seeds nothing. */
const DEPLOYMENT_FEE_BILLING_SQL = `
CREATE TABLE IF NOT EXISTS spv_deployment_fee_billing (
  spv_id           TEXT PRIMARY KEY NOT NULL,
  partner_id       TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('pending','charged')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_reason      TEXT,
  last_attempt_at  TEXT,
  amount_minor     INTEGER,
  currency         TEXT,
  charged_at       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- WAVE 160 · ITEM 0 · R134.1 — which basis chose the band, and the amount it
  -- was chosen on. Mirrored for existing databases by migration 0207 and by the
  -- self-heal ALTERs in ensureBillingTable().
  fee_basis        TEXT,
  basis_size_minor INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sdfb_state_updated ON spv_deployment_fee_billing (state, updated_at);
CREATE INDEX IF NOT EXISTS idx_sdfb_partner ON spv_deployment_fee_billing (partner_id);
`;

export interface DeploymentFeeBillingRow {
  spvId: string;
  partnerId: string;
  state: "pending" | "charged";
  attempts: number;
  lastReason: string | null;
  lastAttemptAt: string | null;
  amountMinor: number | null;
  currency: string | null;
  chargedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /* WAVE 160 · ITEM 0 — `confirmed_capital` | `target_raise_fallback` |
   * `unavailable`, or null for a row written before this wave. */
  feeBasis: SpvDeploymentFeeBasis | null;
  basisSizeMinor: number | null;
}

let _billingTableReady = false;

/** Test hook — re-verify the table after a suite swaps the database handle. */
export function __resetDeploymentFeeBillingLatchForTest(): void {
  _billingTableReady = false;
}

/* Exported for WAVE 50 ITEM 2's self-heal installer
 * (server/lib/applyWave50MoneyDefectSchema.ts), whose §2 backfill reads this
 * table in a NOT EXISTS and must not run before it exists. `raw` stays optional
 * so the installer need not thread a handle it does not otherwise use; every
 * existing internal caller passes one and is unaffected. */
export function ensureBillingTable(raw?: any): boolean {
  if (_billingTableReady) return true;
  if (!raw) {
    try {
      raw = rawDb();
    } catch (err) {
      log.warn(`[spv-engine-fee] billing table bootstrap: raw handle unavailable: ${String(err)}`);
      return false;
    }
  }
  try {
    const present = raw
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(DEPLOYMENT_FEE_BILLING_TABLE) as { name?: string } | undefined;
    if (!present) raw.exec(DEPLOYMENT_FEE_BILLING_SQL);
    /* WAVE 160 · ITEM 0 — self-heal the two basis columns on a database that was
     * created before this wave. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the
     * presence check is explicit; the columns are nullable, so no existing row is
     * rewritten and no historical charge is re-interpreted. */
    const cols = new Set(
      (raw.prepare(`PRAGMA table_info(${DEPLOYMENT_FEE_BILLING_TABLE})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!cols.has("fee_basis")) {
      raw.exec(`ALTER TABLE ${DEPLOYMENT_FEE_BILLING_TABLE} ADD COLUMN fee_basis TEXT`);
    }
    if (!cols.has("basis_size_minor")) {
      raw.exec(`ALTER TABLE ${DEPLOYMENT_FEE_BILLING_TABLE} ADD COLUMN basis_size_minor INTEGER`);
    }
    _billingTableReady = true;
    return true;
  } catch (err) {
    // Do NOT latch on failure. A billing record we cannot write is itself
    // reported (reason BILLING_RECORD_UNAVAILABLE) rather than assumed absent.
    log.warn(`[spv-engine-fee] billing table bootstrap failed: ${String(err)}`);
    return false;
  }
}

function rowToBilling(r: any): DeploymentFeeBillingRow {
  return {
    spvId: r.spv_id, partnerId: r.partner_id, state: r.state,
    attempts: Number(r.attempts ?? 0), lastReason: r.last_reason ?? null,
    lastAttemptAt: r.last_attempt_at ?? null,
    amountMinor: r.amount_minor === null || r.amount_minor === undefined ? null : Number(r.amount_minor),
    currency: r.currency ?? null, chargedAt: r.charged_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    feeBasis: (r.fee_basis ?? null) as SpvDeploymentFeeBasis | null,
    basisSizeMinor: integerMinorOrNull(r.basis_size_minor),
  };
}

/** Record that this SPV OWES a deployment fee, before any attempt is made.
 *  Never downgrades a `charged` row back to `pending`. */
function openBillingRecord(raw: any, spvId: string, partnerId: string): void {
  if (!ensureBillingTable(raw)) return;
  const now = new Date().toISOString();
  try {
    raw.prepare(
      `INSERT INTO ${DEPLOYMENT_FEE_BILLING_TABLE}
         (spv_id, partner_id, state, attempts, last_reason, last_attempt_at,
          amount_minor, currency, charged_at, created_at, updated_at)
       VALUES (?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)
       ON CONFLICT(spv_id) DO UPDATE SET
         partner_id = excluded.partner_id, updated_at = excluded.updated_at`,
    ).run(spvId, partnerId, now, now);
  } catch (err) {
    log.warn(`[spv-engine-fee] could not open billing record for ${spvId}: ${String(err)}`);
  }
}

/** Close the billing record with the outcome of one collection attempt. */
function recordBillingOutcome(raw: any, spvId: string, out: EngineDeploymentFeeResult): void {
  if (!ensureBillingTable(raw)) return;
  const now = new Date().toISOString();
  const settled = out.charged || out.reason === "already_charged";
  try {
    raw.prepare(
      `UPDATE ${DEPLOYMENT_FEE_BILLING_TABLE}
          SET state = ?, attempts = attempts + 1, last_reason = ?, last_attempt_at = ?,
              amount_minor = COALESCE(?, amount_minor), currency = COALESCE(?, currency),
              charged_at = CASE WHEN ? = 'charged' THEN COALESCE(charged_at, ?) ELSE charged_at END,
              fee_basis = COALESCE(?, fee_basis),
              basis_size_minor = COALESCE(?, basis_size_minor),
              updated_at = ?
        WHERE spv_id = ?`,
    ).run(
      settled ? "charged" : "pending",
      out.reason ?? null,
      now,
      out.amountMinor ?? null,
      out.currency ?? null,
      settled ? "charged" : "pending",
      now,
      out.feeBasis ?? null,
      out.basisSizeMinor ?? null,
      now,
      spvId,
    );
  } catch (err) {
    log.warn(`[spv-engine-fee] could not record billing outcome for ${spvId}: ${String(err)}`);
  }
}

/** The billing record for one SPV, or null when none exists. */
export function getEngineSpvDeploymentFeeBilling(spvId: string): DeploymentFeeBillingRow | null {
  let raw: any;
  try { raw = rawDb(); } catch { return null; }
  if (!ensureBillingTable(raw)) return null;
  try {
    const r = raw.prepare(`SELECT * FROM ${DEPLOYMENT_FEE_BILLING_TABLE} WHERE spv_id = ?`).get(spvId);
    return r ? rowToBilling(r) : null;
  } catch (err) {
    log.warn(`[spv-engine-fee] billing read failed for ${spvId}: ${String(err)}`);
    return null;
  }
}

/** THE RETRY QUEUE: every deployed engine SPV that still owes a deployment fee.
 *  Drives the admin view and any background worker. */
export function listPendingEngineSpvDeploymentFees(limit = 500): DeploymentFeeBillingRow[] {
  let raw: any;
  try { raw = rawDb(); } catch { return []; }
  if (!ensureBillingTable(raw)) return [];
  try {
    return (raw
      .prepare(`SELECT * FROM ${DEPLOYMENT_FEE_BILLING_TABLE} WHERE state = 'pending' ORDER BY updated_at ASC LIMIT ?`)
      .all(Math.max(1, Math.trunc(limit))) as any[]).map(rowToBilling);
  } catch (err) {
    log.warn(`[spv-engine-fee] pending billing list failed: ${String(err)}`);
    return [];
  }
}

/**
 * IDEMPOTENT RETRY of a deployment fee that was recorded as owed but not
 * collected. Safe to call any number of times, from an admin action or a
 * worker, and it does NOT replay the blocked deployment commit.
 *
 * Idempotency has three independent layers:
 *   1. a `charged` billing row returns immediately;
 *   2. `chargeSpvDeploymentFee` short-circuits on an existing
 *      `partner_billing_entries` row for this SPV;
 *   3. …and on a non-NULL `spv.deployment_fee_minor` stamp.
 * Only the first of those is new; layers 2 and 3 are the v25.33 contract and
 * are unchanged.
 */
export function retryEngineSpvDeploymentFee(spvId: string): EngineDeploymentFeeResult {
  if (!spvId) return { charged: false, reason: "MISSING_IDENTIFIERS" };
  const existing = getEngineSpvDeploymentFeeBilling(spvId);
  if (existing?.state === "charged") return { charged: false, reason: "already_charged" };
  const partnerId = existing?.partnerId ?? resolveSponsorPartnerId(spvId);
  if (!partnerId) return { charged: false, reason: "NO_BILLING_RECORD" };
  return chargeEngineSpvDeploymentFee(spvId, partnerId);
}

/** Sponsor partner for an engine SPV that has no billing record yet (deployed
 *  before this table existed). Read from the SPV row itself — never guessed. */
function resolveSponsorPartnerId(spvId: string): string | null {
  try {
    const row = rawDb().prepare(`SELECT sponsor_partner_id FROM spv WHERE id = ?`).get(spvId) as
      { sponsor_partner_id?: string } | undefined;
    return row?.sponsor_partner_id ?? null;
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 160 · ITEM 0 · R134.1 — A NON-BINDING INDICATION USED TO BILL REAL MONEY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. This function summed `commitment_minor` WHERE
 * `status <> 'withdrawn'`, i.e. EVERY STAGE — `review`, `soft_circled`,
 * `founder_confirmed`, `wire_funded` and `committed` alike. Its result flows
 * `:440` -> `chargeSpvDeploymentFee` -> `spvDeploymentFee.ts:141-142` ->
 * `spvDeploymentFeeSource.resolveSpvDeploymentFee(..., { sizeMinor })`, which is
 * a SIZE-BANDED fee (`partnerFeeResolver.pickBandRow`). So one LP soft-circling
 * $2,000,000 with no signed documents and no money in the bank pushed the SPV
 * into a higher band and the partner was INVOICED REAL MONEY on interest that
 * may never convert. R133.2 confirms this is the live charge path.
 *
 * THE RULING (R134.1). The basis counts CONFIRMED CAPITAL ONLY. A fee is money;
 * money follows capital, never interest.
 *
 * `wire_funded` IS DELIBERATELY EXCLUDED (R135.1). Money in the bank without
 * signed subscription documents is not a commitment: R131.1 requires BOTH signed
 * docs AND funds received before a GP confirms, and cash alone is one of the two.
 * Under-counting delays a fee; over-counting bills a partner for money that is
 * not contractually theirs to receive.
 *
 * THE NAME CHANGED TOO, and that is not cosmetic. `resolveEngineCommittedMinor`
 * is the reason two readers and one independent review believed this already
 * meant committed capital, and read past the `<> 'withdrawn'` on line 311.
 *
 * The literal `'committed'` is NOT re-typed here: it comes from
 * `SPV_COMMITTED_SUBSCRIPTION_STATUS` (`shared/spvCommittedCapital.ts:44`),
 * which an existing test pins byte-equal to `spvEngineStore`'s
 * `COMMITTED_SUBSCRIPTION_STATUS` (`:3861`). The shared constant rather than the
 * store constant, because `spvEngineStore` imports THIS module — importing back
 * would create a cycle.
 *
 * No `Number()`, `parseInt` or `parseFloat` is applied to money below. Both
 * columns are SQLite INTEGERs and better-sqlite3 hands them back as numbers; the
 * reads are type-checked instead of coerced.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** An integer minor-unit amount read from SQLite, or null. Never coerces. */
function integerMinorOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/**
 * The CONFIRMED CAPITAL that selects the fee band, read live from the DB.
 * Preference order:
 *   1. SUM of `spv_subscription.commitment_minor` WHERE status = 'committed' —
 *      the only population that is actual capital (R134.1, R135.1).
 *   2. `spv.target_raise_minor` — the sponsor's stated target, used only when
 *      there is no confirmed capital at all (a directly-funded SPV). RETAINED on
 *      purpose per V2 §13.2 / R135.9.
 * Reports `unavailable` with `sizeMinor: 0` when neither answers.
 */
export function resolveEngineConfirmedCapitalMinor(rawTx: any, spvId: string): EngineFeeBandBasis {
  try {
    const sub = rawTx
      .prepare(
        `SELECT COALESCE(SUM(commitment_minor), 0) AS total
           FROM spv_subscription
          WHERE spv_id = ? AND status = ?`,
      )
      .get(spvId, SPV_COMMITTED_SUBSCRIPTION_STATUS) as { total: number | null } | undefined;
    const total = integerMinorOrNull(sub?.total);
    if (total !== null && total > 0) return { sizeMinor: total, basis: "confirmed_capital" };
  } catch (err) {
    log.warn(`[spv-engine-fee] confirmed-capital sum failed for ${spvId}: ${String(err)}`);
  }
  try {
    const row = rawTx
      .prepare(`SELECT target_raise_minor FROM spv WHERE id = ?`)
      .get(spvId) as { target_raise_minor: number | null } | undefined;
    const target = integerMinorOrNull(row?.target_raise_minor);
    if (target !== null && target > 0) return { sizeMinor: target, basis: "target_raise_fallback" };
  } catch (err) {
    log.warn(`[spv-engine-fee] target read failed for ${spvId}: ${String(err)}`);
  }
  return { sizeMinor: 0, basis: "unavailable" };
}

/**
 * Charge the one-time deployment fee for an ENGINE SPV that has just reached
 * `deployed`. Idempotent: `chargeSpvDeploymentFee` short-circuits on either an
 * existing `partner_billing_entries` row for this SPV or a non-null
 * `spv.deployment_fee_minor`, so a replayed commit cannot double-charge.
 *
 * @param spvId     `spv.id` (the ENGINE table, not the legacy `spvs`).
 * @param partnerId the sponsoring partner (`spv.sponsor_partner_id`).
 */
export const DEPLOYMENT_FEE_EXEMPTION_TABLE = "spv_deployment_fee_exemption";

export interface DeploymentFeeExemptionRow {
  spvId: string;
  reason: string;
  migratedFrom: string;
  statusAtRecord: string;
  note: string;
  recordedAt: string;
  recordedBy: string;
}

/**
 * WAVE 50 · ITEM 2 — read the exemption row for `spvId`, or null.
 *
 * A MISSING TABLE RETURNS NULL, i.e. "not exempt", which is the FAIL-CLOSED
 * direction for money: an install that never ran 0187 keeps charging exactly as
 * Wave 46 did rather than silently exempting every vehicle in the system. The
 * missing table is logged once by the installer, not swallowed here.
 */
export function lookupDeploymentFeeExemption(raw: any, spvId: string): DeploymentFeeExemptionRow | null {
  try {
    const r = raw
      .prepare(
        `SELECT spv_id, reason, migrated_from, status_at_record, note, recorded_at, recorded_by
           FROM ${DEPLOYMENT_FEE_EXEMPTION_TABLE} WHERE spv_id = ?`,
      )
      .get(spvId) as any;
    if (!r) return null;
    return {
      spvId: r.spv_id,
      reason: r.reason,
      migratedFrom: r.migrated_from,
      statusAtRecord: r.status_at_record,
      note: r.note,
      recordedAt: r.recorded_at,
      recordedBy: r.recorded_by,
    };
  } catch {
    return null;
  }
}

export function chargeEngineSpvDeploymentFee(spvId: string, partnerId: string): EngineDeploymentFeeResult {
  if (!spvId || !partnerId) return { charged: false, reason: "MISSING_IDENTIFIERS" };
  let raw: any;
  try {
    raw = rawDb();
  } catch (err) {
    // Postgres mode: rawDb() throws unconditionally (connection.ts:167-173).
    // The legacy caller has the same constraint; this is not a new limitation
    // introduced by ORP-029, and it is surfaced rather than hidden.
    log.warn(`[spv-engine-fee] raw handle unavailable (non-sqlite driver?): ${String(err)}`);
    return { charged: false, reason: "RAW_DB_UNAVAILABLE" };
  }
  /* ══════════════════════════════════════════════════════════════════════════
   * WAVE 50 · ITEM 2 — A VEHICLE DEPLOYED BEFORE THE LATCH EXISTED IS NOT OWED
   * ══════════════════════════════════════════════════════════════════════════
   *
   * Wave 46 wired this charge to the not-live -> live edge and argued a re-push
   * after a wind-down "is stopped by the idempotency latch rather than by the
   * trigger condition". That is true only for a vehicle the latch has SEEN. For
   * an SPV migrated out of `partner_spvs`/`partner_funds` all three latch layers
   * are ABSENCES — no `spv_deployment_fee_billing` row (that table is migration
   * 0162, which postdates these rows), no `partner_billing_entries` row of kind
   * `spv_deployment_fee`, and `spv.deployment_fee_minor IS NULL` — so a legacy
   * `wound_down` vehicle relaunched to `open` was charged a FALSE $240 for a
   * deployment that already happened off-platform.
   *
   * The exemption is checked HERE, before `openBillingRecord`, so no `pending`
   * obligation is ever written for a vehicle that is not owed one: a pending row
   * is the retry queue, and enqueuing a charge nobody owes would just move the
   * false charge to whoever works that queue.
   *
   * It is a ROW (`spv_deployment_fee_exemption`, migration 0187) and not a
   * predicate on `spv.migrated_from`, because `migrated_from IS NOT NULL` alone
   * must NOT exempt: a legacy row that arrived in `draft` and is pushed live for
   * the first time on this platform IS a genuine first deployment and must be
   * charged. The distinguishing fact — "it was already live when it entered the
   * canonical table" — lives in a column that is mutated in place, so it is
   * recorded rather than re-derived.
   *
   * It is deliberately NOT expressed as a `charged` row in the billing table,
   * whose CHECK admits only `pending|charged`: `charged` would claim money was
   * collected when none was. */
  const exemption = lookupDeploymentFeeExemption(raw, spvId);
  if (exemption) {
    log.info(
      `[spv-engine-fee] ${spvId} is EXEMPT (${exemption.reason}): migrated from ` +
        `${exemption.migratedFrom} already at status '${exemption.statusAtRecord}', i.e. deployed ` +
        `before the ${DEPLOYMENT_FEE_BILLING_TABLE} latch existed. No charge, and no pending obligation.`,
    );
    return { charged: false, reason: "pre_latch_deployment_exempt" };
  }

  /* WAVE 3F / ITEM 4 — the obligation is DURABLE BEFORE the attempt. If the
   * process dies mid-charge, the SPV is still recorded as owing the fee. */
  openBillingRecord(raw, spvId, partnerId);
  let out: EngineDeploymentFeeResult;
  /* WAVE 160 · ITEM 0 — resolved OUTSIDE the try so the basis is recorded on the
   * billing row even when the charge itself fails and is queued as pending. An
   * admin working the retry queue needs to see what the band would have priced
   * on. */
  const band = resolveEngineConfirmedCapitalMinor(raw, spvId);
  try {
    out = chargeSpvDeploymentFee({
      rawTx: raw,
      spvId,
      partnerId,
      committedMinor: band.sizeMinor,
      // THE WHOLE POINT: stamp the ENGINE's table. Defaulting to "spvs" here
      // would bill the partner and record it nowhere on the SPV.
      stampTable: "spv",
    });
  } catch (err) {
    /* WAVE 3F / ITEM 2 — an unresolvable or inconsistent partner tier is a
     * BLOCK, not a mis-bill. It is reported with its own code so the pending
     * billing row says exactly what an admin has to fix. */
    if (err instanceof PartnerTierResolutionError) {
      log.warn(`[spv-engine-fee] tier unresolved for ${spvId} (partner ${partnerId}): ${err.code} — billing BLOCKED and recorded pending`);
      out = { charged: false, reason: err.code };
    } else {
      log.warn(`[spv-engine-fee] deployment fee charge failed for ${spvId} (deployment stands): ${String(err)}`);
      out = { charged: false, reason: "CHARGE_FAILED" };
    }
  }
  /* WAVE 160 · ITEM 0 — the basis travels with the outcome, so a disputed charge
   * can be reconstructed from the row rather than re-derived from a database that
   * has since moved on. */
  out = { ...out, feeBasis: band.basis, basisSizeMinor: band.sizeMinor };
  recordBillingOutcome(raw, spvId, out);
  if (out.charged) {
    log.info(
      `[spv-engine-fee] charged ${out.amountMinor} ${out.currency} deployment fee for ${spvId} ` +
        `(partner ${partnerId}) on basis ${band.basis} sizeMinor=${band.sizeMinor}`,
    );
  } else if (out.reason && out.reason !== "already_charged") {
    log.warn(
      `[spv-engine-fee] NOT charged for ${spvId}: ${out.reason} — recorded PENDING in ` +
        `${DEPLOYMENT_FEE_BILLING_TABLE}; fix the cause and retry idempotently via ` +
        `POST /api/admin/consortium-spv/${spvId}/deployment-fee/retry`,
    );
  }
  return out;
}
