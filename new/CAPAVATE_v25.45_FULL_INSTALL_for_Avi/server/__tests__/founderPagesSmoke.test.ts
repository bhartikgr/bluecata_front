/**
 * Avi 22-May Issue 5 — founder pages smoke test.
 *
 * Avi reported "Founder pages — some modules broken." This file walks every
 * GET endpoint that any founder/* page in client/src/pages/founder/ subscribes
 * to via react-query and asserts the API returns a non-5xx response when
 * called as Maya Chen (the canonical founder demo persona, owning three
 * companies seeded by lib/seedDemoData.ts).
 *
 * The bar:
 *   • Status MUST be < 500. Anything in the 5xx range is a server-side
 *     break and the test fails loudly with the endpoint that broke.
 *   • A 401/403/404 on a specific endpoint is acceptable ONLY if the
 *     endpoint is gated by an entitlement Maya lacks; those rows are
 *     listed explicitly in `EXPECTED_NON_200` below so the test still
 *     pins the contract.
 *   • Any 2xx response is the success path. The test does NOT assert on
 *     response body shape — that's the per-page test's job.
 *
 * This is a smoke test, not a behavioural test. Its purpose is to catch
 * the class of bug Avi reported: an endpoint returning HTML, 500, or a
 * crash because a route was renamed / a store wasn't hydrated / a handler
 * threw uncaught. Each failure tells us exactly which endpoint broke and
 * what status it returned, so the fix has a clear address.
 *
 * Math-sacred guarantee: this test never POSTs to the cap-table commit
 * path. It only exercises read-only GETs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

const MAYA = "u_maya_chen";
const MAYA_COMPANY_ID = "co_novapay"; // seeded by lib/seedDemoData.ts
const MAYA_ROUND_ID = "rnd_seed_extension"; // seeded by lib/seedDemoData.ts

/**
 * Endpoints discovered by grep'ing `queryKey: ["/api/...]` across all 24
 * founder/*.tsx pages. Where an endpoint takes a path param, we substitute
 * Maya's canonical demo ids so the response is realistic.
 *
 * For each endpoint we record the maximum acceptable status. 200 means
 * "must succeed"; the few rows with higher caps are entitlement-gated
 * endpoints where a 401/403/404 is the correct behaviour for Maya.
 */
interface SmokeEndpoint {
  path: string;
  page: string;
  /** Acceptable status codes. Anything outside this list = failure. */
  okStatuses: number[];
}

const ENDPOINTS: SmokeEndpoint[] = [
  // Universal / auth
  { path: "/api/auth/me", page: "all", okStatuses: [200] },

  // Activity feed
  { path: "/api/activity", page: "Activity / Dashboard", okStatuses: [200] },

  // Companies + rounds (core founder surface)
  { path: "/api/companies", page: "Company / CapTable / RoundDetail / RoundNew", okStatuses: [200] },
  { path: "/api/rounds", page: "Rounds / Messages / RoundNew", okStatuses: [200] },

  // Founder profile + completion
  { path: "/api/founder/profile", page: "ProfileWizard / Settings", okStatuses: [200] },
  { path: "/api/founder/profile/completion", page: "Dashboard / Settings", okStatuses: [200] },

  // CRM
  { path: "/api/founder/investor-crm", page: "CRM / Dashboard / Messages / Reports", okStatuses: [200] },

  // Dataroom
  { path: "/api/founder/dataroom/engagement", page: "Dashboard / Dataroom", okStatuses: [200] },
  { path: "/api/founder/dataroom/events", page: "Dataroom", okStatuses: [200] },
  { path: "/api/founder/dataroom/files", page: "Dataroom", okStatuses: [200] },
  { path: "/api/founder/dataroom/folders", page: "Dataroom", okStatuses: [200] },
  { path: "/api/founder/dataroom/permissions", page: "Dataroom", okStatuses: [200] },

  // Reports
  { path: "/api/founder/reports2", page: "Dashboard / ReportNew / Reports", okStatuses: [200] },

  // Billing + subscription
  { path: "/api/founder/invoices", page: "Billing", okStatuses: [200] },
  { path: "/api/founder/subscription", page: "Billing / Settings / Subscribe", okStatuses: [200] },

  // Collective application flow
  {
    path: "/api/founder/collective/applications",
    page: "ApplyToCollective / Collective",
    okStatuses: [200],
  },
  {
    path: "/api/founder/collective/nominations",
    page: "ApplyToCollective / Collective",
    okStatuses: [200],
  },

  // Settings sub-surfaces
  { path: "/api/founder/active-company", page: "Settings", okStatuses: [200] },
  { path: "/api/founder/companies", page: "Settings", okStatuses: [200] },
  { path: "/api/founder/privacy", page: "Settings", okStatuses: [200] },
  { path: "/api/founder/team", page: "Settings", okStatuses: [200] },
  { path: "/api/founder/team/members", page: "Settings", okStatuses: [200] },

  // Comms
  { path: "/api/comms/channels", page: "CapTable / Dashboard", okStatuses: [200] },

  // Investor MA
  { path: "/api/investor/ma/initiatives", page: "Dashboard", okStatuses: [200] },

  // Legal
  { path: "/api/legal/consent/mine", page: "Settings", okStatuses: [200] },

  // Admin endpoint Maya doesn't own — should be 401/403, NOT 500
  {
    path: "/api/admin/pricing-tiers",
    page: "Settings (founder-visible price list)",
    okStatuses: [200, 401, 403],
  },

  // Cap table ledger for a specific round
  {
    path: `/api/founder/captable/ledger?roundId=${MAYA_ROUND_ID}&companyId=${MAYA_COMPANY_ID}`,
    page: "RoundDetail",
    okStatuses: [200, 404],
  },
];

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
}, 30_000);

describe("Avi 22-May Issue 5 — founder pages smoke", () => {
  for (const ep of ENDPOINTS) {
    it(`GET ${ep.path}  [${ep.page}]  returns an acceptable status`, async () => {
      const r = await request(app)
        .get(ep.path)
        .set("x-user-id", MAYA)
        .set("accept", "application/json");
      // The HARD assertion: never a 5xx.
      expect(r.status).toBeLessThan(500);
      // The CONTRACT assertion: status is in the per-endpoint acceptable list.
      if (!ep.okStatuses.includes(r.status)) {
        const preview = JSON.stringify(r.body).slice(0, 280);
        throw new Error(
          `Founder smoke FAILED: GET ${ep.path} → ${r.status}\n` +
            `  page(s): ${ep.page}\n` +
            `  acceptable: [${ep.okStatuses.join(", ")}]\n` +
            `  body preview: ${preview}`,
        );
      }
    });
  }

  it("aggregate: zero founder endpoints returned 5xx", async () => {
    const failures: Array<{ path: string; status: number; body: unknown }> = [];
    for (const ep of ENDPOINTS) {
      const r = await request(app)
        .get(ep.path)
        .set("x-user-id", MAYA)
        .set("accept", "application/json");
      if (r.status >= 500) {
        failures.push({ path: ep.path, status: r.status, body: r.body });
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Founder smoke aggregate FAILED — ${failures.length} endpoints returned 5xx:\n` +
          failures
            .map(
              (f) =>
                `  ${f.path} → ${f.status}  body=${JSON.stringify(f.body).slice(0, 120)}`,
            )
            .join("\n"),
      );
    }
    expect(failures).toHaveLength(0);
  });
});
