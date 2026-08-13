/**
 * server/lib/founderNotificationPrefs.ts
 *
 * WAVE 15 — ORP-033 / DEF-033. Make founder notification preferences REAL.
 *
 * SINK: `founder_notification_preference` (migration 0170). Wave 14 created the
 * table, named THIS FILE and THIS EXPORT in the migration comment
 * ("validated against a server-side allowlist … NOTIFICATION_PREF_KEYS"), and
 * then wrote no code: zero readers, zero writers tree-wide.
 *
 * WHAT WAS ACTUALLY BROKEN (verified at source, not from the citation):
 *   1. client/src/pages/founder/Settings.tsx rendered ten `<Switch>` controls
 *      with `defaultChecked` and NO handler and NO query — a founder's choice
 *      was neither saved nor read back. An honest amber banner said so.
 *   2. server/notificationsStore.ts:287,298 DOES expose GET/PATCH
 *      /api/notifications/preferences over a per-kind map. That store is
 *      SACRED. Critically, `emitNotification` (:142) NEVER READS
 *      `preferences` — so wiring the switches to that surface would have saved
 *      a preference that changes nothing, which is worse than the honest
 *      banner. This was the "fix where the data flows" trap for this item.
 *
 * THEREFORE the preference is stored HERE (the table Wave 14 provided for it)
 * and is ENFORCED at the only editable suppression boundary that exists:
 * `server/lib/notificationCadence.ts` `evaluateCadence()`, which already
 * returns an allow/deny decision and is not sacred. `emitWithCadence` callers
 * therefore honour the preference. Direct `emitNotification` callers do not,
 * and that residue is REPORTED by `enforcementCoverage()` and rendered in the
 * UI as a count — not glossed over with a "preferences are live" claim.
 *
 * CRITICAL ALERTS CANNOT BE SUPPRESSED. Two independent fences, deliberately:
 *   - the route/engine refuses to store `enabled=0` for a locked key, and
 *   - `locked = 0 OR enabled = 1` is a DB CHECK from 0170, so ANY future writer
 *     hits it too. That is the second path, and the test kills both.
 */
import { randomUUID } from "crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";
import type { NotificationKind } from "../notificationsStore";

export class NotificationPrefError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "NotificationPrefError";
  }
}

export type PrefChannel = "in_app" | "email" | "webhook";
export const PREF_CHANNELS: readonly PrefChannel[] = Object.freeze(["in_app", "email", "webhook"] as const);

export interface PrefKeyDef {
  key: string;
  label: string;
  /** The notification kinds this switch governs. The MAPPING is the wiring. */
  kinds: readonly NotificationKind[];
  /** Security/critical: cannot be disabled. Enforced twice (route + DB CHECK). */
  locked: boolean;
  defaultEnabled: boolean;
}

/**
 * THE ALLOWLIST — the fence migration 0170 delegated to this file, so adding a
 * switch needs no migration. Every key maps to REAL `NotificationKind` members
 * from server/notificationsStore.ts `ALL_NOTIFICATION_KINDS`; a key that mapped
 * to an invented kind would be a preference over nothing, so
 * `assertPrefKeysMapToRealKinds()` below proves the mapping at runtime and the
 * test suite proves it fails when a bogus kind is introduced.
 */
export const NOTIFICATION_PREF_KEYS: readonly PrefKeyDef[] = Object.freeze([
  {
    key: "dataroom.file_opened",
    label: "Investor opens a dataroom file",
    kinds: ["dataroom.access_granted", "dataroom.document_uploaded"],
    locked: false,
    defaultEnabled: true,
  },
  {
    key: "round.invitation_accepted",
    label: "Investor accepts an invitation",
    kinds: ["round.invitation_accepted", "round.invitation_declined"],
    locked: false,
    defaultEnabled: true,
  },
  {
    key: "round.soft_circle_received",
    label: "Soft-circle commitment is made",
    kinds: ["round.soft_circle_received"],
    locked: false,
    defaultEnabled: true,
  },
  {
    key: "round.document_signature",
    label: "Document ready to sign / signed",
    kinds: ["round.document_ready_to_sign", "round.document_signed"],
    locked: false,
    defaultEnabled: true,
  },
  {
    key: "round.closed",
    label: "Round close milestone reached",
    kinds: ["round.closed"],
    // CRITICAL: a founder must not be able to mute the close of their own round.
    locked: true,
    defaultEnabled: true,
  },
  {
    key: "investor_report.published",
    label: "Investor report published",
    kinds: ["investor_report.published"],
    locked: false,
    defaultEnabled: true,
  },
  {
    key: "message.received",
    label: "New message received",
    kinds: ["message.received"],
    locked: false,
    defaultEnabled: true,
  },
] as const) as readonly PrefKeyDef[];

const KEY_INDEX: ReadonlyMap<string, PrefKeyDef> = new Map(NOTIFICATION_PREF_KEYS.map((d) => [d.key, d]));

/** Reverse index: notification kind -> the pref key that governs it. */
const KIND_TO_KEY: ReadonlyMap<string, PrefKeyDef> = (() => {
  const m = new Map<string, PrefKeyDef>();
  for (const d of NOTIFICATION_PREF_KEYS) for (const k of d.kinds) m.set(k, d);
  return m;
})();

/**
 * Prove every allowlisted key maps to kinds the notification store actually
 * emits. A preference over a kind that does not exist is a switch over nothing —
 * exactly the class of defect this item is fixing.
 *
 * @returns unknown kind names, empty when the mapping is sound.
 */
export function assertPrefKeysMapToRealKinds(allKinds: readonly string[]): string[] {
  const known = new Set(allKinds);
  const bad: string[] = [];
  for (const d of NOTIFICATION_PREF_KEYS) {
    for (const k of d.kinds) if (!known.has(k)) bad.push(`${d.key}->${k}`);
  }
  return bad;
}

export interface PrefRow {
  key: string;
  label: string;
  locked: boolean;
  channels: Record<PrefChannel, boolean>;
  /** true when at least one channel is an explicit stored row, not a default. */
  explicit: boolean;
}

function tableReady(): boolean {
  try {
    const r = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='founder_notification_preference'`)
      .get();
    return !!r;
  } catch {
    return false;
  }
}

/**
 * The founder's effective preferences. ABSENCE means platform default — there is
 * no seeded row and no NOT NULL default that could silently opt anyone in
 * (0170's own reasoning), so the defaults live in the allowlist above.
 */
export function listPreferences(userId: string): PrefRow[] {
  const stored = new Map<string, boolean>();
  if (tableReady()) {
    try {
      const rows = rawDb()
        .prepare(`SELECT pref_key, channel, enabled FROM founder_notification_preference WHERE user_id = ?`)
        .all(userId) as any[];
      for (const r of rows) stored.set(`${r.pref_key}|${r.channel}`, !!r.enabled);
    } catch (err) {
      log.warn(`[w15-notif-prefs] read failed for ${userId}: ${String(err)}`);
    }
  }
  return NOTIFICATION_PREF_KEYS.map((d) => {
    const channels = {} as Record<PrefChannel, boolean>;
    let explicit = false;
    for (const ch of PREF_CHANNELS) {
      const hit = stored.get(`${d.key}|${ch}`);
      if (hit !== undefined) explicit = true;
      channels[ch] = d.locked ? true : (hit ?? d.defaultEnabled);
    }
    return { key: d.key, label: d.label, locked: d.locked, channels, explicit };
  });
}

/**
 * Set one (key, channel) preference.
 *
 * @throws {NotificationPrefError} NOTIFICATION_PREF_UNKNOWN_KEY — not on the allowlist.
 * @throws {NotificationPrefError} NOTIFICATION_PREF_BAD_CHANNEL
 * @throws {NotificationPrefError} NOTIFICATION_PREF_LOCKED — attempt to disable a
 *   critical alert. The DB CHECK `locked = 0 OR enabled = 1` refuses it too.
 */
export function setPreference(args: {
  userId: string;
  prefKey: string;
  channel: string;
  enabled: boolean;
  actorId: string;
}): PrefRow[] {
  const def = KEY_INDEX.get(args.prefKey);
  if (!def) {
    throw new NotificationPrefError(
      "NOTIFICATION_PREF_UNKNOWN_KEY",
      `NOTIFICATION_PREF_UNKNOWN_KEY: ${args.prefKey}. Allowed: ${NOTIFICATION_PREF_KEYS.map((d) => d.key).join(", ")}`,
    );
  }
  if (!(PREF_CHANNELS as readonly string[]).includes(args.channel)) {
    throw new NotificationPrefError(
      "NOTIFICATION_PREF_BAD_CHANNEL",
      `NOTIFICATION_PREF_BAD_CHANNEL: ${args.channel}. Allowed: ${PREF_CHANNELS.join(", ")}`,
    );
  }
  if (def.locked && !args.enabled) {
    throw new NotificationPrefError(
      "NOTIFICATION_PREF_LOCKED",
      `NOTIFICATION_PREF_LOCKED: ${args.prefKey} is a critical alert and cannot be suppressed.`,
    );
  }
  rawDb()
    .prepare(
      `INSERT INTO founder_notification_preference
         (id, user_id, pref_key, channel, enabled, locked, updated_at, updated_by)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, pref_key, channel) DO UPDATE SET
         enabled=excluded.enabled, locked=excluded.locked,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    )
    .run(
      `fnp_${randomUUID()}`,
      args.userId,
      args.prefKey,
      args.channel,
      args.enabled ? 1 : 0,
      def.locked ? 1 : 0,
      new Date().toISOString(),
      args.actorId,
    );
  return listPreferences(args.userId);
}

/**
 * THE ENFORCEMENT READ. Called from `evaluateCadence()`.
 *
 * @returns true when this kind may be delivered to this user on this channel.
 *   Unknown kinds (not governed by any switch) return true: a preference the
 *   founder was never offered must not silently mute a notification.
 */
export function isKindEnabled(userId: string, kind: string, channel: PrefChannel = "in_app"): boolean {
  const def = KIND_TO_KEY.get(kind);
  if (!def) return true;
  if (def.locked) return true;
  if (!tableReady()) return def.defaultEnabled;
  try {
    const row = rawDb()
      .prepare(
        `SELECT enabled FROM founder_notification_preference
          WHERE user_id = ? AND pref_key = ? AND channel = ?`,
      )
      .get(userId, def.key, channel) as { enabled?: number } | undefined;
    if (!row || row.enabled === undefined || row.enabled === null) return def.defaultEnabled;
    return !!row.enabled;
  } catch (err) {
    // Fail OPEN: a read failure must not silently mute a founder's alerts.
    log.warn(`[w15-notif-prefs] isKindEnabled failed (${userId}/${kind}): ${String(err)}`);
    return true;
  }
}

export interface EnforcementCoverage {
  /** Kinds governed by a switch. */
  governedKinds: number;
  /** Total kinds the store can emit. */
  totalKinds: number;
  /** Where enforcement happens. */
  enforcedAt: string;
  /**
   * The HONEST residue: emitters that call `emitNotification` directly bypass
   * the cadence gate and therefore bypass the preference. The number is passed
   * in by the caller (the test measures it by grep) so the UI can state it
   * instead of implying full coverage.
   */
  note: string;
}

export function enforcementCoverage(totalKinds: number): EnforcementCoverage {
  return {
    governedKinds: KIND_TO_KEY.size,
    totalKinds,
    enforcedAt: "server/lib/notificationCadence.ts evaluateCadence()",
    note:
      "Preferences are enforced for notifications routed through the cadence gate " +
      "(emitWithCadence). Emitters that call emitNotification directly are not gated; " +
      "server/notificationsStore.ts is SACRED and cannot be edited to close that path.",
  };
}
