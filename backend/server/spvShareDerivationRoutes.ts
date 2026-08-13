/**
 * WAVE 33 · CP-SPV-31 — share-derivation route for the deployment ladder.
 *
 * ONE route. It reads a real deployment and the real round it points at, and
 * returns the derived share count (or a stated refusal) plus the deployment's
 * own lifecycle position, so the client never has to infer either.
 *
 * PARTNER-SCOPED FROM THE SESSION. `partnerId` comes from `req.partnerContext`,
 * never from the URL or body, so a GP cannot ask about a vehicle they do not
 * sponsor by editing an id. A deployment that does not belong to the caller's
 * partner is a 404 byte-identical to a deployment id that does not exist —
 * cross-tenant refusals are 404, never 403, because a 403 confirms the row is
 * there.
 *
 * READ-ONLY. This route derives and states; it never advances, commits, or
 * writes anything. The money path is unchanged.
 *
 * All imports are static (Wave 32B: a lazy `require` that threw was swallowed
 * into `[]`, dead in dev and live in the bundle).
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { spvEngineStore } from "./spvEngineStore";
import { getRoundsForCompany } from "./roundsStore";
import { deriveShares, describeShareDivergence } from "./lib/spvShareDerivation";

/** Byte-identical refusal for "not yours" and "not there". */
const NOT_FOUND = { error: "DEPLOYMENT_NOT_FOUND" } as const;

/**
 * The rungs the SERVER accepts, in order, with the copy the GP is shown.
 *
 * This is exported to the client through the route rather than duplicated in
 * the component, because the previous UI omitted `docs_sent` entirely: the
 * store accepts `"founder_confirmed" | "docs_sent" | "wired"` and the panel
 * rendered controls for only two of the three, so one rung of a three-rung
 * ladder was unreachable from the product. Deriving the list from the server
 * means the UI cannot silently fall behind the store again.
 */
const LADDER = [
  {
    to: "founder_confirmed",
    label: "Mark founder-confirmed",
    hint: "The founder has confirmed they will accept this allocation. Required before the wire.",
  },
  {
    to: "docs_sent",
    label: "Mark closing docs sent",
    hint: "Closing documents have gone to the company. Record the document reference alongside — it is the typed provenance for this deployment.",
  },
  {
    to: "wired",
    label: "Mark wired",
    hint: "Money has actually moved. A real wire payment reference is mandatory and is re-checked before the cap-table ledger write.",
  },
] as const;

export function registerSpvShareDerivationRoutes(app: Express): void {
  app.get(
    "/api/partner/me/spv/:spvId/deployments/:depId/share-derivation",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext?.partnerId;
        if (!partnerId) return res.status(401).json({ error: "AUTH_REQUIRED" });
        const spvId = String(req.params.spvId);
        const depId = String(req.params.depId);

        // Partner-scoped lookup. `getSpv` and `listDeployments` are both
        // partner-scoped already, so a vehicle belonging to someone else
        // resolves to nothing here rather than being filtered afterwards.
        if (!spvEngineStore.getSpv(partnerId, spvId)) {
          return res.status(404).json(NOT_FOUND);
        }
        const dep = spvEngineStore.listDeployments(partnerId, spvId).find((d) => d.id === depId);
        if (!dep) return res.status(404).json(NOT_FOUND);

        // The round is read fresh rather than taken from the deployment: the
        // price may have been set or corrected since the deployment was
        // created, and the figure the GP is shown must reflect the round as it
        // is now, not as it was.
        const round = getRoundsForCompany(dep.companyId).find((r) => r.id === dep.companyRoundId);
        const derivation = deriveShares({
          amountMinor: dep.amountMinor,
          currency: dep.currency,
          pricePerShare: round?.pricePerShare ?? null,
        });

        const typed = typeof req.query.shares === "string" ? req.query.shares : "";
        const divergence = typed ? describeShareDivergence(typed, derivation) : null;

        res.json({
          deploymentId: dep.id,
          status: dep.status,
          amountMinor: dep.amountMinor,
          currency: dep.currency,
          committed: Boolean(dep.capTableLedgerRef),
          founderConfirmedAt: dep.founderConfirmedAt,
          wiredAt: dep.wiredAt,
          wirePaymentRef: dep.wirePaymentRef,
          closingDocRef: dep.closingDocRef,
          roundFound: Boolean(round),
          derivation,
          divergence,
          ladder: LADDER,
        });
      } catch {
        // A read that cannot be completed says so. It does not return a share
        // count of 0, which would be a claim that the money bought nothing.
        res.status(503).json({
          error: "SHARE_DERIVATION_UNAVAILABLE",
          message:
            "The share derivation could not be read just now. Nothing has been changed, and no figure is shown rather than a figure that may be wrong.",
        });
      }
    },
  );
}
