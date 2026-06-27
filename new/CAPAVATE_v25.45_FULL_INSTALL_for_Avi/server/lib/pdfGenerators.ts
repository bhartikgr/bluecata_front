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
}

export interface CapTableEntry {
  shareholder: string;
  securityKind: string;
  shares: number;
  pctOwnership: number; // 0..100, 3-decimal precision
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
  res.setHeader(
    "Content-Disposition",
    `inline; filename="termsheet_${safeFileName(data.roundId)}.pdf"`,
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
  res.setHeader(
    "Content-Disposition",
    `inline; filename="captable_${safeFileName(data.companyId)}.pdf"`,
  );
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
  doc.fillColor("#000");
  doc.moveDown(1);

  /* Totals */
  doc.fontSize(14).text("Summary");
  doc.moveDown(0.3);
  doc.fontSize(11);
  doc.font("Helvetica-Bold").text("Total shares: ", { continued: true }).font("Helvetica").text(fmtNumber(data.totals.totalShares));
  doc.font("Helvetica-Bold").text("Total invested: ", { continued: true }).font("Helvetica").text(
    fmtMoney(data.totals.totalInvested, data.entries[0]?.currency || "USD"),
  );
  doc.font("Helvetica-Bold").text("Holders: ", { continued: true }).font("Helvetica").text(String(data.totals.holderCount));
  doc.moveDown(1);

  /* Entries table */
  doc.fontSize(14).text("Holders");
  doc.moveDown(0.3);
  doc.fontSize(10);

  /* Compute computed total to verify reconciliation */
  let computedPct = 0;
  for (const e of data.entries) computedPct += e.pctOwnership;

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
  doc.text("%", colPct, startY, { width: 60, align: "right" });
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
    doc.text(fmtPct(e.pctOwnership), colPct, y, { width: 60, align: "right" });
    doc.text(e.invested != null ? fmtMoney(e.invested, e.currency) : "—", colInvested, y, { width: 80, align: "right" });
    y += 16;
  }

  /* Total row */
  doc.font("Helvetica-Bold");
  doc.text("Total", colShareholder, y + 8);
  doc.text(fmtNumber(data.totals.totalShares), colShares, y + 8, { width: 80, align: "right" });
  doc.text(fmtPct(computedPct), colPct, y + 8, { width: 60, align: "right" });
  doc.text(
    fmtMoney(data.totals.totalInvested, data.entries[0]?.currency || "USD"),
    colInvested,
    y + 8,
    { width: 80, align: "right" },
  );
  doc.font("Helvetica");

  /* Reconciliation note if computed pct isn't 100 */
  if (Math.abs(computedPct - 100) > 0.01) {
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
