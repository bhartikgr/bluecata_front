/**
 * Sprint 18 — Founder Apply-to-Collective (COMPANIES applying to PRESENT).
 *
 * Two paths:
 *  - Path A "Get Vouched"     — an existing cap-table investor nominates the company.
 *    Creates a CompanyNomination with status: pending_vouch.
 *  - Path B "Apply Directly"  — direct company application without an investor sponsor.
 *    Creates a CompanyApplication with status: submitted.
 *
 * Both paths submit the COMPANY for presentation rights — neither path is a membership
 * application. (Membership lives in collectiveAppStore.ts on the investor side.)
 *
 * Routes:
 *   POST /api/founder/collective/nominations    (Path A)
 *   GET  /api/founder/collective/nominations
 *   POST /api/founder/collective/applications   (Path B)
 *   GET  /api/founder/collective/applications
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { emitSync } from "./sprint10Telemetry";

export type NominationStatus = "pending_vouch" | "vouched" | "reviewing" | "invited" | "presented" | "declined";
export type ApplicationStatus = "submitted" | "reviewing" | "invited" | "rejected" | "waitlisted";

export type CompanyNomination = {
  id: string;
  companyId: string;
  founderId: string;
  vouchingInvestorId: string;
  pitchSummary: string;
  deckLink?: string;
  supplementaryNotes?: string;
  asks?: string;
  status: NominationStatus;
  submittedAt: string;
  vouchedAt?: string;
};

export type CompanyApplication = {
  id: string;
  companyId: string;
  founderId: string;
  pitchDeckFilename: string;
  tractionMrr: number;
  tractionUsers: number;
  tractionGrowthPct: number;
  asks: string;
  references: string;
  coverLetter: string;
  feeAcknowledged: boolean;
  status: ApplicationStatus;
  submittedAt: string;
  reviewedAt?: string;
};

const nominations: CompanyNomination[] = [];
const applications: CompanyApplication[] = [];

export function clearFounderCollectiveStore(): void {
  nominations.length = 0;
  applications.length = 0;
}

const nominationSchema = z.object({
  companyId: z.string().min(1),
  founderId: z.string().min(1),
  vouchingInvestorId: z.string().min(1),
  pitchSummary: z.string().min(20).max(2000),
  deckLink: z.string().url().optional(),
  supplementaryNotes: z.string().max(2000).optional(),
  asks: z.string().max(2000).optional(),
});

const applicationSchema = z.object({
  companyId: z.string().min(1),
  founderId: z.string().min(1),
  pitchDeckFilename: z.string().min(1),
  tractionMrr: z.number().nonnegative(),
  tractionUsers: z.number().nonnegative(),
  tractionGrowthPct: z.number(),
  asks: z.string().min(20).max(2000),
  references: z.string().max(2000).default(""),
  coverLetter: z.string().min(100).max(8000),
  feeAcknowledged: z.boolean().refine(v => v === true, { message: "Fee acknowledgement required" }),
});

export function registerFounderCollectiveApplyRoutes(app: Express): void {
  // Path A — investor-vouched nomination
  app.post("/api/founder/collective/nominations", (req: Request, res: Response) => {
    const parsed = nominationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const id = `nom_${randomBytes(8).toString("hex")}`;
    const stored: CompanyNomination = {
      ...parsed.data,
      id,
      status: "pending_vouch",
      submittedAt: new Date().toISOString(),
    };
    nominations.push(stored);
    const env = emitSync({
      eventType: "collective_company_nomination_submitted",
      aggregateId: id,
      aggregateKind: "nomination",
      payload: {
        nominationId: id,
        companyId: parsed.data.companyId,
        vouchingInvestorId: parsed.data.vouchingInvestorId,
      },
      req,
    });
    res.json({ ok: true, nomination: stored, telemetry: env });
  });

  app.get("/api/founder/collective/nominations", (req, res) => {
    const companyId = (req.query.companyId as string | undefined) ?? null;
    res.json(companyId ? nominations.filter(n => n.companyId === companyId) : nominations);
  });

  // Path B — direct company application (NOT membership)
  app.post("/api/founder/collective/applications", (req: Request, res: Response) => {
    const parsed = applicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const id = `capp_${randomBytes(8).toString("hex")}`;
    const stored: CompanyApplication = {
      ...parsed.data,
      id,
      status: "submitted",
      submittedAt: new Date().toISOString(),
    };
    applications.push(stored);
    const env = emitSync({
      eventType: "collective_company_application_submitted",
      aggregateId: id,
      aggregateKind: "application",
      payload: {
        applicationId: id,
        companyId: parsed.data.companyId,
        tractionMrr: parsed.data.tractionMrr,
        tractionUsers: parsed.data.tractionUsers,
      },
      req,
    });
    res.json({ ok: true, application: stored, telemetry: env });
  });

  app.get("/api/founder/collective/applications", (req, res) => {
    const companyId = (req.query.companyId as string | undefined) ?? null;
    res.json(companyId ? applications.filter(a => a.companyId === companyId) : applications);
  });
}
