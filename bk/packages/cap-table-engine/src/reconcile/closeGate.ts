/**
 * Round Close Gate — orchestrates the multi-step process to close a round.
 *
 * Steps:
 *   1. Compute post-close projected cap table via primary engine.
 *   2. Run reference engine against same input.
 *   3. If divergence: throw `RoundCloseBlockedError` with full diff.
 *   4. If match: emit `round.close.gated` event with both hashes (caller wires telemetry).
 *   5. Require founder sign-off (UI captures click + ts + IP + identity hash).
 *   6. Require admin sign-off (UI captures same).
 *   7. Only after both signatures: write the close transaction to the ledger.
 */
import type { ComputeOptions } from "../types.js";
import { reconcile, type ReferenceEngineFn, type ReconciliationResult, type HolderDiff } from "./reconcile.js";
import {
  appendTransaction, type LedgerHandle,
} from "../ledger/ledger.js";

export type Signoff = {
  actorId: string;
  ts: string;
  ipAddress?: string;
  identityHash: string;
};

export type CloseGateRequest = {
  computeOpts: ComputeOptions;
  ledger: LedgerHandle;
  roundId: string;
  founderSignoff?: Signoff;
  adminSignoff?: Signoff;
};

export type CloseGateOutcome = {
  ledger: LedgerHandle;          // possibly updated with close entry
  reconciliation: ReconciliationResult;
  closed: boolean;
  awaitingSignoffs: { founder: boolean; admin: boolean };
};

/** Thrown when reconciliation diverges. The full diff is attached. */
export class RoundCloseBlockedError extends Error {
  reconciliation: ReconciliationResult;
  diffs: HolderDiff[];
  constructor(reconciliation: ReconciliationResult) {
    super(
      `Round close blocked — reconciliation diverged (${reconciliation.diffs.length} diffs). ` +
      `Primary hash: ${reconciliation.primaryHash}; Reference hash: ${reconciliation.referenceHash}.`,
    );
    this.name = "RoundCloseBlockedError";
    this.reconciliation = reconciliation;
    this.diffs = reconciliation.diffs;
  }
}

export class MissingSignoffError extends Error {
  constructor(missing: { founder: boolean; admin: boolean }) {
    super(`Round close blocked — missing sign-offs: ${missing.founder ? "founder " : ""}${missing.admin ? "admin" : ""}`.trim());
    this.name = "MissingSignoffError";
  }
}

export function runCloseGate(req: CloseGateRequest, referenceCompute: ReferenceEngineFn): CloseGateOutcome {
  const reconciliation = reconcile(req.computeOpts, referenceCompute);

  if (reconciliation.status === "divergence") {
    throw new RoundCloseBlockedError(reconciliation);
  }

  const awaitingFounder = !req.founderSignoff;
  const awaitingAdmin = !req.adminSignoff;
  if (awaitingFounder || awaitingAdmin) {
    return {
      ledger: req.ledger,
      reconciliation,
      closed: false,
      awaitingSignoffs: { founder: awaitingFounder, admin: awaitingAdmin },
    };
  }

  // Both signed + reconciled: write the close entry to the ledger
  const newLedger = appendTransaction(req.ledger, {
    id: `close-${req.roundId}-${Date.now()}`,
    companyId: req.computeOpts.companyId,
    type: "round_close",
    instrumentRef: null,
    timestamp: new Date().toISOString(),
    actorId: req.adminSignoff!.actorId,
    actorRole: "admin",
    idempotencyKey: `round-close-${req.roundId}`,
    ipAddress: req.adminSignoff!.ipAddress,
    payload: {
      type: "round_close",
      data: {
        roundId: req.roundId,
        primaryHash: reconciliation.primaryHash,
        referenceHash: reconciliation.referenceHash,
        founderSignoff: req.founderSignoff!,
        adminSignoff: req.adminSignoff!,
      },
    },
  });

  return {
    ledger: newLedger,
    reconciliation,
    closed: true,
    awaitingSignoffs: { founder: false, admin: false },
  };
}
