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
