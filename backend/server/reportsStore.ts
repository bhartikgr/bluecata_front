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
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { emitSync } from "./sprint10Telemetry";

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

const reports: Report[] = [
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
];

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
    const companyId = String(req.query.companyId ?? "co_novapay");
    res.json(reports.filter((r) => r.companyId === companyId));
  });

  app.post("/api/founder/reports2", (req, res) => {
    const { companyId, template, title, period } = req.body ?? {};
    if (!template || !title) return res.status(400).json({ error: "template + title required" });
    const r: Report = {
      id: `rpt_${randomBytes(4).toString("hex")}`,
      companyId: companyId ?? "co_novapay",
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
      metricsSnapshot: { raisedToDateUsd: 11_050_000, capTableHolders: 14, softCirclePipelineUsd: 2_650_000, activeRounds: 2 },
    };
    reports.push(r);
    res.json(r);
  });

  app.get("/api/founder/reports2/:id", (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json(r);
  });

  app.post("/api/founder/reports2/:id/send", (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    const recipients: string[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    r.recipients = recipients;
    r.recipientsCount = recipients.length;
    r.status = "sent";
    r.sentAt = new Date().toISOString();
    const env = emitSync({
      eventType: "report_sent",
      aggregateId: r.id,
      aggregateKind: "report",
      payload: { reportId: r.id, template: r.template, recipientsCount: r.recipientsCount, companyId: r.companyId },
      req,
    });
    res.json({ ok: true, report: r, telemetry: env });
  });

  app.post("/api/founder/reports2/:id/schedule", (req, res) => {
    const r = reports.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: "not_found" });
    const { cron, cadence, nextSendAt, enabled } = req.body ?? {};
    r.schedule = { cron: cron ?? "0 9 1 * *", cadence: cadence ?? "monthly", nextSendAt: nextSendAt ?? new Date(Date.now() + 30 * 86400_000).toISOString(), enabled: enabled !== false };
    if (r.status === "draft") r.status = "scheduled";
    res.json(r);
  });

  app.post("/api/founder/reports2/:id/read", (req, res) => {
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
    res.json({ ok: true, readReceipts: r.readReceipts });
  });

  app.post("/api/founder/reports2/:id/comments", (req, res) => {
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
        return res.json(cmt);
      }
    }
    const cmt = { id: `cmt_${randomBytes(3).toString("hex")}`, ts: new Date().toISOString(), actor: actor ?? "u_anonymous", text: text ?? "", reactions: {} };
    sec.comments.push(cmt);
    res.json(cmt);
  });
}

export const _testAccessReports = { reports };

/** Sprint 21 Wave C: expose reports array for cross-module queries. */
export function getReports(): Report[] {
  return reports;
}
