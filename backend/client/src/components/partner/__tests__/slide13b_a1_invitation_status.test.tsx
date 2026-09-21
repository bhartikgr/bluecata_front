import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FounderInvitationStatus } from "../FounderInvitationStatus";
import { invalidateFounderInvitationQueries, type FounderInvitation } from "@/lib/portfolioFounderInvitation";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api.request }));
const invite: FounderInvitation = {
  id: "fti_original", email: "original@example.com", name: "Original Founder", status: "pending",
  expiresAt: null, sentAt: null, acceptedAt: null, handoff: { mode: "unknown", result: "unknown" },
};
let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.request.mockReset().mockImplementation(async (method: string, _url: string, body: any) => ({
    json: async () => method === "GET"
      ? { companyId: "co_test", companyName: "Test Company", invitation: invite, canReissue: true }
      : { founderInvite: { ...invite, id: "fti_next", email: body.founderEmail, name: body.founderName,
        claimUrl: "https://example.test/auth/redeem?token=one-time", handoff: { mode: "smtp", result: "failed" } } },
  }));
});
afterEach(() => { cleanup(); qc.clear(); });
async function mount(canWrite = true) {
  render(<QueryClientProvider client={qc}><FounderInvitationStatus companyId="co_test" canWrite={canWrite} /></QueryClientProvider>);
  await screen.findByText("original@example.com", { exact: false });
}
describe("slide13b A1 actual recovery component", () => {
  it("shows exact old/new/company before posting immutable reviewed recipient and truthful failure", async () => {
    await mount();
    fireEvent.click(screen.getByText("Review correction or resend"));
    const email = screen.getByLabelText("New invitation email") as HTMLInputElement;
    email.value = " Corrected@Example.com "; // Native DOM edit with no React event.
    fireEvent.change(screen.getByLabelText("Authority confirmation name"), { target: { value: "Partner" } });
    fireEvent.click(screen.getByText("Review reissue"));
    expect(screen.getByText("Test Company")).toBeTruthy();
    expect(screen.getByText("corrected@example.com")).toBeTruthy();
    expect(screen.getByText("Old address:", { exact: false })).toBeTruthy();
    expect(api.request.mock.calls.filter(c => c[0] === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByText("Confirm reissue"));
    await waitFor(() => expect(api.request.mock.calls.filter(c => c[0] === "POST")).toHaveLength(1));
    expect(api.request.mock.calls.find(c => c[0] === "POST")![2]).toMatchObject({
      expectedInvitationId: "fti_original", founderEmail: "corrected@example.com", founderName: "Original Founder",
    });
    await screen.findByText(/Mail handoff failed/);
    expect(screen.queryByText(/delivered/i)).toBeNull();
    const cached = JSON.stringify(qc.getQueryCache().getAll().map(q => q.state.data));
    expect(cached).not.toContain("one-time");
  });
  it("silent edit after review invalidates rather than silently revising the confirmed recipient", async () => {
    await mount();
    fireEvent.click(screen.getByText("Review correction or resend"));
    fireEvent.change(screen.getByLabelText("Authority confirmation name"), { target: { value: "Partner" } });
    fireEvent.click(screen.getByText("Review reissue"));
    (screen.getByLabelText("New invitation email") as HTMLInputElement).value = "changed@example.com";
    fireEvent.click(screen.getByText("Confirm reissue"));
    expect(api.request.mock.calls.filter(c => c[0] === "POST")).toHaveLength(0);
    expect(screen.getByText(/Invitation details changed/)).toBeTruthy();
  });
  it("read-only partner placement has no reissue control", async () => {
    await mount(false);
    expect(screen.queryByText("Review correction or resend")).toBeNull();
  });
  it("malformed status is an unavailable error, never an invented empty invitation", async () => {
    api.request.mockResolvedValue({ json: async () => ({}) });
    render(<QueryClientProvider client={qc}><FounderInvitationStatus companyId="co_test" /></QueryClientProvider>);
    await screen.findByText(/Invitation status is unavailable/);
    expect(screen.queryByText("No founder owner invitation is recorded.")).toBeNull();
  });
  it("invalidates the actual mounted keys using a real QueryClient", async () => {
    const keys = [
      ["/api/partner/me/pipeline"], ["/api/partner/me/portfolio"],
      ["/api/partner/me/portfolio", "co_test"], ["/api/partner/me/clients"],
      ["/api/partner/me/client-crm-index"], ["/api/partner/me/relationships"],
      ["/api/partner/me/mfcrm/dashboard"], ["/api/partner/me/mfcrm/engagements"],
      ["/api/admin/companies/full"], ["/api/admin/companies", "co_test", "onboarding"],
      ["/api/partner/me/portfolio-companies/co_test/founder-invitation"],
    ];
    keys.forEach(key => qc.setQueryData(key, { exists: true }));
    await invalidateFounderInvitationQueries(qc, "co_test");
    keys.forEach(key => expect(qc.getQueryState(key)?.isInvalidated, key.join(" ")).toBe(true));
  });
});
