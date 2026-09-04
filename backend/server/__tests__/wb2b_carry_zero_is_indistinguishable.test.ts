/**
 * WAVE B · ITEM 2b — THE STORED BYTES, READ BACK FROM THE DATABASE.
 *
 * The client change in `PartnerMfcrmPersonas.tsx` rests on two factual claims
 * about the database. A claim about stored data has to be read out of the
 * stored data, not out of a variable name, so this file asserts both with
 * `rawDb()` against the real table.
 *
 *   CLAIM 1 — THE MANUFACTURED ZERO IS REAL AND IT IS NOT MEASURED. Creating a
 *   chapter with NO carry supplied at all writes the integer 0 into
 *   `mf_angel_chapter.carry_bps`, because the column is `NOT NULL DEFAULT 0`
 *   and `createChapter` coerces a missing value to 0. Nobody agreed that 0.
 *
 *   CLAIM 2 — THE TWO CASES ARE BYTE-IDENTICAL, SO THE UI CANNOT HONESTLY TELL
 *   THEM APART. A chapter created with no carry, a chapter where 0 was typed
 *   explicitly, and a chapter whose carry was later SET to 0, all end up with
 *   the same stored row shape. This is why the screen now says "No carry rate
 *   confirmed" for a zero and states the ambiguity in words, instead of
 *   inventing a distinction the data does not carry. The test also checks the
 *   timestamps, because `updated_at > created_at` is the proxy a future wave
 *   would be tempted to reach for, and it does NOT separate the cases.
 *
 *   CLAIM 3 — THE CLIENT CHANGE MOVED NO STORED BYTE. The edit box now opens
 *   EMPTY for a stored zero instead of pre-filled with "0". Saving it sends
 *   `Math.round(Number("") * 100)`, i.e. 0, which is exactly what the old
 *   pre-filled "0" sent. The store call is asserted to leave the row unchanged.
 *
 * NOTHING HERE ASSERTS THE SCHEMA SHOULD CHANGE. The `NOT NULL DEFAULT 0`
 * default is deliberately left alone and referred to the owner.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { mfcrmAngelStore } from "../mfcrmAngelStore";
import { rawDb } from "../db/connection";

const ACTOR = "u_wb2b_actor";

beforeAll(() => applyMfcrmSchema());

function storedRow(chapterId: string): any {
  return rawDb()
    .prepare("SELECT id, name, carry_bps, created_at, updated_at FROM mf_angel_chapter WHERE id = ?")
    .get(chapterId);
}

describe("WB·2b — a defaulted carry of zero, read back out of the database", () => {
  it("CLAIM 1: a chapter created with NO carry stores the integer 0, not NULL", () => {
    const pid = "p_wb2b_default";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);
    const ch = mfcrmAngelStore.createChapter(pid, { name: "No Carry Agreed" }, ACTOR);

    const row = storedRow(ch.id);
    /* Read the actual column. `=== 0` and `!== null` are asserted separately so
       that a NULL slipping through cannot pass on JavaScript coercion. */
    expect(row).toBeTruthy();
    expect(row.carry_bps).toBe(0);
    expect(row.carry_bps).not.toBeNull();
    expect(typeof row.carry_bps).toBe("number");
  });

  it("CLAIM 2: 'no carry supplied' and 'zero typed on purpose' store the SAME value", () => {
    const pid = "p_wb2b_same";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);

    const implicit = mfcrmAngelStore.createChapter(pid, { name: "Never Discussed" }, ACTOR);
    const explicit = mfcrmAngelStore.createChapter(pid, { name: "Agreed Zero Percent", carryBps: 0 }, ACTOR);

    const a = storedRow(implicit.id);
    const b = storedRow(explicit.id);
    expect(a.carry_bps).toBe(b.carry_bps);
    expect(a.carry_bps).toBe(0);

    /* THE PROXY THAT DOES NOT WORK. If `updated_at > created_at` separated
       "someone decided" from "nobody decided", the UI could use it. On a freshly
       created row the two are equal in BOTH cases, so it separates nothing. This
       assertion exists to stop a later wave adopting that proxy in good faith. */
    expect(a.updated_at).toBe(a.created_at);
    expect(b.updated_at).toBe(b.created_at);

    /* And a CONTROL, so this test is not passing merely because every row looks
       alike: a chapter with a real rate is visibly different in the same column. */
    const real = mfcrmAngelStore.createChapter(pid, { name: "Twenty Percent", carryBps: 2000 }, ACTOR);
    expect(storedRow(real.id).carry_bps).toBe(2000);
    expect(storedRow(real.id).carry_bps).not.toBe(a.carry_bps);
  });

  it("CLAIM 2b: explicitly SETTING the carry to 0 is also indistinguishable in the value column", () => {
    const pid = "p_wb2b_set";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);
    const ch = mfcrmAngelStore.createChapter(pid, { name: "Set To Zero Later", carryBps: 500 }, ACTOR);
    expect(storedRow(ch.id).carry_bps).toBe(500);

    mfcrmAngelStore.setChapterCarry(pid, ch.id, 0, ACTOR);
    const after = storedRow(ch.id);
    expect(after.carry_bps).toBe(0);

    /* An UNPARSEABLE value is coerced to the very same 0 by the writer, so even
       a save that failed to say anything meaningful lands in this bucket. That is
       the third way to reach a stored zero, and it is the reason the screen
       refuses to present a zero as a measured rate. */
    mfcrmAngelStore.setChapterCarry(pid, ch.id, Number.NaN as unknown as number, ACTOR);
    expect(storedRow(ch.id).carry_bps).toBe(0);
  });

  it("CLAIM 3: the client's now-blank edit box sends the same 0 the pre-filled box sent", () => {
    const pid = "p_wb2b_noop";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);
    const ch = mfcrmAngelStore.createChapter(pid, { name: "Blank Save Noop" }, ACTOR);
    const before = storedRow(ch.id);

    /* This is EXACTLY the client's arithmetic, unchanged by this wave:
       `Math.round(Number(pct) * 100)`. Old client seeded pct="0"; new client
       seeds pct="". Both produce 0. */
    const fromOldSeed = Math.round(Number("0") * 100);
    const fromNewSeed = Math.round(Number("") * 100);
    expect(fromNewSeed).toBe(fromOldSeed);

    mfcrmAngelStore.setChapterCarry(pid, ch.id, fromNewSeed, ACTOR);
    expect(storedRow(ch.id).carry_bps).toBe(before.carry_bps);
    expect(storedRow(ch.id).carry_bps).toBe(0);
  });

  it("CONTROL: the carry report projection carries NO timestamp, so it could not use one", () => {
    const pid = "p_wb2b_proj";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: true, chapterScoping: true }, ACTOR);
    mfcrmAngelStore.createChapter(pid, { name: "Projection Check" }, ACTOR);
    const rows = mfcrmAngelStore.chapterCarryReport(pid);
    expect(rows.length).toBeGreaterThan(0);
    const keys = Object.keys(rows[0]).sort();
    /* If a timestamp is ever added here, this fails and the ambiguity note on the
       screen should be revisited — deliberately, not by accident. */
    expect(keys).toEqual(["activeCount", "carryBps", "chapterId", "engagementCount", "name", "region"]);
  });
});
