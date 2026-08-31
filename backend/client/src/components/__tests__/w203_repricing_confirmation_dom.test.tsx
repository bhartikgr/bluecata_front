/**
 * WAVE 203 · ITEM B (R178.6) — DETECTION IS NOT REMEDIATION, PROVEN ON RENDERED DOM.
 *
 * WHY RENDERED DOM AND NOT A STORE OR A RE-IMPLEMENTATION (handbook §8). The
 * claim under test is about a GESTURE: that no single click on the comparison
 * screen can move what a partner is shown. That claim is only meaningful against
 * the real component, the real button, and the real mutation. Every assertion
 * below mounts `DisplayedVsChargedTab` — the actual admin tab — selects a real
 * tier, clicks the real Compare button, and then drives the real controls.
 *
 * The harness (mocks, tier fixtures, row shape) is deliberately the SAME shape
 * wave 201's DOM test uses, so the two files agree about what the server emits.
 *
 * WHAT IS PROVEN HERE
 *   B1  a mismatch row still offers the action — the fix must not remove the
 *       capability, only make it deliberate (handbook §9: the recurring defect is
 *       invisible capability, not missing capability)
 *   B2  clicking it sends NOTHING. No request is made by the first gesture.
 *   B3  the confirmation names the OLD amount, the NEW amount, the AFFECTED
 *       PARTY, and captures a REASON
 *   B4  confirm is REFUSED until a reason is typed
 *   B5  confirming posts once, carrying the reason and no amount
 *   B6  cancelling posts nothing
 *   B7  a CANNOT-COMPARE row offers no action at all, and wave 201's three
 *       states and their exact words are intact
 *   B8  no ALL-CAPS underscore code is rendered anywhere on the confirmation
 *
 * NO CHARGED FIGURE IS SET OR MOVED ANYWHERE IN THIS FILE. The POST body is
 * asserted to carry no amount at all, which is the strongest statement a DOM
 * test can make about money here.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const REAL_TIERS = [
  { slug: "catalyst", label: "Catalyst", labelIsFallback: false, state: "active" },
  { slug: "builder", label: "Builder", labelIsFallback: false, state: "active" },
];

let policyResponse: unknown;
let repointResponse: unknown;
/** Every POST the component makes, in order. Empty is a meaningful assertion. */
const posts: Array<{ method: string; url: string; body: unknown }> = [];

vi.mock("@/lib/queryClient", () => {
  const client = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn() };
  return {
    queryClient: client,
    apiRequest: vi.fn(async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") posts.push({ method, url, body });
      const payload = url.startsWith("/api/admin/fee-admin-display-policy")
        ? policyResponse
        : url.startsWith("/api/admin/pricing-console/repoint-ack")
          ? { ok: true }
          : url.startsWith("/api/admin/pricing-console/repoint")
            ? repointResponse
            : {};
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }),
    getQueryFn: () => async () => ({}),
  };
});

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { DisplayedVsChargedTab } from "@/pages/admin/AdminFeesConsolidated";

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, queryFn: async () => repointResponse },
      mutations: { retry: false },
    },
  });
}

function Wrap({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<QueryClient | null>(null);
  if (!ref.current) ref.current = newClient();
  return <QueryClientProvider client={ref.current}>{children}</QueryClientProvider>;
}

const resolved = (amountMinor: number, currency = "USD", computedVia = "platform_default") => ({
  amountMinor,
  currency,
  computedVia,
  billingPeriod: null,
  error: null,
});

/** A side that did not resolve. Never a zero — a refusal (R143.4). */
const unresolved = (error: string) => ({
  amountMinor: null,
  currency: null,
  computedVia: null,
  billingPeriod: null,
  error,
});

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

/** A real mismatch: both sides resolved, and they disagree. */
const MISMATCH = row({
  displayed: resolved(24000),
  authoritative: resolved(84000, "USD", "platform_fee_authoritative"),
  divergent: true,
  comparisonState: "mismatch",
});

async function renderWithRows(rows: unknown[], partnerId = "") {
  repointResponse = { ok: true, rows, secondTablePurpose: "" };
  render(
    <Wrap>
      <DisplayedVsChargedTab />
    </Wrap>,
  );
  const select = await screen.findByTestId("input-dvc-tier");
  await screen.findByTestId("option-dvc-tier-catalyst");
  fireEvent.change(select, { target: { value: "catalyst" } });
  expect((select as HTMLSelectElement).value).toBe("catalyst");
  if (partnerId) {
    const pid = screen.getByTestId("input-dvc-partner");
    fireEvent.change(pid, { target: { value: partnerId } });
  }
  fireEvent.click(screen.getByTestId("button-dvc-compare"));
  await waitFor(() => expect(screen.getByTestId("dvc-table")).toBeTruthy());
}

beforeEach(() => {
  posts.length = 0;
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

describe("WAVE 203 · B — the action survives, the single click does not", () => {
  it("B1 a mismatch row still offers the action, with its label byte-verbatim", async () => {
    await renderWithRows([MISMATCH]);
    const btn = await screen.findByTestId("button-dvc-confirm-spv_deployment");
    expect(btn.textContent?.trim()).toBe("Confirm repricing");
  });

  it("B2 THE CENTRAL CLAIM — clicking it sends nothing at all", async () => {
    await renderWithRows([MISMATCH]);
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    /* The confirmation surface opened … */
    expect(await screen.findByTestId("w203-repricing-confirm")).toBeTruthy();
    /* … and NOT ONE request left the browser. Before this wave, this same click
       posted `confirm: true` and the repoint was done. */
    expect(posts).toEqual([]);
  });

  it("B3 the confirmation names the old amount, the new amount, the affected party and takes a reason", async () => {
    await renderWithRows([MISMATCH], "ptr_realpartner");
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    const panel = await screen.findByTestId("w203-repricing-confirm");

    /* OLD and NEW, each formatted from its own currency, read out of the DOM. */
    expect(within(panel).getByTestId("w203-confirm-old-amount").textContent).toContain("240");
    expect(within(panel).getByTestId("w203-confirm-new-amount").textContent).toContain("840");
    /* They are DIFFERENT cells with DIFFERENT text — a confirmation that showed
       one number twice would name nothing. */
    expect(within(panel).getByTestId("w203-confirm-old-amount").textContent).not.toBe(
      within(panel).getByTestId("w203-confirm-new-amount").textContent,
    );

    /* AFFECTED PARTY — the tier, and the specific partner when one is scoped. */
    const affected = within(panel).getByTestId("w203-confirm-affected").textContent ?? "";
    expect(affected).toContain("ptr_realpartner");

    /* REASON — a real control, present and empty. */
    const reason = within(panel).getByTestId("w203-confirm-reason") as HTMLTextAreaElement;
    expect(reason.value).toBe("");
  });

  it("B4 confirm is refused until a reason is given", async () => {
    await renderWithRows([MISMATCH]);
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    const submit = (await screen.findByTestId("w203-confirm-submit")) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    /* Whitespace is not a reason. */
    fireEvent.change(screen.getByTestId("w203-confirm-reason"), { target: { value: "   " } });
    expect((screen.getByTestId("w203-confirm-submit") as HTMLButtonElement).disabled).toBe(true);
    /* And clicking a disabled control still sends nothing. */
    fireEvent.click(submit);
    expect(posts).toEqual([]);

    fireEvent.change(screen.getByTestId("w203-confirm-reason"), {
      target: { value: "Catalyst deployment fee was never migrated off the legacy schedule." },
    });
    expect((screen.getByTestId("w203-confirm-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("B5 confirming posts exactly once, carrying the reason and NO amount", async () => {
    await renderWithRows([MISMATCH]);
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    const REASON = "Catalyst deployment fee was never migrated off the legacy schedule.";
    fireEvent.change(screen.getByTestId("w203-confirm-reason"), { target: { value: REASON } });
    fireEvent.click(screen.getByTestId("w203-confirm-submit"));

    await waitFor(() => expect(posts.length).toBe(1));
    const [only] = posts;
    expect(only.method).toBe("POST");
    expect(only.url).toBe("/api/admin/pricing-console/repoint-ack");
    const body = only.body as Record<string, unknown>;
    expect(body.confirm).toBe(true);
    expect(body.reason).toBe(REASON);
    expect(body.feeKind).toBe("spv_deployment");
    expect(body.tier).toBe("catalyst");
    /* NO AMOUNT LEAVES THE BROWSER. Asserted over the whole serialised body so a
       future field cannot smuggle one in under a new name. */
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("24000");
    expect(serialised).not.toContain("84000");
    expect(serialised.toLowerCase()).not.toContain("amount");
  });

  it("B6 cancelling sends nothing and closes the surface", async () => {
    await renderWithRows([MISMATCH]);
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    fireEvent.change(screen.getByTestId("w203-confirm-reason"), { target: { value: "changed my mind" } });
    fireEvent.click(screen.getByTestId("w203-confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("w203-repricing-confirm")).toBeNull());
    expect(posts).toEqual([]);
  });
});

describe("WAVE 203 · B.3 — wave 201's cannot-compare state is intact and keeps NO action", () => {
  const INCOMPLETE = row({
    displayed: unresolved("no_fee_schedule_configured"),
    authoritative: resolved(84000, "USD", "platform_fee_authoritative"),
    divergent: true,
    comparisonState: "incomplete",
    missingSide: "displayed",
  });

  it("B7 offers no button, keeps the amber finding wording, and cannot open the confirmation", async () => {
    await renderWithRows([INCOMPLETE]);
    const cell = await screen.findByTestId("dvc-state-spv_deployment");

    /* NO ACTION AT ALL — not a disabled one, not a hidden one. */
    expect(within(cell).queryByTestId("button-dvc-confirm-spv_deployment")).toBeNull();
    expect(within(cell).queryAllByRole("button")).toEqual([]);

    /* WAVE 201'S THREE STATES, VERIFIED NOT REGRESSED — the exact words. */
    expect(within(cell).getByTestId("dvc-finding-note-spv_deployment").textContent?.trim()).toBe(
      "This is a finding, not a match and not a mismatch.",
    );
    expect(within(cell).getByTestId("badge-dvc-incomplete-spv_deployment").textContent?.trim()).toBe(
      "Cannot compare — no displayed price on file",
    );
    /* And it is not being reported as either of the other two facts. */
    expect(cell.textContent).not.toContain("Displayed matches charged");
    expect(cell.textContent).not.toContain("Confirm repricing");

    /* The confirmation surface is not reachable from this row. */
    expect(screen.queryByTestId("w203-repricing-confirm")).toBeNull();
    expect(posts).toEqual([]);
  });

  it("B8 nothing on the confirmation is a machine code (R143.4)", async () => {
    await renderWithRows([MISMATCH], "ptr_realpartner");
    fireEvent.click(await screen.findByTestId("button-dvc-confirm-spv_deployment"));
    const panel = await screen.findByTestId("w203-repricing-confirm");
    const text = panel.textContent ?? "";
    expect(text.length).toBeGreaterThan(50);
    /* An ALL-CAPS underscore token — `SPV_DEPLOYMENT`, `TIER_PRICE_UNRESOLVED`. */
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    /* And the raw machine key itself is not printed as a label. */
    expect(within(panel).getByTestId("w203-confirm-feekind").textContent).not.toBe("spv_deployment");
  });
});
