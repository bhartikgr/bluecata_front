#!/usr/bin/env bash
# scripts/__tests__/wave22_item1_audit_ip_falsify.sh
#
# WAVE 22 · ITEM 1 — REVIEW B F-2 (MAJOR): fabricated audit IPs / identity
# hashes written into the round-close audit trail.
#
# WHAT IS BEING FALSIFIED
# -----------------------
# The fix asserts four properties. This harness states each one, then MUTATES a
# sandbox copy of the source back toward the pre-fix behaviour and requires the
# assertion to FAIL. An assertion that cannot be made to fail is not evidence —
# eleven checks in this codebase have passed while checking nothing, including
# two prior falsification harnesses, so every positive below is paired with a
# mutation.
#
#   P1  No IP is synthesised anywhere on the close-round surface.
#       (no `fakeIp`, no 203.0.113.x literal, no Math.random into an IP)
#   P2  Sign-off records PERSIST an explicit null plus a documented reason,
#       rather than silently dropping the field.
#   P3  The UI renders an explicit "not captured" marker as a SIBLING element
#       (guard rule: text appended inside an existing text node reads as a
#       removal + an addition).
#   P4  The server-side audit-log append stamps a SERVER-OBSERVED address via
#       the trusted resolver and force-nulls any client-supplied ipAddress, so
#       a forged value cannot enter the evidence record even if a caller sends
#       one.
#
# Mutations run against COPIES under a temp dir. The real tree is never edited;
# case Z re-verifies the originals by hash.
#
#   bash scripts/__tests__/wave22_item1_audit_ip_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

PANEL_REL="client/src/components/CloseRoundPanel.tsx"
SPRINT_REL="client/src/lib/sprint3.ts"
STORE_REL="server/adminPlatformStore.ts"
FILES=("$PANEL_REL" "$SPRINT_REL" "$STORE_REL")

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

BEFORE_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"

ok()   { PASS=$((PASS+1)); printf '  ok      %-56s %s\n' "$1" "${2:-}"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL    %-56s %s\n' "$1" "${2:-}"; }

# Build a fresh sandbox containing only the three files, at their real paths.
fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"
  local f
  for f in "${FILES[@]}"; do mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"; done
  echo "$d"
}

# ---------------------------------------------------------------------------
# The assertions. Each returns 0 (property holds) or 1 (property violated) and
# is run against an arbitrary root so the same code judges both the real tree
# and every mutant.
# ---------------------------------------------------------------------------
# HARNESS NOTE (recorded honestly, per the wave rules). The first run of this
# harness reported P1 FAILING on the real tree. That was a HARNESS BUG, not a
# real finding: the WAVE 22 header block and one inline note in
# CloseRoundPanel.tsx *quote* the deleted `fakeIp()` implementation, including
# the literal "203.0.113." + Math.random, so that a future reader knows exactly
# what was removed and why. A raw grep cannot tell a quoted corpse from a live
# generator. The check now strips comments first and greps only EXECUTABLE
# source — which is the property that actually matters, and which mutations
# M1a/M1b confirm is still falsifiable.
code_only() {  # strip /* */ and // comments, print the executable remainder
  python3 - "$1" <<'PYEOF'
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
src = re.sub(r"(?m)^\s*//.*$", " ", src)
sys.stdout.write(src)
PYEOF
}

p1_no_synthetic_ip() {
  local root="$1"; local panel="$root/$PANEL_REL"
  local code; code="$(code_only "$panel")"
  grep -q "fakeIp" <<<"$code" && return 1
  grep -q "203\.0\.113\." <<<"$code" && return 1
  # An IP assembled from Math.random in any form.
  grep -Eq 'Math\.random[^\n]*(ip|Ip|IP)|(ip|Ip|IP)[^\n]*Math\.random' <<<"$code" && return 1
  return 0
}

p2_persists_null_with_reason() {
  local root="$1"; local panel="$root/$PANEL_REL"; local sprint="$root/$SPRINT_REL"
  grep -q "ipAddress: AUDIT_VALUE_NOT_CAPTURED"      "$panel" || return 1
  grep -q "identityHash: AUDIT_VALUE_NOT_CAPTURED"   "$panel" || return 1
  grep -q "ipAddressUnavailableReason"               "$panel" || return 1
  grep -q "identityHashUnavailableReason"            "$panel" || return 1
  # The type must ADMIT null, otherwise the null above is a lie the compiler
  # would have to be told to ignore.
  grep -q "identityHash: string | null"              "$sprint" || return 1
  grep -q "ipAddressUnavailableReason"               "$sprint" || return 1
  return 0
}

p3_ui_renders_not_captured_as_sibling() {
  local root="$1"; local panel="$root/$PANEL_REL"
  grep -q -- "-ip-not-captured"            "$panel" || return 1
  grep -q "close-audit-capture-note"       "$panel" || return 1
  grep -q "not captured"                   "$panel" || return 1
  return 0
}

p4_server_stamps_and_forces_null() {
  local root="$1"; local store="$root/$STORE_REL"
  grep -q "resolveRateLimitClientIp" "$store" || return 1
  grep -q "serverObservedIp"         "$store" || return 1
  grep -q "stampedPayload"           "$store" || return 1
  return 0
}

expect_holds() {  # name, fn, root
  if "$2" "$3"; then ok "$1"; else bad "$1" "property did not hold on the REAL tree"; fi
}
expect_broken() { # name, fn, root, mutation-description
  if "$2" "$3"; then
    bad "$1" "MUTATION NOT CAUGHT — $4"
  else
    ok "$1" "mutation caught"
  fi
}

echo "WAVE 22 · ITEM 1 — F-2 fabricated audit IP falsification"
echo

# --- Positive direction: the real tree satisfies all four properties. --------
echo "A. properties hold on the real tree"
expect_holds "P1 no synthesised IP on close surface"   p1_no_synthetic_ip                 "$REPO"
expect_holds "P2 null + documented reason persisted"   p2_persists_null_with_reason       "$REPO"
expect_holds "P3 'not captured' rendered as sibling"   p3_ui_renders_not_captured_as_sibling "$REPO"
expect_holds "P4 server stamps observed IP, nulls in"  p4_server_stamps_and_forces_null   "$REPO"
echo

# --- Negative direction: each property is provably falsifiable. --------------
echo "B. mutations must break the corresponding property"

M="$(fresh m1a)"
cat >> "$M/$PANEL_REL" <<'EOF'
function fakeIp(): string { return `203.0.113.${Math.floor(Math.random() * 254) + 1}`; }
EOF
expect_broken "M1a reintroduce fakeIp() generator" p1_no_synthetic_ip "$M" "fakeIp() restored, P1 still passed"

M="$(fresh m1b)"
# The subtler mutation: no helper named fakeIp, just an inline literal.
sed -i 's/const AUDIT_VALUE_NOT_CAPTURED = null;/const AUDIT_VALUE_NOT_CAPTURED = "203.0.113.7";/' "$M/$PANEL_REL"
expect_broken "M1b inline 203.0.113.x literal (no helper)" p1_no_synthetic_ip "$M" "literal not detected"

M="$(fresh m2a)"
# Silently DROP the field instead of persisting an explicit null — the review
# named this as equally unacceptable ("do not silently drop the field").
sed -i 's/ipAddress: AUDIT_VALUE_NOT_CAPTURED/\/* dropped *\//' "$M/$PANEL_REL"
expect_broken "M2a drop ipAddress instead of null" p2_persists_null_with_reason "$M" "silent drop not detected"

M="$(fresh m2b)"
sed -i 's/ipAddressUnavailableReason/ipAddressWhatever/g' "$M/$PANEL_REL"
expect_broken "M2b remove documented reason field" p2_persists_null_with_reason "$M" "missing reason not detected"

M="$(fresh m2c)"
sed -i 's/identityHash: string | null/identityHash: string/' "$M/$SPRINT_REL"
expect_broken "M2c narrow SignoffRecord back to non-null" p2_persists_null_with_reason "$M" "type narrowing not detected"

M="$(fresh m3a)"
sed -i 's/-ip-not-captured/-ip-value/g' "$M/$PANEL_REL"
expect_broken "M3a remove 'not captured' sibling testid" p3_ui_renders_not_captured_as_sibling "$M" "UI marker loss not detected"

M="$(fresh m4a)"
sed -i 's/resolveRateLimitClientIp/req.headers["x-forwarded-for"] as string ?? unsafeIp/g' "$M/$STORE_REL"
expect_broken "M4a server uses raw x-forwarded-for" p4_server_stamps_and_forces_null "$M" "spoofable header not detected"

M="$(fresh m4b)"
sed -i 's/serverObservedIp/clientClaimedIp/g' "$M/$STORE_REL"
expect_broken "M4b stop stamping a server-observed IP" p4_server_stamps_and_forces_null "$M" "missing stamp not detected"
echo

# --- Case Z: the real tree was not modified by this harness. -----------------
AFTER_SHA="$(cd "$REPO" && sha256sum "${FILES[@]}" | sha256sum | cut -d' ' -f1)"
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  ok "Z  real tree unmodified by harness" "$AFTER_SHA"
else
  bad "Z  real tree unmodified by harness" "SHA CHANGED $BEFORE_SHA -> $AFTER_SHA"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
