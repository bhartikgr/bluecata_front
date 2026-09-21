// @vitest-environment jsdom
/**
 * WAVE 149 — THE NOTIFICATION BELL REACHES THE COLLECTIVE SHELL (batch 2 item E).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `server/notificationsStore.ts` writes notifications for consortium partners and
 * for every Collective persona, and serves them at `/api/notifications`. But
 * `NotificationBell` was mounted at `AppShell.tsx:715` ONLY. Partner and Collective
 * pages render inside `CollectiveShell`, and `/collective/*` is forced bare at
 * `App.tsx:457`, so AppShell never renders for them. Result: every notification
 * addressed to those personas was written, stored, and shown to nobody — including
 * kinds that exist for no one else (`partner.referral_received`,
 * `partner.attribution_granted`, `partner.promotion_approved`).
 *
 * A second, quieter breach rode along: `NotificationBell.tsx:167` rendered the raw
 * persisted `{n.kind}` as a text node, so the first person ever to see a Collective
 * notification would have read `collective.screening_event.rsvp_changed`. **R77**
 * bans internal identifiers in rendered text.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE ASSERTS — RENDERED DOM, NOT SOURCE TEXT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The REAL `CollectiveShell` is rendered with the REAL `NotificationBell` inside it,
 * against a deterministic network layer, in BOTH shell modes, and the assertions
 * read the mounted tree. Only ONE assertion reads source (§E-T3's proof that the
 * AppShell mount was not disturbed), and it is explicitly labelled as such.
 *
 * FAIL-BEFORE (real output in w149_scratch/fail_before_raw.txt).
 *
 * Written without JSX, as a `.test.ts`, matching
 * `CollectiveShell.partnerHooks.test.ts` — that keeps the file inside vitest's
 * client glob and outside the tsc budget (tsconfig excludes test files), so the
 * 557-error baseline is untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

/** Flipped per test to select partner-only vs Collective-member mode. */
let chapters: Array<{ id: string }> = [];

/** The notification list the bell reads. Deliberately carries a kind that IS in
 *  the canonical union and one that is NOT, so both the mapped label and the
 *  generic fallback are exercised through the real render. */
const NOTIFS = {
  userId: "u_test",
  total: 3,
  unread: 2,
  items: [
    {
      id: "ntf_1", userId: "u_test", kind: "partner.referral_received",
      title: "A founder was referred to you", body: "Acme Robotics asked for an introduction.",
      read: false, archived: false, createdAt: new Date().toISOString(),
    },
    {
      id: "ntf_2", userId: "u_test", kind: "collective.screening_event.rsvp_changed",
      title: "Screening RSVP changed", body: "One attendee changed their response.",
      read: false, archived: false, createdAt: new Date().toISOString(),
    },
    {
      id: "ntf_3", userId: "u_test", kind: "some.kind.this.build.never.heard.of",
      title: "Something happened", body: "A newer server sent a kind this bundle has no label for.",
      read: true, archived: false, createdAt: new Date().toISOString(),
    },
  ],
};

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const body = (url: string): unknown => {
    if (url.startsWith("/api/notifications")) return NOTIFS;
    if (url === "/api/auth/me") return { isAuthed: true, userId: "u_test" };
    if (url === "/api/me/chapters") return { ok: true, chapters };
    if (url === "/api/partner/me") {
      return {
        partnerId: "pt_test", tier: "catalyst", subRole: "managing_partner",
        identity: { userId: "u_test", email: "gp@example.com", name: "Test GP" },
      };
    }
    if (url === "/api/feature-flags") {
      return { PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: false };
    }
    if (url === "/api/feeds/ticker") return { status: "PROVIDER_NOT_CONFIGURED" };
    return {};
  };
  return {
    ...actual,
    apiRequest: vi.fn(async (_m: string, url: string) => (
      { ok: true, status: 200, json: async () => body(url) } as unknown as Response
    )),
  };
});

/* The bell's own list query has no queryFn of its own — it relies on the app's
   default fetcher — so the QueryClient below is given one that routes through the
   same deterministic table. */
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { CollectiveShell } from "@/components/CollectiveShell";
import { RoleProvider } from "@/lib/role";
import { LegalDrawerProvider } from "@/lib/legalDrawer";
import { apiRequest } from "@/lib/queryClient";
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_KIND_FALLBACK_LABEL } from "@/lib/notificationKindLabels";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

/** The bell trigger, once the auth probe has resolved. It renders NOTHING for an
 *  anonymous session, so waiting is the honest way to assert presence. */
/* The expected route, written as a LITERAL rather than imported from the shell.
   Importing the shell's own constant would make the assertion tautological (it
   would pass for any value the source happened to hold) and would also make this
   file fail to load against a pre-wave tree, hiding the render failures the
   fail-before harness exists to show. */
const COLLECTIVE_NOTIFICATIONS_HREF = "/collective/notifications";

async function bell(): Promise<HTMLElement> {
  return screen.findByTestId("button-notifications", {}, { timeout: 4000 });
}

/* HARNESS NOTE, recorded rather than hidden: the first run of this suite had four
   failures and all four were the SAME harness bug, fixed in the harness and not by
   weakening an assertion. Radix's DropdownMenuTrigger opens on `pointerdown`, not
   on `click`, and it renders its content in a PORTAL attached to document.body —
   so `fireEvent.click` left the menu shut and `container.querySelector` could not
   have seen it even if it had opened. The menu is therefore opened with a
   pointer-down and read out of `document.body`. */
async function openBell(): Promise<HTMLElement> {
  const trigger = await bell();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(trigger);
  await waitFor(() => {
    expect(document.body.querySelector('[data-testid="notification-ntf_1"]')).toBeTruthy();
  }, { timeout: 4000 });
  return document.body;
}

beforeEach(() => { chapters = []; cleanup(); });
afterEach(() => { cleanup(); });

describe("W149 · E-T1 — the bell renders INSIDE the Collective/partner shell", () => {
  it("a partner-only session on a partner page gets the bell, in its own shell", async () => {
    chapters = []; // no active chapter ⇒ partnerOnly
    const { container } = renderShell("/collective/partner/dashboard");
    const b = await bell();
    expect(b).toBeTruthy();

    /* IN ITS OWN SHELL, not ejected into Capavate chrome. The partner-only brand
       block and the partner logout button are CollectiveShell's own; AppShell
       renders neither. */
    expect(screen.getByTestId("brand-product-label").textContent).toContain("Consortium Partner");
    expect(container.querySelector('[data-testid="button-partner-logout"]')).toBeTruthy();
    /* And the bell is a DESCENDANT of this shell's own header, in the same
       right-hand group as the chrome that was already there. */
    const header = b.closest("header");
    expect(header, "the bell must live in CollectiveShell's own header").toBeTruthy();
    expect(header!.querySelector('[data-testid="topbar-title"]')?.textContent)
      .toContain("Capavate Consortium Partner");

    /* THE SIBLINGS SURVIVED. Item 1 required a NEW static sibling, not a
       conditional replacing the existing ones. */
    expect(b.parentElement!.querySelector('[data-testid="button-partner-logout"]')).toBeTruthy();
  });

  it("a Collective member (non-partner path, active chapter) gets the SAME single mount", async () => {
    chapters = [{ id: "ch_ny" }]; // active membership ⇒ Collective mode
    const { container } = renderShell("/collective/notifications");
    expect(await bell()).toBeTruthy();
    expect(screen.getByTestId("brand-product-label").textContent).toContain("Collective");
    /* The Collective-mode chrome is the "Switch to Capavate" button, and it is
       still there beside the new bell. */
    expect(container.querySelector('[data-testid="button-switch-to-capavate"]')).toBeTruthy();
    /* ONE mount, not one per persona: exactly one bell in the tree. */
    expect(container.querySelectorAll('[data-testid="button-notifications"]').length).toBe(1);
  });

  it("the dual-role session (partner WITH an active chapter) also gets it", async () => {
    chapters = [{ id: "ch_ny" }];
    const { container } = renderShell("/collective/partner/dashboard");
    expect(await bell()).toBeTruthy();
    /* Combined mode: partner nav AND Collective nav, one bell. */
    expect(await screen.findByTestId("nav-partner-dashboard", {}, { timeout: 4000 })).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="button-notifications"]').length).toBe(1);
  });

});

describe("W149 · E-T2 — no raw notification kind reaches the DOM (R77)", () => {
  it("every rendered kind is a written label; the machine value stays in data-kind", async () => {
    chapters = [];
    renderShell("/collective/partner/dashboard");
    const container = await openBell();

    const row1 = container.querySelector('[data-testid="notification-ntf_1"]')!;
    /* The raw value is still on the attribute — R77 permits `data-*` explicitly,
       and dropping it would break any consumer keyed on it. */
    expect(row1.getAttribute("data-kind")).toBe("partner.referral_received");
    /* …and what a human READS is the label. */
    expect(row1.textContent).toContain(NOTIFICATION_KIND_LABELS["partner.referral_received"]);
    /* Anti-vacuity: the label is not the empty string and is not the key. */
    expect(NOTIFICATION_KIND_LABELS["partner.referral_received"]).toBe("Referral received");

    /* THE CORE ASSERTION. Not one dotted machine key anywhere in the rendered
       text of the whole shell. This is what fails before the wave. */
    const rendered = container.textContent ?? "";
    for (const n of NOTIFS.items) {
      expect(rendered, `raw kind ${n.kind} must not be rendered`).not.toContain(n.kind);
    }
    /* A generic pattern too, so a NEW raw kind added later is also caught. */
    expect(rendered).not.toMatch(/\b[a-z_]+\.[a-z_.]+\b(?!\/)/);
  });

  it("an unknown kind degrades to a generic human phrase, never the key", async () => {
    chapters = [];
    renderShell("/collective/partner/dashboard");
    const container = await openBell();
    const row3 = container.querySelector('[data-testid="notification-ntf_3"]')!;
    expect(row3.getAttribute("data-kind")).toBe("some.kind.this.build.never.heard.of");
    expect(row3.textContent).toContain(NOTIFICATION_KIND_FALLBACK_LABEL);
    expect(row3.textContent).not.toContain("some.kind");
    /* Not an empty label, not a dash, not "Unknown". */
    expect(NOTIFICATION_KIND_FALLBACK_LABEL.trim().length).toBeGreaterThan(0);
    expect(row3.textContent).not.toContain("—");
  });
});

describe("W149 · E-T3 — the inbox is REACHABLE, and AppShell is undisturbed", () => {
  it("both personas get a nav entry pointing at the in-shell inbox", async () => {
    chapters = [];
    renderShell("/collective/partner/dashboard");
    const partnerNav = await screen.findByTestId("nav-partner-notifications", {}, { timeout: 4000 });
    expect(partnerNav.getAttribute("href")).toBe(COLLECTIVE_NOTIFICATIONS_HREF);
    expect(partnerNav.textContent).toContain("Notifications");

    cleanup();
    chapters = [{ id: "ch_ny" }];
    renderShell("/collective/dashboard");
    const memberNav = await screen.findByTestId("nav-collective-notifications", {}, { timeout: 4000 });
    expect(memberNav.getAttribute("href")).toBe(COLLECTIVE_NOTIFICATIONS_HREF);
  });

  it("the bell's 'View all' points at the in-shell inbox, not at the shell-less /notifications", async () => {
    chapters = [];
    renderShell("/collective/partner/dashboard");
    const container = await openBell();
    const viewAll = container.querySelector<HTMLElement>('[data-testid="button-open-notification-center"]')!;
    expect(viewAll, "the View all item must exist").toBeTruthy();
    fireEvent.pointerDown(viewAll, { button: 0, pointerType: "mouse" });
    fireEvent.click(viewAll);
    await waitFor(() => {
      expect(window.location.pathname).toBe(COLLECTIVE_NOTIFICATIONS_HREF);
    }, { timeout: 4000 });
  });

  it("SOURCE ASSERTION (labelled as such): the AppShell mount and the forced-bare rule are untouched", () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    const appShell = read("client/src/components/AppShell.tsx");
    /* Still exactly one mount in AppShell — the investor/founder/admin personas'
       bell was not moved, duplicated or made conditional. */
    expect((appShell.match(/<NotificationBell/g) ?? []).length).toBe(1);
    /* The route was ADDED; the pre-existing role-agnostic one still exists. */
    const app = read("client/src/App.tsx");
    expect(app).toContain('<Route path="/notifications">');
    expect(app).toContain('<Route path="/collective/notifications">');
    /* And the inbox is exempt from the member gate, so a Consortium Partner is not
       walled off from their own notifications by the Collective join wall. */
    const shell = read("client/src/components/CollectiveShell.tsx");
    expect(shell).toMatch(/isMemberGateExempt[\s\S]*COLLECTIVE_NOTIFICATIONS_HREF/);
  });
});

describe("W149 · E-T4 — the mount is wired, not decorative", () => {
  it("the live unread count from /api/notifications reaches the trigger and the badge", async () => {
    chapters = [];
    const { container } = renderShell("/collective/partner/dashboard");
    const b = await bell();
    /* A decorative bell would carry no count. This one reports the API's own
       unread total, which is the difference between "the component is on the page"
       and "the persona can actually see their notifications". */
    await waitFor(() => {
      expect(b.getAttribute("data-unread-count")).toBe(String(NOTIFS.unread));
    }, { timeout: 4000 });
    expect(container.querySelector('[data-testid="badge-unread-count"]')?.textContent)
      .toBe(String(NOTIFS.unread));
  });

  it("the bodies and titles the server wrote are the ones rendered", async () => {
    chapters = [];
    renderShell("/collective/partner/dashboard");
    const container = await openBell();
    /* The dead promise was that these were written and never shown. Assert the
       actual written content appears, not merely that a row exists. */
    for (const n of NOTIFS.items) {
      expect(container.textContent).toContain(n.title);
    }
    expect(container.querySelector('[data-testid="text-notifications-empty"]')).toBeNull();
  });
});
