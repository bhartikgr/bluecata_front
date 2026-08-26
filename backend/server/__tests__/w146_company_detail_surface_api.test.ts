/* ════════════════════════════════════════════════════════════════════════════
   WAVE 146 — REAL API PROOF over `GET /api/companies/:id`.
   ════════════════════════════════════════════════════════════════════════════
   This asserts a REAL HTTP RESPONSE from the shipped route stack, not source
   text. Identity is supplied through an explicit test-owned header via a
   `getUserContext` mock (owner ruling R90 pattern, as in w130), so no seeded
   session is relied upon.

   FAIL-BEFORE: today `routes.ts:2322-2326` sets all four gated flags from
   `access.outcome !== "refuse"`, so the grant-only partner below comes back
   with `canSeeDataroom: true` and `canSeeTermSheet: true`, and `dataroom` /
   `termSheet` bodies are served. Both assertions below fail.

   AFTER: the cap table stays reachable (no 404, `capTableAllowed` true) and the
   three unrelated surfaces are refused with a machine-readable basis.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, vi, type Mock } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import request from "supertest";

const COMPANY = "co_novapay";
const GRANTEE = "u_w146_grantee";
const LP = "u_w146_lp";
const H = "x-w146-actor";

vi.mock("../lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
    requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: (req: Request) => {
      const who = (req.headers[H] as string | undefined) ?? "";
      return {
        isAuthed: !!who,
        isAdmin: false,
        userId: who,
        identity: { userId: who },
        founder: { companies: [] },
        /* The LP holds a position; the grantee holds none. */
        investor: {
          capTablePositions: who === LP ? [{ companyId: COMPANY }] : [],
          invitedRounds: [],
        },
        collective: { status: "none", role: null, expiresAt: null },
      };
    },
  };
});

/* The GRANT itself is mocked at the store boundary rather than written to a
   database: this test asserts the CONSUMER's surface separation, and w130 F5
   already pins the store + decision authority end to end. */
vi.mock("../lib/shareholderRegisterStore", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hasLiveCapTableVisibilityGrant: (companyId: string, subjectIds: string[]) =>
      companyId === COMPANY && subjectIds.includes(GRANTEE)
        ? {
          id: "g_w146",
          companyId: COMPANY,
          subjectKind: "consortium_partner",
          subjectId: GRANTEE,
          subjectLabel: "Keiretsu Forum Canada",
          expiresAt: "2027-01-01T00:00:00.000Z",
        }
        : null,
  };
});

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json({ limit: "2mb" }));
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
}, 120_000);

function get(url: string, actor: string) {
  return request(app).get(url).set(H, actor);
}

describe("W146 · GET /api/companies/:id — one grant, one surface", () => {
  it("G1 · a grant-only viewer reaches the company but NOT the dataroom or term sheet", async () => {
    const r = await get(`/api/companies/${COMPANY}?as=investor`, GRANTEE);
    expect(r.status).toBe(200);
    expect(r.body.access.canSeeDataroom).toBe(false);
    expect(r.body.access.canSeeTermSheet).toBe(false);
    expect(r.body.access.canSeeRound).toBe(false);
    expect(r.body.access.canSeeSoftCircle).toBe(false);
    expect(r.body.dataroom).toBeNull();
    expect(r.body.termSheet).toBeNull();
    /* And the cap table is NOT taken away. */
    expect(r.body.access.capTableAllowed).toBe(true);
    expect(r.body.access.visibilityBasis).toBe("cap_table_grant");
  });

  it("G2 · a stranger is still 404 — the refusal path is NOT relaxed", async () => {
    const r = await get(`/api/companies/${COMPANY}?as=investor`, "u_w146_stranger");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("not_found");
  });
});
