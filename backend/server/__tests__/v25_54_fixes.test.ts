/**
 * v25.54.0 release — regression tests for the four approved fixes.
 *
 *   AVI-1  (Fix A + Fix B): a durably-invited investor whose invitation is in
 *          the "accepted" state can READ and ACT on their Your-Decision surface
 *          (authorized by email-match ownership, not the restart-fragile
 *          invitedRounds set). Non-owners and revoked invites are denied.
 *   AVI-2  (G0-3): computeCarryForward resolves a company that lives ONLY in the
 *          live multiCompanyStore (co_kelvin) — no longer "Company not found".
 *   G0-1:  founder self-commit (seed-founder-shares) calls commitFunded()
 *          unchanged, is idempotent, and fail-closed on ownership.
 *   G0-2:  founder archive round refuses when cap-table entries exist, succeeds
 *          otherwise; migration 0100 (archived_at) is additive + idempotent.
 *
 * All HTTP assertions hit the REAL Express routes via registerRoutes().
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { createRound, getRoundById, hydrateRoundsStore } from "../roundsStore";
import {
  clearLedger,
  commitFunded,
  verifyChain,
  getLedger,
} from "../captableCommitStore";
import { computeCarryForward } from "../roundCarryForwardEngine";
import {
  _testAccessInvitations,
  type RoundInvitationRow,
  type InvitationState,
} from "../roundInvitationsStore";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const MAYA = "u_maya_chen";           // founder of co_novapay / co_arboreal / co_kelvin
const AISHA = "u_aisha_patel";        // investor, email aisha@greenwood.capital
const AISHA_EMAIL = "aisha@greenwood.capital";
const LAPSED = "u_lapsed_lp";         // investor, DIFFERENT email
const COMPANY = "co_novapay";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  await hydrateRoundsStore();

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
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
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

function makeModernInvite(
  overrides: Partial<RoundInvitationRow> & { id: string; roundId: string; state: InvitationState },
): RoundInvitationRow {
  const now = new Date().toISOString();
  const row: RoundInvitationRow = {
    id: overrides.id,
    tenantId: `tenant_co_${COMPANY}`,
    roundId: overrides.roundId,
    companyId: COMPANY,
    investorEmail: overrides.investorEmail ?? AISHA_EMAIL,
    investorName: "Aisha Patel",
    investorFirstName: "Aisha",
    investorLastName: "Patel",
    state: overrides.state,
    classification: "in_crm",
    tokenHash: null,
    invitedByUserId: MAYA,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
  };
  _testAccessInvitations.rows.push(row);
  return row;
}

/* ================================================================== */
/* AVI-1 — durable email-match ownership on the decision surface       */
/* ================================================================== */

describe("AVI-1 — Your-Decision ownership authorizes accepted-state modern invites", () => {
  const ROUND = "rnd_avi1";

  beforeEach(() => {
    _testAccessInvitations.reset();
  });

  it("GET decision → 200 for the invited investor whose invite is 'accepted'", async () => {
    const inv = makeModernInvite({ id: `inv_${ROUND}_acc`, roundId: ROUND, state: "accepted" });
    const res = await call("GET", `/api/rounds/${ROUND}/invitations/${inv.id}/decision`, { userId: AISHA });
    expect(res.status).toBe(200);
    expect(res.body.invitationId).toBe(inv.id);
    expect(res.body.roundId).toBe(ROUND);
  });

  it("PATCH soft_circle → 200 for the accepted-state invited investor", async () => {
    const inv = makeModernInvite({ id: `inv_${ROUND}_sc`, roundId: ROUND, state: "accepted" });
    const res = await call("PATCH", `/api/rounds/${ROUND}/invitations/${inv.id}/decision`, {
      userId: AISHA,
      body: { action: "soft_circle", amount: 100000, currency: "USD", softCircleType: "definite" },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.record.state).toBe("soft_circled");
  });

  it("GET decision → 403 NOT_ON_CAP_TABLE for a different investor (email mismatch)", async () => {
    const inv = makeModernInvite({ id: `inv_${ROUND}_other`, roundId: ROUND, state: "accepted" });
    const res = await call("GET", `/api/rounds/${ROUND}/invitations/${inv.id}/decision`, { userId: LAPSED });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("NOT_ON_CAP_TABLE");
  });

  it("GET decision → 403 for a revoked invitation even with the matching email", async () => {
    const inv = makeModernInvite({ id: `inv_${ROUND}_rev`, roundId: ROUND, state: "revoked" });
    const res = await call("GET", `/api/rounds/${ROUND}/invitations/${inv.id}/decision`, { userId: AISHA });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("NOT_ON_CAP_TABLE");
  });

  it("GET decision → 401 when unauthenticated (no dev-bypass persona)", async () => {
    const inv = makeModernInvite({ id: `inv_${ROUND}_401`, roundId: ROUND, state: "accepted" });
    // The sandbox falls back to a demo persona (u_aisha_patel) for anonymous
    // requests; disable that bypass to exercise the true fail-closed 401 path.
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const res = await call("GET", `/api/rounds/${ROUND}/invitations/${inv.id}/decision`);
      expect(res.status).toBe(401);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
  });
});

/* ================================================================== */
/* AVI-2 — carry-forward resolves live-store-only companies            */
/* ================================================================== */

describe("AVI-2 — computeCarryForward resolves multiCompanyStore-only company", () => {
  it("co_kelvin (live store only, absent from mock seed) is NOT 'Company not found'", () => {
    const result = computeCarryForward({ companyId: "co_kelvin", proposedRoundType: "safe" });
    expect(result.warnings).not.toContain("Company not found: co_kelvin");
  });

  it("a genuinely unknown company still reports 'Company not found'", () => {
    const result = computeCarryForward({ companyId: "co_does_not_exist", proposedRoundType: "safe" });
    expect(result.warnings).toContain("Company not found: co_does_not_exist");
  });
});

/* ================================================================== */
/* G0-1 — founder seed-founder-shares                                  */
/* ================================================================== */

describe("G0-1 — POST /api/founder/captable/seed-founder-shares", () => {
  beforeEach(() => clearLedger());

  function seedRound(): string {
    const r = createRound({
      companyId: COMPANY,
      name: "Founder Foundation",
      type: "foundation",
      pricePerShare: null,
      actorUserId: MAYA,
    });
    return r.id;
  }

  it("founder seeds founder shares → 201, ledger row appended, chain verifies", async () => {
    const roundId = seedRound();
    const res = await call("POST", "/api/founder/captable/seed-founder-shares", {
      userId: MAYA,
      body: { companyId: COMPANY, roundId, shares: "1000000", amount: "100", currency: "USD" },
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const ledger = getLedger();
    expect(ledger.some((e) => e.invitationId === `founder_seed_${COMPANY}`)).toBe(true);
    expect(verifyChain().ok).toBe(true);
  });

  it("is idempotent — a second seed returns the same entry with idempotent:true", async () => {
    const roundId = seedRound();
    const body = { companyId: COMPANY, roundId, shares: "1000000", amount: "100", currency: "USD" };
    const first = await call("POST", "/api/founder/captable/seed-founder-shares", { userId: MAYA, body });
    expect(first.status).toBe(201);
    const second = await call("POST", "/api/founder/captable/seed-founder-shares", { userId: MAYA, body });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(getLedger().filter((e) => e.invitationId === `founder_seed_${COMPANY}`).length).toBe(1);
  });

  it("rejects a non-founder with 403 FOUNDER_WRONG_COMPANY", async () => {
    const roundId = seedRound();
    const res = await call("POST", "/api/founder/captable/seed-founder-shares", {
      userId: LAPSED,
      body: { companyId: COMPANY, roundId, shares: "1000000", amount: "100", currency: "USD" },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FOUNDER_WRONG_COMPANY");
  });

  it("rejects unauthenticated with 401 (no dev-bypass persona)", async () => {
    const roundId = seedRound();
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const res = await call("POST", "/api/founder/captable/seed-founder-shares", {
        body: { companyId: COMPANY, roundId, shares: "1000000", amount: "100", currency: "USD" },
      });
      expect(res.status).toBe(401);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
  });

  it("rejects missing fields with 400", async () => {
    const res = await call("POST", "/api/founder/captable/seed-founder-shares", {
      userId: MAYA,
      body: { companyId: COMPANY },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a priced round with 400 PRICED_ROUND_NOT_ALLOWED", async () => {
    const priced = createRound({
      companyId: COMPANY,
      name: "Priced Round",
      type: "priced_equity",
      pricePerShare: 1.42,
      actorUserId: MAYA,
    });
    const res = await call("POST", "/api/founder/captable/seed-founder-shares", {
      userId: MAYA,
      body: { companyId: COMPANY, roundId: priced.id, shares: "1000000", amount: "100", currency: "USD" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PRICED_ROUND_NOT_ALLOWED");
  });
});

/* ================================================================== */
/* G0-2 — founder archive round                                        */
/* ================================================================== */

describe("G0-2 — POST /api/founder/rounds/:id/archive", () => {
  beforeEach(() => clearLedger());

  it("archives a round with no cap-table entries → 200 + archivedAt set", async () => {
    const r = createRound({ companyId: COMPANY, name: "Archivable", type: "seed", actorUserId: MAYA });
    const res = await call("POST", `/api/founder/rounds/${r.id}/archive`, { userId: MAYA });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.round.archivedAt).toBeTruthy();
    // Visible-but-inert: the round still resolves from the store.
    expect(getRoundById(r.id)).toBeTruthy();
  });

  it("refuses with 409 ROUND_HAS_CAPTABLE_ENTRIES when a committed entry exists", async () => {
    const r = createRound({ companyId: COMPANY, name: "HasEntries", type: "seed", actorUserId: MAYA });
    const commit = commitFunded({
      invitationId: `inv_archive_${r.id}`,
      roundId: r.id,
      companyId: COMPANY,
      investorId: "u_someone",
      amount: "250000",
      currency: "USD",
      shares: "12500",
      fromState: "funded",
    });
    expect(commit.ok).toBe(true);
    const res = await call("POST", `/api/founder/rounds/${r.id}/archive`, { userId: MAYA });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ROUND_HAS_CAPTABLE_ENTRIES");
  });

  it("rejects a non-owner with 403 FOUNDER_WRONG_COMPANY", async () => {
    const r = createRound({ companyId: COMPANY, name: "NotYours", type: "seed", actorUserId: MAYA });
    const res = await call("POST", `/api/founder/rounds/${r.id}/archive`, { userId: LAPSED });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FOUNDER_WRONG_COMPANY");
  });

  it("returns 404 for an unknown round", async () => {
    const res = await call("POST", "/api/founder/rounds/rnd_nope_xyz/archive", { userId: MAYA });
    expect(res.status).toBe(404);
  });

  it("unarchive restores a round → 200 + archivedAt cleared", async () => {
    const r = createRound({ companyId: COMPANY, name: "RoundTrip", type: "seed", actorUserId: MAYA });
    const arch = await call("POST", `/api/founder/rounds/${r.id}/archive`, { userId: MAYA });
    expect(arch.status).toBe(200);
    const un = await call("POST", `/api/founder/rounds/${r.id}/unarchive`, { userId: MAYA });
    expect(un.status).toBe(200);
    expect(un.body.round.archivedAt == null).toBe(true);
  });

  // G0-2 read-path (post-sandbox-test): the round READ endpoints must surface
  // archivedAt so the client can render archived rounds as greyed/inert.
  it("GET /api/rounds/:id and the list endpoint surface archivedAt after archive/unarchive", async () => {
    const r = createRound({ companyId: COMPANY, name: "ReadPath", type: "seed", actorUserId: MAYA });

    // Before archive: read path exposes the key as null (not undefined/absent).
    const before = await call("GET", `/api/rounds/${r.id}`, { userId: MAYA });
    expect(before.status).toBe(200);
    expect(before.body.archivedAt == null).toBe(true);

    // Archive, then the DETAIL read path must reflect the archived state.
    const arch = await call("POST", `/api/founder/rounds/${r.id}/archive`, { userId: MAYA });
    expect(arch.status).toBe(200);
    const detail = await call("GET", `/api/rounds/${r.id}`, { userId: MAYA });
    expect(detail.status).toBe(200);
    expect(detail.body.archivedAt).toBeTruthy();

    // …and the LIST read path (filtered by company) must too.
    const list = await call("GET", `/api/rounds?companyId=${COMPANY}`, { userId: MAYA });
    expect(list.status).toBe(200);
    const listed = (list.body as Array<{ id: string; archivedAt?: string | null }>).find((x) => x.id === r.id);
    expect(listed).toBeTruthy();
    expect(listed!.archivedAt).toBeTruthy();

    // Unarchive → both read paths report archivedAt cleared.
    const un = await call("POST", `/api/founder/rounds/${r.id}/unarchive`, { userId: MAYA });
    expect(un.status).toBe(200);
    const detail2 = await call("GET", `/api/rounds/${r.id}`, { userId: MAYA });
    expect(detail2.body.archivedAt == null).toBe(true);
  });
});

/* ================================================================== */
/* G0-2 — migration 0100 idempotency                                  */
/* ================================================================== */

describe("G0-2 — migration 0100 (rounds.archived_at) is additive + idempotent", () => {
  // The migrate runner swallows exactly this error class on a re-run.
  const IDEMPOTENT_RE = /duplicate column name|already exists/i;

  it("applying the migration twice leaves a single archived_at column", () => {
    const sqlPath = path.resolve(__dirname, "../../migrations/0100_v25_54_rounds_archived_at.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE rounds (id TEXT PRIMARY KEY)");

    const applyOnce = () => {
      try {
        db.exec(sql);
      } catch (err) {
        if (!IDEMPOTENT_RE.test((err as Error).message)) throw err;
      }
    };

    applyOnce();
    applyOnce(); // second run must be a no-op (swallowed duplicate-column)

    const cols = db.prepare("PRAGMA table_info(rounds)").all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "archived_at").length).toBe(1);
    db.close();
  });

  it("the mirrored server/db copy is byte-identical to migrations/", () => {
    const a = readFileSync(path.resolve(__dirname, "../../migrations/0100_v25_54_rounds_archived_at.sql"), "utf8");
    const b = readFileSync(path.resolve(__dirname, "../db/migrations/0100_v25_54_rounds_archived_at.sql"), "utf8");
    expect(a).toBe(b);
  });
});
