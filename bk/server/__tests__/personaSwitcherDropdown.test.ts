/**
 * v19 Wave A / Change 4 — PersonaSwitcher dropdown contract tests.
 *
 * Tests the pure-function surface of `PersonaSwitcher.tsx`:
 *   • PERSONA_OPTIONS exposes exactly 4 personas
 *     (capavate, collective, partner, admin)
 *   • Each persona has the right portal key, href, and label
 *   • `entitledPersonas` correctly gates options by UserContext
 *
 * No React rendering — vitest in this repo runs without jsdom, so we test the
 * logic layer. UI-render coverage is handled by Playwright e2e later.
 *
 * Math-sacred zones are NOT touched.
 */
import { describe, it, expect } from "vitest";
import {
  PERSONA_OPTIONS,
  entitledPersonas,
  type Persona,
} from "../../client/src/components/PersonaSwitcher";

type FakeCtx = {
  isAdmin?: boolean;
  founderCompanies?: number;
  capTablePositions?: number;
  collectiveStatus?: "active" | "lapsed" | "suspended" | "pending" | "applied" | "none";
  investorState?: string;
};

function makeCtx(opts: FakeCtx): any {
  return {
    isAdmin: opts.isAdmin ?? false,
    founder: { companies: Array.from({ length: opts.founderCompanies ?? 0 }, (_, i) => `co_${i}`) },
    investor: {
      capTablePositions: Array.from({ length: opts.capTablePositions ?? 0 }, (_, i) => `pos_${i}`),
      state: opts.investorState ?? "NONE",
    },
    collective: { status: opts.collectiveStatus ?? "none" },
  };
}

describe("PersonaSwitcher — PERSONA_OPTIONS", () => {
  it("defines exactly 4 personas", () => {
    expect(PERSONA_OPTIONS.length).toBe(4);
  });

  it("includes Capavate / Collective / Consortium Partner / Admin", () => {
    const ids = PERSONA_OPTIONS.map((p) => p.id).sort();
    expect(ids).toEqual(["admin", "capavate", "collective", "partner"]);
  });

  it("each persona has a label, portalKey, and href", () => {
    for (const p of PERSONA_OPTIONS) {
      expect(p.label).toBeTruthy();
      expect(p.portalKey).toBeTruthy();
      expect(p.href.startsWith("/")).toBe(true);
    }
  });

  it("portalKey values match the spec (founder|investor|admin|collective|partner)", () => {
    const map = Object.fromEntries(PERSONA_OPTIONS.map((p) => [p.id, p.portalKey]));
    expect(map.capavate).toBe("founder");
    expect(map.collective).toBe("collective");
    expect(map.partner).toBe("partner");
    expect(map.admin).toBe("admin");
  });

  it("hrefs route to the correct first-page per persona", () => {
    const map = Object.fromEntries(PERSONA_OPTIONS.map((p) => [p.id, p.href]));
    expect(map.capavate).toBe("/founder/dashboard");
    expect(map.collective).toBe("/collective");
    expect(map.partner).toBe("/collective/partner/dashboard");
    expect(map.admin).toBe("/admin/dashboard");
  });

  it("Consortium Partner label uses the spec wording", () => {
    const partner = PERSONA_OPTIONS.find((p) => p.id === "partner")!;
    expect(partner.label).toMatch(/consortium/i);
    expect(partner.label).toMatch(/partner/i);
  });
});

describe("PersonaSwitcher — entitledPersonas() gating", () => {
  it("null context yields empty set (no personas)", () => {
    expect(entitledPersonas(null).size).toBe(0);
    expect(entitledPersonas(undefined).size).toBe(0);
  });

  it("admin sees all 4 personas", () => {
    const ctx = makeCtx({ isAdmin: true });
    const set = entitledPersonas(ctx);
    const allowed: Persona[] = ["capavate", "collective", "partner", "admin"];
    for (const p of allowed) {
      expect(set.has(p), `admin should see ${p}`).toBe(true);
    }
  });

  it("founder-only (1 company, no Collective) sees ONLY capavate", () => {
    const ctx = makeCtx({ founderCompanies: 1, collectiveStatus: "none" });
    const set = entitledPersonas(ctx);
    expect(set.has("capavate")).toBe(true);
    expect(set.has("collective")).toBe(false);
    expect(set.has("partner")).toBe(false);
    expect(set.has("admin")).toBe(false);
  });

  it("founder with active Collective company sees capavate + collective", () => {
    const ctx = makeCtx({ founderCompanies: 1, collectiveStatus: "active" });
    const set = entitledPersonas(ctx);
    expect(set.has("capavate")).toBe(true);
    expect(set.has("collective")).toBe(true);
    // No partner / admin unless explicitly admin.
    expect(set.has("partner")).toBe(false);
    expect(set.has("admin")).toBe(false);
  });

  it("investor with cap-table + active Collective sees collective (not capavate)", () => {
    const ctx = makeCtx({ capTablePositions: 1, collectiveStatus: "active" });
    const set = entitledPersonas(ctx);
    expect(set.has("collective")).toBe(true);
    // No founder companies → no Capavate.
    expect(set.has("capavate")).toBe(false);
  });

  it("lapsed Collective hides the collective option", () => {
    const ctx = makeCtx({ capTablePositions: 1, collectiveStatus: "lapsed" });
    const set = entitledPersonas(ctx);
    expect(set.has("collective")).toBe(false);
  });

  it("partner is admin-gated (non-admin never sees it in default flow)", () => {
    const ctx = makeCtx({ founderCompanies: 1, collectiveStatus: "active" });
    expect(entitledPersonas(ctx).has("partner")).toBe(false);
  });

  it("admin always sees the Admin persona", () => {
    expect(entitledPersonas(makeCtx({ isAdmin: true })).has("admin")).toBe(true);
  });
});
