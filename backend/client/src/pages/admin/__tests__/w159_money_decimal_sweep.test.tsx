/**
 * WAVE 159 · R126.5 / R119.3 — THE MONEY-PARSING FIX WAS INCOMPLETE.
 *
 * The reviewer proved (158.2, probe P8c) that `10.005` USD typed on
 * `CollectivePaymentSchedules` was REFUSED (400) while the identical amount typed
 * on `AdminFeesConsolidated` became `amountMinor: 1001` and was STORED (200) —
 * two admin screens, one table, opposite money semantics. Root cause:
 * `AdminFeesConsolidated.tsx:2804` and `PartnerFeeSchedules.tsx:102` still ran
 * `parseFloat` → `toMinor`, and `CollectivePaymentSchedules.tsx:219` still ran
 * `toMinor(Number(typed))` for its preview.
 *
 * The fix is an exact-decimal client parser (`decimalStringToMinor` in
 * `client/src/lib/currency.ts`) that mirrors `server/lib/money.ts:727` — BigInt
 * string arithmetic, ISO-4217 exponent aware, sub-unit precision REFUSED rather
 * than rounded. `toMinor`'s currency-aware scaling is kept; nothing regresses to
 * `* 100`.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 *   LOWER — `10.005` USD is refused, not rounded to 1001; `125abc`, `125.5.5`,
 *           `1,250.00` and blank are refused; the RENDERED preview says so.
 *   UPPER — USD/JPY/KWD/BHD all still scale correctly (no `* 100` regression) and
 *           a legitimate amount still previews as the amount that will be stored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { join } from "path";
import { RoleProvider } from "@/lib/role";
import { decimalStringToMinor, toMinor } from "@/lib/currency";
import CollectivePaymentSchedules from "../CollectivePaymentSchedules";

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: vi.fn() };
});

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const ROOT = process.cwd();
const src = (rel: string) => stripComments(readFileSync(join(ROOT, rel), "utf8"));

const CPS = "client/src/pages/admin/CollectivePaymentSchedules.tsx";
const AFC = "client/src/pages/admin/AdminFeesConsolidated.tsx";
const PFS = "client/src/pages/admin/PartnerFeeSchedules.tsx";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => ({ ok: true, schedules: [], total: 0 }) },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>{ui}</RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => cleanup());
afterEach(() => cleanup());

describe("W159 · E — one money parser, one answer, across the admin screens", () => {
  it("E1 — RENDERED DOM: typing 10.005 USD previews a refusal, never $10.01", () => {
    wrap(<CollectivePaymentSchedules />);
    fireEvent.click(screen.getByTestId("button-new-cps"));
    fireEvent.change(screen.getByTestId("input-cps-amount"), { target: { value: "10.005" } });
    const preview = screen.getByTestId("text-cps-amount-preview").textContent ?? "";
    expect(preview).not.toMatch(/10\.01/);
    expect(preview).toMatch(/decimal|cannot|not be stored|refus/i);
  });

  it("E2 — RENDERED DOM: UPPER POLE — a legitimate amount still previews the stored value", () => {
    wrap(<CollectivePaymentSchedules />);
    fireEvent.click(screen.getByTestId("button-new-cps"));
    fireEvent.change(screen.getByTestId("input-cps-amount"), { target: { value: "1500.50" } });
    expect(screen.getByTestId("text-cps-amount-preview").textContent ?? "").toMatch(/1,500\.50/);
  });

  it("E3 — the client parser refuses what parseFloat used to salvage", () => {
    for (const bad of ["10.005", "125abc", "125.5.5", "1,250.00", "", "   ", "abc"]) {
      expect(() => decimalStringToMinor(bad, "USD"), `input=${JSON.stringify(bad)}`).toThrow();
    }
  });

  it("E4 — UPPER POLE: currency-aware scaling is intact — USD/JPY/KWD/BHD, no `* 100`", () => {
    expect(decimalStringToMinor("1500.50", "USD")).toBe(150050);
    expect(decimalStringToMinor("1500", "JPY")).toBe(1500);
    expect(decimalStringToMinor("1500", "JPY")).not.toBe(150000);
    expect(decimalStringToMinor("1.250", "KWD")).toBe(1250);
    expect(decimalStringToMinor("2.005", "BHD")).toBe(2005);
    /* Case-insensitive on the code, exactly as the server is. */
    expect(decimalStringToMinor("1500", "jpy")).toBe(1500);
    /* `toMinor` itself is NOT regressed — it is still exponent-aware. */
    expect(toMinor(1500, "JPY")).toBe(1500);
    expect(toMinor(1500.5, "USD")).toBe(150050);
  });

  it("E5 — no `parseFloat`/`Number()` money coercion remains on the three swept screens", () => {
    const cps = src(CPS);
    expect(cps).not.toMatch(/parseFloat/);
    expect(cps).not.toMatch(/toMinor\(\s*Number\(/);
    const afc = src(AFC);
    expect(afc).not.toMatch(/parseFloat/);
    const pfs = src(PFS);
    expect(pfs).not.toMatch(/parseFloat/);
  });

  it("E6 — the three screens all route their amounts through the exact-decimal parser", () => {
    for (const rel of [CPS, AFC, PFS]) {
      expect(src(rel), rel).toMatch(/decimalStringToMinor/);
    }
  });
});
