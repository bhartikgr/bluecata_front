/**
 * WAVE 203 · ITEM A.4 — THE SECOND LISTING WITH THE SAME DEFECT, PROVEN ON DOM.
 *
 * R178.5 is stated as a general rule, not as a fix to one screen: "A newest-last
 * default is a defect wherever it appears." The audit sweep in W203_PREFLIGHT.md
 * §1.6 checked twelve record-like listings end to end (server order AND client
 * order for each) and found exactly one other of the same class:
 *
 *   `partnerNotesStore.listByPartner` (server/partnerWorkspaceStore.ts:2657-2665)
 *   filters and maps the stored notes and never orders them at all, and
 *   `PartnerNotes.tsx` rendered `(q.data?.notes ?? []).map(...)` — so the list
 *   came out in INSERTION order. A partner's newest note was at the bottom.
 *
 * WHY THIS MOUNTS THE REAL PAGE (handbook §8). The ordering was added inside the
 * component that renders the list, so a test against a helper in isolation would
 * not establish that the rendered page is ordered. `PartnerNotes` itself is
 * mounted and the `<li data-testid="note-...">` order is read from `document`.
 *
 * THE FIXTURE IS SHUFFLED ON PURPOSE and includes a note with NO `updatedAt`,
 * because R176.1 is live here: a missing date must not be compared as if it were
 * a date. The undated note must still be rendered — dropping it, or silently
 * dating it, would be a worse defect than the ordering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_partner_w203",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w203", email: "partner@example.com", name: "W203 Partner" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return {
    ...actual,
    PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

/** Insertion order as the store would return it: middle, oldest, newest, undated. */
const NOTES = [
  { id: "n_middle", title: "Middle note", body: "b", scope: "general", scopeId: null, updatedAt: "2026-08-14T10:00:00.000Z", authorUserId: "u_w203" },
  { id: "n_oldest", title: "Oldest note", body: "b", scope: "general", scopeId: null, updatedAt: "2026-08-02T10:00:00.000Z", authorUserId: "u_w203" },
  { id: "n_newest", title: "Newest note", body: "b", scope: "general", scopeId: null, updatedAt: "2026-08-27T10:00:00.000Z", authorUserId: "u_w203" },
  /* No `updatedAt` at all — the R176.1 case. Declared `string` in the interface,
     but the render has guarded it against null since v25.16 (NM6), so the data
     really can arrive without one. */
  { id: "n_undated", title: "Undated note", body: "b", scope: "general", scopeId: null, authorUserId: "u_w203" },
] as unknown[];

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn() },
  apiRequest: vi.fn(async (_method: string, url: string) => {
    const body = url.startsWith("/api/partner/me/notes")
      ? { notes: NOTES }
      : url.startsWith("/api/partner/me/clients")
        ? { clients: [] }
        : {};
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }),
  getQueryFn: () => async () => ({}),
}));

import PartnerNotes from "../PartnerNotes";

function Wrap({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<QueryClient | null>(null);
  if (!ref.current) {
    ref.current = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
    });
  }
  return <QueryClientProvider client={ref.current}>{children}</QueryClientProvider>;
}

function renderedNoteIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="note-"]'))
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((t) => /^note-n_/.test(t))
    .map((t) => t.replace(/^note-/, ""));
}

afterEach(() => cleanup());

describe("WAVE 203 · A.4 — partner notes open on the newest note", () => {
  it("renders the newest note FIRST, though the server returned insertion order", async () => {
    render(
      <Wrap>
        <PartnerNotes />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByTestId("note-n_newest")).toBeTruthy());
    const ids = renderedNoteIds();
    /* Nothing was dropped by the ordering. */
    expect(ids.length).toBe(4);
    expect(ids[0]).toBe("n_newest");
    expect(ids[1]).toBe("n_middle");
    expect(ids[2]).toBe("n_oldest");
  });

  it("keeps the undated note visible and never ranks it as if it had a date (R176.1)", async () => {
    render(
      <Wrap>
        <PartnerNotes />
      </Wrap>,
    );
    await waitFor(() => expect(screen.getByTestId("note-n_undated")).toBeTruthy());
    const ids = renderedNoteIds();
    /* It is present — the strongest part of the claim. */
    expect(ids).toContain("n_undated");
    /* It sits after the dated notes, as a group, rather than being sorted as if
       its date were the empty string (which would have ranked it oldest — an
       assertion about its age that the record does not support). */
    expect(ids.indexOf("n_undated")).toBe(3);
    /* And the row still renders the em-dash placeholder rather than a date. */
    expect(screen.getByTestId("note-n_undated").textContent).toContain("—");
  });
});
