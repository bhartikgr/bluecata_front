// server/lib/investorIdentityAliasStore.ts
//
// WAVE 10 — EN-3. LP self-serve identity resolution, with no sacred edit and no
// chain break.
//
// READ migrations/0166_wave10_en3_investor_identity_alias.sql FIRST — it holds
// the full statement of the defect and of why the ledger row is not rewritten.
// In one line: a partner-seated LP is written into the SACRED, append-only
// cap-table ledger under `ext_<sha256(email).slice(0,16)>`
// (server/spvEngineRoutes.ts:830-832), while every self-serve read filters on
// the platform user id (`listCommitsForUser`,
// server/captableCommitStore.ts:444-451). The two never join, so the LP cannot
// see their own position. This module supplies the join, at read time.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS MODULE MUST NOT BREAK.
//   AN ALIAS IS NOT AN ACCESS GRANT.
// Resolving an alias returns a WIDER SET OF IDENTIFIERS for the same human. It
// says nothing about what that human may do. Every caller must still run its
// own authorisation against each row it returns. This is the same fence PT-5
// draws around classification — reporting and filtering only, never
// permissions, nav or access — and it is drawn here for the same reason: an
// identity mapping that quietly confers rights is a privilege-escalation
// primitive with a friendly name. `server/__tests__/waveW10_en3_alias.test.ts`
// asserts that this module exports no capability, role or permission symbol.
//
// ─────────────────────────────────────────────────────────────────────────────
// ALL DB-DRIVEN. No in-memory alias cache. An alias revoked in one process must
// stop resolving in every process on the next read, and a cache would make
// revocation eventually-consistent — for an identity claim, that is unsafe.
import { createHash, randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";
import { isSqlite } from "../db/portable";
import { log } from "./logger";
import { applyWave10EngineSchema } from "./applyWave10EngineSchema";

export type AliasBasis = "email_verified" | "admin_manual" | "partner_manual" | "import";
export type AliasState = "active" | "revoked";

export interface InvestorAlias {
  id: string;
  tenantId: string;
  aliasInvestorId: string;
  canonicalUserId: string;
  matchEmail: string | null;
  basis: AliasBasis;
  state: AliasState;
  verifiedBy: string | null;
  verifiedAt: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/* ==========================================================================
 * 0. Schema readiness (A-22 — the sacred bootstrap does not run 0166).
 * ======================================================================== */

let _ensured = false;
function db(): any {
  if (!_ensured) {
    _ensured = true;
    try {
      if (isSqlite()) applyWave10EngineSchema(rawDb());
    } catch {
      /* fail-soft: the migration runner is the primary path */
    }
  }
  return rawDb();
}

export function _resetAliasSchemaGuardForTests(): void {
  _ensured = false;
}

function tableReady(): boolean {
  try {
    return !!db()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='investor_identity_alias'`)
      .get();
  } catch {
    return false;
  }
}

/* ==========================================================================
 * 1. The derivation, reproduced exactly.
 * ======================================================================== */

/**
 * Re-derive the synthetic ledger id the SPV LP-commit path assigns.
 *
 * THIS MUST STAY BYTE-FOR-BYTE IDENTICAL to server/spvEngineRoutes.ts:830-831:
 *     sha256(investorEmail).digest("hex").slice(0, 16)   with investorEmail
 *     already lowercased and trimmed at :812-813.
 * If those two ever diverge, aliases stop matching and LPs quietly go blind
 * again. `server/__tests__/waveW10_en3_alias.test.ts` pins the derivation
 * against a literal expected digest AND greps the route file for the same
 * expression, so a change on either side fails the suite rather than the LP.
 */
export function deriveExternalInvestorId(email: string): string {
  const normalised = String(email ?? "").trim().toLowerCase();
  const stableKey = createHash("sha256").update(normalised, "utf8").digest("hex").slice(0, 16);
  return `ext_${stableKey}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(r: any): InvestorAlias {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    aliasInvestorId: r.alias_investor_id,
    canonicalUserId: r.canonical_user_id,
    matchEmail: r.match_email ?? null,
    basis: r.basis,
    state: r.state,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: r.verified_at ?? null,
    revokedBy: r.revoked_by ?? null,
    revokedAt: r.revoked_at ?? null,
    revokeReason: r.revoke_reason ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ==========================================================================
 * 2. Resolution — the read path.
 * ======================================================================== */

/**
 * Every identifier that denotes this investor, canonical id FIRST.
 *
 * Returns `[canonicalUserId]` when there are no aliases, never an empty array
 * for a non-empty input: a caller that does `IN (...)` on the result must not
 * silently widen to "all rows" or narrow to "no rows" because the alias table
 * happened to be empty.
 */
export function resolveInvestorIdSet(canonicalUserId: string): string[] {
  const canonical = String(canonicalUserId ?? "").trim();
  if (!canonical) return [];
  if (!tableReady()) return [canonical];
  try {
    const rows = db()
      .prepare(
        `SELECT alias_investor_id FROM investor_identity_alias
          WHERE canonical_user_id = ? AND state = 'active'
          ORDER BY created_at, id`,
      )
      .all(canonical) as Array<{ alias_investor_id: string }>;
    const out = [canonical];
    for (const r of rows) if (!out.includes(r.alias_investor_id)) out.push(r.alias_investor_id);
    return out;
  } catch (err) {
    // FAIL CLOSED, not open: on a read error the investor sees only what is
    // unambiguously theirs. Returning a wider set on error would be the one
    // way this module could leak another investor's rows.
    log.warn(`[en3] resolveInvestorIdSet failed, falling back to canonical only: ${(err as Error).message}`);
    return [canonical];
  }
}

/** The reverse direction: given a ledger id, who is it really? */
export function resolveCanonicalUserId(anyInvestorId: string): string {
  const id = String(anyInvestorId ?? "").trim();
  if (!id || !tableReady()) return id;
  try {
    const row = db()
      .prepare(
        `SELECT canonical_user_id FROM investor_identity_alias
          WHERE alias_investor_id = ? AND state = 'active' LIMIT 1`,
      )
      .get(id) as { canonical_user_id: string } | undefined;
    return row?.canonical_user_id ?? id;
  } catch {
    return id;
  }
}

export function listAliasesForUser(canonicalUserId: string): InvestorAlias[] {
  if (!tableReady()) return [];
  try {
    return (
      db()
        .prepare(
          `SELECT * FROM investor_identity_alias
            WHERE canonical_user_id = ? ORDER BY created_at DESC, id`,
        )
        .all(canonicalUserId) as any[]
    ).map(mapRow);
  } catch {
    return [];
  }
}

export function listAliases(filter?: { state?: AliasState; tenantId?: string }): InvestorAlias[] {
  if (!tableReady()) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter?.state) { where.push("state = ?"); args.push(filter.state); }
  if (filter?.tenantId) { where.push("tenant_id = ?"); args.push(filter.tenantId); }
  try {
    return (
      db()
        .prepare(
          `SELECT * FROM investor_identity_alias` +
            (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
            ` ORDER BY created_at DESC, id`,
        )
        .all(...args) as any[]
    ).map(mapRow);
  } catch {
    return [];
  }
}

export function getActiveAlias(aliasInvestorId: string): InvestorAlias | null {
  if (!tableReady()) return null;
  try {
    const row = db()
      .prepare(
        `SELECT * FROM investor_identity_alias
          WHERE alias_investor_id = ? AND state = 'active' LIMIT 1`,
      )
      .get(aliasInvestorId);
    return row ? mapRow(row) : null;
  } catch {
    return null;
  }
}

/* ==========================================================================
 * 3. Claiming — the write path.
 * ======================================================================== */

export class AliasError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "AliasError";
  }
}

/**
 * Link a synthetic ledger id to a platform user.
 *
 * THE SELF-SERVE CASE, AND WHY IT IS SAFE.
 *   `basis: "email_verified"` is only ever passed by the self-claim route,
 *   which derives the alias id FROM THE CALLER'S OWN SESSION EMAIL — it does
 *   not accept an alias id from the request body. The claim therefore reduces
 *   to: "the ledger recorded a position against sha256(my verified email);
 *   show it to me." A caller cannot claim `ext_<hash of someone else's email>`
 *   because they cannot produce that email as their own session identity.
 *
 * THE MANUAL CASES record who asserted the link. They are not self-serve and
 * the route layer gates them on admin.
 */
export function claimAlias(input: {
  tenantId: string;
  aliasInvestorId: string;
  canonicalUserId: string;
  matchEmail?: string | null;
  basis: AliasBasis;
  actorId: string;
}): InvestorAlias {
  if (!tableReady()) throw new AliasError("ALIAS_SCHEMA_MISSING", "migration 0166 has not been applied");
  const aliasId = String(input.aliasInvestorId ?? "").trim();
  const canonical = String(input.canonicalUserId ?? "").trim();
  if (!aliasId || !canonical) throw new AliasError("ALIAS_FIELDS_REQUIRED");
  if (aliasId === canonical) throw new AliasError("ALIAS_SELF_REFERENCE");

  const existing = getActiveAlias(aliasId);
  if (existing) {
    // Idempotent when it already points where we want it.
    if (existing.canonicalUserId === canonical) return existing;
    // Otherwise REFUSE. Silently repointing an identity claim at a different
    // human is the worst thing this table could do, and "last write wins" is
    // how it would happen.
    throw new AliasError(
      "ALIAS_ALREADY_CLAIMED",
      `${aliasId} is already claimed by another identity; revoke it first`,
    );
  }

  const now = nowIso();
  const row: InvestorAlias = {
    id: `iia_${randomUUID()}`,
    tenantId: input.tenantId,
    aliasInvestorId: aliasId,
    canonicalUserId: canonical,
    matchEmail: input.matchEmail ? String(input.matchEmail).trim().toLowerCase() : null,
    basis: input.basis,
    state: "active",
    verifiedBy: input.actorId,
    verifiedAt: now,
    revokedBy: null,
    revokedAt: null,
    revokeReason: null,
    createdBy: input.actorId,
    createdAt: now,
    updatedAt: now,
  };
  db()
    .prepare(
      `INSERT INTO investor_identity_alias
         (id, tenant_id, alias_investor_id, canonical_user_id, match_email, basis,
          state, verified_by, verified_at, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      row.id, row.tenantId, row.aliasInvestorId, row.canonicalUserId, row.matchEmail,
      row.basis, row.state, row.verifiedBy, row.verifiedAt, row.createdBy,
      row.createdAt, row.updatedAt,
    );
  log.info(`[en3] alias claimed: ${row.aliasInvestorId} -> ${row.canonicalUserId} (${row.basis})`);
  return row;
}

/**
 * Self-claim from a verified session email. Returns null when the derived id
 * has no rows anywhere in the ledger — there is nothing to claim, and creating
 * an alias for a position that does not exist would be a row of pure noise
 * that the next audit has to explain.
 */
export function selfClaimByEmail(input: {
  tenantId: string;
  email: string;
  canonicalUserId: string;
}): { alias: InvestorAlias | null; derivedId: string; hadLedgerRows: boolean } {
  const derivedId = deriveExternalInvestorId(input.email);
  const hadLedgerRows = externalIdHasLedgerRows(derivedId);
  if (!hadLedgerRows) return { alias: null, derivedId, hadLedgerRows };
  const alias = claimAlias({
    tenantId: input.tenantId,
    aliasInvestorId: derivedId,
    canonicalUserId: input.canonicalUserId,
    matchEmail: input.email,
    basis: "email_verified",
    actorId: input.canonicalUserId,
  });
  return { alias, derivedId, hadLedgerRows };
}

/**
 * Does this synthetic id appear anywhere a position could live? Checked across
 * the cap-table ledger, the SPV subscription roster and the cash-flow ledger,
 * because an LP can be seated in any of the three and "no rows in the first
 * table I looked at" is not the same as "nothing to claim".
 */
export function externalIdHasLedgerRows(externalId: string): boolean {
  const probes: Array<[string, string]> = [
    ["captable_commits", "investor_id"],
    ["spv_subscription", "investor_id"],
    ["vehicle_cashflow", "lp_id"],
  ];
  for (const [table, column] of probes) {
    try {
      const exists = db()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      if (!exists) continue;
      const row = db()
        .prepare(`SELECT 1 AS hit FROM ${table} WHERE ${column} = ? LIMIT 1`)
        .get(externalId);
      if (row) return true;
    } catch {
      /* a probe that cannot run proves nothing; try the next */
    }
  }
  return false;
}

export function revokeAlias(input: {
  aliasInvestorId: string;
  actorId: string;
  reason?: string | null;
}): InvestorAlias | null {
  if (!tableReady()) return null;
  const existing = getActiveAlias(input.aliasInvestorId);
  if (!existing) return null;
  const now = nowIso();
  db()
    .prepare(
      `UPDATE investor_identity_alias
          SET state='revoked', revoked_by=?, revoked_at=?, revoke_reason=?, updated_at=?
        WHERE id=?`,
    )
    .run(input.actorId, now, input.reason ?? null, now, existing.id);
  log.info(`[en3] alias revoked: ${existing.aliasInvestorId} (was -> ${existing.canonicalUserId})`);
  return { ...existing, state: "revoked", revokedBy: input.actorId, revokedAt: now, revokeReason: input.reason ?? null, updatedAt: now };
}
