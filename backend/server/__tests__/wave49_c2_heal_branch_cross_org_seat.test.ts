/**
 * WAVE 49 · C-2 — the idempotent re-approve "heal" branch is a SECOND DOOR.
 *
 * ============================================================
 * WHAT WAVE 44 FIXED, AND WHAT IT MISSED
 * ============================================================
 * Wave 44 made the pending→approved path genuinely atomic and added a read-only
 * pre-flight that refuses `PARTNER_CONTACT_EMAIL_CONFLICT` before any write. That
 * work is real and this file does not disturb it.
 *
 * But the pre-flight is only reached by an application that is still PENDING.
 * `_approveApplicationLocked` has an earlier branch, at approximately
 * `server/consortiumApplyStore.ts:996–1029`, for an application that is ALREADY
 * `approved` with a `provisionedPartnerId`. That branch:
 *
 *   · runs BEFORE the pre-flight, so the conflict check never executes;
 *   · runs OUTSIDE any transaction;
 *   · is wrapped in `catch { log.warn }` and then returns 200;
 *   · calls `upsertConsortiumPartner` and `partnerTeamStore.upsertOwner` with NO
 *     id-match assertion — while the good transaction at `:1264` HAS one.
 *
 * `upsertConsortiumPartner` resolves an existing partner contact by LOWER-CASED
 * email and, when the resolved row's id differs from `preferredId`, writes an
 * audit note and returns the OTHER ROW'S ID (`adminContactsStore.ts:936–987`).
 * The heal branch then grants the applicant a **`managing_partner` seat on that
 * other organisation** — full write authority over a partner they have nothing to
 * do with — and reports success.
 *
 * The population that reaches this door is precisely the applications approved
 * BEFORE Wave 44's pre-flight existed: the v25.23 NH-E comment says so — the
 * branch was added for legacy half-provisioned approvals. The pre-flight can
 * never see them.
 *
 * ============================================================
 * REPRODUCE BEFORE FIXING
 * ============================================================
 * Wave 44 proved its fix by running its test file against the pre-fix store and
 * watching the pole-B tests fail. The same method is used here. The recorded
 * pre-fix run is `build_log/wave49/W49_C2_repro_BEFORE_fix.txt`, and the tests
 * marked `POLE B` below are the ones that fail there — with a seat visibly
 * granted on the wrong organisation — and pass after the fix.
 *
 * BOTH POLES:
 *   POLE A — a legitimate idempotent re-approve of the SAME application still
 *     succeeds, still heals a genuinely missing seat, and does NOT
 *     double-provision.
 *   POLE B — a re-approve whose contact email collides with a DIFFERENT
 *     organisation is REFUSED with a typed error, and NO seat is granted.
 *
 * A heal branch that refused every re-approval would pass POLE B and destroy the
 * recovery path POLE A depends on. Both are asserted.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
import { upsertConsortiumPartner } from "../adminContactsStore";

let app: express.Express;
let seq = 0;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

/* ── helpers ────────────────────────────────────────────────────────────── */

function sql<T = any>(q: string, ...a: unknown[]): T[] {
  return rawDb().prepare(q).all(...(a as any[])) as T[];
}
function run(q: string, ...a: unknown[]): void {
  rawDb().prepare(q).run(...(a as any[]));
}
function nowIso(): string {
  return new Date().toISOString();
}

/** A user row for `email`, which the heal branch requires to do anything. */
function ensureUser(email: string): string {
  const found = sql<{ id: string }>(`SELECT id FROM users WHERE email = ?`, email);
  if (found.length) return found[0].id;
  const id = `u_w49c2_${++seq}`;
  run(
    `INSERT INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, 'tenant_w49c2', ?, 'Dana Duplicate', 'partner', 0)`,
    id,
    email,
  );
  return id;
}

/**
 * Seed an application that is ALREADY approved with a `provisionedPartnerId` —
 * i.e. exactly the legacy state the heal branch exists to serve, and the ONLY
 * state that reaches it. Written directly because Wave 44's pre-flight correctly
 * prevents this state from being CREATED through the route any more; the rows
 * that predate Wave 44 are still in the table.
 */
function seedApprovedApplication(opts: {
  org: string;
  email: string;
  provisionedPartnerId: string;
}): string {
  const id = `app_w49c2_${++seq}`;
  const ts = nowIso();
  run(
    `INSERT INTO consortium_applications
       (id, tenant_id, contact_name, contact_email, organization_name, jurisdiction,
        partner_type, aum_range, portfolio_company_count, expected_chapter, intro_message,
        status, reviewed_by_user_id, provisioned_partner_id, curr_hash, created_at,
        reviewed_at, updated_at)
     VALUES (?, ?, 'Dana Duplicate', ?, ?, 'Delaware', 'vc', '10-50M', 3,
             'chap_keiretsu_canada', 'Wave 49 C-2 fixture, long enough to pass validation.',
             'approved', 'u_admin', ?, '', ?, ?, ?)`,
    id,
    `tenant_cp_${opts.provisionedPartnerId}`,
    opts.email,
    opts.org,
    opts.provisionedPartnerId,
    ts,
    ts,
    ts,
  );
  return id;
}

/** A partner contact created independently of any approval — an import, or an
 *  admin adding a partner by hand. No `preferredId`, so it mints its own id. */
function seedIndependentPartnerContact(org: string, email: string): string {
  const c = upsertConsortiumPartner(
    {
      legalName: org,
      email,
      website: null,
      partnerType: "vc" as any,
      regionCode: null,
      hqCountry: "Delaware",
    },
    "u_admin",
  );
  return c.id;
}

function seedPartnerOrganization(id: string, name: string): void {
  const ts = nowIso();
  run(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    `tenant_cp_${id}`,
    name,
    ts,
    ts,
  );
}

function seatsFor(userId: string): Array<{ partner_id: string; sub_role: string; status: string }> {
  return sql(
    `SELECT partner_id, sub_role, status FROM partner_team_members WHERE user_id = ?`,
    userId,
  );
}

function reApprove(appId: string) {
  return request(app)
    .post(`/api/admin/consortium/applications/${appId}/review`)
    .set("x-user-id", "u_admin")
    .set("x-role", "admin")
    .send({ status: "approved", review_notes: "wave49 c2 re-approve" });
}

/* ══════════════════════════════════════════════════════════════════════════
 * POLE B — the cross-organisation seat grant. THIS IS THE DEFECT.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 49 · C-2 · POLE B — a heal must never grant a seat on another organisation", () => {
  it("refuses the re-approve when the contact email resolves to a DIFFERENT partner id, and grants NO seat", () => {
    /* The collision, built exactly as it occurs in production: the partner
     * contact that owns this email address is Beta, but the application points at
     * Alpha. Case-differing, because `upsertConsortiumPartner` matches on
     * lower-cased email and the case difference is what hides the collision from
     * anyone reading the rows. */
    const emailOnApplication = `dana.b${++seq}@collide.test`;
    const emailOnContact = emailOnApplication.toUpperCase();

    const betaId = seedIndependentPartnerContact("Beta Partners LLC", emailOnContact);
    seedPartnerOrganization(betaId, "Beta Partners LLC");

    const alphaId = `ac_consortium_partner_w49c2a${seq}`;
    seedPartnerOrganization(alphaId, "Alpha Holdings Ltd");

    const appId = seedApprovedApplication({
      org: "Alpha Holdings Ltd",
      email: emailOnApplication,
      provisionedPartnerId: alphaId,
    });
    const userId = ensureUser(emailOnApplication);

    // Precondition: the applicant holds no seat anywhere. If this is not true the
    // test proves nothing.
    expect(seatsFor(userId), "precondition: no seat before the re-approve").toEqual([]);
    expect(betaId).not.toBe(alphaId);

    const res = reApprove(appId);

    return res.then((r) => {
      /* PRE-FIX: 200, and a `managing_partner` seat on `betaId`.
       * POST-FIX: a typed refusal, and no seat at all. */
      expect(
        r.status,
        `a cross-organisation heal must be REFUSED, not reported as success. body=${JSON.stringify(r.body)}`,
      ).not.toBe(200);
      expect(r.body.applicationUnchanged).toBe(true);
      expect(String(r.body.reason ?? "")).toContain("PARTNER_HEAL_ID_MISMATCH");

      const seats = seatsFor(userId);
      expect(
        seats.filter((s) => s.partner_id === betaId && s.status === "active"),
        `THE DEFECT: a managing_partner seat on ${betaId} (Beta Partners LLC) for an ` +
          `applicant to ${alphaId} (Alpha Holdings Ltd)`,
      ).toEqual([]);
      expect(seats, "no seat may be granted anywhere by a refused heal").toEqual([]);

      // The application is untouched — a refusal must not rewrite it either.
      const row = sql<{ status: string; provisioned_partner_id: string }>(
        `SELECT status, provisioned_partner_id FROM consortium_applications WHERE id = ?`,
        appId,
      )[0];
      expect(row.status).toBe("approved");
      expect(row.provisioned_partner_id).toBe(alphaId);
    });
  });

  it("refuses with a typed error rather than a swallowed warning and a 200", async () => {
    const email = `dana.c${++seq}@collide.test`;
    const betaId = seedIndependentPartnerContact("Gamma Growth Partners", email.toUpperCase());
    seedPartnerOrganization(betaId, "Gamma Growth Partners");
    const alphaId = `ac_consortium_partner_w49c2c${seq}`;
    seedPartnerOrganization(alphaId, "Delta Holdings Ltd");
    const appId = seedApprovedApplication({
      org: "Delta Holdings Ltd",
      email,
      provisionedPartnerId: alphaId,
    });
    ensureUser(email);

    const r = await reApprove(appId);
    // 409: nothing is broken, the request cannot be satisfied in the current data
    // state, and the fix is a data fix an admin can make. Same shape as the Wave
    // 44 pre-flight refusals.
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("partner_heal_id_mismatch");
    expect(r.body.reason).toContain("PARTNER_HEAL_ID_MISMATCH");
    // The refusal must name BOTH ids so an admin can actually act on it.
    expect(r.body.reason).toContain(betaId);
    expect(r.body.reason).toContain(alphaId);
    expect(String(r.body.message ?? "")).toMatch(/different partner|does not match|another/i);
  });

  it("refuses when the application's provisioned id has NO contacts row at all", async () => {
    /* The other id-mismatch shape: the heal would mint a brand-new contact row
     * under a fresh id, silently re-pointing the partner. A heal is allowed to
     * restore a missing SEAT; it is not allowed to invent a partner identity.
     * With no colliding email, `upsertConsortiumPartner` would CREATE a row —
     * and it would create it with `preferredId`, so the ids DO match and this is
     * legitimate healing, not a mismatch. Asserted as such: this must SUCCEED,
     * which is why the guard is an id-match assertion and not "refuse if the
     * contact is missing". */
    const email = `dana.d${++seq}@heal.test`;
    const alphaId = `ac_consortium_partner_w49c2d${seq}`;
    seedPartnerOrganization(alphaId, "Epsilon Ventures Ltd");
    const appId = seedApprovedApplication({
      org: "Epsilon Ventures Ltd",
      email,
      provisionedPartnerId: alphaId,
    });
    const userId = ensureUser(email);

    const r = await reApprove(appId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const seats = seatsFor(userId);
    expect(seats, "the seat is healed onto the application's OWN partner id").toEqual([
      { partner_id: alphaId, sub_role: "managing_partner", status: "active" },
    ]);
    const contact = sql(
      `SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner'`,
      alphaId,
    );
    expect(contact.length, "the contacts row carries the application's id, not a fresh one").toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * POLE A — legitimate healing still works, and does not double-provision.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 49 · C-2 · POLE A — the legitimate idempotent re-approve still succeeds", () => {
  it("heals a genuinely missing seat on the application's OWN organisation", async () => {
    const email = `carol.a${++seq}@aligned.test`;
    const partnerId = `ac_consortium_partner_w49c2p${seq}`;
    seedPartnerOrganization(partnerId, "Aligned Capital LLP");
    // The contact row already carries the application's own id — the aligned,
    // healthy case. `preferredId` makes the ids match by construction.
    upsertConsortiumPartner(
      {
        legalName: "Aligned Capital LLP",
        email,
        website: null,
        partnerType: "vc" as any,
        regionCode: null,
        hqCountry: "Delaware",
        preferredId: partnerId,
      },
      "u_admin",
    );
    const appId = seedApprovedApplication({
      org: "Aligned Capital LLP",
      email,
      provisionedPartnerId: partnerId,
    });
    const userId = ensureUser(email);
    expect(seatsFor(userId), "precondition: the half-state this branch exists to heal").toEqual([]);

    const r = await reApprove(appId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(seatsFor(userId)).toEqual([
      { partner_id: partnerId, sub_role: "managing_partner", status: "active" },
    ]);
  });

  it("is idempotent — re-approving three times grants exactly ONE seat", async () => {
    const email = `carol.b${++seq}@aligned.test`;
    const partnerId = `ac_consortium_partner_w49c2q${seq}`;
    seedPartnerOrganization(partnerId, "Repeat Capital LLP");
    upsertConsortiumPartner(
      {
        legalName: "Repeat Capital LLP",
        email,
        website: null,
        partnerType: "vc" as any,
        regionCode: null,
        hqCountry: "Delaware",
        preferredId: partnerId,
      },
      "u_admin",
    );
    const appId = seedApprovedApplication({
      org: "Repeat Capital LLP",
      email,
      provisionedPartnerId: partnerId,
    });
    const userId = ensureUser(email);

    for (let i = 0; i < 3; i++) {
      const r = await reApprove(appId);
      expect(r.status, `call ${i + 1}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    // No double-provisioning: one seat, not three.
    expect(seatsFor(userId)).toEqual([
      { partner_id: partnerId, sub_role: "managing_partner", status: "active" },
    ]);
    // And exactly one contacts row for the partner.
    expect(
      sql(`SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner'`, partnerId).length,
    ).toBe(1);
  });

  it("still returns the existing application row, unchanged, on a successful heal", async () => {
    const email = `carol.c${++seq}@aligned.test`;
    const partnerId = `ac_consortium_partner_w49c2r${seq}`;
    seedPartnerOrganization(partnerId, "Steady Capital LLP");
    upsertConsortiumPartner(
      {
        legalName: "Steady Capital LLP",
        email,
        website: null,
        partnerType: "vc" as any,
        regionCode: null,
        hqCountry: "Delaware",
        preferredId: partnerId,
      },
      "u_admin",
    );
    const appId = seedApprovedApplication({
      org: "Steady Capital LLP",
      email,
      provisionedPartnerId: partnerId,
    });
    ensureUser(email);

    const r = await reApprove(appId);
    expect(r.status).toBe(200);
    const row = sql<{ status: string; provisioned_partner_id: string }>(
      `SELECT status, provisioned_partner_id FROM consortium_applications WHERE id = ?`,
      appId,
    )[0];
    expect(row.status).toBe("approved");
    expect(row.provisioned_partner_id).toBe(partnerId);
  });

  it("a re-approve with no matching user row is a no-op, not a failure", async () => {
    /* The applicant has not signed up yet, so there is nobody to seat. That is
     * not an error and must not become one — it is the pre-Wave-44 behaviour and
     * the admin has nothing to fix. */
    const email = `nobody${++seq}@notsignedup.test`;
    const partnerId = `ac_consortium_partner_w49c2s${seq}`;
    seedPartnerOrganization(partnerId, "Unsigned Capital LLP");
    const appId = seedApprovedApplication({
      org: "Unsigned Capital LLP",
      email,
      provisionedPartnerId: partnerId,
    });
    expect(sql(`SELECT id FROM users WHERE email = ?`, email)).toEqual([]);

    const r = await reApprove(appId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
