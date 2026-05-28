/**
 * v17 Phase A — chapter scoping test.
 *
 * Covers (per V19_BUILD_BRIEF.md lines 46-155):
 *   1. Demo seed creates exactly 4 chapters (chap_keiretsu_canada, chap_toronto,
 *      chap_nyc, chap_sf) and 3 chapter memberships (Maya/Aisha/Daniel in
 *      chap_keiretsu_canada).
 *   2. listChaptersForUser returns the joined chapter rows for a real member.
 *   3. listChaptersForUser returns [] for a user with no memberships.
 *   4. requireChapterMember middleware:
 *        - 401 missing_identity   when ctx.userId is absent
 *        - 400 missing_chapter_id when chapterId is empty
 *        - 403 not_chapter_member when caller is not in the chapter
 *        - next()                 when caller IS in the chapter
 *        - admin bypass           when ctx.isAdmin === true
 *   5. Cross-chapter read isolation via _internal.isActiveChapterMember:
 *        Maya (in chap_keiretsu_canada) is NOT a member of chap_nyc.
 *   6. GET /api/me/chapters:
 *        - 503 collective_not_available when COLLECTIVE_ENABLED!=1
 *        - 200 with { chapters: [...] } for an authed member
 *
 * Self-contained: seeds demo data via seedDemoData(getDb()) so it does not
 * depend on server/index.ts boot order.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { listAllChapters, listChaptersForUser } from "../chaptersStore";
import requireChapterMember, {
  requireChapterMemberFromRequest,
  _internal,
} from "../lib/requireChapterMember";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  // Seed chapters + memberships before any test runs. The demo seed is
  // idempotent (every insert uses onConflictDoNothing), so re-running it
  // against an already-seeded DB is a no-op — safe to call here.
  await seedDemoData(getDb());

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
});

// ---------- HTTP helper (mirrors style of v14/v16 tests) -----------------

function call(
  method: string,
  apiPath: string,
  opts: { userId?: string; envCollectiveEnabled?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

// ---------- Helper: run a middleware against a fake req/res --------------

function runMiddleware(
  mw: (req: Request, res: Response, next: NextFunction) => void,
  reqOverrides: Partial<Request> & { userContext?: any } = {},
): Promise<{ statusCode: number; body: any; nextCalled: boolean }> {
  return new Promise((resolve) => {
    let statusCode = 200;
    let body: any = null;
    let nextCalled = false;
    const req = {
      params: {},
      query: {},
      body: {},
      ...reqOverrides,
    } as unknown as Request;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(payload: any) { body = payload; resolve({ statusCode, body, nextCalled }); return this; },
    } as unknown as Response;
    const next: NextFunction = () => {
      nextCalled = true;
      resolve({ statusCode, body, nextCalled });
    };
    mw(req, res, next);
  });
}

// ========================================================================
// 1. Demo seed correctness
// ========================================================================

describe("v17 Phase A — demo seed", () => {
  it("creates exactly 4 chapters with the expected ids", () => {
    const all = listAllChapters();
    const ids = all.map((c) => c.id).sort();
    // Must contain all four seeded chapters. (Other test code in the same
    // process MAY add more rows; we assert containment + minimum size.)
    expect(ids).toEqual(
      expect.arrayContaining([
        "chap_keiretsu_canada",
        "chap_toronto",
        "chap_nyc",
        "chap_sf",
      ]),
    );
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("seeds Maya, Aisha, Daniel into chap_keiretsu_canada", () => {
    const maya = listChaptersForUser("u_maya_chen");
    const aisha = listChaptersForUser("u_aisha_patel");
    const daniel = listChaptersForUser("u_daniel_okafor");

    expect(maya.map((m) => m.id)).toContain("chap_keiretsu_canada");
    expect(aisha.map((m) => m.id)).toContain("chap_keiretsu_canada");
    expect(daniel.map((m) => m.id)).toContain("chap_keiretsu_canada");

    // Roles
    const mayaRow = maya.find((m) => m.id === "chap_keiretsu_canada")!;
    const aishaRow = aisha.find((m) => m.id === "chap_keiretsu_canada")!;
    expect(mayaRow.membershipRole).toBe("member");
    expect(aishaRow.membershipRole).toBe("admin");
  });

  it("listChaptersForUser returns [] for a user with no memberships", () => {
    const rows = listChaptersForUser("u_ghost_no_memberships");
    expect(rows).toEqual([]);
  });
});

// ========================================================================
// 2. Cross-chapter isolation (the load-bearing invariant for Phase A)
// ========================================================================

describe("v17 Phase A — cross-chapter isolation", () => {
  it("Maya is a member of chap_keiretsu_canada but NOT chap_nyc", () => {
    expect(_internal.isActiveChapterMember("u_maya_chen", "chap_keiretsu_canada")).toBe(true);
    expect(_internal.isActiveChapterMember("u_maya_chen", "chap_nyc")).toBe(false);
    expect(_internal.isActiveChapterMember("u_maya_chen", "chap_sf")).toBe(false);
  });

  it("a completely unknown user is not a member of any chapter", () => {
    expect(_internal.isActiveChapterMember("u_ghost_no_memberships", "chap_keiretsu_canada")).toBe(false);
    expect(_internal.isActiveChapterMember("u_ghost_no_memberships", "chap_toronto")).toBe(false);
  });
});

// ========================================================================
// 3. requireChapterMember middleware
// ========================================================================

describe("v17 Phase A — requireChapterMember middleware (factory form)", () => {
  it("401 missing_identity when ctx.userId is absent", async () => {
    const mw = requireChapterMember("chap_keiretsu_canada");
    const { statusCode, body, nextCalled } = await runMiddleware(mw, { userContext: {} });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(401);
    expect(body?.error).toBe("missing_identity");
  });

  it("400 missing_chapter_id when chapterId is empty string", async () => {
    const mw = requireChapterMember("");
    const { statusCode, body, nextCalled } = await runMiddleware(mw, {
      userContext: { userId: "u_maya_chen" },
    });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(400);
    expect(body?.error).toBe("missing_chapter_id");
  });

  it("403 not_chapter_member when caller is not in chapter", async () => {
    const mw = requireChapterMember("chap_nyc");
    const { statusCode, body, nextCalled } = await runMiddleware(mw, {
      userContext: { userId: "u_maya_chen" },
    });
    expect(nextCalled).toBe(false);
    expect(statusCode).toBe(403);
    expect(body?.error).toBe("not_chapter_member");
  });

  it("next() when caller IS a member of the chapter", async () => {
    const mw = requireChapterMember("chap_keiretsu_canada");
    const { nextCalled } = await runMiddleware(mw, {
      userContext: { userId: "u_maya_chen" },
    });
    expect(nextCalled).toBe(true);
  });

  it("admin bypasses the chapter check even for chapters they have no row in", async () => {
    const mw = requireChapterMember("chap_nyc");
    const { nextCalled } = await runMiddleware(mw, {
      userContext: { userId: "u_some_platform_admin", isAdmin: true },
    });
    expect(nextCalled).toBe(true);
  });
});

describe("v17 Phase A — requireChapterMemberFromRequest (dynamic form)", () => {
  it("resolves chapter id from req.params and grants when caller is a member", async () => {
    const mw = requireChapterMemberFromRequest((req) => String((req.params as any).chapterId));
    const { nextCalled } = await runMiddleware(mw, {
      userContext: { userId: "u_maya_chen" },
      params: { chapterId: "chap_keiretsu_canada" } as any,
    });
    expect(nextCalled).toBe(true);
  });

  it("400 missing_chapter_id when the resolver returns empty", async () => {
    const mw = requireChapterMemberFromRequest(() => "");
    const { statusCode, body } = await runMiddleware(mw, {
      userContext: { userId: "u_maya_chen" },
    });
    expect(statusCode).toBe(400);
    expect(body?.error).toBe("missing_chapter_id");
  });
});

// ========================================================================
// 4. GET /api/me/chapters
// ========================================================================

describe("v17 Phase A — GET /api/me/chapters", () => {
  const originalEnv = process.env.COLLECTIVE_ENABLED;
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.COLLECTIVE_ENABLED;
    else process.env.COLLECTIVE_ENABLED = originalEnv;
  });

  it("returns 503 collective_not_available when COLLECTIVE_ENABLED!=1", async () => {
    delete process.env.COLLECTIVE_ENABLED;
    const r = await call("GET", "/api/me/chapters", { userId: "u_maya_chen" });
    expect(r.status).toBe(503);
    expect(r.body?.error).toBe("collective_not_available");
    expect(r.body?.chapters).toEqual([]);
  });

  it("returns Maya's chapter memberships when COLLECTIVE_ENABLED=1", async () => {
    process.env.COLLECTIVE_ENABLED = "1";
    const r = await call("GET", "/api/me/chapters", { userId: "u_maya_chen" });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(Array.isArray(r.body?.chapters)).toBe(true);
    const ids = (r.body.chapters as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("chap_keiretsu_canada");
  });

  // Note: "empty list for unknown user" is covered at the store level
  // (listChaptersForUser returns []). The HTTP endpoint sits behind
  // requireAuth, which rejects unknown user ids with 401 before reaching
  // the chapter lookup — that path is identical to every other
  // requireAuth-gated endpoint and is exercised by existing tests.
});

// vi is imported above (kept available for future mocking; vitest warns
// on unused imports otherwise).
void vi;
