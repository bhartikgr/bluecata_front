/**
 * W2M B2 — Partner New-DM button + picker.
 *
 * Covers: GET /api/comms/users populates the picker, a successful
 * POST /api/comms/dm/start closes the picker, and 403/422 responses render
 * visible, actionable copy instead of assuming success. MessagesPage and the
 * partner-role hook are mocked so this test is isolated to the New-DM flow
 * this brief adds — the shared MessagesPage split-pane UI has its own tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerMessages from "../PartnerMessages";
import { ApiError } from "@/lib/queryClient";
import { RoleProvider } from "@/lib/role";

vi.mock("@/components/comms/MessagesPage", () => ({
  MessagesPage: () => <div data-testid="mock-messages-page" />,
}));

// The real toast store only renders visible text via a mounted <Toaster/>,
// which this isolated test doesn't include. Assert on the toast() call args
// directly — same pattern used by PostsFeed.scheduleAudience.test.tsx.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_1",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_partner_1", email: "partner@example.com", name: "Partner One" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <PartnerMessages />
      </RoleProvider>
    </QueryClientProvider>
  );
}

describe("PartnerMessages — New-DM button + picker (W2M B2)", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    toastMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the New-DM button with the required test id", () => {
    renderPage();
    expect(screen.getByTestId("partner-new-dm-button")).toBeTruthy();
  });

  it("opens the picker and populates it from GET /api/comms/users", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/comms/users") {
        return jsonResponse(200, [
          { id: "u_2", legalName: "Aisha Patel", visibility: { screenName: "GreenwoodCap" } },
          { id: "u_3", legalName: "Maya Chen", visibility: { screenName: "MayaC" } },
        ]);
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("partner-new-dm-button"));

    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_2")).toBeTruthy());
    expect(screen.getByText("Aisha Patel")).toBeTruthy();
    expect(screen.getByText("Maya Chen")).toBeTruthy();
  });

  it("closes the picker and starts a DM on a successful POST /api/comms/dm/start", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/comms/users") {
        return jsonResponse(200, [{ id: "u_2", legalName: "Aisha Patel" }]);
      }
      if (method === "POST" && url === "/api/comms/dm/start") {
        return jsonResponse(200, { ok: true, channelId: "dm_1_2" });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("partner-new-dm-button"));
    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_2")).toBeTruthy());
    fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_2"));

    await waitFor(() => expect(screen.queryByTestId("partner-new-dm-picker")).toBeNull());
  });

  it("shows a not-allowed message on a 403 — never assumes success", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/comms/users") {
        return jsonResponse(200, [{ id: "u_blocked", legalName: "Blocked Contact" }]);
      }
      if (method === "POST" && url === "/api/comms/dm/start") {
        // Mirrors apiRequest's real throwIfResNotOk behavior: non-2xx throws an ApiError.
        throw new ApiError(403, "You don\u2019t have permission to do that.", null, { ok: false });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("partner-new-dm-button"));
    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_blocked")).toBeTruthy());
    fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_blocked"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "You can't message this person" })
      )
    );
  });

  it("shows an invitation-required message on a 422 — never assumes success", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/comms/users") {
        return jsonResponse(200, [{ id: "u_unprovisioned", legalName: "Invited Contact" }]);
      }
      if (method === "POST" && url === "/api/comms/dm/start") {
        throw new ApiError(
          422,
          "Cannot start DM until this contact accepts their invitation.",
          "contact_not_provisioned",
          { ok: false }
        );
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });

    renderPage();
    fireEvent.click(screen.getByTestId("partner-new-dm-button"));
    await waitFor(() => expect(screen.getByTestId("partner-new-dm-pick-u_unprovisioned")).toBeTruthy());
    fireEvent.click(screen.getByTestId("partner-new-dm-pick-u_unprovisioned"));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Contact must accept their invitation first" })
      )
    );
  });
});
