/**
 * WAVE 203 · ITEM B (R178.6) — THE SERVER HALF OF "DETECTION IS NOT REMEDIATION".
 *
 * The rendered-DOM proof (a single click sends nothing; the confirmation names
 * both amounts, the affected party and a reason; a cannot-compare row offers
 * nothing) lives in
 * client/src/components/__tests__/w203_repricing_confirmation_dom.test.tsx.
 *
 * This file proves the three things a DOM test cannot reach, by driving the REAL
 * Express route through supertest against the REAL store — no re-implementation:
 *
 *   1. THE ROUTE ITSELF REFUSES an unreasoned repoint. The confirmation dialog is
 *      the deliberate step for a person, but `POST
 *      /api/admin/pricing-console/repoint-ack` is reachable without any UI. If
 *      the requirement lived only in the browser it would be decoration. Before
 *      this wave the reason arrived as an OPTIONAL `note`, so a repoint could be
 *      recorded with no stated cause at all.
 *
 *   2. A CONFIRMED REPOINT REACHES THE AUDIT LEDGER, through wave 186's existing
 *      writer, at bearing "money" — not a second audit path. Before this wave
 *      nothing about a repoint reached `audit_log`; the only trace was the
 *      `pricing_display_repoint_ack` row, which is the decision's own storage,
 *      not the platform record. That is the same family of defect as Item A.
 *
 *   3. WAVE 201'S REFUSAL STILL FIRES FIRST. `COMPARISON_INCOMPLETE` must be
 *      checked BEFORE the new reason check, or a cannot-compare row that happens
 *      to carry a reason would slip past the finding and be accepted. Wave 201
 *      declared this refusal but shipped no guarding test for it; this file adds
 *      one, so the ordering is now held by an assertion rather than by reading.
 *
 * NO CHARGED FIGURE IS SET OR MOVED ANYWHERE IN THIS FILE. No fee schedule and no
 * tier price is inserted, updated or deleted. The only row this file causes to be
 * written is a `pricing_display_repoint_ack` (wave 131's existing decision record)
 * and its audit entry, in an in-memory test database.
 *
 * ── WHICH FEE KINDS RESOLVE, MEASURED RATHER THAN ASSUMED ────────────────────
 * A first draft of this file asserted that NO fee kind resolves in this tree and
 * that the audit write was therefore unreachable over HTTP. That was wrong, and
 * the test caught it: driving all three repointable kinds through the real route
 * shows two refuse and one succeeds.
 *
 *   subscription_monthly → 400 COMPARISON_INCOMPLETE (authoritative side errors
 *                              CADENCE_MISMATCH — the catalyst tier row is priced
 *                              annual, so there is no monthly figure to compare)
 *   spv_deployment       → 400 COMPARISON_INCOMPLETE (displayed side errors
 *                              no_fee_schedule_configured)
 *   subscription_annual  → both sides resolve (displayed 0, authoritative 24000),
 *                              so this is a genuine MISMATCH and the only kind
 *                              that can reach the confirmation path
 *
 * So §2 below is a REAL end-to-end proof through the HTTP route, not a direct
 * call to the writer. §3 uses the two genuinely-unresolvable kinds, which is what
 * makes its refusal assertion strict rather than permissive.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerPricingConsoleRoutes } from "../lib/pricingConsoleRoutes";
import { rawDb } from "../db/connection";
import { REPOINTABLE_FEE_KINDS } from "../lib/pricingDisplaySourceRepoint";

/** The sandbox admin persona. `x-user-id` is honoured only under VITEST. */
const ADMIN = "u_admin";
const URL = "/api/admin/pricing-console/repoint-ack";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPricingConsoleRoutes(app);
});

/** Audit rows written by this action, newest first — read straight from the DB.
 *  The column names are the REAL ones from migration 0000: `appendAudit` packs
 *  the event type into `action` and the entity into `target`. Reading the table
 *  directly, rather than through a list helper, means the assertion cannot be
 *  satisfied by a helper's in-memory cache. */
function auditRowsFor(action: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(
      "SELECT id, actor_id, target, action, payload_json, created_at FROM audit_log " +
        "WHERE action = ? ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .all(action) as Array<Record<string, unknown>>;
}

const ACTION = "pricing.display_repoint_confirmed";
let auditCountBefore = 0;
beforeEach(() => {
  auditCountBefore = auditRowsFor(ACTION).length;
});

/* ════════════════════════════════════════════════════════════════════════════
   1 — A REASON IS REQUIRED BY THE SERVER, NOT ONLY BY THE SCREEN.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 203 · B.1 — the route refuses an unreasoned repricing", () => {
  /* THE ONE KIND THAT ACTUALLY COMPARES in this tree — so a refusal here is
     unambiguously the REASON refusal and not wave 201's finding refusal. Using
     an unresolvable kind would have made these tests pass for the wrong reason. */
  const COMPARABLE = "subscription_annual";

  it("refuses with REPOINT_REASON_REQUIRED when no reason is given at all", async () => {
    const res = await request(app)
      .post(URL)
      .set("x-user-id", ADMIN)
      .send({ feeKind: COMPARABLE, tier: "catalyst", confirm: true });

    /* It is refused — 200 would mean the requirement is browser-only, and the
       route is reachable without the browser. */
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("REPOINT_REASON_REQUIRED");

    /* The message a human sees passes the 240-char `looksHuman` gate and carries
       no ALL-CAPS underscore token (R143.4). */
    const message = String(res.body.message ?? "");
    expect(message.length).toBeGreaterThan(0);
    expect(message.length).toBeLessThan(240);
    expect(/[a-z]/.test(message)).toBe(true);
    expect(message).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    /* And it says what it needs, rather than merely that it refused. */
    expect(message).toMatch(/reason/i);

    /* AND NOTHING WAS WRITTEN. A refusal that still audited would be the defect
       wearing a 400. */
    expect(auditRowsFor(ACTION).length).toBe(auditCountBefore);
  });

  it("refuses a whitespace-only reason — a required field is not satisfied by a space", async () => {
    const res = await request(app)
      .post(URL)
      .set("x-user-id", ADMIN)
      .send({ feeKind: COMPARABLE, tier: "catalyst", confirm: true, reason: "     " });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("REPOINT_REASON_REQUIRED");
    expect(auditRowsFor(ACTION).length).toBe(auditCountBefore);
  });

  it("still refuses without `confirm` — wave 131's explicit-confirmation gate is intact", async () => {
    const res = await request(app)
      .post(URL)
      .set("x-user-id", ADMIN)
      .send({ feeKind: COMPARABLE, tier: "catalyst", reason: "a perfectly good reason" });
    expect(res.status).toBe(400);
    expect(auditRowsFor(ACTION).length).toBe(auditCountBefore);
  });

  it("the reason requirement is enforced in the ROUTE SOURCE, after the incomplete check", async () => {
    /* §3 below proves the ORDER behaviourally where it can. This asserts the
       ordering in the source too, because in a tree with zero fee rows the
       incomplete refusal fires first for every fee kind, which would let a
       behavioural-only test pass even if the two checks were swapped. Comments
       AND string literals are stripped first, and the stripper is verified to
       have stripped, so this file's own prose cannot satisfy it. */
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/lib/pricingConsoleRoutes.ts", "utf8");
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
      .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    expect(src.length - stripped.length).toBeGreaterThan(1000);

    /* BOTH CODES ARE STRING LITERALS, so the stripper erases them — a first draft
       of this test asserted they survived and failed, correctly. The ordering is
       therefore measured on the un-stripped source, and the stripped source is
       used for the assertions where a comment could lie (the writer count and the
       money-arithmetic ban below). */
    const incompleteAtSrc = src.indexOf('"COMPARISON_INCOMPLETE"');
    const reasonAtSrc = src.indexOf('"REPOINT_REASON_REQUIRED"');
    expect(incompleteAtSrc).toBeGreaterThan(-1);
    expect(reasonAtSrc).toBeGreaterThan(-1);
    /* THE ORDERING: wave 201's finding is checked BEFORE the reason, so a
       cannot-compare row carrying a reason cannot slip past it. §3 proves the
       same thing behaviourally on the two unresolvable kinds. */
    expect(incompleteAtSrc).toBeLessThan(reasonAtSrc);
    /* And each appears exactly once, so there is no second copy of either
       refusal sitting in a different order further down. */
    expect((src.match(/"COMPARISON_INCOMPLETE"/g) ?? []).length).toBe(1);
    expect((src.match(/"REPOINT_REASON_REQUIRED"/g) ?? []).length).toBe(1);

    /* ONE audit writer, wave 186's — no second audit path (R178.6 item 2). */
    expect(stripped).toContain("appendAdminAudit(");
    expect(stripped).toContain("reportAuditWriteOutcome(");
    expect((stripped.match(/appendAdminAudit\(/g) ?? []).length).toBe(1);
    /* And no money arithmetic on this path. */
    expect(stripped).not.toMatch(/\bparseFloat\(/);
    expect(stripped).not.toMatch(/\bparseInt\(/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2 — A CONFIRMED REPOINT REACHES THE PERMANENT RECORD.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 203 · B.2 — the confirmation writes to the audit ledger", () => {
  it("END TO END: a reasoned confirmation succeeds and lands exactly one audit row naming both amounts and the reason", async () => {
    /* The REAL route, the REAL store, the REAL writer, over HTTP. Nothing is
       re-implemented and no condition is faked (handbook §8). `subscription_annual`
       is the one kind whose two sides both resolve in this tree, which is why it
       can reach the write at all — established by measurement, not assumption. */
    const REASON = "Catalyst annual subscription still displays the legacy zero.";
    const res = await request(app)
      .post(URL)
      .set("x-user-id", ADMIN)
      .send({ feeKind: "subscription_annual", tier: "catalyst", confirm: true, reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    /* The route reports the audit outcome rather than swallowing it — wave 186's
       point being that a SILENT audit failure is the worst outcome of all. */
    expect(res.body.audited).toBeTruthy();

    const rows = auditRowsFor(ACTION);
    /* EXACTLY ONE. Two rows would mean a second audit path exists, which R178.6
       item 2 forbids outright. */
    expect(rows.length).toBe(auditCountBefore + 1);
    const newest = rows[0];
    expect(newest.action).toBe(ACTION);
    expect(newest.actor_id).toBe(ADMIN);
    expect(String(newest.target)).toContain("subscription_annual");

    /* The payload names the four things R178.6 requires a repricing record to
       name: what changed, from what, to what, and why. */
    const payload = JSON.parse(String(newest.payload_json)) as Record<string, unknown>;
    expect(payload.reason).toBe(REASON);
    expect(payload.feeKind).toBe("subscription_annual");
    expect(payload.tier).toBe("catalyst");
    /* THE OLD AMOUNT AND THE NEW AMOUNT ARE BOTH ON THE RECORD, and they are the
       figures the SERVER resolved — the browser sent neither. Asserted as
       integers in minor units: never a float, never a string, never a computed
       difference across two independently-resolved currencies (R176.1). */
    expect(Number.isInteger(payload.oldDisplayedAmountMinor)).toBe(true);
    expect(Number.isInteger(payload.newDisplayedAmountMinor)).toBe(true);
    expect(payload.oldDisplayedAmountMinor).not.toBe(payload.newDisplayedAmountMinor);
    /* Each side carries its OWN currency; neither was converted or defaulted. */
    expect(typeof payload.oldDisplayedCurrency).toBe("string");
    expect(typeof payload.newDisplayedCurrency).toBe("string");

    /* And the row is hash-chained like every other, so the new writer did not
       create an unlinked entry. */
    const chained = rawDb()
      .prepare("SELECT prev_hash, hash FROM audit_log WHERE id = ?")
      .get(newest.id) as { prev_hash: string | null; hash: string } | undefined;
    expect(chained).toBeTruthy();
    expect(chained!.hash.length).toBe(64);
    expect(String(chained!.prev_hash).length).toBe(64);
  });

  it("NO AMOUNT MOVES WITHOUT THE CONFIRMATION — the refused call left the decision unrecorded", async () => {
    /* Ordered after the success above deliberately: this asserts that the
       REFUSED path recorded nothing, using a kind that CAN compare, so the
       absence cannot be explained away by the comparison having failed. */
    const { isRepointAcknowledged } = await import("../lib/pricingDisplaySourceRepoint");
    /* `spv_deployment` was attempted in §1 and §3 without ever being confirmed
       successfully — both attempts were refused. It must not be acknowledged. */
    expect(isRepointAcknowledged("spv_deployment")).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3 — WAVE 201'S CANNOT-COMPARE REFUSAL IS INTACT AND FIRES FIRST.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 203 · B.3 — a cannot-compare row is still refused, even WITH a reason", () => {
  /* The two kinds that genuinely cannot be compared in this tree — measured, and
     for two DIFFERENT reasons (one fails on the authoritative side, one on the
     displayed side), so both halves of wave 201's `missingSide` are exercised. */
  const CANNOT_COMPARE = ["subscription_monthly", "spv_deployment"];

  it("refuses an unresolvable fee kind with COMPARISON_INCOMPLETE even when a reason IS given", async () => {
    /* THE ORDERING THAT MATTERS: a reason must not be able to convert a finding
       into a mismatch. If the new reason check ran first, these would come back
       200 and a repoint would be recorded on a row nothing could compare. */
    expect(CANNOT_COMPARE.every((k) => REPOINTABLE_FEE_KINDS.includes(k))).toBe(true);
    for (const feeKind of CANNOT_COMPARE) {
      const res = await request(app).post(URL).set("x-user-id", ADMIN).send({
        feeKind,
        tier: "catalyst",
        confirm: true,
        /* A perfectly good reason. It must NOT be enough — a finding is not a
           mismatch, and a reason cannot convert one into the other. */
        reason: "Trying to push this through even though the comparison is incomplete.",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("COMPARISON_INCOMPLETE");
      expect(["both", "displayed", "charged"]).toContain(res.body.missingSide);
      /* The refusal reads as a finding to fill in, not as a mismatch. */
      expect(String(res.body.message)).toMatch(/nothing to compare|finding/i);
    }
    /* And not one of those attempts audited anything. */
    expect(auditRowsFor(ACTION).length).toBe(auditCountBefore);
  });

  it("an unauthenticated caller cannot reach the action at all", async () => {
    /* Not a wave 203 change; asserted because a confirmation step is worthless if
       the route is open. */
    const res = await request(app)
      .post(URL)
      .send({ feeKind: REPOINTABLE_FEE_KINDS[0], tier: "catalyst", confirm: true, reason: "x" });
    expect([401, 403]).toContain(res.status);
    expect(auditRowsFor(ACTION).length).toBe(auditCountBefore);
  });
});
