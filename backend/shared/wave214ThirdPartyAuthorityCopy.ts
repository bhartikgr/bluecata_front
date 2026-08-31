/**
 * shared/wave214ThirdPartyAuthorityCopy.ts — WAVE 214
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Wave 213 established the shape of the problem: a partner publishes a
 * company's revenue, ARR, margin, cap-table summary and last valuation to every
 * active chapter member, and the company is never told (R197.2). Wave 213 built
 * the partner's confirmation for THAT surface. This wave covers the surfaces
 * where a user puts ANOTHER PARTY's data into the platform in the first place —
 * a named person's email address, or a whole company record created in that
 * company's name.
 *
 * The text a user acknowledges must be recordable BYTE-FOR-BYTE and hashable.
 * R187.3 is the reason: an e-signature envelope existed and could prove nothing
 * because no hash of the presented text was captured, so nobody could later say
 * WHAT had been agreed. So every statement lives here, as a single exported
 * `const`, imported by BOTH the screen that shows it and the server that hashes
 * it. There is exactly one copy of each string in the tree.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STRINGS LIVE IN `shared/` AND NOT IN THE COMPONENT
 * ---------------------------------------------------------------------------
 * If the screen owned the literal and the server owned a second copy of it, the
 * hash would attest to the server's copy while the user read the screen's. The
 * two would drift on the first copy edit and nothing would fail. One literal,
 * two importers, is the only arrangement in which the hash means what it says.
 *
 * ---------------------------------------------------------------------------
 * THE 240-CHARACTER `looksHuman` GATE (handbook §5.4)
 * ---------------------------------------------------------------------------
 * `client/src/lib/queryClient.ts:60-65` silently replaces any server message of
 * 240 characters or more with a generic status line. Four refusals have been
 * swallowed by it. The REFUSAL headlines below are therefore assembled through
 * `fitToGate()` (wave 195, reused by 197, 198) and measured in a test — never
 * hand-trimmed and never assumed to fit.
 *
 * The ACKNOWLEDGEMENT statements are NOT refusals and never travel as a server
 * `message`, so the gate does not apply to them; they are allowed to be as long
 * as they need to be to be honest. That distinction is deliberate and is
 * asserted in the tests so a later reader does not "fix" it.
 */
import { fitToGate } from "./refusalHeadlineGate";

/**
 * The four surfaces this wave gates. A stable machine key per surface, used as
 * the audit payload's `surface` and as the `data-testid` stem on the screens, so
 * a row in the ledger can be traced to a screen without guessing.
 */
export const WAVE214_AUTHORITY_SURFACES = {
  partnerPortfolioCompany: "partner.portfolio_company.create_and_invite_founder",
  founderTeamInvitation: "founder.team.invitation",
  partnerTeamInvitation: "partner.team.invitation",
} as const;

export type Wave214AuthoritySurface =
  (typeof WAVE214_AUTHORITY_SURFACES)[keyof typeof WAVE214_AUTHORITY_SURFACES];

/**
 * SURFACE 1 — create a company and invite its founder.
 *
 * This is the most exposed surface on the platform, and the reason is in the
 * build document, verbatim: "that person did not choose to be on your platform
 * and still has full data-protection rights including access and objection."
 * The partner types a company name and a founder's email address; the platform
 * creates a real company account owned by a pending identity derived from that
 * email, tags it to the partner's firm, and issues a claim link.
 *
 * A TYPED NAME is required here rather than a tick. The distinction is not
 * decorative: a tick records that a control was in a state, a typed name records
 * that a specific human put their own name to a specific assertion. This surface
 * creates an account for someone else, so it gets the stronger of the two.
 */
export const WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT =
  "I confirm that I am authorised to create a Capavate company record for this business and to " +
  "provide this founder's name and email address for the purpose of inviting them to claim it. " +
  "I understand that Capavate will create an account associated with that email address, that the " +
  "founder can access, correct and object to the data held about them and their company, and that " +
  "Capavate may contact them about this invitation. I am typing my name below as my confirmation.";

/**
 * SURFACE 2 and 3 — invite a team member (founder company, and partner firm).
 *
 * A tick, not a typed name. The invitee is a real person whose email address the
 * inviter is submitting, so a confirmation is warranted; but no account is
 * created until that person themselves redeems the invitation and sets a
 * password, so the assertion being made is narrower than surface 1's.
 *
 * The two statements are separate constants even though they are near-identical,
 * because they are shown in different products to different roles and there is
 * no version of this platform's history in which sharing one literal between two
 * screens has not eventually caused one of them to say something false.
 */
export const WAVE214_FOUNDER_TEAM_INVITE_AUTHORITY_STATEMENT =
  "I confirm I am authorised to give this person's email address to Capavate in order to invite " +
  "them to my company's workspace, and that they are expecting to be invited. Capavate will email " +
  "them an invitation. They can access, correct and object to the data held about them.";

export const WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT =
  "I confirm I am authorised to give this person's email address to Capavate in order to invite " +
  "them to my firm's workspace, and that they are expecting to be invited. They can access, " +
  "correct and object to the data held about them.";

/**
 * The consequence lines. Wave 213's finding was that a confirmation without a
 * statement of consequence is a tick in search of a meaning; these say what
 * actually happens next, and nothing more. Note surface 3 does NOT claim an
 * email is sent, because it is not: `POST /api/partner/me/team/invitations`
 * returns a one-time token for the inviter to send themselves. Saying "we will
 * email them" there would be an affirmative misstatement of the platform's own
 * behaviour, which is the error class the build document calls the worst kind.
 */
export const WAVE214_PORTFOLIO_COMPANY_CONSEQUENCE =
  "On confirming: a new company account is created, tagged to your firm, and a claim invitation is issued to the founder's email address.";

export const WAVE214_FOUNDER_TEAM_INVITE_CONSEQUENCE =
  "On confirming: Capavate emails this person an invitation link to join your company workspace.";

export const WAVE214_PARTNER_TEAM_INVITE_CONSEQUENCE =
  "On confirming: an invitation is created and a one-time link is shown to you once, for you to send to them. Capavate does not email them.";

/** The label beside the typed-name field on surface 1. */
export const WAVE214_TYPED_NAME_LABEL = "Type your full name to confirm";

/** The label beside the tick on surfaces 2 and 3. */
export const WAVE214_TICK_LABEL = "I confirm I am authorised to provide this person's details";

/**
 * REFUSALS. These travel as the server's `message` and are therefore subject to
 * the 240-character gate. Built through `fitToGate` with the surface key as the
 * only interpolated identifier, so a long surface key shortens rather than
 * pushing the whole message past the gate and into invisibility.
 */
export function wave214AuthorityMissingHeadline(surface: string): string {
  return fitToGate((idBudget) => {
    const shown = surface.length > idBudget ? `${surface.slice(0, Math.max(0, idBudget - 1))}…` : surface;
    return (
      "This step needs your confirmation that you are authorised to provide another party's details. " +
      `Tick or type the confirmation shown on the form and submit again (${shown}).`
    );
  });
}

export function wave214TypedNameMismatchHeadline(): string {
  return fitToGate(() =>
    "The name you typed does not match the confirmation on the form. Type your full name exactly as " +
    "you want it recorded against this confirmation, then submit again.",
  );
}

/**
 * The machine-readable error codes. Separate from the headlines because the
 * client switches on the code and shows the headline; conflating them is how a
 * refusal ends up with no code and an untestable message.
 */
export const WAVE214_ERR_AUTHORITY_NOT_CONFIRMED = "AUTHORITY_NOT_CONFIRMED";
export const WAVE214_ERR_AUTHORITY_NAME_REQUIRED = "AUTHORITY_NAME_REQUIRED";

/**
 * NOTIFICATION COPY — the company-publication notice (R197.2).
 *
 * CRITICAL CONSTRAINT, and it governs every byte below: this notice must tell
 * the company THAT its profile was published and BY WHOM, and must not disclose
 * chapter members' identities, their notes, or anything else the company is not
 * entitled to see. The body therefore interpolates exactly ONE variable — the
 * publishing firm's display name — and nothing that is derived from a chapter
 * member, a viewer list, a count of viewers, or any note.
 *
 * There is deliberately no "N members can now see this" phrasing. A count is a
 * fact about the chapter's membership, not about the company, and the moment a
 * count is in the body somebody will want to make it a list.
 */
export const WAVE214_COMPANY_PUBLICATION_NOTICE_TITLE = "Your company profile was published to the Collective";

export function wave214CompanyPublicationNoticeBody(publisherDisplayName: string): string {
  return fitToGate((idBudget) => {
    const shown =
      publisherDisplayName.length > idBudget
        ? `${publisherDisplayName.slice(0, Math.max(0, idBudget - 1))}…`
        : publisherDisplayName;
    return (
      `${shown} published your company's profile to the Collective deal room, where Collective members can now see it. ` +
      "You were not asked beforehand. Contact the firm, or Capavate support, if this was not authorised."
    );
  });
}

/**
 * The admin-visible reason a notice was NOT sent. R201.2's rule applies here in
 * spirit: an absent recipient must not be recorded as a delivered notice, and it
 * must not be recorded as a zero either. Each of these is a named state.
 */
export const WAVE214_NOTICE_INERT_REASONS = {
  noClaimedOwner:
    "No claimed Capavate identity owns this company yet — the only owner is an unclaimed pending-founder placeholder created from an email address. No notice was sent because there is no account to notify, and Capavate will not guess an address.",
  noCompanyOnRecord:
    "The published promotion carries no company record on Capavate, so there is no party to notify.",
  notifierFailed:
    "The notification mechanism reported a failure. The publication still completed. This row is the record that the company was not told.",
} as const;

export type Wave214NoticeInertReason = keyof typeof WAVE214_NOTICE_INERT_REASONS;
