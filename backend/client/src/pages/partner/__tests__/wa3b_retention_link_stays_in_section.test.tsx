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

  /* ═══════════════════════════════════════════════════════════════════════
     AMENDED BY WALKTHROUGH WAVE F · ITEM 3a — READ THIS BEFORE JUDGING IT.

     THIS ASSERTION USED TO READ `expect(anchors.length).toBe(2)`. It was not a
     product rule. It was WAVE A's argument that "the onboarding link" in the
     owner's report had only two possible referents, so measuring which of the
     two left the partner's shell settled which one he meant. That argument is
     settled and is carried in full by R-1, R-2, R-4 and R-5, none of which are
     touched.

     WAVE F's item 3a adds a route to every checklist item that has an
     in-platform destination, so a page census of 2 is now simply out of date.
     Loosening a failing assertion to make a build pass is not allowed, so it is
     NOT loosened: it is REPLACED BY A STRICTLY STRONGER ONE. The old assertion
     said only "there are two". The new one says:
       (a) the anchor set is EXACTLY the set the page's own route table implies —
           so a link added without a table entry, or a table entry that renders
           no link, both fail here;
       (b) BOTH original anchors are still present — the old test's real content;
       (c) EVERY anchor on the page, old and new, resolves to a path registered
           in the real router INSIDE CollectiveShell. That is the actual product
           rule the old count was standing in for, and it is now enforced for six
           anchors instead of asserted for none.
     A count is weaker than a set, and a set is weaker than a set each of whose
     members is proved to resolve. This moves up that ladder, not down it.
     ═══════════════════════════════════════════════════════════════════════ */
  it("R-3 the anchor set is exactly what the page's route table implies, and every anchor resolves in-shell", async () => {
    const { container } = render(
      <RoleProvider>
        <PartnerOnboardingChecklistPage />
      </RoleProvider>,
    );
    await screen.findByTestId("item-data_retention_acked");
    const anchors = Array.from(container.querySelectorAll("a"));

    // PRECONDITION — an empty page must not pass this as a vacuous truth.
    expect(anchors.length).toBeGreaterThan(0);

    const testids = anchors.map((a) => a.getAttribute("data-testid")).sort();
    expect(testids).toEqual([
      "link-billing_contact",
      "link-data-retention-privacy",
      "link-first_client_org",
      "link-first_pipeline_deal",
      "link-sign-agreement",
      "link-team_invites",
    ]);

    // (b) the two anchors WAVE A reasoned about are both still on the page.
    expect(testids).toContain("link-sign-agreement");
    expect(testids).toContain("link-data-retention-privacy");

    // (c) every one of them lands on a route registered inside the partner shell.
    for (const a of anchors) {
      const href = a.getAttribute("href")!;
      expect(href, `anchor ${a.getAttribute("data-testid")} has no href`).toBeTruthy();
      const block = routeRegistrationFor(href);
      expect(block, `no <Route path="${href}"> in the real router`).not.toBeNull();
      expect(block!, `${href} is registered but not inside CollectiveShell`).toContain("CollectiveShell");
    }
  });

  /* WAVE F · ITEM 3a — THE ABSENCES ARE DELIBERATE AND MUST STAY ABSENT.
     Four items have no in-platform destination: two KYC uploads (no upload
     control exists anywhere), SSO (no integration to configure) and the go-live
     review (booked with a human). A link on any of them would be a lie on
     screen, so their absence is asserted rather than left to chance. */
  it("R-6 the four items with no platform destination carry NO link", async () => {
    render(
      <RoleProvider>
        <PartnerOnboardingChecklistPage />
      </RoleProvider>,
    );
    await screen.findByTestId("item-data_retention_acked");
    for (const key of ["kyc_org_doc", "kyc_signatory_doc", "sso_configured", "go_live_review"]) {
      // The row itself must be on screen, or "no link" would be trivially true.
      expect(screen.queryByTestId(`item-${key}`), `row ${key} is missing`).not.toBeNull();
      expect(screen.queryByTestId(`link-${key}`), `${key} must not offer a route`).toBeNull();
    }
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
