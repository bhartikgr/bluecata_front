#!/usr/bin/env python3
"""
WAVE 33 · OQ-33-2 — mutation run for the five money-exponent sinks.

Each mutant RESTORES the exact defect that was fixed (a hardcoded ISO 4217
exponent of 2), plus a pole mutant per sink that deletes the conversion
entirely. A harness that only pins the JPY answer would survive the second
class; a harness that only pins the USD answer would survive the first. Both
must die.

Anchors are verified UNIQUE and OUTSIDE COMMENTS before anything is mutated —
an earlier Wave-33 mutant reported SURVIVED while silently mutating a doc
comment, which is this build's own lesson reappearing inside the tooling.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS = "server/__tests__/wave33_oq332_money_exponent.test.ts"

MUTANTS = [
    # (id, file, anchor, replacement, description)
    ("M1", "server/wave9ReportingStore.ts",
     "  return toMinor(major, currency);",
     "  return Math.round(major * 100);",
     "sink 1: restore the hardcoded exponent 2"),
    ("M2", "server/wave9ReportingStore.ts",
     "    amountMinor: -toMinorUnits(p.invested, p.currency),",
     "    amountMinor: -p.invested,",
     "sink 1 (capital-call pole): drop the conversion entirely"),
    ("M3", "server/wave9ReportingStore.ts",
     "      ? positions.reduce((s, p) => s + toMinorUnits(p.currentValue as number, p.currency), 0)",
     "      ? positions.reduce((s, p) => s + Math.round((p.currentValue as number) * 100), 0)",
     "sink 1 (residual pole): restore the hardcoded exponent 2"),
    ("M4", "server/routes.ts",
     "        return sum + toMinor(raw, roundCurrency);",
     "        return sum + Math.round(raw * 100);",
     "sink 2: restore the hardcoded exponent 2"),
    ("M5", "server/routes.ts",
     "        return sum + toMinor(raw, roundCurrency);",
     "        return sum + raw;",
     "sink 2: drop the conversion entirely"),
    ("M6", "server/routes.ts",
     "        (sum, sc) => sum + toMinor(sc.amount ?? 0, roundCurrency),",
     "        (sum, sc) => sum + Math.round((sc.amount ?? 0) * 100),",
     "sink 3: restore the hardcoded exponent 2"),
    ("M7", "server/routes.ts",
     "        (sum, sc) => sum + toMinor(sc.amount ?? 0, roundCurrency),",
     "        (sum, sc) => sum + (sc.amount ?? 0),",
     "sink 3: drop the conversion entirely"),
    ("M8", "server/track1Routes.ts",
     "      data.amountStr = String(Number(data.amountStr) + toMinor(Number(e.amount), roundCurrency));",
     "      data.amountStr = String(Number(data.amountStr) + Math.round(Number(e.amount) * 100));",
     "sink 4: restore the hardcoded exponent 2"),
    ("M9", "server/track1Routes.ts",
     '    const roundCurrency = (round as { currency?: string | null } | undefined)?.currency ?? "USD";',
     '    const roundCurrency = "USD";',
     "sink 4: stop consulting the round's currency (pin it to exponent 2)"),
    ("M10", "server/track4Routes.ts",
     '          stored > 0 ? stored : toMinor(Number(r.amount_major) || 0, r.currency ?? "USD"),',
     '          stored > 0 ? stored : Math.round((Number(r.amount_major) || 0) * 100),',
     "sink 5: restore the hardcoded exponent 2 (now in JS)"),
    ("M11", "server/track4Routes.ts",
     '          stored > 0 ? stored : toMinor(Number(r.amount_major) || 0, r.currency ?? "USD"),',
     '          stored > 0 ? stored : toMinor(Number(r.amount_major) || 0, "USD"),',
     "sink 5: ignore the row's currency and assume USD"),
    ("M12", "server/track4Routes.ts",
     "      const stored = Number(r.amount_minor) || 0;",
     "      const stored = 0;",
     "sink 5: never honour a pre-migrated amount_minor"),
    ("M13", "server/portfolioAnalyticsStore.ts",
     "    bundle.residualValueMinor === null ? null : fromMinor(bundle.residualValueMinor, bundleCurrency);",
     "    bundle.residualValueMinor === null ? null : bundle.residualValueMinor / 100;",
     "sink 6: restore the hardcoded /100 on the residual pole"),
    ("M14", "server/portfolioAnalyticsStore.ts",
     "  const totalRealized = fromMinor(m.inputs.distributedMinor, bundleCurrency);",
     "  const totalRealized = m.inputs.distributedMinor / 100;",
     "sink 6: restore the hardcoded /100 on the realized pole"),
    ("M15", "server/portfolioAnalyticsStore.ts",
     "  const bundleCurrency = bundle.currency;",
     '  const bundleCurrency = "USD";',
     "sink 6: stop consulting the bundle's currency (pin it to exponent 2)"),
]


def strip_comments(src: str) -> str:
    src = re.sub(r"/\*[\s\S]*?\*/", lambda m: "\n" * m.group(0).count("\n"), src)
    src = re.sub(r"(^|[^:])//.*$", r"\1", src, flags=re.M)
    return src


def precheck() -> bool:
    ok = True
    for mid, rel, anchor, _repl, _desc in MUTANTS:
        src = (ROOT / rel).read_text()
        n_all = src.count(anchor)
        n_code = strip_comments(src).count(anchor)
        if n_all != 1:
            print(f"  PRECHECK FAIL {mid}: anchor occurs {n_all}x in {rel} (must be exactly 1)")
            ok = False
        elif n_code != 1:
            print(f"  PRECHECK FAIL {mid}: anchor in {rel} is inside a COMMENT")
            ok = False
    return ok


def run_harness() -> bool:
    r = subprocess.run(
        ["npx", "vitest", "run", HARNESS],
        cwd=ROOT, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    print("Pre-check: every anchor unique and outside comments…")
    if not precheck():
        print("ABORTED — nothing was mutated.")
        return 2
    print("  ok\n")

    print("Baseline (unmutated) must PASS…")
    if not run_harness():
        print("  BASELINE FAILS — aborting.")
        return 2
    print("  ok\n")

    killed, survived = [], []
    for mid, rel, anchor, repl, desc in MUTANTS:
        p = ROOT / rel
        original = p.read_text()
        p.write_text(original.replace(anchor, repl, 1))
        try:
            passed = run_harness()
        finally:
            p.write_text(original)
        if passed:
            survived.append((mid, desc))
            print(f"  {mid} SURVIVED   — {desc}")
        else:
            killed.append(mid)
            print(f"  {mid} killed     — {desc}")

    print(f"\n{len(killed)}/{len(MUTANTS)} KILLED")
    for mid, desc in survived:
        print(f"  SURVIVOR {mid}: {desc}")
    return 0 if not survived else 1


if __name__ == "__main__":
    sys.exit(main())
