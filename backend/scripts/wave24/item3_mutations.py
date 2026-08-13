#!/usr/bin/env python3
"""WAVE 24 · ITEM 3 + MONEY mutation matrix.

Two of these (N13, N14) attack the HARNESS rather than the product, because a
structural auditor and a currency fixture are precisely the two things that can
go green while checking nothing:

  N13 strengthens the PRE-FIX DECOY so it no longer looks broken. If the harness
      still passes, its POLE B control is decorative and PART A proves nothing.
  N14 makes JPY a two-decimal currency. If the harness still passes, the JPY
      fixture — the one thing that can catch a hardcoded `/100` — is inert.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

M = "client/src/pages/collective/MembershipPage.tsx"
K = "server/adminPlatformStore.ts"
D = "client/src/pages/admin/Dashboard.tsx"
I = "client/src/lib/moneyInput.ts"
C = "client/src/lib/currency.ts"
HARNESS = "scripts/wave24/item3_failclosed_harness.ts"

MUTATIONS = [
    Mutation(
        name="N1-no-error-branch",
        target=M,
        anchor="      {useAdminCatalog ? null : tierQ.isError || catalogQ.isError ? (",
        replacement="      {useAdminCatalog ? null : false ? (",
        why="the exact Review B defect returns: a failed price fetch renders the card anyway",
    ),
    Mutation(
        name="N2-empty-state-not-gated-on-isSuccess",
        target=M,
        anchor="      ) : !tierQ.isSuccess || !catalogQ.isSuccess ? (",
        replacement="      ) : false ? (",
        why="a PAUSED (offline) query is neither loading nor errored, so the card mounts unpriced",
    ),
    Mutation(
        name="N3-catalog-subscribe-live-at-unknown-price",
        target=M,
        anchor="                    p.unitAmount === null ||",
        replacement="                    false ||",
        why="the SECOND path: an admin package with a null price keeps a live Subscribe button",
    ),
    Mutation(
        name="N4-eligibility-queue-fabricates-zero",
        target=K,
        anchor="    eligibilityRecompute: null,",
        replacement="    eligibilityRecompute: 0,",
        why="an unmeasured queue reads as a measured empty queue on the admin dashboard",
    ),
    Mutation(
        name="N5-email-queue-fabricates-zero",
        target=K,
        anchor="    emailQueue: null,",
        replacement="    emailQueue: 0,",
        why="same fabrication one line down — both were hardcoded 0 before Wave 24",
    ),
    Mutation(
        name="N6-blanket-null-hides-a-real-measurement",
        target=K,
        anchor="    bridgeOutbox: outbox.filter(e => e.status === \"queued\").length,",
        replacement="    bridgeOutbox: null,",
        why="the opposite failure: nulling a queue that IS measured hides a real number",
    ),
    Mutation(
        name="N7-dashboard-coerces-null-to-zero",
        target=D,
        anchor='{value ?? "—"}',
        replacement="{value ?? 0}",
        why="the sink undoes the fix at the last inch — N/A is rendered as 0 to the operator",
    ),
    Mutation(
        name="N8-parser-assumes-two-decimals",
        target=I,
        anchor="  const exp = currencyExponent(currency);",
        replacement="  const exp = 2;",
        why="`15.00 JPY` becomes acceptable input — a fractional yen the currency has no unit for",
    ),
    Mutation(
        name="N9-hardcoded-times-100",
        target=I,
        anchor="  const minor = toMinor(Number(s), currency);",
        replacement="  const minor = Math.round(Number(s) * 100);",
        why="Rule 4's headline bug: 1500 JPY posts as 150000 minor units",
    ),
    Mutation(
        name="N10-rounds-instead-of-refusing",
        target=I,
        anchor="  if (!re.test(s)) return undefined;",
        replacement="  if (!re.test(s) && false) return undefined;",
        why="a third of a cent is silently rounded into an amount nobody authorised",
    ),
    Mutation(
        name="N11-empty-input-becomes-zero",
        target=I,
        anchor='  if (s === "") return undefined;',
        replacement='  if (s === "") return 0;',
        why="a refused amount and a zero amount stop being different claims",
    ),
    # N12 — the FIRST form of this mutation deleted the post-parse guard
    # `if (minor < 0 && opts?.allowNegative !== true) return undefined;` and was
    # MISSED. That is NOT a coverage gap and it is not a harness bug: it is an
    # EQUIVALENT MUTANT. When `allowNegative` is false the regex is built with
    # no sign group (`^\d+$`), so a leading "-" never reaches the numeric guard
    # at all — the two checks are deliberate defence in depth and either one
    # alone refuses the input. No observable behaviour changes, so nothing can
    # observe it. Breaking BOTH layers takes two edits, which this runner (one
    # anchor per mutation, by design) cannot express. The mutation is therefore
    # replaced with one that DOES change behaviour, in the opposite direction:
    # the opt-in stops working, and a legitimate negative adjustment line is
    # silently refused.
    Mutation(
        name="N12-negative-opt-in-silently-ignored",
        target=I,
        anchor='  const neg = opts?.allowNegative === true ? "-?" : "";',
        replacement='  const neg = "";',
        why="an invoice adjustment/refund line can no longer be entered — the caller's opt-in is dropped",
    ),
    Mutation(
        name="N13-HARNESS-decoy-is-not-actually-broken",
        target=HARNESS,
        anchor="      {tierQ.isLoading || catalogQ.isLoading ? (",
        replacement="      {tierQ.isError ? <LoadFailedRefusal what=\"pricing\" /> : tierQ.isLoading || catalogQ.isLoading ? (",
        why="HARNESS ATTACK: if a half-fixed decoy still passes, PART A's POLE B control is decorative",
    ),
    Mutation(
        name="N14-HARNESS-jpy-fixture-made-inert",
        target=C,
        anchor="  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,",
        replacement="  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 2, KMF: 0, KRW: 0,",
        why="HARNESS ATTACK: if JPY stops being exponent-0 and the harness still passes, the fixture proves nothing",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave24/item3_failclosed_harness.ts"],
            MUTATIONS,
            "ITEM3",
        )
    )
