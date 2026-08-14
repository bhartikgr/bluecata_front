/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 51 · ITEM 4 — THE SCRIPTS THAT WROTE UNVERIFIABLE AUDIT ROWS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE LIVE SYMPTOM this exists to make impossible again:
 *
 *     tenant_admin_capavate — "boot verifier tick: chain broken at link 0 of 1"
 *
 * timestamped exactly at deploy time, with the server correctly refusing
 * "Resolve incident" with HTTP 409. The diagnosis harness
 * (`build_log/wave51/w51_item4_diagnose.mts`, output
 * `build_log/wave51/W51_item4_diagnose_BEFORE.json`) reproduced that exact
 * string, character for character, from two script formulas — and found a third
 * defect nobody had reported.
 *
 * WHAT WAS WRONG, per script:
 *
 *   1. `scripts/create_partner_admin.ts` inserted `prev_hash: NULL` with
 *      `hash = sha256(auditId:userId:action:now)` — a formula
 *      `verifyTenantAuditChain()` does not use. Probe 2: `ok:false`,
 *      `brokenAt:0`, `totalLinks:1`, `genesisApplied:false` ⇒ detail string
 *      identical to live.
 *   2. `scripts/seed_demo.ts` inserted `prev_hash = "0".repeat(64)` with
 *      `hash = sha256(prev + json + now)`. Probe 3: same exact detail string.
 *      AND (probe 3b) its drizzle call could never land a row at all —
 *      `targetType`/`payload`/`currHash` are not columns, `hash` is NOT NULL,
 *      the insert threw `NOT NULL constraint failed: audit_log.hash`, and a
 *      bare `catch {}` swallowed it. It had audited nothing, silently.
 *   3. `scripts/bootstrap_partner_fixture.ts` set
 *      `curr_hash = sha256(appId:approved:now)` on `consortium_applications`
 *      and never advanced `prev_hash`. The authoritative formula is
 *      `sha256((prev ?? "GENESIS") + "|" + JSON.stringify(chainPayload))` over
 *      ten ordered fields, shared by `consortiumApplyStore` and
 *      `auditChainVerifier.payloadConsortiumApplications`.
 *
 * WHAT THIS FILE ASSERTS — BOTH POLES ON EVERY CLAIM, because a verifier tuned
 * into passing anything is worse than the bug:
 *
 *   POLE A (the fix works)   — running the fixed writers produces chains that
 *                              verify CLEAN.
 *   POLE B (it still bites)  — a deliberately corrupted row, and each of the
 *                              three retired formulas, are still DETECTED.
 *
 * Nothing here reads or writes live data: `NODE_ENV=test` puts the DB at
 * `:memory:` (server/db/connection.ts).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getDb, rawDb } from "../db/connection";
import {
  verifyTenantAuditChain,
  appendAdminAudit,
} from "../adminPlatformStore";
import { createPartnerAdmin } from "../../scripts/create_partner_admin";
import { submitApplication, _consortiumApplyInternal } from "../consortiumApplyStore";
import { approveApplicationDirect } from "../../scripts/bootstrap_partner_fixture";
import { verifyChainForTable } from "../lib/auditChainVerifier";
import { seedDemoData } from "../lib/seedDemoData";

const SCRIPTS_DIR = join(__dirname, "..", "..", "scripts");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * The live detail string is composed by `runAuditChainBootVerifier`
 * (server/lib/hydrateStores.ts:664). Recomposing it here from a verify result is
 * what lets these tests speak in the same words as the incident.
 */
function bootVerifierDetail(v: {
  brokenAt: number;
  totalLinks: number;
  genesisApplied: boolean;
}): string {
  return `boot verifier tick: chain broken at link ${v.brokenAt} of ${v.totalLinks}${
    v.genesisApplied ? " (post-genesis)" : ""
  }`;
}

/** A tenant nobody else in the suite touches, so these probes cannot collide. */
const PROBE_TENANT = "tenant_w51_item4_probe";

function wipeProbeTenant(): void {
  const db = rawDb();
  db.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(PROBE_TENANT);
  try {
    db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = ?`).run(PROBE_TENANT);
  } catch {
    /* table may not exist on very old schemas; the walk falls back to "0"*64 */
  }
}

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());
}, 60_000);

afterEach(() => {
  wipeProbeTenant();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (1) THE VERIFIER ITSELF — established before it is used as an oracle.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 51 · Item 4 — the verifier is a working oracle (both poles)", () => {
  it("POLE A: canonically-appended rows verify clean, and the detail string proves the shape", () => {
    wipeProbeTenant();
    appendAdminAudit("u_admin", "user:u_probe_a", "probe.one", { n: 1 }, PROBE_TENANT);
    appendAdminAudit("u_admin", "user:u_probe_a", "probe.two", { n: 2 }, PROBE_TENANT);
    appendAdminAudit("u_admin", "user:u_probe_a", "probe.three", { n: 3 }, PROBE_TENANT);

    const v = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
    expect(v.ok, `three canonical appends must verify; got ${bootVerifierDetail(v)}`).toBe(true);
    expect(v.brokenAt).toBe(-1);
    expect(v.totalLinks).toBe(3);
  });

  it("POLE B: tampering with a canonical row's payload is still DETECTED", () => {
    wipeProbeTenant();
    appendAdminAudit("u_admin", "user:u_probe_b", "probe.one", { n: 1 }, PROBE_TENANT);
    appendAdminAudit("u_admin", "user:u_probe_b", "probe.two", { n: 2 }, PROBE_TENANT);
    const before = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
    expect(before.ok).toBe(true);

    // Edit the payload of the FIRST row without touching its hash — classic
    // after-the-fact tampering.
    const db = rawDb();
    const first = db
      .prepare(
        `SELECT id FROM audit_log WHERE tenant_id = ? ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get(PROBE_TENANT) as { id: string };
    db.prepare(`UPDATE audit_log SET payload_json = ? WHERE id = ?`).run(
      JSON.stringify({ n: 999, tampered: true }),
      first.id,
    );

    const after = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
    expect(
      after.ok,
      "a payload edit with a stale hash MUST NOT verify — if this passes, the oracle is broken and every other assertion in this file is worthless",
    ).toBe(false);
    expect(after.brokenAt).toBe(0);
  });

  it("POLE B: each of the three retired script formulas is still detected as a break", () => {
    const db = rawDb();
    const now = new Date().toISOString();

    /* --- retired formula 1: create_partner_admin.ts (prev_hash NULL) ------ */
    wipeProbeTenant();
    appendAdminAudit("u_admin", "user:u_anchor", "probe.anchor", { n: 0 }, PROBE_TENANT);
    {
      const userId = "u_probe_partner_admin";
      const action = "partner_admin.created";
      const auditId = `aud_${sha256(`${userId}:${now}:${action}`).slice(0, 24)}`;
      db.prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      ).run(
        auditId,
        PROBE_TENANT,
        userId,
        action,
        "partner_team_member",
        `${PROBE_TENANT}:${userId}`,
        "{}",
        sha256(`${auditId}:${userId}:${action}:${now}`),
        now,
      );
      const v = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
      expect(v.ok, "the retired create_partner_admin formula must not verify").toBe(false);
    }

    /* --- retired formula 2: seed_demo.ts (prev_hash = 64 zeros) ----------- */
    wipeProbeTenant();
    appendAdminAudit("u_admin", "user:u_anchor", "probe.anchor", { n: 0 }, PROBE_TENANT);
    {
      const payload = { email: "admin@capavate.io", role: "admin", password_rotated: true };
      const audit = {
        actor: "system:seed_demo",
        action: "demo.seeded",
        target: "user:u_admin",
        payload,
      };
      db.prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(
        `audit_demo_u_admin_${Date.now()}_w51p2`,
        PROBE_TENANT,
        "system:seed_demo",
        "demo.seeded",
        "user",
        "u_admin",
        JSON.stringify(payload),
        "0".repeat(64),
        sha256("0".repeat(64) + JSON.stringify(audit) + now),
        now,
      );
      const v = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
      expect(v.ok, "the retired seed_demo formula must not verify").toBe(false);
    }

    /* --- retired formula 3: bootstrap_partner_fixture.ts ------------------ */
    {
      const appRow = submitApplication({
        organizationName: "W51 Retired Formula Ltd",
        contactName: "Retired Formula",
        contactEmail: `w51.retired.${Date.now()}@fixture.example.com`,
        partnerType: "vc",
        expectedChapter: "chap_keiretsu_canada",
      });
      // Write the OLD formula onto the row, exactly as the script used to.
      rawDb()
        .prepare(
          `UPDATE consortium_applications
             SET status = 'approved', provisioned_partner_id = ?, reviewed_by_user_id = ?,
                 reviewed_at = ?, updated_at = ?, curr_hash = ?
           WHERE id = ?`,
        )
        .run(
          `ac_${appRow.id}`,
          "u_admin",
          now,
          now,
          sha256(`${appRow.id}:approved:${now}`),
          appRow.id,
        );

      const vr = verifyChainForTable("consortium_applications", { withDetails: true });
      const detail = (vr.details ?? []).find((d) => d.id === appRow.id);
      expect(detail, `row ${appRow.id} must appear in the verifier's details`).toBeTruthy();
      expect(
        detail!.ok,
        "the retired bootstrap_partner_fixture formula must not verify",
      ).toBe(false);

      // Leave the tree clean for the next test.
      rawDb().prepare(`DELETE FROM consortium_applications WHERE id = ?`).run(appRow.id);
      _consortiumApplyInternal.appsCache.delete(appRow.id);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (2) scripts/create_partner_admin.ts — POLE A.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 51 · Item 4 — create_partner_admin.ts appends a VERIFIABLE audit row", () => {
  it("POLE A: after createPartnerAdmin(), the partner tenant's chain verifies clean and the row is canonically linked", async () => {
    const PARTNER = "tenant_cp_keiretsu_ca";
    const db = rawDb();

    const beforeRows = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ?`)
      .get(PARTNER) as { c: number };

    const r = await createPartnerAdmin({
      email: `w51.item4.${Date.now()}@keiretsu.example`,
      password: "W51Item4Pw!1",
      partnerId: PARTNER,
      subRole: "managing_partner",
      name: "W51 Item 4 Admin",
    });

    /* The script now REPORTS whether the audit row landed — the old version
     * could not have told you either way. */
    expect(
      r.auditAppended,
      "createPartnerAdmin must report that it appended the audit row; false means it refused (and wrote nothing), which is safe but not what this run expected",
    ).toBe(true);

    const afterRows = db
      .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ?`)
      .get(PARTNER) as { c: number };
    expect(afterRows.c, "exactly one audit row must have been appended").toBe(beforeRows.c + 1);

    const v = verifyTenantAuditChain(db, PARTNER);
    expect(
      v.ok,
      `the chain must verify after the script writes; got ${bootVerifierDetail(v)}`,
    ).toBe(true);

    /* The new row is genuinely chained, not merely present: its prev_hash is a
     * real 64-hex prior (the tenant's tip, or the "0"*64 genesis prior for the
     * very first row) — never NULL, which is what the retired formula wrote. */
    const newest = db
      .prepare(
        `SELECT id, prev_hash AS prevHash, hash FROM audit_log
          WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(PARTNER) as { id: string; prevHash: string | null; hash: string };
    expect(newest.prevHash, "prev_hash must not be NULL — that was the defect").not.toBeNull();
    expect(newest.prevHash).toMatch(/^[0-9a-f]{64}$/);
    expect(newest.hash).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);

  it("POLE B: with the row present, corrupting its hash is still detected — the script's write is not exempt from verification", async () => {
    const PARTNER = "tenant_cp_keiretsu_ca";
    const db = rawDb();

    const r = await createPartnerAdmin({
      email: `w51.item4.pole.b.${Date.now()}@keiretsu.example`,
      password: "W51Item4PwB!1",
      partnerId: PARTNER,
      subRole: "managing_partner",
      name: "W51 Item 4 Admin B",
    });
    expect(r.auditAppended).toBe(true);
    expect(verifyTenantAuditChain(db, PARTNER).ok).toBe(true);

    const newest = db
      .prepare(
        `SELECT id, hash FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(PARTNER) as { id: string; hash: string };

    db.prepare(`UPDATE audit_log SET hash = ? WHERE id = ?`).run(
      sha256("w51-deliberate-corruption"),
      newest.id,
    );
    const broken = verifyTenantAuditChain(db, PARTNER);
    expect(broken.ok, "a corrupted hash on the script's own row MUST be detected").toBe(false);
    expect(broken.brokenAt).toBeGreaterThanOrEqual(0);

    // Restore, so later suites see the chain they expect.
    db.prepare(`UPDATE audit_log SET hash = ? WHERE id = ?`).run(newest.hash, newest.id);
    expect(verifyTenantAuditChain(db, PARTNER).ok).toBe(true);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (3) scripts/bootstrap_partner_fixture.ts — POLE A.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 51 · Item 4 — bootstrap_partner_fixture.ts leaves a VERIFIABLE application row", () => {
  it("POLE A: approveApplicationDirect() advances prev_hash and writes a curr_hash the verifier accepts", async () => {
    const appRow = submitApplication({
      organizationName: "W51 Item4 Fixture Ltd",
      contactName: "Fixture Contact",
      contactEmail: `w51.item4.fixture.${Date.now()}@fixture.example.com`,
      partnerType: "vc",
      expectedChapter: "chap_keiretsu_canada",
    });

    const submitState = rawDb()
      .prepare(`SELECT prev_hash AS prevHash, curr_hash AS currHash FROM consortium_applications WHERE id = ?`)
      .get(appRow.id) as { prevHash: string | null; currHash: string };

    // The submitted row must already verify — otherwise this test proves nothing
    // about the approve step.
    {
      const vr = verifyChainForTable("consortium_applications", { withDetails: true });
      const d = (vr.details ?? []).find((x) => x.id === appRow.id);
      expect(d?.ok, "the freshly submitted application must verify before approve").toBe(true);
    }

    const approved = await approveApplicationDirect(appRow.id, "u_admin");
    expect(approved.partnerId).toBe(`ac_${appRow.id}`);

    const afterState = rawDb()
      .prepare(
        `SELECT status, prev_hash AS prevHash, curr_hash AS currHash, provisioned_partner_id AS provisioned
           FROM consortium_applications WHERE id = ?`,
      )
      .get(appRow.id) as {
      status: string;
      prevHash: string | null;
      currHash: string;
      provisioned: string | null;
    };

    expect(afterState.status).toBe("approved");
    expect(afterState.provisioned).toBe(`ac_${appRow.id}`);

    /* THE CHAIN ADVANCED: prev_hash is now the submit-time curr_hash, exactly as
     * consortiumApplyStore's real approve path does it (`prevHash: existing.currHash`).
     * The retired code left prev_hash untouched. */
    expect(
      afterState.prevHash,
      "prev_hash must have advanced to the submit-time curr_hash — leaving it unchanged was the defect",
    ).toBe(submitState.currHash);
    expect(afterState.currHash).not.toBe(submitState.currHash);

    /* AND the row verifies — against the verifier, not against a restated formula. */
    const vr = verifyChainForTable("consortium_applications", { withDetails: true });
    const d = (vr.details ?? []).find((x) => x.id === appRow.id);
    expect(d, `row ${appRow.id} must appear in the verifier's details`).toBeTruthy();
    expect(
      d!.ok,
      `the approved application must verify; verifier said: ${d?.reason ?? "(no reason)"}`,
    ).toBe(true);

    /* Independently: the stored hash equals the STORE's own canonical
     * computation over the row's real state. Same functions the verifier is
     * built on, reached through the store's export — no formula is retyped. */
    const { computeHash, chainPayload } = _consortiumApplyInternal;
    const live = rawDb()
      .prepare(`SELECT * FROM consortium_applications WHERE id = ?`)
      .get(appRow.id) as any;
    const expectedHash = computeHash(
      afterState.prevHash,
      chainPayload({
        id: live.id,
        organizationName: live.organization_name,
        contactEmail: live.contact_email,
        expectedChapterId: live.expected_chapter_id ?? null,
        partnerType: live.partner_type,
        aumRange: live.aum_range,
        status: live.status,
        reviewedByUserId: live.reviewed_by_user_id ?? null,
        provisionedPartnerId: live.provisioned_partner_id ?? null,
        updatedAt: live.updated_at,
      } as any),
    );
    expect(afterState.currHash).toBe(expectedHash);
  }, 60_000);

  it("POLE B: corrupting the approved application's curr_hash is still detected", async () => {
    const appRow = submitApplication({
      organizationName: "W51 Item4 Fixture Pole B Ltd",
      contactName: "Fixture Contact B",
      contactEmail: `w51.item4.fixture.b.${Date.now()}@fixture.example.com`,
      partnerType: "vc",
      expectedChapter: "chap_keiretsu_canada",
    });
    await approveApplicationDirect(appRow.id, "u_admin");

    const good = rawDb()
      .prepare(`SELECT curr_hash AS currHash FROM consortium_applications WHERE id = ?`)
      .get(appRow.id) as { currHash: string };

    rawDb()
      .prepare(`UPDATE consortium_applications SET curr_hash = ? WHERE id = ?`)
      .run(sha256("w51-deliberate-corruption"), appRow.id);

    const vr = verifyChainForTable("consortium_applications", { withDetails: true });
    const d = (vr.details ?? []).find((x) => x.id === appRow.id);
    expect(d?.ok, "a corrupted curr_hash MUST be detected").toBe(false);

    // Restore.
    rawDb()
      .prepare(`UPDATE consortium_applications SET curr_hash = ? WHERE id = ?`)
      .run(good.currHash, appRow.id);
    const vr2 = verifyChainForTable("consortium_applications", { withDetails: true });
    expect((vr2.details ?? []).find((x) => x.id === appRow.id)?.ok).toBe(true);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (4) THE REGRESSION FENCE — no script may hand-roll an audit_log hash again.
 *
 * The three defects above were all the same mistake made three times, and each
 * was invisible until a live tenant broke. A behavioural test can only cover the
 * writers that exist today; this fence covers the one somebody adds next month.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 51 · Item 4 — regression fence: scripts/ must not fabricate chain columns", () => {
  const SCRIPT_FILES = [
    "create_partner_admin.ts",
    "seed_demo.ts",
    "bootstrap_partner_fixture.ts",
    "create_admin.ts",
  ];

  /** Strip block and line comments so the retired formulas quoted in the
   *  explanatory headers are not mistaken for live code. */
  function codeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  it("POLE A: no script inserts into audit_log directly — every audit write goes through appendAdminAudit", () => {
    const offenders: string[] = [];
    for (const f of SCRIPT_FILES) {
      const code = codeOnly(readFileSync(join(SCRIPTS_DIR, f), "utf8"));
      const insertsAuditLog =
        /insert\s*\(\s*auditLog/i.test(code) ||
        /INSERT\s+(OR\s+\w+\s+)?INTO\s+audit_log/i.test(code);
      if (insertsAuditLog) offenders.push(f);
    }
    expect(
      offenders,
      `these scripts write audit_log directly instead of via appendAdminAudit(), which is exactly how the live "chain broken at link 0 of 1" incident was produced: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("POLE A: no script sets prev_hash to NULL or to a run of zeros — the two retired priors", () => {
    const offenders: string[] = [];
    for (const f of SCRIPT_FILES) {
      const code = codeOnly(readFileSync(join(SCRIPTS_DIR, f), "utf8"));
      if (/prev_?[hH]ash\s*[:=]\s*null/i.test(code)) offenders.push(`${f} (prev_hash: null)`);
      if (/prev_?[hH]ash\s*[:=]\s*["'`]?0["'`]?\s*\.\s*repeat/i.test(code)) {
        offenders.push(`${f} (prev_hash: "0".repeat(64))`);
      }
      if (/prev_?[hH]ash\s*[:=]\s*["'`]0{16,}["'`]/i.test(code)) {
        offenders.push(`${f} (prev_hash: literal zeros)`);
      }
    }
    expect(
      offenders,
      `a fabricated prev_hash is the defect, not a shortcut — offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("POLE B: the fence can fail — the retired formulas ARE matched when present", () => {
    /* Without this, the two assertions above could be passing because their
     * patterns match nothing at all. Both retired shapes are fed to the same
     * predicates and must be caught. */
    const retiredCreatePartnerAdmin = `
      await db.insert(auditLogTable).values({
        id: auditId, tenantId: args.partnerId, prevHash: null, hash: placeholderHash,
      });`;
    const retiredSeedDemo = `
      const prevHash = "0".repeat(64);
      db.insert(auditLogTable).values({ prevHash, currHash });`;
    const retiredRawSql = `db.prepare("INSERT INTO audit_log (id, prev_hash) VALUES (?, NULL)").run(id);`;

    expect(/insert\s*\(\s*auditLog/i.test(retiredCreatePartnerAdmin)).toBe(true);
    expect(/prev_?[hH]ash\s*[:=]\s*null/i.test(retiredCreatePartnerAdmin)).toBe(true);
    expect(/insert\s*\(\s*auditLog/i.test(retiredSeedDemo)).toBe(true);
    expect(
      /prev_?[hH]ash\s*[:=]\s*["'`]?0["'`]?\s*\.\s*repeat/i.test(retiredSeedDemo),
    ).toBe(true);
    expect(/INSERT\s+(OR\s+\w+\s+)?INTO\s+audit_log/i.test(retiredRawSql)).toBe(true);

    /* And the comment-stripper must not be doing the work for it: the same
     * retired code wrapped in a comment is correctly ignored. */
    expect(/insert\s*\(\s*auditLog/i.test(codeOnly(`/* ${retiredSeedDemo} */`))).toBe(false);
  });

  it("POLE A: no script restates the consortium_applications hash formula — it imports the store's", () => {
    const code = codeOnly(readFileSync(join(SCRIPTS_DIR, "bootstrap_partner_fixture.ts"), "utf8"));
    // The retired shape: a sha256 over an ad-hoc `${appId}:approved:${now}` string.
    expect(
      /createHash\(\s*["']sha256["']\s*\)[\s\S]{0,200}approved/i.test(code),
      "bootstrap_partner_fixture.ts must not compute an application hash itself",
    ).toBe(false);
    expect(
      /_consortiumApplyInternal/.test(code),
      "it must reach the canonical computeHash/chainPayload through the store's export",
    ).toBe(true);
  });
});
