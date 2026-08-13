/**
 * WAVE 36 · ROW 1 + ROW 2 — falsification harness for the cap-table sink family.
 *
 * ── WHAT WENT WRONG, AND WHY THIS FILE EXISTS ───────────────────────────────
 * ROW 1. Wave 35 introduced `decideCapTableSinkAccess` to add an SPV exclusion.
 *        It ALSO shipped, undocumented, a second disjunct:
 *            capTablePositions.some(...)  ||  invitedRounds.some(...)
 *        The pre-Wave-35 predicate at all four sites was `capTablePositions`
 *        alone. The effect was that a person merely INVITED to a round — holding
 *        nothing — read the full cap-table ledger of an operating company. Two
 *        independent reviewers proved it. **A fix can WIDEN a predicate.**
 *        Wave 36 removed the disjunct. The ONLY intended semantic change this
 *        helper makes relative to pre-Wave-35 behaviour is the SPV exclusion.
 *
 * ROW 2. The SEVENTH sink of the same class: `GET /api/companies/:id/cap-table/pdf`
 *        was guarded by `requireCanAccessCompany` (company VISIBILITY), not by
 *        the sink helper. An SPV LP received the other LP's $7,500,000 position,
 *        the blended $7,750,000 total, `Holders: 2`, and the other LP's user id.
 *        Five prior sweeps missed it **because PDF content streams are
 *        Flate-compressed**: a plain-text search over the response bytes finds
 *        nothing. This harness INFLATES every `stream…endstream` and decodes the
 *        hex `<...>` string operands before searching, and proves the extractor
 *        works by reading a PDF the same server produced (non-vacuity).
 *
 * ── METHOD ──────────────────────────────────────────────────────────────────
 * No mocks of `userContext` or `authMiddleware` — mocking userContext is exactly
 * how an earlier probe silently authenticated as the demo persona. Identities are
 * REAL rows in `user_credentials` + `auth_users`, resolved by the shipped
 * `getUserContextForId` through the real `requireAuth`, over the full
 * `registerRoutes` stack on real HTTP. The invitee is minted through the
 * production `registerPersona()` redeem path, not synthesised. Static imports.
 * The test establishes every precondition itself and reads no `process.env`.
 *
 * ── FOUR POLES, ALL ASSERTED ────────────────────────────────────────────────
 *   P1 genuine cap-table member of a real operating company  -> 200, sees co-holder
 *   P2 SPV LP asking about their own vehicle                 -> own row only
 *   P3 round invitee holding nothing                         -> 404 refuse
 *   P4 authenticated stranger with no relationship           -> 404 refuse
 * Each pole is asserted on BOTH the JSON sinks and the PDF sink.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

import { decideCapTableSinkAccess, scopeCapTableRows } from "../lib/capTableSinkScope";

const HOLDER_A = "u_w36_lp_alpha";      // holds 250,000 in the vehicle AND the real co
const HOLDER_B = "u_w36_lp_beta";       // holds 7,500,000 in the vehicle AND the real co
const STRANGER = "u_w36_stranger";      // authenticated, holds nothing anywhere
const SPV_ID = "spv_w36_vehicle";
const REAL_CO = "co_w36_operating";
const OTHER_CO = "co_w36_unrelated";    // exists in the ledger; HOLDER_A has no tie to it
const ROUND_REAL = "rnd_w36_real";
let INVITEE = "";                       // minted via the production redeem path

let app: Express;
let server: http.Server;
let port: number;

function callBin(p: string, userId: string): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "GET", headers: { "x-user-id": userId } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, raw: Buffer.concat(chunks).toString("binary") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Inflate a PDF's compressed content streams. A text search over the RAW bytes
 * of a Flate-compressed PDF is a check that passes while checking nothing —
 * that is precisely how five sweeps missed this sink.
 */
function pdfText(raw: string): string {
  const buf = Buffer.from(raw, "binary");
  let out = "";
  let idx = 0;
  for (;;) {
    const s = buf.indexOf("stream", idx);
    if (s === -1) break;
    let a = s + 6;
    if (buf[a] === 0x0d) a++;
    if (buf[a] === 0x0a) a++;
    const e = buf.indexOf("endstream", a);
    if (e === -1) break;
    const chunk = buf.subarray(a, e);
    try {
      out += zlib.inflateSync(chunk).toString("latin1");
    } catch {
      out += chunk.toString("latin1");
    }
    idx = e + 9;
  }
  const rendered = out.replace(/<([0-9a-fA-F]+)>/g, (_m, h: string) =>
    Buffer.from(h.length % 2 ? h + "0" : h, "hex").toString("latin1"),
  );
  // The concatenated raw tail keeps uncompressed producers detectable too.
  return rendered + "\n" + buf.toString("latin1");
}

/** PDF text layout inserts kerning integers between glyph runs; strip them. */
function pdfDigits(txt: string): string {
  return txt.replace(/[^\x20-\x7e]/g, " ");
}

beforeAll(async () => {
  const { rawDb } = await import("../db/connection");
  const db: any = rawDb();
  const now = "2026-01-01T00:00:00Z";

  const insCred = db.prepare(
    `INSERT OR REPLACE INTO user_credentials (user_id,email,name,password_hash,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,NULL)`,
  );
  const insAuth = db.prepare(
    `INSERT OR REPLACE INTO auth_users (id,email,name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)`,
  );
  for (const [id, email, name] of [
    [HOLDER_A, "alpha@w36.test", "Alpha W36-LP"],
    [HOLDER_B, "beta@w36.test", "Beta W36-Confidential"],
    [STRANGER, "stranger@w36.test", "Stranger W36"],
  ] as const) {
    insCred.run(id, email, name, "x", now, now);
    insAuth.run(id, email, name, "x", "investor", now);
  }

  // The vehicle. `own_only` is the schema default; asserted below, not assumed.
  db.prepare(
    `INSERT OR REPLACE INTO spv (id,sponsor_partner_id,name,jurisdiction,carry_basis,
       lp_visibility,created_at,updated_at,curr_hash)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(SPV_ID, "p_w36", "W36 Vehicle I LP", "DE", "whole_fund", "own_only", now, now, "x");
  // Precondition ASSERTED, not assumed: the operating companies are NOT vehicles.
  db.prepare(`DELETE FROM spv WHERE id IN (?,?)`).run(REAL_CO, OTHER_CO);

  const ins = db.prepare(
    `INSERT OR REPLACE INTO captable_commits
      (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,
       state,prev_hash,hash,reconcile_match,compliance_hold,holder_first_name,holder_last_name,
       instrument_class,principal_amount,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,NULL)`,
  );
  // SPV: two LPs who are strangers to each other.
  ins.run("cc_w36_1", `tenant_co_${SPV_ID}`, 96001, now, "inv_w36_1", "rnd_w36_spv",
    SPV_ID, HOLDER_A, "250000", "USD", "100", "committed", "p", "wh1", "Alpha", "W36-LP", "unpriced", "250000");
  ins.run("cc_w36_2", `tenant_co_${SPV_ID}`, 96002, now, "inv_w36_2", "rnd_w36_spv",
    SPV_ID, HOLDER_B, "7500000", "USD", "3000", "committed", "wh1", "wh2", "Beta", "W36-Confidential", "unpriced", "7500000");
  // REAL operating company, same two holders — the NON-VACUITY control.
  ins.run("cc_w36_3", `tenant_co_${REAL_CO}`, 96003, now, "inv_w36_3", ROUND_REAL,
    REAL_CO, HOLDER_A, "250000", "USD", "100", "committed", "wh2", "wh3", "Alpha", "W36-LP", "unpriced", "250000");
  ins.run("cc_w36_4", `tenant_co_${REAL_CO}`, 96004, now, "inv_w36_4", ROUND_REAL,
    REAL_CO, HOLDER_B, "7500000", "USD", "3000", "committed", "wh3", "wh4", "Beta", "W36-Confidential", "unpriced", "7500000");
  // A company that exists in the ledger but nobody under test is tied to.
  ins.run("cc_w36_5", `tenant_co_${OTHER_CO}`, 96005, now, "inv_w36_5", "rnd_w36_other",
    OTHER_CO, HOLDER_B, "9900000", "USD", "1", "committed", "wh4", "wh5", "Beta", "W36-Confidential", "unpriced", "9900000");

  // POLE 3's identity, through the SHIPPING redeem path.
  const { registerPersona } = await import("../lib/userContext");
  INVITEE = registerPersona({
    email: "invitee@w36.test",
    name: "Invitee W36",
    password: "Pass!2345678",
    invitationId: "inv_w36_prospect",
    roundId: ROUND_REAL,
    companyId: REAL_CO,
  });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  await new Promise<void>((r) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      r();
    });
  });
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

/* ══════════════════════════════════════════════════════════════════════════
 * PRECONDITIONS — established and asserted by this file, never assumed.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · preconditions", () => {
  it("the vehicle is SPV-backed with own_only visibility; the operating companies are not vehicles", async () => {
    const { isSpvBackedCompany } = await import("../lib/spvBackedCompanies");
    const { spvLpVisibility } = await import("../lib/capTableSinkScope");
    expect(isSpvBackedCompany(SPV_ID)).toBe(true);
    expect(spvLpVisibility(SPV_ID)).toBe("own_only");
    expect(isSpvBackedCompany(REAL_CO)).toBe(false);
    expect(isSpvBackedCompany(OTHER_CO)).toBe(false);
  });

  it("the invitee genuinely holds NOTHING and is genuinely invited", async () => {
    const { getUserContextForId } = await import("../lib/userContext");
    const ctx: any = getUserContextForId(INVITEE);
    const positions = (ctx.investor?.capTablePositions ?? []).map((p: any) => p.companyId);
    const invited = (ctx.investor?.invitedRounds ?? []).map((i: any) => i.companyId);
    console.log("W36 INVITEE CTX:", JSON.stringify({ userId: ctx.userId, positions, invited }));
    expect(ctx.isAuthed).toBe(true);
    expect(ctx.isAdmin).toBeFalsy();
    expect(positions).not.toContain(REAL_CO);   // holds nothing
    expect(invited).toContain(REAL_CO);         // but IS invited — the whole point
  });

  it("the stranger is authenticated but holds nothing and is invited to nothing", async () => {
    const { getUserContextForId } = await import("../lib/userContext");
    const ctx: any = getUserContextForId(STRANGER);
    expect(ctx.isAuthed).toBe(true);
    expect(ctx.isAdmin).toBeFalsy();
    expect((ctx.investor?.capTablePositions ?? []).map((p: any) => p.companyId)).not.toContain(OTHER_CO);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 1 — the predicate. Diffed against pre-Wave-35 behaviour, pole by pole.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 1 — decideCapTableSinkAccess matches the pre-Wave-35 predicate except for the SPV exclusion", () => {
  /** The exact pre-Wave-35 predicate, as it read at all four sites. */
  const preWave35Authorised = (ctx: any, cid: string): boolean =>
    !!ctx?.isAdmin ||
    !!ctx?.founder?.companies?.some((c: any) => c?.companyId === cid) ||
    !!ctx?.investor?.capTablePositions?.some((p: any) => p?.companyId === cid);

  it("D1 — for EVERY identity × company pair, `refuse` ⇔ the pre-Wave-35 predicate said no", async () => {
    const { getUserContextForId } = await import("../lib/userContext");
    const rows: string[] = [];
    let checked = 0;
    for (const uid of [HOLDER_A, HOLDER_B, STRANGER, INVITEE]) {
      const ctx: any = getUserContextForId(uid);
      for (const cid of [SPV_ID, REAL_CO, OTHER_CO, "co_w36_ghost_never_existed"]) {
        const old = preWave35Authorised(ctx, cid);
        const now = decideCapTableSinkAccess(ctx, cid);
        rows.push(`${uid} × ${cid}: pre-w35=${old} now=${now.outcome}/${now.reason}`);
        // The ONLY intended change is the SPV exclusion, which turns an `allow`
        // into `scope_to_self`. It never turns a `refuse` into access, and never
        // turns an `allow` into a `refuse`.
        expect(now.outcome === "refuse").toBe(!old);
        if (old && cid === SPV_ID) expect(now.outcome).toBe("scope_to_self");
        if (old && cid !== SPV_ID) expect(now.outcome).toBe("allow");
        checked++;
      }
    }
    console.log("W36 PREDICATE DIFF:\n" + rows.join("\n"));
    expect(checked).toBe(16); // non-vacuity: the loop actually ran
  });

  it("D2 — an invitation ALONE is refused (the Wave 35 widening, removed)", async () => {
    const { getUserContextForId } = await import("../lib/userContext");
    const ctx: any = getUserContextForId(INVITEE);
    const d = decideCapTableSinkAccess(ctx, REAL_CO);
    console.log("W36 INVITEE DECISION:", JSON.stringify(d));
    expect(d.outcome).toBe("refuse");
    expect(d.reason).toBe("no_relationship");
  });

  it("D3 — the source no longer consults invitedRounds in the predicate", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../lib/capTableSinkScope.ts"),
      "utf8",
    );
    // Self-check: the file IS readable and IS the right file.
    expect(src).toContain("export function decideCapTableSinkAccess");
    const body = src.slice(src.indexOf("export function decideCapTableSinkAccess"));
    const code = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toMatch(/invitedRounds/);
  });

  it("D4 — a genuine holder is STILL allowed (no over-fix)", async () => {
    const { getUserContextForId } = await import("../lib/userContext");
    expect(decideCapTableSinkAccess(getUserContextForId(HOLDER_A) as any, REAL_CO).outcome).toBe("allow");
    expect(decideCapTableSinkAccess(getUserContextForId(HOLDER_B) as any, REAL_CO).outcome).toBe("allow");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 1 — the JSON sinks, over real HTTP, all four poles.
 * ═════════════════════════════════════════════════════════════════════════ */
const JSON_SINKS = ["securities", "captable/interim", "captable/snapshots"] as const;

describe("WAVE 36 · ROW 1 — the three JSON sinks, all four poles", () => {
  it("P1 — a genuine cap-table member of a REAL company gets 200 and SEES the co-holder", async () => {
    for (const sink of JSON_SINKS) {
      const r = await callBin(`/api/companies/${REAL_CO}/${sink}`, HOLDER_A);
      console.log(`W36 P1 ${sink}:`, r.status, r.raw.slice(0, 240));
      expect(r.status).toBe(200);
    }
    // Non-vacuity control: a blanket "return nothing" fix fails HERE.
    const sec = await callBin(`/api/companies/${REAL_CO}/securities`, HOLDER_A);
    expect(sec.raw).toContain("7500000");
  });

  it("P2 — an SPV LP gets their OWN row and NOT the co-LP's", async () => {
    for (const sink of JSON_SINKS) {
      const r = await callBin(`/api/companies/${SPV_ID}/${sink}`, HOLDER_A);
      console.log(`W36 P2 ${sink}:`, r.status, r.raw.slice(0, 240));
      expect(r.raw).not.toContain("7500000");
      expect(r.raw).not.toContain(HOLDER_B);
    }
    const sec = await callBin(`/api/companies/${SPV_ID}/securities`, HOLDER_A);
    expect(sec.status).toBe(200);
    expect(sec.raw).toContain("250000"); // own row survives
  });

  it("P3 — a round INVITEE holding nothing is REFUSED (404) by every JSON sink", async () => {
    for (const sink of JSON_SINKS) {
      const r = await callBin(`/api/companies/${REAL_CO}/${sink}`, INVITEE);
      console.log(`W36 P3 ${sink}:`, r.status, r.raw.slice(0, 200));
      expect(r.status).toBe(404);
      expect(r.raw).not.toContain("7500000");
      expect(r.raw).not.toContain(HOLDER_B);
    }
  });

  it("P4 — an authenticated NON-MEMBER is REFUSED (404), identically to a ghost id", async () => {
    for (const sink of JSON_SINKS) {
      const real = await callBin(`/api/companies/${OTHER_CO}/${sink}`, HOLDER_A);
      const ghost = await callBin(`/api/companies/co_w36_ghost_never_existed/${sink}`, HOLDER_A);
      console.log(`W36 P4 ${sink}: real=${real.status} ghost=${ghost.status}`);
      expect(real.status).toBe(404);
      // F9 non-enumeration: an existing id must be indistinguishable from a ghost.
      expect(real.status).toBe(ghost.status);
      expect(real.raw).toBe(ghost.raw);
      expect(real.raw).not.toContain("9900000");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 2 — the SEVENTH sink: the PDF. Streams inflated before searching.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 2 — the cap-table PDF sink", () => {
  it("PDF-0 SELF-CHECK — the inflater can read a PDF this server produced (else every clean result is vacuous)", async () => {
    const r = await callBin(`/api/companies/${REAL_CO}/cap-table/pdf`, HOLDER_A);
    expect(r.status).toBe(200);
    const txt = pdfDigits(pdfText(r.raw));
    console.log("W36 PDF SELF-CHECK bytes:", r.raw.length, "decoded:", txt.length);
    console.log("W36 PDF SELF-CHECK sample:", txt.slice(0, 400));
    // The extractor MUST be able to see a real number in a real PDF.
    expect(txt).toMatch(/7,?500,?000/);
    expect(txt.length).toBeGreaterThan(500);
  });

  it("PDF-P1 — a genuine cap-table member of a REAL company still gets the full PDF", async () => {
    const r = await callBin(`/api/companies/${REAL_CO}/cap-table/pdf`, HOLDER_A);
    const txt = pdfDigits(pdfText(r.raw));
    expect(r.status).toBe(200);
    expect(txt).toMatch(/7,?500,?000/);       // co-holder position present
    expect(txt).toMatch(/7,?750,?000/);       // blended total present — legitimately
    expect(txt).toMatch(/Holder/);
  });

  it("PDF-P2 — an SPV LP sees ONLY their own row: no co-LP position, no blended total, no holder count of 2, no co-LP id", async () => {
    const r = await callBin(`/api/companies/${SPV_ID}/cap-table/pdf`, HOLDER_A);
    const txt = pdfDigits(pdfText(r.raw));
    console.log("W36 PDF SPV status:", r.status, "decoded:", txt.slice(0, 900));
    expect(r.status).toBe(200);
    expect(/7,?500,?000/.test(txt)).toBe(false);   // the other LP's position
    expect(/7,?750,?000/.test(txt)).toBe(false);   // the blended vehicle total
    expect(txt.includes(HOLDER_B)).toBe(false);    // the other LP's user id
    expect(/Confidential/.test(txt)).toBe(false);  // the other LP's rendered name
    // Own row and own totals survive — the scoping is not a blanket blank page.
    expect(/250,?000/.test(txt)).toBe(true);
    expect(txt.includes(HOLDER_A)).toBe(true);
  });

  it("PDF-P3 — a round INVITEE holding nothing is REFUSED (404), no PDF bytes at all", async () => {
    const r = await callBin(`/api/companies/${REAL_CO}/cap-table/pdf`, INVITEE);
    console.log("W36 PDF INVITEE:", r.status, r.raw.slice(0, 200));
    expect(r.status).toBe(404);
    const txt = pdfDigits(pdfText(r.raw));
    expect(/7,?500,?000|7500000/.test(txt)).toBe(false);
    expect(txt.includes(HOLDER_B)).toBe(false);
  });

  it("PDF-P4 — an authenticated NON-MEMBER is REFUSED (404) and learns nothing", async () => {
    const r = await callBin(`/api/companies/${OTHER_CO}/cap-table/pdf`, HOLDER_A);
    console.log("W36 PDF STRANGER:", r.status, r.raw.slice(0, 200));
    expect(r.status).toBe(404);
    expect(/9,?900,?000|9900000/.test(pdfDigits(pdfText(r.raw)))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ROW 2 — the standing sweep. Seven sinks across five sweeps: the eighth must
 * be structurally impossible to add by copying a route that looks authorised.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 2 — non-JSON export sweep over the SACRED ledger", () => {
  const SERVER_DIR = path.resolve(__dirname, "..");

  function walk(dir: string, acc: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p, acc);
      } else if (e.name.endsWith(".ts")) acc.push(p);
    }
    return acc;
  }

  /**
   * Split a module into HANDLER-SIZED units. File-level granularity is too
   * coarse and would force an allowlist: `track1Routes.ts` reads the ledger in
   * the founder-only waterfall handler and separately streams a term-sheet PDF
   * that contains no ledger rows; `adminPlatformStore.ts` reads the ledger for
   * an admin KPI COUNT and separately emits CSVs. Neither is a ledger-row
   * export. Unit granularity states that precisely instead of suppressing it.
   */
  function units(src: string): string[] {
    const marks: number[] = [0];
    // Boundaries: a top-level function declaration, a route registration, or a
    // handler-shaped arrow const. NOT every `const x = (` — that would cut a
    // handler in half and the sweep would stop seeing its own defect (the
    // self-check below is what caught exactly that while writing this).
    const re =
      /\n(?:\s*)(?:export\s+)?(?:async\s+)?function\s|\n\s*app\.(?:get|post|put|patch|delete|all)\s*\(|\n\s*(?:export\s+)?const\s+\w+\s*(?::[^=\n]+)?=\s*(?:async\s*)?\(\s*_?req[^)\n]*\)\s*(?::[^=\n]+)?=>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) marks.push(m.index);
    marks.push(src.length);
    const out: string[] = [];
    for (let i = 0; i < marks.length - 1; i++) out.push(src.slice(marks[i], marks[i + 1]));
    return out;
  }

  it("SWEEP — every HANDLER that reads the SACRED cap-table ledger AND writes a non-JSON body consults the sink helper", () => {
    const files = walk(SERVER_DIR);
    expect(files.length).toBeGreaterThan(50); // self-check: the walk found the tree

    // Readers of the SACRED commit ledger — the only rows that carry another
    // holder's identity and amount.
    const LEDGER_READ = /listMembersForCompany\s*\(|captableMembersForCompany\s*\(|getLedger\s*\(|listCommitsForUser\s*\(/;
    // Any non-JSON projection: PDF/CSV/XLSX/ICS/print view/email body.
    const NON_JSON_EMIT =
      /application\/pdf|text\/csv|spreadsheetml|text\/markdown|text\/calendar|Content-Disposition|content-disposition|streamCapTablePdf|streamTermSheetPdf|sendMail|emailBody|renderEmail/;

    const offenders: string[] = [];
    const inspected: string[] = [];
    let unitsScanned = 0;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (!LEDGER_READ.test(src)) continue;
      const rel = path.relative(SERVER_DIR, f);
      for (const u of units(src)) {
        unitsScanned++;
        if (!LEDGER_READ.test(u) || !NON_JSON_EMIT.test(u)) continue;
        const label = `${rel} :: ${(u.trim().split("\n")[0] ?? "").slice(0, 90)}`;
        inspected.push(label);
        if (!/decideCapTableSinkAccess/.test(u)) offenders.push(label);
      }
    }
    console.log("W36 SWEEP units scanned:", unitsScanned);
    console.log("W36 SWEEP ledger-reading non-JSON emitters:\n" + inspected.join("\n"));
    console.log("W36 SWEEP offenders:", JSON.stringify(offenders));
    // Self-check: the sweep MUST have inspected the handler that WAS the defect,
    // otherwise an empty offender list means nothing.
    expect(unitsScanned).toBeGreaterThan(100);
    expect(inspected.some((s) => s.startsWith("routes.ts") && s.includes("cap-table/pdf"))).toBe(true);
    expect(offenders).toEqual([]);
  });

  it("SWEEP — `streamCapTablePdf` has exactly one caller, and that caller scopes its rows", () => {
    const files = walk(SERVER_DIR);
    const callers = files.filter(
      (f) =>
        /streamCapTablePdf\s*\(res/.test(fs.readFileSync(f, "utf8")) &&
        !f.endsWith(path.join("lib", "pdfGenerators.ts")), // the definition site
    );
    const rel = callers.map((f) => path.relative(SERVER_DIR, f)).sort();
    console.log("W36 streamCapTablePdf callers:", JSON.stringify(rel));
    expect(rel).toEqual(["routes.ts"]);
    const src = fs.readFileSync(path.join(SERVER_DIR, "routes.ts"), "utf8");
    const block = src.slice(
      src.indexOf('app.get("/api/companies/:id/cap-table/pdf"'),
      src.indexOf("streamCapTablePdf(res, {"),
    );
    expect(block.length).toBeGreaterThan(200);  // self-check: the slice is real
    expect(block).toContain("decideCapTableSinkAccess");
    expect(block).toContain("scopeCapTableRows");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * scopeCapTableRows — the pure function, both poles.
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · scopeCapTableRows", () => {
  const rows = [
    { investorId: HOLDER_A, amount: "250000" },
    { investorId: HOLDER_B, amount: "7500000" },
  ];
  it("allow passes everything; scope_to_self keeps only self; refuse yields nothing", () => {
    expect(
      scopeCapTableRows({ outcome: "allow", scopedToUserId: null, reason: "admin" }, rows, (r) => r.investorId),
    ).toHaveLength(2);
    const scoped = scopeCapTableRows(
      { outcome: "scope_to_self", scopedToUserId: HOLDER_A, reason: "spv_lp_own_only" },
      rows,
      (r) => r.investorId,
    );
    expect(scoped.map((r) => r.investorId)).toEqual([HOLDER_A]);
    expect(
      scopeCapTableRows({ outcome: "refuse", scopedToUserId: null, reason: "no_relationship" }, rows, (r) => r.investorId),
    ).toEqual([]);
    // Fails CLOSED: scope_to_self with an empty self yields nothing, not everything.
    expect(
      scopeCapTableRows({ outcome: "scope_to_self", scopedToUserId: "", reason: "spv_lp_own_only" }, rows, (r) => r.investorId),
    ).toEqual([]);
  });
});
