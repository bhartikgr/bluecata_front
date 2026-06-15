/**
 * Sprint 14 D4 — DSC Feedback relay.
 *
 * v16 Addendum A — MIGRATED FROM IN-MEMORY MAP TO DB-BACKED HYBRID.
 *
 * Closes audit finding F-coll-26: feedback previously lived in
 * `Map<string, DscFeedback>` only and was lost on restart. The pattern below
 * mirrors v15 `softCircleStore` — write-through transactions, sequential
 * hydration, in-memory mirror as a read cache.
 *
 * Hard-rule compliance:
 *   - All writes wrapped in `getDb().transaction((tx) => {...})` (no `()`).
 *   - Tenant-scoped — every row stamps `tenant_id`. Reads use the
 *     in-memory mirror with explicit tenant filtering; `// CROSS-TENANT (admin)`
 *     comment marks the admin-aggregate views (`listFeedback`).
 *   - Sequential hydration via HYDRATE_ORDER.
 *   - Hash chain (`dscFeedbackChain`) unchanged — used for audit verification.
 *
 * Per harvest §3 Bullet 3: inbound `dsc.scores` lands here, summarized into
 * a tier + top/bottom 3 dimensions + narrative (no individual member votes
 * exposed). The founder gets a `dsc.review_received` notification and a
 * read-only summary card on the M&A panel.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";
import { requireAuth, requireAdmin } from "./lib/authMiddleware"; /* v16 F-coll-25 */
import { getCompaniesForFounder } from "./multiCompanyStore"; /* v25.13 NH1 — company ownership check */
import { appendAdminAudit } from "./adminPlatformStore"; /* v16 F-coll-25 audit trail */
import { getDb } from "./db/connection"; /* v16 Addendum A */
import { dscFeedback as dscFeedbackTable } from "../shared/schema"; /* v16 Addendum A */
import { log } from "./lib/logger";

export const dscScoresInboundSchema = z.object({
  companyId: z.string().min(1),
  /** Aggregated tier the DSC has voted on the company. */
  tier: z.enum(["watch", "qualified", "featured", "priority"]),
  dimensions: z.record(z.string(), z.number().min(0).max(100)),
  narrative: z.string().max(2000),
  /** Anonymized member shortlist (no votes). */
  collectiveShortlist: z.array(z.object({ memberRoleId: z.string() })).default([]),
});

export interface DscFeedback {
  id: string;
  companyId: string;
  tier: "watch" | "qualified" | "featured" | "priority";
  topDimensions: { name: string; score: number }[];
  bottomDimensions: { name: string; score: number }[];
  narrative: string;
  receivedAt: string;
  shortlistCount: number;
  /** v16 Addendum A — for DB persistence */
  tenantId?: string;
  submitterUserId?: string;
}

const items = new Map<string, DscFeedback>();
export const dscFeedbackChain = registerChain(new HashChain<{
  id: string; companyId: string; tier: string; ts: string;
}>("dsc_feedback"));

function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

export function getLatestForCompany(companyId: string): DscFeedback | undefined {
  // Tenant-scoped: reads only this company's feedback.
  return Array.from(items.values())
    .filter((f) => f.companyId === companyId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
}

/**
 * CROSS-TENANT (admin) — returns all feedback across the platform. Callers
 * are responsible for any per-request tenant filtering; the existing
 * Collective routes are admin-or-member-gated by `requireCollectiveMember`.
 */
export function listFeedback(): DscFeedback[] {
  return Array.from(items.values());
}

export function ingestDscScores(input: {
  companyId: string;
  tier: "watch" | "qualified" | "featured" | "priority";
  dimensions: Record<string, number>;
  narrative: string;
  collectiveShortlist?: { memberRoleId: string }[];
  submitterUserId?: string; /* v16 Addendum A — who relayed it */
}): DscFeedback {
  return withTrace("comms.dsc.feedback_relay", "1.0.0", "US", () => {
    const dims = Object.entries(input.dimensions).map(([name, score]) => ({ name, score }));
    dims.sort((a, b) => b.score - a.score);
    const top = dims.slice(0, 3);
    const bottom = dims.slice(-3).reverse();
    const id = `dsc_${randomBytes(6).toString("hex")}`;
    const shortlist = input.collectiveShortlist ?? [];
    const submitterUserId = input.submitterUserId ?? "u_dsc_relay";
    const tenantId = tenantForCompany(input.companyId);
    const receivedAt = new Date().toISOString();
    const f: DscFeedback = {
      id,
      companyId: input.companyId,
      tier: input.tier,
      topDimensions: top,
      bottomDimensions: bottom,
      narrative: input.narrative,
      receivedAt,
      shortlistCount: shortlist.length,
      tenantId,
      submitterUserId,
    };

    // v16 Addendum A — DB write-through, transaction-wrapped.
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.insert(dscFeedbackTable)
          .values({
            id: f.id,
            tenantId,
            companyId: f.companyId,
            submitterUserId,
            tier: f.tier,
            scoreJson: JSON.stringify({
              topDimensions: top,
              bottomDimensions: bottom,
              dimensions: input.dimensions,
              shortlistCount: shortlist.length,
            }),
            notes: f.narrative,
            submittedAt: receivedAt,
            createdAt: receivedAt,
          } as any)
          .run();
      });
    } catch (err) {
      log.warn(
        "[dscFeedbackStore.ingestDscScores] DB write failed (memory only):",
        (err as Error).message,
      );
    }

    items.set(id, f);
    dscFeedbackChain.append({ id, companyId: f.companyId, tier: f.tier, ts: f.receivedAt });
    emitSync({
      eventType: "dsc.review_received",
      aggregateId: input.companyId,
      aggregateKind: "company",
      payload: { id, tier: f.tier, topDimensions: top, bottomDimensions: bottom, shortlistCount: shortlist.length },
      actorUserId: submitterUserId,
    });
    return f;
  });
}

export function __clearDscFeedback(): void {
  items.clear();
  dscFeedbackChain.__clear();
}

/* ---------- Hydration (v16 Addendum A) ---------- */
export async function hydrateDscFeedbackStore(): Promise<void> {
  items.clear();
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(dscFeedbackTable)
      .where(isNull((dscFeedbackTable as any).deletedAt ?? (dscFeedbackTable as any).deleted_at ?? null))
      .all() as any[];
    for (const r of rows) {
      let parsed: any = {};
      try { parsed = JSON.parse(r.score_json ?? r.scoreJson ?? "{}"); } catch { /* empty */ }
      const id = r.id;
      const f: DscFeedback = {
        id,
        companyId: r.company_id ?? r.companyId,
        tier: (r.tier ?? "watch") as DscFeedback["tier"],
        topDimensions: Array.isArray(parsed.topDimensions) ? parsed.topDimensions : [],
        bottomDimensions: Array.isArray(parsed.bottomDimensions) ? parsed.bottomDimensions : [],
        narrative: r.notes ?? "",
        receivedAt: r.submitted_at ?? r.submittedAt ?? r.created_at ?? r.createdAt,
        shortlistCount: Number(parsed.shortlistCount ?? 0),
        tenantId: r.tenant_id ?? r.tenantId,
        submitterUserId: r.submitter_user_id ?? r.submitterUserId,
      };
      items.set(id, f);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] dscFeedbackStore: ${rows.length} feedback rows restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] dscFeedbackStore: DB read failed:", msg);
    }
  }
  // suppress unused-import warning on `eq` (kept for future targeted updates).
  void eq;
}

export function registerDscFeedbackRoutes(app: Express): void {
  // v25.13 NH1 — was previously unguarded at the route layer and relied
  // solely on the global applyRouteGuards catch-all. Added requireAuth +
  // explicit per-request company-ownership check so a user can only read
  // DSC feedback for a company they own (founder) or hold via admin role.
  app.get(
    "/api/founder/ma/dsc-feedback",
    requireAuth,
    (req: Request, res: Response) => {
      const companyId = String(req.query.companyId ?? "");
      if (!companyId) return res.status(400).json({ error: "companyId required" });
      const ctx = (req as Request & { userContext?: { userId?: string; role?: string } }).userContext;
      const userId = ctx?.userId;
      const role = ctx?.role;
      if (!userId) return res.status(401).json({ error: "auth_required" });
      // Admins can read any company's DSC feedback (audit / oversight).
      if (role !== "admin") {
        try {
          const owned = getCompaniesForFounder(userId).some((c) => c.companyId === companyId);
          if (!owned) return res.status(403).json({ error: "forbidden_company" });
        } catch {
          return res.status(403).json({ error: "forbidden_company" });
        }
      }
      const f = getLatestForCompany(companyId);
      res.json({ feedback: f ?? null });
    },
  );

  // v16 F-coll-25 — mock-inbound is admin-only AND requires a confirm header.
  // Previously this route accepted arbitrary DSC tier writes from ANY authed user.
  // The endpoint is a dev/QA seeding shim; in production nobody should ever hit it.
  const requireMockConfirm = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-mock-confirm"] === "yes-i-understand-this-is-mock-data") return next();
    return res.status(403).json({
      error: "mock_confirmation_required",
      message: "Provide header `x-mock-confirm: yes-i-understand-this-is-mock-data` to use the mock-inbound endpoint.",
    });
  };
  app.post(
    "/api/founder/ma/dsc-feedback/_mock_inbound",
    requireAuth,
    requireAdmin,
    requireMockConfirm,
    (req: Request, res: Response) => {
      const parsed = dscScoresInboundSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
      const adminUserId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "unknown";
      // v16 Addendum A: pass submitterUserId so DB row records who relayed it.
      const f = ingestDscScores({ ...parsed.data, submitterUserId: adminUserId });
      // v16 F-coll-25 — audit any successful mock-inbound write.
      try {
        appendAdminAudit(
          adminUserId,
          `dsc_feedback:${f.id}`,
          "dsc.mock_inbound.write",
          {
            companyId: parsed.data.companyId,
            tier: parsed.data.tier,
            dimensionCount: Object.keys(parsed.data.dimensions).length,
          },
        );
      } catch { /* non-fatal */ }
      res.status(201).json(f);
    },
  );
}
