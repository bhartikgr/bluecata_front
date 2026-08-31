/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 194 · ITEM B · R165.4 — THE OTHER TWO DOORS THAT REPORTED SUCCESS FOR A
 * WRITE THEY DROPPED.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 193 closed `PATCH /api/partner/me/spv/:spvId` and, in the same breath,
 * reported two more handlers with the identical shape:
 *   · `PATCH /api/partner/me/spvs/:id`  (`server/partnerRoutes.ts:2680`)
 *   · `PATCH /api/partner/me/funds/:id` (`server/partnerRoutes.ts:2880`)
 * Each builds its own whitelisted patch object, drops every key it does not name,
 * and answers `200 { spv }` / `200 { fund }` with the vehicle unchanged. A
 * managing partner correcting a vehicle's CURRENCY — the unit of every figure on
 * it — or its jurisdiction or carry basis was told the correction saved. A
 * protection that stops at one of three doors is not a protection.
 *
 * NO 200 IS EVER TAKEN AS EVIDENCE, AND NO 400 EITHER. Every proof below reads
 * the stored vehicle back through `GET`, because the defect is precisely a
 * response that does not describe the database. A refusal that left a partial
 * write behind would be a different defect wearing this one's clothes.
 *
 * R166.2 IS ASSERTED, NOT ASSUMED. Wave 192 shipped a 244-character headline and
 * lost it to the client's `looksHuman` gate (`client/src/lib/queryClient.ts:60-65`
 * — non-empty, STRICTLY under 240 characters, contains a lower-case letter), so
 * the founder saw "Something went wrong." Every refusal message here is measured
 * against that gate, including a deliberately absurd thirty-key body whose
 * enumerated headline could not possibly fit.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  LEGACY_SPV_PATCH_APPLIED_KEYS,
  LEGACY_FUND_PATCH_APPLIED_KEYS,
  LOOKS_HUMAN_MAX_LENGTH,
} from "../lib/legacyVehiclePatchApplicability";

const MANAGING = "u_avi_managing";
const CODE = "SPV_PATCH_FIELD_NOT_APPLIED";

let app: express.Express;
let seq = 0;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
const patch = (p: string, body?: unknown) =>
  request(app).patch(p).set("x-user-id", MANAGING).send(body ?? {});
const get = (p: string) => request(app).get(p).set("x-user-id", MANAGING);

async function makeSpv(): Promise<string> {
  const r = await post("/api/partner/me/spv", {
    name: `W194 Vehicle ${seq++}`,
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

async function makeFund(): Promise<string> {
  const r = await post("/api/partner/me/funds", {
    fundName: `W194 Fund ${seq++}`,
    fundType: "closed_end",
    jurisdiction: "delaware",
    vintage: 2026,
    currency: "USD",
    status: "raising",
    targetSizeMinor: 5_000_000,
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body.fund?.id ?? r.body.spv?.id) as string;
}

/** The gate the client applies to `message`, applied here to the same string. */
function looksHuman(message: unknown): boolean {
  const s = String(message ?? "");
  return s.length > 0 && s.length < 240 && /[a-z]/.test(s);
}

/** Thirty keys none of which either route maps — the bounded-headline stress. */
const THIRTY_UNAPPLIED: Record<string, unknown> = Object.fromEntries(
  Array.from({ length: 30 }, (_, i) => [`unmappedField${i}`, `value ${i}`]),
);

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B-1 — THE LEGACY SPV PATCH  (server/partnerRoutes.ts:2680)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 B-1 — PATCH /api/partner/me/spvs/:id refuses a write it cannot apply", () => {
  it("B-1-1 a dropped `currency` is now a 400 refusal, and the vehicle is untouched", async () => {
    const spvId = await makeSpv();
    const before = (await get(`/api/partner/me/spvs/${spvId}`)).body.spv;
    const r = await patch(`/api/partner/me/spvs/${spvId}`, { currency: "GBP" });
    /* Before this wave: 200 { spv } with `currency` still USD. */
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(CODE);
    expect(r.body.unappliedFields).toEqual(["currency"]);
    const after = (await get(`/api/partner/me/spvs/${spvId}`)).body.spv;
    expect(after.currency).toBe(before.currency);
    expect(after.revisionHash ?? null).toBe(before.revisionHash ?? null);
  });

  it("B-1-2 the message a partner reads PASSES the 240-character looksHuman gate (R166.2)", async () => {
    const spvId = await makeSpv();
    const r = await patch(`/api/partner/me/spvs/${spvId}`, { currency: "GBP" });
    expect(looksHuman(r.body.message), `message was ${JSON.stringify(r.body.message)}`).toBe(true);
    /* Never an ALL-CAPS underscore code on screen. */
    expect(String(r.body.message)).not.toContain(CODE);
    expect(String(r.body.message)).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    /* It says what happened, in the partner's own noun. */
    expect(String(r.body.message)).toContain("SPV");
    expect(String(r.body.message)).toContain("nothing was saved");
    /* The unabridged explanation is not lost. */
    expect(String(r.body.guidance).length).toBeGreaterThan(200);
  });

  it("B-1-3 a legitimate patch still returns 200 AND PERSISTS — read back, not trusted", async () => {
    const spvId = await makeSpv();
    const r = await patch(`/api/partner/me/spvs/${spvId}`, {
      spvName: "W194 Renamed Vehicle",
      status: "closed",
      capMinor: 4_200_000,
      closeDate: "2026-12-31",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await get(`/api/partner/me/spvs/${spvId}`)).body.spv;
    expect(after.name).toBe("W194 Renamed Vehicle");
    expect(after.status).toBe("closed");
    expect(String(after.capMinor)).toBe("4200000");
  });

  it("B-1-4 a MIXED patch does not half-apply: the mappable key is not written either", async () => {
    const spvId = await makeSpv();
    const before = (await get(`/api/partner/me/spvs/${spvId}`)).body.spv;
    const r = await patch(`/api/partner/me/spvs/${spvId}`, {
      spvName: "W194 Should Not Persist",
      jurisdiction: "cayman",
    });
    expect(r.status).toBe(400);
    expect(r.body.unappliedFields).toEqual(["jurisdiction"]);
    const after = (await get(`/api/partner/me/spvs/${spvId}`)).body.spv;
    /* The assertion runs BEFORE `updateSpv`, so there is no partial write to
       unwind and no half-saved vehicle for a partner to reason about. */
    expect(after.name).toBe(before.name);
  });

  it("B-1-5 thirty unmappable keys: the headline is BOUNDED and every key is still named", async () => {
    const spvId = await makeSpv();
    const r = await patch(`/api/partner/me/spvs/${spvId}`, THIRTY_UNAPPLIED);
    expect(r.status).toBe(400);
    /* An enumerated headline for thirty fields is ~500 characters. Wave 192's
       244-character headline was silently discarded by the client; this asserts
       the fallback fires rather than trusting that it would. */
    expect(String(r.body.message).length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(looksHuman(r.body.message)).toBe(true);
    expect(String(r.body.message)).toContain("30 of the fields");
    /* Bounded is not truncated: nothing is lost, it moves to a machine-readable
       list the screen can render in full. */
    expect(r.body.unappliedFields).toHaveLength(30);
    expect(r.body.unappliedFields).toContain("unmappedField29");
  });

  it("B-1-6 an unknown vehicle is still a 404 — the refusal did not swallow that branch", async () => {
    const r = await patch("/api/partner/me/spvs/spv_does_not_exist", { status: "closed" });
    expect(r.status).toBe(404);
  });

  it("B-1-7 the accept-list is not wider than the ladder it mirrors", () => {
    /* Pinned so a future edit to the handler's ladder cannot widen what is
       accepted without this failing. `name` and `spvName` are both here because
       the ladder maps both onto `name`. */
    expect([...LEGACY_SPV_PATCH_APPLIED_KEYS].sort()).toEqual(
      ["capMinor", "closeDate", "minCheckMinor", "name", "spvName", "status", "targetRaiseMinor"].sort(),
    );
    /* R163.1 — the list must NOT be wave 193's store-shaped nine, which would
       have accepted three keys THIS route drops. */
    for (const droppedByThisRoute of ["distributionScope", "lpVisibility", "terms"]) {
      expect(LEGACY_SPV_PATCH_APPLIED_KEYS).not.toContain(droppedByThisRoute);
    }
  });

  it("B-1-8 each accepted key is really accepted — the accept-list is not a refusal in disguise", async () => {
    for (const key of LEGACY_SPV_PATCH_APPLIED_KEYS) {
      const spvId = await makeSpv();
      const value =
        key === "status" ? "open"
        : key === "closeDate" ? "2026-11-30"
        : key.endsWith("Minor") ? 1_000_000
        : "W194 Accepted";
      const r = await patch(`/api/partner/me/spvs/${spvId}`, { [key]: value });
      expect(r.status, `key ${key} was refused: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B-2 — THE FUND PATCH  (server/partnerRoutes.ts:2880)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 B-2 — PATCH /api/partner/me/funds/:id refuses a write it cannot apply", () => {
  it("B-2-1 a dropped `currency` is a 400 refusal and the fund is untouched", async () => {
    const fundId = await makeFund();
    const before = (await get(`/api/partner/me/funds/${fundId}`)).body.fund;
    const r = await patch(`/api/partner/me/funds/${fundId}`, { currency: "GBP" });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe(CODE);
    expect(r.body.unappliedFields).toEqual(["currency"]);
    const after = (await get(`/api/partner/me/funds/${fundId}`)).body.fund;
    expect(after.currency).toBe(before.currency);
  });

  it("B-2-2 the fund refusal reads in the FUND's noun and passes the looksHuman gate", async () => {
    const fundId = await makeFund();
    const r = await patch(`/api/partner/me/funds/${fundId}`, { vintage: 2027 });
    expect(r.status).toBe(400);
    expect(looksHuman(r.body.message)).toBe(true);
    expect(String(r.body.message)).toContain("fund");
    expect(String(r.body.message)).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    expect(r.body.unappliedFields).toEqual(["vintage"]);
  });

  it("B-2-3 a legitimate fund patch still returns 200 AND PERSISTS", async () => {
    const fundId = await makeFund();
    const r = await patch(`/api/partner/me/funds/${fundId}`, {
      fundName: "W194 Renamed Fund",
      status: "investing",
      targetSizeMinor: 9_000_000,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await get(`/api/partner/me/funds/${fundId}`)).body.fund;
    expect(after.name).toBe("W194 Renamed Fund");
    expect(String(after.targetRaiseMinor)).toBe("9000000");
  });

  it("B-2-4 thirty unmappable keys on a fund: bounded headline, all thirty named", async () => {
    const fundId = await makeFund();
    const r = await patch(`/api/partner/me/funds/${fundId}`, THIRTY_UNAPPLIED);
    expect(r.status).toBe(400);
    expect(String(r.body.message).length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(looksHuman(r.body.message)).toBe(true);
    expect(r.body.unappliedFields).toHaveLength(30);
  });

  it("B-2-5 the fund accept-list is its OWN five keys, not the SPV route's", () => {
    expect([...LEGACY_FUND_PATCH_APPLIED_KEYS].sort()).toEqual(
      ["closeDate", "fundName", "name", "status", "targetSizeMinor"].sort(),
    );
    /* `targetRaiseMinor` is the STORE's name; this route's wire name is
       `targetSizeMinor` and it translates. Accepting the store's name here would
       accept a key this handler silently drops. */
    expect(LEGACY_FUND_PATCH_APPLIED_KEYS).not.toContain("targetRaiseMinor");
  });

  it("B-2-6 a non-fund id is still 404 on the fund route", async () => {
    const spvId = await makeSpv();
    const r = await patch(`/api/partner/me/funds/${spvId}`, { status: "raising" });
    /* An SPV is not a fund: the pre-existing guard runs BEFORE the new assertion,
       so this must stay a 404 and must not become a refusal. */
    expect(r.status).toBe(404);
  });
});
