/* ════════════════════════════════════════════════════════════════════════════
   WAVE 145 — THE FOUNDER BILLING SURFACE CAN NEVER SHOW A ZERO PRICE FOR A FEE
   THAT IS NOT ON RECORD.                                    RULING **R109**
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAVE 144 BROKE. Wave 144 correctly stopped the resolver fabricating a
   figure: a missing `collective_application_fee_config` row is reported ABSENT.
   But `client/src/pages/founder/Billing.tsx` is SACRED (manifest row 20,
   WAIVER-5) and its guard tests the PRESENCE OF THE OBJECT, not the presence of
   the AMOUNT:

       {appFeeData ? `${formatMinor(appFeeData.amountMinor, …)} …`
                   : "Not available — the application fee has not been published yet."}

   `{amountMinor: null, source: "missing"}` is truthy, so the (already correct)
   refusal branch never ran, and `formatMinor` coerced the null via
   `(Number(minor) || 0)` → the founder read **"$0.00 USD"** for their
   application fee. A founder reads that as "there is no fee".

   THE FIX R109 ORDERED, and which this file pins. The FOUNDER-facing endpoint
   `GET /api/collective/application-fee` answers **200 with a FALSY body
   (`null`)** when the fee is genuinely absent, so the sacred file's existing
   refusal branch executes. R109 explicitly REJECTED both (a) editing the sacred
   guard and (b) making `formatMinor` null-safe (54 consuming files, 20 nullable
   call sites — batch 2 ITEM B). Neither was done in this wave.

   WHY THIS TEST IS NOT A MOCK-SHAPED FICTION. The fee body is NOT hand-written
   here. This file boots the REAL `registerCollectiveRoutes` express app against
   the REAL (`:memory:`) database, deletes the REAL config row, and the page's
   own query goes over REAL HTTP to that route. So the assertion is on the DOM
   the founder gets from the server's actual contract — if the route ever goes
   back to answering with an object carrying a null amount, this file goes red
   with `expected '$0.00 USD' not to contain '$0.00'`.

   FAIL-BEFORE: build_log/wave145/W145_TESTS.md holds the real output of this
   file run against the pre-R109 route (Z1/Z2/Z3/Z4 red on executed assertions).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import http from "node:http";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

import { registerCollectiveRoutes } from "../../../../../server/collectiveRoutes";
import { getDb, rawDb } from "../../../../../server/db/connection";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});
vi.mock("@/lib/entitlement", () => ({
  useEntitlement: () => ({ data: { founder: { activeCompanyId: "co_w145" } } }),
}));

import FounderBilling from "@/pages/founder/Billing";
import FounderApplyToCollective from "@/pages/founder/ApplyToCollective";

/* ── the REAL route, over REAL http, against the REAL config table ────────── */
let server: http.Server;
let port = 0;
type ConfigRow = { amount_minor: number | null; currency: string | null; updated_at: string | null; updated_by: string | null };
const CONFIG_SQL = `SELECT amount_minor, currency, updated_at, updated_by
                      FROM collective_application_fee_config WHERE id = 'default'`;
let ORIGINAL: ConfigRow | undefined;

function readConfig(): ConfigRow | undefined {
  return rawDb().prepare(CONFIG_SQL).get() as ConfigRow | undefined;
}
function deleteConfig(): void {
  rawDb().prepare(`DELETE FROM collective_application_fee_config WHERE id = 'default'`).run();
}
function writeConfig(r: ConfigRow): void {
  rawDb()
    .prepare(
      `INSERT INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by)
         VALUES ('default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         amount_minor = excluded.amount_minor, currency = excluded.currency,
         updated_at   = excluded.updated_at,   updated_by = excluded.updated_by`,
    )
    .run(r.amount_minor, r.currency, r.updated_at ?? "2026-08-25 00:00:00", r.updated_by);
}

/** Raw wire text of a GET against the live route — no parsing, no mocking. */
function wire(path: string): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: "127.0.0.1", port, path }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, raw: b }));
      })
      .on("error", reject);
  });
}

beforeAll(async () => {
  getDb();
  ORIGINAL = readConfig();
  expect(ORIGINAL, "the test database must start with a config row").toBeTruthy();
  const app: Express = express();
  app.use(express.json());
  registerCollectiveRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 60_000);

afterAll(async () => {
  if (ORIGINAL) writeConfig(ORIGINAL);
  await new Promise<void>((r) => server.close(() => r()));
});

/** Every currency string that reads as "there is nothing to pay". */
const ZERO_MONEY: RegExp[] = [/\$\s*0\b/, /0[.,]00/, /\b0\s*(USD|EUR|GBP|JPY)\b/];
function assertNoZeroMoney(text: string, where: string): void {
  for (const re of ZERO_MONEY) {
    expect(re.test(text), `${where} rendered a zero-valued currency string: ${JSON.stringify(text)}`).toBe(false);
  }
}

/* ── mount the REAL sacred Billing page, fee query wired to the REAL route ── */
function mountBilling() {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (/\/api\/collective\/application-fee/.test(url)) {
      const { status, raw } = await wire("/api/collective/application-fee");
      return {
        ok: true,
        status,
        json: async () => (raw === "" ? null : JSON.parse(raw)),
        text: async () => raw,
      } as unknown as Response;
    }
    const body =
      /\/api\/founder\/subscription/.test(url)
        ? {
            ok: true,
            subscription: {
              companyId: "co_w145", status: "active", plan: "founder_pro",
              annualAmountMinor: 120_000, currency: "USD", renewsOn: "2027-01-01",
              cardLast4: "4242", invoicesCount: 0,
            },
          }
        : /\/api\/founder\/invoices/.test(url)
          ? { ok: true, invoices: [] }
          : { ok: true };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: (async () => ({})) as never } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <FounderBilling />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

/** THE ANTI-VACUITY GUARD FOR EVERY DOM ASSERTION BELOW. The refusal sentence is
 *  ALSO what the page shows while the query is still in flight, so an assertion
 *  taken too early passes for the wrong reason (it did, on the first draft of
 *  this file — recorded in W145_TESTS.md). Every case waits for the fee query to
 *  reach `success` in the real cache before reading the DOM. */
async function settleFee(qc: QueryClient): Promise<void> {
  await waitFor(() =>
    expect(qc.getQueryState(["/api/collective/application-fee"])?.status).toBe("success"),
  );
}

beforeEach(() => { cleanup(); apiRequestMock.mockReset(); });
afterEach(() => cleanup());

describe("WAVE 145 · Z — R109: the founder billing surface never states a zero price it does not have", () => {
  it("Z1 THE POINT OF THE WAVE — with the fee ABSENT, no zero currency string is rendered", async () => {
    try {
      deleteConfig();
      const { qc } = mountBilling();
      const el = await screen.findByTestId("text-collective-application-fee");
      /* Settle first — the refusal sentence is also the in-flight text, so an
         early read would pass for the wrong reason. */
      await settleFee(qc);
      await waitFor(() => expect((el.textContent ?? "").trim().length).toBeGreaterThan(0));
      assertNoZeroMoney(el.textContent ?? "", "the application-fee line");
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });

  it("Z2 the sacred file's OWN refusal sentence is what appears instead", async () => {
    try {
      deleteConfig();
      const { qc } = mountBilling();
      const el = await screen.findByTestId("text-collective-application-fee");
      await settleFee(qc);
      await waitFor(() =>
        expect(el.textContent ?? "").toContain("Not available — the application fee has not been published yet."),
      );
      expect(el.textContent ?? "").not.toContain("$");
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });

  it("Z3 the WHOLE fee card is swept, not just the amount line", async () => {
    try {
      deleteConfig();
      const { qc } = mountBilling();
      const card = await screen.findByTestId("card-collective-application-fee");
      await settleFee(qc);
      await waitFor(() => expect(card.textContent ?? "").toContain("Not available"));
      assertNoZeroMoney(card.textContent ?? "", "the application-fee card");
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });

  it("Z4 ANTI-VACUITY — the wire body really is falsy, and really came from the live route", async () => {
    try {
      deleteConfig();
      const absent = await wire("/api/collective/application-fee");
      expect(absent.status).toBe(200);
      expect(absent.status).not.toBe(503); /* R108.2 — the funnel must not go down */
      expect(absent.raw.trim()).toBe("null");
      expect(JSON.parse(absent.raw)).toBeFalsy();
      /* No figure and no diagnostic field may travel to the founder. */
      expect(absent.raw).not.toContain("amountMinor");
      expect(absent.raw).not.toContain("source");
      expect(absent.raw).not.toMatch(/\d/);
      /* And with the row back, the same request carries the real figure. */
      if (ORIGINAL) writeConfig(ORIGINAL);
      const present = await wire("/api/collective/application-fee");
      expect(JSON.parse(present.raw)).toBeTruthy();
      expect(JSON.parse(present.raw).amountMinor).toBe(ORIGINAL?.amount_minor);
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });

  it("Z5 THE OTHER POLE — a published fee still renders its real price on the sacred page", async () => {
    /* Anti-over-correction: R109 must not turn a priced fee into a refusal. */
    writeConfig({ amount_minor: 30_000, currency: "USD", updated_at: null, updated_by: "u_admin" });
    try {
      const { qc } = mountBilling();
      const el = await screen.findByTestId("text-collective-application-fee");
      await settleFee(qc);
      await waitFor(() => expect(el.textContent ?? "").toContain("$300.00"));
      expect(el.textContent ?? "").toContain("USD");
      expect(el.textContent ?? "").not.toContain("Not available");
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });

  it("Z6 the OTHER money on the page is unaffected — the subscription figure still renders", async () => {
    try {
      deleteConfig();
      const { qc } = mountBilling();
      const plan = await screen.findByTestId("card-current-plan");
      await settleFee(qc);
      await waitFor(() => expect(plan.textContent ?? "").toContain("$1,200.00"));
    } finally {
      if (ORIGINAL) writeConfig(ORIGINAL);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SECOND CONSUMER of the same founder-facing endpoint.
   `client/src/pages/founder/ApplyToCollective.tsx` reads the SAME query key
   ["/api/collective/application-fee"]. Wave 142 gave it a third state
   (`feeAbsent`) whose guard was `!!applicationFeeData` — i.e. it also tested
   the OBJECT. With R109's falsy body that guard goes false, and the page would
   have reverted to the perpetual "Loading application fee…" spinner R21/R108.2
   forbid. It now tests `applicationFeeData !== undefined`, so BOTH the falsy
   body and the (still valid) admin-shaped object resolve to the honest notice.
   ══════════════════════════════════════════════════════════════════════════ */
function mountApply(feeBody: unknown) {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    const body = typeof url === "string" && url.startsWith("/api/rounds") ? [{ id: "r_1", state: "open" }] : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  });
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const head = String(queryKey[0] ?? "");
          if (head.includes("/collective/application-fee")) return feeBody;
          if (head.includes("/api/auth/me")) return { id: "u_founder", displayName: "Founder" };
          if (head.includes("active-company")) {
            return { activeCompanyId: "co_1", company: { companyId: "co_1", companyName: "Acme Robotics" } };
          }
          if (head.includes("/api/rounds")) return [{ id: "r_1", state: "open" }];
          return [];
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <FounderApplyToCollective />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function openPathB() {
  const tab = await screen.findByTestId("tab-direct");
  fireEvent.mouseDown(tab); /* Radix activates on pointer-down */
  fireEvent.click(tab);
}

describe("WAVE 145 · X — the OTHER consumer of the endpoint handles the falsy body honestly", () => {
  it("X1 with a FALSY body the apply page states the absence — no zero, no endless spinner", async () => {
    mountApply(null);
    await openPathB();
    const notices = await screen.findAllByTestId("fee-not-on-record");
    expect(notices.length).toBe(2);
    for (const n of notices) {
      expect(n.textContent).toContain("not currently published");
      assertNoZeroMoney(n.textContent ?? "", "the apply-page fee notice");
      expect(n.textContent).not.toContain("Loading application fee");
    }
  });

  it("X2 with a FALSY body submission stays blocked — nothing can be charged against an unset fee", async () => {
    mountApply(null);
    await openPathB();
    const btn = (await screen.findByTestId("button-submit-application")) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
  });

  it("X3 THE OTHER POLE — a priced body still quotes $300.00 and enables submission", async () => {
    mountApply({ amountMinor: 30_000, currency: "USD", source: "db" });
    await openPathB();
    const sentence = await screen.findByText(/A non-refundable application fee of/);
    await waitFor(() => expect(sentence.textContent).toContain("$300.00"));
    expect(screen.queryAllByTestId("fee-not-on-record")).toHaveLength(0);
    const btn = (await screen.findByTestId("button-submit-application")) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});
