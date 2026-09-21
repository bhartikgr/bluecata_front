// @vitest-environment jsdom
/**
 * 2026-09-19 · SLIDE 13a — THE MOUNTED BELL, IN THE REAL SHELL, AGAINST THE
 * LIVE DEFECT'S ROW SHAPE.
 *
 * The live rows (ntf_84eafa149474 … kind `partner.promotion_approved`, link
 * `/partner/pipeline`) sent a Consortium Partner out of their shell to the
 * Capavate "Page not found". This suite renders the REAL `CollectiveShell` with
 * the REAL `NotificationBell` and a deterministic network layer that answers the
 * persona facade's shapes, then reads the MOUNTED tree and `window.location`:
 *
 *   T1  the list/count query asks the server for `surface=partner`;
 *   T2  clicking the old row lands on `/collective/partner/pipeline` and the
 *       partner nav is still mounted (same shell, no escape);
 *   T3  a row that belongs to another workspace never navigates from a
 *       persona view (defence in depth behind the server filter);
 *   T4  an unsafe stored link never navigates;
 *   T5  "View all" is the SAME-surface inbox (shell-supplied href), and the
 *       account-history entry appears only when the server reports rows
 *       outside this workspace, with `?scope=account` on the shell's own inbox;
 *   T6  "Mark all read" posts `{surface}` to the facade and re-reads the list;
 *   T7  a failed read renders the error notice — never "caught up".
 *
 * Harness notes (W149): Radix opens on pointerdown; the menu renders in a portal
 * on document.body; the bell renders nothing until `/api/auth/me` resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

type Row = {
  id: string; userId: string; kind: string; title: string; body: string;
  link?: string; read: boolean; archived: boolean; createdAt: string;
};
const now = () => new Date().toISOString();
const ROW_OLD_ALIAS: Row = {
  id: "ntf_84eafa149474", userId: "u_test", kind: "partner.promotion_approved",
  title: "Promotion approved", body: "Your promotion request was approved.",
  link: "/partner/pipeline", read: false, archived: false, createdAt: now(),
};
const ROW_FOREIGN_SURFACE: Row = {
  id: "ntf_foreign", userId: "u_test", kind: "founder.round_update",
  title: "Founder row leaked into a partner view", body: "Should never navigate here.",
  link: "/founder/dashboard", read: false, archived: false, createdAt: now(),
};
const ROW_UNSAFE: Row = {
  id: "ntf_unsafe", userId: "u_test", kind: "partner.referral_received",
  title: "Unsafe link", body: "javascript scheme",
  link: "javascript:alert(1)", read: true, archived: false, createdAt: now(),
};

/** When set, the list request is held until `releaseList()` is called (T8). */
let holdList: Promise<void> | null = null;
let releaseList: () => void = () => {};
let listing: { userId: string; total: number; unread: number; items: Row[]; surface: string; outsideWorkspace: number; unclassified: number };
let failList = false;
const calls: Array<{ method: string; url: string; body?: unknown }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const body = (method: string, url: string): { status: number; json: unknown } => {
    if (url.startsWith("/api/notifications/read-all")) {
      listing = { ...listing, unread: 0, items: listing.items.map((r) => ({ ...r, read: true })) };
      return { status: 200, json: { ok: true, updated: listing.items.length, surface: "partner" } };
    }
    if (url.startsWith("/api/notifications/stream")) return { status: 404, json: {} };
    if (url.startsWith("/api/notifications")) {
      if (failList) return { status: 503, json: { error: "NOTIFICATIONS_UNAVAILABLE" } };
      return { status: 200, json: listing };
    }
    if (url === "/api/auth/me") return { status: 200, json: { isAuthed: true, userId: "u_test" } };
    if (url === "/api/me/chapters") return { status: 200, json: { ok: true, chapters: [] } };
    if (url === "/api/partner/me") {
      return { status: 200, json: { partnerId: "pt_test", tier: "catalyst", subRole: "managing_partner", identity: { userId: "u_test", email: "gp@example.com", name: "Test GP" } } };
    }
    if (url === "/api/feature-flags") return { status: 200, json: { PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: false } };
    if (url === "/api/feeds/ticker") return { status: 200, json: { status: "PROVIDER_NOT_CONFIGURED" } };
    return { status: 200, json: {} };
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (method: string, url: string, data?: unknown) => {
      calls.push({ method, url, body: data });
      if (method === "GET" && /^\/api\/notifications\?/.test(url) && holdList) await holdList;
      const r = body(method, url);
      if (r.status >= 400) throw new Error(`${r.status}: ${JSON.stringify(r.json)}`);
      return { ok: true, status: r.status, json: async () => r.json } as unknown as Response;
    }),
  };
});

import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CollectiveShell } from "@/components/CollectiveShell";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import { apiRequest } from "@/lib/queryClient";

function renderShell(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, gcTime: 0,
        queryFn: async ({ queryKey }) => (await apiRequest("GET", String(queryKey[0]))).json(),
      },
    },
  });
  window.history.pushState({}, "", path);
  return render(
    React.createElement(QueryClientProvider, { client: queryClient },
      React.createElement(Router, null,
        React.createElement(RoleProvider, null,
          React.createElement(LegalDrawerProvider, null,
            React.createElement(CollectiveShell, null,
              React.createElement("div", { "data-testid": "child" }, "child")))))),
  );
}

async function bell(): Promise<HTMLElement> {
  return screen.findByTestId("button-notifications", {}, { timeout: 4000 });
}
async function openBell(waitForTestId: string): Promise<HTMLElement> {
  const trigger = await bell();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(trigger);
  await waitFor(() => {
    expect(document.body.querySelector(`[data-testid="${waitForTestId}"]`)).toBeTruthy();
  }, { timeout: 4000 });
  return document.body;
}
/** Radix menu items act on pointer-up/click sequence; fire both like a mouse. */
function selectItem(el: Element) {
  fireEvent.pointerDown(el, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(el, { button: 0, pointerType: "mouse" });
  fireEvent.click(el);
}

beforeEach(() => {
  cleanup();
  calls.length = 0;
  failList = false;
  holdList = null;
  listing = {
    userId: "u_test", total: 3, unread: 2, surface: "partner", outsideWorkspace: 0, unclassified: 0,
    items: [ROW_OLD_ALIAS, ROW_FOREIGN_SURFACE, ROW_UNSAFE],
  };
});
afterEach(() => { cleanup(); });

const PARTNER_START = "/collective/partner/dashboard";

describe("T1 — the mounted partner bell queries the partner surface", () => {
  it("list URL carries surface=partner; the bell exposes data-surface=partner", async () => {
    renderShell(PARTNER_START);
    const b = await bell();
    expect(b.getAttribute("data-surface")).toBe("partner");
    await waitFor(() => {
      expect(calls.some((c) => c.method === "GET" && /^\/api\/notifications\?/.test(c.url) && /surface=partner/.test(c.url))).toBe(true);
    }, { timeout: 4000 });
    // count from the SAME scoped listing
    await waitFor(() => expect(b.getAttribute("data-unread-count")).toBe("2"), { timeout: 4000 });
    expect(screen.getByTestId("badge-unread-count").textContent).toBe("2");
  });
});

describe("T2 — the live defect's row lands inside the partner shell", () => {
  it("clicking the `/partner/pipeline` row navigates to /collective/partner/pipeline; partner nav still mounted", async () => {
    renderShell(PARTNER_START);
    const body = await openBell(`notification-${ROW_OLD_ALIAS.id}`);
    const row = body.querySelector(`[data-testid="notification-${ROW_OLD_ALIAS.id}"]`)!;
    expect(row.getAttribute("data-kind")).toBe("partner.promotion_approved");
    selectItem(row);
    await waitFor(() => expect(window.location.pathname).toBe("/collective/partner/pipeline"), { timeout: 4000 });
    expect(window.location.pathname).not.toBe("/partner/pipeline");
    // Same shell: the partner navigation is still in the tree (no escape to AppShell / not-found).
    expect(await screen.findByTestId("nav-partner-dashboard", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByTestId("brand-product-label").textContent).toContain("Consortium Partner");
    expect(document.body.textContent).not.toContain("Page not found");
    /* REGRESSION (real-browser finding): the still-open menu survived the
       same-shell navigation and intercepted pointer events on the next page.
       After a successful row navigation the menu must be CLOSED. */
    await waitFor(() => {
      expect(document.body.querySelector('[data-testid="notification-ntf_84eafa149474"]')).toBeNull();
      expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("false");
      expect(screen.getByTestId("button-notifications").getAttribute("data-state")).toBe("closed");
    }, { timeout: 4000 });
    /* …and the bell is usable again with an ORDINARY click sequence (no force). */
    const trigger = screen.getByTestId("button-notifications");
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger.getAttribute("data-menu-open")).toBe("true"), { timeout: 4000 });
  });

  it("browser BACK after the row navigation returns to the start page with the menu still closed", async () => {
    renderShell(PARTNER_START);
    const body = await openBell(`notification-${ROW_OLD_ALIAS.id}`);
    selectItem(body.querySelector(`[data-testid="notification-${ROW_OLD_ALIAS.id}"]`)!);
    await waitFor(() => expect(window.location.pathname).toBe("/collective/partner/pipeline"), { timeout: 4000 });
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe(PARTNER_START), { timeout: 4000 });
    expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("false");
    expect(document.body.querySelector('[data-testid="notification-ntf_84eafa149474"]')).toBeNull();
  });
});

describe("T3/T4 — rows that must not navigate from a persona view", () => {
  it("a founder-surface row in the partner bell does NOT change location", async () => {
    renderShell(PARTNER_START);
    const body = await openBell(`notification-${ROW_FOREIGN_SURFACE.id}`);
    selectItem(body.querySelector(`[data-testid="notification-${ROW_FOREIGN_SURFACE.id}"]`)!);
    await new Promise((r) => setTimeout(r, 150));
    expect(window.location.pathname).toBe(PARTNER_START);
    // nothing happened, so nothing disappears: the menu stays open with the row visible
    expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("true");
  });
  it("an unsafe stored link (javascript:) never navigates", async () => {
    renderShell(PARTNER_START);
    const body = await openBell(`notification-${ROW_UNSAFE.id}`);
    selectItem(body.querySelector(`[data-testid="notification-${ROW_UNSAFE.id}"]`)!);
    await new Promise((r) => setTimeout(r, 150));
    expect(window.location.pathname).toBe(PARTNER_START);
    expect(window.location.href).not.toContain("javascript");
  });
});

describe("T5 — View all / account history", () => {
  it("View all = partner inbox; NO account-history entry when outsideWorkspace=0", async () => {
    renderShell(PARTNER_START);
    const body = await openBell("button-open-notification-center");
    const viewAll = body.querySelector('[data-testid="button-open-notification-center"]')!;
    expect(viewAll.getAttribute("data-view-all-href")).toBe("/collective/partner/notifications");
    expect(viewAll.getAttribute("data-view-all-scope")).toBe("shell");
    expect(body.querySelector('[data-testid="button-open-account-history"]')).toBeNull();
    selectItem(viewAll);
    await waitFor(() => expect(window.location.pathname).toBe("/collective/partner/notifications"), { timeout: 4000 });
    expect(await screen.findByTestId("nav-partner-notifications", {}, { timeout: 4000 })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("false"), { timeout: 4000 });
  });
  it("with rows outside this workspace, a LABELLED account-history entry points at the shell's own inbox ?scope=account", async () => {
    listing = { ...listing, outsideWorkspace: 3 };
    renderShell(PARTNER_START);
    const body = await openBell("button-open-account-history");
    const hist = body.querySelector('[data-testid="button-open-account-history"]')!;
    expect(hist.getAttribute("data-outside-workspace-count")).toBe("3");
    expect(hist.textContent).toContain("3 more across your account");
    selectItem(hist);
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe("/collective/partner/notifications?scope=account"), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId("button-notifications").getAttribute("data-menu-open")).toBe("false"), { timeout: 4000 });
  });
});

describe("T6 — Mark all read is scoped to the bell's surface", () => {
  it("POSTs /api/notifications/read-all with {surface:'partner'} and refetches the scoped list", async () => {
    renderShell(PARTNER_START);
    const body = await openBell("button-mark-all-read");
    const before = calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/notifications?")).length;
    fireEvent.click(body.querySelector('[data-testid="button-mark-all-read"]')!);
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url === "/api/notifications/read-all");
      expect(post).toBeTruthy();
      expect(post!.body).toEqual({ surface: "partner" });
    }, { timeout: 4000 });
    await waitFor(() => {
      const after = calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/notifications?")).length;
      expect(after).toBeGreaterThan(before);
    }, { timeout: 4000 });
    await waitFor(() => expect((screen.getByTestId("button-notifications")).getAttribute("data-unread-count")).toBe("0"), { timeout: 4000 });
  });
});

describe("T7 — a failed read is an error, never 'caught up'", () => {
  it("renders text-notifications-error and no empty-state copy", async () => {
    failList = true;
    renderShell(PARTNER_START);
    const body = await openBell("text-notifications-error");
    const err = body.querySelector('[data-testid="text-notifications-error"]')!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("could not be loaded");
    expect(body.querySelector('[data-testid="text-notifications-empty"]')).toBeNull();
    expect(body.textContent).not.toContain("all caught up");
    expect(screen.getByTestId("button-notifications").getAttribute("data-unread-count")).toBe("0");
  });
});

describe("T8 — an unresolved first read is LOADING, never 'caught up'", () => {
  it("while the list request is held: loading notice, no empty copy, no error; after release: rows", async () => {
    holdList = new Promise<void>((resolve) => { releaseList = resolve; });
    renderShell(PARTNER_START);
    const body = await openBell("text-notifications-loading");
    const loading = body.querySelector('[data-testid="text-notifications-loading"]')!;
    expect(loading.getAttribute("role")).toBe("status");
    expect(loading.textContent).toContain("Loading notifications");
    expect(body.querySelector('[data-testid="text-notifications-empty"]')).toBeNull();
    expect(body.querySelector('[data-testid="text-notifications-error"]')).toBeNull();
    expect(body.textContent).not.toContain("all caught up");
    releaseList();
    await waitFor(() => {
      expect(body.querySelector(`[data-testid="notification-${ROW_OLD_ALIAS.id}"]`)).toBeTruthy();
      expect(body.querySelector('[data-testid="text-notifications-loading"]')).toBeNull();
    }, { timeout: 4000 });
  });
  it("a resolved EMPTY list is the empty state (the three states are distinct)", async () => {
    listing = { ...listing, total: 0, unread: 0, items: [] };
    renderShell(PARTNER_START);
    const body = await openBell("text-notifications-empty");
    expect(body.querySelector('[data-testid="text-notifications-loading"]')).toBeNull();
    expect(body.querySelector('[data-testid="text-notifications-error"]')).toBeNull();
  });
});
