#!/usr/bin/env bash
# scripts/__tests__/wave22_item3_orphan_link_falsify.sh
#
# WAVE 22 · ITEM 3 — REVIEW B F-1 (MAJOR): /investor/earlier-investments was a
# routed orphan (zero inbound links) whose own code comment claimed it was
# linked.
#
# This project's rule: a page no user can reach is NOT shipped. A route entry in
# App.tsx is not reachability — it is only permission to be reachable.
#
# PROPERTIES
#   P1  The route still exists (the fix must not have "solved" the orphan by
#       deleting the page).
#   P2  At least one inbound link exists OUTSIDE App.tsx. App.tsx is excluded
#       deliberately: the route declaration itself is the thing that fooled the
#       original author into writing the false comment, so counting it would
#       reproduce the exact error being repaired.
#   P3  Both specific inbound links are present — the investor nav entry and
#       the empty-portfolio CTA.
#   P4  The corrected comment does not re-assert the old false claim.
#
#   bash scripts/__tests__/wave22_item3_orphan_link_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

APP_REL="client/src/App.tsx"
NAV_REL="client/src/components/AppShell.tsx"
CTA_REL="client/src/components/investor/PortfolioCompanySwitcher.tsx"
FILES=("$APP_REL" "$NAV_REL" "$CTA_REL")
HREF="/investor/earlier-investments"

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-56s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-56s %s\n' "$1" "${2:-}"; }

# Sandbox holds the whole client/src tree so the "any inbound link anywhere"
# sweep is honest — a sandbox containing only the three files would make P2
# unfalsifiable by construction (it could never find a link we did not copy in),
# which is the "check that checks nothing" shape this wave exists to kill.
fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"; mkdir -p "$d/client"
  cp -a "$REPO/client/src" "$d/client/src"
  echo "$d"
}

code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

p1_route_exists() {
  local root="$1"; local code; code="$(code_only "$root/$APP_REL")"
  grep -q "$HREF" <<<"$code" || return 1
  grep -q "InvestorClaimPositions" <<<"$code" || return 1
  return 0
}

# The orphan sweep: how many files OTHER than App.tsx mention the href in
# executable (non-comment) code?
inbound_count() {
  local root="$1"; local n=0 f
  while IFS= read -r f; do
    case "$f" in *"/App.tsx") continue;; esac
    if code_only "$f" | grep -q -- "$HREF"; then n=$((n+1)); fi
  done < <(grep -rl --include='*.tsx' --include='*.ts' -- "$HREF" "$root/client/src" 2>/dev/null)
  echo "$n"
}

p2_not_an_orphan() { [ "$(inbound_count "$1")" -ge 1 ]; }

p3_both_named_links() {
  local root="$1"
  code_only "$root/$NAV_REL" | grep -q -- "$HREF" || return 1
  code_only "$root/$CTA_REL" | grep -q "button-portfolio-claim-earlier" || return 1
  return 0
}

p4_comment_not_lying() {
  local root="$1"
  # The corrected block must name both real link sites...
  grep -q "AppShell.tsx" "$root/$APP_REL" || return 1
  grep -q "button-portfolio-claim-earlier" "$root/$APP_REL" || return 1
  # ...and, if it still claims to be linked, that claim must be true.
  if grep -qi "linked here" "$root/$APP_REL"; then
    p2_not_an_orphan "$root" || return 1
  fi
  return 0
}

echo "WAVE 22 · ITEM 3 — F-1 routed-orphan falsification"
echo
echo "A. properties hold on the real tree"
p1_route_exists     "$REPO" && ok "P1 route still declared"            || bad "P1 route still declared"
p2_not_an_orphan    "$REPO" && ok "P2 >=1 inbound link outside App.tsx" "count=$(inbound_count "$REPO")" || bad "P2 >=1 inbound link outside App.tsx"
p3_both_named_links "$REPO" && ok "P3 nav entry AND empty-portfolio CTA" || bad "P3 nav entry AND empty-portfolio CTA"
p4_comment_not_lying "$REPO" && ok "P4 comment matches reality"         || bad "P4 comment matches reality"
echo

echo "B. mutations must break the corresponding property"

M="$(fresh m3a)"
sed -i "s#$HREF#/investor/gone#g" "$M/$APP_REL"
p1_route_exists "$M" && bad "M3a delete the route" "MUTATION NOT CAUGHT" || ok "M3a delete the route" "caught"

# The headline mutation: restore the pre-wave world exactly — route present,
# every inbound link removed. If P2 survives this, the orphan check is theatre.
M="$(fresh m3b)"
while IFS= read -r f; do
  case "$f" in *"/App.tsx") continue;; esac
  sed -i "s#$HREF#/investor/portfolio#g" "$f"
done < <(grep -rl --include='*.tsx' --include='*.ts' -- "$HREF" "$M/client/src")
p2_not_an_orphan "$M" && bad "M3b remove ALL inbound links (pre-wave state)" "MUTATION NOT CAUGHT" || ok "M3b remove ALL inbound links (pre-wave state)" "caught"

M="$(fresh m3c)"
sed -i "s#$HREF#/investor/portfolio#g" "$M/$NAV_REL"
p3_both_named_links "$M" && bad "M3c remove the investor nav entry" "MUTATION NOT CAUGHT" || ok "M3c remove the investor nav entry" "caught"

M="$(fresh m3d)"
sed -i 's/button-portfolio-claim-earlier/button-portfolio-something-else/g' "$M/$CTA_REL"
p3_both_named_links "$M" && bad "M3d remove the empty-portfolio CTA" "MUTATION NOT CAUGHT" || ok "M3d remove the empty-portfolio CTA" "caught"

# Re-create the ORIGINAL sin: a comment that claims a link, with no link.
M="$(fresh m3e)"
while IFS= read -r f; do
  case "$f" in *"/App.tsx") continue;; esac
  sed -i "s#$HREF#/investor/portfolio#g" "$f"
done < <(grep -rl --include='*.tsx' --include='*.ts' -- "$HREF" "$M/client/src")
python3 - "$M/$APP_REL" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = s.replace("WAVE 22 · ITEM 3", "Linked here rather than buried in settings — WAVE 22 · ITEM 3", 1)
open(p, "w", encoding="utf-8").write(s)
PYEOF
p4_comment_not_lying "$M" && bad "M3e comment claims a link that is gone" "MUTATION NOT CAUGHT" || ok "M3e comment claims a link that is gone" "caught"

M="$(fresh m3f)"
sed -i 's/AppShell\.tsx/somewhere/g' "$M/$APP_REL"
p4_comment_not_lying "$M" && bad "M3f comment stops naming its link sites" "MUTATION NOT CAUGHT" || ok "M3f comment stops naming its link sites" "caught"
echo

AFTER_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"
[ "$BEFORE_SHA" = "$AFTER_SHA" ] && ok "Z  real tree unmodified by harness" "$AFTER_SHA" || bad "Z  real tree unmodified by harness" "SHA CHANGED"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
