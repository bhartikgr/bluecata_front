/**
 * Sprint 29 KL-01 + Wave C-1 — Company Profile Store
 *
 * KL-04 FIX: DB write-through added to updateCompanyProfile() so all
 * mutations persist to SQLite (dev.db) and survive server restarts.
 * hydrateFromDatabase() loads profiles on startup.
 *
 * Routes:
 *   GET  /api/admin/companies/:id/profile         — returns profile
 *   PATCH /api/admin/companies/:id/profile        — admin (x-confirm required)
 *   GET  /api/founder/profile?companyId=...       — founder GET
 *   PATCH /api/founder/profile?companyId=...      — founder PATCH (x-confirm required)
 *   GET  /api/founder/profile/completion?companyId=...  — completion %
 *   POST /api/founder/financials/request-accountant     — request accountant fill
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { enqueueOneOff } from "./emailStore";
// ── KL-04: DB imports ──────────────────────────────────────
import { rawDb } from "./db/connection";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/* ============================================================
 * Profile shape — all fields optional
 * ============================================================ */
export interface CompanyProfile {
  companyId: string;

  // ── Legacy / original fields ─────────────────────────────
  founderName?: string;
  founderEmail?: string;
  founderPhone?: string;
  hqAddress?: string;
  jurisdiction?: string;
  incorporationDate?: string;
  sector?: string;
  stage?: string;
  employees?: number;
  runwayMonths?: number;
  lastRaiseDate?: string;
  lastRaiseAmount?: number;
  valuationMinor?: number;
  equityIssuedPct?: number;
  dilutionPct?: number;
  advisorBoardSize?: number;
  esopPoolPct?: number;
  dataroomReadiness?: string;
  kycStatus?: string;
  kybStatus?: string;
  complianceScore?: number;
  healthScore?: number;
  regulatoryRegion?: string;
  board_size?: number;
  ma_active_flag?: boolean;
  ma_advisor_name?: string;
  ma_target_close_date?: string;
  ma_stage?: string;
  ma_buyer_pool_size?: number;
  ma_notes?: string;

  // ── Wave C-1: Public / Social (8 fields) ─────────────────
  linkedinUrl?: string;
  twitterUrl?: string;
  crunchbaseUrl?: string;
  pitchbookUrl?: string;
  openingDataRoomUrl?: string;
  publicNewsroomUrl?: string;
  founderLinkedinUrls?: string[];
  investorLinkedinUrls?: string[];

  // ── Wave C-1: Region / Jurisdiction extras (3 fields) ────
  incorporationJurisdiction?: string;
  secondaryJurisdiction?: string;
  taxResidencyJurisdiction?: string;

  // ── Wave C-1: Display preferences (6 fields) ─────────────
  preferredCurrency?: string;
  preferredTimezone?: string;
  preferredLanguage?: "en" | "zh" | "es" | "fr" | "de" | "ja";
  preferredCommunicationChannel?: "email" | "in_app" | "both";
  preferredMeetingDuration?: 15 | 30 | 45 | 60;
  preferredMeetingTimes?: string;

  // ── Wave C-1: Business basics gaps (6 fields) ────────────
  subsector?: string;
  tagline?: string;
  shortPitch?: string;
  longPitch?: string;
  missionStatement?: string;
  logoUrl?: string;

  // ── Wave C-1: Financials (15 fields, integer minor units where $) ──
  cashOnHandUsd?: number;
  monthlyBurnUsd?: number;
  lastRaiseSizeUsd?: number;
  lastRaiseAt?: string;
  arrUsd?: number;
  mrrUsd?: number;
  grossMarginPct?: number;
  customerCount?: number;
  growthRatePct?: number;
  netMarginPct?: number;
  ebitdaUsd?: number;
  freeCashFlowUsd?: number;
  ltvCacRatio?: number;
  paybackPeriodMonths?: number;

  // ── Wave C-1: M&A transaction-prep (7 fields) ─────────────
  ipDdReadinessPct?: number;
  customerContractsReadinessPct?: number;
  financialAuditReadinessPct?: number;
  dataRoomOrganizedPct?: number;
  regulatoryFilingsCompletePct?: number;
  esgDisclosureCompletePct?: number;
  transactionPrepStatus?: "not_pursuing" | "exploring" | "active" | "closing";

  // ── Wave C-1: Governance (1 field) ───────────────────────
  boardCompositionDirectors?: number;
  boardDirectorsSnapshot?: string;

  // ── Arbitrary extension ───────────────────────────────────
  customFields?: Record<string, string>;

  // ── Hash chain ────────────────────────────────────────────
  version: number;
  prevHash: string;
  hash: string;
  updatedAt: string;
  updatedBy: string;
}

/* ============================================================
 * URL validation helper
 * ============================================================ */
const URL_FIELDS: Array<keyof CompanyProfile> = [
  "linkedinUrl", "twitterUrl", "crunchbaseUrl", "pitchbookUrl",
  "openingDataRoomUrl", "publicNewsroomUrl", "logoUrl",
];

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidIso2(s: string): boolean {
  return /^[A-Z]{2}/.test(s);
}

export function validateProfilePatch(patch: Partial<CompanyProfile>): string | null {
  for (const field of URL_FIELDS) {
    const v = patch[field];
    if (v !== undefined && v !== null && v !== "" && typeof v === "string" && !isValidUrl(v)) {
      return `${field} must be a valid URL`;
    }
  }
  for (const field of ["founderLinkedinUrls", "investorLinkedinUrls"] as const) {
    const arr = patch[field];
    if (Array.isArray(arr)) {
      for (const u of arr) {
        if (typeof u === "string" && u !== "" && !isValidUrl(u)) {
          return `${field}: "${u}" is not a valid URL`;
        }
      }
    }
  }
  if (patch.incorporationJurisdiction && !isValidIso2(patch.incorporationJurisdiction)) {
    return "incorporationJurisdiction must start with a 2-letter ISO country code";
  }
  if (patch.secondaryJurisdiction && !isValidIso2(patch.secondaryJurisdiction)) {
    return "secondaryJurisdiction must start with a 2-letter ISO country code";
  }
  if (patch.taxResidencyJurisdiction && !isValidIso2(patch.taxResidencyJurisdiction)) {
    return "taxResidencyJurisdiction must start with a 2-letter ISO country code";
  }
  if (patch.shortPitch && patch.shortPitch.length > 140) {
    return "shortPitch must be ≤140 characters";
  }
  if (patch.longPitch && patch.longPitch.length > 2000) {
    return "longPitch must be ≤2000 characters";
  }
  if (patch.missionStatement && patch.missionStatement.length > 400) {
    return "missionStatement must be ≤400 characters";
  }
  const intFields: Array<keyof CompanyProfile> = [
    "cashOnHandUsd", "monthlyBurnUsd", "lastRaiseSizeUsd",
    "arrUsd", "mrrUsd", "ebitdaUsd", "freeCashFlowUsd",
  ];
  for (const f of intFields) {
    const v = patch[f];
    if (v !== undefined && v !== null && (!Number.isInteger(v) || (v as number) < 0)) {
      return `${f} must be a non-negative integer (minor units)`;
    }
  }
  const pctFields: Array<keyof CompanyProfile> = [
    "ipDdReadinessPct", "customerContractsReadinessPct", "financialAuditReadinessPct",
    "dataRoomOrganizedPct", "regulatoryFilingsCompletePct", "esgDisclosureCompletePct",
  ];
  for (const f of pctFields) {
    const v = patch[f];
    if (v !== undefined && v !== null) {
      const n = v as number;
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        return `${f} must be an integer between 0 and 100`;
      }
    }
  }
  return null;
}

/* ============================================================
 * In-memory store
 * ============================================================ */
const profileMap = new Map<string, CompanyProfile>();

function makeEmptyProfile(companyId: string): CompanyProfile {
  const now = new Date().toISOString();
  const hash = sha256(`${companyId}|0|${now}|init`);
  return {
    companyId,
    version: 0,
    prevHash: "0".repeat(64),
    hash,
    updatedAt: now,
    updatedBy: "system:seed",
    customFields: {},
  };
}

export function getAllProfiles(): CompanyProfile[] {
  return Array.from(profileMap.values());
}

export function getCompanyProfile(companyId: string): CompanyProfile {
  if (!profileMap.has(companyId)) {
    profileMap.set(companyId, makeEmptyProfile(companyId));
  }
  return profileMap.get(companyId)!;
}

/* ============================================================
 * KL-04: DB helper — upsert profile into sync_company
 * ============================================================ */
function dbUpsertProfile(profile: CompanyProfile): void {
  try {
    rawDb().prepare(
      `INSERT OR REPLACE INTO sync_company
        (id, tenant_id, version, updated_at, created_at, deleted_at, payload, name, sector, stage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      profile.companyId,
      null,
      profile.version,
      profile.updatedAt,
      profile.updatedAt,
      null,
      JSON.stringify(profile),
      profile.founderName ?? null,
      profile.sector ?? null,
      profile.stage ?? null,
    );
  } catch (e) {
    console.error("[db] dbUpsertProfile failed for", profile.companyId, e);
  }
}

export function updateCompanyProfile(
  companyId: string,
  patch: Partial<Omit<CompanyProfile, "companyId" | "version" | "prevHash" | "hash" | "updatedAt" | "updatedBy">>,
  actor: string,
): CompanyProfile {
  const existing = getCompanyProfile(companyId);
  const now = new Date().toISOString();
  const nextVersion = existing.version + 1;
  const body = `${existing.hash}|${companyId}|${nextVersion}|${now}|${JSON.stringify(patch)}`;
  const hash = sha256(body);

  const updated: CompanyProfile = {
    ...existing,
    ...patch,
    founderLinkedinUrls: patch.founderLinkedinUrls ?? existing.founderLinkedinUrls,
    investorLinkedinUrls: patch.investorLinkedinUrls ?? existing.investorLinkedinUrls,
    customFields: {
      ...(existing.customFields ?? {}),
      ...(patch.customFields ?? {}),
    },
    companyId,
    version: nextVersion,
    prevHash: existing.hash,
    hash,
    updatedAt: now,
    updatedBy: actor,
  };
  profileMap.set(companyId, updated);

  // ── KL-04: persist to DB ──
  dbUpsertProfile(updated);

  return updated;
}

/* ============================================================
 * Profile completion computation
 * ============================================================ */
export const COMPLETION_WEIGHTS: Array<{ field: keyof CompanyProfile; weight: number; section: string }> = [
  { field: "linkedinUrl",          weight: 2, section: "Public" },
  { field: "twitterUrl",           weight: 2, section: "Public" },
  { field: "crunchbaseUrl",        weight: 2, section: "Public" },
  { field: "tagline",              weight: 2, section: "Public" },
  { field: "shortPitch",           weight: 2, section: "Public" },
  { field: "longPitch",            weight: 2, section: "Public" },
  { field: "logoUrl",              weight: 2, section: "Public" },
  { field: "founderLinkedinUrls",  weight: 2, section: "Public" },
  { field: "incorporationJurisdiction", weight: 3, section: "Region" },
  { field: "secondaryJurisdiction",     weight: 3, section: "Region" },
  { field: "taxResidencyJurisdiction",  weight: 3, section: "Region" },
  { field: "preferredCurrency",          weight: 1, section: "Preferences" },
  { field: "preferredTimezone",          weight: 1, section: "Preferences" },
  { field: "preferredLanguage",          weight: 1, section: "Preferences" },
  { field: "preferredCommunicationChannel", weight: 1, section: "Preferences" },
  { field: "preferredMeetingDuration",   weight: 1, section: "Preferences" },
  { field: "preferredMeetingTimes",      weight: 1, section: "Preferences" },
  { field: "cashOnHandUsd",      weight: 3, section: "Financials" },
  { field: "monthlyBurnUsd",     weight: 3, section: "Financials" },
  { field: "runwayMonths",       weight: 3, section: "Financials" },
  { field: "lastRaiseSizeUsd",   weight: 3, section: "Financials" },
  { field: "arrUsd",             weight: 3, section: "Financials" },
  { field: "ipDdReadinessPct",               weight: 2, section: "M&A Prep" },
  { field: "customerContractsReadinessPct",  weight: 2, section: "M&A Prep" },
  { field: "financialAuditReadinessPct",     weight: 2, section: "M&A Prep" },
  { field: "dataRoomOrganizedPct",           weight: 2, section: "M&A Prep" },
  { field: "regulatoryFilingsCompletePct",   weight: 2, section: "M&A Prep" },
  { field: "esgDisclosureCompletePct",       weight: 2, section: "M&A Prep" },
  { field: "transactionPrepStatus",          weight: 2, section: "M&A Prep" },
];

function isPresent(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export interface CompletionResult {
  completionPct: number;
  weightedScore: number;
  totalWeight: number;
  sections: Array<{ name: string; complete: number; total: number; pct: number }>;
}

export function computeProfileCompletion(profile: CompanyProfile): CompletionResult {
  const sectionMap = new Map<string, { complete: number; total: number }>();
  let earned = 0;
  let total = 0;

  for (const { field, weight, section } of COMPLETION_WEIGHTS) {
    const s = sectionMap.get(section) ?? { complete: 0, total: 0 };
    s.total += weight;
    total += weight;
    if (isPresent(profile[field])) {
      s.complete += weight;
      earned += weight;
    }
    sectionMap.set(section, s);
  }

  const sections = Array.from(sectionMap.entries()).map(([name, { complete, total: t }]) => ({
    name,
    complete,
    total: t,
    pct: t > 0 ? Math.round((complete / t) * 100) : 0,
  }));

  const completionPct = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { completionPct, weightedScore: earned, totalWeight: total, sections };
}

/* ============================================================
 * Magic-link token store for accountant financial fill
 * ============================================================ */
export interface FinancialRequestToken {
  token: string;
  companyId: string;
  fieldKey: string;
  requestedBy: string;
  accountantEmail: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
  consumedAt?: string;
  requestId: string;
}

const financialRequestTokens = new Map<string, FinancialRequestToken>();

export function createFinancialRequestToken(args: {
  companyId: string;
  fieldKey: string;
  requestedBy: string;
  accountantEmail: string;
  note: string;
}): FinancialRequestToken {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const requestId = `freq_${randomBytes(6).toString("hex")}`;
  const entry: FinancialRequestToken = {
    token,
    companyId: args.companyId,
    fieldKey: args.fieldKey,
    requestedBy: args.requestedBy,
    accountantEmail: args.accountantEmail,
    note: args.note,
    createdAt: now.toISOString(),
    expiresAt,
    consumed: false,
    requestId,
  };
  financialRequestTokens.set(token, entry);
  return entry;
}

export function getFinancialRequestToken(token: string): FinancialRequestToken | undefined {
  return financialRequestTokens.get(token);
}

export function consumeFinancialRequestToken(token: string): FinancialRequestToken | null {
  const entry = financialRequestTokens.get(token);
  if (!entry) return null;
  entry.consumed = true;
  entry.consumedAt = new Date().toISOString();
  financialRequestTokens.set(token, entry);
  return entry;
}

export function getOpenTokenForField(companyId: string, fieldKey: string): FinancialRequestToken | undefined {
  const tokens = Array.from(financialRequestTokens.values())
    .filter(t => t.companyId === companyId && t.fieldKey === fieldKey && !t.consumed)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tokens[0];
}

/* ============================================================
 * KL-04: Hydrate profiles from DB on server startup
 * ============================================================ */
export async function hydrateFromDatabase(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[hydrate] companyProfileStore — no DATABASE_URL, staying in-memory");
    return;
  }
  try {
    const rows = rawDb().prepare(
      `SELECT payload FROM sync_company`
    ).all() as Array<{ payload: string }>;

    let loaded = 0;
    for (const row of rows) {
      try {
        const profile: CompanyProfile = JSON.parse(row.payload);
        if (profile.companyId) {
          profileMap.set(profile.companyId, profile);
          loaded++;
        }
      } catch {
        // Malformed row — skip
      }
    }
    console.log(`[hydrate] companyProfileStore loaded ${loaded} profiles from DB`);
  } catch (e) {
    console.error("[hydrate] companyProfileStore DB load failed:", e);
  }
}

/* ============================================================
 * Profile completion bridge emitter (cross-10% boundary)
 * ============================================================ */
const prevCompletionPct = new Map<string, number>();

function maybeEmitCompletionChanged(companyId: string, newPct: number, actor: string): void {
  const prev = prevCompletionPct.get(companyId) ?? 0;
  const prevBracket = Math.floor(prev / 10);
  const newBracket = Math.floor(newPct / 10);
  if (newBracket !== prevBracket) {
    emitBridgeEvent({
      eventType: "profile.completion_changed",
      aggregateId: companyId,
      aggregateKind: "company",
      actor: { userId: actor },
      payload: { prevPct: prev, newPct, bracket: newBracket * 10 },
    });
  }
  prevCompletionPct.set(companyId, newPct);
}

/* ============================================================
 * Routes
 * ============================================================ */
export function registerCompanyProfileRoutes(app: Express): void {

  app.get("/api/admin/companies/:id/profile", (req: Request, res: Response) => {
    const { id } = req.params;
    const profile = getCompanyProfile(id);
    res.json({ ok: true, profile });
  });

  app.patch("/api/admin/companies/:id/profile", (req: Request, res: Response) => {
    const { id } = req.params;
    const confirm = req.headers["x-confirm"] === "true";
    const actor = String(req.headers["x-actor-email"] ?? "admin@capavate.com");

    const { companyId: _cid, version: _v, prevHash: _ph, hash: _h, updatedAt: _ua, updatedBy: _ub, ...patch } = req.body ?? {};

    const validationError = validateProfilePatch(patch);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    if (!confirm) {
      const current = getCompanyProfile(id);
      return res.status(409).json({
        ok: false,
        dryRun: true,
        message: "Add header x-confirm: true to apply",
        current,
        proposedChange: patch,
      });
    }

    const updated = updateCompanyProfile(id, patch, actor);
    const completion = computeProfileCompletion(updated);

    appendAdminAudit(actor, `company:${id}`, "company_profile.updated", { patch, version: updated.version });
    emitBridgeEvent({
      eventType: "company_profile.updated" as any,
      aggregateId: id,
      aggregateKind: "company",
      actor: { userId: actor },
      payload: { patch, version: updated.version, activityTimestamps: { updatedAt: updated.updatedAt } },
    });
    maybeEmitCompletionChanged(id, completion.completionPct, actor);

    res.json({ ok: true, profile: updated });
  });

  app.get("/api/founder/profile", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    const profile = getCompanyProfile(companyId);
    res.json({ ok: true, profile });
  });

  app.patch("/api/founder/profile", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? req.body?.companyId ?? "");
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });

    const confirm = req.headers["x-confirm"] === "true";
    const actor = String(req.headers["x-actor-email"] ?? "founder@capavate.com");

    const { companyId: _cid, version: _v, prevHash: _ph, hash: _h, updatedAt: _ua, updatedBy: _ub, ...patch } = req.body ?? {};

    const validationError = validateProfilePatch(patch);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    if (!confirm) {
      const current = getCompanyProfile(companyId);
      return res.status(409).json({
        ok: false,
        dryRun: true,
        message: "Add header x-confirm: true to apply",
        current,
        proposedChange: patch,
      });
    }

    const updated = updateCompanyProfile(companyId, patch, actor);
    const completion = computeProfileCompletion(updated);

    appendAdminAudit(actor, `company:${companyId}`, "company_profile.updated", { patch, version: updated.version, source: "founder" });
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: companyId,
      aggregateKind: "company",
      actor: { userId: actor },
      payload: { patch, version: updated.version, activityTimestamps: { updatedAt: updated.updatedAt } },
    });
    maybeEmitCompletionChanged(companyId, completion.completionPct, actor);

    const maPrepFields = [
      "ipDdReadinessPct", "customerContractsReadinessPct", "financialAuditReadinessPct",
      "dataRoomOrganizedPct", "regulatoryFilingsCompletePct", "esgDisclosureCompletePct",
      "transactionPrepStatus",
    ];
    const hasMaPrepUpdate = maPrepFields.some(f => patch[f as keyof typeof patch] !== undefined);
    if (hasMaPrepUpdate) {
      emitBridgeEvent({
        eventType: "transaction_prep.updated",
        aggregateId: companyId,
        aggregateKind: "company",
        actor: { userId: actor },
        payload: Object.fromEntries(maPrepFields.map(f => [f, updated[f as keyof CompanyProfile]])),
      });
    }

    res.json({ ok: true, profile: updated, completion });
  });

  app.get("/api/founder/profile/completion", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ ok: false, error: "companyId required" });
    const profile = getCompanyProfile(companyId);
    const result = computeProfileCompletion(profile);
    res.json({ ok: true, ...result });
  });

  app.post("/api/founder/financials/request-accountant", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"] === "true";
    const actor = String(req.headers["x-actor-email"] ?? "founder@capavate.com");

    const { companyId, fieldKey, accountantEmail, note = "" } = req.body ?? {};

    if (!companyId || !fieldKey || !accountantEmail) {
      return res.status(400).json({ ok: false, error: "companyId, fieldKey, accountantEmail required" });
    }
    if (typeof note === "string" && note.length > 280) {
      return res.status(400).json({ ok: false, error: "note must be ≤280 characters" });
    }
    if (!confirm) {
      return res.status(409).json({ ok: false, dryRun: true, message: "Add header x-confirm: true to apply" });
    }

    const entry = createFinancialRequestToken({ companyId, fieldKey, requestedBy: actor, accountantEmail, note });
    const magicLink = `https://capavate.com/#/financials-fill/${entry.token}?company=${companyId}&field=${fieldKey}`;

    enqueueOneOff({
      recipientUserId: `acct_${randomBytes(4).toString("hex")}`,
      to: accountantEmail,
      subject: `[Capavate] Please fill in: ${fieldKey}`,
      bodyHtml: `
        <p>Hello,</p>
        <p>A founder has requested you fill in the <strong>${fieldKey}</strong> field for their company on Capavate.</p>
        ${note ? `<p>Note from founder: ${note}</p>` : ""}
        <p><a href="${magicLink}">Click here to fill in the field →</a></p>
        <p>This link expires in 7 days.</p>
      `,
      bodyText: `Fill in ${fieldKey}: ${magicLink}\n${note ? `Note: ${note}` : ""}`,
    });

    appendAdminAudit(actor, `company:${companyId}`, "financial.accountant_request_sent", {
      fieldKey, accountantEmail, requestId: entry.requestId, expiresAt: entry.expiresAt,
    });
    emitBridgeEvent({
      eventType: "financial.accountant_request_sent",
      aggregateId: companyId,
      aggregateKind: "company",
      actor: { userId: actor },
      payload: { fieldKey, accountantEmail, requestId: entry.requestId, expiresAt: entry.expiresAt },
    });

    res.json({ ok: true, requestId: entry.requestId, expiresAt: entry.expiresAt });
  });

  app.get("/api/financials-fill/:token", (req: Request, res: Response) => {
    const { token } = req.params;
    const entry = getFinancialRequestToken(token);
    if (!entry) return res.status(404).json({ ok: false, error: "token_not_found" });
    if (entry.consumed) return res.status(410).json({ ok: false, error: "token_consumed" });
    if (new Date() > new Date(entry.expiresAt)) return res.status(410).json({ ok: false, error: "token_expired" });

    const profile = getCompanyProfile(entry.companyId);
    res.json({
      ok: true,
      companyId: entry.companyId,
      companyName: profile.founderName ?? entry.companyId,
      fieldKey: entry.fieldKey,
      requestId: entry.requestId,
      expiresAt: entry.expiresAt,
      note: entry.note,
    });
  });

  app.post("/api/financials-fill/:token", (req: Request, res: Response) => {
    const { token } = req.params;
    const entry = getFinancialRequestToken(token);
    if (!entry) return res.status(404).json({ ok: false, error: "token_not_found" });
    if (entry.consumed) return res.status(410).json({ ok: false, error: "token_consumed" });
    if (new Date() > new Date(entry.expiresAt)) return res.status(410).json({ ok: false, error: "token_expired" });

    const { value } = req.body ?? {};
    if (value === undefined || value === null) {
      return res.status(400).json({ ok: false, error: "value required" });
    }

    const patch: Partial<CompanyProfile> = { [entry.fieldKey]: value };
    const validationError = validateProfilePatch(patch);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    consumeFinancialRequestToken(token);
    const updated = updateCompanyProfile(entry.companyId, patch, `accountant:${entry.accountantEmail}`);

    appendAdminAudit(`accountant:${entry.accountantEmail}`, `company:${entry.companyId}`, "financial.accountant_filled", {
      fieldKey: entry.fieldKey, requestId: entry.requestId,
    });
    emitBridgeEvent({
      eventType: "financial.accountant_filled",
      aggregateId: entry.companyId,
      aggregateKind: "company",
      actor: { userId: `accountant:${entry.accountantEmail}` },
      payload: { fieldKey: entry.fieldKey, requestId: entry.requestId },
    });

    const profile = getCompanyProfile(entry.companyId);
    if (profile.founderEmail) {
      enqueueOneOff({
        recipientUserId: entry.requestedBy,
        to: profile.founderEmail,
        subject: `[Capavate] ${entry.fieldKey} filled by your accountant`,
        bodyHtml: `<p>Your accountant (${entry.accountantEmail}) has filled in the <strong>${entry.fieldKey}</strong> field on your company profile.</p>`,
        bodyText: `Your accountant filled in ${entry.fieldKey}.`,
      });
    }

    res.json({ ok: true, fieldKey: entry.fieldKey, version: updated.version });
  });

  app.get("/api/admin/companies/:id/activity", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { getCompanyActivityTimestamps, getCompanyTelemetryCounters } = await import("./activityDeriver");
    const timestamps = getCompanyActivityTimestamps(id);
    const counters = getCompanyTelemetryCounters(id);
    res.json({ ok: true, companyId: id, ...timestamps, ...counters });
  });

  app.get("/api/founder/companies/:id/activity", async (req: Request, res: Response) => {
    const { id } = req.params;
    const { getCompanyActivityTimestamps, getCompanyTelemetryCounters } = await import("./activityDeriver");
    const timestamps = getCompanyActivityTimestamps(id);
    const counters = getCompanyTelemetryCounters(id);
    res.json({ ok: true, companyId: id, ...timestamps, ...counters });
  });
}

/* ============================================================
 * Test helpers
 * ============================================================ */
export const _testCompanyProfile = {
  profileMap,
  financialRequestTokens,
  prevCompletionPct,
  reset(): void {
    profileMap.clear();
    financialRequestTokens.clear();
    prevCompletionPct.clear();
  },
};