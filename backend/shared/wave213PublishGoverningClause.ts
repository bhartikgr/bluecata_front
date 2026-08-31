/**
 * WAVE 213 — THE GOVERNING CLAUSE FOR "PUBLISH TO COLLECTIVE", ON THE SCREEN
 * WHERE IT GOVERNS.
 *
 * Ruling R188.4 item 3 / decisions D4 and C6: *"A deliberate decision not to show
 * the terms at the moment they apply. It should be reversed."* Before this wave a
 * partner published a third party's company data to a chapter of investors after
 * reading six sentences, none of which was a term:
 *
 *   "Promote to Collective Deal Room" · "This deal will be submitted for
 *   Collective admin review." · "Deal: {name}" · "Notes (optional)" ·
 *   "Why this deal fits the Collective..." · "Cancel" · "Promote"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TEXT LIVES IN `shared/` AND NOT IN THE PAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Three reasons, all load-bearing.
 *
 * 1. ONE COPY OF A LEGAL SENTENCE. The sentence the partner READS and the
 *    sentence the server RECORDS must be the same bytes, or the day they diverge
 *    the partner confirms one thing and the platform files another. This is the
 *    defect `shared/spvAttestation.ts` was created to end, and this module
 *    follows it deliberately: one definition, versioned, imported by both sides.
 * 2. THE SERVER ENFORCES IT. `server/partnerRoutes.ts` rebuilds the
 *    acknowledgement sentence itself and refuses a request whose text does not
 *    match. That is only sound if both sides read the same constant.
 * 3. `client/src/pages/partner` and `client/src/components/partner` are scanned
 *    string-literal-by-string-literal by `w135_partner_copy_and_seats`, which
 *    pins the exact residue its `COPY_RULES` tag. `shared/` is not scanned. Copy
 *    authored here reaches the DOM as an expression, so a long legal paragraph
 *    cannot accidentally extend that pinned residue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY SENTENCE BELOW IS TRACED TO CODE. NOTHING IS ASSERTED FROM A BRIEF.
 * ─────────────────────────────────────────────────────────────────────────────
 * The wave-213 brief's description of this feature was wrong in four ways, and it
 * warned that it might be. What was verified on the tree, and where:
 *
 *  · NOT IMMEDIATE. `partnerDealPromotionsStore.create`
 *    (`server/partnerWorkspaceStore.ts`) writes `status:"pending_collective_review"`,
 *    `moderationStatus:"pending"`. Visibility begins only at
 *    `applyModeration`/`handleTransition("approve")`
 *    (`server/promotionModerationRoutes.ts`), which calls
 *    `ensurePromotionDirectoryListing` (`server/collectiveInterestStore.ts`).
 *  · THE AUDIENCE is every active Collective member of the chapter
 *    (`requireCollectiveMember` + `getListedCompanyIdsForChapters`) and platform
 *    administrators across chapters.
 *  · THE FIELDS are whatever `GET /api/collective/dealroom/companies`,
 *    `GET /api/collective/companies` and `GET /api/collective/companies/:id`
 *    return (`server/collectiveRoutes.ts`) — which includes revenue, margin and
 *    growth figures, last raise and valuation, a cap-table summary with the
 *    option-pool percentage, M&A-readiness scores, and the last twenty audit-log
 *    entries mentioning the company.
 *  · THE PUBLISHING FIRM IS NAMED: `source:"partner"`, `partnerId`, and
 *    `attributedPartner {partnerId, name}` on the detail route.
 *  · EVERY CHAPTER MEMBER IS NOTIFIED on approval
 *    (`notifyChapterMembersOfApproval`), and THE COMPANY IS NOT NOTIFIED — no
 *    founder-directed notification exists on any promotion path.
 *  · REVERSAL IS PARTIAL. `POST /api/partner/me/promotions/:id/withdraw`
 *    (`server/partnerRoutes.ts`, managing_partner only) sets `status:"withdrawn"`
 *    and drops the deal-room row, but does NOT remove the
 *    `collective_directory_listings` row; `removeDirectoryListing` is called only
 *    from `server/adminCollectiveRoutes.ts` when an admin rejects a FOUNDER
 *    application. So the company stays visible on the directory routes.
 *
 * WHY THERE IS NO "CAPAVATE DOES NOT USE THIS FOR MARKETING OR MODEL TRAINING"
 * SENTENCE. Draft 05 offered several. A negative claim feels safe and is not: an
 * earlier legal pass shipped a draft disclaiming cross-customer benchmarking
 * while the platform actually performs it (`dscScoringEngine.ts` computes a
 * sector median across all companies in the sector; `portfolioAnalyticsStore.ts`
 * builds cohort benchmarks from platform data). Six of that pass's seven findings
 * were sentences of the form "Capavate does not…". So the rule applied here is:
 * a negative survives only if a specific code path proves it. Searching and not
 * finding a marketing consumer is not proof of absence (handbook item 17), and
 * R-ASSERT forbids presenting an unmeasured fact as a fact. Those sentences are
 * therefore ABSENT rather than softened, and what replaces them is the
 * affirmative statement of the uses that were found.
 *
 * WHY BENCHMARKING IS ADMITTED RATHER THAN DENIED. R190.10: the owner keeps
 * sharing open and the DOCUMENTS change instead. `MaPrivacyConsent.tsx` is the
 * founder's own switch ("Share my M&A profile across the Collective for
 * benchmarking and matchmaking?", default chapter-only), so the capability is
 * real, is off by default for the Collective, and is configured elsewhere. The
 * clause says exactly that and no more. Wave 221 builds the partner-side
 * opt-out; nothing here says an opt-out cannot exist.
 *
 * WHY THE CLAUSE DOES NOT SAY PUBLISHING IS PERMITTED BY THE PARTNER'S
 * AGREEMENT. Consortium Partner Agreement §7.1 makes Deal information
 * confidential in the Partner's hands and §7.2 confines its use. The agreement is
 * signed, enforced fail-closed and must not be modified, so this clause takes the
 * opposite tack from reassurance: it makes the Partner confirm authority (§8(b)
 * already puts accuracy and lawfulness on them), and it QUOTES §7 rather than
 * restating it — see `consortiumAgreementSection`.
 *
 * FALLBACK (spec 213.5). If the clause body cannot be produced, the panel must
 * not render empty. `PUBLISH_CLAUSE_UNAVAILABLE_COPY` is the explicit no-clause
 * branch, and it defers nothing: it names the agreement, links to where the
 * partner can read it, and says publishing is refused meanwhile.
 *
 * Dependency-free apart from `./consortiumAgreement`, which is itself
 * dependency-free, so this module is safe in the browser bundle.
 */
import { CONSORTIUM_AGREEMENT_TEXT, CONSORTIUM_AGREEMENT_VERSION } from "./consortiumAgreement";
import { fitToGate } from "./refusalHeadlineGate";

/** Clause identity. Recorded with every acknowledgement so the exact wording assented to is provable. */
export const PUBLISH_CLAUSE_ID = "PUBLISH-v1";
/** Bump when the wording changes. Never mutate a shipped version in place (the `spvAttestation` rule). */
export const PUBLISH_CLAUSE_VERSION = "v1";

/** Where a partner reads the full Consortium Partner Agreement, in-app, signed in. */
export const PUBLISH_CLAUSE_AGREEMENT_PATH = "/collective/partner/agreement";
/** Link label. Names the destination, so the text reads as a pointer and not as a substitute. */
export const PUBLISH_CLAUSE_AGREEMENT_LINK_LABEL =
  `Read your Consortium Partner Agreement (${CONSORTIUM_AGREEMENT_VERSION}) in full`;

export const PUBLISH_CLAUSE_HEADING = "What publishing does, and what you are confirming";
export const PUBLISH_CLAUSE_AGREEMENT_HEADING =
  "Your confidentiality obligation, quoted from the agreement you signed";

/**
 * The heading of the section of the signed agreement this clause sits under.
 * Kept separate from the quote so the quote itself is never hand-typed.
 */
const AGREEMENT_SECTION_MARKER = "## 7.";

/**
 * §7 of the Consortium Partner Agreement, SLICED OUT OF THE SIGNED TEXT at
 * runtime.
 *
 * Item C.3: where a term genuinely lives in the Consortium Partner Agreement —
 * competent, signed, enforced fail-closed, not to be modified — the fix is to
 * link to and quote the relevant clause, NOT to restate it in new words that
 * could diverge from the signed text. Deriving the quote is what makes divergence
 * structurally impossible: if counsel replaces `CONSORTIUM_AGREEMENT_TEXT` and
 * bumps the version (which the agreement module explicitly supports with no code
 * surgery), this quote follows automatically.
 *
 * Returns `null` rather than throwing, and rather than returning an empty string.
 * A caller that gets `null` renders the no-clause fallback; a caller that got ""
 * would render a heading over nothing, which is the "empty panel" harm spec 213.5
 * names. `null` cannot be mistaken for a quote, and it is never compared as if it
 * were one.
 */
export function consortiumAgreementSection(marker: string = AGREEMENT_SECTION_MARKER): string | null {
  const start = CONSORTIUM_AGREEMENT_TEXT.indexOf(marker);
  if (start < 0) return null;
  const rest = CONSORTIUM_AGREEMENT_TEXT.slice(start);
  const nextHeading = rest.indexOf("\n## ", marker.length);
  const body = (nextHeading < 0 ? rest : rest.slice(0, nextHeading)).trim();
  return body.length > 0 ? body : null;
}

/**
 * The clause, as an ordered list of paragraphs, with the subject named in every
 * paragraph that has one.
 *
 * `subject` is the deal as it is named ON THIS SCREEN — the same
 * `dealName` the partner is looking at and the same value the server holds on the
 * publish route. Both sides therefore build byte-identical text, which is what
 * makes the server's identity check enforceable rather than decorative. The
 * evidence written to the audit record additionally carries the resolved
 * `companyId` and the company's registered name, so the record identifies the
 * real company even where a partner's deal label differs from it.
 */
export function publishGoverningClauseParagraphs(subject: string): string[] {
  const s = subject.trim();
  const name = s.length > 0 ? s : "this deal";
  return [
    `Publishing submits ${name} to the Capavate Collective Deal Room. It does not ` +
      `take effect immediately: the submission is recorded as pending Collective ` +
      `review, and a Collective administrator decides whether it is listed. Nothing ` +
      `is visible to Collective members until that decision is made.`,

    `Once it is listed, ${name} becomes visible to every active Collective member ` +
      `of this chapter, and to Capavate platform administrators. What becomes ` +
      `visible is the company profile, not a summary of it: alongside sector, stage, ` +
      `pitch, links, jurisdiction, headquarters and headcount, the profile carries ` +
      `reported revenue, margin, growth and customer figures, the last raise and ` +
      `valuation, a cap-table summary including the option-pool percentage, ` +
      `transaction- and M&A-readiness scores, and the most recent recorded activity ` +
      `on the platform relating to the company.`,

    `Your firm is named. The listing records your firm as the source of the ` +
      `submission and shows it as the attributed partner on the company profile. ` +
      `Publishing is not anonymous.`,

    `When the submission is listed, every active member of this chapter is notified ` +
      `that a consortium partner has been approved to share a new deal. ${name} is ` +
      `not notified — not when you publish, not when it is listed, and not if the ` +
      `submission is later made private. If the company should know, you have to ` +
      `tell them.`,

    `Anything you type in the notes field is read by the Collective administrators ` +
      `who review the submission. It is not shown to Collective members.`,

    `By publishing you confirm that you are authorised to disclose this information, ` +
      `and that doing so breaches no confidentiality, contractual or data-protection ` +
      `duty you owe to ${name}, to its shareholders, or to anyone else. Where the ` +
      `profile contains information about identifiable people, you confirm you have ` +
      `whatever consent or other lawful basis that disclosure needs. Capavate does ` +
      `not obtain that authority or that consent for you, and there is no step in ` +
      `this flow that asks the company for it.`,

    `Capavate transmits, stores and displays what you publish so that Collective ` +
      `members can see it. A Collective administrator's approval is a decision to ` +
      `list the submission. It is not a check that the information is accurate, and ` +
      `it is not an endorsement of ${name} or of the opportunity.`,

    `You cannot fully undo this. A managing partner of your firm can make the ` +
      `submission private, which removes ${name} from the Deal Room listing; an ` +
      `associate who published it cannot. Making it private does not remove the ` +
      `company from the Collective company directory, where it stays visible to ` +
      `Collective members. It does not withdraw the notification already sent, it ` +
      `does not recall what members have already read, copied or exported, and it ` +
      `does not delete the record of the submission.`,

    `Separately from this submission, Capavate compares companies on the platform ` +
      `against each other to produce sector benchmarks and matches. For a company's ` +
      `M&A profile that comparison is limited to its own chapter unless the company ` +
      `switches Collective-wide sharing on itself, and it is described where that ` +
      `switch is, not here.`,

    `The submission, the decision on it, and the confirmation you give below are ` +
      `recorded permanently in Capavate's append-only audit record.`,
  ];
}

/**
 * The single acknowledgement sentence — one tick.
 *
 * WHY ONE TICK AND NO TYPED LEGAL NAME. The SPV launch sign-off
 * (`shared/spvAttestation.ts`) takes a typed name because the signer is
 * EXECUTING AN INSTRUMENT and the platform needs ESIGN/UETA-grade evidence of who
 * bound the vehicle. Publishing executes no instrument and binds nobody: the
 * partner is already bound by a signed agreement whose typed-name signature,
 * timestamp, version and integrity hash are recorded (agreement §12.1). A typed
 * legal name in front of a network-sharing action would also be the closest thing
 * in this wave to the eligibility barrier R190.10 forbids — friction that makes an
 * open action feel like an application. One mandatory tick naming the subject and
 * the consequence is proportionate, and a sentence that identifies its own subject
 * is the wave-169 lesson applied.
 *
 * WHY NOT TWO TICKS. Splitting authority from consequences yields two sentences
 * either of which can be ticked without reading the other. One sentence carrying
 * both is stronger evidence.
 */
export function publishAcknowledgementText(subject: string): string {
  const s = subject.trim();
  const name = s.length > 0 ? s : "this deal";
  return (
    `I confirm that I am authorised to publish ${name} to the Capavate Collective ` +
    `and that doing so breaches no duty I owe; and I understand that once a ` +
    `Collective administrator lists it, the company profile — including its ` +
    `financial figures, cap-table summary and readiness scores — becomes visible to ` +
    `every Collective member of this chapter with my firm named as the source, ` +
    `that the company is not notified, and that I cannot fully undo it.`
  );
}

/**
 * The no-clause branch (spec 213.5). Rendered when the clause body cannot be
 * produced — which, on this tree, means the signed agreement text could not be
 * read.
 *
 * It defers nothing. It names the instrument, links to where the partner can read
 * it in full, and states the consequence: publishing is refused while the terms
 * cannot be shown. That is the inverse of the sentence this wave exists to
 * reverse — the old sentence withheld the clause and let the action proceed.
 */
export const PUBLISH_CLAUSE_UNAVAILABLE_COPY =
  "The governing terms for publishing could not be assembled for this screen, so " +
  "they are not shown and publishing is refused rather than proceeding without " +
  "them. The terms that apply are in your Consortium Partner Agreement, which you " +
  "can open and read in full from the link below.";

/** Field name carried on the publish request. */
export const PUBLISH_ACK_FIELD = "publishAcknowledgement";

/* ══════════════════════════════════════════════════════════════════════════════
 * THE TWO SERVER REFUSALS.
 * ══════════════════════════════════════════════════════════════════════════════
 * These are refusal messages returned to a browser, so unlike the clause body
 * they pass through `client/src/lib/queryClient.ts`'s `looksHuman` gate: strictly
 * under 240 characters, and containing a lowercase letter. Both are built with
 * `fitToGate()` (`shared/refusalHeadlineGate.ts`) rather than hand-trimmed, and
 * their length is measured in a test rather than eyeballed. Neither leaks a field
 * name, a route or an internal code — and neither defers a term: the terms are on
 * the screen the caller skipped.
 */

/** No acknowledgement at all — the direct-API case, and the disabled-button case. */
export const PUBLISH_ACK_MISSING_MESSAGE = fitToGate(
  () =>
    "Nothing was published. Publishing to the Collective needs the confirmation " +
    "shown with the terms on the publish panel, and this request did not carry it. " +
    "Open the panel, read what becomes visible, and tick the confirmation.",
);

/**
 * An acknowledgement was sent but is not the sentence this platform ships — a
 * stale client, or an altered one. It says the wording changed rather than
 * accusing the caller, because a genuinely stale tab is the likelier cause.
 */
export const PUBLISH_ACK_STALE_MESSAGE = fitToGate(
  () =>
    "Nothing was published. The confirmation sent does not match the terms this " +
    "platform currently shows, so it was not accepted. Reload the publish panel, " +
    "read the terms again, and tick the confirmation there.",
);
