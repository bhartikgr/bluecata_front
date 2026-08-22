/**
 * WAVE 82 · ITEMS 2 AND 3 — THE SPV LAUNCH GATE, AND REVIEW COMPLETENESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ITEM 2 — WHAT WAS ACTUALLY WRONG, MEASURED, NOT REPORTED.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The reported defect was "Carry % accepts 250 and the SPV launches on it". It
 * does not. Carry on this path is a FRACTION on the wire — the wizard divides by
 * 100 and `PERCENT_FIELD_DOMAIN["spv.carryPct"]` is `[0,1]` — and
 * `spvEngineStore.addFee`, the sole writer of `spv_fee`, refuses `carryPct > 1`
 * by name. Executed (build_log/wave82/W82_ITEM2_LAUNCH_BEFORE.txt): entering 250
 * produced `POST /spv` 201, `PUT /mandate` ok, `POST /fees` 400
 * `CARRY_PCT_REQUIRED` — `ATTESTED VEHICLE EXISTS: true · FEE ROWS: 0`. A signed,
 * ESIGN-attested vehicle with no GP economics at all. That is the defect.
 *
 * The fix refuses BEFORE the first request. The same predicate drives the step-2
 * Next gate and the first line of `create.mutationFn`, so the two can never
 * disagree and no attested vehicle can be created without its fee terms.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ITEM 3 — SEVEN COLLECTED INPUTS WERE NEVER SHOWN ON REVIEW & LAUNCH.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Geography, Stage, mandate min check, mandate max check, minimum investment,
 * Cap and Currency. The values persist; the screen whose only purpose is
 * verification before an ESIGN/UETA attestation simply did not show them.
 *
 * Repo convention for this component (see `wfix2d_spv_optional.test.ts`):
 * behaviour is asserted against static source. The BEHAVIOURAL half of Item 2 —
 * that the three network calls are never issued — is additionally proven by
 * source structure here (the throw is the first statement in the mutation) and
 * by the executed server transcript above.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const wizard = readFileSync(resolve(__dirname, "..", "PartnerSpvEngine.tsx"), "utf8");
const routes = readFileSync(
  resolve(__dirname, "..", "..", "..", "..", "..", "server", "spvEngineRoutes.ts"),
  "utf8",
);

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 2 · POLE A — IT REFUSES, BY NAME, BEFORE ANYTHING IS CREATED.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W82 ITEM 2 · the launch refuses before it creates anything", () => {
  it("the refusal is the FIRST statement in create.mutationFn, above every apiRequest", () => {
    const mut = wizard.slice(wizard.indexOf("const create = useMutation({"));
    const throwAt = mut.indexOf("if (refusal) throw new Error(refusal);");
    const firstCall = mut.indexOf('apiRequest("POST", "/api/partner/me/spv"');
    expect(throwAt).toBeGreaterThan(-1);
    expect(firstCall).toBeGreaterThan(-1);
    // If this ever inverts, an attested vehicle can exist without fee terms again.
    expect(throwAt).toBeLessThan(firstCall);
  });

  it("the step-2 Next gate and the launch use the SAME predicate", () => {
    expect(wizard).toContain("if (step === 2) return feeStepRefusal() === null;");
    expect(wizard).toContain("const refusal = feeStepRefusal();");
  });

  it("carry is bounded 0..100 AS WRITTEN, and the refusal names the field, bound and unit", () => {
    expect(wizard).toContain("const CARRY_PCT_AS_WRITTEN_MAX = 100;");
    expect(wizard).toContain("if (c > CARRY_PCT_AS_WRITTEN_MAX) {");
    expect(wizard).toContain("Carry % must be between 0 and ${CARRY_PCT_AS_WRITTEN_MAX} (20 = 20%). You entered ${raw}.");
    expect(wizard).toContain('if (c < 0) return "Carry % cannot be negative.";');
  });

  it("the hurdle is bounded 0..100 AS WRITTEN — at entry, not months later at a distribution", () => {
    expect(wizard).toContain("const HURDLE_PCT_AS_WRITTEN_MAX = 100;");
    expect(wizard).toContain("if (h > HURDLE_PCT_AS_WRITTEN_MAX) {");
    expect(wizard).toContain("Hurdle % must be between 0 and ${HURDLE_PCT_AS_WRITTEN_MAX} (8 = 8%).");
  });

  it("the numeric controls carry min/max/step, and the labels state the unit", () => {
    const carry = wizard.slice(wizard.indexOf('data-testid="spv-w-carrypct"') - 300, wizard.indexOf('data-testid="spv-w-carrypct"') + 300);
    expect(carry).toContain("min={0}");
    expect(carry).toContain("max={CARRY_PCT_AS_WRITTEN_MAX}");
    expect(carry).toContain("step={0.1}");
    /* THE UNIT IS STATED, AND THE ORIGINAL LABEL COPY IS PRESERVED. Writing the
       unit into the label itself ("Carry % (20 = 20%)") made `npm run guard`
       report the original strings "Carry %" and "Hurdle % (optional)" as REMOVED
       copy items — a real silent drop. The allowlist is 80 by owner ruling and
       this wave does not add to it, so the unit is additive. */
    expect(wizard).toContain("<Label>Carry %</Label>");
    expect(wizard).toContain("<Label>Hurdle % (optional)</Label>");
    expect(wizard).toContain('data-testid="spv-w-carrypct-unit"');
    expect(wizard).toContain('data-testid="spv-w-hurdle-unit"');
    expect(wizard).toContain("Enter it as written: 20 = 20%. Range 0–{CARRY_PCT_AS_WRITTEN_MAX}.");
    expect(wizard).toContain("Enter it as written: 8 = 8%. Range 0–{HURDLE_PCT_AS_WRITTEN_MAX}.");
    const hurdle = wizard.slice(wizard.indexOf('data-testid="spv-w-hurdle"'), wizard.indexOf('data-testid="spv-w-hurdle"') + 260);
    expect(hurdle).toContain("min={0}");
    expect(hurdle).toContain("max={HURDLE_PCT_AS_WRITTEN_MAX}");
    // Money inputs cannot go negative.
    expect(wizard).toContain('data-testid="spv-w-fixed" type="number" min={0}');
    expect(wizard).toContain('data-testid="spv-w-gpcommit" type="number" min={0}');
  });

  it("the inline reason exists in this wizard's own idiom and is APPENDED, not inserted", () => {
    expect(wizard).toContain('data-testid="spv-w-fee-error"');
    // Appended AFTER the platform-fee note, i.e. at the end of the step-2
    // container — the guard fingerprints panel children by subsequence and a
    // head insertion reads as a mass removal.
    expect(wizard.indexOf('data-testid="spv-w-fee-error"')).toBeGreaterThan(
      wizard.indexOf('data-testid="spv-w-platform-fee-note"'),
    );
  });

  it("NOTHING is clamped and the banned magnitude heuristic is absent", () => {
    // R16 / P-4: refuse, never rescale. `Math.min(1, n)` on a hurdle is the exact
    // defect P-4 records — an 8% hurdle turned into 100%.
    expect(wizard).not.toMatch(/Math\.min\(\s*1\s*,/);
    expect(wizard).not.toMatch(/Math\.max\(\s*0\s*,\s*Math\.min/);
    /* The banned `n > 1 ? n/100 : n` guess. Scanned over the source with COMMENTS
       STRIPPED, because this file's own documentation quotes the banned pattern in
       order to record that it is banned — and a scanner that cannot tell a
       prohibition from an occurrence is a scanner that will be silenced by
       deleting the prohibition. */
    const code = wizard
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/>\s*1\s*\?\s*[A-Za-z0-9_.]+\s*\/\s*100/);
    expect(code).not.toMatch(/Math\.min\(\s*1\s*,/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 2 · POLE B — THE LEGITIMATE PATH IS UNCHANGED.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W82 ITEM 2 · the legitimate path is untouched", () => {
  it("decimals are still accepted — nothing rounds or integer-coerces the carry", () => {
    // 20.5 must survive: the bound is a comparison, the payload is unchanged.
    expect(wizard).toContain("carryPct: w.mgmtFeeType !== \"fixed\" ? Number(w.mgmtCarryPct) / 100 : undefined");
    expect(wizard).not.toMatch(/Math\.round\(\s*Number\(w\.mgmtCarryPct\)/);
    expect(wizard).not.toMatch(/parseInt\(\s*w\.mgmtCarryPct/);
  });

  it("0 carry is still legal and a blank hurdle / GP commitment still launches", () => {
    // Only a value that is PRESENT and out of domain refuses.
    expect(wizard).toContain('if (w.hurdleRatePct.trim() !== "") {');
    expect(wizard).toContain('if (w.gpCommitMajor.trim() !== "") {');
    // 0 passes: the refusal is `< 0` / `> MAX`, never `!value`.
    expect(wizard).not.toContain("if (!Number(w.mgmtCarryPct)) return");
  });

  it("fee-type switching still resets dependent fields (SPV-BUG-2, untouched)", () => {
    expect(wizard).toContain('mgmtCarryPct: feeType === "fixed" ? "0" : (prev.mgmtCarryPct || "20")');
  });

  it("the launch button gate is still carryBasis + legal name + attestation", () => {
    expect(wizard).toMatch(/disabled=\{!w\.carryBasis \|\| !w\.signoffLegalName\.trim\(\) \|\| !w\.signoffAccepted/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 2 · SERVER — THE HURDLE FENCE ALREADY EXISTED; IT LIED ABOUT ITS STATUS.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W82 ITEM 2 · server — an out-of-domain percent is a 400, not a 500", () => {
  it("the hurdle normaliser is wired at BOTH terms-blob boundaries (pre-existing)", () => {
    expect(routes).toContain('if ("terms" in createBody) createBody.terms = normaliseSpvTermsHurdle(createBody.terms);');
    expect(routes).toContain('if ("terms" in patchBody) patchBody.terms = normaliseSpvTermsHurdle(patchBody.terms);');
  });

  it("PERCENT_FIELD_OUT_OF_DOMAIN is prefix-matched to 400 and names the field", () => {
    // The thrown message is `CODE:field:value:[min,max] — rationale`, so an
    // exact-key map lookup could never match it and it fell through to 500.
    expect(routes).toContain("if (msg.startsWith(`${PERCENT_FIELD_OUT_OF_DOMAIN}:`) || msg.startsWith(`${PERCENT_FIELD_UNKNOWN}:`)) {");
    expect(routes).toContain("return res.status(400).json({ error: msg, fieldError: parts[1] ?? null });");
  });

  it("a negative GP commitment is refused by name at create AND patch", () => {
    expect(routes).toContain('export const INVALID_GP_COMMIT = "INVALID_GP_COMMIT";');
    expect(routes).toContain("INVALID_GP_COMMIT: 400,");
    expect(routes).toContain('if ("terms" in createBody) assertGpCommitInDomain(createBody.terms);');
    expect(routes).toContain('if ("terms" in patchBody) assertGpCommitInDomain(patchBody.terms);');
    // An absent or null key is left untouched — not a migration, not newly required.
    expect(routes).toContain('if (!("gpCommitMinor" in t)) return;');
    expect(routes).toContain('if (raw === null || raw === undefined || raw === "") return;');
  });

  it("addFee's [0,1] carry domain is NOT widened", () => {
    const store = readFileSync(
      resolve(__dirname, "..", "..", "..", "..", "..", "server", "spvEngineStore.ts"),
      "utf8",
    );
    expect(store).toContain('data.carryPct > 1');
    expect(store).toContain('throw new Error("CARRY_PCT_REQUIRED");');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 3 — EVERY COLLECTED FIELD IS NOW ON REVIEW, OR EXPLICITLY DISCLOSED.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("W82 ITEM 3 · Review & Launch shows every field the wizard collects", () => {
  const review = wizard.slice(wizard.indexOf("{step === 4 && ("), wizard.indexOf('data-testid="spv-launch-signoff"'));

  it("the seven previously-absent rows are present", () => {
    for (const label of [
      'label="Geography"',
      'label="Stage"',
      'label="Mandate min check"',
      'label="Mandate max check"',
      'label="Minimum investment"',
      'label="Cap"',
      'label="Currency"',
    ]) {
      expect(review, label).toContain(label);
    }
  });

  it("money on the new rows uses the SAME formatter and the SAME currency as the existing rows", () => {
    expect(review).toContain('value={fmt(toMinor(parseFloat(w.minCheckMinor || "0") || 0, w.currency), w.currency)}');
    expect(review).toContain('value={fmt(toMinor(parseFloat(w.capMinor || "0") || 0, w.currency), w.currency)}');
    expect(review).toContain('value={w.checkMinMajor.trim() ? fmt(toMinor(parseFloat(w.checkMinMajor) || 0, w.currency), w.currency) : "—"}');
    expect(review).toContain('value={w.checkMaxMajor.trim() ? fmt(toMinor(parseFloat(w.checkMaxMajor) || 0, w.currency), w.currency) : "—"}');
  });

  it("a blank optional renders an explicit em-dash and stays optional", () => {
    expect(review).toContain('value={w.geography.trim() || "—"}');
    expect(review).toContain('value={w.stage.trim() || "—"}');
  });

  it("each new row's Edit returns to the step that OWNS the field", () => {
    // Mandate refinements are step 1; the terms amounts and currency are step 3.
    expect(review).toContain('label="Geography" value={w.geography.trim() || "—"} onEdit={() => setStep(1)}');
    expect(review).toContain('label="Stage" value={w.stage.trim() || "—"} onEdit={() => setStep(1)}');
    expect(review).toContain('label="Currency" value={w.currency} onEdit={() => setStep(3)}');
  });

  it("the currency is NAMED, so no amount on the screen is unit-ambiguous", () => {
    expect(review).toContain('label="Currency"');
    // The fee currency is a separate selection and is named when it can differ.
    expect(review).toContain('label="Fee currency" value={w.feeCurrency}');
  });

  it("the one DERIVED key is disclosed as derived rather than shown as entered", () => {
    expect(review).toContain('data-testid="spv-review-derived-note"');
    expect(review).toContain("is derived automatically from the country above and is not separately entered");
  });

  it("EVERY collected WizardState key is on Review, or named as excluded — no field is unaccounted for", () => {
    /* The completeness check the pre-flight's field table asks for, expressed as
       an assertion rather than a claim. Any key added to WizardState later must
       either appear on Review or be added to the exclusion list WITH its reason,
       which is what makes this test a gate and not a snapshot. */
    const iface = wizard.slice(wizard.indexOf("interface WizardState"), wizard.indexOf("}", wizard.indexOf("interface WizardState")));
    const keys = Array.from(iface.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??:/gm)).map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(25);

    const EXCLUDED: Record<string, string> = {
      jurisdiction: "derived from jurisdictionCountry; disclosed by spv-review-derived-note",
      jurisdictionOther: "folded into the Jurisdiction (country) row via juruDisplay",
      legalEntityStructureOther: "folded into the Legal entity structure row via legalEntityDisplay",
      signoffLegalName: "the attestation itself, collected on this very step",
      signoffAccepted: "the attestation itself, collected on this very step",
      closeDate: "not part of the attestation: editable after launch on the Close tab",
      jurisdictionCountry: "shown on the Jurisdiction (country) row via `juruDisplay`",
      legalEntityStructure: "shown on the Legal entity structure row via `legalEntityDisplay`",
    };

    const missing = keys.filter((k) => {
      if (k in EXCLUDED) return false;
      return !review.includes(`w.${k}`);
    });
    expect(missing, `collected but neither shown on Review nor listed as excluded: ${missing.join(", ")}`).toEqual([]);
  });

  it("no existing row was re-ordered, re-labelled or re-valued — the new rows are APPENDED", () => {
    // The pre-existing final row is the conditional Terms doc row; every new row
    // follows it, so no existing child's relative position changed.
    const termsDoc = review.indexOf('label="Terms doc"');
    expect(termsDoc).toBeGreaterThan(-1);
    for (const label of ['label="Geography"', 'label="Currency"', 'label="Cap"']) {
      expect(review.indexOf(label)).toBeGreaterThan(termsDoc);
    }
    // And the rows that were already there still read exactly as they did.
    expect(review).toContain('<ReviewRow label="Name" value={w.name || "(unnamed)"} onEdit={() => setStep(0)} />');
    expect(review).toContain('<ReviewRow label="Target raise" value={fmt(toMinor(parseFloat(w.targetRaiseMinor || "0") || 0, w.currency), w.currency)} onEdit={() => setStep(3)} />');
  });
});
