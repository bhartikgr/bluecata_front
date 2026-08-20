/**
 * WAVE 60 — THE HTTP PROOF BEHIND THE WAVE 60 REFUSALS.
 *
 * Every surface this wave changed gets its data from an HTTP route. A render test
 * alone could prove the fix with a hand-invented error object and would keep
 * passing forever even if the real routes stopped behaving that way. So this file
 * drives the REAL `registerRoutes` Express stack over supertest and pins:
 *
 *   1. THE LOWER POLE IS REAL — an unauthenticated / unrelated caller gets a
 *      genuine non-2xx from `GET /api/investor/companies/:id/co-members`
 *      (A-2 and A-4's data source), which is exactly the class of failure that
 *      used to render "No co-members found for X." and
 *      "Co-member list unavailable in preview".
 *
 *   2. THE UPPER POLES ARE REAL — `GET /api/comms/cap-table/:companyId` and
 *      `GET /api/comms/soft-circle/:roundId` (A-1's and A-3's data source) really
 *      do answer `{exists:false}` for a channel that does not exist, and they
 *      answer 200 while doing it. That matters more than usual here: the whole
 *      point of A-1/A-3 is that a FAILURE was being rendered as `{exists:false}`
 *      behaviour, so the two states must be provably distinct AT THE ROUTE, not
 *      just in the component.
 *
 *   3. `{exists:false}` IS NOT A NUMBER — the honest empty body carries no
 *      counts, so a component rendering a count from it would be inventing one.
 *
 * The bodies pinned here are the ones the render tests replay:
 *   client/src/components/comms/__tests__/w60_channel_cards_empty_vs_failed.test.tsx
 *   client/src/pages/investor/__tests__/w60_company_detail_empty_vs_failed.test.tsx
 *   client/src/components/investor/__tests__/w60_member_value_comembers_empty_vs_failed.test.tsx
 *
 * No shared wave-named constant module was created for this join (Wave 55b's
 * `shared/w55bCapTableRefusal.ts` was flagged by its own author as O-7 and never
 * ratified; the pre-flight's TRAP 2 says do not create a second one). The join is
 * this file's assertions plus the comments above.
 *
 * No projection is called directly and no formula is asserted.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

/* With the demo gate open, seeded demo fixtures can satisfy a handler before the
   scope decision is reached and the probe would pass while checking nothing.
   Same reasoning as w55b_captable_family_refusal_http.test.ts. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;

const STAMP = Date.now();
const STRANGER_COMPANY = `co_w60_${STAMP}`;
const STRANGER_ROUND = `rnd_w60_${STAMP}`;

const CO_MEMBERS = `/api/investor/companies/${STRANGER_COMPANY}/co-members`;
const CAP_TABLE_CHANNEL = `/api/comms/cap-table/${STRANGER_COMPANY}`;
const SOFT_CIRCLE_CHANNEL = `/api/comms/soft-circle/${STRANGER_ROUND}`;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
});

describe("W60 — the co-member route really does refuse, so the refusal copy has a real cause", () => {
  it("LOWER POLE — an ANONYMOUS caller gets a genuine non-2xx, not an empty list", async () => {
    /* THE defect this proves is reachable: pre-fix, this exact response made
       MemberValueIntelligenceInvestor print "No co-members found for X." and
       investor/CompanyDetail print "Co-member list unavailable in preview". */
    const res = await request(app).get(CO_MEMBERS);
    expect(res.status).toBeGreaterThanOrEqual(400);
    /* And the refusal body is NOT an array a client could mistake for "no
       co-members" — which is what would have kept the defect alive after the fix. */
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("LOWER POLE — the refusal is PERMANENT, identical across repeated attempts", async () => {
    /* This is what makes "this is a loading failure, not an empty list" the
       honest sentence: the answer is a function of who is asking, not of when. */
    const a = await request(app).get(CO_MEMBERS);
    const b = await request(app).get(CO_MEMBERS);
    expect(b.status).toBe(a.status);
    expect(a.status).toBeGreaterThanOrEqual(400);
  });

  it("UPPER POLE — the route is DECIDING, never 5xx", async () => {
    /* The dangerous over-correction: an endpoint broken for everyone. A 5xx here
       would mean the refusal is a fault rather than a decision. */
    const res = await request(app).get(CO_MEMBERS);
    expect(res.status).toBeLessThan(500);
  });
});

describe("W60 — the channel routes distinguish 'no channel' from a failure, at the route", () => {
  it("UPPER POLE — GET /api/comms/cap-table/:companyId answers 200 {exists:false} for a company with no channel", async () => {
    /* A-1 and A-3 both narrowed a condition that used to catch BOTH this body and
       a failure. If this ever stops being a 200 with exists:false, the honest
       empty state the narrowing preserves would be unreachable and the poles in
       the render tests would be asserting against a state that cannot occur. */
    const res = await request(app).get(CAP_TABLE_CHANNEL);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: false });
  });

  it("UPPER POLE — GET /api/comms/soft-circle/:roundId answers 200 {exists:false} for a round with no channel", async () => {
    const res = await request(app).get(SOFT_CIRCLE_CHANNEL);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exists: false });
  });

  it("THE HONEST EMPTY BODY CARRIES NO COUNT — so no tile can render a number from it", async () => {
    /* `{exists:false}` has no visibleMemberCount / totalMemberCount / memberCount
       and no lastMessages. A component printing a count on this body would be
       inventing one — the Wave 61 defect class, checked here so it cannot creep
       into Wave 60's surfaces. */
    for (const url of [CAP_TABLE_CHANNEL, SOFT_CIRCLE_CHANNEL]) {
      const res = await request(app).get(url);
      const body = res.body as Record<string, unknown>;
      expect(body.visibleMemberCount).toBeUndefined();
      expect(body.totalMemberCount).toBeUndefined();
      expect(body.memberCount).toBeUndefined();
      expect(body.lastMessages).toBeUndefined();
    }
  });

  it("`exists:false` and `isMember:false` are DIFFERENT bodies — the two states the components must keep apart", async () => {
    /* The `isMember:false` body is produced by commsStore.ts:3309 / :3335 for a
       channel that DOES exist. A-3's upper pole B (the "Cap-table members only"
       card) depends on the two being distinguishable, and A-1's `return null` for
       a non-member depends on it too. */
    const res = await request(app).get(CAP_TABLE_CHANNEL);
    expect(res.body.exists).toBe(false);
    expect(res.body.isMember).toBeUndefined();
  });
});
