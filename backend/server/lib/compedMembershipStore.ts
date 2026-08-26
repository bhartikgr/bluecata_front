/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 155 — THE ADMIN-GRANTED (COMPED) MEMBERSHIP LEDGER.
                                       R123.1, R124.4.3, R113.3, R114.3, R77
   ═══════════════════════════════════════════════════════════════════════════
   THE LOCKOUT THIS CLEARS. R123.1: `capavate_subscriptions` holds zero rows and
   the live payment path is unconfigured, so an `enforced` eligibility gate
   refuses every SPV create, fund create and create-on-behalf with no way for
   anyone to clear it (R124.4.3 — the table has only two writers, both payment
   paths). This ledger is the owner's way to put ONE company, or ONE partner
   account, in good standing without a card.

   `server/subscriptionStore.ts` IS NOT TOUCHED. It is sacred and call-only.
   Reasons the grant is expressed HERE rather than as a row in
   `capavate_subscriptions`, both of which stand on their own:

     1. IT CANNOT BE EXPRESSED THERE. Its writers mint a row against a real
        Airwallex PaymentIntent, and `failByPaymentIntent` deliberately refuses
        to downgrade an `active` row ("never downgrade a confirmed-active sub").
        A grant that must be REVOCABLE therefore has no exit through that store,
        and inventing one would mean editing it.
     2. A COMP IS NOT REVENUE. Keeping it out of the billing table is what makes
        it structurally impossible for a comp to appear as money. See
        `isRevenue` below and the surface list in build_log/wave155/W155_BUILD.md.

   IT IS A LEDGER, NOT A FLAG — the `spvLaunchGateOverrideStore` precedent:
     · `reason` is required in the application layer as well as NOT NULL in SQL,
       so an admin gets a plain sentence (R77) instead of a CHECK-constraint
       stack trace.
     · The actor is passed in by the route from the authenticated session and is
       NOT NULL. There is no placeholder fallback (the `actor_required` pattern
       at server/adminPlatformStore.ts:2205).
     · REVOKE, NEVER DELETE. `revoked_at`/`revoked_by`/`revoke_reason` are
       stamped and the row stays. There is no DELETE statement in this file.
     · No stored `active` column: liveness is `revoked_at IS NULL` and any
       `expires_at` still in the future, evaluated at read time.

   BILLING-FREQUENCY BLIND (R113.3). A grant has no cycle, no amount and no
   currency, because there is no money in it.

   Table: `comped_membership_grant`
   (migrations/0206_wave155_comped_membership_grant.sql).
   ═══════════════════════════════════════════════════════════════════════════ */
import { randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";

export type CompedSubjectKind = "company" | "partner";

export interface CompedMembershipGrant {
  id: string;
  subjectKind: CompedSubjectKind;
  subjectId: string;
  reason: string;
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export class CompedMembershipWriteError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CompedMembershipWriteError";
  }
}

function rowToGrant(r: any): CompedMembershipGrant {
  return {
    id: r.id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id,
    reason: r.reason,
    grantedAt: r.granted_at,
    grantedBy: r.granted_by,
    expiresAt: r.expires_at ?? null,
    revokedAt: r.revoked_at ?? null,
    revokedBy: r.revoked_by ?? null,
    revokeReason: r.revoke_reason ?? null,
  };
}

/** The table is created by migration 0206. A database that has not run it yet
 *  must not crash a read path — an absent table means NO grants exist, which is
 *  the fail-closed answer for a gate. */
function tableExists(): boolean {
  try {
    return !!rawDb()
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name='comped_membership_grant'`,
      )
      .get();
  } catch {
    return false;
  }
}

/**
 * A COMPED MEMBERSHIP IS NEVER REVENUE.
 *
 * Exported as a named predicate rather than left implicit so that any future
 * financial surface which is handed a grant has one obvious answer to look at,
 * and so a test can pin it. It returns `false` unconditionally, on purpose:
 * there is no amount, currency or invoice anywhere in this module for it to
 * return anything else about.
 */
export function isRevenue(_grant: CompedMembershipGrant): false {
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 159 · R126.3 — AN EXPIRY NOBODY CAN READ IS NOT "NO EXPIRY".
   ══════════════════════════════════════════════════════════════════════════════
   The independent review proved with live HTTP:

     POST /api/admin/comped-memberships {"expiresAt":"31/12/2026"}
       -> 201 {"expiresAt":"31/12/2026","live":true}

   `Date.parse("31/12/2026")` is NaN, and the old reader below treated NaN as
   open-ended. So the single most common date typo in the world — writing a date
   the European way — converted a time-limited free membership into a PERPETUAL
   one, while the screen still displayed it as time-limited. Nobody would ever see
   the comp lapse, because it never would.

   Two changes, in the two places:
     · WRITE  — an unreadable expiry is REFUSED, with the expected format stated
                plainly. Nothing is stored.
     · READ   — a stored unreadable expiry now fails CLOSED (not live). Defence in
                depth for rows written before this fix, or by any other writer.
   The never-expiring case is made EXPLICIT (`expiresAt == null`) instead of being
   a fallback that any parsing accident can land in.

   Also fixed here: an `<input type="date">` sends `2026-12-31`, which parses as
   UTC MIDNIGHT — so a comp chosen to run "through 31 December" used to die at the
   START of that day. A date-only expiry now means the END of that day.
   ══════════════════════════════════════════════════════════════════════════════ */

/** ISO-8601 date, or ISO date+time. Deliberately strict: `Date.parse` accepts
 *  `12/31/26` and other locale-ambiguous forms, and guessing which of two numbers
 *  is the month is exactly the failure this fence exists to stop. */
const EXPIRY_ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const EXPIRY_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The plain sentence an admin sees when an expiry cannot be read (R77). */
export const COMPED_EXPIRY_FORMAT_MESSAGE =
  "That end date could not be read, so nothing was saved. Write it as year-month-day — for example 2026-12-31. A date that cannot be read is never treated as 'no end date'.";

/**
 * The instant a stored expiry falls due, or `null` when the value is UNREADABLE.
 *
 * A date with no time means the END of that day, not its midnight.
 */
export function compedExpiryInstant(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!EXPIRY_ISO_RE.test(s)) return null;
  const t = Date.parse(EXPIRY_DATE_ONLY_RE.test(s) ? `${s}T23:59:59.999Z` : s);
  return Number.isNaN(t) ? null : t;
}

/** True when `raw` is an expiry this platform can actually honour. */
export function isReadableCompedExpiry(raw: string | null | undefined): boolean {
  return compedExpiryInstant(raw) !== null;
}

/** Live RIGHT NOW: never revoked, and either open-ended or not yet expired. */
export function isGrantLive(grant: CompedMembershipGrant, now = Date.now()): boolean {
  if (grant.revokedAt) return false;
  /* EXPLICIT never-expiring case: no expiry was ever recorded. */
  if (grant.expiresAt === null || grant.expiresAt === undefined || String(grant.expiresAt).trim() === "") {
    return true;
  }
  const due = compedExpiryInstant(grant.expiresAt);
  /* W159 — FAIL CLOSED. An expiry the platform cannot read is a defect in the
     record, not a grant of perpetual standing. The grant is not live, the admin
     screen still shows the raw value, and it can be re-granted correctly. */
  if (due === null) return false;
  return due > now;
}

/**
 * NON-SACRED SELF-HEAL INSTALLER, the `applyWave152PricingSchema` /
 * `founderBillingExtensions` pattern.
 *
 * Migration 0206 creates this table on every migrated database. This function
 * creates the SAME table, with the SAME DDL, for the two cases a migration does
 * not cover: an in-memory test database (NODE_ENV=test never runs the migration
 * runner) and a fresh install between `npm install` and `npm run db:migrate`.
 *
 * It is CREATE ... IF NOT EXISTS only — no UPDATE, no DELETE, no data movement —
 * so it can never diverge from or overwrite what 0206 wrote. It is called from
 * the WRITE path only: a read path that created tables would be a write
 * disguised as a read.
 */
export function ensureCompedMembershipSchema(): void {
  const driver: any = rawDb();
  driver.exec(`CREATE TABLE IF NOT EXISTS comped_membership_grant (
  id            TEXT PRIMARY KEY NOT NULL,
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('company','partner')),
  subject_id    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  expires_at    TEXT,
  revoked_at    TEXT,
  revoked_by    TEXT,
  revoke_reason TEXT,
  UNIQUE (subject_kind, subject_id, granted_at)
);`);
  driver.exec(
    `CREATE INDEX IF NOT EXISTS idx_cmg_subject ON comped_membership_grant (subject_kind, subject_id);`,
  );
}

/**
 * Record a comped membership. `reason` and `grantedBy` are both required here,
 * with plain-sentence refusals (R77).
 */
export function grantCompedMembership(input: {
  subjectKind: CompedSubjectKind;
  subjectId: string;
  reason: string;
  grantedBy: string;
  expiresAt?: string | null;
}): CompedMembershipGrant {
  if (input.subjectKind !== "company" && input.subjectKind !== "partner") {
    throw new CompedMembershipWriteError(
      "COMPED_SUBJECT_KIND_INVALID",
      "A comped membership applies to either one company or one partner account. Choose which and try again.",
    );
  }
  const subjectId = String(input.subjectId ?? "").trim();
  if (!subjectId) {
    throw new CompedMembershipWriteError(
      "COMPED_SUBJECT_ID_REQUIRED",
      "Name the company or partner account this comped membership applies to.",
    );
  }
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    throw new CompedMembershipWriteError(
      "COMPED_REASON_REQUIRED",
      "Write the reason this membership is being given without payment — it is kept on the record permanently.",
    );
  }
  const grantedBy = String(input.grantedBy ?? "").trim();
  if (!grantedBy) {
    /* The `actor_required` pattern (adminPlatformStore.ts:2205): no placeholder
       fallback. A comp recorded against nobody is a comp nobody granted. */
    throw new CompedMembershipWriteError(
      "COMPED_ACTOR_REQUIRED",
      "This grant is recorded against the person who makes it, and the platform could not identify you. Nothing was changed.",
    );
  }
  const expiresAt = input.expiresAt ? String(input.expiresAt).trim() || null : null;
  /* W159 · R126.3 — refuse an unreadable end date on WRITE. Never store a value
     the reader would have to guess about. */
  if (expiresAt !== null && !isReadableCompedExpiry(expiresAt)) {
    throw new CompedMembershipWriteError(
      "COMPED_EXPIRY_UNREADABLE",
      COMPED_EXPIRY_FORMAT_MESSAGE,
    );
  }
  ensureCompedMembershipSchema();
  const existing = getLiveGrant(input.subjectKind, subjectId);
  if (existing) {
    throw new CompedMembershipWriteError(
      "COMPED_ALREADY_GRANTED",
      "This company or partner account already has a comped membership in place. End the existing one first if you want to record a new reason.",
    );
  }
  const row: CompedMembershipGrant = {
    id: `cmg_${randomUUID()}`,
    subjectKind: input.subjectKind,
    subjectId,
    reason,
    grantedAt: new Date().toISOString(),
    grantedBy,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  rawDb()
    .prepare(
      `INSERT INTO comped_membership_grant
         (id, subject_kind, subject_id, reason, granted_at, granted_by, expires_at,
          revoked_at, revoked_by, revoke_reason)
       VALUES (?,?,?,?,?,?,?,NULL,NULL,NULL)`,
    )
    .run(
      row.id,
      row.subjectKind,
      row.subjectId,
      row.reason,
      row.grantedAt,
      row.grantedBy,
      row.expiresAt,
    );
  return row;
}

/**
 * Withdraw a comped membership. NEVER A DELETE — the row is retained for history
 * and only stops conferring standing from now on.
 */
export function revokeCompedMembership(input: {
  id: string;
  revokedBy: string;
  reason: string;
}): CompedMembershipGrant {
  const existing = getGrant(input.id);
  if (!existing) {
    throw new CompedMembershipWriteError(
      "COMPED_NOT_FOUND",
      "That comped membership is no longer on file. Refresh the list and try again.",
    );
  }
  const revokedBy = String(input.revokedBy ?? "").trim();
  if (!revokedBy) {
    throw new CompedMembershipWriteError(
      "COMPED_ACTOR_REQUIRED",
      "This action is recorded against the person who takes it, and the platform could not identify you. Nothing was changed.",
    );
  }
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    throw new CompedMembershipWriteError(
      "COMPED_REVOKE_REASON_REQUIRED",
      "Write the reason this comped membership is ending — it is kept on the record permanently.",
    );
  }
  if (existing.revokedAt) return existing; // idempotent
  const revokedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `UPDATE comped_membership_grant
          SET revoked_at = ?, revoked_by = ?, revoke_reason = ?
        WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(revokedAt, revokedBy, reason, input.id);
  return { ...existing, revokedAt, revokedBy, revokeReason: reason };
}

export function getGrant(id: string): CompedMembershipGrant | null {
  if (!tableExists()) return null;
  const r = rawDb().prepare(`SELECT * FROM comped_membership_grant WHERE id = ?`).get(id);
  return r ? rowToGrant(r) : null;
}

/**
 * The one grant that confers standing on this subject right now, or null.
 *
 * THROWS when the driver is unavailable and the table therefore cannot be
 * consulted at all — that is the signal `spvEligibilityGate` needs in order to
 * report "Not on record" instead of inventing "unpaid" (R112.3(3)). An ABSENT
 * table (a database that has not run 0206) is different and returns null: no
 * grants exist there, which is the fail-closed answer.
 */
export function getLiveGrant(
  subjectKind: CompedSubjectKind,
  subjectId: string,
): CompedMembershipGrant | null {
  if (!tableExists()) return null;
  const rows = rawDb()
    .prepare(
      `SELECT * FROM comped_membership_grant
        WHERE subject_kind = ? AND subject_id = ? AND revoked_at IS NULL
        ORDER BY granted_at DESC`,
    )
    .all(subjectKind, String(subjectId ?? "").trim()) as any[];
  const now = Date.now();
  for (const r of rows) {
    const g = rowToGrant(r);
    if (isGrantLive(g, now)) return g;
  }
  return null;
}

/** EVERYTHING, revoked and expired included — this is the audit view. */
export function listAllGrants(): CompedMembershipGrant[] {
  if (!tableExists()) return [];
  return (
    rawDb()
      .prepare(`SELECT * FROM comped_membership_grant ORDER BY granted_at DESC`)
      .all() as any[]
  ).map(rowToGrant);
}

/** Live grants only. */
export function listLiveGrants(): CompedMembershipGrant[] {
  return listAllGrants().filter((g) => isGrantLive(g));
}
