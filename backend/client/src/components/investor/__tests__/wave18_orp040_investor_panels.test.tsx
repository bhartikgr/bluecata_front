/**
 * WAVE 18 — ORP-040 (DEF-040): the three investor panels, client side.
 *
 * ANTI-VACUITY. These endpoints had zero callers, so the cheap test is "the card
 * renders". Every assertion below has an opposite pole, and every money assertion
 * is chosen so that a hardcoded `/100` or `*100` FAILS:
 *
 *   1. JPY — ISO-4217 exponent **0**. 5,000,000 minor units must render as
 *      ¥5,000,000, not ¥50,000. This is the single assertion `amountMinor / 100`
 *      cannot pass, and it is the fixture class the Wave 17 harness was missing.
 *   2. KWD — exponent **3**. 1,234,567 minor units must render as 1,234.567, so a
 *      `/100` (12,345.67) and a `*100` both fail here too.
 *   3. USD — exponent 2, the control. Correct and broken code agree here, which is
 *      precisely why USD alone proves nothing.
 *   4. Totals are per-currency and NEVER summed across currencies — a bug that
 *      folded three currencies into one number produces one total row and fails.
 *   5. A null amount renders explicit copy, never a fabricated `$0` — asserted in
 *      both directions (the copy is present AND no zero-money string appears).
 *   6. Every documented refusal (403 NOT_ON_CAP_TABLE, 500
 *      DSC_PIPELINE_PERSIST_FAILED, 503 DSC_PIPELINE_READ_FAILED, the KYC 400
 *      family) renders as visible copy, and the DSC submit control is ABSENT for a
 *      viewer who is not on the cap table — a control that can only ever fail.
 *   7. A SOURCE FENCE proves each panel is actually MOUNTED in a page (an
 *      unmounted component is not shipped), and the fence is itself proven to fail
 *      on a bare fixture and on a comment-only fixture.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import {
  InvestorSiloPanel,
  renderAmount,
  totalsByCurrency,
  AMOUNT_NOT_SET_COPY,
} from "../InvestorSiloPanel";
import {
  InvestorKycDocumentsPanel,
  KYC_DOC_TYPE_OPTIONS,
  kycErrorCopy,
  formatBytes,
  stripDataUrlPrefix,
} from "../InvestorKycDocumentsPanel";
import { InvestorDscSubmitPanel, dscErrorCopy } from "../InvestorDscSubmitPanel";
import { formatMinor } from "@/lib/currency";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/* ── the three-exponent fixture set ───────────────────────────────────────── */
const MONEY = [
  { ccy: "USD", minor: 150050 },
  { ccy: "JPY", minor: 5_000_000 },
  { ccy: "KWD", minor: 1_234_567 },
] as const;

let watchlist: unknown = [];
let discover: unknown = [];
let activity: unknown = [];
let softCircles: unknown = [];

beforeEach(() => {
  watchlist = [];
  discover = [];
  activity = [];
  softCircles = [];
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/investor/watchlist") return jsonResponse(200, watchlist);
    if (url === "/api/investor/discover") return jsonResponse(200, discover);
    if (url === "/api/investor/activity") return jsonResponse(200, activity);
    if (url === "/api/investor/soft-circles") return jsonResponse(200, softCircles);
    throw new Error(`unexpected request ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWith(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The money helpers — exponent-exact, or they refuse
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — renderAmount uses formatMinor, not a hardcoded divisor", () => {
  it("renders JPY (exponent 0) at full magnitude — the /100 killer", () => {
    const out = renderAmount(5_000_000, "JPY");
    expect(out).toBe(formatMinor(5_000_000, "JPY"));
    /* 5,000,000 yen. A `/100` would print 50,000 — assert the wrong answer is
       absent, not merely that the right one is present. */
    expect(out).toMatch(/5[.,\u00a0\s]?000[.,\u00a0\s]?000/);
    expect(out).not.toMatch(/\b50[.,]?000\b/);
  });

  it("renders KWD (exponent 3) with three sub-unit digits", () => {
    const out = renderAmount(1_234_567, "KWD");
    expect(out).toBe(formatMinor(1_234_567, "KWD"));
    expect(out).toMatch(/1[.,\u00a0\s]?234[.,]567/);
    /* A `/100` prints 12,345.67. */
    expect(out).not.toMatch(/12[.,]?345[.,]67/);
  });

  it("renders USD (exponent 2) — the control, where broken code looks correct", () => {
    expect(renderAmount(150050, "USD")).toBe(formatMinor(150050, "USD"));
  });

  it("REFUSES to invent a number: a null amount or missing currency yields copy", () => {
    expect(renderAmount(null, "USD")).toBe(AMOUNT_NOT_SET_COPY);
    expect(renderAmount(undefined, "USD")).toBe(AMOUNT_NOT_SET_COPY);
    expect(renderAmount(1000, null)).toBe(AMOUNT_NOT_SET_COPY);
    expect(renderAmount(Number.NaN, "USD")).toBe(AMOUNT_NOT_SET_COPY);
    /* And it does NOT return a zero-money string for any of them. */
    expect(renderAmount(null, "USD")).not.toMatch(/0/);
  });

  it("groups totals by currency and NEVER sums across them", () => {
    const totals = totalsByCurrency(
      MONEY.map((m) => ({ amountMinor: m.minor, currency: m.ccy })),
    );
    expect(totals.length).toBe(3);
    expect(totals.map((t) => t.currency)).toEqual(["JPY", "KWD", "USD"]);
    for (const m of MONEY) {
      expect(totals.find((t) => t.currency === m.ccy)!.minor).toBe(m.minor);
    }
    /* NEGATIVE POLE: no total equals the naive cross-currency sum. */
    const naive = MONEY.reduce((a, m) => a + m.minor, 0);
    expect(totals.some((t) => t.minor === naive)).toBe(false);
  });

  it("EXCLUDES amountless rows from totals rather than counting them as zero", () => {
    /* The JPY row is the one that matters: it has a currency but NO amount. Code
       that folds it in produces a JPY total of 0 — a currency line reading ¥0 that
       no data supports. Code that skips it produces NO JPY line at all. A fixture
       where the amountless row shares a currency with a priced row could not tell
       the two apart, because null coerces to 0 in a sum. */
    const totals = totalsByCurrency([
      { amountMinor: 100, currency: "USD" },
      { amountMinor: null, currency: "JPY" },
      { amountMinor: 200, currency: null },
    ]);
    expect(totals).toEqual([{ currency: "USD", minor: 100 }]);
    expect(totals.some((t) => t.currency === "JPY")).toBe(false);
  });

  it("adds same-currency rows (the positive pole of the grouping)", () => {
    expect(
      totalsByCurrency([
        { amountMinor: 100, currency: "JPY" },
        { amountMinor: 250, currency: "JPY" },
      ]),
    ).toEqual([{ currency: "JPY", minor: 350 }]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. InvestorSiloPanel — calls all four orphans, renders all three exponents
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — InvestorSiloPanel wires the four orphaned reads", () => {
  it("actually calls all four previously-uncalled endpoints", async () => {
    renderWith(<InvestorSiloPanel />);
    await waitFor(() => expect(apiRequestMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    const urls = apiRequestMock.mock.calls.map((c) => c[1]);
    expect(urls).toContain("/api/investor/watchlist");
    expect(urls).toContain("/api/investor/discover");
    expect(urls).toContain("/api/investor/activity");
    expect(urls).toContain("/api/investor/soft-circles");
  });

  it("renders a watchlist row per currency at the correct exponent, with per-currency totals", async () => {
    watchlist = MONEY.map((m) => ({
      roundId: `rnd_${m.ccy}`,
      companyId: `co_${m.ccy}`,
      amount: 1,
      amountMinor: m.minor,
      currency: m.ccy,
      addedAt: "2026-08-01T00:00:00.000Z",
    }));
    renderWith(<InvestorSiloPanel />);
    for (const m of MONEY) {
      await waitFor(() =>
        expect(screen.getByTestId(`investor-watchlist-amount-rnd_${m.ccy}`).textContent).toBe(
          formatMinor(m.minor, m.ccy),
        ),
      );
    }
    /* Three separate totals — one per currency. A cross-currency sum yields one. */
    for (const m of MONEY) {
      expect(screen.getByTestId(`investor-watchlist-total-${m.ccy}`).textContent).toContain(
        formatMinor(m.minor, m.ccy),
      );
    }
    expect(screen.queryByTestId("investor-watchlist-empty")).toBeNull();
  });

  it("renders explicit empty copy for all four cards when the reads are empty (the other pole)", async () => {
    renderWith(<InvestorSiloPanel />);
    await waitFor(() => expect(screen.getByTestId("investor-watchlist-empty")).toBeTruthy());
    expect(screen.getByTestId("investor-discover-empty")).toBeTruthy();
    expect(screen.getByTestId("investor-soft-circles-empty")).toBeTruthy();
    expect(screen.getByTestId("investor-activity-empty")).toBeTruthy();
    expect(screen.queryByTestId("investor-watchlist-totals")).toBeNull();
  });

  it("renders a discover round with NO target as copy, never as a fabricated zero", async () => {
    discover = [
      { id: "rnd_null", companyId: "co_1", name: "Unpriced", status: "open", targetAmount: null, targetAmountMinor: null, currency: "USD", invited: true },
      { id: "rnd_jpy", companyId: "co_2", name: "Yen round", status: "open", targetAmount: 5_000_000, targetAmountMinor: 5_000_000, currency: "JPY", invited: false },
    ];
    renderWith(<InvestorSiloPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("investor-discover-target-rnd_null").textContent).toBe(
        AMOUNT_NOT_SET_COPY,
      ),
    );
    /* NEGATIVE POLE: the unpriced row shows no zero-money string. */
    expect(screen.getByTestId("investor-discover-target-rnd_null").textContent).not.toMatch(/\$\s?0/);
    /* POSITIVE POLE on the same render: the JPY round is at exponent 0. */
    expect(screen.getByTestId("investor-discover-target-rnd_jpy").textContent).toBe(
      formatMinor(5_000_000, "JPY"),
    );
  });

  it("renders soft circles and activity at their own currencies, mixed in one list", async () => {
    softCircles = MONEY.map((m) => ({
      id: `sc_${m.ccy}`,
      roundId: `rnd_${m.ccy}`,
      companyId: `co_${m.ccy}`,
      amount: 1,
      amountMinor: m.minor,
      currency: m.ccy,
      state: "intent",
      investorEmail: "a@b.c",
      investorName: "A",
      createdAt: "2026-08-01T00:00:00.000Z",
      confirmedAt: null,
      wireFundedAt: null,
    }));
    activity = MONEY.map((m, i) => ({
      ts: `2026-08-0${i + 1}T00:00:00.000Z`,
      kind: "captable.committed",
      roundId: `rnd_${m.ccy}`,
      companyId: `co_${m.ccy}`,
      amount: "1",
      amountMinor: m.minor,
      currency: m.ccy,
    }));
    renderWith(<InvestorSiloPanel />);
    for (const m of MONEY) {
      await waitFor(() =>
        expect(screen.getByTestId(`investor-soft-circle-amount-sc_${m.ccy}`).textContent).toBe(
          formatMinor(m.minor, m.ccy),
        ),
      );
    }
    for (let i = 0; i < MONEY.length; i++) {
      expect(screen.getByTestId(`investor-activity-amount-${i}`).textContent).toBe(
        formatMinor(MONEY[i].minor, MONEY[i].ccy),
      );
    }
  });

  it("renders an activity row whose amount the server could not convert as copy, not zero", async () => {
    activity = [
      { ts: "2026-08-01T00:00:00.000Z", kind: "captable.committed", roundId: "r", companyId: "c", amount: "0.005", amountMinor: null, currency: "USD" },
    ];
    renderWith(<InvestorSiloPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("investor-activity-amount-0").textContent).toBe(AMOUNT_NOT_SET_COPY),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. InvestorKycDocumentsPanel
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — InvestorKycDocumentsPanel", () => {
  beforeEach(() => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url === "/api/investor/kyc/documents" && method === "GET") {
        return jsonResponse(200, { ok: true, documents: [] });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
  });

  it("offers exactly the server's five doc types — no option that would always 400", () => {
    expect(KYC_DOC_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "passport",
      "drivers_license",
      "accreditation_letter",
      "source_of_funds",
      "other",
    ]);
  });

  it("calls the previously-uncalled GET and renders empty copy", async () => {
    renderWith(<InvestorKycDocumentsPanel />);
    await waitFor(() => expect(screen.getByTestId("investor-kyc-documents-panel")).toBeTruthy());
    expect(apiRequestMock.mock.calls.map((c) => c[1])).toContain("/api/investor/kyc/documents");
    await waitFor(() => expect(screen.getByTestId("investor-kyc-empty")).toBeTruthy());
  });

  it("renders an uploaded document with its unverified state (both poles of `verified`)", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse(200, {
        ok: true,
        documents: [
          { id: "d1", docType: "passport", fileName: "p.pdf", mimeType: "application/pdf", sizeBytes: 2048, sha256: "a".repeat(64), verified: false, verifiedBy: null, verifiedAt: null, verificationNotes: null, uploadedAt: "2026-08-01T00:00:00.000Z" },
          { id: "d2", docType: "source_of_funds", fileName: "s.pdf", mimeType: "application/pdf", sizeBytes: 1024, sha256: "b".repeat(64), verified: true, verifiedBy: "u_admin", verifiedAt: "2026-08-02T00:00:00.000Z", verificationNotes: null, uploadedAt: "2026-08-01T00:00:00.000Z" },
        ],
      }),
    );
    renderWith(<InvestorKycDocumentsPanel />);
    await waitFor(() => expect(screen.getByTestId("investor-kyc-row-d1")).toBeTruthy());
    /* MEASURED: the panel renders two DIFFERENT testids for the two states
       (`investor-kyc-pending-*` vs `investor-kyc-verified-*`), so each pole is
       asserted present AND the other absent — a single shared testid could not
       distinguish them. */
    expect(screen.getByTestId("investor-kyc-pending-d1").textContent).toMatch(/awaiting/i);
    expect(screen.queryByTestId("investor-kyc-verified-d1")).toBeNull();
    expect(screen.getByTestId("investor-kyc-verified-d2").textContent).toMatch(/verified/i);
    expect(screen.queryByTestId("investor-kyc-pending-d2")).toBeNull();
    expect(screen.queryByTestId("investor-kyc-empty")).toBeNull();
  });

  it("maps every server refusal code to human copy, and an unknown code to a refusal (not silence)", () => {
    for (const code of [
      "invalid_doc_type",
      "fileName_required",
      "mimeType_required",
      "blobBase64_required",
      "empty_blob",
      "too_large",
      "UNAUTHORIZED",
    ]) {
      const copy = kycErrorCopy(code);
      expect(copy.length, `no copy for ${code}`).toBeGreaterThan(10);
    }
    /* An unrecognised code must still SAY something — never render blank. */
    expect(kycErrorCopy("some_new_server_code").length).toBeGreaterThan(10);
    expect(kycErrorCopy(null).length).toBeGreaterThan(10);
  });

  it("formatBytes and stripDataUrlPrefix behave at both poles", () => {
    expect(formatBytes(0)).toMatch(/0/);
    expect(formatBytes(2048)).toMatch(/2/);
    expect(stripDataUrlPrefix("data:application/pdf;base64,QUJD")).toBe("QUJD");
    /* A bare base64 string must pass through UNCHANGED — a greedy regex that ate
       everything before a comma would corrupt it. */
    expect(stripDataUrlPrefix("QUJD")).toBe("QUJD");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. InvestorDscSubmitPanel — refusals rendered, never hidden
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — InvestorDscSubmitPanel", () => {
  function mockDsc(opts: {
    listStatus?: number;
    listBody?: unknown;
    submitStatus?: number;
    submitBody?: unknown;
  }) {
    apiRequestMock.mockReset();
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.startsWith("/api/investor/dsc/submissions")) {
        return jsonResponse(opts.listStatus ?? 200, opts.listBody ?? { ok: true, items: [], count: 0 });
      }
      if (method === "POST" && url === "/api/investor/dsc/submit") {
        return jsonResponse(opts.submitStatus ?? 201, opts.submitBody ?? {
          ok: true,
          submission: { id: "dsc_1", companyId: "co_1", submittedBy: "u", submittedAt: "2026-08-01T00:00:00.000Z", status: "pending" },
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });
  }

  it("reads the NEW cap-table-scoped route with the companyId, and renders empty copy", async () => {
    mockDsc({});
    renderWith(<InvestorDscSubmitPanel companyId="co_1" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-empty")).toBeTruthy());
    const urls = apiRequestMock.mock.calls.map((c) => c[1]);
    expect(urls.some((u) => String(u) === "/api/investor/dsc/submissions?companyId=co_1")).toBe(true);
  });

  it("renders a persisted submission and its status (the read-back that survives a reload)", async () => {
    mockDsc({
      listBody: {
        ok: true,
        count: 1,
        items: [{ id: "dsc_9", companyId: "co_1", submittedBy: "u_aisha_patel", submittedAt: "2026-08-01T00:00:00.000Z", status: "pending" }],
      },
    });
    renderWith(<InvestorDscSubmitPanel companyId="co_1" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-row-dsc_9")).toBeTruthy());
    /* WAVE 90 · ITEM 3 (M-3) — WAS `toContain("pending")`, i.e. the RAW enum.
       An investor must not read a database value (register PART 11 · M-3), so the
       badge now renders a human label. THE TEST'S INTENT IS UNCHANGED — it still
       proves the persisted status is read back after a reload — and it is now
       STRONGER in two ways: it pins the human label, and it asserts the machine
       value is STILL available on the element, which is what R77 requires
       ("banned in rendered text, allowed as a machine-readable value").

       This test also CAUGHT A REAL MISTAKE IN WAVE 90's first cut, which routed
       this badge through the Your-Decision labels and rendered "Awaiting your
       decision" — false, because `pending` here means awaiting REVIEW and the
       investor has no decision to make. Hence GENERIC_STATUS_LABELS. */
    const statusEl = screen.getByTestId("investor-dsc-status-dsc_9");
    expect(statusEl.textContent).toContain("Pending review");
    expect(statusEl.textContent).not.toContain("pending");
    expect(statusEl.getAttribute("data-status")).toBe("pending");
    expect(screen.queryByTestId("investor-dsc-empty")).toBeNull();
  });

  it("403 NOT_ON_CAP_TABLE renders copy AND hides a control that could only fail", async () => {
    mockDsc({ listStatus: 403, listBody: { ok: false, error: "NOT_ON_CAP_TABLE" } });
    renderWith(<InvestorDscSubmitPanel companyId="co_other" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-read-refusal")).toBeTruthy());
    expect(screen.getByTestId("investor-dsc-read-refusal").textContent).toBe(
      dscErrorCopy("NOT_ON_CAP_TABLE"),
    );
    expect(screen.queryByTestId("investor-dsc-submit")).toBeNull();
    /* And no fabricated empty state alongside the refusal. */
    expect(screen.queryByTestId("investor-dsc-empty")).toBeNull();
  });

  it("503 DSC_PIPELINE_READ_FAILED renders as a read failure, NOT as 'you never submitted'", async () => {
    mockDsc({ listStatus: 503, listBody: { ok: false, error: "DSC_PIPELINE_READ_FAILED" } });
    renderWith(<InvestorDscSubmitPanel companyId="co_1" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-read-refusal")).toBeTruthy());
    expect(screen.getByTestId("investor-dsc-read-refusal").textContent).toBe(
      dscErrorCopy("DSC_PIPELINE_READ_FAILED"),
    );
    expect(screen.queryByTestId("investor-dsc-empty")).toBeNull();
    /* The submit control REMAINS — a read failure is not an authorisation failure.
       This is the opposite pole of the 403 case above. */
    expect(screen.getByTestId("investor-dsc-submit")).toBeTruthy();
  });

  it("500 DSC_PIPELINE_PERSIST_FAILED never looks like a success", async () => {
    mockDsc({ submitStatus: 500, submitBody: { ok: false, error: "DSC_PIPELINE_PERSIST_FAILED" } });
    renderWith(<InvestorDscSubmitPanel companyId="co_1" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-submit")).toBeTruthy());
    fireEvent.click(screen.getByTestId("investor-dsc-submit"));
    await waitFor(() => expect(screen.getByTestId("investor-dsc-submit-refusal")).toBeTruthy());
    expect(screen.getByTestId("investor-dsc-submit-refusal").textContent).toBe(
      dscErrorCopy("DSC_PIPELINE_PERSIST_FAILED"),
    );
    /* NEGATIVE POLE: the success line must be absent. */
    expect(screen.queryByTestId("investor-dsc-submitted")).toBeNull();
  });

  it("a successful submit renders confirmation and re-reads the durable list", async () => {
    mockDsc({});
    renderWith(<InvestorDscSubmitPanel companyId="co_1" />);
    await waitFor(() => expect(screen.getByTestId("investor-dsc-submit")).toBeTruthy());
    const before = apiRequestMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("investor-dsc-submit"));
    await waitFor(() => expect(screen.getByTestId("investor-dsc-submitted")).toBeTruthy());
    expect(screen.queryByTestId("investor-dsc-submit-refusal")).toBeNull();
    /* The POST must be followed by a re-READ — otherwise the id lives only in
       React state, which is the Wave 17 hand-over defect all over again. */
    await waitFor(() =>
      expect(apiRequestMock.mock.calls.length).toBeGreaterThan(before + 1),
    );
    const posts = apiRequestMock.mock.calls.filter((c) => c[0] === "POST");
    expect(posts.length).toBe(1);
    expect(posts[0][1]).toBe("/api/investor/dsc/submit");
  });

  it("maps an unknown refusal code to visible copy rather than blank", () => {
    expect(dscErrorCopy("SOMETHING_NEW")).toContain("SOMETHING_NEW");
    expect(dscErrorCopy(null).length).toBeGreaterThan(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. SOURCE FENCE — a component mounted nowhere is NOT shipped
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — every panel is mounted in a real page", () => {
  const CLIENT = path.resolve(__dirname, "../../..");
  const MOUNTS: Array<{ page: string; component: string }> = [
    { page: "pages/investor/Dashboard.tsx", component: "InvestorSiloPanel" },
    { page: "pages/investor/Accreditation.tsx", component: "InvestorKycDocumentsPanel" },
    { page: "pages/investor/CompanyDetail.tsx", component: "InvestorDscSubmitPanel" },
  ];

  /** Returns [hasImport, hasJsxUse] with comments stripped, so a fence cannot be
   *  satisfied by an explanatory comment that merely NAMES the component. */
  function mountEvidence(src: string, component: string): [boolean, boolean] {
    const code = src
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
    const hasImport = new RegExp(`import\\s*\\{[^}]*\\b${component}\\b[^}]*\\}\\s*from`).test(code);
    const hasJsx = new RegExp(`<${component}[\\s/>]`).test(code);
    return [hasImport, hasJsx];
  }

  it("the fence is reading the real page files (anti-vacuity)", () => {
    for (const m of MOUNTS) {
      const p = path.join(CLIENT, m.page);
      expect(fs.existsSync(p), `${m.page} missing`).toBe(true);
      expect(fs.readFileSync(p, "utf8").length).toBeGreaterThan(1000);
    }
  });

  it("each panel is imported AND rendered as JSX in its page", () => {
    for (const m of MOUNTS) {
      const src = fs.readFileSync(path.join(CLIENT, m.page), "utf8");
      const [hasImport, hasJsx] = mountEvidence(src, m.component);
      expect(hasImport, `${m.component} not imported in ${m.page}`).toBe(true);
      expect(hasJsx, `${m.component} not rendered in ${m.page}`).toBe(true);
    }
  });

  it("the fence FAILS on a bare fixture and on a comment-only fixture (both poles)", () => {
    expect(mountEvidence("export default function P() { return null; }", "InvestorSiloPanel")).toEqual([false, false]);
    /* The exact way a fence like this gets fooled: a comment that names the
       component, or a commented-out JSX element. Both must read as NOT mounted. */
    expect(
      mountEvidence(
        '/* import { InvestorSiloPanel } from "x"; <InvestorSiloPanel /> */\n// <InvestorSiloPanel />\n',
        "InvestorSiloPanel",
      ),
    ).toEqual([false, false]);
    expect(mountEvidence('{/* <InvestorSiloPanel /> */}\n', "InvestorSiloPanel")).toEqual([false, false]);
    /* POSITIVE POLE: a minimal genuine mount reads as mounted. */
    expect(
      mountEvidence(
        'import { InvestorSiloPanel } from "@/components/investor/InvestorSiloPanel";\nconst a = <InvestorSiloPanel />;\n',
        "InvestorSiloPanel",
      ),
    ).toEqual([true, true]);
  });
});
