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
