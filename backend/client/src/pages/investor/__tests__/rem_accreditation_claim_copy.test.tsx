/**
 * ══════════════════════════════════════════════════════════════════════════════
 * REMAINING · ITEM 1 — the platform must not state a verification standard it
 * does not perform.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG. `client/src/lib/profile/data/enums.ts` mapped EVERY investor
 * whose country of tax residency is the United States to the KYC-variant value
 * `us_reg_d_506c`, and that value's label was the sentence
 *
 *     "US — Reg D 506(c) third-party verification"
 *
 * which the investor profile page renders inside the `badge-kyc-variant` chip.
 * There is no third-party verification integration anywhere in this tree — the
 * platform's own prohibition fence states the finding in its own words — and
 * 506(c) has not been adopted at launch. So the badge asserted a standard the
 * platform does not perform, automatically, for every US investor.
 *
 * WHY THIS FILE MOUNTS THE REAL PAGE. R137.1: a claim is only proved when the
 * MOUNTED component is read. A unit test on the label table would pass happily
 * while the JSX rendered something else — the "replica instead of the real
 * thing" inert-proof mechanism. So this mounts `client/src/pages/investor/Profile`,
 * the default export the investor router renders, and reads the DOM.
 *
 * AND IT DRIVES THE REAL DERIVATION. The profile is seeded with
 * `countryOfTaxResidencyCode: "US"` and a DELIBERATELY WRONG stored
 * `kycVariant`. `Profile.tsx` recomputes the variant from the country on mount,
 * so what the badge shows is produced by the shipped `kycVariantForCountry`
 * mapping — the exact line that was changed — and not by the fixture.
 *
 * WHAT IS PROVED
 *   R1-A  a positive anchor: the badge exists and is not empty (so every
 *         absence assertion below has something to be absent from)
 *   R1-B  the badge renders the corrected regime label
 *   R1-C  the badge makes no verification claim and names no 506(c) standard
 *   R1-D  a profile still carrying the RETAINED LEGACY value renders honestly
 *         too, because old rows were not migrated and must not be left claiming
 *   R1-E  a negative control: the detector used above can see the old sentence
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

const INVESTOR_ID = "u_rem_item1_investor";
vi.mock("@/lib/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/entitlement")>();
  return {
    ...actual,
    useEntitlement: () => ({ data: { userId: INVESTOR_ID }, isLoading: false }),
  };
});

import Profile from "../Profile";
import { SEED_INVESTOR_PROFILE } from "@/lib/profile/seed";
import type { InvestorProfile } from "@/lib/profile/types";
import { KYC_VARIANT_OPTIONS, kycVariantForCountry } from "@/lib/profile/data/enums";
import { ACCREDITATION_JURISDICTION_CODES } from "@shared/accreditationClause";

/** The exact sentence that was rendered before the correction. Kept here as the
 *  thing the assertions must NOT find, and as the negative control's input. */
const SUPERSEDED_CLAIM = "US — Reg D 506(c) third-party verification";

function mountProfile(opts: { countryCode: string; storedVariant: string }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  const profile: InvestorProfile = {
    ...SEED_INVESTOR_PROFILE,
    id: INVESTOR_ID,
    profile: {
      ...SEED_INVESTOR_PROFILE.profile,
      countryOfTaxResidencyCode: opts.countryCode,
      /* Deliberately not the answer. If the page ever stopped deriving the
         variant from the country, this fixture value would surface and the
         assertions below would fail rather than quietly pass. */
      kycVariant: opts.storedVariant as InvestorProfile["profile"]["kycVariant"],
    },
  };
  qc.setQueryData(["/api/investors", INVESTOR_ID, "profile"], profile);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </RoleProvider>
  );
  return render(<Profile />, { wrapper });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("REMAINING Item 1 — the KYC badge states only what the platform does", () => {
  it("R1-A/B/C — a US investor's badge shows the regime, not a verification standard", () => {
    const { container } = mountProfile({ countryCode: "US", storedVariant: "generic" });

    /* R1-A — the positive anchor FIRST. An absence assertion against a page that
       failed to render its badge is vacuous, which is exactly the trap this
       programme keeps finding in its own evidence. */
    const badge = screen.getByTestId("badge-kyc-variant");
    expect(badge).toBeTruthy();
    const badgeText = (badge.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(badgeText.length, "badge rendered empty").toBeGreaterThan(0);

    /* And prove the DERIVATION ran, rather than the fixture leaking through:
       the fixture said "generic" and the country says US. */
    expect(badgeText).not.toContain("generic");
    expect(kycVariantForCountry("US")).toBe("us_reg_d");

    /* R1-B — the rendered words. */
    expect(badgeText).toBe("KYC: United States — Regulation D, Rule 501(a)");

    /* R1-C — the claim is gone, from the badge and from the whole page. */
    const pageText = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(badgeText).not.toMatch(/verif/i);
    expect(badgeText).not.toMatch(/506\s*\(?c\)?/i);
    expect(pageText).not.toContain(SUPERSEDED_CLAIM);
    expect(pageText).not.toMatch(/third-party verification/i);
  });

  it("R1-D — a profile still holding the legacy 506(c) value renders honestly too", () => {
    /* Nothing migrated the already-stored rows, and migrating them would be a
       destructive rewrite of a live column. The legacy value therefore has to
       render an honest label on its own. Driven through a country the map does
       not know, so the page keeps the stored value instead of re-deriving it. */
    const { container } = mountProfile({ countryCode: "BR", storedVariant: "us_reg_d_506c" });
    const badgeText = (screen.getByTestId("badge-kyc-variant").textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    expect(badgeText.length).toBeGreaterThan(0);
    expect(badgeText).not.toMatch(/verif/i);
    expect(badgeText).not.toMatch(/506\s*\(?c\)?/i);
    expect((container.textContent ?? "")).not.toContain(SUPERSEDED_CLAIM);
  });

  it("R1-E — negative control: the assertions above can see the sentence they forbid", () => {
    /* If these three fail, every absence assertion in this file is inert. */
    expect(SUPERSEDED_CLAIM).toMatch(/verif/i);
    expect(SUPERSEDED_CLAIM).toMatch(/506\s*\(?c\)?/i);
    expect(SUPERSEDED_CLAIM).toContain("third-party verification");

    /* And the shipped table is the one under test, counted exactly so the sweep
       cannot pass over an empty or truncated list. */
    expect(KYC_VARIANT_OPTIONS.length).toBe(12);
    expect(KYC_VARIANT_OPTIONS.some((o) => o.value === "us_reg_d")).toBe(true);
    expect(KYC_VARIANT_OPTIONS.some((o) => o.value === "us_reg_d_506c")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §4 — INTERNATIONAL. THE PLATFORM SERVES NINE JURISDICTIONS, NOT ONE.
   ═══════════════════════════════════════════════════════════════════════════════
   Item 1 was briefed as a US over-claim. It is also an international defect: an
   absent country of tax residency was being rendered as a jurisdiction
   CONCLUSION ("Other — generic KYC + AML"). These mount the real investor
   Profile for a NON-US investor, for an investor outside the nine, and for an
   investor with nothing on record. */

describe("Item 1 · international — the badge never invents a jurisdiction", () => {
  it("an investor with NO country on record is told exactly that", () => {
    const { container } = mountProfile({ countryCode: "", storedVariant: "generic" });
    const t = container.querySelector('[data-testid="badge-kyc-variant"]')?.textContent ?? "";
    expect(t.length, "the badge must render").toBeGreaterThan(0);
    expect(t).toContain("Country of tax residency not on record");
    expect(t).toContain("no jurisdiction-specific regime applied");
    /* The two things it must NOT do: name a regime, or claim a process. */
    expect(t).not.toMatch(/generic KYC/i);
    expect(t).not.toMatch(/\bOther\b/);
    expect(t).not.toMatch(/Regulation D|506/i);
  });

  it("an investor OUTSIDE the nine is told the country is outside them, not called 'Other'", () => {
    const { container } = mountProfile({ countryCode: "BR", storedVariant: "generic" });
    const t = container.querySelector('[data-testid="badge-kyc-variant"]')?.textContent ?? "";
    expect(t).toContain("BR");
    expect(t).toContain("outside the jurisdictions this platform offers a declaration for");
    expect(t).not.toMatch(/generic KYC/i);
  });

  it.each([
    ["SG", /Singapore/],
    ["JP", /Japan/],
    ["AU", /Australia/],
    ["HK", /Hong Kong/],
    ["CA", /Canada/],
    ["GB", /UK|United Kingdom/],
  ])("a %s investor is labelled under their OWN jurisdiction and never a US exemption", (code, expected) => {
    const { container } = mountProfile({ countryCode: code, storedVariant: "us_reg_d_506c" });
    const t = container.querySelector('[data-testid="badge-kyc-variant"]')?.textContent ?? "";
    expect(t.length).toBeGreaterThan(0);
    expect(t).toMatch(expected);
    /* THE CLAIM IN THE OWNER'S REMINDER, TESTED DIRECTLY: no non-US investor may
       ever carry a US securities exemption or a verification claim. */
    expect(t, `${code} investor was labelled under a US exemption`).not.toMatch(/Regulation D|Reg D|506/i);
    expect(t).not.toMatch(/verif/i);
  });

  it("NO country in the map resolves to a US regime except the US itself", () => {
    /* Asserted over the mapping directly, so a future country added to the map
       cannot quietly inherit the US entry. */
    const offenders: string[] = [];
    for (const c of ["GB","CA","SG","HK","IN","CN","JP","AU","DE","FR","IT","ES","NL","BE","AT","IE","PT","SE","DK","FI","PL","LU","BR","ZA",""]) {
      if (String(kycVariantForCountry(c)).startsWith("us_")) offenders.push(c || "(empty)");
    }
    expect(offenders, "these non-US countries map to a US regime").toEqual([]);
    expect(kycVariantForCountry("US")).toBe("us_reg_d");
  });

  it("the supported set is the NINE the engine declares — not a list written here", () => {
    expect([...ACCREDITATION_JURISDICTION_CODES].sort()).toEqual(
      ["AU","CA","EU","HK","IN","JP","SG","UK","US"],
    );
  });
});
