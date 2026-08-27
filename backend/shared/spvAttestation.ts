/**
 * WAVE 138 — ONE definition of the SPV launch attestation.
 *
 * The canonical, versioned attestation text shown to and agreed by the signer.
 * VERSIONED so the exact wording that was assented to is provable. If the copy
 * ever changes, bump ATTESTATION_VERSION and add the new text — never mutate a
 * shipped version in place.
 *
 * WHY THIS FILE EXISTS. Until wave 138 this string existed TWICE: once in
 * `server/spvLaunchSignoffStore.ts` (the text the platform RECORDS as
 * `attestationText`) and once as a client-local copy in
 * `client/src/pages/partner/PartnerSpvEngine.tsx` (the text the partner READS
 * and ticks). Two copies of a legal attestation is an investor-grade defect: the
 * day they diverge, the partner signs one sentence and the platform records a
 * different one. Wave 138 needed a THIRD render (the SPV list create form), so
 * the copy was hoisted here instead of duplicated again. The wording is
 * UNCHANGED and byte-identical to the shipped v1 text — no new legal copy was
 * authored by this wave.
 *
 * `shared/` is importable from both sides (`@shared/*` in tsconfig.json:20,
 * vite.config.ts:31, vitest.config.ts:25) and carries no runtime dependencies,
 * exactly like `shared/consortiumAgreement.ts`.
 */
export const ATTESTATION_VERSION = "v1";
export const ATTESTATION_TEXT_V1 =
  "I certify that I am authorized to launch this special-purpose vehicle on " +
  "behalf of this Consortium Partner. I confirm that the information entered " +
  "— including jurisdiction, legal structure, mandate, fees, carry, and terms " +
  "— is accurate and complete to the best of my knowledge. I understand this " +
  "action creates a recorded, timestamped commitment on the Capavate " +
  "platform, and I consent to the use of my electronic signature as the legal " +
  "equivalent of a handwritten signature under applicable e-signature law " +
  "(ESIGN/UETA).";

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 169 · R77 / R111 Q11 — THE SIGNED SENTENCE NAMED A PRODUCT THE PARTNER
 * WAS NOT CREATING.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, VERIFIED ON THE SHIPPED TREE. The wizard's type dropdown
 * (`SPV_TYPES` in `shared/spvEngine.ts`) offers FIVE vehicles — SPV: Single Deal,
 * Fund, Syndicate, SPV: Multi-Asset / Deal-by-Deal, Rolling Fund — and every one
 * of them presented `ATTESTATION_TEXT_V1`, which says *"…authorized to launch this
 * special-purpose vehicle…"*. A managing partner creating a FUND therefore
 * electronically signed, under ESIGN/UETA, a sentence naming a special-purpose
 * vehicle. `PartnerFunds.tsx` — a page that can only ever create a fund — rendered
 * the same words. This is not a wording nicety: the recorded attestation IS the
 * evidence of authorization, and evidence that misdescribes its own subject is
 * weaker than evidence that does not.
 *
 * WHY V1 IS NOT TOUCHED. Every row already in `spv_launch_signoffs` stores the
 * exact bytes that were shown at signing in its own `attestation_text` column
 * (`server/spvLaunchSignoffStore.ts` writes it on INSERT and `mapRow` reads it
 * back), so an existing sign-off resolves from the ROW, not from this module.
 * `ATTESTATION_TEXT_V1` above is therefore left BYTE-IDENTICAL: nothing signed can
 * change meaning, and the v1 bytes stay resolvable for any record that carries
 * `attestation_version = "v1"`. A new version is ADDED (R44: add, never
 * substitute), exactly as the docblock above has always instructed.
 *
 * WHY THE V2 TEXT IS DERIVED FROM V1 RATHER THAN RETYPED. Retyping the sentence
 * five times would be five copies of legal copy to drift — the defect wave 138
 * existed to end. So v2 is v1 with ONE noun substituted: the vehicle noun. Nothing
 * else about the attestation changes, which is also why no new legal meaning is
 * authored here (R111 Q11: "author no new legal copy"). The substitution is
 * positional and provable — `attestationTextForType("spv")` returns
 * `ATTESTATION_TEXT_V1` byte-for-byte, pinned by test.
 * ════════════════════════════════════════════════════════════════════════════ */

/** The added version. v1 is unchanged and still shipped for `spv`. */
export const ATTESTATION_VERSION_V2 = "v2";

/**
 * The noun each vehicle type calls itself in the attestation, keyed by the
 * PERSISTED `spvType` value (`SPV_TYPES`, shared/spvEngine.ts).
 *
 * `spv` keeps v1's noun exactly, so the single-deal SPV — every existing record —
 * resolves to the v1 bytes and stays on `ATTESTATION_VERSION`. `multi_asset` is
 * still a special-purpose vehicle (its own dropdown label says "SPV: Multi-Asset /
 * Deal-by-Deal"), so it is QUALIFIED rather than renamed: calling it a plain SPV
 * understates that one vehicle holds several assets, and calling it a fund would
 * be the same class of error this wave is fixing.
 */
export const ATTESTATION_VEHICLE_NOUNS: Readonly<Record<string, string>> = {
  spv: "special-purpose vehicle",
  multi_asset: "multi-asset special-purpose vehicle",
  syndicate: "syndicate",
  fund: "fund",
  rolling_fund: "rolling fund",
};

/**
 * The noun used when the type cannot be resolved at all. DELIBERATELY GENERIC: an
 * unreadable type must not be silently attested to as a "special-purpose vehicle"
 * (that is the wave-169 defect with a different cause), and it must not be
 * attested to as a fund either. "vehicle" is true of all five types, so it names
 * nothing the signer is not creating.
 */
export const ATTESTATION_UNKNOWN_TYPE_NOUN = "vehicle";

/** The type whose wording v1 already carried. */
export const ATTESTATION_V1_TYPE = "spv";

/**
 * The attestation a signer of `spvType` reads and signs.
 *
 * Returns `ATTESTATION_TEXT_V1` BYTE-IDENTICAL for `spv` (and for a missing type,
 * which is the legacy single-deal create path). For every other type it is the
 * same sentence with the vehicle noun substituted in place.
 */
export function attestationTextForType(spvType?: string | null): string {
  const key = typeof spvType === "string" && spvType.trim().length > 0 ? spvType.trim() : ATTESTATION_V1_TYPE;
  const v1Noun = ATTESTATION_VEHICLE_NOUNS[ATTESTATION_V1_TYPE];
  const noun = ATTESTATION_VEHICLE_NOUNS[key] ?? ATTESTATION_UNKNOWN_TYPE_NOUN;
  if (noun === v1Noun) return ATTESTATION_TEXT_V1;
  const at = ATTESTATION_TEXT_V1.indexOf(v1Noun);
  /* FAIL LOUD, never silently: if v1's noun cannot be located the substitution is
     not provable, and shipping an unprovable legal sentence is worse than
     refusing. A test pins that this throw is unreachable on the shipped bytes. */
  if (at < 0) throw new Error("ATTESTATION_V1_VEHICLE_NOUN_NOT_FOUND");
  return ATTESTATION_TEXT_V1.slice(0, at) + noun + ATTESTATION_TEXT_V1.slice(at + v1Noun.length);
}

/**
 * The version to RECORD beside the text for `spvType`. `v1` when the resolved
 * text is byte-identical to the shipped v1 sentence (so the single-deal SPV path
 * records exactly what it always recorded), `v2` otherwise.
 */
export function attestationVersionForType(spvType?: string | null): string {
  return attestationTextForType(spvType) === ATTESTATION_TEXT_V1 ? ATTESTATION_VERSION : ATTESTATION_VERSION_V2;
}

/** Text + version together, so a writer cannot record one without the other. */
export function resolveAttestation(spvType?: string | null): { text: string; version: string } {
  const text = attestationTextForType(spvType);
  return { text, version: text === ATTESTATION_TEXT_V1 ? ATTESTATION_VERSION : ATTESTATION_VERSION_V2 };
}
