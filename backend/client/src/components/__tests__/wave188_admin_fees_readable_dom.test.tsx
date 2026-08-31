/**
 * WAVE 188 · R159.3 — THE FEES ADMIN SCREEN, PROVEN ON RENDERED DOM.
 *
 * R159.3 corrects R158.1. R158.1 told the owner to "just set a per-tier price here."
 * They could not, and the reason was not the data gap — it was that the surface was
 * unreadable. So the acceptance criterion for this wave is not "the code is
 * correct", it is "a non-technical owner can read and use the result". These tests
 * therefore assert RENDERED SENTENCES, not internal state.
 *
 * THE OWNER'S FOUR REQUESTS, AND WHERE EACH IS PROVEN BELOW:
 *   A  "How can I mute 'tiers' so that I only have one tier for all consortium
 *      partners?"                                            → sections 2 and 3
 *   B  "Is there a better way for me to see the 'Tier slug'? Maybe a dynamic
 *      dropdown? I have no idea how to actually read this or what the figures
 *      are."                                                 → sections 1, 4, 5
 *   C  "I don't want to have 'monthly' at this point (although it should be an
 *      option on the platform). I want annual fees."         → section 6
 *   D  "The above tabs should be better organized/categorized so that the admin
 *      can navigate more easily."                            → sections 7 and 8
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED HERE: no test in this file writes to the
 * database or exercises a charge path. The store-level proof that no displayed or
 * authoritative fee moves when single-tier mode is on lives in the functional store
 * probe (build_log/wave188/w188_store_probe.mts), which compares every fee on both
 * sides byte-for-byte with the mode off and on. Splitting it that way is deliberate:
 * a DOM test that also claimed to prove amounts do not move would be proving it
 * against a fixture it wrote itself.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* ════════════════════════════════════════════════════════════════════════════
   FIXTURES — the five REAL tiers, as `partner_tier_lifecycle` actually holds them.
   Verified against the live data.db during preflight (W188_PREFLIGHT.md): five
   rows, all `active`, all carrying a human `display_name`.
   ════════════════════════════════════════════════════════════════════════════ */
const REAL_TIERS = [
  { slug: "catalyst", label: "Catalyst", labelIsFallback: false, state: "active" },
  { slug: "builder", label: "Builder", labelIsFallback: false, state: "active" },
  { slug: "amplifier", label: "Amplifier", labelIsFallback: false, state: "active" },
  { slug: "nexus", label: "Nexus", labelIsFallback: false, state: "active" },
  { slug: "founding_member", label: "Founding Member", labelIsFallback: false, state: "active" },
];

/** A tier with NO display name on record — the case Item B req 1 governs: show the
 *  slug plus a stated fallback, never a blank and never an invented name. */
const NAMELESS_TIER = { slug: "orphan_tier", label: "orphan_tier", labelIsFallback: true, state: "active" };

let policyResponse: unknown;
let offerResponse: unknown;
let repointResponse: unknown;
let schedulesResponse: unknown;

/* `useAdminQuery` reads through `apiRequest`, so mocking that one function is
   enough to drive every panel on the page from fixtures. */
vi.mock("@/lib/queryClient", () => {
  const client = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  };
  return {
    queryClient: client,
    apiRequest: vi.fn(async (_method: string, url: string) => {
      const body =
        url.startsWith("/api/admin/fee-admin-display-policy")
          ? policyResponse
          : url.startsWith("/api/admin/billing-period-offer")
            ? offerResponse
            : url.startsWith("/api/admin/pricing-console/repoint")
              ? repointResponse
              : url.startsWith("/api/admin/partner-fee-schedules")
                ? schedulesResponse
                : {};
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
    getQueryFn: () => async () => ({}),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* WAVE 207 · ITEM A — the shared constants BOTH the admin screen and the
   partner-facing schedule import, so this test cannot drift from the copy. */
import {
  W207_VEHICLE_FEE_WHEN,
  W207_VEHICLE_FEE_BASIS,
  LEGACY_CAPITAL_BASIS_DIMENSION,
} from "@shared/wave207FeeBasisDimension";
import {
  W188SingleTierModeCard,
  W188BillingPeriodOfferCard,
  W188FeeRowExplanation,
  tierChoiceLabel,
  buildTabNavItems,
  parseAdminFeesTabParam,
  TAB_GROUPS,
  TABS,
  W188_FEE_KIND_WHEN,
  W188_FEE_KIND_BASIS,
} from "@/pages/admin/AdminFeesConsolidated";

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  policyResponse = {
    ok: true,
    policy: {
      singleTierMode: false,
      canonicalTierSlug: null,
      canonicalTierLabel: null,
      refusal: null,
      updatedAt: null,
      updatedBy: null,
      notes: null,
      tiers: REAL_TIERS,
      offeredTiers: REAL_TIERS,
    },
  };
  offerResponse = {
    ok: true,
    offer: {
      annualOffered: true,
      monthlyOffered: false,
      model: "flat_annual",
      forbidX12Derivation: true,
      updatedAt: null,
      updatedBy: null,
      notes: null,
    },
  };
  repointResponse = { ok: true, rows: [], secondTablePurpose: "" };
  schedulesResponse = { ok: true, schedules: [], total: 0 };
});

afterEach(() => cleanup());

/* ════════════════════════════════════════════════════════════════════════════
   1. ITEM B req 1 — THE DROPDOWN LISTS REAL TIERS, WITH HUMAN LABELS.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item B — the dropdown lists real tiers", () => {
  it("offers every real tier by its HUMAN NAME, not its slug", async () => {
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const select = await screen.findByTestId("select-w188-canonical-tier");
    const opts = within(select).getAllByRole("option");

    /* Five real tiers plus the explicit "choose one" placeholder. The placeholder
       matters: without it the platform would appear to have chosen a tier for the
       owner, and R156.2 forbids the platform picking a pricing fact. */
    expect(opts).toHaveLength(REAL_TIERS.length + 1);
    for (const t of REAL_TIERS) {
      const opt = within(select).getByTestId(`option-w188-canonical-${t.slug}`);
      expect(opt.textContent).toBe(t.label);
      /* The VALUE is still the slug — the wire format did not change, only what a
         human reads. This is what makes Item B "strictly a UI fix". */
      expect((opt as HTMLOptionElement).value).toBe(t.slug);
    }
  });

  it("shows a tier with NO display name as its slug PLUS a stated fallback — never blank, never invented", async () => {
    policyResponse = {
      ok: true,
      policy: {
        ...(policyResponse as { policy: Record<string, unknown> }).policy,
        tiers: [...REAL_TIERS, NAMELESS_TIER],
        offeredTiers: [...REAL_TIERS, NAMELESS_TIER],
      },
    };
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const opt = await screen.findByTestId("option-w188-canonical-orphan_tier");
    expect(opt.textContent).toBe("orphan_tier (no display name on record)");
    /* The two failure modes Item B req 1 names, asserted as the negatives they are. */
    expect(opt.textContent).not.toBe("");
    expect(opt.textContent).toContain("orphan_tier");
  });

  it("tierChoiceLabel NEVER returns an empty string, for any tier shape", () => {
    for (const t of [...REAL_TIERS, NAMELESS_TIER]) {
      expect(tierChoiceLabel(t).trim().length).toBeGreaterThan(0);
    }
    /* A tier whose display name is literally blank still cannot render blank. */
    expect(
      tierChoiceLabel({ slug: "blank_one", label: "", labelIsFallback: true, state: "active" }).trim().length,
    ).toBeGreaterThan(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. ITEM A — SINGLE-TIER MODE APPLIES ONE TIER, AND SAYS SO IN WORDS.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item A — one tier for all consortium partners", () => {
  it("OFF: says all five tiers are offered", async () => {
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const state = await screen.findByTestId("state-w188-single-tier");
    expect(state.textContent).toContain("all 5 tiers are offered");
    const sw = screen.getByTestId("switch-w188-single-tier-mode");
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });

  it("ON: exactly one tier is offered, and the screen states the others STILL EXIST", async () => {
    policyResponse = {
      ok: true,
      policy: {
        singleTierMode: true,
        canonicalTierSlug: "builder",
        canonicalTierLabel: "Builder",
        refusal: null,
        updatedAt: "2026-08-28T00:00:00.000Z",
        updatedBy: "owner",
        notes: null,
        tiers: REAL_TIERS,
        offeredTiers: [REAL_TIERS[1]],
      },
    };
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const state = await screen.findByTestId("state-w188-single-tier");
    expect(state.textContent).toContain("only Builder is offered");
    /* THE "MUTE, NEVER DELETE" GUARANTEE, RENDERED. The owner's standing rule is
       "I'd rather add than delete", so the screen has to say out loud that the
       other four survive — otherwise muting LOOKS like deleting. */
    expect(state.textContent).toContain("The other 4 tiers still exist and are untouched");
    expect(screen.getByTestId("switch-w188-single-tier-mode").getAttribute("data-state")).toBe("checked");
  });

  it("is REVERSIBLE FROM THE UI: the off switch and the full tier list are both still present while the mode is on", async () => {
    policyResponse = {
      ok: true,
      policy: {
        singleTierMode: true,
        canonicalTierSlug: "builder",
        canonicalTierLabel: "Builder",
        refusal: null,
        updatedAt: null,
        updatedBy: null,
        notes: null,
        tiers: REAL_TIERS,
        offeredTiers: [REAL_TIERS[1]],
      },
    };
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    /* The way back must be visible, not merely possible: the switch that turns it
       off is rendered and enabled, and the chooser still lists all five so the
       owner can change their mind without first turning the mode off. */
    const sw = await screen.findByTestId("switch-w188-single-tier-mode");
    /* `toBeDisabled` is a jest-dom matcher and this suite runs without jest-dom,
       so the disabled state is read off the DOM directly. Radix's Switch renders a
       real <button>, which exposes both `disabled` and `data-disabled`. */
    expect((sw as HTMLButtonElement).disabled).toBe(false);
    expect(sw.getAttribute("data-disabled")).toBeNull();
    const select = screen.getByTestId("select-w188-canonical-tier");
    expect(within(select).getAllByRole("option")).toHaveLength(REAL_TIERS.length + 1);
    /* And the help text promises the reversal in plain words. */
    expect(screen.getByTestId("help-w188-single-tier").textContent).toContain(
      "Turn it off to see all of them again",
    );
  });

  it("NEVER hardcodes a tier: nothing is preselected when no canonical tier is chosen", async () => {
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const select = (await screen.findByTestId("select-w188-canonical-tier")) as HTMLSelectElement;
    /* R156.2 — the platform names the missing fact instead of substituting one.
       An empty value here is the refusal, made visible. */
    expect(select.value).toBe("");
    expect(screen.getByTestId("help-w188-canonical-tier").textContent).toContain(
      "The platform will not choose one for you",
    );
  });

  it("renders a server REFUSAL in the server's own words rather than hiding it", async () => {
    const sentence =
      "Single-tier mode cannot be turned on until you choose which tier every consortium partner should use.";
    policyResponse = {
      ok: true,
      policy: {
        singleTierMode: false,
        canonicalTierSlug: null,
        canonicalTierLabel: null,
        refusal: sentence,
        updatedAt: null,
        updatedBy: null,
        notes: null,
        tiers: REAL_TIERS,
        offeredTiers: REAL_TIERS,
      },
    };
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    expect((await screen.findByTestId("refusal-w188-single-tier")).textContent).toContain(sentence);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. ITEM A — THE MODE NEVER CLAIMS TO CHANGE AN AMOUNT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item A — the mode is display-only, and says so", () => {
  it("states in plain language that no amount anyone is charged changes either way", async () => {
    render(
      <Wrap>
        <W188SingleTierModeCard />
      </Wrap>,
    );
    const help = await screen.findByTestId("help-w188-single-tier");
    expect(help.textContent).toContain("Nothing is deleted");
    expect(help.textContent).toContain("no amount anyone is charged changes either way");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. ITEM B req 2 — EVERY FEE ROW EXPLAINS ITSELF, AND NAMES ITS SOURCE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item B — every figure explains itself", () => {
  it("a PLATFORM-WIDE row says the value is absent per-tier AND HOW TO SET ONE — not just 'Platform default'", () => {
    render(<W188FeeRowExplanation feeKind="spv_deployment" tier={null} testId="x" />);
    const src = screen.getByTestId("x-source");
    /* Item B req 3, verbatim: "say exactly that and say how to set it". R158.1's
       whole failure was a screen that printed two words and stopped. */
    expect(src.textContent).toContain("no separate rate has been set for any single tier");
    expect(src.textContent).toContain('use "New fee schedule" above');
    expect(src.textContent).toContain("pick that tier");
    /* The two-word answer is not the WHOLE of what this cell says. */
    expect(src.textContent!.trim()).not.toBe("Platform default");
    expect(src.textContent!.length).toBeGreaterThan(80);
  });

  it("a PER-TIER row says the amount is that tier's own, and that only its partners pay it", () => {
    render(<W188FeeRowExplanation feeKind="spv_deployment" tier="catalyst" testId="y" />);
    expect(screen.getByTestId("y-source").textContent).toContain("set for this one tier");
    expect(screen.getByTestId("y-source").textContent).toContain("only partners on");
  });

  /* ══════════════════════════════════════════════════════════════════════════
     CORRECTED BY WAVE 207 · ITEM A · R195.1 — AND WHY THIS IS A CORRECTION.

     This test asserted, byte-for-byte, that the admin screen tells an
     administrator a vehicle fee is "Based on confirmed capital at that moment".
     R195.1 rules that basis wrong: the fee is not to be charged on capital. The
     assertion was therefore pinning the DEFECT in place, and leaving it green
     would have meant the copy could never be corrected.

     What the test still guarantees is the thing wave 188 actually cared about:
     admin and partner are told the SAME story about the same fee. That is now
     asserted against the shared constant BOTH surfaces import
     (`shared/wave207FeeBasisDimension.ts`), which is a stronger guarantee than
     two hand-copied string literals — they cannot drift apart at all.

     The wave-188 sentence itself has NOT been deleted. It is still in
     `W188_FEE_KIND_WHEN`/`_BASIS` and still renders on the capital-basis arm,
     which the second assertion below exercises directly.
     ═════════════════════════════════════════════════════════════════════════ */
  it("states WHEN it is charged and WHAT IT IS BASED ON, from the same shared constants the partner-facing schedule renders", () => {
    render(<W188FeeRowExplanation feeKind="spv_deployment" tier={null} testId="z" />);
    expect(screen.getByTestId("z-when-flat").textContent).toBe(W207_VEHICLE_FEE_WHEN);
    expect(screen.getByTestId("z-basis-flat").textContent).toBe(W207_VEHICLE_FEE_BASIS);
    /* The corrected copy must not reintroduce the capital basis in other words. */
    const shown = `${screen.getByTestId("z-when-flat").textContent} ${screen.getByTestId("z-basis-flat").textContent}`;
    expect(shown).not.toMatch(/confirmed capital|size of the vehicle|soft-circled/i);
    /* …and the default row must not claim a capital basis at all. */
    expect(screen.queryByTestId("z-when")).toBeNull();
    expect(screen.queryByTestId("z-basis")).toBeNull();
  });

  it("the wave-188 capital sentences are RETAINED, not deleted — they still render on the capital-basis arm (R143.1)", () => {
    /* R143.1 forbids replacing a literal. This proves the original words are still
       in the file and still reachable, while migration 0217's CHECK constraint is
       what prevents any row from ever selecting this arm in production. */
    render(<W188FeeRowExplanation feeKind="spv_deployment" tier={null} testId="legacy" basisDimension={LEGACY_CAPITAL_BASIS_DIMENSION} />);
    expect(screen.getByTestId("legacy-when").textContent).toBe(
      "Charged once, when this SPV is marked Deployed. Based on confirmed capital at that moment — soft-circled interest is not counted.",
    );
    expect(screen.getByTestId("legacy-basis").textContent).toContain("size of the vehicle");
  });

  it("EVERY fee kind this page can show has all three explanations — a new fee kind without them fails here", () => {
    /* The tripwire. A sixth fee kind added without plain language does not quietly
       render a bare number; it fails this test. */
    const KINDS = [
      "subscription_monthly",
      "subscription_annual",
      "spv_deployment",
      "spv_management_per_lp_quarter",
      "spv_closing_bonus",
    ];
    for (const k of KINDS) {
      expect(W188_FEE_KIND_WHEN[k], `WHEN missing for ${k}`).toBeTruthy();
      expect(W188_FEE_KIND_BASIS[k], `BASIS missing for ${k}`).toBeTruthy();
      cleanup();
      /* WAVE 207 — for the vehicle fee the wave-188 sentences now live on the
         capital arm, so the tripwire renders that arm for that one kind. Every
         other kind is rendered exactly as before. Both arms therefore stay
         covered, and a sixth fee kind added without plain language still fails. */
      render(<W188FeeRowExplanation feeKind={k} tier={null} testId={`k-${k}`} basisDimension={k === "spv_deployment" ? LEGACY_CAPITAL_BASIS_DIMENSION : undefined} />);
      expect(screen.getByTestId(`k-${k}-when`).textContent!.length).toBeGreaterThan(20);
      expect(screen.getByTestId(`k-${k}-basis`).textContent!.length).toBeGreaterThan(20);
      expect(screen.getByTestId(`k-${k}-source`).textContent!.length).toBeGreaterThan(20);
    }
  });

  it("an UNKNOWN fee kind degrades to the source explanation rather than rendering a lie", () => {
    render(<W188FeeRowExplanation feeKind="not_a_real_fee_kind" tier={null} testId="u" />);
    /* No invented sentence for a fee kind we have no facts about — but the source
       explanation, which is derived from `tier` alone, still renders. */
    expect(screen.queryByTestId("u-when")).toBeNull();
    expect(screen.queryByTestId("u-basis")).toBeNull();
    expect(screen.getByTestId("u-source")).toBeTruthy();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. ITEM C — ANNUAL IS OFFERED; MONTHLY IS PRESENT BUT NOT OFFERED.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item C — annual is the offer, monthly survives", () => {
  it("renders annual as OFFERED and monthly as NOT OFFERED", async () => {
    render(
      <Wrap>
        <W188BillingPeriodOfferCard />
      </Wrap>,
    );
    const state = await screen.findByTestId("state-w188-billing-period");
    expect(state.textContent).toContain("partners are offered yearly billing only");
    expect(screen.getByTestId("switch-w188-annual-offered").getAttribute("data-state")).toBe("checked");
    expect(screen.getByTestId("switch-w188-monthly-offered").getAttribute("data-state")).toBe("unchecked");
  });

  it("says OUT LOUD that monthly is still supported on the platform — the owner's exact distinction", async () => {
    render(
      <Wrap>
        <W188BillingPeriodOfferCard />
      </Wrap>,
    );
    /* The owner said monthly "should be an option on the platform". SUPPORTED is
       not the same as OFFERED, and the screen has to draw that line itself or the
       owner will read "off" as "gone". */
    const note = await screen.findByTestId("note-w188-monthly-supported");
    expect(note.textContent).toContain("Monthly is still supported on the platform");
    expect(note.textContent).toContain("its price can still be set");
    expect(note.textContent).toContain("keeps billing monthly");
    expect(note.textContent).toContain("not presented as a choice to new buyers");
  });

  it("MONTHLY IS NOT REMOVED: its control is present and enabled, so it can be re-offered without development work", async () => {
    render(
      <Wrap>
        <W188BillingPeriodOfferCard />
      </Wrap>,
    );
    const monthly = await screen.findByTestId("switch-w188-monthly-offered");
    expect((monthly as HTMLButtonElement).disabled).toBe(false);
    expect(monthly.getAttribute("data-disabled")).toBeNull();
    expect(screen.getByText("Offer monthly billing")).toBeTruthy();
    expect(screen.getByTestId("help-w188-billing-period").textContent).toContain(
      "switching it back on needs no development work",
    );
  });

  it("BOTH offered is rendered honestly rather than being silently normalised to annual", async () => {
    offerResponse = {
      ok: true,
      offer: {
        annualOffered: true,
        monthlyOffered: true,
        model: "flat_annual",
        forbidX12Derivation: true,
        updatedAt: null,
        updatedBy: null,
        notes: null,
      },
    };
    render(
      <Wrap>
        <W188BillingPeriodOfferCard />
      </Wrap>,
    );
    expect((await screen.findByTestId("state-w188-billing-period")).textContent).toContain(
      "offered both yearly and monthly",
    );
    /* And the "still supported" note correctly disappears, because when monthly IS
       offered there is nothing to reassure the owner about. */
    expect(screen.queryByTestId("note-w188-monthly-supported")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6. ITEM D — THE TABS ARE GROUPED, AND NOT ONE IS LOST.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item D — nineteen tabs, grouped, none dropped", () => {
  it("EVERY tab in TABS appears exactly once in the grouped nav", () => {
    const items = buildTabNavItems();
    const tabKeys = items.filter((i) => i.kind === "tab").map((i) => i.key);
    expect(tabKeys.sort()).toEqual(TABS.map((t) => t.key).sort());
    /* Exactly once — a key listed in two groups would render two triggers with the
       same `value`, which Tabs cannot resolve. */
    expect(new Set(tabKeys).size).toBe(tabKeys.length);
    expect(tabKeys).toHaveLength(19);
  });

  it("every label is BYTE-VERBATIM the label from TABS (R143.1 — a replaced text node is a removed copy string)", () => {
    /* Widened to `string` keys on purpose: `TABS` is `as const`, so an un-widened
       Map would only accept the literal union and `i.key` is a plain string. */
    const byKey = new Map<string, string>(TABS.map((t) => [t.key as string, t.label as string]));
    for (const i of buildTabNavItems()) {
      if (i.kind === "tab") expect(i.label).toBe(byKey.get(i.key));
    }
  });

  it("every group heading is followed by at least one tab, and no group is empty", () => {
    const items = buildTabNavItems();
    const groups = items.filter((i) => i.kind === "group");
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (let n = 0; n < items.length; n++) {
      if (items[n].kind === "group") {
        expect(items[n + 1], "a heading with nothing under it").toBeTruthy();
        expect(items[n + 1].kind).toBe("tab");
      }
    }
  });

  it("a tab left out of every group is still rendered under a fallback heading — no silent drop", () => {
    /* THE PROPERTY THAT MATTERS FOR THE NEXT WAVE. `buildTabNavItems` derives from
       TABS, so a twentieth tab whose author forgets to group it still appears. This
       is asserted structurally: the union of all group key lists is compared to
       TABS, and any shortfall must be absorbed by the fallback branch. */
    /* Arrays, not Sets, for the iteration: this project's tsc target does not
       enable downlevelIteration, so `for (const x of aSet)` does not compile. */
    const grouped: string[] = TAB_GROUPS.flatMap((g) => [...g.tabKeys]);
    const items = buildTabNavItems();
    const rendered = items.filter((i) => i.kind === "tab").map((i) => i.key);
    for (const t of TABS) expect(rendered.includes(t.key), `${t.key} vanished`).toBe(true);
    /* And every key a group claims really exists, so no group renders a dead chip. */
    for (const k of grouped) {
      expect(
        TABS.some((t) => (t.key as string) === k),
        `${k} is not a real tab`,
      ).toBe(true);
    }
  });

  it("the two tabs R159.3 is about are grouped where an owner would look for them", () => {
    /* `TABS` is `as const`, so its keys are a literal union while TAB_GROUPS holds
       plain strings. Compare as strings rather than widening either type. */
    const find = (k: string) =>
      TAB_GROUPS.find((g) => (g.tabKeys as readonly string[]).includes(k))?.key;
    expect(find("fee-schedules")).toBe("consortium-partners");
    expect(find("displayed-vs-charged")).toBe("check-and-diagnose");
    expect(find("source-map")).toBe("start-here");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   7. ITEM D req 3 — THE TAB IS BOOKMARKABLE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 188 · item D — deep-linkable tab state", () => {
  it("reads a valid ?tab= for every one of the nineteen tabs", () => {
    for (const t of TABS) {
      expect(parseAdminFeesTabParam(`?tab=${t.key}`)).toBe(t.key);
      /* Accepts the parameter string with or without its leading '?', because
         wouter's useSearch() has returned both shapes across versions. */
      expect(parseAdminFeesTabParam(`tab=${t.key}`)).toBe(t.key);
    }
  });

  it("an ABSENT or UNRECOGNISED ?tab= yields null so the caller can fall back — never an empty page", () => {
    expect(parseAdminFeesTabParam("")).toBeNull();
    expect(parseAdminFeesTabParam("?")).toBeNull();
    expect(parseAdminFeesTabParam("?other=1")).toBeNull();
    expect(parseAdminFeesTabParam("?tab=")).toBeNull();
    expect(parseAdminFeesTabParam("?tab=not-a-tab")).toBeNull();
    /* A crafted value must not be echoed back as a tab key. */
    expect(parseAdminFeesTabParam("?tab=<script>")).toBeNull();
  });

  it("survives extra query parameters, so a bookmarked URL with tracking params still lands on its tab", () => {
    expect(parseAdminFeesTabParam("?ref=email&tab=displayed-vs-charged&x=1")).toBe("displayed-vs-charged");
  });
});
