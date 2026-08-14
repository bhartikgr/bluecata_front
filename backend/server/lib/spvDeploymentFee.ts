/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * chargeSpvDeploymentFee() — ADDITIVE one-time fee charged when an SPV is
 * deployed (status transitions INTO 'active') AND it has a sourcing_partner_id.
 *
 * This module is NEW and lives in server/lib/ (allowed by the SACRED contract).
 * It is called as a single additive statement from inside the EXISTING
 * spvFundStore.updateSpv() transaction. It does NOT touch any cap-table or SPV
 * BigInt math — it only:
 *   1. resolves the deployment fee for the partner+tier+SPV-size via
 *      partnerFeeResolver (DB-direct, fail-closed),
 *   2. stamps the resolved fee onto the spvs row (deployment_fee_* columns),
 *   3. inserts a 'spv_deployment_fee' row into partner_billing_entries.
 *
 * Idempotent: if the SPV already has deployment_fee_paid_at OR a deployment-fee
 * billing entry, it is a no-op (a re-save of an already-active SPV won't
 * double-charge). All amounts/currency come from the resolver (DB) — there are
 * NO hardcoded fee values here.
 */
import crypto from "crypto";
import { FeeResolutionError } from "./partnerFeeResolver";
/* WAVE 46 / OWNER RULING R22 — ONE SOURCE FOR THIS FEE.
 *
 * The amount no longer comes from `resolvePartnerFee` directly. It comes from
 * `resolveSpvDeploymentFee`, which keeps levels 1-2 of that resolver (deliberate
 * per-partner and per-tier overrides — RETAINED per R3 so tiered pricing can be
 * reinstated) and replaces level 3 with THE ROW THE ADMIN CONSOLE WRITES:
 * `platform_fees` key `consortium.spv_deployment_fee`.
 *
 * Before this wave the console's number ($240.00 live) was never read here, and
 * the only `spv_deployment` rows that exist on a fresh deploy are the four
 * SEEDED $0 platform-default bands — so this path billed $0.00 while the console
 * advertised $240. See server/lib/spvDeploymentFeeSource.ts for the full
 * derivation. There is still no fee amount compiled into this file. */
import {
  resolveSpvDeploymentFee,
  SpvDeploymentFeeUnconfiguredError,
} from "./spvDeploymentFeeSource";
/* WAVE 3F / ITEM 2 — the tier comes from the canonical durable partner record
 * and FAILS CLOSED. See server/lib/partnerTierResolver.ts and migration 0161. */
import { resolveCanonicalPartnerTier } from "./partnerTierResolver";

function nowIso(): string {
  return new Date().toISOString();
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 3F / ITEM 2 — THE HARDCODED `catalyst` TIER FALLBACK IS GONE.
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * WHAT WAS HERE (:27-44 in the frozen v26.10.0 artifact):
 *
 *     function readPartnerTier(rawTx: any, partnerId: string): PartnerTier {
 *       const row = rawTx
 *         .prepare(`SELECT metadata_json FROM contacts WHERE id = ? AND kind = 'consortium_partner'`)
 *         .get(partnerId) as { metadata_json: string | null } | undefined;
 *       if (!row || !row.metadata_json) return "catalyst";
 *       try {
 *         const meta = JSON.parse(row.metadata_json) as { tier?: string };
 *         const t = meta.tier;
 *         if (t === "catalyst" || t === "builder" || ...) return t;
 *       } catch { }
 *       return "catalyst";
 *     }
 *
 * W10 REVIEW A proved that absent contact metadata on a canonical `builder`
 * partner billed the CATALYST schedule (11100) instead of the BUILDER schedule
 * (22200): a business tier — a PRICE — chosen by a string literal compiled into
 * the artifact, read out of a JSON blob that WAVE 4B already found is not the
 * canonical partner record.
 *
 * WHAT IS HERE NOW: `resolveCanonicalPartnerTier` (server/lib/
 * partnerTierResolver.ts) reads `partner_tier_current` (migration 0161, typed
 * and CHECK-constrained) cross-checked against the canonical partner record,
 * and THROWS `PartnerTierResolutionError` when the tier is missing or the two
 * disagree. Missing tier data now BLOCKS billing. The block is not lossy: the
 * caller (server/lib/spvEngineDeploymentFeeHook.ts) records a durable `pending`
 * billing row that an admin fixes and retries idempotently — WAVE 3F / ITEM 4.
 *
 * There is no fallback tier in this file, and `grep -n '"catalyst"'
 * server/lib/spvDeploymentFee.ts` now returns nothing.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Charge the SPV deployment fee inside an existing transaction.
 *
 * @param tx        the better-sqlite3 / drizzle raw handle. We use the raw
 *                  sqlite handle (rawTx) for prepared statements so we are not
 *                  coupled to the Drizzle table objects in the sacred store.
 * @param rawTx     raw better-sqlite3 handle bound to the SAME connection/txn.
 * @param spvId     the SPV id (spvs.id).
 * @param partnerId the sourcing partner (contacts.id, kind='consortium_partner').
 * The partner's tier is NOT a parameter: it is resolved fail-closed from the
 * canonical durable partner record (WAVE 3F / ITEM 2).
 * @param committedMinor the SPV committed/target amount in minor units (drives band).
 */
export function chargeSpvDeploymentFee(args: {
  rawTx: any;
  spvId: string;
  partnerId: string;
  committedMinor: number;
  /**
   * WAVE 8 ORP-029 — which table carries the SPV row that gets the
   * deployment_fee_* stamp.
   *
   * The original (v25.33) caller was spvFundStore, whose SPVs live in the
   * LEGACY `spvs` table, so the table name was hardcoded. The canonical SPV
   * engine (server/spvEngineStore.ts) writes an entirely different table,
   * `spv`. Charging an engine SPV while stamping `spvs` would UPDATE zero rows
   * — the fee would be billed but the SPV would never record that it was, and
   * the first idempotency probe below would never fire again. Defaults to the
   * legacy table so the existing caller is byte-equivalent in behaviour.
   */
  stampTable?: "spvs" | "spv";
}): { charged: boolean; reason?: string; amountMinor?: number; currency?: string } {
  const { rawTx, spvId, partnerId, committedMinor } = args;
  // Whitelisted, never interpolated from caller input.
  const stampTable: "spvs" | "spv" = args.stampTable === "spv" ? "spv" : "spvs";
  /* Fail-closed. Throws PartnerTierResolutionError rather than returning a
   * guessed tier; the caller turns that into a durable, retryable pending
   * billing record. Reads through the caller's raw handle so it sees the same
   * transaction's uncommitted writes, exactly as the old read did. */
  const tier = resolveCanonicalPartnerTier(partnerId, rawTx);

  // ---- Idempotency: skip if already charged ----
  const spvRow = rawTx
    .prepare(`SELECT deployment_fee_paid_at, deployment_fee_minor FROM ${stampTable} WHERE id = ?`)
    .get(spvId) as { deployment_fee_paid_at: string | null; deployment_fee_minor: number | null } | undefined;
  if (spvRow && (spvRow.deployment_fee_paid_at || spvRow.deployment_fee_minor !== null)) {
    return { charged: false, reason: "already_charged" };
  }
  const existingEntry = rawTx
    .prepare(`SELECT id FROM partner_billing_entries WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee' LIMIT 1`)
    .get(spvId) as { id: string } | undefined;
  if (existingEntry) {
    return { charged: false, reason: "already_charged" };
  }

  // ---- Resolve the fee (DB-direct, fail-closed, ONE SOURCE — R22) ----
  let resolved;
  try {
    resolved = resolveSpvDeploymentFee(partnerId, tier, {
      sizeMinor: committedMinor,
      raw: rawTx,
    });
  } catch (err) {
    /* R6/R22 — the authoritative row cannot answer. We refuse rather than
     * charging $0 (what the seeded bands used to do) or the historical $5,000
     * seed. Same graceful degradation as a band gap: no stamp, no ledger row, a
     * durable reason the caller records as `pending` for admin retry. */
    if (err instanceof SpvDeploymentFeeUnconfiguredError) {
      return { charged: false, reason: err.code };
    }
    if (err instanceof FeeResolutionError) {
      // Fail-closed at resolution means a genuine config gap. We do NOT charge a
      // guessed amount; we record the gap reason and leave the SPV un-stamped so
      // an admin can configure the band and re-trigger. We do NOT throw here —
      // throwing would roll back the SPV status transition (Avi's existing
      // write), violating "preserve Avi's writes". So we degrade gracefully.
      return { charged: false, reason: err.code };
    }
    throw err;
  }

  const now = nowIso();

  // ---- Stamp the spvs row (additive columns only) ----
  rawTx.prepare(
    `UPDATE ${stampTable}
       SET deployment_fee_minor = ?, deployment_fee_currency = ?, deployment_fee_payer = 'partner',
           deployment_fee_paid_at = NULL, deployment_fee_schedule_id = ?
     WHERE id = ?`
  ).run(resolved.amountMinor, resolved.currency, resolved.feeScheduleId, spvId);

  // ---- Insert the partner_billing_entries row ----
  // deal_ref reuses the SPV id (the deal being billed); commission_* columns
  // are repurposed to carry the flat deployment fee (commission_pct = 0 since
  // this is a flat fee, not a percentage). entry_kind distinguishes it.
  rawTx.prepare(
    `INSERT INTO partner_billing_entries
       (id, partner_id, deal_ref, amount_funded_minor, tier_at_funding, commission_pct, commission_minor,
        status, paid_at, created_at, entry_kind, spv_fund_id, fee_schedule_id, computed_via)
     VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', NULL, ?, 'spv_deployment_fee', ?, ?, ?)`
  ).run(
    `pbe_${crypto.randomBytes(6).toString("hex")}`,
    partnerId,
    spvId,
    committedMinor,
    tier,
    resolved.amountMinor,
    now,
    spvId,
    resolved.feeScheduleId,
    resolved.computedVia,
  );

  return { charged: true, amountMinor: resolved.amountMinor, currency: resolved.currency };
}
