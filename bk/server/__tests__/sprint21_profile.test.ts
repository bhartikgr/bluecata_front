/**
 * Sprint 21 Wave E — Investor Profile enhancements: server-side tests.
 *
 * Assertions (≥6):
 *  1. PUT /api/founder/privacy — accepts investor-shaped payload, returns updated state
 *  2. PUT /api/founder/privacy — stores screenName field in response
 *  3. PUT /api/founder/privacy — stores visibleToCoMembers toggle
 *  4. PUT /api/founder/privacy — stores visibleToCollectiveNetwork toggle
 *  5. PATCH /api/auth/me — saves screenName change, returns ok
 *  6. GET /api/auth/me — returns user context (identity reflected)
 *  7. resolveCoMemberLabel — returns "[Anonymous Holder]" when screenNameSet=false
 *  8. resolveCoMemberLabel — returns screen name when both flags are true
 *  9. resolveCoMemberLabel — self-view always returns legal name regardless of privacy
 * 10. applyVisibilityUpdate — correctly derives screenNameSet from screenName
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  resolveCoMemberLabel,
  applyVisibilityUpdate,
  DEFAULT_VISIBILITY,
} from "../../client/src/lib/privacy/visibility";

/* -------------------------------------------------------------------
   HTTP server setup
   ------------------------------------------------------------------- */

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port as number;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/* -------------------------------------------------------------------
   HTTP endpoint tests
   ------------------------------------------------------------------- */

describe("Sprint 21 Wave E — PUT /api/founder/privacy", () => {
  const investorPrivacyPayload = {
    screenName: "InvestorHandle42",
    visibleToCoMembers: true,
    visibleToCollectiveNetwork: false,
  };

  it("1. accepts investor-shaped payload and returns ok=true", async () => {
    const { status, body } = await call("PUT", "/api/founder/privacy", {
      body: investorPrivacyPayload,
      userId: "u_investor_test",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("2. echoes screenName back in the response body", async () => {
    const { body } = await call("PUT", "/api/founder/privacy", {
      body: investorPrivacyPayload,
      userId: "u_investor_test",
    });
    expect(body.updated.screenName).toBe("InvestorHandle42");
  });

  it("3. echoes visibleToCoMembers in the response body", async () => {
    const { body } = await call("PUT", "/api/founder/privacy", {
      body: investorPrivacyPayload,
      userId: "u_investor_test",
    });
    expect(body.updated.visibleToCoMembers).toBe(true);
  });

  it("4. echoes visibleToCollectiveNetwork in the response body", async () => {
    const { body } = await call("PUT", "/api/founder/privacy", {
      body: { ...investorPrivacyPayload, visibleToCollectiveNetwork: true },
      userId: "u_investor_test",
    });
    expect(body.updated.visibleToCollectiveNetwork).toBe(true);
  });
});

describe("Sprint 21 Wave E — PATCH /api/auth/me", () => {
  it("5. saves screenName change and returns ok=true", async () => {
    const { status, body } = await call("PATCH", "/api/auth/me", {
      body: { screenName: "UpdatedHandle99" },
      userId: "u_investor_test",
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.updated.screenName).toBe("UpdatedHandle99");
  });
});

describe("Sprint 21 Wave E — GET /api/auth/me", () => {
  it("6. returns user context for authenticated investor", async () => {
    const { status, body } = await call("GET", "/api/auth/me", {
      userId: "u_aisha_patel",
    });
    // The endpoint returns 200 with a UserContext object
    expect(status).toBe(200);
    expect(body).toBeTruthy();
    // Must be an object (not a string)
    expect(typeof body).toBe("object");
  });
});

/* -------------------------------------------------------------------
   resolveCoMemberLabel unit tests (privacy propagation — E7)
   ------------------------------------------------------------------- */

describe("Sprint 21 Wave E — resolveCoMemberLabel privacy propagation", () => {
  const holderAnonymous = {
    id: "u_holder",
    legalName: "Alice Investor",
    visibility: { ...DEFAULT_VISIBILITY, screenNameSet: false, visibleToCoMembers: false, screenName: "" },
  };
  const holderVisible = {
    id: "u_holder",
    legalName: "Alice Investor",
    visibility: {
      screenName: "AliceVC",
      screenNameSet: true,
      visibleToCoMembers: true,
      visibleToCollectiveNetwork: false,
    },
  };
  const viewer = { id: "u_viewer" };
  const selfViewer = { id: "u_holder" };

  it("7. returns [Anonymous Holder] when visibleToCoMembers=false", () => {
    expect(resolveCoMemberLabel(holderAnonymous, viewer)).toBe("[Anonymous Holder]");
  });

  it("8. returns screen name when visibleToCoMembers=true and screenNameSet=true", () => {
    expect(resolveCoMemberLabel(holderVisible, viewer)).toBe("AliceVC");
  });

  it("9. self-view always returns legal name regardless of privacy settings", () => {
    expect(resolveCoMemberLabel(holderAnonymous, selfViewer)).toBe("Alice Investor");
    expect(resolveCoMemberLabel(holderVisible, selfViewer)).toBe("Alice Investor");
  });
});

describe("Sprint 21 Wave E — applyVisibilityUpdate", () => {
  it("10. derives screenNameSet=true when screenName is non-empty", () => {
    const result = applyVisibilityUpdate(DEFAULT_VISIBILITY, { screenName: "NewHandle" });
    expect(result.screenNameSet).toBe(true);
    expect(result.screenName).toBe("NewHandle");
  });

  it("11. derives screenNameSet=false when screenName is cleared", () => {
    const current = { ...DEFAULT_VISIBILITY, screenName: "OldHandle", screenNameSet: true };
    const result = applyVisibilityUpdate(current, { screenName: "" });
    expect(result.screenNameSet).toBe(false);
  });
});
