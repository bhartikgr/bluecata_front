#!/usr/bin/env python3
"""WAVE 33 · CP-MFC-20 — mutation testing for cross-pillar `partnerRepresentation`.

Same discipline as the item-4 runner: every anchor is verified UNIQUE and
OUTSIDE COMMENTS before anything is mutated, because a harness that silently
mutates a doc comment reports SURVIVED while having changed nothing.

The mutants attack the three things this item is: the EMIT (does a stage change
produce an event at all?), the FOUR PILLAR GATES (does each deliver exactly to
its own pillar and no further?), and the SHIPPED SHAPE (does the code still
resolve a module at call time, which is how this feature was dead in production
while green everywhere else?).

Survivors must be classified: harness bug / coverage gap / equivalent mutant.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = [
    "server/__tests__/wave33_mfc20_crosspillar.test.ts",
    "client/src/lib/__tests__/wave33_mfc20_realtime_client.test.tsx",
]

BUS = "server/lib/eventBus.ts"
HELP = "server/lib/eventBusPillarHelpers.ts"
STORE = "server/partnerWorkspaceStore.ts"
CLIENT = "client/src/lib/realtimeSync.ts"

MUTANTS = [
    # ── the emit site ─────────────────────────────────────────────────────
    ("N1", STORE,
     '    if (patch.stage && patch.stage !== prevStage && d.companyId) {',
     '    if (false) {',
     "emit nothing on a stage change — the feature's silent original state"),
    ("N2", STORE,
     'emitMutation({ aggregate: "partnerRepresentation", id: `${partnerId}:${d.companyId}`, change: "update", tenantId: `tenant_pt_${partnerId}` });',
     'emitMutation({ aggregate: "partnerRepresentation", id: `${partnerId}:${d.companyId}`, change: "update", tenantId: `tenant_co_${d.companyId}` });',
     "R1-B2 REGRESSION — company tenant on the frame, so the tenant fast-path leaks it to founders/investors before any pillar gate runs"),
    ("N3", STORE,
     'emitMutation({ aggregate: "partnerRepresentation", id: `${partnerId}:${d.companyId}`, change: "update", tenantId: `tenant_pt_${partnerId}` });',
     'emitMutation({ aggregate: "partnerRepresentation", id: `${partnerId}`, change: "update", tenantId: `tenant_pt_${partnerId}` });',
     "drop the company from the composite id — every consumer fails closed and the feature dies silently"),
    ("N4", STORE,
     '    if (patch.stage && patch.stage !== prevStage && d.companyId) {',
     '    if (patch.stage && d.companyId) {',
     "emit on a no-op re-save — idempotency gate removed"),

    # ── the shipped shape (the defect this item found) ────────────────────
    ("N5", BUS,
     'import {\n  parsePartnerRepresentationId,',
     'import {\n  parsePartnerRepresentationId as parsePartnerRepresentationIdUnused,',
     "break the static import binding — stands in for reverting to call-time resolution"),
    ("N6", STORE,
     'import { emitMutation } from "./lib/eventBus";',
     'import { emitMutation as emitMutationUnused } from "./lib/eventBus";',
     "same, at the emit end"),

    # ── pillar 3: the emitting partner ────────────────────────────────────
    ("N7", BUS,
     '        if (teamMember.partnerId !== emittedPartnerId) return false;',
     '        if (false) return false;',
     "SCOPE LEAK — let partner A's team read partner B's stage moves"),
    ("N8", BUS,
     '        return hasActivePartnerAttribution(emittedPartnerId, emittedCompanyId);',
     '        return true;',
     "deliver to a partner whose attribution was revoked"),
    ("N9", BUS,
     '      if (!parsed) return false;',
     '      if (!parsed) return true;',
     "fail OPEN on a malformed id"),

    # ── the cross-pillar precondition ─────────────────────────────────────
    ("N10", BUS,
     '      if (!hasActivePartnerEngagement(emittedPartnerId, emittedCompanyId)) return false;',
     '      if (false) return false;',
     "propagate to other pillars after the mandate ended"),

    # ── pillar 2: Capavate direct ─────────────────────────────────────────
    ("N11", BUS,
     '      if (accessibleCompanies.has(emittedCompanyId) && isCapavatePortfolioCompany(emittedCompanyId)) {',
     '      if (isCapavatePortfolioCompany(emittedCompanyId)) {',
     "drop the entitlement conjunct — any authenticated caller gets any company's frame"),

    # ── pillar 1: Collective ──────────────────────────────────────────────
    ("N12", BUS,
     '        ctx.collective?.role === "dsc" &&',
     '        true &&',
     "any Collective member, not just a DSC principal"),
    ("N13", BUS,
     '        ctx.collective?.status === "active" &&',
     '        true &&',
     "a lapsed Collective membership keeps receiving"),
    ("N14", BUS,
     '        isCollectiveMemberCompany(emittedCompanyId)',
     '        true',
     "deliver a Collective frame for a company that is not a member company"),

    # ── fail-closed default ───────────────────────────────────────────────
    ("N15", BUS,
     '        isCollectiveMemberCompany(emittedCompanyId)\n      ) {\n        return true;\n      }',
     '        isCollectiveMemberCompany(emittedCompanyId)\n      ) {\n        return true;\n      }\n      return true;',
     "fail OPEN when no pillar matches"),

    # ── the predicates ────────────────────────────────────────────────────
    ("N16", HELP,
     '            AND revoked_at IS NULL\n          LIMIT 1`,',
     '          LIMIT 1`,',
     "treat a revoked attribution as active"),
    ("N17", HELP,
     "            AND status = 'ACTIVE'",
     "            AND status IS NOT NULL",
     "treat a TERMINATED engagement as live"),
    ("N18", HELP,
     "            AND m.status = 'active'\n            AND m.deleted_at IS NULL",
     "            AND m.deleted_at IS NULL",
     "treat an inactive Collective membership as active"),
    ("N19", HELP,
     '  if (parts.length !== 2) return null;',
     '  if (parts.length < 2) return null;',
     "accept a 3+ segment composite id"),
    ("N20", HELP,
     '  if (!partnerId || !companyId) return null;',
     '  if (false) return null;',
     "accept an empty half in the composite id"),
    ("N21", HELP,
     "  if (!partnerId || !companyId) return false;\n  try {\n    const row = rawDb()\n      .prepare(\n        `SELECT 1 AS hit\n           FROM partner_attributions",
     "  if (!partnerId || !companyId) return true;\n  try {\n    const row = rawDb()\n      .prepare(\n        `SELECT 1 AS hit\n           FROM partner_attributions",
     "attribution gate passes on blank ids instead of failing closed"),

    # ── the client half ───────────────────────────────────────────────────
    ("N22", CLIENT,
     '    "/api/partner/me/pipeline",',
     '',
     "drop pillar 3's key — the partner's own surface stops refreshing"),
    ("N23", CLIENT,
     '    "/api/collective/dsc/pipeline",',
     '',
     "drop pillar 1's key"),
    ("N24", CLIENT,
     '          const keys = AGGREGATE_TO_KEYS[e.aggregate] ?? [];',
     '          const keys: string[] = [];',
     "deliver every frame and invalidate nothing — the silent client-side death"),
    ("N25", CLIENT,
     'export const PARTNER_REPRESENTATION_AGGREGATE = "partnerRepresentation";',
     'export const PARTNER_REPRESENTATION_AGGREGATE = "partner_representation";',
     "typo the aggregate constant — subscribers silently never fire"),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", *TESTS], cwd=ROOT,
                       capture_output=True, text=True, timeout=1800)
    return r.returncode == 0


def strip_comments(s: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", s))


def main() -> int:
    print("verifying anchors before mutating anything…")
    bad, seen = [], set()
    for mid, f, find, _r, _d in MUTANTS:
        if mid in seen:
            bad.append(f"{mid}: duplicate mutant id")
        seen.add(mid)
        src = (ROOT / f).read_text()
        n_raw, n_code = src.count(find), strip_comments(src).count(find)
        if n_raw == 0:
            bad.append(f"{mid}: anchor ABSENT in {f}")
        elif n_code == 0:
            bad.append(f"{mid}: anchor matches ONLY A COMMENT in {f}")
        elif n_raw > 1:
            bad.append(f"{mid}: anchor matches {n_raw}x in {f} — ambiguous")
    if bad:
        print("ANCHOR CHECK FAILED — no mutants run:")
        for b in bad:
            print("  " + b)
        return 2
    print(f"  all {len(MUTANTS)} anchors unique and in code\n")

    print("baseline must PASS…")
    if not run_tests():
        print("BASELINE FAILS — results would be meaningless.")
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
            path.write_text(original)
        (survived if ok else killed).append((mid, desc))
        print(f"  {mid} {'SURVIVED' if ok else 'killed  '} — {desc}")

    print(f"\n{len(killed)}/{len(MUTANTS)} killed")
    if survived:
        print("\nSURVIVORS (each needs a classification):")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
