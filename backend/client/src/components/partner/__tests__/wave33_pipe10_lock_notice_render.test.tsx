/**
 * WAVE 33 · CP-PIPE-10 — the LOCK 1 notice, RENDERED.
 *
 * WHY THIS FILE EXISTS. The first mutation pass left M26 alive: forcing the
 * "supplied" branch to be taken always — which renders `{q.data.text}`, i.e.
 * NOTHING, where the lock wording belongs — survived every server-side and
 * source-scan assertion. A blank panel is the single worst outcome of this
 * item: an unsatisfied lock rendered as silence looks satisfied.
 *
 * COVERAGE GAP, not an equivalent mutant. Only rendering the component can see
 * which branch it takes, so the component is rendered here, both poles, with
 * the fetch mocked at the API boundary rather than the component's internals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import Lock1NoticePanel from "../Lock1NoticePanel";

/** The server's exact not-supplied sentence, as the route emits it. */
const NOT_SUPPLIED =
  "The wording for this lock has not been supplied by the owner, so it is not shown. It is deliberately not summarised or approximated: an approximate lock is not a lock. This notice will be replaced by the exact text once it is provided.";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <Lock1NoticePanel />
    </QueryClientProvider>,
  );
}

function respond(body: unknown) {
  apiRequestMock.mockResolvedValue({ json: async () => body });
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("the notice with NO wording supplied — the shipped state", () => {
  it("renders the server's not-supplied notice, and renders it VISIBLY", async () => {
    respond({ key: "LOCK_1", supplied: false, text: null, copy: NOT_SUPPLIED, setAt: null });
    renderPanel();
    const el = await screen.findByTestId("lock1-notice-not-supplied");
    // Content, not merely the element: an empty node satisfies "the element
    // exists" and says nothing (this build's recurring lesson).
    expect(el.textContent).toBe(NOT_SUPPLIED);
    expect(screen.queryByTestId("lock1-notice-text")).toBeNull();
  });

  it("KILLS M26 — the panel is never blank where the lock wording belongs", async () => {
    respond({ key: "LOCK_1", supplied: false, text: null, copy: NOT_SUPPLIED, setAt: null });
    const { container } = renderPanel();
    await screen.findByTestId("lock1-notice-not-supplied");
    // Forcing the "supplied" branch renders `{null}` here. Measured on the
    // rendered text, so no source assertion can substitute for it.
    expect(container.textContent).toContain("has not been supplied");
    expect(container.textContent!.length).toBeGreaterThan(NOT_SUPPLIED.length);
  });

  it("does not fabricate, summarise or hint at a wording", async () => {
    respond({ key: "LOCK_1", supplied: false, text: null, copy: NOT_SUPPLIED, setAt: null });
    const { container } = renderPanel();
    await screen.findByTestId("lock1-notice-not-supplied");
    const txt = container.textContent ?? "";
    expect(txt).not.toMatch(/hereby|whereas|shall not|LOCK 1 requires/i);
  });
});

describe("the notice WITH wording supplied — the owner's text, verbatim", () => {
  const WORDING = "OWNER TEXT §1.  Exactly as pasted, with  double spaces.";

  it("prints the owner's text and drops the not-supplied notice entirely", async () => {
    respond({
      key: "LOCK_1",
      supplied: true,
      text: WORDING,
      copy: WORDING,
      setAt: "2026-08-11T00:00:00.000Z",
    });
    const { container } = renderPanel();
    const el = await screen.findByTestId("lock1-notice-text");
    expect(el.textContent).toBe(WORDING);
    expect(screen.queryByTestId("lock1-notice-not-supplied")).toBeNull();
    expect(container.textContent).not.toContain("has not been supplied");
  });

  it("wraps nothing around the wording — no label, no quotes", async () => {
    respond({ key: "LOCK_1", supplied: true, text: WORDING, copy: WORDING, setAt: null });
    renderPanel();
    const el = await screen.findByTestId("lock1-notice-text");
    expect(el.textContent).toBe(WORDING);
    // The other pole of the date: absent, so it says so rather than inventing one.
    const meta = await screen.findByTestId("lock1-notice-supplied-at");
    expect(meta.textContent).toMatch(/not available/i);
  });
});

describe("a read failure is NOT the same as an unsupplied wording", () => {
  it("states that the notice could not be read, and claims nothing about the lock", async () => {
    apiRequestMock.mockRejectedValue(new Error("network down"));
    renderPanel();
    await waitFor(async () => {
      const el = await screen.findByTestId("lock1-notice-unavailable");
      expect(el.textContent).toMatch(/could not be read/i);
    });
    expect(screen.queryByTestId("lock1-notice-not-supplied")).toBeNull();
    expect(screen.queryByTestId("lock1-notice-text")).toBeNull();
  });
});
