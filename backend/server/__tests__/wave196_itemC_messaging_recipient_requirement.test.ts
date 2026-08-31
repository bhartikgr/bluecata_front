/**
 * WAVE 196 · ITEM C — WHAT A MESSAGING RECIPIENT ACTUALLY REQUIRES.
 *
 * The owner's standing question: the live LP is unreachable in messaging, R166.5
 * retracted the "Review status" theory, and the current unproven hypothesis is
 * that the LP has no email on record. THE BRIEF SAYS REPORT, DO NOT FIX. Nothing
 * in this file changes behaviour; it EXECUTES the recipient gate against three
 * deliberately-shaped rows so the answer in W196_BUILD.md is proved rather than
 * read off the source.
 *
 * THE CHAIN UNDER TEST, as the running code walks it:
 *
 *   partnerOwnLpPeerIds(gp)            server/lib/partnerDelegatedContext.ts:312
 *     → SELECT DISTINCT sub.investor_id FROM spv_subscription sub
 *       JOIN spv ON spv.id = sub.spv_id WHERE spv.sponsor_partner_id = ?
 *       ── NO subscription-status filter, which is R166.5's retraction, asserted in C1.
 *   → commsUserRef(id)                 server/commsStore.ts:386  (`if (!u) continue;` at :3567)
 *     → durableCommsUserRef(id)        server/lib/commsUserDirectory.ts:283
 *       → userRow(id): SELECT … FROM users WHERE id = ? AND deleted_at IS NULL
 *       → `if (!row) return undefined;`   ← THE ONLY HARD GATE
 *
 * THE THREE POLES.
 *   C2 · an LP with a users row and NO EMAIL AT ALL is reachable  → the hypothesis
 *        "no email ⇒ unreachable" is FALSE AS STATED.
 *   C3 · an LP seated under an UNCLAIMED `ext_…` id, with a real subscription and
 *        no users row, is NOT reachable → this is the real mechanism, and email
 *        matters upstream (minting/claiming the identity), not at the gate.
 *   C4 · a SOFT-DELETED users row is not reachable → `deleted_at IS NULL` is part
 *        of the gate, not decoration.
 *
 * ANTI-VACUITY. Every "unreachable" pole also asserts the subscription row really
 * exists and that the id really is in the candidate list — so each refusal is the
 * GATE holding, never an empty fixture.
 *
 * This file never mutates a money ledger and never parses a money value.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import { partnerOwnLpPeerIds, resolvePartnerIdForUser } from "../lib/partnerDelegatedContext";
import { durableCommsUserRef } from "../lib/commsUserDirectory";
import { lpInvestorIdForEmail } from "../lib/lpIdentity";

const ORG = "porg_w196";
const GP = "u_w196_gp";
const SPV = "spv_w196";
const LP_NO_EMAIL = "u_w196_lp_no_email";
const LP_DELETED = "u_w196_lp_deleted";
const LP_CLAIMED = "u_w196_lp_claimed";

const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb()
      .prepare(sql)
      .run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w196 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, email: string, deleted: boolean): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0, ?)`,
    id,
    email,
    `W196 ${id}`,
    deleted ? now() : null,
  );
}

function seedSubscription(investorId: string, status: string): void {
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', ?, ?, ?, ?, ?)`,
    `sub_w196_${investorId}`,
    SPV,
    investorId,
    status,
    now(),
    now(),
    GP,
    `hash_w196_${investorId}`,
  );
}

/** The off-platform LP: a real subscription seated under the deterministic
 *  `ext_<sha256(email)[0:16]>` id the platform mints, with NO users row. */
const EXT_LP = lpInvestorIdForEmail("someone.offplatform@example.com");

beforeAll(() => {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 'W196 GP', 'investor', 0, NULL)`,
    GP,
    "gp@w196.test",
  );
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', 'active', ?, NULL, ?, 0, ?)`,
    `ptm_w196_${GP}`,
    ORG,
    GP,
    now(),
    GP,
    now(),
  );
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 'W196 Vehicle', 'spv', 'DE', 'open', 'private', 'USD', 'whole_fund',
             'own_only', ?, ?, ?, ?, 'hash_w196_spv')`,
    SPV,
    ORG,
    GP,
    now(),
    GP,
    now(),
    GP,
  );

  /* The LP with a users row and NO email whatsoever — the exact shape the current
     hypothesis says must be unreachable. Its subscription is deliberately left in
     a NON-active status to re-prove R166.5's retraction at the same time. */
  /* FOUND WHILE WRITING THIS TEST, AND IT SHARPENS THE ANSWER: `users.email` is
     NOT NULL in the schema, so a users row can never have a NULL email at all —
     the emptiest an on-platform person's email can be is the empty string. That is
     the shape seeded here, and it is the closest thing to "no email on record"
     that can exist for someone who HAS a users row. */
  seedUser(LP_NO_EMAIL, "", false);
  seedSubscription(LP_NO_EMAIL, "invited");

  /* A soft-deleted LP. */
  seedUser(LP_DELETED, "deleted@w196.test", true);
  seedSubscription(LP_DELETED, "committed");

  /* A fully claimed LP — the positive control, so the fixture cannot pass by
     being uniformly broken. */
  seedUser(LP_CLAIMED, "claimed@w196.test", false);
  seedSubscription(LP_CLAIMED, "committed");

  /* The off-platform LP: subscription only, no users row. */
  seedSubscription(EXT_LP, "committed");
});

describe("WAVE 196 · C1 — the candidate list has no status filter (R166.5 retraction, re-proved)", () => {
  it("C1a the GP resolves to the partner org, so the fixture is live", () => {
    expect(resolvePartnerIdForUser(GP)).toBe(ORG);
  });

  it("C1b every subscriber is a candidate regardless of subscription status or users row", () => {
    const ids = partnerOwnLpPeerIds(GP);
    expect(ids).toContain(LP_NO_EMAIL); /* status "invited" */
    expect(ids).toContain(LP_CLAIMED); /* status "committed" */
    expect(ids).toContain(EXT_LP); /* no users row at all */
    /* So nothing about "Review status" or subscription state removes a person
       from the candidate set. The exclusion happens later, at the users row. */
  });
});

describe("WAVE 196 · C2 — AN LP WITH NO EMAIL ON RECORD IS REACHABLE", () => {
  it("C2a users.email is NOT NULL, so the emptiest possible email is the empty string", () => {
    /* Asserted against the live schema rather than assumed: this is why the answer
       in W196_BUILD.md is phrased as "no usable email", not "a NULL email". */
    const cols: any[] = rawDb().prepare(`PRAGMA table_info(users)`).all() as any[];
    const emailCol = cols.find((c) => c.name === "email");
    expect(emailCol).toBeTruthy();
    expect(emailCol.notnull).toBe(1);
    const row: any = rawDb().prepare(`SELECT email FROM users WHERE id = ?`).get(LP_NO_EMAIL);
    expect(row).toBeTruthy();
    expect(String(row.email).trim()).toBe("");
  });

  it("C2b the recipient gate RESOLVES them — email is not required", () => {
    const ref = durableCommsUserRef(LP_NO_EMAIL);
    expect(ref).toBeTruthy();
    expect(ref?.id).toBe(LP_NO_EMAIL);
    /* The directory returns an empty string rather than refusing. */
    expect(ref?.email).toBe("");
  });

  it("C2c THE HYPOTHESIS IS FALSE AS STATED: no email does not make an LP unreachable", () => {
    expect(partnerOwnLpPeerIds(GP)).toContain(LP_NO_EMAIL);
    expect(durableCommsUserRef(LP_NO_EMAIL)).toBeTruthy();
  });
});

describe("WAVE 196 · C3 — THE REAL MECHANISM: no users row, no recipient", () => {
  it("C3a the off-platform id is the deterministic ext_ identity, not an invention", () => {
    expect(EXT_LP.startsWith("ext_")).toBe(true);
    expect(EXT_LP).toBe(lpInvestorIdForEmail("SOMEONE.OFFPLATFORM@example.com "));
  });

  it("C3b the subscription really exists (anti-vacuity)", () => {
    const row: any = rawDb()
      .prepare(`SELECT investor_id FROM spv_subscription WHERE investor_id = ?`)
      .get(EXT_LP);
    expect(row?.investor_id).toBe(EXT_LP);
    expect(partnerOwnLpPeerIds(GP)).toContain(EXT_LP);
  });

  it("C3c there is no users row, and the gate therefore drops them", () => {
    const row = rawDb().prepare(`SELECT id FROM users WHERE id = ?`).get(EXT_LP);
    expect(row).toBeUndefined();
    expect(durableCommsUserRef(EXT_LP)).toBeUndefined();
  });
});

describe("WAVE 196 · C4 — a soft-deleted row is not a recipient", () => {
  it("C4a the row exists but is soft-deleted (anti-vacuity)", () => {
    const row: any = rawDb().prepare(`SELECT deleted_at FROM users WHERE id = ?`).get(LP_DELETED);
    expect(row).toBeTruthy();
    expect(row.deleted_at).toBeTruthy();
  });

  it("C4b the gate drops them, so deleted_at IS NULL is part of the requirement", () => {
    expect(partnerOwnLpPeerIds(GP)).toContain(LP_DELETED);
    expect(durableCommsUserRef(LP_DELETED)).toBeUndefined();
  });
});

describe("WAVE 196 · C5 — the positive control", () => {
  it("C5a a fully claimed LP resolves, so C3/C4 are the gate and not a broken fixture", () => {
    const ref = durableCommsUserRef(LP_CLAIMED);
    expect(ref).toBeTruthy();
    expect(ref?.id).toBe(LP_CLAIMED);
  });
});
