import { afterAll, beforeAll, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  calls: 0,
  db: null as any,
}));

vi.mock("../db/connection", async () => {
  const actual = await vi.importActual<any>("../db/connection");
  mockState.db = actual.rawDb();
  return {
    ...actual,
    rawDb: () => {
      mockState.calls++;
      if (mockState.calls === 1) return mockState.db;
      throw new Error("simulated Postgres rawDb() failure");
    },
  };
});

import { backfillLegacyChildCommitments } from "../spvEngineStore";

beforeAll(() => {
  const db = mockState.db;
  db.prepare(
    "DELETE FROM _migrations_applied WHERE key = 'wave_b_child_backfill_v1'",
  ).run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_partnerSpvPositions (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS kv_partnerFundCommitments (
      id TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  db.prepare("DELETE FROM kv_partnerSpvPositions").run();
  db.prepare("DELETE FROM kv_partnerFundCommitments").run();
  db.prepare(
    `INSERT INTO kv_partnerSpvPositions (id, payload_json, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL)`,
  ).run(
    "review_round5_position",
    JSON.stringify({
      id: "review_round5_position",
      partnerSpvId: "review_round5_missing_parent",
      lpContactId: "review_round5_lp",
      positionAmountMinor: 12345,
      currency: "USD",
      positionStatus: "committed",
    }),
    new Date().toISOString(),
  );
});

afterAll(() => {
  vi.restoreAllMocks();
});

it("does not mark a lost child backfill complete and emits the data-loss-risk error", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockState.calls = 0;

  const result = backfillLegacyChildCommitments();

  const marker = mockState.db
    .prepare(
      "SELECT 1 AS one FROM _migrations_applied WHERE key = 'wave_b_child_backfill_v1'",
    )
    .get();
  const errorLines = errorSpy.mock.calls.map((args) => args.join(" "));

  expect(result).toEqual({
    positions: 0,
    fundCommits: 0,
    quarantined: 0,
    lost: 1,
  });
  expect(marker).toBeUndefined();
  expect(
    errorLines.some((line) =>
      line.includes('"code":"BACKFILL_INCOMPLETE_DATA_LOSS_RISK"'),
    ),
  ).toBe(true);
});
