/**
 * Sprint 12 — Email system (audit §5).
 * Sprint 28 Wave 7 — Production transport integration, retries, enqueueOneOff, enqueueBulk.
 *
 * 15 Handlebars templates, send queue with delivery state machine,
 * variable preview + test send + bulk + segmentation + bounced/opened/clicked stats.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { sendMail, getConfig } from "./emailTransport";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// v25.28 Phase C — outbox + delivery state persistence.
// Before v25.28 every queued/sent/opened/clicked/bounced row was lost on PM2
// restart. Each mutation now writes through the shim's `kv_emailStoreOutbox`
// table so the queue resumes mid-flight and admin retry/cancel survives boots.
import { persistEntry, hydrateEntries, softDeleteEntry } from "./lib/storePersistenceShim";
// v25.48 DATA-1 — DB-backed, admin-editable email templates. The canonical
// source of truth for templates is now the `email_templates` table; the
// in-memory `templates` array below is the SEED set used to self-seed a fresh
// or live DB (INSERT OR IGNORE by slug). `templateCache` is a boot-hydrated,
// DB-first read cache — NOT canonical state.
import { rawDb } from "./db/connection";
/* WAVE 49 · C-1 — the Outbox must be OBSERVABLE without being a credential
 * store. Wave 47 stored the rendered body on the row and `persistOutbox`
 * serialised the whole row into `kv_emailStoreOutbox.payload_json`, so raw
 * single-use `auth_redeem_tokens` links (partner invites, 14d; password resets,
 * 24h) went to disk in plaintext and `GET /api/admin/email/outbox` handed them
 * out. See `server/lib/emailTokenRedaction.ts` for the full argument. */
import { redactTokenMaterial, redactOutboxRow } from "./lib/emailTokenRedaction";

const PERSIST_STORE = "emailStoreOutbox";

/* WAVE 47 · R19 — `failed` is APPENDED at the end of the union, never inserted.
 * It is a distinct state from `bounced`, and the distinction is the honesty R6
 * asks for: `bounced` means the recipient or relay REJECTED the message (a
 * permanent, recipient-level verdict), `failed` means the attempt did not
 * complete (timeout, connection refused, auth) and says nothing about the
 * recipient. Collapsing the two would let a network outage look like a bad
 * address, and vice versa. */
export type DeliveryStatus = "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed";

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
  /* WAVE 47 · R19 — appended, optional, so every existing row and every
   * existing reader is unaffected. These three carry the provenance of a
   * TRANSACTIONAL send (an invite, a notification, a receipt) that previously
   * left no row at all: the semantic category, the id of the thing it is about,
   * and which transport mode actually carried it. No secret is among them. */
  category?: string;
  refId?: string;
  transportMode?: string;
  /* WAVE 49 · C-1 — appended LAST, optional, so every existing row and every
   * existing reader is unaffected. `true` means token material was removed from
   * this row's subject/body/variables, which has one honest consequence: the row
   * can no longer be re-sent FROM the row, because the secret it carried is gone
   * by design. `tickQueue` and `retryOutboxItem` therefore refuse it with a typed
   * reason instead of mailing the recipient a dead link. The row remains fully
   * observable — recipient, subject, template, status, attempts and timestamps
   * are all still there, which is everything R19 asked for. */
  bodyRedacted?: boolean;
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

/* v25.48 DATA-1 — DB-first template cache. Populated by hydrateEmailStore()
 * from the `email_templates` table (which is seeded from the `templates` seed
 * set on first boot). Kept in sync on every admin PUT. This is a cache only;
 * the DB row is canonical. */
const templateCache = new Map<string, EmailTemplate>();

function rowToTemplate(r: any): EmailTemplate {
  let variables: string[] = [];
  try { variables = r.variables_json ? JSON.parse(r.variables_json) : []; } catch { variables = []; }
  return {
    id: String(r.id ?? `tpl_${r.slug}`),
    slug: String(r.slug),
    subject: String(r.subject ?? ""),
    bodyHtml: String(r.body_html ?? ""),
    bodyText: String(r.body_text ?? ""),
    variables,
    category: (r.category ?? "system") as EmailTemplate["category"],
  };
}

/** v25.48 DATA-1 — seed the canonical starter templates into the DB (idempotent,
 * INSERT OR IGNORE by slug so admin edits are never clobbered) and refresh the
 * DB-first cache. Safe to call on every boot. */
function seedAndLoadTemplatesFromDb(): void {
  const db = rawDb();
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO email_templates
       (slug, id, subject, body_html, body_text, variables_json, category, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'system:seed')`,
  );
  const seedTx = db.transaction(() => {
    for (const t of templates) {
      ins.run(t.slug, t.id, t.subject, t.bodyHtml, t.bodyText, JSON.stringify(t.variables), t.category, now);
    }
  });
  seedTx();
  const rows = db.prepare(`SELECT * FROM email_templates`).all() as any[];
  templateCache.clear();
  for (const r of rows) templateCache.set(String(r.slug), rowToTemplate(r));
}

/** v25.48 DATA-1 — list every template (DB-first cache; falls back to the seed
 * set only if the cache is empty, e.g. before hydrate). */
export function listTemplates(): EmailTemplate[] {
  if (templateCache.size > 0) return Array.from(templateCache.values());
  return templates.slice();
}

/** v25.48 DATA-1 — admin upsert of a template. Persists to the DB (canonical)
 * then refreshes the cache. Returns the persisted template. */
export function upsertTemplate(
  slug: string,
  patch: { subject?: string; bodyHtml?: string; bodyText?: string; variables?: string[]; category?: string },
  updatedBy?: string,
): EmailTemplate | null {
  const existing = findTemplate(slug);
  if (!existing) return null;
  const merged: EmailTemplate = {
    ...existing,
    subject: patch.subject ?? existing.subject,
    bodyHtml: patch.bodyHtml ?? existing.bodyHtml,
    bodyText: patch.bodyText ?? existing.bodyText,
    variables: Array.isArray(patch.variables) ? patch.variables : existing.variables,
    category: (patch.category as EmailTemplate["category"]) ?? existing.category,
  };
  const db = rawDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO email_templates
       (slug, id, subject, body_html, body_text, variables_json, category, updated_at, updated_by)
       VALUES (@slug, @id, @subject, @bodyHtml, @bodyText, @variables, @category, @now, @by)
     ON CONFLICT(slug) DO UPDATE SET
       subject=excluded.subject, body_html=excluded.body_html, body_text=excluded.body_text,
       variables_json=excluded.variables_json, category=excluded.category,
       updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
  ).run({
    slug: merged.slug, id: merged.id, subject: merged.subject, bodyHtml: merged.bodyHtml,
    bodyText: merged.bodyText, variables: JSON.stringify(merged.variables), category: merged.category,
    now, by: updatedBy ?? "admin",
  });
  templateCache.set(merged.slug, merged);
  return merged;
}

/** v25.28 Phase C — persist a single outbox row. Non-fatal: shim returns false
 * on DB failure; we keep the in-memory copy so the queue keeps moving forward,
 * and the next successful write will pick it up. */
function persistOutbox(e: OutboxEmail): void {
  /* WAVE 49 · C-1 — THE persistence chokepoint. Every enqueue path in this file
   * (template, transactional, one-off, bulk) and every state transition ends
   * here, so scrubbing HERE means no future caller can put a raw token on disk
   * by forgetting to scrub at its own site. This is deliberately belt-and-braces
   * with `enqueueTransactional`, which scrubs the in-memory row as well so the
   * API response is clean too. */
  try { persistEntry(PERSIST_STORE, e.id, redactOutboxRow(e)); } catch { /* non-fatal */ }
}

/* WAVE 49 · C-1 — the read-side projection. `GET /api/admin/email/outbox` and
 * `GET /api/admin/email/transport/outbox` returned the raw `OutboxEmail`
 * objects, which is the second half of the account-takeover vector: an admin did
 * not need the DB file, the API handed the reset link over. Rows are projected
 * through the same redactor the persistence path uses, so the response and the
 * durable row agree, field for field. */
export function projectOutboxForResponse(rows: OutboxEmail[]): OutboxEmail[] {
  return rows.map((r) => redactOutboxRow(r));
}

/** Naive Handlebars-style {{var}} substitution. */
export function renderTemplate(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    return key in vars ? String(vars[key]) : `{{${key}}}`;
  });
}

export function findTemplate(slug: string): EmailTemplate | null {
  // v25.48 DATA-1 — DB-first: prefer the hydrated cache (canonical DB rows).
  // Fall back to the seed set only before hydrate has run (early boot / tests
  // that never touch the DB), preserving byte-for-byte legacy behavior there.
  const cached = templateCache.get(slug);
  if (cached) return cached;
  if (templateCache.size > 0) return null;
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

/* ============================================================
 * WAVE 47 · R19 — TRANSACTIONAL SENDS, RECORDED IN *THIS* OUTBOX.
 *
 * The defect this fixes: `server/lib/emailSender.ts` — the chokepoint for every
 * invite, notification and receipt — dispatched straight to nodemailer and
 * never touched this table. That is why Queued/Delivered/Bounced/Sent all read
 * 0 while 30 partners were approved. So the fix POPULATES this outbox rather
 * than adding a second one: same array, same `persistEntry` shim, same
 * `kv_emailStoreOutbox` table, same admin reads, same retry/cancel actions.
 *
 * The pair below is deliberately TWO calls, not one:
 *   1. `enqueueTransactional` writes a `queued` row BEFORE the transport is
 *      touched, so a send that throws, hangs or crashes the process mid-flight
 *      still leaves a durable trace;
 *   2. `recordTransactionalOutcome` records what actually happened.
 * A single "log it afterwards" call would lose exactly the sends that matter.
 * ============================================================ */

/* Ids of transactional rows `sendEmail` is dispatching right now. The queue
 * worker must not also pick them up — that would send the same message twice.
 * Process-local and NEVER persisted: a crash mid-send must leave the row
 * visible to the worker again, not permanently claimed by a dead process. */
const transactionalInFlight = new Set<string>();

export function enqueueTransactional(args: {
  to: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  category?: string;
  refId?: string;
  recipientUserId?: string;
}): OutboxEmail {
  /* ============================================================
   * WAVE 49 · C-1 — RENDER AT DISPATCH, NEVER STORE THE SECRET.
   *
   * `sendEmail` hands the RAW body to the transport from its OWN local `msg`
   * variable; it never reads the body back off this row. So the row does not
   * need the secret at all, and the fix is to scrub before the row is even
   * constructed — the raw token then exists only in the caller's stack frame for
   * the duration of the dispatch and is never written to RAM-durable state, disk
   * or an API response.
   *
   * R19's purpose is fully preserved: recipient, subject, template/category,
   * status, attempt count, queuedAt, sentAt and deliveredAt are all recorded, so
   * the row still proves a send happened and says what happened to it. What is
   * removed is only the part that could be REPLAYED.
   * ============================================================ */
  const safeSubject = redactTokenMaterial(args.subject);
  const safeBodyHtml = redactTokenMaterial(args.bodyHtml);
  const safeBodyText = redactTokenMaterial(args.bodyText ?? null);
  const redacted =
    safeSubject !== args.subject ||
    safeBodyHtml !== args.bodyHtml ||
    safeBodyText !== (args.bodyText ?? null);
  const e: OutboxEmail = {
    id: `email_${randomBytes(6).toString("hex")}`,
    /* The category doubles as the template slug so the admin Outbox tab's
     * Template column shows something true ("partner_welcome") rather than a
     * placeholder. These sends render their own body; they do not go through
     * `findTemplate`, and inventing a template row for them would be a lie of a
     * different kind. */
    templateSlug: args.category ?? "transactional",
    recipient: args.to,
    recipientUserId: args.recipientUserId ?? "u_system_email",
    variables: {},
    subject: safeSubject,
    bodyHtmlRendered: safeBodyHtml,
    bodyText: safeBodyText,
    status: "queued",
    attempts: 0,
    queuedAt: new Date().toISOString(),
    sentAt: null,
    deliveredAt: null,
    openedAt: null,
    clickedAt: null,
    bouncedAt: null,
    error: null,
    category: args.category,
    refId: args.refId,
    ...(redacted ? { bodyRedacted: true } : {}),
  };
  outbox.push(e);
  transactionalInFlight.add(e.id);
  persistOutbox(e);
  return e;
}

export function recordTransactionalOutcome(
  id: string,
  outcome: { accepted: boolean; mode: string; error?: string | null; permanent?: boolean },
): OutboxEmail | null {
  const e = outbox.find((x) => x.id === id);
  transactionalInFlight.delete(id);
  if (!e) return null;
  const now = new Date().toISOString();
  e.attempts++;
  e.transportMode = outcome.mode;
  if (outcome.accepted) {
    /* R6 — `sent`, NOT `delivered`. Acceptance proves the transport took the
     * message; it proves nothing about the mailbox. `deliveredAt` stays null
     * until something that can actually observe delivery (a provider webhook)
     * says otherwise. */
    e.status = "sent";
    e.sentAt = now;
    e.error = null;
  } else {
    /* WAVE 49 · C-1 — the transport error string is durable and is returned to
     * the admin. A relay that echoes the message, or a caller that puts the URL
     * into its own error, would otherwise reintroduce the token here. */
    e.error = redactTokenMaterial(outcome.error ?? "send_failed");
    if (outcome.permanent) {
      e.status = "bounced";
      e.bouncedAt = now;
    } else {
      e.status = "failed";
    }
    /* A row that did not go must not carry a send/delivery timestamp. */
    e.sentAt = null;
    e.deliveredAt = null;
  }
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
    /* WAVE 47 · R19 — skip rows `sendEmail` is dispatching right now. Without
     * this the worker would re-send a transactional message that is already in
     * flight and the recipient would get it twice. */
    if (transactionalInFlight.has(e.id)) continue;
    /* WAVE 49 · C-1 — a row whose body was scrubbed of token material cannot be
     * re-sent FROM the row: the secret is gone by design, so sending it would
     * mail the recipient a `[REDACTED:TOKEN]` link. Refuse LOUDLY — the row is
     * marked `failed` with a typed reason so an operator sees it and re-triggers
     * the originating action (which mints a fresh token), instead of a recipient
     * silently receiving a dead link. This branch only ever fires for rows that
     * actually carried a token; ordinary queued rows tick exactly as before. */
    if (e.bodyRedacted) {
      e.status = "failed";
      e.error = "token_bearing_body_not_resendable_reissue_required";
      e.sentAt = null;
      e.deliveredAt = null;
      persistOutbox(e);
      continue;
    }

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
      /* WAVE 47 · R19/R6 — the two lines below used to run UNCONDITIONALLY, so
       * every accepted message immediately claimed `delivered`, including over
       * real SMTP where acceptance by a relay is NOT delivery to a mailbox.
       * They are now limited to the two modes where "delivered" is literally
       * true because the message was never handed to a network: `console`
       * writes it to stdout and `dry_run` discards it — in both cases the
       * destination IS this process. For real `smtp` the row stops at `sent`
       * and `deliveredAt` stays null until something that can observe delivery
       * says otherwise. This boundary is argued, not silent: the two
       * pre-existing sprint28 campaign tests that assert `delivered` after a
       * tick run in console mode and still pass, unchanged. */
      const observedMode = (() => {
        try {
          return String(getConfig().mode);
        } catch {
          return "smtp";
        }
      })();
      if (observedMode === "console" || observedMode === "dry_run") {
        e.status = "delivered";
        e.deliveredAt = now;
      }
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
  /* WAVE 47 · R19 — `failed` appended to the retryable set. The route above is
   * labelled "Outbox retry (bounced or failed items)", but `failed` did not
   * exist as a status until this wave, so a transient failure would have been
   * un-retryable — the admin's only recovery for a timeout would have been to
   * re-trigger the whole originating action. */
  if (e.status !== "bounced" && e.status !== "queued" && e.status !== "failed") return null;
  /* WAVE 49 · C-1 — see `tickQueue`. Re-queuing a scrubbed token-bearing row
   * would send a dead link, so it is refused here too and the caller surfaces
   * `item_not_retryable` rather than reporting a retry that cannot work. */
  if (e.bodyRedacted) return null;
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
  // v25.48 DATA-1 — seed + load the DB-backed email_templates first so the
  // template cache is DB-first and restart-safe. Non-fatal on DB error: the
  // seed set remains the fallback.
  try {
    seedAndLoadTemplatesFromDb();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[emailStore.hydrateEmailStore] template seed/load failed:", (err as Error).message);
  }
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
    // v25.48 DATA-1 — DB-first list (canonical email_templates rows).
    const list = listTemplates();
    res.json({ count: list.length, templates: list });
  });
  app.get("/api/admin/email/templates/:slug", (req: Request, res: Response) => {
    const t = findTemplate(req.params.slug);
    if (!t) return res.status(404).json({ error: "not_found" });
    res.json(t);
  });
  // v25.48 DATA-1 — admin edit (persist to DB, canonical). Under the blanket
  // /api/admin requireAdmin guard (routes.ts). Slug is immutable (PK); only the
  // editable content fields are updated.
  app.put("/api/admin/email/templates/:slug", (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const { subject, bodyHtml, bodyText, variables, category } = req.body ?? {};
    const ctx = (req as unknown as { userContext?: { userId?: string } }).userContext;
    const updatedBy = ctx?.userId ?? "admin";
    const updated = upsertTemplate(slug, { subject, bodyHtml, bodyText, variables, category }, updatedBy);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
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
    /* WAVE 49 · C-1 — projected. A template variable (`cta_url`, `edit_link`) is
     * a perfectly ordinary place for a caller to put a redemption link, so the
     * echo of a test-send is scrubbed on the same rule as every other read. */
    res.json(projectOutboxForResponse([e])[0]);
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
      /* WAVE 47 · R19 — appended LAST, after `bounced`, so no existing key moves.
       * The admin Outbox tab can now show attempts that never completed instead
       * of leaving them out of every total. */
      failed: outbox.filter(e => e.status === "failed").length,
    };
    /* WAVE 49 · C-1 — projected, never raw. Before this the handler returned the
     * `OutboxEmail` objects verbatim, which meant an admin could read any user's
     * live password-reset link straight out of this response. */
    res.json({ ...stats, items: projectOutboxForResponse(items.slice(-200)) });
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
    // WAVE 49 · C-1 — projected, never raw (see GET /api/admin/email/outbox).
    res.json({ ok: true, item: projectOutboxForResponse([result])[0] });
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
    // WAVE 49 · C-1 — projected, never raw (see GET /api/admin/email/outbox).
    res.json({ ok: true, item: projectOutboxForResponse([result])[0] });
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

export function countOutboxByStatus(): {
  queued: number;
  sent: number;
  delivered: number;
  bounced: number;
  /* WAVE 47 · R19 — appended last. A failed send counted nowhere is a failed
   * send nobody fixes; the admin Outbox tab now has a number for it. */
  failed: number;
} {
  return {
    queued: outbox.filter((e) => e.status === "queued").length,
    sent: outbox.filter((e) => e.status === "sent").length,
    delivered: outbox.filter((e) => e.status === "delivered").length,
    bounced: outbox.filter((e) => e.status === "bounced").length,
    failed: outbox.filter((e) => e.status === "failed").length,
  };
}
