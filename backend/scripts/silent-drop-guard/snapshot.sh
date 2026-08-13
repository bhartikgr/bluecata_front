#!/usr/bin/env bash
# scripts/silent-drop-guard/snapshot.sh
#
# G-0 — read-only pre-change tree snapshot plus content manifest.
#
# Why this exists (V7 REVIEW B, BLOCKER 3): the guard baseline must be derived
# from a tree that has NOT already been mutated by the very wave the guard is
# supposed to police. `cp -a` alone is insufficient: it preserves the writable
# mode bits, so the "immutable source" is trivially editable and nothing proves
# the extraction read the same bytes it claims to have read.
#
# This script therefore:
#   1. copies the SOURCE-BEARING subset of the tree (never node_modules, dist,
#      build, coverage, .git, uploads, test-results, *.db, release_* dirs),
#   2. strips every write bit from the copy (chmod -R a-w, dirs a-w too),
#   3. emits a content manifest — one `<sha256>  <relpath>` line per file,
#      sorted by path, LC_ALL=C — plus a single manifest hash,
#   4. can re-verify the manifest hash on demand, which is what the extractor
#      does immediately before AND immediately after it reads the snapshot.
#
# Local mode bits are a guard against accident, not against an adversary with
# write access; V7 REVIEW B says so explicitly and so does this comment. The
# manifest hash is the real evidence: it is recorded in the companion baseline.
#
# Usage:
#   snapshot.sh create  [<dest>]     # default dest: <repo>/.g0-snapshot
#   snapshot.sh verify  [<dest>]     # recompute manifest, compare to recorded
#   snapshot.sh hash    [<dest>]     # print the recorded manifest sha256
#   snapshot.sh destroy [<dest>]     # chmod +w and remove (explicit only)
#
# Exit 0 = OK. Exit 1 = mismatch / missing / refused.

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DEFAULT_DEST="$REPO_ROOT/.g0-snapshot"
MODE="${1:-}"
DEST="${2:-$DEFAULT_DEST}"

MANIFEST_NAME="G0_MANIFEST.sha256"
MANIFEST_HASH_NAME="G0_MANIFEST.sha256.hash"
META_NAME="G0_SNAPSHOT.meta"

# Directories that are never part of a source snapshot.
EXCLUDES=(
  "node_modules" "dist" "build" "coverage" ".git" ".g0-snapshot"
  "uploads" "test-results" "playwright-report" "attached_assets"
  "backups" "server/public"
)

usage() { sed -n '3,30p' "${BASH_SOURCE[0]}"; exit 1; }

build_tar_excludes() {
  local a=()
  for e in "${EXCLUDES[@]}"; do a+=(--exclude="./$e" --exclude="*/$e"); done
  a+=(--exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.sqlite')
  a+=(--exclude='./release_v*' --exclude='./v26_7_3_*')
  printf '%s\n' "${a[@]}"
}

# Manifest = sorted "<sha256>  <relpath>" over every regular file in the snapshot,
# excluding the manifest artefacts themselves.
compute_manifest() {
  local root="$1"
  ( cd "$root" && find . -type f \
      ! -name "$MANIFEST_NAME" ! -name "$MANIFEST_HASH_NAME" ! -name "$META_NAME" \
      -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum )
}

cmd_create() {
  if [ -e "$DEST" ]; then
    echo "REFUSED: snapshot destination already exists: $DEST" >&2
    echo "         run '$0 destroy $DEST' first if you really mean to replace it." >&2
    exit 1
  fi
  mkdir -p "$DEST"
  mapfile -t TAR_EX < <(build_tar_excludes)
  # cp -a equivalent that honours excludes and preserves mode/mtime.
  ( cd "$REPO_ROOT" && tar -cf - "${TAR_EX[@]}" . ) | ( cd "$DEST" && tar -xf - )

  # Manifest FIRST (while still readable), then freeze.
  compute_manifest "$DEST" > "$DEST/$MANIFEST_NAME"
  sha256sum < "$DEST/$MANIFEST_NAME" | cut -d' ' -f1 > "$DEST/$MANIFEST_HASH_NAME"

  {
    echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "repo_root=$REPO_ROOT"
    echo "files=$(wc -l < "$DEST/$MANIFEST_NAME" | tr -d ' ')"
    echo "manifest_sha256=$(cat "$DEST/$MANIFEST_HASH_NAME")"
  } > "$DEST/$META_NAME"

  # 3. Make it non-writable. `cp -a` alone does NOT do this — that is the whole
  #    point of BLOCKER 3. Directories lose w too, so no file can be added.
  chmod -R a-w "$DEST"

  echo "G-0 snapshot created: $DEST"
  echo "  files            : $(grep -c . "$DEST/$MANIFEST_NAME")"
  echo "  manifest sha256  : $(cat "$DEST/$MANIFEST_HASH_NAME")"
  echo "  writable entries : $(find "$DEST" -writable | wc -l | tr -d ' ')  (must be 0)"
  if [ "$(find "$DEST" -writable | wc -l | tr -d ' ')" != "0" ]; then
    echo "FAIL: snapshot is still writable" >&2; exit 1
  fi
}

cmd_verify() {
  [ -d "$DEST" ] || { echo "FAIL: no snapshot at $DEST" >&2; exit 1; }
  [ -f "$DEST/$MANIFEST_NAME" ] || { echo "FAIL: no manifest in $DEST" >&2; exit 1; }
  local recorded actual
  recorded="$(cat "$DEST/$MANIFEST_HASH_NAME")"
  actual="$(compute_manifest "$DEST" | sha256sum | cut -d' ' -f1)"
  if [ "$recorded" != "$actual" ]; then
    echo "FAIL: G-0 snapshot manifest MISMATCH" >&2
    echo "  recorded=$recorded" >&2
    echo "  actual  =$actual" >&2
    exit 1
  fi
  local w
  w="$(find "$DEST" -writable | wc -l | tr -d ' ')"
  if [ "$w" != "0" ]; then
    echo "FAIL: G-0 snapshot has $w writable entries (must be 0)" >&2; exit 1
  fi
  echo "OK: G-0 snapshot verified — manifest $actual, 0 writable entries"
}

cmd_hash() {
  [ -f "$DEST/$MANIFEST_HASH_NAME" ] || { echo "FAIL: no snapshot at $DEST" >&2; exit 1; }
  cat "$DEST/$MANIFEST_HASH_NAME"
}

cmd_destroy() {
  [ -d "$DEST" ] || { echo "nothing to destroy at $DEST"; exit 0; }
  case "$DEST" in
    "$REPO_ROOT"/*) : ;;
    /tmp/*) : ;;
    *) echo "REFUSED: will not destroy a path outside the repo or /tmp: $DEST" >&2; exit 1 ;;
  esac
  chmod -R u+w "$DEST"
  rm -rf "$DEST"
  echo "destroyed $DEST"
}

case "$MODE" in
  create)  cmd_create  ;;
  verify)  cmd_verify  ;;
  hash)    cmd_hash    ;;
  destroy) cmd_destroy ;;
  *) usage ;;
esac
