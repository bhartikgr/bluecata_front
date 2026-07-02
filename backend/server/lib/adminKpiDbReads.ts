/**
 * server/lib/adminKpiDbReads.ts — v25.48 DATA-2 (V-1/V-2/V-3).
 *
 * Parallel, DB-driven KPI reads for the admin dashboard. The previous
 * computeKpis() in adminPlatformStore.ts derived totalCompanies / totalFunded /
 * totalCommittedSoftCircle and the region breakdown from the mockData arrays
 * (`companies`, `rounds`, `softCircles`). In production those arrays are always
 * empty, so the admin dashboard silently reported COMPANIES=0, FUNDED=$0,
 * SOFT-CIRCLED=$0 and an empty regions[] — exactly what the live walkthrough
 * showed (COMPANIES=0 while the Companies list had 54 tenants).
 *
 * This module reads the CANONICAL DB stores instead. It is non-sacred and is
 * imported by adminPlatformStore.computeKpis(). No mock data, no in-memory
 * canonical state — every number here is derived from the live DB stores.
 */
import { getAllCompaniesFromDb } from "../multiCompanyStore";
import { listRounds } from "../roundsStore";
import { listForCompany as softCirclesForCompany } from "../softCircleStore";
import { DbUnavailableError } from "./errors";

// v25.48 DATA-2 (fail-closed hardening per GPT-5.5) — these helpers MUST NOT
// swallow a DB read failure into a false 0/[] KPI (which would silently serve
// wrong "live-looking" numbers). On any DB error they throw DbUnavailableError,
// which the /api/admin/dashboard/kpis route already maps to a 503 + ok:false.

/** Distinct real companies (tenant inventory) from the DB. */
export function dbTotalCompanies(): number {
  try {
    return getAllCompaniesFromDb().length;
  } catch (err) {
    throw new DbUnavailableError("admin KPI companies", err as Error);
  }
}

/**
 * Total funded across all rounds = sum of Round.raisedAmount from the DB-backed
 * roundsStore (NOT the mock `amountRaised` field, which never existed on live
 * rows). listRounds() returns the DB-hydrated read cache.
 */
export function dbTotalFunded(): number {
  try {
    return listRounds().reduce((sum, r) => sum + (Number(r.raisedAmount) || 0), 0);
  } catch (err) {
    throw new DbUnavailableError("admin KPI funded total", err as Error);
  }
}

/**
 * Soft-circle pipeline total = sum of soft-circle amounts across every real
 * company, read from the canonical softCircleStore (DB-direct reads).
 */
export function dbTotalCommittedSoftCircle(): number {
  try {
    const companies = getAllCompaniesFromDb();
    let total = 0;
    for (const c of companies) {
      const cid = (c as { companyId?: string; id?: string }).companyId ?? (c as { id?: string }).id;
      if (!cid) continue;
      for (const sc of softCirclesForCompany(cid)) {
        total += Number(sc.amount) || 0;
      }
    }
    return total;
  } catch (err) {
    throw new DbUnavailableError("admin KPI soft-circle total", err as Error);
  }
}

/**
 * Region breakdown derived from real DB companies + their DB rounds.
 * Returns [{ code, companies, raised }] — never a fabricated/empty-mock shape.
 * Falls back to a single "GLOBAL" bucket only when a company has no region set,
 * preserving the prior contract of never returning an empty array when at least
 * one real company exists.
 */
export function dbRegions(): Array<{ code: string; companies: number; raised: number }> {
  try {
    const companies = getAllCompaniesFromDb();
    const rounds = listRounds();
    const acc = new Map<string, { companies: number; raised: number }>();
    for (const c of companies) {
      const cid = (c as { companyId?: string; id?: string }).companyId ?? (c as { id?: string }).id ?? "";
      const code = (c as { region?: string }).region || "GLOBAL";
      const cur = acc.get(code) ?? { companies: 0, raised: 0 };
      cur.companies += 1;
      cur.raised += rounds
        .filter((r) => r.companyId === cid)
        .reduce((s, r) => s + (Number(r.raisedAmount) || 0), 0);
      acc.set(code, cur);
    }
    return Array.from(acc.entries()).map(([code, v]) => ({ code, ...v }));
  } catch (err) {
    throw new DbUnavailableError("admin KPI regions", err as Error);
  }
}
