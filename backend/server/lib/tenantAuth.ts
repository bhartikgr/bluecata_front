/**
 * server/lib/tenantAuth.ts — v24.0 LOCKDOWN PATCH (Group B)
 *
 * Canonical tenant-isolation authorization helpers. Before v24.0, several
 * multi-tenant reads/writes treated `requireAuth` as sufficient authorization,
 * letting any authenticated user read or mutate another tenant's rounds,
 * companies, CRM, dataroom, and PDFs by guessing IDs (CAP-P0-03 / CAP-P0-04).
 *
 * These helpers centralize the "does this caller own / may this caller view
 * this company/round" decision so every route applies it consistently.
 *
 * Contract: each helper returns a discriminated result. On failure it writes
 * the HTTP response (401/403/404) and returns `{ ok: false }`; the caller must
 * `return` immediately. On success it returns `{ ok: true, ... }` with the
 * resolved companyId/userId. This mirrors the existing inline
 * `requireFounderOwnsRound` pattern in routes.ts so call sites stay uniform.
 *
 * Visibility rules (matches the audit's proposed fix):
 *   - admin: full access to everything.
 *   - founder: access to companies in `ctx.founder.companies`.
 *   - investor: access to a company if they hold a cap-table position in it OR
 *     have an invitation (pending or redeemed) for a round in that company.
 */
import type { Request, Response } from "express";
import { getUserContext } from "./userContext";
import { getRoundById } from "../roundsStore";

export interface OwnershipResult {
  ok: boolean;
  companyId?: string;
  userId?: string;
}

/** Resolve the companyId that owns a round, or null if unknown. */
export function companyIdForRound(roundId: string): string | null {
  if (!roundId) return null;
  try {
    const r = getRoundById(roundId);
    if (r && (r as { companyId?: string }).companyId) {
      return (r as { companyId?: string }).companyId ?? null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Company IDs a founder owns (empty for non-founders). */
export function founderOwnedCompanyIds(ctx: ReturnType<typeof getUserContext>): Set<string> {
  return new Set((ctx?.founder?.companies ?? []).map((c) => c.companyId));
}

/**
 * Company IDs an investor may view: cap-table positions + invited rounds'
 * companies (pending or redeemed). This is the investor entitlement set used
 * by canAccessCompany.
 */
export function investorVisibleCompanyIds(ctx: ReturnType<typeof getUserContext>): Set<string> {
  const ids = new Set<string>();
  for (const p of ctx?.investor?.capTablePositions ?? []) {
    if (p.companyId) ids.add(p.companyId);
  }
  for (const r of ctx?.investor?.invitedRounds ?? []) {
    if (r.companyId) ids.add(r.companyId);
  }
  return ids;
}

/**
 * B5/B6 — Can the caller access this company at all?
 * Founder/admin if they own it; investor if entitled (cap table / invitation).
 * Returns a plain boolean (caller decides the status code). Use
 * `requireCanAccessCompany` when you want the helper to write the response.
 */
export function canAccessCompany(req: Request, companyId: string): boolean {
  if (!companyId) return false;
  const ctx = getUserContext(req);
  if (!ctx || !ctx.isAuthed || !ctx.userId) return false;
  if (ctx.isAdmin) return true;
  if (founderOwnedCompanyIds(ctx).has(companyId)) return true;
  if (investorVisibleCompanyIds(ctx).has(companyId)) return true;
  return false;
}

/** canAccessCompany that writes 401/404 on failure. 404 (not 403) avoids ID enumeration. */
export function requireCanAccessCompany(req: Request, res: Response, companyId: string): OwnershipResult {
  const ctx = getUserContext(req);
  if (!ctx || !ctx.isAuthed || !ctx.userId) {
    res.status(401).json({ ok: false, error: "unauthenticated" });
    return { ok: false };
  }
  if (!companyId) {
    res.status(404).json({ ok: false, error: "company_not_found" });
    return { ok: false };
  }
  if (canAccessCompany(req, companyId)) {
    return { ok: true, companyId, userId: ctx.userId };
  }
  res.status(404).json({ ok: false, error: "company_not_found" });
  return { ok: false };
}

/**
 * B8/B9 — Founder (or admin) must OWN this company to mutate it. Writes
 * 401/403/404 on failure.
 */
export function requireFounderOwnsCompany(req: Request, res: Response, companyId: string): OwnershipResult {
  const ctx = getUserContext(req);
  if (!ctx || !ctx.userId) {
    res.status(401).json({ ok: false, error: "unauthenticated" });
    return { ok: false };
  }
  if (!companyId) {
    res.status(404).json({ ok: false, error: "company_not_found" });
    return { ok: false };
  }
  if (ctx.isAdmin) return { ok: true, companyId, userId: ctx.userId };
  if (founderOwnedCompanyIds(ctx).has(companyId)) {
    return { ok: true, companyId, userId: ctx.userId };
  }
  res.status(403).json({ ok: false, error: "not_founder_of_company", companyId });
  return { ok: false };
}

/**
 * B2/B3/B7 — Founder (or admin) must OWN the round's company. Resolves the
 * round → companyId first. Writes 401/403/404 on failure.
 */
export function requireFounderOwnsRound(req: Request, res: Response, roundId?: string): OwnershipResult {
  const rid = roundId ?? (typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? ""));
  const cid = companyIdForRound(rid);
  if (!cid) {
    res.status(404).json({ ok: false, error: "round_not_found" });
    return { ok: false };
  }
  return requireFounderOwnsCompany(req, res, cid);
}

/**
 * Investor (or founder/admin) may VIEW the round if they can access its
 * company. Writes 401/404 on failure (404 to avoid round-ID enumeration).
 */
export function requireInvestorCanViewRound(req: Request, res: Response, roundId?: string): OwnershipResult {
  const rid = roundId ?? (typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? ""));
  const cid = companyIdForRound(rid);
  if (!cid) {
    res.status(404).json({ ok: false, error: "round_not_found" });
    return { ok: false };
  }
  return requireCanAccessCompany(req, res, cid);
}
