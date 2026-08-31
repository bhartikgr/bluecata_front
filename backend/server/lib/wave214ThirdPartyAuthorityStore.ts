/**
 * server/lib/wave214ThirdPartyAuthorityStore.ts — WAVE 214
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------------------------------------
 * It captures, for a single third-party-data submission, the envelope R187.1 and
 * R187.3 require: the exact text shown, its sha256, a server-observed timestamp,
 * a server-observed IP, and the user agent.
 *
 * It is NOT a second consent store and NOT a second audit path (R171.1).
 *
 *   - It writes through `appendAdminAudit` + `reportAuditWriteOutcome` — wave
 *     186's writer, into the hash-chained `audit_log`. That is the same path
 *     wave 213 chose for the publish-disclosure acknowledgement, for the same
 *     reason, restated here so nobody has to go and read W213_BUILD.md to find
 *     out why `legal_consents` was not used:
 *
 *     `legal_consents` cannot hold a per-event acknowledgement. Its
 *     `documentId` is a closed five-value vocabulary
 *     (privacy|terms|cookies|acceptable-use|disclaimer) — none of which is "I am
 *     authorised to submit this person's email"; its version is forced to the
 *     active corpus version rather than the text actually shown; it has no
 *     column for the SUBJECT of the acknowledgement (which company, which
 *     invitee); and `recordConsent` is idempotent on
 *     (tenant, user, doc, version), so the second invitation a user sends would
 *     record NOTHING AT ALL. A store that silently records nothing on the second
 *     use is worse than no store.
 *
 *   - It does NOT create a table and there is NO migration in this wave. The
 *     build document's §214.3 says "None. No migration." and that is achievable
 *     precisely because the audit ledger already exists and already hashes.
 *
 * ---------------------------------------------------------------------------
 * R187.1 — SERVER-OBSERVED, NEVER CLIENT-SUPPLIED
 * ---------------------------------------------------------------------------
 * The IP comes from `resolveRateLimitClientIp` (the canonical resolver in
 * `server/lib/rateLimit.ts`, which is SACRED and is CALLED, never edited). That
 * resolver ignores `X-Forwarded-For` entirely unless the socket peer is a
 * configured trusted proxy, so a caller cannot forge it. `req.ip` is NOT used
 * directly anywhere in this file: under a default Express configuration `req.ip`
 * can be the client's own header value, which is exactly the fabrication R187.1
 * forbids.
 *
 * The timestamp is `new Date().toISOString()` taken here. No timestamp is ever
 * read from the request body. If the body contains one it is ignored, not
 * merged.
 *
 * ---------------------------------------------------------------------------
 * R201.2 — A MISSING VALUE MUST NOT BECOME AN INVENTED ONE
 * ---------------------------------------------------------------------------
 * If the IP cannot be resolved, the field records the explicit marker
 * `NOT_CAPTURED` — never an empty string, never "0.0.0.0", never a zero. Wave
 * 211's attestation store established that marker and this one uses the same
 * spelling so the two ledgers read the same way. The same applies to the user
 * agent: a request with no `user-agent` header records `NOT_CAPTURED`, which is
 * true, rather than `""`, which reads as "we looked and it was empty".
 */
import type { Request } from "express";
import { createHash } from "node:crypto";
import { resolveRateLimitClientIp } from "./rateLimit";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";
import {
  WAVE214_ERR_AUTHORITY_NAME_REQUIRED,
  WAVE214_ERR_AUTHORITY_NOT_CONFIRMED,
  wave214AuthorityMissingHeadline,
  wave214TypedNameMismatchHeadline,
  type Wave214AuthoritySurface,
} from "../../shared/wave214ThirdPartyAuthorityCopy";

/** The marker written when a field genuinely could not be observed. */
export const WAVE214_NOT_CAPTURED = "NOT_CAPTURED";

/** The audit event name. One event, one spelling, greppable. */
export const WAVE214_AUDIT_EVENT = "third_party_data.authority_confirmed";

export interface Wave214AuthorityEnvelope {
  /** The exact bytes the user was shown. Not normalised, not trimmed. */
  statementText: string;
  /** sha256 of `statementText`, hex. R187.3's missing field. */
  statementSha256: string;
  /** How the confirmation was expressed. */
  method: "typed_name" | "tick";
  /** The name the user typed, for `typed_name`. Null for `tick`. */
  typedName: string | null;
  /** Server clock, ISO 8601. Never from the body. */
  confirmedAt: string;
  /** Server-observed peer, or WAVE214_NOT_CAPTURED. Never from the body. */
  ipCapture: string;
  /** Request user agent, or WAVE214_NOT_CAPTURED. */
  userAgent: string;
}

export interface Wave214AuthorityRefusal {
  ok: false;
  httpStatus: 400;
  error: string;
  message: string;
}

export interface Wave214AuthorityAccepted {
  ok: true;
  envelope: Wave214AuthorityEnvelope;
}

export type Wave214AuthorityResult = Wave214AuthorityAccepted | Wave214AuthorityRefusal;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function observedIp(req: Request): string {
  try {
    const ip = resolveRateLimitClientIp(req);
    // "unknown" is the resolver's own fallback. Recording the string "unknown"
    // as if it were an address would be a fabricated value dressed as a
    // measurement, so it is mapped to the explicit marker instead.
    if (!ip || ip === "unknown") return WAVE214_NOT_CAPTURED;
    return ip;
  } catch (err) {
    log.warn("[wave214Authority] IP resolution failed:", (err as Error).message);
    return WAVE214_NOT_CAPTURED;
  }
}

function observedUserAgent(req: Request): string {
  const raw = req.headers["user-agent"];
  const ua = Array.isArray(raw) ? raw.join(" ") : raw;
  if (typeof ua !== "string" || ua.length === 0) return WAVE214_NOT_CAPTURED;
  return ua;
}

/**
 * TICK SURFACES. Fail-closed: the request is refused unless the body carries the
 * confirmation flag AND the exact statement the server is expecting.
 *
 * WHY THE CLIENT SENDS THE TEXT BACK, given the server already knows it: so that
 * the hash attests to what the CLIENT ACTUALLY RENDERED. A server that hashes
 * its own constant proves only what the server believes. The two are compared
 * BYTE-FOR-BYTE here — no `.trim()`, no `.toLowerCase()`, no whitespace collapse
 * — because a normalising comparison would let a screen show text that differs
 * from the recorded text in exactly the ways a reader would notice, and the hash
 * would still vouch for it.
 */
export function evaluateTickAuthority(args: {
  req: Request;
  body: Record<string, unknown>;
  surface: Wave214AuthoritySurface;
  expectedStatement: string;
}): Wave214AuthorityResult {
  const { req, body, surface, expectedStatement } = args;
  const confirmed = body.authorityConfirmed === true;
  const shown = typeof body.authorityStatementShown === "string" ? body.authorityStatementShown : "";
  // BYTE-FOR-BYTE. See the note above; this must never become a normalised
  // comparison, and the test `w214_authority_envelope` asserts a leading-space
  // variant is refused precisely so a future "helpful" trim fails the suite.
  if (!confirmed || shown !== expectedStatement) {
    return {
      ok: false,
      httpStatus: 400,
      error: WAVE214_ERR_AUTHORITY_NOT_CONFIRMED,
      message: wave214AuthorityMissingHeadline(surface),
    };
  }
  return {
    ok: true,
    envelope: {
      statementText: expectedStatement,
      statementSha256: sha256Hex(expectedStatement),
      method: "tick",
      typedName: null,
      confirmedAt: new Date().toISOString(),
      ipCapture: observedIp(req),
      userAgent: observedUserAgent(req),
    },
  };
}

/**
 * TYPED-NAME SURFACE. Same fail-closed shape, plus a non-empty typed name.
 *
 * The name is NOT checked against the account's stored name. That would be a
 * restriction — a founder whose legal name differs from their display name would
 * be blocked from creating a company, and R190.10 forbids adding eligibility
 * conditions. What is recorded is what they typed, verbatim, which is what a
 * confirmation is.
 */
export function evaluateTypedNameAuthority(args: {
  req: Request;
  body: Record<string, unknown>;
  surface: Wave214AuthoritySurface;
  expectedStatement: string;
}): Wave214AuthorityResult {
  const { req, body, surface, expectedStatement } = args;
  const shown = typeof body.authorityStatementShown === "string" ? body.authorityStatementShown : "";
  if (shown !== expectedStatement) {
    return {
      ok: false,
      httpStatus: 400,
      error: WAVE214_ERR_AUTHORITY_NOT_CONFIRMED,
      message: wave214AuthorityMissingHeadline(surface),
    };
  }
  const typedRaw = typeof body.authorityTypedName === "string" ? body.authorityTypedName : "";
  // A name of only whitespace is not a name. This IS a length/emptiness test on
  // a trimmed copy, which is legitimate; what is forbidden is normalising inside
  // an EQUALITY assertion, and the value RECORDED below is the untrimmed
  // original, so nothing the user typed is silently rewritten.
  if (typedRaw.trim().length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      error: WAVE214_ERR_AUTHORITY_NAME_REQUIRED,
      message: wave214TypedNameMismatchHeadline(),
    };
  }
  return {
    ok: true,
    envelope: {
      statementText: expectedStatement,
      statementSha256: sha256Hex(expectedStatement),
      method: "typed_name",
      typedName: typedRaw,
      confirmedAt: new Date().toISOString(),
      ipCapture: observedIp(req),
      userAgent: observedUserAgent(req),
    },
  };
}

/**
 * Write the envelope to the hash-chained ledger.
 *
 * Returns whether the ledger row landed. It deliberately does NOT throw and does
 * NOT decide whether the caller proceeds. Every caller in this wave records
 * BEFORE it performs the write it is gating, so a ledger failure is visible
 * (`reportAuditWriteOutcome` logs `AUDIT_ROW_MISSING_AFTER_ACTION`) without
 * turning an audit outage into an outage of company creation. That trade is
 * stated here rather than left implicit, because handbook §7.5 requires an
 * unprovable guard to be declared rather than counted: this makes audit failure
 * VISIBLE, it does not make these routes fail-closed on audit.
 */
export function recordAuthorityConfirmation(args: {
  actor: string;
  surface: Wave214AuthoritySurface;
  subject: string;
  envelope: Wave214AuthorityEnvelope;
  route: string;
  tenantId?: string;
  extra?: Record<string, unknown>;
}): boolean {
  const { actor, surface, subject, envelope, route, tenantId, extra } = args;
  const entry = appendAdminAudit(
    actor,
    subject,
    WAVE214_AUDIT_EVENT,
    {
      surface,
      subject,
      method: envelope.method,
      typedName: envelope.typedName,
      statementSha256: envelope.statementSha256,
      statementText: envelope.statementText,
      confirmedAt: envelope.confirmedAt,
      ipCapture: envelope.ipCapture,
      userAgent: envelope.userAgent,
      route,
      ...(extra ?? {}),
    },
    tenantId,
  );
  return reportAuditWriteOutcome(entry, {
    bearing: "identity",
    action: WAVE214_AUDIT_EVENT,
    route,
    subject,
  });
}
