/**
 * WAVE 174 · R142 / R144.3 · R137.1 — RENDERED-DOM PROOF OF THE TAX STATEMENT.
 *
 * R137.1: "an LP-facing claim is only verified when the MOUNTED component is
 * verified — a passing store test is not evidence that a user sees anything."
 * The shared-model test next door proves the TABLE is right. It cannot prove an
 * LP sees it, and the defect this wave fixes was precisely that the platform's
 * jurisdiction model was already correct while the LP-facing screens ignored it.
 *
 * So every assertion below reads TEXT OUT OF THE DOM of a mounted component.
 *
 * ── THE FOUR CLAIMS, EACH PROVEN IN BOTH DIRECTIONS ─────────────────────────
 *  1. A HONG KONG vehicle does NOT say "Schedule K-1"  → group B
 *  2. A DELAWARE vehicle DOES say "Schedule K-1"       → group A
 *  3. A CANADIAN vehicle says "T5013"                  → group C
 *  4. An UNCONFIGURED jurisdiction says "Not on record"→ group D
 *
 * ANTI-VACUITY IS THE WHOLE DESIGN. "Hong Kong does not say K-1" is passed by a
 * component that renders nothing at all, and by a component that crashed. Every
 * negative assertion is therefore paired with a POSITIVE one on the same mounted
 * screen: the Hong Kong card must be PRESENT, must be identified as Hong Kong,
 * and must carry the refusal — while a Delaware card mounted from the same code
 * path names the K-1. Group E goes further and renders all sixteen jurisdictions
 * through one loop, so a jurisdiction added later without a tax entry cannot
 * quietly render a blank.
 *
 * Group F mounts the REAL `LpPositions` list against the REAL query hook (only
 * the HTTP transport is a fixture), proving the note actually reaches the LP's
 * portfolio surface and is driven by the jurisdiction ON THE PAYLOAD — not by
 * anything hardcoded in a component.
 *
 * Group G is the regression fence for `PortfolioCompanyOverview`: the original
 * "Download 1099 / K-1 package" literal must STILL be on screen byte-verbatim
 * (R143.1 — replacing it is a bare copy drop that `guard` does not catch), and
 * the new clarifier must be on screen beside it.
 *
 * Assertions target the EXPORTED copy constants, never retyped strings, so a
 * copy edit cannot make an assertion silently stop matching and pass anyway.
 * The two form names ARE retyped deliberately: "Schedule K-1" and "T5013" are
 * the owner's own words and the test must fail if they ever change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LpTaxDocumentNote } from "../LpTaxDocumentNote";
import { LpPositions } from "../LpPositions";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_LABELS,
  SPV_JURISDICTION_TAX_DOCUMENT,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD,
  SPV_TAX_DOCUMENT_NOT_ON_RECORD_NOTICE,
  SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE,
  /* WAVE 175 — the established-absence copy, for the blocks superseded below. */
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
  SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE,
  type SpvJurisdiction,
} from "@shared/spvEngine";

/* The two US federal form names that must never appear for a non-US vehicle. */
const US_FORM_STRINGS = ["Schedule K-1", "K-1", "1099", "Form 1065"];

/* ── transport fixture for the LpPositions list (group F) ─────────────────── */
const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const VEHICLE = (id: string, jurisdiction: string) => ({
  spvId: id,
  spvName: `Vehicle ${id}`,
  jurisdiction,
  /* JPY has exponent 0 — a `/100` anywhere in the money path would be visible.
     Money is not what this wave changes, but the fence stays armed. */
  currency: "JPY",
  positionType: "spv_lp_interest" as const,
  commitmentMinor: 5_000_000,
  calledCapitalMinor: 5_000_000,
  distributionsReceivedMinor: 0,
  ownershipFraction: 0.05,
  capitalAccountMinor: 5_000_000,
  navTotalMinor: 100_000_000,
  navShareMinor: 5_000_000,
  navAsOfDate: "2026-06-30",
  navBadge: "fresh",
  navRefusalCopy: null,
  hasSideLetter: false,
  refusalCopy: null,
});

function mountNote(jurisdiction: string | null | undefined) {
  return render(<LpTaxDocumentNote jurisdiction={jurisdiction} />);
}

function mountList(positions: unknown[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LpPositions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · A — a DELAWARE vehicle DOES say Schedule K-1", () => {
  it("A1 the mounted note names the Schedule K-1 in the DOM", async () => {
    mountNote("delaware");
    /* The form name is a rendered text node, not an attribute. */
    expect(screen.getByTestId("investor-lp-tax-document-name").textContent).toBe("Schedule K-1");
    expect(screen.getByTestId("investor-lp-tax-document").textContent).toContain("Schedule K-1");
  });

  it("A2 it does NOT render the refusal, and names the issuing authority", () => {
    mountNote("delaware");
    expect(screen.queryByTestId("investor-lp-tax-document-not-on-record")).toBeNull();
    expect(screen.queryByTestId("investor-lp-tax-document-not-on-record-note")).toBeNull();
    expect(screen.getByTestId("investor-lp-tax-document-authority").textContent).toContain(
      "US Internal Revenue Service",
    );
  });

  it("A3 the jurisdiction is stated on screen as a HUMAN label, not the raw enum value", () => {
    mountNote("delaware");
    const line = screen.getByTestId("investor-lp-tax-document-jurisdiction").textContent ?? "";
    expect(line).toContain(SPV_JURISDICTION_LABELS.delaware);
    /* A raw persisted value on screen is its own defect class. */
    expect(line).not.toContain("delaware");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · B — a HONG KONG vehicle does NOT say Schedule K-1", () => {
  it("B1 ANTI-VACUITY FIRST: the Hong Kong note is genuinely on screen", () => {
    mountNote("hong_kong");
    /* If this component rendered nothing, every negative below would pass for
       the wrong reason. Prove it rendered, and prove it rendered HONG KONG. */
    expect(screen.getByTestId("investor-lp-tax-document")).toBeTruthy();
    expect(screen.getByTestId("investor-lp-tax-document-jurisdiction").textContent).toContain(
      SPV_JURISDICTION_LABELS.hong_kong,
    );
  });

  it("B2 NO US form name appears anywhere in the rendered subtree", () => {
    mountNote("hong_kong");
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    expect(dom.length).toBeGreaterThan(0);
    for (const s of US_FORM_STRINGS) {
      expect(dom, `a Hong Kong vehicle rendered the US form string "${s}"`).not.toContain(s);
    }
  });

  it("B3 it says 'Not on record' instead, and explains why in plain language", () => {
    /* ── SUPERSEDED BY WAVE 175, ON RESEARCH (R144.4 stale-test precedent) ────
       Wave 174 rendered "Not on record" for Hong Kong because no Hong Kong answer
       was derivable from anything on the platform. It now IS derivable, and it is
       a positive one: Hong Kong issues no investor tax slip BECAUSE it taxes the
       partnership itself, in the partnership's own name. "Not on record" would
       now describe researched knowledge as a gap in Capavate's data, which is its
       own species of dishonesty. So the headline is the established absence.

       THE CLAIM THIS TEST EXISTS FOR IS UNCHANGED and is still asserted below in
       full: a Hong Kong vehicle names NO form, shows no empty form element, and
       explains itself in plain language. */
    mountNote("hong_kong");
    expect(screen.getByTestId("investor-lp-tax-document-no-standard-form").textContent).toBe(
      SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
    );
    /* the plain-language explanation, now the sourced one */
    expect(
      (screen.getByTestId("investor-lp-tax-document-no-standard-form-note").textContent ?? "").length,
    ).toBeGreaterThan(80);
    expect(screen.getByTestId("investor-lp-tax-document-no-standard-form-notice").textContent).toBe(
      SPV_TAX_DOCUMENT_NO_STANDARD_FORM_NOTICE,
    );
    /* and it is explicitly NOT the "we do not hold this" refusal, which is a
       different sentence for a different situation */
    expect(screen.queryByTestId("investor-lp-tax-document-not-on-record")).toBeNull();
    /* No form name element exists at all — not an empty one. */
    expect(screen.queryByTestId("investor-lp-tax-document-name")).toBeNull();
  });

  it("B4 SINGAPORE behaves identically — the second 'maybe' jurisdiction is not guessed either", () => {
    /* SUPERSEDED HEADLINE, IDENTICAL PROTECTION (wave 175): Singapore now shows
       the established absence plus the LEGAL-FORM CONDITIONAL, because a limited
       partnership is transparent while a variable capital company is taxed as a
       company and Capavate does not record which this vehicle is. Still no
       guessed form, and still no US form. */
    mountNote("singapore");
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    expect(dom).toContain(SPV_JURISDICTION_LABELS.singapore);
    expect(dom).toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
    expect(dom).toContain("Depends on this vehicle's legal form");
    expect(screen.queryByTestId("investor-lp-tax-document-name")).toBeNull();
    for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · C — a CANADIAN vehicle says T5013", () => {
  it("C1 the mounted note names the T5013 in the DOM", () => {
    mountNote("canadian_lp");
    expect(screen.getByTestId("investor-lp-tax-document-name").textContent).toBe("T5013");
  });

  it("C2 and does NOT name a US form or render the refusal", () => {
    mountNote("canadian_lp");
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
    expect(screen.queryByTestId("investor-lp-tax-document-not-on-record")).toBeNull();
    expect(screen.getByTestId("investor-lp-tax-document-authority").textContent).toContain(
      "Canada Revenue Agency",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · D — an UNCONFIGURED jurisdiction says 'Not on record'", () => {
  /* Four flavours of "not configured": the explicit unknown, two real places
     with no confirmed form, and input the resolver cannot place at all. */
  /* ── SUPERSEDED IN PART BY WAVE 175 ──────────────────────────────────
     Cayman and the BVI have moved out of this group. They were never really
     "unconfigured": they are tax-neutral jurisdictions with no direct taxes and
     no revenue administration, which is a RESEARCHED, CITED answer rather than
     missing data. They are asserted in D1b below and by wave 175's own tests.
     What remains here is the genuine unknown — the explicit `other` and input
     the resolver cannot place — which is exactly the case "Not on record" is
     for. */
  const CASES: Array<[string, string | null | undefined]> = [
    ["the explicit unknown", "other"],
    ["an unrecognised string", "atlantis"],
    ["an empty value", ""],
    ["a missing value", null],
  ];

  it.each(CASES)("D1 %s renders 'Not on record' and never a defaulted K-1", (_name, input) => {
    mountNote(input);
    expect(screen.getByTestId("investor-lp-tax-document-not-on-record").textContent).toBe(
      SPV_TAX_DOCUMENT_NOT_ON_RECORD,
    );
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
  });

  it.each(["cayman", "bvi"])(
    "D1b %s renders a RESEARCHED absence, not a refusal, and still never a K-1",
    (code) => {
      mountNote(code);
      /* the established absence, with its reason and its citation on screen */
      expect(screen.getByTestId("investor-lp-tax-document-no-standard-form").textContent).toBe(
        SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL,
      );
      expect(screen.getByTestId("investor-lp-tax-document-entity-treatment").textContent).toContain(
        "Tax-neutral",
      );
      expect(screen.queryByTestId("investor-lp-tax-document-not-on-record")).toBeNull();
      /* the protection this test was written for is unchanged */
      const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
      expect(screen.queryByTestId("investor-lp-tax-document-name")).toBeNull();
      for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
    },
  );

  it("D2 the refusal is never a blank, a dash or a zero", () => {
    mountNote("other");
    const shown = screen.getByTestId("investor-lp-tax-document-not-on-record").textContent ?? "";
    expect(shown.trim()).not.toBe("");
    expect(shown.trim()).not.toBe("-");
    expect(shown.trim()).not.toBe("—");
    expect(shown.trim()).not.toBe("0");
    expect(shown).toBe("Not on record");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · E — EXHAUSTIVE render: every one of the sixteen says something", () => {
  it.each([...SPV_JURISDICTIONS])("E1 %s renders a non-empty, correct statement", (code) => {
    mountNote(code);
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    /* Never blank — silence is one of the two wrong answers R142.2.3 names. */
    expect(dom.trim().length).toBeGreaterThan(0);
    /* The human label is always stated, so the LP knows which vehicle's rule
       is being described. */
    expect(dom).toContain(SPV_JURISDICTION_LABELS[code as SpvJurisdiction]);

    const expected = SPV_JURISDICTION_TAX_DOCUMENT[code as SpvJurisdiction];
    if (expected.onRecord) {
      expect(dom).toContain(expected.documentName as string);
    } else if (expected.recordStatus === "no_standard_form") {
      /* WAVE 175 — the DOM still agrees with the table, and the table now has a
         THIRD answer: an established, sourced absence. A new jurisdiction added
         without a tax entry still cannot render a blank or somebody else's form,
         which is the property this test exists to hold. */
      expect(dom).toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
      expect(dom).toContain(expected.investorReceivesInstead as string);
      for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
    } else {
      /* The DOM agrees with the table — a new jurisdiction added without a tax
         entry cannot render a blank or somebody else's form. */
      expect(dom).toContain(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
      for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
    }
  });

  it("E2 the informational, not-advice line is on screen for ALL sixteen", () => {
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      mountNote(code);
      expect(
        screen.getByTestId("investor-lp-tax-document-informational").textContent,
        `no informational notice rendered for "${code}"`,
      ).toBe(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE);
      /* R142.2.4 — plainly informational, and plainly NOT advice. */
      expect(SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE.toLowerCase()).toContain("not tax advice");
    }
  });

  it("E3 no rendered statement contains a money figure or a percentage", () => {
    for (const code of SPV_JURISDICTIONS) {
      cleanup();
      mountNote(code);
      const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
      expect(dom).not.toMatch(/[$£€¥]/);
      expect(dom).not.toMatch(/\d+\s*%/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · F — it reaches the REAL LP portfolio surface, driven by the payload", () => {
  it("F1 two vehicles in ONE list render DIFFERENT tax documents from their own jurisdictions", async () => {
    /* This is the claim that matters: the statement follows the DATA on each
       vehicle, so it cannot be a component-level constant. */
    apiRequestMock.mockResolvedValue(
      jsonResponse({
        positions: [VEHICLE("spv_us", "delaware"), VEHICLE("spv_hk", "hong_kong")],
        collectiveScope: "none",
      }),
    );
    mountList([]);

    await waitFor(() => {
      expect(screen.getAllByTestId("investor-lp-position-card").length).toBe(2);
    });

    const notes = screen.getAllByTestId("investor-lp-tax-document");
    expect(notes.length).toBe(2);
    const texts = notes.map((n) => n.textContent ?? "");

    const us = texts.find((t) => t.includes(SPV_JURISDICTION_LABELS.delaware));
    const hk = texts.find((t) => t.includes(SPV_JURISDICTION_LABELS.hong_kong));
    expect(us, "no Delaware tax note on the LP portfolio surface").toBeTruthy();
    expect(hk, "no Hong Kong tax note on the LP portfolio surface").toBeTruthy();

    expect(us as string).toContain("Schedule K-1");
    /* SUPERSEDED HEADLINE (wave 175): the Hong Kong card on the real LP surface
       now carries the established absence rather than the refusal. The CLAIM is
       unchanged and is what the following lines assert — two vehicles in one
       list render DIFFERENT statements, each driven by its own payload. */
    expect(hk as string).toContain(SPV_TAX_DOCUMENT_NO_STANDARD_FORM_LABEL);
    expect(hk as string).not.toContain(SPV_TAX_DOCUMENT_NOT_ON_RECORD);
    expect(us as string).not.toBe(hk as string);
    for (const s of US_FORM_STRINGS) {
      expect(hk as string, `the Hong Kong card on the real LP screen showed "${s}"`).not.toContain(s);
    }
  });

  it("F2 a Canadian vehicle on the real surface shows T5013 and no K-1", async () => {
    apiRequestMock.mockResolvedValue(
      jsonResponse({ positions: [VEHICLE("spv_ca", "canadian_lp")], collectiveScope: "none" }),
    );
    mountList([]);
    await waitFor(() => {
      expect(screen.getByTestId("investor-lp-tax-document")).toBeTruthy();
    });
    const dom = screen.getByTestId("investor-lp-tax-document").textContent ?? "";
    expect(dom).toContain("T5013");
    for (const s of US_FORM_STRINGS) expect(dom).not.toContain(s);
  });

  it("F3 the pre-existing LP figures are UNCHANGED — this wave added a line, it did not move money", async () => {
    apiRequestMock.mockResolvedValue(
      jsonResponse({ positions: [VEHICLE("spv_us", "delaware")], collectiveScope: "none" }),
    );
    mountList([]);
    await waitFor(() => {
      expect(screen.getByTestId("investor-lp-commitment")).toBeTruthy();
    });
    /* JPY, exponent 0: a stray `/100` would render 50,000 here. */
    expect(screen.getByTestId("investor-lp-commitment").textContent).toContain("5,000,000");
    expect(screen.getByTestId("investor-lp-position-type-badge").textContent).toContain(
      "Vehicle interest (LP)",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 174 · G — the '1099 / K-1' label: literal KEPT, error FIXED (R143.1)", () => {
  /* The five-builder trap: replacing this text node is a BARE copy drop that
     `guard` does not catch and only `drop:restyle` sees. So the fence is
     asserted on the SOURCE text node as well as on the clarifier, because the
     tax card in that file is behind a server `available` flag and a component
     that never renders proves nothing either way. */
  const SRC = "client/src/components/investor/PortfolioCompanyOverview.tsx";

  it("G1 the original literal is still present BYTE-VERBATIM as a static text node", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(SRC, "utf8");
    /* Exactly once, and as its own JSX text node on its own line. */
    const occurrences = src.split("Download 1099 / K-1 package").length - 1;
    expect(occurrences, "the original literal was replaced, renamed or dropped").toBe(1);
    expect(src).toMatch(/\n\s*Download 1099 \/ K-1 package\n/);
  });

  it("G2 the jurisdictional clarifier is rendered as a STATIC SIBLING, not a replacement", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(SRC, "utf8");
    /* The clarifier is a sibling of the <a>, inside the same branch. */
    expect(src).toContain("data-testid=\"text-co-tax-us-federal-clarifier\"");
    expect(src).toContain("SPV_TAX_DOCUMENT_US_FEDERAL_PACKAGE_CLARIFIER");
    expect(src).toContain("SPV_TAX_DOCUMENT_INFORMATIONAL_NOTICE");
    /* And the literal is still INSIDE the anchor, above the clarifier. */
    const anchorIdx = src.indexOf("Download 1099 / K-1 package");
    const clarifierIdx = src.indexOf("text-co-tax-us-federal-clarifier");
    expect(anchorIdx).toBeGreaterThan(0);
    expect(clarifierIdx).toBeGreaterThan(anchorIdx);
  });

  it("G3 no allow-list or suppression was used to get past the gate", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(SRC, "utf8");
    for (const escape of ["restyle-allow", "restyle-ignore", "drop-allow", "guard-ignore", "eslint-disable"]) {
      expect(src.toLowerCase(), `an escape hatch (${escape}) was used instead of keeping the literal`).not.toContain(
        escape,
      );
    }
  });
});
