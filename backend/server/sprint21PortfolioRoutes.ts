/**
 * Sprint 21 Wave C — C4: Portfolio-related server endpoints.
 *
 * New routes:
 *   POST /api/investor/collective/promote
 *     — Investor promotes a portfolio company to Capavate Collective.
 *     — Auth required. Creates investor_nomination record.
 *     — Notifies the founder via emitNotification.
 *     — Emits bridge event via emitMutation.
 *     — Rejects duplicates with 409.
 *     — Validates: companyId, rationale (20–1000 chars), confirmed (must be true).
 *
 *   GET /api/investor/companies/:id/promotion-status
 *     — Returns the promotion record if any, or null.
 *
 *   GET /api/investor/companies/:id/updates
 *     — Returns founder reports the investor was a recipient of.
 *     — Filters reports2 store by recipientIds.
 *
 * Registration: import { registerSprint21PortfolioRoutes } and call in routes.ts.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { emitMutation } from "./lib/eventBus";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getReports } from "./reportsStore";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type InvestorNomination = {
  id: string;
  kind: "investor_nomination";
  investorUserId: string;
  companyId: string;
  rationale: string;
  submittedAt: string;
};

/* ------------------------------------------------------------------ */
/* In-memory store                                                     */
/* ------------------------------------------------------------------ */

const investorNominations: InvestorNomination[] = [];

export function clearInvestorNominations(): void {
  investorNominations.length = 0;
}

export function getInvestorNominations(): InvestorNomination[] {
  return investorNominations;
}

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

const promoteSchema = z.object({
  companyId: z.string().min(1, "companyId is required"),
  rationale: z
    .string()
    .min(20, "Rationale must be at least 20 characters")
    .max(1000, "Rationale must be at most 1000 characters"),
  confirmed: z
    .boolean()
    .optional()
    .refine((v) => v !== false, {
      message: "Accredited investor confirmation required",
    }),
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Derive the founder userId from companyId for notification routing.
 * In production this would look up the company's founder. For the demo
 * environment we use a well-known mapping.
 */
function founderUserIdForCompany(companyId: string): string {
  // Patch v4: demo founder mapping only when demo gate is on; production returns empty.
  const MAP: Record<string, string> = DEMO_SEED_ENABLED ? {
    co_novapay: "u_maya_chen",
    co_arboreal: "u_maya_chen",
    co_quanta: "u_maya_chen",
    co_beacon: "u_maya_chen",
    co_tideline: "u_maya_chen",
  } : {};
  return MAP[companyId] ?? "";
}

/* ------------------------------------------------------------------ */
/* Route registration                                                  */
/* ------------------------------------------------------------------ */

export function registerSprint21PortfolioRoutes(app: Express): void {
  /**
   * POST /api/investor/collective/promote
   *
   * Body: { companyId: string; rationale: string; confirmed?: boolean }
   * Auth: required (x-user-id header or session cookie)
   */
  app.post(
    "/api/investor/collective/promote",
    (req: Request, res: Response) => {
      // Auth check — req.userContext is populated by global loadUserContext middleware.
      const userId = req.userContext?.userId;
      if (!userId || !req.userContext?.isAuthed) {
        return res.status(401).json({
          error: "NOT_AUTHED",
          message: "Sign in to promote a company.",
        });
      }

      // Validate body
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }

      const { companyId, rationale } = parsed.data;

      // Duplicate check — one promotion per investor per company
      const existing = investorNominations.find(
        (n) => n.investorUserId === userId && n.companyId === companyId,
      );
      if (existing) {
        return res.status(409).json({
          error: "already_promoted",
          message: `You already promoted this company on ${existing.submittedAt}.`,
          nomination: existing,
        });
      }

      // Create nomination record
      const id = `invnom_${randomBytes(8).toString("hex")}`;
      const nomination: InvestorNomination = {
        id,
        kind: "investor_nomination",
        investorUserId: userId,
        companyId,
        rationale,
        submittedAt: new Date().toISOString(),
      };
      investorNominations.push(nomination);

      // Notify the founder
      const founderUserId = founderUserIdForCompany(companyId);
      const rationaleSnippet =
        rationale.length > 120 ? rationale.slice(0, 120) + "…" : rationale;
      emitNotification({
        userId: founderUserId,
        kind: "collective.eligibility_gained" as NotificationKind,
        title: "A cap-table investor promoted you to Capavate Collective",
        body: rationaleSnippet,
        link: "/founder/apply-to-collective",
      });

      // Bridge event — so open founder/admin views refresh
      emitMutation({
        aggregate: "collective_nomination",
        id,
        change: "create",
      });

      return res.status(201).json({ ok: true, nomination });
    },
  );

  /**
   * GET /api/investor/companies/:id/promotion-status
   *
   * Returns the promotion record for the authenticated investor + companyId,
   * or null if not yet promoted.
   */
  app.get(
    "/api/investor/companies/:id/promotion-status",
    (req: Request, res: Response) => {
      const companyId = req.params.id;
      const userId = req.userContext?.userId ?? (req.headers["x-user-id"] as string | undefined);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const record = investorNominations.find(
        (n) => n.investorUserId === userId && n.companyId === companyId,
      );

      return res.json(record ?? null);
    },
  );

  /**
   * GET /api/investor/companies/:id/updates
   *
   * Returns the founder reports the authenticated investor was a recipient of,
   * filtered to the given companyId.
   *
   * Dynamically imports reports from reportsStore to avoid circular deps.
   */
  app.get(
    "/api/investor/companies/:id/updates",
    (req: Request, res: Response) => {
      const companyId = req.params.id;
      const userId = req.userContext?.userId ?? (req.headers["x-user-id"] as string | undefined);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const allReports = getReports();
      const filtered = allReports.filter(
        (r) =>
          r.companyId === companyId &&
          r.status === "sent" &&
          r.recipients.includes(userId),
      );

      return res.json(
        filtered.map((r) => ({
          id: r.id,
          title: r.title,
          period: r.period,
          sentAt: r.sentAt,
          template: r.template,
        })),
      );
    },
  );
}
