#!/usr/bin/env bash
#
# v23.4.8 Phase 4 — Avi-preserved hand-edit CI guard.
#
# Avi's permanent hash-link fix (replacing href="#/path" and
# https://capavate.com/#/path with path-routed equivalents) lives in
# client/src/components/home3compo/*.jsx. This script asserts that no
# subsequent edit reintroduces a hash-link regression.
#
# Exit 0 → no regressions.
# Exit 1 → hash-link regressions present. See AVI_HAND_EDITS_INVENTORY.md
#          for the sed pattern to reapply Avi's fix.
#
set -e
cd "$(dirname "$0")/.."
echo "Checking Avi-preserved hash links..."
HITS=$(grep -rn 'href="#/\|"https://capavate.com/#/' client/src/components/home3compo/ 2>&1 | wc -l)
if [ "$HITS" -ne "0" ]; then
  echo "FAIL: $HITS hash-link regressions detected in home3compo/. Run the sed fix in AVI_HAND_EDITS_INVENTORY.md."
  exit 1
fi
echo "PASS: no Avi-preserved-edit regressions"
