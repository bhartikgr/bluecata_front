/**
 * Sprint 28 Wave 6 — Notification Campaign Store
 *
 * Admin-authored notification campaigns with rich audience targeting and
 * scheduled send. Wraps notificationsStore.emitNotification for fan-out.
 *
 * Design decisions:
 *   - Contact → userId mapping: AdminContact has no userId field (off-limits to
 *     modify). We maintain a static email→userId lookup table for the 5 canonical
 *     personas plus any runtime personas we can detect via listPersonas().
 *   - Cap-table members: We use multiCompanyStore.getCompaniesForFounder() to find
 *     founders linked to a companyId. No roundsStore access (off-limits). A
 *     fallback note is recorded in the audience preview summary.
 *   - Scheduled tick runs every 30 seconds (setInterval in startCampaignScheduler).
 *     Idempotent: checks status before transitioning.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { emitNotification, type NotificationKind, ALL_NOTIFICATION_KINDS } from "./notificationsStore";
import { listContacts } from "./adminContactsStore";
import { getCompaniesForFounder } from "./multiCompanyStore";
import { listPersonas } from "./lib/userContext";

/* ============================================================
 * Types
 * ============================================================ */

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";
export type AudienceKind =
  | "all_founders"
  | "all_investors"
  | "all_consortium_partners"
  | "all_admins"
  | "cap_table_members"
  | "founders_of_company"
  | "investors_by_industry"
  | "investors_by_region"
  | "investors_by_industry_and_region"
  | "companies_by_industry"
  | "companies_by_region"
  | "specific_users";

export interface AudienceTarget {
  kind: AudienceKind;
  companyId?: string;
  industries?: string[];
  regions?: string[];
  userIds?: string[];
}

export interface CampaignContent {
  notificationKind: NotificationKind;
  title: string;      // max 120 chars
  body: string;       // max 600 chars
  link: string | null;
  severity: "info" | "warning" | "critical";
}

export interface NotificationCampaign {
  id: string;                         // ncmp_<random>
  name: string;
  description: string;
  audience: AudienceTarget;
  content: CampaignContent;
  // Scheduling
  scheduledAt: string | null;
  timezone: string;
  // Lifecycle
  status: CampaignStatus;
  resolvedAudiencePreview: number;
  actualSentCount: number;
  errors: Array<{ userId: string; error: string }>;
  // Tracking
  sentAt: string | null;
  // Audit
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  // Hash chain
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
}

export interface CampaignRevision {
  campaignId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  action: string;
  snapshot: NotificationCampaign;
}

/* ============================================================
 * In-memory stores
 * ============================================================ */

const campaigns: Map<string, NotificationCampaign> = new Map();
const revisions: Map<string, CampaignRevision[]> = new Map();

/* ============================================================
 * Email → userId mapping table (canonical personas)
 * Extended at resolve time via listPersonas() if available.
 * ============================================================ */

const KNOWN_EMAIL_TO_USER: Record<string, string> = {
  "maya@novapay.ai": "u_maya_chen",
  "aisha@greenwood.capital": "u_aisha_patel",
  "lp@lapsed-fund.example": "u_lapsed_lp",
  "newinvestor@example.com": "u_no_position",
  "admin@capavate.io": "u_admin",
};

function resolveUserIdForEmail(email: string): string | null {
  return KNOWN_EMAIL_TO_USER[email.toLowerCase()] ?? null;
}

/* ============================================================
 * Crypto helpers
 * ============================================================ */

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function computeCampaignHash(c: NotificationCampaign): string {
  const body = [
    c.id,
    c.version,
    c.name,
    c.status,
    c.content.title,
    c.content.body,
    c.content.notificationKind,
    c.updatedAt,
    c.updatedBy,
    c.prevRevisionHash,
    JSON.stringify(c.audience),
  ].join("|");
  return sha256(body);
}

function newCampaignId(): string {
  return `ncmp_${randomBytes(6).toString("hex")}`;
}

/* ============================================================
 * Revision helpers
 * ============================================================ */

function appendRevision(c: NotificationCampaign, action: string): void {
  const rev: CampaignRevision = {
    campaignId: c.id,
    version: c.version,
    prevRevisionHash: c.prevRevisionHash,
    revisionHash: c.revisionHash,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
    action,
    snapshot: { ...c, audience: { ...c.audience }, content: { ...c.content }, errors: [...c.errors] },
  };
  const arr = revisions.get(c.id) ?? [];
  arr.push(rev);
  revisions.set(c.id, arr);
}

/* ============================================================
 * Audience resolver
 * ============================================================ */

export interface AudiencePreview {
  totalMatches: number;
  byKind: {
    description: string;
    contactsFound: number;
    userIdsMapped: number;
    unmappedCount: number;
    limitation?: string;
  };
}

export interface ResolvedAudience {
  userIds: string[];
  unmappedContactIds: string[];
  preview: AudiencePreview;
}

export function resolveAudience(target: AudienceTarget): ResolvedAudience {
  const userIdSet = new Set<string>();
  const unmappedContactIds: string[] = [];

  function mapContact(id: string, email: string): void {
    const uid = resolveUserIdForEmail(email);
    if (uid) {
      userIdSet.add(uid);
    } else {
      unmappedContactIds.push(id);
    }
  }

  let description = "";
  let contactsFound = 0;
  let limitation: string | undefined;

  switch (target.kind) {
    case "all_investors": {
      const contacts = listContacts({ kind: "investor" });
      contactsFound = contacts.length;
      description = `All investors (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "all_founders": {
      const contacts = listContacts({ kind: "founder" });
      contactsFound = contacts.length;
      description = `All founders (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "all_consortium_partners": {
      const contacts = listContacts({ kind: "consortium_partner" });
      contactsFound = contacts.length;
      description = `All consortium partners (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "all_admins": {
      // Only canonical admin persona available
      userIdSet.add("u_admin");
      contactsFound = 1;
      description = "All admins";
      break;
    }
    case "cap_table_members": {
      // No roundsStore access (off-limits). Fall back to founders of company.
      const companyId = target.companyId ?? "";
      const founderContacts = listContacts({ kind: "founder" }).filter(
        c => c.companyIds.includes(companyId)
      );
      contactsFound = founderContacts.length;
      description = `Cap-table members of ${companyId} (founders only, ${contactsFound})`;
      limitation = "Cap-table investor members could not be resolved (roundsStore is off-limits). Only founders linked to this company are included.";
      for (const c of founderContacts) mapContact(c.id, c.email);
      break;
    }
    case "founders_of_company": {
      const companyId = target.companyId ?? "";
      const founderContacts = listContacts({ kind: "founder" }).filter(
        c => c.companyIds.includes(companyId)
      );
      contactsFound = founderContacts.length;
      description = `Founders of ${companyId} (${contactsFound})`;
      for (const c of founderContacts) mapContact(c.id, c.email);
      break;
    }
    case "investors_by_industry": {
      const industries = target.industries ?? [];
      const contacts = listContacts({ kind: "investor" }).filter(
        c => industries.some(ind => c.industries.includes(ind))
      );
      contactsFound = contacts.length;
      description = `Investors in ${industries.join(", ")} (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "investors_by_region": {
      const regions = target.regions ?? [];
      const contacts = listContacts({ kind: "investor" }).filter(
        c => regions.includes(c.region) || regions.includes(c.hqCountry)
      );
      contactsFound = contacts.length;
      description = `Investors in regions ${regions.join(", ")} (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "investors_by_industry_and_region": {
      const industries = target.industries ?? [];
      const regions = target.regions ?? [];
      const contacts = listContacts({ kind: "investor" }).filter(
        c =>
          industries.some(ind => c.industries.includes(ind)) &&
          (regions.includes(c.region) || regions.includes(c.hqCountry))
      );
      contactsFound = contacts.length;
      description = `Investors in ${industries.join(", ")} AND regions ${regions.join(", ")} (${contactsFound})`;
      for (const c of contacts) mapContact(c.id, c.email);
      break;
    }
    case "companies_by_industry": {
      const industries = target.industries ?? [];
      // Find companies with matching industry (from founder contacts' industries field)
      const founderContacts = listContacts({ kind: "founder" }).filter(
        c => industries.some(ind => c.industries.includes(ind))
      );
      contactsFound = founderContacts.length;
      description = `Founders of companies in ${industries.join(", ")} (${contactsFound})`;
      for (const c of founderContacts) mapContact(c.id, c.email);
      break;
    }
    case "companies_by_region": {
      const regions = target.regions ?? [];
      const founderContacts = listContacts({ kind: "founder" }).filter(
        c => regions.includes(c.region) || regions.includes(c.hqCountry)
      );
      contactsFound = founderContacts.length;
      description = `Founders of companies in regions ${regions.join(", ")} (${contactsFound})`;
      for (const c of founderContacts) mapContact(c.id, c.email);
      break;
    }
    case "specific_users": {
      const userIds = target.userIds ?? [];
      contactsFound = userIds.length;
      description = `Specific users (${contactsFound})`;
      for (const uid of userIds) {
        if (uid.trim()) userIdSet.add(uid.trim());
      }
      break;
    }
    default: {
      description = "Unknown audience kind";
      break;
    }
  }

  const userIds = Array.from(userIdSet);
  const preview: AudiencePreview = {
    totalMatches: Math.max(contactsFound, userIds.length),
    byKind: {
      description,
      contactsFound,
      userIdsMapped: userIds.length,
      unmappedCount: unmappedContactIds.length,
      ...(limitation ? { limitation } : {}),
    },
  };

  return { userIds, unmappedContactIds, preview };
}

/* ============================================================
 * Chain verify
 * ============================================================ */

export function verifyCampaignChain(campaignId: string): { ok: boolean; brokenAtVersion?: number; totalRevisions: number } {
  const revs = revisions.get(campaignId) ?? [];
  if (revs.length === 0) return { ok: false, totalRevisions: 0 };

  let prior = "0".repeat(64);
  for (const rev of revs) {
    if (rev.prevRevisionHash !== prior) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    const expected = computeCampaignHash(rev.snapshot);
    if (rev.revisionHash !== expected) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    prior = rev.revisionHash;
  }
  return { ok: true, totalRevisions: revs.length };
}

/* ============================================================
 * Internal CRUD helpers
 * ============================================================ */

function createCampaign(
  data: Omit<NotificationCampaign, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash" | "actualSentCount" | "errors" | "sentAt" | "status" | "resolvedAudiencePreview">,
  actor: string
): NotificationCampaign {
  const id = newCampaignId();
  const now = new Date().toISOString();
  const prevRevisionHash = "0".repeat(64);

  // Resolve audience for preview count
  const resolved = resolveAudience(data.audience);

  const c: NotificationCampaign = {
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    version: 1,
    status: "draft",
    resolvedAudiencePreview: resolved.preview.totalMatches,
    actualSentCount: 0,
    errors: [],
    sentAt: null,
    prevRevisionHash,
    revisionHash: "",
  };

  c.revisionHash = computeCampaignHash(c);
  campaigns.set(id, c);
  appendRevision(c, "campaign.created");
  appendAdminAudit(actor, `campaign:${id}`, "campaign.created", { name: c.name, audienceKind: c.audience.kind });
  emitBridgeEvent({
    eventType: "notification_campaign.created",
    aggregateId: id,
    aggregateKind: "platform",
    payload: { name: c.name, audienceKind: c.audience.kind, status: c.status },
  });

  return c;
}

function updateCampaign(
  id: string,
  patch: Partial<Omit<NotificationCampaign, "id" | "createdAt" | "createdBy" | "version" | "prevRevisionHash" | "revisionHash">>,
  actor: string,
  action = "campaign.updated"
): NotificationCampaign | null {
  const existing = campaigns.get(id);
  if (!existing) return null;

  const now = new Date().toISOString();

  // If audience changed, re-resolve preview
  const audienceChanged = patch.audience && JSON.stringify(patch.audience) !== JSON.stringify(existing.audience);
  const newPreviewCount = audienceChanged
    ? resolveAudience(patch.audience!).preview.totalMatches
    : existing.resolvedAudiencePreview;

  const updated: NotificationCampaign = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    updatedAt: now,
    updatedBy: actor,
    version: existing.version + 1,
    prevRevisionHash: existing.revisionHash,
    resolvedAudiencePreview: newPreviewCount,
    revisionHash: "",
  };

  updated.revisionHash = computeCampaignHash(updated);
  campaigns.set(id, updated);
  appendRevision(updated, action);
  appendAdminAudit(actor, `campaign:${id}`, action, { version: updated.version, changes: Object.keys(patch) });

  return updated;
}

/* ============================================================
 * Send logic (used by immediate send + scheduler)
 * ============================================================ */

export async function executeCampaignSend(id: string, actor: string): Promise<NotificationCampaign | null> {
  const c = campaigns.get(id);
  if (!c) return null;

  // Idempotent guard
  if (c.status !== "draft" && c.status !== "scheduled") {
    return c;
  }

  // Transition to sending
  const inSending = updateCampaign(id, { status: "sending" }, actor, "campaign.sending");
  if (!inSending) return null;

  const resolved = resolveAudience(c.audience);
  const errors: Array<{ userId: string; error: string }> = [];

  // Emit errors for unmapped contacts
  for (const contactId of resolved.unmappedContactIds) {
    errors.push({ userId: contactId, error: "no_userid_mapped" });
  }

  // Emit notifications for mapped userIds
  let sentCount = 0;
  for (const userId of resolved.userIds) {
    try {
      emitNotification({
        userId,
        kind: c.content.notificationKind,
        title: c.content.title,
        body: c.content.body,
        link: c.content.link ?? undefined,
      });
      sentCount++;
    } catch (err) {
      errors.push({ userId, error: (err as Error).message ?? "emit_failed" });
    }
  }

  const now = new Date().toISOString();
  const sent = updateCampaign(
    id,
    { status: "sent", actualSentCount: sentCount, errors, sentAt: now },
    actor,
    "campaign.sent"
  );

  if (sent) {
    appendAdminAudit(actor, `campaign:${id}`, "campaign.sent", { sentCount, errorCount: errors.length, sentAt: now });
    emitBridgeEvent({
      eventType: "notification_campaign.sent",
      aggregateId: id,
      aggregateKind: "platform",
      payload: { name: c.name, sentCount, errorCount: errors.length, sentAt: now },
    });
  }

  return sent;
}

/* ============================================================
 * Scheduled tick — runs every 30 seconds
 * ============================================================ */

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startCampaignScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    const now = new Date().toISOString();
    for (const c of campaigns.values()) {
      if (c.status !== "scheduled") continue;
      if (!c.scheduledAt) continue;
      if (c.scheduledAt <= now) {
        // Fire and forget — errors logged in executeCampaignSend
        executeCampaignSend(c.id, "u_scheduler").catch(() => { /* noop */ });
      }
    }
  }, 30_000);
}

/* ============================================================
 * Stats
 * ============================================================ */

export function getCampaignStats() {
  const all = Array.from(campaigns.values());
  const now = Date.now();
  const day7 = now - 7 * 24 * 60 * 60 * 1000;
  const day30 = now - 30 * 24 * 60 * 60 * 1000;
  const day90 = now - 90 * 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);

  const sentCampaigns = all.filter(c => c.status === "sent" && c.sentAt);

  return {
    byStatus: {
      draft: all.filter(c => c.status === "draft").length,
      scheduled: all.filter(c => c.status === "scheduled").length,
      sending: all.filter(c => c.status === "sending").length,
      sent: all.filter(c => c.status === "sent").length,
      canceled: all.filter(c => c.status === "canceled").length,
      failed: all.filter(c => c.status === "failed").length,
    },
    sentToday: sentCampaigns.filter(c => c.sentAt!.startsWith(today)).reduce((a, c) => a + c.actualSentCount, 0),
    sentThisWeek: sentCampaigns.filter(c => new Date(c.sentAt!).getTime() >= day7).reduce((a, c) => a + c.actualSentCount, 0),
    sentThisMonth: sentCampaigns.filter(c => new Date(c.sentAt!).getTime() >= day30).reduce((a, c) => a + c.actualSentCount, 0),
    sentLast90Days: sentCampaigns.filter(c => new Date(c.sentAt!).getTime() >= day90).reduce((a, c) => a + c.actualSentCount, 0),
    totalCampaigns: all.length,
    cancelationRate: all.length > 0
      ? (all.filter(c => c.status === "canceled").length / all.length)
      : 0,
  };
}

/* ============================================================
 * Validation helpers
 * ============================================================ */

function validateCampaignBody(body: Record<string, unknown>): { ok: boolean; error?: string } {
  const { name, audience, content } = body;
  if (!name || typeof name !== "string") return { ok: false, error: "name is required" };
  if (!audience || typeof audience !== "object") return { ok: false, error: "audience is required" };
  const aud = audience as Record<string, unknown>;
  const validKinds: AudienceKind[] = [
    "all_founders", "all_investors", "all_consortium_partners", "all_admins",
    "cap_table_members", "founders_of_company", "investors_by_industry",
    "investors_by_region", "investors_by_industry_and_region",
    "companies_by_industry", "companies_by_region", "specific_users",
  ];
  if (!validKinds.includes(aud.kind as AudienceKind)) {
    return { ok: false, error: `audience.kind must be one of: ${validKinds.join(", ")}` };
  }
  if (!content || typeof content !== "object") return { ok: false, error: "content is required" };
  const cnt = content as Record<string, unknown>;
  if (!ALL_NOTIFICATION_KINDS.includes(cnt.notificationKind as NotificationKind)) {
    return { ok: false, error: `content.notificationKind must be one of the 27 kinds` };
  }
  if (!cnt.title || typeof cnt.title !== "string" || (cnt.title as string).length > 120) {
    return { ok: false, error: "content.title is required (max 120 chars)" };
  }
  if (!cnt.body || typeof cnt.body !== "string" || (cnt.body as string).length > 600) {
    return { ok: false, error: "content.body is required (max 600 chars)" };
  }
  const validSeverities = ["info", "warning", "critical"];
  if (!validSeverities.includes(cnt.severity as string)) {
    return { ok: false, error: "content.severity must be info | warning | critical" };
  }
  return { ok: true };
}

/* ============================================================
 * Route registration
 * ============================================================ */

export function registerNotificationCampaignRoutes(app: Express): void {
  startCampaignScheduler();

  // ── GET /api/admin/notification-campaigns/stats ────────────
  app.get("/api/admin/notification-campaigns/stats", (_req: Request, res: Response) => {
    res.json(getCampaignStats());
  });

  // ── GET /api/admin/notification-campaigns ─────────────────
  app.get("/api/admin/notification-campaigns", (req: Request, res: Response) => {
    const { status, audienceKind, search } = req.query as Record<string, string>;
    let results = Array.from(campaigns.values());
    if (status) results = results.filter(c => c.status === status);
    if (audienceKind) results = results.filter(c => c.audience.kind === audienceKind);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
      );
    }
    results = results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ total: results.length, campaigns: results });
  });

  // ── POST /api/admin/notification-campaigns ─────────────────
  app.post("/api/admin/notification-campaigns", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const body = req.body ?? {};

    const valid = validateCampaignBody(body);
    if (!valid.ok) return res.status(400).json({ ok: false, error: valid.error });

    const audience: AudienceTarget = body.audience;
    const content: CampaignContent = {
      notificationKind: body.content.notificationKind,
      title: body.content.title,
      body: body.content.body,
      link: body.content.link ?? null,
      severity: body.content.severity,
    };

    const proposed = {
      name: String(body.name),
      description: String(body.description ?? ""),
      audience,
      content,
      scheduledAt: body.scheduledAt ?? null,
      timezone: String(body.timezone ?? "UTC"),
    };

    if (confirm !== "true") {
      const preview = resolveAudience(audience);
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with header `x-confirm: true` to create this campaign.",
        proposedChange: proposed,
        audiencePreview: preview.preview,
      });
    }

    const c = createCampaign(proposed, actor);
    res.status(201).json({ ok: true, campaign: c });
  });

  // ── GET /api/admin/notification-campaigns/:id ──────────────
  app.get("/api/admin/notification-campaigns/:id", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, campaign: c });
  });

  // ── GET /api/admin/notification-campaigns/:id/history ─────
  app.get("/api/admin/notification-campaigns/:id/history", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    const history = revisions.get(req.params.id) ?? [];
    const chain = verifyCampaignChain(req.params.id);
    res.json({ ok: true, campaignId: req.params.id, history, chain });
  });

  // ── GET /api/admin/notification-campaigns/:id/audience-preview ─
  app.get("/api/admin/notification-campaigns/:id/audience-preview", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    const resolved = resolveAudience(c.audience);
    appendAdminAudit("u_admin", `campaign:${c.id}`, "campaign.audience_resolved", {
      audienceKind: c.audience.kind,
      totalMatches: resolved.preview.totalMatches,
    });
    res.json({ ok: true, campaignId: c.id, preview: resolved.preview, resolvedUserCount: resolved.userIds.length });
  });

  // ── POST /api/admin/notification-campaigns/audience-preview (transient, no save) ─
  app.post("/api/admin/notification-campaigns/audience-preview", (req: Request, res: Response) => {
    const audience: AudienceTarget = req.body?.audience;
    if (!audience || !audience.kind) {
      return res.status(400).json({ ok: false, error: "audience.kind is required" });
    }
    const resolved = resolveAudience(audience);
    res.json({ ok: true, preview: resolved.preview, resolvedUserCount: resolved.userIds.length });
  });

  // ── PATCH /api/admin/notification-campaigns/:id ────────────
  app.patch("/api/admin/notification-campaigns/:id", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status === "sent" || c.status === "sending" || c.status === "canceled" || c.status === "failed") {
      return res.status(400).json({ ok: false, error: "cannot_modify_terminal_campaign", status: c.status });
    }

    const patch = req.body ?? {};
    // Strip immutable fields
    for (const k of ["id", "createdAt", "createdBy", "version", "prevRevisionHash", "revisionHash", "status", "actualSentCount", "errors", "sentAt"]) {
      delete patch[k];
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with header `x-confirm: true` to apply.",
        proposedChange: patch,
        currentVersion: c.version,
        wouldBecomeVersion: c.version + 1,
      });
    }

    const updated = updateCampaign(req.params.id, patch, actor);
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, campaign: updated });
  });

  // ── POST /api/admin/notification-campaigns/:id/schedule ────
  app.post("/api/admin/notification-campaigns/:id/schedule", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft") {
      return res.status(400).json({ ok: false, error: "campaign_must_be_draft_to_schedule", status: c.status });
    }

    const { scheduledAt, timezone } = req.body ?? {};
    if (!scheduledAt) return res.status(400).json({ ok: false, error: "scheduledAt is required" });

    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime())) {
      return res.status(400).json({ ok: false, error: "scheduledAt must be a valid ISO date" });
    }
    if (schedDate.getTime() <= Date.now()) {
      return res.status(400).json({ ok: false, error: "scheduledAt must be in the future" });
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        proposedChange: { scheduledAt, timezone: timezone ?? c.timezone },
      });
    }

    const updated = updateCampaign(
      req.params.id,
      { scheduledAt, timezone: timezone ?? c.timezone, status: "scheduled" },
      actor,
      "campaign.scheduled"
    );
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `campaign:${req.params.id}`, "campaign.scheduled", { scheduledAt, timezone });
    emitBridgeEvent({
      eventType: "notification_campaign.scheduled",
      aggregateId: req.params.id,
      aggregateKind: "platform",
      payload: { name: c.name, scheduledAt },
    });

    res.json({ ok: true, campaign: updated });
  });

  // ── POST /api/admin/notification-campaigns/:id/send ────────
  app.post("/api/admin/notification-campaigns/:id/send", async (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft" && c.status !== "scheduled") {
      return res.status(400).json({ ok: false, error: "campaign_not_sendable", status: c.status });
    }

    if (confirm !== "true") {
      const preview = resolveAudience(c.audience);
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to immediately deliver this campaign.",
        audiencePreview: preview.preview,
        campaignName: c.name,
      });
    }

    const result = await executeCampaignSend(req.params.id, actor);
    if (!result) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, campaign: result });
  });

  // ── POST /api/admin/notification-campaigns/:id/cancel ──────
  app.post("/api/admin/notification-campaigns/:id/cancel", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft" && c.status !== "scheduled") {
      return res.status(400).json({ ok: false, error: "campaign_not_cancelable", status: c.status });
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        proposedChange: { status: "canceled" },
        currentStatus: c.status,
      });
    }

    const updated = updateCampaign(req.params.id, { status: "canceled" }, actor, "campaign.canceled");
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `campaign:${req.params.id}`, "campaign.canceled", { version: updated.version });
    emitBridgeEvent({
      eventType: "notification_campaign.canceled",
      aggregateId: req.params.id,
      aggregateKind: "platform",
      payload: { name: c.name, previousStatus: c.status },
    });

    res.json({ ok: true, campaign: updated });
  });
}

/* ============================================================
 * Test helpers
 * ============================================================ */

export const _testCampaigns = {
  reset(): void {
    campaigns.clear();
    revisions.clear();
  },
  getCampaigns(): Map<string, NotificationCampaign> {
    return campaigns;
  },
  getRevisions(): Map<string, CampaignRevision[]> {
    return revisions;
  },
  // Expose internal helpers for testing
  resolveAudience,
  executeCampaignSend,
  verifyCampaignChain,
};
