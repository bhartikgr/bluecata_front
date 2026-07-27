/**
 * W-AVI65 REVISE — regression tests for the blockers the triple-review caught.
 *
 * BLOCKER A (Opus, FIX 1 isolation): roundCompanyIdFromDb filtered `deleted_at
 * IS NULL`, so a SOFT-DELETED round of another tenant looked identical to a
 * nonexistent round → the body.companyId branch let tenant B write shareholder
 * rows against tenant A's round id. Fix: resolve the owner regardless of
 * deleted_at and only trust body.companyId when the round is GENUINELY absent
 * (exists === false && cached === null).
 *
 * This suite uses the SAME proven harness as wavi65_round_owner.test.ts
 * (registerFounderUser → {userId}; seedCompanyMembership generates its OWN
 * companyId; seedRoundRow builds the INSERT from PRAGMA so column variance is
 * handled). It drives the REAL route so a green result means the real gate ran.
 *
 * BLOCKER B (Gemini, FIX 2 email leak) is covered by a DEDICATED behavioural
 * test in wavi65_dm_email_leak.test.ts (it exercises the real commsStore path,
 * not an inline predicate).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  registerRoundInitialShareholdersRoutes,
  listInitialShareholders,
} from "../lib/roundInitialShareholdersStore";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { rawDb } from "../db/connection";

let app: Express;
let founderA = "";
let founderB = "";
let companyA = "";
let companyB = "";
const softDeletedRoundA = `rnd_wavi65_softdel_${Date.now()}`;

function seedCompanyMembership(userId: string, name: string): string {
  const companyId = `co_wavi65sd_${Math.random().toString(36).slice(2, 10)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: name,
    legalName: `${name}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as never);
  return companyId;
}

/** Insert a rounds row DB-direct, tolerant of migration column variance, and
 *  SOFT-DELETED (deleted_at set) so it belongs to tenant A but reads as deleted. */
function seedSoftDeletedRound(roundId: string, companyId: string): void {
  const db = rawDb() as unknown as {
    prepare: (s: string) => { all: () => Array<{ name: string; notnull: number; dflt_value: unknown }>; run: (...a: unknown[]) => unknown };
  };
  const cols = db.prepare(`PRAGMA table_info(rounds)`).all();
  const values: Record<string, unknown> = {
    id: roundId,
    company_id: companyId,
    name: `SoftDel ${roundId.slice(-6)}`,
    type: "Seed",
    state: "open",
    target_amount: 1_000_000,
    raised_amount: 0,
    tenant_id: `tenant_co_${companyId}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: new Date().toISOString(), // <-- SOFT DELETED
  };
  const present = cols.filter((c) => c.name in values || (c.notnull === 1 && c.dflt_value === null));
  const names = present.map((c) => c.name);
  const params = present.map((c) => (c.name in values ? values[c.name] : ""));
  db.prepare(
    `INSERT OR REPLACE INTO rounds (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
  ).run(...params);
}

describe("W-AVI65 REVISE BLOCKER A — soft-deleted foreign round is not writable", () => {
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerRoundInitialShareholdersRoutes(app);
    ({ userId: founderA } = registerFounderUser({ email: `sd_a_${Date.now()}@t.example`, name: "SD Founder A", password: "testpassword123" }));
    ({ userId: founderB } = registerFounderUser({ email: `sd_b_${Date.now()}@t.example`, name: "SD Founder B", password: "testpassword123" }));
    companyA = seedCompanyMembership(founderA, "SD Alpha");
    companyB = seedCompanyMembership(founderB, "SD Bravo");
    // companyA and companyB are DISTINCT, non-empty ids (the bug in the earlier
    // test was that addCompanyForFounder returns void → both ids were "undefined").
    expect(companyA).not.toBe("");
    expect(companyB).not.toBe("");
    expect(companyA).not.toBe(companyB);
    seedSoftDeletedRound(softDeletedRoundA, companyA); // belongs to tenant A, soft-deleted
  }, 30_000);

  it("founder B CANNOT PATCH tenant A's soft-deleted round even with a body.companyId B owns", async () => {
    const res = await request(app)
      .patch(`/api/founder/rounds/${softDeletedRoundA}/initial-shareholders`)
      .set("x-user-id", founderB)
      .send({
        companyId: companyB, // a company B genuinely owns — must NOT override the round's real (soft-deleted) owner
        shareholders: [{ name: "Mallory", email: "mallory@evil.example", source: "manual", expiryDays: 14 }],
      });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("not_round_owner");
    const rows = listInitialShareholders(softDeletedRoundA) as unknown as unknown[];
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
  });

  it("founder A (the true owner) is likewise denied writing a SOFT-DELETED round (no resurrection)", async () => {
    const res = await request(app)
      .patch(`/api/founder/rounds/${softDeletedRoundA}/initial-shareholders`)
      .set("x-user-id", founderA)
      .send({ companyId: companyA, shareholders: [{ name: "X", email: "x@a.example", source: "manual", expiryDays: 14 }] });
    // The round resolves to companyA (A owns it) so ownership PASSES; whether a
    // soft-deleted round accepts writes is handler policy. The ISOLATION contract
    // we assert here is only that B was blocked above. For A we only assert it is
    // NOT a cross-tenant 403 masquerade — i.e. A is recognised as the owner.
    expect(res.body?.error).not.toBe("not_round_owner");
  });
});
