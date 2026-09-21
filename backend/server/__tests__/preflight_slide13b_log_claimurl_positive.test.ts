/**
 * INDEPENDENT REVIEWER — API-LOGGING ADDENDUM POSITIVE CONTROL
 * "a one-time claim URL must never reach operational logs".
 *
 * Two layers, deliberately separated:
 *
 *  1. ALWAYS-ON (runs today, no dependency on the pending change): drive the
 *     REAL authorized create and reissue routes — the two responses that
 *     genuinely carry `claimUrl` and a bearer token — while every console sink
 *     and stdout write is captured. The token, the claim URL and the invited
 *     email must appear in the HTTP response to the authorized caller and in
 *     NONE of the captured log output.
 *
 *  2. LANDING-GATED (auto-activates when server/lib/apiRequestLog.ts exists):
 *     mounts the extracted metadata-only middleware over a route that returns
 *     nested secrets and carries a token in a path param under a parameterised
 *     mount, and source-scans both the helper and server/index.ts. Skipped —
 *     not failed — until the file lands, so this control can be prepared
 *     without importing a module that does not exist yet.
 *
 * Reviewer-owned and additive. No product source edited. Isolated `:memory:` DB.
 *
 * Run:
 *   NODE_ENV=test SMTP_MODE=dry_run npx vitest run \
 *     server/__tests__/preflight_slide13b_log_claimurl_positive.test.ts \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const base = "/api/partner/me/portfolio-companies";
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(REPO_ROOT, "server", "lib", "apiRequestLog.ts");
const INDEX = path.join(REPO_ROOT, "server", "index.ts");
const helperLanded = () => existsSync(HELPER);

function signAgreement(partnerId: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts (id, kind, legal_name, status, verification, created_at, updated_at,
         created_by, updated_by, version, prev_revision_hash, revision_hash,
         partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, ?, 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?)
       ON CONFLICT(id) DO UPDATE SET partner_agreement_signed_at = excluded.partner_agreement_signed_at,
         partner_agreement_version = excluded.partner_agreement_version`,
    )
    .run(partnerId, `${partnerId} legal`, "active", now, now, "0".repeat(64), "0".repeat(64), now);
}

/** Capture every sink the structured logger and express dev log can reach. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ value: T; output: string }> {
  const chunks: string[] = [];
  const sinks = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const originals = new Map<string, any>();
  for (const s of sinks) {
    originals.set(s, (console as any)[s]);
    (console as any)[s] = (...args: unknown[]) => {
      chunks.push(args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" "));
    };
  }
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  (process.stdout as any).write = (c: any, ...rest: any[]) => { chunks.push(String(c)); return true; };
  (process.stderr as any).write = (c: any, ...rest: any[]) => { chunks.push(String(c)); return true; };
  try {
    const value = await fn();
    return { value, output: chunks.join("\n") };
  } finally {
    for (const s of sinks) (console as any)[s] = originals.get(s);
    (process.stdout as any).write = outWrite;
    (process.stderr as any).write = errWrite;
  }
}
function safeJson(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}
/** The bearer material inside a claim URL, however it is carried. */
function tokenOf(claimUrl: string): string {
  const u = new URL(claimUrl);
  const q = u.searchParams.get("token") ?? u.searchParams.get("t");
  if (q) return q;
  const last = u.pathname.split("/").filter(Boolean).pop();
  return String(last ?? "");
}

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(rawDb().name).toBe(":memory:");
  seedTestPartnerSandbox({ force: true });
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending', token_hash TEXT NOT NULL, expires_at TEXT,
    created_at TEXT NOT NULL, accepted_at TEXT, sent_at TEXT, deleted_at TEXT);`);
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT,
    role TEXT NOT NULL DEFAULT 'member', created_at TEXT, removed_at TEXT,
    UNIQUE (company_id, user_id));`);
  signAgreement(PARTNER_A);
  registerPartnerPortfolioCompanyRoutes(app);
  registerPartnerRoutes(app);
});

beforeEach(() => {
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
});

describe("LOG-1 · real create/reissue responses carry the secret, logs do not", () => {
  it("creation: claimUrl + token reach the authorized caller and appear in no captured log output", async () => {
    const email = `log.control.${Date.now()}@example.com`;
    const { value: res, output } = await captureLogs(() =>
      request(app).post(base).set("x-user-id", ACTOR_A)
        .send({ companyName: "Log Control Co", founderEmail: email, founderName: "Log Founder", ...authority } as never),
    );
    expect(res.status).toBe(201);
    const claimUrl = String(res.body.founderInvite?.claimUrl ?? "");
    // Positive half: the secret really is in this response, so its absence
    // below is evidence and not a vacuous assertion.
    expect(claimUrl).toMatch(/^https:\/\/app\.example\.test\//);
    const token = tokenOf(claimUrl);
    expect(token.length).toBeGreaterThanOrEqual(16);

    expect(output).not.toContain(claimUrl);
    expect(output).not.toContain(token);
    expect(output).not.toContain(email);
    expect(output.toLowerCase()).not.toContain("claimurl");
  });

  it("reissue: neither the rotated token nor the revoked one is logged, and the new one reaches the caller", async () => {
    const first = `log.reissue.a.${Date.now()}@example.com`;
    const second = `log.reissue.b.${Date.now()}@example.com`;
    const created = await request(app).post(base).set("x-user-id", ACTOR_A)
      .send({ companyName: "Log Reissue Co", founderEmail: first, founderName: "First", ...authority } as never);
    expect(created.status).toBe(201);
    const companyId = String(created.body.companyId);
    const oldClaim = String(created.body.founderInvite?.claimUrl ?? "");
    const oldToken = tokenOf(oldClaim);

    const { value: res, output } = await captureLogs(() =>
      request(app).post(`${base}/${companyId}/founder-invitation/reissue`).set("x-user-id", ACTOR_A)
        .send({ expectedInvitationId: String(created.body.founderInvite.id), founderEmail: second,
                founderName: "Second", ...authority } as never),
    );
    expect(res.status).toBe(201);
    const newClaim = String(res.body.founderInvite?.claimUrl ?? res.body.invitation?.claimUrl ?? "");
    expect(newClaim).toMatch(/^https:\/\/app\.example\.test\//);
    const newToken = tokenOf(newClaim);
    expect(newToken).not.toBe(oldToken);

    for (const secret of [newClaim, newToken, oldClaim, oldToken, second, first]) {
      expect(output, `logged secret: ${secret.slice(0, 12)}…`).not.toContain(secret);
    }
  });

  it("the status read (which returns invited identity to an authorized partner) logs no identity", async () => {
    const email = `log.status.${Date.now()}@example.com`;
    const created = await request(app).post(base).set("x-user-id", ACTOR_A)
      .send({ companyName: "Log Status Co", founderEmail: email, founderName: "Status", ...authority } as never);
    expect(created.status).toBe(201);
    const companyId = String(created.body.companyId);
    const { value: res, output } = await captureLogs(() =>
      request(app).get(`${base}/${companyId}/founder-invitation`).set("x-user-id", ACTOR_A),
    );
    expect(res.status).toBe(200);
    expect(res.body.invitation.email).toBe(email);
    expect(output).not.toContain(email);
    expect(output).not.toContain(companyId + "/founder-invitation?token=");
  });
});

describe("LOG-2 · extracted middleware contract (activates when the helper lands)", () => {
  it.skipIf(!helperLanded())("metadata-only: route-local pattern logged, nested secrets and param token absent", async () => {
    const mod: any = await import(/* @vite-ignore */ "../lib/apiRequestLog");
    // The landed helper is a factory: apiRequestLog(emit) -> RequestHandler.
    const emitted: string[] = [];
    const middleware = mod.apiRequestLog((m: string) => emitted.push(m));
    expect(typeof middleware).toBe("function");

    const probe = express();
    probe.use(express.json());
    probe.use(middleware);
    const inner = express.Router();
    inner.get("/thing/:thingId", (_req, res) => {
      res.json({ ok: true, nested: { claimUrl: "https://app.example.test/claim?token=SECRET_BODY_TOKEN",
        token: "SECRET_BODY_TOKEN", password: "SECRET_PASS", email: "leak@example.com",
        deep: [{ secret: "SECRET_ARRAY" }] } });
    });
    // Parameterised MOUNT: the secret sits in the prefix the accepted policy
    // deliberately never reads.
    probe.use("/api/tenants/:tenantSecret", inner);

    const { value: res, output } = await captureLogs(() =>
      request(probe).get("/api/tenants/SECRET_MOUNT_TOKEN/thing/SECRET_PARAM_TOKEN?token=SECRET_QUERY_TOKEN"),
    );
    // Response unchanged for the caller.
    expect(res.status).toBe(200);
    expect(res.body.nested.token).toBe("SECRET_BODY_TOKEN");

    const all = [output, emitted.join("\n")].join("\n");
    for (const secret of ["SECRET_BODY_TOKEN", "SECRET_PASS", "leak@example.com", "SECRET_ARRAY",
                          "SECRET_MOUNT_TOKEN", "SECRET_PARAM_TOKEN", "SECRET_QUERY_TOKEN"]) {
      expect(all, `logged: ${secret}`).not.toContain(secret);
    }
    // Inner route-local pattern present; method, status and a duration remain.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain("/thing/:thingId");
    expect(emitted[0]).toContain("GET");
    expect(emitted[0]).toContain("200");
    expect(emitted[0]).toMatch(/\d+ms/);
    // eslint-disable-next-line no-console
    console.log(`[LOG-2] emitted=${JSON.stringify(emitted[0])}`);
  });

  it.skipIf(!helperLanded())("unmatched /api path logs a constant label, never the URL or its query", async () => {
    const mod: any = await import(/* @vite-ignore */ "../lib/apiRequestLog");
    const emitted: string[] = [];
    const probe = express();
    probe.use(mod.apiRequestLog((m: string) => emitted.push(m)));
    const { output } = await captureLogs(() =>
      request(probe).get("/api/does/not/exist/SECRET_UNMATCHED?token=SECRET_UNMATCHED_QUERY"),
    );
    const all = [output, emitted.join("\n")].join("\n");
    expect(all).not.toContain("SECRET_UNMATCHED");
    expect(all).not.toContain("SECRET_UNMATCHED_QUERY");
    expect(all).not.toContain("/api/does/not/exist");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain(mod.API_LOG_ROUTE_FALLBACK);
    // A non-API path must stay excluded entirely.
    const probe2 = express();
    const other: string[] = [];
    probe2.use(mod.apiRequestLog((m: string) => other.push(m)));
    await captureLogs(() => request(probe2).get("/healthz"));
    expect(other).toHaveLength(0);
    // eslint-disable-next-line no-console
    console.log(`[LOG-2 unmatched] emitted=${JSON.stringify(emitted[0])}`);
  });

  it.skipIf(!helperLanded())("source policy: the helper never reads request state it must not read", () => {
    const src = readFileSync(HELPER, "utf8");
    for (const forbidden of ["baseUrl", "originalUrl", "req.params", "req.query", "req.headers",
                             "req.cookies", "req.body", "res.json ="]) {
      expect(src, `helper references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.skipIf(!helperLanded())("source wiring: index.ts mounts the helper and retains no body capture", () => {
    const src = readFileSync(INDEX, "utf8");
    expect(src).toContain("apiRequestLog");
    expect(src).not.toContain("capturedJsonResponse");
    expect(src).not.toMatch(/res\.json\s*=\s*function/);
    expect(src).not.toMatch(/JSON\.stringify\(captured/);
    // The exported log() used by boot/vite logging must survive the extraction.
    expect(src).toMatch(/export function log\(/);
  });
});
