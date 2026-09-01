/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 245 — ONE FORMATTING BEHAVIOUR FOR AMOUNTS, AND NOT ONE CENT MOVED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, AS IT STOOD IN THE CODE
 * -----------------------------------
 * `InvitationDetail.tsx:1587` bound the "Investment amount (USD)" box straight
 * to state — `value={amount}`, with `useState("250000")` at :435 — so the box
 * read a bare `250000`. Three lines lower the attestation sentence (:1612), the
 * submit button (:1677) and the confirm dialog (:1778) all rendered the SAME
 * figure through `fmtUSD(...)` as `$250,000`. Two spellings of one number, six
 * inches apart. Meanwhile the founder round wizard had grouped its eight money
 * inputs live since v23.9 C3.
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS
 * -------------------------------------
 * The wave's instruction was not merely "add commas". It was: pick the founder
 * wizard's behaviour, extend the existing formatter and never write a second
 * one, and PROVE no amount changes — formatting must not become parsing.
 *
 * That last clause is the whole risk, and it is a money risk, not a cosmetic
 * one. `amount` is read as `Number(amount) || 0` in FIVE places on this page:
 * the attestation sentence, the `intentText`, the decision PATCH body, the
 * signature payload and two emitted event payloads. `Number("250,000")` is
 * `NaN`. `NaN || 0` is `0`. So the single laziest possible version of this fix —
 * group the display and let the grouped text flow back into state — would cause
 * the platform to record a soft-circle of ZERO DOLLARS in the investor's own
 * signed attestation text and in the persisted payload, while the screen
 * continued to show `$250,000`. Silent, and about money.
 *
 * So the tests below do not assert commas. They assert what leaves the page:
 *  · W245-3 captures the real PATCH body off the stubbed `fetch` and asserts the
 *    `amount` field.
 *  · W245-4 asserts the DEFAULT amount submits identically to the pre-wave value,
 *    which is the "no amount changed" claim in its most literal form.
 *  · W245-5 drives a grouped, spaced, `$`-prefixed string — the worst thing a
 *    human can paste — and requires the submitted number to be right.
 * A test that only read the input's `value` attribute would pass on the broken
 * version of this fix. That is the inert mechanism this file is built to avoid.
 *
 * NOT A REPLICA: the real `InvitationDetail` default export is mounted, the same
 * one the router mounts, and the real `RoundNew` default export is mounted in
 * W245-8. `fetch` is stubbed because there is no server in jsdom — the harness
 * is copied from `w122_investor_money_and_currency.test.tsx`, which established
 * it for this exact page. Nothing about the formatting behaviour is stubbed.
 *
 * R90 — no authentication or session behaviour is asserted. R92/R93 — only this
 * wave's own surfaces are mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import InvitationDetail from "../InvitationDetail";
import RoundNew from "../../founder/RoundNew";
import { RoleProvider } from "@/lib/role";
import { getQueryFn } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { formatMoneyInputDisplay, stripMoneyInputGrouping } from "@/lib/money/moneyInputFormat";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
}
if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

const INV_ID = "inv_w245";
const ROUND_ID = "rnd_w245";
const REPO = path.resolve(__dirname, "../../../../..");

/** THE PRE-WAVE DEFAULT. `InvitationDetail.tsx:435` is `useState("250000")`, and
 *  before wave 245 the submitted amount for an untouched form was
 *  `Number("250000") || 0` === 250000. That number is the baseline every "no
 *  amount changed" assertion in this file is measured against. */
const PRE_WAVE_DEFAULT_AMOUNT = 250000;

vi.mock("@/lib/realtimeSync", () => ({
  useRealtimeSync: () => {},
  realtimeSync: { start: () => {}, stop: () => {} },
}));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useParams: () => ({ id: INV_ID }),
    /* THE DECISION TAB IS URL-DRIVEN, NOT CLICK-DRIVEN. `InvitationDetail.tsx:313`
       computes `activeTab = parseTabParam(search)` straight from the query string,
       and `onValueChange` navigates rather than setting local state. The first
       version of this file clicked `tab-decision` and every mounted test failed to
       find `input-amount` — correctly, because with a stubbed `useSearch` the tab
       can never change. So the real route parameter is supplied instead, which is
       also the truer proof: this is the URL a real investor lands on. */
    useSearch: () => "?tab=decision",
    useLocation: () => [`/investor/invitations/${INV_ID}?tab=decision`, () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

vi.mock("@/lib/investor/investorSpine", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/investor/investorSpine");
  return {
    ...actual,
    useInvestorSpine: () => ({
      allInvitations: [{ id: INV_ID, stage: "invited", raw: { id: INV_ID, expiresAt: null } }],
      pendingInvitations: [{ id: INV_ID, stage: "invited", raw: { id: INV_ID, expiresAt: null } }],
      softCircledInvitations: [],
      isLoading: false,
      isError: false,
    }),
  };
});

/* The founder wizard needs an active company with a default currency or it
   stalls on step 1 (documented in build_log/wave212). Only used by W245-8. */
/* Shape copied verbatim from `w212_round_creation_signoff_dom.test.tsx`, which
   established it for this wizard. `defaultCurrency` is mandatory — without it the
   wizard stalls on step 1 waiting for a currency (build_log/wave212). */
vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w245",
  useActiveCompany: () => ({
    isLoading: false,
    data: {
      company: {
        id: "co_w245",
        companyName: "Helios Robotics",
        defaultCurrency: "USD",
        billing: { plan: "founder_pro" },
      },
    },
  }),
}));

type Row = Record<string, unknown>;

function baseRow(overrides: Row = {}): Row {
  return {
    id: INV_ID,
    company: { id: "co_w245", name: "Helios Robotics", sector: "Industrial", description: "Autonomous inspection." },
    round: { id: ROUND_ID, name: "Series A", type: "series_a" },
    state: "invited",
    receivedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    closeDate: null,
    roundState: "soft_circle_open",
    targetAmount: 5_000_000,
    raisedAmount: null,
    currency: "USD",
    minTicket: 100_000,
    preMoney: 18_000_000,
    hasProRata: false,
    ...overrides,
  };
}

let ROW: Row = baseRow();
/** Every non-GET request the page makes, in order, with its parsed body. This is
 *  the evidence surface for the money proofs. */
let SENT: Array<{ url: string; method: string; body: unknown }> = [];

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
    headers: { get: () => "application/json" },
  } as unknown as Response;
}

function installFetch() {
  SENT = [];
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      let parsed: unknown = undefined;
      try { parsed = init?.body ? JSON.parse(String(init.body)) : undefined; } catch { parsed = String(init?.body); }
      SENT.push({ url: u, method, body: parsed });
    }
    if (u === `/api/investor/invitations/${INV_ID}`) return res(200, ROW);
    if (u === "/api/investor/invitations" || u.startsWith("/api/investor/invitations?")) return res(200, [ROW]);
    if (u.includes("/api/auth/me")) return res(200, { id: "u_i", displayName: "Investor", role: "investor" });
    if (u.includes("/accreditation")) return res(200, { accredited: true });
    if (u.includes("/api/investor/profile")) return res(200, { id: "ip_1", accredited: true });
    if (u.includes("/wire-instructions")) return res(404, { message: "Not found" });
    if (u.includes("/decision")) return res(200, { record: null, ok: true });
    if (u.includes("/api/investor/ma/intelligence")) return res(200, { acquirerFitScore: 10 });
    /* The founder wizard reads `profileQ.data?.legal.region` at RoundNew.tsx:1143 —
       note the optional chain stops at `data`, so `legal` MUST be an object or the
       wizard throws "Cannot read properties of undefined (reading 'region')".
       Found by running the test, not by reading ahead. */
    if (u.includes("/profile")) return res(200, { legal: { region: "US" }, company: { id: "co_w245" } });
    if (u.startsWith("/api/rounds/name-availability")) return res(200, { available: true });
    if (u.includes("/securities")) return res(200, []);
    if (u.includes("investor-crm")) return res(200, { contacts: [] });
    if (u.includes("/api/companies")) return res(200, [{ companyId: "co_w245", companyName: "Helios Robotics", defaultCurrency: "USD" }]);
    if (method !== "GET") return res(200, { ok: true });
    return res(200, []);
  }));
}

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "returnNull" }) } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>{ui}<Toaster /></TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Mount the detail page and land on the decision tab, returning the real
 *  amount input. */
async function openDecisionTab(): Promise<HTMLInputElement> {
  mount(<InvitationDetail />);
  /* Assert we really are on the decision tab before looking for the field, so a
     future routing change surfaces as "the tab did not open" rather than as a
     confusing missing-element error. */
  await waitFor(() => screen.getByTestId("tab-decision"));
  return await waitFor(() => screen.getByTestId("input-amount") as HTMLInputElement);
}

/** Type into the real input the way a human does — one change event carrying the
 *  full text, which is what a paste or a completed edit produces. */
function typeAmount(el: HTMLInputElement, text: string): void {
  fireEvent.change(el, { target: { value: text } });
}

beforeEach(() => {
  ROW = baseRow();
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ══ W245-1 · THE TWO SPELLINGS ARE NOW ONE ════════════════════════════════ */

describe("W245-1 — the input and the sentence beneath it spell the amount the same way", () => {
  it("shows the grouped figure in the box, matching the submit button", async () => {
    const el = await openDecisionTab();

    /* The defect in one assertion: before this wave the box read "250000" while
       the button read "$250,000". */
    expect(el.value).toBe("250,000");
    expect(el.value).not.toBe("250000");

    const button = screen.getByTestId("button-submit-softcircle");
    expect(button.textContent).toMatch(/\$250,000/);

    /* The digits and grouping in the box are exactly the digits and grouping the
       button prints — the two spellings really are one now, not merely both
       "formatted somehow". */
    const inButton = (button.textContent ?? "").match(/\$([\d,]+)/)?.[1];
    expect(inButton).toBe(el.value);
  });
});

/* ══ W245-2 · IT IS THE FOUNDER WIZARD'S FORMATTER, NOT A SECOND ONE ═══════ */

describe("W245-2 — one formatter, shared with the founder wizard", () => {
  it("the investor page imports the shared module and defines no formatter of its own", () => {
    const src = readFileSync(path.join(REPO, "client/src/pages/investor/InvitationDetail.tsx"), "utf8");
    expect(src).toMatch(/from "@\/lib\/money\/moneyInputFormat"/);
    /* No second grouping implementation was pasted into this page. The regex is
       the signature of the thousands-grouping replace. */
    expect(src).not.toMatch(/\\B\(\?=\(\\d\{3\}\)/);
  });

  it("the founder wizard now resolves ITS formatter to the shared one", () => {
    const src = readFileSync(path.join(REPO, "client/src/pages/founder/RoundNew.tsx"), "utf8");
    expect(src).toMatch(/from "@\/lib\/money\/moneyInputFormat"/);
    /* The body moved out: the wizard no longer carries its own grouping regex,
       it carries an alias. Both halves asserted, so neither a stray leftover
       copy nor a missing alias passes. */
    expect(src).not.toMatch(/\\B\(\?=\(\\d\{3\}\)/);
    expect(src).toMatch(/const formatWithCommas = formatMoneyInputDisplay;/);
  });

  it("the box's displayed text IS the shared function's output, character for character", async () => {
    const el = await openDecisionTab();

    /* THE LITERAL PIN COMES FIRST, AND IT IS HERE BECAUSE A DISARM CAUGHT ITS
       ABSENCE. The original version of this test asserted only
       `expect(el.value).toBe(formatMoneyInputDisplay("250000"))`, with a comment
       claiming that computing the expected side from the shared function was a
       strength. It is not: disarm D4 breaks the shared function's grouping, and
       under that mutation BOTH SIDES OF THE EQUALITY MOVE TOGETHER to "250000" and
       the test passed. That is an unconditionally-true predicate — one of the nine
       named inert mechanisms — and it was in my own work. The literal below cannot
       move. */
    expect(el.value).toBe("250,000");

    /* AND it is reached through the shared function, not by some parallel route
       that merely looks similar. Both halves are needed: the literal proves the
       output is right, this proves the provenance. */
    expect(el.value).toBe(formatMoneyInputDisplay("250000"));
  });
});

/* ══ W245-3 · THE MONEY PROOF — WHAT LEAVES THE PAGE ══════════════════════ */

describe("W245-3 — formatting did not become parsing: state stays a clean numeric string", () => {
  it("a grouped, spaced, $-prefixed paste still submits the right number", async () => {
    const el = await openDecisionTab();

    /* The worst thing a human can put in this box. Before the strip existed,
       `Number` of any of these is NaN and `|| 0` makes it ZERO. */
    typeAmount(el, "$1,750,000");

    /* Display: grouped and readable. */
    expect(el.value).toBe("1,750,000");

    /* And the sentence the investor is about to SIGN agrees — this is the one
       that matters, because it is the attestation text. It is located by its own
       words rather than by a testid, since adding one to an existing element
       would replace its silent-drop-guard identity key. */
    const body = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(body).toMatch(/indicate my intention to invest \$1,750,000 in/);
    /* The zeroing failure mode, asserted directly and by name. */
    expect(body).not.toMatch(/intention to invest \$0\b/);
    expect(body).not.toMatch(/NaN/);

    const button = screen.getByTestId("button-submit-softcircle");
    expect(button.textContent).toMatch(/\$1,750,000/);
  });

  it("the state behind the box is comma-free — proved through Number(), the way the page reads it", async () => {
    const el = await openDecisionTab();
    typeAmount(el, "2,400,000");

    /* The page reads the amount as `Number(amount) || 0` in five places. The
       only way the button can print $2,400,000 is if that expression evaluated
       to 2400000, which is only possible if state held "2400000". So this
       assertion reaches through the display to the stored characters. */
    const button = screen.getByTestId("button-submit-softcircle");
    expect(button.textContent).toContain("$2,400,000");

    /* Belt and braces: the same claim stated as the arithmetic identity the page
       depends on, so the reasoning above is not the only thing holding it up. */
    expect(Number(stripMoneyInputGrouping("2,400,000"))).toBe(2400000);
    expect(Number("2,400,000")).toBeNaN();
  });
});

/* ══ W245-4 · NO AMOUNT CHANGED — THE DEFAULT ════════════════════════════ */

describe("W245-4 — the untouched form submits exactly the pre-wave amount", () => {
  it("renders the default as $250,000 everywhere and would submit 250000", async () => {
    const el = await openDecisionTab();

    /* A NORMALISING CALL INSIDE AN EQUALITY ASSERTION WAS FOUND HERE BY A DISARM.
       This test originally opened with `expect(stripMoneyInputGrouping(el.value))
       .toBe("250000")`. Disarm D1 reverts the display to the pre-wave
       `value={amount}` — and this test stayed GREEN, because stripping normalises
       away the exact difference between "250000" and "250,000". The strip was
       destroying the evidence before the comparison ran. So the RAW displayed
       string is asserted first, unnormalised: */
    expect(el.value).toBe("250,000");

    /* — and only THEN is the stored value recovered from it. Untouched form, so
       pre-wave this submitted `Number("250000") || 0` === 250000. Both halves are
       now load-bearing: the display half fails if the grouping goes, the value
       half fails if the strip goes. */
    expect(stripMoneyInputGrouping(el.value)).toBe("250000");
    expect(Number(stripMoneyInputGrouping(el.value))).toBe(PRE_WAVE_DEFAULT_AMOUNT);

    /* And every rendered spelling of it agrees. */
    expect(screen.getByTestId("button-submit-softcircle").textContent).toMatch(/\$250,000/);
  });
});

/* ══ W245-5 · A TABLE OF INPUTS, INCLUDING THE ONES THAT BREAK NAIVE FIXES ═ */

describe("W245-5 — round-trip: display then strip returns the original digits", () => {
  const cases: Array<[string, string]> = [
    ["0", "0"],
    ["1", "1"],
    ["50000", "50,000"],
    ["250000", "250,000"],
    ["1750000", "1,750,000"],
    ["1000000000", "1,000,000,000"],
    ["9007199254740993", "9,007,199,254,740,993"],
    ["1234.56", "1,234.56"],
    ["", ""],
  ];

  it.each(cases)("format(%s) === %s, and stripping it returns the input", (raw, displayed) => {
    expect(formatMoneyInputDisplay(raw)).toBe(displayed);
    /* THE ROUND-TRIP IS THE POINT. Formatting is only safe if it is reversible
       without loss, because the reverse is what the page stores. */
    expect(stripMoneyInputGrouping(formatMoneyInputDisplay(raw))).toBe(raw);
  });

  it("survives a value above MAX_SAFE_INTEGER without touching its digits", () => {
    /* 9007199254740993 is MAX_SAFE_INTEGER + 2 and is NOT representable as a
       double — Number() of it returns 9007199254740992. The formatter never
       calls Number, so the digits come back intact. This is the precision claim
       the money rules require, stated as a test rather than as a comment. */
    const big = "9007199254740993";
    expect(stripMoneyInputGrouping(formatMoneyInputDisplay(big))).toBe(big);
    expect(String(Number(big))).not.toBe(big);
  });

  it("never invents, drops or reorders a digit for any random numeric string", () => {
    /* A property, not an example: whatever digits go in come out, in order. */
    for (let i = 0; i < 400; i++) {
      const len = 1 + (i % 18);
      let raw = "";
      for (let d = 0; d < len; d++) raw += String((i * 7 + d * 3) % 10);
      const out = formatMoneyInputDisplay(raw);
      expect(out.replace(/,/g, "")).toBe(raw);
      expect(stripMoneyInputGrouping(out)).toBe(raw);
    }
  });
});

/* ══ W245-6 · THE MOVE WAS VERBATIM, QUIRKS INCLUDED ═════════════════════ */

describe("W245-6 — the shared formatter behaves exactly as the founder wizard's did", () => {
  it("keeps rest.join('') — a second decimal point is swallowed, not preserved", () => {
    /* The first draft of the shared module wrote `rest.join(".")`, which returns
       "1.2.3". That is more "correct" and it is a BEHAVIOUR CHANGE to eight
       existing founder money inputs, smuggled in under a formatting wave. The
       original swallows it. This test pins the original. */
    expect(formatMoneyInputDisplay("1.2.3")).toBe("1.23");
    expect(formatMoneyInputDisplay("1.2.3")).not.toBe("1.2.3");
  });

  it("keeps the trailing-dot and leading-minus quirks", () => {
    expect(formatMoneyInputDisplay("1234.")).toBe("1,234.");
    expect(formatMoneyInputDisplay("-5000")).toBe("-5,000");
    expect(formatMoneyInputDisplay("-")).toBe("-");
    expect(formatMoneyInputDisplay("abc")).toBe("");
  });

  it("is character-identical to the source it was moved from", () => {
    /* Independent of my own copy: re-implement the ORIGINAL body exactly as it
       stood in RoundNew.tsx before the move, and require agreement across a wide
       input set. If the move altered one character of logic, this fails. */
    const original = (raw: string): string => {
      if (raw == null || raw === "") return "";
      const negative = raw.trim().startsWith("-");
      const cleaned = raw.replace(/[^\d.]/g, "");
      if (cleaned === "") return negative ? "-" : "";
      const [intPart, ...rest] = cleaned.split(".");
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const decimal = rest.length > 0 ? "." + rest.join("") : (cleaned.endsWith(".") ? "." : "");
      return (negative ? "-" : "") + grouped + decimal;
    };
    const inputs = ["", "0", "1", "12", "123", "1234", "12345", "1234567", "1234.5", "1234.", "1.2.3", "-1", "-1234", "-", "abc", "abc-5", "$1,000", " 42 ", "0.001", "9007199254740993", ".5", "..", "1..2"];
    for (const i of inputs) expect(formatMoneyInputDisplay(i)).toBe(original(i));
  });
});

/* ══ W245-7 · THE STRIP AND THE WIZARD'S INLINE COPY CANNOT DRIFT ════════ */

describe("W245-7 — the shared strip matches the inline strip left in FormattedNumberInput", () => {
  it("agrees with `.replace(/[,\\s$]/g, \"\")` across a table of inputs", () => {
    const inline = (v: string) => v.replace(/[,\s$]/g, "");
    for (const i of ["1,234", "$1,234", " 1 234 ", "1,000,000", "", "abc", "$0", "1.5", "\t9,9\n"]) {
      expect(stripMoneyInputGrouping(i)).toBe(inline(i));
    }
  });

  it("that inline strip is still present in the wizard's source", () => {
    /* A source-level fence, weaker than a behavioural one and labelled as such:
       the wizard's `onChange` expression is deliberately not rewritten (it would
       retire its silent-drop-guard event key), so the two copies are held
       together by this assertion rather than by sharing code. If someone edits
       that handler, this fails and the drift is visible. */
    const src = readFileSync(path.join(REPO, "client/src/pages/founder/RoundNew.tsx"), "utf8");
    expect(src).toContain('e.target.value.replace(/[,\\s$]/g, "")');
  });
});

/* ══ W245-8 · THE FOUNDER WIZARD IS UNHARMED ═════════════════════════════ */

describe("W245-8 — the founder wizard's money inputs still format after the move", () => {
  it("mounts the real wizard and groups the target-raise input as it always did", async () => {
    mount(<RoundNew />);
    /* `input-target` lives on step 2. The wizard's step tabs are free to jump
        (R221.6 protected work, proved in wave 244), so the step-2 tab is clicked
        rather than the form being walked. The tab is found STRUCTURALLY by its
        title text — no data-testid is added to an existing element. */
    const termsTab = await waitFor(() => {
      const hit = Array.from(document.querySelectorAll("ol li button")).find(b => (b.textContent ?? "").includes("Terms"));
      if (!hit) throw new Error("step-2 tab not found");
      return hit as HTMLButtonElement;
    });
    fireEvent.click(termsTab);
    const target = await waitFor(() => screen.getByTestId("input-target") as HTMLInputElement);
    fireEvent.change(target, { target: { value: "18000000" } });
    /* The wizard's own behaviour, driven through the real component after its
       formatter was moved to a shared module. */
    await waitFor(() => expect(target.value).toBe("18,000,000"));
    /* And typing a grouped figure still stores clean digits, so the wizard's
       PATCH payload is unchanged too. */
    fireEvent.change(target, { target: { value: "2,500,000" } });
    await waitFor(() => expect(target.value).toBe("2,500,000"));
    expect(stripMoneyInputGrouping(target.value)).toBe("2500000");
  });
});

/* ══ W245-10 · THE DEFINITIVE MONEY PROOF — THE REAL SUBMITTED PAYLOAD ════ */

describe("W245-10 — the amount that actually leaves the page over the wire", () => {
  /** Drive the real submit path: type the amount, type the legal name, tick the
   *  acknowledgement, click the real submit button, and return every non-GET
   *  request the page made. Everything here is the production handler at
   *  `InvitationDetail.tsx:1648-1655`; nothing is re-implemented. */
  async function submitWith(typed: string): Promise<Array<{ url: string; method: string; body: unknown }>> {
    const el = await openDecisionTab();
    if (typed !== "") typeAmount(el, typed);
    fireEvent.change(screen.getByTestId("input-investor-signer-name"), { target: { value: "Dana Whitfield" } });
    fireEvent.click(screen.getByTestId("checkbox-investor-ack"));
    fireEvent.click(screen.getByTestId("button-submit-softcircle"));
    await waitFor(() => {
      if (!SENT.some(s => s.url.includes("/decision"))) throw new Error(`no decision PATCH was sent; saw ${JSON.stringify(SENT.map(s => s.url))}`);
    });
    return SENT.filter(s => s.url.includes("/decision"));
  }

  it("submits 250000 for an UNTOUCHED form — byte-identical to the pre-wave value", async () => {
    const sent = await submitWith("");
    const body = sent[0].body as { amount?: unknown; currency?: unknown };
    /* THE "NO AMOUNT CHANGED" CLAIM, IN ITS STRONGEST FORM. The form was not
       touched, so before wave 245 this PATCH carried `Number("250000") || 0`.
       It still carries exactly that. */
    expect(body.amount).toBe(PRE_WAVE_DEFAULT_AMOUNT);
    expect(body.amount).toBe(250000);
    expect(typeof body.amount).toBe("number");
    /* Not zeroed, not NaN-collapsed, and the currency is untouched — no
       conversion, no relabelling. */
    expect(body.amount).not.toBe(0);
    expect(Number.isNaN(body.amount as number)).toBe(false);
    expect(body.currency).toBe("USD");
  });

  it("submits 1750000 after a grouped, spaced, $-prefixed paste", async () => {
    const sent = await submitWith("$1,750,000");
    const body = sent[0].body as { amount?: unknown };
    /* This is the assertion the whole wave turns on. If the grouping characters
       had reached state, this would be 0 — and the screen would still have read
       "$1,750,000", which is exactly what makes that failure mode dangerous. */
    expect(body.amount).toBe(1750000);
    expect(body.amount).not.toBe(0);
  });

  it("submits a plain typed figure unchanged, so nothing depends on grouping being present", async () => {
    const sent = await submitWith("333000");
    expect((sent[0].body as { amount?: unknown }).amount).toBe(333000);
  });

  it("the signed intent text carries the same figure as the payload — they cannot disagree", async () => {
    const sent = await submitWith("1,250,000");
    const body = sent[0].body as { amount?: unknown };
    expect(body.amount).toBe(1250000);
    /* `intentText` is built from the SAME `Number(amount) || 0` expression and is
       what the investor is bound by. Asserting the rendered attestation agrees
       with the numeric payload closes the gap between what was shown and what
       was recorded. */
    const shown = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(shown).toMatch(/intention to invest \$1,250,000 in/);
  });
});

/* ══ W245-9 · R221.6 — THE PROTECTED SENTENCE ON THIS PAGE IS INTACT ═════ */

describe("W245-9 — R221.6 protected wording near the change renders verbatim", () => {
  it("the soft-circle attestation still says it is non-binding, in full", async () => {
    await openDecisionTab();
    const body = (document.body.textContent ?? "").replace(/\s+/g, " ");
    /* The ESIGN/UETA-adjacent attestation sits three lines below the edited
       input and interpolates the very value this wave reformats. Asserted
       verbatim because R221.6 forbids degrading it. */
    expect(body).toContain("This soft-circle is a non-binding indication of interest, not a contract.");
    expect(body).toContain("A binding subscription requires definitive transaction documents executed by both parties.");
    expect(body).toContain("indicate my intention to invest");
  });

  it("the field's own label and helper text are untouched", async () => {
    await openDecisionTab();
    const body = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(body).toContain("Investment amount (USD)");
    expect(body).toMatch(/Min ticket \$100,000\. Pro-rata available at \$250k\+\./);
  });
});
