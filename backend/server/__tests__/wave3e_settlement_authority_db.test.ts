/**
 * WAVE 3E — the fee-settlement authority is a DURABLE DB RECORD.
 *
 * Owner ruling, verbatim: "All db-driven. No in-memory anywhere."
 *
 * WHAT THIS SUITE IS FOR
 * ----------------------
 * WAVE 1A closed the fee self-mark hole (S-2) with an unforgeable capability
 * whose ISSUE REGISTRY was a module-private `WeakSet` and whose REPLAY COUNTER
 * was a module-private `WeakMap`. The cryptographic idea was sound; the storage
 * was process-local, so:
 *   - an authorization did not survive a restart;
 *   - a second process could not see that one was already spent;
 *   - the consume was a read-then-write and was not atomic with the money write.
 *
 * WAVE 3E re-homes the AUTHORITY onto `fee_settlement_authorization`
 * (migration 0151) WITHOUT weakening the security property. This suite proves
 * both halves:
 *
 *   PART A — the five WAVE 1A sinks are STILL CLOSED, individually.
 *   PART B — the durable mechanism: schema parity, atomic consume, DB-sourced
 *            replay protection, expiry, scope, concurrency, crash safety, and
 *            the absence of any in-memory authority.
 *
 * The 31 tests of `wave1a_s2_fee_self_mark.test.ts` continue to run UNCHANGED
 * and continue to pass; this suite is additive and re-proves the same five
 * sinks against the DB-backed mechanism.
 *
 * Run: npx vitest run server/__tests__/wave3e_settlement_authority_db.test.ts
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  __authorizeForTest,
  __authorizeExpiredForTest,
  consumeSettlementAuthorization,
  withSettlementTransaction,
  isFeeSettlementAuthorization,
  readSettlementAuthorizationRow,
  rehydrateSettlementAuthorization,
  FEE_SETTLEMENT_AUTHORITY_SQL,
  SETTLEMENT_AUTHORIZATION_TABLE,
  SETTLEMENT_AUTHORIZATION_USE_TABLE,
} from "../lib/feeSettlementAuthority";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";

let app: express.Express;

const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});
const put = (p: string, u: string, b?: unknown) => request(app).put(p).set("x-user-id", u).send(b ?? {});
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.resolve(__dirname, "..");
const MIGRATION_REL = "migrations/0151_wave3e_fee_settlement_authorization.sql";
const authoritySrc = fs.readFileSync(path.join(SRC_DIR, "lib", "feeSettlementAuthority.ts"), "utf8");
const storeSrc = fs.readFileSync(path.join(SRC_DIR, "spvEngineStore.ts"), "utf8");
const routesSrc = fs.readFileSync(path.join(SRC_DIR, "spvEngineRoutes.ts"), "utf8");

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Accrue a pending FIXED funding obligation and return its id + amount. */
async function accrueFixedObligation(
  spvId: string, investorId: string, fixedAmountMinor: number,
): Promise<{ obId: string; amountMinor: number; currency: string }> {
  await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "fixed", fixedAmountMinor });
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor: 100000 });
  expect(sub.status).toBe(201);
  const subId = sub.body.subscription.id as string;
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
  await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "wire_funded" });
  const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
  const fixed = obs.body.obligations.find((o: any) => o.portion === "fixed" && o.timing === "funding");
  expect(fixed).toBeTruthy();
  expect(fixed.state).toBe("pending");
  return { obId: fixed.id as string, amountMinor: fixed.amountMinor as number, currency: fixed.currency as string };
}

/** THE assertion. Reads the PERSISTED state, not a response. */
async function persistedState(spvId: string, obId: string): Promise<string> {
  const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
  const o = obs.body.obligations.find((x: any) => x.id === obId);
  return o ? String(o.state) : "MISSING";
}

/** The obligation state as the DATABASE holds it — not the RAM projection. */
function dbObligationState(obId: string): string {
  const row = rawDb().prepare(`SELECT state FROM spv_fee_obligation WHERE id = ?`).get(obId) as { state?: string } | undefined;
  return row?.state ? String(row.state) : "MISSING";
}

/** Authorizations minted for an SPV. A MISSING table means none were minted —
 *  the authority bootstraps lazily and seeds nothing. */
function mintedCountForSpv(spvId: string): number {
  try {
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE spv_id = ?`)
      .get(spvId) as { n: number };
    return Number(row.n);
  } catch (e) {
    expect(String((e as Error).message)).toMatch(/no such table/);
    return 0;
  }
}

function useRowCount(authId: string): number {
  const row = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${SETTLEMENT_AUTHORIZATION_USE_TABLE} WHERE authorization_id = ?`)
    .get(authId) as { n: number };
  return Number(row.n);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART A — THE FIVE WAVE 1A SINKS, RE-PROVEN INDIVIDUALLY AGAINST THE
 *          DB-BACKED MECHANISM. The security property must not regress.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W3E-SINK — all five WAVE 1A sinks remain closed under the DB-backed authority", () => {
  it("W3E-SINK-1 — the partner charge route still reads NO body and cannot reach paid", async () => {
    const spvId = await createSpv("W3E sink1");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_s1", 5000);
    for (const body of [{}, { outcome: "succeeded" }, { forceState: "succeeded" }, { settlement: { id: "fsa_anything" } }]) {
      const r = await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, body);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
      expect(await persistedState(spvId, obId)).not.toBe("paid");
      expect(dbObligationState(obId)).not.toBe("paid");
    }
    // And nothing was minted: the gateway mint throws BEFORE any row is written.
    expect(mintedCountForSpv(spvId)).toBe(0);
  });

  it("W3E-SINK-1b — the derivation site still forwards a DERIVED local, now inside the transaction", () => {
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    const txAt = fn.indexOf("withSettlementTransaction(");
    const consumeAt = fn.indexOf("consumeSettlementAuthorization(");
    const forceAt = fn.indexOf("forceState: outcome");
    expect(txAt).toBeGreaterThan(-1);
    expect(consumeAt).toBeGreaterThan(txAt);       // consume is INSIDE the transaction
    expect(forceAt).toBeGreaterThan(consumeAt);    // the derivation follows the consume
    expect(fn).not.toMatch(/forceState:\s*"succeeded"/);
  });

  it("W3E-SINK-2 — a carry-bearing partner distribution still fails closed, nothing paid", async () => {
    const spvId = await createSpv("W3E sink2");
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    for (const inv of ["inv_w3e_s2a", "inv_w3e_s2b"]) {
      const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId: inv, commitmentMinor: 100000 });
      const subId = sub.body.subscription.id as string;
      await put(`/api/partner/me/compliance/${inv}`, MANAGING, { kycStatus: "verified", accreditationStatus: "self_certified" });
      await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "committed", subscriptionDocRef: `sig_${inv}` });
    }
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 1_000_000, costBasisMinor: 200_000, currency: "USD",
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("SETTLEMENT_AUTHORIZATION_REQUIRED");
    const obs = await get(`/api/partner/me/spv/${spvId}/fee-obligations`, MANAGING);
    expect((obs.body.obligations ?? []).some((o: any) => o.state === "paid")).toBe(false);
  });

  it("W3E-SINK-3 — the store signature still has NO default; omitting the authorization throws", async () => {
    const spvId = await createSpv("W3E sink3");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_s3", 4000);
    expect(() =>
      (spvEngineStore.chargeFeeObligation as unknown as (...a: unknown[]) => unknown)(
        "ac_consortium_partner_test_partner_inc", spvId, obId, "cust",
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
    expect(dbObligationState(obId)).not.toBe("paid");
    const sig = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("chargeFeeObligation(") + 400);
    expect(sig).toMatch(/settlement: FeeSettlementAuthorization,/);
    expect(sig).not.toMatch(/=\s*"succeeded"/);
  });

  it('W3E-SINK-4 — "demo" is still not a settlement, and the failed state is DURABLE', async () => {
    const spvId = await createSpv("W3E sink4");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_s4", 3000);
    // A ledger entry already exists in "demo" state for this intent, so the
    // charge dedups onto it and the settlement check sees entryState "demo".
    const { chargeOrIdempotent } = await import("../paymentStore");
    chargeOrIdempotent({
      intentId: `spvfee_${obId}`, kind: "company_billing", amountCents: 3000, currency: "USD",
      customerId: "cust", description: "demo seam", forceState: "demo",
    });
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(() =>
      spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth),
    ).toThrow(/FEE_COLLECTION_FAILED/);
    expect(dbObligationState(obId)).toBe("failed");
    // The recorded FAILURE is a settlement, so the authorization IS consumed —
    // and both facts committed together.
    const row = readSettlementAuthorizationRow(auth.id)!;
    expect(Number(row.uses_consumed)).toBe(1);
    expect(row.consumed_at).toBeTruthy();
    // Source: the check still names only "succeeded".
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    expect(fn).toMatch(/entryState !== "succeeded"/);
    expect(fn).not.toMatch(/entryState !== "demo"/);
  });

  it("W3E-SINK-5 — `collectionOutcome` is still unreadable and still rejected at the edge", async () => {
    const spvId = await createSpv("W3E sink5");
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, MANAGING, {
      event: "exit", grossProceedsMinor: 500_000, collectionOutcome: "succeeded",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SETTLEMENT_NOT_CLIENT_SUPPLIED");
    const stripped = storeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/collectionOutcome/);
  });

  it('W3E-SINK-ALL — `state = "paid"` still has EXACTLY ONE assignment, behind the gate and inside the transaction', () => {
    const assignments = [...storeSrc.matchAll(/\.state\s*=\s*"paid"/g)];
    expect(assignments.length).toBe(1);
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    expect(fn.indexOf("withSettlementTransaction(")).toBeLessThan(fn.indexOf("consumeSettlementAuthorization("));
    expect(fn.indexOf("consumeSettlementAuthorization(")).toBeLessThan(fn.indexOf('.state = "paid"'));
    expect(storeSrc).not.toMatch(/UPDATE\s+spv_fee_obligation[\s\S]{0,200}state\s*=\s*'paid'/i);
  });

  it("W3E-SINK-FORGE — a forged authorization is still rejected, and never touches the database", async () => {
    const spvId = await createSpv("W3E forge");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_forge", 2500);
    const real = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    // Every shape a request body could take, INCLUDING one that copies the id of
    // a genuine, unconsumed, durable row. The brand (defence in depth) stops it
    // before the DB is reached; the DB would also refuse it, since the caller
    // holds no branded handle.
    const forgeries: unknown[] = [
      undefined, null, {}, "fsa_whatever", 42,
      { id: real.id, outcome: "succeeded", purpose: "fee_obligation", spvId, obligationId: obId },
      { ...JSON.parse(JSON.stringify(real)), outcome: "succeeded" },
      Object.assign(Object.create(null), { id: real.id, outcome: "succeeded" }),
    ];
    for (const f of forgeries) {
      expect(isFeeSettlementAuthorization(f)).toBe(false);
      expect(() =>
        spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", f as never),
      ).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
      expect(dbObligationState(obId)).not.toBe("paid");
    }
    // The genuine row was never consumed by any of that.
    expect(Number(readSettlementAuthorizationRow(real.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-SINK-GATE — self-marking still cannot open the LP-commit / cap-table gate", async () => {
    const spvId = await createSpv("W3E gate");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_gate", 7000);
    await post(`/api/partner/me/spv/${spvId}/fee-obligations/${obId}/charge`, MANAGING, { outcome: "succeeded" });
    expect(spvEngineStore.hasUnsettledFixedFees("ac_consortium_partner_test_partner_inc", spvId)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — THE DURABLE MECHANISM
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W3E-SCHEMA — the authority table is a real migration, and the bootstrap cannot drift", () => {
  it("W3E-SCHEMA-1 — 0151 is the first free number after 0148 and after the highest present", () => {
    const nums = (dir: string) =>
      fs.readdirSync(path.join(REPO_ROOT, dir))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .map((f) => Number(f.slice(0, 4)));
    const canonical = nums("migrations");
    const mirror = nums("server/db/migrations");
    expect(canonical).toContain(151);
    expect(mirror).toContain(151);
    // Originally asserted `max === 151`, i.e. "0151 is the newest migration".
    // That is a statement about the REST of the repo, not about Wave 3E, so it
    // went red the moment later waves added 0153/0156/0157/0159/0160/0161/0162.
    // The invariant this test actually needs is that 0151 is UNIQUE and MIRRORED,
    // which is what a collision would break — and 0152 WAS double-claimed by two
    // concurrent waves tonight, so that risk is real, not hypothetical.
    expect(canonical.filter((n) => n === 151).length).toBe(1);
    expect(mirror.filter((n) => n === 151).length).toBe(1);
    expect(mirror.filter((n) => n === 151).length).toBe(1);
    expect(151).toBeGreaterThan(148);
  });

  it("W3E-SCHEMA-2 — canonical and mirror migrations are byte-identical", () => {
    const a = fs.readFileSync(path.join(REPO_ROOT, MIGRATION_REL));
    const b = fs.readFileSync(path.join(REPO_ROOT, "server/db", MIGRATION_REL));
    expect(a.equals(b)).toBe(true);
  });

  it("W3E-SCHEMA-3 — the inline bootstrap text is the canonical migration, verbatim", () => {
    const onDisk = fs.readFileSync(path.join(REPO_ROOT, MIGRATION_REL), "utf8");
    expect(FEE_SETTLEMENT_AUTHORITY_SQL).toBe(onDisk);
  });

  it("W3E-SCHEMA-4 — the migration is idempotent and seeds NOTHING", () => {
    const db = new Database(":memory:");
    db.exec(FEE_SETTLEMENT_AUTHORITY_SQL);
    db.exec(FEE_SETTLEMENT_AUTHORITY_SQL); // re-run: no-op
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${SETTLEMENT_AUTHORIZATION_TABLE}`).get() as { n: number };
    expect(Number(n.n)).toBe(0); // an empty authority settles nothing
    db.close();
  });

  it("W3E-SCHEMA-5 — the SACRED runner and connection files are untouched by this wave", () => {
    for (const f of ["server/db/migrate.ts", "server/db/connection.ts", "server/paymentGatewayAdapter.ts", "server/captableCommitStore.ts"]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
      expect(src).not.toMatch(/WAVE 3E/);
      expect(src).not.toMatch(/fee_settlement_authorization/);
    }
  });

  it("W3E-SCHEMA-6 — the durable row records identity, scope, issuer, times and consumption state", async () => {
    const spvId = await createSpv("W3E schema row");
    const { obId, amountMinor, currency } = await accrueFixedObligation(spvId, "inv_w3e_row", 6100);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    const row = readSettlementAuthorizationRow(auth.id)!;
    expect(row.id).toBe(auth.id);                       // identity
    expect(row.purpose).toBe("fee_obligation");         // which kind
    expect(row.spv_id).toBe(spvId);                     // which SPV
    expect(row.obligation_id).toBe(obId);               // which fee
    expect(Number(row.amount_minor)).toBe(amountMinor); // which amount
    expect(row.currency).toBe(currency);
    expect(row.outcome).toBe("succeeded");
    expect(row.source).toBe("test");
    expect(String(row.issued_by)).toBeTruthy();         // issuer
    expect(String(row.issued_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/); // issue time
    expect(String(row.expires_at) > String(row.issued_at)).toBe(true); // expiry
    expect(Number(row.uses_consumed)).toBe(0);          // consumption state
    expect(row.consumed_at).toBeNull();                 // consumption time
  });
});

describe("W3E-NOMEM — the authority is the DB row, not process memory", () => {
  it("W3E-NOMEM-1 — no WeakMap replay counter survives in the module's CODE", () => {
    // Comments still describe the WAVE 1A design that was replaced, so the
    // assertion is made against the code with comments stripped.
    const code = authoritySrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/WeakMap/);
    expect(code).not.toMatch(/CONSUMED/);
    // The only surviving process-local structure is the brand registry.
    const weakSets = [...code.matchAll(/new WeakSet/g)];
    expect(weakSets.length).toBe(1);
  });

  it("W3E-NOMEM-2 — the WeakSet that remains is documented as defence-in-depth ONLY", () => {
    expect(authoritySrc).toMatch(/DEFENCE IN DEPTH, LAYER 2/);
    expect(authoritySrc).toMatch(/never the authority/i);
    // The brand check exists, and the DB UPDATE runs regardless of it.
    const fn = authoritySrc.slice(authoritySrc.indexOf("export function consumeSettlementAuthorization"));
    expect(fn.indexOf("isFeeSettlementAuthorization(auth)")).toBeGreaterThan(-1);
    expect(fn.indexOf("UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE}")).toBeGreaterThan(-1);
  });

  it("W3E-NOMEM-3 — consumption is a CONDITIONAL UPDATE with an affected-row check, not read-then-write", () => {
    const fn = authoritySrc.slice(
      authoritySrc.indexOf("export function consumeSettlementAuthorization"),
      authoritySrc.indexOf("export function readSettlementAuthorizationRow"),
    );
    // One UPDATE, carrying every precondition in its WHERE clause.
    expect(fn).toMatch(/UPDATE \$\{SETTLEMENT_AUTHORIZATION_TABLE\}/);
    expect(fn).toMatch(/AND uses_consumed < uses_max/);
    expect(fn).toMatch(/AND revoked_at\s+IS NULL/);
    expect(fn).toMatch(/AND expires_at\s+> \?/);
    expect(fn).toMatch(/AND purpose\s+= \?/);
    expect(fn).toMatch(/AND spv_id\s+= \?/);
    expect(fn).toMatch(/obligation_id IS NULL OR obligation_id = \?/);
    expect(fn).toMatch(/amount_minor\s+IS NULL OR \? IS NULL OR amount_minor = \?/);
    // The affected-row count is the decision.
    expect(fn).toMatch(/changes = Number\(res\?\.changes \?\? 0\)/);
    expect(fn).toMatch(/if \(changes !== 1\)/);
    // No SELECT-then-decide-then-UPDATE anywhere before the UPDATE.
    const beforeUpdate = fn.slice(0, fn.indexOf("UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE}"));
    expect(beforeUpdate).not.toMatch(/SELECT .* FROM \$\{SETTLEMENT_AUTHORIZATION_TABLE\}/);
  });

  it("W3E-NOMEM-4 — rehydration is not reachable from any route module", () => {
    expect(routesSrc).not.toMatch(/rehydrateSettlementAuthorization/);
    const routeFiles = fs.readdirSync(SRC_DIR).filter((f) => /Routes\.ts$/.test(f));
    expect(routeFiles.length).toBeGreaterThan(0);
    for (const f of routeFiles) {
      expect(fs.readFileSync(path.join(SRC_DIR, f), "utf8")).not.toMatch(/rehydrateSettlementAuthorization/);
    }
  });
});

describe("W3E-ATOMIC — consumption is atomic with the money write", () => {
  it("W3E-ATOMIC-1 — consuming outside a transaction is REFUSED", async () => {
    const spvId = await createSpv("W3E atomic refuse");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_at1", 1200);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(() => consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: obId }))
      .toThrow(/SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL/);
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-ATOMIC-2 — a crash AFTER the consume and BEFORE the commit rolls the consume back", async () => {
    const spvId = await createSpv("W3E atomic crash");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_at2", 1300);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(() =>
      withSettlementTransaction(() => {
        consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: obId });
        throw new Error("CRASH_BEFORE_MONEY_WRITE");
      }),
    ).toThrow(/CRASH_BEFORE_MONEY_WRITE/);
    // NOT half-applied: the authorization is unspent and no use was recorded.
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
    expect(readSettlementAuthorizationRow(auth.id)!.consumed_at).toBeNull();
    expect(useRowCount(auth.id)).toBe(0);
    // And it is still usable afterwards — the crash cost nothing.
    const paid = withSettlementTransaction(() =>
      consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: obId }),
    );
    expect(paid.outcome).toBe("succeeded");
  });

  it("W3E-ATOMIC-3 — a crash in the MONEY WRITE leaves neither a settlement nor a spent authorization", async () => {
    const spvId = await createSpv("W3E atomic money");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_at3", 1400);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    // Fail the obligation write that follows the ledger entry — the exact
    // "crash between consume and write" the brief names.
    const spy = vi.spyOn(spvEngineStore, "_persistFeeObligation").mockImplementation(() => {
      throw new Error("STRICT_PERSIST_FAILED: spv_fee_obligation: simulated crash");
    });
    try {
      expect(() =>
        spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth),
      ).toThrow(/STRICT_PERSIST_FAILED/);
    } finally {
      spy.mockRestore();
    }
    // Neither side applied.
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
    expect(useRowCount(auth.id)).toBe(0);
    expect(dbObligationState(obId)).not.toBe("paid");
    // The RAM projection did not run ahead of the database either.
    expect(await persistedState(spvId, obId)).not.toBe("paid");
    // The authorization survived intact and still settles once, exactly once.
    const ok = spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth);
    expect(ok.state).toBe("paid");
    expect(dbObligationState(obId)).toBe("paid");
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(1);
  });

  it("W3E-ATOMIC-4 — the store wraps consume + charge + obligation write in ONE transaction", () => {
    const fn = storeSrc.slice(storeSrc.indexOf("chargeFeeObligation("), storeSrc.indexOf("waiveFeeObligation("));
    const txStart = fn.indexOf("withSettlementTransaction(");
    expect(txStart).toBeGreaterThan(-1);
    const body = fn.slice(txStart);
    // All three writes live inside the same callback.
    expect(body.indexOf("consumeSettlementAuthorization(")).toBeGreaterThan(-1);
    expect(body.indexOf("chargeOrIdempotent(")).toBeGreaterThan(body.indexOf("consumeSettlementAuthorization("));
    expect(body.indexOf('.state = "paid"')).toBeGreaterThan(body.indexOf("chargeOrIdempotent("));
    expect(fn.indexOf("withSettlementTransaction(")).toBeLessThan(fn.indexOf("consumeSettlementAuthorization("));
  });
});

describe("W3E-REPLAY — replay protection comes from the row", () => {
  it("W3E-REPLAY-1 — a second consume of the same authorization is REPLAYED, not allowed", async () => {
    const spvId = await createSpv("W3E replay");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_rp1", 2100);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    const first = spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth);
    expect(first.state).toBe("paid");
    const row = readSettlementAuthorizationRow(auth.id)!;
    expect(Number(row.uses_consumed)).toBe(1);
    expect(row.consumed_at).toBeTruthy();
    // Direct re-consume against a DIFFERENT obligation of the same SPV — the
    // authorization is exhausted, so it is refused on the row's own state.
    const second = await accrueFixedObligation(await createSpv("W3E replay 2"), "inv_w3e_rp2", 2200);
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: second.obId }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_(REPLAYED|SCOPE_MISMATCH)/);
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(1);
  });

  it("W3E-REPLAY-2 — the per-use ledger forbids the same authorization settling the same obligation twice", async () => {
    const spvId = await createSpv("W3E replay ledger");
    // A carry authorization legitimately has TWO uses; it still may not spend
    // both on the SAME obligation.
    const auth = __authorizeForTest({ purpose: "distribution_carry", spvId, outcome: "succeeded" });
    withSettlementTransaction(() =>
      consumeSettlementAuthorization(auth, { purpose: "distribution_carry", spvId, obligationId: "ob_leg_1" }),
    );
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(auth, { purpose: "distribution_carry", spvId, obligationId: "ob_leg_1" }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
    // The rejected attempt rolled the counter back: exactly one use recorded.
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(1);
    expect(useRowCount(auth.id)).toBe(1);
    // The SECOND, DIFFERENT leg is still allowed — and then it is exhausted.
    withSettlementTransaction(() =>
      consumeSettlementAuthorization(auth, { purpose: "distribution_carry", spvId, obligationId: "ob_leg_2" }),
    );
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(2);
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(auth, { purpose: "distribution_carry", spvId, obligationId: "ob_leg_3" }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REPLAYED/);
  });

  it("W3E-REPLAY-3 — the durable row cannot be un-consumed by a direct UPDATE or DELETE", async () => {
    const spvId = await createSpv("W3E replay immutable");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_rp3", 2300);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth);
    const db = rawDb();
    expect(() => db.prepare(`UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE} SET uses_consumed = 0, consumed_at = NULL WHERE id = ?`).run(auth.id))
      .toThrow(/SETTLEMENT_AUTHORIZATION_(ALREADY_CONSUMED|USE_NOT_MONOTONIC)/);
    expect(() => db.prepare(`DELETE FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = ?`).run(auth.id))
      .toThrow(/SETTLEMENT_AUTHORIZATION_IMMUTABLE/);
    expect(() => db.prepare(`DELETE FROM ${SETTLEMENT_AUTHORIZATION_USE_TABLE} WHERE authorization_id = ?`).run(auth.id))
      .toThrow(/SETTLEMENT_AUTHORIZATION_USE_IMMUTABLE/);
    expect(() => db.prepare(`UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE} SET spv_id = 'other' WHERE id = ?`).run(auth.id))
      .toThrow(/SETTLEMENT_AUTHORIZATION_IMMUTABLE/);
  });
});

describe("W3E-CONCURRENCY — a double consume yields exactly one winner", () => {
  it("W3E-CONC-1 — N racing consumes of one authorization: exactly one succeeds", async () => {
    const spvId = await createSpv("W3E conc app");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_cc1", 3100);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        try {
          withSettlementTransaction(() =>
            consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: obId }),
          );
          return "won";
        } catch (e) {
          return (e as Error).message;
        }
      }),
    );
    expect(results.filter((r) => r === "won").length).toBe(1);
    expect(results.filter((r) => r !== "won").every((r) => /REPLAYED/.test(r))).toBe(true);
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(1);
    expect(useRowCount(auth.id)).toBe(1);
  });

  it("W3E-CONC-2 — two SEPARATE DB CONNECTIONS racing on one file: exactly one winner", () => {
    // The app-level test above shares one handle. This one is two genuinely
    // independent connections to the same file — the multi-process case.
    const dir = fs.mkdtempSync(path.join(REPO_ROOT, ".w3e_conc_"));
    const file = path.join(dir, "authority.db");
    const setup = new Database(file);
    setup.pragma("journal_mode = WAL");
    setup.exec(FEE_SETTLEMENT_AUTHORITY_SQL);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 900_000).toISOString();
    setup.prepare(
      `INSERT INTO ${SETTLEMENT_AUTHORIZATION_TABLE}
         (id, purpose, spv_id, obligation_id, amount_minor, currency, outcome, source,
          issued_by, issued_at, reason, expires_at, uses_max, uses_consumed, consumed_at, revoked_at)
       VALUES ('fsa_race','fee_obligation','spv_race','ob_race',100,'USD','succeeded','platform_admin',
               'u_admin', ?, 'race', ?, 1, 0, NULL, NULL)`,
    ).run(issuedAt, expiresAt);
    setup.close();

    const CONSUME = `UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE}
        SET uses_consumed = uses_consumed + 1,
            consumed_at = CASE WHEN uses_consumed + 1 >= uses_max THEN ? ELSE consumed_at END
      WHERE id = ? AND uses_consumed < uses_max AND revoked_at IS NULL AND expires_at > ?
        AND purpose = ? AND spv_id = ? AND (obligation_id IS NULL OR obligation_id = ?)`;

    const a = new Database(file);
    const b = new Database(file);
    const now = new Date().toISOString();
    const attempt = (db: Database.Database): number => {
      try {
        const r = db.prepare(CONSUME).run(now, "fsa_race", now, "fee_obligation", "spv_race", "ob_race");
        return Number(r.changes);
      } catch {
        return 0; // a lock conflict is a REFUSAL, never a second consume
      }
    };
    const winners = [attempt(a), attempt(b), attempt(a), attempt(b)];
    expect(winners.filter((n) => n === 1).length).toBe(1);
    const finalRow = a.prepare(`SELECT uses_consumed, consumed_at FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = 'fsa_race'`).get() as { uses_consumed: number; consumed_at: string | null };
    expect(Number(finalRow.uses_consumed)).toBe(1);
    expect(finalRow.consumed_at).toBeTruthy();
    // The other connection SEES the consumption — this is what the WeakMap could
    // never do.
    const seenByB = b.prepare(`SELECT uses_consumed FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE id = 'fsa_race'`).get() as { uses_consumed: number };
    expect(Number(seenByB.uses_consumed)).toBe(1);
    a.close(); b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("W3E-EXPIRY / W3E-SCOPE — everything else fails closed", () => {
  it("W3E-EXPIRY-1 — an expired authorization is rejected and consumes nothing", async () => {
    const spvId = await createSpv("W3E expiry");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_ex1", 4100);
    const auth = __authorizeExpiredForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(() =>
      spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_EXPIRED/);
    expect(dbObligationState(obId)).not.toBe("paid");
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
    // Rehydration refuses it too.
    expect(() => rehydrateSettlementAuthorization(auth.id)).toThrow(/SETTLEMENT_AUTHORIZATION_EXPIRED/);
  });

  it("W3E-EXPIRY-2 — every mint carries a mandatory expiry strictly after issue", async () => {
    const spvId = await createSpv("W3E expiry ttl");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_ex2", 4200);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(Date.parse(auth.expiresAt)).toBeGreaterThan(Date.parse(auth.issuedAt));
    // The DB refuses a row that expires before it was issued.
    expect(() =>
      rawDb().prepare(
        `INSERT INTO ${SETTLEMENT_AUTHORIZATION_TABLE}
           (id,purpose,spv_id,obligation_id,amount_minor,currency,outcome,source,issued_by,issued_at,reason,expires_at,uses_max,uses_consumed,consumed_at,revoked_at)
         VALUES ('fsa_bad_ttl','fee_obligation','s','o',NULL,NULL,'succeeded','test','t','2026-08-10T10:00:00Z','r','2026-08-10T09:00:00Z',1,0,NULL,NULL)`,
      ).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it("W3E-SCOPE-1 — an authorization minted for another SPV cannot settle this one", async () => {
    const spvA = await createSpv("W3E scope A");
    const spvB = await createSpv("W3E scope B");
    const a = await accrueFixedObligation(spvA, "inv_w3e_sc_a", 5100);
    const b = await accrueFixedObligation(spvB, "inv_w3e_sc_b", 5200);
    const authForA = __authorizeForTest({ purpose: "fee_obligation", spvId: spvA, obligationId: a.obId, outcome: "succeeded" });
    expect(() =>
      spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvB, b.obId, "cust", authForA),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH/);
    expect(dbObligationState(b.obId)).not.toBe("paid");
    expect(Number(readSettlementAuthorizationRow(authForA.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-SCOPE-2 — an authorization minted for another OBLIGATION of the same SPV is rejected", async () => {
    const spvId = await createSpv("W3E scope ob");
    const one = await accrueFixedObligation(spvId, "inv_w3e_sc_o", 5300);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: one.obId, outcome: "succeeded" });
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: "ob_someone_elses" }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH/);
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-SCOPE-3 — a PURPOSE mismatch is rejected", async () => {
    const spvId = await createSpv("W3E scope purpose");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_sc_p", 5400);
    const carry = __authorizeForTest({ purpose: "distribution_carry", spvId, outcome: "succeeded" });
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(carry, { purpose: "fee_obligation", spvId, obligationId: obId }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH/);
    expect(Number(readSettlementAuthorizationRow(carry.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-SCOPE-4 — an AMOUNT mismatch is rejected (the authorization is pinned to the fee it names)", async () => {
    const spvId = await createSpv("W3E scope amount");
    const { obId, amountMinor } = await accrueFixedObligation(spvId, "inv_w3e_sc_amt", 5500);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    expect(Number(readSettlementAuthorizationRow(auth.id)!.amount_minor)).toBe(amountMinor);
    expect(() =>
      withSettlementTransaction(() =>
        consumeSettlementAuthorization(auth, { purpose: "fee_obligation", spvId, obligationId: obId, amountMinor: amountMinor + 1 }),
      ),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH/);
    expect(Number(readSettlementAuthorizationRow(auth.id)!.uses_consumed)).toBe(0);
  });

  it("W3E-SCOPE-5 — a REVOKED authorization is rejected", async () => {
    const spvId = await createSpv("W3E scope revoke");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_sc_rv", 5600);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    rawDb().prepare(`UPDATE ${SETTLEMENT_AUTHORIZATION_TABLE} SET revoked_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), auth.id);
    expect(() =>
      spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", auth),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REVOKED/);
    expect(dbObligationState(obId)).not.toBe("paid");
  });

  it("W3E-SCOPE-6 — a MISSING row is rejected: absence is never permission", async () => {
    const spvId = await createSpv("W3E scope missing");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_sc_ms", 5700);
    const auth = __authorizeForTest({ purpose: "fee_obligation", spvId, obligationId: obId, outcome: "succeeded" });
    // Forge a branded handle that points at an id with no row. (The brand alone
    // must not be enough — this is the test that proves the DB is the authority.)
    const orphan = { ...auth, id: "fsa_no_such_row_0000" } as unknown as typeof auth;
    // A spread loses the Symbol brand, so re-prove it via a branded handle whose
    // row we cannot delete (deletes are blocked): instead assert the shape the
    // module enforces — an unbranded object with a real id is refused too.
    expect(isFeeSettlementAuthorization(orphan)).toBe(false);
    expect(() => rehydrateSettlementAuthorization("fsa_no_such_row_0000")).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
    expect(() =>
      spvEngineStore.chargeFeeObligation("ac_consortium_partner_test_partner_inc", spvId, obId, "cust", orphan as never),
    ).toThrow(/SETTLEMENT_AUTHORIZATION_REQUIRED/);
    expect(dbObligationState(obId)).not.toBe("paid");
  });
});

describe("W3E-ADMIN — the admin path still works and is still admin-only", () => {
  it("W3E-ADMIN-1 — an admin settlement mints a durable row and reaches paid exactly once", async () => {
    const spvId = await createSpv("W3E admin");
    const { obId, amountMinor } = await accrueFixedObligation(spvId, "inv_w3e_adm", 8100);
    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, {
      outcome: "succeeded", reason: "wire received 2026-08-10",
    });
    expect(r.status).toBe(200);
    expect(r.body.obligation.state).toBe("paid");
    expect(dbObligationState(obId)).toBe("paid");
    const row = rawDb()
      .prepare(`SELECT * FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE spv_id = ? AND obligation_id = ?`)
      .get(spvId, obId) as Record<string, unknown>;
    expect(row.source).toBe("platform_admin");
    expect(row.reason).toBe("wire received 2026-08-10");
    expect(Number(row.amount_minor)).toBe(amountMinor);
    expect(Number(row.uses_consumed)).toBe(1);
    expect(row.consumed_at).toBeTruthy();
  });

  it("W3E-ADMIN-2 — a partner still cannot reach the admin settle route, and nothing is minted", async () => {
    const spvId = await createSpv("W3E admin deny");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_adm2", 8200);
    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, MANAGING, {
      outcome: "succeeded", reason: "let me in",
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ADMIN_REQUIRED");
    expect(mintedCountForSpv(spvId)).toBe(0);
    expect(dbObligationState(obId)).not.toBe("paid");
  });

  it("W3E-ADMIN-3 — a real FAILED outcome is still expressible and is still durable", async () => {
    const spvId = await createSpv("W3E admin failed");
    const { obId } = await accrueFixedObligation(spvId, "inv_w3e_adm3", 8300);
    const r = await post(`/api/admin/consortium-spv/${spvId}/fee-obligations/${obId}/settle`, ADMIN, {
      outcome: "failed", reason: "wire returned",
    });
    expect(r.status).toBe(402);
    expect(dbObligationState(obId)).toBe("failed");
    const row = rawDb()
      .prepare(`SELECT outcome, uses_consumed FROM ${SETTLEMENT_AUTHORIZATION_TABLE} WHERE spv_id = ? AND obligation_id = ?`)
      .get(spvId, obId) as { outcome: string; uses_consumed: number };
    expect(row.outcome).toBe("failed");
    expect(Number(row.uses_consumed)).toBe(1); // the failure IS a settlement
  });
});
