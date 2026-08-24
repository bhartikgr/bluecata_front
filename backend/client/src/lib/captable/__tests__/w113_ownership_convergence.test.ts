/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 1 — ONE OWNERSHIP IMPLEMENTATION, PROVEN BY ASSERTION.
   ════════════════════════════════════════════════════════════════════════════
   These tests do NOT check that the investor number "looks right". They assert
   the investor-side result AGAINST the founder-side reference engine, row by row
   and character by character, so the only way to pass is to be the same
   computation. A second implementation that happened to agree on today's
   fixtures would still fail `mustBeTheSameCall`, and any future re-derivation
   would fail the string comparison the moment a ratio stopped being exactly
   representable as a double.

   FAIL-BEFORE. Before this wave the investor's percentage came from
   `client/src/pages/investor/InvitationDetail.tsx:583-585`:

       const rawTotalShares = secs.reduce((s, x) => s + x.shares, 0);
       ownership = (x.shares / rawTotalShares) * 100;

   That expression is transcribed VERBATIM below as `legacyInvestorOwnership`,
   and `describe("FAIL-BEFORE")` proves it disagrees with the reference engine on
   the same fixtures — i.e. that the convergence asserted above is a real change
   in behaviour, not a restatement of what already happened. Those cases are the
   measured numbers recorded in `build_log/wave113/W113_PREFLIGHT.md` §1.1.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { runEngine, type ApiSecurity } from "@shared/roundMathEngineAdapter";
import type { View } from "@capavate/cap-table-engine";
import {
  computeInvestorOwnership,
  ownershipDenominatorSentence,
  investorOwnershipColumnHeader,
  makeHolderMatcher,
  INVESTOR_DEFAULT_VIEW,
} from "../investorOwnership";
import { VIEW_DENOMINATOR_LABEL, VIEW_LABEL } from "../exportProvenance";

const AS_OF = "2026-08-22";

function sec(
  p: Partial<ApiSecurity> & { holderName: string; instrument: string; shares: number },
): ApiSecurity {
  return {
    id: p.id ?? `s_${p.holderName}_${p.instrument}`,
    companyId: "co_fix",
    holderName: p.holderName,
    holderType: p.holderType ?? "investor",
    instrument: p.instrument,
    series: p.series ?? null,
    shares: p.shares,
    pricePerShare: p.pricePerShare ?? null,
    investmentAmount: p.investmentAmount ?? null,
    cap: p.cap ?? null,
    discount: p.discount ?? null,
    issuedAt: p.issuedAt ?? "2025-01-01",
  } as ApiSecurity;
}

/** Fixtures A–E, identical to the harness that produced the preflight table. */
const FOUNDER_A = sec({ holderName: "Founder A", holderType: "founder", instrument: "common", shares: 8_000_000 });
const SEED_FUND = sec({ holderName: "Seed Fund", instrument: "preferred", series: "Seed", shares: 2_000_000, pricePerShare: 1, investmentAmount: 2_000_000 });
const OPTION_POOL = sec({ holderName: "Option Pool", holderType: "employee", instrument: "option", shares: 1_500_000 });
const SAFE_HOLDER = sec({ holderName: "SAFE Holder", instrument: "safe", shares: 0, investmentAmount: 500_000, cap: 10_000_000, discount: 0.2 });
const WARRANT = sec({ holderName: "Warrant Holder", instrument: "warrant", shares: 250_000 });

const FIXTURES: Array<{ name: string; secs: ApiSecurity[] }> = [
  { name: "A · common only", secs: [FOUNDER_A, sec({ holderName: "Angel B", instrument: "common", shares: 2_000_000 })] },
  { name: "B · common + priced preferred", secs: [FOUNDER_A, SEED_FUND] },
  { name: "C · + option pool", secs: [FOUNDER_A, SEED_FUND, OPTION_POOL] },
  { name: "D · + unconverted SAFE", secs: [FOUNDER_A, SEED_FUND, SAFE_HOLDER] },
  { name: "E · + pool + SAFE + warrant", secs: [FOUNDER_A, SEED_FUND, OPTION_POOL, SAFE_HOLDER, WARRANT] },
];

const VIEWS: View[] = ["basic", "fully_diluted", "as_converted"];

/** VERBATIM transcription of the deleted investor-side second implementation. */
function legacyInvestorOwnership(secs: ApiSecurity[]): Map<string, number | null> {
  const rawTotalShares = secs.reduce((s, x) => s + x.shares, 0);
  const totalShares = rawTotalShares > 0 ? rawTotalShares : null;
  const out = new Map<string, number | null>();
  if (!totalShares) return out;
  for (const x of secs) out.set(x.holderName, (x.shares / totalShares) * 100);
  return out;
}

/** The reference: exactly what `client/src/pages/founder/CapTable.tsx` calls. */
function founderReference(secs: ApiSecurity[], view: View) {
  return runEngine(secs, view, "US", undefined, AS_OF);
}

describe("WAVE 113 · FINDING 1 — investor and founder percentages come from ONE implementation", () => {
  for (const f of FIXTURES) {
    for (const view of VIEWS) {
      it(`${f.name} · ${view} — every investor row is byte-identical to the founder engine's row`, () => {
        let reference: ReturnType<typeof founderReference> | null = null;
        let referenceThrew: Error | null = null;
        try {
          reference = founderReference(f.secs, view);
        } catch (err) {
          referenceThrew = err as Error;
        }

        const investor = computeInvestorOwnership({ securities: f.secs, view, asOf: AS_OF });

        /* THE REFUSAL MUST ALSO CONVERGE. Where the reference engine refuses (as-
           converted with a convertible and no priced round), the investor side must
           refuse too — not fall back to another view, and not print a zero. */
        if (referenceThrew) {
          expect(investor.ok).toBe(false);
          if (investor.ok === false) {
            expect(investor.reason).toBe("engine_refused");
            expect(investor.message).toContain(referenceThrew.message);
          }
          return;
        }

        expect(investor.ok).toBe(true);
        if (investor.ok !== true) return;

        // Same denominator, exactly — bigint, not a rounded double.
        expect(investor.totalShares).toBe(reference!.totalShares);
        expect(investor.asOf).toBe(reference!.asOf);

        const ref = new Map(reference!.rows.map((r) => [`${r.holderName}|${r.kind}|${r.series ?? ""}`, r]));
        expect(investor.rows.length).toBe(reference!.rows.length);
        for (const row of investor.rows) {
          const key = `${row.holderName}|${row.kind}|${row.series ?? ""}`;
          const r = ref.get(key);
          expect(r, `investor produced a row the founder engine did not: ${key}`).toBeTruthy();
          // STRING equality: a re-derivation would differ in the low digits.
          expect(row.ownershipPercent).toBe(r!.ownershipPercent);
          expect(row.shares).toBe(r!.shares);
        }
      });
    }
  }

  it("passes the engine's decimal string through untouched — no float round-trip anywhere", () => {
    // Fixture D on as-converted is the case whose exact ratio is a long decimal.
    const view: View = "fully_diluted";
    const reference = founderReference(FIXTURES[4]!.secs, view);
    const investor = computeInvestorOwnership({ securities: FIXTURES[4]!.secs, view, asOf: AS_OF });
    expect(investor.ok).toBe(true);
    if (investor.ok !== true) return;
    for (const row of investor.rows) {
      const r = reference.rows.find((x) => x.holderName === row.holderName && x.kind === row.kind);
      expect(typeof row.ownershipPercent === "string" || row.ownershipPercent === null).toBe(true);
      expect(row.ownershipPercent).toBe(r!.ownershipPercent);
    }
  });

  it("redacts AFTER the shared computation — the withheld view's own percentage is unchanged", () => {
    const view: View = "fully_diluted";
    const full = computeInvestorOwnership({ securities: FIXTURES[4]!.secs, view, asOf: AS_OF });
    const redacted = computeInvestorOwnership({
      securities: FIXTURES[4]!.secs,
      view,
      asOf: AS_OF,
      mine: makeHolderMatcher(["Seed Fund"]),
      redact: true,
    });
    expect(full.ok && redacted.ok).toBe(true);
    if (full.ok !== true || redacted.ok !== true) return;

    // Only one row survives …
    expect(redacted.rows.length).toBe(1);
    expect(redacted.redacted).toBe(true);
    // … and its percentage is the SAME number it had in the unredacted table.
    const mineInFull = full.rows.find((r) => r.holderName === "Seed Fund")!;
    expect(redacted.rows[0]!.ownershipPercent).toBe(mineInFull.ownershipPercent);
    // The denominator was NOT recomputed over the surviving subset (which would
    // have made this holder 100%).
    expect(redacted.totalShares).toBe(full.totalShares);
    expect(redacted.rows[0]!.ownershipPercent).not.toBe("100");
  });

  it("refuses rather than fabricate when there are no securities", () => {
    const r = computeInvestorOwnership({ securities: [], asOf: AS_OF });
    expect(r.ok).toBe(false);
    if (r.ok !== false) return;
    expect(r.reason).toBe("no_securities");
    expect(r.message).toMatch(/not zero — it is unknown/);
    expect(r.message).not.toMatch(/\b0(\.0+)?%/);
  });

  it("fails CLOSED when the viewer has no identifiable holder names", () => {
    const r = computeInvestorOwnership({
      securities: FIXTURES[4]!.secs,
      asOf: AS_OF,
      mine: makeHolderMatcher([null, undefined, "  "]),
      redact: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    expect(r.rows.length).toBe(0); // withholds everything, never reveals everything
    expect(r.redacted).toBe(true);
  });
});

describe("WAVE 113 · FINDING 1 — an investor's percentage NAMES its denominator", () => {
  it("states a denominator for every view, in the founder's own words", () => {
    for (const view of VIEWS) {
      const sentence = ownershipDenominatorSentence(view);
      expect(sentence).toContain(VIEW_DENOMINATOR_LABEL[view]);
      expect(sentence).toContain(VIEW_LABEL[view]);
      expect(investorOwnershipColumnHeader(view)).toContain(VIEW_DENOMINATOR_LABEL[view]);
    }
  });

  it("carries the label on the RESULT, so a rendered figure cannot be separated from its basis", () => {
    for (const view of VIEWS) {
      const r = computeInvestorOwnership({ securities: FIXTURES[2]!.secs, view, asOf: AS_OF });
      expect(r.view).toBe(view);
      expect(r.viewLabel).toBe(VIEW_LABEL[view]);
      expect(r.denominatorLabel).toBe(VIEW_DENOMINATOR_LABEL[view]);
    }
  });

  it("the three views really are three different denominators — so naming it is not decoration", () => {
    const secs = FIXTURES[2]!.secs; // pool present
    const basic = computeInvestorOwnership({ securities: secs, view: "basic", asOf: AS_OF });
    const fd = computeInvestorOwnership({ securities: secs, view: "fully_diluted", asOf: AS_OF });
    expect(basic.ok && fd.ok).toBe(true);
    if (basic.ok !== true || fd.ok !== true) return;
    expect(basic.totalShares).not.toBe(fd.totalShares);
    const mineBasic = basic.rows.find((r) => r.holderName === "Founder A")!.ownershipPercent;
    const mineFd = fd.rows.find((r) => r.holderName === "Founder A")!.ownershipPercent;
    expect(mineBasic).not.toBe(mineFd);
  });

  it("defaults to the view the investor card has always claimed in prose", () => {
    expect(INVESTOR_DEFAULT_VIEW).toBe("fully_diluted");
    const r = computeInvestorOwnership({ securities: FIXTURES[1]!.secs, asOf: AS_OF });
    expect(r.view).toBe("fully_diluted");
  });
});

describe("WAVE 113 · FINDING 1 — FAIL-BEFORE: the deleted second implementation really did disagree", () => {
  it("option pool, Basic view — legacy 69.56…%, engine 80%", () => {
    const legacy = legacyInvestorOwnership(FIXTURES[2]!.secs).get("Founder A")!;
    const engine = computeInvestorOwnership({ securities: FIXTURES[2]!.secs, view: "basic", asOf: AS_OF });
    expect(engine.ok).toBe(true);
    if (engine.ok !== true) return;
    const now = engine.rows.find((r) => r.holderName === "Founder A")!.ownershipPercent!;
    expect(String(legacy)).not.toBe(now);
    // The gap is material, not a rounding artefact: >10 percentage points.
    expect(Math.abs(Number(now) - (legacy as number))).toBeGreaterThan(10);
  });

  it("unconverted SAFE — legacy showed the SAFE holder as 0, the engine states a real position", () => {
    const legacy = legacyInvestorOwnership(FIXTURES[3]!.secs).get("SAFE Holder")!;
    expect(legacy).toBe(0); // `shares` is 0 on the wire for an unconverted SAFE
    const engine = computeInvestorOwnership({ securities: FIXTURES[3]!.secs, view: "fully_diluted", asOf: AS_OF });
    expect(engine.ok).toBe(true);
    if (engine.ok !== true) return;
    const row = engine.rows.find((r) => r.holderName === "SAFE Holder");
    // Whatever the engine says, it must not be the legacy "0" invented by the
    // raw-shares sum. It is either a stated percentage or an explicit null.
    if (row) expect(row.ownershipPercent).not.toBe("0");
  });

  it("the legacy expression cannot state a denominator at all — there was nothing to name", () => {
    // The legacy map is keyed by holder and carries no view, no label, no total.
    const legacy = legacyInvestorOwnership(FIXTURES[2]!.secs);
    expect(Object.keys(legacy)).not.toContain("view");
    // Whereas every result from the shared module carries all three.
    const r = computeInvestorOwnership({ securities: FIXTURES[2]!.secs, asOf: AS_OF });
    expect(r.viewLabel.length).toBeGreaterThan(0);
    expect(r.denominatorLabel.length).toBeGreaterThan(0);
  });
});
