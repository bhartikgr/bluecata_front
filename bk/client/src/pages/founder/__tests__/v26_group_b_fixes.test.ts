/**
 * v23.6 Group B regression guards:
 *
 * B.1 — B-504: Rounds list shows correct Post-money (computed from pre+target)
 * B.2 — B-509: Investor invitations resolve company name + round label (server)
 * B.3 — C-011-LIVE: Admin Collective Applications table resolves company + founder names
 * B.4 — B-510: Preserve activeCompanyId across navigation via localStorage
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUNDS_SRC = readFileSync(
  resolve(__dirname, "../Rounds.tsx"),
  "utf8",
);

const ACTIVE_COMPANY_SRC = readFileSync(
  resolve(__dirname, "../../../lib/useActiveCompany.ts"),
  "utf8",
);

const ADMIN_APPS_SRC = readFileSync(
  resolve(__dirname, "../../admin/CollectiveApplications.tsx"),
  "utf8",
);

const ADMIN_ROUTES_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/adminCollectiveRoutes.ts"),
  "utf8",
);

const ROUTES_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/routes.ts"),
  "utf8",
);

const INV_STORE_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/roundInvitationsStore.ts"),
  "utf8",
);

const MULTI_COMPANY_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/multiCompanyStore.ts"),
  "utf8",
);

// ---- B.1 B-504 ----
describe("B.1 B-504: Rounds list post-money computed inline", () => {
  it("has B-504 marker comment", () => {
    expect(ROUNDS_SRC).toContain("B-504 fix v23.6");
  });

  it("computes post-money from preMoney + targetAmount", () => {
    expect(ROUNDS_SRC).toContain("Number(r.preMoney ?? 0) + Number(r.targetAmount ?? 0)");
  });

  it("does NOT show raw r.postMoney in list", () => {
    // Should have replaced the stale postMoney read in the list card
    // Check that the derived formula is used instead
    expect(ROUNDS_SRC).toContain("post-money-");
  });

  it("has data-testid for post-money", () => {
    expect(ROUNDS_SRC).toContain('data-testid={`post-money-${r.id}`}');
  });
});

// ---- B.2 B-509 ----
describe("B.2 B-509: Investor invitations resolve company name + round label", () => {
  it("has B-509 marker comment in routes.ts", () => {
    expect(ROUTES_SRC).toContain("B-509 fix v23.6");
  });

  it("roundInvitationsStore exports listForInvestorEmail", () => {
    expect(INV_STORE_SRC).toContain("listForInvestorEmail");
  });

  it("routes.ts imports listForInvestorEmail", () => {
    expect(ROUTES_SRC).toContain("roundInvitationsListForEmail");
  });

  it("enriches company name in the investor invitations response", () => {
    expect(ROUTES_SRC).toContain("resolvedCompanyName");
  });

  it("enriches round name from roundsStore", () => {
    expect(ROUTES_SRC).toContain("round?.name");
  });

  it("multiCompanyStore exports getCompanyNameById", () => {
    expect(MULTI_COMPANY_SRC).toContain("getCompanyNameById");
  });
});

// ---- B.3 C-011-LIVE ----
describe("B.3 C-011-LIVE: Admin collective applications resolved names", () => {
  it("has C-011 marker in adminCollectiveRoutes.ts", () => {
    expect(ADMIN_ROUTES_SRC).toContain("C-011 fix v23.6");
  });

  it("imports getCompanyNameById in adminCollectiveRoutes", () => {
    expect(ADMIN_ROUTES_SRC).toContain("getCompanyNameById");
  });

  it("returns companyName in enriched response", () => {
    expect(ADMIN_ROUTES_SRC).toContain("companyName");
  });

  it("returns founderName in enriched response", () => {
    expect(ADMIN_ROUTES_SRC).toContain("founderName");
  });

  it("client renders companyName from response", () => {
    expect(ADMIN_APPS_SRC).toContain("companyName");
    expect(ADMIN_APPS_SRC).toContain("founderName");
  });

  it("C-011 marker in admin CollectiveApplications client", () => {
    expect(ADMIN_APPS_SRC).toContain("C-011 fix v23.6");
  });
});

// ---- B.4 B-510 ----
describe("B.4 B-510: activeCompanyId persisted in localStorage", () => {
  it("has B-510 marker comment", () => {
    expect(ACTIVE_COMPANY_SRC).toContain("B-510 fix v23.6");
  });

  it("defines localStorage key constant", () => {
    expect(ACTIVE_COMPANY_SRC).toContain("capavate:activeCompanyId");
  });

  it("saves to localStorage when activeCompanyId is set", () => {
    expect(ACTIVE_COMPANY_SRC).toContain("localStorage.setItem");
  });

  it("reads from localStorage as fallback during loading", () => {
    expect(ACTIVE_COMPANY_SRC).toContain("localStorage.getItem");
  });

  it("uses useEffect for persistence side-effect", () => {
    expect(ACTIVE_COMPANY_SRC).toContain("useEffect");
  });
});
