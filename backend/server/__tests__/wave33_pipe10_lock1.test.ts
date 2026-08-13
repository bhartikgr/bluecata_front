/**
 * WAVE 33 · CP-PIPE-10 — falsification harness for LOCK 1.
 *
 * The item has two halves and the harness is deliberately asymmetric about
 * them, because the risks are different:
 *
 *   PART A — the co-write MECHANISM. A rule, so every case asserts BOTH POLES:
 *     each refusal is paired with an admission that differs in exactly one
 *     variable. A refusal test alone passes against a function that refuses
 *     everything.
 *
 *   PART B — the WORDING (OQ-5). Not a rule but an ABSENCE, and the danger is
 *     the opposite one: that something plausible gets rendered where the
 *     owner's text should be. Group (N) exists to make a fabricated lock
 *     wording fail a test. It asserts on what is EMITTED — the route body and
 *     the component's render expressions — not on what the source happens to
 *     consult.
 *
 * The routes are EXECUTED over supertest, never scanned. Wave 33 item 3 left
 * three mutants alive because its route assertions read source: a source scan
 * cannot tell a guard that is present from a guard that is present but
 * unreachable.
 *
 * Establishes its own preconditions. Never reads `process.env`. No conditional
 * skip anywhere.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";
import Database from "better-sqlite3";

const PARTNER_ME = "p_pipe10_me";
const ADMIN_USER = "u_pipe10_admin";

const CURRENT: { userId: string | null; isAdmin: boolean } = { userId: null, isAdmin: false };

vi.mock("../lib/requirePartnerAuth", () => ({
  requirePartnerAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { partnerContext?: unknown }).partnerContext = {
      partnerId: PARTNER_ME,
      userId: "u_pipe10_partner",
    };
    next();
  },
}));

vi.mock("../lib/userContext", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: CURRENT.userId !== null,
      isAdmin: CURRENT.isAdmin,
      userId: CURRENT.userId,
      roles: [],
    }),
  };
});

import { registerLockTextRoutes } from "../lockTextRoutes";
import {
  assertLock1CoWrite,
  describeLockNotice,
  LOCK1_TEXT_KEY,
  LOCK_NOT_SUPPLIED_COPY,
} from "../lib/lock1Provenance";
import {
  getLockNotice,
  getLock1Notice,
  listLockNotices,
  listLockRevisions,
  setLockText,
  LockTextError,
} from "../lockTextStore";
import { rawDb } from "../db/connection";
import { applyLockTextSchema } from "../lib/applyLockTextSchema";

let app: Express;

/** A key this file owns, so LOCK_1 itself can stay unsupplied for group (B). */
const TEST_KEY = `LOCK_PIPE10_${Date.now()}`;

function readCode(f: string): string {
  return fs
    .readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerLockTextRoutes(app);
  applyLockTextSchema(rawDb() as never);
});

/* ── (C) THE STRIPPER, PINNED FIRST ───────────────────────────────────────── */

describe("C — the source stripper, pinned before anything relies on it", () => {
  it("C0 readCode removes comments and keeps code", () => {
    // Every `not.toContain` below passes trivially against "".
    const src = readCode("server/lib/lock1Provenance.ts");
    expect(src).toContain("export function assertLock1CoWrite");
    expect(src).not.toContain("PARAPHRASING A LOCK IS NOT ACCEPTABLE");
    expect(src.length).toBeGreaterThan(1200);
  });
});

/* ── (S) THE SCHEMA, ASSERTED BEFORE ANY READ IS TRUSTED ──────────────────── */

describe("S — schema first: an absent table reads exactly like an unsupplied lock", () => {
  it("S1 platform_lock_text exists with the columns the store selects", () => {
    const cols = (rawDb()
      .prepare(`PRAGMA table_info(platform_lock_text)`)
      .all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("key");
    expect(cols).toContain("text");
    expect(cols).toContain("set_by");
    expect(cols).toContain("set_at");
  });

  it("S2 platform_lock_text_revision exists — the probe must test BOTH tables", () => {
    const cols = (rawDb()
      .prepare(`PRAGMA table_info(platform_lock_text_revision)`)
      .all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["id", "key", "text", "set_by", "recorded_at"]));
  });

  it("S3 a negative pole: a table this item does NOT create is absent", () => {
    // Without this, S1/S2 could pass against a PRAGMA that returns everything.
    const cols = rawDb().prepare(`PRAGMA table_info(platform_lock_text_nonexistent)`).all();
    expect(cols).toEqual([]);
  });

  it("S4 the LOCK_1 seed row exists and its text is NULL — by design", () => {
    const row = rawDb()
      .prepare(`SELECT key, text FROM platform_lock_text WHERE key = ?`)
      .get(LOCK1_TEXT_KEY) as { key: string; text: string | null } | undefined;
    expect(row).toBeTruthy();
    expect(row!.text).toBeNull();
  });
});

/* ── (A) PART A — THE CO-WRITE RULE, BOTH POLES ───────────────────────────── */

const ATTR_OK = {
  id: "attr_1",
  partnerId: "p_1",
  companyId: "co_1",
  revokedAt: null as string | null,
};

describe("A — LOCK 1 co-write: every refusal paired with the admission it differs from", () => {
  it("A1 a complete partner-sourced pair is admitted and both ids are returned", () => {
    const v = assertLock1CoWrite({
      sourceType: "partner",
      sourcedFromPartnerId: "p_1",
      companyId: "co_1",
      attribution: ATTR_OK,
    });
    expect(v.ok).toBe(true);
    expect(v.refusal).toBeNull();
    expect(v.coWrite).toEqual({
      sourcedFromPartnerId: "p_1",
      sourcedFromPartnerAttributionId: "attr_1",
    });
  });

  it("A2 a partner-sourced row naming no partner is refused", () => {
    for (const pid of [null, undefined, "", "   "]) {
      const v = assertLock1CoWrite({
        sourceType: "partner",
        sourcedFromPartnerId: pid,
        companyId: "co_1",
        attribution: ATTR_OK,
      });
      expect(v.ok).toBe(false);
      expect(v.refusal).toBe("LOCK1_PARTNER_ID_MISSING");
      expect(v.coWrite).toBeNull();
    }
  });

  it("A3 a partner with no attribution is refused — the pair is the point", () => {
    const v = assertLock1CoWrite({
      sourceType: "partner",
      sourcedFromPartnerId: "p_1",
      companyId: "co_1",
      attribution: null,
    });
    expect(v.refusal).toBe("LOCK1_ATTRIBUTION_MISSING");
    expect(v.coWrite).toBeNull();
  });

  it("A4 an attribution belonging to a DIFFERENT partner is refused", () => {
    const v = assertLock1CoWrite({
      sourceType: "partner",
      sourcedFromPartnerId: "p_1",
      companyId: "co_1",
      attribution: { ...ATTR_OK, partnerId: "p_2" },
    });
    expect(v.refusal).toBe("LOCK1_ATTRIBUTION_PARTNER_MISMATCH");
  });

  it("A5 an attribution for a DIFFERENT company is refused", () => {
    const v = assertLock1CoWrite({
      sourceType: "partner",
      sourcedFromPartnerId: "p_1",
      companyId: "co_1",
      attribution: { ...ATTR_OK, companyId: "co_2" },
    });
    expect(v.refusal).toBe("LOCK1_ATTRIBUTION_COMPANY_MISMATCH");
  });

  it("A6 a REVOKED attribution cannot source a new deal", () => {
    const v = assertLock1CoWrite({
      sourceType: "partner",
      sourcedFromPartnerId: "p_1",
      companyId: "co_1",
      attribution: { ...ATTR_OK, revokedAt: "2025-01-01T00:00:00.000Z" },
    });
    expect(v.refusal).toBe("LOCK1_ATTRIBUTION_REVOKED");
    expect(v.coWrite).toBeNull();
  });

  it("A7 a NON-partner-sourced circle is out of scope, and says so", () => {
    // The opposite pole of A3: demanding provenance here would block every
    // ordinary investor soft circle.
    const v = assertLock1CoWrite({
      sourceType: "investor",
      sourcedFromPartnerId: null,
      companyId: "co_1",
      attribution: null,
    });
    expect(v.ok).toBe(true);
    expect(v.refusal).toBeNull();
    expect(v.coWrite).toBeNull();
    expect(v.copy).toMatch(/not partner-sourced/i);
  });

  it("A8 every refusal carries distinct, non-empty copy", () => {
    const copies = [
      assertLock1CoWrite({ sourceType: "partner", sourcedFromPartnerId: "", companyId: "co_1", attribution: ATTR_OK }),
      assertLock1CoWrite({ sourceType: "partner", sourcedFromPartnerId: "p_1", companyId: "co_1", attribution: null }),
      assertLock1CoWrite({ sourceType: "partner", sourcedFromPartnerId: "p_1", companyId: "co_1", attribution: { ...ATTR_OK, partnerId: "p_2" } }),
      assertLock1CoWrite({ sourceType: "partner", sourcedFromPartnerId: "p_1", companyId: "co_1", attribution: { ...ATTR_OK, companyId: "co_2" } }),
      assertLock1CoWrite({ sourceType: "partner", sourcedFromPartnerId: "p_1", companyId: "co_1", attribution: { ...ATTR_OK, revokedAt: "x" } }),
    ].map((v) => v.copy);
    // Measures CONTENT, not the presence of a key: an empty string satisfies
    // "has copy" and says nothing (Wave 33 item 2, mutant M18).
    for (const c of copies) expect(c.length).toBeGreaterThan(60);
    expect(new Set(copies).size).toBe(copies.length);
  });

  it("A9 the sink in partnerConsortiumRoutes actually calls the rule and fails closed", () => {
    const src = readCode("server/partnerConsortiumRoutes.ts");
    expect(src).toContain("assertLock1CoWrite");
    // The refusal must precede the INSERT: an obligation may not be committed
    // before the row satisfying it exists.
    const guardAt = src.indexOf("lock1.coWrite");
    const insertAt = src.indexOf("INSERT OR IGNORE INTO soft_circles");
    expect(guardAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(guardAt);
    // And the columns LOCK 1 exists to govern are actually written.
    expect(src).toContain("sourced_from_partner_id");
    expect(src).toContain("sourced_from_partner_attribution_id");
  });

  it("A10 the sink no longer divides money by a hardcoded 100", () => {
    const src = readCode("server/partnerConsortiumRoutes.ts");
    expect(src).not.toContain("amountMinor / 100");
    expect(src).toContain("fromMinor(amountMinor, cur)");
  });
});

/* ── (B) PART B — THE NOTICE ENGINE ───────────────────────────────────────── */

describe("B — the wording notice: absence is a stated fact, never a blank", () => {
  it("B1 NULL text yields supplied=false and the not-supplied copy", () => {
    const n = describeLockNotice({ key: "K", text: null });
    expect(n.supplied).toBe(false);
    expect(n.text).toBeNull();
    expect(n.copy).toBe(LOCK_NOT_SUPPLIED_COPY);
  });

  it("B2 whitespace-only text is NOT a supplied wording", () => {
    // A blank that reads as supplied would make an unsatisfied lock look
    // satisfied — the failure mode this build keeps finding.
    const n = describeLockNotice({ key: "K", text: "   \n\t " });
    expect(n.supplied).toBe(false);
    expect(n.copy).toBe(LOCK_NOT_SUPPLIED_COPY);
  });

  it("B3 supplied text IS the copy, byte for byte — nothing wrapped around it", () => {
    const text = "  Verbatim lock string with\ttabs and\nnewlines.  ";
    const n = describeLockNotice({ key: "K", text });
    expect(n.supplied).toBe(true);
    expect(n.text).toBe(text);
    expect(n.copy).toBe(text);
    expect(n.copy).not.toContain(LOCK_NOT_SUPPLIED_COPY);
  });

  it("B4 the not-supplied copy is ABOUT the absence, not an approximation", () => {
    expect(LOCK_NOT_SUPPLIED_COPY).toMatch(/has not been supplied/i);
    expect(LOCK_NOT_SUPPLIED_COPY).toMatch(/not summarised|not approximated/i);
    // A paraphrase wearing a disclaimer is still a paraphrase. It must not
    // assert anything ABOUT what the lock requires.
    expect(LOCK_NOT_SUPPLIED_COPY).not.toMatch(/must not|shall|is required to|agrees to|undertakes/i);
  });
});

/* ── (D) THE STORE ────────────────────────────────────────────────────────── */

describe("D — the store: verbatim, versioned, and honest about a missing row", () => {
  it("D1 an unknown key reports exists=false, distinct from an unsupplied wording", () => {
    const n = getLockNotice("LOCK_DOES_NOT_EXIST_AT_ALL");
    expect(n.exists).toBe(false);
    expect(n.supplied).toBe(false);
    // Both say "no text", but a typo'd key must be chaseable.
    const seeded = getLock1Notice();
    expect(seeded.exists).toBe(true);
    expect(seeded.supplied).toBe(false);
  });

  it("D2 an empty wording is REFUSED rather than stored as a blank", () => {
    expect(() => setLockText({ key: TEST_KEY, text: "   ", setBy: ADMIN_USER })).toThrow(LockTextError);
    // Both poles: a real string is accepted.
    const ok = setLockText({ key: TEST_KEY, text: "first wording", setBy: ADMIN_USER });
    expect(ok.supplied).toBe(true);
  });

  it("D3 an anonymous supply is refused — legal text needs an attributable author", () => {
    expect(() => setLockText({ key: `${TEST_KEY}_x`, text: "some text", setBy: "  " })).toThrow(LockTextError);
    expect(getLockNotice(`${TEST_KEY}_x`).exists).toBe(false);
  });

  it("D4 text is stored EXACTLY as given — no trim, no normalisation", () => {
    const raw = "  LEADING and trailing space, \u00a0nbsp, \r\n CRLF  ";
    setLockText({ key: TEST_KEY, text: raw, setBy: ADMIN_USER });
    const back = getLockNotice(TEST_KEY);
    expect(back.text).toBe(raw);
    expect(back.copy).toBe(raw);
  });

  it("D5 every version is kept, newest first, and the old text is still readable", () => {
    const revs = listLockRevisions(TEST_KEY);
    expect(revs.length).toBeGreaterThanOrEqual(2);
    const texts = revs.map((r) => r.text);
    expect(texts).toContain("first wording");
    // The current value is never the only record of what a lock has said.
    expect(getLockNotice(TEST_KEY).text).not.toBe("first wording");
  });

  it("D6 the revision is written BEFORE the current value is updated", () => {
    const src = readCode("server/lockTextStore.ts");
    const revAt = src.indexOf("INSERT INTO platform_lock_text_revision");
    const curAt = src.indexOf("INSERT INTO platform_lock_text (");
    expect(revAt).toBeGreaterThan(-1);
    expect(curAt).toBeGreaterThan(revAt);
  });

  it("D7 listLockNotices includes the seeded LOCK_1 and reports it unsupplied", () => {
    const all = listLockNotices();
    const lock1 = all.find((l) => l.key === LOCK1_TEXT_KEY);
    expect(lock1).toBeTruthy();
    expect(lock1!.supplied).toBe(false);
    // Non-empty pole: "does not contain a supplied LOCK_1" passes trivially
    // against an empty list.
    expect(all.length).toBeGreaterThan(1);
  });
});

/* ── (R) THE ROUTES, EXECUTED ─────────────────────────────────────────────── */

describe("R — routes driven over HTTP, never scanned", () => {
  it("R1 the partner notice reports LOCK 1 as NOT SUPPLIED, with null text", async () => {
    const r = await request(app).get("/api/partner/me/pipeline/lock-notice");
    expect(r.status).toBe(200);
    expect(r.body.key).toBe(LOCK1_TEXT_KEY);
    expect(r.body.supplied).toBe(false);
    expect(r.body.text).toBeNull();
    expect(r.body.copy).toBe(LOCK_NOT_SUPPLIED_COPY);
  });

  it("R2 admin list: anonymous is 401, authenticated non-admin is 403, admin is 200", async () => {
    CURRENT.userId = null;
    CURRENT.isAdmin = false;
    expect((await request(app).get("/api/admin/lock-text")).status).toBe(401);

    CURRENT.userId = "u_not_admin";
    expect((await request(app).get("/api/admin/lock-text")).status).toBe(403);

    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const ok = await request(app).get("/api/admin/lock-text");
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.locks)).toBe(true);
    expect(ok.body.outstanding).toContain(LOCK1_TEXT_KEY);
  });

  it("R3 a non-admin cannot supply a lock's wording, and nothing is written", async () => {
    CURRENT.userId = "u_not_admin";
    CURRENT.isAdmin = false;
    const key = `${TEST_KEY}_R3`;
    const r = await request(app).put(`/api/admin/lock-text/${key}`).send({ text: "sneaky" });
    expect(r.status).toBe(403);
    // Asserts on the EMITTED state, not on the guard's source.
    expect(getLockNotice(key).exists).toBe(false);
  });

  it("R4 an admin supplies wording and it comes back VERBATIM on the partner surface", async () => {
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const wording = "OWNER SUPPLIED §1.  Two spaces, a\ttab, and\na newline.";
    const put = await request(app).put(`/api/admin/lock-text/${LOCK1_TEXT_KEY}`).send({ text: wording });
    expect(put.status).toBe(200);
    expect(put.body.supplied).toBe(true);
    expect(put.body.text).toBe(wording);

    const notice = await request(app).get("/api/partner/me/pipeline/lock-notice");
    expect(notice.body.supplied).toBe(true);
    expect(notice.body.text).toBe(wording);
    expect(notice.body.copy).toBe(wording);
    // The other pole: the not-supplied sentence is now gone entirely.
    expect(JSON.stringify(notice.body)).not.toContain("has not been supplied");
    expect(notice.body.setAt).toBeTruthy();

    // Restore LOCK_1 to its shipped state so no later case depends on ordering.
    rawDb()
      .prepare(`UPDATE platform_lock_text SET text = NULL, set_by = NULL, set_at = NULL WHERE key = ?`)
      .run(LOCK1_TEXT_KEY);
    const back = await request(app).get("/api/partner/me/pipeline/lock-notice");
    expect(back.body.supplied).toBe(false);
  });

  it("R5 an empty wording is a 400 with a stated reason, not a stored blank", async () => {
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const key = `${TEST_KEY}_R5`;
    const r = await request(app).put(`/api/admin/lock-text/${key}`).send({ text: "" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("LOCK_TEXT_REQUIRED");
    expect(getLockNotice(key).exists).toBe(false);
    // Both poles on the same key.
    const ok = await request(app).put(`/api/admin/lock-text/${key}`).send({ text: "real" });
    expect(ok.status).toBe(200);
    expect(getLockNotice(key).text).toBe("real");
  });

  it("R6 a non-string body value is refused, not coerced into a wording", async () => {
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const key = `${TEST_KEY}_R6`;
    const r = await request(app).put(`/api/admin/lock-text/${key}`).send({ text: 12345 });
    expect(r.status).toBe(400);
    expect(getLockNotice(key).exists).toBe(false);
  });

  it("R7 the revisions route is admin-gated and returns the recorded history", async () => {
    CURRENT.userId = null;
    CURRENT.isAdmin = false;
    expect((await request(app).get(`/api/admin/lock-text/${TEST_KEY}/revisions`)).status).toBe(401);
    CURRENT.userId = ADMIN_USER;
    CURRENT.isAdmin = true;
    const r = await request(app).get(`/api/admin/lock-text/${TEST_KEY}/revisions`);
    expect(r.status).toBe(200);
    expect(r.body.revisions.length).toBeGreaterThanOrEqual(2);
    expect(r.body.revisions.every((x: { setBy: string | null }) => x.setBy === ADMIN_USER)).toBe(true);
  });

  it("R8 the four routes are registered in routes.ts, so they are actually mounted", () => {
    const src = readCode("server/routes.ts");
    expect(src).toContain("registerLockTextRoutes(app)");
  });
});

/* ── (N) THE NO-FABRICATION GUARANTEE (OQ-5) ──────────────────────────────── */

describe("N — nothing anywhere authors, defaults or approximates a lock wording", () => {
  it("N1 the migration seeds LOCK_1 with NULL text and inserts no wording", () => {
    const raw = fs.readFileSync("migrations/0180_wave33_lock_text_registry.sql", "utf8");
    /* HARNESS BUG, FOUND ON FIRST RUN AND RECORDED: the first version of this
       case counted `INSERT` across the whole file and matched the header
       sentence "NO SEED TEXT IS INSERTED" — it measured the prose describing
       the rule rather than the SQL obeying it. Comments are stripped first,
       and C0-style the stripper is proved below by requiring the DDL to
       survive it. */
    const sql = raw.replace(/^\s*--[^\n]*$/gm, "");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS platform_lock_text");
    expect(sql).not.toContain("NO SEED TEXT IS INSERTED");
    const inserts = sql.match(/INSERT[\s\S]*?;/gi) ?? [];
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toContain("'LOCK_1', NULL");
    // Additive only.
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bALTER\b|\bUPDATE\b/i);
  });

  it("N2 the client panel renders ONLY server-supplied strings for the lock body", () => {
    const src = readCode("client/src/components/partner/Lock1NoticePanel.tsx");
    // The two branches it may render.
    expect(src).toContain("{q.data.text}");
    expect(src).toContain("{q.data.copy}");
    // No local fallback: `text ?? "..."` is how a placeholder becomes a lock.
    expect(src).not.toMatch(/data\.text\s*\|\|/);
    expect(src).not.toMatch(/data\.text\s*\?\?/);
    expect(src).not.toMatch(/data\.copy\s*\|\|/);
    expect(src).not.toMatch(/data\.copy\s*\?\?/);
  });

  it("N3 no source file in this item contains lock-like legal prose", () => {
    const files = [
      "server/lib/lock1Provenance.ts",
      "server/lockTextStore.ts",
      "server/lockTextRoutes.ts",
      "client/src/components/partner/Lock1NoticePanel.tsx",
      "client/src/components/admin/LockTextAdminPanel.tsx",
    ];
    for (const f of files) {
      const src = readCode(f);
      // A drafted lock reads as an obligation. None of these files may.
      expect(src, f).not.toMatch(/\bLOCK 1 (?:requires|states|provides|means)\b/i);
      expect(src, f).not.toMatch(/\bhereby\b|\bwhereas\b|\bshall not\b/i);
    }
    // Sanity pole: the scan can still find such prose when it is present.
    expect("The partner hereby agrees").toMatch(/\bhereby\b/i);
  });

  it("N4 the admin editor seeds an unsupplied lock with NOTHING", () => {
    const src = readCode("client/src/components/admin/LockTextAdminPanel.tsx");
    expect(src).toContain('setDraft(l.text ?? "")');
    // i.e. the fallback is the empty string, never a suggested wording.
    expect(src).not.toMatch(/setDraft\(l\.text \?\? "[^"]{3,}"\)/);
  });

  it("N5 the route emits text:null when unsupplied — it does not omit the key", async () => {
    CURRENT.userId = null;
    CURRENT.isAdmin = false;
    const r = await request(app).get("/api/partner/me/pipeline/lock-notice");
    // Emitted keys, not consulted source. An omitted key renders as
    // `undefined` client-side and would take the "supplied" branch by accident.
    expect(Object.keys(r.body)).toEqual(expect.arrayContaining(["key", "supplied", "text", "copy", "setAt"]));
    expect(r.body.text).toBeNull();
  });
});

/* ── (M) MOUNTED — a component mounted nowhere is not shipped ─────────────── */

describe("M — both panels are mounted on a real, reachable page", () => {
  it("M1 the partner notice is imported AND rendered on the pipeline page", () => {
    const src = readCode("client/src/pages/partner/PartnerPipeline.tsx");
    expect(src).toContain("Lock1NoticePanel");
    expect(src).toContain("<Lock1NoticePanel />");
    // Appended as the LAST sibling inside the shell (guard rule).
    const mountAt = src.indexOf("<Lock1NoticePanel />");
    const closeAt = src.indexOf("</PartnerShell>");
    expect(mountAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(mountAt);
    expect(src.slice(mountAt + "<Lock1NoticePanel />".length, closeAt).trim()).toBe("");
  });

  it("M2 the admin editor is imported AND rendered on Platform Surfaces", () => {
    const src = readCode("client/src/pages/admin/PlatformSurfaces.tsx");
    expect(src).toContain("<LockTextAdminPanel />");
    expect(src).toContain('value="lock-text"');
  });

  it("M3 the lock-text tab is the LAST trigger, appended not inserted", () => {
    const src = readCode("client/src/pages/admin/PlatformSurfaces.tsx");
    const triggers = Array.from(src.matchAll(/<TabsTrigger value="([^"]+)"/g)).map((m) => m[1]);
    expect(triggers[triggers.length - 1]).toBe("lock-text");
    // The pre-existing triggers are all still present, in order.
    expect(triggers.slice(0, 5)).toEqual(["routes", "columns", "audit", "bridge", "mark-reviews"]);
  });

  it("M4 sanity pole: the scan detects a component that is NOT mounted", () => {
    const src = readCode("client/src/pages/partner/PartnerPipeline.tsx");
    expect(src).not.toContain("<LockTextAdminPanel />");
  });
});

/* ── (X) STRUCTURAL ───────────────────────────────────────────────────────── */

describe("X — structural rules this build has paid for", () => {
  const OWNED = [
    "server/lib/lock1Provenance.ts",
    "server/lib/applyLockTextSchema.ts",
    "server/lockTextStore.ts",
    "server/lockTextRoutes.ts",
    "client/src/components/partner/Lock1NoticePanel.tsx",
    "client/src/components/admin/LockTextAdminPanel.tsx",
  ];

  it("X1 no lazy require() in any file this item owns", () => {
    for (const f of OWNED) {
      expect(readCode(f), f).not.toMatch(/\brequire\s*\(/);
    }
    // Sanity pole: the scan still finds one where it exists.
    expect(readCode("server/lib/userContext.ts")).toMatch(/\brequire\s*\(/);
  });

  it("X2 no iterator spread in any file this item owns", () => {
    for (const f of OWNED) {
      expect(readCode(f), f).not.toMatch(/\[\.\.\.[A-Za-z_$][\w$]*\.(values|keys|entries)\(\)\]/);
    }
  });

  it("X3 the migration is mirrored byte-identically", () => {
    const a = fs.readFileSync("migrations/0180_wave33_lock_text_registry.sql");
    const b = fs.readFileSync("server/db/migrations/0180_wave33_lock_text_registry.sql");
    expect(a.equals(b)).toBe(true);
  });

  it("X4 the installer re-types NO DDL — it reads the migration off disk", () => {
    const src = readCode("server/lib/applyLockTextSchema.ts");
    expect(src).not.toMatch(/CREATE\s+TABLE/i);
    expect(src).not.toMatch(/CREATE\s+INDEX/i);
    expect(src).toContain("readFileSync");
  });

  it("X5 A-22 both directions: no other file creates these tables", () => {
    const conn = fs.readFileSync("server/db/connection.ts", "utf8");
    expect(conn).not.toContain("platform_lock_text");
  });

  it("X7 the installer heals a DB that has the CURRENT table but no REVISION table (kills M29)", () => {
    /* COVERAGE GAP found by mutation: probing only `platform_lock_text` left a
       database healed by an earlier revision permanently missing the history
       table — every wording change recorded nowhere, silently, since the write
       path fails soft. Proved by EXECUTION against a real database rather than
       by reading the probe. */
    // STATIC import (see X1): a lazy require in a test is the same defect
    // class the test itself forbids in shipped code.
    const db = new Database(":memory:");
    db.exec(
      `CREATE TABLE platform_lock_text (key TEXT PRIMARY KEY NOT NULL, text TEXT,
         set_by TEXT, set_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    );
    const has = (n: string) =>
      !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(n);
    // Precondition, asserted: exactly the half-healed state.
    expect(has("platform_lock_text")).toBe(true);
    expect(has("platform_lock_text_revision")).toBe(false);

    applyLockTextSchema(db as never);

    expect(has("platform_lock_text_revision")).toBe(true);
    db.close();
  });

  it("X6 the installer is idempotent — re-applying changes nothing", () => {
    const before = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM platform_lock_text`)
      .get() as { n: number };
    applyLockTextSchema(rawDb() as never);
    applyLockTextSchema(rawDb() as never);
    const after = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM platform_lock_text`)
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
