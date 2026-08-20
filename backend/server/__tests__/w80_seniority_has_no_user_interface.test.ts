/**
 * WAVE 80 · ITEM 5 — SENIORITY IS API-ONLY. THIS PINS OUR OWN RECORD, HONESTLY.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WE TOLD THE OWNER, and why it was wrong. Wave 79 said *"seniority is
 * recordable at round creation only."* The narrow server fact is true — an unknown
 * body key on `POST /api/rounds` lands in `extras_json` — but the product-level
 * implication is false. There is NO seniority control anywhere in the platform:
 * not on the creation wizard, not on the round list, not on Round Detail, and not
 * on the only post-creation terms writer. A founder cannot record it at creation
 * or afterwards. It is reachable ONLY by a caller who already knows to hand-craft
 * an undocumented extra field into a generic create request.
 *
 * WHY THAT MATTERS RATHER THAN BEING A DOCUMENTATION NIT. Seniority decides who is
 * paid first at an exit. With two or more preference classes and any missing rank,
 * `GET /api/founder/captable/waterfall` now refuses with `SENIORITY_NOT_ON_RECORD`
 * — so a real multi-class company created through the normal wizard is born into a
 * refusal it has no screen to clear.
 *
 * WAVE 80 DELIBERATELY DOES NOT BUILD THE UI. It moves money at an exit; it needs
 * its own measured step, with its own owner decision about pari passu. What Wave 80
 * does is make the RECORD honest and PIN it, so the next person who reads
 * "recordable at creation" is corrected by a failing test rather than by an audit.
 *
 * IF THIS FILE GOES RED, one of two good things happened: someone built the
 * seniority UI (then update this pin and say so), or someone made the terms route
 * accept it (same). It must never go red because a wave quietly claimed the UI
 * exists.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, acc);
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.(test|spec)\./.test(e.name)) continue;
    acc.push(p);
  }
  return acc;
}

describe("WAVE 80 · ITEM 5 — seniority has no user interface, and we say so", () => {
  it("W80-I5-A — ZERO non-test round-term `seniority` references exist in client/src", () => {
    const hits: string[] = [];
    for (const abs of walk(path.join(ROOT, "client", "src"))) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const lines = fs.readFileSync(abs, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (!/seniority/i.test(ln)) return;
        /* THE ONE ALLOWED SENSE OF THE WORD, and it is not the round term.
           `client/src/lib/legalDocs.ts` uses "seniority" in a terms-of-service
           sentence about the professional seniority of a Member who posts content.
           It is prose in a legal document, not a cap-table rank, and excluding it by
           its exact sentence — rather than by excluding the whole file — is what
           keeps this assertion honest. */
        if (/seniority or credibility of the Member/i.test(ln)) return;
        hits.push(`${rel}:${i + 1}: ${ln.trim().slice(0, 140)}`);
      });
    }
    expect(hits, `unexpected seniority references:\n${hits.join("\n")}`).toEqual([]);
  });

  it("W80-I5-B — the creation wizard has no seniority control and sends no seniority key", () => {
    const wizard = read("client/src/pages/founder/RoundNew.tsx");
    expect(wizard).not.toMatch(/seniority/i);
  });

  it("W80-I5-C — the post-creation terms writer NOW ACCEPTS seniority, with validation (WAVE 81 · D4)", () => {
    /* ══ CORRECTED BY WAVE 81 · ITEM 2 (D4) — THIS ASSERTION PINNED A DEFECT ══
       WHAT THIS TEST USED TO SAY, and why it was wrong. It asserted that
       `server/routes.ts` contained NO mention of `seniority` and that
       `roundsStore.ts` did not list it — i.e. it pinned as CORRECT the fact that
       `PATCH /api/rounds/:id/terms` answered HTTP 200 `{"ok":true}` to
       `{"seniority": 0}` and stored nothing, while
       `GET /api/founder/captable/waterfall` refused with `SENIORITY_NOT_ON_RECORD`
       and instructed the founder BY NAME to record exactly that field.

       This is the SAME anti-pattern Wave 80 corrected two items earlier in its own
       report: a green test that made a silent drop look intended. Wave 80 named it
       for six other keys and then created a seventh instance of it here. Recorded
       plainly rather than quietly rewritten.

       WHAT WAVE 81 DID. `seniority` is persisted with validation at BOTH
       post-creation writers — integer in [0, 99], `0` most senior, refused BY NAME
       outside that domain, `null` an explicit removal, absent untouched — using one
       imported validator (`validateSeniorityRankStored`) so the two cannot drift.
       Both poles, all four states and both writers are tested in
       `server/__tests__/w81_rounding_authority.test.ts` (`W81-D4-A`…`G`), with
       mutation transcripts in `build_log/wave81/W81_TESTS.md`.

       THE REST OF THIS FILE IS UNCHANGED AND STILL TRUE, and it is the half that
       matters most: THERE IS STILL NO USER INTERFACE. `W80-I5-A` and `W80-I5-B`
       still assert zero seniority references in `client/src` and none in the round
       wizard, and Wave 81 added `W81-D4-F`, which asserts the same emptiness from
       the other side. The field is settable over the API and by nothing else. The
       control was deliberately NOT built: seniority decides the order in which
       classes are paid at an exit, so it is a money feature needing its own
       measured step, and it is carried as OQ-2 to the owner. */
    const routes = read("server/routes.ts");
    expect(routes).toMatch(/body\.seniority !== undefined/);
    expect(routes).toContain("validateSeniorityRankStored");
    /* And the store will now persist it, through `extras_json` — no migration. */
    expect(read("server/roundsStore.ts")).toMatch(/"seniority",/);
    /* WRITER 2 carries the SAME imported fence, because the allow-list entry above
       also makes `PATCH /api/founder/rounds/:id` able to persist the key. */
    expect(read("server/roundCarryForwardRoutes.ts")).toContain("validateSeniorityRankStored");
  });

  it("W80-I5-D — the refusal that this gap produces is real and is named", () => {
    /* So the gap is not theoretical: with two or more preference classes and any
       missing rank, the waterfall refuses BY NAME rather than guessing an order. */
    expect(read("server/track1Routes.ts")).toContain("SENIORITY_NOT_ON_RECORD");
  });

  it("W80-I5-E — the reader that WOULD consume a rank exists, so only the UI is missing", () => {
    /* This is the half that IS built: `roundStoredTerms` reads an integer rank in
       [0, 99] off the stored round. Nothing writes it through the product. Recording
       that asymmetry is the point of this file. */
    const stored = read("server/lib/roundStoredTerms.ts");
    expect(stored).toContain("seniorityRank");
  });
});
