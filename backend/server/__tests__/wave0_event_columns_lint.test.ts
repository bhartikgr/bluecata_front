/**
 * Wave 0 acceptance gate 0-C — event columns canonical-template lint.
 *
 * V7 §5.0 fixes the `«event columns»` template as the canonical set of columns
 * every money-mutating table Waves D and E create MUST include verbatim. The
 * template lives at `wave0/EVENT_COLUMNS_CANONICAL.sql` — this test asserts
 * that file exists, is well-formed, and lists the nine required columns.
 *
 * Wave 0 does NOT create money-mutating tables (that's Wave D). This lint is
 * a fixture-shape test only: it protects the template file itself against
 * accidental damage between now and Wave D's first substitution.
 *
 * The full lint against downstream substitution will land in Wave D's
 * `wave_d_event_columns_substitution.test.ts`; there, every money-mutating
 * table will be scanned to confirm the template appears verbatim.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const TEMPLATE_PATH = path.resolve(__dirname, "../../wave0/EVENT_COLUMNS_CANONICAL.sql");

// The nine canonical event columns per V7 §5.0 lines 4488-4547.
const REQUIRED_COLUMNS = [
  "actor_id",
  "request_id",
  "idempotency_key",
  "source_event_type",
  "source_event_id",
  "reverses_id",
  "seq",
  "created_at",
  "deleted_at",
];

const REQUIRED_EXCEPTIONS = [
  "«event columns minus deleted_at»",
  "«event columns minus source_event»",
  "«event columns minus deleted_at and source_event»",
];

describe("Wave 0 acceptance 0-C: event columns canonical template shape", () => {
  it("template file exists at wave0/EVENT_COLUMNS_CANONICAL.sql", () => {
    expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
  });

  it("template lists every required event column", () => {
    const source = fs.readFileSync(TEMPLATE_PATH, "utf8");
    for (const col of REQUIRED_COLUMNS) {
      expect(source, `template missing column "${col}"`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("template documents every V7 §5.0 exception marker", () => {
    // Normalise whitespace on both sides so prose that wraps a marker across
    // lines still matches. The marker's identity is its word sequence, not its
    // exact layout in commentary.
    const raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
    const flat = raw.replace(/\s+/g, " ");
    for (const marker of REQUIRED_EXCEPTIONS) {
      const flatMarker = marker.replace(/\s+/g, " ");
      expect(flat, `template missing exception marker "${marker}"`).toContain(flatMarker);
    }
  });

  it("template mandates the idempotency_key uniqueness index", () => {
    const source = fs.readFileSync(TEMPLATE_PATH, "utf8");
    // The template's post-declaration section must instruct callers to add
    // `CREATE UNIQUE INDEX ... WHERE idempotency_key IS NOT NULL`.
    expect(source).toMatch(/CREATE UNIQUE INDEX[\s\S]+idempotency_key/i);
    expect(source).toMatch(/WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL/i);
  });

  it("template pins the `seq > 0` and `created_at GLOB` CHECKs", () => {
    const source = fs.readFileSync(TEMPLATE_PATH, "utf8");
    expect(source).toMatch(/CHECK\s*\(\s*seq\s*>\s*0\s*\)/i);
    expect(source).toMatch(/GLOB\s+'\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]T\*'/);
  });
});
