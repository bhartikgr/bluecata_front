/**
 * server/lib/wave214RedeemConsentRecord.ts — WAVE 214, the wiring job
 *
 * ===========================================================================
 * THE DEFECT, WHICH IS THE MIRROR IMAGE OF THE USUAL ONE
 * ===========================================================================
 * D5, from the build document: **"Enforced and unrecorded is as bad as recorded
 * and unenforced. Everything here must be both."**
 *
 * The redeem-invitation terms tick already exists and already works:
 *   - `client/src/pages/investor/Redeem.tsx` renders the tick and the client
 *     refuses to submit without it;
 *   - `server/lib/authRoutes.ts` returns 400 `TERMS_NOT_ACCEPTED`;
 *   - `server/lib/teamInviteRedeem.ts` returns 400 `TERMS_NOT_ACCEPTED`.
 *
 * And **neither server file writes anything.** The acceptance is checked and
 * discarded. Every invited user on this platform accepted the terms and the
 * platform cannot show that any of them did.
 *
 * This file is the missing write, and nothing else. The tick, the label, the
 * client refusal and both server 400s are untouched, byte-for-byte.
 *
 * ===========================================================================
 * WHY ONE HELPER FOR TWO CALL SITES
 * ===========================================================================
 * Handbook §12.2's lesson, stated as `/api/health` and `/api/healthz` being
 * different endpoints: the recurring mistake on this platform is reading ONE
 * path and reporting on THE PLATFORM. There are two redeem implementations here
 * — the team-invite one (mounted first, handles team tokens) and the
 * investor/round one (the fall-through). A fix applied to one of them is a fix
 * to half the users, and which half depends on what kind of invitation they got.
 *
 * So the write lives here once, and BOTH sites call it. `W214_TESTS.md` drives
 * both over real HTTP, because a helper that only one site calls is the same
 * defect with extra steps.
 *
 * ===========================================================================
 * WHY IT CANNOT BREAK A REDEMPTION (§214.5's first harm row)
 * ===========================================================================
 * Redemption is the entry path for every invited user on the platform. So:
 *
 *   1. This is called AFTER the redemption's durable writes have committed and
 *      after the existing enforcement has passed. It is not a gate.
 *   2. It never throws. Every failure mode returns a named outcome.
 *   3. Its return value is not consulted by either caller to decide whether the
 *      redemption succeeds. It is recorded, and the response is unchanged.
 *
 * A test drives a successful redemption with the consent store forced to throw
 * and asserts the redemption still completes with the failure recorded.
 *
 * ===========================================================================
 * VERSION, AND WHY IT IS NOT PASSED IN
 * ===========================================================================
 * §214.5: "The version is read from `platform_config`
 * (`legal.corpus.active_version`), which is data, not a document another wave
 * wrote." `recordConsent` already does exactly that when `documentVersion` is
 * omitted (wave 210's `resolveConsentDocumentVersion`). So it is omitted here on
 * purpose. Passing a constant would pin the record to a version this wave
 * believes is current, and wave 210 owns the corpus — handbook §5.9 forbids
 * depending on a parallel wave's in-flight artefacts.
 */
import type { Request } from "express";
import { recordConsent } from "../legalConsentStore";
import { resolveRateLimitClientIp } from "./rateLimit";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";

export const WAVE214_REDEEM_CONSENT_FAILED_EVENT = "legal.redeem_consent.write_failed";
export const WAVE214_REDEEM_CONSENT_WRITTEN_EVENT = "legal.redeem_consent.written";

/** The marker for a field that genuinely could not be observed (R201.2). */
export const WAVE214_NOT_CAPTURED = "NOT_CAPTURED";

export type Wave214RedeemConsentOutcome =
  | { recorded: true; isNew: boolean; documentVersion: string }
  | { recorded: false; reason: "store_failed" | "no_user_id" };

function observedIp(req: Request): string {
  try {
    const ip = resolveRateLimitClientIp(req);
    return !ip || ip === "unknown" ? WAVE214_NOT_CAPTURED : ip;
  } catch {
    return WAVE214_NOT_CAPTURED;
  }
}

function observedUserAgent(req: Request): string {
  const raw = req.headers["user-agent"];
  const ua = Array.isArray(raw) ? raw.join(" ") : raw;
  return typeof ua === "string" && ua.length > 0 ? ua : WAVE214_NOT_CAPTURED;
}

/**
 * Record the terms acceptance that both redeem routes already enforce.
 *
 * `documentId: "terms"` and `context: "signup"` are both existing members of
 * `legalConsentStore`'s closed vocabularies — no vocabulary is extended, no
 * column is added, no table is created. `signup` rather than `onboarding`
 * because this call happens at the moment an account is REGISTERED (both sites
 * mint a persona and a credential immediately before it); `onboarding` describes
 * the steps after an account exists.
 *
 * @param site which redeem implementation called — recorded so a reader of the
 *             ledger can tell the two apart, which is the whole §12.2 point.
 */
export function recordRedeemTermsConsent(args: {
  req: Request;
  userId: string;
  site: "authRoutes.redeem" | "teamInviteRedeem.redeem";
  subject: string;
}): Wave214RedeemConsentOutcome {
  const { req, userId, site, subject } = args;
  if (!userId) return { recorded: false, reason: "no_user_id" };

  try {
    const { consent, isNew } = recordConsent({
      userId,
      documentId: "terms",
      context: "signup",
      ipAddress: observedIp(req),
      userAgent: observedUserAgent(req),
    });
    try {
      const entry = appendAdminAudit(userId, subject, WAVE214_REDEEM_CONSENT_WRITTEN_EVENT, {
        site,
        documentId: "terms",
        context: "signup",
        documentVersion: consent.documentVersion,
        isNew,
        consentId: consent.id,
      });
      reportAuditWriteOutcome(entry, {
        bearing: "identity",
        action: WAVE214_REDEEM_CONSENT_WRITTEN_EVENT,
        route: site,
        subject,
      });
    } catch (err) {
      log.warn("[wave214RedeemConsent] audit mirror failed (consent row already written):", (err as Error).message);
    }
    return { recorded: true, isNew, documentVersion: consent.documentVersion };
  } catch (err) {
    /* The redemption has already completed. Swallowing this silently would
       recreate the original defect one level up, so it is logged AND put on the
       ledger as an explicit failure row. A missing consent must read as
       "we tried and failed", never as an absence nobody noticed. */
    log.error("[wave214RedeemConsent] consent write FAILED after successful redemption:", (err as Error).message);
    try {
      const entry = appendAdminAudit(userId, subject, WAVE214_REDEEM_CONSENT_FAILED_EVENT, {
        site,
        documentId: "terms",
        context: "signup",
        error: (err as Error).message,
      });
      reportAuditWriteOutcome(entry, {
        bearing: "identity",
        action: WAVE214_REDEEM_CONSENT_FAILED_EVENT,
        route: site,
        subject,
      });
    } catch {
      /* Both the consent store and the audit ledger are down. Nothing further
         this process can do durably; the log line above is the record. */
    }
    return { recorded: false, reason: "store_failed" };
  }
}
