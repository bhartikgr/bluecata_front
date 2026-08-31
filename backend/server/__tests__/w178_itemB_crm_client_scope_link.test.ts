/**
 * WAVE 178 · ITEM B — "ADD TO CLIENT" LINKS A CRM CONTACT TO A MANAGED CLIENT.
 *
 * ── THE LIVE DEFECT, AND ITS PROVED ROOT CAUSE ──────────────────────────────
 * On the live server, selecting a CRM contact on a managed-client page and
 * clicking "Add to client" failed 100% of the time (reproduced 3×) with the
 * toast "Could not scope contact — Something went wrong on our side. Please try
 * again." The panel kept reading "No CRM contacts are scoped to this client yet."
 *
 * The cause was NOT a missing table, NOT an unimplemented path, and NOT the
 * confidentiality checks refusing. It was a foreign key:
 *
 *     0134: scoped_by_user_id TEXT NOT NULL REFERENCES users(id)
 *
 * with `PRAGMA foreign_keys = ON` on every connection (db/connection.ts:160,
 * db/index.ts:22). The acting partner's session `userId` has no row in `users` —
 * legitimately, because `resolveOrCreateConsortiumPartnerId`
 * (partnerRoutes.ts:122-182) wraps its `auth_users` and `users` inserts in
 * individual `try {} catch { /* best-effort *\/ }` blocks, so a UNIQUE(email)
 * collision under a different id leaves no `users` row while the session still
 * authenticates. The INSERT therefore raised `FOREIGN KEY constraint failed`,
 * which is not `UNIQUE constraint failed`, so the store rethrew it, the route
 * returned a messageless `500 INTERNAL_ERROR`, and queryClient.ts:40 rendered
 * the generic toast.
 *
 * WHY THE EXISTING SUITE NEVER CAUGHT IT: the only test over this store,
 * `wave30_engine1_partner_crm_contact_client_scope.test.ts`, deliberately seeds
 * `users` rows first, and there were ZERO HTTP-level tests for the route. This
 * file closes both gaps — every pole here goes through the REAL express route.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   1 · THE REPRODUCTION, INVERTED. An actor with NO `users` row links a contact
 *       and gets 201. Pole 6 proves this pole fails for the ORIGINAL reason when
 *       the old FK is put back, so it is a real regression detector.
 *   2 · The link PERSISTS: a fresh GET (the refetch a real page performs) lists
 *       the contact and drops it from the "not yet scoped" roster.
 *   3 · Idempotent repeat → 200 `created: false`, not a 500 and not a duplicate.
 *   4 · SCHEMA: `scoped_by_user_id` carries NO `users` FK, while both genuine
 *       relational FKs and the UNIQUE race arbiter are still there.
 *   5 · CONFIDENTIALITY — a partner cannot scope ANOTHER partner's contact.
 *   6 · CONFIDENTIALITY — a partner cannot scope a contact onto a client they do
 *       not manage.
 *   7 · The FK-failure path, if it ever recurs on an unconverged database, gives
 *       a SPECIFIC human-readable reason instead of the generic 500.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerCrmContactClientScopeRoutes } from "../partnerCrmContactClientScopeRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
/* Partner B never authenticates in this file. It exists only to OWN things that
   partner A must be refused. */
const PARTNER_B = "ac_consortium_partner_w178_other_firm";
const ACTOR_A = "u_avi_managing";

const CO_A = "co_w178_client_of_a";
const CO_B = "co_w178_client_of_b";
const CONTACT_A = "w178_contact_of_a";
const CONTACT_B = "w178_contact_of_b";
const NOW = "2026-08-27T00:00:00.000Z";

let app: express.Express;

function insertContact(id: string, partnerId: string, email: string, name: string): void {
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO partner_crm_contacts
         (id, tenant_id, partner_id, email, name, role, org, created_at, updated_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, 'CFO', 'Acme', ?, ?)`,
    )
    .run(id, partnerId, email, name, NOW, NOW);
}

function scopeRowCount(contactId: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM partner_crm_contact_client_scope WHERE partner_crm_contact_id = ?`)
    .get(contactId) as { n: number };
  return r.n;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerCrmContactClientScopeRoutes(app);
  seedTestPartnerSandbox({ force: true });

  partnerAttributionStore.create(PARTNER_A, CO_A, ACTOR_A);
  partnerAttributionStore.create(PARTNER_B, CO_B, "u_w178_other_actor");

  insertContact(CONTACT_A, PARTNER_A, "a@w178.test", "Ada OfA");
  insertContact(CONTACT_B, PARTNER_B, "b@w178.test", "Bob OfB");

  /* ═══ THE CONDITION THE LIVE SERVER WAS IN ═══
     The acting partner's userId must NOT exist in `users`. That is the whole
     defect, so it is asserted rather than assumed — a future seed change that
     starts creating the row would silently disarm pole 1. */
  rawDb().prepare(`DELETE FROM users WHERE id = ?`).run(ACTOR_A);
});

describe("WAVE 178 · ITEM B — CRM contact → managed client link", () => {
  it("POLE 0 — precondition: the acting partner has NO `users` row (this is the live condition)", () => {
    const u = rawDb().prepare(`SELECT id FROM users WHERE id = ?`).get(ACTOR_A);
    expect(u).toBeUndefined();
    /* And foreign keys really are enforced on this connection, so the old FK
       would really have fired. Without this, pole 1 could pass vacuously. */
    const fk = rawDb().prepare(`PRAGMA foreign_keys`).get() as Record<string, number>;
    expect(Object.values(fk)[0]).toBe(1);
  });

  it("POLE 1 — an actor with no `users` row CAN link a contact: 201, not the 500 the live server returned", async () => {
    const res = await request(app)
      .post("/api/partner/me/crm-client-scope")
      .set("x-user-id", ACTOR_A)
      .send({ contactId: CONTACT_A, companyId: CO_A });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(true);
    expect(res.body.row?.contactId ?? res.body.row?.partnerCrmContactId).toBeTruthy();
    /* db-driven, not an in-memory placeholder. */
    expect(scopeRowCount(CONTACT_A)).toBe(1);
  });

  it("POLE 2 — the link PERSISTS across a fresh request: the refetch lists it as scoped, not as scopable", async () => {
    const res = await request(app)
      .get(`/api/partner/me/crm-client-scope/by-company/${CO_A}`)
      .set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    /* Route shape: { ok, companyId, scopes, availableContacts } — see
       partnerCrmContactClientScopeRoutes.ts:92-99. */
    const scopes = (res.body.scopes ?? []) as Array<Record<string, unknown>>;
    expect(scopes.length).toBe(1);
    expect(JSON.stringify(scopes)).toContain(CONTACT_A);
    /* It must leave the picker's roster, or the UI would offer a contact that is
       already linked. */
    const available = (res.body.availableContacts ?? []) as Array<Record<string, unknown>>;
    expect(JSON.stringify(available)).not.toContain(CONTACT_A);
    /* And partner B's contact was never in this partner's roster to begin with. */
    expect(JSON.stringify(res.body)).not.toContain(CONTACT_B);
  });

  it("POLE 3 — a repeat link is idempotent: 200 with created:false and still exactly one row", async () => {
    const res = await request(app)
      .post("/api/partner/me/crm-client-scope")
      .set("x-user-id", ACTOR_A)
      .send({ contactId: CONTACT_A, companyId: CO_A });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.created).toBe(false);
    expect(scopeRowCount(CONTACT_A)).toBe(1);
  });

  it("POLE 4 — SCHEMA: no `users` FK on the actor column; both real FKs and the UNIQUE arbiter intact", () => {
    const row = rawDb()
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_crm_contact_client_scope'`)
      .get() as { sql?: string } | undefined;
    const ddl = String(row?.sql ?? "");
    expect(ddl).not.toBe("");
    /* The defect, stated as a schema assertion. */
    expect(/scoped_by_user_id[^,]*REFERENCES\s+users\s*\(/i.test(ddl)).toBe(false);
    /* NOT NULL is RETAINED — an actor is still mandatory. Dropping the FK does
       not weaken the audit stamp. */
    expect(/scoped_by_user_id\s+TEXT\s+NOT\s+NULL/i.test(ddl)).toBe(true);
    /* The two genuine relational FKs and the race arbiter the store depends on
       at partnerCrmContactClientScopeStore.ts:308 must all survive. */
    expect(ddl).toMatch(/partner_crm_contact_id[^,]*REFERENCES\s+partner_crm_contacts/i);
    expect(ddl).toMatch(/partner_attribution_id[^,]*REFERENCES\s+partner_attributions/i);
    expect(ddl.replace(/\s+/g, " ")).toContain("UNIQUE (partner_crm_contact_id, partner_attribution_id)");
  });

  it("POLE 5 — CONFIDENTIALITY: partner A cannot scope partner B's contact, and nothing is written", async () => {
    const before = scopeRowCount(CONTACT_B);
    const res = await request(app)
      .post("/api/partner/me/crm-client-scope")
      .set("x-user-id", ACTOR_A)
      .send({ contactId: CONTACT_B, companyId: CO_A });
    /* 404, NOT 403 — the deliberate Wave 29 precedent this route documents at
       its own header: the same code answers "not yours" and "absent", so a
       refusal cannot be used to confirm that another firm's contact exists. The
       reason is still SPECIFIC rather than a bare 500. */
    expect(res.status).not.toBe(201);
    expect(res.status).toBe(404);
    expect(String(res.body.message ?? "")).toMatch(/Contact not found for this partner/i);
    expect(String(res.body.message ?? "")).not.toMatch(/Something went wrong on our side/i);
    /* The leak that would matter: no row. */
    expect(scopeRowCount(CONTACT_B)).toBe(before);
    expect(scopeRowCount(CONTACT_B)).toBe(0);
  });

  it("POLE 6 — CONFIDENTIALITY: partner A cannot scope its own contact onto a client it does not manage", async () => {
    const res = await request(app)
      .post("/api/partner/me/crm-client-scope")
      .set("x-user-id", ACTOR_A)
      .send({ contactId: CONTACT_A, companyId: CO_B });
    expect(res.status).not.toBe(201);
    expect(res.status).toBe(404);
    expect(String(res.body.message ?? "")).toMatch(/Client not found or not attributed to your firm/i);
    expect(String(res.body.message ?? "")).not.toMatch(/Something went wrong on our side/i);
    /* CONTACT_A still has exactly its ONE legitimate link to CO_A — the refusal
       neither created a second row nor disturbed the first. */
    expect(scopeRowCount(CONTACT_A)).toBe(1);
    const leaked = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n
           FROM partner_crm_contact_client_scope s
           JOIN partner_attributions a ON a.id = s.partner_attribution_id
          WHERE a.company_id = ?`,
      )
      .get(CO_B) as { n: number };
    expect(leaked.n).toBe(0);
  });

  it("POLE 7 — if the legacy FK is ever back, the refusal is SPECIFIC, not the generic 500", async () => {
    /* This pole does two jobs at once. It proves the new store branch works, AND
       it proves pole 1 is not vacuous: putting the old shape back reproduces the
       live failure through the same route, for the same reason. */
    const db = rawDb();
    db.exec(`
      DROP TABLE IF EXISTS pccs_w178_backup;
      CREATE TABLE pccs_w178_backup AS SELECT * FROM partner_crm_contact_client_scope;
      DROP TABLE partner_crm_contact_client_scope;
      CREATE TABLE partner_crm_contact_client_scope (
        id                       TEXT PRIMARY KEY NOT NULL,
        partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
        partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
        scoped_by_user_id        TEXT NOT NULL REFERENCES users(id),
        scoped_at                TEXT NOT NULL,
        created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        created_by               TEXT,
        UNIQUE (partner_crm_contact_id, partner_attribution_id)
      );
    `);
    try {
      const res = await request(app)
        .post("/api/partner/me/crm-client-scope")
        .set("x-user-id", ACTOR_A)
        .send({ contactId: CONTACT_A, companyId: CO_A });
      /* Before wave 178 this was a messageless 500 that the client rendered as
         "Something went wrong on our side. Please try again." */
      expect(res.status).not.toBe(500);
      expect(res.status).toBe(400);
      const msg = String(res.body.message ?? "");
      expect(msg).toMatch(/user record is not fully provisioned/i);
      expect(msg).toMatch(/Nothing was changed/i);
      expect(msg).not.toMatch(/Something went wrong on our side/i);
      /* And the reason is specific enough to act on: it names the server as the
         problem, not the contact or the client. */
      expect(msg).toMatch(/server configuration issue/i);
    } finally {
      db.exec(`
        DROP TABLE partner_crm_contact_client_scope;
        CREATE TABLE partner_crm_contact_client_scope (
          id                       TEXT PRIMARY KEY NOT NULL,
          partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
          partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
          scoped_by_user_id        TEXT NOT NULL,
          scoped_at                TEXT NOT NULL,
          created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          created_by               TEXT,
          UNIQUE (partner_crm_contact_id, partner_attribution_id)
        );
        INSERT INTO partner_crm_contact_client_scope SELECT * FROM pccs_w178_backup;
        DROP TABLE pccs_w178_backup;
      `);
    }
  });
});
