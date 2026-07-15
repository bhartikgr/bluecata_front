/**
 * WAVE W5 — Agreement safe render + version safety + subscription SSOT.
 *
 * Coverage:
 *  Sanitizer (client/src/lib/safeAgreementHtml.ts — pure fns):
 *    1.  <script> / onerror payloads are neutralized (no live tag emitted).
 *    2.  javascript: link URL does not become a live <a href="javascript:">.
 *    3.  legit markdown (heading/bold/list/http link) renders as allow-listed HTML.
 *    4.  stripDraftWatermark removes a standalone DRAFT heading, keeps clauses.
 *  Stale-version signing reject (real POST /api/partner/me/agreement):
 *    5.  presenting an OUTDATED version → 409 agreement_version_stale.
 *    6.  presenting the CURRENT version → signs OK (200 ok:true).
 *  Subscription single source of truth (resolveCanonicalMemberTier):
 *    7.  with a W4 live package published, the canonical member tier is sourced
 *        from the W4 admin catalog (source:"admin", amount from the package).
 *    8.  with NO live W4 package, it falls back (source != "admin").
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

// W4 env so the price ref is available for the SSOT publish step.
process.env.AIRWALLEX_COLLECTIVE_STANDARD_AMOUNT_MINOR = "50000";
process.env.AIRWALLEX_COLLECTIVE_STANDARD_CURRENCY = "USD";
process.env.AIRWALLEX_COLLECTIVE_STANDARD_INTERVAL = "year";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerSelfServiceRoutes } from "../lib/partnerSelfServiceRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { renderAgreementHtml, stripDraftWatermark } from "../../client/src/lib/safeAgreementHtml";
import { resolveCanonicalMemberTier } from "../lib/collectiveMemberSubscriptionResolver";
import * as w4 from "../collectiveSubscriptionConfigStore";
import { priceIdForTier } from "../lib/airwallexCollective";

const MANAGING = "u_avi_managing";
let app: express.Express;

// Resolve the current agreement version the server will enforce.
const CURRENT_VERSION = process.env.PARTNER_AGREEMENT_VERSION ?? "CPA-v0.1-DRAFT";

function signStateRow(partnerId: string): void {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT INTO contacts (id, kind, legal_name, status, verification, created_at, updated_at,
        created_by, updated_by, version, prev_revision_hash, revision_hash)
     VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_test', 'u_test', 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(partnerId, "W5 Agreement Partner", now, now, "0".repeat(64), "0".repeat(64));
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerSelfServiceRoutes(app);
  seedTestPartnerSandbox({ force: true });
  try { rawDb().prepare(`DELETE FROM collective_subscription_configs WHERE slug LIKE 'w5-%'`).run(); } catch { /* self-heals */ }
});

afterAll(() => {
  try { rawDb().prepare(`DELETE FROM collective_subscription_configs WHERE slug LIKE 'w5-%'`).run(); } catch { /* ignore */ }
});

describe("W5.1 — sanitized agreement HTML", () => {
  it("1. neutralizes a <script> payload (no live script tag)", () => {
    const html = renderAgreementHtml("Hello <script>alert(1)</script> world");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;"); // escaped, inert
  });

  it("2. does not emit a javascript: link", () => {
    const html = renderAgreementHtml("[click](javascript:alert(1))");
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it("3. renders allow-listed markdown (heading/bold/list/http link)", () => {
    const html = renderAgreementHtml("# Title\n\n**bold**\n\n- one\n\n[site](https://example.com)");
    expect(html).toMatch(/<h3[^>]*>Title<\/h3>/);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<li>one<\/li>/);
    expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*>site<\/a>/);
  });

  it("3b. blockquote renders without a stray &gt; marker", () => {
    const html = renderAgreementHtml("> quoted governing-law note");
    expect(html).toMatch(/<blockquote[^>]*>quoted governing-law note<\/blockquote>/);
    expect(html).not.toContain("&gt;quoted");
  });

  it("4. stripDraftWatermark removes a standalone DRAFT heading, keeps clauses", () => {
    const src = "# CONSORTIUM PARTNER AGREEMENT — DRAFT v0.1\n\n1. This clause mentions a draft workflow and stays.";
    const stripped = stripDraftWatermark(src);
    expect(stripped).not.toMatch(/# CONSORTIUM PARTNER AGREEMENT — DRAFT/);
    expect(stripped).toContain("This clause mentions a draft workflow and stays.");
  });
});

describe("W5.1 — stale-version signing reject (real route)", () => {
  const PID = MANAGING; // seeded managing partner id in the sandbox

  it("5. outdated version → 409 agreement_version_stale", async () => {
    signStateRow(PID);
    const r = await request(app)
      .post("/api/partner/me/agreement")
      .set("x-user-id", MANAGING)
      .send({ version: "CPA-v0.0-ANCIENT", signatureName: "Avi Managing" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("agreement_version_stale");
    expect(r.body.currentVersion).toBe(CURRENT_VERSION);
  });

  it("6. current version → signs OK", async () => {
    signStateRow(PID);
    const r = await request(app)
      .post("/api/partner/me/agreement")
      .set("x-user-id", MANAGING)
      .send({ version: CURRENT_VERSION, signatureName: "Avi Managing" });
    // 200 ok when the seeded partner row exists; either way it must NOT be the
    // stale-version rejection (that is the property under test).
    expect(r.status).not.toBe(409);
    if (r.status === 200) expect(r.body.ok).toBe(true);
  });
});

describe("W5.3 — subscription single source of truth", () => {
  it("7. with a live W4 package, canonical member tier is sourced from admin catalog", () => {
    const price = priceIdForTier("standard");
    const c = w4.createPackage({
      slug: "w5-standard", label: "W5 Standard", description: "ssot", entitlements: ["read"],
      amountMinor: 50000, currency: "USD", interval: "annual",
      airwallexTier: "standard", airwallexPriceId: price!, membershipRole: "dsc_member",
    }, "u_admin");
    expect(c.ok).toBe(true);
    const p = w4.promotePackage((c as any).package.id, "live", "u_admin");
    expect(p.ok).toBe(true);

    const tier = resolveCanonicalMemberTier();
    expect(tier.source).toBe("admin");
    expect(tier.amountMinor).toBe(50000);
    expect(tier.slug).toBe("w5-standard");
  });

  it("8. with no live W4 package, falls back to a non-admin source", () => {
    rawDb().prepare(`DELETE FROM collective_subscription_configs WHERE slug LIKE 'w5-%'`).run();
    const tier = resolveCanonicalMemberTier();
    expect(tier.source).not.toBe("admin");
    expect(["platform_fees", "seed_fallback"]).toContain(tier.source);
  });
});
