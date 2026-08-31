/**
 * WAVE 214 — THIRD-PARTY DATA AUTHORITY, PROVED OVER REAL HTTP.
 *
 * Handbook §8, NEVER PROVE A REPLICA. Every proof in this file drives a real
 * express app with the PRODUCTION registrars mounted (`registerPartnerRoutes`,
 * `registerPartnerPortfolioCompanyRoutes`, `registerFounderTeamRoutes`) and
 * supertest over HTTP. No route is re-implemented here, no middleware is stubbed,
 * and every statement literal is IMPORTED from the same module the screens render
 * rather than retyped — a retyped literal proves the test agrees with itself.
 *
 * A note on what a disabled button is worth: nothing. The client gates in
 * `PartnerAddPortfolioCompany.tsx`, `PartnerTeam.tsx`, `CompanyManagement.tsx`
 * and `founder/Settings.tsx` are convenience. Section A attacks each route
 * directly with exactly the body the PRE-214 client sent, which is the real
 * attack: an unchanged client, or curl.
 *
 * Fixture shape for the portfolio-company route is taken from
 * `waveB1_add_portfolio_company.test.ts` and `w213_publish_disclosure_http.test.ts`,
 * the two suites that actually reach a 201 on it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import http from "node:http";
import { createHash } from "node:crypto";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
/* The founder surface needs `req.userContext`, which only the FULL production
   registrar installs. Mounting `registerFounderTeamRoutes` alone would answer 401
   before ever reaching the gate, and a 401 proves nothing about the gate — so the
   founder proofs below run against `registerRoutes`, the real thing (handbook §8
   and the brief: confirm the PRODUCTION registrar, not a convenient subset). */
import { registerRoutes } from "../routes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { getAuditLog } from "../adminPlatformStore";
import {
  WAVE214_AUDIT_EVENT,
  WAVE214_NOT_CAPTURED,
} from "../lib/wave214ThirdPartyAuthorityStore";
import {
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
  WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
  WAVE214_FOUNDER_TEAM_INVITE_AUTHORITY_STATEMENT,
  WAVE214_ERR_AUTHORITY_NOT_CONFIRMED,
  WAVE214_ERR_AUTHORITY_NAME_REQUIRED,
  wave214AuthorityMissingHeadline,
  wave214TypedNameMismatchHeadline,
  WAVE214_AUTHORITY_SURFACES,
} from "../../shared/wave214ThirdPartyAuthorityCopy";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

const MANAGING = "u_avi_managing";
const UA = "w214-proof-agent/1.0";

let app: express.Express;
/** The full production app, used for the founder surface. */
let fullApp: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).set("user-agent", UA).send(body ?? {});
}

/** The exact body the PRE-214 client sent to the create-company route. */
function legacyCompanyBody(name: string) {
  return {
    companyName: name,
    founderEmail: `${name.replace(/[^a-z0-9]/gi, "").toLowerCase()}@example.com`,
    founderName: "Third Party Human",
  };
}

/**
 * THE FILTER KEY IS THE FIFTH INERT-PROOF MECHANISM, so it is pinned here.
 *
 * `appendAdminAudit` → `appendAudit` builds an in-memory `AuditEntry` whose field
 * is **`eventType`** (see the interface at `server/adminPlatformStore.ts:459`).
 * The DB mirror calls the same thing `action`. A filter keyed on `action` against
 * `getAuditLog()` therefore matches NOTHING and every `.not.toContain` assertion
 * downstream of it passes against an empty array — a proof that cannot fail.
 *
 * So: this reads `eventType` only, `assertNonEmpty` is applied at EVERY call site
 * below, and `newRowsSince` makes the negative assertions run against a set that
 * is proved to contain the row under test.
 */
interface Row { id?: string; eventType?: string; payload?: unknown; entity?: string; actor?: string }

function auditRows(eventType: string): Row[] {
  return (getAuditLog() as Row[]).filter((r) => r.eventType === eventType);
}

/** Fails loudly on an empty set instead of letting a negative assertion coast. */
function assertNonEmpty(rows: Row[], why: string): Row[] {
  expect(rows.length, `EMPTY AUDIT SET — ${why}. An assertion over zero rows proves nothing.`).toBeGreaterThan(0);
  return rows;
}

function auditIds(eventType: string): Set<string> {
  return new Set(auditRows(eventType).map((r) => String(r.id)));
}

/** The rows that appeared after `before` — proved to be at least one. */
function newRowsSince(before: Set<string>, eventType: string): Row[] {
  const rows = auditRows(eventType).filter((r) => !before.has(String(r.id)));
  expect(rows.length, "the request under test wrote NO new audit row").toBeGreaterThan(0);
  return rows;
}

/** A company that really exists, created through the real partner route, so the
 *  founder proofs are not asserting against a companyId nobody has heard of. */
let realCompanyId = "";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });

  fullApp = express();
  fullApp.use(express.json());
  /* `registerRoutes(server, app)` — the two-argument production signature, taken
     from `w186_audit_write_end_to_end.test.ts`. It is async; awaiting it matters,
     because a floating promise here mounts the middleware stack AFTER the first
     request and every route answers 404. */
  const server = http.createServer(fullApp);
  await registerRoutes(server, fullApp);

  const co = await post("/api/partner/me/portfolio-companies", MANAGING, {
    ...legacyCompanyBody("Founder Gate Host Co"),
    authorityTypedName: "Ada Managing Partner",
    authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
  });
  realCompanyId = String(co.body?.companyId ?? "");
}, 180_000);

/* ══════════════════════════════════════════════════════════════════════════════
 * A — THE SERVER REFUSES. THE DIRECT-HTTP ATTACK.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("A — third-party data cannot be placed with no confirmation, over HTTP", () => {
  it("A1 create-company: the PRE-214 body — a real person's email, no confirmation — is refused 400", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, legacyCompanyBody("Unconfirmed Alpha Co"));
    expect(r.status).toBe(400);
    /* Nothing at all was confirmed — no statement, no name — so the refusal is
       the NOT_CONFIRMED one. NAME_REQUIRED is the narrower case in A2b, where the
       user demonstrably SAW the statement and left the name blank. Two distinct
       codes on purpose: "you skipped the step" and "you did the step wrong" are
       different problems and a single message would misdescribe one of them. */
    expect(r.body.error).toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
  });

  it("A2 create-company: a BLANK typed name and a WHITESPACE typed name are both refused", async () => {
    for (const typed of ["", "   ", "\t\n"]) {
      const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
        ...legacyCompanyBody("Unconfirmed Blank Co"),
        authorityTypedName: typed,
        authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      });
      expect(r.status, `typed name ${JSON.stringify(typed)} must not pass`).toBe(400);
      /* The correct statement WAS shown, so this is the narrow "name missing"
         refusal, not the broad "nothing confirmed" one. */
      expect(r.body.error).toBe(WAVE214_ERR_AUTHORITY_NAME_REQUIRED);
    }
  });

  it("A3 create-company: a NON-STRING typed name is refused, not coerced", async () => {
    /* R201.2's shape: invented data usually arrives as a zero, or as `true`.
       `String(true)` is a non-empty string, so a coercing implementation would
       accept a boolean as somebody's signature. */
    for (const forged of [true, 1, 0, {}, [], null, { name: "x" }]) {
      const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
        ...legacyCompanyBody("Unconfirmed Coerce Co"),
        authorityTypedName: forged,
        authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      });
      expect(r.status, `typed name ${JSON.stringify(forged)} must not pass`).toBe(400);
    }
  });

  it("A4 create-company: a typed name with the WRONG statement text is refused", async () => {
    /* A confirmation is a confirmation OF SOMETHING. If the client can send any
       text alongside the name, the recorded hash attests to whatever the client
       chose and the record is worthless. */
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      ...legacyCompanyBody("Wrong Statement Co"),
      authorityTypedName: "Ada Managing Partner",
      authorityStatementShown: "I confirm whatever is convenient.",
    });
    expect(r.status).toBe(400);
  });

  it("A5 create-company: a statement differing by ONE trailing space is refused (byte-for-byte)", async () => {
    /* NO NORMALISING CALL INSIDE AN EQUALITY ASSERTION, and none inside the
       server's comparison either. If the server trimmed, the hash it records
       would not be the hash of what it was sent. */
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      ...legacyCompanyBody("One Space Co"),
      authorityTypedName: "Ada Managing Partner",
      authorityStatementShown: `${WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT} `,
    });
    expect(r.status).toBe(400);
  });

  it("A6 partner team invitation: the PRE-214 body is refused 400", async () => {
    const r = await post("/api/partner/me/team/invitations", MANAGING, {
      email: "unconfirmed.colleague@example.com",
      subRole: "associate",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
  });

  it("A7 partner team invitation: a truthy-but-not-true tick is refused", async () => {
    for (const forged of ["true", 1, "yes", {}, [], "on"]) {
      const r = await post("/api/partner/me/team/invitations", MANAGING, {
        email: "forged.tick@example.com",
        subRole: "associate",
        authorityConfirmed: forged,
        authorityStatementShown: WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
      });
      expect(r.status, `tick ${JSON.stringify(forged)} must not pass`).toBe(400);
    }
  });

  it("A7b partner team invitation: a TICK with a statement differing by ONE trailing space is refused", async () => {
    /* FOUND BY THE DISARM HARNESS, NOT BY REVIEW. Mutation M4 replaced the tick
       path's byte-for-byte comparison with a trimmed 12-character prefix compare
       and every test still passed: A5 proves byte-for-byte on the TYPED-NAME
       path only, and the tick path had no equivalent. So a copy edit could have
       drifted the tick surface's on-screen wording away from the hash recorded
       against it and nothing would have failed. This is that missing proof.

       No normalising call on either side. A `.trim()` inside the server's
       comparison would make the recorded sha256 the hash of text the user was
       never shown. */
    for (const drift of [
      `${WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT} `,
      ` ${WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT}`,
      WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT.slice(0, -1),
      `${WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT}.`,
      WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT.replace(/\.$/, "!"),
    ]) {
      const r = await post("/api/partner/me/team/invitations", MANAGING, {
        email: "drifted.statement@example.com",
        subRole: "associate",
        authorityConfirmed: true,
        authorityStatementShown: drift,
      });
      expect(r.status, `drifted statement must not pass: ${JSON.stringify(drift.slice(-24))}`).toBe(400);
      expect(r.body.error).toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
    }
  });

  it("A8 founder team invitation: the PRE-214 body is refused 400 on the PRODUCTION registrar", async () => {
    /* This is the surface that actually contacts the third party — it calls
       `emailTransport.sendMail` and stamps `sent_at`. The refusal must land
       before the send, not after it, which is why the gate sits above the INSERT.

       `u_admin` is used because `ownsCompany()` short-circuits true for an admin
       context, so the request reaches the gate instead of stopping at the
       ownership check. That is the point: the LAST thing standing between a
       legacy body and a real email to a real stranger must be this gate. */
    const r = await request(fullApp)
      .post("/api/founder/team/invitations")
      .set("x-user-id", "u_admin")
      .set("user-agent", UA)
      .send({ companyId: realCompanyId, email: "unconfirmed.teammate@example.com" });
    expect(r.status, `body was ${JSON.stringify(r.body)}`).toBe(400);
    expect(r.body.error).toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
  });

  it("A9 founder team invitation: WITH the tick it proceeds past the gate (the gate is not a wall)", async () => {
    const r = await request(fullApp)
      .post("/api/founder/team/invitations")
      .set("x-user-id", "u_admin")
      .set("user-agent", UA)
      .send({
        companyId: realCompanyId,
        email: `confirmed.teammate.${Date.now()}@example.com`,
        authorityConfirmed: true,
        authorityStatementShown: WAVE214_FOUNDER_TEAM_INVITE_AUTHORITY_STATEMENT,
      });
    /* R190.10 — whatever this route did before for an authorised caller, it must
       still do. The one thing it must NOT do is answer with the authority
       refusal. */
    expect(r.body?.error).not.toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
    expect(r.status).not.toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B — THE HAPPY PATH STILL WORKS, AND THE ENVELOPE IS REAL.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("B — a confirmed submission succeeds and records a server-observed envelope", () => {
  let companyId: string;

  it("B1 create-company with a typed name and the verbatim statement returns 201", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      ...legacyCompanyBody("Confirmed Bravo Co"),
      authorityTypedName: "Ada Managing Partner",
      authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
    });
    expect(r.status).toBe(201);
    companyId = r.body.companyId as string;
    expect(companyId).toMatch(/^co_/);
    /* R190.10 — nothing was narrowed. The founder invite the route always
       produced is still produced. */
    expect(r.body.founderInvite?.claimUrl, "the founder invite must survive the gate").toBeTruthy();
  });

  it("B2 the audit row exists, on wave 186's writer, with no second store", async () => {
    const rows = assertNonEmpty(auditRows(WAVE214_AUDIT_EVENT), "the confirmation never reached the ledger");
    const mine = rows.find((r) => JSON.stringify(r.payload ?? {}).includes(companyId) || String(r.entity ?? "").includes(companyId));
    expect(mine, `no ${WAVE214_AUDIT_EVENT} row naming ${companyId}`).toBeTruthy();
  });

  it("B3 the envelope records the SHA-256 OF THE TEXT, and it is the hash of the real statement", async () => {
    const expected = createHash("sha256").update(WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT, "utf8").digest("hex");
    const rows = assertNonEmpty(auditRows(WAVE214_AUDIT_EVENT), "no confirmation rows to hash-check");
    expect(JSON.stringify(rows)).toContain(expected);
  });

  it("B4 the user agent is the one the SERVER OBSERVED on the request", async () => {
    const rows = assertNonEmpty(auditRows(WAVE214_AUDIT_EVENT), "no confirmation rows to read a UA from");
    expect(JSON.stringify(rows)).toContain(UA);
  });

  it("B5 a CLIENT-SUPPLIED ip, timestamp and hash are IGNORED, never trusted (R187.1)", async () => {
    const lie = "203.0.113.199";
    const lieTime = "1999-01-01T00:00:00.000Z";
    const lieHash = "deadbeef".repeat(8);
    const before = auditIds(WAVE214_AUDIT_EVENT);
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      ...legacyCompanyBody("Client Lies Co"),
      authorityTypedName: "Ada Managing Partner",
      authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      /* Every field a client might hope the server would believe. */
      ip: lie, ipAddress: lie, clientIp: lie, authorityIp: lie,
      confirmedAt: lieTime, authorityConfirmedAt: lieTime, timestamp: lieTime,
      statementSha256: lieHash, authorityStatementSha256: lieHash,
    });
    expect(r.status).toBe(201);
    /* The negative assertions run against THE ROW THIS REQUEST WROTE, proved to
       exist. Run against the whole ledger they would also pass if the gate had
       written nothing at all — mechanism 5 of the inert-proof family, and the
       reason `newRowsSince` refuses an empty diff. */
    const blob = JSON.stringify(newRowsSince(before, WAVE214_AUDIT_EVENT));
    expect(blob, "a client-supplied IP must never reach the ledger").not.toContain(lie);
    expect(blob, "a client-supplied timestamp must never reach the ledger").not.toContain(lieTime);
    expect(blob, "a client-supplied hash must never reach the ledger").not.toContain(lieHash);
    /* And positively: the row DID record an envelope, so the absence above is an
       absence of the LIE, not an absence of the whole capture. */
    expect(blob).toContain(createHash("sha256").update(WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT, "utf8").digest("hex"));
    expect(blob).toContain(UA);
  });

  it("B6 an unobservable IP is the explicit NOT_CAPTURED marker, never a fabricated address", async () => {
    /* R201.2 — a guard against MISSING data does not guard against INVENTED
       data. Under supertest the peer address is a loopback and IS observable, so
       this asserts the SHAPE of the contract: whatever appears, it is either a
       real observed value or the marker, and never an empty string that a later
       reader could mistake for an address. */
    const blob = JSON.stringify(assertNonEmpty(auditRows(WAVE214_AUDIT_EVENT), "no rows to inspect an IP capture on"));
    const hasMarkerOrAddress = blob.includes(WAVE214_NOT_CAPTURED) || /"ipCapture":"[^"]+"/.test(blob);
    expect(hasMarkerOrAddress).toBe(true);
    expect(blob, "an empty-string IP is the ambiguity the marker exists to prevent").not.toContain('"ipCapture":""');
  });

  it("B6b a FORGED X-Forwarded-For header is not stored as the confirmer's IP", async () => {
    /* Correction received mid-wave: `resolveRateLimitClientIp` only honours
       `X-Forwarded-For` from a peer in `TRUSTED_PROXY_IPS`, so this defence was
       ALREADY BUILT and this wave added none. The honest proof of an existing
       defence is therefore the negative one — the forged value is NOT stored —
       and this test claims nothing more than that. */
    const forged = "198.51.100.77";
    const before = auditIds(WAVE214_AUDIT_EVENT);
    const r = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", MANAGING)
      .set("user-agent", UA)
      .set("x-forwarded-for", forged)
      .send({
        ...legacyCompanyBody("Forged Header Co"),
        authorityTypedName: "Ada Managing Partner",
        authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      });
    expect(r.status).toBe(201);
    const blob = JSON.stringify(newRowsSince(before, WAVE214_AUDIT_EVENT));
    expect(blob, "an untrusted X-Forwarded-For must not become the recorded IP").not.toContain(forged);
  });

  it("B7 partner team invitation with the tick succeeds and still returns the one-time token", async () => {
    const r = await post("/api/partner/me/team/invitations", MANAGING, {
      email: `confirmed.colleague.${Date.now()}@example.com`,
      subRole: "associate",
      authorityConfirmed: true,
      authorityStatementShown: WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
    });
    expect(r.status).toBe(201);
    /* R190.10 — the one-time link is how the inviter actually delivers the
       invitation on this route. If the gate removed it, the gate broke the
       feature. */
    expect(r.body.plainToken, "the one-time invite link must survive the gate").toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * C — THE REFUSAL COPY IS HUMAN AND FITS THE GATE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("C — refusal copy", () => {
  it("C1 every headline is under the 240-character looksHuman gate", () => {
    const headlines = [
      wave214AuthorityMissingHeadline(WAVE214_AUTHORITY_SURFACES.partnerPortfolioCompany),
      wave214AuthorityMissingHeadline(WAVE214_AUTHORITY_SURFACES.founderTeamInvitation),
      wave214AuthorityMissingHeadline(WAVE214_AUTHORITY_SURFACES.partnerTeamInvitation),
      wave214TypedNameMismatchHeadline(),
    ];
    for (const h of headlines) {
      expect(h.length, `too long for the gate: ${h}`).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
      expect(h).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });

  it("C2 the refusal the server returns is the same sentence the copy module owns", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, legacyCompanyBody("Copy Match Co"));
    expect(r.status).toBe(400);
    /* Compared byte-for-byte with no normalising call on either side, because a
       normalised comparison would pass even if the server invented its own
       wording with different whitespace. */
    expect(r.body.message).toBe(wave214AuthorityMissingHeadline(WAVE214_AUTHORITY_SURFACES.partnerPortfolioCompany));
  });

  it("C3 the three statements are DIFFERENT texts — one generic sentence would be a lie on two surfaces", () => {
    const all = [
      WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
      WAVE214_FOUNDER_TEAM_INVITE_AUTHORITY_STATEMENT,
    ];
    expect(new Set(all).size).toBe(3);
    /* The founder route sends a real email; the partner route does not. The copy
       must not claim otherwise on the route that does not send one. */
    expect(WAVE214_FOUNDER_TEAM_INVITE_AUTHORITY_STATEMENT.toLowerCase()).toContain("email");
    expect(WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT.toLowerCase()).not.toContain("we will email");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * D — NOTHING WAS RESTRICTED (R190.10).
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("D — no field hidden, no audience narrowed, no eligibility added", () => {
  it("D1 the create-company response shape is unchanged apart from nothing", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      ...legacyCompanyBody("Shape Check Co"),
      authorityTypedName: "Ada Managing Partner",
      authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
    });
    expect(r.status).toBe(201);
    for (const key of ["ok", "companyId", "company", "attributedPartnerId", "founderInvite"]) {
      expect(Object.keys(r.body), `the pre-214 response lost ${key}`).toContain(key);
    }
  });

  it("D2 the gate adds no ROLE condition — the same sub-roles that could invite still can", async () => {
    /* The gate is placed AFTER the existing sub-role check on every surface, so a
       role that was allowed before is still allowed; it is asked one more
       question. A role that was refused is still refused with ITS OWN error, not
       with the authority error — which is how this test tells the two apart. */
    const r = await post("/api/partner/me/team/invitations", "u_partner_viewer", {
      email: "role@example.com",
      subRole: "associate",
      authorityConfirmed: true,
      authorityStatementShown: WAVE214_PARTNER_TEAM_INVITE_AUTHORITY_STATEMENT,
    });
    expect(r.status).not.toBe(500);
    if (r.status >= 400) {
      expect(r.body.error).not.toBe(WAVE214_ERR_AUTHORITY_NOT_CONFIRMED);
    }
  });
});
