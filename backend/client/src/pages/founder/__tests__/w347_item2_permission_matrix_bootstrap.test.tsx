/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 347 · ITEM 2 — THE FOUNDER CAN NOW REACH THE FENCE. RENDERED PROOF.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. The permission matrix's ROW SET was derived from the permissions
 * themselves (`investorIds` from `perms` only). An investor became a row only once
 * a permission row for them existed, and the only request-driven writer of
 * `dataroom_permissions` in the product is the switch inside that very matrix. No
 * first row could ever be created for anybody, on any surface. The founder saw
 * "No investor permissions yet." permanently, with nothing to click.
 *
 * THE FIX. `investorIds` is now seeded from the founder's investor CRM as well as
 * from the permissions. It writes nothing and grants nothing — appearing as a row
 * is not access. The server-side half of that promise is proved separately in
 * server/__tests__/w347_item2_matrix_bootstrap_still_fails_closed.test.ts, which
 * shows `investorFolderGrant` still returns null for exactly the investor this
 * file makes visible.
 *
 * THE INSTRUMENT IS NOT THE PRODUCT. Every assertion here reads the RENDERED
 * matrix — the row's own `data-testid`, the investor's displayed NAME, and the
 * `aria-checked` state of the real Radix switches. No store internals, no `perms`
 * array, no source text.
 *
 * SECTION HEADERS COUNTED AGAINST `it(...)` CALLS: 5 headers, 5 tests.
 *   1  CONTROL — with the CRM EMPTY and no permissions, the matrix has no rows and
 *      says so. This is the pre-fix world. Run first: if it does not hold, a row
 *      appearing in test 2 might be arriving from somewhere else entirely.
 *   2  THE FIX — a CRM contact with NO permission row NOW APPEARS as a row, by
 *      name. This is the thing that was impossible.
 *   3  IT IS NOT A GRANT — that new row's view and download switches are both OFF,
 *      and the download switch is DISABLED because view is off.
 *   4  NO DUPLICATE ROWS, AND EXISTING GRANTS SURVIVE — an investor present in
 *      BOTH sources renders exactly one row, and it carries the STORED state, not
 *      the CRM default.
 *   5  A FAILED CRM LOAD IS SAID OUT LOUD — the silent empty is refused. If the
 *      investor list cannot be read, the table does not claim "no permissions".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const COMPANY_ID = "co_w347i2";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  useActiveCompany: () => ({ data: { activeCompanyId: COMPANY_ID }, isLoading: false, isError: false, error: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return {
    ...actual,
    useLocation: () => ["/founder/dataroom", () => {}],
    Link: ({ children }: { children?: unknown }) => <span>{children as never}</span>,
  };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { RoleProvider } from "@/lib/role";
import Dataroom from "../Dataroom";

const FOLDER = { id: "fld_w347i2", companyId: COMPANY_ID, name: "Legal", parentId: null };

/* THE INVESTOR AT THE HEART OF ITEM 2. In the founder's CRM, holding NO
   permission row. Before this wave they could not be displayed at all. */
const CRM_ONLY = { investorId: "u_w347i2_crmonly", name: "Dana Ellery", firmName: "Ellery Capital" };
/* An investor present in BOTH sources, holding a real stored grant. */
const BOTH = { investorId: "u_w347i2_both", name: "Marcus Oyelaran", firmName: "Vireo Partners" };
const STORED_PERM = { investorId: BOTH.investorId, folderId: FOLDER.id, view: true, download: true };

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

/** `crm` and `perms` are what each scenario varies; everything else is constant. */
function wire(opts: { crm: unknown[] | "FAIL"; perms: unknown[] }) {
  apiRequestMock.mockReset();
  /* `apiRequest` is called with different arities across this page (some call
     sites pass a method first, some do not), so the path is located by scanning
     the arguments for the one that looks like an API path rather than by trusting
     a fixed position. A positional read produced `url === undefined` and every
     test failed on `undefined.startsWith` — an inert harness, not a real red. */
  apiRequestMock.mockImplementation(async (...args: unknown[]) => {
    const url = (args.find((a) => typeof a === "string" && a.startsWith("/api/")) as string | undefined) ?? "";
    if (url.startsWith("/api/founder/dataroom/folders")) return jsonResponse([FOLDER]);
    if (url.startsWith("/api/founder/dataroom/files")) return jsonResponse([]);
    if (url.startsWith("/api/founder/dataroom/permissions")) return jsonResponse(opts.perms);
    if (url.startsWith("/api/founder/dataroom/events")) return jsonResponse([]);
    if (url.startsWith("/api/founder/dataroom/engagement")) return jsonResponse({});
    if (url.startsWith("/api/founder/investor-crm")) {
      /* A REAL rejection, not an empty array. Those are two different worlds and
         conflating them is the silent empty this wave refuses. */
      if (opts.crm === "FAIL") throw new Error("investor-crm unreachable");
      return jsonResponse(opts.crm);
    }
    return jsonResponse({});
  });
}

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Dataroom />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/* The matrix lives in `<TabsContent value="permissions">`. Radix does not mount an
   inactive panel's children, so asserting on the matrix without activating the tab
   would read an empty panel and any absence would be a false green. Unlike the
   investor page, this Tabs is driven by component state
   (`const [tab, setTab] = useState("browser")`, Dataroom.tsx:50), so clicking the
   trigger is the page's own mechanism. Test 1 proves the click worked. */
async function openPermissions(container: HTMLElement) {
  const trigger = await waitFor(() => {
    const el = container.querySelector('[data-testid="tab-permissions"]');
    expect(el, "the Permissions tab trigger did not render").toBeTruthy();
    return el as HTMLElement;
  });
  /* RADIX TABS SELECT ON MOUSEDOWN, NOT ON CLICK. `fireEvent.click` alone was
     tried first and did nothing at all: the panel never mounted and all five
     tests went red on the harness rather than on the product. The same trap is
     documented at client/src/pages/founder/__tests__/w108_captable_views.test.tsx:114.
     `pointerDown` is fired as well because Radix prefers pointer events where the
     environment provides them. */
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(
      container.querySelector('[data-testid="table-perms"]'),
      "the permission matrix did not mount after activating the Permissions tab",
    ).toBeTruthy(),
  );
}

describe("W347 · ITEM 2 — the permission matrix can be bootstrapped from the CRM", () => {
  /* ── 1 · CONTROL: THE PRE-FIX WORLD ─────────────────────────────────────
     Empty CRM, no permissions. The matrix must show NO investor rows and say so.
     This proves (a) the harness reaches the mounted matrix, and (b) rows are not
     appearing from some unrelated source, which would make test 2 meaningless. */
  it("CONTROL — with an EMPTY CRM and no permissions, the matrix has no investor rows", async () => {
    wire({ crm: [], perms: [] });
    const { container } = mount();
    await openPermissions(container);
    await waitFor(() =>
      expect(container.textContent ?? "").toContain("No investor permissions yet."),
    );
    expect(
      container.querySelectorAll('[data-testid^="row-perm-"]').length,
      "an investor row appeared with nothing to build it from — test 2 would prove nothing",
    ).toBe(0);
  });

  /* ── 2 · THE FIX ────────────────────────────────────────────────────────
     THE ASSERTION ITEM 2 EXISTS FOR. A CRM contact with no permission row now
     renders as a matrix row, identified by the row's own testid AND by the
     investor's rendered NAME (so an unnamed or raw-id row would not pass). */
  it("an investor from the CRM with NO permission row NOW APPEARS as a matrix row", async () => {
    wire({ crm: [CRM_ONLY], perms: [] });
    const { container } = mount();
    await openPermissions(container);
    await waitFor(() =>
      expect(
        container.querySelector(`[data-testid="row-perm-${CRM_ONLY.investorId}"]`),
        "the CRM-only investor did not appear as a row — the matrix still cannot be bootstrapped",
      ).toBeTruthy(),
    );
    /* Rendered by NAME, via `resolveInvestorName`, not as a raw internal id. */
    expect(await screen.findByText(`${CRM_ONLY.name} (${CRM_ONLY.firmName})`)).toBeTruthy();
    /* And the empty-state sentence is correctly gone. */
    expect(container.textContent ?? "").not.toContain("No investor permissions yet.");
  });

  /* ── 3 · A ROW IS NOT A GRANT ───────────────────────────────────────────
     The dangerous direction. Read from the REAL Radix switches' `aria-checked`,
     which is the state a founder actually sees. Both must be OFF, and download
     must additionally be DISABLED, because the client's own rule is that download
     cannot be turned on while view is off. */
  it("that new row grants NOTHING — both switches render OFF and download is disabled", async () => {
    wire({ crm: [CRM_ONLY], perms: [] });
    const { container } = mount();
    await openPermissions(container);
    const view = await waitFor(() => {
      const el = container.querySelector(`[data-testid="switch-view-${CRM_ONLY.investorId}-${FOLDER.id}"]`);
      expect(el, "the view switch did not render for the bootstrapped row").toBeTruthy();
      return el as HTMLElement;
    });
    const download = container.querySelector(
      `[data-testid="switch-download-${CRM_ONLY.investorId}-${FOLDER.id}"]`,
    ) as HTMLElement | null;
    expect(download, "the download switch did not render for the bootstrapped row").toBeTruthy();
    expect(view.getAttribute("aria-checked"), "the bootstrapped row rendered VIEW as already granted").toBe("false");
    expect(download!.getAttribute("aria-checked"), "the bootstrapped row rendered DOWNLOAD as already granted").toBe(
      "false",
    );
    expect(download!.hasAttribute("disabled"), "download was toggleable while view is off").toBe(true);
  });

  /* ── 4 · NO DUPLICATES, AND STORED STATE WINS ───────────────────────────
     An investor in BOTH sources must render exactly ONE row (the Set does the
     deduplication), and that row must carry the STORED permission rather than the
     all-off default the CRM path supplies. Asserted with `=== 1`, counted from the
     DOM, per the standing rule to count consumers rather than eyeball them. */
  it("an investor in BOTH sources renders exactly ONE row, carrying the STORED grant", async () => {
    wire({ crm: [CRM_ONLY, BOTH], perms: [STORED_PERM] });
    const { container } = mount();
    await openPermissions(container);
    await waitFor(() =>
      expect(container.querySelector(`[data-testid="row-perm-${BOTH.investorId}"]`)).toBeTruthy(),
    );
    expect(
      container.querySelectorAll(`[data-testid="row-perm-${BOTH.investorId}"]`).length,
      "the investor present in both the CRM and the permissions rendered more than one row",
    ).toBe(1);
    /* Both investors are present, and only those two. */
    expect(container.querySelectorAll('[data-testid^="row-perm-"]').length).toBe(2);
    const view = container.querySelector(
      `[data-testid="switch-view-${BOTH.investorId}-${FOLDER.id}"]`,
    ) as HTMLElement;
    const download = container.querySelector(
      `[data-testid="switch-download-${BOTH.investorId}-${FOLDER.id}"]`,
    ) as HTMLElement;
    expect(view.getAttribute("aria-checked"), "an EXISTING grant was overwritten by the CRM default").toBe("true");
    expect(download.getAttribute("aria-checked"), "an EXISTING download grant was lost").toBe("true");
  });

  /* ── 5 · NO SILENT EMPTY ────────────────────────────────────────────────
     The investor list is now one of the two things this table is built from, so a
     FAILURE to load it produces an empty row set. Saying "No investor permissions
     yet." in that state would tell the founder their investor list is empty when
     the truth is that it could not be read. The refusal row must appear instead. */
  it("a FAILED investor-list load is stated, not disguised as an empty matrix", async () => {
    wire({ crm: "FAIL", perms: [] });
    const { container } = mount();
    await openPermissions(container);
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="founder-dataroom-crm-error"]'),
        "the CRM load failed and the matrix said nothing about it",
      ).toBeTruthy(),
    );
    expect(
      container.textContent ?? "",
      "a failed investor-list load was reported as 'no permissions yet' — the silent empty",
    ).not.toContain("No investor permissions yet.");
  });
});
