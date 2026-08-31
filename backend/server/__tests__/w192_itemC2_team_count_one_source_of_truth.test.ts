/**
 * WAVE 192 · ITEM C2 · R160.4 — TWO ADMIN SURFACES DISAGREED ON THE TEAM COUNT.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ON SCREEN. The admin partner detail page showed "Team Members (2)"
 * with ids `ptm_9165f3f80152715d` / `ptm_662e6d2d8605977b`, while the
 * partner-facing team page showed "1 of 2 seats filled, 0 pending". One was wrong.
 *
 * WHICH ONE, ESTABLISHED BY READING BOTH QUERIES.
 *   • ADMIN — `GET /api/admin/partners/:partnerId/workspace/audit` builds
 *     `teamMembers` as a UNION of `partnerTeamStore.listByPartner()` (which filters
 *     `status === "active"`) and a DIRECT DB read whose SELECT carries NO status
 *     filter and NO `removed_at` filter. The union is deliberate — it keeps an
 *     archived partner's rows auditable — and it is CORRECT AS A LIST. Rendering
 *     its `.length` as the number of team members counted removed and non-active
 *     rows as occupied seats. **The admin count was the wrong one.**
 *   • PARTNER — reads `activeSeats` from `GET /api/partner/me/team`, which is
 *     `partnerTeamStore.countActiveSeats()`: `status='active'` plus the canonical
 *     userId collapse. That is also what `lib/requirePartnerAuth.ts` ENFORCES seat
 *     limits against, so it is the platform's operative definition of a seat.
 *
 * SO BOTH NOW DERIVE FROM `countActiveSeats`. The admin endpoint reports
 * `activeSeatCount` from that same function and the admin page renders it. The list
 * is UNCHANGED and still returns every row, because an auditor needs to see the
 * removed ones — they are exactly what made the old count look inflated.
 *
 * ══ WHY THIS MATTERS BEYOND A HEADING (R150.2 / R160.2) ══
 * The owner's false tenant-id theory was reasoned from this inflated count: two
 * rows on the admin screen implied the identity-binding row existed, while
 * `resolvePartnerIdForUser` requires `status='active' AND removed_at IS NULL` and
 * was returning null — collapsing BOTH `partner_own_lp_peers` and
 * `partner_team_peers` to `[]`. §C2-4 demonstrates that mechanism directly on a
 * fixture: a count that ignores both predicates cannot tell you whether the binding
 * exists. PROBABLE origin of the theory, not proven — this wave has no live access.
 *
 * MONEY. This suite asserts no amount, fee, price or currency, and performs no
 * arithmetic beyond counting rows.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const ADMIN = "u_admin";
const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

/* ── THE FIXTURE THAT REPRODUCES THE DISCREPANCY ─────────────────────────────
   A REMOVED membership row: `status` not active AND `removed_at` set. This is the
   exact shape the admin union counted as an occupied seat and the partner surface
   correctly did not.

   HARD-ABORT DISCIPLINE. The inserter VERIFIES the row landed and throws if it did
   not. A harness in this project once silently no-op'd its mutation and emitted a
   false verdict; a fixture that cannot prove it changed the world must fail rather
   than let assertions pass against an unchanged world. */
const GHOST_ID = "ptm_w192_c2_removed_ghost";

function insertRemovedMembership(): void {
  const db = rawDb();
  const cols = (db.prepare(`PRAGMA table_info(partner_team_members)`).all() as Array<{ name: string }>)
    .map((c) => c.name);
  /* Build the INSERT from the real column list rather than assuming a schema: a
     missing NOT NULL column would otherwise throw and be mistaken for a gate. */
  const values: Record<string, unknown> = {
    id: GHOST_ID,
    partner_id: PARTNER_A,
    user_id: "u_w192_c2_departed",
    sub_role: "analyst",
    status: "removed",
    joined_at: "2026-01-01T00:00:00.000Z",
    removed_at: "2026-06-01T00:00:00.000Z",
    created_by: ADMIN,
    is_seed: 0,
    /* Real NOT NULL columns on this table. Discovered by the insert FAILING, which
       is the hard-abort discipline working as designed: the fixture refused to
       proceed on an unchanged world rather than let eight assertions pass
       vacuously. */
    updated_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    tenant_id: "tenant_cp_keiretsu_ca",
  };
  const used = cols.filter((c) => c in values);
  db.prepare(
    `INSERT OR REPLACE INTO partner_team_members (${used.join(", ")}) VALUES (${used.map(() => "?").join(", ")})`,
  ).run(...used.map((c) => values[c]));

  const back = db
    .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = ?`)
    .get(GHOST_ID) as { status: string; removed_at: string | null } | undefined;
  if (!back || back.status === "active" || !back.removed_at) {
    throw new Error(
      "HARD ABORT: insertRemovedMembership() did not create a removed membership row. " +
        "Every assertion about the discrepancy below would be vacuous.",
    );
  }
}

function deleteRemovedMembership(): void {
  rawDb().prepare(`DELETE FROM partner_team_members WHERE id = ?`).run(GHOST_ID);
  const back = rawDb()
    .prepare(`SELECT id FROM partner_team_members WHERE id = ?`)
    .get(GHOST_ID);
  if (back) throw new Error("HARD ABORT: the fixture row was not removed.");
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

afterEach(() => {
  deleteRemovedMembership();
});

/* ════════════════════════════════════════════════════════════════════════════
   C2-1 — THE ASSERTION THE OWNER ASKED FOR: BOTH SURFACES REPORT THE SAME
   NUMBER FOR THE SAME FIXTURE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C2-1 — the admin and partner surfaces agree on the team count", () => {
  it("agree with no removed rows present", async () => {
    const adminR = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    expect(adminR.status).toBe(200);
    const partnerR = await get("/api/partner/me/team", MANAGING);
    expect(partnerR.status).toBe(200);
    expect(typeof adminR.body.activeSeatCount).toBe("number");
    expect(typeof partnerR.body.activeSeats).toBe("number");
    expect(adminR.body.activeSeatCount).toBe(partnerR.body.activeSeats);
  });

  it("agree WITH a removed row present — the case that used to make them disagree", async () => {
    insertRemovedMembership();
    const adminR = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    const partnerR = await get("/api/partner/me/team", MANAGING);
    expect(adminR.status).toBe(200);
    expect(partnerR.status).toBe(200);

    /* THE DISCREPANCY, REPRODUCED AND THEN SHOWN CLOSED. The list grew by the
       removed row; the seat count did not; and the two surfaces still agree. */
    expect(adminR.body.teamMembers.some((m: { id: string }) => m.id === GHOST_ID)).toBe(true);
    expect(adminR.body.activeSeatCount).toBe(partnerR.body.activeSeats);
    /* And this is the actual bug, named: the OLD number and the NEW number differ. */
    expect(adminR.body.teamMembers.length).toBeGreaterThan(adminR.body.activeSeatCount);
  });

  it("both derive from `countActiveSeats` — the one function that defines a seat", async () => {
    insertRemovedMembership();
    const canonical = partnerTeamStore.countActiveSeats(PARTNER_A);
    const adminR = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    const partnerR = await get("/api/partner/me/team", MANAGING);
    expect(adminR.body.activeSeatCount).toBe(canonical);
    expect(partnerR.body.activeSeats).toBe(canonical);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C2-2 — THE OLD NUMBER WAS WRONG, AND THIS NAMES WHY.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C2-2 — `teamMembers.length` counted rows that occupy no seat", () => {
  it("a removed row appears in the LIST and is excluded from the SEAT COUNT", async () => {
    const before = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    const seatsBefore = before.body.activeSeatCount;
    const rowsBefore = before.body.teamMembers.length;

    insertRemovedMembership();
    const after = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);

    /* The list grew — deliberately. An auditor must SEE the removed row. */
    expect(after.body.teamMembers.length).toBe(rowsBefore + 1);
    /* The seat count did NOT. This is the whole fix. */
    expect(after.body.activeSeatCount).toBe(seatsBefore);
  });

  it("the ghost row is reported with its real status, not silently normalised", async () => {
    insertRemovedMembership();
    const r = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    const ghost = r.body.teamMembers.find((m: { id: string }) => m.id === GHOST_ID);
    expect(ghost, "the removed row must still be auditable").toBeTruthy();
    expect(String(ghost.status ?? "")).not.toBe("active");
  });

  it("the audit list is NOT truncated to the seat count", async () => {
    insertRemovedMembership();
    const r = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    /* A tempting but wrong "fix" would have been to filter the list so the two
       numbers matched. That would hide the very rows an auditor opened the page to
       find, and would have destroyed the evidence trail behind R150.2. */
    expect(r.body.teamMembers.length).not.toBe(r.body.activeSeatCount);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C2-3 — THE SEAT DEFINITION IS THE ENFORCED ONE, NOT A DISPLAY CONVENIENCE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C2-3 — the number now shown to an admin is the number the platform enforces", () => {
  it("matches a direct active-row read of the durable table, with removed rows excluded", async () => {
    insertRemovedMembership();
    const activeRows = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members WHERE partner_id = ? AND status = 'active'`,
      )
      .get(PARTNER_A) as { n: number };
    const r = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    /* `countActiveSeats` may report FEWER than the raw active-row count, because it
       collapses duplicate canonical user ids into one human seat. It must never
       report MORE, because that would over-count a paid limit. */
    expect(r.body.activeSeatCount).toBeLessThanOrEqual(activeRows.n);
    /* And it must never count the removed row. */
    expect(r.body.activeSeatCount).toBeLessThan(r.body.teamMembers.length);
  });

  it("a non-admin cannot read the admin audit surface", async () => {
    const r = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, MANAGING);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C2-4 — THE R150.2 / R160.2 LINK, DEMONSTRATED RATHER THAN ASSERTED.
   ════════════════════════════════════════════════════════════════════════════
   The identity binding `resolvePartnerIdForUser` looks for requires BOTH
   `status='active'` AND `removed_at IS NULL`. The inflated count ignored both. So
   a row that made the admin screen read "Team Members (2)" could contribute
   NOTHING to the binding — which is why the owner's reasoning from that number led
   to a tenant-id theory that turned out to be false.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C2-4 — the inflated count could not have told anyone the binding existed", () => {
  it("a row counted by the OLD number satisfies neither predicate the binding requires", () => {
    insertRemovedMembership();
    const row = rawDb()
      .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = ?`)
      .get(GHOST_ID) as { status: string; removed_at: string | null };
    /* Counted by `teamMembers.length`. Invisible to the binding. */
    expect(row.status).not.toBe("active");
    expect(row.removed_at).not.toBeNull();
    const bindable = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .get(GHOST_ID) as { n: number };
    expect(bindable.n).toBe(0);
  });

  it("the NEW number excludes exactly the rows the binding excludes", async () => {
    insertRemovedMembership();
    const bindable = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .get(PARTNER_A) as { n: number };
    const r = await get(`/api/admin/partners/${PARTNER_A}/workspace/audit`, ADMIN);
    /* Not asserted EQUAL, because `countActiveSeats` additionally collapses
       duplicate canonical user ids — a loosening that the binding query does not
       perform. Asserted as a BOUND, which is the honest relationship. */
    expect(r.body.activeSeatCount).toBeLessThanOrEqual(bindable.n);
  });
});
