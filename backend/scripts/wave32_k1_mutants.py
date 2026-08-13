#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-30 · capability 3 — mutation run for the K-1 engine.

Every mutant below is a defect this codebase has a precedent for, or one the
brief forbids outright. The dominant family here is THE NULL/ZERO COLLAPSE: a
K-1 box that prints 0 instead of refusing is a filed misstatement, so most of
these mutants ask "would the harness notice if a blank quietly became a zero?".

A mutant that SURVIVES is reported with which of the three it is: harness bug,
coverage gap, or equivalent mutant.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
K1 = ROOT / "server/lib/spvK1.ts"
STORE = ROOT / "server/spvK1Store.ts"
ROUTES = ROOT / "server/spvK1Routes.ts"
TEST = "server/__tests__/wave32_k1_falsification.test.ts"

MUTANTS = [
    (K1, "K1 missing contributions become 0 instead of a refusal (the null/zero collapse)",
     "      contributionsMinor = null;\n      refusals.push(refusal(\"contributionsMinor\", \"NO_FUNDS_CONFIRMATION\"));",
     "      contributionsMinor = 0;"),

    (K1, "K2 an unconfirmed LP's COMMITMENT is reported as contributed capital",
     "      contributionsMinor = null;\n      refusals.push(refusal(\"contributionsMinor\", \"NO_FUNDS_CONFIRMATION\"));",
     "      contributionsMinor = Math.trunc(r.commitmentMinor);"),

    (K1, "K3 the roll-forward proceeds with unknown contributions treated as zero",
     "    if (contributionsMinor === null) {\n      beginningCapitalMinor = null;",
     "    if (false) {\n      beginningCapitalMinor = null;"),

    (K1, "K4 an unknown realized profit is silently treated as a zero-profit event",
     "      if (d.realizedProfitMinor === null) anyIncomeUnknown = true;",
     "      if (false) anyIncomeUnknown = true;"),

    (K1, "K5 allocated income is split by float proportion instead of the pinned allocator",
     "  const shares = allocateResidualCents(BigInt(Math.abs(Math.trunc(profitMinor))), weights);",
     "  const shares = weights.map((w) => BigInt(Math.round(Math.abs(profitMinor) * (Number(w) / Number(total)))));"),

    (K1, "K6 a LOSS is clamped to zero rather than allocated as negative",
     "    out.set(a.investorId, negative ? -v : v);",
     "    out.set(a.investorId, negative ? 0 : v);"),

    (K1, "K7 minor units are summed ACROSS currencies instead of refusing",
     "  if (currencies.size > 1) {",
     "  if (false) {"),

    (K1, "K8 ownership is emitted as a PERCENT rather than a fraction",
     "      ownershipFraction = Math.trunc(r.commitmentMinor) / totalCommitment;",
     "      ownershipFraction = (Math.trunc(r.commitmentMinor) / totalCommitment) * 100;"),

    (K1, "K9 an empty register divides by zero into Infinity/NaN instead of refusing",
     "    if (totalCommitment <= 0) {",
     "    if (false) {"),

    (K1, "K10 the tax-year filter is dropped — every year's events land on one K-1",
     "      if (y === taxYear) {",
     "      if (true) {"),

    (K1, "K11 prior-year events leak into the current year's boxes",
     "      } else if (y < taxYear) {",
     "      } else if (y <= taxYear) {"),

    (K1, "K12 ending capital omits the income leg (a silently wrong total)",
     "      endingCapitalMinor = beginningCapitalMinor + contributionsMinor! + allocatedIncomeMinor - distributionsMinor;",
     "      endingCapitalMinor = beginningCapitalMinor + contributionsMinor! - distributionsMinor;"),

    (STORE, "K13 a distribution with no carry_base tier reports zero profit instead of unknown",
     "      realizedProfitMinor = typeof base?.amountMinor === \"number\" ? base.amountMinor : null;",
     "      realizedProfitMinor = Number(base?.amountMinor ?? 0);"),

    (STORE, "K14 an LP sees DRAFT statements — an unfinished tax figure reaches a taxpayer",
     "              WHERE spv_id = ? AND investor_id = ? AND status = 'issued'",
     "              WHERE spv_id = ? AND investor_id = ?"),

    (STORE, "K15 the LP query is not scoped by investor — every LP's K-1 returned to one LP",
     "              WHERE spv_id = ? AND investor_id = ? AND status = 'issued'\n              ORDER BY tax_year DESC, generated_at DESC`)\n    .all(spvId, investorId)",
     "              WHERE spv_id = ? AND (investor_id = ? OR 1=1) AND status = 'issued'\n              ORDER BY tax_year DESC, generated_at DESC`)\n    .all(spvId, investorId)"),

    (STORE, "K16 regenerating does not supersede — two live drafts for one LP and year",
     "      db.prepare(\n        `UPDATE spv_k1_statement SET status = 'superseded', superseded_at = ?",
     "      if (false) db.prepare(\n        `UPDATE spv_k1_statement SET status = 'superseded', superseded_at = ?"),

    (STORE, "K17 refusals are persisted as zeros — the blank does not survive the round trip",
     "        k.beginningCapitalMinor, k.contributionsMinor, k.distributionsMinor, k.allocatedIncomeMinor,",
     "        k.beginningCapitalMinor ?? 0, k.contributionsMinor ?? 0, k.distributionsMinor ?? 0, k.allocatedIncomeMinor ?? 0,"),

    (ROUTES, "K18 a non-member LP is served another vehicle's statements",
     "      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {",
     "      if (!spvBasics(spvId)) {"),

    (ROUTES, "K19 the cross-tenant refusal becomes 403, turning the route into an enumeration oracle",
     "        return res.status(404).json({ error: \"SPV_NOT_FOUND\" });\n      }\n      res.json({ statements: lpOwnStoredK1s(spvId, ctx.userId) });",
     "        return res.status(403).json({ error: \"FORBIDDEN\" });\n      }\n      res.json({ statements: lpOwnStoredK1s(spvId, ctx.userId) });"),

    (ROUTES, "K20 the LP route honours a caller-supplied investorId (the Wave 29 exposure shape)",
     "      res.json({ statements: lpOwnStoredK1s(spvId, ctx.userId) });",
     "      res.json({ statements: lpOwnStoredK1s(spvId, String(req.query.investorId ?? ctx.userId)) });"),

    (ROUTES, "K21 a missing tax year silently defaults to the current one",
     "  const n = Number(raw);\n  if (!Number.isInteger(n) || n < 1900 || n > 2999) return null;",
     "  const n = Number(raw ?? new Date().getUTCFullYear());\n  if (!Number.isInteger(n) || n < 1900 || n > 2999) return null;"),

    (ROUTES, "K22 the LP route drops its authentication check entirely",
     "    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: \"AUTH_REQUIRED\" });\n    const spvId = String(req.params.spvId);\n    try {\n      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {",
     "    const spvId = String(req.params.spvId);\n    try {\n      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx?.userId ?? \"\")) {"),
]


def main() -> int:
    originals = {p: p.read_text() for p in {K1, STORE, ROUTES}}
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
        for p, s in originals.items():
            p.write_text(s)

    killed = sum(1 for _, r in results if r == "KILLED")
    print(f"\n{killed}/{len(results)} killed")
    for n, r in results:
        if r != "KILLED":
            print(f"  !! {r}: {n}")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
