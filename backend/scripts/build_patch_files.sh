#!/usr/bin/env bash
# Build patch_files/ directory by copying every file changed/added in v12 vs v11.
set -euo pipefail

SRC=/home/user/workspace/avi_v12_tree
V11=/home/user/workspace/avi_v11_tree
DST=/home/user/workspace/avi_patch_v12/patch_files

rm -rf "$DST"
mkdir -p "$DST"

# Parse diff and copy each file.
diff -rq "$V11" "$SRC" \
  --exclude=node_modules --exclude=dist --exclude='data*.db*' \
  --exclude='*.log' --exclude='package-lock.json' \
  --exclude='*.prev' --exclude='*.bak' \
  2>&1 | while read -r line; do
  case "$line" in
    "Files "*" differ")
      # "Files /v11/path and /v12/path differ"
      v12path=$(echo "$line" | awk '{print $4}')
      rel="${v12path#$SRC/}"
      mkdir -p "$DST/$(dirname "$rel")"
      cp "$v12path" "$DST/$rel"
      echo "  diff $rel"
      ;;
    "Only in $SRC"*|"Only in $SRC/"*)
      # "Only in /v12/path/dir: filename"
      dir=$(echo "$line" | sed -E 's/^Only in //; s/: .*//')
      file=$(echo "$line" | sed -E 's/^.*: //')
      full="$dir/$file"
      if [ -d "$full" ]; then
        # full directory new — copy all files
        find "$full" -type f \
          ! -name '*.log' ! -name 'package-lock.json' \
          ! -name '*.prev' ! -name '*.bak' \
          ! -path '*/node_modules/*' ! -path '*/dist/*' \
          ! -name 'data*.db*' | while read -r f; do
          rel="${f#$SRC/}"
          mkdir -p "$DST/$(dirname "$rel")"
          cp "$f" "$DST/$rel"
          echo "  new  $rel"
        done
      else
        rel="${full#$SRC/}"
        mkdir -p "$DST/$(dirname "$rel")"
        cp "$full" "$DST/$rel"
        echo "  new  $rel"
      fi
      ;;
  esac
done

echo "Total files in patch_files: $(find "$DST" -type f | wc -l)"
