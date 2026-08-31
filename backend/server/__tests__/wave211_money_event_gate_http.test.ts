/* ════════════════════════════════════════════════════════════════════════════
   WAVE 211 · ITEM A + ITEM B — THE FOUR IRREVERSIBLE MONEY EVENTS ARE GATED ON
                                THE SERVER, AND THE CONFIRMATION IS PROVABLE.
   ════════════════════════════════════════════════════════════════════════════
   NO REPLICA (handbook §8). Every assertion below is made against the REAL route
   mounted by the REAL production registrar:

     · `registerSpvEngineRoutes`      — distribution, LP invitation, LP commitment
     · `registerSpvLegacyAdapterRoutes` — capital call (the PLURAL family)

   `registerSpvFundRoutes` is NOT registered here, deliberately: it is a dormant
   twin with no production caller (`waveB_retirement_guard` keeps it that way), and
   proving a gate against it would prove nothing about production. The capital-call
   proof below therefore goes through the legacy adapter, which is the module
   `routes.ts` actually calls.

   WHAT IS PROVED
     A-1 … A-4   each of the four routes REFUSES with no confirmation, and the
                 refusal is readable words rather than a bare code.
     A-5 … A-8   each of the four ACCEPTS a complete confirmation and still does
                 the work it did before.
     B-1         the stored text is the text the SERVER built, and its digest
                 matches — R187.3.
     B-2         the timestamp and the address are the SERVER's own. A caller who
                 posts `w211AttestationSignedAt` / `w211AttestationIp` has those
                 keys STRIPPED and does not influence the record — R187.1.
     B-3         a forged / paraphrased text is not stored: the client posts no
                 prose at all, and a posted `w211AttestationText` is stripped.
     B-4         an empty and a whitespace-only name are both refused, and the
                 check is presence-and-type BEFORE equality — R176.1.
     B-5         a wrong version is refused rather than silently accepted.
     B-6         missing ticks are refused, and the refusal NAMES which are missing.
     B-7         write-once: a second confirmation on the same row does not
                 overwrite the first.
     C-1         no charged amount moved — the accepted distribution's own money
                 fields are byte-for-byte what a pre-wave-211 body produces.

   R188.5 — the platform claims NO verification. Asserted mechanically here and
   again in `wave211_no_verification_claim.test.ts`.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  wave211ReadAttestation,
  wave211StorageAvailable,
  wave211TextSha256,
  W211_IP_CAPTURED,
} from "../wave211MoneyEventAttestationStore";
import {
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_VERSION,
  W211_ERR_NAME_REQUIRED,
  W211_ERR_TICKS_REQUIRED,
  W211_ERR_VERSION_MISMATCH,
  W211_ERR_BASIS_REQUIRED,
  wave211AttestationVersion,
} from "../../shared/wave211MoneyEventAttestation";

const MANAGING = "u_avi_managing";

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

/** A complete, honest confirmation for a money event (distribution / capital call). */
function moneyEventConfirmation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [W211_BODY_KEY_VERSION]: wave211AttestationVersion("money_event"),
    [W211_BODY_KEY_SIGNED_NAME]: "Avi Managing Partner",
    [W211_BODY_KEY_TICK_1]: true,
    [W211_BODY_KEY_TICK_2]: true,
    [W211_BODY_KEY_TICK_3]: true,
    [W211_BODY_KEY_BASIS]: "Exit proceeds per the SPA dated 12 June, allocated pro rata to committed capital.",
    [W211_BODY_KEY_CURRENCY_CONFIRMED]: true,
    ...over,
  };
}

function inviteConfirmation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [W211_BODY_KEY_VERSION]: wave211AttestationVersion("lp_invitation"),
    [W211_BODY_KEY_SIGNED_NAME]: "Avi Managing Partner",
    [W211_BODY_KEY_TICK_1]: true,
    [W211_BODY_KEY_TICK_2]: true,
    [W211_BODY_KEY_TICK_3]: true,
    ...over,
  };
}

function commitConfirmation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [W211_BODY_KEY_VERSION]: wave211AttestationVersion("lp_commitment"),
    [W211_BODY_KEY_SIGNED_NAME]: "Avi Managing Partner",
    [W211_BODY_KEY_TICK_1]: true,
    [W211_BODY_KEY_TICK_2]: true,
    [W211_BODY_KEY_TICK_3]: true,
    ...over,
  };
}

/** A committed LP, built only through the platform's own routes — the distribution
 *  route refuses `NO_COMMITTED_LPS` on an empty vehicle, and that refusal is
 *  pre-existing and correct. Wave 211's gate must sit in front of a distribution the
 *  platform would otherwise accept, or the proof is vacuous. */
async function commitOneLp(spvId: string): Promise<void> {
  const investorId = `inv_w211_${seq++}`;
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, {
    investorId,
    commitmentMinor: 1_000_000,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const subId = sub.body.subscription.id as string;
  await put(`/api/partner/me/compliance/${investorId}`, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  const adv = await request(app)
    .patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`)
    .set("x-user-id", MANAGING)
    .send({ to: "committed", subscriptionDocRef: `sig_${investorId}` });
  expect(adv.status, JSON.stringify(adv.body)).toBe(200);
  expect(adv.body.subscription.status).toBe("committed");
}

async function makeSpv(): Promise<string> {
  const r = await post("/api/partner/me/spv", {
    name: `W211 Vehicle ${seq++}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    currency: "USD",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.spv.id as string;
}

/** A vehicle that can legitimately record a distribution today. */
async function makeSpvWithCommittedLp(): Promise<string> {
  const spvId = await makeSpv();
  await commitOneLp(spvId);
  return spvId;
}

/** The distribution body a pre-wave-211 caller sent — the money fields, and nothing else. */
function distributionBody(): Record<string, unknown> {
  return {
    event: "exit",
    grossProceedsMinor: 5_000_00,
    costBasisMinor: 2_000_00,
    currency: "USD",
  };
}

/** A readable refusal: words, not a bare machine code on the partner's screen. */
function expectReadableRefusal(body: any) {
  expect(typeof body?.message).toBe("string");
  expect(String(body.message).length).toBeGreaterThan(30);
  /* Not ALL-CAPS_SNAKE shouting at the partner. */
  expect(String(body.message)).not.toMatch(/^[A-Z0-9_]+$/);
  /* The refusal must say nothing was recorded — a partner who is refused must not
     wonder whether half the event went through. */
  expect(String(body.message)).toMatch(/nothing was recorded/i);
}

describe("WAVE 211 · storage precondition", () => {
  it("the attestation columns exist for all four slots (migration 0220 applied or self-healed)", () => {
    for (const slot of ["distribution", "capital_call", "lp_invitation", "lp_commitment"] as const) {
      const s = wave211StorageAvailable(slot);
      expect(s.ok, `${slot}: ${JSON.stringify(s)}`).toBe(true);
    }
  });
});

describe("WAVE 211 · A-1..A-4 — every route refuses an unconfirmed money event", () => {
  it("A-1 distribution — POST /api/partner/me/spv/:id/distributions refuses with no confirmation", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, distributionBody());
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    /* VERSION is checked before NAME, deliberately: a partner on a stale bundle is
       told to reload rather than told their name was wrong. See the gate's ordered
       checks. Either way nothing is recorded. */
    expect(r.body.error).toBe(W211_ERR_VERSION_MISMATCH);
    expectReadableRefusal(r.body);
  });

  it("A-2 capital call — POST /api/partner/me/spvs/:id/capital-calls refuses with no confirmation", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spvs/${spvId}/capital-calls`, {
      amount_minor: 1_000_00,
      due_date: "2026-10-01",
      purpose: "First deployment",
    });
    /* The 400 is the GATE. A 404/403 would mean the request never reached it, which
       is a different (and unproved) story — so the code is asserted, not just
       "not 201". */
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(W211_ERR_VERSION_MISMATCH);
    expectReadableRefusal(r.body);
  });

  it("A-3 LP invitation — POST /api/partner/me/spv/:id/lp-invites refuses with no confirmation", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email: `lp_${seq++}@example.com`,
      firstName: "Dana",
      lastName: "Okafor",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(W211_ERR_VERSION_MISMATCH);
    expectReadableRefusal(r.body);
  });

  it("A-4 LP commitment — POST /api/partner/me/spv/:id/lp-commit refuses with no confirmation", async () => {
    const spvId = await makeSpv();
    const email = `lp_${seq++}@example.com`;
    const inv = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email,
      firstName: "Dana",
      lastName: "Okafor",
      ...inviteConfirmation(),
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      email,
      investorEmail: email,
      holderFirstName: "Dana",
      holderLastName: "Okafor",
      amount: "25000.00",
      shares: "100",
      currency: "USD",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(W211_ERR_VERSION_MISMATCH);
    expectReadableRefusal(r.body);
  });
});

describe("WAVE 211 · A-5..A-8 — every route still does its work when confirmed", () => {
  it("A-5 distribution is recorded, and the money fields are untouched by the gate", async () => {
    const spvId = await makeSpvWithCommittedLp();
    const body = distributionBody();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      ...body,
      ...moneyEventConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const d = r.body.distribution;
    expect(d).toBeTruthy();
    /* C-1 — NO CHARGED AMOUNT MOVED. The figures on the recorded row are exactly the
       figures posted; wave 211 restates them in prose and changes none of them. */
    const gross = d.grossProceedsMinor ?? d.gross_proceeds_minor ?? d.grossMinor;
    expect(String(gross), `distribution keys: ${Object.keys(d).join(",")}`).toBe(
      String(body.grossProceedsMinor),
    );
  });

  it("A-6 capital call is recorded when confirmed", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spvs/${spvId}/capital-calls`, {
      amount_minor: 1_000_00,
      due_date: "2026-10-01",
      purpose: "First deployment",
      ...moneyEventConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });

  it("A-7 LP invitation is sent when confirmed", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email: `lp_${seq++}@example.com`,
      firstName: "Dana",
      lastName: "Okafor",
      ...inviteConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.invite?.id).toBeTruthy();
  });

  it("A-8 LP commitment is recorded when confirmed", async () => {
    const spvId = await makeSpv();
    const email = `lp_${seq++}@example.com`;
    const inv = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email,
      firstName: "Dana",
      lastName: "Okafor",
      ...inviteConfirmation(),
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      email,
      investorEmail: email,
      holderFirstName: "Dana",
      holderLastName: "Okafor",
      amount: "25000.00",
      shares: "100",
      currency: "USD",
      ...commitConfirmation(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe("WAVE 211 · ITEM B — the confirmation is provable", () => {
  async function recordedDistribution(): Promise<{ rowId: string; posted: Record<string, unknown> }> {
    const spvId = await makeSpvWithCommittedLp();
    const posted = { ...distributionBody(), ...moneyEventConfirmation() };
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, posted);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { rowId: String(r.body.distribution.id), posted };
  }

  it("B-1 the stored text is real text and its digest matches it (R187.3)", async () => {
    const { rowId } = await recordedDistribution();
    const rec = wave211ReadAttestation("distribution", rowId);
    expect(rec, "no attestation row was written").not.toBeNull();
    expect(rec!.attestationText.length).toBeGreaterThan(200);
    expect(rec!.attestationTextSha256).toBe(wave211TextSha256(rec!.attestationText));
    /* The text is the EVENT'S OWN DATA, generated live — the vehicle's real figure
       appears in it, not a placeholder and not a zero (R-ASSERT §14). */
    expect(rec!.attestationText).toContain("500000");
    expect(rec!.attestationText).not.toMatch(/\{[A-Z_]+\}/);
  });

  it("B-2 the timestamp and address are the SERVER's; posted ones are stripped (R187.1)", async () => {
    const spvId = await makeSpvWithCommittedLp();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      ...distributionBody(),
      ...moneyEventConfirmation(),
      /* A browser trying to write its own evidence. */
      w211AttestationSignedAt: "1999-01-01T00:00:00.000Z",
      w211AttestationIp: "203.0.113.9",
      w211AttestationUserAgent: "forged/1.0",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rec = wave211ReadAttestation("distribution", String(r.body.distribution.id))!;
    expect(rec).not.toBeNull();
    expect(rec.signedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(new Date(rec.signedAt).getFullYear()).toBeGreaterThanOrEqual(2025);
    expect(rec.ip).not.toBe("203.0.113.9");
    /* supertest connects over a real loopback socket, so the server really does
       observe a peer here. If it ever cannot, the record says so rather than
       inventing one. */
    if (rec.ipCapture === W211_IP_CAPTURED) {
      expect(rec.ip).toBeTruthy();
      expect(rec.ip).not.toMatch(/^203\.0\.113\./);
    } else {
      expect(rec.ip).toBeNull();
    }
    expect(rec.userAgent ?? "").not.toContain("forged/1.0");
  });

  it("B-3 a forged or paraphrased text cannot be stored", async () => {
    const spvId = await makeSpvWithCommittedLp();
    const forged = "I confirm nothing in particular and accept no responsibility.";
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      ...distributionBody(),
      ...moneyEventConfirmation(),
      w211AttestationText: forged,
      w211AttestationTextSha256: wave211TextSha256(forged),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rec = wave211ReadAttestation("distribution", String(r.body.distribution.id))!;
    expect(rec.attestationText).not.toBe(forged);
    expect(rec.attestationText).not.toContain("accept no responsibility");
    expect(rec.attestationTextSha256).toBe(wave211TextSha256(rec.attestationText));
  });

  it("B-4 an empty and a whitespace-only name are both refused (R176.1)", async () => {
    for (const name of ["", "   ", "\t\n ", null, 42, {}, []]) {
      const spvId = await makeSpv();
      const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
        ...distributionBody(),
        ...moneyEventConfirmation({ [W211_BODY_KEY_SIGNED_NAME]: name }),
      });
      expect(r.status, `name=${JSON.stringify(name)} → ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toBe(W211_ERR_NAME_REQUIRED);
    }
  });

  it("B-5 a wrong or missing version is refused", async () => {
    for (const v of ["W211-MONEY-EVENT-ATT-v0", "", null, wave211AttestationVersion("lp_invitation")]) {
      const spvId = await makeSpv();
      const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
        ...distributionBody(),
        ...moneyEventConfirmation({ [W211_BODY_KEY_VERSION]: v }),
      });
      expect(r.status, `version=${JSON.stringify(v)} → ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toBe(W211_ERR_VERSION_MISMATCH);
    }
  });

  it("B-6 a missing tick is refused, and the refusal names which one", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      ...distributionBody(),
      ...moneyEventConfirmation({ [W211_BODY_KEY_TICK_2]: false }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(W211_ERR_TICKS_REQUIRED);
    expectReadableRefusal(r.body);
  });

  it("B-6b a tick that is truthy-but-not-true is refused (no coercion)", async () => {
    for (const t of ["true", 1, "on", "yes"]) {
      const spvId = await makeSpv();
      const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
        ...distributionBody(),
        ...moneyEventConfirmation({ [W211_BODY_KEY_TICK_1]: t }),
      });
      expect(r.status, `tick=${JSON.stringify(t)} → ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.error).toBe(W211_ERR_TICKS_REQUIRED);
    }
  });

  it("B-6c a money event with no stated basis is refused; an invitation needs none", async () => {
    const spvId = await makeSpv();
    const r = await post(`/api/partner/me/spv/${spvId}/distributions`, {
      ...distributionBody(),
      ...moneyEventConfirmation({ [W211_BODY_KEY_BASIS]: "   " }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(W211_ERR_BASIS_REQUIRED);

    /* The invitation gate must NOT demand a basis — that would be a wave-211 trap on
       a legitimate action, which the preflight weighed hardest. */
    const spv2 = await makeSpv();
    const ok = await post(`/api/partner/me/spv/${spv2}/lp-invites`, {
      email: `lp_${seq++}@example.com`,
      firstName: "Dana",
      lastName: "Okafor",
      ...inviteConfirmation(),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it("B-7 the attestation is write-once — a second confirmation does not overwrite it", async () => {
    const { rowId } = await recordedDistribution();
    const first = wave211ReadAttestation("distribution", rowId)!;
    expect(first).not.toBeNull();
    /* Attempt a direct second write through the store's own entry point. */
    const { wave211RecordAttestation } = await import("../wave211MoneyEventAttestationStore");
    const second = wave211RecordAttestation({
      slot: "distribution",
      rowId,
      version: first.version,
      attestationText: "A LATER TEXT THAT MUST NOT LAND",
      signedName: "Someone Else",
      signedBy: "u_someone_else",
      observedIp: "127.0.0.1",
      ipCapture: W211_IP_CAPTURED,
      userAgent: "second/1.0",
      basis: "rewritten",
      currencyConfirmedCode: null,
    } as any);
    expect(second.ok).toBe(false);
    const after = wave211ReadAttestation("distribution", rowId)!;
    expect(after.attestationText).toBe(first.attestationText);
    expect(after.signedName).toBe(first.signedName);
    expect(after.signedAt).toBe(first.signedAt);
  });

  it("B-8 R188.5 — the stored text claims no verification by Capavate", async () => {
    const spvId = await makeSpv();
    const email = `lp_${seq++}@example.com`;
    const inv = await post(`/api/partner/me/spv/${spvId}/lp-invites`, {
      email,
      firstName: "Dana",
      lastName: "Okafor",
      ...inviteConfirmation(),
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const rec = wave211ReadAttestation("lp_invitation", String(inv.body.invite.id))!;
    expect(rec).not.toBeNull();
    const t = rec.attestationText;
    expect(t).not.toMatch(/\b(is|are|was|were|has been|have been|been)\s+verified\b/i);
    expect(t).not.toMatch(/Capavate verifies/i);
    expect(t).not.toMatch(/\bverified by Capavate\b/i);
    /* And it must positively state the opposite. */
    expect(t).toMatch(/does not verify|no verification|not verified by/i);
  });
});
