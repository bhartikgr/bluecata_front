#!/usr/bin/env bash
# verify_release_version.sh — refuse to package a release whose declared version
# does not match the release being cut.
#
# WHY THIS EXISTS
# ---------------
# Packages v26.34.0, v26.35.0, v26.36.0, v26.37.0 and v26.38.0 ALL shipped
# package.json version "26.33.0". The version simply stopped being bumped, and
# five consecutive packages became indistinguishable from one another.
#
# This matters because deploys are performed by a third party from a package,
# and the platform's own /api/health and /api/healthz endpoints are the ONLY way
# anyone confirms which build is installed. Five packages that self-report the
# same version is exactly the condition in which a wrong build goes live and
# nobody notices.
#
# It had already been reported once (release/FOR_AVI_version_label_fix.md,
# 2026-08-20) and RECURRED, because nothing enforced it. A documented rule that
# recurs is not a control. This script is the control.
#
# USAGE
#   scripts/verify_release_version.sh 26.39.0
#
# Exits non-zero and prints what disagrees. Run it BEFORE building any archive.

set -euo pipefail

EXPECTED="${1:-}"
if [ -z "$EXPECTED" ]; then
  echo "verify_release_version: FAIL — no expected version given" >&2
  echo "usage: scripts/verify_release_version.sh <version>   e.g. 26.39.0" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rc=0

read_json_version() {
  # Read the TOP-LEVEL "version" only. Deliberately not a bare grep: a bare grep
  # matches nested dependency versions and would report a false pass or a false
  # failure depending on ordering.
  python3 - "$1" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as fh:
        print(json.load(fh).get("version", "<absent>"))
except FileNotFoundError:
    print("<missing-file>")
except Exception as exc:  # malformed JSON is itself a packaging defect
    print("<unparseable:%s>" % type(exc).__name__)
PY
}

PKG_VER="$(read_json_version "$ROOT/package.json")"
LOCK_VER="$(read_json_version "$ROOT/package-lock.json")"

echo "verify_release_version: expected           = $EXPECTED"
echo "verify_release_version: package.json       = $PKG_VER"
echo "verify_release_version: package-lock.json  = $LOCK_VER"

if [ "$PKG_VER" != "$EXPECTED" ]; then
  echo "verify_release_version: FAIL — package.json says '$PKG_VER', expected '$EXPECTED'" >&2
  rc=1
fi

if [ "$LOCK_VER" != "$EXPECTED" ]; then
  # A lockfile disagreeing with package.json is a weaker signal than package.json
  # itself being wrong, but it is still a real disagreement between two files that
  # claim the same fact. Two copies of one truth is a defect class this platform
  # has hit repeatedly, so it fails rather than warns.
  echo "verify_release_version: FAIL — package-lock.json says '$LOCK_VER', expected '$EXPECTED'" >&2
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  echo "verify_release_version: OK — every declared version agrees with $EXPECTED"
  echo "verify_release_version: after install, /api/healthz must report version $EXPECTED"
else
  echo "verify_release_version: DO NOT PACKAGE until the versions above agree." >&2
fi

exit "$rc"
