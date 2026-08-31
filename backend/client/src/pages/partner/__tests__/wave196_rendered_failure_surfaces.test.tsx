/* ════════════════════════════════════════════════════════════════════════════
   WAVE 196 · RENDERED-DOM PROOF — R137 / R137.1.
   ════════════════════════════════════════════════════════════════════════════
   R137 exists because an LP-facing fix once passed every test and never reached
   the LP: the test mounted a store instead of the component. So nothing below
   mounts an extracted layer. Group A mounts the REAL `LpPositions` and Group B
   mounts the REAL default export of `PartnerBilling`, and every assertion reads
   text out of the rendered DOM.

   ── WHY `fetch` IS STUBBED AND `apiRequest` IS NOT ──────────────────────────
   The defect this wave fixes lives BETWEEN the two. `apiRequest` calls a bare
   `fetch` and only then `throwIfResNotOk`, so a transport `TypeError` never meets
   the sanitiser; and mutation call sites `.json()` outside `apiRequest`, so a
   body-parse `SyntaxError` never meets it either. Mocking `apiRequest` would mock
   away the exact seam under test. Stubbing `fetch` drives the REAL boundary: the
   real `apiRequest`, the real `throwIfResNotOk`, the real `ApiError`.

   ── ANTI-VACUITY IS THE DESIGN ──────────────────────────────────────────────
   "the false empty state is absent" is passed by a component that renders
   nothing, and by one that crashed. Every negative assertion below is therefore
   paired with a positive one on the SAME mounted screen, and each group also
   mounts the SUCCESS path to prove the existing copy still renders byte-verbatim
   (R143.1 — the empty state was narrowed, never reworded).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
/* WAVE 203 (R178.7) — `W203_HONEST_READ_COPY` is the wording a READ failure now
   prints. `FAILURE_COPY` is still imported: the write assertions below are
   unchanged, and its read strings still exist unmodified (R143.1). */
import { FAILURE_COPY, W203_HONEST_READ_COPY } from "@/lib/failureMessage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── the seams a jsdom page cannot have ───────────────────────────────────── */
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    /* The Invoices tab is selected the way the page itself selects it — through
       `?tab=`, wave 180's source of truth — not by lifting the panel out. */
    useSearch: () => "?tab=invoices",
    useLocation: () => ["/collective/partner/billing", vi.fn()],
    useRoute: () => [false, {}],
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_partner_w196",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w196", email: "partner@example.com", name: "W196 Partner" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

import PartnerBilling from "../PartnerBilling";
import * as PartnerBillingModule from "../PartnerBilling";
import { LpPositions } from "@/components/investor/LpPositions";

/* ── response helpers ─────────────────────────────────────────────────────── */
function jsonRes(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => jsonRes(status, body),
  } as unknown as Response;
}

/** A reply that arrived but is NOT JSON — the live proxy/platform error page.
 *  `json()` throws the real engine `SyntaxError`; nothing is faked. */
function htmlRes(): Response {
  const text = '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>';
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => htmlRes(),
  } as unknown as Response;
}

type Mode = "ok" | "network" | "html" | "500" | "sqlite" | "stack";
let MODE: Mode = "ok";
let LP_BODY: unknown = { positions: [], collectiveScope: "none" };
let BILLING_BODY: unknown = { entries: [] };
let SPVFEES_BODY: unknown = { entries: [] };

/** THE REAL TRANSPORT FAILURE. A browser `fetch` that cannot complete rejects
 *  with a `TypeError` — it does not resolve with a status. */
function networkFailure(): never {
  throw new TypeError("Failed to fetch");
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (MODE === "network") networkFailure();
      if (MODE === "html") return htmlRes();
      if (MODE === "500") return jsonRes(500, { error: "internal", message: "boom" });
      /* The two raw-exception bodies real handlers emit. Not invented shapes:
         `{ ok: false, error: "…_failed", message: (err as Error).message }`. */
      if (MODE === "sqlite") {
        return jsonRes(500, {
          ok: false,
          error: "read_failed",
          message: "SQLITE_ERROR: no such table: spv_subscription",
        });
      }
      if (MODE === "stack") {
        return jsonRes(500, {
          ok: false,
          error: "read_failed",
          message: "TypeError: cannot read x at /home/app/server/spvEngineStore.ts:630:12",
        });
      }
      if (u.includes("lp-positions")) return jsonRes(200, LP_BODY);
      if (u.includes("/api/partner/me/billing")) return jsonRes(200, BILLING_BODY);
      if (u.includes("spv-fee") || u.includes("fees")) return jsonRes(200, SPVFEES_BODY);
      return jsonRes(200, {});
    }),
  );
}

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
const mountLp = () =>
  render(
    <QueryClientProvider client={qc()}>
      <LpPositions />
    </QueryClientProvider>,
  );
const mountBilling = () =>
  render(
    <QueryClientProvider client={qc()}>
      <PartnerBilling />
    </QueryClientProvider>,
  );

beforeEach(() => {
  MODE = "ok";
  LP_BODY = { positions: [], collectiveScope: "none" };
  BILLING_BODY = { entries: [] };
  SPVFEES_BODY = { entries: [] };
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 0 — the fence. This file must keep mounting the real modules.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 196 · 0 — the mounted components are the real modules", () => {
  it("0a PartnerBilling under test IS the module's default export", () => {
    expect(PartnerBilling).toBe(PartnerBillingModule.default);
    expect(typeof PartnerBilling).toBe("function");
  });

  it("0b the invoices panel really mounts (real page chrome is in the DOM)", async () => {
    mountBilling();
    await screen.findByTestId("partner-billing-tabs");
    expect(screen.getByTestId("tab-invoices")).toBeTruthy();
    await screen.findByTestId("invoices-download-csv");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP A — ITEM B2. An LP's failed positions read no longer looks like
   holding nothing.
   ══════════════════════════════════════════════════════════════════════════ */
const LP_POSITION = {
  spvId: "spv_w196",
  spvName: "W196 Vehicle I",
  jurisdiction: "delaware",
  status: "deployed",
  committedMinor: 5000000,
  fundedMinor: 5000000,
  currency: "USD",
  navMinor: 5500000,
  navAsOfDate: "2026-06-30",
  navBadge: "fresh",
  navRefusalCopy: null,
  hasSideLetter: false,
  refusalCopy: null,
};

describe("WAVE 196 · A — LpPositions distinguishes a failed load from holding nothing", () => {
  it("A1 BEFORE-STATE FENCE: with zero positions the component still renders nothing at all", async () => {
    LP_BODY = { positions: [], collectiveScope: "none" };
    const { container } = mountLp();
    await waitFor(() => expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.textContent).toBe(""));
    /* The deliberate design, unchanged: a direct cap-table investor's portfolio
       is untouched by this capability. */
    expect(screen.queryByTestId("investor-lp-positions")).toBeNull();
    expect(screen.queryByTestId("investor-lp-positions-load-failed")).toBeNull();
  });

  it("A2 a transport failure renders a NAMED error block, not a blank space", async () => {
    MODE = "network";
    const { container } = mountLp();
    const node = await screen.findByTestId("investor-lp-positions-error");
    expect(node.getAttribute("role")).toBe("alert");
    /* The exact sentence, read out of the DOM and compared to the exported
       constant — never a retyped string.

       WAVE 203 · PIN REPOINTED, NOT DELETED (R98). Owner ruling R178.7: the
       sentence a read failure prints must no longer claim "what you had is still
       there", because a read can fail precisely because the record is gone. The
       assertion is unchanged in kind — the rendered text must still equal the
       exported constant exactly — and only the constant it names has moved, from
       `FAILURE_COPY.unreachableRead` (which still exists, unmodified) to
       `W203_HONEST_READ_COPY.unreachableRead`. This is the LP-facing surface, so
       it is the one that proves the new wording actually reaches a user. */
    expect(node.textContent?.trim()).toBe(W203_HONEST_READ_COPY.unreachableRead);
    /* And the retired claim is gone from what the LP actually sees. */
    expect(node.textContent).not.toContain("still there");
    /* And it is NOT the blank space the LP used to get. */
    expect(container.textContent).not.toBe("");
    expect(screen.getByTestId("investor-lp-positions-load-failed")).toBeTruthy();
  });

  it("A3 the failure sentence says what happened, that nothing changed, and what to do", async () => {
    MODE = "network";
    mountLp();
    const text = (await screen.findByTestId("investor-lp-positions-error")).textContent ?? "";
    expect(text).toContain("could not be loaded");
    expect(text).toContain("not an empty list");
    expect(text).toContain("nothing has been changed");
    expect(text).toContain("try again");
    /* NEVER an ALL-CAPS underscore code on screen (R143.5). */
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    /* And never the browser's own words. */
    expect(text).not.toContain("Failed to fetch");
  });

  /* FOUND BY THIS TEST, NOT ASSUMED. A 500 whose body is
     `{ message: "<raw exception text>" }` passes `queryClient.looksHuman` and is
     carried on `ApiError.message`. Several server handlers answer exactly that
     way, and one of them is reachable by an ordinary member (W196_BUILD.md, "FOR
     THE OWNER"). The `isMachineFacing` backstop is what stops the SQL fragment
     reaching this LP's screen. */
  it("A4 a 500 carrying a raw SQLite error does NOT put the SQL fragment on an LP's screen", async () => {
    MODE = "sqlite";
    mountLp();
    const text = (await screen.findByTestId("investor-lp-positions-error")).textContent ?? "";
    expect(text).not.toContain("no such table");
    expect(text).not.toContain("spv_subscription");
    expect(text).not.toContain("SQLITE");
    /* And it is not blank either — the LP gets the call site's own sentence. */
    expect(text).toContain("could not be loaded");
    expect(text).toContain("still on record");
  });

  it("A4b a 500 carrying a stack frame and a file path shows neither", async () => {
    MODE = "stack";
    mountLp();
    const text = (await screen.findByTestId("investor-lp-positions-error")).textContent ?? "";
    expect(text).not.toContain("/home/");
    expect(text).not.toContain(".ts:");
    /* Not a bare `"at "` — the honest sentence itself contains "statement that".
       The assertion targets the stack frame, which is `at <path>:<line>`. */
    expect(text).not.toMatch(/\bat\s+\S+:\d+/);
    expect(text).not.toContain("spvEngineStore");
    expect(text).toContain("could not be loaded");
  });

  it("A5 ANTI-VACUITY: a real position still renders its card, and no error block appears", async () => {
    LP_BODY = { positions: [LP_POSITION], collectiveScope: "none" };
    mountLp();
    await screen.findByTestId("investor-lp-positions");
    expect(screen.getByTestId("investor-lp-position-name").textContent).toBe("W196 Vehicle I");
    expect(screen.queryByTestId("investor-lp-positions-error")).toBeNull();
    expect(screen.queryByTestId("investor-lp-positions-load-failed")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP B — ITEM B1. The Invoices tab: the disabled CSV button now says why,
   and the empty state no longer claims an empty ledger over a failed read.
   ══════════════════════════════════════════════════════════════════════════ */
const EMPTY_STATE_TITLE = "No invoice line items yet";

describe("WAVE 196 · B — the Invoices tab tells the truth in all four states", () => {
  it("B1 READ SUCCEEDED, NOTHING THERE — the original empty state still renders, byte-verbatim", async () => {
    BILLING_BODY = { entries: [] };
    SPVFEES_BODY = { entries: [] };
    mountBilling();
    /* R143.1: the wave-73 copy was NARROWED, never reworded. */
    await waitFor(() => expect(screen.getByText(EMPTY_STATE_TITLE)).toBeTruthy());
    expect(screen.queryByTestId("partner-invoices-read-failed")).toBeNull();
    /* The button is disabled AND the reason is now on screen. */
    const btn = screen.getByTestId("invoices-download-csv") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const why = screen.getByTestId("invoices-download-csv-unavailable").textContent ?? "";
    expect(why).toContain("no line items to export yet");
    expect(why).toContain("as soon as a commission or SPV-fee entry is recorded");
    expect(why).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  });

  it("B2 READ FAILED — the empty state is GONE and a load-failure block says so instead", async () => {
    MODE = "network";
    mountBilling();
    const failed = await screen.findByTestId("partner-invoices-read-failed");
    expect(failed.getAttribute("role")).toBe("alert");
    /* WAVE 203 · PIN REPOINTED (R98) — see the note on A2. Same assertion,
       new constant, by R178.7. */
    expect(failed.textContent?.trim()).toBe(W203_HONEST_READ_COPY.unreachableRead);
    expect(failed.textContent).not.toContain("still there");
    /* THE DEFECT, ASSERTED GONE: the platform no longer claims an empty ledger. */
    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
  });

  it("B3 READ FAILED — the disabled CSV button explains itself as a loading failure", async () => {
    MODE = "network";
    mountBilling();
    await screen.findByTestId("partner-invoices-read-failed");
    const btn = screen.getByTestId("invoices-download-csv") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const why = screen.getByTestId("invoices-download-csv-unavailable").textContent ?? "";
    expect(why).toContain("could not be loaded");
    expect(why).toContain("not an empty ledger");
    /* It must NOT be the "nothing there yet" reason — that would be a false claim
       about a partner's money. */
    expect(why).not.toContain("no line items to export yet");
  });

  it("B4 AN UNREADABLE REPLY is distinguished from an unreachable server", async () => {
    MODE = "html";
    mountBilling();
    const failed = await screen.findByTestId("partner-invoices-read-failed");
    /* A non-JSON body reaches `getQueryFn`, which returns null rather than
       throwing, so the read fails as "no data" rather than as a parse error. What
       matters — and is asserted — is that the panel does NOT claim an empty
       ledger and does not print the raw `<!DOCTYPE` fragment. */
    expect(failed.textContent).not.toContain("DOCTYPE");
    expect(failed.textContent).not.toContain("502");
    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
  });

  it("B5 ANTI-VACUITY: with a real line item the table renders, the button ENABLES, and neither notice shows", async () => {
    BILLING_BODY = {
      entries: [
        {
          id: "cmm_w196",
          date: "2026-08-01",
          dealId: "deal_w196",
          commissionMinor: 250000,
          currency: "USD",
          status: "accrued",
        },
      ],
    };
    mountBilling();
    await screen.findByTestId("partner-invoices-table");
    const btn = screen.getByTestId("invoices-download-csv") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("invoices-download-csv-unavailable")).toBeNull();
    expect(screen.queryByTestId("partner-invoices-read-failed")).toBeNull();
    expect(screen.queryByText(EMPTY_STATE_TITLE)).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP C — COMPLETENESS OF THE SWEEP.

   This group is deliberately a SOURCE assertion and is labelled as such: it
   proves the 28 surfaces this wave classified as genuine all route through the
   normaliser, which a DOM test cannot show without driving 28 separate dialogs.
   It is EVIDENCE OF COVERAGE, NOT evidence of rendering — Groups A and B carry
   the rendering proof. Recorded honestly in W196_TESTS.md as such.
   ══════════════════════════════════════════════════════════════════════════ */
const ROOT = resolve(__dirname, "../../../../..");
const SURFACES: Array<[string, number]> = [
  ["client/src/components/partner/SpvDetailTabs.tsx", 9],
  ["client/src/pages/partner/PartnerClientDetail.tsx", 6],
  ["client/src/pages/partner/PartnerPipeline.tsx", 7],
  ["client/src/pages/partner/PartnerSpvs.tsx", 1],
  ["client/src/pages/partner/PartnerBilling.tsx", 3],
  ["client/src/pages/partner/PartnerMessages.tsx", 1],
];

describe("WAVE 196 · C — every surface this wave claimed to fix routes through the normaliser", () => {
  it.each(SURFACES)("C1 %s calls describeFailure at least %i time(s) and imports it", (rel, count) => {
    const src = readFileSync(resolve(ROOT, rel), "utf8");
    expect(src).toContain('from "@/lib/failureMessage"');
    const calls = src.match(/describeFailure\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(count);
  });

  it("C2 the two login sites classified as FALSE POSITIVES were NOT edited", () => {
    /* The brief's warning, made a standing test: three of seven paths given to an
       earlier wave were wrong and one site was already correct. If a later wave
       "fixes" PartnerLogin's branch logic, this goes red and the reviewer is sent
       back to the triage table. */
    const src = readFileSync(resolve(ROOT, "client/src/pages/partner/PartnerLogin.tsx"), "utf8");
    expect(src).not.toContain("failureMessage");
    /* And the reason it needs no fix: the raw text is branched on, never rendered. */
    expect(src).toContain("Network error — try again in a moment.");
    expect(src).toContain("Sign-in failed. Try again in a moment.");
  });

  it("C3 the money-parser site (PartnerSpvEngine wizardMoney) keeps its own sentence", () => {
    /* Surface #27 is not a transport error at all. Normalising it would discard a
       specific, correct money refusal. */
    const src = readFileSync(resolve(ROOT, "client/src/pages/partner/PartnerSpvEngine.tsx"), "utf8");
    expect(src).toContain('return { ok: false, message: (e as Error).message };');
  });
});
