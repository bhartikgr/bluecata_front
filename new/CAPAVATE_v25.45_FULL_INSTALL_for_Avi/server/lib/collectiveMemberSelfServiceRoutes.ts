/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 *
 * collectiveMemberSelfServiceRoutes — NEW member-facing endpoints for the
 * Collective Payment Model. QUOTE-ONLY: these endpoints resolve and display
 * what a member WOULD owe and list their existing ledger entries / invoices.
 * They DO NOT activate checkout and DO NOT charge any card. Activation of a
 * real payment flow is deliberately OUT OF SCOPE (mirrors v25.33's quote-only
 * PartnerSubscribe), so Avi's payment write paths (paymentGatewayAdapter.ts)
 * and the SACRED collectiveBillingStore.ts are never touched.
 *
 * Endpoints (all gated requireCollectiveMember):
 *   GET /api/collective/me/payment-quote   — resolve all fee kinds for the
 *        signed-in member via collectivePaymentResolver (3-level precedence).
 *   GET /api/collective/me/payment-entries — the member's own ledger entries.
 *   GET /api/collective/me/invoices        — the member's own invoices.
 *
 * Every value comes from the DB (rawDb()) or the resolver; nothing is hardcoded.
 * Money is integer minor units. Reads are side-effect-free.
 */
import type { Express, Request, Response } from "express";
import { requireCollectiveMember } from "./requireCollectiveMember";
import { rawDb } from "../db/connection";
import {
  quoteAllCollectiveFees,
  type CollectiveTier,
} from "./collectivePaymentResolver";
import { sanitizeErrorMessage } from "./sanitize";

function memberIdOf(req: Request): string | null {
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  return ctx?.userId ?? null;
}

/**
 * v25.35 Phase 3 #17 — sentinel thrown by memberTierOf when the member's tier
 * cannot be read from the DB. Previously memberTierOf swallowed the DB error
 * and defaulted to 'basic', which silently mis-quoted a premium member at the
 * basic rate (a financial-integrity defect). We now fail closed: the caller
 * route translates this into 409 `tier_unavailable` rather than charging/
 * quoting a wrong amount off a fabricated default.
 */
class TierUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TierUnavailableError";
  }
}

/**
 * Resolve the signed-in member's tier from collective_memberships_billing
 * (most recent active row). DB-direct; no cache.
 *
 * v25.35 Phase 3 #17 — fail-closed semantics:
 *   - DB read error                  -> throw TierUnavailableError (route -> 409)
 *   - billing row present + valid tier -> that tier
 *
 * v25.35 fix-2 (Concern 2) — two defects closed here:
 *   1. NO billing row no longer fabricates 'basic'. The billing table is the
 *      authority for what a member is charged; quoting a member with no billing
 *      row at the basic rate silently mis-quotes a member whose billing has not
 *      been provisioned. We now throw TierUnavailableError (route -> 409
 *      tier_unavailable) instead of inventing a tier.
 *   2. The query is now scoped to (user_id, chapter_id). The billing table is
 *      keyed UNIQUE(user_id, chapter_id) (migrations/0032), and a multi-chapter
 *      member could otherwise be quoted off the wrong chapter's billing row.
 *      The caller resolves the chapter FIRST and passes it here.
 */
function memberTierOf(memberId: string, chapterId: string | null): CollectiveTier {
  let row: { tier?: string } | undefined;
  try {
    // v25.35 fix-3 (Concern 2, GPT-5.5 strict re-verify) — REQUIRE status='active'
    // in the WHERE clause. The previous query only sorted active rows first;
    // when no active row existed, a cancelled / past_due / paused billing row
    // could still supply a tier and produce a misleading quote. Now we only
    // consider active billing rows; cancelled/past_due rows fail-closed via
    // TierUnavailableError so the member is never quoted off lapsed billing.
    row = rawDb()
      .prepare(
        `SELECT tier FROM collective_memberships_billing
         WHERE user_id = ? AND chapter_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(memberId, chapterId) as { tier?: string } | undefined;
  } catch (err) {
    // DB unavailable / read failure — do NOT fabricate a tier. Fail closed.
    throw new TierUnavailableError((err as Error).message ?? "tier read failed");
  }
  const t = row?.tier;
  if (t === "basic" || t === "standard" || t === "premium") return t;
  // v25.35 fix-2 (Concern 2) — NO active billing row for (user_id, chapter_id):
  // fail closed rather than fabricating 'basic'. The route returns 409
  // tier_unavailable so the member is never quoted off an invented tier.
  throw new TierUnavailableError("no active billing row for member/chapter");
}

/**
 * v25.35 Phase 3 #16 — resolve the signed-in member's chapter from their active
 * collective membership so the payment resolver can prefer chapter-specific
 * schedule rows. Returns null when no chapter can be determined (resolver then
 * uses global rows only). Read errors degrade to null (the quote still works
 * off global rows) — a missing chapter is not a financial-integrity hazard the
 * way a wrong tier is, so this read stays soft.
 */
function memberChapterOf(memberId: string): string | null {
  try {
    const row = rawDb()
      .prepare(
        `SELECT chapter_id AS chapterId FROM collective_memberships
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY (status = 'active') DESC, updated_at DESC LIMIT 1`,
      )
      .get(memberId) as { chapterId?: string } | undefined;
    return row?.chapterId ?? null;
  } catch {
    return null;
  }
}

export function registerCollectiveMemberSelfServiceRoutes(app: Express): void {
  /* ==========================================================
   * GET /api/collective/me/payment-quote — QUOTE-ONLY.
   * Resolves every fee kind for the signed-in member through the 3-level
   * precedence resolver and returns the line items. No charge occurs.
   * ========================================================== */
  app.get("/api/collective/me/payment-quote", requireCollectiveMember, (req: Request, res: Response) => {
    const memberId = memberIdOf(req);
    if (!memberId) return res.status(401).json({ ok: false, error: "missing_identity" });
    try {
      // v25.35 fix-2 (Concern 2) — resolve the chapter FIRST so the tier lookup
      // is scoped to the correct (user_id, chapter_id) billing row. Previously
      // the tier was read chapter-agnostically, which could quote a multi-chapter
      // member off the wrong chapter's billing row.
      const chapterId = memberChapterOf(memberId);
      // v25.35 Phase 3 #17 / fix-2 — fail-closed on tier read failure AND on a
      // missing billing row (no fabricated 'basic').
      let tier: CollectiveTier;
      try {
        tier = memberTierOf(memberId, chapterId);
      } catch (tierErr) {
        if (tierErr instanceof TierUnavailableError) {
          return res.status(409).json({
            ok: false,
            error: "tier_unavailable",
            message: "Your membership tier could not be determined right now. Please retry shortly.",
          });
        }
        throw tierErr;
      }
      // v25.35 Phase 3 #16 — pass the caller's chapter so chapter-specific
      // schedule rows take precedence over global defaults.
      const lines = quoteAllCollectiveFees(memberId, tier, { chapterId });
      // Group quoted (resolvable) amounts by currency so the UI can show
      // multi-currency totals without summing across currencies.
      const byCurrency: Record<string, number> = {};
      for (const line of lines) {
        if (line.resolved) {
          const cur = line.resolved.currency || "USD";
          byCurrency[cur] = (byCurrency[cur] || 0) + line.resolved.amountMinor;
        }
      }
      res.json({
        ok: true,
        quoteOnly: true,
        tier,
        lines,
        byCurrency,
        note: "Quote only. No payment is collected by this endpoint.",
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: "quote_failed", message: sanitizeErrorMessage(err) });
    }
  });

  /* ==========================================================
   * GET /api/collective/me/payment-entries — the member's own ledger.
   * ========================================================== */
  app.get("/api/collective/me/payment-entries", requireCollectiveMember, (req: Request, res: Response) => {
    const memberId = memberIdOf(req);
    if (!memberId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const rows = rawDb()
      .prepare(
        `SELECT id, entry_kind AS entryKind, amount_minor AS amountMinor, currency, status,
                invoice_id AS invoiceId, description, period, created_at AS createdAt, paid_at AS paidAt
         FROM collective_payment_entries
         WHERE member_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(memberId) as any[];
    const byCurrency: Record<string, { pending: number; paid: number; invoiced: number }> = {};
    for (const e of rows) {
      const cur = e.currency || "USD";
      const b = byCurrency[cur] || (byCurrency[cur] = { pending: 0, paid: 0, invoiced: 0 });
      const amt = e.amountMinor || 0;
      if (e.status === "paid") b.paid += amt;
      else if (e.status === "invoiced") b.invoiced += amt;
      else if (e.status === "pending") b.pending += amt;
    }
    res.json({ ok: true, entries: rows, byCurrency, total: rows.length });
  });

  /* ==========================================================
   * GET /api/collective/me/invoices — the member's own invoices.
   * ========================================================== */
  app.get("/api/collective/me/invoices", requireCollectiveMember, (req: Request, res: Response) => {
    const memberId = memberIdOf(req);
    if (!memberId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const rows = rawDb()
      .prepare(
        `SELECT id, number, status, total_minor AS totalMinor, currency,
                issued_at AS issuedAt, due_at AS dueAt, paid_at AS paidAt, created_at AS createdAt
         FROM collective_invoices
         WHERE member_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all(memberId) as any[];
    res.json({ ok: true, invoices: rows, total: rows.length });
  });
}
