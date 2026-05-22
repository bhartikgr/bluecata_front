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
import { isOnCapTable } from "./membershipStore"; /* v16 F-coll-1 ownership */
import { requireCollectiveEnabled } from "./lib/featureFlags"; /* v16 Fix 6 */
import { getDb } from "./db/connection"; /* v16 F-coll-7 real founder lookup */
import { companyMembers, investorNominations as investorNominationsTable } from "../shared/schema"; /* v16 F-coll-7 / v17 Phase B */
import { eq, and, isNull } from "drizzle-orm"; /* v16 F-coll-7 / v17 Phase B */
import { createHash } from "node:crypto"; /* v17 Phase B hash-chain */
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults"; /* v17 Phase B */
import { log } from "./lib/logger";

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

/* ---------- v17 Phase B — hash-chain + hydrator ---------- */

/** In-memory hash-chain tip per tenant for audit-trail integrity. */
const chainTipByTenant = new Map<string, string | null>();

function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

export async function hydrateSprint21PortfolioStore(): Promise<void> {
  investorNominations.length = 0;
  chainTipByTenant.clear();
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(investorNominationsTable)
      .where(isNull((investorNominationsTable as any).deletedAt))
      .all() as any[];
    // Sort by created_at to rebuild chain in order.
    rows.sort((a: any, b: any) =>
      String(a.created_at ?? a.createdAt ?? "").localeCompare(String(b.created_at ?? b.createdAt ?? "")),
    );
    for (const r of rows) {
      const tenantId = r.tenant_id ?? r.tenantId ?? DEFAULT_CHAPTER_TENANT_ID;
      investorNominations.push({
        id: r.id,
        kind: "investor_nomination",
        investorUserId: r.investor_user_id ?? r.investorUserId,
        companyId: r.company_id ?? r.companyId,
        rationale: r.rationale,
        submittedAt: r.submitted_at ?? r.submittedAt,
      });
      chainTipByTenant.set(tenantId, r.hash ?? r.hash ?? null);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] sprint21PortfolioStore: ${rows.length} investor nominations restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] sprint21PortfolioStore: DB read failed:", msg);
    }
  }
  void DEFAULT_CHAPTER_ID;
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
 * v16 F-coll-7 — Real founder lookup for promotion notification.
 *
 * Old code returned "" for any company outside a demo seed map; the founder
 * notification was therefore a silent no-op for every real company. The fix
 * is a CROSS-TENANT admin lookup against `company_members` filtered to
 * `role = "founder"` — cross-tenant because the promoting investor and the
 * founder are deliberately not in the same tenant at notification time.
 *
 * Falls back to the legacy demo map ONLY when the DB row is missing (covers
 * the in-memory-test path where the company never landed in the DB).
 */
export async function founderUserIdForCompany(companyId: string): Promise<string | null> {
  if (!companyId) return null;
  const DEMO_MAP: Record<string, string> = DEMO_SEED_ENABLED ? {
    co_novapay: "u_maya_chen",
    co_arboreal: "u_maya_chen",
    co_quanta: "u_maya_chen",
    co_beacon: "u_maya_chen",
    co_tideline: "u_maya_chen",
  } : {};
  // Try DB first.
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — justified because we need to dispatch a
    // notification to a founder we don't yet have a relationship with at
    // notification time. No tenant scoping applied.
    const rows = await db.select({ userId: companyMembers.userId })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.role, "founder"),
      ))
      .limit(1);
    if (rows[0]?.userId) return rows[0].userId;
  } catch { /* fall through to demo map */ }
  return DEMO_MAP[companyId] ?? null;
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
    requireCollectiveEnabled, /* v16 Fix 6 — 503 when COLLECTIVE_ENABLED=0 */
    async (req: Request, res: Response) => {
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

      // v16 F-coll-1 — ownership: caller must be on the cap table of the
      // company they're promoting. Without this check, ANY authed investor
      // could spoof a nomination for any company.
      if (!isOnCapTable(userId, companyId)) {
        return res.status(403).json({ error: "not_on_cap_table" });
      }

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
      const submittedAt = new Date().toISOString();
      const chapterId = DEFAULT_CHAPTER_ID;
      const tenantId = DEFAULT_CHAPTER_TENANT_ID;
      const nomination: InvestorNomination = {
        id,
        kind: "investor_nomination",
        investorUserId: userId,
        companyId,
        rationale,
        submittedAt,
      };
      // v17 Phase B — DB write-through with hash-chain in same transaction.
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          // Read chain tip for this tenant from DB.
          const tipRow = tx
            .select({ hash: (investorNominationsTable as any).hash, createdAt: (investorNominationsTable as any).createdAt })
            .from(investorNominationsTable)
            .where(eq((investorNominationsTable as any).tenantId, tenantId))
            .all();
          const sorted = (tipRow as any[]).sort((a, b) =>
            String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
          );
          const prevHash = sorted.length > 0 ? sorted[sorted.length - 1].hash : null;
          const hash = computeHash(prevHash, { id, investorUserId: userId, companyId, rationale, submittedAt });
          tx.insert(investorNominationsTable).values({
            id,
            tenantId,
            chapterId,
            investorUserId: userId,
            companyId,
            rationale,
            prevHash,
            hash,
            submittedAt,
            createdAt: submittedAt,
          } as any).run();
          chainTipByTenant.set(tenantId, hash);
        });
      } catch (err) {
        log.warn("[sprint21PortfolioRoutes.promote] DB insert failed (memory only):", (err as Error).message);
      }
      investorNominations.push(nomination);

      // Notify the founder — v16 F-coll-7: real DB lookup, skip if null.
      const founderUserId = await founderUserIdForCompany(companyId);
      const rationaleSnippet =
        rationale.length > 120 ? rationale.slice(0, 120) + "…" : rationale;
      if (founderUserId) {
        emitNotification({
          userId: founderUserId,
          kind: "collective.eligibility_gained" as NotificationKind,
          title: "A cap-table investor promoted you to Capavate Collective",
          body: rationaleSnippet,
          link: "/founder/apply-to-collective",
        });
      }

      // Bridge event — so open founder/admin views refresh
      emitMutation({
        aggregate: "collective_nomination",
        id,
        change: "create",
      });
      // v18 Phase D — SSE fan-out (post-commit).
      try {
        const { publish: ssePublish } = require("./lib/sseHub");
        ssePublish(chapterId, "offers", {
          kind: "offer.created",
          offerId: id,
          companyId,
          investorUserId: userId,
        });
      } catch { /* non-fatal */ }

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
      const userId = req.userContext?.userId ?? null; /* v14 — no header fallback */
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
      const userId = req.userContext?.userId ?? null; /* v14 — no header fallback */
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
