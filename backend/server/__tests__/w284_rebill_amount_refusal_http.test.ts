/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 284 · THE REBILL FABRICATED ZERO, AND THE FALSE EXPLANATION.
 * REAL EXPRESS ROUTES OVER SUPERTEST, REAL SQLITE, EVERY CLAIM READ WITH rawDb().
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `mfcrmAcctStore.recordRebill` began:
 *     const amt = Number.isFinite(data.amountMinor) ? Math.trunc(data.amountMinor) : 0;
 * and the route handed it `Number(body.amountMinor)`. Together those two lines
 * turned every way of NOT stating an amount into a stored zero: `Number(null)`,
 * `Number("")`, `Number([])` and `Number(false)` are all `0`, and anything else
 * non-finite fell to the explicit `: 0`. A partner who paid a filing fee on a
 * founder's behalf, and whose amount did not arrive, got a permanent pending
 * accounts-receivable row stating the expense cost nothing — indistinguishable
 * on every screen from an expense that genuinely was free. `Math.trunc` was the
 * second fabrication: 1250.7 was silently recorded as 1250.
 *
 * WHAT THIS FILE PROVES, IN THIS ORDER:
 *   §A  PRECONDITIONS. The route works, the capability gate is open, and a real
 *       row lands in `mf_acct_rebill` with the exact amount sent. Without this
 *       every "no row was written" assertion below would be vacuous.
 *   §B  OVER-REACH. A genuine `0` is STILL RECORDED. Not every zero is a lie and
 *       this fix must not eat a real one.
 *   §C  UNDER-REACH. Eight distinct bodies that state no usable amount are each
 *       REFUSED, and `SELECT COUNT(*)` is unchanged after each one.
 *   §D  THE FALSE EXPLANATION. Every refusal is 400 and explicitly NOT 403, and
 *       the message the user reads names the amount as the problem.
 *
 * WHY 403 WAS THE HAZARD. `sendError` maps anything not in its exact-equality
 * `VALIDATION_CODES` set — and not one of the named persist/not-found codes — to
 * **403 fail-closed**. A brand-new refusal code therefore arrives at the user as
 * "you are not allowed to do this" when the truth is "you did not give me an
 * amount". Telling a user the wrong reason is the defect class this band exists
 * to remove, so the code carries a variable tail (the type and value that
 * arrived) and needs a `startsWith` branch; an entry in the equality set would
 * never have matched. §D asserts the STATUS AND THE SENTENCE, not the branch.
 *
 * MAIL SAFETY. Run with `SMTP_MODE=dry_run`. §0 drives a send and reads the id.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmPersonaRoutes } from "../managedFounderPersonaRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { managedFounderStore } from "../managedFounderStore";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { ensureAcctTables } from "../mfcrmAcctStore";
import { rawDb } from "../db/connection";
import { getConfig, patchConfig, sendMail } from "../emailTransport";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const COMPANY = "co_w284_rebill_target";

let app: express.Express;

function post(path: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});
}
function get(path: string) {
  return request(app).get(path).set("x-user-id", MANAGING);
}

/** THE STORED ROWS. rawDb(), never `listRebills`. */
function rowCount(): number {
  const r = rawDb()
    .prepare("SELECT COUNT(*) AS n FROM mf_acct_rebill WHERE partner_id = ? AND company_id = ?")
    .get(PARTNER_A, COMPANY) as { n?: number } | undefined;
  return Number(r?.n ?? 0);
}
function rowByDescription(description: string): Record<string, unknown> | undefined {
  return rawDb()
    .prepare("SELECT * FROM mf_acct_rebill WHERE partner_id = ? AND description = ?")
    .get(PARTNER_A, description) as Record<string, unknown> | undefined;
}

beforeAll(() => {
  patchConfig({ mode: "dry_run" });
  applyMfcrmSchema();
  /* `mf_acct_rebill` is created lazily by the store, on the first call that gets
     PAST the capability gate — so a refused write never creates it. This test
     reads the table directly with rawDb() BEFORE and AFTER refusals, so the
     table has to exist up front or "no row was written" would be an SqliteError
     rather than a measurement. This is the store's OWN creation function, not a
     hand-written schema, so the columns are the real ones. */
  ensureAcctTables();
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmPersonaRoutes(app);
  seedTestPartnerSandbox({ force: true });
  /* The accounting persona's pays-on-behalf capability, and an attributed
     company. Both are gates the route checks BEFORE the amount is ever read; if
     either were missing the whole file would be measuring a 403 or a 404 and
     concluding things about a guard it never reached. §A proves they are open. */
  managedFounderStore.setCapabilityProfile(
    PARTNER_A,
    { classified: true, paysOnBehalf: true },
    MANAGING,
  );
  partnerAttributionStore.create(PARTNER_A, COMPANY, MANAGING);
});

/* ─────────────────────────────────────────────────────────────────────────── */
describe("W284 §0 — no mail leaves this run", () => {
  it("a driven send returns a dry_ id", async () => {
    expect(getConfig().mode).toBe("dry_run");
    const out = await sendMail({ to: "nobody@capavate.test", subject: "W284 probe", html: "<p>probe</p>" });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION A — PRECONDITIONS. THE ROUTE REALLY WRITES, AND IT WRITES EXACTLY
   WHAT IT WAS GIVEN.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §A — a valid rebill is recorded, unchanged, in SQLite", () => {
  it("PRECONDITION — 201, and the stored row carries the exact minor amount sent", async () => {
    const before = rowCount();
    const r = await post("/api/partner/me/mfcrm/acct/rebill", {
      companyId: COMPANY,
      description: "W284 A valid filing fee",
      amountMinor: 125000,
      currency: "USD",
    });
    /* Status AND body in one assertion so a capability or attribution failure
       PRINTS its code rather than showing up as "expected 201, got 403". */
    expect(`${r.status} ${String(r.body?.error ?? "-")}`).toBe("201 -");

    const row = rowByDescription("W284 A valid filing fee");
    expect(row).toBeTruthy();
    expect(String(row?.amount_minor)).toBe("125000");
    expect(String(row?.currency)).toBe("USD");
    expect(String(row?.status)).toBe("pending");
    expect(rowCount()).toBe(before + 1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION B — OVER-REACH. A GENUINE ZERO IS NOT A LIE AND IS STILL RECORDED.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §B — the fix does not eat a real zero", () => {
  it("amountMinor: 0 is ACCEPTED and stored as 0", async () => {
    const before = rowCount();
    const r = await post("/api/partner/me/mfcrm/acct/rebill", {
      companyId: COMPANY,
      description: "W284 B genuinely free courier",
      amountMinor: 0,
      currency: "USD",
    });
    expect(`${r.status} ${String(r.body?.error ?? "-")}`).toBe("201 -");

    const row = rowByDescription("W284 B genuinely free courier");
    expect(row).toBeTruthy();
    expect(String(row?.amount_minor)).toBe("0");
    expect(rowCount()).toBe(before + 1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION C — UNDER-REACH. EIGHT WAYS OF NOT STATING AN AMOUNT, EACH REFUSED,
   EACH LEAVING THE TABLE UNCHANGED.
   ───────────────────────────────────────────────────────────────────────────── */
const REFUSED: Array<{ label: string; amountMinor: unknown; why: string }> = [
  { label: "absent", amountMinor: undefined, why: "the field never arrived" },
  { label: "null", amountMinor: null, why: "Number(null) was 0" },
  { label: "empty string", amountMinor: "", why: "Number('') was 0" },
  { label: "non-numeric string", amountMinor: "abc", why: "Number('abc') was NaN, then the explicit : 0" },
  { label: "empty array", amountMinor: [], why: "Number([]) was 0" },
  { label: "false", amountMinor: false, why: "Number(false) was 0" },
  { label: "fractional", amountMinor: 1250.7, why: "Math.trunc silently adjusted it to 1250" },
  { label: "negative", amountMinor: -5, why: "a negative expense is not an expense" },
];

describe("W284 §C — an amount that was never stated is refused, and nothing is written", () => {
  it("all eight bodies are refused and the table is unchanged after every one", async () => {
    const before = rowCount();
    /* PRECONDITION: there IS something in the table. A count that is zero before
       and zero after would satisfy "unchanged" while proving nothing about
       whether the route can write at all. §A and §B put two rows here. */
    expect(before).toBeGreaterThan(0);

    const observed: string[] = [];
    for (const c of REFUSED) {
      const body: Record<string, unknown> = {
        companyId: COMPANY,
        description: `W284 C refused ${c.label}`,
        currency: "USD",
      };
      if (c.label !== "absent") body.amountMinor = c.amountMinor;

      const r = await post("/api/partner/me/mfcrm/acct/rebill", body);
      observed.push(`${c.label}=${r.status}`);

      /* NO ROW. Read back by the description this call carried, with rawDb(). */
      expect(rowByDescription(`W284 C refused ${c.label}`)).toBeUndefined();
      /* AND THE WHOLE TABLE IS THE SAME SIZE, so nothing landed under any other
         description either. Checked after EACH case, not once at the end. */
      expect(`${c.label}:${rowCount()}`).toBe(`${c.label}:${before}`);
    }

    /* THE COUNT, ASSERTED — not "a refusal exists". Eight cases, eight 400s. */
    expect(observed.join(" ")).toBe(
      "absent=400 null=400 empty string=400 non-numeric string=400 " +
        "empty array=400 false=400 fractional=400 negative=400",
    );
    expect(observed).toHaveLength(8);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION D — THE FALSE EXPLANATION. THE USER IS TOLD THE RIGHT REASON.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §D — the refusal is 400 with a true explanation, never a 403", () => {
  it("the code, the status, and the sentence the user reads", async () => {
    const r = await post("/api/partner/me/mfcrm/acct/rebill", {
      companyId: COMPANY,
      description: "W284 D false explanation probe",
      amountMinor: null,
      currency: "USD",
    });

    /* NOT 403. Stated on its own line and not merely implied by `toBe(400)`,
       because 403 is the specific wrong answer this branch exists to prevent:
       "you are not allowed" for a body that stated no amount. */
    expect(r.status).not.toBe(403);
    expect(r.status).toBe(400);

    expect(String(r.body.error)).toContain("REBILL_MONEY_NOT_INTEGER_MINOR:amountMinor:");
    /* The value that arrived is IN the code, so an operator reading a log can
       see what was sent rather than guessing. */
    expect(String(r.body.error)).toBe("REBILL_MONEY_NOT_INTEGER_MINOR:amountMinor:object:null");

    /* WHAT THE USER READS. Not a variable name, not a code — the sentence. It
       must name the amount as the missing thing and must promise no rounding. */
    const message = String(r.body.message ?? "");
    expect(message.length).toBeGreaterThan(0);
    expect(message).toContain("Enter the expense amount before recording it");
    expect(message).toContain("never rounded or assumed");
    /* And it must NOT tell them this is a permission problem. */
    expect(message.toLowerCase()).not.toContain("permission");
    expect(message.toLowerCase()).not.toContain("not allowed");
    expect(message.toLowerCase()).not.toContain("authori");

    expect(rowByDescription("W284 D false explanation probe")).toBeUndefined();
  });

  it("a genuine authority denial is STILL 403 — the 400 branch did not widen", async () => {
    /* THE OVER-REACH GUARD ON THE MAPPER ITSELF. `startsWith` on one specific
       prefix must not have turned every persona refusal into a 400. Custody is
       gated by `documentCustody`, which this partner does NOT have, and that is
       a real authority denial that must stay 403 and fail closed. */
    const r = await post("/api/partner/me/mfcrm/acct/custody", {
      companyId: COMPANY,
      docRef: "doc_w284_denied",
      docType: "invoice",
    });
    expect(`${r.status} ${String(r.body?.error ?? "-")}`).toBe("403 DOCUMENT_CUSTODY_REQUIRED");
  });

  it("the pre-existing validation refusals are untouched", async () => {
    /* Description is still a 400 through the exact-equality set. The new
       `startsWith` branch sits after it and must not have displaced it. */
    const r = await post("/api/partner/me/mfcrm/acct/rebill", {
      companyId: COMPANY,
      description: "   ",
      amountMinor: 5000,
      currency: "USD",
    });
    expect(`${r.status} ${String(r.body?.error ?? "-")}`).toBe("400 DESCRIPTION_REQUIRED");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION E — WHAT THE LIST ROUTE SHOWS AFTERWARDS.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W284 §E — the pending list contains only the amounts that were really stated", () => {
  it("exactly the two accepted rows, with their exact amounts", async () => {
    const r = await get(`/api/partner/me/mfcrm/acct/rebill?companyId=${COMPANY}`);
    expect(r.status).toBe(200);
    const rows = r.body.rebills as Array<Record<string, unknown>>;
    const mine = rows
      .filter((x) => String(x.description).startsWith("W284 "))
      .map((x) => `${String(x.description)}=${String(x.amount_minor)}`)
      .sort();
    /* THE COUNT AND THE CONTENT. Under the old code there would be ten rows
       here, eight of them fabricated zeros and one silently truncated. */
    expect(mine).toEqual([
      "W284 A valid filing fee=125000",
      "W284 B genuinely free courier=0",
    ]);
    expect(mine).toHaveLength(2);
  });
});
