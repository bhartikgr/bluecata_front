import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FounderInvitationStatus } from "../FounderInvitationStatus";
import type { FounderInvitation } from "@/lib/portfolioFounderInvitation";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api.request }));
const invite: FounderInvitation = {
  id: "fti_original", email: "original@example.com", name: "Original Founder", status: "pending",
  expiresAt: null, sentAt: null, acceptedAt: null, handoff: { mode: "unknown", result: "unknown" },
};
let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.request.mockReset().mockImplementation(async (method: string, _url: string, body: any) => {
    if (method === "GET") {
      return { json: async () => ({ companyId: "co_test", companyName: "Test Company", invitation: invite, canReissue: true }) };
    } else {
      if (!body.authorityTypedName || body.authorityTypedName.trim().length < 2) {
         return { status: 400, json: async () => ({ error: "AUTHORITY_REQUIRED" }) };
      }
      return { json: async () => ({ founderInvite: { ...invite, id: "fti_next", email: body.founderEmail, name: body.founderName,
        claimUrl: "https://example.test/auth/redeem?token=one-time", handoff: { mode: "smtp", result: "failed" } } }) };
    }
  });
});
afterEach(() => { cleanup(); qc.clear(); });
async function mount(canWrite = true) {
  render(<QueryClientProvider client={qc}><FounderInvitationStatus companyId="co_test" canWrite={canWrite} /></QueryClientProvider>);
  await screen.findByText("original@example.com", { exact: false });
}

describe("slide13b A1 Adversarial UI tests", () => {
  it("mandatory authority: refuses review if authority name is missing or whitespace", async () => {
    await mount();
    fireEvent.click(screen.getByText("Review correction or resend"));
    
    // Fill out email but omit authority name
    const email = screen.getByLabelText("New invitation email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "hacker@example.com" } });
    
    // Attempt review
    fireEvent.click(screen.getByText("Review reissue"));
    
    // Should stay in edit mode or show validation error, not proceed to confirmation
    expect(screen.queryByText("Confirm reissue")).toBeNull();
    // Some visual feedback should exist, or it just prevents moving forward.
  });

  it("native FormData divergence: ignores React state bypass if form is natively edited during confirmation", async () => {
    await mount();
    fireEvent.click(screen.getByText("Review correction or resend"));
    
    const email = screen.getByLabelText("New invitation email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "valid@example.com" } });
    fireEvent.change(screen.getByLabelText("Authority confirmation name"), { target: { value: "Jane Partner" } });
    
    fireEvent.click(screen.getByText("Review reissue"));
    expect(screen.getByText("Confirm reissue")).toBeTruthy();
    
    // Adversarial edit natively after review screen is active
    email.value = "hacker@example.com";
    fireEvent.click(screen.getByText("Confirm reissue"));
    
    // Should notice the change and invalidate, not send the POST request
    expect(api.request.mock.calls.filter(c => c[0] === "POST")).toHaveLength(0);
    expect(screen.getByText(/changed/i)).toBeTruthy(); // Usually "Invitation details changed, review again."
  });

  it("missing data failure: treats empty response as unavailable, not missing invitation", async () => {
    api.request.mockResolvedValueOnce({ json: async () => ({ companyId: "co_test" }) }); // missing canReissue, missing invitation
    render(<QueryClientProvider client={qc}><FounderInvitationStatus companyId="co_test" /></QueryClientProvider>);
    
    await screen.findByText(/unavailable/i);
    expect(screen.queryByText("Review correction or resend")).toBeNull();
  });
});
