/* ════════════════════════════════════════════════════════════════════════════
   WAVE 120 · FINDING 1 — A SIGNED DATA-ROOM LINK IS BOUND TO ITS GRANTEE, AND A
   WITHDRAWN LINK STOPS WORKING IMMEDIATELY.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN. `GET /api/public/data-room/files/:fileId?grant=<token>`
   (`server/track1Routes.ts`, registered UNAUTHENTICATED) validated a link by
   checking the token matched a row and that `expires_at` had not passed. The
   grantee on the row was read out of the database and compared to nobody, and the
   `data_room_grants` table had an INSERT and a SELECT in the entire tree — no
   UPDATE, no DELETE, no `revoked_at`, no route. So a link issued to one investor
   served the document to anyone holding it, for a TTL of up to 30 days, and could
   not be taken back. These are documents companies share with investors during a
   fundraise.

   GROUP (Z) IS THE FAIL-BEFORE PROOF and is not decoration: it re-implements the
   OLD predicate — token match plus expiry, exactly as it was — mounts it on a
   scratch route over the SAME fixtures, and asserts that it hands the bytes to a
   stranger and to a withdrawn grant. Every assertion in groups (A)–(D) is the
   same request against the SHIPPED route. If the fix were reverted, the shipped
   route would behave like the scratch route and (A)–(D) would fail.

   IDENTITY. `getUserContext` is mocked to read an explicit, test-owned header, so
   no seeded demo persona is relied on and nothing about how a real session is
   established is touched (owner ruling R90). Group (E) asserts the shipped wiring
   still registers the real routes.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const FOUNDER = "u_w120_founder";
const GRANTEE = "u_w120_grantee";
const STRANGER = "u_w120_stranger";
const OUTSIDE_FOUNDER = "u_w120_other_founder";
const COMPANY = "co_w120_grantbind";
const OTHER_COMPANY = "co_w120_elsewhere";

/** The identity header this test owns. Never a cookie, never a session. */
const H = "x-w120-actor";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

/* The shipped write routes sit behind the real rate limiter, which refuses the
   dozens of grants this file issues with a 429 well before the assertions are
   reached. It is replaced with a pass-through HERE ONLY; group (E) reads the
   route table out of the source and asserts that the SHIPPED registrations still
   carry `rateLimitMiddleware`, so this stub cannot hide an unthrottled route. */
vi.mock("../lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    rateLimitMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: (req: Request) => {
      const who = (req.headers["x-w120-actor"] as string | undefined) ?? "";
      if (!who) return { isAuthed: false, isAdmin: false, userId: "", founder: { companies: [] } };
      const companies =
        who === "u_w120_founder" ? [{ companyId: "co_w120_grantbind" }]
        : who === "u_w120_other_founder" ? [{ companyId: "co_w120_elsewhere" }]
        : [];
      return { isAuthed: true, isAdmin: false, userId: who, founder: { companies } };
    },
  };
});

let app: Express;
let ROUND_ID = "";
let FILE_ID = "";
const PDF_BASE64 = Buffer.from("%PDF-1.4 w120 grant binding fixture").toString("base64");

beforeAll(async () => {
  const { registerTrack1Routes } = await import("../track1Routes");
  const { createRound } = await import("../roundsStore");

  app = express();
  app.use(express.json({ limit: "10mb" }));
  registerTrack1Routes(app);

  const round = createRound({
    companyId: COMPANY,
    name: "W120 Seed",
    type: "seed",
    state: "active",
    targetAmount: 2_000_000,
    actorUserId: FOUNDER,
  } as Parameters<typeof createRound>[0]);
  ROUND_ID = round.id;

  const upload = await request(app)
    .post("/api/founder/data-room/files")
    .set(H, FOUNDER)
    .send({ roundId: ROUND_ID, filename: "diligence.pdf", contentBase64: PDF_BASE64, mimeType: "application/pdf" });
  expect(upload.status).toBe(201);
  FILE_ID = upload.body.fileId;
  expect(typeof FILE_ID).toBe("string");
});

/** Issue a fresh link to the grantee. Returns `{ grantId, token }`. */
async function issueGrant(ttlMinutes = 60, investorId = GRANTEE): Promise<{ grantId: string; token: string }> {
  const res = await request(app)
    .post("/api/founder/data-room/grants")
    .set(H, FOUNDER)
    .send({ fileId: FILE_ID, investorId, ttlMinutes });
  expect(res.status).toBe(201);
  return { grantId: res.body.grantId, token: res.body.grantToken };
}

/** Open the document with a token, as somebody (or as nobody). */
function open(token: string, actor?: string) {
  const r = request(app).get(`/api/public/data-room/files/${FILE_ID}`).query({ grant: token });
  return actor ? r.set(H, actor) : r;
}

describe("(A) the token is bound to its grantee", () => {
  it("serves the document to the investor the grant NAMES", async () => {
    const { token } = await issueGrant();
    const res = await open(token, GRANTEE);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.body.length).toBe(Buffer.from(PDF_BASE64, "base64").length);
  });

  it("REFUSES a signed-in stranger holding the very same token", async () => {
    const { token } = await issueGrant();
    const res = await open(token, STRANGER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("GRANT_NOT_YOURS");
    /* The refusal must not leak the document by any other means. */
    expect(res.headers["content-type"]).not.toContain("application/pdf");
  });

  it("REFUSES a founder of a DIFFERENT company holding the token", async () => {
    const { token } = await issueGrant();
    const res = await open(token, OUTSIDE_FOUNDER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("GRANT_NOT_YOURS");
  });

  it("REFUSES an unauthenticated caller — the token alone is not a credential", async () => {
    const { token } = await issueGrant();
    const res = await open(token);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("GRANT_REQUIRES_SIGN_IN");
  });

  it("still lets the ISSUING founder open the file, so no legitimate use is lost", async () => {
    const { token } = await issueGrant();
    const res = await open(token, FOUNDER);
    expect(res.status).toBe(200);
  });

  it("refuses an unknown token exactly as before", async () => {
    const res = await open("not-a-real-token", GRANTEE);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("INVALID_GRANT");
  });
});

describe("(B) revocation is possible, and effective IMMEDIATELY", () => {
  it("a link that worked one request ago stops working on the next", async () => {
    const { grantId, token } = await issueGrant();

    const before = await open(token, GRANTEE);
    expect(before.status).toBe(200);

    const revoke = await request(app)
      .post(`/api/founder/data-room/grants/${grantId}/revoke`)
      .set(H, FOUNDER)
      .send({});
    expect(revoke.status).toBe(200);
    expect(revoke.body.alreadyRevoked).toBe(false);
    expect(typeof revoke.body.revokedAt).toBe("string");
    expect(revoke.body.revokedBy).toBe(FOUNDER);

    /* No sleep, no cache flush, no re-deploy: the very next request. */
    const after = await open(token, GRANTEE);
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("GRANT_REVOKED");
    expect(after.headers["content-type"]).not.toContain("application/pdf");
  });

  it("a revoked link is refused for the founder too, not just the investor", async () => {
    const { grantId, token } = await issueGrant();
    await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, FOUNDER).send({});
    const res = await open(token, FOUNDER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("GRANT_REVOKED");
  });

  it("revoking twice is idempotent and KEEPS the original audit stamp", async () => {
    const { grantId } = await issueGrant();
    const first = await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, FOUNDER).send({});
    const second = await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, FOUNDER).send({});
    expect(second.status).toBe(200);
    expect(second.body.alreadyRevoked).toBe(true);
    expect(second.body.revokedAt).toBe(first.body.revokedAt);
    expect(second.body.revokedBy).toBe(FOUNDER);
  });

  it("only a founder of the OWNING company may withdraw a link", async () => {
    const { grantId, token } = await issueGrant();
    const byStranger = await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, STRANGER).send({});
    expect(byStranger.status).toBe(403);
    const byOtherFounder = await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, OUTSIDE_FOUNDER).send({});
    expect(byOtherFounder.status).toBe(403);
    const byNobody = await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).send({});
    expect(byNobody.status).toBe(401);
    /* And the link is still live, because none of those attempts took effect. */
    expect((await open(token, GRANTEE)).status).toBe(200);
  });

  it("an unknown grant id is a 404, not a silent success", async () => {
    const res = await request(app).post("/api/founder/data-room/grants/drg_nope/revoke").set(H, FOUNDER).send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("GRANT_NOT_FOUND");
  });
});

describe("(C) an expired link still refuses — the old check is not lost", () => {
  it("refuses the rightful grantee once the TTL has passed", async () => {
    /* Expiry is forced by asking for the shortest accepted TTL and MOVING THE
       CLOCK, never by editing the stored row. */
    const short = await issueGrant(1);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000));
    const res = await open(short.token, GRANTEE);
    vi.useRealTimers();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("GRANT_EXPIRED");
  });
});

describe("(D) the issuing route STATES what kind of link it minted", () => {
  it("declares the link non-shareable, names the grantee, and returns a revoke handle", async () => {
    const res = await request(app)
      .post("/api/founder/data-room/grants")
      .set(H, FOUNDER)
      .send({ fileId: FILE_ID, investorId: GRANTEE, ttlMinutes: 30 });
    expect(res.status).toBe(201);
    expect(res.body.shareable).toBe(false);
    expect(res.body.grantee).toBe(GRANTEE);
    expect(res.body.accessStatement).toMatch(/one named investor/i);
    expect(res.body.revokeWith).toContain(`/revoke`);
    /* The pre-existing contract is unchanged, additively. */
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.grantToken).toBe("string");
    expect(typeof res.body.expiresAt).toBe("string");
  });

  it("lists outstanding links for the founder WITHOUT echoing their tokens", async () => {
    const { grantId } = await issueGrant();
    const res = await request(app).get("/api/founder/data-room/grants").query({ fileId: FILE_ID }).set(H, FOUNDER);
    expect(res.status).toBe(200);
    const row = (res.body.grants as Array<Record<string, unknown>>).find((g) => g.grantId === grantId);
    expect(row).toBeTruthy();
    expect(row?.grantee).toBe(GRANTEE);
    expect(row?.state).toBe("live");
    expect(JSON.stringify(res.body)).not.toContain("grantToken");
    /* Not the founder's file → refused. */
    expect((await request(app).get("/api/founder/data-room/grants").query({ fileId: FILE_ID }).set(H, OUTSIDE_FOUNDER)).status).toBe(403);
  });

  it("reports a withdrawn link as revoked in the listing", async () => {
    const { grantId } = await issueGrant();
    await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, FOUNDER).send({});
    const res = await request(app).get("/api/founder/data-room/grants").query({ fileId: FILE_ID }).set(H, FOUNDER);
    const row = (res.body.grants as Array<Record<string, unknown>>).find((g) => g.grantId === grantId);
    expect(row?.state).toBe("revoked");
    expect(typeof row?.revokedAt).toBe("string");
  });
});

describe("(E) the shipped wiring, so this harness cannot hide the real routes", () => {
  it("registers the public read, the revoke and the listing paths", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../track1Routes.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain(`app.get("/api/public/data-room/files/:fileId", handleDataRoomFileGet)`);
    expect(src).toContain(`app.post("/api/founder/data-room/grants/:grantId/revoke", requireAuth, rateLimitMiddleware, handleDataRoomGrantRevoke)`);
    expect(src).toContain(`app.get("/api/founder/data-room/grants", requireAuth, handleDataRoomGrantList)`);
  });
});

describe("(Z) FAIL-BEFORE — the predicate this wave replaced, run against the same fixtures", () => {
  /* The OLD check, verbatim in behaviour: a row for the token, and an expiry in
     the future. Nothing about the caller. Mounted on a scratch path so the two
     answers can be compared side by side in one run. */
  it("the old token-only check serves the document to a stranger AND to a withdrawn link", async () => {
    const { rawDb } = await import("../db/connection");
    const db = rawDb();

    const legacy = express();
    legacy.get("/legacy/:fileId", (req, res) => {
      const token = req.query["grant"] as string;
      const grant = db
        .prepare(`SELECT * FROM data_room_grants WHERE token = ? AND file_id = ?`)
        .get(token, req.params.fileId) as { expires_at: string } | undefined;
      if (!grant) { res.status(403).json({ ok: false, error: "INVALID_GRANT" }); return; }
      if (new Date(grant.expires_at) < new Date()) { res.status(403).json({ ok: false, error: "GRANT_EXPIRED" }); return; }
      res.status(200).json({ ok: true, servedBytes: true });
    });

    const { grantId, token } = await issueGrant();

    /* A stranger — no identity at all — is served by the old predicate. */
    const strangerLegacy = await request(legacy).get(`/legacy/${FILE_ID}`).query({ grant: token });
    expect(strangerLegacy.status).toBe(200);
    expect(strangerLegacy.body.servedBytes).toBe(true);

    /* The SHIPPED route refuses the same two requests while the link is LIVE. */
    expect((await open(token)).status).toBe(401);
    expect((await open(token, STRANGER)).status).toBe(403);

    /* And after the link has been withdrawn, the old predicate still serves it. */
    await request(app).post(`/api/founder/data-room/grants/${grantId}/revoke`).set(H, FOUNDER).send({});
    const revokedLegacy = await request(legacy).get(`/legacy/${FILE_ID}`).query({ grant: token });
    expect(revokedLegacy.status).toBe(200);
    expect(revokedLegacy.body.servedBytes).toBe(true);

    /* The shipped route refuses it for everyone, including its own grantee. */
    expect((await open(token, GRANTEE)).body.error).toBe("GRANT_REVOKED");
    expect((await open(token, FOUNDER)).body.error).toBe("GRANT_REVOKED");
    expect((await open(token)).status).toBe(403);
  });
});
