/**
 * v25.54 founder operations routes (NON-sacred).
 *
 * Houses two founder-gated endpoints introduced this wave:
 *   - G0-1  POST /api/founder/captable/seed-founder-shares
 *   - G0-2  POST /api/founder/rounds/:id/archive  (+ /unarchive)
 *
 * These CALL the sacred money core (commitFunded, listMembersForCompany,
 * getFundedQueue, verifyChain) but never modify it. All handlers are
 * fail-closed on money / auth / cap-table reads.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "crypto";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import type { UserContext } from "./lib/userContext";
import {
  commitFunded,
  getLedger,
  listMembersForCompany,
  getFundedQueue,
} from "./captableCommitStore";
import { getRoundById, archiveRound, unarchiveRound } from "./roundsStore";
import { createInvitation } from "./roundInvitationsStore";
import { log } from "./lib/logger";

function resolveCtx(req: Request): UserContext {
  return req.userContext ?? getUserContext(req);
}

function ownsCompany(ctx: UserContext, companyId: string): boolean {
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c) => c.companyId === companyId);
}

export function registerFounderOpsRoutes(app: Express): void {
  /* ────────────────────────────────────────────────────────────────────
   * G0-1 — founder self-commit (seed founder shares).
   *
   * Founders could not appear on their own cap table: every path into the
   * ledger went through the investor KYC/funded pipeline, so a company with no
   * founder block failed the "sharesAuthorized > 0" precondition for creating a
   * priced round. This route lets the founder seed a founder block by calling
   * the sacred commitFunded() UNCHANGED with a deterministic invitationId
   * (idempotent). Seed against a foundation round WITHOUT pricePerShare so the
   * reconcile() price coupling does not apply. Founder ≠ investor, so the
   * investor KYC gate is intentionally not consulted; the per-tenant compliance
   * hold IS honoured (inside commitFunded).
   * ──────────────────────────────────────────────────────────────────── */
  app.post("/api/founder/captable/seed-founder-shares", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
      const roundId = typeof body.roundId === "string" ? body.roundId.trim() : "";
      const shares = typeof body.shares === "string" ? body.shares.trim() : "";
      const amount = typeof body.amount === "string" ? body.amount.trim() : "";
      const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "USD";
      const holderFirstName = typeof body.holderFirstName === "string" ? body.holderFirstName : null;
      const holderLastName = typeof body.holderLastName === "string" ? body.holderLastName : null;

      if (!companyId || !roundId || !shares || !amount) {
        return res.status(400).json({
          ok: false,
          error: "missing_required_fields",
          message: "companyId, roundId, shares and amount are required.",
        });
      }

      // Founder ownership (fail-closed).
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
      }

      // Guard: seed against a round with NO pricePerShare to avoid reconcile
      // price coupling. If the caller aimed a priced round, reject explicitly.
      const round = getRoundById(roundId);
      if (round && round.pricePerShare != null && Number(round.pricePerShare) > 0) {
        return res.status(400).json({
          ok: false,
          error: "PRICED_ROUND_NOT_ALLOWED",
          message: "Seed founder shares against a foundation round without a price-per-share.",
        });
      }

      const invitationId = `founder_seed_${companyId}`;

      // Idempotency: if this deterministic invitationId already produced a
      // committed row, return it instead of attempting a second write.
      let existing;
      try {
        existing = getLedger().find((e) => e.invitationId === invitationId);
      } catch (err) {
        log.error("[seed-founder-shares] ledger read failed:", (err as Error).message);
        return res.status(503).json({ ok: false, error: "ledger_unavailable" });
      }
      if (existing) {
        return res.status(200).json({ ok: true, idempotent: true, entry: existing });
      }

      const result = commitFunded({
        invitationId,
        roundId,
        companyId,
        investorId: ctx.userId,
        amount,
        currency,
        shares,
        holderFirstName,
        holderLastName,
      });

      if (!result.ok) {
        // Compliance hold / validation / reconcile / db failures → typed 4xx.
        const status = result.error.startsWith("compliance_hold") ? 409 : 400;
        return res.status(status).json({ ok: false, error: result.error });
      }

      return res.status(201).json({ ok: true, entry: result.entry });
    } catch (err) {
      log.error("[seed-founder-shares] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /* ────────────────────────────────────────────────────────────────────
   * Q3 — past-round investor backfill ("Record existing investors").
   *
   * Founders migrating an existing (possibly past/closed) round onto Capavate
   * need to seat named investors who already committed OFF-platform directly
   * onto the cap table as already-committed, AND invite each to register so
   * they can log in and communicate. This route mirrors G0-1: it CALLS the
   * sacred commitFunded() UNCHANGED with a deterministic per-investor
   * invitationId (idempotent), then fires the existing createInvitation() so the
   * investor receives the platform-registration (redeem) email. The commit and
   * the invite are decoupled — they do not interfere.
   *
   * Guards (fail-closed): requireAuth + founder-owns-company + a price-coupling
   * guard. A no-price round accepts a direct commit cleanly; a priced round is
   * only accepted when the supplied shares equal floor(amount / pricePerShare)
   * so reconcile()'s price coupling holds. Rule #13: first AND last name are
   * mandatory. Seat BEFORE archiving (G0-2 refuses rounds with committed rows).
   * ──────────────────────────────────────────────────────────────────── */
  app.post("/api/founder/captable/backfill-investor", requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
      const roundId = typeof body.roundId === "string" ? body.roundId.trim() : "";
      const shares = typeof body.shares === "string" ? body.shares.trim() : (typeof body.shares === "number" ? String(body.shares) : "");
      const amount = typeof body.amount === "string" ? body.amount.trim() : (typeof body.amount === "number" ? String(body.amount) : "");
      const currency = typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "USD";
      const holderFirstName = typeof body.holderFirstName === "string" ? body.holderFirstName.trim() : "";
      const holderLastName = typeof body.holderLastName === "string" ? body.holderLastName.trim() : "";
      const investorEmailRaw = typeof body.investorEmail === "string" ? body.investorEmail.trim() : "";
      const investorEmail = investorEmailRaw.toLowerCase();

      if (!companyId || !roundId || !shares || !amount) {
        return res.status(400).json({
          ok: false,
          error: "missing_required_fields",
          message: "companyId, roundId, shares and amount are required.",
        });
      }
      // Rule #13 — last name is mandatory; never seat a holder without a full name.
      if (!holderFirstName || !holderLastName) {
        return res.status(400).json({
          ok: false,
          error: "missing_holder_name",
          message: "Both first and last name are required for the investor.",
        });
      }
      if (!investorEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(investorEmail)) {
        return res.status(400).json({
          ok: false,
          error: "invalid_email",
          message: "A valid investor email is required to send the registration invite.",
        });
      }

      // Founder ownership (fail-closed).
      if (!ownsCompany(ctx, companyId)) {
        return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
      }

      // Price-coupling guard. A priced round is only safe to backfill when the
      // supplied shares match floor(amount / pricePerShare) — otherwise
      // reconcile() inside commitFunded would reject the mismatch. A no-price
      // round has no coupling and is always accepted.
      const round = getRoundById(roundId);
      const pps = round && round.pricePerShare != null ? Number(round.pricePerShare) : 0;
      if (pps > 0) {
        const expectedShares = Math.floor(Number(amount) / pps);
        if (Number(shares) !== expectedShares) {
          return res.status(400).json({
            ok: false,
            error: "PRICED_ROUND_SHARE_MISMATCH",
            message: `This round is priced at ${pps}/share; shares must equal floor(amount/price) = ${expectedShares}.`,
          });
        }
      }

      // Stable per-investor keys so re-submitting the same investor is idempotent.
      const stableKey = createHash("sha256").update(investorEmail, "utf8").digest("hex").slice(0, 16);
      const investorId = `ext_${stableKey}`;
      const invitationId = `backfill_${roundId}_${stableKey}`;

      // Idempotency: if this deterministic invitationId already produced a
      // committed row, return it rather than double-writing the ledger.
      let existing;
      try {
        existing = getLedger().find((e) => e.invitationId === invitationId);
      } catch (err) {
        log.error("[backfill-investor] ledger read failed:", (err as Error).message);
        return res.status(503).json({ ok: false, error: "ledger_unavailable" });
      }

      let entry = existing;
      if (!existing) {
        const result = commitFunded({
          invitationId,
          roundId,
          companyId,
          investorId,
          amount,
          currency,
          shares,
          holderFirstName,
          holderLastName,
        });
        if (!result.ok) {
          const status = result.error.startsWith("compliance_hold") ? 409 : 400;
          return res.status(status).json({ ok: false, error: result.error });
        }
        entry = result.entry;
      }

      // Fire the platform-registration invite (the redeem link IS the register
      // path). Decoupled from the commit; best-effort. A pre-existing active
      // invite (duplicate_invitation) is fine — the investor already has a way
      // in — so we do not fail the backfill on it.
      let inviteEmailSent = false;
      try {
        const invite = await createInvitation({
          roundId,
          companyId,
          investorEmail,
          investorFirstName: holderFirstName,
          investorLastName: holderLastName,
          invitedByUserId: ctx.userId,
        });
        inviteEmailSent = !!invite.emailSent;
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (msg !== "duplicate_invitation") {
          log.warn("[backfill-investor] register invite failed (non-fatal):", msg);
        }
      }

      return res.status(existing ? 200 : 201).json({
        ok: true,
        idempotent: !!existing,
        entry,
        inviteEmailSent,
      });
    } catch (err) {
      log.error("[backfill-investor] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  /* ────────────────────────────────────────────────────────────────────
   * G0-2 — founder archive round (visible-but-inert).
   *
   * Safety invariant (money core): REFUSE if any committed cap-table ledger row
   * exists for the round, or if money is in-flight in the funded queue. Ledger
   * reads are fail-closed — a thrown read refuses the archive.
   * ──────────────────────────────────────────────────────────────────── */
  app.post("/api/founder/rounds/:id/archive", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

      const roundId = String(req.params.id ?? "");
      if (!roundId) return res.status(400).json({ ok: false, error: "missing_round_id" });

      const round = getRoundById(roundId);
      if (!round) return res.status(404).json({ ok: false, error: "round_not_found" });

      if (!ownsCompany(ctx, round.companyId)) {
        return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
      }

      // Money-core safety: fail-closed on ledger / funded-queue reads.
      let hasCommitted: boolean;
      let hasInFlight: boolean;
      try {
        hasCommitted = listMembersForCompany(round.companyId).some((e) => e.roundId === roundId);
        hasInFlight = getFundedQueue().some((e) => e.roundId === roundId);
      } catch (err) {
        log.error("[archive-round] cap-table read failed:", (err as Error).message);
        return res.status(503).json({ ok: false, error: "captable_unavailable" });
      }
      if (hasCommitted || hasInFlight) {
        return res.status(409).json({
          ok: false,
          error: "ROUND_HAS_CAPTABLE_ENTRIES",
          message: "This round has committed or in-flight cap-table entries and cannot be archived.",
        });
      }

      const updated = archiveRound(roundId, ctx.userId);
      if (!updated) return res.status(500).json({ ok: false, error: "archive_failed" });

      return res.status(200).json({ ok: true, round: updated });
    } catch (err) {
      log.error("[archive-round] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.post("/api/founder/rounds/:id/unarchive", requireAuth, (req: Request, res: Response) => {
    try {
      const ctx = resolveCtx(req);
      if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

      const roundId = String(req.params.id ?? "");
      if (!roundId) return res.status(400).json({ ok: false, error: "missing_round_id" });

      const round = getRoundById(roundId);
      if (!round) return res.status(404).json({ ok: false, error: "round_not_found" });

      if (!ownsCompany(ctx, round.companyId)) {
        return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
      }

      const updated = unarchiveRound(roundId, ctx.userId);
      if (!updated) return res.status(500).json({ ok: false, error: "unarchive_failed" });

      return res.status(200).json({ ok: true, round: updated });
    } catch (err) {
      log.error("[unarchive-round] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  });
}
