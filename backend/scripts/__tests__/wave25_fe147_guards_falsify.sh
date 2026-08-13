#!/usr/bin/env bash
# scripts/__tests__/wave25_fe147_guards_falsify.sh
#
# WAVE 25 / FE-1 + FE-4 + FE-7 — three guards that were promised and absent.
#
# THE DEFECTS THIS PINS
# ---------------------
# FE-1  The mandate tab printed "Geography: Any · Stage: Any" when NO mandate
#       row existed, while deployCapital throws NO_MANDATE
#       (spvEngineStore.ts:1517) and isCompanyEligible returns NO_MANDATE
#       (:601). A fabricated permissive fact. Separately, checkMinMinor /
#       checkMaxMinor had NO min<=max, integer or range validation on either
#       side, so min 500000 / max 100000 persisted.
#
# FE-4  createTransfer's ONLY server-side condition was "both party ids are
#       non-empty". The UI refused self-transfers and consideration-less
#       transfers; the route accepted both. And the wind-down panel promises
#       "no further capital calls, distributions, or transfers can be
#       recorded" while `grep -n wound_down server/spvEngineStore.ts` showed
#       the status was written, emitted, and then read by nothing but three
#       status-mapping case arms. A UI promise the engine did not keep.
#
# FE-7  GET+PUT /api/partner/me/compliance/:investorId — IDOR-guarded, zod
#       .strict()-validated, gateStatus() behind them — had ZERO client
#       callers on either verb. `grep -rn "me/compliance" client/` was empty.
#
# BOTH POLES ARE ASSERTED. Every predicate has a mutation that must make it
# FAIL. A check that cannot fail is a check that checks nothing — this project
# has been bitten by thirteen of those.
#
#   bash scripts/__tests__/wave25_fe147_guards_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

STORE_REL="server/spvEngineStore.ts"
ROUTES_REL="server/spvEngineRoutes.ts"
TABS_REL="client/src/components/partner/SpvDetailTabs.tsx"
FILES=("$STORE_REL" "$ROUTES_REL" "$TABS_REL")

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-56s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-56s %s\n' "$1" "${2:-}"; }

code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"; local f
  for f in "${FILES[@]}"; do
    mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"
  done
  echo "$d"
}

# ── FE-1 predicates ──────────────────────────────────────────────────────────

# P1 — the check-size bounds live AT THE SINK (the store), not only in the
#      panel. A client-only check is bypassed by the route, and the Create-SPV
#      wizard posts to that same route.
p1_store_bounds_check_size() {
  local code; code="$(code_only "$1/$STORE_REL")"
  grep -q 'INVALID_CHECK_MIN' <<<"$code" || return 1
  grep -q 'INVALID_CHECK_MAX' <<<"$code" || return 1
  grep -q 'INVALID_CHECK_RANGE' <<<"$code" || return 1
  return 0
}

# P2 — the three codes are MAPPED to HTTP status. An unmapped throw becomes a
#      500 "internal error", which reads to the GP as a platform fault rather
#      than as their own inverted input.
p2_route_maps_check_codes() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q 'INVALID_CHECK_MIN: 400' <<<"$code" || return 1
  grep -q 'INVALID_CHECK_MAX: 400' <<<"$code" || return 1
  grep -q 'INVALID_CHECK_RANGE: 400' <<<"$code" || return 1
  return 0
}

# P3 — rule 7. The no-mandate state is RENDERED as its own thing, and the
#      permissive literals are CONDITIONAL on a mandate actually existing.
#
#      THE FIRST DRAFT OF THIS PREDICATE WAS A CHECK THAT CHECKED NOTHING, and
#      mutation m3 caught it. It grepped for the bare identifier
#      `MandateEmptyState`, so renaming the component to
#      `MandateEmptyStateUnused_` — which un-mounts it entirely — left the
#      predicate green because the old name is a SUBSTRING of the new one.
#      That is both a harness bug (careless anchor) and a REAL COVERAGE GAP:
#      "an identifier appears somewhere" is not the claim FE-1 makes. The claim
#      is "with no mandate row, the tab does not assert that anything is
#      permitted". Same family as the FE-3 p7 failure.
#
#      Structural now: the mandate block is extracted from source, and EVERY
#      occurrence of the permissive literals inside it must be guarded by
#      `detail.mandate ?`. An unconditional "Any" fails.
p3_mandate_empty_state_rendered() {
  python3 - "$1/$TABS_REL" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
start = src.find('data-testid="spv-detail-mandate"')
if start < 0:
    sys.exit(1)
end = src.find("</TabsContent>", start)
if end < 0:
    sys.exit(1)
block = src[start:end]
# the empty state must be MOUNTED (not merely defined somewhere in the file)
if block.count("<MandateEmptyState ") != 1:
    sys.exit(1)
# and it must actually be a defined component, mounted under its real name
if len(re.findall(r"function MandateEmptyState\(", src)) != 1:
    sys.exit(1)
# every permissive literal in the block must sit on a `detail.mandate ?` branch
for lit in ('"Any"', '"None selected"'):
    total = block.count(lit)
    guarded = block.count("detail.mandate ? " + lit)
    if total == 0 or total != guarded:
        sys.stderr.write("unguarded %s: %d of %d guarded\n" % (lit, guarded, total))
        sys.exit(1)
sys.exit(0)
PY
}

# ── FE-4 predicates ──────────────────────────────────────────────────────────

# P4 — all four missing transfer guards are at the sink.
p4_store_guards_transfer() {
  local code; code="$(code_only "$1/$STORE_REL")"
  grep -q 'TRANSFER_SELF' <<<"$code" || return 1
  grep -q 'TRANSFER_CONSIDERATION_REQUIRED' <<<"$code" || return 1
  grep -q 'INVALID_UNITS_PCT' <<<"$code" || return 1
  return 0
}

# P5 — THE ONE THAT MATTERS. The wind-down promise is enforced for transfers.
#      Asserted structurally: the SPV_WOUND_DOWN throw must sit INSIDE
#      createTransfer's body, not merely somewhere in a 3400-line file.
#
#      A "the string appears somewhere" predicate is exactly the shape that
#      mutation m7 defeated in the FE-3 harness. Not repeating that.
p5_winddown_blocks_transfer() {
  python3 - "$1/$STORE_REL" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
SIG = "  createTransfer("
i = src.find(SIG)
if i < 0 or src.count(SIG) != 1:
    sys.exit(1)
# brace-match from the opening brace of the BODY: skip the parameter list and
# the return-type annotation by anchoring on the signature terminator.
term = "): SpvTransferDTO {"
j = src.find(term, i)
if j < 0:
    sys.exit(1)
j = j + len(term) - 1
depth = 0
for k in range(j, len(src)):
    if src[k] == "{":
        depth += 1
    elif src[k] == "}":
        depth -= 1
        if depth == 0:
            break
body = src[j + 1 : k]
body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
body = re.sub(r"//[^\n]*", "", body)
if 'throw new Error("SPV_WOUND_DOWN")' not in body:
    sys.exit(1)
# the refusal must precede the write, or it refuses nothing
if body.index('throw new Error("SPV_WOUND_DOWN")') > body.index("persist("):
    sys.exit(1)
# and it must be keyed on the real status value the store writes at :519
if 's.status === "wound_down"' not in body:
    sys.exit(1)
sys.exit(0)
PY
}

# P6 — rule 6. `unitsPct` is a FRACTION. A value above 1 must be REJECTED, not
#      silently divided by 100. The forbidden coercion must not appear.
p6_units_pct_is_a_fraction() {
  local code; code="$(code_only "$1/$STORE_REL")"
  grep -q 'INVALID_UNITS_PCT' <<<"$code" || return 1
  grep -qE '\(data\.unitsPct as number\) > 1' <<<"$code" || return 1
  # NOTE: this line read `unitsPct[^\n]*/[[:space:]]*100` and mutation m7 sailed
  # straight past it. In a POSIX bracket expression `[^\n]` is "not backslash
  # and not the letter n" — it does NOT mean "not newline". Every realistic
  # coercion (`(data.unitsPct as number) / 100`) contains the letter n in
  # "number", so the regex could never match and the negative assertion was
  # inert: a check that passed while checking nothing, in its purest form.
  # grep is line-oriented, so `.*` is what was meant all along.
  grep -qE 'unitsPct.*/[[:space:]]*100' <<<"$code" && return 1
  return 0
}

# P7 — the four codes are mapped, and SPV_WOUND_DOWN is a 409 (state conflict),
#      not a 400 (malformed request). The request was fine; the vehicle is not.
p7_route_maps_transfer_codes() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q 'TRANSFER_SELF: 400' <<<"$code" || return 1
  grep -q 'TRANSFER_CONSIDERATION_REQUIRED: 400' <<<"$code" || return 1
  grep -q 'INVALID_UNITS_PCT: 400' <<<"$code" || return 1
  grep -q 'SPV_WOUND_DOWN: 409' <<<"$code" || return 1
  return 0
}

# P8 — the transfers empty state (already delivered pre-wave) is still there.
#      ANTI-DROP: this wave must not lose a surface while adding guards. RS-1
#      and RS-2 were lost exactly this way in July.
p8_transfers_empty_state_survives() {
  local code; code="$(code_only "$1/$TABS_REL")"
  grep -q 'transfers.length === 0' <<<"$code" || return 1
  grep -q 'no transfers' <<<"$code" || return 1
  return 0
}

# ── FE-7 predicates ──────────────────────────────────────────────────────────

# P9 — the orphaned route has a client caller, on BOTH verbs. A GET-only wiring
#      would leave the write path exactly as orphaned as it was.
p9_compliance_write_path_wired() {
  local code; code="$(code_only "$1/$TABS_REL")"
  grep -q 'InvestorCompliancePanel' <<<"$code" || return 1
  grep -qE 'apiRequest\("PUT", `/api/partner/me/compliance/' <<<"$code" || return 1
  grep -qE 'apiRequest\("GET", `/api/partner/me/compliance/' <<<"$code" || return 1
  # and it must be MOUNTED, not merely defined. An unmounted component is not
  # shipped — the standing owner rule, in its most literal form.
  grep -q '<InvestorCompliancePanel' <<<"$code" || return 1
  return 0
}

# P10 — rule 7 for compliance. A failed profile read must NOT render as a
#       status. "KYC: Not recorded" for a profile we could not load is a
#       fabricated compliance fact, the same defect as a fabricated $0.
p10_compliance_fails_closed() {
  local code; code="$(code_only "$1/$TABS_REL")"
  grep -q 'spv-investor-compliance-error' <<<"$code" || return 1
  grep -q 'q.isError' <<<"$code" || return 1
  # loading, error and "no profile yet" must be three DISTINCT branches
  grep -q 'spv-investor-compliance-loading' <<<"$code" || return 1
  grep -q 'No compliance profile recorded for this investor yet' <<<"$code" || return 1
  return 0
}

# P11 — THE DRIFT CHECK. The client's dropdown options must be exactly the
#       enum values the server's zod .strict() schema accepts. If they drift,
#       the GP is offered a status the server will reject with a 400 — a
#       control that looks live and is not. Compared as SETS, from source.
p11_compliance_enums_match_server() {
  python3 - "$1/$ROUTES_REL" "$1/$TABS_REL" <<'PY'
import re, sys
routes = open(sys.argv[1], encoding="utf-8").read()
tabs = open(sys.argv[2], encoding="utf-8").read()

def zod_enum(field):
    m = re.search(field + r":\s*z\.enum\(\[([^\]]*)\]\)", routes)
    if not m:
        return None
    return set(re.findall(r'"([^"]+)"', m.group(1)))

def client_list(name):
    m = re.search(name + r"\s*=\s*\[([^\]]*)\]\s*as const", tabs)
    if not m:
        return None
    return set(re.findall(r'"([^"]+)"', m.group(1)))

pairs = [("kycStatus", "KYC_STATUSES"), ("accreditationStatus", "ACCREDITATION_STATUSES")]
for zfield, cname in pairs:
    z, c = zod_enum(zfield), client_list(cname)
    if z is None or c is None or not z or z != c:
        sys.stderr.write("enum drift %s: server=%s client=%s\n" % (zfield, sorted(z or []), sorted(c or [])))
        sys.exit(1)
sys.exit(0)
PY
}

# P12 — ANCHOR UNIQUENESS. Every anchor the mutations target must occur exactly
#       once, or a mutation could silently no-op against a second copy and be
#       scored as "caught" when nothing was tested.
p12_anchors_unique() {
  local n
  n=$(grep -c 'throw new Error("TRANSFER_SELF")' "$1/$STORE_REL");             [ "$n" = 1 ] || { echo "TRANSFER_SELF throw x$n" >&2; return 1; }
  n=$(grep -c 'throw new Error("SPV_WOUND_DOWN")' "$1/$STORE_REL");            [ "$n" = 1 ] || { echo "SPV_WOUND_DOWN throw x$n" >&2; return 1; }
  n=$(grep -c 'throw new Error("TRANSFER_CONSIDERATION_REQUIRED")' "$1/$STORE_REL"); [ "$n" = 1 ] || return 1
  n=$(grep -c 'SPV_WOUND_DOWN: 409' "$1/$ROUTES_REL");                         [ "$n" = 1 ] || return 1
  n=$(grep -c '<InvestorCompliancePanel' "$1/$TABS_REL");                      [ "$n" = 1 ] || return 1
  n=$(grep -c 'spv-investor-compliance-error' "$1/$TABS_REL");                 [ "$n" = 1 ] || return 1
  n=$(grep -c 'const KYC_STATUSES' "$1/$TABS_REL");                            [ "$n" = 1 ] || return 1
  return 0
}

# ── positive pass ────────────────────────────────────────────────────────────
echo "WAVE 25 / FE-1 + FE-4 + FE-7 — mandate bounds, transfer guard, compliance write path"
echo
echo "POSITIVE (the tree as built must satisfy every predicate)"
BASE="$(fresh base)"
for p in p1_store_bounds_check_size p2_route_maps_check_codes \
         p3_mandate_empty_state_rendered p4_store_guards_transfer \
         p5_winddown_blocks_transfer p6_units_pct_is_a_fraction \
         p7_route_maps_transfer_codes p8_transfers_empty_state_survives \
         p9_compliance_write_path_wired p10_compliance_fails_closed \
         p11_compliance_enums_match_server p12_anchors_unique; do
  if "$p" "$BASE"; then ok "$p"; else bad "$p" "predicate false on the real tree"; fi
done

# ── mutations: each must be CAUGHT ───────────────────────────────────────────
echo
echo "NEGATIVE (each mutation reintroduces the defect and MUST be caught)"

mutate() {
  # $1 name  $2 predicate  $3 file-rel  $4 old=>new
  local d; d="$(fresh "$1")"
  python3 - "$d/$3" "$4" <<'PY'
import sys
path, spec = sys.argv[1], sys.argv[2]
old, new = spec.split("=>", 1)
s = open(path, encoding="utf-8").read()
if old not in s:
    sys.stderr.write("MUTATION ANCHOR ABSENT: %r\n" % old); sys.exit(3)
if s.count(old) != 1:
    sys.stderr.write("MUTATION ANCHOR NOT UNIQUE (%d): %r\n" % (s.count(old), old)); sys.exit(3)
open(path, "w", encoding="utf-8").write(s.replace(old, new))
PY
  local rc=$?
  if [ $rc -ne 0 ]; then bad "$1" "could not apply mutation (anchor missing/duplicated)"; return; fi
  if "$2" "$d"; then
    bad "$1" "MUTATION MISSED — predicate $2 still passes with the defect reintroduced"
  else
    ok "$1" "caught by $2"
  fi
}

# FE-1 — drop the range check at the sink (the original defect).
mutate m1_drop_check_range p1_store_bounds_check_size "$STORE_REL" \
  'INVALID_CHECK_RANGE=>CHECK_RANGE_OK_WHATEVER'

# FE-1 — leave the throw but unmap it, so a GP's inverted input reads as a 500.
mutate m2_unmap_check_range p2_route_maps_check_codes "$ROUTES_REL" \
  'INVALID_CHECK_RANGE: 400=>INVALID_CHECK_RANGE_TYPO: 400'

# FE-1 — restore the fabricated permissive fact: print "Any" unconditionally,
#        so a GP with no mandate row is told every geography is in scope while
#        deployCapital throws NO_MANDATE for all of them.
mutate m3_fabricated_any p3_mandate_empty_state_rendered "$TABS_REL" \
  'detail.mandate?.geography?.length ? detail.mandate.geography.join(", ") : detail.mandate ? "Any" : "—"=>detail.mandate?.geography?.length ? detail.mandate.geography.join(", ") : "Any"'

# FE-1 — un-mount the empty state by renaming it. The original m3 did exactly
#        this and was MISSED, because the old name is a substring of the new
#        one. Kept as its own mutation now that p3 is structural.
mutate m3b_empty_state_unmounted p3_mandate_empty_state_rendered "$TABS_REL" \
  '<MandateEmptyState mandate={detail.mandate ?? null} canWrite={canWrite} />=>'

# FE-4 — restore the self-transfer hole.
mutate m4_allow_self_transfer p4_store_guards_transfer "$STORE_REL" \
  'throw new Error("TRANSFER_SELF")=>void 0'

# FE-4 — THE BIG ONE. Restore the broken wind-down promise.
mutate m5_winddown_not_enforced p5_winddown_blocks_transfer "$STORE_REL" \
  'if (s.status === "wound_down") throw new Error("SPV_WOUND_DOWN");=>'

# FE-4 — subtle, and the realistic version of this bug: keep the guard, keep
#        the throw, keep it before the write — but key it on a status string
#        the store NEVER writes. The code reads as fully guarded and fires
#        never. `wound_down` is the value written at spvEngineStore.ts:519;
#        anything else is a guard against a state that does not exist.
mutate m6_winddown_keyed_on_dead_status p5_winddown_blocks_transfer "$STORE_REL" \
  's.status === "wound_down"=>s.status === "archived"'

# FE-4 — reintroduce the forbidden percent coercion.
mutate m7_percent_coercion p6_units_pct_is_a_fraction "$STORE_REL" \
  'if (hasUnits && (!Number.isFinite(data.unitsPct) || (data.unitsPct as number) <= 0 || (data.unitsPct as number) > 1)) {=>if (hasUnits) { data.unitsPct = (data.unitsPct as number) / 100; if (false) {'

# FE-4 — downgrade the state conflict to a malformed-request 400.
mutate m8_winddown_wrong_status p7_route_maps_transfer_codes "$ROUTES_REL" \
  'SPV_WOUND_DOWN: 409=>SPV_WOUND_DOWN: 400'

# FE-4 — ANTI-DROP: delete the pre-existing transfers empty state.
mutate m9_drop_transfers_empty_state p8_transfers_empty_state_survives "$TABS_REL" \
  'no transfers=>'

# FE-7 — define the panel but never mount it. This is the exact state the route
#        was already in, one level up: built, not shipped.
mutate m10_panel_defined_not_mounted p9_compliance_write_path_wired "$TABS_REL" \
  '<InvestorCompliancePanel register={register} canWrite={canWrite} />=>'

# FE-7 — wire the read but not the write, leaving the PUT orphaned.
mutate m11_get_only_no_put p9_compliance_write_path_wired "$TABS_REL" \
  'apiRequest("PUT", `/api/partner/me/compliance/=>apiRequest("POST", `/api/partner/me/somewhere-else/'

# FE-7 — collapse the error branch into the normal one: a failed read would
#        render "Not recorded", a fabricated compliance fact.
mutate m12_compliance_error_branch_removed p10_compliance_fails_closed "$TABS_REL" \
  'spv-investor-compliance-error=>spv-investor-compliance-gates-dup'

# FE-7 — drift the client enum away from the server's zod schema by offering a
#        status the server will reject. The control still LOOKS live.
mutate m13_enum_drift p11_compliance_enums_match_server "$TABS_REL" \
  'const KYC_STATUSES = ["none", "pending", "verified", "expired", "manual_review"] as const;=>const KYC_STATUSES = ["none", "pending", "verified", "expired", "manual_review", "waived"] as const;'

# ── the harness must not have edited the tree ────────────────────────────────
echo
AFTER_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  ok "source_unchanged" "$BEFORE_SHA"
else
  bad "source_unchanged" "THE HARNESS MUTATED THE REAL TREE"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ] || exit 1
