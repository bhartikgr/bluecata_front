/**
 * WAVE 4B (PT-2) — partner classification REST surface.
 *
 * Read/write endpoints for a partner's classifications, plus admin CRUD over
 * the two lookup tables so a type can be added or retired WITHOUT a migration
 * (owner ruling, spec/PARTNER_TYPE_TAXONOMY.md).
 *
 * ENDPOINTS
 *   GET    /api/partner-taxonomy                              requireAuth
 *          The DB-driven taxonomy that feeds the grouped selector. Never a
 *          hardcoded client array. `?includeInactive=1` is admin-only.
 *
 *   GET    /api/admin/partners/:id/classifications            requireAdmin
 *   PUT    /api/admin/partners/:id/classifications            requireAdmin
 *          Full replace. Mandatory: an empty array is 422
 *          CLASSIFICATION_REQUIRED. Hybrids = several entries. Primary =
 *          first entry unless one carries isPrimary.
 *   POST   /api/admin/partners/:id/classifications/primary    requireAdmin
 *          { classificationId } — the primary stays editable.
 *
 *   GET    /api/partner/me/classifications                    requirePartnerAuth
 *          A partner reads its OWN classifications (display only).
 *
 *   GET    /api/admin/partner-taxonomy/sectors                requireAdmin
 *   POST   /api/admin/partner-taxonomy/sectors                requireAdmin
 *   PATCH  /api/admin/partner-taxonomy/sectors/:slug          requireAdmin
 *   DELETE /api/admin/partner-taxonomy/sectors/:slug          requireAdmin  (RETIRE)
 *   GET    /api/admin/partner-taxonomy/subsectors             requireAdmin
 *   POST   /api/admin/partner-taxonomy/subsectors             requireAdmin
 *   PATCH  /api/admin/partner-taxonomy/subsectors/:slug       requireAdmin
 *   DELETE /api/admin/partner-taxonomy/subsectors/:slug       requireAdmin  (RETIRE)
 *
 * DELETE is a RETIRE (`active = 0`), never a hard delete: historical rows must
 * keep rendering. The response says so explicitly (`retired: true`).
 *
 * 🚧 SCOPE FENCE — every route here is REPORTING AND FILTERING ONLY. None of
 * them changes what any persona can see or do; classification is not consulted
 * by any guard. `requireAdmin` / `requirePartnerAuth` are the EXISTING guards
 * and are applied on the basis of persona, never on the basis of a sector.
 * PT-5's lint rule + identical-payload test hold this line mechanically.
 *
 * No new public route: nothing is added to PUBLIC_API_PREFIXES or
 * PUBLIC_API_EXACT_PATHS (00_SHARED_STANDARDS §5).
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  getTaxonomy,
  listForPartner,
  listForPartners,
  partnerIdsMatching,
  replaceClassifications,
  setPrimary,
  createSector,
  updateSector,
  retireSector,
  createSubsector,
  updateSubsector,
  retireSubsector,
  countUsage,
  ClassificationValidationFailure,
  TaxonomyConflictError,
  TaxonomyNotFoundError,
} from "./partnerClassificationStore";
import {
  formatAll,
  formatPrimary,
  type PartnerClassificationInput,
} from "../shared/partnerClassification";

const TAG = "[partner-classification]";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

function isAdminRequest(req: Request): boolean {
  const ctx = (req as Request & { userContext?: { role?: string; isAdmin?: boolean } })
    .userContext;
  return ctx?.isAdmin === true || ctx?.role === "admin";
}

/** Map store errors onto stable HTTP codes. Never leaks a raw message. */
function fail(res: Response, err: unknown): Response {
  if (err instanceof ClassificationValidationFailure) {
    return res.status(422).json({
      ok: false,
      error: err.errors[0]?.code ?? "CLASSIFICATION_INVALID",
      errors: err.errors,
    });
  }
  if (err instanceof TaxonomyNotFoundError) {
    return res.status(404).json({ ok: false, error: "TAXONOMY_NOT_FOUND", message: err.message });
  }
  if (err instanceof TaxonomyConflictError) {
    return res.status(409).json({ ok: false, error: "TAXONOMY_CONFLICT", message: err.message });
  }
  log.error(`${TAG} unhandled`, sanitizeErrorMessage(err));
  return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
}

/** Parse the request body into classification inputs. Shape errors -> 400. */
function parseInputs(body: unknown): PartnerClassificationInput[] | null {
  const raw = (body as { classifications?: unknown })?.classifications;
  if (!Array.isArray(raw)) return null;
  const out: PartnerClassificationInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.sectorSlug !== "string" || typeof rec.subsectorSlug !== "string") return null;
    out.push({
      sectorSlug: rec.sectorSlug,
      subsectorSlug: rec.subsectorSlug,
      otherText: typeof rec.otherText === "string" ? rec.otherText : null,
      isPrimary: rec.isPrimary === true,
    });
  }
  return out;
}

export function registerPartnerClassificationRoutes(app: Express): void {
  /* ── Taxonomy read (feeds the grouped selector) ───────────────────────── */
  app.get("/api/partner-taxonomy", requireAuth, async (req: Request, res: Response) => {
    try {
      // Retired types are only exposed to admins; a normal editor must not be
      // able to pick one.
      const includeInactive = req.query.includeInactive === "1" && isAdminRequest(req);
      const taxonomy = await getTaxonomy({ includeInactive });
      res.json({ ok: true, ...taxonomy });
    } catch (err) {
      fail(res, err);
    }
  });

  /* ── A partner's own classifications (display only) ───────────────────── */
  app.get(
    "/api/partner/me/classifications",
    requirePartnerAuth,
    async (req: Request, res: Response) => {
      try {
        const partnerId = req.partnerContext!.partnerId;
        res.json({ ok: true, classifications: await listForPartner(partnerId) });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Bulk read for LIST surfaces (PT-4) ───────────────────────────────────
     One request for the whole visible page instead of one per row. Also
     accepts `sector` / `subsector` filter params: "filters match ANY
     classification, so a hybrid is found under every sector it holds"
     (owner ruling) — matching is deliberately NOT limited to the primary.
     Filtering is a REPORTING concern; the ids returned narrow a list, they
     never widen or narrow anyone's access. */
  app.get("/api/admin/partner-classifications", requireAdmin, async (req: Request, res: Response) => {
    try {
      const csvParam = (name: string): string[] =>
        String(req.query[name] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

      const sectorSlugs = csvParam("sector");
      const subsectorSlugs = csvParam("subsector");
      const requestedIds = csvParam("partnerIds");

      let partnerIds = requestedIds;
      let matchedIds: string[] | null = null;
      if (sectorSlugs.length > 0 || subsectorSlugs.length > 0) {
        matchedIds = await partnerIdsMatching({ sectorSlugs, subsectorSlugs });
        partnerIds =
          requestedIds.length > 0
            ? requestedIds.filter((id) => matchedIds!.includes(id))
            : matchedIds;
      }
      if (partnerIds.length === 0 && matchedIds === null) {
        return res.json({ ok: true, byPartner: {}, matchedPartnerIds: null });
      }
      const map = await listForPartners(partnerIds);
      const byPartner: Record<string, unknown[]> = {};
      for (const id of partnerIds) byPartner[id] = map.get(id) ?? [];
      res.json({ ok: true, byPartner, matchedPartnerIds: matchedIds });
    } catch (err) {
      fail(res, err);
    }
  });

  /* ── Export (PT-4) ────────────────────────────────────────────────────────
     CSV of classifications for a set of partners. Two columns by design:
     `Classification` carries the PRIMARY (single-value contexts read the
     primary) and `All classifications` carries the full hybrid set, so an
     export never silently drops a hybrid's second sector. */
  app.get(
    "/api/admin/partner-classifications/export.csv",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const partnerIds = String(req.query.partnerIds ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const map = await listForPartners(partnerIds);
        const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
        const lines = [
          ["Partner ID", "Classification", "All classifications"].map(esc).join(","),
        ];
        for (const id of partnerIds) {
          const rows = map.get(id) ?? [];
          lines.push([id, formatPrimary(rows), formatAll(rows)].map(esc).join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="partner-classifications.csv"',
        );
        res.send(lines.join("\n") + "\n");
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Admin read/write for one partner ─────────────────────────────────── */
  app.get(
    "/api/admin/partners/:id/classifications",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        res.json({ ok: true, classifications: await listForPartner(String(req.params.id)) });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.put(
    "/api/admin/partners/:id/classifications",
    requireAdmin,
    async (req: Request, res: Response) => {
      const partnerId = String(req.params.id);
      const inputs = parseInputs(req.body);
      if (inputs === null) {
        return res.status(400).json({
          ok: false,
          error: "BAD_REQUEST",
          message: "Expected { classifications: [{ sectorSlug, subsectorSlug, otherText?, isPrimary? }] }.",
        });
      }
      try {
        const rows = await replaceClassifications(partnerId, inputs, { mandatory: true });
        try {
          appendAdminAudit(actorOf(req), `partner:${partnerId}`, "partner.classification.set", {
            partnerId,
            classifications: rows.map((r) => ({
              sectorSlug: r.sectorSlug,
              subsectorSlug: r.subsectorSlug,
              isPrimary: r.isPrimary,
            })),
          });
        } catch {
          /* audit is best-effort; it must not fail the write */
        }
        res.json({ ok: true, classifications: rows });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.post(
    "/api/admin/partners/:id/classifications/primary",
    requireAdmin,
    async (req: Request, res: Response) => {
      const partnerId = String(req.params.id);
      const classificationId = (req.body as { classificationId?: unknown })?.classificationId;
      if (typeof classificationId !== "string" || !classificationId) {
        return res
          .status(400)
          .json({ ok: false, error: "BAD_REQUEST", message: "classificationId is required." });
      }
      try {
        const rows = await setPrimary(partnerId, classificationId);
        try {
          appendAdminAudit(actorOf(req), `partner:${partnerId}`, "partner.classification.primary", {
            partnerId,
            classificationId,
          });
        } catch {
          /* best-effort */
        }
        res.json({ ok: true, classifications: rows });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Admin CRUD: sectors ──────────────────────────────────────────────── */
  app.get("/api/admin/partner-taxonomy/sectors", requireAdmin, async (_req, res: Response) => {
    try {
      const taxonomy = await getTaxonomy({ includeInactive: true });
      res.json({ ok: true, sectors: taxonomy.sectors });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/partner-taxonomy/sectors", requireAdmin, async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.slug !== "string" || typeof b.label !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "BAD_REQUEST", message: "slug and label are required." });
    }
    try {
      const sector = await createSector({
        slug: b.slug,
        label: b.label,
        sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined,
        active: b.active === undefined ? undefined : b.active === true,
      });
      try {
        appendAdminAudit(actorOf(req), `partner_sector:${sector.slug}`, "partner_taxonomy.sector.create", { ...sector });
      } catch { /* best-effort */ }
      res.status(201).json({ ok: true, sector });
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch(
    "/api/admin/partner-taxonomy/sectors/:slug",
    requireAdmin,
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      try {
        const sector = await updateSector(String(req.params.slug), {
          label: typeof b.label === "string" ? b.label : undefined,
          sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined,
          active: b.active === undefined ? undefined : b.active === true,
        });
        try {
          appendAdminAudit(actorOf(req), `partner_sector:${sector.slug}`, "partner_taxonomy.sector.update", { ...sector });
        } catch { /* best-effort */ }
        res.json({ ok: true, sector });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.delete(
    "/api/admin/partner-taxonomy/sectors/:slug",
    requireAdmin,
    async (req: Request, res: Response) => {
      const slug = String(req.params.slug);
      try {
        const inUse = await countUsage("sector", slug);
        const sector = await retireSector(slug);
        try {
          appendAdminAudit(actorOf(req), `partner_sector:${slug}`, "partner_taxonomy.sector.retire", {
            slug,
            classificationsAffected: inUse,
          });
        } catch { /* best-effort */ }
        // Explicitly NOT a delete — historical rows keep rendering.
        res.json({ ok: true, retired: true, sector, classificationsRetainingIt: inUse });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  /* ── Admin CRUD: sub-sectors ──────────────────────────────────────────── */
  app.get("/api/admin/partner-taxonomy/subsectors", requireAdmin, async (_req, res: Response) => {
    try {
      const taxonomy = await getTaxonomy({ includeInactive: true });
      res.json({ ok: true, subsectors: taxonomy.subsectors });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post(
    "/api/admin/partner-taxonomy/subsectors",
    requireAdmin,
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (
        typeof b.slug !== "string" ||
        typeof b.label !== "string" ||
        typeof b.sectorSlug !== "string"
      ) {
        return res.status(400).json({
          ok: false,
          error: "BAD_REQUEST",
          message: "slug, sectorSlug and label are required.",
        });
      }
      try {
        const subsector = await createSubsector({
          slug: b.slug,
          sectorSlug: b.sectorSlug,
          label: b.label,
          sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined,
          active: b.active === undefined ? undefined : b.active === true,
          requiresOtherText: b.requiresOtherText === true,
        });
        try {
          appendAdminAudit(
            actorOf(req),
            `partner_subsector:${subsector.slug}`,
            "partner_taxonomy.subsector.create",
            { ...subsector },
          );
        } catch { /* best-effort */ }
        res.status(201).json({ ok: true, subsector });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.patch(
    "/api/admin/partner-taxonomy/subsectors/:slug",
    requireAdmin,
    async (req: Request, res: Response) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      try {
        const subsector = await updateSubsector(String(req.params.slug), {
          label: typeof b.label === "string" ? b.label : undefined,
          sectorSlug: typeof b.sectorSlug === "string" ? b.sectorSlug : undefined,
          sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined,
          active: b.active === undefined ? undefined : b.active === true,
          requiresOtherText:
            b.requiresOtherText === undefined ? undefined : b.requiresOtherText === true,
        });
        try {
          appendAdminAudit(
            actorOf(req),
            `partner_subsector:${subsector.slug}`,
            "partner_taxonomy.subsector.update",
            { ...subsector },
          );
        } catch { /* best-effort */ }
        res.json({ ok: true, subsector });
      } catch (err) {
        fail(res, err);
      }
    },
  );

  app.delete(
    "/api/admin/partner-taxonomy/subsectors/:slug",
    requireAdmin,
    async (req: Request, res: Response) => {
      const slug = String(req.params.slug);
      try {
        const inUse = await countUsage("subsector", slug);
        const subsector = await retireSubsector(slug);
        try {
          appendAdminAudit(
            actorOf(req),
            `partner_subsector:${slug}`,
            "partner_taxonomy.subsector.retire",
            { slug, classificationsAffected: inUse },
          );
        } catch { /* best-effort */ }
        res.json({ ok: true, retired: true, subsector, classificationsRetainingIt: inUse });
      } catch (err) {
        fail(res, err);
      }
    },
  );
}
