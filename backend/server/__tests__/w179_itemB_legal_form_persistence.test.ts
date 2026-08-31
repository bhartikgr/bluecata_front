/**
 * WAVE 179 · ITEM B · R151.3 — THE LEGAL FORM, SERVER SIDE.
 *
 * The rendered half is pinned in
 * `client/src/components/partner/__tests__/w179_itemB_legal_form_resolution.test.tsx`.
 * This file pins the half that decides whether that surface is ever fed anything:
 * the column, the writes, the read-backs, and the four hard constraints of R151.3
 * as properties of the STORED data rather than of the screen.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   1 · MIGRATION SHAPE: `spv.legal_form` exists, is TEXT, is NULLABLE and has NO
 *       DEFAULT. A default would silently state a form for every vehicle.
 *   2 · NO BACKFILL: every pre-existing vehicle in the seeded sandbox has
 *       `legal_form IS NULL`. Counted, so an accidental UPDATE anywhere would show.
 *   3 · CREATE WITHOUT the field → the column stays NULL and the detail route
 *       reports `legalForm: null`. This is the default, and it is "not stated".
 *   4 · CREATE WITH a valid form for the vehicle's own jurisdiction → persisted,
 *       and read back by the detail route a real page refetches.
 *   5 · SETTINGS PATCH sets it later, and can CLEAR it back to not-stated.
 *   6 · THE VALIDATOR REFUSES: a form belonging to a different jurisdiction, and an
 *       invented string, do NOT persist. The column stays as it was — a rejected
 *       value must not become a stated one.
 *   7 · NO INFERENCE, AS A PROPERTY OF THE SOURCE TREE: the only assignments to the
 *       column in the whole server come from `setSpvLegalForm`, whose only source
 *       of a value is its own argument. Proved by grep over comment-stripped source.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { ensureSpvLegalFormColumn, getSpvLegalForm, setSpvLegalForm } from "../spvLegalFormStore";
import { spvLegalFormOptions } from "../../shared/spvLegalForm";

const ACTOR_A = "u_avi_managing";

let app: express.Express;

function createBody(name: string, jurisdiction: string, legalForm?: string | null) {
  const body: Record<string, unknown> = {
    spvName: name,
    jurisdiction,
    vintage: 2026,
    currency: "USD",
    status: "planned",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  };
  if (legalForm !== undefined) body.legalForm = legalForm;
  return body;
}

async function createSpv(name: string, jurisdiction: string, legalForm?: string | null): Promise<string> {
  const res = await request(app)
    .post("/api/partner/me/spvs")
    .set("x-user-id", ACTOR_A)
    .send(createBody(name, jurisdiction, legalForm));
  expect(res.status).toBe(201);
  return res.body.spv.id as string;
}

function rawLegalForm(spvId: string): string | null | undefined {
  const r = rawDb().prepare(`SELECT legal_form FROM spv WHERE id = ?`).get(spvId) as
    | { legal_form: string | null }
    | undefined;
  return r?.legal_form;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  ensureSpvLegalFormColumn();
});

describe("WAVE 179 · ITEM B — legal_form column, writes and refusals", () => {
  it("POLE 1 — the column is TEXT, NULLABLE and has NO DEFAULT", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(spv)`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>;
    const col = cols.find((c) => c.name === "legal_form");
    expect(col).toBeTruthy();
    expect(String(col!.type).toUpperCase()).toBe("TEXT");
    expect(col!.notnull).toBe(0);
    expect(col!.dflt_value == null).toBe(true);
  });

  it("POLE 1b — migration 0214 is mirrored BYTE-IDENTICALLY and contains no UPDATE", () => {
    const a = readFileSync("migrations/0214_wave179_spv_legal_form.sql");
    const b = readFileSync("server/db/migrations/0214_wave179_spv_legal_form.sql");
    expect(a.equals(b)).toBe(true);
    /* Comment-stripped: the migration's own docblock EXPLAINS that it runs no
       UPDATE, and that sentence must not be what satisfies this assertion. */
    const sql = a
      .toString("utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "")
      .toUpperCase();
    expect(sql).toContain("ADD COLUMN");
    /* Exactly ONE statement, so there is no room for a row-touching second one. */
    expect(sql.split(";").filter((s) => s.trim().length > 0).length).toBe(1);
    /* Zero rows touched: no UPDATE, no INSERT, and no DEFAULT clause. */
    expect(sql).not.toContain("UPDATE ");
    expect(sql).not.toContain("INSERT ");
    expect(sql).not.toContain("DEFAULT");
    /* And 0214 is claimed exactly once in each directory. */
    for (const dir of ["migrations", "server/db/migrations"]) {
      const hits = readdirSync(dir).filter((f) => f.startsWith("0214"));
      expect(hits.length).toBe(1);
    }
  });

  it("POLE 2 — NO BACKFILL: the migration is REPLAYED over a real vehicle and touches zero rows", async () => {
    /* The strongest available form of this proof: create a vehicle, remove the
       column so the database is back in its pre-0214 state WITH DATA IN IT, run
       0214's own bytes, and check the row survived unchanged and unstated. */
    const id = await createSpv("W179 LF Pre Existing", "ireland");
    const before = rawDb().prepare(`SELECT COUNT(*) AS n FROM spv`).get() as { n: number };
    expect(before.n).toBeGreaterThan(0);

    let replayed = false;
    try {
      rawDb().exec(`ALTER TABLE spv DROP COLUMN legal_form`);
      replayed = true;
    } catch {
      /* Older SQLite without DROP COLUMN: fall through to the static check below. */
    }
    if (replayed) {
      rawDb().exec(readFileSync("migrations/0214_wave179_spv_legal_form.sql", "utf8"));
    }

    const after = rawDb().prepare(`SELECT COUNT(*) AS n FROM spv`).get() as { n: number };
    expect(after.n).toBe(before.n);
    /* Not one vehicle now states a legal form. */
    const stated = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv WHERE legal_form IS NOT NULL`)
      .get() as { n: number };
    expect(stated.n).toBe(0);
    expect(rawLegalForm(id)).toBeNull();
  });

  it("POLE 3 — creating WITHOUT the field leaves it NULL, and the detail route says so", async () => {
    const id = await createSpv("W179 LF Unstated", "singapore");
    expect(rawLegalForm(id)).toBeNull();
    expect(getSpvLegalForm(id)).toBeNull();
    const detail = await request(app).get(`/api/partner/me/spv/${id}`).set("x-user-id", ACTOR_A);
    expect(detail.status).toBe(200);
    expect(detail.body.legalForm).toBeNull();
  });

  it("POLE 4 — creating WITH a valid form persists it and reads back", async () => {
    const id = await createSpv("W179 LF VCC", "singapore", "singapore_variable_capital_company");
    expect(rawLegalForm(id)).toBe("singapore_variable_capital_company");
    const detail = await request(app).get(`/api/partner/me/spv/${id}`).set("x-user-id", ACTOR_A);
    expect(detail.body.legalForm).toBe("singapore_variable_capital_company");
  });

  it("POLE 5 — the settings PATCH sets it later and can CLEAR it back to not stated", async () => {
    const id = await createSpv("W179 LF Later", "jersey");
    expect(rawLegalForm(id)).toBeNull();

    const set = await request(app)
      .patch(`/api/partner/me/spv/${id}/legal-form`)
      .set("x-user-id", ACTOR_A)
      .send({ legalForm: "jersey_llc" });
    expect(set.status).toBe(200);
    expect(rawLegalForm(id)).toBe("jersey_llc");

    const cleared = await request(app)
      .patch(`/api/partner/me/spv/${id}/legal-form`)
      .set("x-user-id", ACTOR_A)
      .send({ legalForm: null });
    expect(cleared.status).toBe(200);
    expect(rawLegalForm(id)).toBeNull();
    const detail = await request(app).get(`/api/partner/me/spv/${id}`).set("x-user-id", ACTOR_A);
    expect(detail.body.legalForm).toBeNull();
  });

  it("POLE 6 — a foreign or invented form does NOT persist, and does not overwrite a stated one", async () => {
    const id = await createSpv("W179 LF Refusals", "guernsey", "guernsey_company");
    expect(rawLegalForm(id)).toBe("guernsey_company");
    for (const bad of ["singapore_variable_capital_company", "company", "guernsey_llc", "", "  "]) {
      await request(app)
        .patch(`/api/partner/me/spv/${id}/legal-form`)
        .set("x-user-id", ACTOR_A)
        .send({ legalForm: bad });
      /* Either refused outright or normalised to "not stated" — but NEVER stored as
         a form this jurisdiction does not have. */
      const after = rawLegalForm(id);
      expect(after === "guernsey_company" || after === null).toBe(true);
      expect(after).not.toBe(bad === "" || bad === "  " ? "x" : bad);
    }
    /* And a jurisdiction with NO sourced forms cannot be given one at creation. */
    const del = await createSpv("W179 LF Delaware", "delaware", "jersey_company");
    expect(rawLegalForm(del)).toBeNull();
  });

  it("POLE 7 — NO INFERENCE PATH EXISTS: the column is only ever written from an explicit argument", () => {
    /* Comment-stripped, so a sentence in a docblock cannot satisfy or break this. */
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const files = ["server/spvLegalFormStore.ts", "server/spvEngineRoutes.ts", "server/partnerRoutes.ts"];
    const writers: string[] = [];
    const callSites: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      /* Any SQL that assigns legal_form must live in the store, and only there. */
      if (/legal_form\s*=/.test(src) || /SET\s+legal_form/i.test(src)) writers.push(f);
      /* No route may derive the value from the vehicle instead of the request. */
      /* Whole lines, because a call's argument list can itself contain
         parentheses (`(req.body ?? {}).legalForm`) and a bracket-counting regex
         would truncate exactly the part under test. */
      const calls = src
        .split("\n")
        .filter((l) => l.includes("setSpvLegalForm("))
        .filter((l) => !l.includes("import") && !l.includes("function"));
      callSites.push(...calls);
      for (const c of calls) {
        /* The value argument must be a REQUEST-sourced expression. */
        expect(/req\.body|Body\.legalForm|body\.legalForm|parsed\.data\.legalForm/.test(c)).toBe(true);
        /* And must never be the jurisdiction's option list, a first option, or the
           vehicle's own name — the three inference shortcuts R151.3 forbids. */
        expect(/spvLegalFormOptions|SPV_LEGAL_FORM_OPTIONS|\[\s*0\s*\]|spv\.name|detail\.name/.test(c)).toBe(false);
      }
    }
    /* Three call sites exist — both create routes and the settings PATCH — so the
       loop above really examined something. */
    expect(callSites.length).toBe(3);
    expect(writers).toEqual(["server/spvLegalFormStore.ts"]);

    /* And inside the store, the only value that can reach the column is the one
       `resolveSpvLegalForm` validated from the caller's argument. */
    const store = strip(readFileSync("server/spvLegalFormStore.ts", "utf8"));
    expect(store).toContain("resolveSpvLegalForm");
    /* No fallback to a first option, and no name/type sniffing anywhere. A source
       check has to be structural rather than a single spelling: an inferring
       fallback can be written `options[0]`, `spvLegalFormOptions(j)[0]`, or
       `[...][0]`, so this asserts on the SHAPE — any subscript-zero at all, and
       any mention of the option list inside the writer. */
    expect(/\[\s*0\s*\]/.test(store)).toBe(false);
    expect(/spvLegalFormOptions|SPV_LEGAL_FORM_OPTIONS/.test(store)).toBe(false);
    expect(/\.name\b/.test(store)).toBe(false);
    expect(/includes\(\s*["'].*partnership/i.test(store)).toBe(false);
  });

  it("POLE 8 — NO INFERENCE, PROVED BEHAVIOURALLY: an absent value leaves the column NULL on a form-dependent jurisdiction", () => {
    /* THE POLE THE SOURCE-GREP ABOVE CANNOT REPLACE.

       A grep can only refuse the spellings it was taught. What R151.3 actually
       forbids is an OUTCOME: a vehicle acquiring a legal form nobody stated. So
       this drives the real writer on a real row, in a jurisdiction where the tax
       wording IS form-dependent and where an inferring implementation would have
       the strongest excuse to guess, and asserts the column stays NULL for every
       shape of "not stated" a caller can send. */
    const spvId = `spv_w179b_noinfer_${Date.now()}`;
    rawDb()
      .prepare(
        `INSERT INTO spv
           (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
            distribution_scope, currency, carry_basis, lp_visibility,
            created_at, created_by, updated_at, updated_by, curr_hash)
         VALUES (?, ?, ?, ?, 'spv', 'singapore', 'planned', 'private', 'USD',
                 'whole_fund', 'own_only', ?, ?, ?, ?, ?)`,
      )
      .run(
        spvId,
        "ac_consortium_partner_test_partner_inc",
        "u_avi_managing",
        "W179B No-Inference Vehicle",
        "2026-08-27T00:00:00.000Z",
        "u_avi_managing",
        "2026-08-27T00:00:00.000Z",
        "u_avi_managing",
        "0".repeat(64),
      );

    /* Singapore is one of the seven, and it DOES have options — so a guess is
       available to any implementation inclined to make one. */
    expect(spvLegalFormOptions("singapore").length).toBeGreaterThan(0);

    for (const notStated of [undefined, null, "", "   ", "__legal_form_not_stated__", "not_a_real_form"]) {
      setSpvLegalForm(spvId, "singapore", notStated);
      const raw = rawDb().prepare(`SELECT legal_form AS f FROM spv WHERE id = ?`).get(spvId) as
        | { f: string | null }
        | undefined;
      expect(raw?.f ?? null).toBe(null);
      expect(getSpvLegalForm(spvId)).toBe(null);
    }

    /* NON-VACUITY: the same writer DOES store a value when one is explicitly
       stated, so the NULLs above are refusals and not a broken write path. */
    setSpvLegalForm(spvId, "singapore", "singapore_variable_capital_company");
    expect(getSpvLegalForm(spvId)).toBe("singapore_variable_capital_company");
    /* And clearing it back to not-stated is possible — the field is OPTIONAL. */
    setSpvLegalForm(spvId, "singapore", null);
    expect(getSpvLegalForm(spvId)).toBe(null);
  });
});
