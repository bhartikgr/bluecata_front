/**
 * Append-only ledger store + cap-table reconstruction.
 *
 * The ledger is event-sourced: the cap table is a derivation, never the source of truth.
 * `reconstructCapTable` walks every entry from genesis and replays through the engine.
 * Pure / side-effect-free — given the same ledger and `asOf`, it always produces the
 * same `CapTableResult`.
 */
import {
  type LedgerEntry,
  type LedgerPayload,
  GENESIS_PREV_HASH,
  hashEntry,
} from "./transaction.js";
import { computeCapTable } from "../captable/compute.js";
import type {
  Holder, Transaction, View, Region, CapTableResult, Security,
} from "../types.js";

export type LedgerHandle = {
  entries: LedgerEntry[];
  head: string;            // current head hash
  length: number;
};

/** Append a new entry and return an updated handle. The original ledger is never mutated. */
export function appendTransaction(
  ledger: LedgerHandle,
  entry: Omit<LedgerEntry, "prevHash" | "hash">,
): LedgerHandle {
  const prevHash = ledger.head;
  const candidate = { ...entry, prevHash } as Omit<LedgerEntry, "hash">;
  const hash = hashEntry(candidate);
  const finalEntry: LedgerEntry = { ...candidate, hash };
  return {
    entries: [...ledger.entries, finalEntry],
    head: hash,
    length: ledger.length + 1,
  };
}

export function emptyLedger(): LedgerHandle {
  return { entries: [], head: GENESIS_PREV_HASH, length: 0 };
}

/**
 * Translate a ledger payload to one or more engine transactions for replay.
 * This is the only place that knows how a "ledger payload" becomes the engine's
 * shape — keeps the engine ignorant of the audit ledger.
 */
function payloadToEngineTxs(
  payload: LedgerPayload,
  date: string,
): { tx: Transaction; holderHints?: Holder[] } | null {
  switch (payload.type) {
    case "issue":
      return { tx: { type: "issue", security: payload.data.security, date } };
    case "issue_round":
      return { tx: { type: "issue_preferred_round", round: payload.data.round, date } };
    case "exercise": {
      const d = payload.data;
      if (d.kind === "option") {
        return {
          tx: {
            type: "exercise_option",
            securityId: d.securityId,
            sharesExercised: BigInt(d.sharesExercised ?? "0"),
            date,
          },
        };
      }
      return {
        tx: {
          type: "exercise_warrant",
          securityId: d.securityId,
          date,
          cashless: d.cashless,
          fmvPerShare: d.fmvPerShare,
        },
      };
    }
    case "convert": {
      const d = payload.data;
      return {
        tx:
          d.kind === "safe"
            ? { type: "convert_safe", securityId: d.securityId, round: d.round, date }
            : { type: "convert_note", securityId: d.securityId, round: d.round, date },
      };
    }
    case "esop_topup":
      return {
        tx: {
          type: "esop_topup",
          targetPercent: payload.data.targetPercent,
          mode: payload.data.mode,
          date,
        },
      };
    case "transfer":
    case "cancel":
    case "repurchase":
    case "forfeit":
    case "amend":
    case "round_close":
      // These are recorded for audit but don't materialise as engine transactions for
      // the basic view (transfer affects holder mapping which is preserved separately
      // by the caller; cancel/repurchase/forfeit are handled by the caller upstream).
      return null;
  }
}

export type ReconstructInput = {
  companyId: string;
  ledger: LedgerHandle;
  holders: Holder[];
  view?: View;
  region?: Region;
  asOf?: string;
};

export function reconstructCapTable(input: ReconstructInput): CapTableResult {
  const asOf = input.asOf ?? new Date(0).toISOString();
  const view = input.view ?? "fully_diluted";
  const region: Region = input.region ?? "US";

  // Filter to entries for this company at-or-before asOf
  const companyEntries = input.ledger.entries.filter(
    (e) => e.companyId === input.companyId && e.timestamp <= asOf,
  );

  // Replay payloads → engine transactions
  const engineTxs: Transaction[] = [];
  // Apply transfers/cancels by post-processing the resolved ledger
  const transfers: Array<{ securityId: string; toHolderId: string }> = [];
  const cancels = new Set<string>();

  for (const e of companyEntries) {
    const out = payloadToEngineTxs(e.payload, e.timestamp);
    if (out) engineTxs.push(out.tx);
    if (e.payload.type === "transfer") {
      transfers.push({
        securityId: e.payload.data.securityId,
        toHolderId: e.payload.data.toHolderId,
      });
    } else if (e.payload.type === "cancel" || e.payload.type === "forfeit") {
      cancels.add((e.payload.data as { securityId: string }).securityId);
    }
  }

  // Apply cancels by removing matching issue events
  let workingTxs = engineTxs.filter((t) => {
    if (t.type === "issue") return !cancels.has(t.security.id);
    return true;
  });
  // Apply transfers by rewriting holderId on matching issue events (replay-time)
  for (const tr of transfers) {
    workingTxs = workingTxs.map((t) => {
      if (t.type !== "issue") return t;
      if (t.security.id !== tr.securityId) return t;
      const next: Security = { ...t.security, holderId: tr.toHolderId };
      return { ...t, security: next };
    });
  }

  return computeCapTable({
    companyId: input.companyId,
    asOf,
    view,
    formulaRegion: region,
    holders: input.holders,
    transactions: workingTxs,
  });
}

/** Convert a ledger to a `CapTable` (alias matching spec's `reconstructCapTable(companyId, asOf?)`). */
export type CapTable = CapTableResult;
