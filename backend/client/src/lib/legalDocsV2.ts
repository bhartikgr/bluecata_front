/**
 * WAVE 210 — THE ADOPTED LEGAL CORPUS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * READ THIS BEFORE CHANGING ANYTHING IN THIS FILE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file does NOT contain a copy of the legal documents. It DERIVES them
 * from `legalDocs.ts` by a deterministic pure transform, and that is a
 * deliberate legal decision, not a shortcut.
 *
 * WHY NOT TRANSCRIBE THE TEXT. The 17 March 2026 corpus is 1,814 lines of legal
 * copy which users have already consented to. Hand-copying it to correct a party
 * name would mean re-typing five complete legal instruments, and a transcription
 * error inside a Privacy Policy or a limitation-of-liability clause is a legal
 * defect in its own right — one that no reviewer could reliably catch by eye.
 * Deriving instead makes a much stronger claim provable: **every sentence except
 * the ones this file deliberately changes is byte-identical to the text users
 * already agreed to**, and a test asserts exactly that. A transcription cannot
 * be proven; a transform can.
 *
 * It also means `client/src/lib/legalDocs.ts` IS NEVER EDITED. Its 51
 * occurrences of the old party name stay byte-verbatim, its five bodies stay
 * byte-verbatim, and its sha256 is unchanged by this wave. Under R143.1 a
 * replaced text node counts as REMOVED copy; nothing here replaces one. The
 * superseded text remains retrievable in full, which is the point: we must
 * remain able to prove what people previously agreed to.
 *
 * WHAT THIS FILE CHANGES, AND NOTHING ELSE:
 *   1. `Blueprint Catalyst Limited` → `BluePrint Catalyst Limited` everywhere.
 *      The registered name, per owner ruling A8. Every occurrence in the source
 *      corpus is the identical byte sequence — verified, no casing or spacing
 *      variants — so one substitution is exhaustive and byte-precise.
 *   2. The date `17 March 2026` → `30 August 2026`, and `lastUpdated`.
 *   3. Two clauses APPENDED to the end of the Terms body and the Privacy body.
 *      Nothing existing is edited to make room for them.
 *
 * WHAT THIS FILE MUST NEVER DO:
 *   - Publish any of the five `[DO NOT PUBLISH UNTIL …]` sentences from
 *     `build_log/legal/drafts/01_MASTER_DISCLAIMER.md`: the vehicle-fee
 *     sentence, the EEA-EXCLUSION sentence, the search-indexing claim, the
 *     bring-your-own-documents claim, the written-data-agreements claim. A
 *     wave-210 test greps this corpus for each of them.
 *   - Assert that these documents have been reviewed by counsel. They have not
 *     been (R190.11: the owner has knowingly accepted the risk of going live
 *     before Hong Kong counsel review). His acceptance of risk does not convert
 *     a draft into reviewed advice, so no sentence here implies review.
 */
import { LEGAL_DOCS, type LegalDoc } from "@/lib/legalDocs";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  ADOPTED_LEGAL_CORPUS_DATE_LABEL,
  MISSPELLED_PARTY_NAME,
  REGISTERED_PARTY_NAME,
} from "@shared/wave210LegalCorpusVersion";

/** The date label carried by the superseded 17 March corpus, as it appears in text. */
const SUPERSEDED_DATE_LABEL = "17 March 2026";

/**
 * CLAUSE T-A4 — REGULATORY STATUS AND AUTHORISATIONS. Appended to the Terms.
 *
 * Required because the adopted Terms are made available to persons in the EU
 * while the operator holds no EU authorisation, and a document that is silent on
 * that invites the reader to assume otherwise. The wording is taken from
 * `build_log/legal/drafts/01_MASTER_DISCLAIMER.md` (the "Capavate is software"
 * clause and the non-authorisation list), which is drafting already reasoned
 * through rather than sentences invented here.
 *
 * WHAT IS DELIBERATELY ABSENT. The EEA-EXCLUSION sentence — "the EEA is
 * excluded from service" — is one of the five `[DO NOT PUBLISH UNTIL …]`
 * sentences: draft 01 blocks it until residence attestation and geo-exclusion
 * controls actually exist, and they do not. Stating "we hold no EU
 * authorisation" is a true statement of status. Stating "the EEA is excluded" is
 * a representation about a control the platform does not enforce, and the
 * moment it is printed it is a representation the operator has broken. The
 * first is published here; the second is not.
 */
const CLAUSE_REGULATORY_STATUS = `
Regulatory status and authorisations

          Capavate is a software and administration platform operated by ${REGISTERED_PARTY_NAME}, a company incorporated in Hong Kong. Capavate is not a broker, dealer, investment adviser, fund manager, custodian or crowdfunding service provider. It is not licensed by or registered with the Securities and Futures Commission of Hong Kong, and it does not carry on any regulated activity.

          Capavate is not registered with the U.S. Securities and Exchange Commission or FINRA, is not authorised by the Financial Conduct Authority, and is not authorised by the DFSA, the FSRA, the Monetary Authority of Singapore, FINMA, ASIC or any Canadian securities regulator. ${REGISTERED_PARTY_NAME} holds no authorisation, licence or registration from any competent authority of any European Union or European Economic Area member state, and is not authorised as a crowdfunding service provider in the European Union. Where these Terms, or any part of the platform, are made available to a person located in the European Union or the European Economic Area, they are made available on that basis and on no other.

          Capavate gives no advice and makes no recommendation of any kind. Capavate does not hold, receive or control investor money. Nothing on this platform is an offer, invitation or inducement to buy, sell or subscribe for anything.
`;

/**
 * CLAUSE P-E2 — NETWORK-WIDE BENCHMARKING AND MATCHMAKING. Appended to Privacy.
 *
 * Required because the platform already offers founders a switch that shares a
 * company profile "across the Collective for benchmarking and matchmaking", and
 * a privacy notice that does not describe it is inaccurate about the single
 * processing activity in which the operator determines its own purpose. Draft 01
 * and draft 05 both flag this as the most important note in the review: a
 * disclaimer that misdescribes the platform is worse than no disclaimer.
 *
 * EVERY SENTENCE HERE DESCRIBES A CONTROL THAT EXISTS. The opt-out named is the
 * founder-side switch already built at `client/src/components/MaPrivacyConsent.tsx`,
 * mounted at `client/src/pages/founder/Company.tsx:1399`. This clause claims no
 * control that is not built. Wave 221 owns extending the opt-out to other
 * personas; until it lands, this clause describes only what a founder can
 * actually do today, which is why it says "a founder may" and not "you may".
 */
const CLAUSE_NETWORK_BENCHMARKING = `
Network-wide benchmarking and matchmaking

          We do not use the information you submit for our own separate purposes — including cross-customer analytics, marketing, or the training of any model — except as described in this clause. One feature is an exception and is named here rather than left to inference.

          A founder may choose to share their company profile across the Collective so that it can be used for benchmarking and for matchmaking with investors and Consortium Partners. That choice is off unless it is switched on, and it is the only route by which information you submit is used across the wider network. Where it is switched on, ${REGISTERED_PARTY_NAME} determines the purpose of that processing and therefore acts as a controller for it, alongside any Consortium Partner with whom that purpose is co-determined.

          A founder may switch the choice off at any time from the privacy controls on their company profile. Switching it off stops any further benchmarking or matchmaking use of the profile. It does not retrieve information from a chapter, investor or partner who already received it while the choice was on, and we describe that limit here rather than imply a recall we cannot perform.
`;

/**
 * CLAUSE C-A1 — WHAT IS ACTUALLY SET ON YOUR DEVICE. Appended to the Cookie Policy.
 *
 * WAVE 218. READ THIS BEFORE ASSUMING THE COOKIE POLICY WAS CORRECTED IN PLACE.
 * IT WAS NOT, AND IT COULD NOT BE.
 *
 * WHY THIS CLAUSE EXISTS. Wave 218 enumerated, from the code, every cookie,
 * local-storage key, session-storage key and third-party script the platform
 * actually sets. The published Cookie Policy describes machinery that does not
 * exist: a cookie consent banner, a cookie settings link in the footer, a
 * cookie-consent preference cookie with a twelve-month life, Google Analytics,
 * advertising partners, and an opt-out control in Settings. None of the six is
 * built. Under R190.10 the remedy for a document that misdescribes the platform
 * is to change the DOCUMENT — the owner's words for that defect class are "the
 * worst class of error, an affirmative misstatement" — and under R206.2 a control
 * that is described but does nothing is the most consequential dead promise on
 * the platform. So each false statement is named and withdrawn in the served text.
 *
 * WHY IT IS APPENDED RATHER THAN SUBSTITUTED. Two locks, both belonging to other
 * completed waves and both correct:
 *   1. `server/__tests__/w210_legal_corpus_consolidation.test.ts` pins the sha256
 *      of `client/src/lib/legalDocs.ts`. One edited byte turns that suite RED.
 *   2. The same suite asserts that the superseded body, with only the party-name
 *      and date substitutions applied, is a PREFIX of the adopted body. That is
 *      wave 210's proof that no legal text was lost, and it means the adopted
 *      corpus may only be APPENDED to. Deleting a false sentence breaks it.
 * The superseded corpus is the evidence of what users previously agreed to and it
 * must stay retrievable byte-for-byte. R195.5: nothing is deleted.
 *
 * WHAT THAT MEANS FOR THE READER, STATED PLAINLY BECAUSE IT MATTERS. The false
 * statements are STILL IN THE DOCUMENT, above this clause. This clause does not
 * remove them; it names each one and withdraws it, so a reader can see which
 * earlier sentence has been displaced and by what. Removing them outright needs an
 * owner-ratified re-baseline of wave 210's hash pin and prefix proof, and that is
 * an owner decision, not a builder's. It is escalated, not quietly done.
 *
 * WHY NO CONSENT BANNER WAS BUILT. On the enumerated inventory the only storage
 * that is not strictly necessary is `sidebar_state`, a first-party cookie
 * recording whether the user collapsed their own sidebar, written only when they
 * operate that control. There is no analytics cookie, no advertising cookie, no
 * third-party cookie and no tag manager, so there is nothing for a banner to offer
 * and nothing for a refusal to withhold. A banner with no consequence would be a
 * new dead promise, and it would stand in front of every first visit including the
 * login pages. The correct output was an accurate disclosure, which is this.
 *
 * WHAT THIS CLAUSE DELIBERATELY DOES NOT SAY. It does not claim that nothing else
 * is set anywhere. The superseded text lists a "load balancing cookie" and no code
 * in this tree sets one; it may be set by an upstream proxy this wave cannot see.
 * So the clause reports what the application sets and says the platform cannot
 * speak for an intermediary, rather than replacing one confident false statement
 * with another in the opposite direction.
 */
const CLAUSE_ACTUAL_COOKIE_INVENTORY = `
What is actually set on your device — corrected statement, ${ADOPTED_LEGAL_CORPUS_DATE_LABEL}

          This clause states what the Capavate application actually stores on your device and what it actually sends to a third party. Where it differs from anything earlier in this document, this clause is correct and the earlier statement is withdrawn. It is placed here, with the earlier wording left in place above it, so that you can see exactly what has changed and what people were previously told.

          Cookies the application sets. Five cookies exist to sign you in and keep the session safe: a session identifier, a session token, an access token, a cross-site request forgery token, and a legacy session identifier used only where the connection is not HTTPS. All five are set by ${REGISTERED_PARTY_NAME}, are first-party, and are strictly necessary — without them you cannot stay logged in and the platform cannot protect your requests. The session token lasts four hours, the longer session identifier fourteen days, and the access and request-forgery tokens thirty minutes. They are cleared when you log out.

          One further cookie is set: a record of whether you collapsed the navigation sidebar. It lasts seven days, it is first-party, it contains no identifier, it is never sent to anyone else, and it is written only as the direct result of you operating that control. It is a preference, not tracking.

          Browser storage. Three items are kept in your browser's local storage: which company you are currently viewing, which persona view you have selected, and a copy of your own company's subscription status so that pages load without re-fetching it. All three are first-party and functional. Nothing at all is written to session storage.

          Third parties. Two, and only two. A payment provider's script is loaded from Airwallex, and only at the moment you click to continue to payment — it does not load while you are simply reading. Web fonts are loaded from Google on every page; that sets no cookie, but it does tell Google the network address you are connecting from. If you would rather that did not happen, a browser extension that blocks third-party font loading will prevent it, and the platform will still work.

          There is no analytics on this platform. No analytics product is installed, no analytics cookie is set, and no measurement or session-recording script runs. Statements earlier in this document that name Google Analytics as a provider we may use, that describe analytics cookies requiring your consent, and that link to the Google Analytics opt-out add-on, are withdrawn: there is nothing to opt out of.

          There is no advertising or targeting on this platform. No advertising partner sets anything, no interest profile is built, and no marketing or targeting cookie is set either on the public marketing site or inside the application. The statement earlier in this document describing cookies set by our advertising partners is withdrawn.

          There is no cookie consent banner and no cookie settings link, and none is needed. Statements earlier in this document that you will be shown a consent banner on your first visit, that you can change your preferences from a cookie settings link in the footer, that you can opt out of non-essential cookies in Settings, and that a cookie consent preference cookie is set and persists for up to twelve months before your consent is requested again, are all withdrawn. No such banner, link, control or cookie exists. None is needed, because every cookie the application sets is either strictly necessary to sign you in and protect your session, or is the sidebar preference you set yourself. You can still delete or block any of them from your browser settings at any time; blocking the strictly necessary ones will stop you being able to log in.

          What we cannot speak for. This clause describes what the Capavate application itself sets. It does not speak for a network intermediary, content delivery network or load balancer operated between you and the platform, which may set a routing cookie of its own. The earlier reference in this document to a load balancing cookie is for that reason neither confirmed nor withdrawn here: we would rather tell you the limit of what we have verified than state it either way without checking.

          Marketing is separate and is not bundled into anything. Agreeing to this policy is not agreement to receive marketing, and no single tick box on this platform covers both. Where the platform asks about marketing, it will ask separately, and refusing will have no effect on your use of the platform.

          If any of this changes. Adding an analytics product, an advertising tag or any third-party cookie changes what this clause says, and this clause must be corrected in the same release that adds it — not afterwards.
`;

/**
 * The transform. Pure, total, and the only place the adopted text differs from
 * the superseded text.
 *
 * `split`/`join` rather than a regex: the party name and the date are literal
 * byte sequences, and a regex over 1,814 lines of legal prose containing
 * brackets, quotes and section symbols is a way to introduce a defect into a
 * legal instrument. There is nothing to escape if nothing is a pattern.
 */
function adoptText(source: string): string {
  return source
    .split(MISSPELLED_PARTY_NAME)
    .join(REGISTERED_PARTY_NAME)
    .split(SUPERSEDED_DATE_LABEL)
    .join(ADOPTED_LEGAL_CORPUS_DATE_LABEL);
}

/** Appended clauses, by document id. Documents absent from this map gain nothing. */
const APPENDED_CLAUSES: Readonly<Record<string, string>> = {
  terms: CLAUSE_REGULATORY_STATUS,
  privacy: CLAUSE_NETWORK_BENCHMARKING,
  /* WAVE 218 — see CLAUSE_ACTUAL_COOKIE_INVENTORY above. Appended, never
   * substituted: wave 210's prefix proof requires it and R195.5 requires it. */
  cookies: CLAUSE_ACTUAL_COOKIE_INVENTORY,
};

/**
 * WAVE 218 — APPENDED SUMMARY CORRECTIONS, by document id.
 *
 * The `summary` field is not the body. It is rendered in two places the body is
 * not: the consent drawer (`client/src/components/LegalDrawer.tsx:150`) and the
 * founder Settings page (`client/src/pages/founder/Settings.tsx:1758`). The
 * superseded cookie summary reads "...You can opt out of non-essential cookies in
 * Settings" — and it is printed ON the Settings page, directing the reader to a
 * control that is not on the page they are looking at. That is the most acute of
 * the false statements, because it is the one a user is most likely to act on.
 *
 * Corrected the same way as the body: by APPENDING, not by substituting. No test
 * pins the summary, so a substitution would have passed every gate — which is
 * exactly why it must not be done. R143.1 treats a replaced text node as removed
 * copy whether or not a gate happens to be watching that particular field.
 */
const APPENDED_SUMMARY_CORRECTIONS: Readonly<Record<string, string>> = {
  cookies:
    " Corrected " +
    ADOPTED_LEGAL_CORPUS_DATE_LABEL +
    ": the platform sets no analytics cookies, and there is no cookie opt-out control in Settings because none is needed \u2014 see \u201cWhat is actually set on your device\u201d in the policy.",
};

function adoptDoc(doc: LegalDoc): LegalDoc {
  const appended = APPENDED_CLAUSES[doc.id] ?? "";
  return {
    id: doc.id,
    title: adoptText(doc.title),
    lastUpdated: ADOPTED_LEGAL_CORPUS_DATE_LABEL,
    entity: adoptText(doc.entity),
    /* WAVE 218 — appended, never substituted. See APPENDED_SUMMARY_CORRECTIONS. */
    summary: adoptText(doc.summary) + (APPENDED_SUMMARY_CORRECTIONS[doc.id] ?? ""),
    body: adoptText(doc.body) + appended,
  };
}

/**
 * The adopted corpus — the text the platform SERVES and the text every new
 * consent record names. Five documents, same ids and same order as the
 * superseded corpus, because the consent ledger keys on `document_id`.
 */
export const ADOPTED_LEGAL_DOCS: LegalDoc[] = LEGAL_DOCS.map(adoptDoc);

/** The version identity of the corpus above. Re-exported for callers. */
export const LEGAL_VERSION_V2 = ADOPTED_LEGAL_CORPUS_VERSION;

/** The registered party name, as rendered by adopted surfaces. */
export const ADOPTED_ENTITY_SUBTITLE = `${REGISTERED_PARTY_NAME} · Incorporated in Hong Kong`;

/** Convenience lookup used by the adopted document routes. */
export function findAdoptedLegalDoc(id: string): LegalDoc | undefined {
  return ADOPTED_LEGAL_DOCS.find((d) => d.id === id);
}
