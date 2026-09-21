import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerRelationships from "../PartnerRelationships";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "partner_bc_relationships",
      tier: "catalyst",
      subRole: "managing_partner",
      identity: { userId: "user_bc_relationships" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return {
    ...actual,
    PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

const COMPANY_ID = "company_bc_registered";

function response(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => response(status, body),
  } as unknown as Response;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PartnerRelationships />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("slide13b BC Relationships additive registration layout", () => {
  it("keeps the existing History column/button in place, appends Registration, and preserves history expansion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const path = String(url);
        if (path === "/api/partner/me/relationships") {
          return response(200, {
            relationships: [
              {
                id: "relationship_bc_registered",
                partnerId: "partner_bc_relationships",
                companyId: COMPANY_ID,
                companyName: "Registered BC Company",
                createdAt: "2026-09-01T00:00:00.000Z",
                updatedAt: "2026-09-02T00:00:00.000Z",
                activeSurfaces: ["portfolio"],
                pastSurfaces: [],
                presence: [
                  {
                    id: "presence_bc_portfolio",
                    surface: "portfolio",
                    rowId: "portfolio_bc_registered",
                    addedAt: "2026-09-01T00:00:00.000Z",
                    removedAt: null,
                  },
                ],
              },
            ],
            breakdown: { mfc: 0, pipeline: 0, clients: 0, portfolio: 1 },
            surfaceLabels: {
              mfc: "Managed Founder CRM",
              pipeline: "Pipeline",
              clients: "Clients",
              portfolio: "Portfolio",
            },
          });
        }
        if (path === "/api/partner/me/portfolio") {
          return response(200, {
            portfolio: [
              {
                companyId: COMPANY_ID,
                onboarding: { state: "registered" },
              },
            ],
          });
        }
        if (path === "/api/feature-flags") {
          return response(200, { PARTNER_WORKSPACE_ENABLED: true });
        }
        return response(200, {});
      }),
    );

    renderPage();

    const table = await screen.findByTestId("relationships-table");
    await waitFor(() =>
      expect(screen.getByTestId(`relationship-registration-${COMPANY_ID}`).textContent).toBe("Registered"),
    );

    const headers = within(table)
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Company",
      "On these surfaces",
      "Previously",
      "Last change",
      "History",
      "Registration",
    ]);

    const row = screen.getByTestId(`relationship-row-${COMPANY_ID}`);
    const cells = within(row).getAllByRole("cell");
    expect(within(cells[4]).getByTestId(`relationship-toggle-${COMPANY_ID}`)).toBeTruthy();
    expect(cells[5]).toBe(screen.getByTestId(`relationship-registration-${COMPANY_ID}`));

    fireEvent.click(within(cells[4]).getByTestId(`relationship-toggle-${COMPANY_ID}`));
    const history = await screen.findByTestId(`relationship-history-${COMPANY_ID}`);
    expect(within(history).getByTestId("relationship-presence-presence_bc_portfolio").textContent).toContain(
      "Portfolio · added",
    );
    expect(within(cells[4]).getByText("Hide")).toBeTruthy();
  });
});
