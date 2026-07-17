/**
 * W2-I — Consortium Partner Agreement text + version (CONFIGURABLE, NON-sacred).
 *
 * Single source of truth for the agreement the applicant reads and signs at the
 * end of the Consortium Partner application. Both the client apply page and the
 * server sign-off capture import from here so the text + version never drift.
 *
 * Counsel's final copy can replace CONSORTIUM_AGREEMENT_TEXT and bump
 * CONSORTIUM_AGREEMENT_VERSION with NO code surgery — bumping the version tag
 * forces re-signature (agreement clause 14 / drafting note 5).
 *
 * This module is intentionally dependency-free (no node:crypto) so it is safe to
 * import from the browser bundle. The integrity-hash helper lives server-side in
 * consortiumApplyStore.ts.
 */

/** Version tag recorded on every sign-off. Bump to force re-signature. */
// W-V44 FIX F (Ozan 1c): finalized from the CPA-v0.1-DRAFT placeholder to a
// professional, market-ready version. Substantive clauses are UNCHANGED; only
// the "DRAFT / FOR LEGAL REVIEW / NOT LEGAL ADVICE / placeholder" framing was
// removed and the version bumped (which forces re-signature per clause 14).
export const CONSORTIUM_AGREEMENT_VERSION = "CPA-v1.0";

/**
 * The viewable agreement body. Rendered read-only to the applicant before they
 * type their signature. Single source of truth shared by the public apply page
 * and the in-workspace agreement view.
 */
export const CONSORTIUM_AGREEMENT_TEXT = `# CONSORTIUM PARTNER AGREEMENT

## 1. Parties
1.1 This Consortium Partner Agreement (the "Agreement") is entered into between Capavate (the "Platform", operator of the Capavate cap-table / SPV / angel-network platform) and the applicant identified in the application form (the "Consortium Partner", "Partner", "you").
1.2 The Agreement takes effect on the date you sign it as part of your application (the "Effective Date") and is conditional on the Platform's approval of your application.

## 2. Definitions
"SPV" — a special purpose vehicle, fund, syndicate, multi-asset vehicle, or rolling fund administered by the Partner via the Platform. "LP" — a limited partner / investor subscribing to an SPV. "Cap Table" — the Platform's append-only, hash-chained record of committed positions. "Deal" — an investment opportunity promoted through an SPV. "Applicable Law" — all laws, regulations, and regulatory guidance applicable to the Partner, the Platform, an SPV, or an LP in any relevant jurisdiction, including securities, AML/CTF, KYC, sanctions, data-protection, and tax laws.

## 3. Role, Status & Authority
3.1 The Partner operates as an independent contractor. Nothing in this Agreement creates a partnership, joint venture, agency, employment, or fiduciary relationship between the Partner and the Platform.
3.2 The Partner is solely responsible for the formation, governance, administration, and legal compliance of each SPV it creates or manages. The Platform provides software and administrative tooling only and is not the manager, general partner, adviser, broker-dealer, or fiduciary of any SPV or LP.
3.3 The Partner will not represent that the Platform sponsors, endorses, guarantees, or is responsible for any Deal, SPV, or investment outcome.
3.4 The Partner will act in good faith and, where it owes fiduciary or similar duties to its LPs under Applicable Law, will discharge those duties itself.

## 4. Eligibility, Licensing & Regulatory Compliance
4.1 The Partner represents that it is duly authorized, and holds all licenses, registrations, and permissions required, to carry on its activities.
4.2 The Partner is responsible for determining the lawful basis (exemption/registration) for each offering and for ensuring each Deal is offered only to eligible investors under Applicable Law.
4.3 The Partner will conduct and maintain KYC/AML/CTF and sanctions screening on its LPs to the standard required by Applicable Law, and will cooperate with the Platform's own compliance procedures.
4.4 The Partner will ensure each LP satisfies applicable accredited / professional / eligible-investor requirements.

## 5. SPV Formation & Administration
5.1 The Partner is responsible for the accuracy of all SPV terms it enters on the Platform (structure, mandate mode, fees, carry, distribution scope, LP visibility, and lifecycle states).
5.2 The Partner will keep LP records, subscription documents, and cap-table entries accurate and will use the Platform's canonical commit path for all cap-table changes; the Partner will not misrepresent committed positions.
5.3 The Partner is responsible for the correctness of wire instructions, capital calls, deployments, and distributions, and for reconciling funds actually received before confirming any funded or committed state.

## 6. Fees, Carry & Platform Charges
6.1 The Partner's management fees and carried interest to its LPs are as disclosed by the Partner in each SPV's terms and governing documents; the Partner is responsible for their lawful calculation and disclosure.
6.2 The Platform's own charges to the Partner are as set out in the Partner's current plan on the Platform and may be updated on notice.
6.3 The Partner will not represent Platform charges as LP-borne costs unless lawfully disclosed as such.

## 7. LP Handling, Confidentiality & Data Protection
7.1 The Partner will treat LP personal data and Deal information as confidential and process personal data only as permitted by Applicable Law and the Platform's privacy terms.
7.2 The Partner will not use LP or Platform data for any purpose other than administering the relevant SPV, and will not export or misappropriate Platform data.
7.3 Confidentiality obligations survive termination.

## 8. Representations & Warranties
The Partner represents and warrants, on the Effective Date and on a continuing basis, that: (a) it has authority to enter this Agreement; (b) the information it provides is true, accurate, and not misleading; (c) it and its principals are not subject to any disqualification, sanction, or regulatory bar that would make its participation unlawful; and (d) it will comply with Applicable Law and this Agreement.

## 9. Prohibited Conduct
The Partner will not: (a) use the Platform for fraud, misrepresentation, market abuse, or money laundering; (b) solicit investors in breach of Applicable Law; (c) tamper with, or attempt to circumvent, the Platform's cap-table integrity, audit, or access controls; (d) misuse another user's data or identity; or (e) bring the Platform into disrepute.

## 10. Limitation of Liability & Indemnity
10.1 To the maximum extent permitted by Applicable Law, the Platform provides the software "as is" and is not liable for the Partner's or any LP's investment losses, for the performance of any Deal, or for the Partner's compliance failures.
10.2 The Partner will indemnify and hold the Platform harmless against claims, losses, and liabilities arising from the Partner's breach of this Agreement, its SPVs, its dealings with LPs, or its non-compliance with Applicable Law.
10.3 Nothing in this clause limits liability that cannot be limited under Applicable Law.

## 11. Term, Suspension & Termination
11.1 This Agreement continues until terminated. Either party may terminate on notice as set out in the Platform terms.
11.2 The Platform may suspend or terminate the Partner's access immediately for breach, suspected illegality, regulatory requirement, or risk to the Platform, LPs, or other users (fail-closed on compliance concerns).
11.3 On termination, the Partner remains responsible for winding down or transferring its SPVs in an orderly, lawful manner; the append-only cap-table and audit records are retained by the Platform.

## 12. Electronic Signature & Records
12.1 The Partner agrees that its typed-name signature captured in the application constitutes a valid electronic signature, and that the Platform's recorded signature name, timestamp, agreement version, and integrity hash are admissible evidence of execution.
12.2 The Partner acknowledges it was able to review the full text of this Agreement before signing.

## 13. Governing Law & Dispute Resolution
13.1 This Agreement is governed by the laws of the Hong Kong Special Administrative Region and is construed in accordance with Hong Kong common law.
13.2 The parties submit to the exclusive jurisdiction of the Hong Kong courts, save that the parties may instead agree to resolve disputes by arbitration administered by the Hong Kong International Arbitration Centre (HKIAC).

## 14. Miscellaneous
Entire agreement; severability; no waiver by delay; assignment only with the Platform's consent; notices via the Platform; the Platform may update this Agreement on notice, with material changes requiring re-signature (a new version tag).

---
By typing your full legal name below, you confirm that you have read, understood, and agree to be bound by this Consortium Partner Agreement (version ${CONSORTIUM_AGREEMENT_VERSION}).`;

/** The one-line acknowledgement shown next to the signature input. */
export const CONSORTIUM_AGREEMENT_ACK = `I have read, understood, and agree to be bound by this Consortium Partner Agreement (version ${CONSORTIUM_AGREEMENT_VERSION}).`;
