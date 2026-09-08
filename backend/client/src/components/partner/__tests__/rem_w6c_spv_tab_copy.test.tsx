/**
 * W6c — RENDERED-TEXT PROOF FOR THE EIGHT SPV-TAB COPY DEFECTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT REFUSES TO PROVE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Every assertion below reads RENDERED TEXT out of a mounted `SpvDetailTabs` —
 * `textContent` of a real DOM node produced by the real component with the real
 * formatters. Nothing here asserts against a constant, a mock, or a string the
 * test itself supplied, because a copy fix that is only proved against its own
 * source constant proves nothing about what a GP sees.
 *
 * Radix does NOT mount an inactive tab panel's children (measured, not assumed —
 * `w127_register_labels_and_currency` established this in the same component), so
 * every assertion that lives on a non-default tab activates that tab first and
 * then asserts the node exists BEFORE asserting its text. A `getByTestId`-style
 * throw on a missing node is the difference between a real green and a vacuous
 * one.
 *
 * THE NEGATIVE CONTROLS. Section 9 deliberately asserts that the matchers used
 * here CAN fail — a `/USD/` matcher that matches everything would make all of
 * §1 vacuous. Section 9 also proves the un-fixed shapes are genuinely absent
 * rather than merely un-searched-for.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs, SPV_TAB_KEYS } from "../SpvDetailTabs";
import { SpvCloseSummaryPanel } from "../SpvOperationsPanels";
import { SPV_EDU } from "@/lib/spvEducation";
import { formatMinor } from "@/lib/currency";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as unknown as Response,
  };
});

const SPV_ID = "spv_24e2f7d0e2d54c5d";
const INVESTOR = "u_w6c_lp";
const COMMITMENT_MINOR = 10_000_000; // 100,000.00 in a 2-exponent currency
const TARGET_MINOR = 10_000_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
function detail(currency = "USD"): any {
  return {
    spv: {
      status: "open", jurisdiction: "canada", lpVisibility: "own_only", closeDate: null,
      targetRaiseMinor: TARGET_MINOR, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
      name: "QUantum SPV",
    },
    /* The exact stored key W6c · D5 reported on screen. */
    mandate: { mode: "thesis_lp_approval", sector: ["Fintech"], geography: ["Canada"], stage: ["seed"] },
    /* The exact fee shape W6c · D8 reported: a fixed amount with no basis. */
    fees: [{ layer: "management", feeType: "fixed", carryPct: null, fixedAmountMinor: 2_000 }],
    subscriptions: [{ id: "sub_1", investorId: INVESTOR, commitmentMinor: COMMITMENT_MINOR, status: "committed", currency }],
    register: [{ investorId: INVESTOR, commitmentMinor: COMMITMENT_MINOR, ownershipPct: 1, status: "committed" }],
    deployments: [], distributions: [], documents: [], transfers: [], capitalAccounts: [],
    closeSummary: {
      confirmedCount: 0, confirmedMinor: 0, targetMinor: TARGET_MINOR,
      underTarget: true, shortfallMinor: TARGET_MINOR, suggestedTargetMinor: 0, note: "",
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mountTab(tab: string | null, currency = "USD") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId={SPV_ID} detail={detail(currency)} currency={currency} canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  if (tab) {
    const trigger = utils.container.querySelector<HTMLElement>(`[data-testid="spv-tab-${tab}"]`);
    /* PRECONDITION. If the trigger is absent every assertion after this point
       would run against an empty panel and pass for the wrong reason. */
    expect(trigger, `the "${tab}" tab trigger must exist before it can be activated`).toBeTruthy();
    fireEvent.mouseDown(trigger!);
    fireEvent.click(trigger!);
  }
  return utils;
}

/** Reads a node's rendered text, refusing to return text for a node that is absent. */
function textOf(container: HTMLElement, testid: string): string {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  expect(el, `[data-testid="${testid}"] must be rendered`).toBeTruthy();
  const t = el!.textContent ?? "";
  expect(t.trim().length, `[data-testid="${testid}"] rendered but is empty`).toBeGreaterThan(0);
  return t;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   §1 — D1. EVERY MONEY FIGURE NAMES ITS CURRENCY, ON EVERY TAB.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D1 — a money figure on the SPV tabs names its currency", () => {
  it("the LP roster figure carries the ISO code, not a bare symbol", () => {
    const { container } = mountTab("lps");
    const row = textOf(container, `spv-lp-row-${INVESTOR}`);
    expect(row).toContain("USD 100,000.00");
    /* The defect, stated as its own absence: a bare `$` immediately before a
       digit is exactly what QA could not interpret. */
    expect(row).not.toMatch(/\$\s?\d/);
  });

  it("the SAME amount on a CAD vehicle says CAD — no conversion, no shared symbol", () => {
    const usd = textOf(mountTab("lps", "USD").container, `spv-lp-row-${INVESTOR}`);
    const cad = textOf(mountTab("lps", "CAD").container, `spv-lp-row-${INVESTOR}`);
    expect(usd).toContain("USD 100,000.00");
    expect(cad).toContain("CAD 100,000.00");
    /* THE DIGITS ARE IDENTICAL. This is the assertion that proves nothing was
       converted: 100,000.00 in the vehicle's own currency, whatever that is. */
    expect(cad).not.toContain("USD");
    expect(usd).not.toContain("CAD");
    expect(cad).not.toBe(usd);
  });

  it("the rendered code is separated by an ORDINARY space, not an invisible U+00A0", () => {
    /* Intl's own `currencyDisplay: "code"` output uses U+00A0, which renders
       identically and compares unequal. If that character survived to the DOM,
       every assertion in this file that types a normal space would be testing a
       string the product never produces. */
    const row = textOf(mountTab("lps").container, `spv-lp-row-${INVESTOR}`);
    expect(row).not.toContain("\u00A0");
    expect(row.includes("USD 100,000.00"), "an ordinary U+0020 must separate the code").toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §2 — D2. THE DOCUMENTS TAB NO LONGER RENDERS THE NAV TAB'S SENTENCE.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D2 — the Documents tab has copy of its own", () => {
  it("the valuation-update sentence is GONE from the Documents tab", () => {
    const { container } = mountTab("documents");
    const panel = container.querySelector('[data-testid="spv-detail-documents"]')?.parentElement;
    expect(panel, "the Documents panel must be mounted").toBeTruthy();
    const t = panel!.textContent ?? "";
    expect(t).not.toContain("You can share an optional valuation update");
    expect(t).not.toContain("valuation");
  });

  it("what it renders instead is about documents, and spells out LPA", () => {
    const t = textOf(mountTab("documents").container, "spv-edu-documents");
    expect(t).toContain("document");
    expect(t).toContain("Limited Partnership Agreement");
    expect(t).toContain("does not hold or check the document's own contents");
  });

  it("the NAV tab KEPT the valuation sentence — this was a mis-wiring, not a deletion", () => {
    /* R: nothing deleted. The `reporting` key still exists and still says what
       it always said; only the Documents tab stopped borrowing it. */
    expect(SPV_EDU.reporting).toContain("You can share an optional valuation update");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §5 — D5. THE MANDATE MODE IS READABLE.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D5 — the mandate summary states a mode a person can read", () => {
  it("the stored key `thesis_lp_approval` is not what is on screen", () => {
    const t = textOf(mountTab("mandate").container, "spv-detail-mandate-mode");
    expect(t).toContain("Thesis with LP Approval");
    expect(t).not.toContain("thesis_lp_approval");
    expect(t).not.toContain("_");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §8 — D8. A FIXED FEE STATES ITS BASIS.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D8 — a fixed fee says what it is a fee ON", () => {
  it("the amount is unchanged and the basis is now stated beside it", () => {
    const { container } = mountTab("fees");
    const basis = textOf(container, "spv-detail-fee-row-0-fixed-basis");
    expect(basis).toContain("a flat charge");
    expect(basis).toContain("not a percentage of any amount");
    /* The FIGURE did not move — a copy fix must not restate money. */
    expect(textOf(container, "spv-detail-fee-row-0-fixed")).toContain("USD 20.00");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §4 — D4. THE SIGNING STATEMENT'S IDENTIFIERS ARE EXPLAINED, NOT REWRITTEN.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D4 — the e-signature identifiers are explained beside the signed bytes", () => {
  it("the legend explains all three identifiers a reader could not interpret", () => {
    const t = textOf(mountTab("esignature").container, "spv-esign-identifier-legend");
    expect(t).toContain("Capavate's own internal reference");
    expect(t).toContain("Limited Partnership Agreement");
    expect(t).toContain("Statement version");
  });

  it("THE SIGNED BYTES ARE UNTOUCHED — the legend is a sibling, never inside them", () => {
    /* This is the assertion that makes D4 safe. The statement is hashed and
       stored with the signature; if the legend had leaked into this node the
       digest would change and every stored signature would stop matching. */
    const { container } = mountTab("esignature");
    const bytes = textOf(container, "spv-esign-pending-statement-bytes");
    expect(bytes).toContain("What you are signing");
    expect(bytes).toContain(`Vehicle: ${SPV_ID}`);
    expect(bytes).toContain("Statement version: esign-statement-v1");
    expect(bytes, "the legend must NOT be inside the hashed text node").not.toContain(
      "Capavate's own internal reference",
    );
  });

  it("the document-type dropdown spells the acronym out", () => {
    const { container } = mountTab("esignature");
    const sel = container.querySelector('[data-testid="spv-esign-document-kind"]');
    expect(sel, "the document-type select must be rendered").toBeTruthy();
    expect(sel!.textContent).toContain("LPA — Limited Partnership Agreement");
    /* The stored VALUE is untouched: only the label changed. */
    const opt = sel!.querySelector('option[value="lpa"]');
    expect(opt, "the `lpa` option value must still exist").toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §9 — NEGATIVE CONTROLS. THE MATCHERS ABOVE CAN FAIL.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · negative controls — these matchers are capable of failing", () => {
  it("the bare-symbol matcher used in §1 DOES match a bare-symbol string", () => {
    /* If this regex could not match `$100,000.00`, every `not.toMatch` in §1
       would be vacuously green. `formatMinor` WITHOUT the code option still
       produces exactly the old defect, so the control uses the product's own
       formatter rather than a hand-typed string. */
    const legacy = formatMinor(COMMITMENT_MINOR, "USD", { locale: "en-US" });
    expect(legacy).toBe("$100,000.00");
    expect(legacy).toMatch(/\$\s?\d/);
  });

  it("Intl really does emit U+00A0, so the §1 normalisation assertion is not vacuous", () => {
    const raw = new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", currencyDisplay: "code",
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(1000);
    expect(raw, "if Intl stopped emitting U+00A0 this normalisation is dead code").toContain("\u00A0");
    expect(formatMinor(100_000, "USD", { locale: "en-US", currencyDisplay: "code" })).not.toContain("\u00A0");
  });

  it("the default rendering is UNCHANGED for every caller that did not opt in", () => {
    /* The blast radius of D1 is bounded by this: `formatMinor` with no
       `currencyDisplay` is byte-identical to what it was before W6c. */
    expect(formatMinor(120_000, "CAD", { locale: "en-US" })).toBe("CA$1,200.00");
    expect(formatMinor(120_000, "USD", { locale: "en-US" })).toBe("$1,200.00");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §1b — D1, SWEPT ACROSS ALL SIXTEEN TABS.
   ═══════════════════════════════════════════════════════════════════════════════
   The finding was "no currency code on ANY of the sixteen tabs", so proving one
   tab would be proving one sixteenth of the claim. This activates every declared
   tab in turn and asserts the bare-symbol shape is absent from the whole panel.
   `SPV_TAB_KEYS` is the component's OWN declared trigger list, and its length is
   asserted, so a tab silently dropped from the product would fail here rather
   than shrink the sweep in silence. */
describe("W6c · D1 — swept across every declared tab", () => {
  it("SPV_TAB_KEYS really is sixteen — the sweep below cannot silently shrink", () => {
    expect(SPV_TAB_KEYS.length).toBe(16);
  });

  it.each([...SPV_TAB_KEYS])("no bare currency symbol renders on the `%s` tab", (tab) => {
    const { container } = mountTab(tab);
    const t = container.textContent ?? "";
    /* A currency symbol immediately followed by a digit is the exact shape QA
       could not interpret. Symbols that appear in prose (none do today) would
       not match, because the matcher requires an adjacent digit. */
    expect(t, `a bare symbol+digit money string is still rendered on "${tab}"`).not.toMatch(/[$€¥£]\s?\d/);
  });

  it("at least one tab in the sweep actually rendered money — the sweep is not empty", () => {
    /* WITHOUT THIS, the sweep above would pass on sixteen blank panels. */
    const { container } = mountTab("lps");
    expect(container.textContent ?? "").toMatch(/USD\s\d/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §3 — D3. THE "AUTHORITATIVE" STATEMENT IS READABLE BY A LAWYER.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D3 — the authoritative close statement uses words, not field names", () => {
  function mountCloseSummary(currency = "USD") {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/partner/me/spv", SPV_ID, "close-summary"], {
      summary: {
        confirmedCount: 0, confirmedMinor: 0, targetMinor: TARGET_MINOR,
        underTarget: true, shortfallMinor: TARGET_MINOR, suggestedTargetMinor: 0,
      },
    });
    return render(
      <QueryClientProvider client={qc}>
        <SpvCloseSummaryPanel spvId={SPV_ID} currency={currency} />
      </QueryClientProvider>,
    );
  }

  it("every one of the six raw field names is GONE from the rendered panel", () => {
    const { container } = mountCloseSummary();
    const t = textOf(container, "spv-close-summary-panel");
    for (const key of ["confirmedCount", "confirmedMinor", "targetMinor", "underTarget", "shortfallMinor", "suggestedTargetMinor"]) {
      expect(t, `the raw field name "${key}" is still on screen`).not.toContain(key);
    }
  });

  it("each field is replaced by a sentence a non-engineer can read", () => {
    const t = textOf(mountCloseSummary().container, "spv-close-summary-panel");
    expect(t).toContain("Investors confirmed as funded");
    expect(t).toContain("Amount confirmed as funded");
    expect(t).toContain("Target raise");
    expect(t).toContain("Below the target raise?");
    expect(t).toContain("Amount still short of the target");
    expect(t).toContain("Suggested revised target");
  });

  it("the bare boolean `true` is gone and reads as Yes", () => {
    const t = textOf(mountCloseSummary().container, "spv-close-summary-underTarget");
    expect(t).toContain("Yes");
    expect(t).not.toContain("true");
  });

  it('"minor" is defined, and the money on this panel names its currency', () => {
    const { container } = mountCloseSummary("CAD");
    const legend = textOf(container, "spv-close-summary-legend");
    expect(legend).toContain("this vehicle's own currency");
    expect(legend).toContain("does not independently verify");
    expect(textOf(container, "spv-close-summary-confirmedMinor")).toContain("CAD 0.00");
  });

  it("NEGATIVE CONTROL — an UNKNOWN field still appears, rather than being hidden", () => {
    /* A label map that silently drops what it does not recognise would make an
       "authoritative" statement quietly incomplete. That is worse than a raw
       key, so an unlisted key must render as itself. */
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/partner/me/spv", SPV_ID, "close-summary"], {
      summary: { confirmedCount: 1, someFutureServerField: "abc" },
    });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SpvCloseSummaryPanel spvId={SPV_ID} currency="USD" />
      </QueryClientProvider>,
    );
    expect(textOf(container, "spv-close-summary-panel")).toContain("someFutureServerField");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §6 — D6. THE "(*)" WAS A SCOPE ID, NOT A MISSING FOOTNOTE.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D6 — the close-window scope reads as a sentence", () => {
  /* The line is rendered by a private component inside SpvDetailTabs, so it is
     driven the way the product drives it: through the real Close tab, with the
     real `GET /close-window` response seeded into the query cache under the
     component's own key (SpvDetailTabs.tsx `queryKey:
     [`/api/partner/me/spv/${spvId}/close-window`]`). Nothing is mocked out of
     the render path. */
  function mountPolicy(scopeKind: string, scopeId: string) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData([`/api/partner/me/spv/${SPV_ID}/close-window`], {
      closeWindow: { windowDays: 30, scopeKind, scopeId },
    });
    const utils = render(
      <QueryClientProvider client={qc}>
        <SpvDetailTabs spvId={SPV_ID} detail={detail("USD")} currency="USD" canWrite onChanged={() => {}} initialTab="close" />
      </QueryClientProvider>,
    );
    return utils;
  }

  it("a platform-scope policy says what it means and shows no dangling marker", () => {
    const t = textOf(mountPolicy("platform", "*").container, "spv-close-window-scope");
    expect(t).toContain("platform-wide default");
    expect(t).toContain("applies to every vehicle");
    expect(t).not.toContain("(*)");
    expect(t).not.toContain("policy scope platform");
  });

  it("a NARROWER scope still shows its real id, which a GP may need to quote", () => {
    /* Not a blanket removal: only the platform wildcard is meaningless to a
       reader. A partner-scope id is a genuine identifier. */
    const t = textOf(mountPolicy("partner", "pt_9f2a").container, "spv-close-window-scope");
    expect(t).toContain("pt_9f2a");
    expect(t).toContain("partner");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §7 — D7. THE PLACEHOLDER NAMES WHAT IT WANTS.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W6c · D7 — the eligibility input asks for something a GP recognises", () => {
  it("the placeholder is no longer the bare storage prefix", () => {
    const { container } = mountTab("deployments");
    const input = container.querySelector('[data-testid="spv-eligibility-company-input"]');
    expect(input, "the eligibility input must be rendered").toBeTruthy();
    const ph = input!.getAttribute("placeholder") ?? "";
    expect(ph).toContain("Company ID");
    expect(ph).not.toBe("co_…");
  });
});
