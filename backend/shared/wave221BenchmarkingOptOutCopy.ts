/**
 * WAVE 221 — copy for the investor and partner benchmarking / matchmaking opt-out.
 *
 * Owned by wave 221 per §221.3. Every string here goes through `fitToGate()` so it
 * clears the 240-character `looksHuman` gate (`LOOKS_HUMAN_MAX_LENGTH`, strict `<`)
 * instead of being hand-counted.
 *
 * TRUTHFULNESS (§221.4, §221.7 — error class E2 inverted). Each sentence below
 * describes behaviour this wave actually built and tests:
 *
 *   - "may be used alongside other customers' data"  → `computeCohortBenchmark`
 *     in `server/wave9ReportingStore.ts` builds a percentile sample across every
 *     `portfolio_metric_snapshot` row for the period.
 *   - "switching it off stops that"                  → the same function filters
 *     opted-out subjects out of the sample BEFORE the percentiles are computed,
 *     not at display time.
 *   - "you can switch it back on at any time"        → the column is set back to
 *     NULL on re-enable. Wave 213 deliberately avoided "permanent" and
 *     "cannot be turned off"; nothing here reintroduces either.
 *   - "your own figures stay on your own screens"    → the `you` value is
 *     resolved from the unfiltered rows, so opting out never blanks the owner's
 *     own number.
 *
 * DELIBERATELY ABSENT, and it must stay absent:
 *   - any claim that past aggregates are deleted or retrospectively removed. They
 *     are not deleted. The filter applies whenever a benchmark is computed, so a
 *     recomputation excludes the subject, but no stored row is erased. §221.4:
 *     "No claim is made about retrospective removal unless the platform actually
 *     does it — if it does not, the copy says so." The sentence below says so.
 *   - any compliance claim (GDPR, "compliant", "lawful basis", "satisfies").
 *     §221.7 forbids presenting the opt-out as satisfying GDPR; the counsel
 *     question is wave 222's to file.
 */

import { fitToGate } from "./refusalHeadlineGate";

/** The two silos this wave adds the control to. The founder silo already has one. */
export type Wave221Silo = "investor" | "partner";

/** Stable audit event name. Exported so the writer and every reader use one symbol. */
export const WAVE221_AUDIT_EVENT = "wave221.benchmarking_sharing.changed";

/** Words that would turn this control into a misstatement if they ever appeared. */
export const WAVE221_FORBIDDEN_CLAIM_SUBSTRINGS: readonly string[] = [
  "permanent",
  "cannot be turned off",
  "can not be turned off",
  "irreversible",
  "retrospectively removed",
  "retroactively removed",
  "delete your past",
  "deletes your past",
  "erased",
  "gdpr",
  "compliant",
];

function subjectNoun(silo: Wave221Silo): string {
  return silo === "investor" ? "your portfolio figures" : "your firm's profile data";
}

/** The switch label. Modelled on the founder control's question form (§221.4). */
export function wave221SwitchLabel(silo: Wave221Silo): string {
  return fitToGate(() =>
    `Share ${subjectNoun(silo)} across the Collective for benchmarking and matchmaking?`,
  );
}

/**
 * The consequence line: what turning it on does, and that it can be turned off
 * again at any time (§221.4 requires both halves).
 */
export function wave221ConsequenceLine(silo: Wave221Silo): string {
  return fitToGate(() =>
    `On: ${subjectNoun(silo)} may be used alongside other customers' data to build ` +
    `benchmarks and matches. Off: that stops. You can switch it back on at any time.`,
  );
}

/**
 * The plain statement of what the platform does in its own right — not a
 * disclaimer of it (§221.4).
 */
export function wave221PlainStatement(silo: Wave221Silo): string {
  return fitToGate(() =>
    `This platform aggregates ${subjectNoun(silo)} with other customers' data to ` +
    `produce benchmarks and matches. You control whether yours is included.`,
  );
}

/**
 * The non-retrospection sentence. Required because the platform does NOT delete
 * past aggregates, so §221.4 obliges the copy to say what it does instead.
 */
export function wave221NoRetrospectionLine(): string {
  return fitToGate(() =>
    `Switching off stops future use. Benchmarks are recalculated without you from ` +
    `then on; figures already published to others are not withdrawn.`,
  );
}

/** The state line shown next to the switch. Never says "permanent". */
export function wave221StateLine(optedOut: boolean): string {
  return fitToGate(() =>
    optedOut
      ? `Currently OFF — your data is excluded when benchmarks are calculated.`
      : `Currently ON — your data is included when benchmarks are calculated.`,
  );
}

/** Every string this wave renders, for the copy-audit and truthfulness tests. */
export function wave221AllCopy(silo: Wave221Silo): string[] {
  return [
    wave221SwitchLabel(silo),
    wave221ConsequenceLine(silo),
    wave221PlainStatement(silo),
    wave221NoRetrospectionLine(),
    wave221StateLine(true),
    wave221StateLine(false),
  ];
}
