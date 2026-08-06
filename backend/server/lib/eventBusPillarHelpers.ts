/**
 * Wave C-2 D2 / LOCK 4 — cross-pillar visibility helpers for the
 * `partnerRepresentation` branch of `eventVisibleToCaller`.
 *
 * TARGET PATH (new file): server/lib/eventBusPillarHelpers.ts
 *
 * Why a separate file and not inline in `eventBus.ts`:
 *   - Ozan LOCK 4 keeps the `eventBus.ts` diff to the minimum reviewable surface
 *     (one import block + one `case`-equivalent branch). Every SQL predicate the
 *     branch needs lives here so the `eventBus.ts` diff stays auditable line-by-line
 *     against the WAVE_C2_SPEC_v3.3.5 §15.4 code block.
 *   - These predicates are directly unit-testable without standing up an SSE stream.
 *
 * Ozan requirement #4 ("everything works dynamically and db-driven") is honoured
 * literally here:
 *   - ZERO module-level caches. No `Map`, no `Set`, no memo, no TTL.
 *   - Every predicate is a fresh `SELECT ... LIMIT 1` against the live SQLite handle
 *     on every call. A revoke that lands between two SSE fan-out ticks is therefore
 *     observed by the very next tick. This is the exact staleness class that
 *     WAVE_C2_SPEC_v3.3.5 §15.4 (V33-F2) says an in-memory attribution cache would
 *     re-introduce, so we do not introduce one.
 *   - Every predicate is FAIL-CLOSED: a thrown/absent DB, a missing table, a NULL or
 *     blank argument all return `false`. A visibility helper must never fail open.
 *
 * ESM note: this module uses only static ESM imports, so it needs no `createRequire`
 * shim of its own. The shim lives in `eventBus.ts` (see eventBus_ts_LOCK4.diff.md),
 * which lazily requires THIS module to avoid a module-init cycle
 * (eventBus -> helpers -> connection -> ... -> eventBus).
 *
 * SACRED FILES: this file touches none of
 *   partnerConsortiumRoutes.ts, notificationsStore.ts, sseHub.ts,
 *   captableCommitStore.ts, messagingStore.ts, paymentGatewayAdapter.ts,
 *   roundInvitationsStore.ts.
 * Zero Airwallex references.
 */
import { rawDb } from "../db/connection";

/* ============================================================
 *  Constants mirrored from existing, grep-verified code
 * ============================================================ */

/**
 * The founder-class role vocabulary on `company_members.role`.
 * Copied verbatim from three independent existing sites so this helper can never
 * drift from the rest of the tree:
 *   server/lib/dmCoMembership.ts:45
 *   server/lib/commsChannelAnchors.ts:65
 *   server/lib/commsUserDirectory.ts:75
 */
const FOUNDER_ROLES = ["founder", "co_founder"] as const;

/** The four D2 LOCK 4 pillars, as named in Ozan's D2.5 memory update. */
export type PillarKey =
  | "consortiumPartner"  // pillar 3 — the emitting partner's own dashboard
  | "capavateDirect"     // pillar 2 — Capavate direct portfolio surface
  | "collective"         // pillar 1 — Collective admin / DSC surface
  | "admin";             // pillar 4 — admin superuser view

/* ============================================================
 *  0) Composite-id parsing (fail-closed)
 * ============================================================ */

export interface PartnerRepresentationId {
  partnerId: string;
  companyId: string;
}

/**
 * `partnerRepresentation` events carry `evt.id === `${partnerId}:${companyId}``
 * (WAVE_C2_SPEC_v3.3.5 §15.4, emit block). Parse it fail-closed.
 *
 * Returns `null` — never throws — when:
 *   - `id` is null/undefined/non-string/blank
 *   - the `:` separator is missing
 *   - either half is empty or whitespace-only
 *   - there are MORE than two segments (a 3+ segment id is not a contract this
 *     wave defines; accepting it silently would let a future emitter smuggle an
 *     unvalidated third field past this gate — see ASSUMPTIONS_D2.md A-D2-07)
 */
export function parsePartnerRepresentationId(id: unknown): PartnerRepresentationId | null {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  if (parts.length !== 2) return null;
  const partnerId = parts[0].trim();
  const companyId = parts[1].trim();
  if (!partnerId || !companyId) return null;
  return { partnerId, companyId };
}

/* ============================================================
 *  1) Partner-side gates
 * ============================================================ */

/**
 * Is there an ACTIVE (non-revoked) `partner_attributions` row for this exact
 * (partnerId, companyId) pair?
 *
 * This is the V33-F2 fail-closed check. WAVE_C2_SPEC_v3.3.5 §15.4 declares it as a
 * NEW `partnerAttributionStore.findActive(partnerId, companyId)` store method
 * (grep-verified absent today: `partnerAttributionStore`, object literal at
 * partnerWorkspaceStore.ts:1747, currently exposes only
 * create / revoke / listByPartner / historyForPartner / verifyChain).
 *
 * The SQL below is byte-identical to the SQL the spec prescribes for `findActive`:
 *
 *   SELECT 1 FROM partner_attributions
 *    WHERE partner_id = ? AND company_id = ? AND revoked_at IS NULL LIMIT 1
 *
 * INTEGRATION NOTE (A-D2-06): when the D2 integration wave adds
 * `partnerAttributionStore.findActive`, this function body MUST be replaced by a
 * one-line delegation to it so there is exactly ONE definition of "active
 * attribution" in the tree. It is written as standalone SQL here (rather than a
 * runtime feature-probe of the store object) because a feature-probe would make the
 * gate's behaviour depend on load order — unacceptable for a fail-closed predicate.
 *
 * Index: `idx_pattr_partner_company` on partner_attributions(partner_id, company_id)
 * (db/connection.ts:2148, grep-verified) — a covering-prefix index lookup, not a scan.
 */
export function hasActivePartnerAttribution(partnerId: string, companyId: string): boolean {
  if (!partnerId || !companyId) return false;
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 AS hit
           FROM partner_attributions
          WHERE partner_id = ?
            AND company_id = ?
            AND revoked_at IS NULL
          LIMIT 1`,
      )
      .get(partnerId, companyId) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false; // fail closed
  }
}

/**
 * Is the emitting partner's ENGAGEMENT with this company still live?
 *
 * Distinct from attribution on purpose:
 *   - `partner_attributions` = revenue/first-touch provenance (survives revoke as a
 *     revoked row, is the §15.4 delivery gate for the partner's OWN dashboard).
 *   - `mf_engagement` = the operating mandate that makes a stage change the partner's
 *     to make at all. `status` ∈ ACTIVE | LAPSED | HANDED_OVER | TERMINATED
 *     (managedFounderStore.ts:39, grep-verified) and the table is
 *     UNIQUE(partner_id, company_id) (lib/mfcrmSchema.ts:71, grep-verified).
 *
 * CROSS-PILLAR propagation is gated on this, not on attribution: we only tell the
 * Capavate-direct and Collective surfaces "your founder moved stage because a partner
 * moved them" while that partner actually holds the mandate. A revoked/terminated
 * engagement propagates NOWHERE outside the partner's own workspace.
 *
 * Index: `idx_mf_engagement_company` on mf_engagement(partner_id, company_id)
 * (lib/mfcrmSchema.ts:74, grep-verified).
 */
export function hasActivePartnerEngagement(partnerId: string, companyId: string): boolean {
  if (!partnerId || !companyId) return false;
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 AS hit
           FROM mf_engagement
          WHERE partner_id = ?
            AND company_id = ?
            AND status = 'ACTIVE'
          LIMIT 1`,
      )
      .get(partnerId, companyId) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false; // fail closed (table absent pre-migration => no propagation)
  }
}

/* ============================================================
 *  2) Pillar-membership gates
 * ============================================================ */

/**
 * Is `companyId` a Capavate DIRECT portfolio company?
 *
 * There is NO `companies.is_capavate_portfolio` column (grep-verified against
 * shared/schema.ts:85-104 — the columns are id/tenantId/name/legalName/sector/stage/
 * hq/websiteUrl/description/logoUrl/founded/employees/isDemo/deletedAt/maPrivacyJson).
 * See ASSUMPTIONS_D2.md A-D2-03 + TOUGH QUESTION 1: this predicate is therefore a
 * DERIVED definition and needs Ozan's sign-off before integration.
 *
 * Working definition (DB-driven, no invented column, no new table):
 *   a live `companies` row (deleted_at IS NULL) that has at least one ACTIVE
 *   founder-class `company_members` row.
 *
 * i.e. "a real founder account owns this company directly on Capavate." This mirrors
 * the entitlement source `eventVisibleToCaller` already trusts — `accessibleCompanies`
 * is built from `founderOwnedCompanyIds(ctx)`, which reads `ctx.founder.companies`,
 * which is `buildFounderCompanies()` (lib/userContext.ts:299) over the
 * `company_members` join table (lib/userContext.ts:967-982, the v25.52 Track 0.1
 * multi-role change that made the join table — not the scalar role hint — canonical).
 *
 * `is_demo` is deliberately NOT filtered: demo companies are real portfolio rows on
 * the demo tenant and their founders' dashboards must still sync. See A-D2-04.
 */
export function isCapavatePortfolioCompany(companyId: string): boolean {
  if (!companyId) return false;
  try {
    const marks = FOUNDER_ROLES.map(() => "?").join(",");
    const row = rawDb()
      .prepare(
        `SELECT 1 AS hit
           FROM companies c
           JOIN company_members cm ON cm.company_id = c.id
          WHERE c.id = ?
            AND c.deleted_at IS NULL
            AND cm.is_active = 1
            AND cm.role IN (${marks})
          LIMIT 1`,
      )
      .get(companyId, ...FOUNDER_ROLES) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false; // fail closed
  }
}

/**
 * Is `companyId` a Capavate COLLECTIVE member company?
 *
 * Deliberately named `...MemberCompany`, not `isCollectiveMember`, because Collective
 * membership in this codebase is USER-scoped, not company-scoped:
 * `collective_memberships` is keyed `user_id TEXT PRIMARY KEY` and its `tenant_id` is
 * `tenant_chap_${chapterId}` — a CHAPTER tenant, NOT `tenant_co_${companyId}`
 * (db/connection.ts:3402-3416 + collectiveMembershipStore.ts:52, both grep-verified).
 * So `tenant_id` CANNOT be used to map a membership to a company, and the task brief's
 * literal `isCollectiveMember(companyId)` signature is not directly satisfiable.
 * See ASSUMPTIONS_D2.md A-D2-05 + TOUGH QUESTION 2.
 *
 * Working definition (the only DB-driven path that exists):
 *   the company has at least one ACTIVE founder-class member whose user_id holds an
 *   active, non-deleted `collective_memberships` row.
 *
 * Status/soft-delete predicate mirrors `collectiveMembershipStore.isActive()`
 * (collectiveMembershipStore.ts:221) and the admin cascade's soft-delete convention
 * (adminV25Store.ts:778 sets `deleted_at`), so a deactivated or cascade-deleted member
 * stops propagating immediately.
 */
export function isCollectiveMemberCompany(companyId: string): boolean {
  if (!companyId) return false;
  try {
    const marks = FOUNDER_ROLES.map(() => "?").join(",");
    const row = rawDb()
      .prepare(
        `SELECT 1 AS hit
           FROM company_members cm
           JOIN collective_memberships m ON m.user_id = cm.user_id
          WHERE cm.company_id = ?
            AND cm.is_active = 1
            AND cm.role IN (${marks})
            AND m.status = 'active'
            AND m.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(companyId, ...FOUNDER_ROLES) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false; // fail closed
  }
}

/* ============================================================
 *  3) Caller-side partner identity (single lazy-require site helper)
 * ============================================================
 * Not re-implemented here — `eventBus.ts` pulls the real
 * `partnerTeamStore.findByUserId` (partnerWorkspaceStore.ts:1035, object exported
 * at :875) directly, exactly as WAVE_C2_SPEC_v3.3.5 §15.4's code block prescribes.
 * Re-implementing it would fork the cross-process DB-fallback logic that method
 * already carries (v24.4.1 cross-process safety, partnerWorkspaceStore.ts:1037-1045).
 */

/* ============================================================
 *  4) Test seam
 * ============================================================ */

/**
 * No-op by construction. There is nothing to reset because there is no cache.
 * Exported so the D2 test suite can assert the no-cache property structurally
 * (see probe_lock4_d2.py test 13).
 */
export function _resetEventBusPillarHelpersForTests(): void {
  /* intentionally empty — zero module state to reset (Ozan requirement #4) */
}
