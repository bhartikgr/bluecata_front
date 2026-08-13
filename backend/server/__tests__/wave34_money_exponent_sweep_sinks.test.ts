/**
 * WAVE 34 · TASK 2 — the sinks the exhaustive sweep found that Wave 33 did NOT.
 *
 * Wave 33C recorded five known live sites and asserted "the standing assumption
 * remains that another sink exists". It did. Hunting the SECOND PATH turned up
 * one more server sink, and the client sweep turned up one more client sink
 * (proved in client/src/pages/admin/__tests__/wave34_admin_dashboard_money_exponent.test.tsx):
 *
 *   server/adminPlatformFeesRoutes.ts:103 — the Platform-Fees → application-fee
 *     MIRROR WRITE. `platform_fees` stores TRUE minor units; the
 *     `collective_application_fee_config` table stores DISPLAY (major) units, a
 *     documented legacy quirk. The bridge converted with `Math.round(amountMinor
 *     / 100)` while `updated.currency` sat on the very next line, unused. A
 *     ¥250,000 platform fee was mirrored as 2,500 and the founder's Collective
 *     application screen then quoted ¥2,500 — a real price, wrong by 100.
 *
 * BOTH POLES. The JPY pole pins the fixed value (250,000 minor → 250,000 major
 * at exponent 0); the USD pole pins that a conversion still happens at all
 * (250,000 minor → 2,500 major at exponent 2). A mutant restoring `/ 100` fails
 * the JPY pole; a mutant deleting the conversion fails the USD pole.
 *
 * The assertion is on what the bridge WROTE and what the resolver then EMITS —
 * never on what either consults. Preconditions are established here; no
 * `process.env` is read; imports are static.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";

const TEST_ADMIN = "u_w34_platform_admin";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: () => ({ isAuthed: true, isAdmin: true, userId: TEST_ADMIN, founder: { companies: [] } }),
  };
});

import { rawDb } from "../db/connection";
import { registerAdminPlatformFeesRoutes } from "../adminPlatformFeesRoutes";
import { getApplicationFeeMinor } from "../lib/collectiveApplicationFeeResolver";
import { currencyExponent, fromMinor } from "../lib/currency";

/** ¥250,000 / $2,500.00 — the SAME integer minor amount. At exponent 0 the
 * major value is 250,000; at exponent 2 it is 2,500. */
const FEE_MINOR = 250_000;

let app: Express;

function exec(sql: string, args: unknown[] = []): void {
  rawDb().prepare(sql).run(...(args as never[]));
}

function readConfigRow(): { amount_minor: number; currency: string | null } | undefined {
  return rawDb()
    .prepare(`SELECT amount_minor, currency FROM collective_application_fee_config WHERE id = 'default'`)
    .get() as { amount_minor: number; currency: string | null } | undefined;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAdminPlatformFeesRoutes(app);
});

beforeEach(() => {
  /* Establish our own precondition rather than inheriting whatever the seed or
   * a previous file left behind: a known-wrong sentinel that BOTH the defect
   * and the fix must overwrite, so a route that silently skipped the mirror
   * write cannot pass. */
  exec(
    `INSERT INTO collective_application_fee_config (id, amount_minor, currency, updated_at, updated_by)
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET amount_minor = excluded.amount_minor, currency = excluded.currency`,
    [-1, "XXX", new Date().toISOString(), TEST_ADMIN],
  );
});

async function putFee(currency: string) {
  const res = await request(app)
    .put("/api/admin/platform-fees/collective_application_fee")
    .send({ amountMinor: FEE_MINOR, currency, actor: TEST_ADMIN });
  return res;
}

/* ── (F) PRECONDITIONS ───────────────────────────────────────────────────── */

describe("F — preconditions", () => {
  it("F1 JPY is exponent 0 and USD is exponent 2", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    expect(fromMinor(FEE_MINOR, "JPY")).toBe(250_000);
    expect(fromMinor(FEE_MINOR, "USD")).toBe(2_500);
  });

  it("F2 the sentinel precondition is in place and is NOT either answer", () => {
    const row = readConfigRow();
    expect(row).toBeTruthy();
    expect(row!.amount_minor).toBe(-1);
    expect(row!.amount_minor).not.toBe(250_000);
    expect(row!.amount_minor).not.toBe(2_500);
  });
});

/* ── (M) THE MIRROR WRITE ────────────────────────────────────────────────── */

describe("M — server/adminPlatformFeesRoutes.ts: the application-fee mirror write", () => {
  it("M1 JPY: 250,000 minor units mirror as 250,000 display units, not 2,500", async () => {
    const res = await putFee("JPY");
    expect(res.status).toBe(200);
    const row = readConfigRow();
    expect(row!.currency).toBe("JPY");
    expect(row!.amount_minor).toBe(250_000);
    // The defect's answer must be absent, not merely un-asserted.
    expect(row!.amount_minor).not.toBe(2_500);
  });

  it("M2 USD: the SAME minor amount mirrors as 2,500 display units", async () => {
    const res = await putFee("USD");
    expect(res.status).toBe(200);
    const row = readConfigRow();
    expect(row!.currency).toBe("USD");
    // A mutant that deletes the conversion entirely would write 250,000 here.
    expect(row!.amount_minor).toBe(2_500);
  });

  it("M3 the resolver — the founder-facing read path — EMITS the two different figures", async () => {
    await putFee("JPY");
    const jpy = getApplicationFeeMinor("JPY");
    expect(jpy.source).toBe("db");
    expect(jpy.amountMinor).toBe(250_000);

    await putFee("USD");
    const usd = getApplicationFeeMinor("USD");
    expect(usd.source).toBe("db");
    expect(usd.amountMinor).toBe(2_500);

    expect(jpy.amountMinor).not.toBe(usd.amountMinor);
  });

  it("M4 KRW proves the exponent is table-driven, not a JPY special case", async () => {
    expect(currencyExponent("KRW")).toBe(0);
    const res = await putFee("KRW");
    expect(res.status).toBe(200);
    expect(readConfigRow()!.amount_minor).toBe(250_000);
  });
});

/* ── (R) THE ADMIN ARR/MRR AGGREGATE ─────────────────────────────────────── */

describe("R — adminPlatformStore.computeKpis ARR: never summed across currencies", () => {
  /* `computeKpis()` reads live subscriptions from the DB. We insert our own
   * rows here rather than relying on whatever the seed produced, so the
   * assertion has a known answer. */
  function insertSub(companyId: string, currency: string, annualMinor: number) {
    const now = new Date().toISOString();
    exec(
      `INSERT INTO subscriptions
         (company_id, status, plan, annual_amount_minor, currency, renews_on,
          invoices_count, version, prev_revision_hash, revision_hash, updated_at, updated_by)
       VALUES (?, 'active', 'founder_pro', ?, ?, ?, 0, 1, '', '', ?, 'w34-test')
       ON CONFLICT(company_id) DO UPDATE SET
         status='active',
         annual_amount_minor=excluded.annual_amount_minor,
         currency=excluded.currency,
         deleted_at=NULL`,
      [companyId, annualMinor, currency, now, now],
    );
  }

  it("R1 a JPY subscription does not contaminate arrUsd, and appears per-currency", async () => {
    const { _testAdmin } = await import("../adminPlatformStore");
    const before = _testAdmin.computeKpis().summary as Record<string, unknown>;
    const arrBefore = Number(before.arrUsd ?? 0);

    insertSub("co_w34_jpy", "JPY", 1_200_000);
    const after = _testAdmin.computeKpis().summary as Record<string, unknown>;

    // The defect added 1,200,000/100 = 12,000 to a figure labelled "USD".
    expect(Number(after.arrUsd)).toBe(arrBefore);
    const byCcy = after.arrByCurrencyMinor as Record<string, number>;
    expect(byCcy.JPY).toBe(1_200_000);
  });

  it("R2 USD pole: a USD subscription DOES move arrUsd, at exponent 2", async () => {
    const { _testAdmin } = await import("../adminPlatformStore");
    const before = Number((_testAdmin.computeKpis().summary as Record<string, unknown>).arrUsd ?? 0);
    insertSub("co_w34_usd", "USD", 1_200_000);
    const after = _testAdmin.computeKpis().summary as Record<string, unknown>;
    expect(Number(after.arrUsd)).toBe(before + 12_000);
    expect((after.arrByCurrencyMinor as Record<string, number>).USD).toBeGreaterThanOrEqual(1_200_000);
  });

  it("R3 nothing was dropped — the per-currency map carries every currency present", async () => {
    const { _testAdmin } = await import("../adminPlatformStore");
    insertSub("co_w34_jpy", "JPY", 1_200_000);
    insertSub("co_w34_usd", "USD", 1_200_000);
    const s = _testAdmin.computeKpis().summary as Record<string, unknown>;
    const arr = s.arrByCurrencyMinor as Record<string, number>;
    const mrr = s.mrrByCurrencyMinor as Record<string, number>;
    expect(Object.keys(arr)).toEqual(expect.arrayContaining(["JPY", "USD"]));
    expect(mrr.JPY).toBe(Math.round(arr.JPY / 12));
    // The scalar and the map disagree by construction — that is the point.
    expect(Number(s.arrUsd)).not.toBe(Object.values(arr).reduce((a, b) => a + b, 0) / 100);
  });
});

/* ── (S) THE SOURCE ──────────────────────────────────────────────────────── */

describe("S — the mirror-write site no longer hardcodes an exponent", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("S0 the comment stripper actually strips, and still sees code", () => {
    expect(strip("/* amountMinor / 100 */\nconst a = 1;")).not.toMatch(/amountMinor \/ 100/);
    expect(strip("// amountMinor / 100\nconst a = 1;")).not.toMatch(/amountMinor \/ 100/);
    expect(strip("/* c */ const a = amountMinor / 100;")).toMatch(/amountMinor \/ 100/);
  });

  it("S1 adminPlatformFeesRoutes delegates to fromMinor and holds no live /100", () => {
    const src = strip(fs.readFileSync("server/adminPlatformFeesRoutes.ts", "utf8"));
    expect(src.length).toBeGreaterThan(1000);
    expect(src).not.toMatch(/Math\.round\(amountMinor \/ 100\)/);
    expect(src).not.toMatch(/\/ 100\b/);
    expect(src).toMatch(/import \{ fromMinor \} from "\.\/lib\/currency"/);
    expect(src).toMatch(/fromMinor\(amountMinor, mirrorCurrency\)/);
  });
});
