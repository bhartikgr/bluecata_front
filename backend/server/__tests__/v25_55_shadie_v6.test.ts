/**
 * v25.55.0 "Shadie Feedback Wave" — regression tests for the server-side items.
 *
 *   3a  A reminder (resend) to an ALREADY-ACCEPTED invitation is refused with a
 *       typed 409 `already_accepted` and no side effects (resent_at stays null).
 *   4a  An accepted invitation CAN be revoked; the accepted->revoked transition
 *       persists durably and the revoke route completes (best-effort notify).
 *   5a  Resending a live (sent) invitation ROTATES the token (token_hash changes)
 *       and stamps a durable `resent_at` marker (migration 0104).
 *   6a  Extending expiry is ADDITIVE: the new expiry is the CURRENT expiry + N
 *       days (anchored on the later of now / current expiry), not now + N.
 *   Q3  POST /api/founder/captable/backfill-investor seats a named off-platform
 *       investor via the sacred commitFunded() UNCHANGED (ledger row appended,
 *       chain still verifies) AND fires a platform-registration invite row.
 *   0104 migration (round_invitations.resent_at) is additive + idempotent and
 *       byte-identical across the two mirrored copies.
 *
 * All HTTP assertions hit the REAL Express routes via registerRoutes().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { createRound, hydrateRoundsStore } from "../roundsStore";
import { clearLedger, getLedger, verifyChain } from "../captableCommitStore";
import {
  createInvitation,
  markInvitationRedeemed,
} from "../roundInvitationsStore";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const MAYA = "u_maya_chen"; // founder of co_novapay
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

/** Read a durable invitation row straight from the DB (bypassing the cache). */
function dbInvite(id: string): {
  state: string;
  token_hash: string | null;
  resent_at: string | null;
  expires_at: string | null;
} | undefined {
  return rawDb()
    .prepare("SELECT state, token_hash, resent_at, expires_at FROM round_invitations WHERE id = ?")
    .get(id) as any;
}

/** Create a round owned by MAYA/COMPANY with no price-per-share. */
function seedRound(name: string): string {
  const r = createRound({
    companyId: COMPANY,
    name,
    type: "seed",
    pricePerShare: null,
    actorUserId: MAYA,
  });
  return r.id;
}

/**
 * Persist a REAL invitation row (dryRun → no email) so the resend/revoke/extend
 * persist-first UPDATEs (which check info.changes and throw on 0 rows) act on a
 * durable row rather than a memory-only fixture.
 */
async function seedInvite(roundId: string, email: string): Promise<string> {
  const inv = await createInvitation({
    roundId,
    companyId: COMPANY,
    investorEmail: email,
    investorFirstName: "Test",
    investorLastName: "Investor",
    invitedByUserId: MAYA,
    dryRun: true,
  });
  return inv.invitation.id;
}

/* ================================================================== */
/* 3a — accepted invitation cannot be reminded                         */
/* ================================================================== */

describe("3a — resend to an accepted invitation is refused (409, no side effects)", () => {
  it("returns 409 already_accepted and does NOT stamp resent_at", async () => {
    const roundId = seedRound("3a Accepted Resend");
    const invId = await seedInvite(roundId, "accepted-3a@example.com");
    expect(markInvitationRedeemed(invId, "u_someone")).toBe(true); // → accepted

    const res = await call("POST", `/api/rounds/${roundId}/invitations/${invId}/resend`, { userId: MAYA });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_accepted");

    const row = dbInvite(invId);
    expect(row?.state).toBe("accepted");
    expect(row?.resent_at == null).toBe(true); // no reminder side effect
  });
});

/* ================================================================== */
/* 4a — accepted invitation can be revoked (durably)                   */
/* ================================================================== */

describe("4a — an accepted invitation can be revoked and the transition persists", () => {
  it("DELETE → 200 and the DB row flips accepted → revoked", async () => {
    const roundId = seedRound("4a Revoke Accepted");
    const invId = await seedInvite(roundId, "revoke-4a@example.com");
    expect(markInvitationRedeemed(invId, "u_someone")).toBe(true); // → accepted

    const res = await call("DELETE", `/api/rounds/${roundId}/invitations/${invId}`, { userId: MAYA });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(dbInvite(invId)?.state).toBe("revoked");
  });
});

/* ================================================================== */
/* 5a/5b — resend rotates the token and stamps resent_at               */
/* ================================================================== */

describe("5a/5b — resending a live invite rotates token_hash and stamps resent_at", () => {
  it("POST resend → 200; token_hash changes and resent_at is set", async () => {
    const roundId = seedRound("5a Resend Rotate");
    const invId = await seedInvite(roundId, "resend-5a@example.com");

    const before = dbInvite(invId);
    expect(before?.resent_at == null).toBe(true);
    const oldHash = before?.token_hash;

    const res = await call("POST", `/api/rounds/${roundId}/invitations/${invId}/resend`, { userId: MAYA });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.resentAt).toBeTruthy();

    const after = dbInvite(invId);
    expect(after?.resent_at).toBeTruthy();
    expect(after?.token_hash).toBeTruthy();
    expect(after?.token_hash).not.toBe(oldHash); // token rotation
  });
});

/* ================================================================== */
/* 6a — extend expiry is additive (current expiry + N)                 */
/* ================================================================== */

describe("6a — extending expiry is additive from the current expiry, not from now", () => {
  it("PATCH expiryDays:30 pushes the expiry ~30 days past the previous expiry", async () => {
    const roundId = seedRound("6a Extend Additive");
    const invId = await seedInvite(roundId, "extend-6a@example.com");

    const oldExpiry = Date.parse(dbInvite(invId)!.expires_at!);
    expect(Number.isFinite(oldExpiry)).toBe(true);

    const res = await call("PATCH", `/api/rounds/${roundId}/invitations/${invId}`, {
      userId: MAYA,
      body: { expiryDays: 30 },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const newExpiry = Date.parse(dbInvite(invId)!.expires_at!);
    const deltaDays = (newExpiry - oldExpiry) / 86_400_000;
    // Additive: the current (future) expiry is the anchor, so new ≈ old + 30d.
    // (A non-additive now+30 implementation would yield ~16 days here since the
    // seed invite already sits at now+14.)
    expect(deltaDays).toBeGreaterThan(29);
    expect(deltaDays).toBeLessThan(31);
  });
});

/* ================================================================== */
/* Q3 — backfill seats an off-platform investor + invites them         */
/* ================================================================== */

describe("Q3 — POST /api/founder/captable/backfill-investor", () => {
  it("seats via commitFunded (chain verifies) and creates a registration invite", async () => {
    clearLedger();
    const roundId = seedRound("Q3 Backfill");
    const email = "backfill-q3@example.com";

    const res = await call("POST", "/api/founder/captable/backfill-investor", {
      userId: MAYA,
      body: {
        companyId: COMPANY,
        roundId,
        holderFirstName: "Ext",
        holderLastName: "Investor",
        investorEmail: email,
        amount: "250000",
        shares: "12500",
        currency: "USD",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);

    // Money core: an off-platform investor row was seated and the chain holds.
    const seated = getLedger().filter((e) => e.roundId === roundId && e.investorId.startsWith("ext_"));
    expect(seated.length).toBe(1);
    expect(verifyChain().ok).toBe(true);

    // Registration invite row was created for the seated investor.
    const invite = rawDb()
      .prepare("SELECT 1 FROM round_invitations WHERE round_id = ? AND lower(trim(investor_email)) = ? LIMIT 1")
      .get(roundId, email.toLowerCase());
    expect(invite).toBeTruthy();
  });

  it("is idempotent — a second identical backfill returns idempotent:true and no second ledger row", async () => {
    clearLedger();
    const roundId = seedRound("Q3 Backfill Idempotent");
    const body = {
      companyId: COMPANY,
      roundId,
      holderFirstName: "Ext",
      holderLastName: "Investor",
      investorEmail: "idem-q3@example.com",
      amount: "100000",
      shares: "5000",
      currency: "USD",
    };
    const first = await call("POST", "/api/founder/captable/backfill-investor", { userId: MAYA, body });
    expect(first.status).toBe(201);
    const second = await call("POST", "/api/founder/captable/backfill-investor", { userId: MAYA, body });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(getLedger().filter((e) => e.roundId === roundId).length).toBe(1);
  });

  it("rejects a non-founder with 403 FOUNDER_WRONG_COMPANY", async () => {
    const roundId = seedRound("Q3 Backfill Auth");
    const res = await call("POST", "/api/founder/captable/backfill-investor", {
      userId: "u_lapsed_lp",
      body: {
        companyId: COMPANY,
        roundId,
        holderFirstName: "Ext",
        holderLastName: "Investor",
        investorEmail: "auth-q3@example.com",
        amount: "100000",
        shares: "5000",
      },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FOUNDER_WRONG_COMPANY");
  });

  it("requires a full name (rule #13) — missing last name → 400 missing_holder_name", async () => {
    const roundId = seedRound("Q3 Backfill Name");
    const res = await call("POST", "/api/founder/captable/backfill-investor", {
      userId: MAYA,
      body: {
        companyId: COMPANY,
        roundId,
        holderFirstName: "Ext",
        holderLastName: "",
        investorEmail: "name-q3@example.com",
        amount: "100000",
        shares: "5000",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_holder_name");
  });
});

/* ================================================================== */
/* migration 0104 — additive + idempotent + byte-identical mirror      */
/* ================================================================== */

describe("migration 0104 (round_invitations.resent_at) is additive + idempotent", () => {
  const IDEMPOTENT_RE = /duplicate column name|already exists/i;

  it("applying the migration twice leaves a single resent_at column", () => {
    const sqlPath = path.resolve(__dirname, "../../migrations/0104_shadie_v6_invite_resent_at.sql");
    const sql = readFileSync(sqlPath, "utf8");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE round_invitations (id TEXT PRIMARY KEY)");

    const applyOnce = () => {
      try {
        db.exec(sql);
      } catch (err) {
        if (!IDEMPOTENT_RE.test((err as Error).message)) throw err;
      }
    };

    applyOnce();
    applyOnce(); // second run must be a no-op (swallowed duplicate-column)

    const cols = db.prepare("PRAGMA table_info(round_invitations)").all() as Array<{ name: string }>;
    expect(cols.filter((c) => c.name === "resent_at").length).toBe(1);
    db.close();
  });

  it("the mirrored server/db copy is byte-identical to migrations/", () => {
    const a = readFileSync(path.resolve(__dirname, "../../migrations/0104_shadie_v6_invite_resent_at.sql"), "utf8");
    const b = readFileSync(path.resolve(__dirname, "../db/migrations/0104_shadie_v6_invite_resent_at.sql"), "utf8");
    expect(a).toBe(b);
  });
});
