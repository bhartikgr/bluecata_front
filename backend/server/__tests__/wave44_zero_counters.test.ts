/**
 * WAVE 44 · DEFECT 3 — "counters reading zero beside real data".
 *
 * THE BRIEF DEMANDED A VERDICT PER COUNTER, BECAUSE THE TWO CASES NEED OPPOSITE
 * FIXES. Both verdicts below are established by EXECUTION against the real
 * endpoints, not by reading UI code.
 *
 * (A) Fees & Billing → Ledger & Invoices → "Payment ledger entries: 0"
 *     VERDICT: BROKEN COUNTER (a response-key mismatch), and the table beneath
 *     it was dead for the same reason.
 *     `GET /api/admin/payments` answers `{ ok, items, total, limit, offset }`
 *     (server/paymentStore.ts). The page read `data.payments ?? data.entries`,
 *     neither of which the endpoint has ever emitted, and fell through to `[]`.
 *     The counter therefore printed 0 for EVERY possible database state. This
 *     file proves the endpoint returns rows AND that the two keys the page used
 *     are absent — i.e. the old selector could not have produced anything but 0.
 *
 * (B) /admin/telemetry → EVENTS TODAY / THIS WEEK / ALL-TIME = 0
 *     VERDICT: BROKEN COUNTER (wrong source). Those three numbers came from
 *     `defaultTelemetryStore`, a browser-local array
 *     (packages/telemetry/src/recorder.ts:57) that is never hydrated from the
 *     server, so it is empty on every page load. The durable record is the
 *     `telemetry_events` table. `GET /api/admin/telemetry/counts` (added this
 *     wave) counts that table and, per R6, distinguishes a GENUINE zero
 *     (`measured: true, allTime: 0`) from an UNMEASURED one
 *     (`measured: false` + reason) instead of printing 0 for both.
 *
 * MONEY: every amount here is an integer in minor units, read back and compared
 * as integers. The fixture includes a JPY row (exponent 0, where the minor unit
 * IS the yen) precisely so any hidden /100 or *100 would show up as a wrong
 * number rather than as a rounding artefact. No total is summed across
 * currencies anywhere in this file or in the code it exercises.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { registerPaymentRoutes } from "../paymentStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";

const ROOT = process.cwd();
let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerPaymentRoutes(app);
  registerAdminPlatformRoutes(app);
});

/** Insert a durable payment_ledger row exactly as paymentStore persists one. */
function seedLedgerEntry(e: {
  amountCents: number;
  currency: string;
  discountCents?: number;
  couponCode?: string;
  state?: string;
  ts?: string;
}): string {
  const id = `pay_w44_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const intentId = `pi_w44_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const ts = e.ts ?? new Date().toISOString();
  const entry = {
    id,
    intentId,
    kind: "founder_subscription",
    amountCents: e.amountCents,
    currency: e.currency,
    state: e.state ?? "succeeded",
    customerId: `co_w44_${id.slice(-6)}`,
    description: "WAVE 44 ledger fixture",
    ...(e.discountCents !== undefined ? { discountCents: e.discountCents } : {}),
    ...(e.couponCode !== undefined ? { couponCode: e.couponCode } : {}),
    ts,
  };
  rawDb()
    .prepare(
      `INSERT INTO payment_ledger (id, intent_id, customer_id, state, entry_json, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, intentId, entry.customerId, entry.state, JSON.stringify(entry), ts);
  return id;
}

describe("WAVE 44 · DEFECT 3A — the payment-ledger counter was broken, not the ledger empty", () => {
  it("the endpoint returns rows under `items`, and the keys the page used do not exist", async () => {
    const usdId = seedLedgerEntry({ amountCents: 84_000, currency: "USD", discountCents: 4_000, couponCode: "W44TEST" });
    // JPY has exponent 0: 9000 minor units IS ¥9,000. A stray /100 or *100
    // anywhere in the read path turns this into 90 or 900000.
    const jpyId = seedLedgerEntry({ amountCents: 9_000, currency: "JPY" });
    const eurId = seedLedgerEntry({ amountCents: 298_800, currency: "EUR" });

    const res = await request(app).get("/api/admin/payments?limit=500");
    expect(res.status).toBe(200);

    // POLE 1 — the data is really there under the real key.
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(Array.isArray(items), `body keys: ${Object.keys(res.body).join(",")}`).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(Number(res.body.total)).toBeGreaterThanOrEqual(3);

    // POLE 2 — the two keys the UI selector used are absent, so `?? []` was the
    // ONLY possible outcome: the counter could not have been anything but 0.
    expect(Object.prototype.hasOwnProperty.call(res.body, "payments")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, "entries")).toBe(false);

    const byId = new Map(items.map((i) => [String(i.id), i]));
    const usd = byId.get(usdId)!;
    expect(usd, "the USD fixture row must be returned").toBeTruthy();
    expect(usd.amountCents).toBe(84_000);
    expect(usd.discountCents).toBe(4_000);
    expect(usd.netCents).toBe(80_000); // integer minor-unit subtraction
    expect(usd.couponCode).toBe("W44TEST");
    expect(usd.currency).toBe("USD");

    const jpy = byId.get(jpyId)!;
    expect(jpy.currency).toBe("JPY");
    expect(jpy.amountCents, "exponent-0 currency must pass through unscaled").toBe(9_000);
    expect(jpy.discountCents, "no discount recorded is a REAL zero").toBe(0);
    expect(jpy.netCents).toBe(9_000);

    const eur = byId.get(eurId)!;
    expect(eur.currency).toBe("EUR");
    expect(eur.amountCents).toBe(298_800);
    expect(eur.netCents).toBe(298_800);

    // No cross-currency arithmetic: the three rows keep three currencies and the
    // endpoint publishes no summed total across them.
    expect(new Set([usd.currency, jpy.currency, eur.currency]).size).toBe(3);
    expect(res.body).not.toHaveProperty("totalAmount");
    expect(res.body).not.toHaveProperty("sumMinor");
  });

  it("the page now reads the key the endpoint actually emits (pinned, so it cannot regress)", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "admin", "AdminFeesConsolidated.tsx"),
      "utf8",
    );
    expect(src).toContain("payQ.data?.items ?? []");
    // the dead keys are gone
    expect(src).not.toContain("payQ.data?.payments");
    expect(src).not.toContain("payQ.data?.entries");
    // and the KPI reports the server's pre-pagination total
    expect(src).toContain('value={paymentsTotal} testId="stat-payments"');
    // per-row currency, never a hardcoded USD for a possibly non-USD row
    expect(src).toContain("formatMinor(p.amountCents ?? 0, p.currency ?? \"USD\")");
  });
});

describe("WAVE 44 · DEFECT 3B — the telemetry counters counted a browser array", () => {
  it("counts come from the durable table, bucketed correctly by today / this week / all time", async () => {
    const before = await request(app).get("/api/admin/telemetry/counts");
    expect(before.status).toBe(200);
    expect(before.body.measured, "a readable table must report measured:true").toBe(true);
    expect(before.body.source).toBe("telemetry_events");
    const baseToday = Number(before.body.today);
    const baseWeek = Number(before.body.thisWeek);
    const baseAll = Number(before.body.allTime);
    // R6 POLE — a genuine zero is reported AS a zero with measured:true, which is
    // how the UI can tell "nothing recorded" from "not measured".
    expect(Number.isFinite(baseAll)).toBe(true);

    const insert = (occurredAt: string) => {
      rawDb()
        .prepare(
          `INSERT INTO telemetry_events (id, tenant_id, event_type, aggregate_id, aggregate_kind,
                                         occurred_at, actor_user_id, payload_json, schema_version, created_at)
           VALUES (?, 'tenant_capavate', 'payment_charged', ?, 'payment', ?, 'u_admin_test', '{}', 1, ?)`,
        )
        .run(
          `tev_w44_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          `agg_${randomUUID().slice(0, 8)}`,
          occurredAt,
          new Date().toISOString(),
        );
    };

    const now = new Date();
    const todayNoon = new Date(now);
    todayNoon.setHours(12, 0, 0, 0);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 3600 * 1000);

    insert(todayNoon <= now ? todayNoon.toISOString() : now.toISOString()); // today (and this week)
    insert(threeDaysAgo.toISOString()); // this week, not today
    insert(fortyDaysAgo.toISOString()); // all-time only

    const after = await request(app).get("/api/admin/telemetry/counts");
    expect(after.status).toBe(200);
    expect(after.body.measured).toBe(true);
    expect(Number(after.body.today), "one event landed inside today's window").toBe(baseToday + 1);
    expect(Number(after.body.thisWeek), "two events landed inside the 7-day window").toBe(baseWeek + 2);
    expect(Number(after.body.allTime), "all three are counted all-time").toBe(baseAll + 3);
    // the windows are published, so the number is auditable rather than opaque
    expect(typeof after.body.windowStartToday).toBe("string");
    expect(typeof after.body.windowStartWeek).toBe("string");
  });

  it("the counts are NOT capped by the explorer's row limit (a count is a count)", async () => {
    const res = await request(app).get("/api/admin/telemetry/counts");
    expect(res.body.measured).toBe(true);
    const direct = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM telemetry_events`)
      .get() as { n: number };
    expect(Number(res.body.allTime)).toBe(Number(direct.n));
  });

  it("the telemetry page no longer computes its KPIs from the browser-local store", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "admin", "Telemetry.tsx"),
      "utf8",
    );
    expect(src).toContain('queryKey: ["/api/admin/telemetry/counts"]');
    expect(src).toContain("durableCounts.today");
    expect(src).toContain("durableCounts.thisWeek");
    expect(src).toContain("durableCounts.allTime");
    /* The three session-local tallies are DELETED, not merely unrendered — no
       dead variables. */
    expect(src).not.toContain("const eventsToday =");
    expect(src).not.toContain("const eventsThisWeek =");
    /* R6 — an unmeasurable counter says so instead of printing 0. */
    expect(src).toContain("not measured");
  });
});
