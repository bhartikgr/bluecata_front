/* ════════════════════════════════════════════════════════════════════════════
   WAVE 278a (client half) — THE WIZARD POSTS ONE CALL, NOT THREE,
   AND A FAILED LAUNCH READS AS A FAILURE.
   ════════════════════════════════════════════════════════════════════════════
   WHAT THIS FILE DRIVES. The REAL shipped `PartnerSpvEngine` wizard, opened the
   way a GP opens it (`spv-engine-new`), driven with real DOM events, with
   `apiRequest` replaced by a RECORDING mock. Nothing here reads source text.

   ── ASSUME A MECHANISM IS INERT. THE PRECONDITIONS RUN FIRST. ───────────────
   Two traps from the previous two waves are answered before any assertion that
   could pass vacuously:

   1. `vi.mock` CAN BE COMPLETELY INERT and every assertion still green. So the
      mock factory SETS A FLAG (`mockInstalled`) and the recorder pushes every
      call it sees. P0 asserts the flag and asserts the recorder actually
      captured a call — a fence that EXISTS proves nothing; this proves it is
      PASSED.
   2. jsdom + a crashed render SATISFIES EVERY "this is gone" ASSERTION against
      an empty `<body>`. So P1 asserts the wizard is genuinely MOUNTED and
      populated before anything else, and every test below asserts what should
      REMAIN before asserting what should be absent.

   WHAT IT PROVES:
     T6   A full wizard run issues EXACTLY ONE `apiRequest` write. A COUNT, not
          a presence check — and the count is asserted against the recorder,
          which P0 already proved is live.
     T6b  That one call is the atomic route, and its body carries `mandate` with
          the seven keys and `fees` with the five keys.
     T6c  NO FIELD THE WIZARD COLLECTS STOPPED BEING SENT — every value typed in
          is found in the single posted body.
     T6d  No management fee → NO `fees` KEY AT ALL (not an empty array).
     T7   R221.6 — non-linear wizard tab navigation still preserves typed data.
          DRIVEN through the tabs, never read off the source.
     T8   `onError` is honest: the destructive toast is raised with the title
          UNCHANGED, the refusal sentence LEADING, the new sibling sentence
          appended, and `invalidateQueries` WAS CALLED for the SPV list.
     T8b  The failure does not read as a success and does not read as a blank or
          a fabricated zero (R231).

   WHAT IT DOES NOT PROVE: anything about the server. The server half is
   `server/__tests__/w278a_atomic_launch_from_wizard.test.ts`, which drives the
   real route over HTTP and reads the stored rows out of SQLite.
   ════════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvEngine from "../PartnerSpvEngine";

/* ── THE RECORDERS. Module-scope so the mock factories can reach them. ────── */
type Recorded = { method: string; url: string; body: unknown };
/* HOISTED, because `vi.mock` factories are hoisted above every module-scope
   const. Without this the factories run first, read `undefined`, and the whole
   file fails to collect — which is exactly how an inert mock hides. */
const H = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body: unknown }>,
  toasts: [] as Array<Record<string, unknown>>,
  invalidations: [] as unknown[],
  flags: { apiMockInstalled: false, toastMockInstalled: false },
  /** Set per-test to make the write call reject, driving `onError`. */
  rejectWrite: null as Error | null,
}));
const calls = H.calls;
const toasts = H.toasts;
const invalidations = H.invalidations;
const flags = H.flags;

vi.mock("@/hooks/use-toast", () => {
  H.flags.toastMockInstalled = true;
  return {
    useToast: () => ({
      toast: (t: Record<string, unknown>) => {
        H.toasts.push(t);
      },
    }),
  };
});
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_w278a",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w278a", email: "w278a@example.com", name: "W278a Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  H.flags.apiMockInstalled = true;
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      H.calls.push({ method, url, body });
      if (method !== "GET" && H.rejectWrite) throw H.rejectWrite;
      const payload = method === "GET" ? { spvs: [] } : { spv: { id: "spv_w278a", spvType: "spv" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
        statusText: "ok",
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as unknown as Response;
    },
  };
});

let qc: QueryClient;

function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries").mockImplementation(((arg: unknown) => {
    invalidations.push(arg);
    return Promise.resolve();
  }) as never);
  const r = render(
    <QueryClientProvider client={qc}>
      <PartnerSpvEngine />
    </QueryClientProvider>,
  );
  return { ...r, spy };
}

const click = (testid: string) => fireEvent.click(screen.getByTestId(testid));
const set = (testid: string, value: string) =>
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
const check = (testid: string) =>
  fireEvent.click(screen.getByTestId(testid) as HTMLInputElement);
const goToStep = (i: number) => click(`spv-wizard-step-tab-${i}`);

/** Writes only — the list GET is not a launch call and must not be counted. */
const writes = () => calls.filter((c) => c.method !== "GET");

const NAME = "W278a Atomic Launch Vehicle";
const DESC = "Sector-restricted fintech mandate for the W278a probe.";

function openWizard() {
  mount();
  click("spv-engine-new");
}

/** Fill every step the way a GP would, then land on Review & launch. */
function fillWizard(opts: { fee?: "fixed" | "carry" | "hybrid" | "" } = {}) {
  const fee = opts.fee === undefined ? "fixed" : opts.fee;
  openWizard();

  // ── step 0 · name & jurisdiction ──
  set("spv-w-name", NAME);
  set("spv-w-jurisdiction", "delaware");
  set("spv-w-jurisdiction-country", "United States");
  set("spv-w-vintage", "2026");
  set("spv-w-type", "spv");

  // ── step 1 · mandate ──
  goToStep(1);
  set("spv-w-mode", "sector_restricted");
  set("spv-w-mandate-desc", DESC);
  set("spv-w-subsector", "payments");
  set("spv-w-geography", "North America, Europe");
  set("spv-w-stage", "Series A, Series B");
  set("spv-w-checkmin", "5000");
  set("spv-w-checkmax", "50000");

  // ── step 2 · fees & carry basis ──
  goToStep(2);
  click("spv-w-carrybasis-whole_spv");
  if (fee) {
    set("spv-w-feetype", fee);
    if (fee !== "carry") set("spv-w-fixed", "7500");
    if (fee !== "fixed") set("spv-w-carrypct", "20");
  }

  // ── step 3 · terms ──
  goToStep(3);
  set("spv-w-target", "500000");
  set("spv-w-mincheck", "25000");
  set("spv-w-cap", "2500000");
  set("spv-w-terms-doc", "https://example.invalid/w278a");

  // ── step 4 · review, sign-off, launch ──
  goToStep(4);
  check("spv-w-currency-confirm");
  set("spv-signoff-legalname", "Avi Managing");
  check("spv-signoff-accept");
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  invalidations.length = 0;
  H.rejectWrite = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
   P — PRECONDITIONS. Every mechanism used below is proved LIVE first.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W278a · P — the instruments are not inert", () => {
  it("P0 · the apiRequest and toast mocks were actually INSTALLED and are actually CALLED", async () => {
    expect(flags.apiMockInstalled).toBe(true);
    expect(flags.toastMockInstalled).toBe(true);
    openWizard();
    // The page's own list query goes through the mocked apiRequest.
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.some((c) => c.method === "GET")).toBe(true);
  });

  it("P1 · the wizard genuinely MOUNTS — the body is not empty and step 0 is populated", () => {
    openWizard();
    expect(document.body.textContent && document.body.textContent.length).toBeGreaterThan(50);
    expect(screen.getByTestId("spv-wizard")).toBeTruthy();
    const nameInput = screen.getByTestId("spv-w-name") as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    set("spv-w-name", NAME);
    expect((screen.getByTestId("spv-w-name") as HTMLInputElement).value).toBe(NAME);
  });

  it("P2 · the invalidateQueries spy is wired to the SAME client the component uses", async () => {
    fillWizard();
    click("spv-wizard-launch");
    await waitFor(() => expect(invalidations.length).toBeGreaterThan(0));
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   T6 — ONE CALL.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W278a · T6 — the wizard posts EXACTLY ONE write", () => {
  it("T6 · a full launch issues exactly ONE apiRequest write, and it is the atomic route", async () => {
    fillWizard();
    // POSITIVE PAIR: the launch button is present and enabled before we count.
    const launch = screen.getByTestId("spv-wizard-launch") as HTMLButtonElement;
    expect(launch).toBeTruthy();
    expect(launch.disabled).toBe(false);

    fireEvent.click(launch);
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    // Give any (now-deleted) follow-up requests a chance to appear.
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    expect(writes()).toHaveLength(1);
    expect(writes()[0].method).toBe("POST");
    expect(writes()[0].url).toBe("/api/partner/me/spv");
    // The two deleted requests must not appear under ANY shape.
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(calls.some((c) => String(c.url).includes("/mandate"))).toBe(false);
    expect(calls.some((c) => String(c.url).includes("/fees"))).toBe(false);
  });

  it("T6b · that one body carries `mandate` (7 keys) and `fees` (5 keys)", async () => {
    fillWizard({ fee: "fixed" });
    click("spv-wizard-launch");
    await waitFor(() => expect(writes().length).toBe(1));
    const body = writes()[0].body as Record<string, unknown>;

    const mandate = body.mandate as Record<string, unknown>;
    expect(mandate).toBeTruthy();
    expect(Object.keys(mandate).sort()).toEqual(
      ["checkMaxMinor", "checkMinMinor", "geography", "mode", "ruleTree", "sector", "stage"].sort(),
    );
    expect(mandate.mode).toBe("sector_restricted");
    expect(mandate.geography).toEqual(["North America", "Europe"]);
    expect(mandate.stage).toEqual(["Series A", "Series B"]);
    // Major → minor, currency-aware, exact. 5000 USD → 500000 minor.
    expect(mandate.checkMinMinor).toBe(500_000);
    expect(mandate.checkMaxMinor).toBe(5_000_000);
    expect(mandate.ruleTree).toBeTruthy();
    // `companyIds` was never sent by the deleted PUT and must stay unsent.
    expect("companyIds" in mandate).toBe(false);

    const fees = body.fees as Array<Record<string, unknown>>;
    expect(Array.isArray(fees)).toBe(true);
    expect(fees).toHaveLength(1);
    expect(fees[0].layer).toBe("management");
    expect(fees[0].feeType).toBe("fixed");
    expect(fees[0].fixedAmountMinor).toBe(750_000);
    expect(fees[0].currency).toBe("USD");
  });

  it("T6c · NO FIELD THE WIZARD COLLECTS STOPPED BEING SENT", async () => {
    fillWizard({ fee: "hybrid" });
    click("spv-wizard-launch");
    await waitFor(() => expect(writes().length).toBe(1));
    const body = writes()[0].body as Record<string, unknown>;
    const terms = body.terms as Record<string, unknown>;
    const mandate = body.mandate as Record<string, unknown>;
    const fees = body.fees as Array<Record<string, unknown>>;

    // Every value the fixture typed, found in the ONE body.
    expect(body.name).toBe(NAME);
    expect(body.jurisdiction).toBe("delaware");
    expect(body.spvType).toBe("spv");
    expect(body.carryBasis).toBe("whole_spv");
    expect(body.currency).toBe("USD");
    expect(body.targetRaiseMinor).toBe(50_000_000);
    expect(body.minCheckMinor).toBe(2_500_000);
    expect(body.capMinor).toBe(250_000_000);
    expect(body.signoffLegalName).toBe("Avi Managing");
    expect(body.signoffAccepted).toBe(true);
    expect(terms.mandateDescription).toBe(DESC);
    expect(terms.jurisdictionCountry).toBe("United States");
    expect(terms.vintage).toBe(2026);
    // THE FOUR STORED-NEVER-READ TERMS KEYS — all still present.
    expect(terms.subSector).toBe("payments");
    expect(terms.termsDocRef).toBe("https://example.invalid/w278a");
    expect("jurisdictionOther" in terms).toBe(true);
    expect("legalEntityStructure" in terms).toBe(true);
    expect(mandate.sector).toBeTruthy();
    expect(fees[0].carryPct).toBe(0.2);
    // `currencyConfirmed` is a UI GATE and has NEVER been on the wire. It is
    // asserted absent DELIBERATELY, so a future wave that starts sending it
    // has to change this line rather than do it silently.
    expect("currencyConfirmed" in body).toBe(false);
  });

  /* T6d — CORRECTED BY MEASUREMENT, NOT ASSERTED.
     The plan for this wave assumed a GP could reach a launch with NO management
     fee, and that the spread-conditional therefore had a reachable "no `fees`
     key" branch. DRIVING THE REAL WIZARD SHOWS THAT IS FALSE: `mgmtFeeType`
     defaults to "carry" and the select offers exactly three options, none of
     them empty, so `w.mgmtFeeType` is always truthy in the shipped UI — which
     means the OLD `if (w.mgmtFeeType)` third request always fired too. The
     conditional is kept byte-for-byte anyway, because it is the pre-existing
     guard and removing it would be a behaviour change this wave did not
     measure. What is provable from the DOM is that the branch is UNREACHABLE,
     so that is what is asserted here. The route's behaviour with `fees` absent
     — the case every API caller and the legacy sequence still hits — is proved
     server-side by T4. */
  it("T6d · the no-fee branch is UNREACHABLE from the wizard: every option is non-empty", () => {
    openWizard();
    goToStep(2);
    const select = screen.getByTestId("spv-w-feetype") as HTMLSelectElement;
    expect(select).toBeTruthy();
    // POSITIVE PAIR first: the control is really rendered and really populated.
    expect(select.options.length).toBe(3);
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["carry", "fixed", "hybrid"]);
    expect(values.some((v) => v === "")).toBe(false);
    // And the shipped default is already one of them, so a GP never starts blank.
    expect(select.value).toBe("carry");
    expect(values).toContain(select.value);
  });

  it("T6e · a carry-only launch still posts ONE call, with `fees` present and no fixed amount", async () => {
    fillWizard({ fee: "carry" });
    click("spv-wizard-launch");
    await waitFor(() => expect(writes().length).toBe(1));
    const body = writes()[0].body as Record<string, unknown>;
    const fees = body.fees as Array<Record<string, unknown>>;
    expect(fees).toHaveLength(1);
    expect(fees[0].feeType).toBe("carry");
    expect(fees[0].carryPct).toBe(0.2);
    expect(fees[0].fixedAmountMinor).toBeUndefined();
    expect(fees[0].currency).toBeUndefined();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   T7 — R221.6, PROTECTED. DRIVEN, NOT READ.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W278a · T7 — R221.6: non-linear wizard tabs still preserve typed data", () => {
  it("T7 · jumping 0→3→1→4→0 out of order preserves every typed value", () => {
    openWizard();

    // POSITIVE PRECONDITION: the tab bar itself is mounted, all five of it.
    for (let i = 0; i < 5; i += 1) {
      expect(screen.getByTestId(`spv-wizard-step-tab-${i}`)).toBeTruthy();
    }

    set("spv-w-name", NAME);
    expect((screen.getByTestId("spv-w-name") as HTMLInputElement).value).toBe(NAME);

    // 0 → 3, skipping two steps entirely.
    goToStep(3);
    set("spv-w-target", "500000");
    expect((screen.getByTestId("spv-w-target") as HTMLInputElement).value).toBe("500000");

    // 3 → 1, BACKWARDS past a step that was never visited.
    goToStep(1);
    set("spv-w-mandate-desc", DESC);
    expect((screen.getByTestId("spv-w-mandate-desc") as HTMLTextAreaElement).value).toBe(DESC);

    // 1 → 4, forwards past two.
    goToStep(4);
    set("spv-signoff-legalname", "Avi Managing");
    expect((screen.getByTestId("spv-signoff-legalname") as HTMLInputElement).value).toBe("Avi Managing");

    // 4 → 0. THE ORIGINAL VALUE MUST STILL BE THERE.
    goToStep(0);
    expect((screen.getByTestId("spv-w-name") as HTMLInputElement).value).toBe(NAME);

    // And back round again — every one of the four survives.
    goToStep(3);
    expect((screen.getByTestId("spv-w-target") as HTMLInputElement).value).toBe("500000");
    goToStep(1);
    expect((screen.getByTestId("spv-w-mandate-desc") as HTMLTextAreaElement).value).toBe(DESC);
    goToStep(4);
    expect((screen.getByTestId("spv-signoff-legalname") as HTMLInputElement).value).toBe("Avi Managing");
  });

  it("T7b · a checkbox toggled on a far step survives a round trip through the tabs", () => {
    openWizard();
    goToStep(4);
    const box = () => screen.getByTestId("spv-w-currency-confirm") as HTMLInputElement;
    expect(box().checked).toBe(false);
    check("spv-w-currency-confirm");
    expect(box().checked).toBe(true);
    goToStep(0);
    goToStep(2);
    goToStep(4);
    expect(box().checked).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   T8 — AN HONEST FAILURE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W278a · T8 — onError is honest and refreshes the list", () => {
  it("T8 · a refused launch invalidates the SPV list AND shows the destructive toast", async () => {
    H.rejectWrite = new Error("COMBINED_CARRY_EXCEEDS_CAP");
    fillWizard();
    const before = invalidations.length;
    click("spv-wizard-launch");
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    // (a) INVALIDATION WAS CALLED — for the SPV list key specifically.
    expect(invalidations.length).toBeGreaterThan(before);
    const keys = invalidations.map((i) => JSON.stringify(i));
    expect(keys.some((k) => k.includes("/api/partner/me/spv"))).toBe(true);

    // (b) the toast is the destructive one, title BYTE-IDENTICAL.
    const t = toasts[toasts.length - 1];
    expect(t.variant).toBe("destructive");
    expect(t.title).toBe("Launch failed");

    // (c) the refusal sentence LEADS and the sibling sentence is APPENDED.
    const desc = String(t.description);
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain("If a vehicle now appears in your list");
    expect(desc.indexOf("If a vehicle now appears in your list")).toBeGreaterThan(0);
    // The original expression's output is still the leading operand: whatever
    // `partnerActionRefusalText` produced occupies the front of the string.
    const appended = " If a vehicle now appears in your list, it was created before the refusal — review it before launching again.";
    expect(desc.endsWith(appended)).toBe(true);
    expect(desc.slice(0, desc.length - appended.length).trim().length).toBeGreaterThan(0);
  });

  it("T8b · a failed launch does NOT read as a success, a blank, or a fabricated zero (R231)", async () => {
    H.rejectWrite = new Error("COMBINED_CARRY_EXCEEDS_CAP");
    fillWizard();
    click("spv-wizard-launch");
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));

    // Not a success: the success toast never fires.
    expect(toasts.some((t) => t.title === "SPV launched")).toBe(false);
    expect(toasts.every((t) => t.variant === "destructive")).toBe(true);

    // Not blank and not a zero.
    const desc = String(toasts[toasts.length - 1].description);
    expect(desc.trim()).not.toBe("");
    expect(desc.trim()).not.toBe("0");
    expect(desc).not.toMatch(/^\s*(0|\$0(\.00)?|—|-)\s*$/);

    // POSITIVE PAIR — the wizard is still open on the review step, so the GP has
    // somewhere to go. A crashed page would fail this before the absences above
    // could pass vacuously.
    expect(screen.getByTestId("spv-wizard")).toBeTruthy();
    expect(screen.getByTestId("spv-wizard-launch")).toBeTruthy();
  });

  it("T8c · a SUCCESSFUL launch still invalidates and still says `SPV launched`", async () => {
    fillWizard();
    click("spv-wizard-launch");
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.some((t) => t.title === "SPV launched")).toBe(true);
    expect(invalidations.map((i) => JSON.stringify(i)).some((k) => k.includes("/api/partner/me/spv"))).toBe(true);
  });
});
