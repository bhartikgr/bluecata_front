/**
 * WAVE 107 — THE CLIENT-SIDE HALF: WHAT THE WIZARD SENDS, AND WHAT IT REFUSES TO
 * SEND.
 *
 * The server round-trips in `server/__tests__/w107_round_narrative_and_terms_round_trip.test.ts`
 * prove storage was never the loss point. This file drives the REAL wizard
 * through all five steps against a stubbed `fetch` and asserts the exact
 * `POST /api/rounds` body, because that is where the option pool was lost.
 *
 * WHICH TESTS FAIL ON THE OLD CODE:
 *
 *   · "refuses the create rather than dropping the pool" — FAILS BEFORE. The old
 *     code let Continue through, POSTed `optionPoolPostPercent: null` and
 *     `optionPoolMode: null`, and returned success, so `err-addonPool` did not
 *     exist and the create body existed.
 *   · "prints no total for a column whose denominator makes a total meaningless"
 *     — FAILS BEFORE. The old total cell printed "125.000% FD pre-money
 *     (pre-pool)".
 *   · "the healthy path still sends the pool" and "the circular refusal still
 *     fires" PASS BEFORE and AFTER by design: they are the fence that the fix
 *     did not break the two behaviours the brief told me to preserve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w107",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w107", companyName: "W107 Co", billing: { plan: "founder_pro" } } },
  }),
}));

let createBodies: Array<Record<string, unknown>> = [];
let securities: unknown[] = [];

/**
 * A cap-table ledger that DISAGREES with the round's declared fully-diluted
 * count. This is the shape the QA round had, and it is what makes
 * `resolveFdPreMoneyBase` refuse with `fd_base_divergence` — the refusal that
 * used to take the founder's pool with it.
 */
const DIVERGENT_LEDGER = [
  { id: "sec_w107_1", holderName: "Founder A", holderType: "founder", instrument: "common", shares: 6000000, amountUsd: "0", issuedAt: "2025-01-01" },
];

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u === "/api/rounds" && method === "POST") {
      createBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return res(200, { id: "rnd_w107" });
    }
    if (u.startsWith("/api/rounds/name-availability")) return res(200, { available: true });
    if (u.includes("/securities")) return res(200, securities);
    if (u.includes("investor-crm")) return res(200, { contacts: [] });
    return res(200, {});
  }));
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <RoundNew />
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Step 1 — name, priced category, instrument. */
async function step1(instrument: "preferred" | "common") {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "QA Verify Round 22 Aug" } });
  fireEvent.click(screen.getByTestId("round-category-priced"));
  fireEvent.click(await screen.findByTestId(`instrument-${instrument}`));
  fireEvent.click(screen.getByTestId("button-next"));
}

/** Step 2 — the QA round's terms, then the pool add-on at 10% pre-money. */
async function step2QaTerms(opts: { targetAmount?: string; manualPps?: string } = {}) {
  fireEvent.change(await screen.findByTestId("input-pre"), { target: { value: "2000000" } });
  if (opts.targetAmount !== undefined && screen.queryByTestId("input-target")) {
    fireEvent.change(screen.getByTestId("input-target"), { target: { value: opts.targetAmount } });
  }
  fireEvent.change(screen.getByTestId("input-fd-pre-money-shares"), { target: { value: "8000000" } });
  fireEvent.change(screen.getByTestId("input-shares"), { target: { value: "2000000" } });
  if (opts.manualPps !== undefined) {
    fireEvent.change(screen.getByTestId("input-pps"), { target: { value: opts.manualPps } });
  }
}

/** The 1x-participating-with-a-3x-cap terms from Finding 2. */
function step2Participation() {
  fireEvent.click(screen.getByTestId("switch-participating"));
  fireEvent.change(screen.getByTestId("input-cap-part"), { target: { value: "3" } });
}

/** Tick the option-pool add-on and type a valid percentage. */
async function turnPoolOn(percent = "10") {
  fireEvent.click(screen.getByTestId("addon-pool-toggle"));
  fireEvent.change(await screen.findByTestId("addon-pool-percent"), { target: { value: percent } });
  await waitFor(() => screen.getByTestId("addon-pool-host"));
}

describe("W107 · FINDING 1-A — a pool that cannot be sized is refused, not silently dropped", () => {
  beforeEach(() => { createBodies = []; securities = []; installFetch(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("refuses the create rather than dropping the pool, when the ledger diverges from the declared count", async () => {
    securities = DIVERGENT_LEDGER;
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    step2Participation();
    await turnPoolOn("10");

    /* The projection's own refusal is on screen and names the divergence. */
    const refusal = await screen.findByTestId("addon-pool-refusal");
    expect(refusal.textContent ?? "").toContain("8000000");
    expect(refusal.textContent ?? "").toContain("6000000");

    /* THE ASSERTION THAT FAILS ON THE OLD CODE. Before this wave the refusal was
       advisory: the wizard created the round anyway with the pool stripped out. */
    const blocked = await screen.findByTestId("err-addonPool");
    expect(blocked.textContent ?? "").toContain("cannot size it yet");
    expect(blocked.textContent ?? "").toContain("pre-money");

    /* Continue is disabled, so the founder cannot reach the create at all. */
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(true);

    /* And nothing was posted. On the old code a POST landed here carrying
       `optionPoolPostPercent: null` and `optionPoolMode: null` beside a price of
       "0.25" derived with no pool in the denominator. */
    fireEvent.click(screen.getByTestId("button-next"));
    await new Promise((r) => setTimeout(r, 50));
    expect(createBodies.length).toBe(0);
  }, 90000);

  it("clears itself the moment the declared count is reconciled with the ledger, and then sends the pool", async () => {
    securities = DIVERGENT_LEDGER;
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    await turnPoolOn("10");
    await screen.findByTestId("err-addonPool");

    /* Correct the declared count to match the ledger — the exact remedy the
       refusal names. Nothing else changes. */
    fireEvent.change(screen.getByTestId("input-fd-pre-money-shares"), { target: { value: "6000000" } });
    await waitFor(() => expect(screen.queryByTestId("err-addonPool")).toBeNull());
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);
  }, 90000);

  it("the healthy path still sends the checkbox, the percentage AND the pre-money placement", async () => {
    securities = [];
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    step2Participation();
    await turnPoolOn("10");
    expect(screen.queryByTestId("err-addonPool")).toBeNull();

    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByTestId("input-notes"), { target: { value: "50% engineering, 30% GTM, 20% ops" } });
    fireEvent.change(screen.getByTestId("input-uop"), { target: { value: "50% engineering, 30% GTM, 20% ops" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-investors");
    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.click(await screen.findByTestId("button-create"));
    await waitFor(() => expect(createBodies.length).toBeGreaterThan(0));

    const body = createBodies[0];
    /* PERCENT-AS-WRITTEN: "10" means 10%, unrescaled at every layer. */
    expect(String(body.optionPoolPostPercent)).toBe("10");
    /* THE PLACEMENT — the money question the brief names. */
    expect(String(body.optionPoolMode)).toBe("pre_money");
    /* The participation terms travel too, for the Finding 2 agreement test. */
    expect(String(body.liquidationPreference)).toBe("1x participating");
    expect(String(body.capParticipation)).toBe("3");
    /* The narrative travels verbatim. */
    expect(String(body.notes)).toBe("50% engineering, 30% GTM, 20% ops");
    expect(String(body.useOfProceeds)).toBe("50% engineering, 30% GTM, 20% ops");
  }, 90000);

  it("the existing circular-dependency refusal STILL FIRES on the common-share path, and now binds", async () => {
    /* THE REFUSAL THE BRIEF TOLD ME NOT TO BREAK. A priced COMMON round collects
       no target raise, so the notional raise is price x new shares — and the price
       is what the pool is about to change. `derivePoolTopUpFromPercent` refuses by
       name rather than guessing, and that function is not modified by this wave. */
    securities = [];
    renderWizard();
    await step1("common");
    await step2QaTerms({ manualPps: "0.25" });
    await turnPoolOn("10");

    const refusal = await screen.findByTestId("addon-pool-refusal");
    const text = refusal.textContent ?? "";
    /* It still refuses, and it still refuses for the CIRCULAR reason — it names
       the missing raise rather than the cap-table base. */
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).not.toContain("still reading your cap table");

    /* And the refusal is now binding, so the pool can no longer be lost here either. */
    await screen.findByTestId("err-addonPool");
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-next"));
    await new Promise((r) => setTimeout(r, 50));
    expect(createBodies.length).toBe(0);
  }, 90000);

  it("a blank or half-typed percentage behaves exactly as before — the refusal is narrowly conditioned", async () => {
    securities = DIVERGENT_LEDGER;
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    fireEvent.click(screen.getByTestId("addon-pool-toggle"));
    await waitFor(() => screen.getByTestId("addon-pool-host"));
    /* No percentage typed: no pool term has been expressed, so nothing is being
       dropped and nothing is blocked. */
    expect(screen.queryByTestId("err-addonPool")).toBeNull();
  }, 90000);
});

describe("W107 · FINDING 3 — the review table prints no total that means nothing", () => {
  beforeEach(() => { createBodies = []; securities = []; installFetch(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function reachReview() {
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    await turnPoolOn("10");
    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-investors");
    fireEvent.click(screen.getByTestId("button-next"));
    const row = await screen.findByTestId("w52-preview-total");
    /* The LAST cell only. The row also holds a share COUNT, whose digits would
       otherwise run into the first percentage and produce a nonsense reading. */
    const cells = row.querySelectorAll("td");
    return cells[cells.length - 1] as HTMLElement;
  }

  it("prints no percentage above 100% anywhere in the total row", async () => {
    securities = [];
    const total = await reachReview();
    const text = total.textContent ?? "";
    /* THE ASSERTION THAT FAILS ON THE OLD CODE: this row printed "125.000% FD
       pre-money (pre-pool)" (reproduced locally, and 128.571% on the variant with
       a pool in the pricing denominator). */
    const percentages = Array.from(text.matchAll(/(\d+(?:\.\d+)?)%/g)).map((m) => Number(m[1]));
    expect(percentages.length).toBeGreaterThan(0);
    for (const p of percentages) {
      expect(p).toBeLessThanOrEqual(100);
    }
  }, 90000);

  it("names the two pre-money columns as having no meaningful total, instead of summing them", async () => {
    securities = [];
    const total = await reachReview();
    const text = total.textContent ?? "";
    /* Both pre-money denominators exclude this round's new shares, so both say so
       by name. The denominator is still printed, so the column is still
       identifiable — a percentage without its denominator is the defect this
       table exists to avoid. */
    expect(text).toContain("no meaningful total FD pre-money (pre-pool)");
    expect(text).toContain("no meaningful total FD pre-money (incl. pool)");
    expect(text).toContain("excludes this round's new shares");
  }, 90000);

  it("still prints the post-money totals, which ARE meaningful, and does not alter any row percentage", async () => {
    securities = [];
    const total = await reachReview();
    const text = total.textContent ?? "";
    expect(text).toContain("FD post-money");
    expect(text).toContain("FD post-money ex-pool");
    /* The individual rows are untouched: existing holders are still 100% of the
       pre-money base, which is a true and useful statement about ONE row. */
    const row0 = screen.getByTestId("w52-preview-row-0").textContent ?? "";
    expect(row0).toContain("100.000% FD pre-money (pre-pool)");
  }, 90000);
});

describe("W107 — no new customer-facing string carries a machine identifier", () => {
  beforeEach(() => { createBodies = []; securities = []; installFetch(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  /**
   * R77. Every sentence this wave ADDS to a founder's screen is rendered and then
   * scanned, rather than eyeballed: no snake_case token, no `rnd_`/`co_`/`sec_`
   * prefix, no `_json` suffix, no camelCase field name. The machine values keep
   * travelling on the wire and in `data-testid` attributes, which are not copy.
   */
  const MACHINE_SHAPES: Array<[string, RegExp]> = [
    ["snake_case token", /\b[a-z]{2,}_[a-z]{2,}\b/],
    ["record id prefix", /\b(rnd|co|sec|usr|u)_[a-z0-9]{4,}\b/],
    ["json column", /_json\b/],
    ["field name in camelCase", /\b(optionPool[A-Za-z]*|capParticipation|liquidationPreference|antiDilutionType|minTicket|useOfProceeds|termsSummary|fdPreMoneyShares)\b/],
  ];

  function assertHumanCopy(label: string, text: string) {
    expect(text.length, `${label} rendered nothing to check`).toBeGreaterThan(0);
    for (const [shape, re] of MACHINE_SHAPES) {
      expect(re.test(text), `${label} contains a ${shape}: ${JSON.stringify(text.slice(0, 400))}`).toBe(false);
    }
  }

  it("the option-pool refusal this wave adds reads as English", async () => {
    securities = DIVERGENT_LEDGER;
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    await turnPoolOn("10");
    const blocked = await screen.findByTestId("err-addonPool");
    assertHumanCopy("err-addonPool", blocked.textContent ?? "");
  }, 90000);

  it("the review table's non-answer for a meaningless total reads as English", async () => {
    securities = [];
    renderWizard();
    await step1("preferred");
    await step2QaTerms({ targetAmount: "500000" });
    await turnPoolOn("10");
    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-investors");
    fireEvent.click(screen.getByTestId("button-next"));
    const row = await screen.findByTestId("w52-preview-total");
    const cells = row.querySelectorAll("td");
    assertHumanCopy("w52-preview-total", (cells[cells.length - 1] as HTMLElement).textContent ?? "");
  }, 90000);
});
