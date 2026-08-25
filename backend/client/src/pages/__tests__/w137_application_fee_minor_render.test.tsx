/* ════════════════════════════════════════════════════════════════════════════
   WAVE 137 · DEFECT A (A1, A6, A7) — THE COLLECTIVE APPLICATION FEE ON BOTH
   SIDES OF THE WALL.
   ════════════════════════════════════════════════════════════════════════════
   One fee, one column: `collective_application_fee_config.amount_minor`, TRUE
   minor units (PUT validates "non-negative integer (minor units)", the bootstrap
   seeds 30000 for a $300 fee, and WAVE 131 removed the minor→major conversion
   from the platform-fees mirror-write for exactly this reason). Both surfaces
   rendered it with `fmtUSD`, which formats WHOLE units, so a $300 fee was
   published to the admin and to the founder as **$30,000**.

   These tests RENDER both real surfaces and assert the LITERAL string a human
   reads. Nothing here matches source text, and nothing asserts an attribute as a
   proxy for a render.

   FAIL-BEFORE EVIDENCE (captured with `fmtUSD` restored at all three sites):
     POLE 1 → `expected '$30,000' to be '$300.00'`   (admin "Current (live)")
     POLE 2 → `expected '$30,000' to be '$300.00'`   (admin typed-value preview)
     POLE 4 → the founder's two fee sentences contained `$30,000`
   See build_log/wave137/W137_TESTS.md.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import AdminApplicationFee from "@/pages/admin/AdminApplicationFee";
import FounderApplyToCollective from "@/pages/founder/ApplyToCollective";

/** $300.00 in TRUE minor units — the APD-028 canonical application fee. */
const FEE_MINOR = 30_000;
const FEE = { ok: true, amountMinor: FEE_MINOR, currency: "USD", updatedAt: null, updatedBy: null, source: "db" };

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url.includes("/collective/application-fee")) return jsonResponse(FEE);
    /* The founder page gates BOTH apply paths behind an active/live round
       (v25.45.4 L-3), so the fee sentences only exist for a company that has one. */
    if (url.startsWith("/api/rounds")) return jsonResponse([{ id: "r_1", state: "open" }]);
    return jsonResponse([]);
  });
});
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════ ADMIN SIDE (A1) */

function mountAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <AdminApplicationFee />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

describe("WAVE 137 · DEFECT A — the admin application-fee editor", () => {
  it("POLE 1 — 'Current (live)' renders the LITERAL '$300.00' for 30000 minor units, never '$30,000'", async () => {
    mountAdmin();
    const live = await screen.findByTestId("text-current-fee");
    await waitFor(() => expect(live.textContent?.trim()).toBe("$300.00"));
    expect(live.textContent).not.toContain("$30,000");
  });

  it("POLE 2 — the TYPED value's preview agrees with the live read-back (the wave-126 trap)", async () => {
    /* The typed value is PUT unscaled as `amountMinor`, so it IS minor units and
       must be previewed as minor units. Before this wave the same 30000 rendered
       `$30,000` in the preview and `$30,000` live; fixing only one of the two
       would have left one screen contradicting itself. */
    mountAdmin();
    const input = await screen.findByTestId("input-application-fee-amount");
    /* The pre-filled default is the DB value itself. */
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("30000"));
    const preview = await screen.findByTestId("text-fee-preview");
    await waitFor(() => expect(preview.textContent?.trim()).toBe("$300.00"));

    fireEvent.change(input, { target: { value: "24900" } });
    await waitFor(() => expect(preview.textContent?.trim()).toBe("$249.00"));
    expect(preview.textContent).not.toContain("$24,900");
  });

  it("POLE 3 — an unparseable amount still refuses rather than inventing a figure", async () => {
    /* Anti-vacuity: the em-dash refusal must survive the formatter swap. */
    mountAdmin();
    const input = await screen.findByTestId("input-application-fee-amount");
    const preview = await screen.findByTestId("text-fee-preview");
    fireEvent.change(input, { target: { value: "1.5" } });
    await waitFor(() => expect(preview.textContent?.trim()).toBe("—"));
    expect(preview.textContent).not.toContain("$0.00");
    expect(preview.textContent).not.toContain("$1");
  });
});

/* ════════════════════════════════════════════════════════ FOUNDER SIDE (A6/A7) */

/** The founder page's fee query uses the default queryFn, so the default is
 *  supplied here per key. Everything else the page reads resolves empty, which is
 *  the state of a founder who has applied to nothing. */
function mountFounder(
  fee: Record<string, unknown> = FEE,
  feeLoader?: () => Promise<unknown>,
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const head = String(queryKey[0] ?? "");
          if (head.includes("/collective/application-fee")) return feeLoader ? feeLoader() : fee;
          if (head.includes("/api/auth/me")) return { id: "u_founder", displayName: "Founder" };
          if (head.includes("active-company")) {
            return { activeCompanyId: "co_1", company: { companyId: "co_1", companyName: "Acme Robotics" } };
          }
          return [];
        },
      },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <FounderApplyToCollective />
      </RoleProvider>
    </QueryClientProvider>,
  );
  return utils;
}

/** Path B (the direct company application) is the tab that quotes the fee. */
async function openPathB() {
  const tab = await screen.findByTestId("tab-direct");
  /* Radix activates a tab on pointer-down, not on click. */
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

/** The two fee statements on the founder page, found by their own sentences. */
async function feeSentences() {
  await openPathB();
  const direct = await screen.findByText(/A non-refundable application fee of/);
  const ack = await screen.findByText(/Application fee —/);
  return { direct, ack };
  /* `direct` is the diligence paragraph (Path B intro); `ack` is the amber box the
     founder must tick before the application is accepted. */
}

describe("WAVE 137 · DEFECT A — the founder application surface", () => {
  it("POLE 4 — both fee statements quote the LITERAL '$300.00', never '$30,000'", async () => {
    mountFounder();
    const { direct, ack } = await feeSentences();
    await waitFor(() => expect(direct.textContent).toContain("$300.00"));
    await waitFor(() => expect(ack.textContent).toContain("$300.00"));
    expect(direct.textContent).not.toContain("$30,000");
    expect(ack.textContent).not.toContain("$30,000");
    /* And the fee the founder is asked to acknowledge is the same figure as the
       one in the diligence paragraph — one fee, stated once, twice. */
    expect(direct.textContent).toContain("$300.00");
    expect(ack.textContent).toContain("$300.00");
  });

  it("POLE 5 — the fee is quoted in the currency the SERVER sent, not an assumed USD", async () => {
    /* `fmtUSD` hardcodes USD, so a JPY-denominated fee was doubly wrong: dollar
       sign, and exponent 2 on an exponent-0 currency. */
    mountFounder({ amountMinor: 25_000, currency: "JPY", source: "db" });
    const { ack } = await feeSentences();
    await waitFor(() => expect(ack.textContent).toContain("¥25,000"));
    expect(ack.textContent).not.toContain("$");
  });

  it("POLE 6 — while the fee is unresolved the page still refuses to quote a figure", async () => {
    /* Anti-vacuity: the hard-fail loading contract (v25.39) must survive. */
    /* Hold the fee query open so the pending state is observable. */
    let release: (v: unknown) => void = () => {};
    const held = new Promise((r) => { release = r; });
    mountFounder(undefined, () => held.then(() => FEE));
    await openPathB();
    expect(screen.getAllByTestId("fee-loading").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("$2,500");
    expect(document.body.textContent).not.toContain("$30,000");
    release(null);
    await waitFor(() => expect(screen.queryAllByTestId("fee-loading").length).toBe(0));
    const { ack } = await feeSentences();
    expect(ack.textContent).toContain("$300.00");
  });
});
