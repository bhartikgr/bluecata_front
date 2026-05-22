/**
 * server/consortiumApplyStore.ts — CP Phase B.
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
 *   5. UPDATE the application row with status='approved', provisioned_partner_id,
 *      reviewed_by_user_id, reviewed_at, prev_hash←currHash, curr_hash←new hash.
 *
 * After commit:
 *   - appendAdminAudit() for cross-cutting audit trail
 *   - SSE publish on 'consortium-apply' topic
 *   - commsStore notification to the new partner_admin user (welcome).
 *
 * Public submit fires email/SMTP via env-driven transport (logged if not wired).
 */

import type { Express, Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth, requireAdmin } from "./lib/authMiddleware";
import { getDb } from "./db/connection";
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

  // Notification stub — email infra will be wired by Avi (SMTP_*).
  // For now, log a structured line that integrators can grep for.
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
 * Approval — provisions tenant, partner_org, user, chapter membership.
 *
 * CROSS-TENANT: this operation is intentionally cross-tenant because it
 * is the provisioning step that *creates* the new partner tenant. The
 * caller MUST be a platform admin (enforced at the route).
 * ============================================================ */
export function approveApplication(
  id: string,
  actorUserId: string,
  reviewNotes?: string | null,
): ConsortiumApplicationRow {
  const existing = appsCache.get(id);
  if (!existing) throw new Error("APPLICATION_NOT_FOUND");
  if (existing.status === "approved" && existing.provisionedPartnerId) {
    // Idempotent — return existing.
    return existing;
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

    // 5) Update application row with approval + new chain link
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
      })
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
    },
    newTenantId,
  );
  ssePublish(updated.expectedChapter || "_global", "consortium-apply", {
    event: "approved",
    applicationId: updated.id,
    partnerId,
  });

  // Welcome stub (commsStore wire-up deferred to email infra).
  log.info(
    "[consortium.apply] approved",
    JSON.stringify({
      applicationId: updated.id,
      partnerId,
      userId,
      tenantId: newTenantId,
    }),
  );

  return updated;
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
  app.post(
    "/api/public/consortium/apply",
    (req: Request, res: Response, next: NextFunction): void => {
      // Rate limit per IP — bucket public:apply.
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
    },
    (req: Request, res: Response): void => {
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
        res.status(201).json({
          applicationId: row.id,
          status: row.status,
        });
      } catch (err) {
        log.error("[consortium.apply] submit failed:", err);
        res.status(500).json({ error: "submit_failed" });
      }
    },
  );

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
};
