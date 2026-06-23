/**
 * Sprint 17 D1 — DB layer test suite.
 *
 * Verifies all 24 sync tables exist, generic upsert/get/list works for
 * each entity, JSON payload round-trips, and soft-delete is honoured.
 */
import { describe, it, expect } from "vitest";
import { rawDb, getDb } from "../db/connection";
import {
  upsertSyncDoc, getSyncDoc, listSyncDocs, softDeleteSyncDoc,
  ALL_SYNC_TABLES, SYNC_ENTITY_COUNT,
} from "../db/syncRepo";

getDb();

describe("DB layer — sync entities", () => {
  it("registers exactly 24 sync entities", () => {
    expect(SYNC_ENTITY_COUNT).toBe(24);
    expect(ALL_SYNC_TABLES).toHaveLength(24);
  });

  it("each sync_* table is reachable via raw SQL", () => {
    const db = rawDb();
    for (const ent of ALL_SYNC_TABLES) {
      const sqlName = `sync_${ent.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`;
      const r = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(sqlName);
      expect(r, `expected table ${sqlName}`).toBeTruthy();
    }
  });

  it("upserts + reads back all 24 entities", () => {
    for (const ent of ALL_SYNC_TABLES) {
      const id = `${ent}_t`;
      upsertSyncDoc(ent, { id, payload: { entity: ent, n: 1 } });
      const r = getSyncDoc(ent, id);
      expect(r?.id).toBe(id);
      expect((r?.payload as { entity: string }).entity).toBe(ent);
    }
  });

  it("listSyncDocs respects limit + soft-delete", () => {
    upsertSyncDoc("company", { id: "c_list_1", payload: {} });
    upsertSyncDoc("company", { id: "c_list_2", payload: {} });
    softDeleteSyncDoc("company", "c_list_2");
    const list = listSyncDocs("company", 100);
    expect(list.find(r => r.id === "c_list_1")).toBeTruthy();
    expect(list.find(r => r.id === "c_list_2")).toBeUndefined();
  });

  it("auth tables exist (auth_users, auth_sessions, auth_redeem_tokens)", () => {
    const db = rawDb();
    for (const tbl of ["auth_users", "auth_sessions", "auth_redeem_tokens"]) {
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE name=?`).get(tbl)).toBeTruthy();
    }
  });

  it("upsert increments version on subsequent writes", () => {
    upsertSyncDoc("round", { id: "r_v", payload: { state: "draft" } });
    const v1 = getSyncDoc("round", "r_v")!.version;
    upsertSyncDoc("round", { id: "r_v", payload: { state: "open" } });
    const v2 = getSyncDoc("round", "r_v")!.version;
    expect(v2).toBeGreaterThan(v1);
  });
});
