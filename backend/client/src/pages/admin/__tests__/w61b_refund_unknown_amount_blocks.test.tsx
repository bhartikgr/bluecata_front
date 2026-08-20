/**
 * WAVE 61b · R42 — A REFUND WITH AN UNKNOWN AMOUNT IS BLOCKED.
 *
 * ── THE DEFECT, quoted from source pre-fix ──────────────────────────────────
 *   const amt = formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD");
 *   window.confirm(`Refund invoice ${inv.id} for ${amt}? This moves real money …`)
 *
 * Two independent fabrications on one line, in a money-moving confirmation:
 *   · an invoice with NO recorded amount was confirmed as `$0.00`;
 *   · an invoice with NO recorded currency was relabelled US dollars.
 * And the row was internally CONTRADICTORY: the amount cell three lines above
 * already rendered `—` for exactly those two cases (Wave 55 · R6), so the screen
 * told the admin the amount was unknown and then offered to refund $0.00 anyway.
 *
 * ── R42, AND ITS TWO BINDING CONDITIONS ────────────────────────────────────
 * The owner authorised an EXCEPTION to the no-silent-drops rule, for this control
 * only, because money leaves the platform. The conditions are asserted here:
 *   1. THE CONTROL MUST REMAIN VISIBLE AND MUST EXPLAIN ITSELF. A hidden button,
 *      or a disabled button with no stated reason, is still a silent drop and is
 *      still forbidden. So: the button still MOUNTS, keeps its `data-testid`, its
 *      LABEL states the reason, and a sibling node names what is missing and
 *      where to resolve it.
 *   2. `$0.00` MUST NEVER BE DISPLAYED AS IF IT WERE THE AMOUNT.
 *
 * ── THE POLE THAT IS THE WHOLE POINT ───────────────────────────────────────
 * A GENUINE `amountMinor: 0` STILL REFUNDS. Zero is a fact; unknown is not. If
 * this wave blocked a real $0.00 invoice it would have replaced a fabrication
 * with a different fabrication.
 *
 * MUTATION TRANSCRIPT: build_log/wave61b/W61B_TESTS.md.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminFeesConsolidated from "../AdminFeesConsolidated";

type Inv = Record<string, unknown> & { id: string };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const posted: Array<{ method: string; url: string }> = [];

function renderLedgerTab(invoices: Inv[]) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (method !== "GET") posted.push({ method, url });
    if (/\/api\/admin\/invoices$/.test(url)) return jsonResponse({ ok: true, invoices });
    if (/\/api\/admin\/payments$/.test(url)) return jsonResponse({ ok: true, items: [], total: 0 });
    return jsonResponse({ ok: true });
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: (async () => ({})) as never }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminFeesConsolidated initialTab="ledger-invoices" />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const btn = (id: string) => screen.getByTestId(`button-refund-invoice-${id}`) as HTMLButtonElement;

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/* Typed loosely on purpose: `vi.spyOn(window, "confirm")` returns a MockInstance
   whose generic parameters differ across vitest minor versions, and pinning them
   here adds a type error to a frozen `tsc` baseline for no test value. */
let confirmSpy: any;

beforeEach(() => {
  posted.length = 0;
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  confirmSpy.mockRestore();
});

/* ── LOWER POLE — the three unknown shapes ──────────────────────────────── */

describe("W61b · R42 — an unknown amount BLOCKS, visibly and with a stated reason", () => {
  it.each([
    ["a NULL amount", { id: "inv_null_amt", status: "paid", amountMinor: null, currency: "USD" }],
    ["a MISSING amount", { id: "inv_no_amt", status: "paid", currency: "USD" }],
    ["a NULL currency", { id: "inv_null_ccy", status: "paid", amountMinor: 12345, currency: null }],
    ["an EMPTY currency", { id: "inv_empty_ccy", status: "paid", amountMinor: 12345, currency: "" }],
  ])("LOWER POLE — %s: the control REMAINS VISIBLE, is disabled, and its label states the reason", async (_name, inv) => {
    renderLedgerTab([inv as Inv]);
    const id = (inv as Inv).id;
    await waitFor(() => expect(screen.getByTestId(`row-invoice-${id}`)).toBeTruthy());

    /* R42 CONDITION 1, first half — the button IS IN THE DOCUMENT. This is the
       assertion that separates an authorised refusal from a silent drop. */
    const b = btn(id);
    expect(b).toBeTruthy();
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe("Refund (amount unknown)");

    /* R42 CONDITION 1, second half — it NAMES what is missing and WHERE to fix it. */
    const why = screen.getByTestId(`refund-blocked-${id}`);
    expect(why.getAttribute("role")).toBe("alert");
    expect(why.textContent).toMatch(/no recorded amount or currency/);
    expect(why.textContent).toMatch(/Record the invoice total and its currency on the invoice/);

    /* R42 CONDITION 2 — no fabricated zero anywhere in the row. */
    expect(screen.getByTestId(`row-invoice-${id}`).textContent).not.toContain("$0.00");
  });

  it("LOWER POLE — clicking the blocked control neither confirms nor mutates", async () => {
    const inv = { id: "inv_click", status: "paid", amountMinor: null, currency: "USD" };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_click")).toBeTruthy());
    fireEvent.click(btn("inv_click"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(posted.filter((p) => /refund/.test(p.url))).toHaveLength(0);
  });

  it("LOWER POLE — the handler ALSO refuses in CODE, not only in the DOM affordance", () => {
    /* ═══════════════════════════════════════════════════════════════════════
       WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL ONE. RECORDED.
       ═══════════════════════════════════════════════════════════════════════
       My first version of this test removed the `disabled` attribute and
       dispatched a click, expecting the handler to run and be refused by the
       `if (!amountKnown) return;` guard. IT PROVED NOTHING: under jsdom + React
       18 the synthetic handler is never reached that way, so the test passed
       whether the guard was present or absent — mutation M16 SURVIVED it.
       (build_log/wave61b/W61B_TESTS.md records the transcript.)

       Rather than leave a test that passes for the wrong reason, the guard is
       pinned where it can actually be observed: in the source. This is an
       honest, weaker proof and it is labelled as one. The `disabled` attribute
       is what stops a real admin; this guard is what stops a future caller, and
       it is here so that a later refactor that re-enables the button cannot
       silently re-open the blind refund. */
    const src = read("client/src/pages/admin/AdminFeesConsolidated.tsx");
    const handler = src.slice(
      src.indexOf("data-testid={`button-refund-invoice-${inv.id}`}"),
      src.indexOf("{!isPaid ? \"Refund (not paid)\""),
    );
    expect(handler).toContain("if (!amountKnown) return;");
    // and the guard sits BEFORE the confirmation is ever built
    expect(handler.indexOf("if (!amountKnown) return;")).toBeLessThan(handler.indexOf("window.confirm"));
  });

  it("LOWER POLE — the DOM affordance is what stops a real admin: a disabled button dispatches nothing", async () => {
    const inv = { id: "inv_dom", status: "paid", amountMinor: null, currency: null };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_dom")).toBeTruthy());
    const b = btn("inv_dom");
    expect(b.disabled).toBe(true);
    b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(posted.filter((p) => /refund/.test(p.url))).toHaveLength(0);
  });
});

/* ── UPPER POLE — everything that must still work ───────────────────────── */

describe("W61b · R42 — a KNOWN amount still refunds, and a GENUINE zero is not blocked", () => {
  it("UPPER POLE — a known amount is enabled, labelled `Refund`, confirms with the REAL figure, and mutates", async () => {
    const inv = { id: "inv_ok", status: "paid", amountMinor: 12345, currency: "USD" };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_ok")).toBeTruthy());

    const b = btn("inv_ok");
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe("Refund"); // byte-identical to the pre-fix label
    expect(screen.queryByTestId("refund-blocked-inv_ok")).toBeNull();

    fireEvent.click(b);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const msg = String(confirmSpy.mock.calls[0][0]);
    expect(msg).toContain("$123.45");
    expect(msg).not.toContain("$0.00");
    expect(msg).toContain("This moves real money and cannot be undone from this screen.");
    await waitFor(() => expect(posted.filter((p) => /invoices\/inv_ok\/refund$/.test(p.url))).toHaveLength(1));
  });

  it("UPPER POLE — A GENUINE $0.00 INVOICE STILL REFUNDS. This is the point of the wave.", async () => {
    const inv = { id: "inv_zero", status: "paid", amountMinor: 0, currency: "USD" };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_zero")).toBeTruthy());

    const b = btn("inv_zero");
    expect(b.disabled).toBe(false);
    expect(b.textContent).toBe("Refund");
    expect(screen.queryByTestId("refund-blocked-inv_zero")).toBeNull();

    fireEvent.click(b);
    /* $0.00 IS printed here — because it is TRUE. `0` is a fact; `unknown` is not.
       The refusal above and this acceptance are the same distinction. */
    expect(String(confirmSpy.mock.calls[0][0])).toContain("$0.00");
    await waitFor(() => expect(posted.filter((p) => /invoices\/inv_zero\/refund$/.test(p.url))).toHaveLength(1));
  });

  it("UPPER POLE — a NON-USD amount is confirmed in its own denomination, never in dollars", async () => {
    const inv = { id: "inv_jpy", status: "paid", amountMinor: 1000, currency: "JPY" };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_jpy")).toBeTruthy());
    fireEvent.click(btn("inv_jpy"));
    const msg = String(confirmSpy.mock.calls[0][0]);
    // JPY has exponent 0, so 1000 minor units is ¥1,000 — not $10.00 and not $1,000.
    expect(msg).toContain("¥1,000");
    expect(msg).not.toContain("$");
  });

  it("UPPER POLE — Wave 55's unpaid behaviour is UNCHANGED: `Refund (not paid)`, still disabled", async () => {
    const inv = { id: "inv_unpaid", status: "open", amountMinor: 5000, currency: "USD" };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_unpaid")).toBeTruthy());
    const b = btn("inv_unpaid");
    expect(b.disabled).toBe(true);
    expect(b.textContent).toBe("Refund (not paid)");
    /* And the explanation node does NOT appear: "not paid" already explains
       itself, and R42 must not be generalised. */
    expect(screen.queryByTestId("refund-blocked-inv_unpaid")).toBeNull();
  });

  it("UPPER POLE — an UNPAID invoice with an unknown amount keeps the `not paid` reason (the stronger fact wins)", async () => {
    const inv = { id: "inv_unpaid_unknown", status: "open", amountMinor: null, currency: null };
    renderLedgerTab([inv as Inv]);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_unpaid_unknown")).toBeTruthy());
    expect(btn("inv_unpaid_unknown").textContent).toBe("Refund (not paid)");
    expect(screen.queryByTestId("refund-blocked-inv_unpaid_unknown")).toBeNull();
  });
});

/* ── NO SILENT DROPS, and the Wave 55 source pins ───────────────────────── */

describe("W61b · R42 — no silent drops; the Wave 55 source-text pins still hold", () => {
  it("every row still renders every cell, for known and unknown invoices alike", async () => {
    const invoices: Inv[] = [
      { id: "inv_a", status: "paid", amountMinor: 12345, currency: "USD", companyId: "co_1", issuedAt: "2026-05-01T00:00:00Z" },
      { id: "inv_b", status: "paid", amountMinor: null, currency: null, companyId: "co_2", issuedAt: "2026-05-02T00:00:00Z" },
    ];
    renderLedgerTab(invoices);
    await waitFor(() => expect(screen.getByTestId("row-invoice-inv_a")).toBeTruthy());
    for (const id of ["inv_a", "inv_b"]) {
      const row = screen.getByTestId(`row-invoice-${id}`);
      expect(row).toBeTruthy();
      expect(row.querySelectorAll("td").length).toBe(6); // id, company, amount, status, issued, actions
      expect(screen.getByTestId(`button-refund-invoice-${id}`)).toBeTruthy();
    }
    // The unknown row's amount cell keeps Wave 55's honest dash.
    expect(screen.getByTestId("row-invoice-inv_b").textContent).toContain("—");
  });

  it("SOURCE PINS — the Wave 55 assertions on this exact row are still satisfiable", () => {
    const src = read("client/src/pages/admin/AdminFeesConsolidated.tsx");
    // wave55_r6_honest_refusal_sites.test.ts:199 — the amount cell is intact.
    expect(src).toContain("{formatMinorOrUnavailable(inv.amountMinor, inv.currency)}");
    // :200-202 — the whitespace-exact negative.
    expect(src).not.toContain('                          {formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD")}\n');
    // :205 — the testid survives BYTE-IDENTICAL. "NO SILENT DROP" in that test's words.
    expect(src).toContain("data-testid={`button-refund-invoice-${inv.id}`}");
    // Both pre-existing labels survive verbatim — this was an ADD, not a REPLACE.
    expect(src).toContain('"Refund (not paid)"');
    expect(src).toContain('"Refund"');
    // And the fabrications are gone from the handler.
    expect(src).not.toContain('formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD")');
  });
});
