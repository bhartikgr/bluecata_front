/**
 * WAVE 33 · CP-PIPE-10 — the LOCK 1 SINK, EXECUTED.
 *
 * WHY THIS FILE EXISTS. The first mutation pass over this item left M10 alive:
 * replacing the bound `lock1.coWrite.sourcedFromPartnerAttributionId` with
 * `null` in the INSERT — i.e. writing the partner id and leaving the
 * attribution column empty, which is EXACTLY the state LOCK 1 exists to
 * prevent — survived every assertion in the main harness. That harness proved
 * the rule REFUSES correctly and proved the INSERT mentions both columns; it
 * never once read the row that was actually written.
 *
 * A source scan cannot see what a prepared statement binds. Only the row can.
 *
 * COVERAGE GAP, not an equivalent mutant: the mutated code changes durable
 * state (a soft circle with half its provenance) that nothing observed.
 *
 * Establishes its own preconditions. Never reads `process.env`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const ADMIN_USER = "u_pipe10_sink_admin";
const CURRENT: { userId: string | null; isAdmin: boolean } = { userId: ADMIN_USER, isAdmin: true };

vi.mock("../lib/userContext", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: CURRENT.userId !== null,
      isAdmin: CURRENT.isAdmin,
      userId: CURRENT.userId,
      roles: [],
    }),
  };
});

import { registerPartnerConsortiumRoutes } from "../partnerConsortiumRoutes";
import { partnerAttributionStore } from "../partnerWorkspaceStore";
import { getCompanyRecordById } from "../multiCompanyStore";
import { rawDb } from "../db/connection";

const PARTNER_WITH_ATTR = "ac_pipe10_sink_with_attr";
const PARTNER_NO_ATTR = "ac_pipe10_sink_no_attr";
/** Attributed, but NOT registered as a partner organisation — today's platform-wide state. */
const PARTNER_UNREGISTERED = "ac_pipe10_sink_unregistered";
const COMPANY = "co_novapay";

let app: Express;

/**
 * Register a partner organisation.
 *
 * THE TEST OWNS THIS FIXTURE, and that fact is itself the finding: nothing in
 * the server writes `partner_organizations`, so the FK behind
 * `soft_circles.sourced_from_partner_id` has no populated parent anywhere —
 * live `data.db`, the seeded test DB and the demo sandbox all hold zero rows.
 * Case W6 asserts the refusal that state produces; W1 has to create the parent
 * itself to reach the happy path at all.
 */
function registerPartnerOrg(id: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, id, `Fixture org ${id}`, now, now);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerConsortiumRoutes(app);
  partnerAttributionStore.create(PARTNER_WITH_ATTR, COMPANY, ADMIN_USER, "admin_manual", null);
  partnerAttributionStore.create(PARTNER_UNREGISTERED, COMPANY, ADMIN_USER, "admin_manual", null);
  registerPartnerOrg(PARTNER_WITH_ATTR);
});

function rowsFor(partnerId: string) {
  return rawDb()
    .prepare(
      `SELECT id, amount, amount_minor, currency, source_type, source_id,
              sourced_from_partner_id, sourced_from_partner_attribution_id
         FROM soft_circles WHERE source_id = ?`,
    )
    .all(partnerId) as Array<{
    id: string;
    amount: number | string | null;
    amount_minor: number;
    currency: string;
    source_type: string;
    source_id: string;
    sourced_from_partner_id: string | null;
    sourced_from_partner_attribution_id: string | null;
  }>;
}

/* ── (F) FIXTURES — asserted, never assumed ───────────────────────────────── */

describe("F — the preconditions this file's conclusions rest on", () => {
  it("F1 the company the route demands really exists", () => {
    // If it did not, every POST would 404 and every "no row was written"
    // assertion below would pass for the wrong reason.
    expect(getCompanyRecordById(COMPANY)).toBeTruthy();
  });

  it("F2 the attribution fixtures landed, and the unattributed partner really has none", () => {
    const holders = partnerAttributionStore.listActiveByCompany(COMPANY).map((a) => a.partnerId);
    expect(holders).toContain(PARTNER_WITH_ATTR);
    expect(holders).toContain(PARTNER_UNREGISTERED);
    expect(holders).not.toContain(PARTNER_NO_ATTR);
  });

  it("F3 exactly one of them is a REGISTERED partner organisation", () => {
    const has = (id: string) =>
      ((rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM partner_organizations WHERE id = ?`)
        .get(id) as { n: number }).n) > 0;
    expect(has(PARTNER_WITH_ATTR)).toBe(true);
    expect(has(PARTNER_UNREGISTERED)).toBe(false);
  });
});

/* ── (W) THE WRITE ────────────────────────────────────────────────────────── */

describe("W — LOCK 1 at the only writer of a partner-sourced soft circle", () => {
  it("W1 an attributed partner's row is written with BOTH provenance columns (kills M10)", async () => {
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const r = await request(app).post("/api/partner/me/soft-circles/source").send({
      partnerId: PARTNER_WITH_ATTR,
      amountMinor: 250000,
      currency: "USD",
      status: "funded",
      companyId: COMPANY,
    });
    expect(r.status).toBe(201);

    const rows = rowsFor(PARTNER_WITH_ATTR);
    expect(rows.length).toBe(1);
    const row = rows[0];
    // THE POINT OF THIS FILE: the row itself, not the statement that wrote it.
    expect(row.sourced_from_partner_id).toBe(PARTNER_WITH_ATTR);
    expect(row.sourced_from_partner_attribution_id).toBeTruthy();
    // …and it is the RIGHT attribution, not merely a non-null string.
    const live = partnerAttributionStore
      .listActiveByCompany(COMPANY)
      .find((a) => a.partnerId === PARTNER_WITH_ATTR);
    expect(row.sourced_from_partner_attribution_id).toBe(live!.id);
    // The response reports the same pair it wrote.
    expect(r.body.provenance).toEqual({
      sourcedFromPartnerId: PARTNER_WITH_ATTR,
      sourcedFromPartnerAttributionId: live!.id,
    });
  });

  it("W2 the money column is exponent-driven, not amountMinor/100 (kills M11 at the row)", async () => {
    const row = rowsFor(PARTNER_WITH_ATTR)[0];
    expect(row.amount_minor).toBe(250000);
    // USD exponent 2 → 2500. Asserted as a number so a string-vs-number change
    // in the write would also be caught.
    expect(Number(row.amount)).toBe(2500);
  });

  it("W3 an UNATTRIBUTED partner is refused 409 and NO row exists — fail closed", async () => {
    const r = await request(app).post("/api/partner/me/soft-circles/source").send({
      partnerId: PARTNER_NO_ATTR,
      amountMinor: 250000,
      currency: "USD",
      status: "funded",
      companyId: COMPANY,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LOCK1_ATTRIBUTION_MISSING");
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message.length).toBeGreaterThan(60);
    // The refusal happens BEFORE any row exists, proved by the absence of one.
    expect(rowsFor(PARTNER_NO_ATTR)).toEqual([]);
  });

  it("W4 a REVOKED attribution cannot source a deal, and the write is undone by nothing", async () => {
    const p = "ac_pipe10_sink_revoked";
    const a = partnerAttributionStore.create(p, COMPANY, ADMIN_USER, "admin_manual", null);
    partnerAttributionStore.revoke(p, a.companyId, ADMIN_USER);
    const r = await request(app).post("/api/partner/me/soft-circles/source").send({
      partnerId: p,
      amountMinor: 100,
      currency: "USD",
      status: "funded",
      companyId: COMPANY,
    });
    expect(r.status).toBe(409);
    expect(rowsFor(p)).toEqual([]);
  });

  it("W6 an ATTRIBUTED but UNREGISTERED partner is a stated 409, never a 500 (found by execution)", async () => {
    /* The defect this file existed to catch. The co-write was correct and the
       write was impossible: the FK parent `partner_organizations` is empty
       platform-wide, so the first honoured LOCK 1 raised
       `FOREIGN KEY constraint failed` and the route answered
       SOURCE_SC_FAILED / 500. Both poles are asserted — W1 is the same request
       differing in exactly one variable, the registration. */
    const r = await request(app).post("/api/partner/me/soft-circles/source").send({
      partnerId: PARTNER_UNREGISTERED,
      amountMinor: 250000,
      currency: "USD",
      status: "funded",
      companyId: COMPANY,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("LOCK1_PROVENANCE_NOT_PERSISTABLE");
    expect(r.body.missing).toBe("partner_organizations");
    expect(r.body.message).toMatch(/has not been created/i);
    // Not a half-write, and not a NULL-provenance downgrade either.
    expect(rowsFor(PARTNER_UNREGISTERED)).toEqual([]);
  });

  it("W5 a non-admin cannot reach the sink at all, in either provenance state", async () => {
    CURRENT.userId = "u_pipe10_not_admin";
    CURRENT.isAdmin = false;
    const r = await request(app).post("/api/partner/me/soft-circles/source").send({
      partnerId: PARTNER_WITH_ATTR,
      amountMinor: 1,
      currency: "USD",
      status: "funded",
      companyId: COMPANY,
    });
    expect(r.status).toBe(403);
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
  });
});
