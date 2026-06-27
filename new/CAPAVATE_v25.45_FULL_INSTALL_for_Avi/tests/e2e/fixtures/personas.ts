/**
 * Seeded persona credentials for Wave F3 E2E tests.
 *
 * These map to fixtures created by `scripts/seed_demo.ts` when the dev server
 * boots with `ENABLE_DEMO_SEED=1`. If seed data changes, update here in lockstep.
 */
export interface Persona {
  email: string;
  password: string;
  role: "founder" | "investor" | "admin" | "partner";
  homePath: string; // post-login landing path (no leading hash)
}

export const PERSONAS = {
  founder: {
    email: "maya@novapay.ai",
    password: "password123",
    role: "founder",
    homePath: "/founder/dashboard",
  },
  investor: {
    email: "aisha@greenwood.capital",
    password: "password123",
    role: "investor",
    homePath: "/investor/dashboard",
  },
  admin: {
    email: "admin@capavate.io",
    password: "adminpass",
    role: "admin",
    homePath: "/admin/dashboard",
  },
  partner: {
    email: "partner@keiretsu.ca",
    password: "password123",
    role: "partner",
    homePath: "/partner/dashboard",
  },
} as const satisfies Record<string, Persona>;

export type PersonaKey = keyof typeof PERSONAS;
