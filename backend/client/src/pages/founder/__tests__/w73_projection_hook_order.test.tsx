/**
 * WAVE 73 · ITEM 7 — THE PROJECTION TAB SURVIVES A COLD CACHE.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, exactly. `ProjectionPanel` declared its holder-list `useQuery`,
 * then returned early
 *
 *     if (!securities.data) return <div…>Loading securities…</div>;
 *
 * and only AFTER that early return declared its second `useQuery` (the Wave 52c
 * pricing-order read). So the FIRST render of a cold mount ran ONE hook and the
 * render after the holder list resolved ran TWO. React compares hook counts
 * between renders of the same component and throws
 *
 *     "Rendered more hooks than during the previous render"
 *
 * which unmounted the whole tab into the app-level ErrorBoundary
 * (`client/src/App.tsx`). A founder opening Round Detail on a cold cache lost the
 * ENTIRE projection tab — not one figure inside it.
 *
 * Found by Wave 72 while trying to mount this panel for a test (F-1 / OQ-1),
 * which is why Wave 72's own render test pre-seeds the query cache and says so in
 * a comment. This file is the opposite: it deliberately does NOT pre-seed, so it
 * mounts exactly the way a browser does.
 *
 * BOTH POLES, because the fix changes the page's mount behaviour:
 *   POLE A · COLD CACHE — neither query is resolved at first paint. The panel
 *            paints its loading state, then RENDERS THE PROJECTION. No hook-order
 *            error is raised, and the pre-close table reaches the DOM.
 *   POLE B · LOADED — with both queries pre-seeded (the case Wave 72 measured)
 *            the rendered output is UNCHANGED: both projection tables, the same
 *            testids, no refusal panel.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { ProjectionPanel } from "../RoundDetail";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const PRICING_ORDER = {
  ok: true,
  pricingOrder: { mode: "w52_post_pool_post_conversion", enabled: true, source: "default", version: null },
  disclosure: { headline: "Pricing order", body: "…" },
};

const ROUND = {
  id: "rnd_w73", companyId: "co_w73", name: "Series A", type: "priced_equity",
  state: "terms_set", preMoney: 30_000_000, targetAmount: 10_000_000, pricePerShare: null,
  currency: "USD",
} as never;

const SECURITIES = [{
  id: "sec_w73", companyId: "co_w73", holderName: "Ada Founder", holderType: "founder",
  instrument: "common", series: null, shares: 8_000_000, pricePerShare: null, investmentAmount: null,
  issuedAt: "2024-01-01",
}];

/** Resolution of the holder-list query is DEFERRED until this is called, so the
    first render genuinely has `securities.data === undefined` — the state the
    hook-order defect needed and the state a cold browser mount is in. */
let releaseSecurities: (() => void) | null = null;

function wire(deferSecurities: boolean) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (/\/securities$/.test(url)) {
      if (deferSecurities) {
        await new Promise<void>((resolve) => { releaseSecurities = resolve; });
      }
      return jsonResponse(SECURITIES);
    }
    if (/pricing-order$/.test(url)) return jsonResponse(PRICING_ORDER);
    return jsonResponse([]);
  });
}

/** Errors React reports through the console during render. A hook-order throw
    lands here as well as being thrown, so it is asserted on directly rather than
    inferred from a missing node. */
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  releaseSecurities = null;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map((a) => String(a)).join(" "));
  });
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  vi.restoreAllMocks();
});

describe("WAVE 73 · ITEM 7 — a cold-cache mount of ProjectionPanel does not crash the tab", () => {
  it("POLE A — COLD CACHE: the panel paints Loading, then the projection REACHES THE DOM, with no hook-order error", async () => {
    wire(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    /* NOTHING is pre-seeded. This is the production cold mount. */
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ProjectionPanel round={ROUND} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    /* First paint: the early return, with the holder query still in flight. This
       is the render that used to run one hook. */
    expect(screen.getByText(/Loading securities/)).toBeTruthy();

    /* Now let the holder list resolve — the second render, which used to run two
       hooks and throw. */
    await waitFor(() => expect(releaseSecurities).not.toBeNull());
    releaseSecurities?.();

    /* THE ASSERTION THAT MATTERS: a real element from the projection is in the
       document after the transition, so the tab did not unmount. */
    await waitFor(() => expect(screen.getByTestId("table-pre")).toBeTruthy());
    expect(screen.getByTestId("badge-engine-projection")).toBeTruthy();
    expect(screen.queryByText(/Loading securities/)).toBeNull();

    /* And the specific crash is absent by name, not merely unobserved. */
    const joined = consoleErrors.join("\n");
    expect(joined).not.toContain("Rendered more hooks than during the previous render");
    expect(joined).not.toContain("Rendered fewer hooks than expected");
  });

  it("POLE B — LOADED: with both queries already resolved the output is unchanged (both tables, no refusal)", async () => {
    wire(false);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    /* The exact pre-seeding Wave 72's render test uses, so this pole measures the
       same page state that wave measured. */
    qc.setQueryData(["/api/companies", "co_w73", "securities"], SECURITIES);
    qc.setQueryData(["/api/founder/round-math/pricing-order", "rnd_w73"], PRICING_ORDER);
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ProjectionPanel round={ROUND} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("table-pre")).toBeTruthy());
    expect(screen.getByTestId("table-post")).toBeTruthy();
    /* No silent drop and no refusal: the loaded page is exactly what it was. */
    expect(screen.queryByTestId("projection-refused")).toBeNull();
    expect(screen.queryByTestId("projection-needs-terms")).toBeNull();
    expect(consoleErrors.join("\n")).not.toContain("Rendered more hooks than during the previous render");
  });

  it("SOURCE — the pricing-order hook is declared ABOVE both early returns", () => {
    /* A structural pin, in addition to the two render poles: the defect class is\n       "a hook below a conditional return", and a future edit that moves it back\n       has to argue with this. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "RoundDetail.tsx"),
      "utf8",
    );
    const panel = src.slice(src.indexOf("export function ProjectionPanel"));
    const hookIdx = panel.indexOf('queryKey: ["/api/founder/round-math/pricing-order"');
    /* The CODE line, not the prose about it: the fix's own comment quotes the
       early return, so a bare substring search would match the comment. */
    const earlyReturnIdx = panel.indexOf('if (!securities.data) return <div className="py-10');
    expect(hookIdx).toBeGreaterThan(0);
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(hookIdx).toBeLessThan(earlyReturnIdx);
  });
});
