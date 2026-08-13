/**
 * WAVE 17 — ORP-044 second half: the THREE AUTO-TRIGGERS actually fire.
 *
 * WHAT WAS FALSE BEFORE. `milestoneBroadcastStore` declared four triggers since
 * Sprint 14 (`manual`, `round_closed`, `governance_metric_published`,
 * `ma_initiative_started`) and the founder panel offered filters for all four,
 * but a tree-wide search found that NO caller anywhere ever passed anything other
 * than `manual`. Three quarters of the vocabulary was decoration.
 *
 * WHY THIS SUITE IS SHAPED THIS WAY. The cheap version of this test — call
 * `fireAutoBroadcast` and assert it returns ok — would pass with every emit point
 * unwired, which is the "a check that passes may be checking nothing" trap this
 * codebase has now been bitten by seven times. So the trigger assertions here go
 * through the REAL HTTP routes (`registerRoutes` + supertest) and the REAL bridge
 * emit function, and each one is asserted at BOTH POLES: the milestone that should
 * broadcast, and the near-identical event that must not.
 *
 * The second defence is the registry itself. Because the emit points reach the
 * broadcast store through a registered dispatcher (a verified import cycle blocks
 * a direct import — see server/lib/wave17MilestoneAutoTriggers.ts), an
 * unregistered dispatcher would silently swallow every trigger. This suite
 * therefore asserts the unregistered pole explicitly, and asserts that
 * `registerMilestoneBroadcastRoutes` is what arms it.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  listBroadcasts,
  __clearBroadcasts,
  registerMilestoneBroadcastRoutes,
  findByAutoTriggerKey,
} from "../milestoneBroadcastStore";
import {
  fireAutoBroadcast,
  isMilestoneAutoDispatcherRegistered,
  __clearMilestoneAutoDispatcher,
  registerMilestoneAutoDispatcher,
  roundClosedBody,
  roundClosedKey,
  maInitiativeStartedBody,
  governanceFieldsInPayload,
  capBody,
  AUTO_BODY_MAX,
} from "../lib/wave17MilestoneAutoTriggers";
import { emitBridgeEvent } from "../bridgeStore";
import { notifyCascadeSideEffects } from "../lib/roundCloseCascade";

let app: Express;
const ADMIN = "u_admin";
const uniqueCo = (tag: string) => `co_w17_${tag}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

async function createDraftRound(companyId: string, name: string): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    /* openDate is mandatory on POST /api/rounds (OPEN_DATE_REQUIRED / CLOSE_DATE_REQUIRED) — measured,
       not assumed: the request 400s without it. */
    .send({ companyId, name, type: "seed", state: "draft", targetAmount: 1_000_000, openDate: new Date().toISOString().slice(0, 10), closeDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

beforeEach(() => {
  __clearBroadcasts();
});

/* ── the registry, at both poles ──────────────────────────────────────────── */

describe("ORP-044 — the auto-trigger dispatcher is armed by route registration", () => {
  it("is registered once registerRoutes has run", () => {
    expect(isMilestoneAutoDispatcherRegistered()).toBe(true);
  });

  it("NEVER swallows a trigger silently when nothing is registered", () => {
    __clearMilestoneAutoDispatcher();
    expect(isMilestoneAutoDispatcherRegistered()).toBe(false);

    const out = fireAutoBroadcast({
      companyId: "co_x",
      actorUserId: "u_1",
      trigger: "round_closed",
      body: "anything",
      dedupeKey: "round_closed:r_x",
    });
    /* The failure is REPORTED, not swallowed. If this ever returned {ok:true} the
       whole feature could be dead while every other test in this file passed. */
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("dispatcher_unregistered");
    expect(listBroadcasts().length).toBe(0);

    /* And registerMilestoneBroadcastRoutes is what arms it — proven by re-arming
       through the same public entry point the server uses. */
    registerMilestoneBroadcastRoutes(express());
    expect(isMilestoneAutoDispatcherRegistered()).toBe(true);
    const ok = fireAutoBroadcast({
      companyId: "co_x",
      actorUserId: "u_1",
      trigger: "round_closed",
      body: "anything",
      dedupeKey: "round_closed:r_x",
    });
    expect(ok.ok).toBe(true);
    expect(listBroadcasts().length).toBe(1);
  });

  it("refuses an incomplete request instead of persisting a broadcast with no body", () => {
    const out = fireAutoBroadcast({
      companyId: "co_x",
      actorUserId: "u_1",
      trigger: "round_closed",
      body: "",
      dedupeKey: "round_closed:r_y",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_request");
    expect(listBroadcasts().length).toBe(0);
  });

  it("reports a dispatcher that throws as a failure rather than propagating it", () => {
    __clearMilestoneAutoDispatcher();
    registerMilestoneAutoDispatcher(() => {
      throw new Error("store exploded");
    });
    const out = fireAutoBroadcast({
      companyId: "co_x",
      actorUserId: "u_1",
      trigger: "round_closed",
      body: "b",
      dedupeKey: "k1",
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("dispatch_failed");
    /* restore the real dispatcher for the remaining tests */
    registerMilestoneBroadcastRoutes(express());
  });

  it("is idempotent per milestone: the same dedupeKey never broadcasts twice", () => {
    const key = `round_closed:r_dedupe_${Date.now()}`;
    const first = fireAutoBroadcast({ companyId: "co_d", actorUserId: "u_1", trigger: "round_closed", body: "one", dedupeKey: key });
    const second = fireAutoBroadcast({ companyId: "co_d", actorUserId: "u_1", trigger: "round_closed", body: "one", dedupeKey: key });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(second.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(listBroadcasts().length).toBe(1);
    expect(findByAutoTriggerKey(key)?.id).toBe(first.id);
  });
});

/* ── copy + money ─────────────────────────────────────────────────────────── */

describe("ORP-044 — the composed copy never lies about money", () => {
  it("renders integer minor units through the currency formatter", () => {
    const body = roundClosedBody({ roundName: "Seed II", finalState: "closed_funded", finalAmountMinor: 420_000_000, currency: "USD" });
    expect(body).toContain("Seed II");
    expect(body).toContain("closed and funded");
    expect(body).toContain("4,200,000.00");
    /* the /100 bug would render 4,200,000.00 as 4,200,000 or 42,000.00 */
    expect(body).not.toContain("420000000");
  });

  it("respects a zero-exponent currency instead of dividing by 100", () => {
    const body = roundClosedBody({ roundName: "R", finalAmountMinor: 5_000_000, currency: "JPY" });
    expect(body).toContain("5,000,000");
    expect(body).not.toContain("50,000");
  });

  it("says NOTHING about the amount when no amount was supplied", () => {
    const body = roundClosedBody({ roundName: "Seed II", finalState: "closed" });
    expect(body).toContain("Seed II closed.");
    /* A default of 0 would publish "closed at $0.00" to the whole cap table. */
    expect(body).not.toContain("0.00");
    expect(body).not.toContain("$");
  });

  it("keeps M&A detail out of a company-wide broadcast", () => {
    const body = maInitiativeStartedBody();
    expect(body).toContain("M&A initiative");
    expect(body.toLowerCase()).not.toContain("shortlist:");
    expect(body).not.toContain("u_");
  });

  it("marks a truncation instead of silently cutting copy", () => {
    const long = "x".repeat(AUTO_BODY_MAX + 50);
    const capped = capBody(long);
    expect(capped.length).toBe(AUTO_BODY_MAX);
    expect(capped.endsWith("…")).toBe(true);
  });
});

/* ── trigger 1: round_closed, BOTH close paths ────────────────────────────── */

describe("ORP-044 — round_closed fires on the real close routes", () => {
  it("broadcasts when a founder closes a round, and NOT again on a repeat close", async () => {
    const co = uniqueCo("close");
    const roundId = await createDraftRound(co, "W17 close");

    const close = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated", finalAmount: 250_000_00, finalCurrency: "USD", finalState: "closed_funded" });
    expect(close.status).toBe(200);
    expect(close.body.alreadyClosed).toBe(false);

    const made = listBroadcasts({ companyId: co });
    expect(made.length).toBe(1);
    expect(made[0].trigger).toBe("round_closed");
    expect(made[0].autoTriggerKey).toBe(roundClosedKey(roundId));
    expect(made[0].body).toContain("250,000.00");
    expect(made[0].body).toContain("W17 close");

    /* POLE 2 — a second close reports alreadyClosed and must NOT re-notify. */
    const again = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated" });
    expect(again.status).toBe(200);
    expect(again.body.alreadyClosed).toBe(true);
    expect(listBroadcasts({ companyId: co }).length).toBe(1);
  });

  it("broadcasts on the SECOND close path — the cascade/sweeper side effects", () => {
    const co = uniqueCo("cascade");
    notifyCascadeSideEffects(
      {
        roundId: "rnd_cascade_1",
        alreadyClosed: false,
        offersLapsed: 0,
        lapsedOffers: [],
        companyId: co,
        roundName: "Bridge Extension",
      },
      { actorUserId: "system:round_sweeper" },
    );
    const made = listBroadcasts({ companyId: co });
    expect(made.length).toBe(1);
    expect(made[0].trigger).toBe("round_closed");
    expect(made[0].body).toContain("Bridge Extension");
    /* The cascade has no final amount; it must not invent one. */
    expect(made[0].body).not.toContain("$");
    expect(made[0].createdByUserId ?? made[0].founderUserId).toBeDefined();
  });

  it("does NOT broadcast when the cascade found the round already closed", () => {
    const co = uniqueCo("cascade_idem");
    notifyCascadeSideEffects(
      { roundId: "rnd_cascade_2", alreadyClosed: true, offersLapsed: 0, lapsedOffers: [], companyId: co, roundName: "R" },
      { actorUserId: "system:round_sweeper" },
    );
    expect(listBroadcasts({ companyId: co }).length).toBe(0);
  });
});

/* ── trigger 2: ma_initiative_started ─────────────────────────────────────── */

describe("ORP-044 — ma_initiative_started fires only for a LEAD initiative", () => {
  it("broadcasts when a lead M&A initiative is opened", async () => {
    const co = uniqueCo("ma_lead");
    const res = await request(app)
      .post("/api/investor/ma/initiative")
      .set("x-user-id", ADMIN)
      .send({ companyId: co, initiativeType: "lead_initiative", topic: "Acquisition by Northwind", buyerShortlist: ["Northwind"] });
    expect(res.status).toBe(200);

    const made = listBroadcasts({ companyId: co });
    expect(made.length).toBe(1);
    expect(made[0].trigger).toBe("ma_initiative_started");
    /* PRIVACY POLE — the topic and shortlist must not leak to the cap table. */
    expect(made[0].body).not.toContain("Northwind");
    expect(made[0].body).not.toContain("Acquisition by");
  });

  it("does NOT broadcast for a discussion-only initiative", async () => {
    const co = uniqueCo("ma_disc");
    const res = await request(app)
      .post("/api/investor/ma/initiative")
      .set("x-user-id", ADMIN)
      .send({ companyId: co, initiativeType: "discussion", topic: "General chat" });
    expect(res.status).toBe(200);
    expect(listBroadcasts({ companyId: co }).length).toBe(0);
  });
});

/* ── trigger 3: governance_metric_published ───────────────────────────────── */

describe("ORP-044 — governance_metric_published fires from the profile event", () => {
  it("detects governance fields in BOTH producers' payload shapes", () => {
    expect(governanceFieldsInPayload({ patch: { boardCompositionDirectors: 5 }, version: 3 })).toEqual(["boardCompositionDirectors"]);
    expect(governanceFieldsInPayload({ boardDirectorsSnapshot: "[]", changedFields: ["boardDirectorsSnapshot"] })).toContain("boardDirectorsSnapshot");
    expect(governanceFieldsInPayload({ patch: { tagline: "hi" }, version: 2 })).toEqual([]);
    expect(governanceFieldsInPayload(null)).toEqual([]);
  });

  it("broadcasts when a company.profile.updated carries a governance field", () => {
    const co = uniqueCo("gov");
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: co,
      aggregateKind: "company",
      actor: { userId: "u_founder_gov" },
      payload: { patch: { boardCompositionDirectors: 5 }, version: 7 },
    });
    const made = listBroadcasts({ companyId: co });
    expect(made.length).toBe(1);
    expect(made[0].trigger).toBe("governance_metric_published");
    expect(made[0].body).toContain("Board composition");
    /* Never the value itself — the audience is the whole cap table. */
    expect(made[0].body).not.toContain("5 directors");
  });

  it("is idempotent for a re-emitted event of the same profile version", () => {
    const co = uniqueCo("gov_idem");
    const emit = () =>
      emitBridgeEvent({
        eventType: "company.profile.updated",
        aggregateId: co,
        aggregateKind: "company",
        actor: { userId: "u_founder_gov" },
        payload: { patch: { boardCompositionDirectors: 5 }, version: 7 },
      });
    emit();
    emit();
    expect(listBroadcasts({ companyId: co }).length).toBe(1);

    /* A genuine later edit is a NEW version and does broadcast. */
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: co,
      aggregateKind: "company",
      actor: { userId: "u_founder_gov" },
      payload: { patch: { boardCompositionDirectors: 6 }, version: 8 },
    });
    expect(listBroadcasts({ companyId: co }).length).toBe(2);
  });

  it("does NOT broadcast for a non-governance profile patch, nor for other event types", () => {
    const co = uniqueCo("gov_neg");
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: co,
      aggregateKind: "company",
      actor: { userId: "u_f" },
      payload: { patch: { tagline: "new tagline" }, version: 2 },
    });
    emitBridgeEvent({
      eventType: "cap_table.mutated",
      aggregateId: co,
      aggregateKind: "company",
      actor: { userId: "u_f" },
      payload: { patch: { boardCompositionDirectors: 9 }, version: 3 },
    });
    expect(listBroadcasts({ companyId: co }).length).toBe(0);
  });

  it("also covers the declared canonical event type, for a future publisher", () => {
    const co = uniqueCo("gov_canon");
    emitBridgeEvent({
      eventType: "governance_metric.published",
      aggregateId: co,
      aggregateKind: "company",
      actor: { userId: "u_f" },
      payload: { metric: "board_independence", version: 1 },
    });
    const made = listBroadcasts({ companyId: co });
    expect(made.length).toBe(1);
    expect(made[0].trigger).toBe("governance_metric_published");
  });
});
