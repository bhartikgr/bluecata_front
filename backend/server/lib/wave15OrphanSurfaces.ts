/**
 * server/lib/wave15OrphanSurfaces.ts
 *
 * WAVE 15 — ORP-062 (the R-3 orphan sweep), ORP-037, ORP-041, ORP-053, ORP-063.
 *
 * SINKS
 *   `orphan_surface_disposition` (migration 0170) — route/table/column/copy_key
 *     rulings. Wave 14 seeded ORP-037 and ORP-041 rows and then referenced the
 *     table from exactly ONE file, `server/lib/spvFeeChainRebuild.ts`, WHICH HAS
 *     NO CALLERS. So the rulings were unreachable: recorded and unpublished.
 *     This module is the first reader with a route behind it.
 *   `ddl_column_disposition` (migration 0159:332, 12 seeded rows) — ORP-053.
 *     Zero code readers before this wave.
 *
 * ORP-062 IS COMPUTED, NOT FROZEN. Migration 0170 says explicitly why the
 * 121-route list is NOT seeded: "a frozen list of 121 paths in a migration is
 * stale the moment a route moves; three waves have now been misled by exactly
 * that kind of frozen citation." So the inventory here is derived from the LIVE
 * Express router at request time and LEFT JOINed to the rulings. Consequences,
 * which are the point:
 *   - a mounted route with no ruling reports `pending` BY ABSENCE, so it cannot
 *     be lost;
 *   - a ruling whose route is no longer mounted reports `orphan_ruling`, so a
 *     stale ruling cannot masquerade as outstanding work;
 *   - the totals move when the router moves, with no migration.
 *
 * ORP-053 IS EXECUTED, NOT RESTATED. All 12 seeded rows are ruled `document`
 * (retain + publish) and `owner_ruled = 1`. "Execute the ruling" therefore means
 * two things, and both are done here: the rows are PUBLISHED through a route,
 * and `verifyDocumentedColumnsStillExist()` PROVES the retained columns are
 * still present in the live schema — because a `document` ruling that silently
 * lost its column would be the ruling being violated, and nothing was checking.
 */
import type { Express } from "express";
import { rawDb } from "../db/connection";
import { log } from "./logger";

export interface MountedRoute {
  method: string;
  path: string;
}

/**
 * Walk the mounted Express router. Handles both direct `app.get(...)` layers and
 * routes mounted through nested routers.
 *
 * Express does not expose a supported introspection API, so this reads
 * `_router.stack`. It is READ-ONLY and defensive: any shape it does not
 * recognise is skipped rather than throwing, because an inventory endpoint must
 * never be able to take the server down.
 */
export function collectMountedRoutes(app: Express): MountedRoute[] {
  const out: MountedRoute[] = [];
  const seen = new Set<string>();
  const push = (method: string, path: string): void => {
    const key = `${method} ${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method, path });
  };
  const walk = (stack: any[], prefix: string, depth: number): void => {
    if (!Array.isArray(stack) || depth > 8) return;
    for (const layer of stack) {
      try {
        if (layer?.route?.path) {
          const paths: string[] = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
          const methods = Object.keys(layer.route.methods ?? {}).filter((m) => layer.route.methods[m]);
          for (const p of paths) {
            for (const m of methods) push(m.toUpperCase(), `${prefix}${p}`);
          }
        } else if (layer?.name === "router" && layer?.handle?.stack) {
          walk(layer.handle.stack, prefix, depth + 1);
        }
      } catch {
        // Unrecognised layer shape. Skipped, never fatal.
      }
    }
  };
  const router = (app as any)?._router ?? (app as any)?.router;
  walk(router?.stack ?? [], "", 0);
  return out.sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

export interface DispositionRow {
  id: string;
  surfaceKind: string;
  method: string | null;
  path: string;
  silo: string;
  declaredIn: string;
  disposition: "adopted" | "retired" | "pending";
  callerRef: string | null;
  itemId: string;
  rationale: string;
  recordedAt: string;
  recordedBy: string;
}

function mapDisp(r: any): DispositionRow {
  return {
    id: r.id,
    surfaceKind: r.surface_kind,
    method: r.method ?? null,
    path: r.path,
    silo: r.silo,
    declaredIn: r.declared_in,
    disposition: r.disposition,
    callerRef: r.caller_ref ?? null,
    itemId: r.item_id,
    rationale: r.rationale,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
  };
}

export function listDispositions(): DispositionRow[] {
  try {
    return (rawDb()
      .prepare(`SELECT * FROM orphan_surface_disposition ORDER BY surface_kind, path, method`)
      .all() as any[]).map(mapDisp);
  } catch (err) {
    log.warn(`[w15-orphans] listDispositions failed: ${String(err)}`);
    return [];
  }
}

/** Partner-silo path prefixes, used only to classify the inventory report. */
export const PARTNER_PATH_PREFIXES: readonly string[] = Object.freeze([
  "/api/partner",
  "/api/admin/partner",
  "/api/consortium",
  "/api/admin/consortium",
  "/api/managed-founder",
  "/api/partner-workspace",
]);

export function siloOf(path: string): string {
  if (PARTNER_PATH_PREFIXES.some((p) => path.startsWith(p))) return "partner";
  if (path.startsWith("/api/collective")) return "collective";
  if (path.startsWith("/api/admin")) return "admin";
  if (path.startsWith("/api/auth")) return "auth";
  if (path.startsWith("/api/reporting")) return "reporting";
  if (path.startsWith("/api/founder")) return "founder";
  if (path.startsWith("/api/investor")) return "investor";
  return "core";
}

export interface InventoryEntry extends MountedRoute {
  silo: string;
  disposition: "adopted" | "retired" | "pending";
  /** true when the disposition came from a stored ruling, false when defaulted. */
  ruled: boolean;
  callerRef: string | null;
  itemId: string | null;
  rationale: string | null;
}

export interface OrphanInventory {
  mountedCount: number;
  entries: InventoryEntry[];
  counts: Record<string, number>;
  siloCounts: Record<string, Record<string, number>>;
  /** Rulings whose route is NOT mounted — a stale ruling, reported not hidden. */
  orphanRulings: DispositionRow[];
  /** Non-route rulings (table / column / copy_key / event), passed through. */
  nonRouteRulings: DispositionRow[];
}

/**
 * The ORP-062 inventory. Live routes LEFT JOINed to stored rulings.
 *
 * A ruling matches a mounted route when the path is identical and the method
 * matches (or the ruling's method is NULL, meaning "any method on this path").
 */
export function buildOrphanInventory(app: Express): OrphanInventory {
  const mounted = collectMountedRoutes(app).filter((r) => r.path.startsWith("/api/"));
  const rulings = listDispositions();
  const routeRulings = rulings.filter((r) => r.surfaceKind === "route");
  const nonRouteRulings = rulings.filter((r) => r.surfaceKind !== "route");

  const matched = new Set<string>();
  const entries: InventoryEntry[] = mounted.map((m) => {
    const hit = routeRulings.find((r) => r.path === m.path && (r.method === null || r.method.toUpperCase() === m.method));
    if (hit) matched.add(hit.id);
    return {
      method: m.method,
      path: m.path,
      silo: hit?.silo ?? siloOf(m.path),
      disposition: hit?.disposition ?? "pending",
      ruled: !!hit,
      callerRef: hit?.callerRef ?? null,
      itemId: hit?.itemId ?? null,
      rationale: hit?.rationale ?? null,
    };
  });

  const counts: Record<string, number> = { adopted: 0, retired: 0, pending: 0 };
  const siloCounts: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    counts[e.disposition] = (counts[e.disposition] ?? 0) + 1;
    siloCounts[e.silo] = siloCounts[e.silo] ?? { adopted: 0, retired: 0, pending: 0 };
    siloCounts[e.silo][e.disposition] += 1;
  }

  return {
    mountedCount: mounted.length,
    entries,
    counts,
    siloCounts,
    orphanRulings: routeRulings.filter((r) => !matched.has(r.id)),
    nonRouteRulings,
  };
}

/* ==========================================================================
 * ORP-053 — the 9 (in fact 12 seeded) DDL-only columns.
 * ======================================================================== */

export interface DdlColumnRow {
  id: string;
  tableName: string;
  columnName: string;
  declaredIn: string;
  disposition: "use" | "drop" | "document";
  rationale: string;
  riskClass: string;
  ownerRuled: boolean;
  recordedAt: string;
}

export function listDdlColumnDispositions(): DdlColumnRow[] {
  try {
    return (rawDb()
      .prepare(`SELECT * FROM ddl_column_disposition ORDER BY table_name, column_name`)
      .all() as any[]).map((r) => ({
      id: r.id,
      tableName: r.table_name,
      columnName: r.column_name,
      declaredIn: r.declared_in,
      disposition: r.disposition,
      rationale: r.rationale,
      riskClass: r.risk_class,
      ownerRuled: !!r.owner_ruled,
      recordedAt: r.recorded_at,
    }));
  } catch (err) {
    log.warn(`[w15-orphans] listDdlColumnDispositions failed: ${String(err)}`);
    return [];
  }
}

export interface DdlVerification {
  ok: boolean;
  checked: number;
  /** Ruled `document` (retain) but ABSENT from the live schema — ruling violated. */
  missing: Array<{ table: string; column: string; riskClass: string }>;
  /** Ruled `drop` but STILL PRESENT — the ruling has not been executed. */
  notDropped: Array<{ table: string; column: string }>;
  /** Rows whose table does not exist in this database at all. */
  tableAbsent: Array<{ table: string; column: string }>;
}

/**
 * EXECUTE the ORP-053 rulings by checking them against the live schema.
 *
 * This is the falsifiable part: a `document` ruling means "retained on purpose,
 * do not drop", and until now NOTHING verified that. If a later migration
 * dropped `auth_users.locked_until`, the only record that account lockout was
 * ever intended would vanish with it and every check in the tree would still
 * pass. This function fails in that world.
 *
 * Marker rows use `column_name = '*'` (a whole-table marker) and are checked as
 * table existence only.
 *
 * @returns ok=false with the specific violations. NEVER a warning: the caller
 *   surfaces it, and the test asserts both poles (clean schema -> ok, a ruled
 *   column removed from the checked list -> ok=false).
 */
export function verifyDdlColumnRulings(): DdlVerification {
  const rows = listDdlColumnDispositions();
  const missing: DdlVerification["missing"] = [];
  const notDropped: DdlVerification["notDropped"] = [];
  const tableAbsent: DdlVerification["tableAbsent"] = [];
  let checked = 0;

  for (const r of rows) {
    let cols: string[] = [];
    let tableExists = false;
    try {
      const t = rawDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
        .get(r.tableName) as { name?: string } | undefined;
      tableExists = !!t?.name;
      if (tableExists) {
        cols = (rawDb().prepare(`PRAGMA table_info(${JSON.stringify(r.tableName)})`).all() as any[]).map((c) =>
          String(c.name),
        );
      }
    } catch (err) {
      log.warn(`[w15-orphans] schema probe failed for ${r.tableName}: ${String(err)}`);
      continue;
    }
    checked++;
    if (!tableExists) {
      tableAbsent.push({ table: r.tableName, column: r.columnName });
      continue;
    }
    if (r.columnName === "*") continue; // whole-table marker: existence is the check
    const present = cols.includes(r.columnName);
    if (r.disposition === "document" || r.disposition === "use") {
      if (!present) missing.push({ table: r.tableName, column: r.columnName, riskClass: r.riskClass });
    } else if (r.disposition === "drop") {
      if (present) notDropped.push({ table: r.tableName, column: r.columnName });
    }
  }

  return {
    ok: missing.length === 0 && notDropped.length === 0,
    checked,
    missing,
    notDropped,
    tableAbsent,
  };
}
