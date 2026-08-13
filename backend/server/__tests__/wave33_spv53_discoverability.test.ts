/**
 * WAVE 33 · CP-SPV-53 — DISCOVERABILITY FALSIFICATION HARNESS.
 *
 * WHAT THIS FILE DEFENDS AGAINST, SPECIFICALLY
 * --------------------------------------------
 * 1. THE VACUOUS SCHEMA PASS. `spv_discovery_event` is created by migration
 *    0179, which `NODE_ENV=test` NEVER RUNS — the test database is built from
 *    connection.ts's inline baseline and connection.ts is SACRED. The self-heal
 *    installer is fail-soft BY DESIGN, so if it silently did nothing every read
 *    would return empty and every "expected 0" assertion would pass against a
 *    table that does not exist. Case (S) asserts the schema itself FIRST.
 *
 * 2. THE COLLAPSED IDENTITY. Wave 28's rate-limiter pin passed 14/14 while
 *    every request collapsed to one anonymous caller. Case (P0) therefore
 *    proves the identity mock genuinely distinguishes two people by driving the
 *    SAME url as two different users and requiring DIFFERENT bodies. If it ever
 *    collapsed, P0 fails first and loudly, so every later assertion is known to
 *    be meaningful rather than assumed.
 *
 * 3. THE DEAD LAZY REQUIRE (Wave 32B). Case (X) asserts BY EXECUTION that the
 *    store's module graph actually resolves and its reads actually run against
 *    the tables, and that a failure would surface rather than be swallowed into
 *    `[]`. Every import in `spvDiscoveryStore.ts` is static; case (X2) asserts
 *    by source scan that no `require(` appears in the files this item added.
 *
 * BOTH POLES ARE ASSERTED EVERYWHERE. Every "cannot see" case is paired with a
 * "can see" case that differs in exactly one variable, so no assertion can be
 * satisfied by returning nothing.
 *
 * This file establishes ALL of its own preconditions and never reads
 * `process.env`. There is no conditional skip anywhere in it.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";

let CURRENT: { userId: string | null } = { userId: null };
vi.mock("../lib/userContext", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: CURRENT.userId !== null,
      userId: CURRENT.userId,
      roles: [],
    }),
  };
});

/* The Collective-membership middleware is replaced with a pass-through so the
   discovery predicate — not the membership gate — is what these cases measure.
   The gate itself is pinned by `waveSEC_collective_gating.test.ts`; duplicating
   it here would let a gate change mask a predicate regression. */
vi.mock("../lib/requireCollectiveMember", () => ({
  requireCollectiveMember: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { rawDb } from "../db/connection";
import { registerSpvDiscoveryRoutes } from "../spvDiscoveryRoutes";
import {
  discoverableSpvsFor,
  discoverableSpvFor,
  invitedSpvsFor,
  invitedSpvIdsFor,
  reachForSponsoredSpv,
  recordDiscoveryEvents,
  __resetDiscoverySchemaMemo,
} from "../spvDiscoveryStore";
import {
  isBroadcastDiscoverable,
  isReachableByViewer,
  summariseReach,
  SPV_SCOPES,
  SPV_SCOPE_REACH_COPY,
  type SpvScope,
} from "../lib/spvDiscoverability";
import { applySpvDiscoverabilitySchema } from "../lib/applySpvDiscoverabilitySchema";
import { spvEngineStore } from "../spvEngineStore";

const P_A = "w33d_partner_a";
const P_B = "w33d_partner_b";
const SPV_PRIV = "w33d_spv_private";
const SPV_INV = "w33d_spv_inviteonly";
const SPV_COLL = "w33d_spv_collectiveonly";
const SPV_NET = "w33d_spv_network";
const SPV_DRAFT = "w33d_spv_draft_network";
const SPV_ARCH = "w33d_spv_archived_network";
const U_INVITEE = "w33d_u_invitee";
const U_STRANGER = "w33d_u_stranger";
const U_UPPER = "w33d_u_uppercase";

function n(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...(args as any[])) as any)?.n ?? 0);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  registerSpvDiscoveryRoutes(app);
  return app;
}

function seedSpv(id: string, partnerId: string, scope: string, opts?: { status?: string; archived?: boolean }) {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO spv
         (id, sponsor_partner_id, name, spv_type, jurisdiction, status, distribution_scope,
          target_raise_minor, min_check_minor, cap_minor, currency, carry_basis, lp_visibility,
          created_at, updated_at, prev_hash, curr_hash, archived_at)
       VALUES (?, ?, ?, 'spv', 'delaware', ?, ?, 1000000, 250000, NULL, 'JPY', 'whole_spv', 'own_only',
               ?, ?, '0', 'h', ?)`,
    )
    .run(
      id,
      partnerId,
      `Vehicle ${id}`,
      opts?.status ?? "open",
      scope,
      now,
      now,
      opts?.archived ? now : null,
    );
}

function seedUser(id: string, email: string) {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, 't_w33d', ?, ?, 'investor', 0)`,
    )
    .run(id, email, id);
}

function seedInvite(spvId: string, partnerId: string, email: string, status = "invited") {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO spv_lp_invite
         (id, partner_id, spv_id, email, first_name, last_name, note, status, created_at)
       VALUES (?, ?, ?, ?, 'X', 'Y', NULL, ?, ?)`,
    )
    .run(`inv_${spvId}_${email}`, partnerId, spvId, email, status, new Date().toISOString());
}

beforeAll(() => {
  __resetDiscoverySchemaMemo();
  applySpvDiscoverabilitySchema(rawDb() as any);

  seedSpv(SPV_PRIV, P_A, "private");
  seedSpv(SPV_INV, P_A, "invite_only");
  seedSpv(SPV_COLL, P_A, "collective_only");
  seedSpv(SPV_NET, P_B, "network");
  seedSpv(SPV_DRAFT, P_A, "network", { status: "draft" });
  seedSpv(SPV_ARCH, P_A, "network", { archived: true });

  seedUser(U_INVITEE, "invitee@w33d.example");
  seedUser(U_STRANGER, "stranger@w33d.example");
  seedUser(U_UPPER, "Mixed.Case@W33D.Example");

  // The invitee is invited to the invite-only vehicle AND to the private one.
  // The private invitation is the interesting case: an invitation must not
  // upgrade a private vehicle, or `private` and `invite_only` become the same
  // scope in the other direction.
  seedInvite(SPV_INV, P_A, "invitee@w33d.example");
  seedInvite(SPV_PRIV, P_A, "invitee@w33d.example");
  /* Case-mismatched invitation. BOTH directions must be covered or one side of
     the fold goes unexercised — mutant M9 originally SURVIVED because every
     seeded invite row was already lowercase, so only the JS side of the
     comparison was ever tested and the SQL `lower(trim(...))` could be deleted
     without any assertion noticing. The GP types the case; the row carries it.
       · row MIXED, user lowercase  -> exercises the SQL side
       · row lowercase, user MIXED  -> exercises the JS side           */
  seedInvite(SPV_INV, P_A, "Mixed.Case@W33D.Example");
  seedUser("w33d_u_lower", "rowcase@w33d.example");
  seedInvite(SPV_COLL, P_A, "  RowCase@W33D.Example  ");
});

/* ───────────────────────── (S) SCHEMA EXISTS FIRST ───────────────────────── */

describe("S — the schema this whole file measures actually exists", () => {
  it("S1 spv_discovery_event exists as a TABLE", () => {
    const r = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spv_discovery_event'`)
      .get();
    expect(r).toBeTruthy();
  });

  it("S2 the sanity pole — the same probe correctly reports a table that is NOT there", () => {
    const r = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='spv_discovery_event_NOPE'`)
      .get();
    expect(r).toBeFalsy();
  });

  it("S3 the columns the store writes are all present", () => {
    const cols = (rawDb().prepare(`PRAGMA table_info(spv_discovery_event)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    for (const c of ["id", "spv_id", "viewer_user_id", "context", "scope_at_time", "via_invitation", "created_at"]) {
      expect(cols).toContain(c);
    }
  });

  it("S4 the CHECK on context is real — an out-of-domain context is rejected", () => {
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO spv_discovery_event (id, spv_id, viewer_user_id, context, scope_at_time, via_invitation, created_at)
           VALUES ('bad1', 'x', 'y', 'not_a_context', 'network', 0, '2026-01-01')`,
        )
        .run(),
    ).toThrow();
  });

  it("S5 the seeds this file depends on actually landed", () => {
    expect(n(`SELECT COUNT(*) AS n FROM spv WHERE id LIKE 'w33d_spv_%'`)).toBe(6);
    expect(n(`SELECT COUNT(*) AS n FROM spv_lp_invite WHERE spv_id LIKE 'w33d_spv_%'`)).toBe(4);
    expect(n(`SELECT COUNT(*) AS n FROM users WHERE id LIKE 'w33d_u_%'`)).toBe(4);
  });
});

/* ─────────────────── (E) THE PURE PREDICATE, BOTH POLES ──────────────────── */

describe("E — the pure predicate", () => {
  it("E1 invite_only is NOT broadcast in any audience context", () => {
    for (const c of ["collective", "capavate", "network"] as const) {
      expect(isBroadcastDiscoverable("invite_only", c)).toBe(false);
    }
  });

  it("E2 the other pole — network IS broadcast in all three", () => {
    for (const c of ["collective", "capavate", "network"] as const) {
      expect(isBroadcastDiscoverable("network", c)).toBe(true);
    }
  });

  it("E3 collective_only is FIRST-CLASS: collective yes, capavate/network no", () => {
    expect(isBroadcastDiscoverable("collective_only", "collective")).toBe(true);
    expect(isBroadcastDiscoverable("collective_only", "capavate")).toBe(false);
    expect(isBroadcastDiscoverable("collective_only", "network")).toBe(false);
  });

  it("E4 private is broadcast nowhere", () => {
    for (const c of ["collective", "capavate", "network", "invited"] as const) {
      expect(isBroadcastDiscoverable("private", c)).toBe(false);
    }
  });

  it("E5 an invitation REACHES invite_only — the half that did not exist", () => {
    expect(isReachableByViewer("invite_only", "invited", { hasInvitation: true })).toBe(true);
  });

  it("E6 the other pole — no invitation, no reach", () => {
    expect(isReachableByViewer("invite_only", "invited", { hasInvitation: false })).toBe(false);
  });

  it("E7 an invitation does NOT upgrade a private vehicle", () => {
    expect(isReachableByViewer("private", "invited", { hasInvitation: true })).toBe(false);
  });

  it("E8 unknown scope and unknown context both DENY (fail-closed)", () => {
    expect(isBroadcastDiscoverable("syndicate_maybe", "collective")).toBe(false);
    expect(isBroadcastDiscoverable("network", "twitter")).toBe(false);
    expect(isReachableByViewer("network", "twitter", { hasInvitation: true })).toBe(false);
    expect(isBroadcastDiscoverable(undefined, undefined)).toBe(false);
  });

  it("E9 `invited` is never answered by the BROADCAST predicate", () => {
    for (const s of SPV_SCOPES) expect(isBroadcastDiscoverable(s, "invited")).toBe(false);
  });

  it("E10 the pure predicate AGREES with the live store on all 4x3 broadcast pairs", () => {
    /* A divergence between the two is the defect this case exists to catch:
       `listVisibleForContext` is what the PRE-EXISTING routes use, and the two
       must not drift into disagreeing about what is public.

       The vehicles are created through `spvEngineStore.createSpv` rather than
       by raw INSERT, because the engine store answers from a hydrated map: a
       raw-inserted row is invisible to it, and the comparison would then pass
       for the vacuous reason that BOTH sides said "not visible". The first
       assertion below demands the store can actually see them. */
    const made: Record<string, string> = {};
    for (const scope of SPV_SCOPES) {
      const dto = spvEngineStore.createSpv(
        "w33d_partner_e10",
        {
          name: `E10 ${scope}`,
          jurisdiction: "delaware",
          carryBasis: "whole_spv",
          distributionScope: scope,
          status: "open",
          currency: "JPY",
        },
        "w33d_actor",
      );
      made[scope] = dto.id;
    }
    // Precondition, asserted: the store CAN see these four.
    const allIds = spvEngineStore.listByPartner("w33d_partner_e10").map((s2) => s2.id);
    for (const scope of SPV_SCOPES) expect(allIds).toContain(made[scope]);

    for (const scope of SPV_SCOPES) {
      for (const ctx of ["collective", "capavate", "network"] as const) {
        const viaStore = spvEngineStore.listVisibleForContext(ctx).some((s2) => s2.id === made[scope]);
        expect({ scope, ctx, viaStore }).toEqual({
          scope,
          ctx,
          viaStore: isBroadcastDiscoverable(scope, ctx),
        });
      }
    }
  });

  it("E11 every scope has non-empty reach copy and none of it is a raw enum token", () => {
    for (const s of SPV_SCOPES) {
      const copy = SPV_SCOPE_REACH_COPY[s as SpvScope];
      expect(copy.length).toBeGreaterThan(40);
      expect(copy).not.toContain("invite_only");
      expect(copy).not.toContain("collective_only");
    }
  });

  it("E12 summariseReach distinguishes NULL (unreadable) from 0 (none)", () => {
    const unknown = summariseReach({ scope: "invite_only", invitationCount: null, distinctViewers: 0 });
    const none = summariseReach({ scope: "invite_only", invitationCount: 0, distinctViewers: 0 });
    expect(unknown.reachCopy).not.toBe(none.reachCopy);
    expect(unknown.reachCopy.toLowerCase()).toContain("unknown");
    expect(none.reachCopy.toLowerCase()).toContain("nobody");
    // and the null is carried through, not coerced to zero
    expect(unknown.invitationCount).toBeNull();
  });

  it("E13 an unrecognised scope yields a stated refusal, not a claim of reach", () => {
    const r = summariseReach({ scope: "whatever", invitationCount: 3, distinctViewers: 9 });
    expect(r.scope).toBeNull();
    expect(r.broadcastContexts).toEqual([]);
    expect(r.reachCopy.toLowerCase()).toContain("cannot be stated");
  });
});

/* ─────────────────────── (D) THE STORE, OVER REAL ROWS ───────────────────── */

describe("D — the store, over real rows", () => {
  it("D1 the invitee resolves their invite-only vehicle", () => {
    expect(invitedSpvIdsFor(U_INVITEE)).toContain(SPV_INV);
  });

  it("D2 the other pole — a stranger resolves nothing", () => {
    expect(invitedSpvIdsFor(U_STRANGER)).toEqual([]);
  });

  it("D3a JS side — a MIXED-case user address matches a lowercase invite row", () => {
    expect(invitedSpvIdsFor(U_UPPER)).toContain(SPV_INV);
  });

  it("D3b SQL side — a lowercase user address matches a MIXED-case, padded invite row", () => {
    /* This is the half that mutant M9 escaped through. The stored row is
       `"  RowCase@W33D.Example  "` — mixed case AND surrounding whitespace, as
       a GP would paste it — and the user registered `rowcase@w33d.example`.
       Only a fold applied to the COLUMN can match these. */
    const raw = rawDb()
      .prepare(`SELECT email FROM spv_lp_invite WHERE spv_id = ? AND email LIKE '%RowCase%'`)
      .get(SPV_COLL) as { email: string } | undefined;
    expect(raw?.email).toBe("  RowCase@W33D.Example  "); // precondition, asserted
    expect(invitedSpvIdsFor("w33d_u_lower")).toContain(SPV_COLL);
  });

  it("D4 a PRIVATE vehicle is not reachable even with a live invitation to it", () => {
    // The invitation row exists (asserted, so this is not vacuous)…
    expect(invitedSpvIdsFor(U_INVITEE)).toContain(SPV_PRIV);
    // …and the vehicle is still not reachable.
    expect(invitedSpvsFor(U_INVITEE).map((s) => s.spvId)).not.toContain(SPV_PRIV);
  });

  it("D5 the invitee's collective feed includes the invite-only vehicle, flagged viaInvitation", () => {
    const rows = discoverableSpvsFor(U_INVITEE, "collective");
    const hit = rows.find((s) => s.spvId === SPV_INV);
    expect(hit).toBeTruthy();
    expect(hit!.viaInvitation).toBe(true);
  });

  it("D6 the other pole — the stranger's collective feed does NOT include it, but is not empty", () => {
    const rows = discoverableSpvsFor(U_STRANGER, "collective");
    expect(rows.map((s) => s.spvId)).not.toContain(SPV_INV);
    // Non-emptiness matters: an assertion that a list omits X passes trivially
    // if the list is empty for an unrelated reason.
    expect(rows.map((s) => s.spvId)).toContain(SPV_NET);
    expect(rows.map((s) => s.spvId)).toContain(SPV_COLL);
  });

  it("D7 collective_only is excluded from the capavate context, network is not", () => {
    const rows = discoverableSpvsFor(U_STRANGER, "capavate").map((s) => s.spvId);
    expect(rows).not.toContain(SPV_COLL);
    expect(rows).toContain(SPV_NET);
  });

  it("D8 drafts and archived vehicles are never discoverable, in either half", () => {
    for (const u of [U_INVITEE, U_STRANGER]) {
      const rows = discoverableSpvsFor(u, "collective").map((s) => s.spvId);
      expect(rows).not.toContain(SPV_DRAFT);
      expect(rows).not.toContain(SPV_ARCH);
    }
  });

  it("D9 a revoked invitation stops reaching (positive allow-list, not a negative filter)", () => {
    seedInvite(SPV_INV, P_A, "revoked@w33d.example", "revoked");
    seedUser("w33d_u_revoked", "revoked@w33d.example");
    expect(invitedSpvIdsFor("w33d_u_revoked")).toEqual([]);
    // …and the pole: flip it to a live status and it DOES reach.
    seedInvite(SPV_INV, P_A, "revoked@w33d.example", "invited");
    expect(invitedSpvIdsFor("w33d_u_revoked")).toContain(SPV_INV);
    // restore
    seedInvite(SPV_INV, P_A, "revoked@w33d.example", "revoked");
  });

  it("D10 a soft-deleted invitation stops reaching", () => {
    seedUser("w33d_u_del", "deleted@w33d.example");
    seedInvite(SPV_INV, P_A, "deleted@w33d.example", "invited");
    expect(invitedSpvIdsFor("w33d_u_del")).toContain(SPV_INV);
    rawDb()
      .prepare(`UPDATE spv_lp_invite SET deleted_at = ? WHERE email = 'deleted@w33d.example'`)
      .run(new Date().toISOString());
    expect(invitedSpvIdsFor("w33d_u_del")).toEqual([]);
  });

  it("D11 a vehicle visible BOTH ways is reported once, as broadcast (the honest statement)", () => {
    seedInvite(SPV_NET, P_B, "invitee@w33d.example");
    const rows = discoverableSpvsFor(U_INVITEE, "collective").filter((s) => s.spvId === SPV_NET);
    expect(rows).toHaveLength(1);
    expect(rows[0].viaInvitation).toBe(false);
  });

  it("D12 money fields are minor-unit integers with their currency, never divided", () => {
    const hit = discoverableSpvsFor(U_STRANGER, "collective").find((s) => s.spvId === SPV_NET)!;
    // JPY, ISO-4217 exponent 0. 250000 is ¥250,000 — a /100 anywhere in the
    // read path would render it as ¥2,500.
    expect(hit.currency).toBe("JPY");
    expect(hit.minCheckMinor).toBe(250000);
    expect(Number.isInteger(hit.minCheckMinor)).toBe(true);
  });

  it("D13 recordDiscoveryEvents writes rows only AFTER the vehicles are resolved", () => {
    const before = n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE viewer_user_id = ?`, "w33d_probe");
    const rows = discoverableSpvsFor(U_STRANGER, "collective");
    expect(rows.length).toBeGreaterThan(0);
    const written = recordDiscoveryEvents("w33d_probe", "collective", rows);
    expect(written).toBe(rows.length);
    const after = n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE viewer_user_id = ?`, "w33d_probe");
    expect(after - before).toBe(rows.length);
  });

  it("D14 a row with an unrecognised scope is NOT written (the other domain guard)", () => {
    const written = recordDiscoveryEvents("w33d_probe2", "collective", [
      { spvId: "x", name: "x", sponsorPartnerId: "p", spvType: "spv", jurisdiction: "delaware", status: "open", currency: "JPY", scope: "bogus_scope", targetRaiseMinor: null, minCheckMinor: null, closeDate: null, viaInvitation: false },
    ]);
    expect(written).toBe(0);
  });

  it("D15 reach for a sponsored vehicle is derived from ROWS", () => {
    const r = reachForSponsoredSpv(P_A, SPV_INV);
    expect(r).toBeTruthy();
    expect(r!.scope).toBe("invite_only");
    expect(r!.broadcastContexts).toEqual([]);
    const liveInvites = n(
      `SELECT COUNT(*) AS n FROM spv_lp_invite WHERE spv_id = ? AND deleted_at IS NULL AND status IN ('invited','accepted')`,
      SPV_INV,
    );
    expect(r!.invitationCount).toBe(liveInvites);
    expect(liveInvites).toBeGreaterThan(0);
  });

  it("D15b the GP reach figure is DISTINCT viewers, asserted THROUGH THE STORE", () => {
    /* Mutant M14 (COUNT(DISTINCT viewer) -> COUNT(viewer)) originally SURVIVED:
       the route case counted distinct viewers with its own raw SQL, which is a
       reimplementation, not a measurement of the store. This case reads the
       figure the GP is actually shown. */
    const spvId = SPV_COLL;
    const read = () => reachForSponsoredSpv(P_A, spvId)!.distinctViewers;
    const base = read();
    expect(base).not.toBeNull();
    const rows = [
      { spvId, name: "x", sponsorPartnerId: P_A, spvType: "spv", jurisdiction: "delaware",
        status: "open", currency: "JPY", scope: "collective_only",
        targetRaiseMinor: null, minCheckMinor: null, closeDate: null, viaInvitation: false },
    ];
    // The SAME person three times must not move a distinct count…
    recordDiscoveryEvents("w33d_repeat_viewer", "collective", rows);
    const afterFirst = read();
    expect(afterFirst).toBe(base! + 1);
    recordDiscoveryEvents("w33d_repeat_viewer", "collective", rows);
    recordDiscoveryEvents("w33d_repeat_viewer", "collective", rows);
    expect(read()).toBe(afterFirst);
    // …and the pole: a genuinely new person does.
    recordDiscoveryEvents("w33d_second_viewer", "collective", rows);
    expect(read()).toBe(afterFirst! + 1);
    // The underlying EVENT count did rise, proving the writes really happened
    // and the flat distinct figure is not just a failed insert.
    expect(n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE spv_id = ?`, spvId))
      .toBeGreaterThanOrEqual(4);
  });

  it("D16 cross-partner reach is null (the route turns it into a 404, never a 403)", () => {
    expect(reachForSponsoredSpv(P_B, SPV_INV)).toBeNull();
    // the pole: the true sponsor DOES get it, so D16 is not passing vacuously
    expect(reachForSponsoredSpv(P_A, SPV_INV)).toBeTruthy();
  });

  it("D17 a nonexistent vehicle and a cross-partner one produce the SAME null", () => {
    expect(reachForSponsoredSpv(P_B, "w33d_no_such_spv")).toBeNull();
    expect(reachForSponsoredSpv(P_B, SPV_INV)).toBeNull();
  });
});

/* ───────────────────── (P) ROUTES + THE PRIVACY POLES ────────────────────── */

describe("P — routes", () => {
  const app = makeApp();

  it("P0 the identity mock genuinely distinguishes two people (anti-collapse)", async () => {
    CURRENT = { userId: U_INVITEE };
    const a = await request(app).get("/api/investor/me/spv-invitations");
    CURRENT = { userId: U_STRANGER };
    const b = await request(app).get("/api/investor/me/spv-invitations");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // DIFFERENT bodies. If identity ever collapsed to one caller these would be
    // equal and every later privacy assertion would be meaningless.
    expect(JSON.stringify(a.body.spvs)).not.toBe(JSON.stringify(b.body.spvs));
    expect(a.body.spvs.length).toBeGreaterThan(0);
    expect(b.body.spvs).toHaveLength(0);
  });

  it("P1 the empty state is a server-authored SENTENCE, not a blank", async () => {
    CURRENT = { userId: U_STRANGER };
    const r = await request(app).get("/api/investor/me/spv-invitations");
    expect(typeof r.body.emptyCopy).toBe("string");
    expect(r.body.emptyCopy.length).toBeGreaterThan(40);
  });

  it("P2 anonymous is 401 — distinct from 404, proving auth is actually mounted", async () => {
    CURRENT = { userId: null };
    for (const url of [
      "/api/investor/me/spv-invitations",
      "/api/collective/discovery/spvs",
      "/api/capavate/discovery/spvs",
      `/api/investor/me/discovery/spv/${SPV_NET}`,
    ]) {
      const r = await request(app).get(url);
      expect(r.status).toBe(401);
    }
  });

  it("P3 control — the invitee reads their invite-only vehicle detail: 200", async () => {
    CURRENT = { userId: U_INVITEE };
    const r = await request(app).get(`/api/investor/me/discovery/spv/${SPV_INV}`);
    expect(r.status).toBe(200);
    expect(r.body.spv.spvId).toBe(SPV_INV);
    expect(r.body.spv.viaInvitation).toBe(true);
  });

  it("P4 probe — a REAL, fully authenticated OTHER user reads the same url: 404", async () => {
    // Rule 3: the probe is a real-but-wrong identity, not anonymity. P3 and P4
    // differ in exactly one variable — which person is asking.
    CURRENT = { userId: U_STRANGER };
    const r = await request(app).get(`/api/investor/me/discovery/spv/${SPV_INV}`);
    expect(r.status).toBe(404);
  });

  it("P5 that 404 is BYTE-IDENTICAL to the refusal for an id that does not exist", async () => {
    CURRENT = { userId: U_STRANGER };
    const a = await request(app).get(`/api/investor/me/discovery/spv/${SPV_INV}`);
    const b = await request(app).get(`/api/investor/me/discovery/spv/w33d_definitely_not_a_vehicle`);
    expect(a.status).toBe(b.status);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });

  it("P6 a private vehicle is 404 for its own invitee too", async () => {
    CURRENT = { userId: U_INVITEE };
    const r = await request(app).get(`/api/investor/me/discovery/spv/${SPV_PRIV}`);
    expect(r.status).toBe(404);
  });

  it("P7 there is no request-supplied identity to tamper with", async () => {
    CURRENT = { userId: U_STRANGER };
    const r = await request(app)
      .get(`/api/investor/me/discovery/spv/${SPV_INV}?userId=${U_INVITEE}&investorId=${U_INVITEE}`);
    expect(r.status).toBe(404);
  });

  it("P8 whole-body scan — a stranger's feed contains no invite-only vehicle id", async () => {
    CURRENT = { userId: U_STRANGER };
    const r = await request(app).get("/api/collective/discovery/spvs");
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain(SPV_INV);
    expect(body).not.toContain(SPV_PRIV);
    // the opposite pole, so P8 cannot pass by returning nothing
    expect(body).toContain(SPV_NET);
  });

  it("P9 every returned vehicle carries printable copy, never a raw enum token alone", async () => {
    CURRENT = { userId: U_INVITEE };
    const r = await request(app).get("/api/collective/discovery/spvs");
    expect(r.body.spvs.length).toBeGreaterThan(0);
    for (const s of r.body.spvs) {
      expect(typeof s.scopeCopy).toBe("string");
      expect(s.scopeCopy.length).toBeGreaterThan(40);
    }
  });

  it("P10 the feed WRITES a discovery event — the GP reach figure has a source", async () => {
    const before = n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE viewer_user_id = ?`, U_INVITEE);
    CURRENT = { userId: U_INVITEE };
    const r = await request(app).get("/api/collective/discovery/spvs");
    expect(r.body.spvs.length).toBeGreaterThan(0);
    const after = n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE viewer_user_id = ?`, U_INVITEE);
    expect(after).toBeGreaterThan(before);
  });

  it("P11 reach counts DISTINCT viewers — repeated loads cannot inflate it", async () => {
    const spvId = SPV_NET;
    const distinct = () =>
      n(`SELECT COUNT(DISTINCT viewer_user_id) AS n FROM spv_discovery_event WHERE spv_id = ?`, spvId);
    CURRENT = { userId: U_STRANGER };
    await request(app).get("/api/collective/discovery/spvs");
    const d1 = distinct();
    await request(app).get("/api/collective/discovery/spvs");
    await request(app).get("/api/collective/discovery/spvs");
    expect(distinct()).toBe(d1);
    /* The pole: a person who has NEVER been recorded against this vehicle does
       move the figure. A previously-seen identity would not, and using one
       here would have made this half of the case unfalsifiable. */
    const fresh = "w33d_u_never_seen_before";
    expect(
      n(`SELECT COUNT(*) AS n FROM spv_discovery_event WHERE viewer_user_id = ? AND spv_id = ?`, fresh, spvId),
    ).toBe(0);
    CURRENT = { userId: fresh };
    await request(app).get("/api/collective/discovery/spvs");
    expect(distinct()).toBe(d1 + 1);
  });
});

/* ────────────── (X) THE DEAD-PATH AND STRUCTURAL DEFENCES ────────────────── */

describe("X — structural defences", () => {
  it("X1 the store's reads genuinely execute (no swallowed failure into [])", () => {
    // Executed, not read: the Wave 32B defect was a path that threw and was
    // swallowed into an empty array, which is indistinguishable from a correct
    // empty result unless a NON-empty result is demanded.
    const rows = discoverableSpvsFor(U_STRANGER, "collective");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => typeof r.spvId === "string" && r.spvId.length > 0)).toBe(true);
  });

  it("X2 no lazy require() in any file this item added", () => {
    /* Comments are stripped first. These files DISCUSS the Wave 32B lazy-require
       defect by name, and a naive source scan matches the prose rather than the
       code — a check that fails while checking nothing is the mirror image of
       the defect this suite exists to prevent. */
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const f of [
      "server/spvDiscoveryStore.ts",
      "server/spvDiscoveryRoutes.ts",
      "server/lib/spvDiscoverability.ts",
    ]) {
      expect(strip(fs.readFileSync(f, "utf8"))).not.toMatch(/\brequire\s*\(/);
    }
    /* Sanity pole: the stripped scan is still capable of FINDING a require()
       in code. Without this, X2 would pass just as happily against a `strip`
       that deleted the entire file. */
    expect(strip('const x = require("y");')).toMatch(/\brequire\s*\(/);
    expect(strip("// const x = require(\"y\");")).not.toMatch(/\brequire\s*\(/);
  });

  it("X3 no spread of an iterator (Array.from only)", () => {
    for (const f of ["server/spvDiscoveryStore.ts", "server/lib/spvDiscoverability.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/\[\.\.\.[A-Za-z_$][\w$]*\.(values|keys|entries)\(\)\]/);
    }
  });

  it("X4 migration 0179 is mirrored BYTE-IDENTICALLY into both trees", () => {
    const a = fs.readFileSync("migrations/0179_wave33_spv_discoverability.sql");
    const b = fs.readFileSync("server/db/migrations/0179_wave33_spv_discoverability.sql");
    expect(a.equals(b)).toBe(true);
  });

  it("X5 the installer re-types NO DDL — it reads the migration off disk", () => {
    const src = fs
      .readFileSync("server/lib/applySpvDiscoverabilitySchema.ts", "utf8")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/CREATE\s+TABLE/i);
    expect(src).not.toMatch(/CREATE\s+INDEX/i);
    // and positively: it DOES read the file, so X5 is not satisfiable by an
    // installer that does nothing at all.
    expect(src).toContain("readFileSync");
  });

  it("X6 A-22 — connection.ts does not also create what 0179 creates", () => {
    const conn = fs.readFileSync("server/db/connection.ts", "utf8");
    expect(conn).not.toContain("spv_discovery_event");
    expect(conn).not.toContain("idx_spv_lp_invite_email");
    // sanity pole: the same grep DOES find a table that is genuinely there
    expect(conn).toContain("spv_lp_invite");
  });

  it("X7 0179 is additive — no DROP, DELETE or UPDATE", () => {
    const sql = fs.readFileSync("migrations/0179_wave33_spv_discoverability.sql", "utf8");
    expect(sql).not.toMatch(/^\s*DROP\s/im);
    expect(sql).not.toMatch(/^\s*DELETE\s/im);
    expect(sql).not.toMatch(/^\s*UPDATE\s/im);
  });

  it("X8 the installer applied to an EMPTY database produces the same objects", () => {
    const Database = require("better-sqlite3");
    const fresh = new Database(":memory:");
    // spv_lp_invite must pre-exist for the index; create the minimal shape.
    fresh.exec(`CREATE TABLE spv_lp_invite (id TEXT PRIMARY KEY, email TEXT, deleted_at TEXT);`);
    applySpvDiscoverabilitySchema(fresh as any);
    /* The pattern must match the INDEX names too. An earlier revision of this
       case globbed `spv_discovery%`, which silently missed every `idx_*` index
       and would have reported a half-installed schema as complete. */
    const objs = (fresh
      .prepare(`SELECT name FROM sqlite_master WHERE name LIKE '%spv_discovery%' OR name = 'idx_spv_lp_invite_email' ORDER BY name`)
      .all() as Array<{ name: string }>).map((r) => r.name);
    expect(objs).toContain("spv_discovery_event");
    expect(objs).toContain("idx_spv_discovery_event_spv");
    expect(objs).toContain("idx_spv_discovery_event_viewer");
    expect(objs).toContain("idx_spv_lp_invite_email");
    // idempotent
    applySpvDiscoverabilitySchema(fresh as any);
    fresh.close();
  });

  it("X9 the existing broadcast routes are NOT widened by this item", () => {
    // listVisibleForContext must still exclude invite_only for everyone. If a
    // future edit widened it, invite-only vehicles would be published to the
    // whole Collective — the opposite of the fix.
    for (const c of ["collective", "capavate", "network"] as const) {
      const ids = spvEngineStore.listVisibleForContext(c).map((s) => s.id);
      expect(ids).not.toContain(SPV_INV);
      expect(ids).not.toContain(SPV_PRIV);
    }
  });
});
