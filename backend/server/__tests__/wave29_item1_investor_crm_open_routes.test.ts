/**
 * WAVE 29 · ITEM 1 — the six genuinely OPEN `/api/investor/crm` routes.
 *
 * ── HOW THIS ITEM NEARLY WENT WRONG ────────────────────────────────────────
 * Wave 28 §1.6 reported `app.use("/api/investor/crm", gate("investor.hasAnyCapTable"))`
 * as inert for 25 of 25 routes and flagged it as the largest exposure in the
 * tree. It IS inert. But "the gate never runs" and "the route is open" are
 * different claims, and only the second one is a security incident.
 *
 * The first probe written for this wave fired identity-less requests at all 25
 * and got 200s almost everywhere — which reads as a total exposure. It was
 * WRONG. `server/lib/userContext.ts:518 resolvePersonaIdWithFallback` resolves
 * a request with NO identity to the demo persona `u_aisha_patel` whenever
 * NODE_ENV !== "production" and DISABLE_DEV_BYPASS !== "1". The probe was
 * authenticating the caller it believed was anonymous.
 *
 * ── SO EVERY TEST IN THIS FILE PINS ITS OWN IDENTITY MODEL ─────────────────
 * `assertTrulyAnonymous()` below is a CONTROL that runs first: it proves the
 * request really carries no identity by asserting a route with a known,
 * unambiguous per-route auth check refuses it. If the dev-bypass fallback were
 * live, that control fails and every "this route is open" claim in this file is
 * disqualified rather than silently inverted.
 *
 * WAVE 38 ROW 2 — WHY THIS FILE NEVER LOADED, AND WHAT CHANGED.
 * Until Wave 38 the `beforeAll` above asserted `process.env.DISABLE_DEV_BYPASS
 * === "1"` and therefore depended on an ambient environment nobody set. The
 * assertion threw during setup, so all 12 tests were reported SKIPPED and the
 * file produced ZERO assertion records — it failed at RUNNER level, invisible
 * to an assertion-based failure counter, which is how a 122-file runner failure
 * hid behind a 120-file assertion count. `afterAll` then threw a second time on
 * `server.close()` because `server` was never assigned.
 *
 * A test must ESTABLISH its preconditions, never read them out of the
 * environment. This file now SETS `DISABLE_DEV_BYPASS=1` itself in `beforeAll`
 * and restores the previous value in `afterAll`, so it is correct under a bare
 * `npx vitest run` with no wrapper. The env flag is not the proof of anything —
 * control (0a)/(0b) below is: an identity-less request must be REFUSED by a
 * sibling route that has its own auth check, and the same route must ANSWER for
 * a real signed cookie. If the dev-bypass fallback were live, (0a) goes red and
 * every claim in this file is disqualified rather than silently inverted.
 *
 * ── THE FINDING ────────────────────────────────────────────────────────────
 * 19 of the 25 routes already return 401 from their own per-route check. SIX do
 * not, and they are in `server/crmStore.ts`:
 *
 *     GET    /api/investor/crm/notes        no auth check — returns EVERY owner's notes
 *     POST   /api/investor/crm/notes        no auth check — writes, attributed to a hardcoded owner
 *     GET    /api/investor/crm/tasks        no auth check — returns EVERY owner's tasks
 *     POST   /api/investor/crm/tasks        no auth check — writes, attributed to a hardcoded owner
 *     PATCH  /api/investor/crm/tasks/:id    no auth check — mutates ANY task by id
 *     DELETE /api/investor/crm/tasks/:id    no auth check — deletes ANY task by id
 *
 * The reads are not merely unauthenticated, they are UNSCOPED: `getNotes()` /
 * `getTasks()` (crmStore.ts:304-305) return the whole array across all owners,
 * so one investor's diligence notes are readable by anyone, including each
 * other. The writes fell back to a hardcoded `"u_aisha_patel"` owner id.
 *
 * ── BOTH POLES, EVERY CASE ─────────────────────────────────────────────────
 * A fix that 401s everything would pass any "anonymous is refused" test. Every
 * case below therefore also drives a REAL authenticated investor — via a real
 * HMAC-signed `cap_uid` cookie, the only identity channel that survives
 * DISABLE_DEV_BYPASS=1 and the same one a production browser uses — and
 * requires the surface to still work for them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import { _testCrm } from "../crmStore";

let app: Express;
let server: http.Server;

/** Two REAL seeded investor personas — not shims. */
const AISHA = "u_aisha_patel";
const OTHER = "u_admin";

/** Previous ambient value, restored in afterAll so the flag cannot leak. */
let priorDisableDevBypass: string | undefined;

beforeAll(async () => {
  // WAVE 38 ROW 2 — the precondition is ESTABLISHED, not read. `server/lib/
  // userContext.ts:524 resolvePersonaIdWithFallback` reads this flag per
  // request, so setting it here (before the app is built and before any request
  // is fired) is sufficient and needs no runner wrapper. Without it an
  // identity-less request silently resolves to demo persona u_aisha_patel and
  // every refusal assertion below would be measuring a logged-in user.
  priorDisableDevBypass = process.env.DISABLE_DEV_BYPASS;
  process.env.DISABLE_DEV_BYPASS = "1";

  app = express();
  app.use(express.json());
  /* PRODUCTION FIDELITY, not a shim. `server/index.ts:75-94` installs this
   * inline cookie parser on the real app BEFORE registerRoutes; it is the only
   * reason `req.cookies` (and therefore `extractUserIdFromCookie`) works in
   * production at all. It lives outside registerRoutes(), so a harness that
   * calls registerRoutes alone has NO cookie identity channel and every
   * authenticated pole silently degrades to 401 — which is exactly what the
   * first run of this file did, and it would have looked like a passing
   * "anonymous is refused" suite. Mirrored verbatim from index.ts. */
  app.use((req, _res, next) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  // WAVE 38 ROW 2 — guarded. If beforeAll ever throws before `server` is
  // assigned, an unguarded close() throws a SECOND error and the file fails at
  // runner level twice over, which is how the original load failure presented.
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (priorDisableDevBypass === undefined) delete process.env.DISABLE_DEV_BYPASS;
  else process.env.DISABLE_DEV_BYPASS = priorDisableDevBypass;
});

/** Authenticated as a real persona, through the production cookie path. */
function as(userId: string) {
  return (m: "get" | "post" | "patch" | "delete", url: string) =>
    (request(app) as any)[m](url).set(
      "Cookie",
      `${LEGACY_SESSION_COOKIE}=${signSessionValue(userId)}`
    );
}
/** No identity of any kind. */
function anon(m: "get" | "post" | "patch" | "delete", url: string) {
  return (request(app) as any)[m](url);
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTROL — before any claim about an open route, prove the probe is anonymous.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 29 · ITEM 1 — CONTROL: the probe really is unauthenticated", () => {
  it("(0a) a sibling /api/investor/crm route WITH a per-route auth check refuses the anonymous probe — so 'open' below means open", async () => {
    // crmStore.ts:413 — `if (!ctx.isAuthed) return 401`. If the dev-bypass
    // fallback were live this would be 200 and this file's findings would be
    // an artefact of the harness rather than a property of the tree.
    const r = await anon("get", "/api/investor/crm/contacts");
    expect(r.status).toBe(401);
  }, 60_000);

  it("(0b) the SAME route answers 200 for a real signed-cookie identity — so 401 above means 'refused', not 'broken'", async () => {
    const r = await as(AISHA)("get", "/api/investor/crm/contacts");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("contacts");
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   THE EXPOSURE, AND ITS CLOSURE. Each case: anonymous refused AND authenticated
   still works.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 29 · ITEM 1 — the six open crmStore routes are closed, and only closed to anonymous callers", () => {
  it("(1) GET /api/investor/crm/notes — anonymous is refused 401, a real investor still gets their notes", async () => {
    const a = await anon("get", "/api/investor/crm/notes");
    expect(a.status).toBe(401);

    const g = await as(AISHA)("get", "/api/investor/crm/notes");
    expect(g.status).toBe(200);
    expect(Array.isArray(g.body)).toBe(true); // shape preserved — bare array, as before
  }, 60_000);

  it("(2) POST /api/investor/crm/notes — anonymous cannot write, and the refusal writes NOTHING", async () => {
    const before = _testCrm.notes.length;
    const contactId = await firstContactIdFor(AISHA);

    const a = await anon("post", "/api/investor/crm/notes").send({
      contactId,
      body: "W29 anonymous note — must never land",
      noteType: "call",
    });
    expect(a.status).toBe(401);
    // The sink, read independently: a 401 that still inserted would be worse
    // than no fix at all.
    expect(_testCrm.notes.length).toBe(before);
    expect(_testCrm.notes.some((n) => n.body.includes("must never land"))).toBe(false);

    // LOWER POLE — the real investor can still write, and the row really lands.
    const ok = await as(AISHA)("post", "/api/investor/crm/notes").send({
      contactId,
      body: "W29 authorised note",
      noteType: "call",
    });
    expect(ok.status).toBe(200);
    expect(_testCrm.notes.some((n) => n.body === "W29 authorised note")).toBe(true);
  }, 60_000);

  it("(3) GET /api/investor/crm/tasks — anonymous refused, real investor served", async () => {
    const a = await anon("get", "/api/investor/crm/tasks");
    expect(a.status).toBe(401);

    const g = await as(AISHA)("get", "/api/investor/crm/tasks");
    expect(g.status).toBe(200);
    expect(Array.isArray(g.body)).toBe(true);
  }, 60_000);

  it("(4) POST /api/investor/crm/tasks — anonymous cannot write; authorised write lands", async () => {
    const before = _testCrm.tasks.length;
    const contactId = await firstContactIdFor(AISHA);

    const a = await anon("post", "/api/investor/crm/tasks").send({
      contactId,
      title: "W29 anonymous task — must never land",
      priority: "high",
      status: "todo",
    });
    expect(a.status).toBe(401);
    expect(_testCrm.tasks.length).toBe(before);

    const ok = await as(AISHA)("post", "/api/investor/crm/tasks").send({
      contactId,
      title: "W29 authorised task",
      priority: "high",
      status: "todo",
    });
    expect(ok.status).toBe(200);
    expect(_testCrm.tasks.some((t) => t.title === "W29 authorised task")).toBe(true);
  }, 60_000);

  it("(5) PATCH /api/investor/crm/tasks/:id — an anonymous caller cannot mutate a REAL task, and the task is unchanged afterwards", async () => {
    const contactId = await firstContactIdFor(AISHA);
    const created = await as(AISHA)("post", "/api/investor/crm/tasks").send({
      contactId,
      title: "W29 patch target",
      priority: "low",
      status: "todo",
    });
    const id = created.body.task.id;

    const a = await anon("patch", `/api/investor/crm/tasks/${id}`).send({ status: "done" });
    expect(a.status).toBe(401);
    // Read the SINK, not the response: the task must still be todo.
    expect(_testCrm.tasks.find((t) => t.id === id)?.status).toBe("todo");

    // LOWER POLE — the owner can still complete it.
    const ok = await as(AISHA)("patch", `/api/investor/crm/tasks/${id}`).send({ status: "done" });
    expect(ok.status).toBe(200);
    expect(_testCrm.tasks.find((t) => t.id === id)?.status).toBe("done");
  }, 60_000);

  it("(6) DELETE /api/investor/crm/tasks/:id — an anonymous caller cannot delete a REAL task; the owner can", async () => {
    const contactId = await firstContactIdFor(AISHA);
    const created = await as(AISHA)("post", "/api/investor/crm/tasks").send({
      contactId,
      title: "W29 delete target",
      priority: "low",
      status: "todo",
    });
    const id = created.body.task.id;

    const a = await anon("delete", `/api/investor/crm/tasks/${id}`);
    expect(a.status).toBe(401);
    expect(_testCrm.tasks.some((t) => t.id === id)).toBe(true); // still there

    const ok = await as(AISHA)("delete", `/api/investor/crm/tasks/${id}`);
    expect(ok.status).toBe(200);
    expect(_testCrm.tasks.some((t) => t.id === id)).toBe(false);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SECOND PATH (Rule 2). Authentication was only half the defect: the reads
   were also UNSCOPED. Closing the door without scoping the room would leave
   every logged-in investor able to read every other investor's notes.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 29 · ITEM 1 — the SECOND path: notes and tasks are scoped to the caller's own contacts", () => {
  it("(7) one investor's note is NOT visible to a different authenticated investor — and IS visible to its owner", async () => {
    const contactId = await firstContactIdFor(AISHA);
    const marker = `W29 tenant marker ${Date.now()}`;
    const w = await as(AISHA)("post", "/api/investor/crm/notes").send({
      contactId,
      body: marker,
      noteType: "call",
    });
    expect(w.status).toBe(200);

    // POSITIVE POLE FIRST: the owner really can see it. Without this, the
    // negative pole below is satisfied by a route that returns [] to everyone.
    const mine = await as(AISHA)("get", "/api/investor/crm/notes");
    expect(mine.status).toBe(200);
    expect((mine.body as Array<{ body: string }>).some((n) => n.body === marker)).toBe(true);

    // NEGATIVE POLE: a different real identity must not see it.
    const theirs = await as(OTHER)("get", "/api/investor/crm/notes");
    expect(theirs.status).toBe(200);
    expect((theirs.body as Array<{ body: string }>).some((n) => n.body === marker)).toBe(false);
  }, 60_000);

  it("(8) the same for tasks — owner sees it, a different investor does not", async () => {
    const contactId = await firstContactIdFor(AISHA);
    const marker = `W29 task marker ${Date.now()}`;
    const w = await as(AISHA)("post", "/api/investor/crm/tasks").send({
      contactId,
      title: marker,
      priority: "low",
      status: "todo",
    });
    expect(w.status).toBe(200);

    const mine = await as(AISHA)("get", "/api/investor/crm/tasks");
    expect((mine.body as Array<{ title: string }>).some((t) => t.title === marker)).toBe(true);

    const theirs = await as(OTHER)("get", "/api/investor/crm/tasks");
    expect(theirs.status).toBe(200);
    expect((theirs.body as Array<{ title: string }>).some((t) => t.title === marker)).toBe(false);
  }, 60_000);

  it("(9) a different investor cannot PATCH or DELETE a task belonging to someone else's contact — 404, and the task survives", async () => {
    const contactId = await firstContactIdFor(AISHA);
    const created = await as(AISHA)("post", "/api/investor/crm/tasks").send({
      contactId,
      title: "W29 cross-tenant target",
      priority: "low",
      status: "todo",
    });
    const id = created.body.task.id;

    const p = await as(OTHER)("patch", `/api/investor/crm/tasks/${id}`).send({ status: "done" });
    expect(p.status).toBe(404); // not 403 — no existence oracle
    expect(_testCrm.tasks.find((t) => t.id === id)?.status).toBe("todo");

    const d = await as(OTHER)("delete", `/api/investor/crm/tasks/${id}`);
    expect(d.status).toBe(404);
    expect(_testCrm.tasks.some((t) => t.id === id)).toBe(true);

    // LOWER POLE — the real owner is still able to do both.
    expect((await as(AISHA)("patch", `/api/investor/crm/tasks/${id}`).send({ status: "done" })).status).toBe(200);
    expect((await as(AISHA)("delete", `/api/investor/crm/tasks/${id}`)).status).toBe(200);
  }, 60_000);

  it("(10) the hardcoded `u_aisha_patel` owner fallback is GONE from the write path — a note written by another investor is attributed to THEM", async () => {
    // crmStore.ts previously did `const ownerId = ctx.isAuthed ? ctx.userId : "u_aisha_patel"`.
    // That is a hardcoded tenant id on a write path. The proof it is gone is
    // behavioural: OTHER writes a note against OTHER's own contact and AISHA
    // must not see it.
    const otherContact = await firstContactIdFor(OTHER);
    const marker = `W29 attribution ${Date.now()}`;
    const w = await as(OTHER)("post", "/api/investor/crm/notes").send({
      contactId: otherContact,
      body: marker,
      noteType: "call",
    });
    expect(w.status).toBe(200);

    const theirs = await as(OTHER)("get", "/api/investor/crm/notes");
    expect((theirs.body as Array<{ body: string }>).some((n) => n.body === marker)).toBe(true);

    const aisha = await as(AISHA)("get", "/api/investor/crm/notes");
    expect((aisha.body as Array<{ body: string }>).some((n) => n.body === marker)).toBe(false);
  }, 60_000);
});

/** A real contact id owned by `userId`, created through the real route if the
 *  persona has none. Never a literal — the fixture must not invent tenancy. */
async function firstContactIdFor(userId: string): Promise<string> {
  const list = await as(userId)("get", "/api/investor/crm/contacts");
  const existing = (list.body?.contacts ?? []) as Array<{ id: string }>;
  if (existing.length > 0) return existing[0].id;
  const made = await as(userId)("post", "/api/investor/crm/contacts").send({
    name: `W29 fixture contact ${userId}`,
    kind: "founder",
    pipelineStage: "lead",
  });
  const id = made.body?.contact?.id ?? made.body?.id;
  if (!id) throw new Error(`fixture could not create a contact for ${userId}: ${made.status} ${made.text?.slice(0, 200)}`);
  return id;
}
