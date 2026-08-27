/**
 * WAVE 167 · TASK 3.1 — the dashboard Messages panel must not render a FAILURE
 * as an EMPTY INBOX.
 *
 * THE DEFECT, MEASURED ON LIVE. The panel stayed "No conversations yet." through
 * invites, commitments and a published post. `MessagesWidget` had no `isError`
 * branch, and a failed `useQuery` has `data === undefined` with
 * `isLoading === false`, so the empty condition
 * (`!channels.isLoading && visible.length === 0`) was TRUE on failure. A 500, an
 * expired session and an offline network all rendered as a calm, confident,
 * WRONG statement that the user has no conversations — the worst kind of bug,
 * because the user believes it and never reports it.
 *
 * These tests assert the RENDERED DOM (R137.1), not the query state, and they
 * assert the three states are MUTUALLY EXCLUSIVE — the emptiness copy must be
 * absent on failure, which is the actual claim. A test that only checked the new
 * error text would still pass if both rendered at once.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessagesWidget } from "../MessagesWidget";

vi.mock("wouter", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  useLocation: () => ["/founder/dashboard", vi.fn()],
}));

/** The exact literal that was wrongly shown on failure. Held in one place so a
 *  reworded empty state cannot make these tests vacuously pass. */
const EMPTY_COPY = "No conversations yet.";

function mount(queryFn: () => Promise<unknown>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: queryFn as never } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MessagesWidget basePath="/founder/messages" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WAVE 167 · TASK 3.1 — MessagesWidget failure is not emptiness", () => {
  it("E-1 a FAILED channels query renders a visible failure, not the empty state", async () => {
    mount(async () => {
      throw new Error("HTTP 500");
    });

    const failed = await waitFor(() => screen.getByTestId("widget-messages-failed"));
    expect(failed).toBeTruthy();
    /* THE LOAD-BEARING ASSERTION: the wrong copy is GONE. */
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it("E-2 the failure copy is PLAIN LANGUAGE — no status codes, no raw keys (R77)", async () => {
    mount(async () => {
      throw new Error("HTTP 500");
    });
    const text = (await waitFor(() => screen.getByTestId("widget-messages-failed"))).textContent ?? "";

    /* It must say what happened, whose fault it is and what to do next. */
    expect(text).toContain("couldn");
    expect(text.toLowerCase()).toContain("refresh");
    /* And it must not leak the machine's vocabulary at the user. */
    expect(text).not.toContain("500");
    expect(text).not.toContain("isError");
    expect(text).not.toContain("/api/");
    expect(text).not.toContain("undefined");
    expect(text).not.toMatch(/[A-Z_]{4,}/);
  });

  it("E-3 a GENUINELY EMPTY inbox still says exactly the original words", async () => {
    /* The original copy is RESTORED VERBATIM, not replaced — it was always
       correct for this one case, and the guard scores a replaced text node as a
       removed copy string. */
    mount(async () => []);
    await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
    expect(screen.queryByTestId("widget-messages-failed")).toBeNull();
  });

  it("E-4 a NON-EMPTY inbox renders neither the empty state nor the failure", async () => {
    mount(async () => [
      {
        id: "ch_w167",
        kind: "dm",
        displayTitle: "Wave167 Thread",
        displaySubtitle: "sub",
        unread: 0,
        starred: false,
        kindBadge: "Direct",
        participantUserIds: ["u_a", "u_b"],
        lastMessage: { id: "m1", preview: "hello", senderLabel: "Alpha Person", ts: "2026-08-26T00:00:00Z" },
      },
    ]);

    await waitFor(() => expect(screen.getByText("Wave167 Thread")).toBeTruthy());
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByTestId("widget-messages-failed")).toBeNull();
  });

  it("E-5 the three states are MUTUALLY EXCLUSIVE across every outcome", async () => {
    /* Enumerated rather than asserted once, because the defect was precisely two
       conditions being simultaneously satisfiable. */
    const cases: Array<{ name: string; fn: () => Promise<unknown>; expect: "failed" | "empty" | "list" }> = [
      { name: "throw", fn: async () => { throw new Error("boom"); }, expect: "failed" },
      { name: "empty array", fn: async () => [], expect: "empty" },
      {
        name: "only hidden kinds",
        /* `network` and `company_followers` are filtered out of this widget, so
           this is a genuinely-empty LIST — not a failure. */
        fn: async () => [
          { id: "ch_n", kind: "network", displayTitle: "N", displaySubtitle: "", unread: 0, starred: false, kindBadge: "N", participantUserIds: [] },
        ],
        expect: "empty",
      },
    ];

    for (const c of cases) {
      mount(c.fn);
      if (c.expect === "failed") {
        await waitFor(() => expect(screen.getByTestId("widget-messages-failed")).toBeTruthy());
        expect(screen.queryByText(EMPTY_COPY)).toBeNull();
      } else {
        await waitFor(() => expect(screen.getByText(EMPTY_COPY)).toBeTruthy());
        expect(screen.queryByTestId("widget-messages-failed")).toBeNull();
      }
      cleanup();
    }
  });
});
