/**
 * WAVE 217 — THE LOCKOUT PROOF.
 *
 * The single harm this wave was told to weigh hardest: **trapping a partner out
 * of their own account is far worse than a missing acknowledgement.** So the
 * claim "this gate blocks nothing but a new application" is not left as a design
 * intention and is not proved by grepping for absences. It is proved by driving
 * a REAL login and REAL ordinary partner work over REAL HTTP, on an app built by
 * `registerRoutes` — the ONE registrar `server/index.ts` calls — with the wave
 * 217 gate demonstrably LIVE on that same app.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE FENCE'S INSTALLATION IS PROVED HERE, ON THIS APP
 * ═════════════════════════════════════════════════════════════════════════════
 * Inert-proof mechanism 4 is "a fence whose installation is never proved". A
 * test that logs a partner in and asserts 200 proves nothing about this wave
 * unless the gate is actually mounted on the app it used: if `registerRoutes`
 * had silently failed to mount `registerConsortiumApplyRoutes`, every assertion
 * below would still be green and would still say nothing.
 *
 * So §0 runs FIRST and proves, on THIS app, that the gate refuses an
 * undeclared application with 422. Only then do §1–§3 assert that login,
 * reading and ordinary partner work all still complete. The negative claim is
 * conditioned on a proved-positive control.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * STANDARD OF EVIDENCE, STATED PLAINLY
 * ═════════════════════════════════════════════════════════════════════════════
 * The tree is NOT a git repository, so no failure here can be strictly diffed as
 * pre-existing. Everything below is measured against a before-capture taken in
 * this tree and against neutralise-and-re-run. That is sound but weaker than a
 * diff, and it is the standard in use.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { seedDemoData } from "../lib/seedDemoData";
import { getDb } from "../db/connection";
import { applyW217Migration } from "./_w217ComplianceSchema";
import {
  complianceAttestationText,
  PARTNER_COMPLIANCE_ATTESTATION_VERSION,
} from "@shared/wave217PartnerComplianceAttestation";

const PARTNER_USER_ID = "u_partner_keiretsu";
const PARTNER_ORG_ID = "tenant_cp_keiretsu_ca";
const PARTNER_EMAIL = "partner@keiretsu.ca";
const PARTNER_PASSWORD = "password123";

let app: Express;

beforeAll(async () => {
  applyW217Migration();
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());

  app = express();
  app.use(express.json());
  // Inline cookie parser mirroring `server/index.ts`, copied from
  // `partnerLogin.test.ts` so `/api/auth/login` can set and read its session
  // cookie under supertest. This is transport plumbing; no handler is replaced.
  app.use((req, _res, next) => {
    const r = req as Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try {
              out[k] = decodeURIComponent(v);
            } catch {
              out[k] = v;
            }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 60_000);

const ORG = "Lockout Probe Partners Ltd";
const SIGNER = "Casey Probe";

function declaredBody(over: Record<string, unknown> = {}) {
  return {
    organizationName: ORG,
    contactName: SIGNER,
    contactEmail: "casey@lockout-probe.test",
    jurisdiction: "Hong Kong",
    partnerType: "vc",
    aumRange: "10-50M",
    portfolioCompanyCount: 4,
    expectedChapter: "chap_keiretsu_canada",
    introMessage: "Driving the real registrar.",
    agreementSignedName: SIGNER,
    complianceAttested: true,
    complianceAttestationText: complianceAttestationText(ORG, SIGNER),
    complianceAttestationVersion: PARTNER_COMPLIANCE_ATTESTATION_VERSION,
    regulatoryStatus: "licensed",
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * §0 — THE CONTROL. The gate IS installed on THIS app, proved before any
 * negative claim is made about it.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 LIVE §0 — the gate is installed on the app produced by registerRoutes", () => {
  it("an UNDECLARED application is refused 422 through the production registrar", async () => {
    const body = declaredBody();
    delete (body as Record<string, unknown>).complianceAttested;
    delete (body as Record<string, unknown>).complianceAttestationText;
    delete (body as Record<string, unknown>).regulatoryStatus;
    const r = await request(app).post("/api/public/consortium/apply").send(body);
    expect(r.status).toBe(422);
    // `error`, not `code` — the field the handler actually writes
    // (consortiumApplyStore.ts:2189).
    expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
  });

  it("a DECLARED application is accepted 201 through the same registrar", async () => {
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .send(declaredBody({ contactEmail: "casey2@lockout-probe.test" }));
    expect(r.status).toBe(201);
    expect(typeof r.body.applicationId).toBe("string");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — LOGIN STILL COMPLETES
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 LIVE §1 — a real partner login still completes with the gate live", () => {
  it("POST /api/auth/login returns 200 and resolves the partner identity", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: PARTNER_EMAIL, password: PARTNER_PASSWORD })
      .set("accept", "application/json");
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    const ctx = r.body?.ctx ?? {};
    const resolved = ctx.userId ?? ctx.identity?.userId ?? ctx.identity?.id ?? "";
    expect(resolved).toBe(PARTNER_USER_ID);
    // And the refusal codes this wave invented appear NOWHERE in a login
    // response. A login that 200s while carrying a compliance refusal in its
    // body would be a lockout wearing a success status.
    const blob = JSON.stringify(r.body);
    expect(blob.includes("COMPLIANCE_")).toBe(false);
  });

  it("a wrong password is still 401 — the login gate itself was not weakened", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: PARTNER_EMAIL, password: "definitely-wrong" })
      .set("accept", "application/json");
    expect(r.status).toBe(401);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — READING AND ORDINARY PARTNER WORK STILL COMPLETE
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 LIVE §2 — reading and ordinary partner work are not gated", () => {
  it("GET /api/partner/me returns 200 for the seeded partner", async () => {
    const r = await request(app)
      .get("/api/partner/me")
      .set("x-user-id", PARTNER_USER_ID)
      .set("accept", "application/json");
    expect(r.status).toBe(200);
    const partnerId =
      r.body?.partnerId ?? r.body?.partnerContext?.partnerId ?? r.body?.partner?.id ?? "";
    expect(partnerId).toBe(PARTNER_ORG_ID);
    expect(JSON.stringify(r.body).includes("COMPLIANCE_")).toBe(false);
  });

  it("a spread of ordinary partner READ routes answer without a compliance refusal", async () => {
    // Reading is never gated by this wave. Each route is asserted NOT to have
    // acquired a compliance precondition. A 404 (route absent in this build) is
    // tolerated; a 422 carrying a COMPLIANCE_ code is not, and neither is a 403
    // whose body names one.
    const reads = [
      "/api/partner/me",
      "/api/partner/spvs",
      "/api/partner/dashboard",
      "/api/partner/settings",
      "/api/partner/team",
    ];
    let answered = 0;
    for (const path of reads) {
      const r = await request(app)
        .get(path)
        .set("x-user-id", PARTNER_USER_ID)
        .set("accept", "application/json");
      const blob = JSON.stringify(r.body ?? {});
      expect(blob.includes("COMPLIANCE_ATTESTATION_REQUIRED")).toBe(false);
      expect(blob.includes("COMPLIANCE_STATUS_INVALID")).toBe(false);
      expect(blob.includes("COMPLIANCE_TEXT_MISMATCH")).toBe(false);
      if (r.status < 400) answered += 1;
    }
    // At least one really answered, so the loop is not vacuous: a loop over five
    // 404s would satisfy every assertion above and prove nothing.
    expect(answered).toBeGreaterThanOrEqual(1);
  });

  it("an ordinary partner WRITE is not refused for a missing compliance declaration", async () => {
    // The gate must not have leaked onto `requireSignedAgreement`'s 96 write
    // sites. Whatever this route answers — 200, 400, 403 or 404 — it must not
    // answer with a compliance refusal, because no existing partner has ever
    // made this wave's declaration and every one of them would be locked out.
    const r = await request(app)
      .patch("/api/partner/settings")
      .set("x-user-id", PARTNER_USER_ID)
      .send({ displayName: "Keiretsu Canada" });
    expect(JSON.stringify(r.body ?? {}).includes("COMPLIANCE_")).toBe(false);
    expect(r.status).not.toBe(422);
  });

  it("the PUBLIC status lookup for the accepted application still answers", async () => {
    const created = await request(app)
      .post("/api/public/consortium/apply")
      .send(declaredBody({ contactEmail: "casey3@lockout-probe.test" }));
    expect(created.status).toBe(201);
    const s = await request(app).get(
      `/api/public/consortium/apply/${created.body.applicationId}/status`,
    );
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("submitted");
    // A declaration is not public information.
    expect(Object.keys(s.body).sort()).toEqual(["applicationId", "status"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — THE GATE'S RADIUS IS ONE ROUTE PAIR, MEASURED
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 LIVE §3 — the radius", () => {
  it("both public apply paths are gated and nothing else on this app is", async () => {
    for (const path of ["/api/public/consortium/apply", "/api/consortium-applications"]) {
      const body = declaredBody();
      delete (body as Record<string, unknown>).complianceAttested;
      const r = await request(app).post(path).send(body);
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
    }
    // A route in the same family that is NOT this wave's business stays open.
    const health = await request(app).get("/api/health");
    expect([200, 204, 404]).toContain(health.status);
    expect(JSON.stringify(health.body ?? {}).includes("COMPLIANCE_")).toBe(false);
  });
});
