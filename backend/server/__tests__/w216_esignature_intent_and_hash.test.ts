/**
 * WAVE 216 — HALF TWO: THE BYTES ON THE WIRE ARE THE BYTES HASHED, AND A SIGNATURE
 * OVER ANY OTHER BYTES IS REFUSED.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * WHAT IS DRIVEN HERE, AND WHY IT IS NOT A REPLICA (handbook §8)
 * ════════════════════════════════════════════════════════════════════════════════
 * Real routes over real HTTP, through `registerEsignatureRoutes` — the SAME
 * registrar production calls, once, at `server/routes.ts:1608`. (`waveW11_en9`
 * test 6e independently proves that registrar is the only live one for these paths.)
 * Nothing below reimplements a route, a hash or a guard.
 *
 * Half one is `client/src/components/partner/__tests__/`
 * `w216_esign_rendered_bytes_are_signed_bytes.test.tsx`, which mounts the real
 * signing surface and proves the request carries the bytes the screen painted. The
 * two halves meet at the field `renderedStatementText`.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * NO NORMALISING CALL IN ANY EQUALITY ASSERTION. THE REASON.
 * ════════════════════════════════════════════════════════════════════════════════
 * There is no `.trim()`, no `.toLowerCase()`, no whitespace collapse and no
 * `.normalize()` on either side of any comparison in this file. R187.3 is a claim
 * about BYTES. The signing statement is a nine-line block joined by "\n", so a
 * whitespace-normalising comparison would let a one-line paraphrase compare equal to
 * the real statement — and the digest of a paraphrase is a completely different
 * digest. A tidied comparison proves only that two tidyings agree, which is not what
 * the signer assented to.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * THE FIVE INERT-PROOF MECHANISMS, AND WHERE EACH IS ADDRESSED
 * ════════════════════════════════════════════════════════════════════════════════
 *   a replica instead of the real thing ....... real registrar, real HTTP (above)
 *   a normalising call in an equality ......... none; raw `toBe` (above)
 *   a fixture no server mutation can move ..... H-2/H-3 assert the DB is UNCHANGED
 *                                               after each refusal, and H-4 asserts
 *                                               it CHANGED after the accepted one,
 *                                               so the fixture demonstrably moves
 *   a fence whose installation is unproved .... H-1 proves the marker event is
 *                                               actually written; H-6 proves an
 *                                               envelope without it is unaffected
 *   a filter keyed to the wrong field name .... every audit and event assertion is
 *                                               an exact COUNT, so it fails on ZERO
 *                                               rows as well as on two. The audit
 *                                               filter is keyed on `action`, which
 *                                               is the column
 *                                               `server/adminPlatformStore.ts`
 *                                               writes its `eventType` argument
 *                                               into — checked against the writer,
 *                                               not assumed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerEsignatureRoutes } from "../lib/esignatureRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  createEnvelope,
  esignSchemaInstalled,
  listEsignEvents,
  listRecipients,
  recordSignature,
  sendEnvelope,
  _resetEsignProvidersForTests,
  _resetEsignSchemaGuardForTests,
} from "../lib/esignatureStore";
import {
  buildWave216SignedStatement,
  WAVE216_CONSENT_SENTENCE,
  WAVE216_CONSENT_SENTENCE_FROZEN_FOR_TEST,
  WAVE216_INTENT_SENTENCE,
  WAVE216_INTENT_VERSION,
  WAVE216_REFUSAL_HASH_MISMATCH,
  WAVE216_REFUSAL_INTENT_REQUIRED,
  WAVE216_SES_INTENT_AS_SHIPPED,
  WAVE216_STATEMENT_BOUND_EVENT,
} from "../../shared/wave216SignedStatement";
import { ATTESTATION_TEXT_V1 } from "../../shared/spvAttestation";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

const OWNER_PARTNER = "ac_consortium_partner_test_partner_inc";
const MANAGING = "u_avi_managing";
const SIGNER_NAME = "Lp One Signatory";

let app: express.Express;
let spvId = "";

const post = (path: string, body?: unknown) =>
  request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});

/**
 * THE ONE HASH, restated here ONLY as an independent check on the server's stored
 * digest. It is not used as the source of any value the server is asked to accept:
 * every accepted signature below posts the STATEMENT TEXT and lets the route hash it.
 */
const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Rows straight out of the audit table, keyed on the column the writer writes. */
function auditRows(action: string, target: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(
      `SELECT id, actor_id AS actorId, action, target, payload_json AS payloadJson
         FROM audit_log WHERE action = ? AND target = ? ORDER BY id DESC`,
    )
    .all(action, target) as Array<Record<string, unknown>>;
}

/** Every recipient row for an envelope, straight out of the table. */
function recipientRows(envelopeId: string): Array<Record<string, unknown>> {
  return rawDb()
    .prepare(
      `SELECT id, status, signed_name AS signedName, signature_hash AS signatureHash,
              signed_at AS signedAt
         FROM esign_recipient WHERE envelope_id = ? ORDER BY signing_order`,
    )
    .all(envelopeId) as Array<Record<string, unknown>>;
}

/**
 * THE PARSED DETAIL OF THE ONE `recipient.signed` EVENT.
 *
 * A FIRST DRAFT OF THIS FILE READ `event.detail` AND FOUND `undefined`. The reader
 * `listEsignEvents` returns the column as `detailJson` — a JSON STRING — and there
 * is no `detail` property on `EsignEventRow` at all. That is the fifth inert-proof
 * mechanism arriving in this very file: a filter/accessor keyed to a field name the
 * writer never writes. `expect(undefined).toBe(...)` came back RED because these
 * assertions name exact values rather than testing for existence, so it was caught
 * here instead of shipping as a green test that asserted nothing. Recorded rather
 * than quietly corrected.
 */
function signedDetail(envelopeId: string, kind = "recipient.signed"): Record<string, unknown> {
  const rows = listEsignEvents(envelopeId).filter((e) => e.eventKind === kind);
  expect(rows.length, `exactly one ${kind} event`).toBe(1);
  return JSON.parse(String(rows[0].detailJson ?? "{}")) as Record<string, unknown>;
}

/**
 * A vehicle this partner owns, inserted the way `w148_esignature_guarded_reads_503`
 * inserts one — the table is `spv` (singular) and the ownership column the routes
 * authorise on is `sponsor_partner_id`. Read off the real schema, not guessed: a
 * first draft selected from a table named `spvs` and every create came back 404,
 * which is the anti-vacuity control earning its place.
 */
function makeOwnedVehicle(): string {
  const id = `spv_w216_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO spv (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
                        distribution_scope, currency, carry_basis, lp_visibility, created_at, updated_at,
                        archived_at, curr_hash)
       VALUES (?, ?, NULL, ?, 'spv', 'delaware', 'fundraising', 'private', 'USD', 'whole_spv', 'own_only', ?, ?, NULL, ?)`,
    )
    .run(id, OWNER_PARTNER, `W216 Vehicle ${id.slice(-6)}`, now, now, "0".repeat(64));
  return id;
}

beforeAll(() => {
  _resetEsignSchemaGuardForTests();
  _resetEsignProvidersForTests();
  /* 0168 into the :memory: db the sacred bootstrap builds without it. Same
     self-heal the wave 11 suite uses. */
  esignSchemaInstalled();

  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerEsignatureRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();

  spvId = makeOwnedVehicle();
});

/** Create an envelope through the REAL route, bound to a statement. */
async function createStatementBound() {
  const documentKind = "subscription_agreement";
  const documentRef = `drf_${randomUUID().slice(0, 8)}`;
  const documentTitle = "W216 Subscription Agreement";
  const statement = buildWave216SignedStatement({
    vehicleRef: spvId,
    documentKind,
    documentTitle,
    documentRef,
  });
  const r = await post(`/api/partner/me/spvs/${spvId}/esignature`, {
    documentKind,
    documentRef,
    documentTitle,
    documentStatementText: statement,
    recipients: [
      { role: "signer", signingOrder: 1, partyKind: "lp", fullName: SIGNER_NAME, email: "lp1@example.com" },
    ],
  });
  return { r, statement };
}

describe("W216 · the server hashes the posted statement and refuses anything else", () => {
  it("PRE-FLIGHT the sandbox really has an SPV this partner owns, and the route answers", async () => {
    /* ANTI-VACUITY. Every refusal assertion below would pass against a 404. This
       establishes the happy path FIRST, exactly as the wave 11 suite's Block 0 does,
       so a refusal test can never be satisfied by the route being unreachable. */
    expect(spvId, "a seeded SPV is required").not.toBe("");
    const { r } = await createStatementBound();
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(String(r.body?.envelope?.id ?? "")).not.toBe("");
  });

  it("H-1 the SERVER hashes the posted bytes, stores the digest, and records the binding", async () => {
    const { r, statement } = await createStatementBound();
    expect(r.status).toBe(201);
    const envelopeId = String(r.body.envelope.id);

    /* The stored digest is the digest of the bytes that were posted. Raw equality. */
    expect(r.body.envelope.documentSha256).toBe(sha256Hex(statement));
    /* And it is read back off the ROW, not off the response shape. */
    const row = rawDb()
      .prepare(`SELECT document_sha256 AS sha FROM esign_envelope WHERE id = ?`)
      .get(envelopeId) as { sha?: string };
    expect(row.sha).toBe(sha256Hex(statement));

    /* THE FENCE'S INSTALLATION IS PROVED, not assumed: exactly one marker event. */
    const marker = listEsignEvents(envelopeId).filter(
      (e) => e.eventKind === WAVE216_STATEMENT_BOUND_EVENT,
    );
    expect(marker.length, "exactly one statement-bound marker").toBe(1);

    /* The panel's honest "cannot prove which bytes were signed" warning is now
       correctly suppressed, because a hash IS bound. */
    expect(r.body.documentHashBound).toBe(true);
  });

  it("H-2 a signature with NO express intent is REFUSED, and nothing is written", async () => {
    const { r, statement } = await createStatementBound();
    const envelopeId = String(r.body.envelope.id);
    const recipientId = String(r.body.recipients[0].id);
    const target = `esign:${envelopeId}`;

    const before = recipientRows(envelopeId);
    const auditBefore = auditRows("esignature.signed", target).length;
    const eventsBefore = listEsignEvents(envelopeId).length;

    const sign = await post(`/api/partner/me/esignature/${envelopeId}/sign`, {
      recipientId,
      signedName: SIGNER_NAME,
      renderedStatementText: statement,
      /* Intent omitted entirely. */
    });
    expect(sign.status).toBe(422);
    expect(sign.body.error).toBe("ESIGN_INTENT_REQUIRED");
    expect(sign.body.message).toBe(WAVE216_REFUSAL_INTENT_REQUIRED);

    /* THE REFUSAL IS TRUE. Not "an error was returned" — nothing moved. */
    expect(recipientRows(envelopeId)).toStrictEqual(before);
    expect(auditRows("esignature.signed", target).length).toBe(auditBefore);
    expect(listEsignEvents(envelopeId).length).toBe(eventsBefore);
  });

  it("H-2b intent is accepted STRICTLY as boolean true — a truthy string is not consent", async () => {
    /* An express intent that a coercion could manufacture is not an express intent.
       `"true"`, `1` and `"yes"` are all truthy in JavaScript and all refused here. */
    for (const forged of ["true", 1, "yes", {}, [true]] as unknown[]) {
      const { r, statement } = await createStatementBound();
      const sign = await post(`/api/partner/me/esignature/${r.body.envelope.id}/sign`, {
        recipientId: r.body.recipients[0].id,
        signedName: SIGNER_NAME,
        renderedStatementText: statement,
        intentAcknowledged: forged,
      });
      expect(sign.status, `truthy ${JSON.stringify(forged)} must not pass as consent`).toBe(422);
      expect(sign.body.error).toBe("ESIGN_INTENT_REQUIRED");
    }
  });

  it("H-3 THE CORE INVARIANT — signing content whose hash does not match is REFUSED", async () => {
    /* THE ACTIVE ATTACK the brief asks for: try to sign content whose hash does not
       match what was rendered and stored. Five shapes, from a one-character change
       to a wholesale substitution. Every one is refused, and nothing is written. */
    const { r, statement } = await createStatementBound();
    const envelopeId = String(r.body.envelope.id);
    const recipientId = String(r.body.recipients[0].id);
    const target = `esign:${envelopeId}`;

    const before = recipientRows(envelopeId);
    const auditBefore = auditRows("esignature.signed", target).length;

    const attacks: Array<[string, unknown]> = [
      ["one trailing space", `${statement} `],
      ["one leading newline", `\n${statement}`],
      ["newlines collapsed to spaces", statement.replace(/\n/g, " ")],
      ["one word changed", statement.replace("intend to sign", "intend not to sign")],
      ["a plausible paraphrase", "I agree to sign this document."],
      ["the empty string", ""],
      ["omitted entirely", undefined],
      ["null", null],
      ["a number", 12345],
    ];

    for (const [label, tampered] of attacks) {
      const sign = await post(`/api/partner/me/esignature/${envelopeId}/sign`, {
        recipientId,
        signedName: SIGNER_NAME,
        intentAcknowledged: true,
        renderedStatementText: tampered,
      });
      expect(sign.status, `${label} must be refused`).toBe(422);
      expect(sign.body.error, label).toBe("ESIGN_STATEMENT_HASH_MISMATCH");
      expect(sign.body.message, label).toBe(WAVE216_REFUSAL_HASH_MISMATCH);
    }

    /* Nine attacks, nothing recorded. */
    expect(recipientRows(envelopeId)).toStrictEqual(before);
    expect(auditRows("esignature.signed", target).length).toBe(auditBefore);
  });

  it("H-4 the honest signature is ACCEPTED and its intent is stored beside the signature", async () => {
    /* THE FIXTURE MOVES. This is the same envelope shape H-2 and H-3 could not
       budge; with the right bytes and an express intent it goes through, so those
       refusals were the fence biting and not a broken route. */
    const { r, statement } = await createStatementBound();
    const envelopeId = String(r.body.envelope.id);
    const recipientId = String(r.body.recipients[0].id);
    const target = `esign:${envelopeId}`;

    const sign = await post(`/api/partner/me/esignature/${envelopeId}/sign`, {
      recipientId,
      signedName: SIGNER_NAME,
      intentAcknowledged: true,
      renderedStatementText: statement,
    });
    expect(sign.status, JSON.stringify(sign.body)).toBe(200);

    const rows = recipientRows(envelopeId);
    expect(rows.length).toBe(1);
    expect(rows[0].signedName).toBe(SIGNER_NAME);
    expect(String(rows[0].signatureHash ?? "")).not.toBe("");

    /* THE INTENT IS ON THE RECORD, in the EXISTING append-only event table, in the
       EXISTING `detail_json` column. Exact count — a `find` would be satisfied by a
       filter keyed on a name the writer never writes. */
    const detail = signedDetail(envelopeId);

    /* PINNED TO THE LITERAL AS WELL AS TO THE CONSTANT, on purpose. Comparing the
       stored value only against `WAVE216_INTENT_VERSION` is a tautology: change the
       constant and both sides move together, which a disarm proved by renaming the
       version to "v2" and staying GREEN. An evidence record's version label is
       exactly the kind of thing that must not drift silently, so the literal is
       written down here and a future wave that changes it has to come and say so. */
    expect(WAVE216_INTENT_VERSION).toBe("ESIGN-INTENT-v1");
    expect(detail.intentVersion).toBe("ESIGN-INTENT-v1");
    expect(detail.intentVersion).toBe(WAVE216_INTENT_VERSION);
    expect(detail.intentText).toBe(WAVE216_INTENT_SENTENCE);
    expect(detail.consentText).toBe(WAVE216_CONSENT_SENTENCE);
    /* The digest stored beside the signature is the digest of the bytes the signer's
       screen rendered — the same digest bound to the envelope at creation. */
    expect(detail.statementSha256).toBe(sha256Hex(statement));
    expect(detail.statementSha256).toBe(r.body.envelope.documentSha256);

    /* The keys the EXISTING event has always carried are still there, unchanged. */
    expect(detail.signingOrder).toBe(1);
    expect(detail.signatureHash).toBe(rows[0].signatureHash);

    /* Wave 186's audit writer, ONE row, with the appended keys and no second path. */
    const audits = auditRows("esignature.signed", target);
    expect(audits.length).toBe(1);
    const payload = JSON.parse(String(audits[0].payloadJson ?? "{}")) as Record<string, unknown>;
    expect(payload.esignIntentVersion).toBe("ESIGN-INTENT-v1");
    expect(payload.esignStatementSha256).toBe(sha256Hex(statement));
  });

  /**
   * ══════════════════════════════════════════════════════════════════════════════
   * H-5 / H-6 — EXISTING SIGNATURES MUST REMAIN VALID AND VERIFIABLE (handbook
   * §4.6/§4.7: ADD BESIDE, NEVER REWRITE, for hash-chained records).
   * ══════════════════════════════════════════════════════════════════════════════
   * `recordSignature()` derives `signature_hash` from a join over STORED COLUMNS and
   * seeds the completion chain from `document_sha256 ?? document_ref`. This wave adds
   * NOTHING to either construction — the intent is written to a separate append-only
   * event row — so a signature written before this wave re-derives to exactly the
   * same digest after it.
   *
   * Proving that against a signature written by TODAY's code would be circular. So
   * H-5 writes one the way the pre-wave world did (a raw `documentSha256`, through
   * the store, with no intent and no statement) and then re-derives its hash from the
   * row with the join spelled out, independently of the store.
   */
  it("H-5 a signature written the PRE-WAVE way still verifies, re-derived from its row", () => {
    const documentRef = `drf_legacy_${randomUUID().slice(0, 8)}`;
    const legacySha = "a".repeat(64);
    let env = createEnvelope({
      subjectKind: "spv",
      subjectId: spvId,
      documentKind: "lpa",
      documentRef,
      documentTitle: "Legacy LPA",
      documentSha256: legacySha,
      createdBy: "test:pre_wave_216",
      recipients: [
        { role: "signer", signingOrder: 1, partyKind: "lp", fullName: "Legacy Lp", email: "legacy@example.com" },
      ],
    });
    env = sendEnvelope(env.id, "test:pre_wave_216");
    const rcp = listRecipients(env.id)[0];

    /* NO `intent` argument at all — the exact call shape every pre-wave caller made.
       That it still compiles and still behaves is the point. */
    const out = recordSignature({
      envelopeId: env.id,
      recipientId: rcp.id,
      signedName: "Legacy Lp",
      actor: "test:pre_wave_216",
    });
    expect(out.recipient.signatureHash).toBeTruthy();

    /* RE-DERIVE from the stored row, with the join written out here rather than
       borrowed from the store, so this is a check and not a tautology. */
    const row = rawDb()
      .prepare(
        `SELECT r.email, r.signing_order AS signingOrder, r.signed_name AS signedName,
                r.signed_at AS signedAt, r.signature_hash AS signatureHash,
                e.id AS envId, e.document_kind AS documentKind,
                e.document_ref AS documentRef, e.document_sha256 AS documentSha256
           FROM esign_recipient r JOIN esign_envelope e ON e.id = r.envelope_id
          WHERE r.id = ?`,
      )
      .get(rcp.id) as Record<string, string | number | null>;

    const reDerived = sha256Hex(
      [
        row.envId,
        row.documentKind,
        row.documentRef,
        row.documentSha256 ?? "",
        String(row.signingOrder),
        row.email,
        row.signedName,
        row.signedAt,
      ].join("|"),
    );
    expect(reDerived, "a pre-wave signature must still verify against its own row").toBe(
      row.signatureHash,
    );

    /* And the intent keys are ABSENT rather than present-and-empty. An empty consent
       string in an evidence record would read as "they consented to nothing". */
    const detail = signedDetail(env.id);
    expect("intentText" in detail).toBe(false);
    expect("consentText" in detail).toBe(false);
    expect(detail.signingOrder).toBe(1);
    expect(detail.signatureHash).toBe(out.recipient.signatureHash);
  });

  it("H-6 an envelope with a RAW document hash and no statement signs exactly as before", async () => {
    /* THE FENCE IS SCOPED, and the scope is proved rather than described: an
       envelope created with `documentSha256` and no `documentStatementText` carries
       no statement-bound marker, so it needs neither intent nor rendered text. What
       could be signed before this wave can still be signed after it. */
    const r = await post(`/api/partner/me/spvs/${spvId}/esignature`, {
      documentKind: "lpa",
      documentRef: `drf_raw_${randomUUID().slice(0, 8)}`,
      documentTitle: "Raw-hash LPA",
      documentSha256: "b".repeat(64),
      recipients: [
        { role: "signer", signingOrder: 1, partyKind: "lp", fullName: "Raw Lp", email: "raw@example.com" },
      ],
    });
    expect(r.status).toBe(201);
    const envelopeId = String(r.body.envelope.id);
    expect(r.body.envelope.documentSha256).toBe("b".repeat(64));
    expect(
      listEsignEvents(envelopeId).filter((e) => e.eventKind === WAVE216_STATEMENT_BOUND_EVENT).length,
      "a raw-hash envelope must NOT be statement-bound",
    ).toBe(0);

    const sign = await post(`/api/partner/me/esignature/${envelopeId}/sign`, {
      recipientId: r.body.recipients[0].id,
      signedName: "Raw Lp",
      /* No intent. No rendered statement. Exactly the pre-wave request. */
    });
    expect(sign.status, JSON.stringify(sign.body)).toBe(200);
    expect(String(recipientRows(envelopeId)[0].signatureHash ?? "")).not.toBe("");
  });

  it("H-7 the marker cannot be forged away from the request side", async () => {
    /* A caller who wants to skip the fence would want the envelope to look unbound.
       The marker is not in the request — it is in the envelope's own append-only
       history — so posting the marker's own name, or a decoy, changes nothing. */
    const { r, statement } = await createStatementBound();
    const envelopeId = String(r.body.envelope.id);
    const sign = await post(`/api/partner/me/esignature/${envelopeId}/sign`, {
      recipientId: r.body.recipients[0].id,
      signedName: SIGNER_NAME,
      statementBound: false,
      documentSha256: "c".repeat(64),
      eventKind: WAVE216_STATEMENT_BOUND_EVENT,
      renderedStatementText: `${statement} tampered`,
      intentAcknowledged: true,
    });
    expect(sign.status).toBe(422);
    expect(sign.body.error).toBe("ESIGN_STATEMENT_HASH_MISMATCH");
  });

  it("H-8 NO NEW LEGAL PROSE: both sentences are the platform's own shipped wording", () => {
    /* The consent sentence is EXTRACTED from the shipped SPV launch attestation at
       runtime rather than retyped, so it cannot drift from what is actually shipped.
       This pins the extraction to the frozen copy AND to the live constant. */
    expect(ATTESTATION_TEXT_V1).toContain(WAVE216_CONSENT_SENTENCE);
    expect(WAVE216_CONSENT_SENTENCE).toBe(WAVE216_CONSENT_SENTENCE_FROZEN_FOR_TEST);
    expect(WAVE216_CONSENT_SENTENCE).toContain("ESIGN/UETA");

    /* The intent sentence is the shipped SES sentence with ONE noun substituted —
       the same construction `shared/spvAttestation.ts` used for its own v2. Pinned
       both ways: the substitution happened, and nothing else changed. */
    expect(WAVE216_SES_INTENT_AS_SHIPPED).toContain("the term sheet");
    expect(WAVE216_INTENT_SENTENCE).not.toContain("the term sheet");
    expect(WAVE216_INTENT_SENTENCE).toBe(
      WAVE216_SES_INTENT_AS_SHIPPED.replace("the term sheet", "the document identified above"),
    );
  });

  it("H-9 both refusal sentences pass the 240-character looksHuman gate", () => {
    for (const s of [WAVE216_REFUSAL_INTENT_REQUIRED, WAVE216_REFUSAL_HASH_MISMATCH]) {
      expect(s.length, s).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
      /* And they are sentences a partner can act on, not codes: no internal name,
         no table, no column (R77). */
      expect(s).not.toMatch(/esign_|document_sha256|ESIGN_[A-Z_]+|SELECT |sha256/);
      expect(s.trim().length).toBe(s.length);
    }
  });

  it("H-10 the statement the server hashes is the statement the SHARED builder makes", () => {
    /* One builder, both sides. If the server ever composed its own version of these
       bytes the client's rendered text would stop hashing to the stored digest, and
       H-3's refusals would start firing on honest signatures. This asserts the
       builder is deterministic and that its output is what gets hashed. */
    const facts = {
      vehicleRef: spvId,
      documentKind: "subscription_agreement",
      documentTitle: "W216 Subscription Agreement",
      documentRef: "drf_fixed",
    };
    expect(buildWave216SignedStatement(facts)).toBe(buildWave216SignedStatement(facts));
    const s = buildWave216SignedStatement(facts);
    expect(s.split("\n").length).toBe(9);
    expect(s.endsWith("\n")).toBe(false);
    expect(s).toContain(WAVE216_INTENT_SENTENCE);
    expect(s).toContain(WAVE216_CONSENT_SENTENCE);
  });
});
