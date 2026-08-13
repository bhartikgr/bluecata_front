#!/usr/bin/env bash
# scripts/__tests__/package_docs_falsify.sh — DOC-1 / DOC-2 / DOC-3
#
# Falsifies scripts/build_package_docs.py in BOTH directions.
#
# The rule this exists to satisfy: a green check nobody has falsified is not
# evidence. The specific failure being hunted is the DA-3 shape, which has now
# bitten this project three times — a collector or stripper that quietly matches
# nothing, produces a well-formed but empty artefact, and exits 0:
#
#   Wave 7B  collectFencedPaths() silently skipped files that never existed,
#            so DA-3's scope fence was fencing nothing.
#   Wave 11  whole-file text stripping blanked a live registerPartnerRoutes()
#            call, which would have mislabelled six live routes as dormant.
#   Wave 12  spec/_v8_coverage.py accepts --ci and --totally-bogus-flag with
#            byte-identical output, so a CI job invoking it enforced nothing.
#
# A markdown-table extractor is exactly that hazard: change one heading and it
# emits a ledger with a confident title and zero rows. So every count in the
# generator is asserted here from the failing side.
#
#   bash scripts/__tests__/package_docs_falsify.sh      (npm run docs:falsify)
#
# SAFETY: mutations run against COPIES of spec/ under a temp dir. The two drift
# cases must touch docs/ (the generator's output path is the repo's own docs/),
# so those files are backed up byte-for-byte and restored; case Z re-verifies
# both the sacred spec inputs and docs/ by hash.

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
REAL_SPEC="$(cd "$REPO_ROOT/.." && pwd)/spec"
GEN="$REPO_ROOT/scripts/build_package_docs.py"
DOCS="$REPO_ROOT/docs"
DOCNAMES=(CORRECTION_LEDGER.md DO_NOT_BUILD.md PRIOR_TASK_HISTORY.md OWNER_DECISION_REGISTER.md)
# DOC-4 is hand-written, not generated, so it is NOT in DOCNAMES (the generator
# neither owns nor restores it). Its numbers are re-derived in the DOC-4 block.
STATICDOCS=(WAVE_D_LINE_DELTA_AUDIT.md)

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
BACKUP="$TMPROOT/_docs_backup"; mkdir -p "$BACKUP"
for f in "${DOCNAMES[@]}"; do [ -f "$DOCS/$f" ] && cp -a "$DOCS/$f" "$BACKUP/$f"; done
restore() { for f in "${DOCNAMES[@]}"; do
              if [ -f "$BACKUP/$f" ]; then cp -a "$BACKUP/$f" "$DOCS/$f"; else rm -f "$DOCS/$f"; fi
            done; }
trap 'restore; rm -rf "$TMPROOT"' EXIT

SRCS=(SESSION_TRACEABILITY_REGISTER.md PRIOR_ART_SWEEP.md PRIOR_TASK_HISTORY.md V2_DECISION_AUDIT.md)
SPEC_SHA="$(cd "$REAL_SPEC" && sha256sum "${SRCS[@]}" | sha256sum | cut -d' ' -f1)"
DOCS_SHA="$(cd "$DOCS" && sha256sum "${DOCNAMES[@]}" 2>/dev/null | sha256sum | cut -d' ' -f1)"

fresh() { local d="$TMPROOT/$1"; rm -rf "$d"; mkdir -p "$d"
          for f in "${SRCS[@]}"; do cp "$REAL_SPEC/$f" "$d/"; done; echo "$d"; }
run()  { SPEC_ROOT="$1" python3 "$GEN" "${@:2}" 2>&1; }
rc()   { SPEC_ROOT="$1" python3 "$GEN" "${@:2}" >/dev/null 2>&1; echo $?; }

ok()  { PASS=$((PASS+1)); printf '  ok    %-58s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL  %-58s %s\n' "$1" "${2:-}"; }
want(){ [ "$2" = "$3" ] && ok "$1" "exit=$2" || bad "$1" "exit=$2 wanted=$3"; }
says(){ grep -qF -- "$2" <<<"$3" && ok "  ^ says: $2" || bad "  ^ MISSING message: $2"; }

echo "=============================================================================="
echo "DOC-1/2/3/4 + DEC-1 FALSIFICATION — build_package_docs.py must FAIL when it should"
echo "=============================================================================="

echo
echo "-- CONTROL: pristine sources must verify clean ------------------------------"
D="$(fresh ctl)"; want "pristine spec copy, --verify" "$(rc "$D" --verify)" 0

echo
echo "-- DOC-1 poles: the 50-row correction ledger --------------------------------"
D="$(fresh l1)"; grep -v '^| COR-050 ' "$D/SESSION_TRACEABILITY_REGISTER.md" > "$D/.t" && mv "$D/.t" "$D/SESSION_TRACEABILITY_REGISTER.md"
O="$(run "$D" --verify)"; want "one COR row deleted (this is the vacuous-green pole)" "$(rc "$D" --verify)" 2
says x "extracted 49" "$O"; says x "Refusing to write a short ledger" "$O"

D="$(fresh l2)"; sed -i 's/^| COR-050 /| COR-051 /' "$D/SESSION_TRACEABILITY_REGISTER.md"
O="$(run "$D" --verify)"; want "50 rows but a GAP (COR-050 -> COR-051)" "$(rc "$D" --verify)" 2
says x "missing ['COR-050']" "$O"
echo "     ^ count alone would have passed this. Contiguity is checked separately."

D="$(fresh l3)"; DUP="$(grep -m1 '^| COR-007 ' "$D/SESSION_TRACEABILITY_REGISTER.md")"
[ -n "$DUP" ] || bad "harness setup: could not find COR-007 to duplicate"
printf '%s\n' "$DUP" >> "$D/SESSION_TRACEABILITY_REGISTER.md"
O="$(run "$D" --verify)"; want "duplicate COR-007 appended" "$(rc "$D" --verify)" 2
says x "duplicate ledger id COR-007" "$O"

D="$(fresh l4)"; sed -i 's/^| COR-/| XOR-/' "$D/SESSION_TRACEABILITY_REGISTER.md"
O="$(run "$D" --verify)"; want "ledger prefix renamed (extractor now matches NOTHING)" "$(rc "$D" --verify)" 2
says x "extracted 0" "$O"
echo "     ^ THE DA-3 CASE. Zero matches must be fatal, never an empty document."

D="$(fresh l5)"; sed -i 's/| CORRECTION |/| CORRECTED |/' "$D/SESSION_TRACEABILITY_REGISTER.md"
want "category column renamed -> shape check rejects every row" "$(rc "$D" --verify)" 2

echo
echo "     -- and the row the shape check exists to EXCLUDE --"
echo "     SESSION_TRACEABILITY_REGISTER.md has a second table whose rows also"
echo "     start '| COR-0' but have 3 columns; it mentions COR-041 again. Taking it"
echo "     would double-count. Proof the guard is load-bearing:"
D="$(fresh l6)"
# Promote the 3-column turn-map row to the 6-column ledger shape.
sed -i 's/^| COR-041 | turn_0048 | \(.*\) |$/| COR-041 | CORRECTION | \1 | turn_0048 | N | REVERSED |/' "$D/SESSION_TRACEABILITY_REGISTER.md"
O="$(run "$D" --verify)"; want "turn-map row promoted to ledger shape" "$(rc "$D" --verify)" 2
says x "duplicate ledger id COR-041" "$O"
D="$(fresh l7)"; grep -c '^| COR-0' "$D/SESSION_TRACEABILITY_REGISTER.md" | \
  { read -r n; [ "$n" = "51" ] && ok "real file has 51 lines starting '| COR-0'" "(50 ledger + 1 turn-map)" \
                              || bad "expected 51 such lines, saw $n"; }
grep -c '^| COR-' "$DOCS/CORRECTION_LEDGER.md" | \
  { read -r n; [ "$n" = "50" ] && ok "generated ledger contains exactly 50 rows" "not 51" \
                              || bad "generated ledger has $n rows"; }

echo
echo "-- DOC-2 poles: the 12-item DO-NOT-BUILD list -------------------------------"
D="$(fresh d1)"; sed -i 's/^| 12 | \*\*Audit-chain/X| 12 | **Audit-chain/' "$D/PRIOR_ART_SWEEP.md"
O="$(run "$D" --verify)"; want "one DO-NOT-BUILD row disabled" "$(rc "$D" --verify)" 2
says x "extracted 11" "$O"; says x "a capability missing from this list is a capability someone rebuilds" "$O"

D="$(fresh d2)"; sed -i 's/^| 7 | \*\*Task tracking/| 13 | **Task tracking/' "$D/PRIOR_ART_SWEEP.md"
O="$(run "$D" --verify)"; want "12 rows but misnumbered (7 -> 13)" "$(rc "$D" --verify)" 2
says x "not numbered 1..12" "$O"

D="$(fresh d3)"; sed -i 's/^## 2. HEADLINE: \*\*DO NOT BUILD/## 2. Summary of prior art/' "$D/PRIOR_ART_SWEEP.md"
O="$(run "$D" --verify)"; want "section heading renamed" "$(rc "$D" --verify)" 2
says x "could not locate the DO-NOT-BUILD section" "$O"

D="$(fresh d4)"; sed -i 's/\*\*Total estimated effort saved:[^*]*\*\*/(effort saved omitted)/' "$D/PRIOR_ART_SWEEP.md"
O="$(run "$D" --verify)"; want "the 11-15 engineer-weeks total removed" "$(rc "$D" --verify)" 2
says x "no 'Total estimated effort saved' line" "$O"
grep -qF "11–15 engineer-weeks" "$DOCS/DO_NOT_BUILD.md" && ok "generated doc carries the real total" "11-15 engineer-weeks" \
                                                        || bad "generated doc lost the total"

echo
echo "-- DOC-3 poles: the reconstructed prior task history ------------------------"
D="$(fresh h1)"; head -12 "$D/PRIOR_TASK_HISTORY.md" > "$D/.t" && mv "$D/.t" "$D/PRIOR_TASK_HISTORY.md"
O="$(run "$D" --verify)"; want "history truncated to a 12-line stub" "$(rc "$D" --verify)" 2
says x "that is a stub, not the reconstruction" "$O"
echo "     ^ OPN-015 was 'a run reported writing this path and did not'. A stub that"
echo "       exists is the same lie with a file attached, so length is asserted."

D="$(fresh h2)"; sed -i 's/^## 1\./## One./' "$D/PRIOR_TASK_HISTORY.md"
want "history present but has no numbered findings sections" "$(rc "$D" --verify)" 2

echo
echo "-- DEC-1 poles: the 11 v2 decisions owed an owner ruling ---------------------"
D="$(fresh c1)"; sed -i '0,/^| D-30 /{s/^| D-30 /| D-33 /}' "$D/V2_DECISION_AUDIT.md"
O="$(run "$D" --verify)"; want "a decision id renumbered out of range (D-30 -> D-33)" "$(rc "$D" --verify)" 2
says x "missing ['D-30']" "$O"

D="$(fresh c2)"; sed -i 's/| \*\*SHOULD-ESCALATE\*\* | The table location is technical/| **CORRECTLY-AUTONOMOUS** | The table location is technical/' "$D/V2_DECISION_AUDIT.md"
O="$(run "$D" --verify)"; want "D-01 quietly downgraded to CORRECTLY-AUTONOMOUS" "$(rc "$D" --verify)" 2
says x "but the executive table states" "$O"
echo "     ^ THE HIGH-VALUE POLE. Reclassifying one escalation as autonomous makes an"
echo "       owner decision disappear. 32 rows still, so a count check alone passes."
echo "       The row tally vs the audit's OWN stated table is what catches it."

D="$(fresh c3)"; sed -i 's/^| SHOULD-ESCALATE | 10 |$/| SHOULD-ESCALATE | 9 |/' "$D/V2_DECISION_AUDIT.md"
O="$(run "$D" --verify)"; want "the STATED count edited instead (10 -> 9)" "$(rc "$D" --verify)" 2
says x "executive counts are" "$O"
echo "     ^ and the same check fires from the other side, so neither the summary nor"
echo "       the rows can be edited alone to shrink the owner's queue."

D="$(fresh c4)"; sed -i 's/| \*\*UNDER-JUSTIFIED\*\* | Using the transaction jurisdiction/| **WRONG** | Using the transaction jurisdiction/' "$D/V2_DECISION_AUDIT.md"
want "D-18 moved out of UNDER-JUSTIFIED (ITM-154)" "$(rc "$D" --verify)" 2

D="$(fresh c5)"; sed -i 's/^| D-01 |/X| D-01 |/' "$D/V2_DECISION_AUDIT.md"
O="$(run "$D" --verify)"; want "one whole decision row removed" "$(rc "$D" --verify)" 2
says x "extracted 31" "$O"

D="$(fresh c6)"; rm -f "$D/V2_DECISION_AUDIT.md"
want "V2_DECISION_AUDIT.md deleted" "$(rc "$D" --verify)" 2

grep -c 'UNRULED' "$DOCS/OWNER_DECISION_REGISTER.md" | \
  { read -r n; [ "$n" = "12" ] && ok "register shows UNRULED for all 11 rows" "(+1 in the prose)" \
                              || bad "expected 12 UNRULED occurrences, saw $n"; }
grep -qF 'THE RULINGS DO NOT EXIST YET' "$DOCS/OWNER_DECISION_REGISTER.md" \
  && ok "register states plainly that nothing was applied" "not a silent partial" \
  || bad "register does not state the blocked status"

echo
echo "-- MISSING / EMPTY INPUTS: must FAIL, never silently skip -------------------"
for f in "${SRCS[@]}"; do
  D="$(fresh "m_$f")"; rm -f "$D/$f"
  O="$(run "$D" --verify)"; want "source deleted: $f" "$(rc "$D" --verify)" 2
  says x "A missing input is a FAILURE here, never a skip." "$O"
done
D="$(fresh e1)"; : > "$D/PRIOR_ART_SWEEP.md"
O="$(run "$D" --verify)"; want "source emptied: PRIOR_ART_SWEEP.md" "$(rc "$D" --verify)" 2
says x "is empty" "$O"

echo
echo "-- ARGV: an unrecognised flag must not be silently accepted -----------------"
echo "   (this is defect D1 from item C-2: _v8_coverage.py takes --ci and any other"
echo "    flag, exits 0, and prints byte-identical output. Not repeated here.)"
D="$(fresh a1)"
for f in --ci --check --totally-bogus-flag; do
  O="$(run "$D" "$f")"; want "rejects $f" "$(rc "$D" "$f")" 2
done
says x "Accepted: --verify (no flags = write)." "$O"

echo
echo "-- DRIFT DETECTION: --verify must catch a hand-edited package doc -----------"
python3 "$GEN" >/dev/null 2>&1
want "regenerated tree verifies clean" "$(rc "$REAL_SPEC" --verify)" 0
printf '\n| COR-051 | CORRECTION | invented row nobody ruled on | nowhere | N | REVERSED |\n' >> "$DOCS/CORRECTION_LEDGER.md"
O="$(run "$REAL_SPEC" --verify)"; want "a row hand-added to docs/CORRECTION_LEDGER.md" "$(rc "$REAL_SPEC" --verify)" 1
says x "PACKAGE DOCS HAVE DRIFTED" "$O"; says x "COR-051" "$O"
restore
rm -f "$DOCS/DO_NOT_BUILD.md"
O="$(run "$REAL_SPEC" --verify)"; want "docs/DO_NOT_BUILD.md deleted outright" "$(rc "$REAL_SPEC" --verify)" 1
says x "ABSENT from docs/" "$O"
restore
want "after restore, --verify is clean again" "$(rc "$REAL_SPEC" --verify)" 0

echo
echo "-- DOC-4: the WAVE D audit is hand-written, so its NUMBERS are re-derived ----"
echo "   docs/WAVE_D_LINE_DELTA_AUDIT.md is not generated. That is the drift risk the"
echo "   generator exists to remove, so every hard number in it is re-checked here."
A4="$DOCS/WAVE_D_LINE_DELTA_AUDIT.md"
chk(){ grep -qF -- "$2" "$A4" && ok "$1" "\"$2\"" || bad "$1" "audit no longer says: $2"; }
[ -f "$A4" ] || bad "DOC-4 audit document is missing"

WD="$REAL_SPEC/13_WAVE_D_spv.md"
N="$(wc -l < "$WD" | tr -d ' ')"
[ "$N" = "1480" ] && ok "13_WAVE_D_spv.md is 1,480 lines" "re-derived" || bad "spec file is now $N lines; the audit says 1,480"
chk "audit states the current line count" "**1,480 lines**"
chk "audit states the original" "**1,343 lines**"
chk "audit states the post-rebuild count" "**1,256 lines**"

[ ! -e "$REAL_SPEC/WAVE_D_v3_EDITS_TO_REAPPLY.md" ] \
  && ok "THE DOC-4 FINDING re-derived: WAVE_D_v3_EDITS_TO_REAPPLY.md absent" "as claimed" \
  || bad "that file now EXISTS — the audit's central finding is stale, fix the audit"
grep -qF "WAVE_D_v3_EDITS_TO_REAPPLY.md" "$REAL_SPEC/INCIDENT_WAVE_D_FILE_LOSS.md" \
  && ok "the incident report does name it as the surviving mitigation" || bad "incident report no longer names it"
grep -qF "All eight v3 edits" "$REAL_SPEC/INCIDENT_WAVE_D_FILE_LOSS.md" \
  && ok "incident says EIGHT v3 edits" "the discrepancy is real" || bad "incident no longer says eight"
grep -qF "ten v3 edits" "$WD" && ok "13_WAVE_D_spv.md §15 says TEN v3 edits" "eight vs ten stands" \
                             || bad "the file no longer says ten"

# V3-* markers are bolded list items; OR-* are "### OR-n" headings inside the
# forwarding note. Probing both with one pattern gave a false "absent" first time
# round -- the probe was wrong, not the spec. Verified against the real format.
for m in V3-1 V3-3 V3-4a; do
  grep -qF -- "**$m" "$WD" && ok "v3 edit marker $m present in the rebuilt spec" || bad "marker $m absent"
done
for m in OR-2 OR-3; do
  grep -qE "^> ### $m " "$WD" && ok "v3.1 owner ruling $m present in the forwarding note" || bad "ruling $m absent"
done

( cd "$REPO_ROOT" || exit 1
  S="$(sha256sum server/captableCommitStore.ts | cut -c1-8)"
  L="$(wc -l < server/captableCommitStore.ts | tr -d ' ')"
  [ "$S" = "e5045ecb" ] && ok "citation 8: captableCommitStore.ts sha256 e5045ecb…" "still exact" \
                        || bad "sha is now $S; the audit claims e5045ecb"
  [ "$L" = "1379" ] && ok "citation 8: captableCommitStore.ts is 1,379 lines" "still exact" \
                    || bad "file is $L lines; the audit claims 1,379"
  grep -q 'getDbDriver' <<<"$(sed -n '204p' server/db/connection.ts)" \
    && ok "citation 11: getDbDriver still at connection.ts:204" || bad "citation 11 line drifted"
  D="$(grep -rn 'deployments/' client/src | wc -l | tr -d ' ')"
  [ "$D" = "6" ] && ok "citation 17: 'deployments/' in client is now 6, was 0" "the orphan closed" \
                 || bad "count is $D; the audit says 6"
  T="$(ls migrations/ | grep -oE '^[0-9]{4}' | sort -n | tail -1)"
  [ "$T" = "0168" ] && ok "citation 25: migration tip is 0168, spec said 0137" \
                    || bad "tip is $T; the audit says 0168"
  TT="$(grep -c 'TabsTrigger' client/src/components/partner/SpvDetailTabs.tsx | tr -d ' ')"
  [ "$TT" = "13" ] && ok "citation 15: 13 TabsTrigger now, spec said 11 tabs" \
                   || bad "count is $TT; the audit says 13"
  grep -q 'are GONE' <<<"$(sed -n '177p' client/src/pages/partner/PartnerSpvEngine.tsx)" \
    && ok "§5 conflict re-derived: PartnerSpvEngine.tsx:177 says the defaults are GONE" \
    || bad "PartnerSpvEngine.tsx:177 no longer says that"
  grep -q 'partner/spvs' <<<"$(sed -n '1379p' client/src/App.tsx)" \
    && ok "citation 27: PartnerSpvs IS routed now (App.tsx:1379)" "orphan wired" \
    || bad "App.tsx:1379 is not the partner/spvs route"
) || bad "DOC-4 re-derivation block failed to run"

echo
echo "-- SPEC TREE ABSENT: a shipped release has work/ and no spec/ ---------------"
echo "   Must be a PRINTED skip, not a silent pass, and not a failure."
O="$(run "$TMPROOT/no_such_spec_tree" --verify)"
want "SPEC_ROOT points at a nonexistent tree" "$(rc "$TMPROOT/no_such_spec_tree" --verify)" 0
says x "SKIPPED, NOT PASSED" "$O"
echo "   And the narrow case that must still be FATAL, so the skip cannot be abused:"
D="$(fresh narrow)"; rm -f "$D/PRIOR_ART_SWEEP.md"
want "spec tree EXISTS but one source is missing" "$(rc "$D" --verify)" 2

echo
echo "-- SINK: the generated docs must reach the delta package --------------------"
echo "   make_package.sh copies every file that differs from the baseline tree and"
echo "   does NOT prune docs/. Replicating its exact find+cmp selection:"
BASE="${BASE_TREE:-$REPO_ROOT/.g0-snapshot}"
if [ -d "$BASE" ]; then
  for f in "${DOCNAMES[@]}"; do
    if [ ! -f "$BASE/docs/$f" ] || ! cmp -s "$DOCS/$f" "$BASE/docs/$f"; then
      ok "docs/$f is selected into the delta tree" "(new vs baseline)"
    else
      bad "docs/$f would NOT be packaged" "identical to baseline"
    fi
  done
else
  bad "baseline tree $BASE absent — cannot prove package inclusion"
fi

echo
echo "-- POLE Z: this harness must not have mutated anything real -----------------"
[ "$SPEC_SHA" = "$(cd "$REAL_SPEC" && sha256sum "${SRCS[@]}" | sha256sum | cut -d' ' -f1)" ] \
  && ok "the three spec sources are byte-identical" || bad "HARNESS MUTATED spec/"
[ "$DOCS_SHA" = "$(cd "$DOCS" && sha256sum "${DOCNAMES[@]}" | sha256sum | cut -d' ' -f1)" ] \
  && ok "docs/ restored byte-identical" || bad "docs/ NOT restored"

echo
echo "=============================================================================="
printf 'DOC-1/2/3/4 + DEC-1 FALSIFICATION: %d assertions passed, %d failed\n' "$PASS" "$FAIL"
echo "Proven to FAIL on: a deleted row, a numbering gap, a duplicate id, an"
echo "extractor that matches nothing, a renamed heading, a missing total, a stubbed"
echo "history, any missing or empty source, an unknown flag, a hand-edited package"
echo "doc, and a deleted package doc. It passes only on pristine sources."
echo "=============================================================================="
[ "$FAIL" = "0" ] && exit 0 || exit 1
