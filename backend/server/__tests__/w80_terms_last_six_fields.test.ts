/**
 * WAVE 80 · ITEM 3 — THE LAST SIX FIELDS `PATCH /api/rounds/:id/terms` DISCARDED.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, and what made it survive. Six keys sat on
 * `roundsStore.UPDATE_EXTRAS_WHITELIST` — `cap`, `expiryDate`, `poolSize`,
 * `proRata`, `sharesAuthorized`, `useOfProceeds` — so the STORE would have
 * persisted every one. This route put none of them into `updates` and refused
 * none of them either: it returned HTTP 200 `{"ok":true}` having thrown the
 * submitted value away. Worse, a regression test PINNED that as correct, so the
 * suite was green precisely because the defect was intact.
 *
 * WHAT WAVE 80 DID, and what this file proves. Four persist, two refuse by name.
 * Every assertion below reads the value back OUT OF THE STORE (or off a fresh
 * `GET`), never off the mutation's own echo — a 200 is not evidence, which is the
 * whole lesson of this finding.
 *
 * BOTH POLES, for every field:
 *   PERSIST pole — a valid value survives the round-trip and is on the round a
 *                  founder reloads.
 *   REFUSE pole  — an invalid value is refused BY NAME with HTTP 400 and NOTHING
 *                  is written; and the two derived/aliased spellings are refused
 *                  by name even when they are perfectly well-formed, because
 *                  accepting them would create a second, contradicting copy of a
 *                  term the round already stores canonically.
 *   REMOVAL pole — explicit `null` clears the value rather than being ignored.
 *   ABSENT pole  — a field missing from the body is left UNTOUCHED, never reset.
 *
 * MUTATION TRANSCRIPT: build_log/wave80/W80_TESTS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { getRoundById } from "../roundsStore";
import {
  ROUND_CAP_ALIAS_NOT_WRITABLE,
  EXPIRY_DATE_NOT_WRITABLE,
  validateUseOfProceeds,
  SHARES_AUTHORIZED_MAX,
} from "@shared/roundMathEngineAdapter";

const ADMIN = "u_admin";
const STAMP = `w80t${Date.now().toString(36)}`;
let app: Express;

async function makeRound(key: string): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W80 ${key}` });
  expect(co.status, `company create ${key}`).toBeLessThan(400);
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Round ${key}`, type: "seed", instrument: "preferred",
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
  });
  expect(created.status, `round create ${key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  return { companyId, roundId: String((created.body as { id: string }).id) };
}

const patchTerms = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);

/** Read the STORED round, so no assertion can pass on a response echo. */
const stored = (roundId: string): Record<string, unknown> =>
  (getRoundById(roundId) ?? {}) as unknown as Record<string, unknown>;

const NARRATIVE = "50% engineering hires (12 FTE / 18mo); 20% compute; 22% GTM; 8% legal";

describe("WAVE 80 · ITEM 3 — the six accepted-and-discarded term fields", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ───────────────────────── THE FOUR THAT PERSIST ───────────────────────── */

  it("W80-I3-A — PERSIST POLE: all four persisted fields survive one patch and a fresh GET", async () => {
    const { roundId } = await makeRound("persist");

    /* PRE-STATE, so the pass cannot be vacuous: none of the four is on the round. */
    const before = stored(roundId);
    expect(before.proRata ?? null).toBeNull();
    expect(before.useOfProceeds ?? null).toBeNull();
    expect(before.poolSize ?? null).toBeNull();

    const res = await patchTerms(roundId, {
      sharesAuthorized: 55_000_000,
      poolSize: 4_500_000,
      proRata: true,
      useOfProceeds: NARRATIVE,
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.ok).toBe(true);

    /* OUT OF THE STORE — the actual values, not the echo. */
    const s = stored(roundId);
    expect(Number(s.sharesAuthorized)).toBe(55_000_000);
    expect(Number(s.poolSize)).toBe(4_500_000);
    expect(s.proRata).toBe(true);
    expect(s.useOfProceeds).toBe(NARRATIVE);

    /* And on the round a founder reloads. */
    const reread = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(reread.status).toBe(200);
    expect(Number((reread.body as Record<string, unknown>).sharesAuthorized)).toBe(55_000_000);
    expect(Number((reread.body as Record<string, unknown>).poolSize)).toBe(4_500_000);
    expect((reread.body as Record<string, unknown>).proRata).toBe(true);
    expect((reread.body as Record<string, unknown>).useOfProceeds).toBe(NARRATIVE);
  });

  it("W80-I3-B — SHAPE POLE: use of proceeds also persists as STRUCTURED ROWS, unchanged", async () => {
    const { roundId } = await makeRound("rows");
    const rows = [
      { category: "Engineering hires", percent: 55, amount: 577_500 },
      { category: "Cloud + compute", percent: 45, amount: 472_500 },
    ];
    const res = await patchTerms(roundId, { useOfProceeds: rows });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(stored(roundId).useOfProceeds).toEqual(rows);
  });

  it("W80-I3-C — REFUSE POLE: an out-of-range or wrongly-typed value is refused BY NAME and writes nothing", async () => {
    const { roundId } = await makeRound("refuse");
    /* Establish a known good value first, so \"nothing was written\" is provable. */
    expect((await patchTerms(roundId, { poolSize: 1_000 })).status).toBe(200);
    expect(Number(stored(roundId).poolSize)).toBe(1_000);

    /* (a) a fractional share count — the column is an integer. */
    const frac = await patchTerms(roundId, { poolSize: 12.5 });
    expect(frac.status).toBe(400);
    expect(String(frac.body.error)).toContain("poolSize");
    expect(Number(stored(roundId).poolSize)).toBe(1_000); // untouched

    /* (b) above the shared share-count ceiling. */
    const huge = await patchTerms(roundId, { sharesAuthorized: SHARES_AUTHORIZED_MAX + 1 });
    expect(huge.status).toBe(400);
    expect(String(huge.body.error)).toContain("sharesAuthorized");

    /* (c) `proRata` as a STRING. \"false\" is truthy; casting it would record the
       opposite of what was sent, so it is refused by name instead. */
    const strBool = await patchTerms(roundId, { proRata: "false" });
    expect(strBool.status).toBe(400);
    expect(strBool.body.error).toBe("invalid_proRata");
    expect(strBool.body.field).toBe("proRata");
    expect(stored(roundId).proRata ?? null).toBeNull(); // nothing written

    /* (d) use of proceeds as a number, and as rows missing a category. */
    const num = await patchTerms(roundId, { useOfProceeds: 42 });
    expect(num.status).toBe(400);
    expect(num.body.error).toBe("invalid_useOfProceeds");
    expect(num.body.field).toBe("useOfProceeds");
    const badRows = await patchTerms(roundId, { useOfProceeds: [{ percent: 50, amount: 100 }] });
    expect(badRows.status).toBe(400);
    expect(badRows.body.error).toBe("invalid_useOfProceeds");
    expect(stored(roundId).useOfProceeds ?? null).toBeNull();
  });

  it("W80-I3-D — REMOVAL and ABSENT poles: null clears, and a missing key is untouched", async () => {
    const { roundId } = await makeRound("three");
    expect((await patchTerms(roundId, { poolSize: 2_222, proRata: true, useOfProceeds: NARRATIVE })).status).toBe(200);
    expect(Number(stored(roundId).poolSize)).toBe(2_222);

    /* ABSENT — a patch that mentions only `termsSummary` must not disturb them. */
    expect((await patchTerms(roundId, { termsSummary: "unrelated edit" })).status).toBe(200);
    const afterAbsent = stored(roundId);
    expect(Number(afterAbsent.poolSize)).toBe(2_222);
    expect(afterAbsent.proRata).toBe(true);
    expect(afterAbsent.useOfProceeds).toBe(NARRATIVE);

    /* REMOVAL — explicit null clears each one, rather than being ignored. */
    expect((await patchTerms(roundId, { poolSize: null, proRata: null, useOfProceeds: null })).status).toBe(200);
    const afterNull = stored(roundId);
    expect(afterNull.poolSize ?? null).toBeNull();
    expect(afterNull.proRata ?? null).toBeNull();
    expect(afterNull.useOfProceeds ?? null).toBeNull();

    /* An empty string is a removal too, not a stored empty narrative. */
    expect((await patchTerms(roundId, { useOfProceeds: "   " })).status).toBe(200);
    expect(stored(roundId).useOfProceeds ?? null).toBeNull();
  });

  /* ─────────────────── THE TWO THAT REFUSE, BY NAME, ALWAYS ─────────────────── */

  it("W80-I3-E — REFUSE POLE: `cap` and `expiryDate` are refused by name even when well-formed", async () => {
    const { roundId } = await makeRound("alias");
    /* The canonical spellings DO work on this same route, which is what makes the
       refusals honest rather than a wall. */
    expect((await patchTerms(roundId, { valuationCap: 8_000_000, expiryYears: 5 })).status).toBe(200);
    expect(Number(stored(roundId).valuationCap)).toBe(8_000_000);
    expect(Number(stored(roundId).expiryYears)).toBe(5);

    const capRes = await patchTerms(roundId, { cap: 9_000_000 });
    expect(capRes.status).toBe(400);
    expect(capRes.body.error).toBe(ROUND_CAP_ALIAS_NOT_WRITABLE.error);
    expect(capRes.body.field).toBe("cap");
    /* The refusal names the control that DOES work (R58). */
    expect(String(capRes.body.message)).toContain("Valuation cap");
    /* And it wrote nothing — not the alias, and not the canonical field either. */
    expect(stored(roundId).cap ?? null).toBeNull();
    expect(Number(stored(roundId).valuationCap)).toBe(8_000_000);

    const expRes = await patchTerms(roundId, { expiryDate: "2031-01-01" });
    expect(expRes.status).toBe(400);
    expect(expRes.body.error).toBe(EXPIRY_DATE_NOT_WRITABLE.error);
    expect(expRes.body.field).toBe("expiryDate");
    expect(String(expRes.body.message)).toContain("Expiry (years)");
    expect(stored(roundId).expiryDate ?? null).toBeNull();
    expect(Number(stored(roundId).expiryYears)).toBe(5);
  });

  it("W80-I3-F — the refusal sentences fit the client's own 240-character message window", async () => {
    /* `client/src/lib/queryClient.ts` uses a server message as `ApiError.message`
       only when it is under 240 characters; longer ones are replaced by a generic
       substitute and the founder never reads the real reason. Both new refusals are
       written to fit, so they render through EVERY client path rather than only the
       ones that read `payload.message`. Measured, not assumed. */
    expect(ROUND_CAP_ALIAS_NOT_WRITABLE.message.length).toBeLessThan(240);
    expect(EXPIRY_DATE_NOT_WRITABLE.message.length).toBeLessThan(240);
  });

  it("W80-I3-G — the use-of-proceeds validator itself: both shapes in, refusals named", async () => {
    /* The pure function, so the decision is testable without an HTTP round-trip. */
    expect(validateUseOfProceeds(NARRATIVE)).toEqual({ ok: true, value: NARRATIVE });
    expect(validateUseOfProceeds("  ")).toEqual({ ok: true, value: null });
    expect(validateUseOfProceeds(null)).toEqual({ ok: true, value: null });
    expect(validateUseOfProceeds([])).toEqual({ ok: true, value: null });
    const rows = [{ category: "GTM", percent: 20, amount: 100 }];
    expect(validateUseOfProceeds(rows)).toEqual({ ok: true, value: rows });
    for (const bad of [42, true, {}, [{ category: "", percent: 1, amount: 1 }], [{ category: "x", percent: 101, amount: 1 }], [{ category: "x", percent: 1, amount: -1 }]]) {
      const v = validateUseOfProceeds(bad);
      expect(v.ok, `${JSON.stringify(bad)} must be refused`).toBe(false);
      if (!v.ok) expect(v.error).toBe("invalid_useOfProceeds");
    }
  });
});
