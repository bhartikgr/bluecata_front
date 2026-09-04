/**
 * WAVE C · ITEM 1 (owner items 10a + 8b) — THE FOUR SURFACES, AND THE SPV TARGET.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 * ══════════════════════════════════════════════════════════════════════════════
 * Two claims are proved here, and both are proved against the REAL shipped
 * modules and the real jsdom DOM rather than against a description of them:
 *
 *   (10a) each of the four confusing surfaces now states, in its own words, what
 *         it is for and how it relates to the others, with contrast that clears
 *         WCAG AA and with links that are marked by more than colour;
 *   (8b)  the SPV wizard's target company can be PICKED from the partner's own
 *         Clients and Portfolio lists, and doing so cannot silently store a
 *         different company than the one on the record.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CONTROLS COME FIRST — THE DISAGREEMENT BEFORE THE AGREEMENT
 * ══════════════════════════════════════════════════════════════════════════════
 * Every "the fix works" assertion in this file is preceded by a CONTROL that
 * demonstrates the corresponding defect actually occurring. A fixture that cannot
 * distinguish the fix from the defect proves nothing, so:
 *
 *   · CONTROL 1 concatenates the two lists NAIVELY and shows the same company
 *     really does appear twice — the duplication the owner saw.
 *   · CONTROL 2 renders the NAIVE dropdown (options from the two lists only) in
 *     jsdom with a pipeline-only company id as its value, and asserts the element
 *     reports a DIFFERENT company than the one it was given. That is the silent
 *     retarget, demonstrated in the browser's own coercion behaviour.
 *
 * If either control ever stops failing, its assertion turns RED and says that the
 * agreement half of this file has become meaningless.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT MOCKED, AND WHAT DELIBERATELY IS
 * ══════════════════════════════════════════════════════════════════════════════
 * NOT mocked: `mergeTargetCompanyChoices`, `canonicalSelectOptions`,
 * `PartnerSurfaceGuide`, the `HTMLSelectElement` coercion, and the four page
 * sources — all read as shipped.
 *
 * Deliberately NOT rendered: the four pages themselves. They require a resolved
 * partner role, a query client and a router, and a render harness for them would
 * be a replica of the page rather than the page. Their PLACEMENT claims are
 * therefore asserted against the page SOURCE — which is exactly how the two
 * existing placement tests this wave had to respect (`wave33_pipe06_provenance`
 * U6 and `wave33_pipe10_lock1`) assert theirs. The component's rendered output IS
 * rendered, so the copy claim is not a source claim.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CONTRAST NUMBERS ARE COMPUTED HERE, NOT QUOTED
 * ══════════════════════════════════════════════════════════════════════════════
 * `contrastRatio` below is the WCAG 2.1 relative-luminance formula. The token
 * values are read out of `styles/ledger-partner.css` BY THIS TEST, so if a future
 * wave edits a token the ratio is recomputed and this file fails rather than
 * continuing to quote a number that has stopped being true.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  mergeTargetCompanyChoices,
  targetCompanyOptionLabel,
  targetCompanyPickerHint,
  TARGET_COMPANY_OFF_LIST_SUFFIX,
  TARGET_COMPANY_UNNAMED_LABEL,
} from "../../../lib/partner/targetCompanyOptions";
import { canonicalSelectOptions } from "../../../lib/canonicalFieldOptions";
import { PartnerSurfaceGuide } from "../PartnerSurfaceGuide";

afterEach(() => cleanup());

const ROOT = resolve(__dirname, "../../../../..");
const readSrc = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/* ── THE INSTRUMENT: WCAG 2.1 CONTRAST, AND A SELF-CHECK ON IT ─────────────── */

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read one token's value out of the partner-scoped stylesheet. */
function partnerToken(name: string): string {
  const css = readSrc("client/src/styles/ledger-partner.css");
  const scope = css.indexOf('[data-product="partner"]');
  expect(scope).toBeGreaterThan(-1);
  const m = css.slice(scope).match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  expect(m, `token --${name} not found inside the partner scope`).not.toBeNull();
  return m![1];
}

describe("WC · INSTRUMENT — the contrast function is calibrated before it is trusted", () => {
  it("I1 reproduces the two ratios WCAG itself fixes by definition", () => {
    // Black on white is exactly 21:1 and white on white is exactly 1:1. A
    // formula that gets these wrong cannot be trusted on the token pairs below.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("I2 is symmetric, so an argument order mistake cannot hide a failure", () => {
    expect(contrastRatio("#5F6B7E", "#F1F4F8")).toBeCloseTo(contrastRatio("#F1F4F8", "#5F6B7E"), 10);
  });

  it("I3 REFUSES a pair that genuinely fails — the negative control on the instrument", () => {
    // The FALLBACK muted grey in capavate-tokens.css. If the instrument could not
    // fail, every assertion below would be vacuous.
    expect(contrastRatio("#7a7874", "#f0ede8")).toBeLessThan(4.5);
  });
});

/* ── 10a · CONTRAST OF THE ORIENTATION BLOCK, ON ITS OWN SURFACE ───────────── */

describe("WC · 10a — the orientation block clears WCAG AA on the surface it is painted on", () => {
  it("A1 the surface, border and text tokens it uses all exist in the partner scope", () => {
    for (const t of ["cv-color-surface-2", "cv-color-border", "cv-color-text", "cv-color-text-muted"]) {
      expect(partnerToken(t)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("A2 body text on the block's surface clears 4.5:1", () => {
    const ratio = contrastRatio(partnerToken("cv-color-text"), partnerToken("cv-color-surface-2"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeGreaterThan(15); // #1A1A1A on #F1F4F8 — not marginal.
  });

  it("A3 the muted trailing clause also clears 4.5:1 — it is body text, not decoration", () => {
    const ratio = contrastRatio(partnerToken("cv-color-text-muted"), partnerToken("cv-color-surface-2"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("A4 the link colour clears 4.5:1 on the same surface", () => {
    // --cv-color-primary is NOT redeclared in the partner scope (Tier-9 rule 74
    // locks it), so its value comes from capavate-tokens.css and is read there.
    const tokens = readSrc("client/src/styles/capavate-tokens.css");
    const m = tokens.match(/--cv-color-primary:\s*(#[0-9A-Fa-f]{6})/);
    expect(m).not.toBeNull();
    const ratio = contrastRatio(m![1], partnerToken("cv-color-surface-2"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

/* ── 10a · THE BLOCK RENDERS, AND COLOUR IS NEVER THE ONLY SIGNAL ─────────── */

describe("WC · 10a — the block renders its own words and marks links by more than colour", () => {
  const relations = [
    { label: "Clients", href: "/collective/partner/clients", why: "who gets the credit", testId: "t-clients" },
    { label: "SPVs", href: "/collective/partner/spvs", why: "the vehicles you sponsor", testId: "t-spvs" },
  ];

  it("B1 the title and the body sentence are on screen as TEXT, not merely in the source", () => {
    render(
      <PartnerSurfaceGuide testId="g" title="How Portfolio differs" relations={relations}>
        Portfolio is the profile you keep for each company.
      </PartnerSurfaceGuide>,
    );
    expect(screen.getByText("How Portfolio differs")).toBeTruthy();
    expect(screen.getByTestId("g-body").textContent).toContain(
      "Portfolio is the profile you keep for each company.",
    );
  });

  it("B2 it is a labelled landmark, so the block is reachable without sight", () => {
    render(
      <PartnerSurfaceGuide testId="g" title="How Portfolio differs" relations={relations}>
        body
      </PartnerSurfaceGuide>,
    );
    const el = screen.getByTestId("g");
    expect(el.tagName.toLowerCase()).toBe("section");
    expect(el.getAttribute("aria-label")).toBe("How Portfolio differs");
  });

  it("B3 EVERY link carries a non-colour affordance — underline and weight, not hue alone", () => {
    render(
      <PartnerSurfaceGuide testId="g" title="t" relations={relations}>
        body
      </PartnerSurfaceGuide>,
    );
    for (const r of relations) {
      const a = screen.getByTestId(r.testId);
      expect(a.className, `${r.label} link must be underlined`).toContain("underline");
      expect(a.className, `${r.label} link must be weighted`).toContain("font-medium");
      expect(a.getAttribute("href")).toBe(r.href);
    }
  });

  it("B4 every link is accompanied by words saying WHAT the relationship is", () => {
    render(
      <PartnerSurfaceGuide testId="g" title="t" relations={relations}>
        body
      </PartnerSurfaceGuide>,
    );
    const text = screen.getByTestId("g-relations").textContent ?? "";
    expect(text).toContain("who gets the credit");
    expect(text).toContain("the vehicles you sponsor");
  });

  it("B5 with no relations it renders NO empty list rather than an orphan heading", () => {
    render(
      <PartnerSurfaceGuide testId="g" title="t" relations={[]}>
        body
      </PartnerSurfaceGuide>,
    );
    expect(screen.queryByTestId("g-relations")).toBeNull();
  });
});

/* ── 10a · THE FOUR SURFACES MOUNT IT, AND THE TWO EXISTING PLACEMENT
      TESTS ARE NOT WEAKENED TO MAKE ROOM FOR IT ───────────────────────────── */

describe("WC · 10a — all four surfaces mount it, and the routes it links to are real", () => {
  const PAGES: Array<[string, string]> = [
    ["client/src/pages/partner/PartnerPortfolio.tsx", "portfolio-surface-guide"],
    ["client/src/pages/partner/PartnerClients.tsx", "clients-surface-guide"],
    ["client/src/pages/partner/PartnerPipeline.tsx", "pipeline-surface-guide"],
    ["client/src/pages/partner/PartnerAddPortfolioCompany.tsx", "apc-surface-guide"],
  ];

  it("C1 each of the four pages mounts the block with its own testid", () => {
    for (const [file, testId] of PAGES) {
      const src = readSrc(file);
      expect(src, `${file} must import the block`).toContain("PartnerSurfaceGuide");
      expect(src, `${file} must mount it as ${testId}`).toContain(`testId="${testId}"`);
    }
  });

  it("C2 EVERY href it offers is a route App.tsx actually registers", () => {
    const app = readSrc("client/src/App.tsx");
    const hrefs = new Set<string>();
    for (const [file] of PAGES) {
      for (const m of readSrc(file).matchAll(/href: "(\/collective\/partner\/[a-z-]+)"/g)) {
        hrefs.add(m[1]);
      }
    }
    // Both sides non-empty: an empty href set would make this pass vacuously.
    expect(hrefs.size).toBeGreaterThanOrEqual(4);
    for (const h of hrefs) {
      expect(app, `${h} is offered as a link but is not a registered route`).toContain(`path="${h}"`);
    }
  });

  it("C3 Clients keeps NOTHING after the provenance panel — wave33_pipe06 U6 still holds", () => {
    // `lastIndexOf`, NOT `indexOf`, and that is the whole lesson of this
    // assertion. This file has carried a COMMENT quoting the mount's JSX since
    // wave 282, so a leading `indexOf` anchor matches prose rather than markup —
    // an earlier draft of this very test did exactly that and reported a failure
    // that was not real. The last occurrence is the mount.
    const src = readSrc("client/src/pages/partner/PartnerClients.tsx");
    const i = src.lastIndexOf("<AttributionProvenancePanel />");
    const j = src.lastIndexOf("</PartnerShell>");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(src.slice(i + "<AttributionProvenancePanel />".length, j).trim()).toBe("");
    // ...and the new block is genuinely BEFORE it, not merely absent.
    const g = src.indexOf('testId="clients-surface-guide"');
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(i);
  });

  it("C4 Pipeline keeps NOTHING after Lock 1 — wave33_pipe10 still holds", () => {
    const src = readSrc("client/src/pages/partner/PartnerPipeline.tsx");
    const i = src.lastIndexOf("<Lock1NoticePanel />");
    const j = src.lastIndexOf("</PartnerShell>");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(src.slice(i + "<Lock1NoticePanel />".length, j).trim()).toBe("");
    const g = src.indexOf('testId="pipeline-surface-guide"');
    expect(g).toBeGreaterThan(-1);
    expect(g).toBeLessThan(i);
  });

  it("C5 the block offers NO per-row link, because those keys are nullable", () => {
    // `spv.target_company_id` and `partner_deal_pipeline.company_id` are both
    // nullable, so a per-row link belongs on the row that has the key — it must
    // never be emitted from a page-level orientation block, where it would be
    // offered for rows whose key is absent.
    const src = readSrc("client/src/components/partner/PartnerSurfaceGuide.tsx");
    expect(src).not.toMatch(/href=\{`[^`]*\$\{/);
  });
});

/* ── 8b · CONTROL 1: THE DUPLICATION THE OWNER SAW, REPRODUCED ─────────────── */

const CLIENTS = [
  { companyId: "co_beta", companyName: "Beta Robotics" },
  { companyId: "co_alpha", companyName: "Alpha Health" },
];
const PORTFOLIO = [
  { companyId: "co_beta", companyName: "Beta Robotics" }, // on BOTH lists — normal
  { companyId: "co_gamma", companyName: null }, // no name joined in
  { companyId: "  ", companyName: "unusable id" }, // must be dropped, not repaired
];

describe("WC · 8b CONTROL 1 — naive concatenation really does duplicate a company", () => {
  it("D1 CONTROL: the naive list offers the same company twice", () => {
    const naive = [...CLIENTS, ...PORTFOLIO];
    const betas = naive.filter((r) => r.companyId === "co_beta");
    expect(betas.length, "control is broken: the two lists no longer overlap").toBe(2);
  });

  it("D2 FIX: the merge offers it exactly once, and records that it is on both", () => {
    const merged = mergeTargetCompanyChoices(CLIENTS, PORTFOLIO);
    const beta = merged.filter((c) => c.companyId === "co_beta");
    expect(beta.length).toBe(1);
    expect(beta[0].onClients).toBe(true);
    expect(beta[0].onPortfolio).toBe(true);
  });

  it("D3 an unusable company id is DROPPED, never repaired into an option", () => {
    const merged = mergeTargetCompanyChoices(CLIENTS, PORTFOLIO);
    expect(merged.some((c) => c.companyId.trim() === "")).toBe(false);
    expect(merged.length).toBe(3); // alpha, beta, gamma — asserted as `=== n`
  });

  it("D4 ordering is by name with unnamed last, and does not depend on arrival order", () => {
    const a = mergeTargetCompanyChoices(CLIENTS, PORTFOLIO).map((c) => c.companyId);
    const b = mergeTargetCompanyChoices(PORTFOLIO, CLIENTS).map((c) => c.companyId);
    expect(a).toEqual(["co_alpha", "co_beta", "co_gamma"]);
    expect(a).toEqual(b);
  });

  it("D5 a company with no name says so IN WORDS — it never prints a bare id as a name", () => {
    const gamma = mergeTargetCompanyChoices(CLIENTS, PORTFOLIO).find((c) => c.companyId === "co_gamma")!;
    expect(gamma.companyName).toBeNull();
    const label = targetCompanyOptionLabel(gamma);
    expect(label).toContain(TARGET_COMPANY_UNNAMED_LABEL);
    expect(label).toContain("co_gamma"); // the code is still shown, not hidden
  });

  it("D6 a real name is never overwritten by a null from the other list", () => {
    const merged = mergeTargetCompanyChoices(
      [{ companyId: "co_x", companyName: "Real Name" }],
      [{ companyId: "co_x", companyName: null }],
    );
    expect(merged.length).toBe(1);
    expect(merged[0].companyName).toBe("Real Name");
  });

  it("D7 both empty and both absent yield an empty list, never a fabricated row", () => {
    expect(mergeTargetCompanyChoices([], [])).toEqual([]);
    expect(mergeTargetCompanyChoices(undefined, null)).toEqual([]);
  });
});

/* ── 8b · CONTROL 2: THE SILENT RETARGET, IN THE REAL DOM ──────────────────── */

describe("WC · 8b CONTROL 2 — the naive dropdown silently retargets the SPV", () => {
  // A company the partner knows only through a PIPELINE DEAL. The server accepts
  // it (proof 4 of six in partnerCompanyLinkGate) and neither of the two lists
  // this picker reads contains it. This is the value the naive dropdown loses.
  const PIPELINE_ONLY = "co_from_pipeline";
  const ids = mergeTargetCompanyChoices(CLIENTS, PORTFOLIO).map((c) => c.companyId);

  it("E1 CONTROL: with options from the two lists only, the DOM reports a DIFFERENT company", () => {
    render(
      <select data-testid="naive" value={PIPELINE_ONLY} onChange={() => {}}>
        {ids.map((id) => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>,
    );
    const el = screen.getByTestId("naive") as HTMLSelectElement;
    expect(ids).not.toContain(PIPELINE_ONLY); // precondition, asserted FIRST
    expect(ids.length).toBeGreaterThan(0); // and the option set is non-empty
    expect(el.value, "control is broken: the naive select no longer loses the value").not.toBe(
      PIPELINE_ONLY,
    );
    expect(el.value).toBe(ids[0]); // it silently became the FIRST company
  });

  it("E2 FIX: through canonicalSelectOptions the DOM reports the company unchanged", () => {
    const opts = canonicalSelectOptions(PIPELINE_ONLY, ids, {
      notSpecifiedLabel: "No target company",
      offListSuffix: TARGET_COMPANY_OFF_LIST_SUFFIX,
    });
    render(
      <select data-testid="fixed" value={PIPELINE_ONLY} onChange={() => {}}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>,
    );
    expect((screen.getByTestId("fixed") as HTMLSelectElement).value).toBe(PIPELINE_ONLY);
  });

  it("E3 the off-list option is MARKED, and its wording is about these lists — not 'not standard'", () => {
    const opts = canonicalSelectOptions(PIPELINE_ONLY, ids, {
      offListSuffix: TARGET_COMPANY_OFF_LIST_SUFFIX,
    });
    const marked = opts.find((o) => o.value === PIPELINE_ONLY)!;
    expect(marked.label).toContain(TARGET_COMPANY_OFF_LIST_SUFFIX);
    expect(TARGET_COMPANY_OFF_LIST_SUFFIX).toContain("Clients or Portfolio");
    // A pipeline-only company IS a standard Capavate company. Saying otherwise
    // would be untrue, which is why this suffix is not the generic one.
    expect(TARGET_COMPANY_OFF_LIST_SUFFIX).not.toContain("standard list");
  });

  it("E4 blank stays expressible — attribution is fenced, never made mandatory", () => {
    const opts = canonicalSelectOptions("", ids, { notSpecifiedLabel: "No target company" });
    expect(opts[0]).toEqual({ value: "", label: "No target company" });
  });
});

/* ── 8b · THE HINT IS TRUE IN EVERY BRANCH, AND STATES A RULE NOT A COUNT ──── */

describe("WC · 8b — the sentence under the dropdown is true in all four states", () => {
  const S = {
    loading: targetCompanyPickerHint({ isLoading: true, isError: false, choiceCount: 0 }),
    error: targetCompanyPickerHint({ isLoading: false, isError: true, choiceCount: 0 }),
    empty: targetCompanyPickerHint({ isLoading: false, isError: false, choiceCount: 0 }),
    loaded: targetCompanyPickerHint({ isLoading: false, isError: false, choiceCount: 2 }),
  };

  it("F1 all four states say something DIFFERENT — none collapses into another", () => {
    const values = Object.values(S);
    expect(new Set(values).size).toBe(4);
  });

  it("F2 a failed read says it failed — it never reads as 'you have no companies'", () => {
    expect(S.error).toContain("could not be loaded");
    expect(S.error).not.toContain("No companies are on");
    expect(S.empty).toContain("No companies are on");
    expect(S.empty).not.toContain("could not be loaded");
  });

  it("F3 loading is not presented as an answer", () => {
    expect(S.loading).toContain("Loading");
    expect(S.loading).not.toContain("No companies are on");
  });

  it("F4 no branch states a COUNT — a count is false the moment the data changes", () => {
    for (const [k, v] of Object.entries(S)) {
      expect(v, `${k} must not contain a digit`).not.toMatch(/[0-9]/);
    }
  });

  it("F5 every branch points at the escape hatch, because every branch may need it", () => {
    for (const [k, v] of Object.entries(S)) {
      expect(v.toLowerCase(), `${k} must name the box below`).toContain("box below");
    }
  });

  it("F6 the loaded branch names Pipeline as the case the dropdown cannot cover", () => {
    expect(S.loaded).toContain("Pipeline");
  });
});

/* ── 8b · WHAT THE WIZARD MUST STILL DO, AND WHAT IT MUST NOT ─────────────── */

describe("WC · 8b — the free-text field and the submit contract are untouched", () => {
  const src = readSrc("client/src/pages/partner/PartnerSpvEngine.tsx");

  it("G1 the original free-text input SURVIVES, with its wording unchanged (R195.5)", () => {
    expect(src).toContain('data-testid="spv-w-target-company"');
    expect(src).toContain('placeholder="Paste the company\'s reference code from its Capavate page"');
  });

  it("G2 the dropdown is a SIBLING of it, not a replacement", () => {
    const sel = src.indexOf('data-testid="spv-w-target-company-select"');
    const inp = src.indexOf('data-testid="spv-w-target-company"');
    expect(sel).toBeGreaterThan(-1);
    expect(inp).toBeGreaterThan(-1);
    expect(sel).not.toBe(inp);
  });

  it("G3 both controls write the SAME state, so they cannot disagree about the answer", () => {
    const writes = [...src.matchAll(/setW\(\{ \.\.\.w, targetCompanyId: e\.target\.value \}\)/g)];
    expect(writes.length).toBe(2); // the select and the input, and nothing else
  });

  it("G4 the submit still sends a trimmed value or NULL — never an empty string", () => {
    expect(src).toContain("targetCompanyId: w.targetCompanyId.trim() || null");
  });

  it("G5 it reads the two REAL endpoints, and neither is a hardcoded list", () => {
    expect(src).toContain('queryKey: ["/api/partner/me/clients"]');
    expect(src).toContain('queryKey: ["/api/partner/me/portfolio"]');
  });

  it("G6 the SPV LAUNCH GATE is not wired by this wave", () => {
    // Wiring it has been done and reverted five times; it refuses every create.
    expect(src).not.toContain("getLaunchGateMode(");
  });

  it("G7 this wave adds NO silent currency default anywhere it touched", () => {
    // R262. `(x.currency || "USD")` is a silent conversion by another name.
    for (const f of [
      "client/src/lib/partner/targetCompanyOptions.ts",
      "client/src/components/partner/PartnerSurfaceGuide.tsx",
      "client/src/pages/partner/PartnerPortfolio.tsx",
      "client/src/pages/partner/PartnerClients.tsx",
      "client/src/pages/partner/PartnerAddPortfolioCompany.tsx",
    ]) {
      expect(readSrc(f), `${f} must not introduce a USD fallback`).not.toMatch(/\|\|\s*"USD"/);
    }
  });
});

/* ── THE SERVER-SIDE PREMISE THIS WHOLE ITEM RESTS ON ─────────────────────── */

describe("WC · 8b — the gate that makes the offered options safe genuinely exists", () => {
  it("H1 the six-proof predicate is real, and proofs 1 and 2 are the two lists offered", () => {
    const gate = readSrc("server/lib/partnerCompanyLinkGate.ts");
    expect(gate).toContain("export function partnerHasCompanyRelationship");
    expect(gate).toContain("getPortfolioCompany(partnerId, companyId)"); // proof 1
    expect(gate).toContain("partnerAttributionStore.listByPartner(partnerId)"); // proof 2
    // Proof 4 is the pipeline deal the dropdown CANNOT list. Its existence is why
    // the free-text field is required rather than merely tolerated.
    expect(gate).toContain("partnerPipelineStore.listByPartner(partnerId)");
  });

  it("H2 the endpoint the wizard posts to actually applies that gate", () => {
    const routes = readSrc("server/spvEngineRoutes.ts");
    expect(routes).toContain("partnerMayAttributeSpvToCompany(ctx.partnerId, createBody.targetCompanyId)");
  });

  it("H3 the four surfaces read four DIFFERENT stores — the no-overlap finding", () => {
    // The owner asked whether these sections overlap. They do not share a store.
    const r = readSrc("server/partnerRoutes.ts");
    expect(r).toContain("partnerAttributionStore"); // Clients
    expect(r).toContain("partnerPipelineStore"); // Pipeline
    expect(r).toContain("listPortfolioCompanies"); // Portfolio
    expect(readSrc("server/spvEngineRoutes.ts")).toContain("spvEngineStore"); // SPVs
  });
});
