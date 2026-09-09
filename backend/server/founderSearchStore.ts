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
  /* W-AVI65 FIX 3 — "company" added so a founder can find their OWN companies
     from the header box (previously only rounds/contacts/files were searchable,
     so typing a company name returned "No matches"). */
  kind: "round" | "contact" | "file" | "company";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const MAX_PER_SURFACE = 8;

/**
 * WAVE 347 · ITEM 3 — tenant id for a company id.
 *
 * A LOCAL COPY, ON PURPOSE. This reproduces `tenantForCompany` in
 * server/founderCrmStore.ts:99-101 — the function the WRITER of
 * `founder_crm_contacts` uses to stamp `tenant_id`: `contactToRow` (:193) sets
 * `tenantId: tenantForCompany(c.companyId)` and is the value passed to every one of
 * the six INSERTs into that table (:295, :771, :1198, :1363, :1565, :1697). It is
 * duplicated rather than imported because that function is
 * module-private in eleven different stores (roundsStore.ts:45,
 * founderCrmStore.ts:99, dataroomStore.ts:167, and so on), each an identical
 * one-line copy; exporting one of them and rewiring the others is a refactor with
 * a blast radius far larger than this fix, and the read must be tenant-scoped now.
 * IF THE TENANT NAMING RULE EVER CHANGES, THIS COPY MUST CHANGE WITH THE OTHERS.
 */
function tenantForCompanySearch(companyId: string): string {
  return `tenant_co_${companyId}`;
}

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
        /* ITEM 11 — AN API PATH IN A UI SLOT. `href` is where the browser is
           sent when the founder clicks a search result, and `/founder/investor-crm`
           is NOT a route: `client/src/App.tsx` registers `/founder/crm` (:742)
           and `/founder/crm/new` (:739), and nothing else. The string looked
           plausible because `/api/founder/investor-crm` IS the API path these
           rows come from — the server path was pasted into the client slot, so
           every contact hit led to a dead page. */
        href: `/founder/crm`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] contacts search failed:", (err as Error).message);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 347 · ITEM 3 — 2b. THE FOUNDER'S OWN CRM CONTACTS.

     THE COMMENT THAT USED TO SIT IN BLOCK 2 ABOVE, AND WAS WRONG:

         "THE PREMISE THAT FAILED, recorded so it is not re-investigated: the
          finding also claimed global search does not index CRM contacts. IT
          DOES — that is what this very block is. Nothing was built for it."

     That refutation was itself false, and it dismissed a true finding for a whole
     release band. Block 2 above indexes `investor_crm_contacts`. The founder CRM
     screen at `/founder/crm` is NOT that table: `GET /api/founder/investor-crm` is
     served by server/founderCrmStore.ts (route at :445) and that store is
     AUTHORITATIVE OVER `founder_crm_contacts` — stated at :20 ("the
     `founder_crm_contacts` table is authoritative"), imported at :53, cached at
     :277, written at :289-295, and confirmed independently by
     server/recordArchiveStore.ts:105-108. THE ROUTE NAME AND THE TABLE NAME
     DISAGREE, and the author of block 2 followed the route's name.

     THE CONSEQUENCE, MEASURED: `founder_crm_contacts` holds 607 rows in this tree
     and `investor_crm_contacts` holds 0. A founder typing the exact name of a
     contact they created on their own CRM screen got "No matches" — every time,
     for every contact, since this file was written.

     WHY THIS IS AN ADDED BLOCK AND NOT A ONE-LINE TABLE SWAP. Pointing block 2 at
     the right table would have been tidier and it would have been the DESTRUCTIVE
     option: `investor_crm_contacts` has its own writers (server/investorCrmStore.ts)
     and its emptiness in THIS tree is not proof of its emptiness in a live one.
     Switching would silently delete whatever that block finds today. So both tables
     are searched, and neither surface loses a result it had. ADD, NEVER SWITCH.

     COLUMN DIFFERENCES, since the two tables are not shaped alike:
       · there is no `affiliation` column here; the firm is `firm_name`, with
         `company_name` as the newer discrete field (v25.51 name-split).
       · matching therefore runs over name, email, firm_name AND company_name.
     Same tenant scoping as every other block: `company_id IN (companyIds)` where
     `companyIds` comes from `getCompaniesForFounder(userId)`. Same `deleted_at IS
     NULL` filter the store's own hydration uses. Same `href` as block 2, because
     `/founder/crm` is the screen that owns these rows.

     TENANT SCOPE — A REAL PREDICATE, NOT AN EXEMPTION. `lint:tenant-scope-fence`
     REFUSED the first version of this block, and it was right to: unlike the four
     surfaces above it, `founder_crm_contacts` carries a `tenant_id` column, and
     `company_id IN (...)` alone leaves it unread. The fence offered an exemption
     marker as an alternative. That was declined — an exemption records that a
     cross-tenant read is deliberate, and this read is not. `tenant_id` is DERIVED,
     not guessed: `tenantForCompanySearch` below reproduces the store's own
     `tenantForCompany` (server/founderCrmStore.ts:99-101, `tenant_co_${companyId}`),
     so the predicate is the same rule the writer used. Checked against the physical
     table before adding it, so the extra predicate cannot silently drop rows: all
     607 rows satisfy `tenant_id = 'tenant_co_' || company_id`, 0 mismatches. The
     read is now scoped BOTH ways, which is strictly narrower than block 2 above
     (whose unscoped `investor_crm_contacts` read is carried in
     scripts/lint/tenant_scope_fence_baseline.json:1115 and is not touched here).

     ARCHIVED CONTACTS ARE NOT EXCLUDED, and that is deliberate, not an oversight.
     The archive (WAVE 344, migration 0234) is a SEPARATE registry table, not a
     column here; archived contacts remain visible on `/founder/crm` behind the
     "Show archived contacts" toggle, so they are found rather than hidden. Adding an
     archive join would make search quieter than the screen it links to.
     ══════════════════════════════════════════════════════════════════════════ */
  try {
    const tenantIds = companyIds.map(tenantForCompanySearch);
    const rows: any[] = rawDb()
      .prepare(
        `SELECT id, name, email, firm_name, company_name, company_id FROM founder_crm_contacts
          WHERE tenant_id IN (${placeholders})
            AND company_id IN (${placeholders})
            AND deleted_at IS NULL
            AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR firm_name LIKE ? ESCAPE '\\' OR company_name LIKE ? ESCAPE '\\')
          ORDER BY name LIMIT ?`,
      )
      .all(...tenantIds, ...companyIds, term, term, term, term, MAX_PER_SURFACE);
    for (const c of rows) {
      hits.push({
        kind: "contact",
        id: c.id,
        title: c.name ?? "(unnamed contact)",
        /* `firm_name` is stored as the placeholder "—" for company-less contacts
           (server/founderCrmStore.ts:752), which would read as a real affiliation in
           a subtitle, so it is filtered out alongside blanks. */
        subtitle: [c.company_name, c.firm_name === "—" ? null : c.firm_name, c.email]
          .filter((s) => typeof s === "string" && s.trim() !== "")
          .join(" · ") || "Investor contact",
        href: `/founder/crm`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] founder CRM contacts search failed:", (err as Error).message);
  }

  // ---- 4. Companies (W-AVI65 FIX 3) ---------------------------------------
  /* The header box advertises itself as a workspace search but had no company
     surface at all, so a founder typing their own company/workspace name got
     "No matches". STRICTLY tenant-scoped: `id IN (companyIds)` where companyIds
     comes from getCompaniesForFounder(userId) — a founder can never match
     another tenant's company. Matches BOTH `name` and `legal_name` because the
     live workspace label ("<Founder>'s Workspace") is PERSISTED into
     companies.name / companies.legal_name (paymentGatewayAdapter.ts:623-624),
     which is exactly the string admins/founders see and type. */
  try {
    const rows: any[] = rawDb()
      .prepare(
        `SELECT id, name, legal_name, sector, stage FROM companies
          WHERE id IN (${placeholders})
            AND deleted_at IS NULL
            AND (name LIKE ? ESCAPE '\\' OR legal_name LIKE ? ESCAPE '\\')
          ORDER BY name LIMIT ?`,
      )
      .all(...companyIds, term, term, MAX_PER_SURFACE);
    for (const c of rows) {
      hits.push({
        kind: "company",
        id: c.id,
        title: c.name ?? c.legal_name ?? "(unnamed company)",
        subtitle: [c.sector, c.stage].filter(Boolean).join(" · ") || "Workspace",
        href: `/founder/companies/${c.id}`,
      });
    }
  } catch (err) {
    log.warn("[founderSearch] companies search failed:", (err as Error).message);
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
      return res.json({ ok: true, query: "", results: [], counts: { round: 0, contact: 0, file: 0, company: 0 } });
    }

    const companyIds = getCompaniesForFounder(userId).map((c) => c.companyId);
    const results = searchFounderWorkspace(companyIds, q);
    const counts = {
      round: results.filter((r) => r.kind === "round").length,
      contact: results.filter((r) => r.kind === "contact").length,
      file: results.filter((r) => r.kind === "file").length,
      // W-AVI65 FIX 3 — additive count for the new company surface.
      company: results.filter((r) => r.kind === "company").length,
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
