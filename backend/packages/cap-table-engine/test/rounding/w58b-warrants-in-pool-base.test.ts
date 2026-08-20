/**
 * WAVE 58b · DEFECT 5 — WARRANTS ARE IN THE POOL-TARGET BASE. BOTH POLES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG
 * ═══════════════════════════════════════════════════════════════════════════
 * `compute.ts::applyTopUp` split the ledger into two buckets and a `warrant` row
 * was in NEITHER:
 *     existingShares = ledger.filter(kind === "common" || kind === "preferred")
 *     existingPool   = ledger.filter(kind === "option")
 * A warrant's underlying shares are inside every fully-diluted definition
 * Capavate uses — `currentFullyDilutedShares` in the same file counts them — so
 * the pool target was solved against a base that omitted a real dilutive
 * instrument. That is the SAME DEFECT CLASS Wave 58 fixed for the existing pool,
 * and it biases the other way: a base that is too small produces TOO FEW pool
 * shares, so the founder's negotiated percentage is silently MISSED.
 *
 * AUTHORITY. WSGR, "How do you calculate Series A price per share" — the
 * fully-diluted pre-money capitalisation includes shares issuable on exercise of
 * outstanding warrants. Recorded in
 * `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §12 Step 2, whose `D`
 * composition carries a warrants term `W`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS AN ENGINE TEST AND NOT A ROUTE TEST — SAID PLAINLY
 * ═══════════════════════════════════════════════════════════════════════════
 * A `warrant` security only reaches `GET /api/companies/:id/securities` through a
 * COMMITTED cap-table entry on a round whose instrument is `warrant`
 * (`server/routes.ts::buildCompanySecurities`, the `/warrant/.test(inst)` branch),
 * i.e. through the SACRED commit ledger. This wave does not commit anything, so
 * there is no route through which I can put a warrant on a ledger and then read
 * the pool back out. **The route-level reachability of a warrant in the pool base
 * is therefore UNVERIFIED**, is recorded as such in
 * `build_log/wave58b/WAVE58B_REPORT.md`, and what would settle it is a test that
 * drives `POST /api/founder/captable/commit-funded` for a warrant round and then
 * reads `round-math`. `w58b_pool_placement_reachability.test.ts::W58B-6a` states
 * which of the two worlds it is in at run time rather than passing vacuously.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MUTATION TRANSCRIPT
 * ═══════════════════════════════════════════════════════════════════════════
 * In `src/captable/compute.ts::applyTopUp`, delete the `existingWarrantShares`
 * reduce and set `const existingShares = existingIssuedShares;`
 *   → W58B-W1, W58B-W2 and W58B-W4 FAIL. Recorded verbatim in
 *     `build_log/wave58b/W58B_NEW_TESTS.md`.
 */
import { describe, it, expect } from "vitest";
import { computeCapTable } from "../../src/captable/compute.js";
import type { Holder, Transaction } from "../../src/types.js";

/* ───────────────────────────────────────────────────────────────────────────
 * THE FIXTURE, AND ITS INDEPENDENTLY COMPUTED EXPECTATIONS.
 *
 *   founders                      8,000,000 common
 *   one warrant, underlying       1,000,000
 *   unallocated pool                      0
 *   round: pre-money $30,000,000 · raise $10,000,000 · pool target 15% pre-money
 *
 * WITH warrants in the base (correct). The engine solves the price as a fixed
 * point of p = PMV / (B + S) with B = 9,000,000:
 *   S = ceil( (15·9,000,000·40,000,000) / (100·30,000,000 − 15·40,000,000) )
 *     = ceil( 5.4e15 / 2.4e9 ) =                                     2,250,000
 *   D = 9,000,000 + 2,250,000 =                                     11,250,000
 *   p = 30,000,000 / 11,250,000 =                                    $2.666666…
 *   N = floor(10,000,000 / 2.666666…) =                              3,750,000
 *   T = 9,000,000 + 2,250,000 + 3,750,000 =                         15,000,000
 *   pool % of T = 2,250,000 / 15,000,000 =                              15.000%
 *
 * WITHOUT warrants in the base (the defect). B = 8,000,000:
 *   S = ceil( 4.8e15 / 2.4e9 ) =                                      2,000,000
 * and the pool lands at 2,000,000 / (8,000,000 + 1,000,000 + 2,000,000 + N),
 * i.e. BELOW the 15% the founder negotiated — the target is missed, downward.
 * The two poles differ by 250,000 shares.
 * ─────────────────────────────────────────────────────────────────────────── */
const HOLDERS: Holder[] = [
  { id: "h-founder", name: "Founder", type: "founder" },
  { id: "h-warrant", name: "Warrant holder", type: "investor" },
  { id: "investors-Series A", name: "Series A investors", type: "investor" },
];

function txns(opts: { withWarrant: boolean; poolPercent?: string; mode?: "pre_money" | "post_money" }): Transaction[] {
  const out: Transaction[] = [
    {
      type: "issue",
      date: "2024-01-01",
      security: {
        id: "f1",
        holderId: "h-founder",
        kind: "common",
        series: "Common",
        shares: BigInt(8_000_000),
      },
    } as unknown as Transaction,
  ];
  if (opts.withWarrant) {
    out.push({
      type: "issue",
      date: "2024-06-01",
      security: {
        id: "w1",
        holderId: "h-warrant",
        kind: "warrant",
        series: "Warrant",
        warrant: {
          underlyingShares: BigInt(1_000_000),
          strikePrice: "1.00",
          expiryYears: 10,
        },
      },
    } as unknown as Transaction);
  }
  out.push({
    type: "issue_preferred_round",
    date: "2026-01-01",
    round: {
      id: "Series A",
      series: "Series A",
      preMoneyValuation: "30000000",
      investmentAmount: "10000000",
      liquidationPreferenceMultiple: 1,
      participating: false,
      antiDilution: "broad_based",
      ...(opts.poolPercent
        ? { optionPoolPostPercent: opts.poolPercent, optionPoolMode: opts.mode ?? "pre_money" }
        : {}),
    },
  } as unknown as Transaction);
  return out;
}

function run(opts: Parameters<typeof txns>[0]) {
  return computeCapTable({
    companyId: "co-w58b",
    asOf: "2026-12-31",
    view: "fully_diluted",
    formulaRegion: "US",
    holders: HOLDERS,
    transactions: txns(opts),
  });
}

const poolShares = (r: ReturnType<typeof computeCapTable>): bigint =>
  r.rows
    .filter((x) => x.holderName === "pool" || x.holderId === "pool")
    .reduce<bigint>((s, x) => s + x.shares, BigInt(0));

const warrantShares = (r: ReturnType<typeof computeCapTable>): bigint =>
  r.rows
    .filter((x) => x.kind === "warrant")
    .reduce<bigint>((s, x) => s + x.shares, BigInt(0));

describe("W58B-W — warrants belong in the base the pool target is solved against", () => {
  it("W58B-W1 — POLE A: with a warrant on the ledger the pool is 2,250,000, not 2,000,000", () => {
    /* THE HEADLINE. 2,000,000 is what the defective base produced; 2,250,000 is
       what the founder actually negotiated once the warrant is counted. */
    const r = run({ withWarrant: true, poolPercent: "15" });
    expect(poolShares(r).toString()).toBe("2250000");
    expect(r.totalShares.toString()).toBe("15000000");
  });

  it("W58B-W2 — POLE B: with NO warrant, the same target gives 2,000,000 — the difference is the warrant", () => {
    /* Both poles in one file, so the claim is a comparison and not an assertion.
       250,000 shares of difference for one 1,000,000-share warrant. */
    const withW = run({ withWarrant: true, poolPercent: "15" });
    const noW = run({ withWarrant: false, poolPercent: "15" });
    expect(poolShares(noW).toString()).toBe("2000000");
    expect(poolShares(withW) - poolShares(noW)).toBe(BigInt(250_000));
  });

  it("W58B-W3 — WARRANTS AND A POOL TOP-UP COEXIST: both rows are present and the warrant is untouched", () => {
    /* The spec asks whether they CAN coexist. They can: the warrant is still on
       the ledger at its full underlying count after the top-up runs. */
    const r = run({ withWarrant: true, poolPercent: "15" });
    expect(warrantShares(r).toString()).toBe("1000000");
    expect(poolShares(r) > BigInt(0)).toBe(true);
  });

  it("W58B-W4 — the target percentage is MET, not missed: 15% of the post-money total", () => {
    /* The reason the omission mattered. A base that is too small under-sizes the
       top-up, so the negotiated percentage comes out BELOW target. With the
       warrant counted, 2,250,000 / 15,000,000 is exactly 15%. */
    const r = run({ withWarrant: true, poolPercent: "15" });
    const pct = (poolShares(r) * BigInt(1_000_000)) / r.totalShares; // parts per million
    expect(pct.toString()).toBe("150000"); // 15.0000% exactly
  });

  it("W58B-W5 — POST-MONEY placement with a warrant also counts it, and differs from pre-money", () => {
    /* Placement and the warrant base are independent fixes; neither masks the
       other. Independently computed for post-money with B = 9,000,000:
         p = 30,000,000 / 9,000,000 = 3.333333…
         N = floor(10,000,000 / 3.333333…) = 3,000,000
         S = ceil( (15·(9,000,000 + 3,000,000)) / 85 )
           = ceil( 180,000,000 / 85 ) = ceil(2,117,647.05…) = 2,117,648
         T = 9,000,000 + 3,000,000 + 2,117,648 = 14,117,648                    */
    const pre = run({ withWarrant: true, poolPercent: "15", mode: "pre_money" });
    const post = run({ withWarrant: true, poolPercent: "15", mode: "post_money" });
    expect(poolShares(post).toString()).toBe("2117648");
    expect(post.totalShares.toString()).toBe("14117648");
    expect(poolShares(post)).not.toBe(poolShares(pre));
  });

  it("W58B-W6 — no pool percentage means no pool row, warrant or not (absent stays absent)", () => {
    const r = run({ withWarrant: true });
    expect(poolShares(r).toString()).toBe("0");
    expect(warrantShares(r).toString()).toBe("1000000");
  });
});
