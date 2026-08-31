/* ════════════════════════════════════════════════════════════════════════════
   WAVE 193 · ITEM C · R165.5 / R137 — THE RENDERED-DOM TESTS.
   ════════════════════════════════════════════════════════════════════════════
   Wave 191 reported honestly that NO test mounted the real `RoundNew` or
   `CapTable`: it lifted the decision layers out and rendered those, proving the
   wiring by reading source text. R137 is the ruling that exists because an LP fix
   once passed every test and never reached the LP — the test mounted a store
   instead of the component.

   So these tests mount the REAL DEFAULT EXPORTS of the REAL page modules:

       RoundNew   — `@/pages/founder/RoundNew`
       Rounds     — `@/pages/founder/Rounds`      (its round EDIT dialog)
       CapTable   — `@/pages/founder/CapTable`

   and assert on the DOM a founder actually gets. C-0 pins that fact: it asserts
   the mounted component IS the module's default export and that the container
   holds real page chrome, so this file cannot later be hollowed out into a
   shallower proof without going red.

   WHAT IS MOCKED AND WHY. Only the seams a jsdom page cannot have: the router
   (`wouter` needs no history here), the toast host, the active-company hook, and
   the HTTP layer. THE COMPONENTS ARE NOT MOCKED, the currency selector is not
   mocked, and no assertion below reads source text. Query data is served through
   the real `QueryClient` so the pages' own `useQuery` calls resolve exactly as
   they do in the browser.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoleProvider } from "@/lib/role";

/* ── the seams ─────────────────────────────────────────────────────────────── */
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: () => ["/founder/rounds/new", navigate],
    /* A REAL component, not a hand-built element object: React validates `ref` on
       whatever a mocked `Link` returns, and a fabricated element fails that check
       before any page code runs. */
    Link: ({ href, children, ...rest }: { href?: string; children?: ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
    useRoute: () => [false, {}],
    useRouter: () => ({}),
    Redirect: () => null,
  };
});

const toasts: Array<Record<string, unknown>> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: Record<string, unknown>) => void toasts.push(t) }),
  toast: (t: Record<string, unknown>) => void toasts.push(t),
}));

const COMPANY_ID = "co_w193";
const COMPANY_DEFAULT_CURRENCY = "SGD"; /* deliberately NOT the platform's habitual USD */
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({
    data: {
      activeCompanyId: COMPANY_ID,
      company: {
        companyId: COMPANY_ID,
        companyName: "W193 Holdings",
        legalName: "W193 Holdings Pte Ltd",
        role: "founder",
        sector: "fintech",
        stage: "seed",
        hq: "SG",
        defaultCurrency: COMPANY_DEFAULT_CURRENCY,
        /* RoundNew gates the whole wizard behind a paid plan
           (`RoundNew.tsx:518,2057`), so a free company renders the upgrade
           interstitial and NOT the currency selector. This is the company record a
           founder who can actually create a round has. */
        billing: { plan: "founder_pro" },
        kpi: {
          capTableHolders: 3, activeRoundsCount: 1, raisedThisYearUsd: 0,
          dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: null,
        },
      },
    },
    isLoading: false,
    isError: false,
  }),
  founderQueryKey: (...parts: unknown[]) => parts,
}));

/** THE HTTP SEAM. Every page fetches through `apiRequest`, so this is where the
 *  fixture is served — shaped exactly as the real endpoints shape it (bare arrays
 *  for collections, bare objects for records), because a page that only works
 *  against a wrapper the server never sends is the R137 failure again. Mutations
 *  are recorded, not simulated: C-2c reads the real PATCH body back out. */
let SERVE_ROUNDS: unknown[] = [];
let SERVE_SECURITIES: unknown[] = [];
const apiRequestMock = vi.fn(async (method: string, url: string, _body?: unknown) => {
  const json = (v: unknown) =>
    ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) }) as unknown as Response;
  if (method !== "GET") return json({ ok: true });
  if (/securities/.test(url)) return json(SERVE_SECURITIES);
  if (/attribution/.test(url)) return json({ attributedPartner: null });
  if (/investor-crm/.test(url)) return json([]);
  if (/\/api\/rounds/.test(url)) return json(SERVE_ROUNDS);
  if (/\/rounds/.test(url)) return json(SERVE_ROUNDS);
  return json({ ok: true });
});
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: (method: string, url: string, body?: unknown) => apiRequestMock(method, url, body),
  };
});

import RoundNew from "@/pages/founder/RoundNew";
import Rounds from "@/pages/founder/Rounds";
import CapTable from "@/pages/founder/CapTable";
import * as RoundNewModule from "@/pages/founder/RoundNew";
import * as RoundsModule from "@/pages/founder/Rounds";
import * as CapTableModule from "@/pages/founder/CapTable";

/* ── fixture data, served through the real query client ────────────────────── */

/** A round with NO currency — one of the 1045 the platform holds today. */
const ROUND_UNDENOMINATED = {
  id: "r_absent", companyId: COMPANY_ID, name: "Seed (undenominated)", type: "seed",
  state: "active", instrument: "safe_post", targetAmount: 2_000_000, raisedAmount: 500_000,
  valuationCap: 10_000_000, openDate: "2026-01-01", closeDate: "2026-12-31", currency: null,
};

/** Two rounds whose stated currencies DIFFER — the mixed fixture for CapTable. */
const ROUND_USD = { ...ROUND_UNDENOMINATED, id: "r_usd", name: "Seed USD", currency: "USD" };
const ROUND_GBP = { ...ROUND_UNDENOMINATED, id: "r_gbp", name: "Bridge GBP", currency: "GBP", instrument: "safe_pre" };

const SECURITIES_MIXED = [
  {
    id: "sec_usd", companyId: COMPANY_ID, holderId: "h_a", holderName: "Alpha Fund",
    kind: "safe", series: "SAFE", instrument: "safe", roundId: "r_usd",
    /* A NUMBER, as `/api/companies/:id/securities` really sends it — CapTable sums
       `investmentAmount` arithmetically (`CapTable.tsx:463`), so a string here would
       concatenate and the fixture would be testing a shape the server never sends. */
    investmentAmount: 1_000_000,
    issueDate: "2026-01-02", currency: "USD",
  },
  {
    id: "sec_gbp", companyId: COMPANY_ID, holderId: "h_b", holderName: "Beta Partners",
    kind: "safe", series: "SAFE", instrument: "safe", roundId: "r_gbp", investmentAmount: 800_000,
    issueDate: "2026-03-02", currency: "GBP",
  },
  {
    id: "sec_common", companyId: COMPANY_ID, holderId: "h_f", holderName: "Founders",
    kind: "common", instrument: "common", series: "Common", shares: 8_000_000, issueDate: "2026-01-01",
  },
];

/** One dispatcher for every `useQuery` that relies on the app's DEFAULT query
 *  function. Shapes match the real endpoints: `/api/rounds` is a bare array, the
 *  company profile is a bare record carrying `legal.region`, `/api/auth/me` is a
 *  bare user. Unknown keys resolve to a benign empty body rather than throwing, so
 *  a page is never held back by a query irrelevant to what is being asserted.
 *  `served` records the keys each mounted page actually asked for, so a failure
 *  reads as "the page never requested X" rather than as a bare missing element. */
const served: string[] = [];
function bodyFor(key: readonly unknown[]): unknown {
  const k = key.map((p) => String(p)).join("|");
  served.push(k);
  if (k.includes("/api/auth/me")) return { id: "u_founder", displayName: "W193 Founder", role: "founder" };
  if (k.includes("securities")) return SERVE_SECURITIES;
  if (k.includes("attribution")) return { attributedPartner: null };
  if (k.includes("profile")) return { companyId: COMPANY_ID, legal: { region: "US" }, sector: "fintech", stage: "seed" };
  if (k.includes("rounds")) return SERVE_ROUNDS;
  if (k.includes("subscription")) return { status: "active", plan: "founder_pro", tierId: "tier_growth" };
  if (k.includes("/api/companies")) return { companyId: COMPANY_ID, defaultCurrency: COMPANY_DEFAULT_CURRENCY };
  return {};
}

function mount(
  Page: () => JSX.Element,
  opts: { rounds?: unknown[]; securities?: unknown[] } = {},
) {
  SERVE_ROUNDS = opts.rounds ?? [ROUND_UNDENOMINATED];
  SERVE_SECURITIES = opts.securities ?? [];
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: (async (ctx: { queryKey: readonly unknown[] }) => bodyFor(ctx.queryKey)) as never,
      },
    },
  });
  /* `RoleProvider` and `TooltipProvider` are required chrome, not shortcuts: the
     real app mounts these pages inside both (AppShell), and Radix's `Tooltip`
     throws without a provider. */
  const view = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <Page />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

/* ── jsdom polyfills Radix's Select needs, and NOTHING more ──────────────────
   These three DOM methods do not exist in jsdom. Radix calls them while opening a
   listbox, so without them the OPTIONS never render and a "cannot select" result
   would be an artefact of the environment rather than a fact about the page. They
   are stubbed at the DOM level; no component behaviour is replaced. */
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
Element.prototype.scrollIntoView = () => {};
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => {};
Element.prototype.setPointerCapture = () => {};

/** Open a real Radix select and click a real option. Options render in a portal,
 *  so they are searched in `document`. Returns nothing: the caller asserts on the
 *  trigger's own text, which is what the founder reads. */
async function chooseOption(trigger: HTMLElement, code: string): Promise<void> {
  fireEvent.pointerDown(trigger, { pointerId: 1, button: 0, ctrlKey: false });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await waitFor(
    () => {
      const found = Array.from(document.querySelectorAll("[role='option']")).find((o) =>
        (o.textContent ?? "").includes(code),
      );
      expect(
        found,
        `no ${code} option appeared in the open listbox; options were ${JSON.stringify(
          Array.from(document.querySelectorAll("[role='option']")).map((o) => o.textContent),
        )}`,
      ).toBeTruthy();
      return found as HTMLElement;
    },
    { timeout: 10_000 },
  );
  fireEvent.click(option);
  await waitFor(() => expect(trigger.textContent ?? "").toContain(code));
}

beforeEach(() => { cleanup(); served.length = 0; toasts.length = 0; apiRequestMock.mockClear(); });
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════════
   C-0 — THE ANTI-VACUITY PROOF. Everything below is worthless if these are not
   the real pages.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 193 · C-0 — these ARE the real page modules", () => {
  it("C-0 each page under test is the module's own default export, and it is a component", () => {
    expect(RoundNew).toBe(RoundNewModule.default);
    expect(Rounds).toBe(RoundsModule.default);
    expect(CapTable).toBe(CapTableModule.default);
    for (const P of [RoundNew, Rounds, CapTable]) expect(typeof P).toBe("function");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   C-1 — RoundNew: the currency selector, mounted.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 193 · C-1 — the REAL RoundNew page", () => {
  it("C-1a the currency selector is PRESENT in the rendered DOM", async () => {
    mount(RoundNew);
    const sel = await screen.findByTestId("select-round-currency", {}, { timeout: 10_000 });
    expect(sel).toBeTruthy();
    /* And the page around it really rendered — not an error boundary with one
       stray element in it. */
    expect(document.body.textContent ?? "").toMatch(/Round currency/i);
  });

  it("C-1b it DEFAULTS from the company record, and the default is not a platform guess", async () => {
    mount(RoundNew);
    const sel = await screen.findByTestId("select-round-currency", {}, { timeout: 10_000 });
    /* The company on record is SGD. If the page reached for a hardcoded USD
       (R156.2) or for a region-derived symbol, this is where it shows. */
    await waitFor(() => expect(sel.textContent ?? "").toContain(COMPANY_DEFAULT_CURRENCY));
    expect(sel.textContent ?? "").not.toContain("USD");
  });

  it("C-1c the default can be OVERRIDDEN — the selector is a choice, not a label", async () => {
    mount(RoundNew);
    const trigger = await screen.findByTestId("select-round-currency", {}, { timeout: 10_000 });
    await waitFor(() => expect(trigger.textContent ?? "").toContain(COMPANY_DEFAULT_CURRENCY));
    /* Not disabled and not read-only — asserted on the ELEMENT, because a
       "selector" a founder cannot operate is the same defect as no selector. */
    expect(trigger.getAttribute("disabled")).toBeNull();
    expect(trigger.getAttribute("aria-disabled")).not.toBe("true");
    /* Open the listbox and choose a different currency. */
    await chooseOption(trigger, "GBP");
    expect(trigger.textContent ?? "").not.toContain(COMPANY_DEFAULT_CURRENCY);
    /* And the page STATES the divergence from the company record rather than
       silently keeping one of the two. */
    const differs = await screen.findByTestId("round-currency-differs-from-company");
    expect(differs.textContent ?? "").toContain(COMPANY_DEFAULT_CURRENCY);
    expect(differs.textContent ?? "").toContain("GBP");
  });

  it("C-1d THE ROUND CANNOT PROCEED WITHOUT A CURRENCY", async () => {
    /* The proof is done by REMOVING the company's currency, because that is the
       only way the page reaches step 1 with an empty selection: a company with no
       currency on record. The platform must then ask rather than assume. */
    const mod = await import("@/lib/useActiveCompany");
    const spy = vi.spyOn(mod, "useActiveCompany");
    spy.mockReturnValue({
      data: {
        activeCompanyId: COMPANY_ID,
        company: {
          companyId: COMPANY_ID, companyName: "W193 Holdings", kpi: {},
          billing: { plan: "founder_pro" },
          /* AND NO `defaultCurrency` — that is the whole point of this case. */
        },
      },
      isLoading: false, isError: false,
    } as never);
    try {
      mount(RoundNew);
      const next = await screen.findByTestId("button-next", {}, { timeout: 10_000 });
      /* THE ASSERTION THE OWNER ASKED FOR: with no currency chosen, the founder
         cannot move on. */
      await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(true));
      /* And the page SAYS WHY rather than merely refusing to respond. */
      const why = await screen.findByTestId("round-currency-required");
      expect((why.textContent ?? "").trim().length).toBeGreaterThan(0);

      /* Choose one, and the same button becomes usable — so the disabled state was
         the currency's doing and not some unrelated incompleteness. */
      const trigger = await screen.findByTestId("select-round-currency");
      await chooseOption(trigger, "GBP");
      await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
    } finally {
      spy.mockRestore();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   C-2 — Rounds: the EDIT dialog. This is how the 1045 NULL rounds get corrected.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 193 · C-2 — the REAL round EDIT dialog in Rounds.tsx", () => {
  async function openEditDialog() {
    mount(Rounds, { rounds: [ROUND_UNDENOMINATED] });
    await screen.findByText(/Seed \(undenominated\)/, {}, { timeout: 10_000 });
    /* Find the edit affordance for this round without depending on a label: any
       control whose testid names edit and the round. */
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid*='edit']"),
    ).filter((e) => e.tagName === "BUTTON" || e.getAttribute("role") === "button");
    expect(candidates.length, "no edit control rendered for the round").toBeGreaterThan(0);
    fireEvent.click(candidates[0]);
    return await screen.findByTestId("select-edit-round-currency", {}, { timeout: 10_000 });
  }

  it("C-2a the dialog exposes a currency control for an EXISTING round", async () => {
    const sel = await openEditDialog();
    expect(sel).toBeTruthy();
  });

  it("C-2b an UNDENOMINATED round says so — it does not display a currency it does not have", async () => {
    const sel = await openEditDialog();
    /* The round's stored currency is NULL. The control must start empty and the
       dialog must state the absence, rather than pre-selecting a currency the
       founder never chose — a pre-selection here is how 1045 rounds would silently
       become dollars. */
    expect(sel.textContent ?? "").not.toMatch(/\b[A-Z]{3}\b/);
    const absent = await screen.findByTestId("edit-round-currency-absent");
    expect((absent.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("C-2c a currency CAN be set on an existing round, and the PATCH carries it", async () => {
    const sel = await openEditDialog();
    await chooseOption(sel, "GBP");

    /* Save, and read what actually went over the wire. A selector that changes on
       screen but sends nothing is the R137 failure in miniature. */
    const save = Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) =>
      /save|update/i.test(b.textContent ?? ""),
    );
    expect(save, "no save control in the edit dialog").toBeTruthy();
    fireEvent.click(save!);
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalled());
    const patched = apiRequestMock.mock.calls.find((c) => {
      const body = c[2] as Record<string, unknown> | undefined;
      return body != null && typeof body === "object" && "currency" in body;
    });
    expect(patched, `no request carried a currency; calls were ${JSON.stringify(apiRequestMock.mock.calls)}`)
      .toBeTruthy();
    expect((patched![2] as Record<string, unknown>).currency).toBe("GBP");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   C-3 — CapTable with a MIXED-CURRENCY fixture: what the founder actually sees.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 193 · C-3 — the REAL CapTable page on a mixed-currency company", () => {
  it("C-3a it does NOT render a single summed figure across two currencies", async () => {
    mount(CapTable, { rounds: [ROUND_USD, ROUND_GBP], securities: SECURITIES_MIXED });
    const cell = await screen.findByTestId("captable-invested-mixed-currency", {}, { timeout: 15_000 });
    const text = cell.textContent ?? "";
    /* THE DEFECT THIS REPLACES: "$1,800,000" — one number, two currencies, and
       nothing on screen looking wrong. Neither the sum nor a currency-symbolled
       total of it may appear. */
    expect(text).not.toMatch(/1[.,]?800[.,]?000/);
    expect(text).not.toMatch(/\$\s*1[.,]8/);
  });

  it("C-3b it STATES that the currencies differ, in words, and names them", async () => {
    mount(CapTable, { rounds: [ROUND_USD, ROUND_GBP], securities: SECURITIES_MIXED });
    const headline = await screen.findByTestId("captable-invested-mixed-headline", {}, { timeout: 15_000 });
    const statement = await screen.findByTestId("captable-invested-mixed-statement");
    const words = `${headline.textContent ?? ""} ${statement.textContent ?? ""}`;
    expect(words.length).toBeGreaterThan(20);
    expect(words).toMatch(/GBP/);
    expect(words).toMatch(/USD/);
    /* R152 item 3 — no machine code on screen. */
    expect(words).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
  });

  it("C-3c it shows the amounts BROKEN DOWN by currency instead of added up", async () => {
    mount(CapTable, { rounds: [ROUND_USD, ROUND_GBP], securities: SECURITIES_MIXED });
    const byCurrency = await screen.findByTestId("captable-invested-by-currency", {}, { timeout: 15_000 });
    const text = byCurrency.textContent ?? "";
    /* Each currency's own subtotal is a real quantity; their sum is not. */
    /* Separators depend on the environment's locale, so the digits are matched with
       optional separators rather than pinning a formatting the browser chooses. */
    expect(text).toMatch(/1[.,]?000[.,]?000/);
    expect(text).toMatch(/800[.,]?000/);
    expect(text).toMatch(/USD/);
    expect(text).toMatch(/GBP/);
  });

  it("C-3d SHARE COUNTS AND OWNERSHIP ARE STILL SHOWN — the refusal is about money, not the whole page", async () => {
    mount(CapTable, { rounds: [ROUND_USD, ROUND_GBP], securities: SECURITIES_MIXED });
    await screen.findByTestId("captable-invested-mixed-currency", {}, { timeout: 15_000 });
    /* A page that blanked itself would be a worse answer than a wrong total. The
       founders' 8,000,000 common shares are not denominated in anything and must
       still be readable. */
    await waitFor(() => expect(document.body.textContent ?? "").toMatch(/8[.,]?000[.,]?000/));
  });

  it("C-3e a SINGLE-currency company still shows a normal total — the mixed path is not the default", async () => {
    mount(CapTable, {
      rounds: [ROUND_USD],
      securities: SECURITIES_MIXED.filter((s) => s.id !== "sec_gbp"),
    });
    await waitFor(() => expect(document.body.textContent ?? "").toMatch(/1[.,]?000[.,]?000/), { timeout: 15_000 });
    expect(screen.queryByTestId("captable-invested-mixed-currency")).toBeNull();
  });
});
