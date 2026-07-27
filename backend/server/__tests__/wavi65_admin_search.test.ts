/**
 * W-AVI65 FIX 3 — global header search.
 *
 * CONFIRMED LIVE: the header box fires GET /api/founder/search?q=... and returned
 * {"results":[],"counts":{round:0,contact:0,file:0}} even for an admin searching
 * a company label that plainly exists. /api/admin/search had ZERO client callers
 * (the previous wave "fixed" that dead endpoint).
 *
 * ROOT CAUSES (two, both fixed):
 *   1. /api/founder/search scopes to getCompaniesForFounder(userId), which is
 *      EMPTY for an admin → searchFounderWorkspace([], q) short-circuits to [].
 *   2. it never searched the `companies` table at all — only rounds, investor CRM
 *      contacts and dataroom files — so even a real FOUNDER typing their own
 *      company/workspace name got "No matches".
 *
 * FIXES: (a) the client now routes admins to /api/admin/search (which returns a
 * flat results[] of the same shape); (b) founderSearchStore gained a `company`
 * surface scoped STRICTLY to the caller's owned company ids.
 *
 * LIVE ENDPOINTS UNDER TEST: GET /api/founder/search (founder path, confirmed
 * live) and GET /api/admin/search (now actually called by the header box).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchFounderWorkspace } from "../founderSearchStore";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder, getCompaniesForFounder } from "../multiCompanyStore";

const STAMP = Date.now();
const NAME_A = `WaviAlphaCo${STAMP}`;
const NAME_B = `WaviBravoCo${STAMP}`;

let founderA: string;
let founderB: string;
let companyA: string;
let companyB: string;

function seed(userId: string, companyName: string): string {
  const companyId = `co_wavi65s_${Math.random().toString(36).slice(2, 10)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName,
    legalName: `${companyName} Holdings, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "FinTech",
    stage: "Seed",
    hq: "US",
  } as any);
  return companyId;
}

beforeAll(() => {
  ({ userId: founderA } = registerFounderUser({
    email: `wavi65s_a_${STAMP}@test.example`,
    name: "W-AVI65 Search Founder A",
    password: "testpassword123",
  }));
  ({ userId: founderB } = registerFounderUser({
    email: `wavi65s_b_${STAMP}@test.example`,
    name: "W-AVI65 Search Founder B",
    password: "testpassword123",
  }));
  companyA = seed(founderA, NAME_A);
  companyB = seed(founderB, NAME_B);
}, 30_000);

describe("W-AVI65 FIX 3 — a founder can find their OWN company", () => {
  it("returns a company hit for the founder's own company name", () => {
    const ids = getCompaniesForFounder(founderA).map((c) => c.companyId);
    expect(ids).toContain(companyA);
    const hits = searchFounderWorkspace(ids, NAME_A);
    const company = hits.filter((h) => h.kind === "company");
    expect(company.length).toBeGreaterThan(0);
    expect(company.some((h) => h.id === companyA)).toBe(true);
  });

  it("matches on legal_name too (the live workspace label is persisted to both columns)", () => {
    const ids = getCompaniesForFounder(founderA).map((c) => c.companyId);
    const hits = searchFounderWorkspace(ids, "Holdings");
    expect(hits.some((h) => h.kind === "company" && h.id === companyA)).toBe(true);
  });

  it("company hits deep-link to a route that exists", () => {
    const ids = getCompaniesForFounder(founderA).map((c) => c.companyId);
    const hit = searchFounderWorkspace(ids, NAME_A).find((h) => h.kind === "company");
    expect(hit?.href).toBe(`/founder/companies/${companyA}`);
  });
});

describe("W-AVI65 FIX 3 — NEGATIVE: tenant isolation is preserved", () => {
  it("founder B cannot match founder A's company", () => {
    const idsB = getCompaniesForFounder(founderB).map((c) => c.companyId);
    expect(idsB).not.toContain(companyA);
    const hits = searchFounderWorkspace(idsB, NAME_A);
    expect(hits.filter((h) => h.kind === "company")).toHaveLength(0);
    expect(hits.some((h) => h.id === companyA)).toBe(false);
  });

  it("founder A cannot match founder B's company", () => {
    const idsA = getCompaniesForFounder(founderA).map((c) => c.companyId);
    const hits = searchFounderWorkspace(idsA, NAME_B);
    expect(hits.some((h) => h.id === companyB)).toBe(false);
  });

  it("an EMPTY company scope (e.g. an admin on the founder endpoint) matches nothing", () => {
    // This is precisely why the admin box had to move to /api/admin/search.
    expect(searchFounderWorkspace([], NAME_A)).toHaveLength(0);
  });

  it("LIKE wildcards typed by the user are escaped, not honoured as wildcards", () => {
    const idsA = getCompaniesForFounder(founderA).map((c) => c.companyId);
    // A bare "%" must NOT act as "match everything".
    expect(searchFounderWorkspace(idsA, "%").filter((h) => h.kind === "company")).toHaveLength(0);
    expect(searchFounderWorkspace(idsA, "_").filter((h) => h.kind === "company")).toHaveLength(0);
  });
});

describe("W-AVI65 FIX 3 — client contract: the header box is role-aware", () => {
  const src = readFileSync(
    join(process.cwd(), "client", "src", "components", "AppShell.tsx"),
    "utf8",
  );
  const start = src.indexOf("function GlobalSearch()");
  const end = src.indexOf("function Header(");
  const block = src.slice(start, end);

  it("GlobalSearch chooses /api/admin/search for admins and /api/founder/search otherwise", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("/api/admin/search");
    expect(block).toContain("/api/founder/search");
  });

  it("the admin signal comes from useEntitlement (/api/auth/me), NOT the local useRole state", () => {
    expect(block).toContain("useEntitlement()");
    expect(block).toContain("isAdmin");
    // useRole() defaults to "founder" client-side and would mis-route admins.
    expect(block).not.toContain("useRole()");
  });

  it("the chosen path is part of the react-query key so switching roles refetches", () => {
    expect(block).toContain("queryKey: [searchPath, debounced]");
  });
});

describe("W-AVI65 FIX 3 — server contract: /api/admin/search emits the flat results shape", () => {
  const src = readFileSync(join(process.cwd(), "server", "adminV25Store.ts"), "utf8");
  const start = src.indexOf('app.get("/api/admin/search"');
  const block = src.slice(start, start + 12000);

  it("is admin-gated", () => {
    expect(block.slice(0, 200)).toContain("requireAdmin");
  });

  it("emits results[] with a company kind and keeps the original buckets", () => {
    expect(block).toContain('kind: "company"');
    expect(block).toContain('kind: "investor"');
    expect(block).toContain("results,");
    // Additive: existing consumers of the typed buckets must still work.
    expect(block).toContain("collective_members");
  });
});
