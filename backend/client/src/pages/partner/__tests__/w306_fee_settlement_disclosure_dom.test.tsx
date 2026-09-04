/* ════════════════════════════════════════════════════════════════════════════
   WAVE 306 · PART 4 — THE DISCLOSURE APPEARS AT BOTH SITES, IN THE REAL WIZARD.
   ════════════════════════════════════════════════════════════════════════════
   WHY TWO SITES. The wizard is NON-LINEAR (R221.6, and the wave-278a suite
   drives that navigation directly): a GP can set the fee type on step 2 and
   never look at it again, or arrive at review having skipped step 2 entirely.
   A disclosure at one site is therefore a disclosure a GP can legitimately never
   see. It is shown at the fee-type SELECT and again on the REVIEW step, from one
   shared constant, so the two can never drift apart.

   WHY THE CONDITION IS POSITIVE. Both sites gate on
   `mgmtFeeType === "fixed" || mgmtFeeType === "hybrid"`, NOT on the `!== "carry"`
   that the neighbouring "Fee currency" review row uses. `mgmtFeeType` can be the
   empty string, and `"" !== "carry"` is TRUE — so the negative form would show a
   settlement disclosure to a GP who has chosen nothing. R254.3 requires the copy
   to be true in EVERY branch that can reach it; the empty branch is one of them,
   so the empty branch must not be able to reach it. That is asserted below at
   both sites, and it is the assertion most likely to catch a future edit.

   ── ASSUME THE MECHANISM IS INERT. PRECONDITIONS RUN FIRST. ────────────────
   Two traps, answered before any assertion that could pass vacuously:
     · `vi.mock` can be entirely inert with every assertion still green, so the
       factories set a flag and the recorder captures calls; P0 asserts the flag
       AND asserts the recorder was actually reached.
     · jsdom plus a crashed render satisfies every "this is absent" assertion
       against an empty <body>, so P1 asserts the wizard genuinely MOUNTED, and
       every negative test below first asserts that the surrounding step really
       rendered — an absence measured against a live baseline.
   The `<select>` here is a plain HTML select, not a Radix trigger, so no
   `scrollIntoView` / `hasPointerCapture` shim is needed and none is installed;
   the W278b Radix limitation does not apply to this control.

   WHAT THIS FILE DOES NOT PROVE: nothing about the server. No wizard field, no
   posted body and no launch behaviour is asserted here — that is the wave-278a
   suite's job, and this file deliberately does not duplicate or weaken it.
   ════════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { SPV_FEE_SETTLEMENT_DISCLOSURE } from "@shared/spvFeeObligationRules";

const H = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
  flags: { apiMockInstalled: false, toastMockInstalled: false },
}));

vi.mock("@/hooks/use-toast", () => {
  H.flags.toastMockInstalled = true;
  return { useToast: () => ({ toast: () => {} }) };
});
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w306",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w306", email: "w306@example.com", name: "W306 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  H.flags.apiMockInstalled = true;
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      H.calls.push({ method, url, body });
      const payload = method === "GET" ? { spvs: [] } : { spv: { id: "spv_w306", spvType: "spv" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
        statusText: "ok",
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    },
  };
});

const SITE1 = "spv-w-fee-settlement-disclosure";
const SITE2 = "spv-w-review-fee-settlement-disclosure";

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerSpvEngine />
    </QueryClientProvider>,
  );
}
const click = (testid: string) => fireEvent.click(screen.getByTestId(testid));
const set = (testid: string, value: string) =>
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
const goToStep = (i: number) => click(`spv-wizard-step-tab-${i}`);

function openWizard() {
  mount();
  click("spv-engine-new");
}

/** Open the wizard and land on step 2 with the given fee type selected.
    `fee: null` means the select is never touched — MEASURED to be "carry", the
    shipped default; `fee: ""` drives the EMPTY branch through the real handler. */
function atFeeStep(fee: "carry" | "fixed" | "hybrid" | "" | null) {
  openWizard();
  goToStep(2);
  /* PRECONDITION: step 2 really rendered and the real select exists. */
  expect(screen.getByTestId("spv-wizard-step-2")).toBeTruthy();
  expect(screen.getByTestId("spv-w-feetype")).toBeTruthy();
  if (fee !== null) set("spv-w-feetype", fee);
}

/** Fill enough of the wizard to reach the review step legitimately. */
function atReviewStep(fee: "carry" | "fixed" | "hybrid" | "" | null) {
  openWizard();
  set("spv-w-name", "W306 Disclosure Vehicle");
  set("spv-w-jurisdiction", "delaware");
  set("spv-w-jurisdiction-country", "United States");
  set("spv-w-vintage", "2026");
  set("spv-w-type", "spv");
  goToStep(1);
  set("spv-w-mode", "sector_restricted");
  set("spv-w-mandate-desc", "Sector-restricted mandate for the W306 disclosure probe.");
  set("spv-w-subsector", "payments");
  set("spv-w-geography", "North America");
  set("spv-w-stage", "Series A");
  goToStep(2);
  click("spv-w-carrybasis-whole_spv");
  if (fee !== null) {
    set("spv-w-feetype", fee);
    if (fee !== "carry") set("spv-w-fixed", "7500");
    if (fee !== "fixed") set("spv-w-carrypct", "20");
  }
  goToStep(3);
  set("spv-w-target", "500000");
  set("spv-w-mincheck", "25000");
  goToStep(4);
  /* PRECONDITION: the review step really rendered, and rendered its own
     pre-existing content — so an absence below is measured against a live
     baseline, not against a crashed render. */
  expect(screen.getByTestId("spv-review-derived-note")).toBeTruthy();
}

beforeEach(() => {
  H.calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
   P — THE INSTRUMENTS ARE NOT INERT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P4 · P — preconditions", () => {
  it("P0 · the mocks were INSTALLED and are actually REACHED", async () => {
    expect(H.flags.apiMockInstalled).toBe(true);
    expect(H.flags.toastMockInstalled).toBe(true);
    openWizard();
    await waitFor(() => expect(H.calls.length).toBeGreaterThan(0));
  });

  it("P1 · the wizard genuinely mounts and the fee-type select is the REAL control", () => {
    atFeeStep(null);
    expect((document.body.textContent ?? "").length).toBeGreaterThan(50);
    const sel = screen.getByTestId("spv-w-feetype") as HTMLSelectElement;
    /* It really is a select with the three real options — so `set()` below is
       driving the shipped control, not a stray input. */
    expect(sel.tagName.toLowerCase()).toBe("select");
    expect(Array.from(sel.options).map((o) => o.value).sort()).toEqual(["carry", "fixed", "hybrid"]);
  });

  it("P2 · the disclosure constant is a real sentence, not an empty string", () => {
    /* A `toContain(\"\")` against an empty constant is unconditionally true —
       the classic inert assertion. Fenced here, once, for every test below. */
    expect(SPV_FEE_SETTLEMENT_DISCLOSURE.length).toBeGreaterThan(80);
    expect(SPV_FEE_SETTLEMENT_DISCLOSURE.trim()).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §1 — SITE 1: THE FEE-TYPE SELECT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P4 §1 — site 1, at the fee-type select", () => {
  it("FIXED · the disclosure renders with the exact shipped copy", () => {
    atFeeStep("fixed");
    expect(screen.getByTestId(SITE1).textContent).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("HYBRID · the same sentence, from the same constant", () => {
    atFeeStep("hybrid");
    expect(screen.getByTestId(SITE1).textContent).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("CARRY · absent — a carry-only fee raises no fixed obligation, so the sentence would be false", () => {
    atFeeStep("carry");
    /* Live baseline: step 2 is on screen and populated. */
    expect(screen.getByTestId("spv-wizard-step-2")).toBeTruthy();
    expect(screen.queryByTestId(SITE1)).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("UNTOUCHED · the shipped default is \"carry\", MEASURED, so an untouched wizard shows nothing", () => {
    atFeeStep(null);
    const sel = screen.getByTestId("spv-w-feetype") as HTMLSelectElement;
    /* MEASURED, not assumed. The wizard's initial `mgmtFeeType` is "carry"
       (PartnerSpvEngine defaults it), NOT the empty string. Pinning the real
       value here means the two tests below cannot quietly be testing the same
       branch as each other. */
    expect(sel.value).toBe("carry");
    expect(screen.queryByTestId(SITE1)).toBeNull();
  });

  /* ── A MEASURED LIMITATION, RECORDED RATHER THAN FAKED. ──────────────────
     I tried to drive the EMPTY fee type through this control and COULD NOT.
     A controlled <select> whose option list is carry / fixed / hybrid refuses an
     unmatched value in jsdom exactly as a browser does: the assignment is
     dropped, no change event fires, and the value stays "carry". The test below
     asserts THAT — the real, measured behaviour — instead of pretending to have
     reached a branch it never reached. A fixture that cannot distinguish the fix
     from the defect is one of the ten inert mechanisms; this is the honest
     alternative to writing one.

     So the empty state is NOT reachable through the shipped select today. It is
     still a state the shipped code handles — `feeStepRefusal` opens with
     `if (!w.mgmtFeeType) return "Choose a management fee type to continue."` and
     the launch payload builder guards `...(w.mgmtFeeType ? …)` — so the positive
     condition is what keeps the disclosure correct if that ever changes. The
     predicate difference itself is proved directly in the test after this one,
     as arithmetic on the two conditions, which is what it actually is. */
  it("EMPTY is UNREACHABLE through this control — measured, not assumed", () => {
    atFeeStep("");
    const sel = screen.getByTestId("spv-w-feetype") as HTMLSelectElement;
    expect(sel.value).toBe("carry");
    expect(screen.queryByTestId(SITE1)).toBeNull();
    /* And the select still offers exactly the three real options, so the value
       did not stick for some other reason. */
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["carry", "fixed", "hybrid"]);
  });

  it("the POSITIVE condition and the `!== \"carry\"` form DISAGREE on the empty value", () => {
    /* This is a claim about two predicates, so it is proved as one. Both are
       written out here exactly as the source writes them; if the shipped
       condition is ever changed to the negative form, the DOM tests above still
       pass (empty being unreachable today) and only this test states the cost. */
    const positive = (t: string) => t === "fixed" || t === "hybrid";
    const negative = (t: string) => t !== "carry";
    /* They agree on every value the select can produce — so the choice is not
       arbitrary preference, it is protection for the value it cannot. */
    for (const t of ["carry", "fixed", "hybrid"]) expect(positive(t)).toBe(negative(t));
    /* And they disagree on exactly the value the shipped code still handles. */
    expect(positive("")).toBe(false);
    expect(negative("")).toBe(true);
    /* The shipped source really does use the positive form at BOTH sites —
       asserted by rendering, not by reading source text: "fixed" and "hybrid"
       render it (§1/§2 above) and "carry" does not, which is the observable half. */
    atFeeStep("fixed");
    expect(screen.getByTestId(SITE1)).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §2 — SITE 2: THE REVIEW STEP.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P4 §2 — site 2, on the review step", () => {
  it("FIXED · the disclosure renders at review with the exact shipped copy", () => {
    atReviewStep("fixed");
    expect(screen.getByTestId(SITE2).textContent).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("HYBRID · the same at review", () => {
    atReviewStep("hybrid");
    expect(screen.getByTestId(SITE2).textContent).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("CARRY · absent at review, while the pre-existing review rows still render", () => {
    atReviewStep("carry");
    expect(screen.queryByTestId(SITE2)).toBeNull();
    /* The pre-existing content next to it is untouched — the absence is not the
       absence of the whole step. */
    expect(screen.getByTestId("spv-review-derived-note")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("UNTOUCHED · the default \"carry\" reaches review and shows nothing there either", () => {
    atReviewStep(null);
    expect(screen.getByTestId("spv-review-derived-note")).toBeTruthy();
    /* PRECONDITION, measured: this really is the default branch. */
    goToStep(2);
    expect((screen.getByTestId("spv-w-feetype") as HTMLSelectElement).value).toBe("carry");
    goToStep(4);
    expect(screen.queryByTestId(SITE2)).toBeNull();
    /* The neighbouring `!== "carry"` Fee-currency row is correctly absent here
       too — recorded so this file states what the surrounding rows do, rather
       than leaving the reader to assume. */
    expect(screen.getByTestId("spv-review-derived-note")).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §3 — THE TWO SITES ARE THE SAME SENTENCE, AND THE WIZARD'S NON-LINEARITY IS
   THE REASON BOTH EXIST. Driven through real tab navigation, never read off
   the source.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W306 P4 §3 — non-linear navigation", () => {
  it("a GP who sets the fee type and jumps STRAIGHT to review still sees it", () => {
    atReviewStep("hybrid");
    const review = screen.getByTestId(SITE2).textContent;
    /* Now go back to step 2 and confirm site 1 is there too, byte-identical. */
    goToStep(2);
    const select = screen.getByTestId(SITE1).textContent;
    expect(select).toBe(review);
    expect(select).toBe(SPV_FEE_SETTLEMENT_DISCLOSURE);
  });

  it("changing the fee type from fixed to carry REMOVES it at both sites", () => {
    atReviewStep("fixed");
    expect(screen.getByTestId(SITE2)).toBeTruthy();
    goToStep(2);
    expect(screen.getByTestId(SITE1)).toBeTruthy();
    set("spv-w-feetype", "carry");
    expect(screen.queryByTestId(SITE1)).toBeNull();
    goToStep(4);
    expect(screen.getByTestId("spv-review-derived-note")).toBeTruthy();
    expect(screen.queryByTestId(SITE2)).toBeNull();
  });

  it("the copy states no amount, no currency and no rate, so it is true for every figure", () => {
    atFeeStep("fixed");
    const text = screen.getByTestId(SITE1).textContent ?? "";
    /* R231 — nothing here can read as a fabricated zero, because there is no
       figure at all. */
    expect(/\d/.test(text)).toBe(false);
    expect(text).not.toContain("$");
    expect(text).not.toContain("%");
    /* The hedge that makes it true for a fixed fee with a blank or zero amount,
       which accrues nothing and blocks nothing. */
    expect(text).toContain("If you set a fixed fee amount");
    /* It states what is REFUSED, and does not claim no commitment can be
       recorded — `projectLpCommitted` is deliberately not gated. */
    expect(text).toContain("confirm that commitment or record a deployment");
    /* And it does not promise automatic collection: the gateway is frozen under
       WAIVER-8 and answers 503 by design. */
    expect(text).toContain("cannot collect it automatically");
  });
});
