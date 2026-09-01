/**
 * WAVE 229 — ONE QUANTITY, ONE RESOLVER (server half).
 *
 * The wave's brief was re-specified by the owner: there is no missing resolver
 * layer to build; the resolvers already exist and are already single. What
 * existed were TWO quantities each derived TWICE, in two places that could
 * disagree:
 *
 *   1. "pending invitations".  `partnerInvitationStore.countPendingByPartner()`
 *      reads the DURABLE table and returns `Math.max(durable, ram)` because the
 *      RAM array is process-local (WAVE 19 / SEAT-02). The Dashboard tile and
 *      the seat-limit ENFORCEMENT path both use it. The Team page did not — it
 *      re-derived its own count from the `invitations` array, which is built
 *      from that same process-local RAM array by `listByPartner()`. WAVE 19
 *      fixed the count and never fixed the list.
 *
 *   2. "which pipeline stage a deal is in".  `canonicalizeStage()` remaps legacy
 *      stage values so they are not silently dropped from aggregations. It lived
 *      in `server/partnerWorkspaceStore.ts`, which the client cannot import, so
 *      the server Dashboard aggregation honoured it and the client kanban ran a
 *      second derivation (`if (byStage[d.stage])`) that dropped them.
 *
 * WHAT THIS FILE DOES NOT ASSERT, AND WHY — the exclusion register below. Some
 * pairs of figures on these screens legitimately differ because they MEASURE
 * DIFFERENT THINGS. Reconciling those would itself be the defect (owner ruling
 * R218.2: "fix the sentence, never the sum"). They are recorded here as
 * exclusions, with reasons, so that a later wave cannot innocently "reconcile"
 * them believing this file simply forgot.
 *
 * ANTI-VACUITY. Traceability is asserted by CALL COUNT on the real resolver, not
 * by value equality: two independent derivations that happen to agree on the
 * seeded sandbox would pass a value-equality assertion while remaining two
 * derivations. Every figure here is produced by a real HTTP request against the
 * real registrar (`registerPartnerRoutes`), and the pending invitation is
 * created by a real HTTP POST, never by writing a fixture.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import {
  seedTestPartnerSandbox,
  partnerInvitationStore,
  canonicalizeStage as canonicalizeStageFromServerModule,
  PARTNER_PIPELINE_LEGACY_STAGE_REMAP as REMAP_FROM_SERVER_MODULE,
  TEST_PARTNER_ID,
} from "../partnerWorkspaceStore";
import {
  canonicalizeStage as canonicalizeStageFromShared,
  PARTNER_PIPELINE_LEGACY_STAGE_REMAP as REMAP_FROM_SHARED,
  PARTNER_PIPELINE_STAGES,
} from "@shared/crmStages";
import { WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT } from "@shared/wave214ThirdPartyAuthorityCopy";

let app: express.Express;
const MANAGING = "u_avi_managing";

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

/* A spy left installed by a FAILING assertion would be read as the resolver's
   own source by the predicate test below, turning one real failure into a
   cascade of misleading ones. Every spy is torn down after every test so each
   RED reported by a disarm is the RED that disarm actually caused. */
afterEach(() => { vi.restoreAllMocks(); });

/* ═══════════════════════════════════════════════════════════════════════════
   THE REGISTRY. One row per quantity: the single resolver that owns it, and
   every surface that must read it rather than re-derive it.
   ═══════════════════════════════════════════════════════════════════════════ */
const REGISTRY = [
  {
    quantity: "pending invitations",
    resolver: "partnerInvitationStore.countPendingByPartner",
    surfaces: [
      "GET /api/partner/me/team (Team page seat banner)",
      "GET /api/partner/me/dashboard (Dashboard seat tile)",
      "seat-limit enforcement (requirePartnerAuth / assertTierSeats)",
    ],
  },
  {
    quantity: "canonical pipeline stage of a deal",
    resolver: "canonicalizeStage (shared/crmStages.ts)",
    surfaces: [
      "server partnerDashboardSnapshot stage counts",
      "client PartnerPipeline kanban columns",
    ],
  },
] as const;

it("the registry names a single resolver and at least two surfaces per quantity", () => {
  expect(REGISTRY.length).toBe(2);
  for (const row of REGISTRY) {
    expect(row.resolver.length).toBeGreaterThan(0);
    expect(row.surfaces.length).toBeGreaterThanOrEqual(2);
  }
});

describe("WAVE 229 defect 1 — pending invitations has ONE resolver", () => {
  it("a real HTTP POST creates a pending invitation (no fixture is written)", async () => {
    const before = partnerInvitationStore.countPendingByPartner(TEST_PARTNER_ID);
    const r = await request(app)
      .post("/api/partner/me/team/invitations")
      .set("x-user-id", MANAGING)
      /* WAVE 214's third-party authority envelope is required on this route and
         is compared BYTE-FOR-BYTE. The statement is imported, never retyped, so
         this test cannot drift from the shipped wording. */
      .send({
        email: `w229.${Date.now()}@example.com`,
        subRole: "viewer",
        authorityConfirmed: true,
        authorityStatementShown: WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
      });
    expect(r.status).toBe(201);
    const after = partnerInvitationStore.countPendingByPartner(TEST_PARTNER_ID);
    /* MOVE THE FIXTURE: the resolver's own output must respond to a real write.
       Without this, every assertion below could be reading a frozen zero. */
    expect(after).toBe(before + 1);
  });

  it("GET /api/partner/me/team exposes pendingCount, and it comes FROM the resolver (call count)", async () => {
    const spy = vi.spyOn(partnerInvitationStore, "countPendingByPartner");
    /* PROVE THE FENCE IS INSTALLED. A spy that silently failed to attach would
       report zero calls and make the assertion below unfalsifiable in the
       opposite direction — so first confirm the spy observes a direct call. */
    partnerInvitationStore.countPendingByPartner(TEST_PARTNER_ID);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();

    const r = await request(app).get("/api/partner/me/team").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spy.mock.calls.some((c) => c[0] === TEST_PARTNER_ID)).toBe(true);
    expect(typeof r.body.pendingCount).toBe("number");
    spy.mockRestore();
  });

  it("the Team route and the Dashboard route report the SAME pending figure from the SAME resolver", async () => {
    const spy = vi.spyOn(partnerInvitationStore, "countPendingByPartner");
    const team = await request(app).get("/api/partner/me/team").set("x-user-id", MANAGING);
    const teamCalls = spy.mock.calls.length;
    const dash = await request(app).get("/api/partner/me/dashboard").set("x-user-id", MANAGING);
    const dashCalls = spy.mock.calls.length - teamCalls;
    spy.mockRestore();

    expect(teamCalls).toBeGreaterThanOrEqual(1);
    expect(dashCalls).toBeGreaterThanOrEqual(1);
    expect(team.body.pendingCount).toBe(dash.body.team.pendingInvitations);
  });

  it("the resolver's predicate and signature are UNCHANGED — it is called, never edited", () => {
    /* This resolver enforces a PAID seat limit (requirePartnerAuth, and it is
       re-run inside the write lock). Widening or narrowing it would move every
       partner's cap. It must still accept one partnerId and return a number, and
       an expired-but-unredeemed invitation must still be excluded. */
    expect(partnerInvitationStore.countPendingByPartner.length).toBe(1);
    expect(typeof partnerInvitationStore.countPendingByPartner(TEST_PARTNER_ID)).toBe("number");
    const src = partnerInvitationStore.countPendingByPartner.toString();
    expect(src).toContain("redeemedAt");
    expect(src).toContain("expiresAt");
    expect(src).toContain("Math.max");
  });

  it("a durable-read failure must never LOWER the figure to zero (a DB outage must not mint free seats)", () => {
    const src = partnerInvitationStore.countPendingByPartner.toString();
    /* The fallback returns the RAM count, not 0. A fabricated zero here would
       hand every partner a tier's worth of extra seats. */
    expect(src).not.toMatch(/return\s+0\s*;/);
  });
});

describe("WAVE 229 defect 2 — canonical pipeline stage has ONE resolver", () => {
  it("the server module and shared/ expose the SAME function object, not two copies", () => {
    /* Reference identity, not behavioural equality: two separate functions with
       identical bodies would pass a behaviour comparison and still be two
       derivations that can drift apart. */
    expect(canonicalizeStageFromServerModule).toBe(canonicalizeStageFromShared);
    expect(REMAP_FROM_SERVER_MODULE).toBe(REMAP_FROM_SHARED);
  });

  it("the server module still EXPORTS canonicalizeStage, so no existing importer broke (R195.5)", async () => {
    const mod = await import("../partnerWorkspaceStore");
    expect(typeof mod.canonicalizeStage).toBe("function");
  });

  it("every legacy stage maps into a canonical stage, and none is dropped", () => {
    for (const [legacy, canonical] of Object.entries(REMAP_FROM_SHARED)) {
      expect(PARTNER_PIPELINE_STAGES as readonly string[]).toContain(canonical);
      expect(canonicalizeStageFromShared(legacy)).toBe(canonical);
    }
    /* The six legacy values named by migration 0088 and by the server comment. */
    for (const legacy of ["sourcing", "sourced", "qualifying", "committee", "closed_won", "closed_lost"]) {
      expect(Object.keys(REMAP_FROM_SHARED)).toContain(legacy);
    }
  });

  it("a canonical stage passes through untouched, and an unknown stage lands in a real bucket", () => {
    for (const s of PARTNER_PIPELINE_STAGES) expect(canonicalizeStageFromShared(s)).toBe(s);
    expect(PARTNER_PIPELINE_STAGES as readonly string[]).toContain(
      canonicalizeStageFromShared("a_stage_that_has_never_existed"),
    );
  });

  it("the pipeline route still ships RAW stages, so canonicalisation must happen on BOTH readers", async () => {
    /* Establishes WHY the client needed the shared function: the server does not
       canonicalise on the way out. If a later wave makes the route canonicalise,
       this assertion is the one that will tell it the client guard is now
       belt-and-braces rather than load-bearing. */
    const r = await request(app).get("/api/partner/me/pipeline").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    const src = (await import("node:fs")).readFileSync("server/partnerRoutes.ts", "utf8");
    const route = src.slice(src.indexOf('app.get("/api/partner/me/pipeline"'));
    expect(route.slice(0, 400)).not.toContain("canonicalizeStage");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE EXCLUSION REGISTER — figures that DIFFER BY DESIGN.

   Each of these is a pair of numbers a reader might expect to match. They do
   not match because they measure different things. This file asserts them AS
   EXCLUSIONS: it deliberately makes no equality assertion about them, and
   records the reason so a future wave does not "reconcile" them and destroy a
   true distinction. Owner ruling R218.2: fix the sentence, never the sum.
   ═══════════════════════════════════════════════════════════════════════════ */
const EXCLUSIONS = [
  {
    pair: "Team banner active seats vs GET /team activeSeats",
    reason:
      "activeSeats counts SEAT RECORDS; the roster collapses legacy duplicate identities into one row per PERSON. Different units (seats vs people). Wave 126 ruled the roster wins for display and the surplus is reported in the consolidation note.",
  },
  {
    pair: "soft-circled capital vs subscribed capital",
    reason:
      "R218.2 — non-binding indications versus executed subscriptions. Two different quantities. Making them equal would assert commitments that do not exist.",
  },
  {
    pair: "Dashboard $10,000 SPV-committed vs the SPV+fund committed figure",
    reason:
      "Both already come from the ONE resolver canonicalCommittedMinorForSpv; they differ only in scope (SPV-only vs SPV plus fund). A scope difference is not a second derivation.",
  },
  {
    pair: '"Mark read (0)"',
    reason:
      "0 is selected.length — the number of rows the user has ticked in the UI. It is a selection size, not an unread count, and has no server resolver.",
  },
  {
    pair: "partner FIRM name vs the signatory PERSON name",
    reason: "Two different entities. An organisation is not its signatory.",
  },
  {
    pair: "Relationship Map spine presence vs live pipeline row count",
    reason:
      "The map shows the relationship SPINE (which parties are connected at all); the pipeline counts live deal rows. Presence is not a count.",
  },
  {
    pair: "portfolio companies vs attributed companies",
    reason:
      "Portfolio is what the partner holds; attribution is what the partner is credited with introducing. Neither is a subset of the other.",
  },
] as const;

describe("WAVE 229 — exclusions are recorded as exclusions, with reasons", () => {
  it("every excluded pair carries a stated reason", () => {
    expect(EXCLUSIONS.length).toBe(7);
    for (const e of EXCLUSIONS) {
      expect(e.reason.length).toBeGreaterThan(40);
    }
  });

  it("this wave adds NO field reconciling seat records with roster rows", async () => {
    const r = await request(app).get("/api/partner/me/team").set("x-user-id", MANAGING);
    /* activeSeats (seat records) and the rendered roster length (people) are
       allowed to differ. No assertion of equality is made, and no new
       reconciled field is introduced. */
    expect(typeof r.body.activeSeats).toBe("number");
    expect(Array.isArray(r.body.members)).toBe(true);
    expect(r.body).not.toHaveProperty("reconciledSeatCount");
  });
});
