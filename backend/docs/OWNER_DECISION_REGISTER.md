# OWNER DECISION REGISTER — 11 v2 decisions awaiting a ruling

**Item DEC-1.** *Apply the owner's rulings on the 10 SHOULD-ESCALATE v2
decisions plus D-18.*

> **GENERATED FILE — do not hand-edit.**
> Produced by `scripts/build_package_docs.py` from `spec/V2_DECISION_AUDIT.md`.
> `python3 scripts/build_package_docs.py --verify` fails if this file and
> its source have drifted apart, so an edit here is a gate failure, not a
> silent second source of truth. Change the spec, then regenerate.

## STATUS: THE RULINGS DO NOT EXIST YET. NOTHING HAS BEEN APPLIED.

DEC-1 cannot be executed as written, and this file says so rather than
reporting a partial application. The evidence, verified at source:

- `CONSORTIUM_PARTNER_BUILD_v8.md:572` — `GATE-D10 blocks DEC-1`.
- `CONSORTIUM_PARTNER_BUILD_v8.md:385` — `GATE-D10` = *"Owner rules the 10
  SHOULD-ESCALATE v2 decisions (D-01,11,13,14,17,19,20,24,30,32)"*,
  `owner_decision = Y`. It is a GATE, and it is not closed.
- `CONSORTIUM_PARTNER_BUILD_v5.md:2852` — `OPN-013` is still **OPEN**: *"10
  SHOULD-ESCALATE decisions have not been put to the owner."*
- `CAPAVATE_MASTER_BUILD_SPEC_v3.md:124` (V3-7) records the ten as
  **"returned to the owner"** — returned is not ruled.
- `spec/OWNER_RULINGS_2026_08_09.md` rules **OQ-1 … OQ-12 only**. It contains no
  ruling on any `D-nn`. There is no other rulings document in `spec/`.

So the deliverable here is the instrument that lets the gate close: each
decision with its audit rationale and an explicit, empty ruling slot. This is
**not** a deferral and must not be recorded as one — the item is blocked on an
input only the owner can supply, and it is accounted for individually below.

**Until a ruling is recorded, engineering may build the mechanism but must not
activate the policy.** That distinction is the audit's own: on D-01 it reads
*"engineering can implement the schema but should not activate unapproved
resolution semantics."* Every row below inherits that rule.

## The 11 decisions owed a ruling

| ID | Decision | Class | Why it is the owner's call, not engineering's | RULING |
|---|---|---|---|---|
| **D-01** | Extend `partner_promotions` with typed promotion targets. | SHOULD-ESCALATE | The table location is technical, but the accompanying design creates commercial targeting scopes and redemption precedence: company/contact/chapter/global targeting, no stacking, most-specific-wins, and larger-benefit tie-breaking. Those rules determine who receives a monetary benefit. | **UNRULED** |
| **D-11** | Fold the deprecated free/pro-tier question into the waiver-cohort question. | SHOULD-ESCALATE | OQ-E11 also determines whether the live `activate-free` path closes and whether new free holders can still be created. That product-entitlement decision is not fully answered by selecting a migration treatment for existing holders. | **UNRULED** |
| **D-13** | Ship partner subscriptions as billing-only, without an access gate. | SHOULD-ESCALATE | This decides that unpaid or lapsed partners retain product access. It is an entitlement, collections, and revenue-policy choice—the original G-D2 owner decision. | **UNRULED** |
| **D-14** | Add discount scope and prevent founder use of partner codes. | SHOULD-ESCALATE | Discount scope determines who may receive a monetary benefit. Fail-closed behavior is a safe interim control, but the permanent eligibility policy belongs to the owner—the original G-D3 decision. | **UNRULED** |
| **D-17** | Expose the existing discount editor as editable Admin Fees Tab 5. | SHOULD-ESCALATE | This changes what administrators can do to live money-affecting promotions. The owner should approve the capability, permissions, safeguards, and treatment of the live VIP coupon before it is exposed. | **UNRULED** |
| **D-18** | Key SPV compliance display from terms jurisdiction and retain a legacy fallback. | UNDER-JUSTIFIED | Using the transaction jurisdiction is the right direction, but the fallback behavior is unspecified. A compliance panel must define fail-safe behavior for missing, invalid, or unsupported jurisdiction values rather than silently inheriting a possibly wrong legal regime. | **UNRULED** |
| **D-19** | Do not register the 21 `spv.*` bridge events until I-3 is repaired. | SHOULD-ESCALATE | The events are currently emitted and silently dropped, leaving downstream consumers blind. Deferral is a product/integration-scope choice, and I-3 itself remains unowned pending an owner decision, so this can become an indefinite silent omission. | **UNRULED** |
| **D-20** | Rebase an unverifiable audit chain with a documented genesis anchor. | SHOULD-ESCALATE | This changes the evidentiary posture of an audit trail. The Wave F assumptions ledger itself says owner/counsel should confirm that no compliance regime forbids rebasing; engineering should not make that legal and risk-acceptance decision autonomously. | **UNRULED** |
| **D-24** | Generate deterministic company colors and defer editable brand colors. | SHOULD-ESCALATE | Company color is user-visible branding, and deferring brand control narrows Wave H product scope. The owner should choose the interim visual behavior and whether editable branding is in scope. | **UNRULED** |
| **D-30** | Assume PostgreSQL is not on the roadmap and skip portability lint. | SHOULD-ESCALATE | Database-roadmap intent cannot be inferred. The owner's standing rule prohibits this assumption, and the choice affects future platform architecture and migration cost. | **UNRULED** |
| **D-32** | Turn Wave E's written precondition into a kickoff gate requiring owner confirmation. | SHOULD-ESCALATE | This is still an owner decision about whether the current fail-closed-client/no-server-truth posture is acceptable. Reformatting it as a gate does not autonomously resolve it and contradicts the claim that only the 24-item register needs owner input. | **UNRULED** |

## Plus 2 decisions the audit found technically WRONG

These are not awaiting a ruling — they are awaiting a corrected design, and the
audit specifies what the correction must contain. They are listed here because a
reader closing GATE-D10 will otherwise assume the decision log is now clean.

| ID | Decision | Why it is wrong |
|---|---|---|
| **D-16** | Make `platform_config` canonical for the renewal worker and demote env vars to kill switches. | The wave simultaneously says the worker is off unless `PARTNER_RENEWAL_WORKER_ENABLED=1`, while the design says the config flag is canonical and the env var may only disable. More importantly, a shared config flag enables every app instance; without a distributed lease or leader election it does not prevent duplicate renewal attempts in a multi-instance deployment. |
| **D-26** | Label the existing portfolio return as weighted CAGR and defer true XIRR to H-2. | The code calculates an invested-amount-weighted average of position CAGRs, not XIRR, while current UI consumers still display “IRR.” Adding an API method field does not stop those consumers from misleading users. The rationale also overstates that true XIRR is impossible; dated cash flows may exist, while the terminal-value policy is the part requiring product approval. |

---

## How to close GATE-D10

1. Replace **UNRULED** with the ruling for each of the 11 rows above, in `spec/`, not here.
2. `OPN-013` moves to CLOSED with the ruling as its evidence.
3. Re-run `python3 scripts/build_package_docs.py` and commit the regenerated file.
4. Only then may an implementation claim to satisfy DEC-1.

**Provenance.** Extracted from `spec/V2_DECISION_AUDIT.md`. The generator asserts
all 32 decisions D-01..D-32 are present and contiguous, that they tally to
{'SHOULD-ESCALATE': 10, 'CORRECTLY-AUTONOMOUS': 19, 'WRONG': 2, 'UNDER-JUSTIFIED': 1}, that the tally matches the audit's own executive table, that the
SHOULD-ESCALATE set is exactly the ten ids named by OPN-013 and GATE-D10, and
that the UNDER-JUSTIFIED set is exactly `['D-18']` per ITM-154. A disagreement
between the stated counts and the rows is fatal, not a rounding note.
