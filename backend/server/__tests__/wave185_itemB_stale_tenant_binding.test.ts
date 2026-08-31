/**
 * WAVE 185 · ITEM B · R156.5 / R150.2 — THE STALE-TENANT-ID CASE, AND THE
 * ADMIN-VISIBLE VERIFICATION.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAVE 185's PREFLIGHT PROVED, WHICH WAVE 177's BUILD REPORT DENIED.
 * `build_log/wave177/W177_BUILD.md` §8 asserted "the bind button still fixes
 * messaging" even with stale rows present. A probe against wave 177's own routes
 * showed the opposite on all four counts:
 *
 *   P1 `resolvePartnerIdForUser` is `ORDER BY joined_at ASC LIMIT 1`, so the
 *      OLDEST active row wins and a correct new binding can NEVER outrank a
 *      stale one.
 *   P2 `w177MembershipIdentity` is `WHERE partner_id = ?`, so a tenant-keyed row
 *      belongs to no partner page and has NO Deactivate control anywhere in the
 *      product.
 *   P3 the bind was refused **409 USER_ALREADY_BOUND_TO_ANOTHER_PARTNER**,
 *      naming a TENANT id as "another partner". The admin was HARD-BLOCKED
 *      before anything was written.
 *   P4 messaging still resolved nobody afterwards.
 *
 * SO THIS FILE IS THE CAUSAL PROOF OF THE REPAIR, in the shape wave 177 used:
 *   BEFORE  → resolvePartnerIdForUser === the TENANT id, audience === []
 *   REFUSAL → a DISTINCT, actionable 409 that says the link is not a partner
 *   ACTION  → the admin opts in explicitly
 *   AFTER   → resolvePartnerIdForUser === the partner, audience NON-EMPTY
 *
 * AND THE FENCE MUST NOT MOVE BY ONE PERSON. B-7 to B-10 assert that a person
 * bound to a REAL partner still CANNOT be moved — not by the plain bind, not by
 * the supersede flag, not by a second attempt — because that is the one shape of
 * this change that could leak partner A's LPs to partner B. B-11 asserts each
 * principal's audience still contains only their own people, the wave-167
 * property re-asserted against the new write path.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import {
  resolvePartnerIdForUser,
  partnerIdResolvesToAPartner,
  partnerOwnAudienceIds,
  diagnosePartnerAudienceEmptiness,
} from "../lib/partnerDelegatedContext";

const ADMIN = "u_admin";

/* THE LIVE SHAPE (R150.2). A principal whose ONLY active membership carries a
   TENANT id where a partner id belongs. */
const P1 = "ac_consortium_partner_w185b1";
const P1_PRINCIPAL = "u_w185b_principal";
const P1_EMAIL = "principal@w185b.test";
const P1_SPV = "spv_w185b_1";
const P1_LP = "u_w185b_lp1";
const STALE_TENANT = "tenant_cp_keiretsu_ca";
const STALE_ROW = "ptm_w185b_stale";

/* A SECOND, GENUINE partner. Exists so the fence has something to fail against
   and so "bound to a real partner elsewhere" is a real case, not a hypothesis. */
const P2 = "ac_consortium_partner_w185b2";
const P2_PRINCIPAL = "u_w185b_other";
const P2_EMAIL = "other@w185b.test";
const P2_SPV = "spv_w185b_2";
const P2_LP = "u_w185b_lp2";

/* A principal with NO membership at all — wave 177's original case, which must
   keep working exactly as it did. */
const CLEAN_PRINCIPAL = "u_w185b_clean";
const CLEAN_EMAIL = "clean@w185b.test";

let app: express.Express;
const now = () => new Date().toISOString();
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w185b fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};
const get = (p: string) => request(app).get(p).set("x-user-id", ADMIN).set("x-role", "admin");
const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", ADMIN).set("x-role", "admin").send(body ?? {});

function seedUser(id: string, email: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0, NULL)`,
    id, email, `W185B ${id}`,
  );
}

function seedPartner(partnerId: string, spvId: string, gp: string, lpId: string): void {
  /* Registered through the store's own injector: the routes validate against the
     in-memory contact map, so a raw INSERT leaves them seeing no partner at all. */
  _registerSeedPartner({
    id: partnerId, kind: "consortium_partner", legalName: `W185B ${partnerId}`,
    displayName: `W185B ${partnerId}`, email: `${partnerId}@w185b.test`,
    status: "active", tier: "catalyst",
  } as never);
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, ?, 'spv', 'DE', 'open', 'private', 'USD', 'whole_fund',
             'own_only', ?, ?, ?, ?, ?)`,
    spvId, partnerId, gp, `W185B ${spvId}`, now(), gp, now(), gp, `hash_${spvId}`,
  );
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', 'committed', ?, ?, ?, ?)`,
    `sub_${spvId}_${lpId}`, spvId, lpId, now(), now(), ADMIN, `hash_${spvId}_${lpId}`,
  );
}

beforeAll(() => {
  applyCommsDelegatedContextSchema(rawDb());

  seedUser(P1_PRINCIPAL, P1_EMAIL);
  seedUser(P1_LP, "lp1@w185b.test");
  seedPartner(P1, P1_SPV, P1_PRINCIPAL, P1_LP);

  seedUser(P2_PRINCIPAL, P2_EMAIL);
  seedUser(P2_LP, "lp2@w185b.test");
  seedPartner(P2, P2_SPV, P2_PRINCIPAL, P2_LP);
  /* P2's principal is CORRECTLY bound to a real partner. */
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?,?,?,'managing_partner','active','2021-01-01T00:00:00.000Z',NULL,?,0,?)`,
    "ptm_w185b_p2", P2, P2_PRINCIPAL, ADMIN, now(),
  );

  seedUser(CLEAN_PRINCIPAL, CLEAN_EMAIL);

  /* THE STALE ROW. Active, and OLDER than any repair could be. */
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?,?,?,'associate','active','2020-01-01T00:00:00.000Z',NULL,?,0,?)`,
    STALE_ROW, STALE_TENANT, P1_PRINCIPAL, ADMIN, now(),
  );

  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userContext = { userId: ADMIN, isAdmin: true, isAuthed: true };
    next();
  });
  registerPartnerRoutes(app);
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 1 — THE DEFECT IS REAL, AND THE DIAGNOSTIC NOW TELLS THE TRUTH
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · B · the stale-tenant-id case is real and correctly named", () => {
  it("B-1 ANTI-VACUITY: the tenant id really is NOT a partner, and really does win", () => {
    expect(partnerIdResolvesToAPartner(STALE_TENANT)).toBe(false);
    expect(partnerIdResolvesToAPartner(P1)).toBe(true);
    /* The OLDEST active row wins — this is the whole reason wave 177's bind
       could not have repaired anything even if it had been allowed to write. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(STALE_TENANT);
    expect(partnerOwnAudienceIds(P1_PRINCIPAL)).toEqual([]);
  });

  it("B-2 the DIAGNOSTIC no longer tells the admin a false thing", () => {
    const d = diagnosePartnerAudienceEmptiness(P1_PRINCIPAL, "both");
    /* Wave 177 reported `partner_has_neither` here — "linked to a partner
       organisation, but that organisation has no colleagues and no investors" —
       which is FALSE and sends the admin hunting for LPs. */
    expect(d.cause).toBe("partner_binding_unresolvable");
    expect(d.viewerHasPartnerBinding).toBe(false);
    expect(d.sentence).toContain("not a partner organisation");
    /* NO MACHINE TOKENS in admin-facing prose (wave 167 P-2). */
    expect(d.sentence).not.toContain(STALE_TENANT);
    expect(d.sentence).not.toContain("partner_team_members");
    expect(d.sentence).not.toContain("partner_id");
  });

  it("B-3 the stale row is STILL invisible on the partner page — so the UI alone cannot fix it", () => {
    /* Not a regression: it is the reason the bind route had to change instead. */
    const r = get(`/api/admin/partners/${P1}/team/identity`);
    return r.then((res) => {
      expect(res.status).toBe(200);
      const ids = (res.body.members ?? []).map((m: any) => m.memberId);
      expect(ids).not.toContain(STALE_ROW);
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 2 — THE ADMIN-VISIBLE VERIFICATION (ITEM B.2)
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · B.2 · an admin can confirm messaging without reading a database", () => {
  it("B-4 it states messaging will NOT work, and NAMES the missing fact", async () => {
    const r = await get(`/api/admin/partners/${P1}/team/messaging-check?email=${P1_EMAIL}`);
    expect(r.status).toBe(200);
    expect(r.body.messagingWillWork).toBe(false);
    expect(r.body.cause).toBe("partner_binding_unresolvable");
    expect(String(r.body.missingFact)).toContain("not a partner organisation");
    /* The facts an admin needs to act, without a SQL client. */
    expect(r.body.boundPartnerId).toBe(STALE_TENANT);
    expect(r.body.boundPartnerIsARealPartner).toBe(false);
    expect(r.body.boundToThisPartner).toBe(false);
  });

  it("B-5 it leaks NO peer identity — only counts of the partner's own people", async () => {
    const r = await get(`/api/admin/partners/${P2}/team/messaging-check?email=${P2_EMAIL}`);
    expect(r.status).toBe(200);
    const blob = JSON.stringify(r.body);
    expect(blob).not.toContain(P2_LP);
    expect(blob).not.toContain(P1_LP);
    expect(blob).not.toContain("audienceUserIds");
    expect(blob).not.toContain("partner_own_lp_peers");
    expect(typeof r.body.ownLpCount).toBe("number");
  });

  it("B-6 'no platform account' is reported as the missing fact, not as an error", async () => {
    const r = await get(
      `/api/admin/partners/${P1}/team/messaging-check?email=nobody@w185b.test`,
    );
    expect(r.status).toBe(200);
    expect(r.body.messagingWillWork).toBe(false);
    expect(r.body.cause).toBe("no_platform_account");
    expect(r.body.userId).toBeNull();
    expect(String(r.body.missingFact)).toContain("no platform account");
  });

  it("B-7 it requires an addressee and refuses to guess", async () => {
    const r = await get(`/api/admin/partners/${P1}/team/messaging-check`);
    expect(r.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 3 — THE CAUSAL REPAIR
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · B · the admin can now actually repair it, self-service", () => {
  it("B-8 the plain bind is refused with a DISTINCT, ACTIONABLE error — not the old one", async () => {
    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_EMAIL, subRole: "associate",
    });
    expect(r.status).toBe(409);
    /* Wave 177 returned USER_ALREADY_BOUND_TO_ANOTHER_PARTNER here, which told
       the admin the tenant id was a partner and left them nowhere to go. */
    expect(r.body.error).toBe("USER_BOUND_TO_UNRESOLVABLE_PARTNER_ID");
    expect(r.body.supersedable).toBe(true);
    expect(String(r.body.message)).toContain("not a partner organisation");
    /* NOTHING was written by a refusal. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(STALE_TENANT);
  });

  it("B-9 CAUSAL PROOF: with the explicit opt-in, the repair succeeds end to end", async () => {
    /* BEFORE — the live symptom. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(STALE_TENANT);
    expect(partnerOwnAudienceIds(P1_PRINCIPAL)).toEqual([]);

    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_EMAIL, subRole: "associate", supersedeUnresolvableBinding: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    /* AFTER — the same resolvers the messaging picker calls. If the repair did
       not actually fix the audience, this fails. */
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(P1);
    const audience = partnerOwnAudienceIds(P1_PRINCIPAL);
    expect(audience.length).toBeGreaterThan(0);
    expect(audience).toContain(P1_LP);
  });

  it("B-10 the superseded row is DEACTIVATED, never hard-deleted — it stays auditable", () => {
    const row = rawDb()
      .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = ?`)
      .get(STALE_ROW) as { status?: string; removed_at?: string } | undefined;
    expect(row).toBeTruthy();
    expect(row?.status).toBe("removed");
    expect(typeof row?.removed_at).toBe("string");
  });

  it("B-11 the verification now says messaging WILL work — the admin can confirm success", async () => {
    const r = await get(`/api/admin/partners/${P1}/team/messaging-check?email=${P1_EMAIL}`);
    expect(r.status).toBe(200);
    expect(r.body.messagingWillWork).toBe(true);
    expect(r.body.cause).toBe("ready");
    expect(r.body.missingFact).toBeNull();
    expect(r.body.boundPartnerId).toBe(P1);
    expect(r.body.boundToThisPartner).toBe(true);
    expect(r.body.boundPartnerIsARealPartner).toBe(true);
  });

  it("B-12 the repair is IDEMPOTENT: repeating it neither twins nor breaks anything", async () => {
    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P1_EMAIL, subRole: "associate", supersedeUnresolvableBinding: true,
    });
    expect(r.status).toBe(200);
    const n = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE user_id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .get(P1_PRINCIPAL) as { n: number };
    expect(n.n).toBe(1);
    expect(resolvePartnerIdForUser(P1_PRINCIPAL)).toBe(P1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 4 — THE FENCE. A REPAIR THAT WIDENED IT WOULD BE THE WORSE DEFECT.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · B · NEGATIVE CONTROLS — nobody can be moved between REAL partners", () => {
  it("B-13 a person bound to a REAL partner is still refused, byte-for-byte as before", async () => {
    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P2_EMAIL, subRole: "associate",
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("USER_ALREADY_BOUND_TO_ANOTHER_PARTNER");
    /* And it is NOT offered as supersedable, so no client can render a confirm. */
    expect(r.body.supersedable).toBeUndefined();
    expect(resolvePartnerIdForUser(P2_PRINCIPAL)).toBe(P2);
  });

  it("B-14 THE SUPERSEDE FLAG CANNOT MOVE THEM EITHER — the flag is not a master key", async () => {
    /* The single most important assertion in this file. If the flag were honoured
       here, an admin could quietly move a principal from partner B to partner A
       and hand A's messaging audience B's limited partners. */
    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: P2_EMAIL, subRole: "associate", supersedeUnresolvableBinding: true,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("USER_ALREADY_BOUND_TO_ANOTHER_PARTNER");
    expect(resolvePartnerIdForUser(P2_PRINCIPAL)).toBe(P2);
    /* The real membership is untouched: still active, never removed. */
    const row = rawDb()
      .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = 'ptm_w185b_p2'`)
      .get() as { status?: string; removed_at?: string | null };
    expect(row.status).toBe("active");
    expect(row.removed_at).toBeNull();
  });

  it("B-15 each principal's audience still contains ONLY their own people", () => {
    const a1 = partnerOwnAudienceIds(P1_PRINCIPAL);
    const a2 = partnerOwnAudienceIds(P2_PRINCIPAL);
    expect(a1).toContain(P1_LP);
    expect(a1).not.toContain(P2_LP);
    expect(a2).toContain(P2_LP);
    expect(a2).not.toContain(P1_LP);
  });

  it("B-16 wave 177's ORIGINAL case still works: a clean bind needs no flag", async () => {
    expect(resolvePartnerIdForUser(CLEAN_PRINCIPAL)).toBeNull();
    const r = await post(`/api/admin/partners/${P2}/team/bind`, {
      email: CLEAN_EMAIL, subRole: "analyst",
    });
    expect(r.status).toBe(200);
    expect(resolvePartnerIdForUser(CLEAN_PRINCIPAL)).toBe(P2);
    /* And it did not disturb the other principal already on that partner. */
    expect(resolvePartnerIdForUser(P2_PRINCIPAL)).toBe(P2);
  });

  it("B-17 the supersede is refused when there is nothing unresolvable to replace", async () => {
    /* A flag that silently reported success on a no-op would be exactly the kind
       of false confirmation this wave exists to remove. The clean principal is
       now bound to P2 (a real partner), so binding them to P1 with the flag must
       hit the REAL-partner refusal, not a fabricated success. */
    const r = await post(`/api/admin/partners/${P1}/team/bind`, {
      email: CLEAN_EMAIL, subRole: "analyst", supersedeUnresolvableBinding: true,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("USER_ALREADY_BOUND_TO_ANOTHER_PARTNER");
  });
});
