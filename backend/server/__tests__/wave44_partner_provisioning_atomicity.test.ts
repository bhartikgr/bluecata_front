/**
 * WAVE 44 · DEFECT 1 — approval atomicity, BOTH POLES.
 *
 * REPRODUCED ROOT CAUSE (see wave44_repro_partner_provisioning.test.ts for the
 * data-shape sweep that found it): when an application's contact email already
 * belonged to an active `consortium_partner` contact — case-insensitively —
 * approval minted a NEW `ac_consortium_partner_<hex>` id, committed it to
 * `consortium_applications.provisioned_partner_id`, and only afterwards called
 * `upsertConsortiumPartner`, which returned the PRE-EXISTING contact instead of
 * creating one with the requested id. That call sat inside a non-fatal
 * try/catch, so the mismatch produced a `contact.preferredId.mismatch` audit row
 * and an HTTP 200. The application claimed `status: approved` with a
 * `provisionedPartnerId` that existed in no contacts row, which is exactly what
 * /api/admin/partners reads. Bridge outbox: 3 events on success, 1 on failure,
 * because the two emissions inside `createContact` and `partnerTeamStore.add`
 * never ran.
 *
 * POLE A — approval SUCCEEDS ⇒ the partner EXISTS. Not "an id was written":
 *   the id resolves in `contacts` (the admin partner registry), in
 *   `partner_organizations`, in the team-membership table, and it is the SAME id
 *   in all of them.
 * POLE B — approval FAILS ⇒ NOTHING is committed. No partner contact, no
 *   partner_organizations row, no tenant, no user, no chapter membership, no
 *   team membership, no bridge event, and the application is byte-for-byte
 *   unchanged (status, provisioned_partner_id, hash chain, reviewed_at). The
 *   admin receives the real reason with the conflicting partner named.
 *
 * A one-sided test that only proves POLE A is what let this ship.
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
import { getOutbox } from "../bridgeStore";
import { partnerTeamStore } from "../partnerWorkspaceStore";

let app: express.Express;
let ipCounter = 200;

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

const base = {
  contactName: "Ada Atomic",
  jurisdiction: "Delaware",
  partnerType: "vc",
  aumRange: "10-50M",
  portfolioCompanyCount: 3,
  expectedChapter: "chap_keiretsu_canada",
  introMessage: "Atomicity fixture application body, long enough to pass validation.",
};

async function submit(patch: Record<string, unknown>): Promise<string> {
  _resetPublicApplyBucketsForTests();
  const res = await request(app)
    .post("/api/public/consortium/apply")
    .set("X-Forwarded-For", `10.44.9.${ipCounter++}`)
    .send({ ...base, ...patch });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.applicationId as string;
}

function approve(appId: string) {
  return request(app)
    .post(`/api/admin/consortium/applications/${appId}/review`)
    .set("x-user-id", "u_admin")
    .set("x-role", "admin")
    .send({ status: "approved", review_notes: "wave44 atomicity" });
}

/** Full durable snapshot of everything approval is supposed to touch. */
function snapshot(appId: string) {
  const one = (sql: string, ...args: unknown[]): any => {
    try {
      return rawDb().prepare(sql).get(...(args as any[]));
    } catch {
      return undefined;
    }
  };
  const appRow = one(
    `SELECT status, provisioned_partner_id, tenant_id, prev_hash, curr_hash, reviewed_at,
            reviewed_by_user_id, review_notes, updated_at
       FROM consortium_applications WHERE id = ?`,
    appId,
  );
  const counts = {
    partnerOrgs: Number(one(`SELECT COUNT(*) AS n FROM partner_organizations`)?.n ?? -1),
    partnerContacts: Number(
      one(`SELECT COUNT(*) AS n FROM contacts WHERE kind = 'consortium_partner'`)?.n ?? -1,
    ),
    tenants: Number(one(`SELECT COUNT(*) AS n FROM tenants WHERE kind = 'consortium_partner'`)?.n ?? -1),
    users: Number(one(`SELECT COUNT(*) AS n FROM users`)?.n ?? -1),
    chapterMemberships: Number(one(`SELECT COUNT(*) AS n FROM chapter_memberships`)?.n ?? -1),
    teamMembers: Number(one(`SELECT COUNT(*) AS n FROM partner_team_members`)?.n ?? -1),
  };
  return { appRow, counts, outbox: getOutbox().length };
}

describe("WAVE 44 · DEFECT 1 — POLE A: approval succeeds AND the partner exists", () => {
  it("writes one partner identity that resolves in every table the platform reads", async () => {
    const email = "pole.a@atomic-one.test";
    const appId = await submit({ organizationName: "Atomic One Ltd", contactEmail: email });
    const outboxBefore = getOutbox().length;

    const res = await approve(appId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const row: any = rawDb()
      .prepare(
        `SELECT status, provisioned_partner_id, tenant_id FROM consortium_applications WHERE id = ?`,
      )
      .get(appId);
    expect(row.status).toBe("approved");
    const pid = String(row.provisioned_partner_id ?? "");
    expect(pid).toMatch(/^ac_consortium_partner_/);

    // The id resolves in the ADMIN PARTNER REGISTRY — the read that was empty
    // for 10 of the 17 live approvals.
    const contact: any = rawDb()
      .prepare(`SELECT id, email, status FROM contacts WHERE id = ? AND kind = 'consortium_partner'`)
      .get(pid);
    expect(contact, "provisionedPartnerId must resolve in contacts").toBeTruthy();
    expect(String(contact.email).toLowerCase()).toBe(email);
    expect(contact.status).toBe("active");

    // ...and in partner_organizations, under the SAME id.
    const org: any = rawDb().prepare(`SELECT id, name FROM partner_organizations WHERE id = ?`).get(pid);
    expect(org, "provisionedPartnerId must resolve in partner_organizations").toBeTruthy();
    expect(org.name).toBe("Atomic One Ltd");

    // ...and the approved contact has an owner seat, so /api/partner/me can work.
    const seats = partnerTeamStore.listByPartner(pid);
    expect(seats.length, "an owner seat must exist for the approved partner").toBeGreaterThan(0);
    expect(seats.some((s) => s.subRole === "managing_partner")).toBe(true);

    // Bridge signature: the live evidence was 3 events per success. Assert the
    // two that were missing on failures are present, by aggregate.
    const emitted = getOutbox().slice(outboxBefore);
    const aggregates = emitted.map((e: any) => `${e.envelope?.aggregateKind}/${e.envelope?.aggregateId}`);
    expect(aggregates, JSON.stringify(aggregates)).toContain(`investor/${pid}`);
    expect(aggregates, JSON.stringify(aggregates)).toContain(`platform/${pid}`);
    expect(aggregates.some((a) => a === `platform/${appId}`)).toBe(true);
    expect(emitted.length).toBe(3);
  });
});

describe("WAVE 44 · DEFECT 1 — POLE B: approval fails and NOTHING is committed", () => {
  it("refuses a duplicate contact email loudly, names the conflict, and leaves zero writes", async () => {
    const sharedEmail = "shared@atomic-two.test";
    // First organisation approves normally and now owns the contact email.
    const firstId = await submit({ organizationName: "Atomic Two Ltd", contactEmail: sharedEmail });
    expect((await approve(firstId)).status).toBe(200);
    const firstPid = String(
      (rawDb()
        .prepare(`SELECT provisioned_partner_id AS p FROM consortium_applications WHERE id = ?`)
        .get(firstId) as any).p,
    );

    // A DIFFERENT organisation applies with the SAME contact email — the exact
    // shape that silently orphaned 10 live applications. UPPERCASE on purpose:
    // the dedup is case-insensitive, so the failure was too.
    const secondId = await submit({
      organizationName: "Completely Different Holdings",
      contactEmail: sharedEmail.toUpperCase(),
    });

    const before = snapshot(secondId);
    expect(before.appRow.status).toBe("submitted");
    expect(before.appRow.provisioned_partner_id).toBeNull();

    const res = await approve(secondId);

    // 1) The admin is told the real reason, not a generic failure, and the
    //    conflicting partner is NAMED so they can act on it.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("partner_contact_email_conflict");
    expect(res.body.existingPartnerId).toBe(firstPid);
    expect(String(res.body.existingPartnerName)).toContain("Atomic Two");
    expect(res.body.applicationUnchanged).toBe(true);
    expect(String(res.body.message)).toMatch(/NOT been approved/i);

    // 2) NOTHING was committed. Every durable counter is identical, the outbox
    //    grew by ZERO (the live failures still emitted 1 event), and the
    //    application row — including its hash chain — is untouched.
    const after = snapshot(secondId);
    expect(after.counts).toEqual(before.counts);
    expect(after.outbox).toBe(before.outbox);
    expect(after.appRow).toEqual(before.appRow);
    expect(after.appRow.status).toBe("submitted");
    expect(after.appRow.provisioned_partner_id).toBeNull();

    // 3) An orphan id is not merely absent — it is unwritable. No contacts row
    //    was created for the refused organisation, under ANY id.
    const orphan: any = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_organizations WHERE name = 'Completely Different Holdings'`,
      )
      .get();
    expect(Number(orphan.n)).toBe(0);

    // 4) And the FIRST partner is undamaged by the refused approval.
    const firstStill: any = rawDb()
      .prepare(`SELECT id FROM contacts WHERE id = ? AND kind = 'consortium_partner'`)
      .get(firstPid);
    expect(firstStill?.id).toBe(firstPid);
  });

  it("refuses a second approval for an already-provisioned partner instead of double-creating", async () => {
    const email = "again@atomic-three.test";
    const firstId = await submit({ organizationName: "Atomic Three Ltd", contactEmail: email });
    expect((await approve(firstId)).status).toBe(200);

    // Same organisation, same email, a second application (the duplicate-submit
    // case). Approving it used to mint a second partner id whose contacts row
    // could never exist.
    const dupId = await submit({ organizationName: "Atomic Three Ltd", contactEmail: email });
    const before = snapshot(dupId);

    const res = await approve(dupId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("partner_already_provisioned");
    expect(String(res.body.message)).toMatch(/second partner/i);
    expect(res.body.applicationUnchanged).toBe(true);

    const after = snapshot(dupId);
    expect(after.counts).toEqual(before.counts);
    expect(after.outbox).toBe(before.outbox);
    expect(after.appRow).toEqual(before.appRow);
  });

  it("an already-approved application is still idempotent (no new writes, no new events)", async () => {
    const appId = await submit({
      organizationName: "Atomic Four Ltd",
      contactEmail: "four@atomic-four.test",
    });
    expect((await approve(appId)).status).toBe(200);
    const before = snapshot(appId);

    const again = await approve(appId);
    expect(again.status).toBe(200);
    const after = snapshot(appId);
    expect(after.counts).toEqual(before.counts);
    expect(after.appRow).toEqual(before.appRow);
    // Idempotent re-approval must not re-emit the provisioning events.
    expect(after.outbox).toBe(before.outbox);
  });

  it("ANTI-VACUITY: the assertions above would fail if approval wrote nothing at all", async () => {
    // Guards against a green run caused by a broken fixture: prove the same
    // helpers DO observe change on a genuine approval.
    const appId = await submit({
      organizationName: "Atomic Five Ltd",
      contactEmail: "five@atomic-five.test",
    });
    const before = snapshot(appId);
    expect((await approve(appId)).status).toBe(200);
    const after = snapshot(appId);
    expect(after.counts.partnerContacts).toBe(before.counts.partnerContacts + 1);
    expect(after.counts.partnerOrgs).toBe(before.counts.partnerOrgs + 1);
    expect(after.outbox).toBeGreaterThan(before.outbox);
    expect(after.appRow).not.toEqual(before.appRow);
  });
});
