#!/usr/bin/env python3
"""
WAVE 18 — falsification harness for CP-MSG-05 (messaging rate limiting).

Each mutation reverts one load-bearing part of the item: the identity used for
the bucket key, the fall-through order, the mount points, the cookie shim
ordering fence, and the rendered 429 on the partner Messages page. The suites
that claim to cover it must go RED.

Run from the repo root:  python3 scripts/w18/falsify_cpmsg05.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_SUITE = "server/__tests__/wave18_cpmsg05_rate_limit_identity.test.ts"
CLIENT_SUITE = "client/src/pages/partner/__tests__/wave18_cpmsg05_rate_limited_render.test.tsx"
LEGACY_SUITE = "server/__tests__/rateLimit.test.ts"  # kept green, not mutated

RL = ROOT / "server/lib/rateLimit.ts"
ROUTES = ROOT / "server/routes.ts"
INDEX = ROOT / "server/index.ts"
MSGPAGE = ROOT / "client/src/pages/partner/PartnerMessages.tsx"

# `server/lib/rateLimit.ts` (RL) is SACRED — sacred_baseline/SACRED_SHA256.txt.
# It is imported for path reference only and is NEVER written by this harness:
# a sacred file must not be mutated even transiently, so the limiter's own
# behaviour is fenced by the SACRED FENCE + FROZEN DEFECT tests in the suite
# instead of by mutation. Mutable sinks are the mounts, the cookie-parser
# ordering, and the page that renders the refusal.
FILES = [ROUTES, INDEX, MSGPAGE]


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


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


# (label, suite, file, old, new)
MUTATIONS = [
    (
        "routes: unmount the limiter from /api/messages (the messaging surface loses MSG-05)",
        SERVER_SUITE,
        ROUTES,
        'app.use("/api/messages", collectiveRateLimit);',
        "/* app.use messages limiter removed */",
    ),
    (
        "routes: unmount the limiter from /api/partner",
        SERVER_SUITE,
        ROUTES,
        'app.use("/api/partner", collectiveRateLimit);',
        "/* app.use partner limiter removed */",
    ),
    (
        # Ordering alone reintroduces the whole defect: no req.cookies at limiter
        # time means no identity, means the IP bucket again.
        "index: register routes BEFORE the cookie parser (identity invisible to the limiter)",
        SERVER_SUITE,
        INDEX,
        "    r.cookies = out;",
        "    r.cookiesLater = out;",
    ),
    (
        "page: swallow the 429 into the generic failure toast (no rendered state)",
        CLIENT_SUITE,
        MSGPAGE,
        "      if (e instanceof ApiError && e.status === 429) {",
        "      if (false && e instanceof ApiError && e.status === 429) {",
    ),
    (
        "page: never render the banner even when the state is set",
        CLIENT_SUITE,
        MSGPAGE,
        "      {rateLimitedUntil !== null && (",
        "      {false && rateLimitedUntil !== null && (",
    ),
    (
        "page: invent a countdown when the server sent no retryAfterMs",
        CLIENT_SUITE,
        MSGPAGE,
        "        setRateLimitedUntil(ms === null ? 0 : Date.now() + ms);",
        "        setRateLimitedUntil(Date.now() + (ms ?? 60_000));",
    ),
    (
        "page: leave the banner up after a send succeeds (a stale refusal)",
        CLIENT_SUITE,
        MSGPAGE,
        "      setRateLimitedUntil(null);",
        "      /* keep the banner */;",
    ),
]


def main() -> int:
    snap = snapshot()
    suites = (SERVER_SUITE, CLIENT_SUITE, LEGACY_SUITE)  # all three must stay green
    print("baseline …", flush=True)
    base = {}
    for suite in suites:
        f, p = run(suite)
        base[suite] = (f, p)
        print(f"  {suite}: {f} failed / {p} passed")
        if f != 0 or p <= 0:
            print("ABORT — a suite is not green before mutation.")
            return 1

    results = []
    for label, suite, path, old, new in MUTATIONS:
        text = path.read_text()
        if old not in text:
            restore(snap)
            print(f"  !! ANCHOR NOT FOUND  ·  {label}")
            results.append((label, None))
            continue
        path.write_text(text.replace(old, new, 1))
        f, p = run(suite)
        restore(snap)
        verdict = "DETECTED" if f not in (0, -1) else "MISSED  "
        print(f"  {verdict}  {f} failed / {p} passed  ·  {label}", flush=True)
        results.append((label, f))

    print("\nrestoring and re-running clean …", flush=True)
    restore(snap)
    ok = True
    for suite in suites:
        f, p = run(suite)
        print(f"  after restore {suite}: {f} failed / {p} passed")
        if f != 0 or p != base[suite][1]:
            ok = False

    missed = [l for l, ff in results if ff is None or ff in (0, -1)]
    if missed:
        print("\nMUTATIONS NOT DETECTED:")
        for l in missed:
            print("  -", l)
        return 2
    if not ok:
        print("\nTREE NOT RESTORED CLEANLY")
        return 3
    print(f"\nALL {len(results)} MUTATIONS DETECTED · tree restored · suites green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
