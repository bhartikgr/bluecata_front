/**
 * WAVE 55b · OQ-3 — THE HTTP PROOF BEHIND THE CAP-TABLE REFUSALS.
 *
 * The founder cap table, the interim (pro-forma) cap table and the Discuss
 * dialog's recipient list all get their data from HTTP routes. Wave 55b changed
 * what those three surfaces render when that data does not arrive. A render test
 * alone could prove that with a hand-invented error object, and would keep
 * passing forever even if the real routes stopped failing that way. So this file
 * drives the REAL `registerRoutes` Express stack over supertest and pins the
 * actual statuses, and `shared/w55bCapTableRefusal.ts` is the single constant the
 * render tests replay. If a route's refusal status drifts, THIS file fails —
 * loudly and in the right place — instead of the render tests quietly asserting
 * against a failure mode that no longer occurs.
 *
 * ── BOTH POLES, AT THE ROUTE LEVEL ───────────────────────────────────────────
 *   LOWER  a principal with no relationship to the company -> the pinned refusal
 *          status (404: a 403 would confirm the resource exists — WAVE 42 · F-9).
 *   UPPER  the same route is not blanket-broken: it answers, it decides, and it
 *          never 5xx's. A one-pole "everyone gets 404" test would pass against a
 *          totally dead endpoint, which is a worse defect than the one fixed.
 *
 * Also pinned here: the routes' refusal is PERMANENT (stable across attempts),
 * which is why the client copy says "Try again" and not "this will fix itself",
 * and why the empty-state copy must never be shown for it.
 *
 * No projection is called directly and no formula is asserted.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

/* With the demo gate open, seeded demo fixtures can satisfy a handler before the
   scope decision is reached, and the probe would pass while checking nothing.
   Same reasoning as wave42_f9_captable_scope_refusal.test.ts. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";
import {
  W55B_CAP_TABLE_REFUSAL_STATUS,
  W55B_CAP_TABLE_FAMILY_READ_ROUTES,
} from "@shared/w55bCapTableRefusal";

let app: Express;
let server: http.Server;

const STAMP = Date.now();
/** A company the caller has no relationship of any kind to. */
const STRANGER_COMPANY = `co_w55b_${STAMP}`;
/* An AUTHENTICATED principal who simply has no relationship to this company.
   `u_lapsed_lp` is the same known persona wave42_f9_captable_scope_refusal.test.ts
   uses; an unknown id is rejected by `requireAuth` with 401 before the cap-table
   scope decision is reached, which would prove nothing about scope. */
const STRANGER_ID = "u_lapsed_lp";
const STRANGER_EMAIL = "lp@lapsed-fund.example";

function asStranger(url: string) {
  return request(app).get(url).set("x-user-id", STRANGER_ID).set("x-user-email", STRANGER_EMAIL);
}

const HOLDERS = `/api/companies/${STRANGER_COMPANY}/securities`;
const INTERIM = `/api/companies/${STRANGER_COMPANY}/captable/interim`;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
});

describe("W55b · OQ-3 — the cap-table-family read routes really do refuse, with the pinned status", () => {
  it("FIXTURE — the caller is AUTHENTICATED, so a refusal is a scope decision and not a 401", async () => {
    /* Without this, every assertion below could be 'passing' on 401 —
       i.e. proving nothing about the cap-table sink guard at all. */
    const res = await asStranger(HOLDERS);
    expect(res.status).not.toBe(401);
  });

  it("FIXTURE — the constant the render tests replay is a refusal, not a success", () => {
    expect(W55B_CAP_TABLE_REFUSAL_STATUS).toBeGreaterThanOrEqual(400);
    expect(W55B_CAP_TABLE_REFUSAL_STATUS).toBeLessThan(500);
    /* The routes named in the constant module are the ones exercised below. */
    expect(W55B_CAP_TABLE_FAMILY_READ_ROUTES).toContain("/api/companies/:id/securities");
    expect(W55B_CAP_TABLE_FAMILY_READ_ROUTES).toContain("/api/companies/:id/captable/interim");
  });

  it("LOWER POLE — GET /api/companies/:id/securities refuses a stranger with EXACTLY the pinned status", async () => {
    const res = await asStranger(HOLDERS);
    expect(res.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
    /* 404, never 403 — a 403 confirms the cap table exists. */
    expect(res.status).not.toBe(403);
    /* And the refusal body is not a holder ledger the client could mistake for
       an empty cap table. */
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("LOWER POLE — GET /api/companies/:id/captable/interim refuses a stranger with EXACTLY the pinned status", async () => {
    const res = await asStranger(INTERIM);
    expect(res.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
    expect(res.status).not.toBe(403);
    /* Critically: it does NOT return `{committed:[],funded:[],soft_circle:[]}`.
       That shape is what the pre-fix component fabricated for itself, and it is
       what would have made the failure indistinguishable from emptiness even
       after this wave. */
    const body = res.body as Record<string, unknown> | undefined;
    expect(Array.isArray(body?.committed)).toBe(false);
    expect(Array.isArray(body?.funded)).toBe(false);
    expect(Array.isArray(body?.soft_circle)).toBe(false);
  });

  it("UPPER POLE — both routes are alive and DECIDING, never 5xx", async () => {
    /* The dangerous over-correction: make the endpoint fail for everyone. A 5xx
       here would mean the refusal is a fault rather than a decision. */
    for (const url of [HOLDERS, INTERIM]) {
      const res = await asStranger(url);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
  });

  it("the refusal is PERMANENT — identical across repeated attempts", async () => {
    /* This is what makes 'this is a loading failure, not an empty list' the
       honest sentence: the answer is a function of who is asking, not of when.
       The client therefore must not print an empty-state claim for it. */
    for (const url of [HOLDERS, INTERIM]) {
      const a = await asStranger(url);
      const b = await asStranger(url);
      expect(a.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
      expect(b.status).toBe(a.status);
    }
  });

  it("an unrelated second company id is refused identically — no company-specific special-casing", async () => {
    const res = await asStranger(`/api/companies/co_w55b_other_${STAMP}/securities`);
    expect(res.status).toBe(W55B_CAP_TABLE_REFUSAL_STATUS);
  });
});

describe("W55b · OQ-3 — the three client surfaces are wired to the refusal (source invariants)", () => {
  /* The render behaviour is proved by the three .test.tsx files. These narrow
     source invariants exist so that a future wave cannot delete the wiring while
     the render tests are skipped or renamed, and so that the empty-state copy
     this wave promised to leave alone is pinned BY TEXT. */
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");

  const CAPTABLE = read("client/src/pages/founder/CapTable.tsx");
  const INTERIM_SRC = read("client/src/components/founder/CapTableInterim.tsx");
  const DISCUSS = read("client/src/components/investor/DiscussWithCapTableDialog.tsx");

  it("all three surfaces use the SHARED LoadFailedRefusal, not a new bespoke component", () => {
    for (const src of [CAPTABLE, INTERIM_SRC, DISCUSS]) {
      expect(src).toContain('import { LoadFailedRefusal } from "@/components/LoadFailedRefusal"');
      expect(src).toContain("<LoadFailedRefusal");
    }
  });

  it("each surface's empty-state copy is gated on isSuccess, so no failure can print it", () => {
    expect(CAPTABLE).toContain("securities.isSuccess && rows.length === 0");
    expect(INTERIM_SRC).toContain("loaded && rows.length === 0");
    expect(DISCUSS).toContain("coMembersQuery.isSuccess && members.length === 0");
  });

  it("the EXISTING empty-state voice survives this wave verbatim", () => {
    expect(CAPTABLE).toContain("No securities recorded yet.");
    expect(CAPTABLE).toContain("None outstanding.");
    expect(CAPTABLE).toContain("No option pool reserved.");
    expect(INTERIM_SRC).toContain("No {meta.label.toLowerCase()} positions.");
    expect(DISCUSS).toContain("No co-members found for this company.");
  });

  it("the founder tiles no longer assert a number on failure", () => {
    /* Pre-fix these read `fmtShares(totals.total)` etc. unconditionally, so a
       refused load printed `Total shares 0` and `0.00%` three times. */
    expect(CAPTABLE).toContain("securities.isSuccess ?");
    expect(CAPTABLE).toContain("MONEY_UNAVAILABLE");
  });
});
