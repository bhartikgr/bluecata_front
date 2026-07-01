/**
 * Sprint 12 — Email system (audit §5).
 * Sprint 28 Wave 7 — Production transport integration, retries, enqueueOneOff, enqueueBulk.
 *
 * 15 Handlebars templates, send queue with delivery state machine,
 * variable preview + test send + bulk + segmentation + bounced/opened/clicked stats.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { sendMail } from "./emailTransport";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// v25.28 Phase C — outbox + delivery state persistence.
// Before v25.28 every queued/sent/opened/clicked/bounced row was lost on PM2
// restart. Each mutation now writes through the shim's `kv_emailStoreOutbox`
// table so the queue resumes mid-flight and admin retry/cancel survives boots.
import { persistEntry, hydrateEntries, softDeleteEntry } from "./lib/storePersistenceShim";

const PERSIST_STORE = "emailStoreOutbox";

export type DeliveryStatus = "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained";

export interface EmailTemplate {
  id: string;
  slug: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  variables: string[];
  category: "round" | "membership" | "compliance" | "system";
}

export interface OutboxEmail {
  id: string;
  templateSlug: string;
  recipient: string;
  recipientUserId: string;
  variables: Record<string, string>;
  subject: string;
  bodyHtmlRendered: string;
  bodyText: string | null;
  status: DeliveryStatus;
  attempts: number;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  error: string | null;
  campaignId?: string;
  batchId?: string;
}

const templates: EmailTemplate[] = [
  { id: "tpl_round_invitation", slug: "round_invitation", subject: "{{founder_name}} invited you to {{company_name}}'s {{round_name}}", bodyHtml: "<p>Hi {{recipient_name}},</p><p>{{founder_name}} of {{company_name}} has invited you to participate in {{round_name}} ({{instrument}}).</p><p>{{personal_message}}</p><p><a href=\"{{cta_url}}\">View invitation</a> · expires {{expiry_date}}.</p>", bodyText: "Hi {{recipient_name}}, {{founder_name}} invited you. {{cta_url}}", variables: ["recipient_name","founder_name","company_name","round_name","instrument","personal_message","cta_url","expiry_date"], category: "round" },
  { id: "tpl_invitation_accepted", slug: "invitation_accepted", subject: "{{investor_name}} accepted the {{round_name}} invitation", bodyHtml: "<p>{{investor_name}} ({{investor_email}}) accepted {{company_name}} {{round_name}} — committed {{committed_amount}}.</p>", bodyText: "{{investor_name}} accepted.", variables: ["investor_name","investor_email","company_name","round_name","committed_amount"], category: "round" },
  { id: "tpl_invitation_declined", slug: "invitation_declined", subject: "{{investor_name}} declined the {{round_name}} invitation", bodyHtml: "<p>{{investor_name}} declined the {{round_name}} invitation. Note: {{decline_note}}</p>", bodyText: "{{investor_name}} declined.", variables: ["investor_name","company_name","round_name","decline_note"], category: "round" },
  { id: "tpl_soft_circle_submitted", slug: "soft_circle_submitted", subject: "{{investor_name}} soft-circled {{committed_amount}} {{currency}}", bodyHtml: "<p>{{investor_name}} soft-circled {{committed_amount}} {{currency}} on {{round_name}}.</p>", bodyText: "Soft circle received.", variables: ["investor_name","committed_amount","currency","round_name"], category: "round" },
  { id: "tpl_invitation_expiry_warning", slug: "invitation_expiry_warning", subject: "Reminder: {{round_name}} invitation expires {{expiry_date}}", bodyHtml: "<p>Your {{company_name}} {{round_name}} invitation expires on {{expiry_date}}. <a href=\"{{cta_url}}\">Continue</a>.</p>", bodyText: "Reminder.", variables: ["company_name","round_name","expiry_date","cta_url"], category: "round" },
  { id: "tpl_round_closed", slug: "round_closed", subject: "{{round_name}} closed at {{amount_closed}}", bodyHtml: "<p>{{company_name}} {{round_name}} ({{security_type}}) closed at {{amount_closed}}. <a href=\"{{cap_table_cta}}\">View cap table</a>.</p>", bodyText: "Round closed.", variables: ["company_name","round_name","amount_closed","security_type","cap_table_cta"], category: "round" },
  { id: "tpl_notification_digest", slug: "notification_digest", subject: "Your daily Capavate digest", bodyHtml: "<p>Hi {{recipient_name}},</p><p>{{batch_summary}}</p>", bodyText: "Daily digest.", variables: ["recipient_name","batch_summary"], category: "system" },
  { id: "tpl_collective_welcome", slug: "collective_welcome", subject: "Welcome to Capavate Collective", bodyHtml: "<p>Welcome, {{recipient_name}}. <a href=\"{{deal_room_cta}}\">Open the deal room</a>. <a href=\"{{profile_cta}}\">Complete your profile</a>. <a href=\"{{receipt_link}}\">Receipt</a>.</p>", bodyText: "Welcome.", variables: ["recipient_name","deal_room_cta","profile_cta","receipt_link"], category: "membership" },
  { id: "tpl_membership_review", slug: "membership_review", subject: "Your Capavate Collective application is under review", bodyHtml: "<p>{{recipient_name}}, your application is under review. Timeline: {{timeline}}. <a href=\"{{edit_link}}\">Edit application</a>.</p>", bodyText: "Under review.", variables: ["recipient_name","timeline","edit_link"], category: "membership" },
  { id: "tpl_membership_approved", slug: "membership_approved", subject: "Your Collective membership is approved", bodyHtml: "<p>{{recipient_name}}, your membership is approved. Next steps: {{next_steps}}.</p>", bodyText: "Approved.", variables: ["recipient_name","next_steps"], category: "membership" },
  { id: "tpl_membership_rejected", slug: "membership_rejected", subject: "Your Collective application", bodyHtml: "<p>{{recipient_name}}, application not approved at this time. Notes: {{next_steps}}.</p>", bodyText: "Rejected.", variables: ["recipient_name","next_steps"], category: "membership" },
  { id: "tpl_kyc_update", slug: "kyc_update", subject: "Your KYC status: {{new_status}}", bodyHtml: "<p>Hi {{recipient_name}}, your KYC status is now {{new_status}}. {{action_required}}</p>", bodyText: "KYC update.", variables: ["recipient_name","new_status","action_required"], category: "compliance" },
  { id: "tpl_form_d_reminder", slug: "form_d_reminder", subject: "Form D filing deadline: {{filing_deadline}}", bodyHtml: "<p>{{recipient_name}}, your Form D 15-day deadline is {{filing_deadline}}. <a href=\"{{edgar_link}}\">EDGAR portal</a>.</p>", bodyText: "Form D reminder.", variables: ["recipient_name","filing_deadline","edgar_link"], category: "compliance" },
  { id: "tpl_emi_notification_reminder", slug: "emi_notification_reminder", subject: "EMI grant: HMRC 92-day deadline", bodyHtml: "<p>{{recipient_name}}, EMI grant {{grant_date}} requires HMRC notification by {{hmrc_deadline}}. <a href=\"{{ers_url}}\">ERS online service</a>.</p>", bodyText: "EMI reminder.", variables: ["recipient_name","grant_date","hmrc_deadline","ers_url"], category: "compliance" },
  { id: "tpl_83b_election", slug: "83b_election", subject: "83(b) election due in 30 days", bodyHtml: "<p>{{recipient_name}}, an early option exercise occurred {{exercise_date}}; the 83(b) election deadline is {{deadline_date}}.</p>", bodyText: "83(b) reminder.", variables: ["recipient_name","exercise_date","deadline_date"], category: "compliance" },
  // v25.47 APD-025 — 6 new templates (21 total). Brand: Capavate.
  { id: "tpl_collective_member_subscribed", slug: "collective_member_subscribed", subject: "Your Capavate Collective membership is active", bodyHtml: "<p>Hi {{recipient_name}},</p><p>Your Collective membership ({{tier_name}}, {{amount}}/{{billing_period}}) is now active. <a href=\"{{receipt_link}}\">View receipt</a>.</p>", bodyText: "Your Collective membership ({{tier_name}}) is active.", variables: ["recipient_name","tier_name","amount","billing_period","receipt_link"], category: "membership" },
  { id: "tpl_consortium_partner_subscribed", slug: "consortium_partner_subscribed", subject: "Your Capavate Consortium partnership ({{tier_name}}) is active", bodyHtml: "<p>Hi {{recipient_name}},</p><p>Your Consortium partner subscription ({{tier_name}}, {{amount}}/{{billing_period}}) is active. <a href=\"{{receipt_link}}\">View receipt</a>.</p>", bodyText: "Your Consortium partnership ({{tier_name}}) is active.", variables: ["recipient_name","tier_name","amount","billing_period","receipt_link"], category: "membership" },
  { id: "tpl_spv_deployed", slug: "spv_deployed", subject: "SPV {{spv_id}} deployed", bodyHtml: "<p>Hi {{recipient_name}},</p><p>SPV {{spv_id}} has been deployed. Deployment fee: {{fee_amount}}. <a href=\"{{cta_url}}\">View details</a>.</p>", bodyText: "SPV {{spv_id}} deployed. Fee {{fee_amount}}.", variables: ["recipient_name","spv_id","fee_amount","cta_url"], category: "system" },
  { id: "tpl_post_flagged", slug: "post_flagged", subject: "A post was flagged for review", bodyHtml: "<p>Post {{post_id}} was flagged{{#if reason}} ({{reason}}){{/if}} by {{actor}}. <a href=\"{{cta_url}}\">Review</a>.</p>", bodyText: "Post {{post_id}} flagged by {{actor}}.", variables: ["post_id","reason","actor","cta_url"], category: "system" },
  { id: "tpl_post_hidden", slug: "post_hidden", subject: "Your post was hidden by a moderator", bodyHtml: "<p>Hi {{recipient_name}},</p><p>Your post was hidden by a moderator{{#if reason}}: {{reason}}{{/if}}. Contact support if you believe this was in error.</p>", bodyText: "Your post was hidden{{#if reason}}: {{reason}}{{/if}}.", variables: ["recipient_name","reason"], category: "system" },
  { id: "tpl_pulse_digest", slug: "pulse_digest", subject: "Your Capavate Pulse digest", bodyHtml: "<p>Hi {{recipient_name}},</p><p>{{digest_summary}}</p><p><a href=\"{{cta_url}}\">Open Pulse</a>.</p>", bodyText: "Pulse digest: {{digest_summary}}", variables: ["recipient_name","digest_summary","cta_url"], category: "system" },
];

const outbox: OutboxEmail[] = [];

/** v25.28 Phase C — persist a single outbox row. Non-fatal: shim returns false
 * on DB failure; we keep the in-memory copy so the queue keeps moving forward,
 * and the next successful write will pick it up. */
function persistOutbox(e: OutboxEmail): void {
  try { persistEntry(PERSIST_STORE, e.id, e); } catch { /* non-fatal */ }
}

/** Naive Handlebars-style {{var}} substitution. */
export function renderTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    return key in vars ? String(vars[key]) : `{{${key}}}`;
  });
}

export function findTemplate(slug: string): EmailTemplate | null {
  return templates.find(t => t.slug === slug) ?? null;
}

export function enqueueEmail(args: {
  templateSlug: string;
  recipient: string;
  recipientUserId: string;
  variables: Record<string, string>;
}): OutboxEmail {
  const t = findTemplate(args.templateSlug);
  if (!t) throw new Error(`unknown_template: ${args.templateSlug}`);
  const e: OutboxEmail = {
    id: `email_${randomBytes(6).toString("hex")}`,
    templateSlug: args.templateSlug,
    recipient: args.recipient,
    recipientUserId: args.recipientUserId,
    variables: args.variables,
    subject: renderTemplate(t.subject, args.variables),
    bodyHtmlRendered: renderTemplate(t.bodyHtml, args.variables),
    bodyText: renderTemplate(t.bodyText, args.variables),
    status: "queued",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null,
    error: null,
  };
  outbox.push(e);
  persistOutbox(e);
  return e;
}

/** Maximum retry attempts before a message is marked bounced. */
const MAX_ATTEMPTS = 5;

/** Compute exponential backoff delay in ms (capped at 5min). */
function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, Math.pow(2, attempts) * 1000);
}

/**
 * Walk queued items forward: send via emailTransport.sendMail,
 * handle retries with exponential backoff (max 5 attempts → bounced).
 */
export async function tickQueue(): Promise<void> {
  const now = new Date().toISOString();
  const nowMs = Date.now();

  for (const e of outbox) {
    if (e.status !== "queued") continue;

    // Check backoff — only attempt if past next retry window
    const nextRetryMs: number = (e as any)._nextRetryMs ?? 0;
    if (nowMs < nextRetryMs) continue;

    e.attempts++;
    const result = await sendMail({
      to: e.recipient,
      subject: e.subject,
      html: e.bodyHtmlRendered,
      text: e.bodyText ?? undefined,
      idempotencyKey: `outbox_${e.id}_attempt_${e.attempts}`,
    });

    if (result.ok) {
      e.status = "sent";
      e.sentAt = now;
      e.error = null;
      // Immediately transition to delivered for console/dry_run; real webhook would refine.
      e.status = "delivered";
      e.deliveredAt = now;
    } else if (result.error === "rate_limited") {
      // Requeue without counting as a real attempt
      e.attempts--;
      (e as any)._nextRetryMs = nowMs + 1000;
    } else {
      e.error = result.error ?? "send_failed";
      if (e.attempts >= MAX_ATTEMPTS) {
        e.status = "bounced";
        e.bouncedAt = now;
      } else {
        // Stay queued, schedule next attempt
        (e as any)._nextRetryMs = nowMs + backoffMs(e.attempts);
      }
    }
    /* v25.28 Phase C — persist after EVERY state transition (attempts++, status,
     * sentAt, deliveredAt, bouncedAt, error). On restart the queue picks up
     * exactly where it left off. */
    persistOutbox(e);
  }
}

/* ============================================================
 * enqueueOneOff — custom (non-template) one-off email
 * ============================================================ */
export function enqueueOneOff(args: {
  recipientUserId: string;
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  replyTo?: string;
  campaignId?: string;
}): { id: string } {
  const e: OutboxEmail = {
    id: `email_${randomBytes(6).toString("hex")}`,
    templateSlug: "one_off",
    recipient: args.to,
    recipientUserId: args.recipientUserId,
    variables: {},
    subject: args.subject,
    bodyHtmlRendered: args.bodyHtml,
    bodyText: args.bodyText ?? null,
    status: "queued",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    error: null,
    campaignId: args.campaignId,
  };
  outbox.push(e);
  persistOutbox(e);
  return { id: e.id };
}

/* ============================================================
 * enqueueBulk — batch send for campaign fan-out
 * ============================================================ */
export function enqueueBulk(args: {
  campaignId: string;
  items: Array<{
    to: string;
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    replyTo?: string;
    variables?: Record<string, string>;
  }>;
}): { batchId: string; queuedCount: number } {
  const batchId = `batch_${randomBytes(6).toString("hex")}`;
  for (const item of args.items) {
    const e: OutboxEmail = {
      id: `email_${randomBytes(6).toString("hex")}`,
      templateSlug: "bulk_campaign",
      recipient: item.to,
      recipientUserId: "u_campaign",
      variables: item.variables ?? {},
      subject: item.subject,
      bodyHtmlRendered: item.bodyHtml,
      bodyText: item.bodyText ?? null,
      status: "queued",
      attempts: 0,
      queuedAt: new Date().toISOString(),
      sentAt: null,
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      bouncedAt: null,
      error: null,
      campaignId: args.campaignId,
      batchId,
    };
    outbox.push(e);
    persistOutbox(e);
  }
  return { batchId, queuedCount: args.items.length };
}

/* ============================================================
 * Outbox admin helpers — retry, cancel
 * ============================================================ */
export function retryOutboxItem(id: string): OutboxEmail | null {
  const e = outbox.find(x => x.id === id);
  if (!e) return null;
  if (e.status !== "bounced" && e.status !== "queued") return null;
  // Reset to queued — keep attempts count so next tick increments correctly
  e.status = "queued";
  e.error = null;
  (e as any)._nextRetryMs = 0; // allow immediate retry on next tick
  persistOutbox(e);
  return e;
}

export function cancelOutboxItem(id: string): OutboxEmail | null {
  const e = outbox.find(x => x.id === id);
  if (!e) return null;
  if (e.status !== "queued") return null;
  e.status = "bounced"; // repurpose bounced as "canceled" equivalent at transport layer
  // We mark it with a special error so UI can show "canceled"
  e.error = "canceled_by_admin";
  persistOutbox(e);
  return e;
}

function seedDemo() {
  if (outbox.length > 0) return;
  enqueueEmail({ templateSlug: "round_invitation", recipient: "aisha@hydra.vc", recipientUserId: "u_aisha_patel", variables: { recipient_name: "Aisha", founder_name: "Maya Chen", company_name: "NovaPay AI", round_name: "Seed Extension", instrument: "SAFE", personal_message: "Strategic round; pro-rata reserved.", cta_url: "https://app.capavate.com/i/abc123", expiry_date: "2026-06-30" }});
  enqueueEmail({ templateSlug: "soft_circle_submitted", recipient: "maya@novapay.ai", recipientUserId: "u_maya", variables: { investor_name: "Aisha Patel", committed_amount: "$250,000", currency: "USD", round_name: "Seed Extension" }});
  enqueueEmail({ templateSlug: "round_closed", recipient: "team@hydra.vc", recipientUserId: "u_aisha_patel", variables: { company_name: "NovaPay AI", round_name: "Seed Extension", amount_closed: "$4.0M", security_type: "SAFE", cap_table_cta: "https://app.capavate.com/cap" }});
  enqueueEmail({ templateSlug: "collective_welcome", recipient: "aisha@hydra.vc", recipientUserId: "u_aisha_patel", variables: { recipient_name: "Aisha", deal_room_cta: "/collective/#/deals", profile_cta: "/collective/#/profile", receipt_link: "/billing/receipts/r123" }});
  enqueueEmail({ templateSlug: "kyc_update", recipient: "aisha@hydra.vc", recipientUserId: "u_aisha_patel", variables: { recipient_name: "Aisha", new_status: "verified", action_required: "" }});
  enqueueEmail({ templateSlug: "form_d_reminder", recipient: "maya@novapay.ai", recipientUserId: "u_maya", variables: { recipient_name: "Maya", filing_deadline: "2026-05-23", edgar_link: "https://efts.sec.gov" }});
  // Walk a couple forward to populate stats
  tickQueue();
  tickQueue();
  // Mark one as opened/clicked for demo
  if (outbox[0]) { outbox[0].status = "opened"; outbox[0].openedAt = new Date().toISOString(); }
  if (outbox[1]) { outbox[1].status = "clicked"; outbox[1].clickedAt = new Date().toISOString(); }
  if (outbox[5]) { outbox[5].status = "bounced"; outbox[5].bouncedAt = new Date().toISOString(); outbox[5].error = "550 mailbox not found"; }
}

// Patch v4: only seed demo emails when demo gate is on.
if (DEMO_SEED_ENABLED) {
  seedDemo();
}

/**
 * v25.28 Phase C — hydrate the outbox from durable storage on boot.
 *
 * Called from server/lib/hydrateStores.ts. If there is no DB (early boot,
 * test sandbox without DATABASE_URL) or the kv table is empty, this is a
 * no-op and the queue starts empty.
 *
 * Idempotent: skips any id already present in the in-memory `outbox` (so
 * demo seeds + hydrated rows don't collide).
 */
export function hydrateEmailStore(): void {
  try {
    const entries = hydrateEntries<OutboxEmail>(PERSIST_STORE);
    if (entries.length === 0) return;
    const seen = new Set(outbox.map((e) => e.id));
    for (const [id, row] of entries) {
      if (seen.has(id)) continue;
      outbox.push(row);
    }
  } catch (err) {
    // Non-fatal — the queue starts empty rather than crashing the boot.
    // eslint-disable-next-line no-console
    console.warn("[emailStore.hydrateEmailStore] failed:", (err as Error).message);
  }
}

export function registerEmailRoutes(app: Express): void {
  app.get("/api/admin/email/templates", (_req: Request, res: Response) => {
    res.json({ count: templates.length, templates });
  });
  app.get("/api/admin/email/templates/:slug", (req: Request, res: Response) => {
    const t = findTemplate(req.params.slug);
    if (!t) return res.status(404).json({ error: "not_found" });
    res.json(t);
  });
  app.post("/api/admin/email/preview", (req: Request, res: Response) => {
    const { slug, variables } = req.body ?? {};
    const t = findTemplate(slug);
    if (!t) return res.status(404).json({ error: "unknown_template" });
    res.json({
      subject: renderTemplate(t.subject, variables ?? {}),
      bodyHtml: renderTemplate(t.bodyHtml, variables ?? {}),
      bodyText: renderTemplate(t.bodyText, variables ?? {}),
    });
  });
  app.post("/api/admin/email/test-send", (req: Request, res: Response) => {
    const { slug, recipient, variables } = req.body ?? {};
    if (!findTemplate(slug)) return res.status(404).json({ error: "unknown_template" });
    const e = enqueueEmail({ templateSlug: slug, recipient: recipient ?? "test@capavate.com", recipientUserId: "u_admin", variables: variables ?? {} });
    res.json(e);
  });
  app.get("/api/admin/email/outbox", (req: Request, res: Response) => {
    const status = String(req.query.status ?? "");
    const items = status ? outbox.filter(e => e.status === status) : outbox;
    const stats = {
      total: outbox.length,
      queued: outbox.filter(e => e.status === "queued").length,
      sent: outbox.filter(e => e.status === "sent").length,
      delivered: outbox.filter(e => e.status === "delivered").length,
      opened: outbox.filter(e => e.status === "opened").length,
      clicked: outbox.filter(e => e.status === "clicked").length,
      bounced: outbox.filter(e => e.status === "bounced").length,
    };
    res.json({ ...stats, items: items.slice(-200) });
  });
  app.post("/api/admin/email/tick", async (_req: Request, res: Response) => {
    await tickQueue();
    res.json({ ok: true });
  });
  app.post("/api/admin/email/bulk-send", (req: Request, res: Response) => {
    const { slug, recipients, variables, segmentation } = req.body ?? {};
    const t = findTemplate(slug);
    if (!t) return res.status(404).json({ error: "unknown_template" });
    const list: { recipient: string; userId: string }[] = Array.isArray(recipients) ? recipients : [];
    const created = list.map(r => enqueueEmail({ templateSlug: slug, recipient: r.recipient, recipientUserId: r.userId, variables: variables ?? {} }));
    res.json({ ok: true, count: created.length, segmentation: segmentation ?? null });
  });

  // Outbox retry (bounced or failed items)
  app.post("/api/admin/email/outbox/:id/retry", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const item = outbox.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not_found" });
    if (confirm !== "true") {
      return res.status(409).json({ error: "confirmation_required", proposedChange: { action: "retry", id: req.params.id } });
    }
    const result = retryOutboxItem(req.params.id);
    if (!result) return res.status(400).json({ error: "item_not_retryable", status: item.status });
    res.json({ ok: true, item: result });
  });

  // Outbox cancel
  app.post("/api/admin/email/outbox/:id/cancel", (req: Request, res: Response) => {
    const confirm = req.headers["x-confirm"];
    const item = outbox.find(x => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: "not_found" });
    if (confirm !== "true") {
      return res.status(409).json({ error: "confirmation_required", proposedChange: { action: "cancel", id: req.params.id } });
    }
    const result = cancelOutboxItem(req.params.id);
    if (!result) return res.status(400).json({ error: "item_not_cancelable", status: item.status });
    res.json({ ok: true, item: result });
  });
}

export const _testEmail = { renderTemplate, findTemplate, outbox, templates, reset: () => { outbox.length = 0; } };

/* V9 (Patch v8): Public scoped readers to replace private _testEmail.outbox
 * reach-ins from emailCampaignStore and other production callers.
 */
export function listOutbox(): OutboxEmail[] {
  return outbox.slice();
}

export function findOutboxItem(id: string): OutboxEmail | null {
  return outbox.find((x) => x.id === id) ?? null;
}

export function countOutboxByStatus(): { queued: number; sent: number; delivered: number; bounced: number } {
  return {
    queued: outbox.filter((e) => e.status === "queued").length,
    sent: outbox.filter((e) => e.status === "sent").length,
    delivered: outbox.filter((e) => e.status === "delivered").length,
    bounced: outbox.filter((e) => e.status === "bounced").length,
  };
}
