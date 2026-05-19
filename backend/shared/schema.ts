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

/* ----- identity & tenancy (R165 §2.1) ----- */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // "founder" | "investor"
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(), // "founder" | "investor" | "admin"
  avatarUrl: text("avatar_url"),
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
});

export const companyMembers = sqliteTable("company_members", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // founder | board | exec | viewer
  title: text("title"),
});

/* ----- cap table (R200 §6 / Cap Table Engine §10) ----- */
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
});

/* ----- rounds + invitations (Investor Invitation Subsystem §9) ----- */
export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
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
});

/* ----- dataroom (§12) ----- */
export const dataroomFiles = sqliteTable("dataroom_files", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  category: text("category").notNull(), // mgmt | product | sales | tech_it | ops | regulatory | legal | financials | press | misc | term_sheet
  name: text("name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  mime: text("mime").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  uploadedBy: text("uploaded_by"),
});

/* ----- audit log (R165 §12, hash chain) ----- */
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
  companyId: text("company_id").notNull(),
  planLabel: text("plan_label").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull(),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull(),
  status: text("status").notNull(),            // draft | issued | paid | refunded | void
  issuedAt: text("issued_at").notNull(),
  paidAt: text("paid_at"),
  version: integer("version").notNull().default(1),
  prevRevisionHash: text("prev_revision_hash").notNull(),
  revisionHash: text("revision_hash").notNull(),
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
