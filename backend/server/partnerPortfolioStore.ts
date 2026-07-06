/**
 * v25.50.0 Phase 3 (spec 3) — Consortium Partner "Private Portfolio".
 *
 * A NEW, non-sacred, CP-scoped company-profile store. It DELIBERATELY does NOT
 * touch the sacred founder profile stores (profileStore.ts /
 * companyProfileStore.ts). A partner keeps its OWN private view of a company's
 * profile — one row per (partnerId, companyId) — reusing the exact founder
 * CompanyProfile field taxonomy (contact/address/legal/ma) stored as an opaque
 * profile_json blob so the same client wizard + zod schema can drive it.
 *
 * All writes are DB-direct (rawDb better-sqlite3), fail-closed, and hash-chained
 * per row to match sibling partner stores. Table: partner_portfolio_company
 * (migration 0089, additive/idempotent).
 */
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import {
  companyProfilePatchSchema,
  type CompanyProfilePatch,
} from "../client/src/lib/profile/types";

const GENESIS = "0".repeat(64);

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function newId(): string {
  return `ppc_${randomBytes(8).toString("hex")}`;
}

export interface PortfolioCompany {
  id: string;
  partnerId: string;
  companyId: string;
  profile: Record<string, unknown>;
  prevHash: string;
  currHash: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

function rowToPortfolio(r: any): PortfolioCompany {
  let profile: Record<string, unknown> = {};
  try {
    profile = r.profile_json ? JSON.parse(r.profile_json) : {};
  } catch {
    profile = {};
  }
  return {
    id: r.id,
    partnerId: r.partner_id,
    companyId: r.company_id,
    profile,
    prevHash: r.prev_hash ?? GENESIS,
    currHash: r.curr_hash ?? GENESIS,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? null,
  };
}

/** Read the live (non-deleted) portfolio row for a (partner, company) pair. */
export function getPortfolioCompany(
  partnerId: string,
  companyId: string,
): PortfolioCompany | null {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT * FROM partner_portfolio_company
          WHERE partner_id = ? AND company_id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(partnerId, companyId);
    return row ? rowToPortfolio(row) : null;
  } catch (err) {
    if (!/no such table/i.test(String(err))) {
      log.warn("[partnerPortfolioStore] getPortfolioCompany failed:", err);
    }
    return null;
  }
}

/** List all live portfolio rows for a partner, most-recently-updated first. */
export function listPortfolioCompanies(partnerId: string): PortfolioCompany[] {
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT * FROM partner_portfolio_company
          WHERE partner_id = ? AND deleted_at IS NULL
          ORDER BY updated_at DESC`,
      )
      .all(partnerId) as any[];
    return rows.map(rowToPortfolio);
  } catch (err) {
    if (!/no such table/i.test(String(err))) {
      log.warn("[partnerPortfolioStore] listPortfolioCompanies failed:", err);
    }
    return [];
  }
}

/** Deep-merge a validated section patch into an existing profile blob. */
function mergeProfile(
  base: Record<string, unknown>,
  patch: CompanyProfilePatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const section of ["contact", "address", "legal", "ma"] as const) {
    const incoming = (patch as Record<string, unknown>)[section];
    if (incoming && typeof incoming === "object") {
      next[section] = {
        ...((base[section] as Record<string, unknown>) ?? {}),
        ...(incoming as Record<string, unknown>),
      };
    }
  }
  return next;
}

/**
 * Upsert the partner's private profile for a company. Validates the incoming
 * patch against the SAME zod schema the founder wizard uses, deep-merges it
 * into the stored blob, and advances the per-row hash chain. Fail-closed: any
 * DB write failure throws so the route surfaces a 500 rather than a phantom
 * success.
 */
export function upsertPortfolioProfile(
  partnerId: string,
  companyId: string,
  patch: CompanyProfilePatch,
  updatedBy: string,
): PortfolioCompany {
  const now = new Date().toISOString();
  const existing = getPortfolioCompany(partnerId, companyId);
  const mergedProfile = mergeProfile(existing?.profile ?? {}, patch);
  const profileJson = JSON.stringify(mergedProfile);
  const prevHash = existing?.currHash ?? GENESIS;
  const currHash = sha256Hex(`${prevHash}|${partnerId}|${companyId}|${profileJson}`);

  try {
    const db: any = rawDb();
    if (existing) {
      db.prepare(
        `UPDATE partner_portfolio_company
            SET profile_json = ?, prev_hash = ?, curr_hash = ?,
                updated_at = ?, updated_by = ?
          WHERE id = ?`,
      ).run(profileJson, prevHash, currHash, now, updatedBy, existing.id);
      return { ...existing, profile: mergedProfile, prevHash, currHash, updatedAt: now, updatedBy };
    }
    const id = newId();
    db.prepare(
      `INSERT INTO partner_portfolio_company
         (id, tenant_id, partner_id, company_id, profile_json,
          prev_hash, curr_hash, created_at, updated_at, updated_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, partnerId, companyId, profileJson, prevHash, currHash, now, now, updatedBy);
    return {
      id,
      partnerId,
      companyId,
      profile: mergedProfile,
      prevHash,
      currHash,
      createdAt: now,
      updatedAt: now,
      updatedBy,
    };
  } catch (err) {
    log.error("[partnerPortfolioStore] upsertPortfolioProfile DB write failed:", err);
    throw new Error("PORTFOLIO_PERSIST_FAILED");
  }
}

/** Validate a raw request body as a CompanyProfilePatch. Returns null on failure. */
export function parsePortfolioPatch(body: unknown): CompanyProfilePatch | null {
  const parsed = companyProfilePatchSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Soft-delete a partner's private profile for a company. */
export function archivePortfolioCompany(
  partnerId: string,
  companyId: string,
): boolean {
  const now = new Date().toISOString();
  try {
    const db: any = rawDb();
    const res = db
      .prepare(
        `UPDATE partner_portfolio_company
            SET deleted_at = ?
          WHERE partner_id = ? AND company_id = ? AND deleted_at IS NULL`,
      )
      .run(now, partnerId, companyId);
    return res.changes > 0;
  } catch (err) {
    log.error("[partnerPortfolioStore] archivePortfolioCompany failed:", err);
    throw new Error("PORTFOLIO_ARCHIVE_FAILED");
  }
}
