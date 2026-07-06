/**
 * v25.51 Phase 4 (#15) — cap-table holder first/last is PURELY ADDITIVE.
 *
 * SACRED PROTOCOL: captableCommitStore.ts is the money/share hash-chained
 * ledger. The name-split wave adds OPTIONAL holder first/last METADATA that
 * must NOT be part of the commit hash-chain (buildCommitBody) nor any
 * amount/share math. This test PROVES the ledger hash is byte-for-byte
 * identical whether or not holder first/last are supplied — i.e. the discrete
 * name fields cannot perturb the immutable chain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  commitFunded,
  verifyChain,
  clearLedger,
  getLedger,
} from "../captableCommitStore";

beforeEach(() => clearLedger());
afterEach(() => vi.useRealTimers());

const BASE = {
  invitationId: "inv_hash_probe",
  roundId: "rnd_hash_probe",
  companyId: "co_hash_probe",
  investorId: "u_hash_probe",
  amount: "250000",
  currency: "USD",
  shares: "12500",
  fromState: "funded" as const,
};

describe("v25.51 Phase 4 — cap-table holder name is hash-neutral", () => {
  it("hash + prevHash are byte-identical with vs without holder first/last", () => {
    // The commit timestamp (ts) is generated internally via new Date() and IS
    // part of the hash body. To isolate the holder-name variable we FREEZE the
    // clock so both commits hash the identical ts — the only remaining
    // difference between the two runs is the presence of holder first/last.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));

    // Commit WITHOUT holder name.
    const a = commitFunded({ ...BASE });
    expect(a.ok).toBe(true);
    const hashWithout = a.ok ? a.entry.hash : "";
    const prevWithout = a.ok ? a.entry.prevHash : "";

    // Reset and commit the SAME core fields WITH holder first/last supplied,
    // at the SAME frozen instant (seq resets to 0, prevHash resets to GENESIS).
    clearLedger();
    const b = commitFunded({ ...BASE, holderFirstName: "Maya", holderLastName: "Chen" });
    expect(b.ok).toBe(true);
    const hashWith = b.ok ? b.entry.hash : "x";
    const prevWith = b.ok ? b.entry.prevHash : "x";

    // The hash-chain inputs are unchanged → identical digests.
    expect(hashWith).toBe(hashWithout);
    expect(prevWith).toBe(prevWithout);
    // And the WITH-names entry actually carried the metadata (proves the
    // identical hash is NOT because the names were silently dropped).
    expect(b.ok && b.entry.holderFirstName).toBe("Maya");
    expect(b.ok && b.entry.holderLastName).toBe("Chen");
  });

  it("persists holder first/last as additive metadata without touching amount/shares", () => {
    const r = commitFunded({ ...BASE, holderFirstName: "Sam", holderLastName: "Okoro" });
    expect(r.ok).toBe(true);
    const led = getLedger();
    expect(led.length).toBe(1);
    // Metadata round-trips.
    expect(led[0].holderFirstName).toBe("Sam");
    expect(led[0].holderLastName).toBe("Okoro");
    // Money/share fields are untouched by the name metadata.
    expect(led[0].amount).toBe("250000");
    expect(led[0].shares).toBe("12500");
    expect(led[0].currency).toBe("USD");
    expect(verifyChain().ok).toBe(true);
  });

  it("verifyChain (recomputed from core fields only) still validates when names present", () => {
    commitFunded({ ...BASE, invitationId: "i1", holderFirstName: "A", holderLastName: "One" });
    commitFunded({ ...BASE, invitationId: "i2", investorId: "u_b", holderFirstName: "B", holderLastName: "Two" });
    const led = getLedger();
    expect(led.length).toBe(2);
    expect(led[1].prevHash).toBe(led[0].hash);
    expect(verifyChain().ok).toBe(true);
  });
});
