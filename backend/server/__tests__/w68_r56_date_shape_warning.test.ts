/**
 * WAVE 68 · R56 — A DATE-SHAPED VALUE IN A MONEY FIELD IS **WARNED** ABOUT,
 * NEVER REFUSED. PROVED THROUGH THE HTTP WRITERS, NOT REASONED ABOUT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES
 * ═══════════════════════════════════════════════════════════════════════════
 *   · `20260707` into `valuationCap` or `strikePrice` returns HTTP 200, the
 *     value IS STORED, and a `termWarnings` sentence names the suspicion and
 *     the alternative. It is not an error and it is not a block (NOT R42).
 *   · The trigger is NARROW: a 7-digit and a 9-digit number produce NO warning,
 *     and neither does an impossible month, an impossible day, a year outside
 *     the window, `20260229` (2026 is not a leap year) or a decimal.
 *   · `maturityMonths` and `expiryYears` STILL REFUSE `20260707` by range —
 *     R56 forbids softening a working fence into a warning.
 *   · The rule is stated ONCE (`@shared/roundMathEngineAdapter`) and imported by
 *     all three writers, so they cannot drift.
 *
 * NOT PROVED HERE — CARRIED INTO THE REPORT AS UNVERIFIED
 *   · NO CLIENT SURFACE RENDERS `termWarnings`. The channel is server-side only
 *     and was already so for Wave 58e's market-norm disclosures. The warning is
 *     therefore proved AT THE API BOUNDARY, and a founder does not yet see it in
 *     the browser. That is a real gap and it is stated in WAVE68_REPORT.md
 *     rather than implied away; closing it belongs to R56's deferred option (3),
 *     the next wave that touches those dialogs.
 *   · Writer 3 (`PATCH /api/founder/rounds/:id`) is asserted against SOURCE, not
 *     exercised over HTTP: it needs an owned-company fixture that Wave 61b also
 *     judged out of proportion. Writer 4 deliberately has no warning (it can
 *     only persist `fdPreMoneyShares`, a share count, which R56 does not cover).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  dateShapeOf,
  dateShapedValueWarning,
  DATE_SHAPE_WARNED_FIELDS,
  DATE_SHAPE_YEAR_MIN,
  DATE_SHAPE_YEAR_MAX,
} from "@shared/roundMathEngineAdapter";

const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w68_${STAMP}`;
const ADMIN = "u_admin";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

async function createRound(payload: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, name: `W68 ${Math.random()}`, type: "safe", instrument: "safe_post",
            targetAmount: 1_000_000, openDate: "2026-01-01", closeDate: "2026-12-31", ...payload });
  return { status: res.status, body: res.body as Record<string, any> };
}

async function patchTerms(roundId: string, body: Record<string, unknown>) {
  const res = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);
  return { status: res.status, body: res.body as Record<string, any> };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-R56-A — THE SHAPE TEST IS NARROW. THIS IS THE HALF THAT MATTERS MOST:
 * "a warning that fires on legitimate input is worse than none" (R56).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-R56-A — the date-shape test fires ONLY on a plausible 8-digit date", () => {
  it("W68-R56-A1 — 20260707 is date-shaped and resolves to 2026-07-07", () => {
    expect(dateShapeOf(20260707)).toBe("2026-07-07");
    expect(dateShapeOf("20260707")).toBe("2026-07-07");
    expect(dateShapeOf(" 20260707 ")).toBe("2026-07-07");
  });

  it("W68-R56-A2 — a SEVEN-digit and a NINE-digit number are NOT date-shaped (R56, explicit)", () => {
    expect(dateShapeOf(2026070)).toBeNull();     // 7 digits
    expect(dateShapeOf(202607070)).toBeNull();   // 9 digits
    expect(dateShapeOf("8000000")).toBeNull();   // an $8m cap
    expect(dateShapeOf("120000000")).toBeNull(); // a $120m cap
  });

  it("W68-R56-A3 — an impossible month or day is NOT date-shaped", () => {
    expect(dateShapeOf(20261307)).toBeNull(); // month 13
    expect(dateShapeOf(20260007)).toBeNull(); // month 00
    expect(dateShapeOf(20260732)).toBeNull(); // day 32
    expect(dateShapeOf(20260700)).toBeNull(); // day 00
    expect(dateShapeOf(20260631)).toBeNull(); // June has 30 days
  });

  it("W68-R56-A4 — the leap year is respected in both directions", () => {
    expect(dateShapeOf(20260229)).toBeNull();       // 2026 is not a leap year
    expect(dateShapeOf(20240229)).toBe("2024-02-29"); // 2024 is
    expect(dateShapeOf(21000229)).toBeNull();       // 2100 is NOT a leap year
    expect(dateShapeOf(20000229)).toBe("2000-02-29"); // 2000 is (÷400)
  });

  it("W68-R56-A5 — a year outside the plausible window is NOT date-shaped", () => {
    expect(dateShapeOf(`${DATE_SHAPE_YEAR_MIN - 1}0707`)).toBeNull();
    expect(dateShapeOf(`${DATE_SHAPE_YEAR_MAX + 1}0707`)).toBeNull();
    expect(dateShapeOf(`${DATE_SHAPE_YEAR_MIN}0707`)).not.toBeNull();
    expect(dateShapeOf(`${DATE_SHAPE_YEAR_MAX}0707`)).not.toBeNull();
  });

  it("W68-R56-A6 — anything that is not exactly eight digits is silent", () => {
    for (const v of ["20260707.0", "-20260707", "+20260707", "2026070.7", "20,260,707",
                     "20260707abc", "", null, undefined, "abc", 8_000_000, 1e12]) {
      expect(dateShapeOf(v as unknown), `${String(v)} warned`).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-R56-B — THE SENTENCE. NAMES THE SUSPICION AND THE ALTERNATIVE, NEVER AN
 * ERROR.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-R56-B — the wording", () => {
  it("W68-R56-B1 — it names the value, the date it looks like, and the amount it would be", () => {
    const w = dateShapedValueWarning("valuationCap", 20260707)!;
    expect(w).toContain("20260707");
    expect(w).toContain("2026-07-07");
    expect(w).toContain("20,260,707");   // the ALTERNATIVE, grouped
    expect(w).toContain("valuation cap");
  });

  it("W68-R56-B2 — it is never phrased as an error, and says the value HAS been stored", () => {
    const w = dateShapedValueWarning("strikePrice", 20260707)!;
    expect(w.toLowerCase()).not.toContain("error");
    expect(w.toLowerCase()).not.toContain("invalid");
    expect(w.toLowerCase()).not.toContain("refus");
    expect(w.toLowerCase()).not.toContain("rejected");
    expect(w).toContain("stored exactly as written");
    expect(w).toContain("not a rejection");
    expect(w).toContain("strike price");
  });

  it("W68-R56-B3 — no currency symbol is invented (R29: the round's currency is not assumed)", () => {
    const w = dateShapedValueWarning("valuationCap", 20260707)!;
    expect(w).not.toContain("$");
    expect(w).toContain("in the round's currency");
  });

  it("W68-R56-B4 — MONEY FIELDS ONLY. The covered set is exactly two, and it is declared", () => {
    expect([...DATE_SHAPE_WARNED_FIELDS]).toEqual(["valuationCap", "strikePrice"]);
  });

  it("W68-R56-B5 — nothing to say means null, never an empty-string warning", () => {
    expect(dateShapedValueWarning("valuationCap", 8_000_000)).toBeNull();
    expect(dateShapedValueWarning("strikePrice", "1.50")).toBeNull();
    expect(dateShapedValueWarning("valuationCap", null)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-R56-C — THROUGH HTTP. THE SAVE PROCEEDS.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-R56-C — the writers WARN and STORE (this is not R42's block)", () => {
  it("W68-R56-C1 — POST /api/rounds with valuationCap 20260707 returns 200 and warns", async () => {
    const r = await createRound({ valuationCap: 20260707 });
    expect(r.status).toBe(200);
    expect(r.body.ok).not.toBe(false);
    const warnings: string[] = r.body.termWarnings ?? [];
    expect(warnings.join(" ")).toContain("looks like a date");
    expect(warnings.join(" ")).toContain("20,260,707");
  });

  it("W68-R56-C2 — and the value is REALLY STORED, unchanged (accepted, not clamped)", async () => {
    const r = await createRound({ valuationCap: 20260707 });
    expect(r.status).toBe(200);
    const id = r.body.round?.id ?? r.body.id;
    expect(id, `no round id in ${JSON.stringify(r.body).slice(0, 200)}`).toBeTruthy();
    const got = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    expect(got.status).toBe(200);
    expect(Number(got.body.valuationCap)).toBe(20260707);
  });

  it("W68-R56-C3 — PATCH /api/rounds/:id/terms warns on valuationCap and on strikePrice, and saves", async () => {
    const created = await createRound({ valuationCap: 8_000_000 });
    const id = created.body.round?.id ?? created.body.id;
    const p = await patchTerms(String(id), { valuationCap: 20260707, strikePrice: 20260707 });
    expect(p.status).toBe(200);
    const warnings: string[] = p.body.termWarnings ?? [];
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => w.includes("valuation cap"))).toBe(true);
    expect(warnings.some((w) => w.includes("strike price"))).toBe(true);
    const got = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    expect(Number(got.body.valuationCap)).toBe(20260707);
    expect(Number(got.body.strikePrice)).toBe(20260707);
  });

  it("W68-R56-C4 — a 7-digit and a 9-digit cap produce NO warning at all", async () => {
    for (const v of [8_000_000, 120_000_000]) {
      const r = await createRound({ valuationCap: v });
      expect(r.status).toBe(200);
      const warnings: string[] = r.body.termWarnings ?? [];
      expect(warnings.join(" "), `valuationCap ${v} warned`).not.toContain("looks like a date");
    }
  });

  it("W68-R56-C5 — maturityMonths and expiryYears STILL REFUSE 20260707 (R56: do not soften)", async () => {
    for (const key of ["maturityMonths", "expiryYears"]) {
      const r = await createRound({ [key]: 20260707 });
      expect(r.status, `${key} was accepted`).toBe(400);
      expect(String(r.body.error)).toBe(`invalid_${key}`);
    }
  });

  it("W68-R56-C6 — the discount fence is untouched: 20260707 is still a 400, never a warning", async () => {
    const r = await createRound({ discount: 20260707 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe("invalid_discount");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-R56-D — ONE RULE, THREE WRITERS. THE ENUMERATION IS THE TEST (61b's
 * lesson: a single-writer fix is a fix that reopens).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-R56-D — the rule is imported, not restated, at every money writer", () => {
  it("W68-R56-D1 — the sentence exists in exactly ONE place in the tree", () => {
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter).toContain("looks like a date");
    for (const f of ["server/routes.ts", "server/roundCarryForwardRoutes.ts",
                     "client/src/pages/founder/RoundNew.tsx", "client/src/pages/founder/RoundDetail.tsx"]) {
      expect(src(f), `${f} restates the sentence`).not.toContain("looks like a date (");
    }
  });

  it("W68-R56-D2 — all three money writers call the imported helper", () => {
    const routes = src("server/routes.ts");
    const cfr = src("server/roundCarryForwardRoutes.ts");
    /* writer 1 (PATCH .../terms) and writer 2 (POST /api/rounds) */
    expect(routes.match(/dateShapedValueWarning\(/g)?.length).toBe(2);
    /* writer 3 (PATCH /api/founder/rounds/:id) */
    expect(cfr.match(/dateShapedValueWarning\(/g)?.length).toBe(1);
    /* and each pushes onto the NON-BLOCKING array, never onto a 400 */
    expect(routes).toContain("if (_w) termWarnings.push(_w);");
    expect(cfr).toContain("if (_w) termWarnings.push(_w);");
  });

  it("W68-R56-D3 — writer 4 deliberately has NO warning, and says why in source", () => {
    /* The accept route filters its patch to UPDATE_ROUND_WHITELIST_KEYS, so the
       only R50 field it can persist is `fdPreMoneyShares` — a SHARE COUNT, which
       R56 does not cover. Recorded in source rather than silently skipped. */
    const cfr = src("server/roundCarryForwardRoutes.ts");
    expect(cfr).toContain("WRITER 4");
    expect(cfr).toContain("money\n         fields only");
  });

  it("W68-R56-D4 — migration 0192 does NOT implement this (a SQLite trigger cannot warn)", () => {
    const mig = src("migrations/0192_wave68_term_domain_fences.sql");
    expect(mig).not.toContain("looks like a date");
    /* and it says so, so the next reader does not add it */
    expect(mig).toContain("cannot WARN, only ABORT");
  });
});
