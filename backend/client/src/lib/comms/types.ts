/**
 * Sprint 9 — Communications data model (production-shape).
 *
 * Topology:
 *   - dm                 1:1 between two users
 *   - cap_table          per-company group (founder + visible cap-table holders)
 *   - soft_circle        per-round group (founder + soft-circlers; lifecycle-bound)
 *   - company_followers  one-to-many posts from a company to its followers
 *   - network            user's personal post feed (network connections)
 *
 * Postgres column equivalents (snake_case) are documented inline next to each
 * field. The TypeScript shape uses camelCase; the wire format (JSON over HTTP
 * + outbox) uses camelCase as well.
 *
 * See:
 *   - capavate_collective_sync_schema.md §9 (event payload shapes)
 *   - capavate_gating_addendum.md §6      (visibility model)
 *   - collective_communications_audit.md  (UX patterns)
 */

import { z } from "zod";

/* ==================================================================== */
/* CHANNEL                                                              */
/* ==================================================================== */

export type ChannelKind =
  | "dm"
  | "cap_table"
  | "soft_circle"
  | "company_followers"
  | "network";

export const CHANNEL_KINDS = [
  "dm",
  "cap_table",
  "soft_circle",
  "company_followers",
  "network",
] as const;

/** Why a member entered/left a cap-table channel. */
export type CapTableMemberReason =
  | "founder"
  | "issuance"
  | "visibility_opt_in"
  | "visibility_opt_out"
  | "transfer";

/** Why a member entered/left a soft-circle channel. */
export type SoftCircleMemberReason =
  | "founder"
  | "soft_circle_created"
  | "soft_circle_signed"
  | "soft_circle_withdrawn"
  | "round_closed";

export interface Channel {
  /** Stable id — production: channels.id (text). */
  id: string;
  /** channel_kind */
  kind: ChannelKind;
  /** company_id — for cap_table, soft_circle, company_followers. */
  companyId?: string;
  /** round_id — for soft_circle. */
  roundId?: string;
  /** participant_user_ids — resolved at gate time. */
  participantUserIds: string[];
  /** created_at (ISO-8601) */
  createdAt: string;
  /** archived_at (ISO-8601) — set when round closes / channel sunset. */
  archivedAt?: string;
  /** Sprint 19 — user-level archive list. */
  archivedByUserIds?: string[];
  /** Sprint 19 — user-level mute list. */
  mutedByUserIds?: string[];
  /** Sprint 19 — user-level pin list. */
  pinnedByUserIds?: string[];
  /** Free-form metadata for display: title, badge, etc. */
  metadata: Record<string, unknown>;
}

export const channelSchema = z.object({
  id: z.string(),
  kind: z.enum(CHANNEL_KINDS),
  companyId: z.string().optional(),
  roundId: z.string().optional(),
  participantUserIds: z.array(z.string()),
  createdAt: z.string(),
  archivedAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
});

/* ==================================================================== */
/* MESSAGE                                                              */
/* ==================================================================== */

export interface MessageAttachment {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** sha256 of the upload — production: file integrity guarantee. */
  hash: string;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  channelId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  starredByUserIds: string[];
  reactions: MessageReaction[];
  replyToMessageId?: string;
  attachments?: MessageAttachment[];
  readByUserIds: string[];
}

export const messageSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorUserId: z.string(),
  body: z.string().max(8_000),
  createdAt: z.string(),
  editedAt: z.string().optional(),
  deletedAt: z.string().optional(),
  starredByUserIds: z.array(z.string()),
  reactions: z.array(z.object({ emoji: z.string(), userIds: z.array(z.string()) })),
  replyToMessageId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        sizeBytes: z.number().nonnegative(),
        mimeType: z.string(),
        hash: z.string(),
      }),
    )
    .optional(),
  readByUserIds: z.array(z.string()),
});

export const messageCreateSchema = z.object({
  body: z.string().min(1).max(8_000),
  replyToMessageId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        sizeBytes: z.number().nonnegative(),
        mimeType: z.string(),
        hash: z.string(),
      }),
    )
    .optional(),
});

export const messageEditSchema = z.object({
  body: z.string().min(1).max(8_000),
});

export const messageReactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

/* ==================================================================== */
/* POST                                                                 */
/* ==================================================================== */

export type PostAuthorKind = "user" | "company";
export type PostVisibility = "network" | "followers" | "public_to_collective" | "cap_table";

export interface PostComment {
  id: string;
  userId: string;
  body: string;
  createdAt: string;
}

export interface Post {
  id: string;
  channelId: string;
  authorUserId: string;
  authorKind: PostAuthorKind;
  body: string;
  createdAt: string;
  visibility: PostVisibility;
  likedByUserIds: string[];
  commentCount: number;
  comments: PostComment[];
  shareCount: number;
  /** companyIds the post-author is "Following" — drives the Following toggle on company posts. */
  followingCompanyIds?: string[];
  /** Sprint 19 — media attachments. */
  mediaUrls?: string[];
  /** Sprint 19 — extracted hashtags/topics. */
  topics?: string[];
  /** Sprint 19 — soft-delete. */
  deletedAt?: string;
  /** Sprint 19 — edit timestamp. */
  editedAt?: string;
  /** Sprint 19 — founder pin. */
  pinnedByFounderUserId?: string;
  /** Sprint 19 — scheduled publish time. */
  scheduledFor?: string;
  /** Sprint 19 — post status. */
  status?: "published" | "scheduled" | "draft";
}

export const postSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  authorUserId: z.string(),
  authorKind: z.enum(["user", "company"]),
  body: z.string().max(4_000),
  createdAt: z.string(),
  visibility: z.enum(["network", "followers", "public_to_collective"]),
  likedByUserIds: z.array(z.string()),
  commentCount: z.number().nonnegative().int(),
  comments: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      body: z.string(),
      createdAt: z.string(),
    }),
  ),
  shareCount: z.number().nonnegative().int(),
  followingCompanyIds: z.array(z.string()).optional(),
});

export const postCreateSchema = z.object({
  body: z.string().min(1).max(4_000),
  visibility: z.enum(["network", "followers", "public_to_collective", "cap_table"]),
  authorKind: z.enum(["user", "company"]).optional(),
  companyId: z.string().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
  topics: z.array(z.string()).optional(),
  scheduledFor: z.string().optional(),
});

export const postCommentCreateSchema = z.object({
  body: z.string().min(1).max(2_000),
});

/* ==================================================================== */
/* VISIBILITY (mirrors profile.types.InvestorVisibility)                */
/* ==================================================================== */

export interface Visibility {
  /** Public display name; empty = not set. */
  screenName?: string;
  /** Discoverable to direct cap-table co-members. Default false. */
  visibleToCoMembers: boolean;
  /** Discoverable to broader Capavate Collective. Default false. */
  visibleToCollectiveNetwork: boolean;
}

/* ==================================================================== */
/* DM-START PAYLOAD                                                     */
/* ==================================================================== */

export const dmStartSchema = z.object({
  targetUserId: z.string(),
});

/* ==================================================================== */
/* HELPERS                                                              */
/* ==================================================================== */

export function isGroupChannel(kind: ChannelKind): boolean {
  return kind === "cap_table" || kind === "soft_circle";
}

export function isPostChannel(kind: ChannelKind): boolean {
  return kind === "company_followers" || kind === "network";
}

/** Derive a stable, deterministic dm channel id from two user ids. */
export function dmChannelId(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `dm__${x}__${y}`;
}

/** Derive deterministic channel ids for the per-company / per-round groups. */
export function capTableChannelId(companyId: string): string {
  return `captable__${companyId}`;
}
export function softCircleChannelId(roundId: string): string {
  return `softcircle__${roundId}`;
}
export function companyFollowersChannelId(companyId: string): string {
  return `followers__${companyId}`;
}
export function networkChannelId(userId: string): string {
  return `network__${userId}`;
}
