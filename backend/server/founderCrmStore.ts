/**
 * Sprint 11 — Founder Investor CRM (mirror of investor CRM, founder-perspective).
 *
 * Pipeline: Lead → Engaged → Soft-Circle → Invested → Long-term partner
 *
 * Endpoints:
 *   GET  /api/founder/investor-crm                        — list contacts (per-company)
 *   POST /api/founder/investor-crm                        — create contact
 *   PATCH /api/founder/investor-crm/:id                   — update stage / notes / tasks
 *   POST /api/founder/investor-crm/broadcast              — segmented broadcast (filters: stage / region / etc.)
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { emitSync } from "./sprint10Telemetry";

export type FounderCrmContact = {
  id: string;
  companyId: string;
  investorId: string;
  name: string;
  firmName: string;
  email: string;
  region: string;
  // Sprint 14 D3 — 7-stage pipeline.
  stage: "lead" | "engaged" | "soft_circle" | "committed" | "signing" | "invested" | "longterm";
  ownership: { sharesUsd: number; pct: number };
  softCircleHistory: Array<{ ts: string; amountUsd: number; type: string }>;
  maSignals: number;
  threadIds: string[];
  notes: string;
  notesUpdatedAt: string;
  tasks: Array<{ id: string; text: string; due: string; status: "open" | "done" }>;
  series: string;
};

const contacts: FounderCrmContact[] = [
  {
    id: "fcrm_1", companyId: "co_novapay", investorId: "u_aisha_patel",
    name: "Aisha Patel", firmName: "Forge Ventures", email: "aisha@forge.vc", region: "US",
    stage: "invested", ownership: { sharesUsd: 500_000, pct: 0.041 },
    softCircleHistory: [{ ts: "2024-08-22T09:00:00Z", amountUsd: 500_000, type: "definite" }],
    maSignals: 0, threadIds: ["th_aisha"], notes: "Strong fintech network. Pro-rata in next round.",
    notesUpdatedAt: "2026-04-10T11:00:00Z",
    tasks: [{ id: "tsk_1", text: "Quarterly catch-up call", due: "2026-06-15", status: "open" }],
    series: "Pre-Seed SAFE",
  },
  
  {
    id: "fcrm_3", companyId: "co_novapay", investorId: "u_anchor",
    name: "Yuki Tanaka", firmName: "Anchor Growth", email: "yuki@anchor.io", region: "JP",
    stage: "soft_circle", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [{ ts: "2026-04-30T10:00:00Z", amountUsd: 4_000_000, type: "indication" }],
    maSignals: 2, threadIds: ["th_anchor_a"], notes: "Lead candidate Series A. Sent dataroom 2026-04-30.",
    notesUpdatedAt: "2026-05-02T08:00:00Z",
    tasks: [{ id: "tsk_a1", text: "Send Q2 KPI snapshot", due: "2026-05-15", status: "open" }],
    series: "Series A (lead candidate)",
  },
  {
    id: "fcrm_4", companyId: "co_novapay", investorId: "u_bluepoint",
    name: "Renu Kapoor", firmName: "Bluepoint Capital", email: "renu@bluepoint.in", region: "IN",
    stage: "engaged", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [],
    maSignals: 0, threadIds: ["th_bluepoint"], notes: "Q1 intro by Forge. Reviewing dataroom.",
    notesUpdatedAt: "2026-04-22T08:00:00Z",
    tasks: [],
    series: "Series A (engaged)",
  },
  {
    id: "fcrm_5", companyId: "co_novapay", investorId: "u_lead_1",
    name: "Sophie Müller", firmName: "Northstar VC", email: "sm@northstar.vc", region: "UK",
    stage: "lead", ownership: { sharesUsd: 0, pct: 0 },
    softCircleHistory: [], maSignals: 0, threadIds: [],
    notes: "Met at Sifted London. Has Series A budget for fintech.",
    notesUpdatedAt: "2026-03-10T08:00:00Z", tasks: [], series: "—",
  },
];

export function registerFounderCrmRoutes(app: Express): void {
  app.get("/api/founder/investor-crm", (req, res) => {
    const companyId = String(req.query.companyId ?? "co_novapay");
    res.json(contacts.filter((c) => c.companyId === companyId));
  });

  app.post("/api/founder/investor-crm", (req, res) => {
    const c: FounderCrmContact = {
      id: `fcrm_${randomBytes(3).toString("hex")}`,
      companyId: req.body?.companyId ?? "co_novapay",
      investorId: req.body?.investorId ?? `u_${randomBytes(3).toString("hex")}`,
      name: req.body?.name ?? "New contact",
      firmName: req.body?.firmName ?? "—",
      email: req.body?.email ?? "",
      region: req.body?.region ?? "US",
      stage: req.body?.stage ?? "lead",
      ownership: { sharesUsd: 0, pct: 0 },
      softCircleHistory: [], maSignals: 0, threadIds: [],
      notes: req.body?.notes ?? "",
      notesUpdatedAt: new Date().toISOString(),
      tasks: [], series: req.body?.series ?? "—",
    };
    contacts.push(c);
    res.json(c);
  });

  app.patch("/api/founder/investor-crm/:id", (req, res) => {
    const c = contacts.find((x) => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: "not_found" });
    if (typeof req.body?.stage === "string") c.stage = req.body.stage;
    if (typeof req.body?.notes === "string") { c.notes = req.body.notes; c.notesUpdatedAt = new Date().toISOString(); }
    if (req.body?.task) {
      c.tasks.push({ id: `tsk_${randomBytes(3).toString("hex")}`, text: req.body.task.text, due: req.body.task.due, status: "open" });
    }
    res.json(c);
  });

  app.post("/api/founder/investor-crm/broadcast", (req, res) => {
    const { filter, message, companyId } = req.body ?? {};
    const compId = companyId ?? "co_novapay";
    let targets = contacts.filter((c) => c.companyId === compId);
    if (filter?.stage)  targets = targets.filter((c) => c.stage === filter.stage);
    if (filter?.region) targets = targets.filter((c) => c.region === filter.region);
    if (filter?.series) targets = targets.filter((c) => c.series.toLowerCase().includes(String(filter.series).toLowerCase()));
    const env = emitSync({
      eventType: "founder_crm_broadcast",
      aggregateId: `fcb_${randomBytes(3).toString("hex")}`,
      aggregateKind: "broadcast",
      payload: { companyId: compId, recipientCount: targets.length, filter, messagePreview: String(message ?? "").slice(0, 80) },
      req,
    });
    res.json({ ok: true, recipientCount: targets.length, recipients: targets.map((t) => t.investorId), telemetry: env });
  });
}

export const _testAccessFounderCrm = { contacts };
