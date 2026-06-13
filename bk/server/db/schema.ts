/**
 * Sprint 17 D1 — Drizzle schemas for the 24 canonical sync entities.
 *
 * These tables mirror the Zod canonical schemas in `shared/schemas/sync/*`
 * and are designed to be Postgres-compatible (we use `text`/`integer`/`real`
 * which map cleanly to Postgres `text`/`bigint`/`double precision`).
 *
 * For Sprint 17 preview, we run on better-sqlite3 in-memory; production
 * cutover to Postgres runs `drizzle-kit generate:pg` against the same
 * column names + types (see `DEPLOYMENT_PLAN.md`).
 *
 * Storage payload columns are JSON-encoded text to keep the table shape
 * stable while individual entities evolve. Hot fields (id, updatedAt,
 * tenantId, version) are first-class for indexing.
 */
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/* ============================================================
 * Generic envelope used by every sync entity. Each row keeps its
 * canonical document under `payload` (Zod-validated on write), with
 * common index columns extracted for query speed.
 * ============================================================ */
const baseColumns = {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id"),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
  payload: text("payload").notNull(), // JSON-encoded canonical document
};

/* ============================================================
 *  THE 24 SYNC ENTITIES
 * ============================================================ */
export const syncCompany = sqliteTable("sync_company", {
  ...baseColumns,
  name: text("name"),
  sector: text("sector"),
  stage: text("stage"),
});

export const syncInvestor = sqliteTable("sync_investor", {
  ...baseColumns,
  email: text("email"),
  type: text("type"),
});

export const syncCapTablePosition = sqliteTable("sync_cap_table_position", {
  ...baseColumns,
  companyId: text("company_id"),
  holderId: text("holder_id"),
});

export const syncSoftCircle = sqliteTable("sync_soft_circle", {
  ...baseColumns,
  roundId: text("round_id"),
  investorId: text("investor_id"),
});

export const syncRound = sqliteTable("sync_round", {
  ...baseColumns,
  companyId: text("company_id"),
  state: text("state"),
});

export const syncMaIntelligence = sqliteTable("sync_ma_intelligence", {
  ...baseColumns,
  companyId: text("company_id"),
});

export const syncEligibilitySnapshot = sqliteTable("sync_eligibility_snapshot", {
  ...baseColumns,
  investorId: text("investor_id"),
});

export const syncLifecyclePolicy = sqliteTable("sync_lifecycle_policy", {
  ...baseColumns,
  scope: text("scope"),
});

export const syncAuditEntry = sqliteTable("sync_audit_entry", {
  ...baseColumns,
  hashChain: text("hash_chain"),
  actorId: text("actor_id"),
  action: text("action"),
});

export const syncKycRecord = sqliteTable("sync_kyc_record", {
  ...baseColumns,
  subjectId: text("subject_id"),
  status: text("status"),
});

export const syncAccreditation = sqliteTable("sync_accreditation", {
  ...baseColumns,
  investorId: text("investor_id"),
  status: text("status"),
});

export const syncMemberTier = sqliteTable("sync_member_tier", {
  ...baseColumns,
  userId: text("user_id"),
  tier: text("tier"),
});

export const syncConsortiumPartner = sqliteTable("sync_consortium_partner", {
  ...baseColumns,
  region: text("region"),
});

export const syncTermSheet = sqliteTable("sync_term_sheet", {
  ...baseColumns,
  roundId: text("round_id"),
  state: text("state"),
});

export const syncDataroomPermission = sqliteTable("sync_dataroom_permission", {
  ...baseColumns,
  fileId: text("file_id"),
  granteeId: text("grantee_id"),
});

export const syncDataroomFileMeta = sqliteTable("sync_dataroom_file_meta", {
  ...baseColumns,
  companyId: text("company_id"),
  filename: text("filename"),
});

export const syncNotificationPrefs = sqliteTable("sync_notification_prefs", {
  ...baseColumns,
  userId: text("user_id"),
});

export const syncPricingTier = sqliteTable("sync_pricing_tier", {
  ...baseColumns,
  tier: text("tier"),
});

export const syncCommsThread = sqliteTable("sync_comms_thread", {
  ...baseColumns,
  channelId: text("channel_id"),
});

export const syncPcrmContact = sqliteTable("sync_pcrm_contact", {
  ...baseColumns,
  ownerId: text("owner_id"),
  email: text("email"),
});

export const syncPost = sqliteTable("sync_post", {
  ...baseColumns,
  authorId: text("author_id"),
  channelId: text("channel_id"),
});

export const syncReport = sqliteTable("sync_report", {
  ...baseColumns,
  companyId: text("company_id"),
  period: text("period"),
});

export const syncSpvScore = sqliteTable("sync_spv_score", {
  ...baseColumns,
  investorId: text("investor_id"),
});

export const syncSocialSignal = sqliteTable("sync_social_signal", {
  ...baseColumns,
  subjectId: text("subject_id"),
});

/* ============================================================
 *  Sprint 17 D2 + D6 — auth, sessions, security
 * ============================================================ */
export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordAlgo: text("password_algo").notNull().default("argon2id"),
  role: text("role").notNull().default("founder"),
  status: text("status").notNull().default("active"), // active | suspended | pending
  totpSecret: text("totp_secret"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull(),
  // Sprint 18 Phase 2 — welcome page acknowledgement (T1)
  welcomeAck: integer("welcome_ack").notNull().default(0),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(), // session id (jti)
  userId: text("user_id").notNull(),
  refreshTokenHash: text("refresh_token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  issuedAt: text("issued_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revoked: integer("revoked").notNull().default(0),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const authRedeemTokens = sqliteTable("auth_redeem_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  intent: text("intent").notNull(), // signup | reset | invite
  consumedAt: text("consumed_at"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

/* ============================================================
 *  All-table registry (used by migration generator + sync stores)
 * ============================================================ */
export const SYNC_TABLES = {
  company: syncCompany,
  investor: syncInvestor,
  capTablePosition: syncCapTablePosition,
  softCircle: syncSoftCircle,
  round: syncRound,
  maIntelligence: syncMaIntelligence,
  eligibilitySnapshot: syncEligibilitySnapshot,
  lifecyclePolicy: syncLifecyclePolicy,
  auditEntry: syncAuditEntry,
  kycRecord: syncKycRecord,
  accreditation: syncAccreditation,
  memberTier: syncMemberTier,
  consortiumPartner: syncConsortiumPartner,
  termSheet: syncTermSheet,
  dataroomPermission: syncDataroomPermission,
  dataroomFileMeta: syncDataroomFileMeta,
  notificationPrefs: syncNotificationPrefs,
  pricingTier: syncPricingTier,
  commsThread: syncCommsThread,
  pcrmContact: syncPcrmContact,
  post: syncPost,
  report: syncReport,
  spvScore: syncSpvScore,
  socialSignal: syncSocialSignal,
} as const;

export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as Array<keyof typeof SYNC_TABLES>;
export type SyncTableName = keyof typeof SYNC_TABLES;
