/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 4 — SIDE-LETTER ROUTES.
 *
 * Capability 2 shipped the side-letter STORE and wired it into the waterfall,
 * but a GP could only create a letter by calling the store from code. AN ENGINE
 * WITH NO ROUTE IS NOT SHIPPED, so this file is the write surface that makes
 * per-LP terms an actual product capability:
 *
 *   GP  GET    /api/partner/me/spv/:spvId/side-letters          every letter
 *       POST   /api/partner/me/spv/:spvId/side-letters          create (supersedes)
 *       DELETE /api/partner/me/spv/:spvId/side-letters/:id      revoke
 *   LP  GET    /api/investor/me/spv/:spvId/side-letter          THIS LP's own letter
 *
 * NO SEPARATE LP APP (ruling A-23): the LP route is an investor-portal route on
 * the investor session identity, scoped by a DATA PREDICATE.
 *
 * LP PRIVACY (WAVE 29 / WAIVER-4). A side letter is the record that one LP
 * negotiated better terms than their co-investors — arguably the single most
 * damaging thing to leak between two passive LPs in one vehicle. The LP route
 * therefore reads through `lpOwnSideLetter`, which scopes by `investor_id` IN
 * THE SQL, takes the investor from the SESSION with no tamperable parameter,
 * and refuses non-members with 404 (rule 6), byte-identical to a vehicle that
 * does not exist.
 *
 * RATES ARE INTEGER BILLIONTHS AND ARE VALIDATED, NEVER "REPAIRED". A rate
 * outside [0, 1e9] is refused with a named code. The `n > 1 ? n/100 : n` guess
 * is FORBIDDEN — it cannot distinguish 1% from 100%, which is how a typed "8"
 * became a 100% preferred return in Wave 5.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { spvEngineStore } from "./spvEngineStore";
import { spvBasics, committedRegisterRows } from "./spvNavStore";
import {
  listSideLetters,
  lpOwnSideLetter,
  createSideLetter,
  revokeSideLetter,
  SideLetterValidationError,
} from "./spvSideLetterStore";
import { log } from "./lib/logger";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

function fail(res: Response, e: unknown): Response {
  if (e instanceof SideLetterValidationError) return res.status(400).json({ error: e.code, message: e.message });
  log.warn(`[spvSideLetterRoutes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

/** An optional integer-billionths rate, or a refusal. Never coerced. */
function optScaled(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new SideLetterValidationError("SIDE_LETTER_RATE_NOT_INTEGER_SCALED", `${label} must be integer billionths`);
  return n;
}

function isCommittedLp(spvId: string, investorId: string): boolean {
  return committedRegisterRows(spvId).some((r) => r.investorId === investorId);
}

export function registerSpvSideLetterRoutes(app: Express): void {
  /* ── GP: every letter on the vehicle ────────────────────────────────────── */
  app.get("/api/partner/me/spv/:spvId/side-letters", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      const partnerId = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId);
      if (!spvEngineStore.getSpv(partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      res.json({ sideLetters: listSideLetters(spvId) });
    } catch (e) { fail(res, e); }
  });

  /* ── GP: create a letter (supersedes the LP's prior active one) ─────────── */
  app.post(
    "/api/partner/me/spv/:spvId/side-letters",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ctx = req.partnerContext!;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        const basics = spvBasics(spvId);
        if (!basics) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        const b = (req.body ?? {}) as Record<string, unknown>;
        const investorId = String(b.investorId ?? "");
        /* A letter for someone who is not on the register would be terms with
           no counterparty, and would silently never apply. Refuse it loudly
           rather than storing a row that does nothing. */
        if (!investorId || !isCommittedLp(spvId, investorId)) {
          return res.status(400).json({ error: "SIDE_LETTER_INVESTOR_NOT_ON_REGISTER" });
        }
        const row = createSideLetter({
          spvId,
          tenantId: basics.tenantId,
          investorId,
          carryFractionScaled: optScaled(b.carryFractionScaled, "carryFractionScaled"),
          mgmtFeeFractionScaled: optScaled(b.mgmtFeeFractionScaled, "mgmtFeeFractionScaled"),
          hurdleFractionScaled: optScaled(b.hurdleFractionScaled, "hurdleFractionScaled"),
          minCheckMinor: b.minCheckMinor === undefined || b.minCheckMinor === null || b.minCheckMinor === ""
            ? null : Number(b.minCheckMinor),
          // The vehicle's own currency. A side letter denominated in something
          // else would put two currencies in one waterfall.
          currency: basics.currency,
          coInvestorVisibility: (b.coInvestorVisibility as any) ?? "inherit",
          mfnClause: Boolean(b.mfnClause),
          notes: b.notes == null || b.notes === "" ? null : String(b.notes),
          documentRef: b.documentRef == null || b.documentRef === "" ? null : String(b.documentRef),
          effectiveDate: String(b.effectiveDate ?? ""),
          actor: String(ctx.userId ?? ""),
        });
        res.status(201).json({ sideLetter: row });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── GP: revoke a letter — the LP reverts to fund defaults ──────────────── */
  app.delete(
    "/api/partner/me/spv/:spvId/side-letters/:sideLetterId",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ctx = req.partnerContext!;
        const spvId = String(req.params.spvId);
        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        const row = revokeSideLetter(spvId, String(req.params.sideLetterId), String(ctx.userId ?? ""));
        if (!row) return res.status(404).json({ error: "SIDE_LETTER_NOT_FOUND" });
        res.json({ sideLetter: row });
      } catch (e) { fail(res, e); }
    },
  );

  /* ── LP: this LP's own letter, and nothing else ─────────────────────────── */
  app.get("/api/investor/me/spv/:spvId/side-letter", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const spvId = String(req.params.spvId);
    try {
      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {
        return res.status(404).json({ error: "SPV_NOT_FOUND" });
      }
      // `null` means "you are on fund default terms" — a real answer, not an
      // error, and it says nothing about whether anyone else has a letter.
      res.json({ sideLetter: lpOwnSideLetter(spvId, ctx.userId) });
    } catch (e) { fail(res, e); }
  });
}

/** Exported for the falsification harness. */
export const __sideLetterRouteInternals = { isCommittedLp, optScaled };
