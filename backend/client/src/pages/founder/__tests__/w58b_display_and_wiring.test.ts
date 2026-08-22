/**
 * WAVE 58b — THE DISPLAYED OWNERSHIP TOTAL, AND THE SOURCE WIRING OF THE
 * PLACEMENT AND THE POOL EDIT SURFACE.
 *
 * WHAT THIS FILE IS AND IS NOT. Sections 1 and 2 are real unit tests of a real
 * exported function. Section 3 is a SOURCE-LOCK: it reads the two page files and
 * asserts the wiring exists. A source-lock is weaker than an executed render and
 * this file says so rather than implying otherwise — the executed proof for the
 * pool edit path is the HTTP route test
 * `server/__tests__/w58b_pool_placement_reachability.test.ts` §3, which drives the
 * same `PATCH /api/rounds/:id/terms` the dialog sends. What remains UNVERIFIED is
 * that a browser click produces that request; that is recorded in
 * `build_log/wave58b/WAVE58B_REPORT.md` with what would settle it.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave58b/W58B_NEW_TESTS.md`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayedOwnershipTotal } from "../CapTable";

const HERE = join(process.cwd(), "client", "src", "pages", "founder");

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — THE DISTRIBUTION THAT ACTUALLY BREAKS UNDER NAIVE ROUNDING (DEFECT 6)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-D1 — the displayed total is derived from the displayed rows", () => {
  it("W58B-D1a — three equal holders display 33.33% each and the total is 99.99%, not a hardcoded 100.00%", () => {
    /* THE POINT OF THE WHOLE DEFECT. Each row is exactly 33.333…%, prints as
       33.33%, and three of them sum to 99.99%. The old code printed the LITERAL
       `100.00%` beneath them, so the table asserted something its own rows
       contradicted, with no way for a reader to tell which to trust.
       Reproduced with exact decimals in `build_log/wave58b/w58b_exact_math.py`. */
    const rows = [
      { ownershipPercent: "33.33333333333333333333" },
      { ownershipPercent: "33.33333333333333333333" },
      { ownershipPercent: "33.33333333333333333333" },
    ];
    const t = displayedOwnershipTotal(rows);
    expect(t.sum).toBe("99.99");
    expect(t.exact).toBe(false);
  });

  it("W58B-D1b — a distribution whose 2dp rows DO sum to 100.00% is reported as exact", () => {
    /* 1/7, 2/7, 4/7 -> 14.29 + 28.57 + 57.14 = 100.00. Verified in the same
       Python reference, so the gate is not "always inexact". */
    const rows = [
      { ownershipPercent: "14.28571428571428571429" },
      { ownershipPercent: "28.57142857142857142857" },
      { ownershipPercent: "57.14285714285714285714" },
    ];
    const t = displayedOwnershipTotal(rows);
    expect(t.sum).toBe("100.00");
    expect(t.exact).toBe(true);
  });

  it("W58B-D1c — the canonical engine fixture rounds to exactly 100.00%", () => {
    /* The real post-close projection from the route test: founders 60.000001…,
       pool 15.000000…, investor 24.999998… -> 60.00 + 15.00 + 25.00 = 100.00. The
       W58 test proved this ONE fixture and called it the invariant; D1a shows it
       is not. Both are asserted here so neither claim can drift. */
    const rows = [
      { ownershipPercent: "60.00000150000003750000093750002343750059" },
      { ownershipPercent: "15.00000037500000937500023437500585937515" },
      { ownershipPercent: "24.99999812499995312499882812497070312427" },
    ];
    const t = displayedOwnershipTotal(rows);
    expect(t.sum).toBe("100.00");
    expect(t.exact).toBe(true);
  });

  it("W58B-D1d — an over-100 case is reported too, not silently floored to 100.00", () => {
    /* Rounding can go UP as well as down. Six holders of 1/6 each display 16.67%,
       summing to 100.02%. A total that can only ever read <= 100.00 would hide it. */
    const rows = Array.from({ length: 6 }, () => ({ ownershipPercent: "16.66666666666666666667" }));
    const t = displayedOwnershipTotal(rows);
    expect(t.sum).toBe("100.02");
    expect(t.exact).toBe(false);
  });

  it("W58B-D1e — an empty table reports 0.00%, not 100.00%", () => {
    const t = displayedOwnershipTotal([]);
    expect(t.sum).toBe("0.00");
    expect(t.exact).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — NO HARDCODED TOTAL SURVIVES IN THE FLAT TABLE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-D2 — the literal is gone from the source", () => {
  it("W58B-D2a — the flat holdings total cell renders a derived value", () => {
    const src = readFileSync(join(HERE, "CapTable.tsx"), "utf8");
    expect(src).toContain('data-testid="captable-flat-total-percent"');
    /* The value is rendered from the derivation. The `data-testid` sits on the
       inner `<span>` rather than the `<td>` so the cell keeps its positional
       silent-drop-guard identity — see the note in CapTable.tsx. */
    expect(src).toContain("{displayedTotal.sum}</span>%");
    /* The exact JSX literal that used to be there. */
    expect(src).not.toContain('font-mono tabular-nums">100.00%<');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — SOURCE-LOCKS (weaker than a render; stated as such)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-D3 — the placement reaches the derivation and the pool reaches Edit terms", () => {
  it("W58B-D3a — RoundNew passes the selected placement into the derivation", () => {
    const src = readFileSync(join(HERE, "RoundNew.tsx"), "utf8");
    /* DEFECT 1.1 — the argument that did not exist before this wave. */
    expect(src).toContain("poolPlacement: addonPoolDraft.poolMode");
    /* DEFECT 1.2 — the gross-up is skipped for post-money placement. */
    expect(src).toContain('if (addonPoolDraft.poolMode === "post_money") return 0;');
    /* The source-locked auto-PPS expression is UNCHANGED. */
    expect(src).toContain("shares / (1 - poolTopUpPct)");
    /* DEFECT 3 — the resolved base, not the raw typed field. */
    expect(src).toContain("fdPreMoneyShares: wizardBase.base.toString()");
    expect(src).toContain("resolveFdPreMoneyBase");
    /* Both placements remain SELECTABLE. Nothing is disabled. */
    expect(src).toContain('<SelectItem value="post_money">');
    expect(src).not.toMatch(/SelectItem value="post_money"[^>]*disabled/);
    /* Who-pays is on screen, always open. */
    expect(src).toContain('data-testid="addon-pool-who-pays"');
  });

  it("W58B-D3b — Edit terms has the pool percentage, the placement and the FD count", () => {
    const src = readFileSync(join(HERE, "Rounds.tsx"), "utf8");
    for (const id of [
      "edit-pool-section",
      "edit-pool-toggle",
      "edit-pool-percent",
      "edit-pool-placement",
      "edit-fd-pre-money-shares",
      "edit-pool-who-pays",
    ]) {
      expect(src).toContain(`data-testid="${id}"`);
    }
    /* It sends them on the PATCH the route test exercises. */
    expect(src).toContain("optionPoolPostPercent: poolPercent.trim()");
    expect(src).toContain("optionPoolMode: poolMode");
    /* And it uses the SAME derivation function as the wizard — not a second one. */
    expect(src).toContain("derivePoolTopUpFromPercent");
  });

  it("W58B-D3c — RoundDetail passes the STORED placement, not a literal", () => {
    const src = readFileSync(join(HERE, "RoundDetail.tsx"), "utf8");
    /* The literal that overwrote the founder's choice. */
    expect(src).not.toContain('optionPoolMode: "pre_money" as const,');
    expect(src).toContain('("post_money" as const)');
    expect(src).toContain("resolveFdPreMoneyBase");
    expect(src).toContain('data-testid="disclosure-w58b-fd-base"');
  });

  it("W58B-D3d — the term sheet reads the round instead of hardcoding 10% post-money", () => {
    const src = readFileSync(join(HERE, "TermSheet.tsx"), "utf8");
    /* The three literals, gone. */
    expect(src).not.toContain("poolSize: 10,");
    expect(src).not.toContain('poolTiming: "post_money",');
    expect(src).not.toContain("fdSharesPreMoney: 12_500_000,");
    /* Replaced by reads of the round. */
    expect(src).toContain("optionPoolPostPercent");
    expect(src).toContain("optionPoolMode");
    expect(src).toContain("fdPreMoneyShares");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — THE 2026-08-15 LIVE AUDIT FINDINGS (production v26.17.0)
 * ═══════════════════════════════════════════════════════════════════════════
 * These four came from a browser audit of live, not from the tree. Each is a
 * source-lock on the specific literal or rule the audit named.
 */
describe("W58B-D4 — live-audit findings folded in", () => {
  it("W58B-D4a — the Terms tab no longer hardcodes '10% post-money pool refresh'", () => {
    /* LIVE, on every round tested, Active and Draft:
         ESOP top-up    10% post-money pool refresh
       It is now read from the round's own percentage and placement. */
    const src = readFileSync(join(HERE, "RoundDetail.tsx"), "utf8");
    expect(src).not.toContain('"10% post-money pool refresh"');
    expect(src).toContain("No option-pool top-up recorded on this round");
    expect(src).toContain("% of post-money fully-diluted, ${mode} placement");
  });

  it("W58B-D4b — the Terms tab caption now says WHERE terms are actually edited", () => {
    /* LIVE: the caption claimed "Editing terms is permitted in draft state" while
       the panel was static text in Draft as well as Active. The caption is a true
       statement about the RULE and is left byte-identical; the missing half — where
       the edit happens — is supplied. */
    const src = readFileSync(join(HERE, "RoundDetail.tsx"), "utf8");
    expect(src).toContain('data-testid="terms-edit-where"');
    /* WAVE 83 · ITEM 1 — the sentence must still state the RULE; the internal
       error constant `closed_round_readonly` must NOT be shown to a founder. */
    expect(src).toContain("refuses every term edit once the round is closed or funded");
    expect(src).not.toContain("closed_round_readonly");
  });

  it("W58B-D4c — ONE validation rule now serves BOTH pool-percentage fields", () => {
    /* LIVE: `-5` was rejected on the standalone vehicle's percentage field and
       accepted SILENTLY on the add-on's field, and `999999999` passed on both.
       The standalone field now runs through the same `parsePoolPercentAsWritten`
       the add-on uses, so there is one range (R16 [0,100)) and one set of names. */
    const src = readFileSync(join(HERE, "RoundNew.tsx"), "utf8");
    expect(src).toContain('parsePoolPercentAsWritten(form.poolSize, "Pool size (% of fully-diluted)")');
    /* The pre-existing blank/zero message and its test id are UNCHANGED. */
    expect(src).toContain('reqPos("poolSize", "Pool size")');
    expect(src).toContain('data-testid="err-poolSize"');
  });

  it("W58B-D4d — the PPS caption stops claiming a gross-up under post-money placement", () => {
    /* LIVE: the caption reads "(incl. option-pool top-up) — FD = 10,500,000" and did
       so regardless of placement. Under post-money placement the pool is NOT in the
       denominator, so the caption now says that instead. */
    const src = readFileSync(join(HERE, "RoundNew.tsx"), "utf8");
    expect(src).toContain("option-pool top-up EXCLUDED — post-money placement");
    expect(src).toContain("(incl. option-pool top-up)");
  });

  it("W58B-D4e — the standalone vehicle's 'Pool timing' now reaches the ONE stored key", () => {
    /* LIVE: the standalone Option-Pool vehicle has had a percentage field AND a
       pre/post-money "Pool timing" dropdown all along — but `poolTiming` appears in
       ZERO server files and ZERO engine files, so it reached no arithmetic. Both
       surfaces now write the same `optionPoolMode` key. Both dropdowns remain fully
       selectable; nothing is disabled or removed. */
    const src = readFileSync(join(HERE, "RoundNew.tsx"), "utf8");
    expect(src).toContain('form.poolTiming === "post_money" ? "post_money" : "pre_money"');
    /* `poolTiming` is STILL SENT under its own key — no silent drop. */
    expect(src).toContain("poolTiming");
    /* Exactly ONE `optionPoolMode` key in the parent payload: a duplicate key in an
       object literal is a silent last-one-wins bug. */
    const parentPayloadKeys = (src.match(/^\s*optionPoolMode:/gm) ?? []).length;
    expect(parentPayloadKeys).toBeLessThanOrEqual(2);
  });
});
