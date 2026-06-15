#!/usr/bin/env bash
# =============================================================================
# Capavate v23.2 — master install script (Avi edition)
# =============================================================================
# One command, idempotent, strict error handling. After this finishes green,
# the deploy is ready to start with `npm start`.
#
# Re-run safely. If something fails, fix the indicated issue and re-run.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."
ROOT="$(pwd)"

C_GREEN=""; C_YELLOW=""; C_RED=""; C_BOLD=""; C_RESET=""
if [ -t 1 ] && command -v tput >/dev/null 2>&1; then
  C_GREEN="$(tput setaf 2)"; C_YELLOW="$(tput setaf 3)"; C_RED="$(tput setaf 1)"
  C_BOLD="$(tput bold)"; C_RESET="$(tput sgr0)"
fi
step() { echo ""; echo "${C_BOLD}==> $1${C_RESET}"; }
ok()   { echo "${C_GREEN}✓${C_RESET} $1"; }
die()  { echo "${C_RED}✗ $1${C_RESET}"; exit 1; }

echo "${C_BOLD}Capavate v23.2 — install_avi.sh${C_RESET}"
echo "Working directory: $ROOT"
echo "Node: $(node --version 2>/dev/null || echo 'NOT INSTALLED — install Node 20+ first')"
echo "npm : $(npm  --version 2>/dev/null || echo 'NOT INSTALLED')"

# ----- Step 1 -----------------------------------------------------------
step "Step 1/7 — Verify zip extracted correctly"
[ -f package.json ] || die "package.json missing — did the unzip succeed? Are you in the right directory?"
[ -d server ]       || die "server/ missing — re-extract capavate_v23.2_FINAL_24_may.zip"
[ -d client ]       || die "client/ missing — re-extract the zip"
[ -d migrations ]   || die "migrations/ missing — re-extract the zip"
[ -f server/db/migrate.ts ] || die "server/db/migrate.ts missing — you have an OLD zip. Re-download capavate_v23.2_FINAL_24_may.zip from Ozan."
[ -f scripts/seed_demo.ts ] || die "scripts/seed_demo.ts missing — re-extract the zip"
ok "Tree looks complete"

# ----- Step 2 -----------------------------------------------------------
step "Step 2/7 — Install npm dependencies (this takes ~2 min)"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install
else
  echo "node_modules/ already up to date (delete it to force a fresh install)"
fi
ok "Dependencies installed"

# ----- Step 3 -----------------------------------------------------------
step "Step 3/7 — Check .env file"
if [ ! -f .env ]; then
  echo "${C_YELLOW}No .env file found. Creating .env from .env.example...${C_RESET}"
  cp .env.example .env
  echo ""
  echo "${C_RED}${C_BOLD}STOP. You must edit .env with your real values BEFORE continuing.${C_RESET}"
  echo "  See DEPLOY_FOR_AVI.md section 4 for the env var reference."
  echo "  Re-run this script once .env is filled in:"
  echo "      bash scripts/install_avi.sh"
  exit 1
fi
ok ".env present"

# ----- Step 4 -----------------------------------------------------------
step "Step 4/7 — Run database migrations"
echo "Running: npm run db:migrate"
if ! npm run db:migrate; then
  cat <<EOF
${C_RED}${C_BOLD}Migration failed.${C_RESET}
Common causes + fixes:
  • ${C_BOLD}ERR_MODULE_NOT_FOUND server/db/migrate.ts${C_RESET}
        → You have an OLD zip. Re-download capavate_v23.2_FINAL_24_may.zip.
  • ${C_BOLD}connection refused / ECONNREFUSED${C_RESET}
        → Postgres isn't reachable. Check DATABASE_URL in .env.
  • ${C_BOLD}permission denied / readonly database${C_RESET}
        → ./data.db isn't writable. Run: chmod 664 data.db && chmod 775 .
  • ${C_BOLD}duplicate column / already exists${C_RESET}
        → A previous partial run. Migrations are idempotent — re-run is safe.
EOF
  exit 1
fi
ok "Migrations applied"

# ----- Step 5 -----------------------------------------------------------
step "Step 5/7 — Seed demo data (dev/staging only)"
if [ "${NODE_ENV:-development}" != "production" ]; then
  echo "NODE_ENV=${NODE_ENV:-development} — running demo seed"
  ENABLE_DEMO_SEED=1 npm run db:seed:demo || die "Demo seed failed — see error above"
  ok "Demo seed complete (login: admin@capavate.io / adminpass)"
else
  echo "NODE_ENV=production — skipping demo seed (intentional)"
fi

# ----- Step 6 -----------------------------------------------------------
step "Step 6/7 — Build production bundle"
npm run build || die "Build failed — see error above. Check tsx/TypeScript errors."
[ -f dist/index.cjs ]          || die "Build produced no dist/index.cjs"
[ -f dist/public/index.html ]  || die "Build produced no dist/public/index.html"
ok "Build artifacts present (dist/index.cjs + dist/public/)"

# ----- Step 7 -----------------------------------------------------------
step "Step 7/7 — Run install verifier"
if bash scripts/install_verifier.sh; then
  ok "Verifier passed"
else
  echo "${C_YELLOW}Verifier reported issues — read the output above.${C_RESET}"
  echo "Fix the FAIL items and re-run: bash scripts/install_verifier.sh"
  exit 1
fi

cat <<EOF

${C_GREEN}${C_BOLD}====================================================${C_RESET}
${C_GREEN}${C_BOLD} Install complete!${C_RESET}
${C_GREEN}${C_BOLD}====================================================${C_RESET}

Next steps:
  1. Configure your reverse proxy / domain (HTTPS terminates upstream).
  2. Start the server:        ${C_BOLD}npm start${C_RESET}
  3. Verify health:           curl https://<yourdomain>/api/health
  4. Open the admin login:    https://<yourdomain>/#/admin/login

See ${C_BOLD}DEPLOY_FOR_AVI.md section 5${C_RESET} for full post-deploy verification.

EOF
