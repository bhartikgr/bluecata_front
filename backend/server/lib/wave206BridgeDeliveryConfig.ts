/**
 * server/lib/wave206BridgeDeliveryConfig.ts — WAVE 206 · ITEM B (R182.2).
 *
 * THE RULING: "push to live. I want it working and fully dynamic." Read with,
 * from the same message, "Do not break anything or dramatically make
 * assumptions to change things." Capability, not risk.
 *
 * WHAT THIS IS
 * ------------
 * The Collective bridge's configuration used to exist ONLY as host environment
 * variables, which means the owner cannot change it without his developer. This
 * module makes the NON-SECRET part of it database-backed and admin-settable,
 * with the environment variables RETAINED as a fallback and never removed, and
 * with the precedence made explicit so the owner can always see which value is
 * in force and where it came from.
 *
 * WHY IT IS A NEW, NON-SACRED MODULE
 * ----------------------------------
 * `server/lib/bridgeRuntime.ts` is FROZEN and computes
 *   const LIVE_MODE = !!COLLECTIVE_WEBHOOK_URL && !!COLLECTIVE_WEBHOOK_SECRET
 * from `process.env` AT MODULE LOAD. A database value can therefore never make
 * the sacred sender deliver anywhere. Configuration must be resolved at CALL
 * time from a layer outside the freeze — the same interception discipline waves
 * 189/192/195/197 used.
 *
 * WHY NO SECRET IS STORED HERE
 * ----------------------------
 * `platform_config` is hash-chained, keeps full history, and is UNDELETABLE by
 * trigger (server/db/connection.ts:996-1077). A secret written into it is a
 * PERMANENT exposure that cannot be removed — exactly the class of defect behind
 * the owner's outstanding credential-rotation item. So the webhook secret stays
 * in host environment variables, and this module reports only WHETHER one is
 * set, never its value, never a prefix, never a length.
 *
 * REUSE, NOT INVENTION
 * --------------------
 *  - storage + audit chain: wave 11's `platformConfigWriter.ts`
 *    (`ensurePlatformConfigKey` / `updatePlatformConfigValue`) — hash-chained,
 *    atomically audited, trigger-protected. No migration is needed; wave 195
 *    used the same table and needed none either.
 *  - admin audit: wave 186's `appendAdminAudit` / `reportAuditWriteOutcome`.
 *    NO second audit path.
 *  - URL validity: the REAL `inspectBridgeEnv()` rules, called with the
 *    candidate URL. Nothing about the dead host or the receiver path is
 *    re-typed here, so this module cannot drift from the real rules and no
 *    endpoint is hardcoded.
 */
import {
  ensurePlatformConfigKey,
  readConfigRow,
  updatePlatformConfigValue,
  PlatformConfigWriteError,
  type ConfigRow,
} from "./platformConfigWriter";
import { inspectBridgeEnv, type BridgeEnvFinding } from "./bridgeEnvAssert";
import {
  resolveReceiverUrl,
  resolveReceiverSecret,
  isPlaceholderSecret,
} from "./bridgeOutboundGuard";
import { isBridgeEnabled } from "./bridgeEnabled";
import { fitToGate } from "./wave195CommitCurrencyDeclaration";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";

/**
 * Every human-readable string in this module goes through wave 195's
 * `fitToGate()`, which is the reusable form of the 240-character `looksHuman`
 * gate. Empty parts are dropped so a sentence never ends in a stray space.
 */
function humanText(...parts: string[]): string {
  const joined = parts.filter((p) => p.length > 0).join(" ");
  return fitToGate(() => joined);
}

/* ============================================================
 * KEYS
 * ============================================================ */

export const BRIDGE_DELIVERY_ENABLED_KEY = "collective.bridge.delivery_enabled";
export const BRIDGE_RECEIVER_URL_KEY = "collective.bridge.receiver_url";
export const BRIDGE_DRAIN_BATCH_LIMIT_KEY = "collective.bridge.drain_batch_limit";

/** The three settable keys, in the order the screen shows them. */
export const WAVE206_BRIDGE_CONFIG_KEYS = [
  BRIDGE_DELIVERY_ENABLED_KEY,
  BRIDGE_RECEIVER_URL_KEY,
  BRIDGE_DRAIN_BATCH_LIMIT_KEY,
] as const;

export type Wave206BridgeConfigKey = (typeof WAVE206_BRIDGE_CONFIG_KEYS)[number];

/**
 * HOW "NOT SET HERE" IS REPRESENTED — READ THIS BEFORE CHANGING A DEFAULT
 * ----------------------------------------------------------------------
 * R176.1: a missing value must never take part in an equality comparison as if
 * it were a value. A boolean column cannot express "nobody has decided", so a
 * plain boolean row would make "off because the owner chose off" and "off
 * because nothing is stored" indistinguishable — and the environment fallback
 * would be silently unreachable forever after genesis.
 *
 * So absence is stored as an EXPLICIT, NAMED value:
 *   - delivery: the literal "unset", or "on", or "off";
 *   - receiver address: the literal "unset", or a validated absolute URL;
 *   - batch limit: 0, which no real limit can ever be (the floor is 1).
 *
 * "Not set here" is therefore a value the owner can read on screen, can set
 * deliberately to hand a setting back to the host environment, and which can
 * never be confused with a decision. Nothing is inferred from a row's absence
 * or from a version number.
 */
export const UNSET_SENTINEL = "unset";
export const UNSET_BATCH_LIMIT = 0;

/**
 * Built-in defaults. Everything starts at "not set here", so genesis changes
 * nothing about how the platform already behaves, and the batch limit is small,
 * because the owner's ruling asked for staged and reversible, not for a switch
 * that ships already thrown.
 */
const DEFAULT_DELIVERY_ENABLED = false;
const DEFAULT_RECEIVER_URL = "";
const DEFAULT_DRAIN_BATCH_LIMIT = 25;

/** The three stored-value forms. `"unset"` always means "use the fallback". */
export type DeliveryEnabledStored = "unset" | "on" | "off";

/** A drain may never be asked for more than this, whatever the stored limit says. */
export const DRAIN_BATCH_LIMIT_CEILING = 100;
/** ...nor less than this, or the endpoint would be a no-op that looks like a drain. */
export const DRAIN_BATCH_LIMIT_FLOOR = 1;

/* ============================================================
 * GENESIS — idempotent, safe to call on every boot
 * ============================================================ */

let seeded = false;

/**
 * Create the three rows if they are absent. `ensurePlatformConfigKey` returns
 * the existing row untouched when one is already there, so this NEVER
 * overwrites a value the owner has set.
 */
export function ensureWave206BridgeConfigKeys(createdBy = "system:wave206"): void {
  if (seeded) return;
  const rows: Array<{ key: string; valueJson: string; valueType: "boolean" | "string" | "number"; description: string }> = [
    {
      key: BRIDGE_DELIVERY_ENABLED_KEY,
      valueJson: JSON.stringify(UNSET_SENTINEL),
      valueType: "string",
      description: humanText(
        "Whether the owner-initiated Collective bridge drain may deliver: on, off, or unset.",
        "Unset means the host environment decides. Off means the drain refuses. Neither ever starts the background worker.",
      ),
    },
    {
      key: BRIDGE_RECEIVER_URL_KEY,
      valueJson: JSON.stringify(UNSET_SENTINEL),
      valueType: "string",
      description: humanText(
        "Where the owner-initiated drain delivers to.",
        "Unset means fall back to the host environment variable. Validated against the real receiver rules before it is stored.",
      ),
    },
    {
      key: BRIDGE_DRAIN_BATCH_LIMIT_KEY,
      valueJson: JSON.stringify(UNSET_BATCH_LIMIT),
      valueType: "number",
      description: humanText(
        "The largest number of queued events one drain may deliver. Zero means not set here.",
        "A hard cap, so a mistake cannot become hundreds of deliveries in one burst.",
      ),
    },
  ];
  for (const r of rows) {
    try {
      ensurePlatformConfigKey({ ...r, createdBy });
    } catch (err) {
      /* Genesis must never break boot. A missing row degrades to the
         environment fallback, which is the pre-wave-206 behaviour. */
      log.warn(
        `[wave206BridgeConfig] could not seed ${r.key}: ${(err as Error).message}`,
      );
    }
  }
  seeded = true;
}

/** For tests: allow re-seeding against a fresh database. */
export function _resetWave206SeedLatch(): void {
  seeded = false;
}

/* ============================================================
 * RESOLUTION — explicit precedence
 * ============================================================ */

export type ConfigSource = "database" | "environment" | "default";

export interface ResolvedField<T> {
  value: T;
  source: ConfigSource;
  /** The environment variable(s) this field falls back to, by NAME. */
  envVarNames: string[];
  /** platform_config version: 1 means genesis/untouched, >1 means the owner has set it. */
  dbVersion: number | null;
  /** Plain-language statement of which value is in force and where it came from. */
  precedence: string;
}

/**
 * Read the stored value for a key, or `null` when there is no row at all.
 *
 * "Has the owner set this?" is answered ONLY by comparing the stored value
 * against the explicit `"unset"` sentinel (or 0 for the limit). Absence is a
 * value here, never an inference from a version number and never an equality
 * test against something that might be missing (R176.1).
 */
function readStored<T>(key: string, fallback: T): { row: ConfigRow | null; stored: T } {
  const row = readConfigRow(key);
  if (!row) return { row: null, stored: fallback };
  try {
    return { row, stored: JSON.parse(row.valueJson) as T };
  } catch {
    return { row, stored: fallback };
  }
}

/**
 * Stated on screen beside EVERY field. Kept short deliberately: the 240-character
 * `looksHuman` gate truncates, and a precedence rule truncated mid-word is worse
 * than no precedence rule at all.
 */
const PRECEDENCE_SENTENCE =
  "Precedence: what is set here wins; unset means the host environment variable is used; if neither, the built-in default.";

export function resolveDeliveryEnabled(): ResolvedField<boolean> {
  const envVarNames = ["BRIDGE_ENABLED"];
  const { row, stored } = readStored<DeliveryEnabledStored | boolean>(
    BRIDGE_DELIVERY_ENABLED_KEY,
    UNSET_SENTINEL,
  );
  if (stored === "on" || stored === "off") {
    const value = stored === "on";
    return {
      value,
      source: "database",
      envVarNames,
      dbVersion: row?.version ?? null,
      precedence: humanText(
        `In force: the value you set here, which is ${value ? "on" : "off"}.`,
        PRECEDENCE_SENTENCE,
      ),
    };
  }
  /* Unset here, so the environment governs — the fallback is retained, never
     removed. `isBridgeEnabled()` is the existing reader and is reused so the
     fallback cannot disagree with the rest of the platform. */
  const value = isBridgeEnabled();
  /* `BRIDGE_ENABLED` absent is not the same as `BRIDGE_ENABLED` set: absent
     means the platform default for this environment (off in production, on
     elsewhere), which is a different sentence and must not be reported as
     though the host had said something. */
  const envSaysSomething = (process.env.BRIDGE_ENABLED ?? "").trim() !== "";
  return {
    value,
    source: envSaysSomething ? "environment" : "default",
    envVarNames,
    dbVersion: row?.version ?? null,
    precedence: humanText(
      envSaysSomething
        ? `In force: the host environment, which reads ${value ? "on" : "off"}. This setting is unset here.`
        : `In force: the platform default for this environment, which is ${value ? "on" : "off"}. Nothing is set here or on the host.`,
      PRECEDENCE_SENTENCE,
    ),
  };
}

export function resolveReceiverUrlField(): ResolvedField<string> {
  const envVarNames = ["COLLECTIVE_WEBHOOK_URL", "BRIDGE_OUTBOUND_URL"];
  const { row, stored } = readStored<string>(BRIDGE_RECEIVER_URL_KEY, UNSET_SENTINEL);
  const trimmed = typeof stored === "string" ? stored.trim() : "";
  if (trimmed && trimmed !== UNSET_SENTINEL) {
    return {
      value: trimmed,
      source: "database",
      envVarNames,
      dbVersion: row?.version ?? null,
      precedence: humanText("In force: the address you set here.", PRECEDENCE_SENTENCE),
    };
  }
  /* Reuse the EXISTING centralized resolver so the fallback order (canonical
     name, then the documented alias) is the one the rest of the platform uses. */
  const envUrl = resolveReceiverUrl();
  return {
    value: envUrl,
    source: envUrl ? "environment" : "default",
    envVarNames,
    dbVersion: row?.version ?? null,
    precedence: humanText(
      envUrl
        ? "In force: the address from the host environment. This setting is unset here."
        : "In force: nothing. No address is set here and none on the host, so a drain has nowhere to send.",
      PRECEDENCE_SENTENCE,
    ),
  };
}

export function resolveDrainBatchLimit(): ResolvedField<number> {
  const { row, stored } = readStored<number>(BRIDGE_DRAIN_BATCH_LIMIT_KEY, UNSET_BATCH_LIMIT);
  const isSet = typeof stored === "number" && Number.isFinite(stored) && stored >= DRAIN_BATCH_LIMIT_FLOOR;
  if (isSet) {
    const value = clampBatchLimit(stored);
    return {
      value,
      source: "database",
      envVarNames: [],
      dbVersion: row?.version ?? null,
      precedence: humanText(
        `In force: the limit you set here, ${value} events per drain.`,
        `A drain can never exceed ${DRAIN_BATCH_LIMIT_CEILING} events however this is set.`,
      ),
    };
  }
  return {
    value: DEFAULT_DRAIN_BATCH_LIMIT,
    source: "default",
    envVarNames: [],
    dbVersion: row?.version ?? null,
    precedence: humanText(
      `In force: the built-in limit of ${DEFAULT_DRAIN_BATCH_LIMIT} events per drain. This setting is unset here.`,
      `A drain can never exceed ${DRAIN_BATCH_LIMIT_CEILING} events however this is set.`,
    ),
  };
}

/**
 * The batch limit is a COUNT of events, not money. `Number()` is deliberately
 * not used on any monetary field anywhere in this wave; this is a plain integer
 * count and it is range-checked in both directions.
 */
export function clampBatchLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_DRAIN_BATCH_LIMIT;
  if (n < DRAIN_BATCH_LIMIT_FLOOR) return DRAIN_BATCH_LIMIT_FLOOR;
  if (n > DRAIN_BATCH_LIMIT_CEILING) return DRAIN_BATCH_LIMIT_CEILING;
  return n;
}

/* ============================================================
 * THE SECRET — PRESENCE ONLY, NEVER THE VALUE
 * ============================================================ */

export interface SecretDisclosure {
  /** Whether a usable secret is present. NEVER the secret, NEVER a prefix, NEVER a length. */
  configured: boolean;
  /** True when a value is present but is a recognised placeholder. */
  placeholder: boolean;
  source: "environment" | "not set";
  envVarNames: string[];
  statement: string;
}

/**
 * Presence-only disclosure, following the precedent set by
 * `bridgeModeDisclosure()` in server/lib/wave15BridgeMode.ts, which reports its
 * inputs by presence and never by value.
 *
 * NOTHING in the returned object is derived from the secret's characters. There
 * is no branch anywhere in this module that can put a secret into a response.
 */
export function discloseReceiverSecret(): SecretDisclosure {
  const secret = resolveReceiverSecret();
  const present = secret.length > 0;
  const placeholder = present && isPlaceholderSecret(secret);
  return {
    configured: present && !placeholder,
    placeholder,
    source: present ? "environment" : "not set",
    envVarNames: [
      "COLLECTIVE_WEBHOOK_SECRET",
      "BRIDGE_OUTBOUND_HMAC_SECRET",
      "BRIDGE_INBOUND_HMAC_SECRET",
    ],
    statement: humanText(
      present
        ? placeholder
          ? "A signing secret is set in the host environment, but it is a placeholder value and is not usable."
          : "A signing secret is set in the host environment."
        : "No signing secret is set in the host environment.",
      "The secret is never stored here and never shown. Set it on the host, in one of the variables named above.",
    ),
  };
}

/* ============================================================
 * URL VALIDATION — using the REAL rules, never a re-typed copy
 * ============================================================ */

export interface UrlValidation {
  ok: boolean;
  /** Error-severity findings the candidate URL itself introduces. */
  problems: Array<{ code: string; message: string }>;
}

const URL_FINDING_CODES = new Set([
  "dead_host",
  "receiver_url_unparseable",
  "receiver_is_the_mock",
  "receiver_path_unknown",
]);

function urlErrorCodes(findings: BridgeEnvFinding[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of findings) {
    if (f.severity === "error" && URL_FINDING_CODES.has(f.code)) m.set(f.code, f.message);
  }
  return m;
}

/**
 * Validate a candidate receiver URL by asking the REAL `inspectBridgeEnv()`
 * what it thinks of it, then subtracting the problems that were already there
 * without it. Nothing about the dead host, the mock path or the real receiver
 * path is re-typed in this file, so this cannot drift from the real rules and no
 * endpoint is hardcoded.
 */
export function validateCandidateReceiverUrl(candidate: string): UrlValidation {
  const trimmed = candidate.trim();
  if (!trimmed) {
    /* Clearing the stored address is legitimate: it hands control back to the
       host environment fallback. It is not a validation failure. */
    return { ok: true, problems: [] };
  }
  const withoutCandidate = urlErrorCodes(
    inspectBridgeEnv({ ...process.env, COLLECTIVE_WEBHOOK_URL: "", BRIDGE_OUTBOUND_URL: "" }).findings,
  );
  const withCandidate = urlErrorCodes(
    inspectBridgeEnv({ ...process.env, COLLECTIVE_WEBHOOK_URL: trimmed, BRIDGE_OUTBOUND_URL: "" }).findings,
  );
  const problems: Array<{ code: string; message: string }> = [];
  withCandidate.forEach((message, code) => {
    if (!withoutCandidate.has(code)) problems.push({ code, message });
  });
  /* One rule the env inspector does not express, because env values are trusted
     to be typed by an engineer and this one is typed into a web form: the
     address must be an absolute http(s) URL. */
  let parsed: URL | null = null;
  try {
    parsed = new URL(trimmed);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    problems.push({
      code: "not_a_url",
      message: humanText("That is not a web address. Enter the full address, starting with https.", ""),
    });
  } else if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    problems.push({
      code: "not_http",
      message: humanText("The address must start with https (or http for a local test).", ""),
    });
  }
  return { ok: problems.length === 0, problems };
}

/* ============================================================
 * WRITES — audited through the EXISTING writer, no second path
 * ============================================================ */

export class Wave206ConfigRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "Wave206ConfigRefusal";
    this.code = code;
  }
}

export interface SetConfigResult {
  key: Wave206BridgeConfigKey;
  version: number;
  /** The stored value AFTER the write. Never a secret — none of these keys holds one. */
  storedValue: boolean | string | number;
  auditRecorded: boolean;
  statement: string;
}

/**
 * Set one of the three keys. Validates, writes through wave 11's hash-chained
 * writer, then records the change through wave 186's admin-audit writer. The
 * audit payload can never contain a secret because none of these keys holds
 * one.
 */
export function setWave206BridgeConfig(input: {
  key: string;
  /** Raw value from the request: boolean, string or number. */
  value: unknown;
  actorUserId: string;
  actorLabel: string;
  route: string;
}): SetConfigResult {
  ensureWave206BridgeConfigKeys();

  const key = input.key as Wave206BridgeConfigKey;
  if (!(WAVE206_BRIDGE_CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new Wave206ConfigRefusal(
      "UNKNOWN_CONFIG_KEY",
      humanText("That is not one of the bridge settings this screen can change.", ""),
    );
  }

  const before = readConfigRow(key);
  let valueJson: string;
  let storedValue: boolean | string | number;

  if (key === BRIDGE_DELIVERY_ENABLED_KEY) {
    /* Three real choices: on, off, or hand it back to the host environment. */
    const isUnset = input.value === UNSET_SENTINEL;
    if (typeof input.value !== "boolean" && !isUnset) {
      throw new Wave206ConfigRefusal(
        "EXPECTED_BOOLEAN",
        humanText('This setting is on or off. Send true, false, or "unset" to use the host environment instead.', ""),
      );
    }
    const stored: DeliveryEnabledStored = isUnset ? UNSET_SENTINEL : input.value === true ? "on" : "off";
    storedValue = stored;
    valueJson = JSON.stringify(stored);
    if (stored === "on") {
      /* Turning delivery on must not silently imply a destination. */
      const url = resolveReceiverUrlField();
      if (!url.value) {
        throw new Wave206ConfigRefusal(
          "NO_DESTINATION",
          humanText(
            "Delivery cannot be turned on while there is no address to deliver to.",
            "Set the Collective receiver address first, then turn delivery on.",
          ),
        );
      }
    }
  } else if (key === BRIDGE_RECEIVER_URL_KEY) {
    if (typeof input.value !== "string") {
      throw new Wave206ConfigRefusal(
        "EXPECTED_STRING",
        humanText("This setting is a web address. Send it as text.", ""),
      );
    }
    const trimmed = input.value.trim();
    /* Empty input and the literal sentinel both mean the same deliberate act:
       hand this setting back to the host environment. It is stored as the named
       sentinel so the screen can say so in words. */
    if (!trimmed || trimmed === UNSET_SENTINEL) {
      storedValue = UNSET_SENTINEL;
      valueJson = JSON.stringify(UNSET_SENTINEL);
    } else {
      const validation = validateCandidateReceiverUrl(trimmed);
      if (!validation.ok) {
        throw new Wave206ConfigRefusal(
          "RECEIVER_URL_REFUSED",
          validation.problems.map((p) => p.message).join(" "),
        );
      }
      storedValue = trimmed;
      valueJson = JSON.stringify(trimmed);
    }
  } else {
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      throw new Wave206ConfigRefusal(
        "EXPECTED_NUMBER",
        humanText("This setting is a whole number of events. Send it as a number.", ""),
      );
    }
    if (input.value === UNSET_BATCH_LIMIT) {
      /* Zero is the named sentinel: use the built-in default again. */
      storedValue = UNSET_BATCH_LIMIT;
      valueJson = JSON.stringify(UNSET_BATCH_LIMIT);
    } else {
      const clamped = clampBatchLimit(input.value);
      if (clamped !== Math.floor(input.value)) {
        throw new Wave206ConfigRefusal(
          "BATCH_LIMIT_OUT_OF_RANGE",
          humanText(
            `The limit must be between ${DRAIN_BATCH_LIMIT_FLOOR} and ${DRAIN_BATCH_LIMIT_CEILING} events per drain, or zero to use the built-in default.`,
            "",
          ),
        );
      }
      storedValue = clamped;
      valueJson = JSON.stringify(clamped);
    }
  }

  let row: ConfigRow;
  try {
    row = updatePlatformConfigValue({
      key,
      valueJson,
      changedBy: input.actorUserId,
      ...(before ? { expectedVersion: before.version } : {}),
    });
  } catch (err) {
    if (err instanceof PlatformConfigWriteError) {
      throw new Wave206ConfigRefusal(err.code ?? "CONFIG_WRITE_REFUSED", err.message);
    }
    throw err;
  }

  /* Wave 186's writer. No second audit path. Bearing is "identity" rather than
     "money": this changes who receives platform events, not an amount. */
  const entry = appendAdminAudit(
    input.actorUserId,
    key,
    "bridge_delivery_config_changed",
    {
      key,
      previousValue: before ? before.valueJson : null,
      newValue: valueJson,
      previousVersion: before?.version ?? null,
      newVersion: row.version,
      actor: input.actorLabel,
      /* No secret is involved: none of these three keys holds one. */
      secretInvolved: false,
    },
  );
  const outcome: boolean = reportAuditWriteOutcome(entry, {
    bearing: "identity",
    action: "bridge_delivery_config_changed",
    route: input.route,
    subject: key,
  });

  return {
    key,
    version: row.version,
    storedValue,
    auditRecorded: outcome,
    statement: humanText(
      "Saved. The database value is now the one in force for this setting.",
      "The host environment variable is still there as a fallback and was not changed.",
    ),
  };
}

/* ============================================================
 * THE WHOLE PICTURE, FOR THE SCREEN
 * ============================================================ */

export interface DeliveryConfigReport {
  deliveryEnabled: ResolvedField<boolean>;
  receiverUrl: ResolvedField<string>;
  drainBatchLimit: ResolvedField<number>;
  secret: SecretDisclosure;
  /** May the owner-initiated drain deliver right now, and if not, why not. */
  mayDeliver: boolean;
  mayDeliverReason: string;
  /** The real bridge-environment findings. Codes, names and booleans only — no values. */
  envFindings: Array<{ severity: string; code: string; message: string }>;
  envOk: boolean;
  envOutboundConfigured: boolean;
  /** Stated plainly so nobody reads the database flag as "the worker is now running". */
  workerNote: string;
}

export function describeDeliveryConfig(): DeliveryConfigReport {
  ensureWave206BridgeConfigKeys();
  const deliveryEnabled = resolveDeliveryEnabled();
  const receiverUrl = resolveReceiverUrlField();
  const drainBatchLimit = resolveDrainBatchLimit();
  const secret = discloseReceiverSecret();
  const env = inspectBridgeEnv();

  let mayDeliver = true;
  let why = "Ready. An owner-initiated drain would deliver, up to the batch limit.";
  if (!deliveryEnabled.value) {
    mayDeliver = false;
    why = "Delivery is off. A drain will refuse and nothing will be sent.";
  } else if (!receiverUrl.value) {
    mayDeliver = false;
    why = "No address is set, here or in the host environment, so a drain has nowhere to send.";
  } else if (!secret.configured) {
    mayDeliver = false;
    why = secret.placeholder
      ? "The signing secret in the host environment is a placeholder, so deliveries could not be signed."
      : "No signing secret is set in the host environment, so deliveries could not be signed.";
  }

  return {
    deliveryEnabled,
    receiverUrl,
    drainBatchLimit,
    secret,
    mayDeliver,
    mayDeliverReason: humanText(why, ""),
    envFindings: env.findings.map((f) => ({ severity: f.severity, code: f.code, message: f.message })),
    envOk: env.ok,
    envOutboundConfigured: env.outboundConfigured,
    workerNote: humanText(
      "Turning delivery on here does not start the background sender and does not send the queued events.",
      "The queue only moves when you run a drain yourself, and a drain is limited to the batch size above.",
    ),
  };
}
