// @vitest-environment jsdom
/**
 * 2026-09-19 · SLIDE 13a — THE PARTNER INBOX FOLLOWS THE URL'S SCOPE, INCLUDING
 * QUERY-ONLY CHANGES ON THE SAME PATH.
 *
 * Real-browser finding: standing on `/collective/partner/notifications`, the
 * bell's "1 more across your account" entry changed the URL to
 * `?scope=account` but the centre stayed on the workspace view (its effect was
 * keyed on the pathname only). This suite renders the REAL `CollectiveShell` +
 * REAL `NotificationBell` + REAL `NotificationCenter surface="partner"` against
 * a SURFACE-AWARE fixture (the response differs by `?surface=`), then proves:
 *
 *   S1  workspace view on first load; 1 row; counts from the partner set;
 *   S2  the bell's account-history entry on the SAME path switches the centre to
 *       the account view (2 rows, workspace badges incl. "Workspace not
 *       identified"), radio reflects account;
 *   S3  browser BACK restores the workspace view;
 *   S4  direct load with `?scope=account` opens in the account view;
 *   S5  the toggle buttons write the query (so back/forward restore them);
 *   S6  0 / non-zero copy: account-view counts render the account totals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

type Row = { id: string; userId: string; kind: string; title: string; body: string; link?: string; read: boolean; archived: boolean; createdAt: string };
const now = () => new Date().toISOString();
const PARTNER_ROW: Row = { id: "ntf_p1", userId: "u_test", kind: "partner.promotion_approved", title: "Promotion approved", body: "b", link: "/partner/pipeline", read: false, archived: false, createdAt: now() };
const UNKNOWN_ROW: Row = { id: "ntf_u1", userId: "u_test", kind: "investor_report.published", title: "Old post notice", body: "b", link: "/posts/legacy", read: false, archived: false, createdAt: now() };

const calls: string[] = [];
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const body = (url: string): unknown => {
    if (url.startsWith("/api/notifications/stream")) throw new Error("404");
    if (url.startsWith("/api/notifications?")) {
      const surface = new URLSearchParams(url.split("?")[1]).get("surface");
      if (surface === "partner") return { userId: "u_test", total: 1, unread: 1, surface: "partner", outsideWorkspace: 1, unclassified: 0, items: [PARTNER_ROW] };
      if (surface === "account") return { userId: "u_test", total: 2, unread: 2, surface: "account", outsideWorkspace: 0, unclassified: 1, items: [PARTNER_ROW, UNKNOWN_ROW] };
      return { userId: "u_test", total: 0, unread: 0, surface, outsideWorkspace: 0, unclassified: 0, items: [] };
    }
    if (url === "/api/auth/me") return { isAuthed: true, userId: "u_test" };
    if (url === "/api/me/chapters") return { ok: true, chapters: [] };
    if (url === "/api/partner/me") return { partnerId: "pt_test", tier: "catalyst", subRole: "managing_partner", identity: { userId: "u_test", email: "gp@example.com", name: "Test GP" } };
    if (url === "/api/feature-flags") return { PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: false };
    if (url === "/api/feeds/ticker") return { status: "PROVIDER_NOT_CONFIGURED" };
    return {};
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (_m: string, url: string) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => body(url) } as unknown as Response;
    }),
  };
});

import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CollectiveShell } from "@/components/CollectiveShell";
import NotificationCenter from "@/pages/NotificationCenter";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import { apiRequest } from "@/lib/queryClient";

const PATH = "/collective/partner/notifications";

function renderInbox(url: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async ({ queryKey }) => (await apiRequest("GET", String(queryKey[0]))).json() } },
  });
  window.history.pushState({}, "", url);
  return render(
    React.createElement(QueryClientProvider, { client: queryClient },
      React.createElement(Router, null,
        React.createElement(RoleProvider, null,
          React.createElement(LegalDrawerProvider, null,
            React.createElement(CollectiveShell, null,
              React.createElement(NotificationCenter, { surface: "partner", chrome: "collective" })))))),
  );
}
const toggle = () => screen.getByTestId("notification-scope-toggle");
const url = () => window.location.pathname + window.location.search;

async function openBell(waitForTestId: string): Promise<HTMLElement> {
  const trigger = await screen.findByTestId("button-notifications", {}, { timeout: 4000 });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
  await waitFor(() => expect(document.body.querySelector(`[data-testid="${waitForTestId}"]`)).toBeTruthy(), { timeout: 4000 });
  return document.body;
}
function selectItem(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(el, { button: 0, pointerType: "mouse" });
  fireEvent.click(el);
}

beforeEach(() => { cleanup(); calls.length = 0; });
afterEach(() => { cleanup(); });

describe("S1 — first load is the workspace view", () => {
  it("1 partner row, partner counts, no workspace badges, radio = workspace", async () => {
    renderInbox(PATH);
    await screen.findByTestId("row-notification-ntf_p1", {}, { timeout: 4000 });
    expect(toggle().getAttribute("data-scope")).toBe("workspace");
    expect(screen.queryByTestId("row-notification-ntf_u1")).toBeNull();
    expect(screen.getByTestId("text-notification-counts").textContent).toContain("1 total");
    expect(screen.queryByTestId("workspace-ntf_p1")).toBeNull();
    expect(calls.some((u) => u.startsWith("/api/notifications?") && u.includes("surface=partner"))).toBe(true);
    expect(screen.getByTestId("text-page-title").textContent).toBe("Notification center");
  });
});

describe("S2/S3 — same-path query navigation from the bell, then browser back", () => {
  it("bell '1 more across your account' → ?scope=account → account view; back → workspace view", async () => {
    renderInbox(PATH);
    await screen.findByTestId("row-notification-ntf_p1", {}, { timeout: 4000 });
    const body = await openBell("button-open-account-history");
    const hist = body.querySelector('[data-testid="button-open-account-history"]')!;
    expect(hist.textContent).toContain("1 more across your account");
    selectItem(hist);
    await waitFor(() => expect(url()).toBe(`${PATH}?scope=account`), { timeout: 4000 });
    /* THE FIX: the centre reacts to the query-only change on the same path. */
    await waitFor(() => {
      expect(toggle().getAttribute("data-scope")).toBe("account");
      expect(screen.getByTestId("row-notification-ntf_u1")).toBeTruthy();
    }, { timeout: 4000 });
    expect(screen.getByTestId("workspace-ntf_u1").textContent).toBe("Workspace not identified");
    expect(screen.getByTestId("workspace-ntf_p1").textContent).toBe("Consortium Partner");
    expect(screen.getByTestId("text-notification-counts").textContent).toContain("2 total");
    expect(calls.some((u) => u.startsWith("/api/notifications?") && u.includes("surface=account"))).toBe(true);
    // menu closed after the navigation
    await waitFor(() => expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("false"), { timeout: 4000 });

    window.history.back();
    await waitFor(() => expect(url()).toBe(PATH), { timeout: 4000 });
    await waitFor(() => {
      expect(toggle().getAttribute("data-scope")).toBe("workspace");
      expect(screen.queryByTestId("row-notification-ntf_u1")).toBeNull();
    }, { timeout: 4000 });
  });
});

describe("S4 — direct load with ?scope=account", () => {
  it("opens in the account view with both rows", async () => {
    renderInbox(`${PATH}?scope=account`);
    await screen.findByTestId("row-notification-ntf_u1", {}, { timeout: 4000 });
    expect(toggle().getAttribute("data-scope")).toBe("account");
    expect(screen.getByTestId("row-notification-ntf_p1")).toBeTruthy();
  });
});

describe("S5 — the toggle buttons write the URL", () => {
  it("Across your account → ?scope=account; This workspace → query removed; back restores account", async () => {
    renderInbox(PATH);
    await screen.findByTestId("row-notification-ntf_p1", {}, { timeout: 4000 });
    fireEvent.click(screen.getByTestId("scope-account"));
    await waitFor(() => expect(url()).toBe(`${PATH}?scope=account`), { timeout: 4000 });
    await waitFor(() => expect(toggle().getAttribute("data-scope")).toBe("account"), { timeout: 4000 });
    fireEvent.click(screen.getByTestId("scope-workspace"));
    await waitFor(() => expect(url()).toBe(PATH), { timeout: 4000 });
    await waitFor(() => expect(toggle().getAttribute("data-scope")).toBe("workspace"), { timeout: 4000 });
    window.history.back();
    await waitFor(() => expect(toggle().getAttribute("data-scope")).toBe("account"), { timeout: 4000 });
    expect(screen.getByTestId("scope-workspace").textContent).toContain("This workspace · Consortium Partner");
  });
});
