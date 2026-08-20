/**
 * WAVE 59 — SHADIE'S WALKTHROUGH (EDITS-version12). SERVER-SIDE REACHABILITY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, THROUGH HTTP ROUTES ONLY
 * ═══════════════════════════════════════════════════════════════════════════
 * Every assertion here is driven through `registerRoutes(...)`-registered
 * Express handlers over a real socket. No store is called directly to establish
 * a result, and no handler is mocked.
 *
 * S1 — "Submit soft circle" fails with 409 (Shadie's 2a).
 *   · S1-A  THE REPRODUCTION. A modern invitation whose `roundInvitationsStore`
 *           state is `sent` is driven to `soft_circled` through the canonical
 *           PATCH. A SECOND identical PATCH then answers
 *           409 `noop_transition:soft_circled` — Shadie's exact status and body.
 *   · S1-B  THE TWO DISAGREEING AUTHORITIES, side by side in one test.
 *           `GET /api/investor/invitations/:id`      → still reports `sent`
 *           `GET /api/rounds/:r/invitations/:i/decision` → reports `soft_circled`
 *           This is the whole defect: the UI read the first, the write path
 *           validates against the second.
 *   · S1-C  THE FIX'S DATA CONTRACT. The decision GET carries the `amount`,
 *           `currency` and `softCircleType` the new "already submitted" panel
 *           renders, so the panel never has to invent a number.
 *   · S1-D  THE NO-DOWNGRADE GUARD IS STILL ARMED. After the record has reached
 *           `soft_circled`, a `view` PATCH is still refused and the state does
 *           NOT regress. The guard was NOT weakened to clear the 409.
 *   · S1-E  THE OTHER TRANSITION REFUSALS ARE REACHABLE AND NAMED, so the
 *           client's `describeDecisionRefusal` has real inputs:
 *           `forbidden_transition:soft_circled->viewed` and a `declined` chain.
 *
 * S3 — pitch-deck upload fails with `companyId_required` (Shadie's 4a).
 *   · S3-A  THE SERVER IS RIGHT. `POST /api/founder/collective/pitch-deck` with
 *           a real file and an EMPTY `companyId` answers
 *           400 `{ok:false, error:"companyId_required"}` — byte-for-byte the
 *           toast in Shadie's screenshot. This is the request the unguarded
 *           client sent, and it can never succeed. The server is not changed.
 *   · S3-B  THE SAME REQUEST WITH A RESOLVED companyId IS ADMITTED past that
 *           check (it proceeds to the ownership check), proving the 400 is
 *           specifically about the missing field and that the fix does not need
 *           any server change. This is the negative control that makes S3-A
 *           non-vacuous.
 *   · S3-C  THE RETRACTED STORAGE THEORY IS DISPROVEN BY EXECUTION: the
 *           `companyId_required` refusal happens with a valid .pdf attached, so
 *           no storage call is reached. `AWS_S3_BUCKET` is irrelevant to 4a.
 *
 * S5.1 — a 404 invitation spun forever.
 *   · S5-A  `GET /api/investor/invitations/<unknown id>` really is 404, which is
 *           the input the client's new not-found state consumes. Recorded here
 *           so the client-side proof is anchored to observed server behaviour.
 *
 * S5.2 — `GET /api/companies/:id/securities` 404 on the decision tab.
 *   · S5-B  DIAGNOSIS, NOT A FIX. The 404 is Wave 36 · Row 1's DELIBERATE
 *           refusal: an investor merely INVITED to a round holds no cap-table
 *           position, so `decideCapTableSinkAccess` returns `no_relationship`
 *           and the route answers 404 by policy (it must not confirm existence).
 *           Proved here by contrast: the same route answers 200 for the founder
 *           of the company and 404 for the invited-only investor. Nothing is
 *           changed; the honest client-side message already exists (Wave 42 F-9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOT PROVED HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *   · No browser is opened and no CSS is computed. S2 (the invisible checkbox)
 *     and S4 (required markers / inline errors) are client-surface defects and
 *     are proved in `client/src/pages/__tests__/w59_shadie_walkthrough_ui.test.ts`.
 *   · Nothing is proved on the LIVE deployment. These are the same routes, on a
 *     test database.
 *   · S6 (3a) is NOT tested here at all. It did not reproduce on the path
 *     tested; the reachability argument is a static one and is recorded in
 *     `build_log/wave59/WAVE59_REPORT.md` §S6.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave59/W59_TESTS.md`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { hydrateRoundsStore } from "../roundsStore";
import {
  _testAccessInvitations,
  type RoundInvitationRow,
  type InvitationState,
} from "../roundInvitationsStore";
import { clearRecords } from "../yourDecisionStore";
import { registerPersona } from "../lib/userContext";

/* Demo personas — the same ones the sibling decision tests use. */
const MAYA = "u_maya_chen"; // founder of co_novapay
const AISHA = "u_aisha_patel"; // investor
const AISHA_EMAIL = "aisha@greenwood.capital";
const COMPANY = "co_novapay";

let app: Express;
let server: http.Server;

/** A minimal `.pdf` payload. Content does not matter: every assertion below is
 *  refused BEFORE storage, which is precisely the point of S3-C. */
const PDF_BYTES = Buffer.from("%PDF-1.4\n% w59 fixture\n%%EOF\n", "utf8");

function makeModernInvite(
  id: string,
  roundId: string,
  state: InvitationState,
  investorEmail: string = AISHA_EMAIL,
): RoundInvitationRow {
  const now = new Date().toISOString();
  const row: RoundInvitationRow = {
    id,
    tenantId: `tenant_co_${COMPANY}`,
    roundId,
    companyId: COMPANY,
    investorEmail,
    investorName: "Aisha Patel",
    investorFirstName: "Aisha",
    investorLastName: "Patel",
    state,
    classification: "in_crm",
    tokenHash: null,
    invitedByUserId: MAYA,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  _testAccessInvitations.rows.push(row);
  return row;
}

/* The pitch-deck route sits behind `requireCollectiveEnabled`, which reads the
   env var AT REQUEST TIME precisely so a suite can flip it. Without this every
   S3 assertion would read 503 `collective_not_available` and prove nothing about
   `companyId_required`. Restored in afterAll so no sibling file inherits it. */
let PRIOR_COLLECTIVE_ENABLED: string | undefined;

beforeAll(async () => {
  PRIOR_COLLECTIVE_ENABLED = process.env.COLLECTIVE_ENABLED;
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  await hydrateRoundsStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

afterAll(() => {
  if (PRIOR_COLLECTIVE_ENABLED === undefined) delete process.env.COLLECTIVE_ENABLED;
  else process.env.COLLECTIVE_ENABLED = PRIOR_COLLECTIVE_ENABLED;
  try {
    server?.close();
  } catch {
    /* nothing to close */
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S1 — THE SOFT-CIRCLE BLOCKER
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S1 — the soft-circle 409 and the two state authorities", () => {
  const ROUND = "rnd_w59_s1";
  const INV = `inv_${ROUND}_primary`;

  beforeAll(async () => {
    clearRecords();
    /* `sent` is EXACTLY the state Shadie's live invitation was in, and the one
       `mapModernInvitationState()` maps to `pending`. */
    makeModernInvite(INV, ROUND, "sent");
    /* Drive the ladder the way the real UI does: view, then soft_circle. */
    const view = await request(app)
      .patch(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "view" });
    expect(view.status).toBe(200);
    const first = await request(app)
      .patch(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "soft_circle", amount: 50_000, currency: "USD", softCircleType: "indication" });
    expect(first.status).toBe(200);
    expect(first.body?.record?.state).toBe("soft_circled");
  }, 60_000);

  it("S1-A — a repeat soft-circle answers 409 noop_transition:soft_circled (Shadie's exact response)", async () => {
    const res = await request(app)
      .patch(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "soft_circle", amount: 50_000, currency: "USD", softCircleType: "indication" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "noop_transition:soft_circled" });
  });

  it("S1-B — the two authorities disagree: invitation says 'sent', the decision record says 'soft_circled'", async () => {
    const invRes = await request(app)
      .get(`/api/investor/invitations/${INV}`)
      .set("x-user-id", AISHA);
    expect(invRes.status).toBe(200);
    /* THE SURFACE THE UI USED TO READ. `mapModernInvitationState()` maps this to
       `pending`, which is why a submit form was rendered. */
    expect(invRes.body?.state).toBe("sent");

    const decRes = await request(app)
      .get(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA);
    expect(decRes.status).toBe(200);
    /* THE SURFACE THE PATCH VALIDATES AGAINST, and now the ONLY one the decision
       tab gates its form on. */
    expect(decRes.body?.state).toBe("soft_circled");

    /* Stated as an inequality so the test cannot pass by the two happening to
       agree for some unrelated reason. */
    expect(decRes.body?.state).not.toBe(invRes.body?.state);
  });

  it("S1-C — the decision GET carries the recorded amount the 'already submitted' panel renders", async () => {
    const res = await request(app)
      .get(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA);
    expect(res.status).toBe(200);
    expect(res.body?.amount).toBe(50_000);
    expect(res.body?.currency).toBe("USD");
    expect(res.body?.softCircleType).toBe("indication");
    /* Additive Wave 38 field, still present — the expiry banner depends on it. */
    expect(typeof res.body?.softCircledAt === "string" || res.body?.softCircledAt === null).toBe(true);
  });

  it("S1-D — the NO-DOWNGRADE guard is still armed: a view ping cannot regress a soft_circled record", async () => {
    const view = await request(app)
      .patch(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "view" });
    /* Refused, by name, and NOT silently applied. */
    expect(view.status).toBe(409);
    expect(String(view.body?.error ?? "")).toBe("forbidden_transition:soft_circled->viewed");

    const after = await request(app)
      .get(`/api/rounds/${ROUND}/invitations/${INV}/decision`)
      .set("x-user-id", AISHA);
    expect(after.body?.state).toBe("soft_circled");
    expect(after.body?.amount).toBe(50_000);
  });

  it("S1-E — a second transition refusal class is reachable, so the honest-message sweep has real inputs", async () => {
    /* `decline` from `soft_circled` is legal, so a fresh record is used to reach
       a TERMINAL state and then a forbidden transition out of it. */
    const round = "rnd_w59_s1e";
    const inv = `inv_${round}_terminal`;
    makeModernInvite(inv, round, "sent");
    const view = await request(app)
      .patch(`/api/rounds/${round}/invitations/${inv}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "view" });
    expect(view.status).toBe(200);
    const declined = await request(app)
      .patch(`/api/rounds/${round}/invitations/${inv}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "decline" });
    expect(declined.status).toBe(200);
    expect(declined.body?.record?.state).toBe("declined");

    /* `declined` is terminal: every onward transition is forbidden. */
    const res = await request(app)
      .patch(`/api/rounds/${round}/invitations/${inv}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "soft_circle", amount: 1_000, currency: "USD", softCircleType: "indication" });
    expect(res.status).toBe(409);
    expect(String(res.body?.error ?? "")).toBe("forbidden_transition:declined->soft_circled");

    /* And the repeat-decline is the no-op class, on a DIFFERENT state than S1-A,
       so the client's generic noop branch is exercised too. */
    const repeat = await request(app)
      .patch(`/api/rounds/${round}/invitations/${inv}/decision`)
      .set("x-user-id", AISHA)
      .send({ action: "decline" });
    expect(repeat.status).toBe(409);
    expect(String(repeat.body?.error ?? "")).toBe("noop_transition:declined");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S3 — THE PITCH-DECK UPLOAD
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S3 — POST /api/founder/collective/pitch-deck and companyId_required", () => {
  it("S3-A — an EMPTY companyId with a real .pdf attached answers 400 companyId_required", async () => {
    const res = await request(app)
      .post("/api/founder/collective/pitch-deck")
      .set("x-user-id", MAYA)
      .field("companyId", "")
      .attach("file", PDF_BYTES, { filename: "deck.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body?.ok).toBe(false);
    /* The verbatim string on Shadie's slide-4 toast. */
    expect(res.body?.error).toBe("companyId_required");
  });

  it("S3-A2 — an ABSENT companyId field behaves identically (the unguarded client could send either)", async () => {
    const res = await request(app)
      .post("/api/founder/collective/pitch-deck")
      .set("x-user-id", MAYA)
      .attach("file", PDF_BYTES, { filename: "deck.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("companyId_required");
  });

  it("S3-B — NEGATIVE CONTROL: the same request WITH a companyId gets past that check", async () => {
    const res = await request(app)
      .post("/api/founder/collective/pitch-deck")
      .set("x-user-id", MAYA)
      .field("companyId", COMPANY)
      .attach("file", PDF_BYTES, { filename: "deck.pdf", contentType: "application/pdf" });
    /* The point is NOT that it succeeds (ownership/storage may still refuse in a
       test environment) — it is that `companyId_required` is GONE. If this
       assertion ever reads `companyId_required` again, the field stopped
       arriving and S3-A has become vacuous. */
    expect(res.body?.error).not.toBe("companyId_required");
    expect(res.status).not.toBe(400);
  });

  it("S3-C — the refusal happens BEFORE storage, so the retracted AWS_S3_BUCKET theory cannot explain 4a", async () => {
    /* A 50-byte file, a valid mime type and a valid extension: everything the
       storage path would need. The response is still the field-validation 400,
       which is strictly earlier in the handler than `putObject`. If the failure
       were a storage misconfiguration the status would be 500
       PITCH_DECK_UPLOAD_FAILED, which is the enumerated storage failure mode. */
    const res = await request(app)
      .post("/api/founder/collective/pitch-deck")
      .set("x-user-id", MAYA)
      .field("companyId", "")
      .attach("file", PDF_BYTES, { filename: "deck.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.status).not.toBe(500);
    expect(res.body?.error).not.toBe("PITCH_DECK_UPLOAD_FAILED");
  });

  it("S3-D — no identity is 401 missing_identity, so the fix cannot have opened a hole", async () => {
    const res = await request(app)
      .post("/api/founder/collective/pitch-deck")
      .set("x-user-id", "")
      .set("disable-dev-bypass-probe", "1")
      .field("companyId", COMPANY)
      .attach("file", PDF_BYTES, { filename: "deck.pdf", contentType: "application/pdf" });
    expect(res.status).not.toBe(200);
    expect([401, 403]).toContain(res.status);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S5 — THE TWO DEFECTS FOUND WHILE VERIFYING
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S5 — the 404 invitation and the securities 404", () => {
  it("S5-A — an unknown invitation id really is 404 (the input the not-found state consumes)", async () => {
    const res = await request(app)
      .get("/api/investor/invitations/inv_rnd_w59_definitely_absent")
      .set("x-user-id", AISHA);
    expect(res.status).toBe(404);
  });

  it("S5-A2 — an invitation belonging to SOMEONE ELSE is also 404, never 403 (existence is not confirmed)", async () => {
    const round = "rnd_w59_s5a2";
    const inv = `inv_${round}_notmine`;
    makeModernInvite(inv, round, "sent", "someone.else@example.test");
    const res = await request(app).get(`/api/investor/invitations/${inv}`).set("x-user-id", AISHA);
    expect(res.status).toBe(404);
    /* This is why the client's copy names BOTH possibilities rather than
       claiming the invitation does not exist. */
  });

  it("S5-B — /securities 404 for an invited-only investor is a DELIBERATE refusal, not a fault", async () => {
    /* The contrast is the proof. Same route, same company, two callers. */
    const asFounder = await request(app)
      .get(`/api/companies/${COMPANY}/securities`)
      .set("x-user-id", MAYA);
    expect(asFounder.status).toBe(200);
    expect(Array.isArray(asFounder.body)).toBe(true);

    /* A FRESH persona, invited and nothing else. The seeded demo investors were
       not usable here: `u_lapsed_lp` already holds a cap-table position in
       co_novapay and correctly reads 200, which would have made this test assert
       the opposite of the policy. */
    const round = "rnd_w59_s5b";
    const inv = `inv_${round}_invited_only`;
    const email = `w59_invited_only_${Date.now()}@test.example`;
    const invitedOnlyUserId = registerPersona({
      email,
      name: "W59 Invited Only",
      password: "W59InvitedOnly1",
      invitationId: inv,
      roundId: round,
      companyId: COMPANY,
    });
    makeModernInvite(inv, round, "sent", email);
    const asInvitedInvestor = await request(app)
      .get(`/api/companies/${COMPANY}/securities`)
      .set("x-user-id", invitedOnlyUserId);
    /* Wave 36 · Row 1: an invitation is a prospect relationship, not a holding.
       404 by policy so SPV / company ids cannot be enumerated. */
    expect(asInvitedInvestor.status).toBe(404);
    expect(asInvitedInvestor.body).toEqual({ ok: false, error: "not_found" });
  });
});
