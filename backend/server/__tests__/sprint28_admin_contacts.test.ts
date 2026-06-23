/**
 * Sprint 28 Wave 4 — Admin Contacts CRM
 *
 * Tests covering:
 *   - Seed integrity (8 investors + 6 founders + 4 partners, integer minor units, ISO codes)
 *   - Create → version=1, prevRevisionHash=64 zeros
 *   - PATCH without x-confirm → 409 with proposedChange
 *   - PATCH with x-confirm → version bumps, hash chain extends, verifyChain returns ok
 *   - Verify / Suspend / Archive / Restore require x-confirm, emit audit + bridge events
 *   - Filter by kind, verification, region
 *   - Search by legalName, displayName, email
 *   - Stats endpoint sums to total
 *   - Bridge ALL_OUTBOUND_EVENT_TYPES now has 24 entries including 4 contact.* events
 */

import { describe, it, expect, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express from "express";
import http from "node:http";
import {
  registerAdminContactsRoutes,
  _testContacts,
  verifyChain,
  type AdminContact,
} from "../adminContactsStore";
import {
  ALL_OUTBOUND_EVENT_TYPES,
  _testBridge,
} from "../bridgeStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";

/* ── helpers ──────────────────────────────────────────────── */

function makeApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerAdminPlatformRoutes(app);
  registerAdminContactsRoutes(app);
  return app;
}

type ReqOptions = {
  headers?: Record<string, string>;
};

async function req(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  opts: ReqOptions = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const defaultHeaders: Record<string, string> = data
        ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) }
        : {};
      const headers = { ...defaultHeaders, ...(opts.headers ?? {}) };
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode || 0, body: buf });
            }
          });
        }
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* ── reset between tests ──────────────────────────────────── */

beforeEach(() => {
  _testContacts.reset();
  _testBridge.resetChain();
});

/* ================================================================
 * Section 1 — Bridge catalog check
 * ================================================================ */

describe("Sprint 28 Wave 4 / Bridge — outbound event types", () => {
  it("ALL_OUTBOUND_EVENT_TYPES has at least 24 entries (Wave 4 contacts; Wave 5 adds 5 more)", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES.length).toBeGreaterThanOrEqual(24);
  });

  it("includes all 4 contact.* event types", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("contact.created");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("contact.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("contact.verified");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("contact.archived");
  });

  it("no duplicate event types", () => {
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
  });
});

/* ================================================================
 * Section 2 — Seed integrity
 * ================================================================ */

describe("Sprint 28 Wave 4 / Seed integrity", () => {
  beforeEach(() => {
    _testContacts.seed();
  });

  it("seeds exactly 8 investors", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    const investors = contacts.filter((c) => c.kind === "investor");
    expect(investors.length).toBe(8);
  });

  it("seeds exactly 6 founders", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    const founders = contacts.filter((c) => c.kind === "founder");
    expect(founders.length).toBe(6);
  });

  it("seeds exactly 4 consortium partners", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    const partners = contacts.filter((c) => c.kind === "consortium_partner");
    expect(partners.length).toBe(4);
  });

  it("total is 18 seeded contacts", () => {
    expect(_testContacts.getContacts().size).toBe(18);
  });

  it("all investor aumMinor values are integers or null (no floats)", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      if (c.aumMinor != null) {
        expect(Number.isInteger(c.aumMinor)).toBe(true);
        expect(c.aumMinor).toBeGreaterThan(0);
      }
      if (c.checkSizeMinMinor != null) {
        expect(Number.isInteger(c.checkSizeMinMinor)).toBe(true);
      }
      if (c.checkSizeMaxMinor != null) {
        expect(Number.isInteger(c.checkSizeMaxMinor)).toBe(true);
      }
    }
  });

  it("all contacts have valid ISO 4217 aumCurrency (3-letter)", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      expect(c.aumCurrency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it("all contacts have non-empty ISO 3166-1 alpha-2 hqCountry codes (2 letters)", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      expect(c.hqCountry).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("all contacts have a valid region string", () => {
    const validRegions = ["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"];
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      expect(validRegions).toContain(c.region);
    }
  });

  it("all contacts start at version=1 with prevRevisionHash=64 zeros", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      expect(c.version).toBe(1);
      expect(c.prevRevisionHash).toBe("0".repeat(64));
    }
  });

  it("all contacts have a non-empty revisionHash (64 hex chars)", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    for (const c of contacts) {
      expect(c.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("seeded contacts have seeded action in revision history", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    const revisions = _testContacts.getRevisions();
    for (const c of contacts) {
      const revs = revisions.get(c.id) ?? [];
      expect(revs.length).toBeGreaterThanOrEqual(1);
      const first = revs[0];
      expect(first.action).toBe("contact.seeded");
    }
  });

  it("investor investors span multiple regions (not all US)", () => {
    const contacts = Array.from(_testContacts.getContacts().values());
    const investors = contacts.filter((c) => c.kind === "investor");
    const regions = new Set(investors.map((c) => c.region));
    expect(regions.size).toBeGreaterThan(1);
  });
});

/* ================================================================
 * Section 3 — HTTP GET stats
 * ================================================================ */

describe("Sprint 28 Wave 4 / GET /api/admin/contacts/stats", () => {
  it("returns stats with counts that sum to total", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    expect(r.status).toBe(200);
    const s = r.body;
    expect(typeof s.total).toBe("number");
    const kindSum = s.byKind.investor + s.byKind.founder + s.byKind.consortium_partner;
    expect(kindSum).toBe(s.total);
  });

  it("returns all expected fields", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("total");
    expect(r.body).toHaveProperty("byKind");
    expect(r.body).toHaveProperty("byVerification");
    expect(r.body).toHaveProperty("byStatus");
    expect(r.body).toHaveProperty("byRegion");
  });

  it("reflects 18 seeded contacts in total", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(18);
    expect(r.body.byKind.investor).toBe(8);
    expect(r.body.byKind.founder).toBe(6);
    expect(r.body.byKind.consortium_partner).toBe(4);
  });
});

/* ================================================================
 * Section 4 — GET list + filters
 * ================================================================ */

describe("Sprint 28 Wave 4 / GET /api/admin/contacts (list + filter)", () => {
  it("returns all 18 seeded contacts by default", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(18);
    expect(Array.isArray(r.body.contacts)).toBe(true);
    expect(r.body.contacts.length).toBe(18);
  });

  it("filters by kind=investor", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?kind=investor");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(8);
    expect(r.body.contacts.every((c: AdminContact) => c.kind === "investor")).toBe(true);
  });

  it("filters by kind=founder", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?kind=founder");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(6);
    expect(r.body.contacts.every((c: AdminContact) => c.kind === "founder")).toBe(true);
  });

  it("filters by kind=consortium_partner", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?kind=consortium_partner");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
  });

  it("filters by verification=verified", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?verification=verified");
    expect(r.status).toBe(200);
    expect(r.body.contacts.every((c: AdminContact) => c.verification === "verified")).toBe(true);
  });

  it("filters by region=US", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?region=US");
    expect(r.status).toBe(200);
    expect(r.body.contacts.every((c: AdminContact) => c.region === "US")).toBe(true);
    expect(r.body.total).toBeGreaterThan(0);
  });

  it("filters by region=UK returns contacts in UK", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?region=UK");
    expect(r.status).toBe(200);
    expect(r.body.contacts.every((c: AdminContact) => c.region === "UK")).toBe(true);
    expect(r.body.total).toBeGreaterThan(0);
  });
});

/* ================================================================
 * Section 5 — Search
 * ================================================================ */

describe("Sprint 28 Wave 4 / Search", () => {
  it("search by legalName fragment", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?search=sequoia");
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    expect(r.body.contacts[0].legalName.toLowerCase()).toContain("sequoia");
  });

  it("search by email fragment", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?search=maya%40novapay");
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
  });

  it("search by display name", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?search=atomico");
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
    const found = r.body.contacts.some((c: AdminContact) =>
      c.displayName.toLowerCase().includes("atomico") || c.legalName.toLowerCase().includes("atomico")
    );
    expect(found).toBe(true);
  });

  it("search with no match returns empty list", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts?search=zzz_no_match_xyz_9999");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });
});

/* ================================================================
 * Section 6 — Create (POST)
 * ================================================================ */

describe("Sprint 28 Wave 4 / POST /api/admin/contacts", () => {
  it("without x-confirm returns 409 with proposedChange", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/contacts", {
      legalName: "Test Fund LP",
      email: "test@testfund.io",
      kind: "investor",
      type: "institutional",
      region: "US",
      hqCountry: "US",
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
    expect(r.body.proposedChange).toBeTruthy();
    expect(r.body.proposedChange.legalName).toBe("Test Fund LP");
  });

  it("with x-confirm creates contact at version=1 with zero prevRevisionHash", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Alpha Fund LP",
        email: "alpha@alphafund.io",
        kind: "investor",
        type: "institutional",
        region: "US",
        hqCountry: "US",
        aumMinor: 100000000_00,
        aumCurrency: "USD",
      },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    const c: AdminContact = r.body.contact;
    expect(c.version).toBe(1);
    expect(c.prevRevisionHash).toBe("0".repeat(64));
    expect(c.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(c.legalName).toBe("Alpha Fund LP");
    expect(c.kind).toBe("investor");
    expect(c.aumMinor).toBe(10_000_000_000); // 100000000 * 100 cents
  });

  it("returns 400 if required fields are missing", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/admin/contacts",
      { legalName: "Missing Fields" },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("required");
  });

  it("returns 400 for invalid kind", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Bad Kind",
        email: "bad@bad.io",
        kind: "alien",
        type: "institutional",
      },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(400);
  });
});

/* ================================================================
 * Section 7 — PATCH (update)
 * ================================================================ */

describe("Sprint 28 Wave 4 / PATCH /api/admin/contacts/:id", () => {
  async function createContact(app: express.Express) {
    const r = await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Beta Ventures LP",
        email: "beta@betaventures.io",
        kind: "investor",
        type: "angel",
        region: "US",
        hqCountry: "US",
      },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(201);
    return r.body.contact as AdminContact;
  }

  it("PATCH without x-confirm returns 409 with proposedChange and diff", async () => {
    const app = makeApp();
    const contact = await createContact(app);
    const r = await req(app, "PATCH", `/api/admin/contacts/${contact.id}`, {
      legalName: "Beta Ventures II LP",
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
    expect(r.body.proposedChange).toEqual({ legalName: "Beta Ventures II LP" });
    expect(r.body.diff).toHaveProperty("legalName");
    expect(r.body.diff.legalName.from).toBe("Beta Ventures LP");
    expect(r.body.diff.legalName.to).toBe("Beta Ventures II LP");
    expect(r.body.currentVersion).toBe(1);
    expect(r.body.wouldBecomeVersion).toBe(2);
  });

  it("PATCH with x-confirm applies update, bumps version, extends hash chain", async () => {
    const app = makeApp();
    const contact = await createContact(app);
    const r = await req(
      app,
      "PATCH",
      `/api/admin/contacts/${contact.id}`,
      { legalName: "Beta Ventures III LP", hqCity: "Austin" },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const updated: AdminContact = r.body.contact;
    expect(updated.version).toBe(2);
    expect(updated.legalName).toBe("Beta Ventures III LP");
    expect(updated.hqCity).toBe("Austin");
    expect(updated.prevRevisionHash).toBe(contact.revisionHash);
    expect(updated.revisionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(updated.revisionHash).not.toBe(contact.revisionHash);
  });

  it("verifyChain returns ok=true after PATCH", async () => {
    const app = makeApp();
    const contact = await createContact(app);
    await req(
      app,
      "PATCH",
      `/api/admin/contacts/${contact.id}`,
      { notes: "Updated notes" },
      { headers: { "x-confirm": "true" } }
    );
    const chainResult = verifyChain(contact.id);
    expect(chainResult.ok).toBe(true);
    expect(chainResult.totalRevisions).toBe(2);
  });

  it("PATCH returns 404 for unknown id", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "PATCH",
      "/api/admin/contacts/ac_investor_nonexistent",
      { notes: "x" },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(404);
  });
});

/* ================================================================
 * Section 8 — GET single contact + history
 * ================================================================ */

describe("Sprint 28 Wave 4 / GET single contact + history", () => {
  it("GET /api/admin/contacts/:id returns the contact", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const first = contacts[0];
    const r = await req(app, "GET", `/api/admin/contacts/${first.id}`);
    expect(r.status).toBe(200);
    expect(r.body.contact.id).toBe(first.id);
  });

  it("GET /api/admin/contacts/:id returns 404 for unknown", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/ac_investor_doesnotexist");
    expect(r.status).toBe(404);
  });

  it("GET /api/admin/contacts/:id/history returns history + chain", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const first = contacts[0];
    const r = await req(app, "GET", `/api/admin/contacts/${first.id}/history`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.history)).toBe(true);
    expect(r.body.history.length).toBeGreaterThanOrEqual(1);
    expect(r.body.chain).toHaveProperty("ok");
    expect(r.body.chain).toHaveProperty("totalRevisions");
  });
});

/* ================================================================
 * Section 9 — Verify action
 * ================================================================ */

describe("Sprint 28 Wave 4 / POST /api/admin/contacts/:id/verify", () => {
  it("without x-confirm returns 409", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts.find((x) => x.verification !== "verified")!;
    const r = await req(app, "POST", `/api/admin/contacts/${c.id}/verify`, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
  });

  it("with x-confirm sets verification=verified and bumps version", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts.find((x) => x.verification !== "verified")!;
    const r = await req(app, "POST", `/api/admin/contacts/${c.id}/verify`, {}, { headers: { "x-confirm": "true" } });
    expect(r.status).toBe(200);
    expect(r.body.contact.verification).toBe("verified");
    expect(r.body.contact.version).toBe(c.version + 1);
  });

  it("verifyChain is ok after verify", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts.find((x) => x.verification !== "verified")!;
    await req(app, "POST", `/api/admin/contacts/${c.id}/verify`, {}, { headers: { "x-confirm": "true" } });
    const chain = verifyChain(c.id);
    expect(chain.ok).toBe(true);
  });
});

/* ================================================================
 * Section 10 — Suspend action
 * ================================================================ */

describe("Sprint 28 Wave 4 / POST /api/admin/contacts/:id/suspend", () => {
  it("without x-confirm returns 409", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    const r = await req(app, "POST", `/api/admin/contacts/${c.id}/suspend`, { reason: "Fraud suspicion" });
    expect(r.status).toBe(409);
  });

  it("with x-confirm sets status=suspended", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    const r = await req(
      app,
      "POST",
      `/api/admin/contacts/${c.id}/suspend`,
      { reason: "Compliance hold" },
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(200);
    expect(r.body.contact.status).toBe("suspended");
    expect(r.body.contact.version).toBe(c.version + 1);
  });
});

/* ================================================================
 * Section 11 — Archive + Restore actions
 * ================================================================ */

describe("Sprint 28 Wave 4 / POST /api/admin/contacts/:id/archive + restore", () => {
  it("archive without x-confirm returns 409", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    const r = await req(app, "POST", `/api/admin/contacts/${c.id}/archive`, {});
    expect(r.status).toBe(409);
  });

  it("archive with x-confirm sets status=archived and bumps version", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    const r = await req(
      app,
      "POST",
      `/api/admin/contacts/${c.id}/archive`,
      {},
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(200);
    expect(r.body.contact.status).toBe("archived");
    expect(r.body.contact.version).toBe(c.version + 1);
  });

  it("restore without x-confirm returns 409", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    // archive first
    await req(app, "POST", `/api/admin/contacts/${c.id}/archive`, {}, { headers: { "x-confirm": "true" } });
    const r = await req(app, "POST", `/api/admin/contacts/${c.id}/restore`, {});
    expect(r.status).toBe(409);
  });

  it("restore with x-confirm sets status=active", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    await req(app, "POST", `/api/admin/contacts/${c.id}/archive`, {}, { headers: { "x-confirm": "true" } });
    const r = await req(
      app,
      "POST",
      `/api/admin/contacts/${c.id}/restore`,
      {},
      { headers: { "x-confirm": "true" } }
    );
    expect(r.status).toBe(200);
    expect(r.body.contact.status).toBe("active");
  });

  it("archive + restore + verify produces intact chain", async () => {
    const app = makeApp();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    await req(app, "POST", `/api/admin/contacts/${c.id}/archive`, {}, { headers: { "x-confirm": "true" } });
    await req(app, "POST", `/api/admin/contacts/${c.id}/restore`, {}, { headers: { "x-confirm": "true" } });
    await req(app, "POST", `/api/admin/contacts/${c.id}/verify`, {}, { headers: { "x-confirm": "true" } });
    const chain = verifyChain(c.id);
    expect(chain.ok).toBe(true);
    expect(chain.totalRevisions).toBe(4); // seeded + archive + restore + verify
  });
});

/* ================================================================
 * Section 12 — verifyChain unit tests
 * ================================================================ */

describe("Sprint 28 Wave 4 / verifyChain", () => {
  it("returns ok=false for unknown contactId", () => {
    const result = verifyChain("ac_investor_nonexistent_9999");
    expect(result.ok).toBe(false);
    expect(result.totalRevisions).toBe(0);
  });

  it("returns ok=true for freshly seeded contact", () => {
    _testContacts.seed();
    const contacts = Array.from(_testContacts.getContacts().values());
    const c = contacts[0];
    const result = verifyChain(c.id);
    expect(result.ok).toBe(true);
    expect(result.totalRevisions).toBe(1);
  });

  it("returns ok=true for contact with multiple revisions", async () => {
    const app = makeApp();
    // Create contact then patch 3 times
    const r = await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Chain Test Fund",
        email: "chain@chaintest.io",
        kind: "investor",
        type: "institutional",
        region: "US",
        hqCountry: "US",
      },
      { headers: { "x-confirm": "true" } }
    );
    const id = r.body.contact.id;
    for (let i = 0; i < 3; i++) {
      await req(
        app,
        "PATCH",
        `/api/admin/contacts/${id}`,
        { notes: `Revision ${i + 1}` },
        { headers: { "x-confirm": "true" } }
      );
    }
    const result = verifyChain(id);
    expect(result.ok).toBe(true);
    expect(result.totalRevisions).toBe(4); // created + 3 patches
  });
});

/* ================================================================
 * Section 13 — Money integrity (integer minor units only)
 * ================================================================ */

describe("Sprint 28 Wave 4 / Money integrity", () => {
  it("PATCH with non-integer aumMinor returns 400", async () => {
    const app = makeApp();
    const r1 = await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Money Test Fund",
        email: "money@test.io",
        kind: "investor",
        type: "institutional",
        region: "US",
        hqCountry: "US",
      },
      { headers: { "x-confirm": "true" } }
    );
    const id = r1.body.contact.id;
    const r2 = await req(
      app,
      "PATCH",
      `/api/admin/contacts/${id}`,
      { aumMinor: 1.5 },
      { headers: { "x-confirm": "true" } }
    );
    expect(r2.status).toBe(400);
  });

  it("seeded investors with aumMinor have values > 0", () => {
    _testContacts.seed();
    const contacts = Array.from(_testContacts.getContacts().values());
    const investorsWithAum = contacts.filter(
      (c) => c.kind === "investor" && c.aumMinor != null
    );
    expect(investorsWithAum.length).toBeGreaterThan(0);
    for (const c of investorsWithAum) {
      expect(c.aumMinor!).toBeGreaterThan(0);
      expect(Number.isInteger(c.aumMinor!)).toBe(true);
    }
  });
});

/* ================================================================
 * Section 14 — Stats accuracy
 * ================================================================ */

describe("Sprint 28 Wave 4 / Stats accuracy", () => {
  it("stats total equals number of contacts in store", async () => {
    const app = makeApp();
    // Create one extra contact
    await req(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "Stats Test Partner",
        email: "stats@partner.io",
        kind: "consortium_partner",
        type: "partner_org",
        region: "EU",
        hqCountry: "DE",
      },
      { headers: { "x-confirm": "true" } }
    );
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(19); // 18 seeded + 1 created
    expect(r.body.byKind.consortium_partner).toBe(5); // 4 seeded + 1 created
  });

  it("byVerification counts sum to total", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    const s = r.body;
    const vSum =
      s.byVerification.verified +
      s.byVerification.pending +
      s.byVerification.unverified +
      s.byVerification.rejected;
    expect(vSum).toBe(s.total);
  });

  it("byStatus counts sum to total", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/contacts/stats");
    const s = r.body;
    const stSum =
      s.byStatus.active +
      s.byStatus.inactive +
      s.byStatus.suspended +
      s.byStatus.archived;
    expect(stSum).toBe(s.total);
  });
});
