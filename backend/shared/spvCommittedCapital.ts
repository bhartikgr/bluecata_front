/**
 * WAVE 120 · FINDING 2 — THE COMMITTED-CAPITAL PREDICATE, WHERE A BROWSER CAN
 *                        REACH IT.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WENT WRONG. Wave 112's whole purpose was ONE committed figure per SPV,
 * through one shared predicate. It converged the SERVER's predicate
 * (`committedSubscriptionsForSpv` / `canonicalCommittedMinorForSpv`,
 * `server/spvEngineStore.ts:3717-3735`, `bigint`) and then a RENDERED partner
 * tile computed a rival figure of its own:
 *
 *     client/src/components/partner/SpvDetailTabs.tsx:403
 *     const raised = register.reduce((a, r) => a + r.commitmentMinor, 0);
 *
 * `register` is `investorRegister` (`server/spvEngineStore.ts:1670`), whose
 * filter is `status !== "withdrawn"` and whose own doc comment says it is "NOT
 * for money gates". Of the six declared statuses
 * (`shared/spvEngine.ts:496-498`) that leaves FOUR non-committed states —
 * `review`, `soft_circled`, `founder_confirmed`, `wire_funded` — displayed as
 * money raised, next to the target, under the label "Raise progress".
 *
 * That is the platform's recurring error in its most expensive form: an
 * INDICATION OF INTEREST presented as MONEY. A soft circle is not a commitment;
 * a commitment is not cash.
 *
 * WHY THE PREDICATE LIVES HERE. The authority is a `server/` module, and a
 * browser cannot import `server/`. Restating the status test inside the
 * component would have been a fourteenth copy. So the predicate is stated ONCE,
 * in `shared/` — next to `SPV_SUBSCRIPTION_STATUSES`, which already lives in
 * `shared/spvEngine.ts` — and `server/__tests__/w120_spv_committed_tile.test.ts`
 * imports BOTH this constant and the server's own
 * `COMMITTED_SUBSCRIPTION_STATUS` and asserts they are the same string. The two
 * spellings therefore cannot drift without a red test, which is the guarantee
 * "one predicate" was supposed to buy.
 *
 * MONEY TYPES. The sum is `bigint`. `BigInt(x)` on an integer minor-unit count
 * is a WIDENING, not a parse. There is no `Number()`, `parseInt` or
 * `parseFloat` anywhere in this file, and no money value is ever divided here.
 */
import { SPV_SUBSCRIPTION_STATUSES, type SpvSubscriptionStatus } from "./spvEngine";

/** The ONE terminal state in which an SPV subscription is real capital.
 *  Deliberately the same string as `server/spvEngineStore.ts`'s
 *  `COMMITTED_SUBSCRIPTION_STATUS`; a test pins that they are equal. */
export const SPV_COMMITTED_SUBSCRIPTION_STATUS: SpvSubscriptionStatus = "committed";

/** The states that are NOT committed capital, in the order the ladder declares
 *  them. Exported so a surface can NAME what it is leaving out instead of
 *  silently dropping it — Wave 113's lesson about omitted holders applies just
 *  as much to omitted subscriptions. `withdrawn` is excluded: a withdrawn
 *  subscription is not pending anything. */
export const SPV_UNCOMMITTED_PENDING_STATUSES: readonly SpvSubscriptionStatus[] =
  SPV_SUBSCRIPTION_STATUSES.filter(
    (s) => s !== SPV_COMMITTED_SUBSCRIPTION_STATUS && s !== "withdrawn",
  );

/** What the committed figure MEANS, in words, for any surface that prints it. */
export const SPV_COMMITTED_FIGURE_LABEL =
  "committed capital only — review, soft-circled, founder-confirmed and wire-funded subscriptions are excluded";

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 127 · FINDING 3 — THE HONEST LABEL FOR A ROW THAT IS NOT A COMMITMENT.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 120 stopped the OVERVIEW tile summing the all-stages register. It did not
 * touch the two surfaces that legitimately RENDER that register row by row — the
 * SPV detail LPs tab and the Fund Commitment Register — and both printed an
 * amount and a percentage with no status whatsoever. On the live `Test SPV` a
 * subscription under `review` therefore read `$2,500.00 (100.0%)`, which a
 * partner can only read as a commitment, while the Close tab, the K-1 tab and
 * the Overview correctly reported nothing committed.
 *
 * The repair is a LABEL, not a filter: hiding the row would be a silent drop of
 * a real record, and the all-stages view is needed. The two helpers below are
 * stated ONCE here — next to the committed predicate they qualify — so the LPs
 * tab and the Fund Register cannot describe the same row differently.
 *
 * RULING R91 IS RESPECTED. Nothing is renamed, no vocabulary is harmonised, and
 * `soft_circle` / `soft_circled` remain SEPARATE strings: this maps a stored key
 * to human words for display and does not rewrite, merge or alias any key. R91's
 * other half is the reason the mapper exists at all — a raw KEY rendered to a
 * customer IS a defect — so an UNMAPPED status is humanised (underscores to
 * spaces) rather than printed as a code, and a status added upstream can never
 * reach a partner as `founder_confirmed`.
 */

/** What the LPs-tab / Fund-Register ownership percentage is divided BY, in words.
 *  It is NOT the target raise and it is NOT committed capital: the denominator is
 *  the sum of every non-withdrawn subscription on the vehicle, at any stage
 *  (`investorRegister`, `server/spvEngineStore.ts`). A percentage without its
 *  denominator is not a fact — this is the denominator, named. */
export const SPV_REGISTER_OWNERSHIP_DENOMINATOR_LABEL =
  "share of all non-withdrawn subscriptions on this vehicle at any stage — not of the target raise, and not of committed capital";

/** One sentence a register surface can print above its rows so the amounts below
 *  are read for what they are. */
export const SPV_REGISTER_ALL_STAGES_BASIS =
  "This register lists every non-withdrawn subscription at ANY stage, so amounts here include pre-commitment stages and are NOT the amount raised. Each row shows its own stage.";

/** What the all-stages investor COUNT counts, for a surface that prints it next
 *  to a committed-only money figure. Without this the two read as a
 *  contradiction when they are simply two different questions. */
export const SPV_INVESTOR_COUNT_BASIS =
  "counts every non-withdrawn subscription at any stage, including pre-commitment stages — so it can be non-zero while committed capital is nil";

/** A stored subscription status as words a partner can read. Never returns a raw
 *  key: an unmapped value is humanised instead (R91 — a raw key on a customer
 *  surface is a defect). An absent status is reported as unrecorded rather than
 *  silently presented as committed. */
export function spvSubscriptionStageLabel(status: string | null | undefined): string {
  const key = String(status ?? "").trim();
  if (key === "") return "stage not recorded";
  switch (key) {
    case "committed": return "committed";
    case "review": return "under review — not a commitment";
    case "soft_circled": return "soft-circled — not a commitment";
    case "founder_confirmed": return "founder-confirmed — not a commitment";
    case "wire_funded": return "wire received, not yet committed";
    case "withdrawn": return "withdrawn";
    default: return key.replace(/_/g, " ");
  }
}

/** True when a register row's amount must NOT be read as raised capital. */
export function spvRegisterRowIsPreCommitment(status: string | null | undefined): boolean {
  return String(status ?? "").trim() !== SPV_COMMITTED_SUBSCRIPTION_STATUS;
}

/** The minimum shape this module needs of a subscription row. Both the engine
 *  DTO (`shared/spvEngine.ts`) and the client's local `Sub` type satisfy it. */
export interface CommittedCapitalRow {
  status?: string | null;
  commitmentMinor?: number | null;
}

/** The ONE status test. */
export function isCommittedSubscriptionRow(row: CommittedCapitalRow | null | undefined): boolean {
  return !!row && row.status === SPV_COMMITTED_SUBSCRIPTION_STATUS;
}

/** The committed figure for a set of subscription rows, in minor units, in
 *  `bigint`. A row with no recorded `commitmentMinor` contributes nothing and is
 *  reported by `summariseCommittedCapital` rather than counted as zero money. */
export function committedMinorFromSubscriptions(
  rows: readonly CommittedCapitalRow[] | null | undefined,
): bigint {
  let total = BigInt(0);
  for (const row of rows ?? []) {
    if (!isCommittedSubscriptionRow(row)) continue;
    if (typeof row.commitmentMinor !== "number" || !Number.isInteger(row.commitmentMinor)) continue;
    total += BigInt(row.commitmentMinor);
  }
  return total;
}

export interface CommittedCapitalSummary {
  /** The committed figure, minor units, `bigint`. */
  committedMinor: bigint;
  /** How many rows reached `committed`. */
  committedRows: number;
  /** How many live rows are in a pre-commitment state (per status). */
  pendingByStatus: Array<{ status: string; rows: number }>;
  /** Rows that claim `committed` but carry no usable integer amount. Reported,
   *  never guessed at, so the figure below can be read as "of what is on
   *  record" rather than "of everything". */
  unusableRows: number;
}

/** The full picture a surface needs: the figure, plus what is NOT in it.
 *  A tile that shows only the figure cannot explain why it is smaller than the
 *  register beneath it; the platform's own drop rules require the difference to
 *  be stated rather than silently absorbed. */
export function summariseCommittedCapital(
  rows: readonly CommittedCapitalRow[] | null | undefined,
): CommittedCapitalSummary {
  const all = rows ?? [];
  const pending = new Map<string, number>();
  let committedRows = 0;
  let unusableRows = 0;
  for (const row of all) {
    const status = String(row?.status ?? "");
    if (status === SPV_COMMITTED_SUBSCRIPTION_STATUS) {
      committedRows += 1;
      if (typeof row?.commitmentMinor !== "number" || !Number.isInteger(row.commitmentMinor)) {
        unusableRows += 1;
      }
      continue;
    }
    if (status === "withdrawn" || status === "") continue;
    pending.set(status, (pending.get(status) ?? 0) + 1);
  }
  return {
    committedMinor: committedMinorFromSubscriptions(all),
    committedRows,
    pendingByStatus: SPV_UNCOMMITTED_PENDING_STATUSES
      .filter((s) => pending.has(s))
      .map((s) => ({ status: s, rows: pending.get(s) ?? 0 })),
    unusableRows,
  };
}

/** Human sentence for the pending rows a committed figure deliberately omits.
 *  `null` when there is nothing to disclose. The stage words are the human
 *  labels this platform already shows partners; ruling R91 forbids harmonising
 *  the two soft-circle vocabularies, so nothing is renamed here. */
export function pendingSubscriptionsStatement(summary: CommittedCapitalSummary): string | null {
  if (summary.pendingByStatus.length === 0 && summary.unusableRows === 0) return null;
  const parts = summary.pendingByStatus.map(
    (p) => `${p.rows} ${p.status.replace(/_/g, " ")}`,
  );
  const pieces: string[] = [];
  if (parts.length > 0) {
    pieces.push(
      `Not counted as raised: ${parts.join(", ")}. These are pre-commitment stages, not money.`,
    );
  }
  if (summary.unusableRows > 0) {
    pieces.push(
      `${summary.unusableRows} committed subscription${summary.unusableRows === 1 ? "" : "s"} ` +
      "carry no recorded amount and are excluded from the figure rather than counted as zero.",
    );
  }
  return pieces.join(" ");
}
