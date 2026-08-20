/**
 * WAVE 52b — INVARIANT I-10's HARNESS.
 *
 * §11.4.5 I-10: "Persistence round trip: Save → NEW PROCESS, FRESH DB READ →
 * recompute → identical to pre-save, for every denominator switch of §5.8. … an
 * in-memory object asserted against its own literals PROVES NOTHING."
 *
 * So this is a script, not a test body: it is executed as a SEPARATE OS PROCESS,
 * twice, against a SQLite FILE. `NODE_ENV=test` would give the store `:memory:`
 * and a round trip through memory is not a round trip.
 *
 *   MODE=write  — seed every §5.8 switch, one conversion status per instrument,
 *                 one residual disposition, and print the pre-save digest.
 *   MODE=read   — open the SAME file in a FRESH process, read everything back,
 *                 recompute the digest, and print it.
 *
 * The caller compares the two digests byte for byte. Anything dropped from the
 * persisted set changes the digest, which is exactly the falsifying mutation
 * I-10 names ("drop one switch from the persisted column set → RED").
 *
 * Usage (from the repo root, DATABASE_URL pointing at a file):
 *   DATABASE_URL=file:/tmp/x.db npx tsx scripts/w52b_i10_roundtrip.ts write
 *   DATABASE_URL=file:/tmp/x.db npx tsx scripts/w52b_i10_roundtrip.ts read
 *   DATABASE_URL=file:/tmp/x.db npx tsx scripts/w52b_i10_roundtrip.ts read --drop=note_conversion_method
 */
import crypto from "node:crypto";
import {
  DENOMINATOR_SWITCHES,
  DENOMINATOR_SWITCH_KEYS,
  recordDenominatorSwitch,
  resolveDenominatorSwitches,
  recordConversionStatus,
  listConversionStatuses,
  resolveConversionStatus,
  recordResidualDisposition,
  listResidualDispositions,
  assessRoundCompleteness,
  resolveW52PricingOrder,
  type DenominatorSwitchKey,
} from "../server/lib/roundMathDisclosureStore";

/* Fenced output: the store's boot path legitimately writes structured log lines
   to stdout, so a bare JSON dump cannot be parsed by the caller. The markers are
   the contract. */
const START = "##W52B_JSON_START##";
const END = "##W52B_JSON_END##";
function emit(o: unknown): void {
  process.stdout.write(`\n${START}\n${JSON.stringify(o, null, 2)}\n${END}\n`);
}

const ROUND_ID = "w52b_i10_round";
const ACTOR = "w52b_i10_harness";

/** The digest is over the SEMANTIC content, never over row ids or timestamps,
 *  which legitimately differ between a write and a later read. */
function digest(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function buildPayload(dropSwitch: DenominatorSwitchKey | null) {
  const switches = resolveDenominatorSwitches(ROUND_ID);
  const keys = DENOMINATOR_SWITCH_KEYS.filter((k) => k !== dropSwitch);
  return {
    switches: keys.map((k) => [k, switches.values[k] ?? null]),
    switchesComplete: dropSwitch === null ? switches.complete : null,
    conversions: listConversionStatuses(ROUND_ID).map((c) => [
      c.instrumentId, c.instrumentKind, c.conversionStatus,
      c.conversionTriggerBasis, c.accruedInterestModelled, c.asConvertedShares,
    ]),
    /* FAIL-CLOSED: an instrument with no row must read back `undetermined`. */
    unrecordedInstrument: resolveConversionStatus(ROUND_ID, "never_recorded").status,
    residuals: listResidualDispositions(ROUND_ID).map((r) => [
      r.investorId, r.closeRef, r.currency,
      r.committedMinor, r.appliedMinor, r.residualMinor,
      r.residualDisposition, r.dispositionClauseRef, r.creditedToCloseRef,
    ]),
    completeness: assessRoundCompleteness({
      roundId: ROUND_ID,
      residualsByInvestor: { inv_a: 0, inv_b: 97, inv_missing: 55 },
    }),
    flag: (() => {
      const f = resolveW52PricingOrder();
      return { enabled: f.enabled, mode: f.mode, source: f.source };
    })(),
  };
}

function write(): void {
  for (const key of DENOMINATOR_SWITCH_KEYS) {
    recordDenominatorSwitch({
      roundId: ROUND_ID,
      switchKey: key,
      switchValue: DENOMINATOR_SWITCHES[key].default,
      isDefault: true,
      recordedBy: ACTOR,
    });
  }
  /* One deliberate NON-default, so the round trip is not all defaults. */
  recordDenominatorSwitch({
    roundId: ROUND_ID,
    switchKey: "note_conversion_method",
    switchValue: "post_money_method",
    isDefault: false,
    authorityRef: "Buchanan Ingersoll four-method table (ISR §3, §13 #4)",
    recordedBy: ACTOR,
  });

  recordConversionStatus({
    roundId: ROUND_ID, instrumentId: "safe_1", instrumentKind: "safe_post",
    conversionStatus: "converts_in_this_round", conversionTriggerBasis: "cap_binding",
    asConvertedShares: "2500000", recordedBy: ACTOR,
  });
  recordConversionStatus({
    roundId: ROUND_ID, instrumentId: "note_1", instrumentKind: "convertible_note",
    conversionStatus: "undetermined", accruedInterestModelled: false, recordedBy: ACTOR,
  });
  recordConversionStatus({
    roundId: ROUND_ID, instrumentId: "safe_2", instrumentKind: "safe_pre",
    conversionStatus: "does_not_convert", recordedBy: ACTOR,
  });

  recordResidualDisposition({
    roundId: ROUND_ID, investorId: "inv_a", currency: "USD",
    committedMinor: 1_000_000_000, appliedMinor: 1_000_000_000, residualMinor: 0,
    residualDisposition: "returned", recordedBy: ACTOR,
  });
  recordResidualDisposition({
    roundId: ROUND_ID, investorId: "inv_b", currency: "USD",
    committedMinor: 49_999_897, appliedMinor: 49_999_800, residualMinor: 97,
    residualDisposition: "credited_next_close", creditedToCloseRef: "second",
    recordedBy: ACTOR,
  });

  const payload = buildPayload(null);
  emit({ digest: digest(payload), payload });
}

function read(dropSwitch: DenominatorSwitchKey | null): void {
  const payload = buildPayload(dropSwitch);
  emit({ digest: digest(payload), payload });
}

const mode = process.argv[2];
const dropArg = process.argv.find((a) => a.startsWith("--drop="));
const drop = (dropArg ? dropArg.slice("--drop=".length) : null) as DenominatorSwitchKey | null;

if (mode === "write") write();
else if (mode === "read") read(drop);
else {
  process.stderr.write("usage: w52b_i10_roundtrip.ts <write|read> [--drop=<switchKey>]\n");
  process.exit(2);
}
