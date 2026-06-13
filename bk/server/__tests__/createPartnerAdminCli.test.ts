/**
 * 23-May Fix 8 — scripts/create_partner_admin.ts CLI coverage.
 *
 * Mirrors server/__tests__/adminLogin.test.ts (which tests create_admin.ts).
 * Validates:
 *   1. Happy path: an existing partner org gains a new partner_admin user
 *      who can log in via /api/auth/login and reach /api/partner/me.
 *   2. Idempotency: re-running with the same email rotates the password
 *      and does NOT duplicate the partner_team_members binding.
 *   3. Pre-condition guard: unknown partnerId raises the
 *      "admin must approve consortium application first" error.
 *   4. Validation: short password and invalid subRole fail parseArgs.
 *
 * No cap-table mutations — math-sacred zones untouched.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express, type Request } from "express";
import http from "node:http";
import request from "supertest";
import { eq } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { users as usersTable } from "../../shared/schema";
import { seedDemoData } from "../lib/seedDemoData";
import { partnerTeamStore } from "../partnerWorkspaceStore";
import { createPartnerAdmin, parseArgs, VALID_SUB_ROLES } from "../../scripts/create_partner_admin";

let app: Express;

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());

  app = express();
  app.use(express.json());
  // Inline cookie parser so login → /api/me flows under supertest.
  app.use((req, _res, next) => {
    const r = req as Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) {
            try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
          }
        }
      }
      r.cookies = out;
    }
    next();
  });
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

describe("23-May Fix 8 — create_partner_admin.ts happy path", () => {
  const EMAIL = "cli-partner-admin@keiretsu.example";
  const PARTNER = "tenant_cp_keiretsu_ca";

  it("creates a new partner_admin user against an existing partner org", async () => {
    const r = await createPartnerAdmin({
      email: EMAIL,
      password: "InitialPartnerPw!1",
      partnerId: PARTNER,
      subRole: "managing_partner",
      name: "CLI Partner Admin",
    });
    expect(r.created || r.bindingAdded).toBe(true);
    expect(r.userId).toBeTruthy();
    expect(r.partnerId).toBe(PARTNER);
    expect(r.subRole).toBe("managing_partner");

    // user row landed
    const dbUser = (getDb()
      .select({ id: usersTable.id, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.email, EMAIL))
      .all() as Array<{ id: string; email: string; role: string }>);
    expect(dbUser.length).toBe(1);
    expect(dbUser[0].id).toBe(r.userId);

    // partner_team_members binding present
    const tm = partnerTeamStore.findByUserId(r.userId);
    expect(tm).not.toBeNull();
    expect(tm!.partnerId).toBe(PARTNER);
    expect(tm!.subRole).toBe("managing_partner");
  });

  it("login + /api/partner/me round-trip works for the freshly-created partner_admin", async () => {
    const loginR = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "InitialPartnerPw!1" })
      .set("accept", "application/json");
    expect(loginR.status).toBe(200);
    const ctx = loginR.body?.ctx ?? {};
    const userId = ctx.userId ?? ctx.identity?.userId ?? ctx.identity?.id ?? "";
    expect(userId).toBeTruthy();

    const meR = await request(app)
      .get("/api/partner/me")
      .set("x-user-id", userId)
      .set("accept", "application/json");
    expect(meR.status).toBe(200);
    const partnerId =
      meR.body?.partnerId ??
      meR.body?.partnerContext?.partnerId ??
      meR.body?.partner?.id ??
      "";
    expect(partnerId).toBe(PARTNER);
  });

  it("idempotent: re-running rotates password and keeps a single team binding", async () => {
    const before = partnerTeamStore.listByPartner(PARTNER).filter((m) => m.status === "active").length;
    const r2 = await createPartnerAdmin({
      email: EMAIL,
      password: "RotatedPartnerPw!2",
      partnerId: PARTNER,
      subRole: "managing_partner",
      name: "CLI Partner Admin",
    });
    expect(r2.created).toBe(false);
    expect(r2.passwordRotated || r2.bindingAdded).toBe(true);
    const after = partnerTeamStore.listByPartner(PARTNER).filter((m) => m.status === "active").length;
    expect(after).toBe(before);

    // New password works
    const goodLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "RotatedPartnerPw!2" })
      .set("accept", "application/json");
    expect(goodLogin.status).toBe(200);
    // Old password fails
    const badLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: EMAIL, password: "InitialPartnerPw!1" })
      .set("accept", "application/json");
    expect(badLogin.status).toBe(401);
  });
});

describe("23-May Fix 8 — create_partner_admin.ts pre-condition guard", () => {
  it("throws 'admin must approve consortium application first' for unknown partnerId", async () => {
    await expect(
      createPartnerAdmin({
        email: "ghost@nowhere.example",
        password: "GhostPwGhost!1",
        partnerId: "tenant_cp_does_not_exist",
        subRole: "managing_partner",
        name: "Ghost",
      }),
    ).rejects.toThrow(/admin must approve consortium application first/);
  });
});

describe("23-May Fix 8 — create_partner_admin.ts arg validation", () => {
  const SAVED = process.exit;
  let exitCode: number | undefined;
  beforeAll(() => {
    (process.exit as unknown) = ((code?: number) => {
      exitCode = code;
      throw new Error(`__EXIT_${code ?? 0}__`);
    }) as typeof process.exit;
  });

  it("rejects passwords shorter than 12 characters (exit 2)", () => {
    exitCode = undefined;
    expect(() =>
      parseArgs([
        "--email=cli-short@partner.example",
        "--password=short",
        "--partnerId=tenant_cp_keiretsu_ca",
      ]),
    ).toThrow(/__EXIT_2__/);
    expect(exitCode).toBe(2);
  });

  it("rejects unknown subRole values (exit 2)", () => {
    exitCode = undefined;
    expect(() =>
      parseArgs([
        "--email=cli-role@partner.example",
        "--password=LongEnoughPw12",
        "--partnerId=tenant_cp_keiretsu_ca",
        "--subRole=tyrant",
      ]),
    ).toThrow(/__EXIT_2__/);
    expect(exitCode).toBe(2);
  });

  it("requires email + password + partnerId (exit 1)", () => {
    exitCode = undefined;
    expect(() => parseArgs([])).toThrow(/__EXIT_1__/);
    expect(exitCode).toBe(1);
  });

  // Defensive: just confirm VALID_SUB_ROLES is what the partner workspace expects.
  it("VALID_SUB_ROLES matches the partner workspace SubRole union", () => {
    expect([...VALID_SUB_ROLES].sort()).toEqual(
      ["analyst", "associate", "bd", "managing_partner", "viewer"].sort(),
    );
  });

  // Restore process.exit
  it("[cleanup] restores process.exit", () => {
    (process.exit as unknown) = SAVED;
    expect(true).toBe(true);
  });
});
