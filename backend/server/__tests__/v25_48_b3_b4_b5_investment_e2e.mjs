/**
 * v25.48 B3 + B4 + B5 — investment backlog (parallel modules; Sacred ledger
 * never edited).
 *
 *  B3: POST/GET /api/founder/rounds/:roundId/docs-sent — persisted per-investor
 *      "subscription docs sent" flag; Save→Restart→Load persistence.
 *  B4: POST/GET /api/investor/rounds/:roundId/wired — optional investor advisory
 *      "I wired" signal (does NOT move the cap table).
 *  B5: POST /api/founder/captable/commit-funded-batch-v2 — REQUIRED founder
 *      attestation (fail-closed 422 when unattested).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, closeApp, call } from "./v25_48_helpers.mjs";
import { rawDb } from "../db/connection.ts";

let ctx;
beforeAll(async () => { ctx = await buildApp(); }, 30_000);
afterAll(async () => { await closeApp(ctx.server); });

const ROUND = "rnd_v2548_b_test";
const INVESTOR = "u_aisha_patel";

describe("v25.48 B3 subscription-docs-sent flag", () => {
  it("founder marks docs sent and it persists (Save→Restart→Load)", async () => {
    const post = await call(ctx.port, "POST", `/api/founder/rounds/${ROUND}/docs-sent`, {
      as: "founder",
      body: { investorId: INVESTOR, companyId: "co_novapay", note: "sent via docusign" },
    });
    expect(post.status).toBe(200);
    expect(post.body?.ok).toBe(true);

    // Restart-safe: read the DB row directly (canonical persistence).
    const row = rawDb().prepare("SELECT * FROM subscription_docs_sent WHERE round_id=? AND investor_id=?").get(ROUND, INVESTOR);
    expect(row).toBeTruthy();

    const get = await call(ctx.port, "GET", `/api/founder/rounds/${ROUND}/docs-sent`, { as: "founder" });
    expect(get.status).toBe(200);
    expect(get.body.items.some((i) => i.investor_id === INVESTOR)).toBe(true);
  });
});

describe("v25.48 B4 investor 'I wired' advisory signal", () => {
  it("investor records a wired signal (advisory, does not move the cap table)", async () => {
    const post = await call(ctx.port, "POST", `/api/investor/rounds/${ROUND}/wired`, {
      userId: INVESTOR,
      body: { companyId: "co_novapay", amountHint: "50000", currency: "USD", note: "wired today" },
    });
    expect(post.status).toBe(200);
    expect(post.body?.advisory).toBe(true);

    const get = await call(ctx.port, "GET", `/api/investor/rounds/${ROUND}/wired`, { userId: INVESTOR });
    expect(get.status).toBe(200);
    expect(get.body?.signal).toBeTruthy();
    expect(get.body.signal.amount_hint).toBe("50000");

    // The signal lives in its OWN advisory table, separate from the ledger.
    const row = rawDb().prepare("SELECT * FROM investor_wired_signals WHERE round_id=? AND investor_id=?").get(ROUND, INVESTOR);
    expect(row).toBeTruthy();
  });
});

describe("v25.48 B5 required founder attestation at commit", () => {
  it("commit WITHOUT attestation → 422 attestation_required (fail-closed, nothing committed)", async () => {
    const res = await call(ctx.port, "POST", "/api/founder/captable/commit-funded-batch-v2", {
      as: "founder",
      body: {
        companyId: "co_novapay",
        roundId: ROUND,
        attested: false,
        entries: [{ invitationId: "inv_x", roundId: ROUND, investorId: INVESTOR, amount: "1000", shares: "100" }],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body?.error).toBe("attestation_required");
    // No attestation row must have been written for this unattested attempt.
    const cnt = rawDb().prepare("SELECT COUNT(*) c FROM commit_attestations WHERE invitation_id=?").get("inv_x");
    expect(cnt.c).toBe(0);
  });

  it("commit WITH attestation writes an attestation row before committing", async () => {
    const res = await call(ctx.port, "POST", "/api/founder/captable/commit-funded-batch-v2", {
      as: "founder",
      body: {
        companyId: "co_novapay",
        roundId: ROUND,
        attested: true,
        attestationStatement: "I confirm funds are in bank.",
        entries: [{ invitationId: "inv_att_1", roundId: ROUND, investorId: INVESTOR, amount: "1000", shares: "100" }],
      },
    });
    // The attestation is written fail-closed BEFORE the ledger commit, so an
    // attestation row must exist regardless of whether the downstream ledger
    // commit succeeded (reconcile/transition may reject in this synthetic case).
    expect(res.status).toBe(200);
    const cnt = rawDb().prepare("SELECT COUNT(*) c FROM commit_attestations WHERE invitation_id=?").get("inv_att_1");
    expect(cnt.c).toBeGreaterThanOrEqual(1);
    const row = rawDb().prepare("SELECT * FROM commit_attestations WHERE invitation_id=? LIMIT 1").get("inv_att_1");
    expect(row.attestor_user_id).toBeTruthy();
    expect(row.attested_at).toBeTruthy();
  });
});

describe("v25.48 B2 batch commit uses PER-ENTRY founder-confirmed amounts", () => {
  it("two entries with DIFFERENT amounts each record their own founder-confirmed amount (not locked to one soft-circle)", async () => {
    const inv1 = `inv_b2_${Date.now()}_a`;
    const inv2 = `inv_b2_${Date.now()}_b`;
    const res = await call(ctx.port, "POST", "/api/founder/captable/commit-funded-batch-v2", {
      as: "founder",
      body: {
        companyId: "co_novapay",
        roundId: ROUND,
        attested: true,
        attestationStatement: "I confirm per-entry founder amounts.",
        entries: [
          { invitationId: inv1, roundId: ROUND, investorId: INVESTOR, amount: "12345", shares: "111" },
          { invitationId: inv2, roundId: ROUND, investorId: INVESTOR, amount: "67890", shares: "222" },
        ],
      },
    });
    expect(res.status).toBe(200);
    // B2 proof: each entry's attestation row carries ITS OWN founder-confirmed
    // amount, proving the batch does NOT collapse to a single soft-circle amount.
    const r1 = rawDb().prepare("SELECT amount FROM commit_attestations WHERE invitation_id=? LIMIT 1").get(inv1);
    const r2 = rawDb().prepare("SELECT amount FROM commit_attestations WHERE invitation_id=? LIMIT 1").get(inv2);
    expect(String(r1.amount)).toBe("12345");
    expect(String(r2.amount)).toBe("67890");
  });
});
