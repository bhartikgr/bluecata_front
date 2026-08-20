/**
 * WAVE 60 · A-1 — TWO CARDS THAT VANISHED WITHOUT SAYING SO.
 *
 * ── THE DEFECT, AS THE USER SAW IT ───────────────────────────────────────────
 * `client/src/components/comms/ChannelCards.tsx` had ZERO references to
 * `isError`. Both cards read:
 *
 *     if (q.isLoading) return <Skeleton … />;
 *     const data = q.data;
 *     if (!data?.exists || !data.isMember) return null;   // :44 and :104
 *
 * `!data?.exists` is TRUE when `data` is `undefined` — which is exactly what a
 * failed or PAUSED (offline) query gives you. So THREE different states all
 * rendered the same thing, `null`:
 *
 *   exists: false      — no channel has been created         (genuine emptiness)
 *   isMember: false    — a channel exists, you are not on it (legitimate scope refusal)
 *   error / paused     — we could not read it                (A FAILURE)
 *
 * The user saw no card, no error, no retry, and no evidence the feature exists.
 * There was not even fabricated text to be suspicious of.
 *
 * ── WHERE THESE CARDS ACTUALLY RENDER (established from source) ──────────────
 *   CapTableChannelCard   → pages/CompanyDetails.tsx:622 → /founder/companies/:id
 *   SoftCircleChannelCard → pages/CompanyDetails.tsx:624 → /founder/companies/:id
 *                         → pages/founder/RoundDetail.tsx:771 → /founder/rounds/:id
 * NOT /founder/messages — that is only where their "Open channel" button LINKS.
 * See build_log/wave60/W60_MOUNT_POINTS.md.
 *
 * ── BOTH POLES, BECAUSE ONE POLE PROVES NOTHING ──────────────────────────────
 * A test that only asserted "failure shows the refusal" would still pass if the
 * refusal were shown unconditionally — which would destroy the CORRECT `null`
 * for a non-member. A non-member must not learn a channel exists. So every
 * failure assertion is paired with success poles asserting the two `return null`
 * behaviours are UNCHANGED.
 *
 * The data comes from GET /api/comms/cap-table/:companyId and
 * GET /api/comms/soft-circle/:roundId; those routes' real answers for the two
 * honest states (`{exists:false}` and `{exists:true,isMember:false}`) are pinned
 * against the REAL registerRoutes stack in
 * `server/__tests__/w60_refusal_routes_http.test.ts`, and this file replays them.
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { CapTableChannelCard, SoftCircleChannelCard } from "../ChannelCards";

/* The two honest bodies the REAL routes return (commsStore.ts:3307, :3309 and
   :3333, :3335), pinned over HTTP in w60_refusal_routes_http.test.ts. */
const BODY_NO_CHANNEL = { exists: false };
const BODY_NOT_MEMBER = { exists: true, isMember: false };

const HAPPY_CAP_TABLE = {
  exists: true,
  isMember: true,
  channel: { id: "ch_ct", displayTitle: "Cap Table", displaySubtitle: "sub", metadata: {} },
  lastMessages: [],
  visibleMemberCount: 3,
  totalMemberCount: 4,
};
const HAPPY_SOFT_CIRCLE = {
  exists: true,
  isMember: true,
  channel: { id: "ch_sc", displayTitle: "Soft Circle", displaySubtitle: "sub", metadata: { roundName: "Seed" } },
  lastMessages: [],
  memberCount: 3,
};

/** Renders one card with a QueryClient whose default queryFn is under our
 *  control, which is how these components fetch (queryKey only, no queryFn). */
function renderCard(which: "cap-table" | "soft-circle", fn: () => Promise<unknown>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: fn as never } },
  });
  return render(
    <QueryClientProvider client={qc}>
      {which === "cap-table" ? (
        <CapTableChannelCard companyId="co_w60" basePath="/founder/messages" />
      ) : (
        <SoftCircleChannelCard roundId="rnd_w60" roundName="Seed" basePath="/founder/messages" />
      )}
    </QueryClientProvider>,
  );
}

const CASES = [
  {
    which: "cap-table" as const,
    testId: "w60-cap-table-channel-error",
    what: "the cap table channel",
    cardId: "card-cap-table-channel",
    buttonId: "button-open-cap-table-channel",
    happy: HAPPY_CAP_TABLE,
  },
  {
    which: "soft-circle" as const,
    testId: "w60-soft-circle-channel-error",
    what: "the soft-circle channel",
    cardId: "card-soft-circle-channel",
    buttonId: "button-open-soft-circle-channel",
    happy: HAPPY_SOFT_CIRCLE,
  },
];

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe.each(CASES)("W60 · A-1 — $which channel card: a failed load is not an absent channel", (c) => {
  it("LOWER POLE — a failed read renders the refusal instead of nothing", async () => {
    renderCard(c.which, async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    const err = await screen.findByTestId(c.testId);
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain(`couldn’t load ${c.what}`);
    expect(err.textContent).toContain("not an empty list");
  });

  it("LOWER POLE — the refusal states no count and no money", async () => {
    renderCard(c.which, async () => {
      throw new ApiError(403, "nope", null, { ok: false });
    });
    const err = await screen.findByTestId(c.testId);
    const text = err.textContent ?? "";
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("$");
    expect(text).not.toContain("%");
  });

  it("LOWER POLE — the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    renderCard(c.which, async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    await screen.findByTestId(c.testId);
    const before = calls;
    fireEvent.click(screen.getByTestId(`${c.testId}-retry`));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("PAUSED POLE — an OFFLINE viewer gets the refusal, not silence", async () => {
    /* The mutation that survives the most: `!q.isLoading && !q.isError` is TRUE
       for a paused query, so an isError-only gate still renders `null` here.
       See LoadFailedRefusal.tsx:20-26. */
    onlineManager.setOnline(false);
    renderCard(c.which, async () => HAPPY_CAP_TABLE);
    await screen.findByTestId(c.testId);
    expect(screen.queryByTestId(c.cardId)).toBeNull();
  });

  it("UPPER POLE A — a SUCCESSFUL {exists:false} still renders NOTHING, and no refusal", async () => {
    /* The honest "there is no channel here" behaviour, unchanged. */
    const { container } = renderCard(c.which, async () => BODY_NO_CHANNEL);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId(c.testId)).toBeNull();
    expect(screen.queryByTestId(c.cardId)).toBeNull();
  });

  it("UPPER POLE B — a SUCCESSFUL {exists:true,isMember:false} still renders NOTHING, and no refusal", async () => {
    /* The scope gate. A non-member must NOT learn that a channel exists, so a
       refusal here would be a privacy regression, not an improvement. */
    const { container } = renderCard(c.which, async () => BODY_NOT_MEMBER);
    await waitFor(() => expect(container.innerHTML).toBe(""));
    expect(screen.queryByTestId(c.testId)).toBeNull();
  });

  it("UPPER POLE C — a happy payload still renders the card, its badge, the empty-message fallback and the open button", async () => {
    renderCard(c.which, async () => c.happy);
    expect(await screen.findByTestId(c.cardId)).toBeTruthy();
    expect(screen.getByTestId(c.buttonId)).toBeTruthy();
    /* NO SILENT DROP — the honest per-channel empty state at :84 / :144. */
    expect(screen.getByText("No messages yet.")).toBeTruthy();
    expect(screen.queryByTestId(c.testId)).toBeNull();
  });
});
