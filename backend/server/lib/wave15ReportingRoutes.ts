/**
 * server/lib/wave15ReportingRoutes.ts
 *
 * WAVE 15 — the HTTP surface for the two reporting engines that Wave 14 left
 * without one. "An engine with no route is NOT shipped."
 *
 *   M-1d  GET  /api/reporting/vehicles/:kind/:id/footnotes
 *         Binds packages/math-fns `renderFootnotes` (zero callers before this
 *         wave) to `wave9_reporting_config` via server/lib/wave15FootnoteBinding.ts.
 *
 *   M-5   GET  /api/reporting/spv/:spvId/carry-accrual
 *         POST /api/reporting/spv/:spvId/carry-accrual   (compute AND persist)
 *         GET  /api/reporting/spv/:spvId/carry-accruals  (history)
 *         Accrued carry at an as-of date. Writes `spv_carry_accrual`
 *         (migration 0170) — a table with a DB-level cent-conservation CHECK
 *         and, before this wave, no writer at all.
 *
 * The GET routes NEVER write. Persisting an accrual is an explicit POST, so
 * opening a report cannot mutate the record it is reporting on.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "./authMiddleware";
import { log } from "./logger";
import { buildFootnotes, FootnoteConfigError } from "./wave15FootnoteBinding";
import {
  computeCarryAccrual,
  persistCarryAccrual,
  listCarryAccruals,
  CarryAccrualError,
  type CarryBasis,
} from "./wave15CarryAccrual";

const VEHICLE_KINDS: readonly string[] = Object.freeze(["spv", "fund", "company", "portfolio"] as const);

function actorOf(req: Request): string {
  const c = (req as any).userContext ?? {};
  return String(c?.userId ?? c?.identity?.email ?? "u_unknown");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(res: Response, e: unknown): void {
  if (e instanceof FootnoteConfigError || e instanceof CarryAccrualError) {
    // A config/terms problem is the OPERATOR's to fix, and the code says which
    // key or row. It is a 422, never a 200 with an empty body.
    res.status(422).json({ ok: false, error: e.code, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  log.warn(`[wave15ReportingRoutes] ${msg}`);
  res.status(500).json({ ok: false, error: "INTERNAL", message: msg });
}

function parseBasis(v: unknown): CarryBasis | undefined {
  if (v === "per_deployment" || v === "whole_spv") return v;
  return undefined;
}

export function registerWave15ReportingRoutes(app: Express): void {
  /* ---------------------------------------------------------------- M-1d --- */
  app.get("/api/reporting/vehicles/:kind/:id/footnotes", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (!VEHICLE_KINDS.includes(kind)) {
        res.status(400).json({ ok: false, error: "BAD_VEHICLE_KIND", message: `expected one of ${VEHICLE_KINDS.join(", ")}` });
        return;
      }
      const asOfDate = String(req.query.asOf ?? today()).slice(0, 10);
      const out = buildFootnotes({
        vehicleKind: kind,
        vehicleId: String(req.params.id),
        asOfDate,
        currency: typeof req.query.currency === "string" && req.query.currency ? String(req.query.currency) : undefined,
      });
      res.json({
        ok: true,
        vehicleKind: kind,
        vehicleId: String(req.params.id),
        asOfDate,
        footnotes: out.footnotes,
        config: out.config,
        configRead: out.configRead,
        sublineTreatment: out.sublineTreatment,
        valuationDateRequired: out.valuationDateRequired,
      });
    } catch (e) { fail(res, e); }
  });

  /* ----------------------------------------------------------------- M-5 --- */
  app.get("/api/reporting/spv/:spvId/carry-accrual", requireAuth, (req: Request, res: Response) => {
    try {
      const r = computeCarryAccrual({
        spvId: String(req.params.spvId),
        asOfDate: String(req.query.asOf ?? today()),
        basisOverride: parseBasis(req.query.basis),
      });
      res.json({ ok: true, persisted: false, accrual: r });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/reporting/spv/:spvId/carry-accrual", requireAuth, (req: Request, res: Response) => {
    try {
      const r = computeCarryAccrual({
        spvId: String(req.params.spvId),
        asOfDate: String(req.body?.asOfDate ?? req.query.asOf ?? today()),
        basisOverride: parseBasis(req.body?.basis ?? req.query.basis),
      });
      const id = persistCarryAccrual(r, actorOf(req));
      res.json({ ok: true, persisted: true, id, accrual: r });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/reporting/spv/:spvId/carry-accruals", requireAuth, (req: Request, res: Response) => {
    try {
      res.json({ ok: true, accruals: listCarryAccruals(String(req.params.spvId)) });
    } catch (e) { fail(res, e); }
  });
}
