/**
 * WAVE A · ITEM 3b — THE ONBOARDING RETENTION LINK MUST NOT THROW A CONSORTIUM
 * PARTNER OUT OF THEIR OWN SECTION.
 *
 * ── THE DOCUMENT'S CLAIM, RE-MEASURED ───────────────────────────────────────
 * The walkthrough document reports "an onboarding link navigates to a completely
 * different section". Re-measured in this tree before anything was built:
 *   · The onboarding checklist page renders EXACTLY TWO anchors.
 *   · Anchor #1, `link-sign-agreement` -> `/collective/partner/agreement`, IS
 *     registered inside CollectiveShell. It is correct and was not touched.
 *   · Anchor #2, `link-data-retention-privacy`, pointed at `/settings/privacy`,
 *     which IS registered and DOES render — but WITHOUT CollectiveShell. Since
 *     it is a plain `<a href>` and not a wouter <Link>, following it was a full
 *     page load into a page with different chrome.
 * So the link was never dead; it left the section. Only anchor #2 can produce the
 * reported symptom, which settles by measurement which of the two was meant.
 *
 * ── WHY THE PROOF IS SHAPED THIS WAY ────────────────────────────────────────
 * An href string assertion proves nothing about where a user lands — a string is
 * a string whether or not anything answers it, and it certainly says nothing
 * about which shell wraps the answer. This file therefore reads the REAL router
 * source and asserts the RESOLVED registration for the href the anchor actually
 * carries: that the path is registered, what component it renders, and what shell
 * wraps it. Then it mounts the real target component to prove something is at the
 * other end.
 *
 * The control is R-4: the OLD destination must still be registered and must still
 * be registered WITHOUT the shell. Two things that never move always agree, so
 * this file shows the DISAGREEMENT between the two doors before claiming the new
 * one is right.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import PartnerOnboardingChecklistPage from "../OnboardingChecklistPage";
import PrivacyPage from "@/pages/settings/PrivacyPage";
import { RoleProvider } from "@/lib/role";

const APP_SOURCE = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

/** The destination that leaves the partner's shell. Kept, never closed (R195.5). */
const BARE_PRIVACY_PATH = "/settings/privacy";
/** The in-shell second door onto the same component. */
const IN_SHELL_PRIVACY_PATH = "/collective/partner/privacy";

/** Returns the JSX text registered for a route path in the real router source. */
function routeRegistrationFor(path: string): string | null {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<Route path="${escaped}">([\\s\\S]*?)</Route>`);
  const m = APP_SOURCE.match(re);
  return m ? m[1] : null;
}

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_wa3b",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_wa3b", email: "gp@example.com", name: "WA3B GP" },
    },
  }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, {}],
  useLocation: () => ["/collective/partner/onboarding", () => {}],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("agreement") ? { signed: false, signedCurrent: false } : { state: {} },
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountChecklist(): Promise<void> {
  render(
    <RoleProvider>
      <PartnerOnboardingChecklistPage />
    </RoleProvider>,
  );
  await screen.findByTestId("item-data_retention_acked");
}

describe("WAVE A item 3b — the retention link resolves inside the partner section", () => {
  it("R-0 PRECONDITIONS — the real router source was read and the real row is on screen", async () => {
    // An empty file or an empty page fails here, before any routing claim is made.
    expect(APP_SOURCE.length).toBeGreaterThan(50_000);
    expect(APP_SOURCE).toContain("<Switch>");
    await mountChecklist();
    const row = screen.getByTestId("item-data_retention_acked");
    expect(row.textContent).toContain(
      "GDPR / PIPEDA retention windows for client + investor data. See /settings/privacy.",
    );
    expect(screen.queryAllByTestId("link-data-retention-privacy").length).toBe(1);
    expect(screen.queryAllByTestId("link-sign-agreement").length).toBe(1);
  });

  it("R-1 THE RESOLVED ROUTE for the href the anchor carries is registered INSIDE CollectiveShell", async () => {
    await mountChecklist();
    const href = screen.getByTestId("link-data-retention-privacy").getAttribute("href")!;
    const block = routeRegistrationFor(href);
    expect(block, `no <Route path="${href}"> in the real router`).not.toBeNull();
    expect(block!).toContain("CollectiveShell");
    expect(block!).toContain("<PrivacyPage />");
    expect(block!).toContain("RequireAuth");
  });

  it("R-2 the OTHER anchor on this page was already in-section and is unchanged", async () => {
    await mountChecklist();
    const href = screen.getByTestId("link-sign-agreement").getAttribute("href");
    expect(href).toBe("/collective/partner/agreement");
    const block = routeRegistrationFor("/collective/partner/agreement");
    expect(block).not.toBeNull();
    expect(block!).toContain("CollectiveShell");
  });

  it("R-3 exactly two anchors exist on this page, so 'the onboarding link' has only two candidates", async () => {
    const { container } = render(
      <RoleProvider>
        <PartnerOnboardingChecklistPage />
      </RoleProvider>,
    );
    await screen.findByTestId("item-data_retention_acked");
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.length).toBe(2);
    expect(anchors.map((a) => a.getAttribute("data-testid")).sort()).toEqual([
      "link-data-retention-privacy",
      "link-sign-agreement",
    ]);
  });

  it("R-4 CONTROL — the old bare route is still registered and still has NO shell", () => {
    // The disagreement. If both doors looked the same this file would prove nothing.
    const bare = routeRegistrationFor(BARE_PRIVACY_PATH);
    expect(bare, "the previous destination was closed — nothing may be deleted").not.toBeNull();
    expect(bare!).toContain("<PrivacyPage />");
    expect(bare!).not.toContain("CollectiveShell");

    const inShell = routeRegistrationFor(IN_SHELL_PRIVACY_PATH);
    expect(inShell).not.toBeNull();
    expect(inShell!).toContain("CollectiveShell");
    // Same component, two doors — no duplicated page, no second source of truth.
    expect(bare!).toContain("<PrivacyPage />");
    expect(inShell!).toContain("<PrivacyPage />");
  });

  it("R-5 something really is at the other end — the target component renders", () => {
    render(
      <RoleProvider>
        <PrivacyPage />
      </RoleProvider>,
    );
    expect(screen.queryByTestId("button-export"), "PrivacyPage did not render").not.toBeNull();
    expect(screen.queryByTestId("button-request-delete")).not.toBeNull();
  });
});
