#!/usr/bin/env node
/**
 * scripts/smoke_consortium_apply.ts — v23.4.1 hotfix Task H
 *
 * End-to-end smoke test for the Consortium Partner self-service onboarding flow.
 * Logs all results to /home/user/workspace/wave_h_audit/HOTFIX_SMOKE_TEST.log
 *
 * Prerequisites:
 *   - Server running at http://localhost:5000 (or SMOKE_BASE_URL)
 *   - SMTP_MODE=console (server logs email instead of sending)
 *   - CONSORTIUM_AUTO_APPROVE=1 (default)
 *   - NODE_ENV=development (so inviteLink is returned in API response)
 *
 * Test sequence:
 *   1. POST /api/public/consortium/apply  → expect 201 + applicationId + inviteLink
 *   2. GET  /api/public/consortium/apply/:id/status → expect status='approved'
 *   3. POST /api/auth/secure/redeem  { token, password } → expect 200 + id + role
 *   4. GET  /api/auth/secure/me (with cookie from step 3) → expect valid user
 *
 * Exit code 0 on all passes, 1 on any failure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://localhost:5000";
const LOG_PATH = "/home/user/workspace/wave_h_audit/HOTFIX_SMOKE_TEST.log";
const LOG_DIR = path.dirname(LOG_PATH);

/* ------------------------------------------------------------------ */
/* Logging                                                              */
/* ------------------------------------------------------------------ */
const lines: string[] = [];

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `${ts}  ${msg}`;
  console.log(line);
  lines.push(line);
}

function writeLog() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(LOG_PATH, lines.join("\n") + "\n", "utf8");
    console.log(`\nLog written to ${LOG_PATH}`);
  } catch (e) {
    console.error("Failed to write log:", (e as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                         */
/* ------------------------------------------------------------------ */
interface FetchResult {
  status: number;
  body: unknown;
  cookies: string[];
}

function fetchSync(
  url: string,
  opts: {
    method?: string;
    body?: unknown;
    cookies?: string[];
    timeoutMs?: number;
  } = {},
): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const bodyStr = opts.body != null ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (bodyStr) headers["Content-Length"] = String(Buffer.byteLength(bodyStr));
    if (opts.cookies && opts.cookies.length > 0) {
      headers["Cookie"] = opts.cookies.join("; ");
    }

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
        path: parsed.pathname + parsed.search,
        method: opts.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
          const setCookie = res.headers["set-cookie"] ?? [];
          resolve({ status: res.statusCode ?? 0, body: parsed, cookies: setCookie });
        });
      },
    );
    req.on("error", reject);
    if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Assertions                                                           */
/* ------------------------------------------------------------------ */
let passCount = 0;
let failCount = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    log(`  PASS  ${label}`);
    passCount++;
  } else {
    log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failCount++;
  }
}

/* ------------------------------------------------------------------ */
/* Main smoke test                                                      */
/* ------------------------------------------------------------------ */
async function run() {
  log("=== Capavate v23.4.1 Consortium Onboarding Smoke Test ===");
  log(`BASE_URL: ${BASE_URL}`);
  log(`Time: ${new Date().toISOString()}`);
  log("");

  // ---- Step 0: Server health check ----
  log("--- Step 0: Server reachability ---");
  let serverReachable = false;
  try {
    const r = await fetchSync(`${BASE_URL}/api/auth/me`, { timeoutMs: 5000 });
    // 401 is fine — means server is up but not authed
    serverReachable = r.status > 0;
    log(`  GET /api/auth/me → HTTP ${r.status} (server reachable: ${serverReachable})`);
  } catch (e) {
    log(`  ERROR: Server not reachable at ${BASE_URL}: ${(e as Error).message}`);
    log(`  SKIP: Cannot run smoke test — server is not running.`);
    log(`  To run: SMTP_MODE=console CONSORTIUM_AUTO_APPROVE=1 npm run dev`);
    log(`  Then re-run: npx tsx scripts/smoke_consortium_apply.ts`);
    failCount++;
    writeLog();
    process.exit(1);
  }

  // ---- Step 1: Submit consortium application ----
  log("");
  log("--- Step 1: POST /api/public/consortium/apply ---");
  const testEmail = `smoke_test_${Date.now()}@example.com`;
  const applyBody = {
    organizationName: "Smoke Test Capital",
    contactName: "Smoke Tester",
    contactEmail: testEmail,
    partnerType: "vc",
    aumRange: "10-50M",
    portfolioCompanyCount: 5,
    expectedChapter: "smoke_chapter",
    introMessage: "Automated smoke test — safe to delete",
    jurisdiction: "CA",
  };

  let applicationId: string | null = null;
  let inviteToken: string | null = null;

  try {
    const r = await fetchSync(`${BASE_URL}/api/public/consortium/apply`, {
      method: "POST",
      body: applyBody,
    });
    log(`  HTTP ${r.status} → ${JSON.stringify(r.body)}`);
    const body = r.body as Record<string, unknown>;
    assert("Status 201", r.status === 201, `got ${r.status}`);
    assert("applicationId present", typeof body.applicationId === "string");
    assert("status is approved (CONSORTIUM_AUTO_APPROVE=1)", body.status === "approved");

    applicationId = body.applicationId as string | null;

    // inviteLink only present in NODE_ENV !== 'production'
    if (body.inviteLink) {
      const url = new URL(body.inviteLink as string);
      inviteToken = url.searchParams.get("token");
      assert("inviteLink present (non-production env)", !!body.inviteLink);
      assert("inviteLink contains /set-password", (body.inviteLink as string).includes("/set-password"));
      assert("inviteLink contains ?token=", !!inviteToken);
      log(`  inviteToken: ${inviteToken?.slice(0, 12)}…`);
    } else {
      log(`  WARN: inviteLink absent from response — is NODE_ENV=production?`);
      log(`  WARN: Cannot test /api/auth/secure/redeem without the raw token.`);
    }
  } catch (e) {
    log(`  ERROR: ${(e as Error).message}`);
    failCount++;
  }

  // ---- Step 2: Check application status ----
  log("");
  log("--- Step 2: GET /api/public/consortium/apply/:id/status ---");
  if (applicationId) {
    try {
      const r = await fetchSync(`${BASE_URL}/api/public/consortium/apply/${applicationId}/status`);
      log(`  HTTP ${r.status} → ${JSON.stringify(r.body)}`);
      assert("Status 200", r.status === 200, `got ${r.status}`);
      const body = r.body as Record<string, unknown>;
      assert("status=approved", body.status === "approved", `got ${JSON.stringify(body.status)}`);
    } catch (e) {
      log(`  ERROR: ${(e as Error).message}`);
      failCount++;
    }
  } else {
    log("  SKIP: no applicationId from Step 1");
    failCount++;
  }

  // ---- Step 3: Redeem token ----
  log("");
  log("--- Step 3: POST /api/auth/secure/redeem ---");
  let sessionCookies: string[] = [];

  if (inviteToken) {
    const testPassword = `SmokeTest${Date.now()}!Aa`;
    try {
      const r = await fetchSync(`${BASE_URL}/api/auth/secure/redeem`, {
        method: "POST",
        body: { token: inviteToken, password: testPassword },
      });
      log(`  HTTP ${r.status} → ${JSON.stringify(r.body)}`);
      assert("Status 200", r.status === 200, `got ${r.status}`);
      const body = r.body as Record<string, unknown>;
      assert("id present", typeof body.id === "string");
      assert("email matches", body.email === testEmail.toLowerCase(), `got ${body.email}`);
      assert("role present", typeof body.role === "string");

      // Collect session cookies for step 4
      sessionCookies = r.cookies ?? [];
      assert("Session cookies set", sessionCookies.length > 0);
    } catch (e) {
      log(`  ERROR: ${(e as Error).message}`);
      failCount++;
    }
  } else {
    log("  SKIP: no inviteToken from Step 1 (check NODE_ENV)");
    failCount++;
  }

  // ---- Step 4: Verify session with /api/auth/secure/me ----
  log("");
  log("--- Step 4: GET /api/auth/secure/me ---");
  if (sessionCookies.length > 0) {
    try {
      const r = await fetchSync(`${BASE_URL}/api/auth/secure/me`, {
        cookies: sessionCookies.map((c) => c.split(";")[0]!),
      });
      log(`  HTTP ${r.status} → ${JSON.stringify(r.body)}`);
      assert("Status 200", r.status === 200, `got ${r.status}`);
      const body = r.body as Record<string, unknown>;
      assert("id present", typeof body.id === "string");
      assert("email matches", body.email === testEmail.toLowerCase(), `got ${body.email}`);
    } catch (e) {
      log(`  ERROR: ${(e as Error).message}`);
      failCount++;
    }
  } else {
    log("  SKIP: no session cookies from Step 3");
  }

  // ---- Summary ----
  log("");
  log("=== SMOKE TEST SUMMARY ===");
  log(`  PASS: ${passCount}`);
  log(`  FAIL: ${failCount}`);
  log(`  TOTAL: ${passCount + failCount}`);
  log(`  RESULT: ${failCount === 0 ? "ALL PASSED" : "FAILURES DETECTED"}`);

  writeLog();
  process.exit(failCount > 0 ? 1 : 0);
}

run().catch((e) => {
  log(`FATAL: ${(e as Error).message}`);
  writeLog();
  process.exit(1);
});
