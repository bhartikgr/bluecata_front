/**
 * server/lib/wave192PlatformTruthSurface.ts
 *
 * WAVE 192 · ITEM A · R164 — MAKING THE UNKNOWABLE KNOWABLE.
 *
 * ══ WHY THIS MODULE EXISTS ═══════════════════════════════════════════════════
 * Three separate near-misses in one week shared one shape: a SAFETY-CRITICAL
 * STATE WITH NO SURFACE THAT STATES IT. Each cost real time and each produced at
 * least one wrong report from the owner.
 *
 *   1. Whether the audit ledger is recording. It had written nothing for three
 *      months and nothing on the platform reported it. Wave 186 closed this:
 *      `getAuditWriteHealth()` + `GET /api/admin/audit-write-health` + the
 *      "Is this ledger still recording?" card.
 *   2. Whether the payment gateway is really configured. The owner reported
 *      Airwallex unset FOUR TIMES, each time reading `bridgeEnvOk` from
 *      `/api/healthz` — a field about the outbound BRIDGE, on an endpoint that
 *      contains no Airwallex field of any kind. Wave 190 closed this:
 *      `paymentGatewayDisclosure()` + `GET /api/admin/payment-gateway/disclosure`.
 *   3. Whether the dev identity bypass is off. **Nothing states it.** This is
 *      the one that was still unknowable, and it is the most security-sensitive
 *      state on the platform.
 *
 * ══ THIS MODULE ADDS NO SECOND IMPLEMENTATION OF 1 OR 2 ══════════════════════
 * It CALLS wave 186's `getAuditWriteHealth()` and wave 190's
 * `paymentGatewayDisclosure()` and PROJECTS their answers to states. It does not
 * re-read `audit_log`, does not re-list the gateway variables, and does not
 * recompute either health rule. If wave 186 changes what "stale" means, this
 * surface changes with it, because it is the same function.
 *
 * ══ THE ONE GENUINELY NEW FACT: THE DEV IDENTITY BYPASS ══════════════════════
 * `server/lib/userContext.ts` is SACRED and is NOT edited, imported for its
 * behaviour, or altered in any way by this wave. It is quoted here so the surface
 * and the code it reports on can be compared by eye. In
 * `resolvePersonaIdWithFallback(req)`:
 *
 *     const isProd = process.env.NODE_ENV === "production";
 *     const bypassDisabled = process.env.DISABLE_DEV_BYPASS === "1";
 *     if (isProd || bypassDisabled) return null;
 *
 * and when neither holds, an unauthenticated request is resolved to a seeded
 * identity — `u_maya_chen` for `as=founder`, `u_admin` for `as=admin`, otherwise
 * `u_aisha_patel`. **So the entire protection is one environment variable**, and
 * before this module nothing on the platform stated whether it was set.
 *
 * THIS MODULE RE-DERIVES THE SAME TWO CONDITIONS FROM THE SAME TWO VARIABLES.
 * It deliberately does NOT import a predicate out of the sacred file, because
 * doing so would require editing it. The duplication is two `===` comparisons
 * against literals that are quoted above; a test asserts the reported state
 * matches for `NODE_ENV` both equal to and not equal to `"production"`.
 *
 * ══ READ-ONLY. NO AUTH BEHAVIOUR CHANGES. ═══════════════════════════════════
 * Nothing here sets an environment variable, writes a row, resolves an identity,
 * grants or denies a request, or is consulted by any auth path. It REPORTS.
 * R164 is explicit that if the bypass were found reachable in a way the code
 * comments do not describe, the correct action is to STOP and report rather than
 * to fix it, because that is an owner-level security decision. It was NOT found
 * to be so reachable: the condition behaves exactly as R164.1 describes.
 *
 * ══ NO CREDENTIAL VALUE LEAVES THIS MODULE. EVER. ═══════════════════════════
 * Every field of `PlatformTruth` is a boolean, a small closed-set string, a row
 * COUNT or an ISO timestamp. No environment variable value is read into a
 * variable that outlives a comparison, returned, logged, echoed into an error,
 * reflected in a length, or hinted at by a prefix or suffix.
 *
 * Three specific guards, each of which is a way a leak could have happened:
 *   · `NODE_ENV` is NEVER returned raw. It is mapped to a four-value derived
 *     state, so an operator who sets it to something containing a secret cannot
 *     have it echoed back.
 *   · `AuditWriteHealth.readError` is NOT forwarded. It is a driver error string
 *     and can contain a filesystem path. The `status` enum already carries the
 *     fact ("unreadable") without the string.
 *   · Wave 190's disclosure is projected FIELD BY NAME rather than spread, so a
 *     field added upstream later cannot ride out to this consumer unreviewed.
 *
 * A test asserts that no planted credential value appears anywhere in the
 * serialised response body.
 *
 * ══ MONEY ═══════════════════════════════════════════════════════════════════
 * No amount, fee, price or currency is reported. No arithmetic is performed and
 * no numeric coercion (`Number`, `parseInt`, `parseFloat`) is called. The only
 * numbers that appear are ROW COUNTS and an AGE IN SECONDS, neither of which is
 * money.
 */
import { getAuditWriteHealth } from "../adminPlatformStore";
import { paymentGatewayDisclosure } from "./wave190PaymentGatewayDisclosure";
import { log } from "./logger";

/** The verbatim platform standard, matching `client/src/pages/admin/PlatformSurfaces.tsx`
 *  (rendered there at the Bridge-mode and payment-gateway panels). One spelling,
 *  so the promise cannot drift between the two surfaces that make it. */
export const WAVE192_PRESENCE_ONLY_STANDARD =
  "Presence only — credential values are never returned by the API or rendered here.";

/**
 * `NODE_ENV` as a CLOSED SET, never the raw value.
 *
 * `other_or_unset` covers both "not set at all" and "set to something this
 * platform does not recognise", and those two are deliberately NOT
 * distinguished: distinguishing them adds nothing an operator can act on, and
 * the only way to report the unrecognised case precisely would be to echo the
 * value.
 */
export type NodeEnvState = "production" | "development" | "test" | "other_or_unset";

export function nodeEnvState(): NodeEnvState {
  const raw = process.env.NODE_ENV;
  if (raw === "production") return "production";
  if (raw === "development") return "development";
  if (raw === "test") return "test";
  return "other_or_unset";
}

/**
 * THE BYPASS STATE. Three booleans, and the alarm is one of them.
 *
 * `active` re-derives `!(isProd || bypassDisabled)` from the same two variables
 * the sacred file reads — see the header for the quoted original.
 *
 * `alarm` is NOT the same question as `active`. A bypass that is active on a
 * developer's laptop is the intended design; a bypass that is active anywhere
 * else is the single most security-sensitive state on the platform. So the alarm
 * fires when the bypass is active and `NODE_ENV` is not `development` — which
 * includes the unset case, because an unset `NODE_ENV` in a deployed environment
 * is exactly the accident R164.2 is about.
 */
export interface DevIdentityBypassState {
  /** Unauthenticated requests resolve to a seeded identity. */
  active: boolean;
  /** `DISABLE_DEV_BYPASS === "1"` — the explicit off switch, set or not. */
  disableDevBypassSet: boolean;
  /** `NODE_ENV === "production"` — the implicit off switch. */
  nodeEnvIsProduction: boolean;
  /** Active somewhere it should not be. An ALARM, not a neutral field. */
  alarm: boolean;
  /** What to do about it, in words, when the alarm is on. Never a code. */
  statement: string;
}

/** What the alarm says. Prose, present tense, no ALL-CAPS underscore code, and
 *  it names the variable to set rather than describing a state of affairs. */
export const WAVE192_BYPASS_ALARM_STATEMENT =
  "The development identity bypass is ACTIVE and this is not a development environment: " +
  "an unauthenticated request to this platform is being resolved to a seeded identity, " +
  "including an administrator one. Set DISABLE_DEV_BYPASS to 1, or set NODE_ENV to production, " +
  "and restart the process. Nothing else on this platform reports this state.";

export const WAVE192_BYPASS_ACTIVE_DEV_STATEMENT =
  "The development identity bypass is active. NODE_ENV is development, so this is the intended " +
  "local behaviour: an unauthenticated request resolves to a seeded identity. It must not reach a " +
  "deployed environment in this state.";

export const WAVE192_BYPASS_OFF_STATEMENT =
  "The development identity bypass is OFF. An unauthenticated request resolves to no identity, so " +
  "every request must carry its own authentication.";

export function devIdentityBypassState(): DevIdentityBypassState {
  /* The two comparisons the sacred file makes, made again here against the same
     literals. The VALUES are compared and discarded in the same expression;
     neither is bound to a variable that outlives the comparison. */
  const nodeEnvIsProduction = process.env.NODE_ENV === "production";
  const disableDevBypassSet = process.env.DISABLE_DEV_BYPASS === "1";
  const active = !(nodeEnvIsProduction || disableDevBypassSet);
  const env = nodeEnvState();
  const alarm = active && env !== "development";
  return {
    active,
    disableDevBypassSet,
    nodeEnvIsProduction,
    alarm,
    statement: !active
      ? WAVE192_BYPASS_OFF_STATEMENT
      : alarm
        ? WAVE192_BYPASS_ALARM_STATEMENT
        : WAVE192_BYPASS_ACTIVE_DEV_STATEMENT,
  };
}

/** Wave 186's answer, projected to STATE ONLY. `readError` is dropped on
 *  purpose — see the header. Every field here already exists on
 *  `AuditWriteHealth`; none is recomputed. */
export interface AuditLedgerTruth {
  /** Wave 186's own verdict. */
  ok: boolean;
  /** Wave 186's own enum: healthy | stale | failing | unreadable. */
  status: string;
  newestRowAt: string | null;
  newestRowAgeSeconds: number | null;
  rowsTotal: number | null;
  writesOkSinceBoot: number;
  writeFailuresSinceBoot: number;
  staleAfterHours: number;
  /** True when the ledger's own state is one an operator must act on. */
  alarm: boolean;
}

/** Wave 190's answer, projected to STATE ONLY, field by name rather than
 *  spread. Variable NAMES and present/absent booleans; a name is not a secret
 *  and wave 190 already established that. */
export interface PaymentGatewayTruth {
  gateway: string;
  mode: string;
  allRequiredPresent: boolean;
  /** The NAMES of absent required variables. Names, never values. */
  missingRequired: string[];
  inputs: Array<{ name: string; present: boolean; required: boolean }>;
  webhooksReadable: boolean;
  webhooksEverReceived: boolean;
  webhookCount: number | null;
  /** True when a required variable is absent. */
  alarm: boolean;
}

export interface PlatformTruth {
  /** The verbatim presence-only standard, carried on the payload so a consumer
   *  cannot render this surface without the promise attached. */
  presenceOnlyStandard: string;
  nodeEnvState: NodeEnvState;
  devIdentityBypass: DevIdentityBypassState;
  auditLedger: AuditLedgerTruth | null;
  paymentGateway: PaymentGatewayTruth | null;
  /** Which sub-surfaces could not be read at all. Names of surfaces, not errors. */
  unreadable: string[];
  /** True when ANY sub-surface is in an alarm state. One field an operator can
   *  watch, which is the whole point: the audit ledger was silent for three
   *  months because there was no single field to watch. */
  anyAlarm: boolean;
  generatedAt: string;
}

/**
 * THE WHOLE SURFACE, in one read.
 *
 * FAIL-VISIBLE, NOT FAIL-SILENT. If a sub-producer throws, its section is
 * `null` and its name is added to `unreadable` — the surface says "I could not
 * read this" rather than reporting a healthy-looking default. A truth surface
 * that guesses is worse than no truth surface, which is the lesson of all three
 * near-misses this wave is about. The caught error is logged and NOT returned:
 * on a surface about credentials, returning a caught message is a habit worth
 * not having (wave 190's reasoning, adopted verbatim).
 */
export function platformTruth(now?: Date): PlatformTruth {
  const unreadable: string[] = [];

  let auditLedger: AuditLedgerTruth | null = null;
  try {
    const h = getAuditWriteHealth(now);
    auditLedger = {
      ok: h.ok,
      status: h.status,
      newestRowAt: h.newestRowAt ?? null,
      newestRowAgeSeconds: h.newestRowAgeSeconds ?? null,
      rowsTotal: h.rowsTotal ?? null,
      writesOkSinceBoot: h.writesOkSinceBoot,
      writeFailuresSinceBoot: h.writeFailuresSinceBoot,
      staleAfterHours: h.staleAfterHours,
      alarm: h.ok !== true,
    };
  } catch (err) {
    log.error(`[w192-platform-truth] audit-write health unreadable: ${String(err)}`);
    unreadable.push("audit_ledger");
  }

  let paymentGateway: PaymentGatewayTruth | null = null;
  try {
    const d = paymentGatewayDisclosure();
    paymentGateway = {
      gateway: d.gateway,
      mode: d.mode,
      allRequiredPresent: d.allRequiredPresent,
      missingRequired: d.missingRequired.slice(),
      inputs: d.inputs.map((i) => ({ name: i.name, present: i.present, required: i.required })),
      webhooksReadable: d.webhooks.readable,
      webhooksEverReceived: d.webhooks.everReceived,
      webhookCount: d.webhooks.count ?? null,
      alarm: d.allRequiredPresent !== true,
    };
  } catch (err) {
    log.error(`[w192-platform-truth] payment-gateway disclosure unreadable: ${String(err)}`);
    unreadable.push("payment_gateway");
  }

  const bypass = devIdentityBypassState();
  return {
    presenceOnlyStandard: WAVE192_PRESENCE_ONLY_STANDARD,
    nodeEnvState: nodeEnvState(),
    devIdentityBypass: bypass,
    auditLedger,
    paymentGateway,
    unreadable,
    anyAlarm:
      bypass.alarm ||
      auditLedger?.alarm === true ||
      paymentGateway?.alarm === true ||
      unreadable.length > 0,
    generatedAt: (now ?? new Date()).toISOString(),
  };
}

/**
 * THE THREE BOOLEANS `/api/healthz` CARRIES.
 *
 * WHY ON HEALTHZ AND NOT ONLY BEHIND `requireAdmin`. `/api/healthz` is public
 * and unauthenticated, and that is precisely the argument: **when the identity
 * bypass is active, "ask an admin endpoint" is circular** — the bypass is what
 * defeats the check that would gate the answer. An alarm nobody can read without
 * passing through the thing that is broken is not an alarm. R164.2 item 2 asks
 * for healthz specifically.
 *
 * WHY ONLY THREE BOOLEANS. Everything else on this surface is operational detail
 * that already has an admin-gated endpoint of its own (waves 186 and 190), so
 * publishing it unauthenticated would widen exposure for no gain. These three
 * disclose nothing an attacker could not learn by sending one unauthenticated
 * request and observing which persona answers — the state is already externally
 * observable; what was missing was the platform SAYING it.
 */
export interface HealthzBypassFields {
  devIdentityBypassActive: boolean;
  disableDevBypassSet: boolean;
  devIdentityBypassAlarm: boolean;
}

export function healthzBypassFields(): HealthzBypassFields {
  const b = devIdentityBypassState();
  return {
    devIdentityBypassActive: b.active,
    disableDevBypassSet: b.disableDevBypassSet,
    devIdentityBypassAlarm: b.alarm,
  };
}
