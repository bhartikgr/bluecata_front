/**
 * v25.32 final A2 — Collective membership billing DETAIL (additive, read-only).
 *
 * Avi's payment-feedback requirement asks the collective member's billing
 * surface to show all five fields: (1) amount paid, (2) plan/tier, (3) payment
 * date, (4) validity/expiry date, (5) current status.
 *
 * The existing `GET /api/collective/membership/me` (in the SACRED
 * `collectiveBillingStore.ts`, which we must NOT modify — it FAILs the
 * formula-byte baseline as Avi-owned code) only returns tier / status /
 * currentPeriodEnd / cancelAtPeriodEnd. Rather than touch that sacred file, we
 * add this purely-additive supplementary endpoint that the MembershipPage
 * fetches alongside `/me` to enrich the card.
 *
 * Data sourcing (ALL DB-direct via rawDb(); NEVER from in-memory state):
 *   - tier, status, current_period_start, current_period_end
 *       → DB-direct from `collective_memberships_billing`
 *   - payment date
 *       → DB-direct from `collective_billing_events`: the most recent
 *         SUCCESSFUL payment event's `processed_at`. Falls back to
 *         `current_period_start` (the period anchor) when no event row exists.
 *   - amount + currency
 *       → NOT stored as columns on `collective_memberships_billing`. The paid
 *         amount is the tier's catalogue price (resolved client-side from the
 *         tiers query the page already loads), so this endpoint returns the
 *         tier + price id and the client maps tier → unitAmount/currency. This
 *         is FLAGGED in the v25.32 report as an Avi-alignment item (GPT-5.5
 *         #51): if Avi wants the EXACT charged amount persisted, a
 *         `paid_amount_minor` / `currency` column must be added to the billing
 *         row by the (sacred) billing store on webhook success.
 */

import type { Express, Request, Response } from "express";
import { rawDb } from "../db/connection";
import { log } from "./logger";

/** Stripe/Airwallex event types that represent a successful payment. */
const SUCCESS_EVENT_TYPES = [
  "invoice.paid",
  "checkout.session.completed",
  "payment_intent.succeeded",
];

interface MembershipDetailDTO {
  /** Billing row id. */
  id: string | null;
  /** Tier the member purchased (basic | standard | premium). */
  tier: string | null;
  /** Stripe/Airwallex price id, when known (lets the client map tier→amount). */
  priceId: string | null;
  /** Current subscription status. */
  status: string | null;
  /** ISO date the current paid period started (period anchor / fallback pay date). */
  currentPeriodStart: string | null;
  /** ISO date the membership expires / renews (Avi field 4 — validity). */
  currentPeriodEnd: string | null;
  /** ISO timestamp of the most recent successful payment (Avi field 3). */
  paymentDate: string | null;
  /** Whether the member has scheduled cancellation at period end. */
  cancelAtPeriodEnd: boolean;
}

/**
 * Convert an INTEGER epoch-seconds period column to an ISO string. The
 * `collective_memberships_billing` schema stores current_period_start/end as
 * INTEGER (epoch seconds, Stripe convention). Returns null when unset.
 */
function epochSecToIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n * 1000).toISOString();
  } catch {
    return null;
  }
}

export function registerCollectiveMembershipDetailRoutes(app: Express): void {
  /**
   * GET /api/collective/membership/detail?chapter_id=...
   *
   * Mounts under /api/collective, which is already gated by
   * `requireAuthenticated` (routes.ts). Returns the enriched 5-field billing
   * detail for the authenticated member's row in the requested chapter.
   *
   * v25.32 final — DB-direct read from collective_memberships_billing +
   * collective_billing_events; never reads from in-memory state.
   */
  app.get(
    "/api/collective/membership/detail",
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const chapterId = String(req.query.chapter_id ?? "").trim();

      try {
        const db: any = rawDb();

        // DB-direct: the member's own billing row (tenant-scoped by user_id +
        // chapter_id UNIQUE). When chapter_id is omitted, take the most recent.
        const billingRow: any = chapterId
          ? db
              .prepare(
                `SELECT id, tier, status, stripe_price_id,
                        current_period_start, current_period_end, cancel_at_period_end
                   FROM collective_memberships_billing
                  WHERE user_id = ? AND chapter_id = ? AND deleted_at IS NULL
                  ORDER BY updated_at DESC LIMIT 1`,
              )
              .get(userId, chapterId)
          : db
              .prepare(
                `SELECT id, tier, status, stripe_price_id,
                        current_period_start, current_period_end, cancel_at_period_end
                   FROM collective_memberships_billing
                  WHERE user_id = ? AND deleted_at IS NULL
                  ORDER BY updated_at DESC LIMIT 1`,
              )
              .get(userId);

        if (!billingRow) {
          return res.json({ ok: true, membership: null });
        }

        // DB-direct: most recent SUCCESSFUL payment event for this billing row.
        const placeholders = SUCCESS_EVENT_TYPES.map(() => "?").join(",");
        const payEvent: any = db
          .prepare(
            `SELECT processed_at, created_at
               FROM collective_billing_events
              WHERE billing_id = ? AND event_type IN (${placeholders})
              ORDER BY processed_at DESC LIMIT 1`,
          )
          .get(billingRow.id, ...SUCCESS_EVENT_TYPES);

        const currentPeriodStart = epochSecToIso(billingRow.current_period_start);
        const paymentDate =
          (payEvent?.processed_at as string | undefined) ??
          (payEvent?.created_at as string | undefined) ??
          currentPeriodStart ??
          null;

        const dto: MembershipDetailDTO = {
          id: billingRow.id ?? null,
          tier: billingRow.tier ?? null,
          priceId: billingRow.stripe_price_id ?? null,
          status: billingRow.status ?? null,
          currentPeriodStart,
          currentPeriodEnd: epochSecToIso(billingRow.current_period_end),
          paymentDate,
          cancelAtPeriodEnd: !!billingRow.cancel_at_period_end,
        };

        return res.json({ ok: true, membership: dto });
      } catch (err) {
        log.warn(
          "[collective/membership/detail] DB read failed:",
          (err as Error).message,
        );
        return res
          .status(500)
          .json({ ok: false, error: "membership_detail_read_failed" });
      }
    },
  );
}
