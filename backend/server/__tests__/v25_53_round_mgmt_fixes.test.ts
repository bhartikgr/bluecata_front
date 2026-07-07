/**
 * v25.53 Round-management fix wave — server-side integration tests.
 *
 * Covers the server-observable half of the round-management bug brief:
 *   N1  — Warrant + Option Pool Top-Up rounds are now creatable (were blocked
 *         by a blanket targetAmount>0 requirement with no field to satisfy it),
 *         while the other five vehicles still create and preferred still
 *         requires a user-entered target.
 *   3a  — creation rejects past Open / Target-close dates, AND the CRM-invite
 *         route refuses a round whose Open + Close are both in the past.
 *   N4  — a malformed (non-4-digit) year is rejected on creation.
 *   6a  — the same email cannot hold two ACTIVE invitations to one round
 *         (409 duplicate_invitation); re-invite is allowed after a revoke.
 *   8a  — optional investor Company / Stage-focus / Typical-market-size are
 *         accepted on invite and persisted onto the founder CRM contact.
 *   N6  — a re-invited, ALREADY-REGISTERED user is NOT forced through
 *         registration again: the redeem flow returns a login+view-round route
 *         WITHOUT requiring or setting a password; a brand-new invitee still
 *         goes through the password-set path.
 *
 * The client-only fixes (Step-2 required-field validation 1a/N2/N3, thousands
 * separators 5a, edit-terms close-date 4a, invite First/Last mandatory 7a) are
 * exercised by the React component tests; this file locks the server contracts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { _testAccessRounds } from "../roundsStore";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";

let app: Express;
let server: http.Server;
let port: number;
let userId: string;
let companyId: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // Inline cookie parser so extractUserIdFromCookie() (used by the N6/REVISE B2
  // existing-account redeem branch) can resolve a signed session cookie in the
  // test harness — readSessionCookie() reads req.cookies, which raw http.request
  // does not populate.
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
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });

  ({ userId } = registerFounderUser({
    email: `rm_${Date.now()}@test.example`,
    name: "Round Mgmt Founder",
    password: "testpassword123",
  }));
  companyId = `co_rm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: "RM Corp",
    legalName: "RM Corp, Inc.",
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
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; cookie?: string } = {},
): Promise<{ status: number; body: any }> {
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
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// A comfortably-future ISO date (yyyy-mm-dd) offset by N days from today.
function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function pastDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// Extract the raw one-time token from a create-invitation redeemUrl
// (`.../invite/<token>`), the only place it is ever surfaced.
function tokenFromRedeemUrl(url: string): string {
  const m = /\/invite\/([^/?#]+)/.exec(url ?? "");
  return m ? decodeURIComponent(m[1]) : "";
}

describe("v25.53 N1 — all seven investment vehicles are creatable", () => {
  it("warrant round creates with strike + shares (targetAmount derived = strike × shares)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Warrant Round",
        type: "seed",
        instrument: "warrant",
        strikePrice: 2.5,
        sharesAuthorized: 400_000,
        expiryYears: 5,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.id).toBeTruthy();
    // 2.5 × 400,000 = 1,000,000 (exact decimal, no float drift).
    expect(Number(res.body?.targetAmount)).toBe(1_000_000);
  });

  it("option-pool round creates with poolSize and NO target amount", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "ESOP Top-Up",
        type: "seed",
        instrument: "option_pool",
        poolSize: 500_000,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.id).toBeTruthy();
  });

  it("warrant still fails closed when strike price is missing", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Bad Warrant", type: "seed", instrument: "warrant", sharesAuthorized: 100_000 },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.strikePrice).toBeTruthy();
  });

  it("option pool still fails closed when poolSize is missing", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Bad Pool", type: "seed", instrument: "option_pool" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.poolSize).toBeTruthy();
  });

  it("the other five vehicles still create (common, preferred, safe_post, safe_pre, convertible_note)", async () => {
    const common = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Common", type: "foundation", instrument: "common", pricePerShare: 1, sharesAuthorized: 100_000, preMoney: null, targetAmount: null },
    });
    expect(common.status).toBe(200);

    const preferred = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Series A", type: "series_a", instrument: "preferred", preMoney: 8_000_000, targetAmount: 2_000_000, pricePerShare: 1.5, sharesAuthorized: 1_333_333 },
    });
    expect(preferred.status).toBe(200);

    const safePost = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "SAFE (post)", type: "preseed", instrument: "safe_post", targetAmount: 750_000, valuationCap: 10_000_000, discount: 20 },
    });
    expect(safePost.status).toBe(200);

    const safePre = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "SAFE (pre)", type: "preseed", instrument: "safe_pre", targetAmount: 500_000, valuationCap: 8_000_000, discount: 15 },
    });
    expect(safePre.status).toBe(200);

    const note = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Convertible Note", type: "preseed", instrument: "convertible_note", targetAmount: 600_000, valuationCap: 9_000_000, discount: 10, interestRate: 5, maturityMonths: 24 },
    });
    expect(note.status).toBe(200);
  });

  it("preferred still REQUIRES a user-entered target (unchanged contract)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Preferred No Target", type: "series_a", instrument: "preferred", preMoney: 4_000_000, pricePerShare: 1.25, sharesAuthorized: 3_200_000, targetAmount: null },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.targetAmount).toBeTruthy();
  });
});

describe("v25.53 3a / N4 — date guards on creation", () => {
  it("rejects a past open date", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Past Open", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, openDate: pastDate(10), closeDate: futureDate(30) },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_openDate");
  });

  it("rejects a past target-close date", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Past Close", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, openDate: futureDate(1), closeDate: pastDate(1) },
    });
    expect(res.status).toBe(400);
    // close < open is checked first; here open is future and close is past, so
    // close<open triggers → invalid_closeDate. Either typed 400 is acceptable.
    expect(["invalid_closeDate", "invalid_openDate"]).toContain(res.body?.error);
  });

  it("N4 — rejects a malformed (non-4-digit) year", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      // Only openDate supplied so the malformed-year guard fires in isolation
      // (a valid closeDate would trip the close-before-open check first, since
      // the malformed "70620" parses as a far-future year).
      body: { companyId, name: "Bad Year", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, openDate: "70620-06-07" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_openDate");
  });

  it("accepts valid future dates", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Good Dates", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, openDate: futureDate(1), closeDate: futureDate(60) },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});

describe("v25.53 3a — CRM-invite gate on past rounds", () => {
  let roundId: string;

  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Gate Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, openDate: futureDate(1), closeDate: futureDate(60) },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("allows an invite while the round's dates are current", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId,
      body: { investorEmail: `current_${Date.now()}@example.com`, investorFirstName: "Cur", investorLastName: "Rent" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it("refuses an invite once Open AND Close are both in the past (409 round_dates_past)", async () => {
    // Backdate the live round object so both dates are in the past — the only
    // way to reach this state (creation now blocks past-dated rounds outright).
    const row = _testAccessRounds.byId.get(roundId) as any;
    expect(row).toBeTruthy();
    row.openDate = pastDate(30);
    row.closeDate = pastDate(5);

    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId,
      body: { investorEmail: `stale_${Date.now()}@example.com`, investorFirstName: "St", investorLastName: "Ale" },
    });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe("round_dates_past");

    // Restore so later tests using this round aren't affected.
    row.openDate = futureDate(1);
    row.closeDate = futureDate(60);
  });
});

describe("v25.53 6a — no duplicate active invite per (round, email)", () => {
  let roundId: string;
  const email = `dupe_${Date.now()}@example.com`;

  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Dupe Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("first invite succeeds; identical email (case/space-insensitive) is rejected 409", async () => {
    const first = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: email, investorFirstName: "Du", investorLastName: "Plicate" },
    });
    expect(first.status).toBe(200);

    const second = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `  ${email.toUpperCase()}  `, investorFirstName: "Du", investorLastName: "Plicate" },
    });
    expect(second.status).toBe(409);
    expect(second.body?.error).toBe("duplicate_invitation");
  });

  it("re-invite is allowed after the active invite is revoked", async () => {
    // Find the active invitation id via the founder list endpoint.
    const list = await call("GET", `/api/rounds/${roundId}/invitations`, { userId });
    expect(list.status).toBe(200);
    const invitations: any[] = Array.isArray(list.body) ? list.body : (list.body?.invitations ?? []);
    const active = invitations.find((i) => (i.investorEmail ?? "").toLowerCase() === email.toLowerCase());
    expect(active?.id).toBeTruthy();

    const del = await call("DELETE", `/api/rounds/${roundId}/invitations/${active.id}`, { userId });
    expect(del.status).toBe(200);

    const reinvite = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: email, investorFirstName: "Du", investorLastName: "Plicate" },
    });
    expect(reinvite.status).toBe(200);
    expect(reinvite.body?.ok).toBe(true);
  });
});

describe("v25.53 8a — optional investor fields persist to the CRM", () => {
  let roundId: string;
  const email = `crmopt_${Date.now()}@example.com`;

  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "CRM Opt Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
  });

  it("invite with company/stageFocus/typicalMarketSize → contact carries firmName", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId,
      body: {
        investorEmail: email,
        investorFirstName: "Opt",
        investorLastName: "Fields",
        investorCompany: "Horizon Ventures",
        stageFocus: "Seed / Series A",
        typicalMarketSize: "$1B+ TAM",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const crm = await call("GET", "/api/founder/investor-crm", { userId });
    expect(crm.status).toBe(200);
    const found = (crm.body as any[]).find((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
    expect(found).toBeTruthy();
    expect(found.firmName).toBe("Horizon Ventures");
  });
});

describe("v25.53 N6 — re-invited existing user is not forced to re-register", () => {
  let roundId: string;

  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "N6 Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("preview flags an existing account (demo persona email)", async () => {
    // maya@novapay.ai is a seeded demo persona (ENABLE_DEMO_SEED=1 in tests).
    const inv = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: "maya@novapay.ai", investorFirstName: "Maya", investorLastName: "Chen" },
    });
    expect(inv.status).toBe(200);
    const token = tokenFromRedeemUrl(inv.body?.redeemUrl);
    expect(token).toBeTruthy();

    const preview = await call("GET", `/api/auth/redeem/preview?token=${encodeURIComponent(token)}`);
    expect(preview.status).toBe(200);
    expect(preview.body?.existingAccount).toBe(true);
  });

  it("existing user redeems WITHOUT a password → login+view-round route, no re-registration", async () => {
    // Fresh round + invite (single-use token) for the redeem itself.
    const r2 = await call("POST", "/api/rounds", {
      userId, body: { companyId, name: "N6 Round 2", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    const inv = await call("POST", `/api/rounds/${r2.body?.id}/invitations`, {
      userId, body: { investorEmail: "aisha@greenwood.capital", investorFirstName: "Aisha", investorLastName: "Patel" },
    });
    const token = tokenFromRedeemUrl(inv.body?.redeemUrl);
    expect(token).toBeTruthy();

    // NOTE: no password, no agreedToTerms — the existing-account branch must
    // succeed anyway (the core N6 guarantee: no forced password reset).
    const redeem = await call("POST", "/api/auth/redeem", { body: { token } });
    expect(redeem.status).toBe(200);
    expect(redeem.body?.ok).toBe(true);
    expect(redeem.body?.existingAccount).toBe(true);
    expect(String(redeem.body?.redirectTo ?? "")).toContain("/login");
  });

  it("brand-new invitee still goes through the password-set path", async () => {
    const r3 = await call("POST", "/api/rounds", {
      userId, body: { companyId, name: "N6 Round 3", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    const newEmail = `n6new_${Date.now()}@example.com`;
    const inv = await call("POST", `/api/rounds/${r3.body?.id}/invitations`, {
      userId, body: { investorEmail: newEmail, investorFirstName: "New", investorLastName: "Comer" },
    });
    const token = tokenFromRedeemUrl(inv.body?.redeemUrl);
    expect(token).toBeTruthy();

    // Preview should NOT flag an existing account.
    const preview = await call("GET", `/api/auth/redeem/preview?token=${encodeURIComponent(token)}`);
    expect(preview.body?.existingAccount).toBe(false);

    // Redeeming with no password must be rejected (WEAK_PASSWORD) for a new user.
    const noPw = await call("POST", "/api/auth/redeem", { body: { token } });
    expect(noPw.status).toBe(400);
    expect(noPw.body?.error).toBe("WEAK_PASSWORD");

    // With a password + terms it succeeds and lands on the investor round page.
    const ok = await call("POST", "/api/auth/redeem", { body: { token, password: "brandnewpass123", agreedToTerms: true } });
    expect(ok.status).toBe(200);
    expect(ok.body?.ok).toBe(true);
    expect(ok.body?.existingAccount).toBeFalsy();
    expect(String(ok.body?.redirectTo ?? "")).toContain("/investor/");
  });
});

// ===========================================================================
// REVISE round 2 — GPT-5.5 blocker behavior tests (not source-string).
// ===========================================================================

describe("v25.53 REVISE B5 (7a) — First/Last mandatory at the API boundary", () => {
  let roundId: string;
  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "B5 Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("rejects a missing first name with a typed 400 (missing_first_name)", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `b5a_${Date.now()}@example.com`, investorLastName: "Only" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("missing_first_name");
  });

  it("rejects a missing last name with a typed 400 (missing_last_name)", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `b5b_${Date.now()}@example.com`, investorFirstName: "First" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("missing_last_name");
  });

  it("rejects a blank/whitespace-only first name (not merely absent)", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `b5c_${Date.now()}@example.com`, investorFirstName: "   ", investorLastName: "Real" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("missing_first_name");
  });

  it("derives split fields from a legacy investorName with >=2 tokens", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `b5d_${Date.now()}@example.com`, investorName: "Ada Lovelace" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.invitation?.investorFirstName).toBe("Ada");
    expect(res.body?.invitation?.investorLastName).toBe("Lovelace");
  });

  it("a single-token investorName is NOT enough (no split derivable → typed 400)", async () => {
    const res = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: `b5e_${Date.now()}@example.com`, investorName: "Cher" },
    });
    expect(res.status).toBe(400);
    // A lone token can't populate both halves; the first-name check fires first.
    expect(res.body?.error).toBe("missing_first_name");
  });
});

describe("v25.53 REVISE NB-b — server-side priced (preferred) completeness", () => {
  it("preferred with a target but pricePerShare<=0 is rejected (fail-closed)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Pref No PPS", type: "series_a", instrument: "preferred", targetAmount: 2_000_000, preMoney: 8_000_000, pricePerShare: 0, sharesAuthorized: 1_000_000 },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.pricePerShare).toBeTruthy();
  });

  it("preferred with a target but sharesAuthorized<=0 is rejected (fail-closed)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Pref No Shares", type: "series_a", instrument: "preferred", targetAmount: 2_000_000, preMoney: 8_000_000, pricePerShare: 1.5, sharesAuthorized: 0 },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.sharesAuthorized).toBeTruthy();
  });

  it("preferred with a target AND pps>0 AND shares>0 still creates", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Pref Complete", type: "series_a", instrument: "preferred", targetAmount: 2_000_000, preMoney: 8_000_000, pricePerShare: 1.5, sharesAuthorized: 1_333_333 },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});

describe("v25.53 REVISE B4 — warrant/common target is EXACT Decimal (no float drift)", () => {
  it("warrant strike 0.1 × 3 shares yields exactly 0.3 (not 0.30000000000000004)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Warrant Exact", type: "seed", instrument: "warrant", strikePrice: 0.1, sharesAuthorized: 3, expiryYears: 5 },
    });
    expect(res.status).toBe(200);
    // The authoritative exact value round-trips through extras_json as a string.
    expect(res.body?.targetAmountExact).toBe("0.3");
    // And the numeric projection is the clean 0.3, NOT the JS float 0.1*3 drift.
    expect(res.body?.targetAmount).toBe(0.3);
    expect(res.body?.targetAmount).not.toBe(0.1 * 3);
  });

  it("common pps 0.07 × 1,000,001 shares is exact (string, no drift)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: { companyId, name: "Common Exact", type: "foundation", instrument: "common", pricePerShare: 0.07, sharesAuthorized: 1_000_001 },
    });
    expect(res.status).toBe(200);
    // 0.07 × 1,000,001 = 70000.07 exactly under Decimal.
    expect(res.body?.targetAmountExact).toBe("70000.07");
  });
});

describe("v25.53 REVISE B2 — N6 existing-account token consumed + associated", () => {
  let roundId: string;
  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId, body: { companyId, name: "B2 Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("UNAUTHENTICATED existing-account redeem does NOT consume — returns requiresLogin + returnTo(continue=1)", async () => {
    const inv = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: "maya@novapay.ai", investorFirstName: "Maya", investorLastName: "Chen" },
    });
    const token = tokenFromRedeemUrl(inv.body?.redeemUrl);
    expect(token).toBeTruthy();

    const redeem = await call("POST", "/api/auth/redeem", { body: { token } });
    expect(redeem.status).toBe(200);
    expect(redeem.body?.existingAccount).toBe(true);
    expect(redeem.body?.requiresLogin).toBe(true);
    const rt = String(redeem.body?.redirectTo ?? "");
    expect(rt).toContain("/login");
    // Login honors returnTo (NOT next); it must carry the round-trip continue=1.
    expect(rt).toContain("returnTo=");
    const returnTo = decodeURIComponent(rt.split("returnTo=")[1] ?? "");
    expect(returnTo).toContain("/auth/redeem");
    expect(returnTo).toContain("continue=1");

    // The token was NOT consumed — preview still resolves (not already_redeemed).
    const preview = await call("GET", `/api/auth/redeem/preview?token=${encodeURIComponent(token)}`);
    expect(preview.status).toBe(200);
    expect(preview.body?.existingAccount).toBe(true);
  });

  it("AUTHENTICATED existing-account redeem consumes the token once and routes to the invitation-authorized surface", async () => {
    const inv = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: "aisha@greenwood.capital", investorFirstName: "Aisha", investorLastName: "Patel" },
    });
    const token = tokenFromRedeemUrl(inv.body?.redeemUrl);
    expect(token).toBeTruthy();

    const cookie = `${LEGACY_SESSION_COOKIE}=${signSessionValue("u_b2_investor")}`;
    const redeem = await call("POST", "/api/auth/redeem", { body: { token, continue: true }, cookie });
    expect(redeem.status).toBe(200);
    expect(redeem.body?.ok).toBe(true);
    expect(redeem.body?.existingAccount).toBe(true);
    expect(redeem.body?.requiresLogin).toBeFalsy();
    expect(redeem.body?.invitationId).toBeTruthy();
    // REVISE B2 — invitation-authorized surface, NOT the entitlement-gated
    // /investor/companies/:id.
    expect(String(redeem.body?.redirectTo ?? "")).toBe(`/investor/invitations/${redeem.body?.invitationId}`);

    // Single-use: a second authenticated redeem of the SAME token loses the race
    // and surfaces already_redeemed (409), not not_found.
    const again = await call("POST", "/api/auth/redeem", { body: { token, continue: true }, cookie });
    expect(again.status).toBe(409);
    expect(again.body?.error).toBe("already_redeemed");
  });
});

describe("v25.53 REVISE NB-a (8a) — optional fields update an EXISTING CRM contact in place", () => {
  let roundId: string;
  const email = `crmupdate_${Date.now()}@example.com`;

  beforeAll(async () => {
    const res = await call("POST", "/api/rounds", {
      userId, body: { companyId, name: "CRM Update Round", type: "seed", instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000 },
    });
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  it("re-invite of an existing contact fills in company/stage/market that were blank the first time", async () => {
    // First invite: no optional fields → contact created without a firmName.
    const first = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId, body: { investorEmail: email, investorFirstName: "Reid", investorLastName: "Hoffman" },
    });
    expect(first.status).toBe(200);

    const crm1 = await call("GET", "/api/founder/investor-crm", { userId });
    const before = (crm1.body as any[]).find((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
    expect(before).toBeTruthy();
    // First invite carried no company → firmName is still the empty placeholder.
    expect(before.firmName).not.toBe("Greylock");

    // Revoke the active invite so the re-invite is allowed (duplicate guard).
    const list = await call("GET", `/api/rounds/${roundId}/invitations`, { userId });
    const invitations: any[] = Array.isArray(list.body) ? list.body : (list.body?.invitations ?? []);
    const active = invitations.find((i) => (i.investorEmail ?? "").toLowerCase() === email.toLowerCase());
    expect(active?.id).toBeTruthy();
    const del = await call("DELETE", `/api/rounds/${roundId}/invitations/${active.id}`, { userId });
    expect(del.status).toBe(200);

    // Re-invite WITH optional fields → the existing contact is updated in place.
    const second = await call("POST", `/api/rounds/${roundId}/invitations`, {
      userId,
      body: {
        investorEmail: email, investorFirstName: "Reid", investorLastName: "Hoffman",
        investorCompany: "Greylock",
        stageFocus: "Series A / B",
        typicalMarketSize: "$5B+ TAM",
      },
    });
    expect(second.status).toBe(200);

    const crm2 = await call("GET", "/api/founder/investor-crm", { userId });
    const after = (crm2.body as any[]).find((c) => (c.email ?? "").toLowerCase() === email.toLowerCase());
    expect(after).toBeTruthy();
    expect(after.firmName).toBe("Greylock");
  });
});
