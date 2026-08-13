/**
 * WAVE 30 · ENGINE 3 — routes for `spv_template`.
 *
 * Base: `/api/partner/me/spv-templates*`.
 *
 * FAIL-CLOSED isolation: `partnerId` always comes from `req.partnerContext`
 * (session-derived), never from the URL or the body. No route on this module
 * accepts a partner id as input, so there is nothing for a caller to tamper
 * with.
 *
 * Cross-partner refusals are **404, not 403** — a 403 confirms the id exists
 * and turns the endpoint into an enumeration oracle for other firms' template
 * inventories. The refusal for another firm's real template is byte-identical
 * to the refusal for an id that exists nowhere.
 *
 * WRITE GATING: creates, edits, archives, deletes and applies all require a
 * write sub-role AND a signed agreement. Reads are role-gated but not
 * agreement-gated, matching the house convention.
 *
 * WHY `apply` IS A WRITE THAT DOES NOT CREATE AN SPV: it returns prefill values
 * for the SPV create form and records the application. It cannot create an SPV.
 * SPV creation is gated by the Wave 1c launch sign-off (a durable attested
 * signature recorded BEFORE the SPV row exists, failing closed if it cannot be
 * persisted); an "apply and launch" shortcut would route around that gate. It
 * is nonetheless a WRITE endpoint because it appends to the application log and
 * increments the usage counter.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import {
  listTemplatesForPartner,
  getTemplate,
  countsByCurrency,
  listApplications,
  createTemplate,
  updateTemplate,
  setArchived,
  deleteTemplate,
  applyTemplate,
  SpvTemplateNotFoundError,
  SpvTemplateValidationError,
} from "./spvTemplateStore";
import { log } from "./lib/logger";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

function partnerIdOf(req: Request): string {
  const ctx = (req as any).partnerContext as { partnerId?: string } | undefined;
  return String(ctx?.partnerId ?? "");
}

function actorOf(req: Request): string {
  return String((req as any).userContext?.userId ?? (req as any).userId ?? "");
}

/**
 * One error mapper for every route, so the 404-not-403 rule cannot be honoured
 * on some endpoints and forgotten on others. A validation error carries its own
 * machine-readable code; anything unrecognised is a 500 with no internals
 * leaked to the caller.
 */
function fail(res: Response, e: unknown): Response {
  if (e instanceof SpvTemplateNotFoundError) {
    return res.status(404).json({ error: "SPV_TEMPLATE_NOT_FOUND" });
  }
  if (e instanceof SpvTemplateValidationError) {
    return res.status(400).json({ error: e.code, message: e.message });
  }
  log.warn(`[spvTemplateRoutes] unexpected: ${e instanceof Error ? e.message : String(e)}`);
  return res.status(500).json({ error: "SPV_TEMPLATE_FAILED" });
}

export function registerSpvTemplateRoutes(app: Express): void {
  /* ── reads ─────────────────────────────────────────────────────────────── */

  app.get(
    "/api/partner/me/spv-templates",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const includeArchived = String(req.query.includeArchived ?? "") === "1";
        res.json({
          templates: listTemplatesForPartner(partnerIdOf(req), { includeArchived }),
          // Per-currency, never a cross-currency total. Summing minor units
          // across currencies produces a number that is not money.
          countsByCurrency: countsByCurrency(partnerIdOf(req)),
        });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  app.get(
    "/api/partner/me/spv-templates/:templateId",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      try {
        const pid = partnerIdOf(req);
        const tid = String(req.params.templateId);
        res.json({ template: getTemplate(pid, tid), applications: listApplications(pid, tid) });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  /* ── writes ────────────────────────────────────────────────────────────── */

  app.post(
    "/api/partner/me/spv-templates",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const created = createTemplate(
          partnerIdOf(req),
          body as any,
          actorOf(req) || null,
        );
        res.status(201).json({ template: created });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  app.patch(
    "/api/partner/me/spv-templates/:templateId",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        res.json({
          template: updateTemplate(partnerIdOf(req), String(req.params.templateId), body as any),
        });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  app.post(
    "/api/partner/me/spv-templates/:templateId/archive",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const archived = (req.body ?? {})?.archived !== false;
        res.json({
          template: setArchived(partnerIdOf(req), String(req.params.templateId), archived),
        });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  app.delete(
    "/api/partner/me/spv-templates/:templateId",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const ok = deleteTemplate(partnerIdOf(req), String(req.params.templateId));
        res.json({ deleted: ok });
      } catch (e) {
        fail(res, e);
      }
    },
  );

  app.post(
    "/api/partner/me/spv-templates/:templateId/apply",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const prefill = applyTemplate(
          partnerIdOf(req),
          String(req.params.templateId),
          actorOf(req) || null,
        );
        // `spvCreated` is echoed to the client so the UI cannot mistake this for
        // a launch. It is structurally false — this path has no write to `spvs`.
        res.json({ prefill });
      } catch (e) {
        fail(res, e);
      }
    },
  );
}
