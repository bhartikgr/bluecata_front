/**
 * server/lib/partnerApprovalInvoice.ts — WAVE 47 / OWNER RULING R20.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "ON APPROVAL" — approving a Consortium Partner application RAISES the annual
 * subscription invoice, inside the approval transaction, or the approval fails.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG (WAVE 44 verdict (b): implemented elsewhere, never wired)
 *   `server/lib/partnerBillingStore.ts` has had a complete, trigger-backed,
 *   cent-conserved partner invoice engine since Wave 5, and Wave 14 exposed it
 *   over HTTP. The consortium approval path never called it. Thirty
 *   applications were approved and zero invoices existed — not because
 *   invoicing was broken, but because nothing asked for one.
 *
 * WHAT THIS MODULE IS
 *   The single call the approval transaction makes. It OWNS no money logic of
 *   its own: every number comes from an existing resolver and every write goes
 *   through the existing store. Specifically it REUSES, and does not rebuild:
 *
 *     price   → resolvePartnerEffectivePlan(partnerId, tier, {cycle:'annual'})
 *               (server/lib/partnerEffectivePlan.ts, Group C) which composes
 *               the per-partner explicit override over the DB-only advertised
 *               tier row from partnerTiers.ts / partner_tier_price (0185).
 *     tier    → resolveCanonicalPartnerTier(partnerId) (partnerTierResolver.ts,
 *               Wave 3F) — THE one place a billing tier may be resolved.
 *     writes  → createInvoice / addInvoiceLine / assertInvoiceConserved /
 *               emitMoneyEvent (partnerBillingStore.ts, Wave 5).
 *
 *   There is NO price literal in this file. `$240` / `24000` appears nowhere:
 *   the amount is whatever the single DB row says it is, and if that row says
 *   nothing, this module REFUSES and the approval rolls back.
 *
 * THE FOUR REFUSALS (all fail-closed, all typed, none silent)
 *   PARTNER_APPROVAL_PRICE_UNRESOLVED   no override and no advertised price →
 *                                       we do NOT invoice $0 and we do NOT
 *                                       fall back to a literal. The approval
 *                                       fails loudly.
 *   PARTNER_APPROVAL_ZERO_WITHOUT_OVERRIDE
 *                                       a $0 that did NOT come from a
 *                                       per-partner explicit override. R20:
 *                                       "a per-partner explicit $0 override is
 *                                       the ONLY path to a $0 amount".
 *   PARTNER_APPROVAL_GRANDFATHER_WITHOUT_ZERO_OVERRIDE
 *                                       a LIVE partner_grandfather_grant row
 *                                       (0185) exists but the resolved price is
 *                                       not an explicit $0. R17 says these
 *                                       partners are not invoiced; billing one
 *                                       of them because their override is
 *                                       missing would be the exact failure the
 *                                       ruling forbids. Refuse, don't guess.
 *   PARTNER_APPROVAL_INVOICE_NOT_RECORDED / INVOICE_NOT_CONSERVED
 *                                       the invoice, its line, its total or its
 *                                       money event did not land. Never
 *                                       approve-and-silently-skip.
 *
 * GRANDFATHERED PARTNERS ARE NOT INVOICED (R17)
 *   Detection is by RESOLVED PRICE, never by a hardcoded list of ids or emails.
 *   An explicit `$0` `subscription_annual` override in
 *   `contacts.fee_override_json` resolves with source `partner_override`; that
 *   — and only that — yields `invoiced: false` with an audited, explicit zero.
 *   BluePrint Catalyst, Trendwell Ventures, Keiretsu Forum Canada and the dev
 *   account are therefore exempt because of DATA an admin can see and change,
 *   not because of code.
 *
 * FORWARD-ONLY (R20 requirement 3)
 *   This module is only ever called on the pending → approved TRANSITION. It
 *   contains no backfill, no sweep and no loop over historical applications:
 *   the 30 already-approved applications are never billed by it. Re-approving
 *   an already-approved application short-circuits before the transaction in
 *   `consortiumApplyStore`, and even if it did not, the deterministic invoice
 *   number below is UNIQUE in the database.
 *
 * IDEMPOTENCY (R20 requirement 4)
 *   `partner_invoice.invoice_number` is `TEXT NOT NULL UNIQUE` (migration 0153).
 *   The approval invoice number is DERIVED FROM THE APPLICATION ID, so a
 *   retried request cannot produce a second invoice: either we find the
 *   existing row and return it as idempotent, or the UNIQUE index rejects the
 *   insert. The latch is in the DATABASE, not in a cache.
 *
 * MONEY
 *   Integer minor units end to end. No `/100`, no `*100`, no cross-currency
 *   sum: one currency, taken from the resolved price, on one line, on one
 *   invoice. A JPY (exponent 0) partner is invoiced ¥N as N minor units.
 *
 * SACRED: `paymentGatewayAdapter.ts` is NOT touched. Raising an invoice is a
 * ledger act, not a charge: nothing here collects money, so the gateway is not
 * on this path at all.
 */
import { rawDb } from "../db/connection";
import {
  createInvoice,
  addInvoiceLine,
  getInvoice,
  assertInvoiceConserved,
  emitMoneyEvent,
  listMoneyEvents,
  type Invoice,
} from "./partnerBillingStore";
import {
  resolvePartnerEffectivePlan,
  EffectivePlanError,
  type EffectivePrice,
} from "./partnerEffectivePlan";
import { resolveCanonicalPartnerTier } from "./partnerTierResolver";
import type { PartnerTier } from "../adminContactsStoreShim";

/* ── typed refusals ─────────────────────────────────────────────────────── */

export const E_PRICE_UNRESOLVED = "PARTNER_APPROVAL_PRICE_UNRESOLVED";
export const E_ZERO_WITHOUT_OVERRIDE = "PARTNER_APPROVAL_ZERO_WITHOUT_OVERRIDE";
export const E_GRANDFATHER_WITHOUT_ZERO_OVERRIDE =
  "PARTNER_APPROVAL_GRANDFATHER_WITHOUT_ZERO_OVERRIDE";
export const E_INVOICE_NOT_RECORDED = "PARTNER_APPROVAL_INVOICE_NOT_RECORDED";
export const E_NON_INTEGER_MINOR = "PARTNER_APPROVAL_NON_INTEGER_MINOR";
export const E_NEGATIVE_MINOR = "PARTNER_APPROVAL_NEGATIVE_MINOR";

/** Every refusal this module can raise, so a caller can classify without regex
 *  guessing and a test can enumerate them. */
export const APPROVAL_INVOICE_ERROR_CODES: readonly string[] = [
  E_PRICE_UNRESOLVED,
  E_ZERO_WITHOUT_OVERRIDE,
  E_GRANDFATHER_WITHOUT_ZERO_OVERRIDE,
  E_INVOICE_NOT_RECORDED,
  E_NON_INTEGER_MINOR,
  E_NEGATIVE_MINOR,
] as const;

export class ApprovalInvoiceError extends Error {
  readonly code: string;
  readonly applicationId: string;
  readonly partnerId: string;
  readonly detail: Record<string, unknown>;
  constructor(
    code: string,
    applicationId: string,
    partnerId: string,
    detail: Record<string, unknown> = {},
  ) {
    super(`${code}:${applicationId}:${partnerId}:${JSON.stringify(detail)}`);
    this.name = "ApprovalInvoiceError";
    this.code = code;
    this.applicationId = applicationId;
    this.partnerId = partnerId;
    this.detail = detail;
  }
}

/* ── outcome ────────────────────────────────────────────────────────────── */

export interface ApprovalInvoiceOutcome {
  /** true when an invoice row exists for this approval (new OR pre-existing). */
  invoiced: boolean;
  invoiceId: string | null;
  /** Deterministic, derived from the application id. Always populated. */
  invoiceNumber: string;
  /** null only when the partner is exempt (explicit $0 override). */
  amountMinor: number | null;
  currency: string | null;
  tier: PartnerTier;
  cadence: "annual";
  priceSource: EffectivePrice["source"];
  /** true when the invoice already existed — the idempotent replay. */
  idempotent: boolean;
  /** Set (and `invoiced === false`) for a grandfathered / explicit-$0 partner. */
  exemption: {
    reason: "explicit_zero_override";
    grandfatherGrant: { reason: string; rulingRef: string } | null;
  } | null;
}

/**
 * The deterministic approval invoice number. DERIVED, never random: this string
 * is the idempotency latch, and `partner_invoice.invoice_number` is UNIQUE.
 */
export function approvalInvoiceNumber(applicationId: string): string {
  return `INV-APPR-${applicationId}`;
}

function findInvoiceByNumber(invoiceNumber: string): Invoice | null {
  let row: { id?: string } | undefined;
  try {
    row = rawDb()
      .prepare(`SELECT id FROM partner_invoice WHERE invoice_number = ?`)
      .get(invoiceNumber) as { id?: string } | undefined;
  } catch {
    /* An unreadable table must NEVER be reported as "no invoice yet" — that
       would be the double-invoice this latch exists to prevent. Rethrow. */
    throw new Error(`${E_INVOICE_NOT_RECORDED}:partner_invoice_unreadable`);
  }
  if (!row?.id) return null;
  return getInvoice(String(row.id));
}

/** A LIVE (unrevoked) grandfather grant for this partner, or null. Read-only. */
function readLiveGrandfatherGrant(
  partnerId: string,
): { reason: string; rulingRef: string } | null {
  try {
    const row = rawDb()
      .prepare(
        `SELECT reason, ruling_ref FROM partner_grandfather_grant
          WHERE partner_id = ? AND revoked_at IS NULL
          ORDER BY granted_at DESC LIMIT 1`,
      )
      .get(partnerId) as { reason?: string; ruling_ref?: string } | undefined;
    if (!row?.reason) return null;
    return { reason: String(row.reason), rulingRef: String(row.ruling_ref ?? "") };
  } catch {
    /* Table absent in this environment (pre-0185 bootstrap). Absent is NOT the
       same as "no grant": it means we cannot tell. We therefore return null and
       rely on the price itself — an explicit $0 override still exempts, and a
       priced partner is still invoiced. No grant table can silently create a
       free partner, which is the direction that matters. */
    return null;
  }
}

/**
 * draft → issued, for THIS invoice only.
 *
 * `createInvoice` deliberately creates a DRAFT (Wave 5: a draft accumulates
 * consolidated lines before anyone is billed), and the store exposes no
 * transition. Emitting `invoice.issued` over a row still marked `draft` would
 * be a status the ledger contradicts, so the transition happens here, next to
 * the event that announces it.
 *
 * WHY THIS DOES NOT ADD A SECOND WRITER OF MONEY: it writes `status` and
 * `issued_at` only. `total_minor` remains owned exclusively by the 0153
 * triggers, and this module never touches it. The UPDATE is asserted to change
 * exactly one row: a silent no-op here would mean announcing an issue that did
 * not happen.
 */
function markInvoiceIssued(
  invoiceId: string,
  atIso: string,
  applicationId: string,
  partnerId: string,
): void {
  const res = rawDb()
    .prepare(
      `UPDATE partner_invoice SET status = 'issued', issued_at = ?, updated_at = ?
        WHERE id = ? AND status = 'draft'`,
    )
    .run(atIso, atIso, invoiceId);
  if (Number(res.changes) !== 1) {
    throw new ApprovalInvoiceError(E_INVOICE_NOT_RECORDED, applicationId, partnerId, {
      reason: "invoice_not_marked_issued",
      invoiceId,
      changes: Number(res.changes),
    });
  }
}

/** UTC "one year later", used for the annual invoice period end. */
function oneYearLaterIso(fromIso: string): string {
  const d = new Date(fromIso);
  const end = new Date(
    Date.UTC(
      d.getUTCFullYear() + 1,
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  return end.toISOString();
}

export interface RaiseApprovalInvoiceInput {
  applicationId: string;
  partnerId: string;
  organizationName: string;
  actorUserId: string;
  /** Approval instant (ISO). The invoice period starts here. */
  nowIso: string;
}

/**
 * Raise the partner's annual subscription invoice for an approval.
 *
 * MUST be called INSIDE the approval transaction: every write it performs is
 * rolled back with the approval if anything later fails, and every throw it
 * raises rolls the approval back. There is no third outcome.
 *
 * @throws {ApprovalInvoiceError} on any refusal. Never returns a $0 invoice.
 */
export function raiseApprovalInvoice(
  input: RaiseApprovalInvoiceInput,
): ApprovalInvoiceOutcome {
  const { applicationId, partnerId, organizationName, actorUserId } = input;
  const invoiceNumber = approvalInvoiceNumber(applicationId);

  /* 1. Canonical billing tier. Fails closed (PARTNER_TIER_UNRESOLVED /
   *    PARTNER_TIER_INCONSISTENT) rather than guessing a tier — and a guessed
   *    tier is a guessed price. */
  const tier = resolveCanonicalPartnerTier(partnerId);

  /* 2. Price. ANNUAL is passed explicitly: the resolver defaults to monthly,
   *    and R3 retired monthly. A missing cycle argument would have silently
   *    priced the wrong cadence. */
  let effective: EffectivePrice;
  try {
    effective = resolvePartnerEffectivePlan(partnerId, tier, { cycle: "annual" })
      .effectivePrice;
  } catch (err) {
    if (err instanceof EffectivePlanError) {
      /* WAVE 50 · ITEM 3 — PRESERVE THIS PATH'S LOUDER, MORE SPECIFIC CODE.
       * Item 3 moved the tier-level-zero refusal upstream into the price
       * classifier, so this catch now sees an unresolved price where Wave 47's
       * own zero gate below used to see a literal 0. The CONDITION is unchanged
       * and so is the outcome (refused, atomic, no invoice, application
       * untouched); only the place it is detected moved. Re-mapping it back to
       * E_ZERO_WITHOUT_OVERRIDE keeps R20's contract exactly as Wave 47 wrote
       * it, instead of degrading a named fault into a generic one. The zero gate
       * below is NOT removed: it still guards a zero arriving from any other
       * source (e.g. a fee-schedule row), which is a different route to the same
       * accident. */
      if (err.code === "tier_zero_unattested") {
        throw new ApprovalInvoiceError(E_ZERO_WITHOUT_OVERRIDE, applicationId, partnerId, {
          tier,
          cadence: "annual",
          priceSource: "tier_advertised",
          reason: err.code,
          message: err.message,
        });
      }
      throw new ApprovalInvoiceError(E_PRICE_UNRESOLVED, applicationId, partnerId, {
        tier,
        cadence: "annual",
        reason: err.code,
        message: err.message,
      });
    }
    /* PartnerTierPriceUnresolvedError and anything else that means "no price"
       lands here. It is still a refusal, never a fallback. */
    throw new ApprovalInvoiceError(E_PRICE_UNRESOLVED, applicationId, partnerId, {
      tier,
      cadence: "annual",
      reason: (err as Error).name || "unknown",
      message: (err as Error).message,
    });
  }

  const amountMinor = effective.amountMinor;
  if (!Number.isInteger(amountMinor)) {
    throw new ApprovalInvoiceError(E_NON_INTEGER_MINOR, applicationId, partnerId, {
      amountMinor,
    });
  }
  if (amountMinor < 0) {
    throw new ApprovalInvoiceError(E_NEGATIVE_MINOR, applicationId, partnerId, {
      amountMinor,
    });
  }

  const grant = readLiveGrandfatherGrant(partnerId);

  /* 3. The zero gate. R20: an explicit per-partner override is the ONLY path to
   *    a $0 amount. A zero arriving from the advertised tier row is a pricing
   *    accident, and invoicing $0 would hide it forever. */
  if (amountMinor === 0) {
    if (effective.source !== "partner_override") {
      throw new ApprovalInvoiceError(E_ZERO_WITHOUT_OVERRIDE, applicationId, partnerId, {
        tier,
        priceSource: effective.source,
        currency: effective.currency,
      });
    }
    /* GRANDFATHERED / EXPLICIT ZERO → NO INVOICE AT ALL. Not a $0 invoice: a $0
       invoice is a bill for nothing, and R6 forbids rendering a value nobody
       entered. The exemption is returned to the caller, which audits it. */
    return {
      invoiced: false,
      invoiceId: null,
      invoiceNumber,
      amountMinor: 0,
      currency: effective.currency,
      tier,
      cadence: "annual",
      priceSource: effective.source,
      idempotent: false,
      exemption: { reason: "explicit_zero_override", grandfatherGrant: grant },
    };
  }

  /* 4. A live grandfather grant must NEVER be billed. If we got here the price
   *    is > 0, so the grant and the override disagree: refuse rather than send
   *    a bill R17 says must not exist. */
  if (grant) {
    throw new ApprovalInvoiceError(
      E_GRANDFATHER_WITHOUT_ZERO_OVERRIDE,
      applicationId,
      partnerId,
      {
        tier,
        amountMinor,
        currency: effective.currency,
        priceSource: effective.source,
        grantReason: grant.reason,
        rulingRef: grant.rulingRef,
        remedy:
          "set an explicit $0 subscription_annual override in contacts.fee_override_json, or revoke the grant",
      },
    );
  }

  /* 5. Idempotent replay — the invoice for this application already exists. */
  const already = findInvoiceByNumber(invoiceNumber);
  if (already) {
    return {
      invoiced: true,
      invoiceId: already.id,
      invoiceNumber,
      amountMinor: already.totalMinor,
      currency: already.currency,
      tier,
      cadence: "annual",
      priceSource: effective.source,
      idempotent: true,
      exemption: null,
    };
  }

  /* 6. Raise it. One invoice, one line, one currency. */
  const periodStart = input.nowIso;
  const periodEnd = oneYearLaterIso(input.nowIso);
  const invoiceId = createInvoice({
    partnerId,
    invoiceNumber,
    currency: effective.currency,
    periodStart,
    periodEnd,
  });
  addInvoiceLine({
    invoiceId,
    entryKind: "subscription",
    description: `Consortium Partner annual subscription — ${organizationName} (${tier})`,
    amountMinor,
    settlementState: "pending",
    sourceRef: `consortium_application:${applicationId}`,
  });

  /* 7. Conservation, asserted in application code as well as by the 0153
   *    triggers, and then asserted AGAIN against the price we resolved: a
   *    conserved invoice for the wrong amount is still wrong. */
  const conservedTotal = assertInvoiceConserved(invoiceId);
  if (conservedTotal !== amountMinor) {
    throw new ApprovalInvoiceError(E_INVOICE_NOT_RECORDED, applicationId, partnerId, {
      reason: "total_does_not_match_resolved_price",
      conservedTotal,
      amountMinor,
    });
  }

  /* 8. draft → issued, before the event that announces it. */
  markInvoiceIssued(invoiceId, input.nowIso, applicationId, partnerId);

  /* 9. The money event. `emitMoneyEvent` deliberately swallows its own write
   *    error (an event must not roll back the money op it describes), so we
   *    READ IT BACK: on this path a missing event is a silent invoice, and R20
   *    requires the event. Absence therefore fails the approval. */
  emitMoneyEvent("invoice.issued", {
    partnerId,
    subjectKind: "invoice",
    subjectId: invoiceId,
    actorId: actorUserId,
    idempotencyKey: invoiceNumber,
    sourceEventType: "consortium.apply.approved",
    sourceEventId: applicationId,
    payload: {
      applicationId,
      partnerId,
      invoiceNumber,
      tier,
      cadence: "annual",
      amountMinor,
      currency: effective.currency,
      priceSource: effective.source,
      organizationName,
    },
  });
  const events = listMoneyEvents("invoice", invoiceId);
  if (!events.some((e) => e.eventName === "invoice.issued")) {
    throw new ApprovalInvoiceError(E_INVOICE_NOT_RECORDED, applicationId, partnerId, {
      reason: "money_event_not_recorded",
      invoiceId,
    });
  }

  return {
    invoiced: true,
    invoiceId,
    invoiceNumber,
    amountMinor,
    currency: effective.currency,
    tier,
    cadence: "annual",
    priceSource: effective.source,
    idempotent: false,
    exemption: null,
  };
}
