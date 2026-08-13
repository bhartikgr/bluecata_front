#!/usr/bin/env bash
# scripts/__tests__/coverage_attack_harness.sh — ITEM T-2
#
# "Coverage-fabrication attack test"  (spec/_v8_items.tsv, T-2,
#  cite spec/V5_REVIEW_B_COVERAGE_TOKEN_ATTACK.md, engine `_v8_coverage.py --attack`)
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS
# ---------------------------------------------------------------------------
# `python3 spec/_v8_coverage.py --attack` does not attack anything. It PRINTS
# four paragraphs asserting that four attacks would fail. It executes no
# mutation, reads no second tree, and compares no output. It is exactly the kind
# of artefact the standing rule forbids: a green claim nobody falsified.
#
# spec/_v8_coverage.py is SACRED (hash pinned 21711b0b… at
# scripts/sacred_check.sh:79) so its --attack text cannot be fixed in place.
# This harness supplies what that text only promised: it RUNS each of the four
# attacks against disposable copies of the spec inputs and checks the outcome.
#
# RESULT (2026-08-10): three of the four claims are TRUE. THE SECOND IS FALSE.
#   1 TOKEN attack            — claim HOLDS, verified executably
#   2 FABRICATED-EXCLUSION    — claim FALSE: the attack SUCCEEDS, 657/657 exit 0
#   3 DUPLICATE-ROW overwrite — claim HOLDS
#   4 GENERIC-REASON          — claim HOLDS
#
# Attack 2 is reproduced here as a MUST-SUCCEED-then-MUST-BE-BLOCKED pair, the
# same fail-before/pass-after shape the guard's mutation-bypass tests use: it
# succeeds against the sacred checker alone, and is BLOCKED once
# scripts/coverage_ci_gate.sh (item C-2) is in front of it. That is what makes
# the fix evidence rather than an assertion.
#
# SAFETY: every case runs against a COPY under a temp dir. The real spec/ tree is
# sacred and is never written; case Z re-verifies that by hash.
#
#   bash scripts/__tests__/coverage_attack_harness.sh     (npm run coverage:attack)
#
# Exit 0 = every attack behaved as recorded here.  Exit 1 = one did not.

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
REAL_SPEC="$(cd "$REPO_ROOT/.." && pwd)/spec"
GATE="$REPO_ROOT/scripts/coverage_ci_gate.sh"
BUILD_DOC="CONSORTIUM_PARTNER_BUILD_v8.md"

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(sha256sum "$REAL_SPEC/_v8_coverage.py" | cut -d' ' -f1)"

fresh() {                       # fresh <name> -> echoes an isolated spec copy
  local d="$TMPROOT/$1"; rm -rf "$d"; mkdir -p "$d"
  cp "$REAL_SPEC"/_v8_coverage.py "$REAL_SPEC"/_v8_dispositions.tsv \
     "$REAL_SPEC"/_v8_items.tsv "$REAL_SPEC"/_v8_descopes.tsv \
     "$REAL_SPEC"/_v5_register_rows.tsv \
     "$REAL_SPEC"/_v8_coverage_gap_baseline.txt \
     "$REAL_SPEC"/_v8_descope_absorption_baseline.txt "$d"/
  [ -f "$REAL_SPEC/$BUILD_DOC" ] && cp "$REAL_SPEC/$BUILD_DOC" "$d"/
  echo "$d"
}
checker_rc() { ( cd "$1" && python3 _v8_coverage.py >/dev/null 2>&1 ); echo $?; }
checker_out() { ( cd "$1" && python3 _v8_coverage.py 2>&1 ); }
gate_rc() { SPEC_ROOT="$1" bash "$GATE" >/dev/null 2>&1; echo $?; }
ok()   { PASS=$((PASS+1)); printf '  ok      %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  NOT OK  %s\n' "$1"; }
want() { [ "$2" = "$3" ] && ok "$1 ($2)" || bad "$1 (got $2, wanted $3)"; }
victim() { awk -F'\t' 'NR>1 && NF>1 {print $1; exit}' "$1/_v8_dispositions.tsv"; }

echo "=============================================================================="
echo "T-2 COVERAGE-FABRICATION ATTACK HARNESS"
echo "  \`_v8_coverage.py --attack\` only PRINTS these four claims. This RUNS them."
echo "=============================================================================="

# ---------------------------------------------------------------------------
echo
echo "ATTACK 1 — TOKEN STUFFING (spec/V5_REVIEW_B_COVERAGE_TOKEN_ATTACK.md)"
echo "  Claim: the checker never opens $BUILD_DOC, so an empty document"
echo "  scores the same as a complete one. Stuffing IDs cannot buy coverage."
D="$(fresh a1)"
if grep -q "$BUILD_DOC" "$D/_v8_coverage.py"; then
  # It is mentioned in a docstring; what matters is that it is never opened.
  if grep -nE "open\(.*$BUILD_DOC|open\(.*\.md" "$D/_v8_coverage.py" >/dev/null; then
    bad "static: the checker OPENS a .md file — the token claim is void"
  else
    ok "static: $BUILD_DOC appears only in prose, never in an open() call"
  fi
else
  ok "static: the checker does not reference $BUILD_DOC at all"
fi
BASE_OUT="$(checker_out "$D")"
: > "$D/$BUILD_DOC"                                  # empty document
[ "$BASE_OUT" = "$(checker_out "$D")" ] && ok "intact doc == EMPTIED doc: byte-identical report" \
                                        || bad "emptying the build document changed the score"
cp "$REAL_SPEC/V5_REVIEW_B_COVERAGE_TOKEN_ATTACK.md" "$D/$BUILD_DOC"   # 657-ID token bag
[ "$BASE_OUT" = "$(checker_out "$D")" ] && ok "intact doc == 657-ID TOKEN BAG: byte-identical report" \
                                        || bad "the token bag changed the score"
# The pole that matters: token stuffing must not REPAIR a real gap.
V="$(victim "$D")"
grep -v "^${V}	" "$D/_v8_dispositions.tsv" > "$D/.t" && mv "$D/.t" "$D/_v8_dispositions.tsv"
want "with the token bag in place, dropping $V still fails the checker" "$(checker_rc "$D")" 1
grep -q "REJECTED $V" <<<"$(checker_out "$D")" && ok "and it names $V as the unresolved row" \
                                               || bad "it does not name $V"
echo "  VERDICT: claim 1 HOLDS. Coverage comes from the TSVs; the document is inert."

# ---------------------------------------------------------------------------
echo
echo "ATTACK 2 — FABRICATED EXCLUSION  *** THE CLAIM IS FALSE ***"
echo "  Claim (--attack text): \"A minted class cannot exist because there is no"
echo "  class mechanism to mint into.\"  But _v8_coverage.py:51 is"
echo "    desc_ids = {d[\"id\"] for d in descopes}"
echo "  — descope IDs only. reason/evidence/what_is_lost are NEVER read, and the"
echo "  descope registry IS mintable. So: mint DS-99 with BLANK justification"
echo "  and absorb a live register row into it."
D="$(fresh a2)"; V="$(victim "$D")"
printf 'DS-99\tminted\t\t\t\n' >> "$D/_v8_descopes.tsv"
awk -F'\t' -v v="$V" 'BEGIN{OFS="\t"} $1==v {$3="DESCOPE"; $4="DS-99"; $5="AC-DS-99";
     $6=v" absorbed by minted descope DS-99"} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.t" && mv "$D/.t" "$D/_v8_dispositions.tsv"
A2_RC="$(checker_rc "$D")"; A2_OUT="$(checker_out "$D")"
echo "  --- against the SACRED checker alone ---"
want "ATTACK SUCCEEDS: sacred checker exit" "$A2_RC" 0
grep -q "COMPLETE — 657/657" <<<"$A2_OUT" && ok "ATTACK SUCCEEDS: still reports \"COMPLETE — 657/657\"" \
                                          || bad "expected a fabricated COMPLETE verdict"
grep -q "each with reason + evidence + what is lost" <<<"$A2_OUT" && \
  ok "and it still PRINTS \"each with reason + evidence + what is lost\" — unchecked" || \
  bad "the unchecked claim line is gone"
echo "      ^ a register row was absorbed into an EMPTY justification and the"
echo "        number still read 657/657. The gap does not move, so a gap-only"
echo "        gate cannot see this either."
echo "  --- with the C-2 gate in front (scripts/coverage_ci_gate.sh) ---"
want "ATTACK BLOCKED: gate exit" "$(gate_rc "$D")" 2
G="$(SPEC_ROOT="$D" bash "$GATE" 2>&1)"
grep -q "DESCOPE REGISTRY INVALID" <<<"$G" && ok "blocked as DESCOPE REGISTRY INVALID" || bad "wrong block reason"
grep -q "DS-99" <<<"$G" && ok "and it names the minted descope DS-99" || bad "does not name DS-99"

echo "  --- variant 2b: mint a FULLY JUSTIFIED descope (completeness is not enough) ---"
D="$(fresh a2b)"; V="$(victim "$D")"
printf 'DS-98\tPlausible sounding descope\tThis row is not worth building in this wave.\tspec/CONSORTIUM_PARTNER_BUILD_v8.md:1 says so.\tNothing of consequence.\n' >> "$D/_v8_descopes.tsv"
awk -F'\t' -v v="$V" 'BEGIN{OFS="\t"} $1==v {$3="DESCOPE"; $4="DS-98"; $5="AC-DS-98";
     $6=v" absorbed by plausible descope DS-98"} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.t" && mv "$D/.t" "$D/_v8_dispositions.tsv"
want "ATTACK SUCCEEDS against the sacred checker" "$(checker_rc "$D")" 0
want "ATTACK BLOCKED by the gate's absorption ratchet" "$(gate_rc "$D")" 1
G="$(SPEC_ROOT="$D" bash "$GATE" 2>&1)"
grep -q "DESCOPE ABSORPTION GREW" <<<"$G" && ok "blocked as DESCOPE ABSORPTION GREW (11 -> 12)" || bad "wrong block reason"
echo "  VERDICT: claim 2 is FALSE as written. The attack works against the sacred"
echo "  checker in both variants. C-2's gate blocks both: blank justification is"
echo "  fatal, and a justified descope still cannot QUIETLY absorb a row."

# ---------------------------------------------------------------------------
echo
echo "ATTACK 3 — DUPLICATE-ROW OVERWRITE (the v6 defect)"
echo "  Claim: duplicate ids are FATAL, never a silent overwrite."
D="$(fresh a3)"; V="$(victim "$D")"
# Append a duplicate of the victim's row that absorbs it into an existing descope.
grep "^${V}	" "$D/_v8_dispositions.tsv" | awk -F'\t' 'BEGIN{OFS="\t"}
  {$3="DESCOPE"; $4="DS-1"; $5="AC-DS-1"; $6=$1" overwritten by a duplicate row"; print}' \
  >> "$D/_v8_dispositions.tsv"
want "sacred checker exit (2 = tampering, not a number)" "$(checker_rc "$D")" 2
grep -q "duplicate id $V" <<<"$(checker_out "$D")" && ok "names the duplicate id $V" || bad "does not name $V"
grep -q "INPUT INVALID" <<<"$(checker_out "$D")" && ok "refuses to print a coverage percentage at all" || bad "printed a number anyway"
want "gate propagates it as 2, never as a coverage number" "$(gate_rc "$D")" 2
echo "  VERDICT: claim 3 HOLDS."

# ---------------------------------------------------------------------------
echo
echo "ATTACK 4 — GENERIC REASON (boilerplate that looks like justification)"
echo "  Claim: a reason must carry the row id, a file:line, or two distinctive"
echo "  title words, and must be unique across rows."
D="$(fresh a4)"
awk -F'\t' 'BEGIN{OFS="\t"} NR>1 && NF>1 {$6="Handled as part of the overall consortium workstream number "NR} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.t" && mv "$D/.t" "$D/_v8_dispositions.tsv"
A4="$(checker_out "$D")"
want "sacred checker exit" "$(checker_rc "$D")" 1
grep -q "COVERAGE                : 0.00%" <<<"$A4" && ok "unique-but-generic reasons score 0.00%, not 100%" \
                                                   || bad "generic reasons were accepted"
grep -q "REASON/AC REJECTED      : 657" <<<"$A4" && ok "all 657 rows rejected as not row-specific" || bad "not all rejected"
want "gate fails it" "$(gate_rc "$D")" 1
echo "  --- variant 4b: IDENTICAL boilerplate (H4 reuse) is fatal, not merely rejected ---"
D="$(fresh a4b)"
awk -F'\t' 'BEGIN{OFS="\t"} NR>1 && NF>1 {$6="Handled as part of the overall consortium workstream."} {print}' \
  "$D/_v8_dispositions.tsv" > "$D/.t" && mv "$D/.t" "$D/_v8_dispositions.tsv"
want "identical reasons across rows -> exit 2 (H4)" "$(checker_rc "$D")" 2
grep -q "reason text reused" <<<"$(checker_out "$D")" && ok "names it as reused reason text" || bad "wrong message"
echo "  VERDICT: claim 4 HOLDS, in both the unique-generic and identical forms."

# ---------------------------------------------------------------------------
echo
echo "CONTROL — an unmutated copy must PASS both checker and gate"
D="$(fresh ctl)"
want "sacred checker exit" "$(checker_rc "$D")" 0
want "C-2 gate exit" "$(gate_rc "$D")" 0

echo
echo "POLE Z — the real sacred checker is byte-identical afterwards"
[ "$BEFORE_SHA" = "$(sha256sum "$REAL_SPEC/_v8_coverage.py" | cut -d' ' -f1)" ] \
  && ok "spec/_v8_coverage.py unchanged ($BEFORE_SHA)" || bad "THIS HARNESS MUTATED A SACRED FILE"

echo
echo "=============================================================================="
printf 'T-2 ATTACK HARNESS: %d assertions passed, %d failed\n' "$PASS" "$FAIL"
echo
echo "RECORDED OUTCOME — what --attack claims vs what actually happens:"
echo "  1 token stuffing          CLAIM HOLDS   document is inert, gap survives it"
echo "  2 fabricated exclusion    CLAIM FALSE   succeeds on the sacred checker;"
echo "                                          blocked only by C-2's gate"
echo "  3 duplicate-row overwrite CLAIM HOLDS   exit 2 before any percentage"
echo "  4 generic reason          CLAIM HOLDS   0.00%, and reuse is exit 2"
echo
echo "The honest boundary, restated: this is a self-check. A hostile actor with"
echo "write access to spec/ AND to the checked-in baselines can still lie. What"
echo "changed is that every such lie now requires editing a baseline file in the"
echo "same commit, where a reviewer sees it, instead of being absorbed silently."
echo "=============================================================================="
[ "$FAIL" = "0" ] && exit 0 || exit 1
