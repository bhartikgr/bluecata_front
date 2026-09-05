/* ════════════════════════════════════════════════════════════════════════════
   WAVE 124 · FINDING 1 — NO RAW INTERNAL IDENTIFIER MAY REACH A HUMAN.
   ════════════════════════════════════════════════════════════════════════════
   The owner's rule, verbatim: "I don't want any exposure of our internal
   process. This needs to be investor grade and professional."

   Reviewer C measured "45+ render sites across 25 files". Measured properly with
   an AST instrument, the population is 415 sites across 134 files (scan v1,
   `build_log/wave124/scan_before.txt`) and 456 sites across 145 files once the
   fallback family is included (scan v2) — Reviewer C's figure was low by roughly
   ten times. This wave fixes the screens it owns; the remainder is enumerated,
   with file:line, in `build_log/wave124/W124_PREFLIGHT.md`.

   WHAT THIS TEST ASSERTS. On the screens this wave touched, the SAME detector
   that measured the population now finds ZERO machine-named expressions in
   human-read positions, except for a small set of sites reviewed by hand and
   named below with the reason each is not a leak. So the test cannot be passed by
   relabelling one string: it re-derives the answer from the AST every run.

   WHAT IT DOES NOT TOUCH. `data-testid`, `key`, `href`, `to`, `id`, `className`,
   `aria-*`, form `value`, and error `code` payload fields are machine-readable
   and are explicitly allowed to carry raw ids. The rule governs what a human
   READS. Today's suite depends on those testids and none were changed.

   FAIL-BEFORE PROOF. Run against the pre-wave tree this file reports 34 sites in
   these eight files; verbatim output in `build_log/wave124/W124_TESTS.md` §2.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { scanFiles } from "./w124_rawIdentifierDetector";
import { partyReferenceLabel, humanizeMachineKey } from "@/lib/partnerDisplay";

const R = (rel: string) => resolve(__dirname, "..", rel);

/** Every screen this wave changed. */
const TOUCHED = [
  "components/CloseRoundPanel.tsx",
  "pages/founder/Dashboard.tsx",
  "pages/founder/Dataroom.tsx",
  "pages/founder/Reports.tsx",
  "pages/admin/Companies.tsx",
  "pages/admin/Reconciliation.tsx",
  "pages/partner/PartnerContacts.tsx",
  "pages/partner/PartnerMfcrmPersonas.tsx",
  /* WAVE NB-B — added because this panel now goes to ZERO unexplained hits.
     `pages/partner/PartnerManagedFounders.tsx` was deliberately NOT added here:
     it carries six pre-existing hits outside this band's scope, and admitting
     six new exemptions to this shared list would weaken an instrument that
     currently guards eight other screens. That file is pinned instead by its own
     dedicated test, `nb_b_managed_founders_residual.test.ts`, which names the
     exact six and asserts the one this wave fixed is gone. */
  "components/partner/AttributionProvenancePanel.tsx",
];

/* ── the hand-reviewed exceptions ──────────────────────────────────────────────
   Each entry is a site the detector reports by NAME but which a person reading
   the screen does not experience as internal exposure. They are listed here, not
   suppressed in the detector, so the exception stays visible and reviewable.
     · `role` / `company?.role` — the value space is `founder` | `admin` |
       `investor`. These are English words for the reader's own relationship to
       the company, not storage keys, and they are already how the product speaks
       about roles everywhere else.
     · `conflict_code` under a column headed "Code", and `Reference: {code}` — a
       business reference the partner is expected to quote back to us. It is
       LABELLED as a reference, which is exactly the treatment the rule asks for
       when an id is the only thing on record.
   The `{code}` sites are matched by their labelled shape; nothing else in these
   files is exempt. */
const ALLOWED = [
  { file: "components/CloseRoundPanel.tsx", text: "{role}" },
  { file: "pages/founder/Dashboard.tsx", pos: "H2-attr:description" },
  { file: "pages/partner/PartnerMfcrmPersonas.tsx", text: "{code}" },
  /* WAVE NB-B — the SAME labelled-reference exception as `{code}` above, and for
     the same reason. After this wave `{a.companyId}` is reachable in only ONE
     branch of the panel: the one where the company has no name on file at all,
     where it renders as `Company reference co_…` — labelled, quotable, and the
     only truthful thing available. The resolved branch prints the real name and
     contains no identifier; `nb_b_provenance_names_dom.test.tsx` asserts both
     branches by rendered text, which is what this static exemption cannot do. */
  { file: "components/partner/AttributionProvenancePanel.tsx", text: "{a.companyId}" },
];

function residual() {
  const hits = scanFiles(TOUCHED.map(R));
  return hits.filter((h) => {
    const rel = TOUCHED.find((t) => h.file.endsWith(t)) ?? h.file;
    return !ALLOWED.some(
      (a) => rel.endsWith(a.file) && (a.text ? h.text.includes(a.text) : h.pos === a.pos),
    );
  });
}

describe("(A) the touched screens expose no raw internal identifier", () => {
  it("reports zero machine-named expressions in human-read positions", () => {
    const left = residual();
    expect(
      left.map((h) => `${h.file}:${h.line} ${h.cls} ${h.pos} ${h.text}`).join("\n"),
    ).toBe("");
    expect(left).toHaveLength(0);
  });

  it("still carries the machine-readable identifiers the suite depends on", () => {
    /* The other half of the rule: the fix must NOT have stripped ids from the
       positions machines read. If this ever goes quiet, the wave broke the
       testids instead of fixing the copy. */
    const closeRound = readFileSync(R("components/CloseRoundPanel.tsx"), "utf8");
    const contacts = readFileSync(R("pages/partner/PartnerContacts.tsx"), "utf8");
    expect(closeRound).toMatch(/data-testid=/);
    expect(contacts).toContain("data-testid={`contacts-row-${r.id}`}");
    expect(contacts).toContain("data-testid={`conn-portfolio-${p.companyId}`}");
  });
});

describe("(B) the round-close panel names holders in plain English", () => {
  /* The screen that GATES closing a round printed a raw `holderId` under a
     column headed "Holder". `HolderDiff` carries no name, so no name is
     invented — the id is stated as what it is. */
  const src = readFileSync(R("components/CloseRoundPanel.tsx"), "utf8");
  const admin = readFileSync(R("pages/admin/Reconciliation.tsx"), "utf8");

  it("no longer renders the bare holder id or the bare instrument key", () => {
    expect(src).not.toContain('font-medium">{d.holderId}</td>');
    expect(src).not.toContain('px-2">{d.kind}</td>');
    expect(src).toContain("partyReferenceLabel(d.holderId)");
    expect(src).toContain("humanizeMachineKey(d.kind)");
  });

  it("gives the admin view of the same divergence the same words", () => {
    expect(admin).toContain("partyReferenceLabel(d.holderId)");
    expect(admin).toContain("humanizeMachineKey(d.kind)");
  });

  it("produces a label a person can read, carrying no internal prefix", () => {
    const label = partyReferenceLabel("u_aisha_patel");
    expect(label).toBe("Reference AISHA-PATEL");
    expect(label).not.toMatch(/\b(u_|usr_|co_|rnd_|spv_|round_|inv_)/);
    expect(humanizeMachineKey("priced_equity")).toBe("Priced equity");
    expect(humanizeMachineKey("safe_note")).toBe("Safe note");
  });

  it("never fabricates a display name when nothing is on record", () => {
    expect(partyReferenceLabel("")).toBe("Not recorded");
    expect(partyReferenceLabel(null)).toBe("Not recorded");
    expect(humanizeMachineKey("")).toBe("Not recorded");
  });
});

describe("(C) no rendered token survives on the touched screens", () => {
  /* A blunt second opinion on the AST result: the raw-prefix token families the
     owner named, in a JSX text child, on any touched file. Machine positions are
     excluded by requiring the expression to be a bare text child. */
  const PREFIXES = ["co_", "usr_", "u_", "rnd_", "spv_", "ts_"];
  it("no literal internal token is printed as copy", () => {
    const offenders: string[] = [];
    for (const rel of TOUCHED) {
      const src = readFileSync(R(rel), "utf8");
      for (const line of src.split("\n")) {
        /* A string literal that IS one of our token shapes, in a JSX text
           position (not a testid, not a query key, not a comparison). */
        const m = line.match(/>\s*["']?(co_|usr_|u_|rnd_|spv_|ts_)[a-z0-9_]+/);
        if (m && !line.includes("data-testid") && !line.includes("//")) {
          offenders.push(`${rel}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(offenders.join("\n")).toBe("");
    expect(PREFIXES).toHaveLength(6);
  });
});
