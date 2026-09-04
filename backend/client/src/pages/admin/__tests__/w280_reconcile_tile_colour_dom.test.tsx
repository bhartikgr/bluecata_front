/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 280 — THE RECONCILE-SUCCESS GREEN TICK WAS MASKED, NOT REMOVED.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `client/src/pages/admin/Dashboard.tsx:572` handed the Reconcile
 * tile `icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}` while
 * its four siblings (`:573-576`) carried NO colour class at all. Wave 240 did
 * not remove the colour; it added `grayscale opacity-50` to the icon WRAPPER
 * (`:778`) in the `unknown` tone only, and wrote in the file that it had left
 * the literal in place (`:760-764`).
 *
 * A CSS mask is not a state change:
 *   · in `unknown` the green is in the DOM and merely filtered — it survives a
 *     wrapper restyle, a stylesheet failure, a print stylesheet, and any
 *     `filter`-stripping accessibility mode;
 *   · in `ok` and `warn` the mask does not apply AT ALL, so a genuinely amber,
 *     breaching reconcile tile still rendered a green shield. The mask never
 *     addressed that case and could not.
 *
 * WHY ALL THREE TONES ARE REACHABLE ON THIS TILE. The wave-240 comment says
 * four of the five figures are hardcoded `null` on the server. True — but the
 * FIFTH is this one: `server/adminPlatformStore.ts:164-170` sets
 * `capTableReconcile: computeReconHealth()` (`:1889-1898`), which returns a real
 * `successRatePct` whenever `recon_runs` is non-empty and `null` only when it is
 * empty. So `unknown`, `ok` and `warn` are ALL production branches here, and
 * §2/§3 below exist because of that, not as hypotheticals.
 *
 * ── HOW THIS FILE AVOIDS PROVING NOTHING ────────────────────────────────────
 * A test asserting "no emerald in the reconcile icon" is satisfied by a DOM
 * query that can never find emerald anywhere — inert-proof mechanisms "an
 * unscoped DOM query", "an unconditionally-true predicate" and "a RED that
 * proves nothing". Three counter-measures, all load-bearing:
 *
 *   1. POSITIVE CONTROL (§0). The SAME extractor is pointed at the "Platform
 *      health" section header, `Dashboard.tsx:565`, which legitimately keeps
 *      `text-emerald-600` (it is decoration on a heading, not a state claim on
 *      a figure). If §0 goes green while §1-§3 go green, the extractor works.
 *      If §0 ever goes RED, every other assertion in this file is void.
 *   2. EVERY QUERY IS SCOPED to one tile's own `-icon` wrapper by testId, never
 *      to `document`.
 *   3. §4 asserts POSITIVE EQUALITY with the four siblings' utility classes
 *      rather than only the absence of a token, so a change that blanked every
 *      icon's className would fail §4 even though it would satisfy §1-§3.
 *
 * The REAL exported `AdminDashboard` page is mounted in the real providers
 * (ENGINEERING_NOTES §8: never prove a replica). The harness mirrors
 * `w239_240_honest_absence_dom.test.tsx`, which is left untouched by this wave
 * and is asserted still-green by §5.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import fs from "node:fs";
import path from "node:path";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useLocation: () => ["/admin", vi.fn()] };
});

import AdminDashboard from "../Dashboard";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** `recon_runs` empty → `successRatePct: null` → tone `unknown`. This is the
 *  block this build's server emits today (four hardcoded nulls + an empty
 *  reconcile table). Verified against server/adminPlatformStore.ts:164-170. */
const HEALTH_UNKNOWN = {
  capTableReconcile: { runs: 0, success: 0, successRatePct: null },
  closeGateFailures: null,
  dataroomUploadErrors: null,
  messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
  emailSlaSec: null,
};

/** Reconcile at 100% of 4 runs → tone `ok`. THE CASE THE MASK NEVER COVERED. */
const HEALTH_OK = {
  capTableReconcile: { runs: 4, success: 4, successRatePct: 100 },
  closeGateFailures: 0,
  dataroomUploadErrors: 0,
  messageDelivery: { sent: 200, delivered: 200, deliveryRatePct: 100 },
  emailSlaSec: 12,
};

/** Reconcile at 91.25% (< 99) → tone `warn`. A BREACHING tile that used to
 *  render a green shield with no mask over it. */
const HEALTH_WARN = {
  ...HEALTH_OK,
  capTableReconcile: { runs: 80, success: 73, successRatePct: 91.25 },
};

function kpis(health: unknown) {
  return {
    summary: {
      totalCompanies: 3, totalInvestors: 4, totalCommittedSoftCircle: null, totalFunded: null,
      momGrowthPct: null, churnPct: null, nrr: null,
      totalSpvCommittedMinor: { USD: 1_100_037 },
      totalSpvSubscribedAllStagesMinor: { USD: 10_500_108 },
      totalSpvWiredMinor: { USD: 400_000 },
      totalActiveSpvs: 2,
    },
    queues: {},
    health,
    funnels: { onboarding: [], investor: [] },
    topCompanies: [], topInvestors: [], regions: [],
  };
}

let health: unknown = HEALTH_UNKNOWN;

beforeEach(() => {
  health = HEALTH_UNKNOWN;
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.includes("/api/admin/dashboard/kpis")) return jsonResponse(kpis(health));
    if (url.includes("/api/admin/dashboard/activity")) return jsonResponse({ items: [] });
    if (url.includes("/api/admin/companies")) return jsonResponse({ items: [] });
    return jsonResponse({ items: [] });
  });
});

afterEach(() => cleanup());

function mount(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider delayDuration={0}>{node}</TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const TILE_IDS = [
  "card-health-reconcile",
  "card-health-closegate",
  "card-health-dataroom",
  "card-health-msgs",
  "card-health-email",
] as const;

/** Every class token on the `<svg>` inside ONE tile's own icon wrapper. Scoped
 *  by testId; never a document-wide query. */
function iconClassTokens(tileId: string): string[] {
  const wrapper = screen.getByTestId(`${tileId}-icon`);
  const svg = wrapper.querySelector("svg");
  expect(svg, `${tileId}: no <svg> inside the icon wrapper — the extractor is blind, so every other assertion here is void`).toBeTruthy();
  return (svg!.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** The utility classes only. lucide-react prefixes its own `lucide …` tokens;
 *  they are the library's, not the call site's. */
function iconUtilityTokens(tileId: string): string[] {
  return iconClassTokens(tileId).filter((c) => !c.startsWith("lucide"));
}

// ─────────────────────────────────────────────────────────────────────────────
describe("W280 §0 — THE POSITIVE CONTROL, and the over-broad-replace guard", () => {
  /** Class attributes of every `<svg>` inside the health card, and of the svgs
   *  inside the five tile icon wrappers, using the SAME mechanism §1-§4 rely
   *  on. */
  async function healthCardSvgs() {
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-row")).toBeTruthy());
    const card = screen.getByTestId("card-health-row");
    const all = Array.from(card.querySelectorAll("svg")).map((s) => s.getAttribute("class") ?? "");
    const inTiles = TILE_IDS.flatMap((id) =>
      Array.from(screen.getByTestId(`${id}-icon`).querySelectorAll("svg")).map((s) => s.getAttribute("class") ?? ""),
    );
    return { all, inTiles };
  }

  it("§0a POSITIVE CONTROL — the extractor CAN see an emerald class: the health card still contains exactly the one at :565", async () => {
    /* If this ever goes red, §1-§4 prove nothing, because a query that can
       never find emerald anywhere is satisfied by any DOM at all. The header
       shield is decoration on a heading, NOT a state claim on a figure, and
       this wave deliberately leaves it alone. */
    const { all } = await healthCardSvgs();
    const emeraldCarriers = all.filter((c) => /text-emerald/.test(c));
    expect(
      emeraldCarriers.length,
      "No emerald class anywhere in the health card. Either :565 was edited (it must not be) or the class extractor is blind — in both cases every other assertion in this file is void.",
    ).toBeGreaterThanOrEqual(1);
    expect(emeraldCarriers[0]).toContain("text-emerald-600");
  });

  it("§0b the ONLY emerald in the health card is the section header — no TILE icon carries one (stops an over-broad find-and-replace in either direction)", async () => {
    const { all, inTiles } = await healthCardSvgs();
    expect(inTiles.length, "five tile icons expected").toBe(5);
    expect(inTiles.filter((c) => /text-emerald/.test(c))).toEqual([]);
    expect(
      all.filter((c) => /text-emerald/.test(c)).length,
      "exactly one emerald-carrying svg is expected in the health card: the :565 section header. More than one means a tile icon was painted; none means :565 was edited.",
    ).toBe(1);
  });
});

describe("W280 §1 — unknown tone: the green shield is GONE FROM THE DOM, not merely filtered", () => {
  it("the reconcile icon carries no /text-emerald/ token, while the mask and the honest lines all survive", async () => {
    health = HEALTH_UNKNOWN;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile")).toBeTruthy());

    const tokens = iconClassTokens("card-health-reconcile");
    expect(tokens.length, "the icon svg has no classes at all — extractor blind").toBeGreaterThan(0);
    expect(tokens.some((c) => /text-emerald/.test(c))).toBe(false);

    /* Wave 239/240's work is STRENGTHENED, not replaced. All four of its
       honest-absence signals must still be here. */
    expect(screen.getByTestId("card-health-reconcile-icon").className).toContain("grayscale");
    expect(screen.getByTestId("card-health-reconcile-icon").className).toContain("opacity-50");
    expect(screen.getByTestId("card-health-reconcile").className).toContain("border-dashed");
    expect(screen.getByTestId("card-health-reconcile-nodata").textContent).toContain(
      "Not reported — no figure was received for this check, so nothing here is a pass.",
    );
    /* R224.1 / the money rules: an absent figure renders as a dash, NEVER a 0. */
    expect(screen.getByTestId("card-health-reconcile").textContent).toContain("—");
    expect(screen.getByTestId("card-health-reconcile").textContent).not.toContain("0.00%");
  });
});

describe("W280 §2 — ok tone: THE CASE THE MASK NEVER COVERED", () => {
  it("with a real 100% rate the tile is healthy, is NOT masked, and STILL carries no emerald", async () => {
    health = HEALTH_OK;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile").textContent).toContain("100.00%"));

    /* Proof the fixture actually landed on `ok` and not on `unknown` — without
       this, §2 would be §1 wearing a different name (inert-proof mechanism: a
       fixture that cannot distinguish the fix from the defect). */
    expect(screen.getByTestId("card-health-reconcile-icon").className).not.toContain("grayscale");
    expect(screen.getByTestId("card-health-reconcile").className).not.toContain("border-dashed");
    expect(screen.queryByTestId("card-health-reconcile-nodata")).toBeNull();

    expect(iconClassTokens("card-health-reconcile").some((c) => /text-emerald/.test(c))).toBe(false);
  });
});

describe("W280 §3 — warn tone: an amber, breaching tile no longer shows a green tick", () => {
  it("at 91.25% the card and figure are amber, nothing is masked, and the shield carries no emerald", async () => {
    health = HEALTH_WARN;
    mount(<AdminDashboard />);
    await waitFor(() => expect(screen.getByTestId("card-health-reconcile").textContent).toContain("91.25%"));

    const tile = screen.getByTestId("card-health-reconcile");
    expect(tile.className).toContain("bg-amber-50");
    expect(tile.className).toContain("border-amber-200");
    expect(tile.className).not.toContain("border-dashed");
    /* the amber card and the amber figure remain the signal */
    expect(tile.innerHTML).toContain("text-amber-900");
    /* the mask does NOT apply in warn — which is exactly why a class removal,
       and not a wrapper change, was the correct fix */
    expect(screen.getByTestId("card-health-reconcile-icon").className).not.toContain("grayscale");

    expect(iconClassTokens("card-health-reconcile").some((c) => /text-emerald/.test(c))).toBe(false);
  });
});

describe("W280 §4 — POSITIVE EQUALITY: the reconcile icon now matches the four siblings exactly", () => {
  it("all five health-tile icons carry the same utility classes, h-3.5 w-3.5, in every tone", async () => {
    for (const fixture of [HEALTH_UNKNOWN, HEALTH_OK, HEALTH_WARN]) {
      health = fixture;
      mount(<AdminDashboard />);
      await waitFor(() => expect(screen.getByTestId("card-health-reconcile")).toBeTruthy());

      const perTile = TILE_IDS.map((id) => iconUtilityTokens(id));
      /* Positive equality, not just an absence: blanking every className would
         satisfy §1-§3 and must fail here. */
      for (const [i, tokens] of perTile.entries()) {
        expect(tokens, `${TILE_IDS[i]} icon utility classes`).toEqual(["h-3.5", "w-3.5"]);
      }
      /* and the reconcile tile is byte-identical to each sibling */
      for (let i = 1; i < perTile.length; i++) {
        expect(perTile[0]).toEqual(perTile[i]);
      }
      cleanup();
    }
  });
});

describe("W280 §5 — nothing else was touched", () => {
  const DASHBOARD = path.resolve(__dirname, "../Dashboard.tsx");
  const src = () => fs.readFileSync(DASHBOARD, "utf8");

  it("the wave-240 mask, dashed card, slate figure and 'Not reported' sentence are all still in the source", () => {
    const s = src();
    expect(s).toContain('tone === "unknown" ? "grayscale opacity-50" : ""');
    expect(s).toContain('bg-slate-50 border-slate-200 border-dashed');
    expect(s).toContain("Not reported — no figure was received for this check, so nothing here is a pass.");
  });

  it("the wave-240 record of what was done is retired IN PLACE, not deleted (R195.5)", () => {
    /* The comment at :756-767 is the platform's own account of why the mask was
       added and that the literal was left behind. It stays. */
    expect(src()).toContain("hardcoded `text-emerald-600` shield sat above that dash");
  });

  it("the surface-loading indicator at :330 keeps its own emerald tick — it reports a load, not a health verdict", () => {
    expect(src()).toContain('<CheckCircle2 className="h-3 w-3 text-emerald-600" />');
  });

  it("no HealthTile call site carries a colour class any more", () => {
    const callSites = src().split("\n").filter((l) => l.includes("<HealthTile"));
    expect(callSites.length).toBe(5);
    for (const line of callSites) {
      expect(line, `a HealthTile call site still paints its icon: ${line.slice(0, 120)}`).not.toMatch(/text-(emerald|green|amber|red|rose|slate)-/);
    }
  });
});
