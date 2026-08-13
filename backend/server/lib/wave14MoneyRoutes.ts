// server/lib/wave14MoneyRoutes.ts
//
// WAVE 14 — THE ROUTES FOR THE MONEY ENGINE THAT WAS BUILT AND NEVER MOUNTED.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS. "An engine with no route is NOT shipped."
//
// server/lib/partnerBillingStore.ts is 1 100 lines of Wave 5 money engine:
// tier prices, annual resolution, promotions with exact-BigInt discounts,
// moderation, grants, consolidated invoices with database-enforced cent
// conservation, commission splitting through the shared allocator, and a money
// event log fenced to the reused outbound vocabulary. Verified by grep across
// server/ and client/ before writing a line of this file, exactly ONE of its
// exports had a live caller:
//
//   quotePartnerSubscription   -> partnerSubscriptionStore.ts:217  (LIVE)
//   listTierPrices             -> 0 non-test callers
//   setTierPrice               -> 0
//   resolveAnnualAmountMinor   -> 1 (internal, from quotePartnerSubscription)
//   listPromotions             -> 0
//   moderatePromotion          -> 0
//   grantPromotion             -> 0
//   createInvoice              -> 0
//   addInvoiceLine             -> 0
//   getInvoice                 -> 0
//   assertInvoiceConserved     -> 0
//   commissionSplit            -> 0
//   splitCommissionMinor       -> 0
//   emitMoneyEvent             -> internal only
//   listMoneyEvents            -> 0
//   createSubscription         -> 0   <- and it held the CP-PROMO-19 supersession
//
// So the CP-SUB / CP-COM / CP-PROMO items were not missing code. They were
// missing REACHABILITY. This file is the reachability, and the client pages that
// consume it are listed per route so the sink is nameable.
//
// ─────────────────────────────────────────────────────────────────────────────
// MONEY RULES OBSERVED HERE
//   · Integer minor units everywhere. No route accepts or returns a float amount.
//   · No `Math.round` on a per-party share: every split goes through
//     `splitCommissionMinor`, which delegates to the shared allocator in
//     ./money with the (remainder DESC, weight DESC, index ASC) comparator.
//   · Percentages are FRACTIONS on the wire. Nothing here multiplies by 100;
//     the client renders through client/src/lib/percentDisplay.ts.
//   · Cent conservation on invoices is enforced by DATABASE TRIGGERS
//     (trg_pinvl_* in migration 0153). `assertInvoiceConserved` is a read-side
//     re-check, and its failure is surfaced to the caller rather than logged,
//     because an invoice whose total disagrees with its lines must not render.
//
// AUTHORISATION. Partner reads use `requirePartnerAuth`, which resolves
// `partnerId` from the session-backed team member and NEVER from the request
// body — so no route here can be pointed at another partner's money by a
// client-supplied id. Admin writes use `requireAdmin`.
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { requirePartnerAuth } from "./requirePartnerAuth";
import { rawDb } from "../db/connection";
import { log } from "./logger";
import { sanitizeErrorMessage } from "./sanitize";
import {
  listTierPrices,
  tierPriceCoverage,
  setTierPrice,
  resolveAnnualAmountMinor,
  listPromotions,
  getPromotionByCode,
  resolvePromotionDiscount,
  moderatePromotion,
  grantPromotion,
  listInvoices,
  getInvoice,
  createInvoice,
  addInvoiceLine,
  assertInvoiceConserved,
  commissionSplit,
  commissionPositionByKind,
  splitCommissionMinor,
  listSubscriptions,
  getLiveSubscription,
  listMoneyEvents,
  listMoneyEventsForPartner,
  BILLING_ENTRY_KINDS,
  type Cadence,
  type EntryKind,
} from "./partnerBillingStore";
import { getByPaymentIntent, listForSubject } from "./partnerSubscriptionStore";
import { renewalWorkerConfig } from "./collectiveRenewalWorker";
import { spvEngineStore } from "../spvEngineStore";

/* ── shared helpers ─────────────────────────────────────────────────────── */

const CADENCES: readonly Cadence[] = Object.freeze(["monthly", "annual", "quarterly", "one_time"] as const);

function partnerIdOf(req: Request): string {
  /* requirePartnerAuth has already run and set `req.partnerContext` from the
     session-resolved `partner_team_members` row. NEVER read a partnerId from the
     body or query — that is the rule the middleware's own header states, and it
     is why none of the routes below take a partner id from the client. */
  return String((req as any).partnerContext?.partnerId ?? "");
}

function actorOf(req: Request): string {
  const ctx = (req as any).partnerContext ?? {};
  return String((req as any).user?.id ?? (req as any).userId ?? ctx.userId ?? "unknown");
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Errors from the money engine are DOMAIN errors with stable codes
 * (`TIER_PRICE_UNPRICED`, `PROMOTION_NOT_APPLICABLE:expired`, …). They are
 * returned as 400/409 with the code intact so the client can render a specific
 * message, and only genuinely unexpected failures become a 500.
 */
const DOMAIN_PREFIXES = [
  "TIER_PRICE_UNPRICED",
  "DISCOUNT_EXCEEDS_AMOUNT",
  "PROMOTION_NOT_APPLICABLE",
  "PROMOTION_OUT_OF_SCOPE",
  "NON_INTEGER_MINOR",
  "INVOICE_NOT_CONSERVED",
  "EVENT_NAME_NOT_REUSED",
  "PARTNER_BILLING_UNAVAILABLE",
];

function fail(res: Response, e: unknown, where: string): void {
  const msg = e instanceof Error ? e.message : String(e);
  const domain = DOMAIN_PREFIXES.find((p) => msg.startsWith(p));
  if (domain) {
    // INVOICE_NOT_CONSERVED is a 500-class fact about stored data, not a client
    // mistake: the client did nothing wrong and cannot fix it by retrying.
    const status = domain === "INVOICE_NOT_CONSERVED" || domain === "PARTNER_BILLING_UNAVAILABLE" ? 500 : 400;
    res.status(status).json({ ok: false, error: domain, message: msg });
    return;
  }
  log.error(`[wave14MoneyRoutes] ${where}: ${msg}`);
  res.status(500).json({ ok: false, error: "MONEY_ROUTE_FAILED", message: sanitizeErrorMessage(msg) });
}

export function registerWave14MoneyRoutes(app: Express): void {
  /* ══════════════════════════════════════════════════════════════════════
   * PARTNER SURFACE
   * Sink: client/src/pages/partner/PartnerBilling.tsx (Invoices + Activity tabs)
   *       client/src/pages/partner/PartnerCheckoutReturn.tsx (CP-SUB-17)
   * ════════════════════════════════════════════════════════════════════ */

  /**
   * CP-SUB-09 + CP-COM-02 — the partner's invoices, consolidated.
   *
   * COM-02's promise is a CONSOLIDATED view: subscription, commission and
   * SPV-fee lines on one invoice. That consolidation is a property of the data
   * model (one `partner_invoice`, many `partner_invoice_line` rows of different
   * `entry_kind`), so the route does not need to join anything — it needs to
   * stop hiding what is already one row. `entryKinds` is returned per invoice so
   * the UI can show the consolidation instead of the reader having to infer it.
   *
   * CONSERVATION IS REPORTED, NOT ASSUMED. Every invoice is re-checked against
   * its lines; a non-conserving invoice is flagged `conserved: false` with the
   * delta rather than being silently rendered or silently dropped.
   */
  app.get("/api/partner/me/invoices", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const invoices = listInvoices(pid).map((inv) => {
        let conserved = true;
        let lineSumMinor = inv.lines.reduce((s, l) => s + l.amountMinor, 0);
        try {
          lineSumMinor = assertInvoiceConserved(inv.id);
        } catch {
          conserved = false;
        }
        return {
          ...inv,
          conserved,
          lineSumMinor,
          deltaMinor: inv.totalMinor - lineSumMinor,
          entryKinds: Array.from(new Set(inv.lines.map((l) => l.entryKind))).sort(),
          pendingMinor: inv.lines.filter((l) => l.settlementState === "pending").reduce((s, l) => s + l.amountMinor, 0),
          paidMinor: inv.lines.filter((l) => l.settlementState === "paid").reduce((s, l) => s + l.amountMinor, 0),
        };
      });
      res.json({
        ok: true,
        invoices,
        total: invoices.length,
        // CP-COM-05 — the five kinds come from the engine, which takes them from
        // the schema CHECK. The UI never keeps its own copy of this list.
        entryKinds: BILLING_ENTRY_KINDS,
      });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/invoices");
    }
  });

  /** CP-SUB-09 — one invoice, scoped to the caller's partner id. */
  app.get("/api/partner/me/invoices/:id", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const inv = getInvoice(String(req.params.id));
      // Ownership is checked on the ROW, not on the request: a partner cannot
      // read another partner's invoice by guessing an id.
      if (!inv || inv.partnerId !== pid) {
        return res.status(404).json({ ok: false, error: "INVOICE_NOT_FOUND" });
      }
      let conserved = true;
      let lineSumMinor = 0;
      try {
        lineSumMinor = assertInvoiceConserved(inv.id);
      } catch {
        conserved = false;
        lineSumMinor = inv.lines.reduce((s, l) => s + l.amountMinor, 0);
      }
      res.json({
        ok: true,
        invoice: inv,
        conserved,
        lineSumMinor,
        deltaMinor: inv.totalMinor - lineSumMinor,
        events: listMoneyEvents("invoice", inv.id),
      });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/invoices/:id");
    }
  });

  /**
   * CP-SUB-11 — subscription history for the partner's own Billing page.
   *
   * `listSubscriptions` returns EVERY row including `superseded` ones, which is
   * the point: after CP-PROMO-19 supersedes a grandfathered plan, the partner
   * must still be able to see that they HAD it and why it ended. Hiding
   * superseded rows would make the supersession look like a deletion.
   */
  app.get("/api/partner/me/subscription-history", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const rows = listSubscriptions(pid);
      res.json({
        ok: true,
        subscriptions: rows,
        live: getLiveSubscription(pid),
        superseded: rows.filter((r) => r.status === "superseded"),
        total: rows.length,
      });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/subscription-history");
    }
  });

  /** CP-SUB-15 + CP-PROMO-23 — the partner's own money-event timeline. */
  app.get("/api/partner/me/money-events", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const limit = intOrNull(req.query.limit) ?? 200;
      const events = listMoneyEventsForPartner(pid, limit);
      res.json({ ok: true, events, total: events.length, limit });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/money-events");
    }
  });

  /**
   * CP-SUB-17 — THE ANTI-STRANDING RETURN STATUS.
   *
   * THE FAILURE THIS CLOSES. `startPartnerCheckout` sends the partner to a
   * hosted payment page with `returnUrl = <origin>/collective/partner/billing/return?paymentIntentId=…`.
   * Nothing served that path: the partner paid, came back, and landed on a
   * blank route with money gone and no statement of what happened. That is the
   * definition of stranded.
   *
   * This route answers the only question that matters on return — "did my
   * payment produce a subscription?" — from the DATABASE, keyed by the payment
   * intent the gateway handed back. It NEVER activates anything: activation is
   * the webhook's job (and, in stub mode, the checkout path's). A return page
   * that activated on GET would let a reload mint entitlement.
   */
  app.get("/api/partner/me/checkout/status", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const paymentIntentId = typeof req.query.paymentIntentId === "string" ? req.query.paymentIntentId : "";
      const merchantOrderId = typeof req.query.merchantOrderId === "string" ? req.query.merchantOrderId : "";
      if (!paymentIntentId && !merchantOrderId) {
        return res.status(400).json({
          ok: false,
          error: "CHECKOUT_REFERENCE_REQUIRED",
          message: "Supply paymentIntentId or merchantOrderId — the reference the gateway returned.",
        });
      }

      /* SCOPED BY ROW, NOT BY QUERY. `getByPaymentIntent` is keyed on the intent
         alone, so its result is re-checked against the caller's own partner id;
         otherwise a partner holding someone else's intent reference could read
         their subscription. */
      const candidate = paymentIntentId
        ? getByPaymentIntent(paymentIntentId)
        : (listForSubject("partner", pid).find((r) => r.merchantOrderId === merchantOrderId) ?? null);
      const row =
        candidate && candidate.subjectKind === "partner" && candidate.subjectId === pid ? candidate : null;

      if (!row) {
        /* HONEST UNKNOWN. The reference did not match any subscription for this
           partner. That is NOT proof the payment failed — a webhook may still be
           in flight — so the answer is `pending_unmatched` with instructions,
           never "your payment failed". Telling a partner who paid that they did
           not is worse than telling them we do not know yet. */
        return res.json({
          ok: true,
          state: "pending_unmatched",
          subscription: null,
          reference: { paymentIntentId: paymentIntentId || null, merchantOrderId: merchantOrderId || null },
          message:
            "We have not yet matched this payment reference to a subscription. If you completed payment, it is safe to close this page — the confirmation will appear on your Billing page. Do not pay again.",
          safeToRetry: false,
        });
      }

      const state =
        row.status === "active" || row.status === "grace"
          ? "active"
          : row.status === "pending"
            ? "awaiting_confirmation"
            : row.status === "failed"
              ? "failed"
              : row.status;
      res.json({
        ok: true,
        state,
        subscription: row,
        reference: { paymentIntentId: paymentIntentId || null, merchantOrderId: merchantOrderId || null },
        events: listMoneyEvents("subscription", row.id),
        // Retrying is only ever safe when the attempt actually failed.
        safeToRetry: row.status === "failed" || row.status === "cancelled",
      });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/checkout/status");
    }
  });

  /** CP-COM-04 / CP-COM-05 — the partner's own pending-vs-paid commission split. */
  app.get("/api/partner/me/commission-summary", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      /* Two reads, deliberately: `commissionSplit` is the COMMISSION-ONLY
         position (its own definition, entry_kind='commission'), and
         `commissionPositionByKind` is the whole position across all five kinds.
         Reporting only the second would silently redefine "commission"; only the
         first would understate what the partner owes. */
      const commissionOnly = commissionSplit(pid);
      const position = commissionPositionByKind(pid);
      /* WAVE 21 · ITEM 2 (REVIEW A, was :352-359). `totalMinor` used to be
         `position.pendingMinor + position.paidMinor` over a position whose two
         operands were themselves cross-currency sums stamped "USD". Both are
         now null when the position is mixed, so the total is null too, and the
         per-currency `totalByCurrency` is the authoritative shape. A derived
         figure is never more available than its inputs. */
      const totalByCurrency = position.byCurrency.map((c) => ({
        currency: c.currency,
        totalMinor: c.pendingMinor + c.paidMinor,
      }));
      const total: typeof position.pending = position.pending.available && position.paid.available
        ? {
            available: true,
            currency: position.pending.currency,
            minor: position.pending.minor + position.paid.minor,
          }
        : {
            available: false, currency: null, minor: null,
            reason: "needs_fx_conversion", currencies: position.currencies,
          };
      res.json({
        ok: true,
        ...position,
        commissionOnly,
        totalMinor: total.available ? total.minor : null,
        total,
        totalByCurrency,
        entryKinds: BILLING_ENTRY_KINDS,
      });
    } catch (e) {
      fail(res, e, "GET /api/partner/me/commission-summary");
    }
  });

  /**
   * CP-PROMO-07 + CP-PROMO-09 — quote a promotion code against a real base
   * amount, with the SCOPE fields and the VALUE SEMANTICS both visible.
   *
   * PROMO-07 is "scoped DiscountCode fields": a code is not global, it carries
   * `scopeKind` ∈ platform|tier|partner|deal + `scopeId`, and whether it applies
   * to THIS partner is a decision only the server can make. PROMO-09 is the
   * value migration: `percent` codes are stored as an exact integer on scale
   * 1e9, never as a float percentage, and `flat_minor` codes are integer minor
   * units. Both are reported here so the partner sees which kind applied.
   *
   * A REJECTED CODE IS A 200 WITH A REASON, NOT A 4xx. This is a quote, not a
   * charge: the partner needs to be told why the code did not apply while still
   * seeing the price they would pay. Returning 400 would blank the price.
   */
  app.post("/api/partner/me/promotions/quote", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const pid = partnerIdOf(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const code = String(b.code ?? "").trim();
      const baseMinor = intOrNull(b.baseMinor);
      if (!code) return res.status(400).json({ ok: false, error: "CODE_REQUIRED" });
      if (baseMinor === null || baseMinor < 0) {
        return res.status(400).json({
          ok: false,
          error: "NON_INTEGER_MINOR",
          message: "baseMinor must be a non-negative integer number of minor units.",
        });
      }
      const promo = getPromotionByCode(code);
      try {
        const d = resolvePromotionDiscount(code, baseMinor, {
          partnerId: pid,
          tierSlug: typeof b.tierSlug === "string" ? b.tierSlug : undefined,
          dealId: typeof b.dealId === "string" ? b.dealId : undefined,
        });
        res.json({
          ok: true,
          applied: true,
          baseMinor,
          discountMinor: d.discountMinor,
          netMinor: baseMinor - d.discountMinor,
          trialExtensionDays: d.trialExtensionDays,
          valueKind: d.valueKind,
          supersedesGrandfathered: d.supersedesGrandfathered,
          scope: promo ? { kind: promo.scopeKind, id: promo.scopeId } : null,
          code: d.code,
        });
      } catch (err) {
        res.json({
          ok: true,
          applied: false,
          baseMinor,
          discountMinor: 0,
          netMinor: baseMinor,
          reason: (err as Error).message,
          scope: promo ? { kind: promo.scopeKind, id: promo.scopeId } : null,
          code,
        });
      }
    } catch (e) {
      fail(res, e, "POST /api/partner/me/promotions/quote");
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * ADMIN SURFACE
   * Sink: client/src/pages/admin/AdminPartnerBillingOps.tsx
   * ════════════════════════════════════════════════════════════════════ */

  /** CP-SUB-13 — tier price COVERAGE, so the unpriced tiers are visible. */
  app.get("/api/admin/partner-billing/tier-prices", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, ...tierPriceCoverage(), cadences: CADENCES });
    } catch (e) {
      fail(res, e, "GET /api/admin/partner-billing/tier-prices");
    }
  });

  /**
   * CP-SUB-12 — an admin sets a per-(tier, cadence) price, in MINOR UNITS.
   *
   * `priceMinor: null` is accepted and means DELIBERATELY UNPRICED — it is not
   * zero, and the engine records `derivation='unpriced'` so the ×12 legacy
   * fallback is labelled rather than invisible. A float is REJECTED rather than
   * rounded: rounding a price the admin typed is how a platform charges an
   * amount nobody authorised.
   */
  app.put("/api/admin/partner-billing/tier-prices", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const tierSlug = String(b.tierSlug ?? "").trim();
      const cadence = String(b.cadence ?? "") as Cadence;
      if (!tierSlug) return res.status(400).json({ ok: false, error: "TIER_SLUG_REQUIRED" });
      if (!CADENCES.includes(cadence)) {
        return res.status(400).json({ ok: false, error: "BAD_CADENCE", message: `expected one of ${CADENCES.join(", ")}` });
      }
      let priceMinor: number | null;
      if (b.priceMinor === null || b.priceMinor === undefined || b.priceMinor === "") {
        priceMinor = null;
      } else {
        const n = Number(b.priceMinor);
        if (!Number.isSafeInteger(n) || n < 0) {
          return res.status(400).json({
            ok: false,
            error: "NON_INTEGER_MINOR",
            message: "priceMinor must be a non-negative integer number of minor units, or null for deliberately unpriced.",
          });
        }
        priceMinor = n;
      }
      const row = setTierPrice(tierSlug, cadence, priceMinor, {
        currency: typeof b.currency === "string" ? b.currency : undefined,
        updatedBy: actorOf(req),
        notes: typeof b.notes === "string" ? b.notes : undefined,
      });
      /* W-7 — show the admin what an ANNUAL amount now resolves to, including
         whether the legacy ×12 fallback is still in play for this tier. This is
         the one place the fallback is visible before a partner is charged. */
      const monthly = listTierPrices().find((r) => r.tierSlug === tierSlug && r.cadence === "monthly");
      const annualPreview =
        monthly && monthly.priceMinor !== null
          ? resolveAnnualAmountMinor(tierSlug, monthly.priceMinor, monthly.currency)
          : null;
      res.json({ ok: true, price: row, annualPreview, coverage: tierPriceCoverage() });
    } catch (e) {
      fail(res, e, "PUT /api/admin/partner-billing/tier-prices");
    }
  });

  /**
   * CP-SUB-19 + CP-PROMO-04 + CP-PROMO-17 + CP-PROMO-22 — THE DECISION LEDGER.
   *
   * Four of this wave's items are decisions rather than features, two of them
   * still awaiting the owner. Recording them in a migration made them durable;
   * this route makes them VISIBLE, which is the half that was missing. An open
   * pricing question that only exists in a .sql file is indistinguishable from a
   * dropped one.
   *
   * `percent_policy_record` rows with status 'open' are joined in, because
   * ppr_annual_pricing_model (CP-SUB-19, written by Wave 5) lives there and
   * splitting the two ledgers across two screens is how a decision gets lost.
   */
  app.get("/api/admin/partner-billing/decisions", requireAdmin, (_req: Request, res: Response) => {
    try {
      const db = rawDb();
      const decisions = db
        .prepare(
          `SELECT id, item_id AS itemId, decision_key AS decisionKey, state, question, ruling,
                  rationale, source_ref AS sourceRef, owner_required AS ownerRequired,
                  recorded_at AS recordedAt, recorded_by AS recordedBy
             FROM build_policy_decision
            ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END, item_id ASC`,
        )
        .all()
        .map((r: any) => ({ ...r, ownerRequired: !!r.ownerRequired }));
      let percentPolicy: unknown[] = [];
      try {
        percentPolicy = db
          .prepare(
            `SELECT id, ruling_key AS rulingKey, ruling_status AS rulingStatus, notes,
                    ruling_source AS rulingSource, decided_at AS decidedAt
               FROM percent_policy_record
              WHERE ruling_status = 'open'
              ORDER BY id ASC`,
          )
          .all();
      } catch (err) {
        // The table is Wave 5's; if a deployment predates it the decision ledger
        // must still render. Reported, not swallowed.
        log.warn(`[wave14MoneyRoutes] percent_policy_record unreadable: ${(err as Error).message}`);
      }
      const open = decisions.filter((d: any) => d.state === "open");
      res.json({
        ok: true,
        decisions,
        openPercentPolicy: percentPolicy,
        openCount: open.length + percentPolicy.length,
        awaitingOwner: open.filter((d: any) => d.ownerRequired).map((d: any) => d.itemId),
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/partner-billing/decisions");
    }
  });

  /** CP-PROMO-07 / CP-PROMO-20 — the moderation queue, scope fields included. */
  app.get("/api/admin/partner-billing/promotions", requireAdmin, (req: Request, res: Response) => {
    try {
      const moderationState = typeof req.query.moderationState === "string" ? req.query.moderationState : undefined;
      const rows = listPromotions(moderationState ? { moderationState } : {});
      res.json({
        ok: true,
        promotions: rows,
        total: rows.length,
        /* `pending_review`, NOT `pending`: the schema's moderation enum is
           draft | pending_review | approved | rejected | changes_requested. A
           filter on "pending" silently returns zero rows — a green count that
           checks nothing. */
        pendingCount: listPromotions({ moderationState: "pending_review" }).length,
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/partner-billing/promotions");
    }
  });

  /**
   * CP-PROMO-20 — approve / reject / request changes.
   *
   * The schema's `CHECK (active = 0 OR moderation_state = 'approved')` means a
   * rejected promotion CANNOT be active, whatever any writer intends. So this
   * route cannot be bypassed into an active unapproved discount by a second
   * path — the fence is in the database. `moderatePromotion` additionally emits
   * one of the three EXISTING promotion event names (CP-PROMO-23); a new name
   * would be refused by `assertReusedEventName`.
   */
  app.post("/api/admin/partner-billing/promotions/:id/moderate", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : b.decision === "changes_requested" ? "changes_requested" : null;
      if (!decision) {
        return res.status(400).json({
          ok: false,
          error: "BAD_DECISION",
          message: "decision must be 'approved', 'rejected' or 'changes_requested'",
        });
      }
      const note = typeof b.note === "string" ? b.note : undefined;
      if (decision !== "approved" && (!note || note.trim().length < 5)) {
        // A rejection with no reason is unactionable for the partner who
        // authored the promotion. Required for the two negative decisions only.
        return res.status(400).json({ ok: false, error: "NOTE_REQUIRED", message: "A rejection or change request must carry a note." });
      }
      moderatePromotion(String(req.params.id), decision, actorOf(req), note);
      res.json({
        ok: true,
        promotionId: String(req.params.id),
        decision,
        events: listMoneyEvents("promotion", String(req.params.id)),
      });
    } catch (e) {
      fail(res, e, "POST /api/admin/partner-billing/promotions/:id/moderate");
    }
  });

  /** CP-PROMO-19 — record a grant, including the status it superseded. */
  app.post("/api/admin/partner-billing/promotions/:id/grant", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const partnerId = String(b.partnerId ?? "").trim();
      const applied = intOrNull(b.appliedDiscountMinor);
      if (!partnerId) return res.status(400).json({ ok: false, error: "PARTNER_ID_REQUIRED" });
      if (applied === null || applied < 0) {
        return res.status(400).json({ ok: false, error: "NON_INTEGER_MINOR", message: "appliedDiscountMinor must be a non-negative integer." });
      }
      const grantId = grantPromotion(String(req.params.id), partnerId, applied, {
        subscriptionId: typeof b.subscriptionId === "string" ? b.subscriptionId : undefined,
        grantedBy: actorOf(req),
        supersededStatus: typeof b.supersededStatus === "string" ? b.supersededStatus : undefined,
      });
      res.status(201).json({ ok: true, grantId });
    } catch (e) {
      fail(res, e, "POST /api/admin/partner-billing/promotions/:id/grant");
    }
  });

  /**
   * CP-COM-02 / CP-COM-04 / CP-COM-05 — issue a consolidated invoice.
   *
   * ONE invoice, MANY entry kinds, in ONE request, so the consolidation cannot
   * be half-created by a client that stops after the first line. Cent
   * conservation is asserted before the response: if the database triggers and
   * the lines disagree the request FAILS rather than returning an invoice that
   * does not add up.
   */
  app.post("/api/admin/partner-billing/invoices", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const partnerId = String(b.partnerId ?? "").trim();
      if (!partnerId) return res.status(400).json({ ok: false, error: "PARTNER_ID_REQUIRED" });
      const rawLines = Array.isArray(b.lines) ? (b.lines as Array<Record<string, unknown>>) : [];
      if (rawLines.length === 0) {
        return res.status(400).json({ ok: false, error: "LINES_REQUIRED", message: "An invoice with no lines is not an invoice." });
      }
      // Validate EVERY line before writing ANY of them: a partially written
      // invoice is worse than a rejected request.
      const lines: Array<{ entryKind: EntryKind; description: string; amountMinor: number; settlementState?: "pending" | "paid" | "waived" | "failed"; sourceRef?: string }> = [];
      /* An index loop, not `.entries()`: this tsconfig target makes iterating an
         array iterator a TS2802, and the wave's error budget is zero net-new. */
      for (let i = 0; i < rawLines.length; i += 1) {
        const l = rawLines[i];
        const entryKind = String(l.entryKind ?? "") as EntryKind;
        if (!BILLING_ENTRY_KINDS.includes(entryKind)) {
          return res.status(400).json({ ok: false, error: "BAD_ENTRY_KIND", message: `line ${i}: expected one of ${BILLING_ENTRY_KINDS.join(", ")}` });
        }
        const amountMinor = intOrNull(l.amountMinor);
        if (amountMinor === null) {
          return res.status(400).json({ ok: false, error: "NON_INTEGER_MINOR", message: `line ${i}: amountMinor must be an integer number of minor units.` });
        }
        const description = String(l.description ?? "").trim();
        if (!description) return res.status(400).json({ ok: false, error: "DESCRIPTION_REQUIRED", message: `line ${i}` });
        lines.push({
          entryKind,
          description,
          amountMinor,
          settlementState: l.settlementState === "paid" || l.settlementState === "waived" || l.settlementState === "failed" ? l.settlementState : "pending",
          sourceRef: typeof l.sourceRef === "string" ? l.sourceRef : undefined,
        });
      }
      const invoiceId = createInvoice({
        partnerId,
        invoiceNumber: typeof b.invoiceNumber === "string" ? b.invoiceNumber : undefined,
        currency: typeof b.currency === "string" ? b.currency : undefined,
        periodStart: typeof b.periodStart === "string" ? b.periodStart : undefined,
        periodEnd: typeof b.periodEnd === "string" ? b.periodEnd : undefined,
        subscriptionId: typeof b.subscriptionId === "string" ? b.subscriptionId : undefined,
      });
      for (const l of lines) addInvoiceLine({ invoiceId, ...l });
      const lineSumMinor = assertInvoiceConserved(invoiceId);
      res.status(201).json({ ok: true, invoice: getInvoice(invoiceId), lineSumMinor });
    } catch (e) {
      fail(res, e, "POST /api/admin/partner-billing/invoices");
    }
  });

  /**
   * CP-COM-04 — split a commission total across weights WITHOUT losing a cent.
   *
   * This is the route form of the rule that cost this build a live defect:
   * NEVER `Math.round` a per-party share independently. `splitCommissionMinor`
   * delegates to the shared allocator, whose comparator is
   * (remainder DESC, weight DESC, index ASC) — deterministic, and the shares sum
   * to the input EXACTLY. The response asserts that sum so a caller can see the
   * conservation rather than trust it.
   */
  app.post("/api/admin/partner-billing/commission-split", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const totalMinor = intOrNull(b.totalMinor);
      const weights = Array.isArray(b.weightsMinor) ? (b.weightsMinor as unknown[]).map((w) => Number(w)) : [];
      if (totalMinor === null || totalMinor < 0) {
        return res.status(400).json({ ok: false, error: "NON_INTEGER_MINOR", message: "totalMinor must be a non-negative integer." });
      }
      if (weights.length === 0 || weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
        return res.status(400).json({ ok: false, error: "BAD_WEIGHTS", message: "weightsMinor must be a non-empty array of non-negative integers." });
      }
      const shares = splitCommissionMinor(totalMinor, weights);
      const sum = shares.reduce((s, n) => s + n, 0);
      if (sum !== totalMinor) {
        // Unreachable if the allocator is correct — which is exactly why it is
        // checked here rather than assumed.
        return res.status(500).json({ ok: false, error: "SPLIT_NOT_CONSERVED", message: `shares sum to ${sum}, expected ${totalMinor}` });
      }
      res.json({ ok: true, totalMinor, weightsMinor: weights, shares, sum, conserved: true });
    } catch (e) {
      fail(res, e, "POST /api/admin/partner-billing/commission-split");
    }
  });

  /**
   * CP-SUB-11 — ADMIN ROSTER RECONCILE.
   *
   * SUB-11's promise is that the Dashboard, the partner's Billing page and the
   * admin roster agree. They are three reads of two tables, so they can only
   * disagree in specific, enumerable ways. This route enumerates them instead of
   * asserting agreement:
   *   · a partner with a live subscription row but no entitlement on the roster
   *   · a live subscription whose tier is UNPRICED for its cycle (so the amount
   *     came from the labelled ×12 fallback, not from an authored price)
   *   · a live subscription whose stored amount ≠ list − discount
   * The third is a cent-level integrity check on stored money and is the reason
   * this is a reconcile rather than a list.
   */
  app.get("/api/admin/partner-billing/roster-reconcile", requireAdmin, (_req: Request, res: Response) => {
    try {
      const db = rawDb();
      const live = db
        .prepare(
          `SELECT s.id, s.subject_id AS partnerId, s.tier_slug AS tierSlug, s.cycle, s.status,
                  s.amount_minor AS amountMinor, s.list_amount_minor AS listAmountMinor,
                  s.discount_minor AS discountMinor, s.price_derivation AS priceDerivation,
                  c.legal_name AS partnerName, c.status AS contactStatus
             FROM partner_subscription s
             LEFT JOIN contacts c ON c.id = s.subject_id
            WHERE s.subject_kind = 'partner'
              AND s.status IN ('pending','active','past_due','grace','grandfathered')
            ORDER BY s.created_at DESC`,
        )
        .all() as any[];
      const prices = listTierPrices();
      const findings: Array<{ kind: string; partnerId: string; subscriptionId: string; detail: string }> = [];
      for (const r of live) {
        if (!r.partnerName && !r.contactStatus) {
          findings.push({
            kind: "subscription_without_roster_row",
            partnerId: String(r.partnerId),
            subscriptionId: String(r.id),
            detail: "A live subscription exists for a subject with no contacts row. Entitlement without a roster entry.",
          });
        }
        const priceRow = prices.find((p) => p.tierSlug === r.tierSlug && p.cadence === r.cycle);
        if (!priceRow || priceRow.priceMinor === null) {
          findings.push({
            kind: "live_on_unpriced_tier",
            partnerId: String(r.partnerId),
            subscriptionId: String(r.id),
            detail: `tier ${r.tierSlug}/${r.cycle} has no authored price; the charged amount came from ${String(r.priceDerivation ?? "an unlabelled source")}.`,
          });
        }
        const list = r.listAmountMinor === null || r.listAmountMinor === undefined ? null : Number(r.listAmountMinor);
        if (list !== null && Number(r.amountMinor) !== list - Number(r.discountMinor ?? 0)) {
          findings.push({
            kind: "amount_not_list_minus_discount",
            partnerId: String(r.partnerId),
            subscriptionId: String(r.id),
            detail: `amount ${r.amountMinor} ≠ list ${list} − discount ${r.discountMinor ?? 0}`,
          });
        }
      }
      res.json({
        ok: true,
        liveCount: live.length,
        live,
        findings,
        reconciled: findings.length === 0,
        coverage: tierPriceCoverage(),
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/partner-billing/roster-reconcile");
    }
  });

  /** CP-SUB-15 — admin view of any subject's money events. */
  app.get("/api/admin/partner-billing/money-events", requireAdmin, (req: Request, res: Response) => {
    try {
      const partnerId = typeof req.query.partnerId === "string" ? req.query.partnerId : "";
      const subjectKind = typeof req.query.subjectKind === "string" ? req.query.subjectKind : "";
      const subjectId = typeof req.query.subjectId === "string" ? req.query.subjectId : "";
      if (partnerId) {
        const events = listMoneyEventsForPartner(partnerId, intOrNull(req.query.limit) ?? 200);
        return res.json({ ok: true, events, total: events.length, scope: { partnerId } });
      }
      if (subjectKind && subjectId) {
        const events = listMoneyEvents(subjectKind, subjectId);
        return res.json({ ok: true, events, total: events.length, scope: { subjectKind, subjectId } });
      }
      res.status(400).json({
        ok: false,
        error: "SCOPE_REQUIRED",
        message: "Supply partnerId, or subjectKind + subjectId. An unscoped money-event dump is not offered.",
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/partner-billing/money-events");
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * FE-16 — THE RENEWAL WORKER'S CONFIGURATION, IN THE PRODUCT.
   *
   * Sink: client/src/pages/admin/AdminFeesConsolidated.tsx, "Dunning schedule"
   * panel — which until this wave printed the four ENV VAR NAMES and the words
   * "hard-coded" as its answer to how renewal billing is controlled.
   *
   * The worker reads `collective_renewal_worker_config` on every sweep, so a
   * change here takes effect on the next poll without a restart.
   * ════════════════════════════════════════════════════════════════════ */
  app.get("/api/admin/collective/renewal-worker-config", requireAdmin, (_req: Request, res: Response) => {
    try {
      const cfg = renewalWorkerConfig();
      res.json({
        ok: true,
        config: cfg,
        /* Reported so an admin can SEE a divergence rather than discover it.
           The env var's raw value is echoed because "unset" and "0" behave
           differently and the difference matters when debugging. */
        envValue: process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED ?? null,
        running: cfg.enabled,
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/collective/renewal-worker-config");
    }
  });

  app.put("/api/admin/collective/renewal-worker-config", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const cur = renewalWorkerConfig();

      /* Every bound below is the SAME bound the migration's CHECK constraints
         enforce (0153:224-235). They are re-stated here so the admin gets a
         readable message instead of a raw SQLITE_CONSTRAINT — and the CHECK
         remains the actual fence, so a second writer cannot bypass it. */
      const bounded = (
        key: string,
        v: unknown,
        fallback: number,
        min: number,
        max: number,
      ): number | { error: string } => {
        if (v === undefined || v === null || v === "") return fallback;
        const n = Number(v);
        if (!Number.isSafeInteger(n) || n < min || n > max) {
          return { error: `${key} must be an integer between ${min} and ${max}` };
        }
        return n;
      };

      const poll = bounded("pollIntervalMs", b.pollIntervalMs, cur.pollIntervalMs, 1000, 86_400_000);
      const lead = bounded("leadWindowSec", b.leadWindowSec, cur.leadWindowSec, 0, 2_592_000);
      const maxFail = bounded("maxConsecutiveFailures", b.maxConsecutiveFailures, cur.maxConsecutiveFailures, 1, 100);
      const quiet = bounded("quietAfterWriteMin", b.quietAfterWriteMin, cur.quietAfterWriteMin, 0, 1440);
      for (const v of [poll, lead, maxFail, quiet]) {
        if (typeof v === "object") return res.status(400).json({ ok: false, error: "OUT_OF_RANGE", message: v.error });
      }

      const enabled = b.enabled === undefined ? cur.enabled : b.enabled === true || b.enabled === 1 || b.enabled === "1";
      const envOverrideAllowed =
        b.envOverrideAllowed === undefined
          ? cur.envOverrideAllowed
          : b.envOverrideAllowed === true || b.envOverrideAllowed === 1 || b.envOverrideAllowed === "1";

      rawDb()
        .prepare(
          `UPDATE collective_renewal_worker_config
              SET enabled = ?, poll_interval_ms = ?, lead_window_sec = ?,
                  max_consecutive_failures = ?, quiet_after_write_min = ?,
                  env_override_allowed = ?, updated_at = ?, updated_by = ?
            WHERE id = 'singleton'`,
        )
        .run(
          enabled ? 1 : 0,
          poll as number,
          lead as number,
          maxFail as number,
          quiet as number,
          envOverrideAllowed ? 1 : 0,
          new Date().toISOString(),
          actorOf(req),
        );

      const next = renewalWorkerConfig();
      res.json({
        ok: true,
        config: next,
        /* If the stored value and the effective value disagree, the response
           says so explicitly — an admin who just turned the worker OFF and is
           still being overridden by the environment must be told. */
        overridden: next.source === "env_override",
        envValue: process.env.COLLECTIVE_RENEWAL_WORKER_ENABLED ?? null,
        appliesAt: "next poll — the worker re-reads this row every sweep; no restart required",
      });
    } catch (e) {
      fail(res, e, "PUT /api/admin/collective/renewal-worker-config");
    }
  });

  /* ══════════════════════════════════════════════════════════════════════
   * W-9 — THE ADMIN READ THAT MAKES THE EXISTING WAIVE ROUTE REACHABLE.
   *
   * `POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive`
   * (server/spvEngineRoutes.ts:416) has existed since v25.49 and has ZERO client
   * callers — grep across client/src returns nothing. It is the only way to clear
   * the fail-closed fixed-fee block on an SPV, so a blocked SPV could not be
   * unblocked from anywhere in the product.
   *
   * The waive itself is NOT re-implemented here: a second writer to a fee
   * obligation is the last thing this needs. What was missing is a way for an
   * admin to SEE the obligations and their ids, because the only list route is
   * `GET /api/partner/me/spv/:spvId/fee-obligations`, scoped to one partner's own
   * SPVs. This is that read, and it is read-only.
   *
   * AdminPlatformFees.tsx was the obvious home and is DELIBERATELY UNROUTED
   * (client/src/App.tsx:952 records the ruling — restoring it would restore a
   * second writer for the application fee in the wrong unit). So the UI sink is
   * a tab on /admin/partner-billing-ops instead.
   *
   * Sink: client/src/pages/admin/AdminPartnerBillingOps.tsx, "SPV Fees" tab.
   * ════════════════════════════════════════════════════════════════════ */
  app.get("/api/admin/spv-fee-obligations", requireAdmin, (req: Request, res: Response) => {
    try {
      const onlyState = typeof req.query.state === "string" ? req.query.state : "";
      const spvs = spvEngineStore.adminListAll();
      const rows: any[] = [];
      for (const spv of spvs) {
        /* `listFeeObligations` is scoped by (partnerId, spvId) and verifies the
           SPV belongs to that partner, so it is called with the SPV's OWN sponsor
           — which is how an admin sees every partner's obligations without a new
           unscoped query being added to the store. */
        for (const ob of spvEngineStore.listFeeObligations(spv.sponsorPartnerId, spv.id)) {
          if (onlyState && ob.state !== onlyState) continue;
          rows.push({
            ...ob,
            spvName: (spv as any).name ?? null,
            sponsorPartnerId: spv.sponsorPartnerId,
            spvStatus: (spv as any).status ?? null,
          });
        }
      }
      /* Pending FIXED-fee funding obligations are the ones that block an SPV, so
         they are counted separately — the number an admin actually needs. */
      const blocking = rows.filter((r) => r.state === "pending" && r.timing === "funding");
      res.json({
        ok: true,
        obligations: rows,
        total: rows.length,
        blockingCount: blocking.length,
        states: Array.from(new Set(rows.map((r) => r.state))).sort(),
        waiveRoute: "POST /api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive",
      });
    } catch (e) {
      fail(res, e, "GET /api/admin/spv-fee-obligations");
    }
  });

  log.info("[wave14MoneyRoutes] registered 17 money routes (CP-SUB, CP-COM, CP-PROMO, FE-16)");
}
