/**
 * server/lib/bridgeEnvAssert.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.5. NON-SACRED. Reports; NEVER aborts boot.
 *
 * WAVE 187 UPDATE (R159.2, OPTION A). The findings below now describe the REAL
 * Collective receiver at `/api/bridge/collective-receive`
 * (`server/lib/collectiveBridgeReceiver.ts`) rather than the pre-187 assumption
 * that no receiver existed. Three changes: the configured URL's PATH is now
 * verified (pointing production at the `_mock` route is a hard error — the exact
 * mistake R148.2 caught by hand), the host is checked to be a path on
 * capavate.com and never DEAD_HOST, and the two secret findings are downgraded
 * to warn because the real receiver verifies against both secrets.
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

/**
 * WAVE 187 (R159.2 — the owner chose OPTION A: build a REAL receiver).
 *
 * Until wave 187 the only inbound endpoint in the tree was
 * `/api/_mock_collective/inbound`, a test double. R148.2 is explicit about the
 * consequence: *"I told Avi to set COLLECTIVE_WEBHOOK_URL. If he does that today,
 * he will point production at a route named `_mock` and immediately fire 732 real
 * events at it."* That was a human-judgement catch. It is now a machine check.
 *
 * These findings describe the receiver that ACTUALLY EXISTS, replacing the older
 * assumptions that (a) there was no receiver at all and (b) an outbound/inbound
 * secret mismatch was fatal.
 */
const REAL_RECEIVER_PATH = "/api/bridge/collective-receive";
/** The mock. Pointing production here is the R148.2 mistake, now a hard error. */
const MOCK_RECEIVER_PATH = "/api/_mock_collective/inbound";
/** The Collective is a PATH on these hosts. It is NOT a subdomain. */
const EXPECTED_HOSTS = ["capavate.com", "www.capavate.com"];
const DEV_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

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

  /* WAVE 187 — THE RECEIVER PATH IS NOW CHECKED, not assumed.
     A URL that resolves but points at the wrong path is the failure R148.2
     caught by hand. Both branches below are what a preflight must refuse. */
  if (effectiveUrl) {
    let urlPath = "";
    let urlHost = "";
    try {
      const parsed = new URL(effectiveUrl);
      urlPath = parsed.pathname.replace(/\/+$/, "") || "/";
      urlHost = parsed.hostname.toLowerCase();
    } catch {
      add(
        "error",
        "receiver_url_unparseable",
        "The configured outbound bridge URL is not a parseable absolute URL, so the receiver path cannot be verified.",
      );
    }
    if (urlPath) {
      if (urlPath === MOCK_RECEIVER_PATH) {
        add(
          "error",
          "receiver_is_the_mock",
          `The outbound bridge URL points at ${MOCK_RECEIVER_PATH}, which is the in-process TEST DOUBLE. Point it at the real receiver ${REAL_RECEIVER_PATH} instead; delivering real events into the mock records no outcome and applies nothing.`,
        );
      } else if (urlPath !== REAL_RECEIVER_PATH) {
        add(
          "error",
          "receiver_path_unknown",
          `The outbound bridge URL's path is not the real Collective receiver. It must end with ${REAL_RECEIVER_PATH} — that is the only endpoint that verifies the signature, enforces idempotency, applies the event and records an outcome per event.`,
        );
      }
    }
    if (urlHost && !EXPECTED_HOSTS.includes(urlHost) && !DEV_HOSTS.includes(urlHost)) {
      add(
        "warn",
        "receiver_host_unexpected",
        `The outbound bridge URL host is neither ${EXPECTED_HOSTS.join(" nor ")} nor a local development host. The Collective is a PATH on capavate.com, not a separate host.`,
      );
    }
  }

  /* WAVE 187 — DOWNGRADED error → warn, with the reason stated.
     The old text said unequal secrets mean "every outbound event will fail
     inbound HMAC verification and dead-letter". That was true of the mock and of
     the pre-wave-187 inbound route, which verified ONLY against
     BRIDGE_INBOUND_HMAC_SECRET. The real receiver verifies against a CANDIDATE
     SET — the outbound secret first, then the inbound secret — each in constant
     time. So a mismatch no longer dead-letters anything. Leaving this at `error`
     would make the preflight exit non-zero on a configuration that now works,
     and a check that lies in the safe direction is still a check that lies. */
  if (effectiveUrl && webhookSecret && inboundSecret && webhookSecret !== inboundSecret) {
    add(
      "warn",
      "secret_mismatch",
      "COLLECTIVE_WEBHOOK_SECRET and BRIDGE_INBOUND_HMAC_SECRET differ. This is no longer fatal: the real Collective receiver verifies against both secrets, so signed events still verify. Setting them to the same value is still cleaner.",
    );
  }
  /* WAVE 187 — also downgraded, and for the same reason: the real receiver
     verifies with COLLECTIVE_WEBHOOK_SECRET, which is the secret the outbound
     signer actually used, so the inbound variable is no longer required for the
     self-POST to verify. */
  if (effectiveUrl && webhookSecret && !inboundSecret) {
    add(
      "warn",
      "inbound_secret_missing",
      "BRIDGE_INBOUND_HMAC_SECRET / BRIDGE_HMAC_SECRET is unset. The real Collective receiver verifies with COLLECTIVE_WEBHOOK_SECRET, so outbound delivery still verifies; the older /api/bridge/inbound endpoint will fall back to its insecure default secret.",
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
  /* WAVE 187 — state plainly that a real receiver now exists, and that its
     existence is NOT the same as the bridge being on. R148.2's reasoning holds:
     the queued backlog must not fire until a human decides. */
  add(
    "info",
    "receiver_ready",
    `A real Collective receiver exists at ${REAL_RECEIVER_PATH}. It verifies the signature, enforces idempotency by primary key, applies what it can and records an outcome and reason for every event (readable at /api/admin/bridge/receiver-log). It does NOT switch the bridge on — that needs BRIDGE_ENABLED plus COLLECTIVE_WEBHOOK_URL and COLLECTIVE_WEBHOOK_SECRET, which is an owner action.`,
  );
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
