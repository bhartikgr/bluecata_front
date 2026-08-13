#!/usr/bin/env bash
# WAVE 3A — reproducible sweep for percent RENDER sites across the client.
# Usage: bash scripts/wave3a_percent_sweep.sh
# Emits: file:line  |  source text
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== A. Renders that print a literal % immediately after an interpolated value ==="
grep -rnE '(\}|\)|[A-Za-z0-9_\]])\s*%(["`<]|\s*</|\{" "\})' client/src --include='*.tsx' --include='*.ts' \
  | grep -vE '%\s*[A-Za-z]{2,}' \
  | sort

echo
echo "=== B. Explicit x100 scaling in the client (candidate correct renders) ==="
grep -rnE '\*\s*100\b' client/src --include='*.tsx' --include='*.ts' | sort

echo
echo "=== C. Percent-bearing identifiers rendered (rate / pct / percent / commission / discount) ==="
grep -rniE '(rate|pct|percent|commission|discount)[A-Za-z]*\s*\}?\s*%' client/src --include='*.tsx' --include='*.ts' | sort
