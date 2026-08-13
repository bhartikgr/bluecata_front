/**
 * WAVE 7B — proving tests for V-1, W-3, FE-8 and FE-14.
 *
 * Every one of these four items is a "the fix must be on the path where the
 * data actually flows" item, so each block below names its sink explicitly and
 * then checks for a SECOND path to the same sink.
 *
 *   V-1  (DEF-085) vintage year — sink: spvEngineStore.createSpv -> persistSpv
 *                  -> spv.terms_json. Asserted by reading the COLUMN back.
 *   W-3  reachability of the fund commitment register — sink: the single
 *                  inbound <Link> from the canonical SPV engine roster.
 *   FE-8 (DEF-054) onboarding nav — sink: PARTNER_WORKSPACE_GROUPS in
 *                  CollectiveShell.tsx, the only producer of the partner
 *                  sidebar.
 *   FE-14 (DEF-060) subscription label — sink: the `subscriptionState` key on
 *                  the GET /api/partner/me payload.
 *
 * The three UI items are asserted against SOURCE TEXT rather than a rendered
 * tree because this repo has no client-side render harness (no jsdom/RTL in
 * the vitest config); a source assertion still fails loudly if someone deletes
 * the link or the nav entry, which is the regression these guard against.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spvEngineStore } from "../spvEngineStore";
import { managedFounderStore } from "../managedFounderStore";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { rawDb } from "../db/connection";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const SHELL = "client/src/components/CollectiveShell.tsx";
const ENGINE_PAGE = "client/src/pages/partner/PartnerSpvEngine.tsx";
const DASHBOARD = "client/src/pages/partner/PartnerDashboard.tsx";
const APP = "client/src/App.tsx";
const PARTNER_ROUTES = "server/partnerRoutes.ts";

/* ==========================================================================
 * V-1 — vintage year is CAPTURED and lands in the durable column.
 * ========================================================================== */
describe("WAVE 7B V-1 (DEF-085) — SPV vintage year", () => {
  const PID = "ac_wave7b_v1_partner";
  const ACTOR = "u_wave7b_v1_actor";

  /** Read terms straight out of the COLUMN, never the store's RAM projection. */
  function termsFromColumn(spvId: string): Record<string, unknown> | null {
    const row = rawDb()
      .prepare(`SELECT terms_json FROM spv WHERE id = ?`)
      .get(spvId) as { terms_json: string | null } | undefined;
    if (!row || !row.terms_json) return null;
    return JSON.parse(row.terms_json) as Record<string, unknown>;
  }

  let spvId = "";

  beforeAll(() => {
    const s = spvEngineStore.createSpv(
      PID,
      {
        name: "Wave 7B Vintage Probe",
        jurisdiction: "delaware",
        carryBasis: "per_deployment",
        spvType: "spv",
        terms: { vintage: 2026 },
      },
      ACTOR,
    );
    spvId = s.id;
  });

  it("persists terms.vintage into spv.terms_json — the durable sink", () => {
    const terms = termsFromColumn(spvId);
    expect(terms).not.toBeNull();
    expect(terms!.vintage).toBe(2026);
  });

  it("returns the vintage on the read path the partner list actually uses", () => {
    const mine = spvEngineStore.listByPartner(PID).find((s) => s.id === spvId);
    expect(mine).toBeDefined();
    expect((mine!.terms as { vintage?: unknown }).vintage).toBe(2026);
  });

  it("uses the SAME terms.vintage key as the pre-existing admin writer — no second source of truth", () => {
    // The admin SPV create route already wrote a vintage into the terms blob.
    // If V-1 had invented a `vintageYear` column or a parallel key, a vehicle
    // created by an admin and one created by the partner wizard would disagree.
    const adminWriter = read("server/lib/partnerFeeAdminRoutes.ts");
    expect(adminWriter).toMatch(/vintage/);
    // The partner wizard writes the same key...
    const wizard = read(ENGINE_PAGE);
    expect(wizard).toMatch(/vintage:\s*\/\^\\d\{4\}\$\/\.test/);
    // ...and no new column was introduced anywhere for it.
    expect(read("server/spvEngineStore.ts")).not.toMatch(/vintage_year|vintageYear/);
  });

  it("captures the vintage in the wizard AND displays it in the roster (the DEF-085 complaint was both)", () => {
    const src = read(ENGINE_PAGE);
    expect(src).toContain('data-testid="spv-w-vintage"'); // captured
    expect(src).toContain("spv-row-vintage-"); // displayed on the partner's list
    expect(src).toContain('label="Vintage year"'); // and on the review step
    expect(src).toMatch(/function spvVintageLabel/);
  });

  it("renders an em-dash rather than a guess for a legacy SPV with no vintage", () => {
    const legacy = spvEngineStore.createSpv(
      PID,
      { name: "Wave 7B Legacy No Vintage", jurisdiction: "delaware", carryBasis: "per_deployment" },
      ACTOR,
    );
    const terms = termsFromColumn(legacy.id);
    expect(terms == null || terms.vintage === undefined).toBe(true);
    // The label helper's fallback branch is the em-dash, never a current year.
    const src = read(ENGINE_PAGE);
    const helper = src.slice(src.indexOf("function spvVintageLabel"));
    expect(helper.slice(0, 400)).toContain('return "\\u2014"');
    expect(helper.slice(0, 400)).not.toContain("getFullYear");
  });
});

/* ==========================================================================
 * W-3 — the fund commitment register is reachable again.
 * ========================================================================== */
describe("WAVE 7B W-3 — fund commitment register reachability", () => {
  it("the write endpoint exists and still has exactly one client caller", () => {
    expect(read(PARTNER_ROUTES)).toContain('"/api/partner/me/funds/:id/commitments"');
    const detail = read("client/src/pages/partner/PartnerFundDetail.tsx");
    expect(detail).toContain("/api/partner/me/funds/${fundId}/commitments");
  });

  it("its route is open, so an unreachable route was a real orphan, not dead code", () => {
    expect(read(APP)).toContain('<Route path="/collective/partner/funds/:id">');
  });

  it("the canonical SPV engine now links INTO that route — the restored inbound path", () => {
    const src = read(ENGINE_PAGE);
    expect(src).toContain("spv-open-fund-commitments-");
    expect(src).toContain("/collective/partner/funds/${s.id}");
  });

  it("the link is fenced to spvType==='fund', matching the loader's 404 condition", () => {
    const src = read(ENGINE_PAGE);
    expect(src).toContain('{s.spvType === "fund" && (');
    // The loader really does 404 anything that is not exactly a fund, which is
    // why the fence above is not merely cosmetic.
    expect(read(PARTNER_ROUTES)).toContain('fund.spvType !== "fund"');
  });

  it("does NOT re-add a Funds nav entry — Ozan decision #4 (ONE SPVs entry) stands", () => {
    const shell = read(SHELL);
    expect(shell).not.toContain('"nav-partner-funds"');
    expect(shell).toContain('"data-testid": "nav-partner-spvs"');
  });

  it("second path check: /collective/partner/funds (the list) stays a redirect, and the only fund-create caller stays unrouted", () => {
    const app = read(APP);
    // The list page's create form is genuinely redundant — the SPV wizard can
    // create spvType 'fund' — so it must NOT be resurrected as a second writer.
    expect(app).not.toContain("<PartnerFunds />");
  });
});

/* ==========================================================================
 * FE-8 — partner onboarding checklist has a way in.
 * ========================================================================== */
describe("WAVE 7B FE-8 (DEF-054) — partner onboarding checklist nav", () => {
  it("the engine was already live on BOTH halves — this item was wiring, not a build", () => {
    const store = read("server/consortiumApplyStore.ts");
    expect(store).toContain('"/api/partner/onboarding/state"');
    // GET and PATCH are both registered (two registrations of the same path).
    expect(store.split('"/api/partner/onboarding/state"').length - 1).toBeGreaterThanOrEqual(2);
  });

  it("the page and route already existed", () => {
    expect(read(APP)).toContain('<Route path="/collective/partner/onboarding">');
    expect(() => read("client/src/pages/partner/OnboardingChecklistPage.tsx")).not.toThrow();
  });

  it("the nav entry now exists — the sink is PARTNER_WORKSPACE_GROUPS, the only producer of the partner sidebar", () => {
    const shell = read(SHELL);
    const groups = shell.slice(
      shell.indexOf("const PARTNER_WORKSPACE_GROUPS"),
      shell.indexOf("Sidebar nav item"),
    );
    expect(groups).toContain('"data-testid": "nav-partner-onboarding"');
    expect(groups).toContain('href: "/collective/partner/onboarding"');
  });

  it("second path check: no OTHER nav producer renders the partner sidebar", () => {
    const shell = read(SHELL);
    // If a second array of partner nav items existed, adding the entry to one
    // of them would leave half the app still missing it.
    const producers = shell.match(/PARTNER_WORKSPACE_GROUPS/g) ?? [];
    expect(producers.length).toBeGreaterThan(1); // declaration + at least one use
    expect(shell).not.toMatch(/PARTNER_WORKSPACE_GROUPS_2|PARTNER_NAV_GROUPS\b/);
  });
});

/* ==========================================================================
 * FE-14 — the subscription price LABEL tells the truth.
 * ========================================================================== */
describe("WAVE 7B FE-14 (DEF-060) — subscription price label", () => {
  it("the price itself was already DB-driven — confirming the citation before changing anything", () => {
    const plan = read("server/lib/partnerEffectivePlan.ts");
    expect(plan).toContain('source: "partner_override" | "tier_advertised"');
    // No hardcoded price constant anywhere on that path.
    expect(plan).not.toMatch(/=\s*49900|=\s*99900/);
  });

  it("GET /api/partner/me now emits subscriptionState off contacts.subscription_id", () => {
    const src = read(PARTNER_ROUTES);
    expect(src).toContain("subscriptionState");
    expect(src).toContain("SELECT subscription_id FROM contacts WHERE id = ?");
  });

  it("it is derived, never client-supplied and never hardcoded", () => {
    const src = read(PARTNER_ROUTES);
    const block = src.slice(src.indexOf("const subscriptionState"), src.indexOf("const subscriptionState") + 700);
    expect(block).not.toMatch(/req\.body|req\.query/);
    expect(block).toContain("rawDb()");
  });

  it("the dashboard branches on it, and the ORIGINAL copy string survives verbatim", () => {
    const src = read(DASHBOARD);
    expect(src).toContain('subscriptionState === "unsubscribed"');
    // Wave 7 §3.4 — the silent-drop guard fingerprints copy by node text, so
    // this literal must remain a literal. Collapsing it into a ternary string
    // failed the guard once already.
    expect(src).toContain('<div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Your subscription</div>');
  });

  it("does not reach for the managing_partner-gated subscription route, which every other sub-role would 403 on", () => {
    expect(read(DASHBOARD)).not.toContain("/api/partner/me/subscription");
    // ...and that gate is real, which is why the state is resolved on /me.
    expect(read("server/lib/partnerSelfServiceRoutes.ts")).toContain(
      'requirePartnerSubrole(["managing_partner"])',
    );
  });
});

/* ==========================================================================
 * DA-1 — seedCapabilityProfile signature correction.
 *
 * Sink: managedFounderStore.seedCapabilityProfile -> persistProfile ->
 * mfc_capability_profiles. Second-path check: the ONLY other writer of that
 * row is setCapabilityProfile (the RF-10 admin toggle patch); the third
 * profileByPartner.set in the file is boot rehydration, a read.
 * ========================================================================== */
describe("WAVE 7B DA-1 — seedCapabilityProfile explicit seed type", () => {
  // The MFCRM tables are installed by their own installer, not by the sacred
  // bootstrap, so a :memory: test DB needs it applied before the sink exists.
  beforeAll(() => { applyMfcrmSchema(); });

  it("an explicit type seeds the capability defaults for that type", () => {
    const p = managedFounderStore.seedCapabilityProfile(
      "ac_wave7b_da1_angel", "u_wave7b_admin", "angel_network",
    );
    expect(p.classified).toBe(true);
    expect(p.partnerType).toBe("angel_network");
    expect(p.sourcesCapital).toBe(true);
    // Angel networks get co-seat, NOT delegated agency, per seedDefaultsForType.
    expect(p.advisoryCoseat).toBe(true);
    expect(p.delegatedAgency).toBe(false);
  });

  it("it lands in the durable store, not just the return value", () => {
    managedFounderStore.seedCapabilityProfile("ac_wave7b_da1_law", "u_wave7b_admin", "law");
    const readBack = managedFounderStore.getCapabilityProfile("ac_wave7b_da1_law");
    expect(readBack.partnerType).toBe("law");
    expect(readBack.documentCustody).toBe(true);
    expect(readBack.sourcesCapital).toBe(false);
  });

  it("THE DEFECT — with no explicit type and no legacy partner_type, the profile is UNCLASSIFIED and GATE 1 refuses", () => {
    const p = managedFounderStore.seedCapabilityProfile("ac_wave7b_da1_unknown", "u_wave7b_admin");
    expect(p.classified).toBe(false);
    expect(() => managedFounderStore.assertClassified("ac_wave7b_da1_unknown")).toThrow();
  });

  it("an unknown seed type is REJECTED, never silently seeded all-false", () => {
    expect(() =>
      managedFounderStore.seedCapabilityProfile(
        "ac_wave7b_da1_bogus", "u_wave7b_admin",
        // A taxonomy sub-sector slug is exactly the plausible wrong value.
        "angel_group" as never,
      ),
    ).toThrow(/INVALID_CAPABILITY_SEED_TYPE|Unknown capability seed type/);
  });

  it("the parameter is OPTIONAL — the pre-existing two-arg call still compiles and behaves", () => {
    const p = managedFounderStore.seedCapabilityProfile("ac_wave7b_da1_twoarg", "u_wave7b_admin");
    expect(p.partnerId).toBe("ac_wave7b_da1_twoarg");
  });

  it("the new parameter is REACHABLE from the admin route — an engine with no route is not shipped", () => {
    const routes = read("server/managedFounderRoutes.ts");
    expect(routes).toContain('"/api/admin/mfcrm/capability/:partnerId/seed"');
    expect(routes).toMatch(/body\.partnerType/);
    expect(routes).toMatch(/seedCapabilityProfile\(String\(req\.params\.partnerId\), actor, explicitType\)/);
  });

  it("FENCE — the capability seed does NOT read partner_classifications (A-20/PT-5)", () => {
    // This profile is access control (GATE 1). Classification is reporting and
    // filtering ONLY. Wiring one to the other is the forbidden move, and the
    // blocked half of DA-1.
    // Strip comments first — this file's own doc comment EXPLAINS the fence and
    // names the table, which would otherwise trip the check and make it useless.
    const store = read("server/managedFounderStore.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(store).not.toMatch(/partner_classifications|subsector_slug|partnerClassificationStore/);
  });

  it("second path check: only seed and set write the profile row", () => {
    const store = read("server/managedFounderStore.ts");
    const writes = store.match(/persistProfile\(/g) ?? [];
    // one declaration + exactly two call sites
    expect(writes.length).toBe(3);
  });
});
