/**
 * server/lib/wave16FeeAggregateWiring.ts
 *
 * WAVE 16 — CP-BRG-07 completion fence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A FENCE AND NOT JUST A TEST OF THE HAPPY PATH
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 15 shipped `buildFeeScheduleAggregate`, its route, and
 * `publishFeeScheduleChanged`. It shipped ZERO callers of the publisher and ZERO
 * client readers of the route. By the owner's rule that is NOT shipped. The
 * failure mode this fence exists to prevent is the SAME shape recurring: a
 * future wave adds a fourth write path to a fee input, forgets the publish, and
 * every partner's Fee Schedule tab silently shows a stale price. Nothing would
 * fail. A price a partner reads and believes would be wrong.
 *
 * So the wiring itself is asserted STATICALLY, per declared write site.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO EARLIER FAILURES THIS FILE IS DELIBERATELY BUILT AGAINST
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. "A scope fence validating files that never existed." Every declared site
 *     here is reported as a FINDING when the file is absent. A missing file can
 *     never make this fence quieter.
 *  2. "`codeOnly()` blanking a real `registerPartnerRoutes(app)` call." This
 *     fence therefore does NOT strip comments — stripping is what destroyed the
 *     evidence last time. Instead it requires a CALL-SHAPED token
 *     (`publishFeeScheduleChanged(` / `publishFeeScheduleChangedForTier(`), so a
 *     prose mention or a bare `import { publishFeeScheduleChanged }` does not
 *     satisfy it. The test proves exactly that with a comment-only fixture.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/** A write that changes an INPUT to `buildFeeScheduleAggregate`. */
export interface FeeInputWriteSite {
  /** Repo-relative path. */
  file: string;
  /** Which aggregate leg this file's writes move. */
  leg: "fee_schedule" | "partner_override" | "commission_rate";
  /**
   * Evidence that this file really does write that leg. Matched against the RAW
   * file text; if it does not match, the site declaration itself is stale and
   * that is reported — a fence whose premise has rotted must not pass.
   */
  mutationEvidence: RegExp;
  why: string;
}

/**
 * The write sites, verified at source before being listed here:
 *  - `partner_fee_schedules` INSERT / UPDATE / expire — the `tier_default` and
 *    `platform_default` legs of `resolvePartnerFee`.
 *  - `contacts.fee_override_json` UPDATE — the `partner_override` leg.
 *  - `partner_commission_rate_config` upsert, reached from
 *    `server/adminCollectiveFeeRoutes.ts` — the commission leg. This is the
 *    SECOND PATH: it lives in a different file from the fee schedules and was
 *    the one a fee-schedule-only publish would have missed.
 */
export const FEE_INPUT_WRITE_SITES: readonly FeeInputWriteSite[] = Object.freeze([
  {
    file: "server/lib/partnerFeeAdminRoutes.ts",
    leg: "fee_schedule",
    mutationEvidence: /(INSERT INTO\s+partner_fee_schedules|UPDATE\s+partner_fee_schedules)/i,
    why: "admin fee catalogue CRUD sets the tier_default / platform_default price",
  },
  {
    file: "server/lib/partnerFeeAdminRoutes.ts",
    leg: "partner_override",
    mutationEvidence: /fee_override_json\s*=\s*\?/,
    why: "per-partner override is the highest-precedence price leg",
  },
  {
    file: "server/adminCollectiveFeeRoutes.ts",
    leg: "commission_rate",
    mutationEvidence: /updateCommissionRate\s*\(/,
    why: "SECOND PATH — the commission leg is written here, not with the fee schedules",
  },
]);

/** A call-shaped reference to either publisher. Comments and imports do not match. */
const PUBLISH_CALL = /\bpublishFeeScheduleChanged(?:ForTier)?\s*\(/;

export interface WiringFinding {
  site: string;
  problem: "file_missing" | "mutation_evidence_absent" | "publish_call_absent";
  detail: string;
}

export interface WiringAudit {
  ok: boolean;
  checked: number;
  findings: WiringFinding[];
}

/**
 * Assert that every declared fee-input write site publishes an invalidation
 * frame. `root` is the repo root so the same function can be pointed at a
 * fixture tree — which is how the negative pole is proven.
 */
export function auditFeeAggregatePublishers(root: string): WiringAudit {
  const findings: WiringFinding[] = [];
  for (const site of FEE_INPUT_WRITE_SITES) {
    const abs = join(root, site.file);
    const label = `${site.file} [${site.leg}]`;
    if (!existsSync(abs)) {
      findings.push({
        site: label,
        problem: "file_missing",
        detail: `declared write site does not exist at ${abs}`,
      });
      continue;
    }
    const text = readFileSync(abs, "utf8");
    if (!site.mutationEvidence.test(text)) {
      findings.push({
        site: label,
        problem: "mutation_evidence_absent",
        detail: `expected ${String(site.mutationEvidence)} — this declaration is stale`,
      });
    }
    if (!PUBLISH_CALL.test(text)) {
      findings.push({
        site: label,
        problem: "publish_call_absent",
        detail: `no call-shaped publishFeeScheduleChanged(...) in ${site.file}; ${site.why}`,
      });
    }
  }
  return { ok: findings.length === 0, checked: FEE_INPUT_WRITE_SITES.length, findings };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The CLIENT CONSUMER. "An engine with no route is NOT shipped" — and a route
 * with no reader is not shipped either. This half of the fence asserts the
 * partner surface actually reads the aggregate, and that it does so without
 * committing the percent defect.
 * ════════════════════════════════════════════════════════════════════════ */

export const FEE_AGGREGATE_ROUTE = "/api/partner/fee-schedule/aggregate";
export const FEE_AGGREGATE_SSE_TOPIC = "partner-workspace";
export const FEE_AGGREGATE_SSE_PATH = "/api/stream";
export const FEE_AGGREGATE_CONSUMER = "client/src/pages/partner/PartnerBilling.tsx";

/**
 * The FORBIDDEN percent normaliser, in the exact shape the standing rule names:
 * `n > 1 ? n/100 : n`. Written as a pattern rather than a literal so
 * whitespace and identifier changes cannot smuggle it back in.
 */
const FORBIDDEN_PERCENT_NORMALISER = /\b(\w+)\s*>\s*1\s*\?\s*\1\s*\/\s*100\s*:\s*\1\b/;

export interface ConsumerFinding {
  problem:
    | "file_missing"
    | "route_not_read"
    | "sse_topic_absent"
    | "sse_path_absent"
    | "percent_helper_absent"
    | "forbidden_percent_normaliser";
  detail: string;
}

export function auditFeeAggregateConsumer(root: string): { ok: boolean; findings: ConsumerFinding[] } {
  const findings: ConsumerFinding[] = [];
  const abs = join(root, FEE_AGGREGATE_CONSUMER);
  if (!existsSync(abs)) {
    return {
      ok: false,
      findings: [{ problem: "file_missing", detail: `no consumer at ${abs}` }],
    };
  }
  const text = readFileSync(abs, "utf8");
  if (!text.includes(FEE_AGGREGATE_ROUTE)) {
    findings.push({ problem: "route_not_read", detail: `${FEE_AGGREGATE_ROUTE} not referenced` });
  }
  if (!text.includes(FEE_AGGREGATE_SSE_TOPIC)) {
    findings.push({ problem: "sse_topic_absent", detail: `topic ${FEE_AGGREGATE_SSE_TOPIC} not subscribed` });
  }
  if (!text.includes(FEE_AGGREGATE_SSE_PATH)) {
    findings.push({ problem: "sse_path_absent", detail: `stream path ${FEE_AGGREGATE_SSE_PATH} not used` });
  }
  if (!/formatFractionAsPercent\s*\(/.test(text)) {
    findings.push({
      problem: "percent_helper_absent",
      detail: "a FRACTION rate is rendered without client/src/lib/percentDisplay.ts",
    });
  }
  if (FORBIDDEN_PERCENT_NORMALISER.test(text)) {
    findings.push({
      problem: "forbidden_percent_normaliser",
      detail: "`n > 1 ? n/100 : n` is FORBIDDEN — it silently reinterprets 1 = 100% as 1%",
    });
  }
  return { ok: findings.length === 0, findings };
}
