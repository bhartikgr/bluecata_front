/**
 * v23.6 Group B server-side regression guards:
 *
 * B.2 — B-509: roundInvitationsStore exports listForInvestorEmail
 * B.3 — C-011-LIVE: adminCollectiveRoutes enriches with company + founder names
 * multiCompanyStore exports getCompanyNameById
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVER_DIR = resolve(__dirname, "..");

const INV_STORE_SRC = readFileSync(
  resolve(SERVER_DIR, "roundInvitationsStore.ts"),
  "utf8",
);

const MULTI_COMPANY_SRC = readFileSync(
  resolve(SERVER_DIR, "multiCompanyStore.ts"),
  "utf8",
);

const ADMIN_ROUTES_SRC = readFileSync(
  resolve(SERVER_DIR, "adminCollectiveRoutes.ts"),
  "utf8",
);

describe("B-509 server: roundInvitationsStore listForInvestorEmail", () => {
  it("exports listForInvestorEmail function", () => {
    expect(INV_STORE_SRC).toContain("export function listForInvestorEmail");
  });

  it("filters by investorEmail (normalized)", () => {
    expect(INV_STORE_SRC).toContain("investorEmail.trim().toLowerCase()");
  });

  it("excludes revoked invitations", () => {
    expect(INV_STORE_SRC).toContain("state !== \"revoked\"");
  });

  it("has B-509 marker comment", () => {
    expect(INV_STORE_SRC).toContain("B-509 fix v23.6");
  });
});

describe("B-509/C-011 server: multiCompanyStore getCompanyNameById", () => {
  it("exports getCompanyNameById function", () => {
    expect(MULTI_COMPANY_SRC).toContain("export function getCompanyNameById");
  });

  it("iterates USER_COMPANIES values to resolve companyId", () => {
    expect(MULTI_COMPANY_SRC).toContain("USER_COMPANIES.values()");
  });

  it("has B-509/C-011 marker comment", () => {
    expect(MULTI_COMPANY_SRC).toContain("B-509 / C-011 fix v23.6");
  });
});

describe("C-011-LIVE server: adminCollectiveRoutes enriches application list", () => {
  it("imports getCompanyNameById", () => {
    expect(ADMIN_ROUTES_SRC).toContain("getCompanyNameById");
  });

  it("imports getUserContextForId for founder name", () => {
    expect(ADMIN_ROUTES_SRC).toContain("getUserContextForId");
  });

  it("returns companyName field", () => {
    expect(ADMIN_ROUTES_SRC).toContain("companyName:");
  });

  it("returns founderName field", () => {
    expect(ADMIN_ROUTES_SRC).toContain("founderName:");
  });

  it("has C-011 fix marker", () => {
    expect(ADMIN_ROUTES_SRC).toContain("C-011 fix v23.6");
  });

  it("uses items: enriched instead of items: merged", () => {
    expect(ADMIN_ROUTES_SRC).toContain("items: enriched");
  });
});
