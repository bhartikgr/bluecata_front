/**
 * server/spvFundStore.ts — CP Phase A (CP-028).
 *
 * Hybrid Map+DB store for the five hash-chained SPV/Fund tables:
 *
 *   - spvs               — SPV / fund / syndicate record header
 *   - spv_commitments    — LP commitments to an SPV (pending → signed → funded → withdrawn)
 *   - spv_capital_calls  — sequenced capital calls (monotonic sequence_no)
 *   - spv_distributions  — dividend / exit / return_of_capital events
 *   - spv_positions      — securities held by the SPV (basis, status)
 *
 * Replaces the in-memory arrays in partnerWorkspaceStore.ts (lines
 * 365-370) that were catastrophically lost on every restart. Public
 * endpoint paths under /api/partner/me/spvs are PRESERVED — see
 * partnerRoutes.ts where the existing routes now delegate to this store.
 *
 * ============================================================================
 * MATH SACRED (CP Phase A contract)
 *
 * cap-table-engine and captableCommitStore.ts lines 354-477 are NOT touched.
 * SPV math here is *additive* to cap-table math; it lives in a separate
 * universe of money (LP commitments to a partner-managed vehicle) and
 * never participates in cap-table issuance/reconciliation.
 *
 * Formulas (BigInt throughout — no floating point):
 *
 *   committed_minor    = SUM(spv_commitments.amount_minor
 *                            WHERE status IN ('signed', 'funded'))
 *
 *   called_minor       = SUM(spv_capital_calls.amount_minor)
 *
 *   distributed_minor  = SUM(spv_distributions.total_minor)
 *
 *   uncalled_minor     = committed_minor - called_minor          (>= 0 invariant)
 *
 *   net_invested_minor = called_minor - distributed_minor        (>= 0 healthy;
 *                                                                 < 0 means
 *                                                                 distributions
 *                                                                 exceed capital
 *                                                                 calls, normal
 *                                                                 in late-stage)
 *
 *   total_basis_minor  = SUM(spv_positions.basis_minor
 *                            WHERE status IN ('held', 'partially_sold'))
 *
 * Invariants enforced on every write (return 422 otherwise):
 *
 *   (I-1)  capital_call sequence_no is strictly monotonic per spv_id
 *          (CP-030).
 *
 *   (I-2)  distribution requires:
 *               committed_minor >= distributed_minor + called_minor   (CP-031)
 *          This means the SPV cannot distribute more than it has both
 *          committed AND called into the underlying investments.
 *
 *   (I-3)  spvs.status='forming' is reachable from any state by the GP only
 *          ("kill switch" per CP-029). status transitions are otherwise
 *          GP-only, and the LP-side write paths (commitments) cannot mutate
 *          status.
 *
 * Sample reconciliation walk-through:
 *
 *   Setup: SPV "Project Aurora", target $1,000,000 (target_minor = 100_000_000).
 *
 *   LP-A signs $300,000 commitment    -> spv.committed_minor = 30_000_000
 *   LP-B signs $400,000 commitment    -> spv.committed_minor = 70_000_000
 *   LP-C signs $300,000 commitment    -> spv.committed_minor = 100_000_000
 *
 *   Capital call #1 for $200,000      -> spv.called_minor      = 20_000_000
 *   Capital call #2 for $300,000      -> spv.called_minor      = 50_000_000
 *
 *   Dividend distribution $50,000     -> spv.distributed_minor = 5_000_000
 *
 *   uncalled_minor     = 100_000_000 - 50_000_000 = 50_000_000   ($500k uncalled)
 *   net_invested_minor =  50_000_000 -  5_000_000 = 45_000_000   ($450k working capital)
 *
 *   Invariant I-2 check on $1,000,000 exit distribution:
 *     committed_minor (100M) >= distributed_minor + total_minor + called_minor
 *     100M >= 5M + 100M + 50M  ==> FALSE  -> 422 ECON_INVARIANT
 *
 *   So the GP would have to call more capital first OR distribute less.
 *
 * ============================================================================
 *
 * All writes are inside SYNC `db.transaction((tx) => {...})`. Hashes are
 * pre-computed BEFORE opening the transaction (better-sqlite3 forbids async
 * tx callbacks). Cross-tenant reads are marked inline.
 *
 * Feature flag: CONSORTIUM_ENABLED. When unset OR === "0", endpoints
 * return 503 gracefully. When set === "1" (or absent, defaulting to
 * enabled for tests), endpoints serve.
 */

import type { Express, Request, Response } from "express";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth"; /* v25.14 NH3 */
import { getDb, rawDb } from "./db/connection";
/* v25.33 — additive SPV deployment-fee charge (NEW server/lib/ module; does
 * NOT modify any SPV/cap-table BigInt math). Called once, additively, at the
 * end of updateSpv()'s existing transaction when status -> 'active'. */
import { chargeSpvDeploymentFee } from "./lib/spvDeploymentFee";
import {
  spvs as spvsTable,
  spvCommitments as spvCommitmentsTable,
  spvCapitalCalls as spvCapitalCallsTable,
  spvDistributions as spvDistributionsTable,
  spvPositions as spvPositionsTable,
} from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { log, errorMeta } from "./lib/logger";

/* ============================================================
 * Types
 * ============================================================ */

export type SpvStructureType = "spv" | "fund" | "syndicate";
export type SpvStatus = "forming" | "fundraising" | "active" | "wound_down";
export type CommitmentStatus = "pending" | "signed" | "funded" | "withdrawn";
export type DistributionType = "dividend" | "exit" | "return_of_capital";
export type PositionStatus = "held" | "partially_sold" | "exited";

export interface SpvRow {
  id: string;
  tenantId: string;
  partnerId: string;
  name: string;
  leadCompanyId: string | null;
  structureType: SpvStructureType;
  status: SpvStatus;
  targetMinor: number;
  committedMinor: number;
  calledMinor: number;
  distributedMinor: number;
  gpUserId: string | null;
  formedAt: string | null;
  closesAt: string | null;
  /** Parsed JSON; serialised as TEXT on disk. */
  terms: Record<string, unknown>;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SpvCommitmentRow {
  id: string;
  tenantId: string;
  spvId: string;
  lpUserId: string;
  amountMinor: number;
  status: CommitmentStatus;
  commitmentDocUrl: string | null;
  signedAt: string | null;
  fundedAt: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpvCapitalCallRow {
  id: string;
  tenantId: string;
  spvId: string;
  sequenceNo: number;
  amountMinor: number;
  calledAt: string;
  dueAt: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
}

export interface SpvDistributionRow {
  id: string;
  tenantId: string;
  spvId: string;
  distributionType: DistributionType;
  totalMinor: number;
  distributedAt: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
}

export interface SpvPositionRow {
  id: string;
  tenantId: string;
  spvId: string;
  securityId: string;
  shares: string;
  basisMinor: number;
  acquiredAt: string | null;
  status: PositionStatus;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

/* ============================================================
 * Caches (Map+DB hybrid)
 * ============================================================ */

const spvsCache = new Map<string, SpvRow>();
const commitmentsCache = new Map<string, SpvCommitmentRow>();
const capitalCallsCache = new Map<string, SpvCapitalCallRow>();
const distributionsCache = new Map<string, SpvDistributionRow>();
const positionsCache = new Map<string, SpvPositionRow>();

/* ============================================================
 * Helpers
 * ============================================================ */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function safeJson(s: unknown, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (s && typeof s === "object" && !Array.isArray(s)) return s as Record<string, unknown>;
  if (typeof s !== "string" || s.length === 0) return fallback;
  try {
    const v = JSON.parse(s);
    return (v && typeof v === "object" && !Array.isArray(v)) ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Coerce a Drizzle/SQLite row into a typed SpvRow. */
function rowToSpv(r: any): SpvRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ""),
    partnerId: String(r.partnerId ?? r.partner_id ?? ""),
    name: String(r.name ?? ""),
    leadCompanyId: (r.leadCompanyId ?? r.lead_company_id ?? null) as string | null,
    structureType: (r.structureType ?? r.structure_type ?? "spv") as SpvStructureType,
    status: (r.status ?? "forming") as SpvStatus,
    targetMinor: Number(r.targetMinor ?? r.target_minor ?? 0),
    committedMinor: Number(r.committedMinor ?? r.committed_minor ?? 0),
    calledMinor: Number(r.calledMinor ?? r.called_minor ?? 0),
    distributedMinor: Number(r.distributedMinor ?? r.distributed_minor ?? 0),
    gpUserId: (r.gpUserId ?? r.gp_user_id ?? null) as string | null,
    formedAt: (r.formedAt ?? r.formed_at ?? null) as string | null,
    closesAt: (r.closesAt ?? r.closes_at ?? null) as string | null,
    terms: safeJson(r.terms),
    prevHash: (r.prevHash ?? r.prev_hash ?? null) as string | null,
    currHash: String(r.currHash ?? r.curr_hash ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ""),
    deletedAt: (r.deletedAt ?? r.deleted_at ?? null) as string | null,
  };
}

function rowToCommitment(r: any): SpvCommitmentRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ""),
    spvId: String(r.spvId ?? r.spv_id ?? ""),
    lpUserId: String(r.lpUserId ?? r.lp_user_id ?? ""),
    amountMinor: Number(r.amountMinor ?? r.amount_minor ?? 0),
    status: (r.status ?? "pending") as CommitmentStatus,
    commitmentDocUrl: (r.commitmentDocUrl ?? r.commitment_doc_url ?? null) as string | null,
    signedAt: (r.signedAt ?? r.signed_at ?? null) as string | null,
    fundedAt: (r.fundedAt ?? r.funded_at ?? null) as string | null,
    prevHash: (r.prevHash ?? r.prev_hash ?? null) as string | null,
    currHash: String(r.currHash ?? r.curr_hash ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ""),
  };
}

function rowToCapitalCall(r: any): SpvCapitalCallRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ""),
    spvId: String(r.spvId ?? r.spv_id ?? ""),
    sequenceNo: Number(r.sequenceNo ?? r.sequence_no ?? 0),
    amountMinor: Number(r.amountMinor ?? r.amount_minor ?? 0),
    calledAt: String(r.calledAt ?? r.called_at ?? ""),
    dueAt: (r.dueAt ?? r.due_at ?? null) as string | null,
    prevHash: (r.prevHash ?? r.prev_hash ?? null) as string | null,
    currHash: String(r.currHash ?? r.curr_hash ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
  };
}

function rowToDistribution(r: any): SpvDistributionRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ""),
    spvId: String(r.spvId ?? r.spv_id ?? ""),
    distributionType: (r.distributionType ?? r.distribution_type ?? "dividend") as DistributionType,
    totalMinor: Number(r.totalMinor ?? r.total_minor ?? 0),
    distributedAt: String(r.distributedAt ?? r.distributed_at ?? ""),
    prevHash: (r.prevHash ?? r.prev_hash ?? null) as string | null,
    currHash: String(r.currHash ?? r.curr_hash ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
  };
}

function rowToPosition(r: any): SpvPositionRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId ?? r.tenant_id ?? ""),
    spvId: String(r.spvId ?? r.spv_id ?? ""),
    securityId: String(r.securityId ?? r.security_id ?? ""),
    shares: String(r.shares ?? "0"),
    basisMinor: Number(r.basisMinor ?? r.basis_minor ?? 0),
    acquiredAt: (r.acquiredAt ?? r.acquired_at ?? null) as string | null,
    status: (r.status ?? "held") as PositionStatus,
    prevHash: (r.prevHash ?? r.prev_hash ?? null) as string | null,
    currHash: String(r.currHash ?? r.curr_hash ?? ""),
    createdAt: String(r.createdAt ?? r.created_at ?? ""),
    updatedAt: String(r.updatedAt ?? r.updated_at ?? ""),
  };
}

/* ============================================================
 * Feature flag
 * ============================================================ */

/**
 * CONSORTIUM_ENABLED. Default ON (= "1") when unset to keep running tests
 * working. Explicit "0" disables (route returns 503).
 */
function consortiumEnabled(): boolean {
  const v = process.env.CONSORTIUM_ENABLED;
  if (v === undefined || v === null) return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

function gate(_req: Request, res: Response): boolean {
  if (consortiumEnabled()) return true;
  res.status(503).json({
    error: "CONSORTIUM_DISABLED",
    message: "Consortium SPV/fund endpoints are disabled (CONSORTIUM_ENABLED=0).",
  });
  return false;
}

/* ============================================================
 * Tenant helper
 * ============================================================ */

function tenantForPartner(partnerId: string): string {
  return `tenant_partner_${partnerId}`;
}

/* ============================================================
 * Schemas
 * ============================================================ */

const spvCreateSchema = z.object({
  name: z.string().min(1).max(200),
  lead_company_id: z.string().optional().nullable(),
  structure_type: z.enum(["spv", "fund", "syndicate"]).optional(),
  target_minor: z.number().int().min(0).optional(),
  formed_at: z.string().optional().nullable(),
  closes_at: z.string().optional().nullable(),
  terms: z.record(z.unknown()).optional(),
});

const spvUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  lead_company_id: z.string().nullable().optional(),
  structure_type: z.enum(["spv", "fund", "syndicate"]).optional(),
  status: z.enum(["forming", "fundraising", "active", "wound_down"]).optional(),
  target_minor: z.number().int().min(0).optional(),
  formed_at: z.string().nullable().optional(),
  closes_at: z.string().nullable().optional(),
  terms: z.record(z.unknown()).optional(),
});

const commitmentCreateSchema = z.object({
  lp_user_id: z.string().min(1),
  amount_minor: z.number().int().min(0),
  commitment_doc_url: z.string().url().optional().nullable(),
});

const commitmentTransitionSchema = z.object({
  status: z.enum(["pending", "signed", "funded", "withdrawn"]),
});

const capitalCallSchema = z.object({
  amount_minor: z.number().int().min(0),
  called_at: z.string().optional(),
  due_at: z.string().optional().nullable(),
});

const distributionSchema = z.object({
  distribution_type: z.enum(["dividend", "exit", "return_of_capital"]).optional(),
  total_minor: z.number().int().min(0),
  distributed_at: z.string().optional(),
});

const positionSchema = z.object({
  security_id: z.string().min(1),
  shares: z.string().min(1),
  basis_minor: z.number().int().min(0),
  acquired_at: z.string().optional().nullable(),
});

const positionUpdateSchema = z.object({
  shares: z.string().min(1).optional(),
  basis_minor: z.number().int().min(0).optional(),
  status: z.enum(["held", "partially_sold", "exited"]).optional(),
});

/* ============================================================
 * Chain tip helpers — read latest curr_hash for a sub-table chain.
 *
 * Chains are partitioned per spv_id (commitments, capital_calls,
 * distributions, positions) and per partner_id (spvs). The tip read
 * happens INSIDE the SYNC tx so concurrent writers don't race.
 * ============================================================ */

function chainTipForSpvHeader(db: any, partnerId: string): string | null {
  // CP Phase A — fix: tiebreak by SQLite rowid (monotonic insertion order)
  // to avoid chain breakage when multiple rows share the same createdAt
  // millisecond (id is random hex, not monotonic). See spvFundDb.test.ts
  // "hash chain: spv_capital_calls chain links per SPV".
  const r = db
    .select({ h: (spvsTable as any).currHash })
    .from(spvsTable)
    .where(eq((spvsTable as any).partnerId, partnerId))
    .orderBy(desc((spvsTable as any).createdAt), sql`rowid DESC`)
    .limit(1)
    .all() as Array<{ h: string | null }>;
  if (!r.length) return null;
  return r[0].h ?? null;
}

function chainTipForSpvScoped(db: any, table: any, spvId: string): string | null {
  // CP Phase A — fix: tiebreak by SQLite rowid (monotonic insertion order)
  // to avoid chain breakage when multiple rows share the same createdAt
  // millisecond. See spvFundDb.test.ts capital calls chain test.
  const r = db
    .select({ h: table.currHash })
    .from(table)
    .where(eq(table.spvId, spvId))
    .orderBy(desc(table.createdAt), sql`rowid DESC`)
    .limit(1)
    .all() as Array<{ h: string | null }>;
  if (!r.length) return null;
  return r[0].h ?? null;
}

/* ============================================================
 * MATH SACRED — BigInt-only aggregation primitives.
 *
 * These functions are the heart of CP-028. They DO NOT touch
 * cap-table math.
 * ============================================================ */

export interface SpvReconciliation {
  committedMinor: bigint;
  calledMinor: bigint;
  distributedMinor: bigint;
  uncalledMinor: bigint;
  netInvestedMinor: bigint;
  totalBasisMinor: bigint;
}

export function reconcileSpv(spvId: string): SpvReconciliation {
  // Use BigInt(0) instead of `0n` to keep the file compatible with the
  // repo's tsconfig (no explicit ES2020 target). Math is identical.
  let committed: bigint = BigInt(0);
  let called: bigint = BigInt(0);
  let distributed: bigint = BigInt(0);
  let basis: bigint = BigInt(0);
  for (const c of Array.from(commitmentsCache.values())) {
    if (c.spvId !== spvId) continue;
    if (c.status === "signed" || c.status === "funded") {
      committed += BigInt(c.amountMinor);
    }
  }
  for (const cc of Array.from(capitalCallsCache.values())) {
    if (cc.spvId !== spvId) continue;
    called += BigInt(cc.amountMinor);
  }
  for (const d of Array.from(distributionsCache.values())) {
    if (d.spvId !== spvId) continue;
    distributed += BigInt(d.totalMinor);
  }
  for (const p of Array.from(positionsCache.values())) {
    if (p.spvId !== spvId) continue;
    if (p.status === "held" || p.status === "partially_sold") {
      basis += BigInt(p.basisMinor);
    }
  }
  return {
    committedMinor: committed,
    calledMinor: called,
    distributedMinor: distributed,
    uncalledMinor: committed - called,
    netInvestedMinor: called - distributed,
    totalBasisMinor: basis,
  };
}

/* ============================================================
 * Public store API (programmatic — used by seedDemoData + tests)
 * ============================================================ */

export const spvFundStore = {
  /** List all SPVs owned by partnerId, sorted by created_at desc. */
  listByPartner(partnerId: string): SpvRow[] {
    const out: SpvRow[] = [];
    for (const r of Array.from(spvsCache.values())) {
      if (r.partnerId === partnerId && !r.deletedAt) out.push(r);
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  },

  getById(spvId: string): SpvRow | null {
    const r = spvsCache.get(spvId);
    if (!r || r.deletedAt) return null;
    return r;
  },

  listCommitments(spvId: string): SpvCommitmentRow[] {
    const out: SpvCommitmentRow[] = [];
    for (const c of Array.from(commitmentsCache.values())) {
      if (c.spvId === spvId) out.push(c);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  },

  listCapitalCalls(spvId: string): SpvCapitalCallRow[] {
    const out: SpvCapitalCallRow[] = [];
    for (const c of Array.from(capitalCallsCache.values())) {
      if (c.spvId === spvId) out.push(c);
    }
    out.sort((a, b) => a.sequenceNo - b.sequenceNo);
    return out;
  },

  listDistributions(spvId: string): SpvDistributionRow[] {
    const out: SpvDistributionRow[] = [];
    for (const d of Array.from(distributionsCache.values())) {
      if (d.spvId === spvId) out.push(d);
    }
    out.sort((a, b) => a.distributedAt.localeCompare(b.distributedAt));
    return out;
  },

  listPositions(spvId: string): SpvPositionRow[] {
    const out: SpvPositionRow[] = [];
    for (const p of Array.from(positionsCache.values())) {
      if (p.spvId === spvId) out.push(p);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  },

  reconcile: reconcileSpv,

  /**
   * Create a new SPV. Used by both the HTTP layer and the demo seeder.
   * Returns the persisted row (with computed currHash).
   */
  createSpv(args: {
    partnerId: string;
    name: string;
    leadCompanyId?: string | null;
    structureType?: SpvStructureType;
    status?: SpvStatus;
    targetMinor?: number;
    gpUserId?: string | null;
    formedAt?: string | null;
    closesAt?: string | null;
    terms?: Record<string, unknown>;
    /** v24.5 GAP-7 — optional override id (used by shadowPersistFromLegacy
     * to preserve the legacy pspv_* id so commitments/capital-calls/
     * distributions routes can look up by the same id they received from
     * POST /api/partner/me/spvs). */
    _overrideId?: string;
  }): SpvRow {
    const id = args._overrideId ?? newId("spv");
    const now = nowIso();
    const tenantId = tenantForPartner(args.partnerId);
    const payload = {
      id,
      partnerId: args.partnerId,
      name: args.name,
      structureType: args.structureType ?? "spv",
      targetMinor: args.targetMinor ?? 0,
      createdAt: now,
    };
    const db: any = getDb();
    let prevHash: string | null = null;
    let row: SpvRow | null = null;
    db.transaction((tx: any) => {
      prevHash = chainTipForSpvHeader(tx, args.partnerId);
      const currHash = computeHash(prevHash, payload);
      row = {
        id,
        tenantId,
        partnerId: args.partnerId,
        name: args.name,
        leadCompanyId: args.leadCompanyId ?? null,
        structureType: args.structureType ?? "spv",
        status: args.status ?? "forming",
        targetMinor: args.targetMinor ?? 0,
        committedMinor: 0,
        calledMinor: 0,
        distributedMinor: 0,
        gpUserId: args.gpUserId ?? null,
        formedAt: args.formedAt ?? null,
        closesAt: args.closesAt ?? null,
        terms: args.terms ?? {},
        prevHash,
        currHash,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      tx.insert(spvsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        partnerId: row.partnerId,
        name: row.name,
        leadCompanyId: row.leadCompanyId,
        structureType: row.structureType,
        status: row.status,
        targetMinor: row.targetMinor,
        committedMinor: row.committedMinor,
        calledMinor: row.calledMinor,
        distributedMinor: row.distributedMinor,
        gpUserId: row.gpUserId,
        formedAt: row.formedAt,
        closesAt: row.closesAt,
        terms: JSON.stringify(row.terms),
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        deletedAt: null,
      }).run();
    });
    const finalRow = row as SpvRow | null;
    if (!finalRow) throw new Error("SPV_CREATE_FAILED");
    spvsCache.set(finalRow.id, finalRow);
    return finalRow;
  },

  /**
   * Add an LP commitment to the SPV. Status starts at 'pending' unless
   * the caller passes 'signed' (used by seedDemoData).
   */
  addCommitment(args: {
    spvId: string;
    lpUserId: string;
    amountMinor: number;
    status?: CommitmentStatus;
    commitmentDocUrl?: string | null;
  }): SpvCommitmentRow {
    const spv = spvsCache.get(args.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");
    const id = newId("spc");
    const now = nowIso();
    const initialStatus: CommitmentStatus = args.status ?? "pending";
    const signedAt = initialStatus === "signed" || initialStatus === "funded" ? now : null;
    const fundedAt = initialStatus === "funded" ? now : null;
    const payload = {
      id,
      spvId: args.spvId,
      lpUserId: args.lpUserId,
      amountMinor: args.amountMinor,
      status: initialStatus,
      createdAt: now,
    };
    const db: any = getDb();
    let row: SpvCommitmentRow | null = null;
    db.transaction((tx: any) => {
      const prevHash = chainTipForSpvScoped(tx, spvCommitmentsTable as any, args.spvId);
      const currHash = computeHash(prevHash, payload);
      row = {
        id,
        tenantId: spv.tenantId,
        spvId: args.spvId,
        lpUserId: args.lpUserId,
        amountMinor: args.amountMinor,
        status: initialStatus,
        commitmentDocUrl: args.commitmentDocUrl ?? null,
        signedAt,
        fundedAt,
        prevHash,
        currHash,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(spvCommitmentsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        spvId: row.spvId,
        lpUserId: row.lpUserId,
        amountMinor: row.amountMinor,
        status: row.status,
        commitmentDocUrl: row.commitmentDocUrl,
        signedAt: row.signedAt,
        fundedAt: row.fundedAt,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }).run();
      // Update SPV denorms when commitment lands in counted statuses.
      if (initialStatus === "signed" || initialStatus === "funded") {
        const nextCommitted = spv.committedMinor + args.amountMinor;
        tx.update(spvsTable)
          .set({ committedMinor: nextCommitted, updatedAt: now })
          .where(eq((spvsTable as any).id, spv.id))
          .run();
        spv.committedMinor = nextCommitted;
        spv.updatedAt = now;
      }
    });
    const finalRow = row as SpvCommitmentRow | null;
    if (!finalRow) throw new Error("COMMITMENT_CREATE_FAILED");
    commitmentsCache.set(finalRow.id, finalRow);
    spvsCache.set(spv.id, spv);
    return finalRow;
  },

  /**
   * Transition a commitment status. Drives denorm updates on the SPV
   * header: signed/funded count toward committed; withdrawn subtracts.
   */
  transitionCommitment(args: { commitmentId: string; status: CommitmentStatus }): SpvCommitmentRow {
    const c = commitmentsCache.get(args.commitmentId);
    if (!c) throw new Error("COMMITMENT_NOT_FOUND");
    const spv = spvsCache.get(c.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");
    const nextStatus = args.status;
    if (nextStatus === c.status) return c;

    const now = nowIso();
    const wasCounted = c.status === "signed" || c.status === "funded";
    const nowCounted = nextStatus === "signed" || nextStatus === "funded";
    const committedDelta =
      (nowCounted ? c.amountMinor : 0) - (wasCounted ? c.amountMinor : 0);

    const payload = {
      id: c.id,
      spvId: c.spvId,
      status: nextStatus,
      transitionedAt: now,
    };

    const db: any = getDb();
    let next: SpvCommitmentRow | null = null;
    db.transaction((tx: any) => {
      const prevHash = chainTipForSpvScoped(tx, spvCommitmentsTable as any, c.spvId);
      const currHash = computeHash(prevHash, payload);
      next = {
        ...c,
        status: nextStatus,
        signedAt:
          nextStatus === "signed" || nextStatus === "funded"
            ? c.signedAt ?? now
            : c.signedAt,
        fundedAt: nextStatus === "funded" ? c.fundedAt ?? now : c.fundedAt,
        prevHash,
        currHash,
        updatedAt: now,
      };
      tx.update(spvCommitmentsTable)
        .set({
          status: next.status,
          signedAt: next.signedAt,
          fundedAt: next.fundedAt,
          prevHash: next.prevHash,
          currHash: next.currHash,
          updatedAt: next.updatedAt,
        })
        .where(eq((spvCommitmentsTable as any).id, c.id))
        .run();
      if (committedDelta !== 0) {
        const nextCommitted = spv.committedMinor + committedDelta;
        tx.update(spvsTable)
          .set({ committedMinor: nextCommitted, updatedAt: now })
          .where(eq((spvsTable as any).id, spv.id))
          .run();
        spv.committedMinor = nextCommitted;
        spv.updatedAt = now;
      }
    });
    const finalNext = next as SpvCommitmentRow | null;
    if (!finalNext) throw new Error("COMMITMENT_TRANSITION_FAILED");
    commitmentsCache.set(finalNext.id, finalNext);
    spvsCache.set(spv.id, spv);
    return finalNext;
  },

  /**
   * Record a capital call. Enforces invariant I-1 (strictly monotonic
   * sequence_no per spv_id) by reading the current max inside the tx.
   */
  recordCapitalCall(args: {
    spvId: string;
    amountMinor: number;
    calledAt?: string;
    dueAt?: string | null;
  }): SpvCapitalCallRow {
    const spv = spvsCache.get(args.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");
    const id = newId("scc");
    const now = nowIso();
    const calledAt = args.calledAt ?? now;
    const db: any = getDb();
    let row: SpvCapitalCallRow | null = null;
    db.transaction((tx: any) => {
      // I-1 — strict monotonicity check inside the same tx as the insert.
      const maxRows = tx
        .select({ seq: (spvCapitalCallsTable as any).sequenceNo })
        .from(spvCapitalCallsTable)
        .where(eq((spvCapitalCallsTable as any).spvId, args.spvId))
        .orderBy(desc((spvCapitalCallsTable as any).sequenceNo))
        .limit(1)
        .all() as Array<{ seq: number }>;
      const lastSeq = maxRows.length ? Number(maxRows[0].seq) : 0;
      const nextSeq = lastSeq + 1;
      const payload = {
        id,
        spvId: args.spvId,
        sequenceNo: nextSeq,
        amountMinor: args.amountMinor,
        calledAt,
      };
      const prevHash = chainTipForSpvScoped(tx, spvCapitalCallsTable as any, args.spvId);
      const currHash = computeHash(prevHash, payload);
      row = {
        id,
        tenantId: spv.tenantId,
        spvId: args.spvId,
        sequenceNo: nextSeq,
        amountMinor: args.amountMinor,
        calledAt,
        dueAt: args.dueAt ?? null,
        prevHash,
        currHash,
        createdAt: now,
      };
      tx.insert(spvCapitalCallsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        spvId: row.spvId,
        sequenceNo: row.sequenceNo,
        amountMinor: row.amountMinor,
        calledAt: row.calledAt,
        dueAt: row.dueAt,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
      }).run();
      // Denorm: update spv.called_minor in lockstep.
      const nextCalled = spv.calledMinor + args.amountMinor;
      tx.update(spvsTable)
        .set({ calledMinor: nextCalled, updatedAt: now })
        .where(eq((spvsTable as any).id, spv.id))
        .run();
      spv.calledMinor = nextCalled;
      spv.updatedAt = now;
    });
    const finalRow = row as SpvCapitalCallRow | null;
    if (!finalRow) throw new Error("CAPITAL_CALL_FAILED");
    capitalCallsCache.set(finalRow.id, finalRow);
    spvsCache.set(spv.id, spv);
    return finalRow;
  },

  /**
   * Record a distribution. Enforces invariant I-2 BEFORE writing.
   *
   *    committedMinor >= distributedMinor (incl. new total_minor) + calledMinor
   *
   * Throws `INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS` if violated;
   * the HTTP layer maps this to 422.
   */
  recordDistribution(args: {
    spvId: string;
    distributionType?: DistributionType;
    totalMinor: number;
    distributedAt?: string;
  }): SpvDistributionRow {
    const spv = spvsCache.get(args.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");

    // I-2 invariant check using BigInt math (math-sacred boundary).
    const committed = BigInt(spv.committedMinor);
    const called = BigInt(spv.calledMinor);
    const distributedExisting = BigInt(spv.distributedMinor);
    const distributedNew = distributedExisting + BigInt(args.totalMinor);
    if (committed < distributedNew + called) {
      throw new Error("INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS");
    }

    const id = newId("scd");
    const now = nowIso();
    const distributedAt = args.distributedAt ?? now;
    const distributionType = args.distributionType ?? "dividend";
    const payload = {
      id,
      spvId: args.spvId,
      distributionType,
      totalMinor: args.totalMinor,
      distributedAt,
    };
    const db: any = getDb();
    let row: SpvDistributionRow | null = null;
    db.transaction((tx: any) => {
      const prevHash = chainTipForSpvScoped(tx, spvDistributionsTable as any, args.spvId);
      const currHash = computeHash(prevHash, payload);
      row = {
        id,
        tenantId: spv.tenantId,
        spvId: args.spvId,
        distributionType,
        totalMinor: args.totalMinor,
        distributedAt,
        prevHash,
        currHash,
        createdAt: now,
      };
      tx.insert(spvDistributionsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        spvId: row.spvId,
        distributionType: row.distributionType,
        totalMinor: row.totalMinor,
        distributedAt: row.distributedAt,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
      }).run();
      const nextDistributed = spv.distributedMinor + args.totalMinor;
      tx.update(spvsTable)
        .set({ distributedMinor: nextDistributed, updatedAt: now })
        .where(eq((spvsTable as any).id, spv.id))
        .run();
      spv.distributedMinor = nextDistributed;
      spv.updatedAt = now;
    });
    const finalRow = row as SpvDistributionRow | null;
    if (!finalRow) throw new Error("DISTRIBUTION_FAILED");
    distributionsCache.set(finalRow.id, finalRow);
    spvsCache.set(spv.id, spv);
    return finalRow;
  },

  /** Record a held position. */
  recordPosition(args: {
    spvId: string;
    securityId: string;
    shares: string;
    basisMinor: number;
    acquiredAt?: string | null;
    status?: PositionStatus;
  }): SpvPositionRow {
    const spv = spvsCache.get(args.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");
    const id = newId("spp");
    const now = nowIso();
    const payload = {
      id,
      spvId: args.spvId,
      securityId: args.securityId,
      shares: args.shares,
      basisMinor: args.basisMinor,
      status: args.status ?? "held",
      createdAt: now,
    };
    const db: any = getDb();
    let row: SpvPositionRow | null = null;
    db.transaction((tx: any) => {
      const prevHash = chainTipForSpvScoped(tx, spvPositionsTable as any, args.spvId);
      const currHash = computeHash(prevHash, payload);
      row = {
        id,
        tenantId: spv.tenantId,
        spvId: args.spvId,
        securityId: args.securityId,
        shares: args.shares,
        basisMinor: args.basisMinor,
        acquiredAt: args.acquiredAt ?? null,
        status: args.status ?? "held",
        prevHash,
        currHash,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(spvPositionsTable).values({
        id: row.id,
        tenantId: row.tenantId,
        spvId: row.spvId,
        securityId: row.securityId,
        shares: row.shares,
        basisMinor: row.basisMinor,
        acquiredAt: row.acquiredAt,
        status: row.status,
        prevHash: row.prevHash,
        currHash: row.currHash,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }).run();
    });
    const finalRow = row as SpvPositionRow | null;
    if (!finalRow) throw new Error("POSITION_FAILED");
    positionsCache.set(finalRow.id, finalRow);
    return finalRow;
  },

  /**
   * Update SPV header fields. Status transitions include the kill-switch:
   * any state -> 'forming' is permitted (GP only — enforced at HTTP layer
   * via requirePartnerAuth + gpUserId match). Other transitions are
   * unrestricted record-keeping.
   */
  updateSpv(args: {
    spvId: string;
    actor: string;
    patch: Partial<{
      name: string;
      leadCompanyId: string | null;
      structureType: SpvStructureType;
      status: SpvStatus;
      targetMinor: number;
      formedAt: string | null;
      closesAt: string | null;
      terms: Record<string, unknown>;
    }>;
  }): SpvRow {
    const spv = spvsCache.get(args.spvId);
    if (!spv || spv.deletedAt) throw new Error("SPV_NOT_FOUND");
    // CP-029 kill-switch: any status -> 'forming' requires the actor to be
    // the spv.gp_user_id (or — if unset — the partner-team admin via
    // requirePartnerAuth at HTTP layer). The HTTP layer does the gpUserId
    // check; the store accepts the patch.
    const now = nowIso();
    const payload = {
      id: spv.id,
      partnerId: spv.partnerId,
      patch: args.patch,
      updatedAt: now,
    };
    const db: any = getDb();
    let next: SpvRow | null = null;
    db.transaction((tx: any) => {
      const prevHash = chainTipForSpvHeader(tx, spv.partnerId);
      const currHash = computeHash(prevHash, payload);
      next = {
        ...spv,
        name: args.patch.name ?? spv.name,
        leadCompanyId: args.patch.leadCompanyId === undefined ? spv.leadCompanyId : args.patch.leadCompanyId,
        structureType: args.patch.structureType ?? spv.structureType,
        status: args.patch.status ?? spv.status,
        targetMinor: args.patch.targetMinor ?? spv.targetMinor,
        formedAt: args.patch.formedAt === undefined ? spv.formedAt : args.patch.formedAt,
        closesAt: args.patch.closesAt === undefined ? spv.closesAt : args.patch.closesAt,
        terms: args.patch.terms ?? spv.terms,
        prevHash,
        currHash,
        updatedAt: now,
      };
      tx.update(spvsTable)
        .set({
          name: next.name,
          leadCompanyId: next.leadCompanyId,
          structureType: next.structureType,
          status: next.status,
          targetMinor: next.targetMinor,
          formedAt: next.formedAt,
          closesAt: next.closesAt,
          terms: JSON.stringify(next.terms),
          prevHash: next.prevHash,
          currHash: next.currHash,
          updatedAt: next.updatedAt,
        })
        .where(eq((spvsTable as any).id, spv.id))
        .run();

      /* v25.33 — ADDITIVE consortium-partner deployment fee. Avi's write above
       * is byte-identical and already executed. We add ONE additive call here,
       * inside the SAME transaction, ONLY when the SPV is transitioning INTO
       * 'active' (deployment) AND it carries a sourcing_partner_id. The fee
       * amount/currency/band come entirely from the DB via partnerFeeResolver
       * (fail-closed; degrades gracefully without rolling back Avi's status
       * write). chargeSpvDeploymentFee is idempotent, so a re-save of an
       * already-active SPV never double-charges. No SPV/cap-table BigInt math
       * is touched. rawDb() is the SAME underlying connection the drizzle txn
       * runs on, so these statements participate in this transaction. */
      if (next.status === "active" && spv.status !== "active") {
        try {
          const raw = rawDb();
          const spvDbRow = raw
            .prepare(`SELECT sourcing_partner_id, target_minor, committed_minor FROM spvs WHERE id = ?`)
            .get(spv.id) as { sourcing_partner_id: string | null; target_minor: number | null; committed_minor: number | null } | undefined;
          const sourcingPartnerId = spvDbRow?.sourcing_partner_id ?? null;
          if (sourcingPartnerId) {
            // Band on committed_minor when present, else fall back to target_minor.
            const sizeMinor = Number(spvDbRow?.committed_minor ?? spvDbRow?.target_minor ?? next.targetMinor ?? 0);
            chargeSpvDeploymentFee({ rawTx: raw, spvId: spv.id, partnerId: sourcingPartnerId, committedMinor: sizeMinor });
          }
        } catch (feeErr) {
          // Never let the additive fee charge break Avi's status transition.
          log.warn(errorMeta("spv.chargeDeploymentFee", feeErr, { spvId: spv.id }));
        }
      }
    });
    const finalNext = next as SpvRow | null;
    if (!finalNext) throw new Error("SPV_UPDATE_FAILED");
    spvsCache.set(finalNext.id, finalNext);
    return finalNext;
  },

  /**
   * CP-028 shadow-persist: called from the legacy partnerWorkspaceStore.create()
   * to mirror an in-memory SPV into the DB so it survives restart. Idempotent
   * on (partnerId, name): a second call with the same identity is a no-op.
   */
  shadowPersistFromLegacy(args: {
    legacyId: string;
    partnerId: string;
    name: string;
    leadCompanyId?: string | null;
    gpUserId?: string | null;
    targetMinor?: number;
    formedAt?: string | null;
    status?: string;
  }): SpvRow | null {
    try {
      // v24.5 GAP-7 idempotency check: if a row with the SAME legacy id already
      // exists in spvsCache, return it immediately (handles retry after restart).
      const byLegacyId = spvsCache.get(args.legacyId);
      if (byLegacyId) return byLegacyId;
      // Secondary idempotency: any existing SPV with same (partnerId, name).
      // (Pre-v24.5 behaviour: the row was created with a generated id, not the
      // legacy id. We still respect it to avoid duplicate rows on upgrade.)
      for (const r of Array.from(spvsCache.values())) {
        if (r.partnerId === args.partnerId && r.name === args.name) return r;
      }
      // Legacy status vocabulary (`open`/`closed`/`planned`) -> new SpvStatus.
      const mappedStatus: SpvStatus =
        args.status === "open" ? "fundraising" :
        args.status === "closed" ? "active" :
        args.status === "wound_down" ? "wound_down" :
        "forming";
      // v24.5 GAP-7 KEY FIX: pass the legacy pspv_* id as _overrideId so the
      // spvFundStore row carries the SAME id the legacy partnerSpvStore
      // returned to the caller. This makes GET commitments/capital-calls/
      // distributions work immediately after POST /api/partner/me/spvs without
      // any id translation layer.
      return spvFundStore.createSpv({
        partnerId: args.partnerId,
        name: args.name,
        leadCompanyId: args.leadCompanyId ?? null,
        structureType: "spv",
        status: mappedStatus,
        targetMinor: args.targetMinor ?? 0,
        gpUserId: args.gpUserId ?? null,
        formedAt: args.formedAt ?? null,
        _overrideId: args.legacyId,
      });
    } catch (e) {
      log.warn(errorMeta("spv.shadowPersist", e, { partnerId: args.partnerId, name: args.name }));
      return null;
    }
  },

  /**
   * CP-028 shadow-persist: mirror a legacy SPV position into the DB-backed
   * spv_commitments table. Finds the SPV by (partnerId, legacy SPV id mapping)
   * by looking it up via name match — if no shadow SPV exists yet, creates
   * a minimal one first. Idempotent on (spvId, lpUserId).
   */
  shadowCommitmentFromLegacy(args: {
    legacyId: string;
    legacySpvId: string;
    partnerId: string;
    lpUserId: string;
    amountMinor: number;
  }): SpvCommitmentRow | null {
    try {
      // v24.5 GAP-7: try the legacySpvId directly first (now that
      // shadowPersistFromLegacy preserves the pspv_* id as the spvsCache key).
      let target: SpvRow | null = spvsCache.get(args.legacySpvId) ?? null;
      if (target && target.partnerId !== args.partnerId) target = null;
      // Fallback: pick the most recent SPV for the partner.
      if (!target) {
        for (const r of Array.from(spvsCache.values())) {
          if (r.partnerId !== args.partnerId) continue;
          if (!target || r.createdAt > target.createdAt) target = r;
        }
      }
      if (!target) return null;
      // Idempotency check.
      for (const c of Array.from(commitmentsCache.values())) {
        if (c.spvId === target.id && c.lpUserId === args.lpUserId && c.amountMinor === args.amountMinor) {
          return c;
        }
      }
      return spvFundStore.addCommitment({
        spvId: target.id,
        lpUserId: args.lpUserId,
        amountMinor: args.amountMinor,
        status: "signed",
      });
    } catch (e) {
      log.warn(errorMeta("spv.shadowCommitment", e, { partnerId: args.partnerId, lpUserId: args.lpUserId }));
      return null;
    }
  },
};

/* ============================================================
 * HTTP routes
 *
 * Mounted from server/routes.ts via registerSpvFundRoutes(app).
 *
 * Preserves the v17/v18 public paths under /api/partner/me/spvs and
 * extends with the lifecycle endpoints (capital-call, distribution,
 * position) that CP-029/030/031 required.
 * ============================================================ */

export function registerSpvFundRoutes(app: Express): void {
  /* ---------- DB-BACKED DETAIL (kept on a non-conflicting path) ----------
   * The legacy /api/partner/me/spvs[/:id] routes in partnerRoutes.ts continue
   * to own the v17/v18 list/get/create/update surface for backward compat.
   * The new DB-backed detail view (with full reconciliation + child rows) is
   * exposed at /api/partner/me/spvs/:id/detail to avoid the path collision.
   */
  app.get("/api/partner/me/spvs/:id/detail", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    if (spv.partnerId !== ctx.partnerId) {
      res.status(403).json({ error: "NOT_OWNER" });
      return;
    }
    const positions = spvFundStore.listPositions(spv.id);
    const commitments = spvFundStore.listCommitments(spv.id);
    const capitalCalls = spvFundStore.listCapitalCalls(spv.id);
    const distributions = spvFundStore.listDistributions(spv.id);
    const recon = spvFundStore.reconcile(spv.id);
    res.json({
      spv,
      positions,
      commitments,
      capitalCalls,
      distributions,
      reconciliation: {
        committedMinor: recon.committedMinor.toString(),
        calledMinor: recon.calledMinor.toString(),
        distributedMinor: recon.distributedMinor.toString(),
        uncalledMinor: recon.uncalledMinor.toString(),
        netInvestedMinor: recon.netInvestedMinor.toString(),
        totalBasisMinor: recon.totalBasisMinor.toString(),
      },
    });
  });

  /* ---------- COMMITMENTS ---------- */
  app.get("/api/partner/me/spvs/:id/commitments", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    res.json({ commitments: spvFundStore.listCommitments(spv.id) });
  });

  // v25.14 NH3 — was missing the assertSubRole gate; any viewer/analyst
  // could create SPV commitment records (financial mutation). Restrict to
  // managing_partner only.
  app.post("/api/partner/me/spvs/:id/commitments", requirePartnerAuth, assertSubRole("managing_partner"), (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    const parsed = commitmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    try {
      const row = spvFundStore.addCommitment({
        spvId: spv.id,
        lpUserId: parsed.data.lp_user_id,
        amountMinor: parsed.data.amount_minor,
        commitmentDocUrl: parsed.data.commitment_doc_url ?? null,
      });
      ssePublish(ctx.partnerId, "spv", { type: "spv.commitment.created", spvId: spv.id, commitmentId: row.id });
      res.status(201).json({ ok: true, commitment: row });
    } catch (e) {
      log.error(errorMeta("spv.commitment.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
      res.status(500).json({ error: "COMMITMENT_FAILED" });
    }
  });

  // v25.23 NH-F fix — PATCH commitments was previously guarded by requirePartnerAuth only;
  // a viewer/analyst could mutate the `committedMinor` financial denorm. Match the POST gate
  // (v25.14 NH3) by adding assertSubRole("managing_partner").
  app.patch("/api/partner/me/spvs/:id/commitments/:commitmentId", requirePartnerAuth, assertSubRole("managing_partner"), (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    const parsed = commitmentTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    try {
      const row = spvFundStore.transitionCommitment({
        commitmentId: String(req.params.commitmentId),
        status: parsed.data.status,
      });
      ssePublish(ctx.partnerId, "spv", { type: "spv.commitment.transitioned", spvId: spv.id, commitmentId: row.id, status: row.status });
      res.json({ ok: true, commitment: row });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg === "COMMITMENT_NOT_FOUND") {
        res.status(404).json({ error: "NOT_FOUND" });
        return;
      }
      log.error(errorMeta("spv.commitment.transition", e, { partnerId: ctx.partnerId, spvId: spv.id }));
      res.status(500).json({ error: "TRANSITION_FAILED" });
    }
  });

  /* ---------- CAPITAL CALLS ---------- */
  app.get("/api/partner/me/spvs/:id/capital-calls", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    res.json({ capitalCalls: spvFundStore.listCapitalCalls(spv.id) });
  });

  // v25.23 NC-A + NH-F fix — with the partnerRoutes.ts stub removed, this real DB-backed
  // handler now wins dispatch. Add assertSubRole("managing_partner") to preserve the
  // financial gate that the stub previously enforced.
  app.post("/api/partner/me/spvs/:id/capital-calls", requirePartnerAuth, assertSubRole("managing_partner"), (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    const parsed = capitalCallSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    try {
      const row = spvFundStore.recordCapitalCall({
        spvId: spv.id,
        amountMinor: parsed.data.amount_minor,
        calledAt: parsed.data.called_at,
        dueAt: parsed.data.due_at ?? null,
      });
      ssePublish(ctx.partnerId, "spv", { type: "spv.capital_call.recorded", spvId: spv.id, sequenceNo: row.sequenceNo });
      res.status(201).json({ ok: true, capitalCall: row });
    } catch (e) {
      log.error(errorMeta("spv.capital_call.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
      res.status(500).json({ error: "CAPITAL_CALL_FAILED" });
    }
  });

  /* ---------- DISTRIBUTIONS ---------- */
  app.get("/api/partner/me/spvs/:id/distributions", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    res.json({ distributions: spvFundStore.listDistributions(spv.id) });
  });

  // v25.23 NC-A + NH-F fix — see capital-calls above; same gate-preservation rationale.
  app.post("/api/partner/me/spvs/:id/distributions", requirePartnerAuth, assertSubRole("managing_partner"), (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    const parsed = distributionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    try {
      const row = spvFundStore.recordDistribution({
        spvId: spv.id,
        distributionType: parsed.data.distribution_type,
        totalMinor: parsed.data.total_minor,
        distributedAt: parsed.data.distributed_at,
      });
      ssePublish(ctx.partnerId, "spv", { type: "spv.distribution.recorded", spvId: spv.id, distributionId: row.id });
      res.status(201).json({ ok: true, distribution: row });
    } catch (e) {
      const msg = (e as Error).message || "";
      if (msg === "INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS") {
        res.status(422).json({
          error: "INVARIANT_DISTRIBUTION_EXCEEDS_COMMITMENTS",
          message:
            "committed_minor must be >= distributed_minor + called_minor (CP-031).",
        });
        return;
      }
      log.error(errorMeta("spv.distribution.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
      res.status(500).json({ error: "DISTRIBUTION_FAILED" });
    }
  });

  /* ---------- DB-BACKED POSITIONS (non-conflicting path) ----------
   * Legacy /api/partner/me/spvs/:id/positions is kept by partnerRoutes.ts.
   * The DB-backed variant is exposed at /db-positions to avoid collision.
   */
  app.get("/api/partner/me/spvs/:id/db-positions", requirePartnerAuth, (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    res.json({ positions: spvFundStore.listPositions(spv.id) });
  });

  // v25.14 NH3 — same fix as commitments above; restrict to managing_partner.
  app.post("/api/partner/me/spvs/:id/db-positions", requirePartnerAuth, assertSubRole("managing_partner"), (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    const ctx = req.partnerContext!;
    const spv = spvFundStore.getById(String(req.params.id));
    if (!spv || spv.partnerId !== ctx.partnerId) {
      res.status(spv ? 403 : 404).json({ error: spv ? "NOT_OWNER" : "NOT_FOUND" });
      return;
    }
    const parsed = positionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_BODY", details: parsed.error.flatten() });
      return;
    }
    try {
      const row = spvFundStore.recordPosition({
        spvId: spv.id,
        securityId: parsed.data.security_id,
        shares: parsed.data.shares,
        basisMinor: parsed.data.basis_minor,
        acquiredAt: parsed.data.acquired_at ?? null,
      });
      ssePublish(ctx.partnerId, "spv", { type: "spv.position.recorded", spvId: spv.id, positionId: row.id });
      res.status(201).json({ ok: true, position: row });
    } catch (e) {
      log.error(errorMeta("spv.position.create", e, { partnerId: ctx.partnerId, spvId: spv.id }));
      res.status(500).json({ error: "POSITION_FAILED" });
    }
  });
}

/* ============================================================
 * Hydrator (called from server/lib/hydrateStores.ts).
 * Loads ALL 5 SPV tables in order: spvs → commitments → calls →
 * distributions → positions. Caches are repopulated entirely.
 * ============================================================ */

export async function hydrateSpvFundStore(): Promise<void> {
  try {
    const db: any = getDb();
    // CROSS-TENANT (admin) — hydrator loads ALL partners' SPVs into the
    // process-local cache. Per-request endpoints still enforce
    // ctx.partnerId ownership on every read.
    const spvRows = db.select().from(spvsTable).all() as any[];
    spvsCache.clear();
    for (const r of spvRows) {
      const row = rowToSpv(r);
      if (row.deletedAt) continue;
      spvsCache.set(row.id, row);
    }
    const commitRows = db.select().from(spvCommitmentsTable).all() as any[];
    commitmentsCache.clear();
    for (const r of commitRows) {
      const row = rowToCommitment(r);
      commitmentsCache.set(row.id, row);
    }
    const callRows = db.select().from(spvCapitalCallsTable).all() as any[];
    capitalCallsCache.clear();
    for (const r of callRows) {
      const row = rowToCapitalCall(r);
      capitalCallsCache.set(row.id, row);
    }
    const distRows = db.select().from(spvDistributionsTable).all() as any[];
    distributionsCache.clear();
    for (const r of distRows) {
      const row = rowToDistribution(r);
      distributionsCache.set(row.id, row);
    }
    const posRows = db.select().from(spvPositionsTable).all() as any[];
    positionsCache.clear();
    for (const r of posRows) {
      const row = rowToPosition(r);
      positionsCache.set(row.id, row);
    }
    log.info({
      route: "hydrate.spvFund",
      spvs: spvsCache.size,
      commitments: commitmentsCache.size,
      capitalCalls: capitalCallsCache.size,
      distributions: distributionsCache.size,
      positions: positionsCache.size,
    });
  } catch (e) {
    log.error(errorMeta("hydrate.spvFund", e));
  }
}

/* ============================================================
 * Test helpers — keep caches inspectable. Not exported to runtime.
 * ============================================================ */

export const _spvFundInternals = {
  spvsCache,
  commitmentsCache,
  capitalCallsCache,
  distributionsCache,
  positionsCache,
  computeHash,
  rowToSpv,
  rowToCommitment,
  rowToCapitalCall,
  rowToDistribution,
  rowToPosition,
};
