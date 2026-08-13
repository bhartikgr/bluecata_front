/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — NAV ROUTES.
 *
 * Two surfaces onto the same computation, with two different authorization
 * postures — deliberately, because they answer different questions:
 *
 *   GP  `/api/partner/me/spv/:spvId/nav*`   the whole vehicle, every holding,
 *                                            the freeze history, plus the write
 *                                            that freezes a NAV.
 *   LP  `/api/investor/me/spv/:spvId/nav`    the vehicle-level number and THIS
 *                                            LP's own share of it. Never the
 *                                            register, never another LP.
 *
 * WHY THE LP ROUTE LIVES HERE AND NOT IN A NEW "LP" MODULE. Ruling A-23: a
 * parallel LP tree is a second door onto the same data, which is what already
 * blocks ORP-038, ORP-061 and FE-10. The LP route is the investor portal's
 * route, mounted on the investor identity the rest of the investor surfaces
 * already use (`getUserContext`), and the scoping is a data predicate, not a
 * separate app.
 *
 * LP PRIVACY (WAVE 29 / WAIVER-4). Wave 29 fixed a live exposure in which two
 * passive LPs in the same vehicle could discover each other. This is exactly
 * where that regresses, so:
 *   · the LP route derives the investor id from the SESSION and there is no
 *     parameter, query or body field on it that names an investor. There is
 *     nothing for a caller to tamper with, so LP A cannot ASK for LP B;
 *   · the response carries a single `own` position and no register at all —
 *     `lpOwnNavPosition` filters before returning, so no other LP's figure is
 *     ever serialised;
 *   · membership is verified against the committed register before anything is
 *     returned, matching the fail-closed `NOT_AN_LP` posture of
 *     `spvEngineStore.lpRosterForViewer` (spvEngineStore.ts:1560).
 *
 * CROSS-TENANT AND NON-MEMBER REFUSALS ARE 404, NOT 403 (rule 6). A 403 would
 * confirm the vehicle exists and turn the endpoint into an enumeration oracle
 * for other firms' SPVs. The refusal a non-LP receives for a real vehicle is
 * byte-identical to the refusal for an id that exists nowhere.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { spvEngineStore } from "./spvEngineStore";
import {
  deriveNav,
  deriveNavWithLpShares,
  lpOwnNavPosition,
  freezeNav,
  listFrozenNavs,
  latestFrozenNav,
  committedRegisterRows,
  spvBasics,
  SpvNavNotFoundError,
} from "./spvNavStore";
import { log } from "./lib/logger";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

function fail(res: Response, e: unknown): Response {
  if (e instanceof SpvNavNotFoundError) return res.status(404).json({ error: "SPV_NOT_FOUND" });
  log.warn(`[spvNavRoutes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

/**
 * Is this session identity a committed LP of this vehicle?
 *
 * Uses the SAME predicate as the register the NAV is allocated over
 * (`spv_subscription.status = 'committed'`), so a person can never be shown a
 * NAV share computed from a register they are not in.
 */
function isCommittedLp(spvId: string, investorId: string): boolean {
  return committedRegisterRows(spvId).some((r) => r.investorId === investorId);
}

export function registerSpvNavRoutes(app: Express): void {
  /* ── GP: live derived NAV for the whole vehicle ─────────────────────────── */
  app.get(
    "/api/partner/me/spv/:spvId/nav",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext!.partnerId;
        const spvId = String(req.params.spvId);
        // Partner scoping via the engine store, which returns null cross-partner.
        if (!spvEngineStore.getSpv(partnerId, spvId)) {
          return res.status(404).json({ error: "SPV_NOT_FOUND" });
        }
        const asOf = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
        const { nav, lpShares } = deriveNavWithLpShares(spvId, asOf);
        res.json({ nav, lpShares, frozen: latestFrozenNav(spvId) });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── GP: freeze history ─────────────────────────────────────────────────── */
  app.get(
    "/api/partner/me/spv/:spvId/nav/history",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext!.partnerId;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(partnerId, spvId)) {
          return res.status(404).json({ error: "SPV_NOT_FOUND" });
        }
        res.json({ snapshots: listFrozenNavs(spvId) });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── GP: freeze the current NAV ─────────────────────────────────────────
     A write, so it carries the house write gating: write sub-role AND a signed
     agreement. The signer is taken from the session and stored on the row —
     a frozen NAV is a governance artifact and an unattributed one is worthless
     in diligence. */
  app.post(
    "/api/partner/me/spv/:spvId/nav/freeze",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ctx = req.partnerContext!;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) {
          return res.status(404).json({ error: "SPV_NOT_FOUND" });
        }
        const body = (req.body ?? {}) as { asOfDate?: string };
        const snapshot = freezeNav({
          spvId,
          asOfDate: typeof body.asOfDate === "string" && body.asOfDate ? body.asOfDate : undefined,
          frozenBy: String(ctx.userId ?? ""),
        });
        res.status(201).json({ snapshot });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── LP: the vehicle NAV and THIS LP's own share, and nothing else ──────── */
  app.get(
    "/api/investor/me/spv/:spvId/nav",
    (req: Request, res: Response) => {
      const ctx = getUserContext(req);
      if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
      const spvId = String(req.params.spvId);
      try {
        // Existence and membership collapse into ONE refusal. A non-member must
        // not be able to distinguish "this vehicle is not yours" from "no such
        // vehicle" — that difference is the enumeration oracle.
        if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {
          return res.status(404).json({ error: "SPV_NOT_FOUND" });
        }
        const { nav, own } = lpOwnNavPosition(spvId, ctx.userId);
        // The vehicle-level figure an LP is entitled to, WITHOUT the register.
        res.json({
          spvId,
          asOfDate: nav.asOfDate,
          currency: nav.currency,
          status: nav.status,
          totalNavMinor: nav.totalNavMinor,
          worstMarkBadge: nav.worstMarkBadge,
          markedHoldings: nav.markedHoldings,
          unmarkedHoldings: nav.unmarkedHoldings,
          refusalCopy: nav.refusalCopy,
          thresholds: nav.thresholds,
          own,
        });
      } catch (e) { fail(res, e); }
    },
  );
}

/** Exported for the falsification harness, which asserts the predicate directly. */
export const __navRouteInternals = { isCommittedLp, deriveNav };
