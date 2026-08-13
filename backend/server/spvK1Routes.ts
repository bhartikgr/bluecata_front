/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 3 — K-1 ROUTES.
 *
 *   GP  GET  /api/partner/me/spv/:spvId/k1?taxYear=YYYY     derive (live preview)
 *       GET  /api/partner/me/spv/:spvId/k1/stored           persisted statements
 *       POST /api/partner/me/spv/:spvId/k1/generate         write drafts
 *       POST /api/partner/me/spv/:spvId/k1/:k1Id/issue      issue a draft
 *   LP  GET  /api/investor/me/spv/:spvId/k1                 THIS LP's ISSUED K-1s
 *
 * NO SEPARATE LP APP (ruling A-23). The LP route is an investor-portal route on
 * the investor identity the rest of the investor surfaces already use; scoping
 * is a DATA PREDICATE, not a second auth surface.
 *
 * LP PRIVACY (WAVE 29 / WAIVER-4). A K-1 is the most sensitive per-LP artifact
 * in the vehicle: it states one partner's capital, income and carry. So:
 *   · the investor id comes from the SESSION; the LP route has no parameter,
 *     query or body field naming an investor, so there is nothing to tamper
 *     with and LP A cannot ask for LP B;
 *   · the store scopes by `investor_id` in the SQL, so no other LP's row is
 *     ever loaded into a variable this handler can reach;
 *   · membership is checked against the same committed register the statements
 *     are derived over, fail-closed;
 *   · a non-member gets 404 — byte-identical to the refusal for a vehicle that
 *     does not exist (rule 6: 404, not 403, so there is no enumeration oracle).
 *
 * DRAFTS NEVER REACH AN LP. `lpOwnStoredK1s` filters to `status = 'issued'`.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { spvEngineStore } from "./spvEngineStore";
import { spvBasics, committedRegisterRows } from "./spvNavStore";
import {
  deriveK1s,
  generateK1Drafts,
  issueK1,
  listK1s,
  lpOwnStoredK1s,
  SpvK1NotFoundError,
} from "./spvK1Store";
import { log } from "./lib/logger";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

function fail(res: Response, e: unknown): Response {
  if (e instanceof SpvK1NotFoundError) return res.status(404).json({ error: "SPV_NOT_FOUND" });
  log.warn(`[spvK1Routes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

/**
 * A tax year, or a refusal. Never a default: silently filing against "this
 * year" because the caller sent nothing usable is how a statement ends up
 * attached to the wrong period.
 */
function parseTaxYear(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1900 || n > 2999) return null;
  return n;
}

function isCommittedLp(spvId: string, investorId: string): boolean {
  return committedRegisterRows(spvId).some((r) => r.investorId === investorId);
}

export function registerSpvK1Routes(app: Express): void {
  /* ── GP: live derivation for a year ─────────────────────────────────────── */
  app.get("/api/partner/me/spv/:spvId/k1", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const partnerId = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId);
      if (!spvEngineStore.getSpv(partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const taxYear = parseTaxYear(req.query.taxYear);
      if (taxYear === null) return res.status(400).json({ error: "TAX_YEAR_REQUIRED" });
      res.json({ taxYear, statements: deriveK1s(spvId, taxYear) });
    } catch (e) { fail(res, e); }
  });

  /* ── GP: persisted statements ───────────────────────────────────────────── */
  app.get("/api/partner/me/spv/:spvId/k1/stored", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const partnerId = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId);
      if (!spvEngineStore.getSpv(partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const raw = req.query.taxYear;
      const taxYear = raw === undefined || raw === "" ? undefined : parseTaxYear(raw);
      if (taxYear === null) return res.status(400).json({ error: "TAX_YEAR_INVALID" });
      res.json({ statements: listK1s(spvId, taxYear) });
    } catch (e) { fail(res, e); }
  });

  /* ── GP: generate drafts (a write) ──────────────────────────────────────── */
  app.post(
    "/api/partner/me/spv/:spvId/k1/generate",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ctx = req.partnerContext!;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        const taxYear = parseTaxYear((req.body ?? {}).taxYear);
        if (taxYear === null) return res.status(400).json({ error: "TAX_YEAR_REQUIRED" });
        const statements = generateK1Drafts(spvId, taxYear, String(ctx.userId ?? ""));
        res.status(201).json({ statements });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── GP: issue a draft (a write) ────────────────────────────────────────── */
  app.post(
    "/api/partner/me/spv/:spvId/k1/:k1Id/issue",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ctx = req.partnerContext!;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        const issued = issueK1(spvId, String(req.params.k1Id));
        if (!issued) return res.status(404).json({ error: "K1_NOT_FOUND" });
        if (issued.status !== "issued") return res.status(409).json({ error: "K1_NOT_DRAFT" });
        res.json({ statement: issued });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── LP: this LP's own ISSUED statements, and nothing else ──────────────── */
  app.get("/api/investor/me/spv/:spvId/k1", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const spvId = String(req.params.spvId);
    try {
      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {
        return res.status(404).json({ error: "SPV_NOT_FOUND" });
      }
      res.json({ statements: lpOwnStoredK1s(spvId, ctx.userId) });
    } catch (e) { fail(res, e); }
  });
}

/** Exported for the falsification harness, which drives the predicate directly. */
export const __k1RouteInternals = { isCommittedLp, parseTaxYear };
