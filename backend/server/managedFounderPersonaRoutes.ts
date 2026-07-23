/**
 * W-MFCRM persona routes — `registerMfcrmPersonaRoutes(app)`.
 *
 * ADDITIVE persona endpoints for the three service/network personas (angel,
 * accounting, law), all mounted under distinct `/api/partner/me/mfcrm/{angel,
 * acct,law}*` paths so nothing collides with the base engine routes or any
 * existing route. Same FAIL-CLOSED isolation as managedFounderRoutes:
 * `partnerId` from the session only; every `companyId` verified attributed
 * (404 otherwise); capability gates live in the persona stores and surface as
 * `GateError.code` mapped to HTTP status here.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { partnerAttributionStore } from "./partnerWorkspaceStore";
import { GateError } from "./managedFounderStore";
import { mfcrmAngelStore } from "./mfcrmAngelStore";
import { mfcrmAcctStore } from "./mfcrmAcctStore";
import { mfcrmLawStore } from "./mfcrmLawStore";

function isAttributed(partnerId: string, companyId: string): boolean {
  return partnerAttributionStore.listByPartner(partnerId).some((a) => a.companyId === companyId);
}

// Bad-request validation codes thrown by the persona stores (→ 400). Capability
// gate codes (CHAPTER_SCOPING_REQUIRED, DOCUMENT_CUSTODY_REQUIRED, etc.) are
// deliberately NOT in this set — those are authority denials and fail-closed 403.
const VALIDATION_CODES = new Set([
  "COMPANY_ID_REQUIRED", "PARTNER_ID_REQUIRED", "CHAPTER_NAME_REQUIRED", "CHAPTER_ID_REQUIRED",
  "DESCRIPTION_REQUIRED", "DOC_REF_REQUIRED", "MATTER_TITLE_REQUIRED", "CONFLICT_CODE_REQUIRED",
]);

function sendError(res: Response, e: unknown): Response {
  const code = e instanceof GateError ? e.code : (e as Error)?.message ?? "ERROR";
  const message = (e as Error)?.message ?? String(e);
  if (code.endsWith("_NOT_FOUND")) return res.status(404).json({ error: code });
  if (VALIDATION_CODES.has(code)) return res.status(400).json({ error: code, message });
  if (code.startsWith("STRICT_PERSIST_FAILED")) return res.status(500).json({ error: "STRICT_PERSIST_FAILED", message });
  // Capability / authority / spine denials → 403 (fail-closed).
  return res.status(403).json({ error: code, message });
}

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

export function registerMfcrmPersonaRoutes(app: Express): void {
  /* ======================= ANGEL — chapters + carry ======================= */

  app.get("/api/partner/me/mfcrm/angel/chapters", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try { res.json({ chapters: mfcrmAngelStore.listChapters(pid) }); } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/angel/chapters", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    try {
      const c = mfcrmAngelStore.createChapter(pid, { name: String(body.name ?? ""), region: body.region ?? null, carryBps: body.carryBps }, actor);
      res.status(201).json({ chapter: c });
    } catch (e) { sendError(res, e); }
  });

  app.patch("/api/partner/me/mfcrm/angel/chapters/:chapterId/carry", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const body = req.body ?? {};
    try {
      const c = mfcrmAngelStore.setChapterCarry(pid, String(req.params.chapterId), Number(body.carryBps));
      res.json({ chapter: c });
    } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/angel/engagements/:engagementId/chapter", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const chapterId = String((req.body ?? {}).chapterId ?? "");
    if (!chapterId) return res.status(400).json({ error: "CHAPTER_ID_REQUIRED" });
    try {
      const eng = mfcrmAngelStore.assignEngagementToChapter(pid, String(req.params.engagementId), chapterId, actor);
      res.json({ engagement: eng });
    } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/angel/carry-report", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try { res.json({ report: mfcrmAngelStore.chapterCarryReport(pid) }); } catch (e) { sendError(res, e); }
  });

  /* ============ ACCOUNTING — rebill, custody, fund-admin, FoR ============ */

  app.post("/api/partner/me/mfcrm/acct/firm-of-record", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.status(201).json({ attribution: mfcrmAcctStore.stampFirmOfRecord(pid, { companyId, engagementId: body.engagementId ?? null }, actor) }); } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/acct/rebill", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try {
      const r = mfcrmAcctStore.recordRebill(pid, { companyId, engagementId: body.engagementId ?? null, description: String(body.description ?? ""), amountMinor: Number(body.amountMinor), currency: body.currency, incurredAt: body.incurredAt ?? null }, actor);
      res.status(201).json({ rebill: r });
    } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/acct/rebill", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.json({ rebills: mfcrmAcctStore.listRebills(pid, companyId) }); } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/acct/custody", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try {
      const c = mfcrmAcctStore.addCustody(pid, { companyId, engagementId: body.engagementId ?? null, docRef: String(body.docRef ?? ""), docType: body.docType ?? null }, actor);
      res.status(201).json({ custody: c });
    } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/acct/custody", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.json({ custody: mfcrmAcctStore.listCustody(pid, companyId) }); } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/acct/fund-admin-report", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try { res.json(mfcrmAcctStore.fundAdminReport(pid)); } catch (e) { sendError(res, e); }
  });

  /* ================ LAW — matters, conflicts, counsel-of-record ============ */

  app.post("/api/partner/me/mfcrm/law/matters", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try {
      const m = mfcrmLawStore.createMatter(pid, { companyId, engagementId: body.engagementId ?? null, title: String(body.title ?? ""), matterType: body.matterType ?? null }, actor);
      res.status(201).json({ matter: m });
    } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/law/matters", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.json({ matters: mfcrmLawStore.listMatters(pid, companyId) }); } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/law/counsel-of-record", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.status(201).json({ attribution: mfcrmLawStore.stampCounselOfRecord(pid, { companyId, engagementId: body.engagementId ?? null }, actor) }); } catch (e) { sendError(res, e); }
  });

  /* Conflict FLAG — never blocks; always records + returns blocked:false. */
  app.post("/api/partner/me/mfcrm/law/conflicts", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const actor = req.partnerContext!.userId;
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
    if (!isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try {
      const out = mfcrmLawStore.flagConflict(pid, { companyId, matterId: body.matterId ?? null, conflictCode: String(body.conflictCode ?? ""), counterparty: body.counterparty ?? null, detail: body.detail ?? null }, actor);
      res.status(201).json(out);
    } catch (e) { sendError(res, e); }
  });

  app.get("/api/partner/me/mfcrm/law/conflicts", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    try { res.json({ conflicts: mfcrmLawStore.listConflicts(pid, companyId) }); } catch (e) { sendError(res, e); }
  });

  app.post("/api/partner/me/mfcrm/law/conflicts/:conflictId/resolve", requirePartnerAuth, assertSubRole(...WRITE_ROLES), (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    try { res.json({ conflict: mfcrmLawStore.resolveConflict(pid, String(req.params.conflictId)) }); } catch (e) { sendError(res, e); }
  });
}
