#!/usr/bin/env python3
"""
WAVE 18 — falsification harness for W-4 (failed SPV load vs empty portfolio).

Each mutation reverts one part of the distinction between "your fetch failed"
and "you have no vehicles". The suite that claims to cover it must go RED.

Run from the repo root:  python3 scripts/w18/falsify_w4.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SUITE = "client/src/pages/partner/__tests__/wave18_w4_spv_empty_vs_failed.test.tsx"
XT7_SUITE = "client/src/lib/__tests__/wave18_xt7_partner_stream_scope.test.tsx"

PAGE = ROOT / "client/src/pages/partner/PartnerSpvEngine.tsx"

FILES = [PAGE]


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
        # The pre-fix condition, restored verbatim.
        "page: gate the empty state on !isLoading only (a failed load reads as zero vehicles)",
        SUITE,
        PAGE,
        "{!list.isLoading && !list.isError && list.isSuccess && spvs.length === 0 && (",
        "{!list.isLoading && spvs.length === 0 && (",
    ),
    (
        "page: drop isSuccess from the gate (an idle/paused query renders 'No SPVs yet')",
        SUITE,
        PAGE,
        "!list.isError && list.isSuccess && spvs.length === 0",
        "!list.isError && spvs.length === 0",
    ),
    (
        "page: stop rendering the failure at all (silent absence)",
        SUITE,
        PAGE,
        "      {list.isError && (",
        "      {false && list.isError && (",
    ),
    (
        "page: the failure carries no retry",
        SUITE,
        PAGE,
        '            onClick={() => list.refetch()}',
        "            onClick={() => undefined}",
    ),
    (
        "page: the failure is not announced (role=alert removed)",
        SUITE,
        PAGE,
        '          role="alert"\n          data-testid="spv-engine-error"',
        '          data-testid="spv-engine-error"',
    ),
    (
        "page: the failure claims a count (a fabricated zero in the refusal copy)",
        SUITE,
        PAGE,
        "            Nothing has been changed. This is a loading failure, not an empty portfolio —",
        "            You have 0 SPVs. This is a loading failure, not an empty portfolio —",
    ),
    (
        "page: render the list even while the query is in error (stale rows presented as current)",
        SUITE,
        PAGE,
        "      {spvs.length > 0 && (\n        <div className=\"space-y-2 mt-4\" data-testid=\"spv-engine-list\">",
        "      {(spvs.length > 0 || list.isError) && (\n        <div className=\"space-y-2 mt-4\" data-testid=\"spv-engine-list\">",
    ),
    (
        "fence: the XT-7 subscription on this same page is still live",
        XT7_SUITE,
        PAGE,
        '  useCollectiveStream({\n    chapterId: "",\n    scope: "partner",',
        '  /* useCollectiveStream({\n    chapterId: "",\n    scope: "partner",',
    ),
]


def main() -> int:
    snap = snapshot()
    suites = (SUITE, XT7_SUITE)
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
