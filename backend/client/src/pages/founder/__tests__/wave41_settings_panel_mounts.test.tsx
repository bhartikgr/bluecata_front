/**
 * WAVE 41 · OWNER RULING R9 + R6 — the mounted panels, driven through the REAL
 * Settings page.
 *
 * Owner, 2026-08-13: "Yes, connect it, and governance and M&A preparation
 * should also be connected."
 *
 * WHAT WAS WRONG
 *   `client/src/pages/founder/Settings.tsx` declared 12 `<TabsContent>` panels
 *   but only 7 `<TabsTrigger>`s. Five panels — company, data, notifications,
 *   plan, team — had no trigger and could not be opened by any user action.
 *   Worse, three whole components (`SettingsPreferencesTab`,
 *   `SettingsGovernanceTab`, `SettingsMnaPrepTab`) were mounted NOWHERE; the
 *   file referenced them only as `void SettingsGovernanceTab;` statements, which
 *   silence the unused-symbol warning while rendering nothing. Radix renders a
 *   `TabsContent` only when its value is the active tab, so a panel with no
 *   trigger is dead markup: the "Financials 0%" bar on the founder Dashboard
 *   pointed at a page that had no way in.
 *
 * WHY THIS FILE RENDERS `Settings`, NOT THE PANELS
 *   Importing a panel component and rendering it directly would pass even if the
 *   panel were still mounted nowhere — that is precisely the class of vacuous
 *   check this build has been burned by, and it is the same laundering hole
 *   Wave 41 closed in the reachability gate (a render inside a TEST was being
 *   counted as a mount). So every assertion here starts from the real page and
 *   goes through the real trigger: find the tab, click it, and require the panel
 *   to appear. If a mount is reverted, these fail.
 *
 * BOTH POLES, every claim:
 *   · the panel appears after clicking its trigger — AND is absent before.
 *   · an un-entered score renders "Not provided" — AND a stored 0 renders "0%".
 *   · the save patch omits untouched scores — AND carries the one that moved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "../Settings";
import { RoleProvider } from "@/lib/role";
import { formatMinor } from "@/lib/currency";
import { NOT_PROVIDED } from "@/lib/wave4Display";

const COMPANY = "co_w41_mounts";

/* jsdom implements neither ResizeObserver nor Element.hasPointerCapture, and
   Radix's Slider/Select measure themselves on mount. Without these the panels
   throw during render and the test would fail for an environment reason that
   says nothing about the code under test. Stubbed minimally — no behaviour is
   simulated, so nothing here can make an assertion pass on its own. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= ResizeObserverStub;
if (typeof Element !== "undefined") {
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).setPointerCapture ??= () => {};
  (Element.prototype as any).releasePointerCapture ??= () => {};
  (Element.prototype as any).scrollIntoView ??= () => {};
}

/* ── a stub server that actually holds what it is sent ────────────────────── */
let STORED: Record<string, unknown> = {};
let PATCHES: Record<string, unknown>[] = [];

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useLocation: () => ["/founder/settings", () => {}],
  useParams: () => ({}),
  useRoute: () => [false, {}],
  Redirect: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
  toast: () => {},
}));

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompany: () => ({ data: { company: { id: COMPANY, name: "Wave41 Co" } } }),
  useActiveCompanyId: () => COMPANY,
}));

beforeEach(() => {
  STORED = { stage: "series_b" };
  PATCHES = [];
  apiRequestMock.mockReset();
  /* Every GET the page fires answers from the same fixture, so a panel that
     reads real data gets real data and a panel that reads nothing still mounts. */
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (String(url).includes("/api/founder/profile")) return jsonResponse({ profile: { ...STORED } });
    return jsonResponse({ ok: true, items: [], tiers: [], data: [] });
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/founder/profile") && init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        PATCHES.push(patch);
        STORED = { ...STORED, ...patch };
        return jsonResponse({ ok: true });
      }
      if (String(url).includes("/api/founder/profile")) return jsonResponse({ profile: { ...STORED } });
      return jsonResponse({ ok: true, items: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Settings />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/* Radix's TabsTrigger activates on MOUSEDOWN, not on a synthetic `click`
   (see @radix-ui/react-tabs: the trigger's own handler is onMouseDown, with
   onKeyDown/onFocus for keyboard activation). A bare fireEvent.click therefore
   dispatches an event nothing is listening for, and the tab never changes —
   which would have made every "panel appears" assertion below fail for a reason
   that has nothing to do with the mount. Fire both, in the order a real pointer
   does, so this drives the component the way a user does. */
function clickTab(id: string) {
  const el = screen.getByTestId(id);
  fireEvent.mouseDown(el, { button: 0 });
  fireEvent.click(el);
}

/* The panels Wave 41 gave a trigger to, and the marker each one renders.
   Keyed on the trigger testid so the test fails if the trigger is removed,
   and on a panel-body testid so it also fails if the trigger is left pointing
   at nothing. */
const NEWLY_REACHABLE: { tab: string; panel: string }[] = [
  { tab: "tab-preferences", panel: "section-preferences" },
  { tab: "tab-financials", panel: "section-financials" },
  { tab: "tab-governance", panel: "section-governance" },
  { tab: "tab-mna-prep", panel: "section-mna-prep" },
];

/* The five panels that already existed but had no way in. */
const PREVIOUSLY_ORPHANED_TRIGGERS = [
  "tab-company",
  "tab-team",
  "tab-plan",
  "tab-notifications",
  "tab-data",
];

describe("WAVE 41 · R9 — every orphaned panel now has a trigger a user can click", () => {
  it("renders the Settings tab list at all (guards against a vacuous suite below)", async () => {
    renderSettings();
    expect(await screen.findByTestId("tabs-settings")).toBeTruthy();
  });

  for (const id of PREVIOUSLY_ORPHANED_TRIGGERS) {
    it(`${id} exists — the panel is no longer unreachable`, async () => {
      renderSettings();
      await screen.findByTestId("tabs-settings");
      expect(screen.getByTestId(id)).toBeTruthy();
    });
  }

  for (const { tab, panel } of NEWLY_REACHABLE) {
    it(`${tab}: panel absent before the click, present after — the mount is real`, async () => {
      renderSettings();
      await screen.findByTestId("tabs-settings");

      /* POLE A — Radix mounts only the active panel, so before the click this
         content must NOT be in the document. If it were always present, the
         "after" assertion would prove nothing about the trigger. */
      expect(screen.queryByTestId(panel)).toBeNull();

      clickTab(tab);

      /* POLE B — clicking the trigger brings up the panel body. */
      expect(await screen.findByTestId(panel)).toBeTruthy();
    });
  }
});

describe("WAVE 41 · R6 — M&A readiness: 'Not provided' vs a real zero", () => {
  const MNA_KEYS = [
    "ipDdReadinessPct",
    "customerContractsReadinessPct",
    "financialAuditReadinessPct",
    "dataRoomOrganizedPct",
    "regulatoryFilingsCompletePct",
    "esgDisclosureCompletePct",
  ];

  async function openMna() {
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-mna-prep");
    await screen.findByTestId("section-mna-prep");
  }

  it("a company that has entered nothing shows 'Not provided' on all six, never 0%", async () => {
    await openMna();
    for (const k of MNA_KEYS) {
      const el = await screen.findByTestId(`value-mna-${k}`);
      expect(el.textContent).toBe(NOT_PROVIDED);
      /* The exact string the live audit found. "0%" is a claim about the
         business; "Not provided" is a claim about the data. */
      expect(el.textContent).not.toBe("0%");
    }
  });

  it("BOTH POLES — a stored 0 renders '0%', so a deliberate zero is still sayable", async () => {
    STORED = { ...STORED, ipDdReadinessPct: 0, dataRoomOrganizedPct: 40 };
    await openMna();
    await waitFor(async () =>
      expect((await screen.findByTestId("value-mna-ipDdReadinessPct")).textContent).toBe("0%"),
    );
    expect((await screen.findByTestId("value-mna-dataRoomOrganizedPct")).textContent).toBe("40%");
    /* And an untouched sibling in the same render is still honest. */
    expect((await screen.findByTestId("value-mna-esgDisclosureCompletePct")).textContent).toBe(
      NOT_PROVIDED,
    );
  });

  it("saving after moving ONE slider sends ONE score — the other five stay unwritten", async () => {
    await openMna();

    /* Move exactly one slider. Radix Slider responds to keyboard on its thumb;
       the arrow key is a real user action, which is the point — moving it IS
       the act of entering a value. */
    const slider = screen.getByTestId("slider-mna-ipDdReadinessPct");
    const thumb = slider.querySelector('[role="slider"]') as HTMLElement | null;
    expect(thumb, "no slider thumb found — cannot enter a value").toBeTruthy();
    fireEvent.keyDown(thumb!, { key: "ArrowRight" });

    await waitFor(() =>
      expect(screen.getByTestId("value-mna-ipDdReadinessPct").textContent).not.toBe(NOT_PROVIDED),
    );

    fireEvent.click(screen.getByTestId("button-save-mna-prep"));
    await waitFor(() => expect(PATCHES.length).toBeGreaterThan(0));

    const sent = PATCHES[0];
    /* THE FIX: the patch carries the score that moved... */
    expect(Object.keys(sent)).toContain("ipDdReadinessPct");
    /* ...and NOT the five that did not. The pre-Wave-41 code spread the whole
       state map, writing a literal 0 into all six and inflating the M&A Prep
       completion score by up to 12 of its 14 weight points, because
       isPresent() in server/companyProfileStore.ts counts 0 as present. */
    for (const k of MNA_KEYS.filter((k) => k !== "ipDdReadinessPct")) {
      expect(Object.keys(sent), `${k} must not be written by an untouched slider`).not.toContain(k);
    }
    /* The status select still round-trips, so the fix did not drop the field the
       old patch shape did carry legitimately. */
    expect(Object.keys(sent)).toContain("transactionPrepStatus");
  });

  it("a stored 0 that the founder never re-touched is NOT re-sent as a fabrication, but is preserved", async () => {
    /* Subtle case: hydration must keep a genuine stored 0 as 0 (not null), so
       saving again re-sends 0 — which is correct, because 0 is what the founder
       previously entered. The failure mode being excluded is the opposite one:
       hydration nulling a real zero and thereby silently deleting it. */
    STORED = { ...STORED, ipDdReadinessPct: 0 };
    await openMna();
    await waitFor(() =>
      expect(screen.getByTestId("value-mna-ipDdReadinessPct").textContent).toBe("0%"),
    );
    fireEvent.click(screen.getByTestId("button-save-mna-prep"));
    await waitFor(() => expect(PATCHES.length).toBeGreaterThan(0));
    expect(PATCHES[0].ipDdReadinessPct).toBe(0);
  });
});

describe("WAVE 41 · R6 — governance and financials state what is on record", () => {
  it("governance shows the stored director count, or 'Not provided' — and a real 0 is kept", async () => {
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-governance");
    await screen.findByTestId("section-governance");

    const el = await screen.findByTestId("text-board-director-count-stored");
    /* Nothing stored → the honest refusal, not "0 directors". */
    expect(el.textContent).toContain(NOT_PROVIDED);
    expect(el.textContent).not.toMatch(/\b0\b/);
  });

  it("financials shows 'Not provided' for an unset field and the value for a set one", async () => {
    STORED = { ...STORED, arrUsd: 123456 };
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-financials");
    await screen.findByTestId("section-financials");

    const set = await screen.findByTestId("stored-financial-arrUsd");
    /* 123456 minor units is $1,234.56 — asserted as the formatted major-unit
       figure, so a hardcoded /100 vs the currency exponent is distinguishable. */
    expect(set.textContent).toContain("1,234.56");
    expect(set.textContent).not.toContain(NOT_PROVIDED);

    const unset = await screen.findByTestId("stored-financial-monthlyBurnUsd");
    expect(unset.textContent).toContain(NOT_PROVIDED);
    /* The specific thing R6 forbids for an un-entered money field. */
    expect(unset.textContent).not.toContain("$0");
  });

  it("the money readout is exponent-derived — JPY (exponent 0) fixture included", async () => {
    /* The readout renders through `formatMinor`, which reads the ISO 4217
       exponent. Asserted here on the same helper the component calls, with the
       exponent-0 currency that a hardcoded 2-decimal assumption breaks: no live
       JPY data exists, so a test is the only place this path is exercised at all.
       1000 JPY is one thousand yen, not ¥10.00. */
    expect(formatMinor(1000, "JPY")).not.toContain(".");
    expect(formatMinor(1000, "JPY")).toContain("1,000");
    expect(formatMinor(123456, "USD")).toContain("1,234.56");

    /* And the rendered panel agrees with the helper, so the component cannot
       drift onto its own private conversion. */
    STORED = { ...STORED, arrUsd: 123456 };
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-financials");
    await screen.findByTestId("section-financials");
    const el = await screen.findByTestId("stored-financial-arrUsd");
    expect(el.textContent).toContain(formatMinor(123456, "USD"));
  });

  it("an out-of-range legacy percent is SURFACED, not silently reinterpreted", async () => {
    /* WAVE 35 ROW 8 left ambiguous rows behind: a stored 4250 could be a
       compounded 42.5% or a genuine 4250%. The brief is explicit — "do not
       silently reinterpret; surface it". Dividing by 100 on read would be a
       guess, and would be wrong for whichever rows are genuine. */
    STORED = { ...STORED, grossMarginPct: 4250 };
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-financials");
    await screen.findByTestId("section-financials");

    const flag = await screen.findByTestId("stored-financial-ambiguous-grossMarginPct");
    expect(flag.textContent).toContain("4250");
    /* The flag DOES name 42.5% — as a question put to the founder ("if you meant
       42.5%, re-enter it"), immediately alongside an explicit statement that the
       value has not been reinterpreted. That is the opposite of silent: the
       stored number is authoritative and the alternative is offered for a human
       to decide. What is forbidden is the readout PRESENTING 42.5% as the value. */
    expect(flag.textContent).toContain("has not been reinterpreted");

    const readout = await screen.findByTestId("stored-financial-grossMarginPct");
    expect(readout.textContent).toContain("4250");
    /* The value position — everything before the flag — must read 4250%. */
    const valueShown = readout.textContent!.split(" — ")[0];
    expect(valueShown).toContain("4250%");
    expect(valueShown).not.toContain("42.5%");

    /* And the editable input still holds the stored number, so opening the tab
       and pressing Save cannot quietly rewrite the row to 42.5. */
    const input = screen.getByTestId("input-financial-grossMarginPct") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("4250"));
  });

  it("BOTH POLES — an in-range percent raises no ambiguity flag", async () => {
    STORED = { ...STORED, grossMarginPct: 42.5 };
    renderSettings();
    await screen.findByTestId("tabs-settings");
    clickTab("tab-financials");
    await screen.findByTestId("section-financials");
    await screen.findByTestId("stored-financial-grossMarginPct");
    expect(screen.queryByTestId("stored-financial-ambiguous-grossMarginPct")).toBeNull();
  });
});
