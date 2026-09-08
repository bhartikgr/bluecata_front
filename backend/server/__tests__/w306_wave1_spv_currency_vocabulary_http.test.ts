/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 306 · BAND "MONEY & CURRENCY" · WAVE 1 — THE SERVER LEARNS WHAT A
 * CURRENCY IS. THESE TESTS DRIVE THE REAL ROUTE OVER HTTP.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG — AND A PREMISE THIS FILE CORRECTED.
 *   An SPV's `currency` is IMMUTABLE: every commitment, fee, distribution and
 *   tax form for that vehicle is recorded in it forever, and `createSpv`
 *   persisted `data.currency ?? "USD"` with no vocabulary check anywhere.
 *
 *   THERE ARE TWO CREATION ROUTES WHOSE NAMES DIFFER BY ONE LETTER, and they
 *   did NOT behave the same. This was measured here, not assumed:
 *
 *     POST /api/partner/me/spv   (SINGULAR, `server/spvEngineRoutes.ts:1069`)
 *       the canonical wizard route. It validated the money fields, the
 *       jurisdiction, the sign-off and the target company — and had NO currency
 *       check of any kind.
 *
 *     POST /api/partner/me/spvs  (PLURAL, `server/partnerRoutes.ts:2946`)
 *       the legacy route that `client/src/pages/partner/PartnerClientDetail.tsx`
 *       — the "Create SPV for this client" form on a paying client's own record
 *       page — actually posts to. It ALREADY had `isISOCurrency`, which is
 *       SHAPE-ONLY (`/^[A-Z]{3}$/`).
 *
 *   CONSEQUENCE FOR THE LIVE AUDIT REPORT: a read-only audit of capavate.com
 *   v26.44.0 typed `NOTACURRENCY123` into that box and reported it "ACCEPTED
 *   WITH ZERO VALIDATION". §2 below proves that describes the FORM FIELD, not
 *   the creation: the shape check refuses that string, and no vehicle could
 *   have been created from it. The finding is still a real defect — a free-text
 *   box with no feedback that answers an opaque developer-worded 400 — but the
 *   database was never at risk from THAT string, and this file says so rather
 *   than claiming a fix it did not make.
 *
 *   THE REAL HOLE, which §3 proves and this wave closes: a shape check cannot
 *   tell a currency from three upper-case letters. `ZZZ`, `QQQ` and the
 *   WITHDRAWN codes `HRK` and `ZWL` all passed, on both routes.
 *
 * WHAT THIS FILE PROVES, AND HOW IT REFUSES TO CHEAT.
 *   · Every assertion goes over HTTP through `registerRoutes`, against the real
 *     store and the real SQLite database. No stub, no spy, no replica.
 *   · Where a refusal is claimed, the STORED ROWS are read back with `rawDb()`.
 *     A route can answer "not saved" and save. The response body is never the
 *     only evidence.
 *   · §1 IS A CONTROL AND RUNS FIRST. It proves a valid non-USD currency is
 *     still ACCEPTED and stored. A guard that blocks everything is not a fix,
 *     and a suite that only ever asserts refusals cannot tell a working guard
 *     from a broken route.
 *   · §2 asserts the ORPHANED SIGN-OFF is absent. `recordSignoff` runs BEFORE
 *     `createSpv` in the route, so a store-only check would leave a signed
 *     ESIGN/UETA attestation behind for a vehicle that does not exist. This is
 *     the assertion that fails if the check is moved out of the pre-flight —
 *     i.e. it distinguishes the correct fix from a nearly-correct one.
 *   · §5 asserts normalisation on the STORED ROW, not on the value handed in.
 *     Asserting `resolve("eur") === "EUR"` would be a normalising call inside
 *     an equality assertion and would prove nothing about the database.
 *   · §8 pins a KNOWN DIVERGENCE rather than papering over it (see its header).
 *
 * MAIL SAFETY. `server/lib/emailSender.ts` defaults `SMTP_MODE` to `"smtp"` and
 * `work/.env` holds live credentials. §0 asserts both transports are inert and
 * drives one send through to see a `dry_` id. Run with `SMTP_MODE=dry_run` on
 * the command line — import-time demo seeding sends before `beforeAll` runs.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import {
  SPV_CURRENCY_REQUIRED_CODE,
  SPV_CURRENCY_UNKNOWN_CODE,
  SPV_CURRENCY_UNVERIFIABLE_CODE,
  SPV_CURRENCY_REFUSAL_CODES,
  spvCurrencyRefusalCopy,
} from "@shared/currencyDomain";
import { ISO_4217_CURRENCIES } from "../../client/src/lib/currencyOptions";
/* §8 drives the SINK directly — the on-behalf door and the demo seeder reach it
   with no HTTP route and therefore no pre-flight in front of them. */
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_w306_managing";

/** `client/src/lib/queryClient.ts:60-65` DISCARDS any server `message` of 240
 *  characters or more and substitutes a generic one. A headline at or over the
 *  limit therefore never reaches the screen, however well written it is. */
const HEADLINE_MAX_CHARS = 240;

let app: express.Express;
let server: http.Server;

/** POST the LEGACY PLURAL route — the one the client-record door uses. Body
 *  shape copied verbatim from the shipped W277 harness so this file cannot
 *  drift from the payload the product sends. */
function createViaClientRecordDoor(body: Record<string, unknown>) {
  return request(app)
    .post("/api/partner/me/spvs")
    .set("x-user-id", MANAGING)
    .send({
      jurisdiction: "Delaware",
      vintage: 2026,
      status: "open",
      targetSizeMinor: 100_000_000,
      signoffLegalName: "Avi Managing Partner",
      signoffAccepted: true,
      ...body,
    });
}

/** POST the CANONICAL SINGULAR route — the wizard's route, which had no
 *  currency check at all. Different body vocabulary (`name`, `carryBasis`),
 *  which is itself why the two routes drifted apart unnoticed. */
function createViaCanonicalWizardRoute(body: Record<string, unknown>) {
  return request(app)
    .post("/api/partner/me/spv")
    .set("x-user-id", MANAGING)
    .send({
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      signoffLegalName: "Avi Managing Partner",
      signoffAccepted: true,
      ...body,
    });
}

/* ── THE STORED-ROW READERS. Everything below is asserted through these. ──── */

function spvRowsNamed(name: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare("SELECT * FROM spv WHERE name = ? ORDER BY created_at")
    .all(name) as Array<Record<string, unknown>>;
}

/** Sign-offs are recorded BEFORE the vehicle exists and linked afterwards, so
 *  an orphan is a row whose `signer_legal_name` matches this run and whose
 *  `spv_id` names no vehicle. Counting by legal name keeps the query honest
 *  even when `spv_id` is the empty string the route writes first. */
function orphanSignoffCount(): number {
  const r = rawDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM spv_launch_signoffs
        WHERE signer_legal_name = 'Avi Managing Partner'
          AND (spv_id IS NULL OR spv_id = '' OR spv_id NOT IN (SELECT id FROM spv))`,
    )
    .get() as { n?: number } | undefined;
  return Number(r?.n ?? 0);
}

function totalSpvRowCount(): number {
  const r = rawDb().prepare("SELECT COUNT(*) AS n FROM spv").get() as { n?: number } | undefined;
  return Number(r?.n ?? 0);
}

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
    email: "w306.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w306",
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 0 — MAIL IS INERT, AND PROVED INERT RATHER THAN ASSUMED.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §0 — no mail leaves this test run", () => {
  it("both transports report a non-smtp mode and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({
      to: "nobody@capavate.test",
      subject: "W306 inertness probe",
      html: "<p>probe</p>",
    });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 1 — THE CONTROL, AND IT RUNS FIRST, ON BOTH ROUTES.
   ─────────────────────────────────────────────────────────────────────────────
   A guard that refuses everything is not a fix, it is an outage. Before any
   refusal is claimed, prove a real currency is accepted and lands in the
   column — and use a NON-USD one, so the old `?? "USD"` default cannot
   masquerade as a pass.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §1 — CONTROL: a real non-USD currency is accepted and stored", () => {
  it("client-record door: 201, and the STORED ROW carries EUR, not USD", async () => {
    const name = "W306 §1 Control Door3 EUR";
    const r = await createViaClientRecordDoor({ spvName: name, currency: "EUR" });

    /* CONSEQUENCE FIRST: if the guard over-refuses, this prints the body that
       refused a perfectly good currency rather than a bare status. */
    expect(`status=${r.status} body=${JSON.stringify(r.body)}`).toContain("status=201");

    const rows = spvRowsNamed(name);
    expect(rows.length).toBe(1);
    expect(rows[0].currency).toBe("EUR");
    /* The assertion that lets this control distinguish a working guard from
       `?? "USD"` quietly surviving. */
    expect(rows[0].currency).not.toBe("USD");
  });

  it("canonical wizard route: 201, and the STORED ROW carries JPY", async () => {
    const name = "W306 §1 Control Wizard JPY";
    const r = await createViaCanonicalWizardRoute({ name, currency: "JPY" });
    expect(`status=${r.status} body=${JSON.stringify(r.body)}`).toContain("status=201");
    const rows = spvRowsNamed(name);
    expect(rows.length).toBe(1);
    expect(rows[0].currency).toBe("JPY");
    expect(rows[0].currency).not.toBe("USD");
  });

  it("USD itself still works — the common case is not collateral damage", async () => {
    const name = "W306 §1 Control Door3 USD";
    const r = await createViaClientRecordDoor({ spvName: name, currency: "USD" });
    expect(`status=${r.status} body=${JSON.stringify(r.body)}`).toContain("status=201");
    expect(spvRowsNamed(name)[0].currency).toBe("USD");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 2 — THE LIVE AUDIT'S STRING, MEASURED HONESTLY.
   ─────────────────────────────────────────────────────────────────────────────
   The auditor typed `NOTACURRENCY123` and reported it accepted with zero
   validation. It is refused, and it was refused BEFORE this wave, by the
   route's pre-existing shape check. This section asserts what is actually
   true — a refusal and an empty table — and NAMES the pre-existing code doing
   the work rather than letting this wave take credit for it.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §2 — NOTACURRENCY123 never reached the database", () => {
  it("is refused on the client-record door, writes nothing, and leaves no orphaned sign-off", async () => {
    const name = "W306 §2 Refusal Vehicle";
    const spvCountBefore = totalSpvRowCount();
    const orphansBefore = orphanSignoffCount();

    const r = await createViaClientRecordDoor({ spvName: name, currency: "NOTACURRENCY123" });

    /* CONSEQUENCE BEFORE SHAPE. If a guard is absent this prints the row that
       was accepted, so a disarm reports the DEFECT and not a status code. */
    const rows = spvRowsNamed(name);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((x) => ({ currency: x.currency })))}`,
    ).toBe("rows=0 []");
    expect(totalSpvRowCount()).toBe(spvCountBefore);
    expect(orphanSignoffCount()).toBe(orphansBefore);
    expect(r.status).toBe(400);

    /* HONEST ATTRIBUTION. This refusal is the PRE-EXISTING shape check
       (`isISOCurrency`, `server/partnerRoutes.ts:417-419`), not this wave's
       vocabulary check — so the code is the route's own `BAD_REQUEST`. Writing
       `SPV_CURRENCY_UNKNOWN` here would have been a green this wave did not
       earn. The developer-worded message it returns is recorded as a REMAINING
       defect in the wave report; it is not fixed here. */
    expect(String(r.body.error)).toBe("BAD_REQUEST");
  });

  it("but the SAME string IS this wave's refusal on the canonical wizard route, which had nothing", async () => {
    /* The two routes differed, and this is the assertion that proves it. The
       singular route had no currency check at all, so `NOTACURRENCY123` reached
       the store and is now stopped by the vocabulary resolver — with the named
       code and the readable sentence. */
    const name = "W306 §2 Wizard Refusal Vehicle";
    const orphansBefore = orphanSignoffCount();

    const r = await createViaCanonicalWizardRoute({ name, currency: "NOTACURRENCY123" });

    expect(spvRowsNamed(name).length).toBe(0);
    expect(orphanSignoffCount()).toBe(orphansBefore);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:NOTACURRENCY123`);

    /* R77 — NO CODE REACHES A PAYING CLIENT NAKED. Assert the SENTENCE, and
       assert it reads as one rather than merely being non-empty. */
    const message = String(r.body.message ?? "");
    const guidance = String(r.body.guidance ?? "");
    expect(message.length).toBeGreaterThan(20);
    expect(message.length).toBeLessThan(HEADLINE_MAX_CHARS);
    expect(message).not.toContain("SPV_CURRENCY");
    expect(guidance).toContain("ISO 4217");
    expect(guidance).toContain("Nothing has been created or charged");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 3 — THE HOLE THIS WAVE ACTUALLY CLOSES.
   ─────────────────────────────────────────────────────────────────────────────
   A shape check cannot tell a currency from three upper-case letters. Every
   string below passes `/^[A-Z]{3}$/` and would have been written into an
   IMMUTABLE column on BOTH routes before this wave.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §3 — three upper-case letters are not a currency", () => {
  for (const bogus of ["ZZZ", "QQQ"]) {
    it(`${bogus} passes the shape check and is REFUSED by the vocabulary, on the client-record door`, async () => {
      const name = `W306 §3 Bogus ${bogus} Door3`;
      const orphansBefore = orphanSignoffCount();

      const r = await createViaClientRecordDoor({ spvName: name, currency: bogus });

      /* First: it really does pass the shape check, so this test is not
         re-proving §2's pre-existing refusal by accident. */
      expect(/^[A-Z]{3}$/.test(bogus)).toBe(true);

      const rows = spvRowsNamed(name);
      expect(
        `rows=${rows.length} ${JSON.stringify(rows.map((x) => ({ currency: x.currency })))}`,
      ).toBe("rows=0 []");
      /* THE ORPHANED SIGN-OFF. `recordSignoff` is this route's FIRST write and
         runs above `createSpv`; a store-only check would leave a signed
         ESIGN/UETA attestation behind for a vehicle that does not exist. This
         assertion is what distinguishes the correct fix from a nearly-correct
         one, and it fails if the check is moved out of the pre-flight. */
      expect(orphanSignoffCount()).toBe(orphansBefore);

      expect(r.status).toBe(400);
      expect(String(r.body.error)).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:${bogus}`);
      expect(String(r.body.message).length).toBeGreaterThan(20);
      expect(String(r.body.guidance)).toContain("Nothing has been created or charged");
    });
  }

  it("a WITHDRAWN code is refused too — a dead currency cannot denominate a live vehicle", async () => {
    /* HRK (Croatian kuna) was withdrawn when Croatia adopted the euro. It is
       still offered by `client/src/lib/currencyOptions.ts` but is NOT in
       `currency_ref` — see §7, which pins that divergence deliberately. */
    const name = "W306 §3 Withdrawn Code Vehicle";
    const r = await createViaClientRecordDoor({ spvName: name, currency: "HRK" });
    expect(spvRowsNamed(name).length).toBe(0);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:HRK`);
  });

  it("ZWL is refused, and the code that REPLACED it is accepted — the rule is currency, not novelty", async () => {
    const dead = await createViaClientRecordDoor({
      spvName: "W306 §3 ZWL Vehicle",
      currency: "ZWL",
    });
    expect(spvRowsNamed("W306 §3 ZWL Vehicle").length).toBe(0);
    expect(String(dead.body.error)).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:ZWL`);

    /* BOTH SIDES OF THE RULE. A guard that refused every unusual code would
       pass the line above while being useless; ZWG is genuinely in
       `currency_ref` and must still work. */
    const liveName = "W306 §3 ZWG Vehicle";
    const alive = await createViaClientRecordDoor({ spvName: liveName, currency: "ZWG" });
    expect(`status=${alive.status} body=${JSON.stringify(alive.body)}`).toContain("status=201");
    expect(spvRowsNamed(liveName)[0].currency).toBe("ZWG");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 4 — SILENCE IS REFUSED, NOT DEFAULTED.
   ─────────────────────────────────────────────────────────────────────────────
   This is the write default: a lie in the database that survives the screen
   closing. On the canonical wizard route an absent currency reached
   `?? "USD"` and became a permanent, unstated denomination.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §4 — an absent denomination is refused rather than assumed", () => {
  it("canonical wizard route: no currency key at all is a named 400 and writes nothing", async () => {
    const name = "W306 §4 Absent Currency Vehicle";
    const orphansBefore = orphanSignoffCount();

    const r = await createViaCanonicalWizardRoute({ name });

    const rows = spvRowsNamed(name);
    /* THE ASSERTION THAT MATTERS. Under the old code this was one row holding
       `USD` for a vehicle nobody had denominated. */
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((x) => ({ currency: x.currency })))}`,
    ).toBe("rows=0 []");
    expect(orphanSignoffCount()).toBe(orphansBefore);

    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe(SPV_CURRENCY_REQUIRED_CODE);
    expect(String(r.body.guidance)).toContain("will not fall back to US dollars");
  });

  it("whitespace is not a denomination either", async () => {
    const name = "W306 §4 Blank Currency Vehicle";
    const r = await createViaCanonicalWizardRoute({ name, currency: "   " });
    expect(spvRowsNamed(name).length).toBe(0);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe(SPV_CURRENCY_REQUIRED_CODE);
  });

  it("a non-string currency is refused rather than coerced", async () => {
    const name = "W306 §4 Numeric Currency Vehicle";
    const r = await createViaCanonicalWizardRoute({ name, currency: 840 });
    expect(spvRowsNamed(name).length).toBe(0);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toBe(SPV_CURRENCY_REQUIRED_CODE);
  });

  it("a lower-case code is accepted and STORED upper-case — proved on the ROW, not on the input", async () => {
    /* Asserting `resolve("gbp") === "GBP"` would put the normalising call
       inside the equality assertion and prove nothing about the column. The
       claim is about the DATABASE, so the database is what is read.
       The canonical route is used because the legacy route's pre-existing
       shape check requires upper case and would refuse this first. */
    const name = "W306 §4 Lowercase Vehicle";
    const r = await createViaCanonicalWizardRoute({ name, currency: "gbp" });
    expect(`status=${r.status} body=${JSON.stringify(r.body)}`).toContain("status=201");
    const rows = spvRowsNamed(name);
    expect(rows.length).toBe(1);
    expect(rows[0].currency).toBe("GBP");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 5 — THE COPY ITSELF. Three codes, three sentences, all reachable.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §5 — every refusal code has copy a person can read", () => {
  it("the code set is exactly the three this wave defines", () => {
    expect([...SPV_CURRENCY_REFUSAL_CODES].sort()).toEqual(
      [
        SPV_CURRENCY_REQUIRED_CODE,
        SPV_CURRENCY_UNKNOWN_CODE,
        SPV_CURRENCY_UNVERIFIABLE_CODE,
      ].sort(),
    );
    expect(SPV_CURRENCY_REFUSAL_CODES.length).toBe(3);
  });

  it("each code resolves to a headline under the 240-char client limit and a longer guidance", () => {
    const over: string[] = [];
    for (const code of SPV_CURRENCY_REFUSAL_CODES) {
      const copy = spvCurrencyRefusalCopy(code);
      expect(copy).not.toBeNull();
      expect(copy!.headline.length).toBeGreaterThan(20);
      if (copy!.headline.length >= HEADLINE_MAX_CHARS) over.push(code);
      expect(copy!.guidance.length).toBeGreaterThan(copy!.headline.length);
      /* No internal vocabulary in either sentence. */
      expect(copy!.headline).not.toContain("_");
      expect(copy!.guidance).not.toContain("SPV_CURRENCY");
    }
    expect(over).toEqual([]);
  });

  it("UNVERIFIABLE is a retryable 503, NOT a 400 telling a client to fix a correct value", () => {
    expect(spvCurrencyRefusalCopy(SPV_CURRENCY_UNVERIFIABLE_CODE)!.status).toBe(503);
    expect(spvCurrencyRefusalCopy(SPV_CURRENCY_REQUIRED_CODE)!.status).toBe(400);
    expect(spvCurrencyRefusalCopy(SPV_CURRENCY_UNKNOWN_CODE)!.status).toBe(400);
    /* And it says whose fault it is. */
    expect(spvCurrencyRefusalCopy(SPV_CURRENCY_UNVERIFIABLE_CODE)!.guidance).toContain(
      "fault on Capavate's side",
    );
  });

  it("the prefix form resolves to the same copy as the bare code", () => {
    const bare = spvCurrencyRefusalCopy(SPV_CURRENCY_UNKNOWN_CODE);
    const withDetail = spvCurrencyRefusalCopy(`${SPV_CURRENCY_UNKNOWN_CODE}:NOTACURRENCY123`);
    expect(withDetail).toEqual(bare);
    /* Both sides non-empty — a name-set diff of two empty sets is not a proof. */
    expect(bare!.headline.length).toBeGreaterThan(0);
  });

  it("an unrelated code is NOT claimed by this module", () => {
    /* The predicate must be able to say no. A lookup that answers every code
       would make §2's route branch swallow refusals it does not own. */
    expect(spvCurrencyRefusalCopy("SPV_NOT_FOUND")).toBeNull();
    expect(spvCurrencyRefusalCopy("SUBSCRIPTION_CURRENCY_MISMATCH:EUR:USD")).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 6 — THE VOCABULARY IS THE DATABASE'S, AND IT IS REALLY LOADED.
   ─────────────────────────────────────────────────────────────────────────────
   A fence whose installation is unproved is one of this programme's named inert
   mechanisms. If `currency_ref` were empty every one of the refusals above
   would pass for the WRONG REASON, so the table is counted here.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §6 — the currency reference table is present and populated", () => {
  it("holds a substantial number of active codes, including the ones §1 and §4 used", () => {
    const n = (
      rawDb().prepare("SELECT COUNT(*) AS n FROM currency_ref WHERE is_active = 1").get() as {
        n: number;
      }
    ).n;
    expect(n).toBeGreaterThan(100);
    const present = rawDb()
      .prepare("SELECT code FROM currency_ref WHERE code IN ('USD','EUR','GBP') AND is_active = 1")
      .all() as Array<{ code: string }>;
    expect(present.map((x) => x.code).sort()).toEqual(["EUR", "GBP", "USD"]);
    /* And the strings the tests above refused are genuinely absent — otherwise
       §2 would be asserting a refusal the vocabulary never justified. */
    const absent = rawDb()
      .prepare("SELECT COUNT(*) AS n FROM currency_ref WHERE code IN ('NOTACURRENCY123','HRK')")
      .get() as { n: number };
    expect(absent.n).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 7 — A KNOWN, DECLARED DIVERGENCE. PINNED SO IT CANNOT GROW.
   ─────────────────────────────────────────────────────────────────────────────
   `client/src/lib/currencyOptions.ts` offers codes the picker will render;
   `currency_ref` is what the server will now accept. THEY ARE NOT THE SAME SET.
   Two picker options — HRK and ZWL, both WITHDRAWN ISO codes — are not in
   `currency_ref`, so after this wave a GP who picks either from the main wizard
   is refused. Refusing a dead currency for a PERMANENT denomination is correct
   behaviour, and the refusal is a named 400 with a readable sentence rather
   than a silent failure — but it IS a behaviour change on a working screen, so
   it is declared here rather than left to be discovered by a client.

   The shared picker is deliberately NOT edited: it is outside this band's wave
   boundary and the wizard's confirmation block is fingerprinted by the
   silent-drop guard. This test exists so the divergence cannot grow unnoticed.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §7 — the picker/vocabulary divergence is exactly {HRK, ZWL}", () => {
  it("names both directions of the difference, and both sides are non-empty", () => {
    const pickerCodes = new Set(ISO_4217_CURRENCIES.map((c) => c.code));
    const dbCodes = new Set(
      (rawDb().prepare("SELECT code FROM currency_ref WHERE is_active = 1").all() as Array<{
        code: string;
      }>).map((r) => r.code),
    );

    /* BOTH SIDES ASSERTED NON-EMPTY — a diff of two empty sets is not a proof. */
    expect(pickerCodes.size).toBeGreaterThan(100);
    expect(dbCodes.size).toBeGreaterThan(100);

    const pickerOnly = [...pickerCodes].filter((c) => !dbCodes.has(c)).sort();
    const dbOnly = [...dbCodes].filter((c) => !pickerCodes.has(c)).sort();

    /* OFFERED BUT NOT ACCEPTED — the direction that can refuse a real client. */
    expect(pickerOnly).toEqual(["HRK", "ZWL"]);

    /* ACCEPTED BUT NOT OFFERED — harmless (all fund/unit-of-account codes; a
       client cannot pick what the picker does not render) but counted, because
       an uncounted set is how a divergence grows. */
    expect(dbOnly.length).toBe(13);
    expect(dbOnly).toContain("ZWG"); // the code that REPLACED ZWL
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 8 — THE SINK ITSELF, ON THE DOORS THAT HAVE NO ROUTE PRE-FLIGHT.
   ─────────────────────────────────────────────────────────────────────────────
   WHY THIS SECTION EXISTS, honestly stated: the adversarial pass for this wave
   disarmed the store's resolver and only ONE assertion in this file went red.
   That is the signature of a nearly-inert mechanism — the two route pre-flights
   were catching everything first, so the sink's own refusal was almost
   untested. It is NOT redundant, because `createSpv` has callers that pass
   through NO route pre-flight at all:
     · `server/managedFounderStore.ts:905`  createSpvOnBehalf  (the on-behalf door)
     · `server/lib/seedDemoData.ts`          the platform's own demo vehicles
   Those callers are covered here, at the sink, where their only guard lives.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W306 §8 — the sink refuses for callers no route guards", () => {
  it("a bogus currency reaching createSpv directly is REFUSED and writes no row", () => {
    const name = "W306 §8 Direct Sink Bogus";
    const before = totalSpvRowCount();

    /* The sink is called the way `createSpvOnBehalf` calls it — same argument
       shape, same partner, no HTTP and therefore no pre-flight in front of it. */
    let thrown: Error | null = null;
    try {
      spvEngineStore.createSpv(
        TEST_PARTNER_ID,
        { name, jurisdiction: "delaware", carryBasis: "whole_spv", currency: "ZZZ" } as never,
        MANAGING,
      );
    } catch (e) {
      thrown = e as Error;
    }

    /* CONSEQUENCE FIRST — the row, then the throw. A test that only asserted
       the throw could not tell a refusal from a refusal-after-write. */
    const rows = spvRowsNamed(name);
    expect(
      `rows=${rows.length} ${JSON.stringify(rows.map((x) => ({ currency: x.currency })))}`,
    ).toBe("rows=0 []");
    expect(totalSpvRowCount()).toBe(before);
    expect(thrown).not.toBeNull();
    expect(String(thrown?.message)).toBe(`${SPV_CURRENCY_UNKNOWN_CODE}:ZZZ`);
  });

  it("an ABSENT currency reaching createSpv directly is refused, not silently made USD", () => {
    /* This is the exact shape the on-behalf door produced before this wave:
       `currency: data.currency ?? "USD"`. With the default removed the value
       arrives undefined and must be refused rather than invented. */
    const name = "W306 §8 Direct Sink Absent";
    let thrown: Error | null = null;
    try {
      spvEngineStore.createSpv(
        TEST_PARTNER_ID,
        { name, jurisdiction: "delaware", carryBasis: "whole_spv" } as never,
        MANAGING,
      );
    } catch (e) {
      thrown = e as Error;
    }
    expect(spvRowsNamed(name).length).toBe(0);
    expect(String(thrown?.message)).toBe(SPV_CURRENCY_REQUIRED_CODE);
  });

  it("a real currency reaching createSpv directly still succeeds — the sink is not a wall", () => {
    const name = "W306 §8 Direct Sink Control CHF";
    spvEngineStore.createSpv(
      TEST_PARTNER_ID,
      { name, jurisdiction: "delaware", carryBasis: "whole_spv", currency: "CHF" } as never,
      MANAGING,
    );
    const rows = spvRowsNamed(name);
    expect(rows.length).toBe(1);
    expect(rows[0].currency).toBe("CHF");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 9 — DELIBERATELY ABSENT, AND HERE IS WHY.
   ─────────────────────────────────────────────────────────────────────────────
   THE FINDING THIS SECTION WOULD HAVE COVERED IS REAL AND WAS MEASURED IN
   STORED ROWS. The development database holds SIX rows named
   "Keiretsu Canada NovaPay SPV 2026", each with `jurisdiction = canadian_lp`
   and `terms_json.legacyTerms.currency = "CAD"`, beside a source comment
   reading "$250,000 CAD target" — and each storing `currency = 'USD'`.
   `seedDemoData` passed no currency, the sink substituted US dollars, and the
   platform mis-denominated its own Canadian demonstration vehicle. That is the
   write default doing precisely the damage it stands accused of.

   A TEST WAS WRITTEN FOR IT AND THEN WITHDRAWN, on purpose:
     · `seedDemoData` does not run in this harness (`seedTestPartnerSandbox`
       does), so the read returns ZERO rows here.
     · The seeder also SKIPS any name it has already created, so on any database
       that already holds those six rows it will never write again — the fix
       governs NEW databases only, and the six existing rows are left untouched
       exactly as R195.5 requires.
     · Making the test pass would therefore have required either seeding inside
       the test — a test creating the very condition it verifies — or letting it
       succeed over an empty array, an unconditionally-true predicate. Both are
       known inert mechanisms and neither would have proved anything.

   WHAT PROTECTS THE FIX INSTEAD, and it is stronger than a test: `currency` is
   now a REQUIRED field of the seed's tuple type (`currency: string`, not
   optional, no default). A future seed entry that says nothing about
   denomination does not silently get US dollars — it fails `npm run typecheck`.
   The guarantee is enforced by a gate that already runs, rather than by an
   assertion that cannot observe it.
   ───────────────────────────────────────────────────────────────────────────── */
