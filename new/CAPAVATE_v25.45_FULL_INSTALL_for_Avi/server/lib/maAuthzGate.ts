/**
 * v25.44 ROUND 2 — SHARED M&A authorization gate (single source of truth).
 *
 * BLOCKER 1 FIX. Both the legacy per-company endpoint
 * (`GET /api/investor/ma/intelligence/:companyId`) AND the Collective
 * aggregation (`GET /api/collective/ma-intel`) MUST answer the same question:
 *
 *     "What level of M&A detail may THIS requester see for THIS company?"
 *
 * Authorization tiers (most → least privileged):
 *   (a) FULL      — Founder/admin/member of that company, OR a DB-global admin.
 *                   Sees all 14+ fields including topBuyer + narrative.
 *   (b) DETAIL    — Same-chapter member when ma_privacy_json.shareWithChapter
 *                   === true. Sees company-attributed scores + buyers, but the
 *                   narrative is omitted when redactNarrativeFromAggregates.
 *   (c) AGGREGATE — Cross-Collective member when shareWithCollective === true.
 *                   Sees scores + sector + buyer COUNT only — never buyer
 *                   names/rationale/narrative.
 *   (d) NONE      — Everyone else → 403.
 *
 * This module owns NO Express wiring; it returns a decision the route layer
 * enforces. Read-only; no mutation of any AVI Tier-2 store.
 */
import { rawDb } from "../db/connection";
import { MA_PRIVACY_DEFAULT, maPrivacySchema, type MaPrivacy } from "../../shared/schema";

export type MaAccessLevel = "FULL" | "DETAIL" | "AGGREGATE" | "NONE";

export interface MaAccessDecision {
  level: MaAccessLevel;
  /** May the narrative free-text be returned to this requester? */
  canSeeNarrative: boolean;
  /** May strategic-buyer NAMES + rationale be returned (vs count only)? */
  canSeeBuyers: boolean;
  /** Privacy posture used to reach the decision (for callers that need it). */
  privacy: MaPrivacy;
  /** Company's chapter (directory listing), if any. */
  companyChapter: string | null;
}

/* ---------------- low-level DB reads (all fail-closed) ---------------- */

export function parseMaPrivacy(json: string | null | undefined): MaPrivacy {
  if (!json) return { ...MA_PRIVACY_DEFAULT };
  try {
    return maPrivacySchema.parse(JSON.parse(json));
  } catch {
    // Malformed → fail CLOSED to the safest default (opt-OUT of Collective).
    return { ...MA_PRIVACY_DEFAULT };
  }
}

/** Read a company's ma_privacy_json. NULL/missing row → safe opt-OUT default. */
export function getCompanyPrivacy(companyId: string): MaPrivacy {
  try {
    const row = rawDb()
      .prepare(
        `SELECT ma_privacy_json AS j FROM companies WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(companyId) as { j?: string | null } | undefined;
    return parseMaPrivacy(row?.j ?? null);
  } catch {
    return { ...MA_PRIVACY_DEFAULT };
  }
}

export function isDbAdmin(userId: string): boolean {
  try {
    const row = rawDb().prepare(`SELECT role FROM users WHERE id = ? LIMIT 1`).get(userId) as
      | { role?: string }
      | undefined;
    return row?.role === "admin";
  } catch {
    return false;
  }
}

/** Active company_members row → this user is a founder/member/admin of the co. */
export function isCompanyMember(companyId: string, userId: string): boolean {
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 FROM company_members
         WHERE company_id = ? AND user_id = ? AND is_active = 1 AND deleted_at IS NULL
         LIMIT 1`,
      )
      .get(companyId, userId);
    return !!row;
  } catch {
    return false;
  }
}

/** The chapter a company is listed in (collective directory), or null. */
export function companyChapter(companyId: string): string | null {
  try {
    const row = rawDb()
      .prepare(
        `SELECT chapter FROM collective_directory_listings
         WHERE company_id = ? AND status = 'listed' LIMIT 1`,
      )
      .get(companyId) as { chapter?: string | null } | undefined;
    return row?.chapter ?? null;
  } catch {
    return null;
  }
}

/** Active chapter ids for a user. */
export function chapterIdsForUser(userId: string): string[] {
  try {
    const rows = rawDb()
      .prepare(
        `SELECT chapter_id FROM chapter_memberships
         WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL`,
      )
      .all(userId) as Array<{ chapter_id: string }>;
    return rows.map((r) => r.chapter_id);
  } catch {
    return [];
  }
}

/* ---------------- the single decision function ---------------- */

export interface MaAuthzInput {
  companyId: string;
  userId: string;
  /** From request context; we still re-check the DB to be safe. */
  isAdminFromCtx?: boolean;
  /** Optional pre-fetched values to avoid duplicate reads in hot loops. */
  privacy?: MaPrivacy;
  chapter?: string | null;
  userChapters?: Set<string>;
}

/**
 * Decide what M&A detail the requester may see for one company.
 *
 * IMPORTANT: this is the ONLY place the tier logic lives. Both endpoints call
 * it so a privacy leak cannot exist in one path but not the other.
 */
export function decideMaAccess(input: MaAuthzInput): MaAccessDecision {
  const { companyId, userId } = input;
  const privacy = input.privacy ?? getCompanyPrivacy(companyId);
  const chapter = input.chapter !== undefined ? input.chapter : companyChapter(companyId);

  // (a) FULL — founder/admin/member of the company OR global DB admin.
  const globalAdmin = input.isAdminFromCtx === true || isDbAdmin(userId);
  if (globalAdmin || isCompanyMember(companyId, userId)) {
    return {
      level: "FULL",
      canSeeNarrative: true,
      canSeeBuyers: true,
      privacy,
      companyChapter: chapter,
    };
  }

  // (b) DETAIL — same-chapter member when shareWithChapter === true.
  const userChapters = input.userChapters ?? new Set(chapterIdsForUser(userId));
  if (privacy.shareWithChapter && chapter != null && userChapters.has(chapter)) {
    return {
      level: "DETAIL",
      // Narrative shown to chapter peers ONLY when NOT redacted.
      canSeeNarrative: privacy.redactNarrativeFromAggregates === false,
      canSeeBuyers: true,
      privacy,
      companyChapter: chapter,
    };
  }

  // (c) AGGREGATE — cross-Collective member when shareWithCollective === true.
  if (privacy.shareWithCollective) {
    return {
      level: "AGGREGATE",
      canSeeNarrative: false,
      canSeeBuyers: false,
      privacy,
      companyChapter: chapter,
    };
  }

  // (d) NONE — everyone else.
  return {
    level: "NONE",
    canSeeNarrative: false,
    canSeeBuyers: false,
    privacy,
    companyChapter: chapter,
  };
}
