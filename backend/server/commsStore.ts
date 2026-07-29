/**
 * Sprint 9 — In-memory communications store + production-shape endpoints.
 *
 * Topology mirrors the live Capavate audit (collective_communications_audit.md):
 *   - DMs                 : 1:1 between two users
 *   - Cap-table channels  : per-company group thread (founder + visible holders)
 *   - Soft-circle channels: per-round group thread (founder + soft-circlers)
 *   - Company-followers   : posts from a company to its followers
 *   - Network             : posts from a user to their network connections
 *
 * In production this is replaced by Postgres + Drizzle queries with the
 * same schema (snake_case at storage, camelCase on the wire).
 *
 * All mutations:
 *   - Validated by zod schemas from `client/src/lib/comms/types`
 *   - Honour the `Idempotency-Key` header when present
 *   - Append a hash-chained audit entry
 *   - Append a structured outbox event (Collective-consumable)
 *   - Capture authorIp + userAgent at write time (per spec)
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
// W2M B3 — static (cycle-safe) import: networkPostsStore breaks the cycle with a
// runtime `await import("./commsStore")` and has NO static import of this module.
import { persistNetworkPost } from "./networkPostsStore";

import {
  channelSchema,
  messageCreateSchema,
  messageEditSchema,
  messageReactionSchema,
  postCreateSchema,
  postCommentCreateSchema,
  dmStartSchema,
  capTableChannelId,
  softCircleChannelId,
  companyFollowersChannelId,
  networkChannelId,
  dmChannelId,
  type Channel,
  type Message,
  type Post,
  type ChannelKind,
  type Visibility,
} from "../client/src/lib/comms/types";
import {
  resolveDisplayIdentity,
} from "../client/src/lib/comms/visibility";
// v25.46 Track 1 — canonical DM permission gate. ALL message endpoints route
// through canDM (single source of truth; no inline permission logic). See
// server/messagingPolicy.ts for the LOCKED permission matrix.
import { canDM } from "./messagingPolicy";
// v25.45 ROUND 2 (F13b) — DB-backed privacy prefs override messaging sender
// names so the Settings → Privacy toggle (visibleToCoMembers) actually takes
// effect on the messaging surface. readUserPrivacyRaw returns null when the
// user has no saved row, in which case we keep the legacy resolveDisplayIdentity
// behavior (backward-compatible — no retroactive masking).
import { resolveDisplayName, readUserPrivacyRaw } from "./lib/userPrivacyResolver";
/* W-FIX1a A2 — DB-backed name resolver used to sanitize any residual raw id/email
   that the viewer-aware resolver may pass through (never leak u_…/company:…). */
import { resolveDisplayName as resolveDbDisplayName } from "./lib/displayNameResolver";
import { areCoMembersOnAnyCapTable } from "./lib/capTableMembership";
/* W-AVI65 FIX 2 — widened DM-only co-membership predicate (founder↔investor).
   It calls the SACRED areCoMembersOnAnyCapTable internally, unchanged. */
import { areDmCoMembers } from "./lib/dmCoMembership";
/* W-COLLECTIVE Wave 2 Stage C — relationship-scoped audience for NETWORK posts.
   Pure, read-only, fail-closed, and deliberately does NOT call
   channelIsVisibleToViewer (which backfills participantUserIds → would turn a
   read into a write grant). See server/lib/networkPostAudience.ts. */
import { viewerCanSeeNetworkPost } from "./lib/networkPostAudience";
// 1d — Consortium Partner author-label fallback (non-sacred): screen name →
// registered/company name → "Consortium Partner". Keeps a partner author from
// rendering as a raw u_redeemed_… id in the Posts feed.
import { getConsortiumPartnerDisplayName } from "./adminContactsStore";
import { emitMutation } from "./lib/eventBus";
import { publish as ssePublish } from "./lib/sseHub";
import { emitNotification } from "./notificationsStore";
import { resolvePersonaId } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { requireAdmin } from "./lib/authMiddleware"; /* v25.20 Lane 1 NC1 */
/* W2B B3 — CALL-ONLY use of the sacred limiter. /api/comms had no rate limit at
   all; the engagement endpoints get the existing per-user "write" bucket. */
import { collectiveRateLimit } from "./lib/rateLimit";
// B-505 fix v23.6.1 — resolve founder CRM contacts that have not yet been
// provisioned into the comms layer, so "Message" never dead-ends on a 404.
import { findCrmContactByInvestorId } from "./founderCrmStore";
// v24.2 Bug 5 — derivedMembership must consult DURABLE relationship stores,
// not only the runtime/static UserContext arrays. Secure-invite-redeemed users
// have empty ctx.investor.invitedRounds (those are RUNTIME-only), so we also
// query the persisted soft-circle, round-invitation, and company-membership
// stores keyed by userId/email.
import * as softCircleStore from "./softCircleStore";
import * as roundInvitationsStore from "./roundInvitationsStore";
import { getCompaniesForFounder } from "./multiCompanyStore";
/* v17 Phase B — Collective-channel slice write-through to DB. */
import { isNull } from "drizzle-orm";
import { getDb, rawDb } from "./db/connection";
import { collectiveChannelPosts as collectiveChannelPostsTable } from "@shared/schema";
/* W2B B1 — durable drain for the two hash-chained comms ring buffers. */
import { drainCommsAuditEntries, drainCommsOutboxEvents } from "./commsAuditDurable";
/* W2B B4 — durable per-user post engagement (Stage A tables 0119). */
import {
  recordPostLike,
  removePostLike,
  recordPostComment,
  recordPostShare,
  loadPostEngagement,
} from "./postEngagementStore";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";
// v24.0 C13: badge propagation reads from the LIVE membership store, not the
// static COMMS_USERS seed. Imported namespaced so we can fall back gracefully.
import * as collectiveMembershipStore from "./collectiveMembershipStore";
// v24.0 E7: partner detection for role-aware DM notification links.
import { partnerTeamStore } from "./partnerWorkspaceStore";
import { getUserContextForId } from "./lib/userContext";
/* ────────────────────────────────────────────────────────────────────────────
   W-COLLECTIVE Wave 2 STAGE D — DURABLE RE-SOURCING (D1/D2/D3/D4/D5)

   D3: `COMMS_USERS` (below, line ~271) is `DEMO_SEED_ENABLED ? seed : {}` and
   therefore HARD-EMPTY on live. Thirteen reads of it silently degraded. Each
   now goes through `commsUserRef()` which falls back to the DB.
   D1: follows persist to `company_followers` as a per-USER relation.
   D2: `network_posts.chapter_id` is now anchored, so audience row 5 can fire.
   D4: author location derives from `companies.hq` (founder) / `users.location`.
   D5: `cap_table` / `company_followers` channels are rebuilt from durable rows.
   ──────────────────────────────────────────────────────────────────────────── */
import {
  durableCommsUserRef,
  durableCommsUserExists,
  durableAuthorLocation,
  durableActiveChapterIds,
  durableCompanyName,
  durableCompanyHq,
  durableCapTableCompanyIds,
  listDurableCommsUserIds,
  durableCapTablePeerIds,
  durableChapterPeerIds,
  durableFollowPeerIds,
  type DurableCommsUserRef,
} from "./lib/commsUserDirectory";
import {
  followCompany,
  unfollowCompany,
  isFollowingCompany,
  companiesFollowedBy,
  followersOfCompany,
  followerCountOfCompany,
} from "./lib/companyFollowStore";
import {
  resolveChannelAnchors,
  decodeChannelIdAnchors,
  durableParticipantsFor,
  viewerIsDurableChannelMember,
  backfillChannelAnchors,
  founderUserIdsOfCompany,
  type AnchoredChannelKind,
} from "./lib/commsChannelAnchors";
import {
  setPostChapterAnchor,
  isActiveChapterMember,
} from "./lib/chapterMembershipWriter";

/* v24.0 E7 — role-aware messages path for in-app notification deep links.
 * Mirrors the existing founder-vs-investor logic at the thread-reply site,
 * extended to route consortium partners to /partner/messages. Resolution
 * order: partner (active team membership) → founder (owns a company) → investor
 * (default). Best-effort: any resolver failure falls back to /investor. */
function messagesPathForUser(userId: string, threadId: string): string {
  try {
    if (partnerTeamStore.findByUserId(userId)) {
      return `/collective/partner/messages?thread=${threadId}`;
    }
  } catch { /* fall through */ }
  try {
    const ctx = getUserContextForId(userId);
    if (ctx.founder?.companies?.length) {
      return `/founder/messages?thread=${threadId}`;
    }
  } catch { /* fall through */ }
  /* D3 (:147) — role hint. Was `COMMS_USERS[userId]`, which is ALWAYS undefined
     on live, so every user whose UserContext lookup failed was deep-linked to
     /investor/messages — a founder landed on a page that does not hold their
     thread. Now re-sourced from `company_members` / `users.role` via the DB. */
  const isFounder = commsUserRef(userId)?.roles.includes("founder") ?? false;
  return `/${isFounder ? "founder" : "investor"}/messages?thread=${threadId}`;
}

/* ==================================================================== */
/* DEMO USERS — the cast for Sprint 9                                    */
/* ==================================================================== */

interface UserRef {
  id: string;
  legalName: string;
  email: string;
  visibility: Visibility;
  /** Companies whose cap table this user is on (mocked). */
  capTables: string[];
  /** Collective chapters this user belongs to (mocked). */
  collectiveChapters: string[];
  /** Roles this user holds — for badges. */
  roles: Array<"founder" | "investor" | "soft_circler" | "admin" | "co_member">;
  /** Founder-of-company id (if any). */
  founderOfCompanyId?: string;
  /** Optional location for SES-style display. */
  location?: string;
  /** Optional Capavate Angel Network gold-badge flag. */
  capavateAngelNetwork?: boolean;
}

const _seed_COMMS_USERS: Record<string, UserRef> = {
  /* The demo investor — Aisha Patel of Greenwood (matches profileStore seed). */
  u_aisha_patel: {
    id: "u_aisha_patel",
    legalName: "Aisha Patel",
    email: "aisha@greenwood.capital",
    visibility: { screenName: "GreenwoodCap", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    capTables: ["co_novapay", "co_arboreal", "co_quanta"],
    collectiveChapters: ["chap_toronto"],
    roles: ["investor", "co_member"],
    location: "Toronto, ON",
    capavateAngelNetwork: true,
  },
  /* Founder of NovaPay AI — Maya Chen. */
  u_maya_chen: {
    id: "u_maya_chen",
    legalName: "Maya Chen",
    email: "maya@novapay.ai",
    visibility: { screenName: "MayaC", visibleToCoMembers: true, visibleToCollectiveNetwork: true },
    capTables: ["co_novapay"],
    collectiveChapters: ["chap_sf"],
    roles: ["founder"],
    founderOfCompanyId: "co_novapay",
    location: "San Francisco, CA",
  },
  /* Co-founder Daniel Okafor. */
  u_daniel_okafor: {
    id: "u_daniel_okafor",
    legalName: "Daniel Okafor",
    email: "daniel@novapay.ai",
    visibility: { screenName: "DanielO", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    capTables: ["co_novapay"],
    collectiveChapters: ["chap_sf"],
    roles: ["founder"],
    founderOfCompanyId: "co_novapay",
    location: "San Francisco, CA",
  },
  /* Hydra Capital — opted into co-member visibility. */
  u_hydra_capital: {
    id: "u_hydra_capital",
    legalName: "Aisha Rahman (Hydra Capital)",
    email: "partner@hydracapital.com",
    visibility: { screenName: "HydraCap", visibleToCoMembers: true, visibleToCollectiveNetwork: true },
    capTables: ["co_novapay"],
    collectiveChapters: ["chap_sf", "chap_toronto"],
    roles: ["investor", "co_member"],
    location: "San Francisco, CA",
    capavateAngelNetwork: true,
  },
  /* Forge Ventures — opted in but no shared Collective chapter with Aisha. */
  u_forge_ventures: {
    id: "u_forge_ventures",
    legalName: "Tom Bauer (Forge Ventures)",
    email: "deal@forgeventures.vc",
    visibility: { screenName: "ForgeVC", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    capTables: ["co_novapay"],
    collectiveChapters: ["chap_nyc"],
    roles: ["investor", "co_member"],
    location: "New York, NY",
  },
  /* Avocado Angels — NOT opted in. Will appear as [Anonymous Holder]. */
  u_avocado_angels: {
    id: "u_avocado_angels",
    legalName: "Ramesh Iyer (Avocado Angels)",
    email: "ramesh@avocado.angel",
    visibility: { visibleToCoMembers: false, visibleToCollectiveNetwork: false },
    capTables: ["co_novapay"],
    collectiveChapters: [],
    roles: ["investor", "co_member"],
    location: "Bengaluru, IN",
  },
  /* Northstar Angels — bridge note holder, not opted in. */
  u_northstar_angels: {
    id: "u_northstar_angels",
    legalName: "Helena Park (Northstar Angels)",
    email: "ramesh@northstar.angel",
    visibility: { visibleToCoMembers: false, visibleToCollectiveNetwork: false },
    capTables: ["co_novapay"],
    collectiveChapters: [],
    roles: ["investor", "co_member"],
    location: "Boston, MA",
  },
  /* Bluepoint Angels — soft-circler, opted in. */
  u_bluepoint_angels: {
    id: "u_bluepoint_angels",
    legalName: "Helena Park (Bluepoint Angels)",
    email: "helena@bluepoint.club",
    visibility: { screenName: "BluepointSyndicate", visibleToCoMembers: true, visibleToCollectiveNetwork: true },
    capTables: [],
    collectiveChapters: ["chap_sf", "chap_toronto"],
    roles: ["investor", "soft_circler"],
    location: "Austin, TX",
    capavateAngelNetwork: true,
  },
};

// Patch v4: gated export — empty in production / when demo seed disabled.
export const COMMS_USERS: Record<string, UserRef> = DEMO_SEED_ENABLED ? _seed_COMMS_USERS : {};

/* ==================================================================== */
/* W-COLLECTIVE Wave 2 STAGE D (D3) — THE RE-SOURCED DIRECTORY READ      */
/* ==================================================================== */
/**
 * The SINGLE replacement for `COMMS_USERS[id]` at all thirteen read sites.
 *
 * `COMMS_USERS` above is `{}` whenever the demo seed is off, i.e. ALWAYS in
 * production. Every `COMMS_USERS[x]` read therefore returned `undefined` on
 * live, and each read site degraded quietly in its own direction (role badges
 * to "Member", the member/contact label to "Invited contact", locations to "",
 * `authorKind=collective` to zero posts, `sort=following` to every post, the DM
 * picker to `[]`, the founder-only pin to a 403).
 *
 * Resolution order, and WHY:
 *   1. the seed map when it is populated — so demo/test environments behave
 *      EXACTLY as before this change (no test rewrite, no seed regression), and
 *   2. otherwise the DURABLE `users`-row-backed ref from
 *      `server/lib/commsUserDirectory.ts`.
 * `undefined` still means "no such user", so every `if (!author)` /
 * `COMMS_USERS[x] ? …` branch keeps its original MEANING while finally being
 * answered from data.
 *
 * The return type is the STRUCTURAL union of the two: `UserRef` and
 * `DurableCommsUserRef` declare the same fields, so call sites are unchanged.
 */
function commsUserRef(userId: string): UserRef | DurableCommsUserRef | undefined {
  if (typeof userId !== "string" || !userId.trim()) return undefined;
  const seeded = COMMS_USERS[userId];
  if (seeded) return seeded;
  return durableCommsUserRef(userId);
}

/**
 * TRUE iff this id names a real platform member (seed OR durable `users` row).
 * Used by the two "Collective member" vs "Invited contact" label sites.
 */
function commsUserIsKnown(userId: string): boolean {
  if (typeof userId !== "string" || !userId.trim()) return false;
  if (COMMS_USERS[userId]) return true;
  return durableCommsUserExists(userId);
}

/* ==================================================================== */
/* IN-MEMORY STORES                                                     */
/* ==================================================================== */

const channels = new Map<string, Channel>();
const messages = new Map<string, Message>();
const posts = new Map<string, Post>();

/* ==================================================================== */
/* v25.1 Bug 2 fix — comms_messages DB persistence                       */
/* The in-memory `messages` Map alone was losing messages in two cases:  */
/*   1. PM2 cluster mode — each worker has its own Map. POST hits one    */
/*      worker, GET hits another, GET returns empty.                     */
/*   2. Server restart — all messages disappear.                         */
/* Persist every mutation to `comms_messages` (PRAGMA-guarded ALTER in   */
/* server/db/connection.ts) and hydrate on boot. Keeps Map as a read     */
/* cache; DB is the source of truth.                                     */
/* ==================================================================== */
/**
 * v25.9 — Persist a DM/group channel row so it survives restart.
 * Avi: "Most of the records are being saved in memory instead of the DB."
 */
function persistChannel(ch: Channel): void {
  try {
    const db: any = rawDb();
    /* w-collective Wave 2 Stage A — CONVERGED with migration
     * 0117_comms_channel_anchors.sql and with the comms_channels CREATE literal
     * in server/db/connection.ts. All three must stay identical: this runtime
     * DDL is what actually created the table on every existing database (it was
     * never migration-managed before 0117), so if it drifts from the migration
     * the anchor columns silently depend on which path ran first.
     *
     * Stage A added the anchor COLUMNS but deliberately did not populate them.
     * w-collective Wave 2 Stage D (D5) POPULATES them: the INSERT below now
     * writes `company_id` / `round_id` / `chapter_id` resolved by
     * `resolveChannelAnchors` (in-memory value → existing durable anchor → a
     * decode of the deterministic channel id, which is the primary key and
     * therefore not a guess). Without this, `hydrateCommsStore` came back from a
     * restart with no way to know which company a cap-table or company-followers
     * channel belonged to, so those channels could not be rebuilt and their posts
     * stayed permanently inaccessible.
     * The DDL itself is UNCHANGED and must stay byte-identical to migration 0117
     * and to the CREATE literal in server/db/connection.ts. */
    db.exec(`CREATE TABLE IF NOT EXISTS comms_channels (
      id                        TEXT PRIMARY KEY NOT NULL,
      kind                      TEXT NOT NULL,
      participant_user_ids_json TEXT NOT NULL,
      created_at                TEXT NOT NULL,
      metadata_json             TEXT,
      deleted_at                TEXT,
      company_id                TEXT,
      round_id                  TEXT,
      chapter_id                TEXT
    );`);
    /* D5 — resolve the anchors for this channel. COALESCE on update so an
       explicitly-set anchor is never overwritten with NULL by a later save. */
    const anchors = resolveChannelAnchors(ch);
    db.prepare(
      `INSERT INTO comms_channels (id, kind, participant_user_ids_json, created_at, metadata_json, deleted_at, company_id, round_id, chapter_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           participant_user_ids_json = excluded.participant_user_ids_json,
           metadata_json = excluded.metadata_json,
           deleted_at = NULL,
           company_id = COALESCE(excluded.company_id, comms_channels.company_id),
           round_id   = COALESCE(excluded.round_id, comms_channels.round_id),
           chapter_id = COALESCE(excluded.chapter_id, comms_channels.chapter_id)`,
    ).run(
      ch.id,
      ch.kind,
      JSON.stringify(ch.participantUserIds ?? []),
      ch.createdAt,
      ch.metadata ? JSON.stringify(ch.metadata) : null,
      anchors.companyId ?? null,
      anchors.roundId ?? null,
      anchors.chapterId ?? null,
    );
  } catch (err) {
    log.warn("[commsStore.persistChannel] DB write failed (continuing in-memory):", (err as Error).message);
  }
}

/* ==================================================================== */
/* W-COLLECTIVE Wave 2 STAGE D (D5) — ANCHORED-CHANNEL MATERIALISATION    */
/* ==================================================================== */
/**
 * Create-or-refresh a `cap_table` / `company_followers` channel from DURABLE
 * ROWS, and persist it with its 0117 anchors.
 *
 * THE BUG THIS CLOSES. Wave 1 made `GET /api/comms/posts/:id` fail closed when a
 * post's channel cannot be resolved. Correct — but nothing ever created those
 * two channel kinds outside the demo seed, so on live EVERY cap-table and
 * company-followers post was orphaned and post detail returned 403 to its own
 * author. Stage D may not ship with those posts still inaccessible.
 *
 * Participants come from `server/lib/commsChannelAnchors.ts`:
 *   cap_table         → active founders ∪ committed `captable_commits` holders
 *   company_followers → active founders ∪ live `company_followers` rows
 * No seed array, no hardcoded id, nothing in memory: the same inputs rebuild the
 * same channel after any restart.
 *
 * `soft_circle` is DELIBERATELY EXCLUDED — see the STOP-condition note in
 * commsChannelAnchors.ts. It keeps its exact pre-D5 behaviour.
 *
 * Idempotent. Returns the channel, or `undefined` when the id is not an anchored
 * kind or its company cannot be resolved (in which case the caller's existing
 * fail-closed path stands).
 */
/**
 * STAGE-D BLOCKER FIX B4a - union of a persisted participant list and a
 * re-derived one. ORDER-STABLE (persisted order first, then newly derived in
 * derivation order) and de-duplicated. Never shrinks: a persisted participant
 * that can no longer be derived is KEPT and logged at warn, because the
 * alternative is a silent, invisible loss of access on restart.
 */
/**
 * STAGE-D BLOCKER FIX B4b - WRITE authority for a `company_followers` channel:
 * the company's own ACTIVE founders (durable `company_members` rows, resolved by
 * `founderUserIdsOfCompany`) and nobody else. Fail-closed on an unresolvable
 * company id or any read error.
 */
function mayWriteToFollowersChannel(ch: Channel, actorId: string): boolean {
  if (!actorId) return false;
  try {
    const companyId =
      ch.companyId ??
      resolveChannelAnchors(ch).companyId ??
      (ch.metadata as { companyId?: string } | undefined)?.companyId;
    if (!companyId) return false;
    return founderUserIdsOfCompany(String(companyId)).includes(actorId);
  } catch {
    return false;
  }
}

function unionParticipants(
  persisted: readonly string[] | undefined,
  derived: readonly string[] | undefined,
  channelId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of persisted ?? []) {
    if (typeof u !== "string" || u.trim() === "" || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  const derivedList = (derived ?? []).filter((u) => typeof u === "string" && u.trim() !== "");
  const derivedSet = new Set(derivedList);
  for (const u of derivedList) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  const orphans = (persisted ?? []).filter((u) => typeof u === "string" && u.trim() !== "" && !derivedSet.has(u));
  if (orphans.length > 0) {
    log.warn(
      `[commsStore.ensureAnchoredChannel] ${channelId}: ${orphans.length} persisted participant(s) are not re-derivable from durable rows and were KEPT (no silent drop): ${orphans.join(", ")}`,
    );
  }
  return out;
}

/**
 * STAGE-D BLOCKER FIX B4a - read the PERSISTED channel row when the in-memory
 * map has no entry yet. Without this, a request that materialises an anchored
 * channel BEFORE `hydrateCommsStore` has loaded it (cold worker, first request
 * in a fresh PM2 process) rebuilds it from derived rows only and then
 * `persistChannel` OVERWRITES the durable participant list - the same silent
 * drop, one layer earlier. Fail-soft: an unreadable row simply means "no
 * persisted list", never a throw.
 */
function persistedChannelRow(channelId: string): Channel | undefined {
  try {
    const row = (rawDb() as any).prepare(
      `SELECT id, kind, participant_user_ids_json, created_at, metadata_json,
              company_id, round_id, chapter_id
         FROM comms_channels WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    ).get(channelId) as any;
    if (!row) return undefined;
    let participantUserIds: string[] = [];
    let metadata: any = undefined;
    try { participantUserIds = JSON.parse(row.participant_user_ids_json ?? "[]"); } catch { /* */ }
    try { if (row.metadata_json) metadata = JSON.parse(row.metadata_json); } catch { /* */ }
    if (!Array.isArray(participantUserIds)) participantUserIds = [];
    return {
      id: row.id,
      kind: row.kind as Channel["kind"],
      participantUserIds,
      createdAt: row.created_at,
      metadata,
      ...(row.company_id ? { companyId: row.company_id as string } : {}),
      ...(row.round_id ? { roundId: row.round_id as string } : {}),
    } as Channel;
  } catch {
    return undefined;
  }
}

function ensureAnchoredChannel(channelId: string): Channel | undefined {
  const decoded = decodeChannelIdAnchors(channelId);
  if (decoded.kind !== "cap_table" && decoded.kind !== "company_followers") return undefined;
  const kind = decoded.kind as AnchoredChannelKind;
  const existing = channels.get(channelId) ?? persistedChannelRow(channelId);
  const anchors = existing ? resolveChannelAnchors(existing) : decoded.anchors;
  const companyId = anchors.companyId;
  if (!companyId) return existing;

  const participants = durableParticipantsFor(kind, { companyId });
  /* An anchored channel with NO derivable participants is NOT materialised with
     an empty list — that would create a channel nobody, including the founder,
     can read, and would mask the real cause. The caller's fail-closed path then
     applies, and the durable membership check in `postIsVisibleToViewer` still
     admits anyone the rows do authorise. */
  if (participants.length === 0 && !existing) return undefined;

  const founders = founderUserIdsOfCompany(companyId);
  const ch: Channel = existing
    ? {
        ...existing,
        companyId,
        /* STAGE-D BLOCKER FIX B4a - MERGE, NEVER REPLACE.
           This used to be `participants.length ? participants : existing...`,
           i.e. the re-derived set REPLACED the persisted one, so every
           persisted participant that is not re-derivable (an invited-round
           investor backfilled by Stage C at :1528, a seeded or legacy channel
           member) was SILENTLY DROPPED on restart - an access removal nobody
           asked for and nobody could see. A hydration pass must never shrink a
           participant list. Union, de-duplicated, persisted-first so the order
           is stable across restarts. */
        participantUserIds: unionParticipants(
          existing.participantUserIds,
          participants,
          channelId,
        ),
      }
    : {
        id: channelId,
        kind: kind as ChannelKind,
        companyId,
        participantUserIds: participants,
        createdAt: nowIso(),
        metadata: {
          title:
            kind === "cap_table"
              ? `Cap Table · ${durableCompanyName(companyId) || companyId}`
              : `${durableCompanyName(companyId) || companyId} · Followers`,
          companyId,
          ...(founders[0] ? { founderUserId: founders[0] } : {}),
          /* Marks the channel as REBUILT-FROM-ROWS rather than seeded, so an
             operator reading the row can tell where its members came from. */
          rebuiltFrom: "durable_rows",
        },
      };
  channels.set(channelId, ch);
  persistChannel(ch);
  backfillChannelAnchors(channelId, { companyId });
  return ch;
}

function persistMessage(m: Message): void {
  try {
    const db: any = rawDb();
    db.prepare(
      `INSERT INTO comms_messages (
         id, channel_id, author_user_id, body, created_at, edited_at, deleted_at,
         reply_to_message_id, attachments_json, starred_by_user_ids_json,
         reactions_json, read_by_user_ids_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         body = excluded.body,
         edited_at = excluded.edited_at,
         deleted_at = excluded.deleted_at,
         attachments_json = excluded.attachments_json,
         starred_by_user_ids_json = excluded.starred_by_user_ids_json,
         reactions_json = excluded.reactions_json,
         read_by_user_ids_json = excluded.read_by_user_ids_json`,
    ).run(
      m.id,
      m.channelId,
      m.authorUserId,
      m.body,
      m.createdAt,
      m.editedAt ?? null,
      m.deletedAt ?? null,
      m.replyToMessageId ?? null,
      JSON.stringify(m.attachments ?? []),
      JSON.stringify(m.starredByUserIds ?? []),
      JSON.stringify(m.reactions ?? []),
      JSON.stringify(m.readByUserIds ?? []),
    );
  } catch (err) {
    log.warn("[commsStore.persistMessage] DB write failed (continuing in-memory):", (err as Error).message);
  }
}

/** Read messages for a channel from DB (used when the in-memory Map doesn't
 *  have them — e.g. another PM2 worker created them, or this worker just
 *  booted and hasn't hydrated yet).
 */
function loadChannelMessagesFromDb(channelId: string): Message[] {
  try {
    const db: any = rawDb();
    const rows = db.prepare(
      `SELECT id, channel_id, author_user_id, body, created_at, edited_at, deleted_at,
              reply_to_message_id, attachments_json, starred_by_user_ids_json,
              reactions_json, read_by_user_ids_json
       FROM comms_messages
       WHERE channel_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC`
    ).all(channelId) as any[];
    return rows.map((r: any) => ({
      id: r.id,
      channelId: r.channel_id,
      authorUserId: r.author_user_id,
      body: r.body,
      createdAt: r.created_at,
      editedAt: r.edited_at ?? undefined,
      deletedAt: r.deleted_at ?? undefined,
      replyToMessageId: r.reply_to_message_id ?? undefined,
      attachments: r.attachments_json ? JSON.parse(r.attachments_json) : undefined,
      starredByUserIds: r.starred_by_user_ids_json ? JSON.parse(r.starred_by_user_ids_json) : [],
      reactions: r.reactions_json ? JSON.parse(r.reactions_json) : [],
      readByUserIds: r.read_by_user_ids_json ? JSON.parse(r.read_by_user_ids_json) : [],
    }));
  } catch (err) {
    log.warn("[commsStore.loadChannelMessagesFromDb] DB read failed:", (err as Error).message);
    return [];
  }
}

/** Idempotency-Key dedupe — keyed by (route + key). */
const idemp = new Map<string, { ts: number; result: unknown }>();
const IDEMP_TTL_MS = 24 * 60 * 60 * 1000;

/* ==================================================================== */
/* AUDIT + OUTBOX                                                       */
/* ==================================================================== */

interface CommsOutboxEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor: { userId: string; ip?: string; userAgent?: string };
  payload: Record<string, unknown>;
  auditChain: { priorHash: string; hash: string };
  schemaVersion: "1.0";
}

const outbox: CommsOutboxEvent[] = [];
const auditEntries: Array<{ id: string; ts: string; eventType: string; actorId: string; payloadJson: string; prevHash: string; hash: string }> = [];
let lastHash = "0".repeat(64);

/* W-COLLECTIVE Wave 1 (v4 §1.5) — how many entries the two 500-item comms ring
   buffers have dropped in THIS process. Monotonic process telemetry surfaced on
   /api/healthz.

   W2B B1 — a drop is now the LAST RESORT, not the normal path. Overflow is
   drained to comms_audit_log / comms_outbox_events first (see
   ./commsAuditDurable) and only evicted from memory once that write is
   confirmed. `auditDropped` / `outboxDropped` therefore now count only the
   genuinely unrecoverable case: the durable write kept failing until the hard
   memory ceiling was reached. `auditPersisted` / `outboxPersisted` /
   `drainFailures` make the healthy and degraded paths visible too. */
const commsOverflow = {
  auditDropped: 0,
  outboxDropped: 0,
  auditPersisted: 0,
  outboxPersisted: 0,
  drainFailures: 0,
};

/** Ring size kept resident in memory — unchanged from Wave 1. */
const COMMS_RING_LIMIT = 500;
/* Absolute memory ceiling while the durable drain is failing. Beyond this the
   process would OOM, so entries are dropped and COUNTED. Ten ring-fulls buys
   roughly a sustained-outage window without ever pretending nothing happened. */
const COMMS_RING_HARD_CAP = COMMS_RING_LIMIT * 10;

export function getCommsOverflowCounts(): {
  auditDropped: number;
  outboxDropped: number;
  auditPersisted: number;
  outboxPersisted: number;
  drainFailures: number;
  total: number;
} {
  return {
    auditDropped: commsOverflow.auditDropped,
    outboxDropped: commsOverflow.outboxDropped,
    auditPersisted: commsOverflow.auditPersisted,
    outboxPersisted: commsOverflow.outboxPersisted,
    drainFailures: commsOverflow.drainFailures,
    total: commsOverflow.auditDropped + commsOverflow.outboxDropped,
  };
}

/**
 * W2B B1 — durable drain shared by both ring buffers.
 *
 * Persist the overflow slice BEFORE evicting it. Three outcomes, none silent:
 *   1. drain succeeds        → evict, count as persisted.
 *   2. drain fails          → keep in memory, count a drain failure, retry on
 *                             the next append.
 *   3. drain keeps failing past the hard cap → evict and count as DROPPED,
 *      which /api/healthz surfaces as outboxOverflowCount.
 */
function drainRing<T>(
  buffer: T[],
  persist: (slice: readonly T[]) => { ok: true; persisted: number } | { ok: false; error: string },
  onPersisted: (n: number) => void,
  onDropped: (n: number) => void,
): void {
  if (buffer.length <= COMMS_RING_LIMIT) return;
  const overflowCount = buffer.length - COMMS_RING_LIMIT;
  const slice = buffer.slice(0, overflowCount);
  const result = persist(slice);
  if (result.ok) {
    buffer.splice(0, overflowCount);
    onPersisted(result.persisted);
    return;
  }
  commsOverflow.drainFailures += 1;
  if (buffer.length > COMMS_RING_HARD_CAP) {
    const dropCount = buffer.length - COMMS_RING_LIMIT;
    buffer.splice(0, dropCount);
    onDropped(dropCount);
    log.error(
      `[commsStore] durable drain unavailable and hard cap ${COMMS_RING_HARD_CAP} exceeded — DROPPED ${dropCount} entr(ies). ` +
        `Cumulative dropped: audit=${commsOverflow.auditDropped} outbox=${commsOverflow.outboxDropped}.`,
    );
  }
}

function appendAudit(eventType: string, actorId: string, payload: unknown): { hash: string; prev: string } {
  const id = `comms_audit_${randomBytes(8).toString("hex")}`;
  const ts = new Date().toISOString();
  const prev = lastHash;
  const payloadJson = JSON.stringify(payload);
  const hash = createHash("sha256")
    .update(prev + "|" + id + "|" + eventType + "|" + actorId + "|" + payloadJson + "|" + ts)
    .digest("hex");
  auditEntries.push({ id, ts, eventType, actorId, payloadJson, prevHash: prev, hash });
  lastHash = hash;
  /* W2B B1 — was `auditEntries.splice(0, auditEntries.length - 500)`, which
     amputated the head of a hash chain with no durable copy. The overflow is
     now written to comms_audit_log first and evicted only on success. */
  drainRing(
    auditEntries,
    drainCommsAuditEntries,
    (n) => { commsOverflow.auditPersisted += n; },
    (n) => { commsOverflow.auditDropped += n; },
  );
  return { hash, prev };
}

function emitOutbox(eventType: string, actorId: string, ip: string | undefined, ua: string | undefined, payload: Record<string, unknown>): void {
  const id = `comms_evt_${randomBytes(10).toString("hex")}`;
  const { hash, prev } = appendAudit(eventType, actorId, { eventType, payloadKeys: Object.keys(payload) });
  outbox.push({
    eventId: id,
    eventType,
    occurredAt: new Date().toISOString(),
    actor: { userId: actorId, ip, userAgent: ua },
    payload,
    auditChain: { priorHash: prev, hash },
    schemaVersion: "1.0",
  });
  /* W2B B1 — was `outbox.splice(0, outbox.length - 500)`. Each envelope carries
     `auditChain: {priorHash, hash}`, so dropping one dropped a chain link. */
  drainRing(
    outbox,
    drainCommsOutboxEvents,
    (n) => { commsOverflow.outboxPersisted += n; },
    (n) => { commsOverflow.outboxDropped += n; },
  );
}

/**
 * v14 (Tier-1 Fix 1) — identity strictly from session userContext or cap_uid
 * cookie. Header identity (x-user-id / x-actor-id) is no longer consulted in
 * production; the v14 lint test enforces this.
 */
function actorOf(req: Request): { actorId: string; ip: string | undefined; ua: string | undefined } {
  const ctxUserId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId;
  const cookieOrQuery = resolvePersonaId(req); // cookie or ?userId= only — no header identity
  const actorId = ctxUserId ?? cookieOrQuery ?? null;
  if (!actorId) {
    const err: Error & { status?: number } = new Error("missing_identity");
    err.status = 401;
    throw err;
  }
  return { actorId, ip: req.ip, ua: req.headers["user-agent"] as string | undefined };
}

function nowIso(): string { return new Date().toISOString(); }

/* ==================================================================== */
/* SEED DATA — channels, messages, posts                                 */
/* ==================================================================== */

const SEED_NOW = "2026-05-08T20:00:00Z";
const SEED_CAPTABLE_NOVAPAY = capTableChannelId("co_novapay");
const SEED_SOFTCIRCLE_SEED = softCircleChannelId("rnd_seed");
const SEED_FOLLOWERS_NOVAPAY = companyFollowersChannelId("co_novapay");
const SEED_NETWORK_AISHA = networkChannelId("u_aisha_patel");
const SEED_NETWORK_MAYA = networkChannelId("u_maya_chen");

function seedChannel(channel: Channel): void {
  channels.set(channel.id, channel);
}

function seedMessage(msg: Message): void {
  messages.set(msg.id, msg);
}

function seedPost(post: Post): void {
  posts.set(post.id, post);
}

function seedAll(): void {
  /* ---- Cap-table channel for NovaPay ---- */
  seedChannel({
    id: SEED_CAPTABLE_NOVAPAY,
    kind: "cap_table",
    companyId: "co_novapay",
    participantUserIds: [
      "u_maya_chen", "u_daniel_okafor", "u_hydra_capital",
      "u_forge_ventures", "u_avocado_angels", "u_northstar_angels", "u_aisha_patel",
    ],
    createdAt: "2024-09-01T00:00:00Z",
    metadata: {
      title: "NovaPay AI — Cap Table",
      founderUserId: "u_maya_chen",
      visibleMemberCount: 5, // 7 total, 2 anonymous
    },
  });

  /* ---- Soft-circle channel for the Seed Extension round ---- */
  seedChannel({
    id: SEED_SOFTCIRCLE_SEED,
    kind: "soft_circle",
    companyId: "co_novapay",
    roundId: "rnd_seed",
    participantUserIds: [
      "u_maya_chen", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels", "u_aisha_patel",
    ],
    createdAt: "2026-04-19T12:00:00Z",
    metadata: {
      title: "NovaPay Seed Extension — Soft-Circle",
      founderUserId: "u_maya_chen",
      roundName: "NovaPay Seed Extension",
      memberSummary: "4 soft-circlers + founder",
    },
  });

  /* ---- Company-followers channel for NovaPay ---- */
  seedChannel({
    id: SEED_FOLLOWERS_NOVAPAY,
    kind: "company_followers",
    companyId: "co_novapay",
    participantUserIds: ["u_aisha_patel", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
    createdAt: "2024-04-01T00:00:00Z",
    metadata: { title: "NovaPay AI — Followers", founderUserId: "u_maya_chen" },
  });

  /* ---- Network channels for the active demo users ---- */
  seedChannel({
    id: SEED_NETWORK_AISHA,
    kind: "network",
    participantUserIds: ["u_aisha_patel", "u_maya_chen", "u_hydra_capital", "u_bluepoint_angels"],
    createdAt: "2025-10-01T00:00:00Z",
    metadata: { title: "Aisha's network", ownerUserId: "u_aisha_patel" },
  });
  seedChannel({
    id: SEED_NETWORK_MAYA,
    kind: "network",
    participantUserIds: ["u_maya_chen", "u_daniel_okafor", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels", "u_aisha_patel"],
    createdAt: "2024-04-01T00:00:00Z",
    metadata: { title: "Maya's network", ownerUserId: "u_maya_chen" },
  });

  /* ---- DMs (a few pre-existing 1:1s) ---- */
  const dm1 = dmChannelId("u_aisha_patel", "u_maya_chen");
  seedChannel({
    id: dm1,
    kind: "dm",
    participantUserIds: ["u_aisha_patel", "u_maya_chen"],
    createdAt: "2026-04-25T10:00:00Z",
    // v25.45 R9 — neutral seeded DM title; projectChannel() rebuilds the
    // viewer-resolved displayTitle through resolveIdentity() at render time.
    // Storing raw legal names here was a privacy leak via channel.metadata.title.
    metadata: { title: "Direct message" },
  });
  const dm2 = dmChannelId("u_aisha_patel", "u_hydra_capital");
  seedChannel({
    id: dm2,
    kind: "dm",
    participantUserIds: ["u_aisha_patel", "u_hydra_capital"],
    createdAt: "2026-04-19T15:30:00Z",
    // v25.45 R9 — neutral seeded DM title (see above).
    metadata: { title: "Direct message" },
  });
  const dm3 = dmChannelId("u_maya_chen", "u_hydra_capital");
  seedChannel({
    id: dm3,
    kind: "dm",
    participantUserIds: ["u_maya_chen", "u_hydra_capital"],
    createdAt: "2026-04-15T09:00:00Z",
    // v25.45 R9 — neutral seeded DM title (see above).
    metadata: { title: "Direct message" },
  });

  /* ---- Messages: cap-table channel ---- */
  seedMessage({
    id: "msg_ct_1", channelId: SEED_CAPTABLE_NOVAPAY, authorUserId: "u_maya_chen",
    body: "Welcome everyone — this is our cap-table channel. I'll post Q-end financial updates here on the 5th of each quarter.",
    createdAt: "2024-09-02T16:00:00Z",
    starredByUserIds: ["u_aisha_patel"], reactions: [{ emoji: "👋", userIds: ["u_hydra_capital", "u_forge_ventures"] }],
    readByUserIds: ["u_maya_chen", "u_daniel_okafor", "u_hydra_capital", "u_forge_ventures", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_ct_2", channelId: SEED_CAPTABLE_NOVAPAY, authorUserId: "u_hydra_capital",
    body: "Welcome from Hydra. Glad to be the lead seed. Always happy to introduce other investors at A.",
    createdAt: "2024-09-02T17:14:00Z",
    starredByUserIds: [], reactions: [{ emoji: "🙌", userIds: ["u_maya_chen"] }],
    readByUserIds: ["u_maya_chen", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_ct_3", channelId: SEED_CAPTABLE_NOVAPAY, authorUserId: "u_avocado_angels",
    body: "Quick question — is the cohort retention chart in the Q1 update gross or net of refunds?",
    createdAt: "2026-04-13T10:22:00Z",
    starredByUserIds: [], reactions: [],
    readByUserIds: ["u_maya_chen", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_ct_4", channelId: SEED_CAPTABLE_NOVAPAY, authorUserId: "u_maya_chen",
    body: "Net of refunds. We can pull a gross-stamped version if helpful.",
    createdAt: "2026-04-13T10:48:00Z",
    starredByUserIds: [], reactions: [{ emoji: "👍", userIds: ["u_avocado_angels"] }],
    readByUserIds: ["u_maya_chen", "u_aisha_patel", "u_hydra_capital"],
    replyToMessageId: "msg_ct_3",
  });
  seedMessage({
    id: "msg_ct_5", channelId: SEED_CAPTABLE_NOVAPAY, authorUserId: "u_aisha_patel",
    body: "Thanks Maya. The 142% NRR is impressive — what's the cohort breakdown by industry?",
    createdAt: "2026-05-08T13:45:00Z",
    starredByUserIds: ["u_maya_chen"], reactions: [],
    readByUserIds: ["u_aisha_patel"],
  });

  /* ---- Messages: soft-circle channel ---- */
  seedMessage({
    id: "msg_sc_1", channelId: SEED_SOFTCIRCLE_SEED, authorUserId: "u_maya_chen",
    body: "Welcome to the Seed Extension soft-circle channel. The aim is $4M total, $2.65M committed, $1.35M to go. Targeting close on July 15.",
    createdAt: "2026-04-19T12:30:00Z",
    starredByUserIds: ["u_hydra_capital", "u_forge_ventures"], reactions: [{ emoji: "🚀", userIds: ["u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"] }],
    readByUserIds: ["u_maya_chen", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
  });
  seedMessage({
    id: "msg_sc_2", channelId: SEED_SOFTCIRCLE_SEED, authorUserId: "u_hydra_capital",
    body: "Confirming Hydra's $1.5M lead. Term sheet is in the dataroom — section 4.3 is the one we want to anchor on.",
    createdAt: "2026-04-19T14:02:00Z",
    starredByUserIds: ["u_maya_chen"], reactions: [{ emoji: "✅", userIds: ["u_maya_chen"] }],
    readByUserIds: ["u_maya_chen", "u_hydra_capital", "u_forge_ventures"],
  });
  seedMessage({
    id: "msg_sc_3", channelId: SEED_SOFTCIRCLE_SEED, authorUserId: "u_forge_ventures",
    body: "Forge in for $750k. We'll wire from our growth fund this time, not the seed vehicle.",
    createdAt: "2026-04-25T09:14:00Z",
    starredByUserIds: [], reactions: [{ emoji: "🙌", userIds: ["u_maya_chen", "u_hydra_capital"] }],
    readByUserIds: ["u_maya_chen", "u_hydra_capital", "u_forge_ventures"],
  });
  seedMessage({
    id: "msg_sc_4", channelId: SEED_SOFTCIRCLE_SEED, authorUserId: "u_bluepoint_angels",
    body: "Bluepoint syndicate at $400k intent. Syndicating amongst 12 individual angels; will firm up by Friday.",
    createdAt: "2026-05-04T14:33:00Z",
    starredByUserIds: [], reactions: [],
    readByUserIds: ["u_bluepoint_angels", "u_maya_chen"],
  });
  seedMessage({
    id: "msg_sc_5", channelId: SEED_SOFTCIRCLE_SEED, authorUserId: "u_maya_chen",
    body: "Great — we have $2.65M of $4M committed. 4 weeks to close. I'll share the closing checklist on the 15th.",
    createdAt: "2026-05-07T17:30:00Z",
    starredByUserIds: ["u_hydra_capital"], reactions: [{ emoji: "💪", userIds: ["u_hydra_capital", "u_forge_ventures"] }],
    readByUserIds: ["u_maya_chen", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
  });

  /* ---- DMs ---- */
  seedMessage({
    id: "msg_dm1_1", channelId: dm1, authorUserId: "u_maya_chen",
    body: "Hi Aisha — saw you accepted the Seed Extension invitation. Welcome aboard. Happy to do a 30-min catch-up this week if useful.",
    createdAt: "2026-04-25T10:14:00Z",
    starredByUserIds: [], reactions: [], readByUserIds: ["u_maya_chen", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_dm1_2", channelId: dm1, authorUserId: "u_aisha_patel",
    body: "Thanks Maya. Tuesday 2pm PT works. Quick q — is the term sheet from Hydra still anchoring?",
    createdAt: "2026-04-25T11:02:00Z",
    starredByUserIds: [], reactions: [], readByUserIds: ["u_maya_chen", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_dm1_3", channelId: dm1, authorUserId: "u_maya_chen",
    body: "Yes. Added a 1.5x liquidation preference cap per your earlier feedback.",
    createdAt: "2026-04-25T11:48:00Z",
    starredByUserIds: ["u_aisha_patel"], reactions: [{ emoji: "👍", userIds: ["u_aisha_patel"] }], readByUserIds: ["u_maya_chen", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_dm1_4", channelId: dm1, authorUserId: "u_maya_chen",
    body: "We can ship the redacted dataroom by Friday — does that work?",
    createdAt: "2026-05-08T13:45:00Z",
    starredByUserIds: [], reactions: [], readByUserIds: ["u_maya_chen"],
  });

  seedMessage({
    id: "msg_dm2_1", channelId: dm2, authorUserId: "u_hydra_capital",
    body: "Hi Aisha — Hydra's leading the Seed Extension with $1.5M. Happy to chat through the term sheet if useful.",
    createdAt: "2026-04-19T15:35:00Z",
    starredByUserIds: [], reactions: [], readByUserIds: ["u_hydra_capital", "u_aisha_patel"],
  });
  seedMessage({
    id: "msg_dm2_2", channelId: dm2, authorUserId: "u_aisha_patel",
    body: "Thanks for the intro. I'm taking $750k. Will wire by EOM after KYC clears.",
    createdAt: "2026-04-19T16:10:00Z",
    starredByUserIds: [], reactions: [{ emoji: "💪", userIds: ["u_hydra_capital"] }], readByUserIds: ["u_hydra_capital", "u_aisha_patel"],
  });

  seedMessage({
    id: "msg_dm3_1", channelId: dm3, authorUserId: "u_maya_chen",
    body: "Quick board-prep nudge: can we sync on the H2 hiring plan before Tuesday?",
    createdAt: "2026-04-15T09:14:00Z",
    starredByUserIds: [], reactions: [], readByUserIds: ["u_maya_chen", "u_hydra_capital"],
  });
  seedMessage({
    id: "msg_dm3_2", channelId: dm3, authorUserId: "u_hydra_capital",
    body: "Sure — let's do Mon 4pm PT. I'll send a calendar.",
    createdAt: "2026-04-15T09:32:00Z",
    starredByUserIds: ["u_maya_chen"], reactions: [], readByUserIds: ["u_maya_chen", "u_hydra_capital"],
  });

  /* ---- Posts: network feed ---- */
  // Maya's network posts
  seedPost({
    id: "post_n_1", channelId: SEED_NETWORK_MAYA, authorUserId: "u_maya_chen", authorKind: "user",
    body: "Just wrapped a deep architecture review with our core engineering team. Excited to share that we're hitting 142% NRR for Q1 — a record for us. Onward to Series A.",
    createdAt: "2026-05-08T11:30:00Z", visibility: "network",
    likedByUserIds: ["u_aisha_patel", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
    commentCount: 2,
    comments: [
      { id: "c_1", userId: "u_hydra_capital", body: "Phenomenal NRR. Onward!", createdAt: "2026-05-08T11:45:00Z" },
      { id: "c_2", userId: "u_aisha_patel", body: "Strong. Looking forward to the Q2 update.", createdAt: "2026-05-08T12:08:00Z" },
    ],
    shareCount: 3,
  });
  seedPost({
    id: "post_n_2", channelId: SEED_NETWORK_MAYA, authorUserId: "u_maya_chen", authorKind: "user",
    body: "We're hiring two senior ML engineers. If you know anyone obsessed with agentic systems and payments rails, send them my way.",
    createdAt: "2026-05-06T14:00:00Z", visibility: "network",
    likedByUserIds: ["u_hydra_capital", "u_aisha_patel"],
    commentCount: 1,
    comments: [{ id: "c_3", userId: "u_forge_ventures", body: "Will share with our portfolio.", createdAt: "2026-05-06T14:21:00Z" }],
    shareCount: 5,
  });
  seedPost({
    id: "post_n_3", channelId: SEED_NETWORK_AISHA, authorUserId: "u_aisha_patel", authorKind: "user",
    body: "Thinking out loud: the moat for B2B fintech in 2026 isn't the rails — it's the AI orchestration layer on top. Most incumbents will rent compute, not build the model layer.",
    createdAt: "2026-05-07T16:00:00Z", visibility: "network",
    likedByUserIds: ["u_maya_chen", "u_hydra_capital", "u_bluepoint_angels"],
    commentCount: 2,
    comments: [
      { id: "c_4", userId: "u_maya_chen", body: "Agreed — and the implementation SLA is becoming the deal closer.", createdAt: "2026-05-07T16:14:00Z" },
      { id: "c_5", userId: "u_hydra_capital", body: "Matches our thesis.", createdAt: "2026-05-07T16:42:00Z" },
    ],
    shareCount: 1,
  });
  seedPost({
    id: "post_n_4", channelId: SEED_NETWORK_AISHA, authorUserId: "u_hydra_capital", authorKind: "user",
    body: "Fresh from Web Summit: the AI infra valuation reset is real. Names previously priced at 25x ARR are clearing at 12x. Good news for series A pricing.",
    createdAt: "2026-05-05T08:30:00Z", visibility: "network",
    likedByUserIds: ["u_aisha_patel", "u_forge_ventures"],
    commentCount: 1,
    comments: [{ id: "c_6", userId: "u_aisha_patel", body: "We're seeing the same.", createdAt: "2026-05-05T08:45:00Z" }],
    shareCount: 2,
  });
  seedPost({
    id: "post_n_5", channelId: SEED_NETWORK_AISHA, authorUserId: "u_bluepoint_angels", authorKind: "user",
    body: "Bluepoint just closed our 12th syndicate of the year. Average ticket: $310k. The angel network model is back, in a big way.",
    createdAt: "2026-05-03T18:14:00Z", visibility: "network",
    likedByUserIds: ["u_aisha_patel"], commentCount: 0, comments: [], shareCount: 0,
  });

  /* ---- Posts: NovaPay company-followers ---- */
  seedPost({
    id: "post_f_1", channelId: SEED_FOLLOWERS_NOVAPAY, authorUserId: "u_maya_chen", authorKind: "company",
    body: "📣 Q1 2026 Investor Update is live in your dataroom. Highlights: 142% NRR, $1.4M ARR, 3 design partners signed in EU. Read the full deck via your invitation link.",
    createdAt: "2026-04-12T09:00:00Z", visibility: "followers",
    likedByUserIds: ["u_aisha_patel", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
    commentCount: 0, comments: [], shareCount: 4,
    followingCompanyIds: ["co_novapay"],
  });
  seedPost({
    id: "post_f_2", channelId: SEED_FOLLOWERS_NOVAPAY, authorUserId: "u_maya_chen", authorKind: "company",
    body: "🚀 We're opening our Seed Extension on April 18. $4M target at $18M pre. If you've been on our waitlist, your invitation lands today. DM Maya for any questions.",
    createdAt: "2026-04-18T10:00:00Z", visibility: "followers",
    likedByUserIds: ["u_aisha_patel", "u_hydra_capital"],
    commentCount: 1,
    comments: [{ id: "c_f_1", userId: "u_aisha_patel", body: "Just received the invitation — reviewing now.", createdAt: "2026-04-18T11:08:00Z" }],
    shareCount: 2,
    followingCompanyIds: ["co_novapay"],
  });
  seedPost({
    id: "post_f_3", channelId: SEED_FOLLOWERS_NOVAPAY, authorUserId: "u_maya_chen", authorKind: "company",
    body: "🎉 NovaPay was featured in TechCrunch this morning. Full article in the dataroom under press/. 'AI-orchestrated treasury routing' is a sentence that took 18 months to earn.",
    createdAt: "2026-04-25T17:00:00Z", visibility: "followers",
    likedByUserIds: ["u_aisha_patel", "u_hydra_capital", "u_forge_ventures"],
    commentCount: 0, comments: [], shareCount: 6,
    followingCompanyIds: ["co_novapay"],
  });
  seedPost({
    id: "post_f_4", channelId: SEED_FOLLOWERS_NOVAPAY, authorUserId: "u_maya_chen", authorKind: "company",
    body: "🤝 Welcoming Bluepoint Angels Syndicate to the soft-circle book — $400k. Excited to have them aboard.",
    createdAt: "2026-05-05T14:33:00Z", visibility: "followers",
    likedByUserIds: ["u_bluepoint_angels", "u_hydra_capital"],
    commentCount: 0, comments: [], shareCount: 1,
    followingCompanyIds: ["co_novapay"],
  });
  seedPost({
    id: "post_f_5", channelId: SEED_FOLLOWERS_NOVAPAY, authorUserId: "u_maya_chen", authorKind: "company",
    body: "📊 Q1 board deck attached. We crossed $1.4M ARR in March (vs. $1.1M plan). LTV/CAC at 4.2x.",
    createdAt: "2026-04-03T08:14:00Z", visibility: "followers",
    likedByUserIds: ["u_hydra_capital", "u_aisha_patel"], commentCount: 0, comments: [], shareCount: 0,
    followingCompanyIds: ["co_novapay"],
  });

  // Append more posts to reach >=15 in the network feed.
  const extraNetworkPosts: Array<Omit<Post, "channelId">> = [
    {
      id: "post_n_6", authorUserId: "u_forge_ventures", authorKind: "user",
      body: "Three trends I'm watching in fintech for Q3: (1) consolidation in cross-border B2B, (2) the embedded finance plateau, (3) regulatory tailwinds in APAC.",
      createdAt: "2026-05-02T09:00:00Z", visibility: "network",
      likedByUserIds: ["u_aisha_patel", "u_hydra_capital"], commentCount: 0, comments: [], shareCount: 1,
    },
    {
      id: "post_n_7", authorUserId: "u_aisha_patel", authorKind: "user",
      body: "Greenwood is officially open for our 2026 deployment cycle. Targeting 12 new investments at seed–A. Heavy focus on AI infra + B2B fintech.",
      createdAt: "2026-04-30T11:00:00Z", visibility: "network",
      likedByUserIds: ["u_maya_chen", "u_bluepoint_angels"], commentCount: 0, comments: [], shareCount: 0,
    },
    {
      id: "post_n_8", authorUserId: "u_maya_chen", authorKind: "user",
      body: "Spent the morning at our largest customer's HQ. Their finance team says NovaPay shaved 18 hours/week off reconciliation. Best metric I've heard all month.",
      createdAt: "2026-04-29T14:30:00Z", visibility: "network",
      likedByUserIds: ["u_aisha_patel", "u_hydra_capital", "u_forge_ventures", "u_bluepoint_angels"],
      commentCount: 0, comments: [], shareCount: 2,
    },
    {
      id: "post_n_9", authorUserId: "u_hydra_capital", authorKind: "user",
      body: "Reminder: pro-rata rights only protect you in priced rounds. SAFE caps don't. Founders should be careful when stacking SAFEs ahead of their first priced round.",
      createdAt: "2026-04-28T10:00:00Z", visibility: "network",
      likedByUserIds: ["u_aisha_patel", "u_forge_ventures"], commentCount: 0, comments: [], shareCount: 4,
    },
    {
      id: "post_n_10", authorUserId: "u_bluepoint_angels", authorKind: "user",
      body: "Today's lesson from running 50+ syndicates: angels who say 'I'll think about it' overwhelmingly mean no. The fast no is a gift.",
      createdAt: "2026-04-27T19:00:00Z", visibility: "network",
      likedByUserIds: ["u_aisha_patel", "u_forge_ventures", "u_hydra_capital", "u_maya_chen"],
      commentCount: 0, comments: [], shareCount: 8,
    },
  ];
  for (const p of extraNetworkPosts) {
    seedPost({ ...p, channelId: SEED_NETWORK_AISHA });
  }
}

// Patch v4: only seed demo channels/messages/posts/users when demo gate is on.
if (DEMO_SEED_ENABLED) {
  seedAll();
}

/* ==================================================================== */
/* HELPERS — visibility, gating                                         */
/* ==================================================================== */

/**
 * DEF-038: Return minimal stub instead of Aisha's profile for unknown actors.
 *
 * D3 (:963) — re-sourced. On live this ALWAYS returned the stub, whose
 * `capTables` and `collectiveChapters` are empty, so `sharedContextBetween()`
 * always computed "no shared context" for every pair of real users.
 *
 * WHY THIS CANNOT WIDEN DISCLOSURE: the shared context it feeds is consumed by
 * `resolveDisplayIdentity`, whose result is OVERRIDDEN two blocks below by the
 * SACRED `resolveDisplayName` for every pairing except self-view and a founder
 * viewing their own channel. Real shared context therefore only ever improves
 * the surfaces that were already permitted — it never becomes the deciding
 * factor for someone else's name.
 */
function viewerOf(actorId: string): UserRef {
  return (commsUserRef(actorId) as UserRef | undefined) ?? {
    id: actorId, legalName: actorId,
    email: "", visibility: { visibleToCoMembers: false, visibleToCollectiveNetwork: false },
    capTables: [], collectiveChapters: [], roles: [],
  } as UserRef;
}

/** Compute shared context between viewer and target user. */
function sharedContextBetween(a: UserRef, b: UserRef): { capTables: string[]; chapters: string[] } {
  const capTables = a.capTables.filter((c) => b.capTables.includes(c));
  const chapters = a.collectiveChapters.filter((c) => b.collectiveChapters.includes(c));
  return { capTables, chapters };
}

/**
 * Resolve a display identity for `authorUserId` from `viewerUserId`'s POV.
 * Founder pass-through is honoured when surface = the founder's company.
 */
function resolveIdentity(
  viewerUserId: string,
  authorUserId: string,
  founderUserId?: string,
  /* W-AVI65 FIX 2 — set for DIRECT MESSAGE surfaces so co-membership is computed
     with the widened founder↔investor predicate (see areDmCoMembers). Absent =
     unchanged legacy behavior (investor↔investor ledger rule only). */
  /* W-COLLECTIVE Wave 2 Stage C (C4) — set for SOCIAL surfaces (network and
     company-follower post bylines, comment author labels, reaction history) so
     the name resolves in the `collectiveDirectory` context, which requires the
     subject's EXPLICIT opt-in. Absent = unchanged counterparty ("message")
     behaviour, which cap_table-scoped posts and DMs keep. */
  opts?: { dm?: boolean; social?: boolean },
): ReturnType<typeof resolveDisplayIdentity> {
  const v = viewerOf(viewerUserId);
  /* D3 (:996) — re-sourced author ref. Previously the stub on live, which meant
     `a.legalName` was the raw `u_…` id for every author (see the legalName
     recovery below) and `a.visibility` was a hardcoded all-false object rather
     than the author's actual privacy preferences. */
  const a = (commsUserRef(authorUserId) as UserRef | undefined) ?? {
    id: authorUserId, legalName: authorUserId,
    email: "", visibility: { visibleToCoMembers: false, visibleToCollectiveNetwork: false },
    capTables: [], collectiveChapters: [], roles: [],
  } as UserRef;
  const shared = sharedContextBetween(v, a);
  const resolved = resolveDisplayIdentity({
    viewerUserId,
    authorUserId,
    authorLegalName: a.legalName,
    authorVisibility: a.visibility,
    context: {
      sharedCapTables: shared.capTables,
      sharedCollectiveChapters: shared.chapters,
      founderUserId,
    },
  });
  // v25.45 ROUND 7 — messaging is a counterparty surface ONLY between users who
  // are actually on a shared cap table. The viewer is never masked from
  // themselves, and a founder viewing their OWN channel (founderUserId ===
  // authorUserId) still sees real names per F13c. For every other pairing we
  // re-resolve the sender's display name through the single privacy resolver in
  // the "message" context, passing isCoMember computed from the SACRED
  // captable_commits ledger:
  //   - co-members on a shared cap table (no explicit opt-out) → legal name
  //   - non-counterparties → "Private Investor"
  //   - explicit opt-out (visibleToCoMembers:false) → "Private Investor" / screen
  //     name, EVEN between co-members (explicit opt-out wins).
  if (authorUserId && authorUserId !== viewerUserId && authorUserId !== founderUserId) {
    /* W-AVI65 FIX 2 — for DM surfaces use the widened caller-side predicate so a
       FOUNDER on a shared cap table qualifies as a co-member. The SACRED
       investor↔investor rule is still one of its disjuncts (called unchanged),
       so this can only ever ADD true cases, never remove them. Non-DM surfaces
       keep the exact legacy predicate. Co-membership is still proven only from
       durable rows — never from "a DM exists". */
    /* W-COLLECTIVE Wave 2 Stage C (C4) — on a social surface the resolver's
       social branch (userPrivacyResolver.ts:230-233) ignores isCoMember and
       demands `visibleInCollectiveDirectory`, so co-membership is not even
       computed: seeing a post must never be enough to learn an identity the
       owner did not consent to expose socially. */
    const social = opts?.social === true;
    const isCoMember = social
      ? false
      : opts?.dm === true
        ? areDmCoMembers(authorUserId, viewerUserId)
        : areCoMembersOnAnyCapTable(authorUserId, viewerUserId);
    /* COMMS_USERS is EMPTY in production (see its declaration), so `a.legalName`
       degrades to the raw u_… id. Resolve the real name from the DB-backed
       resolver instead; if it cannot be resolved, keep the raw id so the
       resolver's / sanitizeCommsName's existing generic fallbacks apply (a raw
       id is never surfaced). */
    /* D3 — the ref now resolves from the DB too, so prefer its name whenever it
       is a real name (i.e. not the raw id fallback) and only fall back to
       `dbLegalNameFor` when the directory could not name this user at all. */
    const legalName =
      commsUserIsKnown(authorUserId) && a.legalName && a.legalName !== authorUserId
        ? a.legalName
        : dbLegalNameFor(authorUserId, a.legalName);
    const policyName = resolveDisplayName(
      authorUserId,
      viewerUserId,
      social ? "collectiveDirectory" : "message",
      { legalName, isCoMember },
    );
    if (policyName === "Private Investor") {
      return { ...resolved, displayName: policyName, isAnonymous: true };
    }
    return { ...resolved, displayName: sanitizeCommsName(policyName, authorUserId), isAnonymous: false };
  }
  return { ...resolved, displayName: sanitizeCommsName(resolved.displayName, authorUserId) };
}

/* W-AVI65 FIX 2 — resolve a real legal name for a user that is absent from the
   (production-empty) COMMS_USERS map, so the privacy resolver receives a human
   name rather than a raw u_… id. Returns `fallback` unchanged when nothing
   better is resolvable OR the resolver only produced its own placeholder, so
   downstream sanitizeCommsName()/resolver fallbacks stay in charge. Never
   throws. */
function dbLegalNameFor(userId: string, fallback: string): string {
  try {
    const r = resolveDbDisplayName(userId);
    // W-AVI65 REVISE (Gemini blocker) — displayNameResolver returns the user's
    // EMAIL as `.name` with resolved:true when no legal/display name exists
    // (displayNameResolver.ts:107). Rejecting only /^u_/ let that email become
    // the DM displayTitle — a NEW identity leak (the pre-fix raw u_ id was
    // masked). Reject an email (contains '@') and any raw id prefix, matching
    // the "NEVER returns an email" contract of resolveCommsDisplayName below.
    const nm = r?.name?.trim();
    if (r?.resolved && nm && !nm.includes("@") && !/^(u_|usr_|co_|cmp_|rnd_)/i.test(nm)) {
      return r.name;
    }
  } catch { /* fall through to the caller's fallback */ }
  return fallback;
}

/* W-FIX1a A2 — never surface a raw u_…/company:… id or bare email as a display
   name on the messaging surface. If the resolved label still looks like a raw
   id, fall back to the DB-backed resolver, then to a safe generic. */
function sanitizeCommsName(name: string | null | undefined, subjectUserId: string): string {
  // W-AVI65 REVISE R2 (Gemini blocker) — also reject an EMAIL ('@'). FIX 2's
  // co-membership widening routes founder↔investor pairs past the resolver's
  // "Private Investor" early return into THIS backstop, where resolveDbDisplayName
  // can return the user's email as `.name`. Without the '@' guard that email
  // would become the DM displayTitle. Mirrors the sibling guard in
  // resolveCommsDisplayName (which already tests '@').
  const looksUnsafe = (s: string | null | undefined): boolean =>
    !s || String(s).includes("@") || /^(u_|usr_|co_|cmp_|rnd_)/i.test(String(s).trim()) || String(s).trim().length === 0;
  if (!looksUnsafe(name)) return String(name);
  try {
    const r = resolveDbDisplayName(subjectUserId);
    if (r?.name && !looksUnsafe(r.name)) return r.name;
  } catch { /* fall through */ }
  /* D3 (:1102 / :1135) — re-sourced. `COMMS_USERS[subjectUserId]` is ALWAYS
     undefined on live, so this generic backstop labelled EVERY fully onboarded
     Collective member an "Invited contact". `commsUserIsKnown` answers the same
     question ("is this a real platform member?") from the `users` table. */
  return commsUserIsKnown(subjectUserId) ? "Collective member" : "Invited contact";
}

/**
 * W2M B1/B5 (rule #13) — single display-name helper for author/sender labels.
 * Fallback order: privacy-resolver full name -> supplied full name ->
 * company/firm label -> safe generic ("Collective member" / "Invited contact").
 * NEVER returns an email or a raw user id as a display name.
 */
function resolveCommsDisplayName(
  viewerId: string | null,
  subjectUserId: string,
  fallback?: { fullName?: string | null; companyName?: string | null },
): string {
  const looksUnsafe = (s: string | null | undefined): boolean =>
    !s || s.includes("@") || /^u_[a-z0-9_]+$/i.test(s) || s.trim().length === 0;

  // 1) privacy resolver (viewer-aware). Guard against it returning id/email.
  if (viewerId) {
    try {
      const r = resolveIdentity(viewerId, subjectUserId, undefined);
      if (r && !looksUnsafe(r.displayName)) return r.displayName;
    } catch { /* fall through to safe fallbacks */ }
  }

  // 2) supplied full name (only if it is not an email / raw id).
  if (!looksUnsafe(fallback?.fullName)) return fallback!.fullName as string;

  // 3) company / firm label.
  if (!looksUnsafe(fallback?.companyName)) return fallback!.companyName as string;

  // 4) safe generic — never email/id. Prefer "Collective member" for known
  // users, "Invited contact" for not-yet-provisioned CRM-only ids.
  /* D3 (:1102 / :1135) — re-sourced. `COMMS_USERS[subjectUserId]` is ALWAYS
     undefined on live, so this generic backstop labelled EVERY fully onboarded
     Collective member an "Invited contact". `commsUserIsKnown` answers the same
     question ("is this a real platform member?") from the `users` table. */
  return commsUserIsKnown(subjectUserId) ? "Collective member" : "Invited contact";
}

/** Last message of a channel (used for previews). */
function lastMessageOf(channelId: string): Message | undefined {
  let last: Message | undefined;
  for (const m of messages.values()) {
    if (m.channelId !== channelId) continue;
    if (m.deletedAt) continue;
    if (!last || m.createdAt > last.createdAt) last = m;
  }
  return last;
}

function unreadCount(channelId: string, viewerUserId: string): number {
  let n = 0;
  for (const m of messages.values()) {
    if (m.channelId !== channelId) continue;
    if (m.deletedAt) continue;
    if (m.authorUserId === viewerUserId) continue;
    if (!m.readByUserIds.includes(viewerUserId)) n++;
  }
  return n;
}

/**
 * Minimal view of the request's UserContext that the comms membership check
 * needs. Threaded in from route handlers (req.userContext) so the gate can
 * reason about LIVE relationships, not only the static participant list.
 */
type CommsMembershipCtx = {
  userId: string;
  // v24.2 Bug 5 — email is needed to query durable round-invitation rows for
  // secure-redeemed users whose invitedRounds array is empty.
  identity?: { email?: string };
  founder?: { companies?: Array<{ companyId: string }> };
  investor?: {
    capTablePositions?: Array<{ companyId: string }>;
    invitedRounds?: Array<{ companyId: string; roundId: string }>;
  };
} | null | undefined;

/**
 * v24.1 Bug H — derived (live-relationship) membership check.
 *
 * v24.0 lockdown made comms visibility participant-list ONLY. Runtime investors
 * and founders provisioned via invitation redemption are never added to
 * `participantUserIds`, so legitimate users saw an empty channel list or got
 * "403 Not a member of this channel". This helper grants access only after a
 * server-side validation of the ACTUAL relationship between the actor and the
 * channel's company/round:
 *
 *   • Founder of the channel's company        → all access
 *   • Investor holding a cap-table position    → company channels (cap_table,
 *     in the channel's company                   soft_circle, company_followers)
 *   • Investor with a redeemed/invited round    → company-related channels for
 *     in the channel's company                    that company (and matching round
 *                                                  for soft_circle)
 *   • DM participant                            → handled by the static list
 *
 * Tenant isolation is NOT weakened: access is granted ONLY when the actor's own
 * userContext proves the relationship to the SAME companyId (and roundId for
 * soft_circle). `network` channels remain participant-only (no company anchor).
 */
function derivedMembership(channel: Channel, ctx: CommsMembershipCtx): boolean {
  if (!ctx?.userId) return false;
  const companyId = channel.companyId;
  // network + dm channels have no company anchor — never derive membership.
  if (!companyId) return false;
  if (channel.kind === "dm" || channel.kind === "network") return false;

  // Founder of the channel's company → full access.
  const isFounderOfCompany = (ctx.founder?.companies ?? []).some(
    (c) => c.companyId === companyId,
  );
  if (isFounderOfCompany) return true;

  // v24.2 Bug 5 — DURABLE founder-membership fallback. The runtime ctx.founder
  // array can be empty for users hydrated outside the demo persona seed; the
  // multiCompanyStore is the authoritative company_members source.
  try {
    if (getCompaniesForFounder(ctx.userId).some((c) => c.companyId === companyId)) {
      return true;
    }
  } catch {
    // Store unavailable — fall through to investor checks.
  }

  // Investor holding a cap-table position in the channel's company.
  const hasCapTablePosition = (ctx.investor?.capTablePositions ?? []).some(
    (p) => p.companyId === companyId,
  );
  if (hasCapTablePosition) return true;

  // Investor with a redeemed/invited round for the channel's company.
  // v24.2 Bug 5 — do NOT return early on a miss here; an empty invitedRounds
  // array is the NORMAL state for secure-invite-redeemed users, so we must
  // fall through to the durable-store fallback below.
  const invited = ctx.investor?.invitedRounds ?? [];
  if (channel.kind === "soft_circle") {
    // soft_circle is round-scoped: require a matching roundId when present.
    if (
      invited.some(
        (r) =>
          r.companyId === companyId &&
          (!channel.roundId || r.roundId === channel.roundId),
      )
    ) {
      return true;
    }
  } else if (invited.some((r) => r.companyId === companyId)) {
    // cap_table / company_followers: company-level relationship is enough.
    return true;
  }

  // v24.2 Bug 5 — DURABLE fallback. Secure-invite-redeemed users do NOT have a
  // RUNTIME persona, so ctx.investor.invitedRounds is empty even though they
  // have a real, persisted relationship to the company/round. Consult the
  // durable stores by userId + email. Tenant isolation is preserved: every
  // match still requires the SAME companyId (and roundId for soft_circle), so
  // investor B can never derive access to investor A's channels.
  try {
    // (a) Soft-circle relation, keyed by investorUserId.
    const circles = softCircleStore.listForInvestor(ctx.userId);
    if (channel.kind === "soft_circle") {
      if (
        circles.some(
          (c) =>
            c.companyId === companyId &&
            (!channel.roundId || c.roundId === channel.roundId),
        )
      ) {
        return true;
      }
    } else if (circles.some((c) => c.companyId === companyId)) {
      return true;
    }
  } catch {
    // Store unavailable in this process — fall through to the next check.
  }

  try {
    // (b) Durable round invitations, keyed by investor email.
    const email = ctx.identity?.email;
    if (email) {
      const invites = roundInvitationsStore.listForInvestorEmail(email);
      if (channel.kind === "soft_circle") {
        if (
          invites.some(
            (i) =>
              i.companyId === companyId &&
              (!channel.roundId || i.roundId === channel.roundId),
          )
        ) {
          return true;
        }
      } else if (invites.some((i) => i.companyId === companyId)) {
        return true;
      }
    }
  } catch {
    // Store unavailable — fall through.
  }

  return false;
}

function channelIsVisibleToViewer(
  channel: Channel,
  viewerUserId: string,
  ctx?: CommsMembershipCtx,
): boolean {
  // For DMs / cap-table / soft-circle channels: must be a participant.
  // For company_followers + network: same — participant means follower / connection.
  if (channel.participantUserIds.includes(viewerUserId)) return true;
  // v24.1 Bug H: fall back to a live-relationship check for runtime users who
  // were never written into the static participant list.
  if (ctx && derivedMembership(channel, ctx)) {
    // Backfill so subsequent reads/writes are O(1) and consistent.
    if (!channel.participantUserIds.includes(viewerUserId)) {
      channel.participantUserIds.push(viewerUserId);
    }
    return true;
  }
  return false;
}

/**
 * W-COLLECTIVE Wave 2 Stage C — canonical POST-read visibility gate.
 *
 * COMPOSITION, and why each half is shaped this way:
 *
 *  - `kind === "network"` → participant gate **OR** the relationship predicate.
 *    The OR is essential: a per-author network channel has exactly one
 *    participant (the author), so ANDing the two would make the widening
 *    unreachable and Stage C a no-op.
 *  - Every other kind (`cap_table`, `company_followers`, `dm`, `soft_circle`) →
 *    the EXISTING participant gate ONLY, unchanged. `cap_table` posts route
 *    through the same feed loop, so applying a relationship predicate to them
 *    would leak round and ownership detail to company followers and co-chapter
 *    members who are not on the cap table.
 *
 * `channelIsVisibleToViewer` is called WITHOUT `ctx` here (exactly as before),
 * so no derived-membership backfill of `channel.participantUserIds` occurs on a
 * post read, and `viewerCanSeeNetworkPost` never touches the channel at all.
 * READ THEREFORE NEVER CONFERS WRITE: `canMutatePost` keeps reading the
 * untouched participant array.
 *
 * This is a pure widening: it can only ADD visible posts, never remove one.
 */
function postIsVisibleToViewer(
  channel: Channel,
  post: { id: string; authorUserId?: string },
  viewerUserId: string,
): boolean {
  if (channelIsVisibleToViewer(channel, viewerUserId)) return true;
  /* ── W-COLLECTIVE Wave 2 Stage D (D5) — DURABLE anchored-channel membership ──
     The participant array above is a SNAPSHOT taken when the channel was last
     materialised. For the two anchored kinds the authoritative membership is a
     row, and it changes between materialisations: an investor who follows a
     company one minute after its followers channel was built, or who is added to
     a cap table, would otherwise be denied until the next restart — and an
     unfollow would keep working until then.

     `viewerIsDurableChannelMember` answers the SAME question the participant
     array is meant to answer ("is this viewer a member of THIS company's cap
     table / follower set?"), live, from `captable_commits`, `company_members`
     and `company_followers`. It does NOT apply the relationship audience to
     these kinds, and it MUTATES NOTHING — no participant backfill — so reading a
     post can never promote the reader to a channel writer (the invariant
     `server/lib/networkPostAudience.ts` documents and Stage C asserts).
     `soft_circle` returns false there, so funding surfaces are untouched. */
  if (channel.kind === "cap_table" || channel.kind === "company_followers") {
    /* You can always read your OWN post — the D5 acceptance criterion names the
       author first, and an author who has since left the cap table must still be
       able to open the thing they wrote. */
    if (post.authorUserId && post.authorUserId === viewerUserId) return true;
    return viewerIsDurableChannelMember(channel, viewerUserId);
  }
  if (channel.kind !== "network") return false;
  return viewerCanSeeNetworkPost(post, viewerUserId);
}

/**
 * W-COLLECTIVE Wave 2 Stage C (C4) — social identity policy for post surfaces.
 *
 * TRUE when a post's channel is a SOCIAL surface (`network` /
 * `company_followers`), i.e. bylines, comment author labels and reaction
 * history must resolve in the `collectiveDirectory` context, which requires an
 * explicit opt-in (`visibleInCollectiveDirectory`) in the SACRED resolver
 * (server/lib/userPrivacyResolver.ts:230-233). `cap_table`-scoped posts keep
 * their existing counterparty (`"message"`) resolution path.
 *
 * WHY THIS MATTERS NOW. `projectPost` resolved every byline in the counterparty
 * `"message"` context, whose masking branch
 * (server/lib/userPrivacyResolver.ts:220-224) only requires cap-table/DM
 * co-membership — a WEAKER consent test than the social branch. (An earlier
 * document cited :227-233 as that masking branch; that is wrong — :227-229 is a
 * comment and :230-233 is the social branch. Following it literally would have
 * widened social presence without consent.) The inversion was inert while no
 * post was cross-user visible; Stage C's widening makes it a live identity
 * leak, so it is corrected here.
 */
function postSurfaceIsSocial(channel: Channel | undefined): boolean {
  return channel?.kind === "network" || channel?.kind === "company_followers";
}

/** Pull the comms membership context off the request (set by loadUserContext). */
function membershipCtxOf(req: Request): CommsMembershipCtx {
  return (req as Request & { userContext?: CommsMembershipCtx }).userContext;
}

/**
 * B14 (v24.0 LOCKDOWN) — canonical visibility gate for comms mutations.
 *
 * Before v24.0, every comms mutation (star / reaction / read / like / comment /
 * share) loaded the message or post by id and mutated it WITHOUT checking that
 * the caller can actually see the channel it lives in. Any authenticated user
 * could like/comment/react on a private DM, cap-table, or soft-circle post by
 * guessing its id. These helpers mirror the exact gate the read feed already
 * uses (`channelIsVisibleToViewer`) so reads and writes are consistent.
 *
 * Each returns true when the actor may mutate. On failure it writes the
 * appropriate status (404 for missing target, 403 for not-visible) and returns
 * false; callers must `return` immediately.
 */
function canMutateMessage(res: Response, messageId: string, actorId: string): boolean {
  const m = messages.get(messageId);
  if (!m) { res.status(404).json({ message: "Not found" }); return false; }
  const ch = channels.get(m.channelId);
  // A message with no resolvable channel is treated as not-visible (fail safe).
  if (!ch || !channelIsVisibleToViewer(ch, actorId)) {
    res.status(403).json({ message: "Not visible to you" });
    return false;
  }
  return true;
}

function canMutatePost(res: Response, postId: string, actorId: string): boolean {
  const p = posts.get(postId);
  if (!p) { res.status(404).json({ message: "Not found" }); return false; }
  const ch = channels.get(p.channelId);
  if (!ch || !channelIsVisibleToViewer(ch, actorId)) {
    res.status(403).json({ message: "Not visible to you" });
    return false;
  }
  return true;
}

/** Idempotency middleware — read header + dedupe. */
function withIdempotency(req: Request, res: Response, key: string, fn: () => unknown): unknown {
  const k = req.header("Idempotency-Key");
  if (!k) return fn();
  const composite = `${key}::${k}`;
  const now = Date.now();
  // Sweep stale entries.
  for (const [ck, ent] of idemp) if (now - ent.ts > IDEMP_TTL_MS) idemp.delete(ck);
  const hit = idemp.get(composite);
  if (hit) return res.json(hit.result);
  const result = fn();
  idemp.set(composite, { ts: now, result });
  return result;
}

/* ==================================================================== */
/* DERIVED ENRICHMENT (server-side projection)                          */
/* ==================================================================== */

interface ChannelView extends Channel {
  /** Resolved title for the viewer. */
  displayTitle: string;
  /** Resolved subtitle (e.g., "Cap Table · NovaPay AI"). */
  displaySubtitle: string;
  /** Last message preview (resolved sender + body + ts). */
  lastMessage?: { id: string; preview: string; senderLabel: string; ts: string };
  /** Per-viewer unread count. */
  unread: number;
  /** Per-viewer "starred" — at least one starred message in the channel. */
  starred: boolean;
  /** Channel-kind badge label. */
  kindBadge: string;
}

interface MessageView extends Message {
  authorLabel: string;
  authorIsAnonymous: boolean;
  authorRoleBadge: string;
}

interface PostView extends Post {
  authorLabel: string;
  authorRoleBadge: string;
  authorLocation: string;
  authorCapavateAngelNetwork: boolean;
  isAnonymous: boolean;
  /* W-COLLECTIVE Wave 2 Stage D (D1) — ADDITIVE, per-VIEWER follow state.
     `followingCompanyIds` (inherited from `Post`) used to be a field written ON
     THE POST, so one investor following made the button read "Following ✓" for
     EVERY viewer. It is now recomputed per viewer from `company_followers` in
     `projectPost`, and these two fields state the same answer unambiguously so
     the client never has to infer it from a shared array.
     The existing key and its array type are UNCHANGED — nothing is dropped. */
  viewerIsFollowingCompany?: boolean;
  /** The company this post is attributed to, when it is a company post. */
  authorCompanyId?: string;
  /** Total live followers of `authorCompanyId` (public count, no identities). */
  companyFollowerCount?: number;
}

/**
 * W-COLLECTIVE Wave 2 Stage D (D1) — the company a post is ATTRIBUTED to.
 *
 * Resolution order, all durable: the in-memory channel's `companyId` → the 0117
 * channel anchor → a decode of the deterministic channel id → the post's own
 * `companyId`. Returns "" when the post is not company-attributed, and the
 * caller then reports no follow state at all rather than guessing one.
 *
 * Deliberately restricted by the CALLER to `authorKind === "company"`, exactly
 * mirroring the follow endpoint's own guard, so no new field appears on a post
 * kind that never had one.
 */
function companyIdOfPost(post: Post): string {
  if (post.authorKind !== "company") return "";
  const ch = channels.get(post.channelId);
  if (ch?.companyId) return ch.companyId;
  const anchored = ch
    ? resolveChannelAnchors(ch).companyId
    : decodeChannelIdAnchors(post.channelId).anchors.companyId;
  if (anchored) return anchored;
  const own = (post as Post & { companyId?: string }).companyId;
  return typeof own === "string" && own.trim() ? own.trim() : "";
}

function channelKindBadge(kind: ChannelKind, channel: Channel): string {
  if (kind === "dm") return "DM";
  if (kind === "cap_table") return `Cap Table · ${channel.metadata?.title ?? channel.companyId ?? ""}`;
  if (kind === "soft_circle") return `Soft-Circle · ${channel.metadata?.roundName ?? channel.roundId ?? ""}`;
  if (kind === "company_followers") return "Company Followers";
  return "Network";
}

function projectChannel(channel: Channel, viewerUserId: string): ChannelView {
  const founderUserId = channel.metadata?.founderUserId as string | undefined;
  const last = lastMessageOf(channel.id);
  let displayTitle = (channel.metadata?.title as string) ?? channel.id;
  let displaySubtitle = "";
  if (channel.kind === "dm") {
    const otherId = channel.participantUserIds.find((id) => id !== viewerUserId);
    if (otherId) {
      // W-AVI65 FIX 2 — DM surface: use the widened co-membership predicate.
      const r = resolveIdentity(viewerUserId, otherId, founderUserId, { dm: true });
      displayTitle = r.displayName;
      displaySubtitle = "Direct message";
    }
  } else if (channel.kind === "cap_table") {
    displayTitle = `${channel.metadata?.title ?? "Cap Table"}`;
    displaySubtitle = `${channel.participantUserIds.length} members`;
  } else if (channel.kind === "soft_circle") {
    displayTitle = `${channel.metadata?.title ?? "Soft-Circle"}`;
    displaySubtitle = `${channel.metadata?.memberSummary ?? ""}`;
  } else if (channel.kind === "company_followers") {
    displayTitle = `${channel.metadata?.title ?? "Company Followers"}`;
    displaySubtitle = "Posts feed";
  }
  let lastView: ChannelView["lastMessage"];
  if (last) {
    const r = resolveIdentity(viewerUserId, last.authorUserId, founderUserId, {
      dm: channel.kind === "dm",
    });
    lastView = {
      id: last.id,
      preview: last.body.length > 100 ? last.body.slice(0, 99) + "…" : last.body,
      senderLabel: r.displayName,
      ts: last.createdAt,
    };
  }
  let starred = false;
  for (const m of messages.values()) {
    if (m.channelId === channel.id && m.starredByUserIds.includes(viewerUserId)) {
      starred = true;
      break;
    }
  }
  // v25.45 R9 — DM channel metadata must NEVER expose either party's raw legal
  // name in the projected JSON. Even though displayTitle is resolved through
  // resolveIdentity(), the spread of `channel` carries `metadata.title` through
  // to the API response. For DMs (current and any legacy persisted rows) we
  // rebuild metadata with a sanitized title and strip any other string-valued
  // metadata fields that could plausibly carry a legal name. The neutral title
  // "Direct message" is used; the per-viewer displayTitle (resolver-safe) is
  // the only place a counterparty name may appear, and only when policy allows.
  let safeChannel: Channel = channel;
  if (channel.kind === "dm") {
    const meta = (channel.metadata ?? {}) as Record<string, unknown>;
    const sanitizedMeta: Record<string, unknown> = { ...meta, title: "Direct message" };
    // Defense-in-depth: drop any optional descriptor strings that older seed
    // data may have used to carry counterparty names.
    delete sanitizedMeta.memberSummary;
    delete sanitizedMeta.subtitle;
    delete sanitizedMeta.displayTitle;
    safeChannel = { ...channel, metadata: sanitizedMeta as Channel["metadata"] };
  }
  return {
    ...safeChannel,
    displayTitle,
    displaySubtitle,
    lastMessage: lastView,
    unread: unreadCount(channel.id, viewerUserId),
    starred,
    kindBadge: channelKindBadge(channel.kind, channel),
  };
}

function projectMessage(msg: Message, channel: Channel | undefined, viewerUserId: string): MessageView {
  const founderUserId = channel?.metadata?.founderUserId as string | undefined;
  const r = resolveIdentity(viewerUserId, msg.authorUserId, founderUserId, {
    dm: channel?.kind === "dm",
  });
  /* D3 (:1554) — re-sourced. Every message role badge read "Member" on live. */
  const author = commsUserRef(msg.authorUserId);
  const roleBadge = author?.roles.includes("founder") ? "Founder"
    : author?.roles.includes("soft_circler") ? "Soft-circler"
    : author?.roles.includes("investor") ? "Investor" : "Member";
  return {
    ...msg,
    authorLabel: r.displayName,
    authorIsAnonymous: r.isAnonymous,
    authorRoleBadge: roleBadge,
  };
}

/**
 * 1d — Author label for a Consortium Partner post.
 *
 * The generic identity resolver has no notion of a partner's org identity, so a
 * partner author (whose platform id is often a synthetic `u_redeemed_…`) can
 * leak a raw id into the Posts byline. This applies the QA-specified precedence
 * for a partner author, honoring the user's privacy setting:
 *   1) the partner's chosen SCREEN NAME (if set), unless
 *   2) they've opted to remain anonymous → "Consortium Partner", else
 *   3) their registered / company name (partner org displayName / legalName),
 *      else "Consortium Partner" as a final safe fallback.
 *
 * Returns null when `authorUserId` is not an active Consortium Partner (so the
 * caller keeps the normal resolved label for founders/investors/members).
 */
function resolvePartnerPostAuthorLabel(authorUserId: string): string | null {
  if (!authorUserId) return null;
  let membership: { partnerId: string } | null = null;
  try {
    membership = partnerTeamStore.findByUserId(authorUserId);
  } catch {
    membership = null;
  }
  if (!membership) return null; // not a partner — leave the normal label

  // Privacy: a partner who has opted out of co-member visibility is treated as
  // choosing anonymity on the social surface. If they set a screen name, that
  // wins (that IS their chosen public identity); otherwise show the generic
  // "Consortium Partner" label rather than their org name.
  const privacy = (() => {
    try {
      return readUserPrivacyRaw(authorUserId);
    } catch {
      return null;
    }
  })();
  const screenName = (privacy?.screenName ?? "").trim();
  const isAnonymous = privacy ? privacy.visibleToCoMembers === false : false;

  if (screenName) return screenName; // 1) chosen screen name always wins
  if (isAnonymous) return "Consortium Partner"; // 2) anonymous, no screen name

  // 3) registered / company name, else the generic partner label.
  const orgName = getConsortiumPartnerDisplayName(membership.partnerId);
  return orgName || "Consortium Partner";
}

function projectPost(post: Post, viewerUserId: string): PostView {
  let resolvedName = "";
  let isAnon = false;
  let location = "";
  let cangel = false;
  let role = "Member";
  if (post.authorKind === "company") {
    // Company-authored — render the company name (which is public).
    // DEF-032: Use COMPANY_NAME_MAP keyed by companyId instead of hardcoded "NovaPay AI".
    const ch = channels.get(post.channelId);
    // v14 — no demo fallback; missing companyId yields empty string so the
    // name lookup misses cleanly instead of impersonating NovaPay.
    /* D5 — anchors, so a company post whose channel was not in memory (the
       usual case after a restart) still knows its company. */
    const postCompanyId =
      ch?.companyId ?? (ch ? resolveChannelAnchors(ch).companyId ?? "" : decodeChannelIdAnchors(post.channelId).anchors.companyId ?? "");
    /* W-COLLECTIVE Wave 2 Stage D — LATENT LIVE BUG, now fixed.
       This was a hardcoded five-entry demo map, so on live EVERY company that
       was not one of the five demo ids rendered its RAW `co_…` id as the post
       byline, and the location line below was the literal string
       "San Francisco, CA" for EVERY company post regardless of where the
       company actually is. Both are now read from the `companies` row. The demo
       map is kept ONLY as a last-resort fallback so the seeded demo ids keep
       their expected labels when no `companies` row exists. */
    const COMPANY_NAME_MAP: Record<string, string> = {
      co_novapay: "NovaPay AI",
      co_arboreal: "Arboreal",
      co_quanta: "Quanta Robotics",
      co_beacon: "Beacon Health",
      co_tideline: "Tideline Labs",
    };
    const companyName =
      durableCompanyName(postCompanyId) || COMPANY_NAME_MAP[postCompanyId] || postCompanyId;
    resolvedName = companyName;
    /* D4 — a company byline shows the company HQ. Empty stays empty: both render
       sites guard on `post.authorLocation &&`, so nothing is drawn. */
    location = durableCompanyHq(postCompanyId);
    role = "Company";
  } else {
    /* W-COLLECTIVE Wave 2 Stage C (C4) — the BYLINE of a network or
       company-follower post is a SOCIAL surface and must require the author's
       explicit collective-directory opt-in. Derived from the channel kind here
       (rather than at each of the four call sites) so every projection of the
       same post agrees. cap_table-scoped posts keep the existing path. */
    const bylineCh = channels.get(post.channelId);
    const r = resolveIdentity(viewerUserId, post.authorUserId, undefined, {
      social: postSurfaceIsSocial(bylineCh),
    });
    resolvedName = r.displayName;
    isAnon = r.isAnonymous;
    // 1d — if the author is a Consortium Partner, apply the partner label
    // precedence (screen name → company name → "Consortium Partner") so the
    // byline reflects their chosen identity instead of a raw u_… id.
    const partnerLabel = resolvePartnerPostAuthorLabel(post.authorUserId);
    if (partnerLabel) {
      resolvedName = partnerLabel;
      isAnon = partnerLabel === "Consortium Partner";
    }
    /* D3 (:1657) — re-sourced author ref: was always undefined on live. */
    const author = commsUserRef(post.authorUserId);
    /* D4 (:1657) — AUTHOR LOCATION. Founders show their company HQ (derived
       from `companies.hq`, never duplicated onto the user); investors show their
       optional self-entered `users.location` (migration 0120, settable via
       PATCH /api/users/me/location). Empty remains valid and renders NOTHING. */
    location = durableAuthorLocation(post.authorUserId) || author?.location || "";
    // v24.0 C13: derive the Capavate Angel Network badge from live membership
    // state. Fall back to the static COMMS_USERS field only if the live store
    // is unavailable (e.g. not yet hydrated / import missing).
    if (collectiveMembershipStore && typeof collectiveMembershipStore.isActive === "function") {
      cangel = collectiveMembershipStore.isActive(post.authorUserId);
    } else {
      cangel = author?.capavateAngelNetwork ?? false;
    }
    /* D3 (:1660) — role badge. Read "Member" for every author on live. */
    role = author?.roles.includes("founder") ? "Founder"
      : author?.roles.includes("investor") ? "Investor"
      : "Member";
  }
  /* ── D1 — PER-VIEWER FOLLOW STATE ──────────────────────────────────────────
     Resolved from the durable `company_followers` relation for THIS viewer.
     `followingCompanyIds` is narrowed to the subset of this post's company that
     the viewer actually follows, which keeps the response SHAPE identical
     (`string[] | undefined`) while making its VALUE viewer-correct. */
  let viewerFollows = false;
  let followerCount: number | undefined;
  const attributedCompanyId = companyIdOfPost(post);
  if (attributedCompanyId) {
    viewerFollows = isFollowingCompany(viewerUserId, attributedCompanyId);
    followerCount = followerCountOfCompany(attributedCompanyId);
  }
  return {
    ...post,
    authorLabel: resolvedName,
    authorRoleBadge: role,
    authorLocation: location,
    authorCapavateAngelNetwork: cangel,
    isAnonymous: isAnon,
    /* Only OVERRIDE the legacy array for company-attributed posts; every other
       post keeps whatever it already had (usually `undefined`), so no shape
       changes for post kinds that never carried follow state. */
    followingCompanyIds: attributedCompanyId
      ? viewerFollows
        ? [attributedCompanyId]
        : []
      : post.followingCompanyIds,
    viewerIsFollowingCompany: viewerFollows,
    authorCompanyId: attributedCompanyId || undefined,
    companyFollowerCount: followerCount,
  };
}

/* ==================================================================== */
/* ROUTE REGISTRATION                                                   */
/* ==================================================================== */

export function registerCommsRoutes(app: Express): void {
  /* ---- Channels list ---- */
  app.get("/api/comms/channels", (req, res) => {
    const { actorId } = actorOf(req);
    const ctx = membershipCtxOf(req); // v24.1 Bug H: live-relationship fallback
    const role = String(req.query.role ?? "investor"); // founder | investor | admin
    const visible = Array.from(channels.values()).filter((c) => channelIsVisibleToViewer(c, actorId, ctx));
    // Filter by role-relevance.
    const filtered = visible.filter((c) => {
      if (role === "founder") {
        // Founders see all of their company channels + their network/DMs.
        return true;
      }
      // Investor: same — they see channels they're in.
      return true;
    });
    const projected = filtered.map((c) => projectChannel(c, actorId));
    // Sort by last message ts desc.
    projected.sort((a, b) => (b.lastMessage?.ts ?? b.createdAt).localeCompare(a.lastMessage?.ts ?? a.createdAt));
    res.json(projected);
  });

  /* ---- Channel detail ---- */
  app.get("/api/comms/channels/:id", (req, res) => {
    const { actorId } = actorOf(req);
    const ctx = membershipCtxOf(req); // v24.1 Bug H
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Channel not found" });
    if (!channelIsVisibleToViewer(ch, actorId, ctx))
      return res.status(403).json({ message: "Not a member of this channel" });
    const view = projectChannel(ch, actorId);
    // v25.1 Bug 2 fix: messages now live in DB. Read from DB first (source of
    // truth across PM2 workers and restart); fall back to in-memory if DB read
    // returns empty (e.g. seeded test data that hasn't been persisted yet).
    const dbMsgs = loadChannelMessagesFromDb(ch.id);
    const merged = new Map<string, Message>();
    for (const m of dbMsgs) merged.set(m.id, m);
    for (const m of messages.values()) {
      if (m.channelId !== ch.id) continue;
      if (m.deletedAt) continue;
      if (!merged.has(m.id)) merged.set(m.id, m);
    }
    // Refresh in-memory cache with anything we got from DB (so subsequent
    // mutations operate on consistent state).
    for (const m of dbMsgs) messages.set(m.id, m);

    const msgs: MessageView[] = [];
    // Array.from(iter) avoids the TS2802 MapIterator downlevel-iteration error
    // that the tsconfig (no explicit ES2015+ target) raises on bare for-of.
    for (const m of Array.from(merged.values())) {
      if (m.deletedAt) continue;
      msgs.push(projectMessage(m, ch, actorId));
    }
    msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ channel: view, messages: msgs.slice(-50) });
  });

  /* ---- Send message ---- */
  app.post("/api/comms/channels/:id/messages", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const ctx = membershipCtxOf(req); // v24.1 Bug H
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Channel not found" });
    if (!channelIsVisibleToViewer(ch, actorId, ctx))
      return res.status(403).json({ message: "Not a member of this channel" });
    /* STAGE-D BLOCKER FIX B4b - a company's followers feed is AUTHOR-RESTRICTED.
       D5 made `followers__<companyId>` exist on live for the first time, and
       because following is open self-service, any authenticated investor who
       followed a company could POST into it (200; pre-Stage-D it was 404) -
       an unmoderated broadcast channel into the founder's and every follower's
       inbox. Followers READ; only the company's own active founders WRITE.
       Fails closed: an unresolvable company id denies. The read path above is
       untouched. */
    if (ch.kind === "company_followers" && !mayWriteToFollowersChannel(ch, actorId)) {
      return res.status(403).json({
        message: "Not a member of this channel",
        error: "followers_channel_read_only",
      });
    }
    const parsed = messageCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid message", issues: parsed.error.issues });
    return withIdempotency(req, res, `POST /api/comms/channels/${ch.id}/messages`, () => {
      const id = `msg_${randomBytes(8).toString("hex")}`;
      const msg: Message = {
        id,
        channelId: ch.id,
        authorUserId: actorId,
        body: parsed.data.body,
        createdAt: nowIso(),
        starredByUserIds: [],
        reactions: [],
        readByUserIds: [actorId],
        replyToMessageId: parsed.data.replyToMessageId,
        attachments: parsed.data.attachments,
      };
      messages.set(id, msg);
      // v25.1 Bug 2 fix — persist to DB so PM2 workers and restarts can read it.
      persistMessage(msg);
      emitOutbox("message.sent", actorId, ip, ua, {
        messageId: id, channelId: ch.id, channelKind: ch.kind, authorUserId: actorId,
        recipientCount: ch.participantUserIds.filter((u) => u !== actorId).length,
      });
      // Sprint 19 A — emit SSE mutation so all clients see new message.
      emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
      // Sprint 19 A / defect 8 — emit in-app notification for each non-author participant.
      // DEF-031: Use role-aware link so investors are not sent to /founder/ path.
      for (const uid of ch.participantUserIds.filter((u) => u !== actorId)) {
        // v24.0 E7: use the shared role-aware resolver (founder/investor/partner).
        const link = messagesPathForUser(uid, ch.id);
        try {
          emitNotification({
            userId: uid,
            kind: "message.received",
            title: "New message in thread",
            body: msg.body.slice(0, 100),
            link,
          });
        } catch { /* noop — notif store may not have this kind */ }
      }
      return res.json(projectMessage(msg, ch, actorId));
    });
  });

  /* ---- Edit message ---- */
  app.patch("/api/comms/messages/:id", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
    if (m.authorUserId !== actorId)
      return res.status(403).json({ message: "Only the author can edit" });
    const ageMs = Date.now() - new Date(m.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000)
      return res.status(409).json({ message: "Edit window (15 min) expired" });
    const parsed = messageEditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    m.body = parsed.data.body;
    m.editedAt = nowIso();
    persistMessage(m); // v25.1 Bug 2 fix
    emitOutbox("message.edited", actorId, ip, ua, { messageId: m.id, channelId: m.channelId });
    emitMutation({ aggregate: "commsThread", id: m.channelId, change: "update" });
    res.json(m);
  });

  /* ---- Soft-delete message ---- */
  app.delete("/api/comms/messages/:id", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
    if (m.authorUserId !== actorId)
      return res.status(403).json({ message: "Only the author can delete" });
    m.deletedAt = nowIso();
    persistMessage(m); // v25.1 Bug 2 fix
    emitOutbox("message.deleted", actorId, ip, ua, { messageId: m.id, channelId: m.channelId });
    emitMutation({ aggregate: "commsThread", id: m.channelId, change: "update" });
    res.json({ ok: true });
  });

  /* ---- Star / unstar ---- */
  app.post("/api/comms/messages/:id/star", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutateMessage(res, req.params.id, actorId)) return; // B14
    const m = messages.get(req.params.id)!;
    if (!m.starredByUserIds.includes(actorId)) m.starredByUserIds.push(actorId);
    emitOutbox("message.starred", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId });
    res.json({ ok: true, starred: true });
  });
  app.delete("/api/comms/messages/:id/star", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutateMessage(res, req.params.id, actorId)) return; // B14
    const m = messages.get(req.params.id)!;
    m.starredByUserIds = m.starredByUserIds.filter((u) => u !== actorId);
    emitOutbox("message.unstarred", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId });
    res.json({ ok: true, starred: false });
  });

  /* ---- Reactions ---- */
  app.post("/api/comms/messages/:id/reactions", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutateMessage(res, req.params.id, actorId)) return; // B14
    const m = messages.get(req.params.id)!;
    const parsed = messageReactionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    const emoji = parsed.data.emoji;
    let r = m.reactions.find((x) => x.emoji === emoji);
    if (!r) { r = { emoji, userIds: [] }; m.reactions.push(r); }
    if (!r.userIds.includes(actorId)) r.userIds.push(actorId);
    emitOutbox("message.reaction.added", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId, emoji });
    res.json({ ok: true, reactions: m.reactions });
  });
  app.delete("/api/comms/messages/:id/reactions", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutateMessage(res, req.params.id, actorId)) return; // B14
    const m = messages.get(req.params.id)!;
    const emoji = String(req.query.emoji ?? "");
    if (!emoji) return res.status(400).json({ message: "emoji required" });
    const r = m.reactions.find((x) => x.emoji === emoji);
    if (r) r.userIds = r.userIds.filter((u) => u !== actorId);
    m.reactions = m.reactions.filter((x) => x.userIds.length > 0);
    emitOutbox("message.reaction.removed", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId, emoji });
    res.json({ ok: true, reactions: m.reactions });
  });

  /* ---- Mark read ---- */
  app.post("/api/comms/channels/:id/read", (req, res) => {
    const { actorId } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    // B14 (v24.0 LOCKDOWN) — only a channel participant may mark it read.
    if (!channelIsVisibleToViewer(ch, actorId)) {
      return res.status(403).json({ message: "Not visible to you" });
    }
    for (const m of messages.values()) {
      if (m.channelId !== ch.id) continue;
      if (!m.readByUserIds.includes(actorId)) m.readByUserIds.push(actorId);
    }
    // Sprint 19 A — emit SSE so unread badge clears on other surfaces.
    emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
    res.json({ ok: true });
  });

  /* ---- Posts: feed ---- */
  app.get("/api/comms/posts", (req, res) => {
    const { actorId } = actorOf(req);
    // W2M B3(2) — publish any due scheduled posts before serving the feed.
    try { publishDueScheduledPosts(); } catch { /* never block a read */ }
    const scope = String(req.query.scope ?? "all"); // network | company_followers | all
    const sort = String(req.query.sort ?? "newest"); // newest | featured | following
    // Sprint 19 E — text search and topic filter.
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const topic = String(req.query.topic ?? "").trim().toLowerCase();
    // Sprint 23 Wave B — DEF-034: author-kind filter ("founders"|"investors"|"collective"|"all").
    const authorKind = String(req.query.authorKind ?? "").trim().toLowerCase();
    const me = viewerOf(actorId);
    let result: Post[] = [];
    for (const p of posts.values()) {
      // Sprint 19 E — filter out soft-deleted posts.
      if ((p as any).deletedAt) continue;
      // Sprint 19 E — filter out scheduled posts from live feed.
      if ((p as any).status === "scheduled") continue;
      const ch = channels.get(p.channelId);
      if (!ch) continue;
      if (scope === "network" && ch.kind !== "network") continue;
      if (scope === "company_followers" && ch.kind !== "company_followers") continue;
      /* Visibility — participant of the channel, OR (network posts only)
         relationship audience. W-COLLECTIVE Wave 2 Stage C: still NO `ctx`, so
         no participant backfill happens on a feed read. */
      if (!postIsVisibleToViewer(ch, p, actorId)) continue;
      // Sprint 19 E — text search.
      if (q && !p.body.toLowerCase().includes(q)) continue;
      // Sprint 19 E — topic filter.
      if (topic && !(p as any).topics?.some((t: string) => t.toLowerCase() === topic)) continue;
      // Sprint 23 Wave B — DEF-034: filter by authorKind ("founders"|"investors"|"collective").
      if (authorKind && authorKind !== "all") {
        /* D3 (:1924) — RE-SOURCED, and this one FAILED CLOSED: `COMMS_USERS` is
           `{}` on live, so `author` was ALWAYS undefined and
           `authorKind=collective` returned ZERO posts — the Collective tab of
           the feed was permanently empty. Chapter membership now comes from
           ACTIVE, non-deleted `chapter_memberships` rows (the same predicate
           audience row 5 uses), so the filter selects real Collective authors. */
        const author = commsUserRef(p.authorUserId);
        if (authorKind === "founders" && p.authorKind !== "company") continue;
        if (authorKind === "investors" && p.authorKind !== "user") continue;
        if (authorKind === "collective") {
          const chapterCount =
            author?.collectiveChapters?.length ?? durableActiveChapterIds(p.authorUserId).length;
          if (!chapterCount) continue;
        }
      }
      result.push(p);
    }
    if (sort === "newest") result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "featured") result.sort((a, b) => (b.likedByUserIds.length + b.shareCount) - (a.likedByUserIds.length + a.shareCount));
    else if (sort === "following") {
      /* ── D3 (:1937) — RE-SOURCED, and this one FAILED **OPEN** ───────────────
         `COMMS_USERS` is `{}` on live, so `author` was ALWAYS undefined and the
         `if (!author) return true` line admitted EVERY post: "Following" was
         indistinguishable from "Newest". Simply deleting that line would have
         swung it to the opposite failure — an EMPTY tab — because `me.capTables`
         and `me.collectiveChapters` came from the same empty map.

         Both halves are therefore re-sourced together. A post is "followed" when
         ANY of these DURABLE relations holds between the viewer and the author:
           • the viewer IS the author (your own posts belong in your feed);
           • a shared cap table (committed positions / actively-founded company);
           • a shared ACTIVE chapter;
           • a live `company_followers` row for a company the author fronts —
             i.e. the D1 follow relation, which is what "following" should have
             meant all along.
         This is a FEED FILTER, never an authorisation decision: every post in
         `result` already passed `postIsVisibleToViewer` above. */
      const viewerCapTables = new Set<string>(
        me.capTables.length ? me.capTables : durableCapTableCompanyIds(actorId),
      );
      const viewerChapters = new Set<string>(
        me.collectiveChapters.length ? me.collectiveChapters : durableActiveChapterIds(actorId),
      );
      const viewerFollowedCompanies = new Set<string>(companiesFollowedBy(actorId));
      result = result.filter((p) => {
        if (p.authorUserId === actorId) return true;
        const attributed = companyIdOfPost(p);
        if (attributed && viewerFollowedCompanies.has(attributed)) return true;
        const author = commsUserRef(p.authorUserId);
        const authorCapTables = author?.capTables ?? [];
        const authorChapters = author?.collectiveChapters ?? [];
        if (authorCapTables.some((c) => viewerCapTables.has(c))) return true;
        if (authorChapters.some((c) => viewerChapters.has(c))) return true;
        // An author who fronts a company the viewer follows.
        if (authorCapTables.some((c) => viewerFollowedCompanies.has(c))) return true;
        return false;
      });
      result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    res.json(result.map((p) => projectPost(p, actorId)));
  });

  /* ---- Posts: create ---- */
  app.post("/api/comms/posts", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const parsed = postCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    // Sprint 19 G3 — include actorId in idempotency key to prevent cross-user collision.
    const k = (req.headers["idempotency-key"] as string) ?? "";
    return withIdempotency(req, res, `POST /api/comms/posts::${actorId}::${k}`, () => {
      const id = `post_${randomBytes(8).toString("hex")}`;
      const authorKind = parsed.data.authorKind ?? "user";
      // Sprint 19 E — cap_table visibility routes to cap-table channel.
      let channelId: string;
      // v14 — cap_table / company posts MUST specify companyId. No "co_novapay" fallback.
      if (parsed.data.visibility === "cap_table" || authorKind === "company") {
        if (!parsed.data.companyId) {
          return res.status(400).json({ message: "companyId required for cap_table or company posts" });
        }
      }
      if (parsed.data.visibility === "cap_table") {
        channelId = capTableChannelId(parsed.data.companyId as string);
      } else {
        channelId = authorKind === "company"
          ? companyFollowersChannelId(parsed.data.companyId as string)
          : networkChannelId(actorId);
      }
      /* ── D2 — CHAPTER CONTEXT, checked BEFORE anything is written ──────────
         Fail closed: a caller may only anchor a post to a chapter they hold an
         ACTIVE membership of. Rejecting up front means we never persist a post
         and then discover we cannot honour the audience it asked for. */
      const requestedChapterId = (parsed.data as { chapterId?: string }).chapterId?.trim();
      if (requestedChapterId && !isActiveChapterMember(requestedChapterId, actorId)) {
        return res.status(403).json({ message: "not_an_active_chapter_member" });
      }
      /* ── D5 — MATERIALISE THE ANCHORED CHANNEL ────────────────────────────
         `cap_table` and `company_followers` channels were NEVER created here —
         only the author's own `network` channel was — so a cap-table or
         company-followers post was born with an unresolvable channel and post
         detail (which fails closed since Wave 1) returned 403 to EVERYONE,
         including its author. Now created and PERSISTED with 0117 anchors and a
         participant list derived from durable rows. */
      ensureAnchoredChannel(channelId);
      // Ensure the network channel exists for this user.
      if (!channels.has(channelId) && authorKind === "user" && parsed.data.visibility !== "cap_table") {
        const me = viewerOf(actorId);
        channels.set(channelId, {
          id: channelId, kind: "network",
          participantUserIds: [actorId],
          createdAt: nowIso(),
          metadata: { title: `${me.legalName}'s network`, ownerUserId: actorId },
        });
      }
      // Sprint 19 E — Extract topics from #hashtags in body.
      const extractedTopics = (parsed.data.body.match(/#(\w+)/g) ?? []).map((t: string) => t.slice(1));
      const topics = Array.from(new Set([...(parsed.data.topics ?? []), ...extractedTopics]));
      const isScheduled = !!(parsed.data.scheduledFor);
      const post: Post = {
        id,
        channelId,
        authorUserId: actorId,
        authorKind,
        body: parsed.data.body,
        createdAt: nowIso(),
        visibility: parsed.data.visibility,
        likedByUserIds: [],
        commentCount: 0,
        comments: [],
        shareCount: 0,
        mediaUrls: parsed.data.mediaUrls,
        topics: topics.length > 0 ? topics : undefined,
        scheduledFor: parsed.data.scheduledFor,
        status: isScheduled ? "scheduled" : "published",
      };
      // W2M B3 (rule #8 — no silent drops) — the PRIMARY DB write must succeed
      // before we report success. Previously a failed write was swallowed and
      // the route returned 200, so the post vanished on restart. We now persist
      // FIRST and return 500 if the primary write fails (removing the in-memory
      // entry so the projection stays consistent with durable state).
      //
      // persistNetworkPost is now a STATIC import (see top of file). This is
      // cycle-safe: networkPostsStore breaks the cycle with a runtime
      // `await import("./commsStore")` and has NO static import of this module,
      // so a static commsStore -> networkPostsStore edge forms no static cycle.
      // (The prior lazy `require` failed spuriously under the vitest ESM loader
      // and its error was swallowed — a silent drop this replaces.)
      const persistResult = persistNetworkPost({
        id,
        authorUserId: actorId,
        authorKind,
        body: post.body,
        createdAt: post.createdAt,
        visibility: parsed.data.visibility,
        companyId: parsed.data.companyId ?? null,
        mediaUrls: post.mediaUrls,
        topics: post.topics,
        status: post.status,
        scheduledFor: post.scheduledFor ?? null,
        publishedAt: isScheduled ? null : post.createdAt,
      }, actorId);
      if (!persistResult || persistResult.ok !== true) {
        posts.delete(id);
        return res.status(500).json({
          ok: false,
          error: "POST_PERSIST_FAILED",
          message: "Your post could not be saved. Please try again.",
        });
      }
      posts.set(id, post);
      /* D2 — set the durable POST ANCHOR now that the row exists. Membership was
         already verified above, so a failure here is a real write failure and is
         surfaced rather than swallowed (rule: no silent drops — the caller asked
         for a chapter audience and must be told if it was not applied). */
      if (requestedChapterId) {
        const anchored = setPostChapterAnchor(id, requestedChapterId);
        if (!anchored.ok) {
          posts.delete(id);
          return res.status(500).json({
            ok: false,
            error: "POST_CHAPTER_ANCHOR_FAILED",
            reason: anchored.error,
            message: "Your post could not be published to that chapter. Please try again.",
          });
        }
      }
      // v17 Phase B — Collective slice: persist Collective-visible posts
      // to the dedicated `collective_channel_posts` table so the Collective
      // feed survives restart. Only `public_to_collective` posts go here.
      if (parsed.data.visibility === "public_to_collective") {
        try {
          const db: any = getDb();
          db.transaction((tx: any) => {
            tx.insert(collectiveChannelPostsTable).values({
              id,
              tenantId: DEFAULT_CHAPTER_TENANT_ID,
              chapterId: DEFAULT_CHAPTER_ID,
              channelId,
              authorUserId: actorId,
              authorKind,
              body: post.body,
              visibility: "public_to_collective",
              likedByJson: JSON.stringify(post.likedByUserIds ?? []),
              commentsJson: JSON.stringify(post.comments ?? []),
              commentCount: post.commentCount ?? 0,
              shareCount: post.shareCount ?? 0,
              topicsJson: post.topics ? JSON.stringify(post.topics) : null,
              mediaUrlsJson: post.mediaUrls ? JSON.stringify(post.mediaUrls) : null,
              createdAt: post.createdAt,
            } as any).run();
          });
        } catch (err) {
          // W2M B3(1) — the requested audience IS the Collective public feed, so
          // a failed dual-write is a silent drop from that feed. Fail the route
          // (and roll back the in-memory + network_posts state is already durable
          // above; we remove the in-memory post so it doesn't render as if it
          // reached the Collective feed).
          log.error("[commsStore.collectiveSlice] Collective feed insert FAILED:", (err as Error).message);
          posts.delete(id);
          return res.status(500).json({
            ok: false,
            error: "COLLECTIVE_POST_PERSIST_FAILED",
            message: "Your post was saved but could not be published to the Collective feed. Please retry.",
          });
        }
        // v18 Phase D — SSE fan-out (post-commit, outside the tx).
        try {
          ssePublish(DEFAULT_CHAPTER_ID, "comms", {
            kind: "comms.post.created",
            postId: id,
            channelId,
            authorUserId: actorId,
            createdAt: post.createdAt,
          });
        } catch { /* non-fatal */ }
      }
      emitOutbox("post.created", actorId, ip, ua, {
        postId: id, channelId, authorUserId: actorId, authorKind, companyId: parsed.data.companyId, visibility: parsed.data.visibility,
      });
      // Sprint 19 A — emit SSE mutation for all connected clients.
      emitMutation({ aggregate: "post", id, change: "create" });
      // Sprint 19 G2 — emit in-app notifications to channel participants.
      if (!isScheduled) {
        const ch = channels.get(channelId);
        /* D3 (:2095) — re-sourced. Was ALWAYS "investor" on live, so a founder's
           own post notification deep-linked their co-participants to the
           investor surface. */
        const viewerRole = commsUserRef(actorId)?.roles.includes("founder") ? "founder" : "investor";
        for (const uid of (ch?.participantUserIds ?? []).filter((u: string) => u !== actorId)) {
          try {
            emitNotification({
              userId: uid,
              kind: "investor_report.published",
              title: `New post from ${resolveCommsDisplayName(null, actorId, { fullName: commsUserRef(actorId)?.legalName })}`,
              body: post.body.slice(0, 100),
              link: `/${viewerRole}/posts/${id}`,
            });
          } catch { /* noop */ }
        }
      }
      return res.json(projectPost(post, actorId));
    });
  });

  /* ---- Posts: drafts ---- */
  const postDrafts = new Map<string, { actorId: string; body: string; savedAt: string; visibility: string }>();

  app.post("/api/comms/posts/drafts", (req, res) => {
    const { actorId } = actorOf(req);
    const id = `draft_${randomBytes(8).toString("hex")}`;
    const { body = "", visibility = "network" } = req.body ?? {};
    postDrafts.set(`${actorId}:${id}`, { actorId, body, savedAt: nowIso(), visibility });
    res.json({ ok: true, draftId: id });
  });

  app.get("/api/comms/posts/drafts", (req, res) => {
    const { actorId } = actorOf(req);
    const drafts = Array.from(postDrafts.entries())
      .filter(([k]) => k.startsWith(`${actorId}:`))
      .map(([k, v]) => ({ draftId: k.split(":")[1], ...v }));
    res.json(drafts);
  });

  /* ---- Posts: edit (PATCH, 15-min window) ---- */
  app.patch("/api/comms/posts/:id", (req, res) => {
    const { actorId } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    if (p.authorUserId !== actorId)
      return res.status(403).json({ message: "Only the author can edit" });
    const ageMs = Date.now() - new Date(p.createdAt).getTime();
    if (ageMs > 15 * 60 * 1000)
      return res.status(409).json({ message: "Edit window (15 min) expired" });
    const body = String(req.body?.body ?? "").trim();
    if (!body) return res.status(400).json({ message: "body required" });
    p.body = body;
    (p as any).editedAt = nowIso();
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json(projectPost(p, actorId));
  });

  /* ---- Posts: soft-delete ---- */
  app.delete("/api/comms/posts/:id", (req, res) => {
    const { actorId } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    if (p.authorUserId !== actorId)
      return res.status(403).json({ message: "Only the author can delete" });
    (p as any).deletedAt = nowIso();
    emitMutation({ aggregate: "post", id: p.id, change: "delete" });
    res.json({ ok: true });
  });

  /* ---- Posts: pin (founder only) ---- */
  app.post("/api/comms/posts/:id/pin", (req, res) => {
    const { actorId } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    /* D3 (:2166) — RE-SOURCED. `COMMS_USERS` is `{}` on live, so `me` was ALWAYS
       undefined and NOBODY could pin a post: every call returned 403, including
       the founder the feature exists for. The founder role now comes from active
       `company_members` rows / `users.role`. This is the first time this endpoint
       can succeed in production. */
    const me = commsUserRef(actorId);
    if (!me?.roles.includes("founder"))
      return res.status(403).json({ message: "Only founders can pin posts" });
    (p as any).pinnedByFounderUserId = actorId;
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true });
  });

  /* ---- Channels: archive / mute / pin (per-user toggles) ---- */
  app.post("/api/comms/channels/:id/archive", (req, res) => {
    const { actorId } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
      return res.status(403).json({ message: "Not a member" });
    ch.archivedByUserIds = Array.from(new Set([...(ch.archivedByUserIds ?? []), actorId]));
    emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
    res.json({ ok: true });
  });

  app.post("/api/comms/channels/:id/mute", (req, res) => {
    const { actorId } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
      return res.status(403).json({ message: "Not a member" });
    ch.mutedByUserIds = Array.from(new Set([...(ch.mutedByUserIds ?? []), actorId]));
    emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
    res.json({ ok: true });
  });

  app.post("/api/comms/channels/:id/pin", (req, res) => {
    const { actorId } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
      return res.status(403).json({ message: "Not a member" });
    ch.pinnedByUserIds = Array.from(new Set([...(ch.pinnedByUserIds ?? []), actorId]));
    emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
    res.json({ ok: true });
  });

  /* ---- Posts: like / unlike ---- */
  /* W2B B3 — engagement writes are now rate-limited. `collectiveRateLimit` is
     the EXISTING sacred limiter (server/lib/rateLimit.ts, call-only) already
     mounted on /api/collective, /api/partner and /api/messages in routes.ts;
     /api/comms had no limiter at all. Its "write" bucket is 60/min per user,
     which is one sustained write per second — far above any human tapping like,
     far below a script. Authorisation is NOT changed here (Stage C). */
  app.post<{ id: string }>("/api/comms/posts/:id/like", collectiveRateLimit, (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    if (!p.likedByUserIds.includes(actorId)) p.likedByUserIds.push(actorId);
    /* W2B B4 — durable, and idempotent per (post, user): INSERT OR IGNORE, so a
       double-tap or a client retry is a no-op instead of a UNIQUE 500. */
    recordPostLike(p.id, actorId, nowIso());
    emitOutbox("post.liked", actorId, ip, ua, { postId: p.id, userId: actorId });
    // Sprint 19 A — propagate to all feed caches.
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, likeCount: p.likedByUserIds.length });
  });
  app.delete<{ id: string }>("/api/comms/posts/:id/like", collectiveRateLimit, (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    p.likedByUserIds = p.likedByUserIds.filter((u) => u !== actorId);
    removePostLike(p.id, actorId); // W2B B4
    emitOutbox("post.unliked", actorId, ip, ua, { postId: p.id, userId: actorId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, likeCount: p.likedByUserIds.length });
  });

  /* ---- Posts: single post (B3+E4 detail view) ---- */
  app.get("/api/comms/posts/:id", (req, res) => {
    const { actorId } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    /* ── W-COLLECTIVE Wave 2 Stage D (D5) — THE SHIP GATE ───────────────────
       Rebuild an unresolvable `cap_table` / `company_followers` channel from
       DURABLE ROWS before deciding. Wave 1's fail-closed rule is UNCHANGED and
       still below — this only removes the reason the channel was missing in the
       first place (nothing outside the demo seed ever created these two kinds),
       which had made every such post permanently inaccessible even to its
       author. If the rows do not describe a channel, `ch` stays undefined and
       the read still DENIES. */
    if (!channels.has(p.channelId)) ensureAnchoredChannel(p.channelId);
    const ch = channels.get(p.channelId);
    /* W-COLLECTIVE Wave 1 (v5 §B2) — FAIL CLOSED.
       This was `if (ch && !visible)`: an unresolvable channel skipped the check
       entirely and the post was served to any authenticated caller. On a
       platform where `visibility:"cap_table"` posts carry round and ownership
       detail, "I could not determine the audience" must deny, not allow.
       `restorePostFromDb` now rebuilds the author's network channel, so the
       common restart case resolves; a still-missing channel is a genuine
       inability to authorise. */
    /* W-COLLECTIVE Wave 2 Stage C (C2) — participant gate OR, for `network`
       channels only, the relationship audience predicate. Wave 1's fail-closed
       `!ch` branch is preserved: an unresolvable channel still denies, because
       the predicate cannot be trusted to describe an audience we could not even
       identify. Still no `ctx` → no participant backfill. */
    if (!ch || !postIsVisibleToViewer(ch, p, actorId)) {
      return res.status(403).json({ message: "Not visible to you" });
    }
    /* W-COLLECTIVE Wave 2 Stage C (C4) — social identity policy. */
    const socialSurface = postSurfaceIsSocial(ch);
    const isParticipant = ch.participantUserIds.includes(actorId);
    const view = projectPost(p, actorId);
    // Resolve comment author labels (anonymous-aware) for nicer UI rendering.
    // On a social surface these resolve in the `collectiveDirectory` context.
    const commentsResolved = p.comments.map((c) => {
      const r = resolveIdentity(actorId, c.userId, undefined, { social: socialSurface });
      return { ...c, authorLabel: r.displayName, isAnonymous: r.isAnonymous, parentCommentId: (c as any).parentCommentId };
    });
    /* Reactions history is a derived view of likes for the detail panel. Stage C:
       SUPPRESSED ENTIRELY for non-participants — a relationship viewer who
       gains sight of a post must not thereby enumerate WHO ELSE engaged with
       it. Participants keep the list, resolved in the social context on social
       surfaces. Deliberate narrowing: the field is always present (never
       dropped), it is empty for non-participants. */
    const reactionHistory = isParticipant
      ? p.likedByUserIds.map((uid) => {
          const r = resolveIdentity(actorId, uid, undefined, { social: socialSurface });
          return { userId: uid, label: r.displayName, isAnonymous: r.isAnonymous };
        })
      : [];
    res.json({ post: view, comments: commentsResolved, reactionHistory });
  });

  /* ---- Posts: comments ---- */
  app.post<{ id: string }>("/api/comms/posts/:id/comments", collectiveRateLimit, (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    const parsed = postCommentCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    const cid = `c_${randomBytes(6).toString("hex")}`;
    // Sprint 18 Phase 3 E4 — support a single level of nested replies via
    // optional parentCommentId.
    const parentCommentId = typeof req.body?.parentCommentId === "string" ? req.body.parentCommentId : undefined;
    const commentCreatedAt = nowIso();
    p.comments.push({ id: cid, userId: actorId, body: parsed.data.body, createdAt: commentCreatedAt, parentCommentId } as any);
    p.commentCount += 1;
    recordPostComment({ // W2B B4
      id: cid,
      postId: p.id,
      authorUserId: actorId,
      body: parsed.data.body,
      createdAt: commentCreatedAt,
      parentCommentId,
    });
    emitOutbox("post.commented", actorId, ip, ua, { postId: p.id, userId: actorId, commentId: cid, parentCommentId });
    // Sprint 19 A — emit SSE so feed cache refreshes.
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, commentId: cid, commentCount: p.commentCount });
  });

  /* ---- Posts: share ---- */
  app.post<{ id: string }>("/api/comms/posts/:id/share", collectiveRateLimit, (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    p.shareCount += 1;
    /* W2B B4 — append-only share event. Deliberately no uniqueness: sharing the
       same post twice is two real events, and the 0119 table reflects that. */
    recordPostShare({ id: `sh_${randomBytes(8).toString("hex")}`, postId: p.id, userId: actorId, createdAt: nowIso() });
    emitOutbox("post.shared", actorId, ip, ua, { postId: p.id, userId: actorId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, shareCount: p.shareCount });
  });

  /* ==================================================================== */
  /* W-COLLECTIVE Wave 2 STAGE D (D1) — THE REWIRED FOLLOW ENDPOINT        */
  /* ==================================================================== */
  /**
   * `POST /api/comms/posts/:id/follow` was broken in THREE ways at once:
   *   1. it wrote the followed company id onto the POST (`p.followingCompanyIds`)
   *      instead of recording a per-USER relation, so the store had no idea WHO
   *      followed;
   *   2. that write was IN-MEMORY only — every follow vanished on restart;
   *   3. because the client button reads that shared post field
   *      (client/src/components/comms/PostsFeed.tsx:743), ONE investor following
   *      made the button read "Following ✓" for EVERY viewer.
   *
   * Owner decision implemented here: follows are OPEN — any authenticated
   * investor may follow a company — and the founder sees follower IDENTITIES
   * (see the follower-list endpoint below, which still routes every name through
   * the SACRED privacy resolver so an explicit opt-out wins).
   *
   * ADDITIVE, NOT REPLACED: the path is unchanged and the response still
   * contains `{ ok: true, followingCompanyIds }`. What changed is that the array
   * is now THIS VIEWER's follow state read back from `company_followers`, and
   * `following` / `followerCount` are added alongside it.
   *
   * NO MONEY: `company_followers` is a social relation. Following a company
   * grants read access to its follower feed and nothing else — no commitment, no
   * allocation, no soft-circle intent, no payment.
   */
  const resolveFollowTarget = (
    postId: string,
  ): { post: Post; companyId: string } | { error: { status: number; message: string } } => {
    const p = posts.get(postId);
    if (!p) return { error: { status: 404, message: "Not found" } };
    if (p.authorKind !== "company") {
      return { error: { status: 400, message: "Follow only valid for company posts" } };
    }
    /* v14 — never "co_novapay". D5 — also accept the durable anchor / id decode,
       so a post whose channel is not in memory (the usual case after a restart)
       is still followable instead of 400-ing with post_missing_companyId. */
    const companyId = companyIdOfPost(p);
    if (!companyId) return { error: { status: 400, message: "post_missing_companyId" } };
    return { post: p, companyId };
  };

  app.post<{ id: string }>("/api/comms/posts/:id/follow", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const target = resolveFollowTarget(req.params.id);
    if ("error" in target) {
      return res.status(target.error.status).json({ message: target.error.message });
    }
    const { post: p, companyId } = target;
    /* DURABLE, per-USER, IDEMPOTENT (upsert that clears `deleted_at`). Fail
       CLOSED: if the row cannot be written we do NOT report a follow. */
    const written = followCompany(actorId, companyId);
    if (!written.ok) {
      return res.status(500).json({
        ok: false,
        error: "FOLLOW_PERSIST_FAILED",
        reason: written.error,
        message: "Your follow could not be saved. Please try again.",
      });
    }
    /* The in-memory post field is NO LONGER the source of truth and is no longer
       written — that write was the per-viewer bug. `projectPost` recomputes the
       array per viewer from `company_followers`. */
    const followingCompanyIds = isFollowingCompany(actorId, companyId) ? [companyId] : [];
    emitOutbox("post.followed", actorId, ip, ua, { postId: p.id, userId: actorId, companyId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({
      ok: true,
      followingCompanyIds, // legacy key, legacy type — now per-viewer
      following: true,
      companyId,
      followerCount: followerCountOfCompany(companyId),
    });
  });

  /* ---- D1 — UNFOLLOW. There was no way to undo a follow at all. Soft:
         `deleted_at` is set, and re-following clears it (0116's UNIQUE index is
         NOT partial on `deleted_at`, so the upsert restores the same row). ---- */
  app.delete<{ id: string }>("/api/comms/posts/:id/follow", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const target = resolveFollowTarget(req.params.id);
    if ("error" in target) {
      return res.status(target.error.status).json({ message: target.error.message });
    }
    const { post: p, companyId } = target;
    const removed = unfollowCompany(actorId, companyId);
    if (!removed.ok) {
      return res.status(500).json({
        ok: false,
        error: "UNFOLLOW_PERSIST_FAILED",
        reason: removed.error,
        message: "Your unfollow could not be saved. Please try again.",
      });
    }
    emitOutbox("post.unfollowed", actorId, ip, ua, { postId: p.id, userId: actorId, companyId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({
      ok: true,
      followingCompanyIds: [],
      following: false,
      companyId,
      followerCount: followerCountOfCompany(companyId),
    });
  });

  /* ==================================================================== */
  /* D1 — FOUNDER-FACING FOLLOWER LIST                                     */
  /* ==================================================================== */
  /**
   * `GET /api/comms/companies/:companyId/followers`
   *
   * Owner decision: the FOUNDER sees follower IDENTITIES. Authorisation is
   * strict — only an ACTIVE founder/co_founder of that company (or a platform
   * admin) may call it; every other caller gets 403, including followers.
   *
   * Identity resolution goes through the SACRED privacy resolver in the
   * `message` context with `isCoMember: true`. That is justified because
   * following is an AFFIRMATIVE act directed at this founder's company, which is
   * the same posture as a counterparty relationship — and critically, an
   * EXPLICIT opt-out still wins: `visibleToCoMembers:false` yields the follower's
   * screen name, or "Private Investor" when they have none. Raw `legalName` is
   * never emitted.
   */
  app.get<{ companyId: string }>("/api/comms/companies/:companyId/followers", (req, res) => {
    const { actorId } = actorOf(req);
    const companyId = String(req.params.companyId ?? "").trim();
    if (!companyId) return res.status(400).json({ message: "companyId required" });
    const ctx = membershipCtxOf(req) as { isAdmin?: boolean } | undefined;
    const isFounderOfCompany = founderUserIdsOfCompany(companyId).includes(actorId);
    if (!isFounderOfCompany && ctx?.isAdmin !== true) {
      return res.status(403).json({ message: "Only the company founder can see followers" });
    }
    const followers = followersOfCompany(companyId).map((f) => {
      const ref = commsUserRef(f.userId);
      const displayName = resolveDisplayName(f.userId, actorId, "message", {
        legalName: ref?.legalName ?? "",
        isCoMember: true,
      });
      return {
        userId: f.userId,
        displayName,
        isAnonymous: displayName === "Private Investor",
        followedAt: f.followedAt,
      };
    });
    res.json({ ok: true, companyId, followerCount: followers.length, followers });
  });

  /* ---- DM start ---- */
  app.post("/api/comms/dm/start", (req, res) => {
    let actorId: string; let ip: string | undefined; let ua: string | undefined;
    try { ({ actorId, ip, ua } = actorOf(req)); } catch { return res.status(401).json({ message: "Unauthenticated" }); }
    const parsed = dmStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    /* D3 — re-sourced. A real platform member with a `users` row is no longer
       treated as "not provisioned" just because the demo seed is off. The CRM
       auto-provision path below stays as the fallback for CRM-only contacts. */
    let target: UserRef | DurableCommsUserRef | undefined = commsUserRef(parsed.data.targetUserId);
    // B-505 fix v23.6.1 — CRM-only contacts (e.g. invited investors who haven't
    // fully onboarded into the comms layer) are absent from COMMS_USERS. The
    // founder owns the CRM record, so a founder-initiated DM is authorized by
    // that ownership relationship. Auto-provision a minimal comms identity from
    // the REAL stored name + email (no mock/placeholder data) so the thread
    // opens instead of 404-ing.
    let authorizedViaCrm = false;
    if (!target) {
      const crm = findCrmContactByInvestorId(parsed.data.targetUserId);
      if (crm && crm.email) {
        const provisioned: UserRef = {
          id: parsed.data.targetUserId,
          // W2M B5 (rule #13) — NEVER use email as a display name. When the CRM
          // record has a real name, use it; when only an email exists, fall back
          // to a safe generic label. The email is retained below in `email` for
          // non-display metadata only, never surfaced as the name.
          legalName: crm.name && crm.name.trim().length > 0 ? crm.name : "Invited contact",
          email: crm.email,
          visibility: { screenName: crm.firmName && crm.firmName !== "—" ? crm.firmName : crm.name, visibleToCoMembers: true, visibleToCollectiveNetwork: false },
          capTables: crm.companyId ? [crm.companyId] : [],
          collectiveChapters: [],
          roles: ["investor"],
        };
        COMMS_USERS[parsed.data.targetUserId] = provisioned;
        target = provisioned;
        // The CRM ownership relationship itself authorizes the DM, independent
        // of the visibility resolver's shared-cap-table / collective rules
        // (which may not be populated for this actor outside demo-seed mode).
        authorizedViaCrm = true;
      }
    }
    if (!target) {
      // No comms identity and no CRM record to provision from — structured 422
      // (not a silent 404) so the client renders an actionable message.
      return res.status(422).json({
        ok: false,
        error: "contact_not_provisioned",
        message: "Cannot start DM until this contact accepts their invitation.",
      });
    }
    const me = viewerOf(actorId);
    const shared = sharedContextBetween(me, target);
    // v25.46 Track 1 — canonical DM permission gate (single source of truth).
    // canDM enforces the LOCKED permission matrix from auth_users.role + the
    // sacred cap-table ledger. A founder who owns the CRM record (authorizedViaCrm)
    // is authorized by that ownership relationship independent of the matrix.
    const policy = canDM(actorId, target.id);
    const r = resolveDisplayIdentity({
      viewerUserId: actorId,
      authorUserId: target.id,
      authorLegalName: target.legalName,
      authorVisibility: target.visibility,
      context: { sharedCapTables: shared.capTables, sharedCollectiveChapters: shared.chapters },
    });
    // v25.46 Track 1 — the LOCKED role matrix (canDM) is an ADDITIVE allow
    // layer: it OPENS DM for role pairs the matrix permits, but it must never
    // REVOKE a DM that the existing comms shared-context resolver already
    // permits (co-member cap table / collective-visible / founder passthrough),
    // nor a CRM-ownership-authorized DM. A DM is blocked only when ALL of
    // {role matrix, shared-context visibility, CRM ownership} deny it. This is
    // fail-closed at the union level while honouring Tier 5 (no silent drops of
    // previously-valid relationships).
    const allowedByPolicy = policy.allowed || r.canSendDm || authorizedViaCrm;
    if (!allowedByPolicy) {
      emitOutbox("dm.channel.blocked", actorId, ip, ua, {
        fromUserId: actorId, toUserId: target.id,
        reason: policy.reason ?? (shared.capTables.length === 0 && shared.chapters.length === 0 ? "no_shared_context" : "no_visibility"),
      });
      return res.status(403).json({ ok: false, reason: policy.reason ?? r.reason, privacyMode: policy.privacyMode });
    }
    const id = dmChannelId(actorId, target.id);
    let ch = channels.get(id);
    if (!ch) {
      ch = {
        id, kind: "dm",
        participantUserIds: [actorId, target.id],
        createdAt: nowIso(),
        // v25.45 R9 — never persist raw legal names in DM channel metadata.
        // The viewer-resolved displayTitle is computed at render time by
        // projectChannel() via resolveIdentity(); persisting raw names here
        // would leak them through the channel JSON regardless of resolver.
        metadata: { title: "Direct message" },
      };
      channels.set(id, ch);
      /* v25.9 — persist DM channel so it survives restart */
      persistChannel(ch);
    }
    emitOutbox("dm.channel.opened", actorId, ip, ua, {
      channelId: id, fromUserId: actorId, toUserId: target.id,
      sharedContext: shared,
    });
    // Sprint 19 A — emit SSE so messages list refreshes on both sides.
    emitMutation({ aggregate: "commsThread", id, change: ch ? "update" : "create" });
    // Sprint 19 A — notify target about the new DM.
    try {
      emitNotification({
        userId: target.id,
        kind: "message.received",
        title: `${resolveCommsDisplayName(target.id, actorId)} opened a DM`,
        body: "A new direct message thread was started with you.",
        // v24.0 E7: role-aware link — was hard-coded to /founder regardless of
        // the recipient's role.
        link: messagesPathForUser(target.id, id),
      });
    } catch { /* noop */ }
    res.json({ ok: true, channelId: id, channel: projectChannel(ch, actorId) });
  });

  /* ---- Cap-table channel access (per-company) ---- */
  app.get("/api/comms/cap-table/:companyId", (req, res) => {
    const { actorId } = actorOf(req);
    // v24.2 Bug 5 — pass ctx so derivedMembership (durable stores) runs;
    // secure-redeemed users were otherwise denied (isMember:false).
    const ctx = membershipCtxOf(req);
    const id = capTableChannelId(req.params.companyId);
    const ch = channels.get(id);
    if (!ch) return res.json({ exists: false });
    const isMember = channelIsVisibleToViewer(ch, actorId, ctx);
    if (!isMember) return res.json({ exists: true, isMember: false });
    const view = projectChannel(ch, actorId);
    const lastMessages: MessageView[] = [];
    for (const m of messages.values()) {
      if (m.channelId !== ch.id || m.deletedAt) continue;
      lastMessages.push(projectMessage(m, ch, actorId));
    }
    lastMessages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      exists: true, isMember: true, channel: view,
      lastMessages: lastMessages.slice(0, 3),
      visibleMemberCount: ch.metadata?.visibleMemberCount ?? ch.participantUserIds.length,
      totalMemberCount: ch.participantUserIds.length,
    });
  });

  /* ---- Soft-circle channel access (per-round) ---- */
  app.get("/api/comms/soft-circle/:roundId", (req, res) => {
    const { actorId } = actorOf(req);
    // v24.2 Bug 5 — pass ctx so derivedMembership (durable stores) runs.
    const ctx = membershipCtxOf(req);
    const id = softCircleChannelId(req.params.roundId);
    const ch = channels.get(id);
    if (!ch) return res.json({ exists: false });
    const isMember = channelIsVisibleToViewer(ch, actorId, ctx);
    if (!isMember) return res.json({ exists: true, isMember: false });
    const view = projectChannel(ch, actorId);
    const lastMessages: MessageView[] = [];
    for (const m of messages.values()) {
      if (m.channelId !== ch.id || m.deletedAt) continue;
      lastMessages.push(projectMessage(m, ch, actorId));
    }
    lastMessages.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({
      exists: true, isMember: true, channel: view,
      lastMessages: lastMessages.slice(0, 3),
      memberCount: ch.participantUserIds.length,
    });
  });

  /* ---- Comms users list (for visibility resolver tests / DM start) ---- */
  // Patch v9 (P0-7): scope the response to users who share at least one channel
  // with the viewer (cap-table community, soft-circle community, DM, etc.).
  // Anonymous callers and viewers with no shared channels see an empty list.
  // Unit-test harnesses without userContext fall through to the legacy behavior
  // (return the full directory) so existing comms tests keep passing.
  /* ====================================================================== */
  /* W-COLLECTIVE Wave 2 STAGE D (D3) — RE-SOURCED **AND** DE-LEAKED         */
  /* ====================================================================== */
  /**
   * TWO defects, in OPPOSITE directions, in one 18-line handler:
   *
   *  (a) EMPTY IN PRODUCTION. The list came from `Object.values(COMMS_USERS)`,
   *      and `COMMS_USERS` is `{}` whenever the demo seed is off. So the DM
   *      recipient picker (`client/src/pages/investor/Messages.tsx:67`,
   *      `client/src/pages/partner/PartnerMessages.tsx:46`) and @mention
   *      autocomplete have been rendering an EMPTY list to every live user. The
   *      candidate set is now the real `users` table.
   *
   *  (b) A BULK PII DUMP waiting to happen. The old projection emitted RAW
   *      `legalName` and the WHOLE `visibility` object, and the `if (!ctx)`
   *      branch emitted the entire directory to an unauthenticated caller.
   *      Re-sourcing (a) without fixing (b) would have converted a
   *      hard-empty endpoint into a live investor-identity export. Every name
   *      is now resolved through the SACRED `userPrivacyResolver` FOR THE
   *      CALLING VIEWER, and `visibility` is reduced to the screen label the
   *      viewer is already allowed to see.
   *
   * Authorisation: self, plus channel co-participants, plus durable cap-table
   * co-members, chapter co-members and shared-follow peers. Unauthenticated
   * callers get `[]`. Keys are UNCHANGED (`id, legalName, visibility, capTables,
   * roles, location, capavateAngelNetwork`) so no client field is dropped.
   */
  app.get("/api/comms/users", (req, res) => {
    const ctx = (req as unknown as { userContext?: { isAuthed?: boolean; userId?: string; isAdmin?: boolean } }).userContext;

    /* Candidate ids: seed personas (when the demo seed is on) UNION the durable
       `users` table. The union — not a replacement — is what keeps the existing
       seeded DM/@mention tests green while making the endpoint work on live. */
    const candidateIds = new Set<string>(Object.keys(COMMS_USERS));
    for (const id of listDurableCommsUserIds(500)) candidateIds.add(id);

    /* An unauthenticated caller gets NOTHING. This replaces the old `if (!ctx)`
       branch that returned the whole directory to anyone; a legacy harness that
       does not mount `loadUserContext` still has an actor header, which
       `actorOf` reads, so it keeps working through the normal path below. */
    const viewerId = ctx?.userId || (() => { try { return actorOf(req).actorId; } catch { return ""; } })();
    if (ctx && ctx.isAuthed === false) return res.json([]);
    if (!viewerId) return res.json([]);

    const isAdmin = ctx?.isAdmin === true;
    /* Peer set from DURABLE relations, not from a seed array. */
    const peers = new Set<string>([viewerId]);
    for (const ch of channels.values()) {
      if (!ch.participantUserIds.includes(viewerId)) continue;
      for (const p of ch.participantUserIds) peers.add(p);
    }
    for (const p of durableCapTablePeerIds(viewerId)) peers.add(p);
    for (const p of durableChapterPeerIds(viewerId)) peers.add(p);
    for (const p of durableFollowPeerIds(viewerId)) peers.add(p);

    const out: Array<Record<string, unknown>> = [];
    for (const id of Array.from(candidateIds)) {
      const isSelf = id === viewerId;
      if (!isSelf && !isAdmin && !peers.has(id)) continue;
      const u = commsUserRef(id);
      if (!u) continue;
      /* PRIVACY: never the raw legal name for anyone but the subject. Cap-table
         co-membership uses the SACRED predicate; everyone else is resolved in
         the `collectiveDirectory` context, which requires an EXPLICIT opt-in and
         otherwise yields the screen name or "Private Investor". An explicit
         `visibleToCoMembers:false` therefore still wins. */
      const displayName = isSelf
        ? u.legalName
        : areCoMembersOnAnyCapTable(viewerId, id)
          ? resolveDisplayName(id, viewerId, "message", { legalName: u.legalName, isCoMember: true })
          : resolveDisplayName(id, viewerId, "collectiveDirectory", { legalName: u.legalName });
      /* `readUserPrivacyRaw` returns null when the subject has never set a
         preference — absence is NOT an opt-out, so default to visible. */
      const priv = readUserPrivacyRaw(id);
      out.push({
        id: u.id,
        /* Same KEY and same TYPE as before (a string the picker renders), but a
           privacy-resolved value instead of the raw legal name. */
        legalName: displayName,
        /* Reduced: the screen label only, and only when the viewer is already
           being shown it. The subject's raw consent flags are no longer
           broadcast — except to the subject themselves. */
        visibility: isSelf
          ? u.visibility
          : { screenName: displayName === u.legalName ? u.visibility?.screenName : displayName },
        capTables: u.capTables,
        roles: u.roles,
        location: u.location,
        capavateAngelNetwork: (u as { capavateAngelNetwork?: boolean }).capavateAngelNetwork ?? false,
        /* Additive, non-PII: lets the picker mark opted-out investors. */
        isPrivate: priv?.visibleToCoMembers === false,
      });
    }
    res.json(out);
  });

  /* ---- Current viewer (mock auth) ---- */
  app.get("/api/comms/me", (req, res) => {
    const { actorId } = actorOf(req);
    res.json(viewerOf(actorId));
  });

  /* ---- E2: server-side full-text message search ---- */
  app.get("/api/comms/search", (req, res) => {
    const { actorId } = actorOf(req);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    if (!q) return res.json({ results: [], query: q });
    const out: Array<{
      messageId: string; channelId: string; channelKind: ChannelKind;
      preview: string; createdAt: string; authorLabel: string;
    }> = [];
    for (const m of messages.values()) {
      if (m.deletedAt) continue;
      if (!m.body.toLowerCase().includes(q)) continue;
      const ch = channels.get(m.channelId);
      if (!ch) continue;
      if (!channelIsVisibleToViewer(ch, actorId)) continue;
      const r = resolveIdentity(actorId, m.authorUserId, undefined);
      out.push({
        messageId: m.id, channelId: m.channelId, channelKind: ch.kind,
        preview: m.body.slice(0, 200), createdAt: m.createdAt,
        authorLabel: r.displayName,
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ results: out.slice(0, 50), query: q });
  });

  /* ---- E2: typing indicator pulse ---- */
  app.post("/api/comms/channels/:id/typing", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    // v24.2 Bug 5 — pass ctx so derivedMembership (durable stores) runs.
    const ctx = membershipCtxOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId, ctx))
      return res.status(403).json({ message: "Not a member" });
    emitOutbox("channel.typing", actorId, ip, ua, { channelId: ch.id, userId: actorId, ts: nowIso() });
    res.json({ ok: true, ts: nowIso() });
  });

  /* ---- E2: read-receipts — list of who has read up to which message ---- */
  app.get("/api/comms/channels/:id/read-receipts", (req, res) => {
    const { actorId } = actorOf(req);
    // v24.2 Bug 5 — pass ctx so derivedMembership (durable stores) runs.
    const ctx = membershipCtxOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId, ctx))
      return res.status(403).json({ message: "Not a member" });
    // For each participant, the latest message they have read in this channel.
    const lastReadByUser: Record<string, string> = {};
    const lastReadMsgIdByUser: Record<string, string> = {};
    const channelMsgs: Message[] = [];
    for (const m of messages.values()) {
      if (m.channelId !== ch.id || m.deletedAt) continue;
      channelMsgs.push(m);
    }
    channelMsgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const uid of ch.participantUserIds) {
      let latest: string | undefined;
      let latestId: string | undefined;
      for (const m of channelMsgs) {
        if (m.readByUserIds.includes(uid)) { latest = m.createdAt; latestId = m.id; }
      }
      if (latest) lastReadByUser[uid] = latest;
      if (latestId) lastReadMsgIdByUser[uid] = latestId;
    }
    const totalReaders = Object.keys(lastReadByUser).filter((u) => u !== ch.participantUserIds[0]).length;
    // Sprint 18 Phase 3 E2 — also expose a friendlier `receipts` array shape
    // that the UI consumes directly.
    const receipts = ch.participantUserIds.map((uid) => {
      const r = resolveIdentity(actorId, uid, undefined);
      return {
        userId: uid,
        displayName: r.displayName,
        lastReadMessageId: lastReadMsgIdByUser[uid] ?? null,
        lastReadAt: lastReadByUser[uid] ?? null,
      };
    });
    res.json({ channelId: ch.id, lastReadByUser, totalReaders, receipts });
  });

  /* ---- Telemetry visibility ----
     v25.20 Lane 1 NC1 (hard close):
       These dev-telemetry endpoints were unauthenticated and unrestricted to
       NODE_ENV. Anyone could GET /api/comms/dev/{outbox,audit} in production
       and see the last 50 cross-tenant outbound comms + the immutable audit
       chain. Now: production returns 404 (route effectively does not exist),
       and non-production requires admin auth. */
  app.get("/api/comms/dev/outbox", requireAdmin, (_req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
    return res.json(outbox.slice(-50));
  });
  app.get("/api/comms/dev/audit", requireAdmin, (_req, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).end();
    return res.json(auditEntries.slice(-50));
  });
}

/* Test access helpers. */
export const _commsTest = { channels, messages, posts, outbox, auditEntries, COMMS_USERS };

/**
 * v13 (Avi's Issue 5) — restorePostFromDb
 *
 * Called by networkPostsStore.hydrateNetworkPostsStore() on boot for every
 * row found in `network_posts`. Re-inserts a minimal Post into the in-memory
 * Map so the read API (/api/comms/posts) reflects DB state immediately after
 * a server restart.
 */
/**
 * W2M B3(4) — moderation-reflect bridge. `postModerationRoutes.moderatePost`
 * updates `network_posts.deleted_at` + the moderation log, but did NOT touch the
 * in-memory comms `posts` map or emit an SSE mutation, so a hidden post kept
 * rendering in `/api/comms/posts` (and the Collective feed) until restart. This
 * non-sacred bridge reconciles the in-memory projection immediately and emits a
 * `post` mutation so every connected client re-fetches. Called from the
 * moderation route AFTER moderatePost succeeds.
 */
export function applyPostModerationToComms(
  postId: string,
  action: "hide" | "unhide" | "flag",
  _moderatorUserId: string,
): void {
  const post = posts.get(postId);
  if (action === "hide") {
    if (post) (post as any).deletedAt = nowIso();
    emitMutation({ aggregate: "post", id: postId, change: "update" });
    return;
  }
  if (action === "unhide") {
    if (post) {
      (post as any).deletedAt = undefined;
    } else {
      // In-memory entry missing (e.g. cold cache): rehydrate from DB so the
      // unhidden post reappears without waiting for a restart.
      try {
        const row: any = rawDb()
          .prepare("SELECT * FROM network_posts WHERE id = ?")
          .get(postId);
        if (row) {
          const cj = (() => { try { return JSON.parse(row.content_json ?? "{}"); } catch { return {}; } })();
          restorePostFromDb({
            id: row.id,
            authorUserId: row.author_user_id,
            authorKind: cj.authorKind ?? "user",
            body: row.body,
            createdAt: row.created_at,
            visibility: cj.visibility ?? row.audience,
            companyId: cj.companyId ?? null,
            mediaUrls: cj.mediaUrls ?? [],
            topics: cj.topics ?? [],
            commentParents: cj.commentParents, // W2B B4
          });
          const restored = posts.get(postId);
          if (restored) (restored as any).deletedAt = undefined;
        }
      } catch (err) {
        log.warn("[applyPostModerationToComms] unhide rehydrate failed:", (err as Error).message);
      }
    }
    emitMutation({ aggregate: "post", id: postId, change: "update" });
    return;
  }
  // flag — only emit if a visible status/badge would change. We emit a mutation
  // so any flag badge re-renders; hidden state is unchanged.
  emitMutation({ aggregate: "post", id: postId, change: "update" });
}

/**
 * W2M B3(2) — read-side scheduler. Publishes any in-memory post whose
 * scheduledFor is due (<= now). Idempotent: a post is published at most once
 * (status flips scheduled->published, publishedAt set, one notification, DB
 * content_json updated). Called from GET /api/comms/posts and :id so scheduled
 * posts become visible at/after their time without a dedicated worker. Returns
 * the ids published + any failures (never throws — a feed read must still serve).
 */
export function publishDueScheduledPosts(now: Date = new Date()): {
  published: string[];
  failed: Array<{ id: string; error: string }>;
} {
  const published: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const nowMs = now.getTime();
  for (const p of Array.from(posts.values())) {
    if ((p as any).status !== "scheduled") continue;
    const sched = (p as any).scheduledFor as string | undefined;
    if (!sched) continue;
    const dueMs = Date.parse(sched);
    if (Number.isNaN(dueMs) || dueMs > nowMs) continue;
    try {
      (p as any).status = "published";
      (p as any).publishedAt = now.toISOString();
      // Persist the status flip in network_posts.content_json (best-effort but
      // logged; the in-memory flip already makes it visible this request).
      try {
        const row: any = rawDb().prepare("SELECT content_json FROM network_posts WHERE id = ?").get(p.id);
        if (row) {
          const cj = (() => { try { return JSON.parse(row.content_json ?? "{}"); } catch { return {}; } })();
          cj.status = "published";
          cj.publishedAt = (p as any).publishedAt;
          rawDb().prepare("UPDATE network_posts SET content_json = ?, updated_at = ? WHERE id = ?")
            .run(JSON.stringify(cj), (p as any).publishedAt, p.id);
        }
      } catch (dbErr) {
        log.warn("[publishDueScheduledPosts] content_json update failed:", (dbErr as Error).message);
      }
      emitMutation({ aggregate: "post", id: p.id, change: "update" });
      // Notify channel participants ONCE (the post was not notified when created
      // scheduled).
      const ch = channels.get(p.channelId);
      for (const uid of (ch?.participantUserIds ?? []).filter((u: string) => u !== p.authorUserId)) {
        try {
          emitNotification({
            userId: uid,
            kind: "investor_report.published",
            title: `New post from ${resolveCommsDisplayName(null, p.authorUserId, { fullName: commsUserRef(p.authorUserId)?.legalName })}`,
            body: p.body.slice(0, 100),
            link: `/posts/${p.id}`,
          });
        } catch { /* noop */ }
      }
      published.push(p.id);
    } catch (err) {
      failed.push({ id: p.id, error: (err as Error).message });
    }
  }
  return { published, failed };
}

export function restorePostFromDb(row: {
  id: string;
  authorUserId: string;
  authorKind?: "user" | "company";
  body: string;
  createdAt: string;
  visibility?: string;
  companyId?: string | null;
  mediaUrls?: string[];
  topics?: string[];
  /** W2B B4 — commentId → parentCommentId, journaled in content_json. */
  commentParents?: Record<string, string>;
}): void {
  if (posts.has(row.id)) return; // already present
  const authorKind = (row.authorKind ?? "user") as "user" | "company";
  const visibility = (row.visibility ?? "public") as Post["visibility"];
  let channelId: string;
  // v14 — DB rows must carry their own companyId. A missing value here is a
  // data bug, not a recoverable case; we drop the post rather than silently
  // alias it to NovaPay.
  if ((visibility === "cap_table" || authorKind === "company") && !row.companyId) {
    return; // skip restoring an orphaned post
  }
  if (visibility === "cap_table") {
    channelId = capTableChannelId(row.companyId as string);
    /* ── W-COLLECTIVE Wave 2 Stage D (D5) — REBUILD, NOT GUESS ──────────────
       The note below correctly refused to synthesise this channel's participant
       list FROM THE POST ROW. Stage D does not do that either: the list is
       derived from the company's own durable rows (`company_members` for active
       founders, the SACRED `captable_commits` ledger for committed holders,
       `company_followers` for follows) by `ensureAnchoredChannel`, and it is
       persisted with its 0117 anchors so the next restart reproduces it exactly.
       Nothing is guessed and nothing comes from a seed array. Until this, these
       posts came back from every restart with no channel and post detail denied
       them to EVERYONE, including their author — the D5 ship gate. */
    ensureAnchoredChannel(channelId);
  } else if (authorKind === "company") {
    channelId = companyFollowersChannelId(row.companyId as string);
    ensureAnchoredChannel(channelId); // D5 — see the note above.
  } else {
    channelId = networkChannelId(row.authorUserId);
    /* W-COLLECTIVE Wave 1 (v4 §1.7, as corrected by v5 §B2).
       The live create path (`POST /api/comms/posts`, above) creates the
       author's `kind:"network"` channel before storing the post. This restore
       path did not, so after a restart every DB-restored post pointed at a
       channel absent from `channels`. `GET /api/comms/posts/:id` then took its
       `if (ch && !visible)` branch, found no channel, and served the post to
       ANY caller. The defect was in this restore path, not in the read.

       ONLY the per-author network channel is reconstructed here. A `cap_table`
       or `company_followers` channel's participant list IS the authorisation
       decision (who is on the cap table / who follows the company) and cannot
       be derived from a post row. Synthesising one from a guessed roster would
       either leak the post or wrongly admit members. Those channels are rebuilt
       from their own durable sources; a post whose channel is still missing is
       now DENIED by the detail read rather than served to everyone. */
    if (!channels.has(channelId)) {
      const author = viewerOf(row.authorUserId);
      channels.set(channelId, {
        id: channelId,
        kind: "network",
        participantUserIds: [row.authorUserId],
        createdAt: row.createdAt,
        metadata: { title: `${author.legalName}'s network`, ownerUserId: row.authorUserId },
      });
    }
  }
  /* W2B B4 — RESTORE engagement instead of resetting it.
     These four fields used to be hardcoded to empty/zero, which is why every
     restart of the LIVE server wiped every like, comment and share. They now
     come from the Stage A tables (network_post_likes / _comments / _shares).
     Soft-deleted comments are excluded by loadPostEngagement. */
  const engagement = loadPostEngagement(row.id, row.commentParents);
  const post: Post = {
    id: row.id,
    channelId,
    authorUserId: row.authorUserId,
    authorKind,
    body: row.body,
    createdAt: row.createdAt,
    visibility,
    likedByUserIds: engagement.likedByUserIds,
    commentCount: engagement.comments.length,
    comments: engagement.comments as Post["comments"],
    shareCount: engagement.shareCount,
    mediaUrls: row.mediaUrls,
    topics: row.topics,
    status: "published",
  };
  posts.set(row.id, post);
}

/* ---------- v17 Phase B — Collective-channel hydrator ---------- */
/**
 * Restores `posts` Map entries for posts with `visibility =
 * "public_to_collective"` from the `collective_channel_posts` table. Other
 * post slices (cap_table / followers / network) remain in-memory; their
 * persistence path runs through `networkPostsStore`.
 */
export async function hydrateCommsCollectiveStore(): Promise<void> {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(collectiveChannelPostsTable)
      .where(isNull((collectiveChannelPostsTable as any).deletedAt))
      .all() as any[];
    for (const r of rows) {
      const id = r.id;
      // Don't clobber an existing in-memory post (seeded data wins).
      if (posts.has(id)) continue;
      let likedBy: string[] = [];
      let comments: any[] = [];
      let topics: string[] | undefined;
      let mediaUrls: string[] | undefined;
      try { likedBy = JSON.parse(r.liked_by_json ?? r.likedByJson ?? "[]"); } catch { /* empty */ }
      try { comments = JSON.parse(r.comments_json ?? r.commentsJson ?? "[]"); } catch { /* empty */ }
      try {
        const t = r.topics_json ?? r.topicsJson;
        if (t) topics = JSON.parse(t);
      } catch { /* empty */ }
      try {
        const m = r.media_urls_json ?? r.mediaUrlsJson;
        if (m) mediaUrls = JSON.parse(m);
      } catch { /* empty */ }
      const post: Post = {
        id,
        channelId: r.channel_id ?? r.channelId,
        authorUserId: r.author_user_id ?? r.authorUserId,
        authorKind: (r.author_kind ?? r.authorKind ?? "user") as Post["authorKind"],
        body: r.body,
        createdAt: r.created_at ?? r.createdAt,
        visibility: "public_to_collective",
        likedByUserIds: likedBy,
        commentCount: Number(r.comment_count ?? r.commentCount ?? 0),
        comments,
        shareCount: Number(r.share_count ?? r.shareCount ?? 0),
        mediaUrls,
        topics,
        status: "published",
      };
      posts.set(id, post);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] commsStore (Collective slice): ${rows.length} posts restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] commsStore (Collective slice): DB read failed:", msg);
    }
  }
}

/**
 * v25.9 — Rehydrate comms channels + messages from DB on boot.
 *
 * Avi: "Most of the records are being saved in memory instead of the
 * database." Channels were previously RAM-only; this rebuilds the channels
 * Map from comms_channels (persisted by persistChannel) AND backfills the
 * messages Map from comms_messages (persistMessage).
 *
 * Idempotent. Skips rows that already exist in-memory (seed wins).
 */
export async function hydrateCommsStore(): Promise<void> {
  try {
    const db: any = rawDb();

    /* 1. Channels */
    let chRows: any[] = [];
    try {
      /* W-COLLECTIVE Wave 2 Stage D (D5) — the 0117 ANCHOR columns are now
         SELECTed. They existed since Stage A but were never read, so a channel
         came back from a restart with no idea which company/round/chapter it
         belonged to and `cap_table` / `company_followers` channels could not be
         rebuilt. */
      chRows = db.prepare(
        `SELECT id, kind, participant_user_ids_json, created_at, metadata_json,
                company_id, round_id, chapter_id
           FROM comms_channels WHERE deleted_at IS NULL`,
      ).all();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/no such table/i.test(msg)) {
        log.warn("[hydrate] commsStore.channels: DB read failed:", msg);
      }
    }
    for (const r of chRows) {
      if (channels.has(r.id)) continue;
      let participantUserIds: string[] = [];
      let metadata: any = undefined;
      try { participantUserIds = JSON.parse(r.participant_user_ids_json ?? "[]"); } catch { /* */ }
      try { if (r.metadata_json) metadata = JSON.parse(r.metadata_json); } catch { /* */ }
      const ch: Channel = {
        id: r.id,
        kind: r.kind as Channel["kind"],
        participantUserIds,
        createdAt: r.created_at,
        metadata,
        /* D5 — carry the durable anchors back into memory. Fall back to a decode
           of the channel id for rows persisted before the anchors were written
           (the id is the primary key and is minted deterministically, so this is
           a decode rather than a guess). */
        ...(r.company_id
          ? { companyId: r.company_id as string }
          : decodeChannelIdAnchors(r.id).anchors.companyId
            ? { companyId: decodeChannelIdAnchors(r.id).anchors.companyId as string }
            : {}),
        ...(r.round_id ? { roundId: r.round_id as string } : {}),
      };
      channels.set(ch.id, ch);
    }

    /* ── D5 — REBUILD ANCHORED CHANNEL MEMBERSHIP FROM DURABLE SOURCES ───────
       For every persisted `cap_table` / `company_followers` channel, refresh the
       participant list from the company's own rows (active founders, committed
       `captable_commits` holders, live `company_followers`) instead of trusting a
       possibly-stale JSON snapshot written by an earlier process. This is what
       makes the restart test in the Stage D brief pass with participants
       DERIVED, never seeded. `soft_circle` is deliberately skipped — deriving
       round membership would put a funding surface live, which Stage D forbids.
       Best-effort per channel: one bad row must not abort hydration. */
    for (const ch of Array.from(channels.values())) {
      if (ch.kind !== "cap_table" && ch.kind !== "company_followers") continue;
      try {
        ensureAnchoredChannel(ch.id);
      } catch (err) {
        log.warn(
          `[hydrate] commsStore.anchoredChannel ${ch.id} rebuild failed:`,
          (err as Error).message,
        );
      }
    }

    /* 2. Messages (already persisted; rebuild the Map) */
    let msgRows: any[] = [];
    try {
      msgRows = db.prepare(
        `SELECT id, channel_id, author_user_id, body, created_at, edited_at,
                deleted_at, reply_to_message_id, attachments_json,
                starred_by_user_ids_json, reactions_json, read_by_user_ids_json
           FROM comms_messages WHERE deleted_at IS NULL ORDER BY created_at ASC`,
      ).all();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/no such table/i.test(msg)) {
        log.warn("[hydrate] commsStore.messages: DB read failed:", msg);
      }
    }
    for (const r of msgRows) {
      if (messages.has(r.id)) continue;
      let attachments: any = []; let starredBy: string[] = [];
      let reactions: any = []; let readBy: string[] = [];
      try { attachments = JSON.parse(r.attachments_json ?? "[]"); } catch { /* */ }
      try { starredBy = JSON.parse(r.starred_by_user_ids_json ?? "[]"); } catch { /* */ }
      try { reactions = JSON.parse(r.reactions_json ?? "[]"); } catch { /* */ }
      try { readBy = JSON.parse(r.read_by_user_ids_json ?? "[]"); } catch { /* */ }
      const msg: Message = {
        id: r.id,
        channelId: r.channel_id,
        authorUserId: r.author_user_id,
        body: r.body,
        createdAt: r.created_at,
        editedAt: r.edited_at ?? undefined,
        deletedAt: r.deleted_at ?? undefined,
        replyToMessageId: r.reply_to_message_id ?? undefined,
        attachments,
        starredByUserIds: starredBy,
        reactions,
        readByUserIds: readBy,
      };
      messages.set(msg.id, msg);
    }

    if (chRows.length > 0 || msgRows.length > 0) {
      log.info(
        `[hydrate] commsStore: ${chRows.length} channels, ${msgRows.length} messages restored`,
      );
    }
  } catch (err) {
    log.warn(`[hydrate] commsStore: failed (non-fatal): ${(err as Error).message}`);
  }
}
