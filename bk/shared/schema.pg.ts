/**
 * shared/schema.pg.ts — Postgres mirror of shared/schema.ts
 *
 * This schema MIRRORS shared/schema.ts for Postgres deployment.
 * The active schema is still shared/schema.ts (SQLite).
 * This file is the v23.5 migration target.
 *
 * MAPPING RULES applied from schema.ts → schema.pg.ts:
 *   sqliteTable          → pgTable  (from drizzle-orm/pg-core)
 *   text(col)            → text(col)       (unbounded TEXT — same semantics)
 *   integer(col)         → integer(col)    (32-bit signed; fine for counters/booleans)
 *   real(col)            → doublePrecision(col)
 *   integer({mode:"boolean"}) → integer(col) (stored as 0/1, mirrors SQLite storage)
 *   timestamp-as-text    → text(col)       (ISO-8601 strings round-trip cleanly;
 *                                           NO native pg timestamp to avoid TZ issues)
 *
 * All table names, column names, foreign-key semantics, and export
 * identifiers are preserved verbatim so consuming code can swap import
 * paths via a build flag without any rename changes.
 *
 * DO NOT add Postgres-specific constraints (e.g. ENUM types, array columns)
 * here — keep this file a structural mirror only. Extension columns are
 * added per-table in migration patches.
 */

import {
  pgTable,
  text,
  integer,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ----- identity & tenancy ----- */

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  billingEmail: text("billing_email"),
  status: text("status").notNull().default("active"),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  avatarUrl: text("avatar_url"),
  isDemo: integer("is_demo").notNull().default(0),
  deletedAt: text("deleted_at"),
  deletionRequestedAt: text("deletion_requested_at"),
  deletionToken: text("deletion_token"),
  anonymizedAt: text("anonymized_at"),
  anonymizedByUserId: text("anonymized_by_user_id"),
  title: text("title"),
  displayName: text("display_name"),
});

export const userPrefs = pgTable("user_prefs", {
  userId: text("user_id").primaryKey(),
  activeTenantId: text("active_tenant_id"),
  updatedAt: text("updated_at"),
});

/* ----- companies ----- */

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  sector: text("sector"),
  stage: text("stage"),
  hq: text("hq"),
  websiteUrl: text("website_url"),
  description: text("description"),
  logoUrl: text("logo_url"),
  founded: text("founded"),
  employees: integer("employees"),
  isDemo: integer("is_demo").notNull().default(0),
  deletedAt: text("deleted_at"),
});

export const companyMembers = pgTable("company_members", {
  id: text("id").primaryKey(),
  companyId: text("company_id"),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  title: text("title"),
  tenantId: text("tenant_id"),
  consortiumPartnerId: text("consortium_partner_id"),
  isActive: integer("is_active").notNull().default(1),
  joinedAt: text("joined_at"),
  lastActiveAt: text("last_active_at"),
  deletedAt: text("deleted_at"),
});

/* ----- cap table ----- */

export const securities = pgTable("securities", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  holderName: text("holder_name").notNull(),
  holderType: text("holder_type").notNull(),
  instrument: text("instrument").notNull(),
  series: text("series"),
  shares: integer("shares").notNull().default(0),
  pricePerShare: doublePrecision("price_per_share"),
  investmentAmount: doublePrecision("investment_amount"),
  cap: doublePrecision("cap"),
  discount: doublePrecision("discount"),
  issuedAt: text("issued_at"),
  sharesStr: text("shares_str").notNull().default("0"),
  amountMinor: integer("amount_minor").notNull().default(0),
  deletedAt: text("deleted_at"),
});

/* ----- rounds ----- */

export const rounds = pgTable("rounds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  state: text("state").notNull(),
  targetAmount: doublePrecision("target_amount").notNull(),
  raisedAmount: doublePrecision("raised_amount").notNull().default(0),
  preMoney: doublePrecision("pre_money"),
  postMoney: doublePrecision("post_money"),
  pricePerShare: doublePrecision("price_per_share"),
  minTicket: doublePrecision("min_ticket"),
  closeDate: text("close_date"),
  termsSummary: text("terms_summary"),
  leadInvestor: text("lead_investor"),
  currency: text("currency"),
  region: text("region"),
  openDate: text("open_date"),
  instrument: text("instrument"),
  extrasJson: text("extras_json"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  createdBy: text("created_by"),
  deletedAt: text("deleted_at"),
});

/* ----- reports ----- */

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  period: text("period"),
  status: text("status").notNull().default("draft"),
  contentJson: text("content_json").notNull(),
  deliveryTargetsJson: text("delivery_targets_json"),
  generatedAt: text("generated_at"),
  generatedBy: text("generated_by"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/* ----- network posts ----- */

export const networkPosts = pgTable("network_posts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  audience: text("audience").notNull().default("all"),
  body: text("body").notNull(),
  contentJson: text("content_json"),
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  parentPostId: text("parent_post_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const roundInvitations = pgTable("round_invitations", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  investorEmail: text("investor_email").notNull(),
  investorName: text("investor_name"),
  state: text("state").notNull(),
  expiresAt: text("expires_at"),
  sentAt: text("sent_at"),
  viewedAt: text("viewed_at"),
});

export const softCircles = pgTable("soft_circles", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  invitationId: text("invitation_id"),
  investorName: text("investor_name").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  chapterId: text("chapter_id"),
});

/* ----- dataroom ----- */

export const dataroomFiles = pgTable("dataroom_files", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  tenantId: text("tenant_id").notNull().default("tenant_unknown"),
  folderId: text("folder_id").notNull().default(""),
  category: text("category").notNull(),
  name: text("name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mime: text("mime").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by"),
  uploadedById: text("uploaded_by_id"),
  sha256: text("sha256").notNull().default(""),
  watermark: integer("watermark").notNull().default(0),
  deletedAt: text("deleted_at"),
});

/* ----- audit log ----- */

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  target: text("target"),
  targetId: text("target_id"),
  payloadJson: text("payload_json"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- sessions ----- */

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  revoked: integer("revoked").notNull().default(0),
});

/* ----- subscriptions ----- */

export const subscriptions = pgTable("subscriptions", {
  companyId: text("company_id").primaryKey(),
  status: text("status").notNull(),
  plan: text("plan").notNull(),
  annualAmountMinor: integer("annual_amount_minor").notNull(),
  currency: text("currency").notNull(),
  renewsOn: text("renews_on").notNull(),
  cardLast4: text("card_last4"),
  invoicesCount: integer("invoices_count").notNull().default(0),
  pastDueMinor: integer("past_due_minor"),
  trialEndsOn: text("trial_ends_on"),
  version: integer("version").notNull().default(1),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: text("deleted_at"),
});

export const subscriptionsHistory = pgTable("subscriptions_history", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  version: integer("version").notNull(),
  revisionHash: text("revision_hash").notNull(),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  recordedAt: text("recorded_at").notNull(),
  recordedBy: text("recorded_by").notNull(),
});

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  tenantId: text("tenant_id").notNull().default("tenant_unknown"),
  companyId: text("company_id").notNull(),
  subscriptionId: text("subscription_id").notNull().default(""),
  planLabel: text("plan_label").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  status: text("status").notNull(),
  paymentEntryId: text("payment_entry_id"),
  relatedInvoiceId: text("related_invoice_id"),
  issuedAt: text("issued_at").notNull(),
  paidAt: text("paid_at"),
  refundedAt: text("refunded_at"),
  voidedAt: text("voided_at"),
  cardLast4: text("card_last_4"),
  lineItemsJson: text("line_items_json"),
  version: integer("version").notNull().default(1),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
  updatedAt: text("updated_at"),
  updatedBy: text("updated_by"),
  deletedAt: text("deleted_at"),
});

export const pricingModels = pgTable("pricing_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  basePriceMinor: integer("base_price_minor").notNull(),
  currency: text("currency").notNull(),
  billingCycle: text("billing_cycle").notNull(),
  featuresJson: text("features_json"),
  regionalMultipliersJson: text("regional_multipliers_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
});

export const regionExtensions = pgTable("region_extensions", {
  id: text("id").primaryKey(),
  regionCode: text("region_code").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  pricingMultiplier: doublePrecision("pricing_multiplier").notNull().default(1.0),
  currencyOverride: text("currency_override"),
  configJson: text("config_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  revisionHash: text("revision_hash").notNull(),
});

export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name"),
  email: text("email"),
  phone: text("phone"),
  region: text("region"),
  status: text("status").notNull().default("active"),
  verification: text("verification").notNull().default("unverified"),
  metadataJson: text("metadata_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
});

export const notificationCampaigns = pgTable("notification_campaigns", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  audienceType: text("audience_type").notNull(),
  status: text("status").notNull(),
  contentJson: text("content_json"),
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  recipientCount: integer("recipient_count"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const emailCampaigns = pgTable("email_campaigns", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  audienceType: text("audience_type").notNull(),
  status: text("status").notNull(),
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  recipientCount: integer("recipient_count"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const outboxEmails = pgTable("outbox_emails", {
  id: text("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
  errorMessage: text("error_message"),
  campaignId: text("campaign_id"),
});

export const bridgeOutbox = pgTable("bridge_outbox", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateKind: text("aggregate_kind").notNull(),
  envelopeJson: text("envelope_json").notNull(),
  hmac: text("hmac").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: integer("next_retry_at"),
  enqueuedAt: text("enqueued_at").notNull(),
  deliveredAt: text("delivered_at"),
  lastError: text("last_error"),
});

export const syncInbox = pgTable("sync_inbox", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  envelopeJson: text("envelope_json").notNull(),
  status: text("status").notNull().default("pending"),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  handler: text("handler"),
});

export const syncInboxState = pgTable("sync_inbox_state", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull().default(0),
  prevHash: text("prev_hash").notNull().default("0".repeat(64)),
  hash: text("hash").notNull().default("0".repeat(64)),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const formulas = pgTable("formulas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull().default("draft"),
  version: text("version").notNull(),
  sourceCode: text("source_code"),
  citationSource: text("citation_source"),
  citationUrl: text("citation_url"),
  defHash: text("def_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  isBuiltIn: integer("is_built_in").notNull().default(0),
});

/* ----- user credentials ----- */

export const userCredentials = pgTable("user_credentials", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/* ----- company profile extended ----- */

export const companyProfileExtended = pgTable("company_profile_extended", {
  companyId: text("company_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  profileJson: text("profile_json").notNull(),
  version: integer("version").notNull().default(1),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- reconciliation runs ----- */

export const reconRuns = pgTable("recon_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  roundId: text("round_id").notNull(),
  ts: text("ts").notNull(),
  engineMainJson: text("engine_main_json").notNull(),
  engineRefJson: text("engine_ref_json").notNull(),
  diffJson: text("diff_json").notNull(),
  actor: text("actor").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- founder tiers ----- */

export const founderTiers = pgTable("founder_tiers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  usdMonthly: integer("usd_monthly").notNull(),
  featuresJson: text("features_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
  deletedAt: text("deleted_at"),
  billingCycle: text("billing_cycle"),
  annualPriceCents: integer("annual_price_cents"),
});

/* ----- legal consents ----- */

export const legalConsents = pgTable("legal_consents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  documentId: text("document_id").notNull(),
  documentVersion: text("document_version").notNull(),
  context: text("context").notNull(),
  acceptedAt: text("accepted_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- dataroom folders / permissions / events ----- */

export const dataroomFolders = pgTable("dataroom_folders", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  isRoundFolder: integer("is_round_folder").notNull().default(0),
  roundId: text("round_id"),
  deletedAt: text("deleted_at"),
});

export const dataroomPermissions = pgTable("dataroom_permissions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  investorId: text("investor_id").notNull(),
  folderId: text("folder_id").notNull(),
  view: integer("view").notNull().default(0),
  download: integer("download").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const dataroomEvents = pgTable("dataroom_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  ts: text("ts").notNull(),
  actor: text("actor").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  metaJson: text("meta_json"),
});

/* ----- captable commits / funded queue / term sheet revisions ----- */

export const captableCommits = pgTable("captable_commits", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  seq: integer("seq").notNull(),
  ts: text("ts").notNull(),
  invitationId: text("invitation_id").notNull(),
  roundId: text("round_id").notNull(),
  companyId: text("company_id").notNull(),
  investorId: text("investor_id").notNull(),
  amount: text("amount").notNull(),
  currency: text("currency").notNull(),
  shares: text("shares").notNull(),
  state: text("state").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  reconcilePrimary: text("reconcile_primary"),
  reconcileRef: text("reconcile_ref"),
  reconcileMatch: integer("reconcile_match").notNull().default(1),
  complianceHold: integer("compliance_hold").notNull().default(0),
  deletedAt: text("deleted_at"),
});

export const fundedQueue = pgTable("funded_queue", {
  invitationId: text("invitation_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  roundId: text("round_id").notNull(),
  companyId: text("company_id").notNull(),
  investorId: text("investor_id").notNull(),
  amount: text("amount").notNull(),
  currency: text("currency").notNull(),
  shares: text("shares").notNull(),
  enqueuedAt: text("enqueued_at").notNull(),
});

export const termSheetRevisions = pgTable("term_sheet_revisions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  roundId: text("round_id").notNull(),
  companyId: text("company_id").notNull(),
  revision: integer("revision").notNull(),
  savedAt: text("saved_at").notNull(),
  savedBy: text("saved_by").notNull(),
  payloadJson: text("payload_json").notNull(),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
});

export const invoiceYearCounter = pgTable("invoice_year_counter", {
  year: integer("year").primaryKey(),
  count: integer("count").notNull().default(0),
});

export const contactRevisions = pgTable("contact_revisions", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  version: integer("version").notNull(),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  action: text("action").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
});

/* ----- CRM stores ----- */

export const founderCrmContacts = pgTable("founder_crm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  investorId: text("investor_id"),
  name: text("name").notNull(),
  firmName: text("firm_name"),
  role: text("role"),
  email: text("email"),
  region: text("region"),
  stage: text("stage").notNull(),
  ownership: text("ownership"),
  softCircleHistory: text("soft_circle_history"),
  tasks: text("tasks"),
  threadIds: text("thread_ids"),
  maSignals: integer("ma_signals").notNull().default(0),
  notes: text("notes"),
  notesUpdatedAt: text("notes_updated_at"),
  series: text("series"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const investorCrmContacts = pgTable("investor_crm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  investorId: text("investor_id").notNull(),
  platformUserId: text("platform_user_id"),
  name: text("name").notNull(),
  role: text("role"),
  email: text("email"),
  affiliation: text("affiliation"),
  stage: text("stage").notNull(),
  tags: text("tags"),
  notes: text("notes"),
  noteLog: text("note_log"),
  tasks: text("tasks"),
  starred: integer("starred").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  companyId: text("company_id"),
  companyName: text("company_name"),
  founderName: text("founder_name"),
  founderEmail: text("founder_email"),
  sector: text("sector"),
  region: text("region"),
  checkSizeUsd: integer("check_size_usd"),
  notesUpdatedAt: text("notes_updated_at"),
  deletedAt: text("deleted_at"),
});

export const pcrmContacts = pgTable("pcrm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  firm: text("firm"),
  email: text("email"),
  linkedin: text("linkedin"),
  pipelineStage: text("pipeline_stage").notNull(),
  tags: text("tags"),
  lanes: text("lanes"),
  companyId: text("company_id"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const pcrmNotes = pgTable("pcrm_notes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  contactId: text("contact_id").notNull(),
  body: text("body").notNull(),
  noteType: text("note_type").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const pcrmTasks = pgTable("pcrm_tasks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  contactId: text("contact_id").notNull(),
  title: text("title").notNull(),
  dueDate: text("due_date"),
  priority: text("priority").notNull(),
  status: text("status").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- collective waitlist + DSC ----- */

export const collectiveWaitlist = pgTable("collective_waitlist", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  kind: text("kind").notNull(),
  userId: text("user_id").notNull(),
  companyId: text("company_id"),
  payload: text("payload").notNull(),
  chapterHint: text("chapter_hint"),
  status: text("status").notNull().default("waitlist"),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  deletedAt: text("deleted_at"),
  chapterId: text("chapter_id"),
});

export const dscFeedback = pgTable("dsc_feedback", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  submitterUserId: text("submitter_user_id").notNull(),
  tier: text("tier").notNull(),
  scoreJson: text("score_json"),
  notes: text("notes"),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
  chapterId: text("chapter_id"),
});

export const dscVotes = pgTable("dsc_votes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  roundId: text("round_id"),
  voterUserId: text("voter_user_id").notNull(),
  vote: text("vote").notNull(),
  conditions: text("conditions"),
  notes: text("notes"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  castAt: text("cast_at").notNull(),
  supersededAt: text("superseded_at"),
  deletedAt: text("deleted_at"),
  chapterId: text("chapter_id"),
});

/* ----- chapters + memberships ----- */

export const chapters = pgTable("chapters", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  city: text("city"),
  status: text("status").notNull().default("active"),
  adminUserId: text("admin_user_id"),
  partnerOrgId: text("partner_org_id"),
  membershipFeeAnnualMinor: integer("membership_fee_annual_minor").default(0),
  dscQuorumPct: integer("dsc_quorum_pct").notNull().default(50),
  founded: text("founded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const chapterMemberships = pgTable("chapter_memberships", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("active"),
  joinedAt: text("joined_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/* ----- collective v17 Phase B stores ----- */

export const collectiveApps = pgTable("collective_apps", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("submitted"),
  payloadJson: text("payload_json").notNull(),
  submittedAt: text("submitted_at").notNull(),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const collectiveMemberships = pgTable("collective_memberships", {
  userId: text("user_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  status: text("status").notNull().default("active"),
  tier: text("tier").notNull().default("standard"),
  activatedAt: text("activated_at").notNull(),
  activatedBy: text("activated_by").notNull(),
  deactivatedAt: text("deactivated_at"),
  deactivatedBy: text("deactivated_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const founderCollectiveNominations = pgTable("founder_collective_nominations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  companyId: text("company_id").notNull(),
  founderId: text("founder_id").notNull(),
  vouchingInvestorId: text("vouching_investor_id").notNull(),
  pitchSummary: text("pitch_summary").notNull(),
  deckLink: text("deck_link"),
  supplementaryNotes: text("supplementary_notes"),
  asks: text("asks"),
  status: text("status").notNull().default("pending_vouch"),
  submittedAt: text("submitted_at").notNull(),
  vouchedAt: text("vouched_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const founderCollectiveApplications = pgTable("founder_collective_applications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  companyId: text("company_id").notNull(),
  founderId: text("founder_id").notNull(),
  pitchDeckFilename: text("pitch_deck_filename").notNull(),
  tractionMrr: integer("traction_mrr").notNull().default(0),
  tractionUsers: integer("traction_users").notNull().default(0),
  tractionGrowthPct: integer("traction_growth_pct").notNull().default(0),
  asks: text("asks").notNull(),
  referencesText: text("references_text").notNull().default(""),
  coverLetter: text("cover_letter").notNull(),
  feeAcknowledged: integer("fee_acknowledged").notNull().default(0),
  status: text("status").notNull().default("submitted"),
  submittedAt: text("submitted_at").notNull(),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const investorNominations = pgTable("investor_nominations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  investorUserId: text("investor_user_id").notNull(),
  companyId: text("company_id").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").notNull().default("pending"),
  declineReason: text("decline_reason"),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  roundId: text("round_id"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const dscRoles = pgTable("dsc_roles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("active"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  promotedBy: text("promoted_by").notNull(),
  promotedAt: text("promoted_at").notNull(),
  demotedAt: text("demoted_at"),
  demotedBy: text("demoted_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const dscPipeline = pgTable("dsc_pipeline", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  companyId: text("company_id").notNull(),
  submittedBy: text("submitted_by").notNull(),
  status: text("status").notNull().default("pending"),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const collectiveSettingsTable = pgTable("collective_settings", {
  userId: text("user_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  anonymityLevel: text("anonymity_level").notNull().default("public"),
  notifyOnDscScore: integer("notify_on_dsc_score").notNull().default(1),
  notifyOnDealRoomUpdate: integer("notify_on_deal_room_update").notNull().default(1),
  dealRoomVisibility: text("deal_room_visibility").notNull().default("visible"),
  version: integer("version").notNull().default(1),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const collectiveChannelPosts = pgTable("collective_channel_posts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  channelId: text("channel_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  authorKind: text("author_kind").notNull().default("user"),
  body: text("body").notNull(),
  visibility: text("visibility").notNull().default("public_to_collective"),
  likedByJson: text("liked_by_json").notNull().default("[]"),
  commentsJson: text("comments_json").notNull().default("[]"),
  commentCount: integer("comment_count").notNull().default(0),
  shareCount: integer("share_count").notNull().default(0),
  topicsJson: text("topics_json"),
  mediaUrlsJson: text("media_urls_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  editedAt: text("edited_at"),
  deletedAt: text("deleted_at"),
});

export const partnerDealPromotions = pgTable("partner_deal_promotions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  partnerId: text("partner_id").notNull(),
  pipelineDealId: text("pipeline_deal_id").notNull(),
  promotionType: text("promotion_type").notNull(),
  companyId: text("company_id"),
  targetEmail: text("target_email"),
  status: text("status").notNull().default("pending"),
  promotedBy: text("promoted_by").notNull(),
  promotedAt: text("promoted_at").notNull(),
  approvedAt: text("approved_at"),
  approvedBy: text("approved_by"),
  rejectedAt: text("rejected_at"),
  rejectedBy: text("rejected_by"),
  rejectedReason: text("rejected_reason"),
  withdrawnAt: text("withdrawn_at"),
  withdrawnBy: text("withdrawn_by"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  isSeed: integer("is_seed").notNull().default(0),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
  moderationStatus: text("moderation_status").notNull().default("pending"),
  moderatedByUserId: text("moderated_by_user_id"),
  moderatedAt: text("moderated_at"),
  moderationNotes: text("moderation_notes"),
});

/* ----- screening events ----- */

export const screeningEvents = pgTable("screening_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  roundId: text("round_id"),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  scheduledFor: integer("scheduled_for").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  location: text("location"),
  eventType: text("event_type").notNull().default("screening"),
  status: text("status").notNull().default("scheduled"),
  organizerUserId: text("organizer_user_id").notNull(),
  icsUid: text("ics_uid").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const screeningEventAttendees = pgTable("screening_event_attendees", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("observer"),
  rsvp: text("rsvp").notNull().default("invited"),
  attended: integer("attended").notNull().default(0),
  checkedInAt: text("checked_in_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ----- collective billing ----- */

export const collectiveMembershipsBilling = pgTable("collective_memberships_billing", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  tier: text("tier").notNull(),
  status: text("status").notNull().default("pending"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  currentPeriodStart: integer("current_period_start"),
  currentPeriodEnd: integer("current_period_end"),
  cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const collectiveBillingEvents = pgTable("collective_billing_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  billingId: text("billing_id").notNull(),
  eventType: text("event_type").notNull(),
  stripeEventId: text("stripe_event_id").notNull(),
  rawPayload: text("raw_payload").notNull(),
  processedAt: text("processed_at").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
});

/* ----- ask-an-expert ----- */

export const expertQuestions = pgTable("expert_questions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  askerUserId: text("asker_user_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tags: text("tags").notNull().default("[]"),
  status: text("status").notNull().default("open"),
  bestAnswerId: text("best_answer_id"),
  flagReason: text("flag_reason"),
  flaggedByUserId: text("flagged_by_user_id"),
  flaggedAt: text("flagged_at"),
  viewCount: integer("view_count").notNull().default(0),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const expertAnswers = pgTable("expert_answers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  questionId: text("question_id").notNull(),
  responderUserId: text("responder_user_id").notNull(),
  body: text("body").notNull(),
  upvoteCount: integer("upvote_count").notNull().default(0),
  isBestAnswer: integer("is_best_answer").notNull().default(0),
  status: text("status").notNull().default("active"),
  flagReason: text("flag_reason"),
  flaggedByUserId: text("flagged_by_user_id"),
  flaggedAt: text("flagged_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const expertVotes = pgTable("expert_votes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  answerId: text("answer_id").notNull(),
  voterUserId: text("voter_user_id").notNull(),
  voteType: text("vote_type").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const expertReputation = pgTable("expert_reputation", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  score: integer("score").notNull().default(0),
  questionsAsked: integer("questions_asked").notNull().default(0),
  answersGiven: integer("answers_given").notNull().default(0),
  bestAnswers: integer("best_answers").notNull().default(0),
  upvotesReceived: integer("upvotes_received").notNull().default(0),
  lastMilestoneNotified: integer("last_milestone_notified").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- chapter announcements / resources / leaderboard ----- */

export const chapterAnnouncements = pgTable("chapter_announcements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  pinned: integer("pinned").notNull().default(0),
  priority: text("priority").notNull().default("normal"),
  audience: text("audience").notNull().default("all"),
  expiresAt: text("expires_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const announcementReads = pgTable("announcement_reads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  announcementId: text("announcement_id").notNull(),
  userId: text("user_id").notNull(),
  readAt: text("read_at").notNull(),
});

export const chapterResources = pgTable("chapter_resources", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  uploaderUserId: text("uploader_user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  resourceType: text("resource_type").notNull().default("link"),
  url: text("url").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  tags: text("tags").notNull().default("[]"),
  visibility: text("visibility").notNull().default("members"),
  status: text("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  flagReason: text("flag_reason"),
  flaggedByUserId: text("flagged_by_user_id"),
  flaggedAt: text("flagged_at"),
  downloadCount: integer("download_count").notNull().default(0),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const chapterLeaderboardSnapshots = pgTable("chapter_leaderboard_snapshots", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  period: text("period").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  data: text("data").notNull().default("[]"),
  generatedAt: text("generated_at").notNull(),
});

/* ----- messaging ----- */

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id"),
  threadId: text("thread_id"),
  channelType: text("channel_type").notNull(),
  senderUserId: text("sender_user_id").notNull(),
  recipientUserIds: text("recipient_user_ids").notNull().default("[]"),
  subject: text("subject"),
  body: text("body").notNull(),
  attachments: text("attachments").notNull().default("[]"),
  readBy: text("read_by").notNull().default("[]"),
  status: text("status").notNull().default("sent"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const messageThreads = pgTable("message_threads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id"),
  title: text("title").notNull().default(""),
  participantUserIds: text("participant_user_ids").notNull().default("[]"),
  lastMessageId: text("last_message_id"),
  lastActivityAt: text("last_activity_at").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const messageReadReceipts = pgTable("message_read_receipts", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  userId: text("user_id").notNull(),
  readAt: text("read_at").notNull(),
});

/* ----- partner workspace ----- */

export const partnerPortfolioCompanies = pgTable("partner_portfolio_companies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  companyId: text("company_id").notNull(),
  displayName: text("display_name").notNull(),
  stage: text("stage").notNull().default("seed"),
  sector: text("sector").notNull().default(""),
  leadInvestedAmountMinor: integer("lead_invested_amount_minor").notNull().default(0),
  firstInvestedAt: text("first_invested_at"),
  notes: text("notes").notNull().default(""),
  visibility: text("visibility").notNull().default("private"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const partnerCrmContacts = pgTable("partner_crm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  contactUserId: text("contact_user_id"),
  email: text("email").notNull().default(""),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  org: text("org").notNull().default(""),
  lastContactAt: text("last_contact_at"),
  notes: text("notes").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const partnerDealPipeline = pgTable("partner_deal_pipeline", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  companyId: text("company_id").notNull(),
  stage: text("stage").notNull().default("sourced"),
  assignedUserIds: text("assigned_user_ids").notNull().default("[]"),
  targetCloseAt: text("target_close_at"),
  notes: text("notes").notNull().default(""),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  legacyId: text("legacy_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

/* ----- audit chain verifications ----- */

export const auditChainVerifications = pgTable("audit_chain_verifications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id"),
  tableName: text("table_name").notNull(),
  verifiedCount: integer("verified_count").notNull().default(0),
  brokenCount: integer("broken_count").notNull().default(0),
  brokenFirstId: text("broken_first_id"),
  totalRows: integer("total_rows").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at").notNull(),
  detailsJson: text("details_json"),
});

/* ----- SPV / fund ----- */

export const spvs = pgTable("spvs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  name: text("name").notNull(),
  leadCompanyId: text("lead_company_id"),
  structureType: text("structure_type").notNull().default("spv"),
  status: text("status").notNull().default("forming"),
  targetMinor: integer("target_minor").notNull().default(0),
  committedMinor: integer("committed_minor").notNull().default(0),
  calledMinor: integer("called_minor").notNull().default(0),
  distributedMinor: integer("distributed_minor").notNull().default(0),
  gpUserId: text("gp_user_id"),
  formedAt: text("formed_at"),
  closesAt: text("closes_at"),
  terms: text("terms").notNull().default("{}"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const spvCommitments = pgTable("spv_commitments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  lpUserId: text("lp_user_id").notNull(),
  amountMinor: integer("amount_minor").notNull().default(0),
  status: text("status").notNull().default("pending"),
  commitmentDocUrl: text("commitment_doc_url"),
  signedAt: text("signed_at"),
  fundedAt: text("funded_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const spvCapitalCalls = pgTable("spv_capital_calls", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  sequenceNo: integer("sequence_no").notNull(),
  amountMinor: integer("amount_minor").notNull().default(0),
  calledAt: text("called_at").notNull(),
  dueAt: text("due_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const spvDistributions = pgTable("spv_distributions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  distributionType: text("distribution_type").notNull().default("dividend"),
  totalMinor: integer("total_minor").notNull().default(0),
  distributedAt: text("distributed_at").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const spvPositions = pgTable("spv_positions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  securityId: text("security_id").notNull(),
  shares: text("shares").notNull().default("0"),
  basisMinor: integer("basis_minor").notNull().default(0),
  acquiredAt: text("acquired_at"),
  status: text("status").notNull().default("held"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ----- migrations applied tracker ----- */

export const migrationsApplied = pgTable("_migrations_applied", {
  key: text("key").primaryKey(),
  appliedAt: text("applied_at").notNull(),
  details: text("details").notNull().default(""),
});

/* ----- consortium applications + partner organizations ----- */

export const consortiumApplications = pgTable("consortium_applications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  expectedChapterId: text("expected_chapter_id"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  organizationName: text("organization_name").notNull(),
  website: text("website"),
  jurisdiction: text("jurisdiction").notNull().default(""),
  partnerType: text("partner_type").notNull().default("other"),
  aumRange: text("aum_range").notNull().default("undisclosed"),
  portfolioCompanyCount: integer("portfolio_company_count").notNull().default(0),
  expectedChapter: text("expected_chapter").notNull().default(""),
  introMessage: text("intro_message").notNull().default(""),
  referredBy: text("referred_by"),
  sourceIp: text("source_ip"),
  sourceUserAgent: text("source_user_agent"),
  status: text("status").notNull().default("submitted"),
  reviewedByUserId: text("reviewed_by_user_id"),
  reviewNotes: text("review_notes"),
  provisionedPartnerId: text("provisioned_partner_id"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  updatedAt: text("updated_at").notNull(),
});

export const partnerOrganizations = pgTable("partner_organizations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  jurisdiction: text("jurisdiction").notNull().default(""),
  partnerType: text("partner_type").notNull().default("other"),
  aumRange: text("aum_range").notNull().default("undisclosed"),
  primaryChapterId: text("primary_chapter_id"),
  website: text("website"),
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  status: text("status").notNull().default("active"),
  onboardingState: text("onboarding_state").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ----- GDPR/CCPA logs ----- */

export const dataExportLog = pgTable("data_export_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  exportedAt: text("exported_at").notNull(),
  format: text("format").notNull().default("json"),
  bytes: integer("bytes").notNull().default(0),
  requestIp: text("request_ip"),
  createdAt: text("created_at").notNull(),
});

export const dataDeleteLog = pgTable("data_delete_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  requestedAt: text("requested_at").notNull(),
  confirmedAt: text("confirmed_at"),
  initiatedByUserId: text("initiated_by_user_id").notNull(),
  reason: text("reason"),
  recordsRedacted: integer("records_redacted").notNull().default(0),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

/* ----- Zod insert schemas (mirrors schema.ts exports) ----- */

export const insertCompanySchema = createInsertSchema(companies).omit({ id: true });
export const insertSecuritySchema = createInsertSchema(securities).omit({ id: true });
export const insertRoundSchema = createInsertSchema(rounds).omit({ id: true });
export const insertRoundInvitationSchema = createInsertSchema(roundInvitations).omit({ id: true });
export const insertSoftCircleSchema = createInsertSchema(softCircles).omit({ id: true });
export const insertDataroomFileSchema = createInsertSchema(dataroomFiles).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true });

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companies.$inferSelect;
export type Security = typeof securities.$inferSelect;
export type Round = typeof rounds.$inferSelect;
export type RoundInvitation = typeof roundInvitations.$inferSelect;
export type SoftCircle = typeof softCircles.$inferSelect;
export type DataroomFile = typeof dataroomFiles.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
