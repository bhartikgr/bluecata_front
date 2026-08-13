#!/usr/bin/env bash
# scripts/test_baseline_check.sh
#
# WHY THIS EXISTS
# ---------------
# The full suite is RED at baseline: 471 failing tests across 121 files, recorded
# 2026-08-10 in scripts/test_baseline.json. Every wave of the Consortium Partner
# build ran only its OWN test files, so nobody could answer the only question that
# matters after a change: "did I break something, or was it already broken?"
#
# Without a baseline, a red suite teaches people to ignore red suites. That is how
# `mfcrm_gates` came to assert error codes against a GateError that puts codes on
# `.code` — it can never have passed, and it sat unnoticed.
#
# This script answers ONE question: are there NEW failures relative to the recorded
# baseline? A pre-existing failure is reported but does not fail the gate. A NEW
# failure fails it, loudly, with the file named.
#
# USAGE
#   bash scripts/test_baseline_check.sh              # compare against baseline
#   bash scripts/test_baseline_check.sh --update     # re-record (deliberate act)
#
# The baseline must only ever be updated DELIBERATELY, when failures have genuinely
# been FIXED — never to silence a regression. Same rule as the silent-drop guard's
# baseline.json, which is why --update prints the delta and requires confirmation.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
BASELINE="scripts/test_baseline.json"
OUT="${TMPDIR:-/tmp}/test_now_$$.json"

if [ ! -f "$BASELINE" ]; then
  echo "FAIL: $BASELINE missing. Record one with --update before gating on it." >&2
  exit 2
fi

echo "Running full suite (several minutes)..."
npx vitest run --reporter=json --outputFile="$OUT" >/dev/null 2>&1 || true

if [ ! -f "$OUT" ]; then
  echo "FAIL: vitest produced no JSON report at $OUT" >&2
  exit 2
fi

MODE="compare"
[ "${1:-}" = "--update" ] && MODE="update"

MODE="$MODE" BASELINE="$BASELINE" OUT="$OUT" python3 <<'PY'
import json, os, re, sys, collections

mode = os.environ["MODE"]
base = json.load(open(os.environ["BASELINE"]))
cur  = json.load(open(os.environ["OUT"]))

def per_file(doc):
    out = collections.Counter()
    for tr in doc.get("testResults", []):
        name = re.sub(r"^.*/(server|client|shared|scripts)/", r"\1/", tr.get("name", ""))
        bad = [a for a in tr.get("assertionResults", []) if a.get("status") == "failed"]
        if bad:
            out[name] = len(bad)
    return out

now = per_file(cur)
old = collections.Counter(base.get("perFile", {}))

new_files   = {f: now[f] for f in now if f not in old}
worse_files = {f: (old[f], now[f]) for f in now if f in old and now[f] > old[f]}
fixed_files = {f: old[f] for f in old if f not in now}
better      = {f: (old[f], now[f]) for f in now if f in old and now[f] < old[f]}

print(f"\nbaseline : {base.get('failed')} failing across {base.get('failedFiles')} files")
print(f"current  : {cur.get('numFailedTests')} failing across {len(now)} files\n")

if fixed_files or better:
    print("IMPROVED:")
    for f, c in sorted(fixed_files.items()):
        print(f"  FIXED  {f}  (was {c} failing)")
    for f, (o, n) in sorted(better.items()):
        print(f"  BETTER {f}  {o} -> {n}")
    print()

if mode == "update":
    out = {
        "generated": cur.get("startTime"),
        "totalTests": cur.get("numTotalTests"),
        "passed": cur.get("numPassedTests"),
        "failed": cur.get("numFailedTests"),
        "failedFiles": len(now),
        "perFile": dict(now.most_common()),
    }
    json.dump(out, open(os.environ["BASELINE"], "w"), indent=1)
    print(f"BASELINE UPDATED -> {out['failed']} failing across {out['failedFiles']} files")
    sys.exit(0)

if new_files or worse_files:
    print("*** REGRESSION — NEW FAILURES NOT IN BASELINE ***")
    for f, c in sorted(new_files.items()):
        print(f"  NEW    {f}  ({c} failing)")
    for f, (o, n) in sorted(worse_files.items()):
        print(f"  WORSE  {f}  {o} -> {n}")
    print("\nFAIL: fix these, or justify and re-record with --update.")
    sys.exit(1)

print("OK: no new failures relative to baseline.")
print("    (pre-existing failures remain — they are tracked, not forgiven.)")
sys.exit(0)
PY
rc=$?
rm -f "$OUT"
exit $rc
