/**
 * Sprint 20 Wave 2 — Investor UX endpoint tests.
 *
 * Covers all new endpoints introduced in Wave 2 (defects O & P):
 *
 *  Investor CRM (investorCrmStore):
 *   - GET  /api/investor/crm/contacts          (list)
 *   - POST /api/investor/crm/contacts          (create)
 *   - PATCH /api/investor/crm/contacts/:id     (update)
 *   - DELETE /api/investor/crm/contacts/:id    (delete)
 *
 *  Collective network (collectiveNetworkStore):
 *   - GET /api/collective/network              (deals + eligibility)
 *   - GET /api/investor/companies/:id/co-members
 *
 *  Portfolio stubs (sprint20Wave2Routes):
 *   - GET /api/investor/portfolio/:id/marks
 *   - GET /api/investor/portfolio/tax
 *
 *  KYC upload:
 *   - POST /api/collective/kyc-upload          (multipart)
 *
 *  Comms:
 *   - POST /api/comms/dm/start
 *   - POST /api/comms/posts/:id/mute-author
 *   - POST /api/comms/posts/:id/report
 *
 * 14 test cases — must not regress existing tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express, { type Express } from "express";
import http from "node:http";
import { registerSprint20Wave2Routes } from "../sprint20Wave2Routes";
/* WAVE 37 — static imports (never dynamic) for the two producers this harness
 * was missing. Three of this file's four failures were the harness calling
 * routes NOBODY HAD REGISTERED and reading the resulting Express 404 as a
 * contract violation. See the per-case notes below. */
import { registerCollectiveInterestRoutes } from "../collectiveInterestStore";
import { registerCommsRoutes } from "../commsStore";
import { investorHoldsCompany } from "../lib/investorMarkHistory";
import { COMMS_USERS } from "../commsStore";
import { dmChannelId } from "../../client/src/lib/comms/types";

// ---------------------------------------------------------------------------
// Shared HTTP server (single server for all tests — avoid port churn)
// ---------------------------------------------------------------------------

let app: Express;
let server: http.Server;
let port: number;

beforeAll(
  async () => {
    app = express();
    app.use(express.json());
  installV14TestIdentity(app);
    // multer handles its own content-type for multipart; no extra middleware needed
    registerSprint20Wave2Routes(app);
    // WAVE 37 — the live owners of /api/collective/network (B4 graph payload)
    // and /api/comms/dm/start. Registered AFTER the wave-2 mount, in the same
    // order production uses, so no route here shadows one there.
    registerCollectiveInterestRoutes(app);
    registerCommsRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as any).port as number;
  },
);

afterAll(
  async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },
);

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function call(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    userId?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = opts.contentType ?? "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;

    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// ---------------------------------------------------------------------------
// Investor CRM CRUD
// ---------------------------------------------------------------------------

describe("Investor CRM — contact CRUD", () => {
  it("GET /api/investor/crm/contacts returns a contacts array", async () => {
    const { status, body } = await call("GET", "/api/investor/crm/contacts");
    expect(status).toBe(200);
    expect(body).toHaveProperty("contacts");
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  it("POST /api/investor/crm/contacts creates a contact and returns 201", async () => {
    const { status, body } = await call(
      "POST",
      "/api/investor/crm/contacts",
      {
        userId: "u_test_investor",
        body: {
          companyName: "TestCo",
          founderName: "Alice Founder",
          founderEmail: "alice@testco.io",
          stage: "watching",
          sector: "SaaS",
          region: "CA",
          checkSizeUsd: 50_000,
        },
      },
    );
    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.contact.companyName).toBe("TestCo");
    expect(body.contact.id).toMatch(/^icrm_/);
  });

  it("PATCH /api/investor/crm/contacts/:id updates stage", async () => {
    // Create first
    const create = await call("POST", "/api/investor/crm/contacts", {
      userId: "u_test_investor",
      body: { companyName: "PatchCo", stage: "prospect" },
    });
    const contactId: string = create.body.contact.id;

    const { status, body } = await call(
      "PATCH",
      `/api/investor/crm/contacts/${contactId}`,
      { userId: "u_test_investor" /* v14 Tier-1 Fix 2 — owner identity required */, body: { stage: "due_diligence" } },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.contact.stage).toBe("due_diligence");
  });

  it("PATCH /api/investor/crm/contacts/:id returns 404 for unknown id", async () => {
    const { status, body } = await call(
      "PATCH",
      "/api/investor/crm/contacts/icrm_does_not_exist",
      { body: { stage: "passed" } },
    );
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it("DELETE /api/investor/crm/contacts/:id removes the contact", async () => {
    // Create first
    const create = await call("POST", "/api/investor/crm/contacts", {
      userId: "u_test_investor",
      body: { companyName: "DeleteCo", stage: "prospect" },
    });
    const contactId: string = create.body.contact.id;

    const { status, body } = await call("DELETE", `/api/investor/crm/contacts/${contactId}`, { userId: "u_test_investor" } /* v14 Tier-1 Fix 2 */);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(contactId);

    // Confirm it's gone — PATCH should 404 now
    const { status: s2 } = await call(
      "PATCH",
      `/api/investor/crm/contacts/${contactId}`,
      { userId: "u_test_investor" /* v14 Tier-1 Fix 2 */, body: { stage: "passed" } },
    );
    expect(s2).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Collective network
// ---------------------------------------------------------------------------

describe("Collective network", () => {
  /* WAVE 37 — STALE TEST. It asserted a stub that was DELIBERATELY RETIRED.
   *
   * `{ activeDeals, eligibilityChecks }` was `collectiveNetworkStore`'s
   * placeholder shape. v25.0 Track 2 B4 replaced it with a real graph payload
   * and removed the stub handler; `server/collectiveNetworkStore.ts:94-98`
   * carries the note recording that the `/api/collective/network` handler now
   * lives in `collectiveInterestStore`. The live route
   * (`server/collectiveInterestStore.ts:637-644`) returns `{ nodes, edges }`,
   * is chapter-scoped, and — per ruling v25.41 Q2, and the v25.41 round-2
   * follow-up — emits OPAQUE hashed node ids with the display name demoted to
   * a `label`, because investor names used as node ids leaked the identities
   * of members in other chapters.
   *
   * So the shape this case demanded no longer exists anywhere, and the
   * harness had not registered the route's real owner either — it was reading
   * an unrouted Express 404.
   *
   * STRENGTHENED. Rather than swap one shape assertion for another, this now
   * pins the SECURITY property the ruling was made for: every member node id
   * is an opaque `m_<12 hex>` hash and NO node id contains a node's own label.
   * The retired shape is explicitly asserted absent, so the stub cannot creep
   * back alongside the graph. */
  it("GET /api/collective/network returns the B4 graph with OPAQUE node ids (v25.41 Q2), not the retired stub", async () => {
    const { status, body } = await call("GET", "/api/collective/network");
    expect(status).toBe(200);

    // The live contract.
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);

    // The retired stub must not have come back.
    expect(body.activeDeals).toBeUndefined();
    expect(body.eligibilityChecks).toBeUndefined();

    // v25.41 Q2 — member ids are opaque hashes, never the investor's name.
    for (const n of body.nodes as Array<{ id: string; type: string; label: string }>) {
      expect(typeof n.id).toBe("string");
      expect(typeof n.type).toBe("string");
      if (n.type === "member") expect(n.id).toMatch(/^m_[0-9a-f]{12}$/);
      // No id may embed its own label — the exact leak the ruling closed.
      if (n.label) expect(n.id.toLowerCase()).not.toContain(String(n.label).toLowerCase());
    }
    // Edges may only reference declared nodes — a dangling edge would be a
    // second way to name someone the chapter filter just excluded.
    const ids = new Set((body.nodes as Array<{ id: string }>).map((n) => n.id));
    for (const e of body.edges as Array<{ source?: string; target?: string; from?: string; to?: string }>) {
      const a = e.source ?? e.from;
      const b = e.target ?? e.to;
      if (a) expect(ids.has(a)).toBe(true);
      if (b) expect(ids.has(b)).toBe(true);
    }
  });

  it("GET /api/investor/companies/:id/co-members returns an array", async () => {
    const { status, body } = await call(
      "GET",
      "/api/investor/companies/co_novapay/co-members",
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portfolio stubs
// ---------------------------------------------------------------------------

describe("Portfolio stubs", () => {
  it("GET /api/investor/portfolio/tax returns available=false with message", async () => {
    const { status, body } = await call("GET", "/api/investor/portfolio/tax");
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(body.message).toMatch(/2027/);
  });

  /* WAVE 37 — STALE TEST. It pinned the PRE-WAVE-31 STUB, by name.
   *
   * The old expectation — 200 with `{ holdingId: <whatever you sent>, marks:
   * [] }` — is a verbatim description of the literal this handler used to
   * return. `server/sprint20Wave2Routes.ts:138-141` records it: "WAS: `return
   * res.json({ holdingId: id, marks: [] })` — a literal, with a comment
   * promising Wave 3 would populate it. Twenty-eight waves later the chart
   * still said 'No mark history yet', and no data anyone entered could ever
   * have changed that." The case was therefore GREEN for twenty-eight waves
   * while checking nothing at all: it echoed its own input back.
   *
   * WAVE 31 / W31-A1 made `:id` a COMPANY id (what `valuation_event` actually
   * keys marks on) and added a per-company authorization predicate,
   * `investorHoldsCompany`. Per rule 7 a caller who does not hold the company
   * gets the SAME 404, with an IDENTICAL body, as one who names a company
   * that does not exist — a 403 or a distinguishable message would let any
   * investor enumerate which companies carry marks.
   *
   * STRENGTHENED, and honest about its limits. The harness has no seeded
   * holding for its identity, so the HTTP layer can only exercise the refusal
   * arm; asserting "404" alone would be satisfied by a handler that refuses
   * everyone, which is precisely the M14 fail-shut mutant
   * `server/lib/investorMarkHistory.ts:150-158` warns about. So this asserts
   * BOTH POLES OF THE PREDICATE DIRECTLY, through the exported seam the
   * module provides for exactly this purpose, AND the refusal uniformity over
   * HTTP:
   *   (a) a lookup reporting a holding → true; the same lookup reporting none
   *       → false — so an always-true or always-false gate fails here;
   *   (b) a throwing lookup → false (fails CLOSED, not open);
   *   (c) over HTTP, unheld-company and nonexistent-company are
   *       byte-identical 404s, and neither is a 403;
   *   (d) the retired echo shape is gone — no `holdingId` mirror.
   * The probe is the harness's real identity, never anonymous. */
  it("GET /api/investor/portfolio/:id/marks — :id is a COMPANY id, gated both ways, refusing uniformly (W31-A1)", async () => {
    // (a) BOTH POLES of the authorization predicate, via its injected seam.
    const holds = () => [{ length: 1 }] as unknown as { length: number };
    const none = () => [] as unknown as { length: number };
    expect(investorHoldsCompany("u_investor_a", "co_novapay", holds)).toBe(true);
    expect(investorHoldsCompany("u_investor_a", "co_novapay", none)).toBe(false);
    // A missing id on either side is never a holding.
    expect(investorHoldsCompany("", "co_novapay", holds)).toBe(false);
    expect(investorHoldsCompany("u_investor_a", "", holds)).toBe(false);
    // (b) FAILS CLOSED — the M14 mutant (catch -> return true) dies here.
    const throws = () => {
      throw new Error("ledger unavailable");
    };
    expect(investorHoldsCompany("u_investor_a", "co_novapay", throws)).toBe(false);

    // (c) OVER HTTP — "you don't hold it" and "it doesn't exist" are one answer.
    const unheld = await call("GET", "/api/investor/portfolio/co_novapay/marks", {
      userId: "u_investor_a",
    });
    const ghost = await call("GET", "/api/investor/portfolio/co_w37_no_such_company/marks", {
      userId: "u_investor_a",
    });
    expect(unheld.status).toBe(404);
    expect(unheld.status).not.toBe(403); // a 403 would be the enumeration oracle
    expect(ghost.status).toBe(unheld.status);
    expect(JSON.stringify(unheld.body)).toBe(JSON.stringify(ghost.body));

    // (d) The retired echo stub is gone: nothing mirrors the path back at 200.
    expect(unheld.body.holdingId).toBeUndefined();
    expect(unheld.body.marks).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// KYC upload
// ---------------------------------------------------------------------------

describe("KYC upload", () => {
  it("POST /api/collective/kyc-upload with no file returns 400", async () => {
    // Send a regular JSON body — multer should not find a file
    const { status, body } = await call("POST", "/api/collective/kyc-upload", {
      body: {},
    });
    // multer won't parse JSON body as a file upload — returns 400
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DM start
// ---------------------------------------------------------------------------

/* WAVE 37 — THE HARNESS, NOT THE ROUTE, WAS BROKEN, AND THE FIXTURES WERE
 * IMAGINARY.
 *
 * Two of this block's three cases failed with 404 because `/api/comms/dm/start`
 * is owned by `registerCommsRoutes` (`server/commsStore.ts:3277`) and this file
 * only ever mounted `registerSprint20Wave2Routes`. Nothing was wrong with the
 * route; the harness was calling a path no router served. That is now fixed in
 * `beforeAll`.
 *
 * With the route actually mounted, the remaining failure is the fixtures:
 * `u_investor_a` and `u_founder_b` were never provisioned anywhere, so
 * `openDmChannelCore` refuses them 422 `contact_not_provisioned` — a real
 * hardening ("Cannot start DM until this contact accepts their invitation"),
 * not a defect. The old test's expectation of a 200 was only ever reachable
 * back when the route minted a channel for any two strings.
 *
 * PRECONDITIONS ARE ESTABLISHED HERE, not read from the environment and not
 * borrowed from the demo seed — `COMMS_USERS` is empty unless demo seeding is
 * on, so probing as a demo persona would make these cases pass or fail for
 * reasons unrelated to the route. The two identities below are purpose-made
 * for this file, real to the store, and share one cap table so
 * `sharedContextBetween` has something true to find. */
const W37_DM_ACTOR = "u_w37_dm_actor";
const W37_DM_TARGET = "u_w37_dm_target";
const W37_DM_STRANGER = "u_w37_dm_stranger";

beforeAll(() => {
  COMMS_USERS[W37_DM_ACTOR] = {
    id: W37_DM_ACTOR,
    legalName: "W37 DM Actor",
    email: "w37-actor@example.test",
    visibility: { screenName: "W37Actor", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    capTables: ["co_w37_shared"],
    collectiveChapters: ["chap_w37"],
    roles: ["investor", "co_member"],
  };
  COMMS_USERS[W37_DM_TARGET] = {
    id: W37_DM_TARGET,
    legalName: "W37 DM Target",
    email: "w37-target@example.test",
    visibility: { screenName: "W37Target", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    capTables: ["co_w37_shared"],
    collectiveChapters: ["chap_w37"],
    roles: ["investor", "co_member"],
  };
});

afterAll(() => {
  delete COMMS_USERS[W37_DM_ACTOR];
  delete COMMS_USERS[W37_DM_TARGET];
});

describe("DM start", () => {
  it("POST /api/comms/dm/start returns a channelId for a provisioned pair with shared context", async () => {
    const { status, body } = await call("POST", "/api/comms/dm/start", {
      userId: W37_DM_ACTOR,
      body: { targetUserId: W37_DM_TARGET },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.channelId).toBe("string");
    /* WAVE 37 — the old pin was `/^ch_dm_/`, a channel-id format this tree does
     * not use. The canonical derivation is `dmChannelId` in
     * `client/src/lib/comms/types.ts:322-326` — `dm__<sorted a>__<sorted b>` —
     * and `openDmChannelCore` (`server/commsStore.ts:2253`) calls exactly that
     * function. Binding to the shared helper rather than to a prefix string is
     * STRONGER: it pins the whole id, both participants, and the SORT that
     * makes the pair order-independent, none of which a prefix match saw. */
    expect(body.channelId).toBe(dmChannelId(W37_DM_ACTOR, W37_DM_TARGET));
    // Order-independence: the same pair named the other way is the same room.
    expect(dmChannelId(W37_DM_TARGET, W37_DM_ACTOR)).toBe(body.channelId);
    // ...and it is genuinely a two-party id, not a constant.
    expect(body.channelId).toContain(W37_DM_ACTOR);
    expect(body.channelId).toContain(W37_DM_TARGET);
  });

  /* WAVE 37 — the OTHER pole, which this block never had. A route that minted
   * a channel for ANY two strings passed every case here; that is what it used
   * to do. This one pins the refusal, so the gate cannot be removed silently. */
  it("POST /api/comms/dm/start REFUSES an unprovisioned target (422 contact_not_provisioned)", async () => {
    const { status, body } = await call("POST", "/api/comms/dm/start", {
      userId: W37_DM_ACTOR,
      body: { targetUserId: W37_DM_STRANGER },
    });
    expect(status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("contact_not_provisioned");
    // No channel is minted on the refusal path.
    expect(body.channelId).toBeUndefined();
  });

  it("POST /api/comms/dm/start is idempotent for the same pair", async () => {
    const first = await call("POST", "/api/comms/dm/start", {
      userId: W37_DM_ACTOR,
      body: { targetUserId: W37_DM_TARGET },
    });
    const second = await call("POST", "/api/comms/dm/start", {
      userId: W37_DM_ACTOR,
      body: { targetUserId: W37_DM_TARGET },
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(typeof first.body.channelId).toBe("string");
    expect(first.body.channelId).toBe(second.body.channelId);
  });

  /* WAVE 37 — the status was already right; the assertion read a field the
   * handler does not emit. `server/commsStore.ts:3281` returns
   * `{ message: "Invalid", issues: <zod issues> }` on a schema miss, so
   * `body.error` was `undefined` and the case failed while the behaviour it
   * meant to check was correct. Re-aimed at what is actually returned and
   * STRENGTHENED: the refusal must name the offending field, so a handler that
   * 400s with an empty or generic body no longer satisfies it. */
  it("POST /api/comms/dm/start with missing targetUserId returns 400 naming the field", async () => {
    const { status, body } = await call("POST", "/api/comms/dm/start", {
      userId: W37_DM_ACTOR,
      body: {},
    });
    expect(status).toBe(400);
    expect(body.message).toBe("Invalid");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.issues)).toContain("targetUserId");
    // A rejected request mints nothing.
    expect(body.channelId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Mute author
// ---------------------------------------------------------------------------

describe("Mute author", () => {
  it("POST /api/comms/posts/:id/mute-author returns ok with mutedAuthorId", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/mute-author",
      {
        userId: "u_investor_a",
        body: { authorId: "u_founder_spammy" },
      },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.mutedAuthorId).toBe("u_founder_spammy");
  });

  it("POST /api/comms/posts/:id/mute-author with no authorId returns 400", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/mute-author",
      { body: {} },
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Report post
// ---------------------------------------------------------------------------

describe("Report post", () => {
  it("POST /api/comms/posts/:id/report returns ok with under_review status", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_abc/report",
      {
        userId: "u_investor_b",
        body: { reason: "spam" },
      },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.postId).toBe("post_abc");
    expect(body.status).toBe("under_review");
  });

  it("POST /api/comms/posts/:id/report accepts empty body (defaults reason)", async () => {
    const { status, body } = await call(
      "POST",
      "/api/comms/posts/post_xyz/report",
      { body: {} },
    );
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
