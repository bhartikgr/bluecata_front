/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE F · ITEMS 1a, 1b, 1c — THE REAL RENDERED PARTNER DASHBOARD.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER'S THREE COMPLAINTS, IN HIS WORDS:
 *   1a  "make this logo bigger. It's too small and is not good for branding.
 *        This top area could be more 'welcoming' and powerful."
 *   1b  "This band is currently scrolled left/right. It should be placed in a box
 *        and not scrolled."
 *   1c  "This is very boring and plain for any user. It can also be confusing to
 *        follow. Rebrand/redesign this to be more engaging and easier to read."
 *
 * ── WHY THIS FILE IS NEEDED EVEN THOUGH THE GUARD IS GREEN ──────────────────────
 * THE SILENT-DROP GUARD CANNOT PROTECT A STRING ADDED IN THE SAME WAVE. It diffs
 * the tree against a STORED baseline, so every literal this wave introduced is
 * invisible to it: this wave could delete its own welcome lede tomorrow and the
 * gate would still exit 0. Every new sentence, every new attribute and every new
 * pairing built by items 1a/1b/1c is therefore asserted HERE, by rendered text,
 * because nothing else will do it.
 *
 * ── THE INSTRUMENT IS NOT THE PRODUCT ───────────────────────────────────────────
 * Nothing below asserts a variable name, a class string in isolation, or an exit
 * code. Every assertion reads text or structure out of the mounted DOM of the
 * real components, driven through the seams those components already use.
 *
 * ── COPY MUST BE TRUE IN EVERY BRANCH ───────────────────────────────────────────
 * The welcome band was deliberately placed ABOVE the dashboard's loading, error,
 * empty and loaded branches, because it contains no figure that could be wrong
 * while the query is failing. That placement is a claim, so it is tested as one:
 * the band is asserted present on the LOADED branch, on the ERROR branch and on
 * the EMPTY branch. And because a partner may have no recorded name, both title
 * branches are driven — the named one and the nameless one — so neither can be a
 * sentence nobody ever renders.
 *
 * ── NEVER COLOUR ALONE ──────────────────────────────────────────────────────────
 * Item 1c marks eight cards with a group colour. The measured ratios live in the
 * sister file `client/src/styles/__tests__/wf_dashboard_colour_contrast.test.tsx`.
 * What is proved HERE is the non-colour affordance: a card that carries the group
 * ATTRIBUTE must also render the group NAME as text, and the two must agree. A
 * reader who cannot tell four navy depths apart still reads four group names.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

import PartnerDashboard from "../PartnerDashboard";
import { MarketTicker } from "@/components/feeds/MarketTicker";

/* ── harness ─────────────────────────────────────────────────────────────────── */

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
  TierBadge: () => <span />,
  SubRoleBadge: () => <span />,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/comms/MessagesWidget", () => ({
  MessagesWidget: () => <div data-testid="stub-messages" />,
}));
vi.mock("@/components/comms/PostsFeed", () => ({
  PostsFeed: () => <div data-testid="stub-posts" />,
}));
vi.mock("@/components/collective/widgets/VentureMarketsCard", () => ({
  VentureMarketsCard: () => <div data-testid="stub-venture-markets" />,
}));

/** Mutable so a single test can drive the "partner has no recorded name" branch. */
let partnerName: string | null = "Northgate Capital Partners";
vi.mock("@/lib/partner/useRequirePartnerRole", async () => ({
  ...(await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  )),
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_wf",
      tier: "nexus",
      subRole: "managing_partner",
      identity: { userId: "u_wf", email: "wf@example.com", name: partnerName },
    },
  }),
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

/* A LOADED partner: real companies, a three-currency rollup that is never summed,
   deals across stages, real seats, real activity, a real plan. (R15 — a feature
   proved against an empty database is not proved.) */
const SNAPSHOT_LOADED = {
  portfolio: {
    attributedCompanies: 7,
    totalSpvCommittedMinor: null,
    totalFundCommittedMinor: null,
    capitalByCurrency: {
      rows: [
        { currency: "USD", vehicleCount: 3, committedMinor: 25_000_000, spvCommittedMinor: 15_000_000, fundCommittedMinor: 10_000_000, targetMinor: 50_000_000, targetUnknownCount: 0 },
        { currency: "EUR", vehicleCount: 2, committedMinor: 18_000_000, spvCommittedMinor: 18_000_000, fundCommittedMinor: 0, targetMinor: null, targetUnknownCount: 2 },
        { currency: "CAD", vehicleCount: 1, committedMinor: 9_000_000, spvCommittedMinor: 9_000_000, fundCommittedMinor: 0, targetMinor: 25_000_000, targetUnknownCount: 0 },
      ],
      vehiclesWithoutCurrency: 0,
      unavailable: false,
    },
  },
  pipeline: {
    byStage: { invited: 4, viewed: 3, soft_circle: 2, signed: 1, funded: 1, committed: 2 },
    topDeals: [{ id: "pd_1", dealName: "Northwind Robotics", estCheckSizeMinor: 5_000_000, currency: "USD" }],
  },
  recentActivity: [
    { id: "ra_1", activityType: "deal_created", body: "Northwind Robotics added to pipeline", occurredAt: "2026-08-30T10:00:00.000Z" },
  ],
  team: { activeSeats: 4, pendingInvitations: 2, seatLimit: 10 },
  empty: false,
};

const PARTNER_ME = {
  partnerId: "p_wf",
  tier: "nexus",
  status: "active",
  effectivePlan: {
    effectivePrice: { amountMinor: 120_000, currency: "USD", source: "tier_price", billingPeriod: "month" },
    advertisedPrice: { amountMinor: 120_000, currency: "USD", billingPeriod: "month" },
    commission: { rate: 0.05, via: "tier" },
    arrangement: { subscriptionModel: "standard", revShare: { enabled: false } },
    quotaProgress: { metric: "companies_registered", registeredThisPeriod: 3, threshold: 5, period: "quarter", enforcement: "report_only", met: false },
  },
};

type Mode = "loaded" | "empty" | "error";
let mode: Mode = "loaded";

beforeEach(() => {
  mode = "loaded";
  partnerName = "Northgate Capital Partners";
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url === "/api/feature-flags")
      return jsonResponse({ PARTNER_WORKSPACE_ENABLED: true, COLLECTIVE_ADMIN_APPROVAL_ENABLED: true });
    if (url === "/api/partner/me/dashboard") {
      if (mode === "error") throw new Error("dashboard read failed");
      if (mode === "empty")
        return jsonResponse({
          portfolio: { attributedCompanies: 0, totalSpvCommittedMinor: null, totalFundCommittedMinor: null },
          pipeline: { byStage: {}, topDeals: [] },
          recentActivity: [],
          team: { activeSeats: 0, pendingInvitations: 0, seatLimit: 0 },
          empty: true,
        });
      return jsonResponse(SNAPSHOT_LOADED);
    }
    if (url === "/api/partner/me") return jsonResponse(PARTNER_ME);
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

function mount(node: ReactNode): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>, { container: root });
  return root;
}

/* THE WAIT CONDITION IS PART OF THE PROOF, AND THIS FILE GOT IT WRONG ONCE.
   The first version waited for the welcome band. The band renders ABOVE the query
   branches, so it is on screen while the dashboard is still LOADING — the wait
   returned immediately and every card assertion then measured an empty grid and
   reported "no card carries a group attribute". A settle condition that is
   satisfied before the thing under test exists is an inert mechanism: it turns a
   real absence into a false red, and would just as happily turn a real presence
   into a false green. The wait is therefore keyed to a marker that only exists on
   the branch each test is actually about. */
async function mountDashboard(): Promise<HTMLElement> {
  const root = mount(<PartnerDashboard />);
  const settleOn =
    mode === "error" ? "dashboard-error" : mode === "empty" ? "partner-welcome-band" : "card-portfolio";
  await waitFor(() => {
    expect(
      root.querySelector(`[data-testid="${settleOn}"]`),
      `the dashboard never reached its "${mode}" branch`,
    ).not.toBeNull();
  });
  return root;
}

/* ═══════════════════════ ITEM 1a — THE WELCOME BAND ═══════════════════════════ */

describe("WAVE F · item 1a — the top of the dashboard welcomes the partner by name", () => {
  it("R1a-1 the band renders, in order, with the eyebrow, the named title and the lede", async () => {
    const root = await mountDashboard();
    const band = root.querySelector('[data-testid="partner-welcome-band"]')!;

    // PRECONDITION — an empty band would pass a containment assertion vacuously.
    expect((band.textContent ?? "").trim().length).toBeGreaterThan(80);

    expect(root.querySelector('[data-testid="welcome-eyebrow"]')!.textContent).toBe(
      "Consortium Partner workspace",
    );
    // THE NAME COMES FROM THE PARTNER RECORD, not from a string in this file's copy.
    expect(root.querySelector('[data-testid="welcome-partner-name"]')!.textContent).toBe(
      "Northgate Capital Partners",
    );
    expect(root.querySelector('[data-testid="welcome-title"]')!.textContent).toContain("Welcome,");
    expect(root.querySelector('[data-testid="welcome-lede"]')!.textContent).toContain(
      "Everything your firm runs on Capavate, in one place",
    );
    // The band is the FIRST thing in the page body, above every data branch.
    expect(root.firstElementChild!.querySelector('[data-testid="partner-welcome-band"]')).not.toBeNull();
  });

  it("R1a-2 A PARTNER WITH NO RECORDED NAME gets a true sentence, never 'Welcome, undefined'", async () => {
    partnerName = null;
    const root = await mountDashboard();
    expect(root.querySelector('[data-testid="welcome-partner-name"]')).toBeNull();
    const absent = root.querySelector('[data-testid="welcome-name-absent"]')!;
    expect(absent.textContent).toBe("Welcome to your Consortium Partner workspace");
    const title = root.querySelector('[data-testid="welcome-title"]')!.textContent ?? "";
    expect(title).not.toContain("undefined");
    expect(title).not.toContain("null");
    expect(title).not.toMatch(/Welcome,\s*$/);
  });

  it("R1a-3 the band is TRUE IN EVERY BRANCH — it is still there on error and on empty", async () => {
    mode = "error";
    const errRoot = await mountDashboard();
    expect(errRoot.querySelector('[data-testid="dashboard-error"]')).not.toBeNull();
    expect(errRoot.querySelector('[data-testid="welcome-lede"]')).not.toBeNull();
    cleanup();

    mode = "empty";
    const emptyRoot = await mountDashboard();
    expect(emptyRoot.querySelector('[data-testid="welcome-lede"]')).not.toBeNull();
  });

  it("R1a-4 the band states no figure, so nothing in it can be false while the query fails", async () => {
    mode = "error";
    const root = await mountDashboard();
    const text = root.querySelector('[data-testid="partner-welcome-band"]')!.textContent ?? "";
    // No currency symbol, no percentage, no bare quantity.
    expect(text).not.toMatch(/[$€£]|\d+\s*%/);
    expect(text).not.toMatch(/\b\d[\d,.]*\b/);
  });
});

/* ═══════════════════════ ITEM 1b — THE MARKETS BAND ═══════════════════════════ */

describe("WAVE F · item 1b — the markets band is a box, not a horizontal scroller", () => {
  it("R1b-1 the band renders inside a box and the box is NOT horizontally scrollable", () => {
    const root = mount(<MarketTicker />);
    const ticker = root.querySelector('[data-testid="market-ticker"]')!;
    expect(ticker, "the ticker did not render").not.toBeNull();

    const box = root.querySelector('[data-cv-wf="ticker-box"]')!;
    expect(box, "no ticker box").not.toBeNull();

    /* THE DEFECT, STATED AS THE CLASS THAT CAUSED IT. The band scrolled because
       the outer element carried `overflow-x-auto` and its inner row carried
       `min-w-max`, which together force one unbroken line wider than the screen.
       Both are asserted GONE by name — an absence anyone can check. */
    const boxClass = box.getAttribute("class") ?? "";
    expect(boxClass).not.toContain("overflow-x-auto");
    expect(boxClass).not.toContain("overflow-x-scroll");
    expect(root.innerHTML).not.toContain("min-w-max");

    /* AND THE POSITIVE HALF: the rows wrap instead. `flex-wrap` is written in the
       class list AND in the stylesheet on purpose, so the fix does not depend on
       one artefact resolving; the class is what this DOM assertion can see. */
    const rows = root.querySelector('[data-cv-wf="ticker-rows"]')!;
    expect(rows, "no ticker row container").not.toBeNull();
    expect(rows.getAttribute("class") ?? "").toContain("flex-wrap");

    // A BOX HAS PADDING AND SITS INSET — it is not a full-bleed strip any more.
    expect(boxClass).toMatch(/\bpx-3\b/);
    expect(boxClass).toMatch(/\bpy-2\b/);
    expect(boxClass).toMatch(/\bmx-3\b/);
    // The fixed 32px height that clipped a wrapped second row is gone.
    expect(boxClass).not.toMatch(/\bh-8\b/);
  });

  it("R1b-2 THE HONESTY STATES SURVIVED THE RESHAPE — the band never invents a number", () => {
    const root = mount(<MarketTicker />);
    /* Exactly one of the band's states is on screen at a time, and every one of
       them is either real data or a plain statement that there is none. What must
       never happen is a rendered figure with no source, so the assertion is that
       SOME state rendered and that the accessible label survived. */
    const ticker = root.querySelector('[data-testid="market-ticker"]')!;
    expect(ticker.getAttribute("aria-label")).toBeTruthy();
    const states = [
      "ticker-capavate-pulse",
      "ticker-provider-unavailable",
      "ticker-provider-unavailable-member",
      "ticker-feed-silent",
    ];
    const present = states.filter((s) => root.querySelector(`[data-testid="${s}"]`) !== null);
    const tiles = root.querySelectorAll('[data-testid^="ticker-tile-"]').length;
    expect(present.length + tiles, "the band rendered nothing at all").toBeGreaterThan(0);
  });
});

/* ═══════════════════════ ITEM 1c — FOUR READING GROUPS ════════════════════════ */

/** The four group names, READ FROM THE RENDERED PAGE rather than copied here. */
const GROUP_KEYS = ["capital", "work", "firm", "market"] as const;

describe("WAVE F · item 1c — eight cards, four named groups, never colour alone", () => {
  it("R1c-1 every card carrying a group ATTRIBUTE also renders the group NAME as text", async () => {
    const root = await mountDashboard();
    const marked = Array.from(root.querySelectorAll("[data-cv-dash-group]"));

    // PRECONDITION — no cards marked means the pairing rule is vacuous.
    expect(marked.length, "no card carries a group attribute").toBeGreaterThan(0);

    for (const card of marked) {
      const group = card.getAttribute("data-cv-dash-group")!;
      expect(GROUP_KEYS as readonly string[]).toContain(group);

      const label = card.querySelector(`[data-cv-dash-group-label="${group}"]`);
      expect(
        label,
        `card ${card.getAttribute("data-testid")} is coloured for "${group}" but renders no label`,
      ).not.toBeNull();
      // THE LABEL IS REAL TEXT, not an empty element with an attribute on it.
      expect((label!.textContent ?? "").trim().length).toBeGreaterThan(2);
    }
  });

  it("R1c-2 the same group always renders the same words, and the four groups are distinct", async () => {
    const root = await mountDashboard();
    const byGroup = new Map<string, Set<string>>();
    for (const el of Array.from(root.querySelectorAll("[data-cv-dash-group-label]"))) {
      const g = el.getAttribute("data-cv-dash-group-label")!;
      if (!byGroup.has(g)) byGroup.set(g, new Set());
      byGroup.get(g)!.add((el.textContent ?? "").trim());
    }
    expect(byGroup.size, "fewer than two groups rendered").toBeGreaterThan(1);
    // One group, one wording.
    for (const [g, texts] of byGroup) {
      expect(Array.from(texts).length, `group "${g}" renders more than one wording`).toBe(1);
    }
    // Different groups, different wordings — otherwise the grouping says nothing.
    const wordings = Array.from(byGroup.values()).map((s) => Array.from(s)[0]);
    expect(new Set(wordings).size).toBe(wordings.length);
  });

  it("R1c-3 THE COPY THIS WAVE ADDED IS ASSERTED HERE, because the guard cannot see it", async () => {
    const root = await mountDashboard();
    const page = root.textContent ?? "";
    /* Every group name introduced by item 1c. The silent-drop guard diffs against
       a stored baseline and is therefore blind to all four; if this wave deleted
       one tomorrow the gate would still exit 0. These four lines are the only
       thing standing between that and a silent regression. */
    for (const words of ["Your capital", "Your work", "Your firm", "Markets and network"]) {
      expect(page, `group label "${words}" is no longer rendered`).toContain(words);
    }
    // And the two sentences item 1a added.
    expect(page).toContain("Consortium Partner workspace");
    expect(page).toContain("Everything your firm runs on Capavate, in one place");
  });

  it("R1c-4 the redesign did not disturb the portfolio card's honesty branches", async () => {
    const root = await mountDashboard();
    /* WAVE 115/178/283 exist because redesign-shaped changes to this card once
       printed a fabricated $0.00. The per-currency rollup must still be three
       separate currencies with no combined total anywhere on the card. */
    const card = root.querySelector('[data-testid="card-portfolio"]')!;
    const text = card.textContent ?? "";
    for (const ccy of ["USD", "EUR", "CAD"]) expect(text).toContain(ccy);
    expect(root.querySelector('[data-testid="kpi-by-currency"]')).not.toBeNull();
    // No single "total" figure that could only exist by converting between them.
    expect(text).not.toMatch(/total\s*:?\s*[$€£]/i);
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ITEM 1a · THE LOGO ITSELF — AND AN HONEST STATEMENT OF WHAT IS PROVED HERE
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner's first sentence was about the logo: "make this logo bigger."
 * That change is in `client/src/components/CollectiveShell.tsx`, not on the
 * dashboard page, and it is a Tailwind utility class on an <img>.
 *
 * WHAT THIS BLOCK PROVES: that the class is what this wave says it is, in the
 * real file, and that the geometry claimed for the decision is arithmetically
 * true. WHAT IT DOES NOT PROVE: a rendered pixel height. jsdom applies no
 * Tailwind stylesheet, so `getComputedStyle(img).height` is empty whatever the
 * class says; asserting it would be asserting nothing while looking rigorous.
 * The honest form of the claim is the one made below, and the limit is stated
 * rather than hidden.
 */
describe("WAVE F · item 1a — the logo, and the size decision behind it", () => {
  const SHELL = readFileSync(resolve(HERE, "..", "..", "..", "components", "CollectiveShell.tsx"), "utf8");

  it("R1a-5 the logo is set at h-9, and the OLD h-6 is gone from the brand lockup", () => {
    /* The single CapavateLogo in the brand head. If a future edit adds a second
       one this assertion reddens rather than silently measuring the wrong one. */
    const matches = SHELL.match(/<CapavateLogo\s+className="([^"]+)"/g) ?? [];
    expect(matches.length, "expected exactly one CapavateLogo in the shell").toBe(1);
    expect(matches[0]).toContain("h-9");
    expect(matches[0]).not.toContain("h-6");
    expect(matches[0]).toContain("w-auto"); // aspect ratio preserved, never stretched
  });

  it("R1a-6 the brand block was given room to breathe, not just a bigger image", () => {
    // A bigger logo in the same cramped box reads as an accident, not branding.
    expect(SHELL).toContain('data-testid="brand-product-label"');
    expect(SHELL).toMatch(/py-5/);
    expect(SHELL).not.toMatch(/<CapavateLogo[^>]*h-12/);
  });

  it("R1a-7 h-9 IS THE LARGEST SIZE THAT FITS — the rejected option is shown to not fit", () => {
    /* THE ARITHMETIC OF THE DECISION, ASSERTED SO IT CANNOT BE MISREMEMBERED.
       The asset is 362x128, i.e. 2.83:1. The mobile rail is Tailwind `w-56`
       = 224px, and it also carries a close button. At h-9 (36px) the logo is
       102px wide and leaves 122px; at h-12 (48px) it is 136px and leaves 88px,
       which crowds the close control. h-9 is therefore the largest step that
       still fits, which is why it was chosen over h-12. */
    const ASSET_W = 362;
    const ASSET_H = 128;
    const RAIL_PX = 224; // w-56
    const widthAt = (h: number) => Math.round((ASSET_W / ASSET_H) * h);
    expect(widthAt(36)).toBeLessThan(RAIL_PX / 2 + 12);
    expect(widthAt(48)).toBeGreaterThan(RAIL_PX / 2 + 12);
    expect(SHELL).toContain("w-56");
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STYLING HOOKS — ADDED BECAUSE THE DISARM PASS WENT GREEN WITHOUT THEM.
 * ─────────────────────────────────────────────────────────────────────────────
 * The disarm pass renamed `data-cv-wf="welcome-lede"` and
 * `data-cv-wf="dash-group-label"` and EVERY TEST IN THIS FILE STILL PASSED. The
 * text was untouched, so the assertions about text were right to pass — but the
 * whole of the stylesheet reaches these elements through those attributes and
 * nothing else. Rename one and the colour, the uppercase setting and the
 * leading-edge rule all silently vanish while the words stay put: a fix that
 * looks present and is inert, which is precisely the failure mode this brief
 * says to assume. The GREEN was a real finding about these tests, not about the
 * build, and this block is the repair. It is kept separate and labelled so the
 * history is visible rather than tidied away.
 */
describe("WAVE F · the CSS can actually reach what it styles", () => {
  it("R1c-5 every element the stylesheet targets carries the hook the stylesheet selects on", async () => {
    const root = await mountDashboard();

    const lede = root.querySelector('[data-testid="welcome-lede"]');
    expect(lede, "the welcome lede did not render").not.toBeNull();
    expect(
      lede!.getAttribute("data-cv-wf"),
      "the lede lost its styling hook — the stylesheet can no longer reach it",
    ).toBe("welcome-lede");

    for (const [testid, hook] of [
      ["welcome-eyebrow", "welcome-eyebrow"],
      ["welcome-title", "welcome-title"],
    ] as Array<[string, string]>) {
      const el = root.querySelector(`[data-testid="${testid}"]`);
      expect(el, `${testid} did not render`).not.toBeNull();
      expect(el!.getAttribute("data-cv-wf"), `${testid} lost its styling hook`).toBe(hook);
    }

    const band = root.querySelector('[data-testid="partner-welcome-band"]')!;
    expect(band.getAttribute("data-cv-wf")).toBe("welcome");

    const labels = Array.from(root.querySelectorAll("[data-cv-dash-group-label]"));
    expect(labels.length, "no group labels rendered").toBeGreaterThan(0);
    for (const el of labels) {
      expect(
        el.getAttribute("data-cv-wf"),
        `a group label lost its styling hook, so its colour is inert: ${el.textContent}`,
      ).toBe("dash-group-label");
    }
  });

  it("R1c-6 every card that renders a group NAME also carries the group ATTRIBUTE the colour keys on", async () => {
    const root = await mountDashboard();
    const labels = Array.from(root.querySelectorAll("[data-cv-dash-group-label]"));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const group = label.getAttribute("data-cv-dash-group-label")!;
      const card = label.closest("[data-cv-dash-group]");
      expect(
        card,
        `the "${label.textContent}" label is not inside any card carrying data-cv-dash-group`,
      ).not.toBeNull();
      expect(card!.getAttribute("data-cv-dash-group")).toBe(group);
    }
  });
});
