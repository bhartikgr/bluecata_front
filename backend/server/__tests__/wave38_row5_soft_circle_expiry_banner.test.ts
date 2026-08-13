/**
 * WAVE 38 · ROW 5 — the soft-circle expiry banner is honestly driven.
 *
 * Three claims, each asserted at BOTH poles:
 *
 *  1. There is a DURABLE soft-circled-at timestamp. `DecisionRecord` has no
 *     such column, but the transition history does carry it and history is
 *     persisted to `your_decision_records.history_json`. This file proves the
 *     timestamp is read BACK OFF THE DATABASE ROW, not off the in-process Map,
 *     by parsing the raw row itself.
 *  2. When the database cannot supply the timestamp, the derivation returns
 *     `null` — never `Date.now()`, never a client value, never an approximation.
 *  3. The banner copy and the countdown are ONE implementation shared by the
 *     server runner and the client component. Before Wave 38 there were two,
 *     and they disagreed: the client rendered `day(s)` while the runner emitted
 *     `day`/`days`.
 *
 * No assertion here trusts an exit code, and none re-implements the production
 * arithmetic — every expectation is a literal or is read off the database.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  applyDecisionAction,
  deriveSoftCircledAt,
  _persistRecord,
  type DecisionRecord,
} from "../yourDecisionStore";
import {
  daysRemaining,
  expiryBannerCopy,
  expiryBannerCopyForDays,
  SOFT_CIRCLE_EXPIRY_DAYS,
} from "@shared/softCircleExpiry";
import * as runner from "../lib/softCircleExpiryRunner";
import { rawDb, getDbDriver } from "../db/connection";

const DAY_MS = 24 * 60 * 60 * 1000;

function freshRecord(id: string): DecisionRecord {
  return {
    invitationId: id,
    roundId: `rnd_${id}`,
    companyId: `co_${id}`,
    state: "viewed",
    history: [],
    mim: [],
  };
}

/** Read history_json straight off the durable row — no store cache involved. */
function historyFromDb(invitationId: string): Array<{ ts: string; to: string }> {
  const row: any = rawDb()
    .prepare(`SELECT history_json FROM your_decision_records WHERE invitation_id = ?`)
    .get(invitationId);
  if (!row) throw new Error(`no durable row for ${invitationId}`);
  return JSON.parse(row.history_json ?? "[]");
}

const SEEDED: string[] = [];

afterEach(() => {
  // Never leave the store or the durable table dirty. Explicit per-row deletes
  // (not a blanket clearRecords) so a SIGTERM mid-file cannot wipe a
  // neighbouring suite's fixtures.
  if (getDbDriver() === "sqlite") {
    for (const id of SEEDED) {
      try {
        rawDb().prepare(`DELETE FROM your_decision_records WHERE invitation_id = ?`).run(id);
      } catch {
        /* row may not exist */
      }
    }
  }
  SEEDED.length = 0;
});

describe("Wave 38 · Row 5 — durable soft-circled-at derivation", () => {
  it("(1) derives the timestamp from the history entry that entered soft_circled", () => {
    const rec = freshRecord(`w38r5_a_${Date.now()}`);
    // LOWER POLE first: nothing to derive before the soft-circle happens.
    expect(deriveSoftCircledAt(rec)).toBeNull();

    const before = Date.now();
    const applied = applyDecisionAction(rec, {
      action: "soft_circle",
      amount: 50_000,
      currency: "USD",
      softCircleType: "definite",
    } as any);
    expect(applied.ok).toBe(true);
    const after = Date.now();

    const derived = deriveSoftCircledAt(rec);
    expect(derived).not.toBeNull();
    // The derived value is the transition instant, bounded by the wall clock we
    // sampled around the call. This cannot be satisfied by a stale or invented
    // date.
    const ms = new Date(derived as string).getTime();
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(after + 1000);

    // And it is exactly the history entry, not something computed alongside it.
    const entry = rec.history.filter((h) => h.to === "soft_circled").pop();
    expect(entry).toBeDefined();
    expect(derived).toBe(entry!.ts);
  });

  it("(2) the timestamp survives to the DATABASE ROW and is derivable from it alone", () => {
    if (getDbDriver() !== "sqlite") {
      throw new Error("this suite requires the sqlite durable path; it must not silently skip");
    }
    const id = `w38r5_b_${Date.now()}`;
    SEEDED.push(id);
    const rec = freshRecord(id);
    applyDecisionAction(rec, {
      action: "soft_circle",
      amount: 25_000,
      currency: "USD",
      softCircleType: "indication",
    } as any);
    _persistRecord(rec);

    const dbHistory = historyFromDb(id);
    const dbEntry = dbHistory.filter((h) => h.to === "soft_circled").pop();
    expect(dbEntry, "durable row carries no soft_circled transition").toBeDefined();
    expect(dbEntry!.ts).toBe(deriveSoftCircledAt(rec));

    // Rebuild a record from the DURABLE history only — the derivation must work
    // with nothing but what the database holds.
    const fromDbOnly: DecisionRecord = {
      ...freshRecord(id),
      state: "soft_circled",
      history: dbHistory as DecisionRecord["history"],
    };
    expect(deriveSoftCircledAt(fromDbOnly)).toBe(dbEntry!.ts);
  });

  it("(3) refuses rather than guesses: null for every unusable input", () => {
    expect(deriveSoftCircledAt(null)).toBeNull();
    expect(deriveSoftCircledAt(undefined)).toBeNull();

    // Currently soft-circled but the history predates history tracking.
    const legacy = { ...freshRecord("w38r5_legacy"), state: "soft_circled" as const, history: [] };
    expect(deriveSoftCircledAt(legacy)).toBeNull();

    // Currently soft-circled but the stored ts is garbage.
    const corrupt: DecisionRecord = {
      ...freshRecord("w38r5_corrupt"),
      state: "soft_circled",
      history: [{ ts: "not-a-date", from: "viewed", to: "soft_circled", action: "soft_circle" }],
    };
    expect(deriveSoftCircledAt(corrupt)).toBeNull();

    // Progressed past soft_circled — the countdown no longer applies, and we do
    // not resurrect the old timestamp.
    const confirmed: DecisionRecord = {
      ...freshRecord("w38r5_confirmed"),
      state: "confirmed",
      history: [
        { ts: new Date().toISOString(), from: "viewed", to: "soft_circled", action: "soft_circle" },
        { ts: new Date().toISOString(), from: "soft_circled", to: "confirmed", action: "confirm" },
      ],
    };
    expect(deriveSoftCircledAt(confirmed)).toBeNull();
  });

  it("(4) picks the MOST RECENT entry into soft_circled, not the first", () => {
    const older = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const newer = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const rec: DecisionRecord = {
      ...freshRecord("w38r5_relapse"),
      state: "soft_circled",
      history: [
        { ts: older, from: "viewed", to: "soft_circled", action: "soft_circle" },
        { ts: new Date(Date.now() - 16 * DAY_MS).toISOString(), from: "soft_circled", to: "viewed", action: "expire" },
        { ts: newer, from: "viewed", to: "soft_circled", action: "soft_circle" },
      ],
    };
    expect(deriveSoftCircledAt(rec)).toBe(newer);
    // The lapsed-then-re-circled investor gets a live countdown, not 0.
    expect(daysRemaining(newer)).toBe(SOFT_CIRCLE_EXPIRY_DAYS - 2);
    expect(daysRemaining(older)).toBe(0);
  });
});

describe("Wave 38 · Row 5 — one shared implementation of copy and countdown", () => {
  it("(5) the runner re-exports the shared module — same function identity", () => {
    expect(runner.daysRemaining).toBe(daysRemaining);
    expect(runner.expiryBannerCopy).toBe(expiryBannerCopy);
    expect(runner.SOFT_CIRCLE_EXPIRY_DAYS).toBe(SOFT_CIRCLE_EXPIRY_DAYS);
    expect(SOFT_CIRCLE_EXPIRY_DAYS).toBe(14);
  });

  it("(6) copy is pinned verbatim at both plural poles", () => {
    // Literal strings, not a regex and not a re-computation of the template.
    expect(expiryBannerCopyForDays(1)).toBe("Your soft-circle expires in 1 day — confirm or release");
    expect(expiryBannerCopyForDays(13)).toBe("Your soft-circle expires in 13 days — confirm or release");
    expect(expiryBannerCopyForDays(0)).toBe("Your soft-circle expires in 0 days — confirm or release");
    // The pre-Wave-38 client copy must be gone entirely.
    expect(expiryBannerCopyForDays(1)).not.toContain("day(s)");
    expect(expiryBannerCopyForDays(13)).not.toContain("day(s)");
  });

  it("(7) countdown boundaries, and a refusal on an unparseable instant", () => {
    const now = new Date("2026-08-12T12:00:00.000Z");
    const at = (offsetDays: number) =>
      new Date(now.getTime() - offsetDays * DAY_MS).toISOString();
    expect(daysRemaining(at(0), now)).toBe(14);
    expect(daysRemaining(at(1), now)).toBe(13);
    expect(daysRemaining(at(13.5), now)).toBe(1);
    expect(daysRemaining(at(14), now)).toBe(0);
    expect(daysRemaining(at(99), now)).toBe(0);
    expect(daysRemaining("not-a-date", now)).toBeNull();
    expect(expiryBannerCopy("not-a-date", now)).toBeNull();
    expect(expiryBannerCopy(at(1), now)).toBe(
      "Your soft-circle expires in 13 days — confirm or release",
    );
  });
});
