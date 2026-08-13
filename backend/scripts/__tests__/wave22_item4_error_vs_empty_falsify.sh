#!/usr/bin/env bash
# scripts/__tests__/wave22_item4_error_vs_empty_falsify.sh
#
# WAVE 22 · ITEM 4 — REVIEW B F-4 (MAJOR): error branches rendered a fake empty
# state on nine non-partner pages. A 403 or a 500 produced "No contacts yet",
# "No payments recorded yet", "No files yet" — the platform telling a user a
# fact about their data when all it knows is that a request failed.
#
# The partner-side instance was fixed in Wave 18 (W-4). That fix is the
# reference shape, and Wave 18 recorded something this harness must therefore
# test explicitly: their FIRST falsification run MISSED the removal of the
# `isSuccess` gate, because a query that is neither loading nor errored is not
# necessarily successful — a PAUSED (offline) query is all three of "not
# loading", "not error", "no data". Gating an empty state on `!isLoading &&
# !isError` alone re-opens the bug for every offline user. So every page below
# is asserted on isError AND isSuccess, and both are mutated separately.
#
# PROPERTIES (per page)
#   P1  The page imports the shared refusal component.
#   P2  The page has at least one `isError` branch.
#   P3  The page gates on `isSuccess` (the Wave 18 lesson).
#   P4  No queryFn swallows a failure into an empty array
#       (`if (!res.ok) return []`, `catch { return [] }`).
# PLUS, on the shared component itself:
#   P5  It renders role="alert" as a SIBLING element and offers a retry
#       affordance. (Guard rule: appending text INSIDE an existing text node
#       reads as a removal plus an addition — refusals must be siblings.)
#
#   bash scripts/__tests__/wave22_item4_error_vs_empty_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

COMPONENT="client/src/components/LoadFailedRefusal.tsx"
PAGES=(
  "client/src/pages/investor/CRM.tsx"
  "client/src/pages/investor/Invitations.tsx"
  "client/src/pages/admin/Payments.tsx"
  "client/src/pages/admin/Notifications.tsx"
  "client/src/pages/admin/Pricing.tsx"
  "client/src/pages/admin/Telemetry.tsx"
  "client/src/pages/founder/Dataroom.tsx"
  "client/src/pages/founder/Dashboard.tsx"
  "client/src/pages/collective/LeaderboardPage.tsx"
)
ALL=("$COMPONENT" "${PAGES[@]}")

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
BEFORE_SHA="$(cd "$REPO" && sha256sum "${ALL[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-62s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-62s %s\n' "$1" "${2:-}"; }

fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"; local f
  for f in "${ALL[@]}"; do mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"; done
  echo "$d"
}

code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

p1_imports_refusal() {
  local code; code="$(code_only "$1/$2")"
  grep -q "components/LoadFailedRefusal" <<<"$code" || return 1
  grep -q "<LoadFailedRefusal" <<<"$code" || return 1
  return 0
}

p2_has_error_branch() {
  local code; code="$(code_only "$1/$2")"
  grep -Eq "isError" <<<"$code" || return 1
  return 0
}

p3_gates_on_issuccess() {
  local code; code="$(code_only "$1/$2")"
  grep -Eq "isSuccess" <<<"$code" || return 1
  return 0
}

p4_no_swallowed_failure() {
  local code; code="$(code_only "$1/$2")"
  # `if (!res.ok) return []` and `catch { return [] }`, tolerant of spacing and
  # of a cast such as `return [] as ApiSecurity[]`.
  grep -Eq '!res\.ok\)[[:space:]]*return[[:space:]]*\[\]' <<<"$code" && return 1
  grep -Eq 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*return[[:space:]]*\[\]' <<<"$code" && return 1
  return 0
}

p5_component_shape() {
  local code; code="$(code_only "$1/$COMPONENT")"
  grep -q 'role="alert"' <<<"$code" || return 1
  grep -Eq "onRetry" <<<"$code" || return 1
  grep -Eq "-retry" <<<"$code" || return 1
  return 0
}

echo "WAVE 22 · ITEM 4 — F-4 error-vs-empty falsification"
echo
echo "A. properties hold on the real tree"
p5_component_shape "$REPO" && ok "P5 shared refusal: role=alert sibling + retry" || bad "P5 shared refusal: role=alert sibling + retry"
for pg in "${PAGES[@]}"; do
  n="${pg#client/src/pages/}"
  p1_imports_refusal    "$REPO" "$pg" && ok "P1 imports+uses refusal   $n" || bad "P1 imports+uses refusal   $n"
  p2_has_error_branch   "$REPO" "$pg" && ok "P2 isError branch         $n" || bad "P2 isError branch         $n"
  p3_gates_on_issuccess "$REPO" "$pg" && ok "P3 isSuccess gate         $n" || bad "P3 isSuccess gate         $n"
  p4_no_swallowed_failure "$REPO" "$pg" && ok "P4 no swallowed failure   $n" || bad "P4 no swallowed failure   $n"
done
echo

echo "B. mutations must break the corresponding property — EVERY page, EVERY property"
i=0
for pg in "${PAGES[@]}"; do
  i=$((i+1)); n="${pg#client/src/pages/}"

  M="$(fresh "m4_a_$i")"
  sed -i 's/<LoadFailedRefusal/<div hidden={true} data-was="LoadFailedRefusal"/g; s#components/LoadFailedRefusal#components/nothing#g' "$M/$pg"
  p1_imports_refusal "$M" "$pg" && bad "M4a-$i drop the refusal        $n" "MUTATION NOT CAUGHT" || ok "M4a-$i drop the refusal        $n" "caught"

  M="$(fresh "m4_b_$i")"
  sed -i 's/isError/isNotAnError/g' "$M/$pg"
  p2_has_error_branch "$M" "$pg" && bad "M4b-$i remove isError branch   $n" "MUTATION NOT CAUGHT" || ok "M4b-$i remove isError branch   $n" "caught"

  # THE Wave 18 mutation. Dropping isSuccess leaves a page that looks fixed:
  # it has a refusal, it has an isError branch, and it still lies to every
  # offline user. Wave 18's first run missed exactly this.
  M="$(fresh "m4_c_$i")"
  sed -i 's/isSuccess/isNotChecked/g' "$M/$pg"
  p3_gates_on_issuccess "$M" "$pg" && bad "M4c-$i drop isSuccess gate     $n" "MUTATION NOT CAUGHT" || ok "M4c-$i drop isSuccess gate     $n" "caught"

  M="$(fresh "m4_d_$i")"
  cat >> "$M/$pg" <<'EOF'
const __regressionQueryFn = async () => {
  const res = await fetch("/api/whatever");
  if (!res.ok) return [];
  return res.json();
};
EOF
  p4_no_swallowed_failure "$M" "$pg" && bad "M4d-$i re-swallow !res.ok      $n" "MUTATION NOT CAUGHT" || ok "M4d-$i re-swallow !res.ok      $n" "caught"

  M="$(fresh "m4_e_$i")"
  cat >> "$M/$pg" <<'EOF'
const __regressionCatch = async () => {
  try { return await (await fetch("/api/whatever")).json(); } catch { return []; }
};
EOF
  p4_no_swallowed_failure "$M" "$pg" && bad "M4e-$i re-swallow catch{[]}    $n" "MUTATION NOT CAUGHT" || ok "M4e-$i re-swallow catch{[]}    $n" "caught"
done

M="$(fresh m4_f)"
sed -i 's/role="alert"/role="status"/' "$M/$COMPONENT"
p5_component_shape "$M" && bad "M4f downgrade role=alert to role=status" "MUTATION NOT CAUGHT" || ok "M4f downgrade role=alert to role=status" "caught"

M="$(fresh m4_g)"
sed -i 's/onRetry/onDismiss/g; s/-retry/-dismiss/g' "$M/$COMPONENT"
p5_component_shape "$M" && bad "M4g remove the retry affordance" "MUTATION NOT CAUGHT" || ok "M4g remove the retry affordance" "caught"
echo

AFTER_SHA="$(cd "$REPO" && sha256sum "${ALL[@]}" | sha256sum | cut -d' ' -f1)"
[ "$BEFORE_SHA" = "$AFTER_SHA" ] && ok "Z  real tree unmodified by harness" "$AFTER_SHA" || bad "Z  real tree unmodified by harness" "SHA CHANGED"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
