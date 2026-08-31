/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 220 · THE CLASS A CORRECTIONS, PROVED ON MOUNTED PAGES.
 * ══════════════════════════════════════════════════════════════════════════════
 * Handbook §8, failure mode 1 — NEVER PROVE A REPLICA. Every assertion in this
 * file runs against the REAL shipped module a user reaches, mounted, and the
 * production registrar binding is re-read off disk rather than assumed.
 *
 * WHAT IS PROVED
 *   A1-*  founder Collective: the "accreditation and contribution thresholds"
 *         eligibility claim does not render; the honest replacement does
 *   A2-*  investor application: "the licensed KYC provider" does not render
 *   A3-*  investor application: the "Identity verification & KYC" heading does
 *         not render, and BOTH upload controls still do (nothing restricted)
 *   A4-*  promote dialog: the committee / diligence-pass / 2-business-day
 *         paragraph does not render; the TRUE next paragraph still does
 *   A5-*  CompanyDetails: every governance row still renders, with the party
 *         who asserted it now named
 *   A6-*  SPV compliance panel: the header literal is UNCHANGED and the
 *         attribution sibling renders beneath it
 *   H-*   THE HONEST SENTENCES still exist BYTE-VERBATIM
 *   K-*   no affirmative "verified" about accreditation renders on any subject
 *   R-*   every retired literal still EXISTS in source (R195.5) and does NOT
 *         render (the point of the identifier flag)
 *   P-*   the production registrar still routes to each module under test
 *   N-*   NEGATIVE CONTROLS: each detector catches what it is built to catch
 *
 * THE NORMALISING-CALL RULE. Whitespace is collapsed WHEN A SNAPSHOT IS TAKEN,
 * never inside a comparison. `expect(a.trim()).toBe(b.trim())` is inert-proof
 * mechanism 2 — it passes for two different strings. Every equality assertion
 * below compares raw captured text against a raw literal.
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

const COMPANY_ID = "c_w220_co";

vi.mock("@/lib/useActiveCompany", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/useActiveCompany")>();
  return { ...actual, useActiveCompanyId: () => COMPANY_ID };
});

/* The step-1 gate reads `useInvestorSpine().eligibilitySignals.eligible`. That
   verdict is an INPUT to the copy under test, not the subject of it, so it is
   supplied. Everything rendered — the page, its wizard, its cards, its upload
   controls — is the real shipped module. */
vi.mock("@/lib/investor/investorSpine", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = (actual.useInvestorSpine as () => Record<string, unknown>) ?? (() => ({}));
  return {
    ...actual,
    /* Spread the REAL spine and override only the one verdict, so every other
       field the page reads is the real thing and a rename breaks this test
       rather than silently skipping it. */
    useInvestorSpine: () => {
      let base: Record<string, unknown> = {};
      try {
        base = real();
      } catch {
        base = {};
      }
      const signals = (base.eligibilitySignals as Record<string, unknown>) ?? {};
      return { ...base, eligibilitySignals: { ...signals, eligible: true } };
    },
  };
});

import FounderCollective from "@/pages/founder/Collective";
import InvestorApplyToCollective from "@/pages/investor/ApplyToCollective";
import { PromoteToCollectiveDialog } from "@/components/investor/PromoteToCollectiveDialog";

const ROOT = resolve(__dirname, "../../../..");
function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** Source with whitespace collapsed AT CAPTURE, for the honest sentences that
 *  are wrapped across source lines by the formatter. The collapse happens here,
 *  when the haystack is read — never inside a comparison. The needle is a raw
 *  literal in both cases. N-7 proves this reader would notice a real edit. */
function readSourceCollapsed(rel: string): string {
  return readSource(rel).replace(/\s+/g, " ");
}

/** Source with comments removed, for assertions ABOUT CODE SHAPE. Every file
 *  touched by this wave documents in prose why it does NOT use `{false && …}`,
 *  so a raw-source assertion would fail on the sentence explaining the rule.
 *  Comment bytes are replaced by spaces so offsets and line numbers stay real.
 *  String literals are deliberately NOT stripped. N-8 proves the stripper
 *  stripped. */
function readSourceNoComments(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** Every non-empty text node a user can actually read, with whitespace collapsed
 *  AT CAPTURE. Attributes are deliberately excluded: `data-testid` values
 *  legitimately contain "verified" and "superseded", and a sweep that swept them
 *  in would fail for the wrong reason and then get "fixed" by weakening. */
function renderedText(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

/** Affirmative verification claims. A blunt /verif/i sweep is WRONG, because the
 *  corrections installed by this wave deliberately reuse the platform's honest
 *  register — "it does not perform any verification on your behalf". Deleting
 *  those to satisfy a regex would remove the disclosure this wave exists to
 *  install. So the gate is written to the CLAIM, on wave 227's rule:
 *    · verified / verifies / verify / verifying — forbidden outright
 *    · verification — permitted ONLY inside a negation */
function affirmativeVerificationClaims(text: string): string[] {
  const offenders: string[] = [];
  /* `exec` in a loop rather than `matchAll`: the root tsconfig target predates
     es2015, so iterating a RegExpStringIterator raises TS2802 and would add to
     the compile-error count this wave must not increase. */
  const affirmative = /\bverif(?:ied|ies|y|ying)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = affirmative.exec(text)) !== null) {
    offenders.push(`AFFIRMATIVE: ...${text.slice(Math.max(0, m.index - 90), m.index + 90)}...`);
  }
  const noun = /\bverification\b/gi;
  let n: RegExpExecArray | null;
  while ((n = noun.exec(text)) !== null) {
    const before = text.slice(Math.max(0, n.index - 90), n.index);
    if (!/\b(?:does not|do not|no|not|never|without|cannot|isn't)\b/i.test(before)) {
      offenders.push(`UNNEGATED: ...${before}${text.slice(n.index, n.index + 90)}...`);
    }
  }
  return offenders;
}

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </RoleProvider>
  );
}
function newQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE EXACT SUPERSEDED LITERALS. Held here as the single source of truth for
   both directions of every proof: they must NOT render, and they MUST still
   exist in source. If a future wave deletes one from source, R-1 fails.
   ═══════════════════════════════════════════════════════════════════════════ */
const RETIRED = {
  a1: "Membership is reserved for investors who meet accreditation and contribution thresholds.",
  a2: "shares them only with the licensed KYC provider",
  a3: "Identity verification & KYC",
  a4: "the Collective committee runs a streamlined diligence pass",
} as const;

/* The honest sentences the brief requires to survive VERBATIM. */
const HONEST: Array<{ id: string; file: string; text: string }> = [
  {
    id: "H-1 GENERIC_COUNT_NOTE",
    file: "shared/spvEngine.ts",
    text: "Capavate does not hold a verified investor-count threshold for this jurisdiction.",
  },
  {
    id: "H-2 spvEducation accreditation",
    file: "client/src/lib/spvEducation.ts",
    text: "Investors on Capavate are assumed to be accredited.",
  },
  {
    id: "H-3 AccreditationForm register",
    file: "client/src/components/AccreditationForm.tsx",
    text: "Capavate records your declaration; it does not check it, and it does not perform any verification on your behalf.",
  },
  {
    id: "H-4 AccreditationDeclaration",
    file: "client/src/components/investor/AccreditationDeclaration.tsx",
    text: "This records your declaration. It is not a check of it.",
  },
  {
    id: "H-5 partner onboarding manual step",
    file: "client/src/pages/partner/OnboardingChecklistPage.tsx",
    text: "Manual step — there is no upload control on this screen.",
  },
  {
    id: "H-6 consortium agreement §4.3 (adequate item 1)",
    file: "shared/consortiumAgreement.ts",
    text: "The Partner will conduct and maintain KYC/AML/CTF and sanctions screening on its LPs",
  },
  {
    id: "H-7 wave 210 legal term of art (Class C, untouched)",
    file: "client/src/lib/legalDocs.ts",
    text: "interim access restrictions",
  },
];

beforeEach(() => {
  /* jsdom has no layout engine and no scrollIntoView. R212.3: a suite printed
     "26 passed" while exiting rc=1 because an async throw inside React's
     dispatch escaped the assertion. Installing the stub keeps a missing browser
     API from becoming an unattributed non-zero exit. */
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
  }
});
afterEach(() => cleanup());

/* ═══════════════════════════════════════════════════════════════════════════
   A1 — THE FOUNDER COLLECTIVE HERO
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · A1 — the hero eligibility claim on the founder Collective page", () => {
  function mount() {
    const qc = newQc();
    qc.setQueryData(["/api/founder/collective/nominations", COMPANY_ID], []);
    qc.setQueryData(["/api/founder/collective/applications", COMPANY_ID], []);
    const { container } = render(<FounderCollective />, { wrapper: wrap(qc) });
    return renderedText(container as HTMLElement);
  }

  it("A1-1: the mounted page does NOT render the accreditation-and-contribution threshold claim", () => {
    expect(mount()).not.toContain(RETIRED.a1);
  });

  it("A1-2: it asserts no eligibility test — the only threshold mention is a NEGATION", () => {
    const text = mount();
    expect(text).not.toMatch(/membership is reserved for/i);
    expect(text).not.toMatch(/meet accreditation/i);
    /* "threshold" is not banned — the corrected sentence uses it to say there is
       none, which is the whole point. What is banned is an AFFIRMATIVE one. So
       every occurrence must sit inside a negation. This is the R210.3 rule
       applied to a word: the detector must not be satisfied by absence alone. */
    const re = /threshold/gi;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = re.exec(text)) !== null) {
      seen += 1;
      const before = text.slice(Math.max(0, m.index - 60), m.index);
      expect(before, `UNNEGATED THRESHOLD: ...${before}${text.slice(m.index, m.index + 60)}...`).toMatch(
        /\b(?:no|not|does not|never|without)\b/i,
      );
    }
    expect(seen, "the corrected sentence must actually mention the absent threshold").toBeGreaterThan(0);
  });

  it("A1-3: the honest replacement renders, in the platform's own register", () => {
    const text = mount();
    expect(text).toContain("Capavate records your declaration, it does not check it, and it does not perform any verification on your behalf.");
    expect(text).toContain("No contribution threshold is measured or required.");
  });

  it("A1-4: nothing was restricted — the hero still states what it stated about who joins", () => {
    const text = mount();
    /* The page's structural claims are unchanged: companies do NOT join, they
       apply to present. A sweep that damaged the surrounding sentence would
       fail here. */
    expect(text).toContain("Companies do");
    expect(text).toContain("join the Collective");
    expect(text).toContain("to its members");
    expect(text).toContain("An invitation-only network of accredited investors.");
  });

  it("A1-5: no fabricated figure replaced the withdrawn threshold (R196.2)", () => {
    const text = mount();
    expect(text).not.toMatch(/(?:\u2265|>=|at least|minimum of)\s*[\d$]/i);
    expect(text).not.toMatch(/threshold of\s*[\d$]/i);
    expect(text).not.toMatch(/\$\s?0\b/);
  });

  it("A1-6: wave 228's three retired literals are still not rendered — this wave did not revive them", () => {
    const text = mount();
    expect(text).not.toContain("Verified accreditation per regional regulation");
    expect(text).not.toContain("Active investing track record");
    expect(text).not.toContain("Hash-chain audit, accreditation re-verification, KYC sweeps.");
  });

  it("A1-7: no affirmative verification claim renders anywhere on the page", () => {
    expect(affirmativeVerificationClaims(mount())).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A2 + A3 — THE INVESTOR APPLICATION'S IDENTITY STEP
   The step is REACHED, not simulated. If it cannot be reached the test FAILS
   rather than passing vacuously — that is inert-proof mechanism 3 ("a fixture
   no mutation can move") and mechanism 6 ("a query reading a different
   element"), and reaching the real step is the defence against both.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · A2 + A3 — the identity step of the investor Collective application", () => {
  function mountAndReachIdentityStep() {
    const qc = newQc();
    qc.setQueryData(["/api/collective/eligibility"], { eligible: true, passes: {}, reasons: [] });
    qc.setQueryData(["/api/collective/applications/mine"], null);
    qc.setQueryData(["/api/collective/waitlist/mine"], { items: [], count: 0 });
    const { container } = render(<InvestorApplyToCollective />, { wrapper: wrap(qc) });

    // Step 1 → 2
    fireEvent.click(screen.getByTestId("button-next"));
    // Step 2 requires a thesis and one of each chip.
    fireEvent.change(screen.getByTestId("textarea-thesis"), {
      target: { value: "A thesis of more than twenty characters, written so the step gate opens." },
    });
    for (const prefix of ["chip-sector-", "chip-stage-", "chip-geo-"]) {
      const chip = container.querySelector(`[data-testid^="${prefix}"]`);
      if (!chip) throw new Error(`HARNESS BROKEN: no control matched [data-testid^="${prefix}"]`);
      fireEvent.click(chip);
    }
    // Step 2 → 3
    fireEvent.click(screen.getByTestId("button-next"));

    /* HARD ABORT if the identity step is not actually on screen. Without this,
       every assertion below would pass on an empty haystack. */
    const passport = container.querySelector('[data-testid="upload-passport"]');
    if (!passport) {
      throw new Error(
        "HARNESS BROKEN: the identity step was never reached, so no assertion below proves anything. " +
          "Rendered text was: " + renderedText(container as HTMLElement).slice(0, 400),
      );
    }
    return { container, text: renderedText(container as HTMLElement) };
  }

  it("A2-0: the harness really reaches the identity step (the haystack is not empty)", () => {
    const { text } = mountAndReachIdentityStep();
    expect(text).toContain("Passport / national ID");
    expect(text).toContain("Proof of address");
  });

  it("A2-1: the mounted step does NOT tell an applicant their documents go to a KYC provider", () => {
    const { text } = mountAndReachIdentityStep();
    expect(text).not.toContain(RETIRED.a2);
    expect(text).not.toMatch(/licensed KYC provider/i);
  });

  it("A2-2: it names no identity or verification vendor at all", () => {
    const { text } = mountAndReachIdentityStep();
    for (const vendor of ["Persona", "Onfido", "Jumio", "Sumsub", "Trulioo", "Veriff", "Parallel Markets"]) {
      expect(text).not.toContain(vendor);
    }
  });

  it("A2-3: the absence is stated IN WORDS, not by silence", () => {
    const { text } = mountAndReachIdentityStep();
    expect(text).toContain("Capavate records what you upload; it does not check it, and it does not perform identity verification or KYC screening on your behalf.");
    expect(text).toContain("No verification provider is integrated with this platform, so nothing here is sent to one.");
  });

  it("A3-1: the step is no longer headed as a verification step", () => {
    const { text } = mountAndReachIdentityStep();
    expect(text).not.toContain(RETIRED.a3);
    expect(text).toContain("Identity documents");
  });

  it("A3-2: NOTHING WAS RESTRICTED (R190.10) — every upload control still renders", () => {
    const { container } = mountAndReachIdentityStep();
    for (const id of ["upload-passport", "upload-poa", "upload-additional"]) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    /* And the optional-documents allowance is still stated as ten. */
    expect(renderedText(container as HTMLElement)).toContain("up to 10");
  });

  it("A2-4: no affirmative verification claim renders on the identity step", () => {
    const { text } = mountAndReachIdentityStep();
    expect(affirmativeVerificationClaims(text)).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A4 — THE PROMOTE DIALOG
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · A4 — four named checks and an SLA on the promote dialog", () => {
  function mount() {
    const qc = newQc();
    const { baseElement } = render(
      <PromoteToCollectiveDialog companyId={COMPANY_ID} companyName="Northwind Labs" open onOpenChange={() => {}} />,
      { wrapper: wrap(qc) },
    );
    /* Radix renders dialog content in a PORTAL. Reading `container` here would
       read a different element and find nothing — inert-proof mechanism 6. So
       `baseElement` is used, and A4-0 proves the haystack is non-empty. */
    return renderedText(baseElement as HTMLElement);
  }

  it("A4-0: the dialog content really is in the haystack (portal read correctly)", () => {
    expect(mount()).toContain("Promote Northwind Labs to present at Capavate Collective");
  });

  it("A4-1: the committee diligence-pass paragraph does NOT render", () => {
    const text = mount();
    expect(text).not.toContain(RETIRED.a4);
    expect(text).not.toMatch(/diligence pass/i);
    expect(text).not.toMatch(/readiness scoring/i);
    expect(text).not.toMatch(/founder readiness check/i);
  });

  it("A4-2: no service-level commitment renders", () => {
    const text = mount();
    expect(text).not.toMatch(/\d+\s*business days?/i);
    expect(text).not.toMatch(/usually within/i);
  });

  it("A4-3: the absence is stated in words, and the ONE REAL check is described", () => {
    const text = mount();
    expect(text).toContain("Capavate checks that you appear on this company's cap table at that moment.");
    expect(text).toContain("No committee reviews your nomination, no M&A readiness score is computed, no check is performed on the founder, and no review time is promised.");
  });

  it("A4-4: the TRUE next paragraph is untouched — the fix did not sweep a true sentence away", () => {
    const text = mount();
    expect(text).toContain("The founder is");
    expect(text).toContain("automatically notified");
    expect(text).toContain("They can accept the nomination");
  });

  it("A4-5: nothing was restricted — the rationale field, the confirmation and the submit control all render", () => {
    const qc = newQc();
    const { baseElement } = render(
      <PromoteToCollectiveDialog companyId={COMPANY_ID} companyName="Northwind Labs" open onOpenChange={() => {}} />,
      { wrapper: wrap(qc) },
    );
    expect(baseElement.querySelector('[data-testid="button-promote-submit"]')).not.toBeNull();
    expect(renderedText(baseElement as HTMLElement)).toContain("Why this company?");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A5 + A6 — THE TWO APPEND-ONLY FIXES, PROVED IN SOURCE AS APPENDS
   The rendered proof for A6 is that the header literal is UNCHANGED; the
   R143.1 claim is precisely that no literal was replaced, and that is a
   property of the source, asserted here as such and declared weaker than a
   rendered assertion (R165.5).
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · A5 + A6 — the append-only fixes", () => {
  it("A6-1: the SPV compliance header literal is UNCHANGED (R143.1 — no literal replaced)", () => {
    const src = readSource("client/src/components/partner/SpvDetailTabs.tsx");
    expect(src).toContain('<div className="text-xs font-medium">Investor KYC &amp; accreditation</div>');
  });

  it("A6-2: the attribution sibling is appended beneath it and names the party", () => {
    const src = readSource("client/src/components/partner/SpvDetailTabs.tsx");
    expect(src).toContain('data-testid="spv-investor-compliance-attribution"');
    expect(src).toContain("Recorded by the Partner, for the Partner's own LPs, under the Consortium Partner Agreement. Capavate performs no KYC and no accreditation check on any investor.");
  });

  it("A6-3: the panel's own pre-existing copy is untouched", () => {
    const src = readSource("client/src/components/partner/SpvDetailTabs.tsx");
    expect(src).toContain("No investors on the register yet — compliance profiles appear here once an investor subscribes.");
  });

  it("A5-1: every governance row label is UNCHANGED — no label replaced, nothing hidden", () => {
    const src = readSource("client/src/pages/CompanyDetails.tsx");
    for (const label of [
      "Formal Board of Directors",
      "No pending litigation",
      "Regulatory compliant",
      "External legal counsel",
      "Financials independently audited",
      "SaaS / recurring model",
      "Material IP holdings",
      "ESG framework adopted",
      "DEI policy in place",
      "Cybersecurity certification (SOC 2 / ISO 27001)",
    ]) {
      expect(src).toContain(`label="${label}"`);
    }
  });

  it("A5-2: the attribution line is appended as the LAST child of the grid and names the party", () => {
    const src = readSource("client/src/pages/CompanyDetails.tsx");
    expect(src).toContain('data-testid="section-governance-attribution"');
    expect(src).toContain("Every row above is stated by the company on its own profile. Capavate records what the company states and does not check any of it.");
    /* Appended LAST: the attribution div is the final element before the grid
       closes, so no row above it renumbers. */
    const grid = src.slice(src.indexOf('data-testid="section-governance"'));
    const attr = grid.indexOf('data-testid="section-governance-attribution"');
    const close = grid.indexOf("</SectionCard>");
    expect(attr).toBeGreaterThan(0);
    expect(attr).toBeLessThan(close);
    expect(grid.indexOf('label="Cybersecurity certification')).toBeLessThan(attr);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   H — THE HONEST SENTENCES, BYTE-VERBATIM
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · H — every honest sentence this wave was told to preserve still exists byte-verbatim", () => {
  for (const h of HONEST) {
    it(`${h.id} survives verbatim in ${h.file}`, () => {
      /* The NEEDLE is a raw literal, never normalised. The HAYSTACK is collapsed
         at capture only, because the formatter wraps some of these sentences
         across source lines. Nothing is normalised inside the comparison —
         inert-proof mechanism 2 is the call inside the assertion, and there is
         none here. */
      expect(readSourceCollapsed(h.file), h.id).toContain(h.text);
    });
  }

  it("H-8: the honest sentences render, not merely exist — the founder Collective register line reaches the page", () => {
    const qc = newQc();
    qc.setQueryData(["/api/founder/collective/nominations", COMPANY_ID], []);
    qc.setQueryData(["/api/founder/collective/applications", COMPANY_ID], []);
    const { container } = render(<FounderCollective />, { wrapper: wrap(qc) });
    expect(renderedText(container as HTMLElement)).toContain("it does not perform any verification on your behalf");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   R — NOTHING DELETED (R195.5)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · R — every retired literal still EXISTS in source and does NOT render", () => {
  const cases: Array<{ id: string; file: string; literal: string; flag: string }> = [
    { id: "R-1 A1", file: "client/src/pages/founder/Collective.tsx", literal: RETIRED.a1, flag: "W220_RENDER_SUPERSEDED_COPY" },
    { id: "R-2 A2", file: "client/src/pages/investor/ApplyToCollective.tsx", literal: RETIRED.a2, flag: "W220_RENDER_SUPERSEDED_COPY" },
    { id: "R-3 A3", file: "client/src/pages/investor/ApplyToCollective.tsx", literal: RETIRED.a3, flag: "W220_RENDER_SUPERSEDED_COPY" },
    { id: "R-4 A4", file: "client/src/components/investor/PromoteToCollectiveDialog.tsx", literal: RETIRED.a4, flag: "W220_RENDER_SUPERSEDED_COPY" },
  ];

  for (const c of cases) {
    it(`${c.id}: retained in place, not deleted`, () => {
      expect(readSource(c.file)).toContain(c.literal);
    });
  }

  it("R-5: the retention branch uses an IDENTIFIER FLAG, never `{false && …}` (R210.4)", () => {
    for (const file of [
      "client/src/pages/founder/Collective.tsx",
      "client/src/pages/investor/ApplyToCollective.tsx",
      "client/src/components/investor/PromoteToCollectiveDialog.tsx",
    ]) {
      const src = readSource(file);
      expect(src, file).toContain("const W220_RENDER_SUPERSEDED_COPY = false;");
      expect(src, file).toContain("{W220_RENDER_SUPERSEDED_COPY ? (");
      /* Comments stripped: each of these files EXPLAINS in prose why it does not
         use `{false && …}`, and a raw-source assertion would fail on the
         explanation. N-8 proves the stripper stripped. */
      const code = readSourceNoComments(file);
      /* SUPPRESSION IN ANY SYNTACTIC FORM, not just the one form the rule is
         usually written in. Found by disarming this very assertion: mutation D8
         originally swapped the ternary for `{false && (`, which broke the parse,
         so the suite went red for the WRONG REASON and proved nothing. The
         syntactically valid suppression `{false ? (` slipped straight past a
         `{false &&`-only check. Both are now fenced, along with the negated and
         nullish spellings. */
      for (const form of ["{false &&", "{false ?", "{!true &&", "{!true ?", "{null &&", "{undefined &&", "{0 &&"]) {
        expect(code, `${file} — literal-false suppression \`${form}\` (R210.4)`).not.toContain(form);
      }
      /* And no whitespace-variant of the same thing. */
      expect(code.replace(/\s+/g, " "), `${file} — spaced literal-false suppression`).not.toMatch(
        /\{ ?(?:false|!true|null|undefined|0) ?(?:&&|\?) /,
      );
    }
  });

  it("R-6: each retained literal lives INSIDE the flagged branch, not loose in the tree", () => {
    const src = readSource("client/src/pages/founder/Collective.tsx");
    const branch = src.indexOf("{W220_RENDER_SUPERSEDED_COPY ? (");
    expect(branch).toBeGreaterThan(0);
    expect(src.indexOf(RETIRED.a1, branch)).toBeGreaterThan(branch);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   P — THE PRODUCTION REGISTRAR (handbook §8: never prove a replica)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · P — the production registrar still routes to the modules under test", () => {
  const app = () => readSource("client/src/App.tsx");

  it("P-1: /founder/collective is bound to pages/founder/Collective", () => {
    const src = app();
    expect(src).toMatch(/import\s+\w+\s+from\s+"@\/pages\/founder\/Collective"/);
    expect(src).toContain('path="/founder/collective"');
  });

  it("P-2: the investor Collective application is bound to pages/investor/ApplyToCollective", () => {
    expect(app()).toMatch(/import\s+\w+\s+from\s+"@\/pages\/investor\/ApplyToCollective"/);
  });

  it("P-3: the promote dialog is mounted by a real portfolio surface, not only by this test", () => {
    /* A component nothing mounts is a replica. This asserts a production
       consumer imports it. */
    const consumers = [
      "client/src/components/investor/PortfolioCompanyOverview.tsx",
      "client/src/pages/investor/CompanyDetail.tsx",
      "client/src/pages/investor/Portfolio.tsx",
    ];
    const found = consumers.filter((f) => {
      try {
        return readSource(f).includes("PromoteToCollectiveDialog");
      } catch {
        return false;
      }
    });
    expect(found.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   N — NEGATIVE CONTROLS. R210.3: a composite detector needs an isolating
   control PER BRANCH, asserted by label, because otherwise one branch's control
   is supplied by its siblings and a dead branch is never noticed.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W220 · N — negative controls: each detector catches what it is built to catch", () => {
  it("N-1: the AFFIRMATIVE branch fires on 'verified', independently", () => {
    const out = affirmativeVerificationClaims("Accreditation is verified by Capavate.");
    expect(out.length).toBe(1);
    expect(out[0]).toContain("AFFIRMATIVE");
  });

  it("N-2: the AFFIRMATIVE branch fires on each inflection, independently", () => {
    for (const w of ["verified", "verifies", "verify", "verifying"]) {
      const out = affirmativeVerificationClaims(`Capavate ${w} accreditation.`);
      expect(out.length).toBe(1);
      expect(out[0]).toContain("AFFIRMATIVE");
    }
  });

  it("N-3: the UNNEGATED-NOUN branch fires on its own, with no affirmative word present", () => {
    const out = affirmativeVerificationClaims("Accreditation verification is included as a baseline.");
    expect(out.length).toBe(1);
    expect(out[0]).toContain("UNNEGATED");
  });

  it("N-4: the UNNEGATED-NOUN branch stays SILENT inside a negation — the honest register survives", () => {
    expect(affirmativeVerificationClaims("Capavate does not perform any verification on your behalf.")).toEqual([]);
    expect(affirmativeVerificationClaims("Capavate performs no verification or screening of it.")).toEqual([]);
  });

  it("N-5: renderedText really reads text, and really excludes attributes", () => {
    const el = document.createElement("div");
    el.innerHTML = '<span data-testid="verified-badge">plain words</span>';
    const t = renderedText(el);
    expect(t).toContain("plain words");
    expect(t).not.toContain("verified-badge");
  });

  it("N-6: the source reader would notice a deletion — a literal absent from a file fails", () => {
    expect(readSource("client/src/pages/founder/Collective.tsx")).not.toContain(
      "a sentence that has never existed in this file",
    );
  });

  it("N-7: the collapsed-source reader is not a wildcard — it still fails on a changed word", () => {
    const src = readSourceCollapsed("client/src/components/AccreditationForm.tsx");
    expect(src).toContain("Capavate records your declaration; it does not check it");
    /* One word altered, and the reader must NOT match. Without this control, a
       collapsing reader could be quietly replaced by something that matches
       anything. */
    expect(src).not.toContain("Capavate records your declaration; it does check it");
  });

  it("N-8: the comment stripper really strips, and really preserves string literals", () => {
    const src = readSource("client/src/pages/founder/Collective.tsx");
    const stripped = readSourceNoComments("client/src/pages/founder/Collective.tsx");
    /* Present in a comment, and must be gone. */
    expect(src).toContain("{false && ");
    expect(stripped).not.toContain("{false &&");
    /* Present as a string literal / JSX text, and must SURVIVE — the content
       under audit IS literals, so a stripper that removed them would remove the
       subject of the measurement. */
    expect(stripped).toContain(RETIRED.a1);
    expect(stripped).toContain("const W220_RENDER_SUPERSEDED_COPY = false;");
    /* Line count and length preserved, so any line number quoted stays real. */
    expect(stripped.length).toBe(src.length);
    expect(stripped.split("\n").length).toBe(src.split("\n").length);
  });
});
