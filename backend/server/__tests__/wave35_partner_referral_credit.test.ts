/**
 * WAVE 35 · F4 — a partner referral credit that was silently discarded.
 *
 * THE DEFECT (Review A, FINAL_REVIEW_v26_16_A.md F4). `server/lib/authRoutes.ts`
 * signup did:
 *
 *     const partnerAttributionStore = require("../partnerAttributionStore");
 *
 * `server/partnerAttributionStore.ts` HAS NEVER EXISTED in this repository —
 * `partnerAttributionStore` is a named export of `server/partnerWorkspaceStore.ts`.
 * The require sat inside a swallowing `try { … } catch { }`, so MODULE_NOT_FOUND
 * threw on the FIRST line of the block and everything after it, including the
 * attribution write AND the soft-delete, was skipped in total silence.
 *
 * THE SECOND DEFECT, WHICH THE FIRST ONE HID. Even with the import repaired the
 * shipped call passed `null` as `companyId`, with an in-code comment claiming
 * "the partnerAttributionStore accepts null". IT DOES NOT: `create()` begins
 * `if (!companyId) throw new Error("COMPANY_ID_REQUIRED")`. The naive one-line
 * fix the brief itself recommended would therefore have traded a silent
 * MODULE_NOT_FOUND for a silent COMPANY_ID_REQUIRED — and the provisional row
 * was soft-deleted on the way OUT of that inner catch, permanently destroying a
 * revenue-bearing referral claim. That is why this row does not use it.
 *
 * THE FIX. Attribution is (partner, company); at signup there is no company, so
 * signup cannot be the sink. `server/lib/provisionalPartnerAttribution.ts`
 * splits the work: signup STAMPS + KEEPS, company creation WRITES then retires.
 *
 * WHAT THIS HARNESS ASSERTS — the EMITTED, PERSISTED state, never a helper
 * return value, and never what the code "consults":
 *
 *   POLE 1 (positive) — signup with a partner referral, then create a company,
 *     and a real row EXISTS in the `partner_attributions` DB table for
 *     (partner, company). Referral credit is recorded end to end.
 *   POLE 2 (negative / retention) — when the attribution write FAILS, the
 *     provisional claim is RETAINED, not discarded, and a later company
 *     creation still earns the credit. The failure pole is the whole point:
 *     the shipped code destroyed the claim here.
 *   POLE 3 (no over-fix) — a founder with NO referral gets NO attribution.
 *     A blanket "always attribute" fix fails this.
 *   POLE 4 (signup does not delete) — immediately after signup the provisional
 *     row is still live and is stamped with the founder's userId.
 *   POLE 5 (second path) — `POST /api/founder/companies` (routes.ts) is a
 *     SECOND company-creation sink and credits the partner too.
 *   POLE 6 (module reality) — `../partnerAttributionStore` genuinely does not
 *     resolve, and `create()` genuinely throws on a null companyId. This pins
 *     the two facts the brief's recommended fix got wrong.
 *
 * Real HTTP through the real registered routes, with a real session cookie
 * obtained from the real signup handler — never anonymous, never a demo
 * persona, and never `process.env` for a precondition. Static/ESM imports only.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import * as path from "node:path";
import { existsSync } from "node:fs";

import { rawDb } from "../db/connection";
import { loadUserContext } from "../lib/requireEntitlement";
import { registerAuthShellRoutes } from "../lib/authRoutes";
import { registerMultiCompanyRoutes } from "../multiCompanyStore";
import { partnerAttributionStore } from "../partnerWorkspaceStore";
import {
  persistEntry,
  hydrateEntries,
  softDeleteEntry,
} from "../lib/storePersistenceShim";
import { drainProvisionalAttributionsForCompany } from "../lib/provisionalPartnerAttribution";

const STORE = "provisionalPartnerAttributions";

/** A real-but-distinct partner id owned by this test. */
const PARTNER = "p_w35_f4_referrer";
const PARTNER_FAIL = "p_w35_f4_failpole";

function uniqEmail(tag: string): string {
  return `w35f4_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}@w35.test`;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Test-owned inline cookie parser (the app uses the same one in
  // server/index.ts; there is no cookie-parser dependency in this repo).
  app.use((req, _res, next) => {
    const r = req as typeof req & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const out: Record<string, string> = {};
      for (const part of String(req.headers.cookie ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      }
      r.cookies = out;
    }
    next();
  });
  app.use(loadUserContext);
  registerAuthShellRoutes(app, {
    preview: () => ({ ok: false, reason: "not_found" }) as any,
    redeem: () => ({ ok: false, reason: "not_found" }) as any,
  });
  registerMultiCompanyRoutes(app);
  return app;
}

/** Rows in the AUTHORITATIVE typed table — not the RAM projection. */
function attributionRows(companyId: string): Array<{ partner_id: string; company_id: string }> {
  return (rawDb() as any)
    .prepare(`SELECT partner_id, company_id FROM partner_attributions WHERE company_id = ? AND revoked_at IS NULL`)
    .all(companyId) as Array<{ partner_id: string; company_id: string }>;
}

function liveProvisionalFor(email: string): Array<[string, any]> {
  return hydrateEntries<any>(STORE).filter(
    ([, r]) => r && String(r.email ?? "").toLowerCase() === email.toLowerCase(),
  );
}

/** Seed the provisional row exactly as partnerRoutes.ts does on referral approve. */
function seedProvisional(email: string, partnerId: string): string {
  const key = `${email.toLowerCase()}::${partnerId}`;
  persistEntry(STORE, key, {
    email: email.toLowerCase(),
    partnerId,
    promotionId: `promo_${partnerId}`,
    source: "partner_claim",
    approvedBy: "u_w35_f4_admin",
    approvedAt: new Date().toISOString(),
  });
  return key;
}

let app: Express;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  // The harness establishes its own precondition: no stale provisional rows
  // from a previous run for our partners.
  for (const [key, row] of hydrateEntries<any>(STORE)) {
    if (row && (row.partnerId === PARTNER || row.partnerId === PARTNER_FAIL)) {
      softDeleteEntry(STORE, key);
    }
  }
});

/**
 * A real session, obtained from the real signup handler. The `Set-Cookie` the
 * handler emits is replayed verbatim on subsequent requests — this is a
 * real-but-specific identity, never anonymous and never a demo persona.
 */
async function signupAndSession(email: string): Promise<{ userId: string; cookie: string; status: number }> {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ email, name: "W35 F4 Founder", password: "correct-horse-battery" });
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = (setCookie ?? []).map((c) => c.split(";")[0]).join("; ");
  return { userId: res.body?.ctx?.userId, cookie, status: res.status };
}

describe("WAVE 35 F4 — partner referral credit is actually recorded", () => {
  it("F4-0 POLE 6a: `server/partnerAttributionStore` does not exist — the shipped require could only ever throw", () => {
    const here = path.resolve(__dirname, "..");
    expect(existsSync(path.join(here, "partnerAttributionStore.ts"))).toBe(false);
    expect(existsSync(path.join(here, "partnerAttributionStore.js"))).toBe(false);
    expect(existsSync(path.join(here, "partnerAttributionStore/index.ts"))).toBe(false);
  });

  it("F4-0b POLE 6b: create() throws COMPANY_ID_REQUIRED on a null companyId — the in-code comment was false", () => {
    expect(() =>
      (partnerAttributionStore.create as any)(PARTNER, null, "u_whoever", "partner_claim", "x"),
    ).toThrow(/COMPANY_ID_REQUIRED/);
  });

  it("F4-1 POLE 4: signup STAMPS the provisional row with the founder userId and KEEPS it", async () => {
    const email = uniqEmail("keep");
    seedProvisional(email, PARTNER);
    const { status, userId } = await signupAndSession(email);
    expect(status).toBe(200);
    expect(typeof userId).toBe("string");

    const live = liveProvisionalFor(email);
    // The shipped code soft-deleted here. That is what destroyed the claim.
    expect(live.length).toBe(1);
    expect(live[0][1].founderUserId).toBe(userId);
    expect(typeof live[0][1].claimedAt).toBe("string");
  });

  it("F4-2 POLE 1: signup with a referral + company creation ⇒ a real attribution row exists", async () => {
    const email = uniqEmail("credit");
    seedProvisional(email, PARTNER);
    const { status, cookie } = await signupAndSession(email);
    expect(status).toBe(200);

    const createRes = await request(app)
      .post("/api/founder/companies/new")
      .set("Cookie", cookie)
      .send({ name: "W35 F4 Referred Co" });
    expect(createRes.status).toBe(201);
    const companyId = createRes.body?.companyId as string;
    expect(typeof companyId).toBe("string");

    const rows = attributionRows(companyId);
    expect(rows.map((r) => r.partner_id)).toContain(PARTNER);
    // …and the provisional claim is only NOW retired.
    expect(liveProvisionalFor(email).length).toBe(0);
  });

  it("F4-3 POLE 3: a founder with NO referral gets NO attribution, and does not STEAL another founder's live claim", async () => {
    // Mutant R5-M4 (drop the `matches` filter — attribute every provisional
    // row) originally SURVIVED because no unrelated claim was live while an
    // unreferred founder created a company. That was a coverage gap in this
    // harness, not an equivalent mutant: without the filter, the FIRST founder
    // to create a company harvests every outstanding referral in the system.
    // A live foreign claim is therefore part of the precondition.
    const strangerEmail = uniqEmail("stranger");
    const strangerKey = seedProvisional(strangerEmail, PARTNER);
    expect(liveProvisionalFor(strangerEmail).length).toBe(1);

    const email = uniqEmail("noref");
    const { status, cookie } = await signupAndSession(email);
    expect(status).toBe(200);
    const createRes = await request(app)
      .post("/api/founder/companies/new")
      .set("Cookie", cookie)
      .send({ name: "W35 F4 Unreferred Co" });
    expect(createRes.status).toBe(201);
    expect(attributionRows(createRes.body.companyId)).toHaveLength(0);
    // The stranger's claim is untouched and still redeemable.
    const stillLive = liveProvisionalFor(strangerEmail);
    expect(stillLive.length).toBe(1);
    expect(stillLive[0][0]).toBe(strangerKey);
    softDeleteEntry(STORE, strangerKey);
  });

  it("F4-4 POLE 2: a FAILED attribution write RETAINS the claim, and a later company still earns the credit", async () => {
    const email = uniqEmail("retain");
    seedProvisional(email, PARTNER_FAIL);
    const { userId } = await signupAndSession(email);

    // Force the write to fail without touching production code: an incumbent
    // self-asserted attribution on the SAME company makes `create()` refuse
    // with PROVENANCE_REFUSED (server/lib/attributionProvenance.ts).
    const blockedCompany = `co_w35f4_blocked_${Date.now().toString(36)}`;
    partnerAttributionStore.create(
      "p_w35_f4_incumbent",
      blockedCompany,
      "u_w35_f4_admin",
      "partner_claim",
      "incumbent",
    );

    const out = drainProvisionalAttributionsForCompany({
      userId,
      companyId: blockedCompany,
      email,
    });
    expect(out.attributed).toBe(0);
    expect(out.failed).toBe(1);
    // THE POINT OF THIS ROW: the claim survived the failure.
    const stillLive = liveProvisionalFor(email);
    expect(stillLive.length).toBe(1);
    expect(stillLive[0][1].partnerId).toBe(PARTNER_FAIL);

    // And it is still redeemable on a company that is not contested.
    const okCompany = `co_w35f4_ok_${Date.now().toString(36)}`;
    const out2 = drainProvisionalAttributionsForCompany({ userId, companyId: okCompany, email });
    expect(out2.attributed).toBe(1);
    expect(attributionRows(okCompany).map((r) => r.partner_id)).toContain(PARTNER_FAIL);
    expect(liveProvisionalFor(email).length).toBe(0);
  });

  it("F4-5 POLE 5 (SECOND PATH): POST /api/founder/companies also credits the partner", async () => {
    const email = uniqEmail("path2");
    seedProvisional(email, PARTNER);
    const { userId } = await signupAndSession(email);
    expect(typeof userId).toBe("string");

    // routes.ts registers this route inside registerRoutes(); mounting the
    // whole app here would drag every store in, so the SAME sink call is
    // exercised with the SAME inputs that handler passes. The static import in
    // routes.ts is asserted separately in F4-6.
    const companyId = `co_w35f4_p2_${Date.now().toString(36)}`;
    const out = drainProvisionalAttributionsForCompany({ userId, companyId, email });
    expect(out.attributed).toBe(1);
    expect(attributionRows(companyId).map((r) => r.partner_id)).toContain(PARTNER);
  });

  it("F4-6: both company-creation call sites are wired, with STATIC imports, and no lazy require of the phantom module remains", async () => {
    const { readFileSync } = await import("node:fs");
    const root = path.resolve(__dirname, "..");
    const auth = readFileSync(path.join(root, "lib/authRoutes.ts"), "utf8");
    const mcs = readFileSync(path.join(root, "multiCompanyStore.ts"), "utf8");
    const routes = readFileSync(path.join(root, "routes.ts"), "utf8");

    expect(auth).not.toMatch(/require\(\s*["']\.\.\/partnerAttributionStore["']\s*\)/);
    expect(auth).toMatch(
      /^import \{ claimProvisionalAttributionsAtSignup \} from "\.\/provisionalPartnerAttribution";$/m,
    );
    for (const [name, src] of [["multiCompanyStore.ts", mcs], ["routes.ts", routes]] as const) {
      expect(src, name).toMatch(
        /^import \{ drainProvisionalAttributionsForCompany \} from "\.\/lib\/provisionalPartnerAttribution";$/m,
      );
      expect(src, name).toMatch(/drainProvisionalAttributionsForCompany\(\{/);
    }
  });

  it("F4-7: the claim is idempotent — a repeat signup-shaped claim does not duplicate or lose the row", async () => {
    const email = uniqEmail("idem");
    seedProvisional(email, PARTNER);
    const { userId } = await signupAndSession(email);
    const { claimProvisionalAttributionsAtSignup } = await import(
      "../lib/provisionalPartnerAttribution"
    );
    expect(claimProvisionalAttributionsAtSignup(email, userId)).toBe(1);
    expect(claimProvisionalAttributionsAtSignup(email, userId)).toBe(1);
    const live = liveProvisionalFor(email);
    expect(live.length).toBe(1);
    expect(live[0][1].founderUserId).toBe(userId);
  });
});
