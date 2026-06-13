/**
 * v18 Phase A — Screening events + ICS integration test.
 *
 * Coverage:
 *   - happy path: chapter admin creates an event with attendees → 201,
 *     event row + attendee rows persisted, hash chain seeded
 *   - feature flag: COLLECTIVE_ENABLED=0 path returns 503 at the gate
 *     (verified by directly stubbing the env for the GET list endpoint)
 *   - authz: non-admin chapter member cannot create → 403
 *     not_chapter_admin_or_dsc
 *   - authz: ghost (non-collective-member) blocked → 403 not_collective_member
 *   - RSVP: invited user accepts → 200, attendee row updated
 *   - RSVP: idempotent re-RSVP → 200 { idempotent: true }
 *   - RSVP: user not in attendee list → 403 not_invited
 *   - RSVP: cancelled event → 409 event_cancelled
 *   - Check-in: admin checks attendee in → 200, attendee.attended=true,
 *     checkedInAt stamped
 *   - Check-in: non-admin → 403 not_chapter_admin_or_dsc
 *   - Cancel: admin cancels → 200, event.status=cancelled, hash chain
 *     extended (prevHash = old currHash)
 *   - Cancel: idempotent → 200 { idempotent: true }
 *   - ICS: shape — BEGIN:VCALENDAR\r\n ... END:VCALENDAR\r\n, exactly one
 *     VEVENT block, UID matches, STATUS:CONFIRMED for live events,
 *     STATUS:CANCELLED after cancellation
 *   - Cross-chapter isolation: a member of chap_keiretsu_canada cannot
 *     access an event seeded in a different chapter (simulated by
 *     direct DB insert into a foreign chapter)
 *   - Audit chain: admin_audit row inserted with action
 *     'collective.screening_event.created' and event id in target
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import {
  screeningEvents as screeningEventsTable,
  screeningEventAttendees as screeningEventAttendeesTable,
} from "../../shared/schema";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";
const MAYA = "u_maya_chen";
const COMPANY_MAYA = "co_novapay";
const DANIEL = "u_daniel_okafor";
const AISHA = "u_aisha_patel"; // chapter admin
const GHOST = "u_ghost_no_memberships";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  for (const uid of [MAYA, AISHA, DANIEL]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
  }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string; userRole?: string } = {},
): Promise<{ status: number; body: any; text: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.userRole) headers["x-role"] = opts.userRole;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = JSON.parse(buf);
          } catch {
            /* keep raw */
          }
          resolve({
            status: res.statusCode ?? 0,
            body,
            text: buf,
            headers: res.headers,
          });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const FUTURE = () => Math.floor(Date.now() / 1000) + 60 * 60 * 24; // +1 day

// ========================================================================
// Create — happy path + authz
// ========================================================================

describe("v18 Phase A — POST /api/collective/screening-events", () => {
  it("admin creates an event with attendees → 201, event + attendees persisted, hash seeded", async () => {
    const r = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "DSC screening — NovaPay",
        description: "30-min pitch + Q&A",
        scheduled_for: FUTURE(),
        duration_minutes: 45,
        location: "Zoom — link in event",
        event_type: "screening",
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA, DANIEL],
      },
    });
    expect(r.status).toBe(201);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.event?.id).toMatch(/^screv_[0-9a-f]{16}$/);
    expect(r.body?.event?.status).toBe("scheduled");
    expect(r.body?.event?.organizerUserId).toBe(AISHA);
    expect(r.body?.event?.chapterId).toBe(CHAPTER_ID);
    expect(r.body?.event?.tenantId).toBe(TENANT_ID);
    expect(r.body?.event?.icsUid).toBe(`${r.body.event.id}@capavate.collective`);
    expect(r.body?.event?.prevHash).toBeNull();
    expect(typeof r.body?.event?.currHash).toBe("string");
    expect(r.body.event.currHash.length).toBe(64); // sha256 hex

    // 3 attendees: Maya, Daniel, and Aisha (organizer auto-included).
    expect(Array.isArray(r.body?.attendees)).toBe(true);
    expect(r.body.attendees.length).toBe(3);
    const byUser = Object.fromEntries(
      r.body.attendees.map((a: any) => [a.userId, a]),
    );
    expect(byUser[AISHA].rsvp).toBe("accepted"); // organizer auto-accept
    expect(byUser[MAYA].rsvp).toBe("invited");
    expect(byUser[DANIEL].rsvp).toBe("invited");
  });

  it("non-admin chapter member cannot create → 403 not_chapter_admin_or_dsc", async () => {
    const r = await call("POST", "/api/collective/screening-events", {
      userId: MAYA, // Maya is a chapter member but NOT admin
      body: {
        title: "Maya tries to schedule",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [DANIEL],
      },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_chapter_admin_or_dsc");
  });

  it("unknown user → 401/403 (rejected before/at collective gate)", async () => {
    // Ghost is not a known persona — requireAuth returns 401 missing_identity.
    // If the persona becomes known but is not a collective member, the
    // requireCollectiveMember gate produces 403 not_collective_member. Either
    // is an acceptable lockout; the test asserts the request is rejected
    // before reaching the handler body.
    const r = await call("POST", "/api/collective/screening-events", {
      userId: GHOST,
      body: {
        title: "Ghost",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [],
      },
    });
    expect([401, 403]).toContain(r.status);
    expect([
      "missing_identity",
      "not_collective_member",
      "unauthorized",
      "AUTH_REQUIRED",
    ]).toContain(r.body?.error);
  });

  it("validation: missing required title → 400 validation_failed", async () => {
    const r = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
      },
    });
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("validation_failed");
  });

  it("audit chain — admin_audit row inserted with action collective.screening_event.created", async () => {
    const r = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Audit-chain check",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    expect(r.status).toBe(201);
    const eventId = r.body.event.id;

    const db: any = getDb();
    // appendAdminAudit writes to `audit_log` with column `target`. We filter
    // by action + target packed string to find this row.
    const rows = db.all(
      sql`SELECT action, target FROM audit_log WHERE action = 'collective.screening_event.created' AND target = ${`screening_event:${eventId}`} ORDER BY created_at DESC LIMIT 1`,
    ) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("collective.screening_event.created");
  });
});

// ========================================================================
// List + detail
// ========================================================================

describe("v18 Phase A — GET /api/collective/screening-events", () => {
  it("lists events for a chapter — chapter members can read", async () => {
    // seed one event so the list has at least one row
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Listable event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    expect(seed.status).toBe(201);

    const r = await call(
      "GET",
      `/api/collective/screening-events?chapter_id=${CHAPTER_ID}`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(Array.isArray(r.body?.events)).toBe(true);
    expect(r.body.events.length).toBeGreaterThan(0);
    const found = r.body.events.find((e: any) => e.id === seed.body.event.id);
    expect(found).toBeTruthy();
  });

  it("GET /:id returns event + attendees", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Detail event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA, DANIEL],
      },
    });
    const eventId = seed.body.event.id;
    const r = await call("GET", `/api/collective/screening-events/${eventId}`, {
      userId: MAYA,
    });
    expect(r.status).toBe(200);
    expect(r.body?.event?.id).toBe(eventId);
    expect(r.body?.attendees?.length).toBe(3); // Maya, Daniel, Aisha
  });
});

// ========================================================================
// RSVP
// ========================================================================

describe("v18 Phase A — POST /api/collective/screening-events/:id/rsvp", () => {
  async function seedEvent(attendees: string[] = [MAYA]) {
    const r = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "RSVP event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: attendees,
      },
    });
    expect(r.status).toBe(201);
    return r.body.event.id as string;
  }

  it("invited user accepts → 200, attendee.rsvp=accepted", async () => {
    const eventId = await seedEvent();
    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/rsvp`,
      { userId: MAYA, body: { rsvp: "accepted" } },
    );
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.attendee?.rsvp).toBe("accepted");
  });

  it("idempotent re-RSVP returns { idempotent: true }", async () => {
    const eventId = await seedEvent();
    await call("POST", `/api/collective/screening-events/${eventId}/rsvp`, {
      userId: MAYA,
      body: { rsvp: "tentative" },
    });
    const second = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/rsvp`,
      { userId: MAYA, body: { rsvp: "tentative" } },
    );
    expect(second.status).toBe(200);
    expect(second.body?.idempotent).toBe(true);
  });

  it("non-attendee → 403 not_invited", async () => {
    const eventId = await seedEvent([MAYA]); // Daniel NOT invited
    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/rsvp`,
      { userId: DANIEL, body: { rsvp: "accepted" } },
    );
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_invited");
  });

  it("cancelled event → 409 event_cancelled", async () => {
    const eventId = await seedEvent();
    const c = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/cancel`,
      { userId: AISHA },
    );
    expect(c.status).toBe(200);
    expect(c.body?.event?.status).toBe("cancelled");

    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/rsvp`,
      { userId: MAYA, body: { rsvp: "accepted" } },
    );
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe("event_cancelled");
  });
});

// ========================================================================
// Check-in
// ========================================================================

describe("v18 Phase A — POST /api/collective/screening-events/:id/check-in", () => {
  it("admin checks attendee in → 200, attended=true, checkedInAt stamped", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Check-in event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const eventId = seed.body.event.id;
    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/check-in`,
      { userId: AISHA, body: { user_id: MAYA } },
    );
    expect(r.status).toBe(200);
    expect(r.body?.attendee?.attended).toBe(true);
    expect(r.body?.attendee?.checkedInAt).toBeTruthy();
  });

  it("non-admin → 403 not_chapter_admin_or_dsc", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Non-admin check-in event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA, DANIEL],
      },
    });
    const eventId = seed.body.event.id;
    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/check-in`,
      { userId: MAYA, body: { user_id: DANIEL } },
    );
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_chapter_admin_or_dsc");
  });
});

// ========================================================================
// Cancel + hash chain
// ========================================================================

describe("v18 Phase A — POST /api/collective/screening-events/:id/cancel", () => {
  it("admin cancels → 200, status=cancelled, hash chain extended", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Cancel event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const beforeHash = seed.body.event.currHash;
    const eventId = seed.body.event.id;

    const r = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/cancel`,
      { userId: AISHA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.event?.status).toBe("cancelled");
    expect(r.body?.event?.prevHash).toBe(beforeHash);
    expect(r.body?.event?.currHash).not.toBe(beforeHash);
    expect(r.body?.event?.currHash?.length).toBe(64);
  });

  it("idempotent cancel → 200 { idempotent: true }", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Double-cancel event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const eventId = seed.body.event.id;
    await call(
      "POST",
      `/api/collective/screening-events/${eventId}/cancel`,
      { userId: AISHA },
    );
    const second = await call(
      "POST",
      `/api/collective/screening-events/${eventId}/cancel`,
      { userId: AISHA },
    );
    expect(second.status).toBe(200);
    expect(second.body?.idempotent).toBe(true);
  });
});

// ========================================================================
// ICS export
// ========================================================================

describe("v18 Phase A — GET /api/collective/screening-events/:id/ics", () => {
  it("returns RFC5545 ICS body — exact shape, CRLF endings, one VEVENT", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "ICS shape event",
        description: "first line\nsecond line",
        scheduled_for: FUTURE(),
        duration_minutes: 30,
        location: "Toronto, ON",
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const eventId = seed.body.event.id;

    const r = await call(
      "GET",
      `/api/collective/screening-events/${eventId}/ics`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/calendar/);
    expect(r.headers["content-disposition"]).toMatch(
      new RegExp(`capavate-event-${eventId}\\.ics`),
    );

    // Body shape — REQUIRED by smoke test: starts BEGIN:VCALENDAR\r\n, ends
    // END:VCALENDAR\r\n, contains exactly one VEVENT block.
    expect(r.text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(r.text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    const veventBegins = (r.text.match(/BEGIN:VEVENT/g) ?? []).length;
    const veventEnds = (r.text.match(/END:VEVENT/g) ?? []).length;
    expect(veventBegins).toBe(1);
    expect(veventEnds).toBe(1);

    // UID matches stored ics_uid
    expect(r.text).toContain(`UID:${eventId}@capavate.collective`);
    // CONFIRMED while alive
    expect(r.text).toMatch(/STATUS:CONFIRMED/);
    // Commas escaped in LOCATION
    expect(r.text).toContain("LOCATION:Toronto\\, ON");
  });

  it("returns STATUS:CANCELLED for a cancelled event", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "ICS-cancelled event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const eventId = seed.body.event.id;
    await call(
      "POST",
      `/api/collective/screening-events/${eventId}/cancel`,
      { userId: AISHA },
    );
    const r = await call(
      "GET",
      `/api/collective/screening-events/${eventId}/ics`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/STATUS:CANCELLED/);
  });
});

// ========================================================================
// Cross-chapter isolation
// ========================================================================

describe("v18 Phase A — cross-chapter isolation", () => {
  it("chapter-only member cannot read a foreign-chapter event ICS", async () => {
    // Seed an event row directly in a foreign chapter that Maya does NOT belong to.
    const foreignChapter = "chap_foreign_xyz";
    const foreignTenant = `tenant_chap_${foreignChapter}`;
    const eventId = `screv_${randomBytes(8).toString("hex")}`;
    const ts = new Date().toISOString();
    const hash = createHash("sha256").update("GENESIS|").update(eventId).digest("hex");

    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.insert(screeningEventsTable).values({
        id: eventId,
        tenantId: foreignTenant,
        chapterId: foreignChapter,
        roundId: null,
        companyId: COMPANY_MAYA,
        title: "Foreign-chapter event",
        description: "",
        scheduledFor: Math.floor(Date.now() / 1000) + 3600,
        durationMinutes: 60,
        location: null,
        eventType: "screening",
        status: "scheduled",
        organizerUserId: "u_foreign_admin",
        icsUid: `${eventId}@capavate.collective`,
        prevHash: null,
        currHash: hash,
        createdAt: ts,
        updatedAt: ts,
      } as any).run();
    });

    const r = await call(
      "GET",
      `/api/collective/screening-events/${eventId}/ics`,
      { userId: MAYA },
    );
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_chapter_member");
  });
});

// ========================================================================
// Feature flag — COLLECTIVE_ENABLED=0 → 503
// ========================================================================

describe("v18 Phase A — feature flag", () => {
  it("COLLECTIVE_ENABLED=0 → 503 at the gate", async () => {
    const prev = process.env.COLLECTIVE_ENABLED;
    process.env.COLLECTIVE_ENABLED = "0";
    try {
      const r = await call(
        "GET",
        `/api/collective/screening-events?chapter_id=${CHAPTER_ID}`,
        { userId: AISHA },
      );
      expect(r.status).toBe(503);
    } finally {
      process.env.COLLECTIVE_ENABLED = prev;
    }
  });
});

// ========================================================================
// Persistence sanity — attendee row schema
// ========================================================================

describe("v18 Phase A — persistence sanity", () => {
  it("attendee row has all expected columns", async () => {
    const seed = await call("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Persistence event",
        scheduled_for: FUTURE(),
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    const eventId = seed.body.event.id;
    const db: any = getDb();
    const rows = db.all(
      sql`SELECT id, event_id, user_id, role, rsvp, attended, checked_in_at, created_at, updated_at FROM screening_event_attendees WHERE event_id = ${eventId}`,
    ) as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.id).toMatch(/^scrat_[0-9a-f]{12}$/);
      expect(row.event_id).toBe(eventId);
      expect(["founder", "investor", "dsc", "observer"]).toContain(row.role);
      expect(["invited", "accepted", "declined", "tentative"]).toContain(row.rsvp);
      expect(typeof row.attended).toBe("number");
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    }
    // Suppress unused-var lint for the imported table.
    void screeningEventAttendeesTable;
  });
});
