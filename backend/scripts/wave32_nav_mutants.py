#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-30 · capability 1 — mutation run for the NAV harness.

Each mutant is a real defect this codebase has actually shipped before (or the
brief explicitly forbids). A mutant that SURVIVES is reported with which of the
three it is: harness bug, coverage gap, or equivalent mutant.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
SRC = ROOT / "server/lib/spvNav.ts"
TEST = "server/__tests__/wave32_nav_falsification.test.ts"

MUTANTS = [
    ("M1 unmarked holding falls back to COST (the portfolioAnalyticsStore:100 defect)",
     "        ageDays: null, refusal: \"NO_PRICED_ROUND\",\n      });\n      continue;",
     "        ageDays: null, refusal: \"NO_PRICED_ROUND\",\n      });\n      totalFair += BigInt(Math.trunc(h.costMinor)); marked += 1; unmarked -= 1;\n      continue;"),
    ("M2 mixed-currency guard removed (sums minor units across currencies)",
     "  const mixedCurrency = currencies.size > 1;",
     "  const mixedCurrency = false;"),
    ("M3 half-even tie-break becomes half-up",
     "  else out = q % TWO === ZERO ? q : q + ONE;",
     "  else out = q + ONE;"),
    ("M4 worst badge becomes FIRST badge seen",
     "    if (worst === null || (BADGE_SEVERITY[mark.badge] ?? 0) > (BADGE_SEVERITY[worst] ?? 0)) {",
     "    if (worst === null) {"),
    ("M5 per-LP share uses Math.round instead of the allocator (forbidden rule 4)",
     "  const shares = allocateResidualCents(BigInt(Math.trunc(totalNavMinor)), weights);",
     "  const shares = weights.map((w) => BigInt(Math.round(Number(BigInt(Math.trunc(totalNavMinor)) * w) / Number(totalWeight))));"),
    ("M6 currency exponent hardcoded to 2 (breaks the JPY fixture)",
     "  const exponent = currencyExponent(currency);",
     "  const exponent = 2;"),
    ("M7 unknown NAV becomes 0 instead of null",
     "    totalNavMinor: status === \"complete\" ? Number(totalFair) : null,",
     "    totalNavMinor: Number(totalFair),"),
    ("M8 pending deployments counted as holdings",
     "  const held = args.holdings.filter((h) => isHoldingState(h.status));",
     "  const held = args.holdings.slice();"),
    ("M9 null share count silently treated as zero shares",
     "  if (!sh || !pps) return null;",
     "  if (!pps) return null;\n  if (!sh) return BigInt(0);"),
    ("M10 empty register invents an even split instead of refusing",
     "  if (totalWeight <= BigInt(0)) {",
     "  if (false) {"),
]

orig = SRC.read_text()
results = []
for name, old, new in MUTANTS:
    if old not in orig:
        results.append((name, "ERROR: anchor not found")); continue
    SRC.write_text(orig.replace(old, new, 1))
    p = subprocess.run(["npx", "vitest", "run", TEST], cwd=ROOT,
                       capture_output=True, text=True)
    SRC.write_text(orig)
    killed = p.returncode != 0
    results.append((name, "KILLED" if killed else "SURVIVED"))
    print(f"{'KILLED  ' if killed else 'SURVIVED'} {name}", flush=True)

SRC.write_text(orig)
print("\n=== SUMMARY ===")
for n, r in results:
    print(f"{r:9s} {n}")
sys.exit(0 if all(r == "KILLED" for _, r in results) else 1)
