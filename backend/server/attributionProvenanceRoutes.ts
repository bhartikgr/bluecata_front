/**
 * WAVE 33 · CP-PIPE-06 — routes that make the provenance rule VISIBLE.
 *
 * Enforcement alone is not shipping. A partner who is refused an attribution
 * needs to see WHY, and a partner whose own historical rows carry incomplete
 * provenance needs to know before someone else discovers it. An engine with no
 * route, or a rule enforced only at the moment of failure, is not a feature.
 *
 * Two routes, both READ-ONLY:
 *   GET /api/partner/me/attributions/provenance   — my rows and their integrity
 *   GET /api/partner/me/attributions/provenance/:companyId — can I claim this?
 *
 * The second answers the question BEFORE the write, so a partner learns a
 * company is already claimed by asking rather than by being rejected.
 *
 * DELIBERATELY NOT EXPOSED: the identity of the incumbent partner. A partner
 * asking about an arbitrary company id must not be able to enumerate which
 * competitor holds which company — that would turn a provenance check into a
 * portfolio-disclosure endpoint. The answer is that the company is claimed, not
 * by whom. An administrator adjudicating a displacement sees both sides through
 * the existing admin surface, where that disclosure is appropriate.
 *
 * All imports static.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { partnerAttributionStore } from "./partnerWorkspaceStore";
import {
  assessAdmission,
  assessExistingRow,
  PROVENANCE_SOURCES,
  isSelfServiceSource,
} from "./lib/attributionProvenance";

export function registerAttributionProvenanceRoutes(app: Express): void {
  /** My attributions, each with its provenance integrity stated. */
  app.get(
    "/api/partner/me/attributions/provenance",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext?.partnerId;
        if (!partnerId) return res.status(401).json({ error: "AUTH_REQUIRED" });

        const rows = partnerAttributionStore.listByPartner(partnerId, { includeRevoked: false });
        const assessed = rows.map((a) => {
          const integrity = assessExistingRow({
            attributionSource: a.attributionSource,
            attributedBy: a.attributedBy,
            attributedAt: a.attributedAt,
          });
          return {
            id: a.id,
            companyId: a.companyId,
            attributionSource: a.attributionSource,
            attributedBy: a.attributedBy,
            attributedAt: a.attributedAt,
            selfService: isSelfServiceSource(String(a.attributionSource)),
            intact: integrity.intact,
            issues: integrity.issues,
            copy: integrity.copy,
          };
        });

        const incomplete = assessed.filter((a) => !a.intact).length;
        res.json({
          attributions: assessed,
          total: assessed.length,
          incomplete,
          /* Server-authored summary. Note it is NOT "0 problems" when there are
             no rows at all — an empty list is not a clean bill of health, and
             saying so would be a check that passed while checking nothing. */
          summary:
            assessed.length === 0
              ? "No live attributions are recorded for this partner, so there is no provenance to report. This is not the same as provenance being complete."
              : incomplete === 0
                ? `All ${assessed.length} live attributions state how they arose, who made them and when.`
                : `${incomplete} of ${assessed.length} live attributions have incomplete provenance. They are shown as they stand rather than filled in — a supplied value would be indistinguishable from a recorded one.`,
          sources: PROVENANCE_SOURCES,
        });
      } catch {
        res.status(503).json({
          error: "PROVENANCE_UNAVAILABLE",
          message:
            "Attribution provenance could not be read just now. Nothing has been changed, and no status is shown rather than one that may be wrong.",
        });
      }
    },
  );

  /**
   * Pre-flight: would a claim on this company be admitted?
   *
   * Uses the SAME `assessAdmission` the store enforces with, so this cannot
   * tell a partner they may claim something the write will refuse.
   */
  app.get(
    "/api/partner/me/attributions/provenance/:companyId",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext?.partnerId;
        if (!partnerId) return res.status(401).json({ error: "AUTH_REQUIRED" });
        const companyId = String(req.params.companyId);

        const source = typeof req.query.source === "string" ? req.query.source : "partner_claim";

        /* Incumbents on the COMPANY, from any partner — the lookup that did not
           exist anywhere before this item. Revoked rows are excluded: a revoked
           claim is released, and treating it as live would freeze a company to
           whoever attributed it first, forever. */
        /* ALL live claims are passed, INCLUDING this partner's own.
           An earlier revision filtered the caller's own rows out before
           assessing, which made the engine see an unclaimed company and answer
           ADMIT — with copy stating "no other partner holds a live claim" — to
           a partner who already held it. The engine distinguishes
           ADMIT_ALREADY_HELD from ADMIT precisely so this route does not have
           to, and pre-filtering discarded the input it needed to do so. Caught
           by executing the route (case P3); every source-level assertion had
           passed. */
        const incumbents = partnerAttributionStore
          .listActiveByCompany(companyId)
          .map((a) => ({
            partnerId: a.partnerId,
            attributionSource: a.attributionSource,
            attributedAt: a.attributedAt,
          }));

        const assessment = assessAdmission({
          requestedPartnerId: partnerId,
          source,
          actor: req.partnerContext?.userId ?? "preflight",
          incumbents,
        });

        res.json({
          companyId,
          source,
          verdict: assessment.verdict,
          admit: assessment.admit,
          copy: assessment.copy,
          /* THE INCUMBENT'S IDENTITY IS NOT RETURNED — see the file header.
             Only whether one exists, which is what the asking partner needs. */
          contested: incumbents.some((i) => i.partnerId !== partnerId),
        });
      } catch {
        res.status(503).json({
          error: "PROVENANCE_UNAVAILABLE",
          message:
            "This company's attribution status could not be read just now. No verdict is shown rather than one that may be wrong.",
        });
      }
    },
  );
}
