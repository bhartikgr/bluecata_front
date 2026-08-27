/**
 * W2-H — Consortium Partner SPV: LP (limited-partner) invite store (NON-sacred).
 *
 * The SPV Engine had no way for a GP to invite an LP by email; LPs could only
 * appear via existing subscriptions. This durable, hash-chained store records a
 * partner-gated LP invitation (email + first/last name + optional note) per SPV
 * so it survives restart and can be surfaced alongside the live subscription
 * roster on the SPV detail page.
 *
 * SACRED: this file touches no sacred store. It writes its OWN additive table
 * `spv_lp_invite` (created idempotently in connection.ts + migration 0101) via
 * rawDb, mirroring the sibling partnerPortfolioStore hash-chain convention.
 *
 * Rule #13: last name is MANDATORY on any LP invite (regulatory name capture).
 *
 * WAVE 106 — this table is ALSO the SPV's LP IDENTITY REGISTER.
 *
 * A commitment recorded through POST /lp-commit used to carry the operator's
 * typed name and email as far as the sacred ledger and then lose them, because
 * the roster projection (`spvEngineStore.projectLpCommitted`) has no field for
 * either. The roster therefore showed an anonymous "Pending member" holding the
 * money next to an unrelated "invited" row for the same human.
 *
 * Rather than add a name column to a money table (and a migration to a
 * hash-chained register), the fix uses the rows that already exist here: this
 * table already stores exactly (spvId, partnerId, email, firstName, lastName,
 * status) per SPV. `recordLpCommitIdentity` MATCHES an existing invite on the
 * same SPV by trimmed, case-insensitive email and advances it, or writes a NEW
 * NAMED row when the email matches nobody. Nothing anonymous is ever created.
 */
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { lpInvestorIdForEmail, normaliseLpEmail } from "./lib/lpIdentity";

const GENESIS = "0".repeat(64);

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 166 · BATCH 3 ITEM D (PATH 2) · R131.2 — WHERE AN LP CAME FROM.
 * ══════════════════════════════════════════════════════════════════════════════
 * The owner's second path: "If the SPV already has LPs before it is launched on
 * the platform, GPs are able to directly add LPs to the SPV." Those LPs are
 * FIRST-CLASS LPs WITHOUT ACCOUNTS — the register does not wait for them to
 * register, and wave 166's identity binding (`server/lib/lpIdentityBinding.ts`)
 * attaches them to their existing position if and when they ever do.
 *
 * The vocabulary is wave 130's, unchanged, from
 * `server/lib/shareholderRegisterStore.ts` (`ShareholderRecordOrigin` at :66).
 * It is IMPORTED rather than re-declared so there is one list, not two that drift.
 *
 * THREE VOCABULARIES STAY THREE. An invitation state (this table's `status`), a
 * commitment state (`spv_subscription.status`) and a shareholder origin (this
 * column) answer three different questions. No shared enum, no shared label map.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** The origins an LP row may carry. Wave 130's vocabulary, not a new one. */
export const SPV_LP_INVITE_ORIGINS = [
  "incorporation",
  "existing_captable",
  "direct",
] as const;
export type SpvLpInviteOrigin = (typeof SPV_LP_INVITE_ORIGINS)[number];

/** `direct` is what a GP adding an LP on the platform actually did. */
export const DEFAULT_SPV_LP_INVITE_ORIGIN: SpvLpInviteOrigin = "direct";

export function isSpvLpInviteOrigin(v: unknown): v is SpvLpInviteOrigin {
  return typeof v === "string" && (SPV_LP_INVITE_ORIGINS as readonly string[]).includes(v);
}

const _originColumnEnsured = new WeakSet<object>();

/**
 * Idempotently make sure `spv_lp_invite.origin` exists (migration 0209).
 *
 * WHY THIS EXISTS AT ALL. `server/db/connection.ts` creates this table
 * idempotently on boot and is a SACRED file that may not be edited, so a
 * freshly-created database (every test DB) gets the table WITHOUT the wave-166
 * column no matter what `migrations/0209_*.sql` says. This is the same
 * ensure-on-read pattern `ensureWave152PricingSchema` uses for the same reason.
 *
 * Marked BEFORE the attempt so a persistent DDL failure cannot make every read
 * retry it; the reads below already tolerate a missing column honestly.
 */
export function ensureSpvLpInviteOriginColumn(): void {
  let db: any;
  try { db = rawDb(); } catch { return; }
  if (!db) return;
  if (_originColumnEnsured.has(db as object)) return;
  _originColumnEnsured.add(db as object);
  try {
    db.exec(
      `ALTER TABLE spv_lp_invite ADD COLUMN origin TEXT NOT NULL DEFAULT '${DEFAULT_SPV_LP_INVITE_ORIGIN}'`,
    );
  } catch {
    /* Column already present (the normal case), or the table does not exist yet
       — both are fine and neither is an error worth logging on every read. */
  }
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_spv_lp_invite_spv_origin ON spv_lp_invite (spv_id, origin)`,
    );
  } catch { /* no table / no column yet */ }
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function newId(): string {
  return `spvlpi_${randomBytes(8).toString("hex")}`;
}

export interface SpvLpInvite {
  id: string;
  spvId: string;
  partnerId: string;
  email: string;
  firstName: string | null;
  lastName: string;
  note: string | null;
  status: string;
  /** WAVE 166 · ITEM D (Path 2) — where this LP came from. Never their state. */
  origin: SpvLpInviteOrigin;
  prevHash: string;
  currHash: string;
  createdAt: string;
  createdBy: string | null;
}

function rowToInvite(r: any): SpvLpInvite {
  return {
    id: r.id,
    spvId: r.spv_id,
    partnerId: r.partner_id,
    email: r.email,
    firstName: r.first_name ?? null,
    lastName: r.last_name,
    note: r.note ?? null,
    status: r.status ?? "invited",
    /* A row written before migration 0209 reads back as `direct`, which is what
       those rows actually were — every one was created by `createLpInvite`, i.e.
       by a GP acting on the platform. This does NOT guess `existing_captable`
       for them: claiming a pre-platform history the database has no evidence for
       would be inventing provenance. */
    origin: isSpvLpInviteOrigin(r.origin) ? r.origin : DEFAULT_SPV_LP_INVITE_ORIGIN,
    prevHash: r.prev_hash ?? GENESIS,
    currHash: r.curr_hash ?? GENESIS,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
  };
}

/** List all live LP invites for a partner's SPV, most-recent first. */
export function listLpInvites(partnerId: string, spvId: string): SpvLpInvite[] {
  ensureSpvLpInviteOriginColumn();
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT * FROM spv_lp_invite
          WHERE partner_id = ? AND spv_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC`,
      )
      .all(partnerId, spvId) as any[];
    return rows.map(rowToInvite);
  } catch (err) {
    if (!/no such table/i.test(String(err))) {
      log.warn("[spvLpInviteStore] listLpInvites failed:", err);
    }
    return [];
  }
}

export interface CreateLpInviteInput {
  email: string;
  firstName?: string | null;
  lastName: string;
  note?: string | null;
  /**
   * WAVE 166 · ITEM D (Path 2) — OPTIONAL, defaulting to `direct`.
   *
   * Optional on purpose: every caller that existed before wave 166 was in fact
   * performing a `direct` add, so omitting it records the truth rather than a
   * placeholder, and no existing call site changes meaning. A GP entering LPs the
   * vehicle already had passes `existing_captable`.
   *
   * An UNRECOGNISED value is REFUSED (`LP_INVITE_INVALID_ORIGIN`), never coerced
   * to the default: silently filing an unknown provenance as `direct` is how the
   * register would come to assert something nobody stated.
   */
  origin?: unknown;
}

/**
 * Create a partner-gated LP invite. Fail-closed input validation:
 *   - email required (basic shape check),
 *   - last name MANDATORY (rule #13),
 * throwing a machine-readable error the route maps to a 400. The row is
 * hash-chained per (partner, spv).
 */
export function createLpInvite(
  partnerId: string,
  spvId: string,
  input: CreateLpInviteInput,
  createdBy: string,
): SpvLpInvite {
  const email = String(input.email ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const firstName = input.firstName != null ? String(input.firstName).trim() : "";
  const note = input.note != null ? String(input.note).trim() : "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("LP_INVITE_EMAIL_REQUIRED");
  }
  if (!lastName) throw new Error("LP_INVITE_LAST_NAME_REQUIRED");
  /* WAVE 166 · ITEM D (Path 2). Absent → `direct`. Present-but-unknown → REFUSED. */
  let origin: SpvLpInviteOrigin = DEFAULT_SPV_LP_INVITE_ORIGIN;
  if (input.origin !== undefined && input.origin !== null && input.origin !== "") {
    if (!isSpvLpInviteOrigin(input.origin)) throw new Error("LP_INVITE_INVALID_ORIGIN");
    origin = input.origin;
  }
  ensureSpvLpInviteOriginColumn();

  const now = new Date().toISOString();
  const id = newId();
  const existing = listLpInvites(partnerId, spvId);
  const prevHash = existing.length ? existing[0].currHash : GENESIS;
  const currHash = sha256Hex(`${prevHash}|${partnerId}|${spvId}|${email}|${lastName}|${now}`);

  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO spv_lp_invite
         (id, tenant_id, partner_id, spv_id, email, first_name, last_name, note,
          status, origin, prev_hash, curr_hash, created_at, created_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?, ?)`,
    ).run(
      id, partnerId, spvId, email, firstName || null, lastName, note || null,
      origin, prevHash, currHash, now, createdBy,
    );
  } catch (err) {
    log.error("[spvLpInviteStore] createLpInvite DB write failed:", err);
    throw new Error("LP_INVITE_PERSIST_FAILED");
  }

  return {
    id,
    spvId,
    partnerId,
    email,
    firstName: firstName || null,
    lastName,
    note: note || null,
    status: "invited",
    origin,
    prevHash,
    currHash,
    createdAt: now,
    createdBy,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * WAVE 106 — LP IDENTITY REGISTER (match-by-email, never a second record).
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The live LP identity row for (partner, spv, email), or null.
 *
 * Matching is on the normal form (trimmed, lower-cased) on BOTH sides: the
 * stored email is trimmed but not case-folded at write time, so comparing raw
 * strings would let "Ozan@Capavate.com" miss an invite stored as
 * "ozan@capavate.com" and silently seat a second holder. Done in JS rather than
 * in SQL `LOWER()` so the behaviour cannot drift with a collation setting.
 */
export function findLpInviteByEmail(
  partnerId: string,
  spvId: string,
  email: string,
): SpvLpInvite | null {
  const target = normaliseLpEmail(email);
  if (!target) return null;
  return listLpInvites(partnerId, spvId).find((i) => normaliseLpEmail(i.email) === target) ?? null;
}

export interface RecordLpCommitIdentityResult {
  invite: SpvLpInvite;
  /** True when an already-invited LP was matched and advanced (no new record). */
  matchedExistingInvite: boolean;
}

/**
 * Record — durably — WHO a commitment belongs to, and refuse if that is unknown.
 *
 * Called by the lp-commit route BEFORE the ledger write, so a commitment cannot
 * exist without a named identity behind it.
 *
 *   · email matches a live invite on this SPV → that row is advanced to
 *     `committed` and a missing first name is backfilled from the commit form.
 *     No second record. This is the case the defect got wrong.
 *   · email matches nobody → a NEW row is written carrying the name that was
 *     typed, already `committed`. A named LP, never a "Pending member".
 *   · no usable email, or no last name → THROWS. Nothing is invented here; the
 *     route turns this into a plain-English refusal.
 *
 * Idempotent: committing the same LP twice re-advances the same row.
 */
export function recordLpCommitIdentity(
  partnerId: string,
  spvId: string,
  input: { email: string; firstName?: string | null; lastName: string },
  createdBy: string,
): RecordLpCommitIdentityResult {
  const email = String(input.email ?? "").trim();
  const lastName = String(input.lastName ?? "").trim();
  const firstName = input.firstName != null ? String(input.firstName).trim() : "";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("LP_IDENTITY_EMAIL_REQUIRED");
  }
  if (!lastName) throw new Error("LP_IDENTITY_LAST_NAME_REQUIRED");

  const existing = findLpInviteByEmail(partnerId, spvId, email);
  if (existing) {
    const nextFirst = existing.firstName || firstName || null;
    try {
      const db: any = rawDb();
      db.prepare(
        `UPDATE spv_lp_invite
            SET status = 'committed', first_name = ?
          WHERE id = ? AND deleted_at IS NULL`,
      ).run(nextFirst, existing.id);
    } catch (err) {
      log.error("[spvLpInviteStore] recordLpCommitIdentity update failed:", err);
      throw new Error("LP_IDENTITY_PERSIST_FAILED");
    }
    return {
      invite: { ...existing, status: "committed", firstName: nextFirst },
      matchedExistingInvite: true,
    };
  }

  const now = new Date().toISOString();
  const id = newId();
  const prior = listLpInvites(partnerId, spvId);
  const prevHash = prior.length ? prior[0].currHash : GENESIS;
  const currHash = sha256Hex(`${prevHash}|${partnerId}|${spvId}|${email}|${lastName}|${now}`);
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO spv_lp_invite
         (id, tenant_id, partner_id, spv_id, email, first_name, last_name, note,
          status, origin, prev_hash, curr_hash, created_at, created_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'committed', ?, ?, ?, ?, ?)`,
    ).run(
      id, partnerId, spvId, email, firstName || null, lastName, null,
      /* An LP who reached the register by COMMITTING through the platform is a
         `direct` add. This path has no way to know about a pre-platform history
         and does not pretend to. */
      DEFAULT_SPV_LP_INVITE_ORIGIN, prevHash, currHash, now, createdBy,
    );
  } catch (err) {
    log.error("[spvLpInviteStore] recordLpCommitIdentity insert failed:", err);
    throw new Error("LP_IDENTITY_PERSIST_FAILED");
  }
  return {
    invite: {
      id, spvId, partnerId, email,
      firstName: firstName || null,
      lastName,
      note: null,
      status: "committed",
      origin: DEFAULT_SPV_LP_INVITE_ORIGIN,
      prevHash, currHash,
      createdAt: now,
      createdBy,
    },
    matchedExistingInvite: false,
  };
}

/**
 * WAVE 112 · FINDING 3 — BEST-EFFORT COMPENSATION, NOT A ROLLBACK.
 *
 * THE HALF-STATE (OPEN_ITEMS B-38, Reviewer B). `recordLpCommitIdentity` above
 * advances the identity row to `committed` BEFORE the lp-commit route writes the
 * sacred cap-table ledger entry. There is NO transaction spanning the two: this
 * store writes `spv_lp_invite` through `rawDb()`, while `commitFunded` writes a
 * different store (server/captableCommitStore.ts) inside its own transaction,
 * and that store is SACRED — this wave may not edit it to enlist in a shared
 * one. So if the ledger write fails, the identity row keeps saying `committed`
 * with no money behind it: an LP shown as committed while holding $0.
 *
 * WHAT THIS IS AND IS NOT. This is a COMPENSATING WRITE, and it is not named
 * `rollback` because it is not one — it can itself fail, and it is not atomic
 * with anything. It is NOT the guarantee. The guarantee is on the READ side: the
 * roster refuses to present an invite as `committed` unless the ledger entry is
 * actually there (see `lpCommitInvitationId` in server/lib/lpIdentity.ts). This
 * function only stops the stored row from carrying a claim its ledger cannot
 * support, so the register does not accumulate untrue history. A failure here is
 * logged and otherwise harmless, precisely because the reader is already honest.
 *
 * WHY THE HASH CHAIN IS UNHARMED. `currHash` covers
 * `prevHash|partnerId|spvId|email|lastName|createdAt` — status is NOT a hash
 * input, and the existing commit path above already UPDATEs status without
 * rehashing. Nothing is DELETED: removing a row would break the `prev_hash`
 * links of every row written after it, which is a far worse outcome than a
 * status that is one release stale.
 *
 * Only a row currently in `committed` is touched, and only back to `invited`
 * (never past whatever state a legitimate second actor may have set), so calling
 * this after a successful commit — or twice — cannot demote a real commitment
 * that some other request has since confirmed... which is exactly why the caller
 * must only invoke it on a FAILED ledger write.
 *
 * Returns true if a row was demoted, false otherwise (including on error).
 */
export function revertLpCommitIdentityStatus(
  partnerId: string,
  spvId: string,
  email: string,
): boolean {
  const normalised = String(email ?? "").trim();
  if (!normalised) return false;
  try {
    const db: any = rawDb();
    const info = db.prepare(
      `UPDATE spv_lp_invite
          SET status = 'invited'
        WHERE partner_id = ? AND spv_id = ? AND lower(email) = lower(?)
          AND status = 'committed' AND deleted_at IS NULL`,
    ).run(partnerId, spvId, normalised);
    return Number(info?.changes ?? 0) > 0;
  } catch (err) {
    log.error("[spvLpInviteStore] revertLpCommitIdentityStatus failed:", err);
    return false;
  }
}

/**
 * The SPV's LP identity register, keyed by the deterministic investor id the
 * commit path derives from the email. The roster read uses this to put a real
 * name and email on a subscription row that resolves to no platform user —
 * including rows written BEFORE this wave, which is why this is a read-time
 * repair and not a data migration.
 */
export function lpIdentitiesByInvestorId(
  partnerId: string,
  spvId: string,
): Map<string, SpvLpInvite> {
  const out = new Map<string, SpvLpInvite>();
  for (const invite of listLpInvites(partnerId, spvId)) {
    const investorId = lpInvestorIdForEmail(invite.email);
    if (!investorId) continue;
    // listLpInvites is newest-first; keep the newest row per identity.
    if (!out.has(investorId)) out.set(investorId, invite);
  }
  return out;
}

/** "First Last", or just the last name, or null. Never a placeholder. */
export function lpInviteDisplayName(invite: SpvLpInvite): string | null {
  const name = `${invite.firstName ?? ""} ${invite.lastName ?? ""}`.trim();
  return name || null;
}
