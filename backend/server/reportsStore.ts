/**
 * Sprint 11 — Investor Reports rebuild.
 *
 * Templates: Monthly KPI / Quarterly Update / Annual / Round Close / Ad-hoc
 * Sections (auto-generated): Highlights / KPIs / Financials / Asks / Risks /
 * Roadmap / Hiring / Press
 *
 * Stores reports + sections + read-receipts + per-section comments + schedules.
 *
 * Endpoints:
 *   GET  /api/founder/reports2                          — list reports (Sprint 11; legacy /api/reports retained)
 *   POST /api/founder/reports2                          — create report from template
 *   GET  /api/founder/reports2/:id                      — full report incl sections
 *   POST /api/founder/reports2/:id/send                 — send to recipients
 *   POST /api/founder/reports2/:id/schedule             — set recurring schedule
 *   POST /api/founder/reports2/:id/read                 — record a read-receipt
 *   POST /api/founder/reports2/:id/comments             — add comment to a section
 */
/**
 * PATCH v3: POST /api/founder/reports2 now requires companyId and verifies ownership.
 * Removed the co_novapay default fallback. Unauthenticated requests get 401.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { isNull } from "drizzle-orm";
import { emitSync } from "./sprint10Telemetry";
import { getUserContext, getUserContextForId } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// Patch v10 — F9 investor-update fanout
import { listMembersForCompany } from "./membershipStore";
import { emitNotification } from "./notificationsStore";
import { emitBridgeEvent } from "./bridgeStore";
// v13 (Avi's Issue 4) — DB write-through + hydrate
import { getDb } from "./db/connection";
import { reports as reportsTable } from "../shared/schema";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";

// Tenant id for a company. Same canonical pattern as roundsStore /
// adminPlatformStore / founderCrmStore.
function tenantForCompany(companyId: string): string {
  return `tenant_co_${companyId}`;
}

/**
 * v13 — persistReportToDb (Avi's Issue 4)
 *
 * Writes a single in-memory Report into the `reports` SQL table. Wrapped in
 * `getDb().transaction((tx) => {...})` per the hard-rule pattern (no
 * trailing `()` — Drizzle invokes the callback). Failures are non-fatal so
 * the route still returns 200 with the in-memory entity; the next boot will
 * just be missing this row.
 */
function persistReportToDb(r: Report, actorUserId: string | undefined, now: string): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(reportsTable)
        .values({
          id: r.id,
          tenantId: tenantForCompany(r.companyId),
          companyId: r.companyId,
          kind: r.template,
          title: r.title,
          period: r.period ?? null,
          status: r.status,
          contentJson: JSON.stringify({
            sections: r.sections,
            metricsSnapshot: r.metricsSnapshot,
            schedule: r.schedule,
            readReceipts: r.readReceipts,
            recipientsCount: r.recipientsCount,
          }),
          deliveryTargetsJson: JSON.stringify(r.recipients ?? []),
          generatedAt: now,
          generatedBy: actorUserId ?? null,
          sentAt: r.sentAt ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  } catch (err) {
    log.warn("[reportsStore.persistReportToDb] DB write failed (non-fatal):", (err as Error).message);
  }
}

/**
 * v13 — hydrateReportsStore (Avi's Issue 4)
 *
 * Rebuilds the in-memory `reports` array from `SELECT * FROM reports WHERE
 * deleted_at IS NULL`. Called sequentially by hydrateAllStores() on boot.
 * Tolerates first-boot "no such table".
 */
export async function hydrateReportsStore(): Promise<void> {
  // Clear the array in place so legacy importers keep their reference.
  reports.length = 0;
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — boot-time hydrate reads every live row in
    // `reports`. Per-tenant filtering happens at the API layer (founder owns
    // the company id) once the cache is populated.
    const rows = db
      .select()
      .from(reportsTable)
      .where(isNull(reportsTable.deletedAt))
      .all() as any[];
    for (const row of rows) {
      let content: any = {};
      try { content = JSON.parse((row.content_json ?? row.contentJson ?? "{}") as string); } catch { /* tolerated */ }
      let recipients: string[] = [];
      try {
        const dt = row.delivery_targets_json ?? row.deliveryTargetsJson;
        if (dt) recipients = JSON.parse(dt as string);
      } catch { /* tolerated */ }
      const r: Report = {
        id: row.id,
        companyId: row.company_id ?? row.companyId,
        template: (row.kind ?? "adhoc") as ReportTemplate,
        title: row.title,
        period: row.period ?? "",
        status: (row.status ?? "draft") as Report["status"],
        sentAt: row.sent_at ?? row.sentAt ?? null,
        recipients,
        recipientsCount: typeof content.recipientsCount === "number" ? content.recipientsCount : recipients.length,
        sections: Array.isArray(content.sections) ? content.sections : [],
        readReceipts: Array.isArray(content.readReceipts) ? content.readReceipts : [],
        schedule: content.schedule ?? null,
        metricsSnapshot: content.metricsSnapshot ?? { raisedToDateUsd: 0, capTableHolders: 0, softCirclePipelineUsd: 0, activeRounds: 0 },
      };
      reports.push(r);
    }
  } catch (err) {
    if (!/no such table/i.test((err as Error).message)) {
      log.warn("[reportsStore.hydrate] failed (continuing):", (err as Error).message);
    }
  }
}

export type ReportTemplate = "monthly_kpi" | "quarterly_update" | "annual" | "round_close" | "adhoc";

export type ReportSection = {
  id: string;
  kind: "highlights" | "kpis" | "financials" | "asks" | "risks" | "roadmap" | "hiring" | "press";
  title: string;
  body: string;
  comments: Array<{ id: string; ts: string; actor: string; text: string; reactions: Record<string, number> }>;
};

export type ReadReceipt = { investorId: string; openedAt: string; reads: number };

export type Schedule = {
  cron: string;
  cadence: "monthly" | "quarterly" | "annually" | "weekly";
  nextSendAt: string;
  enabled: boolean;
};

export type Report = {
  id: string;
  companyId: string;
  template: ReportTemplate;
  title: string;
  period: string;
  status: "draft" | "scheduled" | "sent";
  sentAt: string | null;
  recipients: string[];
  recipientsCount: number;
  sections: ReportSection[];
  readReceipts: ReadReceipt[];
  schedule: Schedule | null;
  metricsSnapshot: {
    raisedToDateUsd: number;
    capTableHolders: number;
    softCirclePipelineUsd: number;
    activeRounds: number;
  };
};

// Patch v4: gated demo seed.
const reports: Report[] = DEMO_SEED_ENABLED ? [
  {
    id: "rpt_apr_2026",
    companyId: "co_novapay",
    template: "monthly_kpi",
    title: "NovaPay AI — April 2026 Update",
    period: "April 2026",
    status: "sent",
    sentAt: "2026-05-02T14:00:00Z",
    recipients: ["u_aisha_patel", "u_forge_ventures", "u_hydra"],
    recipientsCount: 3,
    metricsSnapshot: { raisedToDateUsd: 11_050_000, capTableHolders: 14, softCirclePipelineUsd: 2_650_000, activeRounds: 2 },
    sections: defaultSections("monthly_kpi"),
    readReceipts: [
      { investorId: "u_aisha_patel", openedAt: "2026-05-02T16:30:00Z", reads: 3 },
      { investorId: "u_hydra",       openedAt: "2026-05-03T09:14:00Z", reads: 1 },
    ],
    schedule: { cron: "0 9 1 * *", cadence: "monthly", nextSendAt: "2026-06-01T09:00:00Z", enabled: true },
  },
] : [];

function defaultSections(template: ReportTemplate): ReportSection[] {
  const baseKinds: ReportSection["kind"][] = ["highlights", "kpis", "financials", "asks", "risks", "roadmap", "hiring", "press"];
  const titles: Record<ReportSection["kind"], string> = {
    highlights: "Highlights",
    kpis: "KPIs",
    financials: "Financials",
    asks: "Asks",
    risks: "Risks",
    roadmap: "Roadmap",
    hiring: "Hiring",
    press: "Press",
  };
  const seedBody: Record<ReportSection["kind"], string> = {
    highlights: "• Closed $2.65M of $4.0M soft-circle target\n• Onboarded 3 enterprise pilot customers\n• Hired Head of Compliance (ex-Stripe)",
    kpis: "ARR: $1.4M (+18% MoM)\nNet Retention: 137%\nGross Margin: 71%\nCash Runway: 19 months",
    financials: "Burn: $312k/mo\nCash on hand: $5.9M\nNext audit: Q3 2026",
    asks: "1) Warm intros to Series A leads\n2) RevOps consulting referrals\n3) Compliance counsel for SG entity",
    risks: "Cross-border settlement counterparty concentration; mitigations in dataroom Diligence/risk-register.xlsx",
    roadmap: "May–Jul: SG MAS sandbox launch · Aug: 2-sided liquidity cohort · Q4: Series A close",
    hiring: "Open: Sr. Backend Engineer, Compliance Manager (SG), Enterprise AE",
    press: "Featured in Fintech Weekly · Podcast on a16z 'Fintech in Practice'",
  };
  return baseKinds.map((k) => ({
    id: `sec_${k}_${randomBytes(3).toString("hex")}`,
    kind: k,
    title: titles[k],
    body: seedBody[k],
    comments: [],
  })).slice(0, template === "monthly_kpi" ? 8 : template === "quarterly_update" ? 8 : template === "annual" ? 8 : template === "round_close" ? 5 : 3);
}

export function registerReportsRoutes(app: Express): void {
  app.get("/api/founder/reports2", (req, res) => {
    // v14 — identity from session, no "co_novapay" fallback.
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "missing_identity" });
    const queryCid = typeof req.query.companyId === "string" ? req.query.companyId : null;
    const companyId = queryCid ?? ctx.founder.activeCompanyId;
    if (!companyId) return res.status(400).json({ ok: false, error: "missing_active_company" });
    if (!ctx.isAdmin && !ctx.founder.companies.some((c) => c.companyId === companyId)) {
      return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    }
    res.json(reports.filter((r) => r.companyId === companyId));
  });

  app.post("/api/founder/reports2", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { companyId, template, title, period } = req.body ?? {};
    if (!template || !title) return res.status(400).json({ error: "template + title required" });
    // PATCH v3: companyId is required; no ?? "co_novapay" fallback
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    // Verify ownership
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === companyId);
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    const r: Report = {
      id: `rpt_${randomBytes(4).toString("hex")}`,
      companyId,
      template,
      title,
      period: period ?? new Date().toISOString().slice(0, 7),
      status: "draft",
      sentAt: null,
      recipients: [],
      recipientsCount: 0,
      sections: defaultSections(template),
      readReceipts: [],
      schedule: null,
      // PATCH v3: new companies start at zero metrics; NovaPay values kept for demo only
      metricsSnapshot: { raisedToDateUsd: 0, capTableHolders: 0, softCirclePipelineUsd: 0, activeRounds: 0 },
    };
    reports.push(r);
    // v13 (Avi's Issue 4) — write-through to DB so reports survive restart.
    const now = new Date().toISOString();
    persistReportToDb(r, ctx.userId, now);
    try {
      appendAdminAudit(
        ctx.userId ?? "u_unknown",
        `company:${companyId}`,
        "report.created",
        { reportId: r.id, template, title },
        tenantForCompany(companyId),
      );
    } catch (err) {
      log.warn("[reportsStore.create] audit append failed:", (err as Error).message);
    }
    res.json(r);
  });

  app.get("/api/founder/reports2/:id", (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json(r);
  });

  /**
   * v23.4.8 — BUG 003/023 (Ozan, Critical):
   * Founder must be able to EDIT a draft report before sending. Accepts a
   * partial body { title?, period?, sections?: Array<{ id, title?, body? }> }
   * and updates the in-memory entity (DB write-through is best-effort).
   *
   * Only the founder who owns the company may edit. Sent reports are frozen:
   * status !== "draft" returns 409 conflict so the UI can disable Edit.
   */
  app.patch("/api/founder/reports2/:id", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: "not_found" });
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === r.companyId);
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    if (r.status !== "draft") {
      return res.status(409).json({ ok: false, error: "REPORT_NOT_DRAFT", message: "Only drafts can be edited." });
    }
    const { title, period, sections } = req.body ?? {};
    if (typeof title === "string" && title.trim().length > 0) r.title = title;
    if (typeof period === "string") r.period = period;
    if (Array.isArray(sections)) {
      for (const patch of sections) {
        if (!patch || typeof patch.id !== "string") continue;
        const sec = r.sections.find((s) => s.id === patch.id);
        if (!sec) continue;
        if (typeof patch.title === "string" && patch.title.trim().length > 0) sec.title = patch.title;
        if (typeof patch.body === "string") sec.body = patch.body;
      }
    }
    const now = new Date().toISOString();
    persistReportToDb(r, ctx.userId, now);
    try {
      appendAdminAudit(
        ctx.userId ?? "u_unknown",
        `company:${r.companyId}`,
        "report.edited",
        { reportId: r.id, fields: Object.keys(req.body ?? {}) },
        tenantForCompany(r.companyId),
      );
    } catch (err) {
      log.warn("[reportsStore.patch] audit append failed:", (err as Error).message);
    }
    res.json(r);
  });

  /**
   * v23.8 W-5/BUG-003 — recipient picker source of truth.
   * Returns the current cap-table members (userId + display name/email) for
   * this report's company. The Send dialog uses this so the chosen recipient
   * ids ALWAYS match what /send validates against (no CRM investorId mismatch).
   */
  app.get("/api/founder/reports2/:id/recipients", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: "not_found" });
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === r.companyId);
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
    const members = listMembersForCompany(r.companyId).map((m) => {
      let name = "";
      let email = "";
      try {
        const uc = getUserContextForId(m.userId);
        name = uc.identity.name ?? "";
        email = uc.identity.email ?? "";
      } catch {
        // best-effort enrichment; id still usable as recipient
      }
      return { userId: m.userId, name, email, ownershipPct: m.ownershipPct };
    });
    res.json(members);
  });

  app.post("/api/founder/reports2/:id/send", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    // Patch v10 — verify caller owns the company before sending
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === r.companyId);
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });

    // Recipient list: explicit body.recipients OR everyone on the cap table.
    const bodyRecipients: string[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    const capTableMemberIds = new Set(listMembersForCompany(r.companyId).map((m) => m.userId));
    let recipients = bodyRecipients;
    if (recipients.length === 0) {
      // Patch v10 (B-F9) — default to cap-table membership truth.
      recipients = Array.from(capTableMemberIds);
    } else {
      // v23.8 W-5/BUG-003 — when the founder explicitly chooses recipients via
      // the picker, every id must be a current cap-table member. Reject the
      // send (400) if any recipient is not on the cap table, so a report can
      // never be delivered to a non-holder.
      const invalid = recipients.filter((id) => !capTableMemberIds.has(id));
      if (invalid.length > 0) {
        return res.status(400).json({ ok: false, error: "INVALID_RECIPIENTS", invalid });
      }
    }
    r.recipients = recipients;
    r.recipientsCount = recipients.length;
    r.status = "sent";
    r.sentAt = new Date().toISOString();

    // Patch v10 — Fanout: emit in-app notification + bridge event for every recipient.
    let delivered = 0;
    for (const userId of recipients) {
      try {
        emitNotification({
          userId,
          kind: "investor_report.published",
          title: `Investor update: ${r.title}`,
          body: `New ${r.template.replace(/_/g, " ")} update from your portfolio company.`,
          link: `/investor/reports/${r.id}`,
        });
        delivered++;
      } catch { /* non-fatal */ }
    }
    try {
      emitBridgeEvent({
        eventType: "audit_log.appended",
        aggregateId: r.id,
        aggregateKind: "company",
        payload: { kind: "investor_update_sent", reportId: r.id, companyId: r.companyId, recipients, deliveredCount: delivered },
      });
    } catch { /* non-fatal */ }

    const env = emitSync({
      eventType: "report_sent",
      aggregateId: r.id,
      aggregateKind: "report",
      payload: { reportId: r.id, template: r.template, recipientsCount: r.recipientsCount, companyId: r.companyId },
      req,
    });
    // v23.4.8 — BUG 003/023: surface a per-recipient delivery summary so the
    // UI toast can show "Sent to N investors" and any failures explicitly.
    const recipientDeliveryStatus = recipients.map((userId) => ({ userId, status: "queued" as const }));
    res.json({
      ok: true,
      report: r,
      recipientCount: recipients.length,
      sentCount: delivered,
      failedCount: Math.max(0, recipients.length - delivered),
      recipients: recipientDeliveryStatus,
      delivered,
      telemetry: env,
    });
  });

  /**
   * Patch v10 (B-F9) — NEW: POST /api/founder/reports2/send
   *
   * One-shot create+send: persists a new investor update for the given
   * companyId and immediately fans it out to every investor on the cap
   * table. This is the client-expected endpoint that previously 404'd.
   *
   * Body: { companyId, subject, body, attachments? }
   */
  app.post("/api/founder/reports2/send", (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { companyId, subject, body, attachments } = req.body ?? {};
    if (!companyId || typeof companyId !== "string") return res.status(400).json({ ok: false, error: "companyId required" });
    if (!subject || typeof subject !== "string") return res.status(400).json({ ok: false, error: "subject required" });
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === companyId);
    if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });

    // Persist a minimal Report shape using the same `reports` array.
    const r: Report = {
      id: `rpt_${randomBytes(4).toString("hex")}`,
      companyId,
      template: "adhoc",
      title: String(subject),
      period: new Date().toISOString().slice(0, 7),
      status: "sent",
      sentAt: new Date().toISOString(),
      recipients: [],
      recipientsCount: 0,
      sections: [
        {
          id: `sec_body_${randomBytes(3).toString("hex")}`,
          kind: "highlights",
          title: "Update",
          body: typeof body === "string" ? body : "",
          comments: [],
        },
      ],
      readReceipts: [],
      schedule: null,
      metricsSnapshot: { raisedToDateUsd: 0, capTableHolders: 0, softCirclePipelineUsd: 0, activeRounds: 0 },
    };
    reports.push(r);
    // v13 (Avi's Issue 4) — write-through to DB so reports survive restart.
    const nowIso = new Date().toISOString();
    persistReportToDb(r, ctx.userId, nowIso);
    try {
      appendAdminAudit(
        ctx.userId ?? "u_unknown",
        `company:${companyId}`,
        "report.created",
        { reportId: r.id, template: "adhoc", title: String(subject) },
        tenantForCompany(companyId),
      );
    } catch (err) {
      log.warn("[reportsStore.send] audit append failed:", (err as Error).message);
    }

    const recipients = listMembersForCompany(companyId).map((m) => m.userId);
    r.recipients = recipients;
    r.recipientsCount = recipients.length;

    let delivered = 0;
    for (const userId of recipients) {
      try {
        emitNotification({
          userId,
          kind: "investor_report.published",
          title: `Investor update: ${r.title}`,
          body: typeof body === "string" ? body.slice(0, 240) : "New investor update from your portfolio company.",
          link: `/investor/reports/${r.id}`,
        });
        delivered++;
      } catch { /* non-fatal */ }
    }
    try {
      emitBridgeEvent({
        eventType: "audit_log.appended",
        aggregateId: r.id,
        aggregateKind: "company",
        payload: { kind: "investor_update_sent", reportId: r.id, companyId, recipients, deliveredCount: delivered, attachments: attachments ?? [] },
      });
    } catch { /* non-fatal */ }

    res.status(201).json({ ok: true, updateId: r.id, recipientCount: recipients.length, delivered });
  });

  app.post("/api/founder/reports2/:id/schedule", (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    const { cron, cadence, nextSendAt, enabled } = req.body ?? {};
    r.schedule = { cron: cron ?? "0 9 1 * *", cadence: cadence ?? "monthly", nextSendAt: nextSendAt ?? new Date(Date.now() + 30 * 86400_000).toISOString(), enabled: enabled !== false };
    if (r.status === "draft") r.status = "scheduled";
    res.json(r);
  });

  app.post("/api/founder/reports2/:id/read", async (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    const investorId = String(req.body?.investorId ?? "u_anonymous");
    const existing = r.readReceipts.find((rr) => rr.investorId === investorId);
    if (existing) {
      existing.reads += 1;
      existing.openedAt = new Date().toISOString();
    } else {
      r.readReceipts.push({ investorId, openedAt: new Date().toISOString(), reads: 1 });
    }
    /* v25.11 NM7 — read receipts must survive restart so founder email
     * engagement analytics stay accurate after deploys. */
    try {
      const ctx = await getUserContext(req);
      persistReportToDb(r, ctx?.userId, new Date().toISOString());
    } catch { /* non-fatal */ }
    res.json({ ok: true, readReceipts: r.readReceipts });
  });

  app.post("/api/founder/reports2/:id/comments", async (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    const { sectionId, text, actor, reaction } = req.body ?? {};
    const sec = r.sections.find((s) => s.id === sectionId);
    if (!sec) return res.status(404).json({ error: "section_not_found" });
    if (reaction) {
      // existing comment getting a reaction
      const cmt = sec.comments.find((c) => c.id === req.body?.commentId);
      if (cmt) {
        cmt.reactions[reaction] = (cmt.reactions[reaction] ?? 0) + 1;
        /* v25.11 NM7 — reaction-bump also persists. */
        try {
          const ctx = await getUserContext(req);
          persistReportToDb(r, ctx?.userId, new Date().toISOString());
        } catch { /* non-fatal */ }
        return res.json(cmt);
      }
    }
    const cmt = { id: `cmt_${randomBytes(3).toString("hex")}`, ts: new Date().toISOString(), actor: actor ?? "u_anonymous", text: text ?? "", reactions: {} };
    sec.comments.push(cmt);
    /* v25.11 NM7 — persist comment-add so investor/founder collaborative
     * review state survives restart. */
    try {
      const ctx = await getUserContext(req);
      persistReportToDb(r, ctx?.userId, new Date().toISOString());
    } catch { /* non-fatal */ }
    res.json(cmt);
  });
}

export const _testAccessReports = { reports };

/** Sprint 21 Wave C: expose reports array for cross-module queries. */
export function getReports(): Report[] {
  return reports;
}
