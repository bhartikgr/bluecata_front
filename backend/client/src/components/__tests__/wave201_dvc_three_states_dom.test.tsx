/**
 * WAVE 201 · R173.7 — THE THREE BADGE STATES, PROVEN ON RENDERED DOM.
 *
 * WHY RENDERED DOM AND NOT SOURCE TEXT. The wave brief described the badge's
 * behaviour incorrectly, and the reason it could be described incorrectly is
 * that wave 188's probe re-implemented the `divergent` formula instead of
 * calling the product's own function, then measured its own re-implementation.
 * Asserting on source text would repeat that class of mistake in a new form: a
 * source assertion proves a string exists, not that a user ever sees it. Every
 * assertion below reads the rendered document of the REAL admin tab component,
 * `DisplayedVsChargedTab`, after a real tier selection and a real Compare click.
 *
 * THE OWNER'S RULING, ITEM A.2: "Match — both sides resolve and agree.
 * Mismatch — both sides resolve and disagree. Cannot compare / incomplete — one
 * side does not resolve. This is a finding, not an OK, and not a mismatch. Do
 * not collapse the third into either of the others."
 *
 * So sections 3, 4 and 7 do not merely assert that the right words appear; they
 * assert the ABSENCE of the other two states' words on the same row. A badge
 * that printed all three labels at once would satisfy a positive-only test and
 * would still be the defect.
 *
 * WHAT IS DELIBERATELY NOT PROVEN HERE. No test in this file touches the
 * database or a charge path. The proof that no charged figure moves lives in
 * build_log/wave201/PROBE_5_verify_three_states.txt, which runs the real server
 * resolver against a copy of the real database. A DOM test driven by its own
 * fixtures cannot prove a fact about the data, and is not claimed to.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

/* The five real tiers, as `partner_tier_lifecycle` holds them — verified during
   preflight (W201_PREFLIGHT.md §4: five rows, all active, all with a display
   name). Only `catalyst` is needed to drive the tab, but the shape is the real
   shape rather than an invented one. */
const REAL_TIERS = [
  { slug: "catalyst", label: "Catalyst", labelIsFallback: false, state: "active" },
  { slug: "builder", label: "Builder", labelIsFallback: false, state: "active" },
];

let policyResponse: unknown;
let repointResponse: unknown;

vi.mock("@/lib/queryClient", () => {
  const client = {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
  };
  return {
    queryClient: client,
    apiRequest: vi.fn(async (_method: string, url: string) => {
      const body = url.startsWith("/api/admin/fee-admin-display-policy")
        ? policyResponse
        : url.startsWith("/api/admin/pricing-console/repoint")
          ? repointResponse
          : {};
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
    getQueryFn: () => async () => ({}),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { DisplayedVsChargedTab } from "@/pages/admin/AdminFeesConsolidated";

/* The client is built ONCE per test and held outside the component, because a
   client constructed inside the render body is a NEW client on every re-render,
   which resets every in-flight query and can never settle. */
function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
        /* The tab's repoint query declares no queryFn of its own, so the fixture
           is served through the client default — the same route the real default
           queryFn takes in the app. */
        queryFn: async () => repointResponse,
      },
    },
  });
}

function Wrap({ children, client }: { children: React.ReactNode; client?: QueryClient }) {
  const ref = React.useRef<QueryClient | null>(client ?? null);
  if (!ref.current) ref.current = newClient();
  return <QueryClientProvider client={ref.current}>{children}</QueryClientProvider>;
}

/** A resolved side. */
const resolved = (amountMinor: number, currency = "USD", computedVia = "platform_default") => ({
  amountMinor,
  currency,
  computedVia,
  billingPeriod: null,
  error: null,
});

/** A side that did not resolve. Never a zero — a refusal (R6, R143.4). */
const unresolved = (error: string) => ({
  amountMinor: null,
  currency: null,
  computedVia: null,
  billingPeriod: null,
  error,
});

/** One preview row exactly as `buildRepointPreview` emits it. */
function row(over: Record<string, unknown>) {
  return {
    feeKind: "spv_deployment",
    authoritativeSource: "platform_fees.consortium.spv_deployment_fee",
    billingPeriod: "one_off",
    displayed: resolved(24000),
    authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
    divergent: false,
    comparisonState: "match",
    missingSide: null,
    acknowledged: false,
    ack: null,
    ...over,
  };
}

async function renderWithRows(rows: unknown[]) {
  repointResponse = { ok: true, rows, secondTablePurpose: "" };
  render(
    <Wrap>
      <DisplayedVsChargedTab />
    </Wrap>,
  );
  /* Wait for the tier list to arrive before selecting: choosing a value that is
     not yet an option leaves the select empty and the Compare button disabled,
     which is how a first attempt at this test silently compared nothing. */
  const select = await screen.findByTestId("input-dvc-tier");
  await screen.findByTestId("option-dvc-tier-catalyst");
  fireEvent.change(select, { target: { value: "catalyst" } });
  expect((select as HTMLSelectElement).value).toBe("catalyst");
  fireEvent.click(screen.getByTestId("button-dvc-compare"));
  await waitFor(() => expect(screen.getByTestId("dvc-table")).toBeTruthy());
  return rows;
}

/** The rendered State cell for one fee kind. */
async function stateCell(feeKind: string): Promise<HTMLElement> {
  return await screen.findByTestId(`dvc-state-${feeKind}`);
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
  repointResponse = { ok: true, rows: [], secondTablePurpose: "" };
});

afterEach(() => cleanup());

/* ════════════════════════════════════════════════════════════════════════════
   1. MATCH — both sides resolve and agree.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A — state 1 of 3: MATCH", () => {
  it("says the displayed figure matches the charged figure, and offers no action", async () => {
    await renderWithRows([
      row({
        displayed: resolved(24000, "USD", "platform_fee_authoritative_shown_because_no_displayed_price"),
        authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
        divergent: false,
        comparisonState: "match",
        missingSide: null,
      }),
    ]);
    const cell = await stateCell("spv_deployment");
    expect(cell.textContent).toContain("Displayed matches charged");
    /* NOT collapsed the other way either: a real match must not be reported as
       a finding, or the screen would cry wolf on every row. */
    expect(cell.textContent).not.toContain("Cannot compare");
    expect(cell.textContent).not.toContain("Confirm repricing");
    expect(within(cell).queryByTestId("button-dvc-confirm-spv_deployment")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. MISMATCH — both sides resolve and disagree. The one state where a repoint
      is a meaningful thing to confirm, so the button belongs here and only here.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A — state 2 of 3: MISMATCH", () => {
  it("offers the confirmation, and does NOT describe itself as incomplete", async () => {
    await renderWithRows([
      row({
        feeKind: "subscription_annual",
        displayed: resolved(0),
        authoritative: resolved(84000, "USD", "partner_tier_price_authoritative"),
        divergent: true,
        comparisonState: "mismatch",
        missingSide: null,
      }),
    ]);
    const cell = await stateCell("subscription_annual");
    expect(within(cell).getByTestId("button-dvc-confirm-subscription_annual")).toBeTruthy();
    expect(cell.textContent).toContain("Confirm repricing");
    expect(cell.textContent).not.toContain("Cannot compare");
    expect(cell.textContent).not.toContain("Displayed matches charged");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. CANNOT COMPARE — one side does not resolve. THE HEART OF THE WAVE.
      Three sub-cases, each NAMING WHICH SIDE IS MISSING (Item A.3), and each
      asserting the absence of the other two states' words.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A — state 3 of 3: CANNOT COMPARE, and it names the missing side", () => {
  it("names the DISPLAYED side when only the charged figure is on file", async () => {
    await renderWithRows([
      row({
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
        divergent: true,
        comparisonState: "incomplete",
        missingSide: "displayed",
      }),
    ]);
    const cell = await stateCell("spv_deployment");
    expect(cell.textContent).toContain("Cannot compare — no displayed price on file");
    expect(cell.textContent).not.toContain("Displayed matches charged");
    expect(cell.textContent).not.toContain("Confirm repricing");
  });

  it("names the CHARGED side when only the displayed figure is on file", async () => {
    await renderWithRows([
      row({
        feeKind: "subscription_monthly",
        displayed: resolved(0),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        divergent: true,
        comparisonState: "incomplete",
        missingSide: "charged",
      }),
    ]);
    const cell = await stateCell("subscription_monthly");
    expect(cell.textContent).toContain("Cannot compare — no charged price on file");
    expect(cell.textContent).not.toContain("Displayed matches charged");
    expect(cell.textContent).not.toContain("Confirm repricing");
  });

  it("says NEITHER price is on file when both sides fail — the case that used to read as a pass", async () => {
    await renderWithRows([
      row({
        feeKind: "subscription_annual",
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        /* THE EXACT OLD FALSE OK: with both sides null, `null !== null` is
           false, so the old single boolean said "not divergent" and the screen
           printed "Displayed matches charged". `divergent: false` is passed here
           deliberately, reproducing the old server output byte for byte. */
        divergent: false,
        comparisonState: "incomplete",
        missingSide: "both",
      }),
    ]);
    const cell = await stateCell("subscription_annual");
    expect(cell.textContent).toContain("Cannot compare — neither price on file");
    expect(cell.textContent).not.toContain("Displayed matches charged");
    expect(cell.textContent).not.toContain("Confirm repricing");
  });

  it("states in words that this is a finding — not left to a colour a reader may not notice", async () => {
    await renderWithRows([
      row({
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
        divergent: true,
        comparisonState: "incomplete",
        missingSide: "displayed",
      }),
    ]);
    const note = await screen.findByTestId("dvc-finding-note-spv_deployment");
    expect(note.textContent).toContain("This is a finding, not a match and not a mismatch.");
  });

  it("offers NO destructive confirmation on an incomplete row, in the DOM", async () => {
    await renderWithRows([
      row({
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
        divergent: true,
        comparisonState: "incomplete",
        missingSide: "displayed",
      }),
    ]);
    /* The button that WOULD have repointed the display onto a source that
       cannot answer — and so replaced a price with nothing — is not rendered. */
    expect(screen.queryByTestId("button-dvc-confirm-spv_deployment")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. THE THREE STATES ARE TEXTUALLY DISTINCT FROM ONE ANOTHER (Item A.2).
      Rendered together, in one table, so the comparison is the one a reader
      actually makes.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A.2 — the three states are distinct in the same table", () => {
  it("renders three different sentences for the three different facts", async () => {
    await renderWithRows([
      row({
        feeKind: "spv_deployment",
        comparisonState: "match",
        divergent: false,
        missingSide: null,
      }),
      row({
        feeKind: "subscription_annual",
        displayed: resolved(0),
        authoritative: resolved(84000, "USD", "partner_tier_price_authoritative"),
        comparisonState: "mismatch",
        divergent: true,
        missingSide: null,
      }),
      row({
        feeKind: "subscription_monthly",
        displayed: resolved(0),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        comparisonState: "incomplete",
        divergent: true,
        missingSide: "charged",
      }),
    ]);
    const matchText = (await stateCell("spv_deployment")).textContent ?? "";
    const mismatchText = (await stateCell("subscription_annual")).textContent ?? "";
    const incompleteText = (await stateCell("subscription_monthly")).textContent ?? "";

    expect(matchText).toContain("Displayed matches charged");
    expect(mismatchText).toContain("Confirm repricing");
    expect(incompleteText).toContain("Cannot compare");

    /* Pairwise distinct. Not "all three contain something" — actually different. */
    expect(matchText).not.toBe(mismatchText);
    expect(mismatchText).not.toBe(incompleteText);
    expect(matchText).not.toBe(incompleteText);
    /* And no row borrows another row's words. */
    expect(matchText).not.toContain("Cannot compare");
    expect(mismatchText).not.toContain("Cannot compare");
    expect(incompleteText).not.toContain("Displayed matches charged");
    expect(incompleteText).not.toContain("Confirm repricing");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. THE COUNT (Item A.1) — an incomplete control is counted as a FINDING, and
      never inside the match or mismatch totals.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A.1 — findings are counted separately", () => {
  it("counts 1 match, 1 mismatch and 2 findings out of 4 rows without folding any together", async () => {
    await renderWithRows([
      row({ feeKind: "spv_deployment", comparisonState: "match", divergent: false }),
      row({
        feeKind: "subscription_annual",
        displayed: resolved(0),
        authoritative: resolved(84000, "USD", "partner_tier_price_authoritative"),
        comparisonState: "mismatch",
        divergent: true,
      }),
      row({
        feeKind: "subscription_monthly",
        displayed: resolved(0),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        comparisonState: "incomplete",
        divergent: true,
        missingSide: "charged",
      }),
      row({
        feeKind: "spv_management",
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        comparisonState: "incomplete",
        divergent: false,
        missingSide: "both",
      }),
    ]);
    expect((await screen.findByTestId("dvc-count-compared")).textContent).toContain("4");
    expect((await screen.findByTestId("dvc-count-match")).textContent).toContain("Match: 1");
    expect((await screen.findByTestId("dvc-count-mismatch")).textContent).toContain("Mismatch: 1");
    const findings = await screen.findByTestId("dvc-count-incomplete");
    expect(findings.textContent).toContain("findings:");
    expect(findings.textContent).toContain("2");
  });

  it("shows no counts at all before a comparison has been run, so a blank screen never implies a clean result", async () => {
    render(
      <Wrap>
        <DisplayedVsChargedTab />
      </Wrap>,
    );
    await screen.findByTestId("input-dvc-tier");
    expect(screen.queryByTestId("dvc-summary-counts")).toBeNull();
    expect(screen.queryByTestId("dvc-count-match")).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6. THE ACKNOWLEDGED STATE IS UNDISTURBED (Item C.1 — do not regress).
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item C — wave 131's confirmed state still renders", () => {
  it("still reads 'Repointed — confirmed', em dash included", async () => {
    await renderWithRows([
      row({
        acknowledged: true,
        ack: { acknowledgedByUserId: "admin_1", acknowledgedAt: "2026-08-28T00:00:00.000Z" },
        comparisonState: "match",
      }),
    ]);
    const cell = await stateCell("spv_deployment");
    expect(cell.textContent).toContain("Repointed — confirmed");
  });

  it("keeps the acknowledged badge even on an incomplete row, rather than reclassifying a recorded decision", async () => {
    await renderWithRows([
      row({
        acknowledged: true,
        ack: { acknowledgedByUserId: "admin_1", acknowledgedAt: "2026-08-28T00:00:00.000Z" },
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        comparisonState: "incomplete",
        missingSide: "both",
      }),
    ]);
    const cell = await stateCell("spv_deployment");
    /* An ack is a recorded human decision with a name and a timestamp against
       it. Wave 201 does not overwrite that record with a fresh opinion; it
       reports on rows nobody has decided yet. Stated here so the precedence is
       deliberate rather than accidental. */
    expect(cell.textContent).toContain("Repointed — confirmed");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   7. FAIL-CLOSED — a server that does not send the new field is a FINDING, not
      a pass. This is the defect's own logic turned on the client: "we were not
      told whether these agree" must never render as agreement.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A.1 — an unanswered question never renders as a pass", () => {
  it("treats a missing comparisonState with an unresolved side as CANNOT COMPARE, not as a match", async () => {
    await renderWithRows([
      {
        feeKind: "spv_deployment",
        authoritativeSource: "platform_fees.consortium.spv_deployment_fee",
        billingPeriod: "one_off",
        displayed: unresolved("no_fee_schedule_configured"),
        authoritative: unresolved("TIER_PRICE_UNRESOLVED"),
        /* Exactly what the OLD server sent for this case: divergent false, and
           no comparisonState field at all. */
        divergent: false,
        acknowledged: false,
        ack: null,
      },
    ]);
    const cell = await stateCell("spv_deployment");
    expect(cell.textContent).toContain("Cannot compare");
    expect(cell.textContent).not.toContain("Displayed matches charged");
  });

  it("still reports a genuine agreement as a match when the field is absent, so the fallback is not merely pessimistic", async () => {
    await renderWithRows([
      {
        feeKind: "spv_deployment",
        authoritativeSource: "platform_fees.consortium.spv_deployment_fee",
        billingPeriod: "one_off",
        displayed: resolved(24000),
        authoritative: resolved(24000, "USD", "platform_fee_authoritative"),
        divergent: false,
        acknowledged: false,
        ack: null,
      },
    ]);
    const cell = await stateCell("spv_deployment");
    expect(cell.textContent).toContain("Displayed matches charged");
    expect(cell.textContent).not.toContain("Cannot compare");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   8. THE READER IS TOLD THERE ARE THREE ANSWERS, IN PLAIN LANGUAGE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 201 · item A — the screen explains the three states in words", () => {
  it("explains all three possibilities above the table, and says the third is a finding", async () => {
    await renderWithRows([row({})]);
    const help = await screen.findByTestId("help-dvc-three-states");
    expect(help.textContent).toContain("three possible answers");
    expect(help.textContent).toContain("Displayed matches charged");
    expect(help.textContent).toContain("Confirm repricing");
    expect(help.textContent).toContain("Cannot compare");
    expect(help.textContent).toContain("finding");
  });

  it("keeps wave 188's how-to-read text byte-verbatim alongside it (R143.1 — appended, not replaced)", async () => {
    await renderWithRows([row({})]);
    const old = await screen.findByTestId("help-dvc-howtoread");
    expect(old.textContent).toContain(
      '"Not resolvable" means no amount has been configured at all',
    );
  });
});
