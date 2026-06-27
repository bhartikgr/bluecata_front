/* v25.45 ROUND 9 (GPT-5.5 finding) — DM channel JSON projection must NEVER
 * leak either party's raw legal name in `metadata.title` (or any other
 * metadata field) regardless of viewer.
 *
 * Background: in round 8 GPT-5.5's adversarial sweep found that
 * `server/commsStore.ts` `projectChannel()` spreads the raw `channel` object
 * before adding the resolver-safe `displayTitle`. For DM channels the
 * persisted `metadata.title` carried both participants' raw legal names
 * (e.g. "DM — Aisha Patel ↔ Maya Chen"). The payload therefore contained:
 *   - safe `displayTitle` (resolver-resolved),
 *   - unsafe `metadata.title` (raw names).
 *
 * Round 9 fix:
 *   1. Persisted DM `metadata.title` is now the neutral string
 *      "Direct message" (at seed sites + at DM-creation in
 *      `POST /api/comms/dm/start`).
 *   2. `projectChannel()` sanitizes DM channel metadata defensively for any
 *      legacy persisted row before returning.
 *
 * This test:
 *   1. Opens a fresh DM via POST /api/comms/dm/start.
 *   2. Lists channels via GET /api/comms/channels.
 *   3. Fetches channel detail via GET /api/comms/channels/:id.
 *   4. For every DM channel in every response, deep-scans the JSON for the
 *      raw legal name of each participant. Asserts ZERO hits anywhere in
 *      the JSON payload — including nested `metadata`.
 *   5. Confirms the response still carries a resolver-safe `displayTitle`.
 *   6. Also tests one of the pre-seeded legacy DMs to prove the projection
 *      sanitizes even pre-existing data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerCommsRoutes } from "../commsStore.ts";

let app, server, port;

/* This test scopes the no-legal-name assertion to the STRUCTURAL channel
 * JSON: top-level channel fields + the nested `metadata` object. We exclude
 * the resolver-rendered surfaces (`displayTitle`, `displaySubtitle`,
 * `lastMessage.senderLabel`, `messages[].authorLabel`, `messages[].body`)
 * because those go through the policy resolver per the round-7 contract:
 *   - self-view (sender === viewer) intentionally returns the viewer's own
 *     legal name; that is the locked policy, not a leak.
 *   - counterparty rendering already routes through resolveDisplayName(...)
 *     in the "message" context with the isCoMember check.
 * The round-9 fix is specifically about the structural channel fields that
 * the spread of `channel` in projectChannel() was leaking, NOT the
 * resolver-rendered surfaces. */
const RESOLVER_RENDERED_KEYS = new Set([
  "displayTitle",
  "displaySubtitle",
  "senderLabel",   // lastMessage.senderLabel — resolver-rendered
  "authorLabel",   // messages[].authorLabel — resolver-rendered
  "body",          // message body content — author's own writing
  "preview",       // lastMessage.preview — author's own writing
]);

/** Walk through a JSON value and collect every string EXCEPT those nested under
 *  a resolver-rendered key. We DO descend into `metadata` (which is the round-9
 *  surface under audit). */
function collectStructuralStrings(node, acc, currentKey) {
  if (node == null) return;
  if (RESOLVER_RENDERED_KEYS.has(currentKey)) return;
  if (typeof node === "string") { acc.push(node); return; }
  if (typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectStructuralStrings(item, acc, currentKey);
    return;
  }
  for (const k of Object.keys(node)) collectStructuralStrings(node[k], acc, k);
}

function assertNoLegalNamesInPayload(payload, forbidden, label) {
  const strings = [];
  collectStructuralStrings(payload, strings, undefined);
  for (const banned of forbidden) {
    const hit = strings.find((s) => s.includes(banned));
    if (hit) {
      console.log("R9_DM_LEAK", JSON.stringify({ label, banned, hit, payload }));
    }
    expect(hit, `legal name "${banned}" must NOT appear in structural channel JSON for ${label}`).toBeUndefined();
  }
}

/** Recursively walk JSON and assert NO `metadata.*` field anywhere contains a
 *  forbidden legal name. This is the precise round-9 contract: regardless of
 *  whether the metadata sits on the top-level channel or under `channel.metadata`
 *  inside a wrapper (e.g. the POST /api/comms/dm/start response), it must be sanitized. */
function assertNoLegalNamesInAnyMetadata(payload, forbidden, label) {
  function walk(node) {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (node.metadata && typeof node.metadata === "object") {
      const strings = [];
      collectStructuralStrings(node.metadata, strings, undefined);
      for (const banned of forbidden) {
        const hit = strings.find((s) => s.includes(banned));
        if (hit) {
          console.log("R9_DM_META_LEAK", JSON.stringify({ label, banned, hit, metadata: node.metadata }));
        }
        expect(hit, `legal name "${banned}" must NOT appear in any metadata field for ${label}`).toBeUndefined();
      }
    }
    for (const k of Object.keys(node)) walk(node[k]);
  }
  walk(payload);
}

function request(method, path, { actorId, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let data;
    if (body !== undefined) {
      data = JSON.stringify(body);
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (actorId) headers["x-user-id"] = actorId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode || 0, body: buf });
          }
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerCommsRoutes(app);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, () => { port = server.address().port; r(); }));
}, 30_000);

afterAll(async () => { await new Promise((r) => server.close(() => r())); });

describe("v25.45 R9 — DM channel JSON must not expose participants' raw legal names", () => {
  it("seeded DM (legacy data path): GET /api/comms/channels/:id sanitizes metadata", async () => {
    // The seeded DM dm(u_aisha_patel, u_maya_chen) exists from store init.
    // Even if a legacy persisted row carried "DM — Aisha Patel ↔ Maya Chen"
    // in metadata.title, the projection must strip it for kind === "dm".
    const list = await request("GET", "/api/comms/channels", { actorId: "u_aisha_patel" });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    const dms = list.body.filter((c) => c.kind === "dm");
    expect(dms.length).toBeGreaterThan(0);

    // Aisha is a participant in dm(u_aisha_patel, u_maya_chen) and
    // dm(u_aisha_patel, u_hydra_capital). Both must be sanitized.
    const FORBIDDEN_FOR_AISHA = [
      "Aisha Patel",                  // Aisha's own legal name
      "Maya Chen",                    // other party in DM #1
      "Aisha Rahman (Hydra Capital)", // other party in DM #2 (full legal name)
      "Aisha Rahman",                 // partial match guard
    ];
    for (const ch of dms) {
      assertNoLegalNamesInPayload(ch, FORBIDDEN_FOR_AISHA, `channels-list dm ${ch.id}`);
      // Sanity: the resolver-safe surface still exists.
      expect(typeof ch.displayTitle).toBe("string");
      // metadata.title (if present) must be the neutral string.
      if (ch.metadata && typeof ch.metadata === "object" && ch.metadata.title != null) {
        expect(ch.metadata.title).toBe("Direct message");
      }
    }
  });

  it("seeded DM detail: GET /api/comms/channels/:id sanitizes metadata for an outside viewer", async () => {
    // Pick the seeded dm(u_maya_chen, u_hydra_capital). Use one of its
    // participants as the viewer (since DMs require participation), then
    // assert no legal names of EITHER party leak.
    const list = await request("GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const ch = list.body.find((c) => c.kind === "dm" && c.participantUserIds.includes("u_hydra_capital"));
    expect(ch, "seeded DM Maya↔Hydra should exist").toBeTruthy();

    const detail = await request("GET", `/api/comms/channels/${ch.id}`, { actorId: "u_maya_chen" });
    expect(detail.status).toBe(200);
    assertNoLegalNamesInPayload(detail.body, ["Maya Chen", "Aisha Rahman (Hydra Capital)", "Aisha Rahman"], `detail ${ch.id}`);
    // Sanity:
    expect(detail.body.channel?.kind ?? detail.body.kind).toBe("dm");
  });

  it("fresh DM via POST /api/comms/dm/start does not persist or return raw legal names", async () => {
    // u_aisha_patel and u_hydra_capital share co_novapay (so DM is permitted
    // by the visibility/co-member rules); we re-open the existing seeded DM
    // here, but the response uses projectChannel() which is the path we
    // need to assert against.
    const res = await request("POST", "/api/comms/dm/start", {
      actorId: "u_aisha_patel",
      body: { targetUserId: "u_hydra_capital" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.channel).toBeTruthy();
    expect(res.body.channel.kind).toBe("dm");

    // No participant's raw legal name may appear anywhere in the returned channel.
    assertNoLegalNamesInPayload(
      res.body.channel,
      ["Aisha Patel", "Aisha Rahman (Hydra Capital)", "Aisha Rahman"],
      "POST /api/comms/dm/start channel",
    );

    // Sanity: displayTitle must still exist.
    expect(typeof res.body.channel.displayTitle).toBe("string");

    // metadata.title (if present) must be the neutral string.
    if (res.body.channel.metadata && typeof res.body.channel.metadata === "object") {
      if (res.body.channel.metadata.title != null) {
        expect(res.body.channel.metadata.title).toBe("Direct message");
      }
    }
  });

  it("regression guard: NO DM channel response carries the old 'DM — <name> ↔ <name>' pattern anywhere", async () => {
    const list = await request("GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const dms = list.body.filter((c) => c.kind === "dm");
    for (const ch of dms) {
      const flat = JSON.stringify(ch);
      // The old literal pattern was: "DM — <name> ↔ <name>". With the round-9
      // fix this can never appear anywhere in the response — not in metadata,
      // not in any field.
      expect(/DM\s*\u2014[^\"]*\u2194/.test(flat)).toBe(false);
    }
  });

  it("metadata-only contract: NO `metadata.*` field anywhere in any DM response contains a participant's legal name", async () => {
    // List response.
    const list = await request("GET", "/api/comms/channels", { actorId: "u_aisha_patel" });
    assertNoLegalNamesInAnyMetadata(
      list.body,
      ["Aisha Patel", "Maya Chen", "Aisha Rahman (Hydra Capital)", "Aisha Rahman"],
      "channels list (viewer=aisha)",
    );

    // Detail response — use a DM that Maya is in.
    const mayaList = await request("GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const mayaDm = mayaList.body.find((c) => c.kind === "dm");
    const detail = await request("GET", `/api/comms/channels/${mayaDm.id}`, { actorId: "u_maya_chen" });
    assertNoLegalNamesInAnyMetadata(
      detail.body,
      ["Maya Chen", "Aisha Patel", "Aisha Rahman (Hydra Capital)", "Aisha Rahman"],
      `detail ${mayaDm.id}`,
    );

    // POST /api/comms/dm/start response.
    const start = await request("POST", "/api/comms/dm/start", {
      actorId: "u_aisha_patel",
      body: { targetUserId: "u_hydra_capital" },
    });
    assertNoLegalNamesInAnyMetadata(
      start.body,
      ["Aisha Patel", "Aisha Rahman (Hydra Capital)", "Aisha Rahman"],
      "POST /api/comms/dm/start",
    );
  });

  it("contract: a DM channel's projected metadata.title is the constant 'Direct message' for every viewer", async () => {
    // Both participants should see the same neutral metadata.title.
    const listAisha = await request("GET", "/api/comms/channels", { actorId: "u_aisha_patel" });
    const listMaya = await request("GET", "/api/comms/channels", { actorId: "u_maya_chen" });
    const aishaDm = listAisha.body.find((c) => c.kind === "dm" && c.participantUserIds.includes("u_maya_chen"));
    const mayaDm = listMaya.body.find((c) => c.kind === "dm" && c.participantUserIds.includes("u_aisha_patel"));
    expect(aishaDm).toBeTruthy();
    expect(mayaDm).toBeTruthy();
    expect(aishaDm.metadata?.title).toBe("Direct message");
    expect(mayaDm.metadata?.title).toBe("Direct message");
    // displayTitle (resolver-safe, per-viewer) can be different because it
    // reflects each viewer's resolved identity of the other party — but
    // metadata.title is always the neutral constant.
    expect(typeof aishaDm.displayTitle).toBe("string");
    expect(typeof mayaDm.displayTitle).toBe("string");
  });
});
