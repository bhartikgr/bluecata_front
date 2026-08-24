/* ════════════════════════════════════════════════════════════════════════════
   WAVE 110 · FINDING 1 — AN EXPORTED PERCENTAGE MUST CARRY ITS DENOMINATOR.
   ════════════════════════════════════════════════════════════════════════════
   The cap table has three views — Basic, Fully Diluted, As Converted — and they
   divide by three DIFFERENT denominators, so the same holder legitimately has a
   different ownership percentage in each. Wave 108 made the on-screen labels
   view-aware but left BOTH spreadsheet exports ending in a bare `Ownership %`
   column, with no view named anywhere in the bytes and no view in the filename.
   A Basic-view CSV was therefore byte-indistinguishable from a Fully-Diluted CSV
   of the same company while carrying different numbers.

   An export outlives the screen: it is emailed to an investor, dropped in a data
   room, pasted into a model. A percentage whose denominator is unstated and
   unknowable is a wrong number waiting to happen — so the denominator travels
   WITH the bytes, in three independent places:

     1. the ownership column HEADER names the view and its denominator;
     2. a PROVENANCE row above the header states company, as-of date, view,
        denominator and the fact that other views are not comparable;
     3. the FILENAME carries the view token.

   NO COMPUTED VALUE IS TOUCHED by anything in this module. It produces labels
   and filenames only; every percentage and money cell is written by the caller
   exactly as before, at full engine precision.

   The two label maps live here rather than in the page so that the screen labels
   and the export labels are the SAME strings, derived from the same `view` the
   engine was called with (R21 — derived, not restated per surface). The page
   re-exports them, so `import { VIEW_DENOMINATOR_LABEL } from "../CapTable"` in
   the Wave 108 tests keeps working unchanged.
   ════════════════════════════════════════════════════════════════════════════ */

import type { View } from "@capavate/cap-table-engine";

export const VIEW_LABEL: Record<View, string> = {
  basic: "Basic",
  fully_diluted: "Fully Diluted",
  as_converted: "As Converted",
};

/** The denominator each view divides by, named the way a reader would say it. */
export const VIEW_DENOMINATOR_LABEL: Record<View, string> = {
  basic: "issued shares (outstanding basis)",
  fully_diluted: "fully-diluted shares",
  as_converted: "as-converted shares",
};

/** Filename-safe token for a view. Distinct per view, so two exports of the same
 *  company on the same day cannot land on top of each other in a download folder. */
export const VIEW_FILENAME_TOKEN: Record<View, string> = {
  basic: "basic",
  fully_diluted: "fully-diluted",
  as_converted: "as-converted",
};

/**
 * The ownership column header. Replaces the bare `"Ownership %"`, which was the
 * defect: it is the one cell a reader looks at to decide what the number means.
 */
export function ownershipColumnHeader(view: View): string {
  return `Ownership % (${VIEW_LABEL[view]} view — % of ${VIEW_DENOMINATOR_LABEL[view]})`;
}

/**
 * One sentence stating where the file came from and what its percentages are of.
 * Written as prose so it survives being pasted into a model or a data room, where
 * a column header can be cropped away but the first row usually is not.
 */
export function exportProvenanceSentence(args: {
  companyLabel: string;
  asOf: string;
  view: View;
  conventionLabel?: string;
}): string {
  const { companyLabel, asOf, view, conventionLabel } = args;
  const parts = [
    "Capavate cap-table export",
    `Company: ${companyLabel}`,
    `As of: ${asOf}`,
    `View: ${VIEW_LABEL[view]}`,
    `All percentages in this file are of ${VIEW_DENOMINATOR_LABEL[view]}`,
  ];
  if (conventionLabel) parts.push(`Convention: ${conventionLabel}`);
  parts.push(
    "The other two views divide by a different denominator, so percentages from " +
      "different views are not comparable and must not be mixed",
  );
  return parts.join(" · ");
}

/** A single-cell CSV row carrying the provenance sentence (quoted, commas removed
 *  is NOT needed — the cell is quoted and the sentence contains no double quote). */
export function csvProvenanceRow(args: Parameters<typeof exportProvenanceSentence>[0]): string {
  return `"${exportProvenanceSentence(args)}"`;
}

/** The same sentence for the tab-separated Excel export (no tabs inside it). */
export function tsvProvenanceRow(args: Parameters<typeof exportProvenanceSentence>[0]): string {
  return exportProvenanceSentence(args);
}

/**
 * WAVE 110 · FINDING 4 — no export may leave this platform under another
 * company's brand. The slug is derived from the ACTIVE company; there is no
 * persona fallback, and the last resort is the neutral `captable`.
 */
export function companyExportSlug(args: {
  companyName?: string | null;
  legalName?: string | null;
  companyId?: string | null;
}): string {
  const raw = (args.companyName || args.legalName || args.companyId || "captable").toString();
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "captable";
}

/**
 * `<company>-captable-<view>-<as-of>.<ext>`. The view token is part of the name
 * so a Basic export and a Fully-Diluted export of the same company on the same
 * day are distinguishable before either file is even opened.
 */
export function captableExportFilename(args: {
  slug: string;
  view: View;
  asOf: string;
  ext: string;
}): string {
  return `${args.slug}-captable-${VIEW_FILENAME_TOKEN[args.view]}-${args.asOf}.${args.ext}`;
}

/**
 * The committed-ledger PDF is NOT a render of the selected view — it is produced
 * server-side from the committed cap-table ledger on an outstanding-shares basis
 * (`server/lib/pdfGenerators.ts::streamCapTablePdf`). Naming it after the view
 * would be a lie, so its filename and its toast say what it actually is.
 */
export function ledgerPdfFilename(args: { slug: string; asOf: string }): string {
  return `${args.slug}-captable-committed-ledger-${args.asOf}.pdf`;
}

export const LEDGER_PDF_BASIS_SENTENCE =
  "This PDF is the committed-ledger snapshot: its percentages are of total shares " +
  "recorded on the committed ledger (an outstanding basis), not of the view selected " +
  "on screen. For a file on the selected view's denominator, use the CSV or Excel export.";
