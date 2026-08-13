/**
 * WAVE 35 · F3 — the SIXTH cross-currency summation:
 * `GET /api/admin/founder-channels/:companyId`.
 *
 * THE DEFECT. The handler's SELECT already returned each soft circle's own
 * `currency` — it needs it to pick the ISO 4217 exponent for the
 * amount_minor fallback. Having used it, it threw it away and added every
 * row's minor units into ONE `totalRaisedMinor` (and one `totalMinor` per
 * channel, per partner, per collective member). Review A's probe against a
 * company holding ¥1,000,000 and $1,000,000 got back `101000000`. That is not
 * ¥, not $, and not any amount of money. 100 JPY + 100 USD-cents is not 200 of
 * anything.
 *
 * The old "invariant check" compared channelSum to totalRaisedMinor and
 * reported `invariantOk: true` — both sides were the same meaningless number,
 * so it could never have caught this. The invariant is now checked per
 * currency.
 *
 * THE FIX uses the idiom already shipped in `server/lib/currencyScalar.ts`
 * (Wave 21, five sites): bucket per currency, emit a scalar ONLY when exactly
 * one currency contributed, otherwise emit `null` plus the reason and the
 * currency list. The per-currency array is always present, so no reader loses
 * information.
 *
 * BOTH POLES ARE ASSERTED:
 *   • MIXED  → `totalRaisedMinor` is null (never 101000000), with
 *              `totalRaisedByCurrency` carrying both legs intact.
 *   • SINGLE → an existing single-currency company still gets the exact same
 *              integer it always got. No functionality is dropped.
 *
 * The endpoint is exercised over real HTTP through the real registered route.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const TEST_ACTOR = "u_w35_f3_admin";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: true,
      isAdmin: true,
      userId: TEST_ACTOR,
      founder: { companies: [] },
    }),
  };
});

import { rawDb } from "../db/connection";
import { createRound, updateRound } from "../roundsStore";
import { registerTrack4Routes } from "../track4Routes";

const TENANT = "t_w35_f3";
/** One company holding BOTH a ¥ and a $ soft circle. */
const CO_MIXED = "co_w35_f3_mixed";
/** The single-currency control: JPY only, exponent 0. */
const CO_JPY = "co_w35_f3_jpy";
/** The single-currency control: USD only. */
const CO_USD = "co_w35_f3_usd";

let app: Express;

function exec(sql: string, args: unknown[] = []): void {
  rawDb().prepare(sql).run(...(args as never[]));
}

function mkCompany(id: string, name: string): void {
  exec(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
     VALUES (?,?,?,?,?,?,?,0)`,
    [id, TENANT, name, name, "fintech", "seed", "Tokyo"],
  );
}

function mkRound(companyId: string, currency: string): string {
  const r = createRound({
    companyId,
    name: `W35 F3 ${currency}`,
    type: "seed",
    targetAmount: 1_000_000,
    pricePerShare: 500_000,
    currency,
    closeDate: "2026-01-15",
    actorUserId: TEST_ACTOR,
  } as never);
  updateRound(
    (r as { id: string }).id,
    { state: "closed", raisedAmount: 1_000_000 } as never,
    { actor: TEST_ACTOR } as never,
  );
  return (r as { id: string }).id;
}

function mkSoftCircle(opts: {
  id: string;
  roundId: string;
  companyId: string;
  investorId: string;
  amountMinor: number;
  currency: string;
  sourceType: string | null;
  sourceId?: string | null;
}): void {
  exec(
    `INSERT OR REPLACE INTO soft_circles
       (id, tenant_id, round_id, company_id, investor_user_id, investor_name,
        amount, amount_minor, currency, status, source_type, source_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      opts.id, TENANT, opts.roundId, opts.companyId, opts.investorId,
      `W35 F3 ${opts.investorId}`, 1_000_000, opts.amountMinor, opts.currency,
      "confirmed", opts.sourceType, opts.sourceId ?? null, new Date().toISOString(),
    ],
  );
}

beforeAll(() => {
  mkCompany(CO_MIXED, "W35 F3 Mixed KK");
  mkCompany(CO_JPY, "W35 F3 JPY KK");
  mkCompany(CO_USD, "W35 F3 USD Inc");

  const rdMixedJpy = mkRound(CO_MIXED, "JPY");
  const rdMixedUsd = mkRound(CO_MIXED, "USD");
  const rdJpy = mkRound(CO_JPY, "JPY");
  const rdUsd = mkRound(CO_USD, "USD");

  // ¥1,000,000 (exponent 0 → 1,000,000 minor) and $1,000,000 (100,000,000 minor)
  // on the SAME company. Review A's probe summed these to 101,000,000.
  mkSoftCircle({ id: "sc_w35_f3_mx_jpy", roundId: rdMixedJpy, companyId: CO_MIXED, investorId: "u_w35_f3_i1", amountMinor: 1_000_000, currency: "JPY", sourceType: "direct" });
  mkSoftCircle({ id: "sc_w35_f3_mx_usd", roundId: rdMixedUsd, companyId: CO_MIXED, investorId: "u_w35_f3_i2", amountMinor: 100_000_000, currency: "USD", sourceType: "direct" });
  // A partner-sourced leg in each currency so the byPartner rollup is mixed too.
  mkSoftCircle({ id: "sc_w35_f3_mx_pjpy", roundId: rdMixedJpy, companyId: CO_MIXED, investorId: "u_w35_f3_i3", amountMinor: 500_000, currency: "JPY", sourceType: "partner", sourceId: "ptnr_w35_f3" });
  mkSoftCircle({ id: "sc_w35_f3_mx_pusd", roundId: rdMixedUsd, companyId: CO_MIXED, investorId: "u_w35_f3_i4", amountMinor: 50_000_000, currency: "USD", sourceType: "partner", sourceId: "ptnr_w35_f3" });

  mkSoftCircle({ id: "sc_w35_f3_jpy", roundId: rdJpy, companyId: CO_JPY, investorId: "u_w35_f3_i5", amountMinor: 1_000_000, currency: "JPY", sourceType: "direct" });
  mkSoftCircle({ id: "sc_w35_f3_usd", roundId: rdUsd, companyId: CO_USD, investorId: "u_w35_f3_i6", amountMinor: 100_000_000, currency: "USD", sourceType: "direct" });

  app = express();
  app.use(express.json());
  registerTrack4Routes(app);
});

describe("W35-F3-MIXED — a two-currency company gets a refusal, never a fake sum", () => {
  it("F3-1 totalRaisedMinor is NULL, not 101000000", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    expect(res.status).toBe(200);
    // The exact number Review A's probe extracted from the shipped code.
    expect(res.body.totalRaisedMinor).not.toBe(101_000_000);
    expect(res.body.totalRaisedMinor).toBeNull();
    // A null, not a zero — a zero would read as "this founder raised nothing".
    expect(res.body.totalRaisedMinor).not.toBe(0);
    expect(res.body.totalRaisedCurrency).toBeNull();
    expect(res.body.totalRaisedUnavailableReason).toBe("needs_fx_conversion");
    expect(res.body.currencies).toEqual(["JPY", "USD"]);
  });

  it("F3-2 both currency legs survive intact in the authoritative per-currency array", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    expect(res.body.totalRaisedByCurrency).toEqual([
      { currency: "JPY", minor: 1_500_000 },
      { currency: "USD", minor: 150_000_000 },
    ]);
  });

  it("F3-3 the per-CHANNEL total refuses the same way and keeps its breakdown", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    const direct = res.body.byChannel.direct;
    expect(direct.countSCs).toBe(2);
    expect(direct.totalMinor).toBeNull();
    expect(direct.unavailableReason).toBe("needs_fx_conversion");
    expect(direct.byCurrency).toEqual([
      { currency: "JPY", minor: 1_000_000 },
      { currency: "USD", minor: 100_000_000 },
    ]);
    // And the defect's number is nowhere in the channel either.
    expect(direct.totalMinor).not.toBe(101_000_000);
  });

  it("F3-4 the per-PARTNER rollup refuses too — the second path, not just the top-level total", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    const p = (res.body.byPartner as Array<Record<string, unknown>>).find(
      (x) => x.partnerId === "ptnr_w35_f3",
    );
    expect(p).toBeTruthy();
    expect(p!.countSCs).toBe(2);
    expect(p!.totalMinor).toBeNull();
    expect(p!.byCurrency).toEqual([
      { currency: "JPY", minor: 500_000 },
      { currency: "USD", minor: 50_000_000 },
    ]);
  });

  it("F3-5 the invariant is now evaluated PER CURRENCY and reports ok", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    expect(res.body._meta.invariantOk).toBe(true);
    const inv = res.body._meta.perCurrencyInvariant as Array<Record<string, unknown>>;
    expect(inv.map((e) => e.currency)).toEqual(["JPY", "USD"]);
    for (const e of inv) expect(e.ok).toBe(true);
  });
});

describe("W35-F3-SINGLE — single-currency companies are byte-for-byte unchanged", () => {
  it("F3-6 JPY POLE (exponent 0): the exact same integer as before the fix", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_JPY}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBe(1_000_000);
    expect(res.body.totalRaisedCurrency).toBe("JPY");
    expect(res.body.byChannel.direct.totalMinor).toBe(1_000_000);
    expect(res.body.byChannel.direct.countSCs).toBe(1);
    expect(res.body.totalRaisedUnavailableReason).toBeUndefined();
  });

  it("F3-7 USD POLE: unchanged, and the exponent-2 amount is not confused with the JPY one", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_USD}`);
    expect(res.body.totalRaisedMinor).toBe(100_000_000);
    expect(res.body.totalRaisedCurrency).toBe("USD");
    expect(res.body.byChannel.direct.totalMinor).toBe(100_000_000);
  });

  it("F3-8 a company with NO soft circles reports a real zero, not a refusal", async () => {
    mkCompany("co_w35_f3_empty", "W35 F3 Empty Inc");
    const res = await request(app).get(`/api/admin/founder-channels/co_w35_f3_empty`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBe(0);
    expect(res.body.totalRaisedByCurrency).toEqual([]);
  });
});
