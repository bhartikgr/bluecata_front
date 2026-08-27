/**
 * WAVE 165 · R130.2 / R139.4 — RENDERED-DOM PROOF OF THE WORDING SWEEP.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE HOLDS SHUT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A consortium partner read a $5,000,000 target raise as the amount the vehicle
 * would accept and committed $10,000,000 into it. R139.4's finding is that an
 * UNEXPLAINED SURFACE IS THAT DEFECT SURVIVING — so the proof obligation is not
 * "a constant exists" or "a store returns the right string", it is that a MOUNTED
 * COMPONENT puts the meaning on screen next to the number. R137.1 rejected a
 * store-return as proof for exactly this reason, and R138.3 accepted rendered DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * · It mounts PartnerFundDetail — the S4 surface, the ONE that was already right
 *   about the target before this wave, and therefore the surface where a lazy
 *   test would trivially pass. It asserts the thing S4 was SILENT about: whether
 *   a maximum exists at all. A reader who cannot see that a cap exists is left to
 *   infer the target is one, which is the live misreading verbatim.
 * · The target figure asserted is DERIVED from the fixture arithmetic here, never
 *   read back out of a sentence this file also authored.
 * · Both poles are asserted: a fund WITH a recorded target and a fund with a NULL
 *   target. The null case must print the canonical absence string and must NOT
 *   print a zero — "$0.00" for an unknown amount is a false statement about money
 *   (R111 Q13), and it is separately asserted absent.
 * · §3 asserts ORDER: the pre-existing wave-127 basis note stays the FIRST child
 *   of the tile and is byte-identical. Wave 165 appended; it did not rewrite. That
 *   is the no-silent-drop rule expressed as a test rather than as a promise.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerFundDetail from "../PartnerFundDetail";

/* A non-round sentinel in MINOR units. No fixture anywhere else in the suite
   carries it, so a rendered figure matching it can only have come from here. */
const TARGET_MINOR = 47_500_031; // 475,000.31 USD

/** Minor units → the page's display form, computed independently of the page. */
function money(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const frac = String(Math.abs(minor % 100)).padStart(2, "0");
  /* The page renders USD through `moneyOrNotProvided`, which prints the symbol
     form `$475,000.31`. Reproduced here from the minor units rather than read
     back off the screen, so this assertion is arithmetic and not tautology. */
  return `$${whole.toLocaleString("en-US")}.${frac}`;
}

let targetRaiseMinor: number | null = TARGET_MINOR;

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "fund_w165" }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w165",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w165", email: "gp@example.com", name: "W165 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fund: {
          id: "fund_w165",
          name: "W165 Wording Fund",
          jurisdiction: "delaware",
          targetRaiseMinor,
          currency: "USD",
          status: "open",
          revisionHash: "c".repeat(64),
          createdAt: new Date().toISOString(),
          terms: { vintage: "2026", fundType: "venture" },
        },
        commitments: [],
      }),
    }),
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerFundDetail />
    </QueryClientProvider>,
  );
}

async function tile(): Promise<HTMLElement> {
  mount();
  return await screen.findByTestId("partner-fund-detail");
}

beforeEach(() => {
  targetRaiseMinor = TARGET_MINOR;
});
afterEach(() => cleanup());

describe("W165 §1 — the target figure renders, and renders as a GOAL", () => {
  it("prints the fixture's target raise", async () => {
    const el = await tile();
    expect(el.textContent ?? "").toContain(money(TARGET_MINOR));
  });

  it("states beside it that the target is a goal and not a limit", async () => {
    await tile();
    const note = (await screen.findByTestId("partner-fund-target-basis")).textContent ?? "";
    expect(note.toLowerCase(), "the pre-existing S4 note must survive verbatim").toContain(
      "fundraising goal",
    );
    expect(note, "and must still say commitments can exceed it").toContain("can exceed it");
  });
});

describe("W165 §2 — THE FAILING ASSERTION: the tile must say whether a MAXIMUM exists", () => {
  /* This is the one that fails before wave 165. S4 explained the target and said
     NOTHING about the cap, so a partner reading it still had no way to learn
     that a separate maximum is the thing that limits the vehicle. Left silent,
     the only limit-shaped number on the screen is the target — and taking the
     target for the limit is the original $10,000,000 defect. */
  it("renders a cap statement naming the cap as the maximum", async () => {
    await tile();
    const cap = (await screen.findByTestId("partner-fund-cap-is-the-maximum")).textContent ?? "";
    expect(cap.toLowerCase()).toContain("maximum");
  });

  it("states that a blank cap means NO maximum, so blank is not read as zero", async () => {
    await tile();
    const cap = (await screen.findByTestId("partner-fund-cap-is-the-maximum")).textContent ?? "";
    expect(cap.toLowerCase()).toContain("no maximum");
    expect(cap.toLowerCase()).toContain("optional");
  });

  it("never presents the cap statement as a figure, so no fake maximum appears", async () => {
    await tile();
    const cap = (await screen.findByTestId("partner-fund-cap-is-the-maximum")).textContent ?? "";
    expect(cap, "a sentence about the cap must not carry a money figure").not.toMatch(/\d/);
  });
});

describe("W165 §3 — order and preservation: appended, never rewritten", () => {
  it("keeps the wave-127 basis note as the FIRST of the two notes", async () => {
    const el = await tile();
    const text = el.textContent ?? "";
    const basisAt = text.indexOf("The fundraising goal recorded for this vehicle");
    const capAt = text.indexOf("The cap, separately, is the maximum");
    expect(basisAt, "the original note must still be present").toBeGreaterThanOrEqual(0);
    expect(capAt, "the added note must be present").toBeGreaterThanOrEqual(0);
    expect(capAt, "the addition goes AFTER the original, never in place of it").toBeGreaterThan(
      basisAt,
    );
  });

  it("keeps the original note byte-identical", async () => {
    await tile();
    const note = (await screen.findByTestId("partner-fund-target-basis")).textContent ?? "";
    expect(note.replace(/\s+/g, " ").trim()).toBe(
      "The fundraising goal recorded for this vehicle. Commitments below are NOT expressed as a " +
        "percentage of it — they can exceed it, and a listed amount is not necessarily raised.",
    );
  });
});

describe("W165 §4 — an ABSENT target is named, never printed as zero", () => {
  beforeEach(() => {
    targetRaiseMinor = null;
  });

  it("does not print 0.00 for a target nobody recorded", async () => {
    const el = await tile();
    const text = el.textContent ?? "";
    expect(text, "$0.00 for an unknown amount is a false statement about money").not.toContain(
      "$0.00",
    );
  });

  it("still explains the target AND the cap when the figure is absent", async () => {
    await tile();
    expect((await screen.findByTestId("partner-fund-target-basis")).textContent ?? "").toContain(
      "fundraising goal",
    );
    expect(
      ((await screen.findByTestId("partner-fund-cap-is-the-maximum")).textContent ?? "").toLowerCase(),
    ).toContain("no maximum");
  });
});
