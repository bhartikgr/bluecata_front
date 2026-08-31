// server/lib/partnerDelegatedContext.ts
//
// WAVE 33 · CP-MSG-01 — "on whose behalf is this partner writing?"
//
// A Consortium Partner team member who is running a managed-founder engagement
// writes into comms as THEMSELVES. Nothing on the record says which client
// company they were acting for, or which engagement authorised it. On a
// partner-mediated deal that is the single most load-bearing fact about the
// message, and it was absent.
//
// This module resolves that context from durable rows only, and stamps it onto
// the channel or message at the moment of the write — never recomputed at read
// time. An engagement that lapses tomorrow must not silently rewrite what a
// message said today; the stamp is a historical fact and the unique index in
// 0181 enforces one stamp per (scope, ref).
//
// FAIL CLOSED, ALWAYS. A missing table, a blank id, a lapsed engagement, a
// removed team member: every one of them yields `null`, i.e. an ordinary
// personal message with no delegation claim attached. Asserting delegated
// authority that cannot be proven from the ledger is far worse than asserting
// none.
//
// ZERO caching: every call re-reads SQLite.
import { randomBytes } from "node:crypto";
/* WAVE 185 · ITEM B — the SAME partner-organisation authority the bind route
   validates its own `:partnerId` against. Imported for its `getById` only; this
   module adds no write path to the contacts store. */
import { getById as contactsGetById } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";
import { resolveCanonicalUserId } from "./investorIdentityAliasStore";
import { applyCommsDelegatedContextSchema } from "./applyCommsDelegatedContextSchema";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Engagement statuses that grant a partner live authority for a company. */
export const LIVE_ENGAGEMENT_STATUSES = ["ACTIVE"] as const;

export interface DelegatedEngagement {
  engagementId: string;
  companyId: string;
  companyName: string | null;
}

export interface PartnerDelegatedContext {
  partnerId: string;
  /** Null when the partner organisation row does not exist — never invented. */
  partnerName: string | null;
  actingUserId: string;
  engagements: DelegatedEngagement[];
}

/**
 * WAVE 185 · ITEM B · R150.2 — DOES THIS `partner_id` DENOTE A REAL PARTNER?
 *
 * `partner_team_members.partner_id` is not foreign-keyed, so any string can sit
 * in it, and on live one does: R150.2 measured `tenant_cp_keiretsu_ca` — a TENANT
 * id — in a column where `ac_consortium_partner_…` belongs. Every partner
 * audience walk then runs against an organisation that does not exist and
 * returns nobody, which is indistinguishable from a partner with no people.
 *
 * IT IS DELIBERATELY ASKED THREE WAYS, AND ANY ONE "YES" WINS.
 *
 * The first draft of this predicate asked ONLY `contacts`, and that was wrong in
 * a way that mattered. `contacts` is the durable table, but `adminContactsStore`
 * serves partner lookups from an in-memory map hydrated from it, and this tree's
 * own `data.db` has partner organisations reachable through that map while the
 * `contacts` table holds ZERO `consortium_partner` rows. A SQL-only predicate
 * therefore answers "not a partner" about organisations that plainly are ones —
 * and since a "no" is what licenses an admin to deactivate a membership, a
 * SQL-only answer could license deactivating a REAL partner membership. That is
 * a worse defect than the one this wave is fixing.
 *
 * So all three signals are consulted and ANY affirmative is decisive:
 *   (1) the in-memory canonical contact map — the SAME authority the bind route
 *       validates its own `:partnerId` against (`getById(id).kind ===
 *       "consortium_partner"`), so this cannot disagree with the route that
 *       writes. Read-only: this module gains no ability to write a contact.
 *   (2) the durable `contacts` row.
 *   (3) sponsorship of an SPV — `spv.sponsor_partner_id` is written only by the
 *       partner SPV path, so a string sitting there is corroborating durable
 *       evidence of partner-ness even if the organisation record is missing.
 *
 * EVERY failure direction is "treat it as resolvable", including a read error.
 * The asymmetry is the point: a false "yes" costs a still-unexplained emptiness
 * that the admin must escalate; a false "no" costs a deactivated real
 * membership. Only an unbroken silence from all three sources returns false.
 */
export function partnerIdResolvesToAPartner(partnerId: string): boolean {
  if (!isValidId(partnerId)) return false;
  const id = partnerId.trim();

  /* (1) THE AUTHORITY THE WRITE PATH USES. */
  try {
    const contact = contactsGetById(id);
    if (contact && contact.kind === "consortium_partner") return true;
  } catch { /* the map is unavailable here; fall through to the durable reads */ }

  /* (2) THE DURABLE ROW. */
  try {
    const row = rawDb()
      .prepare(
        `SELECT 1 AS hit FROM contacts
          WHERE id = ? AND kind = 'consortium_partner' AND deleted_at IS NULL LIMIT 1`,
      )
      .get(id) as { hit?: number } | undefined;
    if (row?.hit === 1) return true;
  } catch {
    /* Unreadable is NOT "absent" — it must never license a deactivation. */
    return true;
  }

  /* (3) CORROBORATING DURABLE EVIDENCE. */
  try {
    const row = rawDb()
      .prepare(`SELECT 1 AS hit FROM spv WHERE sponsor_partner_id = ? LIMIT 1`)
      .get(id) as { hit?: number } | undefined;
    if (row?.hit === 1) return true;
  } catch {
    return true;
  }

  return false;
}

/** The partner organisation an ACTIVE team member belongs to, or null. */
export function resolvePartnerIdForUser(userId: string): string | null {
  if (!isValidId(userId)) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT partner_id FROM partner_team_members
          WHERE user_id = ? AND status = 'active' AND removed_at IS NULL
          ORDER BY joined_at ASC LIMIT 1`,
      )
      .get(userId.trim()) as { partner_id?: string } | undefined;
    return isValidId(row?.partner_id) ? String(row?.partner_id).trim() : null;
  } catch {
    return null;
  }
}

/**
 * The partner organisation's registered name, or NULL.
 *
 * `partner_organizations` is empty on every database inspected during this wave
 * (see OQ-33-3, item 4) — no server path writes it. So this returns null far
 * more often than it returns a name, and every caller must render a stated
 * fallback rather than a blank or an invented org name.
 */
export function resolvePartnerName(partnerId: string): string | null {
  if (!isValidId(partnerId)) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT name FROM partner_organizations WHERE id = ? LIMIT 1`)
      .get(partnerId.trim()) as { name?: string } | undefined;
    const name = (row?.name ?? "").trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

function companyName(companyId: string): string | null {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT name FROM companies WHERE id = ? LIMIT 1`)
      .get(companyId) as { name?: string } | undefined;
    const n = (row?.name ?? "").trim();
    return n.length > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Every company this partner currently holds live delegated authority for.
 *
 * A row counts only when status is ACTIVE **and** the founder has not revoked
 * it **and** it is not archived. Those last two are separate columns, and
 * checking status alone would keep a founder-revoked engagement alive — the
 * exact fail-open a delegation claim must not have.
 */
export function liveEngagementsForPartner(partnerId: string): DelegatedEngagement[] {
  if (!isValidId(partnerId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id, company_id FROM mf_engagement
          WHERE partner_id = ?
            AND status = 'ACTIVE'
            AND founder_revoked_at IS NULL
            AND archived_at IS NULL
          ORDER BY created_at ASC`,
      )
      .all(partnerId.trim()) as Array<{ id?: string; company_id?: string }>;
    return rows
      .filter((r) => isValidId(r?.id) && isValidId(r?.company_id))
      .map((r) => ({
        engagementId: String(r.id).trim(),
        companyId: String(r.company_id).trim(),
        companyName: companyName(String(r.company_id).trim()),
      }));
  } catch {
    return [];
  }
}

/** The full delegated context for a user, or null when they are not a partner. */
export function resolveDelegatedContext(userId: string): PartnerDelegatedContext | null {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return null;
  return {
    partnerId,
    partnerName: resolvePartnerName(partnerId),
    actingUserId: userId.trim(),
    engagements: liveEngagementsForPartner(partnerId),
  };
}

/** The single engagement authorising this partner to act for `companyId`, or null. */
export function engagementFor(userId: string, companyId: string): DelegatedEngagement | null {
  if (!isValidId(companyId)) return null;
  const ctx = resolveDelegatedContext(userId);
  if (!ctx) return null;
  return ctx.engagements.find((e) => e.companyId === companyId.trim()) ?? null;
}

/* ============================================================
 *  Audience candidates — evaluated ONLY when the owner has
 *  enabled the corresponding rule (see commsAudienceRules.ts).
 * ============================================================ */

/** Active members of every company this partner holds a live engagement for. */
export function delegatedCompanyPeopleIds(userId: string): string[] {
  const ctx = resolveDelegatedContext(userId);
  if (!ctx || ctx.engagements.length === 0) return [];
  const out = new Set<string>();
  try {
    const db: any = rawDb();
    for (const e of ctx.engagements) {
      const rows = db
        .prepare(
          `SELECT user_id FROM company_members
            WHERE company_id = ? AND is_active = 1`,
        )
        .all(e.companyId) as Array<{ user_id?: string }>;
      for (const r of rows) if (isValidId(r?.user_id)) out.add(String(r.user_id).trim());
    }
  } catch {
    return [];
  }
  out.delete(userId.trim());
  return Array.from(out.values());
}

/** The other ACTIVE members of the viewer's own partner organisation. */
export function partnerTeamPeerIds(userId: string): string[] {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT user_id FROM partner_team_members
          WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL
            AND user_id <> ?`,
      )
      .all(partnerId, userId.trim()) as Array<{ user_id?: string }>;
    return Array.from(
      new Set(rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim())).values(),
    );
  } catch {
    return [];
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 167 · BATCH 3 ITEM E · R139.1 — THE PARTNER'S OWN LPs.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE SCOPE, STATED AS A SENTENCE: the people who hold a subscription in an SPV
 * THIS partner organisation sponsors, and nobody else.
 *
 * THE FENCE IS `spv.sponsor_partner_id`, AND IT IS THE WHOLE FENCE.
 * Every candidate is reached by walking OUT from the viewer's own partner id:
 * partner → the SPVs that partner sponsors → the subscriptions in those SPVs.
 * There is no branch that starts from an SPV, an LP or a company and walks IN, so
 * there is no input for which this returns a person from another partner's book.
 * A viewer with no partner id gets `[]`.
 *
 * WHY IT RESOLVES THROUGH THE ALIAS STORE.
 * `spv_subscription.investor_id` is a LEDGER id, and after wave 166 a direct-added
 * LP may hold a derived `ext_…` id with no account behind it at all. A ledger id is
 * not addressable: you cannot message it. `resolveCanonicalUserId` turns a ledger id
 * into the account that has CLAIMED it, and returns the input unchanged when nobody
 * has. So an unclaimed `ext_…` id falls out naturally at the `commsUserRef` lookup
 * in the directory handler, which is the correct outcome — a direct-added LP who has
 * not registered is a real position but not yet a reachable person.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO (R139.2).
 *  - It does NOT read `company_members`. `delegatedCompanyPeopleIds` is R108's
 *    withdrawn audience and stays withdrawn; this function does not reopen it.
 *  - It does NOT widen `cap_table_peer`, whose `notSpvBackedSql` fence is untouched.
 *  - It does NOT consult the Collective directory, chapters or follows.
 *  - It does NOT dedupe or otherwise alter `partner_team_members` rows (R135.8);
 *    it only READS them, through the pre-existing `partnerTeamPeerIds`.
 */
export function partnerOwnLpPeerIds(userId: string): string[] {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return [];
  const out = new Set<string>();
  try {
    const db: any = rawDb();
    /* ════════════════════════════════════════════════════════════════════════
       WAVE 199 · ITEM C · O3 — THE MISSING STATUS FILTER IS THE DESIGN. DO NOT
       "FIX" IT.
       ════════════════════════════════════════════════════════════════════════
       THE OWNER'S WORDS: "Yes, GP should be able to communicate with the
       prospective investor."

       This query deliberately has NO `sub.status` predicate. Every subscription in
       a partner-sponsored SPV makes its investor an eligible recipient, including
       one that is merely `invited`, `review`, `pending` or otherwise not yet
       accepted. That is the whole point: the person a GP most needs to talk to is
       the PROSPECTIVE investor — the one whose subscription is still under review.
       Filtering to accepted/active subscriptions would read like a tightening of
       permissions and would in fact remove the conversation the ruling exists to
       allow.

       This comment exists because the absence of a filter looks like an oversight
       to anyone reading the SQL cold, and a future wave "hardening" messaging
       would delete the capability while believing it was closing a hole. The
       protecting test is
       server/__tests__/wave199_itemC_o3_review_status_lp_is_eligible.test.ts — if
       a status predicate is ever added here, that test fails and names this ruling.

       WHAT DOES gate eligibility (wave 196 proved this against deliberately-shaped
       rows): a CLAIMED ACCOUNT. The candidate id from this query is passed through
       `resolveCanonicalUserId` and then `commsUserRef` →
       `durableCommsUserRef` → `userRow`, whose only test is
       `SELECT … FROM users WHERE id = ? AND deleted_at IS NULL`. NOTHING anywhere
       in that chain reads the email. An off-platform LP is invisible in the picker
       not because of a status and not because of a missing email field, but because
       a derived `ext_<hash>` id has no `users` row until the person is invited and
       registers. Subscription status is not, and must not become, part of that
       gate. */
    const rows = db
      .prepare(
        `SELECT DISTINCT sub.investor_id AS investor_id
           FROM spv_subscription sub
           JOIN spv ON spv.id = sub.spv_id
          WHERE spv.sponsor_partner_id = ?`,
      )
      .all(partnerId) as Array<{ investor_id?: string }>;
    for (const r of rows) {
      if (!isValidId(r?.investor_id)) continue;
      const canonical = resolveCanonicalUserId(String(r.investor_id).trim());
      if (isValidId(canonical)) out.add(canonical.trim());
    }
  } catch {
    return [];
  }
  /* The viewer is added to the candidate pool by the directory handler itself; a
     peer SOURCE returning the viewer would make "my own LPs" include me. */
  out.delete(userId.trim());
  return Array.from(out.values());
}

/**
 * R139.1's audience in one call: the partner's own LPs UNION the partner's own
 * team. Exposed as one function because the ruling is one sentence — "a partner
 * may reach their own LPs and their own team" — and splitting it across two call
 * sites is how one half later gets enabled without the other.
 */
export function partnerOwnAudienceIds(userId: string): string[] {
  const out = new Set<string>(partnerOwnLpPeerIds(userId));
  for (const id of partnerTeamPeerIds(userId)) out.add(id);
  out.delete(userId.trim());
  return Array.from(out.values());
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 177 · ITEM B · R148.3 item 5 — WHY DID THIS RULE REACH NOBODY?
 * ══════════════════════════════════════════════════════════════════════════════
 * The wave 167 preview could say a rule was enabled, applied to the viewer, and
 * still reached nobody — but not WHICH of two very different facts caused it:
 *   (i)  this viewer is not bound to any partner organisation at all, or
 *   (ii) they are bound, but that organisation has no LPs / no other members.
 * That distinction WAS the entire answer to R147, and a human had to find it by
 * cross-referencing two admin pages. This function reads it from live data.
 *
 * IT IS PURE OBSERVATION. It resolves nothing new, widens nothing, and shares the
 * exact readers the audience rules use — `resolvePartnerIdForUser`,
 * `partnerOwnLpPeerIds`, `partnerTeamPeerIds` — so the reason it reports cannot
 * drift from the emptiness it is explaining. The confidentiality fence is
 * untouched: no id crosses a partner boundary and no id is returned at all, only
 * counts of the viewer's OWN organisation and a sentence about it.
 *
 * NO MACHINE TOKENS IN THE PROSE. Wave 167's test P-2 asserts the admin preview
 * never leaks `partner_own_lp_peers`, `sponsor_partner_id`, `audienceUserIds`
 * and friends, so these sentences name no column, rule key or identifier.
 */
export type PartnerAudienceEmptyCause =
  | "no_partner_binding"
  /* WAVE 185 · ITEM B · R156.5 — THE R150.2 CASE, WHICH WAVE 177 DIAGNOSED WRONGLY.
     A membership row exists and is active, but its `partner_id` is not a partner
     at all — on live it holds a TENANT id (`tenant_cp_keiretsu_ca`) where an
     `ac_consortium_partner_…` id belongs. Wave 177 branched only on "is there a
     binding at all", so this case fell through to `partner_has_neither` and told
     the admin "this person is linked to a partner organisation, but that
     organisation has no colleagues and no investors on record" — a FALSE
     statement about the very case the diagnostic was built to explain, and one
     that sends the admin to look for LPs that were never the problem. */
  | "partner_binding_unresolvable"
  | "partner_has_no_lps"
  | "partner_has_no_other_members"
  | "partner_has_neither"
  | "not_empty";

export interface PartnerAudienceEmptyDiagnosis {
  cause: PartnerAudienceEmptyCause;
  /** One plain sentence for a human. Never contains an identifier or column name. */
  sentence: string;
  /** True only when the viewer resolves to no partner organisation at all. */
  viewerHasPartnerBinding: boolean;
  ownLpCount: number;
  otherTeamMemberCount: number;
}

/**
 * Why a partner-scoped audience rule resolved to nobody for THIS viewer.
 *
 * `scope` narrows the sentence to the rule being explained, because "this
 * partner has no LPs on record" is the honest reason for the LP rule and a
 * misleading one for the team rule.
 */
export function diagnosePartnerAudienceEmptiness(
  userId: string,
  scope: "own_lps" | "team" | "both",
): PartnerAudienceEmptyDiagnosis {
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) {
    /* THE LIVE CASE (R148.1). Both partner rules return [] before either the LP
       walk or the team walk ever runs, so no count is meaningful yet — reporting
       0 LPs here would blame the wrong record. */
    return {
      cause: "no_partner_binding",
      sentence:
        "This person is not linked to any partner organisation on record, so this rule stops before it looks for anybody. An administrator has to link their account to a partner organisation first.",
      viewerHasPartnerBinding: false,
      ownLpCount: 0,
      otherTeamMemberCount: 0,
    };
  }
  /* WAVE 185 · ITEM B · R150.2 — A BINDING THAT POINTS AT SOMETHING THAT IS NOT
     A PARTNER. Checked BEFORE the LP and team walks, because those walks return
     zero for an unresolvable id and a zero is indistinguishable from "this
     organisation genuinely has nobody" — which is the wrong sentence and sends
     the admin looking for the wrong missing fact.

     `viewerHasPartnerBinding` is reported FALSE. A row exists, but the honest
     answer to "does this person resolve to a partner organisation" is no, and
     every consumer of this flag is deciding whether to tell the admin to link an
     account — which is exactly what has to happen here. */
  if (!partnerIdResolvesToAPartner(partnerId)) {
    return {
      cause: "partner_binding_unresolvable",
      sentence:
        "This person's account is linked to a record that is not a partner organisation, so this rule stops before it looks for anybody. An administrator has to replace that link with a real partner organisation before messaging can work.",
      viewerHasPartnerBinding: false,
      ownLpCount: 0,
      otherTeamMemberCount: 0,
    };
  }
  const ownLpCount = scope === "team" ? 0 : partnerOwnLpPeerIds(userId).length;
  const otherTeamMemberCount = scope === "own_lps" ? 0 : partnerTeamPeerIds(userId).length;

  if (scope === "own_lps") {
    return ownLpCount > 0
      ? notEmpty(ownLpCount, otherTeamMemberCount)
      : {
          cause: "partner_has_no_lps",
          sentence:
            "This person is linked to a partner organisation, but that organisation has no investors on record in the deals it sponsors, so there is nobody for this rule to reach yet.",
          viewerHasPartnerBinding: true,
          ownLpCount,
          otherTeamMemberCount,
        };
  }
  if (scope === "team") {
    return otherTeamMemberCount > 0
      ? notEmpty(ownLpCount, otherTeamMemberCount)
      : {
          cause: "partner_has_no_other_members",
          sentence:
            "This person is linked to a partner organisation, but they are the only account linked to it, so this rule has no colleagues to reach.",
          viewerHasPartnerBinding: true,
          ownLpCount,
          otherTeamMemberCount,
        };
  }
  if (ownLpCount > 0 || otherTeamMemberCount > 0) return notEmpty(ownLpCount, otherTeamMemberCount);
  return {
    cause: "partner_has_neither",
    sentence:
      "This person is linked to a partner organisation, but that organisation has no colleagues and no investors on record, so there is nobody for this rule to reach yet.",
    viewerHasPartnerBinding: true,
    ownLpCount,
    otherTeamMemberCount,
  };
}

function notEmpty(ownLpCount: number, otherTeamMemberCount: number): PartnerAudienceEmptyDiagnosis {
  /* Reached when the rule is NOT actually empty. The caller only asks for a
     diagnosis after observing an empty result, so this is the disagreement case:
     it says so instead of inventing a reason for an emptiness that is not there. */
  return {
    cause: "not_empty",
    sentence: "",
    viewerHasPartnerBinding: true,
    ownLpCount,
    otherTeamMemberCount,
  };
}

/* ============================================================
 *  The stamp
 * ============================================================ */

export interface DelegatedStamp {
  scope: "channel" | "message";
  refId: string;
  actingUserId: string;
  partnerId: string;
  partnerName: string | null;
  companyId: string;
  companyName: string | null;
  engagementId: string;
  createdAt: string;
}

/**
 * Record that `userId` wrote `refId` on behalf of `companyId`.
 *
 * Returns the stamp, or null when the authority cannot be proven — in which
 * case NOTHING is written. `INSERT OR IGNORE` on the unique (scope, ref) index
 * makes a re-send idempotent and keeps the FIRST stamp, which is the one that
 * was true when the message was sent.
 */
export function stampDelegatedContext(
  scope: "channel" | "message",
  refId: string,
  userId: string,
  companyId: string,
): DelegatedStamp | null {
  if (!isValidId(refId) || !isValidId(userId) || !isValidId(companyId)) return null;
  const partnerId = resolvePartnerIdForUser(userId);
  if (!partnerId) return null;
  const engagement = engagementFor(userId, companyId);
  if (!engagement) return null;
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    db.prepare(
      `INSERT OR IGNORE INTO comms_delegated_context
         (id, scope, ref_id, acting_user_id, partner_id, company_id, engagement_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      `dctx_${randomBytes(8).toString("hex")}`,
      scope,
      refId.trim(),
      userId.trim(),
      partnerId,
      engagement.companyId,
      engagement.engagementId,
    );
    return readDelegatedContext(scope, refId);
  } catch {
    return null;
  }
}

/** The stamp on a channel or message, or null. Never throws. */
export function readDelegatedContext(
  scope: "channel" | "message",
  refId: string,
): DelegatedStamp | null {
  if (!isValidId(refId)) return null;
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    const row = db
      .prepare(
        `SELECT scope, ref_id, acting_user_id, partner_id, company_id, engagement_id, created_at
           FROM comms_delegated_context
          WHERE scope = ? AND ref_id = ? LIMIT 1`,
      )
      .get(scope, refId.trim()) as Record<string, string> | undefined;
    if (!row?.ref_id) return null;
    return {
      scope: row.scope === "channel" ? "channel" : "message",
      refId: row.ref_id,
      actingUserId: row.acting_user_id,
      partnerId: row.partner_id,
      partnerName: resolvePartnerName(row.partner_id),
      companyId: row.company_id,
      companyName: companyName(row.company_id),
      engagementId: row.engagement_id,
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}
