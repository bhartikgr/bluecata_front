#!/usr/bin/env python3
"""WAVE 24 · ITEM 1 mutation matrix — the mark-override review surface.

Each mutation is a way ITEM 1 could be shipped BROKEN while still compiling,
still rendering, and still looking reviewed. Three of them (M6, M7, M8) attack
the paths that were actually defective in this codebase rather than imagined
ones: the `effectiveMarkForCompany()` bypass Wave 23 found, and the bootstrap
heal that silently reinstated the unsafe default (found by this harness).
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

R = "server/lib/reportingEngineRoutes.ts"
S = "server/wave9ReportingStore.ts"
H = "server/lib/applyWave9ReportingSchema.ts"
P = "client/src/components/admin/MarkOverrideReviewPanel.tsx"

MUTATIONS = [
    Mutation(
        name="M1-rejection-reason-not-required",
        target=R,
        anchor='      if (decision === "rejected" && note.length < 10) {',
        replacement='      if (false && decision === "rejected" && note.length < 10) {',
        why="a rejection can be recorded with no reason at all — unauditable, the ITEM 1 requirement",
    ),
    Mutation(
        name="M2-reason-rule-applied-to-approval",
        target=R,
        anchor='      if (decision === "rejected" && note.length < 10) {',
        replacement="      if (note.length < 10) {",
        why="over-correction: approvals also demand a note, so the safe default becomes unusable again",
    ),
    Mutation(
        name="M3-whitespace-passes-as-reason",
        target=R,
        anchor='      const note = typeof b.note === "string" ? b.note.trim() : "";',
        replacement='      const note = typeof b.note === "string" ? b.note : "";',
        why="twelve spaces satisfy the reason rule — a guard that passes while checking nothing",
    ),
    Mutation(
        name="M4-reason-dropped-before-the-sink",
        target=R,
        anchor='        note === "" ? undefined : note,',
        replacement="        undefined,",
        why="the reason is validated and then thrown away on the way to the store",
    ),
    Mutation(
        name="M5-sink-stops-writing-the-note",
        target=S,
        anchor="          SET approval_state = ?, approved_by = ?, approved_at = ?, approval_note = ?",
        replacement="          SET approval_state = ?, approved_by = ?, approved_at = ?, approval_note = CASE WHEN ? IS NOT NULL THEN NULL ELSE NULL END",
        why="the column the reason lives in stops being written — the sink itself is broken",
    ),
    Mutation(
        name="M6-rejected-override-still-effective",
        target=S,
        anchor='  if (o.approvalState === "rejected") return false;',
        replacement='  if (o.approvalState === "rejected") return true;',
        why="a REJECTED override still moves the reported mark — rejection becomes decorative",
    ),
    # M7 — the ORIGINAL form of this mutation (rewriting the
    # `effectiveMarkForCompany()` call site to test only `rejected`, i.e. the
    # literal Wave 23 defect) was MISSED, and investigating that is how a THIRD
    # gate site came to light: `latestOverride()` (wave9ReportingStore.ts:602)
    # ALSO ends with `overrideIsEffective(o) ? o : null`. So the call-site
    # rewrite alone cannot reintroduce the defect — a pending override never
    # reaches the mutated line. That makes the original M7 an INVALID mutation
    # (it does not produce the defective behaviour), not a coverage gap. It is
    # replaced here by a mutation of the SINGLE decision function both gates
    # consult, which is the only edit that can actually open the gate.
    Mutation(
        name="M7-pending-effective-under-required",
        target=S,
        anchor='    return o.approvalState === "approved" || o.grandfatheredEffective === true;',
        replacement="    return true;",
        why="a PENDING override becomes effective under `required` — the dead-end Wave 23 closed reopens",
    ),
    Mutation(
        name="M8-bootstrap-reinstates-unsafe-default",
        target=H,
        anchor="      applyWave23ApprovalDefault(db);",
        replacement="      /* MUTANT: heal removed */",
        why="the real defect this harness found — a bootstrapped DB comes up on able_to again",
    ),
    Mutation(
        name="M9-heal-reads-the-wrong-migration",
        target=H,
        anchor='const MIGRATION_0174_BASENAME = "0174_wave23_mark_override_approval_default.sql";',
        replacement='const MIGRATION_0174_BASENAME = "0159_wave9_reporting_audit.sql";',
        why="parity-by-construction breaks: the heal replays the 0159 seed, i.e. able_to",
    ),
    Mutation(
        name="M10-decision-route-not-admin-gated",
        target=R,
        anchor='app.post("/api/admin/reporting/mark-overrides/:id/decision", requireAdmin',
        replacement='app.post("/api/admin/reporting/mark-overrides/:id/decision", requireAuth',
        why="any authenticated GP can approve their own override — review stops being review",
    ),
    Mutation(
        name="M11-list-lies-about-the-mode",
        target=R,
        anchor="      res.json({ ok: true, overrides: rows, total: rows.length, approvalMode: getOverrideApprovalMode() });",
        replacement='      res.json({ ok: true, overrides: rows, total: rows.length, approvalMode: "able_to" });',
        why="the UI is told the wrong governance mode and explains the wrong regime to the reviewer",
    ),
    Mutation(
        name="M12-reject-affordance-removed",
        target=P,
        anchor="          data-testid={`button-reject-override-${row.id}`}",
        replacement="          data-testid={`button-decline-override-${row.id}`}",
        why="the reject control disappears from the surface the whole item exists to provide",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave24/item1_mark_review_harness.ts"],
            MUTATIONS,
            "ITEM1",
        )
    )
