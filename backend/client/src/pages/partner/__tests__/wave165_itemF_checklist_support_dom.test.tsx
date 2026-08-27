/**
 * WAVE 165 · ITEM F · R135.6 — "MARK UNSUPPORTED, DO NOT REMOVE."
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The partner onboarding checklist reads as a list of platform features. Some of
 * it is not. "Configure SSO (optional but recommended) — SAML 2.0 / OIDC.
 * Required for orgs >25 seats per security policy" describes an integration that
 * does not exist: a comment-stripped grep of the entire tree for SAML or OIDC
 * returns exactly ONE file, and it is the checklist itself. A partner who ticks
 * that box has recorded that they configured something unbuildable; a partner who
 * goes looking for the setting finds nothing. The two KYC rows say "Upload …"
 * while this screen has no upload control — the tick is a self-declaration about
 * a document handled off-platform.
 *
 * R135.6 forbids deleting the rows. So this file asserts BOTH halves of the
 * ruling, and the first half is the one a careless implementation breaks:
 *
 *   §1 — every row is STILL THERE and still tickable.
 *   §2 — the unsupported/manual rows now say what ticking them means.
 *   §3 — the SUPPORTED rows gained nothing, so the marker means something.
 *
 * §3 is what stops this being decoration. If every row carried a caveat, the
 * caveat would carry no information and a partner would learn to skip it.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import PartnerOnboardingChecklistPage from "../OnboardingChecklistPage";
/* The page shell reads the role context. Mounting bare threw "RoleProvider
   missing", so the real provider is used rather than mocked — a mocked provider
   could diverge from the one the app actually wraps this page in. */
import { RoleProvider } from "@/lib/role";

/** Rows whose tick does NOT correspond to a platform capability. */
const MUST_BE_MARKED = ["sso_configured", "kyc_org_doc", "kyc_signatory_doc", "go_live_review"];
/** Rows backed by a real route or a real durable record. */
const MUST_NOT_BE_MARKED = [
  "team_invites",
  "first_pipeline_deal",
  "first_client_org",
  "billing_contact",
  "data_retention_acked",
  "signed_partner_agreement",
];

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w165",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w165", email: "gp@example.com", name: "W165 GP" },
    },
  }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, {}],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

beforeEach(() => {
  /* Nothing ticked, so no row is struck through and every label is readable. */
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

async function mountPage(): Promise<void> {
  render(
    <RoleProvider>
      <PartnerOnboardingChecklistPage />
    </RoleProvider>,
  );
  await screen.findByTestId(`item-${MUST_BE_MARKED[0]}`);
}

describe("W165 §1 — R135.6: nothing was removed", () => {
  it("T165F.C1: every checklist row still renders", async () => {
    await mountPage();
    for (const key of [...MUST_BE_MARKED, ...MUST_NOT_BE_MARKED]) {
      expect(screen.queryByTestId(`item-${key}`), `row ${key} was dropped`).not.toBeNull();
    }
  });

  it("T165F.C2: the unsupported rows are still TICKABLE, not disabled away", async () => {
    await mountPage();
    /* Every toggle is `disabled={loading || saving}` while the state request is
       in flight, so the enabled state is asserted AFTER the load settles. A
       synchronous read here would have measured the loading spinner, not the
       control. */
    for (const key of MUST_BE_MARKED) {
      if (key === "signed_partner_agreement") continue;
      await waitFor(() => {
        const btn = screen.queryByTestId(`toggle-${key}`) as HTMLButtonElement | null;
        expect(btn, `row ${key} lost its toggle`).not.toBeNull();
        expect(btn!.disabled, `disabling ${key} is a silent removal`).toBe(false);
      });
    }
  });
});

describe("W165 §2 — the unsupported and manual rows say so", () => {
  it("T165F.C3: SSO is named as NOT SUPPORTED, not merely optional", async () => {
    await mountPage();
    const t = ((await screen.findByTestId("support-sso_configured")).textContent ?? "").toLowerCase();
    expect(t).toContain("not currently supported");
    expect(t, "and the row must say the tick cannot be earned on the platform").toContain(
      "cannot be completed",
    );
  });

  it("T165F.C4: both KYC rows are named as MANUAL, since there is no upload here", async () => {
    await mountPage();
    for (const key of ["kyc_org_doc", "kyc_signatory_doc"]) {
      const t = ((await screen.findByTestId(`support-${key}`)).textContent ?? "").toLowerCase();
      expect(t, `${key} still reads as an upload feature`).toContain("manual step");
      expect(t).toContain("no upload control");
    }
  });

  it("T165F.C5: every unsupported row carries a non-empty marker", async () => {
    await mountPage();
    for (const key of MUST_BE_MARKED) {
      const t = (await screen.findByTestId(`support-${key}`)).textContent ?? "";
      expect(t.trim().length, `row ${key} is unmarked`).toBeGreaterThan(0);
    }
  });
});

describe("W165 §3 — the marker is informative because it is not everywhere", () => {
  it("T165F.C6: rows backed by real capability carry NO caveat", async () => {
    await mountPage();
    for (const key of MUST_NOT_BE_MARKED) {
      const el = screen.queryByTestId(`support-${key}`);
      expect(el, `the marker element should exist for shape stability on ${key}`).not.toBeNull();
      expect(
        (el!.textContent ?? "").trim(),
        `${key} is supported; a caveat here would teach partners to ignore all of them`,
      ).toBe("");
    }
  });

  it("T165F.C7: the original labels and descriptions were not rewritten", async () => {
    await mountPage();
    const sso = (await screen.findByTestId("item-sso_configured")).textContent ?? "";
    /* R135.6 marks; it does not edit. Both original strings must survive intact
       beside the new marker. */
    expect(sso).toContain("Configure SSO (optional but recommended)");
    expect(sso).toContain("SAML 2.0 / OIDC. Required for orgs >25 seats per security policy.");
  });
});
