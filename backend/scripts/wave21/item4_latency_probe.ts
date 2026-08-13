/**
 * WAVE 21 · ITEM 4 — hot-path latency measurement for a DURABLE rate-limit
 * bucket, taken BEFORE committing to a design.
 *
 * The task says: "If a durable store would add unacceptable latency on the hot
 * path, say so with measurements rather than assuming." This is the
 * measurement. It compares, on this machine, against this SQLite build:
 *
 *   A. the current in-memory sliding window (array of timestamps)
 *   B. durable, ROW-PER-HIT sliding window (exact same semantics)
 *   C. durable, FIXED-WINDOW counter (one UPSERT per request)
 *
 * Run: npx tsx scripts/wave21/item4_latency_probe.ts
 */
import { createRequire } from "node:module";
const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");

const N = 20_000;
const WINDOW_MS = 60_000;
const LIMIT = 600; // the highest limit in the file (collective read bucket)

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}
function report(name: string, us: number[]) {
  const total = us.reduce((a, b) => a + b, 0);
  console.log(
    `${name.padEnd(34)} mean=${(total / us.length).toFixed(2)}µs  ` +
      `p50=${pct(us, 50).toFixed(2)}µs  p95=${pct(us, 95).toFixed(2)}µs  ` +
      `p99=${pct(us, 99).toFixed(2)}µs  max=${Math.max(...us).toFixed(0)}µs`,
  );
  return total / us.length;
}
const now = () => Number(process.hrtime.bigint()) / 1000; // µs

// ---------------- A. in-memory (what ships today)
const mem = new Map<string, number[]>();
function memTick(key: string, t: number) {
  let hits = mem.get(key);
  if (!hits) { hits = []; mem.set(key, hits); }
  const cutoff = t - WINDOW_MS;
  hits = hits.filter((x) => x > cutoff);
  mem.set(key, hits);
  if (hits.length >= LIMIT) return false;
  hits.push(t);
  return true;
}

// ---------------- shared durable db
function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}

// ---------------- B. durable, row per hit
const dbB = freshDb();
dbB.exec(`CREATE TABLE rl_hit (bucket_key TEXT NOT NULL, hit_at INTEGER NOT NULL);
          CREATE INDEX ix_rl_hit ON rl_hit(bucket_key, hit_at);`);
const bCount = dbB.prepare("SELECT count(*) AS n, min(hit_at) AS oldest FROM rl_hit WHERE bucket_key = ? AND hit_at > ?");
const bIns = dbB.prepare("INSERT INTO rl_hit (bucket_key, hit_at) VALUES (?, ?)");
const bTick = dbB.transaction((key: string, t: number) => {
  const r = bCount.get(key, t - WINDOW_MS) as { n: number; oldest: number | null };
  if (r.n >= LIMIT) return false;
  bIns.run(key, t);
  return true;
});

// ---------------- C. durable, fixed-window counter
const dbC = freshDb();
dbC.exec(`CREATE TABLE rl_ctr (bucket_key TEXT NOT NULL, window_start INTEGER NOT NULL,
            hits INTEGER NOT NULL, PRIMARY KEY (bucket_key, window_start));`);
const cUp = dbC.prepare(
  `INSERT INTO rl_ctr (bucket_key, window_start, hits) VALUES (?, ?, 1)
   ON CONFLICT(bucket_key, window_start) DO UPDATE SET hits = hits + 1
   RETURNING hits`,
);
function cTick(key: string, t: number) {
  const r = cUp.get(key, Math.floor(t / WINDOW_MS) * WINDOW_MS) as { hits: number };
  return r.hits <= LIMIT;
}

// ---------------- run
// 200 distinct keys, so no single bucket's row set grows unrealistically.
const keys = Array.from({ length: 200 }, (_, i) => `u:${i}:cb:read`);
const t0 = Date.now();
function bench(fn: (k: string, t: number) => boolean) {
  const us: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = keys[i % keys.length]!;
    const t = t0 + i; // 20k requests spread over 20s — inside one 60s window
    const s = now();
    fn(k, t);
    us.push(now() - s);
  }
  return us;
}

console.log(`WAVE 21 ITEM 4 — rate-limit hot-path latency, N=${N}, ${keys.length} keys, limit=${LIMIT}\n`);
const a = report("A in-memory (today)", bench(memTick));
const b = report("B durable row-per-hit", bench(bTick as any));
const c = report("C durable fixed-window UPSERT", bench(cTick));
console.log("");
console.log(`B overhead vs A: +${(b - a).toFixed(2)}µs/request  (${(b / a).toFixed(1)}x)`);
console.log(`C overhead vs A: +${(c - a).toFixed(2)}µs/request  (${(c / a).toFixed(1)}x)`);
console.log("");
console.log("Absolute budget check: a typical API handler in this tree does");
console.log("several SQLite queries already, so the reference point is one extra");
console.log("query, not zero. Anything under ~100µs is noise against that.");
