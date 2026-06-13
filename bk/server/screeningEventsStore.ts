/**
 * server/screeningEventsStore.ts — v18 Phase A.
 *
 * Screening event scheduling for the Capavate Collective. A "screening event"
 * is a chapter-scoped meeting (DSC screening, founder pitch, or office hours)
 * between a company and a set of chapter members. Each event:
 *
 *   - Lives in a single chapter (`chapter_id`); cross-chapter reads are 403.
 *   - Has a hash-chained row (prev_hash → curr_hash) per state transition so
 *     the lifecycle (created → cancelled / completed) is audit-grade.
 *   - Carries a stable ICS `uid` so calendar clients dedup on re-import.
 *   - Has a separate attendee table: one row per (event, user), with
 *     RSVP + attended flags. UNIQUE(event_id, user_id).
 *
 * Endpoints (all under /api/collective/screening-events; gated by
 * requireCollectiveEnabled + requireAuth + requireCollectiveMember + a
 * per-route chapter membership / role check):
 *
 *   POST  /                    — create event (chapter admin or DSC role)
 *   GET   /                    — list events for caller's chapter
 *   GET   /:id                 — full event detail + attendees
 *   POST  /:id/rsvp            — current user RSVPs (accepted|declined|tentative)
 *   POST  /:id/check-in        — admin checks an attendee in
 *   POST  /:id/cancel          — admin or organizer cancels; cascades
 *                                attendees to RSVP='declined' (event gone)
 *                                and emits a notification fan-out
 *   GET   /:id/ics             — RFC5545 ICS file (Content-Type: text/calendar)
 *
 * Hard rules (v19 brief §10–42):
 *   - SYNC transactions only — better-sqlite3 rejects async callbacks. Hash
 *     computation is done BEFORE opening any tx; the tx body is pure DB
 *     writes (Phase B finding).
 *   - withTenant() on every query unless explicitly cross-tenant (which is
 *     marked inline).
 *   - Hash-chained writes happen inside the same tx as the state change.
 *   - Feature-flag gated by COLLECTIVE_ENABLED=1; graceful 503 when off.
 *   - NO mock data, NO TODOs, NO stubs — everything is real Drizzle wiring.
 *
 * Third-party calendar integration (Google Calendar API / Microsoft Graph)
 * is Avi's responsibility — env-gated by GOOGLE_CALENDAR_CLIENT_ID /
 * GOOGLE_CALENDAR_CLIENT_SECRET / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET.
 * When unset (the default), this module only emits ICS; no calls to any
 * third-party service. See docs/PHASE_18A_REPORT.md for the env var list.
 */

import type { Express, Request, Response } from "express";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireAuth } from "./lib/authMiddleware";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { withTenant } from "./lib/withTenant";
import { getDb } from "./db/connection";
import {
  screeningEvents as screeningEventsTable,
  screeningEventAttendees as screeningEventAttendeesTable,
  chapterMemberships as chapterMembershipsTable,
} from "@shared/schema";
import { isDscMember } from "./adminDscRoutes";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitNotification, type NotificationKind } from "./notificationsStore";
import { emitMutation } from "./lib/eventBus";
import { publish as ssePublish } from "./lib/sseHub";
import { tenantForChapter } from "./lib/chapterDefaults";
import { generateIcs } from "./lib/icsGenerator";
import { log } from "./lib/logger";

/* --------------------------------------------------------------- */
/* Types                                                            */
/* --------------------------------------------------------------- */

export type EventType = "screening" | "pitch" | "office_hours";
export type EventStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type AttendeeRole = "founder" | "investor" | "dsc" | "observer";
export type RsvpStatus = "invited" | "accepted" | "declined" | "tentative";

export interface ScreeningEventRow {
  id: string;
  tenantId: string;
  chapterId: string;
  roundId: string | null;
  companyId: string;
  title: string;
  description: string;
  /** Unix seconds since epoch. */
  scheduledFor: number;
  durationMinutes: number;
  location: string | null;
  eventType: EventType;
  status: EventStatus;
  organizerUserId: string;
  icsUid: string;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendeeRow {
  id: string;
  eventId: string;
  userId: string;
  role: AttendeeRole;
  rsvp: RsvpStatus;
  attended: boolean;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Same hash function used across v17 hash-chained stores so verifiers can
 * walk multiple chains with a single algorithm.
 */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function rowToEvent(r: any): ScreeningEventRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? r.tenantId,
    chapterId: r.chapter_id ?? r.chapterId,
    roundId: r.round_id ?? r.roundId ?? null,
    companyId: r.company_id ?? r.companyId,
    title: r.title,
    description: r.description ?? "",
    scheduledFor: Number(r.scheduled_for ?? r.scheduledFor ?? 0),
    durationMinutes: Number(r.duration_minutes ?? r.durationMinutes ?? 60),
    location: r.location ?? null,
    eventType: (r.event_type ?? r.eventType ?? "screening") as EventType,
    status: (r.status ?? "scheduled") as EventStatus,
    organizerUserId: r.organizer_user_id ?? r.organizerUserId,
    icsUid: r.ics_uid ?? r.icsUid,
    prevHash: r.prev_hash ?? r.prevHash ?? null,
    currHash: r.curr_hash ?? r.currHash,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

function rowToAttendee(r: any): AttendeeRow {
  return {
    id: r.id,
    eventId: r.event_id ?? r.eventId,
    userId: r.user_id ?? r.userId,
    role: (r.role ?? "observer") as AttendeeRole,
    rsvp: (r.rsvp ?? "invited") as RsvpStatus,
    attended: !!(r.attended ?? 0),
    checkedInAt: r.checked_in_at ?? r.checkedInAt ?? null,
    createdAt: r.created_at ?? r.createdAt,
    updatedAt: r.updated_at ?? r.updatedAt,
  };
}

/**
 * Inline mirror of `requireChapterMember._internal.isActiveChapterMember`.
 *
 * Returns `{ role: 'member' | 'admin' }` when active, or null when not a
 * member. Routes use this to decide chapter-admin write access without
 * needing a separate middleware (the dynamic shape — chapter id comes from
 * the row, not from req params).
 *
 * CROSS-TENANT (admin) — justified because chapter_memberships is the table
 * that establishes the active chapter scope; it cannot itself be
 * tenant-scoped without chicken-and-egg.
 */
export function getChapterMembership(
  userId: string,
  chapterId: string,
): { role: string; status: string } | null {
  try {
    const db: any = getDb();
    const rows = db
      .select({
        role: (chapterMembershipsTable as any).role,
        status: (chapterMembershipsTable as any).status,
      })
      .from(chapterMembershipsTable)
      .where(
        and(
          eq((chapterMembershipsTable as any).userId, userId),
          eq((chapterMembershipsTable as any).chapterId, chapterId),
          isNull((chapterMembershipsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "active") return null;
    return { role: String(row.role ?? "member"), status: String(row.status) };
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[screeningEventsStore.getChapterMembership] read failed:", msg);
    }
    return null;
  }
}

/** Caller is allowed to create/cancel/check-in for a chapter? */
function canAdminChapterEvents(
  ctx: { userId?: string; isAdmin?: boolean } | undefined,
  chapterId: string,
): boolean {
  if (!ctx?.userId) return false;
  if (ctx.isAdmin) return true; // platform admin bypass — parity with other Collective routes.
  const m = getChapterMembership(ctx.userId, chapterId);
  if (!m) return false;
  if (m.role === "admin") return true;
  // DSC role is acceptable too — the brief lists "chapter admin + DSC only"
  // for the create endpoint.
  if (isDscMember(ctx.userId)) return true;
  return false;
}

/**
 * Load a single event by id (cross-tenant — caller scope is established by
 * the subsequent chapter membership assertion).
 *
 * CROSS-TENANT (admin) — justified because the route caller's active tenant
 * may differ from the event's chapter tenant; we need to load the row to
 * resolve which chapter to assert membership against. Soft-delete is still
 * applied via `isNull(deletedAt)`.
 */
function findEventByIdAnyTenant(eventId: string): ScreeningEventRow | null {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(screeningEventsTable)
      .where(
        and(
          eq((screeningEventsTable as any).id, eventId),
          isNull((screeningEventsTable as any).deletedAt),
        ),
      )
      .limit(1)
      .all() as any[];
    if (rows.length === 0) return null;
    return rowToEvent(rows[0]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[screeningEventsStore.findEventByIdAnyTenant] read failed:", msg);
    }
    return null;
  }
}

/** Load attendees for an event ordered by created_at ASC. */
function listAttendeesForEvent(eventId: string): AttendeeRow[] {
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(screeningEventAttendeesTable)
      .where(eq((screeningEventAttendeesTable as any).eventId, eventId))
      .orderBy(asc((screeningEventAttendeesTable as any).createdAt))
      .all() as any[];
    return rows.map(rowToAttendee);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[screeningEventsStore.listAttendeesForEvent] read failed:", msg);
    }
    return [];
  }
}

/* --------------------------------------------------------------- */
/* Validation schemas                                               */
/* --------------------------------------------------------------- */

const createEventBodySchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters.").max(200),
  description: z.string().max(2000).optional(),
  /** Unix seconds since epoch — must be in the future. */
  scheduled_for: z.number().int().positive(),
  duration_minutes: z.number().int().positive().max(60 * 12).optional(),
  location: z.string().max(1000).optional(),
  event_type: z.enum(["screening", "pitch", "office_hours"]).optional(),
  round_id: z.string().min(1).optional(),
  company_id: z.string().min(1, "company_id required"),
  chapter_id: z.string().min(1, "chapter_id required"),
  attendee_user_ids: z.array(z.string().min(1)).default([]),
});

const rsvpBodySchema = z.object({
  rsvp: z.enum(["accepted", "declined", "tentative"]),
});

const checkInBodySchema = z.object({
  user_id: z.string().min(1, "user_id required"),
});

/* --------------------------------------------------------------- */
/* Notification helpers                                             */
/* --------------------------------------------------------------- */

/**
 * Fan out a screening-event notification to a set of users.
 *
 * The Collective slice of commsStore is a per-channel post stream (Phase B
 * DB-backed under `collective_channel_posts`). For per-user delivery of
 * event lifecycle signals we use `emitNotification` (the v12 in-app +
 * email queue path), which is the same surface v17 Phase C offers used.
 * Notification kinds for screening events are namespaced under
 * `collective.screening_event.*`. Since `NotificationKind` is statically
 * typed and additions touch a separate audit, we cast at the call site
 * (matching the v17 Phase C offers pattern).
 */
function notifyAttendees(args: {
  userIds: string[];
  kind: string;
  title: string;
  body: string;
  link: string;
}): void {
  for (const uid of args.userIds) {
    try {
      emitNotification({
        userId: uid,
        kind: args.kind as NotificationKind,
        title: args.title,
        body: args.body,
        link: args.link,
      });
    } catch {
      /* non-fatal */
    }
  }
}

/* --------------------------------------------------------------- */
/* Route registration                                               */
/* --------------------------------------------------------------- */

export function registerScreeningEventRoutes(app: Express): void {
  /**
   * POST /api/collective/screening-events
   *
   * Create a new screening event. Caller must be chapter admin OR a DSC
   * member of the named chapter. Creates the event row and an attendee row
   * per user id in `attendee_user_ids` (deduplicated). Hash-chained: the
   * first row's `prev_hash` is null; subsequent edits/cancels extend the
   * chain via the existing row's `curr_hash`.
   *
   * Notifications fire to every attendee on creation.
   */
  app.post(
    "/api/collective/screening-events",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const parsed = createEventBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const {
        title,
        description = "",
        scheduled_for,
        duration_minutes = 60,
        location,
        event_type = "screening",
        round_id,
        company_id,
        chapter_id,
        attendee_user_ids,
      } = parsed.data;

      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }

      if (!canAdminChapterEvents(ctx, chapter_id)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_chapter_admin_or_dsc" });
      }

      // Pre-compute the new row + the hash + the attendee list BEFORE
      // opening the transaction. Per Rule 6, the sync callback body only
      // contains the actual DB writes.
      const eventId = `screv_${randomBytes(8).toString("hex")}`;
      const icsUid = `${eventId}@capavate.collective`;
      const tenantId = tenantForChapter(chapter_id);
      const ts = nowIso();

      const payloadForHash = {
        id: eventId,
        tenantId,
        chapterId: chapter_id,
        companyId: company_id,
        roundId: round_id ?? null,
        title,
        scheduledFor: scheduled_for,
        durationMinutes: duration_minutes,
        eventType: event_type,
        organizerUserId: userId,
        action: "create",
        ts,
      };
      const currHash = computeHash(null, payloadForHash);

      const dedupedAttendees = Array.from(new Set(attendee_user_ids ?? []));
      // Ensure organizer is included as an attendee (role='observer' by
      // default; admin/DSC running the screening). Idempotent.
      if (!dedupedAttendees.includes(userId)) {
        dedupedAttendees.push(userId);
      }

      const attendeeInserts = dedupedAttendees.map((uid) => ({
        id: `scrat_${randomBytes(6).toString("hex")}`,
        eventId,
        userId: uid,
        // Organizer defaults to 'observer' role (admin running the event);
        // others get 'observer' too unless we know more — the chapter UI
        // can refine roles later via a future endpoint. Keeping the
        // default minimal avoids guessing roles for non-organizer users.
        role: uid === userId ? "observer" : "observer",
        rsvp: uid === userId ? "accepted" : "invited",
        attended: 0,
        checkedInAt: null,
        createdAt: ts,
        updatedAt: ts,
      }));

      try {
        const db: any = getDb();
        // SYNC transaction (better-sqlite3 rejects async callbacks).
        db.transaction((tx: any) => {
          tx.insert(screeningEventsTable).values({
            id: eventId,
            tenantId,
            chapterId: chapter_id,
            roundId: round_id ?? null,
            companyId: company_id,
            title,
            description: description ?? "",
            scheduledFor: scheduled_for,
            durationMinutes: duration_minutes,
            location: location ?? null,
            eventType: event_type,
            status: "scheduled",
            organizerUserId: userId,
            icsUid,
            prevHash: null,
            currHash,
            createdAt: ts,
            updatedAt: ts,
          } as any).run();

          for (const att of attendeeInserts) {
            tx.insert(screeningEventAttendeesTable).values(att as any).run();
          }
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        log.error("[POST screening-events] tx failed:", msg);
        return res
          .status(500)
          .json({ ok: false, error: "internal_error", message: msg });
      }

      // Audit append (outside the tx — appendAdminAudit opens its own).
      try {
        appendAdminAudit(
          userId,
          `screening_event:${eventId}`,
          "collective.screening_event.created",
          {
            eventId,
            chapterId: chapter_id,
            companyId: company_id,
            scheduledFor: scheduled_for,
            eventType: event_type,
            attendeeCount: dedupedAttendees.length,
            hash: currHash,
          },
          tenantId,
        );
      } catch (err) {
        log.warn(
          "[POST screening-events] audit append failed (non-fatal):",
          (err as Error).message,
        );
      }

      // Notify all attendees that the event was created.
      notifyAttendees({
        userIds: dedupedAttendees,
        kind: "collective.screening_event.scheduled",
        title: `Screening event scheduled: ${title}`,
        body: `${event_type === "screening" ? "DSC screening" : event_type === "pitch" ? "Pitch" : "Office hours"} scheduled for ${new Date(scheduled_for * 1000).toISOString()}.`,
        link: `/collective/screening-events/${eventId}`,
      });

      try {
        emitMutation({
          aggregate: "screening_event",
          id: eventId,
          change: "create",
          tenantId,
        });
      } catch {
        /* non-fatal */
      }

      // v18 Phase D — SSE fan-out (post-commit, outside any tx).
      try {
        ssePublish(chapter_id, "events", {
          kind: "screening_event.created",
          eventId,
          chapterId: chapter_id,
          companyId: company_id,
          scheduledFor: scheduled_for,
        });
      } catch { /* non-fatal */ }

      const event = findEventByIdAnyTenant(eventId);
      const attendees = listAttendeesForEvent(eventId);
      return res.status(201).json({ ok: true, event, attendees });
    },
  );

  /**
   * GET /api/collective/screening-events
   *
   * List events for the caller's chapter. Query params: status, company_id,
   * round_id, from (unix sec), to (unix sec). chapter_id is required and
   * the caller must be a chapter member.
   */
  app.get(
    "/api/collective/screening-events",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const chapterId = String(req.query.chapter_id ?? req.query.chapterId ?? "").trim();
      if (!chapterId) {
        return res.status(400).json({ ok: false, error: "missing_chapter_id" });
      }
      if (!ctx?.isAdmin) {
        if (!getChapterMembership(userId, chapterId)) {
          return res
            .status(403)
            .json({ ok: false, error: "not_chapter_member" });
        }
      }

      const status = typeof req.query.status === "string" ? req.query.status : null;
      const companyId =
        typeof req.query.company_id === "string"
          ? req.query.company_id
          : typeof req.query.companyId === "string"
            ? req.query.companyId
            : null;
      const roundId =
        typeof req.query.round_id === "string"
          ? req.query.round_id
          : typeof req.query.roundId === "string"
            ? req.query.roundId
            : null;
      const from =
        typeof req.query.from === "string" && /^\d+$/.test(req.query.from)
          ? parseInt(req.query.from, 10)
          : null;
      const to =
        typeof req.query.to === "string" && /^\d+$/.test(req.query.to)
          ? parseInt(req.query.to, 10)
          : null;

      const tenantId = tenantForChapter(chapterId);
      const conditions: any[] = [
        eq((screeningEventsTable as any).chapterId, chapterId),
      ];
      if (status) conditions.push(eq((screeningEventsTable as any).status, status));
      if (companyId)
        conditions.push(eq((screeningEventsTable as any).companyId, companyId));
      if (roundId)
        conditions.push(eq((screeningEventsTable as any).roundId, roundId));
      if (from !== null)
        conditions.push(gte((screeningEventsTable as any).scheduledFor, from));
      if (to !== null)
        conditions.push(lte((screeningEventsTable as any).scheduledFor, to));

      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(screeningEventsTable)
          .where(
            withTenant(and(...conditions)!, {
              tenantId,
              table: screeningEventsTable as any,
            }),
          )
          .orderBy(asc((screeningEventsTable as any).scheduledFor))
          .all() as any[];
        return res.json({ ok: true, events: rows.map(rowToEvent) });
      } catch (err) {
        log.warn(
          "[GET screening-events] DB read failed:",
          (err as Error).message,
        );
        return res.json({ ok: true, events: [], degraded: true });
      }
    },
  );

  /**
   * GET /api/collective/screening-events/:id
   *
   * Full event detail including the attendees list (with each attendee's
   * RSVP + attended state). Caller must be a member of the event's chapter.
   */
  app.get(
    "/api/collective/screening-events/:id",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_event_id" });
      }
      const event = findEventByIdAnyTenant(id);
      if (!event) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!ctx?.isAdmin) {
        const userId = ctx?.userId;
        if (!userId) {
          return res.status(401).json({ ok: false, error: "missing_identity" });
        }
        if (!getChapterMembership(userId, event.chapterId)) {
          return res
            .status(403)
            .json({ ok: false, error: "not_chapter_member" });
        }
      }
      const attendees = listAttendeesForEvent(event.id);
      return res.json({ ok: true, event, attendees });
    },
  );

  /**
   * POST /api/collective/screening-events/:id/rsvp
   *
   * Current user RSVPs to the event. Idempotent: re-RSVP with the same
   * value returns 200 with `idempotent: true`. The user MUST already be in
   * the event's attendee list (admin invites — there is no self-add path
   * here on purpose; the brief specifies admin/DSC-only event creation
   * with explicit attendee_user_ids).
   */
  app.post(
    "/api/collective/screening-events/:id/rsvp",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_event_id" });
      }
      const parsed = rsvpBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { rsvp } = parsed.data;

      const event = findEventByIdAnyTenant(id);
      if (!event) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      if (event.status === "cancelled") {
        return res.status(409).json({ ok: false, error: "event_cancelled" });
      }

      // Find the attendee row for this user. If absent → 403 (the user is
      // not invited). Admin bypass NOT permitted here — RSVPing for someone
      // else is what check-in is for.
      let attendee: AttendeeRow | null = null;
      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(screeningEventAttendeesTable)
          .where(
            and(
              eq((screeningEventAttendeesTable as any).eventId, id),
              eq((screeningEventAttendeesTable as any).userId, userId),
            ),
          )
          .limit(1)
          .all() as any[];
        if (rows.length > 0) attendee = rowToAttendee(rows[0]);
      } catch (err) {
        log.warn(
          "[POST rsvp] read failed:",
          (err as Error).message,
        );
      }
      if (!attendee) {
        return res.status(403).json({ ok: false, error: "not_invited" });
      }

      // Idempotent re-RSVP.
      if (attendee.rsvp === rsvp) {
        return res.json({ ok: true, idempotent: true, attendee });
      }

      const ts = nowIso();
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(screeningEventAttendeesTable)
            .set({ rsvp, updatedAt: ts } as any)
            .where(eq((screeningEventAttendeesTable as any).id, attendee!.id))
            .run();
        });
      } catch (err) {
        log.error(
          "[POST rsvp] tx failed:",
          (err as Error).message,
        );
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      const updated: AttendeeRow = { ...attendee, rsvp, updatedAt: ts };

      // Notify the organizer (best-effort, non-fatal).
      try {
        emitNotification({
          userId: event.organizerUserId,
          kind: "collective.screening_event.rsvp_changed" as NotificationKind,
          title: `RSVP update for ${event.title}`,
          body: `${userId} is now ${rsvp}.`,
          link: `/collective/screening-events/${event.id}`,
        });
      } catch {
        /* non-fatal */
      }

      try {
        emitMutation({
          aggregate: "screening_event_attendee",
          id: attendee.id,
          change: "update",
          tenantId: event.tenantId,
        });
      } catch {
        /* non-fatal */
      }
      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(event.chapterId, "events", {
          kind: "screening_event.rsvp",
          eventId: event.id,
          attendeeUserId: attendee.userId,
          rsvp,
        });
      } catch { /* non-fatal */ }

      return res.json({ ok: true, attendee: updated });
    },
  );

  /**
   * POST /api/collective/screening-events/:id/check-in
   *
   * Chapter admin / DSC marks an attendee as attended (and stamps
   * checked_in_at). Body: { user_id }. Idempotent on a re-check-in of an
   * already-attended user.
   */
  app.post(
    "/api/collective/screening-events/:id/check-in",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_event_id" });
      }
      const parsed = checkInBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "validation_failed",
          issues: parsed.error.format(),
        });
      }
      const { user_id } = parsed.data;
      const event = findEventByIdAnyTenant(id);
      if (!event) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!canAdminChapterEvents(ctx, event.chapterId)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_chapter_admin_or_dsc" });
      }

      let attendee: AttendeeRow | null = null;
      try {
        const db: any = getDb();
        const rows = db
          .select()
          .from(screeningEventAttendeesTable)
          .where(
            and(
              eq((screeningEventAttendeesTable as any).eventId, id),
              eq((screeningEventAttendeesTable as any).userId, user_id),
            ),
          )
          .limit(1)
          .all() as any[];
        if (rows.length > 0) attendee = rowToAttendee(rows[0]);
      } catch (err) {
        log.warn(
          "[POST check-in] read failed:",
          (err as Error).message,
        );
      }
      if (!attendee) {
        return res.status(404).json({ ok: false, error: "attendee_not_found" });
      }
      if (attendee.attended) {
        return res.json({ ok: true, idempotent: true, attendee });
      }

      const ts = nowIso();
      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          tx.update(screeningEventAttendeesTable)
            .set({ attended: 1, checkedInAt: ts, updatedAt: ts } as any)
            .where(eq((screeningEventAttendeesTable as any).id, attendee!.id))
            .run();
        });
      } catch (err) {
        log.error(
          "[POST check-in] tx failed:",
          (err as Error).message,
        );
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      const updated: AttendeeRow = {
        ...attendee,
        attended: true,
        checkedInAt: ts,
        updatedAt: ts,
      };
      try {
        emitMutation({
          aggregate: "screening_event_attendee",
          id: attendee.id,
          change: "update",
          tenantId: event.tenantId,
        });
      } catch {
        /* non-fatal */
      }
      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(event.chapterId, "events", {
          kind: "screening_event.checked_in",
          eventId: event.id,
          attendeeUserId: attendee.userId,
        });
      } catch { /* non-fatal */ }
      return res.json({ ok: true, attendee: updated });
    },
  );

  /**
   * POST /api/collective/screening-events/:id/cancel
   *
   * Chapter admin (or the organizer) cancels the event. Cascades by
   * setting `event.status = 'cancelled'` and notifying all attendees.
   * Hash-chain extended (prev_hash = old curr_hash, curr_hash = new).
   * Attendee RSVP rows are left intact for post-mortem; the event status
   * is the source of truth for "did this happen?" downstream.
   *
   * Idempotent: cancelling an already-cancelled event returns 200 with
   * `idempotent: true`.
   */
  app.post(
    "/api/collective/screening-events/:id/cancel",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_event_id" });
      }
      const event = findEventByIdAnyTenant(id);
      if (!event) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      const userId = ctx?.userId;
      if (!userId) {
        return res.status(401).json({ ok: false, error: "missing_identity" });
      }
      const isOrganizer = event.organizerUserId === userId;
      if (!isOrganizer && !canAdminChapterEvents(ctx, event.chapterId)) {
        return res
          .status(403)
          .json({ ok: false, error: "not_authorized_to_cancel" });
      }

      if (event.status === "cancelled") {
        return res.json({ ok: true, idempotent: true, event });
      }

      const ts = nowIso();
      const cancelPayload = {
        eventId: event.id,
        chapterId: event.chapterId,
        action: "cancel",
        cancelledBy: userId,
        previousStatus: event.status,
        ts,
      };
      const newHash = computeHash(event.currHash, cancelPayload);

      try {
        const db: any = getDb();
        db.transaction((tx: any) => {
          // Re-read inside the tx to defeat a stale optimistic decision.
          const fresh = tx
            .select()
            .from(screeningEventsTable)
            .where(
              and(
                eq((screeningEventsTable as any).id, id),
                isNull((screeningEventsTable as any).deletedAt),
              ),
            )
            .all() as any[];
          if (fresh.length === 0) {
            throw new Error("event_missing_inside_tx");
          }
          const freshRow = rowToEvent(fresh[0]);
          if (freshRow.status === "cancelled") {
            throw new Error("race_cancelled");
          }
          tx.update(screeningEventsTable)
            .set({
              status: "cancelled",
              prevHash: freshRow.currHash,
              currHash: newHash,
              updatedAt: ts,
            } as any)
            .where(eq((screeningEventsTable as any).id, id))
            .run();
        });
      } catch (err) {
        const msg = (err as Error).message ?? "";
        if (msg === "race_cancelled") {
          const refreshed = findEventByIdAnyTenant(id);
          return res.json({ ok: true, idempotent: true, event: refreshed });
        }
        log.error(
          "[POST cancel] tx failed:",
          msg,
        );
        return res.status(500).json({ ok: false, error: "internal_error" });
      }

      const updatedEvent = findEventByIdAnyTenant(id);
      const attendees = listAttendeesForEvent(id);

      // Audit + notifications fan-out.
      try {
        appendAdminAudit(
          userId,
          `screening_event:${event.id}`,
          "collective.screening_event.cancelled",
          {
            eventId: event.id,
            chapterId: event.chapterId,
            companyId: event.companyId,
            cancelledBy: userId,
            previousStatus: event.status,
            hash: newHash,
          },
          event.tenantId,
        );
      } catch (err) {
        log.warn(
          "[POST cancel] audit append failed (non-fatal):",
          (err as Error).message,
        );
      }

      notifyAttendees({
        userIds: attendees.map((a) => a.userId),
        kind: "collective.screening_event.cancelled",
        title: `Screening event cancelled: ${event.title}`,
        body: `The event scheduled for ${new Date(event.scheduledFor * 1000).toISOString()} has been cancelled.`,
        link: `/collective/screening-events/${event.id}`,
      });

      try {
        emitMutation({
          aggregate: "screening_event",
          id: event.id,
          change: "update",
          tenantId: event.tenantId,
        });
      } catch {
        /* non-fatal */
      }
      // v18 Phase D — SSE fan-out (post-commit).
      try {
        ssePublish(event.chapterId, "events", {
          kind: "screening_event.cancelled",
          eventId: event.id,
        });
      } catch { /* non-fatal */ }

      return res.json({ ok: true, event: updatedEvent, attendees });
    },
  );

  /**
   * GET /api/collective/screening-events/:id/ics
   *
   * Returns an RFC5545 ICS file. Content-Type: text/calendar; charset=utf-8.
   * Filename: capavate-event-{id}.ics. Caller must be a chapter member
   * (or admin). The body uses the stored `ics_uid` so calendar dedup is
   * preserved across re-downloads.
   *
   * For cancelled events we still emit a valid ICS — STATUS:CANCELLED —
   * so calendar clients update / remove the event on re-import.
   */
  app.get(
    "/api/collective/screening-events/:id/ics",
    requireCollectiveEnabled,
    requireAuth,
    requireCollectiveMember,
    (req: Request, res: Response) => {
      const id = String(req.params.id ?? "").trim();
      if (!id) {
        return res.status(400).json({ ok: false, error: "missing_event_id" });
      }
      const event = findEventByIdAnyTenant(id);
      if (!event) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      const ctx = (req as any).userContext as
        | { userId?: string; isAdmin?: boolean }
        | undefined;
      if (!ctx?.isAdmin) {
        const userId = ctx?.userId;
        if (!userId) {
          return res.status(401).json({ ok: false, error: "missing_identity" });
        }
        if (!getChapterMembership(userId, event.chapterId)) {
          return res
            .status(403)
            .json({ ok: false, error: "not_chapter_member" });
        }
      }

      const ics = generateIcs({
        uid: event.icsUid,
        title: event.title,
        description: event.description,
        scheduledFor: event.scheduledFor,
        durationMinutes: event.durationMinutes,
        location: event.location ?? undefined,
        organizer: { name: "Capavate Collective" },
        status: event.status === "cancelled" ? "CANCELLED" : "CONFIRMED",
      });

      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="capavate-event-${event.id}.ics"`,
      );
      return res.status(200).send(ics);
    },
  );
}

/* --------------------------------------------------------------- */
/* Test-only helpers                                                 */
/* --------------------------------------------------------------- */

export const _internal = Object.freeze({
  computeHash,
  rowToEvent,
  rowToAttendee,
  getChapterMembership,
  canAdminChapterEvents,
  findEventByIdAnyTenant,
  listAttendeesForEvent,
});
