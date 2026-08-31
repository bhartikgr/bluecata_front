/**
 * WAVE 134 cause 3-of-3 — PROOF FOR THE ROUND-DATE FIXTURE.
 *
 * The fixture (`_fixtures/roundDatesFixture.ts`) exists because 52 round-creation
 * bodies across 13 test files predate the mandatory Open date / Target close date
 * backstop on `POST /api/rounds` and were being refused 400 at the door, so their
 * assertions never ran. This file is the evidence that the fixture did NOT achieve
 * that by weakening anything:
 *
 *   §1  The gate still REFUSES a dateless body, by name, before anything else.
 *   §2  The fixture never overwrites a date a test set on purpose (so a
 *       deliberately-invalid date still reaches the validator and still 400s).
 *   §3  R92 — a target close date in the PAST is ACCEPTED and WARNED, never
 *       blocked, and the warning is the shared sentence.
 *   §4  R93 — a round whose target close is TODAY is NOT swept closed, while one
 *       whose target close was YESTERDAY still is (the sweeper is not disabled).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { getRoundById } from "../roundsStore";
import { rounds as roundsTable } from "../../shared/schema";
import { eq } from "drizzle-orm";
import { sweepClosedRounds } from "../lib/roundCloseCascade";
import { todayDateOnly, pastTargetCloseNotice } from "../../shared/roundTargetCloseRule";
import {
  withRoundDates,
  roundFixtureDates,
  roundFixtureOpenDate,
  roundFixtureCloseDate,
  pastTargetCloseDates,
  closingTodayDates,
  fixtureDay,
} from "./_fixtures/roundDatesFixture";
import { w212Attest } from "./_w212RoundAttestation";

let app: Express;
const ADMIN = "u_admin";
const CO = `co_w134_dates_${Date.now()}`;

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

function post(body: Record<string, unknown>) {
  return request(app).post("/api/rounds").set("x-user-id", ADMIN).send(w212Attest(body));
}

function baseBody(name: string, extra: Record<string, unknown> = {}) {
  return { companyId: CO, name, type: "seed", state: "draft", targetAmount: 1_000_000, ...extra };
}

/* ══════════════ §1 — THE GATE STILL REFUSES A DATELESS BODY ══════════════ */

describe("W134 §1 — the mandatory-date gate is unchanged and still refuses", () => {
  it("a body with NO dates is refused 400 OPEN_DATE_REQUIRED", async () => {
    const r = await post(baseBody("W134 no dates at all"));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("OPEN_DATE_REQUIRED");
  });

  it("an open date with NO target close date is refused 400 CLOSE_DATE_REQUIRED", async () => {
    const r = await post(baseBody("W134 open only", { openDate: roundFixtureOpenDate() }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CLOSE_DATE_REQUIRED");
  });

  it("a whitespace-only date is still empty to the gate (not smuggled through)", async () => {
    const r = await post(baseBody("W134 blank dates", { openDate: "   ", closeDate: "   " }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("OPEN_DATE_REQUIRED");
  });

  it("the SAME body routed through the fixture is accepted — the fixture is the only difference", async () => {
    const r = await post(withRoundDates(baseBody("W134 fixture dates")));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.id).toBeTruthy();
  });
});

/* ══════════════ §2 — THE FIXTURE CANNOT MASK A DATE TEST ══════════════ */

describe("W134 §2 — the fixture fills only what is missing", () => {
  it("supplies unambiguously FUTURE dates, open before close, and close is never today", () => {
    const { openDate, closeDate } = roundFixtureDates();
    const today = todayDateOnly();
    expect(openDate > today).toBe(true);
    expect(closeDate > today).toBe(true);
    expect(closeDate).not.toBe(today);
    expect(openDate < closeDate).toBe(true);
    // Never warned: a future close date has no R92 notice.
    expect(pastTargetCloseNotice(closeDate)).toBeNull();
  });

  it("does not overwrite dates the test supplied — including deliberately invalid ones", () => {
    const kept = withRoundDates({ openDate: "not-a-date", closeDate: "2026-13-45" });
    expect(kept.openDate).toBe("not-a-date");
    expect(kept.closeDate).toBe("2026-13-45");
    const half = withRoundDates({ openDate: "2030-01-01" });
    expect(half.openDate).toBe("2030-01-01");
    expect(half.closeDate).toBe(roundFixtureCloseDate());
    // Explicit override wins over the default, and empty/undefined are filled.
    const overridden = withRoundDates({ openDate: "", closeDate: undefined }, pastTargetCloseDates());
    expect(overridden.openDate).toBe(pastTargetCloseDates().openDate);
    expect(overridden.closeDate).toBe(pastTargetCloseDates().closeDate);
  });

  it("an invalid date passed through the fixture still reaches the validator and is still refused", async () => {
    const r = await post(withRoundDates(baseBody("W134 bad open date", { openDate: "31/12/2030" })));
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/openDate/i);
  });

  it("dates are derived from today, so the fixture cannot rot into the past", () => {
    expect(fixtureDay(0)).toBe(todayDateOnly());
    expect(fixtureDay(1) > fixtureDay(0)).toBe(true);
    expect(fixtureDay(-1) < fixtureDay(0)).toBe(true);
  });
});

/* ══════════════ §3 — R92: PAST TARGET CLOSE IS ACCEPTED AND WARNED ══════════ */

describe("W134 §3 — R92 boundary: a PAST target close date is accepted and warned", () => {
  it("creation succeeds and returns the shared past-close sentence in termWarnings", async () => {
    const past = pastTargetCloseDates();
    const r = await post(baseBody("W134 R92 past close", past));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // ACCEPTED — never blocked (R92).
    const saved = getRoundById(r.body.id as string);
    expect(saved).toBeTruthy();
    // WARNED — and with the rule's own sentence, not a local paraphrase.
    const warnings: string[] = r.body.termWarnings ?? [];
    const expected = pastTargetCloseNotice(past.closeDate)!;
    expect(expected).toBeTruthy();
    expect(warnings).toContain(expected);
    expect(warnings.filter((w) => w === expected)).toHaveLength(1); // warned once, not three times
  });

  it("a FUTURE target close date is accepted with NO past-close warning", async () => {
    const r = await post(withRoundDates(baseBody("W134 R92 future close")));
    expect(r.status).toBe(200);
    const warnings: string[] = r.body.termWarnings ?? [];
    expect(warnings.some((w) => w.includes("is in the past. Capavate accepts it"))).toBe(false);
  });
});

/* ══════════════ §4 — R93: CLOSING TODAY IS NOT SWEPT CLOSED ══════════════ */

describe("W134 §4 — R93 boundary: target close TODAY must not be swept closed", () => {
  it("the sweeper leaves a round closing TODAY open, and still closes one that closed YESTERDAY", async () => {
    const today = closingTodayDates();
    const closingToday = await post(baseBody("W134 R93 closes today", today));
    expect(closingToday.status).toBe(200);
    const todayId = closingToday.body.id as string;

    const yesterday = { openDate: fixtureDay(-60), closeDate: fixtureDay(-1) };
    const closedYesterday = await post(baseBody("W134 R93 closed yesterday", yesterday));
    expect(closedYesterday.status).toBe(200);
    const yesterdayId = closedYesterday.body.id as string;

    /* State is read from the DB ROW, which is what the sweeper writes, exactly as
       the ratified wave-121 boundary test does (w121_sweeper_boundary_and_dead_code
       .test.ts:177). `getRoundById` is an in-memory cache the sweeper's cascade tx
       does not invalidate, so it is not the witness for an unattended job. */
    const readRound = (id: string): any =>
      (getDb().select().from(roundsTable).where(eq((roundsTable as any).id, id)).all() as any[])[0] ?? null;

    // Both start not-closed, so the sweep below is what makes the difference.
    expect(readRound(todayId).state).not.toBe("closed");
    expect(readRound(yesterdayId).state).not.toBe("closed");

    const result = sweepClosedRounds();
    expect(result.scanned).toBeGreaterThan(0);

    // TODAY IS NOT PAST — the whole point of R93 and the wave-121 boundary fix.
    expect(readRound(todayId).state).not.toBe("closed");
    expect(String(readRound(todayId).closeDate ?? readRound(todayId).close_date).slice(0, 10)).toBe(todayDateOnly());
    // ...and the sweeper is demonstrably still doing its job on a genuinely past date.
    expect(readRound(yesterdayId).state).toBe("closed");
    expect(result.closed).toBeGreaterThanOrEqual(1);
  });
});
