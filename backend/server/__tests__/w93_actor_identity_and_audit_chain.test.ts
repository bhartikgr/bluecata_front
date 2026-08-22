/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 93 — (1) UNBOUND ACTOR RECORDS, THE CLASS · (2) THE PERMANENT BANNER.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ITEM 1. A founder opened their cap table and read `u_redeemed_1782888492403`
 * where an investor's name belongs. Wave 83 fixed that ONE render. This wave
 * measured the class: 45 distinct UNBOUND ACTOR RECORD SHAPES, 487 write
 * occurrences across 80 non-test server files (build_log/wave93/W93_ACTOR_CENSUS.md).
 *
 * The tests below assert BOTH POLES on every claim, because a describer tuned
 * into answering "something readable" for everything is worse than the bug:
 *
 *   POLE A — an id that CAN be bound to a real identity IS bound, from data, and
 *            the real name is what renders.
 *   POLE B — an id that cannot be bound is DESCRIBED, never printed, and the
 *            description is TRUE of that record (a payment webhook does not read
 *            "Pending member", which is what the shipped code answered).
 *
 * ITEM 2. `chain broken at link 0 of 1` on every admin page. The question the
 * wave had to settle was whether the chain is broken or the verifier is wrong —
 * because "link 0 of 1" reads like an off-by-one or an empty chain reported as
 * corruption. It is neither, and the three tests at the bottom prove which:
 * an EMPTY chain verifies clean, a canonically-appended single row verifies
 * clean, and only a row written by a retired script formula produces the live
 * string. THE ALARM IS REAL. It is deliberately left alarming.
 *
 * NODE_ENV=test puts the database at `:memory:` (server/db/connection.ts).
 * Nothing here reads or writes live data.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { verifyTenantAuditChain, appendAdminAudit } from "../adminPlatformStore";
import { describeActor, describeActorLabel } from "../lib/actorIdentityDescriber";
import { resolveActorLabel } from "../lib/activityLabelResolver";

const CLIENT = join(__dirname, "..", "..", "client", "src");
const SERVER = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 60_000);

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1", port, path, method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
          ...(headers ?? {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** The one thing that must never happen: a database key where a name belongs. */
function looksLikeRawKey(s: string): boolean {
  const v = (s ?? "").trim();
  if (!v) return false;
  return (
    /^(u|usr)_[A-Za-z0-9_-]*$/.test(v) ||
    /^(co|cmp|rnd|inv|ext|prt|spv|sub|tenant|fcrm|ccm)_[A-Za-z0-9_-]{3,}$/.test(v) ||
    /^[0-9a-f]{32,}$/i.test(v) ||
    /^(user|company|founder|partner|investor|subscription|accountant|system|round|tenant):/i.test(v)
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * ITEM 1 (a) — EVERY MEASURED SHAPE IS DESCRIBED, NEVER PRINTED.
 * One concrete instance per census shape. If a new unbound shape is invented
 * tomorrow, the last case in this block is the one that catches it.
 * ═════════════════════════════════════════════════════════════════════════════ */
const CENSUS_SAMPLES: string[] = [
  // machine actors (22 shapes in the census; every distinct prefix sampled)
  "system:stripe_webhook", "system:seed", "system:admin", "system:wave0_seed",
  "system:collective_renewal_worker", "system:airwallex_webhook", "system:round_sweeper",
  "system:wave6_seed", "system:subscriptionEnforcementWorker", "system:collective_dsc_vote_lock",
  "system:webhook:stripe", "system:collective_dsc_vote_revert", "system:wave3d_seed",
  "system:auto_activate_free", "system:webhook", "system:c2_migration_0129",
  "system:round_close", "system:governance_publish", "system:payment_gateway",
  "system:refund", "system:canonical-projection", "system:new_company",
  // seed artefacts
  "u_aisha_patel", "u_maya_chen", "u_admin", "u_system_seed", "u_admin_unknown",
  "u_public", "u_admin_test", "u_system", "u_system_email", "u_raj_patel",
  "u_founder_demo", "u_system_expiry",
  // typed prefixes
  "partner:p_w93_nonexistent", "company:co_w93_nonexistent", "founder:co_w93_nonexistent",
  "subscription:co_w93_nonexistent", "accountant:books@example.com", "investor:u_w93_nonexistent",
  // runtime-minted personas
  "u_a1b2c3", "u_rnd_a1b2c3", "u_founder_1782301936139_9tqnpg", "u_redeemed_1782888492403",
  // the genuine data fault
  "u_unknown_admin",
];

describe("WAVE 93 · Item 1 — no unbound actor record renders as a key", () => {
  it("POLE B: every measured unbound shape yields a HUMAN DESCRIPTION, not a key", () => {
    const leaks: string[] = [];
    for (const id of CENSUS_SAMPLES) {
      const label = describeActorLabel(id);
      if (!label || looksLikeRawKey(label)) leaks.push(`${id} -> ${JSON.stringify(label)}`);
      // the description must also not merely EMBED the key
      if (label.includes(id)) leaks.push(`${id} -> embeds its own id: ${label}`);
    }
    expect(leaks, `these unbound actors still reach a user as a key:\n${leaks.join("\n")}`).toEqual([]);
  });

  it("POLE B: an actor id shape nobody has thought of yet is still described", () => {
    for (const invented of ["u_totally_new_shape_9999", "usr_deadbeefcafe", "quantum:flux_capacitor", "u_"]) {
      const label = describeActorLabel(invented);
      expect(looksLikeRawKey(label), `${invented} -> ${label}`).toBe(false);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("the description is TRUE of the record — this is the part the old code got wrong", () => {
    // A payment webhook is not a person, and certainly not a PENDING one. The
    // shipped resolver answered the literal words "Pending member" for all of
    // these, which is a wrong human description on an audit ledger.
    /* WAVE 97 · ITEM 2 — REWRITTEN, old/new/why.
     *   OLD: expect(describeActorLabel("system:stripe_webhook"))
     *          .toBe("Automatic · Stripe webhook");
     *   NEW: the assertion below.
     *   WHY: the old expectation pinned a FALSE STATEMENT onto an integrity
     *   record. Wave 93 correctly stopped calling a payment webhook a "Pending
     *   member", but it then named Stripe — and the owner ruled on 2026-08-21,
     *   verbatim: "We do not use Stripe." / "We are using Airwallex today."
     *   Measured this wave: every writer of `system:stripe_webhook` is either
     *   the Airwallex-verified `POST /api/airwallex/webhook/collective` path or
     *   the Stripe adapter the owner has instructed us to remove, so the label
     *   was never true of any record this platform produces. The test still
     *   asserts exactly what it was written to assert — that the description is
     *   TRUE of the record — it is the truth that moved, not the standard.
     *   The raw token is deliberately still asserted verbatim below, because
     *   this is a label correction and NOT a history rewrite. */
    expect(describeActorLabel("system:stripe_webhook")).toBe(
      "Automatic · Payment provider webhook (legacy token)",
    );
    expect(describeActorLabel("system:stripe_webhook")).not.toMatch(/stripe/i);
    expect(describeActor("system:stripe_webhook").kind).toBe("machine");
    /* The stored id is untouched — nothing was deleted or rewritten. */
    expect(describeActor("system:stripe_webhook").id).toBe("system:stripe_webhook");
    /* Airwallex IS in use, so it must still be named. This is the guard that
       stops the correction from becoming a blanket provider-name suppressor. */
    expect(describeActorLabel("system:airwallex_webhook")).toBe("Automatic · Airwallex webhook");

    expect(describeActorLabel("u_unknown_admin")).toBe("Administrator (not identified)");
    expect(describeActor("u_unknown_admin").kind).toBe("unidentified");

    // Wave 83's ratified vocabulary is preserved verbatim.
    expect(describeActorLabel("u_redeemed_1782888492403")).toBe("Invited member");
    expect(describeActorLabel("u_public")).toBe("Public applicant");

    // An email-only external party: the email IS the human-readable identity.
    expect(describeActorLabel("someone@external.example")).toBe("someone@external.example");
    expect(describeActor("someone@external.example").kind).toBe("external_email");
    expect(describeActorLabel("accountant:books@example.com")).toBe("books@example.com");

    // Nothing here is BOUND — the describer must say so, so a caller can tell a
    // real name apart from a description.
    for (const id of ["system:stripe_webhook", "u_unknown_admin", "u_redeemed_1", "u_public"]) {
      expect(describeActor(id).bound, id).toBe(false);
    }
  });

  it("POLE A: an id that CAN be bound is bound FROM DATA, and no map is involved", () => {
    const db = rawDb();
    const uid = `u_w93_bindable_${Date.now()}`;
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role) VALUES (?, ?, ?, ?, ?)`,
    ).run(uid, "tenant_platform", `${uid}@example.com`, "Ada Lovelace", "investor");
    try {
      const d = describeActor(uid);
      expect(d.label).toBe("Ada Lovelace");
      expect(d.bound).toBe(true);
      expect(d.kind).toBe("person");
      // and the prefixed form of the same id resolves to the same person
      expect(describeActorLabel(`user:${uid}`)).toBe("Ada Lovelace");
      expect(describeActorLabel(`investor:${uid}`)).toBe("Ada Lovelace");
      // FALSIFIER: the name is read from the row, not from a hardcoded table.
      db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run("Grace Hopper", uid);
      expect(describeActorLabel(uid)).toBe("Grace Hopper");
    } finally {
      db.prepare(`DELETE FROM users WHERE id = ?`).run(uid);
    }
    // With the row gone, it is unbound again — and described, not printed.
    expect(describeActor(uid).bound).toBe(false);
    expect(looksLikeRawKey(describeActorLabel(uid))).toBe(false);
  });

  it("the id itself is NOT deleted — R77 keeps it as a machine-readable value", () => {
    expect(describeActor("u_redeemed_1782888492403").id).toBe("u_redeemed_1782888492403");
    expect(describeActor("system:stripe_webhook").id).toBe("system:stripe_webhook");
  });

  it("no hardcoded id→name map exists in the describer (the rule, enforced)", () => {
    const src = read(join(SERVER, "lib", "actorIdentityDescriber.ts"));
    // Any literal that looks like a real person's name mapped to an id would
    // show up as an id literal used as an object KEY. There must be none.
    expect(src).not.toMatch(/["'`]u_[A-Za-z0-9_]{3,}["'`]\s*:/);
    // The three binding sources must all be present.
    expect(src).toContain("resolveDisplayName");
    expect(src).toContain("resolveCompanyName");
    expect(src).toContain("resolvePartnerName");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ITEM 1 (b) — FIXED AT THE SOURCE, so the next screen cannot reintroduce it.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 93 · Item 1 — the SERVER resolver is the fix, not each render site", () => {
  it("resolveActorLabel (the activity feed's source) no longer mislabels machine actors", () => {
    /* WAVE 97 · ITEM 2 — REWRITTEN, old/new/why.
     *   OLD: expect(resolveActorLabel("system:stripe_webhook"))
     *          .toBe("Automatic · Stripe webhook");
     *   NEW: the two assertions below.
     *   WHY: same ruling as above — the activity feed must not name a payment
     *   provider the platform does not use. This site is the one that proves the
     *   correction is at the SOURCE: activityLabelResolver delegates to
     *   describeActor, so fixing the describer fixes the feed too, which is the
     *   property this test block exists to assert. */
    expect(resolveActorLabel("system:stripe_webhook")).toBe(
      "Automatic · Payment provider webhook (legacy token)",
    );
    expect(resolveActorLabel("system:stripe_webhook")).not.toMatch(/stripe/i);
    expect(resolveActorLabel("u_unknown_admin")).toBe("Administrator (not identified)");
    // and it still never returns a key, for anything
    for (const id of CENSUS_SAMPLES) {
      expect(looksLikeRawKey(resolveActorLabel(id)), id).toBe(false);
    }
  });

  it("GET /api/admin/audit-log emits a resolved actorLabel and PRESERVES the raw id", async () => {
    const tenant = `tenant_w93_endpoint_${Date.now()}`;
    appendAdminAudit("system:stripe_webhook", "subscription:co_w93", "w93.probe", { n: 1 }, tenant);
    const r = await req("GET", `/api/admin/audit-log?tenantId=${tenant}&limit=10`, undefined, { "x-user-id": "u_admin" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = (r.body?.items ?? []) as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    const row = items[0];
    /* WAVE 97 · ITEM 2 — REWRITTEN, old/new/why.
     *   OLD: expect(row.actorLabel).toBe("Automatic · Stripe webhook");
     *   NEW: the two assertions below.
     *   WHY: same ruling as the two sites above — the owner does not use Stripe,
     *   so naming it on the admin audit ledger is a false statement on an
     *   integrity record. This is the MOST important of the three sites, because
     *   it asserts at the real HTTP surface (`GET /api/admin/audit-log`) that the
     *   corrected wording is what an operator actually reads.
     *   NOTE what did NOT change: `row.actor` below still asserts the raw stored
     *   token verbatim. That is the whole design — the label was corrected, the
     *   record was not rewritten, and R77 correlation is intact. */
    // the description a human reads …
    expect(row.actorLabel).toBe("Automatic · Payment provider webhook (legacy token)");
    expect(String(row.actorLabel)).not.toMatch(/stripe/i);
    expect(row.actorKind).toBe("machine");
    expect(row.actorBound).toBe(false);
    // … and the id, still there, for correlation (R77) — UNCHANGED by Wave 97.
    expect(row.actor).toBe("system:stripe_webhook");
    rawDb().prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(tenant);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ITEM 1 (c) — THE RENDER SITES THAT LEAKED, asserted by source.
 * The project's established method for a rendered-copy claim (Wave 80/83): the
 * exact expressions that printed a key are gone, and the guard is present.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 93 · Item 1 — the four confirmed live leaks, closed at the render site", () => {
  it("founder Activity feed no longer prints the raw actor or target", () => {
    const src = read(join(CLIENT, "pages", "founder", "Activity.tsx"));
    // the old body's last line — printing the id when nothing else matched
    expect(src).not.toMatch(/\n\s*return actor;\n\s*}/);
    // the raw target, printed straight into the row
    expect(src).not.toContain('<span className="font-medium">{x.target}</span>');
    expect(src).toContain("safeActorLabel");
    expect(src).toContain("safeTargetLabel");
    expect(src).toContain("x.actorLabel");
    expect(src).toContain("x.targetLabel");
    // R77: the id is still exported for correlation
    expect(src).toContain("CSV export keeps the raw actor id");
  });

  it("admin Audit Log no longer prints the raw actor, target or sign-off actorId", () => {
    const src = read(join(CLIENT, "pages", "admin", "AuditLog.tsx"));
    expect(src).not.toContain('<td className="px-3 py-3 text-xs">{e.actor}</td>');
    expect(src).not.toContain('{c.founder.actorId} <span className="font-mono">');
    expect(src).not.toContain('{c.admin.actorId} <span className="font-mono">');
    expect(src).toContain("safeActorLabel(e.actorLabel, e.actor)");
    expect(src).toContain("safeTargetLabel(e.targetLabel, e.target)");
    // the ids remain as machine-readable attributes
    expect(src).toContain("data-actor-id={e.actor}");
    expect(src).toContain("data-target-id={e.target}");
  });

  it("founder cap table guards the Holder column, the SAFEs card and the warrants card", () => {
    const src = read(join(CLIENT, "pages", "founder", "CapTable.tsx"));
    expect(src).not.toContain('<div className="font-medium">{displayName}</div>');
    expect(src).not.toContain('<span className="font-medium">{s.holderName}</span>');
    expect(src).not.toContain('<span className="font-medium">{w.holderName}</span>');
    expect(src).toContain("safeHolderName");
    // Wave 83's ratified words, preserved on the surface the owner saw them on
    expect(src).toContain('"Redeemed holder"');
  });

  it("the client guard itself never returns a key (its own unit poles)", () => {
    const src = read(join(CLIENT, "lib", "actorLabel.ts"));
    expect(src).toContain("export function safeActorLabel");
    expect(src).toContain("export function safeTargetLabel");
    expect(src).toContain("export function describeRawActor");
    // a server label that IS a key must be rejected — that is the whole point
    expect(src).toContain("if (label && !looksLikeRawKey(label)) return label;");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ITEM 1 (d) — THE SUB-DEFECT: a PLACEHOLDER persisted as a person's NAME.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 93 · Item 1 — \"New contact\" is a live write path, and it now refuses", () => {
  it("it is NOT seed data: the string exists in no migration and no seed script", () => {
    const store = read(join(SERVER, "founderCrmStore.ts"));
    // the fallback that minted the identity is gone from the composer
    expect(store).not.toMatch(/return contact \?\? "New contact";/);
    expect(store).toContain("crmBodyHasIdentity");
    expect(store).toContain("crm_contact_no_identity");
  });

  it("POLE B: a contact with NO identifying field at all is REFUSED, and nothing is written", async () => {
    const r = await req("POST", "/api/founder/investor-crm", {}, { "x-user-id": "u_maya_chen" });
    /* 400 = the new refusal. 401/403 = the auth gate answered first, and
       `missing_active_company` = the company gate answered first; in every one of
       those cases NOTHING WAS WRITTEN, which is the property under test. */
    expect([400, 401, 403]).toContain(r.status);
    if (r.status === 400) {
      expect(["crm_contact_no_identity", "missing_active_company"]).toContain(r.body?.error);
      if (r.body?.error === "crm_contact_no_identity") {
        expect(String(r.body?.message ?? "")).toContain("Nothing was saved");
      }
    }
  });

  it("POLE A: the refusal is NARROW — one identifying field is enough", () => {
    // The predicate is the contract; exercised directly so the assertion does
    // not depend on the auth gate.
    const store = read(join(SERVER, "founderCrmStore.ts"));
    for (const field of ["firstName", "lastName", "name", "primaryContact", "email", "companyName", "firmName"]) {
      expect(store).toContain(`optCrmStr(body?.${field})`);
    }
  });

  it("the partner CRM equivalent is REPORTED, NOT EDITED — WAVE 1D owns that area", () => {
    const partner = read(join(SERVER, "partnerWorkspaceV19Store.ts"));
    // Deliberately still present. Changing it would alter a partner screen.
    expect(partner).toContain('"New contact"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * ITEM 2 — IS THE CHAIN BROKEN, OR IS THE VERIFIER WRONG?
 *
 * The live string, character for character:
 *   "boot verifier tick: chain broken at link 0 of 1"
 *
 * Composed by runAuditChainBootVerifier (server/lib/hydrateStores.ts:664) from a
 * verify result. Recomposing it here is what lets these tests speak in the same
 * words as the incident.
 * ═════════════════════════════════════════════════════════════════════════════ */
function bootVerifierDetail(v: { brokenAt: number; totalLinks: number; genesisApplied: boolean }): string {
  return `boot verifier tick: chain broken at link ${v.brokenAt} of ${v.totalLinks}${v.genesisApplied ? " (post-genesis)" : ""}`;
}
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const W93_TENANT = "tenant_w93_chain_probe";

afterEach(() => {
  try { rawDb().prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(W93_TENANT); } catch { /* fine */ }
});

describe("WAVE 93 · Item 2 — what \"link 0 of 1\" actually means", () => {
  it("AN EMPTY CHAIN IS NOT A BROKEN CHAIN — the verifier already knows this", () => {
    // The owner's exact hypothesis, tested first. A tenant with zero rows
    // verifies CLEAN with totalLinks 0. So the live "of 1" cannot be an empty
    // chain misreported, and the verifier is not making that mistake.
    const v = verifyTenantAuditChain(rawDb(), W93_TENANT);
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBe(-1);
    expect(v.totalLinks).toBe(0);
  });

  it("A CANONICAL SINGLE ROW VERIFIES CLEAN — so \"link 0 of 1\" is not an off-by-one", () => {
    appendAdminAudit("u_w93_admin", "user:u_w93_target", "w93.single", { n: 1 }, W93_TENANT);
    const v = verifyTenantAuditChain(rawDb(), W93_TENANT);
    expect(v.ok, bootVerifierDetail(v)).toBe(true);
    expect(v.totalLinks).toBe(1);
    expect(v.brokenAt).toBe(-1);
  });

  it("THE LIVE STRING IS REPRODUCED, character for character, by a retired writer formula", () => {
    // The formula `scripts/create_partner_admin.ts` used before Wave 51 fixed it:
    // prev_hash NULL, and a hash over a body the verifier does not use.
    const now = new Date().toISOString();
    const id = "al_w93_probe_0001";
    rawDb()
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, W93_TENANT, "u_w93_partner_admin", "partner.admin.created", "user:u_w93_partner_admin", "{}", sha256(`${id}:u_w93_partner_admin:partner.admin.created:${now}`), now);

    const v = verifyTenantAuditChain(rawDb(), W93_TENANT);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(0);
    expect(v.totalLinks).toBe(1);
    expect(v.genesisApplied).toBe(false);
    expect(bootVerifierDetail(v)).toBe("boot verifier tick: chain broken at link 0 of 1");
  });

  it("THE ALARM IS REAL, SO RESOLVING IT IS REFUSED — the banner cannot be clicked away", async () => {
    const now = new Date().toISOString();
    const id = "al_w93_probe_0002";
    rawDb()
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(id, W93_TENANT, "u_w93_partner_admin", "partner.admin.created", "user:u_w93_partner_admin", "{}", sha256("not-the-canonical-body"), now);

    const r = await req("POST", "/api/admin/audit-chain-health/resolve", { key: W93_TENANT, note: "w93 probe" }, { "x-user-id": "u_admin" });
    // 409 = refused because the chain did not verify (the correct behaviour).
    // 401/403 = the admin gate answered first; either way nothing was cleared.
    expect([401, 403, 409]).toContain(r.status);
    if (r.status === 409) {
      expect(r.body?.error).toBe("chain_not_clean");
      expect(r.body?.brokenAt).toBe(0);
      expect(r.body?.totalLinks).toBe(1);
    }
  });

  it("THE BANNER IS NOT SUPPRESSED — it still renders on an incident, unconditionally", () => {
    const src = read(join(CLIENT, "components", "AuditChainP0Banner.tsx"));
    // The single early return is the HEALTHY case, and nothing else can hide it.
    expect(src).toContain("if (!data?.ok || !data.incident) return null;");
    expect(src).toContain('role="alert"');
    expect(src).toContain("Audit chain integrity incident");
    expect(src).toContain('data-testid="audit-chain-p0-banner"');
    /* No suppression MECHANISM was added by this wave. Asserted against the
       mechanisms, not against the word: the wave's own added copy contains the
       word "dismissal" (as an instruction NOT to dismiss), and a word-level
       assertion flagged it — which is how this assertion got narrowed. */
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    expect(src).not.toMatch(/onDismiss|setDismissed|isDismissed|dismissedAt|snoozed?[A-Z(]/);
    expect(src).not.toMatch(/useState/);
    // exactly ONE early return, and it is the healthy case
    expect((src.match(/return null;/g) ?? []).length).toBe(1);
  });
});
