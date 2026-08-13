#!/usr/bin/env python3
"""WAVE 33 · CP-SPV-31 — mutation testing for the deploy-capital path.

Each mutant reintroduces a defect that WAS actually possible here (several were
actually present in the shipped code before this item). A SURVIVOR is a hole in
the harness and must be classified as one of:
  · harness bug      — the test is wrong or matches the wrong thing
  · coverage gap     — nothing asserts this behaviour at all
  · equivalent mutant — the change cannot alter observable behaviour

Every anchor below is verified to exist BEFORE any mutation is applied. Wave 33
item 1 had a mutant report "SURVIVED" only because its anchor silently matched a
doc comment instead of code — a mutation harness that mutated nothing. The
anchor check makes that failure loud instead of silent.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST = "server/__tests__/wave33_spv31_deploy_capital.test.ts"

ENGINE = "server/lib/spvShareDerivation.ts"
ROUTES = "server/spvShareDerivationRoutes.ts"
SPVROUTES = "server/spvEngineRoutes.ts"
UI = "client/src/components/partner/SpvOperationsPanels.tsx"

# (id, file, find, replace, what defect this reintroduces)
MUTANTS = [
    # ── the 100x pair, both directions ────────────────────────────────────
    ("M1", ENGINE, "const exp = currencyExponent(currency);\n  if (!Number.isFinite(pricePerShare)) return null;",
     "const exp = 2;\n  if (!Number.isFinite(pricePerShare)) return null;",
     "hardcode exponent 2 in the price conversion — the original 100x defect"),
    ("M2", SPVROUTES, "function minorToDecimal(minor: number, currency: string)",
     "function minorToDecimal(minor: number, currency: string = \"USD\")",
     "let the ledger renderer default its currency instead of requiring it"),
    ("M3", SPVROUTES, "minorToDecimal(dep.amountMinor, dep.currency)",
     "minorToDecimal(dep.amountMinor, \"USD\")",
     "pass a constant currency into the sacred-ledger value"),

    # ── zero-coercion / ordering ──────────────────────────────────────────
    ("M4", SPVROUTES, "amountMinorExact = decimalStringToMinor(amount, currency",
     "amountMinorExact = decimalStringToMinorX(amount, currency",
     "rename the exact conversion away — ordering assertions must notice"),

    # ── refusals collapsing into zeros ────────────────────────────────────
    ("M5", ENGINE, 'return refuse("NO_PRICE_PER_SHARE", amountMinor, currency, pricePerShare);',
     'return { wholeShares: "0", residualMinor: 0, exact: true, refusal: null, copy: "", amountMinor, currency, pricePerShare };',
     "derive 0 shares instead of refusing when the round has no price"),
    ("M6", ENGINE, "if (pricePerShare <= 0) {", "if (pricePerShare < 0) {",
     "let a price of exactly zero through into a division"),
    ("M7", ENGINE, "if (priceMinor === null || priceMinor <= BigInt(0)) {",
     "if (priceMinor === null) {",
     "allow a price that flattened to zero minor units"),
    ("M8", ENGINE, "if (!Number.isFinite(amountMinor) || amountMinor <= 0) {",
     "if (!Number.isFinite(amountMinor)) {",
     "derive shares from a zero or negative deployment amount"),

    # ── rounding creeping back in ─────────────────────────────────────────
    ("M9", ENGINE, "const whole = amt / priceMinor;",
     "const whole = BigInt(Math.round(Number(amt) / Number(priceMinor)));",
     "round the share count to nearest instead of flooring — forbidden"),
    ("M10", ENGINE, "const exact = residual === BigInt(0);", "const exact = true;",
     "claim every division is exact and hide the residual"),
    ("M11", ENGINE, "const residual = amt % priceMinor;", "const residual = BigInt(0);",
     "report no residual on an inexact division"),

    # ── price representability ────────────────────────────────────────────
    ("M12", ENGINE, "  if (Math.abs(Number(fixed) - pricePerShare) > Number.EPSILON * Math.max(1, Math.abs(pricePerShare))) {\n    return null;\n  }",
     "  if (false) {\n    return null;\n  }",
     "silently flatten an unrepresentable price instead of refusing"),

    # ── the divergence warning ────────────────────────────────────────────
    ("M13", ENGINE, "if (BigInt(typed) === BigInt(derivation.wholeShares)) return null;",
     "return null;",
     "never warn about a divergent typed share count"),
    ("M14", ENGINE, "if (derivation.refusal !== null || derivation.wholeShares === null) return null;",
     "if (false) return null;",
     "invent a divergence against a derivation that does not exist"),

    # ── the route: scoping and read-only-ness ─────────────────────────────
    ("M15", ROUTES, "const partnerId = req.partnerContext?.partnerId;",
     "const partnerId = (req.query.partnerId as string) || req.partnerContext?.partnerId;",
     "let the caller name their own tenant in the query string"),
    ("M16", ROUTES, "if (!spvEngineStore.getSpv(partnerId, spvId)) {\n          return res.status(404).json(NOT_FOUND);\n        }",
     "if (false) {\n          return res.status(404).json(NOT_FOUND);\n        }",
     "drop the SPV ownership check before reading a deployment"),
    ("M17", ROUTES, "if (!dep) return res.status(404).json(NOT_FOUND);",
     "if (!dep) return res.status(403).json({ error: \"FORBIDDEN\" });",
     "confirm the row exists via a 403 — cross-tenant must be 404"),
    ("M18", ROUTES, '    hint: "Closing documents have gone to the company. Record the document reference alongside — it is the typed provenance for this deployment.",',
     '    hint: "",',
     "publish a rung with no explanation"),
    ("M19", ROUTES, '''  {
    to: "docs_sent",
    label: "Mark closing docs sent",''',
     '''  {
    to: "founder_confirmed",
    label: "Mark closing docs sent",''',
     "drop docs_sent back out of the published ladder — the original gap"),

    # ── the UI reaching the rung ──────────────────────────────────────────
    ("M20", UI, 'to: "docs_sent",', 'to: "wired",',
     "make the docs_sent control fire the wrong transition"),
    ("M21", UI, 'data-testid={`spv-deployment-docref-${depId}`}',
     'data-testid={`spv-deployment-noref-${depId}`}',
     "remove the closing-doc-ref input's identity"),

    # ── null-rendered-as-zero in the UI ───────────────────────────────────
    ("M22", UI, '{d.wholeShares === null ? "Derived shares: not available" : `Derived shares: ${d.wholeShares}`}',
     '{`Derived shares: ${d.wholeShares ?? 0}`}',
     "render an unavailable derivation as 0 shares in the product"),
]


def run_tests() -> bool:
    r = subprocess.run(
        ["npx", "vitest", "run", TEST],
        cwd=ROOT, capture_output=True, text=True, timeout=600,
    )
    return r.returncode == 0


def strip_comments(s: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", s))


def main() -> int:
    print("verifying anchors before mutating anything…")
    bad = []
    for mid, f, find, _repl, _desc in MUTANTS:
        src = (ROOT / f).read_text()
        n_raw = src.count(find)
        n_code = strip_comments(src).count(find)
        if n_raw == 0:
            bad.append(f"{mid}: anchor ABSENT in {f}")
        elif n_code == 0:
            # The exact failure mode that made a Wave-33 item-1 mutant lie.
            bad.append(f"{mid}: anchor matches ONLY A COMMENT in {f} — would mutate prose")
        elif n_raw > 1:
            bad.append(f"{mid}: anchor matches {n_raw}x in {f} — ambiguous")
    if bad:
        print("ANCHOR CHECK FAILED — no mutants were run:")
        for b in bad:
            print("  " + b)
        return 2
    print(f"  all {len(MUTANTS)} anchors unique and in code\n")

    print("baseline (unmutated) must PASS…")
    if not run_tests():
        print("BASELINE FAILS — mutation results would be meaningless.")
        return 2
    print("  baseline green\n")

    killed, survived = [], []
    for mid, f, find, repl, desc in MUTANTS:
        path = ROOT / f
        original = path.read_text()
        path.write_text(original.replace(find, repl, 1))
        try:
            ok = run_tests()
        finally:
            path.write_text(original)  # restore verbatim, always
        if ok:
            survived.append((mid, desc))
            print(f"  {mid} SURVIVED — {desc}")
        else:
            killed.append(mid)
            print(f"  {mid} killed    — {desc}")

    print(f"\n{len(killed)}/{len(MUTANTS)} killed")
    if survived:
        print("\nSURVIVORS (each needs a classification):")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
