#!/usr/bin/env bash
# scripts/__tests__/wave22_item2_trusted_ip_falsify.sh
#
# WAVE 22 · ITEM 2 — REVIEW B F-3 (MAJOR): legal consent and sign-off records
# stored a client-supplied, forgeable `x-forwarded-for` value as IP evidence.
#
# An IP on a legal consent record exists for exactly one reason: to be evidence
# later. If any caller can set it with a header, it is not evidence — it is a
# field that LOOKS like evidence, which is worse than an empty column, because
# a reviewer will believe it.
#
# PROPERTIES
#   P1  Every evidence-writing site resolves the address through the SINGLE
#       shared resolver `resolveRateLimitClientIp` (Wave 21, server/lib/
#       rateLimit.ts). No second implementation of the same security decision.
#   P2  No evidence-writing site reads `x-forwarded-for` directly.
#   P3  The shared resolver FAILS CLOSED: with no trusted-proxy configuration
#       it uses the socket peer and never the header. (Read-only assertion —
#       server/lib/rateLimit.ts is owned by Wave 21 and is NOT edited here.)
#
# Mutations run against sandbox COPIES; case Z re-verifies the real files by
# hash.
#
#   bash scripts/__tests__/wave22_item2_trusted_ip_falsify.sh

set -uo pipefail
export LC_ALL=C

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# The four sites named by Review B, plus a fifth (gdprRoutes) found by grep
# during the fix and reported in WAVE22_REPORT.md — the review under-counted.
SITES=(
  "server/legalConsentStore.ts"
  "server/track1Routes.ts"
  "server/spvEngineRoutes.ts"
  "server/partnerRoutes.ts"
  "server/gdprRoutes.ts"
)
RESOLVER="server/lib/rateLimit.ts"

PASS=0; FAIL=0
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

ALL=("${SITES[@]}" "$RESOLVER")
BEFORE_SHA="$(cd "$REPO" && sha256sum "${ALL[@]}" | sha256sum | cut -d' ' -f1)"

ok()  { PASS=$((PASS+1)); printf '  ok      %-56s %s\n' "$1" "${2:-}"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL    %-56s %s\n' "$1" "${2:-}"; }

fresh() {
  local d="$TMPROOT/$1"; rm -rf "$d"
  local f
  for f in "${ALL[@]}"; do mkdir -p "$d/$(dirname "$f")"; cp "$REPO/$f" "$d/$f"; done
  echo "$d"
}

# Strip comments so a *description* of the old bug is not mistaken for the bug.
# (This is the same harness bug that ITEM 1's first run walked into; it is
# pre-empted here rather than rediscovered.)
#
# HARNESS BUG #3, recorded because it is the most dangerous kind. An earlier
# version of every assertion below was written as
#     printf '%s' "$code" | grep -q PATTERN || return 1
# under `set -o pipefail`. On the largest file in the set (partnerRoutes.ts,
# 68 kB) `grep -q` matched on line 65 and exited immediately; `printf` was
# still writing, took SIGPIPE, and pipefail propagated 141 as the pipeline
# status — so a SUCCESSFUL match was reported as a FAILED assertion. The
# harness told us partnerRoutes.ts did not use the shared resolver. It does
# (partnerRoutes.ts:1687). A size-dependent false NEGATIVE that only fires on
# big files is exactly how a sweep "passes" on the small files it happens to
# check first. All greps now read a here-string; there is no pipe to break.
code_only() { python3 "$HERE/wave22_strip_comments.py" "$1"; }

p1_uses_shared_resolver() {  # root, site
  local root="$1"; local site="$2"
  local code; code="$(code_only "$root/$site")"
  # Must be a CALL, not merely an import line. The first version of this check
  # asserted only that the identifier appeared somewhere in the file, and four
  # of the five M-P1 mutations sailed straight through it because the mutation
  # rewrote the call site while leaving `import { resolveRateLimitClientIp }`
  # untouched. That was a HARNESS BUG (the assertion was too weak), and it is
  # the single most instructive result in this wave: an identifier-presence
  # check is not a use check.
  grep -Eq "resolveRateLimitClientIp\\(" <<<"$code" || return 1
  grep -Eq "^import .*resolveRateLimitClientIp" <<<"$code" || return 1
  return 0
}

p2_no_raw_header_read() {    # root, site
  local root="$1"; local site="$2"
  local code; code="$(code_only "$root/$site")"
  grep -qi "x-forwarded-for" <<<"$code" && return 1
  return 0
}

p3_resolver_fails_closed() { # root
  local root="$1"; local code
  code="$(code_only "$root/$RESOLVER")"
  grep -q "export function resolveRateLimitClientIp" <<<"$code" || return 1
  grep -q "TRUSTED_PROXY_HOPS" <<<"$code" || return 1
  grep -qE "socket|remoteAddress" <<<"$code" || return 1
  return 0
}

echo "WAVE 22 · ITEM 2 — F-3 spoofable consent IP falsification"
echo
echo "A. properties hold on the real tree"
for s in "${SITES[@]}"; do
  if p1_uses_shared_resolver "$REPO" "$s"; then ok "P1 shared resolver  $s"; else bad "P1 shared resolver  $s"; fi
done
for s in "${SITES[@]}"; do
  if p2_no_raw_header_read "$REPO" "$s"; then ok "P2 no raw header    $s"; else bad "P2 no raw header    $s"; fi
done
if p3_resolver_fails_closed "$REPO"; then ok "P3 resolver fails closed (read-only)"; else bad "P3 resolver fails closed (read-only)"; fi
echo

echo "B. mutations must break the corresponding property"
# One mutation PER SITE. A single mutation on a single file would leave four
# untested call sites — precisely how a sweep passes while checking nothing.
i=0
for s in "${SITES[@]}"; do
  i=$((i+1))
  M="$(fresh "m2_p1_$i")"
  sed -i 's/resolveRateLimitClientIp(req)/(req.headers["x-forwarded-for"] as string)/g' "$M/$s"
  if p1_uses_shared_resolver "$M" "$s"; then
    bad "M-P1-$i revert $s to header" "MUTATION NOT CAUGHT"
  else
    ok "M-P1-$i revert $s to header" "caught"
  fi
done

i=0
for s in "${SITES[@]}"; do
  i=$((i+1))
  M="$(fresh "m2_p2_$i")"
  # Keep the resolver import in place and ALSO add a header read — the
  # "belt and braces" regression a future author is most likely to write,
  # which P1 alone would not catch.
  printf '\nconst __regression = (req: any) => req.headers["x-forwarded-for"];\n' >> "$M/$s"
  if p2_no_raw_header_read "$M" "$s"; then
    bad "M-P2-$i add header read to $s" "MUTATION NOT CAUGHT"
  else
    ok "M-P2-$i add header read to $s" "caught"
  fi
done

M="$(fresh m2_p3)"
sed -i 's/export function resolveRateLimitClientIp/function resolveRateLimitClientIpUnexported/' "$M/$RESOLVER"
if p3_resolver_fails_closed "$M"; then bad "M-P3a un-export resolver" "MUTATION NOT CAUGHT"; else ok "M-P3a un-export resolver" "caught"; fi

M="$(fresh m2_p3b)"
sed -i 's/TRUSTED_PROXY_HOPS/ALWAYS_TRUST_HEADER/g' "$M/$RESOLVER"
if p3_resolver_fails_closed "$M"; then bad "M-P3b drop trusted-hop config gate" "MUTATION NOT CAUGHT"; else ok "M-P3b drop trusted-hop config gate" "caught"; fi
echo

AFTER_SHA="$(cd "$REPO" && sha256sum "${ALL[@]}" | sha256sum | cut -d' ' -f1)"
if [ "$BEFORE_SHA" = "$AFTER_SHA" ]; then
  ok "Z  real tree unmodified by harness" "$AFTER_SHA"
else
  bad "Z  real tree unmodified by harness" "SHA CHANGED"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
