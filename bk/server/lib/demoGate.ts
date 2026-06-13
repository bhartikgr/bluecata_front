/**
 * Patch v4 — Demo Seed Gate
 *
 * Single env-driven switch that controls whether server/mockData.ts (and any
 * other in-memory seed) populates with demo personas (Maya Chen / NovaPay /
 * Aisha Patel / etc.) or starts empty.
 *
 * Production (NODE_ENV=production) NEVER seeds, regardless of env. This is a
 * defense-in-depth invariant: even if someone accidentally sets
 * ENABLE_DEMO_SEED=1 in production, the gate stays closed.
 *
 * Dev / staging / test enable seeding by setting:
 *   ENABLE_DEMO_SEED=1
 *
 * Consumers MUST import `DEMO_SEED_ENABLED` and use it to decide whether to
 * populate seeded arrays/records. The shape of every exported value must
 * remain identical between the two states so that TypeScript types compile
 * and existing importers don't break.
 */

export const DEMO_SEED_ENABLED: boolean =
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_DEMO_SEED === "1";

/**
 * Test-only helper to inspect current gate state for assertions.
 */
export function isDemoSeedEnabled(): boolean {
  return DEMO_SEED_ENABLED;
}
