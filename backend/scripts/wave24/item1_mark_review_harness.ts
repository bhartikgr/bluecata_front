/**
 * WAVE 24 · ITEM 1 — falsification harness for the mark-override REVIEW
 * surface: "under the new `required` default, an override can be approved or
 * rejected THROUGH THE PRODUCT, and a rejection records why."
 *
 * THE DEAD END THIS CLOSES. Wave 23 flipped the approval default from
 * `able_to` to `required`. That is the right default — a GP fair-value override
 * taking effect while still pending is what a fund-admin diligence process
 * flags. But it created a promise with no way to keep it: no UI reached the
 * decision endpoint, so a pending override sat forever.
 *
 * THE SINK, named (Rule 2). `valuation_mark_override.approval_state` /
 * `.approved_by` / `.approved_at` / `.approval_note`, written by exactly ONE
 * function, `decideMarkOverride()` (server/wave9ReportingStore.ts:542), reached
 * by exactly ONE route, `POST /api/admin/reporting/mark-overrides/:id/decision`.
 * The harness exercises the ROUTE, not the store, because a guard that lives
 * only in the client is not a guard — a curl caller must be refused
 * identically.
 *
 * THE SECOND PATH, hunted. The mark that LPs actually see does not come from
 * `approval_state`; it comes from `effectiveMarkForCompany()`, which Wave 23
 * found was bypassing the gate entirely. So PART 3 asserts the DECISION MOVES
 * THE MARK — approving must change what `effectiveMarkForCompany()` returns,
 * and rejecting must not. Asserting only that a column flipped would be the
 * classic "fix where the data does not flow".
 *
 * BOTH POLES, per assertion pair:
 *   POLE A  A rejection with no reason, or a reason under 10 characters, is
 *           REFUSED (400 REJECTION_REASON_REQUIRED) and the row is UNCHANGED.
 *   POLE B  A rejection with a real reason SUCCEEDS, and the reason is
 *           READABLE AFTERWARDS through the list endpoint the UI renders.
 *   And the mirror pair for approval, including the deliberate ASYMMETRY:
 *   approval does NOT require a note (an approver id plus a timestamp fully
 *   expresses "this is correct"), so a harness that demanded one would be
 *   testing a rule the product does not have.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave24/item1_mark_review_harness.ts
 */
process.env.NODE_ENV = "test";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const ROOT = process.cwd();
const KEY = "marks.override_admin_approval_mode";

async function main() {
  const { getDb } = await import(path.join(ROOT, "server/db/connection.ts"));
  getDb();
  const store: any = await import(path.join(ROOT, "server/wave9ReportingStore.ts"));
  const { registerReportingEngineRoutes } = await import(path.join(ROOT, "server/lib/reportingEngineRoutes.ts"));

  const app = express();
  app.use(express.json());
  registerReportingEngineRoutes(app);
  /* `?as=admin` is the existing dev/test persona resolver (userContext.ts:518).
     Used rather than stubbing the middleware, so `requireAdmin` runs for real. */
  const AS = "?as=admin";

  const rounds: any = await import(path.join(ROOT, "server/roundsStore.ts"));

  /**
   * Give a company a REAL priced round, so `deriveMarkForCompany()` has
   * something to derive from. Without this the mark is null and PART 3 would
   * "pass" against a company that has no mark either way — a check of nothing.
   */
  function seedPricedRound(companyId: string, pricePerShare: number) {
    return rounds.createRound({
      companyId,
      name: `W24 harness priced ${Math.random().toString(36).slice(2, 8)}`,
      type: "seed",
      state: "closed",
      pricePerShare,
      closeDate: "2026-01-15",
      currency: "USD",
      actorUserId: "harness",
    });
  }

  /** Create a PENDING override through the same store the GP route uses. */
  function seedPending(vehicleId: string, fairValueMinor: number, pricePerShareOverride?: number) {
    const valuationEventId = store.persistValuationEvent({
      tenantId: "t_default",
      vehicleKind: "company",
      vehicleId,
      valuationDate: "2026-02-01",
      fairValueMinor,
      currency: "USD",
      method: "gp_override",
      source: "gp_override",
      preparer: "gp_harness",
      isExternal: false,
      createdBy: "gp_harness",
    });
    return store.createMarkOverride({
      tenantId: "t_default",
      valuationEventId,
      vehicleKind: "company",
      vehicleId,
      fairValueMinor,
      currency: "USD",
      reason: "GP re-mark ahead of the diligence pack",
      overriddenBy: "gp_harness",
      pricePerShareOverride: pricePerShareOverride ?? null,
    });
  }

  /* ═════ PART 0 — the harness is not testing a world it invented ══════════ */
  {
    const mode = store.getOverrideApprovalMode();
    eq(mode, "required", "PART0: the default approval mode is not `required` — Wave 23's ruling is not in this tree");
    const src = fs.readFileSync(path.join(ROOT, "server/lib/reportingEngineRoutes.ts"), "utf8");
    ok(
      src.includes('app.post("/api/admin/reporting/mark-overrides/:id/decision", requireAdmin'),
      "PART0: the decision route is not admin-gated",
    );
  }

  /* ═════ PART 1 — REJECTION, both poles ═══════════════════════════════════ */
  {
    const ov = seedPending("co_w24_reject", 4_200_00);
    ok(!!ov?.id, "PART1: seed override was not created");
    eq(ov.approvalState, "pending", "PART1: a new override is not pending under the required default");

    // POLE A — no reason at all.
    const r1 = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "rejected" });
    eq(r1.status, 400, "PART1 POLE A: a reasonless rejection was not refused");
    eq(r1.body?.error, "REJECTION_REASON_REQUIRED", "PART1 POLE A: wrong refusal code");
    eq(store.getOverrideById(ov.id).approvalState, "pending", "PART1 POLE A: the row changed despite the refusal");

    // POLE A' — a reason too short to be a reason.
    const r2 = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "rejected", note: "nope" });
    eq(r2.status, 400, "PART1 POLE A': a 4-character rejection reason was accepted");
    eq(store.getOverrideById(ov.id).approvalState, "pending", "PART1 POLE A': the row changed despite the refusal");

    // POLE A'' — whitespace is not a reason.
    const r3 = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "rejected", note: "            " });
    eq(r3.status, 400, "PART1 POLE A'': whitespace passed as a rejection reason");

    // POLE B — a real reason succeeds AND persists.
    const REASON = "Comparable set is stale; re-mark after the Q3 pack lands.";
    const r4 = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "rejected", note: REASON });
    eq(r4.status, 200, "PART1 POLE B: a properly-reasoned rejection was refused");
    eq(r4.body?.override?.approvalState, "rejected", "PART1 POLE B: the response does not report the rejection");

    const persisted = store.getOverrideById(ov.id);
    eq(persisted.approvalState, "rejected", "PART1 POLE B: the rejection did not persist");
    eq(persisted.approvalNote, REASON, "PART1 POLE B: THE REJECTION REASON DID NOT PERSIST");
    ok(!!persisted.approvedBy, "PART1 POLE B: no decider was recorded");
    ok(!!persisted.approvedAt, "PART1 POLE B: no decision timestamp was recorded");

    // …and is READABLE through the endpoint the review UI actually renders.
    const list = await request(app).get(`/api/reporting/mark-overrides${AS}&approvalState=rejected`);
    eq(list.status, 200, "PART1 POLE B: the list endpoint the UI reads is not serving");
    const row = (list.body?.overrides ?? []).find((o: any) => o.id === ov.id);
    ok(!!row, "PART1 POLE B: the rejected override is missing from the list the UI renders");
    eq(row?.approvalNote, REASON, "PART1 POLE B: the UI cannot see the recorded reason");
    eq(list.body?.approvalMode, "required", "PART1: the list endpoint misreports the approval mode the UI displays");

    // A rejected override must never be effective.
    eq(store.overrideIsEffective(persisted), false, "PART1: a REJECTED override is still effective");
  }

  /* ═════ PART 2 — APPROVAL, and the deliberate asymmetry ══════════════════ */
  {
    const ov = seedPending("co_w24_approve", 9_100_00);
    eq(store.overrideIsEffective(store.getOverrideById(ov.id)), false, "PART2: a PENDING override is effective under `required` — the Wave 23 gate is gone");

    // Approval WITHOUT a note is allowed on purpose. If this starts failing,
    // someone over-corrected and made approvals impossible for the same reason
    // rejections were unauditable.
    const r = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "approved" });
    eq(r.status, 200, "PART2: a note-less APPROVAL was refused — the reason rule was applied to the wrong pole");
    const after = store.getOverrideById(ov.id);
    eq(after.approvalState, "approved", "PART2: the approval did not persist");
    ok(!!after.approvedBy, "PART2: no approver was recorded");
    eq(store.overrideIsEffective(after), true, "PART2: an APPROVED override is still not effective");

    // A decision on a row that does not exist is a 404, not a silent success.
    const missing = await request(app).post(`/api/admin/reporting/mark-overrides/ovr_does_not_exist/decision${AS}`).send({ decision: "approved" });
    eq(missing.status, 404, "PART2: deciding a nonexistent override did not 404");

    // A garbage decision is refused rather than coerced.
    const bad = await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "maybe" });
    eq(bad.status, 400, "PART2: an invalid decision value was accepted");
    eq(bad.body?.error, "BAD_DECISION", "PART2: wrong refusal code for an invalid decision");
  }

  /* ═════ PART 3 — THE SECOND PATH: the decision must move the MARK ════════ */
  {
    const COMPANY = "co_w24_secondpath";
    seedPricedRound(COMPANY, 12.5);
    const before = store.effectiveMarkForCompany(COMPANY);
    ok(!!before, "PART3: the fixture company has no derived mark — the second-path check would be vacuous");
    const ov = seedPending(COMPANY, 7_770_00, 31.75);

    const pendingMark = store.effectiveMarkForCompany(COMPANY);
    eq(
      JSON.stringify(pendingMark),
      JSON.stringify(before),
      "PART3: a PENDING override already moved effectiveMarkForCompany() — the second path bypasses the gate",
    );

    await request(app).post(`/api/admin/reporting/mark-overrides/${ov.id}/decision${AS}`).send({ decision: "approved" });
    const approvedMark = store.effectiveMarkForCompany(COMPANY);
    ok(
      JSON.stringify(approvedMark) !== JSON.stringify(before),
      "PART3: APPROVING the override did NOT change effectiveMarkForCompany() — approval is decorative",
    );
    eq(approvedMark?.overrideId, ov.id, "PART3: the approved mark is not attributed to the override");
    eq(approvedMark?.pricePerShare, 31.75, "PART3: the approved override did not replace the per-share price");
  }

  /* ═════ PART 4 — the config switch the UI now exposes ════════════════════ */
  {
    const g = await request(app).get(`/api/admin/reporting/config${AS}`);
    eq(g.status, 200, "PART4: the config GET the UI reads is not serving");
    const keys = Object.keys(g.body?.config ?? g.body?.values ?? g.body ?? {});
    ok(JSON.stringify(g.body).includes(KEY), `PART4: ${KEY} is absent from the config the UI renders (keys: ${keys.join(",")})`);

    // POLE A — the capability is real: an operator CAN select able_to.
    const p1 = await request(app).put(`/api/admin/reporting/config/${KEY}${AS}`).send({ value: "able_to" });
    eq(p1.status, 200, "PART4 POLE A: an operator cannot set able_to through the UI's endpoint");
    eq(store.getOverrideApprovalMode(), "able_to", "PART4 POLE A: the setting did not take effect");

    // …and under able_to, a PENDING override IS effective — the capability was
    // un-defaulted by Wave 23, not removed.
    const ov = seedPending("co_w24_ableto", 5_550_00);
    eq(store.overrideIsEffective(store.getOverrideById(ov.id)), true, "PART4 POLE A: able_to no longer lets a pending override take effect");

    // POLE B — and back. The safe mode is reachable from the UI too.
    const p2 = await request(app).put(`/api/admin/reporting/config/${KEY}${AS}`).send({ value: "required" });
    eq(p2.status, 200, "PART4 POLE B: the operator cannot restore the safe mode");
    eq(store.getOverrideApprovalMode(), "required", "PART4 POLE B: the safe mode did not take effect");
    eq(store.overrideIsEffective(store.getOverrideById(ov.id)), false, "PART4 POLE B: the pending override stayed effective after restoring `required`");

    // An unknown key must be refused, not silently created.
    const bad = await request(app).put(`/api/admin/reporting/config/marks.not_a_real_key${AS}`).send({ value: "x" });
    ok(bad.status >= 400, "PART4: an unknown config key was accepted and silently created");
  }

  /* ═════ PART 5 — the UI actually renders the pieces above ════════════════ */
  {
    const panel = fs.readFileSync(path.join(ROOT, "client/src/components/admin/MarkOverrideReviewPanel.tsx"), "utf8");
    for (const t of [
      "button-approve-override-",
      "button-reject-override-",
      "select-approval-mode",
      "card-mark-override-queue",
      "mark-overrides-load-failed",
    ]) {
      ok(panel.includes(t), `PART5: the review panel is missing the affordance \`${t}\``);
    }
    /* Rule 5 — a failed load must be RENDERED as a refusal, and the empty state
       must be gated on isSuccess (a PAUSED query is neither loading nor errored). */
    ok(panel.includes("LoadFailedRefusal"), "PART5: the review panel has no fail-closed state");
    ok(panel.includes("isSuccess"), "PART5: the review panel gates its empty state on something other than isSuccess");
  }

  console.log(`\nITEM1 MARK-REVIEW HARNESS: ${asserts} assertions, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length === 0) console.log("ITEM1 MARK-REVIEW HARNESS: PASS");
  return failures.length === 0 ? 0 : 1;
}

main().then((c) => process.exit(c));
