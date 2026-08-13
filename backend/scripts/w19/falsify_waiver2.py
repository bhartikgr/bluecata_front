#!/usr/bin/env python3
"""
WAVE 19 — falsification harness for WAIVER-2 / CP-MSG-05.

Every mutation below reverts one load-bearing part of the fix, or of the
correction to the record, and the suites that claim to cover it must go RED.

Unlike Wave 18's harness, this one DOES mutate `server/lib/rateLimit.ts`: the
owner granted an edit waiver for that file, so the limiter's own behaviour can
finally be falsified by mutation rather than only pinned by a hash fence. Every
mutation is reverted and the tree is verified byte-identical at the end,
including the sacred hash.

Run from the repo root:  python3 scripts/w19/falsify_waiver2.py
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

W19_SUITE = "server/__tests__/wave19_waiver2_ratelimit_key.test.ts"
W18_SUITE = "server/__tests__/wave18_cpmsg05_rate_limit_identity.test.ts"
LEGACY_SUITE = "server/__tests__/rateLimit.test.ts"
AUTH_SUITE = "server/__tests__/authRateLimit.test.ts"

RL = ROOT / "server/lib/rateLimit.ts"
ROUTES = ROOT / "server/routes.ts"
SACRED = ROOT / "scripts/sacred_check.sh"

FILES = [RL, ROUTES, SACRED]


def run(suite: str):
    p = subprocess.run(["npx", "vitest", "run", suite], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    m = re.search(r"Tests\s+(\d+) failed\b", out)
    if m:
        return int(m.group(1)), 0
    if "No test files found" in out:
        return -1, -1
    return 999, 0


def sacred_gate():
    p = subprocess.run(["bash", "scripts/sacred_check.sh"], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr).strip().splitlines()[-1] if (p.stdout or p.stderr) else ""


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


# (label, suite, file, old, new)
#
# Each `old` is anchored on text UNIQUE to the function being mutated. Wave 18
# lost a mutation to a tail that three functions in this same file share, so
# uniqueness is asserted programmatically below rather than eyeballed.
MUTATIONS = [
    (
        "clientKey trusts the raw header again (the original defect, restored)",
        W19_SUITE,
        RL,
        '  return `ip:${resolveRateLimitClientIp(req)}`;\n}\n\nfunction tick(',
        '  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();\n'
        '  return `ip:${fwd || req.ip || "unknown"}`;\n}\n\nfunction tick(',
    ),
    (
        "authIpKey trusts the raw header again (the THIRD path)",
        W19_SUITE,
        RL,
        "function authIpKey(req: Request): string {\n  return `auth-ip:${resolveRateLimitClientIp(req)}`;\n}",
        'function authIpKey(req: Request): string {\n'
        '  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();\n'
        '  return `auth-ip:${fwd || req.ip || "unknown"}`;\n}',
    ),
    (
        "the auth-spray throttle regresses but the collective one does not (path isolation)",
        AUTH_SUITE,
        RL,
        "function authIpKey(req: Request): string {\n  return `auth-ip:${resolveRateLimitClientIp(req)}`;\n}",
        'function authIpKey(req: Request): string {\n'
        '  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();\n'
        '  return `auth-ip:${fwd || req.ip || "unknown"}`;\n}',
    ),
    (
        "trust becomes the DEFAULT instead of opt-in (fail OPEN)",
        W19_SUITE,
        RL,
        '  const raw = (process.env.TRUSTED_PROXY_HOPS ?? "").trim();\n  if (!/^\\d+$/.test(raw)) return 0;',
        '  const raw = (process.env.TRUSTED_PROXY_HOPS ?? "1").trim();\n  if (!/^\\d+$/.test(raw)) return 1;',
    ),
    (
        "junk trust config silently means 'trust one hop'",
        W19_SUITE,
        RL,
        '  if (!/^\\d+$/.test(raw)) return 0;\n  const n = Number.parseInt(raw, 10);\n  if (!Number.isFinite(n) || n <= 0) return 0;',
        '  const n = Number.parseInt(raw, 10);\n  if (!Number.isFinite(n) || n <= 0) return 1;',
    ),
    (
        "the hop clamp is removed (walk off the chain into forged text)",
        W19_SUITE,
        RL,
        "  return Math.min(n, MAX_TRUSTED_PROXY_HOPS);",
        "  return n;",
    ),
    (
        "the resolver takes the LEFTMOST forwarded entry (the classic wrong reading)",
        W19_SUITE,
        RL,
        "  const idx = addresses.length - 1 - hops;\n  if (idx < 0) return socketIp;",
        "  const idx = 0;\n  if (idx < 0) return socketIp;",
    ),
    (
        "a chain SHORTER than the hop count reaches into the forged prefix",
        W19_SUITE,
        RL,
        "  if (idx < 0) return socketIp;\n  return addresses[idx] || socketIp;",
        "  return addresses[Math.max(0, idx)] || socketIp;",
    ),
    (
        "the over-correction: every anonymous caller keyed to one constant",
        W19_SUITE,
        RL,
        "  const socketIp = (req as any).socket?.remoteAddress || req.ip || \"unknown\";",
        "  const socketIp = \"unknown\";",
    ),
    (
        "the per-USER branch is removed (would re-create Wave 18's reported defect for real)",
        W18_SUITE,
        RL,
        '  const userId = (req as any).user?.id || (req as any).userContext?.userId || "";\n  if (userId) return `u:${userId}`;',
        '  const userId = "";\n  if (userId) return `u:${userId}`;',
    ),
    (
        "loadUserContext moves AFTER the limiter mounts (the ordering the fix depends on)",
        W19_SUITE,
        ROUTES,
        "  app.use(loadUserContext);",
        "  /* mutated: registration moved */",
    ),
    (
        "the WRITE limit is quietly loosened",
        W19_SUITE,
        RL,
        "const WRITE_LIMIT = 10;",
        "const WRITE_LIMIT = 1000;",
    ),
    (
        "the collective write bucket is quietly loosened",
        W19_SUITE,
        RL,
        "  write: 60,",
        "  write: 6000,",
    ),
    (
        "the login-spray limit is quietly loosened",
        AUTH_SUITE,
        RL,
        "const AUTH_LOGIN_LIMIT = 10;        // per IP / minute",
        "const AUTH_LOGIN_LIMIT = 10000;        // per IP / minute",
    ),
    (
        "health probes stop being exempt",
        W19_SUITE,
        RL,
        "function isBypassed(req: Request): boolean {",
        "function isBypassed(req: Request): boolean {\n  if (1) return false;",
    ),
    (
        "the 429 stops carrying a retry hint (a refusal with no way back)",
        W19_SUITE,
        RL,
        "    res.status(429).json({\n      error: \"rate_limited\",\n      bucket,\n      retryAfterMs: r.resetAt - Date.now(),\n    });",
        "    res.status(429).json({ error: \"rate_limited\", bucket });",
    ),
    (
        "the WAIVER-2 sacred re-freeze is reverted to the pre-fix hash",
        W18_SUITE,
        SACRED,
        "cda4a32e7fb52969f5a78a6b40c5a154adff6b2514fa00785de2aa69dd3951e8",
        "50abd00004a5f09722a5a75bf4152ee0fa2ab37f6706450601d8f444d8460124",
    ),
    (
        "the waiver erases the pre-waiver hash instead of keeping it as evidence",
        W18_SUITE,
        SACRED,
        '"server/lib/rateLimit.ts|50abd00004a5f09722a5a75bf4152ee0fa2ab37f6706450601d8f444d8460124|cda4a32e',
        '"server/lib/rateLimit.ts|cda4a32e7fb52969f5a78a6b40c5a154adff6b2514fa00785de2aa69dd3951e8|cda4a32e',
    ),
]


def main():
    snap = snapshot()
    pre_hashes = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in FILES}

    # Uniqueness fence — Wave 18 lost a mutation to a shared tail.
    bad = []
    for label, _suite, path, old, _new in MUTATIONS:
        n = path.read_text().count(old)
        if n != 1:
            bad.append(f"  anchor for {label!r} occurs {n}x in {path.name} (must be exactly 1)")
    if bad:
        print("ANCHOR FENCE FAILED — a mutation would hit the wrong site:")
        print("\n".join(bad))
        return 2

    print("=== baseline ===")
    baselines = {}
    for suite in [W19_SUITE, W18_SUITE, LEGACY_SUITE, AUTH_SUITE]:
        f, p = run(suite)
        baselines[suite] = (f, p)
        print(f"  {suite}: {f} failed / {p} passed")
        if f != 0 or p <= 0:
            print("BASELINE NOT GREEN — aborting.")
            restore(snap)
            return 2
    rc, line = sacred_gate()
    print(f"  sacred: rc={rc} {line}")
    if rc != 0:
        restore(snap)
        return 2

    detected, missed = 0, []
    for i, (label, suite, path, old, new) in enumerate(MUTATIONS, 1):
        text = path.read_text()
        path.write_text(text.replace(old, new, 1))
        if path is SACRED:
            rc, _ = sacred_gate()
            # A sacred-manifest mutation must be caught by the suite's fence.
            f, p = run(suite)
        else:
            f, p = run(suite)
        restore(snap)
        ok = f > 0
        if ok:
            detected += 1
        else:
            missed.append(label)
        print(f"[{i:2}/{len(MUTATIONS)}] {'DETECTED' if ok else 'MISSED  '}  {label}  ({f} failed / {p} passed)")

    restore(snap)
    post_hashes = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in FILES}
    clean = pre_hashes == post_hashes
    rc, line = sacred_gate()
    print()
    print(f"RESULT: {detected}/{len(MUTATIONS)} detected")
    print(f"tree restored byte-identically: {clean}")
    print(f"sacred gate after restore: rc={rc} {line}")
    if missed:
        print("MISSED:")
        for m in missed:
            print(f"  - {m}")
    return 0 if (detected == len(MUTATIONS) and clean and rc == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
