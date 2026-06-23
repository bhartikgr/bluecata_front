/**
 * Sprint 7 — Invitation token model (R200.gating §1, §7).
 *
 * Universal helpers usable from both the Vite browser bundle (where they
 * back the in-memory demo store) and Node tests (where the same helpers
 * are unit-tested without spinning the full server).
 *
 * Cryptographic guarantees:
 *  - 256-bit (32-byte) random tokens, base64url-encoded
 *  - SHA-256 hashing — only the hash is ever persisted server-side
 *  - Single-use: redemption flips a `redeemed` flag; subsequent attempts fail
 *  - Configurable expiry (default 30 days)
 *  - Revocation flag with admin/founder authority
 *
 * The functions in this file are PURE except for `generateRawToken` and
 * the timestamp captures inside `issueInvitation` / `redeemInvitation`.
 * Callers can inject `now` to make those deterministic in tests.
 */

import { createHash, randomBytes } from "node:crypto";

/** Token byte length per addendum (256 bits / 32 bytes). */
export const TOKEN_BYTES = 32;

/** Default invitation lifetime in milliseconds (30 days). */
export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type InvitationStatus =
  | "active"
  | "redeemed"
  | "expired"
  | "revoked";

export interface InvitationRecord {
  /** Stable identifier, distinct from the secret token. Safe to log/display. */
  id: string;
  /** SHA-256 of the raw token. The raw token itself is NEVER persisted. */
  tokenHash: string;
  /** Round this invitation grants access to. */
  roundId: string;
  /** Company the round belongs to, denormalised for the check endpoint. */
  companyId: string;
  /** Human-readable company name, surfaced to the invitee at /investor/signup. */
  companyName: string;
  /** Investor's claimed email — used for routing the email and pre-filling the form. */
  inviteeEmail: string;
  /** ISO timestamp of issuance. */
  issuedAt: string;
  /** ISO timestamp of expiry. */
  expiresAt: string;
  /** True once the invitee has redeemed the token. */
  redeemed: boolean;
  /** ISO timestamp of redemption (if redeemed). */
  redeemedAt: string | null;
  /** True once a founder/admin revokes the invitation. */
  revoked: boolean;
  /** Optional pre-set screen name for testing the demo flow. */
  prefilledScreenName: string | null;
}

/** Generate a fresh 256-bit token, base64url-encoded. */
export function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex digest of the raw token. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Constant-time-ish equality check over hex strings. */
export function tokenHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** Compute the live status of an invitation given the current time. */
export function statusOf(rec: InvitationRecord, now: Date = new Date()): InvitationStatus {
  if (rec.revoked) return "revoked";
  if (rec.redeemed) return "redeemed";
  if (now.getTime() > new Date(rec.expiresAt).getTime()) return "expired";
  return "active";
}

export interface IssueInput {
  id: string;
  roundId: string;
  companyId: string;
  companyName: string;
  inviteeEmail: string;
  ttlMs?: number;
  now?: Date;
  prefilledScreenName?: string | null;
}

/**
 * Issue a fresh invitation.
 *
 * Returns BOTH the raw token (for one-shot delivery to email) and the
 * persisted record (which only carries the hash). The raw token must
 * never be stored.
 */
export function issueInvitation(
  input: IssueInput,
): { rawToken: string; record: InvitationRecord } {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const rawToken = generateRawToken();
  const record: InvitationRecord = {
    id: input.id,
    tokenHash: hashToken(rawToken),
    roundId: input.roundId,
    companyId: input.companyId,
    companyName: input.companyName,
    inviteeEmail: input.inviteeEmail,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    redeemed: false,
    redeemedAt: null,
    revoked: false,
    prefilledScreenName: input.prefilledScreenName ?? null,
  };
  return { rawToken, record };
}

export interface RedeemResult {
  ok: boolean;
  reason?: "not_found" | "revoked" | "expired" | "already_redeemed";
  record?: InvitationRecord;
}

/**
 * Attempt to redeem a raw token against a list of records. Mutates and
 * returns the matched record on success; never reveals which validation
 * step failed beyond the coarse `reason` field.
 */
export function redeemInvitation(
  records: InvitationRecord[],
  rawToken: string,
  now: Date = new Date(),
): RedeemResult {
  const hash = hashToken(rawToken);
  const rec = records.find((r) => tokenHashEquals(r.tokenHash, hash));
  if (!rec) return { ok: false, reason: "not_found" };
  if (rec.revoked) return { ok: false, reason: "revoked", record: rec };
  if (rec.redeemed) return { ok: false, reason: "already_redeemed", record: rec };
  if (now.getTime() > new Date(rec.expiresAt).getTime())
    return { ok: false, reason: "expired", record: rec };
  rec.redeemed = true;
  rec.redeemedAt = now.toISOString();
  return { ok: true, record: rec };
}

/** Look up a record by its raw token without redeeming it. */
export function findByToken(
  records: InvitationRecord[],
  rawToken: string,
): InvitationRecord | undefined {
  const hash = hashToken(rawToken);
  return records.find((r) => tokenHashEquals(r.tokenHash, hash));
}

/** Mark a record revoked (idempotent). */
export function revokeInvitation(rec: InvitationRecord): InvitationRecord {
  rec.revoked = true;
  return rec;
}
