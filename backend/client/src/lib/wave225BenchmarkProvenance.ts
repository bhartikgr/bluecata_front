/**
 * WAVE 225 · ITEM B — OBSERVED-ROUND BENCHMARKS, AND NOTHING ELSE.
 *
 * R193.2. `packages/telemetry/src/benchmarks.ts:350` executes
 *
 *     seedSyntheticBenchmarks(defaultBenchmarkStore);
 *
 * unconditionally, at module load. No `NODE_ENV` check, no `import.meta.env`
 * check, no flag — so it runs in the production client bundle. It puts **130
 * invented rounds across 21 cohorts** into the singleton store (the "50" in that
 * file's header comment is stale; its own test asserts 130).
 *
 * WHAT REACHED A USER. Three sinks on `client/src/pages/admin/Telemetry.tsx`:
 *   1. the "Cohort benchmarks" card — "{count} closed rounds" plus p25/p50/p75/p90
 *      for round duration, PRE-MONEY VALUATION, soft-circle conversion rate,
 *      LEAD INVESTOR CHEQUE, TOTAL ROUND SIZE and time-to-close;
 *   2. the "Cohorts" stat in the page intro — `listCohorts().length`, i.e. 21;
 *   3. `BurnVsRaiseWidget` — a Pearson correlation coefficient between
 *      time-to-close and total round size, plus per-cohort `Xd / $Y.YM` rows.
 * Audience: platform admins (`RequireAuth role="admin"`), not investors. Narrower
 * than the comparables defect, and still figures the platform never measured.
 *
 * THE PART THAT MAKES IT UNAMBIGUOUS. `addToCohort` has **zero non-seed,
 * non-test callers anywhere in the tree** — verified by full-tree grep. So the
 * seed's header claim that "every `round.closed` triggers `addToCohort`" is
 * false, and the invented rounds are not "mixed into" real statistics: they are
 * 100% of the data. Every percentile on that page was computed from numbers an
 * author chose, shaped (per the seed's own comment) "to mirror the 2025 Carta
 * State of Private Markets seed/Series A medians" — i.e. shaped to be plausible,
 * which is exactly what stops anyone looking twice.
 *
 * IS THIS A LEGITIMATE DEVELOPMENT FIXTURE? Its INTENT was ("For preview…so the
 * admin dashboard has signal immediately"). Its REACH is not: it is ungated, and
 * this codebase already enforces the opposite convention elsewhere —
 * `client/src/lib/sprint3Seed.ts:17` early-returns on
 * `import.meta.env.MODE === "production" || VITE_ENABLE_DEMO_SEED !== "1"`, and
 * the server side uses `DEMO_SEED_ENABLED ? {…} : {}` at the constant
 * (`authRoutes.ts:91`, `membershipStore.ts:75`). This seed skipped a convention
 * that already existed. A seed that makes a dev environment usable is
 * legitimate; a seed that silently supplies production statistics is not.
 *
 * WHY THIS MODULE EXISTS INSTEAD OF A GATE ON LINE 350. Gating the seed was the
 * obvious fix and it is the wrong one, for three reasons:
 *
 *   1. `packages/telemetry` is consumed by the Vite client bundle AND aliased
 *      into the Node/vitest runtime (`vitest.config.ts`, `tsconfig.json`), where
 *      `import.meta.env` semantics differ. A gate there behaves differently in
 *      three environments.
 *   2. It turns the seed's own tests red (`packages/telemetry/test/benchmarks.test.ts`
 *      asserts the default store IS pre-seeded), forcing edits to pins that are
 *      not the defect.
 *   3. **It would not close the hole.** `BenchmarkStore` has no observed-round
 *      intake at all. Gate the seed and the store is merely empty — the moment
 *      anyone wires a `round.closed` handler to `addToCohort` on a dev box, real
 *      and seeded rounds land in the same store and are silently averaged.
 *
 * So this module intercepts at the CONSUMER and owns a **separate, clean
 * `BenchmarkStore` instance** that only observed closed rounds can ever enter.
 * Consequences worth stating:
 *
 *   - contamination becomes impossible BY CONSTRUCTION, not by convention:
 *     seeded rows and observed rows live in different objects, so no percentile
 *     can mix them even by mistake;
 *   - the seed is not deleted, not gated and not touched. It keeps serving
 *     preview/dev use of the seeded store exactly as before ("I'd rather add
 *     than delete"), and `packages/telemetry` and its tests stay untouched;
 *   - the real `BenchmarkStore` class is REUSED, so no percentile maths is
 *     reimplemented here (handbook §8 / R176.2 — never prove or build a replica);
 *   - TODAY every cohort refuses, because nothing records an observed round yet.
 *     That is the honest state, and `admin/Telemetry.tsx` already has the correct
 *     branch for it ("No data yet for this cohort. Closed rounds add
 *     organically") — the seed was what prevented it from ever being reached.
 *
 * WIRING THIS UP LATER IS THE WHOLE POINT. This is a mechanism, not a deletion.
 * When a `round.closed` handler exists, it calls `recordObservedClosedRound()`
 * below and the page starts showing real benchmarks with no further change here.
 * Until then it refuses. Do not "prime" the store to make the page look better.
 */
import { BenchmarkStore, type CohortKey, type CohortMetric, type CohortPercentiles } from "@capavate/telemetry";

/**
 * The observed-round store. Constructed empty and NEVER seeded.
 *
 * `seedSyntheticBenchmarks` is not imported by this module, so there is no code
 * path — not even a mistaken one — by which an invented round can enter here.
 */
const observedStore = new BenchmarkStore();

/** Per-cohort count of rounds this platform actually observed closing. */
const observedByCohort = new Map<string, number>();

function key(c: CohortKey): string {
  return `${c.sector}|${c.stage}|${c.region}`;
}

export const BENCHMARK_STATUS_OBSERVED = "observed" as const;
export const BENCHMARK_STATUS_NONE_OBSERVED = "no_observed_closed_rounds" as const;

export type BenchmarkProvenanceStatus =
  | typeof BENCHMARK_STATUS_OBSERVED
  | typeof BENCHMARK_STATUS_NONE_OBSERVED;

/**
 * A benchmark result that carries its own provenance, so a caller cannot render
 * the numbers without also having been told where they came from.
 *
 * `percentiles` is `null` whenever `status` is `no_observed_closed_rounds`. It is
 * never a zero-filled object: a p50 of 0 is a measurement claim, and R143.4
 * forbids showing a zero for a figure the platform does not hold.
 */
export interface BenchmarkProvenanceResult {
  status: BenchmarkProvenanceStatus;
  observedRounds: number;
  percentiles: CohortPercentiles | null;
  statement: string;
}

/**
 * THE ONLY INTAKE. Call this from a real `round.closed` handler, with metrics
 * measured from that round — never from a fixture, a sample or a default.
 */
export function recordObservedClosedRound(
  roundId: string,
  cohort: CohortKey,
  metrics: CohortMetric,
): void {
  observedStore.addToCohort(roundId, cohort, metrics);
  const k = key(cohort);
  observedByCohort.set(k, (observedByCohort.get(k) ?? 0) + 1);
}

/** Rounds observed for one cohort. Zero until a real `round.closed` is wired. */
export function observedRoundCount(cohort: CohortKey): number {
  return observedByCohort.get(key(cohort)) ?? 0;
}

/** Total rounds observed across every cohort. */
export function totalObservedRounds(): number {
  let n = 0;
  // `Array.from` rather than iterating `.values()` directly: this tsconfig has
  // no `--downlevelIteration` and an ES5-era target, so a bare Map-iterator
  // for-of is a compile error here.
  for (const c of Array.from(observedByCohort.values())) n += c;
  return n;
}

/**
 * Cohorts built from observed rounds only.
 *
 * Deliberately NOT `defaultBenchmarkStore.listCohorts()`, which returns the 21
 * seeded cohorts and was rendered to admins as the "Cohorts" stat.
 */
export function observedCohorts(): Array<{ cohort: CohortKey; count: number }> {
  return observedStore.listCohorts();
}

/**
 * Benchmarks for one cohort, or a refusal.
 *
 * Refuses rather than computes whenever the cohort has no observed closed
 * rounds. A benchmark computed from invented data is the same defect as a random
 * total, one step removed — so the answer is "we have not measured this", never
 * a plausible number.
 */
export function verifiedCohortBenchmarks(cohort: CohortKey): BenchmarkProvenanceResult {
  const observed = observedRoundCount(cohort);
  if (observed === 0) {
    return {
      status: BENCHMARK_STATUS_NONE_OBSERVED,
      observedRounds: 0,
      percentiles: null,
      statement:
        "Capavate has not observed a closed round in this cohort, so no benchmark is shown. " +
        "These figures are computed only from rounds this platform recorded closing.",
    };
  }
  return {
    status: BENCHMARK_STATUS_OBSERVED,
    observedRounds: observed,
    percentiles: observedStore.getCohortBenchmarks(cohort),
    statement:
      `Computed from ${observed} closed round${observed === 1 ? "" : "s"} this platform observed. ` +
      "No seeded, sample or illustrative round is included.",
  };
}

/**
 * TEST SEAM. Lets a proof drive the observed pole without a real round, and
 * reset afterwards. Exported deliberately and named so that its purpose is
 * unmistakable: it exists to prove the gate is a gate rather than a blanket
 * blank, and it must never be called from a render path.
 */
export function __resetObservedBenchmarksForTest(): void {
  for (const k of Array.from(observedByCohort.keys())) observedByCohort.delete(k);
  // The store itself is append-only by design; a test that needs a clean store
  // asserts on cohorts it alone writes, keyed by a test-unique sector name.
}
