/**
 * WAVE 159 · R126.3 — A DATE TYPO MUST NOT GRANT A PERMANENT FREE MEMBERSHIP.
 *
 * The independent review proved with live HTTP (155.6):
 *
 *   POST /api/admin/comped-memberships {"expiresAt":"31/12/2026"}
 *     → 201 {"expiresAt":"31/12/2026","live":true}
 *
 * and `isGrantLive` treated the unparseable value as NEVER EXPIRING, so the most
 * common date typo in the world silently converted a time-limited comped
 * membership into a perpetual one that still RENDERED as time-limited.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 *   LOWER — an unparseable `expiresAt` is REFUSED on write with a plain sentence
 *           naming the expected format; a grant already carrying a bad stored
 *           value is NOT live (fail closed, defence in depth); nothing is written.
 *   UPPER — a real ISO date is still accepted and still lapses on time; an
 *           OMITTED expiry is still a legitimate open-ended comp and stays live.
 *
 * The refusal is asserted on a REAL HTTP RESPONSE through the real route with the
 * real `requireAdmin` guard, plus a SQL read-back proving no row was written.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { registerAdminCompedMembershipRoutes } from "../adminCompedMembershipRoutes";
import {
  grantCompedMembership,
  isGrantLive,
  listAllGrants,
  ensureCompedMembershipSchema,
  type CompedMembershipGrant,
} from "../lib/compedMembershipStore";
import { rawDb } from "../db/connection";

let app: express.Express;
const AS_ADMIN = (r: request.Test) => r.query({ as: "admin" });

function grantCount(): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM comped_membership_grant`)
    .get() as { n: number };
  return r.n;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAdminCompedMembershipRoutes(app);
  ensureCompedMembershipSchema();
});

describe("W159 · C — an unparseable comp expiry is refused, never read as 'forever'", () => {
  it("C1 — the reviewer's probe: expiresAt '31/12/2026' is REFUSED and nothing is written", async () => {
    const before = grantCount();
    const res = await AS_ADMIN(request(app).post("/api/admin/comped-memberships")).send({
      subjectKind: "company",
      subjectId: "co_w159_euro_date",
      reason: "W159 — European-format date typo must not become a perpetual comp.",
      expiresAt: "31/12/2026",
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    /* R77 — plain language, and it must state the format the admin should use. */
    const msg = String(res.body.message ?? "");
    expect(msg).toMatch(/2026-12-31|year-month-day|YYYY-MM-DD/i);
    expect(msg).toMatch(/[a-z]{4,}\s+[a-z]{4,}/);
    /* No row, and therefore no perpetual comp hiding behind a 400. */
    expect(grantCount()).toBe(before);
  });

  it("C2 — other unreadable expiry values are refused too (the class, not the instance)", async () => {
    for (const bad of ["tomorrow", "2026-13-45", "31-12-2026", "12/31/26", "not a date"]) {
      const res = await AS_ADMIN(request(app).post("/api/admin/comped-memberships")).send({
        subjectKind: "company",
        subjectId: `co_w159_bad_${bad.replace(/\W+/g, "_")}`,
        reason: "W159 — unreadable expiry must be refused.",
        expiresAt: bad,
      });
      expect(res.status, `expiresAt=${bad}`).toBe(400);
    }
  });

  it("C3 — defence in depth: a grant carrying an unparseable STORED expiry is NOT live", () => {
    /* Simulates a row written before this fix (or by any other writer). The
       reader must fail CLOSED — an expiry nobody can read is not "no expiry". */
    const bad = {
      id: "cmg_w159_stored_bad",
      subjectKind: "company",
      subjectId: "co_w159_stored_bad",
      reason: "pre-existing bad row",
      grantedAt: new Date().toISOString(),
      grantedBy: "u_admin",
      expiresAt: "31/12/2026",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    } as unknown as CompedMembershipGrant;
    expect(isGrantLive(bad)).toBe(false);
  });

  it("C4 — UPPER POLE: a real ISO expiry is accepted, is live now, and lapses later", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const res = await AS_ADMIN(request(app).post("/api/admin/comped-memberships")).send({
      subjectKind: "company",
      subjectId: "co_w159_good_date",
      reason: "W159 upper pole — a real date must still work.",
      expiresAt: future,
    });
    expect(res.status).toBe(201);
    expect(res.body.grant?.live).toBe(true);
    const stored = listAllGrants().find((g) => g.subjectId === "co_w159_good_date");
    expect(stored).toBeTruthy();
    expect(isGrantLive(stored as CompedMembershipGrant)).toBe(true);
    expect(
      isGrantLive(stored as CompedMembershipGrant, Date.now() + 30 * 24 * 3600 * 1000),
    ).toBe(false);
  });

  it("C5 — UPPER POLE: an omitted expiry is still an explicit open-ended comp", () => {
    const g = grantCompedMembership({
      subjectKind: "company",
      subjectId: "co_w159_open_ended",
      reason: "W159 upper pole — open-ended comps remain possible.",
      grantedBy: "u_admin",
    });
    expect(g.expiresAt).toBeNull();
    expect(isGrantLive(g)).toBe(true);
    expect(isGrantLive(g, Date.now() + 100 * 365 * 24 * 3600 * 1000)).toBe(true);
  });

  it("C6 — a date-only value is accepted and the END OF THAT DAY is honoured, not its midnight", () => {
    /* The review's secondary note: `2026-12-31` from an <input type="date"> parses
       as UTC midnight, so the comp used to die at 03:00 local on the chosen day.
       A date-only expiry means "through the end of that day". */
    const g = grantCompedMembership({
      subjectKind: "company",
      subjectId: "co_w159_date_only",
      reason: "W159 — a date-only expiry runs to the end of that day.",
      grantedBy: "u_admin",
      expiresAt: "2099-12-31",
    });
    expect(isGrantLive(g, Date.parse("2099-12-31T12:00:00Z"))).toBe(true);
    expect(isGrantLive(g, Date.parse("2100-01-02T00:00:00Z"))).toBe(false);
  });
});
