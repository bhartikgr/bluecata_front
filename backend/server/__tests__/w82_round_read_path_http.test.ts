/**
 * WAVE 82 · ITEM 1 — THE READ PATH, ASSERTED THROUGH THE HTTP READ ENDPOINT.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS, AND WHY WAVE 76 COULD NOT HAVE CAUGHT THIS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `server/__tests__/w76_closed_vocabulary_terms.test.ts` asserts persistence
 * through the STORE-level reader — `roundStoredTerms(roundId).antiDilutionType`.
 * That reader talks to the DB row directly, so it is STRUCTURALLY INCAPABLE of
 * seeing a read-path drop: a `GET` that never returns the field passes every
 * assertion in that file. The pre-flight of 2026-08-20 measured what was
 * actually broken (`spec/PREFLIGHT_TIER1_2026_08_20.md` §1.4): the write path
 * was fine and the READ path served the creation-time snapshot for ever.
 *
 * Mechanism: `POST /api/rounds` pushes a creation-time `legacyShape` snapshot
 * into the legacy in-memory `rounds` array, and `mergeLegacyAndDbRounds()` used
 * to prefer that snapshot over the DB copy for any id in both. Every round read
 * endpoint goes through that helper. `PATCH /api/founder/rounds/:id` returned
 * 200, echoed the new value, wrote it durably — and both read endpoints kept
 * serving the old one, INCLUDING a plain `name` change.
 *
 * Every assertion below therefore goes through the HTTP surface the screen
 * actually consumes: `GET /api/rounds/:id` (the detail read) and
 * `GET /api/rounds?companyId=…` (the list read that seeds the Edit-terms
 * dialog). The store reader is used ONLY as a cross-check that the write was
 * durable, never as the proof that a founder can see it.
 *
 * MUTATION TRANSCRIPTS: build_log/wave82/W82_TESTS.md
 * BEFORE/AFTER REPRO:   build_log/wave82/W82_ITEM1_REPRO_{BEFORE,AFTER}.txt
 * LEGACY-ONLY CENSUS:   build_log/wave82/W82_LEGACY_ONLY_CENSUS.txt
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { roundStoredTerms } from "../lib/roundStoredTerms";

const ADMIN = "u_admin";
const STAMP = `w82r${Date.now().toString(36)}`;

let app: Express;

async function buildPricedRound(key: string): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_${STAMP}_${key}`;
  await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W82 ${key}` });
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId,
    name: `${STAMP}-${key}-CREATION-NAME`,
    type: "seed",
    instrument: "preferred",
    openDate: "2026-01-01",
    closeDate: "2026-12-31",
    targetAmount: 10_000_000,
    pricePerShare: 2.5,
    sharesAuthorized: 40_000_000,
    preMoney: 30_000_000,
    fdPreMoneyShares: 13_000_000,
  });
  expect(created.status).toBe(200);
  return { companyId, roundId: String((created.body as { id?: string }).id ?? "") };
}

/** The detail read — what RoundDetail and the Terms tab consume. */
const httpDetail = (roundId: string) =>
  request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);

/** The list read — what seeds the Edit-terms dialog's initial state. */
async function httpListEntry(companyId: string, roundId: string): Promise<Record<string, unknown> | undefined> {
  const res = await request(app).get(`/api/rounds?companyId=${companyId}`).set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  const copies = ((res.body as Array<Record<string, unknown>>) ?? []).filter((r) => r.id === roundId);
  // NO DUPLICATION: the merge must yield exactly one copy of a round that
  // exists in both the legacy array and the DB.
  expect(copies.length).toBe(1);
  return copies[0];
}

describe("W82 ITEM 1 · a founder's edit is visible on the HTTP READ endpoints, not just in the DB", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE A — THE DEFECT IS GONE. This is the exact shape that was reproduced
     over HTTP before the fix and that no existing test could see.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("PATCH /api/founder/rounds/:id — a plain `name` change is visible on BOTH read endpoints", async () => {
    const { companyId, roundId } = await buildPricedRound("name");

    const before = await httpDetail(roundId);
    expect(before.status).toBe(200);
    expect(before.body.name).toBe(`${STAMP}-name-CREATION-NAME`);

    const patched = await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN)
      .send({ name: "RENAMED-BY-FOUNDER-ROUTE" });
    expect(patched.status).toBe(200);

    // THE ASSERTION WAVE 76 STRUCTURALLY COULD NOT MAKE.
    const detail = await httpDetail(roundId);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe("RENAMED-BY-FOUNDER-ROUTE");

    const listed = await httpListEntry(companyId, roundId);
    expect(listed?.name).toBe("RENAMED-BY-FOUNDER-ROUTE");
  }, 60_000);

  it("PATCH /api/founder/rounds/:id — both money terms reach the HTTP read, not only the store", async () => {
    const { companyId, roundId } = await buildPricedRound("terms");

    const patched = await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "narrow_based", liquidationPreference: "1x non-participating" });
    expect(patched.status).toBe(200);

    // Cross-check only: the write was durable. This is NOT the proof.
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("narrow_based");

    // The proof: the founder can SEE it.
    const detail = await httpDetail(roundId);
    expect(detail.body.antiDilutionType).toBe("narrow_based");
    expect(detail.body.liquidationPreference).toBe("1x non-participating");

    const listed = await httpListEntry(companyId, roundId);
    expect(listed?.antiDilutionType).toBe("narrow_based");
    expect(listed?.liquidationPreference).toBe("1x non-participating");
  }, 60_000);

  it("the terms route (which has its own hot-read mirror) still reads back over HTTP", async () => {
    const { companyId, roundId } = await buildPricedRound("mirror");

    const patched = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "full_ratchet", liquidationPreference: "2x participating" });
    expect(patched.status).toBe(200);

    const detail = await httpDetail(roundId);
    expect(detail.body.antiDilutionType).toBe("full_ratchet");
    expect(detail.body.liquidationPreference).toBe("2x participating");

    const listed = await httpListEntry(companyId, roundId);
    expect(listed?.antiDilutionType).toBe("full_ratchet");
  }, 60_000);

  it("two writers in sequence — the LAST write wins on the read path, not the creation snapshot", async () => {
    const { companyId, roundId } = await buildPricedRound("seq");

    await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "broad_based" });
    expect((await httpDetail(roundId)).body.antiDilutionType).toBe("broad_based");

    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "narrow_based" });
    expect((await httpDetail(roundId)).body.antiDilutionType).toBe("narrow_based");

    await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "full_ratchet" });
    const final = await httpDetail(roundId);
    expect(final.body.antiDilutionType).toBe("full_ratchet");
    const listed = await httpListEntry(companyId, roundId);
    expect(listed?.antiDilutionType).toBe("full_ratchet");
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE B — NO SILENT DROPS, AND NOTHING ELSE MOVED.
     Losing a legacy-only round would be a worse defect than the one fixed.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("the response SHAPE is unchanged — `company`, `pipeline`, `archivedAt`, numeric pricePerShare", async () => {
    const { companyId, roundId } = await buildPricedRound("shape");

    const detail = await httpDetail(roundId);
    expect(detail.status).toBe(200);
    /* NOTE, measured rather than assumed (build_log/wave82/W82_ITEM1_SHAPE_PROBE.txt):
       the DETAIL route resolves `company` from the mockData `companies` array,
       which is EMPTY when the demo seed is off, so the key is `undefined` and
       dropped by JSON. That is PRE-EXISTING and merge-independent — the LIST
       route defaults it to "Unknown", the detail route does not. Asserted where
       it is actually present so this test pins the real shape, not a wish. */
    expect(detail.body).toHaveProperty("pipeline");
    expect(Array.isArray(detail.body.pipeline)).toBe(true);
    expect(detail.body).toHaveProperty("archivedAt");
    expect(typeof detail.body.pricePerShare).toBe("number");

    const listed = await httpListEntry(companyId, roundId);
    expect(listed).toHaveProperty("company");
    expect(listed).toHaveProperty("archivedAt");
    expect(typeof listed?.pricePerShare).toBe("number");
  }, 60_000);

  it("a round is never DROPPED and never DUPLICATED by the merge", async () => {
    const a = await buildPricedRound("dropa");
    const b = await buildPricedRound("dropb");

    // Both are DB-backed AND legacy-snapshotted. Each must appear exactly once
    // on its own company's list, and admin's unfiltered list must contain both.
    expect((await httpListEntry(a.companyId, a.roundId))?.id).toBe(a.roundId);
    expect((await httpListEntry(b.companyId, b.roundId))?.id).toBe(b.roundId);

    const all = await request(app).get("/api/rounds").set("x-user-id", ADMIN);
    expect(all.status).toBe(200);
    const ids = ((all.body as Array<{ id: string }>) ?? []).map((r) => r.id);
    expect(ids).toContain(a.roundId);
    expect(ids).toContain(b.roundId);
    expect(ids.filter((i) => i === a.roundId).length).toBe(1);
    expect(ids.filter((i) => i === b.roundId).length).toBe(1);
  }, 60_000);

  it("`null` on the wire is an explicit REMOVAL that the read path honours", async () => {
    const { companyId, roundId } = await buildPricedRound("null");

    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ liquidationPreference: "1x non-participating" });
    expect((await httpDetail(roundId)).body.liquidationPreference).toBe("1x non-participating");

    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ liquidationPreference: null });
    // Removal must be visible on the read path too — not masked by a snapshot.
    expect((await httpDetail(roundId)).body.liquidationPreference ?? null).toBeNull();
    const listed = await httpListEntry(companyId, roundId);
    expect(listed?.liquidationPreference ?? null).toBeNull();
  }, 60_000);

  it("an ABSENT key leaves the stored value untouched on the read path", async () => {
    const { roundId } = await buildPricedRound("absent");

    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "broad_based", liquidationPreference: "1x non-participating" });

    // A patch that mentions neither key.
    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ targetAmount: 11_000_000 });

    const detail = await httpDetail(roundId);
    expect(detail.body.antiDilutionType).toBe("broad_based");
    expect(detail.body.liquidationPreference).toBe("1x non-participating");
    expect(Number(detail.body.targetAmount)).toBe(11_000_000);
  }, 60_000);
});
