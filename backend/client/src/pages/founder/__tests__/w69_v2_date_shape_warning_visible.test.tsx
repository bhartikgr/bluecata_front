/**
 * WAVE 69 · V-2 (owner rulings R56 + R58, row 5) — THE DATE-SHAPE WARNING REACHES
 * THE DOM, AND IS STILL NOT A BLOCK.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * R56 approved a WARNING for a date-shaped value in a money field. Wave 68 built
 * the server half correctly — `dateShapedValueWarning()` in the shared adapter,
 * `termWarnings` on both round writers. And then:
 *
 *     grep -rn "termWarnings" client/  →  ZERO non-test hits
 *
 * Wave 68's own test header admitted it: "NO CLIENT SURFACE RENDERS
 * `termWarnings`. The channel is server-side only." So a founder typing `20260707`
 * into a valuation cap set a $20.2M cap in complete silence.
 *
 * ── WHAT R56 MAKES THIS TEST RESPONSIBLE FOR ────────────────────────────────
 * Three things, and the last two matter as much as the first:
 *   · the warning is VISIBLE (pole A, and pole D for the server's own copy);
 *   · it is NARROW — 7 digits, 9 digits and an invalid leap day are SILENT
 *     (pole B). "A warning that fires on legitimate input is worse than none";
 *   · it is NOT A BLOCK — Save stays enabled and the PATCH is issued (pole C).
 *     R56: "This is explicitly NOT R42 — that ruling blocks, this one warns, and
 *     the two must not be conflated." If a later wave folds this into
 *     `editTermsOutOfRange`, pole C is what fails.
 *
 * Expected text is IMPORTED from the shared function, never re-typed (R21).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Rounds from "../Rounds";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { dateShapedValueWarning } from "@shared/roundMathEngineAdapter";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w69_v2",
  useActiveCompany: () => ({ id: "co_w69_v2", name: "W69 Co" }),
}));

const SAFE_ROUND = {
  id: "rnd_w69_v2_safe",
  company: "co_w69_v2",
  name: "W69 SAFE",
  type: "seed",
  state: "open",
  targetAmount: 500_000,
  raisedAmount: 0,
  preMoney: null,
  postMoney: null,
  pricePerShare: null,
  minTicket: 10_000,
  closeDate: "2026-12-31",
  termsSummary: "",
  instrument: "safe",
  valuationCap: 8_000_000,
  discount: 20,
  interestRate: null,
  maturityMonths: null,
  strikePrice: null,
  expiryYears: null,
  mfn: false,
  archivedAt: null,
  createdAt: "2026-01-01",
};

let patchResult: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true, eventType: "round.terms_updated" },
};
let patchBodies: unknown[] = [];

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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/rounds?")) return res(200, [SAFE_ROUND]);
      if (/\/api\/rounds\/[^/]+\/terms$/.test(u)) {
        patchBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return res(patchResult.status, patchResult.body);
      }
      return res(200, {});
    }),
  );
}

function renderPage(withToaster = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Rounds />
        {withToaster && <Toaster />}
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function openDialog() {
  fireEvent.click(await screen.findByTestId(`button-edit-${SAFE_ROUND.id}`));
  await screen.findByTestId("dialog-edit-terms");
}

const WARN_TESTID = "warn-valuation-cap-date-shape";

describe("WAVE 69 · V-2 — R56's date-shape warning is visible, narrow, and never a block", () => {
  beforeEach(() => {
    patchResult = { status: 200, body: { ok: true, eventType: "round.terms_updated" } };
    patchBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — typing 20260707 into the valuation cap renders the shared warning VERBATIM", async () => {
    const EXPECTED = dateShapedValueWarning("valuationCap", 20260707);
    expect(EXPECTED).toBeTruthy();
    renderPage();
    await openDialog();
    /* Silent before: the seeded $8m cap is not date-shaped. */
    expect(screen.queryByTestId(WARN_TESTID)).toBeNull();
    fireEvent.change(screen.getByTestId("input-valuation-cap"), { target: { value: "20260707" } });
    const node = await screen.findByTestId(WARN_TESTID);
    expect(node.textContent).toBe(EXPECTED);
    /* R56: never phrased as an error. */
    expect((node.textContent ?? "").toLowerCase()).not.toContain("error");
    expect((node.textContent ?? "").toLowerCase()).not.toContain("invalid");
  });

  it("POLE B — R56 narrowness: 7 digits, 9 digits and an invalid leap day are SILENT", async () => {
    renderPage();
    await openDialog();
    for (const value of ["2026070", "202607070", "20260229"]) {
      fireEvent.change(screen.getByTestId("input-valuation-cap"), { target: { value } });
      /* Asserted against the shared function's own verdict, so the test cannot
         drift away from the rule it is policing. */
      expect(dateShapedValueWarning("valuationCap", Number(value))).toBeNull();
      expect(screen.queryByTestId(WARN_TESTID)).toBeNull();
    }
    /* And the one that DOES warn, in the same test, so a vacuous pass is impossible. */
    fireEvent.change(screen.getByTestId("input-valuation-cap"), { target: { value: "20240229" } });
    expect((await screen.findByTestId(WARN_TESTID)).textContent).toBe(
      dateShapedValueWarning("valuationCap", 20240229),
    );
  });

  it("POLE C — it is a WARNING, NOT A BLOCK: Save stays enabled and the PATCH is issued", async () => {
    renderPage();
    await openDialog();
    fireEvent.change(screen.getByTestId("input-valuation-cap"), { target: { value: "20260707" } });
    await screen.findByTestId(WARN_TESTID);
    const save = screen.getByTestId("button-save-terms") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    /* The R42-style block panel must NOT appear: this is not a refusal. */
    expect(screen.queryByTestId("edit-save-blocked-term-range")).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(patchBodies.length).toBe(1));
    /* The value is stored EXACTLY AS WRITTEN — not corrected, not dropped. */
    expect((patchBodies[0] as { valuationCap?: number }).valuationCap).toBe(20260707);
  });

  it("POLE D — the server's own `termWarnings` array now reaches the DOM (the dead channel)", async () => {
    const SENTENCE = dateShapedValueWarning("valuationCap", 20260707) as string;
    patchResult = {
      status: 200,
      body: { ok: true, eventType: "round.terms_updated", termWarnings: [SENTENCE] },
    };
    renderPage(true);
    await openDialog();
    fireEvent.click(screen.getByTestId("button-save-terms"));
    /* Rendered by the REAL toast store + REAL <Toaster/>. Before this wave nothing
       in `client/` referenced `termWarnings` at all, so this could not appear. */
    await waitFor(() => expect(screen.getAllByText(SENTENCE).length).toBeGreaterThanOrEqual(1));
    await screen.findByText("Saved — one thing to check");
  });
});
