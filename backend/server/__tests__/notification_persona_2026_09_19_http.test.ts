/* ════════════════════════════════════════════════════════════════════════════
   2026-09-19 · SLIDE 13a — PERSONA NOTIFICATION FACADE, MEASURED OVER REAL HTTP.
   ════════════════════════════════════════════════════════════════════════════
   REAL Express, REAL routes (facade registered BEFORE the frozen handlers,
   exactly as server/routes.ts does), REAL sqlite (NODE_ENV=test → :memory:).
   Rows are produced through the FROZEN `emitNotification` (the only production
   producer path) and read back STRAIGHT OUT OF `kv_notificationsStore` with
   `rawDb()` so no reader can answer from RAM.

   What is proven here:
     · route-stack order — every facade route precedes its frozen twin;
     · session owner only — anonymous 401; a foreign `?userId=` / body `userId`
       is noise, the session header decides;
     · scope filters PRESENTATION: per-surface list/count/read/archive over a
       mixed fixture (partner legacy alias row, collective, founder, investor,
       admin, protected document, unknown path, unsafe URL, no link);
     · persona read-all leaves ARCHIVED rows untouched; account read-all keeps
       the legacy "every unread row" semantics;
     · strict durable reads: corrupt JSON, owner-fields-missing, id≠key and an
       owned row violating the contract all fail VISIBLY (503), never as an
       empty inbox; a VALID foreign row is ignored;
     · atomic mutation: a failing row rolls back the whole PATCH, nothing saved;
     · an independent reader (a second facade over the SAME db) sees the
       emitter's row and the later read/archive without any RAM hand-off;
     · the legacy stored link is preserved in storage (repair is presentational);
     · stream: hello frame scoped, poll clamp, session cleanup.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { registerPersonaNotificationRoutes, PERSONA_FACADE_ROUTES, resolveStreamPollMs, STREAM_POLL_MIN_MS, STREAM_POLL_MAX_MS, STREAM_POLL_DEFAULT_MS, readOwnedNotificationsStrict, scopedListing } from "../notificationPersonaRoutes";
import { registerNotificationsRoutes, emitNotification } from "../notificationsStore";
import { rawDb, getDb } from "../db/connection";
import { LEGACY_LINK_ALIASES } from "../../shared/notificationDestination";

const TABLE = "kv_notificationsStore";
/* Static demo personas (server/lib/userContext.ts PERSONAS) — real identities
   under the Vitest-only x-user-id header. */
const ME = "u_avi_managing";       // consortium partner persona
const OTHER = "u_maya_chen";       // a different real persona
const GRANT = "b".repeat(64);
const DOC_LINK = `/api/public/data-room/files/file_w13a?grant=${GRANT}`;

let app: express.Express;

const as = (u: string | null) => (r: request.Test) => (u ? r.set("x-user-id", u) : r);

const rowsFor = (userId: string): Array<{ id: string; payload: any }> =>
  (rawDb().prepare(`SELECT id, payload_json FROM ${TABLE} WHERE deleted_at IS NULL`).all() as Array<{ id: string; payload_json: string }>)
    .map((r) => ({ id: r.id, payload: JSON.parse(r.payload_json) }))
    .filter((r) => r.payload.userId === userId);

const stored = (id: string): any => {
  const r = rawDb().prepare(`SELECT payload_json FROM ${TABLE} WHERE id = ?`).get(id) as { payload_json: string } | undefined;
  return r ? JSON.parse(r.payload_json) : undefined;
};

const wipe = (): void => {
  rawDb().exec(`DELETE FROM ${TABLE}`);
};

const insertRaw = (id: string, payloadJson: string): void => {
  rawDb().prepare(`INSERT INTO ${TABLE} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`).run(id, payloadJson, new Date().toISOString());
};

type Fixture = Record<string, string>; // name -> id
let F: Fixture = {};

/** Mixed fixture, emitted through the FROZEN producer path. */
const seedMixed = (): Fixture => {
  const ids: Fixture = {};
  const mk = (name: string, args: Parameters<typeof emitNotification>[0]) => {
    const n = emitNotification(args);
    ids[name] = n.id;
  };
  mk("legacyPartner", { userId: ME, kind: "partner.promotion_approved" as any, title: "Promotion approved", body: "b", link: "/partner/pipeline" });
  mk("partner", { userId: ME, kind: "partner.x" as any, title: "Partner row", body: "b", link: "/collective/partner/spvs/s1" });
  mk("collective", { userId: ME, kind: "collective.x" as any, title: "Collective row", body: "b", link: "/collective/companies/d1" });
  mk("founder", { userId: ME, kind: "round.x" as any, title: "Founder row", body: "b", link: "/founder/rounds/r1" });
  mk("investor", { userId: ME, kind: "invite.x" as any, title: "Investor row", body: "b", link: "/investor/invitations/i1" });
  mk("admin", { userId: ME, kind: "admin.x" as any, title: "Admin row", body: "b", link: "/admin/users" });
  mk("document", { userId: ME, kind: "dataroom.access_granted" as any, title: "Data room", body: "b", link: DOC_LINK });
  mk("unknown", { userId: ME, kind: "post.x" as any, title: "Unknown path", body: "b", link: "/posts/p1" });
  // shell-PREFIXED but UNMOUNTED (parent browser control: bare 404 without partner nav) → account-only
  mk("unmountedPartner", { userId: ME, kind: "partner.x" as any, title: "Unmounted partner path", body: "b", link: "/collective/partner/qa-unregistered-target" });
  mk("unsafe", { userId: ME, kind: "x" as any, title: "Unsafe", body: "b", link: "https://evil.example/collective/partner/pipeline" });
  mk("nolink", { userId: ME, kind: "system.x" as any, title: "No link", body: "b" });
  mk("foreignPartner", { userId: OTHER, kind: "partner.x" as any, title: "Not mine", body: "b", link: "/collective/partner/pipeline" });
  return ids;
};

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  registerPersonaNotificationRoutes(app); // facade first — as in server/routes.ts
  registerNotificationsRoutes(app);       // frozen twins second
  // ensure table exists (the frozen emitter creates it lazily on first persist)
  emitNotification({ userId: "u_bootstrap", kind: "x" as any, title: "t", body: "b" });
  wipe();
});

beforeEach(() => {
  wipe();
  F = seedMixed();
});

/* ───────────────────────────── route-stack order ───────────────────────── */

describe("route-stack order — the facade precedes every frozen twin", () => {
  it("for each of the 4 (method, path) pairs the FIRST matching layer is the facade", () => {
    const stack: any[] = ((app as any).router ?? (app as any)._router).stack;
    for (const { method, path } of PERSONA_FACADE_ROUTES) {
      const layers = stack.filter((l) => l.route && l.route.path === path && l.route.methods[method]);
      expect(layers.length, `${method} ${path}`).toBeGreaterThanOrEqual(2);
      const first = layers[0].route.stack.map((s: any) => s.name);
      // the facade mounts `requireAuth` as its first handler; the frozen twin is a bare handler
      expect(first[0], `${method} ${path} first layer`).toBe("requireAuth");
      const second = layers[1].route.stack.map((s: any) => s.name);
      expect(second[0], `${method} ${path} second layer is the frozen handler`).not.toBe("requireAuth");
    }
  });
  it("registering the facade a second time on a fresh app is the same 4 routes (no extras)", () => {
    const a2 = express();
    registerPersonaNotificationRoutes(a2);
    const routes = ((a2 as any).router ?? (a2 as any)._router).stack.filter((l: any) => l.route).map((l: any) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(routes.sort()).toEqual(PERSONA_FACADE_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });
});

/* ───────────────────────────── session owner only ──────────────────────── */

describe("session owner only", () => {
  it("anonymous → 401 on every facade route (dev bypass disabled = production identity rules)", async () => {
    /* Under Vitest the sandbox falls back to a demo persona for anonymous
       requests (userContext.resolvePersonaIdWithFallback). Production has no
       such fallback; DISABLE_DEV_BYPASS=1 reproduces that rule here. */
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      expect((await request(app).get("/api/notifications")).status).toBe(401);
      expect((await request(app).patch("/api/notifications").send({ ids: [F.partner], read: true })).status).toBe(401);
      expect((await request(app).post("/api/notifications/read-all").send({})).status).toBe(401);
      expect((await request(app).get("/api/notifications/stream")).status).toBe(401);
      // and the header/query identities are ALSO dead under that rule (no spoof surface)
      expect((await request(app).get(`/api/notifications?userId=${ME}`)).status).toBe(401);
      expect((await as(ME)(request(app).get("/api/notifications"))).status).toBe(401);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
    expect(stored(F.partner).read).toBe(false);
  });
  it("a spoofed `?userId=` in the query is ignored when the session header is present", async () => {
    const r = await as(ME)(request(app).get(`/api/notifications?userId=${OTHER}&surface=partner`));
    expect(r.status).toBe(200);
    expect(r.body.userId).toBe(ME);
    expect(r.body.items.every((n: any) => n.userId === ME)).toBe(true);
    expect(r.body.items.map((n: any) => n.id)).not.toContain(F.foreignPartner);
  });
  it("body `userId` is accepted as noise on PATCH (legacy cached client) and never used", async () => {
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.foreignPartner, F.partner], read: true, userId: OTHER });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(1); // only my row
    expect(stored(F.partner).read).toBe(true);
    expect(stored(F.foreignPartner).read).toBe(false);
  });
  it("legacy PATCH body WITHOUT surface still works (account scope)", async () => {
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.founder], archived: true });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(1);
    expect(stored(F.founder).archived).toBe(true);
  });
  it("legacy read-all body `{ userId }` (old client) still works and marks only MY unread rows", async () => {
    const r = await as(ME)(request(app).post("/api/notifications/read-all")).send({ userId: OTHER });
    expect(r.status).toBe(200);
    expect(r.body.surface).toBe("account");
    expect(r.body.marked).toBe(11);
    expect(rowsFor(ME).every((x) => x.payload.read === true)).toBe(true);
    expect(stored(F.foreignPartner).read).toBe(false);
  });
  it("unknown fields / empty ids / bad surface are 400, never applied", async () => {
    expect((await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner], read: true, nope: 1 })).status).toBe(400);
    expect((await as(ME)(request(app).patch("/api/notifications")).send({ ids: [], read: true })).status).toBe(400);
    expect((await as(ME)(request(app).patch("/api/notifications")).send({ read: true })).status).toBe(400);
    expect((await as(ME)(request(app).get("/api/notifications?surface=member"))).status).toBe(400);
    expect((await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "nope" })).status).toBe(400);
    expect(stored(F.partner).read).toBe(false);
  });
});

/* ─────────────────────────── scope = presentation ──────────────────────── */

describe("persona scoping — list, count, destination", () => {
  const list = async (surface?: string, q = "") => {
    const r = await as(ME)(request(app).get(`/api/notifications?${surface ? `surface=${surface}&` : ""}${q}`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { total: number; unread: number; unclassified: number; outsideWorkspace: number; items: any[]; surface: string };
  };
  const names = (items: any[]) => Object.entries(F).filter(([, id]) => items.some((n) => n.id === id)).map(([k]) => k).sort();

  it("partner surface: legacy alias row + partner row, counts equal the listed set, repaired href", async () => {
    const b = await list("partner");
    expect(names(b.items)).toEqual(["legacyPartner", "partner"]);
    expect(b.total).toBe(2);
    expect(b.unread).toBe(2);
    const legacy = b.items.find((n) => n.id === F.legacyPartner);
    expect(legacy.link).toBe("/partner/pipeline"); // stored value untouched
    expect(legacy.destination).toEqual({ class: "surface", surface: "partner", href: "/collective/partner/pipeline", repairedLegacy: true });
    expect(b.outsideWorkspace).toBe(9); // 11 owned un-archived rows − 2 in scope (the unmounted partner-prefixed row is OUTSIDE the partner workspace)
    expect(b.unclassified).toBe(4);     // unknown, unsafe, nolink, unmountedPartner
  });
  it("collective surface excludes partner rows (partner prefix wins)", async () => {
    const b = await list("collective");
    expect(names(b.items)).toEqual(["collective"]);
    expect(b.unread).toBe(1);
  });
  it("founder / admin surfaces", async () => {
    expect(names((await list("founder")).items)).toEqual(["founder"]);
    expect(names((await list("admin")).items)).toEqual(["admin"]);
  });
  it("investor surface carries the audited protected-document row and its no-link contract", async () => {
    const b = await list("investor");
    expect(names(b.items)).toEqual(["document", "investor"]);
    expect(b.unread).toBe(2);
    const doc = b.items.find((n) => n.id === F.document);
    expect(doc.destination).toEqual({ class: "document", href: DOC_LINK, surface: "investor" });
  });
  it("account (default) lists EVERY owned row including unknown/unsafe/no-link, never foreign", async () => {
    const b = await list();
    expect(b.surface).toBe("account");
    expect(names(b.items)).toEqual(Object.keys(F).filter((k) => k !== "foreignPartner").sort());
    expect(b.total).toBe(11);
    expect(b.unread).toBe(11);
    expect(b.outsideWorkspace).toBe(0);
    // shell-prefixed but unmounted: retained here, unknown_path, and NOT in the partner list (asserted above)
    expect(b.items.find((n) => n.id === F.unmountedPartner).destination).toEqual({ class: "unclassified", reason: "unknown_path" });
    expect(b.items.find((n) => n.id === F.unmountedPartner).link).toBe("/collective/partner/qa-unregistered-target");
    const unsafe = b.items.find((n) => n.id === F.unsafe);
    expect(unsafe.destination).toEqual({ class: "unclassified", reason: "unsafe" });
    expect(unsafe.link).toBe("https://evil.example/collective/partner/pipeline"); // retained, not rewritten, not navigable
    expect(b.items.find((n) => n.id === F.nolink).destination).toEqual({ class: "unclassified", reason: "missing" });
    expect(b.items.find((n) => n.id === F.unknown).destination).toEqual({ class: "unclassified", reason: "unknown_path" });
  });
  it("unread/archived filters compose with the surface", async () => {
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner], read: true, surface: "partner" });
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.legacyPartner], archived: true, surface: "partner" });
    const all = await list("partner");
    expect(names(all.items)).toEqual(["partner"]);   // archived hidden by default
    expect(all.unread).toBe(0);
    const unread = await list("partner", "unreadOnly=true");
    expect(unread.items).toHaveLength(0);
    const archived = await list("partner", "archived=true");
    expect(names(archived.items)).toEqual(["legacyPartner"]);
    expect(archived.total).toBe(1);
  });
  it("frozen GET (second layer) is no longer what the client reaches, but the facade returns the frozen fields too", async () => {
    const b = await list();
    for (const k of ["userId", "total", "unread", "items"]) expect(b).toHaveProperty(k);
    for (const k of ["id", "userId", "kind", "title", "body", "read", "archived", "createdAt"]) expect(b.items[0]).toHaveProperty(k);
  });
});

/* ─────────────────────────── scoped mutations ──────────────────────────── */

describe("scoped PATCH / read-all — durable, atomic, no unseen archive change", () => {
  it("PATCH with a surface only touches rows IN that surface (others silently skipped, not counted)", async () => {
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner, F.founder, F.unknown], read: true, surface: "partner" });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(1);
    expect(stored(F.partner).read).toBe(true);
    expect(stored(F.founder).read).toBe(false);
    expect(stored(F.unknown).read).toBe(false);
  });
  it("persona read-all marks only VISIBLE (un-archived) unread rows of that surface", async () => {
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.legacyPartner], archived: true });
    const r = await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "partner" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, marked: 1, surface: "partner" });
    expect(stored(F.partner).read).toBe(true);
    expect(stored(F.legacyPartner).read).toBe(false);   // archived → untouched
    expect(stored(F.legacyPartner).archived).toBe(true);
    expect(stored(F.founder).read).toBe(false);          // other surface → untouched
    expect(stored(F.unknown).read).toBe(false);
    expect(stored(F.foreignPartner).read).toBe(false);
  });
  it("account read-all keeps legacy semantics (every unread owned row, archived included)", async () => {
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.legacyPartner], archived: true });
    const r = await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "account" });
    expect(r.body.marked).toBe(11);
    expect(stored(F.legacyPartner).read).toBe(true);
    expect(stored(F.foreignPartner).read).toBe(false);
  });
  it("read-all on an already-read surface reports 0 (no silent zero on FAILURE — see 503 tests)", async () => {
    await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "admin" });
    const r = await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "admin" });
    expect(r.status).toBe(200);
    expect(r.body.marked).toBe(0);
  });
  it("a second PATCH with no change writes nothing (updated=0) and the row is unchanged", async () => {
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.admin], read: true });
    const before = rawDb().prepare(`SELECT updated_at FROM ${TABLE} WHERE id = ?`).get(F.admin);
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.admin], read: true });
    expect(r.body.updated).toBe(0);
    expect(rawDb().prepare(`SELECT updated_at FROM ${TABLE} WHERE id = ?`).get(F.admin)).toEqual(before);
  });
  it("unknown ids are skipped, never disclosed", async () => {
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: ["ntf_doesnotexist"], read: true });
    expect(r.status).toBe(200);
    expect(r.body.updated).toBe(0);
  });
});

/* ───────────────────── strict durable reads: fail visibly ──────────────── */

describe("strict durable reads — malformed records fail VISIBLY (503), never as an empty inbox", () => {
  const expect503 = async (why: string) => {
    const g = await as(ME)(request(app).get("/api/notifications?surface=partner"));
    expect(g.status, why).toBe(503);
    expect(g.body.error, why).toBe("NOTIFICATIONS_UNAVAILABLE");
    expect(g.body.items, why).toBeUndefined();
    /* A PATCH is scoped to the ids it names: a VALID owned row can still be
       marked while an unrelated row is malformed (the mutation never reads the
       bad row). Including the bad id itself rolls the whole PATCH back — see
       the "atomic PATCH" block. */
    const p = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner], read: true });
    expect(p.status, why).toBe(200);
    expect(p.body.updated, why).toBe(1);
    expect(stored(F.partner).read, `${why}: scoped mutation applied`).toBe(true);
    const ra = await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "partner" });
    expect(ra.status, why).toBe(503);
    expect(ra.body.marked, why).toBeUndefined();
    const s = await as(ME)(request(app).get("/api/notifications/stream?surface=partner"));
    expect(s.status, why).toBe(503);
  };
  it("a row whose payload is not JSON (unattributable — disclosed limitation: cannot tenant-isolate raw corrupt JSON)", async () => {
    insertRaw("ntf_corrupt", "{not json");
    await expect503("corrupt JSON");
    expect(() => readOwnedNotificationsStrict(ME)).toThrow(/not valid JSON/);
  });
  it("a row with owner fields missing", async () => {
    insertRaw("ntf_noowner", JSON.stringify({ id: "ntf_noowner", kind: "x", title: "t" }));
    await expect503("owner fields missing");
    expect(() => readOwnedNotificationsStrict(ME)).toThrow(/owner fields missing/);
  });
  it("a row whose payload id disagrees with its durable key", async () => {
    insertRaw("ntf_keyA", JSON.stringify({ id: "ntf_keyB", userId: ME, kind: "x", title: "t", body: "b", read: false, archived: false, createdAt: new Date().toISOString() }));
    await expect503("id≠key");
    expect(() => readOwnedNotificationsStrict(ME)).toThrow(/does not match durable key/);
  });
  it("an OWNED row violating the contract (read is a string)", async () => {
    insertRaw("ntf_badread", JSON.stringify({ id: "ntf_badread", userId: ME, kind: "x", title: "t", body: "b", read: "yes", archived: false, createdAt: new Date().toISOString() }));
    await expect503("owned invalid");
    expect(() => readOwnedNotificationsStrict(ME)).toThrow(/read must be a boolean/);
  });
  it.each([
    ["kind", { kind: "" }],
    ["title", { title: 1 }],
    ["body", { body: null }],
    ["archived", { archived: "no" }],
    ["createdAt", { createdAt: "not-a-date" }],
    ["link", { link: 7 }],
  ])("owned row with bad %s → 503", async (_f, patch) => {
    const base = { id: "ntf_bad", userId: ME, kind: "x", title: "t", body: "b", read: false, archived: false, createdAt: new Date().toISOString() };
    insertRaw("ntf_bad", JSON.stringify({ ...base, ...patch }));
    const g = await as(ME)(request(app).get("/api/notifications"));
    expect(g.status).toBe(503);
  });
  it("a VALID foreign row with a bizarre-but-valid shape is ignored; a foreign row VIOLATING the owned contract is also ignored (not my data)", async () => {
    insertRaw("ntf_foreign_odd", JSON.stringify({ id: "ntf_foreign_odd", userId: OTHER, kind: "x", title: 1, read: "yes" }));
    const g = await as(ME)(request(app).get("/api/notifications?surface=partner"));
    expect(g.status).toBe(200);
    expect(g.body.items.map((n: any) => n.id)).not.toContain("ntf_foreign_odd");
    // ...but the OWNER of that row is told, not shown an empty inbox
    const g2 = await as(OTHER)(request(app).get("/api/notifications"));
    expect(g2.status).toBe(503);
  });
  it("an owned row with link absent/null is valid (historical no-link notices)", async () => {
    insertRaw("ntf_nulllink", JSON.stringify({ id: "ntf_nulllink", userId: ME, kind: "x", title: "t", body: "b", link: null, read: false, archived: false, createdAt: new Date().toISOString() }));
    const g = await as(ME)(request(app).get("/api/notifications"));
    expect(g.status).toBe(200);
    expect(g.body.items.find((n: any) => n.id === "ntf_nulllink").destination).toEqual({ class: "unclassified", reason: "missing" });
  });
});

/* ───────────────────────────── atomic rollback ─────────────────────────── */

describe("atomic PATCH — one bad row rolls back the whole request", () => {
  it("a PATCH spanning good rows and a corrupt row saves NOTHING and reports 503", async () => {
    insertRaw("ntf_corrupt2", "{oops");
    const r = await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner, F.admin, "ntf_corrupt2"], read: true });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: "NOTIFICATIONS_UPDATE_FAILED" });
    expect(stored(F.partner).read).toBe(false);
    expect(stored(F.admin).read).toBe(false);
  });
  it("read-all over a set containing an owned invalid row saves NOTHING", async () => {
    insertRaw("ntf_bad3", JSON.stringify({ id: "ntf_bad3", userId: ME, kind: "x", title: "t", body: "b", read: false, archived: "x", createdAt: new Date().toISOString() }));
    const r = await as(ME)(request(app).post("/api/notifications/read-all")).send({ surface: "account" });
    expect(r.status).toBe(503);
    expect(rowsFor(ME).filter((x) => x.id !== "ntf_bad3").every((x) => x.payload.read === false)).toBe(true);
  });
});

/* ──────────────────────── independent reader / durability ──────────────── */

describe("durability — an independent reader over the SAME db sees the emitter and later mutations", () => {
  it("second facade instance (no shared RAM) lists the emitted row, then sees read/archive done through the first", async () => {
    const app2 = express();
    app2.use(express.json());
    registerPersonaNotificationRoutes(app2);
    const before = await as(ME)(request(app2).get("/api/notifications?surface=partner"));
    expect(before.status).toBe(200);
    expect(before.body.items.map((n: any) => n.id)).toContain(F.legacyPartner);
    expect(before.body.unread).toBe(2);

    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.legacyPartner], read: true, surface: "partner" });
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.partner], archived: true, surface: "partner" });

    const after = await as(ME)(request(app2).get("/api/notifications?surface=partner"));
    expect(after.body.unread).toBe(0);
    expect(after.body.items.map((n: any) => n.id)).toEqual([F.legacyPartner]);
    expect(after.body.items[0].read).toBe(true);
    const archived = await as(ME)(request(app2).get("/api/notifications?surface=partner&archived=true"));
    expect(archived.body.items.map((n: any) => n.id)).toEqual([F.partner]);
  });
  it("the legacy stored link is PRESERVED in storage — repair is presentational", async () => {
    await as(ME)(request(app).patch("/api/notifications")).send({ ids: [F.legacyPartner], read: true, surface: "partner" });
    const row = stored(F.legacyPartner);
    expect(row.link).toBe("/partner/pipeline");
    expect(row.read).toBe(true);
    expect(Object.keys(row).sort()).toEqual(["archived", "body", "channels", "createdAt", "id", "kind", "link", "read", "title", "userId"]);
    expect(LEGACY_LINK_ALIASES[row.link]).toBe("/collective/partner/pipeline");
  });
  it("frozen-emitter limitation is REAL: the emitter's RAM list is not what the facade reads (durable only)", () => {
    // A row present only in the durable table (no emitter call) is listed —
    // proving the facade reads DB, not the frozen module's RAM array.
    insertRaw("ntf_dbonly", JSON.stringify({ id: "ntf_dbonly", userId: ME, kind: "x", title: "t", body: "b", link: "/collective/partner/spvs/x", read: false, archived: false, createdAt: new Date().toISOString() }));
    const l = scopedListing(ME, "partner", {});
    expect(l.items.map((n) => n.id)).toContain("ntf_dbonly");
  });
});

/* ───────────────────────────────── stream ──────────────────────────────── */

describe("stream — scoped hello, bounded polling, cleanup", () => {
  it("resolveStreamPollMs clamps to [5000, 60000], default 15000", () => {
    expect(STREAM_POLL_MIN_MS).toBe(5000);
    expect(STREAM_POLL_MAX_MS).toBe(60_000);
    expect(STREAM_POLL_DEFAULT_MS).toBe(15_000);
    expect(resolveStreamPollMs(undefined)).toBe(15_000);
    expect(resolveStreamPollMs("")).toBe(15_000);
    expect(resolveStreamPollMs("abc")).toBe(15_000);
    expect(resolveStreamPollMs("-5")).toBe(5000);
    expect(resolveStreamPollMs("0")).toBe(5000);
    expect(resolveStreamPollMs("1")).toBe(5000);
    expect(resolveStreamPollMs("999999")).toBe(60_000);
    expect(resolveStreamPollMs("20000")).toBe(20_000);
  });
  it("hello frame is scoped to the requested surface and names the poll interval; bad surface 400", { timeout: 15000 }, async () => {
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    try {
      const frame = await new Promise<string>((resolve, reject) => {
        const req = http.get({ port, path: "/api/notifications/stream?surface=partner", headers: { "x-user-id": ME } }, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
          let buf = "";
          res.on("data", (c) => {
            buf += c.toString();
            if (buf.includes("\n\n")) { req.destroy(); resolve(buf); }
          });
        });
        req.on("error", (e) => { if ((e as any).code !== "ECONNRESET") reject(e); });
        setTimeout(() => reject(new Error("no hello frame")), 5000);
      });
      expect(frame).toMatch(/^event: hello\n/);
      const data = JSON.parse(frame.split("\n")[1].replace(/^data: /, ""));
      expect(data).toMatchObject({ surface: "partner", unread: 2, total: 2 });
      expect(data.pollMs).toBeGreaterThanOrEqual(5000);
      expect(data.pollMs).toBeLessThanOrEqual(60_000);
      expect(typeof data.version).toBe("string");
    } finally {
      (server as any).closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    expect((await as(ME)(request(app).get("/api/notifications/stream?surface=nope"))).status).toBe(400);
  });
  it("closing the client releases the server-side timers (no lingering handles)", async () => {
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const activeBefore = (process as any)._getActiveHandles().length;
    const req = http.get({ port, path: "/api/notifications/stream?surface=founder", headers: { "x-user-id": ME } });
    await new Promise<void>((resolve) => req.on("response", (res) => res.once("data", () => resolve())));
    req.destroy();
    await new Promise((r) => setTimeout(r, 100));
    (server as any).closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise((r) => setTimeout(r, 50));
    const activeAfter = (process as any)._getActiveHandles().length;
    expect(activeAfter).toBeLessThanOrEqual(activeBefore);
  });
});
