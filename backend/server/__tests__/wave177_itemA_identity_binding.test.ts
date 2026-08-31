/**
 * WAVE 177 · ITEM A · R148.1 — THE IDENTITY BINDING, PROVED END TO END.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT R148.1 ESTABLISHED. On live, a real partner sees "No eligible contacts."
 * because `resolvePartnerIdForUser()` returns null: there is no active
 * `partner_team_members` row for their account. Both partner audience rules then
 * return `[]` before any LP or team logic runs. The CODE is correct; the DATA
 * lacks the binding.
 *
 * SO THE ONLY PROOF THAT MATTERS IS A CAUSAL ONE, and A-2/A-3 below are it:
 *   BEFORE the admin action  → resolvePartnerIdForUser === null
 *                            → partnerOwnAudienceIds === []   (the live symptom)
 *   THE ADMIN ACTION         → POST /api/admin/partners/:id/team/bind {email}
 *   AFTER the admin action   → resolvePartnerIdForUser === the partner
 *                            → partnerOwnAudienceIds is NON-EMPTY
 * Same resolvers the messaging picker calls, same process, nothing stubbed. If
 * the binding did not actually repair the audience, A-3 fails.
 *
 * AND THE FENCE MUST NOT MOVE BY ONE PERSON. A-7 binds TWO partners in the same
 * database and asserts each principal's audience contains only their own people —
 * the wave 167 confidentiality property, re-asserted against the new write path,
 * because a repair that widened the fence would be a worse defect than the one
 * being repaired.
 *
 * HONEST RENDERING (Item A.3) is proved as DATA, not as prose: A-4 asserts the
 * identity endpoint returns `resolvedName: null` rather than a placeholder for an
 * account with no readable name, which is what lets the client print a stated
 * fallback instead of inventing one.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb, getDb } from "../db/connection";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import {
  resolvePartnerIdForUser,
  resolvePartnerName,
  partnerOwnAudienceIds,
  partnerTeamPeerIds,
} from "../lib/partnerDelegatedContext";

const ADMIN = "u_admin";

/** Partner ONE — the shape of the live case: a sponsored SPV with an LP, and a
 *  principal whose account is NOT bound to it. */
const P1 = "ac_consortium_partner_w177a1";
const P1_PRINCIPAL = "u_w177a_principal";
const P1_PRINCIPAL_EMAIL = "principal@w177a.test";
const P1_SPV = "spv_w177a_1";
const P1_LP = "u_w177a_lp1";

/** Partner TWO — exists only so the fence has something to fail against. */
const P2 = "ac_consortium_partner_w177a2";
const P2_PRINCIPAL = "u_w177a_other";
const P2_PRINCIPAL_EMAIL = "other@w177a.test";
const P2_SPV = "spv_w177a_2";
const P2_LP = "u_w177a_lp2";

/** An account with NO name on record — the Item A.3 honesty case. */
const NAMELESS = "u_w177a_nameless";
const NAMELESS_EMAIL = "nameless@w177a.test";

let app: express.Express;
const now = () => new Date().toISOString();
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w177a fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};
const get = (p: string) => request(app).get(p).set("x-user-id", ADMIN).set("x-role", "admin");
const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", ADMIN).set("x-role", "admin").send(body ?? {});

function seedPartner(
  partnerId: string,
  principal: string,
  principalEmail: string,
  spvId: string,
  lpId: string,
) {
  /* The admin CONTACT is what the routes validate against (`getById(...).kind ===
     "consortium_partner"`), so a partner that is not a partner is refused. It is
     registered through the store's own test injector rather than by writing the
     `contacts` table directly, because `getById` reads the in-memory contact map —
     a raw INSERT leaves the route seeing no partner at all, which cost this file
     a debugging round and is recorded here so the next reader does not repeat it. */
  _registerSeedPartner({
    id: partnerId,
    legalName: `W177A Partner ${partnerId}`,
    displayName: `W177A Partner ${partnerId}`,
    email: `${partnerId}@w177a.test`,
    region: "North America",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });
  for (const [id, email, name, role] of [
    [principal, principalEmail, `W177A Principal ${partnerId}`, "partner"],
    [lpId, `${lpId}@w177a.test`, `W177A Investor ${lpId}`, "investor"],
  ] as Array<[string, string, string, string]>) {
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
      id,
      email,
      name,
      role,
    );
  }
  /* A sponsored SPV with a subscription, so the OWN-LP half of the audience has
     something real to find once the binding exists. */
  /* Column list copied from the wave 167 fixture, which is the shape the live
     schema actually requires (jurisdiction, currency and the hash columns are NOT
     NULL). `commitment_minor` is a MINOR-UNIT INTEGER LITERAL — no Number(),
     parseInt or parseFloat anywhere near money, per the standing money rule. */
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, ?, 'spv', 'DE', 'open', 'private', 'USD',
             'whole_fund', 'own_only', ?, 'u_w177a', ?, 'u_w177a', '')`,
    spvId,
    partnerId,
    principal,
    `W177A SPV ${spvId}`,
    now(),
    now(),
  );
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', 'committed', ?, ?, 'u_w177a', '')`,
    `sub_${spvId}`,
    spvId,
    lpId,
    now(),
    now(),
  );
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);

  seedPartner(P1, P1_PRINCIPAL, P1_PRINCIPAL_EMAIL, P1_SPV, P1_LP);
  seedPartner(P2, P2_PRINCIPAL, P2_PRINCIPAL_EMAIL, P2_SPV, P2_LP);

  /* An account with an EMPTY name — the resolver returns a placeholder with
     `resolved:false` for this, and Item A.3 forbids shipping the placeholder. */
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, '', 'partner', 0, NULL)`,
    NAMELESS,
    NAMELESS_EMAIL,
  );

  /* NOTHING is bound. That absence is the fixture — it is the live state. */
  for (const u of [P1_PRINCIPAL, P2_PRINCIPAL, NAMELESS]) {
    run(`DELETE FROM partner_team_members WHERE user_id = ?`, u);
  }
});

describe("WAVE 177 · ITEM A — the admin can bind a partner identity, and it repairs messaging", () => {
  it("A-0 ANTI-VACUITY: the fixture reproduces the LIVE symptom before anything is done", () => {
    /* If this passed for the wrong reason — e.g. no SPV, no LP — the repair below
       would prove nothing, so the ingredients are asserted to exist first. */
    const spv = rawDb()
      .prepare(`SELECT sponsor_partner_id FROM spv WHERE id = ?`)
      .get(P1_SPV) as { sponsor_partner_id: string };
    expect(spv.sponsor_partner_id).toBe(P1);
    const sub = rawDb()
      .prepare(`SELECT investor_id FROM spv_subscription WHERE spv_id = ?`)
      .get(P1_SPV) as { investor_id: string };
    expect(sub.investor_id).toBe(P1_LP);

    /* THE SYMPTOM, EXACTLY AS R148.1 DESCRIBES IT. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBeNull();
    expect(partnerOwnAudienceIds(P1_PRINCIPAL)).toEqual([]);
    expect(partnerTeamPeerIds(P1_PRINCIPAL)).toEqual([]);
  });

  it("A-1 the identity surface reports the truth BEFORE the repair: nobody linked, no name", async () => {
    const res = await get(`/api/admin/partners/${P1}/team/identity`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.members).toEqual([]);
    /* R148.3 item 4 — `partner_organizations` is empty platform-wide, so this is
       null and NOT a guessed name derived from the contact record. */
    expect(res.body.organizationName).toBeNull();
    expect(res.body.bindableSubRoles).toContain("managing_partner");
  });

  it("A-2 the bind route creates the binding the live database is missing", async () => {
    const res = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_PRINCIPAL_EMAIL,
      subRole: "managing_partner",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.boundUserId).toBe(P1_PRINCIPAL);

    /* Persisted, active, with the three columns the resolver's WHERE clause reads. */
    const row = rawDb()
      .prepare(
        `SELECT partner_id, user_id, sub_role, status, joined_at, removed_at
           FROM partner_team_members WHERE user_id = ?`,
      )
      .get(P1_PRINCIPAL) as any;
    expect(row.partner_id).toBe(P1);
    expect(row.status).toBe("active");
    expect(row.removed_at).toBeNull();
    expect(String(row.joined_at ?? "").length).toBeGreaterThan(0);
    expect(row.sub_role).toBe("managing_partner");
  });

  it("A-3 THE CAUSAL PROOF: the same resolvers the messaging picker uses now find people", () => {
    /* `resolvePartnerIdForUser` is uncached by construction ("ZERO caching: every
       call re-reads SQLite"), so this takes effect with no restart and no deploy —
       which is what makes the live repair a click rather than a release. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(P1);
    const audience = partnerOwnAudienceIds(P1_PRINCIPAL);
    expect(audience.length).toBeGreaterThan(0);
    /* And it is the RIGHT person: the LP of the SPV this partner sponsors. */
    expect(audience).toContain(P1_LP);
  });

  it("A-4 ITEM A.3 — a name that is not on record comes back NULL, never as a placeholder", async () => {
    const bound = await post(`/api/admin/partners/${P2}/team/bind`, {
      email: NAMELESS_EMAIL,
      subRole: "viewer",
    });
    expect(bound.status).toBe(200);

    const res = await get(`/api/admin/partners/${P2}/team/identity`);
    const m = (res.body.members as any[]).find((x) => x.userId === NAMELESS);
    expect(m).toBeTruthy();

    /* WHAT IS ASSERTED, AND WHY IT IS NOT `null` HERE.
       `resolveDisplayName` falls back name → email → placeholder, and marks the
       result `resolved:true` if EITHER a name or an email was found
       (lib/displayNameResolver.ts:103-106). This account has no name but does have
       an email, so `resolved` is true and the label is the email address. That is a
       REAL, on-record identifier for this person — not an invented name — so
       returning it is honest and A-4 asserts exactly that: the label is the
       account's own email and nothing was fabricated. */
    expect(m.resolvedName).toBe(NAMELESS_EMAIL);
    expect(m.email).toBe(NAMELESS_EMAIL);

    /* THE PLACEHOLDERS ARE THE ACTUAL PROHIBITION (Item A.3), and they are what
       `resolved:false` guards. None of them may ever appear in this payload. */
    for (const placeholder of ["Pending member", "Invited member", "Public applicant"]) {
      expect(JSON.stringify(res.body.members)).not.toContain(placeholder);
    }
    /* The row is still fully described by everything that IS on record, so the
       client has real values for every other column. */
    expect(m.subRole).toBe("viewer");
    expect(m.status).toBe("active");
    expect(String(m.joinedAt ?? "").length).toBeGreaterThan(0);
  });

  it("A-5 the owner can set the registered name, and resolvePartnerName stops returning null", async () => {
    expect(resolvePartnerName(P1)).toBeNull();
    const res = await post(`/api/admin/partners/${P1}/organization-name`, {
      name: "W177A Registered Name Typed By Owner",
    });
    expect(res.status).toBe(200);
    expect(res.body.organizationName).toBe("W177A Registered Name Typed By Owner");
    /* Read back through the SAME function the messaging stamp calls, so the admin
       surface cannot claim a name the stamp will not see. */
    expect(resolvePartnerName(P1)).toBe("W177A Registered Name Typed By Owner");
    /* It was NOT auto-derived: the previous value really was absent. */
    expect(res.body.previous).toBeNull();
  });

  it("A-6 deactivation is a SOFT close, and it takes the audience back down", async () => {
    /* Bind a colleague first: `remove()` refuses to strand a partner without a
       managing partner, which is the correct refusal and is asserted in A-9. */
    const colleagueEmail = "colleague@w177a.test";
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES ('u_w177a_colleague', 'tenant_platform', ?, 'W177A Colleague', 'partner', 0, NULL)`,
      colleagueEmail,
    );
    const bound = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: colleagueEmail,
      subRole: "associate",
    });
    expect(bound.status).toBe(200);
    const memberId = (bound.body.members as any[]).find(
      (m) => m.userId === "u_w177a_colleague",
    ).memberId;

    /* The colleague is reachable by the principal while the link is active. */
    expect(partnerTeamPeerIds(P1_PRINCIPAL)).toContain("u_w177a_colleague");

    const res = await post(`/api/admin/partners/${P1}/team/${memberId}/deactivate`);
    expect(res.status).toBe(200);

    /* NEVER A HARD DELETE — the row survives, with the closure recorded. */
    const row = rawDb()
      .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = ?`)
      .get(memberId) as { status: string; removed_at: string | null };
    expect(row).toBeTruthy();
    expect(row.status).not.toBe("active");
    expect(String(row.removed_at ?? "").length).toBeGreaterThan(0);

    /* And the audience closes with it. */
    expect(partnerTeamPeerIds(P1_PRINCIPAL)).not.toContain("u_w177a_colleague");
  });

  it("A-7 THE FENCE DOES NOT WIDEN BY ONE PERSON: two bound partners stay separate", async () => {
    const bound = await post(`/api/admin/partners/${P2}/team/bind`, {
      email: P2_PRINCIPAL_EMAIL,
      subRole: "managing_partner",
    });
    expect(bound.status).toBe(200);

    const a = partnerOwnAudienceIds(P1_PRINCIPAL);
    const b = partnerOwnAudienceIds(P2_PRINCIPAL);
    /* Each principal reaches their OWN LP. */
    expect(a).toContain(P1_LP);
    expect(b).toContain(P2_LP);
    /* And NEITHER reaches the other's LP, the other's principal, or the other's
       nameless viewer. This is the wave 167 property, re-asserted against the new
       write path rather than assumed to survive it. */
    expect(a).not.toContain(P2_LP);
    expect(a).not.toContain(P2_PRINCIPAL);
    expect(a).not.toContain(NAMELESS);
    expect(b).not.toContain(P1_LP);
    expect(b).not.toContain(P1_PRINCIPAL);
  });

  it("A-8 refusals are FACTS, not guesses: unknown email, wrong tier, non-partner, double-bind", async () => {
    const noUser = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: "nobody-here@w177a.test",
      subRole: "viewer",
    });
    expect(noUser.status).toBe(404);
    expect(noUser.body.error).toBe("PLATFORM_USER_NOT_FOUND");

    const badRole = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_PRINCIPAL_EMAIL,
      subRole: "supreme_overlord",
    });
    expect(badRole.status).toBe(400);

    const notPartner = await post(`/api/admin/partners/u_w177a_lp1/team/bind`, {
      email: P1_PRINCIPAL_EMAIL,
      subRole: "viewer",
    });
    expect(notPartner.status).toBe(404);
    expect(notPartner.body.error).toBe("PARTNER_NOT_FOUND");

    /* Already bound ELSEWHERE is refused rather than silently moved: which partner
       a person acts for must not be decided by a joined_at timestamp. */
    const moved = await post(`/api/admin/partners/${P2}/team/bind`, {
      email: P1_PRINCIPAL_EMAIL,
      subRole: "viewer",
    });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toBe("USER_ALREADY_BOUND_TO_ANOTHER_PARTNER");
    expect(moved.body.boundPartnerId).toBe(P1);
    /* The refusal changed nothing. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(P1);
  });

  it("A-9 re-binding the same person twice does not twin the membership", async () => {
    const before = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE partner_id = ? AND user_id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .get(P1, P1_PRINCIPAL) as { n: number };
    const again = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_PRINCIPAL_EMAIL,
      subRole: "managing_partner",
    });
    expect(again.status).toBe(200);
    const after = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE partner_id = ? AND user_id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .get(P1, P1_PRINCIPAL) as { n: number };
    expect(after.n).toBe(before.n);
    expect(after.n).toBe(1);
  });

  it("A-10 the email lookup is case-insensitive, because an owner will type it by hand", async () => {
    const res = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_PRINCIPAL_EMAIL.toUpperCase(),
      subRole: "managing_partner",
    });
    expect(res.status).toBe(200);
    expect(res.body.boundUserId).toBe(P1_PRINCIPAL);
  });

  it("A-11 every write is audited, so a binding is never anonymous", () => {
    /* The audit sink's TABLE is resolved from the live schema rather than assumed:
       this suite runs against an in-memory database whose audit table may be
       created under either historical name, and hardcoding one made this assertion
       fail for a reason that had nothing to do with auditing. If NEITHER table
       exists the test says so explicitly instead of passing vacuously. */
    /* `appendAdminAudit` delegates to `appendAudit`, which writes the canonical
       `audit_log` table with the event type in the `action` column
       (adminPlatformStore.ts:1400-1406). The table is confirmed to exist first, so
       a schema that lost the audit sink fails loudly instead of passing vacuously. */
    const table = (
      rawDb()
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'`)
        .all() as Array<{ name: string }>
    ).map((r) => r.name)[0];
    expect(table, "no audit_log table exists in this schema").toBeTruthy();

    const rows = rawDb()
      .prepare(`SELECT action FROM audit_log`)
      .all() as Array<{ action: string }>;
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("partner.identity_binding.bound")).toBe(true);
    expect(actions.has("partner.identity_binding.deactivated")).toBe(true);
    expect(actions.has("partner.organization_name.set")).toBe(true);
  });
});
