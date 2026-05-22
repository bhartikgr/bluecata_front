/**
 * Capavate Sprint 1 — shared schema (Drizzle, SQLite)
 *
 * Source of truth for production schemas:
 *   - R165 §2 (Identity & Tenancy schema)
 *   - R200 §6 (Postgres + Drizzle definitions)
 *
 * This sprint-1 file uses SQLite for the preview demo and stays narrow:
 * just the entities required to render the founder + investor preview surfaces.
 * In production, this maps 1:1 to the Postgres 16 schema in R200 §6 with
 * Auth0-issued user IDs, tenant_id row-level security, and the audit-log
 * hash chain from R165 §12.
 */
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ----- identity & tenancy (R165 §2.1, extended v12) -----
 *
 * v12 tenant model (Decision A): a tenant is a company OR a
 * consortium_partner. Users have N memberships through `company_members`.
 * The legacy `kind` values "founder"|"investor" are retained for backward-
 * compat seed data; new rows use "company" or "consortium_partner".
 *
 * v12 added columns (additive only — SQLite ALTER ADD COLUMN safe):
 *   - billingEmail, status, isDemo, createdAt, updatedAt, deletedAt
 *
 * Soft-delete contract: `deleted_at IS NULL` means live; `deleted_at = <iso>`
 * means archived. Every SELECT in v12 stores filters via withTenant().
 */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // v12: now also accepts "company" | "consortium_partner" in addition to legacy "founder"|"investor"
  kind: text("kind").notNull(),
  billingEmail: text("billing_email"),
  // active | suspended | deleted (v12)
  status: text("status").notNull().default("active"),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // "founder" | "investor" | "admin"
  avatarUrl: text("avatar_url"),
  // v12 additions (additive, non-breaking):
  isDemo: integer("is_demo").notNull().default(0),
  deletedAt: text("deleted_at"),
  // CP Phase B — GDPR/CCPA (CP-013).
  deletionRequestedAt: text("deletion_requested_at"),
  deletionToken: text("deletion_token"),
  anonymizedAt: text("anonymized_at"),
  anonymizedByUserId: text("anonymized_by_user_id"),
});

/**
 * v12 — per-user preferences. Replaces the per-process
 * `USER_ACTIVE_COMPANY` Map in multiCompanyStore.
 */
export const userPrefs = sqliteTable("user_prefs", {
  userId: text("user_id").primaryKey(),
  activeTenantId: text("active_tenant_id"),
  updatedAt: text("updated_at"),
});

/* ----- companies (R200 §6) ----- */
export const companies = sqliteTable("companies", {
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
  // v12 additions (additive, non-breaking):
  isDemo: integer("is_demo").notNull().default(0),
  deletedAt: text("deleted_at"),
});

/**
 * v12 — companyMembers extended.
 *
 *  - `tenantId` is the v12 tenant scoping column.
 *  - `companyId` is NULLABLE now — only set when the tenant kind = "company".
 *  - `consortiumPartnerId` is set only when the tenant kind = "consortium_partner".
 *
 * Existing columns (id, userId, role, title) preserved verbatim.
 */
export const companyMembers = sqliteTable("company_members", {
  id: text("id").primaryKey(),
  // companyId was previously NOT NULL; v12 relaxes to nullable so a membership
  // can point at a consortium_partner tenant instead. SQLite stores everything
  // as nullable at the storage layer; the Drizzle .notNull() removal here
  // matches the v12 ALTER TABLE migration semantics.
  companyId: text("company_id"),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // founder | co_founder | board | exec | viewer | investor | partner_lead | partner_member | admin
  title: text("title"),
  // v12 additions:
  tenantId: text("tenant_id"),                       // backfilled by migration 0003
  consortiumPartnerId: text("consortium_partner_id"),
  isActive: integer("is_active").notNull().default(1),
  joinedAt: text("joined_at"),
  lastActiveAt: text("last_active_at"),
  deletedAt: text("deleted_at"),
});

/* ----- cap table (R200 §6 / Cap Table Engine §10) -----
 *
 * v12 (DB-5): the `shares` integer + `investmentAmount` real columns
 * cannot represent the BigInt-string precision the Sprint 25 cap-table
 * engine relies on. v12 adds parallel canonical columns:
 *   - `shares_str` TEXT  (string of base-10 digits, preserves precision)
 *   - `amount_minor` INTEGER (currency in minor units, e.g. cents)
 *
 * Day 2 captableCommitStore migration will write to both old and new
 * columns; v13 will deprecate the float columns.
 */
export const securities = sqliteTable("securities", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  holderName: text("holder_name").notNull(),
  holderType: text("holder_type").notNull(), // founder | employee | investor | pool
  instrument: text("instrument").notNull(), // common | preferred | safe | note | warrant | option
  series: text("series"), // e.g. "Series Seed", "Common"
  shares: integer("shares").notNull().default(0),
  pricePerShare: real("price_per_share"),
  investmentAmount: real("investment_amount"),
  cap: real("cap"),                 // SAFE/Note cap
  discount: real("discount"),       // SAFE/Note discount %
  issuedAt: text("issued_at"),
  // v12 precision additions (DB-5):
  sharesStr: text("shares_str").notNull().default("0"),
  amountMinor: integer("amount_minor").notNull().default(0),
  // v12 soft-delete (DB-2):
  deletedAt: text("deleted_at"),
});

/* ----- rounds + invitations (Investor Invitation Subsystem §9) -----
 *
 * v13 (Avi's Issue 3) — Rounds is now DB-backed via roundsStore.ts.
 * Added columns are all nullable / defaulted so existing seed/migration
 * paths keep working. The `extras_json` column holds the long tail of
 * Round-form fields (leadInvestor, useOfProceeds, tranches, scenarios,
 * coInvestors, closingChecklist, esopTiming, liquidationPreference,
 * antiDilutionType, mfn, proRata, cap, discount, etc.) so the schema
 * stays narrow while the form remains lossless.
 */
export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(), // foundation | preseed | seed | series_a | series_b | series_c
  state: text("state").notNull(), // draft | terms_set | soft_circle_open | signing_open | closed
  targetAmount: real("target_amount").notNull(),
  raisedAmount: real("raised_amount").notNull().default(0),
  preMoney: real("pre_money"),
  postMoney: real("post_money"),
  pricePerShare: real("price_per_share"),
  minTicket: real("min_ticket"),
  closeDate: text("close_date"),
  termsSummary: text("terms_summary"),
  // v13 — extended columns (additive, all nullable / defaulted).
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

/* ----- reports (Avi's Issue 4) -----
 *
 * v13 — Investor Reports persisted to DB. `contentJson` holds the full
 * sections array; `deliveryTargetsJson` holds the JSON-encoded recipient
 * array.
 */
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  kind: text("kind").notNull(), // investor_update | kpi_snapshot | monthly_kpi | quarterly_update | annual | round_close | adhoc
  title: text("title").notNull(),
  period: text("period"),
  status: text("status").notNull().default("draft"), // draft | scheduled | sent
  contentJson: text("content_json").notNull(), // sections + metricsSnapshot + schedule
  deliveryTargetsJson: text("delivery_targets_json"), // JSON string[]
  generatedAt: text("generated_at"),
  generatedBy: text("generated_by"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/* ----- network_posts (Avi's Issue 5) -----
 *
 * v13 — Network feed posts persisted to DB. The commsStore in-memory
 * `posts` Map still serves the read API; this table is the durable mirror
 * so reposts survive a server restart.
 */
export const networkPosts = sqliteTable("network_posts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  audience: text("audience").notNull().default("all"), // investors | founders | all
  body: text("body").notNull(),
  contentJson: text("content_json"), // rich media / attachments
  likes: integer("likes").notNull().default(0),
  comments: integer("comments").notNull().default(0),
  parentPostId: text("parent_post_id"), // thread support
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const roundInvitations = sqliteTable("round_invitations", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  investorEmail: text("investor_email").notNull(),
  investorName: text("investor_name"),
  state: text("state").notNull(), // pending | viewed | accepted | declined | expired | revoked
  expiresAt: text("expires_at"),
  sentAt: text("sent_at"),
  viewedAt: text("viewed_at"),
});

export const softCircles = sqliteTable("soft_circles", {
  id: text("id").primaryKey(),
  roundId: text("round_id").notNull(),
  invitationId: text("invitation_id"),
  investorName: text("investor_name").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull(), // intent | confirmed | committed | declined
  createdAt: text("created_at").notNull(),
  // v17 Phase A — chapter scoping (additive, nullable; backfilled to chap_keiretsu_canada).
  chapterId: text("chapter_id"),
});

/* ----- dataroom (§12) ----- */
export const dataroomFiles = sqliteTable("dataroom_files", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  // v12 Day 2 Wave 2 — tenantId for tenant scoping (defaulted via tenant_co_<companyId>).
  tenantId: text("tenant_id").notNull().default("tenant_unknown"),
  // v12 Day 2 Wave 2 — folderId for the dataroom folder this file lives in.
  folderId: text("folder_id").notNull().default(""),
  category: text("category").notNull(), // mgmt | product | sales | tech_it | ops | regulatory | legal | financials | press | misc | term_sheet
  name: text("name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mime: text("mime").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by"),
  // v12 Day 2 Wave 2 — file integrity + audit identity.
  uploadedById: text("uploaded_by_id"),
  sha256: text("sha256").notNull().default(""),
  watermark: integer("watermark", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
});

/* ----- audit log (R165 §12, hash chain) -----
 * v12: `deleted_at` column added for schema symmetry with the other
 * compliance tables. Updates that SET deleted_at on audit_log are FORBIDDEN —
 * the table is append-only by contract.
 */
export const auditLog = sqliteTable("audit_log", {
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
  // v12 (DB-2): symmetric soft-delete column — never used in practice (append-only).
  deletedAt: text("deleted_at"),
});

/* ----- Sprint 28: Production tables added in Pass 4 ----- */

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  role: text("role").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

export const subscriptions = sqliteTable("subscriptions", {
  companyId: text("company_id").primaryKey(),
  status: text("status").notNull(),           // active | trialing | past_due | unpaid | cancelled | pending_payment | cancel_at_period_end
  plan: text("plan").notNull(),                // founder_free | founder_pro | founder_scale | founder_enterprise
  annualAmountMinor: integer("annual_amount_minor").notNull(),
  currency: text("currency").notNull(),        // ISO 4217
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
  // v12 soft-delete (DB-2):
  deletedAt: text("deleted_at"),
});

export const subscriptionsHistory = sqliteTable("subscriptions_history", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  version: integer("version").notNull(),
  revisionHash: text("revision_hash").notNull(),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  recordedAt: text("recorded_at").notNull(),
  recordedBy: text("recorded_by").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
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
  status: text("status").notNull(),            // draft | issued | paid | refunded | void
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
  // v12 soft-delete (DB-2):
  deletedAt: text("deleted_at"),
});

export const pricingModels = sqliteTable("pricing_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull(),            // draft | active | archived
  basePriceMinor: integer("base_price_minor").notNull(),
  currency: text("currency").notNull(),
  billingCycle: text("billing_cycle").notNull(), // annual | monthly
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

export const regionExtensions = sqliteTable("region_extensions", {
  id: text("id").primaryKey(),
  regionCode: text("region_code").notNull(),
  status: text("status").notNull(),            // research | draft | review | approved | live | rejected
  title: text("title").notNull(),
  pricingMultiplier: real("pricing_multiplier").notNull().default(1.0),
  currencyOverride: text("currency_override"),
  configJson: text("config_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  version: integer("version").notNull().default(1),
  revisionHash: text("revision_hash").notNull(),
});

export const contacts = sqliteTable("contacts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),                // investor | founder | consortium_partner
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

export const notificationCampaigns = sqliteTable("notification_campaigns", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  audienceType: text("audience_type").notNull(), // all_founders | all_investors | all_consortium_partners | segment
  status: text("status").notNull(),              // draft | scheduled | sent | canceled
  contentJson: text("content_json"),
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  recipientCount: integer("recipient_count"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const emailCampaigns = sqliteTable("email_campaigns", {
  id: text("id").primaryKey(),
  subject: text("subject").notNull(),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  audienceType: text("audience_type").notNull(),
  status: text("status").notNull(),              // draft | scheduled | sent | canceled
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  scheduledAt: text("scheduled_at"),
  sentAt: text("sent_at"),
  recipientCount: integer("recipient_count"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
});

export const outboxEmails = sqliteTable("outbox_emails", {
  id: text("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body"),
  textBody: text("text_body"),
  status: text("status").notNull().default("queued"), // queued | sent | failed
  attempts: integer("attempts").notNull().default(0),
  idempotencyKey: text("idempotency_key"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
  errorMessage: text("error_message"),
  campaignId: text("campaign_id"),
});

export const bridgeOutbox = sqliteTable("bridge_outbox", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  aggregateKind: text("aggregate_kind").notNull(),
  envelopeJson: text("envelope_json").notNull(),
  hmac: text("hmac").notNull(),
  status: text("status").notNull().default("queued"), // queued | delivering | delivered | dead_letter
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: integer("next_retry_at"),
  enqueuedAt: text("enqueued_at").notNull(),
  deliveredAt: text("delivered_at"),
  lastError: text("last_error"),
});

export const syncInbox = sqliteTable("sync_inbox", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  envelopeJson: text("envelope_json").notNull(),
  status: text("status").notNull().default("pending"), // pending | applied | rejected
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  handler: text("handler"),
});

/* ----- Sprint 29 KL-03 — sync inbox state (durable key-value) ----- */
export const syncInboxState = sqliteTable("sync_inbox_state", {
  key: text("key").primaryKey(),           // namespace::mapKey
  valueJson: text("value_json").notNull(), // JSON serialized value
  updatedAt: text("updated_at").notNull(),
});

/* ----- Sprint 29 KL-02 — platform config (lifecycle policies) ----- */
export const platformConfig = sqliteTable("platform_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),           // JSON value
  version: integer("version").notNull().default(0),
  prevHash: text("prev_hash").notNull().default("0".repeat(64)),
  hash: text("hash").notNull().default("0".repeat(64)),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
});

export const formulas = sqliteTable("formulas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  region: text("region").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | archived
  version: text("version").notNull(),
  sourceCode: text("source_code"),
  citationSource: text("citation_source"),
  citationUrl: text("citation_url"),
  defHash: text("def_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdBy: text("created_by").notNull(),
  isBuiltIn: integer("is_built_in", { mode: "boolean" }).notNull().default(false),
});

/* ----- Zod insert schemas ----- */
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

/* ----- enums for UI ----- */
export const ROUND_TYPES = [
  { value: "foundation", label: "Foundation (Round 0)" },
  { value: "preseed", label: "Pre-Seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
  { value: "series_c", label: "Series C" },
] as const;

/**
 * Investment vehicles supported by the cap-table engine.
 * Each instrument exposes a different set of round-terms fields.
 * See packages/cap-table-engine/src/instruments/* for the math implementations.
 */
export const INSTRUMENTS = [
  {
    value: "common",
    label: "Common Shares",
    description: "Founder + employee equity. Typically used for Foundation rounds and ESOP issuance.",
    suggestedFor: ["foundation"],
    fields: ["sharesAuthorized", "pricePerShare"],
  },
  {
    value: "preferred",
    label: "Preferred Shares (Priced Round)",
    description: "NVCA-style priced equity with liquidation preference. Standard for Series A+.",
    suggestedFor: ["series_a", "series_b", "series_c"],
    fields: ["preMoney", "targetAmount", "pricePerShare", "liqPrefMultiple", "participating", "capParticipation", "antiDilution"],
  },
  {
    value: "safe_post",
    label: "SAFE — Post-Money Valuation Cap (YC v1.2)",
    description: "Post-money cap is the YC default. Investor ownership is fixed at conversion.",
    suggestedFor: ["preseed", "seed"],
    fields: ["targetAmount", "valuationCap", "discount", "mfn"],
  },
  {
    value: "safe_pre",
    label: "SAFE — Pre-Money Valuation Cap (YC v1.0)",
    description: "Pre-money cap is older / less common. Founders bear post-money dilution.",
    suggestedFor: ["preseed", "seed"],
    fields: ["targetAmount", "valuationCap", "discount", "mfn"],
  },
  {
    value: "convertible_note",
    label: "Convertible Note (Debt)",
    description: "Debt instrument that converts at the next priced round. Accrues interest. Has maturity.",
    suggestedFor: ["preseed", "seed"],
    fields: ["targetAmount", "valuationCap", "discount", "interestRate", "maturityMonths", "mfn"],
  },
  {
    value: "warrant",
    label: "Warrants",
    description: "Right to buy shares at a strike price within an expiry window. Cash or cashless exercise.",
    suggestedFor: ["seed", "series_a", "series_b", "series_c"],
    fields: ["sharesAuthorized", "strikePrice", "expiryYears", "cashlessAllowed"],
  },
  {
    value: "option_pool",
    label: "Option Pool Top-Up (ESOP / EMI / CSOP)",
    description: "Increase the option pool. Pre-money pool dilutes founders only; post-money dilutes everyone.",
    suggestedFor: ["seed", "series_a", "series_b", "series_c"],
    fields: ["poolSize", "poolTiming", "vestingMonths", "cliffMonths", "jurisdictionVariant"],
  },
] as const;

export type InstrumentValue = typeof INSTRUMENTS[number]["value"];

export const ANTI_DILUTION_VARIANTS = [
  { value: "none", label: "None" },
  { value: "broad_based_wa", label: "Broad-Based Weighted-Average (most common)" },
  { value: "narrow_based_wa", label: "Narrow-Based Weighted-Average" },
  { value: "full_ratchet", label: "Full Ratchet (founder-unfriendly)" },
] as const;

export const ESOP_TIMING = [
  { value: "pre_money", label: "Pre-money pool (dilutes founders only — investor-friendly)" },
  { value: "post_money", label: "Post-money pool (dilutes everyone — founder-friendly)" },
] as const;

export const ROUND_STATES = [
  "draft",
  "terms_set",
  "soft_circle_open",
  "signing_open",
  "closed",
] as const;

export const INVITATION_STATES = [
  "pending",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "revoked",
] as const;

export const DATAROOM_CATEGORIES = [
  { value: "mgmt", label: "Management Team" },
  { value: "product", label: "Product" },
  { value: "sales", label: "Sales & Marketing" },
  { value: "tech_it", label: "Tech IT" },
  { value: "ops", label: "Operations" },
  { value: "regulatory", label: "Regulatory" },
  { value: "legal", label: "Legal" },
  { value: "financials", label: "Financials" },
  { value: "press", label: "Press" },
  { value: "misc", label: "Misc" },
  { value: "term_sheet", label: "Term Sheet" },
] as const;

/* ===================================================================
 * SPRINT 10 — Investor Surface Rebuild
 * ===================================================================
 * Constants, zod schemas and types for:
 *   - Your Decision 10-state machine
 *   - Investor portfolio analytics (KPIs)
 *   - M&A intelligence (acquirer-fit, comparables, strategic buyers)
 *   - Investor Personal CRM (pcrm_contacts/notes/tasks)
 *   - Collective Application 7-step wizard
 * =================================================================== */

/** 10-state invitation state machine (sync schema §9 + collective audit §2 Tab 7). */
export const YOUR_DECISION_STATES = [
  "pending",
  "viewed",
  "accepted",
  "declined",
  "soft_circled",
  "confirmed",
  "signed",
  "funded",
  "expired",
  "revoked",
] as const;
export type YourDecisionState = (typeof YOUR_DECISION_STATES)[number];

/**
 * Valid transitions per the audit §2 Tab 7. Each key is the from-state;
 * values are the set of allowed next states. Auto transitions are documented
 * (e.g. pending → viewed on tab open) but are still listed here.
 *
 * Investor-actionable transitions only (system/founder transitions kept here too
 * so the validator can authorize them when actor is correct).
 */
export const YOUR_DECISION_TRANSITIONS: Record<YourDecisionState, readonly YourDecisionState[]> = {
  pending:      ["viewed", "expired", "revoked"],
  viewed:       ["accepted", "declined", "soft_circled", "expired", "revoked"],
  accepted:     ["soft_circled", "declined", "revoked", "expired"],
  soft_circled: ["confirmed", "revoked", "declined"],
  confirmed:    ["signed", "revoked"],
  signed:       ["funded"],
  funded:       [],
  declined:     [],
  expired:      [],
  revoked:      [],
};

export const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const SOFT_CIRCLE_TYPES = ["definite", "indication", "conditional"] as const;
export type SoftCircleType = (typeof SOFT_CIRCLE_TYPES)[number];

export const yourDecisionPatchSchema = z.object({
  action: z.enum(["view", "accept", "decline", "soft_circle", "confirm", "sign", "fund", "request_info", "revoke", "expire"]),
  amount: z.number().positive().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  softCircleType: z.enum(SOFT_CIRCLE_TYPES).optional(),
  note: z.string().max(500).optional(),
  reason: z.string().max(500).optional(),
});
export type YourDecisionPatch = z.infer<typeof yourDecisionPatchSchema>;

/* -----------------------------------------------------------------
 * M&A Intelligence (sync schema §3.4 — 30 fields, all Collective-shared)
 * ----------------------------------------------------------------- */
export const maIntelligenceSchema = z.object({
  companyId: z.string(),
  acquirerFitScore: z.number().min(0).max(100),
  maScore: z.number().min(0).max(100),
  intentSignal: z.enum(["none", "inbound", "outbound", "active_negotiation"]),
  topStrategicBuyers: z.array(z.object({
    name: z.string(), rationale: z.string(), recentActivity: z.string(),
  })).max(10),
  comparableExits: z.array(z.object({
    target: z.string(), acquirer: z.string(), date: z.string(),
    valuationUsd: z.number(), revenueMultiple: z.number().nullable(),
  })),
  revenueMultipleRange: z.object({ low: z.number(), high: z.number() }),
  productMarketFit: z.number().min(0).max(100),
  technologyDifferentiation: z.number().min(0).max(100),
  customerConcentration: z.number().min(0).max(100),
  growthRate: z.number(),
  marketShare: z.number(),
  managementTeamStrength: z.number().min(0).max(100),
});
export type MaIntelligence = z.infer<typeof maIntelligenceSchema>;

export const maInitiativeSchema = z.object({
  companyId: z.string(),
  initiativeType: z.enum(["discussion", "lead_initiative"]),
  topic: z.string().max(2000),
  buyerShortlist: z.array(z.string()).optional(),
});
export type MaInitiativePayload = z.infer<typeof maInitiativeSchema>;

/* -----------------------------------------------------------------
 * Investor Personal CRM
 * ----------------------------------------------------------------- */
export const PCRM_PIPELINE_STAGES = [
  "lead", "met", "diligence", "soft_circle", "invested", "exited",
] as const;
export type PcrmPipelineStage = (typeof PCRM_PIPELINE_STAGES)[number];

export const PCRM_CONTACT_KINDS = ["founder", "co_investor", "ecosystem"] as const;
export type PcrmContactKind = (typeof PCRM_CONTACT_KINDS)[number];

export const PCRM_LANES = [
  "cap_table", "round", "dsc", "angel_network", "social",
] as const;
export type PcrmLane = (typeof PCRM_LANES)[number];

export const pcrmContactSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  kind: z.enum(PCRM_CONTACT_KINDS),
  firm: z.string().max(120).optional(),
  email: z.string().email().optional().or(z.literal("")),
  linkedin: z.string().max(300).optional().or(z.literal("")),
  pipelineStage: z.enum(PCRM_PIPELINE_STAGES),
  tags: z.array(z.string().max(40)).max(20).optional(),
  lanes: z.array(z.enum(PCRM_LANES)).optional(),
  companyId: z.string().optional(),
});
export type PcrmContact = z.infer<typeof pcrmContactSchema>;

export const pcrmNoteSchema = z.object({
  id: z.string().optional(),
  contactId: z.string(),
  body: z.string().min(1).max(5000),
  noteType: z.enum(["call", "email", "meeting", "message", "other"]),
});
export type PcrmNote = z.infer<typeof pcrmNoteSchema>;

export const pcrmTaskSchema = z.object({
  id: z.string().optional(),
  contactId: z.string(),
  title: z.string().min(1).max(200),
  dueDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["todo", "in_progress", "done"]),
});
export type PcrmTask = z.infer<typeof pcrmTaskSchema>;

/* -----------------------------------------------------------------
 * Collective Application — 7-step wizard
 * ----------------------------------------------------------------- */
export const COLLECTIVE_APP_STATUSES = [
  "submitted", "reviewing", "accepted", "rejected", "waitlisted",
] as const;
export type CollectiveAppStatus = (typeof COLLECTIVE_APP_STATUSES)[number];

export const COLLECTIVE_SECTORS_45 = [
  "Fintech", "Insurtech", "Regtech", "Wealthtech", "Crypto / Web3",
  "Climate Tech", "Energy", "Agriculture & Food", "Mobility & Transport",
  "Aerospace & Defense", "Healthtech", "Biotech", "Medtech", "Pharma",
  "Mental Health", "Digital Health", "AI / ML Platform", "AI Applications",
  "Robotics", "Computer Vision", "Cybersecurity", "Privacy & Identity",
  "Developer Tools", "Cloud Infra", "Data Infra", "DevOps & SRE",
  "Edtech", "Future of Work", "HRtech", "Legal Tech", "Marketing Tech",
  "Sales Tech", "Customer Support", "Real Estate", "Construction",
  "Manufacturing", "Industrial Automation", "Logistics & Supply Chain",
  "Retail", "E-commerce", "Consumer", "Gaming", "Media & Entertainment",
  "Sports", "Travel & Hospitality",
] as const;

export const COLLECTIVE_REGIONS_9 = [
  "North America", "Latin America", "United Kingdom", "Europe",
  "Middle East", "Africa", "South Asia", "South-East Asia", "Asia-Pacific",
] as const;

export const COLLECTIVE_STAGES = [
  "Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Late Stage",
] as const;

export const ACCREDITATION_JURISDICTIONS = [
  "US", "CA", "UK", "EU", "SG", "HK", "AU", "IN", "JP",
] as const;
export type AccreditationJurisdiction = (typeof ACCREDITATION_JURISDICTIONS)[number];

export const collectiveApplicationSchema = z.object({
  // Step 2
  thesis: z.string().min(20).max(1000),
  minCheckUsd: z.number().int().min(5000),
  maxCheckUsd: z.number().int().min(5000),
  sectors: z.array(z.string()).min(1).max(45),
  stages: z.array(z.string()).min(1).max(7),
  geoFocus: z.array(z.string()).min(1).max(9),
  memberTier: z.enum(["bronze", "silver", "gold", "platinum"]),
  referralCode: z.string().max(40).optional().or(z.literal("")),
  // Step 3
  passportFilename: z.string().min(1).max(200),
  proofOfAddressFilename: z.string().min(1).max(200),
  additionalDocs: z.array(z.string().max(200)).max(10).optional(),
  // Step 4
  jurisdiction: z.enum(ACCREDITATION_JURISDICTIONS),
  accreditationDeclaration: z.string().min(1).max(2000),
  // Step 5 (mocked Stripe)
  paymentMethod: z.enum(["card_mock", "invoice"]),
  cardholderName: z.string().min(2).max(120).optional().or(z.literal("")),
}).refine((v) => v.maxCheckUsd >= v.minCheckUsd, {
  message: "Maximum check size must be greater than or equal to minimum",
  path: ["maxCheckUsd"],
});
export type CollectiveApplication = z.infer<typeof collectiveApplicationSchema>;

/* -----------------------------------------------------------------
 * Telemetry payload shapes — must match capavate_collective_sync_schema.md §9.
 *
 * Wrapper:
 *   { eventId, eventType, aggregateId, aggregateKind, occurredAt,
 *     tenantId, actor: { userId, ip }, payload, schemaVersion }
 * ----------------------------------------------------------------- */
/** Sprint 14 — Trace step (Pattern 1, harvest_capavate §1).
 * Every store mutation must populate trace[] for golden-vector replay.
 */
export type TraceStep = {
  formulaId: string;
  /** Semver-ish version string for replay determinism. */
  version: string;
  /** Region for jurisdiction-adaptive math (US/CA/UK/EU/SG/HK/IN/JP/AU). */
  region: string;
  /** Definition hash for golden-vector regression. */
  defHash: string;
  ts: string;
  durMs: number;
};

export type SyncEnvelope<T> = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateKind: "company" | "investor" | "round" | "invitation" | "application" | "contact" | "platform";
  occurredAt: string;
  tenantId: string;
  actor: { userId: string; ip?: string };
  payload: T;
  /** Sprint 14 — universal tracing. Populated for every mutation; non-empty in test mode. */
  trace?: TraceStep[];
  schemaVersion: "1.0";
};

/* -----------------------------------------------------------------
 * Patch 1 — User credentials persistence (Avi fix #2)
 *
 * Stores hashed passwords for founder accounts so login works after
 * a server restart (without relying on in-memory RUNTIME_PASSWORDS).
 *
 * DDL (Postgres equivalent for production):
 *   CREATE TABLE IF NOT EXISTS "user_credentials" (
 *     "user_id"       TEXT PRIMARY KEY,
 *     "email"         TEXT NOT NULL,
 *     "name"          TEXT,
 *     "password_hash" TEXT NOT NULL,
 *     "created_at"    TEXT,
 *     "updated_at"    TEXT
 *   );
 *   CREATE UNIQUE INDEX IF NOT EXISTS "user_credentials_email_idx"
 *     ON "user_credentials"("email");
 *
 * TODO (Avi): after adding this to your schema, run:
 *   npx drizzle-kit push
 * ----------------------------------------------------------------- */
export const userCredentials = sqliteTable("user_credentials", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
  // v12 soft-delete (DB-2):
  deletedAt: text("deleted_at"),
});

/* -----------------------------------------------------------------
 * Patch v12 Day 2 Wave 1 — Company Profile Extended (audit §3.3)
 *
 * Holds the rich CompanyProfile (Wave C-1: 46 fields across 7 sections)
 * as a JSON blob per company, with a hash-chain (version, prevHash, hash)
 * for tamper evidence. The in-memory `profileMap` in
 * server/companyProfileStore.ts is a READ cache; this table is the source of
 * truth. Every PATCH wraps in a Drizzle transaction (DB-6).
 * ----------------------------------------------------------------- */
export const companyProfileExtended = sqliteTable("company_profile_extended", {
  companyId: text("company_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  profileJson: text("profile_json").notNull(), // serialized CompanyProfile
  version: integer("version").notNull().default(1),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
  // v12 soft-delete symmetry (DB-2).
  deletedAt: text("deleted_at"),
});

/* -----------------------------------------------------------------
 * Patch v12 Day 2 Wave 1 — Reconciliation runs (audit §3.8)
 *
 * Was an in-memory array on adminPlatformStore. Each row is one cap-table
 * reconciliation run between the main engine and the reference engine.
 * ----------------------------------------------------------------- */
export const reconRuns = sqliteTable("recon_runs", {
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

/* -----------------------------------------------------------------
 * Patch v12 Day 2 Wave 1 — Founder pricing tiers (audit §3.8)
 *
 * Editable price card surfaced via admin pricing routes; previously a hard-
 * coded TS array. Each row is one tier (free / pro / scale / …).
 * ----------------------------------------------------------------- */
export const founderTiers = sqliteTable("founder_tiers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  usdMonthly: integer("usd_monthly").notNull(),
  featuresJson: text("features_json").notNull(), // [{key,label,included}]
  updatedAt: text("updated_at").notNull(),
  updatedBy: text("updated_by").notNull().default("system"),
  deletedAt: text("deleted_at"),
});

/* -----------------------------------------------------------------
 * Patch v12 Day 2 Wave 2 — six new compliance / audit / hash-chain tables.
 *
 *   legalConsents          — append-only consent ledger (per-tenant chain)
 *   dataroomFolders        — folder hierarchy for dataroom
 *   dataroomPermissions    — investor x folder permission grants
 *   dataroomEvents         — audit feed for dataroom activity
 *   captableCommits        — append-only ledger of committed cap-table positions
 *   fundedQueue            — crash-recoverable queue of funded-but-uncommitted entries
 *   termSheetRevisions     — per-round hash-chained term sheet revisions
 *   invoiceYearCounter     — monotonic CAP-{year}-NNNNNN counter (cached source-of-truth: MAX(invoice_number))
 *   contactRevisions       — per-contact hash-chained revision history
 * ----------------------------------------------------------------- */

export const legalConsents = sqliteTable("legal_consents", {
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
  // v12 (DB-2): soft-delete column for the compliance set. The ledger is
  // append-only by contract; deleted_at exists for schema symmetry only.
  deletedAt: text("deleted_at"),
});

export const dataroomFolders = sqliteTable("dataroom_folders", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  isRoundFolder: integer("is_round_folder", { mode: "boolean" }).notNull().default(false),
  roundId: text("round_id"),
  deletedAt: text("deleted_at"),
});

export const dataroomPermissions = sqliteTable("dataroom_permissions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  investorId: text("investor_id").notNull(),
  folderId: text("folder_id").notNull(),
  view: integer("view", { mode: "boolean" }).notNull().default(false),
  download: integer("download", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const dataroomEvents = sqliteTable("dataroom_events", {
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

export const captableCommits = sqliteTable("captable_commits", {
  id: text("id").primaryKey(),                  // deterministic from invitationId
  tenantId: text("tenant_id").notNull(),
  seq: integer("seq").notNull(),
  ts: text("ts").notNull(),
  invitationId: text("invitation_id").notNull(),
  roundId: text("round_id").notNull(),
  companyId: text("company_id").notNull(),
  investorId: text("investor_id").notNull(),
  // Sprint 25 precision: STRINGS for amount + shares. amountMinor + sharesStr
  // are the canonical precision-preserving fields; the legacy float columns
  // on `securities` are mirrored on write but NEVER read for math.
  amount: text("amount").notNull(),             // Decimal-as-string
  currency: text("currency").notNull(),
  shares: text("shares").notNull(),             // BigInt-as-string
  state: text("state").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  reconcilePrimary: text("reconcile_primary"),
  reconcileRef: text("reconcile_ref"),
  reconcileMatch: integer("reconcile_match", { mode: "boolean" }).notNull().default(true),
  complianceHold: integer("compliance_hold", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
});

export const fundedQueue = sqliteTable("funded_queue", {
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

export const termSheetRevisions = sqliteTable("term_sheet_revisions", {
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

export const invoiceYearCounter = sqliteTable("invoice_year_counter", {
  year: integer("year").primaryKey(),
  count: integer("count").notNull().default(0),
});

export const contactRevisions = sqliteTable("contact_revisions", {
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

/* ===================================================================
 * Patch v12 Day 3 — CRM stores (audit §3.9, §3.10, §3.11)
 *
 *   founderCrmContacts  — founder's view of investors  (audit §3.11)
 *   investorCrmContacts — investor's broader contact tracker (audit §3.10)
 *   pcrmContacts/Notes/Tasks — Sprint 10 personal CRM (audit §3.9)
 *
 * All tables carry tenant_id (NOT NULL) and a soft-delete column.
 * =================================================================== */

export const founderCrmContacts = sqliteTable("founder_crm_contacts", {
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
  // JSON: { sharesUsd: number, pct: number }
  ownership: text("ownership"),
  // JSON Array<{ts:string, amountUsd:number, type:string}>
  softCircleHistory: text("soft_circle_history"),
  // JSON Array<{ id, text, due, status }>
  tasks: text("tasks"),
  // JSON string[]
  threadIds: text("thread_ids"),
  maSignals: integer("ma_signals").notNull().default(0),
  notes: text("notes"),
  notesUpdatedAt: text("notes_updated_at"),
  series: text("series"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

export const investorCrmContacts = sqliteTable("investor_crm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  investorId: text("investor_id").notNull(),
  platformUserId: text("platform_user_id"),
  name: text("name").notNull(),
  role: text("role"),
  email: text("email"),
  affiliation: text("affiliation"),
  stage: text("stage").notNull(),
  // JSON string[]
  tags: text("tags"),
  notes: text("notes"),
  // JSON Array<InvestorCrmNote>
  noteLog: text("note_log"),
  // JSON Array<InvestorCrmTask>
  tasks: text("tasks"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // Legacy compat fields
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

export const pcrmContacts = sqliteTable("pcrm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  firm: text("firm"),
  email: text("email"),
  linkedin: text("linkedin"),
  pipelineStage: text("pipeline_stage").notNull(),
  // JSON string[]
  tags: text("tags"),
  // JSON string[]
  lanes: text("lanes"),
  companyId: text("company_id"),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const pcrmNotes = sqliteTable("pcrm_notes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  contactId: text("contact_id").notNull(),
  body: text("body").notNull(),
  noteType: text("note_type").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const pcrmTasks = sqliteTable("pcrm_tasks", {
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

// ─────────────────────────────────────────────────────────────
// v16 Fix 6 — Collective Waitlist
//
// Honest "ship safely" persistence: when COLLECTIVE_ENABLED=0 the existing
// application/nomination/promote endpoints refuse traffic with 503; the
// waitlist endpoints below accept the same form payloads and queue them for
// admin review when chapter access opens.
// ─────────────────────────────────────────────────────────────
export const collectiveWaitlist = sqliteTable("collective_waitlist", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  /** 'investor_membership' | 'founder_path_a' | 'founder_path_b' | 'cap_table_promote' */
  kind: text("kind").notNull(),
  userId: text("user_id").notNull(),
  /** null for investor_membership */
  companyId: text("company_id"),
  /** JSON dump of the full form submission */
  payload: text("payload").notNull(),
  /** free-text "I'm interested in Toronto chapter" */
  chapterHint: text("chapter_hint"),
  /** 'waitlist' | 'accepted' | 'declined' */
  status: text("status").notNull().default("waitlist"),
  createdAt: text("created_at").notNull(),
  reviewedAt: text("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  deletedAt: text("deleted_at"),
  // v17 Phase A — chapter scoping (additive, nullable; backfilled to chap_keiretsu_canada).
  chapterId: text("chapter_id"),
});

// ─────────────────────────────────────────────────────────────
// v16 Addendum A — DSC Feedback (DB-migrated from in-memory Map).
//
// Closes audit F-coll-26. Items previously stored in `Map<string,DscFeedback>`
// are now persisted; the in-memory map remains as a read-through cache per
// the v15 hybrid pattern.
//
// NOTE: the `tier` enum in the existing app is
//   "watch" | "qualified" | "featured" | "priority"
// (see dscScoresInboundSchema). The addendum spec used A|B|C|D placeholders;
// we keep the live enum verbatim to avoid breaking 600+ existing references.
// ─────────────────────────────────────────────────────────────
export const dscFeedback = sqliteTable("dsc_feedback", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  /** DSC member (or "u_dsc_relay" for synthetic mock-inbound writes). */
  submitterUserId: text("submitter_user_id").notNull(),
  /** "watch" | "qualified" | "featured" | "priority" */
  tier: text("tier").notNull(),
  /** JSON of { topDimensions, bottomDimensions, dimensions } and any rubric. */
  scoreJson: text("score_json"),
  notes: text("notes"),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
  // v17 Phase A — chapter scoping (additive, nullable; backfilled to chap_keiretsu_canada).
  chapterId: text("chapter_id"),
});

// ─────────────────────────────────────────────────────────────
// v16 Addendum B — DSC Votes foundation (hash-chained, audit-grade).
//
// NO PUBLIC ENDPOINT in v16. The store is callable from server-side code
// only. v17 will layer the screening/scheduling/UI on top.
// ─────────────────────────────────────────────────────────────
export const dscVotes = sqliteTable("dsc_votes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id").notNull(),
  /** optional — votes can predate a specific round */
  roundId: text("round_id"),
  /** must be a DSC member at recording time */
  voterUserId: text("voter_user_id").notNull(),
  /** 'approve' | 'reject' | 'conditional' | 'abstain' */
  vote: text("vote").notNull(),
  /** JSON array of conditions, for 'conditional' vote */
  conditions: text("conditions"),
  notes: text("notes"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  castAt: text("cast_at").notNull(),
  /** When voter changes their vote, the prior row is marked superseded. */
  supersededAt: text("superseded_at"),
  deletedAt: text("deleted_at"),
  // v17 Phase A — chapter scoping (additive, nullable; backfilled to chap_keiretsu_canada).
  chapterId: text("chapter_id"),
});

// ─────────────────────────────────────────────────────────────
// v17 Phase A — Chapter scoping (load-bearing schema change).
//
// A Chapter is the per-region Capavate Collective franchise unit
// (e.g. "Capavate Collective — Toronto"). Each chapter is its own tenant
// (`tenant_chap_<id>`) so withTenant() automatically isolates per-chapter
// reads at the row level. Memberships are explicit join rows in
// `chapter_memberships`. Existing v16 demo data backfills into
// `chap_keiretsu_canada` for continuity (Maya/Aisha/Daniel).
//
// Closes the largest single architectural gap from the Phase-8
// COLLECTIVE_AUDIT (see audit_findings/phase8_collective_audit/
// COLLECTIVE_AUDIT.md): chapters did not exist as a data structure.
// ─────────────────────────────────────────────────────────────
export const chapters = sqliteTable("chapters", {
  /** Stable text id, e.g. "chap_toronto". */
  id: text("id").primaryKey(),
  /** Each chapter is its own tenant — top-level isolation. */
  tenantId: text("tenant_id").notNull(),
  /** Display name, e.g. "Capavate Collective — Toronto". */
  name: text("name").notNull(),
  /** 'NA-East' | 'NA-West' | 'APAC' | 'EU' (free-form for now). */
  region: text("region").notNull(),
  /** Optional city — e.g. "Toronto". */
  city: text("city"),
  /** active | paused | wound_down */
  status: text("status").notNull().default("active"),
  /** Primary chapter admin user id (nullable until first admin appointed). */
  adminUserId: text("admin_user_id"),
  /** Optional — when a chapter is led by a consortium partner. */
  partnerOrgId: text("partner_org_id"),
  /** Annual membership fee in minor units (cents). v18 Stripe wiring uses this. */
  membershipFeeAnnualMinor: integer("membership_fee_annual_minor").default(0),
  /** v17 Phase C — DSC quorum threshold in PERCENT (0..100). Default 50 = simple majority. */
  dscQuorumPct: integer("dsc_quorum_pct").notNull().default(50),
  /** ISO date when chapter was founded (optional). */
  founded: text("founded"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  /** Soft-delete for compliance (chapters cannot be hard-deleted). */
  deletedAt: text("deleted_at"),
});

// ─────────────────────────────────────────────────────────────
// v17 Phase A — Chapter memberships.
//
// A user can belong to multiple chapters (e.g. an investor in both
// Toronto and NYC). Role distinguishes regular members from chapter
// admins. Each row is tenant-scoped to the chapter's own tenant for
// withTenant() filtering, plus chapter_id is the dimensional key the
// rest of the Collective slice reads to authorize chapter-scoped reads.
// ─────────────────────────────────────────────────────────────
export const chapterMemberships = sqliteTable("chapter_memberships", {
  id: text("id").primaryKey(),
  /** Equals the chapter's tenant_id (tenant_chap_<id>) for withTenant() filtering. */
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  /** 'member' | 'admin' */
  role: text("role").notNull().default("member"),
  /** active | pending | revoked */
  status: text("status").notNull().default("active"),
  joinedAt: text("joined_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

// ─────────────────────────────────────────────────────────────
// v17 Phase B — Migrated stores (8 hybrid Map+DB tables).
//
// Pattern: every WRITE in the corresponding TS store goes through
// `getDb().transaction(async (tx) => {...})` (no trailing `()`). After
// commit, the in-memory Map is updated. Reads stay synchronous via the Map.
// Hydration on boot is sequential in HYDRATE_ORDER.
// All tables carry `chapter_id` (default-backfilled to 'chap_keiretsu_canada')
// and `tenant_id` for withTenant() scoping.
// ─────────────────────────────────────────────────────────────

/** Store 1 — collectiveApp (investor membership applications, 7-step wizard). */
export const collectiveApps = sqliteTable("collective_apps", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  /** 'submitted' | 'approved' | 'rejected' | 'withdrawn' */
  status: text("status").notNull().default("submitted"),
  /** JSON-serialized wizard payload (thesis, sectors, geo, etc.) */
  payloadJson: text("payload_json").notNull(),
  submittedAt: text("submitted_at").notNull(),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 2 — collectiveMembership (active membership rows). */
export const collectiveMemberships = sqliteTable("collective_memberships", {
  /** userId is the natural primary key (one membership per user globally). */
  userId: text("user_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  /** 'active' | 'suspended' */
  status: text("status").notNull().default("active"),
  /** 'standard' | 'plus' */
  tier: text("tier").notNull().default("standard"),
  activatedAt: text("activated_at").notNull(),
  activatedBy: text("activated_by").notNull(),
  deactivatedAt: text("deactivated_at"),
  deactivatedBy: text("deactivated_by"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 3a — founderCollectiveApply: Path A nominations (investor-vouched). */
export const founderCollectiveNominations = sqliteTable("founder_collective_nominations", {
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
  /** 'pending_vouch' | 'vouched' | 'reviewing' | 'invited' | 'presented' | 'declined' */
  status: text("status").notNull().default("pending_vouch"),
  submittedAt: text("submitted_at").notNull(),
  vouchedAt: text("vouched_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 3b — founderCollectiveApply: Path B applications (direct). */
export const founderCollectiveApplications = sqliteTable("founder_collective_applications", {
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
  /** 'submitted' | 'reviewing' | 'invited' | 'rejected' | 'waitlisted' */
  status: text("status").notNull().default("submitted"),
  submittedAt: text("submitted_at").notNull(),
  reviewedAt: text("reviewed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 4 — sprint21Portfolio investor nominations. Hash-chained for audit.
 *  v17 Phase C — added accept/decline state machine: status, declineReason,
 *  decidedAt, decidedBy, roundId (for cascading round-close auto-close). */
export const investorNominations = sqliteTable("investor_nominations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  investorUserId: text("investor_user_id").notNull(),
  companyId: text("company_id").notNull(),
  rationale: text("rationale").notNull(),
  /** v17 Phase C — 'pending' | 'accepted' | 'declined' | 'lapsed' */
  status: text("status").notNull().default("pending"),
  declineReason: text("decline_reason"),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
  /** Optional FK to rounds.id — if the nomination is tied to a fundraising round. */
  roundId: text("round_id"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 5a — adminDsc roles (which users are DSC for which chapter). */
export const dscRoles = sqliteTable("dsc_roles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  /** 'active' | 'revoked' */
  status: text("status").notNull().default("active"),
  /** Audit hash-chain on the role pipeline (promote/demote). */
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

/** Store 5b — adminDsc pipeline (companies queued for screening). */
export const dscPipeline = sqliteTable("dsc_pipeline", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  companyId: text("company_id").notNull(),
  submittedBy: text("submitted_by").notNull(),
  /** 'pending' | 'in_review' | 'scored' | 'rejected' */
  status: text("status").notNull().default("pending"),
  submittedAt: text("submitted_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
  deletedAt: text("deleted_at"),
});

/** Store 6 — collectiveSettings (per-user, per-chapter settings with hash-chain). */
export const collectiveSettingsTable = sqliteTable("collective_settings", {
  /** Primary key is (userId) since settings are per-user; chapter_id stamps the row. */
  userId: text("user_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  /** 'public' | 'screen_name' | 'private' */
  anonymityLevel: text("anonymity_level").notNull().default("public"),
  notifyOnDscScore: integer("notify_on_dsc_score").notNull().default(1),
  notifyOnDealRoomUpdate: integer("notify_on_deal_room_update").notNull().default(1),
  /** 'visible' | 'hidden' | 'members_only' */
  dealRoomVisibility: text("deal_room_visibility").notNull().default("visible"),
  version: integer("version").notNull().default(1),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

/** Store 7 — commsStore Collective slice (Collective-channel posts only). */
export const collectiveChannelPosts = sqliteTable("collective_channel_posts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  channelId: text("channel_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  /** 'user' | 'company' */
  authorKind: text("author_kind").notNull().default("user"),
  body: text("body").notNull(),
  /** Always 'public_to_collective' for this table; kept for forward compat. */
  visibility: text("visibility").notNull().default("public_to_collective"),
  /** JSON-serialized arrays/numbers for the Post DTO. */
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

/** Store 8 — partnerWorkspace Collective slice (partner_deal_promotions, hash-chained). */
export const partnerDealPromotions = sqliteTable("partner_deal_promotions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  partnerId: text("partner_id").notNull(),
  pipelineDealId: text("pipeline_deal_id").notNull(),
  /** 'collective_deal_room' | 'capavate_referral' */
  promotionType: text("promotion_type").notNull(),
  companyId: text("company_id"),
  targetEmail: text("target_email"),
  /** 'pending' | 'live' | 'rejected' | 'withdrawn' */
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
  /** CP Phase B — chapter-admin moderation (CP-015). */
  moderationStatus: text("moderation_status").notNull().default("pending"),
  moderatedByUserId: text("moderated_by_user_id"),
  moderatedAt: text("moderated_at"),
  moderationNotes: text("moderation_notes"),
});

// ─────────────────────────────────────────────────────────────
// v18 Phase A — Screening event scheduling.
//
// A screening_events row represents a scheduled DSC screening / pitch /
// office-hours meeting for a given (chapter, company). Each event keeps a
// per-row hash chain (prev_hash → curr_hash) so the lifecycle (created →
// cancelled / completed) is audit-grade. The attendee list is a separate
// table; one row per (event, user).
//
// ICS export: every event exposes an `ics_uid` (RFC5545 UID) so calendar
// dedup is preserved across re-downloads. The /api/collective/screening-events/:id/ics
// endpoint emits a valid VCALENDAR/VEVENT body from these columns alone.
//
// Third-party calendar integration (Google Calendar API / Microsoft Graph)
// is intentionally deferred to Avi; this ICS export is the offline import
// path that all RFC5545-conformant calendar clients accept (Apple Calendar,
// Outlook, Thunderbird, Google Calendar import, etc.). When the
// GOOGLE_CALENDAR_CLIENT_ID / _SECRET env vars are unset (the default),
// the API only ever produces ICS — no calls to any third-party service.
// ─────────────────────────────────────────────────────────────
export const screeningEvents = sqliteTable("screening_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  /** Nullable FK to rounds.id — when the event is round-scoped. */
  roundId: text("round_id"),
  companyId: text("company_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /** Unix seconds since epoch. */
  scheduledFor: integer("scheduled_for").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  /** Free-form text — may be a meeting URL (Zoom/Meet/Whereby) for virtual events. */
  location: text("location"),
  /** 'screening' | 'pitch' | 'office_hours' */
  eventType: text("event_type").notNull().default("screening"),
  /** 'scheduled' | 'in_progress' | 'completed' | 'cancelled' */
  status: text("status").notNull().default("scheduled"),
  organizerUserId: text("organizer_user_id").notNull(),
  /** RFC5545 UID for calendar dedup; unique. */
  icsUid: text("ics_uid").notNull().unique(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const screeningEventAttendees = sqliteTable("screening_event_attendees", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  /** 'founder' | 'investor' | 'dsc' | 'observer' */
  role: text("role").notNull().default("observer"),
  /** 'invited' | 'accepted' | 'declined' | 'tentative' */
  rsvp: text("rsvp").notNull().default("invited"),
  /** Set true after the event by an admin check-in. */
  attended: integer("attended").notNull().default(0),
  checkedInAt: text("checked_in_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// v18 Phase B — Stripe Collective membership billing.
//
// Three annual tiers per chapter, sold via Stripe Checkout + managed via
// the Stripe Customer Portal:
//
//   collective_basic     — read access, attend events, basic comms
//   collective_standard  — basic + vote in DSC + soft circles
//   collective_premium   — standard + propose investments + admin nomination
//
// This is a SEPARATE Stripe product from the existing platform Founder
// Pro/Scale subscription (which is keyed off PAYMENT_GATEWAY_* env vars).
// Reads STRIPE_SECRET_KEY + STRIPE_COLLECTIVE_{BASIC,STANDARD,PREMIUM}_PRICE_ID
// + STRIPE_WEBHOOK_SECRET. Graceful 503 when env vars unset.
//
// Both tables are hash-chained (prev_hash → curr_hash) so a tamper of any
// billing row is detectable. UNIQUE(user_id, chapter_id) on the membership
// row enforces one membership per user per chapter. UNIQUE(stripe_event_id)
// on the events table is the idempotency key Stripe's retry-on-failure
// behaviour relies on — second delivery of the same event_id returns 200
// without re-processing.
// ─────────────────────────────────────────────────────────────
export const collectiveMembershipsBilling = sqliteTable(
  "collective_memberships_billing",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    chapterId: text("chapter_id").notNull(),
    userId: text("user_id").notNull(),
    /** 'basic' | 'standard' | 'premium' */
    tier: text("tier").notNull(),
    /** 'pending' | 'active' | 'past_due' | 'cancelled' | 'expired' */
    status: text("status").notNull().default("pending"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    /** Unix seconds since epoch — Stripe period boundaries. */
    currentPeriodStart: integer("current_period_start"),
    currentPeriodEnd: integer("current_period_end"),
    /** 0/1 boolean — Stripe "cancel at end of period" flag. */
    cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
    prevHash: text("prev_hash"),
    currHash: text("curr_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
);

export const collectiveBillingEvents = sqliteTable(
  "collective_billing_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    chapterId: text("chapter_id").notNull(),
    billingId: text("billing_id").notNull(),
    /** e.g. 'checkout.session.completed', 'customer.subscription.updated' */
    eventType: text("event_type").notNull(),
    /** Stripe Event id — UNIQUE so duplicate webhook deliveries no-op. */
    stripeEventId: text("stripe_event_id").notNull().unique(),
    /** JSON-stringified Stripe payload for replay/debug. */
    rawPayload: text("raw_payload").notNull(),
    processedAt: text("processed_at").notNull(),
    prevHash: text("prev_hash"),
    currHash: text("curr_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
);

// ─────────────────────────────────────────────────────────────
// v18 Phase C — Ask-an-Expert Q&A + reputation.
//
// Four tables: questions, answers, votes, reputation. Every write inside
// the store is wrapped in a synchronous `db.transaction((tx) => {...})`
// (better-sqlite3 rejects async callbacks). Hashes are computed BEFORE the
// tx opens. Per-chapter isolation is enforced via `chapter_id` + tenant.
//
// Reputation scoring (computed inside the same tx as the triggering write):
//    +1   question asked
//    +5   answer posted
//   +15   own answer marked best (and  -15 from the previously-best answer)
//    +2   own answer upvoted     (and  -2 reversal on toggle / downvote)
//
// Vote uniqueness:  UNIQUE(answer_id, voter_user_id) — one vote per user
// per answer. Re-cast with the same vote_type toggles the vote off (insert
// → delete). The denormalized upvote_count on `expert_answers` is
// recomputed inside the same tx from a COUNT(*) query so racy writes are
// always consistent against the votes ledger.
//
// Hash chain: each question and each answer extends its own per-row chain
// across every status / body edit / accept-best transition.
// ─────────────────────────────────────────────────────────────
export const expertQuestions = sqliteTable("expert_questions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  askerUserId: text("asker_user_id").notNull(),
  /** ≤200 chars enforced by zod at the route boundary. */
  title: text("title").notNull(),
  /** ≤8000 chars enforced by zod at the route boundary. */
  body: text("body").notNull(),
  /** JSON-stringified string[] (≤8 tags). */
  tags: text("tags").notNull().default("[]"),
  /** 'open' | 'answered' | 'closed' | 'flagged' */
  status: text("status").notNull().default("open"),
  /** FK → expert_answers.id once the asker accepts a best answer. Nullable. */
  bestAnswerId: text("best_answer_id"),
  /** Free-form reason text supplied when status='flagged'. */
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

export const expertAnswers = sqliteTable("expert_answers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  questionId: text("question_id").notNull(),
  responderUserId: text("responder_user_id").notNull(),
  /** ≤8000 chars enforced by zod at the route boundary. */
  body: text("body").notNull(),
  /** Denormalized — recomputed via COUNT(*) inside the vote tx. */
  upvoteCount: integer("upvote_count").notNull().default(0),
  /** 0/1 boolean — exactly one row per question may have isBestAnswer=1. */
  isBestAnswer: integer("is_best_answer").notNull().default(0),
  /** 'active' | 'edited' | 'deleted' | 'flagged' */
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

export const expertVotes = sqliteTable("expert_votes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  answerId: text("answer_id").notNull(),
  voterUserId: text("voter_user_id").notNull(),
  /** 'up' | 'down' */
  voteType: text("vote_type").notNull(),
  createdAt: text("created_at").notNull(),
  /** Carried so withTenant()'s soft-delete filter compiles cleanly. Votes
   *  are deleted hard in practice (toggle-off), so this is always NULL. */
  deletedAt: text("deleted_at"),
});

export const expertReputation = sqliteTable("expert_reputation", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  userId: text("user_id").notNull(),
  /** Cached running total (recomputed inside every triggering tx). */
  score: integer("score").notNull().default(0),
  questionsAsked: integer("questions_asked").notNull().default(0),
  answersGiven: integer("answers_given").notNull().default(0),
  bestAnswers: integer("best_answers").notNull().default(0),
  upvotesReceived: integer("upvotes_received").notNull().default(0),
  /** Last milestone (50/200/500) we already notified the user about. */
  lastMilestoneNotified: integer("last_milestone_notified").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** Carried so withTenant()'s soft-delete filter compiles cleanly. Reputation
   *  rows are upserted-only and never deleted, so this is always NULL. */
  deletedAt: text("deleted_at"),
});

// ─────────────────────────────────────────────────────────────
// v19 Phase A — Chapter announcements.
//
// Per-chapter announcements posted by chapter admins. Audience visibility
// controls who sees each row ('all'|'members'|'admins'). Hash-chained per
// row across every edit / pin / delete so the announcement stream is
// audit-grade. A second table `announcement_reads` tracks per-user read
// state (UNIQUE(announcement_id, user_id); idempotent upsert in the
// detail-fetch endpoint).
// ─────────────────────────────────────────────────────────────
export const chapterAnnouncements = sqliteTable("chapter_announcements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  authorUserId: text("author_user_id").notNull(),
  /** ≤200 chars enforced by zod at the route boundary. */
  title: text("title").notNull(),
  /** ≤10000 chars enforced by zod at the route boundary. */
  body: text("body").notNull(),
  /** 0/1 boolean — pinned rows surface first in the list view. */
  pinned: integer("pinned").notNull().default(0),
  /** 'low' | 'normal' | 'high' | 'urgent' */
  priority: text("priority").notNull().default("normal"),
  /** 'all' | 'members' | 'admins' */
  audience: text("audience").notNull().default("all"),
  /** Nullable ISO timestamp; null = no expiry. */
  expiresAt: text("expires_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const announcementReads = sqliteTable("announcement_reads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  announcementId: text("announcement_id").notNull(),
  userId: text("user_id").notNull(),
  readAt: text("read_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// v19 Phase A — Chapter resources library.
//
// Per-chapter knowledge library: docs / links / videos / templates / guides.
// Members may submit (status='pending' → admin approve/reject); chapter
// admins' submissions land directly in status='active'. Any member can flag
// (status='flagged'). Visibility column ('public'|'members'|'admins') gates
// list access. Hash-chained per row.
//
// Binary uploads are env-gated by RESOURCES_STORAGE_PROVIDER — unset →
// 503 storage_not_configured for binary upload endpoint. URL-based
// resources (external links) always work.
// ─────────────────────────────────────────────────────────────
export const chapterResources = sqliteTable("chapter_resources", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  uploaderUserId: text("uploader_user_id").notNull(),
  /** ≤200 chars enforced by zod at the route boundary. */
  title: text("title").notNull(),
  /** ≤4000 chars enforced by zod at the route boundary. */
  description: text("description").notNull().default(""),
  /** 'document' | 'link' | 'video' | 'template' | 'guide' */
  resourceType: text("resource_type").notNull().default("link"),
  /** External URL for links/videos OR storage path for docs/templates. */
  url: text("url").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  /** JSON string[] (≤8 tags). */
  tags: text("tags").notNull().default("[]"),
  /** 'public' | 'members' | 'admins' */
  visibility: text("visibility").notNull().default("members"),
  /** 'pending' | 'active' | 'rejected' | 'flagged' */
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

// ─────────────────────────────────────────────────────────────
// v19 Phase A — Chapter leaderboard snapshots.
//
// Per-(chapter, period) leaderboard snapshot of member activity scores. The
// refresh job (`server/jobs/leaderboardRefresh.ts`) UPSERTs the latest
// snapshot for the current period on (chapter_id, period, period_start)
// every 60 minutes in production (skipped in NODE_ENV=test). On-demand
// compute fires when GET /leaderboard returns no row.
//
// Score formula (computed inside the same SYNC tx as the row write):
//    score = 1.0 * reputation_gained
//          + 3.0 * best_answers_accepted
//          + 2.0 * events_attended
//          + 0.5 * announcements_posted (admins only)
//          + 1.5 * resources_approved
// ─────────────────────────────────────────────────────────────
export const chapterLeaderboardSnapshots = sqliteTable("chapter_leaderboard_snapshots", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id").notNull(),
  /** 'weekly' | 'monthly' | 'all-time' */
  period: text("period").notNull(),
  /** Inclusive ISO timestamp. */
  periodStart: text("period_start").notNull(),
  /** Exclusive ISO timestamp. */
  periodEnd: text("period_end").notNull(),
  /** JSON array of {userId, score, rank, breakdown}. */
  data: text("data").notNull().default("[]"),
  generatedAt: text("generated_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// v19 Phase B — Messaging DB migration (remaining slices).
//
// Migrates the remaining in-memory messaging surfaces (DMs, group threads,
// broadcasts, system messages) to durable storage. The v17 Collective slice
// (`collective_channel_posts`) already migrated in Phase B v17 and is the
// authoritative table for chapter-channel posts — these tables only cover
// the non-Collective channels.
//
// Topology:
//   messages              — every individual message regardless of channel_type
//   message_threads       — persistent thread (DM/group/broadcast)
//   message_read_receipts — per-(message,user) read marker; UNIQUE(message_id,user_id)
//
// `messages.read_by` is a denormalized JSON cache for fast list reads;
// `message_read_receipts` is the authoritative source. Both updated inside
// the same SYNC tx by POST /api/messages/:id/read.
// ─────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  /** null when the message is not chapter-scoped (cross-chapter DMs, system messages). */
  chapterId: text("chapter_id"),
  /** FK to message_threads.id; null for one-shot non-thread messages (still legal). */
  threadId: text("thread_id"),
  /** 'direct' | 'group' | 'thread' | 'broadcast' | 'system' */
  channelType: text("channel_type").notNull(),
  senderUserId: text("sender_user_id").notNull(),
  /** JSON string[] of recipient userIds (for direct/group/broadcast). */
  recipientUserIds: text("recipient_user_ids").notNull().default("[]"),
  subject: text("subject"),
  body: text("body").notNull(),
  /** JSON string[] of URLs only — file storage is owned by Avi's infra. */
  attachments: text("attachments").notNull().default("[]"),
  /** JSON string[] of userIds who've read — denormalized cache; receipts table authoritative. */
  readBy: text("read_by").notNull().default("[]"),
  /** 'sent' | 'edited' | 'deleted' */
  status: text("status").notNull().default("sent"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const messageThreads = sqliteTable("message_threads", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  chapterId: text("chapter_id"),
  title: text("title").notNull().default(""),
  /** JSON string[] of participant userIds. */
  participantUserIds: text("participant_user_ids").notNull().default("[]"),
  /** FK to most recent message in this thread (for inbox ordering). */
  lastMessageId: text("last_message_id"),
  lastActivityAt: text("last_activity_at").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const messageReadReceipts = sqliteTable("message_read_receipts", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull(),
  userId: text("user_id").notNull(),
  readAt: text("read_at").notNull(),
});

// ─────────────────────────────────────────────────────────────
// v19 Phase B — Partner workspace remaining non-Collective slices.
//
// The v17 Phase B Collective slice (`partner_deal_promotions`) is already
// DB-backed. These three additional tables promote the partner-private
// workspace surfaces (portfolio companies, CRM contacts, deal pipeline)
// from in-memory to durable storage. Hash-chained on portfolio + deal
// pipeline (audit-grade); CRM contacts is a working scratch table.
// ─────────────────────────────────────────────────────────────
export const partnerPortfolioCompanies = sqliteTable("partner_portfolio_companies", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  companyId: text("company_id").notNull(),
  displayName: text("display_name").notNull(),
  /** 'seed' | 'series_a' | 'series_b' | 'growth' | 'late_stage' */
  stage: text("stage").notNull().default("seed"),
  sector: text("sector").notNull().default(""),
  leadInvestedAmountMinor: integer("lead_invested_amount_minor").notNull().default(0),
  firstInvestedAt: text("first_invested_at"),
  notes: text("notes").notNull().default(""),
  /** 'private' | 'collective' | 'public' */
  visibility: text("visibility").notNull().default("private"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const partnerCrmContacts = sqliteTable("partner_crm_contacts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  /** Nullable: contact may not have a platform account. */
  contactUserId: text("contact_user_id"),
  email: text("email").notNull().default(""),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  org: text("org").notNull().default(""),
  lastContactAt: text("last_contact_at"),
  notes: text("notes").notNull().default(""),
  /** JSON string[] of tags. */
  tags: text("tags").notNull().default("[]"),
  /**
   * Hash chain (CP-008 / CP Phase A). Added in migration 0042. Default '' so
   * existing rows can backfill cleanly; the chain stitcher in
   * server/lib/partnerCrmChainStitch.ts walks all rows in created_at order
   * and writes real hashes once, on first boot.
   */
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const partnerDealPipeline = sqliteTable("partner_deal_pipeline", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  companyId: text("company_id").notNull(),
  /** 'sourced' | 'screening' | 'diligence' | 'term_sheet' | 'closed' | 'passed' */
  stage: text("stage").notNull().default("sourced"),
  /** JSON string[] of assigned userIds. */
  assignedUserIds: text("assigned_user_ids").notNull().default("[]"),
  targetCloseAt: text("target_close_at"),
  notes: text("notes").notNull().default(""),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull(),
  /**
   * CP Phase A / CP-019: legacy in-memory pipeline rows migrated on startup
   * carry their original legacy id here for forensic backfill. NULL for
   * DB-native rows.
   */
  legacyId: text("legacy_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

/* ============================================================
 * v19 Phase C — audit_chain_verifications
 *
 * One row per quarterly auto-verify run (or manual verify). Records the
 * outcome of walking a single hash-chained table; the chapter-admin UI
 * reads the history of these rows to confirm continuous integrity.
 * ============================================================ */
export const auditChainVerifications = sqliteTable("audit_chain_verifications", {
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
  /** Optional JSON blob with the full ChainVerifyResult for forensic recall. */
  detailsJson: text("details_json"),
});

/* ============================================================
 * CP Phase A — SPV / Fund DB migration (CP-028 / migration 0041).
 *
 * Hybrid Map+DB stores live in server/spvFundStore.ts. All five tables
 * are hash-chained per partner_id-scoped chain: prev_hash + curr_hash.
 *
 * MATH SACRED: amount math is BigInt throughout (see spvFundStore.ts).
 * cap-table-engine and captableCommitStore.ts lines 354-477 are NOT
 * touched.
 * ============================================================ */

export const spvs = sqliteTable("spvs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  partnerId: text("partner_id").notNull(),
  name: text("name").notNull(),
  /** Nullable FK to companies — the company the SPV invests into. */
  leadCompanyId: text("lead_company_id"),
  /** 'spv' | 'fund' | 'syndicate' */
  structureType: text("structure_type").notNull().default("spv"),
  /** 'forming' | 'fundraising' | 'active' | 'wound_down' */
  status: text("status").notNull().default("forming"),
  targetMinor: integer("target_minor").notNull().default(0),
  /** Denormalised aggregates (kept in lockstep inside the same SYNC tx). */
  committedMinor: integer("committed_minor").notNull().default(0),
  calledMinor: integer("called_minor").notNull().default(0),
  distributedMinor: integer("distributed_minor").notNull().default(0),
  gpUserId: text("gp_user_id"),
  formedAt: text("formed_at"),
  closesAt: text("closes_at"),
  /** JSON: { carryPct, mgmtFeePct, hurdlePct, ... }. */
  terms: text("terms").notNull().default("{}"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const spvCommitments = sqliteTable("spv_commitments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  lpUserId: text("lp_user_id").notNull(),
  amountMinor: integer("amount_minor").notNull().default(0),
  /** 'pending' | 'signed' | 'funded' | 'withdrawn' */
  status: text("status").notNull().default("pending"),
  commitmentDocUrl: text("commitment_doc_url"),
  signedAt: text("signed_at"),
  fundedAt: text("funded_at"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const spvCapitalCalls = sqliteTable("spv_capital_calls", {
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

export const spvDistributions = sqliteTable("spv_distributions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  /** 'dividend' | 'exit' | 'return_of_capital' */
  distributionType: text("distribution_type").notNull().default("dividend"),
  totalMinor: integer("total_minor").notNull().default(0),
  distributedAt: text("distributed_at").notNull(),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const spvPositions = sqliteTable("spv_positions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  spvId: text("spv_id").notNull(),
  securityId: text("security_id").notNull(),
  /** TEXT for arbitrary-precision share count. */
  shares: text("shares").notNull().default("0"),
  basisMinor: integer("basis_minor").notNull().default(0),
  acquiredAt: text("acquired_at"),
  /** 'held' | 'partially_sold' | 'exited' */
  status: text("status").notNull().default("held"),
  prevHash: text("prev_hash"),
  currHash: text("curr_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ============================================================
 * CP Phase A — One-time backfill / chain stitch tracker (CP-008).
 *
 * Tracks one-shot startup utilities so they only run once per DB.
 * ============================================================ */

export const migrationsApplied = sqliteTable("_migrations_applied", {
  key: text("key").primaryKey(),
  appliedAt: text("applied_at").notNull(),
  details: text("details").notNull().default(""),
});

/* ============================================================
 * CP Phase B — Consortium Apply-to-Join (CP-001..CP-005).
 *
 * Audit-grade: every state transition appends a chained row.
 * `tenant_id` is NULL until provisioning (status='approved') because the
 * applicant has no tenant yet. The audit chain partition key is
 * (provisioned-or-genesis 'apply') so the chain forms one global stream
 * keyed by application id.
 * ============================================================ */
export const consortiumApplications = sqliteTable("consortium_applications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  expectedChapterId: text("expected_chapter_id"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone"),
  organizationName: text("organization_name").notNull(),
  website: text("website"),
  jurisdiction: text("jurisdiction").notNull().default(""),
  /** 'vc' | 'syndicate' | 'family_office' | 'angel_network' | 'other' */
  partnerType: text("partner_type").notNull().default("other"),
  /** '<10M' | '10-50M' | '50-250M' | '250M-1B' | '>1B' | 'undisclosed' */
  aumRange: text("aum_range").notNull().default("undisclosed"),
  portfolioCompanyCount: integer("portfolio_company_count").notNull().default(0),
  expectedChapter: text("expected_chapter").notNull().default(""),
  introMessage: text("intro_message").notNull().default(""),
  referredBy: text("referred_by"),
  sourceIp: text("source_ip"),
  sourceUserAgent: text("source_user_agent"),
  /** 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn' */
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

/** CP Phase B — partner organizations (CP-002). */
export const partnerOrganizations = sqliteTable("partner_organizations", {
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
  /** 'active' | 'paused' | 'wound_down' */
  status: text("status").notNull().default("active"),
  /** JSON-serialized onboarding checklist state (CP Phase B onboarding). */
  onboardingState: text("onboarding_state").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/* ============================================================
 * CP Phase B — GDPR/CCPA delete + export logs (CP-013).
 * ============================================================ */
export const dataExportLog = sqliteTable("data_export_log", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  exportedAt: text("exported_at").notNull(),
  format: text("format").notNull().default("json"),
  bytes: integer("bytes").notNull().default(0),
  requestIp: text("request_ip"),
  createdAt: text("created_at").notNull(),
});

export const dataDeleteLog = sqliteTable("data_delete_log", {
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
