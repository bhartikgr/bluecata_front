/**
 * server/lib/captableCommitV2548.ts — v25.48 B2 + B5.
 *
 * PARALLEL wrapper around the Sacred cap-table ledger. This module NEVER edits
 * `server/captableCommitStore.ts` (Tier-1A sacred) or its hash-chain math — it
 * only CALLS the store's exported `commitFunded()` function and writes to the
 * NEW additive `commit_attestations` table (migration 0080). All ledger math,
 * reconciliation, and hash-chaining continue to run inside the sacred file
 * exactly as before.
 *
 * B2 — Batch commit with per-entry FOUNDER-confirmed amounts.
 *   The sacred batch route (/api/founder/captable/commit-funded-batch) commits
 *   every funded-queue entry at its enqueued (soft-circle/wire) amount. B2 adds
 *   a parallel route where the FOUNDER supplies an explicit per-entry amount
 *   (which may differ from the soft-circle) — the founder is the authoritative
 *   amount owner. Each entry is committed by calling the SAME exported
 *   `commitFunded()` once per entry with the founder-confirmed amount (the
 *   single-commit path already honors a supplied amount).
 *
 * B5 — REQUIRED founder attestation at commit (fail-closed).
 *   The founder MUST pass `attested: true`. If not, the commit is refused (422)
 *   and NOTHING is written. When attested, an attestation row (attestor id +
 *   timestamp + optional statement + amount/currency) is persisted to
 *   `commit_attestations` BEFORE the ledger commit for each entry. Fail-closed:
 *   if the attestation write fails, the entry is NOT committed.
 *
 * Investment-flow model (governs B2/B5): the FOUNDER confirms funds-in-bank
 * offline; the cap table moves ONLY on `committed`, on the FOUNDER-confirmed
 * amount, on BOTH single and batch paths.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth } from "./authMiddleware";
import { getCompaniesForFounder } from "../multiCompanyStore";
import { commitFunded } from "../captableCommitStore";
import { rawDb } from "../db/connection";
import { log } from "./logger";

interface BatchEntryInput {
  invitationId: string;
  roundId: string;
  investorId: string;
  amount: string | number;
  shares?: string | number;
  currency?: string;
  fromState?: string;
}

/** Parallel founder-ownership check (mirrors the sacred file's own internal
 * check via getCompaniesForFounder). Admins bypass. Returns true if allowed. */
function founderOwnsCompany(req: Request, companyId: string): boolean {
  const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
  const userId = ctx?.userId;
  if (!userId) return false;
  if (ctx?.isAdmin) return true;
  try {
    return getCompaniesForFounder(userId).some((c) => c.companyId === companyId);
  } catch (err) {
    log.error("[captableCommitV2548.founderOwnsCompany] lookup failed (fail-closed):", (err as Error).message);
    return false;
  }
}

/** B5 — persist a founder attestation row (fail-closed). Returns the row id, or
 * null if the write failed (caller must then NOT commit). */
export function recordCommitAttestation(input: {
  invitationId: string;
  roundId?: string | null;
  companyId?: string | null;
  investorId?: string | null;
  attestorUserId: string;
  amount?: string | null;
  currency?: string | null;
  statement?: string | null;
}): string | null {
  try {
    const id = `att_${randomBytes(8).toString("hex")}`;
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT INTO commit_attestations
           (id, invitation_id, round_id, company_id, investor_id, attestor_user_id, attested_at, amount, currency, statement)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.invitationId,
        input.roundId ?? null,
        input.companyId ?? null,
        input.investorId ?? null,
        input.attestorUserId,
        now,
        input.amount ?? null,
        input.currency ?? null,
        input.statement ?? null,
      );
    return id;
  } catch (err) {
    log.error("[captableCommitV2548.recordCommitAttestation] write failed (fail-closed):", (err as Error).message);
    return null;
  }
}

/** Read attestations for an invitation (founder/admin visibility). */
export function listAttestationsForInvitation(invitationId: string): any[] {
  try {
    return rawDb()
      .prepare(`SELECT * FROM commit_attestations WHERE invitation_id = ? ORDER BY attested_at ASC`)
      .all(invitationId) as any[];
  } catch (err) {
    log.error("[captableCommitV2548.listAttestationsForInvitation] read failed:", (err as Error).message);
    return [];
  }
}

export function registerCaptableCommitV2548Routes(app: Express): void {
  /**
   * B2 + B5 — POST /api/founder/captable/commit-funded-batch-v2
   * Body: {
   *   companyId, roundId,
   *   attested: boolean,           // B5 REQUIRED — fail-closed
   *   attestationStatement?: string,
   *   entries: [{ invitationId, roundId, investorId, amount, shares?, currency?, fromState? }]
   * }
   * The founder-confirmed `amount` on each entry is authoritative and passed
   * straight to the sacred commitFunded(). An attestation row is written per
   * entry BEFORE its commit.
   */
  app.post("/api/founder/captable/commit-funded-batch-v2", requireAuth, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      companyId?: string;
      roundId?: string;
      attested?: unknown;
      attestationStatement?: unknown;
      entries?: unknown;
    };
    const { companyId, roundId } = body;
    if (!companyId || !roundId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId and roundId are required." });
    }
    // Founder ownership (parallel gate).
    if (!founderOwnsCompany(req, companyId)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company", message: "You must be the founder of this company." });
    }
    // B5 — REQUIRED attestation, fail-closed.
    if (body.attested !== true) {
      return res.status(422).json({
        ok: false,
        error: "attestation_required",
        message: "Founder attestation is required to commit. Confirm the attestation checkbox and retry.",
      });
    }
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const attestorUserId = ctx?.userId ?? "";
    if (!attestorUserId) {
      return res.status(401).json({ ok: false, error: "missing_identity" });
    }
    const entries = Array.isArray(body.entries) ? (body.entries as BatchEntryInput[]) : [];
    if (entries.length === 0) {
      return res.status(400).json({ ok: false, error: "no_entries", message: "At least one entry is required." });
    }
    const statement = typeof body.attestationStatement === "string" ? body.attestationStatement : null;

    const committed: any[] = [];
    const failed: Array<{ invitationId: string; error: string }> = [];

    for (const e of entries) {
      if (!e || !e.invitationId || !e.roundId || !e.investorId) {
        failed.push({ invitationId: (e && e.invitationId) || "(unknown)", error: "missing_entry_fields" });
        continue;
      }
      const amount = e.amount === undefined || e.amount === null ? "" : String(e.amount);
      const shares = e.shares === undefined || e.shares === null ? "" : String(e.shares);
      const currency = typeof e.currency === "string" && e.currency.length > 0 ? e.currency : "USD";

      // B5 — write the attestation FIRST (fail-closed): if it fails, skip commit.
      const attId = recordCommitAttestation({
        invitationId: e.invitationId,
        roundId: e.roundId,
        companyId,
        investorId: e.investorId,
        attestorUserId,
        amount,
        currency,
        statement,
      });
      if (!attId) {
        failed.push({ invitationId: e.invitationId, error: "attestation_persist_failed" });
        continue;
      }

      // B2 — commit at the FOUNDER-confirmed amount via the sacred exported fn.
      const r = commitFunded({
        invitationId: e.invitationId,
        roundId: e.roundId,
        companyId,
        investorId: e.investorId,
        amount,
        currency,
        shares,
        fromState: (e.fromState as any) ?? undefined,
      });
      if (!r.ok) {
        failed.push({ invitationId: e.invitationId, error: r.error });
        continue;
      }
      committed.push({ ...r.entry, attestationId: attId });
    }

    return res.json({
      ok: failed.length === 0,
      committedCount: committed.length,
      failedCount: failed.length,
      committed,
      failed,
    });
  });

  /** Founder/admin visibility — list attestations for an invitation. */
  app.get("/api/founder/captable/attestations/:invitationId", requireAuth, (req: Request, res: Response) => {
    const invitationId = String(req.params.invitationId);
    const rows = listAttestationsForInvitation(invitationId);
    res.json({ ok: true, attestations: rows });
  });
}
