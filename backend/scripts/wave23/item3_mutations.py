#!/usr/bin/env python3
"""WAVE 23 · ITEM 3 mutation matrix — fundAdminReport cross-currency grouping."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
T = "server/mfcrmAcctStore.ts"

MUTATIONS = [
    Mutation(
        name="M1-restore-mixed-sum",
        target=T,
        anchor="      addToBucket(pendingBuckets, r.currency, r.amount_minor ?? 0);",
        replacement='      addToBucket(pendingBuckets, "USD", r.amount_minor ?? 0);',
        why="the exact defect: every currency collapses into one bucket again",
    ),
    Mutation(
        name="M2-substitute-number",
        target=T,
        anchor="        pendingAmountMinor: pendingAmount.available ? pendingAmount.minor : null,",
        replacement="        pendingAmountMinor: pendingAmount.available ? pendingAmount.minor : Object.values(pendingBuckets).reduce((a, b) => a + b, 0),",
        why="falls back to the invented cross-currency total instead of null",
    ),
    Mutation(
        name="M3-invent-currency-label",
        target=T,
        anchor='    const pendingAmount: MoneyScalar = singleCurrencyScalar(pendingBuckets, "USD");',
        replacement='    const pendingAmount: MoneyScalar = { available: true, currency: "USD", minor: Object.values(pendingBuckets).reduce((a, b) => a + b, 0) } as MoneyScalar;',
        why="stamps a currency that was not the source currency",
    ),
    Mutation(
        name="M4-drop-breakdown",
        target=T,
        anchor="        pendingByCurrency: bucketsToArray(pendingBuckets),",
        replacement="        pendingByCurrency: [],",
        why="the authoritative per-currency shape silently disappears",
    ),
    Mutation(
        name="M5-include-settled-rows",
        target=T,
        anchor='      if (r.status !== "pending") continue;',
        replacement="      // MUTANT: no status filter",
        why="settled rows leak into the PENDING buckets",
    ),
    Mutation(
        name="M6-single-currency-broken",
        target=T,
        anchor="    const pendingBuckets: CurrencyBuckets = {};",
        replacement="    const pendingBuckets: CurrencyBuckets = { XXX: 0 };",
        why="over-correction: an ordinary single-currency install becomes 'mixed'",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item3_mfcrm_currency_harness.ts"],
            MUTATIONS,
            "ITEM3",
        )
    )
