/**
 * WAVE 16 — ORP-044 client half: the founder-facing broadcast surface.
 *
 * ANTI-VACUITY. The engine's two routes were live and registered
 * (server/routes.ts:1271) with ZERO callers tree-wide, so "the component renders"
 * proves nothing. What is asserted is the wiring contract with the server as it
 * actually reads the request:
 *   · GET carries the companyId filter the ownership guard requires
 *     (milestoneBroadcastStore.ts:184 — an unfiltered GET is admin-only).
 *   · POST body keys match `broadcastCreateSchema` (`:32`) exactly, and
 *     `segmentValue` is OMITTED rather than sent as null, because the zod field is
 *     `.optional()` not `.nullable()` — a null would 400.
 *   · the 500-char cap (`:36`) is enforced client-side in BOTH directions: send is
 *     blocked over the limit and permitted under it.
 *   · the honest-copy rules hold: the segment caveat appears only for a segmented
 *     audience and is absent for "all"; the delivered count renders from
 *     `deliveredInApp`, and a legacy record without that field says so rather than
 *     silently showing zero as if nothing arrived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MilestoneBroadcastPanel } from "../MilestoneBroadcastPanel";

const COMPANY_ID = "co_orp044";

let history: Array<Record<string, unknown>> = [];
let postResult: Record<string, unknown> = {};
const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

beforeEach(() => {
  history = [];
  calls.length = 0;
  postResult = { id: "bc_1", recipientUserIds: ["u_1", "u_2"], deliveredInApp: 2 };
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string, body?: Record<string, unknown>) => {
    calls.push({ method, url, body });
    if (method === "GET") return jsonResponse({ items: history });
    return jsonResponse(postResult);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel(companyId = COMPANY_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MilestoneBroadcastPanel companyId={companyId} />
    </QueryClientProvider>,
  );
}

describe("ORP-044 — the founder can read and send broadcasts", () => {
  it("reads the company's broadcasts with the companyId filter the ownership guard needs", async () => {
    renderPanel();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`/api/founder/broadcasts?companyId=${COMPANY_ID}`);
  });

  it("posts a body matching the server's zod schema, omitting segmentValue for 'all'", async () => {
    renderPanel();
    fireEvent.change(await screen.findByTestId("broadcast-body"), { target: { value: "Round closed at $4.2M." } });
    fireEvent.click(screen.getByTestId("broadcast-send"));

    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/founder/broadcasts");
    expect(post.body).toEqual({
      companyId: COMPANY_ID,
      segmentKind: "all",
      body: "Round closed at $4.2M.",
      trigger: "manual",
    });
    // Explicitly NOT null — a null segmentValue fails `.optional()` validation.
    expect("segmentValue" in (post.body as object)).toBe(false);
  });

  it("sends segmentValue only when a segmented audience supplies one", async () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("broadcast-segment"), { target: { value: "by_region" } });
    fireEvent.change(screen.getByTestId("broadcast-segment-value"), { target: { value: " EMEA " } });
    fireEvent.change(screen.getByTestId("broadcast-body"), { target: { value: "Regional note" } });
    fireEvent.click(screen.getByTestId("broadcast-send"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body!.segmentKind).toBe("by_region");
    expect(post.body!.segmentValue).toBe("EMEA");
  });

  it("blocks an empty message and permits a non-empty one", async () => {
    renderPanel();
    const send = await screen.findByTestId("broadcast-send");
    expect(isDisabled(send)).toBe(true);
    fireEvent.change(screen.getByTestId("broadcast-body"), { target: { value: "x" } });
    expect(isDisabled(send)).toBe(false);
  });

  it("enforces the server's 500-character cap in both directions", async () => {
    renderPanel();
    const box = await screen.findByTestId("broadcast-body");
    fireEvent.change(box, { target: { value: "a".repeat(500) } });
    expect(screen.getByTestId("broadcast-remaining").textContent).toContain("0 characters remaining");
    expect(isDisabled(screen.getByTestId("broadcast-send"))).toBe(false);
    fireEvent.change(box, { target: { value: "a".repeat(501) } });
    expect(isDisabled(screen.getByTestId("broadcast-send"))).toBe(true);
  });
});

describe("ORP-044 — the copy tells the truth about delivery", () => {
  it("never promises email, because no template exists for it", async () => {
    renderPanel();
    const note = await screen.findByTestId("broadcast-audience-note");
    expect(note.textContent).toMatch(/in-app notification/i);
    expect(note.textContent).toMatch(/email delivery is not enabled/i);
  });

  it("warns that a segmented audience is not actually filtered — and only then", async () => {
    renderPanel();
    expect(screen.queryByTestId("broadcast-segment-caveat")).toBe(null); // pole 1: "all"
    fireEvent.change(screen.getByTestId("broadcast-segment"), { target: { value: "by_stage" } });
    const caveat = await screen.findByTestId("broadcast-segment-caveat"); // pole 2
    expect(caveat.textContent).toMatch(/every committed investor/i);
  });

  it("shows the DELIVERED count for a modern record", async () => {
    history = [
      {
        id: "bc_a",
        companyId: COMPANY_ID,
        founderUserId: "u_f",
        segmentKind: "all",
        body: "Closed!",
        trigger: "manual",
        recipientUserIds: ["u_1", "u_2", "u_3"],
        deliveredInApp: 2,
        ts: "2026-08-01T00:00:00.000Z",
      },
    ];
    renderPanel();
    expect((await screen.findByTestId("broadcast-recipients-bc_a")).textContent).toContain("3 recipients");
    expect(screen.getByTestId("broadcast-delivered-bc_a").textContent).toContain("2 notified");
    expect(screen.queryByTestId("broadcast-history-empty")).toBe(null);
  });

  it("says delivery was not recorded for a legacy record instead of implying zero arrivals", async () => {
    history = [
      {
        id: "bc_old",
        companyId: COMPANY_ID,
        founderUserId: "u_f",
        segmentKind: "all",
        body: "Pre-Wave-16",
        trigger: "manual",
        recipientUserIds: ["u_1"],
        ts: "2026-01-01T00:00:00.000Z",
      },
    ];
    renderPanel();
    const cell = await screen.findByTestId("broadcast-delivered-bc_old");
    expect(cell.textContent).toContain("delivery not recorded");
    expect(cell.textContent).not.toContain("0 notified");
  });

  it("shows an explicit empty state when nothing has been sent (opposite pole)", async () => {
    history = [];
    renderPanel();
    expect((await screen.findByTestId("broadcast-history-empty")).textContent).toMatch(/no milestone broadcasts/i);
  });

  it("renders nothing at all without a company, rather than firing an unscoped read", () => {
    renderPanel("");
    expect(screen.queryByTestId("card-milestone-broadcast")).toBe(null);
    expect(calls.length).toBe(0);
  });
});
