/**
 * v19 Phase C — perf smoke test.
 *
 * Synthetic load against ~10 hot endpoints; reports p50/p95/p99 per endpoint.
 *
 * USAGE:
 *   npm run perf:smoke
 *   PERF_BASE=http://localhost:5000 PERF_VUS=100 PERF_DURATION_S=20 \
 *     tsx scripts/perf_smoke.ts
 *
 * The script SKIPS itself when NODE_ENV=test (so vitest CI runs don't
 * attempt network I/O against a non-existent server).
 *
 * METHODOLOGY: each virtual user (VU) loops calling the configured hot
 * endpoints sequentially for `PERF_DURATION_S` seconds. Latencies are
 * recorded per endpoint; quantiles computed at the end.
 */

interface EndpointConfig {
  name: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
}

const HOT_ENDPOINTS: EndpointConfig[] = [
  { name: "qa.list", path: "/api/collective/expert/questions", method: "GET" },
  { name: "announcements.list", path: "/api/collective/announcements", method: "GET" },
  { name: "events.list", path: "/api/collective/screening-events", method: "GET" },
  { name: "dashboard", path: "/api/collective/chapter-admin/dashboard?chapter_id=chap_keiretsu_canada", method: "GET" },
  { name: "leaderboard", path: "/api/collective/leaderboard?chapter_id=chap_keiretsu_canada", method: "GET" },
  { name: "messages.list", path: "/api/messages?recipient_user_id=me", method: "GET" },
  { name: "threads.list", path: "/api/messages/threads", method: "GET" },
  { name: "portfolio.list", path: "/api/partner/portfolio", method: "GET" },
  { name: "resources.list", path: "/api/collective/resources", method: "GET" },
  { name: "healthz", path: "/api/healthz", method: "GET" },
];

interface Sample {
  ok: boolean;
  ms: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

async function hit(base: string, ep: EndpointConfig): Promise<Sample> {
  const start = Date.now();
  try {
    const r = await fetch(`${base}${ep.path}`, {
      method: ep.method,
      headers: { "X-Correlation-ID": "perf-smoke" },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    // Drain body so connection can be reused.
    await r.text();
    return { ok: r.status < 500, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

async function runVu(base: string, deadlineMs: number, perEp: Map<string, Sample[]>): Promise<void> {
  while (Date.now() < deadlineMs) {
    for (const ep of HOT_ENDPOINTS) {
      const s = await hit(base, ep);
      const arr = perEp.get(ep.name)!;
      arr.push(s);
      if (Date.now() >= deadlineMs) return;
    }
  }
}

function reportTable(perEp: Map<string, Sample[]>): void {
  // eslint-disable-next-line no-console
  console.log(
    "endpoint                       n      ok%    p50     p95     p99     max",
  );
  // eslint-disable-next-line no-console
  console.log(
    "-----------------------------  -----  -----  ------  ------  ------  ------",
  );
  for (const ep of HOT_ENDPOINTS) {
    const samples = perEp.get(ep.name) ?? [];
    const n = samples.length;
    const okN = samples.filter((s) => s.ok).length;
    const lat = samples.map((s) => s.ms).sort((a, b) => a - b);
    const p50 = quantile(lat, 0.5).toFixed(1);
    const p95 = quantile(lat, 0.95).toFixed(1);
    const p99 = quantile(lat, 0.99).toFixed(1);
    const max = (lat[lat.length - 1] ?? 0).toFixed(1);
    const okPct = n > 0 ? ((okN / n) * 100).toFixed(0) : "0";
    const name = ep.name.padEnd(29);
    // eslint-disable-next-line no-console
    console.log(
      `${name}  ${String(n).padStart(5)}  ${okPct.padStart(4)}%  ${p50.padStart(6)}  ${p95.padStart(6)}  ${p99.padStart(6)}  ${max.padStart(6)}`,
    );
  }
}

export async function main(): Promise<{ ok: boolean; results: Map<string, Sample[]> }> {
  if (process.env.NODE_ENV === "test") {
    // eslint-disable-next-line no-console
    console.log("perf_smoke: NODE_ENV=test \u2014 skipping network load.");
    return { ok: true, results: new Map() };
  }
  const base = process.env.PERF_BASE ?? "http://localhost:5000";
  const vus = Math.max(1, Number(process.env.PERF_VUS ?? "100") | 0);
  const durationS = Math.max(1, Number(process.env.PERF_DURATION_S ?? "20") | 0);
  const deadlineMs = Date.now() + durationS * 1000;

  const perEp = new Map<string, Sample[]>();
  for (const ep of HOT_ENDPOINTS) perEp.set(ep.name, []);

  // eslint-disable-next-line no-console
  console.log(
    `perf_smoke: ${vus} VUs against ${base} for ${durationS}s across ${HOT_ENDPOINTS.length} endpoints`,
  );

  const startedAt = Date.now();
  const workers: Promise<void>[] = [];
  for (let i = 0; i < vus; i++) {
    workers.push(runVu(base, deadlineMs, perEp));
  }
  await Promise.all(workers);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`perf_smoke: completed in ${elapsed}s`);
  reportTable(perEp);
  return { ok: true, results: perEp };
}

/** Test-only helper: synchronous tiny loop that exercises the code paths
 *  without a live server. Used by perf_smoke_validate.test.ts. */
export function _selfTest(): { sortedQuantilesOk: boolean } {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const p50 = quantile(arr, 0.5);
  const p95 = quantile(arr, 0.95);
  return { sortedQuantilesOk: p50 === 5.5 && Math.abs(p95 - 9.55) < 0.0001 };
}

// Allow `tsx scripts/perf_smoke.ts` direct invocation.
const isDirectInvocation = (() => {
  try {
    // process.argv[1] resolves to this file when invoked directly.
    const inv = String(process.argv[1] ?? "");
    return inv.endsWith("perf_smoke.ts") || inv.endsWith("perf_smoke.js");
  } catch {
    return false;
  }
})();

if (isDirectInvocation && process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
