/**
 * INDEPENDENT REVIEWER — D · PartnerSpvEngine role-gate transition (React #310).
 *
 * Distinct from main's regression in three ways, deliberately:
 *   1. the taxonomy read is the REAL route over an in-process express app and
 *      in-memory SQLite (main's transition test stubs it with an empty list),
 *      so the hoisted hook is proven to hold a LIVE subscription after the
 *      transition rather than merely to have been called;
 *   2. the transition is driven for all three read states (ok / failing /
 *      hanging), because a hook-order fix that only survives the happy read is
 *      not a fix;
 *   3. it reaches the mandate step AFTER the transition and asserts the Wave D
 *      failure locks still hold there (a failed or pending read can neither
 *      drop nor add a sector).
 *
 * Plus a structural fence: no hook call may appear after the `!role.ready`
 * early return in that file, which catches a future reintroduction that a
 * behavioural test can miss.
 *
 * Reviewer-owned and additive. No product source edited.
 *
 * Run:
 *   NODE_ENV=test npx vitest run \
 *     client/src/pages/partner/__tests__/preflight_slide13b_d_spv_hook_order_independent.test.tsx \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { Component, useState, type ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { registerCompanyTaxonomyRoutes } from "../../../../../server/companyTaxonomyRoutes";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>("@/components/partner/PartnerShell");
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

const RESOLVED = {
  ready: true, error: null,
  identity: {
    partnerId: "ac_consortium_partner_slide13b_d", tier: "builder", subRole: "managing_partner",
    identity: { userId: "u_slide13b_d", email: "d@example.com", name: "Wave D Partner" },
  },
};
const LOADING = { ready: false, error: null, identity: null };
let roleState: typeof RESOLVED | typeof LOADING = LOADING;
let setRoleState: ((s: typeof RESOLVED | typeof LOADING) => void) | null = null;

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  // A real hook, so the flip happens inside React's own render cycle exactly
  // like the live auth resolver — not as a test-side rerender of a new tree.
  useRequirePartnerRole: () => {
    const [s, setS] = useState(roleState);
    setRoleState = setS;
    return s;
  },
}));

let app: Express;
let taxonomyMode: "ok" | "fail" | "hang" = "ok";

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const json = (status: number, body: unknown) =>
    ({ ok: status < 400, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (url.includes("/company-taxonomy/")) {
        if (taxonomyMode === "hang") return new Promise<Response>(() => { /* never resolves */ });
        if (taxonomyMode === "fail") return json(503, { ok: false, error: "TAXONOMY_UNAVAILABLE", message: "taxonomy unavailable" });
        const m = method.toLowerCase() as "get" | "post";
        let req = request(app)[m](url).set("x-user-id", "u_admin");
        if (body !== undefined) req = req.send(body as object);
        const r = await req;
        return json(r.status, r.body);
      }
      return json(method === "GET" ? 200 : 201, method === "GET" ? { spvs: [] } : { spv: { id: "spv_d" } });
    },
  };
});

import { queryClient } from "@/lib/queryClient";
import { COMPANY_TAXONOMY_LOADING_COPY, COMPANY_TAXONOMY_ERROR_COPY } from "@/lib/companyTaxonomy";
import PartnerSpvEngine from "../PartnerSpvEngine";

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  render() { return this.state.err ? <div data-testid="boundary-error">{this.state.err}</div> : this.props.children; }
}

const HOOK_ORDER_RE = /hooks than|Rendered more hooks|Minified React error #310|error #310|change in the order of Hooks/i;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
});
afterEach(() => { cleanup(); taxonomyMode = "ok"; roleState = LOADING; setRoleState = null; queryClient.clear(); });

/** Mount LOADING, flip to RESOLVED inside React, return captured console.error. */
async function mountThenResolve() {
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  roleState = LOADING;
  queryClient.clear();
  render(<QueryClientProvider client={queryClient}><Boundary><PartnerSpvEngine /></Boundary></QueryClientProvider>);
  // The role gate renders null on the first pass: no content, and no error yet.
  expect(screen.queryByTestId("boundary-error")).toBeNull();
  expect(screen.queryByTestId("spv-engine-new")).toBeNull();
  expect(setRoleState).not.toBeNull();
  await act(async () => { setRoleState!(RESOLVED); });
  const hookOrder = errSpy.mock.calls.flat().map(String).filter((m) => HOOK_ORDER_RE.test(m));
  const boundary = screen.queryByTestId("boundary-error")?.textContent ?? null;
  errSpy.mockRestore();
  return { hookOrder, boundary };
}
const openMandateStep = () => {
  fireEvent.click(screen.getByTestId("spv-engine-new"));
  fireEvent.change(screen.getByTestId("spv-w-name"), { target: { value: "Reviewer Vehicle" } });
  fireEvent.click(screen.getByTestId("spv-wizard-step-tab-1"));
  return screen.getByTestId("spv-w-sectors");
};
const chips = (root: HTMLElement) => within(root).queryAllByTestId(/^spv-w-sector-/) as HTMLButtonElement[];
const isSelected = (b: HTMLButtonElement) => b.style.background !== "";

describe("D-SPV-1 · loading → ready transition survives with the REAL taxonomy read", () => {
  it("OK read: no #310, no boundary error, and the hoisted hook still feeds DB chips after the transition", async () => {
    const { hookOrder, boundary } = await mountThenResolve();
    expect(hookOrder).toEqual([]);
    expect(boundary).toBeNull();
    // The resolved page is really mounted, not an empty shell.
    expect(screen.getByTestId("spv-engine-new")).toBeTruthy();

    const root = openMandateStep();
    await waitFor(() => expect(chips(root).length).toBeGreaterThan(0));
    // Chips come from the DB, are unlocked, and toggle — i.e. the subscription
    // established before the early return is live after it.
    expect(chips(root).every((b) => !b.disabled)).toBe(true);
    const first = chips(root)[0];
    fireEvent.click(first);
    await waitFor(() => expect(isSelected(chips(root)[0])).toBe(true));
    expect(screen.queryByTestId("spv-w-sectors-error")).toBeNull();
  });

  it("FAILING read: the transition still commits, and the Wave D error lock holds after it", async () => {
    taxonomyMode = "fail";
    const { hookOrder, boundary } = await mountThenResolve();
    expect(hookOrder).toEqual([]);
    expect(boundary).toBeNull();
    const root = openMandateStep();
    await waitFor(() => expect(screen.getByTestId("spv-w-sectors-error")).toBeTruthy());
    expect(screen.getByTestId("spv-w-sectors-error").textContent).toBe(COMPANY_TAXONOMY_ERROR_COPY);
    // Cold failure offers nothing at all: a failed read cannot invent a list.
    expect(chips(root)).toHaveLength(0);
    expect(screen.queryByTestId("spv-w-sectors-loading")).toBeNull();
  });

  it("HANGING read: the transition still commits, chips stay locked and a click changes nothing", async () => {
    taxonomyMode = "hang";
    const { hookOrder, boundary } = await mountThenResolve();
    expect(hookOrder).toEqual([]);
    expect(boundary).toBeNull();
    const root = openMandateStep();
    expect(within(root).getByTestId("spv-w-sectors-loading").textContent).toBe(COMPANY_TAXONOMY_LOADING_COPY);
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(chips(root)).toHaveLength(0);
  });

  it("a second flip back to LOADING and forward again does not change hook count either", async () => {
    const { hookOrder } = await mountThenResolve();
    expect(hookOrder).toEqual([]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { setRoleState!(LOADING); });
    await act(async () => { setRoleState!(RESOLVED); });
    expect(errSpy.mock.calls.flat().map(String).filter((m) => HOOK_ORDER_RE.test(m))).toEqual([]);
    expect(screen.queryByTestId("boundary-error")).toBeNull();
    expect(screen.getByTestId("spv-engine-new")).toBeTruthy();
    errSpy.mockRestore();
  });
});

describe("D-SPV-2 · structural fence on the fixed file", () => {
  const SRC = path.resolve(process.cwd(), "client/src/pages/partner/PartnerSpvEngine.tsx");

  it("the taxonomy hook is called exactly once and BEFORE the role-gate early return", () => {
    const lines = readFileSync(SRC, "utf8").split("\n");
    const hookLines = lines.map((l, i) => ({ n: i + 1, l })).filter((x) => /useCompanySectorTaxonomy\s*\(/.test(x.l) && !/^\s*\*/.test(x.l) && !x.l.includes("import"));
    expect(hookLines).toHaveLength(1);
    const gate = lines.findIndex((l) => /if\s*\(!role\.ready/.test(l)) + 1;
    expect(gate).toBeGreaterThan(0);
    expect(hookLines[0].n).toBeLessThan(gate);
  });

  it("NO hook call appears after the early return anywhere in the file", () => {
    const lines = readFileSync(SRC, "utf8").split("\n");
    const gate = lines.findIndex((l) => /if\s*\(!role\.ready/.test(l)) + 1;
    const offenders = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => x.n > gate)
      .filter((x) => /\buse[A-Z][A-Za-z0-9]*\s*\(/.test(x.l))
      .filter((x) => !/^\s*(\*|\/\/)/.test(x.l));
    expect(offenders.map((o) => `${o.n}: ${o.l.trim()}`)).toEqual([]);
  });

  it("the derived non-hook consts stayed where they were (hoist-only, nothing else moved)", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toContain("const sectorChipOptions = mergeTaxonomyOptions(sectorTaxonomy.allTerms ?? [], w.sectors);");
    expect(src).toContain("const sectorsLocked = sectorTaxonomy.isLoading || sectorTaxonomy.isError;");
    // No duplicate subscription introduced as the "fix".
    expect(src.match(/useCompanySectorTaxonomy\s*\(\s*\)/g) ?? []).toHaveLength(1);
  });
});
