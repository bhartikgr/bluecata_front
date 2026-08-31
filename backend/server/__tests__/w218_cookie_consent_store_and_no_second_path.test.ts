/**
 * WAVE 218 — THE CONSENT LEDGER, OVER REAL HTTP. WHAT IS AND IS NOT ENFORCED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT CLAIM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wave 218 builds NO server-side gate. That is the wave's conclusion, not an
 * omission: the enumerated inventory found no analytics cookie, no advertising
 * cookie, no third-party cookie and no tag manager, so there is nothing for a
 * consent fence to guard and a fence in front of every first visit would have
 * been a lockout risk taken on for no benefit. So this file does not prove a gate
 * is enforced — there is none to prove.
 *
 * What it proves instead is the set of claims the wave DOES make about the
 * server, each of which would otherwise be an assertion on trust:
 *
 *   §1  The consent ledger already exists, is the ONLY consent path, and already
 *       accepts the `cookies` document. No second store was created (R171.1).
 *   §2  When a consent IS recorded it carries a server-observed timestamp, a
 *       server-observed IP, the user agent, and the version identity of the
 *       corpus served — read back over HTTP, from the row the server wrote, not
 *       from the request that asked for it.
 *   §3  Marketing consent CANNOT be bundled into cookie consent through this API,
 *       because the document vocabulary is closed and contains no marketing
 *       document. This is attacked directly, by trying it.
 *   §4  The served corpus version did not move. A bump would have re-prompted
 *       every user who has already consented.
 *   §5  An unauthenticated caller cannot write a consent row for someone else.
 *
 * REAL EXPRESS, REAL ROUTE REGISTRATION, REAL SOCKET. The harness is copied in
 * shape from `server/__tests__/w210_legal_corpus_consolidation.test.ts` so that
 * both files exercise the same routes the same way, rather than one of them
 * exercising a convenient replica (handbook §8).
 *
 * FIELD NAMES WERE CHECKED AGAINST THE WRITER BEFORE ANY ASSERTION WAS WRITTEN.
 * `server/legalConsentStore.ts` writes `documentId`, `documentVersion`,
 * `acceptedAt`, `ipAddress`, `userAgent`, `hash`, `prevHash`. An assertion keyed
 * to a field the writer never writes passes against `undefined` and proves
 * nothing — that is inert-proof mechanism (5), and it cost this builder a real
 * false pass in wave 217. Every read below is a field the writer writes, and
 * every query that returns rows fails if it returns zero.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registerLegalConsentRoutes } from "../legalConsentStore";
import { ADOPTED_LEGAL_CORPUS_VERSION } from "../../shared/wave210LegalCorpusVersion";
import { ADOPTED_LEGAL_DOCS } from "../../client/src/lib/legalDocsV2";

const REPO = path.resolve(__dirname, "../..");
const readText = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

async function req(
  app: express.Express,
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, any> = {
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        ...(headers ?? {}),
      };
      const r = http.request({ hostname: "127.0.0.1", port, path: urlPath, method, headers: reqHeaders }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          server.close();
          const buf = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      });
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  registerLegalConsentRoutes(app);
  return app;
}

const USER = "u_w218_cookies";

describe("WAVE 218 §1 — one consent store, and it already accepts `cookies`", () => {
  it("1a: the ONE store is the only consent write path, and it names the one table", () => {
    const store = readText("server/legalConsentStore.ts");
    /* The closed vocabulary contains `cookies` already — wave 218 added nothing
     * to it, which is the point of R171.1. */
    expect(store).toContain('"cookies"');
    expect(readText("server/lib/auditChainVerifier.ts")).toContain('"legal_consents"');
    /* Exactly one POST route writes consent. A second one would be the second
     * path the brief forbids. */
    expect((store.match(/app\.post\("\/api\/legal\/consent"/g) ?? []).length).toBe(1);
  });

  it("1b: no second consent store file was created by this wave", () => {
    /* The wave touched two production files. Neither is a store. */
    const v2 = readText("client/src/lib/legalDocsV2.ts");
    expect(v2).not.toContain("recordConsent");
    expect(v2).not.toContain("legalConsents");
    const intercept = readText("client/src/components/FrozenFooterTermsInterception.tsx");
    expect(intercept).not.toContain("fetch(");
    expect(intercept).not.toContain("consent");
  });
});

describe("WAVE 218 §2 — a recorded cookie consent carries what evidence must carry", () => {
  it("2a: POST /api/legal/consent records `cookies` with server-observed IP, UA and version", async () => {
    const app = makeApp();
    const ua = "w218-agent/1.0";
    const post = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["cookies"], context: "settings_update" },
      { "x-user-id": USER, "user-agent": ua },
    );
    expect(post.status).toBe(200);
    expect(post.body.ok).toBe(true);
    expect(Array.isArray(post.body.recorded)).toBe(true);
    expect(post.body.recorded.length).toBe(1);
    /* The version the SERVER wrote, reported beside the ids by wave 210. */
    expect(post.body.documentVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);

    const mine = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": USER });
    expect(mine.status).toBe(200);
    const rows = (mine.body.consents ?? mine.body.rows ?? mine.body) as any[];
    const cookieRows = (Array.isArray(rows) ? rows : []).filter((r) => r.documentId === "cookies");
    /* FAIL LOUDLY ON ZERO ROWS. A filter that returns nothing would make every
     * assertion below vacuously true — the exact shape of a proof that proves
     * nothing. */
    expect(cookieRows.length, "no `cookies` consent row came back — the read is not reading the write").toBeGreaterThan(0);
    const row = cookieRows[cookieRows.length - 1];
    /* Field names taken from the writer, not guessed. */
    expect(typeof row.acceptedAt).toBe("string");
    expect(row.acceptedAt.length).toBeGreaterThan(0);
    expect(row.documentVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
    expect(row.userAgent).toBe(ua);
    /* Server-observed, i.e. the socket peer — NOT anything the caller typed. */
    expect(typeof row.ipAddress === "string" || row.ipAddress === null).toBe(true);
    if (typeof row.ipAddress === "string") {
      expect(row.ipAddress).not.toBe("203.0.113.9");
    }
    expect(typeof row.hash).toBe("string");
    expect(row.hash.length).toBeGreaterThan(0);
  });

  it("2b: a forged `x-forwarded-for` does NOT become the recorded IP", async () => {
    const app = makeApp();
    const user = `${USER}_forge`;
    const post = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["cookies"], context: "settings_update" },
      { "x-user-id": user, "x-forwarded-for": "203.0.113.9", "user-agent": "w218-forger/1.0" },
    );
    expect(post.status).toBe(200);
    const mine = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": user });
    const rows = (mine.body.consents ?? mine.body.rows ?? mine.body) as any[];
    const cookieRows = (Array.isArray(rows) ? rows : []).filter((r) => r.documentId === "cookies");
    expect(cookieRows.length).toBeGreaterThan(0);
    /* Wave 22's trusted-hop resolution, fail-closed to the socket peer. The
     * caller's claim about its own address is not evidence. */
    expect(cookieRows[cookieRows.length - 1].ipAddress).not.toBe("203.0.113.9");
  });

  it("2c: a declared version the server does not know is REFUSED, not recorded", async () => {
    const app = makeApp();
    const bad = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["cookies"], context: "settings_update", documentVersion: "2099-01-01" },
      { "x-user-id": `${USER}_badver` },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unknown_legal_corpus_version");
  });
});

describe("WAVE 218 §3 — marketing consent CANNOT be bundled in. Attacked directly.", () => {
  /* The rule: a single tick covering both cookie and marketing consent is
   * invalid. These tests try to create exactly that through the API. */
  for (const forged of ["marketing", "marketing-consent", "marketing_opt_in", "cookies-and-marketing"]) {
    it(`3a: documentIds ["cookies","${forged}"] is REFUSED by the closed vocabulary`, async () => {
      const app = makeApp();
      const r = await req(
        app,
        "POST",
        "/api/legal/consent",
        { documentIds: ["cookies", forged], context: "settings_update" },
        { "x-user-id": `${USER}_bundle` },
      );
      expect(r.status).toBe(400);
      expect(String(r.body.error)).toContain("invalid documentIds");
      expect(String(r.body.error)).toContain(forged);
    });
  }

  it("3b: and the refusal is total — the `cookies` half is not recorded either", async () => {
    const app = makeApp();
    const user = `${USER}_bundle_atomic`;
    const r = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["cookies", "marketing"], context: "settings_update" },
      { "x-user-id": user },
    );
    expect(r.status).toBe(400);
    /* Presence and type of the vocabulary check happen BEFORE any write, so a
     * partially-accepted bundle cannot exist. */
    const mine = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": user });
    const rows = (mine.body.consents ?? mine.body.rows ?? mine.body) as any[];
    expect((Array.isArray(rows) ? rows : []).filter((x) => x.documentId === "cookies").length).toBe(0);
  });

  it("3c: no marketing consent column exists in EITHER schema path", () => {
    /* Both paths must actually be READ. A `continue` on a missing file would make
     * this test pass by reading nothing, which is the vacuous-pass shape. */
    let read = 0;
    for (const rel of ["shared/schema.ts", "server/db/schema.ts"]) {
      const src = readText(rel);
      expect(src.length, `${rel} is empty`).toBeGreaterThan(100);
      read += 1;
      expect(src).not.toMatch(/marketing_opt_in|marketingOptIn|marketing_consent|marketingConsent/);
    }
    expect(read).toBe(2);
  });
});

describe("WAVE 218 §4 — the served corpus version did not move", () => {
  it("4a: GET /api/legal/corpus/active still names the adopted version", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/legal/corpus/active");
    expect(r.status).toBe(200);
    expect(r.body.activeVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("4b: the cookie document served by the corpus carries the corrected clause", () => {
    const doc = ADOPTED_LEGAL_DOCS.find((d) => d.id === "cookies");
    expect(doc).toBeDefined();
    expect(doc!.body).toContain("What is actually set on your device");
    expect(doc!.body).toContain("There is no analytics on this platform.");
    /* And the superseded wording is still there, because nothing was deleted. */
    expect(doc!.body).toContain("you will be presented with a cookie consent banner");
  });
});

describe("WAVE 218 §5 — an unauthenticated caller cannot write consent", () => {
  it("5a: POST with no identity is 401 and writes nothing", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/legal/consent", {
      documentIds: ["cookies"],
      context: "settings_update",
    });
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
  });
});
