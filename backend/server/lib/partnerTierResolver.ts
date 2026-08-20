/**
 * server/lib/partnerTierResolver.ts — WAVE 3F / ITEM 2.
 *
 * THE ONE PLACE a partner's BILLING TIER is resolved, and the only one that may
 * be used to price money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG (W10 REVIEW A, CRITICAL — wrong-tier billing)
 * ─────────────────────────────────────────────────────────────────────────────
 * `server/lib/spvDeploymentFee.ts:33-44` used to do this:
 *
 *     const row = rawTx.prepare(`SELECT metadata_json FROM contacts WHERE id = ?
 *                                AND kind = 'consortium_partner'`).get(partnerId);
 *     if (!row || !row.metadata_json) return "catalyst";
 *     try { ...parse... } catch { }
 *     return "catalyst";
 *
 * and `:80` priced the deployment fee off the result. Three separate failures:
 *
 *   1. HARDCODED BUSINESS VALUE. `"catalyst"` is a business tier compiled into
 *      the artifact. Absent, malformed or unknown tier data selected a PRICE.
 *      The owner's standing rule is all-DB-driven, no hardcoded business values.
 *   2. WRONG SOURCE OF TRUTH. `contacts.metadata_json` is not the canonical
 *      partner record — WAVE 4B found it holds a partner type behind an
 *      `as any` cast that is not even a member of the store's own union. An
 *      untyped JSON blob must not price money.
 *   3. FAIL-OPEN. The failure mode of "I do not know this partner's tier" was
 *      to bill the cheapest schedule. Reproduced against the frozen artifact:
 *      canonical tier `builder`, contact metadata NULL → billed 11100
 *      (catalyst) instead of 22200 (builder).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE DOES INSTEAD
 * ─────────────────────────────────────────────────────────────────────────────
 * It resolves the tier from the CANONICAL DURABLE PARTNER RECORD and FAILS
 * CLOSED. There is no default, no fallback, and no literal tier anywhere in
 * this file except the CHECK-constrained domain list itself.
 *
 *   D  `partner_tier_current` (migration 0161) — the durable canon. One typed,
 *      CHECK-constrained row per partner. This is the record.
 *   C  the canonical partner record held by `adminContactsStore`
 *      (`AdminContact.tier`), read through `adminContactsStoreShim.getById`.
 *      This is the store that OWNS partner identity in this codebase.
 *
 * Resolution:
 *   • neither D nor C yields a legal tier  → THROW. Billing is blocked.
 *   • D and C both yield a tier and DISAGREE → THROW. Inconsistent tier data
 *     is not something to pick a winner from; it is something to stop on.
 *   • otherwise the single agreed tier is returned, and if D was missing it is
 *     WRITTEN THROUGH to `partner_tier_current` so the durable canon converges
 *     and the next read is a single-row lookup.
 *
 * The legacy `contacts.metadata_json.tier` is deliberately NOT consulted: 0161
 * lifted it into D once, at migration time, and only where it held one of the
 * five legal values. It is no longer a live input to billing.
 *
 * BLOCKING IS THE POINT. `PartnerTierResolutionError` propagates to the caller
 * so a deployment fee is NOT charged at a guessed tier. WAVE 3F / ITEM 4 makes
 * that block recoverable rather than lossy: the deployment records a durable
 * `pending` billing row that an admin can fix (set the tier) and retry
 * idempotently. Blocked, recorded, retryable — never silently mis-billed.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";
/* WAVE 56 (R21/R36) — the tier domain is DATA. See partnerTierDomain.ts. */
import { isTierInDomain, tierDomainSlugs } from "./partnerTierDomain";
import { getById as getCanonicalPartnerContact, type PartnerTier } from "../adminContactsStoreShim";

/** The tier domain, mirroring the CHECK constraint in migration 0161 exactly.
 *  This is a DOMAIN (which strings are legal), never a default: no element of
 *  this list is ever selected by this module on its own initiative.
 *
 *  WAVE 56 (R21/R36) — THIS ARRAY IS NO LONGER THE DOMAIN.
 *  Migration 0191 removed the five-slug CHECK from all three tier tables, and
 *  `partner_tier_lifecycle` is now the domain: an owner-created tier is a real
 *  tier. This array is retained as the SEEDED FLOOR (see
 *  partnerTierDomain.LEGACY_SEEDED_TIER_SLUGS) so an existing tier can never
 *  drop out of a membership test because a read failed — a silent drop is
 *  forbidden. It cannot admit a tier that does not exist, because every string
 *  in it is seeded into the database by migration 0185 anyway.
 *  Ask `isPartnerTier()` / `partnerTierDomainSlugs()`, never this array. */
export const PARTNER_TIER_DOMAIN = [
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
] as const;

export const PARTNER_TIER_TABLE = "partner_tier_current";

export const E_TIER_UNRESOLVED = "PARTNER_TIER_UNRESOLVED";
export const E_TIER_INCONSISTENT = "PARTNER_TIER_INCONSISTENT";

/** Thrown instead of returning a guessed tier. Carries a machine-readable code
 *  so the deployment-fee billing row can record WHY collection was blocked. */
export class PartnerTierResolutionError extends Error {
  readonly code: string;
  readonly partnerId: string;
  readonly detail: Record<string, unknown>;
  constructor(code: string, partnerId: string, detail: Record<string, unknown> = {}) {
    super(`${code}: partner=${partnerId} ${JSON.stringify(detail)}`);
    this.name = "PartnerTierResolutionError";
    this.code = code;
    this.partnerId = partnerId;
    this.detail = detail;
  }
}

/**
 * WAVE 56 (R21/R36) — db-driven membership.
 *
 * Measured before this change: `isPartnerTier("bridge")` was `false` for a tier
 * that existed in the database with a lifecycle row, capability rows, a price
 * and an assignment — and because `readDurableTier()` filters its read through
 * this predicate, `resolveCanonicalPartnerTier()` threw PARTNER_TIER_UNRESOLVED
 * for a partner whose tier row the database had accepted. A compiled-in array
 * outvoted the database.
 *
 * The narrowing to `PartnerTier` is kept so no call site's types move; the union
 * is a compile-time convenience and the DATABASE is the domain.
 */
export function isPartnerTier(v: unknown): v is PartnerTier {
  if (typeof v !== "string" || v.length === 0) return false;
  if ((PARTNER_TIER_DOMAIN as readonly string[]).includes(v)) return true;
  return isTierInDomain(v);
}

/** Every tier that exists, database first, seeded five union'd in so an existing
 *  tier is never dropped from a picker or an error message. */
export function partnerTierDomainSlugs(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of tierDomainSlugs()) { if (!seen.has(s)) { seen.add(s); out.push(s); } }
  for (const s of PARTNER_TIER_DOMAIN) { if (!seen.has(s)) { seen.add(s); out.push(s); } }
  return out;
}

/* The canonical DDL, verbatim from migration 0161 minus the backfill.
 * Same pattern as server/lib/feeSettlementAuthority.ts: the `:memory:` test
 * database is built from connection.ts's inline bootstrap (SACRED, unedited),
 * which predates this table, so the table is created on first touch if the
 * migration runner has not already created it. It creates an EMPTY table and
 * seeds NOTHING — a bootstrap can never manufacture a tier. */
const PARTNER_TIER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS partner_tier_current (
  partner_id      TEXT PRIMARY KEY NOT NULL,
  -- WAVE 56 (R21/R36): the five-slug CHECK is GONE, here and in migration 0191.
  -- It was the single most consequential pin in the tree: this string, not the
  -- migration, is the definition every dev/test database actually gets, so a
  -- wave that fixed only the migration would have proved nothing. The domain is
  -- now partner_tier_lifecycle, enforced at the database layer by the
  -- referential triggers 0191 installs (trg_ptcur_tier_must_exist_insert /
  -- _update) — which still refuse a typo, and no longer refuse a real tier.
  tier            TEXT NOT NULL,
  source          TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  updated_at      TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_partner_tier_current_tier ON partner_tier_current (tier);
`;

let _tableReady = false;

/** Test hook — forget that the table was verified, so a suite that swaps the
 *  database handle re-checks it. Mirrors `__resetSchemaLatchForTest` in
 *  feeSettlementAuthority.ts. */
export function __resetPartnerTierLatchForTest(): void {
  _tableReady = false;
}

function tierDb(rawTx?: any): any {
  const db = rawTx ?? rawDb();
  if (!db) throw new PartnerTierResolutionError(E_TIER_UNRESOLVED, "*", { reason: "NO_DB_HANDLE" });
  if (!_tableReady) {
    try {
      const present = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(PARTNER_TIER_TABLE) as { name?: string } | undefined;
      if (!present) db.exec(PARTNER_TIER_TABLE_SQL);
      _tableReady = true;
    } catch (e) {
      // Do NOT latch on failure: the next call retries rather than treating an
      // unbuildable table as "no tiers exist".
      log.warn(`[partnerTier] table bootstrap failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** The durable canon, D. Returns null when there is no row (which is NOT a
 *  tier — it is the absence of one). */
function readDurableTier(db: any, partnerId: string): PartnerTier | null {
  try {
    const row = db
      .prepare(`SELECT tier FROM ${PARTNER_TIER_TABLE} WHERE partner_id = ?`)
      .get(partnerId) as { tier?: string } | undefined;
    return isPartnerTier(row?.tier) ? (row!.tier as PartnerTier) : null;
  } catch (e) {
    log.warn(`[partnerTier] durable read failed for ${partnerId}: ${(e as Error).message}`);
    return null;
  }
}

/** The canonical partner record, C. */
function readCanonicalRecordTier(partnerId: string): PartnerTier | null {
  try {
    const contact = getCanonicalPartnerContact(partnerId);
    return isPartnerTier(contact?.tier) ? (contact!.tier as PartnerTier) : null;
  } catch (e) {
    log.warn(`[partnerTier] canonical record read failed for ${partnerId}: ${(e as Error).message}`);
    return null;
  }
}

/** Converge the durable canon on the canonical record. Best-effort: a write
 *  failure NEVER changes the resolved value and never blocks a legal charge. */
function writeThroughDurableTier(db: any, partnerId: string, tier: PartnerTier): void {
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO ${PARTNER_TIER_TABLE} (partner_id, tier, source, effective_from, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(partner_id) DO UPDATE SET
         tier = excluded.tier, source = excluded.source, updated_at = excluded.updated_at`,
    ).run(partnerId, tier, "canonical_partner_record", now, now);
  } catch (e) {
    log.warn(`[partnerTier] write-through failed for ${partnerId}: ${(e as Error).message}`);
  }
}

/**
 * Resolve the canonical billing tier for a partner, or THROW.
 *
 * @param partnerId `contacts.id` of the consortium partner.
 * @param rawTx     optional raw better-sqlite3 handle bound to the caller's
 *                  transaction, so the read sees the caller's uncommitted
 *                  writes (the deployment-fee path supplies this).
 * @throws PartnerTierResolutionError — PARTNER_TIER_UNRESOLVED when no source
 *         holds a legal tier, PARTNER_TIER_INCONSISTENT when two sources
 *         disagree. There is no third outcome and no default return.
 */
export function resolveCanonicalPartnerTier(partnerId: string, rawTx?: any): PartnerTier {
  if (!partnerId) throw new PartnerTierResolutionError(E_TIER_UNRESOLVED, String(partnerId), { reason: "MISSING_PARTNER_ID" });
  const db = tierDb(rawTx);
  const durable = readDurableTier(db, partnerId);
  const canonical = readCanonicalRecordTier(partnerId);

  if (durable && canonical && durable !== canonical) {
    throw new PartnerTierResolutionError(E_TIER_INCONSISTENT, partnerId, { durable, canonical });
  }
  const tier = durable ?? canonical;
  if (!tier) {
    throw new PartnerTierResolutionError(E_TIER_UNRESOLVED, partnerId, {
      durable: null, canonical: null,
      hint: `no row in ${PARTNER_TIER_TABLE} and no tier on the canonical partner record`,
    });
  }
  if (!durable) writeThroughDurableTier(db, partnerId, tier);
  return tier;
}

/**
 * Set the canonical durable tier for a partner. This is the supported admin
 * remedy for a PARTNER_TIER_UNRESOLVED block: set the tier, then retry the
 * deployment fee idempotently. Rejects anything outside the domain rather than
 * substituting a default.
 */
export function setCanonicalPartnerTier(partnerId: string, tier: unknown, source = "admin", rawTx?: any): PartnerTier {
  if (!partnerId) throw new PartnerTierResolutionError(E_TIER_UNRESOLVED, String(partnerId), { reason: "MISSING_PARTNER_ID" });
  if (!isPartnerTier(tier)) {
    throw new PartnerTierResolutionError(E_TIER_UNRESOLVED, partnerId, { reason: "TIER_NOT_IN_DOMAIN", tier });
  }
  const db = tierDb(rawTx);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ${PARTNER_TIER_TABLE} (partner_id, tier, source, effective_from, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(partner_id) DO UPDATE SET
       tier = excluded.tier, source = excluded.source, updated_at = excluded.updated_at`,
  ).run(partnerId, tier, source, now, now);
  return tier;
}
