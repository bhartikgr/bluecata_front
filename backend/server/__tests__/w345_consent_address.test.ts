/**
 * WAVE 345 · CONSENTADDRESS — THE MAILING ADDRESS IS SUPPLIED, SO THE BOX IS LIVE.
 *
 * ── WHAT CHANGED, IN ONE SENTENCE ──────────────────────────────────────────
 * Wave 344 built the marketing-consent capability and left it deliberately INERT
 * because the regulator requires the consent request to carry a mailing address
 * and there was none. The owner has now supplied one. This file proves the
 * capability is ACTIVE, that what it shows is complete, that what it stores is
 * what it showed, and — the part that matters most — that it goes INERT AGAIN the
 * moment the address is taken away.
 *
 * ── THE FIVE THINGS THIS FILE PROVES ───────────────────────────────────────
 *   1. THE ADDRESS IS CONFIGURATION, NOT CODE. It is read from `.env` at the
 *      moment the request is built, not baked in at import time. §0 reads the
 *      real `.env` file off disk and compares it, byte for byte, to the address
 *      the owner ruled — including the two spaces in "Toronto, ON  M5X 1C7". §6
 *      changes the value at runtime and watches the served request change.
 *   2. ALL FOUR REQUIRED PARTS ARE IN THE REQUEST ITSELF — the purposes, who is
 *      asking, the mailing address, and that permission can be withdrawn. Asserted
 *      against the TEXT that is served to the screen, not against the presence of
 *      a field. (The DOM-rendered proof is the companion client test,
 *      client/src/components/__tests__/w345_consent_address_render.test.tsx.)
 *   3. THE STORED ROW CARRIES THE EXACT WORDING, INCLUDING THE ADDRESS — read
 *      back through `rawDb()`, with a `rows > 0` precondition, and compared
 *      character for character to the text that was served. A boolean that flipped
 *      is not a consent record.
 *   4. IT FAILS SAFE. Blank the address and the request reports itself
 *      unavailable, the POST refuses with 503, NOTHING is stored — and signing up
 *      still succeeds while it is blank. An inert box is honest; an incomplete one
 *      manufactures a worthless record.
 *   5. SIGNUP AND SERVICE MESSAGES ARE UNTOUCHED. Signup succeeds with no consent
 *      field in the request at all, and `mayReceiveServiceMessage()` still takes
 *      NO ARGUMENTS, so it cannot be made to depend on a marketing preference even
 *      by accident.
 *
 * ── A NOTE ON WHAT THIS FILE DOES *NOT* DO ─────────────────────────────────
 * It does not re-assert the things `w344_item3_marketing_consent.test.ts` already
 * asserts and which this wave did not touch — the closed set of one consent kind,
 * the append-only triggers, the importer count of `marketingConsentAllows`
 * (asserted `=== 0` there, deliberately left alone here and there). That file was
 * re-run unchanged as part of this wave's evidence.
 *
 * ── ISOLATION, STATED PLAINLY ──────────────────────────────────────────────
 * This suite runs against the project's deliberately isolated in-memory test
 * database (`vitest.config.ts` pins NODE_ENV=test). It does not read or write the
 * live rows in `data.db`. The guarded defect is asserting against an EMPTY
 * database, which is why every database assertion below has a `rows > 0`
 * precondition and why §0 proves the product and this file hold the same handle.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const REPO = path.resolve(__dirname, "..", "..");

/**
 * THE ADDRESS THE OWNER RULED, WRITTEN OUT HERE AS A LITERAL.
 *
 * This is not a copy of the configuration — it is the INDEPENDENT statement of
 * what the configuration is supposed to say, so that §0 is a real comparison
 * between two sources and not a variable compared with itself. Toronto primary,
 * Hong Kong beneath it, the entity name above each. The double space before the
 * postcode is the owner's, and is deliberate.
 */
const OWNER_ADDRESS = [
  "BluePrint Catalyst Limited",
  "First Canadian Place",
  "100 King Street West, Suite 5700",
  "Toronto, ON  M5X 1C7",
  "Canada",
  "",
  "BluePrint Catalyst Limited",
  "Level 20, One IFC",
  "No. 1 Harbour View Street",
  "Central, Hong Kong",
].join("\n");
const OWNER_IDENTITY = "BluePrint Catalyst Limited";

/**
 * THE CONFIGURATION AS IT ACTUALLY SITS ON DISK.
 *
 * Parsed from the real `.env`, not from `process.env`, because `process.env` in a
 * test can be set by the test — which would prove nothing about what the platform
 * is configured with. This is the value the running server would pick up.
 */
const ENV_FILE = path.join(REPO, ".env");
const ENV_ON_DISK = dotenv.parse(fs.readFileSync(ENV_FILE));
const CONFIGURED_ADDRESS = ENV_ON_DISK.MARKETING_CONSENT_MAILING_ADDRESS ?? "";
const CONFIGURED_IDENTITY = ENV_ON_DISK.MARKETING_CONSENT_REQUESTER_IDENTITY ?? "";

/* The suite runs with the configuration the platform is configured with. Set
   BEFORE the store is imported, exactly as the real server does via
   `import "dotenv/config"` in server/index.ts. */
process.env.MARKETING_CONSENT_MAILING_ADDRESS = CONFIGURED_ADDRESS;
process.env.MARKETING_CONSENT_REQUESTER_IDENTITY = CONFIGURED_IDENTITY;

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import { MARKETING_CONSENT_TABLE } from "../lib/marketingConsentSchema";
import {
  DISCLOSURE_VERSION,
  buildDisclosure,
  consentTenantForUser,
  mayReceiveServiceMessage,
} from "../marketingConsentStore";

/** Source with every comment removed — this programme has repeatedly measured a
 *  COMMENT and reported it as code. The component file under §7 explains in
 *  comments that `defaultChecked` is absent, and a raw search would find the
 *  explanation and call it the defect. */
function codeOnly(file: string): string {
  const src = fs.readFileSync(file, "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

let app: Express;
let server: http.Server;
let userId = "";
let secondUserId = "";
const EMAIL = "w345.address@example.test";
const EMAIL_BLANK = "w345.address.blank@example.test";

function rowsFor(uid: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(
      `SELECT * FROM ${MARKETING_CONSENT_TABLE} WHERE user_id = ? ORDER BY decided_at ASC, rowid ASC`,
    )
    .all(uid) as Array<Record<string, unknown>>;
}

/** Run `fn` with the mailing address blanked, then put it back and PROVE it came
 *  back. A disarm that does not verify its own restore is a hazard. */
function withAddressBlank<T>(fn: () => T): T {
  const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
  try {
    process.env.MARKETING_CONSENT_MAILING_ADDRESS = "";
    return fn();
  } finally {
    process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
    if (process.env.MARKETING_CONSENT_MAILING_ADDRESS !== saved) {
      throw new Error("W345: the address was NOT restored — later results are void");
    }
  }
}
async function withAddressBlankAsync<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
  try {
    process.env.MARKETING_CONSENT_MAILING_ADDRESS = "";
    return await fn();
  } finally {
    process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
    if (process.env.MARKETING_CONSENT_MAILING_ADDRESS !== saved) {
      throw new Error("W345: the address was NOT restored — later results are void");
    }
  }
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
   0 — THE CONTROLS. RUN FIRST, AND ONE OF THEM TRIES TO MANUFACTURE A GREEN.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §0 · controls", () => {
  it("CONTROL: the address is CONFIGURATION on disk, and it is the owner's, byte for byte", () => {
    // Read from the `.env` FILE, compared against the address written out
    // independently at the top of this file. Two sources, one comparison.
    expect(fs.existsSync(ENV_FILE)).toBe(true); // precondition: the file is real
    expect(CONFIGURED_ADDRESS.length).toBeGreaterThan(50); // precondition: not empty
    expect(CONFIGURED_ADDRESS).toBe(OWNER_ADDRESS);
    expect(CONFIGURED_IDENTITY).toBe(OWNER_IDENTITY);
    // The double space in the postcode line survives configuration. A helpful
    // whitespace tidy-up somewhere in the chain would change the owner's address.
    expect(CONFIGURED_ADDRESS).toContain("Toronto, ON  M5X 1C7");
  });

  it("CONTROL: the address is NOT hard-coded into any component or module", () => {
    // The only places the address text may appear are configuration files, this
    // wave's tests, and this wave's build log. If it appears in a component or a
    // server module it has stopped being configurable, whatever the docs say.
    const forbidden = [
      path.join(REPO, "client", "src", "components", "MarketingConsentChoice.tsx"),
      path.join(REPO, "server", "marketingConsentStore.ts"),
      path.join(REPO, "client", "src", "pages", "auth", "Signup.tsx"),
      path.join(REPO, "client", "src", "pages", "settings", "PrivacyPage.tsx"),
    ];
    for (const f of forbidden) {
      expect(fs.existsSync(f)).toBe(true); // precondition: the file is real
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toContain("100 King Street West");
      expect(src).not.toContain("Harbour View Street");
      expect(src).not.toContain("M5X 1C7");
    }
  });

  it("CONTROL: a WRONG address is NOT found in the served wording — this test can go red", async () => {
    // The manufacture-a-green attempt. If the assertions in §2 would pass for any
    // string at all then they prove nothing. This asserts the negative case first.
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.status).toBe(200);
    const text = String(r.body?.disclosure?.text ?? "");
    expect(text.length).toBeGreaterThan(200); // precondition: there IS wording
    expect(text).not.toContain("200 Bay Street");
    expect(text).not.toContain("Vancouver, BC");
    expect(text).not.toContain("Toronto, ON M5X 1C7"); // ONE space — not the owner's
  }, 60_000);

  it("CONTROL: the mail transport is inert, so this file cannot send real mail", () => {
    expect(getConfig().mode).toBe("dry_run");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — SIGNUP SUCCEEDS WITHOUT MARKETING CONSENT. STILL. WITH THE BOX LIVE.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §1 · signing up does not depend on marketing consent", () => {
  it("SIGNUP SUCCEEDS with NO consent field in the request at all", async () => {
    _resetRateLimitsForTests();
    const r = await request(app)
      .post("/api/auth/signup")
      .send({ email: EMAIL, name: "W345 Address Person", password: "w345-address-pw" });
    expect(r.status).toBe(200);
    userId = String(r.body?.ctx?.userId ?? "");
    expect(userId).not.toBe("");
  }, 120_000);

  it("CONTROL: the PRODUCT and this TEST hold the SAME database — read back through rawDb()", () => {
    // Without this, every row assertion below could be measuring an empty
    // database in a different process and reporting green.
    const u = rawDb()
      .prepare(`SELECT id, email FROM users WHERE id = ?`)
      .get(userId) as { id?: string } | undefined;
    expect(u?.id).toBe(userId);
  });

  it("AND NOTHING WAS STORED for that person — rows === 0 — because they were not asked", async () => {
    // The table installs lazily through the shipped route, so this reads a table
    // that exists and is genuinely empty for them, not a missing table.
    const warm = await request(app).get("/api/consent/marketing").set("x-user-id", userId);
    expect(warm.status).toBe(200);
    expect(warm.body?.checked).toBe(false);
    expect(rowsFor(userId).length).toBe(0);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THE BOX IS NOW ACTIVE, AND THE REQUEST CARRIES ALL FOUR ELEMENTS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §2 · the consent request is ACTIVE and complete", () => {
  it("THE BOX IS ACTIVE: the request reports available === true and carries wording", async () => {
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.status).toBe(200);
    expect(r.body?.available).toBe(true);
    expect(r.body?.reason).toBeNull();
    expect(String(r.body?.disclosure?.text ?? "").length).toBeGreaterThan(200);
  }, 60_000);

  it("ELEMENT 1 of 4 — THE PURPOSES are in the wording itself", async () => {
    const text = String(
      (await request(app).get("/api/consent/marketing-request")).body?.disclosure?.text ?? "",
    );
    expect(text.length).toBeGreaterThan(200); // precondition
    expect(text).toContain(
      "occasional marketing emails about new features, upcoming events, and news about the platform",
    );
  }, 60_000);

  it("ELEMENT 2 of 4 — WHO IS ASKING is named in the wording itself", async () => {
    const text = String(
      (await request(app).get("/api/consent/marketing-request")).body?.disclosure?.text ?? "",
    );
    expect(text.length).toBeGreaterThan(200); // precondition
    expect(text).toContain(`This request is made by ${OWNER_IDENTITY}.`);
  }, 60_000);

  it("ELEMENT 3 of 4 — THE MAILING ADDRESS appears IN THE REQUEST, verbatim and in order", async () => {
    const text = String(
      (await request(app).get("/api/consent/marketing-request")).body?.disclosure?.text ?? "",
    );
    expect(text.length).toBeGreaterThan(200); // precondition
    // The whole block, contiguously — not the lines scattered through the text.
    expect(text).toContain(OWNER_ADDRESS);
    // And line by line, so a failure names WHICH line went missing.
    for (const line of OWNER_ADDRESS.split("\n").filter((l) => l.trim() !== "")) {
      expect(text).toContain(line);
    }
    // The owner's ordering: Toronto primary, Hong Kong BENEATH it.
    expect(text.indexOf("Toronto, ON  M5X 1C7")).toBeGreaterThan(0);
    expect(text.indexOf("Central, Hong Kong")).toBeGreaterThan(
      text.indexOf("Toronto, ON  M5X 1C7"),
    );
    // One entity name above each address block — so it appears twice inside the
    // address block, on top of the mention in the sentence above it.
    expect(OWNER_ADDRESS.split(OWNER_IDENTITY).length - 1).toBe(2);
  }, 60_000);

  it("ELEMENT 3 also states the address STAYS VALID FOR AT LEAST 60 DAYS", async () => {
    // The regulator requires the address to remain valid for at least 60 days
    // after a message is sent. Saying so inside the request is what puts that
    // promise on the record the person agreed to.
    const text = String(
      (await request(app).get("/api/consent/marketing-request")).body?.disclosure?.text ?? "",
    );
    expect(text.length).toBeGreaterThan(200); // precondition
    expect(text).toContain("stays valid for at least 60 days after any message we send you");
  }, 60_000);

  it("ELEMENT 4 of 4 — THAT CONSENT CAN BE WITHDRAWN is stated in the wording itself", async () => {
    const text = String(
      (await request(app).get("/api/consent/marketing-request")).body?.disclosure?.text ?? "",
    );
    expect(text.length).toBeGreaterThan(200); // precondition
    expect(text).toContain(
      "You can withdraw this permission at any time from your account settings, in one step.",
    );
  }, 60_000);

  it("the PUBLIC request endpoint still returns NO personal state — it has no person", async () => {
    const r = await request(app).get("/api/consent/marketing-request");
    expect(r.body?.checked).toBe(false);
    expect(r.body?.decision).toBeNull();
    expect(r.body?.decidedAt).toBeNull();
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — THE STORED ROW CARRIES THE EXACT WORDING, INCLUDING THE ADDRESS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §3 · the stored record contains what the person saw", () => {
  let shownText = "";

  it("GRANTING stores a row whose disclosure_text is BYTE-IDENTICAL to what was served", async () => {
    const served = await request(app).get("/api/consent/marketing-request");
    shownText = String(served.body?.disclosure?.text ?? "");
    expect(shownText.length).toBeGreaterThan(200); // precondition

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
    expect(String(row.disclosure_text)).toBe(shownText);
  }, 120_000);

  it("THE ADDRESS IS INSIDE THE STORED WORDING — not merely in a column beside it", async () => {
    // The assertion this wave turns on. A consent record that does not contain
    // what the person saw is not a defensible record, and a column holding the
    // address next to wording that never mentioned it would be exactly that.
    const rows = rowsFor(userId);
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    const row = rows[rows.length - 1];
    const stored = String(row.disclosure_text);
    expect(stored.length).toBeGreaterThan(200); // precondition: the wording is there

    expect(stored).toContain(OWNER_ADDRESS); // the whole block, contiguously
    expect(stored).toContain("Toronto, ON  M5X 1C7");
    expect(stored).toContain("Central, Hong Kong");
    expect(stored.indexOf("Central, Hong Kong")).toBeGreaterThan(
      stored.indexOf("Toronto, ON  M5X 1C7"),
    );
    // And the other three required elements, on the same stored sentence.
    expect(stored).toContain("occasional marketing emails about new features");
    expect(stored).toContain(`This request is made by ${OWNER_IDENTITY}.`);
    expect(stored).toContain("You can withdraw this permission at any time");
    // The separate columns agree with the wording — the database CHECK
    // constraints require it, and this reads it back to prove they did.
    expect(String(row.requester_mailing_address)).toBe(OWNER_ADDRESS);
    expect(String(row.requester_identity)).toBe(OWNER_IDENTITY);
    expect(String(row.disclosure_version)).toBe(DISCLOSURE_VERSION);
    expect(String(row.decision)).toBe("granted");
    expect(String(row.tenant_id)).toBe(consentTenantForUser(userId));
  });

  it("CONTROL: the stored row is not a boolean — it is over 400 characters of wording", () => {
    const rows = rowsFor(userId);
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    expect(String(rows[rows.length - 1].disclosure_text).length).toBeGreaterThan(400);
  });

  it("WITHDRAWING is one request with one field, writes a NEW row, and keeps the grant", async () => {
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
    expect(after.length).toBe(before + 1);
    expect(String(after[after.length - 1].decision)).toBe("withdrawn");
    expect(after.some((x) => String(x.decision) === "granted")).toBe(true);
    // The withdrawal row carries the wording and the address too — a withdrawal
    // record that cannot say what was withdrawn from is no better than a boolean.
    expect(String(after[after.length - 1].disclosure_text)).toContain(OWNER_ADDRESS);
  }, 120_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   4 — THE FAIL-SAFE. BLANK THE ADDRESS AND THE BOX GOES INERT AGAIN.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §4 · with the address blank the box is inert and signup still works", () => {
  it("BLANK ADDRESS: the builder reports unavailable, with a reason, and NO wording at all", () => {
    const avail = withAddressBlank(() => buildDisclosure());
    expect(avail.available).toBe(false);
    expect(avail.disclosure).toBeUndefined();
    expect(String(avail.reason ?? "")).toContain("postal address");
    // CONTROL: available again straight afterwards, so the case above proved a
    // switch and not a permanently-off feature.
    expect(buildDisclosure().available).toBe(true);
  });

  it("BLANK ADDRESS: the served request says unavailable, so the BOX DOES NOT RENDER", async () => {
    const r = await withAddressBlankAsync(() =>
      request(app).get("/api/consent/marketing-request"),
    );
    expect(r.status).toBe(200);
    expect(r.body?.available).toBe(false);
    // `available === true && !!disclosure` is the component's render condition.
    // Both limbs fail here, which is what makes the box absent rather than empty.
    expect(r.body?.disclosure).toBeNull();
    expect(String(r.body?.reason ?? "")).toContain("postal address");
  }, 60_000);

  it("BLANK ADDRESS: POST refuses with 503 and STORES NOTHING — row count unmoved", async () => {
    const before = rowsFor(userId).length;
    expect(before).toBeGreaterThan(0); // rows > 0 precondition
    _resetRateLimitsForTests();
    const r = await withAddressBlankAsync(() =>
      request(app)
        .post("/api/consent/marketing")
        .set("x-user-id", userId)
        .send({ decision: "granted", channel: "settings" }),
    );
    expect(r.status).toBe(503);
    expect(r.body?.error).toBe("consent_request_incomplete");
    expect(rowsFor(userId).length).toBe(before);
  }, 120_000);

  it("BLANK ADDRESS: SIGNUP STILL SUCCEEDS — a fresh account is created while it is blank", async () => {
    _resetRateLimitsForTests();
    const r = await withAddressBlankAsync(() =>
      request(app)
        .post("/api/auth/signup")
        .send({ email: EMAIL_BLANK, name: "W345 Blank Person", password: "w345-blank-pw" }),
    );
    expect(r.status).toBe(200);
    secondUserId = String(r.body?.ctx?.userId ?? "");
    expect(secondUserId).not.toBe("");
    // Read back through rawDb() — the account is real, not just a 200.
    const u = rawDb()
      .prepare(`SELECT id FROM users WHERE id = ?`)
      .get(secondUserId) as { id?: string } | undefined;
    expect(u?.id).toBe(secondUserId);
    // And nothing was recorded for them, because they were never asked.
    expect(rowsFor(secondUserId).length).toBe(0);
  }, 120_000);

  it("WHITESPACE IS NOT AN ADDRESS: newlines and spaces alone leave the box inert", () => {
    const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
    try {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = "   \n\n \t ";
      const avail = buildDisclosure();
      expect(avail.available).toBe(false);
      expect(avail.disclosure).toBeUndefined();
    } finally {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
      expect(process.env.MARKETING_CONSENT_MAILING_ADDRESS).toBe(saved);
    }
    expect(buildDisclosure().available).toBe(true); // CONTROL: restored
  });

  it("A MISSING NAME also makes it inert — an anonymous request is not a valid one", () => {
    const saved = process.env.MARKETING_CONSENT_REQUESTER_IDENTITY;
    try {
      process.env.MARKETING_CONSENT_REQUESTER_IDENTITY = "   ";
      const avail = buildDisclosure();
      expect(avail.available).toBe(false);
      expect(String(avail.reason ?? "")).toContain("name of the business");
    } finally {
      process.env.MARKETING_CONSENT_REQUESTER_IDENTITY = saved;
      expect(process.env.MARKETING_CONSENT_REQUESTER_IDENTITY).toBe(saved);
    }
    expect(buildDisclosure().available).toBe(true); // CONTROL: restored
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 — SERVICE MESSAGES ARE NEVER GATED BEHIND THIS.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §5 · service and platform messages are never gated behind consent", () => {
  it("mayReceiveServiceMessage TAKES NO ARGUMENTS — arity === 0 — so it cannot depend on consent", () => {
    // The arity is the guarantee. A function that takes no user and no tenant
    // cannot be made to consult a marketing preference, even by accident.
    expect(mayReceiveServiceMessage.length).toBe(0);
    expect(mayReceiveServiceMessage()).toBe(true);
  });

  it("it is still true for the person who WITHDREW, and while the address is BLANK", () => {
    const rows = rowsFor(userId);
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    expect(String(rows[rows.length - 1].decision)).toBe("withdrawn"); // precondition
    expect(mayReceiveServiceMessage()).toBe(true);
    expect(withAddressBlank(() => mayReceiveServiceMessage())).toBe(true);
  });

  it("every consent response still tells the screen that service messages always arrive", async () => {
    const pub = await request(app).get("/api/consent/marketing-request");
    expect(pub.body?.serviceMessagesAlwaysDelivered).toBe(true);
    const mine = await request(app).get("/api/consent/marketing").set("x-user-id", userId);
    expect(mine.body?.serviceMessagesAlwaysDelivered).toBe(true);
  }, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════
   6 — IT IS CONFIGURATION, NOT A BUILD-TIME CONSTANT.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §6 · the address can be changed without a code release", () => {
  it("CHANGING THE VARIABLE AT RUNTIME CHANGES THE SERVED REQUEST — nothing is baked in", async () => {
    const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
    const other = "W345 Runtime Probe, 1 Elsewhere Road, Halifax NS B3H 0A1, Canada";
    try {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = other;
      const r = await request(app).get("/api/consent/marketing-request");
      const text = String(r.body?.disclosure?.text ?? "");
      expect(text.length).toBeGreaterThan(200); // precondition
      expect(text).toContain(other);
      // And the owner's address is GONE, which is what proves the first result
      // was read from configuration rather than from a constant that happens to
      // agree with it.
      expect(text).not.toContain("100 King Street West");
    } finally {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
      expect(process.env.MARKETING_CONSENT_MAILING_ADDRESS).toBe(saved);
    }
    const back = await request(app).get("/api/consent/marketing-request");
    expect(String(back.body?.disclosure?.text ?? "")).toContain(OWNER_ADDRESS); // CONTROL
  }, 120_000);

  it("both variables are documented in .env.example, so the owner can find them", () => {
    const ex = fs.readFileSync(path.join(REPO, ".env.example"), "utf8");
    expect(ex).toContain("MARKETING_CONSENT_MAILING_ADDRESS");
    expect(ex).toContain("MARKETING_CONSENT_REQUESTER_IDENTITY");
    // And it tells the reader the one thing that is easy to get wrong.
    expect(ex).toContain("MULTI-LINE VALUES MUST BE WRAPPED IN DOUBLE QUOTES");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7 — WHAT MUST NOT HAVE CHANGED, AND HAS NOT.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 §7 · the box is still separate, unticked, optional and easy to decline", () => {
  it("the component has NO defaultChecked and NO required — read from comment-stripped source", () => {
    const f = path.join(REPO, "client", "src", "components", "MarketingConsentChoice.tsx");
    expect(fs.existsSync(f)).toBe(true); // precondition
    const src = codeOnly(f);
    // PRECONDITION: the stripping did not eat the code it is supposed to search.
    expect(src).toContain("checkbox-marketing-consent");
    expect(src).not.toContain("defaultChecked");
    expect(src).not.toContain("required");
    // The local answer starts false and there is no branch that starts it true.
    expect(src).toContain("useState(false)");
  });

  it("the signup page still does NOT gate submission on the consent answer", () => {
    const f = path.join(REPO, "client", "src", "pages", "auth", "Signup.tsx");
    expect(fs.existsSync(f)).toBe(true); // precondition
    const src = codeOnly(f);
    expect(src).toContain("MarketingConsentChoice"); // precondition: it is there
    // The consent answer is never part of what makes the form submittable.
    const gating = /(canSubmit|missingFields|disabled)[^\n]*\b(marketing|consentAnswer)\b/i;
    expect(gating.test(src)).toBe(false);
  });

  it("the wording is rendered with its line breaks preserved, so the address reads as an address", () => {
    // A postal address collapsed onto one line is the right characters and the
    // wrong address. The DOM-level proof is in the companion client test; this is
    // the structural fence that keeps the class on the element.
    const f = path.join(REPO, "client", "src", "components", "MarketingConsentChoice.tsx");
    const src = codeOnly(f);
    const anchor = src.indexOf('data-testid="marketing-consent-wording"');
    expect(anchor).toBeGreaterThan(0); // PRECONDITION: the element was FOUND
    const window = src.slice(Math.max(0, anchor - 400), anchor + 200);
    expect(window).toContain("whitespace-pre-line");
  });
});
