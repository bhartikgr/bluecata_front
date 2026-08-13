#!/usr/bin/env bash
# WAVE 3F — mutation matrix. Each mutation reverts ONE of the five fixes in the
# artifact's own source, runs the test that is supposed to catch it, and asserts
# the test FAILS. Any mutation whose test still passes is a hole in the wave.
# The source file is restored from a backup after every mutation.
set -u
cd "$(dirname "$0")/.."
PASS=0; HOLES=0

mutate() {
  local id="$1" file="$2" from="$3" to="$4" test="$5" grepfor="$6"
  cp "$file" "/tmp/w3f_mut_backup"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
from pathlib import Path
p, frm, to = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
s = p.read_text()
if frm not in s:
    sys.stderr.write("MUTATION ANCHOR NOT FOUND\n"); sys.exit(2)
p.write_text(s.replace(frm, to, 1))
PY
  if [ $? -ne 0 ]; then echo "$id  ANCHOR-MISSING"; cp /tmp/w3f_mut_backup "$file"; HOLES=$((HOLES+1)); return; fi
  out="$(npx vitest run "$test" 2>&1)"
  cp /tmp/w3f_mut_backup "$file"
  if echo "$out" | grep -q "$grepfor"; then
    echo "$id  CAUGHT   (test failed as required)"; PASS=$((PASS+1))
  else
    echo "$id  HOLE     (test still passed under mutation)"; HOLES=$((HOLES+1))
  fi
}

# ── M1 / ITEM 1 — widen-back: run the money writes OUTSIDE the outer tx. ──────
mutate "M1 ITEM1 atomicity      " \
  server/spvEngineStore.ts \
  '      recorded = withSettlementTransaction((): SpvDistributionDTO => {' \
  '      recorded = ((): SpvDistributionDTO => {' \
  server/__tests__/wave3f_item1_atomicity.test.ts \
  "Tests.*failed"

# ── M2 / ITEM 2 — reinstate a hardcoded tier fallback instead of failing closed.
mutate "M2 ITEM2 tier fail-close" \
  server/lib/partnerTierResolver.ts \
  '  const tier = durable ?? canonical;
  if (!tier) {' \
  '  const tier = durable ?? canonical ?? ("catalyst" as PartnerTier);
  if (!tier) {' \
  server/__tests__/wave3f_review_gate2.test.ts \
  "Tests.*failed"

# ── M3 / ITEM 3 — make the over-cap config rejection non-blocking again. ──────
mutate "M3 ITEM3 A-16 blocking  " \
  server/spvEngineStore.ts \
  'if (!opts.__unsafeSeedOverCapForTests) throw new Error("COMBINED_CARRY_EXCEEDS_CAP");' \
  'if (false && !opts.__unsafeSeedOverCapForTests) throw new Error("COMBINED_CARRY_EXCEEDS_CAP");' \
  server/__tests__/wave3b_mc1_cent_conservation.test.ts \
  "Tests.*failed"

# ── M4 / ITEM 4 — swallow the failure again: never record the pending bill. ───
mutate "M4 ITEM4 durable billing" \
  server/lib/spvEngineDeploymentFeeHook.ts \
  '  openBillingRecord(raw, spvId, partnerId);' \
  '  if (false) openBillingRecord(raw, spvId, partnerId);' \
  server/__tests__/wave3f_review_gate2.test.ts \
  "Tests.*failed"

# ── M5 / ITEM 5 — put the forbidden percent guess back. ──────────────────────
mutate "M5 ITEM5 percent guess  " \
  client/src/lib/engineDemo.ts \
  '  if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidDiscountWireValueError(securityId, raw);
  return n;' \
  '  if (!Number.isFinite(n)) throw new InvalidDiscountWireValueError(securityId, raw);
  return n > 1 ? n / 100 : n;' \
  server/__tests__/wave3f_review_gate2.test.ts \
  "Tests.*failed"

# -- M6 / ITEM 4 -- remove ALL THREE deployment-fee idempotency layers at once.
# Removing any ONE of them is deliberately NOT observable (they are redundant on
# purpose), so the honest mutation knocks out all three; see the docstring in
# scripts/w3f_mutate_m6.py. With all three gone a retry double-charges and
# W3F-4C must fail.
python3 scripts/w3f_mutate_m6.py apply
out="$(npx vitest run server/__tests__/wave3f_review_gate2.test.ts 2>&1)"
python3 scripts/w3f_mutate_m6.py revert
if echo "$out" | grep -q "Tests.*failed"; then
  echo "M6 ITEM4 retry idempotent CAUGHT   (test failed as required)"; PASS=$((PASS+1))
else
  echo "M6 ITEM4 retry idempotent HOLE     (test still passed under mutation)"; HOLES=$((HOLES+1))
fi

echo "----"
echo "mutations caught: $PASS   holes: $HOLES"
[ "$HOLES" -eq 0 ]
