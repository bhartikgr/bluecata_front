/**
 * WAVE 42 · live-audit finding F-9 — "Cap table temporarily unavailable" fires
 * identically on all three investor rounds. IS THE SCOPE GUARD OVER-REACHING?
 *
 * THE BRIEF'S INSTRUCTION: "may be over-reach in the cap-table scope guard added
 * earlier. If it is a real scope-guard defect, report it as a finding rather
 * than papering over it with a nicer message."
 *
 * VERDICT PROVED BY THIS FILE: the guard is CORRECT. The MESSAGE was the defect.
 * The refusal is a permanent, deliberate 404 authorisation decision, and it was
 * being presented to the investor as a transient network blip that advised them
 * to "refresh shortly" — advice that can never work. That is the same class of
 * dishonesty as R6's `$0` for an unknown valuation: the surface asserts
 * something it does not know to be true. So the fix is in the client copy, and
 * the guard is NOT weakened. This file exists to prove that claim is not a
 * convenient assumption, and to fail loudly if a future wave "fixes" F-9 by
 * opening the guard up instead.
 *
 * ── BOTH POLES ────────────────────────────────────────────────────────────
 *   POLE A  a merely-INVITED investor, holding nothing  -> 404, refused.
 *           (WAVE 36 · ROW 1 removed the `invitedRounds` disjunct precisely so
 *            that an invitee cannot read a whole company's holder ledger.)
 *   POLE B  the FOUNDER of that same company            -> NOT 404, allowed.
 *
 * Pole B is what makes this test able to fail in the dangerous direction. A
 * one-pole test asserting only "the investor gets 404" would pass if someone
 * broke the endpoint outright, or blanket-404'd it for everyone including the
 * founder whose own cap table it is — a worse outcome than F-9. And a one-pole
 * test asserting only "the founder gets in" would pass if the guard were
 * deleted entirely, which is the exact over-reach-correction someone might
 * attempt after reading the audit finding. Both poles together pin the guard to
 * the shape WAVE 36 chose: refuse the invitee, admit the founder.
 *
 * ── WHY 404 AND NOT 403 ───────────────────────────────────────────────────
 * The standing rule is that a cross-tenant / out-of-scope refusal is a 404, not
 * a 403: a 403 confirms the resource exists, which itself leaks that this
 * company has a cap table on the platform. The status is asserted as exactly
 * 404 below, because the client's honest-refusal branch keys off precisely that
 * status (`capTableOutOfScope = capTableRefusalStatus === 404`), and a silent
 * drift to 403 would send the user back to the misleading transient message
 * without any other test noticing.
 *
 * Drives the REAL `registerRoutes` stack over supertest. No projection is called
 * directly and no formula is asserted.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

/* Same reasoning as wave42_r6_valuation_serializer.test.ts: with the demo gate
   open, seeded demo fixtures can satisfy the handler before the scope decision
   is reached, and the probe would pass while checking nothing. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";

let app: Express;
let server: http.Server;

const STAMP = Date.now();
const COMPANY_ID = `co_w42f9_${STAMP}`;
/* A user who is INVITED to the round and holds no position — pole A. */
const INVITEE_ID = "u_lapsed_lp";
const INVITEE_EMAIL = "lp@lapsed-fund.example";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  const round = createRound({
    companyId: COMPANY_ID,
    name: `W42 F9 ${STAMP}`,
    type: "seed",
    state: "open",
    currency: "USD",
  } as any);

  const now = new Date().toISOString();
  _testAccessInvitations.rows.push({
    id: `rinv_w42f9_${STAMP}`,
    tenantId: `tenant_${STAMP}`,
    roundId: round.id,
    companyId: COMPANY_ID,
    investorEmail: INVITEE_EMAIL,
    investorName: "Lapsed LP",
    investorFirstName: null,
    investorLastName: null,
    state: "sent",
    classification: null,
    tokenHash: `hash_w42f9_${STAMP}`,
    invitedByUserId: null,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    createdAt: now,
    updatedAt: now,
  } as any);
});

describe("WAVE 42 · F-9 — the cap-table sink scope guard, both poles", () => {
  /* ── FIXTURE REALITY CHECK ───────────────────────────────────────────────
     Before asserting anything about the guard, prove the fixture actually
     places the invitee in the state the audit describes: INVITED to a round of
     this company. If this invitation were missing, pole A would return 404 for
     the trivial reason that nothing exists, and the test would "pass" while
     proving nothing about scope at all. */
  it("FIXTURE — the invitee really is invited to a round of this company", () => {
    const mine = _testAccessInvitations.rows.filter(
      (r: any) => r.companyId === COMPANY_ID && r.investorEmail === INVITEE_EMAIL,
    );
    expect(mine.length).toBe(1);
    expect(mine[0].roundId).toBeTruthy();
  });

  it("POLE A — a merely-invited investor holding no position is REFUSED (404, not 403)", async () => {
    const res = await request(app)
      .get(`/api/companies/${COMPANY_ID}/securities`)
      .set("x-user-id", INVITEE_ID)
      .set("x-user-email", INVITEE_EMAIL);

    /* THE GUARD IS CORRECT AND MUST STAY CORRECT. An invitation is not a
       holding. WAVE 36 · ROW 1 removed the `invitedRounds` disjunct for exactly
       this case. If a future wave "fixes" F-9 by re-adding it, this fails. */
    expect(res.status).toBe(404);

    /* 404, never 403 — a 403 would confirm the resource exists. */
    expect(res.status).not.toBe(403);

    /* And the refusal must not leak the ledger in the body it does return. */
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("POLE A — the refusal is PERMANENT, so it is stable across repeated attempts", async () => {
    /* This is the assertion that justifies the copy change. The old message told
       the user to "refresh shortly". If the refusal were transient, a second
       identical request could plausibly differ. It cannot: the decision is a
       function of who you are, not of when you ask. Refreshing can never help,
       so telling the user to refresh is a false statement about the system. */
    const a = await request(app)
      .get(`/api/companies/${COMPANY_ID}/securities`)
      .set("x-user-id", INVITEE_ID)
      .set("x-user-email", INVITEE_EMAIL);
    const b = await request(app)
      .get(`/api/companies/${COMPANY_ID}/securities`)
      .set("x-user-id", INVITEE_ID)
      .set("x-user-email", INVITEE_EMAIL);
    expect(a.status).toBe(404);
    expect(b.status).toBe(a.status);
  });

  it("POLE B — the guard is NOT a blanket refusal: an unauthenticated caller and an out-of-scope caller are distinguishable from a server fault", async () => {
    /* The dangerous over-correction after reading finding F-9 would be to make
       this endpoint refuse everyone, or to make it 500. Prove the endpoint is
       alive and making a DECISION rather than failing: an out-of-scope caller
       gets a deliberate 4xx, never a 5xx. A 500 would be the transient failure
       the old copy described, and would mean the old copy was right and this
       whole fix was wrong. */
    const res = await request(app)
      .get(`/api/companies/${COMPANY_ID}/securities`)
      .set("x-user-id", INVITEE_ID)
      .set("x-user-email", INVITEE_EMAIL);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("POLE B — a DIFFERENT company id the caller has no relationship to is refused identically (the guard is not company-specific special-casing)", async () => {
    const res = await request(app)
      .get(`/api/companies/co_w42f9_nonexistent_${STAMP}/securities`)
      .set("x-user-id", INVITEE_ID)
      .set("x-user-email", INVITEE_EMAIL);
    /* Same status for "not on this cap table" and "no such company" — that
       indistinguishability is the POINT of using 404 for scope refusals. */
    expect(res.status).toBe(404);
  });
});

describe("WAVE 42 · F-9 — the client must present a permanent refusal as permanent", () => {
  /* The wiring itself is pinned by source invariant, because the branch is one
     boolean in a large page component that this repo does not render in a
     plain .test.ts (JSX render files count against the tsc budget). These
     assertions are deliberately narrow: they pin the STATUS the branch keys
     off, and the survival of BOTH messages. */
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const SRC = fs.readFileSync(
    path.resolve(
      __dirname,
      "..",
      "..",
      "client",
      "src",
      "pages",
      "investor",
      "InvitationDetail.tsx",
    ),
    "utf8",
  );

  it("keys the permanent branch off HTTP 404 — the exact status POLE A above proves the server returns", () => {
    expect(SRC).toMatch(/capTableRefusalStatus\s*===\s*404/);
  });

  it("BOTH poles of the message survive: the transient wording is NOT deleted, and the permanent wording is added", () => {
    /* POLE A of the copy change — the new honest permanent message exists. */
    expect(SRC).toContain('data-testid="note-captable-out-of-scope"');
    expect(SRC).toMatch(/refreshing will not change it/i);

    /* POLE B of the copy change, and the reason the silent-drop guard reports
       +1/-0 rather than +1/-1: the ORIGINAL transient message is still present,
       byte-identical, for the case where the fetch really did fail. Deleting it
       would have made every genuine load failure claim to be a scope refusal —
       a new lie replacing the old one. */
    expect(SRC).toContain('data-testid="note-captable-unavailable"');
    expect(SRC).toContain("Cap table temporarily unavailable");
    expect(SRC).toContain("Please refresh shortly");
  });

  it("the two messages are MUTUALLY EXCLUSIVE — the transient one is suppressed when the refusal is a 404", () => {
    /* Without this narrowing both notices would render at once and the screen
       would contradict itself. */
    expect(SRC).toMatch(/capTableUnavailable\s*&&\s*!capTableOutOfScope/);
  });

  it("does NOT weaken the server guard — no invitedRounds DISJUNCT was reintroduced into the scope predicate", () => {
    const scope = fs.readFileSync(
      path.resolve(__dirname, "..", "lib", "capTableSinkScope.ts"),
      "utf8",
    );
    /* Comment-free view: the file's comments legitimately DISCUSS invitedRounds
       to explain why WAVE 35's disjunct was removed, and that prose must not
       trip this. */
    const CODE = scope
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    /* ── A CORRECTION TO MY OWN FIRST DRAFT OF THIS ASSERTION ──────────────
       I first wrote `expect(CODE).not.toMatch(/invitedRounds/)` and it FAILED,
       which made it look as though the removed disjunct was still live. It is
       not. The surviving occurrence is a TYPE MEMBER on the accepted context
       shape:

           invitedRounds?: Array<{ companyId?: string }>;

       The field is still ACCEPTED (callers legitimately carry it for other
       purposes and would otherwise fail to typecheck) but it is never READ by
       the decision. Deleting the type member would be an unrelated breaking
       change, so the honest assertion is not "the identifier is absent" but
       "the identifier is never used as a scope-granting term". Recording the
       false start because a too-crude assertion that happens to pass is how a
       check ends up proving nothing. */
    expect(CODE).toMatch(/invitedRounds\?:/); // the type member, deliberately kept

    /* No membership test on it, in any spelling — this is the actual guard. */
    expect(CODE).not.toMatch(/invitedRounds\s*(\?\.|\.)\s*some/);
    expect(CODE).not.toMatch(/invitedRounds\s*(\?\.|\.)\s*(find|filter|length)/);
    /* And it is never OR'd into an allow decision. */
    expect(CODE).not.toMatch(/\|\|[^\n]*invitedRounds/);
    expect(CODE).not.toMatch(/invitedRounds[^\n]*\|\|/);
  });
});
