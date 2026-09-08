/**
 * WAVE 341 (productgaps2) · W308 — ADMIN COPY SWEEP.
 * ════════════════════════════════════════════════════════════════════════════
 * The brief carried TWO live observations. I verified BOTH on the code before
 * changing anything, and they did not both survive.
 *
 *   CLAIM A — "VERIFIED INVESTORS 13 displayed beside an Unverified badge"
 *             **HOLDS**, with a sharper cause than the observation could show:
 *             (A1) `getContactStats()` computes `byVerification.verified` with
 *                  NO `kind` predicate, so the card labelled "Verified
 *                  investors" counts verified contacts of ALL three kinds, and
 *             (A2) the stats endpoint reads ONLY the managed contacts table,
 *                  while the LIST endpoint merges read-only `derived_inv_…`
 *                  rows that are hard-coded `verification: "unverified"`. The
 *                  numbers above the table and the rows inside it are
 *                  DIFFERENT POPULATIONS.
 *
 *   CLAIM B — "tab filters that do not filter"
 *             **DOES NOT HOLD AS WRITTEN.** Asserted below, because a premise
 *             that fails must be recorded, not quietly dropped: the tab really
 *             does set `kind` on the request AND the server really does filter
 *             on it. What is actually wrong is (A2): the tab CAPTION's number
 *             is computed over a different population than the rows it labels.
 *
 * Everything here is asserted against RENDERED TEXT or against the server
 * source itself. No number was changed by this item; only words were.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { RoleProvider } from "@/lib/role";

/* ── FIXTURE ───────────────────────────────────────────────────────────────
 * 13 verified contacts, of which only 5 are investors — the exact shape that
 * produced the live observation. The stats block is what the SERVER would
 * return (managed table only); the list adds a derived, permanently
 * "unverified" investor row that no count above the table can include. */
const STATS_FIXTURE = {
  total: 20,
  byKind: { investor: 9, founder: 7, consortium_partner: 4 },
  byVerification: { verified: 13, pending: 2, unverified: 5, rejected: 0 },
  byStatus: { active: 20, inactive: 0, suspended: 0, archived: 0 },
  byRegion: { US: 20 },
};
const LIST_FIXTURE = { total: 1, contacts: [] as unknown[] };

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: vi.fn(async (_m: string, url: string) => ({
      json: async () => (url.includes("/stats") ? STATS_FIXTURE : LIST_FIXTURE),
    })),
  };
});
vi.mock("@/components/admin/InvestorAliasAdminPanel", () => ({
  InvestorAliasAdminPanel: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

const ROOT = path.resolve(__dirname, "../../../../..");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "server/adminContactsStore.ts"), "utf8");
const PAGE_SRC = fs.readFileSync(path.resolve(__dirname, "../Investors.tsx"), "utf8");

beforeAll(async () => {
  const { default: AdminInvestors } = await import("../Investors");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/admin/investors", static: true });
  render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Router hook={hook}>
          <AdminInvestors />
        </Router>
      </RoleProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("stat-verified")).toBeTruthy());
});
afterAll(() => cleanup());

describe("W341 W308 §1 — CLAIM A HOLDS: the verified count is not an investor count", () => {
  it("§1a getContactStats counts verified contacts with NO kind predicate", () => {
    const at = STORE_SRC.indexOf("byVerification: {");
    expect(at).toBeGreaterThan(-1);
    const block = STORE_SRC.slice(at, at + 400);
    expect(block).toContain('verified: all.filter((c) => c.verification === "verified").length');
    /* BOTH POLES — byKind DOES filter on kind, byVerification does NOT. */
    expect(block).not.toContain("c.kind ===");
    const kindAt = STORE_SRC.indexOf("byKind: {");
    expect(STORE_SRC.slice(kindAt, kindAt + 300)).toContain('c.kind === "investor"');
  });

  it("§1b THE LABEL IS STILL WRONG AND IS DELIBERATELY LEFT — recorded, not hidden", () => {
    /* Editing "Verified investors" or "Total contacts" is a REMOVAL of a
       primary-functionality copy string from the silent-drop-guard baseline
       (MEASURED: guard rc=1, "REMOVED copy strings (2)", both in this file).
       Clearing that needs an allowlist entry carrying an OWNER APPROVAL, and the
       delegation that opened this wave covered ONE named item — the country
       dropdown — and no further. So the words stay, the correction is DISCLOSED
       on screen instead (§3a), and the relabel is left open as an owner decision.
       This assertion exists so that the day the relabel is approved, this test
       fails and forces the disclosure sentence to be revisited with it. */
    expect(PAGE_SRC).toContain('label="Verified investors"');
    expect(PAGE_SRC).toContain('label="Total contacts"');
    /* and no number was touched */
    expect(PAGE_SRC).toContain("value={stats?.byVerification.verified ?? 0}");
    expect(PAGE_SRC).toContain("value={stats?.total ?? 0}");
  });

  it("§1c stats read only the managed table; the list merges derived rows", () => {
    const statsAt = STORE_SRC.indexOf("export function getContactStats()");
    expect(statsAt).toBeGreaterThan(-1);
    const statsFn = STORE_SRC.slice(statsAt, statsAt + 1600);
    expect(statsFn).toContain("readAllContactsFromDb()");
    expect(statsFn).not.toContain("derived_inv_");

    const listAt = STORE_SRC.indexOf('app.get("/api/admin/contacts", ');
    expect(listAt).toBeGreaterThan(-1);
    const listFn = STORE_SRC.slice(listAt, listAt + 4000);
    expect(listFn).toContain("derived_inv_");
    expect(listFn).toContain('verification: "unverified"');
    expect(listFn).toContain("const merged = [...results, ...derivedFiltered];");
  });
});

describe("W341 W308 §2 — CLAIM B DOES NOT HOLD: the tab filter really filters", () => {
  it("§2a the tab sets `kind` on the request and on the query key", () => {
    expect(PAGE_SRC).toContain('params.set("kind", k)');
    expect(PAGE_SRC).toContain('activeTab === "consortium_partners" ? "consortium_partner" : activeTab.slice(0, -1)');
  });

  it("§2b the server honours `kind`", () => {
    const listAt = STORE_SRC.indexOf('app.get("/api/admin/contacts", ');
    const listFn = STORE_SRC.slice(listAt, listAt + 600);
    expect(listFn).toContain("const { kind, status, verification, region, search } = req.query");
    expect(listFn).toContain("listContacts({ kind, status, verification, region, search })");
    /* derived rows are added only on the All and Investors tabs */
    expect(STORE_SRC.slice(listAt, listAt + 1200)).toContain('if (!kind || kind === "investor")');
  });

  it("§2c the four tab captions take their numbers from the stats population", () => {
    for (const c of [
      "All ({stats?.total ?? \"…\"})",
      "Investors ({stats?.byKind.investor ?? \"…\"})",
      "Founders ({stats?.byKind.founder ?? \"…\"})",
      "Partners ({stats?.byKind.consortium_partner ?? \"…\"})",
    ]) {
      expect(PAGE_SRC.includes(c), c).toBe(true);
    }
  });
});

describe("W341 W308 §3 — the disclosure and the label are RENDERED, in the DOM", () => {
  it("§3a the disclosure RENDERS and corrects the label in the admin's own words", async () => {
    const scope = screen.queryByTestId("text-contact-stats-scope");
    expect(scope, "the scope sentence must be in the DOM").toBeTruthy();
    /* the numbers are untouched: 13 verified of 20 managed */
    expect(screen.getByTestId("stat-verified").textContent).toBe("13");
    expect(screen.getByTestId("stat-total").textContent).toBe("20");
    /* the disclosure names the mislabel IN RENDERED TEXT, quoting the label
       exactly as the admin sees it, so the screen corrects itself */
    expect(scope!.textContent).toContain('"Verified investors" above counts verified contacts of all kinds');
    expect(scope!.textContent).toContain("not investors alone");
    expect(scope!.textContent).toContain("redeemed round invitation");
    expect(scope!.textContent).toContain("more people than these numbers say");
    /* it must not claim a number of its own */
    expect(scope!.textContent).not.toMatch(/\d/);
  });

  it("§3c the disclosure sits between the stats bar and the tabs", () => {
    const scopeAt = PAGE_SRC.indexOf('data-testid="text-contact-stats-scope"');
    const statsAt = PAGE_SRC.indexOf('testId="stat-pending"');
    const tabsAt = PAGE_SRC.indexOf('data-testid="tabs-kind"');
    expect(statsAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeGreaterThan(statsAt);
    expect(tabsAt).toBeGreaterThan(scopeAt);
  });

  it("§3b the four tab captions still render their counts", () => {
    expect(screen.getByTestId("tab-investors").textContent).toContain("Investors (");
    expect(screen.getByTestId("tab-partners").textContent).toContain("Partners (");
  });
});

describe("W341 W308 §4 — nothing else on the page was touched", () => {
  it("§4a every stat card and tab still RENDERS", () => {
    for (const t of [
      "stat-total", "stat-verified", "stat-founders", "stat-partners", "stat-pending",
      "tab-all", "tab-investors", "tab-founders", "tab-partners", "tabs-kind",
    ]) {
      expect(screen.queryByTestId(t), t).toBeTruthy();
    }
  });

  it("§4b no stat VALUE expression was altered", () => {
    for (const v of [
      "value={stats?.total ?? 0}",
      "value={stats?.byVerification.verified ?? 0}",
      "value={stats?.byKind.founder ?? 0}",
      "value={stats?.byKind.consortium_partner ?? 0}",
      "value={stats?.byVerification.pending ?? 0}",
    ]) {
      expect(PAGE_SRC.includes(v), v).toBe(true);
    }
  });

  it("§4c the server file was not edited by this item", () => {
    expect(STORE_SRC).not.toContain("WAVE 341");
  });
});
