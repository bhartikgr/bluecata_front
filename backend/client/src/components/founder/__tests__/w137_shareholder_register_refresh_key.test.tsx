/* ════════════════════════════════════════════════════════════════════════════
   WAVE 137 · DEFECT B — A RECORDED SHAREHOLDER MUST REFRESH THE FOUNDER CAP
   TABLE, AND THAT DEPENDS ENTIRELY ON THE SHAPE OF ONE QUERY KEY.
   ════════════════════════════════════════════════════════════════════════════
   `ShareholderRegisterPanel.refreshAll()` invalidated the securities query with
   ONE INTERPOLATED STRING:

       queryKey: [`/api/companies/${companyId}/securities`]

   while the cap table subscribes with the ARRAY key

       queryKey: ["/api/companies", companyId, "securities"]   (CapTable.tsx:339)

   React Query v5 matches by ARRAY PREFIX, so those two keys are unrelated and
   the cap-table query was never invalidated — wave 130's headline promise did
   not hold until a remount.

   ANTI-VACUITY. These tests do not read source text and do not assert on a
   `disabled` attribute. They mount the real panel against a real QueryClient in
   which the cap-table's OWN key is already cached, drive the real code path
   (`button-skip-first-run` → firstRunM → onSuccess → refreshAll), and then ask
   the cache itself whether the cap-table query was invalidated. POLE 3 pins the
   exact key ARRAY, element by element, so a future edit cannot silently go back
   to a string.

   FAIL-BEFORE EVIDENCE. Run against the pre-fix expression
   (`[`/api/companies/${companyId}/securities`]`) POLE 1 and POLE 3 both fail:
     · POLE 1 — "expected false to be true" (the cached cap-table query is NOT
       invalidated);
     · POLE 3 — the invalidated keys do not contain the array shape.
   See build_log/wave137/W137_TESTS.md for the captured output.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ShareholderRegisterPanel } from "../ShareholderRegisterPanel";
import { queryClient as panelQueryClient } from "@/lib/queryClient";

const COMPANY = "co_novapay";

const apiRequestMock = vi.fn();

/* The panel imports the app-wide `queryClient` singleton directly and calls
   `invalidateQueries` on it. The mock swaps in a FRESH real QueryClient (not a
   stub) so cache state is genuine, and the test provides that same instance to
   the tree so `useQuery` and `invalidateQueries` talk about one cache. */
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const rq = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
    queryClient: new rq.QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
  };
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

const REGISTER = {
  ok: true,
  records: [],
  holderTypes: ["founder", "investor"],
  instruments: ["common"],
  supportedCurrencies: ["USD"],
  suggestedCurrency: "USD",
};
const FIRST_RUN = { ok: true, firstRun: { state: "not_started", scenario: null, asAtDate: null }, recordedByScenario: {} };
const VISIBILITY = { ok: true, parties: [], grants: [] };

/** The two keys the cap table itself subscribes with (CapTable.tsx:339 and the
 *  sibling cap-table query invalidated at CapTable.tsx:1276-1277). */
const SECURITIES_KEY = ["/api/companies", COMPANY, "securities"] as const;
const CAP_TABLE_KEY = ["/api/companies", COMPANY, "cap-table"] as const;

beforeEach(() => {
  apiRequestMock.mockReset();
  panelQueryClient.clear();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url.startsWith("/api/founder/captable/shareholders")) return jsonResponse(REGISTER);
    if (url.startsWith("/api/founder/captable/first-run")) {
      return jsonResponse(method === "POST" ? { ok: true } : FIRST_RUN);
    }
    if (url.startsWith("/api/founder/captable/visibility")) return jsonResponse(VISIBILITY);
    return jsonResponse({ ok: true });
  });
  /* The cap table has already loaded and its data is fresh in cache — exactly the
     state the founder is in when he records a holder from the cap-table screen. */
  panelQueryClient.setQueryData([...SECURITIES_KEY], [{ id: "sec_seed" }]);
  panelQueryClient.setQueryData([...CAP_TABLE_KEY], { rows: [] });
});

afterEach(() => cleanup());

function mount() {
  return render(
    <QueryClientProvider client={panelQueryClient}>
      <ShareholderRegisterPanel companyId={COMPANY} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

/** Drive the real refresh path: any successful register/first-run/visibility
 *  mutation funnels through `refreshAll()`. `button-skip-first-run` needs no form
 *  input, so this exercises refreshAll without asserting anything about
 *  validation. */
async function triggerRefreshAll() {
  const button = await screen.findByTestId("button-skip-first-run");
  button.click();
}

describe("WAVE 137 · DEFECT B — the register refreshes the cap table", () => {
  it("POLE 1 — the CACHED cap-table securities query is invalidated after a successful register action", async () => {
    mount();
    expect(panelQueryClient.getQueryState([...SECURITIES_KEY])?.isInvalidated).toBe(false);

    await triggerRefreshAll();

    await waitFor(() => {
      expect(
        panelQueryClient.getQueryState([...SECURITIES_KEY])?.isInvalidated,
        'the cap table subscribes with ["/api/companies", companyId, "securities"]; ' +
          "a one-element interpolated string key never reaches it",
      ).toBe(true);
    });
  });

  it("POLE 2 — the sibling cap-table query is invalidated too, matching CapTable.tsx:1276-1277", async () => {
    mount();
    expect(panelQueryClient.getQueryState([...CAP_TABLE_KEY])?.isInvalidated).toBe(false);

    await triggerRefreshAll();

    await waitFor(() => {
      expect(panelQueryClient.getQueryState([...CAP_TABLE_KEY])?.isInvalidated).toBe(true);
    });
  });

  it("POLE 3 — the securities key is passed as an EXACT three-element array, never an interpolated string", async () => {
    const spy = vi.spyOn(panelQueryClient, "invalidateQueries");
    mount();
    await triggerRefreshAll();

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);

    /* The exact array shape — this is the whole defect. */
    expect(keys).toEqual(
      expect.arrayContaining([["/api/companies", COMPANY, "securities"]]),
    );
    /* And the pre-fix shape must be gone. */
    expect(keys).not.toEqual(
      expect.arrayContaining([[`/api/companies/${COMPANY}/securities`]]),
    );

    const securitiesKey = keys.find(
      (k) => Array.isArray(k) && k[0] === "/api/companies" && k[2] === "securities",
    ) as unknown[];
    expect(securitiesKey).toHaveLength(3);
    expect(securitiesKey[0]).toBe("/api/companies");
    expect(securitiesKey[1]).toBe(COMPANY);
    expect(securitiesKey[2]).toBe("securities");
    spy.mockRestore();
  });

  it("POLE 4 — the three pre-existing invalidations are still made (nothing was dropped to make room)", async () => {
    const spy = vi.spyOn(panelQueryClient, "invalidateQueries");
    mount();
    await triggerRefreshAll();

    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5));
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["/api/founder/captable/shareholders", COMPANY],
        ["/api/founder/captable/first-run", COMPANY],
        ["/api/founder/captable/visibility", COMPANY],
      ]),
    );
    spy.mockRestore();
  });
});
