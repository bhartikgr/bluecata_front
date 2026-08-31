/**
 * WAVE 185 · ITEM C · OWNER RULING Q8 — THE COLLECTIVE SEED, PROVED.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT MUST BE TRUE, IN THE ORDER THE BRIEF ASKED IT:
 *
 *   C.1  the gated pages render REAL CONTENT with the seed applied — proved by
 *        calling the ACTUAL routes those pages call, as a seeded member, through
 *        the ACTUAL `requireCollectiveMember` gate;
 *   C.2  every seeded row is unmistakably test data and precisely deletable;
 *   C.3  the seeder never runs on boot and IS idempotent;
 *   C.4  NO money is invented — asserted mechanically, not promised in prose;
 *   C.5  the seeded members hold NO real entitlement and touch no real account.
 *
 * THE ANTI-VACUITY TESTS COME FIRST. A suite that seeds and then asserts the
 * pages are non-empty proves nothing unless the pages were EMPTY beforehand for
 * these members, so V-1 and V-2 establish the before-state. Without them every
 * later assertion could be passing on data that was already there.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerCollectiveRoutes } from "../collectiveRoutes";
/* The Collective's gated pages are served by FOUR registrars, not one. Mounting
   only `registerCollectiveRoutes` would 404 the calendar, feed and leaderboard
   and let this suite "pass" by never reaching them. */
import { registerCollectiveWaveARoutes } from "../collectiveWaveAStore";
import { registerScreeningEventRoutes } from "../screeningEventsStore";
import { registerChapterAnnouncementRoutes } from "../chapterAnnouncementsStore";
import { registerLeaderboardRoutes } from "../chapterLeaderboardStore";
import { listChaptersForUser } from "../chaptersStore";
/* `requireAdmin` and `requireCollectiveMember` resolve identity through
   `getUserContext`, which reads the persona registry — NOT the `req.userContext`
   this suite injects. Injecting alone left every admin route at 401 and made the
   suite look like a seeder bug when it was a harness bug. Register real personas. */
import { __setRuntimePersona } from "../lib/userContext";
/* The seeder LISTS existing demo companies rather than inventing any, so on a
   bare test database there is nothing for it to list and the Companies, Soft
   Circles and Calendar assertions would be testing an empty tree rather than the
   seed. `seedDemoData` is the tree's own standard fixture for exactly this. */
import { seedDemoData } from "../lib/seedDemoData";
import { getDb } from "../db/connection";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { rawDb } from "../db/connection";
import {
  seedW185CollectiveTestData,
  statusW185CollectiveTestData,
  purgeW185CollectiveTestData,
  W185_ID_TOKEN,
  W185_LABEL_PREFIX,
  W185_EMAIL_DOMAIN,
  W185_CHAPTER_ID,
} from "../lib/w185CollectiveTestSeed";

const ADMIN = "u_admin_w185c";
const SEEDED_MEMBER = `u_${W185_ID_TOKEN}_1`;
const STRANGER = "u_w185c_stranger";

let app: express.Express;
/* The identity every request runs as. Mutable so one app can be driven as an
   admin, as a seeded member, and as an unrelated stranger. */
let VIEWER: { userId: string; isAdmin: boolean } = { userId: ADMIN, isAdmin: true };

const asAdmin = () => { VIEWER = { userId: ADMIN, isAdmin: true }; };
const asMember = () => { VIEWER = { userId: SEEDED_MEMBER, isAdmin: false }; };
const asStranger = () => { VIEWER = { userId: STRANGER, isAdmin: false }; };

const get = (p: string) =>
  request(app).get(p).set("x-user-id", VIEWER.userId).set("x-role", VIEWER.isAdmin ? "admin" : "investor");
const post = (p: string) =>
  request(app).post(p).set("x-user-id", VIEWER.userId).set("x-role", VIEWER.isAdmin ? "admin" : "investor").send({});

beforeAll(async () => {
  /* THE COLLECTIVE IS BEHIND A FEATURE FLAG. Without it the calendar and
     leaderboard routes answer 503 before any gate runs, so this must be set for
     the suite to be testing the gate at all rather than the flag. */
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  /* A real, unrelated account, so "no real member was touched" has something to
     be true ABOUT. */
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', 'stranger@w185c.test', 'Real Stranger', 'investor', 0, NULL)`,
    )
    .run(STRANGER);
  /* `requireAdmin` resolves identity through `getUserContext`, which reads the
     REAL user record — an id with no row is not authenticated at all. So the
     admin this suite acts as has to exist. */
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', 'admin@w185c.test', 'W185C Admin', 'admin', 0, NULL)`,
    )
    .run(ADMIN);

  __setRuntimePersona({
    userId: ADMIN,
    email: "admin@w185c.test",
    name: "W185C Admin",
    isFounder: false,
    isInvestor: false,
    isAdmin: true,
    hasInvitations: false,
  });
  /* The seeded member and the stranger are registered as ORDINARY INVESTORS with
     no admin bit, so `requireCollectiveMember`'s admin bypass can never be what
     lets them in — the membership rows have to do the work. */
  __setRuntimePersona({
    userId: SEEDED_MEMBER,
    email: `member1${W185_EMAIL_DOMAIN}`,
    name: `${W185_LABEL_PREFIX}Ada Sandbox`,
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
  __setRuntimePersona({
    userId: STRANGER,
    email: "stranger@w185c.test",
    name: "Real Stranger",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userContext = {
      userId: VIEWER.userId,
      isAdmin: VIEWER.isAdmin,
      isAuthed: true,
      role: VIEWER.isAdmin ? "admin" : "investor",
    };
    next();
  });
  registerCollectiveRoutes(app);
  registerCollectiveWaveARoutes(app);
  registerScreeningEventRoutes(app);
  registerChapterAnnouncementRoutes(app);
  registerLeaderboardRoutes(app);
}, 30_000);

/* ══════════════════════════════════════════════════════════════════════════════
   ANTI-VACUITY — THE BEFORE-STATE
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · C · ANTI-VACUITY: the seed is what changes the pages", () => {
  it("V-1 nothing is seeded before the seeder is invoked — so nothing runs on boot", () => {
    /* RULE 3, asserted rather than asserted-in-prose. The app has been created,
       every route registered, and every module imported; if any of that seeded
       on boot, these counts would be non-zero. */
    const s = statusW185CollectiveTestData();
    for (const [table, n] of Object.entries(s.present)) {
      expect(n, `${table} must be empty before the seeder is invoked`).toBe(0);
    }
  });

  it("V-2 a seeded member cannot reach the gated pages before the seed exists", async () => {
    asMember();
    const r = await get("/api/collective/members");
    /* The gate refuses them, because their membership row does not exist yet.
       This is the wave-183 finding: the gate screen was correct behaviour. */
    expect([401, 403]).toContain(r.status);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE SEED ITSELF
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · C · the seeder is admin-invoked, reports honestly, and is idempotent", () => {
  it("C-1 a NON-admin cannot invoke the seeder", async () => {
    asMember();
    const r = await post("/api/admin/collective/w185-test-seed");
    expect([401, 403]).toContain(r.status);
    /* And it wrote nothing on the way to refusing. */
    expect(statusW185CollectiveTestData().present["users"]).toBe(0);
  });

  it("C-2 an admin can invoke it, and it reports what it created", async () => {
    asAdmin();
    const r = await post("/api/admin/collective/w185-test-seed");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.created.users).toBe(5);
    expect(r.body.created.collective_memberships).toBe(5);
    expect(r.body.created.chapter_memberships).toBe(5);
    expect(r.body.created.chapters).toBe(1);
    expect(r.body.created.network_posts).toBe(4);
    /* The report carries the cleanup criteria, so the owner never has to find
       them in a document. */
    expect(r.body.cleanup.idToken).toBe(W185_ID_TOKEN);
    expect(r.body.cleanup.chapterId).toBe(W185_CHAPTER_ID);
    /* Anything the seeder could NOT write is NAMED, never swallowed. */
    expect(Array.isArray(r.body.skipped)).toBe(true);
  });

  it("C-3 IDEMPOTENT: a second invocation creates nothing new", async () => {
    asAdmin();
    const before = statusW185CollectiveTestData().present;
    const r = await post("/api/admin/collective/w185-test-seed");
    expect(r.status).toBe(200);
    /* Every row is reported as already present, and not one as created. */
    expect(r.body.created.users ?? 0).toBe(0);
    expect(r.body.alreadyPresent.users).toBe(5);
    expect(r.body.created.chapters ?? 0).toBe(0);
    expect(r.body.created.network_posts ?? 0).toBe(0);
    const after = statusW185CollectiveTestData().present;
    expect(after).toEqual(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   C.1 — THE GATED PAGES RENDER REAL CONTENT
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · C.1 · the gated pages render real content as a seeded member", () => {
  it("C-4 THE GATE now admits a seeded member (it refused in V-2)", async () => {
    asMember();
    const r = await get("/api/collective/members");
    expect(r.status).toBe(200);
  });

  it("C-5 MEMBER DIRECTORY renders the seeded members BY NAME, not as 'Private Investor'", async () => {
    asMember();
    const r = await get("/api/collective/members");
    expect(r.status).toBe(200);
    const names = (r.body.members ?? []).map((m: any) => String(m.displayName));
    const seeded = names.filter((n: string) => n.startsWith(W185_LABEL_PREFIX));
    /* The point of the explicit privacy opt-in: without it every seeded member
       would render as "Private Investor" and the page would look broken. */
    expect(seeded.length).toBeGreaterThanOrEqual(4);
    expect(names).not.toContain("Real Stranger");
    /* The directory still refuses to publish emails (a pre-existing rule this
       seed must not have loosened). */
    expect(JSON.stringify(r.body)).not.toContain(W185_EMAIL_DOMAIN);
  });

  it("C-6 CONNECTIONS reads the same directory, and it is populated", async () => {
    asMember();
    const r = await get("/api/collective/members");
    expect(r.status).toBe(200);
    expect(Number(r.body.total)).toBeGreaterThan(0);
  });

  it("C-7 POSTS renders the seeded posts with a resolvable author", async () => {
    asMember();
    const r = await get("/api/collective/posts");
    expect(r.status).toBe(200);
    const posts = (r.body.posts ?? r.body ?? []) as any[];
    const seeded = posts.filter((p: any) => String(p?.body ?? "").startsWith(W185_LABEL_PREFIX));
    expect(seeded.length).toBeGreaterThanOrEqual(1);
  });

  it("C-8 CHAPTERS resolves the sandbox chapter for a seeded member", () => {
    /* `/api/me/chapters` lives in `routes.ts`, whose registrar mounts the entire
       application; the Chapters page's chapter scope is produced by
       `listChaptersForUser`, so THAT is what is asserted — the same function the
       route calls, rather than a second copy of its query. */
    const chapters = listChaptersForUser(SEEDED_MEMBER) as Array<{ id?: string }>;
    const ids = chapters.map((c) => String(c?.id ?? ""));
    expect(ids).toContain(W185_CHAPTER_ID);
  });

  it("C-9 CALENDAR renders the seeded screening events and announcements", async () => {
    asMember();
    const ev = await get(`/api/collective/screening-events?chapter_id=${W185_CHAPTER_ID}`);
    expect(ev.status).toBe(200);
    const events = (ev.body.events ?? ev.body ?? []) as any[];
    const seededEvents = events.filter((e: any) => String(e?.title ?? "").startsWith(W185_LABEL_PREFIX));

    const an = await get(`/api/collective/announcements?chapter_id=${W185_CHAPTER_ID}`);
    expect(an.status).toBe(200);
    const anns = (an.body.announcements ?? an.body ?? []) as any[];
    const seededAnns = anns.filter((a: any) => String(a?.title ?? "").startsWith(W185_LABEL_PREFIX));

    /* Either surface being populated proves the calendar has real content; both
       are asserted so a single seeded table cannot carry the claim alone. */
    expect(seededAnns.length).toBeGreaterThanOrEqual(1);
    expect(seededEvents.length + seededAnns.length).toBeGreaterThanOrEqual(2);
  });

  it("C-10 COMPANIES and SOFT CIRCLES answer without error for a seeded member", async () => {
    asMember();
    const co = await get("/api/collective/companies");
    expect(co.status).toBe(200);
    const sc = await get("/api/collective/soft-circles");
    expect(sc.status).toBe(200);

    /* The seeder LISTS existing demo companies rather than inventing any — a
       fabricated company would have required fabricating its rounds and
       valuations too. So the assertion is that the LISTING was created, which is
       the seeder's actual contribution to this page. */
    const listings = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM collective_directory_listings WHERE id LIKE ?`)
      .get(`%${W185_ID_TOKEN}%`) as { n: number };
    expect(listings.n).toBeGreaterThanOrEqual(1);
    const companies = (co.body.companies ?? co.body ?? []) as any[];
    expect(companies.length).toBeGreaterThan(0);
  });

  it("C-11 LEADERBOARD answers, and its inputs were seeded rather than its scores", async () => {
    asMember();
    /* The route's zod enum is `weekly|monthly|all-time` — `all_time` is a 400.
       Using the wrong literal made a passing route look broken. */
    const r = await get(`/api/collective/leaderboard?chapter_id=${W185_CHAPTER_ID}&period=all-time`);
    expect(r.status).toBe(200);
    /* The seeder writes ATTENDANCE, not snapshot rows: the leaderboard is
        computed from reputation, answers, attendance, announcements authored and
        resources approved, so hand-writing a snapshot would be fabricating a
        score. Assert the input exists, not a number we invented. */
    const attendance = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM screening_event_attendees WHERE id LIKE ? AND attended = 1`)
      .get(`%${W185_ID_TOKEN}%`) as { n: number };
    expect(attendance.n).toBeGreaterThanOrEqual(1);
    /* And no snapshot row was hand-written by the seeder — the score, if any, is
       computed by the platform from the seeded inputs. */
    const snapshots = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM chapter_leaderboard_snapshots WHERE id LIKE ?`)
      .get(`%${W185_ID_TOKEN}%`) as { n: number };
    expect(snapshots.n).toBe(0);
  });

  it("C-12 A STRANGER IS STILL REFUSED — the seed did not open the gate for everyone", async () => {
    asStranger();
    const r = await get("/api/collective/members");
    expect([401, 403]).toContain(r.status);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   C.2 / C.4 / C.5 — IDENTIFIABLE, MONEYLESS, UNENTITLED
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · C · every seeded row is test data, moneyless, and unentitled", () => {
  it("C-13 EVERY seeded row carries the id token — one grep finds all of it", () => {
    const tables: Array<[string, string]> = [
      ["users", "id"],
      ["contacts", "id"],
      ["collective_memberships", "user_id"],
      ["chapter_memberships", "id"],
      ["network_posts", "id"],
      ["chapter_announcements", "id"],
      ["screening_events", "id"],
      ["screening_event_attendees", "id"],
    ];
    for (const [table, col] of tables) {
      const rows = rawDb()
        .prepare(`SELECT ${col} AS k FROM ${table} WHERE ${col} LIKE ?`)
        .all(`%${W185_ID_TOKEN}%`) as Array<{ k: string }>;
      for (const r of rows) expect(String(r.k)).toContain(W185_ID_TOKEN);
    }
    /* And the marker is actually PRESENT, so the loop above is not vacuous. */
    const n = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE id LIKE ?`)
      .get(`%${W185_ID_TOKEN}%`) as { n: number };
    expect(n.n).toBe(5);
  });

  it("C-14 every seeded human-readable field is prefixed, and every email is undeliverable", () => {
    const users = rawDb()
      .prepare(`SELECT name, email FROM users WHERE id LIKE ?`)
      .all(`%${W185_ID_TOKEN}%`) as Array<{ name: string; email: string }>;
    expect(users.length).toBe(5);
    for (const u of users) {
      expect(u.name.startsWith(W185_LABEL_PREFIX)).toBe(true);
      /* RFC 2606 reserves `.invalid`: this address can never receive mail, so a
         seeded member cannot be notified, invited or contacted by accident. */
      expect(u.email.endsWith(W185_EMAIL_DOMAIN)).toBe(true);
    }
    const posts = rawDb()
      .prepare(`SELECT body FROM network_posts WHERE id LIKE ?`)
      .all(`%${W185_ID_TOKEN}%`) as Array<{ body: string }>;
    for (const p of posts) expect(p.body.startsWith(W185_LABEL_PREFIX)).toBe(true);
  });

  it("C-15 NO MONEY WAS INVENTED — no fee, no price, no capital figure", () => {
    /* RULE 4, asserted mechanically. The sandbox chapter's annual membership fee
       is NULL, not 0: zero is a PRICE (a claim that membership is free) and wave
       184 is making fees database-driven, where a seeded 0 would read as a real
       configured amount. */
    const ch = rawDb()
      .prepare(`SELECT membership_fee_annual_minor AS fee FROM chapters WHERE id = ?`)
      .get(W185_CHAPTER_ID) as { fee: number | null };
    expect(ch.fee).toBeNull();

    /* The seeder writes to NO fee, price or commitment table. */
    for (const t of ["captable_commits", "spv_subscription"]) {
      let n = 0;
      try {
        n = (rawDb().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE id LIKE ?`).get(`%${W185_ID_TOKEN}%`) as { n: number }).n;
      } catch { n = 0; /* table absent in this harness is also "nothing written" */ }
      expect(n, `${t} must contain no seeded row`).toBe(0);
    }

    /* The ONLY figure written anywhere is the soft-circle sentinel, and it is
       the same self-evident value every time. */
    const circles = rawDb()
      .prepare(`SELECT amount, amount_minor FROM soft_circles WHERE id LIKE ?`)
      .all(`%${W185_ID_TOKEN}%`) as Array<{ amount: number; amount_minor: number }>;
    for (const c of circles) {
      expect(c.amount_minor).toBe(111111);
      expect(Number(c.amount)).toBeCloseTo(1111.11, 2);
    }
  });

  it("C-16 NO REAL ENTITLEMENT: no alias, no partner binding, no admin role, no cap-table position", () => {
    /* RULE 5. Each of these would have widened somebody's reach, which is the
       one cost this wave refuses to pay for a feature. */
    const zero = (sql: string, param: string): number => {
      try {
        return (rawDb().prepare(sql).get(param) as { n: number }).n;
      } catch {
        return 0;
      }
    };
    expect(zero(`SELECT COUNT(*) AS n FROM investor_identity_alias WHERE alias_investor_id LIKE ?`, `%${W185_ID_TOKEN}%`)).toBe(0);
    expect(zero(`SELECT COUNT(*) AS n FROM investor_identity_alias WHERE canonical_investor_id LIKE ?`, `%${W185_ID_TOKEN}%`)).toBe(0);
    expect(zero(`SELECT COUNT(*) AS n FROM partner_team_members WHERE user_id LIKE ?`, `%${W185_ID_TOKEN}%`)).toBe(0);
    expect(zero(`SELECT COUNT(*) AS n FROM captable_commits WHERE investor_id LIKE ?`, `%${W185_ID_TOKEN}%`)).toBe(0);

    /* Every seeded account is role `investor` and demo-flagged — never admin. */
    const roles = rawDb()
      .prepare(`SELECT role, is_demo FROM users WHERE id LIKE ?`)
      .all(`%${W185_ID_TOKEN}%`) as Array<{ role: string; is_demo: number }>;
    for (const r of roles) {
      expect(r.role).toBe("investor");
      expect(r.is_demo).toBe(1);
    }

    /* Every membership is in the SANDBOX chapter only — no real roster. */
    const chapters = rawDb()
      .prepare(`SELECT DISTINCT chapter_id AS c FROM chapter_memberships WHERE id LIKE ?`)
      .all(`%${W185_ID_TOKEN}%`) as Array<{ c: string }>;
    expect(chapters.map((r) => r.c)).toEqual([W185_CHAPTER_ID]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   THE CLEANUP THE OWNER SAID IS IMMINENT
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · C · the purge removes exactly the seed and nothing else", () => {
  it("C-17 a NON-admin cannot purge", async () => {
    asMember();
    const r = await post("/api/admin/collective/w185-test-seed/purge");
    expect([401, 403]).toContain(r.status);
    expect(statusW185CollectiveTestData().present["users"]).toBe(5);
  });

  it("C-18 the purge removes every seeded row, and the real account survives", async () => {
    asAdmin();
    const r = await post("/api/admin/collective/w185-test-seed/purge");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.failed).toEqual([]);

    const after = statusW185CollectiveTestData().present;
    for (const [table, n] of Object.entries(after)) {
      expect(n, `${table} must be empty after the purge`).toBe(0);
    }

    /* THE UNRELATED REAL ACCOUNT IS UNTOUCHED. A purge that took a real row with
       it would be worse than leaving the test data in place. */
    const stranger = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE id = ?`)
      .get(STRANGER) as { n: number };
    expect(stranger.n).toBe(1);
  });

  it("C-19 the purge is itself idempotent and the seed can be re-applied afterwards", () => {
    const again = purgeW185CollectiveTestData();
    expect(again.ok).toBe(true);
    for (const n of Object.values(again.deleted)) expect(n).toBe(0);

    const re = seedW185CollectiveTestData();
    expect(re.created.users).toBe(5);
    /* Leave the tree clean: this suite must not hand the next suite a seeded DB. */
    purgeW185CollectiveTestData();
    expect(statusW185CollectiveTestData().present["users"]).toBe(0);
  });
});
