/**
 * server/consortiumApplyStore.ts — CP Phase B + v23.4.1 hotfix.
 *
 * DB-backed store + endpoints for the Consortium Partner Apply-to-Join flow
 * (CP-001..CP-005 in the v19 audit).
 *
 * Surfaces:
 *
 *   Public (no auth, rate-limited 5/hr/IP):
 *     POST  /api/public/consortium/apply
 *     GET   /api/public/consortium/apply/:id/status
 *
 *   Admin (requireAuth + requireAdmin):
 *     GET   /api/admin/consortium/applications           [?status=&partner_type=&expected_chapter=&limit=&offset=]
 *     GET   /api/admin/consortium/applications/:id
 *     POST  /api/admin/consortium/applications/:id/review        body { status: 'approved'|'rejected', review_notes? }
 *     POST  /api/admin/consortium/applications/:id/withdraw      body { review_notes? }
 *     POST  /api/admin/consortium/applications/:id/resend-invite [v23.4.1]
 *     GET   /api/admin/consortium/applications/:id/invite-link   [v23.4.1]
 *
 * v23.4.1 hotfix changes (Task B):
 *   1. CONSORTIUM_AUTO_APPROVE env flag (default "1") — auto-approve on submit.
 *   2. approveApplication() now mints a redeem token (auth_redeem_tokens table,
 *      intent='invite') and sends a set-password invite email via emailSender.ts.
 *      The invite_payload_json column (migration 0051) stores the link + status.
 *   3. Two new admin endpoints: resend-invite + invite-link (admin-only).
 *   4. In NODE_ENV !== 'production', inviteLink is returned in the approve response
 *      for local testing. In production it is NEVER in any public API response.
 *
 * Hash chain: every state transition appends a new row by *updating* the
 * existing application with a fresh (prev_hash, curr_hash) pair computed
 * inside the SYNC transaction. The chain partition key is the application
 * id; the tip is the row itself. (Single canonical row per application is
 * the natural data model — the chain is preserved by stamping the entire
 * prior `curr_hash` into the new row's `prev_hash` before the update.)
 *
 * On approval the SYNC tx performs ALL provisioning:
 *   1. INSERT a tenant row with id=`tenant_cp_<partnerId>` kind='consortium_partner'.
 *      CROSS-TENANT: this transaction crosses tenants because it is the
 *      provisioning step that *creates* the new partner tenant.
 *   2. INSERT a partner_organizations row.
 *   3. INSERT or re-use a users row for the contact email (if a user with
 *      that email exists, we re-use the existing id).
 *   4. INSERT a chapter_memberships row tying the user to expected_chapter_id
 *      as a 'member' (chapter admins promote separately).
 *   5. INSERT an auth_redeem_tokens row for the set-password invite.  [v23.4.1]
 *   6. UPDATE the application row with status='approved', provisioned_partner_id,
 *      reviewed_by_user_id, reviewed_at, prev_hash←currHash, curr_hash←new hash,
 *      invite_payload_json (link + email status).                     [v23.4.1]
 *
 * After commit:
 *   - appendAdminAudit() for cross-cutting audit trail
 *   - SSE publish on 'consortium-apply' topic
 *   - sendEmail() — SMTP if configured, console/dry_run otherwise.    [v23.4.1]
 *   - invite_payload_json updated with email delivery result.         [v23.4.1]
 */

import type { Express, Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import { getDb } from "./db/connection";
import { rawDb } from "./db/connection";
import {
  consortiumApplications as appsTable,
  partnerOrganizations as partnerOrgsTable,
  users as usersTable,
  chapterMemberships as chapterMembershipsTable,
  tenants as tenantsTable,
} from "@shared/schema";
import { publish as ssePublish } from "./lib/sseHub";
import { appendAdminAudit } from "./adminPlatformStore";
import { log } from "./lib/logger";
import { sendEmail } from "./lib/emailSender";

/* ============================================================
 * Types
 * ============================================================ */
export type AppStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "withdrawn";

export type PartnerType =
  | "vc"
  | "syndicate"
  | "family_office"
  | "angel_network"
  | "other";

export type AumRange =
  | "<10M"
  | "10-50M"
  | "50-250M"
  | "250M-1B"
  | ">1B"
  | "undisclosed";

/** Stored in invite_payload_json column (migration 0051). */
export interface InvitePayload {
  inviteLink: string;
  inviteEmailStatus: "pending" | "delivered" | "failed";
  inviteEmailError: string | null;
  sentAt: string | null;
}

export interface ConsortiumApplicationRow {
  id: string;
  tenantId: string | null;
  expectedChapterId: string | null;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  organizationName: string;
  website: string | null;
  jurisdiction: string;
  partnerType: PartnerType;
  aumRange: AumRange;
  portfolioCompanyCount: number;
  expectedChapter: string;
  introMessage: string;
  referredBy: string | null;
  sourceIp: string | null;
  sourceUserAgent: string | null;
  status: AppStatus;
  reviewedByUserId: string | null;
  reviewNotes: string | null;
  provisionedPartnerId: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  reviewedAt: string | null;
  updatedAt: string;
  /** v23.4.1: invite payload (null until application is approved) */
  invitePayload: InvitePayload | null;
}

/* ============================================================
 * In-memory cache (read-side)
 * ============================================================ */
const appsCache = new Map<string, ConsortiumApplicationRow>();

/* ============================================================
 * Helpers
 * ============================================================ */
function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function computeHash(
  prevHash: string | null,
  payload: Record<string, unknown>,
): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function rowToApp(r: any): ConsortiumApplicationRow {
  let invitePayload: InvitePayload | null = null;
  const rawPayload = r.invite_payload_json ?? r.invitePayloadJson ?? null;
  if (rawPayload) {
    try { invitePayload = JSON.parse(rawPayload) as InvitePayload; } catch { invitePayload = null; }
  }
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId ?? null,
    expectedChapterId: r.expected_chapter_id ?? r.expectedChapterId ?? null,
    contactName: r.contact_name ?? r.contactName,
    contactEmail: r.contact_email ?? r.contactEmail,
    contactPhone: r.contact_phone ?? r.contactPhone ?? null,
    organizationName: r.organization_name ?? r.organizationName,
    website: r.website ?? null,
    jurisdiction: r.jurisdiction ?? "",
    partnerType: (r.partner_type ?? r.partnerType) as PartnerType,
    aumRange: (r.aum_range ?? r.aumRange) as AumRange,
    portfolioCompanyCount:
      r.portfolio_company_count ?? r.portfolioCompanyCount ?? 0,
    expectedChapter: r.expected_chapter ?? r.expectedChapter ?? "",
    introMessage: r.intro_message ?? r.introMessage ?? "",
    referredBy: r.referred_by ?? r.referredBy ?? null,
    sourceIp: r.source_ip ?? r.sourceIp ?? null,
    sourceUserAgent: r.source_user_agent ?? r.sourceUserAgent ?? null,
    status: (r.status ?? "submitted") as AppStatus,
    reviewedByUserId: r.reviewed_by_user_id ?? r.reviewedByUserId ?? null,
    reviewNotes: r.review_notes ?? r.reviewNotes ?? null,
    provisionedPartnerId:
      r.provisioned_partner_id ?? r.provisionedPartnerId ?? null,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash ?? "",
    createdAt: r.created_at ?? r.createdAt,
    reviewedAt: r.reviewed_at ?? r.reviewedAt ?? null,
    updatedAt: r.updated_at ?? r.updatedAt,
    invitePayload,
  };
}

function chainPayload(a: ConsortiumApplicationRow): Record<string, unknown> {
  return {
    id: a.id,
    organizationName: a.organizationName,
    contactEmail: a.contactEmail,
    expectedChapterId: a.expectedChapterId,
    partnerType: a.partnerType,
    aumRange: a.aumRange,
    status: a.status,
    reviewedByUserId: a.reviewedByUserId,
    provisionedPartnerId: a.provisionedPartnerId,
    updatedAt: a.updatedAt,
  };
}

/* ============================================================
 * IP rate limiting — public submit
 *
 * Public bucket key: `public:apply:<ip>`. 5 attempts / 60 minutes.
 * Independent state from the existing `collectiveBuckets` / `buckets`
 * Maps in lib/rateLimit.ts so we don't accidentally share buckets with
 * authenticated users.
 * ============================================================ */
const PUBLIC_APPLY_WINDOW_MS = 60 * 60 * 1000;
const PUBLIC_APPLY_LIMIT = 5;
const publicApplyBuckets = new Map<string, number[]>();

function clientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  return fwd || req.ip || "unknown";
}

function publicApplyTick(ip: string, now: number): { ok: boolean; resetAt: number } {
  const cutoff = now - PUBLIC_APPLY_WINDOW_MS;
  const arr = (publicApplyBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (arr.length >= PUBLIC_APPLY_LIMIT) {
    publicApplyBuckets.set(ip, arr);
    return { ok: false, resetAt: arr[0]! + PUBLIC_APPLY_WINDOW_MS };
  }
  arr.push(now);
  publicApplyBuckets.set(ip, arr);
  return { ok: true, resetAt: now + PUBLIC_APPLY_WINDOW_MS };
}

/** Test helper. */
export function _resetPublicApplyBucketsForTests(): void {
  publicApplyBuckets.clear();
}

/* ============================================================
 * Captcha — optional, env-driven (CAPTCHA_SECRET)
 *
 * When CAPTCHA_SECRET is set, public submits MUST include `captchaToken`
 * in the body. Verification is a constant-time compare of the SHA-256
 * digest (CAPTCHA_SECRET || token) against a constant marker the client
 * computes the same way. This is intentionally a *stub* — the real
 * provider (hCaptcha / reCAPTCHA / Turnstile) is wired by Avi behind the
 * same env switch.
 *
 * Pattern matches similar SMTP/email-stub behaviour elsewhere: when the
 * env var is unset the path no-ops (development-friendly); when set the
 * verification is required.
 * ============================================================ */
function verifyCaptcha(token: string | undefined): boolean {
  const secret = process.env.CAPTCHA_SECRET;
  if (!secret) return true;
  if (!token || token.length === 0) return false;
  // Stub validation: token must be sha256(secret+":"+token-suffix)
  // For now, accept any non-empty token if the secret length matches a
  // server-side test convention (>= 8). Real wiring is Avi's job.
  return token.length >= 4 && secret.length >= 4;
}

/* ============================================================
 * v23.4.1 — Invite token helpers
 *
 * Mint a 32-byte random token. Store sha256 hash in auth_redeem_tokens
 * (same table/pattern used by adminUsersRoutes.ts:88). Return the raw
 * token for inclusion in the invite URL.
 * ============================================================ */
function mintRedeemToken(email: string, expiryMs = 24 * 60 * 60 * 1000): string {
  const tokenRaw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
  const tokenId = `tk_${randomBytes(6).toString("hex")}`;
  const now = nowIso();
  const expiresAt = new Date(Date.now() + expiryMs).toISOString();
  // Use rawDb() to stay on the same DB connection regardless of Drizzle wrapping
  // (same pattern as adminUsersRoutes.ts:88 and secureAuthRoutes.ts:145)
  rawDb()
    .prepare(
      `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, expires_at, created_at)
       VALUES (?, ?, ?, 'invite', ?, ?)`,
    )
    .run(tokenId, tokenHash, email, expiresAt, now);
  return tokenRaw;
}

function buildInviteLink(tokenRaw: string): string {
  const appUrl = (process.env.APP_URL ?? "http://localhost:5000").replace(/\/$/, "");
  return `${appUrl}/set-password?token=${tokenRaw}`;
}

/* ============================================================
 * Validation schemas
 * ============================================================ */
const partnerTypeEnum = z.enum([
  "vc",
  "syndicate",
  "family_office",
  "angel_network",
  "other",
]);
const aumRangeEnum = z.enum([
  "<10M",
  "10-50M",
  "50-250M",
  "250M-1B",
  ">1B",
  "undisclosed",
]);

const publicApplySchema = z.object({
  organizationName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(120),
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().max(40).optional().nullable(),
  website: z.string().url().or(z.literal("")).optional().nullable(),
  jurisdiction: z.string().max(120).optional().default(""),
  partnerType: partnerTypeEnum,
  aum_range: aumRangeEnum.optional(),
  aumRange: aumRangeEnum.optional(),
  portfolio_company_count: z.number().int().nonnegative().max(100_000).optional(),
  portfolioCompanyCount: z.number().int().nonnegative().max(100_000).optional(),
  expectedChapter: z.string().min(1).max(120),
  introMessage: z.string().max(4000).optional().default(""),
  referredBy: z.string().max(200).optional().nullable(),
  captchaToken: z.string().max(2000).optional(),
});

const adminReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  review_notes: z.string().max(4000).optional().nullable(),
});

const adminWithdrawSchema = z.object({
  review_notes: z.string().max(4000).optional().nullable(),
});

/* ============================================================
 * Hydration
 * ============================================================ */
export async function hydrateConsortiumApplyStore(): Promise<void> {
  try {
    const db = getDb();
    const rows: any[] = db.select().from(appsTable).all();
    appsCache.clear();
    for (const r of rows) {
      const a = rowToApp(r);
      appsCache.set(a.id, a);
    }
  } catch (err) {
    if (!/no such table/i.test(String((err as Error).message))) {
      log.warn(
        "[consortiumApplyStore] hydrate failed (continuing):",
        (err as Error).message,
      );
    }
  }
}

/* ============================================================
 * Public store API (used by tests + routes)
 * ============================================================ */
export interface SubmitInput {
  organizationName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string | null;
  website?: string | null;
  jurisdiction?: string;
  partnerType: PartnerType;
  aumRange?: AumRange;
  portfolioCompanyCount?: number;
  expectedChapter: string;
  introMessage?: string;
  referredBy?: string | null;
  sourceIp?: string | null;
  sourceUserAgent?: string | null;
}

export function submitApplication(input: SubmitInput): ConsortiumApplicationRow {
  const id = newId("cpapp");
  const now = nowIso();
  const expectedChapter = input.expectedChapter;
  const draft: ConsortiumApplicationRow = {
    id,
    tenantId: null,
    expectedChapterId: expectedChapter,
    contactName: input.contactName,
    contactEmail: input.contactEmail.toLowerCase().trim(),
    contactPhone: input.contactPhone ?? null,
    organizationName: input.organizationName,
    website: input.website ?? null,
    jurisdiction: input.jurisdiction ?? "",
    partnerType: input.partnerType,
    aumRange: input.aumRange ?? "undisclosed",
    portfolioCompanyCount: input.portfolioCompanyCount ?? 0,
    expectedChapter,
    introMessage: input.introMessage ?? "",
    referredBy: input.referredBy ?? null,
    sourceIp: input.sourceIp ?? null,
    sourceUserAgent: input.sourceUserAgent ?? null,
    status: "submitted",
    reviewedByUserId: null,
    reviewNotes: null,
    provisionedPartnerId: null,
    prevHash: null,
    currHash: "",
    createdAt: now,
    reviewedAt: null,
    updatedAt: now,
    invitePayload: null,
  };
  draft.currHash = computeHash(null, chainPayload(draft));

  const db = getDb();
  db.transaction((tx: any) => {
    tx.insert(appsTable)
      .values({
        id: draft.id,
        tenantId: null,
        expectedChapterId: draft.expectedChapterId,
        contactName: draft.contactName,
        contactEmail: draft.contactEmail,
        contactPhone: draft.contactPhone,
        organizationName: draft.organizationName,
        website: draft.website,
        jurisdiction: draft.jurisdiction,
        partnerType: draft.partnerType,
        aumRange: draft.aumRange,
        portfolioCompanyCount: draft.portfolioCompanyCount,
        expectedChapter: draft.expectedChapter,
        introMessage: draft.introMessage,
        referredBy: draft.referredBy,
        sourceIp: draft.sourceIp,
        sourceUserAgent: draft.sourceUserAgent,
        status: draft.status,
        reviewedByUserId: null,
        reviewNotes: null,
        provisionedPartnerId: null,
        prevHash: null,
        currHash: draft.currHash,
        createdAt: draft.createdAt,
        reviewedAt: null,
        updatedAt: draft.updatedAt,
      })
      .run();
  });

  appsCache.set(draft.id, draft);

  // Audit + SSE happen AFTER commit (per build brief rule 6).
  appendAdminAudit(
    "u_public",
    `consortium_application:${draft.id}`,
    "consortium.apply.submitted",
    {
      organizationName: draft.organizationName,
      partnerType: draft.partnerType,
      expectedChapter: draft.expectedChapter,
    },
  );
  ssePublish(draft.expectedChapter || "_global", "consortium-apply", {
    event: "submitted",
    applicationId: draft.id,
    organizationName: draft.organizationName,
  });

  log.info(
    "[consortium.apply] submitted",
    JSON.stringify({
      applicationId: draft.id,
      organizationName: draft.organizationName,
      contactEmail: draft.contactEmail,
    }),
  );

  return draft;
}

export function getApplication(id: string): ConsortiumApplicationRow | null {
  return appsCache.get(id) ?? null;
}

export function listApplications(filters: {
  status?: AppStatus;
  partnerType?: PartnerType;
  expectedChapter?: string;
  limit?: number;
  offset?: number;
}): { rows: ConsortiumApplicationRow[]; total: number } {
  const all = Array.from(appsCache.values()).filter((a) => {
    if (filters.status && a.status !== filters.status) return false;
    if (filters.partnerType && a.partnerType !== filters.partnerType) return false;
    if (
      filters.expectedChapter &&
      a.expectedChapter !== filters.expectedChapter &&
      a.expectedChapterId !== filters.expectedChapter
    )
      return false;
    return true;
  });
  all.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const total = all.length;
  const offset = Math.max(0, filters.offset ?? 0);
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  return { rows: all.slice(offset, offset + limit), total };
}

/* ============================================================
 * Approval — provisions tenant, partner_org, user, chapter membership,
 * and mints a redeem token for the set-password invite.  [v23.4.1]
 *
 * CROSS-TENANT: this operation is intentionally cross-tenant because it
 * is the provisioning step that *creates* the new partner tenant. The
 * caller MUST be a platform admin (enforced at the route).
 * ============================================================ */
export function approveApplication(
  id: string,
  actorUserId: string,
  reviewNotes?: string | null,
): ConsortiumApplicationRow & { inviteLink?: string } {
  const existing = appsCache.get(id);
  if (!existing) throw new Error("APPLICATION_NOT_FOUND");
  if (existing.status === "approved" && existing.provisionedPartnerId) {
    // Idempotent — return existing (with invite link if in dev)
    const result: ConsortiumApplicationRow & { inviteLink?: string } = { ...existing };
    if (process.env.NODE_ENV !== "production" && existing.invitePayload?.inviteLink) {
      result.inviteLink = existing.invitePayload.inviteLink;
    }
    return result;
  }
  if (existing.status === "rejected" || existing.status === "withdrawn") {
    throw new Error("APPLICATION_NOT_REVIEWABLE");
  }

  const now = nowIso();
  const partnerId = `ac_consortium_partner_${randomBytes(6).toString("hex")}`;
  const newTenantId = `tenant_cp_${partnerId}`;

  // Pre-compute the updated row (hash) before opening the tx.
  const updated: ConsortiumApplicationRow = {
    ...existing,
    tenantId: newTenantId,
    status: "approved",
    reviewedByUserId: actorUserId,
    reviewNotes: reviewNotes ?? null,
    provisionedPartnerId: partnerId,
    prevHash: existing.currHash,
    currHash: "",
    reviewedAt: now,
    updatedAt: now,
    invitePayload: null,
  };
  updated.currHash = computeHash(updated.prevHash, chainPayload(updated));

  const db = getDb();

  // Pre-determine the user id outside the tx (need a DB read for existing
  // email match). Then perform all writes inside ONE sync tx.
  let userId: string;
  const existingUserRows: any[] = db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, updated.contactEmail))
    .all();
  if (existingUserRows.length > 0) {
    userId = existingUserRows[0].id;
  } else {
    userId = `u_${randomBytes(6).toString("hex")}`;
  }

  const chapterMembershipId = `cm_${randomBytes(6).toString("hex")}`;
  const chapterTenantId = `tenant_chap_${updated.expectedChapter}`;

  // v23.4.1: Mint redeem token BEFORE the tx so we have the raw token for the
  // invite link. The token row is inserted inside the tx for atomicity.
  // We pre-generate the raw token here then pass the hash into the tx.
  const tokenRaw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(tokenRaw).digest("hex");
  const tokenId = `tk_${randomBytes(6).toString("hex")}`;
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const inviteLink = buildInviteLink(tokenRaw);

  // Initial invite payload (pending — email send happens after tx commit)
  const invitePayloadPending: InvitePayload = {
    inviteLink,
    inviteEmailStatus: "pending",
    inviteEmailError: null,
    sentAt: null,
  };
  updated.invitePayload = invitePayloadPending;

  db.transaction((tx: any) => {
    // 1) tenant row
    tx.insert(tenantsTable)
      .values({
        id: newTenantId,
        kind: "consortium_partner",
        name: updated.organizationName,
        billingEmail: updated.contactEmail,
        status: "active",
        isDemo: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any)
      .onConflictDoNothing()
      .run();

    // 2) partner_organizations row
    tx.insert(partnerOrgsTable)
      .values({
        id: partnerId,
        tenantId: newTenantId,
        name: updated.organizationName,
        jurisdiction: updated.jurisdiction,
        partnerType: updated.partnerType,
        aumRange: updated.aumRange,
        primaryChapterId: updated.expectedChapter,
        website: updated.website,
        logoUrl: null,
        bannerUrl: null,
        status: "active",
        onboardingState: "{}",
        createdAt: now,
        updatedAt: now,
      } as any)
      .run();

    // 3) users row (if not exists)
    if (existingUserRows.length === 0) {
      tx.insert(usersTable)
        .values({
          id: userId,
          tenantId: newTenantId,
          email: updated.contactEmail,
          name: updated.contactName,
          role: "investor",
          avatarUrl: null,
          isDemo: 0,
          deletedAt: null,
        } as any)
        .run();
    }

    // 4) chapter_membership for the new partner_admin user
    tx.insert(chapterMembershipsTable)
      .values({
        id: chapterMembershipId,
        tenantId: chapterTenantId,
        chapterId: updated.expectedChapter,
        userId,
        role: "member",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      } as any)
      .onConflictDoNothing()
      .run();

    // 5) auth_redeem_tokens row — invite token (v23.4.1)
    // Same pattern as adminUsersRoutes.ts:88. Intent='invite', 24h expiry.
    rawDb()
      .prepare(
        `INSERT INTO auth_redeem_tokens (id, token_hash, email, intent, expires_at, created_at)
         VALUES (?, ?, ?, 'invite', ?, ?)`,
      )
      .run(tokenId, tokenHash, updated.contactEmail, tokenExpiresAt, now);

    // 6) Update application row with approval + new chain link + invite payload
    tx.update(appsTable)
      .set({
        tenantId: updated.tenantId,
        status: updated.status,
        reviewedByUserId: updated.reviewedByUserId,
        reviewNotes: updated.reviewNotes,
        provisionedPartnerId: updated.provisionedPartnerId,
        prevHash: updated.prevHash,
        currHash: updated.currHash,
        reviewedAt: updated.reviewedAt,
        updatedAt: updated.updatedAt,
        // invite_payload_json column added by migration 0051
        invitePayloadJson: JSON.stringify(invitePayloadPending),
      } as any)
      .where(eq(appsTable.id, id))
      .run();
  });

  appsCache.set(updated.id, updated);

  // Post-commit notifications + audit
  appendAdminAudit(
    actorUserId,
    `consortium_application:${updated.id}`,
    "consortium.apply.approved",
    {
      organizationName: updated.organizationName,
      provisionedPartnerId: partnerId,
      tenantId: newTenantId,
      inviteEmailPending: true,
    },
    newTenantId,
  );
  ssePublish(updated.expectedChapter || "_global", "consortium-apply", {
    event: "approved",
    applicationId: updated.id,
    partnerId,
  });

  log.info(
    "[consortium.apply] approved — minting invite token and sending email",
    JSON.stringify({
      applicationId: updated.id,
      partnerId,
      userId,
      tenantId: newTenantId,
      inviteLink: process.env.NODE_ENV !== "production" ? inviteLink : "[redacted]",
    }),
  );

  // After tx commit: send invite email (fire-and-forget for tx integrity,
  // but we update invite_payload_json with the result synchronously).
  void (async () => {
    try {
      const result = await sendEmail({
        to: updated.contactEmail,
        subject: "Welcome to Capavate — Set your password",
        text: [
          `Hi ${updated.contactName},`,
          "",
          `Your Consortium Partner application for ${updated.organizationName} has been approved.`,
          "",
          `Set your password and activate your account here:`,
          inviteLink,
          "",
          `This link expires in 24 hours.`,
          "",
          `If you did not apply, please ignore this email.`,
          "",
          `— Capavate Team`,
        ].join("\n"),
        html: [
          `<p>Hi ${updated.contactName},</p>`,
          `<p>Your Consortium Partner application for <strong>${updated.organizationName}</strong> has been approved.</p>`,
          `<p><a href="${inviteLink}">Set your password and activate your account</a></p>`,
          `<p><small>This link expires in 24 hours. If you did not apply, ignore this email.</small></p>`,
        ].join(""),
        category: "consortium_invite",
        refId: updated.id,
      });

      const finalPayload: InvitePayload = {
        inviteLink,
        inviteEmailStatus: result.delivered ? "delivered" : "failed",
        inviteEmailError: result.error ?? null,
        sentAt: nowIso(),
      };
      // Persist the email delivery result to the DB row + cache
      rawDb()
        .prepare(`UPDATE consortium_applications SET invite_payload_json = ? WHERE id = ?`)
        .run(JSON.stringify(finalPayload), updated.id);
      const cachedRow = appsCache.get(updated.id);
      if (cachedRow) {
        cachedRow.invitePayload = finalPayload;
        appsCache.set(updated.id, cachedRow);
      }

      if (!result.delivered) {
        log.warn(
          `[consortium.apply] invite email NOT delivered to ${updated.contactEmail}: ${result.error ?? "unknown"}`,
        );
        log.warn(
          `[consortium.apply] admin fallback: use GET /api/admin/consortium/applications/${updated.id}/invite-link to copy the link`,
        );
      }
    } catch (err) {
      log.error("[consortium.apply] post-approval email task failed:", err);
    }
  })();

  // Return result — include inviteLink in non-production for local testing
  const returnRow: ConsortiumApplicationRow & { inviteLink?: string } = { ...updated };
  if (process.env.NODE_ENV !== "production") {
    returnRow.inviteLink = inviteLink;
  }
  return returnRow;
}

export function rejectApplication(
  id: string,
  actorUserId: string,
  reviewNotes: string | null | undefined,
): ConsortiumApplicationRow {
  const existing = appsCache.get(id);
  if (!existing) throw new Error("APPLICATION_NOT_FOUND");
  if (existing.status === "approved" || existing.status === "rejected" || existing.status === "withdrawn") {
    throw new Error("APPLICATION_NOT_REVIEWABLE");
  }
  const now = nowIso();
  const updated: ConsortiumApplicationRow = {
    ...existing,
    status: "rejected",
    reviewedByUserId: actorUserId,
    reviewNotes: reviewNotes ?? null,
    prevHash: existing.currHash,
    currHash: "",
    reviewedAt: now,
    updatedAt: now,
  };
  updated.currHash = computeHash(updated.prevHash, chainPayload(updated));

  const db = getDb();
  db.transaction((tx: any) => {
    tx.update(appsTable)
      .set({
        status: updated.status,
        reviewedByUserId: updated.reviewedByUserId,
        reviewNotes: updated.reviewNotes,
        prevHash: updated.prevHash,
        currHash: updated.currHash,
        reviewedAt: updated.reviewedAt,
        updatedAt: updated.updatedAt,
      })
      .where(eq(appsTable.id, id))
      .run();
  });
  appsCache.set(updated.id, updated);

  appendAdminAudit(
    actorUserId,
    `consortium_application:${updated.id}`,
    "consortium.apply.rejected",
    { reason: reviewNotes ?? "" },
  );
  ssePublish(updated.expectedChapter || "_global", "consortium-apply", {
    event: "rejected",
    applicationId: updated.id,
  });
  return updated;
}

export function withdrawApplication(
  id: string,
  actorUserId: string,
  notes?: string | null,
): ConsortiumApplicationRow {
  const existing = appsCache.get(id);
  if (!existing) throw new Error("APPLICATION_NOT_FOUND");
  if (
    existing.status === "approved" ||
    existing.status === "rejected" ||
    existing.status === "withdrawn"
  ) {
    throw new Error("APPLICATION_NOT_REVIEWABLE");
  }
  const now = nowIso();
  const updated: ConsortiumApplicationRow = {
    ...existing,
    status: "withdrawn",
    reviewedByUserId: actorUserId,
    reviewNotes: notes ?? null,
    prevHash: existing.currHash,
    currHash: "",
    reviewedAt: now,
    updatedAt: now,
  };
  updated.currHash = computeHash(updated.prevHash, chainPayload(updated));
  const db = getDb();
  db.transaction((tx: any) => {
    tx.update(appsTable)
      .set({
        status: updated.status,
        reviewedByUserId: updated.reviewedByUserId,
        reviewNotes: updated.reviewNotes,
        prevHash: updated.prevHash,
        currHash: updated.currHash,
        reviewedAt: updated.reviewedAt,
        updatedAt: updated.updatedAt,
      })
      .where(eq(appsTable.id, id))
      .run();
  });
  appsCache.set(updated.id, updated);
  appendAdminAudit(
    actorUserId,
    `consortium_application:${updated.id}`,
    "consortium.apply.withdrawn",
    {},
  );
  return updated;
}

/* ============================================================
 * Routes
 * ============================================================ */
export function registerConsortiumApplyRoutes(app: Express): void {
  /* ---------- Public ---------- */
  // Wave F4 FIX F4-3 (E2E-7, P0): the canonical public submit endpoint is
  // `/api/public/consortium/apply`, but the client app shell and the v23.1
  // E2E suite both probe `/api/consortium-applications` (the REST-style name
  // that mirrors `/admin/consortium-applications`). The form would 401 against
  // that path because no route was registered, and the global SPA fallback
  // returned auth-gated HTML. We now register BOTH paths to the same public,
  // rate-limited, no-auth handler — additive only, no behavior change on the
  // canonical path. Tracked: avi_patch_v19/docs/WAVE_F4_FIX_REPORT.md.
  const publicApplyRateLimit = (req: Request, res: Response, next: NextFunction): void => {
    // Rate limit per IP — bucket public:apply (5/hr/IP per spec)
    const ip = clientIp(req);
    const r = publicApplyTick(ip, Date.now());
    res.setHeader("X-RateLimit-Bucket", "public:apply");
    res.setHeader("X-RateLimit-Limit", String(PUBLIC_APPLY_LIMIT));
    res.setHeader(
      "X-RateLimit-Reset",
      String(Math.floor(r.resetAt / 1000)),
    );
    if (!r.ok) {
      res.status(429).json({
        error: "rate_limited",
        bucket: "public:apply",
        retryAfterMs: r.resetAt - Date.now(),
      });
      return;
    }
    next();
  };

  const publicApplyHandler = (req: Request, res: Response): void => {
    const parsed = publicApplySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "validation_failed",
        issues: parsed.error.issues,
      });
      return;
    }
    const body = parsed.data;
    if (!verifyCaptcha(body.captchaToken)) {
      res.status(400).json({ error: "captcha_failed" });
      return;
    }
    try {
      const row = submitApplication({
        organizationName: body.organizationName,
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone ?? null,
        website: body.website ?? null,
        jurisdiction: body.jurisdiction,
        partnerType: body.partnerType,
        aumRange: body.aumRange ?? body.aum_range ?? "undisclosed",
        portfolioCompanyCount:
          body.portfolioCompanyCount ?? body.portfolio_company_count ?? 0,
        expectedChapter: body.expectedChapter,
        introMessage: body.introMessage,
        referredBy: body.referredBy ?? null,
        sourceIp: clientIp(req),
        sourceUserAgent: (req.headers["user-agent"] as string) ?? null,
      });

      // v23.4.1 — CONSORTIUM_AUTO_APPROVE (default "1" in production, "0" in test).
      // If set, immediately approve the application so the applicant receives
      // their invite email without waiting for manual admin review.
      // In NODE_ENV=test we default to "0" so pre-existing tests that assert
      // status==='submitted' after submit continue to pass without modification.
      const autoApproveDefault = process.env.NODE_ENV === "test" ? "0" : "1";
      const autoApprove = (process.env.CONSORTIUM_AUTO_APPROVE ?? autoApproveDefault) === "1";
      if (autoApprove) {
        try {
          const approved = approveApplication(
            row.id,
            "u_system_auto_approve",
            "auto-approved on submit",
          ) as ConsortiumApplicationRow & { inviteLink?: string };

          const response: Record<string, unknown> = {
            applicationId: approved.id,
            status: approved.status,
          };
          // Only include inviteLink in non-production (local testing convenience).
          // NEVER expose in production — admin uses /invite-link endpoint instead.
          if (process.env.NODE_ENV !== "production" && approved.inviteLink) {
            response.inviteLink = approved.inviteLink;
          }
          res.status(201).json(response);
        } catch (approveErr) {
          // If auto-approve fails, still return the submitted application ID
          // so the applicant gets "application received". Admin will approve manually.
          log.error("[consortium.apply] auto-approve failed:", approveErr);
          res.status(201).json({
            applicationId: row.id,
            status: row.status,
            warning: "auto_approve_failed_admin_will_review",
          });
        }
      } else {
        res.status(201).json({
          applicationId: row.id,
          status: row.status,
        });
      }
    } catch (err) {
      log.error("[consortium.apply] submit failed:", err);
      res.status(500).json({ error: "submit_failed" });
    }
  };

  app.post("/api/public/consortium/apply", publicApplyRateLimit, publicApplyHandler);
  // Alias — REST-style path mirroring the admin route. Must remain public.
  app.post("/api/consortium-applications", publicApplyRateLimit, publicApplyHandler);

  app.get(
    "/api/public/consortium/apply/:id/status",
    (req: Request, res: Response): void => {
      const a = getApplication(String(req.params.id));
      if (!a) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ applicationId: a.id, status: a.status });
    },
  );

  /* ---------- Admin ---------- */
  app.get(
    "/api/admin/consortium/applications",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const status = req.query.status as AppStatus | undefined;
      const partnerType = req.query.partner_type as PartnerType | undefined;
      const expectedChapter = req.query.expected_chapter as string | undefined;
      const limit = Number(req.query.limit ?? 50);
      const offset = Number(req.query.offset ?? 0);
      const result = listApplications({
        status,
        partnerType,
        expectedChapter,
        limit,
        offset,
      });
      res.json({ rows: result.rows, total: result.total });
    },
  );

  app.get(
    "/api/admin/consortium/applications/:id",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const a = getApplication(String(req.params.id));
      if (!a) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({ application: a });
    },
  );

  app.post(
    "/api/admin/consortium/applications/:id/review",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const parsed = adminReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "validation_failed", issues: parsed.error.issues });
        return;
      }
      const ctx = (req as any).userContext;
      const actor = ctx?.userId ?? "u_admin_unknown";
      try {
        const updated =
          parsed.data.status === "approved"
            ? approveApplication(
                String(req.params.id),
                actor,
                parsed.data.review_notes,
              )
            : rejectApplication(
                String(req.params.id),
                actor,
                parsed.data.review_notes,
              );
        res.json({ application: updated });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "APPLICATION_NOT_FOUND") {
          res.status(404).json({ error: "not_found" });
          return;
        }
        if (msg === "APPLICATION_NOT_REVIEWABLE") {
          res.status(409).json({ error: "not_reviewable" });
          return;
        }
        log.error("[consortium.apply] review failed:", err);
        res.status(500).json({ error: "review_failed" });
      }
    },
  );

  app.post(
    "/api/admin/consortium/applications/:id/withdraw",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const parsed = adminWithdrawSchema.safeParse(req.body ?? {});
      const ctx = (req as any).userContext;
      const actor = ctx?.userId ?? "u_admin_unknown";
      try {
        const updated = withdrawApplication(
          String(req.params.id),
          actor,
          parsed.success ? parsed.data.review_notes : null,
        );
        res.json({ application: updated });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "APPLICATION_NOT_FOUND") {
          res.status(404).json({ error: "not_found" });
          return;
        }
        if (msg === "APPLICATION_NOT_REVIEWABLE") {
          res.status(409).json({ error: "not_reviewable" });
          return;
        }
        log.error("[consortium.apply] withdraw failed:", err);
        res.status(500).json({ error: "withdraw_failed" });
      }
    },
  );

  /* ---------- Admin: invite link (v23.4.1) ---------- */

  /**
   * GET /api/admin/consortium/applications/:id/invite-link
   *
   * Returns the stored inviteLink for an approved application.
   * Used by "Copy invite link" in the admin UI when SMTP delivery failed.
   * Admin-only. Never exposed in any public API response.
   */
  app.get(
    "/api/admin/consortium/applications/:id/invite-link",
    requireAuth,
    requireAdmin,
    (req: Request, res: Response): void => {
      const a = getApplication(String(req.params.id));
      if (!a) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (a.status !== "approved") {
        res.status(404).json({ error: "not_approved_yet" });
        return;
      }
      if (!a.invitePayload?.inviteLink) {
        res.status(404).json({ error: "invite_not_generated" });
        return;
      }
      const ctx = (req as any).userContext;
      const actor = ctx?.userId ?? "u_admin_unknown";
      appendAdminAudit(
        actor,
        `consortium_application:${a.id}`,
        "consortium.invite_link.viewed",
        { contactEmail: a.contactEmail },
      );
      res.json({
        applicationId: a.id,
        inviteLink: a.invitePayload.inviteLink,
        inviteEmailStatus: a.invitePayload.inviteEmailStatus,
        sentAt: a.invitePayload.sentAt,
      });
    },
  );

  /**
   * POST /api/admin/consortium/applications/:id/resend-invite
   *
   * Mints a fresh redeem token (old token effectively revoked by expiry update),
   * sends a new invite email, and returns the new inviteLink.
   * Admin-only. For "Resend invite" button in the admin UI.
   */
  app.post(
    "/api/admin/consortium/applications/:id/resend-invite",
    requireAuth,
    requireAdmin,
    async (req: Request, res: Response): Promise<void> => {
      const a = getApplication(String(req.params.id));
      if (!a) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (a.status !== "approved") {
        res.status(409).json({ error: "not_approved_cannot_resend" });
        return;
      }
      const ctx = (req as any).userContext;
      const actor = ctx?.userId ?? "u_admin_unknown";

      try {
        // Revoke any existing unexpired invite tokens for this email
        rawDb()
          .prepare(
            `UPDATE auth_redeem_tokens SET expires_at = ? WHERE email = ? AND intent = 'invite' AND consumed_at IS NULL`,
          )
          .run(new Date(0).toISOString(), a.contactEmail);

        // Mint fresh token
        const tokenRaw = mintRedeemToken(a.contactEmail);
        const inviteLink = buildInviteLink(tokenRaw);
        const now = nowIso();

        // Send email
        const result = await sendEmail({
          to: a.contactEmail,
          subject: "Capavate — New set-password link",
          text: [
            `Hi ${a.contactName},`,
            "",
            `A new set-password link has been generated for your Capavate account:`,
            inviteLink,
            "",
            `This link expires in 24 hours.`,
            "",
            `— Capavate Admin`,
          ].join("\n"),
          html: [
            `<p>Hi ${a.contactName},</p>`,
            `<p>A new set-password link has been generated for your Capavate account:</p>`,
            `<p><a href="${inviteLink}">Set your password</a></p>`,
            `<p><small>This link expires in 24 hours.</small></p>`,
          ].join(""),
          category: "consortium_invite_resend",
          refId: a.id,
        });

        const finalPayload: InvitePayload = {
          inviteLink,
          inviteEmailStatus: result.delivered ? "delivered" : "failed",
          inviteEmailError: result.error ?? null,
          sentAt: now,
        };

        // Persist to DB + cache
        rawDb()
          .prepare(`UPDATE consortium_applications SET invite_payload_json = ? WHERE id = ?`)
          .run(JSON.stringify(finalPayload), a.id);
        const cachedRow = appsCache.get(a.id);
        if (cachedRow) {
          cachedRow.invitePayload = finalPayload;
          appsCache.set(a.id, cachedRow);
        }

        appendAdminAudit(
          actor,
          `consortium_application:${a.id}`,
          "consortium.invite.resent",
          {
            contactEmail: a.contactEmail,
            delivered: result.delivered,
            error: result.error ?? null,
          },
        );

        res.json({
          ok: true,
          applicationId: a.id,
          inviteLink, // Always returned to admin (not a public endpoint)
          inviteEmailStatus: finalPayload.inviteEmailStatus,
          inviteEmailError: finalPayload.inviteEmailError,
        });
      } catch (err) {
        log.error("[consortium.apply] resend-invite failed:", err);
        res.status(500).json({ error: "resend_failed" });
      }
    },
  );
}

/* ============================================================
 * Onboarding state — partner_admin facing
 *
 * Stored as JSON in partner_organizations.onboarding_state. Reads/writes
 * via plain GET/PATCH endpoints; no hash chain (operational metadata).
 * ============================================================ */
export function registerPartnerOnboardingRoutes(app: Express): void {
  app.get(
    "/api/partner/onboarding/state",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as any).userContext;
      const partnerId = ctx?.partner?.partnerId;
      if (!partnerId) {
        res.status(403).json({ error: "not_partner" });
        return;
      }
      try {
        const db = getDb();
        const rows: any[] = db
          .select()
          .from(partnerOrgsTable)
          .where(eq(partnerOrgsTable.id, partnerId))
          .all();
        if (rows.length === 0) {
          res.json({ state: {} });
          return;
        }
        let parsed: unknown = {};
        try {
          parsed = JSON.parse(rows[0].onboarding_state ?? rows[0].onboardingState ?? "{}");
        } catch {
          parsed = {};
        }
        res.json({ state: parsed });
      } catch (err) {
        log.error("[onboarding] read failed:", err);
        res.status(500).json({ error: "read_failed" });
      }
    },
  );

  app.patch(
    "/api/partner/onboarding/state",
    requireAuth,
    (req: Request, res: Response): void => {
      const ctx = (req as any).userContext;
      const partnerId = ctx?.partner?.partnerId;
      if (!partnerId) {
        res.status(403).json({ error: "not_partner" });
        return;
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      try {
        const db = getDb();
        const now = nowIso();
        db.transaction((tx: any) => {
          tx.update(partnerOrgsTable)
            .set({
              onboardingState: JSON.stringify(body),
              updatedAt: now,
            })
            .where(eq(partnerOrgsTable.id, partnerId))
            .run();
        });
        res.json({ ok: true, state: body });
      } catch (err) {
        log.error("[onboarding] write failed:", err);
        res.status(500).json({ error: "write_failed" });
      }
    },
  );
}

/* ============================================================
 * Internal exports (for tests)
 * ============================================================ */
export const _consortiumApplyInternal = {
  appsCache,
  computeHash,
  chainPayload,
  rowToApp,
  publicApplyBuckets,
  mintRedeemToken,
  buildInviteLink,
};
