#!/usr/bin/env bash
# WAVE 35 — mutation runner. Applies ONE mutant to a production file, runs a
# harness, restores the file byte-identically (verified with cmp), and reports
# whether the mutant was KILLED. A surviving mutant must be classified as
# harness bug / coverage gap / equivalent mutant — never waved through.
set -u
FILE="$1"; SEARCH="$2"; REPLACE="$3"; TEST="$4"; LABEL="$5"
BAK="$(mktemp)"
cp "$FILE" "$BAK"
python3 - "$FILE" "$SEARCH" "$REPLACE" <<'PY'
import sys
p, s, r = sys.argv[1], sys.argv[2], sys.argv[3]
t = open(p, encoding="utf-8").read()
if s not in t:
    print("MUTANT_NOT_APPLIED: search string absent"); sys.exit(9)
open(p, "w", encoding="utf-8").write(t.replace(s, r, 1))
PY
if [ $? -ne 0 ]; then cp "$BAK" "$FILE"; echo "MUTANT $LABEL: NOT APPLIED"; exit 9; fi
timeout 900 npx vitest run "$TEST" >/tmp/w35_mutant_out.txt 2>&1
RC=$?
cp "$BAK" "$FILE"
if ! cmp -s "$BAK" "$FILE"; then echo "FATAL: restore failed for $FILE"; exit 2; fi
rm -f "$BAK"
if [ $RC -eq 0 ]; then
  echo "MUTANT $LABEL: SURVIVED (rc=0) — classify: harness bug / coverage gap / equivalent"
else
  echo "MUTANT $LABEL: KILLED (rc=$RC)"
  grep -E "Tests  |×" /tmp/w35_mutant_out.txt | head -8
fi
