/**
 * WAVE 182 · ITEM C · R152.4 (item 4) — RENDERED DOM: THE CARD NO LONGER PROMISES A
 * CARRY THAT IS NOT CONFIGURED.
 *
 * THE DEFECT, AS SEEN ON LIVE. The "Asian Biotech" card read
 * `… · Carry: Per deployment`, while its Fees tab held exactly one fee —
 * `management: fixed CA$10.00` — and no carry at all. "SPV for vintage TECH daeals."
 * read `Carry: Whole SPV` with `fixed $10,000.00` and, again, no carry.
 *
 * `carryBasis` is a real, required field and the card rendered it correctly. What
 * was wrong is what the label MEANS: it answers over WHAT a carry would be
 * computed, not WHETHER one is charged. This test mounts the REAL page against the
 * REAL endpoint shape and asserts the card now states the vehicle's ACTUAL
 * configured fee structure beside that basis.
 *
 * ALL THREE SHAPES THE OWNER NAMED, plus the two the shapes do not cover:
 *   §C1 carry only          → says a carry IS configured
 *   §C2 hybrid (carry+flat) → says configured, and that a flat fee sits with it
 *   §C3 fixed only, no carry → says plainly that NO carry is configured  ← the defect
 *   §C4 no fee schedule yet  → distinguished from §C3; not the same fact
 *   §C5 unreadable fee view  → refuses to claim either way
 *
 * TWO THINGS ASSERTED ON EVERY SHAPE:
 *   · THE EXISTING LINE IS UNTOUCHED. `Carry: Whole SPV` is still on the card,
 *     byte-verbatim — R143.1, a replaced text node scores as REMOVED copy. The fix
 *     is a STATIC SIBLING beneath it, in the same shape as the Jurisdiction and
 *     Vintage siblings already there.
 *   · NO NUMBER. Never a percentage, never an amount. An unconfigured carry and a
 *     0% carry are DIFFERENT FACTS and this surface may not render one as the
 *     other, so "0%" would be as wrong as the original defect.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";
import { spvCarryConfiguration } from "@shared/spvCarryConfiguration";

const SPV_ID = "spv_w182_c";

/** What the stubbed `GET /api/partner/me/spv` answers for each scenario. */
let carryConfigurations: Array<{ spvId: string; state: string; statement: string }> | undefined = [];

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w182",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w182", email: "w182@example.com", name: "W182 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string) => {
      const isSpvList = method === "GET" && url.endsWith("/api/partner/me/spv");
      const payload = isSpvList
        ? {
            spvs: [
              {
                id: SPV_ID,
                name: "Asian Biotech",
                spvType: "spv",
                status: "open",
                jurisdiction: "british_virgin_islands",
                distributionScope: "whole_spv",
                carryBasis: "whole_spv",
                currency: "CAD",
                capMinor: null,
                targetRaiseMinor: null,
                revisionHash: "d".repeat(64),
                createdAt: new Date().toISOString(),
                terms: null,
              },
            ],
            ...(carryConfigurations === undefined ? {} : { carryConfigurations }),
          }
        : { spvs: [] };
      return {
        ok: true,
        status: 200,
        statusText: "ok",
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerSpvEngine />
    </QueryClientProvider>,
  );
}

/** The line the wave must NOT have touched. */
async function expectBasisLineIntact() {
  const jurisdiction = await screen.findByTestId(`spv-row-jurisdiction-${SPV_ID}`);
  const card = jurisdiction.parentElement!;
  expect(card.textContent).toContain("Carry: Whole SPV");
}

async function statementText(): Promise<string> {
  const node = await screen.findByTestId(`spv-row-carry-configured-${SPV_ID}`);
  return node.textContent ?? "";
}

function expectNoNumbers(text: string) {
  expect(text).not.toMatch(/\d/);
  expect(text).not.toMatch(/[%$€£]/);
}

/** Built by the SHARED classifier, exactly as the server builds it — so a drift in
 *  the wire contract breaks this test rather than passing against a fixture that
 *  agrees only with itself. */
function served(fees: Array<{ feeType: string; carryPct: number | null }>, feeViewUnreliable = false) {
  return [{ spvId: SPV_ID, ...spvCarryConfiguration({ fees, feeViewUnreliable }) }];
}

beforeEach(() => {
  carryConfigurations = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("W182 ITEM C · DOM — the card reflects the ACTUAL configured fee structure", () => {
  it("§C1 carry only — the card says a carry is configured", async () => {
    carryConfigurations = served([{ feeType: "carry", carryPct: 0.2 }]);
    mount();
    const text = await statementText();
    expect(text.toLowerCase()).toContain("carry is configured");
    await expectBasisLineIntact();
    expectNoNumbers(text);
  });

  it("§C2 hybrid — configured, and the flat fee beside it is stated", async () => {
    carryConfigurations = served([{ feeType: "hybrid", carryPct: 0.15 }]);
    mount();
    const text = await statementText();
    expect(text.toLowerCase()).toContain("carry is configured");
    expect(text.toLowerCase()).toContain("flat fee");
    await expectBasisLineIntact();
    expectNoNumbers(text);
  });

  it("§C3 fixed only, no carry — THE LIVE DEFECT — says plainly that no carry is configured, and never 0%", async () => {
    carryConfigurations = served([{ feeType: "fixed", carryPct: null }]);
    mount();
    const text = await statementText();
    expect(text.toLowerCase()).toContain("no carry is configured");
    /* The forbidden fabrication, fenced on the rendered surface itself. */
    expect(text).not.toContain("0%");
    expect(text.toLowerCase()).not.toContain("zero");
    expectNoNumbers(text);
    /* And the basis is still on the card — the GP is told what it MEANS, not
       deprived of it. */
    await expectBasisLineIntact();
  });

  it("§C4 no fee schedule at all — a different sentence from §C3", async () => {
    carryConfigurations = served([]);
    mount();
    const text = await statementText();
    expect(text.toLowerCase()).toContain("no fee schedule");
    expectNoNumbers(text);
  });

  it("§C5 an unreadable fee schedule — the card claims neither way", async () => {
    carryConfigurations = served([], true);
    mount();
    const text = await statementText();
    expect(text.toLowerCase()).toContain("could not be read");
    expect(text.toLowerCase()).not.toContain("no carry is configured");
    expectNoNumbers(text);
  });

  it("§C6 a payload without the field renders NO statement rather than guessing one", async () => {
    /* A body cached from before this wave carries no `carryConfigurations`. Silence
       is the only honest output: the card has no fee fact, and inventing "no carry"
       would be the original defect with the sign flipped. */
    carryConfigurations = undefined;
    mount();
    await screen.findByTestId(`spv-row-jurisdiction-${SPV_ID}`);
    expect(screen.queryByTestId(`spv-row-carry-configured-${SPV_ID}`)).toBeNull();
    await expectBasisLineIntact();
  });
});
