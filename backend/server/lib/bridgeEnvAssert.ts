/**
 * server/lib/bridgeEnvAssert.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.5. NON-SACRED. Reports; NEVER aborts boot.
 *
 * WHY THIS EXISTS. The legacy Collective bridge was pointed at
 * `https://collective.capavate.com/api/bridge/inbox`. That DNS name does not
 * resolve. Every outbound POST failed, and the outbox grew to 568 events / 0
 * delivered before anyone noticed, because a delivery failure is only visible on
 * an admin page nobody opens. The configuration was wrong for months and the
 * platform reported itself healthy the whole time.
 *
 * WHAT THIS IS. A pure inspection of the bridge environment that returns
 * structured findings. Two consumers:
 *
 *   1. `/api/healthz` — surfaces `bridgeEnvOk` + `bridgeOutboundConfigured` as
 *      BOOLEANS so a monitor can alert on a misconfiguration instead of waiting
 *      for a human to read the outbox page.
 *   2. `npx tsx server/lib/bridgeEnvAssert.ts` — a PRE-RESTART preflight. Run it
 *      before deploying; a non-zero exit means the bridge env is wrong.
 *
 * WHY IT DOES NOT ABORT BOOT. `server/lib/bridgeRuntime.ts` is SACRED and
 * already throws in production for the one case that must be fatal
 * (`COLLECTIVE_WEBHOOK_URL` set with no secret — it would emit unsigned
 * webhooks). Adding a second boot gate here on a LIVE money platform risks
 * taking the whole application down over a queue that is currently DISABLED and
 * has no consumer. Findings are `warn`-level at runtime and only the preflight
 * exits non-zero.
 *
 * NEVER LEAKS A SECRET. Findings carry variable NAMES, booleans and lengths —
 * never a value, never a credentialed URL. `/api/healthz` is PUBLIC (no auth).
 */

export type BridgeEnvSeverity = "error" | "warn" | "info";

export interface BridgeEnvFinding {
  severity: BridgeEnvSeverity;
  /** Stable machine code, safe to alert on. */
  code: string;
  /** Human text. Contains variable names only — no values. */
  message: string;
}

export interface BridgeEnvReport {
  /** True when there is no `error`-severity finding. */
  ok: boolean;
  /** True when outbound delivery is fully configured (URL + secret). */
  outboundConfigured: boolean;
  /** True when the bridge is switched on at all. */
  enabled: boolean;
  findings: BridgeEnvFinding[];
}

/** The host that does not exist. Any bridge URL naming it is a hard error. */
const DEAD_HOST = "collective.capavate.com";

const truthy = (v: string | undefined): boolean =>
  ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());

export function inspectBridgeEnv(env: NodeJS.ProcessEnv = process.env): BridgeEnvReport {
  const findings: BridgeEnvFinding[] = [];
  const add = (severity: BridgeEnvSeverity, code: string, message: string) =>
    findings.push({ severity, code, message });

  const webhookUrl = String(env.COLLECTIVE_WEBHOOK_URL ?? "").trim();
  const legacyUrl = String(env.BRIDGE_OUTBOUND_URL ?? "").trim();
  const webhookSecret = String(env.COLLECTIVE_WEBHOOK_SECRET ?? "").trim();
  const inboundSecret = String(
    env.BRIDGE_INBOUND_HMAC_SECRET ?? env.BRIDGE_HMAC_SECRET ?? "",
  ).trim();
  const appUrl = String(env.COLLECTIVE_APP_URL ?? "").trim();
  const enabled = truthy(env.BRIDGE_ENABLED);
  const effectiveUrl = webhookUrl || legacyUrl;

  for (const [name, value] of [
    ["COLLECTIVE_WEBHOOK_URL", webhookUrl],
    ["BRIDGE_OUTBOUND_URL", legacyUrl],
    ["COLLECTIVE_APP_URL", appUrl],
  ] as const) {
    if (value.includes(DEAD_HOST)) {
      add(
        "error",
        "dead_host",
        `${name} points at ${DEAD_HOST}, which does not resolve. The Collective is a PATH on capavate.com.`,
      );
    }
  }

  // The one case bridgeRuntime.ts (SACRED) already makes fatal in production.
  if (effectiveUrl && !webhookSecret) {
    add(
      "error",
      "url_without_secret",
      "An outbound bridge URL is set but COLLECTIVE_WEBHOOK_SECRET is empty — bridgeRuntime refuses to emit unsigned webhooks and ABORTS BOOT in production.",
    );
  }

  // Outbound signer and inbound verifier read DIFFERENT variables; the bridge is
  // a self-loop, so unequal secrets mean every self-POST 401s and dead-letters.
  if (effectiveUrl && webhookSecret && inboundSecret && webhookSecret !== inboundSecret) {
    add(
      "error",
      "secret_mismatch",
      "COLLECTIVE_WEBHOOK_SECRET and BRIDGE_INBOUND_HMAC_SECRET differ. The bridge is a self-loop: every outbound event will fail inbound HMAC verification and dead-letter.",
    );
  }
  if (effectiveUrl && webhookSecret && !inboundSecret) {
    add(
      "error",
      "inbound_secret_missing",
      "An outbound bridge URL and secret are set but no BRIDGE_INBOUND_HMAC_SECRET / BRIDGE_HMAC_SECRET is configured, so the self-POST cannot be verified.",
    );
  }

  if (enabled && !effectiveUrl) {
    add(
      "error",
      "enabled_without_url",
      "BRIDGE_ENABLED is on but no COLLECTIVE_WEBHOOK_URL / BRIDGE_OUTBOUND_URL is set — every event will queue and never leave.",
    );
  }

  if (!enabled) {
    add("info", "bridge_disabled", "BRIDGE_ENABLED is off. Outbound bridge delivery is intentionally inert.");
  }
  if (!webhookUrl && legacyUrl) {
    add(
      "warn",
      "legacy_url_only",
      "Only the legacy BRIDGE_OUTBOUND_URL is set. Prefer the canonical COLLECTIVE_WEBHOOK_URL.",
    );
  }
  if (!appUrl) {
    add("warn", "app_url_missing", "COLLECTIVE_APP_URL is unset; Collective links in emails will be relative or broken.");
  } else if (!/^https?:\/\//.test(appUrl)) {
    add("warn", "app_url_not_absolute", "COLLECTIVE_APP_URL is not an absolute http(s) URL.");
  }
  if (webhookSecret && webhookSecret.length < 32) {
    add("warn", "secret_too_short", "COLLECTIVE_WEBHOOK_SECRET is shorter than 32 characters.");
  }

  return {
    ok: !findings.some((f) => f.severity === "error"),
    outboundConfigured: !!effectiveUrl && !!webhookSecret,
    enabled,
    findings,
  };
}

/**
 * Warn-only runtime reporter. Call once at boot. Logs `error`-severity findings
 * loudly and returns the report; it NEVER throws and NEVER exits.
 */
export function reportBridgeEnv(logger?: {
  warn: (...a: unknown[]) => void;
  info?: (...a: unknown[]) => void;
}): BridgeEnvReport {
  const report = inspectBridgeEnv();
  const warn = logger?.warn ?? ((...a: unknown[]) => console.warn(...a));
  for (const f of report.findings) {
    if (f.severity === "error") warn(`[bridgeEnvAssert] ERROR ${f.code}: ${f.message}`);
    else if (f.severity === "warn") warn(`[bridgeEnvAssert] warn ${f.code}: ${f.message}`);
  }
  return report;
}

/**
 * PRE-RESTART PREFLIGHT.  `npx tsx server/lib/bridgeEnvAssert.ts`
 * Exit 0 = safe to restart. Exit 1 = at least one `error` finding.
 */
async function main(): Promise<void> {
  try {
    const { config } = await import("dotenv");
    config();
  } catch {
    /* dotenv optional — env may already be populated by the platform. */
  }
  const report = inspectBridgeEnv();
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { ok: report.ok, enabled: report.enabled, outboundConfigured: report.outboundConfigured, findings: report.findings },
      null,
      2,
    ),
  );
  process.exit(report.ok ? 0 : 1);
}

/* Only self-execute when invoked directly, never on import. */
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv.length > 1 &&
  /bridgeEnvAssert\.(ts|js|cjs|mjs)$/.test(process.argv[1] ?? "");
if (invokedDirectly) void main();

export default inspectBridgeEnv;
