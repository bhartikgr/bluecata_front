/**
 * WAVE 210 — LEGAL CORPUS VERSION IDENTITY
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE. Before this wave the platform served
 * one set of legal documents and recorded consent against a different set:
 *
 *   - `client/src/lib/legalDocs.ts` — five complete documents dated 17 March
 *     2026, naming a legal entity, reachable ONLY through a drawer and one
 *     founder settings tab, and hard-coded as the version every consent row
 *     attests to (`LEGAL_VERSION`).
 *   - `client/src/pages/Terms.tsx` / `Privacy.tsx` — two documents dated 15
 *     June 2026, naming NO entity, carrying NO version, describing themselves
 *     in their own source as "an interim stub", and served by
 *     `/terms-of-service` and `/privacy-policy` — which is what every footer
 *     link in every silo reaches.
 *
 * So a user read one document and their consent record attested to another.
 * The consent record's entire purpose is proving what someone agreed to.
 *
 * WHY THE VERSION STRINGS LIVE HERE AND NOT IN EITHER CORPUS. The server's
 * consent store needs the version identity and must not import client
 * rendering code; the client pages need it and must not import the database.
 * `shared/` is the only layer both may import. Nothing in this file renders,
 * queries or authors a sentence of legal copy — it is identity only.
 *
 * NOTHING IS DELETED. `SUPERSEDED_LEGAL_CORPUS_VERSIONS` is the register of
 * versions that were once served or once recorded against. They remain valid
 * values for a consent row forever, because rows carrying them exist and are a
 * record. A version leaving the served path does not leave the register.
 */

/**
 * The version the platform SERVES and records against after wave 210.
 *
 * It is a new string rather than a reuse of "2026-03-17" because the adopted
 * text is not byte-identical to the 17 March corpus: the party name spelling is
 * corrected and two clauses are appended (regulatory status; network-wide
 * benchmarking). A consent row must be able to distinguish the two, which is
 * the whole point of the wave.
 */
export const ADOPTED_LEGAL_CORPUS_VERSION = "2026-08-30";

/** The human date printed on the adopted documents. Must agree with the above. */
export const ADOPTED_LEGAL_CORPUS_DATE_LABEL = "30 August 2026";

/**
 * The 17 March 2026 corpus (`legalDocs.ts`). Superseded as the SERVED text by
 * the adopted version; still the version named by every consent row written
 * before this wave, and still present in source byte-for-byte.
 */
export const SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17 = "2026-03-17";

/**
 * The 15 June 2026 interim pages (`Terms.tsx` / `Privacy.tsx`). These never had
 * a version string of their own — that was the defect. This wave assigns them
 * one retrospectively so the text they served can be NAMED, which is the
 * precondition for retiring it without deleting it. No consent row carries this
 * value, because the pages that served it never recorded anything.
 */
export const SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15 = "2026-06-15";

/**
 * Every version a consent row may legitimately carry, served or superseded.
 * Order is oldest first. APPEND ONLY — removing an entry would invalidate rows.
 */
export const SUPERSEDED_LEGAL_CORPUS_VERSIONS: readonly string[] = [
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15,
];

/** Adopted + superseded. The set a consent row's `document_version` may hold. */
export const KNOWN_LEGAL_CORPUS_VERSIONS: readonly string[] = [
  ...SUPERSEDED_LEGAL_CORPUS_VERSIONS,
  ADOPTED_LEGAL_CORPUS_VERSION,
];

/**
 * The `platform_config` key holding the version currently served.
 *
 * WHY `platform_config` AND NOT A NEW TABLE. It is already hash-chained, its
 * history is undeletable by trigger, and every write is atomically audited.
 * Wave 195 used it for the commit-currency declaration and needed no migration.
 * A second store for one string would be a second thing to keep in step with
 * the consent ledger — which is exactly the class of defect this wave repairs.
 */
export const LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY = "legal.corpus.active_version";

export function isKnownLegalCorpusVersion(value: unknown): boolean {
  return typeof value === "string" && KNOWN_LEGAL_CORPUS_VERSIONS.includes(value);
}

/**
 * THE REGISTERED PARTY NAME (owner ruling A8, verbatim: "The registered name
 * is: 'BluePrint Catalyst Limited'").
 *
 * In an executed legal instrument a misspelled party name is a real defect, not
 * a typo. Both spellings are named here as data so that the correction is a
 * deterministic transform over the existing text rather than 51 hand edits
 * inside a 1,814-line legal document — see `client/src/lib/legalDocsV2.ts`.
 *
 * `MISSPELLED_PARTY_NAME` is NOT copy and is never rendered. It is the search
 * key of the transform and the subject of the test that asserts zero remain.
 */
export const MISSPELLED_PARTY_NAME = "Blueprint Catalyst Limited";
export const REGISTERED_PARTY_NAME = "BluePrint Catalyst Limited";
