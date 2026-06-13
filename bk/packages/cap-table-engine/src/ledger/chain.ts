/**
 * Hash-chain verification for the immutable transaction ledger.
 *
 * Walks every entry and confirms:
 *   1. Genesis entry's prevHash equals GENESIS_PREV_HASH ("0" × 64).
 *   2. Each subsequent prevHash equals the previous entry's hash.
 *   3. Each entry's recomputed hash matches the stored hash.
 *
 * If any check fails, returns `{ valid: false, brokenAt: index }` where `index`
 * is the 0-based position of the first broken entry.
 */
import { type LedgerEntry, GENESIS_PREV_HASH, hashEntry } from "./transaction.js";

export type ChainVerification = {
  valid: boolean;
  brokenAt?: number;
  reason?: string;
  length: number;
};

export function verifyChain(entries: LedgerEntry[]): ChainVerification {
  if (entries.length === 0) return { valid: true, length: 0 };

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : entries[i - 1].hash;
    if (e.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: "prevHash mismatch", length: entries.length };
    }
    const { hash, ...rest } = e;
    const recomputed = hashEntry(rest);
    if (recomputed !== hash) {
      return { valid: false, brokenAt: i, reason: "hash recomputation mismatch", length: entries.length };
    }
  }
  return { valid: true, length: entries.length };
}
