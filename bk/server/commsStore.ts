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

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

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
import { emitMutation } from "./lib/eventBus";
import { publish as ssePublish } from "./lib/sseHub";
import { emitNotification } from "./notificationsStore";
import { resolvePersonaId } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { requireAdmin } from "./lib/authMiddleware"; /* v25.20 Lane 1 NC1 */
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
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";
// v24.0 C13: badge propagation reads from the LIVE membership store, not the
// static COMMS_USERS seed. Imported namespaced so we can fall back gracefully.
import * as collectiveMembershipStore from "./collectiveMembershipStore";
// v24.0 E7: partner detection for role-aware DM notification links.
import { partnerTeamStore } from "./partnerWorkspaceStore";
import { getUserContextForId } from "./lib/userContext";

/* v24.0 E7 — role-aware messages path for in-app notification deep links.
 * Mirrors the existing founder-vs-investor logic at the thread-reply site,
 * extended to route consortium partners to /partner/messages. Resolution
 * order: partner (active team membership) → founder (owns a company) → investor
 * (default). Best-effort: any resolver failure falls back to /investor. */
function messagesPathForUser(userId: string, threadId: string): string {
  try {
    if (partnerTeamStore.findByUserId(userId)) {
      return `/partner/messages?thread=${threadId}`;
    }
  } catch { /* fall through */ }
  try {
    const ctx = getUserContextForId(userId);
    if (ctx.founder?.companies?.length) {
      return `/founder/messages?thread=${threadId}`;
    }
  } catch { /* fall through */ }
  // Fall back to the static COMMS_USERS role hint if context unavailable.
  const isFounder = COMMS_USERS[userId]?.roles.includes("founder") ?? false;
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
    db.exec(`CREATE TABLE IF NOT EXISTS comms_channels (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      participant_user_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      metadata_json TEXT,
      deleted_at TEXT
    );`);
    db.prepare(
      `INSERT INTO comms_channels (id, kind, participant_user_ids_json, created_at, metadata_json, deleted_at)
         VALUES (?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           participant_user_ids_json = excluded.participant_user_ids_json,
           metadata_json = excluded.metadata_json,
           deleted_at = NULL`,
    ).run(
      ch.id,
      ch.kind,
      JSON.stringify(ch.participantUserIds ?? []),
      ch.createdAt,
      ch.metadata ? JSON.stringify(ch.metadata) : null,
    );
  } catch (err) {
    log.warn("[commsStore.persistChannel] DB write failed (continuing in-memory):", (err as Error).message);
  }
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
  if (auditEntries.length > 500) auditEntries.splice(0, auditEntries.length - 500);
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
  if (outbox.length > 500) outbox.splice(0, outbox.length - 500);
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
    metadata: { title: "DM — Aisha Patel ↔ Maya Chen" },
  });
  const dm2 = dmChannelId("u_aisha_patel", "u_hydra_capital");
  seedChannel({
    id: dm2,
    kind: "dm",
    participantUserIds: ["u_aisha_patel", "u_hydra_capital"],
    createdAt: "2026-04-19T15:30:00Z",
    metadata: { title: "DM — Aisha Patel ↔ Hydra Capital" },
  });
  const dm3 = dmChannelId("u_maya_chen", "u_hydra_capital");
  seedChannel({
    id: dm3,
    kind: "dm",
    participantUserIds: ["u_maya_chen", "u_hydra_capital"],
    createdAt: "2026-04-15T09:00:00Z",
    metadata: { title: "DM — Maya Chen ↔ Hydra Capital" },
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

/** DEF-038: Return minimal stub instead of Aisha's profile for unknown actors. */
function viewerOf(actorId: string): UserRef {
  return COMMS_USERS[actorId] ?? {
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
): ReturnType<typeof resolveDisplayIdentity> {
  const v = viewerOf(viewerUserId);
  const a = COMMS_USERS[authorUserId] ?? {
    id: authorUserId, legalName: authorUserId,
    email: "", visibility: { visibleToCoMembers: false, visibleToCollectiveNetwork: false },
    capTables: [], collectiveChapters: [], roles: [],
  } as UserRef;
  const shared = sharedContextBetween(v, a);
  return resolveDisplayIdentity({
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
      const r = resolveIdentity(viewerUserId, otherId, founderUserId);
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
    const r = resolveIdentity(viewerUserId, last.authorUserId, founderUserId);
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
  return {
    ...channel,
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
  const r = resolveIdentity(viewerUserId, msg.authorUserId, founderUserId);
  const author = COMMS_USERS[msg.authorUserId];
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
    const postCompanyId = ch?.companyId ?? "";
    const COMPANY_NAME_MAP: Record<string, string> = {
      co_novapay: "NovaPay AI",
      co_arboreal: "Arboreal",
      co_quanta: "Quanta Robotics",
      co_beacon: "Beacon Health",
      co_tideline: "Tideline Labs",
    };
    const companyName = COMPANY_NAME_MAP[postCompanyId] ?? postCompanyId;
    resolvedName = companyName;
    location = "San Francisco, CA";
    role = "Company";
  } else {
    const r = resolveIdentity(viewerUserId, post.authorUserId, undefined);
    resolvedName = r.displayName;
    isAnon = r.isAnonymous;
    const author = COMMS_USERS[post.authorUserId];
    location = author?.location ?? "";
    // v24.0 C13: derive the Capavate Angel Network badge from live membership
    // state. Fall back to the static COMMS_USERS field only if the live store
    // is unavailable (e.g. not yet hydrated / import missing).
    if (collectiveMembershipStore && typeof collectiveMembershipStore.isActive === "function") {
      cangel = collectiveMembershipStore.isActive(post.authorUserId);
    } else {
      cangel = author?.capavateAngelNetwork ?? false;
    }
    role = author?.roles.includes("founder") ? "Founder"
      : author?.roles.includes("investor") ? "Investor"
      : "Member";
  }
  return {
    ...post,
    authorLabel: resolvedName,
    authorRoleBadge: role,
    authorLocation: location,
    authorCapavateAngelNetwork: cangel,
    isAnonymous: isAnon,
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
      // Visibility — must be participant of the channel.
      if (!channelIsVisibleToViewer(ch, actorId)) continue;
      // Sprint 19 E — text search.
      if (q && !p.body.toLowerCase().includes(q)) continue;
      // Sprint 19 E — topic filter.
      if (topic && !(p as any).topics?.some((t: string) => t.toLowerCase() === topic)) continue;
      // Sprint 23 Wave B — DEF-034: filter by authorKind ("founders"|"investors"|"collective").
      if (authorKind && authorKind !== "all") {
        const author = COMMS_USERS[p.authorUserId];
        if (authorKind === "founders" && p.authorKind !== "company") continue;
        if (authorKind === "investors" && p.authorKind !== "user") continue;
        if (authorKind === "collective" && !(author?.collectiveChapters?.length ?? 0)) continue;
      }
      result.push(p);
    }
    if (sort === "newest") result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === "featured") result.sort((a, b) => (b.likedByUserIds.length + b.shareCount) - (a.likedByUserIds.length + a.shareCount));
    else if (sort === "following") {
      // Following = posts where the author is in your network connections / cap-table.
      const follow = new Set([...me.capTables, ...me.collectiveChapters]);
      result = result.filter((p) => {
        const author = COMMS_USERS[p.authorUserId];
        if (!author) return true;
        return author.capTables.some((c) => follow.has(c)) || author.collectiveChapters.some((c) => follow.has(c));
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
      posts.set(id, post);
      // v13 (Avi's Issue 5) — write-through to DB so posts survive restart.
      try {
        // Lazy require to avoid circular import at module load.
        const { persistNetworkPost } = require("./networkPostsStore");
        persistNetworkPost({
          id,
          authorUserId: actorId,
          authorKind,
          body: post.body,
          createdAt: post.createdAt,
          visibility: parsed.data.visibility,
          companyId: parsed.data.companyId ?? null,
          mediaUrls: post.mediaUrls,
          topics: post.topics,
        }, actorId);
      } catch (err) {
        // Tolerated — keeps the route 200 if persistence layer fails.
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
          log.warn("[commsStore.collectiveSlice] DB insert failed (memory only):", (err as Error).message);
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
        const viewerRole = COMMS_USERS[actorId]?.roles.includes("founder") ? "founder" : "investor";
        for (const uid of (ch?.participantUserIds ?? []).filter((u: string) => u !== actorId)) {
          try {
            emitNotification({
              userId: uid,
              kind: "investor_report.published",
              title: `New post from ${COMMS_USERS[actorId]?.legalName ?? actorId}`,
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
    const me = COMMS_USERS[actorId];
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
  app.post("/api/comms/posts/:id/like", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    if (!p.likedByUserIds.includes(actorId)) p.likedByUserIds.push(actorId);
    emitOutbox("post.liked", actorId, ip, ua, { postId: p.id, userId: actorId });
    // Sprint 19 A — propagate to all feed caches.
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, likeCount: p.likedByUserIds.length });
  });
  app.delete("/api/comms/posts/:id/like", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    p.likedByUserIds = p.likedByUserIds.filter((u) => u !== actorId);
    emitOutbox("post.unliked", actorId, ip, ua, { postId: p.id, userId: actorId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, likeCount: p.likedByUserIds.length });
  });

  /* ---- Posts: single post (B3+E4 detail view) ---- */
  app.get("/api/comms/posts/:id", (req, res) => {
    const { actorId } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    const ch = channels.get(p.channelId);
    if (ch && !channelIsVisibleToViewer(ch, actorId)) {
      return res.status(403).json({ message: "Not visible to you" });
    }
    const view = projectPost(p, actorId);
    // Resolve comment author labels (anonymous-aware) for nicer UI rendering.
    const commentsResolved = p.comments.map((c) => {
      const r = resolveIdentity(actorId, c.userId, undefined);
      return { ...c, authorLabel: r.displayName, isAnonymous: r.isAnonymous, parentCommentId: (c as any).parentCommentId };
    });
    // Reactions history is a derived view of likes for the detail panel.
    const reactionHistory = p.likedByUserIds.map((uid) => {
      const r = resolveIdentity(actorId, uid, undefined);
      return { userId: uid, label: r.displayName, isAnonymous: r.isAnonymous };
    });
    res.json({ post: view, comments: commentsResolved, reactionHistory });
  });

  /* ---- Posts: comments ---- */
  app.post("/api/comms/posts/:id/comments", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    const parsed = postCommentCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    const cid = `c_${randomBytes(6).toString("hex")}`;
    // Sprint 18 Phase 3 E4 — support a single level of nested replies via
    // optional parentCommentId.
    const parentCommentId = typeof req.body?.parentCommentId === "string" ? req.body.parentCommentId : undefined;
    p.comments.push({ id: cid, userId: actorId, body: parsed.data.body, createdAt: nowIso(), parentCommentId } as any);
    p.commentCount += 1;
    emitOutbox("post.commented", actorId, ip, ua, { postId: p.id, userId: actorId, commentId: cid, parentCommentId });
    // Sprint 19 A — emit SSE so feed cache refreshes.
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, commentId: cid, commentCount: p.commentCount });
  });

  /* ---- Posts: share ---- */
  app.post("/api/comms/posts/:id/share", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    if (!canMutatePost(res, req.params.id, actorId)) return; // B14
    const p = posts.get(req.params.id)!;
    p.shareCount += 1;
    emitOutbox("post.shared", actorId, ip, ua, { postId: p.id, userId: actorId });
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, shareCount: p.shareCount });
  });

  /* ---- Posts: follow toggle (only company posts) ---- */
  app.post("/api/comms/posts/:id/follow", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    if (p.authorKind !== "company")
      return res.status(400).json({ message: "Follow only valid for company posts" });
    // v14 — fall back to the post's own channelId-derived companyId; never "co_novapay".
    const companyId = channels.get(p.channelId)?.companyId ?? "";
    if (!companyId) return res.status(400).json({ message: "post_missing_companyId" });
    p.followingCompanyIds = Array.from(new Set([...(p.followingCompanyIds ?? []), companyId]));
    emitOutbox("post.followed", actorId, ip, ua, { postId: p.id, userId: actorId, companyId });
    res.json({ ok: true, followingCompanyIds: p.followingCompanyIds });
  });

  /* ---- DM start ---- */
  app.post("/api/comms/dm/start", (req, res) => {
    let actorId: string; let ip: string | undefined; let ua: string | undefined;
    try { ({ actorId, ip, ua } = actorOf(req)); } catch { return res.status(401).json({ message: "Unauthenticated" }); }
    const parsed = dmStartSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid", issues: parsed.error.issues });
    let target = COMMS_USERS[parsed.data.targetUserId];
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
          legalName: crm.name && crm.name.trim().length > 0 ? crm.name : crm.email,
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
    const r = resolveDisplayIdentity({
      viewerUserId: actorId,
      authorUserId: target.id,
      authorLegalName: target.legalName,
      authorVisibility: target.visibility,
      context: { sharedCapTables: shared.capTables, sharedCollectiveChapters: shared.chapters },
    });
    if (!r.canSendDm && !authorizedViaCrm) {
      emitOutbox("dm.channel.blocked", actorId, ip, ua, {
        fromUserId: actorId, toUserId: target.id,
        reason: shared.capTables.length === 0 && shared.chapters.length === 0 ? "no_shared_context" : "no_visibility",
      });
      return res.status(403).json({ ok: false, reason: r.reason });
    }
    const id = dmChannelId(actorId, target.id);
    let ch = channels.get(id);
    if (!ch) {
      ch = {
        id, kind: "dm",
        participantUserIds: [actorId, target.id],
        createdAt: nowIso(),
        metadata: { title: `DM — ${me.legalName} ↔ ${target.legalName}` },
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
        title: `${COMMS_USERS[actorId]?.legalName ?? actorId} opened a DM`,
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
  app.get("/api/comms/users", (req, res) => {
    const ctx = (req as unknown as { userContext?: { isAuthed?: boolean; userId?: string; isAdmin?: boolean } }).userContext;
    const all = Object.values(COMMS_USERS).map((u) => ({
      id: u.id, legalName: u.legalName, visibility: u.visibility,
      capTables: u.capTables, roles: u.roles, location: u.location,
      capavateAngelNetwork: u.capavateAngelNetwork ?? false,
    }));
    // Legacy test harnesses don't mount loadUserContext — preserve their behavior.
    if (!ctx) return res.json(all);
    if (!ctx.isAuthed) return res.json([]);
    if (ctx.isAdmin) return res.json(all);
    const viewerId = ctx.userId!;
    const peers = new Set<string>([viewerId]);
    for (const ch of channels.values()) {
      if (!ch.participantUserIds.includes(viewerId)) continue;
      for (const p of ch.participantUserIds) peers.add(p);
    }
    res.json(all.filter((u) => peers.has(u.id)));
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
  } else if (authorKind === "company") {
    channelId = companyFollowersChannelId(row.companyId as string);
  } else {
    channelId = networkChannelId(row.authorUserId);
  }
  const post: Post = {
    id: row.id,
    channelId,
    authorUserId: row.authorUserId,
    authorKind,
    body: row.body,
    createdAt: row.createdAt,
    visibility,
    likedByUserIds: [],
    commentCount: 0,
    comments: [],
    shareCount: 0,
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
      chRows = db.prepare(
        `SELECT id, kind, participant_user_ids_json, created_at, metadata_json
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
      };
      channels.set(ch.id, ch);
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
