/**
 * v25.19 — empirical determinism test for the carry-forward digest.
 *
 * Calls computeCarryForwardLive twice on the same inputs (separated by a
 * short delay) and asserts the returned auditDigest is byte-identical.
 *
 * Lane 2 NC1 reproduced this returning different digests on 7ms-apart calls
 * because the engine hashed `new Date()` into the body. This script must
 * print "DIGEST DETERMINISTIC" or the v25.18 NC3 false closure is back.
 */
import { computeCarryForwardLive } from "../server/roundCarryForwardEngine";

const input = {
  companyId: "co_demo_x",
  proposedRoundType: "priced_equity" as const,
};

const a = computeCarryForwardLive(input as any);
// Force a wall-clock gap.
const tStart = Date.now();
while (Date.now() - tStart < 25) { /* spin */ }
const b = computeCarryForwardLive(input as any);

console.log("digest A:", a.auditDigest);
console.log("digest B:", b.auditDigest);
console.log("computedAt A:", a.computedAt);
console.log("computedAt B:", b.computedAt);

if (a.auditDigest === b.auditDigest) {
  console.log("DIGEST DETERMINISTIC \u2014 v25.19 Lane 2 NC1 hard-closed.");
  process.exit(0);
} else {
  console.error("DIGEST NON-DETERMINISTIC \u2014 v25.18 NC3 false closure REGRESSED.");
  process.exit(1);
}
