/**
 * WAVE 158 · R119 / R120.2 — THE BLANK-PRICE HAZARD, AND THE MISLABELLED ACTION.
 *
 * R119: `client/src/pages/admin/CollectivePaymentSchedules.tsx:96` did
 * `parseFloat(form.amountMajor || "0")`. Submitting the create form with the
 * amount box untouched therefore created a REAL, audited $0.00 fee schedule and
 * told the operator "Schedule created" — the most plausible origin of the five
 * $0.00 rows verified live under R120.4. A blank amount must be REFUSED; a zero
 * must be DELIBERATE and RECORDED (the wave-152 `intentional_zero*` columns); an
 * unflagged zero must render "Not on record", never "$0.00".
 *
 * R120.2: the row action was an unlabelled red trash can whose confirm said
 * "This cannot be undone", while the server only sets `effective_to`. It is now
 * "End schedule", and it states that the record is retained for history.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 * A handler that refused every zero, or refused everything, would satisfy "a
 * blank never becomes $0.00" while having disabled the legitimate ability to
 * price something at zero on purpose. So every refusal below is paired with an
 * UPPER POLE that must still succeed:
 *   LOWER — blank refused, unreadable refused, unattested zero refused;
 *   UPPER — a priced schedule still saves; an ATTESTED zero still saves and is
 *           readable as free-of-charge with its reason.
 * The amount/label assertions run over the real HTTP stack and the real
 * `registerRoutes(...)`; the currency-scaling assertions prove the ISO-4217
 * exponent behaviour survived (JPY 0-decimal, BHD 3-decimal) — no `* 100`.
 *
 * SPEC DISCREPANCY, RECORDED: the wave brief named the flag columns
 * `free_attested` / `free_reason`. Those names exist on `partner_tier_price`.
 * The columns wave 152 added to `collective_payment_schedules` (migration
 * 0200_batch2_g_r110_charge_path_prices_and_zero_flags.sql:84-87 and
 * server/lib/applyWave152PricingSchema.ts:75-78) are `intentional_zero`,
 * `intentional_zero_reason`, `intentional_zero_by`, `intentional_zero_at`. The
 * real columns are what this wave writes. See build_log/wave158/W158_BUILD.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";

let app: Express;
let server: http.Server;

const ADMIN = (req: request.Test) => req.query({ as: "admin" });
const REPO = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf-8");

/** R-STRIP — a docblock is not evidence of behaviour. Every source assertion in
 *  this file reads COMMENT-FREE source, because this wave's own comments quote
 *  the very strings ("parseFloat", "cannot be undone") the tests forbid. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const CPS = "client/src/pages/admin/CollectivePaymentSchedules.tsx";

let uniq = 0;
const nextFrom = () => `2031-0${(uniq = (uniq % 8) + 1)}-1${uniq}T00:00:00.000Z`;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  /* The installer needs a raw better-sqlite3 handle (`exec` + `prepare`), not the
     drizzle wrapper; NODE_ENV=test does not run migrations, so this is what puts
     the wave-152 columns on the in-memory database. */
  ensureWave152PricingSchema(rawDb() as never);
  await registerRoutes(server, app);
}, 45_000);

afterAll(() => {
  try {
    server?.close();
  } catch {
    /* noop */
  }
});

/* ========================================================================
 * A — the wave-152 columns really are the ones on this table
 * ==================================================================== */
describe("W158 · A — the intentional-zero columns exist on collective_payment_schedules", () => {
  it("A1 — all four columns are present (and are NOT called free_attested/free_reason)", () => {
    const cols = (rawDb().prepare(`PRAGMA table_info(collective_payment_schedules)`).all() as { name: string }[]).map(
      (c) => String(c.name),
    );
    expect(cols).toContain("intentional_zero");
    expect(cols).toContain("intentional_zero_reason");
    expect(cols).toContain("intentional_zero_by");
    expect(cols).toContain("intentional_zero_at");
    expect(cols).not.toContain("free_attested");
    expect(cols).not.toContain("free_reason");
  });
});

/* ========================================================================
 * B — LOWER POLE: a blank amount is refused over real HTTP
 * ==================================================================== */
describe("W158 · B — a blank amount is refused, never coerced to zero (R119)", () => {
  it("B1 — POST with amountMajor:\"\" is refused with a plain sentence and creates nothing", async () => {
    const before = (
      rawDb().prepare(`SELECT COUNT(*) AS n FROM collective_payment_schedules`).get() as { n: number }
    ).n;
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMajor: "",
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(String(res.body.message)).toMatch(/blank amount is not read as zero/i);
    expect(String(res.body.message)).not.toMatch(/\bnull\b|undefined|NaN|parseFloat/);
    const after = (
      rawDb().prepare(`SELECT COUNT(*) AS n FROM collective_payment_schedules`).get() as { n: number }
    ).n;
    expect(after).toBe(before);
  });

  it("B2 — POST with an unreadable amount is refused, not rounded", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMajor: "twelve hundred",
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/could not be read as a number/i);
  });

  it("B3 — an unattested zero is refused (a zero nobody signed for is a blank box)", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMajor: "0",
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("zero_not_attested");
    expect(String(res.body.message)).toMatch(/has to be deliberate/i);
  });

  it("B4 — intentionalZero with an empty reason is still refused", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMajor: "0",
      currency: "USD",
      cadence: "annual",
      intentionalZero: true,
      intentionalZeroReason: "   ",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("zero_not_attested");
  });
});

/* ========================================================================
 * C — UPPER POLE: pricing still works, and a deliberate zero is recordable
 * ==================================================================== */
describe("W158 · C — the legitimate operations all still succeed (UPPER POLE)", () => {
  it("C1 — a priced schedule saves, scaled by the currency's exponent (USD, 2dp)", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMajor: "1500.50",
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.ok).toBe(true);
    const id = String(res.body.schedule?.id ?? res.body.id ?? "");
    const row = rawDb()
      .prepare(`SELECT amount_minor AS m, intentional_zero AS z FROM collective_payment_schedules WHERE id = ?`)
      .get(id) as { m: number; z: number };
    expect(row.m).toBe(150050);
    expect(Number(row.z)).toBe(0);
  });

  it("C2 — JPY (0-decimal) is NOT multiplied by 100", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "event_fee",
      amountMajor: "1500",
      currency: "JPY",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBeLessThan(300);
    const id = String(res.body.schedule?.id ?? res.body.id ?? "");
    const row = rawDb()
      .prepare(`SELECT amount_minor AS m FROM collective_payment_schedules WHERE id = ?`)
      .get(id) as { m: number };
    expect(row.m).toBe(1500);
  });

  it("C3 — BHD (3-decimal) keeps all three decimal places", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "sponsorship_fee",
      amountMajor: "1.250",
      currency: "BHD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBeLessThan(300);
    const id = String(res.body.schedule?.id ?? res.body.id ?? "");
    const row = rawDb()
      .prepare(`SELECT amount_minor AS m FROM collective_payment_schedules WHERE id = ?`)
      .get(id) as { m: number };
    expect(row.m).toBe(1250);
  });

  it("C4 — an ATTESTED zero saves, and the four columns carry actor + reason + time", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "event_fee",
      amountMajor: "0",
      currency: "USD",
      cadence: "annual",
      intentionalZero: true,
      intentionalZeroReason: "Free for founding chapter members through 2031.",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBeLessThan(300);
    expect(res.body.ok).toBe(true);
    const id = String(res.body.schedule?.id ?? res.body.id ?? "");
    const row = rawDb()
      .prepare(
        `SELECT amount_minor AS m, intentional_zero AS z, intentional_zero_reason AS reason,
                intentional_zero_by AS by, intentional_zero_at AS at
           FROM collective_payment_schedules WHERE id = ?`,
      )
      .get(id) as { m: number; z: number; reason: string; by: string; at: string };
    expect(row.m).toBe(0);
    expect(Number(row.z)).toBe(1);
    expect(row.reason).toMatch(/founding chapter members/);
    expect(String(row.by ?? "")).not.toBe("");
    expect(String(row.at ?? "")).not.toBe("");
  });

  it("C5 — the old integer amountMinor contract still works (no caller was broken)", async () => {
    const res = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "membership_dues",
      amountMinor: 99900,
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    expect(res.status).toBeLessThan(300);
    const id = String(res.body.schedule?.id ?? res.body.id ?? "");
    const row = rawDb()
      .prepare(`SELECT amount_minor AS m FROM collective_payment_schedules WHERE id = ?`)
      .get(id) as { m: number };
    expect(row.m).toBe(99900);
  });

  it("C6 — the list route hands the client the zero flags it needs to tell the two apart", async () => {
    const list = await ADMIN(
      request(app).get("/api/admin/collective-payments/schedules?includeExpired=true"),
    );
    expect(list.status).toBe(200);
    const rows = (list.body.schedules ?? []) as Array<Record<string, unknown>>;
    const attested = rows.find((r) => Number(r.intentional_zero) === 1);
    expect(attested).toBeTruthy();
    expect(String(attested!.intentional_zero_reason)).toMatch(/founding chapter members/);
  });
});

/* ========================================================================
 * D — R120.2: ending a schedule retains the record, and says so
 * ==================================================================== */
describe("W158 · D — 'End schedule' retains the record and the API says so (R120.2)", () => {
  it("D1 — DELETE only sets effective_to; the row survives and the message states it", async () => {
    const created = await ADMIN(request(app).post("/api/admin/collective-payments/schedules")).send({
      scopeKind: "platform",
      feeKind: "chapter_dues",
      amountMajor: "250",
      currency: "USD",
      cadence: "annual",
      effectiveFrom: nextFrom(),
    });
    const id = String(created.body.schedule?.id ?? created.body.id ?? "");
    expect(id).toBeTruthy();

    const ended = await ADMIN(request(app).delete(`/api/admin/collective-payments/schedules/${id}`));
    expect(ended.status).toBe(200);
    expect(ended.body.ok).toBe(true);
    expect(String(ended.body.message)).toMatch(/kept for history/i);
    expect(String(ended.body.message)).toMatch(/not deleted/i);
    expect(String(ended.body.message)).not.toMatch(/cannot be undone/i);

    const row = rawDb()
      .prepare(`SELECT id, effective_to AS to_ FROM collective_payment_schedules WHERE id = ?`)
      .get(id) as { id: string; to_: string | null } | undefined;
    expect(row?.id).toBe(id);
    expect(String(row?.to_ ?? "")).not.toBe("");
  });

  it("D2 — the server contains no DELETE statement against the schedules table", () => {
    const src = stripComments(readSrc("server/lib/collectivePaymentAdminRoutes.ts"));
    expect(src).not.toMatch(/DELETE\s+FROM\s+collective_payment_schedules/i);
  });
});

/* ========================================================================
 * E — the admin screen itself (comment-free source assertions)
 * ==================================================================== */
describe("W158 · E — the screen no longer coerces, and is labelled honestly", () => {
  /* WAVE 159 · R126.5 — TITLE CORRECTED. This test was called "no parseFloat /
     parseInt / Number() money coercion is left in the page" but only ever asserted
     `parseFloat` and the `|| "0"` default. `Number()` coercion WAS still left in
     the page — `toMinor(Number(typed), currency)` in the amount preview — and the
     overclaiming title is part of why it survived wave 158. The title now says
     exactly what is checked, and wave 159 adds the missing assertions. */
  it("E1 — no parseFloat, and no `|| \"0\"` money default, is left in the page", () => {
    const src = stripComments(readSrc(CPS));
    expect(src).not.toMatch(/parseFloat/);
    expect(src).not.toMatch(/\|\|\s*["']0["']/);
  });

  it("E1b — W159: no `Number()`/`parseInt` coercion of a TYPED money value either", () => {
    const src = stripComments(readSrc(CPS));
    /* The specific site the review found: a preview that scaled a typed string
       through a double and promised a value the server then refused. */
    expect(src).not.toMatch(/toMinor\(\s*Number\(/);
    expect(src).not.toMatch(/parseInt/);
    /* Reading an integer minor-unit column back out of the DB is not coercion of a
       typed amount, so `Number(r.amount_minor)` is deliberately still allowed. */
    expect(src).toMatch(/decimalStringToMinor/);
  });

  it("E2 — the row action reads 'End schedule' and carries an aria-label", () => {
    const src = stripComments(readSrc(CPS));
    expect(src).toMatch(/End schedule/);
    expect(src).toMatch(/aria-label=\{`End schedule/);
  });

  it("E3 — the confirm states retention and drops 'cannot be undone'", () => {
    const src = stripComments(readSrc(CPS));
    expect(src).not.toMatch(/cannot be undone/i);
    expect(src).toMatch(/kept for history and is not deleted/i);
  });

  it("E4 — an unattested zero renders 'Not on record', not $0.00", () => {
    const src = stripComments(readSrc(CPS));
    expect(src).toMatch(/Not on record/);
    expect(src).toMatch(/: attested\s*\n?\s*\?/);
    expect(src).toMatch(/: NOT_ON_RECORD,/);
  });

  it("E5 — R120.3 honoured: no in-place amount edit was added", () => {
    const src = stripComments(readSrc(CPS));
    expect(src).not.toMatch(/editDraft/);
    expect(src).not.toMatch(/PATCH/);
  });

  it("E6 — the currency-aware conversion is still used; no `* 100` regression", () => {
    const src = stripComments(readSrc(CPS));
    /* W159 — the page now uses the EXACT-DECIMAL currency-aware converter
       (`decimalStringToMinor`) in place of `toMinor(Number(...))`. Both are ISO-4217
       exponent aware; this assertion exists to catch a return to `* 100`. */
    expect(src).toMatch(/decimalStringToMinor\(|[^a-zA-Z]toMinor\(/);
    expect(src).not.toMatch(/\*\s*100\b/);
  });

  it("E7 — the sibling helper on the consolidated fees page no longer coerces blank to zero", () => {
    const src = stripComments(readSrc("client/src/pages/admin/AdminFeesConsolidated.tsx"));
    expect(src).not.toMatch(/parseFloat\(major \|\| "0"\)/);
    expect(src).toMatch(/blank amount is not read as zero/i);
  });

  it("E8 — PartnerFeeSchedules, the other live price form, was swept the same way", () => {
    const src = stripComments(readSrc("client/src/pages/admin/PartnerFeeSchedules.tsx"));
    expect(src).not.toMatch(/parseFloat\(form\.amountMajor \|\| "0"\)/);
    expect(src).toMatch(/blank amount is not read as zero/i);
  });
});
