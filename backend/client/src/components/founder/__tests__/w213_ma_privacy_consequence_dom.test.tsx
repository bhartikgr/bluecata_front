/**
 * WAVE 213 · draft 05 Part B4 (map row 39) — ONE CONSEQUENCE LINE beside the
 * founder's M&A sharing switches.
 *
 * WHY IT IS HERE AT ALL. The first switch asks a founder to opt into
 * "benchmarking and matchmaking" without saying what either does with their
 * numbers. The comparison is real — `server/dscScoringEngine.ts` computes a sector
 * median across companies and `server/portfolioAnalyticsStore.ts` builds cohort
 * benchmarks from platform data — so per R190.10 the sharing stays exactly as
 * open as it was and the WORDS change.
 *
 * WHAT THIS FILE GUARDS, and each is a distinct way the change could go wrong:
 *   1. the line renders (an unrendered constant is not disclosure);
 *   2. the switches, their labels and their DEFAULTS are untouched (R190.10 —
 *      nothing restricted, no default flipped, no new gate);
 *   3. the line makes no measured claim (R-ASSERT, handbook §14) — no figure, no
 *      count, no percentage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
/* The panel returns null without an active company — that is its own pre-existing
   guard, not something this wave changed, so the company is supplied here. */
vi.mock("@/lib/useActiveCompany", () => ({ useActiveCompanyId: () => "co_w213_founder" }));

import { MaPrivacyConsent } from "../MaPrivacyConsent";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MaPrivacyConsent />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      companyId: "co_w213_founder",
      maPrivacy: {
        shareWithCollective: false,
        shareWithChapter: true,
        shareWithAdvisors: true,
        redactNarrativeFromAggregates: true,
      },
    }),
  }));
});
afterEach(() => cleanup());

describe("wave 213 — the founder is told what the sharing switches actually do", () => {
  it("the consequence line renders beside the switches", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("ma-privacy-consequence")).toBeTruthy());
    const text = screen.getByTestId("ma-privacy-consequence").textContent ?? "";
    /* It names the mechanism, the current scope, and what widening costs. */
    expect(text).toContain("compared against other companies");
    expect(text).toContain("within your own chapter");
    expect(text).toContain("cannot be recalled by switching it back off");
  });

  it("NO-DROP / R190.10 — the switches themselves are unchanged and nothing is gated", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("ma-privacy-consequence")).toBeTruthy());
    const panel = document.body.textContent ?? "";
    /* The switch labels the founder had before are still the switch labels. */
    expect(panel).toContain("Share my M&A profile across the Collective");
    /* No input was disabled, and no acknowledgement was bolted onto this panel:
       this wave adds a SENTENCE here, not a barrier. */
    const inputs = Array.from(document.querySelectorAll("input,button")) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((el) => el.disabled === false || el.getAttribute("type") === "hidden")).toBe(true);
  });

  it("R-ASSERT — the line states no figure the platform did not measure", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("ma-privacy-consequence")).toBeTruthy());
    const text = screen.getByTestId("ma-privacy-consequence").textContent ?? "";
    /* No digits at all: no counts, no percentages, no "X companies". */
    expect(/\d/.test(text)).toBe(false);
    expect(text).not.toMatch(/%|percent|median of|average of/i);
  });
});
