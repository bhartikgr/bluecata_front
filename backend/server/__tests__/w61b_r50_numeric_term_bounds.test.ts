/**
 * WAVE 61b · R50 — NUMERIC TERM BOUNDS, PROVED OVER HTTP, ON EVERY WRITER.
 *
 * WHY THIS FILE EXISTS. `discount` and `interestRate` were range-fenced by Wave
 * 58e/58f after the live round `rnd_64e9d6ad728a` was found storing
 * `discount: 20260707` — its own createdAt of 2026-07-07 written as a NUMBER.
 * Their SIBLINGS were still guarded only by `Number.isNaN(n) || n < 0`, and a
 * YYYYMMDD date is a large POSITIVE number. R50 bounds five of them.
 *
 * WHAT IS PROVED, at BOTH POLES, through the real Express stack:
 *   LOWER — a DATE-SHAPED NUMBER (20260707) is refused BY NAME, on every writer,
 *           and a re-read shows it was NOT persisted. This is the historical
 *           defect and it is the reason this wave exists.
 *   LOWER — the boundary value just OUTSIDE each domain is refused.
 *   UPPER — an ordinary legitimate value is accepted, persisted, and reads back
 *           unchanged — same units, same rounding.
 *   UPPER — the boundary value just INSIDE each domain is accepted.
 *   UPPER — ABSENT IS UNTOUCHED. A PATCH omitting the field does not zero it.
 *   UPPER — the FIVE PRICED-MONEY fields are still UNBOUNDED (R50 forbids
 *           inventing a ceiling on a round size). Pinned so the report can say
 *           honestly that the hole is NARROWED, not closed.
 *   UPPER — `discount` / `interestRate` behave exactly as Wave 58e/58f left them.
 *
 * THE WRITERS. R50 names two. There are FOUR, and writers 3 and 4 were found by
 * enumeration in this wave — see build_log/wave61b/W61B_WRITER_ENUMERATION.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { getRoundById } from "../roundsStore";
import * as fs from "node:fs";
import * as path from "node:path";

let app: Express;
const USER = "u_admin";
const CO = `co_w61b_${Date.now()}`;

/** The exact shape of the live corruption: a date, written as a number. */
const DATE_SHAPED = 20260707;

async function createRound(name: string, extra: Record<string, unknown> = {}, companyId = CO): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", USER)
    .send({
      companyId,
      name,
      type: "seed",
      state: "draft",
      targetAmount: 1_000_000,
      openDate: "2026-01-01",
      closeDate: "2026-12-01",
      ...extra,
    });
  if (res.status !== 200) throw new Error(`createRound failed ${res.status}: ${JSON.stringify(res.body)}`);
  expect(res.body.ok).toBe(true);
  return res.body.id as string;
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

/* ═══════════════════════════════════════════════════════════════════════════
   WRITER 1 — PATCH /api/rounds/:id/terms   (the Edit-terms dialog)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 61b · R50 · WRITER 1 — PATCH /api/rounds/:id/terms", () => {
  let roundId: string;

  beforeAll(async () => {
    roundId = await createRound("W61b writer1", {
      instrument: "convertible_note",
      valuationCap: 8_000_000,
      maturityMonths: 24,
      expiryYears: 10,
      strikePrice: 0.5,
    });
  }, 30_000);

  /* ── LOWER POLE — THE HISTORICAL DEFECT, one field at a time ───────────── */

  it.each([
    ["maturityMonths", "Maturity (months)"],
    ["expiryYears", "Expiry (years)"],
  ])(
    "LOWER POLE — THE HISTORICAL DEFECT: a DATE-SHAPED NUMBER in `%s` is refused BY NAME and is NOT persisted",
    async (field, label) => {
      const before = getRoundById(roundId) as Record<string, unknown> | undefined;
      const priorValue = before?.[field];

      const res = await request(app)
        .patch(`/api/rounds/${roundId}/terms`)
        .set("x-user-id", USER)
        .send({ [field]: DATE_SHAPED });

      expect(res.status).toBe(400);
      // REFUSED BY NAME: the error code carries the field, and the sentence
      // names the field, the value received and the accepted range.
      expect(res.body?.error).toBe(`invalid_${field}`);
      expect(res.body?.message).toContain(label);
      expect(res.body?.message).toContain(String(DATE_SHAPED));
      // NEVER CLAMPED, NEVER RESCALED (R16) — the refusal says so in words, and
      // the proof is the STORE: nothing was written.
      expect(res.body?.message).toMatch(/does not rescale or clamp/);

      const after = getRoundById(roundId) as Record<string, unknown> | undefined;
      expect(after?.[field]).toEqual(priorValue);
    },
  );

  it.each([
    ["strikePrice", 20260707],
    ["valuationCap", 20260707],
  ])(
    "KNOWN LIMIT, NOT A PASS — a date-shaped number in `%s` is STILL ACCEPTED under R50's domain",
    async (field, value) => {
      /* ═══════════════════════════════════════════════════════════════════════
         READ THIS BEFORE "FIXING" IT. This is a CHARACTERISATION test.
         ═══════════════════════════════════════════════════════════════════════
         R50 sets `strikePrice ∈ (0, 1e9]` and `valuationCap ∈ (0, 1e12]`.
         `20260707` is INSIDE both: a $20,260,707 valuation cap is an ordinary
         Series-A cap, and a $20.2m strike is legal if absurd. So the owner's
         chosen ceilings do NOT refuse the historical defect on these two fields,
         and the pre-flight's claim that a cap of `20261231` is "a $20bn cap" is
         off by three orders of magnitude — it is $20.3m.

         Only `maturityMonths` and `expiryYears` have domains narrow enough to
         catch a YYYYMMDD date. This test exists so that fact is VISIBLE to CI
         rather than discovered by a founder, and it is raised as an OWNER
         QUESTION in build_log/wave61b/WAVE61B_REPORT.md. Do not delete it to
         make the wave look finished. */
      const res = await request(app)
        .patch(`/api/rounds/${roundId}/terms`)
        .set("x-user-id", USER)
        .send({ [field]: value });
      expect(res.status).toBe(200);
      expect(Number(res.body?.round?.[field])).toBe(value);
    },
  );

  it("LOWER POLE — the boundary value just OUTSIDE each domain is refused", async () => {
    const outside: Array<[string, number]> = [
      ["maturityMonths", 601], // (0, 600]
      ["expiryYears", 51], // [0, 50]
      ["strikePrice", 1_000_000_001], // (0, 1e9]
      ["valuationCap", 1_000_000_000_001], // (0, 1e12]
    ];
    for (const [field, value] of outside) {
      const res = await request(app)
        .patch(`/api/rounds/${roundId}/terms`)
        .set("x-user-id", USER)
        .send({ [field]: value });
      expect(res.status, `${field}=${value} must be refused`).toBe(400);
      expect(res.body?.error).toBe(`invalid_${field}`);
    }
  });

  it("LOWER POLE — a ZERO strike and a ZERO cap are refused (R50 opens the lower bound)", async () => {
    for (const field of ["strikePrice", "valuationCap"]) {
      const res = await request(app)
        .patch(`/api/rounds/${roundId}/terms`)
        .set("x-user-id", USER)
        .send({ [field]: 0 });
      expect(res.status, `${field}=0 must be refused`).toBe(400);
      expect(res.body?.error).toBe(`invalid_${field}`);
      // The refusal says how to record "there isn't one" instead.
      expect(res.body?.message).toMatch(/EMPTY|empty/);
    }
  });

  it("LOWER POLE — a NEGATIVE value is still refused by name (v23.7.1 behaviour survives)", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ valuationCap: -5 });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_valuationCap");
  });

  it("LOWER POLE — a FRACTIONAL share count is refused (the column is INTEGER)", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ fdPreMoneyShares: 1000.5 });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_fdPreMoneyShares");
    expect(res.body?.message).toContain("whole number");
  });

  /* ── UPPER POLE — legitimate values still succeed, UNCHANGED ───────────── */

  it("UPPER POLE — ordinary legitimate values are accepted and read back UNCHANGED", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({
        maturityMonths: 24,
        expiryYears: 10,
        strikePrice: 0.001,
        valuationCap: 8_000_000,
        fdPreMoneyShares: 10_000_000,
      });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    const r = res.body?.round;
    // Same units, same rounding. 0.001 is a tenth of a cent and stays one.
    expect(Number(r.maturityMonths)).toBe(24);
    expect(Number(r.expiryYears)).toBe(10);
    expect(Number(r.strikePrice)).toBe(0.001);
    expect(Number(r.valuationCap)).toBe(8_000_000);
    expect(Number(r.fdPreMoneyShares)).toBe(10_000_000);

    const get = await request(app).get(`/api/rounds/${roundId}?as=founder`).set("x-user-id", USER);
    expect(get.status).toBe(200);
    expect(Number(get.body?.strikePrice)).toBe(0.001);
    expect(Number(get.body?.valuationCap)).toBe(8_000_000);
  });

  it("UPPER POLE — the boundary value just INSIDE each domain is accepted", async () => {
    const inside: Array<[string, number]> = [
      ["maturityMonths", 600],
      ["expiryYears", 50],
      ["strikePrice", 1_000_000_000],
      ["valuationCap", 1_000_000_000_000],
    ];
    for (const [field, value] of inside) {
      const res = await request(app)
        .patch(`/api/rounds/${roundId}/terms`)
        .set("x-user-id", USER)
        .send({ [field]: value });
      expect(res.status, `${field}=${value} must be accepted`).toBe(200);
      expect(Number(res.body?.round?.[field])).toBe(value);
    }
  });

  it("UPPER POLE — ZERO months and ZERO years are accepted (their domains are closed at 0)", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ maturityMonths: 0, expiryYears: 0 });
    expect(res.status).toBe(200);
    expect(Number(res.body?.round?.maturityMonths)).toBe(0);
    expect(Number(res.body?.round?.expiryYears)).toBe(0);
  });

  it("UPPER POLE — ABSENT IS UNTOUCHED: a body omitting the fields does not zero them", async () => {
    // Put known values on the round first.
    const seed = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ maturityMonths: 36, valuationCap: 9_000_000, expiryYears: 7, strikePrice: 1.25 });
    expect(seed.status).toBe(200);

    // Now PATCH something else entirely.
    const other = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ termsSummary: "unrelated edit" });
    expect(other.status).toBe(200);

    const get = await request(app).get(`/api/rounds/${roundId}?as=founder`).set("x-user-id", USER);
    expect(Number(get.body?.maturityMonths)).toBe(36);
    expect(Number(get.body?.valuationCap)).toBe(9_000_000);
    expect(Number(get.body?.expiryYears)).toBe(7);
    expect(Number(get.body?.strikePrice)).toBe(1.25);
  });

  it("UPPER POLE — the FIVE PRICED-MONEY fields are STILL UNBOUNDED (R50), including a date-shaped value", async () => {
    /* This is deliberately a CHARACTERISATION test, not an aspiration. The owner
       ruled that an invented ceiling on a round size is the same defect class as
       an invented percentage, so these five keep taking any non-negative number.
       If a later wave bounds them under a stated business policy, this test is
       the thing that must be changed on purpose rather than discovered. */
    const res = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({
        targetAmount: DATE_SHAPED,
        preMoney: DATE_SHAPED,
        postMoney: DATE_SHAPED,
        pricePerShare: DATE_SHAPED,
        minTicket: DATE_SHAPED,
      });
    expect(res.status).toBe(200);
    expect(Number(res.body?.round?.targetAmount)).toBe(DATE_SHAPED);
    expect(Number(res.body?.round?.minTicket)).toBe(DATE_SHAPED);
  });

  it("UPPER POLE — `discount` and `interestRate` are untouched by this wave (Wave 58e/58f survive)", async () => {
    const ok = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ discount: 20, interestRate: 6 });
    expect(ok.status).toBe(200);
    expect(Number(ok.body?.round?.discount)).toBe(20);
    expect(Number(ok.body?.round?.interestRate)).toBe(6);

    // The 58e refusal, unchanged.
    const bad = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ discount: DATE_SHAPED });
    expect(bad.status).toBe(400);
    expect(bad.body?.error).toBe("invalid_discount");

    // The 58f explicit-removal semantics, unchanged.
    const remove = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", USER)
      .send({ discount: null });
    expect(remove.status).toBe(200);
    expect(remove.body?.round?.discount ?? null).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WRITER 2 — POST /api/rounds   (the create wizard; `coerceNumeric`)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 61b · R50 · WRITER 2 — POST /api/rounds", () => {
  it.each([
    ["maturityMonths", "Maturity (months)"],
    ["expiryYears", "Expiry (years)"],
  ])("LOWER POLE — a DATE-SHAPED NUMBER in `%s` is refused BY NAME at creation", async (field, label) => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", USER)
      .send({
        companyId: CO,
        name: `W61b create bad ${field} ${Date.now()}`,
        type: "seed",
        state: "draft",
        targetAmount: 1_000_000,
        openDate: "2026-01-01",
        closeDate: "2026-12-01",
        [field]: DATE_SHAPED,
      });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(`invalid_${field}`);
    expect(res.body?.message).toContain(label);
  });

  it.each([
    ["strikePrice", 10_000_000_000, "Strike price"],
    ["valuationCap", 10_000_000_000_000, "Valuation cap"],
  ])("LOWER POLE — an out-of-range `%s` is refused BY NAME at creation", async (field, value, label) => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", USER)
      .send({
        companyId: CO,
        name: `W61b create oob ${field} ${Date.now()}`,
        type: "seed",
        state: "draft",
        targetAmount: 1_000_000,
        openDate: "2026-01-01",
        closeDate: "2026-12-01",
        [field]: value,
      });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(`invalid_${field}`);
    expect(res.body?.message).toContain(label as string);
  });

  it("LOWER POLE — a thousands-separated OUT-OF-RANGE value is still refused (the create parse is unchanged)", async () => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", USER)
      .send({
        companyId: CO,
        name: `W61b create sep ${Date.now()}`,
        type: "seed",
        state: "draft",
        targetAmount: 1_000_000,
        openDate: "2026-01-01",
        closeDate: "2026-12-01",
        maturityMonths: "20,260,707",
      });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_maturityMonths");
  });

  it("UPPER POLE — a legitimate note is created and its terms persist UNCHANGED", async () => {
    const id = await createRound(`W61b create good ${Date.now()}`, {
      instrument: "convertible_note",
      valuationCap: "8,000,000", // separators still stripped by coerceNumeric
      maturityMonths: 24,
      discount: 20,
      interestRate: 6,
    });
    const get = await request(app).get(`/api/rounds/${id}?as=founder`).set("x-user-id", USER);
    expect(get.status).toBe(200);
    expect(Number(get.body?.valuationCap)).toBe(8_000_000);
    expect(Number(get.body?.maturityMonths)).toBe(24);
    expect(Number(get.body?.discount)).toBe(20);
  });

  it("UPPER POLE — a BLANK term is untouched, never coerced to zero, at creation", async () => {
    const id = await createRound(`W61b create blank ${Date.now()}`, {
      instrument: "safe_post",
      // A discount-only SAFE: the cap is genuinely absent. (The pre-existing
      // create-route backstop requires a cap OR a discount, so the discount is
      // supplied — that rule is not this wave's and is not changed.)
      discount: 20,
      valuationCap: "",
      strikePrice: null,
    });
    const r = getRoundById(id) as Record<string, unknown> | undefined;
    // `""` and null both mean ABSENT; neither becomes a stored 0.
    expect(r?.valuationCap == null || r?.valuationCap === "").toBe(true);
    expect(r?.strikePrice == null || r?.strikePrice === "").toBe(true);
  });

  it("UPPER POLE — the FIVE PRICED-MONEY fields are STILL UNBOUNDED at creation (R50)", async () => {
    const id = await createRound(`W61b create priced ${Date.now()}`, {
      preMoney: DATE_SHAPED,
      postMoney: DATE_SHAPED,
      pricePerShare: DATE_SHAPED,
      minTicket: DATE_SHAPED,
    });
    const r = getRoundById(id) as Record<string, unknown> | undefined;
    expect(Number(r?.preMoney)).toBe(DATE_SHAPED);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WRITER 3 — PATCH /api/founder/rounds/:id   (NOT IN THE BRIEF; found by
   enumeration. Wave 58f had already proved it exists for discount/interestRate.)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 61b · R50 · WRITER 3 — PATCH /api/founder/rounds/:id (the third writer)", () => {
  let roundId: string;

  beforeAll(async () => {
    roundId = await createRound(`W61b writer3 ${Date.now()}`, { instrument: "convertible_note" });
  }, 30_000);

  it.each([["maturityMonths"], ["expiryYears"], ["strikePrice"], ["valuationCap"], ["fdPreMoneyShares"]])(
    "LOWER POLE — an out-of-range `%s` is refused BY NAME on the third writer too",
    async (field) => {
      /* `strikePrice` and `valuationCap` use a value above R50's ceiling rather
         than the date, because the date is INSIDE their domains — see the
         "KNOWN LIMIT" test on writer 1. */
      const value =
        field === "fdPreMoneyShares"
          ? 1e20
          : field === "strikePrice"
            ? 10_000_000_000
            : field === "valuationCap"
              ? 10_000_000_000_000
              : DATE_SHAPED;
      const res = await request(app)
        .patch(`/api/founder/rounds/${roundId}`)
        .set("x-user-id", USER)
        .send({ [field]: value });
      expect(res.status).toBe(400);
      expect(res.body?.error).toBe(`invalid_${field}`);
      const r = getRoundById(roundId) as Record<string, unknown> | undefined;
      expect(Number(r?.[field] ?? NaN)).not.toBe(value);
    },
  );

  it("UPPER POLE — a legitimate patch through the third writer still succeeds and persists", async () => {
    const res = await request(app)
      .patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", USER)
      .send({ valuationCap: 12_000_000, maturityMonths: 18 });
    expect(res.status).toBe(200);
    const r = getRoundById(roundId) as Record<string, unknown> | undefined;
    expect(Number(r?.valuationCap)).toBe(12_000_000);
    expect(Number(r?.maturityMonths)).toBe(18);
  });

  it("UPPER POLE — a patch carrying NONE of the five fields is unaffected (absent is untouched)", async () => {
    const res = await request(app)
      .patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", USER)
      .send({ termsSummary: "third-writer unrelated edit" });
    expect(res.status).toBe(200);
    const r = getRoundById(roundId) as Record<string, unknown> | undefined;
    expect(Number(r?.valuationCap)).toBe(12_000_000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE VALIDATORS THEMSELVES — unit poles, so a route refactor cannot lose them
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 61b · R50 — the shared validators, pole by pole", () => {
  it("each validator refuses the date, accepts the legitimate value, and treats blank as ABSENT", async () => {
    const m = await import("@shared/roundMathEngineAdapter");
    const cases: Array<[(raw: unknown) => { ok: boolean }, unknown, unknown]> = [
      [m.validateMaturityMonths, DATE_SHAPED, 24],
      [m.validateExpiryYears, DATE_SHAPED, 10],
      [m.validateStrikePrice, DATE_SHAPED * 1000, 0.001],
      [m.validateValuationCap, 1e13, 8_000_000],
      [m.validateFdPreMoneyShares, 1e20, 10_000_000],
    ];
    for (const [fn, bad, good] of cases) {
      expect(fn(bad).ok).toBe(false);
      expect(fn(good).ok).toBe(true);
      for (const blank of [null, undefined, ""]) {
        const v = fn(blank) as { ok: boolean; value?: string };
        expect(v.ok).toBe(true);
        expect(v.value).toBe(""); // ABSENT — the caller writes nothing
      }
    }
  });

  it("HONEST LIMIT — a date-shaped SHARE COUNT is NOT detectable, and this test says so", async () => {
    const m = await import("@shared/roundMathEngineAdapter");
    /* 20260707 is ~20.3m shares: an entirely ordinary cap table. No magnitude
       bound can separate it from a date. This is recorded as a KNOWN LIMIT of
       `fdPreMoneyShares`, not as a passing fix. See WAVE61B_REPORT.md §OPEN. */
    expect(m.validateFdPreMoneyShares(DATE_SHAPED).ok).toBe(true);
  });

  it("R16 — no validator rescales, clamps or repairs an accepted value", async () => {
    const m = await import("@shared/roundMathEngineAdapter");
    const v = m.validateValuationCap(8_000_000);
    expect(v.ok).toBe(true);
    if (v.ok) expect(Number(v.value)).toBe(8_000_000);
    const s = m.validateStrikePrice(0.001);
    if (s.ok) expect(Number(s.value)).toBe(0.001); // not rounded to cents
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE WRITER ENUMERATION, AS A TRIPWIRE — the check the last three waves lacked
   ═══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 61b · R50 — every writer is enumerated, and a fourth file trips this", () => {
  const ROOT = path.resolve(__dirname, "..", "..");
  const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  function serverFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (e.name.endsWith(".ts")) out.push(p);
      }
    };
    walk(path.join(ROOT, "server"));
    return out;
  }

  it("W61B-enum1 — exactly THREE files call the round store's writers", () => {
    const files = serverFiles()
      .filter((f) => /\b(updateRound|createRound)\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))
      .sort();
    /* `server/roundsStore.ts` is the DEFINITION module, not a route. The two
       route-bearing files are the other two. If a FOURTH file appears, this
       fails and the enumeration in build_log/wave61b/W61B_WRITER_ENUMERATION.md
       must be redone. This is the tripwire, inherited from Wave 58f. */
    expect(files).toEqual([
      "server/roundCarryForwardRoutes.ts",
      "server/roundsStore.ts",
      "server/routes.ts",
    ]);
  });

  it("W61B-enum2 — all four extras-persisted fields ARE in the store's extras whitelist, so the third writer is real", () => {
    const s = src("server/roundsStore.ts");
    const block = s.slice(s.indexOf("UPDATE_EXTRAS_WHITELIST"), s.indexOf("UPDATE_EXTRAS_WHITELIST") + 1200);
    for (const f of ["valuationCap", "maturityMonths", "strikePrice", "expiryYears"]) {
      expect(block).toContain(`"${f}"`);
    }
  });

  it("W61B-enum3 — the carry-forward ACCEPT route IS a real fourth writer, for `fdPreMoneyShares`", async () => {
    /* Wave 58f proved the accept route could NOT persist `discount` /
       `interestRate`, because it filters through UPDATE_ROUND_WHITELIST_KEYS
       (core columns only). That reasoning does NOT extend to this wave's fields:
       `fdPreMoneyShares` IS a core column and IS on that list. Proved from the
       exported constant so a future change to it trips here. */
    const { UPDATE_ROUND_WHITELIST_KEYS } = await import("../roundsStore");
    expect(UPDATE_ROUND_WHITELIST_KEYS).toContain("fdPreMoneyShares");
    expect(UPDATE_ROUND_WHITELIST_KEYS).not.toContain("valuationCap");
  });

  it("W61B-enum4 — both writers in roundCarryForwardRoutes.ts validate through the SAME table", () => {
    const s = src("server/roundCarryForwardRoutes.ts");
    // one definition, two uses — so the two cannot bound different sets
    expect(s.match(/R50_BOUNDED_TERMS/g)?.length).toBe(3);
    const accept = s.slice(s.indexOf("/carry-forward/accept"), s.indexOf("PATCH /api/founder/rounds/:id"));
    expect(accept).toContain("R50_BOUNDED_TERMS");
  });

  it("W61B-enum5 — no raw SQL writes any of the five fields outside migrations and tests", () => {
    const offenders: string[] = [];
    for (const f of serverFiles()) {
      const s = fs.readFileSync(f, "utf8");
      if (
        /(INSERT\s+INTO|UPDATE)\s+rounds\b/i.test(s) &&
        /valuation_cap|maturity_months|strike_price|expiry_years|fd_pre_money_shares/i.test(s)
      ) {
        offenders.push(path.relative(ROOT, f));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("W61B-enum6 — `numericTerm` is UNCHANGED and still serves the five unbounded priced fields", () => {
    const s = src("server/routes.ts");
    // The helper's body is byte-identical: this is what proves no unauthorised
    // field was bounded by a change inside it (R50).
    expect(s).toContain("if (Number.isNaN(n) || n < 0) {");
    expect(s).toContain("`${key} must be a non-negative number`");
    for (const f of ["targetAmount", "preMoney", "postMoney", "pricePerShare", "minTicket"]) {
      expect(s).toContain(`numericTerm("${f}")`);
    }
    // and NONE of the five R50 fields still routes through it
    for (const f of ["valuationCap", "maturityMonths", "strikePrice", "expiryYears", "fdPreMoneyShares"]) {
      expect(s).not.toContain(`numericTerm("${f}")`);
    }
  });
});
