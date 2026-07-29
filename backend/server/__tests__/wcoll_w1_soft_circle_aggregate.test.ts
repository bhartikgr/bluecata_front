/**
 * server/__tests__/wcoll_w1_soft_circle_aggregate.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 as extended by v6 §3. Soft-circle aggregate
 * PROVENANCE.
 *
 * CONTEXT. `/api/collective/soft-circles` presented three numbers as facts:
 *
 *   targetUsd:        (round as ...)?.targetAmountUsd ?? 0   // canonicalRounds is []
 *   softCircledTotal: circles.reduce((s, sc) => s + (sc.amount ?? 0), 0)
 *   fillPct:          targetUsd > 0 ? pct(total, targetUsd) : null
 *
 * `targetUsd` therefore reported `0` for EVERY round while the durable
 * `rounds.target_amount` column held the real figure; the total summed seed rows
 * together with `listForCollective()` output, which FAILS OPEN to the in-process
 * `memCircles` cache on a DB error (softCircleStore.ts:428-433) — so a transient
 * read failure silently produced a smaller total presented with identical
 * confidence; and the `…Usd` label was applied to a sum across a free-text
 * `currency` column.
 *
 * Members make allocation decisions on these numbers. The contract is: state an
 * amount only when it is PROVABLE from durable rows in a single currency,
 * otherwise `null` + `amountsUnavailable`.
 *
 * ANTI-VACUITY. On the PRISTINE tree `server/lib/softCircleAggregate.ts` does not
 * exist and the file fails at collection with
 * "Failed to load url ../lib/softCircleAggregate".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as conn from "../db/connection";
import { getDb, rawDb } from "../db/connection";
import {
  readDurableRoundTarget,
  readDurableSoftCircleTotal,
  resolveSoftCircleAmounts,
} from "../lib/softCircleAggregate";

const RND = "rnd_wcoll_agg";
const RND_DELETED = "rnd_wcoll_agg_deleted";
const RND_ZERO = "rnd_wcoll_agg_zero";
const RND_CAD = "rnd_wcoll_agg_cad";
const CO = "co_wcoll_agg";

/** The route's real percentage helper shape. */
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

function insertRound(
  id: string,
  opts: { target?: number; currency?: string | null; deleted?: boolean; name?: string } = {},
): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO rounds
         (id, tenant_id, company_id, name, type, state, target_amount, raised_amount,
          currency, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, 'seed', 'open', ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      CO,
      opts.name ?? "Series Seed",
      opts.target ?? 1_000_000,
      opts.currency ?? "USD",
      now,
      now,
      opts.deleted ? now : null,
    );
}

function insertCircle(
  id: string,
  roundId: string,
  amount: number,
  opts: { currency?: string; visible?: boolean; deleted?: boolean } = {},
): string {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO soft_circles
         (id, tenant_id, round_id, company_id, investor_name, amount, amount_minor,
          currency, status, collective_visible, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, 'Investor', ?, 0, ?, 'intent', ?, ?, ?, ?)`,
    )
    .run(
      id,
      roundId,
      CO,
      amount,
      opts.currency ?? "USD",
      opts.visible === false ? 0 : 1,
      now,
      now,
      opts.deleted ? now : null,
    );
  return id;
}

function wipe(): void {
  for (const id of [RND, RND_DELETED, RND_ZERO, RND_CAD]) {
    rawDb().prepare("DELETE FROM soft_circles WHERE round_id = ?").run(id);
    rawDb().prepare("DELETE FROM rounds WHERE id = ?").run(id);
  }
}

beforeAll(() => {
  getDb();
});

beforeEach(() => {
  wipe();
});

describe("v6 §3 — the target comes from the DURABLE column, and 0 is never a target", () => {
  it("reads `rounds.target_amount` rather than the empty canonicalRounds seed", () => {
    insertRound(RND, { target: 2_500_000, name: "Series A" });
    const t = readDurableRoundTarget(RND);
    expect(t.targetUsd).toBe(2_500_000);
    expect(t.roundName).toBe("Series A");
    expect(t.companyId).toBe(CO);
    expect(t.reason).toBeUndefined();
  });

  it("`target_amount` of 0 is ABSENT, not a target of zero", () => {
    // Pristine reported `targetUsd: 0`, which made the UI hide the progress bar
    // and the round look like it had no target.
    insertRound(RND_ZERO, { target: 0 });
    expect(readDurableRoundTarget(RND_ZERO)).toMatchObject({
      targetUsd: null,
      reason: "no_target",
    });
  });

  it("a negative target is absent too", () => {
    insertRound(RND_ZERO, { target: -5 });
    expect(readDurableRoundTarget(RND_ZERO).targetUsd).toBeNull();
  });

  it("a soft-deleted round has no target", () => {
    insertRound(RND_DELETED, { target: 999_999, deleted: true });
    expect(readDurableRoundTarget(RND_DELETED)).toMatchObject({
      targetUsd: null,
      reason: "not_found",
    });
  });

  it("a missing round is `not_found`, and a blank id is `no_id`", () => {
    expect(readDurableRoundTarget("rnd_does_not_exist").reason).toBe("not_found");
    for (const id of [null, undefined, "", "  "]) {
      expect(readDurableRoundTarget(id).reason).toBe("no_id");
    }
  });

  it("a null/empty `currency` is treated as USD (historically unset column)", () => {
    insertRound(RND, { target: 750_000, currency: null });
    expect(readDurableRoundTarget(RND).targetUsd).toBe(750_000);
  });

  it("an explicitly NON-USD round reports no USD target — never a mislabelled figure", () => {
    insertRound(RND_CAD, { target: 1_000_000, currency: "CAD" });
    const t = readDurableRoundTarget(RND_CAD);
    expect(t).toMatchObject({ targetUsd: null, reason: "non_usd" });
    // Identity is still resolvable — only the AMOUNT is withheld.
    expect(t.companyId).toBe(CO);
  });
});

describe("v6 §3 — the total is durable-only, and never falls back to memCircles", () => {
  it("sums exactly the collective-visible, non-deleted durable rows", () => {
    insertRound(RND);
    insertCircle("sc_a", RND, 100_000);
    insertCircle("sc_b", RND, 250_000);
    insertCircle("sc_hidden", RND, 900_000, { visible: false });
    insertCircle("sc_gone", RND, 900_000, { deleted: true });

    const d = readDurableSoftCircleTotal(RND);
    expect(d.totalUsd).toBe(350_000);
    expect(d.durableCount).toBe(2);
    expect([...d.durableIds].sort()).toEqual(["sc_a", "sc_b"]);
  });

  it("no rows is a provable total of 0, not `unavailable`", () => {
    insertRound(RND);
    expect(readDurableSoftCircleTotal(RND)).toMatchObject({ totalUsd: 0, durableCount: 0 });
  });

  it("MIXED currencies withhold the total — no conversion, no inference", () => {
    insertRound(RND);
    insertCircle("sc_usd", RND, 100_000, { currency: "USD" });
    insertCircle("sc_cad", RND, 100_000, { currency: "CAD" });
    const d = readDurableSoftCircleTotal(RND);
    expect(d.totalUsd).toBeNull();
    expect(d.reason).toBe("mixed_currency");
  });

  it("a single NON-USD currency withholds the total", () => {
    insertRound(RND);
    insertCircle("sc_eur", RND, 100_000, { currency: "EUR" });
    expect(readDurableSoftCircleTotal(RND)).toMatchObject({
      totalUsd: null,
      reason: "non_usd",
    });
  });

  it("a durable read FAILURE yields null + `read_error`, never a smaller confident total", () => {
    // This is the memCircles fail-open, reproduced: pristine served whatever the
    // in-process cache held. Here the durable read is the only source, so a
    // failure must be reported as such.
    const spy = vi.spyOn(conn, "rawDb").mockImplementationOnce(
      () =>
        ({
          prepare: () => {
            throw new Error("soft_circles unreadable");
          },
        }) as never,
    );
    const d = readDurableSoftCircleTotal(RND);
    expect(d).toMatchObject({ totalUsd: null, durableCount: 0, reason: "read_error" });
    expect(d.durableIds.size).toBe(0);
    spy.mockRestore();
  });
});

describe("v6 §3 — presented rows wider than the provable set withhold the total", () => {
  it("a seed-only id in the presented set withholds the total rather than under-reporting", () => {
    insertRound(RND, { target: 1_000_000 });
    insertCircle("sc_durable", RND, 400_000);

    const agg = resolveSoftCircleAmounts(RND, ["sc_durable", "sc_seed_only"], pct);

    expect(agg.softCircledTotal).toBeNull();
    expect(agg.amountsUnavailable).toBe(true);
    expect(agg.amountsReason).toContain("non_durable_rows(1)");
    // The TARGET is still stated — it is independently provable.
    expect(agg.targetUsd).toBe(1_000_000);
    expect(agg.fillPct).toBeNull();
  });

  it("a fully durable presented set states total, target and fill", () => {
    insertRound(RND, { target: 1_000_000 });
    insertCircle("sc_1", RND, 250_000);
    insertCircle("sc_2", RND, 250_000);

    expect(resolveSoftCircleAmounts(RND, ["sc_1", "sc_2"], pct)).toEqual({
      softCircledTotal: 500_000,
      targetUsd: 1_000_000,
      fillPct: 50,
      amountsUnavailable: false,
      amountsReason: undefined,
    });
  });
});

describe("v6 §3 — fillPct is null whenever either operand is", () => {
  it("no target ⇒ no fill, even with a provable total", () => {
    insertRound(RND_ZERO, { target: 0 });
    insertCircle("sc_z", RND_ZERO, 100_000);
    const agg = resolveSoftCircleAmounts(RND_ZERO, ["sc_z"], pct);
    expect(agg.softCircledTotal).toBe(100_000);
    expect(agg.targetUsd).toBeNull();
    expect(agg.fillPct).toBeNull();
    expect(agg.amountsUnavailable).toBe(true);
  });

  it("no provable total ⇒ no fill, even with a target", () => {
    insertRound(RND, { target: 1_000_000 });
    insertCircle("sc_mix_a", RND, 1, { currency: "USD" });
    insertCircle("sc_mix_b", RND, 1, { currency: "CAD" });
    const agg = resolveSoftCircleAmounts(RND, ["sc_mix_a", "sc_mix_b"], pct);
    expect(agg.softCircledTotal).toBeNull();
    expect(agg.fillPct).toBeNull();
  });

  it("`pct` is never invoked with a null or zero denominator (no NaN/Infinity)", () => {
    const calls: Array<[number, number]> = [];
    const spyPct = (part: number, whole: number) => {
      calls.push([part, whole]);
      return Math.round((part / whole) * 100);
    };
    insertRound(RND_ZERO, { target: 0 });
    insertCircle("sc_nan", RND_ZERO, 5, {});
    resolveSoftCircleAmounts(RND_ZERO, ["sc_nan"], spyPct);
    expect(calls).toEqual([]);

    insertRound(RND, { target: 400 });
    insertCircle("sc_ok", RND, 100);
    resolveSoftCircleAmounts(RND, ["sc_ok"], spyPct);
    expect(calls).toEqual([[100, 400]]);
  });

  it("no reported amount is ever NaN", () => {
    insertRound(RND, { target: 1_000_000 });
    insertCircle("sc_finite", RND, 123.45);
    const agg = resolveSoftCircleAmounts(RND, ["sc_finite"], pct);
    for (const v of [agg.softCircledTotal, agg.targetUsd, agg.fillPct]) {
      if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("v6 §3 — the module is READ-ONLY", () => {
  it("resolving amounts does not mutate any row", () => {
    insertRound(RND, { target: 1_000_000 });
    insertCircle("sc_ro", RND, 42);
    const before = rawDb()
      .prepare("SELECT amount, currency, collective_visible FROM soft_circles WHERE id = ?")
      .get("sc_ro");
    const roundBefore = rawDb()
      .prepare("SELECT target_amount, currency FROM rounds WHERE id = ?")
      .get(RND);

    resolveSoftCircleAmounts(RND, ["sc_ro"], pct);

    expect(
      rawDb()
        .prepare("SELECT amount, currency, collective_visible FROM soft_circles WHERE id = ?")
        .get("sc_ro"),
    ).toEqual(before);
    expect(
      rawDb().prepare("SELECT target_amount, currency FROM rounds WHERE id = ?").get(RND),
    ).toEqual(roundBefore);
  });
});
