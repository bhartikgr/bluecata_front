/**
 * Sprint 14 D7 — Universal tracing wrapper.
 *
 * Per Pattern 1 + harvest_capavate §1: every store mutation/computation must
 * be wrapped in `withTrace()` so the resulting TelemetryEnvelope.trace[] is
 * non-empty. This enables:
 *   - Replay (deterministic re-run with same defHash)
 *   - Golden-vector regression
 *   - Latency p50/p95 per formula
 *
 * Usage:
 *   const result = withTrace("captable.commit", "1.0.0", "US", () => doWork());
 *   // current trace stack is auto-attached to subsequently-emitted envelopes.
 *
 * The `currentTrace()` helper exposes the active trace[] so emitSync can
 * splice it onto the envelope automatically.
 */
import { createHash } from "node:crypto";
import type { TraceStep } from "@shared/schema";

const stack: TraceStep[][] = [];

/** Compute a stable defHash for a formulaId@version. */
export function computeDefHash(formulaId: string, version: string): string {
  return createHash("sha256").update(`${formulaId}@${version}`).digest("hex").slice(0, 16);
}

/**
 * Wrap a synchronous computation with a trace step. The step is pushed on
 * entry, captured on exit, and made available to any envelope emitted from
 * within `fn` via `currentTrace()`.
 */
export function withTrace<T>(
  formulaId: string,
  version: string,
  region: string,
  fn: () => T,
): T {
  const start = Date.now();
  const step: TraceStep = {
    formulaId,
    version,
    region,
    defHash: computeDefHash(formulaId, version),
    ts: new Date(start).toISOString(),
    durMs: 0,
  };
  // Push a new frame combining the parent's trace + this step
  const parent = stack.length ? stack[stack.length - 1] : [];
  stack.push([...parent, step]);
  try {
    const out = fn();
    step.durMs = Date.now() - start;
    return out;
  } finally {
    stack.pop();
  }
}

/** Async variant. */
export async function withTraceAsync<T>(
  formulaId: string,
  version: string,
  region: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  const step: TraceStep = {
    formulaId,
    version,
    region,
    defHash: computeDefHash(formulaId, version),
    ts: new Date(start).toISOString(),
    durMs: 0,
  };
  const parent = stack.length ? stack[stack.length - 1] : [];
  stack.push([...parent, step]);
  try {
    const out = await fn();
    step.durMs = Date.now() - start;
    return out;
  } finally {
    stack.pop();
  }
}

/** Get the current trace[] snapshot (or undefined if no active frame). */
export function currentTrace(): TraceStep[] | undefined {
  if (!stack.length) return undefined;
  return stack[stack.length - 1].slice();
}

/** Force-attach a synthetic single-step trace, useful for plain endpoint emits. */
export function singleStepTrace(formulaId: string, version: string, region: string): TraceStep[] {
  return [{
    formulaId,
    version,
    region,
    defHash: computeDefHash(formulaId, version),
    ts: new Date().toISOString(),
    durMs: 0,
  }];
}

/** Test helper — clear any leaked frames between tests. */
export function __clearTraceStack(): void {
  stack.length = 0;
}
