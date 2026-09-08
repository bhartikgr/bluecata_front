/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA BLOCKER 5 — the accreditation badge named a field it was not reading.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * NOT A CONTRADICTION. Two different columns, both correct:
 *   · `accreditedStatus`       — what the INVESTOR DECLARED, in the dropdown.
 *   · `accreditationVerified`  — a separate boolean flag.
 * The badge read the FLAG and printed the words of the DECLARATION, so an
 * investor who had just chosen "Yes — Accredited" was told, eighteen inches
 * away, "Accredited status not recorded". The sentence was false about the field
 * it named. The WORDING was the whole defect.
 *
 * WHAT THIS FILE PROVES, from the MOUNTED page and RENDERED TEXT:
 *   1  CONTROL — the harness can distinguish the two badge states at all.
 *   2  DECLARED + flag false (the near-universal production state) — the badge
 *      no longer says "not recorded", it says what was declared and attributes
 *      the claim to the investor.
 *   3  IT MAKES NO NEW CLAIM — the disclaimer is the RATIFIED REGISTER already
 *      in `shared/accreditationClause.ts` ("Capavate records it; Capavate does
 *      not confirm it"), asserted here against that shared constant so the copy
 *      cannot drift away from the ratified wording.
 *   4  IT DOES NOT CROSS THE LINE — the green `badge-accred-verified` branch is
 *      NOT rendered from a declaration, and the badge contains no form of the
 *      word "verif…" (which `w227_profile_verified_copy.test.tsx` forbids).
 *   5  NOTHING DECLARED — the original sentence is retained verbatim, because at
 *      that point it is true.
 *   6  THE LABEL COMES FROM THE DROPDOWN'S OWN LIST, so the badge cannot put a
 *      word in the investor's mouth that the dropdown never offered.
 *
 * A PRE-EXISTING FAILURE THAT IS NOT MINE AND IS NOT FIXED HERE:
 * `w227_profile_verified_copy.test.tsx` A-1 and A-4 fail on the UNTOUCHED tree.
 * MEASURED, not assumed — the file was run with the QA-B5 change reverted and
 * failed identically. The offender is copy a LATER wave added in
 * `client/src/components/AccreditationForm.tsx:64` ("Capavate does not verify
 * this investor's identity, wealth, status…"), which W227's affirmative-word
 * detector catches. Two waves' contracts collide. That is reported, not
 * silently repaired: it is outside these nine items and the second accreditation
 * message is on the explicit DO-NOT-BUILD list.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

const INVESTOR_ID = "u_qab_b5_investor";
vi.mock("@/lib/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/entitlement")>();
  return { ...actual, useEntitlement: () => ({ data: { userId: INVESTOR_ID }, isLoading: false }) };
});

import Profile from "../Profile";
import { SEED_INVESTOR_PROFILE } from "@/lib/profile/seed";
import type { InvestorProfile } from "@/lib/profile/types";
import { ACCREDITED_STATUS_OPTIONS } from "@/lib/profile/data/enums";
import { ACCREDITATION_CLAUSE_TEXT } from "@shared/accreditationClause";

function mountProfile(opts: { accreditationVerified: boolean; accreditedStatus: string | null }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } } });
  const profile: InvestorProfile = {
    ...SEED_INVESTOR_PROFILE,
    id: INVESTOR_ID,
    profile: {
      ...SEED_INVESTOR_PROFILE.profile,
      accreditationVerified: opts.accreditationVerified,
      accreditationVerifiedAt: opts.accreditationVerified ? "2026-04-01T00:00:00Z" : null,
      accreditedStatus: opts.accreditedStatus as never,
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

const badgeText = () => (screen.getByTestId("badge-accred-pending").textContent ?? "").replace(/\s+/g, " ").trim();

afterEach(() => cleanup());

describe("QA-B5 · the accreditation badge names the field it actually reads", () => {
  it("1 · CONTROL — the two badge states are distinguishable, and one is not the other", () => {
    mountProfile({ accreditationVerified: false, accreditedStatus: null });
    const nothingDeclared = badgeText();
    cleanup();
    mountProfile({ accreditationVerified: false, accreditedStatus: "accredited" });
    const declared = badgeText();
    /* If these were equal, every assertion below could pass on a page that never
       changed. They must differ. */
    expect(declared).not.toBe(nothingDeclared);
    expect(nothingDeclared.length).toBeGreaterThan(0);
    expect(declared.length).toBeGreaterThan(0);
  });

  it("2 · DECLARED + flag false — the badge stops saying the declaration was not recorded", () => {
    mountProfile({ accreditationVerified: false, accreditedStatus: "accredited" });
    const text = badgeText();
    /* THE FALSE SENTENCE IS GONE from the badge for this state. */
    expect(text).not.toContain("Accredited status not recorded");
    /* And it attributes the claim to the investor, using the dropdown's own label. */
    expect(text).toContain("Self-declared");
    expect(text).toContain("Yes — Accredited");
  });

  it("3 · the disclaimer is the RATIFIED register, not new legal-sounding copy", () => {
    mountProfile({ accreditationVerified: false, accreditedStatus: "accredited" });
    const text = badgeText();
    expect(text).toContain("Capavate records it; Capavate does not confirm it");
    /* Asserted against the SHARED ratified clause, so if that clause is ever
       reworded this badge is caught rather than quietly drifting from it. */
    expect(ACCREDITATION_CLAUSE_TEXT).toContain("Capavate records it");
    expect(ACCREDITATION_CLAUSE_TEXT).toContain("does not confirm it");
  });

  it("4 · it does NOT attest, and uses no form of the word 'verif…'", () => {
    mountProfile({ accreditationVerified: false, accreditedStatus: "accredited" });
    /* The green attestation branch must NOT be reachable from a declaration. */
    expect(screen.queryByTestId("badge-accred-verified")).toBeNull();
    expect(badgeText()).not.toMatch(/verif/i);
    /* Nor does it print the raw stored code to a human. */
    expect(badgeText()).not.toContain("non_accredited");
    expect(badgeText()).not.toMatch(/\baccredited\b(?![\s—-])/);
  });

  it("5 · NOTHING DECLARED — the original sentence is retained, because it is true then", () => {
    mountProfile({ accreditationVerified: false, accreditedStatus: null });
    expect(badgeText()).toBe("Accredited status not recorded");
  });

  it("6 · every declarable option renders its OWN dropdown label, and none renders a raw code", () => {
    /* COUNT THE CONSUMERS: three options are declarable, so three states are
       checked — not a sample. */
    expect(ACCREDITED_STATUS_OPTIONS.length).toBe(3);
    for (const opt of ACCREDITED_STATUS_OPTIONS) {
      mountProfile({ accreditationVerified: false, accreditedStatus: opt.value });
      const text = badgeText();
      expect(text, `badge for ${opt.value}`).toContain(opt.label);
      expect(text, `badge for ${opt.value}`).not.toContain(opt.value);
      cleanup();
    }
  });

  it("7 · the flag being TRUE still renders the untouched attestation branch", () => {
    mountProfile({ accreditationVerified: true, accreditedStatus: "accredited" });
    expect(screen.getByTestId("badge-accred-verified").textContent?.trim()).toBe("Accredited status recorded");
    expect(screen.queryByTestId("badge-accred-pending")).toBeNull();
  });
});
