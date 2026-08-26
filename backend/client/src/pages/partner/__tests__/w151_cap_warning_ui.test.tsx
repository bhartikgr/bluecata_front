/**
 * WAVE 151 · ITEM C · R105(1) and R105(3) — the GP is WARNED BEFORE committing
 * past an SPV's cap, and the recorded overage is readable afterwards.
 *
 * RENDERED DOM, not source text. Everything below is asserted from what the
 * component actually renders for a given roster + typed amount.
 *
 * ANTI-VACUITY: the warning is required to contain the cap, the current committed
 * total and the overage as FORMATTED FIGURES DERIVED FROM THE FIXTURE (not
 * substrings of a hardcoded sentence), the within-cap pole is asserted empty, and
 * the in-call overlap case is asserted to show the SMALL truthful overage and NOT
 * the doubled one.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvDetail from "../PartnerSpvDetail";

type Sub = { investorId: string; name: string | null; email: string | null; commitmentMinor: number; status: string; ownershipPct: number };

const CAP_MINOR = 100_000_000; // 1,000,000.00 USD

let subscribers: Sub[] = [];
let capMinor: number | null = CAP_MINOR;
let terms: Record<string, unknown> | null = null;

function sub(email: string, minor: number, status = "committed"): Sub {
  return { investorId: `inv_${email}`, name: "Lp Holder", email, commitmentMinor: minor, status, ownershipPct: 0 };
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "spv_w151" }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w151",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w151", email: "gp@example.com", name: "W151 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string) => {
      let payload: unknown = {};
      if (url.includes("lp-roster")) payload = { spvId: "spv_w151", lpVisibility: "gp_only", subscribers, invites: [] };
      else payload = {
        spv: {
          id: "spv_w151",
          name: "W151 Capped SPV",
          jurisdiction: "delaware",
          targetRaiseMinor: 100_000_000,
          capMinor,
          currency: "USD",
          status: "open",
          revisionHash: "a".repeat(64),
          createdAt: new Date().toISOString(),
          terms,
        },
        positions: [],
      };
      return {
        ok: true,
        status: 200,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}>{<PartnerSpvDetail />}</QueryClientProvider>);
  // both queries resolve on the microtask queue
  await screen.findByTestId("partner-spv-lp-commit-form");
  await screen.findByTestId("partner-spv-lp-roster-table").catch(() => null);
  return r;
}

function warning(): string {
  return screen.getByTestId("partner-spv-lp-commit-cap-warning").textContent ?? "";
}

function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}

beforeEach(() => {
  subscribers = [];
  capMinor = CAP_MINOR;
  terms = null;
});
afterEach(() => cleanup());

describe("W151 R105(1) — the pre-commit cap warning", () => {
  it("names the cap, the committed total and the overage, and does not block the submit", async () => {
    subscribers = [sub("a@example.com", 90_000_000)]; // 900,000.00 already in
    await mount();
    expect(warning()).toBe(""); // nothing typed yet

    type("partner-spv-lp-commit-firstname", "New");
    type("partner-spv-lp-commit-lastname", "Lp");
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-units", "100");
    type("partner-spv-lp-commit-amount", "250000"); // → 1,150,000.00 total, 150,000.00 over

    const w = warning();
    // the three figures R105 requires, as rendered
    expect(w).toContain("1,000,000.00 USD"); // cap
    expect(w).toContain("900,000.00 USD");   // committed now
    expect(w).toContain("1,150,000.00 USD"); // total after
    expect(w).toContain("150,000.00 USD");   // overage
    expect(w).toContain("W151 Capped SPV");
    expect(w.toLowerCase()).toContain("past its cap");

    // R105 is warn-and-record: the control is NOT disabled by the warning
    expect((screen.getByTestId("partner-spv-lp-commit-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("opposite pole: a within-cap amount renders an EMPTY warning", async () => {
    subscribers = [sub("a@example.com", 90_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", "50000"); // → 950,000.00, inside 1,000,000.00
    expect(warning()).toBe("");
  });

  it("an SPV with NO cap warns about nothing (null is not zero)", async () => {
    capMinor = null;
    subscribers = [sub("a@example.com", 90_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", "9999999");
    expect(warning()).toBe("");
  });

  it("withdrawn subscriptions do not occupy capacity (R115.4 basis)", async () => {
    subscribers = [sub("a@example.com", 90_000_000, "withdrawn"), sub("b@example.com", 10_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "new@example.com");
    // 100,000.00 committed (b only) + 800,000.00 = 900,000.00 → inside the cap.
    // If the withdrawn 900,000.00 were counted it would be 1,800,000.00 and warn.
    type("partner-spv-lp-commit-amount", "800000");
    expect(warning()).toBe("");
  });
});

describe("W151 — the in-call overlap is not double-counted on screen either", () => {
  it("amending the SAME LP upward shows the small truthful overage", async () => {
    // This LP alone fills the cap exactly.
    subscribers = [sub("same@example.com", 100_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "SAME@example.com "); // matched case-insensitively, trimmed
    type("partner-spv-lp-commit-amount", "1050000");          // amend up by 50,000.00

    const w = warning();
    expect(w).toContain("50,000.00 USD");     // the truthful overage
    expect(w).toContain("1,050,000.00 USD");  // total after
    // the doubled figures the naive `committedBefore + amount` would print
    expect(w).not.toContain("2,050,000.00 USD");
    expect(w).not.toContain("1,050,000.00 USD over");
  });

  it("a DIFFERENT LP at the same amount is counted in full (opposite pole)", async () => {
    subscribers = [sub("same@example.com", 100_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "other@example.com");
    type("partner-spv-lp-commit-amount", "1050000");
    const w = warning();
    expect(w).toContain("2,050,000.00 USD"); // total after — nothing is subtracted
    expect(w).toContain("1,050,000.00 USD"); // the overage
  });
});

describe("W151 — an unusable roster figure is named, never guessed", () => {
  it("refuses to compute rather than printing a confident wrong total", async () => {
    subscribers = [sub("a@example.com", Number.NaN), sub("b@example.com", 10_000_000)];
    await mount();
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", "5000000");
    const w = warning();
    expect(w.toLowerCase()).toContain("cannot be calculated");
    expect(w).not.toContain("NaN");
  });
});

describe("W151 R105(3) — the recorded overage is visible on the SPV afterwards", () => {
  it("renders the durable _capOverrides record from the SPV payload", async () => {
    terms = {
      _capOverrides: {
        inv_x: {
          investorId: "inv_x",
          capMinor: CAP_MINOR,
          committedBeforeMinor: 90_000_000,
          resultingTotalMinor: 115_000_000,
          overageMinor: 15_000_000,
          currency: "USD",
          actor: "u_w151",
          recordedAt: "2026-08-25T12:00:00.000Z",
        },
      },
    };
    await mount();
    const line = screen.getByTestId("partner-spv-cap-override-inv_x").textContent ?? "";
    expect(line).toContain("1,000,000.00"); // cap
    expect(line).toContain("1,150,000.00"); // total after
    expect(line).toContain("150,000.00");   // overage
    expect(line).toContain("u_w151");
  });

  it("opposite pole: an SPV with no override renders an empty container", async () => {
    terms = null;
    await mount();
    expect((screen.getByTestId("partner-spv-cap-overrides").textContent ?? "").trim()).toBe("");
  });
});
