/**
 * WAVE 148 — EVERY E-SIGNATURE READ IS GUARDED, AND A GUARDED READ ANSWERS
 * 503 WITH AN OPAQUE, TRACEABLE INCIDENT CODE — NEVER A BARE 500.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS OBSERVED, AND WHAT IS AND IS NOT REPRODUCED HERE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The live SPV E-signature tab answered HTTP 500 with the body
 * "An unexpected error occurred. Please try again." — sanitize.ts's production
 * fallback. Wave 127 proved the panel survives that, and named spvOwner()'s
 * legacy `spvs` query as the prime suspect but did not guard it.
 *
 * THE ROOT CAUSE CANNOT BE REPRODUCED FROM THE SHIPPED DATA. `esign_envelope`,
 * `esign_recipient`, `esign_event`, `spv` and `spvs` are all EMPTY in both
 * data.db and test.db, so no fixture drawn from them can make the live throw
 * happen. That is not a reason to guess: this file instead INDUCES each
 * candidate failure structurally — drop a table, rename a column — and proves
 * that whichever one fires in production, the answer is a typed 503 carrying a
 * reference, not an untyped 500 carrying an apology. Guarding every path fixes
 * the symptom regardless of which path is the true cause. No reproduction is
 * claimed and none is faked.
 *
 * FAIL-BEFORE. Against the pre-wave tree every assertion below that expects 503
 * received either 500 (the two paths that were unguarded: spvOwner's legacy
 * query and listEsignEvents) or 400 (the three paths the store already guarded,
 * because fail() mapped ONLY ESIGN_SCHEMA_MISSING to 503 and everything else fell
 * through to 400 — a different wrong answer, blaming the caller for our schema).
 * Every assertion on `incidentCode` failed, because no arm emitted one.
 * Raw output: w148_scratch/fail_before_server_raw.txt.
 *
 * NODE_ENV=test puts server/db/connection.ts on an isolated `:memory:` database
 * (connection.ts:141), so dropping and renaming below cannot touch data.db or
 * test.db. Each destructive test restores what it changed in a `finally`.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

import { registerEsignatureRoutes } from "../lib/esignatureRoutes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { createEnvelope, _resetEsignSchemaGuardForTests } from "../lib/esignatureStore";

const OWNER_PARTNER = "ac_consortium_partner_test_partner_inc";
const MANAGING = "u_avi_managing";

/** The opaque per-occurrence reference. Eight hex characters, upper case, and it
 *  names nothing internal — that is what makes it safe to render (R77). */
const INCIDENT = /^ESG-[0-9A-F]{8}$/;

let app: express.Express;

function get(path: string, user?: string) {
  const r = request(app).get(path);
  return user ? r.set("x-user-id", user) : r;
}

function makeEngineOnlyVehicle(partnerId: string): string {
  const id = `spv_w148_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO spv (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
                        distribution_scope, currency, carry_basis, lp_visibility, created_at, updated_at,
                        archived_at, curr_hash)
       VALUES (?, ?, NULL, ?, 'spv', 'delaware', 'fundraising', 'private', 'USD', 'whole_spv', 'own_only', ?, ?, NULL, ?)`,
    )
    .run(id, partnerId, `W148 Vehicle ${id.slice(-6)}`, now, now, "0".repeat(64));
  return id;
}

/** Rename one column so the SELECT that names it throws `no such column`, which
 *  is exactly the state a half-applied 0168/0183 leaves behind. The three tables
 *  still EXIST, so `esignSchemaInstalled()` (table names only, memoised) still
 *  reports true — that is the whole point: this drift is invisible to it. */
function renameColumn(table: string, from: string, to: string): void {
  rawDb().exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerEsignatureRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

afterEach(() => {
  _resetEsignSchemaGuardForTests();
  vi.restoreAllMocks();
});

describe("W148 · guarded e-signature reads answer 503 with an opaque incident code", () => {
  it("ANTI-VACUITY CONTROL: a healthy database still answers 200 with no incident code", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
    expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(200);
    expect(res.body.schemaInstalled).toBe(true);
    /* A healthy read must not mint an incident code — a reference on a success
       would make every reference meaningless. */
    expect(res.body.incidentCode).toBeUndefined();
  });

  it("PATH 1 — spvOwner's legacy `spvs` query (wave 127's named suspect): 503, never 500, and NEVER 404", async () => {
    /* An id that exists in NEITHER table, so control flow reaches the legacy
       query — the one that was unguarded. */
    const unknownId = `spv_w148_absent_${randomUUID().slice(0, 8)}`;
    rawDb().exec(`ALTER TABLE spvs RENAME TO spvs_w148_hidden`);
    try {
      const res = await get(`/api/partner/me/spvs/${unknownId}/esignature`, MANAGING);
      expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(503);
      expect(res.body.error).toBe("ESIGN_OWNER_LOOKUP_UNAVAILABLE");
      expect(String(res.body.incidentCode)).toMatch(INCIDENT);
      /* THE SECOND DEFECT THIS CLOSES. An unreadable ownership table must not be
         answered as absence: that is the wave-44 defect (an existing vehicle
         reported missing) arriving through a new door. */
      expect(res.status, "an unreadable ownership record is never reported as not_found").not.toBe(404);
      expect(res.body.error).not.toBe("not_found");
      /* And it must not be the generic 500 the live site showed. */
      expect(res.body.error).not.toBe("ESIGN_FAILED");
    } finally {
      rawDb().exec(`ALTER TABLE spvs_w148_hidden RENAME TO spvs`);
    }
  });

  it("PATH 2 — listEnvelopesForSubject column drift: 503 ESIGN_LIST_UNAVAILABLE with a reference", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    renameColumn("esign_envelope", "document_title", "document_title_w148");
    try {
      const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
      expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(503);
      expect(res.body.error).toBe("ESIGN_LIST_UNAVAILABLE");
      expect(String(res.body.incidentCode)).toMatch(INCIDENT);
      /* The message is a plain sentence about what is and is not affected, and it
         does not tell the partner to run a migration. */
      expect(String(res.body.message)).toContain("nothing was voided");
    } finally {
      renameColumn("esign_envelope", "document_title_w148", "document_title");
    }
  });

  it("PATH 3 — listEsignEvents column drift (this wave's new guard): 503, not 500", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    /* An envelope must EXIST or envelopeDetail is never called and the event read
       never happens — the test would pass for the wrong reason. */
    const env = createEnvelope({
      subjectKind: "spv",
      subjectId: spvId,
      documentKind: "lpa",
      documentRef: "w148/lpa.pdf",
      documentTitle: "W148 LPA",
      createdBy: `partner:${OWNER_PARTNER}`,
      recipients: [
        { role: "signer", signingOrder: 1, partyKind: "investor", partyId: "inv_w148", fullName: "W148 Signer", email: "w148@example.com" },
      ],
    });
    expect(env.id, "the fixture envelope must exist or the event read is never reached").toBeTruthy();
    renameColumn("esign_event", "event_kind", "event_kind_w148");
    try {
      const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
      expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(503);
      expect(res.body.error).toBe("ESIGN_SCHEMA_COLUMN_DRIFT");
      expect(String(res.body.incidentCode)).toMatch(INCIDENT);
      expect(String(res.body.message)).toContain("no event was lost");
    } finally {
      renameColumn("esign_event", "event_kind_w148", "event_kind");
    }
  });

  it("PATH 4 — readEsignProviderConfig / platform_config unreadable: 503 ESIGN_CONFIG_READ_UNAVAILABLE", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    rawDb().exec(`ALTER TABLE platform_config RENAME TO platform_config_w148_hidden`);
    try {
      const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
      expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(503);
      expect(res.body.error).toBe("ESIGN_CONFIG_READ_UNAVAILABLE");
      expect(String(res.body.incidentCode)).toMatch(INCIDENT);
    } finally {
      rawDb().exec(`ALTER TABLE platform_config_w148_hidden RENAME TO platform_config`);
    }
  });

  it("PATH 5 — the recipient table's drift is guarded too (listRecipients)", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    createEnvelope({
      subjectKind: "spv",
      subjectId: spvId,
      documentKind: "subscription",
      documentRef: "w148/sub.pdf",
      documentTitle: "W148 Subscription",
      createdBy: `partner:${OWNER_PARTNER}`,
      recipients: [
        { role: "signer", signingOrder: 1, partyKind: "investor", partyId: "inv_w148b", fullName: "W148 Signer B", email: "w148b@example.com" },
      ],
    });
    renameColumn("esign_recipient", "full_name", "full_name_w148");
    try {
      const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
      expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(503);
      expect(res.body.error).toBe("ESIGN_SCHEMA_COLUMN_DRIFT");
      expect(String(res.body.incidentCode)).toMatch(INCIDENT);
    } finally {
      renameColumn("esign_recipient", "full_name_w148", "full_name");
    }
  });

  it("THE TYPED ARM LOGS — a support ticket quoting the code resolves to one log line", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    /* server/lib/logger.ts's `log` is Object.freeze'd (:118) so it cannot be
       spied; its error level writes through `console.error` (:52). Capturing the
       real sink is the stronger test: it proves a line actually LEAVES the
       process, which is what an operator greps. */
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renameColumn("esign_envelope", "document_title", "document_title_w148");
    let body: any;
    try {
      const res = await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING);
      body = res.body;
    } finally {
      renameColumn("esign_envelope", "document_title_w148", "document_title");
    }
    const shown = String(body.incidentCode);
    expect(shown).toMatch(INCIDENT);
    /* Before this wave the typed arm wrote NOTHING, so this call count was 0 and
       the failure was unknowable to us as well as to the partner. */
    expect(spy.mock.calls.length, "the typed arm must log").toBeGreaterThan(0);
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    /* The join: the SAME opaque code the client was shown, beside the internal
       code R77 keeps off the screen. */
    expect(logged).toContain(shown);
    expect(logged).toContain("ESIGN_LIST_UNAVAILABLE");
  });

  it("THE CODE IS PER-OCCURRENCE — two failures never share a reference", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    renameColumn("esign_envelope", "document_title", "document_title_w148");
    let a: string, b: string;
    try {
      a = String((await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING)).body.incidentCode);
      b = String((await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING)).body.incidentCode);
    } finally {
      renameColumn("esign_envelope", "document_title_w148", "document_title");
    }
    expect(a).toMatch(INCIDENT);
    expect(b).toMatch(INCIDENT);
    /* A fixed reference (the pre-wave `ESIGN_LIST_READ`) cannot join ONE ticket to
       ONE log line, which is the only thing a reference is for. */
    expect(a).not.toBe(b);
  });

  it("THE FENCES HOLD — no guard granted anything, and 404 still means 404", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    const anon = await get(`/api/partner/me/spvs/${spvId}/esignature`);
    expect(anon.status).not.toBe(200);
    const viewer = await get(`/api/partner/me/spvs/${spvId}/esignature`, "u_avi_viewer");
    expect(viewer.status).toBe(403);
    /* With a HEALTHY ownership table an unknown id is still a non-enumerating 404,
       not the new 503. The two answers must not be confused. */
    const unknown = await get(`/api/partner/me/spvs/spv_w148_nope/esignature`, MANAGING);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("not_found");
  });

  it("R77 — no internal code is ever the only thing the client is given, and the opaque code names nothing internal", async () => {
    const spvId = makeEngineOnlyVehicle(OWNER_PARTNER);
    renameColumn("esign_envelope", "document_title", "document_title_w148");
    let body: any;
    try {
      body = (await get(`/api/partner/me/spvs/${spvId}/esignature`, MANAGING)).body;
    } finally {
      renameColumn("esign_envelope", "document_title_w148", "document_title");
    }
    /* The internal code is allowed in the payload (R77). What must be true is that
       the OPAQUE code contains no internal language at all, because that one is
       rendered to a human. */
    const code = String(body.incidentCode);
    expect(code).not.toContain("ESIGN");
    expect(code).not.toMatch(/esign|envelope|column|sqlite|table/i);
    expect(code.startsWith("ESG-")).toBe(true);
  });
});
