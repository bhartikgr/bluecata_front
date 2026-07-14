/**
 * W3 #9 — Privacy Visibility Bridge (NON-SACRED).
 *
 * `/api/investors/:id/privacy` PATCH lives in the SACRED `server/profileStore.ts`
 * (lines ~741-769). It writes the investor profile's `visibility` block and
 * emits a `privacy.visibility.changed` outbox event, but it does NOT write
 * `profilestore_user_privacy` — the table the sacred `resolveDisplayName()`
 * policy engine (`server/lib/userPrivacyResolver.ts`) actually reads. Two
 * privacy stores exist and diverge (see ROADMAP_SPEC_SECURITY.md §7.2, Bypass
 * P7 in §7.4).
 *
 * This bridge closes that gap WITHOUT touching either sacred file: it
 * consumes the (already-exported, read-only) `profileStore._testAccess.outbox`
 * array for unprocessed `privacy.visibility.changed` / `investor` events and
 * mirrors them into the resolver-backed store via `writeUserPrivacy()`.
 *
 * Mapping (spec §7.2):
 *   visibility.visibleToCoMembers        -> visibleToCoMembers
 *   visibility.visibleToCollectiveNetwork -> visibleInCollectiveDirectory
 *   role.screenName / visibility.screenNameSet -> screenName WHEN PRESENT
 *
 * The outbox payload for this event only carries `{ visibility }` (see
 * profileStore.ts emitOutbox call sites at ~713-736 and ~762-767) — it does
 * NOT include the investor's `role.screenName` string, only the derived
 * `visibility.screenNameSet` boolean. When a screen name IS set we read the
 * current investor profile snapshot (also read-only, via the same exported
 * `_testAccess.investorProfiles` Map) to obtain the actual string. If no
 * screen name can be resolved, we simply omit the `screenName` field from the
 * merge — `writeUserPrivacy()` merges onto existing prefs, so an ABSENT field
 * never blanks a previously-set screenName. We never explicitly write
 * `screenName: ''`.
 *
 * Idempotency / durability: processed event ids are recorded in an additive
 * `privacy_visibility_bridge_processed` table (created idempotently, mirrors
 * the migration §7.4/Bypass-P7 sketch) so a restart does not re-process
 * already-mirrored events. Marking an event processed happens ONLY after a
 * successful `writeUserPrivacy()` call — a bridge failure must not silently
 * report success, and must not crash boot (fail-closed: log + continue).
 */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { writeUserPrivacy, type UserPrivacyPrefs } from "./lib/userPrivacyResolver";
import { _testAccess as profileStoreTestAccess } from "./profileStore";

/** Idempotent create of the additive offset table (spec §7.4, Bypass P7). */
function ensureProcessedTable(): void {
  try {
    const db: any = rawDb();
    db.exec(
      `CREATE TABLE IF NOT EXISTS privacy_visibility_bridge_processed (
        event_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      )`,
    );
  } catch (err) {
    log.warn(`[privacyVisibilityBridge] ensureProcessedTable failed: ${(err as Error).message}`);
  }
}

function isProcessed(eventId: string): boolean {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT 1 AS hit FROM privacy_visibility_bridge_processed WHERE event_id = ?`)
      .get(eventId) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch (err) {
    // Fail-closed for durability tracking: if we cannot tell whether an event
    // was already processed, treat it as unprocessed rather than crash. Worst
    // case is a redundant (idempotent) writeUserPrivacy call, never a skipped
    // one that silently drops a privacy change.
    log.warn(`[privacyVisibilityBridge] isProcessed check failed: ${(err as Error).message}`);
    return false;
  }
}

function markProcessed(eventId: string): void {
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT OR IGNORE INTO privacy_visibility_bridge_processed (event_id, processed_at)
       VALUES (?, ?)`,
    ).run(eventId, new Date().toISOString());
  } catch (err) {
    log.warn(`[privacyVisibilityBridge] markProcessed failed for ${eventId}: ${(err as Error).message}`);
  }
}

/** Shape of the `visibility` block carried in the outbox payload. */
interface VisibilityPayload {
  visibleToCoMembers?: unknown;
  visibleToCollectiveNetwork?: unknown;
  visibleInCollectiveDirectory?: unknown;
  screenNameSet?: unknown;
}

/**
 * Build the merge-only prefs object for a single event. Returns `null` when
 * the event carries no mappable fields (nothing to write).
 */
function mapEventToPrefs(aggregateId: string, visibility: VisibilityPayload): Partial<UserPrivacyPrefs> | null {
  const mapped: Partial<UserPrivacyPrefs> = {};

  if (typeof visibility.visibleToCoMembers === "boolean") {
    mapped.visibleToCoMembers = visibility.visibleToCoMembers;
  }

  // The resolver's canonical field is `visibleInCollectiveDirectory`; the
  // investor-profile visibility block uses the legacy name
  // `visibleToCollectiveNetwork`. Accept either key defensively.
  if (typeof visibility.visibleInCollectiveDirectory === "boolean") {
    mapped.visibleInCollectiveDirectory = visibility.visibleInCollectiveDirectory;
  } else if (typeof visibility.visibleToCollectiveNetwork === "boolean") {
    mapped.visibleInCollectiveDirectory = visibility.visibleToCollectiveNetwork;
  }

  // Screen name: the payload only tells us whether ONE IS SET
  // (`screenNameSet`), not the string itself. When set, look up the live
  // investor profile (read-only) for the actual `role.screenName` value.
  // NEVER blank an existing resolver screenName just because this event's
  // payload happens to omit it — only merge a PRESENT, non-empty value.
  if (visibility.screenNameSet === true) {
    try {
      const profile = profileStoreTestAccess.investorProfiles.get(aggregateId) as
        | { role?: { screenName?: string | null } }
        | undefined;
      const sn = (profile?.role?.screenName ?? "").toString().trim();
      if (sn.length > 0) {
        mapped.screenName = sn;
      }
      // sn.length === 0 → screenNameSet claims true but no string is
      // resolvable right now; omit the field rather than write ''.
    } catch (err) {
      log.warn(`[privacyVisibilityBridge] screenName lookup failed for ${aggregateId}: ${(err as Error).message}`);
    }
  }
  // screenNameSet === false → the investor explicitly cleared their screen
  // name in profileStore. We still do NOT force-blank the resolver's
  // screenName here: the spec is explicit ("do not blank the resolver
  // screenName; only merge present fields") and there is no separate,
  // unambiguous "clear" signal in this payload distinct from "never set".
  // A future explicit clear event/field could map to `screenName: ''`
  // deliberately; this bridge stays conservative until one exists.

  return Object.keys(mapped).length > 0 ? mapped : null;
}

/**
 * Consume unprocessed `privacy.visibility.changed` / `investor` outbox events
 * and mirror them into the sacred resolver via `writeUserPrivacy`. Returns a
 * summary for logging/tests. Fail-closed per-event: one bad event is logged
 * and skipped (NOT marked processed), never crashes the loop.
 */
export function syncInvestorVisibilityToUserPrivacy(limit?: number): {
  scanned: number;
  mirrored: number;
  skipped: number;
  failed: number;
} {
  ensureProcessedTable();

  let scanned = 0;
  let mirrored = 0;
  let skipped = 0;
  let failed = 0;

  let entries: readonly {
    eventId: string;
    eventType: string;
    aggregateId: string;
    aggregateKind: string;
    payload: Record<string, unknown>;
  }[] = [];
  try {
    entries = profileStoreTestAccess.outbox as typeof entries;
  } catch (err) {
    log.warn(`[privacyVisibilityBridge] outbox read failed (non-fatal): ${(err as Error).message}`);
    return { scanned, mirrored, skipped, failed };
  }

  const candidates = entries.filter(
    (e) => e.eventType === "privacy.visibility.changed" && e.aggregateKind === "investor",
  );

  for (const evt of candidates) {
    if (limit !== undefined && scanned >= limit) break;
    scanned++;

    if (isProcessed(evt.eventId)) {
      skipped++;
      continue;
    }

    try {
      const visibility = (evt.payload?.visibility ?? {}) as VisibilityPayload;
      const mapped = mapEventToPrefs(evt.aggregateId, visibility);
      if (!mapped) {
        // Nothing mappable (e.g. an unrelated changedFields subset) — mark
        // processed so we don't re-inspect it forever, but this is not a
        // failure.
        markProcessed(evt.eventId);
        skipped++;
        continue;
      }

      // The write itself is the thing that can legitimately fail (DB error).
      // Only mark processed AFTER a successful write — never report success
      // for a write that failed.
      writeUserPrivacy(evt.aggregateId, mapped);
      markProcessed(evt.eventId);
      mirrored++;
    } catch (err) {
      failed++;
      log.error(
        `[privacyVisibilityBridge] failed to mirror event ${evt.eventId} (investor ${evt.aggregateId}): ${(err as Error).message}`,
      );
      // Do NOT mark processed — eligible for retry on the next sync tick.
    }
  }

  if (mirrored > 0 || failed > 0) {
    log.info(
      `[privacyVisibilityBridge] sync complete: scanned=${scanned} mirrored=${mirrored} skipped=${skipped} failed=${failed}`,
    );
  }

  return { scanned, mirrored, skipped, failed };
}

/**
 * Register the bridge at startup/hydration. Mirrors how `hydrateBridgeStore`
 * is wired in `server/index.ts`: called once during boot, wrapped so a
 * failure is logged and NON-FATAL (never blocks the server from starting).
 */
export function registerPrivacyVisibilityBridge(): void {
  try {
    const result = syncInvestorVisibilityToUserPrivacy();
    if (result.failed > 0) {
      log.warn(
        `[privacyVisibilityBridge] startup sync had ${result.failed} failure(s); will retry on next drain/tick`,
      );
    }
  } catch (err) {
    // Fail-closed for BOOT: never crash the server over a bridge hiccup.
    log.warn(`[privacyVisibilityBridge] startup registration failed (non-fatal): ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// W3 #9 (live consumption) — the sacred profileStore only APPENDS
// `privacy.visibility.changed` to its outbox on the live PATCH paths
// (/api/investors/:id and /api/investors/:id/privacy); it exposes no subscribe
// hook and cannot be edited. A single startup drain therefore misses every
// privacy change made AFTER boot. We close that gap with a lightweight,
// idempotent drain tick (the sync is already processed-marker + retry safe),
// mirroring the production-gated setInterval + .unref() pattern used by
// chapterLeaderboardStore. Guarded so tests/dev don't poll.
// ---------------------------------------------------------------------------
let _bridgeInterval: ReturnType<typeof setInterval> | null = null;

/** Default live-drain cadence: 30s. Overridable via env for ops tuning. */
function bridgeTickMs(): number {
  const raw = Number(process.env.PRIVACY_BRIDGE_TICK_MS);
  return Number.isInteger(raw) && raw >= 1000 ? raw : 30_000;
}

/** True when the live drain worker should run (prod by default; opt-in via env). */
function bridgeWorkerEnabled(): boolean {
  if (process.env.PRIVACY_BRIDGE_WORKER_ENABLED === "false") return false;
  if (process.env.PRIVACY_BRIDGE_WORKER_ENABLED === "true") return true;
  return process.env.NODE_ENV === "production";
}

/**
 * Start the live drain worker. Idempotent (a second call is a no-op). Each tick
 * re-drains any not-yet-processed events so a privacy change made during normal
 * operation is mirrored into the sacred resolver within one tick — not only at
 * the next restart. Fail-safe: a tick error is logged, never thrown.
 */
export function startPrivacyVisibilityBridgeWorker(): void {
  if (_bridgeInterval) return;
  if (!bridgeWorkerEnabled()) {
    log.info("[privacyVisibilityBridge] live drain worker disabled (not production / opt-out)");
    return;
  }
  _bridgeInterval = setInterval(() => {
    try {
      syncInvestorVisibilityToUserPrivacy();
    } catch (err) {
      log.warn(`[privacyVisibilityBridge] drain tick failed (non-fatal): ${(err as Error).message}`);
    }
  }, bridgeTickMs());
  // Never keep the event loop alive for this background worker.
  (_bridgeInterval as unknown as { unref?: () => void }).unref?.();
  log.info(`[privacyVisibilityBridge] live drain worker started (tick=${bridgeTickMs()}ms)`);
}

/** Test/ops seam — stop the live worker (no-op if not running). */
export function stopPrivacyVisibilityBridgeWorker(): void {
  if (_bridgeInterval) {
    clearInterval(_bridgeInterval);
    _bridgeInterval = null;
  }
}

/** Test-only seam (read-only introspection; no production import). */
export const _testAccessPrivacyBridge = { ensureProcessedTable, isProcessed, mapEventToPrefs };
