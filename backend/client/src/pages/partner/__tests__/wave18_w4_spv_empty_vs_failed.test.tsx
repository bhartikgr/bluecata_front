/**
 * WAVE 18 · W-4 — "SPV list empty state and zero-vehicle message".
 *
 * The empty state itself already existed (`PartnerSpvEngine.tsx`,
 * `PartnerEmptyState title="No SPVs yet"`), so the row reads as delivered. The
 * defect was one branch away: the page derives `spvs` from
 * `list.data?.spvs ?? []`, and the empty state was gated only on
 * `!list.isLoading`. A 403 or a 500 therefore rendered
 *
 *     "No SPVs yet · Create your first SPV with the 5-step wizard."
 *
 * to a GP who has live vehicles — a fabricated zero, in encouraging copy, that
 * invites the user to duplicate an SPV they already own. The retired
 * `PartnerSpvs.tsx:143` had the correct shape; the page that replaced it as
 * canonical (Ozan decision #4 — `/collective/partner/spvs` now redirects to the
 * engine, `client/src/App.tsx:1406`) did not.
 *
 * Poles: failure renders the refusal and NOT the empty state; a genuine empty
 * success renders the empty state and NOT the refusal; rows render neither.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { ApiError } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_test_partner_inc",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
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

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerSpvEngine />
    </QueryClientProvider>,
  );
}

const EMPTY_COPY = "No SPVs yet";

describe("W-4 — a failed SPV load is never rendered as an empty portfolio", () => {
  beforeEach(() => apiRequestMock.mockReset());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a 403 renders the refusal and NOT the zero-vehicle message", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") throw new ApiError(403, "forbidden", null, { ok: false });
      return jsonResponse({});
    });
    renderPage();
    const err = await screen.findByTestId("spv-engine-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load your SPVs");
    /* THE defect: pre-fix this queryByText found the empty state. */
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("spv-engine-list")).toBeNull();
  });

  it("a 500 behaves the same — the failure is a state, not an absence", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") throw new ApiError(500, "boom", null, { ok: false });
      return jsonResponse({});
    });
    renderPage();
    await screen.findByTestId("spv-engine-error");
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") {
        calls += 1;
        throw new ApiError(500, "boom", null, { ok: false });
      }
      return jsonResponse({});
    });
    renderPage();
    await screen.findByTestId("spv-engine-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("spv-engine-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("POSITIVE POLE — a genuine empty success still shows the zero-vehicle message", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") return jsonResponse({ spvs: [] });
      return jsonResponse({});
    });
    renderPage();
    expect(await screen.findByText(EMPTY_COPY)).toBeTruthy();
    expect(screen.queryByTestId("spv-engine-error")).toBeNull();
  });

  it("rows render neither the empty state nor the refusal", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") {
        return jsonResponse({
          spvs: [{ id: "spv_1", name: "Fund I SPV", status: "open", jurisdiction: "DE" }],
        });
      }
      return jsonResponse({});
    });
    renderPage();
    await screen.findByTestId("spv-engine-list");
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("spv-engine-error")).toBeNull();
  });

  it("a PAUSED query (offline) is not an empty portfolio either", async () => {
    /* React Query pauses rather than fetches when offline: pending, not
       fetching, not errored. `isLoading` is false and `isError` is false, so a
       gate written as `!isLoading && !isError` renders "No SPVs yet" to a user
       who is merely disconnected. Only `isSuccess` distinguishes "the server
       told us zero" from "we have not heard from the server". */
    apiRequestMock.mockImplementation(async () => jsonResponse({ spvs: [] }));
    onlineManager.setOnline(false);
    try {
      renderPage();
      /* Give the paused query a tick to settle into its non-fetching state. */
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByText(EMPTY_COPY)).toBeNull();
      expect(apiRequestMock).not.toHaveBeenCalledWith("GET", "/api/partner/me/spv");
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("the refusal states no counts and no money — it never implies a value", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/partner/me/spv") throw new ApiError(500, "boom", null, { ok: false });
      return jsonResponse({});
    });
    renderPage();
    const err = await screen.findByTestId("spv-engine-error");
    const text = err.textContent ?? "";
    for (const forbidden of ["$", "0 SPVs", "USD", "JPY", "0.00"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
