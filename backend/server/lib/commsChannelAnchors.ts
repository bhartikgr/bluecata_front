/**
 * W-COLLECTIVE Wave 2 STAGE D (D5) — DURABLE rebuild of ANCHORED comms channels.
 *
 * ── THE ACCEPTANCE PROBLEM ─────────────────────────────────────────────────
 * Wave 1 made `GET /api/comms/posts/:id` fail CLOSED when a post's channel
 * cannot be resolved. That correctly closed a world-readable hole (an
 * unresolvable channel used to skip the check and serve the post to any
 * authenticated caller), but it left `cap_table` and `company_followers` posts
 * INACCESSIBLE — because those two channel kinds are never materialised at all
 * on LIVE:
 *
 *   - `POST /api/comms/posts` only creates a channel when
 *     `authorKind === "user" && visibility !== "cap_table"` — i.e. only the
 *     author's own `network` channel;
 *   - `restorePostFromDb` deliberately refuses to synthesise a `cap_table` /
 *     `company_followers` participant list from a post row, because that list IS
 *     the authorisation decision and a guess would either leak the post or
 *     wrongly admit members;
 *   - `persistChannel` never wrote the 0117 anchors, so even a persisted channel
 *     came back from `hydrateCommsStore` with no company/round/chapter.
 *
 * This module supplies the missing half: it derives each anchored channel's
 * participant set from DURABLE ROWS, so the channel can be rebuilt on every
 * restart with the correct members and nothing is hardcoded or seeded.
 *
 * ── PARTICIPANT DEFINITION PER KIND (durable, exhaustive) ──────────────────
 *   `cap_table__<companyId>`
 *       active founder / co_founder rows in `company_members`
 *     ∪ committed, non-deleted holders in `captable_commits` (the SACRED
 *       ledger — READ ONLY)
 *   `followers__<companyId>`
 *       active founder / co_founder rows in `company_members`
 *     ∪ live rows in `company_followers` (`deleted_at IS NULL`, migration 0116)
 *
 * ── `soft_circle` IS DELIBERATELY NOT REBUILT — STOP CONDITION ──────────────
 * A `softcircle__<roundId>` channel's members are the round's soft-circle
 * participants, and its content is round/commit detail. Deriving that membership
 * would make a funding / soft-circle-commit path go live for the first time,
 * which Stage D's hard rules forbid. `soft_circle` therefore keeps its EXACT
 * pre-D5 behaviour (participant array only) and is reported, not enabled.
 *
 * ── ANCHOR RESOLUTION ORDER ────────────────────────────────────────────────
 *   1. the in-memory `channel.companyId` / `.roundId` / `.chapterId`;
 *   2. the durable 0117 anchor columns on `comms_channels`;
 *   3. a DECODE of the channel id, which is itself durable — the id is the
 *      PRIMARY KEY and is minted deterministically by
 *      `capTableChannelId` / `companyFollowersChannelId` /
 *      `softCircleChannelId` / `networkChannelId`
 *      (client/src/lib/comms/types.ts:296-307).
 * (3) is a decode, NOT a guess: `captable__co_x` can only ever have been minted
 * from `co_x`. Rows persisted before 0117 have NULL anchors, so without (3) they
 * would stay orphaned forever; `backfillChannelAnchors` writes the decoded value
 * back so subsequent reads use (2).
 *
 * Fail-closed: any DB error yields an EMPTY participant set / FALSE membership,
 * never a wider audience. This module never widens anything by itself — callers
 * compose it. All SQL is parameterised.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const FOUNDER_ROLES = ["founder", "co_founder"] as const;

/** Channel kinds this module is allowed to rebuild. */
export type AnchoredChannelKind = "cap_table" | "company_followers";

export interface ChannelAnchors {
  companyId?: string;
  roundId?: string;
  chapterId?: string;
}

/**
 * Decode the anchors a deterministic channel id encodes. Returns `{}` for `dm`
 * and for anything unrecognised.
 */
export function decodeChannelIdAnchors(
  channelId: string,
): { kind?: string; anchors: ChannelAnchors } {
  if (!isValidId(channelId)) return { anchors: {} };
  const id = channelId.trim();
  if (id.startsWith("captable__")) {
    return { kind: "cap_table", anchors: { companyId: id.slice("captable__".length) } };
  }
  if (id.startsWith("followers__")) {
    return { kind: "company_followers", anchors: { companyId: id.slice("followers__".length) } };
  }
  if (id.startsWith("softcircle__")) {
    return { kind: "soft_circle", anchors: { roundId: id.slice("softcircle__".length) } };
  }
  if (id.startsWith("network__")) return { kind: "network", anchors: {} };
  if (id.startsWith("dm__")) return { kind: "dm", anchors: {} };
  return { anchors: {} };
}

/** The 0117 anchor columns for a persisted channel, or `{}`. */
export function readPersistedAnchors(channelId: string): ChannelAnchors {
  if (!isValidId(channelId)) return {};
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT company_id, round_id, chapter_id
           FROM comms_channels
          WHERE id = ?
          LIMIT 1`,
      )
      .get(channelId.trim()) as
      | { company_id?: string | null; round_id?: string | null; chapter_id?: string | null }
      | undefined;
    if (!row) return {};
    const out: ChannelAnchors = {};
    if (isValidId(row.company_id)) out.companyId = row.company_id.trim();
    if (isValidId(row.round_id)) out.roundId = row.round_id.trim();
    if (isValidId(row.chapter_id)) out.chapterId = row.chapter_id.trim();
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve a channel's anchors using the documented order (in-memory → durable
 * 0117 columns → id decode).
 */
export function resolveChannelAnchors(channel: {
  id: string;
  companyId?: string;
  roundId?: string;
  chapterId?: string;
}): ChannelAnchors {
  const out: ChannelAnchors = {};
  if (isValidId(channel.companyId)) out.companyId = channel.companyId.trim();
  if (isValidId(channel.roundId)) out.roundId = channel.roundId.trim();
  if (isValidId((channel as { chapterId?: string }).chapterId)) {
    out.chapterId = (channel as { chapterId?: string }).chapterId!.trim();
  }
  if (out.companyId && out.roundId && out.chapterId) return out;
  const persisted = readPersistedAnchors(channel.id);
  out.companyId = out.companyId ?? persisted.companyId;
  out.roundId = out.roundId ?? persisted.roundId;
  out.chapterId = out.chapterId ?? persisted.chapterId;
  if (!out.companyId || !out.roundId) {
    const decoded = decodeChannelIdAnchors(channel.id).anchors;
    out.companyId = out.companyId ?? decoded.companyId;
    out.roundId = out.roundId ?? decoded.roundId;
    out.chapterId = out.chapterId ?? decoded.chapterId;
  }
  return out;
}

/** Active founder / co_founder user ids for a company. */
export function founderUserIdsOfCompany(companyId: string): string[] {
  if (!isValidId(companyId)) return [];
  try {
    const db: any = rawDb();
    const marks = FOUNDER_ROLES.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT DISTINCT user_id
           FROM company_members
          WHERE company_id = ?
            AND role IN (${marks})
            AND is_active = 1
            AND deleted_at IS NULL`,
      )
      .all(companyId.trim(), ...FOUNDER_ROLES) as Array<{ user_id?: string | null }>;
    return rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/** Committed, non-deleted holders on a company's cap table (SACRED ledger, read-only). */
export function capTableHolderUserIdsOfCompany(companyId: string): string[] {
  if (!isValidId(companyId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT investor_id
           FROM captable_commits
          WHERE company_id = ?
            AND state = 'committed'
            AND deleted_at IS NULL`,
      )
      .all(companyId.trim()) as Array<{ investor_id?: string | null }>;
    return rows.map((r) => r?.investor_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/** Live followers of a company (migration 0116). */
export function followerUserIdsOfCompany(companyId: string): string[] {
  if (!isValidId(companyId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT user_id
           FROM company_followers
          WHERE company_id = ?
            AND deleted_at IS NULL`,
      )
      .all(companyId.trim()) as Array<{ user_id?: string | null }>;
    return rows.map((r) => r?.user_id).filter(isValidId).map((s) => s.trim());
  } catch {
    return [];
  }
}

/**
 * The DURABLE participant set for an anchored channel kind. Sorted so the
 * rebuilt list is byte-stable across processes and across a restart.
 */
export function durableParticipantsFor(
  kind: AnchoredChannelKind,
  anchors: ChannelAnchors,
): string[] {
  const companyId = anchors.companyId;
  if (!isValidId(companyId)) return [];
  const out = new Set<string>(founderUserIdsOfCompany(companyId));
  if (kind === "cap_table") {
    for (const u of capTableHolderUserIdsOfCompany(companyId)) out.add(u);
  } else {
    for (const u of followerUserIdsOfCompany(companyId)) out.add(u);
  }
  return Array.from(out).sort();
}

/**
 * TRUE iff `viewerUserId` is a member of this anchored channel PER DURABLE ROWS,
 * evaluated live rather than from the possibly-stale participant snapshot.
 *
 * This is what makes a follow that happened AFTER the channel was materialised
 * take effect immediately, and an unfollow revoke immediately. It is READ-ONLY
 * and MUTATES NOTHING — in particular it never backfills
 * `channel.participantUserIds`, so it cannot promote a reader to a writer (the
 * invariant `server/lib/networkPostAudience.ts` documents and Stage C asserts).
 *
 * Returns FALSE for every kind other than the two anchored kinds, so `dm`,
 * `network` and — deliberately — `soft_circle` are untouched.
 */
export function viewerIsDurableChannelMember(
  channel: { id: string; kind: string; companyId?: string; roundId?: string },
  viewerUserId: string,
): boolean {
  if (!isValidId(viewerUserId)) return false;
  if (channel.kind !== "cap_table" && channel.kind !== "company_followers") return false;
  try {
    const anchors = resolveChannelAnchors(channel);
    if (!isValidId(anchors.companyId)) return false;
    return durableParticipantsFor(
      channel.kind as AnchoredChannelKind,
      anchors,
    ).includes(viewerUserId.trim());
  } catch {
    return false;
  }
}

/**
 * Write the resolved anchors onto the persisted `comms_channels` row (only where
 * they are currently NULL, so an explicitly-set anchor is never overwritten).
 * Best-effort: a failure here degrades to the id-decode path, it does not fail a
 * caller.
 */
export function backfillChannelAnchors(channelId: string, anchors: ChannelAnchors): void {
  if (!isValidId(channelId)) return;
  if (!anchors.companyId && !anchors.roundId && !anchors.chapterId) return;
  try {
    const db: any = rawDb();
    db.prepare(
      `UPDATE comms_channels
          SET company_id = COALESCE(company_id, ?),
              round_id   = COALESCE(round_id, ?),
              chapter_id = COALESCE(chapter_id, ?)
        WHERE id = ?`,
    ).run(
      anchors.companyId ?? null,
      anchors.roundId ?? null,
      anchors.chapterId ?? null,
      channelId.trim(),
    );
  } catch (err) {
    log.warn(
      "[commsChannelAnchors.backfill] anchor write failed (non-fatal):",
      (err as Error).message,
    );
  }
}
