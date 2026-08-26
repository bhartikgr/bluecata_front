/* ════════════════════════════════════════════════════════════════════════════
   WAVE 144 · ITEMS 1, 2 and 7 — A MISSING FEE NEVER RENDERS AS A PRICE, AND THE
   EDITOR CONVERTS IN THE ROW'S OWN CURRENCY.                  R108.2 · R101
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT CLASS. `formatMinor` coerces its input with `(Number(minor) || 0)`
   (client/src/lib/currency.ts:112), so ANY surface that hands it a null amount
   prints a confident "$0.00" for a fee that is not on record. Review 2 found it
   on the founder Billing surface; tracing the reshaped `platformFeesStore`
   callers found the SAME treatment on the admin fee registry table
   (AdminFeesConsolidated.tsx, the "Full Fee registry" card). This file asserts
   the RENDERED DOM of the real page — not source text — in both states.

   ITEM 7 (the residual non-USD risk Review 2 raised). The editor's PRE-FILLED
   input, the TYPED value and the WIRE value must all use the SAME exponent, and
   it must be the ROW's currency. `PUT /api/admin/platform-fees/:key` accepts a
   `currency` in its body (server/adminPlatformFeesRoutes.ts), so a JPY row
   (exponent 0) is reachable without any UI change; before this wave the two
   helpers were called with the default USD exponent while the label beside them
   showed the row's currency, which is the 100x class the money rule names.
   Group T asserts all three values on a JPY row.

   FAIL-BEFORE: `w144_scratch/make_before.py revert` reinstates the pre-wave-144
   registry cell and the USD-defaulted conversions. Real output recorded in
   build_log/wave144/W144_TESTS.md.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminFeesConsolidated from "../AdminFeesConsolidated";

const FEE_KEY = "collective_application_fee";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Row = {
  key: string;
  amountMinor: number | null;
  currency: string | null;
  updatedAt: string | null;
  updatedByUserId: string | null;
  billingPeriod: string | null;
  source?: "db" | "missing" | "unreadable";
};

/** Mounts the real Application Fee tab with a chosen `GET /api/admin/platform-fees`
 *  body. `fees` is passed through verbatim so an ABSENT row can be expressed the
 *  way the reshaped store actually reports it. */
function mount(fees: Row[], absentKeys: string[] = []) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (method === "GET" && /\/api\/admin\/platform-fees$/.test(url)) {
      return jsonResponse({ ok: true, fees, absentKeys });
    }
    if (method === "GET" && /\/api\/admin\/collective\/application-fee$/.test(url)) {
      const r = fees.find((f) => f.key === FEE_KEY);
      return jsonResponse({
        ok: true,
        amountMinor: r?.amountMinor ?? null,
        currency: r?.currency ?? null,
        updatedAt: r?.updatedAt ?? null,
        updatedBy: r?.updatedByUserId ?? null,
        source: r && r.amountMinor !== null ? "db" : (r?.source ?? "missing"),
      });
    }
    return jsonResponse({ ok: true });
  });
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: (async () => ({})) as never },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminFeesConsolidated initialTab="application-fee" />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const ON_RECORD: Row = {
  key: FEE_KEY,
  amountMinor: 30_000,
  currency: "USD",
  updatedAt: "2026-08-20T10:00:00.000Z",
  updatedByUserId: "admin@capavate.com",
  billingPeriod: null,
  source: "db",
};
const MISSING: Row = {
  key: FEE_KEY,
  amountMinor: null,
  currency: null,
  updatedAt: null,
  updatedByUserId: null,
  billingPeriod: null,
  source: "missing",
};
const UNREADABLE: Row = { ...MISSING, source: "unreadable" };

beforeEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});
afterEach(() => cleanup());

/* ══════════════════════════ P — A MISSING FEE IS NEVER RENDERED AS A PRICE */

describe("WAVE 144 · P — absence never renders as $0.00", () => {
  it("P1 THE REPRODUCTION — with the row MISSING, no zero price appears anywhere", async () => {
    mount([MISSING], [FEE_KEY]);
    await screen.findByTestId("application-fee-stored");
    const doc = document.body.textContent ?? "";
    expect(doc).not.toContain("$0.00");
    expect(doc).not.toContain("0.00 USD");
    /* Nor a bare zero standing in for the amount in the registry row. */
    const cell = await screen.findByTestId(`row-platform-fee-${FEE_KEY}`);
    expect(cell.textContent ?? "").not.toContain("$0.00");
  });

  it("P2 the absence is STATED, not merely blank — the admin is told what happened", async () => {
    mount([MISSING], [FEE_KEY]);
    const line = await screen.findByTestId("application-fee-stored");
    const t = line.textContent ?? "";
    expect(t).toContain("NOT ON RECORD");
    expect(t.toLowerCase()).toContain("not a fee of zero");
  });

  it("P3 the UNREADABLE state is distinguished from the never-set state", async () => {
    mount([UNREADABLE], [FEE_KEY]);
    const line = await screen.findByTestId("application-fee-stored");
    expect((line.textContent ?? "").toLowerCase()).toContain("could not be read");
  });

  it("P4 the registry TABLE row says 'Not on record' instead of a price", async () => {
    mount([MISSING], [FEE_KEY]);
    const row = await screen.findByTestId(`row-platform-fee-${FEE_KEY}`);
    expect(row.textContent ?? "").toContain("Not on record");
    expect(row.textContent ?? "").not.toContain("$0.00");
  });

  it("P5 the input is EMPTY for an absent fee — not pre-filled with 0", async () => {
    mount([MISSING], [FEE_KEY]);
    const input = (await screen.findByTestId("input-application-fee")) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("P6 THE OTHER POLE — an on-record fee still renders its real price", async () => {
    mount([ON_RECORD]);
    const row = await screen.findByTestId(`row-platform-fee-${FEE_KEY}`);
    expect(row.textContent ?? "").toContain("300.00");
    expect(row.textContent ?? "").not.toContain("Not on record");
    const line = await screen.findByTestId("application-fee-stored");
    expect(line.textContent ?? "").toContain("30000");
    const input = (await screen.findByTestId("input-application-fee")) as HTMLInputElement;
    expect(input.value).toBe("300.00");
  });
});

/* ══════════════════════ T — THREE VALUES, ONE EXPONENT, THE ROW'S CURRENCY */

describe("WAVE 144 · T — non-USD conversion (ITEM 7)", () => {
  const JPY: Row = {
    ...ON_RECORD,
    amountMinor: 300_000, // ¥300,000 — JPY has exponent 0, so this is the whole amount
    currency: "JPY",
  };

  it("T1 the PRE-FILLED value uses the row's exponent (¥300,000 is not 3,000.00)", async () => {
    mount([JPY]);
    const input = (await screen.findByTestId("input-application-fee")) as HTMLInputElement;
    expect(input.value).toBe("300000");
    expect(input.value).not.toBe("3000.00");
  });

  it("T2 the WIRE value of a TYPED amount is not scaled by 100", async () => {
    mount([JPY]);
    const input = (await screen.findByTestId("input-application-fee")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "450000" } });
    fireEvent.click(await screen.findByTestId("button-save-application-fee"));
    await waitFor(() => {
      const put = apiRequestMock.mock.calls.find((c) => c[0] === "PUT");
      expect(put, "the save must reach the API").toBeTruthy();
      expect((put as unknown[])[2]).toEqual({ amountMinor: 450_000 });
    });
  });

  it("T3 the LABEL states the same currency the conversion used", async () => {
    mount([JPY]);
    await screen.findByTestId("input-application-fee");
    expect(document.body.textContent ?? "").toContain("Amount (JPY)");
  });

  it("T4 USD is unchanged — a typed 415.00 still wires 41500 minor units", async () => {
    /* A value DIFFERENT from the pre-fill on purpose: React does not fire
       `onChange` for an identical value, so re-typing "300.00" would leave
       `draft` null and the assertion would pass for the wrong reason. */
    mount([ON_RECORD]);
    const input = (await screen.findByTestId("input-application-fee")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "415.00" } });
    fireEvent.click(await screen.findByTestId("button-save-application-fee"));
    await waitFor(() => {
      const put = apiRequestMock.mock.calls.find((c) => c[0] === "PUT");
      expect(put).toBeTruthy();
      expect((put as unknown[])[2]).toEqual({ amountMinor: 41_500 });
    });
  });
});
