/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 339 · W332 — THE CONTACTS CRM GETS A VOCABULARY, AND NO EXISTING
 * CONTACT IS TAKEN OFFLINE TO ACHIEVE IT.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. Six stage vocabularies run on this platform and Contacts had
 * none: `stage` was `z.string().max(60)` behind a plain text box. "Committed",
 * "committed" and "Comitted" were three different facts, and `committed`
 * already means three different things across the other ladders.
 *
 * WHAT THIS SUITE PROVES, IN ORDER OF WHAT COULD GO WRONG:
 *   §1 The rule is real: a made-up stage is REFUSED on create, and NO row is
 *      written. Asserted on the stored row count, before the status code.
 *   §2 The rule is not a wall: every value in the vocabulary is ACCEPTED and
 *      STORED. A guard that refuses everything is an outage, not a fix.
 *   §3 THE ANTI-OUTAGE CONTROL, AND THE REASON THIS WAVE IS SHAPED THE WAY IT
 *      IS. A contact that already holds a stage from before this vocabulary
 *      existed must STILL BE EDITABLE. Fixing a typo in such a contact's email
 *      must not 400 because the form resent the stage it found.
 *   §4 But a CHANGE to a made-up stage is still refused, and the stored row is
 *      unchanged.
 *   §5 Clearing the stage stays legal — "not placed yet" is a real answer.
 *   §6 THE CONSTRAINT IS NOT IN THE DATABASE. Asserted against the live table
 *      definition, because a DB CHECK would reject rows already stored. This is
 *      the spec's explicit instruction and it is measured, not asserted in prose.
 *   §7 R91 AND R266 HELD: no ladder gained, lost or reordered a value, and
 *      nothing was merged. The Contacts vocabulary IS the Clients vocabulary,
 *      not a copy that can drift.
 * ══════════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { patchConfig } from "../emailTransport";
import {
  PARTNER_CONTACT_STAGES,
  PARTNER_CLIENT_STAGES,
  PARTNER_PIPELINE_STAGES,
  FOUNDER_CRM_STAGES,
  INVESTOR_PCRM_STAGES,
} from "@shared/crmStages";

const MANAGING = "u_avi_managing";
let app: express.Express;
let server: http.Server;

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
  storeCredential({
    userId: MANAGING,
    email: "w339w332.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w339",
  });
});

/* ── STORED-ROW READERS. Every claim below is settled through these. ───────── */
function storedStage(id: string): string | null {
  const r = rawDb()
    .prepare(`SELECT stage FROM partner_crm_contacts WHERE id = ?`)
    .get(id) as { stage?: string | null } | undefined;
  return r?.stage ?? null;
}
function contactCount(email: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM partner_crm_contacts WHERE lower(email) = lower(?)`)
    .get(email) as { n: number };
  return r.n;
}

let seq = 0;
function freshEmail(tag: string): string {
  return `w339.${tag}.${Date.now()}_${seq++}@test-partner.example`;
}

async function createContact(body: Record<string, unknown>) {
  return request(app).post("/api/partner/me/crm/contacts").set("x-user-id", MANAGING).send(body);
}
async function patchContact(id: string, body: Record<string, unknown>) {
  return request(app)
    .patch(`/api/partner/me/crm/contacts/${id}`)
    .set("x-user-id", MANAGING)
    .send(body);
}

/** A stored contact, created the way the product creates one. */
async function makeContact(tag: string): Promise<{ id: string; email: string }> {
  const email = freshEmail(tag);
  const r = await createContact({ first_name: "Dana", last_name: "Okoro", email });
  expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain("status=2");
  const id = String(r.body.contact?.id ?? r.body.id);
  expect(id).not.toBe("undefined");
  return { id, email };
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 1 — A MADE-UP STAGE IS REFUSED ON CREATE, AND NOTHING IS WRITTEN.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §1 — create refuses a stage outside the vocabulary", () => {
  it("no contact row is written, and only then is the status code read", async () => {
    const email = freshEmail("bad");
    const r = await createContact({
      first_name: "Dana",
      last_name: "Okoro",
      email,
      stage: "Comitted",
    });
    /* CONSEQUENCE FIRST — the row, then the reason. */
    expect(`rows=${contactCount(email)}`).toBe("rows=0");
    expect(`status=${r.status}`).toBe("status=400");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 2 — THE CONTROL. THE GUARD IS NOT A WALL.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §2 — every stage in the vocabulary is accepted and stored", () => {
  it.each([...PARTNER_CONTACT_STAGES])("`%s` is stored verbatim", async (stage) => {
    const email = freshEmail(`ok_${stage}`);
    const r = await createContact({ first_name: "Dana", last_name: "Okoro", email, stage });
    expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain("status=2");
    const id = String(r.body.contact?.id ?? r.body.id);
    expect(`stored=${storedStage(id)}`).toBe(`stored=${stage}`);
  });

  it("an ABSENT stage is still legal — `not placed yet` is a real answer", async () => {
    const c = await makeContact("nostage");
    expect(`stored=${storedStage(c.id)}`).toBe("stored=null");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 3 — THE ANTI-OUTAGE CONTROL.
   A contact holding a pre-vocabulary stage MUST stay editable.

   HOW THE LEGACY ROW IS BUILT, AND WHY IT IS BUILT THIS WAY. The first version
   of this section created a contact and then UPDATEd its stage in SQL. It went
   RED, and the RED was correct and instructive: the write route reads the row
   through `findCrmByIdAnyTenant`, which answers from an in-memory cache, so the
   route never saw the SQL edit. A row that genuinely predates this vocabulary
   is one the process has NOT cached — it is read from disk on first touch. So
   the fixture CLONES a real contact row into a brand-new id that no cache has
   seen, carrying the legacy stage. That is what an old row actually looks like.

   The clone is written with plain INSERT/SELECT over the contact's own columns.
   It is not a shortcut past a chain: this store's own type comment records that
   the parity fields — `stage` among them — are NOT part of the CP-008 hash
   payload, so no hash is invalidated and no anchor is forged.
   ───────────────────────────────────────────────────────────────────────────── */

/** Clone a stored contact into a NEW id the process has never cached, holding
 *  `legacyStage`. Returns the new id. */
function cloneAsLegacyRow(sourceId: string, legacyStage: string, email: string): string {
  const cols = (
    rawDb().prepare(`PRAGMA table_info(partner_crm_contacts)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  expect(cols).toContain("stage");
  expect(cols).toContain("id");
  const newId = `crm_w339legacy_${Date.now()}_${seq++}`;
  /* The three overridden columns are bound IN COLUMN ORDER, not in the order
     they are named here. Getting that wrong is silent: the first attempt bound
     them by hand and wrote the email address into the stage column, which this
     section's own `seeded=` assertion caught. */
  const overrides: Record<string, string> = { id: newId, stage: legacyStage, email };
  const params = cols.filter((c) => c in overrides).map((c) => overrides[c]);
  const select = cols.map((c) => (c in overrides ? "?" : `"${c}"`)).join(", ");
  rawDb()
    .prepare(
      `INSERT INTO partner_crm_contacts (${cols.map((c) => `"${c}"`).join(", ")})
         SELECT ${select} FROM partner_crm_contacts WHERE id = ?`,
    )
    .run(...params, sourceId);
  return newId;
}

describe("W339 W332 §3 — an existing contact with a legacy stage is not taken offline", () => {
  it("re-sending the stage the row ALREADY holds is accepted, and an unrelated edit saves", async () => {
    const src = await makeContact("legacy_src");
    const legacyEmail = freshEmail("legacy");
    const id = cloneAsLegacyRow(src.id, "warm_intro_pending", legacyEmail);
    expect(`seeded=${storedStage(id)}`).toBe("seeded=warm_intro_pending");

    /* The form resends every field it displayed, including the stage it found. */
    const newEmail = freshEmail("legacy2");
    const r = await patchContact(id, { stage: "warm_intro_pending", email: newEmail });

    expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain("status=200");
    /* The legacy stage is preserved exactly — never silently re-filed. */
    expect(`stored=${storedStage(id)}`).toBe("stored=warm_intro_pending");
    const row = rawDb()
      .prepare(`SELECT email FROM partner_crm_contacts WHERE id = ?`)
      .get(id) as { email: string };
    expect(row.email.toLowerCase()).toBe(newEmail.toLowerCase());
  });

  it("such a contact can also be MOVED ONTO the vocabulary", async () => {
    const src = await makeContact("legacy_move_src");
    const id = cloneAsLegacyRow(src.id, "warm_intro_pending", freshEmail("legacy_move"));

    const r = await patchContact(id, { stage: "engaged" });
    expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain("status=200");
    expect(`stored=${storedStage(id)}`).toBe("stored=engaged");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 4 — A CHANGE TO A MADE-UP STAGE IS STILL REFUSED.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §4 — update refuses a NEW stage outside the vocabulary", () => {
  it("the stored stage is unchanged, and the refusal says what may be used", async () => {
    const c = await makeContact("badpatch");
    const before = await patchContact(c.id, { stage: "prospect" });
    expect(`status=${before.status}`).toBe("status=200");
    expect(`stored=${storedStage(c.id)}`).toBe("stored=prospect");

    const r = await patchContact(c.id, { stage: "Comitted" });
    /* CONSEQUENCE FIRST. */
    expect(`stored=${storedStage(c.id)}`).toBe("stored=prospect");
    expect(`status=${r.status}`).toBe("status=400");
    /* R77 — a code for machines AND a sentence for people, naming the choices. */
    expect(String(r.body.error)).toBe("INVALID_CONTACT_STAGE");
    for (const s of PARTNER_CONTACT_STAGES) {
      expect(String(r.body.message)).toContain(s);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 5 — CLEARING STAYS LEGAL.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §5 — a stage can still be cleared", () => {
  it("null clears the stored stage", async () => {
    const c = await makeContact("clear");
    expect((await patchContact(c.id, { stage: "invested" })).status).toBe(200);
    expect(`stored=${storedStage(c.id)}`).toBe("stored=invested");

    const r = await patchContact(c.id, { stage: null });
    expect(`status=${r.status}`).toBe("status=200");
    expect(`stored=${storedStage(c.id)}`).toBe("stored=null");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 6 — THE CONSTRAINT IS NOT IN THE DATABASE. THE SPEC'S INSTRUCTION,
   MEASURED AGAINST THE LIVE TABLE DEFINITION.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §6 — no database constraint was added to the stage column", () => {
  it("`partner_crm_contacts` has NO CHECK constraint mentioning `stage`", () => {
    const row = rawDb()
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'partner_crm_contacts'`)
      .get() as { sql?: string } | undefined;
    /* Both sides asserted non-empty: an empty DDL would pass a naive `not
       .toContain` check while proving nothing. */
    expect(String(row?.sql ?? "").length).toBeGreaterThan(50);
    expect(String(row?.sql).toUpperCase()).not.toContain("CHECK");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 7 — R91 AND R266 HELD. NOTHING MERGED, NOTHING REORDERED.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 W332 §7 — no ladder was reordered, and the CRMs stay separate", () => {
  it("the Contacts vocabulary IS the Clients vocabulary — one array, not a copy", () => {
    expect(PARTNER_CONTACT_STAGES).toBe(PARTNER_CLIENT_STAGES);
    expect([...PARTNER_CONTACT_STAGES]).toEqual([
      "prospect",
      "engaged",
      "committed",
      "invested",
      "longterm",
    ]);
  });

  it("every other ladder is byte-for-byte what it was, in the same ORDER", () => {
    expect([...PARTNER_PIPELINE_STAGES]).toEqual([
      "invited",
      "viewed",
      "soft_circle",
      "signed",
      "funded",
      "committed",
    ]);
    expect([...FOUNDER_CRM_STAGES]).toEqual([
      "invited_unregistered",
      "prospect",
      "engaged",
      "soft_circle",
      "committed",
      "signing",
      "invested",
      "longterm",
      "lead",
    ]);
    expect([...INVESTOR_PCRM_STAGES]).toEqual([
      "lead",
      "met",
      "diligence",
      "soft_circle",
      "signing",
      "invested",
      "exited",
    ]);
  });

  it("the CRMs are still SEPARATE — the word `committed` still means what each ladder says", () => {
    /* R266: comparability, not a merge. All three ladders below CONTAIN
       `committed`, and this wave left every one of them in place, in its own
       position, in its own vocabulary. Nothing was unified. */
    expect((PARTNER_CONTACT_STAGES as readonly string[]).includes("committed")).toBe(true);
    expect((PARTNER_PIPELINE_STAGES as readonly string[]).includes("committed")).toBe(true);
    expect((FOUNDER_CRM_STAGES as readonly string[]).includes("committed")).toBe(true);
    expect(PARTNER_CONTACT_STAGES.indexOf("committed" as never)).toBe(2);
    expect(PARTNER_PIPELINE_STAGES.indexOf("committed" as never)).toBe(5);
    expect(FOUNDER_CRM_STAGES.indexOf("committed" as never)).toBe(4);
  });
});
