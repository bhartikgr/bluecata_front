#!/usr/bin/env python3
"""WAVE 23 · ITEM 5 mutation matrix — mark-override approval default."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
S = "server/wave9ReportingStore.ts"
R = "server/lib/reportingEngineRoutes.ts"
M = "migrations/0174_wave23_mark_override_approval_default.sql"

MUTATIONS = [
    Mutation(
        name="M1-default-back-to-able_to",
        target=M,
        anchor="""   SET value_json  = '"required"',""",
        replacement="""   SET value_json  = '"able_to"',""",
        why="the exact governance defect: the DB default stays able_to",
    ),
    Mutation(
        name="M2-fallback-opens-up",
        target=S,
        anchor='  if (v === "able_to") return "able_to";\n  return "required";',
        replacement='  if (v === "required") return "required";\n  return "able_to";',
        why="the code fallback fails OPEN again on a missing/garbage config row",
    ),
    Mutation(
        name="M3-pending-effective-anyway",
        target=S,
        anchor="    return o.approvalState === \"approved\" || o.grandfatheredEffective === true;",
        replacement="    return true;",
        why="the approval gate stops gating",
    ),
    Mutation(
        name="M4-callsite-bypasses-gate",
        target=S,
        anchor="  if (!ov || !overrideIsEffective(ov)) return derived;",
        replacement='  if (!ov || ov.approvalState === "rejected") return derived;',
        why="the original defect: the mark call site re-derives the rule and skips the gate",
    ),
    Mutation(
        name="M5-able_to-capability-removed",
        target=S,
        anchor='  if (v === "able_to") return "able_to";',
        replacement="  // MUTANT: able_to no longer selectable",
        why="over-correction — the configurable capability is removed rather than un-defaulted",
    ),
    Mutation(
        name="M6-grandfather-overwrites-operator",
        target=M,
        anchor="   AND updated_by LIKE 'migration:%';",
        replacement="   AND 1 = 1;",
        why="grandfather class A broken — an operator's explicit able_to is overwritten",
    ),
    Mutation(
        name="M7-grandfather-b-dropped",
        target=M,
        anchor="   SET grandfathered_effective = 1\n WHERE approval_state = 'pending';",
        replacement="   SET grandfathered_effective = 0\n WHERE approval_state = 'pending';",
        why="grandfather class B broken — already-effective overrides silently de-effected",
    ),
    Mutation(
        name="M8-fabricate-approval",
        target=M,
        anchor="   SET grandfathered_effective = 1\n WHERE approval_state = 'pending'",
        replacement="   SET grandfathered_effective = 1, approval_state = 'approved', approved_by = 'system'\n WHERE approval_state = 'pending'",
        why="an approver and an approval are invented instead of grandfathering honestly",
    ),
    Mutation(
        name="M9-route-lies-about-effect",
        target=R,
        anchor="        effective: overrideIsEffective(ov),",
        replacement="        effective: true,",
        why="the API tells the GP their pending override is already in effect",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item5_override_approval_harness.ts"],
            MUTATIONS,
            "ITEM5",
        )
    )
