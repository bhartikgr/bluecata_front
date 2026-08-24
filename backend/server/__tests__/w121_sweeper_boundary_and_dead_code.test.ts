/**
 * server/__tests__/w121_sweeper_boundary_and_dead_code.test.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 121 · FINDINGS 2, 3 and 4 — THE UNATTENDED SWEEPER CLOSED ROUNDS A DAY
 * EARLY, CARRIED TWO UNBOUNDED SCANS IT NEVER READ, AND THE PAST-CLOSE WARNING
 * WAS SHOUTED THREE TIMES.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * FINDING 2 — `sweepClosedRounds` compared `rounds.close_date`, a DATE-ONLY
 * column (`YYYY-MM-DD`), against `new Date().toISOString()`, a full UTC
 * timestamp. Lexicographically `"2026-08-22" < "2026-08-22T20:13:00Z"` is TRUE,
 * so a round whose target close date IS TODAY was treated as expired: closed,
 * every outstanding investor offer lapsed, every one of those investors notified
 * — a full day before the date the founder set. `shared/roundTargetCloseRule.ts`
 * (WAVE 83, Shadie V6 item 1a) had already ratified the boundary the other way:
 * a date is in the past only when it is STRICTLY BEFORE today, compared
 * date-only to date-only, on the string. Two rules, one product. The sweeper now
 * uses the ratified one.
 *
 * HOW THESE TESTS FAIL ON THE OLD CODE. `W121-F2-01` seeds a round whose target
 * close is TODAY and asserts it is still open after a sweep — on the old code
 * that round is closed and its offer is lapsed, so the test fails. `W121-F2-04`
 * shows the before-state arithmetic directly: it evaluates the OLD comparison and
 * the NEW comparison on the same value and asserts the old one is wrong.
 *
 * FINDING 3 — R93's revert left `roundMoneyOnRecord` imported with no call site,
 * and with it two whole-table cross-tenant reads (`soft_circles`,
 * `captable_commits`) executed on every tick of the sweeper and thrown away, kept
 * alive only by a test that asserted the import specifier. Option (b) was taken:
 * the dead work is gone. R93 itself is re-proved BEHAVIOURALLY here, not by
 * reading a comment: a round whose DERIVED funded total exceeds its target is NOT
 * closed by the sweeper.
 *
 * FINDING 4 — R92's shared sentence was pushed into `termWarnings` three times by
 * three copies of the same block, so the founder saw the identical warning three
 * times. Emitted once; the sentence itself is untouched and is still the shared
 * rule's own text (asserted against the rule, not retyped).
 *
 * WHAT IS NOT TOUCHED. R90: no test here authenticates, changes a session or
 * touches auth. R92: the past date is still ACCEPTED and still WARNED, never
 * blocked — `W121-F4-02` asserts the acceptance path explicitly. R93: the
 * sweeper still cannot close on a derived total. `computeConversionProjections`
 * is not imported. No sacred file is read for mutation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { randomBytes, createHash } from "node:crypto";

import { getDb } from "../db/connection";
import {
  rounds as roundsTable,
  investorNominations as investorNominationsTable,
  softCircles as softCirclesTable,
} from "../../shared/schema";
import { sweepClosedRounds } from "../lib/roundCloseCascade";
import {
  pastTargetCloseNotice,
  todayDateOnly,
  targetCloseDateOnly,
  isTargetCloseDatePast,
} from "../../shared/roundTargetCloseRule";
import { aggregateRoundMoneyOnRecord, fundedMeetsTarget } from "../lib/roundRaisedTotals";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Source with comments removed — so "is this dead code gone?" is answered about
 *  CODE, not about the ruling comments that legitimately name the helpers this
 *  file must never call. A grep over raw text would pass or fail on prose. */
function codeOnly(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TENANT = "tenant_co_w121_sweeper";
const CHAPTER = "chap_keiretsu_canada";

const rid = (p: string) => `${p}_${randomBytes(6).toString("hex")}`;

/** A local-calendar day offset from today, as `YYYY-MM-DD` — never a timestamp. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function seedRound(opts: {
  companyId: string;
  targetAmount?: number;
  raisedAmount?: number;
  closeDate?: string | null;
}): string {
  const id = rid("rnd_w121");
  const now = new Date().toISOString();
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(roundsTable)
      .values({
        id,
        tenantId: TENANT,
        companyId: opts.companyId,
        name: `W121 Round ${id.slice(-6)}`,
        type: "seed",
        state: "soft_circle_open",
        targetAmount: opts.targetAmount ?? 1_000_000,
        raisedAmount: opts.raisedAmount ?? 0,
        closeDate: opts.closeDate ?? null,
        createdAt: now,
        updatedAt: now,
      } as any)
      .run();
  });
  return id;
}

function seedPendingOffer(companyId: string, investorUserId: string): string {
  const id = rid("invnom_w121");
  const submittedAt = new Date().toISOString();
  const hash = createHash("sha256")
    .update("GENESIS|")
    .update(JSON.stringify({ id, companyId }))
    .digest("hex");
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(investorNominationsTable)
      .values({
        id,
        tenantId: TENANT,
        chapterId: CHAPTER,
        investorUserId,
        companyId,
        rationale: "W121 fixture — an outstanding offer the sweeper must not lapse early.",
        status: "pending",
        prevHash: null,
        hash,
        submittedAt,
        createdAt: submittedAt,
      } as any)
      .run();
  });
  return id;
}

/** A funded soft-circle book big enough to meet the round's target. */
function seedFundedBook(roundId: string, companyId: string, amountMinor: number): void {
  const db: any = getDb();
  const now = new Date().toISOString();
  db.transaction((tx: any) => {
    tx.insert(softCirclesTable)
      .values({
        id: rid("sc_w121"),
        roundId,
        tenantId: TENANT,
        companyId,
        investorName: "W121 Funded Investor",
        investorUserId: "u_inv_w121_funded",
        amount: amountMinor / 100,
        amountMinor,
        currency: "USD",
        status: "wired",
        createdAt: now,
        chapterId: CHAPTER,
      } as any)
      .run();
  });
}

const readRound = (id: string) => {
  const db: any = getDb();
  return (
    (db.select().from(roundsTable).where(eq((roundsTable as any).id, id)).all() as any[])[0] ?? null
  );
};
const readOffer = (id: string) => {
  const db: any = getDb();
  return (
    (db
      .select()
      .from(investorNominationsTable)
      .where(eq((investorNominationsTable as any).id, id))
      .all() as any[])[0] ?? null
  );
};

beforeAll(() => {
  getDb();
});

/* ═══════════════ FINDING 2 — THE BOUNDARY, PROVED IN BOTH DIRECTIONS ═══════ */

describe("W121 · FINDING 2 — the sweeper's close-date boundary is the ratified one", () => {
  it("W121-F2-01 · a round whose target close is TODAY is NOT swept, and its offer stays pending", () => {
    const companyId = rid("co");
    const roundId = seedRound({
      companyId,
      targetAmount: 1_000_000,
      raisedAmount: 0,
      closeDate: dayOffset(0), // today
    });
    const offerId = seedPendingOffer(companyId, "u_inv_w121_today");

    sweepClosedRounds();

    /* On the old code this round was closed and this offer lapsed, because
       "2026-08-22" sorts before "2026-08-22T20:13:00Z". */
    expect(readRound(roundId).state).toBe("soft_circle_open");
    expect(readOffer(offerId).status).toBe("pending");
  });

  it("W121-F2-02 · a round whose target close was YESTERDAY IS swept, and its offer lapses", () => {
    const companyId = rid("co");
    const roundId = seedRound({
      companyId,
      targetAmount: 1_000_000,
      raisedAmount: 0,
      closeDate: dayOffset(-1), // yesterday
    });
    const offerId = seedPendingOffer(companyId, "u_inv_w121_yesterday");

    const sweep = sweepClosedRounds();
    expect(sweep.scanned).toBeGreaterThanOrEqual(1);

    expect(readRound(roundId).state).toBe("closed");
    const off = readOffer(offerId);
    expect(off.status).toBe("lapsed");
    expect(off.decline_reason ?? off.declineReason).toBe("round_closed");
    expect(off.decided_by ?? off.decidedBy).toBe("system:round_sweeper");
  });

  it("W121-F2-03 · a stored TIMESTAMP earlier today is still today — not swept", () => {
    const companyId = rid("co");
    /* Legacy rows and older fixtures store a full ISO instant in this column.
       Reduced to its day by the shared rule, an instant from earlier today is
       TODAY, so it is not past. This is the exact shape that made the defect
       invisible: it looks expired and is not. */
    const earlierToday = `${dayOffset(0)}T00:30:00.000Z`;
    const roundId = seedRound({ companyId, closeDate: earlierToday, raisedAmount: 0 });
    const offerId = seedPendingOffer(companyId, "u_inv_w121_ts");

    sweepClosedRounds();

    expect(readRound(roundId).state).toBe("soft_circle_open");
    expect(readOffer(offerId).status).toBe("pending");
    /* And a timestamp on a genuinely earlier DAY is still past. */
    expect(isTargetCloseDatePast(`${dayOffset(-2)}T23:59:59.000Z`)).toBe(true);
  });

  it("W121-F2-04 · the before-state, arithmetically: the OLD comparison mis-sorts today, the NEW one does not", () => {
    const today = dayOffset(0);
    const OLD_NOW = new Date().toISOString(); // what the sweeper used to compare against
    const NEW_NOW = todayDateOnly(); // what it compares against now

    expect(today < OLD_NOW).toBe(true); // ← the defect, reproduced
    expect(today < NEW_NOW).toBe(false); // ← the fix
    expect(dayOffset(-1) < NEW_NOW).toBe(true); // ← and yesterday is still past

    /* Like with like: both sides are `YYYY-MM-DD`, ten characters, no `T`. */
    expect(NEW_NOW).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(NEW_NOW).not.toContain("T");
    expect(targetCloseDateOnly(OLD_NOW)).toBe(OLD_NOW.slice(0, 10));
  });

  it("W121-F2-05 · the sweeper and the founder-facing warning share ONE definition of today", () => {
    const code = read("server/lib/roundCloseCascade.ts");
    /* The boundary is imported from the ratified rule, not re-invented. */
    expect(code).toContain('from "@shared/roundTargetCloseRule"');
    expect(code).toContain("const now = todayDateOnly();");
    expect(code).toContain("targetCloseDateOnly(r.close_date ?? r.closeDate ?? null)");
    /* And no `toISOString()` feeds that comparison any more. */
    expect(code).not.toContain("const now = new Date().toISOString();\n  let scanned");
    /* The rule agrees with the sweeper, by construction: today warns nothing. */
    expect(pastTargetCloseNotice(dayOffset(0))).toBeNull();
    expect(pastTargetCloseNotice(dayOffset(-1))).not.toBeNull();
  });
});

/* ═════════════ FINDING 3 — R93 STILL HOLDS, AND THE DEAD WORK IS GONE ═════ */

describe("W121 · FINDING 3 — R93 holds behaviourally, on a round whose DERIVED total meets target", () => {
  it("W121-F3-01 · a fully FUNDED round with no expired close date is NOT closed by the sweeper", () => {
    const companyId = rid("co");
    const target = 500_000;
    const roundId = seedRound({
      companyId,
      targetAmount: target,
      raisedAmount: 0, // the stored column, which nothing writes
      closeDate: dayOffset(30), // nowhere near expiry
    });
    /* $600,000 of wire-funded money on the round's own book — the derived total
       exceeds the target outright. */
    seedFundedBook(roundId, companyId, 60_000_000);
    const offerId = seedPendingOffer(companyId, "u_inv_w121_r93");

    /* First, prove the fixture really does meet the target when derived, so the
       test cannot pass because the book was empty. */
    const db: any = getDb();
    const rows = db
      .select()
      .from(softCirclesTable)
      .where(eq((softCirclesTable as any).roundId, roundId))
      .all() as any[];
    const money = aggregateRoundMoneyOnRecord({ roundId, rows: rows as any });
    expect(fundedMeetsTarget(money, target)).toBe(true);

    sweepClosedRounds();

    /* R93 — an unattended job may not close a round because it hit its funding
       target. The round is open and the other investor's offer is untouched. */
    expect(readRound(roundId).state).toBe("soft_circle_open");
    expect(readOffer(offerId).status).toBe("pending");
  });

  it("W121-F3-02 · the sweeper's close decision reads only the round row — one basis, stated in source", () => {
    const code = codeOnly("server/lib/roundCloseCascade.ts");
    expect(code).toContain("const targetMet = storedTargetMet;");
    /* No derived total is imported, computed or OR-ed in. */
    expect(code).not.toContain("fundedMeetsTarget");
    expect(code).not.toContain("derivedTargetMet");
    expect(code).not.toContain("aggregateRoundMoneyOnRecord");
  });

  it("W121-F3-03 · the dead import and BOTH discarded cross-tenant scans are gone", () => {
    const code = codeOnly("server/lib/roundCloseCascade.ts");
    expect(code).not.toContain("roundMoneyOnRecord");
    expect(code).not.toContain("./roundRaisedTotals");
    expect(code).not.toContain("allCircles");
    expect(code).not.toContain("allLedger");
    expect(code).not.toContain("RoundMoneyRowInput");
    expect(code).not.toContain("RoundMoneyLedgerInput");
    /* Neither money table is imported here at all any more, so no whole-table
       read of either can be reintroduced without also reintroducing an import. */
    expect(code).not.toContain("softCirclesTable");
    expect(code).not.toContain("captableCommitsTable");
    expect(code).not.toContain("softCircles as");
    expect(code).not.toContain("captableCommits as");
  });

  it("W121-F3-04 · the sweeper now performs exactly ONE table read per tick", () => {
    const code = read("server/lib/roundCloseCascade.ts");
    const sweeper = code.slice(code.indexOf("export function sweepClosedRounds"));
    const body = sweeper.slice(0, sweeper.indexOf("\n}\n"));
    /* One `.from(...)`: the candidate rounds scan the sweeper exists to do. */
    expect(body.match(/\.from\(/g)?.length ?? 0).toBe(1);
    expect(body).toContain(".from(roundsTable)");
  });

  it("W121-F3-05 · the observation itself is NOT deleted from the product — only this dead copy", () => {
    /* Option (b) removed a copy nobody read, not the reconciliation. Its real
       home is untouched and still exported, and still derives the same answer. */
    const totals = read("server/lib/roundRaisedTotals.ts");
    expect(totals).toContain("export function roundMoneyOnRecord");
    expect(totals).toContain("export function fundedMeetsTarget");
  });
});

/* ══════════════════ FINDING 4 — THE SENTENCE, ONCE, UNCHANGED ═════════════ */

describe("W121 · FINDING 4 — R92's shared sentence is emitted once and is not reworded", () => {
  /** The terms handler, sliced out of routes.ts by its own registration. */
  function termsHandler(): string {
    const code = read("server/routes.ts");
    const start = code.indexOf('app.patch("/api/rounds/:id/terms"');
    expect(start).toBeGreaterThan(-1);
    const next = code.indexOf("\n  app.", start + 10);
    return code.slice(start, next > -1 ? next : code.length);
  }

  it("W121-F4-01 · the past-close notice is pushed into termWarnings exactly once", () => {
    const handler = termsHandler();
    const calls = handler.match(/pastTargetCloseNotice\(/g)?.length ?? 0;
    expect(calls).toBe(1);
    expect(handler.match(/termWarnings\.push\(pastClose\)/g)?.length ?? 0).toBe(1);
    /* Across the whole file: one import plus exactly TWO call sites — writer 3
       of 4 (round creation, ~line 7247) and writer 4 of 4 (this terms handler).
       Two DIFFERENT handlers each emitting once is the design; one handler
       emitting three times was the defect. No handler emits it twice. */
    const whole = read("server/routes.ts");
    expect(whole.match(/pastTargetCloseNotice\(/g)?.length ?? 0).toBe(2);
    expect(whole.match(/pastTargetCloseNotice/g)?.length ?? 0).toBe(3); // + the import
    for (const segment of whole.split(/\n  app\./)) {
      expect(segment.match(/pastTargetCloseNotice\(/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it("W121-F4-02 · R92 is untouched: the date is still ACCEPTED and still WARNED, never blocked", () => {
    const handler = termsHandler();
    /* The notice goes to the non-blocking warnings channel; it never returns a
       4xx and never bails out of the handler. */
    expect(handler).toContain("if (pastClose) termWarnings.push(pastClose);");
    const block = handler.slice(handler.indexOf("const pastClose"));
    const nextLines = block.slice(0, block.indexOf("\n", block.indexOf("termWarnings.push")));
    expect(nextLines).not.toMatch(/res\.status\(4\d\d\)/);
    expect(nextLines).not.toMatch(/\breturn\b/);
    /* And the sentence is the rule's own text, taken from the rule at runtime —
       not a copy that could drift. */
    const sentence = pastTargetCloseNotice(dayOffset(-3));
    expect(sentence).toContain("is in the past. Capavate accepts it");
    expect(sentence).toContain("it is not saved quietly: check the date is the one you meant.");
    expect(read("server/routes.ts")).toContain('from "../shared/roundTargetCloseRule"');
  });

  it("W121-F4-03 · one save yields one warning, not three (the duplicate reproduced on a list)", () => {
    /* The handler's own shape, exercised: the block below is what routes.ts now
       runs once. Three copies produced three identical entries, and
       client/src/pages/founder/Rounds.tsx renders every entry. */
    const emitOnce = (closeDate: string | null) => {
      const termWarnings: string[] = [];
      const pastClose = pastTargetCloseNotice(closeDate);
      if (pastClose) termWarnings.push(pastClose);
      return termWarnings;
    };
    expect(emitOnce(dayOffset(-1)).length).toBe(1);
    expect(new Set(emitOnce(dayOffset(-1))).size).toBe(1);
    expect(emitOnce(dayOffset(0))).toEqual([]);
    expect(emitOnce(null)).toEqual([]);
  });
});
