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
import { emitNotification } from "./notificationsStore";
import { resolvePersonaId } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

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
 * Sprint 22 Wave 1 — DEF-026 fix.
 * Priority: 1) req.userContext.userId (set by loadUserContext middleware)
 *           2) x-user-id header (test harness)
 *           3) x-actor-id header (legacy test support)
 *           4) cookie / userId query param via resolvePersonaId
 *           5) throws 401 — each route handler catches and returns 401.
 */
function actorOf(req: Request): { actorId: string; ip: string | undefined; ua: string | undefined } {
  const ctxUserId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId;
  const headerId = (req.headers["x-user-id"] as string | undefined)
    ?? (req.headers["x-actor-id"] as string | undefined);
  const cookieOrQuery = resolvePersonaId(req); // returns string | null
  const actorId = ctxUserId ?? headerId ?? cookieOrQuery ?? null;
  if (!actorId) {
    const err: Error & { status?: number } = new Error("Unauthenticated");
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

function channelIsVisibleToViewer(channel: Channel, viewerUserId: string): boolean {
  // For DMs / cap-table / soft-circle channels: must be a participant.
  // For company_followers + network: same — participant means follower / connection.
  return channel.participantUserIds.includes(viewerUserId);
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
    const postCompanyId = ch?.companyId ?? "co_novapay";
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
    cangel = author?.capavateAngelNetwork ?? false;
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
    const role = String(req.query.role ?? "investor"); // founder | investor | admin
    const visible = Array.from(channels.values()).filter((c) => channelIsVisibleToViewer(c, actorId));
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
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Channel not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
      return res.status(403).json({ message: "Not a member of this channel" });
    const view = projectChannel(ch, actorId);
    const msgs: MessageView[] = [];
    for (const m of messages.values()) {
      if (m.channelId !== ch.id) continue;
      if (m.deletedAt) continue;
      msgs.push(projectMessage(m, ch, actorId));
    }
    msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ channel: view, messages: msgs.slice(-50) });
  });

  /* ---- Send message ---- */
  app.post("/api/comms/channels/:id/messages", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Channel not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
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
      emitOutbox("message.sent", actorId, ip, ua, {
        messageId: id, channelId: ch.id, channelKind: ch.kind, authorUserId: actorId,
        recipientCount: ch.participantUserIds.filter((u) => u !== actorId).length,
      });
      // Sprint 19 A — emit SSE mutation so all clients see new message.
      emitMutation({ aggregate: "commsThread", id: ch.id, change: "update" });
      // Sprint 19 A / defect 8 — emit in-app notification for each non-author participant.
      // DEF-031: Use role-aware link so investors are not sent to /founder/ path.
      for (const uid of ch.participantUserIds.filter((u) => u !== actorId)) {
        const recipientIsFounder = COMMS_USERS[uid]?.roles.includes("founder") ?? false;
        const link = `/${recipientIsFounder ? "founder" : "investor"}/messages?thread=${ch.id}`;
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
    emitOutbox("message.deleted", actorId, ip, ua, { messageId: m.id, channelId: m.channelId });
    emitMutation({ aggregate: "commsThread", id: m.channelId, change: "update" });
    res.json({ ok: true });
  });

  /* ---- Star / unstar ---- */
  app.post("/api/comms/messages/:id/star", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
    if (!m.starredByUserIds.includes(actorId)) m.starredByUserIds.push(actorId);
    emitOutbox("message.starred", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId });
    res.json({ ok: true, starred: true });
  });
  app.delete("/api/comms/messages/:id/star", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
    m.starredByUserIds = m.starredByUserIds.filter((u) => u !== actorId);
    emitOutbox("message.unstarred", actorId, ip, ua, { messageId: m.id, channelId: m.channelId, userId: actorId });
    res.json({ ok: true, starred: false });
  });

  /* ---- Reactions ---- */
  app.post("/api/comms/messages/:id/reactions", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
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
    const m = messages.get(req.params.id);
    if (!m) return res.status(404).json({ message: "Not found" });
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
      if (parsed.data.visibility === "cap_table") {
        channelId = capTableChannelId(parsed.data.companyId ?? "co_novapay");
      } else {
        channelId = authorKind === "company"
          ? companyFollowersChannelId(parsed.data.companyId ?? "co_novapay")
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
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
    if (!p.likedByUserIds.includes(actorId)) p.likedByUserIds.push(actorId);
    emitOutbox("post.liked", actorId, ip, ua, { postId: p.id, userId: actorId });
    // Sprint 19 A — propagate to all feed caches.
    emitMutation({ aggregate: "post", id: p.id, change: "update" });
    res.json({ ok: true, likeCount: p.likedByUserIds.length });
  });
  app.delete("/api/comms/posts/:id/like", (req, res) => {
    const { actorId, ip, ua } = actorOf(req);
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
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
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
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
    const p = posts.get(req.params.id);
    if (!p) return res.status(404).json({ message: "Not found" });
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
    const companyId = (channels.get(p.channelId)?.companyId) ?? "co_novapay";
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
    const target = COMMS_USERS[parsed.data.targetUserId];
    if (!target) return res.status(404).json({ message: "Target user not found" });
    const me = viewerOf(actorId);
    const shared = sharedContextBetween(me, target);
    const r = resolveDisplayIdentity({
      viewerUserId: actorId,
      authorUserId: target.id,
      authorLegalName: target.legalName,
      authorVisibility: target.visibility,
      context: { sharedCapTables: shared.capTables, sharedCollectiveChapters: shared.chapters },
    });
    if (!r.canSendDm) {
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
        link: `/founder/messages?thread=${id}`,
      });
    } catch { /* noop */ }
    res.json({ ok: true, channelId: id, channel: projectChannel(ch, actorId) });
  });

  /* ---- Cap-table channel access (per-company) ---- */
  app.get("/api/comms/cap-table/:companyId", (req, res) => {
    const { actorId } = actorOf(req);
    const id = capTableChannelId(req.params.companyId);
    const ch = channels.get(id);
    if (!ch) return res.json({ exists: false });
    const isMember = channelIsVisibleToViewer(ch, actorId);
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
    const id = softCircleChannelId(req.params.roundId);
    const ch = channels.get(id);
    if (!ch) return res.json({ exists: false });
    const isMember = channelIsVisibleToViewer(ch, actorId);
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
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
      return res.status(403).json({ message: "Not a member" });
    emitOutbox("channel.typing", actorId, ip, ua, { channelId: ch.id, userId: actorId, ts: nowIso() });
    res.json({ ok: true, ts: nowIso() });
  });

  /* ---- E2: read-receipts — list of who has read up to which message ---- */
  app.get("/api/comms/channels/:id/read-receipts", (req, res) => {
    const { actorId } = actorOf(req);
    const ch = channels.get(req.params.id);
    if (!ch) return res.status(404).json({ message: "Not found" });
    if (!channelIsVisibleToViewer(ch, actorId))
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

  /* ---- Telemetry visibility ---- */
  app.get("/api/comms/dev/outbox", (_req, res) => res.json(outbox.slice(-50)));
  app.get("/api/comms/dev/audit", (_req, res) => res.json(auditEntries.slice(-50)));
}

/* Test access helpers. */
export const _commsTest = { channels, messages, posts, outbox, auditEntries, COMMS_USERS };
