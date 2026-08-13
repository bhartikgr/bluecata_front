/**
 * WAVE 4A / REVIEW-C — C-1 + M-1: the JURISDICTION WRITE PATHS.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `WAVE3_REVIEW_C_JURISDICTION.md` finding M-1: three waves shipped a
 * jurisdiction fix and the headline defect still reproduced, because **every
 * jurisdiction test in the repo tests the RESOLVER, not the ROUTES**
 * (`shared/__tests__/wave3c_jurisdiction.test.ts` = the shared module,
 * `server/__tests__/wave3c_jurisdiction_backfill.test.ts` = the repair script).
 * A suite that only tests `resolveSpvJurisdiction()` can never catch a caller
 * that bypasses `resolveSpvJurisdiction()` — and bypassing it is exactly what
 * all six write paths did.
 *
 * So every assertion below goes through the ACTUAL HTTP ROUTE (or, for the two
 * boot-migration paths that have no route, the actual exported function), and
 * asserts on what is STORED plus on the compliance content the GP would then be
 * shown. A unit test on the helper is explicitly not sufficient here.
 *
 * THE DEFECT BEING PINNED (C-1, reproduced end to end by the reviewer):
 *   GP types "Netherlands" → isSpvJurisdiction("Netherlands") is case-sensitive
 *   → false → row stored as `delaware` → SpvDetailTabs falls back to the enum
 *   → the Dutch vehicle is shown "Form D filed with the SEC", "Blue-sky / state
 *   notice filings", the 3(c)(1) ~100 cap and "Tax ID / EIN obtained".
 *
 * THE SIX SITES (five named by the review, plus one it did not find):
 *   1. server/spvEngineStore.ts        normJur in migrateLegacyPartnerSpvAndFunds
 *   2. server/spvEngineStore.ts        shadowPersistPartnerSpvToEngine
 *   3. server/partnerRoutes.ts         POST /api/partner/me/spvs
 *   4. server/partnerRoutes.ts         POST /api/partner/me/funds
 *   5. server/lib/partnerFeeAdminRoutes.ts  POST /api/admin/partners/:id/spvs
 *   6. server/lib/seedDemoData.ts      the demo seed (FOUND BY THIS WAVE)
 *
 * PLUS the review's "unrepairable rows" requirement: the boot-migration paths
 * discarded the original free text, so scripts/backfill_spv_jurisdiction.ts
 * classified those rows `skip-no-country` and could never repair them. The
 * raw text is now preserved on `terms.legacyJurisdiction` — no new column, no
 * migration (see WAVE4A_REPORT.md §5.2a).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerFeeAdminRoutes } from "../lib/partnerFeeAdminRoutes";
import { seedTestPartnerSandbox, partnerSpvStore } from "../partnerWorkspaceStore";
import {
  spvEngineStore,
  shadowPersistPartnerSpvToEngine,
  migrateLegacyPartnerSpvAndFunds,
} from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  resolveSpvJurisdiction,
  spvJurisdictionCompliance,
  type SpvJurisdiction,
} from "../../shared/spvEngine";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;
const post = (p: string, user: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", user).send(body ?? {});

const REPO = path.resolve(__dirname, "..", "..");
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf-8");

/** The four US-only strings the review names. Case-insensitive, and "3(c)(1)"
 *  is matched loosely so a re-worded cap sentence cannot slip through. */
const US_ONLY_PATTERNS: Array<[string, RegExp]> = [
  ["Form D", /form\s*d\b/i],
  ["blue-sky", /blue[-\s]?sky/i],
  ["3(c)(1)", /3\s*\(\s*c\s*\)\s*\(\s*1\s*\)/i],
  ["EIN", /\bEIN\b|employer identification/i],
];

/**
 * Re-implements EXACTLY what the GP-facing UI does with a stored row
 * (client/src/components/partner/SpvDetailTabs.tsx:210-212): prefer
 * `terms.jurisdictionCountry`, fall back to the stored enum column, hand the
 * result to the ontology. Asserting on the stored enum alone would not prove
 * the leak is closed — the leak is in what this resolution renders.
 */
function complianceTextForStoredRow(spv: {
  jurisdiction: string;
  terms: Record<string, unknown> | null;
}): { code: SpvJurisdiction; text: string } {
  const country =
    typeof spv.terms?.jurisdictionCountry === "string" ? spv.terms.jurisdictionCountry : "";
  const resolved = (country.trim() || spv.jurisdiction) ?? null;
  const compliance = spvJurisdictionCompliance(resolved);
  return { code: compliance.code, text: JSON.stringify(compliance) };
}

function expectNoUsSecuritiesContent(spv: {
  name?: string;
  jurisdiction: string;
  terms: Record<string, unknown> | null;
}) {
  const { text } = complianceTextForStoredRow(spv);
  for (const [label, re] of US_ONLY_PATTERNS) {
    expect(
      re.test(text),
      `${spv.name ?? "vehicle"} (stored jurisdiction "${spv.jurisdiction}") must NOT be shown US-only content: ${label}`,
    ).toBe(false);
  }
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerFeeAdminRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO contacts (id, kind, legal_name, display_name, email, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id)
       VALUES (?, 'consortium_partner', 'TEST PARTNER, INC', 'TEST PARTNER, INC', 'ops@test-partner.example', 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed', 1, ?, ?, 'tenant_platform')`,
    )
    .run(PARTNER_A, now, now, "0".repeat(64), "0".repeat(64));
});

/* ══════════════════════════════════════════════════════════════════════════
   SITE 3 — POST /api/partner/me/spvs   (the route the LIVE defect came in on)
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 site 3 — legacy SPV create route stores the real jurisdiction", () => {
  /** [free text the GP types, expected stored enum] */
  const CASES: Array<[string, SpvJurisdiction]> = [
    ["Netherlands", "netherlands"],
    ["Cayman Islands", "cayman"],
    ["British Virgin Islands", "bvi"],
    ["United Kingdom", "united_kingdom"],
    ["Singapore", "singapore"],
    ["Luxembourg", "luxembourg"],
  ];

  for (const [typed, expected] of CASES) {
    it(`"${typed}" is stored as "${expected}", NOT delaware, and shows no US securities content`, async () => {
      const r = await post("/api/partner/me/spvs", MANAGING, {
        spvName: `C1 Route SPV ${typed}`,
        jurisdiction: typed,
        vintage: 2026,
        currency: "USD",
        status: "open",
        signoffLegalName: "Test Managing Partner",
        signoffAccepted: true,
      });
      expect(r.status).toBe(201);

      // Read back from the CANONICAL store — what is actually persisted.
      const stored = spvEngineStore.getSpv(PARTNER_A, r.body.spv.id as string);
      expect(stored).not.toBeNull();
      expect(stored!.jurisdiction).toBe(expected);
      expect(stored!.jurisdiction).not.toBe("delaware");

      // The original free text survives (provenance, and the backfill's input).
      expect((stored!.terms as Record<string, unknown>).legacyJurisdiction).toBe(typed);

      // And the GP is not shown Form D / blue-sky / 3(c)(1) / EIN.
      expectNoUsSecuritiesContent(stored as never);
    });
  }

  it("an UNMAPPABLE country resolves to \"other\" — never a guessed US state", async () => {
    const r = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "C1 Route SPV Wakanda",
      jurisdiction: "Wakanda",
      vintage: 2026,
      currency: "USD",
      status: "open",
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.getSpv(PARTNER_A, r.body.spv.id as string)!;
    expect(stored.jurisdiction).toBe("other");
    expect(stored.jurisdiction).not.toBe("delaware");
    expectNoUsSecuritiesContent(stored as never);
    // Still repairable later: the raw text was not thrown away.
    expect((stored.terms as Record<string, unknown>).legacyJurisdiction).toBe("Wakanda");
  });

  it("a genuinely US vehicle KEEPS its US content (no over-correction)", async () => {
    const r = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "C1 Route SPV Delaware",
      jurisdiction: "State of Delaware, USA",
      vintage: 2026,
      currency: "USD",
      status: "open",
      signoffLegalName: "Test Managing Partner",
      signoffAccepted: true,
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.getSpv(PARTNER_A, r.body.spv.id as string)!;
    expect(stored.jurisdiction).toBe("delaware");
    const { text } = complianceTextForStoredRow(stored as never);
    for (const [, re] of US_ONLY_PATTERNS) expect(re.test(text)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SITE 4 — POST /api/partner/me/funds
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 site 4 — legacy FUND create route stores the real jurisdiction", () => {
  it("a Cayman fund is stored as cayman and shows no US securities content", async () => {
    const r = await post("/api/partner/me/funds", MANAGING, {
      fundName: "C1 Route Fund Cayman",
      fundType: "closed_end",
      jurisdiction: "Cayman Islands",
      vintage: 2026,
      currency: "USD",
      status: "raising",
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.getSpv(PARTNER_A, r.body.fund.id as string)!;
    expect(stored.jurisdiction).toBe("cayman");
    expect((stored.terms as Record<string, unknown>).legacyJurisdiction).toBe("Cayman Islands");
    expectNoUsSecuritiesContent(stored as never);
  });

  it("an unmappable fund jurisdiction resolves to \"other\", not delaware", async () => {
    const r = await post("/api/partner/me/funds", MANAGING, {
      fundName: "C1 Route Fund Atlantis",
      fundType: "evergreen",
      jurisdiction: "Atlantis",
      vintage: 2026,
      currency: "USD",
      status: "raising",
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.getSpv(PARTNER_A, r.body.fund.id as string)!;
    expect(stored.jurisdiction).toBe("other");
    expectNoUsSecuritiesContent(stored as never);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SITE 5 — POST /api/admin/partners/:partnerId/spvs
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 site 5 — admin SPV create route stores the real jurisdiction", () => {
  it("an admin-created Jersey SPV is stored as jersey and shows no US content", async () => {
    const r = await post(`/api/admin/partners/${PARTNER_A}/spvs`, MANAGING, {
      spvName: "C1 Admin SPV Jersey",
      jurisdiction: "Jersey",
      vintage: 2026,
      currency: "USD",
      status: "open",
    });
    expect(r.status).toBeLessThan(300);
    const created = spvEngineStore
      .listByPartner(PARTNER_A)
      .find((s) => s.name === "C1 Admin SPV Jersey")!;
    expect(created).toBeTruthy();
    expect(created.jurisdiction).toBe("jersey");
    expect((created.terms as Record<string, unknown>).legacyJurisdiction).toBe("Jersey");
    expectNoUsSecuritiesContent(created as never);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SITE 2 — shadowPersistPartnerSpvToEngine (no route; called from the store)
   This is one of the two paths the review calls UNREPAIRABLE, because it used
   to coerce to delaware AND drop the free text.
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 site 2 — shadow persist coerces correctly AND keeps the text", () => {
  it("a Dutch shadow-persisted row is netherlands with legacyJurisdiction retained", () => {
    shadowPersistPartnerSpvToEngine({
      legacyId: "pspv_c1_shadow_nl",
      partnerId: PARTNER_A,
      name: "C1 Shadow NL",
      jurisdiction: "Netherlands",
      currency: "EUR",
      status: "open",
    });
    const row = spvEngineStore.listByPartner(PARTNER_A).find((s) => s.name === "C1 Shadow NL")!;
    expect(row).toBeTruthy();
    expect(row.jurisdiction).toBe("netherlands");
    expect((row.terms as Record<string, unknown>).legacyJurisdiction).toBe("Netherlands");
    expectNoUsSecuritiesContent(row as never);
  });

  it("an unmappable shadow-persisted row is \"other\" and is still REPAIRABLE", () => {
    shadowPersistPartnerSpvToEngine({
      legacyId: "pspv_c1_shadow_unknown",
      partnerId: PARTNER_A,
      name: "C1 Shadow Unknown",
      jurisdiction: "Ruritania",
      currency: "USD",
      status: "open",
    });
    const row = spvEngineStore.listByPartner(PARTNER_A).find((s) => s.name === "C1 Shadow Unknown")!;
    expect(row.jurisdiction).toBe("other");
    // THE REPAIRABILITY CONTRACT: backfill_spv_jurisdiction.ts:126-127 reads
    // terms.jurisdictionCountry then terms.legacyJurisdiction. A row with
    // neither is classified `skip-no-country` and can never be repaired.
    const terms = row.terms as Record<string, unknown>;
    const repairInput = terms?.jurisdictionCountry ?? terms?.legacyJurisdiction;
    expect(repairInput, "row must not be skip-no-country").toBe("Ruritania");
  });

  it("no jurisdiction text at all does not fabricate one", () => {
    shadowPersistPartnerSpvToEngine({
      legacyId: "pspv_c1_shadow_blank",
      partnerId: PARTNER_A,
      name: "C1 Shadow Blank",
      jurisdiction: "   ",
      currency: "USD",
      status: "open",
    });
    const row = spvEngineStore.listByPartner(PARTNER_A).find((s) => s.name === "C1 Shadow Blank")!;
    expect(row.jurisdiction).toBe("other");
    expect((row.terms as Record<string, unknown> | null)?.legacyJurisdiction).toBeUndefined();
    expectNoUsSecuritiesContent(row as never);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SITE 1 — migrateLegacyPartnerSpvAndFunds (the BOOT migration). The other
   half of the review's "unrepairable rows" finding: it coerced to delaware and
   copied only entityStructure/fundType into terms, so the repair tool saw no
   country and skipped the row forever.
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 site 1 — the BOOT migration is correct AND leaves rows repairable", () => {
  it("a legacy BVI row migrates to bvi, keeps its text, and shows no US content", () => {
    const legacy = partnerSpvStore.create(
      PARTNER_A,
      {
        spvName: "C1 Boot Migration BVI",
        jurisdiction: "British Virgin Islands",
        vintage: 2026,
        currency: "USD",
        status: "open",
      },
      MANAGING,
    );
    migrateLegacyPartnerSpvAndFunds();
    const row = spvEngineStore
      .listByPartner(PARTNER_A)
      .find((s) => s.migratedFrom === legacy.id);
    expect(row, "boot migration should have produced a canonical row").toBeTruthy();
    expect(row!.jurisdiction).toBe("bvi");
    expect(row!.jurisdiction).not.toBe("delaware");
    expectNoUsSecuritiesContent(row as never);
    const terms = row!.terms as Record<string, unknown> | null;
    expect(terms?.jurisdictionCountry ?? terms?.legacyJurisdiction).toBe(
      "British Virgin Islands",
    );
  });

  it("an unmappable legacy row migrates to \"other\" and is NOT skip-no-country", () => {
    const legacy = partnerSpvStore.create(
      PARTNER_A,
      {
        spvName: "C1 Boot Migration Elbonia",
        jurisdiction: "Elbonia",
        vintage: 2026,
        currency: "USD",
        status: "open",
      },
      MANAGING,
    );
    migrateLegacyPartnerSpvAndFunds();
    const row = spvEngineStore
      .listByPartner(PARTNER_A)
      .find((s) => s.migratedFrom === legacy.id)!;
    expect(row.jurisdiction).toBe("other");
    const terms = row.terms as Record<string, unknown> | null;
    expect(terms?.jurisdictionCountry ?? terms?.legacyJurisdiction).toBe("Elbonia");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SOURCE SENTINELS — the regression that actually keeps recurring is a NEW
   caller re-introducing the literal fallback. These fail loudly if it does.
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 — no write path may re-introduce a hard-coded delaware fallback", () => {
  const FILES = [
    "server/spvEngineStore.ts",
    "server/partnerRoutes.ts",
    "server/lib/partnerFeeAdminRoutes.ts",
    "server/lib/seedDemoData.ts",
  ];

  for (const f of FILES) {
    it(`${f} contains no \`? … : "delaware"\` coercion and no bare delaware default`, () => {
      const src = readSrc(f);
      // Strip comments — every one of these files now DISCUSSES "delaware" in a
      // comment explaining why the fallback is gone; that must not trip us.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(/:\s*"delaware"/.test(code), `${f} still ternary-coerces to delaware`).toBe(false);
      expect(/\?\?\s*"delaware"/.test(code), `${f} still ??-defaults to delaware`).toBe(false);
      expect(/jurisdiction:\s*"delaware"/.test(code), `${f} still hard-codes delaware`).toBe(false);
    });
  }

  for (const f of FILES) {
    it(`${f} imports resolveSpvJurisdiction (the ONE coercion policy)`, () => {
      expect(readSrc(f)).toMatch(/resolveSpvJurisdiction/);
    });
  }

  it("the enum VALIDATOR on the canonical create path is untouched", () => {
    // spvEngineStore.ts:307 rejects an invalid enum with INVALID_JURISDICTION.
    // That is validation, not coercion: swapping it for the resolver would turn
    // a rejected bad input into a silently accepted "other".
    expect(readSrc("server/spvEngineStore.ts")).toMatch(/INVALID_JURISDICTION/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEWER'S OWN MECHANICAL PROBE, kept as a permanent assertion.
   ══════════════════════════════════════════════════════════════════════════ */
describe("C-1 — the four inputs the reviewer proved became delaware", () => {
  const PROBES: Array<[string, SpvJurisdiction]> = [
    ["Netherlands", "netherlands"],
    ["British Virgin Islands", "bvi"],
    ["Cayman Islands", "cayman"],
    ["United Kingdom", "united_kingdom"],
  ];
  for (const [input, expected] of PROBES) {
    it(`resolveSpvJurisdiction("${input}") → ${expected}`, () => {
      expect(resolveSpvJurisdiction(input)).toBe(expected);
    });
  }
});
