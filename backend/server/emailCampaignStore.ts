/**
 * Sprint 28 Wave 7 — Email Campaign Store
 *
 * Admin-authored ad-hoc email campaigns with audience targeting, scheduling,
 * test-send, typed confirmation, hash chain, and bridge event integration.
 *
 * Mirrors the structure of notificationCampaignStore.ts (Wave 6) but for email.
 * Reuses AudienceTarget + resolveAudience from notificationCampaignStore.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { enqueueOneOff, enqueueBulk, renderTemplate, findTemplate } from "./emailStore";
import {
  type AudienceTarget,
  resolveAudience,
  type AudiencePreview,
} from "./notificationCampaignStore";
import { listContacts } from "./adminContactsStore";

/* ============================================================
 * Re-export AudienceTarget so callers can import from here too
 * ============================================================ */
export type { AudienceTarget };

/* ============================================================
 * Types
 * ============================================================ */

export type EmailCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled" | "failed";

export interface EmailCampaignContent {
  templateSlug: string | null;        // null = freeform
  subject: string;                    // 1..200 chars
  bodyHtml: string;
  bodyText: string;
  variables: Record<string, string>;  // applied to template OR freeform with {{ }} substitution
  replyTo: string | null;
}

export interface EmailCampaign {
  id: string;
  name: string;
  description: string;
  audience: AudienceTarget;
  content: EmailCampaignContent;
  scheduledAt: string | null;
  timezone: string;
  status: EmailCampaignStatus;
  resolvedAudiencePreview: number;
  actualSentCount: number;
  errors: Array<{ recipientEmail?: string; userId?: string; error: string }>;
  testRecipients: string[];
  testSentAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
}

export interface EmailCampaignRevision {
  campaignId: string;
  version: number;
  prevRevisionHash: string;
  revisionHash: string;
  updatedAt: string;
  updatedBy: string;
  action: string;
  snapshot: EmailCampaign;
}

/* ============================================================
 * In-memory stores
 * ============================================================ */

const campaigns: Map<string, EmailCampaign> = new Map();
const revisions: Map<string, EmailCampaignRevision[]> = new Map();

/* ============================================================
 * Crypto helpers
 * ============================================================ */

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function computeHash(c: EmailCampaign): string {
  const body = [
    c.id,
    c.version,
    c.name,
    c.status,
    c.content.subject,
    c.content.bodyHtml.slice(0, 200), // truncate for perf
    c.content.templateSlug ?? "freeform",
    c.updatedAt,
    c.updatedBy,
    c.prevRevisionHash,
    JSON.stringify(c.audience),
  ].join("|");
  return sha256(body);
}

function newId(): string {
  return `ecmp_${randomBytes(6).toString("hex")}`;
}

/* ============================================================
 * Handlebars-style {{ }} substitution for freeform
 * ============================================================ */

function substituteVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    return key in vars ? String(vars[key]) : `{{${key}}}`;
  });
}

/* ============================================================
 * Render preview — resolves subject + html + text with vars
 * ============================================================ */

export function renderCampaignPreview(content: EmailCampaignContent): {
  subject: string;
  html: string;
  text: string;
} {
  if (content.templateSlug) {
    const tpl = findTemplate(content.templateSlug);
    if (!tpl) {
      return {
        subject: substituteVariables(content.subject, content.variables),
        html: content.bodyHtml,
        text: content.bodyText,
      };
    }
    const vars = content.variables;
    return {
      subject: renderTemplate(tpl.subject, vars),
      html: renderTemplate(tpl.bodyHtml, vars),
      text: renderTemplate(tpl.bodyText, vars),
    };
  }
  // Freeform
  return {
    subject: substituteVariables(content.subject, content.variables),
    html: substituteVariables(content.bodyHtml, content.variables),
    text: substituteVariables(content.bodyText, content.variables),
  };
}

/* ============================================================
 * Audience email resolver
 * (extends resolveAudience by also mapping userIds → emails via contacts)
 * ============================================================ */

interface ResolvedEmailAudience {
  emails: string[];
  unmappedUserIds: string[];
  errors: Array<{ recipientEmail?: string; userId?: string; error: string }>;
  preview: AudiencePreview;
}

function resolveEmailAudience(target: AudienceTarget): ResolvedEmailAudience {
  const base = resolveAudience(target);
  const emails: string[] = [];
  const unmappedUserIds: string[] = [];
  const errors: Array<{ recipientEmail?: string; userId?: string; error: string }> = [];

  // Build userId → email map from contacts
  const allContacts = [
    ...listContacts({ kind: "investor" }),
    ...listContacts({ kind: "founder" }),
    ...listContacts({ kind: "consortium_partner" }),
  ];
  const userToEmail = new Map<string, string>();
  // Known canonical personas
  const PERSONA_EMAILS: Record<string, string> = {
    "u_maya_chen": "maya@novapay.ai",
    "u_aisha_patel": "aisha@greenwood.capital",
    "u_admin": "admin@capavate.io",
    "u_lapsed_lp": "lp@lapsed-fund.example",
    "u_no_position": "newinvestor@example.com",
  };
  for (const [uid, email] of Object.entries(PERSONA_EMAILS)) {
    userToEmail.set(uid, email);
  }
  // From contacts
  for (const c of allContacts) {
    if (c.email) {
      // Map contact.id → email
      userToEmail.set(c.id, c.email);
    }
  }

  for (const userId of base.userIds) {
    const email = userToEmail.get(userId);
    if (email) {
      emails.push(email);
    } else {
      unmappedUserIds.push(userId);
      errors.push({ userId, error: "no_email_mapped" });
    }
  }

  for (const contactId of base.unmappedContactIds) {
    errors.push({ userId: contactId, error: "no_userid_mapped" });
  }

  return { emails, unmappedUserIds, errors, preview: base.preview };
}

/* ============================================================
 * Hash chain verify
 * ============================================================ */

export function verifyCampaignChain(campaignId: string): {
  ok: boolean;
  brokenAtVersion?: number;
  totalRevisions: number;
} {
  const revs = revisions.get(campaignId) ?? [];
  if (revs.length === 0) return { ok: false, totalRevisions: 0 };

  let prior = "0".repeat(64);
  for (const rev of revs) {
    if (rev.prevRevisionHash !== prior) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    const expected = computeHash(rev.snapshot);
    if (rev.revisionHash !== expected) {
      return { ok: false, brokenAtVersion: rev.version, totalRevisions: revs.length };
    }
    prior = rev.revisionHash;
  }
  return { ok: true, totalRevisions: revs.length };
}

/* ============================================================
 * Revision helpers
 * ============================================================ */

function appendRevision(c: EmailCampaign, action: string): void {
  const rev: EmailCampaignRevision = {
    campaignId: c.id,
    version: c.version,
    prevRevisionHash: c.prevRevisionHash,
    revisionHash: c.revisionHash,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
    action,
    snapshot: JSON.parse(JSON.stringify(c)) as EmailCampaign,
  };
  const arr = revisions.get(c.id) ?? [];
  arr.push(rev);
  revisions.set(c.id, arr);
}

/* ============================================================
 * Internal CRUD helpers
 * ============================================================ */

function createCampaign(
  data: Omit<
    EmailCampaign,
    | "id"
    | "createdAt"
    | "updatedAt"
    | "version"
    | "prevRevisionHash"
    | "revisionHash"
    | "actualSentCount"
    | "errors"
    | "sentAt"
    | "status"
    | "resolvedAudiencePreview"
    | "testRecipients"
    | "testSentAt"
  >,
  actor: string
): EmailCampaign {
  const id = newId();
  const now = new Date().toISOString();
  const prevRevisionHash = "0".repeat(64);
  const resolved = resolveAudience(data.audience);

  const c: EmailCampaign = {
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
    testRecipients: [],
    testSentAt: null,
    prevRevisionHash,
    revisionHash: "",
  };

  c.revisionHash = computeHash(c);
  campaigns.set(id, c);
  appendRevision(c, "email_campaign.created");
  appendAdminAudit(actor, `email_campaign:${id}`, "email_campaign.created", {
    name: c.name,
    audienceKind: c.audience.kind,
  });
  emitBridgeEvent({
    eventType: "email_campaign.created",
    aggregateId: id,
    aggregateKind: "platform",
    payload: { name: c.name, audienceKind: c.audience.kind, status: c.status },
  });

  return c;
}

function updateCampaign(
  id: string,
  patch: Partial<
    Omit<
      EmailCampaign,
      "id" | "createdAt" | "createdBy" | "version" | "prevRevisionHash" | "revisionHash"
    >
  >,
  actor: string,
  action = "email_campaign.updated"
): EmailCampaign | null {
  const existing = campaigns.get(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const audienceChanged =
    patch.audience && JSON.stringify(patch.audience) !== JSON.stringify(existing.audience);
  const newPreviewCount = audienceChanged
    ? resolveAudience(patch.audience!).preview.totalMatches
    : existing.resolvedAudiencePreview;

  const updated: EmailCampaign = {
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

  updated.revisionHash = computeHash(updated);
  campaigns.set(id, updated);
  appendRevision(updated, action);
  appendAdminAudit(actor, `email_campaign:${id}`, action, {
    version: updated.version,
    changes: Object.keys(patch),
  });

  return updated;
}

/* ============================================================
 * Send logic
 * ============================================================ */

export async function executeCampaignSend(
  id: string,
  actor: string
): Promise<EmailCampaign | null> {
  const c = campaigns.get(id);
  if (!c) return null;

  if (c.status !== "draft" && c.status !== "scheduled") {
    return c; // idempotent
  }

  const inSending = updateCampaign(id, { status: "sending" }, actor, "email_campaign.sending");
  if (!inSending) return null;

  const emailResolved = resolveEmailAudience(c.audience);
  const preview = renderCampaignPreview(c.content);
  const errors: Array<{ recipientEmail?: string; userId?: string; error: string }> = [
    ...emailResolved.errors,
  ];

  // Bulk enqueue
  const items = emailResolved.emails.map((email) => ({
    to: email,
    subject: preview.subject,
    bodyHtml: preview.html,
    bodyText: preview.text,
    replyTo: c.content.replyTo ?? undefined,
  }));

  const batch = enqueueBulk({ campaignId: c.id, items });
  const now = new Date().toISOString();

  const sent = updateCampaign(
    id,
    {
      status: "sent",
      actualSentCount: batch.queuedCount,
      errors,
      sentAt: now,
    },
    actor,
    "email_campaign.sent"
  );

  if (sent) {
    appendAdminAudit(actor, `email_campaign:${id}`, "email_campaign.sent", {
      sentCount: batch.queuedCount,
      errorCount: errors.length,
      sentAt: now,
    });
    emitBridgeEvent({
      eventType: "email_campaign.sent",
      aggregateId: id,
      aggregateKind: "platform",
      payload: {
        name: c.name,
        sentCount: batch.queuedCount,
        errorCount: errors.length,
        sentAt: now,
      },
    });
  }

  return sent;
}

/* ============================================================
 * Scheduled tick — every 30 seconds
 * ============================================================ */

let _schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startEmailCampaignScheduler(): void {
  if (_schedulerInterval) return;
  _schedulerInterval = setInterval(() => {
    const now = new Date().toISOString();
    for (const c of campaigns.values()) {
      if (c.status !== "scheduled") continue;
      if (!c.scheduledAt) continue;
      if (c.scheduledAt <= now) {
        executeCampaignSend(c.id, "u_scheduler").catch(() => { /* noop */ });
      }
    }
  }, 30_000);
}

/* ============================================================
 * Stats
 * ============================================================ */

export function getEmailCampaignStats() {
  const all = Array.from(campaigns.values());
  const now = Date.now();
  const day7 = now - 7 * 24 * 60 * 60 * 1000;
  const day30 = now - 30 * 24 * 60 * 60 * 1000;
  const today = new Date().toISOString().slice(0, 10);
  const sentCampaigns = all.filter((c) => c.status === "sent" && c.sentAt);

  return {
    byStatus: {
      draft: all.filter((c) => c.status === "draft").length,
      scheduled: all.filter((c) => c.status === "scheduled").length,
      sending: all.filter((c) => c.status === "sending").length,
      sent: all.filter((c) => c.status === "sent").length,
      canceled: all.filter((c) => c.status === "canceled").length,
      failed: all.filter((c) => c.status === "failed").length,
    },
    sentToday: sentCampaigns
      .filter((c) => c.sentAt!.startsWith(today))
      .reduce((a, c) => a + c.actualSentCount, 0),
    sentThisWeek: sentCampaigns
      .filter((c) => new Date(c.sentAt!).getTime() >= day7)
      .reduce((a, c) => a + c.actualSentCount, 0),
    sentThisMonth: sentCampaigns
      .filter((c) => new Date(c.sentAt!).getTime() >= day30)
      .reduce((a, c) => a + c.actualSentCount, 0),
    totalCampaigns: all.length,
    cancelationRate:
      all.length > 0
        ? all.filter((c) => c.status === "canceled").length / all.length
        : 0,
  };
}

/* ============================================================
 * Validation
 * ============================================================ */

function validateCampaignBody(body: Record<string, unknown>): { ok: boolean; error?: string } {
  const { name, audience, content } = body;
  if (!name || typeof name !== "string") return { ok: false, error: "name is required" };
  if (!audience || typeof audience !== "object") return { ok: false, error: "audience is required" };
  const aud = audience as Record<string, unknown>;
  const validKinds = [
    "all_founders", "all_investors", "all_consortium_partners", "all_admins",
    "cap_table_members", "founders_of_company", "investors_by_industry",
    "investors_by_region", "investors_by_industry_and_region",
    "companies_by_industry", "companies_by_region", "specific_users",
  ];
  if (!validKinds.includes(aud.kind as string)) {
    return { ok: false, error: `audience.kind must be one of: ${validKinds.join(", ")}` };
  }
  if (!content || typeof content !== "object") return { ok: false, error: "content is required" };
  const cnt = content as Record<string, unknown>;
  if (!cnt.subject || typeof cnt.subject !== "string" || (cnt.subject as string).length < 1 || (cnt.subject as string).length > 200) {
    return { ok: false, error: "content.subject is required (1..200 chars)" };
  }
  if (typeof cnt.bodyHtml !== "string") {
    return { ok: false, error: "content.bodyHtml is required" };
  }
  return { ok: true };
}

/* ============================================================
 * Route registration
 * ============================================================ */

export function registerEmailCampaignRoutes(app: Express): void {
  startEmailCampaignScheduler();

  // ── GET /api/admin/email-campaigns/stats ────────────────────
  app.get("/api/admin/email-campaigns/stats", (_req: Request, res: Response) => {
    res.json(getEmailCampaignStats());
  });

  // ── POST /api/admin/email-campaigns/audience-preview (BEFORE /:id) ──
  app.post("/api/admin/email-campaigns/audience-preview", (req: Request, res: Response) => {
    const audience: AudienceTarget = req.body?.audience;
    if (!audience || !audience.kind) {
      return res.status(400).json({ ok: false, error: "audience.kind is required" });
    }
    const resolved = resolveAudience(audience);
    const emailResolved = resolveEmailAudience(audience);
    res.json({
      ok: true,
      preview: resolved.preview,
      resolvedEmailCount: emailResolved.emails.length,
    });
  });

  // ── GET /api/admin/email-campaigns ──────────────────────────
  app.get("/api/admin/email-campaigns", (req: Request, res: Response) => {
    const { status, audienceKind, search } = req.query as Record<string, string>;
    let results = Array.from(campaigns.values());
    if (status) results = results.filter((c) => c.status === status);
    if (audienceKind) results = results.filter((c) => c.audience.kind === audienceKind);
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      );
    }
    results = results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ total: results.length, campaigns: results });
  });

  // ── POST /api/admin/email-campaigns ─────────────────────────
  app.post("/api/admin/email-campaigns", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const body = req.body ?? {};

    const valid = validateCampaignBody(body);
    if (!valid.ok) return res.status(400).json({ ok: false, error: valid.error });

    const audience: AudienceTarget = body.audience;
    const rawContent = body.content as Record<string, unknown>;
    const content: EmailCampaignContent = {
      templateSlug: (rawContent.templateSlug as string | null) ?? null,
      subject: String(rawContent.subject),
      bodyHtml: String(rawContent.bodyHtml ?? ""),
      bodyText: String(rawContent.bodyText ?? ""),
      variables: (rawContent.variables as Record<string, string>) ?? {},
      replyTo: (rawContent.replyTo as string | null) ?? null,
    };

    const proposed = {
      name: String(body.name),
      description: String(body.description ?? ""),
      audience,
      content,
      scheduledAt: (body.scheduledAt as string | null) ?? null,
      timezone: String(body.timezone ?? "UTC"),
    };

    if (confirm !== "true") {
      const preview = resolveAudience(audience);
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with header `x-confirm: true` to create.",
        proposedChange: proposed,
        audiencePreview: preview.preview,
      });
    }

    const c = createCampaign(proposed, actor);
    res.status(201).json({ ok: true, campaign: c });
  });

  // ── GET /api/admin/email-campaigns/:id ──────────────────────
  app.get("/api/admin/email-campaigns/:id", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, campaign: c });
  });

  // ── GET /api/admin/email-campaigns/:id/history ──────────────
  app.get("/api/admin/email-campaigns/:id/history", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    const history = revisions.get(req.params.id) ?? [];
    const chain = verifyCampaignChain(req.params.id);
    res.json({ ok: true, campaignId: req.params.id, history, chain });
  });

  // ── GET /api/admin/email-campaigns/:id/audience-preview ─────
  app.get("/api/admin/email-campaigns/:id/audience-preview", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    const resolved = resolveAudience(c.audience);
    const emailResolved = resolveEmailAudience(c.audience);
    appendAdminAudit("u_admin", `email_campaign:${c.id}`, "email_campaign.audience_resolved", {
      audienceKind: c.audience.kind,
      totalMatches: resolved.preview.totalMatches,
    });
    res.json({
      ok: true,
      campaignId: c.id,
      preview: resolved.preview,
      resolvedEmailCount: emailResolved.emails.length,
    });
  });

  // ── POST /api/admin/email-campaigns/:id/render-preview ──────
  app.post("/api/admin/email-campaigns/:id/render-preview", (req: Request, res: Response) => {
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    // Allow content override via body for live-preview
    const contentOverride = req.body?.content as Partial<EmailCampaignContent> | undefined;
    const mergedContent: EmailCampaignContent = contentOverride
      ? { ...c.content, ...contentOverride }
      : c.content;
    const preview = renderCampaignPreview(mergedContent);
    res.json({ ok: true, subject: preview.subject, html: preview.html, text: preview.text });
  });

  // ── PATCH /api/admin/email-campaigns/:id ────────────────────
  app.patch("/api/admin/email-campaigns/:id", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (
      c.status === "sent" ||
      c.status === "sending" ||
      c.status === "canceled" ||
      c.status === "failed"
    ) {
      return res.status(400).json({
        ok: false,
        error: "cannot_modify_terminal_campaign",
        status: c.status,
      });
    }

    const patch = { ...(req.body ?? {}) };
    for (const k of [
      "id", "createdAt", "createdBy", "version", "prevRevisionHash", "revisionHash",
      "status", "actualSentCount", "errors", "sentAt", "testSentAt", "testRecipients",
    ]) {
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

  // ── POST /api/admin/email-campaigns/:id/test-send ───────────
  app.post("/api/admin/email-campaigns/:id/test-send", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });

    const recipients: string[] = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    if (recipients.length === 0) {
      return res.status(400).json({ ok: false, error: "at_least_one_recipient_required" });
    }
    if (recipients.length > 5) {
      return res.status(400).json({ ok: false, error: "max_5_test_recipients" });
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        proposedChange: { action: "test_send", recipients },
      });
    }

    const preview = renderCampaignPreview(c.content);
    for (const email of recipients) {
      enqueueOneOff({
        recipientUserId: "u_admin",
        to: email,
        subject: `[TEST] ${preview.subject}`,
        bodyHtml: preview.html,
        bodyText: preview.text,
        replyTo: c.content.replyTo ?? undefined,
        campaignId: c.id,
      });
    }

    const now = new Date().toISOString();
    const updated = updateCampaign(
      req.params.id,
      {
        testRecipients: [...new Set([...c.testRecipients, ...recipients])],
        testSentAt: now,
      },
      actor,
      "email_campaign.test_sent"
    );

    if (updated) {
      appendAdminAudit(actor, `email_campaign:${req.params.id}`, "email_campaign.test_sent", {
        recipients,
        testSentAt: now,
      });
      emitBridgeEvent({
        eventType: "email_campaign.test_sent",
        aggregateId: req.params.id,
        aggregateKind: "platform",
        payload: { name: c.name, recipients, testSentAt: now },
      });
    }

    res.json({ ok: true, campaign: updated, enqueued: recipients.length });
  });

  // ── POST /api/admin/email-campaigns/:id/schedule ────────────
  app.post("/api/admin/email-campaigns/:id/schedule", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft") {
      return res
        .status(400)
        .json({ ok: false, error: "campaign_must_be_draft_to_schedule", status: c.status });
    }

    const { scheduledAt, timezone } = req.body ?? {};
    if (!scheduledAt) return res.status(400).json({ ok: false, error: "scheduledAt is required" });
    const schedDate = new Date(scheduledAt as string);
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
      { scheduledAt: scheduledAt as string, timezone: String(timezone ?? c.timezone), status: "scheduled" },
      actor,
      "email_campaign.scheduled"
    );
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `email_campaign:${req.params.id}`, "email_campaign.scheduled", {
      scheduledAt,
      timezone,
    });
    emitBridgeEvent({
      eventType: "email_campaign.scheduled",
      aggregateId: req.params.id,
      aggregateKind: "platform",
      payload: { name: c.name, scheduledAt },
    });

    res.json({ ok: true, campaign: updated });
  });

  // ── POST /api/admin/email-campaigns/:id/send ─────────────────
  app.post("/api/admin/email-campaigns/:id/send", async (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft" && c.status !== "scheduled") {
      return res
        .status(400)
        .json({ ok: false, error: "campaign_not_sendable", status: c.status });
    }

    // Typed confirmation: body must include confirmName matching campaign.name
    const confirmName = String(req.body?.confirmName ?? "");
    if (confirmName !== c.name) {
      return res.status(400).json({
        ok: false,
        error: "typed_confirmation_mismatch",
        message: `confirmName must exactly match campaign name: "${c.name}"`,
      });
    }

    if (confirm !== "true") {
      const preview = resolveAudience(c.audience);
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        message: "Send with `x-confirm: true` to deliver this campaign.",
        audiencePreview: preview.preview,
        campaignName: c.name,
      });
    }

    const result = await executeCampaignSend(req.params.id, actor);
    if (!result) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, campaign: result });
  });

  // ── POST /api/admin/email-campaigns/:id/cancel ───────────────
  app.post("/api/admin/email-campaigns/:id/cancel", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const c = campaigns.get(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: "not_found" });
    if (c.status !== "draft" && c.status !== "scheduled") {
      return res
        .status(400)
        .json({ ok: false, error: "campaign_not_cancelable", status: c.status });
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        proposedChange: { status: "canceled" },
        currentStatus: c.status,
      });
    }

    const updated = updateCampaign(req.params.id, { status: "canceled" }, actor, "email_campaign.canceled");
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    appendAdminAudit(actor, `email_campaign:${req.params.id}`, "email_campaign.canceled", {
      version: updated.version,
    });
    emitBridgeEvent({
      eventType: "email_campaign.canceled",
      aggregateId: req.params.id,
      aggregateKind: "platform",
      payload: { name: c.name, previousStatus: c.status },
    });

    res.json({ ok: true, campaign: updated });
  });
}

/* ============================================================
 * SMTP admin endpoints (transport config, outbox paged, retry, cancel)
 * ============================================================ */

import {
  getConfig as getTransportConfig,
  patchConfig as patchTransportConfig,
  testConnection as testTransportConnection,
} from "./emailTransport";
// V9 (Patch v8): replaced private _testEmail.outbox reach-ins with public accessors.
import { _testEmail, listOutbox, findOutboxItem, countOutboxByStatus } from "./emailStore";

export function registerEmailTransportRoutes(app: Express): void {
  // ── GET /api/admin/email/transport/config ───────────────────
  app.get("/api/admin/email/transport/config", (_req: Request, res: Response) => {
    res.json({ ok: true, config: getTransportConfig() });
  });

  // ── PATCH /api/admin/email/transport/config ─────────────────
  app.patch("/api/admin/email/transport/config", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const actor = String(req.headers["x-actor"] ?? (req as any).userContext?.userId ?? "");
    if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const patch = req.body ?? {};

    // Env-only fields — reject if passed
    const envOnlyFields = ["host", "port", "user", "pass", "secure"];
    for (const f of envOnlyFields) {
      if (f in patch) {
        return res.status(400).json({
          ok: false,
          error: `${f} is env-only and cannot be set via API`,
        });
      }
    }

    if (confirm !== "true") {
      return res.status(409).json({
        ok: false,
        error: "confirmation_required",
        proposedChange: patch,
      });
    }

    patchTransportConfig(patch);
    appendAdminAudit(actor, "email_transport", "email_transport.config_updated", { changes: Object.keys(patch) });
    res.json({ ok: true, config: getTransportConfig() });
  });

  // ── POST /api/admin/email/transport/test-connection ─────────
  app.post("/api/admin/email/transport/test-connection", async (_req: Request, res: Response) => {
    const result = await testTransportConnection();
    res.json({ ok: result.ok, latencyMs: result.latencyMs, error: result.error });
  });

  // ── GET /api/admin/email/transport/outbox ───────────────────
  // Paginated outbox with filter by status, template, recipient
  app.get("/api/admin/email/transport/outbox", (req: Request, res: Response) => {
    const { status, template, recipient, cursor, limit: limitQ } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitQ ?? "50", 10), 200);
    let items = listOutbox();

    if (status) items = items.filter((e) => e.status === status);
    if (template) items = items.filter((e) => e.templateSlug === template);
    if (recipient) {
      const q = recipient.toLowerCase();
      items = items.filter((e) => e.recipient.toLowerCase().includes(q));
    }

    // Cursor-based pagination (cursor = outbox item id, inclusive from next)
    const cursorIdx = cursor ? items.findIndex((e) => e.id === cursor) : -1;
    const start = cursorIdx >= 0 ? cursorIdx + 1 : 0;
    const page = items.slice(start, start + limit);
    const nextCursor = page.length === limit ? page[page.length - 1].id : null;

    res.json({
      ok: true,
      total: items.length,
      items: page,
      nextCursor,
      stats: countOutboxByStatus(),
    });
  });

  // ── POST /api/admin/email/transport/outbox/:id/retry ────────
  app.post("/api/admin/email/transport/outbox/:id/retry", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const item = findOutboxItem(req.params.id);
    if (!item) return res.status(404).json({ error: "not_found" });

    if (confirm !== "true") {
      return res.status(409).json({
        error: "confirmation_required",
        proposedChange: { action: "retry", id: req.params.id },
      });
    }
    if (item.status !== "bounced" && item.status !== "queued") {
      return res.status(400).json({ error: "item_not_retryable", status: item.status });
    }
    item.status = "queued";
    item.error = null;
    (item as any)._nextRetryMs = 0;
    res.json({ ok: true, item });
  });

  // ── POST /api/admin/email/transport/outbox/:id/cancel ───────
  app.post("/api/admin/email/transport/outbox/:id/cancel", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const item = findOutboxItem(req.params.id);
    if (!item) return res.status(404).json({ error: "not_found" });

    if (confirm !== "true") {
      return res.status(409).json({
        error: "confirmation_required",
        proposedChange: { action: "cancel", id: req.params.id },
      });
    }
    if (item.status !== "queued") {
      return res.status(400).json({ error: "item_not_cancelable", status: item.status });
    }
    item.status = "bounced";
    item.error = "canceled_by_admin";
    res.json({ ok: true, item });
  });
}

/* ============================================================
 * Test helpers
 * ============================================================ */

export const _testEmailCampaigns = {
  reset(): void {
    campaigns.clear();
    revisions.clear();
    if (_schedulerInterval) {
      clearInterval(_schedulerInterval);
      _schedulerInterval = null;
    }
  },
  getCampaigns(): Map<string, EmailCampaign> {
    return campaigns;
  },
  getRevisions(): Map<string, EmailCampaignRevision[]> {
    return revisions;
  },
  resolveAudience,
  renderCampaignPreview,
  executeCampaignSend,
  verifyCampaignChain,
};
