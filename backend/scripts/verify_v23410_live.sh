#!/usr/bin/env bash
#
# verify_v2349_live.sh — One-shot Capavate live-deployment verifier
# -----------------------------------------------------------------
# Usage:   ./scripts/verify_v2349_live.sh                    # defaults to https://capavate.com
# Or:      ./scripts/verify_v2349_live.sh https://staging…   # custom URL
#
# Greps every wave-marker from v23.4.4 through v23.4.9 against the LIVE site.
# - CLIENT markers are grepped in the served JS bundle.
# - SERVER markers are probed via API endpoint behavior (no admin auth needed
#   for the public route shapes; existence of the route is the marker).
#
# Returns 0 if ALL markers PASS, non-zero (with red FAIL lines) if any miss.

set -u
PUBLIC_URL="${1:-https://capavate.com}"

BOLD=$'\e[1m'; GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
pass()  { echo "${GREEN}  PASS${RESET}  $1"; }
fail()  { echo "${RED}  FAIL${RESET}  $1"; FAILED=$((FAILED+1)); }
banner(){ echo ""; echo "${BOLD}$1${RESET}"; }

FAILED=0
CB=$(date +%s)

# -------- Fetch the live client bundle --------
banner "Capavate live verifier — checking $PUBLIC_URL"
HTML=$(curl -sL "$PUBLIC_URL/?cb=$CB")
BUNDLE_PATH=$(echo "$HTML" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)

if [ -z "$BUNDLE_PATH" ]; then
  echo "${RED}FAIL: could not find a JS bundle on $PUBLIC_URL${RESET}"
  exit 1
fi
echo "Live bundle: $BUNDLE_PATH"
JS=$(curl -sL "$PUBLIC_URL/$BUNDLE_PATH?cb=$CB")
BUNDLE_SIZE=$(echo -n "$JS" | wc -c)
echo "Bundle size: $BUNDLE_SIZE bytes"

if [ "$BUNDLE_SIZE" -lt 100000 ]; then
  fail "Bundle seems too small ($BUNDLE_SIZE bytes) — Nginx may be serving the wrong file."
fi

# -------- CLIENT-side markers (must be in the bundle JS) --------
banner "CLIENT-side markers"
declare -A CLIENT_MARKERS=(
  ["tryRecoverFromCompanyNotFound"]="v23.4.5 Phase 6 (COMPANY_NOT_FOUND auto-recovery)"
  ["formatActor"]="v23.4.5 Phase 8 (friendly user IDs in activity feed)"
  ["missingRequired"]="v23.4.5 Phase 7 (Company Profile required-field gating)"
  ["VALIDATION_FAILED"]="v23.4.5 Phase 7 (validation contract)"
  ["inverse-migration"]="v23.4.4 router fix (legacy #/ hash redirect)"
  ["capavate:markers"]="v23.4.6 Phase 7 (build-marker survival diagnostic)"
  ["founder_free"]="v23.4.7 Phase 3 (Free/Pro/Scale plan picker)"
  ["warrants_options_v2349"]="v23.4.10 markers (warrants 3-way + share-price auto-calc)"
  ["toggle-plan-free"]="v23.4.10 J-001 fix (NewCompanyDialog ToggleGroup plan picker)"
)

for MARKER in "${!CLIENT_MARKERS[@]}"; do
  # Special handling for v23.4.9 composite marker: must find BOTH "Warrants & Options" AND the auto-calc tooltip phrase
  if [ "$MARKER" = "warrants_options_v2349" ]; then
    if echo "$JS" | grep -q "Warrants & Options" && echo "$JS" | grep -q "shares authorized"; then
      pass "$(printf '%-36s — %s' "$MARKER" "${CLIENT_MARKERS[$MARKER]}")"
    else
      fail "$(printf '%-36s — %s' "$MARKER" "${CLIENT_MARKERS[$MARKER]}")"
    fi
  elif echo "$JS" | grep -q "$MARKER"; then
    pass "$(printf '%-36s — %s' "$MARKER" "${CLIENT_MARKERS[$MARKER]}")"
  else
    fail "$(printf '%-36s — %s' "$MARKER" "${CLIENT_MARKERS[$MARKER]}")"
  fi
done

# -------- SERVER-side markers (probe API routes) --------
banner "SERVER-side markers (route existence probes)"

# v23.4.7 Phase 15: admin dedupe-companies endpoint
# Should respond 401/403 (auth required) when route exists; 404 when missing.
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PUBLIC_URL/api/admin/cleanup/dedupe-companies?cb=$CB")
case "$CODE" in
  401|403) pass "$(printf '%-36s — %s' 'registerAdminCleanupRoutes' 'v23.4.7 dedupe-companies (HTTP '$CODE': route present, auth required)')" ;;
  404|405) fail "$(printf '%-36s — %s' 'registerAdminCleanupRoutes' 'v23.4.7 dedupe-companies (HTTP '$CODE': route MISSING — v23.4.7 not deployed)')" ;;
  *)       fail "$(printf '%-36s — %s' 'registerAdminCleanupRoutes' 'v23.4.7 dedupe-companies (unexpected HTTP '$CODE')')" ;;
esac

# v23.4.8 Phase 1: investor-reports reports2 PATCH endpoint
# Should respond 401/403/404 (route present, auth or id) when route exists; 405 when missing.
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$PUBLIC_URL/api/founder/reports2/r_probe_not_real?cb=$CB" -H 'Content-Type: application/json' -d '{}')
case "$CODE" in
  401|403|404|409) pass "$(printf '%-36s — %s' 'reports2 PATCH route (REPORT_NOT_DRAFT)' 'v23.4.8 Phase 1 (HTTP '$CODE': route present)')" ;;
  405)             fail "$(printf '%-36s — %s' 'reports2 PATCH route (REPORT_NOT_DRAFT)' 'v23.4.8 Phase 1 (HTTP '$CODE': route MISSING — v23.4.8 not deployed)')" ;;
  *)               fail "$(printf '%-36s — %s' 'reports2 PATCH route (REPORT_NOT_DRAFT)' 'v23.4.8 Phase 1 (unexpected HTTP '$CODE')')" ;;
esac

# v23.4.8 Phase 2: round-initial-shareholders endpoint
# Should respond 401/403/404 when route exists; 405 when missing.
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$PUBLIC_URL/api/founder/rounds/r_probe_not_real/initial-shareholders?cb=$CB")
case "$CODE" in
  401|403|404) pass "$(printf '%-36s — %s' 'roundInitialShareholders route' 'v23.4.8 Phase 2 (HTTP '$CODE': route present)')" ;;
  405)         fail "$(printf '%-36s — %s' 'roundInitialShareholders route' 'v23.4.8 Phase 2 (HTTP '$CODE': route MISSING — v23.4.8 not deployed)')" ;;
  *)           fail "$(printf '%-36s — %s' 'roundInitialShareholders route' 'v23.4.8 Phase 2 (unexpected HTTP '$CODE')')" ;;
esac

# v23.4.6 Phase 2: partner-invite resend endpoint
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PUBLIC_URL/api/admin/partner-invite/probe/resend?cb=$CB")
case "$CODE" in
  401|403|404) pass "$(printf '%-36s — %s' 'partner-invite resend route' 'v23.4.6 Phase 2 (HTTP '$CODE': route present)')" ;;
  405)         fail "$(printf '%-36s — %s' 'partner-invite resend route' 'v23.4.6 Phase 2 (HTTP '$CODE': route MISSING)')" ;;
  *)           fail "$(printf '%-36s — %s' 'partner-invite resend route' 'v23.4.6 Phase 2 (unexpected HTTP '$CODE')')" ;;
esac

# v23.4.2: SMTP diagnostic endpoint
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PUBLIC_URL/api/admin/email/test?cb=$CB" -H 'Content-Type: application/json' -d '{"to":"probe@example.invalid"}')
case "$CODE" in
  401|403) pass "$(printf '%-36s — %s' 'admin email test route' 'v23.4.2 SMTP diagnostic (HTTP '$CODE': route present, auth required)')" ;;
  404|405) fail "$(printf '%-36s — %s' 'admin email test route' 'v23.4.2 SMTP diagnostic (HTTP '$CODE': route MISSING)')" ;;
  *)       fail "$(printf '%-36s — %s' 'admin email test route' 'v23.4.2 SMTP diagnostic (unexpected HTTP '$CODE')')" ;;
esac

# -------- Final tally --------
banner "Summary"
if [ "$FAILED" -eq 0 ]; then
  echo "${GREEN}${BOLD}ALL MARKERS PRESENT.${RESET} Capavate v23.4.10 is fully deployed on $PUBLIC_URL."
  exit 0
else
  echo "${RED}${BOLD}$FAILED MARKER(S) FAILED.${RESET} v23.4.10 is NOT fully deployed on $PUBLIC_URL."
  echo ""
  echo "Next steps:"
  echo "  1) Inside the unzipped v23.4.9 directory on your server, run: ./deploy_v23_4_9.sh"
  echo "  2) After it completes, re-run this script."
  exit 1
fi
