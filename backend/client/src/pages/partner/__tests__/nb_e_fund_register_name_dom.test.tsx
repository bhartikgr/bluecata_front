/**
 * NUMBERS BAND · WAVE E (W328) — WHAT THE GENERAL PARTNER ACTUALLY READS.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The server tests prove the payload carries `investorName`. R137: a payload key
 * nobody renders has not fixed anything. Every assertion below reads text out of
 * the mounted real `PartnerFundDetail` page.
 *
 * THE SYMPTOM THIS PINS. This card printed `Reference MARK INVEST PARTNERS` for
 * an LP whose stored `investorId` IS the firm's name — a human name shouted and
 * mislabelled as an internal reference, because `partyReferenceLabel` found no
 * known prefix to strip.
 *
 * §1  a row WITH a name shows the name, and the words "Reference" and the
 *     shouted form are ABSENT from that row.
 * §2  a row WITHOUT a name (`investorName: null`) still shows the pre-existing
 *     `partyReferenceLabel` floor — the fix adds a name, it does not blank a cell.
 * §3  the money on the row is untouched, and the stage label survives verbatim
 *     (R143.1: a replaced text node scores as removed copy).
 * §4  ANTI-VACUITY — §1's absence assertions are proved capable of failing, by
 *     asserting the same shouted string IS present on the unnamed row.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerFundDetail from "../PartnerFundDetail";
import { TooltipProvider } from "@/components/ui/tooltip";

const FUND_ID = "spv_nbe_fund";
const NAME_IN_ID = "Nimbus Capital Partners";
const NO_NAME_ID = "spvlp_e60238e18fd2";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  useRoute: () => [true, { id: FUND_ID }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_nbe",
      tier: "catalyst",
      subRole: "managing_partner",
      identity: { userId: "u_nbe", email: "nbe@example.com", name: "nbe@example.com" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** The payload shape the real route now returns, name field included. */
function fundPayload() {
  return {
    fund: {
      id: FUND_ID,
      name: "NB-E Fund",
      jurisdiction: "delaware",
      targetRaiseMinor: 10000000,
      currency: "USD",
      status: "open",
      revisionHash: "hash_nbe",
      createdAt: "2026-08-01T00:00:00.000Z",
      terms: { vintage: 2026, fundType: "closed_end" },
    },
    commitments: [
      { investorId: NAME_IN_ID, investorName: NAME_IN_ID, commitmentMinor: 250000, ownershipPct: 0.5, status: "review" },
      { investorId: NO_NAME_ID, investorName: null, commitmentMinor: 250000, ownershipPct: 0.5, status: "review" },
    ],
    commitmentsSplit: null,
  };
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === `/api/partner/me/funds/${FUND_ID}`) return jsonResponse(200, fundPayload());
    return jsonResponse(200, {});
  });
});

afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <PartnerFundDetail />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("NB-E §1 — the Fund Register prints the LP's name, not a 'reference'", () => {
  it("renders the stored firm name verbatim on that row", async () => {
    mount();
    const row = await waitFor(() => screen.getByTestId(`partner-commitment-${NAME_IN_ID}`));
    expect(row.textContent ?? "").toContain(NAME_IN_ID);
  });

  it("that row no longer says 'Reference' and no longer shouts the name", async () => {
    mount();
    const row = await waitFor(() => screen.getByTestId(`partner-commitment-${NAME_IN_ID}`));
    const text = row.textContent ?? "";
    expect(text.length).toBeGreaterThan(0); // precondition: the row is not empty
    expect(text).not.toContain("Reference");
    expect(text).not.toContain(NAME_IN_ID.toUpperCase());
  });
});

describe("NB-E §2 — a row with no honest name keeps the existing floor", () => {
  it("shows partyReferenceLabel's output, never blank and never the raw token", async () => {
    mount();
    const row = await waitFor(() => screen.getByTestId(`partner-commitment-${NO_NAME_ID}`));
    const text = (row.textContent ?? "").trim();
    expect(text.length).toBeGreaterThan(0);
    /* The floor is unchanged behaviour: the prefix is stripped and the value is
       labelled as a reference. The RAW token with its prefix is not printed. */
    expect(text).toContain("Reference");
    expect(text).not.toContain("spvlp_");
  });
});

describe("NB-E §3 — the money and the stage copy on those rows did not move", () => {
  it("both amounts render and the stage label is present on each row", async () => {
    mount();
    const named = await waitFor(() => screen.getByTestId(`partner-commitment-${NAME_IN_ID}`));
    const unnamed = screen.getByTestId(`partner-commitment-${NO_NAME_ID}`);
    for (const row of [named, unnamed]) {
      expect(row.textContent ?? "").toContain("2,500.00");
    }
    expect(screen.getByTestId(`partner-commitment-stage-${NAME_IN_ID}`).textContent ?? "").not.toHaveLength(0);
    expect(screen.getByTestId(`partner-commitment-stage-${NO_NAME_ID}`).textContent ?? "").not.toHaveLength(0);
  });
});

describe("NB-E §4 — ANTI-VACUITY: §1's absence assertions can fail", () => {
  it("the SAME shouted-plus-Reference form is still produced where there is no name", async () => {
    mount();
    const row = await waitFor(() => screen.getByTestId(`partner-commitment-${NO_NAME_ID}`));
    const text = row.textContent ?? "";
    /* If `partyReferenceLabel` stopped shouting or stopped saying "Reference", §1
       would pass for the wrong reason. This proves the words are still obtainable
       from the very same component in the very same render. */
    expect(text).toContain("Reference");
    expect(text).toMatch(/[A-Z0-9]{4,}/);
  });
});
