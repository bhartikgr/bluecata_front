/**
 * WAVE 90 · ITEM 3 — M-3: RAW INTERNAL VALUES SHOWN TO AN INVESTOR.
 *
 * The live audit found an investor reading `Safe_post` in a column headed
 * "Instrument": the database enum `safe_post` put through a CSS `capitalize`.
 *
 * `scripts/lint/internalLanguageFence.ts` is blind to this class by
 * construction — it inspects STRING LITERALS in the source, and `{r.instrument}`
 * is an expression whose value only exists at runtime. This file is the runtime
 * half of that protection.
 *
 * ── WHAT IT ASSERTS ──────────────────────────────────────────────────────────
 *  1. COMPLETENESS BY WALKING THE DOMAIN, not by listing values here. Every
 *     member of `INSTRUMENTS`, `ROUND_STATES` and `YOUR_DECISION_STATES` must
 *     resolve to a label, and that label must not be the raw value. Add a new
 *     instrument or state without a label and this fails — which is what makes
 *     the label tables data rather than a stale copy of the data.
 *  2. THE ACTUAL DEFECT: `safe_post` -> "SAFE (post-money)".
 *  3. NO RESOLVER EVER RETURNS A RAW TOKEN, for the known domain OR for a value
 *     it has never seen (the humanise fallback), OR for an identifier.
 *  4. `displayName` DESCRIBES the row when the name is missing or is itself an
 *     id (Wave 83's `u_redeemed_...` -> "Redeemed holder" precedent), and never
 *     leaks any part of the id — including no prefix and no suffix fragment.
 *  5. THE POLE THAT STOPS THIS BEING A BLANKET REWRITER: a real human name, and
 *     a real round name, pass through byte-identical.
 *
 * MUTATION TRANSCRIPT: build_log/wave90/W90_TESTS.md.
 */
import { describe, it, expect } from "vitest";
import {
  INSTRUMENTS,
  ROUND_STATES,
  YOUR_DECISION_STATES,
  HOLDER_TYPE_LABELS,
} from "../schema";
import {
  instrumentLabel,
  instrumentLongLabel,
  holderTypeLabel,
  roundStateLabel,
  decisionStateLabel,
  statusLabel,
  aliasBasisLabel,
  displayName,
  describeUnnamed,
  humaniseToken,
  looksLikeRawId,
  looksLikeRawToken,
  NO_LABEL,
} from "../investorDisplayLabels";

/** A rendered string an investor may read. Never snake_case, never an id. */
function assertHumanReadable(label: string, sourceValue: string) {
  expect(label).toBeTruthy();
  expect(label).not.toBe(sourceValue);
  expect(looksLikeRawToken(label)).toBe(false);
  expect(label).not.toMatch(/_/);
  /* For a MULTI-TOKEN enum, the label must not merely be the value with a
     capital letter — `Safe_post` is exactly that defect. A single-word value
     such as `draft` legitimately labels as "Draft", so the check is scoped to
     the values where capitalisation alone cannot be a label. */
  if (sourceValue.includes("_")) {
    expect(label.toLowerCase()).not.toBe(sourceValue.toLowerCase());
  }
  /* NOTE ON WHAT IS DELIBERATELY *NOT* ASSERTED. An earlier draft also required
     the label to differ from the de-underscored value, to catch a lazy
     `replace(/_/g," ")`. It is dropped, and the reason is recorded rather than
     quietly deleted: "Convertible note" and "Terms set" ARE the right labels and
     happen to coincide with that form. The contract that matters is the one
     above — an investor never reads `convertible_note`. Where de-underscoring
     genuinely is not a label, the case is pinned directly: see the alias-basis
     test, which asserts "email hash match" is not acceptable. */
}

describe("W90 · ITEM 3 — the domain tables are complete, walked from the domain", () => {
  it("every INSTRUMENT has a short label and a long label, and neither is the enum", () => {
    expect(INSTRUMENTS.length).toBeGreaterThan(0);
    for (const inst of INSTRUMENTS) {
      expect(typeof inst.shortLabel).toBe("string");
      assertHumanReadable(instrumentLabel(inst.value), inst.value);
      assertHumanReadable(instrumentLongLabel(inst.value), inst.value);
      /* The short label really is shorter — a table cell must not carry the full
         legal description, which is a different usability defect. */
      expect(inst.shortLabel.length).toBeLessThanOrEqual(inst.label.length);
    }
  });

  it("THE M-3 DEFECT — `safe_post` renders as 'SAFE (post-money)'", () => {
    expect(instrumentLabel("safe_post")).toBe("SAFE (post-money)");
    expect(instrumentLabel("safe_post")).not.toBe("Safe_post");
    expect(instrumentLabel("safe_pre")).toBe("SAFE (pre-money)");
  });

  it("every ROUND_STATE has a label", () => {
    for (const s of ROUND_STATES) assertHumanReadable(roundStateLabel(s), s);
  });

  it("every YOUR_DECISION_STATE has a label", () => {
    for (const s of YOUR_DECISION_STATES) assertHumanReadable(decisionStateLabel(s), s);
  });

  it("every HOLDER_TYPE has a label, including `pool`, which is not a person", () => {
    for (const t of Object.keys(HOLDER_TYPE_LABELS)) {
      expect(holderTypeLabel(t)).toBe(HOLDER_TYPE_LABELS[t]);
      expect(looksLikeRawToken(holderTypeLabel(t))).toBe(false);
    }
    expect(holderTypeLabel("pool")).toContain("Option pool");
  });

  it("STATUS LABELS ARE NEUTRAL — the correction a failing test forced", () => {
    /* Wave 90's FIRST CUT routed every `status` through the Your-Decision labels,
       so a DISCLOSURE SUBMISSION with status `pending` rendered "Awaiting your
       decision". That is false: it means awaiting REVIEW, and the investor has no
       decision to make. `wave18_orp040_investor_panels.test.ts` failed and was
       right to. A confidently wrong label is WORSE than a raw enum, because a raw
       enum does not assert something untrue.

       This assertion is the guard against the same shortcut being taken again. */
    expect(statusLabel("pending")).toBe("Pending review");
    expect(statusLabel("pending")).not.toContain("decision");
    expect(statusLabel("under_review")).toBe("Under review");
    expect(statusLabel("deal_specific")).toBe("Deal-specific (single asset)");

    /* And the decision machine keeps its own, decision-specific wording, so the
       two domains are not collapsed into one. */
    expect(decisionStateLabel("pending")).toBe("Awaiting your decision");
    expect(decisionStateLabel("pending")).not.toBe(statusLabel("pending"));
  });

  it("the alias basis enum is labelled, not merely de-underscored", () => {
    const label = aliasBasisLabel("email_hash_match");
    assertHumanReadable(label, "email_hash_match");
    /* The pre-fix behaviour was `.replace(/_/g," ")` -> "email hash match". */
    expect(label).not.toBe("email hash match");
  });
});

describe("W90 · ITEM 3 — no resolver can emit a raw token, ever", () => {
  const RESOLVERS: Array<[string, (v: unknown) => string]> = [
    ["instrumentLabel", instrumentLabel],
    ["instrumentLongLabel", instrumentLongLabel],
    ["holderTypeLabel", holderTypeLabel],
    ["roundStateLabel", roundStateLabel],
    ["decisionStateLabel", decisionStateLabel],
    ["statusLabel", statusLabel],
    ["aliasBasisLabel", aliasBasisLabel],
  ];

  /* Values no table has been taught about — a server that shipped a new state
     before the client did. This is the case a hardcoded switch fails silently. */
  const UNKNOWN = [
    "safe_mfn_post",
    "some_future_state",
    "TIER_PRICE_UNPRICED",
    "fully_diluted",
  ];

  it("an UNKNOWN machine token is still humanised, not passed through", () => {
    for (const [name, fn] of RESOLVERS) {
      for (const v of UNKNOWN) {
        const out = fn(v);
        expect(out, `${name}(${v})`).not.toBe(v);
        expect(out, `${name}(${v})`).not.toMatch(/_/);
      }
    }
  });

  it("null / undefined / blank produce the marker, never the word 'undefined'", () => {
    for (const [name, fn] of RESOLVERS) {
      for (const v of [null, undefined, "", "   "]) {
        const out = fn(v);
        expect(out, `${name}(${String(v)})`).toBe(NO_LABEL);
        expect(out).not.toContain("undefined");
        expect(out).not.toContain("null");
        expect(out).not.toContain("NaN");
      }
    }
  });

  it("humaniseToken turns `safe_post` into prose and never returns the token", () => {
    expect(humaniseToken("safe_post")).toBe("Safe post");
    expect(humaniseToken("SOME_ERROR_CODE")).toBe("Some error code");
    expect(looksLikeRawToken(humaniseToken("a_b_c"))).toBe(false);
  });
});

describe("W90 · ITEM 3 — identifiers are described, never printed", () => {
  const RAW_IDS = [
    "u_redeemed_9f2a",
    "usr_01hq9",
    "ext_182fd266aa5b6cd3",
    "co_novapay",
    "rnd_f9930d1a6d4d",
    "inv_rnd_f46a8de2bae1_92237b6c0e851b0b",
    "sc_abc123",
    "spv_quantum",
  ];

  it("looksLikeRawId recognises every id prefix this codebase mints", () => {
    for (const id of RAW_IDS) expect(looksLikeRawId(id), id).toBe(true);
  });

  it("and does NOT flag a human name that happens to contain punctuation", () => {
    for (const name of [
      "Hydra Capital — Aisha Rahman",
      "O'Neill Ventures",
      "Anchor Growth Partners",
      "Seed Extension",
      "SAFE (post-money)",
    ]) {
      expect(looksLikeRawId(name), name).toBe(false);
    }
  });

  it("displayName DESCRIBES the row and leaks no part of the id", () => {
    for (const id of RAW_IDS) {
      const out = displayName(id, "holder", id);
      expect(out).toBe("Unnamed holder");
      /* No prefix, no fragment, no last-N characters. */
      expect(out).not.toContain(id);
      expect(out).not.toContain(id.slice(0, 4));
      expect(out).not.toContain(id.slice(-4));
    }
  });

  it("displayName describes by KIND, so the row still says what it is", () => {
    expect(displayName(null, "round", "rnd_x")).toBe("Unnamed round");
    expect(displayName("", "company", "co_x")).toBe("Unnamed company");
    expect(displayName(undefined, "vehicle", "spv_x")).toBe("Unnamed vehicle");
    expect(describeUnnamed("investor")).toBe("Unnamed investor");
  });

  it("describeUnnamed returns nothing derived from the id it is handed", () => {
    const out = describeUnnamed("holder", "u_secret_abcdef123456");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("abcdef");
    expect(out).not.toContain("u_");
  });

  it("THE POLE — a real name passes through BYTE-IDENTICAL", () => {
    for (const name of [
      "Hydra Capital — Aisha Rahman",
      "Maya Chen",
      "NovaPay Seed Extension",
      "Forge Ventures",
    ]) {
      expect(displayName(name, "holder", "u_x")).toBe(name);
      expect(displayName(name, "round", "rnd_x")).toBe(name);
    }
  });

  it("a name with surrounding whitespace is trimmed, not described away", () => {
    expect(displayName("  Maya Chen  ", "holder")).toBe("Maya Chen");
  });
});
