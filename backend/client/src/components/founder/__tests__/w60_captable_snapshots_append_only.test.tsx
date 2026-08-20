/**
 * WAVE 60 · A-5 — THE ITEM WHERE R44 SAID "DO NOT REPLACE", AND OWNER RULING R51
 * SAID "APPEND ONE SENTENCE".
 *
 * ── THE R44 JUDGEMENT, SHOWN ─────────────────────────────────────────────────
 * `client/src/components/founder/CapTableSnapshots.tsx:99` already branched on
 * `q.isError || (q.data && !q.data.ok)` and rendered, at :103:
 *
 *     Couldn’t load projected / previous cap tables.        (U+2019 apostrophe)
 *
 * with a working **Retry** at :104. Applying R44's own table to that string:
 *   · FALSE?               No — when it renders, the load genuinely failed.
 *   · TRUE BUT INCOMPLETE? Yes — it omits "this is a loading failure, not an
 *                          empty list" and does not say nothing was changed.
 *                          R44 row 2 → ADD, no allowlist entry.
 *   · ALREADY HONEST?      Yes — named cause, named subject, working retry.
 * There is NO reading of R44 under which this is a REPLACE. **The allowlist stays
 * at 43.** R51 settled it: keep the existing copy byte-identical, append one
 * sentence.
 *
 * ── WHAT THIS FILE PROVES ────────────────────────────────────────────────────
 *   BYTE-IDENTITY  the original <p> text (including U+2019), `snapshots-error`
 *                  and `snapshots-retry` all survive exactly.
 *   ADDITION       the new sentence renders next to them.
 *   UPPER POLE     `{ok:true, hasPending:false, hasPrevious:false}` still renders
 *                  NOTHING — an additive card's absence is not a claim, and the
 *                  appended sentence must not leak into that state.
 *   UPPER POLE     a real pending snapshot still renders its card.
 *
 * This file is also the FIRST test of any kind for this component (grep before
 * this wave: zero hits).
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import CapTableSnapshots from "../CapTableSnapshots";

/** The byte-exact original sentence. U+2019, not an ASCII apostrophe. */
const ORIGINAL = "Couldn\u2019t load projected / previous cap tables.";
const APPENDED = "Nothing has been changed \u2014 this is a loading failure, not an empty list.";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function renderSnapshots(fn: () => Promise<unknown>) {
  apiRequestMock.mockImplementation(async () => jsonResponse(await fn()));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CapTableSnapshots companyId="co_w60" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});

describe("W60 · A-5 — append only: the existing honest refusal is untouched", () => {
  it("BYTE-IDENTITY — the original sentence renders exactly, U+2019 and all", async () => {
    renderSnapshots(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    const card = await screen.findByTestId("snapshots-error");
    const p = card.querySelector("p.text-xs.text-rose-600");
    expect(p).toBeTruthy();
    expect(p!.textContent).toBe(ORIGINAL);
    /* Not the ASCII apostrophe, and not an HTML entity. */
    expect(p!.textContent).toContain("\u2019");
    expect(p!.textContent).not.toContain("'");
  });

  it("BYTE-IDENTITY — the Retry control and both data-testids survive", async () => {
    renderSnapshots(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await screen.findByTestId("snapshots-error");
    const retry = screen.getByTestId("snapshots-retry");
    expect(retry.textContent).toBe("Retry");
  });

  it("ADDITION — the appended sentence distinguishes a load failure from an empty list", async () => {
    renderSnapshots(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await screen.findByTestId("snapshots-error");
    expect(screen.getByText(APPENDED)).toBeTruthy();
  });

  it("the appended sentence also renders for an `{ok:false}` BODY, not only a thrown error", async () => {
    /* :99's second half — `q.data && !q.data.ok` — is a distinct failure mode. */
    renderSnapshots(async () => ({ ok: false }));
    await screen.findByTestId("snapshots-error");
    expect(screen.getByText(APPENDED)).toBeTruthy();
    expect(screen.getByText(ORIGINAL)).toBeTruthy();
  });

  it("UPPER POLE — nothing pending and nothing previous still renders NOTHING at all", async () => {
    /* :117-119's deliberate `return null`, documented at :114-116. The appended
       sentence must not leak into the genuinely-empty state, and the absence of
       an additive card is not a claim about anything. */
    const { container } = renderSnapshots(async () => ({
      ok: true,
      pending: { hasPending: false, roundIds: [], positions: [] },
      previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
    }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId("snapshots-error")).toBeNull();
    expect(screen.queryByText(APPENDED)).toBeNull();
  });

  it("UPPER POLE — a real pending snapshot renders its card and neither failure sentence", async () => {
    renderSnapshots(async () => ({
      ok: true,
      pending: { hasPending: true, roundIds: ["rnd_1"], positions: [] },
      previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
    }));
    expect(await screen.findByTestId("captable-snapshots")).toBeTruthy();
    expect(screen.queryByText(ORIGINAL)).toBeNull();
    expect(screen.queryByText(APPENDED)).toBeNull();
  });
});
