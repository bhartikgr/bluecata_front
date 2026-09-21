/**
 * Independent GPT Sol post-build review, 2026-09-19.
 *
 * Isolated test DB only (root vitest config pins NODE_ENV=test => :memory:).
 * This file deliberately exercises public production boundaries rather than
 * importing private implementation hooks.
 */
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  NOTIFICATIONS_PERSIST_STORE,
  readOwnedNotificationsStrict,
  registerPersonaNotificationRoutes,
  resolveStreamPollMs,
  scopedListing,
  STREAM_POLL_DEFAULT_MS,
  STREAM_POLL_MAX_MS,
  STREAM_POLL_MIN_MS,
} from "../notificationPersonaRoutes";
import {
  hydrateEntriesStrict,
  mutateEntriesStrict,
  persistEntry,
} from "../lib/storePersistenceShim";
import { rawDb } from "../db/connection";
import {
  emitNotification,
  registerNotificationsRoutes,
} from "../notificationsStore";
import {
  revokeSession,
  _resetRevocation,
} from "../lib/sessionRevocation";
import {
  _commsTest,
  publishDueScheduledPosts,
} from "../commsStore";
import {
  classifyNotificationDestination,
  notificationMatchesSurface,
} from "../../shared/notificationDestination";

const OWNER = "u_avi_managing";
const FOREIGN = "u_admin";
const TABLE = "kv_notificationsStore";

function row(
  id: string,
  userId: string,
  link: string | undefined,
  extra: Partial<{
    kind: string;
    title: string;
    body: string;
    read: boolean;
    archived: boolean;
    createdAt: string;
  }> = {},
) {
  return {
    id,
    userId,
    kind: extra.kind ?? "partner.promotion_approved",
    title: extra.title ?? `title ${id}`,
    body: extra.body ?? `body ${id}`,
    ...(link === undefined ? {} : { link }),
    read: extra.read ?? false,
    archived: extra.archived ?? false,
    createdAt: extra.createdAt ?? "2026-09-19T12:00:00.000Z",
    channels: { inApp: true, email: false, push: false },
  };
}

function put(v: ReturnType<typeof row>): void {
  expect(persistEntry(NOTIFICATIONS_PERSIST_STORE, v.id, v)).toBe(true);
}

function app(withFrozenAfter = false) {
  const a = express();
  a.use(express.json());
  registerPersonaNotificationRoutes(a);
  if (withFrozenAfter) registerNotificationsRoutes(a);
  return a;
}

beforeEach(() => {
  // The connection is an in-memory test DB. Delete only this generic test store.
  rawDb().exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id TEXT PRIMARY KEY NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`);
  rawDb().prepare(`DELETE FROM ${TABLE}`).run();
});

describe("independent persona notification review", () => {
  it("repairs only the exact historical alias and refuses protocol/traversal/encoded-path escapes", () => {
    expect(classifyNotificationDestination("/partner/pipeline?tab=x#now", "partner.promotion_approved"))
      .toEqual({
        class: "surface",
        surface: "partner",
        href: "/collective/partner/pipeline?tab=x#now",
        repairedLegacy: true,
      });
    const refused = [
      "https://evil.example/x",
      "//evil.example/x",
      "/collective/partner/%2e./admin",
      "/collective/partner/.%2E/admin",
      "/collective/partner/%2fadmin",
      "/collective/partner/%5cadmin",
      "/collective/partner\\admin",
      "/collective/partner/%2E%2e/admin",
    ];
    for (const link of refused) {
      expect(classifyNotificationDestination(link, "partner.promotion_approved"))
        .toEqual({ class: "unclassified", reason: "unsafe" });
    }
    expect(classifyNotificationDestination("/partner/other", "partner.promotion_approved"))
      .toEqual({ class: "unclassified", reason: "unknown_path" });
  });

  it("keeps unknown and no-link history account-wide without kind-prefix persona guessing", () => {
    put(row("unknown", OWNER, "/posts/p1", { kind: "partner.referral_received" }));
    put(row("missing", OWNER, undefined, { kind: "partner.referral_received" }));
    put(row("founderReferral", OWNER, "/founder/dashboard", { kind: "partner.referral_received" }));
    expect(scopedListing(OWNER, "partner", {}).items).toHaveLength(0);
    expect(scopedListing(OWNER, "founder", {}).items.map((x) => x.id)).toEqual(["founderReferral"]);
    const account = scopedListing(OWNER, "account", {});
    expect(account.total).toBe(3);
    expect(account.unclassified).toBe(2);
  });

  it("classifies the protected document only under the exact audited kind contract", () => {
    const href = `/api/public/data-room/files/f_1?grant=${"a".repeat(64)}`;
    const good = classifyNotificationDestination(href, "dataroom.access_granted");
    expect(good).toEqual({ class: "document", href, surface: "investor" });
    expect(notificationMatchesSurface({ link: href, kind: "dataroom.access_granted" }, "investor")).toBe(true);
    expect(notificationMatchesSurface({ link: href, kind: "partner.promotion_approved" }, "investor")).toBe(false);
  });

  it("lists/counts one owner and one surface from the same rows", () => {
    put(row("p1", OWNER, "/partner/pipeline")); // historical alias
    put(row("p2", OWNER, "/collective/partner/pipeline", { read: true }));
    put(row("f1", OWNER, "/founder/dashboard"));
    put(row("foreign", FOREIGN, "/collective/partner/pipeline"));
    const got = scopedListing(OWNER, "partner", {});
    expect(got.items.map((x) => x.id).sort()).toEqual(["p1", "p2"]);
    expect(got.total).toBe(2);
    expect(got.unread).toBe(1);
    expect(got.outsideWorkspace).toBe(1);
  });

  it("PATCH ignores supplied userId and changes only session-owner rows in the requested surface", async () => {
    put(row("ownPartner", OWNER, "/collective/partner/pipeline"));
    put(row("ownFounder", OWNER, "/founder/dashboard"));
    put(row("foreignPartner", FOREIGN, "/collective/partner/pipeline"));
    const res = await request(app())
      .patch("/api/notifications")
      .set("x-user-id", OWNER)
      .send({
        ids: ["ownPartner", "ownFounder", "foreignPartner"],
        surface: "partner",
        read: true,
        userId: FOREIGN,
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: 1 });
    const all = new Map(hydrateEntriesStrict<any>(NOTIFICATIONS_PERSIST_STORE));
    expect(all.get("ownPartner").read).toBe(true);
    expect(all.get("ownFounder").read).toBe(false);
    expect(all.get("foreignPartner").read).toBe(false);
  });

  it("persona read-all excludes archived and other-surface rows", async () => {
    put(row("visible", OWNER, "/collective/partner/pipeline"));
    put(row("archived", OWNER, "/collective/partner/pipeline", { archived: true }));
    put(row("founder", OWNER, "/founder/dashboard"));
    const res = await request(app())
      .post("/api/notifications/read-all")
      .set("x-user-id", OWNER)
      .send({ surface: "partner" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, marked: 1, surface: "partner" });
    const all = new Map(hydrateEntriesStrict<any>(NOTIFICATIONS_PERSIST_STORE));
    expect(all.get("visible").read).toBe(true);
    expect(all.get("archived").read).toBe(false);
    expect(all.get("founder").read).toBe(false);
  });

  it("strict generic mutation rolls back earlier writes when a later mutator throws", () => {
    put(row("first", OWNER, "/collective/partner/pipeline"));
    put(row("second", OWNER, "/collective/partner/pipeline"));
    expect(() => mutateEntriesStrict<any>(
      NOTIFICATIONS_PERSIST_STORE,
      ["first", "second"],
      (cur, id) => {
        if (id === "second") throw new Error("deliberate");
        return { ...cur, read: true };
      },
    )).toThrow(/STRICT_MUTATE_FAILED/);
    const all = new Map(hydrateEntriesStrict<any>(NOTIFICATIONS_PERSIST_STORE));
    expect(all.get("first").read).toBe(false);
    expect(all.get("second").read).toBe(false);
  });

  it("route mutation rolls back if a later owned durable key/payload id mismatch is encountered", async () => {
    put(row("first", OWNER, "/collective/partner/pipeline"));
    const mismatch = row("payload-id", OWNER, "/collective/partner/pipeline");
    rawDb().prepare(
      `INSERT INTO ${TABLE} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`,
    ).run("durable-id", JSON.stringify(mismatch), new Date().toISOString());
    const res = await request(app())
      .patch("/api/notifications")
      .set("x-user-id", OWNER)
      .send({ ids: ["first", "durable-id"], surface: "partner", read: true });
    expect(res.status).toBe(503);
    const first = rawDb().prepare(`SELECT payload_json FROM ${TABLE} WHERE id = ?`).get("first") as any;
    expect(JSON.parse(first.payload_json).read).toBe(false);
  });

  it("malformed JSON and payload-id mismatch fail the whole list, not a false empty inbox", async () => {
    rawDb().prepare(
      `INSERT INTO ${TABLE} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`,
    ).run("broken", "{", new Date().toISOString());
    let res = await request(app()).get("/api/notifications?surface=partner").set("x-user-id", OWNER);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("NOTIFICATIONS_UNAVAILABLE");

    rawDb().prepare(`DELETE FROM ${TABLE}`).run();
    const mismatch = row("payload", OWNER, "/collective/partner/pipeline");
    rawDb().prepare(
      `INSERT INTO ${TABLE} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`,
    ).run("key", JSON.stringify(mismatch), new Date().toISOString());
    res = await request(app()).get("/api/notifications?surface=partner").set("x-user-id", OWNER);
    expect(res.status).toBe(503);
  });

  it("preserves legacy account-wide list shape/default and facade precedence", async () => {
    put(row("partner", OWNER, "/collective/partner/pipeline"));
    put(row("founder", OWNER, "/founder/dashboard"));
    const res = await request(app(true))
      .get(`/api/notifications?userId=${encodeURIComponent(FOREIGN)}`)
      .set("x-user-id", OWNER);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(OWNER);
    expect(res.body.surface).toBe("account"); // proves the first-registered facade answered
    expect(res.body.total).toBe(2);
    expect(res.body.unread).toBe(2);
    expect(Array.isArray(res.body.items)).toBe(true);
    for (const key of ["userId", "total", "unread", "items"]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  it("requires auth and rejects unknown surface values", async () => {
    const a = app();
    // Disable the dev demo fallback, otherwise an anonymous test request becomes a demo persona.
    const prior = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const anon = await request(a).get("/api/notifications?surface=partner");
      expect(anon.status).toBe(401);
    } finally {
      if (prior === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prior;
    }
    const invalid = await request(a)
      .get("/api/notifications?surface=not-a-workspace")
      .set("x-user-id", OWNER);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("INVALID_SURFACE");
  });

  it("bounds stream polling configuration and uses the safe default", () => {
    expect(resolveStreamPollMs(undefined)).toBe(STREAM_POLL_DEFAULT_MS);
    expect(resolveStreamPollMs("")).toBe(STREAM_POLL_DEFAULT_MS);
    expect(resolveStreamPollMs("nonsense")).toBe(STREAM_POLL_DEFAULT_MS);
    expect(resolveStreamPollMs("-1")).toBe(STREAM_POLL_MIN_MS);
    expect(resolveStreamPollMs("1")).toBe(STREAM_POLL_MIN_MS);
    expect(resolveStreamPollMs("7000.9")).toBe(7000);
    expect(resolveStreamPollMs("999999")).toBe(STREAM_POLL_MAX_MS);
  });

  it("SSE rechecks the session on poll and clears both timers when the session is revoked", () => {
    put(row("streamed", OWNER, "/collective/partner/pipeline"));
    const a: any = app();
    const layers = (a._router?.stack ?? a.router?.stack ?? []) as any[];
    const route = layers.find((x) => x.route?.path === "/api/notifications/stream" && x.route?.methods?.get);
    expect(route).toBeDefined();
    const handler = route.route.stack[route.route.stack.length - 1].handle as Function;

    const req: any = new EventEmitter();
    req.query = { surface: "partner" };
    req.headers = { "x-user-id": OWNER };
    req.cookies = {};
    req.userContext = { userId: OWNER };

    const res: any = new EventEmitter();
    const writes: string[] = [];
    let ends = 0;
    res.setHeader = vi.fn();
    res.flushHeaders = vi.fn();
    res.write = (s: string) => { writes.push(s); return true; };
    res.end = () => { ends += 1; };

    _resetRevocation();
    vi.useFakeTimers();
    try {
      handler(req, res);
      expect(vi.getTimerCount()).toBe(2);
      expect(writes.join("")).toContain("event: hello");
      revokeSession(OWNER);
      vi.advanceTimersByTime(STREAM_POLL_DEFAULT_MS);
      expect(writes.join("")).toContain('event: bye\ndata: {"reason":"session"}');
      expect(ends).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
      // A late close event is idempotent and cannot end twice.
      req.emit("close");
      expect(ends).toBe(1);
    } finally {
      _resetRevocation();
      vi.useRealTimers();
    }
  });

  it("a genuine frozen emitter write is immediately visible to the durable reader", () => {
    const emitted = emitNotification({
      userId: OWNER,
      kind: "partner.promotion_approved",
      title: "Approved",
      body: "Done",
      link: "/collective/partner/pipeline",
    });
    const durable = readOwnedNotificationsStrict(OWNER).find((n) => n.id === emitted.id);
    expect(durable).toBeDefined();
    expect(durable?.link).toBe("/collective/partner/pipeline");
    expect(scopedListing(OWNER, "partner", {}).items.some((n) => n.id === emitted.id)).toBe(true);
  });

  it("publishes a due scheduled post into the channel-defined recipient persona", () => {
    const suffix = `sol_${Date.now()}`;
    const channelId = `ch_${suffix}`;
    const postId = `post_${suffix}`;
    const due = "2026-09-19T12:00:00.000Z";
    _commsTest.channels.set(channelId, {
      id: channelId,
      // A company-anchored channel gives objective audience context: OWNER is
      // not this company's founder, so this recipient is an investor here.
      // This deliberately does not reintroduce global partner-role priority.
      kind: "cap_table",
      companyId: "co_sol_scheduled_review",
      participantUserIds: [FOREIGN, OWNER],
      createdAt: due,
      metadata: {},
    });
    _commsTest.posts.set(postId, {
      id: postId,
      channelId,
      authorUserId: FOREIGN,
      authorKind: "user",
      body: "Scheduled persona-link review",
      createdAt: due,
      visibility: "public_to_collective",
      likedByUserIds: [],
      commentCount: 0,
      comments: [],
      shareCount: 0,
      scheduledFor: due,
      status: "scheduled",
    });
    try {
      expect(publishDueScheduledPosts(new Date("2026-09-19T12:01:00.000Z")).published)
        .toContain(postId);
      const emitted = readOwnedNotificationsStrict(OWNER)
        .filter((n) => n.body === "Scheduled persona-link review")
        .find((n) => n.link?.endsWith(postId));
      expect(emitted).toBeDefined();
      expect(emitted?.link).toBe(`/investor/posts/${postId}`);
      expect(scopedListing(OWNER, "investor", {}).items.map((n) => n.id))
        .toContain(emitted?.id);
    } finally {
      _commsTest.posts.delete(postId);
      _commsTest.channels.delete(channelId);
    }
  });
});
