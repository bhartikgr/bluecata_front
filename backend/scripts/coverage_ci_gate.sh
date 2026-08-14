#!/usr/bin/env bash
# scripts/coverage_ci_gate.sh — ITEM C-2
#
# "Coverage checker semantic gates plus CI non-regression against the
#  checked-in gap baseline."   (spec/_v8_items.tsv, id C-2)
#
# ---------------------------------------------------------------------------
# WHY THIS FILE EXISTS — three defects found in Wave 12, each falsified.
# ---------------------------------------------------------------------------
# The semantic-gate half of C-2 was already built: spec/_v8_coverage.py
# enforces H1..H6 and is a SACRED file (hash pinned in scripts/sacred_check.sh
# ADDED_47, 21711b0b…). It cannot be edited without breaking sacred 48/48 (47/47 before Wave 50), and
# it is not edited here. The CI half was NOT built, and the way it was missing
# was actively misleading:
#
#   D1  VACUOUS GREEN (the important one).  spec/_v8_coverage.py has no --ci
#       mode at all, and it never validates argv.  `_v8_coverage.py --ci` and
#       `_v8_coverage.py --totally-bogus-flag` both print the ordinary report
#       and exit 0, byte-identically to a bare run.  A CI job written as
#       `python3 spec/_v8_coverage.py --ci` therefore goes green while
#       enforcing NO baseline whatsoever.  Falsified 2026-08-10:
#         v8 --ci exit=0 · v8 --totally-bogus-flag exit=0 · output IDENTICAL.
#       Root cause is silent flag acceptance, so this script rejects unknown
#       flags with exit 2 rather than ignoring them.
#
#   D2  SELF-SEEDING BASELINE (the DA-3 collectFencedPaths family).  The v7
#       predecessor treats a MISSING baseline as "write the current number and
#       pass this once".  Falsified: deleting _v7_coverage_gap_baseline.txt and
#       running `_v7_coverage.py --ci` PASSES (exit 0) and recreates the file
#       containing 157.  A deleted gate file must never be a green gate, so
#       here a missing baseline is FATAL (exit 2) and seeding is an explicit,
#       separately named act (--seed-baseline).
#
#   D3  RATCHET NEVER ENFORCED.  v7 only fails when the gap GROWS.  Falsified:
#       with the baseline set to 9999 against a real gap of 157 it prints
#       "CI: PASS — gap did not grow.  Ratchet it down to 157" and exits 0.
#       A stale or inflated baseline thus permanently loosens the gate while
#       still looking like a gate.  Here the baseline must EQUAL the current
#       gap: growth is a REGRESSION (exit 1) and shrinkage is a STALE BASELINE
#       (exit 1, "ratchet it down in this commit").  Only equality passes.
#
# NOTE on the parent's stated suspicion: the 1-line
# spec/_v7_coverage_gap_baseline.txt is NOT itself vacuous — it is a scalar gap
# count and it does compare (baseline 0 vs gap 157 correctly FAILS).  The
# vacuity is D1, in the v8 successor, which has no --ci at all.
#
# ---------------------------------------------------------------------------
# SINK / ROUTE.  Before this file, nothing anywhere executed either coverage
# checker.  There is no .github/workflows in this repo; the only references to
# spec/_v8_coverage.py were SHA256 integrity rows in scripts/sacred_check.sh,
# which freeze the bytes but never run them.  `npm run preflight` was
# sacred + guard:snapshot:verify + guard:test + guard — no coverage at all.
# An engine with no route is not shipped, so this script is wired into
# package.json as `coverage:ci` AND into `preflight`.  Both paths are named in
# build_log/WAVE12_REPORT.md.
# ---------------------------------------------------------------------------
#
# EXIT CODES
#   0  semantic gates clean AND gap == checked-in baseline
#   1  gap != baseline (regression if larger, stale baseline if smaller)
#   2  inputs invalid / baseline missing or malformed / unknown flag / the
#      coverage script itself signalled tampering.  NEVER a coverage number.
#
# USAGE
#   bash scripts/coverage_ci_gate.sh                 # the gate
#   bash scripts/coverage_ci_gate.sh --print         # gate + full coverage report
#   bash scripts/coverage_ci_gate.sh --seed-baseline # deliberate: write baseline
#
# ENV
#   SPEC_ROOT  where the spec/ tree lives (default <repo>/../spec), matching
#              scripts/sacred_check.sh.  Overridable so the falsification
#              harness can run this gate against a mutated COPY of spec/ and
#              prove each pole without touching the real, sacred tree.

set -uo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPEC_ROOT="${SPEC_ROOT:-$(cd "$REPO_ROOT/.." 2>/dev/null && pwd)/spec}"

COVERAGE="$SPEC_ROOT/_v8_coverage.py"
GAPBASE="$SPEC_ROOT/_v8_coverage_gap_baseline.txt"
REGISTER="$SPEC_ROOT/_v5_register_rows.tsv"
DESCOPES="$SPEC_ROOT/_v8_descopes.tsv"
ABSORBASE="$SPEC_ROOT/_v8_descope_absorption_baseline.txt"

PRINT=0
SEED=0
# D1 root cause: validate argv. An unrecognised flag is a FATAL misconfiguration,
# never a silently-ignored no-op that still exits 0.
for a in "$@"; do
  case "$a" in
    --print)         PRINT=1 ;;
    --seed-baseline) SEED=1 ;;
    *) echo "coverage_ci_gate: unknown flag: $a" >&2
       echo "  Refusing to run. A gate that ignores its own flags is how a" >&2
       echo "  vacuously-green check happens (see D1 in this file's header)." >&2
       exit 2 ;;
  esac
done

fatal() { echo "COVERAGE CI GATE — INPUT INVALID (exit 2)"; echo "  $*"; exit 2; }

[ -f "$COVERAGE" ] || fatal "coverage checker missing: $COVERAGE"
[ -f "$REGISTER" ] || fatal "register missing: $REGISTER"
[ -f "$DESCOPES" ] || fatal "descope registry missing: $DESCOPES"

# --- 1. semantic gates H1..H6, delegated to the SACRED checker, unmodified ---
COV_OUT="$(cd "$SPEC_ROOT" && python3 "$COVERAGE" 2>&1)"
COV_RC=$?

if [ "$COV_RC" = "2" ]; then
  echo "COVERAGE CI GATE — SEMANTIC GATES FAILED (exit 2)"
  echo "  spec/_v8_coverage.py exited 2: its inputs are invalid (H1/H2/H4/H6)."
  echo "  That is a tampering signal, not a coverage number, so this gate"
  echo "  propagates 2 and does NOT compare against the baseline."
  echo "$COV_OUT" | sed 's/^/    /'
  exit 2
fi

# --- 2. derive the gap, cross-checked two independent ways -------------------
# Never trust a single parse. If the two disagree the output shape changed and
# the honest answer is exit 2, not a number we guessed.
REG_ROWS="$(grep -c . <<<"$(awk -F'\t' 'NF && $1!="id" && $1 !~ /^#/' "$REGISTER")")"

covered="$(sed -n 's/^COVERED  *: *\([0-9]\+\).*/\1/p'            <<<"$COV_OUT" | head -1)"
rejected="$(sed -n 's/^REASON\/AC REJECTED  *: *\([0-9]\+\).*/\1/p' <<<"$COV_OUT" | head -1)"
norecord="$(sed -n 's/^NO RECORD  *: *\([0-9]\+\).*/\1/p'          <<<"$COV_OUT" | head -1)"

for v in "$covered" "$rejected" "$norecord"; do
  [ -n "$v" ] || fatal "could not parse the coverage report (COVERED / REASON-AC REJECTED / NO RECORD). Output shape changed; refusing to invent a gap."
done

GAP_A=$(( rejected + norecord ))          # what the checker rejected
GAP_B=$(( REG_ROWS - covered ))           # register rows minus covered rows
if [ "$GAP_A" != "$GAP_B" ]; then
  fatal "gap is ambiguous: rejected+norecord=$GAP_A but register-covered=$GAP_B ($REG_ROWS-$covered). Two independent derivations disagree; refusing to pick one."
fi
GAP="$GAP_A"

# --- 2b. DESCOPE INTEGRITY — closes the fabricated-exclusion attack ----------
#
# ITEM T-2 FINDING. spec/_v8_coverage.py PRINTS, at its own line 93:
#   "descopes : _v8_descopes.tsv (12 named, each with reason + evidence +
#    what is lost)"
# and its --attack text claims the fabricated-exclusion attack is impossible
# because "a minted class cannot exist because there is no class mechanism to
# mint into". Both are false as written. Line 51 of that script is
#   desc_ids = {d["id"] for d in descopes}
# — it reads descope IDs ONLY. reason, evidence and what_is_lost are never
# validated, and the descope registry IS a mint-able mechanism.
#
# FALSIFIED 2026-08-10: appending `DS-99<TAB>minted<TAB><TAB><TAB>` (blank
# reason, blank evidence, blank what-is-lost) and repointing one register row's
# disposition to DESCOPE/DS-99/AC-DS-99 yields:
#   COVERED 657 · REASON/AC REJECTED 0 · COVERAGE 100.00% · VERDICT COMPLETE
#   exit 0 · "ROWS ABSORBED BY A NAMED DESCOPE : 12 (9 descopes in use)"
# A row was silently absorbed into an empty justification and the number still
# read 657/657. The gap gate alone cannot see this: the gap stays 0.
#
# Two checks close it, both of which the sacred script cannot be made to do
# because its bytes are frozen:
#
#  (i) COMPLETENESS. Every descope row must actually carry the three
#      justifications the report claims it carries. A blank one is tampering.
#      Verified against the real registry before wiring: all 12 rows have 5
#      fields and no blank ones (shortest are "ITM-042." and "Nothing.", 8
#      chars), so the real tree passes and the threshold is not cosmetic.
#
# (ii) ABSORPTION NON-REGRESSION. Minting a FULLY justified descope is a
#      legitimate act, so completeness alone is not enough. What must never be
#      quiet is the count of register rows absorbed into descopes rather than
#      built. Standing owner rule: never move an item into a bucket to improve
#      a count. So the absorbed count is ratcheted exactly like the gap, against
#      a checked-in baseline. Absorbing one more row fails the gate until the
#      baseline is changed in the same commit, where a reviewer sees it.
DESC_HDR="$(head -1 "$DESCOPES")"
if [ "$DESC_HDR" != "$(printf 'id\ttitle\treason\tevidence\twhat_is_lost')" ]; then
  fatal "descope registry header changed (got: $DESC_HDR). Refusing to validate columns positionally against a layout that moved."
fi
DESC_BAD="$(awk -F'\t' 'NR==1{next} !NF{next} {
    if (NF != 5) { printf "    %s: has %d fields, expected 5\n", $1, NF; next }
    if (length($2) < 3) printf "    %s: title missing\n", $1
    if (length($3) < 3) printf "    %s: reason missing — the report claims every descope carries one\n", $1
    if (length($4) < 3) printf "    %s: evidence missing — an unevidenced descope is an assertion\n", $1
    if (length($5) < 3) printf "    %s: what_is_lost missing — a descope that does not say what is lost hides the loss\n", $1
  }' "$DESCOPES")"
if [ -n "$DESC_BAD" ]; then
  echo "COVERAGE CI GATE — DESCOPE REGISTRY INVALID (exit 2)"
  echo "  A descope absorbs register rows that will NOT be built. Every one must"
  echo "  name its reason, its evidence, and what is lost. These do not:"
  echo "$DESC_BAD"
  echo "  This is the fabricated-exclusion attack (T-2): spec/_v8_coverage.py"
  echo "  reads descope IDs only, so a blank-justification descope scores"
  echo "  657/657 COMPLETE. Refusing."
  exit 2
fi

ABSORBED="$(sed -n 's/^ROWS ABSORBED BY A NAMED DESCOPE *: *\([0-9]\+\).*/\1/p' <<<"$COV_OUT" | head -1)"
[ -n "$ABSORBED" ] || fatal "could not parse ROWS ABSORBED BY A NAMED DESCOPE from the coverage report."

if [ "$SEED" = "1" ]; then
  printf '%d\n' "$ABSORBED" > "$ABSORBASE"
elif [ ! -f "$ABSORBASE" ]; then
  echo "COVERAGE CI GATE — NO ABSORPTION BASELINE (exit 2)"
  echo "  Expected a checked-in descope-absorption baseline at"
  echo "  ${ABSORBASE#"$SPEC_ROOT"/}. Currently $ABSORBED register row(s) are"
  echo "  absorbed by descopes instead of being built. Unbaselined, that number"
  echo "  can grow silently. This gate does NOT self-seed; run --seed-baseline."
  exit 2
else
  AB_RAW="$(printf '%s' "$(cat "$ABSORBASE")" | tr -d '[:space:]')"
  [[ "$AB_RAW" =~ ^[0-9]+$ ]] || fatal "absorption baseline ${ABSORBASE#"$SPEC_ROOT"/} is not a non-negative integer (got '$AB_RAW')."
  if [ "$ABSORBED" -gt "$AB_RAW" ]; then
    echo "COVERAGE CI GATE — DESCOPE ABSORPTION GREW (exit 1)"
    echo "  $AB_RAW row(s) were absorbed by named descopes at baseline; now $ABSORBED."
    echo "  $(( ABSORBED - AB_RAW )) register row(s) moved from BUILT to DESCOPED."
    echo "  The coverage percentage does not move when this happens — that is"
    echo "  exactly why it is gated separately (T-2 fabricated-exclusion attack)."
    echo "  Standing rule: never move an item into a bucket to improve a count."
    echo "  If the descope is genuine and owner-approved, update the baseline in"
    echo "  the SAME commit so a reviewer sees the move."
    exit 1
  fi
  if [ "$ABSORBED" -lt "$AB_RAW" ]; then
    echo "COVERAGE CI GATE — STALE ABSORPTION BASELINE (exit 1)"
    echo "  Absorption fell from $AB_RAW to $ABSORBED (rows moved back to BUILT)."
    echo "  Good news, but ratchet it down in this commit: --seed-baseline"
    exit 1
  fi
fi

# --- 3. the checked-in baseline ---------------------------------------------
if [ "$SEED" = "1" ]; then
  printf '%d\n' "$GAP" > "$GAPBASE"
  echo "COVERAGE CI GATE — gap baseline SEEDED to $GAP at ${GAPBASE#"$SPEC_ROOT"/}"
  echo "COVERAGE CI GATE — absorption baseline SEEDED to $ABSORBED at ${ABSORBASE#"$SPEC_ROOT"/}"
  echo "  This is a deliberate, separately-named act. Seeding is NOT a pass;"
  echo "  commit the baseline, then run the gate with no flags."
  exit 0
fi

# D2: a missing baseline is FATAL. It is never silently created, and it is
# never 'passed this once'. Deleting the gate file must not be a green gate.
if [ ! -f "$GAPBASE" ]; then
  echo "COVERAGE CI GATE — NO BASELINE (exit 2)"
  echo "  Expected a checked-in gap baseline at ${GAPBASE#"$SPEC_ROOT"/}"
  echo "  Current gap is $GAP."
  echo "  This gate does NOT self-seed. The v7 predecessor did, which meant"
  echo "  deleting the baseline turned the gate green (defect D2 in this"
  echo "  file's header). Run --seed-baseline deliberately and COMMIT it."
  exit 2
fi

RAW="$(cat "$GAPBASE")"
# Exactly one line, exactly one non-negative integer. Empty or garbage is
# fatal, not 0: `int("")` style leniency is how a gate silently disarms.
LINES="$(printf '%s' "$RAW" | grep -c '' )"
BASE="$(printf '%s' "$RAW" | tr -d '[:space:]')"
if ! [[ "$BASE" =~ ^[0-9]+$ ]]; then
  fatal "baseline ${GAPBASE#"$SPEC_ROOT"/} is not a non-negative integer (got: '$(printf '%s' "$RAW" | head -c 60)'). An unreadable baseline is a broken gate, not a gap of 0."
fi
if [ "$LINES" -gt 1 ]; then
  fatal "baseline ${GAPBASE#"$SPEC_ROOT"/} has $LINES lines; expected exactly one integer."
fi

# --- 4. the verdict ---------------------------------------------------------
echo "=============================================================================="
echo "COVERAGE CI GATE — C-2"
echo "=============================================================================="
echo "semantic gates  : spec/_v8_coverage.py H1..H6 -> exit $COV_RC"
echo "register rows   : $REG_ROWS"
echo "covered         : $covered"
echo "gap (2 ways)    : $GAP   (rejected+norecord=$GAP_A, register-covered=$GAP_B)"
echo "baseline        : $BASE   (${GAPBASE#"$SPEC_ROOT"/}, checked in)"
echo "descopes        : $(( $(grep -c . "$DESCOPES") - 1 )) rows, all carrying reason + evidence + what_is_lost"
echo "absorbed rows   : $ABSORBED == baseline $AB_RAW (${ABSORBASE#"$SPEC_ROOT"/})"
[ "$PRINT" = "1" ] && { echo; echo "$COV_OUT" | sed 's/^/  /'; echo; }

if [ "$GAP" -gt "$BASE" ]; then
  echo
  echo "RESULT: FAIL — COVERAGE REGRESSION"
  echo "  The gap GREW by $(( GAP - BASE )) row(s) (baseline $BASE -> now $GAP)."
  echo "  Fix the rows, or justify them and update the baseline in the SAME commit."
  sed -n 's/^  REJECTED /  REJECTED /p' <<<"$COV_OUT" | head -40
  exit 1
fi

if [ "$GAP" -lt "$BASE" ]; then
  echo
  echo "RESULT: FAIL — STALE BASELINE (ratchet not applied)"
  echo "  The gap SHRANK to $GAP but the baseline still says $BASE."
  echo "  v7 passed here with a polite suggestion, which let an inflated"
  echo "  baseline loosen the gate forever (defect D3). This gate refuses."
  echo "  Ratchet the baseline down to $GAP in this commit:"
  echo "    bash scripts/coverage_ci_gate.sh --seed-baseline"
  exit 1
fi

if [ "$COV_RC" != "0" ]; then
  echo
  echo "RESULT: FAIL — checker exited $COV_RC"
  echo "  Gap matches the baseline, but spec/_v8_coverage.py did not exit 0."
  echo "  Reporting the checker's own verdict rather than overriding it."
  exit 1
fi

echo
echo "RESULT: PASS — gap $GAP == baseline $BASE, semantic gates clean."
[ "$GAP" = "0" ] && echo "  Baseline is 0, the strictest possible: any newly-undispositioned"
[ "$GAP" = "0" ] && echo "  register row fails this gate immediately."
exit 0
