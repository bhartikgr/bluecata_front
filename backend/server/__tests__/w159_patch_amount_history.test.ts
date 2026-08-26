/**
 * WAVE 159 · R126.1 / R120.3 — THE PATCH DOOR WAVE 158 LEFT OPEN.
 *
 * The independent code review (INDEPENDENT_VERIFY_2_CODE.md, 158.5) proved with
 * live HTTP that `PATCH /api/admin/collective-payments/schedules/:id` — reached
 * from a SHIPPING Edit button on `AdminFeesConsolidated.tsx` — validated only
 * "non-negative integer" and therefore:
 *
 *   · `PATCH {"amountMinor":0}` → 200, creating a FRESH UNATTESTED ZERO price
 *     after wave 158 shipped, bypassing the whole `zero_not_attested` protection;
 *   · `10000 → 999999` in place, ROW COUNT UNCHANGED — a historical price
 *     rewritten with no superseding row, which R120.3 exists to forbid.
 *
 * These are the reviewer's own two probes, reproduced here, and they must now
 * FAIL CORRECTLY. Every assertion below is on a REAL HTTP RESPONSE through the
 * real Express router and on the REAL STORED ROW read back with SQL — not on
 * source text.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 * A route that refused every PATCH would satisfy "no in-place amount rewrite"
 * while destroying the legitimate ability to correct a cadence or to end a
 * schedule by date. So each refusal is paired with an UPPER POLE that must still
 * succeed:
 *   LOWER — amount zero refused; amount rewrite refused; blank amount refused
 *           and never coerced; the stored amount is byte-identical afterwards.
 *   UPPER — a PATCH carrying NO amount still updates cadence and effective_to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { readFileSync } from "node:fs";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";

let app: Express;
let server: http.Server;

const ADMIN = (req: request.Test) => req.query({ as: "admin" });
const BASE = "/api/admin/collective-payments/schedules";

let uniq = 0;
const nextFrom = () => `2041-0${(uniq = (uniq % 8) + 1)}-2${uniq}T00:00:00.000Z`;

function countSchedules(): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM collective_payment_schedules`)
    .get() as { n: number };
  return r.n;
}

function readRow(id: string): Record<string, unknown> {
  return rawDb()
    .prepare(`SELECT * FROM collective_payment_schedules WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

/** Create a priced schedule through the real create route and return its id. */
async function createPriced(amountMajor: string, currency = "USD"): Promise<string> {
  const res = await ADMIN(request(app).post(BASE)).send({
    scopeKind: "platform",
    feeKind: "membership_dues",
    amountMajor,
    currency,
    cadence: "annual",
    effectiveFrom: nextFrom(),
  });
  expect(res.status).toBe(200);
  expect(res.body.id).toBeTruthy();
  return String(res.body.id);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  ensureWave152PricingSchema(rawDb() as never);
  await registerRoutes(server, app);
});

afterAll(() => {
  try {
    server.close();
  } catch {
    /* nothing to close in some runs */
  }
});

describe("W159 · A — the reviewer's PATCH probes, reproduced and now refused", () => {
  it("A1 — PATCH {amountMinor:0} is REFUSED and no unattested zero is created", async () => {
    const id = await createPriced("2500.00");
    const before = readRow(id);
    expect(before.amount_minor).toBe(250000);

    const res = await ADMIN(request(app).patch(`${BASE}/${id}`)).send({ amountMinor: 0 });

    expect(res.status).toBe(400);
    /* R77 — a plain sentence, not only a code. */
    expect(String(res.body.message ?? "")).toMatch(/[a-z]{4,}\s+[a-z]{4,}/);
    const after = readRow(id);
    expect(after.amount_minor).toBe(250000);
    expect(Number(after.intentional_zero ?? 0)).toBe(0);
  });

  it("A2 — an in-place amount rewrite (10000 → 999999) is REFUSED; the price is untouched and no row was added", async () => {
    const id = await createPriced("100.00");
    const rowsBefore = countSchedules();
    expect(readRow(id).amount_minor).toBe(10000);

    const res = await ADMIN(request(app).patch(`${BASE}/${id}`)).send({ amountMinor: 999999 });

    expect(res.status).toBe(400);
    const after = readRow(id);
    /* The recorded price is what the member was charged. It does not move. */
    expect(after.amount_minor).toBe(10000);
    /* And nothing was written behind the refusal either. */
    expect(countSchedules()).toBe(rowsBefore);
    /* The refusal must NAME the correct route: end this one, create a new one. */
    expect(String(res.body.message ?? "")).toMatch(/end/i);
    expect(String(res.body.message ?? "")).toMatch(/new/i);
  });

  it("A3 — a blank/absent amount on PATCH is refused, never coerced to zero", async () => {
    const id = await createPriced("42.00");
    for (const body of [{ amountMinor: null }, { amountMajor: "" }, { amountMajor: "   " }]) {
      const res = await ADMIN(request(app).patch(`${BASE}/${id}`)).send(body as never);
      expect(res.status).toBe(400);
      expect(readRow(id).amount_minor).toBe(4200);
    }
  });

  it("A4 — an unreadable amount on PATCH is refused (no parseFloat salvage of '10abc')", async () => {
    const id = await createPriced("77.00");
    const res = await ADMIN(request(app).patch(`${BASE}/${id}`)).send({ amountMajor: "10abc" });
    expect(res.status).toBe(400);
    expect(readRow(id).amount_minor).toBe(7700);
  });

  it("A5 — UPPER POLE: a PATCH with NO amount still updates cadence and effective_to", async () => {
    const id = await createPriced("310.00");
    const res = await ADMIN(request(app).patch(`${BASE}/${id}`)).send({
      cadence: "monthly",
      effectiveTo: "2042-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const after = readRow(id);
    expect(after.cadence).toBe("monthly");
    expect(String(after.effective_to)).toMatch(/^2042-01-01/);
    /* The amount is preserved exactly — the lifecycle edit is not a price edit. */
    expect(after.amount_minor).toBe(31000);
  });

  it("A6 — UPPER POLE: the create path still saves an ATTESTED zero, so 'free on purpose' survives", async () => {
    const res = await ADMIN(request(app).post(BASE)).send({
      scopeKind: "platform",
      feeKind: "event_fee",
      amountMajor: "0",
      currency: "USD",
      cadence: "one_time",
      effectiveFrom: nextFrom(),
      intentionalZero: true,
      intentionalZeroReason: "W159 upper pole — this event is free on purpose.",
    });
    expect(res.status).toBe(200);
    const row = readRow(String(res.body.id));
    expect(row.amount_minor).toBe(0);
    expect(Number(row.intentional_zero)).toBe(1);
    expect(String(row.intentional_zero_reason)).toMatch(/free on purpose/);
  });
});

/* ========================================================================
 * B — the Edit control that reached the open door.
 *
 * Comment-free source assertions (a docblock is not evidence of behaviour), to
 * pin that the shipping UI no longer sends an amount to a route that refuses it
 * and instead tells the admin what to do instead.
 * ==================================================================== */
describe("W159 · B — the Edit control no longer offers an amount rewrite", () => {
  const AFC = "client/src/pages/admin/AdminFeesConsolidated.tsx";
  const stripComments = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const src = () => stripComments(readFileSync(AFC, "utf8"));

  it("B1 — the collective PATCH body carries no amount field", () => {
    const body = src();
    const patchCall = body.slice(
      body.indexOf("const updateMut = useMutation("),
      body.indexOf("const expireMut"),
    );
    expect(patchCall).toMatch(/collective-payments\/schedules/);
    expect(patchCall).not.toMatch(/amountMinor/);
    expect(patchCall).not.toMatch(/amountMajor/);
  });

  it("B2 — the edit amount box is read-only and the row explains end-and-create", () => {
    const body = src();
    expect(body).toMatch(/input-cps-edit-amount-\$\{r\.id\}/);
    expect(body).toMatch(/readOnly/);
    expect(body).toMatch(/text-cps-edit-amount-locked-\$\{r\.id\}/);
    expect(body).toMatch(/end this schedule and create a new one/i);
  });

  it("B3 — the server route contains no writeable amount_minor in its UPDATE", () => {
    const route = stripComments(
      readFileSync("server/lib/collectivePaymentAdminRoutes.ts", "utf8"),
    );
    const update = route.slice(route.indexOf("UPDATE collective_payment_schedules"));
    expect(update.slice(0, 300)).not.toMatch(/SET amount_minor/);
  });
});
