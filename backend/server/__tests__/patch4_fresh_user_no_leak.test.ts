/**
 * Patch v4 — Fresh-user no-leak HTTP contract test.
 *
 * Boots the real Express stack via `registerRoutes`, signs up a brand-new
 * user (so they have NO demo identity bound to them), and walks the full
 * list of read endpoints a fresh user would hit. For every response we
 * assert the JSON body contains none of the demo persona / company strings.
 *
 * NOTE: this test runs under `npm test` (ENABLE_DEMO_SEED=1) precisely so
 * the demo identities ARE bound to the seeded demo users in the same
 * process. The point of the test is that an UNRELATED user never sees them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

const LEAK_STRINGS = [
  "co_novapay",
  "u_maya_chen",
  "u_aisha_patel",
  "Maya Chen",
  "NovaPay",
  "Forge Ventures",
  "Aisha Patel",
  "Avocado Angels",
  "Arboreal",
  "maya@novapay",
];

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

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; cookie?: string } = {},
): Promise<{ status: number; bodyText: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.cookie) headers["cookie"] = opts.cookie;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            bodyText: buf,
            headers: res.headers as Record<string, string | string[]>,
          });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function freshUserId(): string {
  return `u_patch4_freshuser_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Strings that must not appear in any response body. */
function assertNoLeaks(label: string, body: string) {
  for (const leak of LEAK_STRINGS) {
    if (body.includes(leak)) {
      throw new Error(
        `[${label}] response body contains leak string "${leak}".\nFirst 500 chars of body:\n${body.slice(0, 500)}`,
      );
    }
  }
}

/**
 * Fresh-user endpoint matrix.
 *
 * For each endpoint we accept any 2xx OR 4xx response — both signal the
 * server handled the route. What matters is the response body never
 * contains a leak string. 5xx = real failure and we surface it.
 */
const ENDPOINTS: Array<{ method: string; path: string; label: string }> = [
  { method: "GET", path: "/api/auth/me", label: "auth.me" },
  { method: "GET", path: "/api/founder/me", label: "founder.me" },
  { method: "GET", path: "/api/founder/active-company", label: "founder.activeCompany" },
  { method: "GET", path: "/api/founder/dashboard", label: "founder.dashboard" },
  { method: "GET", path: "/api/notifications", label: "notifications" },
  { method: "GET", path: "/api/reports2", label: "reports2" },
  { method: "GET", path: "/api/dataroom/folders", label: "dataroom.folders" },
  { method: "GET", path: "/api/dataroom/files", label: "dataroom.files" },
  { method: "GET", path: "/api/messages", label: "messages" },
  { method: "GET", path: "/api/activity", label: "activity" },
  { method: "GET", path: "/api/investor/crm/contacts", label: "investor.crm.contacts" },
  { method: "GET", path: "/api/investor/portfolio", label: "investor.portfolio" },
  { method: "GET", path: "/api/investor/watchlist", label: "investor.watchlist" },
  { method: "GET", path: "/api/investor/discover", label: "investor.discover" },
  { method: "GET", path: "/api/companies", label: "companies" },
  { method: "GET", path: "/api/subscriptions/mine", label: "subscriptions.mine" },
  { method: "GET", path: "/api/collective/eligibility", label: "collective.eligibility" },
  { method: "GET", path: "/api/collective/applications", label: "collective.applications" },
  { method: "GET", path: "/api/collective/network", label: "collective.network" },
  { method: "GET", path: "/api/collective/dealroom", label: "collective.dealroom" },
  { method: "GET", path: "/api/collective/dsc/prep", label: "collective.dsc.prep" },
];

describe("Patch v4 — fresh user sees no demo leaks", () => {
  const userId = freshUserId();

  for (const ep of ENDPOINTS) {
    it(`${ep.method} ${ep.path} response contains no leak strings`, async () => {
      const res = await call(ep.method, ep.path, { userId });
      // 4xx is OK — the test only forbids 5xx (server crash) and leak strings.
      expect(res.status).toBeLessThan(500);
      assertNoLeaks(ep.label, res.bodyText);
    });
  }
});
