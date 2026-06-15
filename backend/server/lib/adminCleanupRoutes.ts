/**
 * v23.4.7 Phase 15 / B-101 — Admin: cleanup duplicate companies.
 *
 * Pre-v23.4.5 duplicate company rows are still lurking in production
 * databases. This endpoint is a manual, admin-triggered dedupe pass: for
 * each tenant_id, find groups of `companies` rows whose lowercase-trimmed
 * name is identical, keep ONE row (the lexicographically earliest id —
 * SQLite has no `created_at` on this table, so we sort by id; in practice
 * ids are random hex which is stable across runs and deterministic for
 * tests), and soft-delete the rest by setting `deleted_at`.
 *
 * The endpoint is gated behind the existing platform-admin auth guard via
 * the route prefix `/api/admin/...` and `applyRouteGuards.ts`.
 *
 * IMPORTANT: this route is NEVER auto-run on startup. Admin must POST to
 * it explicitly. Each invocation is audit-logged.
 */
import type { Express, Request, Response } from "express";
import { getDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { log } from "./logger";

type CompanyRow = {
  id: string;
  tenant_id: string;
  name: string;
  deleted_at: string | null;
};

/**
 * Pure helper — given a list of (tenant, name, id) rows, compute which rows
 * to keep and which to soft-delete. Exposed for unit tests.
 *
 * Algorithm:
 *   - Group rows by `${tenantId}::${lower(trim(name))}`.
 *   - Within each group, sort by id ascending (stable proxy for "earliest").
 *   - Keep the first; mark the rest for soft-delete.
 */
export function planDedupe(rows: CompanyRow[]): {
  groupsFound: number;
  kept: { id: string; name: string; tenantId: string }[];
  toSoftDelete: { id: string; name: string; tenantId: string; keptId: string }[];
} {
  // Only consider rows that are NOT already soft-deleted.
  const live = rows.filter((r) => !r.deleted_at);
  const groups = new Map<string, CompanyRow[]>();
  for (const r of live) {
    const norm = r.name.trim().toLowerCase();
    const key = `${r.tenant_id}::${norm}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(r);
    groups.set(key, bucket);
  }
  const kept: { id: string; name: string; tenantId: string }[] = [];
  const toSoftDelete: {
    id: string;
    name: string;
    tenantId: string;
    keptId: string;
  }[] = [];
  let groupsFound = 0;
  for (const bucket of groups.values()) {
    if (bucket.length <= 1) continue;
    groupsFound += 1;
    bucket.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = bucket[0]!;
    kept.push({ id: keep.id, name: keep.name, tenantId: keep.tenant_id });
    for (let i = 1; i < bucket.length; i += 1) {
      const r = bucket[i]!;
      toSoftDelete.push({ id: r.id, name: r.name, tenantId: r.tenant_id, keptId: keep.id });
    }
  }
  return { groupsFound, kept, toSoftDelete };
}

export function registerAdminCleanupRoutes(app: Express): void {
  app.post("/api/admin/cleanup/dedupe-companies", (req: Request, res: Response) => {
    const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true" || req.body?.dryRun === true;
    try {
      const db = getDb();
      const driver = db as unknown as { prepare?: (sql: string) => { all: () => unknown; run: (...args: unknown[]) => unknown } };
      if (typeof driver.prepare !== "function") {
        return res.status(500).json({ ok: false, error: "db_driver_missing" });
      }
      const rows = driver
        .prepare(`SELECT id, tenant_id, name, deleted_at FROM companies`)
        .all() as CompanyRow[];
      const plan = planDedupe(rows);

      let rowsSoftDeleted = 0;
      if (!dryRun && plan.toSoftDelete.length > 0) {
        const nowIso = new Date().toISOString();
        const stmt = driver.prepare(
          `UPDATE companies SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
        );
        for (const r of plan.toSoftDelete) {
          stmt.run(nowIso, r.id);
          rowsSoftDeleted += 1;
        }
      }

      const adminUserId =
        (req as Request & { userContext?: { userId?: string } }).userContext?.userId ??
        "u_unknown";
      appendAdminAudit(adminUserId, "platform", "admin.cleanup.dedupe-companies", {
        dryRun,
        groupsFound: plan.groupsFound,
        rowsSoftDeleted,
        keptCount: plan.kept.length,
      });

      return res.json({
        ok: true,
        dryRun,
        groupsFound: plan.groupsFound,
        rowsSoftDeleted,
        kept: plan.kept,
      });
    } catch (err) {
      log.error("[adminCleanup] dedupe-companies failed", (err as Error).message);
      return res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });
}
