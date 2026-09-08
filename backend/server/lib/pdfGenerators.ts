/**
 * v25.10 — Real PDF generators for term-sheet and cap-table.
 *
 * Closes two launch-blockers from v24.0 lockdown:
 *   GET /api/rounds/:id/term-sheet/pdf       → returned 501 not_implemented
 *   GET /api/companies/:id/cap-table/pdf     → returned 501 not_implemented
 *
 * The v24.0 lockdown rule was correct: don't ship a hard-coded placeholder
 * PDF to a real customer. This wave wires a REAL generator backed by
 * pdfkit (added in v25.10) that reads from the actual rounds + cap-table
 * stores and produces a deterministic, tenant-scoped PDF.
 *
 * Why pdfkit:
 *   - Pure JS, ~1MB total, no native deps (avoids LD-loader issues on Avi's
 *     prod box that puppeteer/headless-chromium would trigger).
 *   - Stable API; output is deterministic byte-stream for the same input.
 *   - We use it as an internal renderer only; consumers see binary PDF.
 *
 * Industry best practice notes:
 *   - All money values are formatted with currency and locale.
 *   - Cap-table totals must reconcile to 100.000% (3-decimal). We compute
 *     totals from the actual ledger; never display a manually-summed value.
 *   - Disclaimer text is included on both docs (these are platform exports,
 *     not legal counsel-issued documents).
 *   - File-name response header carries a sanitized roundId / companyId.
 */

import type { Response } from "express";
import PDFDocument from "pdfkit";
/* WAVE 115 · FINDING 6 — the wave-110 export-naming helpers, reused. */
import { companyExportSlug, ledgerPdfFilename } from "../../client/src/lib/captable/exportProvenance";
/* WAVE 117 · FINDING 3 — the ONE interpreter of a liquidation preference, read
   here rather than re-implemented. `shared/liquidationTermsReader.ts` is what the
   exit waterfall in `server/track1Routes.ts` consults, so a term sheet an investor
   keeps on disk states the same interpretation the engine would act on, and prints
   the engine's own refusal wording where the stored free text cannot be read. No
   regex for a multiple, a participation word or a cap appears in this file. */
import {
  readLiquidationTerms,
  describeLiquidationTerms,
} from "../../shared/liquidationTermsReader";

export interface TermSheetData {
  roundId: string;
  companyName: string;
  instrument: string;
  currency: string;
  pricePerShare: number | null;
  postMoney: number | null;
  preMoney: number | null;
  targetRaise: number | null;
  closeDate: string | null;
  openDate: string | null;
  termsSummary: string | null;
  leadInvestor: string | null;
  generatedAt: string;
  /* WAVE 117 · FINDING 4 (naming) — the company's own identifiers, so the
     download is named after the company and not after an internal round id.
     Optional: an older caller that omits them still renders, and the slug helper
     falls back to the neutral `captable`-style token rather than to the id. */
  companyId?: string | null;
  legalName?: string | null;
  /* WAVE 117 · FINDING 3 — the round's STORED terms, passed raw and interpreted
     ONLY by the shared reader below. `liquidationPreference` is free text a founder
     typed ("1x non-participating"); `capParticipation` is the round's own numeric
     cap key. Neither is printed unchecked. */
  liquidationPreference?: unknown;
  capParticipation?: unknown;
}

export interface CapTableEntry {
  shareholder: string;
  securityKind: string;
  shares: number;
  /* 0..100, 3-decimal precision — or `null` when the ratio DOES NOT EXIST.

     WAVE 73 · ITEM 9 — WIDENED FROM `number`. On a cap table whose total share
     count is zero, ownership is 0 ÷ 0: undefined, not zero. The producer
     (`server/routes.ts`) used to write a fabricated `0`, so every holder on a
     zero-share PDF was printed at `0.000%` — a specific claim, in the artifact an
     investor keeps on disk. `null` is the same answer the cap-table ENGINE gives
     for this case (`packages/cap-table-engine/src/captable/views.ts:105`,
     ruling D18), so the PDF now agrees with the engine instead of contradicting
     it. Rendering is handled below: the cell shows an em-dash and the total is
     not asserted. */
  pctOwnership: number | null;
  invested: number | null;
  currency: string;
}

export interface CapTableData {
  companyId: string;
  companyName: string;
  asOf: string;
  entries: CapTableEntry[];
  totals: {
    totalShares: number;
    totalInvested: number;
    holderCount: number;
  };
  /* WAVE 116 · FINDING 3 — the denominator, supplied by the caller from
     `server/lib/captableDisplayResolver.ts` so the PDF, the interim cap-table
     screen and the API response all name it with the SAME words. Optional: when
     absent, the Wave 110 paragraph below is printed unchanged. */
  ownershipBasisLabel?: string;
  ownershipBasisSentence?: string;
  generatedAt: string;
}

function fmtMoney(amount: number | null, currency: string): string {
  if (amount == null || !isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   WAVE 346 · ITEM 2 — "TOTAL INVESTED" NO LONGER BORROWS THE FIRST HOLDER'S
   CURRENCY, AND NEVER INVENTS US DOLLARS.
   ═══════════════════════════════════════════════════════════════════════════════
   WHAT WAS HERE. Both places that print the cap-table PDF's "Total invested"
   figure — the Summary block and the Total row of the holders table — asked for
   the currency like this: `data.entries[0]?.currency || "USD"`. Two separate
   wrong answers came out of that one expression:

     1. MIXED CURRENCIES WERE LABELLED WITH ROW ONE'S. If holders were recorded
        in more than one currency, the already-summed total was stamped with
        whatever currency the FIRST holder happened to have. A cap table with a
        CAD holder listed first printed a Canadian-dollar total that included
        euro and dollar amounts. This is a document an investor keeps on disk.
     2. NO HOLDERS AT ALL MEANT US DOLLARS. With an empty entry list there is no
        currency on record, and the `|| "USD"` invented one.

   WHAT IT DOES NOW. `capTableTotalCurrency()` reads the currency actually
   recorded on every holder and answers one of four ways. Exactly one stated
   currency — the ordinary case — is STATABLE and prints precisely what it printed
   before, so nothing an investor sees today changes. More than one currency, or
   any holder whose currency is blank, is NOT statable, and the document says so
   in words instead of showing a number under a borrowed label. This platform has
   no exchange-rate source and never converts between currencies, so "not
   derivable" is the only true answer available; the CSV company export already
   prints exactly that phrase for the same situation, and this now agrees with it.

   THE ONE CASE DELIBERATELY LEFT ALONE, AND WHY. An empty cap table whose total
   is exactly zero still prints as it did before. Zero is zero in every currency,
   so no figure is misstated, and suppressing it would replace a true zero with a
   refusal — which the standing rule forbids just as firmly as inventing a number.
   The residual `USD` symbol on that one empty-table line is reported, not hidden.
   ═══════════════════════════════════════════════════════════════════════════════ */
export type CapTableTotalCurrency =
  | { statable: true; currency: string }
  | { statable: false; reason: "no_holders" | "currency_not_stated" | "mixed_currency"; currencies: string[] };

export function capTableTotalCurrency(entries: readonly CapTableEntry[]): CapTableTotalCurrency {
  const codes = new Set<string>();
  let blank = false;
  for (const e of entries ?? []) {
    const c = String(e?.currency ?? "").trim().toUpperCase();
    if (c) codes.add(c);
    else blank = true;
  }
  const currencies = Array.from(codes).sort();
  if ((entries?.length ?? 0) === 0) return { statable: false, reason: "no_holders", currencies };
  if (blank) return { statable: false, reason: "currency_not_stated", currencies };
  if (currencies.length > 1) return { statable: false, reason: "mixed_currency", currencies };
  return { statable: true, currency: currencies[0] as string };
}

/**
 * The exact text printed for "Total invested". Exported so a test can assert the
 * RENDERED SENTENCE rather than the branch that produced it.
 */
export function capTableTotalInvestedText(data: CapTableData): string {
  const decision = capTableTotalCurrency(data.entries);
  if (decision.statable) return fmtMoney(data.totals.totalInvested, decision.currency);
  /* A genuine zero on an empty table is still a true figure — see the note above. */
  if (decision.reason === "no_holders" && Number(data.totals.totalInvested) === 0) {
    return fmtMoney(0, "USD");
  }
  if (decision.reason === "no_holders") {
    return "Not derivable — no holders are recorded, so there is no currency to state this total in.";
  }
  if (decision.reason === "currency_not_stated") {
    return "Not derivable — at least one holder's currency is not on record, so this total cannot be stated in any currency.";
  }
  return (
    `Not derivable — holders are recorded in more than one currency (${decision.currencies.join(", ")}), ` +
    "and this platform never converts between currencies. See the per-holder amounts below."
  );
}

function fmtPct(pct: number): string {
  if (!isFinite(pct)) return "—";
  return `${pct.toFixed(3)}%`;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function safeFileName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * Stream a term-sheet PDF to the response. The caller MUST have already
 * verified ownership/visibility (this fn doesn't enforce auth).
 */
export function streamTermSheetPdf(res: Response, data: TermSheetData): void {
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 117 · FINDING 4 — THE DOWNLOAD IS NAMED AFTER THE COMPANY, NOT AFTER AN
                            INTERNAL ROUND ID.
     ═══════════════════════════════════════════════════════════════════════════
     Was: `termsheet_${safeFileName(data.roundId)}.pdf` — every term sheet reached
     an investor's disk as `termsheet_rnd_novapay_foundation.pdf`, which names a
     database key and not the company or the document. `companyExportSlug()` is
     wave 110's helper (`client/src/lib/captable/exportProvenance.ts`), already
     imported above for the cap-table ledger PDF, and is REUSED rather than
     re-derived so the two exports of one company sort together in a downloads
     folder. The date is the generation date, so two pulls of the same round are
     distinguishable; the round id stays in the document body (`Round ID:` below),
     where a human has context for it. */
  const slug = companyExportSlug({
    companyName: data.companyName,
    legalName: data.legalName ?? null,
    companyId: data.companyId ?? null,
  });
  const asOf = safeFileName(String(data.generatedAt ?? "").slice(0, 10)) || "undated";
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${slug}-term-sheet-${asOf}.pdf"`,
  );
  doc.pipe(res);

  /* Header */
  doc.fontSize(22).text("Term Sheet", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor("#666").text(`Capavate platform export`, { align: "center" });
  doc.moveDown(1.5);
  doc.fillColor("#000");

  /* Company + round id */
  doc.fontSize(16).text(data.companyName || "—");
  doc.fontSize(10).fillColor("#666").text(`Round ID: ${data.roundId}`);
  doc.fillColor("#000");
  doc.moveDown(1);

  /* Key terms table */
  doc.fontSize(14).text("Key Terms");
  doc.moveDown(0.5);
  doc.fontSize(11);

  const rows: Array<[string, string]> = [
    ["Instrument", data.instrument || "—"],
    ["Currency", data.currency || "USD"],
    ["Price per share", data.pricePerShare != null ? fmtMoney(data.pricePerShare, data.currency) : "—"],
    ["Pre-money valuation", fmtMoney(data.preMoney, data.currency)],
    ["Post-money valuation", fmtMoney(data.postMoney, data.currency)],
    ["Target raise", fmtMoney(data.targetRaise, data.currency)],
    ["Open date", data.openDate ?? "—"],
    ["Target close", data.closeDate ?? "—"],
    ["Lead investor", data.leadInvestor || "—"],
  ];
  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 117 · FINDING 3 — THE LIQUIDATION PREFERENCE, AS THE ENGINE READS IT.
     ═══════════════════════════════════════════════════════════════════════════
     A liquidation preference decides who is paid first and how much on an exit: it
     is the term on this page most able to mislead an investor about their own
     money. It was absent from this document entirely, while the round's stored
     `liquidationPreference` free text was printed verbatim on investor screens
     with nothing reconciling it against the calculation.

     The row below asks `shared/liquidationTermsReader.ts` — the module the exit
     waterfall itself consults — and prints ITS sentence. Three consequences, all
     deliberate:
       1. When the terms read cleanly the sentence carries the founder's own
          wording plus the reader's cap decision, so the sheet cannot claim a cap
          the waterfall would refuse, nor omit one it applies.
       2. When they DO NOT read cleanly the sentence says so, quotes what is on
          record, and states that the exit calculation refuses. The free text is
          never presented as a term.
       3. Nothing is invented when nothing is recorded: the row still appears and
          says the term is not on record, because an absent row reads as "there is
          no preference", which is a claim about money.
     The refusal NAME is printed alongside it so the sheet and a 422 from
     `/api/companies/:id/exit-waterfall` can be matched by a human. */
  const lpDecision = readLiquidationTerms({
    liquidationPreference: data.liquidationPreference,
    capParticipation: data.capParticipation,
  });
  rows.push(["Liquidation preference", describeLiquidationTerms(lpDecision)]);
  if (!lpDecision.determined) {
    rows.push(["Exit calculation", `refuses — ${lpDecision.refusal}`]);
  }
  for (const [k, v] of rows) {
    doc.font("Helvetica-Bold").text(`${k}: `, { continued: true }).font("Helvetica").text(v);
  }

  doc.moveDown(1);
  if (data.termsSummary) {
    doc.fontSize(14).text("Summary");
    doc.moveDown(0.5);
    doc.fontSize(11).text(data.termsSummary, { align: "justify" });
    doc.moveDown(1);
  }

  /* Footer / disclaimer */
  doc.moveDown(2);
  doc.fontSize(8).fillColor("#888").text(
    "This document is a platform-generated summary. It is not legal advice, an offer to sell, or a solicitation to buy securities. Always consult counsel before executing transaction documents.",
    { align: "justify" },
  );
  doc.text(`Generated ${data.generatedAt}`);
  doc.fillColor("#000");

  doc.end();
}

/**
 * Stream a cap-table PDF to the response.
 */
export function streamCapTablePdf(res: Response, data: CapTableData): void {
  const doc = new PDFDocument({ size: "LETTER", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 115 · FINDING 6 — THE DOWNLOAD FILENAME WAS AN INTERNAL COMPANY ID.

     This header produced `captable_co_novapay.pdf`. A founder or investor saves
     it, opens their Downloads folder a month later, and reads a storage key. The
     human name was available all along: `CapTableData` already carries
     `companyName` (:67) and `asOf` (:69) — they were simply not used.

     REUSED, NOT REWRITTEN. Wave 110 built exactly this pair in
     `client/src/lib/captable/exportProvenance.ts`: `companyExportSlug()` (:107)
     and `ledgerPdfFilename()` (:141), whose own docblock names
     `server/lib/pdfGenerators.ts::streamCapTablePdf` as its intended consumer.
     A second slug implementation here is precisely what the brief forbids.

     The name is `<company>-captable-committed-ledger-<as-of>.pdf`, not
     `-basic-`/`-fully-diluted-`, because this PDF is produced server-side from
     the committed ledger on an outstanding-shares basis and is NOT a render of
     whatever view was on screen. Naming it after a view would be a lie.

     `safeFileName()` is still applied on top, so the header can never carry a
     CR/LF or a quote regardless of what the company is called.

     Server-importing-from-client is established practice in this tree, not a new
     coupling: server/legalConsentStore.ts:40, server/regionExtensionStore.ts:27,
     server/investorProvisioning.ts:26, server/investorMediaRoutes.ts:23,
     server/wave25InvestorProfileRoutes.ts:66 and server/ventureMarketsStore.ts:23
     all do it, and the module imported here is pure string formatting with no
     React, no DOM and no side effects.
     ═══════════════════════════════════════════════════════════════════════ */
  const capTableFileName = safeFileName(
    ledgerPdfFilename({
      slug: companyExportSlug({ companyName: data.companyName, companyId: data.companyId }),
      /* The as-of date, day precision, from the data the PDF is actually built
         from. A raw ISO timestamp in a filename is the same leak in a different
         costume. */
      asOf: String(data.asOf ?? "").slice(0, 10) || String(data.generatedAt ?? "").slice(0, 10) || "as-of-unknown",
    }),
  );
  res.setHeader("Content-Disposition", `inline; filename="${capTableFileName}"`);
  doc.pipe(res);

  /* Header */
  doc.fontSize(22).text("Capitalization Table", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor("#666").text(`Capavate platform export`, { align: "center" });
  doc.moveDown(1.5);
  doc.fillColor("#000");

  /* Company */
  doc.fontSize(16).text(data.companyName || "—");
  doc.fontSize(10).fillColor("#666").text(`Company ID: ${data.companyId}`);
  doc.text(`As of: ${data.asOf}`);
  /* WAVE 110 · FINDING 1 — AN EXPORTED PERCENTAGE MUST NAME ITS DENOMINATOR.
     This PDF's percentages come from the committed cap-table ledger's share
     totals (routes.ts, `/api/companies/:id/cap-table/pdf`), i.e. an OUTSTANDING
     basis. That is NOT the same denominator as the Fully Diluted or As Converted
     view of the founder cap-table screen, and a file that travels to an investor
     without saying which basis it used is a wrong number waiting to happen. No
     computed value changes here — only the basis is now stated. */
  /* WAVE 116 · FINDING 3 — the sentence is now the SHARED one when the caller
     supplies it, so this file and the screen cannot drift into describing the
     same denominator two different ways. The Wave 110 wording is retained
     verbatim as the fallback and as the outstanding-basis clarification, which
     the shared sentence does not repeat. */
  doc.text(
    data.ownershipBasisSentence
      ? `Basis: ${data.ownershipBasisLabel ?? "committed ledger"} — ${data.ownershipBasisSentence}`
      : "Basis: committed ledger — ownership percentages below are of the total shares recorded on " +
        "the committed ledger as of the date above (an outstanding-shares basis). This is NOT a " +
        "fully-diluted or as-converted figure and must not be quoted as one.",
  );
  doc.fillColor("#000");
  doc.moveDown(1);

  /* Totals */
  doc.fontSize(14).text("Summary");
  doc.moveDown(0.3);
  doc.fontSize(11);
  doc.font("Helvetica-Bold").text("Total shares: ", { continued: true }).font("Helvetica").text(fmtNumber(data.totals.totalShares));
  doc.font("Helvetica-Bold").text("Total invested: ", { continued: true }).font("Helvetica").text(
    capTableTotalInvestedText(data),
  );
  doc.font("Helvetica-Bold").text("Holders: ", { continued: true }).font("Helvetica").text(String(data.totals.holderCount));
  doc.moveDown(1);

  /* Entries table */
  doc.fontSize(14).text("Holders");
  doc.moveDown(0.3);
  doc.fontSize(10);

  /* Compute computed total to verify reconciliation.

     WAVE 73 · ITEM 9 — an UNDEFINED ratio is not summable. Adding `null` in as a
     zero would produce a total that looks like arithmetic and is not, which is
     precisely the defect this item removes. If ANY holder's ratio is undefined
     the total is undefined too, and that is what is printed — the same rule the
     engine's own trace uses (`compute.ts:218-222`, `anyOwnershipUndefined`). */
  let computedPct = 0;
  let anyPctUndefined = false;
  for (const e of data.entries) {
    if (e.pctOwnership == null) anyPctUndefined = true;
    else computedPct += e.pctOwnership;
  }

  /* Column layout */
  const startY = doc.y;
  const colShareholder = 50;
  const colKind = 220;
  const colShares = 310;
  const colPct = 400;
  const colInvested = 470;

  doc.font("Helvetica-Bold");
  doc.text("Shareholder", colShareholder, startY);
  doc.text("Kind", colKind, startY);
  doc.text("Shares", colShares, startY, { width: 80, align: "right" });
  /* WAVE 110 · FINDING 1 — was a bare "%", which named no denominator. */
  /* WAVE 116 · FINDING 3 — the column header keeps the Wave 110 text "% of
     ledger" (it must fit 60pt), and the full denominator is stated in the Basis
     paragraph above and repeated under the table so a reader who only looks at
     the table still finds it. */
  doc.text("% of ledger", colPct, startY, { width: 60, align: "right" });
  doc.text("Invested", colInvested, startY, { width: 80, align: "right" });
  doc.font("Helvetica");

  let y = startY + 16;
  for (const e of data.entries) {
    if (y > 720) {
      doc.addPage();
      y = 50;
    }
    doc.text(e.shareholder.slice(0, 28), colShareholder, y, { width: 170 });
    doc.text(e.securityKind.slice(0, 12), colKind, y, { width: 90 });
    doc.text(fmtNumber(e.shares), colShares, y, { width: 80, align: "right" });
    /* WAVE 73 · ITEM 9 — the honest cell. `fmtPct(0)` printed "0.000%". */
    doc.text(e.pctOwnership != null ? fmtPct(e.pctOwnership) : "—", colPct, y, { width: 60, align: "right" });
    doc.text(e.invested != null ? fmtMoney(e.invested, e.currency) : "—", colInvested, y, { width: 80, align: "right" });
    y += 16;
  }

  /* Total row */
  doc.font("Helvetica-Bold");
  doc.text("Total", colShareholder, y + 8);
  doc.text(fmtNumber(data.totals.totalShares), colShares, y + 8, { width: 80, align: "right" });
  doc.text(anyPctUndefined ? "—" : fmtPct(computedPct), colPct, y + 8, { width: 60, align: "right" });
  /* WAVE 116 · FINDING 3 — the `% of ledger` column, named in full immediately
     beneath the figures it labels. */
  if (data.ownershipBasisLabel) {
    doc.fontSize(8).fillColor("#666").text(
      `"% of ledger" is each holder's share of the ${data.ownershipBasisLabel}.`,
      50,
      y + 26,
      { width: 500 },
    );
    doc.fontSize(10).fillColor("#000");
  }
  /* WAVE 346 · ITEM 2 — the Total row of the holders table. The refusal sentence
     is long and this cell is 80pt wide, so when the currency cannot be stated the
     cell shows an em-dash and the full sentence is printed underneath at full
     width. The number is never shown under a borrowed currency, and the reason is
     never hidden from the reader. */
  const investedDecision = capTableTotalCurrency(data.entries);
  const investedStatable =
    investedDecision.statable ||
    (investedDecision.reason === "no_holders" && Number(data.totals.totalInvested) === 0);
  doc.text(
    investedStatable ? capTableTotalInvestedText(data) : "\u2014",
    colInvested,
    y + 8,
    { width: 80, align: "right" },
  );
  if (!investedStatable) {
    doc.font("Helvetica").fontSize(8).fillColor("#666").text(
      `Total invested: ${capTableTotalInvestedText(data)}`,
      50,
      y + 40,
      { width: 500 },
    );
    doc.fontSize(10).fillColor("#000").font("Helvetica-Bold");
  }
  doc.font("Helvetica");

  /* WAVE 73 · ITEM 9 — when the ratio does not exist for at least one holder,
     the honest note says SO, rather than reporting a discrepancy against 100%
     that is really an absent denominator. The existing note below is UNCHANGED
     and still fires for a real discrepancy (R44: it was not false). */
  if (anyPctUndefined) {
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#A12C7B").text(
      "Note: ownership percentages could not be computed for one or more holders because the company's total share count is zero, so each holder's share of the total is undefined — it is NOT zero. Those cells show a dash and no total is stated. Share counts and invested amounts above are unaffected.",
    );
    doc.fillColor("#000");
  }

  /* Reconciliation note if computed pct isn't 100 */
  if (!anyPctUndefined && Math.abs(computedPct - 100) > 0.01) {
    doc.moveDown(2);
    doc.fontSize(9).fillColor("#A12C7B").text(
      `Note: ownership percentages total ${computedPct.toFixed(3)}% (not 100.000%). This is a reconciliation discrepancy; please review the underlying ledger.`,
    );
    doc.fillColor("#000");
  }

  /* Footer */
  doc.moveDown(2);
  doc.fontSize(8).fillColor("#888").text(
    "This cap table is a platform-generated snapshot from the SACRED cap-table ledger. Always reconcile against your company's executed transaction documents. Not legal or tax advice.",
    { align: "justify" },
  );
  doc.text(`Generated ${data.generatedAt}`);
  doc.fillColor("#000");

  doc.end();
}
