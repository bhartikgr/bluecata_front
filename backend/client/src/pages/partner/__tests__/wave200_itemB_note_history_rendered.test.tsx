/* ════════════════════════════════════════════════════════════════════════════
   WAVE 200 · ITEM B — R173.9, PROVEN ON RENDERED DOM.
   ════════════════════════════════════════════════════════════════════════════
   R137's lesson is that a fix can pass every test and never reach the user, so
   nothing here mounts an extracted layer or asserts on source text. Every test
   mounts the REAL default export of `PartnerNotes` and reads text out of the
   rendered document.

   `fetch` is stubbed and `apiRequest` is NOT, for the same reason wave 196 gave:
   the seam under test is what the page renders from a real response, so the real
   `apiRequest` and the real react-query wiring must run.

   ANTI-VACUITY: "the history is shown" would also pass on a page that rendered
   the whole response blob, and "the deleted note is gone" passes on a page that
   crashed and rendered nothing. So every negative assertion below is paired with
   a positive one on the SAME mounted screen, and the pre-existing note copy is
   asserted to still render verbatim (R143.1 — this wave appended siblings inside
   the existing <li>, it reworded nothing).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useSearch: () => "",
    useLocation: () => ["/collective/partner/notes", vi.fn()],
    useRoute: () => [false, {}],
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_partner_w200",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w200", email: "partner@example.com", name: "W200 Partner" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

import PartnerNotes from "../PartnerNotes";
import { QueryClientProvider } from "@tanstack/react-query";
/* The page invalidates through the APP's query client singleton, exactly as it
   does in the running app, so the test mounts that same client rather than a
   fresh one — otherwise the delete would invalidate a client nothing renders
   from and this test would prove nothing about the real refetch. */
import { queryClient as appQueryClient } from "@/lib/queryClient";

function jsonRes(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => jsonRes(status, body),
  } as unknown as Response;
}

/** A note carrying the entry series the store now returns: `body` is the
 *  ORIGINAL text, later additions are entries 2..n with their own author/date. */
const NOTE_WITH_HISTORY = {
  id: "pnote_hist",
  title: "Diligence call",
  body: "ORIGINAL TEXT FROM MAY",
  scope: "general",
  scopeId: null,
  updatedAt: "2026-08-01T10:00:00.000Z",
  authorUserId: "u_first_author",
  entries: [
    { seq: 1, body: "ORIGINAL TEXT FROM MAY", authorUserId: "u_first_author", createdAt: "2026-05-01T10:00:00.000Z" },
    { seq: 2, body: "ADDED IN JUNE BY SOMEONE ELSE", authorUserId: "u_second_author", createdAt: "2026-06-02T10:00:00.000Z" },
    { seq: 3, body: "ADDED IN JULY", authorUserId: "u_third_author", createdAt: "2026-07-03T10:00:00.000Z" },
  ],
};

/** A note written before this wave: no `entries` key at all. The server derives
 *  its single original entry, so the page must not break and must not invent a
 *  history section for it. */
const LEGACY_NOTE = {
  id: "pnote_legacy",
  title: "Legacy note",
  body: "LEGACY BODY NEVER EDITED",
  scope: "general",
  scopeId: null,
  updatedAt: "2026-02-02T10:00:00.000Z",
  authorUserId: "u_first_author",
  entries: [
    { seq: 1, body: "LEGACY BODY NEVER EDITED", authorUserId: "u_first_author", createdAt: "2026-02-02T10:00:00.000Z" },
  ],
};

let notesInResponse: unknown[] = [];
let fetchCalls: Array<{ method: string; url: string }> = [];
let fetchSpy: ReturnType<typeof vi.fn>;

function mount() {
  appQueryClient.clear();
  appQueryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 } });
  return render(
    <QueryClientProvider client={appQueryClient}>
      <PartnerNotes />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  notesInResponse = [];
  fetchCalls = [];
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    fetchCalls.push({ method, url });
    if (method === "DELETE") {
      notesInResponse = notesInResponse.filter((n) => !url.endsWith((n as { id: string }).id));
      return jsonRes(200, { ok: true });
    }
    if (url.includes("/api/partner/me/notes")) return jsonRes(200, { notes: notesInResponse });
    if (url.includes("/api/partner/me/clients")) return jsonRes(200, { clients: [] });
    return jsonRes(200, {});
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WAVE 200 Item B — an edited note shows its history on the page the partner uses", () => {
  it("renders the ORIGINAL text and every later entry, each with its own author", async () => {
    notesInResponse = [NOTE_WITH_HISTORY];
    mount();

    /* POSITIVE: the note the partner already saw still renders, verbatim. */
    expect(await screen.findByText("Diligence call")).toBeTruthy();
    expect(screen.getByText("ORIGINAL TEXT FROM MAY")).toBeTruthy();

    /* THE RULING: later text was ADDED, not substituted — both are on screen. */
    const li = screen.getByTestId(`note-${NOTE_WITH_HISTORY.id}`);
    const history = within(li).getByTestId(`note-history-${NOTE_WITH_HISTORY.id}`);
    expect(within(history).getByText("ADDED IN JUNE BY SOMEONE ELSE")).toBeTruthy();
    expect(within(history).getByText("ADDED IN JULY")).toBeTruthy();

    /* Each addition carries WHO added it — the fact R173.9.1 asks to survive. */
    expect(within(history).getByTestId(`note-entry-${NOTE_WITH_HISTORY.id}-2`).textContent).toContain("u_second_author");
    expect(within(history).getByTestId(`note-entry-${NOTE_WITH_HISTORY.id}-3`).textContent).toContain("u_third_author");
  });

  it("does not show a history section for a note that has never been edited", async () => {
    notesInResponse = [LEGACY_NOTE];
    mount();

    /* PAIRED POSITIVE — proves the screen rendered at all before the absence
       below is allowed to mean anything. */
    expect(await screen.findByText("Legacy note")).toBeTruthy();
    expect(screen.getByText("LEGACY BODY NEVER EDITED")).toBeTruthy();
    expect(screen.queryByTestId(`note-history-${LEGACY_NOTE.id}`)).toBeNull();
  });

  it("offers a delete control that calls DELETE and stops showing that note, while other notes remain", async () => {
    notesInResponse = [NOTE_WITH_HISTORY, LEGACY_NOTE];
    mount();

    expect(await screen.findByText("Diligence call")).toBeTruthy();
    expect(screen.getByText("Legacy note")).toBeTruthy();

    /* The owner asked for the option to delete; before this wave the page had
       none, so this control's existence is itself part of the ruling. */
    const del = screen.getByTestId(`note-delete-${NOTE_WITH_HISTORY.id}`);
    expect(del.textContent).toContain("Delete note");
    /* The page tells the partner the erasure is recorded. */
    expect(screen.getByTestId(`note-${NOTE_WITH_HISTORY.id}`).textContent).toContain(
      "Deleting a note is recorded in the audit log.",
    );

    fireEvent.click(del);

    await waitFor(() =>
      expect(
        fetchCalls.some((c) => c.method === "DELETE" && c.url.includes(`/api/partner/me/notes/${NOTE_WITH_HISTORY.id}`)),
      ).toBe(true),
    );

    /* NEGATIVE, paired with the positive on the same screen: the deleted note is
       gone from what the user sees and the other note is still there, so this
       cannot be passed by a blank render. */
    await waitFor(() => expect(screen.queryByText("Diligence call")).toBeNull());
    expect(screen.getByText("Legacy note")).toBeTruthy();
  });

  it("keeps the pre-existing empty state and scope filter copy byte-verbatim (R143.1)", async () => {
    notesInResponse = [];
    mount();
    expect(await screen.findByText("No notes yet.")).toBeTruthy();
    expect(screen.getByText("All notes")).toBeTruthy();
    expect(screen.getByTestId("notes-scope-filter")).toBeTruthy();
  });
});
