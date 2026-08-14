/**
 * WAVE 43 · OWNER RULING R7 — an expired round must stop accepting money.
 *
 * THE DEFECT (verified on the LIVE site, 13 Aug 2026): two rounds whose
 * decision windows closed on 3 and 6 August still rendered a fully enabled
 * "Submit soft-circle ($250,000)" button, and the API behind it accepted the
 * money. Disabling the button would have been cosmetic — the refusal has to
 * live on the SERVER, which is what this file proves over real HTTP.
 *
 * THE OWNER'S RULING, VERBATIM:
 *   "Go with your recommendation to enforce the close. Accepting late
 *    commitments should be allowed."
 *
 * So a one-sided test is worthless here. "A fix that refuses everything would
 * pass a one-sided test and break your entire funnel." Every capability below
 * is asserted at BOTH poles, and the late path is asserted at THREE:
 *
 *   POLE 1  open round                                     → ACCEPTS (200)
 *   POLE 2  closed round                                   → REFUSES (409 ROUND_CLOSED)
 *   POLE 3  closed round + explicit founder late acceptance → ACCEPTS **and is
 *           marked accepted-after-close everywhere it appears**
 *
 * "This is the whole point: the money is allowed in, but the record must never
 * look like it arrived on time."
 *
 * HARNESS NOTES
 *   • Real `express()` + `registerRoutes` + a real listening socket, and REAL
 *     DB-backed founders/companies/rounds via `registerFounderUser` +
 *     `addCompanyForFounder` + `createRound` (the v24.3 wire-instructions
 *     pattern). No mocked stores, no monkey-patched clock: the fixtures place
 *     the close date in the real past/future instead.
 *   • W42-F6: `data.db` is effectively empty, so nothing here may lean on seed
 *     rows. Every round, invitation and commitment is created by the test.
 *   • MONEY: integer minor units only, rendered through `server/lib/money.ts`.
 *     A **JPY fixture (ISO-4217 exponent 0)** commits ¥25,000,000 so a hidden
 *     `* 100` cannot hide behind USD's exponent of 2.
 *   • CSRF is not mounted on these money routes in this harness, so requests
 *     carry identity only (`x-user-id`), exactly like the other route tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser, registerPersona } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createRound } from "../roundsStore";
import { createInvitation } from "../roundInvitationsStore";
import { listForRound as listSoftCirclesForRound } from "../softCircleStore";
import { formatMinor, toMinor } from "../lib/money";
import { ACCEPTED_AFTER_CLOSE_LABEL } from "../lib/roundCloseEnforcement";
import { listForRound as listGrantsForRound } from "../lib/roundLateAcceptanceStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Res = { status: number; body: any };

function call(method: string, path: string, opts: { body?: unknown; userId?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

let seq = 0;
function uniq(tag: string): string {
  seq += 1;
  return `${tag}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`;
}

/** A real DB-backed founder who really owns a real company. */
function makeFounder(tag: string): { userId: string; companyId: string; name: string } {
  const name = `W43 ${tag}`;
  const { userId } = registerFounderUser({
    email: `w43_${uniq(tag)}@test.example`,
    name,
    password: "testpassword123",
  });
  const companyId = `co_${uniq(tag)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `${name} Corp`,
    legalName: `${name} Corp, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
  return { userId, companyId, name };
}

/**
 * A real round. `closeDate` is the ONLY difference between the open and closed
 * poles — the code path under test is identical, which is what makes the pair
 * meaningful.
 *
 * PAST is the live defect's own date (3 Aug 2026). FUTURE is far enough out
 * that this test does not rot into a false green in a fortnight.
 */
const CLOSED_DATE = "2026-08-03";
const OPEN_DATE = "2027-12-31";

function makeRound(companyId: string, tag: string, closeDate: string | null): string {
  const r = createRound({
    companyId,
    name: `${tag} ${uniq("rnd")}`,
    type: "Seed",
    state: "soft_circle_open",
    targetAmount: 5_000_000,
    closeDate,
  });
  return r.id;
}

async function makeInvitation(
  roundId: string,
  companyId: string,
  founderUserId: string,
  investorEmail: string = `inv_${uniq("i")}@test.example`,
): Promise<string> {
  const out = await createInvitation({
    roundId,
    companyId,
    investorEmail,
    investorName: "Late Investor",
    invitedByUserId: founderUserId,
    // Far-future invitation expiry so the ROUND's close date is the binding
    // constraint. (An invitation expiry earlier than the round close is a
    // separate case, covered by the shared-semantics test.)
    expiryDays: 3650,
    dryRun: true,
  });
  return out.invitation.id;
}

const USD_AMOUNT = 250_000;          // the live defect's own figure
const USD_MINOR = 25_000_000;        // exponent 2
const JPY_AMOUNT = 25_000_000;       // ¥25,000,000
const JPY_MINOR = 25_000_000;        // exponent 0 → minor === major

describe("WAVE 43 · R7 — the server enforces the close (both poles + the late-acceptance third pole)", () => {
  /* ------------------------------------------------------------------ *
   * POLE 1 — AN OPEN ROUND STILL TAKES MONEY.
   * Asserted FIRST and deliberately: this is the pole that a blunt
   * "refuse everything" fix would break, and it is the entire funnel.
   * ------------------------------------------------------------------ */
  it("POLE 1 — an OPEN round accepts a soft-circle (200) and is NOT marked late", async () => {
    const f = makeFounder("open");
    const roundId = makeRound(f.companyId, "Open Round", OPEN_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "On Time Investor" },
    });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.softCircle?.id).toBeTruthy();
    // The honest record: this one DID arrive on time.
    expect(res.body?.acceptedAfterClose).toBe(false);
    expect(res.body?.closedAt).toBeNull();

    // And it really persisted (not merely echoed).
    const rows = listSoftCirclesForRound(roundId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountMinor).toBe(USD_MINOR);
  });

  /* ------------------------------------------------------------------ *
   * POLE 2 — A CLOSED ROUND REFUSES. THE F-7 REFUSAL ITSELF.
   * ------------------------------------------------------------------ */
  it("POLE 2 — a CLOSED round REFUSES the soft-circle with 409 ROUND_CLOSED and writes NOTHING", async () => {
    const f = makeFounder("closed");
    const roundId = makeRound(f.companyId, "Closed Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Ten Days Late Investor" },
    });

    // F-7: on the live site this returned 200 and took $250,000.
    expect(res.status).toBe(409);
    expect(res.body?.ok).toBe(false);
    expect(res.body?.error).toBe("ROUND_CLOSED");
    // The refusal names the close instant and points at the only way back in,
    // so neither party has to guess which rules apply.
    expect(res.body?.closedAt).toBeTruthy();
    expect(res.body?.lateAcceptanceRequired).toBe(true);

    // THE REFUSAL MUST BE A REFUSAL: no commitment row may exist.
    expect(listSoftCirclesForRound(roundId)).toHaveLength(0);
  });

  it("POLE 2 (money, JPY exponent 0) — a CLOSED round refuses a ¥25,000,000 commitment identically", async () => {
    const f = makeFounder("closedjpy");
    const roundId = makeRound(f.companyId, "Closed JPY Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: JPY_AMOUNT, currency: "JPY", invitationId, investorName: "Tokyo Late Investor" },
    });

    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("ROUND_CLOSED");
    expect(listSoftCirclesForRound(roundId)).toHaveLength(0);
    // The gate is currency-blind by construction: it never reads an amount.
    // Guard that the fixture itself is a genuine exponent-0 case, so a hidden
    // `* 100` in a later refactor cannot hide behind USD.
    expect(toMinor(JPY_AMOUNT, "JPY")).toBe(JPY_MINOR);
    expect(formatMinor(JPY_MINOR, "JPY")).not.toContain(".");
  });

  /* ------------------------------------------------------------------ *
   * POLE 3 — THE OWNER'S RULING: LATE MONEY IS ALLOWED IN, AND MARKED.
   * ------------------------------------------------------------------ */
  it("POLE 3 — a CLOSED round + an explicit founder late-acceptance ACCEPTS the commitment AND marks it accepted-after-close", async () => {
    const f = makeFounder("late");
    const roundId = makeRound(f.companyId, "Late Accept Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    // (a) Without the grant: refused. Same request, same round, one difference.
    const before = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Late Investor" },
    });
    expect(before.status).toBe(409);

    // (b) The founder deliberately admits ONE named commitment.
    const grantRes = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId,
      body: { confirm: true, invitationId, reason: "Investor wired on the 2nd; bank held the transfer." },
    });
    expect(grantRes.status).toBe(200);
    expect(grantRes.body?.grant?.kind).toBe("late_commitment");
    expect(grantRes.body?.grant?.invitationId).toBe(invitationId);
    // ATTRIBUTED AND AUDITED: who, when, and that it was after close.
    expect(grantRes.body?.grant?.acceptedByUserId).toBe(f.userId);
    expect(grantRes.body?.grant?.acceptedAt).toBeTruthy();
    expect(grantRes.body?.grant?.closedAt).toBeTruthy();
    expect(grantRes.body?.grant?.reason).toContain("bank held the transfer");

    // (c) Now the SAME request the server refused in (a) succeeds.
    const after = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Late Investor" },
    });
    expect(after.status).toBe(200);
    expect(after.body?.ok).toBe(true);
    // …AND THE RECORD DOES NOT LOOK LIKE IT ARRIVED ON TIME.
    expect(after.body?.acceptedAfterClose).toBe(true);
    expect(after.body?.closedAt).toBeTruthy();

    const scId = after.body.softCircle.id as string;

    // The grant is bound to THIS commitment, in the append-only ledger.
    const grants = listGrantsForRound(roundId);
    expect(grants).toHaveLength(1);
    expect(grants[0].softCircleId).toBe(scId);
    expect(grants[0].consumedAt).toBeTruthy();

    // (d) VISIBLY MARKED for the FOUNDER.
    const founderList = await call("GET", `/api/rounds/${roundId}/soft-circles`, { userId: f.userId });
    expect(founderList.status).toBe(200);
    const mine = (founderList.body?.softCircles ?? founderList.body?.items ?? founderList.body ?? [])
      .find?.((s: any) => s.id === scId);
    expect(mine).toBeTruthy();
    expect(mine.acceptedAfterClose).toBe(true);
    expect(mine.lateAcceptance?.label).toBe(ACCEPTED_AFTER_CLOSE_LABEL);
    expect(mine.lateAcceptance?.acceptedByUserId).toBe(f.userId);
    expect(mine.lateAcceptance?.closedAt).toBeTruthy();

    // (e) SINGLE USE. The grant named one commitment; it does not become a
    //     standing licence to keep taking money after the close.
    const second = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Late Investor" },
    });
    expect(second.status).toBe(409);
    expect(second.body?.error).toBe("ROUND_CLOSED");
  });

  it("POLE 3 (money, JPY exponent 0) — a late-accepted ¥25,000,000 commitment is admitted, marked, and stored in minor units unconverted", async () => {
    const f = makeFounder("latejpy");
    const roundId = makeRound(f.companyId, "Late JPY Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const grantRes = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId,
      body: { confirm: true, invitationId, reason: "JPY wire cleared after the window." },
    });
    expect(grantRes.status).toBe(200);

    const after = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: JPY_AMOUNT, currency: "JPY", invitationId, investorName: "Tokyo Late Investor" },
    });
    expect(after.status).toBe(200);
    expect(after.body?.acceptedAfterClose).toBe(true);

    const rows = listSoftCirclesForRound(roundId);
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe("JPY");
    // Exponent 0: ¥25,000,000 is 25,000,000 minor units. A `* 100` would make
    // this 2,500,000,000 and a `/ 100` would make it 250,000.
    expect(rows[0].amountMinor).toBe(JPY_MINOR);
    expect(formatMinor(rows[0].amountMinor, "JPY")).toBe(formatMinor(JPY_MINOR, "JPY"));
  });

  /* ------------------------------------------------------------------ *
   * REOPEN — the other half of the ruling, also at both poles.
   * ------------------------------------------------------------------ */
  it("REOPEN — a reopened round accepts commitments again, and they are STILL marked accepted-after-close", async () => {
    const f = makeFounder("reopen");
    const roundId = makeRound(f.companyId, "Reopen Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    expect((await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Reopen Investor" },
    })).status).toBe(409);

    const until = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const reopen = await call("POST", `/api/rounds/${roundId}/reopen`, {
      userId: f.userId,
      body: { confirm: true, reason: "Board approved a one-week extension.", reopenUntil: until },
    });
    expect(reopen.status).toBe(200);
    expect(reopen.body?.grant?.kind).toBe("reopen");
    expect(reopen.body?.grant?.reopenUntil).toBeTruthy();

    const after = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Reopen Investor" },
    });
    expect(after.status).toBe(200);
    // A reopen does NOT rewrite history: the original close still happened, so
    // the commitment is labelled. This is the ruling's whole point.
    expect(after.body?.acceptedAfterClose).toBe(true);
    expect(after.body?.closedAt).toBeTruthy();
  });

  it("REOPEN — an EXPIRED reopen window stops accepting money again (the reopen is not permanent)", async () => {
    const f = makeFounder("reopenexp");
    const roundId = makeRound(f.companyId, "Reopen Expired Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    // A reopen must end in the future when granted…
    const past = await call("POST", `/api/rounds/${roundId}/reopen`, {
      userId: f.userId,
      body: { confirm: true, reason: "backdated", reopenUntil: "2026-08-04T00:00:00.000Z" },
    });
    expect(past.status).toBe(400);
    expect(past.body?.error).toBe("REOPEN_UNTIL_IN_PAST");

    // …and with only that rejected grant on file, the round is still closed.
    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Nope" },
    });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("ROUND_CLOSED");
  });

  /* ------------------------------------------------------------------ *
   * DELIBERATE, NEVER A SIDE EFFECT.
   * ------------------------------------------------------------------ */
  it("DELIBERATE — a late acceptance requires confirm:true, a reason, and a named invitation; each omission refuses and grants nothing", async () => {
    const f = makeFounder("deliberate");
    const roundId = makeRound(f.companyId, "Deliberate Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const noConfirm = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { invitationId, reason: "because" },
    });
    expect(noConfirm.status).toBe(400);
    expect(noConfirm.body?.error).toBe("CONFIRMATION_REQUIRED");

    const noReason = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId, reason: "   " },
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body?.error).toBe("REASON_REQUIRED");

    const noInvitation = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, reason: "because" },
    });
    expect(noInvitation.status).toBe(400);
    expect(noInvitation.body?.error).toBe("INVITATION_REQUIRED");

    // Nothing was granted, so the round still refuses money.
    expect(listGrantsForRound(roundId)).toHaveLength(0);
    expect((await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Nope" },
    })).status).toBe(409);

    // Merely VIEWING the close status must never admit anything either.
    const status = await call("GET", `/api/rounds/${roundId}/close-status`, { userId: f.userId });
    expect(status.status).toBe(200);
    expect(status.body?.closed).toBe(true);
    expect(status.body?.grants).toHaveLength(0);
    expect((await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Nope" },
    })).status).toBe(409);
  });

  it("DELIBERATE (other pole) — an OPEN round cannot be reopened or late-accepted: 409 ROUND_NOT_CLOSED", async () => {
    const f = makeFounder("openoverride");
    const roundId = makeRound(f.companyId, "Open Override Round", OPEN_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const reopen = await call("POST", `/api/rounds/${roundId}/reopen`, {
      userId: f.userId,
      body: { confirm: true, reason: "no need", reopenUntil: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(reopen.status).toBe(409);
    expect(reopen.body?.error).toBe("ROUND_NOT_CLOSED");

    const late = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId, reason: "no need" },
    });
    expect(late.status).toBe(409);
    expect(late.body?.error).toBe("ROUND_NOT_CLOSED");
    expect(listGrantsForRound(roundId)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ *
   * REVOCATION — an override that cannot be withdrawn is not a control.
   * ------------------------------------------------------------------ */
  it("REVOKE — revoking a late-acceptance grant restores the refusal", async () => {
    const f = makeFounder("revoke");
    const roundId = makeRound(f.companyId, "Revoke Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const grant = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId, reason: "granted in error" },
    });
    expect(grant.status).toBe(200);
    const grantId = grant.body.grant.id as string;

    const revoke = await call("POST", `/api/rounds/${roundId}/late-acceptance/${grantId}/revoke`, {
      userId: f.userId, body: {},
    });
    expect(revoke.status).toBe(200);
    expect(revoke.body?.grant?.revokedAt).toBeTruthy();

    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Revoked Investor" },
    });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("ROUND_CLOSED");
    expect(listSoftCirclesForRound(roundId)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ *
   * SCOPE — a grant names ONE invitation; it does not open the round.
   * ------------------------------------------------------------------ */
  it("SCOPE — a grant for invitation A does not admit a commitment from invitation B", async () => {
    const f = makeFounder("scope");
    const roundId = makeRound(f.companyId, "Scoped Round", CLOSED_DATE);
    const invA = await makeInvitation(roundId, f.companyId, f.userId);
    const invB = await makeInvitation(roundId, f.companyId, f.userId);

    const grant = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId: invA, reason: "A only" },
    });
    expect(grant.status).toBe(200);

    const bRes = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId: invB, investorName: "Investor B" },
    });
    expect(bRes.status).toBe(409);

    const aRes = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId: invA, investorName: "Investor A" },
    });
    expect(aRes.status).toBe(200);
    expect(aRes.body?.acceptedAfterClose).toBe(true);
  });

  /* ------------------------------------------------------------------ *
   * TENANCY — cross-tenant refusals are 404, never 403.
   * ------------------------------------------------------------------ */
  it("TENANCY — a stranger founder gets 404 on close-status / reopen / late-acceptance (never 403, never a leaked close date)", async () => {
    const owner = makeFounder("owner");
    const stranger = makeFounder("stranger");
    const roundId = makeRound(owner.companyId, "Owned Round", CLOSED_DATE);
    const invitationId = await makeInvitation(roundId, owner.companyId, owner.userId);

    for (const [method, path, body] of [
      ["GET", `/api/rounds/${roundId}/close-status`, undefined],
      ["POST", `/api/rounds/${roundId}/reopen`, { confirm: true, reason: "mine now", reopenUntil: new Date(Date.now() + 86_400_000).toISOString() }],
      ["POST", `/api/rounds/${roundId}/late-acceptance`, { confirm: true, invitationId, reason: "mine now" }],
    ] as Array<[string, string, unknown]>) {
      const res = await call(method, path, { userId: stranger.userId, body });
      expect(res.status).toBe(404);
      // A 403 (or a body carrying closedAt) would confirm the round exists.
      expect(res.body?.closedAt).toBeFalsy();
      expect(res.body?.statement).toBeFalsy();
    }
    expect(listGrantsForRound(roundId)).toHaveLength(0);
  });

  it("TENANCY — a late-acceptance naming an invitation from ANOTHER round is 404, not 403", async () => {
    const f = makeFounder("wronground");
    const roundA = makeRound(f.companyId, "Round A", CLOSED_DATE);
    const roundB = makeRound(f.companyId, "Round B", CLOSED_DATE);
    const invB = await makeInvitation(roundB, f.companyId, f.userId);

    const res = await call("POST", `/api/rounds/${roundA}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId: invB, reason: "wrong round" },
    });
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("invitation_not_found");
    expect(listGrantsForRound(roundA)).toHaveLength(0);
  });

  /* ------------------------------------------------------------------ *
   * R6 — a round with NO close date is not silently "expired".
   * ------------------------------------------------------------------ */
  it("R6 — a round with NO close date accepts money and reports the absence explicitly (never a 0-day countdown)", async () => {
    const f = makeFounder("nodate");
    const roundId = makeRound(f.companyId, "No Close Date Round", null);
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId);

    const status = await call("GET", `/api/rounds/${roundId}/close-status`, { userId: f.userId });
    expect(status.status).toBe(200);
    expect(status.body?.hasCloseDate).toBe(false);
    expect(status.body?.closed).toBe(false);
    expect(status.body?.closedAt).toBeNull();
    // No fabricated deadline may be invented to fill the hole.
    expect(status.body?.statement).toBeNull();

    // Undated is NOT closed — refusing here would break every draft round.
    const res = await call("POST", `/api/rounds/${roundId}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Undated Investor" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.acceptedAfterClose).toBe(false);
  });

  /* ------------------------------------------------------------------ *
   * STATE — `state: "closed"` closes the round even with a future date.
   * ------------------------------------------------------------------ */
  it("STATE — a round in state \"closed\" refuses money even when its close DATE is still in the future", async () => {
    const f = makeFounder("stateclosed");
    const r = createRound({
      companyId: f.companyId,
      name: `State Closed ${uniq("rnd")}`,
      type: "Seed",
      state: "closed",
      targetAmount: 1_000_000,
      closeDate: OPEN_DATE,
    });
    const invitationId = await makeInvitation(r.id, f.companyId, f.userId);

    const res = await call("POST", `/api/rounds/${r.id}/soft-circle`, {
      userId: f.userId,
      body: { amount: USD_AMOUNT, currency: "USD", invitationId, investorName: "Too Late Investor" },
    });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("ROUND_CLOSED");

    // And the founder's own view agrees — one definition of closed, not two.
    const status = await call("GET", `/api/rounds/${r.id}/close-status`, { userId: f.userId });
    expect(status.body?.closed).toBe(true);
    expect(status.body?.statement).toContain("closed");
  });

  /* ------------------------------------------------------------------ *
   * THE DECISION MIRROR — the second money door onto the same round.
   * ------------------------------------------------------------------ */
  it("MIRROR — the investor decision route also refuses soft_circle on a closed round, while view/decline still work", async () => {
    const f = makeFounder("mirror");
    const roundId = makeRound(f.companyId, "Mirror Round", CLOSED_DATE);
    const investorEmail = `mirror_${uniq("inv")}@test.example`;
    const invitationId = await makeInvitation(roundId, f.companyId, f.userId, investorEmail);
    /* A REAL invited investor, authorized the way production authorizes them
       (email-matched against the durable invitation) — not the founder wearing
       the investor's hat, which would prove nothing about this route. */
    const investorUserId = registerPersona({
      email: investorEmail,
      name: "Mirror Investor",
      password: "testpassword123",
      invitationId,
      roundId,
      companyId: f.companyId,
    });

    // Viewing a closed round is not a money movement — it must keep working,
    // or an investor cannot even read what they missed.
    const view = await call("PATCH", `/api/rounds/${roundId}/invitations/${invitationId}/decision`, {
      userId: investorUserId, body: { action: "view" },
    });
    expect(view.status).toBe(200);

    const soft = await call("PATCH", `/api/rounds/${roundId}/invitations/${invitationId}/decision`, {
      userId: investorUserId, body: { action: "soft_circle", amount: USD_AMOUNT, currency: "USD", softCircleType: "definite" },
    });
    expect(soft.status).toBe(409);
    expect(soft.body?.error).toBe("ROUND_CLOSED");

    // With a grant, the same door opens and marks the record.
    const grant = await call("POST", `/api/rounds/${roundId}/late-acceptance`, {
      userId: f.userId, body: { confirm: true, invitationId, reason: "Investor decided late." },
    });
    expect(grant.status).toBe(200);

    const soft2 = await call("PATCH", `/api/rounds/${roundId}/invitations/${invitationId}/decision`, {
      userId: investorUserId, body: { action: "soft_circle", amount: USD_AMOUNT, currency: "USD", softCircleType: "definite" },
    });
    expect(soft2.status).toBe(200);
    expect(soft2.body?.acceptedAfterClose).toBe(true);
    expect(soft2.body?.closedAt).toBeTruthy();
  });
});
