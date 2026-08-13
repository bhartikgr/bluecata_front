#!/usr/bin/env bash
# WAVE 23 — baseline attribution.
#
# `scripts/test_baseline_check.sh` flags files as NEW/WORSE against a RECORDED
# baseline. That baseline is stale in this tree, which means "NEW" does not by
# itself mean "Wave 23 broke it". Rather than re-record with `--update` (which
# the brief forbids, and which would destroy the evidence), this script settles
# attribution the only honest way: run each flagged file in BOTH trees and diff
# the failing test names.
#
#   WORK    /home/user/workspace/work            (Wave 23)
#   BEFORE  /home/user/workspace/finalA/install  (the tree FINAL REVIEW A read)
#
# A file whose failing-test set is IDENTICAL in both trees was not broken by
# Wave 23. A file that fails in WORK but not in BEFORE is a real regression.
set -uo pipefail

WORK=/home/user/workspace/work
BEFORE=/home/user/workspace/finalA/install
OUT=/tmp/w23_attribution

FILES=(
  "client/src/components/__tests__/PostsFeed.partnerBasePath.test.ts"
  "server/__tests__/wave15_notification_prefs.test.ts"
  "server/__tests__/wave3b_mc1_cent_conservation.test.ts"
  "server/__tests__/wave4a_rs_restorations.test.ts"
  "server/__tests__/waveW10_guard_dead_router_exclusion.test.ts"
  "server/__tests__/wfix1e_spv_core.test.ts"
  "server/__tests__/sprint12.test.ts"
  "server/__tests__/wave0_2_strict_check_conventions_lint.test.ts"
  "server/__tests__/wave0_3_ledger_primitives_lint.test.ts"
  "server/__tests__/wave0_9_program_wide_replace_lint.test.ts"
  "server/__tests__/waveB_retirement_guard.test.ts"
)

mkdir -p "$OUT"
regressions=0

for f in "${FILES[@]}"; do
  safe="${f//\//_}"
  (cd "$WORK"   && npx vitest run "$f" 2>&1 | grep "^ FAIL" | sed 's/^ FAIL  //' | sort -u) > "$OUT/work_$safe.txt"
  (cd "$BEFORE" && npx vitest run "$f" 2>&1 | grep "^ FAIL" | sed 's/^ FAIL  //' | sort -u) > "$OUT/before_$safe.txt"
  # Failures present in WORK but NOT in BEFORE are the only ones Wave 23 owns.
  new="$(comm -13 "$OUT/before_$safe.txt" "$OUT/work_$safe.txt")"
  nw=$(wc -l < "$OUT/work_$safe.txt")
  nb=$(wc -l < "$OUT/before_$safe.txt")
  if [ -n "$new" ]; then
    echo "REGRESSION  $f  (before=$nb work=$nw)"
    echo "$new" | sed 's/^/              + /'
    regressions=$((regressions+1))
  else
    echo "pre-existing $f  (before=$nb work=$nw)"
  fi
done

echo
if [ "$regressions" -eq 0 ]; then
  echo "ATTRIBUTION: OK — every baseline-flagged file fails identically (or better) in the pre-Wave-23 tree."
  exit 0
fi
echo "ATTRIBUTION: $regressions FILE(S) GENUINELY REGRESSED BY WAVE 23."
exit 1
