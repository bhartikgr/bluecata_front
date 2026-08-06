// server/lib/delegatedAgency.ts  (NEW in Wave C-2, non-sacred)
// ---------------------------------------------------------------------------
// D1 INTEGRATION ARTIFACT. This file is greenfield: `ls server/lib/delegatedAgency.ts`
// returns "No such file" in v26.5.0 (GA-1). Wave C-2 owns it end-to-end (spec §1,
// V33-4-B2); no other wave has an edit claim, so there is no diff — this IS the file.
//
// Route-layer preflight for delegated-agency (partner-acting-for-founder) writes.
// The SAME seven authorization predicates are re-verified inside `db.transaction()` by
// `roundInvitationsStore.ts::createDelegatedInvitation` (§7.6) — this file is the fast
// fail-closed preflight; the transaction is the ToC/ToU close. Neither is redundant.
//
// Spec sources: §1 (edit-site declaration), §7.2-B (public surface), §7.2-C
// (ROUTE_SCOPE_MAP), §7.2-D (resolvePartnerContextIfPresent), §7.2-E
// (requireDelegatedAgencyIfPartner + engagementHasScope), §5.2 (engagement_letter_active).
//
// D1 corrections applied on top of c2_j_lock5/delegated_agency.ts.md:
//   D1-01  logger import is "./logger", NOT §7.2-B's "../logger". Grep: server/logger.ts
//          does not exist; only server/lib/logger.ts (`export const log` at :118). A file
//          at server/lib/ reaches it as a sibling. (= ASSUMPTIONS_C2J A-C2J-14 / GA-6.)
//   D1-08  No PARTNER_NOT_ACTIVE preflight is added at the ROUTE layer. P2 below stays
//          (it is inside this helper, which the route awaits); what D1 declines to add is a
//          separate route-level org-status check. Transactional Predicate 1-B covers the
//          ToC/ToU window, and skipping it keeps routes.ts at ONE new import block — no
//          `rawDb` import is added to routes.ts (grep: routes.ts does not import rawDb).
// ---------------------------------------------------------------------------

import type { Request, Response } from "express";
import { rawDb } from "../db/connection";
import { log } from "./logger"; // D1-01: real path is server/lib/logger.ts
import type { PartnerContext } from "./requirePartnerAuth"; // real: :24-32, 7 fields
import type { PartnerSubRole } from "../adminContactsStoreShim"; // real: :17, 5-value union

// Type-only re-export so consumers need exactly one import path.
export type { PartnerContext, PartnerSubRole };

// V33-5-B8: resolvePartnerContextIfPresent returns a NARROWER shape than the full 7-field
// PartnerContext — the route reads only userId/partnerId/partnerSubRole downstream, so a Pick
// preserves compile-safety without forcing the resolver to fabricate email/name/tier/isAdmin
// from a SELECT that does not read them. Exported as its own type so callers can pin it.
export type PartnerContextResolved = Pick<PartnerContext, "userId" | "partnerId" | "partnerSubRole">;

// Sub-role allowlist for delegated writes. Enforced at THREE sites, all reading this ONE
// constant (V33-5-N5): route-layer preflight (§7.2), helper P0 below, and transactional
// Predicate 1 (§7.6, roundInvitationsStore.ts::createDelegatedInvitation).
export const DELEGATED_WRITE_SUB_ROLES: readonly PartnerSubRole[] = [
  "managing_partner",
  "associate",
  "bd",
] as const;
// Excluded, deliberately: "analyst", "viewer" (the other two of the real 5-value union). A
// partner user in either sub-role gets 403 SUB_ROLE_NOT_ALLOWED — never a silent fallthrough
// to the founder path.

export interface DelegatedAgencyArgs {
  companyId: string;
  routePath: string; // "METHOD /path" form; see ROUTE_SCOPE_MAP below
  requiredScope: string; // resolved by the caller via ROUTE_SCOPE_MAP[routePath]
}

export interface DelegatedAgencyResult {
  ok: true;
  actorPartnerUserId: string;
  engagementId: string;
  partnerAttributionId: string;
  authorityArtifactId: string; // pinned so §7.6 Predicate 4-B re-verifies the SAME row
}

/**
 * §7.2-C. Key format, pinned: `${req.method} ${req.route.path}` — `req.method` uppercase
 * (Express default), `req.route.path` the mounted path with `:param` placeholders exactly as
 * declared in the `app.<verb>()` call.
 *
 * Chosen because (a) it disambiguates POST/PATCH/DELETE on the same path — §20.4 requires
 * different scopes for those verbs on /api/rounds/:id/invitations/:invId; and (b) it is
 * already the audit label written to mf_engagement_event.detail_json, so one string flows
 * route → transaction → audit row with ZERO transformation.
 *
 * FAIL-CLOSED CONTRACT: a missing key is NOT "no scope required". Both the route-layer
 * preflight and transactional Predicate 5 test `requiredScope === undefined` and
 * throw/return SCOPE_NOT_MAPPED (403). An unmapped route is therefore unreachable by a
 * partner and fully reachable by a founder (the founder branch never consults this map).
 *
 * NAMING CAUTION (A-C2J-11): all five initial rows map to the single scope string
 * "placement". `engagementHasScope` does EXACT string match with no wildcard honoring, so
 * client_authority_scope_json must literally contain {"scopes":["placement", ...]}. There is
 * no scope hierarchy and no "*" support — a partner granted "placement:invite" but not
 * "placement" is denied.
 */
export const ROUTE_SCOPE_MAP: Readonly<Record<string, string>> = {
  "POST /api/rounds/:id/invitations": "placement",
  "PATCH /api/rounds/:id/invitations/:invId": "placement",
  "DELETE /api/rounds/:id/invitations/:invId": "placement",
  "POST /api/rounds/:id/soft-circles": "placement",
  "PATCH /api/rounds/:id/soft-circles/:scId": "placement",
  // Additional partner-invoked routes from §20.4 are added row-by-row here, kept in sync
  // with §20.4 by the §19.3-D coverage test.
};

/**
 * §7.2-D. Resolve the caller's partner context (if any) from the auth session. Reads
 * `partner_team_members` for the current user; returns null when the caller has no active
 * partner-team membership. Called IN-HANDLER on the invitation route because that route runs
 * only `requireAuth` — no partner-context middleware is mounted on the invitation subtree,
 * and mounting one would break every founder caller.
 *
 * V33-5-B8: returns `PartnerContextResolved | null` (a Pick over the three fields the caller
 * reads), NOT full `PartnerContext | null`, so the resolver never fabricates
 * email/name/tier/isAdmin.
 *
 * A-C2J-12: `async` with no `await`. The body is fully synchronous (`db.prepare().get()` is
 * sync in better-sqlite3). `async` is retained verbatim per §7.2-D so the route's
 * `await resolvePartnerContextIfPresent(req)` call site is correct and so a future
 * async-backed session lookup is a non-breaking change. Some lint configs flag
 * `require-await`; suppress at this declaration rather than changing the signature.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function resolvePartnerContextIfPresent(
  req: Request,
): Promise<PartnerContextResolved | null> {
  const userId = (req as any).userContext?.userId as string | undefined;
  if (!userId) return null;
  const db = rawDb();
  // Real DDL (connection.ts:4460-4470, GA-7): id, partner_id, user_id, sub_role, status,
  // joined_at, removed_at, created_by, is_seed, updated_at.
  // Active membership = status='active' AND removed_at IS NULL (GA-8, the tree's convention
  // at partnerRoutes.ts:538 and adminV25Store.ts:267).
  const row = db
    .prepare(
      `SELECT partner_id AS partnerId, sub_role AS partnerSubRole
         FROM partner_team_members
        WHERE user_id = ?
          AND status = 'active'
          AND removed_at IS NULL
        ORDER BY joined_at ASC, id ASC
        LIMIT 1`,
    )
    .get(userId) as { partnerId: string; partnerSubRole: string } | undefined;
  if (!row) return null;
  // V33-4-B7 (fail-OPEN closure): if the user HAS an active partner-team membership but the
  // sub_role is NOT in the delegated-write allowlist, return the context ANYWAY. The route
  // handler MUST see a partner context so it takes the partner branch and fail-closes with
  // 403 SUB_ROLE_NOT_ALLOWED. Returning null here would silently degrade a wrong-sub-role
  // partner-user-who-is-also-a-founder to the FOUNDER path, letting them write without
  // provenance columns — a fail-OPEN security bug. This resolver does context RESOLUTION
  // only, never policy; §7.2's route check is the single enforcement point.
  return {
    userId,
    partnerId: row.partnerId,
    partnerSubRole: row.partnerSubRole as PartnerContext["partnerSubRole"],
  };
}

/**
 * §7.2-E. Eight predicates, P0-P7. Returns a discriminated union; on any denial this helper
 * has ALREADY written the 403 response, so the caller must `return` immediately without
 * writing again.
 *
 * V33-5-B6/B9: exactly ONE `export async function requireDelegatedAgencyIfPartner`
 * statement — no separate bodyless signature ahead of it (TypeScript requires an overload
 * signature to be immediately followed by its implementation).
 */
export async function requireDelegatedAgencyIfPartner(
  req: Request,
  res: Response,
  args: DelegatedAgencyArgs,
): Promise<({ ok: true } & DelegatedAgencyResult) | { ok: false }> {
  // `req.partnerContext` is typed as full `PartnerContext | undefined` on Express.Request via
  // requirePartnerAuth's ambient declaration (GA-16); `resolvePartnerContextIfPresent`
  // returns the narrower `PartnerContextResolved`. Both provide the three fields read here.
  const partnerCtx: PartnerContext | PartnerContextResolved | undefined =
    (req as any).partnerContext ?? (await resolvePartnerContextIfPresent(req));
  if (!partnerCtx) {
    // The route handler already checked `if (partnerCtx)` before calling us; reaching this
    // branch is a PROGRAMMER error, not a caller-facing case. Fail closed with a generic 403.
    res.status(403).json({ ok: false, error: "DELEGATED_AGENCY_REQUIRED" });
    return { ok: false };
  }

  const db = rawDb();
  const nowIsoLit = new Date().toISOString();

  // V33-5-B4: every DB read below is wrapped so a pre-migration state (0129/0130/0131 not yet
  // applied — e.g. `no such table: authority_artifacts`, `no such column: founder_revoked_at`)
  // or a transient DB fault produces a typed 403 DELEGATED_AGENCY_REQUIRED, never an opaque
  // Express-forwarded 500. Pattern mirrors requireSignedAgreement.ts:34-45 (GA-11):
  // "Fail-closed: if we cannot confirm a signature, refuse the write."
  try {
    // ── P0 — sub-role allowlist ──────────────────────────────────────────────
    // Redundant with the route-layer check that runs BEFORE this helper; retained so a
    // FUTURE caller that omits the preflight cannot bypass sub-role policy. V33-5-N5:
    // reads the shared constant.
    if (!(DELEGATED_WRITE_SUB_ROLES as readonly string[]).includes(partnerCtx.partnerSubRole)) {
      res.status(403).json({ ok: false, error: "SUB_ROLE_NOT_ALLOWED" });
      return { ok: false };
    }

    // ── P1 — team-member row still active, still bound to the same partner_id ─
    // Bind partner_id in the WHERE so an actor with two active memberships is authorized
    // ONLY for the org partnerCtx.partnerId already resolved to (multi-membership
    // determinism, V33-4-M2).
    const teamMemberRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, sub_role AS subRole, user_id AS userId
           FROM partner_team_members
          WHERE user_id = ?
            AND partner_id = ?
            AND status = 'active'
            AND removed_at IS NULL
          LIMIT 1`,
      )
      .get(partnerCtx.userId, partnerCtx.partnerId) as
      | { id: string; partnerId: string; subRole: string; userId: string }
      | undefined;
    if (!teamMemberRow) {
      res.status(403).json({ ok: false, error: "PARTNER_MISMATCH" });
      return { ok: false };
    }

    // ── P2 — active consortium-partner organization ──────────────────────────
    // Mirrors real requirePartnerAuth.ts:56 (GA-9):
    //   if (!partner || partner.kind !== "consortium_partner" || partner.status !== "active")
    const partnerContactRow = db
      .prepare(`SELECT kind, status FROM contacts WHERE id = ?`)
      .get(partnerCtx.partnerId) as { kind: string; status: string } | undefined;
    if (
      !partnerContactRow ||
      partnerContactRow.kind !== "consortium_partner" ||
      partnerContactRow.status !== "active"
    ) {
      res.status(403).json({ ok: false, error: "PARTNER_NOT_ACTIVE" });
      return { ok: false };
    }

    // ── P3 — signed partner agreement ────────────────────────────────────────
    // Real requireSignedAgreement.ts:36-38 query shape (GA-10), bound to the partner ORG
    // contact id, NOT the user id. (v3.3.1's `adminContactsStoreShim.findByUserId` was
    // doubly wrong: the function does not exist, and it bound a user id.)
    //
    // D1-09: the real requireSignedAgreement query also carries
    // `AND kind = 'consortium_partner'`. It is omitted here verbatim per LOCK 5, and is
    // NOT a security gap: P2 immediately above already refused any row whose
    // kind !== 'consortium_partner', on the same id, in the same transaction-free read
    // sequence. Logged in ASSUMPTIONS_D1.md rather than silently "fixed".
    const agreement = db
      .prepare(`SELECT partner_agreement_signed_at AS signedAt FROM contacts WHERE id = ?`)
      .get(partnerCtx.partnerId) as { signedAt: string | null } | undefined;
    if (!agreement?.signedAt) {
      res.status(403).json({ ok: false, error: "AGREEMENT_NOT_SIGNED" });
      return { ok: false };
    }

    // ── P4 — attribution match + §5.2's six-conjunct engagement_letter_active ─
    const attributionRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, company_id AS companyId,
                client_authority_scope_json AS scopeJson,
                authority_artifact_id AS authorityArtifactId,
                engagement_letter_effective_at AS letterEffectiveAt,
                engagement_letter_expires_at   AS letterExpiresAt,
                engagement_letter_revoked_at   AS letterRevokedAt
           FROM partner_attributions
          WHERE partner_id = ?
            AND company_id = ?
            AND revoked_at IS NULL
          ORDER BY attributed_at DESC
          LIMIT 1`,
      )
      .get(partnerCtx.partnerId, args.companyId) as
      | {
          id: string;
          partnerId: string;
          companyId: string;
          scopeJson: string | null;
          authorityArtifactId: string | null;
          letterEffectiveAt: string | null;
          letterExpiresAt: string | null;
          letterRevokedAt: string | null;
        }
      | undefined;
    if (!attributionRow) {
      res.status(403).json({ ok: false, error: "ATTRIBUTION_REVOKED" });
      return { ok: false };
    }
    // V33-5-B1-fix: MUST match §5.2's six-conjunct canonical form exactly. An earlier draft
    // misquoted it by treating `engagement_letter_effective_at IS NULL` as "active" — the
    // OPPOSITE of §5.2, which requires `IS NOT NULL AND <= :now`, making a NULL
    // effective_at EXPLICITLY authority-DENYING. §5.2's six conjuncts, applied here:
    //   1. pa.revoked_at IS NULL                                 (checked in the WHERE above)
    //   2. pa.engagement_letter_effective_at IS NOT NULL
    //   3. pa.engagement_letter_effective_at <= :now
    //   4. (pa.engagement_letter_expires_at IS NULL OR pa.engagement_letter_expires_at >= :now)
    //   5. pa.engagement_letter_revoked_at IS NULL
    //   6. pa.authority_artifact_id IS NOT NULL
    // No implicit truthy-coercion anywhere; every nullability test is an explicit
    // `=== null` / `!== null`.
    const letterActive =
      attributionRow.letterRevokedAt === null && // conjunct 5
      attributionRow.letterEffectiveAt !== null && // conjunct 2
      attributionRow.letterEffectiveAt <= nowIsoLit && // conjunct 3
      (attributionRow.letterExpiresAt === null || // conjunct 4a
        attributionRow.letterExpiresAt >= nowIsoLit) && // conjunct 4b
      attributionRow.authorityArtifactId !== null; // conjunct 6
    if (!letterActive) {
      res.status(403).json({ ok: false, error: "ENGAGEMENT_LETTER_REVOKED" });
      return { ok: false };
    }
    // Post-condition: authorityArtifactId is guaranteed non-null on this branch.

    // ── P5 — engagement match (ACTIVE, not founder-revoked) ──────────────────
    // MIGRATION DEPENDENCY: `founder_revoked_at` is added by migration 0131 (C-2.d). This
    // query is illegal pre-0131 — the V33-5-B4 try/catch converts the resulting
    // `no such column` into a typed 403 instead of a 500.
    const engagementRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, company_id AS companyId, status
           FROM mf_engagement
          WHERE partner_id = ?
            AND company_id = ?
            AND status = 'ACTIVE'
            AND founder_revoked_at IS NULL
          LIMIT 1`,
      )
      .get(partnerCtx.partnerId, args.companyId) as
      | { id: string; partnerId: string; companyId: string; status: string }
      | undefined;
    if (!engagementRow) {
      res.status(403).json({ ok: false, error: "ENGAGEMENT_REVOKED" });
      return { ok: false };
    }

    // ── P6 — authority artifact re-check (same row, right kind, in window) ───
    // `kind = 'engagement_letter'` is REQUIRED — without it any dpa / referral_consent /
    // client_authority_scope row on the same attribution would satisfy the predicate. The
    // real `kind` CHECK is a FOUR-value list (GA-15, migration 0130).
    // `expires_at IS NULL` = perpetual, per §5.2's unified date-nullability rule.
    const artifactRow = db
      .prepare(
        `SELECT id
           FROM authority_artifacts
          WHERE id = ?
            AND partner_attribution_id = ?
            AND kind = 'engagement_letter'
            AND revoked_at IS NULL
            AND effective_at <= ?
            AND (expires_at IS NULL OR expires_at >= ?)
          LIMIT 1`,
      )
      .get(attributionRow.authorityArtifactId, attributionRow.id, nowIsoLit, nowIsoLit) as
      | { id: string }
      | undefined;
    if (!artifactRow) {
      res.status(403).json({ ok: false, error: "AUTHORITY_ARTIFACT_MISSING_OR_EXPIRED" });
      return { ok: false };
    }

    // ── P7 — route scope ─────────────────────────────────────────────────────
    // `engagementHasScope` parses scope_json defensively and does EXACT string membership;
    // wildcards are NOT honored. `args.requiredScope` is already resolved by the caller via
    // ROUTE_SCOPE_MAP[args.routePath] — an unmapped route never reaches this predicate (the
    // route returns SCOPE_NOT_MAPPED first); a mapped route whose attribution lacks the
    // scope fails here.
    if (!engagementHasScope(attributionRow.scopeJson, args.requiredScope)) {
      res.status(403).json({ ok: false, error: "SCOPE_NOT_GRANTED" });
      return { ok: false };
    }

    return {
      ok: true,
      actorPartnerUserId: partnerCtx.userId,
      engagementId: engagementRow.id,
      partnerAttributionId: attributionRow.id,
      authorityArtifactId: artifactRow.id,
    };
  } catch (err) {
    // V33-5-B4: fail-closed on ANY DB read error (pre-migration table/column, disk fault,
    // corruption). Logs the underlying reason; never leaks it to the caller.
    log.warn(
      "[delegatedAgency.requireDelegatedAgencyIfPartner] DB read failed, denying:",
      (err as Error).message,
    );
    res.status(403).json({ ok: false, error: "DELEGATED_AGENCY_REQUIRED" });
    return { ok: false };
  }
}

/**
 * §7.2-E companion. Fail-closed on every degenerate input: `null`, `""`, malformed JSON,
 * `{}` (no `scopes` key), `{"scopes": "placement"}` (string not array), `{"scopes": null}`
 * → all `false`. No wildcard, no prefix matching, no case-folding.
 */
export function engagementHasScope(scopeJson: string | null, requiredScope: string): boolean {
  if (!scopeJson) return false;
  try {
    const parsed = JSON.parse(scopeJson);
    const scopes = Array.isArray(parsed?.scopes) ? parsed.scopes : null;
    return Array.isArray(scopes) && scopes.includes(requiredScope);
  } catch {
    return false;
  }
}
