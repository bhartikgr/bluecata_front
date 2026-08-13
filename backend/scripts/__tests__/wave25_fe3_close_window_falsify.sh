#!/usr/bin/env bash
# scripts/__tests__/wave25_fe3_close_window_falsify.sh
#
# WAVE 25 / FE-3 — "the rolling-close window comes from admin config".
#
# THE DEFECT THIS PINS
# --------------------
# FE-3 was HALF-APPLIED. `resolveCloseWindowDays` landed in WAVE 6 at
# server/lib/spvFeeScheduleStore.ts:461 with the correct fail-closed ladder
# (spv -> partner -> platform, THROW on nothing) and then had **zero callers**,
# while the literal `30` stayed at:
#     server/spvEngineRoutes.ts:687           `... : 30;`
#     client/.../SpvDetailTabs.tsx:1153/1159  `{ windowDays: 30 }`
# A policy resolver nothing consults is a dead promise: an admin could edit the
# row, restart, and observe nothing change.
#
# BOTH POLES ARE ASSERTED. Each check has a POSITIVE predicate (the fix is
# present) and a MUTATION that must make the predicate FAIL. A check that
# cannot fail is a check that checks nothing — this project has been bitten by
# thirteen of those.
#
#   bash scripts/__tests__/wave25_fe3_close_window_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

ROUTES_REL="server/spvEngineRoutes.ts"
TABS_REL="client/src/components/partner/SpvDetailTabs.tsx"
STORE_REL="server/lib/spvFeeScheduleStore.ts"
FILES=("$ROUTES_REL" "$TABS_REL" "$STORE_REL")

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-58s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-58s %s\n' "$1" "${2:-}"; }

code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"; local f
  for f in "${FILES[@]}"; do
    mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"
  done
  echo "$d"
}

# ── predicates ───────────────────────────────────────────────────────────────

# P1 — the route WIRES the resolver. Import AND call, both, in code (not a
#      comment): an import with no call is exactly the state FE-3 was in.
p1_route_calls_resolver() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q 'import { resolveCloseWindowDays }' <<<"$code" || return 1
  grep -q 'resolveCloseWindowDays({' <<<"$code" || return 1
  return 0
}

# P2 — the route no longer carries a literal 30-day fallback on the reopen
#      path. Asserted on comment-stripped code so the explanatory prose that
#      quotes the old literal cannot make this pass.
p2_route_has_no_literal_30() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q 'b.windowDays' <<<"$code" || return 1          # the field still exists
  grep -qE 'windowDays[^\n]*:[[:space:]]*30\b' <<<"$code" && return 1
  return 0
}

# P3 — a client-supplied window that disagrees with policy is REJECTED loudly,
#      not silently ignored. Silently ignoring a field the caller set is the
#      "check that passed while checking nothing" failure mode in request form.
p3_route_rejects_disagreeing_window() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q 'INVALID_CLOSE_WINDOW' <<<"$code" || return 1
  grep -q 'asked !== policy.windowDays' <<<"$code" || return 1
  return 0
}

# P4 — the GP-facing read route exists, so the UI can render the real number.
p4_close_window_route_exists() {
  local code; code="$(code_only "$1/$ROUTES_REL")"
  grep -q '"/api/partner/me/spv/:spvId/close-window"' <<<"$code" || return 1
  return 0
}

# P5 — the client no longer posts a hardcoded 30 and reads the policy instead.
p5_client_reads_policy() {
  local code; code="$(code_only "$1/$TABS_REL")"
  grep -q 'windowDays: closeWindowDays' <<<"$code" || return 1
  grep -q 'close-window' <<<"$code" || return 1
  grep -qE '\{[[:space:]]*windowDays:[[:space:]]*30[[:space:]]*\}' <<<"$code" && return 1
  return 0
}

# P6 — rule 7. The unavailable state is RENDERED and the action is DISABLED.
#      A fabricated "30 days" or a silent blank both fail this.
p6_client_renders_fail_closed() {
  local code; code="$(code_only "$1/$TABS_REL")"
  grep -q 'spv-close-window-unavailable' <<<"$code" || return 1
  grep -q 'closeWindowDays == null' <<<"$code" || return 1
  return 0
}

# P7 — the resolver itself still fails closed.
#
#   THE FIRST DRAFT OF THIS PREDICATE WAS A CHECK THAT CHECKED NOTHING, and
#   mutation m7 caught it. It asserted only that the string
#   `throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING)` appeared SOMEWHERE in
#   the file. That string appears three times (no-handle guard, range guard,
#   ladder fallthrough), so replacing the FALLTHROUGH with a
#   `return { windowDays: 30 }` left the predicate green while the dead promise
#   was fully restored. That was a REAL COVERAGE GAP, not a harness typo:
#   "a throw exists somewhere" is not the claim FE-3 makes. The claim is
#   "the ladder EXHAUSTING is a refusal".
#
#   The predicate is therefore structural now: brace-match the body of
#   resolveCloseWindowDays, strip comments, and require that the statement
#   reached when the loop finds nothing IS the throw, that there is no second
#   `return` (a default), and that all three scopes are consulted.
p7_resolver_still_throws() {
  python3 - "$1/$STORE_REL" <<'PY'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
# Anchor on the SIGNATURE TERMINATOR, not on the function name: the parameter
# list contains a `= {}` default, and brace-matching from the first `{` after
# the name matched that empty object and yielded an EMPTY body — a predicate
# that then failed for a reason unrelated to its claim. Same family of bug as
# the one m7 exposed, found while fixing m7.
SIG = "export function resolveCloseWindowDays(scope: SpvFeeScope = {}): SpvCloseWindowPolicy {"
i = src.find(SIG)
if i < 0 or src.count(SIG) != 1:
    sys.exit(1)
j = i + len(SIG) - 1
depth = 0
k = j
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
stmts = [x.strip() for x in body.strip().split("\n") if x.strip()]
if not stmts:
    sys.exit(1)
# (a) the LAST statement of the body must be the refusal
if stmts[-1] != "throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING);":
    sys.exit(1)
# (b) exactly one `return` — the in-loop hit. A second one is a default.
if body.count("return ") != 1:
    sys.exit(1)
# (c) the ladder must consult all three scopes
for needle in ('["spv", scope.spvId]', '["partner", scope.partnerId]', '["platform", "*"]'):
    if needle not in body:
        sys.exit(1)
sys.exit(0)
PY
}

# P8 — ANCHOR UNIQUENESS. Each anchor the mutations below target must occur
#      exactly once, or a mutation could silently no-op against a second copy.
#      NOTE: `resolveCloseWindowDays({` legitimately occurs TWICE — once in the
#      read route and once in the reopen route — so the anchor pinned as unique
#      is the longer, reopen-specific form the mutations actually target. The
#      count of 2 is itself asserted, so adding a third unreviewed call site
#      trips this check.
p8_anchors_unique() {
  local n
  n=$(grep -c 'const policy = resolveCloseWindowDays({' "$1/$ROUTES_REL"); [ "$n" = 1 ] || { echo "reopen resolver call x$n" >&2; return 1; }
  n=$(grep -c 'resolveCloseWindowDays({' "$1/$ROUTES_REL"); [ "$n" = 2 ] || { echo "resolver calls x$n (expected 2: read route + reopen)" >&2; return 1; }
  n=$(grep -c 'asked !== policy.windowDays' "$1/$ROUTES_REL"); [ "$n" = 1 ] || return 1
  n=$(grep -c 'windowDays: closeWindowDays' "$1/$TABS_REL"); [ "$n" = 1 ] || return 1
  n=$(grep -c 'spv-close-window-unavailable' "$1/$TABS_REL"); [ "$n" = 1 ] || return 1
  return 0
}

# ── positive pass ────────────────────────────────────────────────────────────
echo "WAVE 25 / FE-3 — rolling-close window resolver wiring"
echo
echo "POSITIVE (the tree as built must satisfy every predicate)"
BASE="$(fresh base)"
for p in p1_route_calls_resolver p2_route_has_no_literal_30 \
         p3_route_rejects_disagreeing_window p4_close_window_route_exists \
         p5_client_reads_policy p6_client_renders_fail_closed \
         p7_resolver_still_throws p8_anchors_unique; do
  if "$p" "$BASE"; then ok "$p"; else bad "$p" "predicate false on the real tree"; fi
done

# ── mutations: each must be CAUGHT ───────────────────────────────────────────
echo
echo "NEGATIVE (each mutation reintroduces the defect and MUST be caught)"

mutate() {
  # $1 name  $2 predicate  $3 file-rel  $4 sed-expr
  local d; d="$(fresh "$1")"
  python3 - "$d/$3" "$4" <<'PY'
import sys, re
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

# M1 — unwire the resolver and put the literal 30 back. The exact pre-wave state.
mutate m1_relit_30 p2_route_has_no_literal_30 "$ROUTES_REL" \
  'const policy = resolveCloseWindowDays({=>const policy = { windowDays: 30 }; const _unused = ((x:any)=>x)({'

# M2 — keep the resolver call but drop the disagreement rejection, i.e. silently
#      ignore a caller-supplied window. This is the subtle one.
mutate m2_silent_ignore p3_route_rejects_disagreeing_window "$ROUTES_REL" \
  'if (!Number.isFinite(asked) || asked !== policy.windowDays) throw new Error("INVALID_CLOSE_WINDOW");=>void asked;'

# M3 — remove the read route; the UI would have nothing to render from.
mutate m3_drop_read_route p4_close_window_route_exists "$ROUTES_REL" \
  '"/api/partner/me/spv/:spvId/close-window"=>"/api/partner/me/spv/:spvId/close-window-DISABLED"'

# M4 — client goes back to posting a literal 30.
mutate m4_client_relit_30 p5_client_reads_policy "$TABS_REL" \
  '{ windowDays: closeWindowDays }=>{ windowDays: 30 }'

# M5 — client stops rendering the fail-closed state (rule 7 violation).
mutate m5_hide_failclosed p6_client_renders_fail_closed "$TABS_REL" \
  'data-testid="spv-close-window-unavailable"=>data-testid="spv-close-window-hidden"'

# M6 — client renders the refusal but leaves the button enabled, so a GP can
#      fire a reopen with an undefined window.
mutate m6_button_still_enabled p6_client_renders_fail_closed "$TABS_REL" \
  'disabled={reopen.isPending || closeWindowDays == null}=>disabled={reopen.isPending}'

# M7 — the resolver quietly restores 30. Every wiring predicate above would
#      still pass; only P7 catches this.
mutate m7_resolver_defaults p7_resolver_still_throws "$STORE_REL" \
  '  throw new Error(SPV_CLOSE_WINDOW_POLICY_MISSING);
}

/** Test-only=>  return { windowDays: 30, scopeKind: "platform", scopeId: "*", policyId: "fallback" };
}

/** Test-only'

# ── source must be untouched ─────────────────────────────────────────────────
echo
AFTER_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then ok "source_untouched" "$AFTER_SHA"
else bad "source_untouched" "harness mutated the real tree"; fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
