/**
 * WAVE 189 · ITEM B · R159.6 — LP CONVERSATIONS ARE A FIRM RECORD.
 * ══════════════════════════════════════════════════════════════════════════════
 * Owner, verbatim: *"Team-visible. Go with your recommendation and global investor
 * grade best practice."*
 *
 * THE RECOMMENDATION THE OWNER ADOPTED. A limited partner's correspondence with a
 * partner organisation is a record of the FIRM, not of the individual who happened
 * to type it. It must survive that individual leaving, and it must be reviewable by
 * the firm that is accountable for it. Before this wave a thread was readable by its
 * named participants alone: when a relationship manager left, the LP's entire
 * written history left with them, and no colleague could answer a question about
 * what the firm had already told that investor.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE FENCE, AND WHY THIS FILE IS SHAPED THE WAY IT IS
 * ══════════════════════════════════════════════════════════════════════════════
 * This module WIDENS who may read a conversation. That is the whole risk, so the
 * widening is expressed once, here, as a single predicate that every read path
 * calls — rather than as five similar conditions maintained in five places that
 * drift apart. The fence:
 *
 *   A caller may read an LP thread they are not a participant in
 *   IF AND ONLY IF
 *     (1) the caller is an ACTIVE team member of some partner organisation P, AND
 *     (2) some OTHER participant of that thread is an ACTIVE team member of the
 *         SAME organisation P, AND
 *     (3) some participant of that thread is an INVESTOR by durable record.
 *
 * WHAT EACH CLAUSE REFUSES, stated so the refusals can be read without running the
 * code:
 *   · Clause (1) refuses a founder, an investor, an unaffiliated account and a
 *     REMOVED or INACTIVE former team member. Membership is read with the
 *     `status = 'active' AND removed_at IS NULL` idiom, so a removal takes effect on
 *     the next read with no cache to invalidate and no session to expire.
 *   · Clause (2) is the ORGANISATION fence. It is an equality on a partner id that
 *     was resolved INDEPENDENTLY for the caller and for the participant, from the
 *     same table. Another partner's team member fails it because their id differs.
 *     There is no path here that starts from the thread and walks outward to a set
 *     of partners; both ids are pulled from membership rows and then compared, so
 *     there is no input for which two different organisations compare equal.
 *   · Clause (3) confines the widening to LP correspondence. A partner-to-founder
 *     thread and a partner-internal thread are NOT widened by this module: the owner
 *     ruled on LP communication, and widening anything else would be a privacy change
 *     nobody asked for.
 *
 * IT FAILS CLOSED, ALWAYS. Every lookup is wrapped, and any throw — an unreadable
 * table, a missing column, a malformed row — returns `false`. A failure to establish
 * entitlement is never read as entitlement. This is the opposite of the fail-OPEN
 * choice in `spvAttestationGate.spvIsAttested`, and deliberately so: there, an
 * unreadable table must not freeze a partner's fundraising; here, an unreadable table
 * must not leak an investor's correspondence.
 *
 * IT ONLY EVER ADDS. This predicate is consulted as an OR beside the existing
 * participant check, never in place of it. It cannot deny a read that already
 * succeeded, so no participant loses access and no existing confidentiality test can
 * change verdict because of it.
 *
 * IT IS NOT WIRED INTO WRITES. Reading the firm's record is the ruling; speaking as
 * the firm is not. `POST` into a thread, and `PATCH`/`DELETE` of a message, remain
 * participant-only and sender-only respectively, so a colleague can review the
 * history without being able to put words into the conversation or edit what a
 * departed colleague said.
 */
import {
  resolvePartnerIdForUser,
  resolvePartnerName,
} from "./partnerDelegatedContext";
import { resolveDmRole } from "../messagingPolicy";

/** The minimum a caller must hand over. Structurally typed so this module never
 *  needs to import the messaging store's row type, which would make the dependency
 *  circular. */
export interface PartnerLpThreadVisibilitySubject {
  participantUserIds: string[];
}

function isUsableId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * THE WIDENING PREDICATE. `true` means "this caller may read this LP thread as a
 * member of the partner organisation that owns the relationship".
 *
 * NOTE WHAT THIS DOES NOT DO: it does not consider whether the caller is already a
 * participant. That question is answered by the caller's own existing check, which
 * stays exactly where it is. This answers only the NEW question.
 */
export function mayPartnerOrgReadLpThread(
  thread: PartnerLpThreadVisibilitySubject | null | undefined,
  callerUserId: string | null | undefined,
): boolean {
  try {
    if (!isUsableId(callerUserId)) return false;
    const caller = callerUserId.trim();

    const participants = Array.isArray(thread?.participantUserIds)
      ? thread!.participantUserIds.filter(isUsableId).map((p) => p.trim())
      : [];
    if (participants.length === 0) return false;

    /* CLAUSE (1) — the caller's own ACTIVE membership. A removed member, an
       inactive member, a founder, an investor and an unaffiliated account all
       resolve to null here and are refused before anything else is read. */
    const callerPartnerId = resolvePartnerIdForUser(caller);
    if (!isUsableId(callerPartnerId)) return false;

    /* CLAUSE (2) — the ORGANISATION fence. Resolved independently for each
       participant and compared for equality. The caller is excluded from this scan
       so that a caller who is themselves the only partner participant does not
       satisfy the clause against themselves — that case is already covered by the
       untouched participant check, and letting it pass here would mean a lone
       partner participant "widens" to nobody while reporting that a widening
       occurred. */
    let sameOrgColleagueIsAParticipant = false;
    for (const p of participants) {
      if (p === caller) continue;
      if (resolvePartnerIdForUser(p) === callerPartnerId) {
        sameOrgColleagueIsAParticipant = true;
        break;
      }
    }
    if (!sameOrgColleagueIsAParticipant) return false;

    /* CLAUSE (3) — an INVESTOR is in this conversation. The ruling is about LP
       communication, so a partner-to-founder or partner-internal thread is left
       exactly as confidential as it was. */
    let investorIsAParticipant = false;
    for (const p of participants) {
      if (p === caller) continue;
      if (resolveDmRole(p) === "investor") {
        investorIsAParticipant = true;
        break;
      }
    }
    if (!investorIsAParticipant) return false;

    return true;
  } catch {
    /* FAILS CLOSED. An unreadable membership table is not a reason to show an
       investor's correspondence to someone who cannot be shown to be entitled. */
    return false;
  }
}

/**
 * Does this thread carry an LP relationship that belongs to a partner ORGANISATION
 * at all? Used by the LP-facing disclosure so the notice appears on threads where
 * it is TRUE and stays off threads where it would be a false statement.
 *
 * This is asked from the INVESTOR's side, so it deliberately does NOT require the
 * asker to be a partner. It asks only: is some participant an active member of a
 * partner organisation, and is the asker the investor in the conversation.
 */
export function lpThreadIsVisibleToAPartnerFirm(
  thread: PartnerLpThreadVisibilitySubject | null | undefined,
  investorUserId: string | null | undefined,
): { visible: boolean; partnerId: string | null; partnerName: string | null } {
  const none = { visible: false, partnerId: null, partnerName: null };
  try {
    if (!isUsableId(investorUserId)) return none;
    const investor = investorUserId.trim();
    const participants = Array.isArray(thread?.participantUserIds)
      ? thread!.participantUserIds.filter(isUsableId).map((p) => p.trim())
      : [];
    if (!participants.includes(investor)) return none;

    for (const p of participants) {
      if (p === investor) continue;
      const pid = resolvePartnerIdForUser(p);
      if (isUsableId(pid)) {
        /* `resolvePartnerName` returns null far more often than not —
           `partner_organizations` is empty on every database inspected — so the
           name is carried as NULLABLE and every surface must render a stated
           fallback rather than a blank. */
        return { visible: true, partnerId: pid, partnerName: resolvePartnerName(pid) };
      }
    }
    return none;
  } catch {
    return none;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * THE DISCLOSURE — R159.6, clause 3: "Tell the LP."
 * ══════════════════════════════════════════════════════════════════════════════
 * The copy itself lives in `shared/lpThreadFirmVisibilityCopy.ts` so the sentence the
 * investor reads and the fence this module enforces are ONE artefact and cannot drift
 * apart. It is re-exported here so a server-side caller does not need to know which
 * side of the tree the wording sits on.
 */
export {
  LP_THREAD_FIRM_VISIBILITY_HEADLINE,
  LP_THREAD_FIRM_VISIBILITY_BODY,
  LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM,
} from "../../shared/lpThreadFirmVisibilityCopy";
