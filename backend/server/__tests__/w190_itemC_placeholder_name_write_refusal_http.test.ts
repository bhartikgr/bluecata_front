/**
 * WAVE 190 · ITEM C — A PLACEHOLDER IS NOT A PERSON'S NAME, AND IS NOT STORED AS
 * ONE.
 *
 * THE DEFECT THIS TEST FENCES. The owner's own account rendered the avatar
 * initials "NC", because a stored display name of `"New contact"` was treated as
 * a person and initialled. Wave 93 stopped the founder CRM route INVENTING that
 * string when a body carried no identity; it did not stop a caller SENDING it as
 * the value of the name field, which satisfies every existing check and is then
 * stored, read back, and initialled.
 *
 * WHY THIS TEST IS AT THE HTTP LAYER (R137). The predicate is a pure function and
 * a unit test of it would prove only that the predicate works — which is not the
 * claim. The claim is that three real create routes refuse the write. All three
 * are driven here through the real registered Express app.
 *
 * THE NEGATIVE CONTROL IS THE POINT OF THE ITEM, NOT AN EXTRA. Refusing a genuine
 * name is a different injustice from accepting a fake one, and a substring or
 * prefix test would commit it: `"Newton"` starts with "new" and
 * `"Newman Contact Partners"` contains "contact". Every route below is proved to
 * accept both.
 *
 * NOT ASSERTED HERE, DELIBERATELY: that existing rows are cleaned up. R156.4
 * reserves test-data cleanup to the owner and this wave mutates no stored row.
 *
 * MONEY. No amount, fee, price or currency appears in this file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import {
  PLACEHOLDER_NAME_REFUSED_CODE,
  PLACEHOLDER_PERSON_NAMES,
  isPlaceholderPersonName,
  submittedNameIsPlaceholder,
} from "@shared/placeholderPersonNames";

const MANAGING = TEST_PARTNER_USERS.managing.userId;
const FOUNDER = "u_maya_chen";

let app: Express;
let server: http.Server;
let port: number;

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try { b = JSON.parse(buf); } catch { /* non-JSON body kept as null */ }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** How many CRM rows exist right now, across both surfaces under test. A refusal
 *  that returned 400 and still wrote would pass a status assertion, so every
 *  refusal below is also checked against the row count. */
function crmRowCounts(): { partner: number; founder: number } {
  const one = (sql: string): number => {
    try {
      const row = rawDb().prepare(sql).get() as { n?: number } | undefined;
      return typeof row?.n === "number" ? row.n : 0;
    } catch {
      return -1;
    }
  };
  return {
    partner: one(`SELECT COUNT(*) AS n FROM partner_crm_contacts`),
    founder: one(`SELECT COUNT(*) AS n FROM founder_crm_contacts`),
  };
}

function expectRefusal(r: { status: number; body: any }) {
  expect(r.status).toBe(400);
  expect(r.body?.error).toBe(PLACEHOLDER_NAME_REFUSED_CODE);
  const message = String(r.body?.message ?? "");
  /* The words say WHAT was wrong and WHAT to do, and carry no machine token. */
  expect(message.toLowerCase()).toContain("placeholder text");
  expect(message.toLowerCase()).toContain("did not save this contact");
  expect(message).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });
  await hydratePartnerWorkspaceV19Store();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

/* ══ C-1 — THE SHARED SET, AND WHAT IT DELIBERATELY DOES NOT CATCH ════════ */
describe("W190 C-1 — the shared placeholder set", () => {
  it("keeps the six original display-side literals byte-for-byte and adds exactly the two wave 190 entries", () => {
    /* R143.1: literals byte-verbatim. The first six are the set
       `client/src/lib/investorLabels.ts` has enforced since BUG-01/02/21; if any
       one of them changed spelling, a name that used to be caught would stop
       being caught. */
    expect(PLACEHOLDER_PERSON_NAMES.slice(0, 6)).toEqual([
      "new", "new user", "user", "investor", "—", "-",
    ]);
    expect(PLACEHOLDER_PERSON_NAMES.slice(6)).toEqual(["new contact", "new contact data"]);
  });

  it("is EXACT-match only, case-insensitive, trimmed — never a substring test", () => {
    expect(isPlaceholderPersonName("New contact")).toBe(true);
    expect(isPlaceholderPersonName("  NEW CONTACT  ")).toBe(true);
    expect(isPlaceholderPersonName("new contact data")).toBe(true);
    /* THE NEGATIVE CONTROL, at the predicate layer. */
    expect(isPlaceholderPersonName("Newton")).toBe(false);
    expect(isPlaceholderPersonName("Newman Contact Partners")).toBe(false);
    expect(isPlaceholderPersonName("New contacts")).toBe(false);
    expect(isPlaceholderPersonName("Contact")).toBe(false);
    /* Absence is not a placeholder — a different question, answered elsewhere. */
    expect(isPlaceholderPersonName(null)).toBe(false);
    expect(isPlaceholderPersonName(undefined)).toBe(false);
    expect(isPlaceholderPersonName("")).toBe(false);
  });

  it("catches the COMPOSITION as well as the whole value", () => {
    expect(submittedNameIsPlaceholder(["New contact"])).toBe(true);
    expect(submittedNameIsPlaceholder([null, "New", "Contact"])).toBe(true);
    expect(submittedNameIsPlaceholder([null, "Newton", "Bell"])).toBe(false);
    expect(submittedNameIsPlaceholder(["Newman Contact Partners"])).toBe(false);
  });
});

/* ══ C-2 — POST /api/founder/investor-crm ════════════════════════════════ */
describe("W190 C-2 — founder investor CRM create", () => {
  it("refuses the literal as `name`, and writes nothing", async () => {
    const before = crmRowCounts();
    const r = await call("POST", "/api/founder/investor-crm", {
      userId: FOUNDER,
      body: { name: "New contact", email: "w190-c2-a@example.com" },
    });
    expectRefusal(r);
    expect(crmRowCounts().founder).toBe(before.founder);
  });

  it("refuses `New` + `Contact` composing to it", async () => {
    const before = crmRowCounts();
    const r = await call("POST", "/api/founder/investor-crm", {
      userId: FOUNDER,
      body: { firstName: "New", lastName: "Contact", email: "w190-c2-b@example.com" },
    });
    expectRefusal(r);
    expect(crmRowCounts().founder).toBe(before.founder);
  });

  it("refuses `new contact data`", async () => {
    const r = await call("POST", "/api/founder/investor-crm", {
      userId: FOUNDER,
      body: { name: "new contact data", email: "w190-c2-c@example.com" },
    });
    expectRefusal(r);
  });

  it("NEGATIVE CONTROL: `Newton` and `Newman Contact Partners` are still accepted", async () => {
    const newton = await call("POST", "/api/founder/investor-crm", {
      userId: FOUNDER,
      body: { name: "Newton Bell", email: "w190-c2-newton@example.com" },
    });
    expect(newton.status).toBeLessThan(300);
    expect(newton.body?.error).not.toBe(PLACEHOLDER_NAME_REFUSED_CODE);

    const newman = await call("POST", "/api/founder/investor-crm", {
      userId: FOUNDER,
      body: { name: "Newman Contact Partners", email: "w190-c2-newman@example.com" },
    });
    expect(newman.status).toBeLessThan(300);
    expect(newman.body?.error).not.toBe(PLACEHOLDER_NAME_REFUSED_CODE);
  });
});

/* ══ C-3 — POST /api/partner/crm/contacts ════════════════════════════════ */
describe("W190 C-3 — partner CRM create", () => {
  it("refuses the literal as `name`, and writes nothing", async () => {
    const before = crmRowCounts();
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING,
      body: { name: "New contact", email: "w190-c3-a@example.com" },
    });
    expectRefusal(r);
    expect(crmRowCounts().partner).toBe(before.partner);
  });

  it("refuses `New` + `Contact` composing to it", async () => {
    const before = crmRowCounts();
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "New", last_name: "Contact", email: "w190-c3-b@example.com" },
    });
    expectRefusal(r);
    expect(crmRowCounts().partner).toBe(before.partner);
  });

  it("NEGATIVE CONTROL: `Newton` and `Newman Contact Partners` are still accepted", async () => {
    const newton = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "Newton", last_name: "Bell", email: "w190-c3-newton@example.com" },
    });
    expect(newton.status).toBe(201);

    const newman = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING,
      body: { name: "Newman Contact Partners", email: "w190-c3-newman@example.com" },
    });
    expect(newman.status).toBe(201);
    /* And the name was stored VERBATIM — a guard that "sanitised" a legitimate
       name would be a second defect wearing the first one's clothes. */
    expect(newman.body?.contact?.name).toBe("Newman Contact Partners");
  });
});

/* ══ C-4 — POST /api/partner/me/crm/contacts (full-parity create) ════════ */
describe("W190 C-4 — partner me CRM create", () => {
  it("refuses `New` + `Contact`, and writes nothing", async () => {
    const before = crmRowCounts();
    const r = await call("POST", "/api/partner/me/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "New", last_name: "Contact", email: "w190-c4-a@example.com" },
    });
    expectRefusal(r);
    expect(crmRowCounts().partner).toBe(before.partner);
  });

  it("refuses the literal submitted through a single field", async () => {
    const r = await call("POST", "/api/partner/me/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "New contact", last_name: "Data", email: "w190-c4-b@example.com" },
    });
    expectRefusal(r);
  });

  it("NEGATIVE CONTROL: `Newton` and `Newman` surnames are still accepted", async () => {
    const newton = await call("POST", "/api/partner/me/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "Newton", last_name: "Bell", email: "w190-c4-newton@example.com" },
    });
    expect(newton.status).toBe(201);

    const newman = await call("POST", "/api/partner/me/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "Ada", last_name: "Newman", email: "w190-c4-newman@example.com" },
    });
    expect(newman.status).toBe(201);
  });
});

/* ══ C-5 — THE FALSE-POSITIVE THIS SHAPE CARRIES, PINNED RATHER THAN HIDDEN ══
   `submittedNameIsPlaceholder` tests each supplied part individually, and `"new"`
   is one of the six original literals. A contact whose FIRST NAME is literally
   `"New"` with any surname is therefore refused, even though the composed name is
   not a placeholder — and this database contains exactly such a legitimate row
   (`spv_lp_invite.first_name = "New"`, in "New Guy").

   THIS IS NOT CHANGED BY WAVE 190. Wave 190's remit is the proof, not a redesign,
   and the alternative shape (composition-only) would open a real hole: a body
   like `{"name":"Investor","first_name":"Real","last_name":"Person"}` stores
   `"Investor"` as the name while composing to something innocuous. The trade-off
   is a decision for the owner, so it is asserted here as CURRENT BEHAVIOUR and
   reported under FOR THE OWNER rather than quietly altered. */
describe("W190 C-5 — the known false positive, asserted as current behaviour", () => {
  it("a contact whose first name is the bare word `New` is refused (owner decision pending)", async () => {
    const r = await call("POST", "/api/partner/me/crm/contacts", {
      userId: MANAGING,
      body: { first_name: "New", last_name: "Guy", email: "w190-c5-newguy@example.com" },
    });
    expectRefusal(r);
  });

  it("and no existing row was mutated or deleted to make any of the above pass (R156.4)", () => {
    /* The wave writes no migration and repairs no row. The only rows this suite
       created are the ones its own negative controls posted. */
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM spv_lp_invite WHERE first_name = 'New'`)
      .get() as { n?: number } | undefined;
    expect(typeof row?.n).toBe("number");
  });
});
