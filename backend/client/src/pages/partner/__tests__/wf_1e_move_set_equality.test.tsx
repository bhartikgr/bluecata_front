/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE F · ITEM 1e — THE TWO ADMIN BOXES WERE MOVED, NOT DROPPED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER'S WORDS. The plan card and the recent-activity card should sit at the
 * BOTTOM of the dashboard's content section, "maybe even displayed in two columns
 * rather than two big rows".
 *
 * WHY THIS FILE EXISTS AT ALL. "I relocated it" is not a claim about a diff. It is
 * a claim about REACHABILITY: after the move, is the panel still on the page? And
 * reachability is a SET, not a count and not a line number. A move that deletes
 * one card and duplicates another keeps the count identical. A move that leaves a
 * card inside a branch that no longer renders keeps the SOURCE identical. Only an
 * enumeration of what the real component actually renders, compared as a set
 * against the same enumeration taken from the pre-move source, can tell a move
 * apart from a drop.
 *
 * ── HOW THE "BEFORE" SIDE IS OBTAINED ───────────────────────────────────────────
 * Not from memory, and not from a list typed into this file. This wave took a byte
 * copy of PartnerDashboard.tsx BEFORE any edit, at
 *   build_log/walkthroughF/backup/client_src_pages_partner_PartnerDashboard.tsx
 * with its sha256 recorded in WF_BACKUP.sha256. R-0 below re-hashes that file and
 * refuses to continue unless it matches, so a silently altered backup cannot
 * launder a bad result. The BEFORE set is then extracted from that real pre-move
 * source, and the AFTER set is extracted from the real rendered DOM of the real
 * component driven by realistic data.
 *
 * ── THE CONTROL (the part that makes the green mean something) ──────────────────
 * A set-equality assertion that would pass anyway proves nothing. R-4 therefore
 * MANUFACTURES THE FAILURE THIS FILE IS SUPPOSED TO CATCH: it takes the rendered
 * AFTER set, removes the very testids item 1e moved, and asserts that the same
 * comparison then FAILS. If the comparison cannot fail, it cannot pass
 * meaningfully. R-5 does the mirror image and shows the extractor is not simply
 * returning everything it is given.
 *
 * ── BOTH SIDES NON-EMPTY ────────────────────────────────────────────────────────
 * Every set assertion below is preceded by a non-empty precondition. Two empty
 * sets are equal, and that equality is the classic way a move proof passes while
 * the page renders nothing at all.
 *
 * ── NOT A REPLICA ───────────────────────────────────────────────────────────────
 * Nothing here reimplements the dashboard. The card list is not written down; it
 * is READ, from the pre-move file on one side and from the mounted component on
 * the other.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PartnerDashboard from "../PartnerDashboard";

/* The pre-move byte copy and the hash recorded when it was taken. */
const BACKUP_PATH = resolve(
  process.cwd(),
  "../build_log/walkthroughF/backup/client_src_pages_partner_PartnerDashboard.tsx",
);
const BACKUP_PATH_ALT = resolve(
  process.cwd(),
  "build_log/walkthroughF/backup/client_src_pages_partner_PartnerDashboard.tsx",
);
const BACKUP_SHA = "9523571c5b1dc999d42d3cadd22d6bb3f030b7b3b8c2fe42822c76a1fec72cfb";

function readBackup(): string {
  for (const p of [BACKUP_PATH, BACKUP_PATH_ALT]) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("pre-move byte copy of PartnerDashboard.tsx not found");
}

/** Every `data-testid="card-…"` literal in a source file, as a set. */
function cardTestidsInSource(src: string): string[] {
  const out = new Set<string>();
  const re = /data-testid="(card-[a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return Array.from(out).sort();
}

/** Every `card-…` testid actually PRESENT IN THE RENDERED DOM, as a set. */
function cardTestidsInDom(root: ParentNode): string[] {
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("[data-testid]"))) {
    const id = el.getAttribute("data-testid") ?? "";
    if (/^card-[a-z0-9-]+$/.test(id)) out.add(id);
  }
  return Array.from(out).sort();
}

/* ── harness ─────────────────────────────────────────────────────────────────── */

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  TierBadge: () => <span />,
  SubRoleBadge: () => <span />,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
/* The real module's OTHER exports are spread back in, so this mock replaces only
   the hook and never silently removes a helper the page calls (`tierAtLeast`,
   `isManagingPartner`). A mock that drops an export is its own inert mechanism. */
vi.mock("@/lib/partner/useRequirePartnerRole", async () => ({
  ...(await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  )),
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_wf",
      /* NEXUS ON PURPOSE, AND THIS WAS FOUND BY THIS FILE'S OWN RED. The first
         run of R-1 reported `card-cross-portfolio` missing. It is not missing:
         it is wrapped in `tierAtLeast(role.identity.tier, "nexus")`, and the
         fixture was on `builder`, so the tier gate hid it. Excusing the card
         would have made the comparison weaker for every future wave. Raising the
         fixture to the top tier makes the AFTER set MAXIMAL instead — every card
         this page can render is on screen, so the set equality below is the
         strongest form of the claim rather than the most convenient one. */
      tier: "nexus",
      subRole: "managing_partner",
      identity: { userId: "u_wf", email: "wf@example.com", name: "Northgate Capital Partners" },
    },
  }),
}));
/* The two comms widgets and the markets card own their own queries and their own
   testids. They are stubbed so this file measures THE CARDS THIS PAGE RENDERS,
   which is exactly the set item 1e could have damaged. */
vi.mock("@/components/comms/MessagesWidget", () => ({
  MessagesWidget: () => <div data-testid="stub-messages" />,
}));
vi.mock("@/components/comms/PostsFeed", () => ({
  PostsFeed: () => <div data-testid="stub-posts" />,
}));
vi.mock("@/components/collective/widgets/VentureMarketsCard", () => ({
  VentureMarketsCard: () => <div data-testid="card-venture-markets" />,
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/* ── REALISTIC SEED (R15: the partner tables are empty in this tree) ───────────
   A LOADED dashboard: attributed companies, a per-currency capital rollup in
   THREE currencies that is never summed, deals in several stages, real seats,
   real activity, and a real effective plan. `empty: false` matters — the moved
   cards must be proved present on the branch a working partner actually sees. */
const SNAPSHOT = {
  portfolio: {
    attributedCompanies: 7,
    totalSpvCommittedMinor: null,
    totalFundCommittedMinor: null,
    capitalByCurrency: {
      rows: [
        { currency: "USD", vehicleCount: 3, committedMinor: 250_000_00, spvCommittedMinor: 150_000_00, fundCommittedMinor: 100_000_00, targetMinor: 500_000_00, targetUnknownCount: 0 },
        { currency: "EUR", vehicleCount: 2, committedMinor: 180_000_00, spvCommittedMinor: 180_000_00, fundCommittedMinor: 0, targetMinor: null, targetUnknownCount: 2 },
        { currency: "CAD", vehicleCount: 1, committedMinor: 90_000_00, spvCommittedMinor: 90_000_00, fundCommittedMinor: 0, targetMinor: 250_000_00, targetUnknownCount: 0 },
      ],
      vehiclesWithoutCurrency: 0,
      unavailable: false,
    },
  },
  pipeline: {
    byStage: { invited: 4, viewed: 3, soft_circle: 2, signed: 1, funded: 1, committed: 2 },
    topDeals: [
      { id: "pd_1", dealName: "Northwind Robotics", estCheckSizeMinor: 5_000_000, currency: "USD" },
      { id: "pd_2", dealName: "Halden Bio", estCheckSizeMinor: 2_500_000, currency: "EUR" },
    ],
  },
  recentActivity: [
    { id: "ra_1", activityType: "deal_created", body: "Northwind Robotics added to pipeline", occurredAt: "2026-08-30T10:00:00.000Z" },
    { id: "ra_2", activityType: "invite_sent", body: "Seat invitation sent to analyst@northgate.test", occurredAt: "2026-08-29T09:15:00.000Z" },
  ],
  team: { activeSeats: 4, pendingInvitations: 2, seatLimit: 10 },
  empty: false,
};

const PARTNER_ME = {
  partnerId: "p_wf",
  tier: "builder",
  status: "active",
  effectivePlan: {
    effectivePrice: { amountMinor: 1_200_00, currency: "USD", source: "tier_price", billingPeriod: "month" },
    advertisedPrice: { amountMinor: 1_200_00, currency: "USD", billingPeriod: "month" },
    commission: { rate: 0.05, via: "tier" },
    arrangement: { subscriptionModel: "standard", revShare: { enabled: false } },
    quotaProgress: {
      metric: "companies_registered",
      registeredThisPeriod: 3,
      threshold: 5,
      period: "quarter",
      enforcement: "report_only",
      met: false,
    },
  },
};

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/feature-flags")
      return jsonResponse({ PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: true });
    if (url === "/api/partner/me/dashboard") return jsonResponse(SNAPSHOT);
    if (url === "/api/partner/me") return jsonResponse(PARTNER_ME);
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

async function mountDashboard(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerDashboard />
    </QueryClientProvider>,
    { container: root },
  );
  await waitFor(() => {
    expect(root.querySelector('[data-testid="card-portfolio"]')).not.toBeNull();
  });
  return root;
}

/* ── the proof ───────────────────────────────────────────────────────────────── */

/** The testids item 1e actually moved. Named once, used by the assertions AND by
 *  the control, so the control cannot drift away from the claim. */
const MOVED = ["card-plan", "card-plan-unavailable", "card-recent"];

describe("WAVE F · item 1e — the admin boxes moved to the bottom, in two columns", () => {
  it("R-0 PRECONDITIONS — the pre-move byte copy is the one whose hash was recorded", () => {
    const src = readBackup();
    const sha = createHash("sha256").update(src, "utf8").digest("hex");
    expect(sha, "the pre-move backup does not match the hash recorded in WF_BACKUP.sha256").toBe(
      BACKUP_SHA,
    );
    expect(src.length).toBeGreaterThan(20_000);
    // The pre-move file really did contain the cards this item claims to move.
    for (const id of MOVED) expect(src).toContain(`data-testid="${id}"`);
  });

  it("R-1 BOTH SIDES NON-EMPTY, AND EQUAL — every card in the pre-move source is still rendered", async () => {
    const before = cardTestidsInSource(readBackup());
    const root = await mountDashboard();
    const after = cardTestidsInDom(root);

    // Neither side may be empty. Two empty sets are equal.
    expect(before.length, "the BEFORE set is empty").toBeGreaterThan(0);
    expect(after.length, "the AFTER set is empty — the page rendered no cards").toBeGreaterThan(0);

    /* `card-plan` and `card-plan-unavailable` are mutually exclusive branches, and
       `card-venture-markets` is stubbed in from another file, so the honest
       comparison is: every card the pre-move SOURCE declares is either rendered
       now, or is the alternative branch of one that is. Stated as a rule, not a
       number (R9). */
    const missing = before.filter((id) => !after.includes(id));
    const branchPairs: Array<[string, string]> = [["card-plan", "card-plan-unavailable"]];
    const excusable = new Set<string>();
    for (const [a, b] of branchPairs) {
      if (after.includes(a)) excusable.add(b);
      if (after.includes(b)) excusable.add(a);
    }
    expect(
      missing.filter((id) => !excusable.has(id)),
      "cards present before the move that are no longer reachable after it",
    ).toEqual([]);
  });

  it("R-2 THE MOVED CARDS ARE STILL ON THE PAGE — set equality on the moved subset", async () => {
    const root = await mountDashboard();
    const after = cardTestidsInDom(root);
    const movedStillPresent = MOVED.filter((id) => after.includes(id)).sort();

    expect(movedStillPresent.length, "none of the moved cards rendered").toBeGreaterThan(0);
    /* Exactly one of the two plan branches renders, plus the activity card. */
    expect(movedStillPresent).toEqual(
      MOVED.filter((id) => id !== (after.includes("card-plan") ? "card-plan-unavailable" : "card-plan")).sort(),
    );
  });

  it("R-3 THEY ARE AT THE BOTTOM, INSIDE THE TWO-COLUMN WRAPPER — position and shape", async () => {
    const root = await mountDashboard();
    const wrapper = root.querySelector('[data-testid="card-admin-columns"]');
    expect(wrapper, "the two-column wrapper is not on the page").not.toBeNull();

    // Every moved card that renders is INSIDE the wrapper, not merely on the page.
    for (const id of MOVED) {
      const el = root.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      expect(wrapper!.contains(el), `${id} rendered outside the two-column wrapper`).toBe(true);
    }

    // TWO COLUMNS, asserted on the class the wrapper actually carries.
    expect(wrapper!.getAttribute("class") ?? "").toContain("lg:grid-cols-2");

    /* BOTTOM: no other card in the grid follows the wrapper in document order. */
    const grid = wrapper!.parentElement!;
    const cardsInGrid = Array.from(grid.children).filter((c) =>
      /^card-[a-z0-9-]+$/.test(c.getAttribute("data-testid") ?? "") ||
      c.getAttribute("data-testid") === "card-admin-columns",
    );
    expect(cardsInGrid.length, "no cards found in the grid").toBeGreaterThan(1);
    expect(cardsInGrid[cardsInGrid.length - 1]).toBe(wrapper);
  });

  it("R-4 CONTROL — the SAME comparison FAILS when the moved cards are taken away", async () => {
    const before = cardTestidsInSource(readBackup());
    const root = await mountDashboard();
    const real = cardTestidsInDom(root);

    // Manufacture the exact defect this file exists to catch: a move that dropped.
    const sabotaged = real.filter((id) => !MOVED.includes(id));
    expect(sabotaged.length, "the sabotaged set is empty — the control proves nothing").toBeGreaterThan(0);
    expect(sabotaged.length).toBeLessThan(real.length);

    const missing = before.filter((id) => !sabotaged.includes(id));
    /* THE POINT: with the moved cards removed, the comparison used by R-1 reports
       a genuine loss. A comparison that cannot fail cannot pass meaningfully. */
    expect(missing.length, "the comparison did NOT notice the removal — it is inert").toBeGreaterThan(0);
    expect(missing).toContain("card-recent");
    expect(missing.some((id) => id === "card-plan" || id === "card-plan-unavailable")).toBe(true);
  });

  it("R-5 CONTROL — the extractors are not returning everything handed to them", async () => {
    const root = await mountDashboard();
    const cards = cardTestidsInDom(root);
    const allTestids = Array.from(root.querySelectorAll("[data-testid]")).map((e) =>
      e.getAttribute("data-testid"),
    );
    expect(allTestids.length).toBeGreaterThan(cards.length);
    // A testid that is NOT a card must not appear in the card set.
    expect(cards).not.toContain("kpi-companies");
    expect(cards).not.toContain("card-admin-columns-not-a-real-id");
    // And the source extractor must reject a plain string that merely mentions one.
    expect(cardTestidsInSource('const s = "card-plan";')).toEqual([]);
    expect(cardTestidsInSource('<div data-testid="card-plan" />')).toEqual(["card-plan"]);
  });
});
