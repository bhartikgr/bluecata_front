/**
 * WAVE 21 · ITEM 1 falsification harness — TRUSTED_PROXY_HOPS must FAIL CLOSED.
 *
 * Run:  npx tsx scripts/wave21/item1_proxy_hops_harness.ts
 * Exits non-zero on any failed assertion.
 *
 * This harness is written so that it FAILS if the fix is reverted. The
 * companion mutation runner (`item1_mutations.sh`) proves that by patching
 * `rateLimit.ts` in a scratch copy and re-running this file against it.
 */
import {
  trustedProxyHopCount,
  resolveRateLimitClientIp,
  _resetTrustedProxyHopLogForTests,
} from "../../server/lib/rateLimit";

const SOCKET = "10.0.0.9";
const req = (xff?: string, socket = SOCKET) =>
  ({
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    socket: { remoteAddress: socket },
    ip: socket,
  }) as any;

let failed = 0;
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    console.log(`PASS  ${name}  ${detail}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

function setHops(v: string | undefined) {
  if (v === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = v;
}

// ---------------------------------------------------------------- A. parsing
// A1..A6: the pre-existing fail-closed cases MUST be preserved.
for (const [label, v] of [
  ["unset", undefined],
  ["empty", ""],
  ["zero", "0"],
  ["negative", "-1"],
  ["nonnumeric", "abc"],
  ["float", "2.5"],
] as [string, string | undefined][]) {
  setHops(v);
  const n = trustedProxyHopCount();
  check(`A:${label}-parses-to-0`, n === 0, `parsed=${n}`);
}

// A7: in-range values still work — the fix must not disable legitimate config.
for (const v of ["1", "2", "8"]) {
  setHops(v);
  const n = trustedProxyHopCount();
  check(`A:inrange-${v}`, n === Number(v), `parsed=${n}`);
}

// A8: THE DEFECT. Out-of-range must be REJECTED (0), never clamped to 8.
for (const v of ["9", "16", "9999", "999999999999999999999"]) {
  setHops(v);
  const n = trustedProxyHopCount();
  check(`A:oversized-${v}-rejected`, n === 0, `parsed=${n} (clamp would give 8)`);
}

// ------------------------------------------------------- B. resolver keying
// B1: oversized config + long crafted chain must NOT let the caller pick the key.
setHops("9999");
const long = (selected: string) =>
  ["prefix", selected, "a3", "a4", "a5", "a6", "a7", "a8", "trusted-client"].join(", ");
const kA = resolveRateLimitClientIp(req(long("bucket-A")));
const kB = resolveRateLimitClientIp(req(long("bucket-B")));
check(
  "B:oversized-crafted-rotation-same-key",
  kA === kB,
  `A=${kA} B=${kB}`,
);
check(
  "B:oversized-falls-back-to-socket",
  kA === SOCKET && kB === SOCKET,
  `A=${kA} B=${kB} socket=${SOCKET}`,
);
check(
  "B:oversized-key-not-attacker-text",
  !kA.startsWith("bucket-") && !kB.startsWith("bucket-"),
  `A=${kA} B=${kB}`,
);

// B2: unbounded rotation under oversized config yields exactly one bucket.
setHops("9999");
const keys = new Set<string>();
for (let i = 0; i < 500; i += 1) {
  keys.add(resolveRateLimitClientIp(req(long(`spray-${i}`))));
}
check("B:oversized-500-rotations-one-bucket", keys.size === 1, `distinctKeys=${keys.size}`);

// B3: correctly configured 1 hop still ignores a rotated untrusted prefix.
setHops("1");
const p1 = resolveRateLimitClientIp(req("evil-A, 203.0.113.5"));
const p2 = resolveRateLimitClientIp(req("evil-B, 203.0.113.5"));
check("B:hops1-ignores-rotated-prefix", p1 === p2 && p1 === "203.0.113.5", `${p1} / ${p2}`);

// B4: unset ignores the header entirely.
setHops(undefined);
check(
  "B:unset-ignores-header",
  resolveRateLimitClientIp(req("evil-A, 203.0.113.5")) === SOCKET,
  "socket peer used",
);

// B5: chain shorter than configured hops falls back to socket (unchanged).
setHops("3");
check(
  "B:short-chain-falls-back",
  resolveRateLimitClientIp(req("203.0.113.5")) === SOCKET,
  "socket peer used",
);

// ----------------------------------------------------------- C. loud logging
setHops("9999");
const seen: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { seen.push(a.map(String).join(" ")); };
try {
  // fresh module-level log memo so this assertion is order-independent
  _resetTrustedProxyHopLogForTests();
  trustedProxyHopCount();
} finally {
  console.error = origError;
}
check(
  "C:oversized-logged-loudly",
  seen.some((l) => l.includes("TRUSTED_PROXY_HOPS") && l.includes("SECURITY")),
  `logLines=${seen.length}`,
);

setHops(undefined);
console.log(failed === 0 ? "ITEM1 HARNESS: OK" : `ITEM1 HARNESS: ${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
