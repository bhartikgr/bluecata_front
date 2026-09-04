/**
 * WAVE A2 · ITEMS 5a + 5b — THE STORED ROW, NOT THE COMPONENT'S STATE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS PROVED HERE AND WHY A DOM-ONLY PROOF WOULD NOT BE ENOUGH
 * ══════════════════════════════════════════════════════════════════════════════
 * `client/src/lib/__tests__/wa5a_canonical_select_preserves_stored_value.test.tsx`
 * proves the DOM property: a `<select>` built by `canonicalSelectOptions` reports
 * an off-list value back unchanged, and the naive one demonstrably does not. That
 * is a proof about an element. It is NOT a proof that the value a partner typed
 * survives the whole submit path into the database — the sector could still be
 * trimmed, coerced, re-cased or replaced by anything between the input's onChange
 * and the INSERT.
 *
 * So this file drives the REAL `PartnerAddPortfolioCompany` in jsdom, presses its
 * REAL create button, lets the request reach the REAL registered express route
 * over supertest against the REAL SQLite handle, and then reads the row back with
 * `rawDb()` — the storage layer itself, not the page's state and not the route's
 * JSON reply. The assertion is on `companies.sector` and `companies.hq`.
 *
 * NOTHING IN THE DATA PATH IS MOCKED. The three mocks are the partner shell (a
 * layout wrapper), the toast hook, and the partner-role hook — the last one frozen
 * and hoisted because wave 173 recorded that a fresh literal there re-runs the
 * page's effects in an unbounded loop. `global.fetch` is replaced by a bridge that
 * forwards to `request(app)`, exactly as
 * `w232_progress_provenance_dom.test.tsx` does.
 *
 * NEVER MUTATES data.db / test.db — ordinary in-memory test handle.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb } from "../../../../../server/db/connection";
import { seedTestPartnerSandbox } from "../../../../../server/partnerWorkspaceStore";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT } from "@shared/wave214ThirdPartyAuthorityCopy";
import { COLLECTIVE_SECTORS_45, COLLECTIVE_STAGES } from "@shared/schema";
import { COUNTRIES } from "@/lib/profile/data/countries";
import PartnerAddPortfolioCompany from "../PartnerAddPortfolioCompany";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

/** Values no canonical list contains. A partner may legitimately hold these. */
const OFF_LIST_SECTOR = "Deep-Sea Robotics";
const OFF_LIST_STAGE = "Pre-Pre-Seed (friends round)";
const OFF_LIST_HQ = "Reykjanesbær, IS-2";

let app: Express;

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title ?? ""}</div>,
}));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

/* FROZEN AND HOISTED ON PURPOSE — see the header note. */
const ROLE_RESULT = Object.freeze({
  ready: true,
  error: null,
  identity: Object.freeze({
    partnerId: PARTNER_A,
    tier: "builder",
    subRole: "managing_partner",
    identity: Object.freeze({ userId: MANAGING, email: "p@wa5a.test", name: "WA5a Managing" }),
  }),
});
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ROLE_RESULT,
}));

const httpCalls: Array<{ method: string; url: string; status: number }> = [];

/* `httpCalls` accumulates across every test in this file, so a `some(...)` or
   `> 0` predicate over the whole array is satisfied by a 201 an EARLIER test
   caused and returns instantly. A wait that can be satisfied by history is not a
   wait — w232 recorded this exact inert mechanism, and the first draft of this
   file reproduced it. Every wait below therefore snapshots the count first and
   requires an INCREASE. */
function creates201(): number {
  return httpCalls.filter((c) => c.url.includes("portfolio-companies") && c.status === 201).length;
}

beforeAll(async () => {
  const { registerPartnerRoutes } = await import("../../../../../server/partnerRoutes");
  const { registerPartnerPortfolioCompanyRoutes } = await import(
    "../../../../../server/partnerPortfolioCompanyRoutes"
  );
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });

  (global as never as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toLowerCase();
    let r = (request(app) as unknown as Record<string, (u: string) => never>)[method](
      String(url),
    ) as never as {
      set: (k: string, v: string) => typeof r;
      send: (b: string) => typeof r;
      then: unknown;
    };
    r = r.set("x-user-id", MANAGING).set("x-actor-user-id", MANAGING);
    if (init?.body !== undefined && init?.body !== null) {
      r = r.set("content-type", "application/json").send(String(init.body));
    }
    const res = (await (r as unknown as Promise<{ status: number; body: unknown }>));
    httpCalls.push({ method: method.toUpperCase(), url: String(url), status: res.status });
    const bodyText = JSON.stringify(res.body ?? {});
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: String(res.status),
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => res.body,
      text: async () => bodyText,
      clone() { return this; },
    } as unknown as Response;
  };
}, 60_000);

afterEach(() => cleanup());

function mount(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerAddPortfolioCompany />
    </QueryClientProvider>,
  );
}

/** Assert PRECONDITIONS before measuring anything (standing rule 5). */
describe("0 · preconditions", () => {
  it("the real form, the real dropdowns and the real lists are all present", () => {
    mount();
    for (const id of [
      "apc-company-name",
      "apc-founder-email",
      "apc-sector",
      "apc-stage",
      "apc-hq",
      "apc-sector-select",
      "apc-stage-select",
      "apc-hq-country-select",
      "apc-authority-name",
      "apc-create-btn",
    ]) {
      expect(screen.getByTestId(id), `missing ${id}`).toBeTruthy();
    }
    /* The dropdowns are bound to the shipped lists at the counts measured, not
       to a list this wave invented. 45 + "Not specified", 7 + "Not specified",
       250 + "Country not specified". */
    expect((screen.getByTestId("apc-sector-select") as HTMLSelectElement).options.length)
      .toBe(COLLECTIVE_SECTORS_45.length + 1);
    expect((screen.getByTestId("apc-stage-select") as HTMLSelectElement).options.length)
      .toBe(COLLECTIVE_STAGES.length + 1);
    expect((screen.getByTestId("apc-hq-country-select") as HTMLSelectElement).options.length)
      .toBe(COUNTRIES.length + 1);

    /* The protected WAVE 214 block is untouched and still on the screen. */
    expect(screen.getByTestId("apc-authority-statement").textContent)
      .toBe(WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT);

    /* Nothing is pre-selected: an unanswered field reads as unanswered, and no
       dropdown asserts a value nobody gave. */
    expect((screen.getByTestId("apc-sector-select") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("apc-stage-select") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("apc-hq-country-select") as HTMLSelectElement).value).toBe("");
  });
});

describe("A · a canonical choice reaches the database as itself", () => {
  it("choosing Fintech / Series A / Canada stores exactly those", async () => {
    mount();
    fireEvent.change(screen.getByTestId("apc-company-name"), { target: { value: "WA5a Canonical Co" } });
    fireEvent.change(screen.getByTestId("apc-founder-email"), { target: { value: "founder@wa5a-canon.test" } });
    fireEvent.change(screen.getByTestId("apc-sector-select"), { target: { value: "Fintech" } });
    fireEvent.change(screen.getByTestId("apc-stage-select"), { target: { value: "Series A" } });
    fireEvent.change(screen.getByTestId("apc-hq"), { target: { value: "Toronto" } });
    fireEvent.change(screen.getByTestId("apc-hq-country-select"), { target: { value: "Canada" } });
    fireEvent.change(screen.getByTestId("apc-authority-name"), { target: { value: "WA5a Managing" } });

    /* The dropdown and the free-text box are one value, so the box shows it. */
    expect((screen.getByTestId("apc-sector") as HTMLInputElement).value).toBe("Fintech");
    expect((screen.getByTestId("apc-hq") as HTMLInputElement).value).toBe("Toronto, Canada");

    const before = creates201();
    fireEvent.click(screen.getByTestId("apc-create-btn"));
    await waitFor(() => expect(creates201()).toBeGreaterThan(before), { timeout: 8000 });

    /* THE STORED ROW. Read from SQLite, not from the page and not from the reply. */
    const row = rawDb()
      .prepare(`SELECT sector, stage, hq FROM companies WHERE name = ?`)
      .get("WA5a Canonical Co") as { sector: string | null; stage: string | null; hq: string | null };
    expect(row).toBeTruthy();
    expect(row.sector).toBe("Fintech");
    expect(row.stage).toBe("Series A");
    expect(row.hq).toBe("Toronto, Canada");
  }, 20_000);
});

describe("B · THE HIGH-RISK CASE — an off-list value is not dropped and not coerced", () => {
  it("a sector, stage and HQ the lists do not contain survive to the row byte-for-byte", async () => {
    mount();
    fireEvent.change(screen.getByTestId("apc-company-name"), { target: { value: "WA5a Off List Co" } });
    fireEvent.change(screen.getByTestId("apc-founder-email"), { target: { value: "founder@wa5a-off.test" } });

    /* Typed into the FREE-TEXT boxes, which is what a partner who has a value the
       standard list does not cover actually does. */
    fireEvent.change(screen.getByTestId("apc-sector"), { target: { value: OFF_LIST_SECTOR } });
    fireEvent.change(screen.getByTestId("apc-stage"), { target: { value: OFF_LIST_STAGE } });
    fireEvent.change(screen.getByTestId("apc-hq"), { target: { value: OFF_LIST_HQ } });
    fireEvent.change(screen.getByTestId("apc-authority-name"), { target: { value: "WA5a Managing" } });

    /* THE RENDER ROUND-TRIP. The dropdown reports the off-list value back
       unchanged — it does NOT show the first option — and it marks it. */
    const sectorSelect = screen.getByTestId("apc-sector-select") as HTMLSelectElement;
    const stageSelect = screen.getByTestId("apc-stage-select") as HTMLSelectElement;
    expect(sectorSelect.value).toBe(OFF_LIST_SECTOR);
    expect(sectorSelect.value).not.toBe(COLLECTIVE_SECTORS_45[0]);
    expect(stageSelect.value).toBe(OFF_LIST_STAGE);
    expect(stageSelect.value).not.toBe(COLLECTIVE_STAGES[0]);
    expect(sectorSelect.options[sectorSelect.selectedIndex].textContent)
      .toContain("not in Capavate's standard list");
    /* "IS-2" is not a country name, so the country dropdown reads as unanswered
       rather than claiming a country the partner never chose. */
    expect((screen.getByTestId("apc-hq-country-select") as HTMLSelectElement).value).toBe("");

    const before = creates201();
    fireEvent.click(screen.getByTestId("apc-create-btn"));
    await waitFor(() => expect(creates201()).toBeGreaterThan(before), { timeout: 8000 });

    /* THE STORED ROW — the assertion that matters. */
    const row = rawDb()
      .prepare(`SELECT sector, stage, hq FROM companies WHERE name = ?`)
      .get("WA5a Off List Co") as { sector: string | null; stage: string | null; hq: string | null };
    expect(row).toBeTruthy();
    expect(row.sector).toBe(OFF_LIST_SECTOR);
    expect(row.stage).toBe(OFF_LIST_STAGE);
    expect(row.hq).toBe(OFF_LIST_HQ);
    /* Explicitly NOT the neighbouring option — the failure mode, named. */
    expect(row.sector).not.toBe("Fintech");
    expect(row.stage).not.toBe("Pre-Seed");
  }, 20_000);

  it("choosing a country ADDS to an off-list HQ instead of replacing it", async () => {
    mount();
    fireEvent.change(screen.getByTestId("apc-company-name"), { target: { value: "WA5a Hq Append Co" } });
    fireEvent.change(screen.getByTestId("apc-founder-email"), { target: { value: "founder@wa5a-hq.test" } });
    /* The shipped convention, which holds a US STATE code in the ", XX" slot. */
    fireEvent.change(screen.getByTestId("apc-hq"), { target: { value: "San Francisco, CA" } });
    fireEvent.change(screen.getByTestId("apc-hq-country-select"), { target: { value: "United States" } });
    fireEvent.change(screen.getByTestId("apc-authority-name"), { target: { value: "WA5a Managing" } });

    expect((screen.getByTestId("apc-hq") as HTMLInputElement).value)
      .toBe("San Francisco, CA, United States");

    const before = creates201();
    fireEvent.click(screen.getByTestId("apc-create-btn"));
    await waitFor(() => expect(creates201()).toBeGreaterThan(before), { timeout: 8000 });
    const row = rawDb()
      .prepare(`SELECT hq FROM companies WHERE name = ?`)
      .get("WA5a Hq Append Co") as { hq: string | null };
    expect(row.hq).toBe("San Francisco, CA, United States");
    /* Nothing the partner typed was thrown away. */
    expect(String(row.hq).startsWith("San Francisco, CA")).toBe(true);
  }, 20_000);
});
