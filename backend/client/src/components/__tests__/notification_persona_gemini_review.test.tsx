import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerManagedFounders from "@/pages/partner/PartnerManagedFounders";
import NotificationCenter from "@/pages/NotificationCenter";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

describe("Gemini Postbuild Review - Notification Persona 2026-09-19 Stable2", () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = new QueryClient({ 
      defaultOptions: { 
        queries: { 
          retry: false, 
          staleTime: Infinity,
          queryFn: async ({ queryKey }) => {
            const res = await apiRequest("GET", queryKey[0] as string);
            return res.json();
          }
        } 
      } 
    });
    vi.resetAllMocks();

    const mockResponse = (data: any) => Promise.resolve({ json: async () => data, status: 200, ok: true });

    (apiRequest as any).mockImplementation(async (method: string, url: string) => {
      if (url === "/api/auth/me") return mockResponse({ isAuthed: true, userId: "u_partner_1" });
      if (url === "/api/partner/me") return mockResponse({
        partnerId: "p_1",
        subRole: "managing_partner",
        tier: "nexus",
        status: "active",
        identity: { userId: "u_partner_1", email: "test@test.com", name: "Test Partner" }
      });
      if (url === "/api/partner/me/agreement") return mockResponse({ signedCurrent: true, canSign: false });
      if (url === "/api/partner/me/mfcrm/capability") return mockResponse({ capability: { authorized: true, delegated_agency: true, max_active_engagements: 10 } });
      if (url === "/api/partner/me/mfcrm/dashboard") return mockResponse({
        engagements: { active: 2 }, openCrossoverFlags: 0, queuedPushes: 4
      });
      if (url === "/api/partner/me/mfcrm/engagements") return mockResponse({ engagements: [] });
      
      if (url.startsWith("/api/notifications")) {
        if (url.includes("surface=account")) {
          return mockResponse({ 
            items: [
              { id: "n_acc_1", userId: "u_partner_1", kind: "system_alert", title: "Account Notice", body: "Account wide message", read: false, archived: false, createdAt: new Date().toISOString() }
            ], 
            total: 45, 
            unread: 15,
            surface: "account",
            unclassified: 0,
            outsideWorkspace: 0
          });
        }
        if (url.includes("surface=partner")) {
          return mockResponse({ 
            items: [
              { id: "n_part_1", userId: "u_partner_1", kind: "partner_invite", title: "Partner Notice", body: "Partner specific message", read: false, archived: false, createdAt: new Date().toISOString() }
            ], 
            total: 10, 
            unread: 2,
            surface: "partner",
            unclassified: 0,
            outsideWorkspace: 5
          });
        }
      }
      return mockResponse({});
    });
  });

  afterEach(() => {
    cleanup();
  });

  const dummyHook = () => ["/", () => {}] as [string, any];

  test("PartnerManagedFounders exact copy is present and zero count does not mislead", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={dummyHook}>
          <PartnerManagedFounders />
        </Router>
      </QueryClientProvider>
    );
    
    const title = await screen.findByText("Pending sharing requests");
    expect(title).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
    const warning = screen.getByTestId("mf-queued-pushes-no-delivery");
    expect(warning.textContent).toContain("Requests recorded for vehicles created on a founder’s behalf. Pending requests have not been shared with the Collective and do not give investors access.");
  });

  test("NotificationCenter in collective shell drops AppShell header", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={dummyHook}>
          <NotificationCenter chrome="collective" surface="partner" />
        </Router>
      </QueryClientProvider>
    );

    const header = await screen.findByTestId("notification-center-header-collective");
    expect(header).toBeDefined();
    expect(screen.queryByTestId("button-open-glossary")).toBeNull();
  });

  test("NotificationCenter reacts to query-only navigation (same path) for scope changes", async () => {
    const { hook, navigate } = memoryLocation({ path: "/collective/partner/notifications", record: true });
    
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <NotificationCenter chrome="collective" surface="partner" />
        </Router>
      </QueryClientProvider>
    );

    const counts = await screen.findByTestId("text-notification-counts");
    expect(counts.textContent).toContain("10 total");
    
    // Ensure partner specific notification rendered
    const partnerNotice = await screen.findByText("Partner specific message");
    expect(partnerNotice).toBeDefined();

    const scopeWorkspaceBtn = screen.getByTestId("scope-workspace");
    const scopeAccountBtn = screen.getByTestId("scope-account");

    expect(scopeWorkspaceBtn.className).toContain("bg-primary");
    expect(scopeAccountBtn.className).not.toContain("bg-primary");

    act(() => {
      fireEvent.click(scopeAccountBtn);
    });

    const countsAfter = await screen.findByTestId("text-notification-counts");
    expect(countsAfter.textContent).toContain("45 total");

    // Ensure account specific notification rendered
    const accountNotice = await screen.findByText("Account wide message");
    expect(accountNotice).toBeDefined();

    expect(scopeWorkspaceBtn.className).not.toContain("bg-primary");
    expect(scopeAccountBtn.className).toContain("bg-primary");

    act(() => {
      navigate("/collective/partner/notifications", { replace: false });
    });

    const countsBack = await screen.findByTestId("text-notification-counts");
    expect(countsBack.textContent).toContain("10 total");
    
    const partnerNoticeBack = await screen.findByText("Partner specific message");
    expect(partnerNoticeBack).toBeDefined();
  });
});
