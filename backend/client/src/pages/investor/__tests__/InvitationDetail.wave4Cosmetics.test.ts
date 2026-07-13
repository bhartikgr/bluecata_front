/**
 * Wave 4 (v26.1.x) — InvitationDetail cosmetic/content source invariants
 * (COS-1..COS-6). These pin the exact Ozan-locked treatment in the real
 * InvitationDetail.tsx so a future edit cannot silently regress the fixes.
 *
 *  - COS-1: empty deal fields ALWAYS render a "Not provided" line (sections not
 *           hidden); no fabricated "No description available" / "Not specified".
 *  - COS-2: the Your-Decision legal name is seeded from the investor PROFILE
 *           (contact.firstName + lastName, rule #13), NOT "New contact"; a
 *           missing last name PROMPTS inline (does NOT hard-block submit).
 *  - COS-4: PPS renders via ppsDisplay ("Not set" for 0/unset) in Overview + Terms.
 *  - COS-5: the cap-table illustrative position binds to the ENTERED amount and
 *           labels the card "Example" when none is entered — no hard-coded 250000
 *           presented as the investor's real position.
 *  - COS-6: the duplicate in-page text-link glossary (<GlossaryLink />) is
 *           removed from this page header; the submit-guard is unchanged.
 *
 * Plain `.test.ts` (no JSX / React render) → excluded from the tsc budget.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "InvitationDetail.tsx"),
  "utf8",
);

// Comment-free view of the file. The "no longer renders X" invariants below must
// only check FUNCTIONAL / rendered code — the fix comments intentionally quote the
// removed strings (e.g. "...instead of 'Not specified'") to document the change, and
// those quotes must not trip the absence assertions. Strip block + line comments.
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("COS-1 — always-show 'Not provided' lines for empty deal fields", () => {
  it("defines a NotProvided treatment and imports NOT_PROVIDED", () => {
    expect(SRC).toMatch(/function NotProvided\(/);
    expect(SRC).toContain('data-testid="text-not-provided"');
    expect(SRC).toMatch(/NOT_PROVIDED[\s\S]*?from "@\/lib\/wave4Display"/);
  });

  it("no longer fabricates 'No description available' or 'Not specified'", () => {
    expect(CODE).not.toContain("No description available");
    expect(CODE).not.toContain("Not specified");
  });

  it("no longer shows the 'Founder has not published' placeholder prose", () => {
    expect(CODE).not.toContain("Founder has not published");
  });

  it("empty term fields fall back to NOT_PROVIDED via nonEmpty", () => {
    expect(SRC).toMatch(/nonEmpty\(i\.round\.terms\?\.liquidationPref, NOT_PROVIDED\)/);
    expect(SRC).toMatch(/nonEmpty\(i\.round\.terms\?\.boardComposition, NOT_PROVIDED\)/);
  });
});

describe("COS-2 — legal name seeded from investor profile + last-name prompt", () => {
  it("fetches the investor profile for the current user", () => {
    expect(SRC).toMatch(/queryKey: \["\/api\/investors", investorId, "profile"\]/);
  });

  it("derives the full legal name from contact.firstName + contact.lastName", () => {
    expect(SRC).toMatch(/profile\.data\?\.contact\?\.firstName/);
    expect(SRC).toMatch(/profile\.data\?\.contact\?\.lastName/);
    expect(SRC).toMatch(/const profileLegalName =/);
  });

  it("seeds the signer name from the profile legal name (never 'New contact')", () => {
    expect(SRC).toMatch(/const legal = profileLegalName \|\| fullLegalName\(/);
    expect(CODE).not.toContain("New contact");
  });

  it("prompts inline for a missing last name and does NOT hard-block submit", () => {
    // Prompt condition + visible inline prompt.
    expect(SRC).toMatch(/const profileMissingLastName = !!profileFirstName && !profileLastName/);
    expect(SRC).toContain('data-testid="text-lastname-prompt"');
    // Submit guard remains the ORIGINAL name/ack gates only — no last-name block.
    expect(SRC).toMatch(/if \(!signerName\.trim\(\)\) \{ toast\(\{ title: "Type your full legal name"/);
    expect(SRC).not.toMatch(/if \(profileMissingLastName\)[\s\S]{0,80}return/);
  });
});

describe("COS-4 — PPS renders 'Not set' via ppsDisplay in both surfaces", () => {
  it("uses ppsDisplay for the Overview post-money line", () => {
    expect(SRC).toMatch(/ppsDisplay\(i\.pricePerShare, 2\)/);
  });
  it("uses ppsDisplay for the Investment Terms row", () => {
    expect(SRC).toMatch(/ppsDisplay\(i\.pricePerShare, 4\)/);
  });
  it("no longer renders the old 'PPS not set' / 'priced at close' strings", () => {
    expect(CODE).not.toContain("PPS not set");
    expect(CODE).not.toContain("priced at close");
  });
});

describe("COS-5 — illustrative position binds to entered amount, labels Example", () => {
  it("tracks whether the amount was actually edited", () => {
    expect(SRC).toMatch(/const \[amountTouched, setAmountTouched\] = useState\(false\)/);
    expect(SRC).toMatch(/setAmountTouched\(true\)/);
  });
  it("computes the position from the entered amount (else Example basis)", () => {
    expect(SRC).toMatch(/computeIllustrativePosition\(\s*amountTouched \? amount : "",/);
  });
  it("shows an 'Example' badge when no amount is entered", () => {
    expect(SRC).toContain('data-testid="badge-illustrative-example"');
    expect(SRC).toContain('data-testid="card-illustrative-position"');
  });
  it("no longer hard-codes the raw 250000 divisor in the illustration JSX", () => {
    // The old inline `(Number(amount) || i.minTicket)` illustration math is gone.
    expect(SRC).not.toMatch(/Math\.round\(\(Number\(amount\) \|\| i\.minTicket\)/);
  });
});

describe("COS-6 — duplicate text-link glossary removed, submit guard intact", () => {
  it("no longer renders the in-page <GlossaryLink /> or imports it", () => {
    expect(CODE).not.toMatch(/^\s*<GlossaryLink\s*\/>/m);
    expect(CODE).not.toMatch(/import \{ GlossaryLink \} from "@\/components\/Glossary"/);
  });
  it("keeps the back-navigation control (nothing else dropped)", () => {
    expect(SRC).toContain('data-testid="button-back"');
  });
  it("preserves the soft-circle submit guard behaviour", () => {
    expect(SRC).toMatch(/if \(!ack\) \{ toast\(\{ title: "Acknowledge before submitting"/);
    expect(SRC).toContain('data-testid="button-submit-softcircle"');
  });
});
