/**
 * legacyInvitationStore.ts — v25.45 Bug C (Ozan founder QA wave)
 *
 * Durable backing for the LEGACY in-memory `invitationStore` array that lives in
 * routes.ts (Sprint-7 `POST /api/rounds/:id/invitations/issue` and the two
 * `/redeem` paths). Before this fix that array was the ONLY home for tokens
 * minted via the legacy issue endpoint and for redemption-state mutations, so a
 * server restart silently dropped every legacy invitation token and reset
 * redemption state — exactly the "saved in memory instead of the database"
 * regression Ozan flagged for the Rounds section.
 *
 * Design (mirrors the existing storePersistenceShim pattern used elsewhere in
 * the codebase, e.g. workspaceDeletionRequests at routes.ts:3113):
 *   - kv_legacyInvitationStore (id PK, payload_json, updated_at, deleted_at).
 *   - persistLegacyInvitation(entry): best-effort upsert keyed by entry.id.
 *     Called on issue and on every redemption-state mutation.
 *   - hydrateLegacyInvitations(target): on boot, merge persisted rows into the
 *     routes.ts in-memory array — NEW ids are appended, and persisted
 *     redemption/revocation state is applied onto matching demo-seed entries
 *     (so a redeemed/revoked legacy token stays redeemed/revoked after restart).
 *
 * The DDL is additive (CREATE TABLE IF NOT EXISTS via the shim). When there is
 * no raw SQLite driver (Postgres backend / no-DB sandbox) the shim degrades to
 * a no-op and the array remains in-memory — same graceful degradation as the
 * sibling stores. This module never touches captable_commits or the cap-table
 * math; an invitation token is metadata only.
 */
import {
  persistEntry as shimPersistEntry,
  persistEntryStrict as shimPersistEntryStrict,
  hydrateEntries as shimHydrateEntries,
} from "./lib/storePersistenceShim";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

const STORE_NAME = "legacyInvitationStore";

/* The canonical in-memory array lives in routes.ts (module scope). routes.ts
 * registers a reference here at import time so the HYDRATE_ORDER entry can
 * rehydrate it without importing the whole routes.ts module (which would be a
 * heavy circular import). */
let registeredTarget: LegacyInvitationLike[] | null = null;

/** Called once by routes.ts at module-load to hand us the array reference. */
export function registerLegacyInvitationTarget(target: LegacyInvitationLike[]): void {
  registeredTarget = target;
}

/** Minimal shape we depend on — kept structural so routes.ts owns the canonical
 *  InvitationStoreEntry type and we don't create a circular import. */
export interface LegacyInvitationLike {
  id: string;
  tokenHash: string;
  roundId: string;
  companyId: string;
  companyName: string;
  inviteeEmail: string;
  inviteeName: string;
  prefilledScreenName: string | null;
  issuedAt: string;
  expiresAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
  revoked: boolean;
}

/**
 * Best-effort durable upsert of one legacy invitation entry. Returns true on a
 * successful DB write, false otherwise (non-fatal — the caller keeps the
 * in-memory copy). Idempotent: keyed by entry.id (ON CONFLICT DO UPDATE in the
 * shim), so re-persisting after a redemption-state mutation just refreshes the
 * row.
 */
export function persistLegacyInvitation(entry: LegacyInvitationLike): boolean {
  if (!entry || !entry.id) return false;
  try {
    return shimPersistEntry(STORE_NAME, entry.id, entry);
  } catch (err) {
    log.warn(
      "[legacyInvitationStore.persistLegacyInvitation] persist failed (kept in-memory):",
      (err as Error).message,
    );
    return false;
  }
}

/**
 * v25.45 Bug C ROUND-2 (GPT-5.5 blocker 4): STRICT / FAIL-CLOSED durable persist
 * for the identity-critical legacy invitation issue + redeem paths.
 *
 * The non-strict `persistLegacyInvitation` above returns false on DB failure and
 * its callers ignored the boolean, so a token could be minted (raw token
 * returned to the client) or redeemed (session created) while the DB write
 * silently failed — a memory-only state that, after restart, allows token reuse
 * or token loss. This variant writes to the DB and THROWS on failure so the
 * route handler can refuse the request (issue: do not return the token; redeem:
 * do not mark redeemed / create a session).
 *
 * Graceful degradation: when there is no raw SQLite driver (Postgres backend or
 * no-DB sandbox) we cannot use the kv shim's strict path. In that case we fall
 * back to the documented module behavior (Map/array is authoritative) and do
 * NOT throw — identical to the sibling stores' no-DB degradation. The strict
 * guarantee applies exactly where a durable store exists, which is the
 * production + SQLite-test path the blocker targets.
 */
function rawSqliteAvailable(): boolean {
  try {
    rawDb();
    return true;
  } catch {
    return false; // Postgres backend / no-DB sandbox -- array is authoritative.
  }
}

export function persistLegacyInvitationStrict(entry: LegacyInvitationLike): void {
  if (!entry || !entry.id) {
    throw new Error("STRICT_PERSIST_FAILED: legacyInvitationStore missing id");
  }
  if (!rawSqliteAvailable()) {
    // No durable SQLite driver -- degrade to the in-memory array (same as the
    // best-effort path's no-DB behavior). Nothing to fail closed against.
    return;
  }
  // Throws (STRICT_PERSIST_FAILED) on DB write failure -- caller fails closed.
  shimPersistEntryStrict(STORE_NAME, entry.id, entry);
}

/**
 * Rehydrate persisted legacy invitations into the routes.ts in-memory array.
 *  - Entries whose id already exists in `target` (e.g. demo seeds) have their
 *    durable redemption/revocation state re-applied (and any drift refreshed).
 *  - Entries with a new id (founder-minted tokens) are appended.
 * Returns the number of rows loaded from the DB. Safe to call with no DB
 * (returns 0).
 */
export function hydrateLegacyInvitations<T extends LegacyInvitationLike>(
  target?: T[],
): number {
  const dest = (target ?? (registeredTarget as T[] | null)) ?? null;
  if (!dest) {
    log.warn(
      "[legacyInvitationStore.hydrateLegacyInvitations] no target registered; skipping",
    );
    return 0;
  }
  let loaded = 0;
  try {
    const rows = shimHydrateEntries<T>(STORE_NAME);
    for (const [, obj] of rows) {
      if (!obj || !obj.id) continue;
      loaded++;
      const idx = dest.findIndex((e) => e.id === obj.id);
      if (idx >= 0) {
        // Re-apply the durable copy over the in-memory (seed) entry so a
        // redeemed/revoked legacy token survives a restart.
        dest[idx] = { ...dest[idx], ...obj };
      } else {
        dest.push(obj);
      }
    }
  } catch (err) {
    log.warn(
      "[legacyInvitationStore.hydrateLegacyInvitations] hydrate failed:",
      (err as Error).message,
    );
  }
  return loaded;
}
