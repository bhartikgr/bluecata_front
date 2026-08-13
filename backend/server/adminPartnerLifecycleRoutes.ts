/**
 * WAVE 7 AD-1 / AD-2 — admin partner lifecycle READ surface.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * AD-1 names twelve admin lifecycle endpoints in `server/partnerRoutes.ts`
 * (207, 255, 296, 410, 434, 459, 478, 592, 628, 1136, 1141, 1257 — every one of
 * those line citations was re-verified against the tree before this file was
 * written; all twelve were EXACT). All twelve are WRITE or narrow-read actions,
 * and grep across `client/src` found ZERO callers for the seat report, the
 * attribution pair and the partner-referral trio. They are engines with no
 * route into the UI, which this project counts as not delivered.
 *
 * Building the admin UI needs one thing the server does not currently expose:
 * a READ of a partner's attributions. `partnerAttributionStore.listByPartner`
 * exists (partnerWorkspaceStore.ts:1902) but is only reachable from the
 * partner-side access check at partnerRoutes.ts:824. Without a read, the AD-2
 * DELETE has nothing to render a delete button next to — which is exactly why
 * AD-2's "no client call site" is not a bug in the DELETE route but a missing
 * surface.
 *
 * SCOPE FENCE: this file is READ-ONLY plus the AD-3 promotion-grant ledger. It
 * registers no route that changes a partner's tier, status or permissions —
 * those all remain in partnerRoutes.ts where they already are, so this wave
 * adds no second write path to partner lifecycle state.
 *
 * SECOND-PATH CHECK: `grep -rn "admin/partners/:id/attributions" server/` finds
 * partnerRoutes.ts:592 (POST) and :628 (DELETE) only — no other GET, and no
 * other module reads partner_attributions for an admin caller.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import {
  partnerAttributionStore,
  partnerTeamStore,
  partnerDealPromotionsStore,
} from "./partnerWorkspaceStore";
import { getAllContacts } from "./adminContactsStore";
import { log } from "./lib/logger";

/** Shape returned to the admin console for one attribution row. */
type AdminAttributionRow = {
  companyId: string;
  companyName: string | null;
  attributionSource: string;
  notes: string | null;
  attributedAt: string | null;
  revokedAt: string | null;
};

export function registerAdminPartnerLifecycleRoutes(app: Express): void {
  /**
   * AD-1 / AD-2 — the attribution roster for one partner.
   *
   * Includes revoked rows so the admin can see what was removed; the client
   * renders them struck through rather than hiding them (nothing silently
   * disappears from the UI when an admin revokes).
   */
  app.get(
    "/api/admin/partners/:id/attributions",
    requireAdmin,
    (req: Request, res: Response) => {
      const partnerId = String(req.params.id);
      if (!partnerId) return res.status(400).json({ error: "partner_id_required" });
      try {
        const rows = partnerAttributionStore.listByPartner(partnerId, {
          includeRevoked: true,
        });
        /* One pass over contacts, not one lookup per row. */
        const contactsById = new Map(getAllContacts().map((c) => [c.id, c]));
        const out: AdminAttributionRow[] = rows.map((a) => {
          /* Resolve the company display name through the same contacts store
             the rest of the admin console uses, so a renamed company renders
             its current name rather than a stale copy. DB-driven; nothing
             cached in this module. */
          const companyName =
            contactsById.get(a.companyId)?.displayName ??
            contactsById.get(a.companyId)?.legalName ??
            null;
          return {
            companyId: a.companyId,
            companyName,
            attributionSource: String(a.attributionSource),
            notes: a.notes ?? null,
            attributedAt: a.attributedAt ?? null,
            revokedAt: a.revokedAt ?? null,
          };
        });
        return res.json({ ok: true, partnerId, attributions: out });
      } catch (err) {
        log.warn(
          "[admin.partners.attributions] read failed:",
          (err as Error).message,
        );
        return res.status(500).json({ error: "attribution_read_failed" });
      }
    },
  );

  /**
   * AD-1 — one partner's seat report.
   *
   * `GET /api/admin/partners/seat-report` (partnerRoutes.ts:207) returns the
   * report for EVERY partner, which is the right shape for the operations
   * roster but a needless full-table read when the admin is looking at a single
   * partner's detail page. Same store method (`partnerTeamStore.seatReport`),
   * so the two can never disagree — the failure mode where a detail page and a
   * roster show different seat counts (FE-17) is structurally impossible here.
   */
  app.get(
    "/api/admin/partners/:id/seat-report",
    requireAdmin,
    (req: Request, res: Response) => {
      const partnerId = String(req.params.id);
      if (!partnerId) return res.status(400).json({ error: "partner_id_required" });
      try {
        const report = partnerTeamStore.seatReport(partnerId);
        return res.json({ ok: true, partnerId, ...report });
      } catch (err) {
        log.warn("[admin.partners.seatReport] failed:", (err as Error).message);
        return res.status(500).json({ error: "seat_report_failed" });
      }
    },
  );

  /* AD-1 ROSTER — NOT BUILT HERE, DELIBERATELY.
     A roster route was drafted for this file and then DELETED after grep:
     `GET /api/admin/partners` ALREADY EXISTS at
     server/lib/partnerFeeAdminRoutes.ts:200 and already backs
     client/src/pages/admin/Partners.tsx:88-90 (with status + query filters).
     Registering a second one here would have SHADOWED it depending on
     registration order — precisely the "second path to the same read" this
     wave is meant to catch. The roster is WIRED, not built. */

  /**
   * AD-4 — admin partner funnel metrics.
   *
   * Every number below is COMPUTED FROM THE LIVE STORES on each request. There
   * is no metrics table, no cache and no counter incremented at write time,
   * because a counter is a second write path that silently drifts from the rows
   * it claims to count.
   */
  app.get(
    "/api/admin/partners/metrics/funnel",
    requireAdmin,
    (_req: Request, res: Response) => {
      try {
        const partners = getAllContacts().filter(
          (c) => c.kind === "consortium_partner",
        );
        const byStatus: Record<string, number> = {};
        const byTier: Record<string, number> = {};
        let seatsUsed = 0;
        let seatsLimit = 0;
        for (const p of partners) {
          const s = String(p.status ?? "unknown");
          byStatus[s] = (byStatus[s] ?? 0) + 1;
          const t = String((p as { tier?: string | null }).tier ?? "unassigned");
          byTier[t] = (byTier[t] ?? 0) + 1;
          try {
            const r = partnerTeamStore.seatReport(p.id) as {
              activeSeats?: number;
              seatLimit?: number | null;
            };
            seatsUsed += Number(r.activeSeats ?? 0);
            if (typeof r.seatLimit === "number") seatsLimit += r.seatLimit;
          } catch {
            /* a partner with no team yet contributes zero, not an error */
          }
        }
        /* Referral funnel — the promotions store is the only source; the
           pending count here and the queue rendered by AD-1 are the SAME
           call, so the badge can never claim a number the list does not show. */
        const pendingReferrals =
          partnerDealPromotionsStore.listPendingCapavateReferrals().length;
        return res.json({
          ok: true,
          computedAt: new Date().toISOString(),
          totalPartners: partners.length,
          byStatus,
          byTier,
          seatsUsed,
          seatsLimit,
          pendingReferrals,
        });
      } catch (err) {
        log.warn("[admin.partners.metrics] failed:", (err as Error).message);
        return res.status(500).json({ error: "metrics_failed" });
      }
    },
  );
}
