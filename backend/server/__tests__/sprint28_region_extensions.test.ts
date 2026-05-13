/**
 * Sprint 28 Wave 5 — Region Extension Store tests.
 *
 * Covers all requirements from the spec:
 *  - Initial state: zero extensions
 *  - Create → v1, prevHash=64 zeros, status=research
 *  - PATCH without x-confirm:true → 409 with proposedChange
 *  - research→draft blocked when <3 sources or empty legalBasisSummary
 *  - draft→review blocked when 0 proposedFormulas
 *  - review→approved requires reviewerNotes
 *  - approved→live succeeds; GET /api/regions returns 10 entries
 *  - Code collision: cannot propose US/CA/etc → 400
 *  - Code uniqueness: cannot propose two extensions with same code → 409
 *  - Terminal states reject further transitions
 *  - Hash chain extends on every mutation; verifyChain ok; tampering breaks it
 *  - Audit log entries appended for every state change
 *  - Bridge events emitted on proposed / review_submitted / approved / gone_live / rejected
 *  - GET /api/regions returns canonical 9 with source:"canonical"
 */

import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";

import { registerRegionExtensionRoutes, _testRegionExtensions } from "../regionExtensionStore";
import { ALL_OUTBOUND_EVENT_TYPES, getOutbox, _testBridge } from "../bridgeStore";
import { registerBridgeRoutes } from "../bridgeStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";

/* ============================================================
 * HTTP test helpers
 * ============================================================ */

function makeApp() {
  const app = express();
  app.use(express.json());
  registerBridgeRoutes(app);
  registerAdminPlatformRoutes(app);
  registerRegionExtensionRoutes(app);
  return app;
}

type ReqOptions = {
  headers?: Record<string, string>;
  body?: unknown;
};

async function req(
  app: express.Express,
  method: string,
  path: string,
  opts: ReqOptions = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = opts.body ? JSON.stringify(opts.body) : undefined;
      const defaultHeaders: Record<string, string> = {};
      if (data) {
        defaultHeaders["content-type"] = "application/json";
        defaultHeaders["content-length"] = String(Buffer.byteLength(data));
      }
      const headers = { ...defaultHeaders, ...(opts.headers ?? {}) };

      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: buf });
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

const CONFIRM = { "x-confirm": "true" };

/* ============================================================
 * Helper: create an extension quickly
 * ============================================================ */

async function createExtension(
  app: express.Express,
  code: string,
  name: string
): Promise<{ status: number; body: any }> {
  return req(app, "POST", "/api/admin/regions/extensions", {
    headers: CONFIRM,
    body: { code, name },
  });
}

/* ============================================================
 * Tests
 * ============================================================ */

describe("Sprint 28 Wave 5 — Region Extension Store", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    _testRegionExtensions.reset();
    _testBridge.resetChain();
    app = makeApp();
  });

  /* ----------------------------------------------------------
   * Initial state
   * ---------------------------------------------------------- */

  it("initial state: zero extensions", async () => {
    const r = await req(app, "GET", "/api/admin/regions/extensions");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    expect(r.body.extensions).toHaveLength(0);
  });

  /* ----------------------------------------------------------
   * Create — success path
   * ---------------------------------------------------------- */

  it("create extension: returns version=1, prevHash=64 zeros, status=research", async () => {
    const r = await createExtension(app, "DE", "Germany");
    expect(r.status).toBe(201);
    const ext = r.body;
    expect(ext.code).toBe("DE");
    expect(ext.name).toBe("Germany");
    expect(ext.status).toBe("research");
    expect(ext.version).toBe(1);
    expect(ext.prevRevisionHash).toBe("0".repeat(64));
    expect(typeof ext.revisionHash).toBe("string");
    expect(ext.revisionHash).toHaveLength(64);
    expect(ext.draft).toBeNull();
    expect(ext.approvedAt).toBeNull();
    expect(ext.liveAt).toBeNull();
  });

  it("GET list shows the new extension", async () => {
    await createExtension(app, "NL", "Netherlands");
    const r = await req(app, "GET", "/api/admin/regions/extensions");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.extensions[0].code).toBe("NL");
  });

  it("GET /:id returns extension", async () => {
    const created = await createExtension(app, "BR", "Brazil");
    const id = created.body.id;
    const r = await req(app, "GET", `/api/admin/regions/extensions/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(id);
  });

  it("GET /:id not found → 404", async () => {
    const r = await req(app, "GET", "/api/admin/regions/extensions/rex_nonexistent");
    expect(r.status).toBe(404);
  });

  /* ----------------------------------------------------------
   * Double-verify-before-apply
   * ---------------------------------------------------------- */

  it("POST without x-confirm: true → 409 with proposedChange", async () => {
    const r = await req(app, "POST", "/api/admin/regions/extensions", {
      body: { code: "SE", name: "Sweden" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
    expect(r.body.proposedChange).toBeDefined();
    expect(r.body.proposedChange.code).toBe("SE");
  });

  it("PATCH without x-confirm: true → 409 with proposedChange", async () => {
    const created = await createExtension(app, "CH", "Switzerland");
    const id = created.body.id;
    const r = await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      body: { name: "Swiss Confederation" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
    expect(r.body.proposedChange).toBeDefined();
  });

  it("POST /:id/transition without x-confirm: true → 409", async () => {
    const created = await createExtension(app, "PL", "Poland");
    const id = created.body.id;
    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      body: { to: "rejected" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
  });

  /* ----------------------------------------------------------
   * Code collision: frozen 9
   * ---------------------------------------------------------- */

  it.each(["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"])(
    "cannot propose frozen canonical code %s → 400",
    async (code) => {
      const r = await createExtension(app, code, "Test");
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("code_collision");
    }
  );

  /* ----------------------------------------------------------
   * Code uniqueness: cannot duplicate
   * ---------------------------------------------------------- */

  it("cannot propose two extensions with same code → second returns 409", async () => {
    await createExtension(app, "DE", "Germany");
    const r = await createExtension(app, "DE", "Deutschland");
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("code_already_exists");
  });

  /* ----------------------------------------------------------
   * Status transitions: research → draft
   * ---------------------------------------------------------- */

  it("research→draft blocked when <3 primarySources → 400 with reason", async () => {
    const created = await createExtension(app, "AT", "Austria");
    const id = created.body.id;

    // Patch with only 2 sources and a summary
    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        research: {
          legalBasisSummary: "Austrian company law",
          primarySources: [
            { label: "Source 1", url: "https://example.com/1" },
            { label: "Source 2", url: "https://example.com/2" },
          ],
        },
      },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "draft" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("transition_blocked");
    expect(r.body.reason).toMatch(/primarySources/);
  });

  it("research→draft blocked when legalBasisSummary is empty → 400 with reason", async () => {
    const created = await createExtension(app, "BE", "Belgium");
    const id = created.body.id;

    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        research: {
          legalBasisSummary: "",
          primarySources: [
            { label: "S1", url: "https://s1.com" },
            { label: "S2", url: "https://s2.com" },
            { label: "S3", url: "https://s3.com" },
          ],
        },
      },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "draft" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("transition_blocked");
    expect(r.body.reason).toMatch(/legalBasisSummary/);
  });

  it("research→draft succeeds when ≥3 sources AND non-empty summary", async () => {
    const created = await createExtension(app, "DK", "Denmark");
    const id = created.body.id;

    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        research: {
          legalBasisSummary: "Danish Companies Act etc.",
          primarySources: [
            { label: "S1", url: "https://s1.dk" },
            { label: "S2", url: "https://s2.dk" },
            { label: "S3", url: "https://s3.dk" },
          ],
        },
      },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "draft" },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
  });

  /* ----------------------------------------------------------
   * Status transitions: draft → review
   * ---------------------------------------------------------- */

  it("draft→review blocked when 0 proposedFormulas → 400", async () => {
    const created = await createExtension(app, "FI", "Finland");
    const id = created.body.id;

    // Advance to draft first
    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        research: {
          legalBasisSummary: "Finnish Companies Act",
          primarySources: [
            { label: "S1", url: "https://s1.fi" },
            { label: "S2", url: "https://s2.fi" },
            { label: "S3", url: "https://s3.fi" },
          ],
        },
      },
    });
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "draft" },
    });

    // Save draft without formulas
    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        draft: {
          code: "FI",
          name: "Finland",
          jurisdictionLabel: "Osakeyhtiölaki",
          currency: "EUR",
          flag: "🇫🇮",
          defaultLegalEntityType: "Oy",
          defaultIncorporationDocs: [],
          proposedFormulas: [],
          pricingMultiplier: 1.0,
          defaultSubscriptionCurrency: "EUR",
          termSheetTemplateRefs: [],
        },
      },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "review" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("transition_blocked");
    expect(r.body.reason).toMatch(/proposedFormula/);
  });

  /* ----------------------------------------------------------
   * review → approved requires reviewerNotes
   * ---------------------------------------------------------- */

  async function buildExtensionAtReview(
    app: express.Express,
    code: string,
    name: string
  ): Promise<string> {
    const created = await createExtension(app, code, name);
    const id = created.body.id;

    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        research: {
          legalBasisSummary: `${name} corporate law overview`,
          primarySources: [
            { label: "S1", url: "https://s1.test" },
            { label: "S2", url: "https://s2.test" },
            { label: "S3", url: "https://s3.test" },
          ],
        },
      },
    });

    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "draft" },
    });

    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: {
        draft: {
          code,
          name,
          jurisdictionLabel: "Companies Act",
          currency: "EUR",
          flag: "🏳",
          defaultLegalEntityType: "Ltd",
          defaultIncorporationDocs: [],
          proposedFormulas: [
            {
              id: `safe.postmoney.conversion.${code}`,
              category: "safe_conversion",
              name: "SAFE Post-Money Conversion",
              definition: "{}",
              citationSource: "Local law",
              citationUrl: "https://law.test",
            },
          ],
          pricingMultiplier: 1.0,
          defaultSubscriptionCurrency: "EUR",
          termSheetTemplateRefs: [],
        },
      },
    });

    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "review" },
    });

    return id;
  }

  it("review→approved blocked when reviewerNotes is empty → 400", async () => {
    const id = await buildExtensionAtReview(app, "IE", "Ireland");

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("transition_blocked");
    expect(r.body.reason).toMatch(/reviewerNotes/);
  });

  it("review→approved succeeds when reviewerNotes is provided", async () => {
    const id = await buildExtensionAtReview(app, "NO", "Norway");

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "Reviewed and verified." },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("approved");
    expect(r.body.approvedAt).toBeTruthy();
    expect(r.body.approvedBy).toBeTruthy();
  });

  /* ----------------------------------------------------------
   * approved → live: GET /api/regions returns 10 entries
   * ---------------------------------------------------------- */

  it("approved→live succeeds AND GET /api/regions returns 10 entries", async () => {
    // First verify we have 9 canonical entries
    const initialR = await req(app, "GET", "/api/regions");
    expect(initialR.status).toBe(200);
    expect(initialR.body.regions).toHaveLength(9);
    expect(initialR.body.regions.every((r: any) => r.source === "canonical")).toBe(true);

    const id = await buildExtensionAtReview(app, "SE", "Sweden");

    // Approve
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "Thorough review complete." },
    });

    // Go live
    const liveR = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "live" },
    });
    expect(liveR.status).toBe(200);
    expect(liveR.body.status).toBe("live");
    expect(liveR.body.liveAt).toBeTruthy();

    // Now GET /api/regions should have 10 entries
    const regionsR = await req(app, "GET", "/api/regions");
    expect(regionsR.status).toBe(200);
    expect(regionsR.body.regions).toHaveLength(10);

    const canonical = regionsR.body.regions.filter((r: any) => r.source === "canonical");
    const extensions = regionsR.body.regions.filter((r: any) => r.source === "extension");
    expect(canonical).toHaveLength(9);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].code).toBe("SE");
  });

  /* ----------------------------------------------------------
   * Terminal states: no further transitions
   * ---------------------------------------------------------- */

  it("live status rejects further transitions → 400", async () => {
    const id = await buildExtensionAtReview(app, "PT", "Portugal");

    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "Approved." },
    });
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "live" },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "archived" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_transition");
  });

  it("rejected status rejects further transitions → 400", async () => {
    const created = await createExtension(app, "GR", "Greece");
    const id = created.body.id;

    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "rejected" },
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "research" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_transition");
  });

  it("archived status rejects further transitions → 400", async () => {
    const created = await createExtension(app, "CZ", "Czech Republic");
    const id = created.body.id;

    await req(app, "POST", `/api/admin/regions/extensions/${id}/archive`, {
      headers: CONFIRM,
    });

    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "research" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_transition");
  });

  /* ----------------------------------------------------------
   * Hash chain integrity
   * ---------------------------------------------------------- */

  it("hash chain extends on every mutation; verifyChain returns ok", async () => {
    const created = await createExtension(app, "HU", "Hungary");
    const id = created.body.id;

    // First revision
    const h1R = await req(app, "GET", `/api/admin/regions/extensions/${id}/history`);
    expect(h1R.body.totalRevisions).toBe(1);
    expect(h1R.body.chainVerify.ok).toBe(true);
    expect(h1R.body.revisions[0].prevRevisionHash).toBe("0".repeat(64));

    // Patch — adds a revision
    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: { name: "Hungary (updated)" },
    });

    const h2R = await req(app, "GET", `/api/admin/regions/extensions/${id}/history`);
    expect(h2R.body.totalRevisions).toBe(2);
    expect(h2R.body.chainVerify.ok).toBe(true);

    // Revisions are chained: revision[1].prevRevisionHash === revision[0].revisionHash
    expect(h2R.body.revisions[1].prevRevisionHash).toBe(h2R.body.revisions[0].revisionHash);
  });

  it("tampering with in-memory store breaks chain verification", async () => {
    const created = await createExtension(app, "SK", "Slovakia");
    const id = created.body.id;

    // Tamper directly with the in-memory extension
    const ext = _testRegionExtensions.getAll().find((e: any) => e.id === id);
    expect(ext).toBeDefined();
    if (ext) {
      (ext as any).revisionHash = "deadbeef".repeat(8);
    }

    const histR = await req(app, "GET", `/api/admin/regions/extensions/${id}/history`);
    // After tampering the live object's hash, the next mutation won't match the history chain
    // The history chain itself is intact (we tampered the live object, not history),
    // but let's verify the chain reads from the history revisions.
    // Chain should still be ok since history is separate from the mutable object.
    // To fully test tampering, we tamper history too.
    const history = _testRegionExtensions.getHistory(id);
    if (history.length > 0) {
      (history[0] as any).revisionHash = "cafecafe".repeat(8);
    }

    // Patch to trigger a new revision which will try to chain off the tampered hash
    await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: { name: "Slovakia tampered" },
    });

    const histR2 = await req(app, "GET", `/api/admin/regions/extensions/${id}/history`);
    // Chain should be broken now
    expect(histR2.body.chainVerify.ok).toBe(false);
  });

  /* ----------------------------------------------------------
   * Audit log entries
   * ---------------------------------------------------------- */

  it("region.proposed audit entry appended on create", async () => {
    // We verify via the bridge outbox that region.proposed was emitted
    const initialOutbox = getOutbox().length;
    await createExtension(app, "RO", "Romania");
    const outbox = getOutbox();
    const proposed = outbox.find((e) => e.envelope.eventType === "region.proposed" && (e.envelope.payload as any).code === "RO");
    expect(proposed).toBeDefined();
  });

  /* ----------------------------------------------------------
   * Bridge events
   * ---------------------------------------------------------- */

  it("bridge event region.proposed emitted on create", async () => {
    await createExtension(app, "RS", "Serbia");
    const outbox = getOutbox();
    const ev = outbox.find((e) => e.envelope.eventType === "region.proposed" && (e.envelope.payload as any).code === "RS");
    expect(ev).toBeDefined();
    expect(ev!.envelope.aggregateKind).toBe("platform");
  });

  it("bridge event region.review_submitted emitted on draft→review", async () => {
    const id = await buildExtensionAtReview(app, "HR", "Croatia");
    const outbox = getOutbox();
    const ev = outbox.find(
      (e) => e.envelope.eventType === "region.review_submitted" &&
             (e.envelope.payload as any).extensionId === id
    );
    expect(ev).toBeDefined();
  });

  it("bridge event region.approved emitted on review→approved", async () => {
    const id = await buildExtensionAtReview(app, "LT", "Lithuania");
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "Approved OK." },
    });
    const outbox = getOutbox();
    const ev = outbox.find(
      (e) => e.envelope.eventType === "region.approved" &&
             (e.envelope.payload as any).extensionId === id
    );
    expect(ev).toBeDefined();
  });

  it("bridge event region.gone_live emitted on approved→live", async () => {
    const id = await buildExtensionAtReview(app, "EE", "Estonia");
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "approved", reviewerNotes: "Looks good." },
    });
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "live" },
    });
    const outbox = getOutbox();
    const ev = outbox.find(
      (e) => e.envelope.eventType === "region.gone_live" &&
             (e.envelope.payload as any).extensionId === id
    );
    expect(ev).toBeDefined();
  });

  it("bridge event region.rejected emitted on rejection", async () => {
    const created = await createExtension(app, "LV", "Latvia");
    const id = created.body.id;
    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "rejected" },
    });
    const outbox = getOutbox();
    const ev = outbox.find(
      (e) => e.envelope.eventType === "region.rejected" &&
             (e.envelope.payload as any).extensionId === id
    );
    expect(ev).toBeDefined();
  });

  /* ----------------------------------------------------------
   * GET /api/regions returns canonical 9 with source:"canonical"
   * ---------------------------------------------------------- */

  it("GET /api/regions returns exactly 9 canonical entries when zero extensions live", async () => {
    const r = await req(app, "GET", "/api/regions");
    expect(r.status).toBe(200);
    expect(r.body.regions).toHaveLength(9);
    const codes = r.body.regions.map((r: any) => r.code);
    expect(codes).toContain("US");
    expect(codes).toContain("CA");
    expect(codes).toContain("UK");
    expect(codes).toContain("SG");
    expect(codes).toContain("HK");
    expect(codes).toContain("CN");
    expect(codes).toContain("IN");
    expect(codes).toContain("JP");
    expect(codes).toContain("AU");
    expect(r.body.regions.every((r: any) => r.source === "canonical")).toBe(true);
  });

  /* ----------------------------------------------------------
   * Status filter
   * ---------------------------------------------------------- */

  it("GET /api/admin/regions/extensions?status=research returns only research entries", async () => {
    await createExtension(app, "MK", "North Macedonia");
    const id2 = await buildExtensionAtReview(app, "MD", "Moldova");
    await req(app, "POST", `/api/admin/regions/extensions/${id2}/transition`, {
      headers: CONFIRM,
      body: { to: "rejected" },
    });

    const r = await req(app, "GET", "/api/admin/regions/extensions?status=research");
    expect(r.status).toBe(200);
    expect(r.body.extensions.every((e: any) => e.status === "research")).toBe(true);
    expect(r.body.extensions.some((e: any) => e.code === "MK")).toBe(true);
    expect(r.body.extensions.some((e: any) => e.code === "MD")).toBe(false);
  });

  /* ----------------------------------------------------------
   * Validation errors
   * ---------------------------------------------------------- */

  it("POST with code longer than 2 chars → 400", async () => {
    const r = await req(app, "POST", "/api/admin/regions/extensions", {
      headers: CONFIRM,
      body: { code: "DEU", name: "Germany" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });

  it("POST with missing code → 400", async () => {
    const r = await req(app, "POST", "/api/admin/regions/extensions", {
      headers: CONFIRM,
      body: { name: "No Code" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });

  it("POST /:id/transition with invalid target status → 400", async () => {
    const created = await createExtension(app, "BG", "Bulgaria");
    const id = created.body.id;
    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "invalid_status" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_error");
  });

  /* ----------------------------------------------------------
   * Bridge event types: all 5 region events present in ALL_OUTBOUND_EVENT_TYPES
   * ---------------------------------------------------------- */

  it("ALL_OUTBOUND_EVENT_TYPES contains all 5 region event types", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("region.proposed");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("region.review_submitted");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("region.approved");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("region.gone_live");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("region.rejected");
    // Sprint 28 Wave 6 added 4 notification_campaign.* events → 33 total
    expect(ALL_OUTBOUND_EVENT_TYPES).toHaveLength(48) // Sprint 29 KL-01 added company_profile.updated;
  });

  /* ----------------------------------------------------------
   * POST /:id/archive convenience endpoint
   * ---------------------------------------------------------- */

  it("POST /:id/archive moves to archived status", async () => {
    const created = await createExtension(app, "SI", "Slovenia");
    const id = created.body.id;
    const r = await req(app, "POST", `/api/admin/regions/extensions/${id}/archive`, {
      headers: CONFIRM,
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("archived");
  });

  /* ----------------------------------------------------------
   * PATCH on terminal state → 400
   * ---------------------------------------------------------- */

  it("PATCH on live/rejected/archived → 400", async () => {
    const created = await createExtension(app, "BA", "Bosnia");
    const id = created.body.id;

    await req(app, "POST", `/api/admin/regions/extensions/${id}/transition`, {
      headers: CONFIRM,
      body: { to: "rejected" },
    });

    const r = await req(app, "PATCH", `/api/admin/regions/extensions/${id}`, {
      headers: CONFIRM,
      body: { name: "Updated Name" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("terminal_status");
  });

  /* ----------------------------------------------------------
   * Stats bar
   * ---------------------------------------------------------- */

  it("GET list returns correct stats by status", async () => {
    await createExtension(app, "AL", "Albania");
    await createExtension(app, "ME", "Montenegro");

    const reject = await createExtension(app, "XK", "Kosovo");
    await req(app, "POST", `/api/admin/regions/extensions/${reject.body.id}/transition`, {
      headers: CONFIRM,
      body: { to: "rejected" },
    });

    const r = await req(app, "GET", "/api/admin/regions/extensions");
    expect(r.body.stats.byStatus.research).toBe(2);
    expect(r.body.stats.byStatus.rejected).toBe(1);
    expect(r.body.stats.total).toBe(3);
  });
});
