/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 284 · THE PER-CURRENCY PENDING SUBTOTAL. WHAT THE USER READS, ASSERTED.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. The accounting persona's "Pending, by currency" line summed
 * pending rebills with `Number(r.amount_minor)` and rendered the result through
 * `formatMinor`. A row whose amount is absent — which the server could and did
 * write, and which wave 284 has only just stopped it writing — contributed
 * `NaN`, or contributed nothing at all while still being counted as pending, and
 * the line printed a confident `$0.00` or a partial sum presented as the total.
 * The user could not tell "these expenses cost nothing" from "we do not know
 * what these expenses cost".
 *
 * WHAT THIS FILE ASSERTS. RENDERED TEXT, read out of the DOM by test id. Never a
 * variable, never the return of the useMemo, never a mocked formatter. The one
 * exception is §D, which drives the exported `pendingUnknownNote` directly to
 * cover branches the DOM cases do not reach — and every branch it covers is also
 * shown on screen in §A–§C.
 *
 * THE OVER-REACH CASE IS §C AND IT IS NOT OPTIONAL. Not every zero is a lie. A
 * partner may legitimately record a zero-cost expense, and after this change
 * that subtotal must still render as a formatted zero with an EMPTY note. A fix
 * that renders "Not on record" for a real zero has replaced one false statement
 * with another.
 * ════════════════════════════════════════════════════════════════════════════ */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const IDENTITY = {
  ready: true,
  error: null,
  identity: {
    partnerId: "ac_consortium_partner_test_partner_inc",
    tier: "builder",
    subRole: "managing_partner",
    identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
  },
};
vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return { ...actual, useRequirePartnerRole: () => IDENTITY };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import PartnerMfcrmPersonas, { pendingUnknownNote } from "../PartnerMfcrmPersonas";
import type { MfcrmCapability } from "@/lib/partner/mfcrmPersona";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.filter((k) => typeof k === "string").join("/").replace(/\/+/g, "/");
          return (await apiRequestMock("GET", url)).json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderAt(pathname: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path: pathname, static: false, record: true });
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <TooltipProvider>{ui}</TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

function capability(over: Partial<MfcrmCapability> = {}): MfcrmCapability {
  return {
    partnerId: "ac_consortium_partner_test_partner_inc",
    partnerType: null,
    classified: true,
    sourcesCapital: false,
    delegatedAgency: false,
    spvWriteAuthority: false,
    advisoryCoseat: false,
    documentCustody: false,
    paysOnBehalf: false,
    attributionTracking: false,
    collectiveFronting: false,
    chapterScoping: false,
    fundAdmin: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Anything unrouted REJECTS. A harness that quietly resolves `{}` for a call it
 *  did not expect proves nothing about the screen it thinks it rendered. */
function routeGets(table: Record<string, unknown>) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    const key = String(url).split("?")[0];
    if (method === "GET" && key in table) return jsonResponse(table[key]);
    throw new Error(`unrouted ${method} ${url}`);
  });
}

type Rebill = {
  id: string;
  company_id: string;
  description: string;
  amount_minor: unknown;
  currency: string;
  status: string;
  incurred_at: string | null;
};

function rebill(id: string, amount_minor: unknown, currency: string, status = "pending"): Rebill {
  return { id, company_id: "co_1", description: `Expense ${id}`, amount_minor, currency, status, incurred_at: null };
}

async function renderAcct(rebills: Rebill[]) {
  routeGets({
    "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "accounting", paysOnBehalf: true }) },
    "/api/partner/me/mfcrm/acct/rebill": { rebills },
    "/api/partner/me/mfcrm/acct/custody": { custody: [] },
  });
  renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
  await screen.findByTestId("mfcrm-persona-acct");
  /* PRECONDITION FOR EVERY CASE BELOW: the totals line actually rendered. An
     assertion that some text is ABSENT is worthless on a screen that never
     drew the element at all.

     WHICH BRANCHES CAN REACH THIS LINE, ESTABLISHED RATHER THAN ASSUMED. The
     whole table-and-totals block is behind `rebills.length > 0`; with no rebills
     at all the page draws `mfcrm-acct-rebill-empty` and NO totals line exists.
     That is pre-existing behaviour wave 284 did not touch, and §B0 asserts it
     directly instead of calling this helper. */
  return await screen.findByTestId("mfcrm-acct-rebill-pending-totals");
}

const text = (testId: string) => (screen.getByTestId(testId).textContent ?? "").trim();

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION A — AN UNKNOWN AMOUNT IS SAID TO BE UNKNOWN, NOT PRINTED AS ZERO.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §A — a pending expense with no amount", () => {
  it("the only pending USD row has no amount: the subtotal reads Not on record, never $0.00", async () => {
    const totals = await renderAcct([rebill("r_null", null, "USD")]);

    /* PRECONDITION: the currency's own subtotal element exists. Without this,
       the two negative assertions below would pass on an empty screen. */
    const cell = screen.getByTestId("mfcrm-acct-rebill-pending-USD");
    expect(cell).toBeTruthy();

    /* WHAT THE USER READS. */
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("Not on record");
    /* AND WHAT THEY MUST NEVER READ — the fabricated zero, in either shape. */
    expect(totals.textContent ?? "").not.toMatch(/\$0\.00/);
    expect(totals.textContent ?? "").not.toMatch(/\bNaN\b/);

    /* THE SENTENCE THAT EXPLAINS IT. Count and currency code, no row id. */
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe(
      "1 pending expense has no amount on record, so the USD total is not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("a partial sum is never shown as the total: known + unknown in the SAME currency", async () => {
    const totals = await renderAcct([
      rebill("r_known", 125000, "USD"),
      rebill("r_missing", null, "USD"),
    ]);

    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("Not on record");
    /* THE SPECIFIC LIE THIS GUARDS AGAINST: $1,250.00 rendered as "the pending
       USD total" when one of the two pending USD expenses has no amount at all.
       That figure is not wrong arithmetic — it is a true sum of a subset,
       presented as the whole. */
    expect(totals.textContent ?? "").not.toMatch(/1,250\.00/);
    expect(totals.textContent ?? "").not.toMatch(/\$0\.00/);

    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe(
      "1 pending expense has no amount on record, so the USD total is not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("one currency going unknown does not suppress a DIFFERENT currency that is fully known", async () => {
    await renderAcct([
      rebill("r_usd_missing", null, "USD"),
      rebill("r_jpy_ok", 5000, "JPY"),
    ]);

    /* UNDER-REACH IN THE OTHER DIRECTION. The unknown is scoped to its own
       currency; JPY still shows its real, complete total. */
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("Not on record");
    expect(text("mfcrm-acct-rebill-pending-JPY")).toMatch(/5,?000/);
    expect(text("mfcrm-acct-rebill-pending-JPY")).not.toBe("Not on record");

    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe(
      "1 pending expense has no amount on record, so the USD total is not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("multiple currencies and multiple missing rows are all named", async () => {
    await renderAcct([
      rebill("r_j1", null, "JPY"),
      rebill("r_u1", undefined, "USD"),
      rebill("r_u2", "", "USD"),
      rebill("r_u3", 4000, "USD"),
    ]);

    expect(text("mfcrm-acct-rebill-pending-JPY")).toBe("Not on record");
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("Not on record");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe(
      "3 pending expenses have no amount on record, so the JPY and USD totals are not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("a fractional amount is unknown, not silently truncated into a total", async () => {
    const totals = await renderAcct([rebill("r_frac", 1250.7, "USD")]);
    /* 1250.7 minor units is not a count of minor units. Adding it means picking
       a rounding direction on the user's behalf, which is the forbidden silent
       adjustment. The honest answer is that this total cannot be shown. */
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("Not on record");
    expect(totals.textContent ?? "").not.toMatch(/12\.50|12\.51/);
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toMatch(/^1 pending expense has no amount on record/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION B — "NOT YET": NO PENDING ROWS AT ALL IS ITS OWN STATE.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §B — the empty and the settled states are unchanged", () => {
  it("B0 — no rebills at all: the empty state, and NO totals line and NO note anywhere", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "accounting", paysOnBehalf: true }) },
      "/api/partner/me/mfcrm/acct/rebill": { rebills: [] },
      "/api/partner/me/mfcrm/acct/custody": { custody: [] },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-acct");

    /* THE STATE THAT IS ACTUALLY REACHED. `rebills.length > 0` gates the table
       and everything under it, so with nothing recorded the user sees the empty
       sentence and no subtotal machinery at all. Asserting the ABSENCE of the
       note is only meaningful next to this positive anchor. */
    const empty = await screen.findByTestId("mfcrm-acct-rebill-empty");
    expect((empty.textContent ?? "").trim()).toBe("No rebillable expenses recorded yet.");
    expect(screen.queryByTestId("mfcrm-acct-rebill-pending-totals")).toBeNull();
    expect(screen.queryByTestId("mfcrm-acct-rebill-pending-unknown-note")).toBeNull();
  });

  it("rows exist but none are pending: none pending, and the note is empty", async () => {
    await renderAcct([rebill("r_done", 125000, "USD", "rebilled")]);
    /* THIS is the branch that actually reaches "none pending": there are rows,
       so the block renders, but none of them are pending. The note element is
       ALWAYS present here — it is an unconditional sibling, not a conditionally
       rendered one — and must be empty. A page that says "none pending" and then
       explains a missing total would be nonsense. */
    expect(text("mfcrm-acct-rebill-pending-none")).toBe("none pending");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
  });

  it("a non-pending row with no amount does not raise the note", async () => {
    await renderAcct([rebill("r_settled", null, "USD", "rebilled")]);
    /* Only PENDING rows are subtotalled, so a settled row with a missing amount
       is out of scope for this line and must not produce a warning about a total
       that is not being shown. */
    expect(text("mfcrm-acct-rebill-pending-none")).toBe("none pending");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
    /* And the row itself still shows its own missing amount honestly in the
       table — the per-row cell was already correct (wave 147) and wave 284 left
       it alone. */
    expect(text("mfcrm-acct-rebill-amount-r_settled")).toBe("Not on record");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION C — OVER-REACH. A REAL ZERO IS A REAL AMOUNT.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §C — the fix does not eat a genuine zero", () => {
  it("amount_minor: 0 still renders a formatted zero and raises NO note", async () => {
    await renderAcct([rebill("r_free", 0, "USD")]);
    /* THE OVER-REACH ASSERTION. If the predicate had been written on falsiness
       — `!r.amount_minor` — this cell would read "Not on record" and a partner
       who correctly recorded a free courier would be told their own figure was
       missing. */
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("$0.00");
    expect(text("mfcrm-acct-rebill-pending-USD")).not.toBe("Not on record");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
  });

  it("a zero row alongside a real amount still sums to the real amount", async () => {
    await renderAcct([rebill("r_free", 0, "USD"), rebill("r_paid", 125000, "USD")]);
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("$1,250.00");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
  });

  it("a numeric STRING amount is still a known amount", async () => {
    await renderAcct([rebill("r_str", "5000", "USD")]);
    /* SQLite is not STRICT on this column and a widened writer could hand back
       "5000". That is a whole count of minor units and must keep working —
       treating it as unknown would be over-reach that hides a real figure. */
    expect(text("mfcrm-acct-rebill-pending-USD")).toBe("$50.00");
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
  });

  it("THE WAVE 20 THREE-EXPONENT FIXTURE STILL PASSES, UNCHANGED", async () => {
    const totals = await renderAcct([
      rebill("r_jpy", 5000, "JPY"),
      rebill("r_usd", 5000, "USD"),
      rebill("r_bhd", 5000, "BHD"),
    ]);
    const jpy = text("mfcrm-acct-rebill-pending-JPY");
    const usd = text("mfcrm-acct-rebill-pending-USD");
    const bhd = text("mfcrm-acct-rebill-pending-BHD");
    /* The same integer under three different ISO exponents must render as three
       different strings. This is wave 20's assertion, re-run here because wave
       284 changed the formatter this line calls. */
    expect(new Set([jpy, usd, bhd]).size).toBe(3);
    expect(jpy).toMatch(/5,?000/);
    expect(jpy).not.toMatch(/50\.00/);
    expect(usd).toMatch(/50\.00/);
    expect(bhd).toMatch(/5\.000/);
    /* And still no cross-currency total. */
    expect(totals.textContent ?? "").not.toMatch(/15,?000/);
    expect(totals.textContent ?? "").not.toMatch(/150\.00/);
    expect(text("mfcrm-acct-rebill-pending-unknown-note")).toBe("");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION D — EVERY BRANCH OF THE SENTENCE, DRIVEN DIRECTLY.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §D — pendingUnknownNote is true in every branch that can reach it", () => {
  it("empty input, and input with no unknown rows, both produce NO sentence", () => {
    expect(pendingUnknownNote([])).toBe("");
    expect(pendingUnknownNote([{ code: "USD", minor: 125000, knownRows: 2, unknownRows: 0 }])).toBe("");
    expect(
      pendingUnknownNote([
        { code: "JPY", minor: 5000, knownRows: 1, unknownRows: 0 },
        { code: "USD", minor: 0, knownRows: 1, unknownRows: 0 },
      ]),
    ).toBe("");
  });

  it("singular row, singular currency", () => {
    expect(pendingUnknownNote([{ code: "USD", minor: null, knownRows: 1, unknownRows: 1 }])).toBe(
      "1 pending expense has no amount on record, so the USD total is not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("plural rows, singular currency", () => {
    expect(pendingUnknownNote([{ code: "USD", minor: null, knownRows: 0, unknownRows: 4 }])).toBe(
      "4 pending expenses have no amount on record, so the USD total is not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("two currencies are joined with `and`, and a known currency is not named", () => {
    expect(
      pendingUnknownNote([
        { code: "GBP", minor: 100, knownRows: 1, unknownRows: 0 },
        { code: "JPY", minor: null, knownRows: 0, unknownRows: 1 },
        { code: "USD", minor: null, knownRows: 1, unknownRows: 1 },
      ]),
    ).toBe(
      "2 pending expenses have no amount on record, so the JPY and USD totals are not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("three currencies use commas plus a final `and`", () => {
    expect(
      pendingUnknownNote([
        { code: "BHD", minor: null, knownRows: 0, unknownRows: 1 },
        { code: "JPY", minor: null, knownRows: 0, unknownRows: 1 },
        { code: "USD", minor: null, knownRows: 0, unknownRows: 1 },
      ]),
    ).toBe(
      "3 pending expenses have no amount on record, so the BHD, JPY and USD totals are not shown. " +
        "Nothing has been assumed or added up in part.",
    );
  });

  it("the sentence never contains a row identifier", () => {
    const out = pendingUnknownNote([{ code: "USD", minor: null, knownRows: 0, unknownRows: 1 }]);
    /* w124 — no raw internal identifier is ever rendered. The helper is given
       only codes and counts, and this asserts the output shape rather than
       trusting the signature. */
    expect(out).not.toMatch(/mfrb_|co_|usr_|u_|spv_/);
  });
});
