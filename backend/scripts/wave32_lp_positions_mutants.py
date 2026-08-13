#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-30 · capability 5 — mutation run for the LP PORTAL.

Four files are attacked, because the capability is only as strong as its
weakest one:

  * `server/lpPositionsStore.ts`     — per-LP scoping, money, nulls-not-zeros
  * `server/lpPositionsRoutes.ts`    — session identity, 404-not-403, auth
  * `server/lib/spvBackedCompanies.ts` — the WAIVER-4 predicate itself, plus the
                                        third sink found this wave
  * `server/sprint21Routes.ts` /
    `server/collectiveNetworkStore.ts` — the mirrored co-members pair
  * `client/src/pages/investor/Portfolio.tsx` — the mount, since a component
                                        mounted nowhere is not shipped

W1 is the load-bearing one: it regresses WAIVER-4 by making the SPV exclusion
predicate a tautology. If W1 survives, the scoped LP view has silently become
full access and nothing else in this ledger can be trusted.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
S = ROOT / "server/lpPositionsStore.ts"
R = ROOT / "server/lpPositionsRoutes.ts"
X = ROOT / "server/lib/spvBackedCompanies.ts"
Q = ROOT / "server/sprint21Routes.ts"
N = ROOT / "server/collectiveNetworkStore.ts"
P = ROOT / "client/src/pages/investor/Portfolio.tsx"
TEST = "server/__tests__/wave32_lp_positions_falsification.test.ts"

MUTANTS = [
    # ── THE LOAD-BEARING CONSTRAINT ───────────────────────────────────────────
    (X, "W1 WAIVER-4 REGRESSED — the SPV exclusion predicate becomes a tautology, "
        "so two LPs of one vehicle resolve as cap-table counterparties again",
     "  return `NOT EXISTS (SELECT 1 FROM spv sx_${alias} WHERE sx_${alias}.id = ${alias}.company_id)`;",
     "  return `1 = 1 /* ${alias} */`;"),

    (X, "W2 the third sink is re-opened — isSpvBackedCompany always says 'not a vehicle', "
        "so one LP is handed every other LP's identity and committed amount",
     "    return !!row?.hit;",
     "    return false;"),

    (X, "W3 isSpvBackedCompany fails OPEN instead of denying enumeration",
     "    return true; // deny enumeration rather than risk introducing two blind LPs",
     "    return false;"),

    (Q, "W4 the guard is removed from the sprint21 co-members handler (the one that wins)",
     "      if (isSpvBackedCompany(companyId)) return res.json([]);\n      let raw = CO_MEMBERS_BY_COMPANY[companyId] ?? [];",
     "      let raw = CO_MEMBERS_BY_COMPANY[companyId] ?? [];"),

    (N, "W5 the guard is removed from the collectiveNetworkStore co-members handler, "
        "which is the one that returns amount/currency/shares per investor",
     "      if (isSpvBackedCompany(companyId)) return res.json([]);\n      const rows = (listMembersForCompany(companyId) as Array<any>) ?? [];",
     "      const rows = (listMembersForCompany(companyId) as Array<any>) ?? [];"),

    (Q, "W6 the ledger dependency reverts to a lazy require — the guarded path stops "
        "executing under the TS runtimes and every claim about it goes vacuous",
     "          const ledger = listMembersForCompany(companyId);",
     "          const ledger = require(\"./captableCommitStore\").listMembersForCompany(companyId) as Array<{ investorId: string }>;"),

    # ── PER-LP SCOPING IN THE STORE ───────────────────────────────────────────
    (S, "L1 the vehicle list ignores the caller — an LP sees every vehicle on the platform",
     "              WHERE investor_id = ? AND status = 'committed'",
     "              WHERE (investor_id = ? OR 1=1) AND status = 'committed'"),

    (S, "L2 the commitment read ignores the caller — LP A is shown LP B's commitment",
     "              WHERE spv_id = ? AND investor_id = ? AND status = 'committed' LIMIT 1",
     "              WHERE spv_id = ? AND (investor_id = ? OR 1=1) AND status = 'committed' LIMIT 1"),

    (S, "L3 called capital is summed across ALL LPs, not just the caller's confirmations",
     "  const mine = k1ContributionsForSpv(spvId).filter((c) => c.investorId === investorId);",
     "  const mine = k1ContributionsForSpv(spvId);"),

    (S, "L4 the distribution line is taken from whoever is first, not from the caller",
     "    const line = d.allocations.find((a) => a.investorId === investorId);",
     "    const line = d.allocations[0];"),

    (S, "L5 a non-member is served a position instead of null (the 404 becomes reachable data)",
     "  if (commitmentMinor === null) return null;",
     "  if (commitmentMinor === null) return { spvId } as unknown as LpPosition;"),

    # ── MONEY AND NULLS ───────────────────────────────────────────────────────
    (S, "L6 NULL-TO-ZERO COLLAPSE — an LP with no confirmed wire is reported as having funded 0",
     "  const calledCapitalMinor = mine.length === 0 ? null : mine.reduce((a, c) => a + c.receivedMinor, 0);",
     "  const calledCapitalMinor = mine.reduce((a, c) => a + c.receivedMinor, 0);"),

    (S, "L7 ownership is emitted as a PERCENT instead of a fraction",
     "  return ownCommitmentMinor / total;",
     "  return (ownCommitmentMinor / total) * 100;"),

    (S, "L8 the forbidden percentage repair `n > 1 ? n/100 : n` is introduced",
     "  return ownCommitmentMinor / total;",
     "  { const n = ownCommitmentMinor / total; return n > 1 ? n / 100 : n; }"),

    (S, "L9 CURRENCIES ARE SUMMED — the mixed-currency refusal is switched off",
     "  const mixedCurrency = new Set([basics.currency, ...dists.map((d) => d.currency)]).size > 1;",
     "  const mixedCurrency = false;"),

    (S, "L10 the capital account ADDS distributions instead of subtracting them",
     "        : calledCapitalMinor - distributionsReceivedMinor,",
     "        : calledCapitalMinor + distributionsReceivedMinor,"),

    (S, "L11 the refusal copy is dropped, so a blank renders with no explanation",
     "    refusals.push(\"No confirmed capital receipt is on record for your commitment yet, so called capital is shown as unavailable rather than as zero.\");",
     "    /* refusal suppressed */;"),

    (S, "L12 an LP interest is labelled as a direct holding",
     "    positionType: \"spv_lp_interest\",",
     "    positionType: \"direct_holding\" as \"spv_lp_interest\","),

    (S, "L13 the side-letter flag leaks the EXISTENCE of any letter in the vehicle, not the caller's",
     "    hasSideLetter: lpOwnSideLetter(spvId, investorId) !== null,",
     "    hasSideLetter: true,"),

    (S, "L14 THE SCOPE FLAG IS FLIPPED — LPs silently receive Collective deal flow",
     "export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = \"vehicle_only\";",
     "export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = \"collective_access\";"),

    (S, "L15 the scope becomes an ambient environment read, which no test can pin",
     "export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = \"vehicle_only\";",
     "export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = (process.env.LP_SCOPE as LpCollectiveScope) ?? \"vehicle_only\";"),

    # ── ROUTES ────────────────────────────────────────────────────────────────
    (R, "R1 the routes serve a CALLER-SUPPLIED investorId instead of the session identity",
     "lpPositionsFor(ctx.userId)",
     "lpPositionsFor(String((req.query as any).investorId ?? ctx.userId))"),

    (R, "R2 the single-vehicle route serves a caller-supplied investorId",
     "lpPositionFor(String(req.params.spvId), ctx.userId)",
     "lpPositionFor(String(req.params.spvId), String((req.query as any).investorId ?? ctx.userId))"),

    (R, "R3 the non-member refusal becomes 403, turning the route into an enumeration oracle",
     "return res.status(404).json({ error: \"SPV_NOT_FOUND\" });",
     "return res.status(403).json({ error: \"FORBIDDEN\" });"),

    # ── THE MOUNT ─────────────────────────────────────────────────────────────
    (P, "U1 the component is imported but never rendered — shipped nowhere",
     "        <LpPositions />",
     "        {false && <LpPositions />}"),
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
