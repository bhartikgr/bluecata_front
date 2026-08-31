/**
 * WAVE 199 · ITEM C · O3 — A REVIEW-STATUS LP REMAINS AN ELIGIBLE RECIPIENT.
 *
 * THE OWNER'S WORDS: "Yes, GP should be able to communicate with the prospective
 * investor."
 *
 * WHY THIS FILE EXISTS. Nothing in wave 199 changes messaging behaviour. The
 * behaviour is already correct: `partnerOwnLpPeerIds`
 * (server/lib/partnerDelegatedContext.ts) has NO `sub.status` predicate, so an
 * investor whose subscription is still under review is a candidate recipient. What
 * did not exist was anything stopping a future wave from "hardening" that query and
 * silently deleting the conversation the ruling authorises. This test is that stop,
 * and the comment at the query names it.
 *
 * WHAT IT ASSERTS
 *   O3-1 · an LP whose subscription status is 'review' IS in the candidate list.
 *   O3-2 · so are 'invited' and 'pending' — the assertion is about the ABSENCE of a
 *          status filter, not about one blessed string, so a filter that happened to
 *          allow 'review' and drop 'invited' still fails here.
 *   O3-3 · the review-status LP survives the WHOLE chain to a resolved directory
 *          entry (`durableCommsUserRef`), which is what "eligible recipient"
 *          actually means end to end.
 *   O3-4 · ANTI-VACUITY / the real gate: the same review-status subscription seated
 *          under an UNCLAIMED id (no `users` row) is NOT resolvable, while its id IS
 *          still in the candidate list. Eligibility turns on a claimed account, not
 *          on status — so O3-1..3 cannot be passing because the gate is open to
 *          everything.
 *   O3-5 · ANTI-VACUITY: the emails are irrelevant. The review-status LP is seeded
 *          with an EMPTY email and still resolves (wave 196's finding, re-executed
 *          here so this file's own fixture cannot hide behind a good email).
 *
 * This file writes no money value, parses no money value and touches no ledger.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import { partnerOwnLpPeerIds, resolvePartnerIdForUser } from "../lib/partnerDelegatedContext";
import { durableCommsUserRef } from "../lib/commsUserDirectory";

const ORG = "porg_w199";
const GP = "u_w199_gp";
const SPV = "spv_w199";
const LP_REVIEW = "u_w199_lp_review";
const LP_INVITED = "u_w199_lp_invited";
const LP_PENDING = "u_w199_lp_pending";
const LP_COMMITTED = "u_w199_lp_committed";
/** A review-status subscription with NO account behind it. */
const LP_UNCLAIMED = "ext_w199unclaimed01";

const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is a vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb()
      .prepare(sql)
      .run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w199 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, email: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0, NULL)`,
    id,
    email,
    `W199 ${id}`,
  );
}

function seedSubscription(investorId: string, status: string): void {
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', ?, ?, ?, ?, ?)`,
    `sub_w199_${investorId}`,
    SPV,
    investorId,
    status,
    now(),
    now(),
    GP,
    `hash_w199_${investorId}`,
  );
}

beforeAll(() => {
  seedUser(GP, "gp@w199.test");
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', 'active', ?, NULL, ?, 0, ?)`,
    `ptm_w199_${GP}`,
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
     VALUES (?, ?, ?, 'W199 Vehicle', 'spv', 'DE', 'open', 'private', 'USD', 'whole_fund',
             'own_only', ?, ?, ?, ?, 'hash_w199_spv')`,
    SPV,
    ORG,
    GP,
    now(),
    GP,
    now(),
    GP,
  );

  /* THE SUBJECT OF THE RULING: a prospective investor under review. Seeded with an
     EMPTY email on purpose (see O3-5). */
  seedUser(LP_REVIEW, "");
  seedSubscription(LP_REVIEW, "review");

  /* Two more not-yet-accepted statuses, so the assertion is about the absence of a
     filter rather than about the single word "review". */
  seedUser(LP_INVITED, "invited@w199.test");
  seedSubscription(LP_INVITED, "invited");
  seedUser(LP_PENDING, "pending@w199.test");
  seedSubscription(LP_PENDING, "pending");

  /* Positive control — an accepted LP. If this one were missing too, the fixture
     itself would be broken and the "eligible" assertions would prove nothing. */
  seedUser(LP_COMMITTED, "committed@w199.test");
  seedSubscription(LP_COMMITTED, "committed");

  /* A review-status subscription with NO users row: the real gate. */
  seedSubscription(LP_UNCLAIMED, "review");
});

describe("WAVE 199 · ITEM C · O3 — GP ↔ prospective investor is intentional", () => {
  it("O3-0 · the fixture's GP really resolves to the sponsoring partner", () => {
    expect(resolvePartnerIdForUser(GP)).toBe(ORG);
  });

  it("O3-1 · a REVIEW-status LP is an eligible recipient candidate", () => {
    expect(partnerOwnLpPeerIds(GP)).toContain(LP_REVIEW);
  });

  it("O3-2 · so are 'invited' and 'pending' — there is no status filter at all", () => {
    const ids = partnerOwnLpPeerIds(GP);
    expect(ids).toContain(LP_INVITED);
    expect(ids).toContain(LP_PENDING);
    /* The positive control, proving the list is not simply everything-or-nothing. */
    expect(ids).toContain(LP_COMMITTED);
  });

  it("O3-3 · the review-status LP resolves all the way to a directory entry", () => {
    const ref = durableCommsUserRef(LP_REVIEW);
    expect(ref).toBeTruthy();
    expect(ref?.id).toBe(LP_REVIEW);
  });

  it("O3-4 · eligibility is a CLAIMED ACCOUNT, not a status: an unclaimed review-status id is a candidate but does not resolve", () => {
    /* Still a candidate — the query does not filter it out … */
    expect(partnerOwnLpPeerIds(GP)).toContain(LP_UNCLAIMED);
    /* … and its subscription genuinely exists, so this is not an empty fixture. */
    const row = rawDb()
      .prepare(`SELECT status FROM spv_subscription WHERE investor_id = ?`)
      .get(LP_UNCLAIMED) as { status?: string } | undefined;
    expect(row?.status).toBe("review");
    /* … but with no `users` row it cannot be addressed. THAT is the gate. */
    expect(durableCommsUserRef(LP_UNCLAIMED)).toBeUndefined();
  });

  it("O3-5 · nothing reads the email: the review-status LP has an EMPTY email and still resolves", () => {
    const row = rawDb()
      .prepare(`SELECT email FROM users WHERE id = ?`)
      .get(LP_REVIEW) as { email?: string } | undefined;
    expect(String(row?.email ?? "")).toBe("");
    expect(durableCommsUserRef(LP_REVIEW)).toBeTruthy();
  });
});
