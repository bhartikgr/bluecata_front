/**
 * WAVE 210 — LEGAL CORPORA CONSOLIDATION. SERVER-SIDE PROOFS.
 *
 * THE DEFECT THIS WAVE WAS SENT TO FIX, stated as the owner's brief stated it:
 * "a user clicks the footer, reads the stub, and their consent record attests to
 * a different document with a different date naming a different entity."
 *
 * Two corpora existed. `client/src/lib/legalDocs.ts` (five documents, 17 March
 * 2026, party name misspelled "Blueprint Catalyst Limited") was what the
 * mandatory signup consent recorded against, and NO ROUTE SERVED IT.
 * `client/src/pages/Terms.tsx` / `Privacy.tsx` (15 June 2026, self-described
 * "interim stub", naming no legal person at all) was what `/terms-of-service`
 * and `/privacy-policy` served — every footer link in every silo.
 *
 * WHAT THIS FILE PROVES, and the reason each proof is shaped the way it is:
 *
 *   §1  VERSION IDENTITY LIVES IN `platform_config`. Not in a new table. The
 *       wave-195 store is hash-chained, undeletable by trigger and atomically
 *       audited; a second store would have been a second thing to trust.
 *
 *   §2  A CONSENT ROW NAMES THE VERSION THAT WAS DISPLAYED. Previously
 *       `recordConsent` stamped the `LEGAL_VERSION` compile-time constant in
 *       four places regardless of what the user actually read.
 *
 *   §3  HISTORICAL CONSENT ROWS ARE NOT MODIFIED. Count AND per-row fingerprint
 *       are captured before the wave's write paths run and compared after. This
 *       is the proof the brief demanded in those words.
 *
 *   §4  THE HASH CHAIN STILL VERIFIES ACROSS A MIXED-VERSION LEDGER. Old rows
 *       carrying "2026-03-17" and new rows carrying the adopted version coexist.
 *       `verifyChain()` recomputes each row's hash from THAT ROW'S OWN stored
 *       version, so this holds by construction — and the test states it, because
 *       "holds by construction" is exactly the kind of claim that rots silently.
 *
 *   §5  AN UNKNOWN VERSION IS REFUSED, NOT COERCED. Actively attempting to
 *       record a consent naming a version the platform does not publish must
 *       fail closed, and the refusal must fit the 240-character `looksHuman`
 *       gate.
 *
 *   §6  ADVERSARIAL — ACTIVELY TRY TO RECORD A CONSENT THAT DOES NOT NAME A
 *       VERSION, and actively try to modify a historical row through the public
 *       surface. Both must be impossible.
 *
 *   §7  THE ADOPTED CORPUS IS BYTE-DERIVED FROM THE OLD ONE. The old file is
 *       not edited and not deleted: its sha256 is asserted, and the adopted
 *       corpus is proven to differ from it ONLY in the party name, the date
 *       label and the two appended clauses.
 *
 *   §8  THE DO-NOT-PUBLISH REGISTER. Five sentences from the drafts directory
 *       are legally consequential and were NOT cleared for publication; none may
 *       appear in served text. And the counsel-review language in the drafts
 *       directory must still be there — R190.11: the owner accepting the risk of
 *       going live does not convert a draft into reviewed advice.
 *
 * WHAT THIS FILE DOES NOT PROVE. It does not touch a live deployment; there is
 * no live access in this environment and nothing here should be read as
 * "verified in production". It does not prove the served DOM — that is
 * `client/src/components/__tests__/w210_legal_surfaces.test.tsx`, which mounts
 * the real pages.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  registerLegalConsentRoutes,
  recordConsent,
  getConsentsForUser,
  getAllConsents,
  verifyChain,
  resolveConsentDocumentVersion,
  legalCorpusVersionRefusal,
  _testLegalConsent,
} from "../legalConsentStore";
import {
  ensureLegalCorpusVersionKey,
  readActiveLegalCorpusVersion,
  readLegalCorpusVersionRow,
  setActiveLegalCorpusVersion,
} from "../lib/wave210LegalCorpusVersionStore";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  ADOPTED_LEGAL_CORPUS_DATE_LABEL,
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
  SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15,
  KNOWN_LEGAL_CORPUS_VERSIONS,
  LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY,
  isKnownLegalCorpusVersion,
  MISSPELLED_PARTY_NAME,
  REGISTERED_PARTY_NAME,
} from "@shared/wave210LegalCorpusVersion";
import { LEGAL_DOCS, LEGAL_VERSION } from "../../client/src/lib/legalDocs";
import { ADOPTED_LEGAL_DOCS, LEGAL_VERSION_V2 } from "../../client/src/lib/legalDocsV2";

const REPO = path.resolve(__dirname, "../..");

/* ── HTTP harness. Real express app, real route registration, real socket. ──
 * Copied in shape from server/__tests__/sprint28_legal_consent.test.ts so the
 * two files exercise the routes the same way. */
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

/** The fingerprint the brief asked for: one hash over the whole ledger, built
 *  from the fields that constitute the legal attestation. If ANY historical row
 *  is rewritten — the version, the timestamp, the chain link, anything — this
 *  changes. */
function ledgerFingerprint(): { count: number; fingerprint: string; rows: string[]; versions: string[] } {
  const all = getAllConsents();
  const rows = all.map(
    (c) => `${c.id}|${c.userId}|${c.documentId}|${c.documentVersion}|${c.acceptedAt}|${c.prevHash}|${c.hash}`,
  );
  return {
    count: rows.length,
    fingerprint: createHash("sha256").update(rows.join("\n")).digest("hex"),
    rows,
    versions: all.map((c) => c.documentVersion),
  };
}

describe("WAVE 210 §1 — version identity lives in platform_config, not a second store", () => {
  beforeEach(() => { _testLegalConsent.reset(); });

  it("seeds `legal.corpus.active_version` into platform_config and reads it back", () => {
    ensureLegalCorpusVersionKey("w210-test");
    const row = readLegalCorpusVersionRow();
    expect(row).toBeTruthy();
    expect(row!.key).toBe(LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY);
    /* The wave-195 store keeps values as JSON in `value_json`. We read it the
     * way the store exposes it rather than assuming a bare column. */
    expect(JSON.parse(row!.valueJson)).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
    expect(row!.valueType).toBe("string");
    expect(readActiveLegalCorpusVersion()).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("the config row is hash-chained by the wave-195 store — it carries a revision hash", () => {
    ensureLegalCorpusVersionKey("w210-test");
    const row = readLegalCorpusVersionRow() as any;
    /* We are not re-proving wave 195's chain here; we are proving we are INSIDE
     * it rather than beside it. A row with no chain field would mean this wave
     * quietly invented a second store, which the brief forbade. */
    expect(typeof row.revisionHash).toBe("string");
    expect(row.revisionHash.length).toBeGreaterThan(0);
    expect(typeof row.prevRevisionHash).toBe("string");
    expect(typeof row.version).toBe("number");
  });

  it("refuses to activate a version the platform does not publish", () => {
    ensureLegalCorpusVersionKey("w210-test");
    const refused = setActiveLegalCorpusVersion({ version: "2027-01-01", changedBy: "w210-test" });
    expect(refused.ok).toBe(false);
    expect((refused as { ok: false; reason: string }).reason).toContain(ADOPTED_LEGAL_CORPUS_VERSION);
    expect(readActiveLegalCorpusVersion()).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("accepts a version it does publish — the superseded ones stay reachable, not deleted", () => {
    ensureLegalCorpusVersionKey("w210-test");
    expect(setActiveLegalCorpusVersion({ version: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15, changedBy: "w210-test" }).ok).toBe(true);
    expect(readActiveLegalCorpusVersion()).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15);
    expect(setActiveLegalCorpusVersion({ version: ADOPTED_LEGAL_CORPUS_VERSION, changedBy: "w210-test" }).ok).toBe(true);
    expect(readActiveLegalCorpusVersion()).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("both superseded versions are KNOWN — retired, retrievable, not erased", () => {
    expect(KNOWN_LEGAL_CORPUS_VERSIONS).toContain(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
    expect(KNOWN_LEGAL_CORPUS_VERSIONS).toContain(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15);
    expect(KNOWN_LEGAL_CORPUS_VERSIONS).toContain(ADOPTED_LEGAL_CORPUS_VERSION);
    /* "2026-03-17" is the LEGAL_VERSION the old corpus shipped with. It must be
     * a known version, because thousands of historical consent rows name it and
     * a reader of the ledger must be able to resolve it. */
    expect(LEGAL_VERSION).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
  });
});

describe("WAVE 210 §2 — a consent row names the version actually displayed", () => {
  beforeEach(() => { _testLegalConsent.reset(); ensureLegalCorpusVersionKey("w210-test"); });

  it("with no declared version, the row names the ACTIVE version, not the compile-time constant", () => {
    const r = recordConsent({ userId: "u_w210_a", documentId: "terms", context: "signup", ipAddress: null, userAgent: null });
    expect(r.consent.documentVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
    /* The regression guard: the OLD behaviour stamped LEGAL_VERSION. If someone
     * reinstates that, this line fails. */
    expect(r.consent.documentVersion).not.toBe(LEGAL_VERSION);
  });

  it("with a declared version, the row names exactly what the client displayed", () => {
    const r = recordConsent({
      userId: "u_w210_b", documentId: "privacy", context: "signup",
      ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    expect(r.consent.documentVersion).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
  });

  it("idempotency is scoped to the version — a NEW version produces a NEW row beside the old one", () => {
    const first = recordConsent({
      userId: "u_w210_c", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const same = recordConsent({
      userId: "u_w210_c", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const newer = recordConsent({
      userId: "u_w210_c", documentId: "terms", context: "settings_update", ipAddress: null, userAgent: null,
      documentVersion: ADOPTED_LEGAL_CORPUS_VERSION,
    });
    expect(first.isNew).toBe(true);
    expect(same.isNew).toBe(false);              // ADD BESIDE, never duplicate
    expect(newer.isNew).toBe(true);              // ADD BESIDE, never rewrite
    const mine = getConsentsForUser("u_w210_c");
    expect(mine.length).toBe(2);
    expect(mine.map((c) => c.documentVersion).sort())
      .toEqual([ADOPTED_LEGAL_CORPUS_VERSION, SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17].sort());
  });

  it("resolveConsentDocumentVersion: known version honoured, absent falls back, JUNK REFUSED", () => {
    expect(resolveConsentDocumentVersion(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15))
      .toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15);
    /* Absent is legitimate — an old caller that does not know about versions. */
    expect(resolveConsentDocumentVersion(null)).toBe(readActiveLegalCorpusVersion());
    expect(resolveConsentDocumentVersion(undefined)).toBe(readActiveLegalCorpusVersion());
    expect(resolveConsentDocumentVersion("")).toBe(readActiveLegalCorpusVersion());
    /* Junk is NOT quietly coerced to the active version. A caller that claims to
     * have displayed something we never published is a bug, and recording an
     * attestation against a substituted version would recreate the exact defect
     * this wave exists to fix. Fail closed. */
    for (const junk of ["nonsense", "2026", "2026-08-31", "latest"]) {
      expect(() => resolveConsentDocumentVersion(junk)).toThrow(/unknown_legal_corpus_version/);
    }
  });

  it("HTTP: POST /api/legal/consent then GET /api/legal/consent/mine — the versions match", async () => {
    const app = makeApp();
    const post = await req(app, "POST", "/api/legal/consent",
      { documentIds: ["terms", "privacy"], context: "signup", documentVersion: ADOPTED_LEGAL_CORPUS_VERSION },
      { "x-user-id": "u_w210_http" });
    expect(post.status).toBe(200);
    expect(post.body.ok).toBe(true);
    /* `recorded` is an array of consent IDS — the shape sprint-28 asserts and
     * this wave did not change. The version is reported beside it. */
    expect(Array.isArray(post.body.recorded)).toBe(true);
    expect(post.body.recorded.length).toBe(2);
    expect(post.body.documentVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);

    const mine = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": "u_w210_http" });
    expect(mine.status).toBe(200);
    const versions = (mine.body.consents ?? mine.body.records ?? mine.body).map((c: any) => c.documentVersion);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const v of versions) expect(v).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("HTTP: GET /api/legal/corpus/active is public and names the served version", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/legal/corpus/active");   // NO x-user-id
    expect(r.status).toBe(200);
    expect(r.body.activeVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });
});

describe("WAVE 210 §3 — no historical consent row is modified. Count and fingerprint.", () => {
  beforeEach(() => { _testLegalConsent.reset(); ensureLegalCorpusVersionKey("w210-test"); });

  it("BEFORE/AFTER: writing new consents at the new version leaves every old row byte-identical", async () => {
    /* Build a "historical" ledger the way it existed before this wave: rows
     * naming the March corpus. */
    for (const [u, d] of [["h1", "terms"], ["h1", "privacy"], ["h2", "acceptable-use"], ["h3", "cookies"]] as const) {
      recordConsent({
        userId: `u_hist_${u}`, documentId: d, context: "signup", ipAddress: null, userAgent: null,
        documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
      });
    }
    const before = ledgerFingerprint();
    expect(before.count).toBe(4);
    /* Compare the VERSION FIELD, not a substring of the row: `acceptedAt` is an
     * ISO timestamp that on the day this wave was built happens to contain the
     * adopted version string itself. A substring test would have been a
     * coincidence-dependent test, which is not a test. */
    for (const v of before.versions) expect(v).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);

    /* Now exercise EVERY write path this wave touches. */
    ensureLegalCorpusVersionKey("w210-test");
    setActiveLegalCorpusVersion({ version: ADOPTED_LEGAL_CORPUS_VERSION, changedBy: "w210-test" });
    recordConsent({ userId: "u_new_a", documentId: "terms", context: "settings_update", ipAddress: null, userAgent: null });
    const app = makeApp();
    await req(app, "POST", "/api/legal/consent",
      { documentIds: ["terms", "privacy"], context: "settings_update", documentVersion: ADOPTED_LEGAL_CORPUS_VERSION },
      { "x-user-id": "u_hist_h1" });                       // the SAME user as a historical row
    await req(app, "GET", "/api/legal/consent/acknowledgement", undefined, { "x-user-id": "u_hist_h1" });
    await req(app, "GET", "/api/legal/corpus/active");

    const after = ledgerFingerprint();

    /* THE PROOF. The first four rows — identity, version, timestamp, both chain
     * links — are unchanged, and the ledger only grew. */
    expect(after.count).toBeGreaterThan(before.count);
    expect(after.rows.slice(0, before.count)).toEqual(before.rows);
    expect(createHash("sha256").update(after.rows.slice(0, before.count).join("\n")).digest("hex"))
      .toBe(before.fingerprint);

    /* And every historical row still names the version it always named. */
    for (const v of after.versions.slice(0, before.count)) {
      expect(v).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
      expect(v).not.toBe(ADOPTED_LEGAL_CORPUS_VERSION);
    }
  });

  it("we can still prove what an earlier user agreed to, by name and by version", () => {
    recordConsent({
      userId: "u_earlier", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    recordConsent({
      userId: "u_earlier", documentId: "terms", context: "settings_update", ipAddress: null, userAgent: null,
      documentVersion: ADOPTED_LEGAL_CORPUS_VERSION,
    });
    const mine = getConsentsForUser("u_earlier");
    /* Two attestations, two versions, both retrievable. This is the answer to
     * the owner's third question. */
    expect(mine.filter((c) => c.documentVersion === SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17).length).toBe(1);
    expect(mine.filter((c) => c.documentVersion === ADOPTED_LEGAL_CORPUS_VERSION).length).toBe(1);
  });
});

describe("WAVE 210 §4 — the hash chain verifies across a mixed-version ledger", () => {
  beforeEach(() => { _testLegalConsent.reset(); ensureLegalCorpusVersionKey("w210-test"); });

  it("interleaved old-version and new-version rows still form one verifying chain", () => {
    const versions = [
      SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
      ADOPTED_LEGAL_CORPUS_VERSION,
      SUPERSEDED_LEGAL_CORPUS_VERSION_2026_06_15,
      ADOPTED_LEGAL_CORPUS_VERSION,
      SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    ];
    versions.forEach((v, i) => {
      recordConsent({
        userId: `u_mix_${i}`, documentId: "terms", context: "signup",
        ipAddress: null, userAgent: null, documentVersion: v,
      });
    });
    const all = getAllConsents();
    expect(all.length).toBe(5);
    expect(all.map((c) => c.documentVersion)).toEqual(versions);
    expect(verifyChain()).toEqual({ ok: true, brokenAt: -1 });
    /* The links are real links, not zeros. */
    expect(all[0].prevHash).toBe("0".repeat(64));
    for (let i = 1; i < all.length; i++) expect(all[i].prevHash).toBe(all[i - 1].hash);
  });

  it("the version is INSIDE the hashed snapshot — so a rewritten version breaks the chain", () => {
    /* This is the property that makes §3 meaningful. If `documentVersion` were
     * not hashed, a silent rewrite of a historical row's version would leave the
     * chain verifying and the tampering undetectable. */
    const a = recordConsent({
      userId: "u_h", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const b = recordConsent({
      userId: "u_h", documentId: "privacy", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: ADOPTED_LEGAL_CORPUS_VERSION,
    });
    const recompute = (prev: string, c: any, version: string) =>
      createHash("sha256").update(`${prev}|${c.id}|${c.userId}|${c.documentId}|${version}|${c.acceptedAt}`).digest("hex");
    expect(recompute(a.consent.prevHash, a.consent, a.consent.documentVersion)).toBe(a.consent.hash);
    /* Same row, different version → different hash. The version is load-bearing. */
    expect(recompute(a.consent.prevHash, a.consent, ADOPTED_LEGAL_CORPUS_VERSION)).not.toBe(a.consent.hash);
    expect(recompute(b.consent.prevHash, b.consent, b.consent.documentVersion)).toBe(b.consent.hash);
  });
});

describe("WAVE 210 §5 — an unknown version is refused, and the refusal is readable", () => {
  beforeEach(() => { _testLegalConsent.reset(); ensureLegalCorpusVersionKey("w210-test"); });

  it("HTTP: a declared version we do not publish → 400, no row written", async () => {
    const app = makeApp();
    const before = ledgerFingerprint();
    const r = await req(app, "POST", "/api/legal/consent",
      { documentIds: ["terms"], context: "signup", documentVersion: "1999-01-01" },
      { "x-user-id": "u_w210_bad" });
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("unknown_legal_corpus_version");
    const after = ledgerFingerprint();
    expect(after.count).toBe(before.count);
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it("the refusal fits the 240-character looksHuman gate and names the version asked for", () => {
    for (const junk of ["1999-01-01", "latest", "", "x".repeat(400)]) {
      const msg = legalCorpusVersionRefusal(junk);
      expect(msg.length).toBeLessThanOrEqual(240);
      expect(msg.trim().length).toBeGreaterThan(20);
      /* R-ASSERT: it must not invent a figure. It states what IS published. */
      expect(msg).toContain(ADOPTED_LEGAL_CORPUS_VERSION);
    }
  });

  it("isKnownLegalCorpusVersion is closed, not permissive", () => {
    expect(isKnownLegalCorpusVersion(ADOPTED_LEGAL_CORPUS_VERSION)).toBe(true);
    for (const junk of [null, undefined, 0, "", "2026", "2026-08-31", {}, [], "2026-08-30 "]) {
      expect(isKnownLegalCorpusVersion(junk as unknown)).toBe(false);
    }
  });
});

describe("WAVE 210 §6 — ADVERSARIAL: try to record a versionless consent; try to rewrite history", () => {
  beforeEach(() => { _testLegalConsent.reset(); ensureLegalCorpusVersionKey("w210-test"); });

  it("ATTACK: every shape of 'no version' still produces a row that NAMES a version", async () => {
    const app = makeApp();
    const attacks: any[] = [
      { documentIds: ["terms"], context: "signup" },                                   // omitted
      { documentIds: ["terms"], context: "signup", documentVersion: null },             // null
      { documentIds: ["terms"], context: "signup", documentVersion: undefined },        // undefined
    ];
    let i = 0;
    for (const body of attacks) {
      const userId = `u_atk_${i++}`;
      const r = await req(app, "POST", "/api/legal/consent", body, { "x-user-id": userId });
      expect(r.status).toBe(200);
      expect(typeof r.body.documentVersion).toBe("string");
      expect(isKnownLegalCorpusVersion(r.body.documentVersion)).toBe(true);
      /* Not just the response — the ROW. A response can lie; the ledger is the
       * artefact a lawyer would be shown. */
      for (const c of getConsentsForUser(userId)) {
        expect(typeof c.documentVersion).toBe("string");
        expect(c.documentVersion.length).toBeGreaterThan(0);
        expect(isKnownLegalCorpusVersion(c.documentVersion)).toBe(true);
      }
    }
    /* And through the store directly, bypassing the route. */
    const direct = recordConsent({
      userId: "u_atk_direct", documentId: "terms", context: "signup",
      ipAddress: null, userAgent: null, documentVersion: undefined,
    });
    expect(isKnownLegalCorpusVersion(direct.consent.documentVersion)).toBe(true);

    /* NOT ONE ROW in the whole ledger lacks a known version. */
    for (const c of getAllConsents()) expect(isKnownLegalCorpusVersion(c.documentVersion)).toBe(true);
  });

  it("ATTACK: no public route accepts an edit or a delete of a consent row", async () => {
    recordConsent({
      userId: "u_victim", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const before = ledgerFingerprint();
    const target = getAllConsents()[0];
    const app = makeApp();

    const attempts: Array<[string, string, any]> = [
      ["PUT",    "/api/legal/consent",                    { id: target.id, documentVersion: ADOPTED_LEGAL_CORPUS_VERSION }],
      ["PATCH",  "/api/legal/consent",                    { id: target.id, documentVersion: ADOPTED_LEGAL_CORPUS_VERSION }],
      ["DELETE", `/api/legal/consent/${target.id}`,       undefined],
      ["PUT",    `/api/legal/consent/${target.id}`,       { documentVersion: ADOPTED_LEGAL_CORPUS_VERSION }],
      ["POST",   "/api/legal/consent",                    { documentIds: ["terms"], context: "signup", documentVersion: ADOPTED_LEGAL_CORPUS_VERSION, id: target.id }],
    ];
    for (const [method, url, body] of attempts) {
      const r = await req(app, method, url, body, { "x-user-id": "u_victim" });
      /* We do not care WHICH way it refuses (404 no such route, 405, 400) — we
       * care that the ledger is untouched after all of them. */
      expect([200, 400, 401, 403, 404, 405]).toContain(r.status);
    }

    const after = ledgerFingerprint();
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(after.versions[0]).toBe(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
    expect(verifyChain().ok).toBe(true);
  });

  it("ATTACK: the acknowledgement read NEVER blocks and NEVER writes", async () => {
    /* The re-consent decision was a non-blocking notification. A read that could
     * fail closed, or that wrote on read, would turn it into a gate. */
    recordConsent({
      userId: "u_ack", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const before = ledgerFingerprint();
    const app = makeApp();
    for (const headers of [{ "x-user-id": "u_ack" }, { "x-user-id": "u_nobody" }, {}]) {
      const r = await req(app, "GET", "/api/legal/consent/acknowledgement", undefined, headers);
      expect(r.status).toBe(200);                       // never 401, never 500
    }
    const after = ledgerFingerprint();
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.count).toBe(before.count);
  });

  it("ATTACK: a user who already consented at the adopted version is not nagged", async () => {
    const app = makeApp();
    await req(app, "POST", "/api/legal/consent",
      { documentIds: ["terms", "privacy", "acceptable-use", "cookies", "disclaimer"], context: "signup", documentVersion: ADOPTED_LEGAL_CORPUS_VERSION },
      { "x-user-id": "u_uptodate" });
    const r = await req(app, "GET", "/api/legal/consent/acknowledgement", undefined, { "x-user-id": "u_uptodate" });
    expect(r.status).toBe(200);
    expect(r.body.needsAcknowledgement).toBe(false);
    expect(r.body.acknowledgedVersions).toContain(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("a user whose only consent predates the adopted version IS told, but not blocked", async () => {
    recordConsent({
      userId: "u_stale", documentId: "terms", context: "signup", ipAddress: null, userAgent: null,
      documentVersion: SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17,
    });
    const app = makeApp();
    const r = await req(app, "GET", "/api/legal/consent/acknowledgement", undefined, { "x-user-id": "u_stale" });
    expect(r.status).toBe(200);
    expect(r.body.needsAcknowledgement).toBe(true);
    expect(r.body.activeVersion).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
    expect(r.body.acknowledgedVersions).toContain(SUPERSEDED_LEGAL_CORPUS_VERSION_2026_03_17);
    /* "Told" must not mean "locked out": the response carries no gate flag and
     * the platform's other routes are not consulted. Proven negatively — there
     * is no field that any shell could read as a block. */
    expect(r.body.blocking).toBeFalsy();
    expect(r.body.mustReconsent).toBeFalsy();
  });
});

describe("WAVE 210 §7 — the adopted corpus is DERIVED from the old file, which is untouched", () => {
  it("client/src/lib/legalDocs.ts is byte-unchanged (R143.1: nothing replaced, nothing deleted)", () => {
    const bytes = readFileSync(path.join(REPO, "client/src/lib/legalDocs.ts"));
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("80ecf559c6192cef1310b4a8e4258ccf3cd73e8edcd62569fa365c4db58ef25e");
  });

  it("the same five documents, same ids, same order — nothing added, nothing dropped", () => {
    expect(ADOPTED_LEGAL_DOCS.length).toBe(LEGAL_DOCS.length);
    expect(ADOPTED_LEGAL_DOCS.length).toBe(5);
    expect(ADOPTED_LEGAL_DOCS.map((d) => d.id)).toEqual(LEGAL_DOCS.map((d) => d.id));
    expect(ADOPTED_LEGAL_DOCS.map((d) => d.title)).toEqual(LEGAL_DOCS.map((d) => d.title));
  });

  it("the party name is corrected in EVERY adopted document — A8, byte-exact", () => {
    expect(REGISTERED_PARTY_NAME).toBe("BluePrint Catalyst Limited");
    expect(MISSPELLED_PARTY_NAME).toBe("Blueprint Catalyst Limited");
    expect(REGISTERED_PARTY_NAME).not.toBe(MISSPELLED_PARTY_NAME);
    for (const doc of ADOPTED_LEGAL_DOCS) {
      const blob = `${doc.title}\n${doc.entity ?? ""}\n${doc.body ?? ""}\n${doc.lastUpdated ?? ""}`;
      expect(blob).not.toContain(MISSPELLED_PARTY_NAME);
      expect(blob).toContain(REGISTERED_PARTY_NAME);
    }
    /* And the OLD corpus still contains the misspelling — because we did not
     * edit it. That is the point of "additively". */
    const oldBlob = LEGAL_DOCS.map((d) => `${d.entity ?? ""}\n${d.body ?? ""}`).join("\n");
    expect(oldBlob).toContain(MISSPELLED_PARTY_NAME);
  });

  it("occurrence counts are PRESERVED, not reduced — the same number of mentions, spelled right", () => {
    const count = (s: string, needle: string) => s.split(needle).length - 1;
    for (let i = 0; i < LEGAL_DOCS.length; i++) {
      const oldBody = LEGAL_DOCS[i].body ?? "";
      const newBody = ADOPTED_LEGAL_DOCS[i].body ?? "";
      const oldMentions = count(oldBody, MISSPELLED_PARTY_NAME) + count(oldBody, REGISTERED_PARTY_NAME);
      const newMentions = count(newBody, REGISTERED_PARTY_NAME);
      /* >= because the two appended clauses name the party too. Never <. */
      expect(newMentions).toBeGreaterThanOrEqual(oldMentions);
    }
  });

  it("the date label is the adopted one, and the version constants agree", () => {
    for (const doc of ADOPTED_LEGAL_DOCS) expect(doc.lastUpdated).toBe(ADOPTED_LEGAL_CORPUS_DATE_LABEL);
    for (const doc of LEGAL_DOCS) expect(doc.lastUpdated).toBe("17 March 2026");   // untouched
    expect(LEGAL_VERSION_V2).toBe(ADOPTED_LEGAL_CORPUS_VERSION);
  });

  it("every sentence of the old body survives into the new body except the two we changed", () => {
    /* The strongest available statement of "we did not lose legal text": take
     * the old body, apply ONLY the party-name and date substitutions, and assert
     * the result is a PREFIX of the new body. Anything dropped, reordered or
     * reworded fails here. */
    for (let i = 0; i < LEGAL_DOCS.length; i++) {
      const expectedPrefix = (LEGAL_DOCS[i].body ?? "")
        .split(MISSPELLED_PARTY_NAME).join(REGISTERED_PARTY_NAME)
        .split("17 March 2026").join(ADOPTED_LEGAL_CORPUS_DATE_LABEL);
      expect(ADOPTED_LEGAL_DOCS[i].body.startsWith(expectedPrefix)).toBe(true);
    }
  });
});

describe("WAVE 210 §8 — the do-not-publish register, and the counsel-review header", () => {
  /* These five sentences live in build_log/legal/drafts/. Each is a substantive
   * legal position that was drafted for counsel review and NOT cleared for
   * publication. Publishing any of them would assert something about the
   * platform's regulatory posture or territorial exclusions that no one has
   * signed off. They must not appear in served text. */
  const DO_NOT_PUBLISH = [
    "not available to residents of the European Economic Area",
    "reviewed by Hong Kong counsel",
    "reviewed by counsel",
  ];
  /* Two phrases are legitimate ONLY in the negative. "…is not legal advice" and
   * "…is not authorised or regulated by the Securities and Futures Commission"
   * are correct and were already in the corpus; the AFFIRMATIVE forms would be
   * regulatory claims nobody has cleared. So these are checked for negation
   * rather than banned outright. */
  const NEGATION_REQUIRED = [
    "legal advice",
    "regulated by the securities and futures commission",
  ];

  it("no served document contains a sentence from the do-not-publish register", () => {
    for (const doc of ADOPTED_LEGAL_DOCS) {
      const blob = `${doc.title}\n${doc.entity ?? ""}\n${doc.body ?? ""}`.toLowerCase();
      for (const banned of DO_NOT_PUBLISH) {
        expect(blob).not.toContain(banned.toLowerCase());
      }
      for (const phrase of NEGATION_REQUIRED) {
        /* EVERY occurrence, not just the first — one un-negated instance among
         * twenty negated ones is the whole defect. */
        let from = 0;
        for (;;) {
          const idx = blob.indexOf(phrase, from);
          if (idx < 0) break;
          /* The negation is scoped to the SENTENCE, not to a fixed character
           * window. In this corpus the phrase sits inside long enumerations
           * ("nothing … constitutes financial advice, investment advice, tax
           * advice, legal advice, …") where the negating word is over a hundred
           * characters upstream. A fixed window would have passed or failed by
           * accident depending on list order. */
          const sentenceStart = Math.max(
            blob.lastIndexOf(". ", idx),
            blob.lastIndexOf("\n", idx),
            blob.lastIndexOf("? ", idx),
            blob.lastIndexOf("! ", idx),
            -1,
          ) + 1;
          const sentence = blob.slice(sentenceStart, idx);
          expect(
            /\b(not|no|never|nor|without|neither|nothing|none|does not|is not|are not)\b/.test(sentence),
          ).toBe(true);
          from = idx + phrase.length;
        }
      }
    }
  });

  it("no served document claims that counsel has reviewed it — R190.11", () => {
    /* Owner, verbatim: "Keep this in a file and I will eventually send to Hong
     * Kong council. I will take the risk of going live". Accepting the risk is
     * not the same as having had the review. Nothing may imply otherwise. */
    const CLAIMS_OF_REVIEW = [
      /reviewed by (?:our |external |hong kong )?(?:counsel|lawyer|solicitor|attorney)/i,
      /counsel[- ]approved/i,
      /legally (?:reviewed|vetted|approved)/i,
      /(?:vetted|approved) by (?:counsel|our lawyers)/i,
    ];
    for (const doc of ADOPTED_LEGAL_DOCS) {
      const blob = `${doc.title}\n${doc.entity ?? ""}\n${doc.body ?? ""}`;
      for (const re of CLAIMS_OF_REVIEW) expect(re.test(blob)).toBe(false);
    }
  });

  it("the drafts directory still carries its 'for review by counsel' language", () => {
    /* The brief forbade removing it. This test is the tripwire that a later
     * tidy-up cannot cross silently. */
    const drafts = path.join(REPO, "build_log/legal/drafts/00_DRAFTING_STANDARD_AND_HEADER.md");
    const text = readFileSync(drafts, "utf8").toLowerCase();
    expect(text).toContain("counsel");
    expect(/review/.test(text)).toBe(true);
  });
});
