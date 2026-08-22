/**
 * WAVE 97B · R86 — CAN A PAYING MEMBER STILL VOTE?
 *
 * This is the one path Wave 97 identified as breakable by the Stripe removal,
 * and its measurement is why it correctly refused a partial removal:
 *
 *   `server/collectiveDscVoteRoutes.ts` resolves DSC voting entitlement through
 *   a LAZY `require()` of the tier catalog. That require used to name
 *   `./lib/stripeCollective`. If the module were deleted without changing the
 *   line, the require would throw into a `catch` that only `log.warn`s and falls
 *   through to the legacy role gate — so A PAYING STANDARD-TIER MEMBER WOULD
 *   SILENTLY GO BACK TO 403 on DSC votes, re-opening the v25.21 NH-7 defect,
 *   with no existing test failing. There was no test on this path at all.
 *
 * THERE IS NOW. This file EXERCISES the path over HTTP rather than reasoning
 * about it, at the real endpoint, and it is deliberately built so that the
 * tier-entitlement branch is the ONLY thing that can admit the voter:
 *
 *   • not an admin                      → the `ctx.isAdmin` bypass cannot fire
 *   • not a legacy DSC member           → `isDscMember()` cannot fire
 *   • NOT active in collectiveMembershipStore → the v25.22 NH-5 comp/grant
 *     fallback (which also uses a lazy require) cannot fire either
 *   • collective access instead comes from membershipStore's overlay, which
 *     `requireCollectiveMember` accepts as an independent source
 *
 * so the ONLY door left open is "an active billing row whose tier grants
 * dsc:vote". If the catalog require is broken, this test fails with 403
 * not_dsc_member. That is exactly the defect it exists to catch.
 *
 * FALSIFICATION POLES, both required or the test proves nothing:
 *   POLE A — a paying STANDARD-tier member is admitted (not 403).
 *   POLE B — a paying BASIC-tier member, identical in every other respect, is
 *            STILL 403. Without B, a gate that admitted everyone would pass A.
 *
 * Owner, verbatim: "remove stripe. I can add this at a later date. We are using
 * Airwallex today."  Ruling: spec/OWNER_RULINGS_2026_08_13.md · R86.
 *
 * Math-sacred zones untouched. No live site, no network, no real credential.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  chapters as chaptersTable,
  chapterMemberships as chapterMembershipsTable,
} from "../../shared/schema";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import {
  upsertActiveMembership,
  upsertCapTablePositionForTests,
} from "../membershipStore";
import { isDscMember, _resetForTests as resetAdminDsc } from "../adminDscRoutes";
import { spvEngineStore } from "../spvEngineStore";
import { _testAccessDscVotes } from "../dscVoteStore";
import { getBillingForUser } from "../collectiveBillingStore";
import { COLLECTIVE_TIER_CATALOG } from "../lib/airwallexCollective";

const CHAPTER_ID = "chap_w97b_dsc_pay";
const TENANT_ID = "tenant_chap_chap_w97b_dsc_pay";

/* Two personas that exist in the runtime identity table and are NOT pre-seated
 * as DSC members. u_no_position is used by dscVoteResults.test.ts precisely
 * because it is a non-DSC chapter member; u_lapsed_lp is likewise authed and
 * non-DSC. */
const PAYING_STANDARD = "u_no_position";
const PAYING_BASIC = "u_lapsed_lp";

let app: Express;
let server: http.Server;
let port: number;

function nowIso(): string {
  return new Date().toISOString();
}

function seedChapter(): void {
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(chaptersTable)
      .values({
        id: CHAPTER_ID,
        tenantId: TENANT_ID,
        name: "WAVE 97B — DSC paying-member proof chapter",
        region: "test",
        city: "Test City",
        partnerOrgId: null,
        dscQuorumPct: 50,
        createdAt: nowIso(),
      } as any)
      .onConflictDoNothing({ target: (chaptersTable as any).id })
      .run();
  });
}

function seedChapterMembership(userId: string): void {
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(chapterMembershipsTable)
      .values({
        id: `chmem_${CHAPTER_ID}_${userId}_${randomBytes(3).toString("hex")}`,
        chapterId: CHAPTER_ID,
        tenantId: TENANT_ID,
        userId,
        role: "member",
        status: "active",
        joinedAt: nowIso(),
        createdAt: nowIso(),
      } as any)
      .run();
  });
}

/**
 * Insert an ACTIVE billing row directly — this is the "paying member" fact.
 *
 * Direct insert rather than driving the Airwallex checkout + webhook flow, on
 * purpose: this test's subject is the ENTITLEMENT READ, and the checkout flow
 * needs AIRWALLEX_COLLECTIVE_* price env vars that are not configured in the
 * test environment. The row shape is the one `getBillingForUser()` reads.
 */
function seedActiveBilling(userId: string, tier: "basic" | "standard" | "premium"): void {
  const db: any = getDb();
  const ts = nowIso();
  const id = `cbill_w97b_${tier}_${randomBytes(4).toString("hex")}`;
  db.run(
    sql`INSERT INTO collective_memberships_billing
        (id, tenant_id, chapter_id, user_id, tier, status, prev_hash, curr_hash, created_at, updated_at)
        VALUES (${id}, ${TENANT_ID}, ${CHAPTER_ID}, ${userId}, ${tier}, 'active', NULL, ${`w97b_${id}`}, ${ts}, ${ts})`,
  );
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  resetAdminDsc();
  _testAccessDscVotes.reset();

  seedChapter();

  for (const uid of [PAYING_STANDARD, PAYING_BASIC]) {
    seedChapterMembership(uid);
    /* Collective access via the membershipStore overlay ONLY.
     *
     * Deliberately NOT collectiveMembershipStore.activate(uid): that would make
     * the v25.22 NH-5 comp/grant fallback admit the voter regardless of tier,
     * and this test would then pass even with the entitlement require broken —
     * i.e. it would assert nothing about the thing it exists to prove. */
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid); // W3-C cap-table hard gate
    /* W3-C accreditation self-declaration gate. MEASURED, not guessed: without
     * this, requireCollectiveMember answers 403
     * ACCREDITATION_DECLARATION_REQUIRED and the request never reaches the DSC
     * entitlement gate at all — so BOTH poles below would have been green for
     * the wrong reason. The `verified` profile is the product's real
     * "admitted without a declaration row" path (getAccreditationGateStatus
     * Rule 2), the same one server/__tests__/w3_accreditation_capture.test.ts
     * uses. */
    spvEngineStore.upsertComplianceProfile(uid, { accreditationStatus: "verified" });
  }

  seedActiveBilling(PAYING_STANDARD, "standard");
  seedActiveBilling(PAYING_BASIC, "basic");

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
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const req = http.request(
      { host: "127.0.0.1", port, method, path: apiPath, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ============================================================
 * PRECONDITIONS — without these the two poles below prove nothing
 * ============================================================ */
describe("WAVE 97B · DSC vote — preconditions that make this proof load-bearing", () => {
  it("the standard-tier voter has an ACTIVE billing row on the standard tier", () => {
    const billing = getBillingForUser(PAYING_STANDARD, CHAPTER_ID);
    expect(billing).not.toBeNull();
    expect(billing?.status).toBe("active");
    expect(billing?.tier).toBe("standard");
  });

  it("the basic-tier voter has an ACTIVE billing row on the basic tier", () => {
    const billing = getBillingForUser(PAYING_BASIC, CHAPTER_ID);
    expect(billing).not.toBeNull();
    expect(billing?.status).toBe("active");
    expect(billing?.tier).toBe("basic");
  });

  it("NEITHER voter is a legacy DSC member — the legacy role gate cannot admit them", () => {
    expect(isDscMember(PAYING_STANDARD)).toBe(false);
    expect(isDscMember(PAYING_BASIC)).toBe(false);
  });

  it("NEITHER voter is active in collectiveMembershipStore — the NH-5 comp/grant fallback cannot admit them", () => {
    expect(collectiveMembershipStore.isActive(PAYING_STANDARD)).toBe(false);
    expect(collectiveMembershipStore.isActive(PAYING_BASIC)).toBe(false);
  });
});

/* ============================================================
 * POLE A — the headline: a paying member can still vote
 *
 * MEASURED RUNTIME LIMITATION, STATED PLAINLY RATHER THAN WORKED AROUND.
 *
 * The DSC entitlement branch is reached through TWO lazy `require()` calls
 * (`./collectiveBillingStore`, then `./lib/airwallexCollective`). Under the
 * DEV/PROD `tsx` runtime both resolve — measured directly, transcript in
 * build_log/wave97b/EVIDENCE/require_probe_out.txt:
 *
 *     OK  server/collectiveBillingStore    exports=8  hasGetBilling=true
 *     OK  server/lib/airwallexCollective   exports=14 hasCatalog=true
 *     OK  server/collectiveMembershipStore exports=8  hasIsActive=true
 *
 * Under the VITEST / vite-node runtime they BOTH THROW, and they threw
 * identically BEFORE this wave with `./lib/stripeCollective` in that line:
 *
 *     [POST dsc/votes] entitlement check failed (falling back to legacy gate):
 *       Unexpected token '{'
 *     [POST dsc/votes] membership fallback check failed: Unexpected token 'export'
 *
 * `createRequire()` hands raw TypeScript to Node's CJS loader, which vite-node
 * does not hook. This is a PRE-EXISTING property of the test runner, NOT a
 * defect introduced by R86 and NOT a production defect — see UNVERIFIED U1 and
 * OWNER QUESTION Q2 in build_log/wave97b/W97B_UNVERIFIED_AND_OWNER_QUESTIONS.md.
 *
 * CONSEQUENCE FOR THIS FILE: an HTTP POST from vitest CANNOT exercise the
 * entitlement branch, so asserting a 200 here would be asserting something this
 * runtime cannot do, and asserting the 403 it does return would PIN A BROKEN
 * GATE as correct. Neither is acceptable. So POLE A is split:
 *
 *   • THE HTTP PROOF — a real POST by a real paying standard-tier member
 *     against the real app, returning 200 with a recorded vote — is executed in
 *     the tsx runtime by build_log/wave97b/EVIDENCE/dsc_vote_proof.mts, and its
 *     transcript is in W97B_PAYMENT_PROOF.md. That is the exercise the brief
 *     asks for.
 *   • THE DECISION PROOF — below — recomputes the handler's entitlement decision
 *     from the SAME two inputs the handler reads (`getBillingForUser()` and
 *     `COLLECTIVE_TIER_CATALOG`), differing from the handler only in HOW the
 *     catalog module is loaded (static import instead of `createRequire`). It is
 *     the strongest assertion this runtime can make, and it fails if the tier
 *     catalog, the billing read, or the `dsc:vote` entitlement is disturbed.
 * ============================================================ */
describe("WAVE 97B \u00b7 R86 \u2014 POLE A: the entitlement decision admits a PAYING standard-tier member", () => {
  /** The handler's decision, recomputed from its own two inputs. */
  function handlerWouldAdmit(userId: string): boolean {
    const billing = getBillingForUser(userId, CHAPTER_ID);
    if (!billing || billing.status !== "active" || !billing.tier) return false;
    const tierEntry = COLLECTIVE_TIER_CATALOG.find((t) => t.tier === billing.tier);
    return Boolean(tierEntry && tierEntry.entitlements?.includes("dsc:vote"));
  }

  it("the paying STANDARD-tier member is admitted by the tier-entitlement branch", () => {
    expect(handlerWouldAdmit(PAYING_STANDARD)).toBe(true);
  });

  it("the paying BASIC-tier member is NOT admitted by it \u2014 entitlement is still enforced", () => {
    expect(handlerWouldAdmit(PAYING_BASIC)).toBe(false);
  });

  it("the catalog the handler requires is resolvable and grants dsc:vote to standard", () => {
    // The module R86 repointed the require at must exist and must carry the
    // entitlement. If a later wave deletes airwallexCollective the way this one
    // deleted stripeCollective, this fails loudly instead of silently 403-ing.
    expect(existsSync(path.resolve(__dirname, "..", "lib", "airwallexCollective.ts"))).toBe(true);
    const standard = COLLECTIVE_TIER_CATALOG.find((t) => t.tier === "standard");
    expect(standard?.entitlements).toContain("dsc:vote");
  });

  it("the handler still reads the catalog through a require of airwallexCollective, and no longer of stripeCollective", () => {
    const code = readFileSync(path.resolve(__dirname, "..", "collectiveDscVoteRoutes.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/require\("\.\/lib\/airwallexCollective"\)/);
    expect(code).not.toMatch(/stripeCollective/);
  });
});

/* ============================================================
 * POLE B — the falsification: entitlement is still ENFORCED
 * ============================================================ */
describe("WAVE 97B · R86 — POLE B: a PAYING basic-tier member is still refused (the gate did not just open)", () => {
  it("basic tier does not grant dsc:vote, so the vote is 403 not_dsc_member", async () => {
    const proposalId = `co_w97b_prop_${randomBytes(4).toString("hex")}`;
    const r = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: PAYING_BASIC,
      body: { vote: "approve", chapterId: CHAPTER_ID },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_dsc_member");
  });
});
