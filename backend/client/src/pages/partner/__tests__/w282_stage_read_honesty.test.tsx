/* ════════════════════════════════════════════════════════════════════════════
   WAVE 282 · RENDERED-DOM PROOF — BOTH SURFACES, ALL THREE STATES. R137/R231.
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT, AS THE OWNER SEES IT. When the per-client CRM stage read fails,
   every managed client on the Clients list rendered the badge "Prospect", and
   the Client detail page put "Prospect" into the stage SELECT'S VALUE. Nothing
   on either screen said a read had failed. A caught error produced a default
   that looks exactly like real data.

   THE DOCUMENT SAID "TWO SURFACES". IT WAS COUNTED, NOT TAKEN ON TRUST.
   `PARTNER_CLIENT_DEFAULT_STAGE` has four shipping references plus its
   definition; two of them are in the SERVER store's write path and correctly
   keep the default (a company that HAS been read and has no row really is at
   the first stage). Exactly two CLIENT PAGES render a stage from it, and they
   are the two mounted below. Within those two pages there are three call sites
   that consumed a fabricated stage — the list badge, the list filter predicate
   and the detail select's value — and all three are asserted here.

   THREE STATES, NOT TWO. `crmQ.data` is `undefined` both when the request
   FAILED and while it is still PENDING. A single sentence would therefore have
   been false in one of its branches (R254.3): "could not be read" is not true
   of a request still in flight. So the two cases carry different words, and
   both wordings are asserted below in the state that makes them true.

   WHY `fetch` IS STUBBED AND `apiRequest` IS NOT. The seam under test is the
   component's handling of a real query error and a real payload field. Mocking
   `apiRequest` would mock away the boundary. The real `apiRequest`, the real
   react-query error path and the real components are exercised.

   ANTI-VACUITY. "Prospect is absent" is passed by a component that rendered
   nothing at all, and by one that crashed. Every negative assertion below is
   paired with a positive assertion on the SAME mounted screen, and each group
   also mounts the HEALTHY path to prove the pre-282 rendering is byte-for-byte
   unchanged when the read succeeds.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerClients from "../PartnerClients";
import PartnerClientDetail from "../PartnerClientDetail";
import { PARTNER_CLIENT_STAGE_LABELS, PARTNER_CLIENT_DEFAULT_STAGE } from "@shared/crmStages";

const COMPANY_ID = "co_w282_dom";
const CLIENT_ROW = {
  id: "attr_w282",
  companyId: COMPANY_ID,
  companyName: "W282 Test Company",
  attributionSource: "referral",
  attributedAt: "2026-09-01T00:00:00.000Z",
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useRoute: () => [true, { id: COMPANY_ID }],
    useLocation: () => ["/collective/partner/clients", vi.fn()],
    useSearch: () => "",
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
      partnerId: "ac_partner_w282",
      tier: "gold",
      subRole: "managing_partner",
      identity: { userId: "u_w282", email: "partner@example.com", name: "W282 Partner" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

/* ── the fake server ──────────────────────────────────────────────────────── */
type CrmMode = "ok" | "unavailable" | "http_error";
let crmMode: CrmMode = "ok";
/** Counts the CRM reads that actually happened, so an absence can be proved
    against a live baseline rather than against a page that fetched nothing. */
let crmGetCount = 0;
let clientsGetCount = 0;

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u === "/api/feature-flags") return res(200, { PARTNER_WORKSPACE_ENABLED: true });
      if (u === "/api/partner/me/clients") {
        clientsGetCount += 1;
        return res(200, { clients: [CLIENT_ROW] });
      }
      if (u === "/api/partner/me/client-crm-index") {
        crmGetCount += 1;
        if (crmMode === "http_error") return res(500, { error: "PROJECTION_READ_FAILED" });
        return res(200, {
          stages: crmMode === "ok" ? { [COMPANY_ID]: "engaged" } : {},
          leads: {},
          vocabulary: ["prospect", "qualified", "engaged", "won", "lost"],
          stagesAvailable: crmMode === "ok",
        });
      }
      if (u === `/api/partner/me/clients/${COMPANY_ID}`) {
        return res(200, {
          ok: true,
          companyId: COMPANY_ID,
          attribution: { attributionSource: "referral" },
          snapshot: { sector: "Fintech", stage: "seed" },
        });
      }
      if (u === `/api/partner/me/client-crm/${COMPANY_ID}`) {
        crmGetCount += 1;
        if (crmMode === "http_error") return res(500, { error: "PROJECTION_READ_FAILED" });
        return res(200, {
          ok: true,
          companyId: COMPANY_ID,
          stage: crmMode === "ok" ? "engaged" : PARTNER_CLIENT_DEFAULT_STAGE,
          leadUserId: null,
          activity: [],
          stagesAvailable: crmMode === "ok",
        });
      }
      if (u === "/api/partner/me/team") return res(200, { members: [] });
      /* Not under test, but the Clients page mounts it as its last sibling and
         it dereferences `attributions.length`. Served so a crash in a
         neighbour cannot be mistaken for the fix under test. */
      if (u.startsWith("/api/partner/me/attributions/provenance")) {
        return res(200, { attributions: [], ok: true });
      }
      if (u.startsWith("/api/partner/me/crm-client-scope")) {
        return res(200, { ok: true, companyId: COMPANY_ID, scopes: [], availableContacts: [] });
      }
      return res(200, {});
    }),
  );
}

function mount(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  crmMode = "ok";
  crmGetCount = 0;
  clientsGetCount = 0;
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* The exact label the defect printed. Read from the shared vocabulary rather
   than hardcoded, so a rename of the stage cannot make this test vacuous. */
const DEFAULT_LABEL = PARTNER_CLIENT_STAGE_LABELS[PARTNER_CLIENT_DEFAULT_STAGE];

describe("WAVE 282 · SURFACE 1 — the Clients list", () => {
  it("PRECONDITION / HEALTHY PATH — a real stage still renders exactly as before", async () => {
    crmMode = "ok";
    mount(<PartnerClients />);
    /* The row exists and the READ stage is on screen. If this fails, every
       assertion below is being made about a page that never rendered. */
    expect(await screen.findByText("W282 Test Company")).toBeTruthy();
    expect(await screen.findByTestId("client-stage-badge-engaged")).toBeTruthy();
    expect((screen.getByTestId("clients-stage-filter") as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByTestId("clients-stage-read-failed")).toBeNull();
    expect(screen.queryByTestId("client-stage-unavailable")).toBeNull();
    /* The fetches really happened. */
    await waitFor(() => expect(crmGetCount).toBeGreaterThan(0));
    expect(clientsGetCount).toBeGreaterThan(0);
  });

  it("SERVER SAYS THE PROJECTION WAS NOT READ — no stage is printed, and the page says why", async () => {
    crmMode = "unavailable";
    mount(<PartnerClients />);
    /* POSITIVE first: the page rendered, and rendered the row. */
    expect(await screen.findByText("W282 Test Company")).toBeTruthy();
    /* THE FIX. The badge states the failure instead of a stage. */
    const badge = await screen.findByTestId("client-stage-unavailable");
    expect(badge.textContent).toContain("stage could not be read");
    /* THE DEFECT, GONE. SCOPED to the table, deliberately: the filter's <option
       list> legitimately still contains the word "Prospect" — the vocabulary was
       not removed, the control was disabled — so an unscoped query here would be
       an unscoped-DOM-query mechanism and would fail for the wrong reason. What
       must be absent is the word rendered AS A ROW'S STAGE. */
    const tbody = screen.getByTestId("clients-table").querySelector("tbody")!;
    expect(tbody.textContent).not.toContain(DEFAULT_LABEL);
    expect(screen.queryByTestId(`client-stage-badge-${PARTNER_CLIENT_DEFAULT_STAGE}`)).toBeNull();
    /* The explanation panel, and the filter switched off rather than removed. */
    expect(screen.getByTestId("clients-stage-read-failed")).toBeTruthy();
    const filter = screen.getByTestId("clients-stage-filter");
    expect(filter).toBeTruthy();
    expect((filter as HTMLSelectElement).disabled).toBe(true);
    await waitFor(() => expect(crmGetCount).toBeGreaterThan(0));
  });

  it("THE HTTP READ FAILS OUTRIGHT — same honest state, reached by the other route", async () => {
    crmMode = "http_error";
    mount(<PartnerClients />);
    expect(await screen.findByText("W282 Test Company")).toBeTruthy();
    const badge = await screen.findByTestId("client-stage-unavailable");
    expect(badge.textContent).toContain("stage could not be read");
    const tbody2 = screen.getByTestId("clients-table").querySelector("tbody")!;
    expect(tbody2.textContent).not.toContain(DEFAULT_LABEL);
    expect(screen.getByTestId("clients-stage-read-failed")).toBeTruthy();
  });

  it("EVERYTHING ELSE ON THE PAGE IS UNAFFECTED — the failure is scoped to the stage column", async () => {
    crmMode = "unavailable";
    mount(<PartnerClients />);
    /* The clients query is a DIFFERENT query and succeeded; its data must still
       render. A fix that blanked the page would also have removed "Prospect". */
    expect(await screen.findByText("W282 Test Company")).toBeTruthy();
    expect(screen.getByTestId("clients-table")).toBeTruthy();
    expect(screen.getByTestId("clients-search")).toBeTruthy();
    expect(screen.queryByTestId("clients-error")).toBeNull();
  });
});

describe("WAVE 282 · SURFACE 2 — the Client detail stage control", () => {
  it("PRECONDITION / HEALTHY PATH — the select carries the READ stage and is usable", async () => {
    crmMode = "ok";
    mount(<PartnerClientDetail />);
    const sel = (await screen.findByTestId("client-crm-stage-select")) as HTMLSelectElement;
    expect(sel.value).toBe("engaged");
    expect(sel.disabled).toBe(false);
    expect(screen.queryByTestId("client-crm-stage-unavailable")).toBeNull();
  });

  it("SERVER SAYS THE PROJECTION WAS NOT READ — the select holds no stage and says so", async () => {
    crmMode = "unavailable";
    mount(<PartnerClientDetail />);
    const sel = (await screen.findByTestId("client-crm-stage-select")) as HTMLSelectElement;
    /* THE DEFECT: the server sent `stage: "prospect"` in this very payload —
       asserted in the fake above — and before wave 282 that value went straight
       into the control. It must NOT be selected now. */
    expect(sel.value).not.toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(sel.value).toBe("");
    /* The control is still present (never a silent drop) and disabled. */
    expect(sel.disabled).toBe(true);
    /* The reason, in words, on the same card. */
    const why = await screen.findByTestId("client-crm-stage-unavailable");
    expect(why.textContent).toContain("could not be read");
    /* Every real stage option survives — nothing was removed from the list. */
    expect(sel.querySelector('option[value="engaged"]')).toBeTruthy();
    expect(sel.querySelector(`option[value="${PARTNER_CLIENT_DEFAULT_STAGE}"]`)).toBeTruthy();
  });

  it("THE HTTP READ FAILS OUTRIGHT — same honest state on the detail page", async () => {
    crmMode = "http_error";
    mount(<PartnerClientDetail />);
    const sel = (await screen.findByTestId("client-crm-stage-select")) as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect(sel.disabled).toBe(true);
    expect(await screen.findByTestId("client-crm-stage-unavailable")).toBeTruthy();
  });
});
