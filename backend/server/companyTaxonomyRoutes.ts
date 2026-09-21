/**
 * server/companyTaxonomyRoutes.ts — slide13b WAVE D (D2).
 *
 * HTTP surface for the DB-backed generic taxonomy (`taxonomy_terms`, 0236).
 * First namespace: company_sector.
 *
 *   GET   /api/company-taxonomy/:namespace                 requireAuth   + ?includeRetired=1 (active:false rows for labelling held values)   active terms, alphabetical
 *   GET   /api/admin/company-taxonomy/:namespace           requireAdmin  + ?includeRetired=1
 *   POST  /api/admin/company-taxonomy/:namespace/terms     requireAdmin  { value, label? }  → 201
 *   POST  /api/admin/company-taxonomy/:namespace/terms/label       requireAdmin  { value, label }
 *   POST  /api/admin/company-taxonomy/:namespace/terms/retire      requireAdmin  { value }
 *   POST  /api/admin/company-taxonomy/:namespace/terms/reactivate  requireAdmin  { value }
 *
 * The term VALUE travels in the BODY, never the path: seeded values contain
 * "/" ("Crypto / Web3", "AI / ML Platform") and "&", and a path segment is the
 * wrong place for them. There is deliberately NO endpoint that changes a
 * value — values are immutable (stored identifiers); only labels are edited.
 *
 * Failure semantics
 *   503 TAXONOMY_UNAVAILABLE   bootstrap failed closed (SQL missing / exec
 *                              failed / table or seed missing / non-SQLite).
 *                              Body carries `code` so the operator can act.
 *   500 AUDIT_WRITE_FAILED     audit row could not be written; the mutation
 *                              was ROLLED BACK — `durable:false` says so.
 *   409 TAXONOMY_CONFLICT      duplicate value / duplicate label (case-insens.)
 *                              / already in requested state.
 *   404 TAXONOMY_NOT_FOUND     unknown namespace or value.
 *   400 TAXONOMY_INVALID       empty / too long / control characters.
 *
 * This is NOT the partner classification surface (/api/admin/partner-taxonomy,
 * partner_sectors). Separate table, separate store, separate page.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  createTaxonomyTerm,
  listTaxonomyTerms,
  reactivateTaxonomyTerm,
  retireTaxonomyTerm,
  updateTaxonomyTermLabel,
  TaxonomyAuditWriteError,
  TaxonomyBootstrapError,
  TaxonomyConflictError,
  TaxonomyTermNotFoundError,
  TaxonomyUnknownNamespaceError,
  TaxonomyValidationError,
} from "./companyTaxonomyStore";
import type { TaxonomyListResponse } from "../shared/companyTaxonomy";

const TAG = "[slide13b:D company-taxonomy]";

/** Route param as a plain string (Express types it string | string[]). Namespace validation happens in the store. */
function nsParam(req: Request): string {
  const p = req.params.namespace as unknown;
  return Array.isArray(p) ? String(p[0] ?? "") : String(p ?? "");
}

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

function fail(res: Response, err: unknown): Response {
  if (err instanceof TaxonomyBootstrapError) {
    log.error(`${TAG} bootstrap failed closed: ${err.code}`, sanitizeErrorMessage(err));
    return res.status(503).json({
      ok: false,
      error: "TAXONOMY_UNAVAILABLE",
      code: err.code,
      message: err.message,
    });
  }
  if (err instanceof TaxonomyAuditWriteError) {
    log.error(`${TAG} audit write failed; mutation rolled back`, sanitizeErrorMessage(err));
    return res.status(500).json({
      ok: false,
      error: "AUDIT_WRITE_FAILED",
      durable: false,
      message: err.message,
    });
  }
  if (err instanceof TaxonomyUnknownNamespaceError || err instanceof TaxonomyTermNotFoundError) {
    return res.status(404).json({ ok: false, error: "TAXONOMY_NOT_FOUND", code: err.code, message: err.message });
  }
  if (err instanceof TaxonomyConflictError) {
    return res.status(409).json({ ok: false, error: "TAXONOMY_CONFLICT", code: err.code, message: err.message });
  }
  if (err instanceof TaxonomyValidationError) {
    return res.status(400).json({ ok: false, error: "TAXONOMY_INVALID", code: err.code, message: err.message });
  }
  log.error(`${TAG} unhandled`, sanitizeErrorMessage(err));
  return res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
}

function listPayload(namespace: string, includeRetired: boolean): TaxonomyListResponse {
  const terms = listTaxonomyTerms(namespace, { includeRetired });
  return {
    ok: true,
    namespace: namespace as TaxonomyListResponse["namespace"],
    terms,
    includesRetired: includeRetired,
    dialect: "sqlite",
  };
}

function bodyValue(req: Request): string {
  const v = (req.body as { value?: unknown } | undefined)?.value;
  if (typeof v !== "string" || !v.trim()) {
    throw new TaxonomyValidationError("VALUE_REQUIRED", "value is required");
  }
  return v.trim();
}

export function registerCompanyTaxonomyRoutes(app: Express): void {
  /* ── read (any authenticated persona) ── */
  app.get("/api/company-taxonomy/:namespace", requireAuth, (req: Request, res: Response) => {
    try {
      // `?includeRetired=1` lets a consumer LABEL a held-but-retired value as
      // retired (active:false rows are never offered for new selection by
      // mergeTaxonomyOptions). Default stays active-only.
      const includeRetired = req.query.includeRetired === "1" || req.query.includeRetired === "true";
      return res.json(listPayload(nsParam(req), includeRetired));
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ── admin read (may include retired) ── */
  app.get("/api/admin/company-taxonomy/:namespace", requireAdmin, (req: Request, res: Response) => {
    try {
      const includeRetired = req.query.includeRetired === "1" || req.query.includeRetired === "true";
      return res.json(listPayload(nsParam(req), includeRetired));
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ── admin create ── */
  app.post("/api/admin/company-taxonomy/:namespace/terms", requireAdmin, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { value?: unknown; label?: unknown };
      const term = createTaxonomyTerm(
        nsParam(req),
        { value: body.value, label: body.label },
        { actor: actorOf(req) },
      );
      return res.status(201).json({ ok: true, term });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ── admin relabel (value immutable) ── */
  app.post("/api/admin/company-taxonomy/:namespace/terms/label", requireAdmin, (req: Request, res: Response) => {
    try {
      const value = bodyValue(req);
      const label = (req.body as { label?: unknown }).label;
      const term = updateTaxonomyTermLabel(nsParam(req), value, label, { actor: actorOf(req) });
      return res.json({ ok: true, term });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ── admin retire ── */
  app.post("/api/admin/company-taxonomy/:namespace/terms/retire", requireAdmin, (req: Request, res: Response) => {
    try {
      const term = retireTaxonomyTerm(nsParam(req), bodyValue(req), { actor: actorOf(req) });
      return res.json({ ok: true, term });
    } catch (err) {
      return fail(res, err);
    }
  });

  /* ── admin reactivate ── */
  app.post("/api/admin/company-taxonomy/:namespace/terms/reactivate", requireAdmin, (req: Request, res: Response) => {
    try {
      const term = reactivateTaxonomyTerm(nsParam(req), bodyValue(req), { actor: actorOf(req) });
      return res.json({ ok: true, term });
    } catch (err) {
      return fail(res, err);
    }
  });
}
