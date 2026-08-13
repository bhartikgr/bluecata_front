#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-34 — mutation run for the honest 503 failure copy.

The failure mode this item exists to prevent is a blank that a GP reads as a
zero fee. So the mutants attack the three things that stop that: the copy
existing at all, the copy SAYING the blank is unknown, and the refusal being
RENDERED STATE rather than a toast that vanishes. S3 is the load-bearing one —
it puts the raw machine code back on a partner's screen.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
P = ROOT / "client/src/components/partner/SpvOperationsPanels.tsx"
T = ROOT / "client/src/components/partner/SpvDetailTabs.tsx"
E = ROOT / "server/spvEngineStore.ts"
TEST = "server/__tests__/wave32_spv34_honest_503.test.ts"

MUTANTS = [
    (P, "S1 the FEE_STATE_UNKNOWN copy is removed, so the fee ledger renders the raw code again",
     "  FEE_STATE_UNKNOWN:\n    \"Fee figures cannot be shown:",
     "  FEE_STATE_UNKNOWN_DISABLED:\n    \"Fee figures cannot be shown:"),

    (P, "S2 the copy stops saying the blank is UNKNOWN, so it reads as a zero fee",
     "so the carry and fees are unknown. Nothing here is a zero fee \u2014 no amount is being shown at all.",
     "and no amounts are available."),

    (P, "S3 THE CLASS FIX IS REVERTED — an unmapped code is rendered raw to a partner",
     "  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(msg.trim())) {",
     "  if (false && /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(msg.trim())) {"),

    (P, "S4 the generic refusal stops saying nothing was changed",
     "Nothing was changed. Quote reference",
     "Quote reference"),

    (P, "S5 the class fix swallows real prose messages too, hiding a server's own explanation",
     "  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(msg.trim())) {",
     "  if (/[A-Z][A-Z0-9]*(_[A-Z0-9]+)*/.test(msg.trim())) {"),

    (P, "S6 the mapped code falls through to the generic refusal, losing its specific copy",
     "    if (msg.includes(key)) return OPS_ERROR_COPY[key];",
     "    if (false && msg.includes(key)) return OPS_ERROR_COPY[key];"),

    (P, "S7 A TOAST AGAIN — the failed charge is no longer held as rendered state",
     "      setChargeFailure(opsErrorMessage(e));\n",
     ""),

    (P, "S8 the charge refusal is never cleared, so it lies above a charge that succeeded",
     "      setChargeFailure(null);\n      toast({ title: \"Fee charged\" });",
     "      toast({ title: \"Fee charged\" });"),

    (P, "S9 the refusal is nested inside the obligation list, so a refetch takes it away",
     "      {chargeFailure !== null && (\n        <div className=\"text-xs mb-1 text-red-600\" role=\"alert\" data-testid=\"spv-fee-charge-failed\">\n          No fee was charged \u2014 nothing was written. {chargeFailure}\n        </div>\n      )}\n      <div data-testid=\"spv-fee-obligations\">",
     "      <div data-testid=\"spv-fee-obligations\">\n      {chargeFailure !== null && (\n        <div className=\"text-xs mb-1 text-red-600\" role=\"alert\" data-testid=\"spv-fee-charge-failed\">\n          No fee was charged \u2014 nothing was written. {chargeFailure}\n        </div>\n      )}"),

    (T, "S10 the preview stops clearing stale totals, leaving last run's money on screen",
     "    onError: (e: Error) => {\n      setSplit(null);",
     "    onError: (e: Error) => {"),

    (T, "S11 the preview's honest 503 copy loses the 'not a zero-carry split' sentence",
     "This is not a zero-carry split \u2014 nothing is being shown.",
     "Nothing is being shown."),

    (E, "S12 A FAIL-CLOSED GUARD IS REMOVED — the money WRITE prices with an unreadable schedule",
     "    if (this.feeViewUnreliable(spvId)) throw new Error(\"FEE_STATE_UNKNOWN\");\n    if (!data.event) throw new Error(\"EVENT_REQUIRED\");",
     "    if (!data.event) throw new Error(\"EVENT_REQUIRED\");"),
]


def main() -> int:
    files = sorted({m[0] for m in MUTANTS}, key=str)
    originals = {f: f.read_text() for f in files}
    results = []
    try:
        for path, name, old, new in MUTANTS:
            src = originals[path]
            if old not in src:
                results.append((name, "ERROR: anchor not found"))
                print(f"ERROR    {name}", flush=True)
                continue
            path.write_text(src.replace(old, new, 1))
            p = subprocess.run(["npx", "vitest", "run", TEST], cwd=ROOT,
                               capture_output=True, text=True)
            path.write_text(src)
            killed = p.returncode != 0
            results.append((name, "KILLED" if killed else "SURVIVED"))
            print(f"{'KILLED  ' if killed else 'SURVIVED'} {name}", flush=True)
    finally:
        for f, src in originals.items():
            f.write_text(src)

    killed = sum(1 for _, r in results if r == "KILLED")
    print(f"\n{killed}/{len(results)} killed")
    for n, r in results:
        if r != "KILLED":
            print(f"  !! {r}: {n}")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
