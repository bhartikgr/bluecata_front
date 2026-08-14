/**
 * WAVE 44 — REPRODUCTION HARNESS (diagnostic, red-first).
 *
 * Purpose: reproduce, locally and deterministically, the LIVE symptom that an
 * admin auditor observed on 2026-08-14:
 *
 *   17 Consortium Partner applications approved through the admin surface.
 *   The admin UI reported success for all 17. Only 7 produced a partner record
 *   that actually exists. 10 carry a `provisionedPartnerId` that resolves to
 *   NOTHING in the partner list the admin reads (`/api/admin/partners`, which is
 *   `contacts WHERE kind='consortium_partner'`). No error was surfaced.
 *   Bridge outbox: 3 events per success, 1 event per failure.
 *
 * This file makes NO assertion about the fix. It measures the CURRENT behaviour
 * and prints a table, so the root cause is established by execution rather than
 * by reading code. It is deliberately data-varied: each application differs from
 * the happy path in exactly one way.
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

let app: express.Express;

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
  organizationName: "Repro Capital Ltd",
  contactName: "Rita Repro",
  contactEmail: "rita@repro-capital.test",
  jurisdiction: "Cayman Islands",
  partnerType: "vc",
  aumRange: "10-50M",
  portfolioCompanyCount: 5,
  expectedChapter: "chap_keiretsu_canada",
  introMessage: "Reproduction harness application body, long enough to pass validation.",
};

interface Row {
  label: string;
  httpStatus: number;
  appStatus: string | null;
  provisionedPartnerId: string | null;
  partnerOrgExists: boolean;
  adminPartnerExists: boolean;
  bridgeEvents: number;
  bridgeIds: string;
}

async function submitAndApprove(label: string, patch: Record<string, unknown>, ip: string): Promise<Row> {
  const body = { ...base, ...patch };
  _resetPublicApplyBucketsForTests();
  const sub = await request(app)
    .post("/api/public/consortium/apply")
    .set("X-Forwarded-For", ip)
    .send(body);
  if (sub.status !== 201) {
    return {
      label: `${label} [SUBMIT ${sub.status}]`,
      httpStatus: sub.status,
      appStatus: null,
      provisionedPartnerId: null,
      partnerOrgExists: false,
      adminPartnerExists: false,
      bridgeEvents: 0,
      bridgeIds: "",
    };
  }
  const appId = sub.body.applicationId as string;
  const before = getOutbox().length;
  const rev = await request(app)
    .post(`/api/admin/consortium/applications/${appId}/review`)
    .set("x-user-id", "u_admin")
    .set("x-role", "admin")
    .send({ status: "approved", review_notes: "wave44 repro" });
  const after = getOutbox().slice(before);

  const row: any = rawDb()
    .prepare(`SELECT status, provisioned_partner_id FROM consortium_applications WHERE id = ?`)
    .get(appId);
  const pid = row?.provisioned_partner_id ?? null;
  const orgHit: any = pid
    ? rawDb().prepare(`SELECT COUNT(*) AS n FROM partner_organizations WHERE id = ?`).get(pid)
    : { n: 0 };
  const contactHit: any = pid
    ? rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE id = ? AND kind='consortium_partner'`)
        .get(pid)
    : { n: 0 };

  return {
    label,
    httpStatus: rev.status,
    appStatus: row?.status ?? null,
    provisionedPartnerId: pid,
    partnerOrgExists: Number(orgHit?.n ?? 0) > 0,
    adminPartnerExists: Number(contactHit?.n ?? 0) > 0,
    bridgeEvents: after.length,
    bridgeIds: after.map((e: any) => `${e.envelope?.aggregateKind ?? "?"}/${e.envelope?.aggregateId ?? "?"}`).join(" "),
  };
}

describe("WAVE 44 REPRO — approval provisioning", () => {
  it("measures which data shapes produce a real partner record and which silently do not", async () => {
    const rows: Row[] = [];
    let ip = 100;
    const nextIp = () => `10.44.0.${ip++}`;

    // 1) Pure happy path — distinct org, distinct email.
    rows.push(await submitAndApprove("A1 baseline distinct", {
      organizationName: "Distinct One Ltd",
      contactEmail: "one@distinct-one.test",
    }, nextIp()));

    // 2) SAME contact email as (1) — the duplicate-contact shape.
    rows.push(await submitAndApprove("A2 DUPLICATE contact email", {
      organizationName: "Distinct Two Ltd",
      contactEmail: "one@distinct-one.test",
    }, nextIp()));

    // 3) Same organisation name, different email.
    rows.push(await submitAndApprove("A3 duplicate org name", {
      organizationName: "Distinct One Ltd",
      contactEmail: "three@distinct-three.test",
    }, nextIp()));

    // 4) Missing jurisdiction.
    rows.push(await submitAndApprove("A4 no jurisdiction", {
      organizationName: "No Juris Ltd",
      contactEmail: "four@no-juris.test",
      jurisdiction: undefined,
    }, nextIp()));

    // 5) Missing aumRange.
    rows.push(await submitAndApprove("A5 no aumRange", {
      organizationName: "No Aum Ltd",
      contactEmail: "five@no-aum.test",
      aumRange: undefined,
    }, nextIp()));

    // 6) No website / no phone.
    rows.push(await submitAndApprove("A6 no website/phone", {
      organizationName: "No Web Ltd",
      contactEmail: "six@no-web.test",
      website: null,
      contactPhone: null,
    }, nextIp()));

    // 7) Uppercase email variant of (1) — case-folding collision.
    rows.push(await submitAndApprove("A7 UPPERCASE dup email", {
      organizationName: "Distinct Seven Ltd",
      contactEmail: "ONE@DISTINCT-ONE.TEST",
    }, nextIp()));

    // 8) Third repeat of the same email.
    rows.push(await submitAndApprove("A8 third dup email", {
      organizationName: "Distinct Eight Ltd",
      contactEmail: "one@distinct-one.test",
    }, nextIp()));

    const fmt = rows
      .map(
        (r) =>
          `${r.label.padEnd(30)} http=${r.httpStatus} app=${String(r.appStatus).padEnd(9)} pid=${r.provisionedPartnerId ? "yes" : "NULL "} partner_orgs=${r.partnerOrgExists ? "EXISTS" : "MISSING"} admin_partners=${r.adminPartnerExists ? "EXISTS" : "MISSING"} bridge=${r.bridgeEvents} [${r.bridgeIds}]`,
      )
      .join("\n");
    // eslint-disable-next-line no-console
    console.log("\nWAVE44 REPRO TABLE\n" + fmt + "\n");

    // Sanity: the harness itself must have exercised the approval path.
    expect(rows.filter((r) => r.httpStatus === 200).length).toBeGreaterThan(0);
  });
});
