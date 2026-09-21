import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartnerPortfolioProfileDialog } from "@/components/partner/PartnerPortfolioProfileDialog";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("slide13b C canonical source is read-only and separate from private contact data", () => {
  it("renders canonical Sector and actual owner invitation without copying either into editable fields", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => ({
      ok: true,
      status: 200,
      json: async () => url.includes("/founder-invitation") ? ({
        companyId: "co_bc",
        companyName: "BC Company",
        invitation: {
          id: "invite_bc",
          email: "owner@company.example",
          name: "Owner",
          status: "pending",
          expiresAt: "2026-09-21T00:00:00.000Z",
          sentAt: "2026-09-20T00:00:00.000Z",
          acceptedAt: null,
          handoff: { mode: "smtp", result: "accepted" },
        },
        canReissue: true,
      }) : ({
        companyId: "co_bc",
        companyName: "BC Company",
        profile: { contact: { companyEmail: "private@partner.example", industry: "Fintech" } },
        source: { sector: "Financial Services" },
        canViewFounderInvitation: true,
      }),
    } as Response));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PartnerPortfolioProfileDialog companyId="co_bc" companyName="BC Company" canEdit open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-canonical-sector").textContent).toContain("Financial Services"),
    );
    expect((await screen.findByTestId("founder-invitation-status")).textContent).toContain("owner@company.example");
    expect(screen.getAllByText(/Awaiting founder registration/i)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Review correction or resend/i })).toBeTruthy();
    expect((screen.getByTestId("pf-contact-email") as HTMLInputElement).value).toBe("private@partner.example");
    fireEvent.click(screen.getByTestId("portfolio-save"));
    await waitFor(() => expect(apiRequestMock.mock.calls.some((call) =>
      call[0] === "PATCH" &&
      (call[2] as { contact?: { industry?: string } })?.contact?.industry === "Fintech",
    )).toBe(true));
  });

  it("does not mount the invitation status reader when the server denies strong authority", async () => {
    apiRequestMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        companyId: "co_weak",
        companyName: "Weak CRM Relationship",
        profile: { contact: { companyEmail: "private@partner.example" } },
        source: { sector: "Infrastructure" },
        onboarding: {
          state: "pending",
          company: { id: "co_weak", name: "Weak CRM Relationship", sector: "Infrastructure" },
          canViewFounderInvitation: false,
          registeredFounderCount: 1,
        },
        canViewFounderInvitation: false,
      }),
    } as Response);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PartnerPortfolioProfileDialog companyId="co_weak" companyName="Weak CRM Relationship" canEdit open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("portfolio-canonical-sector").textContent).toContain("Infrastructure"),
    );
    expect(screen.queryByTestId("founder-invitation-status")).toBeNull();
    expect(apiRequestMock.mock.calls.some((call) => String(call[1]).includes("/founder-invitation"))).toBe(false);
    expect((screen.getByTestId("pf-contact-email") as HTMLInputElement).value).toBe("private@partner.example");
  });
});
