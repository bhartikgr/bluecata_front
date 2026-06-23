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
import { resolvePartnerFee, FeeResolutionError } from "./partnerFeeResolver";
import type { PartnerTier } from "../adminContactsStoreShim";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * DB-direct partner tier read. Tier is stored in contacts.metadata_json.tier
 * (see adminContactsStore). Defaults to 'catalyst' (the lowest tier) when
 * absent — matching partnerWorkspaceStore's fallback. Read inside the same
 * transaction via the supplied raw handle so it sees uncommitted writes.
 */
function readPartnerTier(rawTx: any, partnerId: string): PartnerTier {
  const row = rawTx
    .prepare(`SELECT metadata_json FROM contacts WHERE id = ? AND kind = 'consortium_partner'`)
    .get(partnerId) as { metadata_json: string | null } | undefined;
  if (!row || !row.metadata_json) return "catalyst";
  try {
    const meta = JSON.parse(row.metadata_json) as { tier?: string };
    const t = meta.tier;
    if (t === "catalyst" || t === "builder" || t === "amplifier" || t === "nexus" || t === "founding_member") return t;
  } catch { /* fall through */ }
  return "catalyst";
}

/**
 * Charge the SPV deployment fee inside an existing transaction.
 *
 * @param tx        the better-sqlite3 / drizzle raw handle. We use the raw
 *                  sqlite handle (rawTx) for prepared statements so we are not
 *                  coupled to the Drizzle table objects in the sacred store.
 * @param rawTx     raw better-sqlite3 handle bound to the SAME connection/txn.
 * @param spvId     the SPV id (spvs.id).
 * @param partnerId the sourcing partner (contacts.id, kind='consortium_partner').
 * @param tier      the partner's tier (caller supplies from partner context).
 * @param committedMinor the SPV committed/target amount in minor units (drives band).
 */
export function chargeSpvDeploymentFee(args: {
  rawTx: any;
  spvId: string;
  partnerId: string;
  committedMinor: number;
}): { charged: boolean; reason?: string; amountMinor?: number; currency?: string } {
  const { rawTx, spvId, partnerId, committedMinor } = args;
  const tier = readPartnerTier(rawTx, partnerId);

  // ---- Idempotency: skip if already charged ----
  const spvRow = rawTx
    .prepare(`SELECT deployment_fee_paid_at, deployment_fee_minor FROM spvs WHERE id = ?`)
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

  // ---- Resolve the fee (DB-direct, fail-closed) ----
  let resolved;
  try {
    resolved = resolvePartnerFee(partnerId, tier, "spv_deployment", { sizeMinor: committedMinor });
  } catch (err) {
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
    `UPDATE spvs
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
