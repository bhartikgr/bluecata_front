/**
 * WAVE 30 · ENGINE 1 — falsification harness for `partner_crm_contact_client_scope`.
 *
 * ── WHAT WAS ACTUALLY OUTSTANDING, VERIFIED AT SOURCE BEFORE ANY CODE ──────
 * Migration 0134 created the table in Wave C-2.g. `shared/schema.ts` declared it,
 * `server/db/connection.ts`'s inline baseline creates it, and
 * `server/lib/applyWaveC2ClientScopeSchema.ts` self-heals it. A tree-wide grep for
 * the table name (excluding `node_modules`, the built `server/public/assets`
 * bundles and `.g0-snapshot`) returned ONLY: the two mirrored migration copies,
 * the two Drizzle schema files, the self-heal, `connection.ts`, and
 * `w9_migration_mirror_drift.test.ts`. **Zero readers. Zero writers. Zero routes.
 * Zero UI.** Case (0) below re-asserts the schema half of that at RUNTIME so the
 * claim does not rest on a grep that a later refactor could invalidate.
 *
 * ── WHAT EACH CASE ASSERTS, AND WHY BOTH POLES ────────────────────────────
 * The single most common defect in this build is a check that passes while
 * checking nothing (twenty-one recorded instances). The specific traps this file
 * is written against:
 *
 *  1. **A tenant predicate that refuses EVERYONE passes every refusal case.**
 *     Every refusal case here is paired with a positive case proving the SAME
 *     operation succeeds for the rightful partner. Cases (3)/(4), (6)/(7),
 *     (9)/(10) and (12)/(13) are those pairs.
 *  2. **A precondition asserted but not established.** This file SEEDS every
 *     fixture it depends on inside `beforeAll` and asserts the seed landed. It
 *     assumes nothing about what the runner supplies. It touches no env var, so
 *     there is nothing to restore — the one env-restoration hazard this build has
 *     been burned by is avoided by not creating it.
 *  3. **An assertion pattern that matches the wrong error.** Wave 28's case (15)
 *     asserted `/UNIQUE|constraint/i` and was satisfied by a `NOT NULL` error on
 *     every run. Case (8) here asserts on the STORE's typed outcome
 *     (`created === false` plus row identity), not on a message regex at all, so
 *     there is no pattern to be loose about.
 *  4. **Testing anonymity when the control is an AUTHORIZATION gate** (Wave 29's
 *     real find). The store's control is "does this row belong to THIS partner?",
 *     so the adversary here is a REAL, ACTIVE, fully-authenticated SECOND PARTNER
 *     — not an anonymous caller. Cases (3), (6), (9) and (12) all run as partner B
 *     against partner A's data.
 *
 * ── 404, NOT 403 ───────────────────────────────────────────────────────────
 * Case (5) asserts that partner B's refusal for partner A's contact id is
 * INDISTINGUISHABLE from the refusal for an id that does not exist anywhere. That
 * is the whole point of the 404 choice (Wave 29 precedent): a 403 would confirm
 * the id exists and turn the status code into an enumeration oracle over other
 * firms' CRM records. Asserting "it is a 404" is weak; asserting "the two answers
 * are identical" is the property that actually matters.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import {
  listScopesForCompany,
  listScopesForContact,
  listScopableContacts,
  scopeContactToClient,
  unscopeContactFromClient,
  scopeCountsByContact,
  resolveLiveAttributionId,
  contactBelongsToPartner,
  attributionBelongsToPartner,
  ScopeNotFoundError,
  ScopeValidationError,
} from "../partnerCrmContactClientScopeStore";

/* Fixture ids are namespaced `w30e1_` so they cannot collide with any seeded
   platform data, and so a failed run leaves obviously-attributable rows behind. */
const P_A = "w30e1_partner_a";
const P_B = "w30e1_partner_b";
const U_A = "w30e1_user_a";
const U_B = "w30e1_user_b";
const CO_A = "w30e1_company_a"; // attributed to partner A
const CO_B = "w30e1_company_b"; // attributed to partner B
const CO_REVOKED = "w30e1_company_revoked"; // partner A's attribution, REVOKED
const C_A1 = "w30e1_contact_a1";
const C_A2 = "w30e1_contact_a2";
const C_B1 = "w30e1_contact_b1";
const ATTR_A = "w30e1_attr_a";
const ATTR_B = "w30e1_attr_b";
const ATTR_REVOKED = "w30e1_attr_revoked";
const ABSENT = "w30e1_this_id_does_not_exist_anywhere";

const NOW = "2026-08-11T00:00:00.000Z";

function seed(): void {
  const db = rawDb();
  /* users — `scoped_by_user_id` carries a real FK to users(id) and
     `PRAGMA foreign_keys` is ON (connection.ts:125), so an unseeded actor would
     fail the INSERT for the wrong reason and every write case would be testing
     the FK rather than the engine. */
  const insUser = db.prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, 'tenant_platform', ?, ?, 'partner', 0)`,
  );
  insUser.run(U_A, "a@w30e1.test", "Partner A Operator");
  insUser.run(U_B, "b@w30e1.test", "Partner B Operator");

  const insContact = db.prepare(
    `INSERT OR IGNORE INTO partner_crm_contacts
       (id, tenant_id, partner_id, email, name, role, org, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, ?)`,
  );
  insContact.run(C_A1, P_A, "c-a1@w30e1.test", "Ada Contact", "CFO", "Acme", NOW, NOW);
  insContact.run(C_A2, P_A, "c-a2@w30e1.test", "Bo Contact", "COO", "Acme", NOW, NOW);
  insContact.run(C_B1, P_B, "c-b1@w30e1.test", "Cy Contact", "CTO", "Beta", NOW, NOW);

  const insAttr = db.prepare(
    `INSERT OR IGNORE INTO partner_attributions
       (id, partner_id, company_id, attributed_at, attribution_source, updated_at, revoked_at)
     VALUES (?, ?, ?, ?, 'admin_manual', ?, ?)`,
  );
  insAttr.run(ATTR_A, P_A, CO_A, NOW, NOW, null);
  insAttr.run(ATTR_B, P_B, CO_B, NOW, NOW, null);
  // A REVOKED attribution for partner A — the live-row grain must exclude it.
  insAttr.run(ATTR_REVOKED, P_A, CO_REVOKED, NOW, NOW, NOW);
}

beforeAll(() => {
  seed();
  /* The seed is ASSERTED, not assumed. If any of this failed silently, every
     later case would pass vacuously against an empty fixture. */
  const db = rawDb();
  const n = (sql: string, ...a: unknown[]) =>
    Number((db.prepare(sql).get(...a) as { n: number }).n);
  expect(n(`SELECT COUNT(*) n FROM partner_crm_contacts WHERE partner_id = ?`, P_A)).toBe(2);
  expect(n(`SELECT COUNT(*) n FROM partner_crm_contacts WHERE partner_id = ?`, P_B)).toBe(1);
  expect(n(`SELECT COUNT(*) n FROM partner_attributions WHERE partner_id = ?`, P_A)).toBe(2);
  expect(n(`SELECT COUNT(*) n FROM partner_attributions WHERE partner_id = ?`, P_B)).toBe(1);
});

describe("WAVE 30 ENGINE 1 — CONTROL: the schema really is there and the fixture really has two partners", () => {
  it("(0) the table, its UNIQUE constraint and idx_pccs_attribution all exist at RUNTIME", () => {
    const db = rawDb();
    const tbl = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='partner_crm_contact_client_scope'`)
      .get() as { sql?: string } | undefined;
    expect(tbl?.sql, "the 0134 table must exist in the running database").toBeTruthy();
    // Assert the UNIQUE constraint by its DEFINITION, not by mere presence —
    // Wave 28 case (15) branched on presence and was wrong for two waves.
    expect(String(tbl!.sql).replace(/\s+/g, " ")).toMatch(
      /UNIQUE \(partner_crm_contact_id, partner_attribution_id\)/i,
    );
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pccs_attribution'`)
      .get();
    expect(idx, "the reverse-lookup index the store's by-contact read relies on").toBeTruthy();
  });

  it("(1) CONTROL — both partners are real and distinct, and each side's ownership helper agrees", () => {
    expect(contactBelongsToPartner(P_A, C_A1)).toBe(true);
    expect(contactBelongsToPartner(P_B, C_B1)).toBe(true);
    // The cross-pairs are the whole tenant boundary in one line each.
    expect(contactBelongsToPartner(P_B, C_A1)).toBe(false);
    expect(contactBelongsToPartner(P_A, C_B1)).toBe(false);
    expect(attributionBelongsToPartner(P_A, ATTR_A)).toBe(true);
    expect(attributionBelongsToPartner(P_B, ATTR_A)).toBe(false);
  });

  it("(2) a REVOKED attribution is not a live client — the store must not resolve it", () => {
    // Without this, a firm could scope contacts onto a client relationship the
    // rest of the platform already considers ended.
    expect(resolveLiveAttributionId(P_A, CO_A)).toBe(ATTR_A);
    expect(resolveLiveAttributionId(P_A, CO_REVOKED)).toBeNull();
    expect(attributionBelongsToPartner(P_A, ATTR_REVOKED)).toBe(false);
  });
});

describe("WAVE 30 ENGINE 1 — the write path, both poles", () => {
  it("(3) THE POSITIVE POLE — partner A can scope its own contact onto its own client", () => {
    const { row, created } = scopeContactToClient({
      partnerId: P_A,
      contactId: C_A1,
      companyId: CO_A,
      actorUserId: U_A,
    });
    expect(created).toBe(true);
    expect(row.partnerCrmContactId).toBe(C_A1);
    expect(row.partnerAttributionId).toBe(ATTR_A);
    expect(row.companyId).toBe(CO_A);
    expect(row.scopedByUserId).toBe(U_A);
    // The joined display fields must actually be joined, not null — the UI
    // renders these instead of raw ids.
    expect(row.contactName).toBe("Ada Contact");
    expect(row.contactEmail).toBe("c-a1@w30e1.test");
    // created_at must come from the DDL DEFAULT, not be left null.
    expect(row.createdAt).toBeTruthy();
  });

  it("(4) and the row is actually IN THE DATABASE — not merely returned by the function", () => {
    // Fix-where-the-data-flows: name the sink and prove the change is on it BY
    // EXECUTION. The sink is the table, so read the table directly.
    const n = Number(
      (
        rawDb()
          .prepare(
            `SELECT COUNT(*) n FROM partner_crm_contact_client_scope
              WHERE partner_crm_contact_id = ? AND partner_attribution_id = ?`,
          )
          .get(C_A1, ATTR_A) as { n: number }
      ).n,
    );
    expect(n).toBe(1);
  });

  it("(5) THE ADVERSARY IS A REAL SECOND PARTNER — B cannot scope A's contact, and the refusal is indistinguishable from a nonexistent id", () => {
    // The control here is AUTHORIZATION, not authentication (Wave 29's lesson):
    // partner B is fully authenticated and fully legitimate. It is simply not A.
    let crossTenantMessage = "";
    let absentMessage = "";
    expect(() =>
      scopeContactToClient({ partnerId: P_B, contactId: C_A1, companyId: CO_A, actorUserId: U_B }),
    ).toThrow(ScopeNotFoundError);
    try {
      scopeContactToClient({ partnerId: P_B, contactId: C_A1, companyId: CO_A, actorUserId: U_B });
    } catch (e) {
      crossTenantMessage = (e as Error).message;
    }
    try {
      scopeContactToClient({ partnerId: P_B, contactId: ABSENT, companyId: CO_A, actorUserId: U_B });
    } catch (e) {
      absentMessage = (e as Error).message;
    }
    // THIS is the enumeration-oracle property, and it is stronger than "it 404s":
    // an id that exists elsewhere and an id that exists nowhere must produce the
    // SAME answer, or the difference itself leaks existence.
    expect(crossTenantMessage).toBe(absentMessage);
    expect(crossTenantMessage).toBeTruthy();
    // And nothing was written by the refused attempt.
    const n = Number(
      (
        rawDb()
          .prepare(`SELECT COUNT(*) n FROM partner_crm_contact_client_scope WHERE scoped_by_user_id = ?`)
          .get(U_B) as { n: number }
      ).n,
    );
    expect(n).toBe(0);
  });

  it("(6) partner A cannot scope its own contact onto ANOTHER partner's client either", () => {
    // The other half of the join. A gate that only checked the contact side would
    // sail through case (5) and fail here.
    expect(() =>
      scopeContactToClient({ partnerId: P_A, contactId: C_A1, companyId: CO_B, actorUserId: U_A }),
    ).toThrow(ScopeNotFoundError);
  });

  it("(7) and cannot scope onto its OWN but REVOKED client", () => {
    expect(() =>
      scopeContactToClient({
        partnerId: P_A,
        contactId: C_A1,
        companyId: CO_REVOKED,
        actorUserId: U_A,
      }),
    ).toThrow(ScopeNotFoundError);
  });

  it("(8) IDEMPOTENT — a repeat scope returns the SAME row with created:false, and does not duplicate", () => {
    // Asserted on the store's typed outcome, deliberately NOT on an error-message
    // regex: Wave 28's `/UNIQUE|constraint/i` happily matched a NOT NULL error.
    const first = scopeContactToClient({
      partnerId: P_A,
      contactId: C_A1,
      companyId: CO_A,
      actorUserId: U_A,
    });
    expect(first.created).toBe(false);
    const n = Number(
      (
        rawDb()
          .prepare(
            `SELECT COUNT(*) n FROM partner_crm_contact_client_scope
              WHERE partner_crm_contact_id = ? AND partner_attribution_id = ?`,
          )
          .get(C_A1, ATTR_A) as { n: number }
      ).n,
    );
    expect(n).toBe(1);
  });

  it("(9) malformed input is a VALIDATION failure, distinct from a not-found", () => {
    // A store that collapsed every bad input into NotFound would make the route
    // layer return 404 for a client bug, which is unhelpful and hides real errors.
    expect(() =>
      scopeContactToClient({ partnerId: P_A, contactId: "", companyId: CO_A, actorUserId: U_A }),
    ).toThrow(ScopeValidationError);
    expect(() =>
      scopeContactToClient({ partnerId: "", contactId: C_A1, companyId: CO_A, actorUserId: U_A }),
    ).toThrow(ScopeValidationError);
  });
});

describe("WAVE 30 ENGINE 1 — the read paths, both poles", () => {
  beforeAll(() => {
    // A second scope for A, and one for B, so the read cases have something to
    // wrongly include if the tenant predicate is missing.
    scopeContactToClient({ partnerId: P_A, contactId: C_A2, companyId: CO_A, actorUserId: U_A });
    scopeContactToClient({ partnerId: P_B, contactId: C_B1, companyId: CO_B, actorUserId: U_B });
  });

  it("(10) THE POSITIVE POLE — A's by-company read returns exactly A's two scoped contacts", () => {
    const rows = listScopesForCompany(P_A, CO_A);
    expect(rows.map((r) => r.partnerCrmContactId).sort()).toEqual([C_A1, C_A2].sort());
    // and B's row is nowhere in it
    expect(rows.some((r) => r.partnerCrmContactId === C_B1)).toBe(false);
  });

  it("(11) B's own read works too — the predicate scopes, it does not simply refuse", () => {
    const rows = listScopesForCompany(P_B, CO_B);
    expect(rows.map((r) => r.partnerCrmContactId)).toEqual([C_B1]);
  });

  it("(12) B reading A's company is refused, identically to reading a company nobody has", () => {
    let cross = "";
    let absent = "";
    try { listScopesForCompany(P_B, CO_A); } catch (e) { cross = (e as Error).message; }
    try { listScopesForCompany(P_B, ABSENT); } catch (e) { absent = (e as Error).message; }
    expect(cross).toBe(absent);
    expect(cross).toBeTruthy();
  });

  it("(13) the REVERSE direction (which clients is this person on) is scoped the same way", () => {
    const rows = listScopesForContact(P_A, C_A1);
    expect(rows.map((r) => r.companyId)).toEqual([CO_A]);
    // and B cannot read A's contact's scopes
    expect(() => listScopesForContact(P_B, C_A1)).toThrow(ScopeNotFoundError);
  });

  it("(14) the picker roster EXCLUDES already-scoped contacts and NEVER includes another firm's", () => {
    const before = listScopableContacts(P_A, CO_A).map((c) => c.id);
    // Both of A's contacts are already scoped to CO_A, so the roster is empty…
    expect(before).not.toContain(C_A1);
    expect(before).not.toContain(C_A2);
    // …and critically it never contains B's contact, scoped or not.
    expect(before).not.toContain(C_B1);
    // The other pole: unscope one and it reappears as a candidate. Without this,
    // a roster query that returned [] unconditionally would pass the line above.
    const scope = listScopesForCompany(P_A, CO_A).find((r) => r.partnerCrmContactId === C_A2)!;
    unscopeContactFromClient(P_A, scope.id);
    expect(listScopableContacts(P_A, CO_A).map((c) => c.id)).toContain(C_A2);
    // restore the fixture for the counts case below
    scopeContactToClient({ partnerId: P_A, contactId: C_A2, companyId: CO_A, actorUserId: U_A });
  });

  it("(15) badge counts are per-partner and never aggregate across firms", () => {
    const a = scopeCountsByContact(P_A);
    const b = scopeCountsByContact(P_B);
    expect(a[C_A1]).toBe(1);
    expect(a[C_A2]).toBe(1);
    expect(a[C_B1]).toBeUndefined();
    expect(b[C_B1]).toBe(1);
    expect(b[C_A1]).toBeUndefined();
  });
});

describe("WAVE 30 ENGINE 1 — removal, both poles", () => {
  it("(16) B cannot remove A's scope row, and A's row survives the attempt", () => {
    const scope = listScopesForCompany(P_A, CO_A)[0];
    expect(() => unscopeContactFromClient(P_B, scope.id)).toThrow(ScopeNotFoundError);
    // Proving the refusal was a refusal and not a silent success is the point.
    expect(listScopesForCompany(P_A, CO_A).some((r) => r.id === scope.id)).toBe(true);
  });

  it("(17) THE POSITIVE POLE — A can remove its own, and the CONTACT and ATTRIBUTION both survive", () => {
    const scope = listScopesForCompany(P_A, CO_A).find((r) => r.partnerCrmContactId === C_A1)!;
    const removed = unscopeContactFromClient(P_A, scope.id);
    expect(removed.id).toBe(scope.id);
    expect(listScopesForCompany(P_A, CO_A).some((r) => r.id === scope.id)).toBe(false);
    // Unscoping removes the LINK only. If this ever cascaded into the contact or
    // the attribution it would be a silent drop of real data.
    expect(contactBelongsToPartner(P_A, C_A1)).toBe(true);
    expect(attributionBelongsToPartner(P_A, ATTR_A)).toBe(true);
  });

  it("(18) removing a nonexistent scope is the same 404-shaped refusal, and is not a crash", () => {
    expect(() => unscopeContactFromClient(P_A, ABSENT)).toThrow(ScopeNotFoundError);
  });
});
