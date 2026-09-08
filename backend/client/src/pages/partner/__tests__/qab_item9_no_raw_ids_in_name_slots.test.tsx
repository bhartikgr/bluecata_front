/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 9 — raw internal ids were rendered where a NAME belongs.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * One root pattern, `?? id`: when a display name was missing the code printed
 * the primary key, so an operator read `spv_e08dcbdd2921a89c` as an SPV title
 * and `co_d294747574f5` as a company name. An id is not a name — it tells the
 * reader nothing and leaks the storage schema.
 *
 * The remedy was ALREADY BUILT: `@shared/investorDisplayLabels` exports
 * `displayName`, which describes WHAT the row is and returns no part of the id.
 *
 * THIS FILE ASSERTS RENDERED TEXT, not source strings, and every case proves
 * BOTH halves of the fix:
 *   · the id is GONE from the name slot, and
 *   · the id is STILL REACHABLE, because removing it outright would take a
 *     working navigation aid away from operators who use it today.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { displayName } from "@shared/investorDisplayLabels";

/* The two ids QA read off the screen, verbatim. */
const SPV_ID = "spv_e08dcbdd2921a89c";
const COMPANY_ID = "co_d294747574f5";

describe("QA ITEM 9 · a name slot never prints a primary key", () => {
  it("0 · CONTROL — the shared helper really refuses to echo an id", () => {
    /* VALIDATE THE INSTRUMENT BEFORE MEASURING THE PRODUCT. If `displayName`
       silently passed ids through, every assertion below would be vacuous. */
    expect(displayName(undefined, "vehicle", SPV_ID)).toBe("Unnamed vehicle");
    expect(displayName(undefined, "vehicle", SPV_ID)).not.toContain("spv_");
    expect(displayName(undefined, "company", COMPANY_ID)).toBe("Unnamed company");
    expect(displayName(undefined, "company", COMPANY_ID)).not.toContain("co_");
    /* And it still yields to a REAL name when one exists — the fix must not
       replace good data with a refusal. */
    expect(displayName("Northwind Labs", "company", COMPANY_ID)).toBe("Northwind Labs");
  });
});

/* ─────────────────────────────── PartnerPortfolio ────────────────────────── */

const PORTFOLIO_ROWS = [
  { companyId: COMPANY_ID, companyName: null, updatedAt: "2026-08-01T00:00:00Z" },
  { companyId: "co_named_1", companyName: "Northwind Labs", updatedAt: "2026-08-02T00:00:00Z" },
];

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_qab9",
      tier: "builder",
      subRole: "partner_admin",
      identity: { userId: "u_qab9", email: "qab9@example.com", name: "QAB9 Partner" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useLocation: () => ["/partner/portfolio", () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async () => res(200, { portfolio: PORTFOLIO_ROWS }));
  vi.stubGlobal("fetch", vi.fn(async () => res(200, {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mountPortfolio() {
  const { default: PartnerPortfolio } = await import("../PartnerPortfolio");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerPortfolio />
    </QueryClientProvider>,
  );
}

describe("QA ITEM 9 · the partner portfolio name cell", () => {
  it("1 · the NAME CELL no longer prints the company id, but the row still carries it", async () => {
    await mountPortfolio();
    await waitFor(() => expect(screen.getByTestId(`portfolio-row-${COMPANY_ID}`)).toBeTruthy(), { timeout: 8000 });

    const row = screen.getByTestId(`portfolio-row-${COMPANY_ID}`);
    const cells = row.querySelectorAll("td");
    /* PRECONDITION — the row really rendered its cells. */
    expect(cells.length).toBeGreaterThan(1);

    const nameCell = cells[0] as HTMLElement;
    expect((nameCell.textContent ?? "").trim()).toBe("Unnamed company");
    /* THE DEFECT: this cell used to read `co_d294747574f5`. */
    expect(nameCell.textContent ?? "").not.toContain(COMPANY_ID);

    /* NOTHING BECAME UNREACHABLE. MEASURED, NOT ASSUMED: the row still carries
       the reference, but in the platform's ESTABLISHED reference form, because
       `partyReferenceLabel` (WAVE 115 · FINDING 1) already governs how a
       storage key may appear on a partner screen. So the reachable value is
       "Reference D294747574F5", not the literal `co_…` string — and this test
       asserts what the screen ACTUALLY renders rather than what I first
       guessed it would. The distinguishing characters are all present, so an
       operator can still match a row to a record. */
    const reference = "Reference D294747574F5";
    expect(row.textContent ?? "").toContain(reference);
    expect(nameCell.getAttribute("title") ?? "").toContain(reference);
    /* And the distinguishing part of the id survives, uppercased and unabridged. */
    expect(reference.toLowerCase()).toContain(COMPANY_ID.replace("co_", ""));
  });

  it("2 · a row that HAS a name is untouched — the fix does not overwrite good data", async () => {
    await mountPortfolio();
    await waitFor(() => expect(screen.getByTestId("portfolio-row-co_named_1")).toBeTruthy(), { timeout: 8000 });
    const cells = screen.getByTestId("portfolio-row-co_named_1").querySelectorAll("td");
    expect((cells[0].textContent ?? "").trim()).toBe("Northwind Labs");
  });

  it("3 · the reference column is labelled as INTERNAL, not as a fact about the company", async () => {
    await mountPortfolio();
    await waitFor(() => expect(screen.getByTestId("portfolio-table")).toBeTruthy(), { timeout: 8000 });
    const headers = Array.from(screen.getByTestId("portfolio-table").querySelectorAll("th"))
      .map((h) => (h.textContent ?? "").trim());
    expect(headers.length).toBeGreaterThan(0);          // precondition
    expect(headers).toContain("Internal ID");
    expect(headers).not.toContain("Company ID");
    /* The column is KEPT. Whether it should exist at all is a product decision
       recorded for the owner, and this test pins the current answer so a future
       removal is a deliberate act rather than a drift. */
  });
});
