/**
 * WAVE 30 · ENGINE 2 — routes for the `partner_company_relationship` spine.
 *
 * Base: `/api/partner/me/relationships*`. Deliberately distinct from
 * `/api/partner/me/clients*` (attributions only) and `/api/partner/me/portfolio*`
 * — the spine is the UNION across all four surfaces, not any one of them, so it
 * gets its own noun rather than being bolted onto an existing one.
 *
 * FAIL-CLOSED isolation: `partnerId` always comes from `req.partnerContext`
 * (session-derived), never from the URL or the body. There is no route on this
 * module that accepts a partner id as input, so there is nothing for a caller to
 * tamper with.
 *
 * Cross-tenant refusals are **404, not 403**. Spine ids are DERIVED
 * (`pcr_<partnerId>|<companyId>`) rather than random, so a 403 would let a caller
 * confirm guessed partner/company pairings and map out which firms work with
 * which companies. See the note on `getRelationship` in the store.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import {
  listRelationshipsForPartner,
  getRelationship,
  surfaceBreakdown,
  reconcilePartner,
  PcrNotFoundError,
  PcrValidationError,
  PCR_SURFACE_LABELS,
} from "./partnerCompanyRelationshipStore";
import { log } from "./lib/logger";

function partnerIdOf(req: Request): string {
  const ctx = (req as any).partnerContext as { partnerId?: string } | undefined;
  return String(ctx?.partnerId ?? "");
}

function actorOf(req: Request): string {
  return String((req as any).userContext?.userId ?? (req as any).userId ?? "");
}

/** Single error mapping so no handler can invent its own status for these. */
function fail(res: Response, err: unknown): void {
  if (err instanceof PcrNotFoundError) {
    // 404 by design — see the module header. Not a 403.
    res.status(404).json({ error: "NOT_FOUND", message: err.message });
    return;
  }
  if (err instanceof PcrValidationError) {
    res.status(400).json({ error: "VALIDATION_ERROR", message: err.message });
    return;
  }
  log.error("[pcrRoutes] unexpected error:", (err as Error)?.message);
  res.status(500).json({ error: "INTERNAL_ERROR" });
}

export function registerPartnerCompanyRelationshipRoutes(app: Express): void {
  /* Reads: any authenticated member of the partner org. Not agreement-gated —
     reading your own firm's relationship map is not a privileged action, and the
     house convention is that reads are never behind requireSignedAgreement. */
  app.get("/api/partner/me/relationships", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const partnerId = partnerIdOf(req);
      res.json({
        relationships: listRelationshipsForPartner(partnerId),
        breakdown: surfaceBreakdown(partnerId),
        surfaceLabels: PCR_SURFACE_LABELS,
      });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/partner/me/relationships/:pcrId", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      res.json({ relationship: getRelationship(partnerIdOf(req), String(req.params.pcrId)) });
    } catch (err) {
      fail(res, err);
    }
  });

  /**
   * Reconcile — the repair path for everything migration 0136's one-shot
   * backfill could not see, i.e. every surface row created after it ran.
   *
   * It is a POST because it writes, and it is write-gated even though it only
   * ever ADDS derived rows: it is a bulk operation over the firm's whole
   * relationship graph, and a viewer should not be able to trigger bulk writes.
   * Scoped to the caller's own partner — there is no all-partners variant.
   */
  app.post(
    "/api/partner/me/relationships/reconcile",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const partnerId = partnerIdOf(req);
        const result = reconcilePartner(partnerId);
        log.info(
          `[pcrRoutes] reconcile partner=${partnerId} by=${actorOf(req)} ` +
            `scanned=${result.scanned} created=${result.relationshipsCreated} presence=${result.presenceRecorded}`,
        );
        res.json({
          ...result,
          relationships: listRelationshipsForPartner(partnerId),
          breakdown: surfaceBreakdown(partnerId),
        });
      } catch (err) {
        fail(res, err);
      }
    },
  );
}
