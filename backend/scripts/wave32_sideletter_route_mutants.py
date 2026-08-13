#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-30 · capability 4 — mutation run for the side-letter SURFACE.

Capability 2's run covered the economics. These mutants attack the routes: the
write gate, the register check, the null/zero collapse on an inherited rate, and
above all the LP read path, where a regression re-opens the Wave 29 / WAIVER-4
exposure between two passive LPs in one vehicle.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
R = ROOT / "server/spvSideLetterRoutes.ts"
TEST = "server/__tests__/wave32_side_letter_routes.test.ts"

MUTANTS = [
    (R, "R1 the LP route serves a caller-supplied investorId (the Wave 29 exposure shape)",
     "      res.json({ sideLetter: lpOwnSideLetter(spvId, ctx.userId) });",
     "      res.json({ sideLetter: lpOwnSideLetter(spvId, String(req.query.investorId ?? ctx.userId)) });"),

    (R, "R2 the LP membership check is dropped — any authenticated user reads any vehicle",
     "      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {",
     "      if (!spvBasics(spvId)) {"),

    (R, "R3 the non-member refusal becomes 403, turning the route into an enumeration oracle",
     "        return res.status(404).json({ error: \"SPV_NOT_FOUND\" });\n      }\n      // `null` means \"you are on fund default terms\"",
     "        return res.status(403).json({ error: \"FORBIDDEN\" });\n      }\n      // `null` means \"you are on fund default terms\""),

    (R, "R4 the LP route drops authentication entirely",
     "    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: \"AUTH_REQUIRED\" });\n    const spvId = String(req.params.spvId);\n    try {\n      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx.userId)) {",
     "    const spvId = String(req.params.spvId);\n    try {\n      if (!spvBasics(spvId) || !isCommittedLp(spvId, ctx?.userId ?? \"\")) {"),

    (R, "R5 a blank rate is coerced to 0% carry instead of NULL/inherit",
     "  if (v === undefined || v === null || v === \"\") return null;",
     "  if (v === undefined || v === null || v === \"\") return 0;"),

    (R, "R6 a non-integer rate is silently rounded instead of refused",
     "  if (!Number.isInteger(n)) throw new SideLetterValidationError(\"SIDE_LETTER_RATE_NOT_INTEGER_SCALED\", `${label} must be integer billionths`);\n  return n;",
     "  return Math.round(n);"),

    (R, "R7 a letter may be written for someone not on the committed register",
     "        if (!investorId || !isCommittedLp(spvId, investorId)) {",
     "        if (!investorId) {"),

    (R, "R8 the create route uses a caller-supplied currency instead of the vehicle's",
     "          currency: basics.currency,",
     "          currency: String((b as any).currency ?? basics.currency),"),

    (R, "R9 cross-partner writes are allowed (the partner scope check is dropped on create)",
     "        if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) return res.status(404).json({ error: \"SPV_NOT_FOUND\" });\n        const basics = spvBasics(spvId);",
     "        const basics = spvBasics(spvId);"),

    (R, "R10 revoke reports success for a letter that does not exist",
     "        if (!row) return res.status(404).json({ error: \"SIDE_LETTER_NOT_FOUND\" });",
     "        if (!row) return res.json({ sideLetter: null });"),
]


def main() -> int:
    original = R.read_text()
    results = []
    try:
        for path, name, old, new in MUTANTS:
            if old not in original:
                results.append((name, "ERROR: anchor not found"))
                print(f"ERROR    {name}", flush=True)
                continue
            path.write_text(original.replace(old, new, 1))
            p = subprocess.run(["npx", "vitest", "run", TEST], cwd=ROOT,
                               capture_output=True, text=True)
            path.write_text(original)
            killed = p.returncode != 0
            results.append((name, "KILLED" if killed else "SURVIVED"))
            print(f"{'KILLED  ' if killed else 'SURVIVED'} {name}", flush=True)
    finally:
        R.write_text(original)

    killed = sum(1 for _, r in results if r == "KILLED")
    print(f"\n{killed}/{len(results)} killed")
    for n, r in results:
        if r != "KILLED":
            print(f"  !! {r}: {n}")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
