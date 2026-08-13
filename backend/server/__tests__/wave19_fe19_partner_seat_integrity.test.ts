/**
 * WAVE 19 — FE-19 (SEAT-02 / SEAT-04): partner team-seat integrity.
 *
 * TWO defects, both confirmed at source before a line was written:
 *
 *   SEAT-02 — `partnerInvitationStore.countPendingByPartner()` filtered a
 *   module-level `teamInvitations` ARRAY and read nothing durable. A freshly
 *   started process, or a second process behind a load balancer, sees zero
 *   pending invitations and issues a full tier's worth of extra seats. The
 *   sibling `countActiveSeats()` had already been fixed for exactly this and
 *   reads the durable table; pending had been missed. It also violates the
 *   standing "no in-memory anywhere" rule on a PAID limit.
 *
 *   SEAT-04 — `POST /api/partner/me/team/invitations`
 *   (server/partnerRoutes.ts:1420) ran `assertTierSeats()` and then, as a
 *   separate unprotected statement, `partnerInvitationStore.create()`. Nothing
 *   held a lock between them, so two concurrent requests could both observe
 *   the last free seat and both create an invitation.
 *
 * WHY THE TESTS LOOK LIKE THIS
 * ----------------------------
 * The SEAT-02 assertion deliberately writes a pending invitation row STRAIGHT
 * INTO SQLITE and never into the RAM array, because that is precisely the
 * state a sibling process produces. A test that created the invitation through
 * the store would populate both and could not tell a durable read from a RAM
 * read — it would be a check that checks nothing.
 *
 * The SEAT-04 assertion proves the guard runs INSIDE the transaction by having
 * the guard throw and then asserting no row was written, and by having the
 * guard observe a row that a re-entrant durable read can only see if the read
 * happens after BEGIN.
 *
 * A SOURCE FENCE covers the wiring: an engine with no route is not shipped, so
 * the route must actually call the transactional path and must no longer do a
 * bare check-then-create.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { getDb, rawDb } from "../db/connection";
import {
  seedTestPartnerSandbox,
  partnerInvitationStore,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { assertSeatCapacity, assertTierSeats } from "../lib/requirePartnerAuth";

const ROOT = path.resolve(__dirname, "../..");
const ROUTES_SRC = fs.readFileSync(path.join(ROOT, "server/partnerRoutes.ts"), "utf8");
const STORE_SRC = fs.readFileSync(path.join(ROOT, "server/partnerWorkspaceStore.ts"), "utf8");
const AUTH_SRC = fs.readFileSync(path.join(ROOT, "server/lib/requirePartnerAuth.ts"), "utf8");

const PARTNER = TEST_PARTNER_ID;
const MANAGING = TEST_PARTNER_USERS.managing.userId;

/** Write a pending invitation row DIRECTLY to SQLite — never into RAM. This is
 *  what a sibling process leaves behind, and it is the only honest way to tell
 *  a durable count apart from an array filter. */
function insertDurableOnlyPendingInvitation(partnerId: string, email: string, id?: string): string {
  const rowId = id ?? `pinv_durable_${Math.random().toString(36).slice(2)}`;
  const nowIso = new Date().toISOString();
  const inv = {
    id: rowId,
    partnerId,
    invitedEmail: email,
    subRole: "analyst",
    title: null,
    tokenHash: `hash_${rowId}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    redeemedAt: null,
    redeemedUserId: null,
    createdAt: nowIso,
    createdBy: MANAGING,
    ipLogged: null,
    uaLogged: null,
    isSeed: false,
  };
  rawDb()
    .prepare(
      `INSERT INTO partner_team_invitations (id, partner_id, invitation_json, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(rowId, partnerId, JSON.stringify(inv), nowIso);
  return rowId;
}

function durableRowCount(partnerId: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM partner_team_invitations WHERE partner_id = ?`)
    .get(partnerId) as { n: number };
  return Number(r.n);
}

function clearDurableInvitations(partnerId: string): void {
  rawDb().prepare(`DELETE FROM partner_team_invitations WHERE partner_id = ?`).run(partnerId);
}

beforeAll(() => {
  getDb();
  seedTestPartnerSandbox();
});

beforeEach(() => {
  clearDurableInvitations(PARTNER);
});

/* ==================================================================== */
describe("FE-19 / SEAT-02 — the pending count is DURABLE, not a RAM array", () => {
  it("sees a pending invitation that exists ONLY in SQLite (the sibling-process case)", () => {
    const before = partnerInvitationStore.countPendingByPartner(PARTNER);
    insertDurableOnlyPendingInvitation(PARTNER, "sibling@example.com");
    const after = partnerInvitationStore.countPendingByPartner(PARTNER);
    expect(after).toBe(before + 1);
  });

  it("does NOT count a redeemed durable row", () => {
    const id = insertDurableOnlyPendingInvitation(PARTNER, "redeemed@example.com");
    const before = partnerInvitationStore.countPendingByPartner(PARTNER);
    const row = rawDb()
      .prepare(`SELECT invitation_json FROM partner_team_invitations WHERE id = ?`)
      .get(id) as { invitation_json: string };
    const inv = JSON.parse(row.invitation_json);
    inv.redeemedAt = new Date().toISOString();
    rawDb()
      .prepare(`UPDATE partner_team_invitations SET invitation_json = ? WHERE id = ?`)
      .run(JSON.stringify(inv), id);
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBe(before - 1);
  });

  it("does NOT count an EXPIRED durable row (ISO strings compare correctly in SQL)", () => {
    const id = insertDurableOnlyPendingInvitation(PARTNER, "expired@example.com");
    const before = partnerInvitationStore.countPendingByPartner(PARTNER);
    const row = rawDb()
      .prepare(`SELECT invitation_json FROM partner_team_invitations WHERE id = ?`)
      .get(id) as { invitation_json: string };
    const inv = JSON.parse(row.invitation_json);
    inv.expiresAt = new Date(Date.now() - 60_000).toISOString();
    rawDb()
      .prepare(`UPDATE partner_team_invitations SET invitation_json = ? WHERE id = ?`)
      .run(JSON.stringify(inv), id);
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBe(before - 1);
  });

  it("does NOT count another partner's pending invitation", () => {
    const before = partnerInvitationStore.countPendingByPartner(PARTNER);
    insertDurableOnlyPendingInvitation("ctc_some_other_partner", "other@example.com");
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBe(before);
    clearDurableInvitations("ctc_some_other_partner");
  });

  it("countPendingDurable answers the same question in pure SQL", () => {
    insertDurableOnlyPendingInvitation(PARTNER, "a@example.com");
    insertDurableOnlyPendingInvitation(PARTNER, "b@example.com");
    const n = partnerInvitationStore.countPendingDurable(PARTNER, new Date().toISOString());
    expect(n).toBe(2);
  });

  it("NEVER RETURNS ZERO ON A DURABLE FAILURE — it falls back to the RAM projection", () => {
    /* Rule 3, applied to a limit rather than to a screen: an outage must not
       mint free seats. `countPendingDurable` is made to throw; the count must
       still return the RAM figure, and specifically must not collapse to 0. */
    const created = partnerInvitationStore.create(
      PARTNER, "ramonly@example.com", "analyst", MANAGING, {},
    );
    expect(created.invitation.id).toBeTruthy();
    const healthy = partnerInvitationStore.countPendingByPartner(PARTNER);
    expect(healthy).toBeGreaterThanOrEqual(1);

    const original = partnerInvitationStore.countPendingDurable;
    (partnerInvitationStore as any).countPendingDurable = () => {
      throw new Error("simulated durable read failure");
    };
    try {
      const degraded = partnerInvitationStore.countPendingByPartner(PARTNER);
      expect(degraded).toBeGreaterThanOrEqual(1);
      expect(degraded).not.toBe(0);
    } finally {
      (partnerInvitationStore as any).countPendingDurable = original;
    }
  });

  it("takes the HIGHER of durable and RAM — neither source may lower the other", () => {
    /* Deliberately computed rather than hardcoded: the RAM array is
       module-level and survives `beforeEach` (which clears only the durable
       table), so an absolute number here would be order-dependent — the exact
       kind of fixture that makes a suite pass for the wrong reason. */
    const nowIso = new Date().toISOString();
    partnerInvitationStore.create(PARTNER, "ram1@example.com", "analyst", MANAGING, {});
    const ramOnly = partnerInvitationStore.countPendingByPartner(PARTNER);
    const durableBefore = partnerInvitationStore.countPendingDurable(PARTNER, nowIso);
    insertDurableOnlyPendingInvitation(PARTNER, "durable1@example.com");
    const durableAfter = partnerInvitationStore.countPendingDurable(PARTNER, new Date().toISOString());
    expect(durableAfter).toBe(durableBefore + 1);
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBe(
      Math.max(durableAfter, ramOnly),
    );
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBeGreaterThanOrEqual(durableAfter);
  });

  it("SOURCE FENCE — the pending count no longer returns a bare array filter", () => {
    const body = STORE_SRC.slice(
      STORE_SRC.indexOf("  countPendingByPartner(partnerId: string): number {"),
      STORE_SRC.indexOf("  countPendingDurable("),
    );
    expect(body).toContain("countPendingDurable");
    expect(body).toContain("Math.max");
  });
});

/* ==================================================================== */
describe("FE-19 / SEAT-04 — the seat check and the insert are ONE transaction", () => {
  it("a guard that throws leaves NO invitation row behind (the tx rolled back)", () => {
    const before = durableRowCount(PARTNER);
    expect(() =>
      partnerInvitationStore.createWithSeatGuard(
        PARTNER, "rejected@example.com", "analyst", MANAGING,
        () => { throw new Error("PARTNER_TIER_SEAT_LIMIT_REACHED"); },
        {},
      ),
    ).toThrow("PARTNER_TIER_SEAT_LIMIT_REACHED");
    expect(durableRowCount(PARTNER)).toBe(before);
  });

  it("a guard that throws also leaves nothing in the RAM cache", () => {
    const before = partnerInvitationStore.countPendingByPartner(PARTNER);
    try {
      partnerInvitationStore.createWithSeatGuard(
        PARTNER, "rejected2@example.com", "analyst", MANAGING,
        () => { throw new Error("PARTNER_TIER_SEAT_LIMIT_REACHED"); },
        {},
      );
    } catch { /* expected */ }
    expect(partnerInvitationStore.countPendingByPartner(PARTNER)).toBe(before);
  });

  it("a guard that passes writes the row durably and returns a one-time token", () => {
    const before = durableRowCount(PARTNER);
    const { invitation, plainToken } = partnerInvitationStore.createWithSeatGuard(
      PARTNER, "Accepted@Example.com", "analyst", MANAGING, () => undefined, {},
    );
    expect(durableRowCount(PARTNER)).toBe(before + 1);
    expect(invitation.invitedEmail).toBe("accepted@example.com");
    expect(plainToken).toMatch(/^[0-9a-f]{48}$/);
    /* The raw token must never be stored — only its hash. */
    const row = rawDb()
      .prepare(`SELECT invitation_json FROM partner_team_invitations WHERE id = ?`)
      .get(invitation.id) as { invitation_json: string };
    expect(row.invitation_json).not.toContain(plainToken);
  });

  it("THE RACE: the guard sees counts read INSIDE the transaction, not stale ones", () => {
    /* The whole point of SEAT-04. A row inserted after the caller would have
       done its old pre-flight check, but before this call, must still be
       visible to the guard. If the counts were captured before BEGIN, the
       guard would be handed the stale figure and this assertion would fail. */
    clearDurableInvitations(PARTNER);
    const stale = partnerInvitationStore.countPendingDurable(PARTNER, new Date().toISOString());
    insertDurableOnlyPendingInvitation(PARTNER, "arrived-late@example.com");

    let seen = -1;
    partnerInvitationStore.createWithSeatGuard(
      PARTNER, "racer@example.com", "analyst", MANAGING,
      (counts) => { seen = counts.pending; },
      {},
    );
    expect(stale).toBe(0);
    expect(seen).toBe(1);
  });

  it("the guard is also handed the DURABLE active-seat count", () => {
    let seen = -1;
    partnerInvitationStore.createWithSeatGuard(
      PARTNER, "seats@example.com", "analyst", MANAGING,
      (counts) => { seen = counts.activeSeats; },
      {},
    );
    expect(seen).toBe(partnerTeamStore.countActiveSeats(PARTNER));
    expect(seen).toBeGreaterThan(0);
  });

  it("SOURCE FENCE — the transaction is IMMEDIATE (the write lock is taken at BEGIN)", () => {
    const body = STORE_SRC.slice(
      STORE_SRC.indexOf("  createWithSeatGuard("),
      STORE_SRC.indexOf("  countPendingByPartner(partnerId: string): number {"),
    );
    expect(body).toContain("db.transaction(");
    expect(body).toContain("run.immediate");
    /* The guard must be called inside the tx body, before the INSERT. */
    const guardAt = body.indexOf("guard({ activeSeats, pending })");
    const insertAt = body.indexOf("INSERT INTO partner_team_invitations");
    expect(guardAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(guardAt);
  });
});

/* ==================================================================== */
describe("FE-19 — the seat POLICY is unchanged, only its call site moved", () => {
  it("assertSeatCapacity rejects when active + pending has reached the limit", () => {
    expect(() => assertSeatCapacity(PARTNER, { activeSeats: 10_000, pending: 0 })).toThrow(
      "PARTNER_TIER_SEAT_LIMIT_REACHED",
    );
    expect(() => assertSeatCapacity(PARTNER, { activeSeats: 0, pending: 10_000 })).toThrow(
      "PARTNER_TIER_SEAT_LIMIT_REACHED",
    );
  });

  it("assertSeatCapacity counts pending against the limit, not only active seats", () => {
    /* If pending were dropped from the sum, a partner could hold unlimited
       outstanding invitations and blow past the tier the moment they redeem. */
    let limit = 0;
    for (let n = 0; n < 10_000; n++) {
      try { assertSeatCapacity(PARTNER, { activeSeats: 0, pending: n }); } catch { limit = n; break; }
    }
    expect(limit).toBeGreaterThan(0);
    expect(() => assertSeatCapacity(PARTNER, { activeSeats: 1, pending: limit - 1 })).toThrow();
  });

  it("an unknown partner is rejected, not defaulted to a tier", () => {
    expect(() => assertSeatCapacity("ctc_no_such_partner", { activeSeats: 0, pending: 0 })).toThrow(
      "PARTNER_NOT_FOUND",
    );
  });

  it("assertTierSeats still exists and still delegates to the same policy", () => {
    /* Rule 4 / rule 1: the read-only callers must not have been silently
       dropped, and they must not have drifted onto a second definition. */
    expect(typeof assertTierSeats).toBe("function");
    const body = AUTH_SRC.slice(
      AUTH_SRC.indexOf("export function assertTierSeats("),
      AUTH_SRC.indexOf("export function assertSeatCapacity("),
    );
    expect(body).toContain("assertSeatCapacity(partnerId");
    expect(body).toContain("countPendingByPartner");
  });
});

/* ==================================================================== */
describe("FE-19 — WIRING: the route uses the transactional path", () => {
  const routeBody = ROUTES_SRC.slice(
    ROUTES_SRC.indexOf('"/api/partner/me/team/invitations"'),
    ROUTES_SRC.indexOf('"/api/partner/me/team/invitations"') + 3500,
  );

  it("the invite route calls createWithSeatGuard", () => {
    expect(routeBody).toContain("partnerInvitationStore.createWithSeatGuard(");
  });

  it("the invite route NO LONGER does a bare check-then-create", () => {
    expect(routeBody).not.toContain("assertTierSeats(ctx.partnerId)");
    expect(routeBody).not.toContain("partnerInvitationStore.create(\n");
  });

  it("the 403 contract the client already renders is preserved verbatim", () => {
    /* Rule 5 / rule 3: the failure must still be RENDERABLE by the existing
       client copy. Changing the error string would silently blank the banner. */
    expect(routeBody).toContain("PARTNER_TIER_SEAT_LIMIT_REACHED");
    expect(routeBody).toContain("res.status(403)");
  });

  it("a non-seat error is NOT laundered into a 403", () => {
    /* A 403 says 'you may not'. A storage failure is not that, and dressing it
       up as one would tell the partner to buy seats they do not need. */
    expect(routeBody).toMatch(/throw e;/);
  });

  it("POLICY: the boundary is EXCLUSIVE — the limit-th seat is refused, limit-1 is allowed", () => {
    /* FE-19 falsification MISS #16 (parent, 2026-08-11). The harness mutated
       `>= seatLimit` to `> seatLimit` and NOTHING failed: 23 tests passed while
       the limit-th seat was handed out, i.e. every paid tier silently sold one
       seat too many. The suite tested "over the limit is refused" and "under the
       limit is allowed" but never the boundary itself. Off-by-one at a seat
       boundary is a billing defect on a tier the owner charges for. */
    const authBody = fs.readFileSync(path.join(ROOT, "server/lib/requirePartnerAuth.ts"), "utf8");
    // Pin the comparison operator itself; `>` instead of `>=` is the whole defect.
    expect(authBody).toMatch(/counts\.activeSeats \+ counts\.pending >= seatLimit/);
    expect(authBody).not.toMatch(/counts\.activeSeats \+ counts\.pending > seatLimit/);
  });

  it("the 403 error STRING is the exact token the client banner matches on", () => {
    /* FE-19 falsification MISS #20 (parent, 2026-08-11). The harness renamed the
       error string and nothing failed — yet `client/src/pages/partner/PartnerTeam.tsx`
       surfaces invite failures by message, so a drifted token blanks the banner and
       the partner sees a silent no-op instead of "you are out of seats". This is a
       cross-layer contract with no owner, so it is pinned on BOTH sides. */
    /* Pin the RESPONSE FIELD, not merely the token's presence anywhere. The first
       version of this assertion was `toContain("PARTNER_TIER_SEAT_LIMIT_REACHED")`
       and the harness still MISSED: that token also appears in the `msg.includes(...)`
       guard two lines above, so it passed while the JSON the client actually
       receives had been mutated to `error: "seat limit"`. */
    expect(routeBody).toContain(
      'error: msg.includes("PARTNER_NOT_FOUND") ? "PARTNER_NOT_FOUND" : "PARTNER_TIER_SEAT_LIMIT_REACHED",',
    );
    const authBody = fs.readFileSync(path.join(ROOT, "server/lib/requirePartnerAuth.ts"), "utf8");
    expect(authBody).toContain('throw new Error("PARTNER_TIER_SEAT_LIMIT_REACHED")');
    // The client must keep rendering the server's message; if this affordance is
    // removed the banner goes silent even with the token intact.
    const teamPage = fs.readFileSync(path.join(ROOT, "client/src/pages/partner/PartnerTeam.tsx"), "utf8");
    expect(teamPage).toMatch(/surface invite \+ remove failures/);
  });

  it("migration 0172 exists in BOTH migration directories, byte-identical", () => {
    const a = fs.readFileSync(path.join(ROOT, "migrations/0172_wave19_partner_invitation_seat_integrity.sql"));
    const b = fs.readFileSync(path.join(ROOT, "server/db/migrations/0172_wave19_partner_invitation_seat_integrity.sql"));
    expect(a.equals(b)).toBe(true);
    expect(a.toString()).toContain("idx_pti_partner_pending");
  });
});
