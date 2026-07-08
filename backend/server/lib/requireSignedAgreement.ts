/**
 * W2-I — requireSignedAgreement middleware (NON-sacred).
 *
 * Fail-closed WRITE gate for the Consortium Partner workspace. Reads the
 * DURABLE signed state from the canonical `contacts` row
 * (partner_agreement_signed_at) — NEVER the mutable onboarding_state JSON blob —
 * and refuses partner WRITE routes with 403 AGREEMENT_NOT_SIGNED when the
 * partner has not signed.
 *
 * Grace / no-lockout design (documented choice — SELF-SERVICE SIGN-ONCE):
 *   - READ routes are NEVER gated, so an unsigned partner is never bricked:
 *     they keep full read access to their workspace.
 *   - The FIRST write returns 403 with a machine-readable code the client turns
 *     into a redirect to /collective/partner/agreement, where the managing
 *     partner signs once (POST /api/partner/me/agreement stamps the same
 *     contacts column). After that, writes succeed.
 *   - This needs NO scheduled backfill job and NO timed grace window, so it is
 *     the simplest safe path: existing active partners simply sign once on
 *     their next write attempt and continue.
 *
 * MUST be wired AFTER requirePartnerAuth (it depends on req.partnerContext).
 */
import type { Request, Response, NextFunction } from "express";
import { rawDb } from "../db/connection";
import { log } from "./logger";

export function requireSignedAgreement(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.partnerContext;
  if (!ctx) {
    res.status(401).json({ error: "PARTNER_AUTH_REQUIRED" });
    return;
  }
  let signedAt: string | null = null;
  try {
    const row = rawDb()
      .prepare(
        `SELECT partner_agreement_signed_at AS signedAt
           FROM contacts WHERE id = ? AND kind = 'consortium_partner'`,
      )
      .get(ctx.partnerId) as { signedAt: string | null } | undefined;
    signedAt = row?.signedAt ?? null;
  } catch (err) {
    // Fail-closed: if we cannot confirm a signature, refuse the write.
    log.warn("[requireSignedAgreement] signed-state lookup failed:", (err as Error).message);
    signedAt = null;
  }
  if (!signedAt) {
    res.status(403).json({
      error: "AGREEMENT_NOT_SIGNED",
      message: "Please sign the Consortium Partner Agreement before making changes.",
      redirect: "/collective/partner/agreement",
    });
    return;
  }
  next();
}
