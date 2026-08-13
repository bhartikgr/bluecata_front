/**
 * WAVE 23 · ITEM 2 · WAIVER-2 — falsification harness for the ENFORCED
 * trusted-proxy-peer invariant in server/lib/rateLimit.ts.
 *
 * The hop ALGORITHM is not under test here — Review A confirmed it is correct
 * and Wave 21's harness already fences it. What is under test is the
 * precondition Wave 23 added: `x-forwarded-for` is read only when the DIRECT
 * SOCKET PEER is itself a trusted proxy.
 *
 * BOTH POLES, per the brief:
 *   POLE A  a request from a PUBLIC peer with a crafted 30-hop header must key
 *           on the PEER, not on any header entry — for hops=1 and hops=8, and
 *           two different crafted headers must collapse to ONE bucket.
 *   POLE B  a request from a LOOPBACK or PRIVATE peer with hops=1 must still
 *           resolve the real client from the header (the fix must not break
 *           the legitimate deployment).
 *
 * Plus the fail-closed edges: unknown peer, malformed allow-list entry,
 * explicitly-empty allow-list, IPv4-mapped IPv6 peers, override precedence,
 * and every preserved Wave 19 / Wave 21 behaviour (hops unset/0/-1/abc/9999).
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave23/item2_trusted_peer_harness.ts
 */
import {
  resolveRateLimitClientIp,
  isTrustedProxyPeer,
  trustedProxyHopCount,
  _setTrustedProxyPeerOverride,
  _resetTrustedProxyPeerLogForTests,
  _resetTrustedProxyHopLogForTests,
} from "../../server/lib/rateLimit.ts";

let asserts = 0;
const failures: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}

/** A request whose socket peer is `peer` and whose XFF header is `xff`. */
function reqFrom(peer: string, xff?: string): any {
  return {
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    socket: { remoteAddress: peer },
    ip: peer,
  };
}
/** 30-hop chain where the entry the resolver would select is `tag`. */
function craft(hops: number, tag: string): string {
  return Array.from({ length: 30 }, (_, i) => (i === 30 - hops ? tag : `p${i}`)).join(",");
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  _resetTrustedProxyPeerLogForTests();
  _resetTrustedProxyHopLogForTests();
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
    _setTrustedProxyPeerOverride(null);
  }
}

/* ── POLE A — public peer + crafted header ⇒ key on the PEER ─────────────── */
for (const hops of ["1", "8"]) {
  withEnv({ TRUSTED_PROXY_HOPS: hops, TRUSTED_PROXY_PEERS: undefined }, () => {
    const peer = "203.0.113.7"; // TEST-NET-3: a public, untrusted address
    const a = resolveRateLimitClientIp(reqFrom(peer, craft(Number(hops), "bucket-A")));
    const b = resolveRateLimitClientIp(reqFrom(peer, craft(Number(hops), "bucket-B")));
    eq(a, peer, `POLE A hops=${hops}: crafted header A must NOT choose the key`);
    eq(b, peer, `POLE A hops=${hops}: crafted header B must NOT choose the key`);
    eq(a === b, true, `POLE A hops=${hops}: both crafted headers collapse to ONE bucket`);
  });
}
// Exactly the reviewer's attack shape, but from a peer that is genuinely
// reachable from the internet: it must not mint two buckets.
withEnv({ TRUSTED_PROXY_HOPS: "8", TRUSTED_PROXY_PEERS: undefined }, () => {
  const keys = new Set<string>();
  for (let i = 0; i < 50; i++) keys.add(resolveRateLimitClientIp(reqFrom("198.51.100.4", craft(8, `b${i}`))));
  eq([...keys], ["198.51.100.4"], "POLE A: 50 rotated headers from a public peer yield exactly one key");
});

/* ── POLE B — loopback / private peer still resolves the real client ─────── */
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("127.0.0.1", "9.9.9.9, 203.0.113.9")),
    "203.0.113.9",
    "POLE B: loopback peer, hops=1 — real client resolved from the header",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "9.9.9.9, 203.0.113.9")),
    "203.0.113.9",
    "POLE B: RFC1918 10/8 peer, hops=1 — real client resolved",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("172.16.5.4", "203.0.113.9")),
    "203.0.113.9",
    "POLE B: RFC1918 172.16/12 peer, hops=1 — real client resolved",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("192.168.1.1", "203.0.113.9")),
    "203.0.113.9",
    "POLE B: RFC1918 192.168/16 peer, hops=1 — real client resolved",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("::1", "203.0.113.9")),
    "203.0.113.9",
    "POLE B: IPv6 loopback peer, hops=1 — real client resolved",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("::ffff:10.0.0.9", "203.0.113.9")),
    "203.0.113.9",
    "POLE B: IPv4-mapped IPv6 private peer is recognised as private",
  );
  // Two genuinely different clients behind the same trusted proxy still get
  // two buckets — the fix must not collapse legitimate distinct clients.
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "198.51.100.1")) !==
      resolveRateLimitClientIp(reqFrom("10.0.0.9", "198.51.100.2")),
    true,
    "POLE B: distinct real clients behind a trusted proxy keep distinct buckets",
  );
});
withEnv({ TRUSTED_PROXY_HOPS: "8", TRUSTED_PROXY_PEERS: undefined }, () => {
  const chain = Array.from({ length: 9 }, (_, i) => (i === 1 ? "203.0.113.9" : `p${i}`)).join(",");
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", chain)),
    "203.0.113.9",
    "POLE B: private peer, hops=8 — the 8th-from-right entry is still selected",
  );
});

/* ── Boundary: 172.15/172.32 are PUBLIC, not RFC1918 ─────────────────────── */
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  eq(resolveRateLimitClientIp(reqFrom("172.15.0.1", "203.0.113.9")), "172.15.0.1", "172.15/16 is NOT private");
  eq(resolveRateLimitClientIp(reqFrom("172.32.0.1", "203.0.113.9")), "172.32.0.1", "172.32/16 is NOT private");
  eq(resolveRateLimitClientIp(reqFrom("172.16.0.1", "203.0.113.9")), "203.0.113.9", "172.16/16 IS private");
  eq(resolveRateLimitClientIp(reqFrom("172.31.255.254", "203.0.113.9")), "203.0.113.9", "172.31/16 IS private");
  eq(resolveRateLimitClientIp(reqFrom("11.0.0.1", "203.0.113.9")), "11.0.0.1", "11/8 is NOT private");
  eq(resolveRateLimitClientIp(reqFrom("192.169.0.1", "203.0.113.9")), "192.169.0.1", "192.169/16 is NOT private");
});

/* ── Fail-closed edges ───────────────────────────────────────────────────── */
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  eq(
    resolveRateLimitClientIp({ headers: { "x-forwarded-for": "203.0.113.9" }, socket: {}, ip: undefined } as any),
    "unknown",
    "unknown peer is not trusted; header ignored",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("not-an-ip", "203.0.113.9")),
    "not-an-ip",
    "unparseable peer is not trusted; header ignored",
  );
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: "" }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "203.0.113.9")),
    "203.0.113.9",
    "TRUSTED_PROXY_PEERS=\"\" is treated as UNSET, so the defaults still apply",
  );
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  _setTrustedProxyPeerOverride([]);
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "203.0.113.9")),
    "10.0.0.9",
    "an explicitly EMPTY allow-list trusts nobody, including private peers",
  );
  _setTrustedProxyPeerOverride(null);
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: "not-a-cidr,10.0.0.0/99,300.1.2.3" }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "203.0.113.9")),
    "10.0.0.9",
    "malformed allow-list entries never widen trust — private peer no longer trusted",
  );
  eq(isTrustedProxyPeer("127.0.0.1"), false, "a malformed list does not silently fall back to the defaults");
});

/* ── Explicit override REPLACES (does not extend) the defaults ───────────── */
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: "203.0.113.7" }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("203.0.113.7", "198.51.100.9")),
    "198.51.100.9",
    "an explicitly named public proxy IS honoured",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "198.51.100.9")),
    "10.0.0.9",
    "naming a proxy explicitly REPLACES the private-range defaults",
  );
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: "203.0.113.0/24" }, () => {
  eq(resolveRateLimitClientIp(reqFrom("203.0.113.200", "198.51.100.9")), "198.51.100.9", "CIDR allow-list matches");
  eq(resolveRateLimitClientIp(reqFrom("203.0.114.1", "198.51.100.9")), "203.0.114.1", "CIDR allow-list excludes");
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  _setTrustedProxyPeerOverride(["203.0.113.7"]);
  eq(
    resolveRateLimitClientIp(reqFrom("203.0.113.7", "198.51.100.9")),
    "198.51.100.9",
    "the programmatic (DB-driven) override is honoured",
  );
  _setTrustedProxyPeerOverride(null);
});
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: "2001:db8::/32" }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("2001:db8::1", "198.51.100.9")),
    "198.51.100.9",
    "IPv6 CIDR allow-list matches",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("2001:db9::1", "198.51.100.9")),
    "2001:db9::1",
    "IPv6 CIDR allow-list excludes",
  );
});

/* ── PRESERVED: every Wave 19 / Wave 21 behaviour still holds ────────────── */
for (const raw of [undefined, "", "0", "-1", "abc", "9999"] as (string | undefined)[]) {
  withEnv({ TRUSTED_PROXY_HOPS: raw, TRUSTED_PROXY_PEERS: undefined }, () => {
    eq(trustedProxyHopCount(), 0, `PRESERVED: TRUSTED_PROXY_HOPS=${JSON.stringify(raw)} ⇒ 0 hops`);
    eq(
      resolveRateLimitClientIp(reqFrom("10.0.0.9", craft(1, "bucket-A"))),
      "10.0.0.9",
      `PRESERVED: hops=${JSON.stringify(raw)} keys on the socket peer even from a TRUSTED peer`,
    );
  });
}
withEnv({ TRUSTED_PROXY_HOPS: "1", TRUSTED_PROXY_PEERS: undefined }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9")),
    "10.0.0.9",
    "PRESERVED: no header at all ⇒ socket peer",
  );
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "")),
    "10.0.0.9",
    "PRESERVED: empty header ⇒ chain shorter than hops ⇒ socket peer",
  );
});
withEnv({ TRUSTED_PROXY_HOPS: "8", TRUSTED_PROXY_PEERS: undefined }, () => {
  eq(
    resolveRateLimitClientIp(reqFrom("10.0.0.9", "1.1.1.1,2.2.2.2")),
    "10.0.0.9",
    "PRESERVED: chain shorter than the hop count ⇒ socket peer, never the forged prefix",
  );
});

/* ── isTrustedProxyPeer direct unit coverage ─────────────────────────────── */
withEnv({ TRUSTED_PROXY_PEERS: undefined }, () => {
  for (const p of ["127.0.0.1", "127.255.255.254", "10.1.2.3", "172.20.0.1", "192.168.0.1", "::1", "fd00::1", "fe80::1%eth0", "::ffff:127.0.0.1", "[::1]:443", "10.0.0.9:443"]) {
    ok(isTrustedProxyPeer(p), `isTrustedProxyPeer(${p}) must be true`);
  }
  for (const p of ["203.0.113.7", "8.8.8.8", "2001:db8::1", "", "unknown", undefined, null, "0.0.0.0.0", "999.1.1.1"]) {
    ok(!isTrustedProxyPeer(p as any), `isTrustedProxyPeer(${String(p)}) must be false`);
  }
});

if (failures.length > 0) {
  console.error(`FAIL item2_trusted_peer_harness: ${failures.length}/${asserts} asserts failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS item2_trusted_peer_harness: ${asserts} asserts, 0 failures`);
