/**
 * WAVE 189 · ITEM B · R159.6 — LP THREADS ARE A FIRM RECORD, AND THE FENCE HOLDS.
 * ══════════════════════════════════════════════════════════════════════════════
 * Owner: *"Team-visible. Go with your recommendation and global investor grade best
 * practice."*
 *
 * THIS FILE IS DELIBERATELY MOSTLY NEGATIVE. The brief is unambiguous: *"THE FENCE IS
 * NON-NEGOTIABLE. This widens who can read a conversation. It must widen ONLY to
 * active members of the SAME partner organisation — never another partner's team,
 * never a founder, never another LP."* A widening is trivial to implement and trivial
 * to over-implement, and an over-implementation passes every happy-path test. So the
 * happy path is proved once per read route to show the fixture is real, and everything
 * else here is an attempt to get through the fence.
 *
 * THE FIXTURE, STATED AS A SENTENCE.
 *   PARTNER ORG ALPHA — principal `u_w189_alpha_gp`, active colleague
 *                       `u_w189_alpha_mate`, REMOVED former colleague
 *                       `u_w189_alpha_gone`.
 *   PARTNER ORG BRAVO — principal `u_w189_bravo_gp` (an active member of a
 *                       DIFFERENT organisation: the cross-organisation control).
 *   LP ALPHA          — `u_w189_lp_a`, in a thread with ALPHA's principal.
 *   LP BRAVO          — `u_w189_lp_b`, in a thread with BRAVO's principal.
 *   A FOUNDER         — `u_w189_founder`, in a thread with ALPHA's principal
 *                       (proves the widening does NOT reach non-LP threads).
 *   AN UNAFFILIATED   — `u_w189_nobody`, member of no organisation at all.
 *
 * ANTI-VACUITY, APPLIED THROUGHOUT. For every person proved UNABLE to read, the test
 * ALSO proves that SOMEONE can read the very same thread through the very same route.
 * Otherwise a refusal could be a broken fixture rather than the fence holding — the
 * distinction that actually matters.
 *
 * THE THREE READ ROUTES ARE ALL EXERCISED. `GET /api/messages?thread_id=`,
 * `GET /api/messages/threads` and `GET /api/messages/threads/:id`. A fence that holds
 * on two of three is not a fence. The WRITE routes are asserted to be UNCHANGED:
 * reading the firm's record is the ruling, speaking as the firm is not.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
import { registerMessagingRoutes } from "../messagingStore";
/* WAVE 189 · ITEM B — the widening lives in a NON-SACRED pre-router, because
   `server/messagingStore.ts` is a frozen file (R121). The test app registers the two
   in the SAME ORDER production does, so what is exercised here is what ships. */
import { registerPartnerLpThreadVisibilityRoutes } from "../partnerLpThreadVisibilityRoutes";
import {
  mayPartnerOrgReadLpThread,
  lpThreadIsVisibleToAPartnerFirm,
} from "../lib/partnerLpThreadVisibility";
import {
  LP_THREAD_FIRM_VISIBILITY_HEADLINE,
  LP_THREAD_FIRM_VISIBILITY_BODY,
  LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM,
} from "../../shared/lpThreadFirmVisibilityCopy";
import { resolvePartnerIdForUser } from "../lib/partnerDelegatedContext";
import { resolveDmRole } from "../messagingPolicy";

/* ── the cast ─────────────────────────────────────────────────────────────── */
const ALPHA_ORG = "porg_w189_alpha";
const BRAVO_ORG = "porg_w189_bravo";
const ALPHA_GP = "u_w189_alpha_gp";
const ALPHA_MATE = "u_w189_alpha_mate";
const ALPHA_GONE = "u_w189_alpha_gone";
const ALPHA_INACTIVE = "u_w189_alpha_inactive";
const BRAVO_GP = "u_w189_bravo_gp";
const LP_A = "u_w189_lp_a";
const LP_B = "u_w189_lp_b";
const FOUNDER = "u_w189_founder";
const NOBODY = "u_w189_nobody";

const THREAD_ALPHA_LP = "th_w189_alpha_lp";
const THREAD_BRAVO_LP = "th_w189_bravo_lp";
const THREAD_ALPHA_FOUNDER = "th_w189_alpha_founder";
const MSG_ALPHA_LP = "msg_w189_alpha_lp";

let app: Express;

const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w189 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w189.test`,
    id,
    role,
  );
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w189.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the documented fallback. */
  }
  /* A `user_credentials` row is what makes `requireAuth` actually authenticate.
     `getUserContextForId` misses both persona caches for a user seeded AFTER boot and
     falls back to `lookupByUserId`, which reads THIS table; without a row the context
     is `isAuthed: false` and every route answers 401 regardless of the fence. The
     password hash is a fixed non-secret placeholder — nothing in this file logs in
     with a password, only with the Vitest-only `x-user-id` header path. */
  run(
    `INSERT OR REPLACE INTO user_credentials
       (user_id, email, name, password_hash, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, 'w189-not-a-real-hash', ?, ?, NULL)`,
    id,
    `${id}@w189.test`,
    id,
    now(),
    now(),
  );
}

function seedTeamMember(org: string, user: string, status: "active" | "removed" | "inactive"): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', ?, ?, ?, 'u_w189', 0, ?)`,
    `ptm_${org}_${user}`,
    org,
    user,
    status === "inactive" ? "inactive" : status,
    now(),
    status === "removed" ? now() : null,
    now(),
  );
}

function seedThread(id: string, participants: string[], creator: string): void {
  run(
    `INSERT OR REPLACE INTO message_threads
       (id, tenant_id, chapter_id, title, participant_user_ids, last_message_id,
        last_activity_at, created_by_user_id, prev_hash, curr_hash,
        created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', NULL, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL)`,
    id,
    `W189 ${id}`,
    JSON.stringify(participants),
    now(),
    creator,
    `hash_${id}`,
    now(),
    now(),
  );
}

function seedMessage(id: string, threadId: string, sender: string, recipients: string[]): void {
  run(
    /* `channel_type` is NOT NULL with no default on this table — the fixture states
       it rather than relying on a default that does not exist. */
    `INSERT OR REPLACE INTO messages
       (id, tenant_id, channel_type, thread_id, chapter_id, sender_user_id,
        recipient_user_ids, subject, body, status, read_by, prev_hash, curr_hash,
        created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', 'dm', ?, NULL, ?, ?, ?, ?, 'sent', '[]', NULL, ?, ?, ?, NULL)`,
    id,
    threadId,
    sender,
    JSON.stringify(recipients),
    `W189 subject ${id}`,
    `W189 body ${id}`,
    `hash_${id}`,
    now(),
    now(),
  );
}

const asUser = (r: request.Test, id: string, role = "partner") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

beforeAll(() => {
  app = express();
  app.use(express.json());
  /* `defaultIdentity: false` — WITHOUT this the harness hands an ANONYMOUS request a
     fallback `u_admin_test` ADMIN identity, and an admin passes `isPlatformAdmin`, so
     the anonymous-access test would have proved nothing. Every request in this file
     names its caller explicitly, so nothing else needs the fallback. */
  installV14TestIdentity(app, { defaultIdentity: false });
  /* ORDER IS THE CONTRACT. Express dispatches in registration order, so the
     pre-router must come FIRST or every widened read falls through to the sacred
     handler's 403 and this file goes red. */
  registerPartnerLpThreadVisibilityRoutes(app);
  registerMessagingRoutes(app);

  seedUser(ALPHA_GP, "partner");
  seedUser(ALPHA_MATE, "partner");
  seedUser(ALPHA_GONE, "partner");
  seedUser(ALPHA_INACTIVE, "partner");
  seedUser(BRAVO_GP, "partner");
  seedUser(LP_A, "investor");
  seedUser(LP_B, "investor");
  seedUser(FOUNDER, "founder");
  seedUser(NOBODY, "investor");

  seedTeamMember(ALPHA_ORG, ALPHA_GP, "active");
  seedTeamMember(ALPHA_ORG, ALPHA_MATE, "active");
  seedTeamMember(ALPHA_ORG, ALPHA_GONE, "removed");
  seedTeamMember(ALPHA_ORG, ALPHA_INACTIVE, "inactive");
  seedTeamMember(BRAVO_ORG, BRAVO_GP, "active");

  seedThread(THREAD_ALPHA_LP, [ALPHA_GP, LP_A], ALPHA_GP);
  seedThread(THREAD_BRAVO_LP, [BRAVO_GP, LP_B], BRAVO_GP);
  seedThread(THREAD_ALPHA_FOUNDER, [ALPHA_GP, FOUNDER], ALPHA_GP);
  seedMessage(MSG_ALPHA_LP, THREAD_ALPHA_LP, ALPHA_GP, [LP_A]);
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 0 — THE FIXTURE IS REAL. An isolation proof over a broken fixture is
   vacuous, so the resolvers are asserted BEFORE anything is refused.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 0 — anti-vacuity: the fixture is real", () => {
  it("both organisations resolve, and they are DIFFERENT organisations", () => {
    expect(resolvePartnerIdForUser(ALPHA_GP)).toBe(ALPHA_ORG);
    expect(resolvePartnerIdForUser(ALPHA_MATE)).toBe(ALPHA_ORG);
    expect(resolvePartnerIdForUser(BRAVO_GP)).toBe(BRAVO_ORG);
    expect(ALPHA_ORG).not.toBe(BRAVO_ORG);
  });

  it("a REMOVED and an INACTIVE member resolve to NO organisation — the membership idiom is doing the work", () => {
    expect(resolvePartnerIdForUser(ALPHA_GONE)).toBeNull();
    expect(resolvePartnerIdForUser(ALPHA_INACTIVE)).toBeNull();
    /* And their rows genuinely EXIST — so the null is the status filter, not a
       missing fixture row. */
    const gone = rawDb()
      .prepare(`SELECT partner_id, status FROM partner_team_members WHERE user_id = ?`)
      .get(ALPHA_GONE) as { partner_id?: string; status?: string } | undefined;
    expect(gone?.partner_id).toBe(ALPHA_ORG);
    const inactive = rawDb()
      .prepare(`SELECT partner_id, status FROM partner_team_members WHERE user_id = ?`)
      .get(ALPHA_INACTIVE) as { partner_id?: string; status?: string } | undefined;
    expect(inactive?.partner_id).toBe(ALPHA_ORG);
  });

  it("the LPs are investors by durable record and the founder is not", () => {
    expect(resolveDmRole(LP_A)).toBe("investor");
    expect(resolveDmRole(LP_B)).toBe("investor");
    expect(resolveDmRole(FOUNDER)).not.toBe("investor");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 1 — THE PREDICATE. Unit-level, so a failure names the clause.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 1 — the predicate", () => {
  const alphaLpThread = { participantUserIds: [ALPHA_GP, LP_A] };
  const bravoLpThread = { participantUserIds: [BRAVO_GP, LP_B] };
  const founderThread = { participantUserIds: [ALPHA_GP, FOUNDER] };

  it("GRANTS an ACTIVE colleague of the SAME organisation", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, ALPHA_MATE)).toBe(true);
  });

  it("REFUSES another partner organisation's active team member — THE CROSS-ORG FENCE", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, BRAVO_GP)).toBe(false);
    /* BOTH DIRECTIONS. A one-directional test passes against an implementation
       that leaks the other way. */
    expect(mayPartnerOrgReadLpThread(bravoLpThread, ALPHA_GP)).toBe(false);
    expect(mayPartnerOrgReadLpThread(bravoLpThread, ALPHA_MATE)).toBe(false);
  });

  it("REFUSES a REMOVED former team member of the correct organisation", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, ALPHA_GONE)).toBe(false);
  });

  it("REFUSES an INACTIVE team member of the correct organisation", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, ALPHA_INACTIVE)).toBe(false);
  });

  it("REFUSES a founder", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, FOUNDER)).toBe(false);
  });

  it("REFUSES another LP", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, LP_B)).toBe(false);
    expect(mayPartnerOrgReadLpThread(bravoLpThread, LP_A)).toBe(false);
  });

  it("REFUSES an account affiliated with nobody", () => {
    expect(mayPartnerOrgReadLpThread(alphaLpThread, NOBODY)).toBe(false);
  });

  it("REFUSES a NON-LP thread even for a same-organisation colleague — clause 3", () => {
    /* The owner ruled on LP communication. A partner-to-founder thread is not
       widened, because widening it is a privacy change nobody asked for. */
    expect(mayPartnerOrgReadLpThread(founderThread, ALPHA_MATE)).toBe(false);
  });

  it("REFUSES a partner-internal thread with no investor in it", () => {
    expect(mayPartnerOrgReadLpThread({ participantUserIds: [ALPHA_GP, ALPHA_MATE] }, ALPHA_MATE))
      .toBe(false);
  });

  it("FAILS CLOSED on junk input rather than throwing or granting", () => {
    for (const bad of [null, undefined, "", "   "]) {
      expect(mayPartnerOrgReadLpThread(alphaLpThread, bad as string)).toBe(false);
    }
    expect(mayPartnerOrgReadLpThread(null, ALPHA_MATE)).toBe(false);
    expect(mayPartnerOrgReadLpThread(undefined, ALPHA_MATE)).toBe(false);
    expect(mayPartnerOrgReadLpThread({ participantUserIds: [] }, ALPHA_MATE)).toBe(false);
    expect(mayPartnerOrgReadLpThread({ participantUserIds: null as any }, ALPHA_MATE)).toBe(false);
  });

  it("does NOT satisfy the org clause against the CALLER THEMSELVES", () => {
    /* A lone partner participant must not 'widen' to nobody while reporting a
       widening: their own access comes from the untouched participant check. */
    expect(mayPartnerOrgReadLpThread(alphaLpThread, ALPHA_GP)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 2 — ROUTE LEVEL. All THREE read routes, granted and refused.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 2 — route level: GET /api/messages?thread_id=", () => {
  it("ANTI-VACUITY: the named participant can read it (the route works at all)", async () => {
    const r = await asUser(
      request(app).get(`/api/messages?thread_id=${THREAD_ALPHA_LP}`),
      ALPHA_GP,
    );
    expect(r.status).toBe(200);
    expect((r.body.messages as any[]).length).toBeGreaterThan(0);
  });

  it("GRANTS the same-organisation active colleague — the widening actually works", async () => {
    const r = await asUser(
      request(app).get(`/api/messages?thread_id=${THREAD_ALPHA_LP}`),
      ALPHA_MATE,
    );
    expect(r.status).toBe(200);
    expect((r.body.messages as any[]).map((m) => m.id)).toContain(MSG_ALPHA_LP);
  });

  it("REFUSES another partner's team member with 403 — THE ADVERSARIAL CROSS-ORG READ", async () => {
    const r = await asUser(
      request(app).get(`/api/messages?thread_id=${THREAD_ALPHA_LP}`),
      BRAVO_GP,
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_THREAD_PARTICIPANT");
    /* AND NO CONTENT LEAKED IN THE REFUSAL BODY. */
    expect(JSON.stringify(r.body)).not.toContain("W189 body");
  });

  it("REFUSES a removed member, an inactive member, a founder, another LP and an unaffiliated account", async () => {
    for (const who of [ALPHA_GONE, ALPHA_INACTIVE, FOUNDER, LP_B, NOBODY]) {
      const r = await asUser(
        request(app).get(`/api/messages?thread_id=${THREAD_ALPHA_LP}`),
        who,
      );
      expect(r.status, `expected 403 for ${who}`).toBe(403);
    }
  });

  it("REFUSES the same-organisation colleague on a NON-LP thread", async () => {
    const r = await asUser(
      request(app).get(`/api/messages?thread_id=${THREAD_ALPHA_FOUNDER}`),
      ALPHA_MATE,
    );
    expect(r.status).toBe(403);
  });
});

describe("wave 189 · item B · group 2 — route level: GET /api/messages/threads", () => {
  it("the colleague SEES the LP thread listed (without this the widening is unusable)", async () => {
    const r = await asUser(request(app).get("/api/messages/threads"), ALPHA_MATE);
    expect(r.status).toBe(200);
    expect((r.body.threads as any[]).map((t) => t.id)).toContain(THREAD_ALPHA_LP);
  });

  it("the colleague does NOT see another organisation's LP thread, and does NOT see the founder thread", async () => {
    const r = await asUser(request(app).get("/api/messages/threads"), ALPHA_MATE);
    const ids = (r.body.threads as any[]).map((t) => t.id);
    expect(ids).not.toContain(THREAD_BRAVO_LP);
    expect(ids).not.toContain(THREAD_ALPHA_FOUNDER);
  });

  it("BOTH DIRECTIONS: BRAVO's principal never sees ALPHA's LP thread", async () => {
    const r = await asUser(request(app).get("/api/messages/threads"), BRAVO_GP);
    const ids = (r.body.threads as any[]).map((t) => t.id);
    expect(ids).toContain(THREAD_BRAVO_LP); /* anti-vacuity: they see their own */
    expect(ids).not.toContain(THREAD_ALPHA_LP);
  });

  it("a removed member, an inactive member, a founder and another LP see no ALPHA LP thread", async () => {
    for (const who of [ALPHA_GONE, ALPHA_INACTIVE, FOUNDER, LP_B, NOBODY]) {
      const r = await asUser(request(app).get("/api/messages/threads"), who);
      const ids = (r.body.threads as any[]).map((t) => t.id);
      expect(ids, `leak to ${who}`).not.toContain(THREAD_ALPHA_LP);
    }
  });

  it("the LP still sees their OWN thread — nobody lost access", async () => {
    const r = await asUser(request(app).get("/api/messages/threads"), LP_A, "investor");
    expect((r.body.threads as any[]).map((t) => t.id)).toContain(THREAD_ALPHA_LP);
  });
});

describe("wave 189 · item B · group 2 — route level: GET /api/messages/threads/:id", () => {
  it("GRANTS the same-organisation active colleague", async () => {
    const r = await asUser(
      request(app).get(`/api/messages/threads/${THREAD_ALPHA_LP}`),
      ALPHA_MATE,
    );
    expect(r.status).toBe(200);
  });

  it("REFUSES another partner's team member — CROSS-ORG, ON THE DETAIL ROUTE TOO", async () => {
    const r = await asUser(
      request(app).get(`/api/messages/threads/${THREAD_ALPHA_LP}`),
      BRAVO_GP,
    );
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("W189 body");
  });

  it("REFUSES a removed member, an inactive member, a founder, another LP and an unaffiliated account", async () => {
    for (const who of [ALPHA_GONE, ALPHA_INACTIVE, FOUNDER, LP_B, NOBODY]) {
      const r = await asUser(
        request(app).get(`/api/messages/threads/${THREAD_ALPHA_LP}`),
        who,
      );
      expect(r.status, `expected 403 for ${who}`).toBe(403);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 3 — WRITES ARE UNCHANGED. Reading the firm's record is the ruling.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 3 — the widening is READ-ONLY", () => {
  it("the colleague who can READ the thread CANNOT post into it", async () => {
    const r = await asUser(
      request(app)
        .post("/api/messages")
        /* The route's own field names (`thread_id`, `recipients`) — a payload the
           schema ACCEPTS, so the request reaches the participant check rather than
           being turned away as malformed. A 400 here would have proved nothing about
           the fence. */
        .send({ thread_id: THREAD_ALPHA_LP, recipients: [LP_A], body: "w189 intrusion" }),
      ALPHA_MATE,
    );
    expect(r.status).toBe(403);
  });

  it("THE SACRED FILE IS UNTOUCHED — the widening references it, it does not live in it", async () => {
    /* THE MISTAKE THIS TEST EXISTS TO PREVENT FROM RECURRING. The first cut of this
       item edited the three read handlers inside `server/messagingStore.ts`, which is
       a SACRED file; `npm run sacred` went red (DRIFTED: expected 17bd5608…) and the
       edit had to be reverted byte-for-byte. R121 is absolute: fix from non-sacred
       code, never seek a tenth waiver. So the fence is asserted to be ABSENT from the
       frozen file and PRESENT in the pre-router. */
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");

    const sacred = readFileSync("server/messagingStore.ts");
    expect(createHash("sha256").update(sacred).digest("hex"))
      .toBe("17bd56080b6af4a71ea0ac1f7e4023e1fc8ef64c8d00b9670d5d90ae19b3c392");
    expect(sacred.toString("utf8")).not.toContain("mayPartnerOrgReadLpThread");
    expect(sacred.toString("utf8")).not.toContain("lp-firm-visibility");
    expect(sacred.toString("utf8")).not.toContain("WAVE 189");
  });

  it("the pre-router consults the fence on exactly the three READ paths and on no write path", async () => {
    /* A structural assertion, because a future wave could wire this into a write path
       by accident and every behavioural test above would still pass. Comments are
       stripped first so a mention in prose cannot be counted as a call. */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/partnerLpThreadVisibilityRoutes.ts", "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* Verify the stripper actually stripped, per the standing rule. */
    expect(stripped.length).toBeLessThan(src.length);
    expect(stripped).not.toContain("READ PATH 1 of 3");

    const calls = stripped.split("mayPartnerOrgReadLpThread(").length - 1;
    /* FOUR call sites, not three: read path 2 asks TWICE — once to decide whether
       intercepting would change the answer at all, once to build the list. */
    expect(calls).toBe(4);

    /* AND NOT ONE WRITE VERB IS INTERCEPTED. */
    expect(stripped).not.toMatch(/app\.(post|patch|put|delete)\s*\(/);
    const gets = stripped.split(/app\.get\s*\(/).length - 1;
    expect(gets).toBe(4); /* the three read paths + the LP disclosure endpoint */
  });

  it("routes.ts registers the pre-router BEFORE the sacred store — order is the contract", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/routes.ts", "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(stripped.length).toBeLessThan(src.length);

    const pre = stripped.indexOf("registerPartnerLpThreadVisibilityRoutes(app)");
    const sacredReg = stripped.indexOf("registerMessagingRoutes(app)");
    expect(pre).toBeGreaterThan(-1);
    expect(sacredReg).toBeGreaterThan(-1);
    /* If this inverts, every widened read becomes unreachable and the ruling
       silently does nothing while all the unit tests still pass. */
    expect(pre).toBeLessThan(sacredReg);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 4 — THE DISCLOSURE. R159.6 clause 3: "Tell the LP."
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 4 — the LP is told", () => {
  it("the LP's own endpoint reports visible:true when a partner firm IS on the other side", async () => {
    const r = await asUser(
      request(app).get("/api/messages/lp-firm-visibility"),
      LP_A,
      "investor",
    );
    expect(r.status).toBe(200);
    expect(r.body.visible).toBe(true);
    expect(Array.isArray(r.body.firmNames)).toBe(true);
  });

  it("it reports visible:false for someone with no partner-firm thread — the notice is never a false statement", async () => {
    const r = await asUser(
      request(app).get("/api/messages/lp-firm-visibility"),
      NOBODY,
      "investor",
    );
    expect(r.status).toBe(200);
    expect(r.body.visible).toBe(false);
  });

  it("it DISCLOSES NOTHING BEYOND THE ANSWER: no thread ids, no participant ids, no message bodies", async () => {
    const r = await asUser(
      request(app).get("/api/messages/lp-firm-visibility"),
      LP_A,
      "investor",
    );
    const body = JSON.stringify(r.body);
    expect(body).not.toContain(THREAD_ALPHA_LP);
    expect(body).not.toContain(ALPHA_GP);
    expect(body).not.toContain("W189 body");
    expect(Object.keys(r.body).sort()).toEqual(["firmNames", "visible"]);
  });

  it("it is SELF-SCOPED — LP_B's answer is about LP_B's own threads, never LP_A's", async () => {
    const r = await asUser(
      request(app).get("/api/messages/lp-firm-visibility"),
      LP_B,
      "investor",
    );
    expect(r.status).toBe(200);
    /* LP_B does have a partner thread of their OWN, so true is correct here — and
       the payload still names nothing belonging to ALPHA. */
    expect(r.body.visible).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(ALPHA_ORG);
  });

  /* WHAT THIS TEST DOES *NOT* PROVE, STATED RATHER THAN QUIETLY DROPPED.
     An anonymous request to this endpoint returns 200 in the test process, and that is
     NOT a defect in this endpoint. `resolvePersonaIdWithFallback` in
     `server/lib/userContext.ts` hands anonymous requests a DEMO persona whenever
     `NODE_ENV !== "production"` and `DISABLE_DEV_BYPASS !== "1"` — a platform-wide dev
     convenience that predates this wave and applies to every `requireAuth` route
     equally. So an anonymous 401 cannot be demonstrated from a test process without
     changing that global env, which is outside this wave's scope and would alter the
     verdicts of unrelated suites.
     What CAN be proved, and is proved here, is that this endpoint is mounted behind the
     SAME guard as every other messaging read route and derives its answer from the
     CALLER, so it cannot be aimed at somebody else. The self-scoping tests above are
     the substantive protection; this one pins the guard. */
  it("is mounted behind requireAuth, exactly like the other messaging read routes", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/partnerLpThreadVisibilityRoutes.ts", "utf8");
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* Verify the stripper actually stripped, per the standing rule. */
    expect(stripped.length).toBeLessThan(src.length);
    expect(stripped).not.toContain("TELL THE LP");
    expect(stripped).toContain(
      'app.get("/api/messages/lp-firm-visibility", requireAuth,',
    );
  });

  it("answers about the CALLER only — there is no parameter that could aim it at another user", async () => {
    /* An attempt to ask about LP_A while authenticated as NOBODY, through every
       plausible parameter name. The answer must stay NOBODY's answer (false). */
    for (const qs of [
      `?userId=${LP_A}`,
      `?user_id=${LP_A}`,
      `?investorUserId=${LP_A}`,
      `?as=${LP_A}`,
    ]) {
      const r = await asUser(
        request(app).get(`/api/messages/lp-firm-visibility${qs}`),
        NOBODY,
        "investor",
      );
      expect(r.status).toBe(200);
      expect(r.body.visible, `leaked via ${qs}`).toBe(false);
    }
  });

  it("the underlying helper agrees with the route, and refuses a non-participant asker", () => {
    const t = { participantUserIds: [ALPHA_GP, LP_A] };
    expect(lpThreadIsVisibleToAPartnerFirm(t, LP_A).visible).toBe(true);
    expect(lpThreadIsVisibleToAPartnerFirm(t, LP_B).visible).toBe(false);
    expect(lpThreadIsVisibleToAPartnerFirm(t, NOBODY).visible).toBe(false);
    expect(lpThreadIsVisibleToAPartnerFirm(null, LP_A).visible).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   GROUP 5 — THE COPY. Plain language, an honest limit, and no code on screen.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B · group 5 — the disclosure copy", () => {
  it("states WHO can read it and, in the same breath, WHO CANNOT", () => {
    expect(LP_THREAD_FIRM_VISIBILITY_BODY).toContain("Active members of that firm's team can read");
    expect(LP_THREAD_FIRM_VISIBILITY_BODY).toContain("not another partner firm");
    expect(LP_THREAD_FIRM_VISIBILITY_BODY).toContain("not a founder");
    expect(LP_THREAD_FIRM_VISIBILITY_BODY).toContain("not another investor");
  });

  it("answers what happens when someone leaves the team", () => {
    expect(LP_THREAD_FIRM_VISIBILITY_BODY).toContain("left the firm's team loses access");
  });

  it("is plain language: no ALL-CAPS underscore code, no jargon, no table or column names", () => {
    for (const s of [
      LP_THREAD_FIRM_VISIBILITY_HEADLINE,
      LP_THREAD_FIRM_VISIBILITY_BODY,
      LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM,
    ]) {
      expect(s).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
      expect(s).not.toMatch(/partner_team_members|participantUserIds|removed_at/);
      expect(s.trim()).toBe(s);
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it("names no individual — the point of the ruling is that the record is not one person's", () => {
    for (const s of [LP_THREAD_FIRM_VISIBILITY_HEADLINE, LP_THREAD_FIRM_VISIBILITY_BODY]) {
      expect(s).not.toContain("u_w189");
      expect(s).not.toContain("@");
    }
  });

  it("the unnamed-firm fallback is a stated phrase, never a blank", () => {
    expect(LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM.trim().length).toBeGreaterThan(10);
  });
});
