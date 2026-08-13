#!/usr/bin/env python3
"""WAVE 3F mutation M6 — remove ALL THREE deployment-fee idempotency layers.

Why all three at once. Removing any ONE layer is deliberately NOT observable,
and must not be: the layers are redundant on purpose —
  L1  the `charged` billing-row short-circuit in spvEngineDeploymentFeeHook,
  L2  the `partner_billing_entries` probe in spvDeploymentFee,
  L3  the `spv.deployment_fee_minor` / `deployment_fee_paid_at` stamp probe.
Each alone still refuses the second charge, so a single-layer mutation "passing"
is the redundancy working, not a hole in the test. M6 therefore knocks out all
three, at which point a retry double-charges and W3F-4C must fail.

Usage:  python3 scripts/w3f_mutate_m6.py apply|revert
"""
import shutil
import sys
from pathlib import Path

FEE = Path("server/lib/spvDeploymentFee.ts")
HOOK = Path("server/lib/spvEngineDeploymentFeeHook.ts")
BACKUPS = {FEE: Path("/tmp/w3f_m6_fee.bak"), HOOK: Path("/tmp/w3f_m6_hook.bak")}

L3 = "  if (spvRow && (spvRow.deployment_fee_paid_at || spvRow.deployment_fee_minor !== null)) {"
L3_MUT = "  if (false && spvRow && (spvRow.deployment_fee_paid_at || spvRow.deployment_fee_minor !== null)) {"
L1 = '  if (existing?.state === "charged") return { charged: false, reason: "already_charged" };'
L1_MUT = '  if (false) return { charged: false, reason: "already_charged" };'
L2_ANCHOR = "SELECT id FROM partner_billing_entries WHERE spv_fund_id = ?"
L2_RETURN = 'return { charged: false, reason: "already_charged" };'


def apply() -> None:
    for src, bak in BACKUPS.items():
        shutil.copy(src, bak)
    fee = FEE.read_text()
    assert L3 in fee, "M6 anchor L3 missing"
    fee = fee.replace(L3, L3_MUT, 1)
    i = fee.index(L2_ANCHOR)
    j = fee.index(L2_RETURN, i)
    fee = fee[:j] + "if (false) " + fee[j:]
    FEE.write_text(fee)
    hook = HOOK.read_text()
    assert L1 in hook, "M6 anchor L1 missing"
    HOOK.write_text(hook.replace(L1, L1_MUT, 1))


def revert() -> None:
    for src, bak in BACKUPS.items():
        if bak.exists():
            shutil.copy(bak, src)


if __name__ == "__main__":
    {"apply": apply, "revert": revert}[sys.argv[1]]()
