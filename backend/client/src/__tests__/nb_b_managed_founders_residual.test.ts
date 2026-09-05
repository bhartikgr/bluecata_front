/* ════════════════════════════════════════════════════════════════════════════
   WAVE NB-B — A DEDICATED RESIDUAL PIN FOR PartnerManagedFounders.tsx.

   WHY THIS FILE EXISTS INSTEAD OF A LINE IN THE SHARED LIST.
   `w124_no_raw_identifiers_rendered.test.ts` scans a list of screens and demands
   ZERO unexplained raw-identifier sites, with a short hand-reviewed exception
   list. Adding `pages/partner/PartnerManagedFounders.tsx` to that list would have
   required adding SIX new exceptions at once, for sites this band was not asked
   to touch and did not touch. Six blanket exemptions on a shared instrument that
   guards nine screens is a real weakening of that instrument, and a later wave
   reading the list would have no way to tell this wave's exemptions from a
   genuine review.

   So the same detector is run here, over this one file, and the residual is
   pinned to an EXACT named set. The effect is stronger than an exemption list:
     · if this wave's fix regressed, `{l.contact_ref}` returns and this reddens;
     · if a FUTURE wave adds a new raw-identifier site to this page, the set grows
       and this reddens too;
     · if a future wave fixes one of the six, the set shrinks and this reddens,
       forcing the pin to be updated deliberately rather than drifting.

   The six are recorded with what they are, so the next reader inherits a review
   rather than a number.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { scanFiles } from "./w124_rawIdentifierDetector";

const FILE = resolve(__dirname, "..", "pages/partner/PartnerManagedFounders.tsx");

/* ── the residual, as reviewed on 2026-09-04 ──────────────────────────────────
   Each is OUT OF SCOPE for the numbers band: none of them is a name standing in
   for a person or a company on a screen this band was asked to correct.
     1. `{e.authorityArtifactRef ?? "—"}` — a document reference under a labelled
        field; the em-dash is the platform's "not recorded".
     2. `{e.chapterId ?? "—"}`  — likewise, an optional chapter reference.
     3. `{e.matterId ?? "—"}`   — likewise, an optional matter reference.
     4. `{r.spv_id}`            — a vehicle reference in a technical list.
     5. `{capability.partnerType ?? "unclassified"}` — a machine key rendered raw;
        a genuine copy defect, but on the capability summary, not in this band.
     6. `{p.companyName ?? p.companyId}` — ALREADY name-first; the id is the
        fallback only, which is the pattern this wave is spreading, not fighting.
   ──────────────────────────────────────────────────────────────────────────── */
const EXPECTED_RESIDUAL = [
  '{e.authorityArtifactRef ?? "—"}',
  '{e.chapterId ?? "—"}',
  '{e.matterId ?? "—"}',
  "{r.spv_id}",
  '{capability.partnerType ?? "unclassified"}',
  "{p.companyName ?? p.companyId}",
];

describe("WAVE NB-B · PartnerManagedFounders raw-identifier residual", () => {
  it("the detector runs and reports a non-empty result — the precondition for every claim below", () => {
    const hits = scanFiles([FILE]);
    /* Without this, a detector that silently failed to parse the file would
       report zero hits and every assertion below would pass vacuously. A source
       file that parses to nothing is a known inert-proof mechanism on this
       platform, so it is excluded explicitly rather than assumed away. */
    expect(hits.length).toBeGreaterThan(0);
  });

  it("the site this wave fixed is GONE — no raw contact_ref is rendered", () => {
    const hits = scanFiles([FILE]);
    const texts = hits.map((h) => h.text);
    expect(texts).not.toContain("{l.contact_ref}");
    expect(texts.filter((t) => t.includes("contact_ref"))).toEqual([]);
  });

  it("the residual is EXACTLY the six reviewed out-of-scope sites — no more, no fewer", () => {
    const hits = scanFiles([FILE]);
    const texts = hits.map((h) => h.text).sort();
    expect(texts).toEqual([...EXPECTED_RESIDUAL].sort());
    expect(texts).toHaveLength(6);
  });
});
