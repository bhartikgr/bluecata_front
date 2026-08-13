#!/usr/bin/env bash
# scripts/__tests__/coverage_ci_gate_falsify.sh — ITEM C-2 PROVING TEST
#
# RULE OBEYED HERE: a green check you have not falsified is not evidence.
# Every pole is asserted. It is not enough that scripts/coverage_ci_gate.sh
# passes on the real tree; it must FAIL, with the right exit code, on each way
# the thing it guards can actually break. Three of these cases are the exact
# defects D1/D2/D3 documented in the gate's own header, reproduced here so they
# cannot silently come back.
#
# SAFETY: every case runs the gate via SPEC_ROOT against a fresh COPY of spec/
# in a temp dir. The real spec/ tree is sacred (spec/_v8_coverage.py is hash
# pinned in scripts/sacred_check.sh) and is never written. Case Z re-verifies
# that afterwards by hash.
#
#   bash scripts/__tests__/coverage_ci_gate_falsify.sh
#
# Exit 0 = every pole behaved as asserted.  Exit 1 = a pole did not.

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
REAL_SPEC="$(cd "$REPO_ROOT/.." && pwd)/spec"
GATE="$REPO_ROOT/scripts/coverage_ci_gate.sh"

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

# Hash the sacred inputs up front so case Z can prove we did not touch them.
BEFORE_SHA="$(sha256sum "$REAL_SPEC/_v8_coverage.py" "$REAL_SPEC/_v7_coverage_gap_baseline.txt" | sha256sum)"

# Make an isolated copy of the spec inputs the gate reads.
fresh_spec() {
  local d="$TMPROOT/$1"
  rm -rf "$d"; mkdir -p "$d"
  cp "$REAL_SPEC"/_v8_coverage.py \
     "$REAL_SPEC"/_v8_dispositions.tsv \
     "$REAL_SPEC"/_v8_items.tsv \
     "$REAL_SPEC"/_v8_descopes.tsv \
     "$REAL_SPEC"/_v5_register_rows.tsv \
     "$REAL_SPEC"/_v8_coverage_gap_baseline.txt "$REAL_SPEC"/_v8_descope_absorption_baseline.txt "$d"/
  echo "$d"
}

# assert <name> <expected_exit> <spec_dir> [flags...]
assert() {
  local name="$1" want="$2" dir="$3"; shift 3
  local out rc
  out="$(SPEC_ROOT="$dir" bash "$GATE" "$@" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ]; then
    PASS=$((PASS+1)); printf '  ok    %-58s exit=%s\n' "$name" "$rc"
  else
    FAIL=$((FAIL+1)); printf '  NOT OK %-57s exit=%s (wanted %s)\n' "$name" "$rc" "$want"
    echo "$out" | sed 's/^/           | /' | head -14
  fi
  LAST_OUT="$out"
}

# expect the gate's own message to name the failure mode, so a right exit code
# for the wrong reason is still caught.
expect_says() {
  if grep -qi -- "$1" <<<"${LAST_OUT:-}"; then
    PASS=$((PASS+1)); printf '  ok      ...and says %-45s\n' "\"$1\""
  else
    FAIL=$((FAIL+1)); printf '  NOT OK  ...never says %-42s\n' "\"$1\""
  fi
}

echo "=============================================================================="
echo "C-2 FALSIFICATION — coverage_ci_gate.sh must FAIL when it should"
echo "=============================================================================="

echo
echo "CONTROL — an untouched copy must PASS (else every FAIL below is meaningless)"
D="$(fresh_spec control)"
assert "control: pristine spec copy" 0 "$D"
expect_says "RESULT: PASS"

echo
echo "POLE 1 (defect D1) — unknown flags must be FATAL, not silently ignored"
D="$(fresh_spec d1)"
assert "unknown flag --ci-but-typoed" 2 "$D" --ci-but-typoed
expect_says "unknown flag"
assert "unknown flag --totally-bogus-flag" 2 "$D" --totally-bogus-flag
# The contrast that makes this a real finding: the SACRED checker accepts both.
rc_v8_ci=0;  ( cd "$D" && python3 _v8_coverage.py --ci            >/dev/null 2>&1 ) || rc_v8_ci=$?
rc_v8_bog=0; ( cd "$D" && python3 _v8_coverage.py --totally-bogus >/dev/null 2>&1 ) || rc_v8_bog=$?
if [ "$rc_v8_ci" = "0" ] && [ "$rc_v8_bog" = "0" ]; then
  PASS=$((PASS+1))
  echo "  ok    D1 REPRODUCED: _v8_coverage.py --ci exit=$rc_v8_ci, --totally-bogus exit=$rc_v8_bog"
  echo "        (both 0 => --ci was a NO-OP; that is the vacuous green C-2 fixes)"
else
  FAIL=$((FAIL+1)); echo "  NOT OK  D1 did not reproduce (--ci=$rc_v8_ci --bogus=$rc_v8_bog)"
fi

echo
echo "POLE 2 (defect D2) — a MISSING baseline must be FATAL and must NOT self-seed"
D="$(fresh_spec d2)"; rm -f "$D/_v8_coverage_gap_baseline.txt"
assert "baseline deleted" 2 "$D"
expect_says "does NOT self-seed"
if [ -f "$D/_v8_coverage_gap_baseline.txt" ]; then
  FAIL=$((FAIL+1)); echo "  NOT OK  baseline was RECREATED — the gate self-seeded (D2 regression)"
else
  PASS=$((PASS+1)); echo "  ok    baseline was NOT recreated"
fi
# Contrast: the v7 predecessor DOES self-seed and pass.
if [ -f "$REAL_SPEC/_v7_coverage.py" ]; then
  V7="$TMPROOT/v7"; rm -rf "$V7"; mkdir -p "$V7"
  cp "$REAL_SPEC"/_v7_coverage.py "$REAL_SPEC"/_v7_dispositions.tsv \
     "$REAL_SPEC"/_v7_items.tsv "$REAL_SPEC"/_v7_exclusion_classes.tsv \
     "$REAL_SPEC"/_v5_register_rows.tsv "$V7"/ 2>/dev/null
  v7rc=0; ( cd "$V7" && python3 _v7_coverage.py --ci >/dev/null 2>&1 ) || v7rc=$?
  if [ "$v7rc" = "0" ] && [ -f "$V7/_v7_coverage_gap_baseline.txt" ]; then
    PASS=$((PASS+1))
    echo "  ok    D2 REPRODUCED in v7: no baseline -> exit 0 AND wrote $(cat "$V7/_v7_coverage_gap_baseline.txt")"
  else
    FAIL=$((FAIL+1)); echo "  NOT OK  D2 did not reproduce in v7 (exit=$v7rc)"
  fi
fi

echo
echo "POLE 3 (defect D3) — an INFLATED/stale baseline must FAIL, not pass politely"
D="$(fresh_spec d3)"; echo 9999 > "$D/_v8_coverage_gap_baseline.txt"
assert "baseline 9999 vs real gap 0" 1 "$D"
expect_says "STALE BASELINE"

echo
echo "POLE 4 — THE ONE THAT MATTERS: a REAL coverage regression must FAIL"
echo "         (drop a disposition row -> that register row loses its record)"
D="$(fresh_spec d4)"
VICTIM="$(awk -F'\t' 'NR>1 && $1!="id" && NF>1 {print $1; exit}' "$D/_v8_dispositions.tsv")"
grep -v "^${VICTIM}	" "$D/_v8_dispositions.tsv" > "$D/.tmp" && mv "$D/.tmp" "$D/_v8_dispositions.tsv"
echo "         removed disposition for register row: $VICTIM"
assert "one row undispositioned (gap 0 -> 1)" 1 "$D"
expect_says "COVERAGE REGRESSION"
expect_says "$VICTIM"

echo
echo "POLE 5 — a malformed baseline is a BROKEN gate, never a gap of 0"
D="$(fresh_spec d5a)"; : > "$D/_v8_coverage_gap_baseline.txt"
assert "empty baseline file" 2 "$D"
expect_says "not a non-negative integer"
D="$(fresh_spec d5b)"; echo "zero" > "$D/_v8_coverage_gap_baseline.txt"
assert "baseline 'zero' (word, not digits)" 2 "$D"
D="$(fresh_spec d5c)"; printf '0\n0\n' > "$D/_v8_coverage_gap_baseline.txt"
assert "baseline with two lines" 2 "$D"
expect_says "expected exactly one integer"
D="$(fresh_spec d5d)"; echo "-1" > "$D/_v8_coverage_gap_baseline.txt"
assert "baseline '-1' (negative)" 2 "$D"

echo
echo "POLE 6 — semantic-gate tampering must propagate as 2, never become a number"
D="$(fresh_spec d6a)"   # H1: duplicate disposition id
head -2 "$D/_v8_dispositions.tsv" | tail -1 >> "$D/_v8_dispositions.tsv"
assert "H1 duplicate disposition id" 2 "$D"
expect_says "tampering signal"
# _v8_dispositions.tsv columns are 1=id 2=category 3=kind 4=target
# 5=acceptance_test 6=reason. Verified from the header, not assumed: an earlier
# draft of this harness wrote $3 and the pole PASSED-when-it-should-FAIL, which
# looked exactly like an H2 hole in the sacred checker and was in fact this
# test lying. Assert the column layout so the mutation cannot drift off target.
HDR="$(head -1 "$REAL_SPEC/_v8_dispositions.tsv")"
if [ "$HDR" = "$(printf 'id\tcategory\tkind\ttarget\tacceptance_test\treason')" ]; then
  PASS=$((PASS+1)); echo "  ok    disposition column layout is as this harness assumes"
else
  FAIL=$((FAIL+1)); echo "  NOT OK  disposition header changed: $HDR — mutations below may hit the wrong column"
fi

D="$(fresh_spec d6b)"   # H2: phantom target (column 4)
awk -F'\t' 'BEGIN{OFS="\t"} NR==2 && $1!="id" {$4="ITEM-DOES-NOT-EXIST"} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.tmp" && mv "$D/.tmp" "$D/_v8_dispositions.tsv"
assert "H2 phantom disposition target" 2 "$D"
expect_says "phantom target"

D="$(fresh_spec d6d)"   # H4: the same reason text reused across rows
R2="$(sed -n '2p' "$D/_v8_dispositions.tsv" | cut -f6)"
awk -F'\t' -v r="$R2" 'BEGIN{OFS="\t"} NR==3 && $1!="id" {$6=r} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.tmp" && mv "$D/.tmp" "$D/_v8_dispositions.tsv"
assert "H4 boilerplate reason reused across two rows" 2 "$D"
expect_says "reason text reused"

D="$(fresh_spec d6e)"   # H6: a forbidden disposition word as an outcome
awk -F'\t' 'BEGIN{OFS="\t"} NR==2 && $1!="id" {$3="deferred"} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.tmp" && mv "$D/.tmp" "$D/_v8_dispositions.tsv"
assert "H6 disposition kind='deferred' (no such bucket in v8)" 2 "$D"
expect_says "forbidden disposition"
D="$(fresh_spec d6c)"   # register row count changed under us
head -100 "$D/_v5_register_rows.tsv" > "$D/.tmp" && mv "$D/.tmp" "$D/_v5_register_rows.tsv"
assert "register truncated to 100 rows" 2 "$D"

echo
echo "POLE 7 — a missing checker must be FATAL, not an absent-and-therefore-fine"
echo "         (the DA-3 collectFencedPaths pattern: missing input != pass)"
D="$(fresh_spec d7)"; rm -f "$D/_v8_coverage.py"
assert "coverage checker deleted" 2 "$D"
expect_says "coverage checker missing"
D="$(fresh_spec d7b)"; rm -f "$D/_v5_register_rows.tsv"
assert "register deleted" 2 "$D"

echo
echo "POLE Z — the real, sacred spec/ tree must be byte-identical afterwards"
AFTER_SHA="$(sha256sum "$REAL_SPEC/_v8_coverage.py" "$REAL_SPEC/_v7_coverage_gap_baseline.txt" | sha256sum)"
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  PASS=$((PASS+1)); echo "  ok    sacred spec inputs unchanged by this harness"
else
  FAIL=$((FAIL+1)); echo "  NOT OK  THIS HARNESS MUTATED THE SACRED TREE"
fi

echo
echo "=============================================================================="
printf 'C-2 FALSIFICATION: %d assertions passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" = "0" ]; then
  echo "Every pole asserted. The gate fails on: unknown flags, missing baseline,"
  echo "stale baseline, malformed baseline, a real undispositioned row, H1/H2"
  echo "tampering, a truncated register, and missing inputs. It passes only on a"
  echo "pristine tree. D1/D2/D3 are reproduced against the predecessors."
  echo "=============================================================================="
  exit 0
fi
echo "=============================================================================="
exit 1
