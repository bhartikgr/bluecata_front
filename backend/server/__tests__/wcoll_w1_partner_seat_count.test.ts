/**
 * server/__tests__/wcoll_w1_partner_seat_count.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.4 as corrected by v5 §F. ONE seat number, read
 * from the durable table, used by both ENFORCEMENT and DISPLAY.
 *
 * CONTEXT. `partnerTeamStore.countActiveSeats()` counted rows in the in-process
 * `teamMembers` array. That array is a rebuildable projection (see
 * `hydratePartnerWorkspaceStore`), so on a cold or partially-hydrated process it
 * UNDER-reports. Both consumers are load-bearing:
 *
 *   requirePartnerAuth.assertTierSeats()  — ENFORCES the paid seat limit
 *   partnerDashboardSnapshot().team       — SHOWS `activeSeats` to the partner
 *
 * An under-count on the enforcement path lets a partner invite past the tier
 * they paid for; an under-count on the display path makes the workspace
 * disagree with the admin view of the same organisation.
 *
 * Two deliberate asymmetries are pinned here because they are easy to "tidy"
 * into a bug:
 *
 *   1. The count is of SEAT ROWS and is NOT de-duplicated. A seat row is what
 *      the tier limit is sold and enforced against; collapsing duplicates in
 *      `countActiveSeats`/`seatReport` would silently hand a partner free
 *      capacity. The duplicate-email collapse is DISPLAY-only and the caller
 *      must opt in by passing `emailByUserId`.
 *   2. The read is fail-SAFE, not fail-closed: a durable read error falls back
 *      to the RAM projection rather than returning 0, because 0 here would
 *      UNBLOCK `assertTierSeats` for every partner.
 *
 * METHOD. Every durable row below is inserted with `rawDb()` DIRECTLY, never
 * through `partnerTeamStore.add()`. `add()` is write-through, so using it would
 * put the row in RAM too and the durable read could not be distinguished from
 * the projection. Inserting behind the store's back reproduces exactly the
 * cold-process state that caused the defect.
 *
 * ANTI-VACUITY. On the PRISTINE tree
 * (/home/user/workspace/build/_presnapshot) `countActiveSeats` is
 *   `return teamMembers.filter(...).length;`
 * with no DB read, and `seatReport` does not exist at all. So the durable-read
 * tests fail with `expected 0 to be 2`, the `seatReport` tests fail with
 * `TypeError: partnerTeamStore.seatReport is not a function`, the enforcement
 * test fails because `assertTierSeats` does NOT throw, and the email-collapse
 * test fails because pristine `dedupeActiveTeamMembers` takes no `opts`.
 * Tests that pass on pristine are labelled REGRESSION GUARD.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as conn from "../db/connection";
import { getDb, rawDb } from "../db/connection";
import { partnerTeamStore, partnerDashboardSnapshot } from "../partnerWorkspaceStore";
import { assertTierSeats } from "../lib/requirePartnerAuth";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import type { PartnerTeamMember } from "../partnerWorkspaceStore";

/** `catalyst` is TIER_SEAT_LIMITS 2 — the smallest deterministic cap. */
const PID = "ac_wcoll_seat_partner";
const U_A = "u_wcoll_seat_a";
const U_B = "u_wcoll_seat_b";
/** ONE human, TWO platform userIds — the shape of the LIVE identity merge. */
const SHARED_EMAIL = "one.human@northbridge.example";

function now(): string {
  return new Date().toISOString();
}

/** Insert a durable seat row WITHOUT touching the RAM projection. */
function insertDurableSeat(
  id: string,
  userId: string,
  opts: { subRole?: string; status?: string; partnerId?: string } = {},
): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at,
          created_by, is_seed, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'u_test_admin', 0, ?)`,
    )
    .run(
      id,
      opts.partnerId ?? PID,
      userId,
      opts.subRole ?? "viewer",
      opts.status ?? "active",
      now(),
      now(),
    );
}

function durableRows(partnerId = PID): PartnerTeamMember[] {
  const raw = rawDb()
    .prepare(
      `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed
         FROM partner_team_members WHERE partner_id = ? AND status = 'active'`,
    )
    .all(partnerId) as Record<string, unknown>[];
  return raw.map((r) => ({
    id: String(r.id),
    partnerId: String(r.partner_id),
    userId: String(r.user_id),
    subRole: String(r.sub_role),
    status: "active",
    joinedAt: String(r.joined_at),
    removedAt: null,
    createdBy: String(r.created_by),
    isSeed: false,
  })) as PartnerTeamMember[];
}

function wipe(): void {
  rawDb().prepare("DELETE FROM partner_team_members WHERE partner_id = ?").run(PID);
  // Drop any RAM rows this suite (or a write-through helper) put there.
  for (const m of partnerTeamStore.listByPartner(PID)) {
    try {
      partnerTeamStore.remove(PID, m.userId, "u_test_admin");
    } catch {
      /* already gone */
    }
  }
  rawDb().prepare("DELETE FROM partner_team_members WHERE partner_id = ?").run(PID);
}

beforeAll(() => {
  getDb();
  _registerSeedPartner({
    id: PID,
    legalName: "Northbridge Consortium Partners LLP",
    displayName: "Northbridge",
    email: "ops@northbridge.example",
    region: "North America",
    regionCode: "NA",
    tier: "catalyst",
    partnerType: "angel_network",
  });
});

beforeEach(() => {
  wipe();
});

describe("v5 §F — the seat count comes from the DURABLE table, not the RAM projection", () => {
  it("counts durable rows a cold process has never hydrated", () => {
    insertDurableSeat("ptm_seat_1", U_A);
    insertDurableSeat("ptm_seat_2", U_B);
    // The projection is genuinely empty — this is the cold-process state.
    expect(partnerTeamStore.listByPartner(PID).length).toBe(0);
    expect(partnerTeamStore.countActiveSeats(PID)).toBe(2);
  });

  it("only ACTIVE rows count, and only for the partner asked about", () => {
    insertDurableSeat("ptm_seat_active", U_A);
    insertDurableSeat("ptm_seat_removed", U_B, { status: "removed" });
    insertDurableSeat("ptm_seat_other_org", U_B, { partnerId: "ac_wcoll_seat_other" });
    expect(partnerTeamStore.countActiveSeats(PID)).toBe(1);
    rawDb()
      .prepare("DELETE FROM partner_team_members WHERE partner_id = 'ac_wcoll_seat_other'")
      .run();
  });

  it("neither source may LOWER the other — the higher of durable/RAM wins", () => {
    // A row written by a sibling process is in the DB but not in RAM; a row
    // written here is write-through and is in both. Taking the max is what makes
    // a partially-hydrated process safe.
    insertDurableSeat("ptm_seat_sibling", U_A);
    partnerTeamStore.add(PID, U_B, "viewer", "u_test_admin");
    expect(partnerTeamStore.countActiveSeats(PID)).toBe(2);
  });

  it("REGRESSION GUARD (passes on pristine): a blank partnerId is refused", () => {
    expect(() => partnerTeamStore.countActiveSeats("")).toThrow();
  });
});

describe("v5 §F — a durable read error is fail-SAFE, never 0", () => {
  it("REGRESSION GUARD: a read failure falls back to RAM rather than UNBLOCKING the limit", () => {
    // 0 here would make `active + pending >= seatLimit` false for every partner.
    partnerTeamStore.add(PID, U_A, "viewer", "u_test_admin");
    const spy = vi.spyOn(conn, "rawDb").mockImplementation(
      () =>
        ({
          prepare: () => {
            throw new Error("partner_team_members unreadable");
          },
        }) as never,
    );
    try {
      const n = partnerTeamStore.countActiveSeats(PID);
      expect(n).toBe(1);
      expect(n).not.toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("seatReport labels a fallback so the number is never presented as durable", () => {
    partnerTeamStore.add(PID, U_A, "viewer", "u_test_admin");
    const spy = vi.spyOn(conn, "rawDb").mockImplementation(
      () =>
        ({
          prepare: () => {
            throw new Error("partner_team_members unreadable");
          },
        }) as never,
    );
    try {
      const r = partnerTeamStore.seatReport(PID);
      expect(r.source).toBe("ram_fallback");
      expect(r.activeSeats).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("v5 §F — ONE number: enforcement and display cannot disagree", () => {
  it("`seatReport().activeSeats` is EXACTLY `countActiveSeats()`", () => {
    insertDurableSeat("ptm_one_a", U_A);
    insertDurableSeat("ptm_one_b", U_B);
    const report = partnerTeamStore.seatReport(PID);
    expect(report.activeSeats).toBe(partnerTeamStore.countActiveSeats(PID));
    expect(report.activeSeats).toBe(2);
    expect(report.source).toBe("durable");
  });

  it("the dashboard shows the same figure enforcement uses, from durable rows", () => {
    insertDurableSeat("ptm_dash_a", U_A);
    insertDurableSeat("ptm_dash_b", U_B);
    const snap = partnerDashboardSnapshot(PID);
    expect(snap.team.activeSeats).toBe(2);
    expect(snap.team.activeSeats).toBe(partnerTeamStore.countActiveSeats(PID));
    expect(snap.team.seatLimit).toBe(2); // catalyst
    expect(snap.team.seatCountSource).toBe("durable");
  });

  it("ENFORCEMENT: a full durable table blocks the next invite even with an empty RAM cache", () => {
    insertDurableSeat("ptm_enf_a", U_A);
    insertDurableSeat("ptm_enf_b", U_B);
    expect(partnerTeamStore.listByPartner(PID).length).toBe(0);
    // Pristine under-counts to 0 here and lets the partner past their paid tier.
    expect(() => assertTierSeats(PID)).toThrow("PARTNER_TIER_SEAT_LIMIT_REACHED");
  });

  it("and one free seat still admits an invite (the guard is not simply always-throw)", () => {
    insertDurableSeat("ptm_enf_solo", U_A);
    expect(partnerTeamStore.countActiveSeats(PID)).toBe(1);
    expect(() => assertTierSeats(PID)).not.toThrow();
  });
});

describe("v5 §F — a duplicate seat is COUNTED, and separately made visible", () => {
  it("two rows for the SAME userId are two seats, reported as one distinct user", () => {
    insertDurableSeat("ptm_dup_1", U_A, { subRole: "viewer" });
    insertDurableSeat("ptm_dup_2", U_A, { subRole: "managing_partner" });

    const r = partnerTeamStore.seatReport(PID);
    // Enforcement counts ROWS — collapsing here would be free capacity.
    expect(r.activeSeats).toBe(2);
    // Display evidence: one human, one hidden row, and WHICH row was hidden.
    expect(r.distinctSeatUsers).toBe(1);
    expect(r.duplicateSeatCount).toBe(1);
    expect(r.duplicateSeatIdsByUserId[U_A]).toEqual(["ptm_dup_1"]);
    // Nothing was deleted.
    expect(durableRows().length).toBe(2);
  });

  it("a duplicate still consumes the paid tier — the limit is not widened by it", () => {
    insertDurableSeat("ptm_dupenf_1", U_A);
    insertDurableSeat("ptm_dupenf_2", U_A);
    expect(partnerTeamStore.seatReport(PID).distinctSeatUsers).toBe(1);
    // One HUMAN, but two paid rows: the catalyst cap of 2 is reached.
    expect(() => assertTierSeats(PID)).toThrow("PARTNER_TIER_SEAT_LIMIT_REACHED");
  });

  it("the DUPLICATE-EMAIL case (two userIds, one human) collapses for DISPLAY only", () => {
    insertDurableSeat("ptm_mail_1", U_A, { subRole: "viewer" });
    insertDurableSeat("ptm_mail_2", U_B, { subRole: "managing_partner" });
    const rows = durableRows();
    const emailByUserId = new Map<string, string | null>([
      [U_A, SHARED_EMAIL],
      [U_B, SHARED_EMAIL.toUpperCase()], // case/whitespace-insensitive
    ]);

    const display = partnerTeamStore.dedupeActiveTeamMembers(rows, { emailByUserId });
    expect(display.members.length).toBe(1);
    expect(display.members[0].subRole).toBe("managing_partner"); // most privileged wins
    expect(display.duplicateSeatCount).toBe(1);
    expect(display.duplicateSeatIdsByUserId[U_B]).toEqual(["ptm_mail_1"]);

    // ENFORCEMENT is untouched: still two rows, still two paid seats.
    expect(partnerTeamStore.countActiveSeats(PID)).toBe(2);
    expect(partnerTeamStore.seatReport(PID).activeSeats).toBe(2);
    expect(partnerTeamStore.seatReport(PID).distinctSeatUsers).toBe(2);
  });

  it("a BLANK or unknown email never groups two different people together", () => {
    insertDurableSeat("ptm_blank_1", U_A);
    insertDurableSeat("ptm_blank_2", U_B);
    const rows = durableRows();
    for (const emailByUserId of [
      new Map<string, string | null>([
        [U_A, null],
        [U_B, null],
      ]),
      new Map<string, string | null>([
        [U_A, "   "],
        [U_B, ""],
      ]),
      new Map<string, string | null>(), // resolver returned nothing at all
    ]) {
      const display = partnerTeamStore.dedupeActiveTeamMembers(rows, { emailByUserId });
      expect(display.members.length).toBe(2);
      expect(display.duplicateSeatCount).toBe(0);
    }
  });

  it("REGRESSION GUARD (passes on pristine): with no email map, grouping is by userId", () => {
    insertDurableSeat("ptm_noopts_1", U_A);
    insertDurableSeat("ptm_noopts_2", U_B);
    const display = partnerTeamStore.dedupeActiveTeamMembers(durableRows());
    expect(display.members.length).toBe(2);
    expect(display.duplicateSeatCount).toBe(0);
  });

  it("the duplicate figures are ZERO for the overwhelming majority (no false alarms)", () => {
    insertDurableSeat("ptm_clean_1", U_A);
    insertDurableSeat("ptm_clean_2", U_B);
    expect(partnerTeamStore.seatReport(PID)).toMatchObject({
      activeSeats: 2,
      distinctSeatUsers: 2,
      duplicateSeatCount: 0,
      duplicateSeatIdsByUserId: {},
      source: "durable",
    });
  });
});

describe("v5 §F — seatReport is READ-ONLY", () => {
  it("reporting does not mutate, delete or renumber any seat row", () => {
    insertDurableSeat("ptm_ro_1", U_A);
    insertDurableSeat("ptm_ro_2", U_A); // a duplicate, the thing most likely to be "cleaned"
    const before = rawDb()
      .prepare(
        `SELECT id, user_id, sub_role, status FROM partner_team_members
          WHERE partner_id = ? ORDER BY id`,
      )
      .all(PID);

    partnerTeamStore.seatReport(PID);
    partnerDashboardSnapshot(PID);

    expect(
      rawDb()
        .prepare(
          `SELECT id, user_id, sub_role, status FROM partner_team_members
            WHERE partner_id = ? ORDER BY id`,
        )
        .all(PID),
    ).toEqual(before);
  });
});
