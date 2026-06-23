/**
 * v23.4.7 Phase 7 / BUG 002 — Role/Persona toggle filter.
 *
 * The dropdown must NEVER list a persona the user is not a member of:
 *   - Capavate    → only when founder.companies.length > 0 (or admin).
 *   - Collective  → only when investor.state !== "NONE" (or founder of an
 *                   active Collective company, or admin).
 *   - Partner     → admin only.
 *   - Admin       → admin only.
 */
import { describe, it, expect } from "vitest";
import { entitledPersonas } from "../PersonaSwitcher";
import type { UserContext } from "@/lib/entitlement";

function baseCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "u_test",
    identity: { email: "test@example.com", name: "Test User" },
    founder: { companies: [], activeCompanyId: null },
    investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
    collective: { status: "none", role: null, expiresAt: null },
    isAdmin: false,
    isAuthed: true,
    ...overrides,
  } as UserContext;
}

describe("v23.4.7 Phase 7 / BUG 002 — entitledPersonas filters by membership", () => {
  it("founder with no investor state and no Collective sees ONLY Capavate", () => {
    const ctx = baseCtx({
      founder: {
        companies: [
          { id: "co_1", name: "Acme", role: "ceo", logoUrl: null, tenantId: "t1" } as any,
        ],
        activeCompanyId: "co_1",
      },
    });
    const set = entitledPersonas(ctx);
    expect(set.has("capavate")).toBe(true);
    expect(set.has("collective")).toBe(false);
    expect(set.has("partner")).toBe(false);
    expect(set.has("admin")).toBe(false);
  });

  it("plain investor with no founder companies and no admin sees ONLY Collective", () => {
    const ctx = baseCtx({
      investor: {
        invitedRounds: [],
        capTablePositions: [],
        state: "INVITED_ONLY",
      },
    });
    const set = entitledPersonas(ctx);
    expect(set.has("capavate")).toBe(false);
    expect(set.has("collective")).toBe(true);
    expect(set.has("partner")).toBe(false);
    expect(set.has("admin")).toBe(false);
  });

  it("non-member user with everything empty sees no personas", () => {
    const ctx = baseCtx();
    const set = entitledPersonas(ctx);
    expect(set.size).toBe(0);
  });

  it("admin sees Capavate, Partner, and Admin (and Collective via predicate)", () => {
    const ctx = baseCtx({ isAdmin: true });
    const set = entitledPersonas(ctx);
    expect(set.has("capavate")).toBe(true);
    expect(set.has("admin")).toBe(true);
    expect(set.has("partner")).toBe(true);
  });

  it("null context returns empty set", () => {
    expect(entitledPersonas(null).size).toBe(0);
    expect(entitledPersonas(undefined).size).toBe(0);
  });
});
