/**
 * Wave B1 (3a) addendum — read-only company attribution endpoint.
 *
 * Surfaces the originating Consortium Partner ("Led by …") for a company on the
 * FOUNDER surfaces (founder dashboard/company header + cap-table + round views),
 * WITHOUT touching the SACRED `/api/companies/:id/profile` endpoint in
 * profileStore.ts. This is a separate, additive GET the founder client fetches
 * alongside the profile.
 *
 * Resolution is READ-ONLY from the durable `consortium_links` attribution plus
 * the partner display-name resolver (the exact same values the Collective
 * profile shows). Returns `{ attributedPartner: { partnerId, name } | null }`.
 * The partner *company display name* is not privileged information — it is
 * already shown to Collective members — so this is guarded by requireAuth
 * (any authenticated user), matching the openness of the profile surface.
 *
 * SACRED: touches no sacred store; adds one route only (informational guard add).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { founderOwnedCompanyIds } from "./lib/tenantAuth";
import { partnerTeamStore } from "./partnerWorkspaceStore";
import { getListedCompanyIds } from "./collectiveInterestStore";
import { getConsortiumPartnerId } from "./consortiumLinkStore";
import { getConsortiumPartnerDisplayName } from "./adminContactsStore";
import { log } from "./lib/logger";

export function registerCompanyAttributionRoutes(app: Express): void {
  app.get("/api/companies/:id/attribution", requireAuth, (req: Request, res: Response) => {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) return res.status(400).json({ error: "companyId required" });
    try {
      const partnerId = getConsortiumPartnerId(id);
      if (!partnerId) return res.json({ attributedPartner: null });

      // AUTHORIZATION (fail-closed against IDOR): attribution for a NOT-yet-
      // published company is private. A caller may see it ONLY when they are
      //   (a) admin, OR
      //   (b) a founder/team member of THIS company, OR
      //   (c) a member of the LINKED Consortium Partner, OR
      //   (d) the company is actually published to the Collective (public).
      // Any other authenticated user (e.g. an unrelated investor) is NOT told
      // who leads a private company. Public Collective visibility continues to
      // be handled by the Collective profile surface itself.
      const ctx = getUserContext(req);
      const isAdmin = Boolean(ctx?.isAdmin);
      const ownsCompany = ctx ? founderOwnedCompanyIds(ctx).has(id) : false;
      let isLinkedPartnerMember = false;
      if (ctx?.userId) {
        try {
          const tm = partnerTeamStore.findByUserId(ctx.userId);
          isLinkedPartnerMember = Boolean(tm && tm.partnerId === partnerId);
        } catch { /* not a partner member */ }
      }
      let isPublic = false;
      try {
        isPublic = getListedCompanyIds().has(id);
      } catch { /* listing store unavailable — treat as private */ }

      if (!(isAdmin || ownsCompany || isLinkedPartnerMember || isPublic)) {
        // Do not leak existence/attribution — respond as if unattributed.
        return res.json({ attributedPartner: null });
      }

      const name = getConsortiumPartnerDisplayName(partnerId);
      return res.json({
        attributedPartner: name ? { partnerId, name } : null,
      });
    } catch (err) {
      log.warn("[companyAttributionRoutes] resolve failed:", (err as Error).message);
      // Read-only convenience surface — never fail the page over attribution.
      return res.json({ attributedPartner: null });
    }
  });
}
