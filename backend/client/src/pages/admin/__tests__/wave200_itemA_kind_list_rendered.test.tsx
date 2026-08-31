/* ════════════════════════════════════════════════════════════════════════════
   WAVE 200 · ITEM A — THE CONTACTS CRM LIST, PROVEN ON RENDERED DOM.
   ════════════════════════════════════════════════════════════════════════════
   R173.8's requirement is that a contact-type change is "dynamically reflected
   on all other instances". The list page is the instance the owner looks at
   first: it carries the Kind column, the four kind tabs (which filter server
   side by `?kind=`) and the Founders / Consortium-partners counters.

   This mounts the REAL `AdminInvestors` page. The fetch layer here is a fixture
   that HONOURS `?kind=`, exactly as the server route does, so switching tabs
   really re-queries and the rendered rows really depend on the stored kind. The
   proof that the stored kind is the NEW one after a write is the server test
   (server/__tests__/wave200_items_ab.test.ts); this file proves the surfaces
   follow it rather than a hardcoded or stale value.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within, fireEvent } from "@testing-library/react";

/** The one contact under test, plus one contact of each other kind so that every
 *  assertion below has a paired control that must NOT move. */
let storedKind = "investor";

const OTHER_INVESTOR = mk("ac_other_investor", "Other Investor Ltd", "investor");
const OTHER_FOUNDER = mk("ac_other_founder", "Other Founder Inc", "founder");

function mk(id: string, legalName: string, kind: string) {
  return {
    id,
    kind,
    legalName,
    displayName: legalName,
    email: `${id}@example.com`,
    type: "institutional",
    status: "active",
    verification: "unverified",
    region: "US",
    aumMinor: null,
    aumCurrency: "USD",
    checkSizeMinMinor: null,
    checkSizeMaxMinor: null,
    companyIds: [],
    partnerWeight: null,
    partnerSince: null,
    tags: [],
    updatedAt: "2026-01-02T00:00:00.000Z",
    version: 1,
  };
}

function allContacts() {
  return [mk("ac_w200_contact", "W200 Holdings", storedKind), OTHER_INVESTOR, OTHER_FOUNDER];
}

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useRoute: () => [true, {}],
    useLocation: () => ["/admin/investors", vi.fn()],
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
      let body: unknown = { ok: true };
      if (url.startsWith("/api/admin/contacts/stats")) {
        const rows = allContacts();
        const byKind = {
          investor: rows.filter((c) => c.kind === "investor").length,
          founder: rows.filter((c) => c.kind === "founder").length,
          consortium_partner: rows.filter((c) => c.kind === "consortium_partner").length,
        };
        body = { total: rows.length, byKind, byVerification: { verified: 0, pending: 0 }, byStatus: {}, byRegion: {} };
      } else if (url.startsWith("/api/admin/contacts")) {
        /* Honour ?kind= the way the real route does. */
        const q = url.includes("?") ? new URLSearchParams(url.slice(url.indexOf("?") + 1)) : new URLSearchParams();
        const kind = q.get("kind");
        const rows = allContacts().filter((c) => !kind || c.kind === kind);
        body = { total: rows.length, contacts: rows };
      }
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  };
});

import AdminInvestors from "../Investors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <RoleProvider>
        <AdminInvestors />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Radix activates a tab on mousedown; a bare click leaves the panel inactive. */
function openTab(testId: string) {
  const t = screen.getByTestId(testId);
  fireEvent.mouseDown(t);
  fireEvent.click(t);
}

beforeEach(() => {
  storedKind = "investor";
});
afterEach(() => cleanup());

describe("WAVE 200 Item A — the contacts list reflects the stored kind", () => {
  it("renders the Kind badge from the stored value, and a different badge when the stored value differs", async () => {
    storedKind = "investor";
    mount();
    const row = await waitFor(() => screen.getByTestId("row-contact-ac_w200_contact"));
    expect(within(row).getByText("Investor")).toBeTruthy();
    /* PAIRED CONTROL: the founder row on the same screen reads Founder, so the
       badge is not simply printing one constant. */
    expect(within(screen.getByTestId("row-contact-ac_other_founder")).getByText("Founder")).toBeTruthy();

    cleanup();

    storedKind = "founder";
    mount();
    const row2 = await waitFor(() => screen.getByTestId("row-contact-ac_w200_contact"));
    expect(within(row2).getByText("Founder")).toBeTruthy();
    expect(within(row2).queryByText("Investor")).toBeNull();
  });

  it("moves the contact between the kind tabs — it leaves Investors and appears under Founders", async () => {
    storedKind = "founder";
    mount();
    await waitFor(() => screen.getByTestId("row-contact-ac_w200_contact"));

    openTab("tab-investors");
    /* Present-control first: the tab really loaded its own filtered list. */
    await waitFor(() => expect(screen.getByTestId("row-contact-ac_other_investor")).toBeTruthy());
    /* The contact whose kind is now `founder` is NOT in the investor list. */
    expect(screen.queryByTestId("row-contact-ac_w200_contact")).toBeNull();

    openTab("tab-founders");
    await waitFor(() => expect(screen.getByTestId("row-contact-ac_w200_contact")).toBeTruthy());
    expect(screen.queryByTestId("row-contact-ac_other_investor")).toBeNull();
  });

  it("counts the contact under the Founders counter once its kind is founder", async () => {
    storedKind = "investor";
    mount();
    await waitFor(() => expect(screen.getByTestId("stat-founders").textContent).toBe("1"));

    cleanup();
    storedKind = "founder";
    mount();
    await waitFor(() => expect(screen.getByTestId("stat-founders").textContent).toBe("2"));
    /* PAIRED CONTROL: the total did not change — one contact moved kind, none
       were created or lost. */
    expect(screen.getByTestId("stat-total").textContent).toBe("3");
  });
});
