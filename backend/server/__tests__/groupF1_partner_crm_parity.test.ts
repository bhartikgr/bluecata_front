/**
 * GROUP F1 — Partner CRM full-parity + full-connection tests (migration 0106).
 *
 * Real-route coverage over the EXISTING partner_crm_contacts table + CP-008
 * chain (the `/api/partner/me/crm/contacts` surface expanded in place — NO
 * second table, NO forked chain):
 *   - contact CRUD (Rule #13 first+last on create)
 *   - per-partner email dedup (409 within a partner; SAME email allowed across
 *     DIFFERENT partners)
 *   - from-source import: partner-scoped ownership (cross-partner spv → 404),
 *     idempotent by (partner_id,email)
 *   - connection reads are partner-scoped (no cross-partner leak) and the
 *     Collective linkage is EMAIL-derived only — a client-supplied
 *     contact_user_id can NEVER drive it (fail-closed spoof guard)
 *   - CP-008 hash-chain continuity across create + parity mutations (star)
 *   - migration 0106 additivity + idempotency
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { spvs as spvsTable } from "../../shared/schema";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

const PARTNER_B = "ac_consortium_partner_f1_partner_b";
const MANAGING_B = "u_f1_partner_b_managing";

const SPV_A = "spv_f1_owned_by_a";

let app: Express;
let server: http.Server;
let port: number;

function stampSignedAgreement(partnerId: string, legalName: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at`,
    )
    .run(partnerId, legalName, now, now, "0".repeat(64), "0".repeat(64), now);
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  // Second, fully-active partner for cross-partner isolation tests.
  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "F1 PARTNER B, INC",
    displayName: "F1 PARTNER B",
    email: "ops@f1-partner-b.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });
  stampSignedAgreement(PARTNER_B, "F1 PARTNER B, INC");
  // requirePartnerAuth resolves identity via getUserContext → a durable
  // credential. Register one so MANAGING_B authenticates through real routes.
  storeCredential({
    userId: MANAGING_B,
    email: "managing-b@f1-partner-b.example",
    name: "F1 B Managing",
    password: "test-password-f1-b",
  });

  // An SPV owned by PARTNER_A (for from-source ownership tests). Inserted raw
  // (bypassing routes) — the route under test only reads (id, partner_id).
  const now = new Date().toISOString();
  getDb()
    .insert(spvsTable)
    .values({
      id: SPV_A,
      tenantId: `tenant_partner_${PARTNER_A}`,
      partnerId: PARTNER_A,
      name: "F1 Owned SPV",
      structureType: "spv",
      status: "fundraising",
      targetMinor: 100_000_00,
      committedMinor: 0,
      calledMinor: 0,
      distributedMinor: 0,
      terms: "{}",
      prevHash: null,
      currHash: "",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    } as any)
    .run();

  // A Collective member (users row + active chapter membership) for the
  // email-derived Collective linkage + spoof-guard tests.
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, avatar_url)
       VALUES ('u_f1_collab', 'tenant_platform', 'collab@f1.example', 'F1 Collab', 'user', NULL)`,
    )
    .run();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
       VALUES ('cm_f1_collab', 'tenant_chap_keiretsu_canada', 'chap_keiretsu_canada',
               'u_f1_collab', 'member', 'active', ?, ?)`,
    )
    .run(now, now);

  await hydratePartnerWorkspaceV19Store();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
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
          let b: any = null;
          try { b = JSON.parse(buf); } catch { /* keep */ }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const ME = "/api/partner/me/crm/contacts";

describe("GROUP F1 — partner CRM parity + connections (real routes)", () => {
  /* ===================== 1. Create (Rule #13) ===================== */

  let createdId = "";

  it("POST creates a contact with first + last name (Rule #13)", async () => {
    const r = await call("POST", ME, {
      userId: MANAGING_A,
      body: { first_name: "Ada", last_name: "Lovelace", email: "ada@f1.example", org: "Analytical" },
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.contact.id).toMatch(/^pcc_/);
    expect(r.body.contact.name).toBe("Ada Lovelace");
    expect(r.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
    createdId = r.body.contact.id;
  });

  it("POST rejects a missing last name with 400 (Rule #13)", async () => {
    const r = await call("POST", ME, {
      userId: MANAGING_A,
      body: { first_name: "Grace", email: "grace@f1.example" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_BODY");
  });

  it("GET list returns the created contact for its owner", async () => {
    const r = await call("GET", ME, { userId: MANAGING_A });
    expect(r.status).toBe(200);
    expect(r.body.contacts.some((c: any) => c.id === createdId)).toBe(true);
  });

  it("GET detail returns the contact + a connections object", async () => {
    const r = await call("GET", `${ME}/${createdId}`, { userId: MANAGING_A });
    expect(r.status).toBe(200);
    expect(r.body.contact.id).toBe(createdId);
    expect(r.body.connections).toBeTruthy();
    expect(Array.isArray(r.body.connections.spvLpMemberships)).toBe(true);
    expect(Array.isArray(r.body.connections.capTableHoldings)).toBe(true);
    expect(Array.isArray(r.body.connections.portfolio)).toBe(true);
  });

  it("PATCH updates the contact and extends the chain", async () => {
    const before = await call("GET", `${ME}/${createdId}`, { userId: MANAGING_A });
    const r = await call("PATCH", `${ME}/${createdId}`, {
      userId: MANAGING_A,
      body: { org: "Analytical Engine Co" },
    });
    expect(r.status).toBe(200);
    expect(r.body.contact.org).toBe("Analytical Engine Co");
    expect(r.body.contact.currHash).not.toBe(before.body.contact.currHash);
  });

  /* ===================== 2. Per-partner dedup ===================== */

  it("POST a duplicate email within the SAME partner → 409", async () => {
    const r = await call("POST", ME, {
      userId: MANAGING_A,
      body: { first_name: "Ada", last_name: "Twin", email: "ada@f1.example" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
    expect(r.body.existingId).toBe(createdId);
  });

  it("POST the SAME email under a DIFFERENT partner is allowed → 201", async () => {
    const r = await call("POST", ME, {
      userId: MANAGING_B,
      body: { first_name: "Ada", last_name: "Lovelace", email: "ada@f1.example" },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.id).not.toBe(createdId);
  });

  /* ===================== 3. from-source partner-scoping ===================== */

  it("from-source creates a contact when the SPV belongs to the caller → 201", async () => {
    const r = await call("POST", `${ME}/from-source`, {
      userId: MANAGING_A,
      body: {
        source_kind: "spv_lp",
        source_ref: SPV_A,
        identity: { email: "lp1@f1.example", name: "LP One" },
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.sourceKind).toBe("spv_lp");
    expect(r.body.contact.sourceRef).toBe(SPV_A);
  });

  it("from-source is idempotent by (partner,email) → 200 existing", async () => {
    const r = await call("POST", `${ME}/from-source`, {
      userId: MANAGING_A,
      body: {
        source_kind: "spv_lp",
        source_ref: SPV_A,
        identity: { email: "lp1@f1.example", name: "LP One" },
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.existing).toBe(true);
  });

  it("from-source against ANOTHER partner's SPV → 404 (ownership check)", async () => {
    const r = await call("POST", `${ME}/from-source`, {
      userId: MANAGING_B, // partner B does NOT own SPV_A
      body: {
        source_kind: "spv_lp",
        source_ref: SPV_A,
        identity: { email: "lp-b@f1.example", name: "LP B" },
      },
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("source_not_found");
  });

  /* ===================== 4. Cross-partner isolation ===================== */

  it("cross-partner detail read → 404 (no leak of partner A's contact to B)", async () => {
    const r = await call("GET", `${ME}/${createdId}`, { userId: MANAGING_B });
    expect(r.status).toBe(404);
  });

  it("partner B's list never contains partner A's contact", async () => {
    const r = await call("GET", ME, { userId: MANAGING_B });
    expect(r.status).toBe(200);
    expect(r.body.contacts.every((c: any) => c.id !== createdId)).toBe(true);
  });

  /* ===================== 5. Collective spoof guard ===================== */

  it("Collective linkage is EMAIL-derived; a client-supplied contact_user_id cannot spoof it", async () => {
    // Contact carries a REAL collective member's userId in contact_user_id, but
    // an email that does NOT resolve to that (or any) user. The connection read
    // must ignore the client id → collectiveMembership null.
    const spoof = await call("POST", ME, {
      userId: MANAGING_A,
      body: {
        first_name: "Spoof",
        last_name: "Attempt",
        email: "not-a-real-user@f1.example",
        contact_user_id: "u_f1_collab",
      },
    });
    expect(spoof.status).toBe(201);
    const detail = await call("GET", `${ME}/${spoof.body.contact.id}`, { userId: MANAGING_A });
    expect(detail.status).toBe(200);
    expect(detail.body.connections.resolvedUserId).toBeNull();
    expect(detail.body.connections.collectiveMembership).toBeNull();
  });

  it("Collective linkage resolves when the contact EMAIL matches a member", async () => {
    const real = await call("POST", ME, {
      userId: MANAGING_A,
      body: { first_name: "Real", last_name: "Collab", email: "collab@f1.example" },
    });
    expect(real.status).toBe(201);
    const detail = await call("GET", `${ME}/${real.body.contact.id}`, { userId: MANAGING_A });
    expect(detail.status).toBe(200);
    expect(detail.body.connections.resolvedUserId).toBe("u_f1_collab");
    expect(detail.body.connections.collectiveMembership).toBeTruthy();
    expect(detail.body.connections.collectiveMembership.status).toBe("active");
  });

  /* ===================== 6. Chain continuity across parity mutations ===================== */

  it("consecutive creates chain (prev = previous tip) and star extends the chain", async () => {
    const c1 = await call("POST", ME, {
      userId: MANAGING_B,
      body: { first_name: "Chain", last_name: "One", email: "chain1-b@f1.example" },
    });
    const c2 = await call("POST", ME, {
      userId: MANAGING_B,
      body: { first_name: "Chain", last_name: "Two", email: "chain2-b@f1.example" },
    });
    expect(c1.status).toBe(201);
    expect(c2.status).toBe(201);
    expect(c2.body.contact.prevHash).toBe(c1.body.contact.currHash);

    const star = await call("POST", `${ME}/${c2.body.contact.id}/star`, {
      userId: MANAGING_B,
      body: { starred: true },
    });
    expect(star.status).toBe(200);
    expect(star.body.contact.starred).toBe(true);
    expect(star.body.contact.currHash).not.toBe(c2.body.contact.currHash);
    expect(star.body.contact.prevHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("notes + tasks parity mutations succeed and extend the chain", async () => {
    const note = await call("POST", `${ME}/${createdId}/notes`, {
      userId: MANAGING_A,
      body: { body: "Followed up by email." },
    });
    expect(note.status).toBe(201);
    expect(note.body.note.body).toBe("Followed up by email.");
    expect(note.body.contact.noteLog.length).toBeGreaterThanOrEqual(1);

    const task = await call("POST", `${ME}/${createdId}/tasks`, {
      userId: MANAGING_A,
      body: { title: "Send deck", priority: "high" },
    });
    expect(task.status).toBe(201);
    expect(task.body.task.title).toBe("Send deck");
    expect(task.body.contact.tasks.length).toBeGreaterThanOrEqual(1);
  });

  /* ===================== 7. Soft delete ===================== */

  it("DELETE soft-deletes and removes the contact from the list", async () => {
    const del = await call("DELETE", `${ME}/${createdId}`, { userId: MANAGING_A });
    expect(del.status).toBe(200);
    expect(del.body.contact.deletedAt).toBeTruthy();
    const list = await call("GET", ME, { userId: MANAGING_A });
    expect(list.body.contacts.every((c: any) => c.id !== createdId)).toBe(true);
  });

  /* ===================== 8. Auth gate ===================== */

  it("unauthenticated write is rejected (401/403)", async () => {
    const r = await call("POST", ME, {
      body: { first_name: "No", last_name: "Auth" },
    });
    expect([401, 403]).toContain(r.status);
  });

  /* ===================== 9. Migration 0106 additivity + idempotency ===================== */

  it("migration 0106 parity columns exist and re-adding a column is an idempotent no-op error", () => {
    const cols = (rawDb().prepare(`PRAGMA table_info(partner_crm_contacts)`).all() as any[]).map(
      (c) => c.name as string,
    );
    for (const c of ["stage", "company_id", "note_log", "tasks", "starred", "source_kind", "source_ref"]) {
      expect(cols).toContain(c);
    }
    // Re-running an additive ALTER raises "duplicate column name" — the exact
    // error class the migrate runner's isIdempotentSqliteError swallows.
    expect(() =>
      rawDb().prepare(`ALTER TABLE partner_crm_contacts ADD COLUMN stage TEXT`).run(),
    ).toThrow(/duplicate column name/i);
  });
});
