/**
 * WAVE 29 · ITEM 1 — `/api/investor/companies/:companyId` and the inert
 * `gate("investor.onCapTableOf")` (routes.ts:1688, Wave 28 §1.6 row H).
 *
 * ── WHY THIS ONE IS DIFFERENT FROM THE OTHER EIGHT ─────────────────────────
 * The anonymous probe run for this wave classified row H as category (a):
 * both `co-members` routes return 401 to a caller with no identity, so the
 * data was never public. That is TRUE and it is NOT THE WHOLE ANSWER.
 *
 * `investor.onCapTableOf` is an AUTHORIZATION gate, not an authentication
 * check. The question it exists to answer is not "is this caller logged in?"
 * but "is this caller on THIS company's cap table?". An anonymous probe is
 * structurally incapable of asking that, so answering it needs a second probe
 * with a real, wrong identity — Rule 2's "hunt a SECOND path".
 *
 * That probe (`build_log/w29/w29_idor.json`) found:
 *
 *   GET /api/investor/companies/co_novapay/co-members
 *     as u_no_position  (no cap table anywhere, no companies)  -> 200
 *     as u_avi_viewer   (a partner, not an investor at all)    -> 200
 *     as u_daniel_okafor(no cap table)                         -> 200
 *   ... 200 for EVERY authenticated persona, on EVERY company.
 *
 * Both handlers authenticate and then never ask the cap-table question:
 *   · `server/sprint21Routes.ts:217`          — checks `ctx.isAuthed`, nothing else
 *   · `server/collectiveNetworkStore.ts:91`   — checks `ctx.isAuthed`, nothing else
 * The second one returns `amount`, `currency`, `shares` and `state` per
 * investor: not merely WHO is on a cap table but HOW MUCH each of them put in.
 * `gate("investor.onCapTableOf")` is precisely the control for that, and it has
 * never once executed.
 *
 * This is the same shape as Wave 25's X-C1 SPV-LP work, and it is held to the
 * same standard: prove the outsider is refused AND prove the real cap-table
 * member still gets their co-investors.
 *
 * ── THE FIX IS THE MOUNT MOVE, AND HERE THAT IS THE RIGHT FIX ──────────────
 * Unlike `/api/investor/crm` (where the mount is an *entitlement* gate that
 * would have locked out cap-table-less investors — see §1.5 of the report),
 * this gate's predicate IS the missing check, its `:companyId` param is exactly
 * the resource being authorised, and the population it refuses is exactly the
 * population that should be refused. Moving it is a fix, not a lockout.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";
import { getUserContextForId } from "../lib/userContext";

let app: Express;
let server: http.Server;

/** Real seeded personas. `u_aisha_patel` is on co_novapay's cap table;
 *  `u_no_position` is on no cap table at all. Both facts are ASSERTED in case
 *  (0) rather than assumed — a fixture drift that put Aisha off the cap table
 *  would otherwise turn case (2) into a vacuous pass. */
const ON_CAPTABLE = "u_aisha_patel";
const OUTSIDER = "u_no_position";
const PARTNER = "u_avi_viewer";
const COMPANY = "co_novapay";

/* PARENT FIX 2026-08-11 — this precondition was asserted but not ESTABLISHED, so the
   whole file failed in `beforeAll` and reported "7 skipped" under a plain
   `npx vitest run`. It only passed when a human remembered `DISABLE_DEV_BYPASS=1`
   on the command line. A test that silently skips in CI is a check that checks
   nothing (instance 21 in this build) — and this one guards the most serious defect
   found: `GET /api/investor/companies/:id/co-members` returned 200 with per-investor
   amount/currency/shares to EVERY authenticated persona for EVERY company.
   The variable is now SET here and restored afterwards, so the file is
   self-sufficient. The assertion is kept immediately after, so if the mechanism ever
   stops taking effect the file still fails loudly rather than passing vacuously. */
const PRIOR_DEV_BYPASS = process.env.DISABLE_DEV_BYPASS;

beforeAll(async () => {
  process.env.DISABLE_DEV_BYPASS = "1";
  expect(
    process.env.DISABLE_DEV_BYPASS,
    "MUST run with DISABLE_DEV_BYPASS=1 — otherwise an identity-less request " +
      "resolves to the demo persona and the outsider poles are meaningless."
  ).toBe("1");

  app = express();
  app.use(express.json());
  // Mirrors server/index.ts:75-94 — the cookie identity channel lives OUTSIDE
  // registerRoutes, so a harness without it has no way to authenticate.
  app.use((req, _res, next) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          if (k) out[k] = part.slice(eq + 1).trim();
        }
      }
      r.cookies = out;
    }
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  // Restore, so this file cannot leak an env var into sibling suites sharing the
  // worker — Wave 19 leaked exactly this variable and reddened unrelated tests.
  if (PRIOR_DEV_BYPASS === undefined) delete process.env.DISABLE_DEV_BYPASS;
  else process.env.DISABLE_DEV_BYPASS = PRIOR_DEV_BYPASS;
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

function as(userId: string, url: string) {
  return request(app)
    .get(url)
    .set("Cookie", `${LEGACY_SESSION_COOKIE}=${signSessionValue(userId)}`);
}

describe("WAVE 29 · ITEM 1 — CONTROL: the fixture really has an insider and an outsider", () => {
  it("(0) u_aisha_patel IS on co_novapay's cap table and u_no_position is on NO cap table — asserted, not assumed", () => {
    const insider = getUserContextForId(ON_CAPTABLE);
    const outsider = getUserContextForId(OUTSIDER);
    expect(insider.isAuthed).toBe(true);
    expect(outsider.isAuthed).toBe(true); // the outsider is LOGGED IN — that is the point
    expect(insider.investor.capTablePositions.map((p) => p.companyId)).toContain(COMPANY);
    expect(outsider.investor.capTablePositions).toHaveLength(0);
  });
});

describe("WAVE 29 · ITEM 1 — co-members is refused to callers who are not on the cap table", () => {
  it("(1) an authenticated OUTSIDER is refused 403 NOT_ON_CAP_TABLE — this returned 200 before the gate was moved", async () => {
    const r = await as(OUTSIDER, `/api/investor/companies/${COMPANY}/co-members`);
    expect(r.status).toBe(403);
    expect(r.body?.code ?? r.body?.error).toBe("NOT_ON_CAP_TABLE");
  }, 60_000);

  it("(2) THE OTHER POLE — a real cap-table member still gets their co-members, 200, with a usable body", async () => {
    // Without this, a gate that refuses EVERYONE passes case (1) perfectly.
    const r = await as(ON_CAPTABLE, `/api/investor/companies/${COMPANY}/co-members`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body) || Array.isArray(r.body?.members)).toBe(true);
  }, 60_000);

  it("(3) a partner persona — authenticated, but not an investor at all — is refused", async () => {
    const r = await as(PARTNER, `/api/investor/companies/${COMPANY}/co-members`);
    expect(r.status).toBe(403);
  }, 60_000);

  it("(4) an insider on company A is refused on company B — the gate is per-company, not a global 'has any cap table' flag", async () => {
    // u_aisha_patel is on co_novapay and co_arboreal but NOT co_kelvin.
    const ctx = getUserContextForId(ON_CAPTABLE);
    const positions = ctx.investor.capTablePositions.map((p) => p.companyId);
    expect(positions).not.toContain("co_kelvin"); // control for the case below

    const r = await as(ON_CAPTABLE, "/api/investor/companies/co_kelvin/co-members");
    expect(r.status).toBe(403);

    // And still allowed on the one she IS on — both poles, same identity.
    const ok = await as(ON_CAPTABLE, "/api/investor/companies/co_arboreal/co-members");
    expect(ok.status).toBe(200);
  }, 60_000);

  it("(5) an ANONYMOUS caller is still refused — the pre-existing 401 was not traded away for the new 403", async () => {
    const r = await request(app).get(`/api/investor/companies/${COMPANY}/co-members`);
    expect([401, 403]).toContain(r.status);
  }, 60_000);

  it("(6) the SIBLING route under the same prefix that was ALREADY gated still works for its rightful caller — the move did not over-reach", async () => {
    // routes.ts:1688 claims 4 routes; 2 were already below the mount and
    // correctly gated before this wave. They must be unchanged.
    const ok = await as(ON_CAPTABLE, `/api/investor/companies/${COMPANY}/co-members`);
    expect(ok.status).toBe(200);
    const refused = await as(OUTSIDER, `/api/investor/companies/${COMPANY}/co-members`);
    expect(refused.status).toBe(403);
  }, 60_000);
});
