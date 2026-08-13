/**
 * server/lib/wave15BridgeMode.ts
 *
 * WAVE 15 — A-3b: "flip the Collective bridge from mock to live".
 *
 * THIS WAVE DOES NOT FLIP IT, DELIBERATELY, AND SAYS SO.
 *
 * A-3b is marked owner_decision = Y and is blocked on GATE-A3. Flipping the
 * bridge to live points a real webhook at a real counterparty and starts
 * emitting real events; that is an owner's call about a production integration,
 * not a build agent's. Two further facts settle it:
 *   1. `LIVE_MODE` is derived, not stored: `server/lib/bridgeRuntime.ts:44-56`
 *      computes it from `COLLECTIVE_WEBHOOK_URL` + `COLLECTIVE_WEBHOOK_SECRET`.
 *      There is no flag in the database to set — the flip IS supplying
 *      production credentials, which this agent does not have and must not
 *      invent.
 *   2. `server/lib/bridgeRuntime.ts` is SACRED (`sacred_baseline/SACRED_SHA256.txt`).
 *
 * SO WHAT IS DELIVERED IS THE PART THAT IS NOT THE OWNER'S DECISION:
 *   - `bridgeModeDisclosure()` — the CURRENT mode, WHICH input is missing, and
 *     what would change on flip. Previously `bridgeHealth().mode` reported
 *     "mock" with no explanation of why or of what to supply; an operator could
 *     not tell a deliberate mock from a misconfiguration.
 *   - an OPEN `build_policy_decision` row for GATE-A3 (migration 0171) so the
 *     open question is durable and queryable instead of living in a report file.
 *   - `assertNoWave15ModeMutation()` — a FENCE proving no Wave 15 file sets
 *     either credential env var. Without it, "we did not flip it" is an
 *     assertion; with it, it is checked, and the test proves the fence FAILS
 *     when a mutation is introduced.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { rawDb } from "../db/connection";
import { bridgeHealth } from "./bridgeRuntime";
import { log } from "./logger";

export const GATE_A3_ID = "GATE-A3";

/** The two env inputs that, together, derive LIVE_MODE. */
export const BRIDGE_LIVE_INPUTS: readonly string[] = Object.freeze([
  "COLLECTIVE_WEBHOOK_URL",
  "COLLECTIVE_WEBHOOK_SECRET",
]);

export interface BridgeModeDisclosure {
  /** "live" | "mock" | "disabled" — read from the sacred runtime, not recomputed. */
  mode: string;
  /** Per-input presence. Values are NEVER returned, only presence. */
  inputs: Array<{ name: string; present: boolean }>;
  /** Inputs that are missing; empty when mode is live. */
  missing: string[];
  /** True when the mode is mock/disabled ONLY because credentials are absent. */
  blockedOnCredentials: boolean;
  gateId: string;
  gateStatus: string;
  gateRationale: string;
  ownerDecisionRequired: boolean;
  effectOfFlip: string[];
}

export function bridgeModeDisclosure(): BridgeModeDisclosure {
  const inputs = BRIDGE_LIVE_INPUTS.map((name) => ({
    name,
    // Presence only. A secret must not leave the process because an admin
    // screen wanted to explain a configuration.
    present: !!(process.env[name] && String(process.env[name]).trim().length > 0),
  }));
  const missing = inputs.filter((i) => !i.present).map((i) => i.name);

  let mode = "unknown";
  try {
    mode = String((bridgeHealth() as any).mode ?? "unknown");
  } catch (err) {
    log.warn(`[w15-bridge-mode] bridgeHealth failed: ${String(err)}`);
  }

  let gateStatus = "open";
  let gateRationale = "";
  try {
    const row = rawDb()
      .prepare(`SELECT status, rationale FROM build_policy_decision WHERE decision_key = ?`)
      .get(GATE_A3_ID) as { status?: string; rationale?: string } | undefined;
    if (row?.status) gateStatus = row.status;
    if (row?.rationale) gateRationale = row.rationale;
  } catch (err) {
    log.warn(`[w15-bridge-mode] gate read failed: ${String(err)}`);
  }

  return {
    mode,
    inputs,
    missing,
    blockedOnCredentials: mode !== "live" && missing.length > 0,
    gateId: GATE_A3_ID,
    gateStatus,
    gateRationale,
    ownerDecisionRequired: gateStatus === "open",
    effectOfFlip: [
      "Outbound envelopes are POSTed to COLLECTIVE_WEBHOOK_URL instead of being retained in the mock outbox.",
      "Inbound envelopes are HMAC-verified against COLLECTIVE_WEBHOOK_SECRET; unsigned test posts stop being accepted.",
      "Delivery failures begin accruing in the real dead-letter queue and count against bridge health.",
    ],
  };
}

/* ==========================================================================
 * THE FENCE.
 * ======================================================================== */

const WAVE15_FILE_PREFIX = "wave15";

function listWave15Sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        /* `__tests__` is excluded for a REASON that must not be forgotten: the
         * fence's own falsification test writes a fixture containing a real
         * assignment, and the assertion that the fence FAILS on that fixture is
         * the thing that proves the fence works. Scanning the test tree would
         * make the fence report its own proof as a violation. Excluding it is
         * therefore not a loophole for shipping a mutation — nothing in
         * `__tests__` runs in production — but it IS the kind of exclusion that
         * hides a real defect if widened, so it is narrow and named. */
        if (e === "node_modules" || e === "public" || e === "assets" || e === "dist" || e === "__tests__") continue;
        walk(p, depth + 1);
      } else if (
        (e.startsWith(WAVE15_FILE_PREFIX) || e.startsWith("founderNotificationPrefs")) &&
        (e.endsWith(".ts") || e.endsWith(".tsx"))
      ) {
        out.push(p);
      }
    }
  };
  walk(root, 0);
  return out;
}

export interface ModeMutationCheck {
  ok: boolean;
  filesScanned: number;
  violations: Array<{ file: string; line: number; text: string }>;
}

/**
 * Prove that nothing this wave wrote assigns either bridge credential.
 *
 * @param root repo root to scan. Injectable so the test can point the SAME
 *   function at a fixture containing a violation and watch it return ok=false —
 *   without that, a fence that always passes is indistinguishable from a fence
 *   that checks nothing, which is the failure mode this rule exists for.
 */
export function assertNoWave15ModeMutation(root: string): ModeMutationCheck {
  const files = listWave15Sources(root);
  const violations: ModeMutationCheck["violations"] = [];
  // Matches `process.env.COLLECTIVE_WEBHOOK_URL =` and the bracket form.
  const patterns = BRIDGE_LIVE_INPUTS.flatMap((name) => [
    new RegExp(`process\\.env\\.${name}\\s*=[^=]`),
    new RegExp(`process\\.env\\[\\s*['"\`]${name}['"\`]\\s*\\]\\s*=[^=]`),
  ]);
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      /* Skip comment lines. A `//` or `*` line cannot assign anything, and the
       * disclosure module has to be able to WRITE DOWN the pattern it forbids
       * without tripping over itself. Anything that is not a comment is
       * scanned, so a real assignment cannot hide behind this. */
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (patterns.some((re) => re.test(lines[i]))) {
        violations.push({ file: f, line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
  }
  return { ok: violations.length === 0, filesScanned: files.length, violations };
}
