/**
 * WAVE 23 · ITEM 6 (FINAL REVIEW B) — falsification harness for the
 * jurisdiction leak in the SPV document-type dropdown.
 *
 * BOTH POLES:
 *   POLE A  A NON-US vehicle must NOT be offered `formd` or `blue_sky`, in any
 *           of the ontology's non-US jurisdictions, and for `other` (the
 *           explicit we-do-not-know), and for unresolvable free text.
 *   POLE B  A US vehicle MUST still be offered them. The fix must not strip a
 *           filing a Delaware SPV genuinely needs.
 *
 * Plus the two constraints the brief put on the fix:
 *   · NO FOREIGN DOCUMENT TYPES ARE INVENTED — every non-US list is a strict
 *     subset of the existing enum, and is exactly the neutral set.
 *   · The persisted enum is NOT narrowed — `SPV_DOC_TYPES` still contains all
 *     seven, so pre-existing documents of any type still read back.
 * And that the dropdown itself is wired to the filter, not to the raw enum.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave23/item6_doctype_jurisdiction_harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  SPV_DOC_TYPES,
  SPV_JURISDICTIONS,
  SPV_US_ONLY_DOC_TYPES,
  spvDocTypesForJurisdiction,
  isSpvDocTypeAllowedForJurisdiction,
  spvJurisdictionCompliance,
  resolveSpvJurisdiction,
} from "../../shared/spvEngine.ts";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}
function eq(actual: unknown, expected: unknown, label: string) {
  asserts++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NEUTRAL = ["formation", "operating_agreement", "subscription", "kyc", "tax"];

/* ── The enum itself must be untouched ─────────────────────────────────── */
eq(
  [...SPV_DOC_TYPES],
  ["formation", "operating_agreement", "subscription", "formd", "blue_sky", "kyc", "tax"],
  "ENUM: SPV_DOC_TYPES is NOT narrowed — pre-existing documents of any type still read back",
);
eq([...SPV_US_ONLY_DOC_TYPES], ["formd", "blue_sky"], "ENUM: exactly two types are US-only");

/* ── POLE A / POLE B over EVERY jurisdiction in the ontology ───────────── */
let usSeen = 0;
let nonUsSeen = 0;
for (const j of SPV_JURISDICTIONS) {
  const list = spvDocTypesForJurisdiction(j);
  const isUs = spvJurisdictionCompliance(j).isUnitedStates;
  if (isUs) {
    usSeen++;
    eq([...list], [...SPV_DOC_TYPES], `POLE B [${j}]: a US vehicle keeps Form D and blue-sky`);
    ok(isSpvDocTypeAllowedForJurisdiction("formd", j), `POLE B [${j}]: formd allowed`);
    ok(isSpvDocTypeAllowedForJurisdiction("blue_sky", j), `POLE B [${j}]: blue_sky allowed`);
  } else {
    nonUsSeen++;
    eq([...list], NEUTRAL, `POLE A [${j}]: exactly the neutral set — no US filings, nothing invented`);
    ok(!isSpvDocTypeAllowedForJurisdiction("formd", j), `POLE A [${j}]: Form D is NOT offered`);
    ok(!isSpvDocTypeAllowedForJurisdiction("blue_sky", j), `POLE A [${j}]: blue-sky is NOT offered`);
  }
  // NOTHING INVENTED: every offered type already exists in the enum.
  ok(
    list.every((t) => (SPV_DOC_TYPES as readonly string[]).includes(t)),
    `[${j}]: no fabricated document type — the list is a subset of the enum`,
  );
}
ok(usSeen === 1, `ONTOLOGY: exactly one US jurisdiction drives POLE B (saw ${usSeen})`);
ok(nonUsSeen >= 14, `ONTOLOGY: POLE A exercised across the non-US ontology (saw ${nonUsSeen})`);

/* ── The free-text / unresolved paths fail CLOSED ──────────────────────── */
for (const input of [
  "Cayman Islands",
  "Grand Cayman, Cayman Islands",
  "Singapore",
  "Ontario, Canada",
  "Delaware, Cayman Islands", // contradictory ⇒ "other"
  "Atlantis",
  "",
  null,
  undefined,
]) {
  const resolved = resolveSpvJurisdiction(input as any);
  if (!spvJurisdictionCompliance(input as any).isUnitedStates) {
    eq(
      [...spvDocTypesForJurisdiction(input as any)],
      NEUTRAL,
      `FAIL-CLOSED [${String(input)} → ${resolved}]: neutral set only`,
    );
  }
}
// …and the US free-text spellings still work.
for (const input of ["Delaware", "delaware", "United States", "USA", "Delaware, USA"]) {
  eq(
    [...spvDocTypesForJurisdiction(input)],
    [...SPV_DOC_TYPES],
    `POLE B [${input}]: US free text still resolves to the full list`,
  );
}

/* ── The DROPDOWN is wired to the filter, not the raw enum ─────────────── */
const src = fs.readFileSync(
  path.join(process.cwd(), "client", "src", "components", "partner", "SpvDetailTabs.tsx"),
  "utf8",
);
ok(
  /\{docTypes\.map\(\(t\) => <option/.test(src),
  "WIRING: the <select> renders the filtered list",
);
ok(
  !/\{SPV_DOC_TYPES\.map\(\(t\) => <option/.test(src),
  "WIRING: the <select> no longer renders the unfiltered enum",
);
ok(
  /spvDocTypesForJurisdiction\(jurisdiction\)/.test(src),
  "WIRING: the filter is driven by the vehicle's resolved jurisdiction",
);
ok(
  /<DocumentPanel spvId=\{spvId\} jurisdiction=\{jurisdiction\}/.test(src),
  "WIRING: the panel receives the same jurisdiction the compliance content uses",
);
ok(
  /if \(!\(docTypes as readonly string\[\]\)\.includes\(docType\)\) setDocType\(docTypes\[0\]\);/.test(src),
  "WIRING: a now-disallowed selection is reset rather than submitted",
);
ok(
  /useState<string>\(docTypes\[0\]\)/.test(src),
  "WIRING: the initial selection comes from the filtered list",
);

if (failures.length > 0) {
  console.error(`FAIL item6_doctype_jurisdiction_harness: ${failures.length}/${asserts} asserts failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS item6_doctype_jurisdiction_harness: ${asserts} asserts, 0 failures`);
