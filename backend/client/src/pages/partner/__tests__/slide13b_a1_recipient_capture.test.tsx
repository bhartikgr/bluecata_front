import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerAddPortfolioCompany from "../PartnerAddPortfolioCompany";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "@shared/wave214ThirdPartyAuthorityCopy";

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn(), taxonomyError: false }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/partner/PartnerShell", () => ({ PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({ ready: true, identity: { tier: "builder", subRole: "managing_partner",
    identity: { name: "Acting Partner", email: "actor@example.com" } } }),
}));
vi.mock("@/lib/companyTaxonomy", () => ({
  useCompanySectorTaxonomy: () => ({ data: [{ value: "Robotics", label: "Robotics" }], isLoading: false, isError: mocks.taxonomyError }),
  COMPANY_TAXONOMY_LOADING_COPY: "Loading sectors", COMPANY_TAXONOMY_ERROR_COPY: "Sectors unavailable",
}));
let qc: QueryClient;
let handoff: { mode: string; result: string };
let echoEmail: string | undefined;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  handoff = { mode: "smtp", result: "accepted" }; echoEmail = undefined;
  mocks.taxonomyError = false;
  mocks.toast.mockReset();
  mocks.request.mockReset().mockImplementation(async (method: string, _url: string, body: any) => ({
    json: async () => method === "POST" ? {
      ok: true, companyId: "co_capture", attributedPartnerId: "partner",
      founderInvite: { id: "fti_capture", email: echoEmail ?? body.founderEmail, name: body.founderName,
        status: "pending", claimUrl: "https://example.test/auth/redeem?token=one-time", handoff },
    } : { companyId: "co_capture", companyName: "Visible Company", invitation: null, canReissue: false },
  }));
});
afterEach(() => { cleanup(); qc.clear(); });
function mount() { render(<QueryClientProvider client={qc}><PartnerAddPortfolioCompany /></QueryClientProvider>); }
const fields = {
  "company-name": "Visible Company", "legal-name": "Visible Legal Ltd", "founder-email": " Intended@Example.com ",
  "founder-name": "Visible Founder", sector: "Robotics", stage: "Seed", hq: "Toronto, Canada",
  "authority-name": "Acting Partner",
};
function visibleValues() {
  for (const [id, value] of Object.entries(fields)) {
    (screen.getByTestId(`apc-${id}`) as HTMLInputElement).value = value;
  }
}
const posts = () => mocks.request.mock.calls.filter(c => c[0] === "POST");
function review() { fireEvent.click(screen.getByTestId("apc-create-btn")); }
function confirm() { fireEvent.click(screen.getByTestId("apc-confirm-create")); }

describe("slide13b A1 actual PartnerAddPortfolioCompany capture/mutation boundary", () => {
  it("scopes the invitation access grant without denying existing legitimate multirole access", () => {
    mount();
    expect(screen.getByText(/The invitation grants company access; it does not grant access to your partner workspace\./)).toBeTruthy();
    expect(screen.queryByText(/they only ever access.*never your partner workspace/)).toBeNull();
  });
  it("captures ALL visible DOM fields even while React state is blank; reviews then sends exact immutable snapshot", async () => {
    mount(); visibleValues();
    expect((screen.getByTestId("apc-create-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("apc-authority-statement").textContent).toBe(statement);
    review();
    expect(screen.getByTestId("apc-review-recipient").textContent).toBe("intended@example.com");
    expect(posts()).toHaveLength(0);
    confirm();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][2]).toEqual({
      companyName: "Visible Company", legalName: "Visible Legal Ltd", founderEmail: "intended@example.com",
      founderName: "Visible Founder", sector: "Robotics", stage: "Seed", hq: "Toronto, Canada",
      authorityTypedName: "Acting Partner", authorityStatementShown: statement,
    });
    expect(Object.isFrozen(posts()[0][2])).toBe(true);
    await screen.findByText("Accepted by mail service. Inbox delivery is not confirmed.");
  });
  it("reviews DOM email instead of the previous nonempty controlled-state email", () => {
    mount();
    fireEvent.change(screen.getByTestId("apc-founder-email"), { target: { value: "stale@example.com" } });
    visibleValues();
    review();
    expect(screen.getByTestId("apc-review-recipient").textContent).toBe("intended@example.com");
    expect(posts()).toHaveLength(0);
  });
  it("taxonomy error/disabled controls cannot drop a selected custom sector from the reviewed payload", async () => {
    mocks.taxonomyError = true;
    mount(); visibleValues();
    const input = screen.getByTestId("apc-sector") as HTMLInputElement;
    input.value = "Custom Robotics";
    input.disabled = true; // Defense beyond current D UI (only select disables).
    expect((screen.getByTestId("apc-sector-select") as HTMLSelectElement).disabled).toBe(true);
    expect(new FormData(input.form!).get("sector")).toBeNull();
    review();
    expect(screen.getByText("Sector: Custom Robotics")).toBeTruthy();
    confirm();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][2].sector).toBe("Custom Robotics");
    expect(input.form?.querySelectorAll('[name="sector"]').length).toBe(1);
  });
  it("silent edit after review refuses submission until a fresh review; normal editing also invalidates", async () => {
    mount(); visibleValues(); review();
    (screen.getByTestId("apc-founder-email") as HTMLInputElement).value = "new@example.com";
    confirm();
    expect(posts()).toHaveLength(0);
    expect(screen.getByText(/changed.*review again/i)).toBeTruthy();
    review();
    expect(screen.getByTestId("apc-review-recipient").textContent).toBe("new@example.com");
    fireEvent.input(screen.getByTestId("apc-founder-name"), { target: { value: "Changed Name" } });
    expect(screen.queryByTestId("apc-confirm-create")).toBeNull();
  });
  it("server echo mismatch is a visible integrity warning, not invitation success", async () => {
    echoEmail = "different@example.com";
    mount(); visibleValues(); review(); confirm();
    await screen.findByText(/Recipient integrity warning/);
    expect(screen.queryByTestId("apc-claim-link")).toBeNull();
    expect(mocks.toast.mock.calls.every(c => c[0].variant === "destructive")).toBe(true);
  });
  it.each([
    [{ mode: "smtp", result: "failed" }, /Mail handoff failed/],
    [{ mode: "dry_run", result: "simulated" }, /Simulated send only/],
    [{ mode: "console", result: "simulated" }, /Simulated send only/],
  ])("truthfully presents %j without claiming delivery", async (outcome, copy) => {
    handoff = outcome;
    mount(); visibleValues(); review(); confirm();
    await screen.findByText(copy);
    expect(screen.queryByText(/has been invited to claim it/)).toBeNull();
    expect(screen.queryByText(/\bdelivered\b/i)).toBeNull();
  });
});
