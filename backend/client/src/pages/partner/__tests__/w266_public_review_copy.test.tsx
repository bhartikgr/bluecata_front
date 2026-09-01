/**
 * WAVE 266 — THE TWO PUBLIC SENTENCES THAT DESCRIBED A REVIEW PROCESS THAT DOES
 * NOT EXIST, PROVED IN A MOUNTED DOM ON THE REAL PAGE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A REPLICA (handbook §8 failure mode 1)
 * ═════════════════════════════════════════════════════════════════════════════
 * The component mounted below is the DEFAULT EXPORT of
 * `client/src/pages/partner/PartnerSignup.tsx` — the same import production's
 * router uses at `client/src/App.tsx:141`, mounted at `client/src/App.tsx:664`:
 *
 *     <Route path="/partner/signup" component={PartnerSignup} />
 *
 * §E asserts that registration from `App.tsx` on disk, so this test fails if the
 * page it proves ever stops being the page the router mounts. No markup is
 * retyped, no prop is injected, nothing is stubbed.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS PROVED
 * ═════════════════════════════════════════════════════════════════════════════
 *   §A  the three prohibited/unsupported strings are ABSENT from the rendered DOM
 *   §B  the corrected sentences RENDER, byte-exact, on the real page
 *   §C  the honest register is REUSED, not invented — each borrowed clause is a
 *       byte-exact substring of the file it came from
 *   §D  nothing was deleted (R195.5): both superseded literals are still in the
 *       source, byte-identical to the guard baseline, inside a retention block
 *       whose control is an IDENTIFIER flag set to false, appended LAST
 *   §E  the production registrar
 *   §F  the absent mechanisms, asserted against the server tree — no SLA timer
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO NORMALISING CALL IN ANY EQUALITY ASSERTION (inert-proof mechanism 2)
 * ═════════════════════════════════════════════════════════════════════════════
 * §B and §D compare bytes. Neither side of any `toBe`/`toContain` in those
 * sections passes through `.trim()`, `.toLowerCase()`, `.replace(/\s+/g," ")`,
 * or `.normalize()`. The DOM reads in §A/§B use `textContent` and collapse
 * nothing; where JSX line-wrapping means the rendered text contains a newline,
 * the assertion is made against a SUB-SENTENCE that lies entirely on one source
 * line, so no whitespace normalisation is needed to make it pass. §D reads the
 * file off disk with `utf8` and no transformation whatsoever.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SCOPED QUERIES ONLY (inert-proof mechanism 6)
 * ═════════════════════════════════════════════════════════════════════════════
 * Every DOM read goes through the `container` returned by `render()`, never the
 * global `screen`.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY EVERY ASSERTION HERE CAN FAIL
 * ═════════════════════════════════════════════════════════════════════════════
 * §A would pass vacuously if the page failed to render at all, so §A is preceded
 * by a liveness assertion that the page rendered its own title-adjacent heading.
 * A test that proves an absence must first prove there was something present to
 * be absent FROM.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PartnerSignup from "@/pages/partner/PartnerSignup";

const ROOT = resolve(__dirname, "../../../../..");
const PAGE = "client/src/pages/partner/PartnerSignup.tsx";

function readRepoFile(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** Comments blanked, LENGTH AND LINE COUNT PRESERVED, so any line number quoted
 *  elsewhere stays real. Same construction as
 *  `client/src/components/__tests__/w220_class_a_copy.test.tsx:97`.
 *
 *  WHY THIS IS NEEDED AT ALL: this wave's own explanatory comment contains the
 *  string `{false && ...}` because it explains why that construction was NOT
 *  used. A grep for `{false && ` over the raw source therefore matches the
 *  documentation and reports a suppression that does not exist. A comment once
 *  inflated a call-site count in exactly this way, so every grep conclusion in
 *  this file is drawn from stripped source, and §D proves the stripper stripped. */
function readRepoFileNoComments(rel: string): string {
  return readRepoFile(rel)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/* THE EXACT SUPERSEDED LITERALS, held here as the single source of truth for
   what must never silently disappear. Both are copied from
   `scripts/silent-drop-guard/baseline.route-targets.json` lines 9963 and 9970,
   which is the file the guard gate itself compares against. */
const SUPERSEDED = {
  vetted:
    "Consortium partners are vetted accelerator programs, angel networks, syndicates, and family offices that bring their founders, investors, and deals onto Capavate as a single managed portfolio.",
  verifiesSla:
    "Platform team reviews + verifies your organization (typically 3–5 business days).",
} as const;

/* The clauses borrowed from the platform's existing honest register, with the
   file each one is borrowed FROM. §C proves each is still a byte-exact
   substring of its origin, so a future wave that rewords the register is forced
   to notice that this page quotes it. */
const BORROWED: Array<{ clause: string; from: string }> = [
  {
    clause: "It is not a check of it.",
    from: "client/src/components/investor/AccreditationDeclaration.tsx",
  },
  {
    clause: "no review time is promised",
    from: "client/src/components/investor/PromoteToCollectiveDialog.tsx",
  },
];

describe("W266 §A — the prohibited and unsupported strings are absent from the rendered public page", () => {
  it("renders the page (liveness — an absence proof needs a live subject)", () => {
    const { container } = render(<PartnerSignup />);
    expect(container.textContent).toContain("Apply to become a consortium partner");
    expect(container.textContent).toContain("How approval works");
  });

  it("does not render the word 'vetted' anywhere (R227.2 · R189.3 prohibit it)", () => {
    const { container } = render(<PartnerSignup />);
    expect(container.textContent ?? "").not.toContain("vetted");
  });

  it("does not render 'verifies your organization' — a check that does not exist", () => {
    const { container } = render(<PartnerSignup />);
    expect(container.textContent ?? "").not.toContain("verifies your organization");
  });

  it("does not render the '3–5 business days' SLA", () => {
    const { container } = render(<PartnerSignup />);
    expect(container.textContent ?? "").not.toContain("3–5 business days");
  });

  it("renders neither superseded sentence in full", () => {
    const { container } = render(<PartnerSignup />);
    const text = container.textContent ?? "";
    expect(text).not.toContain(SUPERSEDED.verifiesSla);
    expect(text).not.toContain("are vetted accelerator programs");
  });
});

describe("W266 §B — the corrected sentences render on the real page", () => {
  it("sentence 1: the declaration is recorded, and the page says it is not checked", () => {
    const { container } = render(<PartnerSignup />);
    const text = container.textContent ?? "";
    expect(text).toContain("Applicants");
    expect(text).toContain("declare their own regulatory status. Capavate records that declaration. It is not a check of it.");
  });

  it("sentence 2: an administrator decides, no verification is claimed, no time is promised", () => {
    const { container } = render(<PartnerSignup />);
    const text = container.textContent ?? "";
    expect(text).toContain(
      "A Capavate administrator reviews your application and decides whether to approve it. Capavate does not verify your organization, and no review time is promised.",
    );
  });

  it("the corrected sentence 2 replaced the old list item in place — the list is still four steps", () => {
    const { container } = render(<PartnerSignup />);
    const flow = container.querySelector('[data-testid="partner-approval-flow"]');
    expect(flow).not.toBeNull();
    const items = flow!.querySelectorAll("li");
    expect(items.length).toBe(4);
    expect(items[1].textContent).toContain("decides whether to approve it");
  });
});

describe("W266 §C — the honest register is reused, not invented", () => {
  for (const { clause, from } of BORROWED) {
    it(`"${clause}" is a byte-exact substring of ${from}`, () => {
      const origin = readRepoFile(from);
      expect(origin).toContain(clause);
    });

    it(`"${clause}" is a byte-exact substring of the corrected page`, () => {
      expect(readRepoFile(PAGE)).toContain(clause);
    });
  }

  it("the borrowed-clause comparison is capable of failing", () => {
    const origin = readRepoFile(BORROWED[0].from);
    expect(origin).not.toContain("It is not a check of it!");
  });
});

describe("W266 §D — nothing deleted (R195.5): both superseded literals are retired in place", () => {
  it("both literals are still present in the source, byte-identical", () => {
    const src = readRepoFile(PAGE);
    expect(src).toContain(SUPERSEDED.vetted);
    expect(src).toContain(SUPERSEDED.verifiesSla);
  });

  it("each literal appears in the source exactly once (no stray duplicate)", () => {
    const src = readRepoFile(PAGE);
    expect(src.split(SUPERSEDED.vetted).length - 1).toBe(1);
    expect(src.split(SUPERSEDED.verifiesSla).length - 1).toBe(1);
  });

  it("the literals match the guard baseline byte for byte", () => {
    const baseline = readRepoFile("scripts/silent-drop-guard/baseline.route-targets.json");
    expect(baseline).toContain(SUPERSEDED.vetted);
    expect(baseline).toContain(SUPERSEDED.verifiesSla);
  });

  it("the control is an IDENTIFIER flag set to false, not a folded `false &&` conjunction", () => {
    const code = readRepoFileNoComments(PAGE);
    expect(code).toContain("const W266_RENDER_SUPERSEDED_COPY = false;");
    expect(code).toContain("{W266_RENDER_SUPERSEDED_COPY ? (");
    /* Measured on CODE, not on the raw file: see readRepoFileNoComments. */
    expect(code).not.toContain("{false && ");
  });

  it("the comment stripper really strips, and really preserves the literals under audit", () => {
    const src = readRepoFile(PAGE);
    const code = readRepoFileNoComments(PAGE);
    /* Present in a comment, and must be gone — this is the control that proves
       the previous test's negative assertion is not vacuous. */
    expect(src).toContain("{false && ");
    expect(code).not.toContain("{false &&");
    /* Present as JSX text, and must SURVIVE — the subject of this wave IS the
       literals, so a stripper that removed them would delete the measurement. */
    expect(code).toContain(SUPERSEDED.vetted);
    expect(code).toContain(SUPERSEDED.verifiesSla);
    /* Length and line count preserved. */
    expect(code.length).toBe(src.length);
    expect(code.split("\n").length).toBe(src.split("\n").length);
  });

  it("both literals sit INSIDE the retention branch, after its opening", () => {
    const src = readRepoFile(PAGE);
    const branch = src.indexOf("{W266_RENDER_SUPERSEDED_COPY ? (");
    expect(branch).toBeGreaterThan(0);
    expect(src.indexOf(SUPERSEDED.vetted, branch)).toBeGreaterThan(branch);
    expect(src.indexOf(SUPERSEDED.verifiesSla, branch)).toBeGreaterThan(branch);
  });

  it("the retention block is the LAST sibling of its container (nothing above it renumbers)", () => {
    const src = readRepoFile(PAGE);
    const afterBranch = src.slice(src.indexOf("{W266_RENDER_SUPERSEDED_COPY ? ("));
    /* Between the end of the retention branch and the container's close there
       must be no further sibling element. */
    const tail = afterBranch.slice(afterBranch.indexOf(") : null}") + ") : null}".length);
    expect(tail).toContain("</div>");
    expect(tail).toContain("</AuthShell>");
    expect(tail).not.toMatch(/<[A-Za-z][^>]*>/);
  });

  it("neither literal renders while the flag is false", () => {
    const { container } = render(<PartnerSignup />);
    expect(container.querySelector('[data-testid="w266-superseded-partner-review-copy"]')).toBeNull();
  });
});

describe("W266 §E — the production registrar", () => {
  it("App.tsx mounts this exact module at /partner/signup", () => {
    const app = readRepoFile("client/src/App.tsx");
    expect(app).toContain('import PartnerSignup from "@/pages/partner/PartnerSignup"');
    expect(app).toContain('<Route path="/partner/signup" component={PartnerSignup} />');
  });
});

describe("W266 §F — the mechanisms the old sentences claimed, measured against the real store", () => {
  /* SCOPE, STATED HONESTLY. An earlier draft of this section asserted that NO
     SLA machinery exists anywhere in `server/` or `shared/`. That assertion was
     FALSE and this test caught it: `age_sla_hours` is a real column on the
     Managed Founder CRM stage machine (`server/lib/applyWaveC2MfcStagesSchema.ts:80`,
     `shared/schema.ts:3044`). That SLA belongs to a partner's own deal pipeline
     and has nothing to do with reviewing a consortium APPLICATION. So the claim
     this section proves is the narrower, true one: the store that owns the
     application-review lifecycle has no deadline, no timer and no queue. */
  const STORE = "server/consortiumApplyStore.ts";

  for (const token of [
    "diligence",
    "businessDays",
    "business_days",
    "reviewDeadline",
    "review_deadline",
    "slaHours",
    "sla_hours",
  ]) {
    it(`${STORE} contains no '${token}'`, () => {
      expect(readRepoFile(STORE)).not.toContain(token);
    });
  }

  it("the store DOES have an administrator review decision — so 'an administrator reviews' is true, not invented", () => {
    const src = readRepoFile(STORE);
    expect(src).toContain("/api/admin/consortium/applications/:id/review");
    expect(src).toContain("reviewedByUserId");
    expect(src).toContain('status: z.enum(["approved", "rejected"])');
  });

  it("the store does NOT verify the organisation — the only verify step is the applicant's own attestation", () => {
    const src = readRepoFile(STORE);
    /* `verifyComplianceAttestation` checks that the APPLICANT ticked and that
       the quoted clause matches the agreement. It checks the form, not the
       organisation. Nothing in the store contacts a registry. */
    expect(src).not.toContain("verifyOrganization");
    expect(src).not.toContain("verifyOrganisation");
    expect(src).not.toContain("companiesHouse");
    expect(src).not.toContain("registryLookup");
  });

  it("the token search is capable of finding something (this section is not vacuous)", () => {
    const src = readRepoFile(STORE);
    expect(src).toContain("consortium_applications");
    expect(src).toContain("regulatory_status");
  });
});
