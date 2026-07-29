/**
 * server/lib/collectiveCompanyName.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 (identifier leakage), carried by v5 §G.
 *
 * THE PROBLEM. Three Collective read surfaces resolved a company's display name
 * with a chain that ended in the raw primary key:
 *
 *   collectiveRoutes.ts  companyName: canonical?.name ?? id
 *   collectiveRoutes.ts  companyName: canonical?.name ?? p.founderName ?? p.companyId
 *   collectiveRoutes.ts  companyName: canonical?.name ?? compId ?? "Unknown"
 *
 * `canonicalCompanies` is the empty array (dead seed data since v25.22), so in
 * production the first link ALWAYS misses and the fallback is what ships. That
 * means the Collective company list and the soft-circle board render internal
 * `co_…` identifiers as company names. Worse, the middle chain falls through to
 * `p.founderName` first — a NATURAL PERSON'S NAME rendered in a company-name
 * column, which is exactly the class of leak W3 #9 removed elsewhere.
 *
 * THE FIX. Resolve from the durable `companies` table, which is where a
 * company's name actually lives (`shared/schema.ts:80-83`, `name` NOT NULL), and
 * fall back to a neutral literal. Never a raw id, never a person's name.
 *
 * INVARIANTS (each has a test):
 *   • Reads ONLY `companies.name`, for a non-soft-deleted row.
 *   • Returns "Unnamed company" when the row is missing, soft-deleted, has a
 *     whitespace-only name, or the read throws. Never null, never a `co_…` id.
 *   • Never consults a founder / person display name.
 *   • Read-only, parameterised, `catch → UNNAMED_COMPANY`.
 *
 * NOTE ON IN-MEMORY READERS. `multiCompanyStore.getCompanyNameById()` was the
 * obvious candidate but it walks the in-process `USER_COMPANIES` Map, which is a
 * per-user membership cache: a company nobody has loaded this process-lifetime is
 * simply absent, so it would produce "Unnamed company" for perfectly good rows
 * after a restart. `getAllCompaniesFromDb()` is durable but materialises every
 * company on the platform per call. This module does the narrow durable read.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

/** The neutral label. The client keys off nothing here, but tests do. */
export const UNNAMED_COMPANY = "Unnamed company";

export interface CompanyNameResult {
  /** Always safe to render. Never a raw identifier. */
  name: string;
  /** True only when a live `companies` row with a non-empty name resolved. */
  resolved: boolean;
  reason?: "no_id" | "not_found" | "no_name" | "read_error";
}

export function resolveCollectiveCompanyName(
  companyId: string | null | undefined,
): CompanyNameResult {
  const id = (companyId ?? "").trim();
  if (!id) return { name: UNNAMED_COMPANY, resolved: false, reason: "no_id" };
  try {
    const row = rawDb()
      .prepare(
        `SELECT name FROM companies
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(id) as { name?: string } | undefined;
    if (!row) return { name: UNNAMED_COMPANY, resolved: false, reason: "not_found" };
    const name = String(row.name ?? "").trim();
    if (!name) return { name: UNNAMED_COMPANY, resolved: false, reason: "no_name" };
    return { name, resolved: true };
  } catch (err) {
    log.warn(
      "[collectiveCompanyName] companies read failed for",
      id,
      "-",
      (err as Error).message,
    );
    return { name: UNNAMED_COMPANY, resolved: false, reason: "read_error" };
  }
}

/**
 * Convenience wrapper. `preferred` is an already-safe name from a richer source
 * (e.g. a company PROFILE snapshot) and wins when non-empty; it must never be a
 * person name or an identifier. Everything else degrades to the durable read and
 * then to `UNNAMED_COMPANY`.
 */
export function collectiveCompanyName(
  companyId: string | null | undefined,
  preferred?: string | null,
): string {
  const p = (preferred ?? "").trim();
  if (p) return p;
  return resolveCollectiveCompanyName(companyId).name;
}

export default collectiveCompanyName;
