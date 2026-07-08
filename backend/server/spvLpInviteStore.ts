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
 */
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

const GENESIS = "0".repeat(64);

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
    prevHash: r.prev_hash ?? GENESIS,
    currHash: r.curr_hash ?? GENESIS,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
  };
}

/** List all live LP invites for a partner's SPV, most-recent first. */
export function listLpInvites(partnerId: string, spvId: string): SpvLpInvite[] {
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
          status, prev_hash, curr_hash, created_at, created_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?, ?)`,
    ).run(
      id, partnerId, spvId, email, firstName || null, lastName, note || null,
      prevHash, currHash, now, createdBy,
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
    prevHash,
    currHash,
    createdAt: now,
    createdBy,
  };
}
