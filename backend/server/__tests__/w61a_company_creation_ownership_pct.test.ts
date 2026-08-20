/**
 * WAVE 61a · R48 (from R45) — A NEW COMPANY MUST NOT RENDER `10000.0%`.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * `server/routes.ts`, inside `POST /api/founder/companies`, wrote
 * `kpi: { …, ownershipPct: 100 }`.
 *
 * `kpi.ownershipPct` is consumed as a FRACTION. Proof from the tree itself:
 *   • `client/src/pages/founder/Dashboard.tsx` renders
 *     `fmtPct((company?.kpi?.ownershipPct ?? 0) * 100, …)` — it multiplies by 100;
 *   • `server/multiCompanyStore.ts:163/184/205` seed `0.385 / 0.21 / 0.51`, which
 *     render as 38.5% / 21.0% / 51.0%;
 *   • the two SIBLING company-creation paths, `multiCompanyStore.ts:900` and
 *     `:1265`, both write `0`.
 *
 * So `100` rendered 100 x 100 = **`10000.0%`** — a founder's headline ownership
 * figure — for every company created through THIS route. The defect was latent
 * rather than dormant: the live founder company was seeded, so nobody had seen it
 * yet, and company creation is among the most common founder actions.
 *
 * ── WHY `0` AND NOT `1` (R16-safe) ───────────────────────────────────────────
 * The unit is NOT inferred from the magnitude — R16 forbids that. It is read off
 * the client's `* 100` and off three sibling writers. Owner ruled (R48) that the
 * intended semantic is a NEW company, so the correct stored value is `0`,
 * matching `:900` / `:1265`. `1` would assert 100% founder ownership as a FACT,
 * which is the exact defect class this wave removes. Computing the number
 * properly is Wave 67 (R46), sourced from the cap-table engine.
 *
 * ── PROVED THROUGH THE HTTP ROUTE, AS R48 REQUIRES ───────────────────────────
 * This file mounts the FULL `registerRoutes` stack, drives `POST
 * /api/founder/companies` as a real test-owned founder identity, and then reads
 * the value back through `GET /api/founder/companies` — the endpoint the founder
 * dashboard's data actually comes from. It asserts on the payload that reaches
 * the client, not on a helper's return value.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   LOWER  a company created through THIS route stores `0` and renders `0.00%` —
 *          `10000.0%` / `10000.00%` are ABSENT.
 *   UPPER  the field is still consumed as a FRACTION and a REAL value still
 *          renders unchanged: `0.385` -> `38.50%`, `1` -> `100.00%`. This is the
 *          characterisation pole. It pins the unit, so a future "fix" that
 *          rescales the field to percent-as-written breaks here rather than on a
 *          founder's screen — and it is what makes `100` visible as `10000.00%`
 *          in a test rather than only in production.
 *   UPPER  the sibling creation path `POST /api/founder/companies/new` still
 *          stores `0`, so this wave aligned a writer and did not diverge one.
 *
 * MUTATION TRANSCRIPT: build_log/wave61a/W61A_TESTS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerRoutes } from "../routes";
import { __setRuntimePersona } from "../lib/userContext";

/* The SAME identity authenticates the POST and the read-back GET. `x-user-id`
   authenticates as the registered runtime persona under VITEST, which is how the
   rest of this suite drives founder routes — no context mocking, so the read-back
   really is the payload this founder's dashboard would receive. */
const FOUNDER_ID = "u_w61a_ownpct_founder";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  /* A brand-new founder with ZERO companies — the exact state in which the
     `10000.0%` defect fires. */
  __setRuntimePersona({
    userId: FOUNDER_ID,
    email: "w61a.ownpct@test.local",
    name: "W61a Ownership Founder",
    isFounder: true,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); });
  });
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "content-type": "application/json", "x-user-id": FOUNDER_ID };
    if (data) headers["content-length"] = Buffer.byteLength(data).toString();
    const req = http.request({ hostname: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => (raw += c.toString()));
      res.on("end", () => {
        let b: any;
        try { b = JSON.parse(raw); } catch { b = { raw }; }
        resolve({ status: res.statusCode ?? 0, body: b });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** The client's own expression, reproduced EXACTLY as
 *  `client/src/pages/founder/Dashboard.tsx` renders it (2 dp after R47's
 *  standardisation). This is what turns a stored number into the sentence a
 *  founder reads, and it is why `100` was catastrophic.
 *
 *  WAVE 75 · ITEM 1 — THIS HELPER HAD GONE STALE AND WAS FLATTERING THE CODE.
 *  It coalesced with `?? 0`, which is the expression Wave 73 DELETED from
 *  `Dashboard.tsx` precisely because it converted an UNKNOWN ownership into a
 *  confident `0.00%`. The live client is now `:283`
 *  `ownershipPctRaw == null ? null : Number(ownershipPctRaw) * 100` rendered
 *  through `fmtPct(_, 2)`, whose `null` branch (`client/src/lib/format.ts:51-55`)
 *  is the platform's em-dash. Reproduced faithfully below, so this test measures
 *  the screen that exists rather than the screen that used to. */
function renderAsFounderDashboardDoes(stored: number | null | undefined): string {
  const display = stored == null ? null : Number(stored) * 100;
  return display === null ? "\u2014" : `${display.toFixed(2)}%`;
}

async function ownershipPctFromRoute(companyId: string): Promise<number | undefined> {
  const res = await call("GET", "/api/founder/companies");
  expect(res.status).toBe(200);
  const list = Array.isArray(res.body) ? res.body : [];
  const row = list.find((c: any) => c.companyId === companyId);
  return row?.kpi?.ownershipPct;
}

describe("W61a · R48 — POST /api/founder/companies must not store a percent where a fraction is read", () => {
  it("LOWER POLE — a company created through THIS route does not render 10000.0%", async () => {
    const companyId = `co_w61a_${Date.now().toString(36)}`;
    const res = await call("POST", "/api/founder/companies", { companyId, companyName: "W61a Ownership Co" });
    expect(res.status).toBe(201);

    const stored = await ownershipPctFromRoute(companyId);
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 75 · ITEM 1 (R70) — `0` BECAME `null`, AND R48 IS NOT WEAKENED.
       ═══════════════════════════════════════════════════════════════════════
       This assertion read `toBe(0)` and `toBe("0.00%")`. R48's load-bearing claim
       — that this route must not write a PERCENT where a FRACTION is read, so no
       founder ever sees `10000.0%` — is unchanged and is still asserted below, in
       both directions.

       What changed is the honest value for a company with NOTHING on its cap
       table. Two later rulings both point the same way:
         · R47: "a percentage of zero shares is undefined, not zero" — the
           ownership tiles show `—` when there is genuinely nothing to divide.
         · R70 condition 3: when the engine has nothing to compute from, "the
           honest output is `—` (R47), never a number. Never `?? 0`, never `|| 1`."
       `GET /api/founder/companies` now COMPUTES this field from the cap-table
       engine at read time (`server/multiCompanyStore.ts::withComputedOwnership`)
       and a company with no securities yields `null`, which `fmtPct` renders as
       `—`. So the stored `0` this test used to observe is no longer what the
       endpoint reports, and asserting `0` would now be asserting the fabricated
       zero R47 removed.

       THE FALSIFYING POWER IS NOT REDUCED. `null` is asserted exactly, and both
       fabrications are still refused BY VALUE: never `100`, never `1`, and the
       rendered string still never contains `10000`. */
    expect(stored).toBeNull();
    expect(stored).not.toBe(100);
    expect(stored).not.toBe(1);
    expect(stored).not.toBe(0);

    /* And the sentence a founder would actually read. */
    const rendered = renderAsFounderDashboardDoes(stored);
    expect(rendered).toBe("\u2014");
    expect(rendered).not.toBe("0.00%");
    expect(rendered).not.toBe("10000.00%");
    expect(rendered).not.toContain("10000");
  });

  it("LOWER POLE — `1` is NOT written either: a new company must not assert 100% ownership as fact", async () => {
    /* R45 originally proposed `1` ("the intent was plainly 100%"). The owner
       overruled it in R48: the platform does not know this founder owns 100% of
       anything, and inventing that claim is the same defect in a smaller font. */
    const companyId = `co_w61a_n1_${Date.now().toString(36)}`;
    expect((await call("POST", "/api/founder/companies", { companyId, companyName: "W61a No-One Co" })).status).toBe(201);
    const stored = await ownershipPctFromRoute(companyId);
    expect(stored).not.toBe(1);
    expect(renderAsFounderDashboardDoes(stored)).not.toBe("100.00%");
  });

  it("UPPER POLE (characterisation) — the field is consumed as a FRACTION, and real values still render unchanged", () => {
    /* Pins the unit. If anyone rescales `kpi.ownershipPct` to
       percent-as-written, these three break — on a test, not on a founder's
       dashboard. The middle line is the defect this wave removed, preserved here
       as arithmetic so it can never be reintroduced silently. */
    expect(renderAsFounderDashboardDoes(0.385)).toBe("38.50%");
    expect(renderAsFounderDashboardDoes(100)).toBe("10000.00%");   // <-- the old stored value
    expect(renderAsFounderDashboardDoes(1)).toBe("100.00%");
    expect(renderAsFounderDashboardDoes(0)).toBe("0.00%");
    /* WAVE 75 · ITEM 1 — was `toBe("0.00%")`, which pinned the `?? 0` coalesce that
       Wave 73 had ALREADY deleted from `Dashboard.tsx`. `null` means UNDEFINED and
       renders the em-dash (R47, R70 condition 3); pinning it as `0.00%` was this
       file asserting a behaviour the client no longer had. */
    expect(renderAsFounderDashboardDoes(null)).toBe("\u2014");
    expect(renderAsFounderDashboardDoes(undefined)).toBe("\u2014");
  });

  it("UPPER POLE — the sibling creation paths were ALIGNED WITH, not diverged from", async () => {
    /* R48 is an alignment: one writer of four was out of step. Read the two
       siblings from source so that a future change to either shows up here. */
    const store = fs.readFileSync(path.resolve(__dirname, "..", "multiCompanyStore.ts"), "utf8");
    expect((store.match(/pendingSoftCircles: 0, ownershipPct: 0 \}/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const routes = fs.readFileSync(path.resolve(__dirname, "..", "routes.ts"), "utf8");
    /* The corrected writer, and no surviving `ownershipPct: 100` anywhere. */
    expect(routes).toContain("dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0,");
    expect(routes).not.toContain("ownershipPct: 100");
  });

  it("UPPER POLE — the route still does everything else it did: 201, and the company is really there", async () => {
    /* No silent drop. The fix is one literal; the route's contract is untouched. */
    const companyId = `co_w61a_live_${Date.now().toString(36)}`;
    const res = await call("POST", "/api/founder/companies", { companyId, companyName: "W61a Still Works Co" });
    expect(res.status).toBe(201);
    const list = await call("GET", "/api/founder/companies");
    const row = (Array.isArray(list.body) ? list.body : []).find((c: any) => c.companyId === companyId);
    expect(row).toBeTruthy();
    expect(row.companyName).toBe("W61a Still Works Co");
    /* The other five kpi fields are untouched. */
    expect(row.kpi.capTableHolders).toBe(0);
    expect(row.kpi.activeRoundsCount).toBe(0);
    expect(row.kpi.raisedThisYearUsd).toBe(0);
    expect(row.kpi.dataroomFiles).toBe(0);
    expect(row.kpi.pendingSoftCircles).toBe(0);
  });
});
