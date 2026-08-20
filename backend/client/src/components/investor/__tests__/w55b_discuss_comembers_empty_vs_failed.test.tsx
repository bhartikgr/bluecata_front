/**
 * WAVE 55b · OQ-3 — DiscussWithCapTableDialog's recipient list IS the cap table.
 *
 * The gate was `!coMembersQuery.isLoading && members.length === 0`, so a
 * 404 / 403 / 500 on `GET /api/investor/companies/:id/co-members` told the
 * investor
 *
 *     "No co-members found for this company."
 *
 * — a claim about who is on a cap table, asserted from a request that failed.
 *
 * BOTH POLES: the failure pole asserts the refusal appears and that string does
 * not; the success pole asserts that string is still present and unchanged.
 *
 * Status pinned in `shared/w55bCapTableRefusal.ts`, proved against the real
 * route in `server/__tests__/w55b_captable_family_refusal_http.test.ts`.
 *
 * MUTATION TRANSCRIPT: build_log/wave55b/W55B_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { W55B_CAP_TABLE_REFUSAL_STATUS } from "@shared/w55bCapTableRefusal";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { DiscussWithCapTableDialog } from "../DiscussWithCapTableDialog";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const EMPTY_COPY = "No co-members found for this company.";

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DiscussWithCapTableDialog
        open
        onOpenChange={() => undefined}
        companyId="co_w55b"
        companyName="W55b Co"
        topBuyer="Acme Corp"
        maScore={72}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W55b · OQ-3 — Discuss dialog: a failed co-member load is not an empty cap table", () => {
  it("LOWER POLE — the refusal renders and NOT the no-co-members claim", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(W55B_CAP_TABLE_REFUSAL_STATUS, "refused", null, { ok: false });
    });
    renderDialog();

    const err = await screen.findByTestId("discuss-comembers-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the co-members on this cap table");
    /* THE defect: pre-fix this found the text. */
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("NO SILENT DROP — the message body and the send control still mount", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderDialog();
    await screen.findByTestId("discuss-comembers-error");
    expect(screen.getByTestId("button-discuss-send")).toBeTruthy();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    apiRequestMock.mockImplementation(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderDialog();
    await screen.findByTestId("discuss-comembers-error");
    const before = calls;
    fireEvent.click(screen.getByTestId("discuss-comembers-error-retry"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("UPPER POLE — a genuine empty success still shows the EXISTING copy, unchanged", async () => {
    apiRequestMock.mockImplementation(async () => jsonResponse([]));
    renderDialog();
    expect(await screen.findByText(EMPTY_COPY)).toBeTruthy();
    expect(screen.queryByTestId("discuss-comembers-error")).toBeNull();
  });

  it("members render neither the refusal nor the empty copy", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse([
        {
          memberId: "m1",
          userId: "u1",
          displayLabel: "Hydra VC",
          allowDM: true,
          investorExperienceTier: "experienced",
          areaOfExpertise: ["fintech"],
        },
      ]),
    );
    renderDialog();
    expect(await screen.findByText("Hydra VC")).toBeTruthy();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("discuss-comembers-error")).toBeNull();
  });
});
