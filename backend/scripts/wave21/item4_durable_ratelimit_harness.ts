/**
 * WAVE 21 · ITEM 4 — falsification harness for DURABLE rate-limit buckets.
 *
 * Review A: "Rate-limit buckets are process-local, resettable by restart ...
 * Auth spray limits that reset on restart are the security-relevant case."
 *
 * The decisive test is a SIMULATED RESTART: consume the quota, tear the module
 * state down completely (which is what a process restart does), and prove the
 * quota is STILL consumed. Under the old Maps that test is impossible to pass;
 * under durable rows it is the whole point.
 *
 * Run: npx tsx scripts/wave21/item4_durable_ratelimit_harness.ts
 */
process.env.NODE_ENV = "test";
process.env.ENFORCE_AUTH_RATELIMIT = "1";

import fs from "node:fs";
import path from "node:path";

let failed = 0;
let passed = 0;
function ok(cond: boolean, label: string, detail?: unknown) {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
}
function eq(a: unknown, b: unknown, label: string) { ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b }); }

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Strip comments before grepping: the WAVE 21 comments QUOTE the defective
 *  code they replaced, and a raw search would find the defect in its obituary.
 *  This exact mistake produced seven false FAILs in the ITEM 2 harness. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
function anchorOnce(label: string, rel: string, needle: string) {
  const n = code(rel).split(needle).length - 1;
  ok(n === 1, `${label} — \`${needle.slice(0, 62)}\` occurs exactly once`, { occurrences: n });
}
function absent(label: string, rel: string, needle: string) {
  ok(!code(rel).includes(needle), `${label} — \`${needle.slice(0, 62)}\` is gone`);
}

console.log("WAVE 21 ITEM 4 — durable rate-limit buckets\n");

// ---------------------------------------------------------------------------
console.log("A. schema provenance");
// ---------------------------------------------------------------------------
const { RATE_LIMIT_STORE_SQL } = await import("../../server/lib/rateLimitStoreSchema");
const MIG = "migrations/0173_wave21_durable_rate_limit.sql";
ok(RATE_LIMIT_STORE_SQL === read(MIG), "inline bootstrap is byte-identical to the canonical migration");
ok(read(MIG) === read("server/db/migrations/0173_wave21_durable_rate_limit.sql"), "server/db/migrations mirror is byte-identical");
ok(!fs.existsSync(path.join(ROOT, "migrations/0152_.sql")), "burnt ids are not reused (0173 taken, 0152/0154/0155/0158 untouched)");
for (const burnt of ["0152", "0154", "0155", "0158"]) {
  const hit = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.startsWith(burnt + "_"));
  ok(hit.length === 0, `burnt migration id ${burnt} is still unused`, hit);
}
ok(RATE_LIMIT_STORE_SQL.includes("CREATE TABLE IF NOT EXISTS rate_limit_hit"), "migration creates rate_limit_hit");
ok(RATE_LIMIT_STORE_SQL.includes("CREATE TABLE IF NOT EXISTS rate_limit_lockout"), "migration creates rate_limit_lockout");
ok(RATE_LIMIT_STORE_SQL.includes("ix_rate_limit_hit_key_time"), "the (bucket_key, hit_at) covering index exists");

// ---------------------------------------------------------------------------
console.log("\nB. no in-memory bucket state survives in rateLimit.ts");
// ---------------------------------------------------------------------------
const RL = "server/lib/rateLimit.ts";
for (const gone of [
  "const buckets = new Map",
  "const failures = new Map",
  "const lockouts = new Map",
  "const authBuckets = new Map",
  "const collectiveBuckets = new Map",
  "bucket.hits.push(",
  "authBuckets.get(",
  "collectiveBuckets.get(",
  "lockouts.set(",
  "failures.set(",
]) absent("B", RL, gone);
ok(!/new Map\s*</.test(code(RL)), "B — no `new Map<` remains anywhere in rateLimit.ts");
/* HARNESS BUG found on first run: these two anchors embedded the inline
   `/* failClosed *\/` marker, which code() strips before searching, so both
   reported 0 occurrences against correct source. Anchoring on the
   comment-free remainder. Recorded rather than silently re-rolled. */
/* Two non-auth call sites share this body verbatim — `tick` (general
   read/write) and `collectiveTick`. Asserting "exactly once" was the harness
   over-applying the uniqueness rule to an anchor that is legitimately not
   unique; the meaningful invariant is the COUNT PER POLICY. */
ok(code(RL).split("return durableTick(key, limit, WINDOW_MS, now,  false);").length - 1 === 2,
   "B — both non-auth limiters (general + collective) use the DEGRADE policy");
anchorOnce("B:auth-durable", RL, "return durableTick(key, limit, windowMs, now,  true);");
ok(code(RL).split("durableTick(").length - 1 === 3, "B — exactly three durableTick call sites, no limiter left behind");
ok(code(RL).split(" true)").length - 1 === 1, "B — exactly ONE limiter uses the fail-closed policy, and it is the auth one");

// ---------------------------------------------------------------------------
console.log("\nC. limits are UNCHANGED — this item moves storage, not policy");
// ---------------------------------------------------------------------------
const rl = await import("../../server/lib/rateLimit");
eq(rl.RateLimitConfig.READ_LIMIT, 60, "C — READ_LIMIT still 60");
eq(rl.RateLimitConfig.WRITE_LIMIT, 10, "C — WRITE_LIMIT still 10");
eq(rl.RateLimitConfig.WINDOW_MS, 60_000, "C — WINDOW_MS still 60s");
eq(rl.RateLimitConfig.AUTH_FAIL_LIMIT, 5, "C — AUTH_FAIL_LIMIT still 5");
eq(rl.RateLimitConfig.AUTH_LOCKOUT_MS, 15 * 60 * 1000, "C — AUTH_LOCKOUT_MS still 15min");
eq(rl.AuthRateLimitConfig.LOGIN_LIMIT, 10, "C — AUTH login still 10/min");
eq(rl.AuthRateLimitConfig.SIGNUP_LIMIT, 5, "C — AUTH signup still 5/hour");
eq(rl.AuthRateLimitConfig.SIGNUP_WINDOW_MS, 3_600_000, "C — signup window still 1 hour");
eq(rl.CollectiveBucketLimits, { write: 60, read: 600, sse: 30 }, "C — collective buckets unchanged");

// ---------------------------------------------------------------------------
console.log("\nD. the durable window behaves exactly like the old sliding window");
// ---------------------------------------------------------------------------
const store = await import("../../server/lib/rateLimitStore");
store._resetDurableRateLimitsForTests();
ok(store.rateLimitStoreHealth().durable, "D — durable store is reachable in this environment");

const T0 = 1_800_000_000_000;
const W = 60_000;
let last = store.durableTick("k:d", 3, W, T0, false);
eq([last.ok, last.remaining], [true, 2], "D — 1st of 3 admitted, remaining 2");
last = store.durableTick("k:d", 3, W, T0 + 10, false);
eq([last.ok, last.remaining], [true, 1], "D — 2nd admitted, remaining 1");
last = store.durableTick("k:d", 3, W, T0 + 20, false);
eq([last.ok, last.remaining], [true, 0], "D — 3rd admitted, remaining 0");
last = store.durableTick("k:d", 3, W, T0 + 30, false);
eq([last.ok, last.remaining], [false, 0], "D — 4th REFUSED");
eq(last.resetAt, T0 + W, "D — resetAt is oldestHitInWindow + windowMs (sliding, not fixed)");
// One tick after the oldest hit ages out, exactly one slot frees up.
last = store.durableTick("k:d", 3, W, T0 + W + 1, false);
eq(last.ok, true, "D — a slot frees once the oldest hit leaves the window");
last = store.durableTick("k:d", 3, W, T0 + W + 2, false);
eq(last.ok, false, "D — and only one slot: the window really is sliding");
// Keys are independent.
eq(store.durableTick("k:other", 3, W, T0 + 30, false).ok, true, "D — a different key has its own quota");

// ---------------------------------------------------------------------------
console.log("\nE. THE DECISIVE TEST — quota survives a process restart");
//
// `resetModules`-style teardown: drop the module-level handle and prepared
// statements, exactly as a fresh process would have. Under the old Maps the
// counter would be zero here and every assertion below would flip.
// ---------------------------------------------------------------------------
store._resetDurableRateLimitsForTests();
const SPRAY = "auth-ip:203.0.113.77:login";
for (let i = 0; i < 10; i++) store.durableTick(SPRAY, 10, W, T0 + i, true);
eq(store.durableTick(SPRAY, 10, W, T0 + 11, true).ok, false, "E — login quota (10/min) is exhausted");

// Simulate the restart: re-import the module graph under a cache-busting URL so
// every module-level binding is constructed from scratch.
const restarted: any = await import(`../../server/lib/rateLimitStore.ts?restart=${Date.now()}`);
ok(restarted !== store, "E — a genuinely fresh module instance was loaded");
const after = restarted.durableTick(SPRAY, 10, W, T0 + 12, true);
eq(after.ok, false, "E — *** the quota is STILL exhausted after the restart ***");
eq(after.remaining, 0, "E — remaining is still 0 after the restart");
// And the control: a key that was never sprayed is still free after the restart,
// so E is not passing merely because everything is refused.
eq(restarted.durableTick("auth-ip:198.51.100.1:login", 10, W, T0 + 12, true).ok, true,
   "E CONTROL — an untouched key is still admitted after the restart");

// ---------------------------------------------------------------------------
console.log("\nF. auth lockout is durable and survives a restart");
// ---------------------------------------------------------------------------
store._resetDurableRateLimitsForTests();
const LOCKED = "user@example.test";
for (let i = 0; i < 5; i++) rl.recordAuthFailure(LOCKED);
ok(rl.isLockedOut(LOCKED).locked, "F — 5 failures produce a lockout");
ok(!rl.isLockedOut("someone-else@example.test").locked, "F CONTROL — an unrelated key is not locked");
const rl2: any = await import(`../../server/lib/rateLimit.ts?restart=${Date.now()}`);
ok(rl2.isLockedOut(LOCKED).locked, "F — *** the lockout SURVIVES the restart ***");
ok(!rl2.isLockedOut("someone-else@example.test").locked, "F CONTROL — still not locked after restart");
rl.clearAuthFailures(LOCKED);
ok(!rl.isLockedOut(LOCKED).locked, "F — clearAuthFailures releases the lockout");
// 4 strikes must NOT lock: the 5-strike policy is unchanged.
store._resetDurableRateLimitsForTests();
for (let i = 0; i < 4; i++) rl.recordAuthFailure("four@example.test");
ok(!rl.isLockedOut("four@example.test").locked, "F — 4 failures do NOT lock (policy unchanged)");

// ---------------------------------------------------------------------------
console.log("\nG. lockout expiry still works, and the audit columns are populated");
// ---------------------------------------------------------------------------
store._resetDurableRateLimitsForTests();
const now = Date.now();
store.durableSetLockout("expiring", now - 1000, now);
eq(store.durableGetLockout("expiring", now).locked, false, "G — an expired lockout reads as unlocked");
store.durableSetLockout("live", now + 60_000, now);
eq(store.durableGetLockout("live", now).locked, true, "G — a live lockout reads as locked");
store.durableSetLockout("live", now + 90_000, now);
const db = store.durableSnapshotHandle();
const row = db.prepare("SELECT lock_count, first_locked_at, last_locked_at FROM rate_limit_lockout WHERE lock_key = ?").get("live");
eq(row.lock_count, 2, "G — repeated lockouts increment lock_count (previously unrecorded entirely)");
ok(typeof row.first_locked_at === "string" && row.first_locked_at.includes("T"), "G — first_locked_at is an ISO timestamp");

// ---------------------------------------------------------------------------
console.log("\nH. availability policy: auth FAILS CLOSED, non-auth degrades visibly");
// ---------------------------------------------------------------------------
const RLS = "server/lib/rateLimitStore.ts";
/* Expected TWO occurrences, one per availability branch (store-unreachable and
   query-threw). The `exactly once` rule applies to a UNIQUE anchor; here the
   correct count is 2 and asserting 1 was the harness being wrong, not the code. */
ok(code(RLS).split("deniedByStoreOutage: true }").length - 1 === 2,
   "H — both fail-closed branches set deniedByStoreOutage");
/* COVERAGE GAP found by mutation M12 (2026-08-11): this used `.includes`, but
   the phrase occurs TWICE (the no-handle branch and the catch branch), so a
   mutation flipping ONE of them to `{ locked: false }` still passed. Reporting
   every account as unlocked because the lockout table is unreadable is the
   precise failure the durable move exists to prevent. Now counted, and also
   exercised behaviourally below against a genuinely broken store. */
ok(code(RLS).split("locked: true, unknown: true").length - 1 === 2,
   "H — BOTH unreadable-lockout branches fail closed");
{
  // Behavioural: force the store unavailable and prove the outcome.
  const broken: any = await import(`../../server/lib/rateLimitStore.ts?broken=${Date.now()}`);
  const realEnv = process.env.DATABASE_URL;
  broken._forceStoreOutageForTests(new Error("simulated store outage"));
  const r = broken.durableGetLockout("anyone", Date.now());
  ok(r.locked === true && r.unknown === true, "H — with the store down, an unknown lockout reads LOCKED", r);
  const authDenied = broken.durableTick("k", 10, 60_000, Date.now(), true);
  ok(authDenied.ok === false && authDenied.deniedByStoreOutage === true, "H — with the store down, AUTH fails closed", authDenied);
  const nonAuth = broken.durableTick("k", 10, 60_000, Date.now(), false);
  ok(nonAuth.ok === true && nonAuth.degraded === true, "H — with the store down, non-auth degrades and SAYS so", nonAuth);
  ok(broken.rateLimitStoreHealth().durable === false, "H — health reports the outage; degradation is never silent");
  process.env.DATABASE_URL = realEnv;
}
anchorOnce("H:health", RLS, "export function rateLimitStoreHealth()");
ok(code(RL).includes('error: "rate_limit_store_unavailable"'), "H — a store outage returns 503, not a fabricated 429 quota breach");
ok(code(RL).split('error: "rate_limit_store_unavailable"').length - 1 === 2,
   "H — both auth surfaces (login and signup) distinguish outage from quota");

console.log("");
console.log(`assertions: ${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "ITEM4 HARNESS: OK" : "ITEM4 HARNESS: FAIL");
process.exit(failed === 0 ? 0 : 1);
