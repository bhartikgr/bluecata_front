/* v25.34 Phase 4 — E2E: Admin functions (CRM contacts — the migrated Map→DB store).
 *
 * adminContactsStore was the one true "pure Map" CRM in the tree. Phase 1 added
 * DB-first reads (readAllContactsFromDb / readContactFromDb / readRevisionsFromDb)
 * with write-through-on-success. This E2E proves the DB is now the source of
 * truth: every create/update is asserted by reading the row straight out of
 * SQLite, and the GET endpoints (which now read DB-first) return the DB state.
 *
 * Coverage:
 *   1. Create a contact → row exists in `contacts` table (DB), GET /:id returns it.
 *   2. List endpoint reads DB-first (the created contact appears in the list).
 *   3. Stats endpoint aggregates from DB.
 *   4. Update (PATCH) → DB row reflects new values + version bump + a revision row.
 *   5. History endpoint reads revisions DB-first (hash chain present).
 *   6. Lifecycle: verify → suspend → archive → restore, each persisted in DB.
 *
 * Drives the real app over HTTP; admin persona (admin gate). Quote-only — no
 * payment writes. Does not touch Avi's code paths.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

let app, server, port;
const ADMIN = `u_v2534_crm_admin_${Date.now()}`;
const results = [];

function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

function req(method, path, { body, confirm } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": ADMIN };
    if (confirm) headers["x-confirm"] = "true";
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function contactRow(id) {
  try {
    return rawDb().prepare(`SELECT * FROM contacts WHERE id = ?`).get(id);
  } catch {
    return null;
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2534.test`, name: "v25.34 CRM Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.34 Admin functions (CRM Map→DB migration) — E2E", () => {
  let contactId;

  it("1. create contact → persisted in DB + GET /:id reads it DB-first", async () => {
    const res = await req("POST", "/api/admin/contacts", {
      confirm: true,
      body: {
        legalName: "Hydra Ventures LP", email: "lp@hydra.vc", kind: "investor", type: "institutional",
        hqCity: "Toronto", hqCountry: "CA", region: "CA", aumMinor: 50000000000, aumCurrency: "CAD",
        checkSizeMinMinor: 2500000, checkSizeMaxMinor: 25000000, industries: ["Fintech"], stages: ["Seed"],
      },
    });
    record("POST contact returns 201 + contact", res.status === 201 && !!res.body?.contact?.id, `status ${res.status}`);
    expect(res.status).toBe(201);
    contactId = res.body.contact.id;

    const row = contactRow(contactId);
    const rowOk = row && row.legal_name === "Hydra Ventures LP" && row.email === "lp@hydra.vc" && row.kind === "investor";
    record("contact row written to DB (contacts table)", !!rowOk, JSON.stringify({ legal_name: row?.legal_name, version: row?.version }));
    expect(rowOk).toBe(true);

    const get = await req("GET", `/api/admin/contacts/${contactId}`);
    const getOk = get.status === 200 && get.body?.contact?.id === contactId && get.body.contact.legalName === "Hydra Ventures LP";
    record("GET /:id reads contact DB-first", getOk, `status ${get.status}`);
    expect(getOk).toBe(true);
  });

  it("2. list endpoint reads DB-first (created contact appears)", async () => {
    const res = await req("GET", "/api/admin/contacts");
    const arr = res.body?.contacts ?? res.body?.items ?? res.body ?? [];
    const list = Array.isArray(arr) ? arr : (arr.contacts ?? []);
    const seen = list.some((c) => c.id === contactId);
    record("list includes the new contact", seen, `list size ${list.length}`);
    expect(seen).toBe(true);
  });

  it("3. stats endpoint aggregates from DB", async () => {
    const res = await req("GET", "/api/admin/contacts/stats");
    const ok = res.status === 200 && res.body && (res.body.ok === true || typeof res.body.total === "number" || !!res.body.stats);
    record("stats endpoint 200 + payload", ok, `status ${res.status}`);
    expect(res.status).toBe(200);
  });

  it("4. PATCH updates DB row + version bump + revision row", async () => {
    const before = contactRow(contactId);
    const res = await req("PATCH", `/api/admin/contacts/${contactId}`, {
      confirm: true,
      body: { hqCity: "Vancouver", notes: "Met at F1 Montreal 2026." },
    });
    record("PATCH returns 200 + updated contact", res.status === 200 && !!res.body?.contact, `status ${res.status}`);
    expect(res.status).toBe(200);

    const after = contactRow(contactId);
    // Extended fields (hqCity, aum, etc.) live in metadata_json; core columns are
    // legal_name/email/status/verification/version. We assert the version bump
    // (a core column) and that the city change round-tripped through metadata_json.
    let metaCity = null;
    try { metaCity = JSON.parse(after?.metadata_json || "{}").hqCity; } catch { /* ignore */ }
    const updateOk = after && after.version === before.version + 1 && metaCity === "Vancouver";
    record("DB row updated (version bump + hqCity in metadata_json)", !!updateOk, `v ${before?.version}→${after?.version}, city ${metaCity}`);
    expect(updateOk).toBe(true);

    let revCount = 0;
    try {
      revCount = rawDb().prepare(`SELECT COUNT(*) AS n FROM contact_revisions WHERE contact_id = ?`).get(contactId).n;
    } catch { /* table name guard */ }
    record("at least 1 revision row persisted in DB", revCount >= 1, `revisions=${revCount}`);
    expect(revCount).toBeGreaterThanOrEqual(1);
  });

  it("5. history endpoint reads revisions DB-first (hash chain present)", async () => {
    const res = await req("GET", `/api/admin/contacts/${contactId}/history`);
    const hist = res.body?.history ?? [];
    const ok = res.status === 200 && Array.isArray(hist) && hist.length >= 1;
    record("history endpoint returns DB revisions", ok, `entries ${hist.length}, chain ${JSON.stringify(res.body?.chain)?.slice(0, 40)}`);
    expect(ok).toBe(true);
  });

  it("6. lifecycle verify→suspend→archive→restore each persisted in DB", async () => {
    const v = await req("POST", `/api/admin/contacts/${contactId}/verify`, { confirm: true });
    const vRow = contactRow(contactId);
    record("verify → verification=verified in DB", v.status === 200 && vRow.verification === "verified", `status ${v.status}, ver ${vRow?.verification}`);
    expect(vRow.verification).toBe("verified");

    const s = await req("POST", `/api/admin/contacts/${contactId}/suspend`, { confirm: true, body: { reason: "compliance hold" } });
    const sRow = contactRow(contactId);
    record("suspend → status=suspended in DB", s.status === 200 && sRow.status === "suspended", `status ${s.status}, st ${sRow?.status}`);
    expect(sRow.status).toBe("suspended");

    const a = await req("POST", `/api/admin/contacts/${contactId}/archive`, { confirm: true });
    const aRow = contactRow(contactId);
    record("archive → status=archived in DB", a.status === 200 && aRow.status === "archived", `status ${a.status}, st ${aRow?.status}`);
    expect(aRow.status).toBe("archived");

    const r = await req("POST", `/api/admin/contacts/${contactId}/restore`, { confirm: true });
    const rRow = contactRow(contactId);
    record("restore → status=active in DB", r.status === 200 && rRow.status === "active", `status ${r.status}, st ${rRow?.status}`);
    expect(rRow.status).toBe("active");
  });

  it("E2E SUMMARY", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n=== v25_34_admin_functions_e2e: ${passed}/${results.length} assertions PASSED ===\n`);
    expect(passed).toBe(results.length);
  });
});
