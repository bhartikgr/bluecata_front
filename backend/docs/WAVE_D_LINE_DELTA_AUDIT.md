# AUDIT — the "87 unrecovered lines" of `13_WAVE_D_spv.md` (OPN-016)

**Item DOC-4.** *Audit the 87 unrecovered lines of `13_WAVE_D_spv.md` against the
surviving turns (OPN-016).*

Hand-written, not generated. Every number below was re-derived at audit time
against `/home/user/workspace/work` and `/home/user/workspace/spec`; the hard
numbers are re-checked on every run by `scripts/__tests__/package_docs_falsify.sh`
so this document cannot drift silently from the tree it describes.

---

## 1. Finding: the 87-line figure is not auditable, and is now misleading

`OPN-016` reads: *"87 lines of `13_WAVE_D_spv.md` were never recovered — rebuilt
at 1,256 lines against an original of 1,343; the delta is unaudited."*

Measured now:

| Quantity | Value | Source |
|---|---|---|
| Original, before destruction | **1,343 lines** | `INCIDENT_WAVE_D_FILE_LOSS.md`; `13_WAVE_D_spv.md` §15.2 |
| Immediately after rebuild | **1,256 lines** | `OPN-016` |
| Shortfall that created OPN-016 | **87 lines** | 1,343 − 1,256 |
| **The file today** | **1,480 lines** | `wc -l spec/13_WAVE_D_spv.md` |

The file is now **137 lines longer than the original** and **224 lines longer
than the rebuild**. The 87-line deficit closed and then reversed, because v3 and
v3.1 amendments (the OR-2/OR-3 forwarding note, §1.2.1's clean-sheet fee design,
§15 itself) were added after the rebuild.

**So the deficit cannot be audited by line count, and never could have been.**
Line count is a proxy for content, and this file's own §15.2 says the
reconstruction *"reproduces the content recorded in the surviving evidence …
it is not a byte-level restoration and does not claim to be."* Two documents of
identical length can differ completely. **Recommendation: retire the 87-line
figure.** It now reads as a debt that has been repaid, which is not what
happened — the missing prose is still missing, and separately the file grew.

## 2. What the surviving evidence actually supports

`INCIDENT_WAVE_D_FILE_LOSS.md` records every recovery avenue as negative:
no backup (the two `.bak` files are the master v2 and Wave E), not a git repo,
no spec files in the project repo, no editor temp, nothing filesystem-wide over
1 KB, and `current_session_context/turns/*.md` are per-turn **summaries** that
never held the full text. That is exhaustive, and it is why §15.2's list of
unrecoverable material is the correct answer to OPN-016 rather than a line diff:

- the exact wording and paragraph structure of the original;
- any prose not reflected in `grep_wave_d.txt`, the live reconciliation summary,
  the Opus reviews, the V2 verification, the master spec, or the edit patch;
- the original's internal sub-section numbering.

**Nothing in the workspace can narrow that further.** The audit's job is
therefore to test whether the *evidentiary* content survived, which is testable.

## 3. THE REAL DEFECT FOUND BY THIS AUDIT

`INCIDENT_WAVE_D_FILE_LOSS.md` states, under "What survives":

> *"All eight v3 edits I had applied to Wave D before the loss are preserved
> **verbatim** in `/home/user/workspace/spec/WAVE_D_v3_EDITS_TO_REAPPLY.md`,
> each with its exact anchor (`old_string`) and replacement (`new_string`)."*

**`spec/WAVE_D_v3_EDITS_TO_REAPPLY.md` DOES NOT EXIST.** `ls` returns *"No such
file or directory"*, and no file of any similar name exists in `spec/`.

This is the **same class of defect as OPN-015** — a run that reported writing a
path and did not — and it is worse here, because the file was named as the
mitigation for a data-loss incident. Had the reconstruction not already been
completed, the documented recovery path would have been a dead end.

A second discrepancy in the same claim: the incident says **eight** v3 edits;
`13_WAVE_D_spv.md` §15 twice says **ten** ("the ten-edit patch", "the ten v3
edits verbatim"). One of the two counts is wrong and neither is now checkable,
because the patch file is gone.

**Mitigating fact, verified:** the v3 edits are present in the rebuilt file, so
the loss of the patch file cost nothing retrospectively. All five named v3 change
markers resolve in `spec/13_WAVE_D_spv.md`:

| v3 edit | Present at | Substance |
|---|---|---|
| **V3-1** | `:9` | ledger guard has ONE API; `readLedgerOrThrow(companyId)` withdrawn |
| **V3-3** | `:15` | "zero sacred files" withdrawn, replaced by waiver **W-1** |
| **V3-4a** | `:19` | Wave D owns migrations `0145`/`0146`, not 0138 |
| **D-18** | `:21` | jurisdiction fail-safe, new `AC-F9d`/`T-F9d` |
| **OR-2 / OR-3** | `:32` / `:52` | Q-D0 resolved as a clean sheet; D-19's deferral withdrawn |

## 4. Re-execution of §15's citation record

§15 claims *"29 citations were re-executed directly against
`/home/user/workspace/work`"*, all ✅. A sample was re-executed for this audit.
The tree has since advanced from v26.7.3 to v26.10.0 across twelve waves, so the
result splits cleanly, and the split is itself the finding.

### 4a. Citations against SACRED (frozen) files — still byte-exact

| # | Citation | Now |
|---|---|---|
| 8 | `captableCommitStore.ts` sha256 `e5045ecb…`, **1,379 lines** | ✅ **exact**, both |
| 6 | `captableCommitStore.ts:762` — `ccm_${sha256(invitationId).slice(0,16)}` | ✅ exact line |
| 7 | `captableCommitStore.ts:675` — `commitFunded(` | ✅ exact line |
| 5 | `captableCommitStore.ts:426-442` — `getLedger()` returns `[]` in its `catch` | ✅ exact, `catch` + `return []` inside the range |
| 11 | `connection.ts:204` — `getDbDriver()` | ✅ exact line |
| 22 | `COLLECTIVE_SECTORS_45` at `shared/schema.ts:1128` | ✅ exact line |

**This is the strongest available evidence that the reconstruction is faithful.**
Where the cited target is frozen, the reconstruction's citations are still
correct to the line — including a full-file sha256 and line count that a
reconstructed-from-memory document had no way to fake.

### 4b. Citations against live files — claim holds, line number drifted

| # | Citation | Spec says | Now | Claim |
|---|---|---|---|---|
| 1 | `import { commitFunded, getLedger }` in `spvEngineRoutes.ts` | `:31` | `:33` | ✅ holds |
| 23 | `registerSpvEngineRoutes` imported / called in `routes.ts` | `:157` / `:960` | `:169` / `:992` | ✅ holds |
| 24 | `WRITE_ROLES` in `spvEngineRoutes.ts` | `:46` | `:58` | ✅ holds, same three roles |
| 14 | `deriveEngineJurisdiction` in `PartnerSpvEngine.tsx` | `:136-149` | `:185` | ✅ function holds |
| 26 | zero `spv_template` hits anywhere | 0 | **0** | ✅ still exact |

Consistent with the standing warning that citations in the build documents carry
drifted line numbers while the claim holds. **Cite what you verified.**

### 4c. Citations now materially FALSE — because the code changed, not the spec

| # | Citation | Then | Now | Reading |
|---|---|---|---|---|
| 17 | `grep -rn "deployments/" client/src` | **0** | **6** | The D.2 deployment client was built. The orphan the citation documented is closed. |
| 25 | migration tip in both directories | **0137** | **0168** | 31 migrations since. Wave D's `0145`/`0146` allocation is long superseded. |
| 15 | 11 tabs in `SpvDetailTabs.tsx:203-213` | **11** | **13 `TabsTrigger`** | Two tabs added by later waves. |
| 27 | `PartnerSpvs` imported with **no `<Route>`** | orphaned | **routed** — `App.tsx:86` import, routes at `:1351`, `:1370`, `:1379` | The orphan is wired. |
| 14 | `default: return "delaware"` in `deriveEngineJurisdiction` | present | **removed**, and `PartnerSpvEngine.tsx:177` documents it as *"GONE"* | See §5. |

None of these is a reconstruction error. All five are the spec correctly
describing a tree that has since moved. **They are, however, live traps for a
reader treating `13_WAVE_D_spv.md` as current.**

### 4d. One citation whose own caveat is vindicated

Citation 21 claims *"21 distinct `spv.*` events"*. Re-derived against
`server/spvEngineStore.ts`, a broad pattern returns **24** distinct `spv.*`
identifiers; a narrow double-quoted-literal pattern returns **3**. The count is
entirely pattern-dependent.

The spec anticipated this. §15.1 **DR-4** records that *"the headline counts '41
routes' and '52 store methods' are not exactly reproducible"* and replaces them
with full enumerations, and the D-A11 row instructs: ***"register against the
verified list, not the number 21."*** That instruction is correct and this audit
confirms it empirically. Any wave that registers exactly 21 events because a
document said 21 will silently drop the remainder — the precise failure mode the
owner's rule forbids.

## 5. Cross-document conflict raised by this audit

`13_WAVE_D_spv.md:777` and `:886` both state that `delaware` *"remains a default
for **new SPV creation only** (master D-18) — never for display."* In the live
tree, `client/src/pages/partner/PartnerSpvEngine.tsx:177` states the Delaware
defaults *"are GONE"*, with `deriveEngineJurisdiction` at `:185` no longer
carrying `default: return "delaware"`.

The project knowledge wiki concept `jurisdiction-ontology` is also recorded as
"Delaware default". **All three cannot be right.** This is not resolved here —
DOC-4 is an audit, and D-18 is one of the eleven decisions still `UNRULED` in
`docs/OWNER_DECISION_REGISTER.md`. It is raised so it is not lost, and it belongs
to whoever closes GATE-D10.

## 6. Verdict on OPN-016

| Question | Answer |
|---|---|
| Can the 87 lines be recovered? | **No.** Every avenue in the incident report is exhausted and negative; the turn files are summaries and never held the text. |
| Can the 87-line delta be audited as lines? | **No, and it should not be attempted.** The file is now 1,480 lines; the metric is meaningless and reads as a repaid debt. |
| Did the reconstruction preserve the evidentiary content? | **Yes, to the extent testable.** Every sampled citation against a frozen file is still byte-exact, including a full-file sha256 and line count. Live-file claims hold with drifted line numbers. |
| Is anything still missing? | **Yes — exactly what §15.2 names**, and nothing further can be said about it from inside this workspace. |
| Did the audit find a NEW defect? | **Yes.** `spec/WAVE_D_v3_EDITS_TO_REAPPLY.md`, named in the incident report as the surviving mitigation, does not exist — and the incident's "eight edits" contradicts §15's "ten". See §3. |

**Recommended disposition of OPN-016: CLOSE as audited, with the 87-line figure
retired and replaced by §15.2's content-level statement.** Recommended new open
item: the missing `WAVE_D_v3_EDITS_TO_REAPPLY.md` and the eight-versus-ten
discrepancy, which is a live instance of the OPN-015 class and not covered by any
existing row.

---

**Sources.** `spec/13_WAVE_D_spv.md` (§15, §15.1, §15.2, and the v3 forwarding
note at `:1-70`); `spec/INCIDENT_WAVE_D_FILE_LOSS.md`;
`spec/SESSION_TRACEABILITY_REGISTER.md` `OPN-015`/`OPN-016` (`:542-543`); and
direct re-execution against `/home/user/workspace/work` at v26.10.0.
