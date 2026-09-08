/**
 * WAVE 344 · ITEM 3 — EXPRESS CONSENT FOR MARKETING EMAIL.
 *
 * ── WHAT THE OWNER ASKED FOR, AND WHY IT IS NOT WHAT WAS BUILT ─────────────
 * "Include express consent during signup… Users should also be able to change
 * their choice in their settings area. I want this to be easy, seamless, and
 * have users want to consent without any burden."
 *
 * THE SEAMLESS VERSION IS THE INVALID ONE. The Canadian regulator names the
 * pre-ticked box explicitly: "express consent cannot be obtained through
 * opt-out consent mechanisms" (CRTC Compliance and Enforcement Information
 * Bulletin 2012-548 ¶18), and the request itself must carry the purposes, the
 * identity of who is asking, a MAILING ADDRESS and a withdrawal statement
 * (¶16). So what was built is the version that is easy to UNDERSTAND and easy to
 * DECLINE, and this file proves the four things that make it defensible:
 *
 *   1. SIGNUP SUCCEEDS WITHOUT IT — structurally, not as a promise.
 *   2. THE STORED RECORD CARRIES THE EXACT WORDING SHOWN. A bare boolean is not
 *      a consent record.
 *   3. SERVICE MESSAGES ARE NEVER GATED BEHIND IT. Withdrawing marketing must
 *      never stop somebody's security email.
 *   4. WITHDRAWAL IS AS EASY AS GIVING, and never erases the history.
 *
 * ── THE CONTROLS COME FIRST ────────────────────────────────────────────────
 * Every database assertion has a `rows > 0` precondition, and the product and
 * this file are proven to hold the SAME database before anything is measured —
 * by writing through a shipped HTTP route and reading the row back through
 * `rawDb()`. (This suite runs against the project's deliberately isolated test
 * database; see `vitest.config.ts`. The guarded defect is asserting against an
 * EMPTY database, not the file name.)
 *
 * ── ONE THING THIS FILE HAS TO SET UP ITSELF, STATED PLAINLY ───────────────
 * The feature is INERT until the owner supplies a mailing address, because there
 * is no address anywhere in this codebase and inventing one would produce consent
 * records that look valid and are not. So this file sets
 * `MARKETING_CONSENT_MAILING_ADDRESS` to a clearly-marked test value before
 * `registerRoutes`, and §1 asserts the INERT behaviour explicitly with the
 * variable removed. Both states are proven; neither is assumed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const TEST_ADDRESS = "W344 Test Address, 1 Example Street, Toronto ON M5V 0A1, Canada";
const TEST_IDENTITY = "Capavate (W344 test)";
process.env.MARKETING_CONSENT_MAILING_ADDRESS = TEST_ADDRESS;
process.env.MARKETING_CONSENT_REQUESTER_IDENTITY = TEST_IDENTITY;

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";

import {
  MARKETING_CONSENT_MIGRATION,
  MARKETING_CONSENT_SQL,
  MARKETING_CONSENT_TABLE,
  CONSENT_KINDS,
  CONSENT_DECISIONS,
  MARKETING_CONSENT_KIND,
  isNeverConsentGated,
} from "../lib/marketingConsentSchema";
import {
  CONSENT_WRITE_TABLES,
  DISCLOSURE_VERSION,
  buildDisclosure,
  consentTenantForUser,
  mayReceiveServiceMessage,
} from "../marketingConsentStore";

const REPO = path.resolve(__dirname, "..", "..");

/**
 * SOURCE WITH EVERY COMMENT REMOVED.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL: this programme has repeatedly found
 * measurements that counted a COMMENT as the thing being measured. The files
 * under test here are heavily commented, and several of those comments quote the
 * very identifiers these assertions search for — `defaultChecked`, "marketing" —
 * in order to explain that they are deliberately ABSENT. Searching raw source
 * would therefore find the explanation and report the defect. Every source-shaped
 * assertion below reads this stripped form instead.
 */
function codeOnly(file: string): string {
  const src = fs.readFileSync(file, "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, including JSDoc
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ") // line comments, sparing `https://`
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " "); // JSX comments
}

let app: Express;
let server: http.Server;
let userId = "";
const EMAIL = "w344.consent@example.test";

function rowsFor(uid: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(
      `SELECT * FROM ${MARKETING_CONSENT_TABLE} WHERE user_id = ? ORDER BY decided_at ASC, rowid ASC`,
    )
    .all(uid) as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

/* ══════════════════════════════════════════════════════════════════════════
   0 — SIGNUP SUCCEEDS WITHOUT MARKETING CONSENT. STRUCTURALLY.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · signing up does not depend on marketing consent in any way", () => {
  it("SIGNUP SUCCEEDS with NO consent field in the request at all", async () => {
    _resetRateLimitsForTests();
    const r = await request(app)
      .post("/api/auth/signup")
      .send({ email: EMAIL, name: "W344 Consent Person", password: "w344-consent-pw" });
    // Not "succeeds when consent is false" — succeeds when the concept is ABSENT
    // from the request, which is the only version that cannot be bundled later.
    expect(r.status).toBe(200);
    userId = String(r.body?.ctx?.userId ?? "");
    expect(userId).not.toBe("");
  }, 120_000);

  it("CONTROL: the PRODUCT and this TEST hold the SAME database — read back through rawDb()", () => {
    // The account just created over HTTP is readable here. If the app and this
    // file were on different databases every assertion below would be measuring
    // nothing, which is the zero-rows incident this programme was bitten by.
    const u = rawDb()
      .prepare(`SELECT id, email FROM users WHERE id = ?`)
      .get(userId) as { id?: string; email?: string } | undefined;
    expect(u?.id).toBe(userId);
  });

  it("AND NOTHING WAS STORED for a person who was not asked and did not tick — rows === 0", async () => {
    /* The consent table is installed LAZILY by the shipped code path (as it must
       be — server/db/connection.ts is frozen). Reading the person's own consent
       state through the SHIPPED route is what installs it, so the assertion below
       runs against a table that exists and genuinely holds no row for them,
       rather than against a missing table. */
    const warm = await request(app).get("/api/consent/marketing").set("x-user-id", userId);
    expect(warm.status).toBe(200);
    expect(warm.body?.checked).toBe(false);
    expect(warm.body?.decision).toBeNull();

    // "Never decided" must stay a different fact from "decided no". A row written
    // for somebody who never answered would be a fabricated consent record.
    expect(rowsFor(userId).length).toBe(0);
  });

  it("the signup handler contains NO marketing-consent reference, so it CANNOT be gated on one", () => {
    /* THE STRUCTURAL PROOF, not a behavioural sample. `POST /api/auth/signup`
       cannot come to depend on marketing consent while nothing in its module
       mentions it. This is a fence: if a future change bundles consent into
       signup, this goes red and names the reason. */
    const file = path.join(REPO, "server", "lib", "authRoutes.ts");
    expect(fs.existsSync(file)).toBe(true); // precondition: the module is real
    const src = codeOnly(file);
    const handlerStart = src.indexOf('app.post("/api/auth/signup"');
    // PRECONDITION: the handler was actually FOUND. Without this the window below
    // would be the whole file sliced from -1 and the assertion would be vacuous.
    expect(handlerStart).toBeGreaterThan(0);
    // A generous window around the handler — far larger than the handler itself.
    const window = src.slice(handlerStart, handlerStart + 20000);
    expect(window).not.toContain("marketingConsent");
    expect(window).not.toContain("marketing_consent");
    expect(window).not.toContain("consent_kind");
  });

  it("CONTROL: the mail transport is inert, so this file cannot send real mail", () => {
    expect(getConfig().mode).toBe("dry_run");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — THE MIGRATION AND THE CLOSED SETS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · the migration has three homes and they agree byte for byte", () => {
  it("migrations/ and server/db/migrations/ and the embedded installer are the SAME BYTES", () => {
    const a = fs.readFileSync(path.join(REPO, "migrations", MARKETING_CONSENT_MIGRATION), "utf8");
    const b = fs.readFileSync(
      path.join(REPO, "server", "db", "migrations", MARKETING_CONSENT_MIGRATION),
      "utf8",
    );
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toBe(a);
    expect(MARKETING_CONSENT_SQL).toBe(a);
  });

  it("there is EXACTLY ONE consent kind === 1, and it is marketing", () => {
    // A closed set of one. This is what stops a future "service notifications"
    // kind being added to the same permission machinery, which is the mechanism
    // by which withdrawing marketing would silence a security email.
    expect(CONSENT_KINDS.length).toBe(1);
    expect(CONSENT_KINDS[0]).toBe(MARKETING_CONSENT_KIND);
    expect(MARKETING_CONSENT_KIND).toBe("commercial_electronic_message");
  });

  it("the consent record writes to EXACTLY ONE table === 1", () => {
    expect(CONSENT_WRITE_TABLES.length).toBe(1);
    expect(CONSENT_WRITE_TABLES[0]).toBe(MARKETING_CONSENT_TABLE);
  });

  it("there are three possible decisions and 'withdrawn' is one of them", () => {
    expect(CONSENT_DECISIONS.length).toBe(3);
    expect([...CONSENT_DECISIONS].sort()).toEqual(["declined", "granted", "withdrawn"]);
  });

  it("the consent record does NOT live in the hash-anchored terms-acceptance table", () => {
    // `legal_consents` is terms acceptance, is hash-anchored, and carries a
    // `deleted_at`. Putting marketing permission there would bundle it with terms
    // acceptance, which is precisely what the regulator forbids.
    expect(MARKETING_CONSENT_TABLE).not.toBe("legal_consents");
    expect(CONSENT_WRITE_TABLES).not.toContain("legal_consents");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THE REQUEST CARRIES WHAT IT MUST, AND IS INERT WITHOUT AN ADDRESS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · the request itself carries the purposes, the identity, an address and the withdrawal", () => {
  it("the wording served to the screen contains ALL FOUR required limbs", async () => {
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.status).toBe(200);
    expect(r.body?.available).toBe(true);
    const d = r.body?.disclosure;
    expect(d).toBeTruthy();
    // Each limb asserted in the RENDERED WORDING, not as a separate field the
    // screen might not show.
    expect(String(d.text)).toContain(TEST_IDENTITY); // who is asking
    expect(String(d.text)).toContain(TEST_ADDRESS); // the mailing address
    expect(String(d.text)).toContain(String(d.purposes)); // the purposes
    expect(String(d.text)).toContain(String(d.withdrawalStatement)); // withdrawal
    expect(String(d.text).length).toBeGreaterThan(200);
  }, 60_000);

  it("the PUBLIC request endpoint returns NO personal state — it has no person", async () => {
    // It has to be readable on the signup form, where nobody is signed in. So it
    // must not be able to leak or invent anybody's answer.
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.body?.checked).toBe(false);
    expect(r.body?.decision).toBeNull();
    expect(r.body?.decidedAt).toBeNull();
  }, 60_000);

  it("INERT WITHOUT AN ADDRESS: with the variable removed nothing is asked and nothing is stored", () => {
    /* Proven by removing the variable and reading the shipped builder, then
       putting it back. Until the owner supplies an address the box does not
       render, the endpoint refuses, and no consent is collected — and signing up
       is unaffected either way. */
    const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
    try {
      delete process.env.MARKETING_CONSENT_MAILING_ADDRESS;
      const avail = buildDisclosure();
      expect(avail.available).toBe(false);
      expect(avail.disclosure).toBeUndefined();
      // And it SAYS WHY, in plain words, rather than going quietly missing.
      expect(String(avail.reason ?? "")).toContain("postal address");
    } finally {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
    }
    // CONTROL: it is available again, so the test above proved a real switch and
    // not a permanently-off feature.
    expect(buildDisclosure().available).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — THE STORED RECORD CARRIES THE EXACT WORDING SHOWN.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · what is stored is what was shown, word for word", () => {
  let shownText = "";

  it("GRANTING stores a row, and its disclosure_text is BYTE-IDENTICAL to the wording served", async () => {
    const served = await request(app).get("/api/consent/marketing-request");
    shownText = String(served.body?.disclosure?.text ?? "");
    expect(shownText.length).toBeGreaterThan(200);

    _resetRateLimitsForTests();
    const r = await request(app)
      .post("/api/consent/marketing")
      .set("x-user-id", userId)
      .send({ decision: "granted", channel: "signup", disclosureVersion: DISCLOSURE_VERSION });
    expect(r.status).toBe(200);
    expect(r.body?.checked).toBe(true);

    const rows = rowsFor(userId);
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    const row = rows[rows.length - 1];
    // THE ASSERTION THE WHOLE ITEM TURNS ON. Not "a consent flag is true" — the
    // exact sentence the person was shown is on the row.
    expect(String(row.disclosure_text)).toBe(shownText);
    expect(String(row.requester_mailing_address)).toBe(TEST_ADDRESS);
    expect(String(row.requester_identity)).toBe(TEST_IDENTITY);
    expect(String(row.withdrawal_statement).length).toBeGreaterThan(20);
    expect(String(row.purposes_text).length).toBeGreaterThan(10);
    expect(String(row.disclosure_version)).toBe(DISCLOSURE_VERSION);
    expect(String(row.consent_kind)).toBe(MARKETING_CONSENT_KIND);
    expect(String(row.decision)).toBe("granted");
    expect(String(row.channel)).toBe("signup");
    expect(String(row.decided_at).length).toBeGreaterThan(10);
    // WHAT, WHEN, AND THE EXACT WORDING — all three, on one row.
    expect(String(row.tenant_id)).toBe(consentTenantForUser(userId));
  }, 120_000);

  it("A BARE BOOLEAN IS REFUSED BY THE DATABASE ITSELF", () => {
    // Not by application code a future caller could route around: the migration
    // requires the wording, the address inside the wording, and the withdrawal
    // statement inside the wording.
    const attempt = () =>
      rawDb()
        .prepare(
          `INSERT INTO ${MARKETING_CONSENT_TABLE}
             (id, tenant_id, user_id, consent_kind, decision, decided_at, channel,
              disclosure_version, disclosure_text, purposes_text, requester_identity,
              requester_mailing_address, withdrawal_statement)
           VALUES ('mce_w344_bare', 'tenant_user_x', 'u_x', ?, 'granted', ?, 'settings',
                   'v1', 'yes', 'p', 'i', 'a', 'w')`,
        )
        .run(MARKETING_CONSENT_KIND, new Date().toISOString());
    expect(attempt).toThrow();
  });

  it("WORDING WITHOUT THE MAILING ADDRESS IN IT is refused by the database itself", () => {
    const long =
      "We would like to send you news and product updates. This is optional and you can " +
      "change your mind whenever you like without affecting your account in any way at all.";
    const attempt = () =>
      rawDb()
        .prepare(
          `INSERT INTO ${MARKETING_CONSENT_TABLE}
             (id, tenant_id, user_id, consent_kind, decision, decided_at, channel,
              disclosure_version, disclosure_text, purposes_text, requester_identity,
              requester_mailing_address, withdrawal_statement)
           VALUES ('mce_w344_noaddr', 'tenant_user_x', 'u_x', ?, 'granted', ?, 'settings',
                   'v1', ?, 'p', 'i', ?, 'change your mind')`,
        )
        .run(MARKETING_CONSENT_KIND, new Date().toISOString(), long, TEST_ADDRESS);
    expect(attempt).toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 — WITHDRAWAL IS AS EASY AS GIVING, AND ERASES NOTHING.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · withdrawal takes the same single step and keeps the history", () => {
  it("WITHDRAWING uses the SAME endpoint and the SAME one field as granting", async () => {
    // "As easy as giving it" made literal: one request, one field, no extra
    // confirmation step, no different endpoint to find.
    const before = rowsFor(userId).length;
    expect(before).toBeGreaterThan(0); // rows > 0 precondition

    _resetRateLimitsForTests();
    const r = await request(app)
      .post("/api/consent/marketing")
      .set("x-user-id", userId)
      .send({ decision: "withdrawn", channel: "settings", disclosureVersion: DISCLOSURE_VERSION });
    expect(r.status).toBe(200);
    expect(r.body?.checked).toBe(false);

    const after = rowsFor(userId);
    // A NEW ROW, not an edit. The grant is still on the record.
    expect(after.length).toBe(before + 1);
    expect(String(after[after.length - 1].decision)).toBe("withdrawn");
    expect(after.some((x) => String(x.decision) === "granted")).toBe(true);
  }, 120_000);

  it("the record is APPEND-ONLY: the database refuses to update or delete a consent row", () => {
    const rows = rowsFor(userId);
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    const id = String(rows[0].id);

    const update = () =>
      rawDb()
        .prepare(`UPDATE ${MARKETING_CONSENT_TABLE} SET decision = 'granted' WHERE id = ?`)
        .run(id);
    expect(update).toThrow();

    const del = () =>
      rawDb().prepare(`DELETE FROM ${MARKETING_CONSENT_TABLE} WHERE id = ?`).run(id);
    expect(del).toThrow();

    // Nothing moved.
    expect(rowsFor(userId).length).toBe(rows.length);
  });

  it("the CURRENT state reads as the LATEST decision, not the first one", async () => {
    const r = await request(app).get("/api/consent/marketing").set("x-user-id", userId);
    expect(r.status).toBe(200);
    expect(r.body?.checked).toBe(false);
    expect(r.body?.decision).toBe("withdrawn");
  }, 60_000);

  it("GRANTING AGAIN works and is again a new row — the choice is not one-way", async () => {
    const before = rowsFor(userId).length;
    expect(before).toBeGreaterThan(0); // rows > 0 precondition
    _resetRateLimitsForTests();
    const r = await request(app)
      .post("/api/consent/marketing")
      .set("x-user-id", userId)
      .send({ decision: "granted", channel: "settings", disclosureVersion: DISCLOSURE_VERSION });
    expect(r.status).toBe(200);
    expect(r.body?.checked).toBe(true);
    expect(rowsFor(userId).length).toBe(before + 1);
  }, 120_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   5 — SERVICE MESSAGES ARE NEVER GATED BEHIND MARKETING CONSENT.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · withdrawing marketing can never stop a service or security message", () => {
  it("the service-message check takes NO ARGUMENTS and can only return true", () => {
    /* THE SAFE RULE, BUILT RATHER THAN RELIED ON. The research rated the
       statutory service-notification exemption MEDIUM, not HIGH, because the
       statutory text could not be retrieved. So the platform does not lean on a
       broad exemption: it makes gating a service message IMPOSSIBLE TO EXPRESS.
       The function cannot consult a consent row because it cannot be told who to
       consult one for. */
    expect(mayReceiveServiceMessage.length).toBe(0);
    expect(mayReceiveServiceMessage()).toBe(true);
  });

  it("the DATABASE refuses to store a service, security, transactional or platform consent kind", () => {
    for (const kind of [
      "service_notification",
      "security_alert",
      "transactional_receipt",
      "platform_notification",
    ]) {
      // The predicate agrees...
      expect(isNeverConsentGated(kind)).toBe(true);
      // ...and so does the storage layer, which is what actually forecloses it.
      const attempt = () =>
        rawDb()
          .prepare(
            `INSERT INTO ${MARKETING_CONSENT_TABLE}
               (id, tenant_id, user_id, consent_kind, decision, decided_at, channel,
                disclosure_version, disclosure_text, purposes_text, requester_identity,
                requester_mailing_address, withdrawal_statement)
             VALUES (?, 'tenant_user_x', 'u_x', ?, 'granted', ?, 'settings',
                     'v1', ?, 'p', 'i', ?, ?)`,
          )
          .run(
            `mce_w344_${kind}`,
            kind,
            new Date().toISOString(),
            buildDisclosure().disclosure?.text ?? "",
            TEST_ADDRESS,
            buildDisclosure().disclosure?.withdrawalStatement ?? "",
          );
      expect(attempt).toThrow();
    }
  });

  it("CONTROL: the marketing kind is NOT treated as never-gateable — so the predicate discriminates", () => {
    expect(isNeverConsentGated(MARKETING_CONSENT_KIND)).toBe(false);
  });

  it("NOTHING IN THE TREE GATES A MESSAGE ON MARKETING CONSENT — the consumers are counted, and there are 0", () => {
    /* COUNTED HERE, NOT TRUSTED. `marketingConsentAllows` is the only function
       that can answer "may we market to this person". If any email, notification
       or messaging module ever imports it, that module has become capable of
       withholding a message based on marketing permission — and the moment that
       module also carries a service message, withdrawing marketing stops a
       security email.

       The count is currently ZERO, which is honest and is the whole point: the
       permission is RECORDED and is not yet consulted by any sender, because no
       marketing sender exists. If a marketing sender is added later it must
       import this, this number becomes 1, and whoever changes it is forced to
       look at the list below and confirm the importer is not a service sender. */
    const roots = ["server", "client/src", "shared"];
    const importers: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__") continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (p.endsWith(path.join("server", "marketingConsentStore.ts"))) continue;
        const src = fs.readFileSync(p, "utf8");
        // An IMPORT of the gate, not a mention of it in a comment. Comments
        // counted as code is a mechanism this programme has found in itself
        // before, so the pattern requires the identifier inside a braced import.
        if (/import\s*\{[^}]*\bmarketingConsentAllows\b[^}]*\}/.test(src)) {
          importers.push(path.relative(REPO, p));
        }
      }
    };
    for (const r of roots) walk(path.join(REPO, r));

    // CONTROL that the walker actually walked: it must have been able to find the
    // module it is looking for importers of.
    expect(fs.existsSync(path.join(REPO, "server", "marketingConsentStore.ts"))).toBe(true);

    expect(importers).toEqual([]);
    expect(importers.length).toBe(0);
  });

  it("the email sender and the notification-preference module do not consult marketing consent", () => {
    // Named directly, because these are the two modules where the mistake would
    // actually silence somebody's security email.
    for (const rel of [
      path.join("server", "lib", "emailSender.ts"),
      path.join("server", "lib", "founderNotificationPrefs.ts"),
    ]) {
      const full = path.join(REPO, rel);
      expect(fs.existsSync(full)).toBe(true); // precondition: the file is real
      const src = codeOnly(full);
      expect(src.length).toBeGreaterThan(500); // precondition: something was read
      expect(src).not.toContain("marketingConsentAllows");
      expect(src).not.toContain("marketing_consent_event");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 — THE OPT-IN IS SEPARATE, UNTICKED AND OPTIONAL ON THE SCREEN.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 3 · the box is separate from terms, starts unticked, and cannot block the form", () => {
  const CHOICE = path.join(REPO, "client", "src", "components", "MarketingConsentChoice.tsx");
  const SIGNUP = path.join(REPO, "client", "src", "pages", "auth", "Signup.tsx");

  it("the consent control declares NO `required` and NO `defaultChecked`", () => {
    const src = codeOnly(CHOICE);
    expect(src.length).toBeGreaterThan(1000); // precondition: the file is real
    // CONTROL: the stripping did not eat the code it is supposed to be reading.
    expect(src).toContain("MarketingConsentChoice");
    expect(src).toContain("checkbox-marketing-consent");
    // A `required` checkbox would make it a condition of the form; a
    // `defaultChecked` one would be the opt-out mechanism the regulator names.
    expect(src).not.toContain("defaultChecked");
    expect(src).not.toMatch(/\brequired\b\s*(=|\/>|>)/);
  });

  it("the signup form does NOT include the marketing answer in what it requires to submit", () => {
    const src = codeOnly(SIGNUP);
    expect(src).toContain("MarketingConsentChoice"); // precondition: it IS on the form
    // The two things that decide whether the form can be submitted must not
    // mention it.
    const canSubmit = src.slice(src.indexOf("canSubmit"), src.indexOf("canSubmit") + 600);
    expect(canSubmit).not.toContain("marketing");
    const missing = src.slice(src.indexOf("missingFields"), src.indexOf("missingFields") + 900);
    expect(missing.toLowerCase()).not.toContain("marketing");
  });

  it("the existing REQUIRED terms checkbox is still separate and untouched", () => {
    const src = codeOnly(SIGNUP);
    // Terms acceptance stays its own, required control. Bundling the two is
    // exactly what makes express consent invalid.
    expect(src).toContain("LegalConsentCheckbox");
    expect(src).toMatch(/docs=\{\["terms",\s*"privacy"\]\}/);
  });

  it("the settings screen offers the change, and says service messages are unaffected", () => {
    const src = codeOnly(
      path.join(REPO, "client", "src", "pages", "settings", "PrivacyPage.tsx"),
    );
    expect(src).toContain("MarketingConsentChoice");
    expect(src).toContain('channel="settings"');
    // The reassurance a person needs before turning it off, in the interface.
    expect(src).toContain("always delivered");
  });

  it("there is NO confirm-shaming: the control has no confirmation dialog for turning it OFF", () => {
    const src = codeOnly(CHOICE);
    // Turning it off must be the same single click as turning it on.
    expect(src).not.toContain("AlertDialog");
    expect(src).not.toContain("window.confirm");
    expect(src).not.toContain("Are you sure");
  });
});
