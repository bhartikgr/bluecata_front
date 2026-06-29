/**
 * v25.45.4 H-2 — Founder global search.
 *
 * Backs the header search box in client/src/components/AppShell.tsx, which was a
 * dead input (no onSubmit/state) prior to this version. Provides a single
 * read-only endpoint that searches three surfaces, scoped to the authenticated
 * founder's OWNED companies:
 *   1. Funding rounds        (rounds table, by name/type/state)
 *   2. Investor CRM contacts (investor_crm_contacts, by name/email/firm)
 *   3. Dataroom files        (data_room_files, by filename; company resolved via round)
 *
 * DB-DIRECT (read-only): this does NOT mutate, and deliberately does NOT touch
 * the Tier-2 AVI stores (investorCrmStore.ts is preserved byte-for-byte). It
 * reads their tables directly with parameterized queries.
 *
 * Tier 7 — each search emits an admin audit row (query + result counts) so the
 * new behavior is observable. The audit append is best-effort (never fatal).
 *
 * v25.46 EXTENSION POINT: add new searchable surfaces (e.g. messages, term
 * sheets) by appending a new `searchX()` block below and merging its hits into
 * `results`. Keep each surface DB-direct + ownership-scoped.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./lib/authMiddleware";
import { rawDb } from "./db/connection";
import { getCompaniesForFounder } from "./multiCompanyStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

export interface SearchHit {
  kind: "round" | "contact" | "file";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const MAX_PER_SURFACE = 8;

/** Escape LIKE wildcards so a user-typed % or _ is treated literally. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function searchFounderWorkspace(companyIds: string[], rawQuery: string): SearchHit[] {
  const q = rawQuery.trim();
  if (!q || companyIds.length === 0) return [];
  const term = likeTerm(q);
  const placeholders = companyIds.map(() => "?").join(",");
  const hits: SearchHit[] = [];

  // ---- 1. Rounds ----------------------------------------------------------
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT id, name, type, state, company_id FROM rounds
          WHERE company_id IN (${placeholders})
            AND deleted_at IS NULL
            AND (name LIKE ? ESCAPE '\\' OR type LIKE ? ESCAPE '\\' OR state LIKE ? ESCAPE '\\')
          ORDER BY name LIMIT ?`,
      )
      .all(...companyIds, term, term, term, MAX_PER_SURFACE);
    for (const r of rows) {
      hits.push({
        kind: "round",
        id: r.id,
        title: r.name ?? "(unnamed round)",
        subtitle: `${r.type ?? "round"} · ${r.state ?? "—"}`,
        href: `/founder/rounds/${r.id}`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] rounds search failed:", (err as Error).message);
  }

  // ---- 2. Investor CRM contacts ------------------------------------------
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT id, name, email, affiliation, company_id FROM investor_crm_contacts
          WHERE company_id IN (${placeholders})
            AND deleted_at IS NULL
            AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR affiliation LIKE ? ESCAPE '\\')
          ORDER BY name LIMIT ?`,
      )
      .all(...companyIds, term, term, term, MAX_PER_SURFACE);
    for (const c of rows) {
      hits.push({
        kind: "contact",
        id: c.id,
        title: c.name ?? "(unnamed contact)",
        subtitle: [c.affiliation, c.email].filter(Boolean).join(" · ") || "Investor contact",
        href: `/founder/investor-crm`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] contacts search failed:", (err as Error).message);
  }

  // ---- 3. Dataroom files --------------------------------------------------
  // The founder dataroom store persists to `dataroom_files` (company_id column).
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT id, name, company_id FROM dataroom_files
          WHERE company_id IN (${placeholders})
            AND deleted_at IS NULL
            AND name LIKE ? ESCAPE '\\'
          ORDER BY name LIMIT ?`,
      )
      .all(...companyIds, term, MAX_PER_SURFACE);
    for (const f of rows) {
      hits.push({
        kind: "file",
        id: f.id,
        title: f.name ?? "(unnamed file)",
        subtitle: "Dataroom file",
        href: `/founder/dataroom`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] files search failed:", (err as Error).message);
  }

  return hits;
}

export function registerFounderSearchRoutes(app: Express): void {
  // v25.45.4 H-2 — GET /api/founder/search?q=...  (read-only, ownership-scoped)
  app.get("/api/founder/search", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });

    const q = typeof req.query.q === "string" ? req.query.q : "";
    if (!q.trim()) {
      // Empty-state: valid response with zero results (not an error).
      return res.json({ ok: true, query: "", results: [], counts: { round: 0, contact: 0, file: 0 } });
    }

    const companyIds = getCompaniesForFounder(userId).map((c) => c.companyId);
    const results = searchFounderWorkspace(companyIds, q);
    const counts = {
      round: results.filter((r) => r.kind === "round").length,
      contact: results.filter((r) => r.kind === "contact").length,
      file: results.filter((r) => r.kind === "file").length,
    };

    // Tier 7 — emit an audit row recording the query and result counts.
    try {
      appendAdminAudit(userId, "founder_search", "founder_global_search", {
        query: q.trim().slice(0, 200),
        counts,
        companyCount: companyIds.length,
      });
    } catch (err) {
      log.warn("[founderSearch] audit append failed (non-fatal):", (err as Error).message);
    }

    return res.json({ ok: true, query: q.trim(), results, counts });
  });
}
