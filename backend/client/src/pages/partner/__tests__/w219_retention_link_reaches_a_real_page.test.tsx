/**
 * WAVE 219 · ITEM 3 — THE RETENTION ACKNOWLEDGEMENT'S LINK REACHES A PAGE THAT
 * ACTUALLY RENDERS.
 *
 * ── A CORRECTION TO THE SPEC, ESTABLISHED BEFORE ANY CODE WAS WRITTEN ─────────
 * `build_log/legal/LEGAL_TECH_BUILD_DOC.md` (wave 219 item table) and
 * `spec/OWNER_RULINGS_2026_08_13.md:9652` both say the retention item links to
 * `/settings/privacy` "which does not exist". Both are WRONG. The route is registered
 * at `client/src/App.tsx:1546` and renders `client/src/pages/settings/PrivacyPage.tsx`.
 *
 * The real defect was narrower and of a different kind: the path lived only inside the
 * item's `description` STRING — "GDPR / PIPEDA retention windows for client + investor
 * data. See /settings/privacy." — and was painted as plain text. A partner reading a
 * legal acknowledgement was shown a path to retype by hand. Not a broken link; not a
 * link at all.
 *
 * ── WHY THE PROOF IS SHAPED THIS WAY ─────────────────────────────────────────
 * The build document is explicit: "Follow the retention link in a rendered test and
 * assert the target page renders. Not an `href` string assertion." An `href` assertion
 * is precisely the inert proof that would have passed against the ORIGINAL defect had
 * the path been fabricated, because a string is a string whether or not anything
 * answers it.
 *
 * So this file does three separate things, and the third is the one that matters:
 *   §1 the anchor really is an anchor in the rendered DOM, and the plain-text
 *      description is still there byte-for-byte (nothing was replaced — R143.1);
 *   §2 its `href` is the path the app registers;
 *   §3 THE TARGET PAGE IS MOUNTED AND RENDERS. Not "the route exists in a config" —
 *      the real `PrivacyPage` component is rendered and produces real content.
 *
 * §3 is deliberately a mount of the real component rather than a routing simulation.
 * A wouter navigation in jsdom would prove the router's behaviour, which is not in
 * doubt; what was in doubt — and what the spec's own premise got wrong — is whether
 * anything is at the other end.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import PartnerOnboardingChecklistPage from "../OnboardingChecklistPage";
import PrivacyPage from "@/pages/settings/PrivacyPage";
/* The real provider, not a mock: a mocked provider could diverge from the one the app
   actually wraps these pages in. Same choice wave 165 made for this page. */
import { RoleProvider } from "@/lib/role";

/** The path the app registers at `client/src/App.tsx:1546`. */
const REGISTERED_PRIVACY_PATH = "/settings/privacy";

/** The description literal, quoted here so a test failure names what changed. It must
 *  remain byte-identical: the fix APPENDS a sibling and replaces nothing. */
const RETENTION_DESCRIPTION =
  "GDPR / PIPEDA retention windows for client + investor data. See /settings/privacy.";

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w219",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w219", email: "gp@example.com", name: "W219 GP" },
    },
  }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, {}],
  useLocation: () => [REGISTERED_PRIVACY_PATH, () => {}],
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

describe("W219 · Item 3 — the retention link", () => {
  it("L-0 ANTI-VACUITY — the retention row is really on screen before anything about its link is asserted", async () => {
    await mountChecklist();
    const row = screen.getByTestId("item-data_retention_acked");
    expect(row).not.toBeNull();
    /* And the plain-text description is UNCHANGED. R195.5 / R143.1: the fix appends,
       it does not rewrite, so the sentence a partner reads today is still the sentence
       they read before this wave — including the bare path, which stays as a
       copy-and-paste fallback for anyone who prints the page. */
    expect(row.textContent).toContain(RETENTION_DESCRIPTION);
  });

  it("L-1 IT IS A REAL ANCHOR IN THE DOM, not a sentence containing a path", async () => {
    await mountChecklist();
    const link = screen.getByTestId("link-data-retention-privacy");
    /* `tagName`, not a testid alone: a `<span data-testid="link-…">` would satisfy a
       testid query while being unclickable, which is the defect restated. */
    expect(link.tagName).toBe("A");
    expect(link.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("L-2 it points at the path the app registers", async () => {
    await mountChecklist();
    const link = screen.getByTestId("link-data-retention-privacy");
    expect(link.getAttribute("href")).toBe(REGISTERED_PRIVACY_PATH);
  });

  it("L-3 THE TARGET PAGE RENDERS — the assertion an href check cannot make", () => {
    /* The whole point. Mounting the REAL PrivacyPage (handbook §8 — no replica) and
       requiring real content proves something is at the other end of that href. Had
       the spec's premise been right — the page not existing — this case would fail at
       the import, which is the correct way to find that out. */
    render(
      <RoleProvider>
        <PrivacyPage />
      </RoleProvider>,
    );
    /* Controls the page really owns, read from the component rather than invented:
       the export and delete-request controls. A text assertion could pass on an error
       boundary's message; these cannot. */
    expect(screen.queryByTestId("button-export"), "PrivacyPage did not render").not.toBeNull();
    expect(screen.queryByTestId("button-request-delete")).not.toBeNull();
  });

  it("L-4 the link is there whether or not the box is already ticked", async () => {
    /* R190.10 — a partner who has already acknowledged the policy must still be able
       to reach it. Gating the link on `!done`, as the neighbouring agreement link is
       gated, would take a route away from someone who had it. Proved by ticking the
       box in the fetched state and re-mounting. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          String(url).includes("agreement")
            ? { signed: false, signedCurrent: false }
            : { state: { data_retention_acked: true } },
      })),
    );
    await mountChecklist();
    const link = screen.getByTestId("link-data-retention-privacy");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(REGISTERED_PRIVACY_PATH);
  });

  it("L-5 NOTHING ELSE GAINED A PRIVACY LINK — so the link means something", async () => {
    /* If every row carried it, it would carry no information. Exactly one anchor with
       this testid exists on the page. */
    await mountChecklist();
    expect(screen.queryAllByTestId("link-data-retention-privacy").length).toBe(1);
  });
});
