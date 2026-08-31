/**
 * WAVE 226 · ITEM C(1) second half + ITEM C(2) — WHAT IS STORED, AND HOW OFTEN.
 * ════════════════════════════════════════════════════════════════════════════
 * Three things wave 211 left for a later wave to prove, proved here over real HTTP
 * against the real routes with a real database read-back:
 *
 *   S-1  R187.3 — the text READ BACK OUT OF STORAGE is the text the shared builder
 *        produces, byte for byte, and its digest describes it. This is the server
 *        half of the "rendered bytes == stored bytes" pair; the client half is
 *        `client/src/lib/__tests__/w226_attestation_rendered.test.tsx`, which reads
 *        the same paragraphs OUT OF THE DOM. The two halves meet at
 *        `buildWave211AttestationText`, which both sides call and neither retypes.
 *
 *   S-2  R187.1 — an attested DISTRIBUTION produces EXACTLY ONE audit row, and the
 *        actor on it is the one the SERVER observed, not one the body asked for.
 *        Wave 186 owns the invitation and commitment events; this file adds the two
 *        money events wave 186 does not cover.
 *
 *   S-3  the refusal is real over the wire, and it is TRUE: a distribution posted
 *        with no attestation is refused AND nothing is recorded — no distribution
 *        row, and no audit row either. A refusal that still wrote an audit row would
 *        be a refusal that told the ledger something happened.
 *
 * WHY THE COMPARISONS LOOK LIKE THIS
 * ----------------------------------
 * There is NO normalising call inside any equality assertion below. No `.trim()`,
 * no `.toLowerCase()`, no whitespace collapse. R187.3 is a claim about bytes: an
 * assertion that tidies both sides before comparing them proves only that the two
 * sides tidy to the same thing, which is not what the operator signed.
 *
 * WHY THE ROW COUNT IS A COUNT AND NOT A `find`
 * ---------------------------------------------
 * R201.2: a guard against MISSING data does not guard against INVENTED data. A
 * `find(...)` that returns `undefined` and an assertion that the row "exists" would
 * both be satisfied by a filter keyed on the wrong column name — the fifth way a
 * proof goes inert. Every audit assertion below therefore asserts an exact COUNT,
 * so it fails on zero rows AND on two.
 *
 * The audit filter is keyed on `action`, which is the column
 * `server/adminPlatformStore.ts` writes `eventType` into. That mapping was checked
 * against the writer, not assumed, and the count assertions would fail loudly if it
 * were ever wrong.
 *
 * ALREADY PROVED ELSEWHERE, cited rather than duplicated: that a forged
 * `w211AttestationSignedAt` / `w211AttestationIp` / `w211AttestationUserAgent` in the
 * body is NOT stored is wave 211's own proof B-2 in
 * `server/__tests__/wave211_money_event_gate_http.test.ts`. `clientIp()` only trusts
 * `X-Forwarded-For` from `TRUSTED_PROXY_IPS`, so the honest proof is that the forged
 * value does not reach storage — which is what B-2 asserts. This file does not
 * restate it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  wave211ReadAttestation,
  wave211StorageAvailable,
  wave211TextSha256,
} from "../wave211MoneyEventAttestationStore";
import {
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_VERSION,
  W211_EVENT_NOUN_DISTRIBUTION,
  buildWave211AttestationText,
  wave211AttestationVersion,
} from "../../shared/wave211MoneyEventAttestation";

const MANAGING = "u_avi_managing";
const SIGNED_NAME = "Avi Managing Partner";
/* THE ACTUAL ACTION NAME, read out of `wave211AuditAttestation`
   (`server/lib/wave211MoneyEventGate.ts:487`), not guessed.
   A first draft of this file asserted `spv.distribution_recorded` and found ZERO
   rows — and because the assertions below are exact COUNTS rather than a `find`,
   that came back RED instead of quietly passing. That is the fifth way a security
   proof goes inert (a filter keyed on a name the writer never writes) and it is
   worth recording that it was caught here rather than shipped. */
const W226_ATTESTED_ACTION = "spv.money_event.attested";
const BASIS = "Exit proceeds per the executed SPA, allocated pro rata to committed capital.";

let app: express.Express;
let seq = 0;

const post = (path: string, body?: unknown) =>
  request(app).post(path).set("x-user-id", MANAGING).send(body ?? {});
const put = (path: string, body?: unknown) =>
  request(app).put(path).set("x-user-id", MANAGING).send(body ?? {});

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/** Rows straight out of the table, keyed on the column the writer writes `eventType`
 *  into. Reading the raw table is deliberate: this file is about what was WRITTEN. */
function auditRows(action: string, target: string): Array<Record<string, any>> {
  return rawDb()
    .prepare(
      `SELECT id, actor_id AS actorId, action, target, payload_json AS payloadJson, created_at AS createdAt
         FROM audit_log WHERE action = ? AND target = ? ORDER BY id DESC`,
    )
    .all(action, target) as Array<Record<string, any>>;
}

function moneyEventConfirmation(): Record<string, unknown> {
  return {
    [W211_BODY_KEY_VERSION]: wave211AttestationVersion("money_event"),
    [W211_BODY_KEY_SIGNED_NAME]: SIGNED_NAME,
    [W211_BODY_KEY_TICK_1]: true,
    [W211_BODY_KEY_TICK_2]: true,
    [W211_BODY_KEY_TICK_3]: true,
    [W211_BODY_KEY_BASIS]: BASIS,
    [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
  };
}

/** A vehicle that could legitimately record a distribution today. Built only through
 *  the platform's own routes — never a direct store write (handbook §8). */
async function makeSpvWithCommittedLp(): Promise<{ spvId: string; name: string }> {
  const name = `W226 Vehicle ${seq++}`;
  const r = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    currency: "USD",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const spvId = r.body.spv.id as string;

  const investorId = `inv_w226_${seq++}`;
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, {
    investorId,
    commitmentMinor: 1_000_000,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  const adv = await request(app)
    .patch(`/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`)
    .set("x-user-id", MANAGING)
    .send({ to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status, JSON.stringify(adv.body)).toBe(200);
  return { spvId, name };
}

describe("W226 ITEM C — the stored attestation, and exactly one audit row", () => {
  it("the storage precondition holds for this test's schema (so a later failure is a GATE failure, not a missing column)", () => {
    /* Stated first and on purpose. The tree has two schema paths — `migrations/*.sql`
       and the inline bootstrap in `server/db/connection.ts` used by every :memory:
       test — and 0220's columns are absent from the bootstrap. Wave 211's store
       self-heals them per call. If this assertion ever fails, every failure below is
       "the column does not exist here", a DIFFERENT defect from "the gate refused",
       and must be fixed differently. */
    expect(wave211StorageAvailable("distribution")).toEqual({ ok: true });
  });

  it("S-1 R187.3 — the STORED text is the shared builder's text, byte for byte, and the digest describes it", async () => {
    const { spvId, name } = await makeSpvWithCommittedLp();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      event: "exit",
      grossProceedsMinor: 5_000_00,
      costBasisMinor: 2_000_00,
      currency: "USD",
      ...moneyEventConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const rec = wave211ReadAttestation("distribution", String(r.body.distribution.id));
    expect(rec, "the distribution was recorded but no attestation was stored beside it").toBeTruthy();

    /* The exact bytes the operator's screen builds for these same facts. Note the
       money fields: the recital states the figure AS ENTERED, which is why the facts
       carry the entered string and not a re-formatted number. */
    const expectedText = buildWave211AttestationText({
      kind: "money_event",
      eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
      vehicleName: name,
      eventType: "exit",
      /* MINOR UNITS, as the route received them. `pickDistributionBody` carries
         `grossProceedsMinor` through untouched and the gate normalises the figure
         with `wave211PlainDecimalOrNull` — it does NOT divide by 100. The recital
         therefore states the same integer the operator's form submitted, which is
         the honest thing for a platform that never converts (R156.1). */
      amountRaw: "500000",
      /* MINOR, not "as_entered". This is what the ROUTE passes, and it is the
         thing that makes the stored Amount line differ from the rendered one —
         see the S-4 finding below. */
      amountUnit: "minor",
      currency: "USD",
      eventDate: null,
    } as never);
    expect(expectedText.length).toBeGreaterThan(200);

    /* The load-bearing comparison. Every paragraph of the canonical text is present
       in the stored text with its own bytes intact — no paraphrase, no truncation,
       no re-wrap. Compared without any normalising call on either side. */
    for (const paragraph of expectedText.split("\n\n")) {
      expect(rec!.attestationText).toContain(paragraph);
    }
    /* And the operator's own inputs are in there verbatim, so this cannot pass on
       boilerplate alone. */
    expect(rec!.attestationText).toContain(name);
    expect(rec!.attestationText).toContain("500000");
    expect(rec!.signedName).toBe(SIGNED_NAME);
    expect(rec!.basis).toBe(BASIS);

    /* The digest describes THE STORED TEXT — not the text the server meant to store. */
    expect(rec!.attestationTextSha256).toBe(wave211TextSha256(rec!.attestationText));

    /* The negative control: a digest of DIFFERENT text must not match, or the line
       above would pass for any implementation of `wave211TextSha256`. */
    expect(rec!.attestationTextSha256).not.toBe(wave211TextSha256(rec!.attestationText + "."));
  });

  it("S-2 R187.1 — an attested distribution writes EXACTLY ONE audit row, with the actor the SERVER observed", async () => {
    const { spvId } = await makeSpvWithCommittedLp();
    const target = `spv:${spvId}`;
    const before = auditRows(W226_ATTESTED_ACTION, target).length;
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      event: "exit",
      grossProceedsMinor: 3_000_00,
      costBasisMinor: 1_000_00,
      currency: "USD",
      /* A browser trying to write the ledger's own evidence. */
      actorId: "u_someone_else",
      actor: "u_someone_else",
      ...moneyEventConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const rows = auditRows(W226_ATTESTED_ACTION, target);
    /* EXACTLY ONE more than before. A count, so this fails on zero rows — which is
       what an audit filter keyed on the wrong column name would produce — and on a
       duplicate, which would double-count a money event. */
    expect(
      rows.length - before,
      "an attested distribution must write exactly one audit row",
    ).toBe(1);
    /* The actor is the authenticated caller, NOT the one the body asked for. */
    expect(rows[0].actorId).toBe(MANAGING);
    expect(rows[0].actorId).not.toBe("u_someone_else");
    /* And the row carries a server timestamp, not a client one. */
    expect(String(rows[0].createdAt ?? "")).not.toBe("");
    expect(new Date(String(rows[0].createdAt)).getFullYear()).toBeGreaterThanOrEqual(2025);
  });

  it("S-3 a distribution posted over HTTP with NO attestation is refused, and NOTHING is recorded — not even an audit row", async () => {
    const { spvId } = await makeSpvWithCommittedLp();
    const target = `spv:${spvId}`;
    const distributionsBefore = spvEngineStore.listDistributions("ac_consortium_partner_test_partner_inc", spvId).length;
    const auditBefore = auditRows(W226_ATTESTED_ACTION, target).length;

    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      event: "exit",
      grossProceedsMinor: 9_000_00,
      costBasisMinor: 1_000_00,
      currency: "USD",
    });
    expect(r.status).toBe(400);
    /* The SPECIFIC refusal, not merely some refusal. */
    expect(String(r.body.error ?? "")).toMatch(/^WAVE211_/);
    /* The promise made to the operator, in the words they read. */
    expect(String(r.body.message ?? "")).toContain("Nothing was recorded.");

    /* The promise is TRUE, on both ledgers the operator would care about. */
    expect(
      spvEngineStore.listDistributions("ac_consortium_partner_test_partner_inc", spvId).length,
    ).toBe(distributionsBefore);
    expect(
      auditRows(W226_ATTESTED_ACTION, target).length,
      "a refused distribution must not tell the audit log that anything happened",
    ).toBe(auditBefore);
  });
  it("S-4 RESOLVED BY WAVE 216 — the divergence is closed at the call site, and this unit test says so", async () => {
    /* ═══════════════════════════════════════════════════════════════════════════════
       CHANGED ON PURPOSE BY WAVE 216. THE ORIGINAL WORDING IS KEPT BELOW.
       ═══════════════════════════════════════════════════════════════════════════════
       As shipped, wave 226 recorded this test as a FINDING and asserted the two
       Amount lines were NOT the same bytes:

         the SCREEN passed  amountUnit: "as_entered"  with the operator's typed
                            whole-unit string, e.g.  Amount: 250000.00 — exactly as
                            you entered it
         the ROUTE passed   amountUnit: "minor"       with the integer minor-unit
                            figure, e.g.  Amount: 25000000 — in the smallest unit of
                            the currency named below, exactly as this entry records it

       Both were honest and both labelled their unit, so nothing was misleading. But
       they were not the same bytes, so an auditor comparing a screenshot to the
       stored record would find a difference in the Amount line and nowhere else.
       Wave 226 pinned it rather than fixing it and said in terms: "the wave that
       resolves it must come here and change this test on purpose."

       WAVE 216 IS THAT WAVE, and this is that change. What it did:
         · added `wholeUnitsToWireOrNull` beside the existing throwing converter on
           `client/src/components/partner/SpvDetailTabs.tsx`, and
           `wholeUnitsToWireMinorOrNull` beside its sibling on
           `client/src/components/partner/PartnerMoneyEntryNotice.tsx`;
         · passed the resulting MINOR figure, with `amountUnit: "minor"`, to the
           attestation panels on the distribution and capital-call forms — the same
           figure those forms already put on the wire.
       No arithmetic was authored: `parseWholeUnits` / `toWireMinor` remain the only
       code that scales anything, in `bigint`.

       WHY THIS TEST STILL EXISTS AND WHAT IT NOW MEANS. It never touched a call site
       — it is a pure unit test over hardcoded literals — so `not.toBe` would have
       kept passing forever no matter what the screens did. Deleting it would erase
       the record of the finding (R195.5). It is therefore RETIRED IN PLACE and turned
       into the NEGATIVE CONTROL for the fix: the two unit labels must still produce
       distinguishable text, because that is what makes the resolution meaningful. If
       the labels ever collapsed into each other, agreement between screen and record
       would become unfalsifiable.

       WHERE THE RESOLUTION IS ACTUALLY PROVED — at the call site, not here:
         client/src/components/partner/__tests__/w216_amount_line_agrees.test.tsx
       That file mounts the real form, types a real figure, reads the Amount line OUT
       OF THE DOM and the figure OFF THE WIRE, and asserts they are the same bytes.
       Two mutations reverting this wave's change are RED against it.

       STILL NOT PROVED, stated rather than implied: the capital-call call site lives
       on `client/src/pages/partner/PartnerSpvDetail.tsx`, is fixed the same way by the
       same helper, and is NOT mounted by any test. W216_TESTS.md carries that gap. */
    const facts = {
      kind: "money_event" as const,
      eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
      vehicleName: "W226 Unit Note Vehicle",
      eventType: "exit",
      currency: "USD",
      eventDate: null,
    };
    const asRendered = buildWave211AttestationText({
      ...facts,
      amountRaw: "5000.00",
      amountUnit: "as_entered",
    } as never);
    const asStored = buildWave211AttestationText({
      ...facts,
      amountRaw: "500000",
      amountUnit: "minor",
    } as never);

    /* THE NEGATIVE CONTROL. The two unit labels must remain distinguishable — a
       resolution that worked by making every unit label identical would prove
       nothing and would make the divergence impossible to detect again. */
    expect(asStored).not.toBe(asRendered);

    /* And they still differ ONLY in the Amount line, so this control can never be
       satisfied by some new, unrelated drift. */
    const rendered = asRendered.split("\n\n");
    const stored = asStored.split("\n\n");
    expect(stored.length).toBe(rendered.length);
    const differing = rendered.filter((p, i) => p !== stored[i]);
    expect(differing.length).toBe(1);
    expect(differing[0].startsWith("Amount:")).toBe(true);

    /* THE POSITIVE SIDE OF THE SAME COIN, added by wave 216: given the SAME unit
       label, the builder produces the same bytes for the same figure. That is what
       lets the screen and the record agree once both pass `minor`. */
    const storedAgain = buildWave211AttestationText({
      ...facts,
      amountRaw: "500000",
      amountUnit: "minor",
    } as never);
    expect(storedAgain).toBe(asStored);
  });
});
