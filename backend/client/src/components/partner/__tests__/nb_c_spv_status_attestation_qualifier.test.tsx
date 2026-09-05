/**
 * NUMBERS BAND · WAVE C · W324 — THE STATUS BADGE TELLS THE TRUTH IN EVERY BRANCH,
 * AND THE STATUS `<option>` LIST DID NOT MOVE.
 *
 * THE DEFECT. On live, "QUantum SPV" rendered the badge "Deployed" with the wave 189
 * panel directly beneath it saying the vehicle "has no signed launch attestation on
 * record. It is an unattested draft." Both were true of the stored row. The badge
 * was the misleading half.
 *
 * WHAT THIS FILE PROVES, IN ORDER:
 *   0. PRECONDITIONS FIRST. The census of `spvStatusLabel` consumers is what this
 *      wave claims it is, and the `<option>` line this wave must not break is
 *      actually present in the source. Every later assertion is worthless if these
 *      are not true, so they are asserted before anything is rendered.
 *   1. FIVE BRANCHES, FIVE HONEST SENTENCES. unattested · attested · loading ·
 *      error · unrecognised shape. The rule child renders in ALL FIVE; the verdict
 *      child renders in ALL FIVE and is never silent.
 *   2. THE THREE VERDICTS ARE MUTUALLY DISTINGUISHABLE. The "could not be read"
 *      sentence contains neither of the two real answers, so an unreadable record
 *      can never be misread as either.
 *   3. THE `<option>` IS UNCHANGED — proved three ways: the four wire values are
 *      still the four wire values; `spvStatusLabel` still maps each of them to the
 *      exact word it mapped to before this wave; and the JSX of the option line
 *      itself is byte-identical to a pinned literal.
 *   4. THE MOUNTS EXIST. A component nobody renders fixes nothing.
 *
 * WHY THE `<option>` NEEDS ITS OWN PROOF. `PartnerSpvs.tsx` builds its status
 * `<option>` list from a FILE-LOCAL array — `SPV_STATUS_WIRE_VALUES = ["planned",
 * "open", "closed", "wound_down"]` — and passes each value through the SAME
 * `spvStatusLabel()` that renders the badge this wave is correcting. "planned" is
 * not a key of the label map at all; it reaches the screen via the humanising
 * fallback. A one-line "fix" inside `spvStatusLabel` or `SPV_STATUS_LABELS` would
 * therefore have silently rewritten this control's four option texts. This wave
 * touched neither, and that is asserted rather than asserted-by-hope.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { spvStatusLabel } from "@/lib/partnerDisplay";
import { SPV_UNATTESTED_DRAFT_LABEL } from "@shared/spvUnattestedDraft";
import SpvStatusAttestationQualifier, {
  SPV_STATUS_IS_LIFECYCLE_ONLY,
  SPV_ATTESTATION_VERDICT_SIGNED,
  SPV_ATTESTATION_VERDICT_UNSIGNED,
  SPV_ATTESTATION_VERDICT_UNKNOWN,
} from "@/components/partner/SpvStatusAttestationQualifier";

afterEach(() => cleanup());

const TESTID = "nbc-status";
const PRODUCTION_FILES = [
  "client/src/pages/partner/PartnerSpvDetail.tsx",
  "client/src/pages/partner/PartnerSpvs.tsx",
  "client/src/pages/partner/PartnerSpvEngine.tsx",
  "client/src/components/partner/PartnerSpvSwitcher.tsx",
];

function readSrc(p: string): string {
  const src = readFileSync(p, "utf8");
  /* A source file that parses to nothing is one of this platform's catalogued
     inert mechanisms. Refuse an empty read outright. */
  expect(src.length, `${p} read as empty`).toBeGreaterThan(500);
  return src;
}

/** Strip comments so a claim about CODE is never satisfied by prose in a comment. */
function stripComments(src: string): string {
  const stripped = src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  expect(stripped.length, "the comment stripper stripped nothing").toBeLessThan(src.length);
  return stripped;
}

function renderWith(
  data: unknown,
  opts: { error?: boolean; loading?: boolean; spvId?: string } = {},
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async () => {
          if (opts.error) throw new Error("nb-C signoff read failed");
          if (opts.loading) await new Promise(() => {}); /* never settles */
          return data;
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SpvStatusAttestationQualifier spvId={opts.spvId ?? "spv_nbc"} testid={TESTID} />
    </QueryClientProvider>,
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   0 · PRECONDITIONS — asserted before a single render.
   ════════════════════════════════════════════════════════════════════════════ */
describe("NB wave C · preconditions", () => {
  it("the `spvStatusLabel` consumer census is EXACTLY 4 production files / 5 call sites", () => {
    /* Counted by executing the count here, not by trusting the brief. The brief and
       the engineering doc both said SIX call sites; the fifth-and-final count is
       five, and that correction is recorded in the wave C verification note. A CALL
       SITE is `spvStatusLabel(` with an argument — an `import` line is not one. */
    const perFile = PRODUCTION_FILES.map((p) => {
      const code = stripComments(readSrc(p));
      const calls = code.match(/\bspvStatusLabel\s*\(/g) ?? [];
      return { p, calls: calls.length };
    });
    expect(perFile.length).toBe(4);
    for (const f of perFile) expect(f.calls, `${f.p} has no call site`).toBeGreaterThan(0);
    expect(perFile.reduce((a, f) => a + f.calls, 0)).toBe(5);
    /* And the per-file split, so a call moving between files cannot pass. */
    expect(perFile.map((f) => f.calls)).toEqual([2, 1, 1, 1]);
  });

  it("the `<option>` line this wave must not break IS PRESENT in the source", () => {
    const code = stripComments(readSrc("client/src/pages/partner/PartnerSpvs.tsx"));
    expect(code).toContain("SPV_STATUS_WIRE_VALUES.map((s) => (");
    expect(code).toContain("<option key={s} value={s}>{spvStatusLabel(s)}</option>");
  });

  it("the shared label used by the verdict is the real shared label, not a copy", () => {
    expect(SPV_UNATTESTED_DRAFT_LABEL).toBe("Unattested draft");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   1 · FIVE BRANCHES. THE RULE ALWAYS RENDERS; THE VERDICT IS NEVER SILENT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("NB wave C · the copy is true in every branch", () => {
  /* `settled: true` waits for the query to have RESOLVED before the verdict is
     read. Without it the first read lands during the loading branch and gets the
     honest "unanswered" sentence — which is correct behaviour, and is exactly what
     the first draft of this file accidentally asserted against. The loading branch
     has its own test below; here we are asserting the settled answer. */
  async function bothChildren(settled = false) {
    await waitFor(() => expect(screen.getByTestId(`${TESTID}-rule`)).toBeTruthy());
    if (settled) {
      await waitFor(() =>
        expect(
          screen.getByTestId(`${TESTID}-verdict`).textContent,
        ).not.toBe(SPV_ATTESTATION_VERDICT_UNKNOWN),
      );
    }
    const rule = screen.getByTestId(`${TESTID}-rule`).textContent ?? "";
    const verdict = screen.getByTestId(`${TESTID}-verdict`).textContent ?? "";
    return { rule, verdict };
  }

  it("UNATTESTED (signoffs: []) → the verdict names it an unattested draft", async () => {
    renderWith({ signoffs: [] });
    const { rule, verdict } = await bothChildren(true);
    expect(rule).toBe(SPV_STATUS_IS_LIFECYCLE_ONLY);
    expect(verdict).toBe(SPV_ATTESTATION_VERDICT_UNSIGNED);
    expect(verdict.toLowerCase()).toContain("unattested draft");
    expect(verdict).toContain("No signed launch attestation is on record");
  });

  it("ATTESTED (one signoff) → the verdict SAYS SO, instead of falling silent", async () => {
    renderWith({ signoffs: [{ id: "sof_1", signerLegalName: "Ozan Trendwell", signedAt: "2026-07-20T00:00:00Z" }] });
    const { rule, verdict } = await bothChildren(true);
    expect(rule).toBe(SPV_STATUS_IS_LIFECYCLE_ONLY);
    expect(verdict).toBe(SPV_ATTESTATION_VERDICT_SIGNED);
    /* The whole point: an attested vehicle is now DISTINGUISHABLE from a vehicle
       whose record could not be read. The wave 189 panel renders nothing for both. */
    expect(verdict).not.toBe(SPV_ATTESTATION_VERDICT_UNKNOWN);
  });

  it("WHILE LOADING → an honest 'unanswered', containing NEITHER real verdict", async () => {
    renderWith(null, { loading: true });
    const { rule, verdict } = await bothChildren();
    expect(rule).toBe(SPV_STATUS_IS_LIFECYCLE_ONLY);
    expect(verdict).toBe(SPV_ATTESTATION_VERDICT_UNKNOWN);
  });

  it("ON A READ ERROR → the same honest 'unanswered'; 'unattested' is never asserted from a failed fetch", async () => {
    renderWith(null, { error: true });
    await new Promise((r) => setTimeout(r, 40));
    const { rule, verdict } = await bothChildren();
    expect(rule).toBe(SPV_STATUS_IS_LIFECYCLE_ONLY);
    expect(verdict).toBe(SPV_ATTESTATION_VERDICT_UNKNOWN);
  });

  it("AN UNRECOGNISED PAYLOAD SHAPE → 'unanswered', never a guess", async () => {
    const shapes: unknown[] = [{}, { signoffs: null }, { signoffs: "none" }, { foo: 1 }, null];
    /* PRECONDITION: this loop must actually iterate. A loop over zero rows that
       passes is one of this platform's catalogued vacuous greens. */
    expect(shapes.length).toBe(5);
    let checked = 0;
    for (const junk of shapes) {
      cleanup();
      renderWith(junk);
      await new Promise((r) => setTimeout(r, 40));
      const verdict = screen.getByTestId(`${TESTID}-verdict`).textContent ?? "";
      expect(verdict, JSON.stringify(junk)).toBe(SPV_ATTESTATION_VERDICT_UNKNOWN);
      expect(screen.getByTestId(`${TESTID}-rule`).textContent).toBe(SPV_STATUS_IS_LIFECYCLE_ONLY);
      checked += 1;
    }
    expect(checked).toBe(5);
  });

  it("AN EMPTY spvId → 'unanswered'. Nothing is claimed about a vehicle that was not identified", async () => {
    renderWith({ signoffs: [] }, { spvId: "" });
    const { verdict } = await bothChildren();
    expect(verdict).toBe(SPV_ATTESTATION_VERDICT_UNKNOWN);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2 · THE COPY IS A RULE, NOT A NUMBER — and no machine code reaches the DOM.
   ════════════════════════════════════════════════════════════════════════════ */
describe("NB wave C · copy discipline", () => {
  it("the rule states a RULE: no count, no figure, no claim about this vehicle", async () => {
    renderWith({ signoffs: [] });
    await waitFor(() => expect(screen.getByTestId(`${TESTID}-rule`)).toBeTruthy());
    const rule = screen.getByTestId(`${TESTID}-rule`).textContent ?? "";
    expect(rule).toContain("lifecycle stage only");
    expect(rule).not.toMatch(/\d/);
    expect(rule).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
    expect(rule.trim().length).toBeGreaterThan(80);
  });

  it("no ALL-CAPS underscore machine code reaches either child, in any branch", async () => {
    for (const payload of [{ signoffs: [] }, { signoffs: [{ id: "x" }] }, {}]) {
      cleanup();
      renderWith(payload);
      await waitFor(() => expect(screen.getByTestId(`${TESTID}-verdict`)).toBeTruthy());
      for (const suffix of ["-rule", "-verdict"]) {
        const t = screen.getByTestId(`${TESTID}${suffix}`).textContent ?? "";
        expect(t, `${suffix} / ${JSON.stringify(payload)}`).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
        expect(t).not.toContain("undefined");
        expect(t).not.toContain("null");
      }
    }
  });

  it("the three verdicts are pairwise distinct and each is a full sentence", () => {
    const all = [
      SPV_ATTESTATION_VERDICT_SIGNED,
      SPV_ATTESTATION_VERDICT_UNSIGNED,
      SPV_ATTESTATION_VERDICT_UNKNOWN,
    ];
    expect(new Set(all).size).toBe(3);
    for (const v of all) {
      expect(v.trim().length).toBeGreaterThan(40);
      expect(v.trim().endsWith(".")).toBe(true);
    }
    /* The unknown branch must not contain either real answer's claim. */
    expect(SPV_ATTESTATION_VERDICT_UNKNOWN).not.toContain("is on record for this vehicle");
    expect(SPV_ATTESTATION_VERDICT_UNKNOWN.toLowerCase()).not.toContain("unattested draft");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3 · THE STATUS `<option>` LIST IS UNCHANGED.
   ════════════════════════════════════════════════════════════════════════════ */
describe("NB wave C · the status <option> list did not move", () => {
  /* The exact four values `PartnerSpvs.tsx` maps over, and the exact word each one
     rendered before this wave. Pinned as literals so a change to the label map or to
     `spvStatusLabel` fails HERE rather than silently on an operator's screen. */
  const OPTION_VALUES = ["planned", "open", "closed", "wound_down"] as const;
  const OPTION_TEXTS = ["Planned", "Open", "Closed", "Wound-down"] as const;

  it("the file-local wire-value array is still exactly those four values, in that order", () => {
    const code = stripComments(readSrc("client/src/pages/partner/PartnerSpvs.tsx"));
    const m = code.match(/const\s+SPV_STATUS_WIRE_VALUES\s*=\s*\[([^\]]*)\]/);
    expect(m, "SPV_STATUS_WIRE_VALUES not found").toBeTruthy();
    const values = (m![1].match(/"([^"]+)"/g) ?? []).map((q) => q.slice(1, -1));
    expect(values.length).toBe(4);
    expect(values).toEqual([...OPTION_VALUES]);
  });

  it("spvStatusLabel still renders the SAME FOUR option words it rendered before this wave", () => {
    expect(OPTION_VALUES.length).toBe(4); /* precondition: the loop iterates */
    const rendered = OPTION_VALUES.map((v) => spvStatusLabel(v));
    expect(rendered).toEqual([...OPTION_TEXTS]);
    /* "Planned" is NOT a key of the label map — it arrives through the humanising
       fallback. Asserted explicitly because it is the value most likely to be
       collateral damage from an edit to that map. */
    expect(spvStatusLabel("planned")).toBe("Planned");
  });

  it("REAL <option> ELEMENTS built the same way the page builds them render those four words", () => {
    render(
      <select data-testid="nbc-option-probe" defaultValue="open">
        {OPTION_VALUES.map((s) => (
          <option key={s} value={s}>{spvStatusLabel(s)}</option>
        ))}
      </select>,
    );
    const opts = Array.from(
      screen.getByTestId("nbc-option-probe").querySelectorAll("option"),
    );
    expect(opts.length).toBe(4);
    expect(opts.map((o) => o.textContent)).toEqual([...OPTION_TEXTS]);
    expect(opts.map((o) => o.getAttribute("value"))).toEqual([...OPTION_VALUES]);
    /* And the new wave-C copy is nowhere inside this control. */
    const selectText = screen.getByTestId("nbc-option-probe").textContent ?? "";
    expect(selectText).not.toContain("lifecycle stage only");
    expect(selectText).not.toContain("launch attestation");
  });

  it("the <option> JSX and the label map are BYTE-IDENTICAL to their pinned form", () => {
    const spvsSrc = readSrc("client/src/pages/partner/PartnerSpvs.tsx");
    expect(spvsSrc).toContain(
      '                {SPV_STATUS_WIRE_VALUES.map((s) => (\n                  <option key={s} value={s}>{spvStatusLabel(s)}</option>\n                ))}',
    );
    const displaySrc = readSrc("client/src/lib/partnerDisplay.ts");
    expect(displaySrc).toContain(
      'const SPV_STATUS_LABELS: Record<string, string> = {\n  draft: "Draft",\n  open: "Open",\n  deployed: "Deployed",\n  distributing: "Distributing",\n  closed: "Closed",\n  wound_down: "Wound-down",\n};',
    );
    /* This wave added nothing to the label module. */
    expect(displaySrc).not.toContain("SPV_STATUS_IS_LIFECYCLE_ONLY");
    expect(displaySrc).not.toContain("SpvStatusAttestationQualifier");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4 · THE MOUNTS. A component nobody renders fixes nothing.
   ════════════════════════════════════════════════════════════════════════════ */
describe("NB wave C · the qualifier is MOUNTED where the badge is read", () => {
  it("PartnerSpvDetail mounts it in the Status cell, and the badge line above is byte-verbatim", () => {
    const src = readSrc("client/src/pages/partner/PartnerSpvDetail.tsx");
    const code = stripComments(src);
    expect(code).toContain("<SpvStatusAttestationQualifier");
    expect(code).toContain('testid="partner-spv-status-attestation"');
    /* The pre-existing badge line is unchanged, and the qualifier comes AFTER it. */
    expect(src).toContain('<div data-testid="partner-spv-status">{spvStatusLabel(s.status)}</div>');
    const badgeIdx = code.indexOf('data-testid="partner-spv-status"');
    const mountIdx = code.indexOf("<SpvStatusAttestationQualifier");
    expect(badgeIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(badgeIdx);
  });

  it("SpvDetailTabs mounts it in the Status cell, beside the wave 189 notice, not as a new grid cell", () => {
    const src = readSrc("client/src/components/partner/SpvDetailTabs.tsx");
    const code = stripComments(src);
    expect(code).toContain("<SpvStatusAttestationQualifier");
    expect(code).toContain('testid="spv-detail-status-attestation"');
    /* The wave 189 notice is still mounted — this wave replaced nothing. */
    expect(code).toContain("<SpvAttestationStatusNotice");
    /* Not a table cell. */
    const idx = code.indexOf("<SpvStatusAttestationQualifier");
    const before = code.slice(Math.max(0, idx - 250), idx);
    expect(before).not.toMatch(/<td[\s>]/);
    expect(before).not.toMatch(/<th[\s>]/);
    /* It sits inside the existing `spv-detail-status` cell, after the raw status. */
    expect(code).toContain('<div className="text-xs">{spv.status ?? "—"}</div>');
    expect(code.indexOf('data-testid="spv-detail-status"')).toBeLessThan(idx);
  });

  it("PartnerSpvEngine renders the RULE beside the row badge, and does NOT add a per-row fetch", () => {
    const src = readSrc("client/src/pages/partner/PartnerSpvEngine.tsx");
    const code = stripComments(src);
    expect(code).toContain("SPV_STATUS_IS_LIFECYCLE_ONLY");
    expect(code).toContain("spv-row-status-lifecycle-only-");
    /* The row badge line is byte-verbatim, separators and all. */
    expect(src).toContain(
      "{(SPV_TYPE_LABELS as Record<string, string>)[s.spvType] ?? s.spvType} · {spvStatusLabel(s.status)} · {labelFor(DISTRIBUTION_SCOPE_LABELS, s.distributionScope)} · Carry: {labelFor(CARRY_BASIS_LABELS, s.carryBasis)}",
    );
    /* NO per-row verdict here: the component itself is not mounted in this file,
       because a verdict per row would be one HTTP request per row. */
    expect(code).not.toContain("<SpvStatusAttestationQualifier");
  });

  it("the component reads the SAME query key as the wave 189 notice, so no extra request is made", () => {
    const mine = stripComments(readSrc("client/src/components/partner/SpvStatusAttestationQualifier.tsx"));
    const theirs = stripComments(readSrc("client/src/components/partner/SpvAttestationStatusNotice.tsx"));
    const KEY = 'queryKey: ["/api/partner/me/spv", spvId, "signoffs"]';
    expect(theirs).toContain(KEY);
    expect(mine).toContain(KEY);
  });
});
