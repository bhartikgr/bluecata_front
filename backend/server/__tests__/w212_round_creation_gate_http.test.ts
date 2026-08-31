/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 212 · ITEMS A & B — THE ROUND-CREATION GATE, PROVED OVER REAL HTTP.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG BEFORE THIS WAVE. `POST /api/rounds` created a live funding round
 * — terms, valuation, price per share, target raise, all of it — from one click,
 * with no confirmation of any kind and nothing recorded about who authorised it.
 *
 * WHY THESE ASSERTIONS ARE OVER HTTP AND NOT AGAINST A HELPER. A disabled button is
 * not a gate: anything that can reach the API can create a round. Every test below
 * therefore drives the SAME `registerRoutes(...)` app the server boots (handbook §8
 * — never prove a replica), with no attestation-shaped stubbing anywhere. The first
 * test IS the adversary: it posts a complete, valid, correctly-owned round with no
 * sign-off and requires a refusal.
 *
 * WHAT IT WOULD MEAN IF THESE WENT GREEN WITH THE GATE DISARMED. Nothing — so the
 * disarm harness (`build_log/wave212/W212_DISARM.py`) removes each guard in turn and
 * requires the matching test to go red.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { getAuditLog } from "../adminPlatformStore";
import {
  buildRoundCreationAttestationText,
  ROUND_CREATION_ATTESTATION_VERSION,
  RECITAL_ABSENT_FIGURE,
} from "../../shared/wave212RoundCreationAttestation";
import {
  ROUND_CREATION_ATTESTATION_COLUMNS,
  IP_CAPTURED,
  IP_NOT_CAPTURED,
  attestationTextSha256,
  readRoundCreationAttestation,
} from "../wave212RoundCreationAttestationStore";

const ADMIN = "u_admin";
const STAMP = `w212${Date.now().toString(36)}`;
let app: Express;

/** A complete, valid, priced round body — everything EXCEPT the sign-off. */
function unsignedBody(companyId: string, name: string): Record<string, unknown> {
  return {
    companyId,
    name,
    type: "seed",
    instrument: "preferred",
    openDate: "2026-01-01",
    closeDate: "2026-12-31",
    targetAmount: "10000000",
    pricePerShare: "2.5",
    sharesAuthorized: 40_000_000,
    preMoney: "30000000",
    fdPreMoneyShares: 13_000_000,
    currency: "USD",
  };
}

async function makeCompany(key: string): Promise<string> {
  const companyId = `co_${STAMP}_${key}`;
  await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W212 ${key}` });
  return companyId;
}

const USER_AGENT = "W212TestAgent/1.0";

/* Every create carries a user agent, because a real browser does. The one place
   this matters is B1, which asserts the server recorded the agent IT observed. */
const post = (body: Record<string, unknown>) =>
  request(app).post("/api/rounds").set("x-user-id", ADMIN).set("User-Agent", USER_AGENT).send(body);

describe("WAVE 212 · the round-creation gate is enforced by the server", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     ITEM A · POLE 1 — THE ADVERSARY. A direct API call with no sign-off.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("A1 · a complete, correctly-owned round with NO sign-off is refused, and nothing is created", async () => {
    const companyId = await makeCompany("nosignoff");
    const name = `${STAMP} no sign-off`;

    const res = await post(unsignedBody(companyId, name));

    expect(res.status).toBe(400);
    expect((res.body as { ok?: boolean }).ok).toBe(false);
    expect((res.body as { error?: string }).error).toBe("ROUND_CREATION_ATTESTATION_NAME_REQUIRED");
    /* The refusal must be readable AND must survive the client's 240-character
       ceiling, or the founder sees nothing at all. */
    const message = String((res.body as { message?: string }).message ?? "");
    expect(message.length).toBeGreaterThan(0);
    expect(message.length).toBeLessThan(240);

    /* NOTHING WAS CREATED — asserted on the read path a founder actually uses. */
    const list = await request(app).get(`/api/rounds?companyId=${companyId}`).set("x-user-id", ADMIN);
    expect(list.status).toBe(200);
    expect((list.body as Array<{ name?: string }>).some((r) => r.name === name)).toBe(false);
  });

  it("A2 · a whitespace-only name is not a signature", async () => {
    const companyId = await makeCompany("whitespace");
    const res = await post({
      ...unsignedBody(companyId, `${STAMP} whitespace`),
      creationAttestationSignedName: "   \t \n  ",
      creationAttestationAccepted: true,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe("ROUND_CREATION_ATTESTATION_NAME_REQUIRED");
  });

  it("A3 · a typed name with the attestation NOT accepted is refused", async () => {
    const companyId = await makeCompany("unticked");
    const res = await post({
      ...unsignedBody(companyId, `${STAMP} unticked`),
      creationAttestationSignedName: "Ada Lovelace",
      creationAttestationAccepted: false,
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe("ROUND_CREATION_ATTESTATION_REQUIRED");
  });

  it("A4 · a truthy-but-not-true assent (\"true\", 1) is refused — only the boolean counts", async () => {
    const companyId = await makeCompany("truthy");
    for (const value of ["true", 1, "yes", {}]) {
      const res = await post({
        ...unsignedBody(companyId, `${STAMP} truthy ${JSON.stringify(value)}`),
        creationAttestationSignedName: "Ada Lovelace",
        creationAttestationAccepted: value,
      });
      expect(res.status, `assent=${JSON.stringify(value)}`).toBe(400);
      expect((res.body as { error?: string }).error).toBe("ROUND_CREATION_ATTESTATION_REQUIRED");
    }
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     ITEM B · WHAT IS RECORDED, AND THAT IT IS PROVABLE LATER.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("B1 · a signed round is created and ALL NINE sign-off columns are populated", async () => {
    const companyId = await makeCompany("signed");
    const name = `${STAMP} signed`;
    const sentAtLowerBound = new Date();

    const res = await post({
      ...unsignedBody(companyId, name),
      creationAttestationSignedName: "  Ada  Lovelace  ",
      creationAttestationAccepted: true,
    });
    expect(res.status).toBe(200);
    const roundId = String((res.body as { id?: string }).id ?? "");
    expect(roundId.length).toBeGreaterThan(0);

    const row = rawDb()
      .prepare(`SELECT ${ROUND_CREATION_ATTESTATION_COLUMNS.join(", ")} FROM rounds WHERE id = ?`)
      .get(roundId) as Record<string, unknown>;

    for (const column of ROUND_CREATION_ATTESTATION_COLUMNS) {
      expect(row[column], `${column} must be recorded`).toBeTruthy();
    }

    /* THE USER AGENT IS THE ONE THE SERVER SAW ON THE WIRE. */
    expect(row.creation_attestation_user_agent).toBe(USER_AGENT);

    /* THE SIGNATURE, as typed but with runs of whitespace folded — never truncated,
       never invented. */
    expect(row.creation_attestation_signed_name).toBe("Ada Lovelace");
    expect(row.creation_attestation_version).toBe(ROUND_CREATION_ATTESTATION_VERSION);

    /* THE TIMESTAMP IS THE SERVER'S OWN. The body never carried one, and it lands
       inside the window this test observed. */
    const signedAt = new Date(String(row.creation_attestation_signed_at));
    expect(Number.isNaN(signedAt.getTime())).toBe(false);
    expect(signedAt.getTime()).toBeGreaterThanOrEqual(sentAtLowerBound.getTime() - 1000);
    expect(signedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(String(row.creation_attestation_signed_at).endsWith("Z")).toBe(true);

    /* THE ADDRESS IS EITHER REAL OR DECLARED NOT CAPTURED — never a fiction. */
    expect([IP_CAPTURED, IP_NOT_CAPTURED]).toContain(String(row.creation_attestation_ip_capture));
    if (row.creation_attestation_ip_capture === IP_NOT_CAPTURED) {
      expect(row.creation_attestation_ip).toBe(IP_NOT_CAPTURED);
    }

    /* THE EXACT TEXT, AND A DIGEST OF IT (R187.3). The digest must be a digest OF
       THE STORED TEXT, so a later edit of either is detectable. */
    const storedText = String(row.creation_attestation_text);
    expect(row.creation_attestation_text_sha256).toBe(attestationTextSha256(storedText));

    /* AND THE STORED TEXT IS THE TEXT THE SHARED MODULE PRODUCES FOR THIS ROUND'S
       OWN FACTS — the same function the wizard renders from. */
    expect(storedText).toBe(
      buildRoundCreationAttestationText({
        companyName: `W212 signed`,
        roundName: name,
        pricePerShareRaw: "2.5",
        targetAmountRaw: "10000000",
        currency: "USD",
      }),
    );
    /* The figures the founder entered are IN the recorded sentence. */
    expect(storedText).toContain("10000000");
    expect(storedText).toContain("2.5");
    expect(storedText).toContain(name);

    /* THE CLAIM THAT MUST NOT APPEAR ANYWHERE (R176.1). "verified", "verifies" and
       "verification" would each assert a check the platform does not perform. The
       ADMISSION "does not verify" is the opposite claim and is required — so it is
       removed first and the remainder must hold no trace of the word at all. */
    expect(storedText).toContain("does not verify");
    expect(/verified|verifies|verification/i.test(storedText)).toBe(false);
    expect(/verif/i.test(storedText.split("does not verify").join(""))).toBe(false);

    /* Readable back through the store's own reader. */
    const read = readRoundCreationAttestation(roundId);
    expect(read?.attestationText).toBe(storedText);
    expect(read?.signedName).toBe("Ada Lovelace");
  });

  it("B2 · a figure the founder did not enter is described in words, never as 0", async () => {
    const companyId = await makeCompany("absent");
    const name = `${STAMP} absent figures`;
    /* A convertible: this instrument collects no price per share. The recital must
       say so rather than printing a confident zero (R143.4). */
    const res = await post({
      companyId,
      name,
      type: "seed",
      instrument: "safe_post",
      openDate: "2026-01-01",
      closeDate: "2026-12-31",
      targetAmount: "500000",
      valuationCap: "8000000",
      currency: "USD",
      creationAttestationSignedName: "Ada Lovelace",
      creationAttestationAccepted: true,
    });
    expect(res.status).toBe(200);
    const roundId = String((res.body as { id?: string }).id ?? "");
    const stored = String(readRoundCreationAttestation(roundId)?.attestationText ?? "");
    expect(stored.length).toBeGreaterThan(0);
    expect(stored).toContain(RECITAL_ABSENT_FIGURE);
    /* NO PHANTOM ZERO anywhere in the recited price line. */
    const priceLine = stored.split("\n").find((l) => l.startsWith("Price per share")) ?? "";
    expect(priceLine).toContain(RECITAL_ABSENT_FIGURE);
    expect(priceLine).not.toMatch(/\b0\b/);
  });

  it("B3 · a client-supplied version, text, timestamp, IP or user agent is IGNORED, not stored, not echoed", async () => {
    const companyId = await makeCompany("forged");
    const name = `${STAMP} forged fields`;
    const res = await post({
      ...unsignedBody(companyId, name),
      creationAttestationSignedName: "Ada Lovelace",
      creationAttestationAccepted: true,
      /* The adversary's contribution. */
      creationAttestationVersion: "FORGED-v9",
      creationAttestationText: "I attest to absolutely nothing.",
      creationAttestationSignedAt: "1999-01-01T00:00:00.000Z",
      creationAttestationIp: "203.0.113.9",
      creationAttestationUserAgent: "ForgedAgent/1.0",
      creationAttestationTextSha256: "deadbeef",
    });
    expect(res.status).toBe(200);
    const roundId = String((res.body as { id?: string }).id ?? "");

    const record = readRoundCreationAttestation(roundId);
    expect(record?.version).toBe(ROUND_CREATION_ATTESTATION_VERSION);
    expect(record?.attestationText).not.toContain("absolutely nothing");
    expect(record?.signedAt.startsWith("1999")).toBe(false);
    expect(record?.ip).not.toBe("203.0.113.9");
    expect(record?.userAgent).not.toBe("ForgedAgent/1.0");

    /* AND NOT SMUGGLED INTO `extras_json`, which every reader of the round gets
       re-spread onto their copy. The forged keys must be absent from the round the
       API serves — otherwise a fake address would sit beside the real one. */
    const detail = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(detail.status).toBe(200);
    const serialised = JSON.stringify(detail.body);
    expect(serialised).not.toContain("203.0.113.9");
    expect(serialised).not.toContain("ForgedAgent");
    expect(serialised).not.toContain("FORGED-v9");
    expect(serialised).not.toContain("absolutely nothing");
  });

  it("B4 · the sign-off is written once and cannot be overwritten by a second attempt", async () => {
    const companyId = await makeCompany("latch");
    const res = await post({
      ...unsignedBody(companyId, `${STAMP} latch`),
      creationAttestationSignedName: "First Signer",
      creationAttestationAccepted: true,
    });
    expect(res.status).toBe(200);
    const roundId = String((res.body as { id?: string }).id ?? "");
    const first = readRoundCreationAttestation(roundId);
    expect(first?.signedName).toBe("First Signer");

    /* The recorder is write-once: a second record against the same round must not
       replace the first. Called directly because no route exposes a re-sign. */
    const { recordRoundCreationAttestation } = await import("../wave212RoundCreationAttestationStore");
    const second = recordRoundCreationAttestation({
      roundId,
      signedName: "Second Signer",
      version: ROUND_CREATION_ATTESTATION_VERSION,
      attestationText: "a different text",
      signedBy: ADMIN,
      observedIp: null,
      userAgent: null,
    });
    expect(second.ok).toBe(false);
    expect(readRoundCreationAttestation(roundId)?.signedName).toBe("First Signer");
  });

  it("B5 · the sign-off is audited through wave 186's writer, with no address copied into the ledger", async () => {
    const companyId = await makeCompany("audit");
    const name = `${STAMP} audited`;
    const res = await post({
      ...unsignedBody(companyId, name),
      creationAttestationSignedName: "Ada Lovelace",
      creationAttestationAccepted: true,
    });
    expect(res.status).toBe(200);
    const roundId = String((res.body as { id?: string }).id ?? "");

    const entries = getAuditLog().filter(
      (e) => e.entity === `round:${roundId}` && e.eventType === "round_creation_attestation_recorded",
    );
    expect(entries.length).toBe(1);
    const payload = entries[0].payload as Record<string, unknown>;
    expect(payload.attestationVersion).toBe(ROUND_CREATION_ATTESTATION_VERSION);
    expect(payload.signedName).toBe("Ada Lovelace");
    expect(String(payload.attestationTextSha256 ?? "").length).toBe(64);
    /* The ledger records WHETHER an address was captured, not the address. */
    expect([IP_CAPTURED, IP_NOT_CAPTURED]).toContain(String(payload.ipCapture));
    expect(JSON.stringify(payload)).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     ITEM A · "DO NOT BLOCK ANYTHING ELSE."
     ═══════════════════════════════════════════════════════════════════════════ */
  it("C1 · EDITING a round needs no sign-off and behaves exactly as before", async () => {
    const companyId = await makeCompany("edit");
    const created = await post({
      ...unsignedBody(companyId, `${STAMP} editable`),
      creationAttestationSignedName: "Ada Lovelace",
      creationAttestationAccepted: true,
    });
    expect(created.status).toBe(200);
    const roundId = String((created.body as { id?: string }).id ?? "");

    /* No attestation field anywhere in this request. */
    const patched = await request(app)
      .patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", ADMIN)
      .send({ name: `${STAMP} edited name` });
    expect(patched.status).toBe(200);

    const detail = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(detail.status).toBe(200);
    expect((detail.body as { name?: string }).name).toBe(`${STAMP} edited name`);

    /* The original sign-off is untouched by the edit. */
    expect(readRoundCreationAttestation(roundId)?.signedName).toBe("Ada Lovelace");
  });

  it("C2 · refusals that existed BEFORE this wave still fire first, with their own codes", async () => {
    const companyId = await makeCompany("ordering");
    /* A missing open date was refused before this wave and must still be refused
       with the SAME code even though no sign-off is supplied — this wave adds a
       refusal, it does not renumber anyone else's. */
    const res = await post({
      ...unsignedBody(companyId, `${STAMP} ordering`),
      openDate: "",
    });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe("OPEN_DATE_REQUIRED");
  });

  it("C3 · a caller who does not own the company is still refused BEFORE the sign-off is considered", async () => {
    const companyId = await makeCompany("owner");
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", "u_daniel_okafor")
      .send(unsignedBody(companyId, `${STAMP} wrong company`));
    expect(res.status).toBe(403);
    expect((res.body as { error?: string }).error).toBe("FOUNDER_WRONG_COMPANY");
  });
});
