/* ════════════════════════════════════════════════════════════════════════════
   WAVE 146 — THE PLACEHOLDER MUST NOT LIE TO A GRANT-ONLY VIEWER.
   ════════════════════════════════════════════════════════════════════════════
   `CompanyDetails.tsx:612-618` (pre-wave numbering) told every viewer without
   the gated surfaces that they "appear here once you're invited to a round on
   this company". After wave 146 separated the four surface decisions, that
   sentence became a FALSE STATEMENT for two viewers who will never be invited
   to a round and for whom the surfaces will never appear:

     · a viewer holding a founder's CAP-TABLE VISIBILITY GRANT, and
     · an SPV LP scoped to their own position.

   The owner forbids removing access silently, so this asserts the RENDERED DOM
   text, not source. FAIL-BEFORE: both cases rendered the invitation sentence.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { CompanyDetailsPage } from "@/pages/CompanyDetails";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const COMPANY = "co_w146";

function payload(basis: "full" | "cap_table_grant" | "own_position_only") {
  return {
    id: COMPANY,
    name: "NovaPay AI",
    sector: "Fintech",
    profile: null,
    access: {
      role: "investor",
      canSeeRound: basis === "full",
      canSeeDataroom: basis === "full",
      canSeeSoftCircle: basis === "full",
      canSeeTermSheet: basis === "full",
      investorId: "u_w146_viewer",
      capTableAllowed: true,
      visibilityBasis: basis,
    },
    rounds: null,
    dataroom: null,
    softCircles: null,
    termSheet: null,
  };
}

function mount(basis: "full" | "cap_table_grant" | "own_position_only") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData([`/api/companies/${COMPANY}?as=investor`], payload(basis));
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <CompanyDetailsPage
          companyId={COMPANY}
          viewerRole="investor"
          backHref="/investor/companies"
          backLabel="Back"
        />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

describe("W146 · the gated-surface placeholder states the REAL reason", () => {
  it("R1 · a CAP-TABLE GRANT viewer is not told to wait for a round invitation", async () => {
    mount("cap_table_grant");
    const el = await screen.findByTestId("text-no-gated-reason");
    const text = String(el.textContent);
    expect(text).toMatch(/shareholder register/i);
    expect(text).toMatch(/were not shared/i);
    /* THE FALSE STATEMENT IS GONE. */
    expect(text).not.toMatch(/invited to a round/i);
    /* R77 — no internal code is ever rendered. */
    expect(text).not.toContain("cap_table_grant");
    expect(text).not.toContain("founder_granted_visibility");
  });

  it("R2 · an OWN-POSITION LP is told what their access covers, not to wait for an invitation", async () => {
    mount("own_position_only");
    const el = await screen.findByTestId("text-no-gated-reason");
    const text = String(el.textContent);
    expect(text).toMatch(/your own position/i);
    expect(text).not.toMatch(/invited to a round/i);
    expect(text).not.toContain("own_position_only");
    expect(text).not.toContain("spv_lp_own_only");
  });

  it("R3 · a fully-invited viewer sees no gated placeholder at all", async () => {
    mount("full");
    expect(screen.queryByTestId("section-no-gated")).toBeNull();
  });
});
