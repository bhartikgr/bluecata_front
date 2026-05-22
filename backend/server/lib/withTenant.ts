/**
 * v12 — Tenant scoping helper for Drizzle queries.
 *
 * THE CONTRACT
 * ============
 * Every Drizzle SELECT/UPDATE in a v12-migrated store MUST funnel its WHERE
 * clause through `withTenant()` so the active tenant scope and the soft-delete
 * filter (`deleted_at IS NULL`) are enforced uniformly.
 *
 *   ✅  getDb().select().from(companies)
 *         .where(withTenant(eq(companies.id, id), { tenantId, table: companies }))
 *
 *   ❌  getDb().select().from(companies).where(eq(companies.id, id))
 *         // No tenant filter; leaks data across tenants.
 *
 *  ⚠️  CROSS-TENANT (admin) ops — login-by-email, audit dashboard, demo seed —
 *      MAY skip withTenant, but each call site MUST carry an inline comment:
 *
 *         // CROSS-TENANT (admin) — justified because <reason>
 *         getDb().select().from(users).where(eq(users.email, email))
 *
 *
 * SESSION / COOKIE INTEGRATION
 * ============================
 * `getCurrentTenantId(req)` reads `user_prefs.active_tenant_id` for the
 * session user (resolved via the cap_uid cookie). Returns null if no tenant
 * is selected yet (signup hasn't completed, or no companies).
 *
 * `setCurrentTenantId(req, tenantId)` upserts the active tenant into
 * `user_prefs` for the session user. Used by `/api/founder/companies/:id/activate`
 * once multiCompanyStore migrates.
 *
 * WHEN TO USE withTenant
 * ======================
 *  ✅ All P0+P1 store reads/writes after migration.
 *  ✅ Founder/investor data fetches keyed on the active company.
 *
 * WHEN NOT TO USE withTenant
 * ==========================
 *  ✅ Authentication flows: login-by-email needs to find a user across all
 *     tenants by email (the email is the global identity primary key, not
 *     the tenant).
 *  ✅ Demo seed: writes across multiple tenants in one boot pass.
 *  ✅ Admin operations: cross-tenant audit dashboard, billing rollup, etc.
 *  ✅ The `tenants` table itself — its rows ARE the tenant scope.
 *
 *  In every such case, leave an inline `// CROSS-TENANT (admin) — justified
 *  because ...` comment so the reviewer can confirm.
 *
 *
 * DUAL-DIALECT NOTE
 * =================
 * `and`, `eq`, `isNull`, `desc` from `drizzle-orm` compile identically on
 * SQLite and Postgres. Avoid Postgres-only or SQLite-only Drizzle helpers
 * here.
 */

import type { Request } from "express";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/connection";
import { userPrefs } from "../../shared/schema";
import { log } from "./logger";

/* -------------------------------------------------------------------------
 * resolveSessionUserId — local copy so we don't take a circular dep on
 * userContext.ts (which in turn imports from multiCompanyStore).
 * Mirrors the cap_uid resolution logic at userContext.ts:295–304.
 * ------------------------------------------------------------------------- */
function resolveSessionUserId(req: Request): string | null {
  const headerId = req.headers["x-cap-user-id"];
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  const cookieId = cookies["__Host-cap_uid"] ?? cookies["cap_uid"];
  const queryId = typeof req.query?.userId === "string" ? (req.query.userId as string) : undefined;
  const id = (cookieId ?? (typeof headerId === "string" ? headerId : undefined) ?? queryId) ?? null;
  return id && id.length > 0 ? id : null;
}

/* -------------------------------------------------------------------------
 * Options for withTenant()
 * ------------------------------------------------------------------------- */
export interface WithTenantOpts {
  /**
   * Tenant id to scope to. If omitted, withTenant becomes an unscoped
   * filter (only soft-delete is applied). Callers that omit tenantId
   * MUST justify with a // CROSS-TENANT comment.
   */
  tenantId?: string | null;
  /**
   * The Drizzle table being queried. Required to wire the right
   * `<table>.tenant_id` and `<table>.deleted_at` columns. Pass the imported
   * table object, e.g. `companies` from shared/schema.
   *
   * If omitted, withTenant assumes the SQL fragment already mentions
   * tenant_id and deleted_at columns directly (rare — usually for joins).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table?: any;
  /** Skip the `deleted_at IS NULL` filter (rare; e.g. admin archive view). */
  skipSoftDelete?: boolean;
  /** Skip the tenant filter (use with the inline-comment justification). */
  skipTenant?: boolean;
}

/**
 * Wrap a SQL fragment with tenant + soft-delete filters.
 *
 * Generic form:
 *   withTenant(eq(companies.id, id), { tenantId, table: companies })
 *   → AND companies.tenant_id = ? AND companies.deleted_at IS NULL AND companies.id = ?
 *
 * If `table` is omitted, only the inner condition is returned (a no-op wrap
 * for callers that have already constructed their own filters; mostly useful
 * during incremental migration).
 *
 * @returns A drizzle SQL fragment ready for `.where(...)`.
 */
export function withTenant<T>(
  condition: SQL<T> | SQLWrapper,
  opts: WithTenantOpts = {},
): SQL<unknown> {
  const parts: Array<SQL<unknown> | SQLWrapper> = [];

  if (opts.table && !opts.skipTenant) {
    if (opts.tenantId !== undefined && opts.tenantId !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parts.push(eq(opts.table.tenantId as any, opts.tenantId));
    }
    // If tenantId is undefined and skipTenant is false, the caller forgot to
    // pass one. We don't add a tenant filter (compiles a query that may leak)
    // — but we DO add a guard log so the audit reviewer can spot it.
    if (opts.tenantId === undefined && !opts.skipTenant) {
      log.warn(
        "[withTenant] called without tenantId and without skipTenant. " +
        "This query is NOT tenant-scoped. If intentional, pass { skipTenant: true } " +
        "and add a CROSS-TENANT justification comment at the call site.",
      );
    }
  }
  if (opts.table && !opts.skipSoftDelete) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parts.push(isNull(opts.table.deletedAt as any));
  }
  parts.push(condition);

  return and(...(parts as SQL<unknown>[])) as SQL<unknown>;
}

/* -------------------------------------------------------------------------
 * Active-tenant resolution (session-scoped)
 * ------------------------------------------------------------------------- */

/**
 * Get the active tenant id for the session user.
 *
 * Reads from `user_prefs.active_tenant_id` (the canonical v12 source).
 *
 * Returns null when:
 *   - the request has no resolvable user id (not logged in), OR
 *   - the user has no preference row (signup not yet completed), OR
 *   - the user's preference row has active_tenant_id = NULL.
 *
 * Hot path. Synchronous because user_prefs is a thin per-user row and
 * better-sqlite3 select-by-pk is fast (< 50 µs).
 */
export function getCurrentTenantId(req: Request): string | null {
  const userId = resolveSessionUserId(req);
  if (!userId) return null;
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — justified because user_prefs is keyed by userId
    // (not tenant_id) and is the table that resolves the active tenant in the
    // first place. There is no chicken-and-egg.
    const rows = db
      .select({ activeTenantId: userPrefs.activeTenantId })
      .from(userPrefs)
      .where(eq(userPrefs.userId, userId))
      .limit(1)
      .all();
    const row = rows[0];
    return row?.activeTenantId ?? null;
  } catch (err) {
    // user_prefs not yet migrated, or DB issue. Don't crash request handling.
    log.warn("[withTenant.getCurrentTenantId] read failed:", (err as Error).message);
    return null;
  }
}

/**
 * Set the active tenant for the session user.
 *
 * Upserts `user_prefs` (insert-or-update) so the next `getCurrentTenantId`
 * returns the new value.
 *
 * Throws if no session user is resolvable. Callers must validate auth first.
 */
export function setCurrentTenantId(req: Request, tenantId: string): void {
  const userId = resolveSessionUserId(req);
  if (!userId) throw new Error("setCurrentTenantId: no session user resolved");
  const now = new Date().toISOString();
  const db = getDb();
  // CROSS-TENANT (admin) — justified because user_prefs is the table that
  // *defines* the active tenant; it cannot itself be tenant-scoped.
  db.insert(userPrefs)
    .values({ userId, activeTenantId: tenantId, updatedAt: now })
    .onConflictDoUpdate({
      target: userPrefs.userId,
      set: { activeTenantId: tenantId, updatedAt: now },
    })
    .run();
}

/**
 * Helper for explicit cross-tenant queries (admin/system-level).
 * Equivalent to passing `{ skipTenant: true, table }` to withTenant — exists
 * to make the intent obvious at the call site:
 *
 *   db.select().from(users).where(crossTenant(eq(users.email, e), users))
 */
export function crossTenant<T>(
  condition: SQL<T> | SQLWrapper,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  opts: { skipSoftDelete?: boolean } = {},
): SQL<unknown> {
  return withTenant(condition, { table, skipTenant: true, skipSoftDelete: opts.skipSoftDelete });
}
