/**
 * Cohort benchmarks — anonymised aggregate stats by sector × stage × region.
 *
 * Cohort definition: every closed round contributes one row per metric per
 * (sector, stage, region) cohort. As the dataset grows organically (every
 * `round.closed` triggers `addToCohort`), the percentile distribution becomes
 * tighter.
 *
 * For preview: seeded with 50 fictitious rounds across 6 cohorts so the
 * /admin/telemetry page has signal to show.
 */

export type CohortKey = { sector: string; stage: string; region: string };

export type CohortMetric = {
  durationDays: number;
  preMoneyValuation: number;     // USD
  softCircleConversionRate: number;  // 0..1
  leadInvestorChequeSize: number;     // USD
  totalRoundSize: number;             // USD
  timeToCloseDays: number;
};

export type CohortPercentiles = {
  durationDays: { p25: number; p50: number; p75: number; p90: number };
  preMoneyValuation: { p25: number; p50: number; p75: number; p90: number };
  softCircleConversionRate: { p25: number; p50: number; p75: number; p90: number };
  leadInvestorChequeSize: { p25: number; p50: number; p75: number; p90: number };
  totalRoundSize: { p25: number; p50: number; p75: number; p90: number };
  timeToCloseDays: { p25: number; p50: number; p75: number; p90: number };
  count: number;
};

function cohortKey(c: CohortKey): string {
  return `${c.sector}|${c.stage}|${c.region}`;
}

export class BenchmarkStore {
  private cohorts: Map<string, CohortMetric[]> = new Map();

  /** Add a closed round's metrics to the matching cohort. */
  addToCohort(roundId: string, profile: CohortKey, metrics: CohortMetric): void {
    const k = cohortKey(profile);
    const list = this.cohorts.get(k) ?? [];
    list.push(metrics);
    this.cohorts.set(k, list);
  }

  /** Compute p25/p50/p75/p90 for the requested cohort. */
  getCohortBenchmarks(cohort: CohortKey): CohortPercentiles | null {
    const k = cohortKey(cohort);
    const list = this.cohorts.get(k);
    if (!list || list.length === 0) return null;
    return {
      durationDays: percentiles(list.map((m) => m.durationDays)),
      preMoneyValuation: percentiles(list.map((m) => m.preMoneyValuation)),
      softCircleConversionRate: percentiles(list.map((m) => m.softCircleConversionRate)),
      leadInvestorChequeSize: percentiles(list.map((m) => m.leadInvestorChequeSize)),
      totalRoundSize: percentiles(list.map((m) => m.totalRoundSize)),
      timeToCloseDays: percentiles(list.map((m) => m.timeToCloseDays)),
      count: list.length,
    };
  }

  /** All cohorts the store has seen, with row counts — useful for the admin grid. */
  listCohorts(): Array<{ cohort: CohortKey; count: number }> {
    return Array.from(this.cohorts.entries()).map(([k, list]) => {
      const [sector, stage, region] = k.split("|");
      return { cohort: { sector, stage, region }, count: list.length };
    });
  }

  /** Total metric rows across all cohorts. */
  size(): number {
    let n = 0;
    for (const list of this.cohorts.values()) n += list.length;
    return n;
  }
}

function percentiles(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const pick = (q: number) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
    return sorted[idx];
  };
  return { p25: pick(0.25), p50: pick(0.50), p75: pick(0.75), p90: pick(0.90) };
}

export const defaultBenchmarkStore = new BenchmarkStore();

// ---- Synthetic seed data ----------------------------------------------------
//
// 50 fictitious closed rounds across multiple cohorts. Numbers picked to mirror
// the 2025 Carta State of Private Markets seed/Series A medians:
//   - Pre-money seed median 2025: ~$15M (US fintech)
//   - Median round size seed: $3M
//   - Median time-to-close: 67 days
// The synthetic distribution is wider than the median to give the admin UI
// enough signal to show meaningful percentiles.

export function seedSyntheticBenchmarks(store: BenchmarkStore): void {
  // Cohort: fintech / seed / US (15 rounds — tightest)
  for (let i = 0; i < 15; i++) {
    store.addToCohort(`seed-fintech-us-${i}`, { sector: "fintech", stage: "seed", region: "US" }, {
      durationDays: 45 + i * 3,
      preMoneyValuation: 12_000_000 + i * 800_000,
      softCircleConversionRate: 0.55 + (i % 5) * 0.05,
      leadInvestorChequeSize: 1_200_000 + (i % 4) * 200_000,
      totalRoundSize: 2_500_000 + i * 100_000,
      timeToCloseDays: 50 + i * 2,
    });
  }
  // Cohort: fintech / series_a / US (10 rounds)
  for (let i = 0; i < 10; i++) {
    store.addToCohort(`seriesa-fintech-us-${i}`, { sector: "fintech", stage: "series_a", region: "US" }, {
      durationDays: 90 + i * 5,
      preMoneyValuation: 50_000_000 + i * 3_000_000,
      softCircleConversionRate: 0.42 + (i % 4) * 0.04,
      leadInvestorChequeSize: 6_000_000 + (i % 3) * 500_000,
      totalRoundSize: 12_000_000 + i * 500_000,
      timeToCloseDays: 95 + i * 4,
    });
  }
  // Cohort: saas / seed / US (10 rounds)
  for (let i = 0; i < 10; i++) {
    store.addToCohort(`seed-saas-us-${i}`, { sector: "saas", stage: "seed", region: "US" }, {
      durationDays: 38 + i * 4,
      preMoneyValuation: 14_000_000 + i * 700_000,
      softCircleConversionRate: 0.58 + (i % 4) * 0.04,
      leadInvestorChequeSize: 1_500_000 + (i % 3) * 300_000,
      totalRoundSize: 3_000_000 + i * 150_000,
      timeToCloseDays: 45 + i * 3,
    });
  }
  // Cohort: deeptech / pre_seed / US (5 rounds)
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`preseed-deeptech-us-${i}`, { sector: "deeptech", stage: "pre_seed", region: "US" }, {
      durationDays: 60 + i * 4,
      preMoneyValuation: 6_000_000 + i * 600_000,
      softCircleConversionRate: 0.48 + (i % 3) * 0.05,
      leadInvestorChequeSize: 500_000 + (i % 3) * 100_000,
      totalRoundSize: 1_500_000 + i * 100_000,
      timeToCloseDays: 70 + i * 4,
    });
  }
  // Cohort: fintech / seed / UK (5 rounds)
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-fintech-uk-${i}`, { sector: "fintech", stage: "seed", region: "UK" }, {
      durationDays: 55 + i * 5,
      preMoneyValuation: 8_000_000 + i * 500_000,
      softCircleConversionRate: 0.50 + (i % 3) * 0.04,
      leadInvestorChequeSize: 800_000 + (i % 3) * 100_000,
      totalRoundSize: 2_000_000 + i * 100_000,
      timeToCloseDays: 60 + i * 3,
    });
  }
  // Cohort: marketplace / seed / SG (5 rounds)
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-marketplace-sg-${i}`, { sector: "marketplace", stage: "seed", region: "SG" }, {
      durationDays: 70 + i * 5,
      preMoneyValuation: 9_000_000 + i * 400_000,
      softCircleConversionRate: 0.46 + (i % 3) * 0.05,
      leadInvestorChequeSize: 750_000 + (i % 3) * 100_000,
      totalRoundSize: 1_800_000 + i * 100_000,
      timeToCloseDays: 80 + i * 4,
    });
  }

  // ---- Hong Kong cohorts (USD; Cayman + HK OpCo structure) ------------------
  // Cohort: fintech / seed / HK (6 rounds) — strong VC presence, sophisticated PE/HF infra
  for (let i = 0; i < 6; i++) {
    store.addToCohort(`seed-fintech-hk-${i}`, { sector: "fintech", stage: "seed", region: "HK" }, {
      durationDays: 55 + i * 4,
      preMoneyValuation: 11_000_000 + i * 500_000,
      softCircleConversionRate: 0.52 + (i % 3) * 0.04,
      leadInvestorChequeSize: 900_000 + (i % 3) * 150_000,
      totalRoundSize: 2_400_000 + i * 150_000,
      timeToCloseDays: 65 + i * 3,
    });
  }
  // Cohort: saas / seed / HK (5 rounds) — regional B2B SaaS
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-saas-hk-${i}`, { sector: "saas", stage: "seed", region: "HK" }, {
      durationDays: 50 + i * 5,
      preMoneyValuation: 9_500_000 + i * 600_000,
      softCircleConversionRate: 0.50 + (i % 3) * 0.05,
      leadInvestorChequeSize: 800_000 + (i % 3) * 120_000,
      totalRoundSize: 2_200_000 + i * 130_000,
      timeToCloseDays: 60 + i * 4,
    });
  }
  // Cohort: marketplace / series_a / HK (5 rounds) — Greater Bay Area marketplace plays
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seriesa-marketplace-hk-${i}`, { sector: "marketplace", stage: "series_a", region: "HK" }, {
      durationDays: 95 + i * 6,
      preMoneyValuation: 38_000_000 + i * 2_500_000,
      softCircleConversionRate: 0.40 + (i % 3) * 0.04,
      leadInvestorChequeSize: 4_500_000 + (i % 3) * 500_000,
      totalRoundSize: 9_500_000 + i * 400_000,
      timeToCloseDays: 105 + i * 5,
    });
  }

  // ---- Mainland China cohorts (USD-equivalent; Cayman parent + WFOE/VIE) -----
  // Note: cohort metrics are recorded in USD-equivalent for benchmark comparability.
  // Cohort: deeptech / seed / CN (6 rounds) — semis, robotics, AI deeptech
  for (let i = 0; i < 6; i++) {
    store.addToCohort(`seed-deeptech-cn-${i}`, { sector: "deeptech", stage: "seed", region: "CN" }, {
      durationDays: 75 + i * 5,
      preMoneyValuation: 13_000_000 + i * 800_000,    // ~RMB 95M+ pre-money equivalents
      softCircleConversionRate: 0.44 + (i % 3) * 0.05,
      leadInvestorChequeSize: 1_400_000 + (i % 3) * 200_000,
      totalRoundSize: 3_500_000 + i * 200_000,
      timeToCloseDays: 90 + i * 5,
    });
  }
  // Cohort: saas / series_a / CN (5 rounds) — enterprise SaaS via Cayman parent
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seriesa-saas-cn-${i}`, { sector: "saas", stage: "series_a", region: "CN" }, {
      durationDays: 110 + i * 6,
      preMoneyValuation: 42_000_000 + i * 3_000_000,
      softCircleConversionRate: 0.38 + (i % 3) * 0.04,
      leadInvestorChequeSize: 5_500_000 + (i % 3) * 600_000,
      totalRoundSize: 11_000_000 + i * 500_000,
      timeToCloseDays: 120 + i * 6,
    });
  }
  // Cohort: biotech / pre_seed / CN (5 rounds) — Suzhou/Shanghai biotech cluster
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`preseed-biotech-cn-${i}`, { sector: "biotech", stage: "pre_seed", region: "CN" }, {
      durationDays: 85 + i * 5,
      preMoneyValuation: 7_500_000 + i * 600_000,
      softCircleConversionRate: 0.42 + (i % 3) * 0.05,
      leadInvestorChequeSize: 600_000 + (i % 3) * 120_000,
      totalRoundSize: 1_800_000 + i * 130_000,
      timeToCloseDays: 95 + i * 5,
    });
  }

  // ---- India cohorts (USD-equivalent; CCPS / FEMA / DPIIT) -------------------
  // Note: cohort metrics in USD-equivalent for cross-jurisdiction comparability.
  // Cohort: fintech / seed / IN (6 rounds) — Bengaluru + Mumbai fintech
  for (let i = 0; i < 6; i++) {
    store.addToCohort(`seed-fintech-in-${i}`, { sector: "fintech", stage: "seed", region: "IN" }, {
      durationDays: 65 + i * 4,
      preMoneyValuation: 8_500_000 + i * 600_000,    // ~INR 70Cr+ pre-money equivalents
      softCircleConversionRate: 0.48 + (i % 3) * 0.04,
      leadInvestorChequeSize: 750_000 + (i % 3) * 150_000,
      totalRoundSize: 2_200_000 + i * 150_000,
      timeToCloseDays: 75 + i * 4,
    });
  }
  // Cohort: saas / series_a / IN (5 rounds) — vertical SaaS via Cayman flip
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seriesa-saas-in-${i}`, { sector: "saas", stage: "series_a", region: "IN" }, {
      durationDays: 105 + i * 6,
      preMoneyValuation: 35_000_000 + i * 2_500_000,
      softCircleConversionRate: 0.40 + (i % 3) * 0.04,
      leadInvestorChequeSize: 4_500_000 + (i % 3) * 500_000,
      totalRoundSize: 9_000_000 + i * 500_000,
      timeToCloseDays: 115 + i * 6,
    });
  }
  // Cohort: marketplace / seed / IN (5 rounds) — D2C and consumer marketplaces
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-marketplace-in-${i}`, { sector: "marketplace", stage: "seed", region: "IN" }, {
      durationDays: 70 + i * 5,
      preMoneyValuation: 9_000_000 + i * 500_000,
      softCircleConversionRate: 0.46 + (i % 3) * 0.04,
      leadInvestorChequeSize: 800_000 + (i % 3) * 150_000,
      totalRoundSize: 2_400_000 + i * 150_000,
      timeToCloseDays: 80 + i * 4,
    });
  }

  // ---- Japan cohorts (USD-equivalent; J-KISS / class shares / FEFTA) ---------
  // Cohort: saas / seed / JP (6 rounds) — Tokyo enterprise + dev tools
  for (let i = 0; i < 6; i++) {
    store.addToCohort(`seed-saas-jp-${i}`, { sector: "saas", stage: "seed", region: "JP" }, {
      durationDays: 60 + i * 4,
      preMoneyValuation: 7_500_000 + i * 500_000,    // ~JPY 1.1B+ pre-money
      softCircleConversionRate: 0.46 + (i % 3) * 0.04,
      leadInvestorChequeSize: 700_000 + (i % 3) * 130_000,
      totalRoundSize: 1_900_000 + i * 130_000,
      timeToCloseDays: 70 + i * 4,
    });
  }
  // Cohort: fintech / series_a / JP (5 rounds) — Tokyo fintech with FSA-licensed strategics
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seriesa-fintech-jp-${i}`, { sector: "fintech", stage: "series_a", region: "JP" }, {
      durationDays: 115 + i * 6,
      preMoneyValuation: 32_000_000 + i * 2_500_000,
      softCircleConversionRate: 0.38 + (i % 3) * 0.04,
      leadInvestorChequeSize: 4_000_000 + (i % 3) * 500_000,
      totalRoundSize: 8_500_000 + i * 500_000,
      timeToCloseDays: 125 + i * 6,
    });
  }
  // Cohort: marketplace / seed / JP (5 rounds) — consumer marketplaces
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-marketplace-jp-${i}`, { sector: "marketplace", stage: "seed", region: "JP" }, {
      durationDays: 75 + i * 5,
      preMoneyValuation: 6_500_000 + i * 500_000,
      softCircleConversionRate: 0.44 + (i % 3) * 0.04,
      leadInvestorChequeSize: 650_000 + (i % 3) * 120_000,
      totalRoundSize: 1_700_000 + i * 130_000,
      timeToCloseDays: 85 + i * 5,
    });
  }

  // ---- Australia cohorts (USD-equivalent; ESS startup concession) ------------
  // Cohort: saas / seed / AU (6 rounds) — Sydney + Melbourne SaaS
  for (let i = 0; i < 6; i++) {
    store.addToCohort(`seed-saas-au-${i}`, { sector: "saas", stage: "seed", region: "AU" }, {
      durationDays: 60 + i * 4,
      preMoneyValuation: 9_500_000 + i * 600_000,    // ~AUD 14M+ pre-money
      softCircleConversionRate: 0.50 + (i % 3) * 0.04,
      leadInvestorChequeSize: 850_000 + (i % 3) * 150_000,
      totalRoundSize: 2_300_000 + i * 150_000,
      timeToCloseDays: 70 + i * 4,
    });
  }
  // Cohort: fintech / seed / AU (5 rounds) — Australian fintech (Stone & Chalk pipeline)
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seed-fintech-au-${i}`, { sector: "fintech", stage: "seed", region: "AU" }, {
      durationDays: 65 + i * 5,
      preMoneyValuation: 10_000_000 + i * 600_000,
      softCircleConversionRate: 0.48 + (i % 3) * 0.04,
      leadInvestorChequeSize: 900_000 + (i % 3) * 150_000,
      totalRoundSize: 2_500_000 + i * 150_000,
      timeToCloseDays: 75 + i * 4,
    });
  }
  // Cohort: deeptech / series_a / AU (5 rounds) — quantum, photonics, Cicada Innovations
  for (let i = 0; i < 5; i++) {
    store.addToCohort(`seriesa-deeptech-au-${i}`, { sector: "deeptech", stage: "series_a", region: "AU" }, {
      durationDays: 110 + i * 6,
      preMoneyValuation: 28_000_000 + i * 2_500_000,
      softCircleConversionRate: 0.36 + (i % 3) * 0.04,
      leadInvestorChequeSize: 3_500_000 + (i % 3) * 500_000,
      totalRoundSize: 8_000_000 + i * 500_000,
      timeToCloseDays: 120 + i * 6,
    });
  }
}

// Pre-seed the default store so the admin dashboard has signal immediately.
seedSyntheticBenchmarks(defaultBenchmarkStore);
