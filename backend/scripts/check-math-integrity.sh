#!/usr/bin/env bash
# Sprint 12 C2 — Math integrity lock.
# Runs only the math-critical test suites; if ANY of these fail, the build is blocked.
# Cap-table + round-management math integrity is paramount and must never regress.

set -euo pipefail

cd "$(dirname "$0")/.."

# Math-critical test paths (all under packages/cap-table-engine + select server tests):
MATH_PATTERNS=(
  "packages/cap-table-engine/test/golden-master"
  "packages/cap-table-engine/test/property"
  "packages/cap-table-engine/test/ledger"
  "packages/cap-table-engine/test/reconcile"
  "server/__tests__/captableCommit.test.ts"
  # Sprint 14 D9 — dual-engine reconcile gate expansion (term-sheet, conversion,
  # pro-rata, anti-dilution, ESOP refresh, IRR/MOIC/TVPI/DPI portfolio).
  "packages/math-fns/test/reconcile.test.ts"
)

echo "===> Sprint 12 Math Integrity Lock"
echo "Running ${#MATH_PATTERNS[@]} math-critical test groups..."
echo ""

# Build a combined regex of the test paths for vitest's filter
FILTER=$(printf "|%s" "${MATH_PATTERNS[@]}")
FILTER=${FILTER:1}

if npx vitest run --reporter=default ${MATH_PATTERNS[@]}; then
  echo ""
  echo "===> OK — Math integrity preserved."
  exit 0
else
  echo ""
  echo "===> FAIL — Math integrity REGRESSED. Build is blocked."
  echo "Cap-table or round-management math has changed in a way that breaks golden masters,"
  echo "property invariants, ledger replay, or reconciliation. Fix before merging."
  exit 1
fi
