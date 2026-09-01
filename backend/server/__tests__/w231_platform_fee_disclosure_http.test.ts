/**
 * WAVE 231 — THE DISCLOSURE, OVER THE REAL ROUTE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The pure classifier is exercised exhaustively in
 * `shared/__tests__/w231_platform_fee_disclosure.test.ts`. This file proves the
 * other half, which is the half that can go inert: that the classifier is
 * ACTUALLY WIRED to the screen's data source, over HTTP, through the production
 * registrar `registerSpvEngineRoutes`, against the REAL seeded fee schedule.
 *
 * WHY THAT NEEDS ITS OWN FILE. A perfect classifier nobody calls is one of the
 * nine inert-proof mechanisms — "a fence whose installation is unproved". The
 * seeded platform row is INACTIVE at 0, so the honest expected answer from the
 * live database is `not_set`, and that is asserted against the real store rather
 * than a mock.
 *
 * NOT A REPLICA: `registerSpvEngineRoutes` is the production registrar, the same
 * function `server/index.ts` calls, and the route path is the exact string the
 * wizard's `useQuery` fetches.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  probeFee,
  tryResolveFee,
  ensureSpvFeeScheduleTables,
  SPV_FEE_SCHEDULE_INVALID,
  resolveFee,
} from "../lib/spvFeeScheduleStore";
import { rawDb } from "../db/connection";
import {
  SPV_PLATFORM_FEE_DISCLOSURE_STATES,
  spvPlatformFeeDisclosure,
} from "@shared/spvPlatformFeeDisclosure";

const MANAGING = "u_avi_managing";
const ROUTE = "/api/partner/me/spv-wizard/defaults";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

const get = (path: string, user: string) => request(app).get(path).set("x-user-id", user);

/* ══════════════════════════════════════════════════════════════════════════════
   §1 — THE ROUTE ACTUALLY CARRIES THE DISCLOSURE.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §1 — GET /spv-wizard/defaults discloses the platform fee state", () => {
  it("returns a disclosure with a declared state, a sentence, and NO fabricated figure", async () => {
    const r = await get(ROUTE, MANAGING);
    expect(r.status).toBe(200);

    const d = r.body.platformFeeDisclosure;
    expect(d, "the route did not carry platformFeeDisclosure at all").toBeTruthy();
    expect(SPV_PLATFORM_FEE_DISCLOSURE_STATES).toContain(d.state);
    expect(typeof d.statement).toBe("string");
    expect(d.statement.length).toBeGreaterThan(40);

    /* THE SEEDED REALITY. `sfs_platform_carry_platform` is seeded
       `active = 0, rate_scaled = 0`, so the resolver finds no active row and the
       honest answer is `not_set`. Asserted as an EQUALITY, not a membership, so a
       change in the seed or the resolver surfaces here instead of passing
       silently. */
    expect(d.state).toBe("not_set");
    expect(d.percentDisplay).toBeNull();
    expect(d.statement).toBe(
      "No platform fee layer is currently applied to SPVs you create. " +
        "If Capavate applies one, its exact terms appear on this SPV's Fees tab.",
    );
  });

  it("NEVER states a zero percentage over the wire — the fabricated-0% rule, end to end", async () => {
    const r = await get(ROUTE, MANAGING);
    const d = r.body.platformFeeDisclosure;
    // A percentage token whose value is zero, matched at its boundary. (Plain
    // `includes("0%")` is wrong: it fires inside a legitimate "20%".)
    const zeroPct = [...String(d.statement).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].some((m) =>
      /^0+(\.0+)?$/.test(m[1]),
    );
    expect(zeroPct).toBe(false);
    // In `not_set` there is no percentage at all.
    expect(/\d+\s*%/.test(d.statement)).toBe(false);
    // And no money, either.
    for (const sym of ["$", "€", "£", "¥"]) expect(d.statement.includes(sym)).toBe(false);
    // No machine code leaked into partner-facing copy.
    expect(/[A-Z_]{6,}/.test(d.statement)).toBe(false);
  });

  it("the disclosure is ADDITIVE — every pre-existing key of this payload is intact", async () => {
    const r = await get(ROUTE, MANAGING);
    // The four keys this route returned before Wave 231, with their shapes.
    expect(r.body.gp).toBeTruthy();
    expect(typeof r.body.gp.partnerId).toBe("string");
    expect(Array.isArray(r.body.enums.jurisdictions)).toBe(true);
    expect(Array.isArray(r.body.enums.carryBases)).toBe(true);
    expect(Array.isArray(r.body.enums.distributionScopes)).toBe(true);
    expect(Array.isArray(r.body.enums.spvTypes)).toBe(true);
    expect(r.body.carryBasisHelp).toBeTruthy();
    expect(Array.isArray(r.body.clonableSpvs)).toBe(true);
    // Exactly one key was added.
    expect(Object.keys(r.body).sort()).toEqual(
      ["carryBasisHelp", "clonableSpvs", "enums", "gp", "platformFeeDisclosure"].sort(),
    );
  });

  it("R190.10 — the route is not newly restricted: it still answers for the same caller", async () => {
    const r = await get(ROUTE, MANAGING);
    expect(r.status).toBe(200);
    // Nothing in this wave gates, disables or refuses. The disclosure is
    // information only; there is no 4xx branch introduced anywhere.
    expect(r.body.platformFeeDisclosure.statement).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §2 — THE PROBE EXTENDS THE EXISTING RESOLVER RATHER THAN DUPLICATING IT.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §2 — one resolver, one ladder", () => {
  it("probeFee and tryResolveFee agree on the row, so they cannot drift", () => {
    const probe = probeFee("platform_carry", { partnerId: "ac_consortium_partner_test_partner_inc" });
    const legacy = tryResolveFee("platform_carry", { partnerId: "ac_consortium_partner_test_partner_inc" });
    expect(probe.row).toEqual(legacy);
  });

  it("probeFee distinguishes \"no active row\" from \"could not read\" — the whole point", () => {
    // The seeded platform row is INACTIVE, so the store ANSWERED and found nothing.
    const probe = probeFee("platform_carry", { partnerId: "ac_consortium_partner_test_partner_inc" });
    expect(probe.readable).toBe(true);
    expect(probe.row).toBeNull();
    // A fee code that does not exist is the same shape of answer: readable, absent.
    const nonsense = probeFee("w231_no_such_fee_code_at_all", {});
    expect(nonsense.readable).toBe(true);
    expect(nonsense.row).toBeNull();
  });

  it("no SECOND resolver was built: exactly one SQL ladder over spv_fee_schedule", () => {
    /* Comments are stripped before this conclusion, per the project rule, and the
       stripper is proved below. The content under test here is CODE, not string
       literals, so stripping literals would be safe too — but it is unnecessary
       and would weaken the SELECT count, so literals are preserved and that is
       stated rather than left implicit. */
    const raw = readFileSync(resolve(__dirname, "../lib/spvFeeScheduleStore.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // THE STRIPPER STRIPPED.
    expect(raw.includes("NO FALLBACK. This is the whole point of CP-SPV-16.")).toBe(true);
    expect(code.includes("NO FALLBACK. This is the whole point of CP-SPV-16.")).toBe(false);
    // ...and code survived.
    expect(code.includes("export function resolveFee")).toBe(true);

    /* HOW MANY LADDERS THIS FILE HAS, AND WHO OWNS THEM.

       My first version of this assertion expected ONE ladder and found two. The
       second is PRE-EXISTING and is not a fee resolver: `resolveCloseWindowDays`
       (FE-3, :491-506) walks the same spv → partner → platform scopes to resolve a
       close-window setting, and it predates this wave. Asserting "one ladder"
       would therefore have been a false claim about the file, so the assertion is
       written as the claim I can actually defend: there are exactly TWO ladders,
       both named below, and WAVE 231 ADDED NEITHER. */
    expect([...code.matchAll(/const ladder\s*:/g)].length).toBe(2);
    expect([...code.matchAll(/ladder\.push\(/g)].length).toBe(6); // 3 scopes × 2 owners
    /* Attribute each ladder to its ENCLOSING function by scanning BACKWARDS to the
       nearest preceding `export function`. A forward regex got this wrong — it
       matched `computeFeeMinor`, an earlier exported function that happens to sit
       within its window — which is the same class of error as a greedy-match trap.
       Scanning backwards cannot pick a function that the ladder is not inside. */
    const owners = [...code.matchAll(/const ladder\s*:/g)].map((m) => {
      const before = code.slice(0, m.index!);
      const decls = [...before.matchAll(/export function (\w+)/g)];
      return decls[decls.length - 1][1];
    });
    expect(owners).toEqual(["resolveFee", "resolveCloseWindowDays"]);
    // Neither of the two functions this wave touched builds one.
    expect(code.slice(code.indexOf("export function probeFee")).indexOf("const ladder")).toBeGreaterThan(
      code.slice(code.indexOf("export function probeFee")).indexOf("export function resolveCloseWindowDays"),
    );
    // probeFee delegates; it contains no SELECT of its own.
    const probeBody = code.slice(code.indexOf("export function probeFee"), code.indexOf("export function tryResolveFee"));
    expect(probeBody.includes("resolveFee(")).toBe(true);
    expect(probeBody.toUpperCase().includes("SELECT")).toBe(false);
    expect(probeBody.includes("prepare(")).toBe(false);
    // tryResolveFee is now a view over probeFee, not a parallel implementation.
    const tryBody = code.slice(code.indexOf("export function tryResolveFee"), code.indexOf("export function listFeeSchedules"));
    /* `tryResolveFee` is now a one-line view over the probe. It must contain the
       delegation and NOTHING else — no ladder, no SQL, no second `resolveFee` call.
       (An earlier draft of this test also asserted `tryBody.includes("resolveFee(")`
       with a comment claiming it matched as a substring of `probeFee`. It does not:
       "probeFee(" contains no "resolveFee(". The assertion was simply false and is
       removed rather than weakened.) */
    expect(tryBody.includes("probeFee(")).toBe(true);
    expect(tryBody.includes("return probeFee(feeCode, scope).row;")).toBe(true);
    expect(tryBody.toUpperCase().includes("SELECT")).toBe(false);
    expect(tryBody.includes("const ladder")).toBe(false);
    expect(tryBody.includes("prepare(")).toBe(false);
  });

  /* ════════════════════════════════════════════════════════════════════════════
     THE GREEN DISARM THAT PRODUCED THIS TEST.

     Disarm D4 changed `probeFee`'s catch branch from `readable: false` to
     `readable: true` — collapsing "the store could not be read" into "the store
     answered and no fee applies", which is exactly the failure this wave exists to
     prevent: a database outage silently becoming the price representation "no
     platform fee applies" at the moment a partner agrees to terms.

     BOTH SUITES STAYED GREEN. 14/14, rc=0.

     WHY. The classifier suite proves that GIVEN `readable: false` the disclosure
     refuses to claim either way — but it supplies that flag itself. Nothing
     anywhere proved that `probeFee` ACTUALLY SETS the flag to false when the store
     fails. The reader was fenced; the WRITER was not. That is the inert-proof
     mechanism "a filter keyed to a field the writer never writes", and the whole
     `unreadable` state was decorative.

     HOW I DROVE IT, AND WHAT I FOUND ON THE WAY. My first attempt inserted a
     shape-invalid row to trigger `SPV_FEE_SCHEDULE_INVALID`. It cannot be done:
     the SQLite DDL (:204-208) mirrors EVERY one of `toRow`'s INVALID conditions as
     a table CHECK — the scale equality, the fixed/rate coherence, the platform
     scope pairing. **Under the SQLite backend the INVALID branch is unreachable**,
     and `toRow`'s re-validation is defence-in-depth for a Postgres backend or a
     hand-edited row, exactly as its own comment says. That is reported, not
     worked around.

     So this test drives the branch that IS reachable: `UNAVAILABLE`. The table is
     renamed away, so the production `db.prepare(SELECT ...)` inside the real
     `resolveFee` throws, `resolveFee` maps it to `SPV_FEE_SCHEDULE_UNAVAILABLE`,
     and `probeFee`'s catch must report `readable: false`. The rename is reversed in
     a `finally` and the reversal is asserted. No row is created, altered, deleted
     or invalidated — the sixteen live vehicles are untouched by construction,
     because nothing here writes a row at all.
     ════════════════════════════════════════════════════════════════════════════ */

  it("THE INVALID BRANCH IS UNREACHABLE UNDER SQLITE — the DDL enforces every rule toRow does", () => {
    /* Stated as a test so the claim in the report is checkable, and so that if a
       future migration RELAXES one of these CHECKs this fails and someone has to
       decide about it deliberately. */
    const ddl = readFileSync(resolve(__dirname, "../lib/spvFeeScheduleStore.ts"), "utf8");
    expect(ddl.includes("CHECK (scale = 1000000000)")).toBe(true);
    expect(
      ddl.includes("CHECK ((basis = 'fixed'  AND fixed_amount_minor IS NOT NULL AND rate_scaled IS NULL)"),
    ).toBe(true);
    expect(ddl.includes("OR (basis <> 'fixed' AND rate_scaled IS NOT NULL AND fixed_amount_minor IS NULL))")).toBe(true);

    // And the runtime re-check is still there, for the backends the DDL does not cover.
    expect(ddl.includes("if (scale !== CARRY_FRACTION_SCALE) throw new Error(SPV_FEE_SCHEDULE_INVALID);")).toBe(true);
    expect(SPV_FEE_SCHEDULE_INVALID).toBe("SPV_FEE_SCHEDULE_INVALID");
  });

  it("probeFee reports readable=FALSE when the store cannot be read at all", () => {
    expect(ensureSpvFeeScheduleTables()).toBe(true);
    const db = rawDb();

    // BASELINE, so the assertions below cannot pass for an unrelated reason.
    expect(probeFee("platform_carry", {}).readable).toBe(true);

    db.exec(`ALTER TABLE spv_fee_schedule RENAME TO spv_fee_schedule_w231_tmp`);
    try {
      // The REAL resolver now fails on the REAL prepared statement.
      expect(() => resolveFee("platform_carry", {})).toThrow("SPV_FEE_SCHEDULE_UNAVAILABLE");

      // THE ASSERTION D4 SHOULD HAVE FAILED ON.
      const probe = probeFee("platform_carry", {});
      expect(probe.readable).toBe(false);
      expect(probe.row).toBeNull();

      // The disclosure built from it REFUSES to claim there is no fee.
      const d = spvPlatformFeeDisclosure({ row: null, readable: probe.readable });
      expect(d.state).toBe("unreadable");
      expect(d.percentDisplay).toBeNull();
      expect(d.statement.includes("could not be read")).toBe(true);
      expect(d.statement).not.toBe(
        spvPlatformFeeDisclosure({ row: null, readable: true }).statement,
      );

      // `tryResolveFee` collapses this to the SAME null as "no fee set" — which is
      // precisely why the wizard uses the probe and not this function.
      expect(tryResolveFee("platform_carry", {})).toBeNull();
    } finally {
      db.exec(`ALTER TABLE spv_fee_schedule_w231_tmp RENAME TO spv_fee_schedule`);
    }

    // REVERSED, and proved reversed — the store reads again and the seeded row is
    // exactly as it was.
    expect(probeFee("platform_carry", {}).readable).toBe(true);
  });

  it("the seeded platform row is UNTOUCHED by the test above (R195.5)", () => {
    const row = rawDb()
      .prepare(`SELECT active, rate_scaled, scale FROM spv_fee_schedule WHERE id = ?`)
      .get("sfs_platform_carry_platform") as Record<string, unknown> | undefined;
    expect(row).toBeTruthy();
    expect(row!.active).toBe(0);          // still seeded INACTIVE
    expect(row!.rate_scaled).toBe(0);     // still zero
    expect(row!.scale).toBe(1000000000);  // still the canonical scale
  });

  it("computeFeeMinor is NOT called on the disclosure path — no pricing without a base", () => {
    const raw = readFileSync(resolve(__dirname, "../spvEngineRoutes.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(raw.includes("computeFeeMinor")).toBe(true); // it is discussed in a comment
    const fn = code.slice(
      code.indexOf("function wizardPlatformFeeDisclosure"),
      code.indexOf("export function registerSpvEngineRoutes"),
    );
    expect(fn.length).toBeGreaterThan(100);
    expect(fn.includes("computeFeeMinor")).toBe(false);
    // It reads the schedule row's rate fields and nothing else.
    expect(fn.includes("probeFee(")).toBe(true);
    expect(fn.includes("spvPlatformFeeDisclosure(")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   §3 — THE WIZARD RENDERS IT, AND THE WITHHELD-PRICE SENTENCE IS STILL THERE.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W231 §3 — the wizard is wired, and nothing was deleted", () => {
  /* The wizard page needs a router, a session and a large bundle to mount, and
     the step-3 form is not exported, so this pins the WIRING by reading the mount
     site's source text — the same documented technique
     `client/src/lib/__tests__/w226_attestation_rendered.test.tsx` uses for this
     page family, and for the same reason. The RULE itself is proved by mounted
     behaviour in the classifier suite and over HTTP above; this section proves
     only that the page consumes the key and that no copy was removed. */
  const WIZ = readFileSync(
    resolve(__dirname, "../../client/src/pages/partner/PartnerSpvEngine.tsx"),
    "utf8",
  );

  it("the wizard consumes platformFeeDisclosure and renders its statement", () => {
    expect(WIZ.includes("platformFeeDisclosure")).toBe(true);
    expect(WIZ.includes('data-testid="spv-w-platform-fee-disclosure"')).toBe(true);
    expect(WIZ.includes("wizardDefaults.data.platformFeeDisclosure.statement")).toBe(true);
  });

  it("R195.5 — the ORIGINAL note is still present, word for word", () => {
    /* It is not deleted and not edited. Both sentences are true; what they omitted
       is now supplied by the sibling. Byte-exact, apostrophe included. */
    expect(
      WIZ.includes(
        "The platform fee layer is set by Capavate and is read-only to you. " +
          "Its exact percentage is shown on this SPV's Fees tab once applied.",
      ),
    ).toBe(true);
    expect(WIZ.includes('data-testid="spv-w-platform-fee-note"')).toBe(true);
  });

  it("R221.6 — every protected string in THIS file is still byte-identical", () => {
    /* The two halves of the target-raise caption are separate JSX text nodes, not
       one literal — my first attempt asserted the concatenation and failed. Each is
       asserted as it actually appears in the source. */
    for (const s of [
      "Target raise — not the amount committed",
      "fundraising goal, not a limit",
      // and the sentence this wave supplements rather than replaces
      "The platform fee layer is set by Capavate and is read-only to you.",
      "Its exact percentage is shown on this SPV's Fees tab once applied.",
    ]) {
      expect(WIZ.includes(s), `protected copy changed or removed: ${s}`).toBe(true);
    }
    // Their testids are intact too, so they are still reachable on screen.
    expect(WIZ.includes("spv-target-raise-caption-")).toBe(true);
    expect(WIZ.includes("spv-target-raise-goal-")).toBe(true);
  });

  it("APPENDED LAST — the new sibling follows spv-w-fee-error, not preceding it", () => {
    /* Order matters to the silent-drop guard: an insertion renumbers every later
       sibling and reads as a mass removal. */
    const iErr = WIZ.indexOf('data-testid="spv-w-fee-error"');
    const iNew = WIZ.indexOf('data-testid="spv-w-platform-fee-disclosure"');
    const iNote = WIZ.indexOf('data-testid="spv-w-platform-fee-note"');
    expect(iErr).toBeGreaterThan(0);
    expect(iNew).toBeGreaterThan(iErr);
    expect(iErr).toBeGreaterThan(iNote);
  });

  it("NO percentage, price, currency or exponent literal was added to the wizard JSX", () => {
    const iNew = WIZ.indexOf('data-testid="spv-w-platform-fee-disclosure"');
    const block = WIZ.slice(iNew - 200, iNew + 400);
    for (const bad of ["%", "$", "€", "£", "¥", "USD", "toFixed", "* 100", "/ 100"]) {
      expect(block.includes(bad), `the new JSX contains ${bad}`).toBe(false);
    }
  });

  it("NO event handler was added, edited or removed by this wave (R143.1)", () => {
    const iNew = WIZ.indexOf('data-testid="spv-w-platform-fee-disclosure"');
    const block = WIZ.slice(iNew - 200, iNew + 400);
    for (const h of ["onClick", "onChange", "onBlur", "onSubmit", "onInput"]) {
      expect(block.includes(h), `the new JSX contains ${h}`).toBe(false);
    }
  });

  it("NEGATIVE CONTROL — these source assertions can fail", () => {
    expect(WIZ.includes("spv-w-platform-fee-disclosure-that-does-not-exist")).toBe(false);
    expect(WIZ.includes("wizardDefaults")).toBe(true);
  });
});
