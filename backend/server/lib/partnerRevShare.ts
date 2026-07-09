/* GROUP C (C6) — fixed per-partner rev-share as a partner_billing_entries row.
 *
 * WHAT: when a partner-attributed portfolio company PAYS Capavate (its
 * capavate_subscriptions row is 'active'), and the partner's arrangement has
 * revShare.enabled, we record ONE idempotent partner_billing_entries row of
 * entry_kind 'revshare' worth the configured fixedAmountMinor. The entry starts
 * 'pending' and is settled through the EXISTING manual mark-paid endpoint
 * (POST /api/admin/partner-pl/:entryId/mark-paid) — no new settlement path.
 *
 * AUTO-TRIGGER IS DEFERRED (by design). The authoritative "paid" signal lives
 * in the Airwallex success webhook, which is untouchable payment code (rule
 * #14). Rather than hook into it, we VALIDATE BY QUERY: this module reads the
 * paid state from capavate_subscriptions (status='active', flipped only by the
 * untouched webhook) and lets an admin materialise the rev-share entries on
 * demand. When a Collective-side auto-trigger lands as a fast-follow, it can
 * call recordRevShareEntry() directly — hence `source` is stored generically.
 *
 * JOIN = QUERY, NOT SCHEMA. company_id aligns across partner_portfolio_company
 * (the partner's attributed companies) and capavate_subscriptions (the paid
 * signal); we JOIN on it. No new join table was introduced.
 *
 * Money is integer minor units. This module NEVER touches Airwallex / gateway
 * code; it only reads the already-persisted subscription state and writes to
 * partner_billing_entries.
 */
import crypto from "crypto";
import { rawDb } from "../db/connection";
import { readPartnerArrangement } from "./partnerEffectivePlan";

/** A partner-attributed company that has PAID (active subscription). */
export interface RevShareCandidate {
  partnerId: string;
  companyId: string;
  subscriptionId: string;
  /** The company's paid subscription amount (provenance only). */
  amountFundedMinor: number;
  subscriptionCurrency: string;
  /** The fixed rev-share amount owed to the partner, from the arrangement. */
  fixedAmountMinor: number;
  revShareCurrency: string;
  tierAtFunding: string;
  dealRef: string;
  /** true when a partner_billing_entries revshare row already exists. */
  alreadyRecorded: boolean;
}

/** Deterministic, idempotent deal_ref: one rev-share entry per partner+company. */
export function revShareDealRef(partnerId: string, companyId: string): string {
  return `revshare_${partnerId}_${companyId}`;
}

/** Read the partner's tier from contacts.metadata_json (same shape the admin
 *  partner list uses). Returns "" when unknown — kept as a string for the
 *  NOT NULL tier_at_funding column. */
function partnerTierOf(partnerId: string): string {
  const row = rawDb()
    .prepare(`SELECT metadata_json FROM contacts WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL`)
    .get(partnerId) as { metadata_json: string | null } | undefined;
  if (!row?.metadata_json) return "";
  try {
    return String((JSON.parse(row.metadata_json) as { tier?: string }).tier ?? "");
  } catch {
    return "";
  }
}

/** Does the capavate_subscriptions table exist yet? (It is created lazily by
 *  subscriptionStore on first use; absent on a fresh DB with no subs.) */
function subscriptionsTableExists(): boolean {
  const row = rawDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='capavate_subscriptions'`)
    .get() as { name: string } | undefined;
  return !!row;
}

/**
 * List rev-share candidates: partner-attributed companies (partner_portfolio_company)
 * whose Capavate subscription is 'active', for partners whose arrangement has
 * revShare.enabled. Optionally scoped to a single partner. Read-only.
 */
export function listRevShareCandidates(partnerId?: string): RevShareCandidate[] {
  if (!subscriptionsTableExists()) return [];
  const clauses = ["ppc.deleted_at IS NULL", "cs.status = 'active'"];
  const params: unknown[] = [];
  if (partnerId) {
    clauses.push("ppc.partner_id = ?");
    params.push(partnerId);
  }
  // JOIN on company_id (the aligned key). DISTINCT partner+company so multiple
  // subscription rows for one company collapse to a single rev-share candidate;
  // we keep the most recent active subscription as the provenance amount.
  const rows = rawDb()
    .prepare(
      `SELECT ppc.partner_id AS partnerId,
              ppc.company_id AS companyId,
              cs.id          AS subscriptionId,
              cs.amount_minor AS amountFundedMinor,
              cs.currency     AS subscriptionCurrency
         FROM partner_portfolio_company ppc
         JOIN capavate_subscriptions cs ON cs.company_id = ppc.company_id
        WHERE ${clauses.join(" AND ")}
        GROUP BY ppc.partner_id, ppc.company_id
       HAVING cs.created_at = MAX(cs.created_at)
        ORDER BY ppc.partner_id, ppc.company_id`,
    )
    .all(...params) as Array<{
      partnerId: string;
      companyId: string;
      subscriptionId: string;
      amountFundedMinor: number;
      subscriptionCurrency: string;
    }>;

  const out: RevShareCandidate[] = [];
  // Cache arrangement/tier lookups per partner to avoid re-reading contacts.
  const arrCache = new Map<string, ReturnType<typeof readPartnerArrangement>>();
  const tierCache = new Map<string, string>();
  for (const r of rows) {
    if (!arrCache.has(r.partnerId)) arrCache.set(r.partnerId, readPartnerArrangement(r.partnerId));
    const arrangement = arrCache.get(r.partnerId) ?? null;
    const rev = arrangement?.revShare;
    if (!rev || rev.enabled !== true) continue;
    if (!Number.isInteger(rev.fixedAmountMinor) || (rev.fixedAmountMinor as number) < 0) continue;
    if (!tierCache.has(r.partnerId)) tierCache.set(r.partnerId, partnerTierOf(r.partnerId));
    const dealRef = revShareDealRef(r.partnerId, r.companyId);
    const existing = rawDb()
      .prepare(`SELECT id FROM partner_billing_entries WHERE deal_ref = ?`)
      .get(dealRef) as { id: string } | undefined;
    out.push({
      partnerId: r.partnerId,
      companyId: r.companyId,
      subscriptionId: r.subscriptionId,
      amountFundedMinor: r.amountFundedMinor,
      subscriptionCurrency: r.subscriptionCurrency,
      fixedAmountMinor: rev.fixedAmountMinor as number,
      revShareCurrency: rev.currency ?? r.subscriptionCurrency ?? "USD",
      tierAtFunding: tierCache.get(r.partnerId) ?? "",
      dealRef,
      alreadyRecorded: !!existing,
    });
  }
  return out;
}

export interface RecordRevShareResult {
  /** true when a row was inserted; false when it already existed (idempotent). */
  created: boolean;
  entryId: string | null;
  dealRef: string;
}

/**
 * Record ONE fixed rev-share billing entry, idempotently. The UNIQUE(deal_ref)
 * constraint is the idempotency guard: a duplicate insert is swallowed and
 * reported as created:false. Writes only to partner_billing_entries.
 */
export function recordRevShareEntry(candidate: RevShareCandidate): RecordRevShareResult {
  const existing = rawDb()
    .prepare(`SELECT id FROM partner_billing_entries WHERE deal_ref = ?`)
    .get(candidate.dealRef) as { id: string } | undefined;
  if (existing) return { created: false, entryId: existing.id, dealRef: candidate.dealRef };

  const id = `pbe_${crypto.randomBytes(6).toString("hex")}`;
  const now = new Date().toISOString();
  try {
    rawDb()
      .prepare(
        `INSERT INTO partner_billing_entries
           (id, partner_id, deal_ref, amount_funded_minor, tier_at_funding,
            commission_pct, commission_minor, status, created_at, entry_kind, computed_via)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'revshare', 'arrangement_revshare')`,
      )
      .run(
        id,
        candidate.partnerId,
        candidate.dealRef,
        candidate.amountFundedMinor,
        candidate.tierAtFunding,
        0, // rev-share is a FIXED amount, not a percentage
        candidate.fixedAmountMinor,
        now,
      );
  } catch (err) {
    // A concurrent insert can lose the UNIQUE race — treat as idempotent hit.
    if (/UNIQUE/i.test((err as Error).message || "")) {
      const row = rawDb()
        .prepare(`SELECT id FROM partner_billing_entries WHERE deal_ref = ?`)
        .get(candidate.dealRef) as { id: string } | undefined;
      return { created: false, entryId: row?.id ?? null, dealRef: candidate.dealRef };
    }
    throw err;
  }
  return { created: true, entryId: id, dealRef: candidate.dealRef };
}

export interface MaterializeResult {
  eligible: number;
  created: number;
  alreadyRecorded: number;
  entries: Array<{ dealRef: string; entryId: string | null; created: boolean }>;
}

/**
 * Materialise rev-share entries for every eligible (paid, rev-share-enabled)
 * partner-attributed company. Idempotent: re-running only creates rows that do
 * not already exist. Optionally scoped to one partner.
 */
export function materializeRevShareEntries(partnerId?: string): MaterializeResult {
  const candidates = listRevShareCandidates(partnerId);
  const entries: MaterializeResult["entries"] = [];
  let created = 0;
  let alreadyRecorded = 0;
  for (const c of candidates) {
    const r = recordRevShareEntry(c);
    if (r.created) created += 1;
    else alreadyRecorded += 1;
    entries.push({ dealRef: r.dealRef, entryId: r.entryId, created: r.created });
  }
  return { eligible: candidates.length, created, alreadyRecorded, entries };
}
