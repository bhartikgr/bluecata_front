/**
 * v25.45 F20 — Workspace archive + 8-year retention + self-serve revival.
 *
 * "Delete" no longer destroys data: it ARCHIVES the workspace for 8 years per
 * regulatory retention, marks it read-only, and lets the founder reactivate by
 * resubscribing within the window. Cap-table hash chains are never modified.
 *
 * Endpoints (all DB-driven against the companies table):
 *   POST /api/founder/workspace/archive       — archive a company
 *   POST /api/founder/workspace/reactivate     — clear archive flags on revival
 *   GET  /api/founder/workspace/archive-status — read archive state for a company
 *
 * Schema (migration 0062 / inline DDL): companies.archived_at,
 * archive_retention_until, archive_status, last_active_plan.
 */
import type { Express, Request, Response } from "express";
import { rawDb } from "../db/connection";

const EIGHT_YEARS_MS = 8 * 365.25 * 24 * 60 * 60 * 1000;

/** Compute the retention end = archived_at + 8 years (calendar-accurate). */
export function computeRetentionUntil(archivedAtIso: string): string {
  const d = new Date(archivedAtIso);
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + 8);
  return out.toISOString();
}

function ownsCompany(req: Request, companyId: string): boolean {
  const ctx = (req as any).userContext;
  if (!ctx?.userId) return false;
  if (ctx.isAdmin) return true;
  return (ctx.founder?.companies ?? []).some((c: any) => (c.companyId ?? c.id) === companyId);
}

export interface ArchiveState {
  companyId: string;
  archiveStatus: "active" | "archived" | "permanent_deletion_requested";
  archivedAt: string | null;
  archiveRetentionUntil: string | null;
  lastActivePlan: string | null;
}

/** Read the archive state for a company straight from the DB. */
export function getArchiveState(companyId: string): ArchiveState | null {
  const row = rawDb().prepare(
    `SELECT id, archive_status, archived_at, archive_retention_until, last_active_plan
       FROM companies WHERE id = ? AND deleted_at IS NULL`,
  ).get(companyId) as any;
  if (!row) return null;
  return {
    companyId: row.id,
    archiveStatus: (row.archive_status ?? "active") as ArchiveState["archiveStatus"],
    archivedAt: row.archived_at ?? null,
    archiveRetentionUntil: row.archive_retention_until ?? null,
    lastActivePlan: row.last_active_plan ?? null,
  };
}

export function registerWorkspaceArchiveRoutes(app: Express): void {
  // POST /api/founder/workspace/archive { companyId }
  app.post("/api/founder/workspace/archive", (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String((req.body ?? {}).companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    if (!ownsCompany(req, companyId)) return res.status(403).json({ ok: false, error: "not_owner" });

    const archivedAt = new Date().toISOString();
    const retentionUntil = computeRetentionUntil(archivedAt);

    // F20b — capture the last active plan for revival pre-selection.
    let lastActivePlan: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getSubscription } = require("../subscriptionsStore");
      lastActivePlan = getSubscription(companyId)?.plan ?? null;
    } catch { /* subscription optional */ }

    rawDb().prepare(
      `UPDATE companies
         SET archived_at = ?, archive_retention_until = ?, archive_status = 'archived',
             last_active_plan = COALESCE(?, last_active_plan)
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(archivedAt, retentionUntil, lastActivePlan, companyId);

    return res.json({
      ok: true,
      archiveStatus: "archived",
      archivedAt,
      archiveRetentionUntil: retentionUntil,
      lastActivePlan,
    });
  });

  // POST /api/founder/workspace/reactivate { companyId }
  app.post("/api/founder/workspace/reactivate", (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String((req.body ?? {}).companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    if (!ownsCompany(req, companyId)) return res.status(403).json({ ok: false, error: "not_owner" });

    rawDb().prepare(
      `UPDATE companies
         SET archived_at = NULL, archive_retention_until = NULL, archive_status = 'active'
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(companyId);

    return res.json({ ok: true, archiveStatus: "active" });
  });

  // v25.45 ROUND 2 (BLOCKER 2) — GET /api/founder/workspace/archive-state.
  // Revival pre-selection read for Subscribe.tsx (?reactivate=1): returns the
  // archive state PLUS the company display name and last_active_plan so the
  // reactivate UI can render "Reactivate {companyName}" and pre-select the
  // previously active plan. Companion to /archive-status (kept for back-compat).
  app.get("/api/founder/workspace/archive-state", (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String(req.query.companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    if (!ownsCompany(req, companyId)) return res.status(403).json({ ok: false, error: "not_owner" });
    const state = getArchiveState(companyId);
    if (!state) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND" });
    let companyName: string | null = null;
    try {
      const row = rawDb().prepare(`SELECT name FROM companies WHERE id = ?`).get(companyId) as any;
      companyName = row?.name ?? null;
    } catch { /* best-effort */ }
    return res.json({ ok: true, ...state, companyName });
  });

  // GET /api/founder/workspace/archive-status?companyId=...
  app.get("/api/founder/workspace/archive-status", (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String(req.query.companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    if (!ownsCompany(req, companyId)) return res.status(403).json({ ok: false, error: "not_owner" });
    const state = getArchiveState(companyId);
    if (!state) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND" });
    return res.json({ ok: true, ...state });
  });
}
