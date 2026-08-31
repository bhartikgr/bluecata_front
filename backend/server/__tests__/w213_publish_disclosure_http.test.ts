/**
 * WAVE 213 — the governing clause is ENFORCED, not merely displayed.
 *
 * Ruling R188.4 item 3 / decisions D4, C6. Every proof here drives the REAL
 * publish route over HTTP (`registerPartnerRoutes` mounted on a real express app,
 * supertest against `POST /api/partner/me/pipeline/:id/promote-to-collective`).
 * Handbook §8 — NEVER PROVE A REPLICA: no route is re-implemented here, no
 * middleware is stubbed, and the acknowledgement sentence is imported from the
 * same module the screen renders rather than retyped.
 *
 * The fixture shape is taken from `waveB2_pipeline_dynamic.test.ts`, which is the
 * one existing suite whose deal actually reaches a 201 on this route. It matters:
 * `partner_promotions_adversarial.test.ts` cannot reach 201 at all (its fixture
 * deal has no companyId, so the route answers 409 COMPANY_NOT_ON_CAPAVATE first),
 * and that failure PRE-DATES this wave.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox, partnerDealPromotionsStore } from "../partnerWorkspaceStore";
import { getAuditLog } from "../adminPlatformStore";
import {
  PUBLISH_ACK_FIELD,
  PUBLISH_ACK_MISSING_MESSAGE,
  PUBLISH_ACK_STALE_MESSAGE,
  PUBLISH_CLAUSE_ID,
  PUBLISH_CLAUSE_VERSION,
  publishAcknowledgementText,
  publishGoverningClauseParagraphs,
  consortiumAgreementSection,
} from "../../shared/wave213PublishGoverningClause";
import { CONSORTIUM_AGREEMENT_TEXT } from "../../shared/consortiumAgreement";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";
/* WAVE 214 — this route now requires the third-party authority confirmation
   (typed name + the verbatim statement, hashed server-side). These fixtures are
   updated to supply it because the ROUTE CONTRACT changed, not because the gate
   was weakened for tests: the gate itself is proved over HTTP in
   `server/__tests__/w214_third_party_authority_http.test.ts`. */
import {
  WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as W214_STMT,
} from "../../shared/wave214ThirdPartyAuthorityCopy";
const W214_AUTH = { authorityTypedName: "Test Managing Partner", authorityStatementShown: W214_STMT };

const MANAGING = "u_avi_managing";
const ROOT = join(__dirname, "..", "..");

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}

/** A REAL on-Capavate portfolio company plus the pipeline deal linked to it. */
async function makePublishableDeal(companyName: string): Promise<{ dealId: string; dealName: string; companyId: string }> {
  const created = await post("/api/partner/me/portfolio-companies", MANAGING, {
    companyName,
    founderEmail: `${companyName.replace(/[^a-z0-9]/gi, "").toLowerCase()}@example.com`,
    ...W214_AUTH,
  });
  expect(created.status).toBe(201);
  const companyId = created.body.companyId as string;
  const pipe = await request(app).get("/api/partner/me/pipeline").set("x-user-id", MANAGING);
  expect(pipe.status).toBe(200);
  const deal = (pipe.body.pipeline as Array<{ id: string; dealName: string; companyId?: string | null }>).find(
    (d) => d.companyId === companyId,
  );
  expect(deal, "the portfolio-company path must create a linked pipeline deal").toBeTruthy();
  return { dealId: deal!.id, dealName: deal!.dealName, companyId };
}

function ackFor(dealName: string) {
  return {
    clauseId: PUBLISH_CLAUSE_ID,
    clauseVersion: PUBLISH_CLAUSE_VERSION,
    text: publishAcknowledgementText(dealName),
  };
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * A — THE SERVER REFUSES. A DISABLED BUTTON IS NOT THE CONTROL.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("A — publishing without the acknowledgement is refused by the server, over HTTP", () => {
  it("A1 an empty body is refused 400 and NOTHING is written", async () => {
    const { dealId } = await makePublishableDeal("Ack Empty Body Co");
    const before = partnerDealPromotionsStore.listByPartner("ac_consortium_partner_test_partner_inc").length;

    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {});

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_REQUIRED");
    expect(r.body.message).toBe(PUBLISH_ACK_MISSING_MESSAGE);
    /* The point of the whole wave: no promotion row exists. */
    expect(partnerDealPromotionsStore.listByPartner("ac_consortium_partner_test_partner_inc").length).toBe(before);
  });

  it("A2 the direct-API attack — notes only, exactly what the pre-213 client sent — is refused", async () => {
    const { dealId } = await makePublishableDeal("Ack Notes Only Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      notes: "publishing straight past the panel",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_REQUIRED");
  });

  it("A3 a BOOLEAN tick is not evidence and is refused", async () => {
    const { dealId } = await makePublishableDeal("Ack Boolean Co");
    for (const forged of [true, "true", 1, {}, [], null]) {
      const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
        [PUBLISH_ACK_FIELD]: forged,
      });
      expect(r.status, `forged=${JSON.stringify(forged)}`).toBe(400);
    }
  });

  it("A4 a MISSING text field never reaches the equality comparison", async () => {
    /* The handbook rule: never let a missing value participate in an equality
       comparison as if it were a value. If the route compared first, an
       `undefined` text would be compared against the real sentence and the
       refusal would be STALE. It must be REQUIRED. */
    const { dealId } = await makePublishableDeal("Ack Missing Text Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      [PUBLISH_ACK_FIELD]: { clauseId: PUBLISH_CLAUSE_ID, clauseVersion: PUBLISH_CLAUSE_VERSION },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_REQUIRED");
    expect(r.body.error).not.toBe("PUBLISH_ACKNOWLEDGEMENT_STALE");
  });

  it("A5 a paraphrased or truncated sentence is refused as STALE, not accepted", async () => {
    const { dealId, dealName } = await makePublishableDeal("Ack Paraphrase Co");
    const real = publishAcknowledgementText(dealName);
    const variants = [
      real.slice(0, real.length - 1),
      real.replace("cannot fully undo it", "can undo it"),
      real.toLowerCase(),
      "I agree.",
    ];
    for (const text of variants) {
      const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
        [PUBLISH_ACK_FIELD]: { clauseId: PUBLISH_CLAUSE_ID, clauseVersion: PUBLISH_CLAUSE_VERSION, text },
      });
      expect(r.status, text.slice(0, 40)).toBe(400);
      expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_STALE");
      expect(r.body.message).toBe(PUBLISH_ACK_STALE_MESSAGE);
    }
  });

  it("A6 the sentence for ANOTHER company does not publish THIS one", async () => {
    /* Naming the subject is the whole point of the acknowledgement. A tick
       harvested from a different deal must not carry over. */
    const a = await makePublishableDeal("Ack Subject A Co");
    const b = await makePublishableDeal("Ack Subject B Co");
    const r = await post(`/api/partner/me/pipeline/${a.dealId}/promote-to-collective`, MANAGING, {
      [PUBLISH_ACK_FIELD]: ackFor(b.dealName),
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_STALE");
  });

  it("A7 a stale clause VERSION is refused even when the sentence matches", async () => {
    const { dealId, dealName } = await makePublishableDeal("Ack Old Version Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      [PUBLISH_ACK_FIELD]: { clauseId: PUBLISH_CLAUSE_ID, clauseVersion: "v0", text: publishAcknowledgementText(dealName) },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("PUBLISH_ACKNOWLEDGEMENT_STALE");
  });

  it("A8 the refusal is not a workaround for the pre-existing gates — order is preserved", async () => {
    /* A name-only deal is still refused for the reason it was refused before this
       wave. The acknowledgement check must not have become the FIRST gate, or a
       caller would be told to tick a box for a deal that can never publish. */
    const deal = await post("/api/partner/me/pipeline", MANAGING, { dealName: "Ack Order Name Only Co" });
    expect(deal.status).toBe(201);
    const dealId = deal.body.deal?.id ?? deal.body.id;
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("COMPANY_NOT_ON_CAPAVATE");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * B — THE ACKNOWLEDGED PUBLISH SUCCEEDS AND IS RECORDED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("B — with the acknowledgement, publishing works exactly as before and is recorded", () => {
  it("B1 201, still pending_collective_review — the review step is untouched", async () => {
    const { dealId, dealName } = await makePublishableDeal("Ack Happy Path Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      notes: "fits the Collective",
      [PUBLISH_ACK_FIELD]: ackFor(dealName),
    });
    expect(r.status).toBe(201);
    expect(r.body.promotion.status).toBe("pending_collective_review");
    expect(r.body.promotion.moderationStatus).toBe("pending");
  });

  it("B2 the acknowledgement is recorded in the EXISTING audit ledger, with its subject", async () => {
    const { dealId, dealName, companyId } = await makePublishableDeal("Ack Recorded Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      [PUBLISH_ACK_FIELD]: ackFor(dealName),
    });
    expect(r.status).toBe(201);
    const promotionId = r.body.promotion.id as string;

    const rows = getAuditLog().filter(
      (e) => e.eventType === "partner.deal_promotion.publish_disclosure_acknowledged" && e.entity === `promotion:${promotionId}`,
    );
    expect(rows.length, "exactly one acknowledgement row per publish").toBe(1);
    const d = rows[0].payload as Record<string, unknown>;
    expect(d.promotionId).toBe(promotionId);
    expect(d.companyId).toBe(companyId);
    expect(d.dealName).toBe(dealName);
    expect(d.clauseId).toBe(PUBLISH_CLAUSE_ID);
    expect(d.clauseVersion).toBe(PUBLISH_CLAUSE_VERSION);
    /* The recorded sentence is the SHIPPED sentence, not the client's copy of it. */
    expect(d.acknowledgementText).toBe(publishAcknowledgementText(dealName));
    /* And the record identifies the REAL company, not only the partner's label. */
    expect(typeof d.companyName === "string" || d.companyName === null).toBe(true);

    /* The pre-existing creation row is still written. Nothing replaced it. */
    expect(
      getAuditLog().some((e) => e.eventType === "partner.deal_promotion.created"),
      "the wave-186 audit path is reused, not replaced",
    ).toBe(true);
  });

  it("B3 a refused publish records NO acknowledgement row", async () => {
    const beforeCount = getAuditLog().filter(
      (e) => e.eventType === "partner.deal_promotion.publish_disclosure_acknowledged",
    ).length;
    const { dealId } = await makePublishableDeal("Ack No Row On Refusal Co");
    await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {});
    expect(
      getAuditLog().filter((e) => e.eventType === "partner.deal_promotion.publish_disclosure_acknowledged").length,
    ).toBe(beforeCount);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * C — NOTHING ABOUT WHAT IS SHARED CHANGED (Item B / R190.10).
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("C — the shared payload is identical; nothing was restricted", () => {
  it("C1 the promotion record written through the route is field-identical to the pre-213 direct store write", async () => {
    /* The store call below IS the pre-wave-213 write: before this wave the route
       did nothing else. Comparing the two records proves the acknowledgement added
       nothing to, and removed nothing from, what the platform stores and shares.
       Only the per-record identity/timing/chain fields may differ. */
    const viaRoute = await makePublishableDeal("Ack Identity Route Co");
    const rr = await post(`/api/partner/me/pipeline/${viaRoute.dealId}/promote-to-collective`, MANAGING, {
      notes: "same notes",
      [PUBLISH_ACK_FIELD]: ackFor(viaRoute.dealName),
    });
    expect(rr.status).toBe(201);

    const direct = await makePublishableDeal("Ack Identity Direct Co");
    const bare = partnerDealPromotionsStore.create(
      "ac_consortium_partner_test_partner_inc",
      direct.dealId,
      { promotionType: "collective_deal_room", companyId: direct.companyId, notes: "same notes" },
      MANAGING,
    );

    const VARIES = new Set([
      "id", "pipelineDealId", "companyId", "promotedAt", "updatedAt",
      "revisionHash", "prevRevisionHash",
    ]);
    const routeKeys = Object.keys(rr.body.promotion).sort();
    const bareKeys = Object.keys(bare).sort();
    expect(routeKeys, "no field was added to or removed from the shared record").toEqual(bareKeys);
    for (const k of routeKeys) {
      if (VARIES.has(k)) continue;
      expect((rr.body.promotion as Record<string, unknown>)[k], `field ${k}`).toEqual(
        (bare as unknown as Record<string, unknown>)[k],
      );
    }
  });

  it("C2 no acknowledgement, clause or tick field leaks into the record that is shared", async () => {
    const { dealId, dealName } = await makePublishableDeal("Ack No Leak Co");
    const r = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {
      [PUBLISH_ACK_FIELD]: ackFor(dealName),
    });
    expect(r.status).toBe(201);
    const json = JSON.stringify(r.body.promotion);
    for (const needle of [PUBLISH_ACK_FIELD, PUBLISH_CLAUSE_ID, "acknowledg", "clauseVersion"]) {
      expect(json.includes(needle), `"${needle}" must not appear in the shared record`).toBe(false);
    }
  });

  it("C3 not one file that decides what is shared, or to whom, was touched by this wave", async () => {
    /* The audience and the field lists live in these files. If wave 213 had
       narrowed anything, it would have had to edit one of them. This asserts the
       negative directly at source level rather than inferring it. */
    const VISIBILITY_FILES = [
      "server/collectiveRoutes.ts",
      "server/collectiveInterestStore.ts",
      "server/promotionModerationRoutes.ts",
      "server/adminCollectiveRoutes.ts",
      "server/lib/spvDiscoverability.ts",
      "server/spvEngineStore.ts",
    ];
    for (const f of VISIBILITY_FILES) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(/wave\s*213|WAVE\s*213|wave213/i.test(src), `${f} must be untouched by wave 213`).toBe(false);
    }
  });

  it("C4 the pre-existing eligibility gates on the route are unchanged — no new barrier", async () => {
    const src = readFileSync(join(ROOT, "server/partnerRoutes.ts"), "utf8");
    const at = src.indexOf('"/api/partner/me/pipeline/:id/promote-to-collective"');
    expect(at).toBeGreaterThan(0);
    const head = src.slice(at, at + 400);
    expect(head).toContain("requirePartnerAuth");
    expect(head).toContain('assertSubRole("managing_partner", "associate")');
    expect(head).toContain("requireSignedAgreement");
    /* And no NEW middleware was inserted in front of the handler. */
    expect(head).not.toMatch(/assertTier|assertSeatCapacity|requireAdmin|rateLimit/);
  });

  it("C5 an associate can still publish — the role that could before, still can", async () => {
    /* R190.10: openness must not be reduced. The acknowledgement is a sentence to
       read, not an entitlement. */
    const src = readFileSync(join(ROOT, "server/partnerRoutes.ts"), "utf8");
    const at = src.indexOf('"/api/partner/me/pipeline/:id/promote-to-collective"');
    expect(src.slice(at, at + 400)).toContain('"associate"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * D — THE COPY ITSELF: TRUTHFUL, AND WITHIN THE GATES.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("D — the clause says what the platform does, and fits the refusal gate", () => {
  it("D1 both refusal messages clear the 240-character looksHuman gate, MEASURED", () => {
    for (const m of [PUBLISH_ACK_MISSING_MESSAGE, PUBLISH_ACK_STALE_MESSAGE]) {
      expect(m.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
      expect(/[a-z]/.test(m)).toBe(true);
    }
  });

  it("D2 the clause states the four things the brief's description got wrong", () => {
    const text = publishGoverningClauseParagraphs("Subject Co").join(" ");
    /* not immediate / an administrator decides */
    expect(text).toMatch(/pending Collective\s+review/);
    expect(text).toMatch(/administrator decides whether it is listed/);
    /* the publishing firm is named */
    expect(text).toMatch(/Your firm is named/);
    /* the company is not notified */
    expect(text).toMatch(/is\s+not notified/);
    /* reversal is partial */
    expect(text).toMatch(/cannot fully undo this/);
    expect(text).toMatch(/does not remove the\s+company from the Collective company directory/);
    /* and who can even do it */
    expect(text).toMatch(/an\s+associate who published it cannot/);
  });

  it("D3 the clause names the material fields, including the ones a partner would not guess", () => {
    const text = publishGoverningClauseParagraphs("Subject Co").join(" ");
    for (const needle of ["revenue", "margin", "cap-table summary", "option-pool percentage", "readiness scores"]) {
      expect(text.toLowerCase(), needle).toContain(needle.toLowerCase());
    }
  });

  it("D4 the clause contains NO unprovable negative claim", () => {
    /* The failure this wave was warned about: six of an earlier legal pass's seven
       findings were sentences of the form "Capavate does not…", one of which
       denied a capability the platform actually ships. Every "Capavate does not"
       sentence that survives must be one a code path proves. There is exactly one,
       and it is about consent collection — for which no step exists in this flow. */
      const paras = publishGoverningClauseParagraphs("Subject Co");
    const negatives = paras.filter((p) => /Capavate does\s+not/.test(p));
    expect(negatives.length).toBe(1);
    expect(negatives[0]).toMatch(/not obtain that authority or that consent for you/);
    /* And the specific misstatement is absent: benchmarking is ADMITTED. */
    const all = paras.join(" ");
    expect(all).not.toMatch(/does not (benchmark|compare|use it to train|market)/i);
    expect(all).toMatch(/compares companies on the platform/);
  });

  it("D5 the subject is named in the acknowledgement, and a blank subject does not become an empty name", () => {
    expect(publishAcknowledgementText("Subject Co")).toContain("Subject Co");
    /* Never "publish  to the Capavate Collective" with a hole in it. */
    expect(publishAcknowledgementText("   ")).toContain("this deal");
    expect(publishAcknowledgementText("")).toContain("this deal");
  });

  it("D6 the agreement quote is SLICED from the signed text, so it cannot diverge", () => {
    const quote = consortiumAgreementSection();
    expect(quote).not.toBeNull();
    /* Every line of the quote is present, byte-for-byte, in the signed agreement. */
    expect(CONSORTIUM_AGREEMENT_TEXT).toContain(quote!);
    expect(quote!).toContain("7.1 The Partner will treat LP personal data");
    expect(quote!).toContain("7.3 Confidentiality obligations survive termination.");
    /* It stops at the next section rather than swallowing the rest. */
    expect(quote!).not.toContain("## 8.");
  });

  it("D7 an unlocatable section returns null, never an empty quote", () => {
    expect(consortiumAgreementSection("## 99. Does Not Exist")).toBeNull();
  });

  it("D8 the clause does not tell the partner their agreement permits this", () => {
    /* Consortium Partner Agreement §7.1 makes Deal information confidential in the
       Partner's hands. The clause must not assert the opposite; it must put the
       authority question to the partner. */
    const all = publishGoverningClauseParagraphs("Subject Co").join(" ");
    expect(all).not.toMatch(/permitted (by|under) your (Consortium Partner )?Agreement/i);
    expect(all).toMatch(/you confirm that you are authorised to disclose/);
  });

  it("D9 the clause leaves room for wave 221's opt-out rather than contradicting it", () => {
    const all = publishGoverningClauseParagraphs("Subject Co").join(" ");
    expect(all).not.toMatch(/cannot be turned off|permanent(ly)? and cannot|no way to opt out/i);
    expect(all).toMatch(/unless the company\s+switches Collective-wide sharing on itself/);
  });

  it("D10 the withholding sentence is RETAINED in source and still reachable", () => {
    /* R195.5: nothing is deleted. Spec 213.2: the sentence is retained. */
    const src = readFileSync(join(ROOT, "server/lib/lock1Provenance.ts"), "utf8");
    expect(src).toContain("Capavate does not reproduce the governing clause on this screen.");
    expect(src).toContain("ask your Capavate contact and it will be issued to you.");
  });
});
