#!/usr/bin/env bash
# scripts/__tests__/wave22_item5_minors_falsify.sh
#
# WAVE 22 · ITEM 5 — the three MINORs Review B named.
#
#   (a) PostDetail error conflation. "That post is no longer available, or you
#       do not have visibility into it." was rendered for 404, 403, 500,
#       network failure AND a paused offline query alike. Only the first two
#       are statements the server actually supports; the rest are the client
#       inventing a fact about a record from a fact about a request.
#   (b) A dead duplicate `POST /api/admin/sync/reset-demo` handler in
#       server/routes.ts, shadowed by the live one in server/bridgeStore.ts
#       (registered earlier, at routes.ts:853). The two disagreed on status
#       codes, so the dead one actively misinformed anyone reading the file.
#   (c) A stale guard baseline backup, baseline.REGENERATED_BY_REVIEW_B.json.bak,
#       sitting next to the real baseline. `baseline.json` itself is NOT to be
#       touched, and its sha is pinned here so this harness fails loudly if any
#       wave ever "fixes" a guard drop by editing the baseline.
#
#   bash scripts/__tests__/wave22_item5_minors_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

POST_REL="client/src/pages/PostDetail.tsx"
ROUTES_REL="server/routes.ts"
BRIDGE_REL="server/bridgeStore.ts"
GUARD_DIR="scripts/silent-drop-guard"
BASELINE_SHA_PINNED="8e8b88569ca95ba8c4262fd6ba59f981985acf2489512a777959c096724a0d68"
ROUTE_PATH="/api/admin/sync/reset-demo"
FILES=("$POST_REL" "$ROUTES_REL" "$BRIDGE_REL" "$GUARD_DIR/baseline.json")

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-58s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-58s %s\n' "$1" "${2:-}"; }

code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

# Sandbox: the two server files, the page, and a copy of the guard directory.
fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"; local f
  for f in "$POST_REL" "$ROUTES_REL" "$BRIDGE_REL"; do
    mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"
  done
  mkdir -p "$d/$GUARD_DIR"
  cp -a "$REPO/$GUARD_DIR/." "$d/$GUARD_DIR/"
  echo "$d"
}

# --- (a) ---------------------------------------------------------------------
p_a_discriminates_status() {
  local code; code="$(code_only "$1/$POST_REL")"
  grep -q "404" <<<"$code" || return 1
  grep -q "403" <<<"$code" || return 1
  grep -q "<LoadFailedRefusal" <<<"$code" || return 1
  grep -q "post-detail-error" <<<"$code" || return 1
  return 0
}
p_a_keeps_true_absence_copy() {
  local code; code="$(code_only "$1/$POST_REL")"
  # The original copy is CORRECT for 404/403 and must survive verbatim.
  grep -q "That post is no longer available, or you do not have visibility into it." <<<"$code" || return 1
  grep -q "empty-post" <<<"$code" || return 1
  return 0
}
p_a_handles_paused() {
  local code; code="$(code_only "$1/$POST_REL")"
  grep -q "post-detail-not-loaded" <<<"$code" || return 1
  return 0
}

# --- (b) ---------------------------------------------------------------------
# Count LIVE registrations of the route across the server tree. Comments are
# stripped first, so the long explanatory block left in routes.ts where the
# dead handler used to be — which necessarily quotes the route path — is not
# counted as a registration. Getting that wrong would make this check report
# the duplicate as still present.
# HARNESS BUG, found and recorded rather than papered over. The first version of
# the three route patterns below ended at the path with no closing delimiter, so
# they matched by PREFIX. Mutation M5b2 renames the live route to
# ".../reset-demo-DELETED" — deleting the working endpoint — and the prefix
# pattern happily matched the renamed route and reported the property as still
# holding. That is a real coverage gap in the assertion (not a mutation error):
# any rename or suffix typo on this route would have gone unnoticed. All three
# patterns now require the closing quote/backtick.
route_registrations() {
  local root="$1"; local n=0 f
  while IFS= read -r f; do
    local c; c="$(code_only "$f" | grep -Ec "app\.post\([\"'\`]$ROUTE_PATH[\"'\`]" || true)"
    n=$((n + c))
  done < <(grep -rl --include='*.ts' -- "$ROUTE_PATH" "$root/server" 2>/dev/null)
  echo "$n"
}
p_b_exactly_one() { [ "$(route_registrations "$1")" -eq 1 ]; }
p_b_live_one_survives() {
  code_only "$1/$BRIDGE_REL" | grep -Eq "app\.post\([\"'\`]$ROUTE_PATH[\"'\`]" || return 1
  return 0
}
p_b_dead_one_gone() {
  code_only "$1/$ROUTES_REL" | grep -Eq "app\.post\([\"'\`]$ROUTE_PATH[\"'\`]" && return 1
  return 0
}

# --- (c) ---------------------------------------------------------------------
p_c_no_stale_backup() {
  local root="$1"
  local hits; hits="$(find "$root/$GUARD_DIR" -maxdepth 1 -name 'baseline*.bak' -o -maxdepth 1 -name 'baseline*.json.bak' | wc -l)"
  [ "$hits" -eq 0 ]
}
p_c_baseline_untouched() {
  local root="$1"
  [ "$(sha256sum "$root/$GUARD_DIR/baseline.json" | cut -d' ' -f1)" = "$BASELINE_SHA_PINNED" ]
}

echo "WAVE 22 · ITEM 5 — MINORs falsification"
echo
echo "A. properties hold on the real tree"
p_a_discriminates_status     "$REPO" && ok "5a P1 404/403 discriminated, refusal for the rest" || bad "5a P1 404/403 discriminated, refusal for the rest"
p_a_keeps_true_absence_copy  "$REPO" && ok "5a P2 genuine-absence copy preserved verbatim"     || bad "5a P2 genuine-absence copy preserved verbatim"
p_a_handles_paused           "$REPO" && ok "5a P3 paused/offline state handled separately"     || bad "5a P3 paused/offline state handled separately"
p_b_exactly_one              "$REPO" && ok "5b P1 exactly ONE live registration of the route" "count=$(route_registrations "$REPO")" || bad "5b P1 exactly ONE live registration" "count=$(route_registrations "$REPO")"
p_b_live_one_survives        "$REPO" && ok "5b P2 the LIVE bridgeStore handler still exists"   || bad "5b P2 the LIVE bridgeStore handler still exists"
p_b_dead_one_gone            "$REPO" && ok "5b P3 the dead routes.ts handler is gone"          || bad "5b P3 the dead routes.ts handler is gone"
p_c_no_stale_backup          "$REPO" && ok "5c P1 no stale baseline*.bak in the guard dir"     || bad "5c P1 no stale baseline*.bak in the guard dir"
p_c_baseline_untouched       "$REPO" && ok "5c P2 baseline.json sha unchanged" "$BASELINE_SHA_PINNED" || bad "5c P2 baseline.json sha CHANGED — STOP"
echo

echo "B. mutations must break the corresponding property"

M="$(fresh m5a1)"
python3 - "$M/$POST_REL" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
# Collapse back to the pre-fix conflation: one branch for every non-post case.
s = s.replace('const isGoneOrForbidden = status === 404 || status === 403;',
              'const isGoneOrForbidden = true;')
s = s.replace('<LoadFailedRefusal', '<div data-was="LoadFailedRefusal"')
s = s.replace('post-detail-error', 'post-detail-whatever')
open(p, "w", encoding="utf-8").write(s)
PYEOF
p_a_discriminates_status "$M" && bad "M5a1 re-conflate every failure as 'no longer available'" "MUTATION NOT CAUGHT" || ok "M5a1 re-conflate every failure" "caught"

M="$(fresh m5a2)"
sed -i 's/That post is no longer available, or you do not have visibility into it./Something went wrong./' "$M/$POST_REL"
p_a_keeps_true_absence_copy "$M" && bad "M5a2 over-correct: lose the true-absence copy" "MUTATION NOT CAUGHT" || ok "M5a2 over-correct: lose true-absence copy" "caught"

M="$(fresh m5a3)"
sed -i 's/post-detail-not-loaded/post-detail-empty/' "$M/$POST_REL"
p_a_handles_paused "$M" && bad "M5a3 drop the paused/offline branch" "MUTATION NOT CAUGHT" || ok "M5a3 drop the paused/offline branch" "caught"

# Re-add the dead duplicate exactly as it was.
M="$(fresh m5b1)"
cat >> "$M/$ROUTES_REL" <<'EOF'
export function __regression(app: any, requireAdmin: any, resetDemoState: any) {
  app.post("/api/admin/sync/reset-demo", requireAdmin, (req: any, res: any) => {
    const summary = resetDemoState();
    return res.status(summary.ok ? 200 : 207).json(summary);
  });
}
EOF
p_b_exactly_one "$M" && bad "M5b1 re-add the duplicate handler" "MUTATION NOT CAUGHT (count=$(route_registrations "$M"))" || ok "M5b1 re-add the duplicate handler" "caught"
p_b_dead_one_gone "$M" && bad "M5b1b duplicate in routes.ts undetected" "MUTATION NOT CAUGHT" || ok "M5b1b duplicate in routes.ts undetected" "caught"

# The opposite error: deleting the LIVE handler instead of the dead one. This is
# the mutation that matters most — it is the plausible mistake, and it would
# silently remove a working admin endpoint while every "duplicate removed"
# check still went green.
M="$(fresh m5b2)"
python3 - "$M/$BRIDGE_REL" <<'PYEOF'
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace('app.post("/api/admin/sync/reset-demo"', 'app.post("/api/admin/sync/reset-demo-DELETED"', 1)
open(p, "w", encoding="utf-8").write(s)
PYEOF
p_b_live_one_survives "$M" && bad "M5b2 delete the LIVE handler by mistake" "MUTATION NOT CAUGHT" || ok "M5b2 delete the LIVE handler by mistake" "caught"

M="$(fresh m5c1)"
cp "$M/$GUARD_DIR/baseline.json" "$M/$GUARD_DIR/baseline.REGENERATED_BY_REVIEW_B.json.bak"
p_c_no_stale_backup "$M" && bad "M5c1 stale baseline backup reappears" "MUTATION NOT CAUGHT" || ok "M5c1 stale baseline backup reappears" "caught"

M="$(fresh m5c2)"
printf '\n' >> "$M/$GUARD_DIR/baseline.json"
p_c_baseline_untouched "$M" && bad "M5c2 baseline.json edited by one byte" "MUTATION NOT CAUGHT" || ok "M5c2 baseline.json edited by one byte" "caught"
echo

AFTER_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"
[ "$BEFORE_SHA" = "$AFTER_SHA" ] && ok "Z  real tree unmodified by harness" "$AFTER_SHA" || bad "Z  real tree unmodified by harness" "SHA CHANGED"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
