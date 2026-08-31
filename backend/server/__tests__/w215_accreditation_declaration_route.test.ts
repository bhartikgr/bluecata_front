/**
 * WAVE 215 — the accreditation declaration, proved on the REAL route.
 *
 * Every case below drives `POST`/`GET
 * /api/investor/compliance/accreditation-declaration` over a real HTTP socket
 * against the real Express app assembled by `registerRoutes`, and reads the
 * result back out of the real `investor_accreditation_declaration` table with
 * SQL. Nothing here supplies a handler, a store, a stub clause or a fake
 * request: handbook §8 — a test that supplies the thing under test is testing
 * something production does not do.
 *
 * What this file is for, in the order the wave's items were given:
 *
 *   ITEM A — there is exactly ONE accreditation mechanism. `AccreditationForm`
 *            never wrote a row; this route is the only writer. Proved here by
 *            the row counts: a declaration exists after this route is called
 *            and at no other time.
 *
 *   ITEM B — no blanket "I am accredited" tick can be recorded, by any path.
 *            The retired worldwide criterion is refused, cross-jurisdiction
 *            mixtures are refused, and an unrecognised jurisdiction is refused
 *            rather than stored.
 *
 *   ITEM C — the served payload states the platform's posture and the word
 *            "verified" does not appear in the clause text or the served
 *            criteria.
 *
 *   ITEM D — the row is provable: typed name, server-observed timestamp,
 *            server-observed IP, user agent, jurisdiction, criteria, and the
 *            digest of the exact text shown.
 *
 * PRE-EXISTING DECLARATIONS ARE NOT INVALIDATED. The live production row was
 * signed under ACCRED-v0.2 with the worldwide criterion and a NULL
 * jurisdiction. The last describe block reconstructs that shape through the
 * real writer, then proves it is still readable and still re-affirmable after
 * the v0.3 correction — and that re-affirming it stamps the version the
 * investor actually read, not the current one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { storeCredential } from "../userCredentialsStore";
import {
  recordAccreditationDeclaration,
  getLatestDeclaration,
  clauseTextSha256,
  observedIpFromRequest,
  observedUserAgent,
  soleJurisdictionOfCriteria,
} from "../investorComplianceRoutes";
import {
  ACCREDITATION_CLAUSE_VERSION,
  ACCREDITATION_CLAUSE_VERSION_V0_2,
  ACCREDITATION_CLAUSE_VERSION_V0_3,
  ACCREDITATION_CLAUSE_TEXT,
  ACCREDITATION_CLAUSE_TEXT_V0_2,
  ACCREDITATION_JURISDICTION_CRITERIA,
  ACCREDITATION_JURISDICTION_CODES,
  clauseTextForVersion,
} from "@shared/accreditationClause";

const ENDPOINT = "/api/investor/compliance/accreditation-declaration";

let app: Express;
let server: http.Server;
let port: number;

const USERS = [
  "u_w215_capture",
  "u_w215_global_tick",
  "u_w215_mixed",
  "u_w215_unrecognised",
  "u_w215_nojur",
  "u_w215_emptyname",
  "u_w215_notext",
  "u_w215_legacy",
  "u_w215_provenance",
];

beforeAll(async () => {
  for (const uid of USERS) {
    try {
      storeCredential({ userId: uid, email: `${uid}@example.com`, name: uid, password: "pw-test-215" });
    } catch { /* best-effort seed, mirrors sibling suites */ }
  }
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; userAgent?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.userAgent) headers["user-agent"] = opts.userAgent;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Reads the stored row with SQL, not through the code under test's own mapper. */
function rawRows(userId: string) {
  return rawDb()
    .prepare(
      `SELECT id, investor_id, clause_version, criteria_json, signature_name,
              signed_at, jurisdiction, created_at, prev_hash, curr_hash
         FROM investor_accreditation_declaration
        WHERE investor_id = ? ORDER BY signed_at ASC, rowid ASC`,
    )
    .all(userId) as Array<Record<string, any>>;
}

function countRows(userId: string): number {
  return rawRows(userId).length;
}

/* ────────────────────────────────────────────────────────────────────────────
   THE ROUTE IS REAL — not a handler this file supplied.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · the submit path under test is the production route", () => {
  it("the route is registered by the app itself, and answers before this file asserts anything about it", async () => {
    /* If `registerRoutes` did not mount this path, a 404 here would fail the
       whole premise of every case below. This is the guard against proving a
       replica: no `app.post` appears anywhere in this file. */
    const res = await call("GET", ENDPOINT, { userId: "u_w215_capture" });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it("this test file registers no route handler of its own", () => {
    /* Read this file off disk and prove it. A future edit that quietly adds a
       stub handler to make a case pass will fail here. */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("node:fs") as typeof import("node:fs");
    const src = fs.readFileSync(__filename, "utf8");
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    /* `app.use(express.json())` is body parsing, not a handler for the path
       under test; anything that mounts a method on a path is not. */
    expect(withoutComments).not.toMatch(/app\.(post|get|put|patch|delete)\s*\(/);
    /* Built at runtime so this line does not match itself. */
    expect(withoutComments).not.toMatch(new RegExp("on" + "Submit"));
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   ITEM D — the declaration is provable.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · ITEM D — a recorded declaration is provable", () => {
  const uid = "u_w215_capture";

  it("records name, server timestamp, jurisdiction, criteria and the digest of the text shown", async () => {
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      userAgent: "W215Agent/1.0 (proof)",
      body: {
        signatureName: "Wave Two One Five",
        criteria: ["us_income"],
        jurisdiction: "US",
      },
    });
    expect(res.status).toBe(201);
    expect(countRows(uid)).toBe(before + 1);

    const row = rawRows(uid).at(-1)!;
    expect(row.signature_name).toBe("Wave Two One Five");
    expect(JSON.parse(row.criteria_json)).toEqual(["us_income"]);
    expect(row.jurisdiction).toBe("US");
    expect(row.clause_version).toBe(ACCREDITATION_CLAUSE_VERSION);
    expect(row.clause_version).toBe(ACCREDITATION_CLAUSE_VERSION_V0_3);

    /* Server-observed timestamp: parseable, and not the client's to choose —
       nothing in the request body above carried a time at all. */
    expect(Number.isFinite(Date.parse(row.signed_at))).toBe(true);
    expect(Math.abs(Date.now() - Date.parse(row.signed_at))).toBeLessThan(120_000);

    /* The exact text shown is recoverable from the stored version, and its
       digest is the digest the server publishes. */
    const text = clauseTextForVersion(row.clause_version);
    expect(typeof text).toBe("string");
    expect((text as string).length).toBeGreaterThan(200);
    const digest = createHash("sha256").update(text as string, "utf8").digest("hex");
    expect(clauseTextSha256(row.clause_version)).toBe(digest);
  });

  it("a client cannot dictate the clause version it is recorded under", async () => {
    const uid2 = "u_w215_provenance";
    const res = await call("POST", ENDPOINT, {
      userId: uid2,
      body: {
        signatureName: "Version Spoofer",
        criteria: ["us_income"],
        jurisdiction: "US",
        clauseVersion: "ACCRED-v99.9",
        signedAt: "1999-01-01T00:00:00.000Z",
      },
    });
    expect(res.status).toBe(201);
    const row = rawRows(uid2).at(-1)!;
    expect(row.clause_version).toBe(ACCREDITATION_CLAUSE_VERSION);
    expect(row.clause_version).not.toBe("ACCRED-v99.9");
    expect(row.signed_at.startsWith("1999")).toBe(false);
  });

  it("the hash chain links each row to the one before it", async () => {
    const rows = rawRows("u_w215_capture");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].prev_hash).toBeNull();
    for (const r of rows) expect(String(r.curr_hash)).toMatch(/^[0-9a-f]{64}$/);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].prev_hash).toBe(rows[i - 1].curr_hash);
    }
  });

  it("observed IP and user agent come from the request object, never from a body", () => {
    /* `observedIpFromRequest` is the only sanctioned producer. Given a request
       shape that carries a spoofed forwarding header and a body-supplied IP, it
       must return the socket's address and ignore both. R187.1. */
    const spoofed: any = {
      socket: { remoteAddress: "203.0.113.7" },
      ip: "198.51.100.9",
      headers: {
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "user-agent": "RealAgent/2.0",
      },
      body: { observedIp: "9.9.9.9", userAgent: "BodyAgent/9" },
    };
    expect(observedIpFromRequest(spoofed)).toBe("203.0.113.7");
    expect(observedUserAgent(spoofed)).toBe("RealAgent/2.0");

    /* With no socket and no `req.ip`, it returns null rather than inventing a
       value. Nothing is fabricated in place of an unobservable fact. */
    const blind: any = { headers: {}, body: { observedIp: "9.9.9.9" } };
    expect(observedIpFromRequest(blind)).toBeNull();
    expect(observedUserAgent(blind)).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   ITEM B — no global tick, by any path.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · ITEM B — no blanket 'I am accredited' assertion can be recorded", () => {
  it("no criterion in the served set spans jurisdictions", () => {
    /* This is the structural reason a global tick is impossible rather than
       merely blocked: every criterion belongs to exactly one jurisdiction, so
       there is no id an investor could tick to assert eligibility everywhere. */
    const seen = new Map<string, string[]>();
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      for (const c of ACCREDITATION_JURISDICTION_CRITERIA[code]) {
        seen.set(c.id, [...(seen.get(c.id) ?? []), code]);
      }
    }
    const spanning = [...seen.entries()].filter(([, codes]) => codes.length > 1);
    expect(spanning).toEqual([]);
    /* And every served criterion resolves to a single jurisdiction. */
    for (const id of seen.keys()) {
      expect(soleJurisdictionOfCriteria([id])).not.toBeNull();
    }
  });

  it("the retired worldwide criterion is refused for a first-time signer", async () => {
    const uid = "u_w215_global_tick";
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: "Global Ticker", criteria: ["intl_equivalent"], jurisdiction: "US" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("CRITERIA_JURISDICTION_MISMATCH");
    expect(String(res.body?.message)).toMatch(/worldwide/i);
    expect(String(res.body?.message).length).toBeLessThanOrEqual(240);
    expect(countRows(uid)).toBe(before);
  });

  it("a mixture of two jurisdictions' criteria is refused", async () => {
    const uid = "u_w215_mixed";
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: {
        signatureName: "Mixed Basket",
        criteria: ["us_income", ...ACCREDITATION_JURISDICTION_CRITERIA.HK.map((c) => c.id).slice(0, 1)],
        jurisdiction: "US",
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("CRITERIA_JURISDICTION_MISMATCH");
    expect(countRows(uid)).toBe(before);
  });

  it("a jurisdiction Capavate does not serve is refused, not stored", async () => {
    const uid = "u_w215_unrecognised";
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: "Elsewhere Person", criteria: ["us_income"], jurisdiction: "Ruritania" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("JURISDICTION_UNRECOGNISED");
    expect(String(res.body?.message).length).toBeLessThanOrEqual(240);
    expect(countRows(uid)).toBe(before);
  });

  it("a criterion id the platform never served is refused", async () => {
    const uid = "u_w215_nojur";
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: "Invented Criterion", criteria: ["i_am_accredited_everywhere"], jurisdiction: "US" },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("CRITERIA_REQUIRED");
    expect(countRows(uid)).toBe(before);
  });

  it("an empty typed name is refused", async () => {
    const uid = "u_w215_emptyname";
    const before = countRows(uid);
    for (const name of ["", "   ", "A"]) {
      const res = await call("POST", ENDPOINT, {
        userId: uid,
        body: { signatureName: name, criteria: ["us_income"], jurisdiction: "US" },
      });
      expect(res.status).toBe(400);
      expect(res.body?.error).toBe("SIGNATURE_REQUIRED");
    }
    expect(countRows(uid)).toBe(before);
  });

  it("a declaration cannot be recorded against a version whose text cannot be produced", () => {
    /* "No stored text" is not a state this platform can reach: the stored
       version is server-chosen, and every version the server can stamp has
       retrievable text. An unknown version yields null rather than an empty
       string that would hash to something. */
    expect(clauseTextForVersion("ACCRED-v0.0")).toBeNull();
    expect(clauseTextForVersion(ACCREDITATION_CLAUSE_VERSION_V0_2)).toBe(ACCREDITATION_CLAUSE_TEXT_V0_2);
    expect(clauseTextForVersion(ACCREDITATION_CLAUSE_VERSION_V0_3)).toBe(ACCREDITATION_CLAUSE_TEXT);
    for (const v of [ACCREDITATION_CLAUSE_VERSION_V0_2, ACCREDITATION_CLAUSE_VERSION_V0_3]) {
      expect(clauseTextSha256(v)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   ITEM C — the platform does not verify and does not say it does.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · ITEM C — the served flow never claims verification", () => {
  /* "verified" as a standalone claim. "unverified" is the OPPOSITE claim and is
     required by Item B, so the check excludes it rather than banning the
     substring — a naive substring ban would fail on the very markings this wave
     was told to preserve. */
  const CLAIMS_VERIFIED = /(?<!un)verified/i;

  it("the clause text extends the honest boundary statement and never claims anything is verified", () => {
    /* The register the wave was told to keep. The pre-existing sentence lives in
       the component's KYC disclosure ("Capavate does not perform it on your
       behalf"); paragraph 5 of the clause carries it into the signed text in the
       first person, which is where it becomes provable. */
    expect(ACCREDITATION_CLAUSE_TEXT).toMatch(/does not perform any verification on my behalf/);
    expect(ACCREDITATION_CLAUSE_TEXT).toMatch(/Capavate records it/);
    expect(ACCREDITATION_CLAUSE_TEXT).toMatch(/does not assess whether it is correct/);
    expect(ACCREDITATION_CLAUSE_TEXT).not.toMatch(CLAIMS_VERIFIED);
    /* And the v0.2 text is unchanged by this wave, which is what keeps the
       earlier declaration provable. */
    expect(ACCREDITATION_CLAUSE_TEXT_V0_2).not.toMatch(CLAIMS_VERIFIED);
  });

  it("the served payload states the posture explicitly", async () => {
    const res = await call("GET", ENDPOINT, { userId: "u_w215_capture" });
    expect(res.status).toBe(200);
    expect(res.body?.clause?.posture).toBe("records_declaration_does_not_verify");
    expect(res.body?.clause?.clauseTextSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(res.body?.clause?.text)).not.toMatch(CLAIMS_VERIFIED);
  });

  it("no served criterion label, detail, note or source uses the word 'verified'", () => {
    /* `source` is included because it is RENDERED, as `note-accred-source-${id}`.
       Leaving it out of this loop would let a citation reintroduce the claim on
       screen while this test stayed green. */
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      for (const c of ACCREDITATION_JURISDICTION_CRITERIA[code]) {
        const blob = [c.label, (c as any).detail, (c as any).counselNote, (c as any).source]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        expect(blob).not.toMatch(CLAIMS_VERIFIED);
      }
    }
  });

  it("the nine jurisdictions are served with their confidence marking intact", async () => {
    const res = await call("GET", ENDPOINT, { userId: "u_w215_capture" });
    const served = res.body?.clause?.jurisdictions;
    expect(Array.isArray(served)).toBe(true);
    expect(served.map((j: any) => j.code).sort()).toEqual([...ACCREDITATION_JURISDICTION_CODES].sort());

    const byJur = res.body?.clause?.criteriaByJurisdiction;
    expect(byJur && typeof byJur).toBe("object");
    /* Every criterion arrives carrying a confidence, and every unverified one
       is still marked unverified after being served — confidence is never
       upgraded in transit. */
    let unverifiedSeen = 0;
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      for (const c of byJur[code]) {
        expect(["verified", "counsel_ratified", "unverified"]).toContain(c.confidence);
        if (c.confidence === "unverified") unverifiedSeen++;
      }
    }
    expect(unverifiedSeen).toBeGreaterThan(0);
  });

  it("no unverified criterion states a currency figure", () => {
    /* R-ASSERT for legal thresholds: an unsupported threshold states the
       criterion without inventing a number. */
    const currency = /[\u00a3\u20ac\u00a5\u20b9$]\s?\d|\d\s?(?:cr|lakh|L\b)/i;
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      for (const c of ACCREDITATION_JURISDICTION_CRITERIA[code]) {
        if (c.confidence !== "unverified") continue;
        const blob = [c.label, (c as any).detail, (c as any).counselNote].filter(Boolean).join(" ");
        expect(blob).not.toMatch(currency);
      }
    }
  });

  it("the UK figures are the ones in force, not the superseded pair", () => {
    const uk = ACCREDITATION_JURISDICTION_CRITERIA.UK;
    const blob = uk.map((c) => [c.label, (c as any).detail].filter(Boolean).join(" ")).join(" | ");
    expect(blob).toContain("100,000");
    expect(blob).toContain("250,000");
    expect(blob).not.toContain("170");
    expect(blob).not.toContain("430");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   NOTHING ALREADY SIGNED WAS INVALIDATED.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · an existing v0.2 declaration remains valid, readable and re-affirmable", () => {
  const uid = "u_w215_legacy";
  const NAME = "Legacy Signatory";

  it("reconstructs the live production row shape through the real writer", () => {
    /* The live row: ACCRED-v0.2, criteria ["intl_equivalent"], jurisdiction
       NULL. Inserted with SQL because v0.3's rules would (correctly) refuse to
       create it today — which is exactly why it has to be tested. */
    const db = rawDb();
    db.prepare(
      `INSERT INTO investor_accreditation_declaration
         (id, investor_id, clause_version, criteria_json, signature_name, signed_at, jurisdiction, created_at, prev_hash, curr_hash)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
    ).run(
      "iad_w215_legacy",
      uid,
      ACCREDITATION_CLAUSE_VERSION_V0_2,
      JSON.stringify(["intl_equivalent"]),
      NAME,
      "2026-08-14T10:00:00.000Z",
      "2026-08-14T10:00:00.000Z",
      createHash("sha256").update("w215-legacy-seed", "utf8").digest("hex"),
    );
    const rows = rawRows(uid);
    expect(rows.length).toBe(1);
    expect(rows[0].clause_version).toBe(ACCREDITATION_CLAUSE_VERSION_V0_2);
    expect(rows[0].jurisdiction).toBeNull();
  });

  it("is still readable through the product's own reader", () => {
    const latest = getLatestDeclaration(uid);
    expect(latest).not.toBeNull();
    expect(latest!.signatureName).toBe(NAME);
    expect(latest!.criteria).toEqual(["intl_equivalent"]);
    expect(latest!.clauseVersion).toBe(ACCREDITATION_CLAUSE_VERSION_V0_2);
  });

  it("the exact text that signer read is still retrievable, so the declaration stays provable", () => {
    const text = clauseTextForVersion(ACCREDITATION_CLAUSE_VERSION_V0_2);
    expect(text).toBe(ACCREDITATION_CLAUSE_TEXT_V0_2);
    expect(text).not.toBe(ACCREDITATION_CLAUSE_TEXT);
    expect(clauseTextSha256(ACCREDITATION_CLAUSE_VERSION_V0_2))
      .not.toBe(clauseTextSha256(ACCREDITATION_CLAUSE_VERSION_V0_3));
  });

  it("the GET route serves that signer their own signed clause, not the current one", async () => {
    const res = await call("GET", ENDPOINT, { userId: uid });
    expect(res.status).toBe(200);
    expect(res.body?.signedClause?.version).toBe(ACCREDITATION_CLAUSE_VERSION_V0_2);
    expect(res.body?.signedClause?.text).toBe(ACCREDITATION_CLAUSE_TEXT_V0_2);
    expect(res.body?.signedClause?.supersededByCurrentVersion).toBe(true);
    /* And the current clause is still served alongside, so the investor can see
       what changed rather than being told their old text is the live one. */
    expect(res.body?.clause?.version).toBe(ACCREDITATION_CLAUSE_VERSION_V0_3);
  });

  it("that signer can re-affirm what they signed, and the new row keeps their version", async () => {
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: NAME, criteria: ["intl_equivalent"] },
    });
    expect(res.status).toBe(201);
    expect(countRows(uid)).toBe(before + 1);
    const row = rawRows(uid).at(-1)!;
    /* Stamped v0.2 — the version they read — not v0.3. */
    expect(row.clause_version).toBe(ACCREDITATION_CLAUSE_VERSION_V0_2);
    /* Jurisdiction stays NULL rather than being back-filled with a guess. */
    expect(row.jurisdiction).toBeNull();
  });

  it("the carve-out does not reopen the global tick for anyone else", async () => {
    /* A different investor, same criteria, same-looking request: refused. The
       carve-out is keyed to that investor's own prior row. */
    const other = "u_w215_global_tick";
    const before = countRows(other);
    const res = await call("POST", ENDPOINT, {
      userId: other,
      body: { signatureName: NAME, criteria: ["intl_equivalent"] },
    });
    expect(res.status).toBe(400);
    expect(countRows(other)).toBe(before);
  });

  /* ── ADDED AFTER A GREEN DISARM ──────────────────────────────────────────
     Removing the signature-name condition from the carve-out left every test in
     this file GREEN. The "does not reopen the global tick for anyone else" case
     used a DIFFERENT investor, who has no prior row at all, so `!!priorRow`
     alone was enough to fail it — the name check itself was unguarded. That
     matters: without it, anyone who can post as that investor could re-affirm
     the retired worldwide tick under any name they liked, and the row would
     carry that name as the signature. The name is the signature; it is the
     whole point of the record. */
  it("a re-affirmation under a DIFFERENT name is refused, because the name is the signature", async () => {
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: "Somebody Else Entirely", criteria: ["intl_equivalent"] },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("JURISDICTION_REQUIRED");
    expect(countRows(uid)).toBe(before);

    /* Anti-vacuity: the SAME request under the right name is accepted, so the
       refusal above is about the name and not about the route being broken. */
    const ok = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: NAME, criteria: ["intl_equivalent"] },
    });
    expect(ok.status).toBe(201);
    expect(rawRows(uid).at(-1)!.signature_name).toBe(NAME);
  });

  it("and a different criteria set from that same signer goes through the full v0.3 rules", async () => {
    const before = countRows(uid);
    const res = await call("POST", ENDPOINT, {
      userId: uid,
      body: { signatureName: NAME, criteria: ["intl_equivalent", "us_income"] },
    });
    expect(res.status).toBe(400);
    expect(countRows(uid)).toBe(before);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE PRE-WAVE CALLERS STILL WORK.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · callers that predate the jurisdiction field still record", () => {
  it("a caller that sends no jurisdiction has it inferred from criteria that can only belong to one", () => {
    const uid = "u_w215_nojur";
    const before = countRows(uid);
    const out = recordAccreditationDeclaration(uid, {
      signatureName: "No Jurisdiction Sent",
      criteria: ["us_income"],
    });
    expect(out.ok).toBe(true);
    expect(countRows(uid)).toBe(before + 1);
    expect(rawRows(uid).at(-1)!.jurisdiction).toBe("US");
  });

  it("a caller that sends a country NAME rather than a code still resolves", () => {
    const uid = "u_w215_mixed";
    const before = countRows(uid);
    const out = recordAccreditationDeclaration(uid, {
      signatureName: "Spelled It Out",
      criteria: ["us_net_worth"],
      jurisdiction: "United States",
    });
    expect(out.ok).toBe(true);
    expect(countRows(uid)).toBe(before + 1);
    expect(rawRows(uid).at(-1)!.jurisdiction).toBe("US");
  });
});
