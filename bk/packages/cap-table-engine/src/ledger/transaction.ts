/**
 * Immutable Transaction Ledger — append-only event store for every cap-table-affecting
 * action. Each entry is hash-chained to its predecessor so any tampering is detectable.
 *
 * The ledger is the SOURCE OF TRUTH. The materialised cap table is a *derivation* —
 * `reconstructCapTable` walks the ledger from genesis and replays every entry through
 * the primary engine to produce the same cap table the live engine would compute.
 *
 * References:
 *   - Carta "Immutable cap-table ledger" pattern (audit trail postmortems)
 *   - NVCA Model Stock Purchase Agreement §3 "Issuances"
 *   - SOC 2 control CC7.2 (immutable evidence trails)
 */
import { sha256 } from "../primitives/hash.js";
import type { Security, PricedRound } from "../types.js";

export type LedgerTxType =
  | "issue"
  | "transfer"
  | "cancel"
  | "exercise"
  | "convert"
  | "repurchase"
  | "forfeit"
  | "amend"
  | "issue_round"
  | "esop_topup"
  | "round_close";

export type ActorRole = "founder" | "admin" | "investor" | "system" | "lawyer" | "platform";

export type TxLocation = {
  city?: string;
  region?: string;
  country?: string;
};

/** Payloads — typed per type. */
export type IssuePayload = { security: Security };
export type TransferPayload = { securityId: string; toHolderId: string; shares?: string };
export type CancelPayload = { securityId: string; reason: string };
export type ExercisePayload = {
  securityId: string;
  sharesExercised?: string;
  cashless?: boolean;
  fmvPerShare?: string;
  kind: "option" | "warrant";
};
export type ConvertPayload = {
  securityId: string;
  round: PricedRound;
  kind: "safe" | "note";
};
export type RepurchasePayload = { securityId: string; shares: string; pricePerShare: string };
export type ForfeitPayload = { securityId: string; shares: string; reason: string };
export type AmendPayload = {
  securityId: string;
  field: string;
  oldValue: string;
  newValue: string;
  rationale: string;
};
export type IssueRoundPayload = { round: PricedRound };
export type EsopTopUpPayload = { targetPercent: string; mode: "pre_money" | "post_money" };
export type RoundClosePayload = {
  roundId: string;
  primaryHash: string;
  referenceHash: string;
  founderSignoff: { actorId: string; ts: string; ipAddress?: string; identityHash: string };
  adminSignoff: { actorId: string; ts: string; ipAddress?: string; identityHash: string };
};

export type LedgerPayload =
  | { type: "issue"; data: IssuePayload }
  | { type: "transfer"; data: TransferPayload }
  | { type: "cancel"; data: CancelPayload }
  | { type: "exercise"; data: ExercisePayload }
  | { type: "convert"; data: ConvertPayload }
  | { type: "repurchase"; data: RepurchasePayload }
  | { type: "forfeit"; data: ForfeitPayload }
  | { type: "amend"; data: AmendPayload }
  | { type: "issue_round"; data: IssueRoundPayload }
  | { type: "esop_topup"; data: EsopTopUpPayload }
  | { type: "round_close"; data: RoundClosePayload };

export type LedgerEntry = {
  id: string;
  companyId: string;
  type: LedgerTxType;
  /** instrumentRef — for entries that target a specific instrument; otherwise null */
  instrumentRef: string | null;
  payload: LedgerPayload;
  timestamp: string;            // ISO 8601
  actorId: string;
  actorRole: ActorRole;
  ipAddress?: string;
  location?: TxLocation;
  idempotencyKey: string;
  prevHash: string;             // hex; "0".repeat(64) for genesis
  hash: string;                 // sha256 of canonical(entry without hash) including prevHash
};

/** Stable canonical JSON for hash input — keys sorted, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return JSON.stringify(value.toString() + "n");
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) =>
    JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k])
  ).join(",") + "}";
}

/** Compute the hash of a candidate entry. The entry's `hash` field MUST be empty/undefined. */
export function hashEntry(entry: Omit<LedgerEntry, "hash">): string {
  return sha256(canonicalJson(entry));
}

export const GENESIS_PREV_HASH = "0".repeat(64);
