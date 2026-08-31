/* ════════════════════════════════════════════════════════════════════════════
   WAVE 200 · ITEM A (R173.8) + ITEM B history panel (R173.9.2), ON RENDERED DOM.
   ════════════════════════════════════════════════════════════════════════════
   Item A's server fix makes a contact's `kind` survive the write. That is only
   half the ruling: the owner requires the change to be "dynamically reflected on
   all other instances". A source-text assertion cannot show that, and R137 exists
   because a fix once passed every test without reaching the user. So these tests
   mount the REAL `AdminInvestorDetail` page and read the rendered document.

   HOW PROPAGATION IS PROVEN HERE: the same contact id is served twice, once with
   `kind: "investor"` and once with `kind: "founder"`, and the page is asserted to
   render whatever the server now holds — the header line, the kind badge, and the
   kind-conditional tab set all move. Combined with the server-side proof that the
   new kind is what a later GET returns (server/__tests__/wave200_items_ab.test.ts),
   that is propagation end to end.

   `apiRequest` is mocked because this page reads every panel through it (the
   wave-188 admin pattern); the component, its badges, its tab logic and its
   history panel are all real.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";

let contactResponse: unknown;
let historyResponse: unknown;

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useRoute: () => [true, { id: "ac_w200_contact" }],
    useLocation: () => ["/admin/investors/ac_w200_contact", vi.fn()],
    useSearch: () => "",
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

vi.mock("@/lib/queryClient", () => {
  const client = { invalidateQueries: vi.fn(), setQueryData: vi.fn(), getQueryData: vi.fn(), clear: vi.fn() };
  return {
    queryClient: client,
    apiRequest: vi.fn(async (_method: string, url: string) => {
      const body = url.endsWith("/history") ? historyResponse : contactResponse;
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  };
});

vi.mock("@/components/admin/KycDocumentsPanel", () => ({
  KycDocumentsPanel: () => <div>kyc</div>,
  default: () => <div>kyc</div>,
}));

import AdminInvestorDetail from "../InvestorDetail";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";

function contact(kind: string, notes = "") {
  return {
    ok: true,
    contact: {
      id: "ac_w200_contact",
      kind,
      legalName: "W200 Holdings",
      displayName: "W200 Holdings",
      email: "w200@example.com",
      type: "institutional",
      status: "active",
      verification: "unverified",
      hqCity: "New York",
      hqCountry: "US",
      region: "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: null,
      partnerSince: null,
      phone: null,
      website: null,
      linkedinUrl: null,
      tags: [],
      notes,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      createdBy: "u_admin",
      updatedBy: "u_admin",
      version: 2,
      prevRevisionHash: "a".repeat(64),
      revisionHash: "b".repeat(64),
    },
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RoleProvider>
        <AdminInvestorDetail />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  contactResponse = contact("investor");
  historyResponse = { ok: true, history: [], chain: { ok: true, totalRevisions: 0 } };
});

afterEach(() => cleanup());

describe("WAVE 200 Item A — the contact detail surface reflects the persisted kind", () => {
  it("renders the kind the server holds, and renders a DIFFERENT kind when the server holds that instead", async () => {
    contactResponse = contact("investor");
    mount();
    expect((await screen.findAllByText("W200 Holdings")).length).toBeGreaterThan(0);
    /* POSITIVE: kind badge and the kind-conditional tabs for an investor. */
    expect(screen.getByText("Investor")).toBeTruthy();
    expect(screen.getByTestId("tab-investor-profile")).toBeTruthy();
    expect(screen.queryByTestId("tab-founder-links")).toBeNull();

    cleanup();

    /* The SAME contact, after an admin changed its type and the change now
       persists. Nothing about the page changed — only the stored value. */
    contactResponse = contact("founder");
    mount();
    expect((await screen.findAllByText("W200 Holdings")).length).toBeGreaterThan(0);
    expect(screen.getByText("Founder")).toBeTruthy();
    expect(screen.getByTestId("tab-founder-links")).toBeTruthy();
    /* PAIRED NEGATIVE: the investor-only surface is gone, so the kind genuinely
       drives the page rather than both branches always rendering. */
    expect(screen.queryByTestId("tab-investor-profile")).toBeNull();
  });

  it("renders consortium_partner as its own labelled kind with its own settings tab", async () => {
    contactResponse = contact("consortium_partner");
    mount();
    expect((await screen.findAllByText("W200 Holdings")).length).toBeGreaterThan(0);
    expect(screen.getByText("Consortium Partner")).toBeTruthy();
    expect(screen.getByTestId("tab-partner-settings")).toBeTruthy();
  });
});

describe("WAVE 200 Item B — earlier note text is readable on the contact's History tab", () => {
  it("shows each earlier version of the notes string with its version, author and time", async () => {
    contactResponse = contact("investor", "THIRD AND CURRENT NOTE");
    historyResponse = {
      ok: true,
      chain: { ok: true, totalRevisions: 3 },
      history: [
        { contactId: "ac_w200_contact", version: 1, prevRevisionHash: "0".repeat(64), revisionHash: "1".repeat(64), updatedAt: "2026-01-01T00:00:00.000Z", updatedBy: "u_admin", action: "contact.created", snapshot: { notes: "FIRST NOTE TEXT" } },
        { contactId: "ac_w200_contact", version: 2, prevRevisionHash: "1".repeat(64), revisionHash: "2".repeat(64), updatedAt: "2026-01-02T00:00:00.000Z", updatedBy: "u_second_admin", action: "contact.updated", snapshot: { notes: "SECOND NOTE TEXT" } },
        { contactId: "ac_w200_contact", version: 3, prevRevisionHash: "2".repeat(64), revisionHash: "3".repeat(64), updatedAt: "2026-01-03T00:00:00.000Z", updatedBy: "u_admin", action: "contact.updated", snapshot: { notes: "THIRD AND CURRENT NOTE" } },
      ],
    };
    mount();
    expect((await screen.findAllByText("W200 Holdings")).length).toBeGreaterThan(0);
    /* The panel lives on the History tab, so the test navigates there the way an
       admin would rather than force-mounting hidden content. */
    /* Radix activates a tab on mousedown, so a bare `click` leaves the panel
       unmounted — the debug run showed data-state="inactive". Dispatching both is
       what a real pointer does. */
    fireEvent.mouseDown(screen.getByTestId("tab-history"));
    fireEvent.click(screen.getByTestId("tab-history"));

    const panel = await waitFor(() => screen.getByTestId("panel-notes-history"));
    /* THE RULING: text an admin overwrote is readable, not silently replaced. */
    expect(within(panel).getByText("FIRST NOTE TEXT")).toBeTruthy();
    expect(within(panel).getByText("SECOND NOTE TEXT")).toBeTruthy();
    /* Attribution travels with each version. */
    expect(within(panel).getByTestId("notes-history-v2").textContent).toContain("u_second_admin");
    /* PAIRED NEGATIVE on the same screen: the existing revision table is
       untouched and still renders its own rows (R143.1 — no cell was added). */
    expect(screen.getByTestId("table-history")).toBeTruthy();
    expect(screen.getByTestId("row-revision-2")).toBeTruthy();
  });

  it("says plainly that nothing was recorded rather than rendering a blank panel", async () => {
    contactResponse = contact("investor");
    historyResponse = { ok: true, history: [], chain: { ok: true, totalRevisions: 0 } };
    mount();
    expect((await screen.findAllByText("W200 Holdings")).length).toBeGreaterThan(0);
    /* Radix activates a tab on mousedown, so a bare `click` leaves the panel
       unmounted — the debug run showed data-state="inactive". Dispatching both is
       what a real pointer does. */
    fireEvent.mouseDown(screen.getByTestId("tab-history"));
    fireEvent.click(screen.getByTestId("tab-history"));
    const panel = await waitFor(() => screen.getByTestId("panel-notes-history"));
    expect(within(panel).getByTestId("notes-history-empty").textContent).toContain(
      "No earlier note text has been recorded for this contact yet.",
    );
  });
});
