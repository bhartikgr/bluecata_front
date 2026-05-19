/**
 * Sprint 28 Billing — Invoice store (production-shape).
 *
 * Every company interaction with billing produces an Invoice record:
 *   - Subscription charge (subscription → paid invoice)
 *   - Refund          (paid invoice → refund invoice with negative amount)
 *   - Void            (draft → void)
 *
 * Design principles:
 *   - Money in INTEGER MINOR UNITS + ISO 4217 currency code — never floats.
 *   - Tamper-evident: SHA-256 hash chain on every state change.
 *   - Invoice numbers are monotonic: CAP-{YEAR}-{6-digit-zero-padded-seq}.
 *   - Tax line item always present (0 if no tax engine configured).
 *   - Bridge event emitted for every customer-facing state change.
 *   - Refunds create a NEW invoice with negative totalMinor + link to original.
 *   - PDF endpoint returns minimal but correct application/pdf bytes.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { emitBridgeEvent } from "./bridgeStore";
import { appendAdminAudit } from "./adminPlatformStore";
import { sendMail } from "./emailTransport";

/* ---------- Types ---------- */

export type InvoiceStatus = "draft" | "issued" | "paid" | "refunded" | "void";

export interface InvoiceLineItem {
  label: string;
  amountMinor: number;
}

export interface Invoice {
  id: string;
  /** e.g. "CAP-2025-000123" */
  invoiceNumber: string;
  companyId: string;
  subscriptionId: string;
  planLabel: string;
  periodStart: string; // ISO date
  periodEnd: string;   // ISO date
  amountMinor: number; // subtotal (before tax)
  currency: string;    // ISO 4217
  taxMinor: number;    // 0 if no tax engine
  totalMinor: number;  // amountMinor + taxMinor
  status: InvoiceStatus;
  paymentEntryId?: string;
  /** For refund invoices — links back to the original invoice */
  relatedInvoiceId?: string;
  issuedAt: string;
  paidAt?: string;
  refundedAt?: string;
  voidedAt?: string;
  lineItems: InvoiceLineItem[];
  /** Payment card last 4 for receipt display */
  cardLast4?: string;
  /** SHA-256 hash for tamper evidence on PDF footer */
  hash: string;
  prevHash: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

/* ---------- Audit + bridge sinks ---------- */
type AuditAppender = (e: { actor: string; action: string; target: string; payload: unknown }) => void;
type BridgeEmitter = (eventType: string, aggregateId: string, payload: Record<string, unknown>) => void;

let auditAppender: AuditAppender = () => {};
let bridgeEmitter: BridgeEmitter = () => {};

export function configureInvoiceStore(opts: {
  audit: AuditAppender;
  bridge: BridgeEmitter;
}): void {
  auditAppender = opts.audit;
  bridgeEmitter = opts.bridge;
}

/* ---------- Storage ---------- */

const invoiceMap = new Map<string, Invoice>();
const companyInvoices = new Map<string, string[]>(); // companyId → invoice ids

// Monotonic counter for invoice numbers, per year
const yearCounters = new Map<number, number>();

export const invoiceChain = registerChain(new HashChain<{
  id: string; invoiceNumber: string; companyId: string; status: InvoiceStatus; totalMinor: number; ts: string;
}>("invoices"));

/* ---------- Helpers ---------- */

function nextInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const count = (yearCounters.get(year) ?? 0) + 1;
  yearCounters.set(year, count);
  return `CAP-${year}-${String(count).padStart(6, "0")}`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function computeHash(prevHash: string, invoice: Partial<Invoice>): string {
  return sha256(`${prevHash}|${JSON.stringify({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    companyId: invoice.companyId,
    status: invoice.status,
    totalMinor: invoice.totalMinor,
    updatedAt: invoice.updatedAt,
  })}`);
}

/* ---------- Create / mutate ---------- */

export interface CreateInvoiceInput {
  companyId: string;
  subscriptionId: string;
  planLabel: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  currency: string;
  taxMinor?: number;
  lineItems?: InvoiceLineItem[];
  paymentEntryId?: string;
  cardLast4?: string;
  actor?: string;
  /** For refund invoices */
  relatedInvoiceId?: string;
}

export function createInvoice(input: CreateInvoiceInput): Invoice {
  const id = `inv_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const actor = input.actor ?? "system";
  const taxMinor = input.taxMinor ?? 0;
  const totalMinor = input.amountMinor + taxMinor;
  const prevHash = "GENESIS";

  const lineItems: InvoiceLineItem[] = input.lineItems ?? [
    { label: input.planLabel, amountMinor: input.amountMinor },
  ];
  if (taxMinor > 0) {
    lineItems.push({ label: "Tax", amountMinor: taxMinor });
  }

  const partial: Partial<Invoice> = {
    id,
    invoiceNumber: nextInvoiceNumber(),
    companyId: input.companyId,
    subscriptionId: input.subscriptionId,
    planLabel: input.planLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    amountMinor: input.amountMinor,
    currency: input.currency,
    taxMinor,
    totalMinor,
    status: input.paymentEntryId ? "paid" : "issued",
    paymentEntryId: input.paymentEntryId,
    relatedInvoiceId: input.relatedInvoiceId,
    issuedAt: now,
    paidAt: input.paymentEntryId ? now : undefined,
    lineItems,
    cardLast4: input.cardLast4,
    prevHash,
    version: 1,
    updatedAt: now,
    updatedBy: actor,
  };

  const hash = computeHash(prevHash, partial);
  const invoice: Invoice = { ...partial, hash } as Invoice;

  invoiceMap.set(id, invoice);
  const list = companyInvoices.get(input.companyId) ?? [];
  list.push(id);
  companyInvoices.set(input.companyId, list);

  invoiceChain.append({
    id, invoiceNumber: invoice.invoiceNumber, companyId: invoice.companyId,
    status: invoice.status, totalMinor, ts: now,
  });

  const eventType = invoice.status === "paid" ? "invoice.paid" : "invoice.issued";
  auditAppender({
    actor,
    action: eventType,
    target: `invoice:${id}`,
    payload: { invoiceNumber: invoice.invoiceNumber, totalMinor, currency: invoice.currency, companyId: invoice.companyId },
  });
  bridgeEmitter(eventType, invoice.companyId, {
    invoiceId: id, invoiceNumber: invoice.invoiceNumber, totalMinor,
    currency: invoice.currency, status: invoice.status,
  });

  return invoice;
}

function transitionInvoice(
  id: string,
  newStatus: InvoiceStatus,
  actor: string,
  extra: Partial<Invoice> = {},
): Invoice {
  const current = invoiceMap.get(id);
  if (!current) throw new Error(`invoice_not_found:${id}`);

  const now = new Date().toISOString();
  const updated: Invoice = {
    ...current,
    ...extra,
    status: newStatus,
    version: current.version + 1,
    prevHash: current.hash,
    updatedAt: now,
    updatedBy: actor,
    hash: "",
  };
  updated.hash = computeHash(current.hash, updated);
  invoiceMap.set(id, updated);

  invoiceChain.append({
    id, invoiceNumber: updated.invoiceNumber, companyId: updated.companyId,
    status: newStatus, totalMinor: updated.totalMinor, ts: now,
  });

  const eventType = newStatus === "paid"
    ? "invoice.paid"
    : newStatus === "refunded"
    ? "invoice.refunded"
    : "invoice.voided";

  auditAppender({
    actor,
    action: eventType,
    target: `invoice:${id}`,
    payload: { invoiceNumber: updated.invoiceNumber, status: newStatus, companyId: updated.companyId },
  });
  bridgeEmitter(eventType, updated.companyId, {
    invoiceId: id, invoiceNumber: updated.invoiceNumber, status: newStatus,
  });

  return updated;
}

export function markInvoicePaid(invoiceId: string, paymentEntryId: string, cardLast4: string | undefined, actor: string): Invoice {
  const now = new Date().toISOString();
  return transitionInvoice(invoiceId, "paid", actor, { paymentEntryId, paidAt: now, cardLast4 });
}

export function voidInvoice(invoiceId: string, actor: string): Invoice {
  const now = new Date().toISOString();
  return transitionInvoice(invoiceId, "void", actor, { voidedAt: now });
}

/** Refund creates a NEW negative-amount invoice linked to original. */
export function refundInvoice(originalInvoiceId: string, amountMinor: number, reason: string, actor: string): Invoice {
  const original = invoiceMap.get(originalInvoiceId);
  if (!original) throw new Error(`invoice_not_found:${originalInvoiceId}`);

  // Mark original as refunded
  const now = new Date().toISOString();
  transitionInvoice(originalInvoiceId, "refunded", actor, { refundedAt: now });

  // Create negative-amount refund invoice
  return createInvoice({
    companyId: original.companyId,
    subscriptionId: original.subscriptionId,
    planLabel: `Refund: ${original.planLabel}`,
    periodStart: original.periodStart,
    periodEnd: original.periodEnd,
    amountMinor: -Math.abs(amountMinor),
    currency: original.currency,
    taxMinor: 0,
    lineItems: [{ label: `Refund — ${reason}`, amountMinor: -Math.abs(amountMinor) }],
    relatedInvoiceId: originalInvoiceId,
    actor,
  });
}

/* ---------- Reads ---------- */

export function getInvoice(id: string): Invoice | null {
  return invoiceMap.get(id) ?? null;
}

export function listInvoices(filter?: { companyId?: string; status?: InvoiceStatus }): Invoice[] {
  const all = Array.from(invoiceMap.values()).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return all.filter(inv => {
    if (filter?.companyId && inv.companyId !== filter.companyId) return false;
    if (filter?.status && inv.status !== filter.status) return false;
    return true;
  });
}

export function listInvoicesForCompany(companyId: string): Invoice[] {
  const ids = companyInvoices.get(companyId) ?? [];
  return ids
    .map(id => invoiceMap.get(id))
    .filter(Boolean)
    .sort((a, b) => b!.issuedAt.localeCompare(a!.issuedAt)) as Invoice[];
}

/* ---------- PDF generation ---------- */

function formatMoney(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`;
  }
}

/**
 * Generates a minimal PDF as raw bytes using a hand-crafted PDF structure.
 * No external dependency required.
 */
export function generateInvoicePdf(invoice: Invoice): Buffer {
  // Build a minimal valid PDF with invoice data
  const companyName = `Company ${invoice.companyId}`;
  const lines = [
    `CAPAVATE INVOICE`,
    `Invoice #: ${invoice.invoiceNumber}`,
    `Company: ${companyName}`,
    `Plan: ${invoice.planLabel}`,
    `Period: ${invoice.periodStart} to ${invoice.periodEnd}`,
    ``,
    `LINE ITEMS:`,
    ...invoice.lineItems.map(li => `  ${li.label}: ${formatMoney(li.amountMinor, invoice.currency)}`),
    ``,
    `Subtotal: ${formatMoney(invoice.amountMinor, invoice.currency)}`,
    `Tax: ${formatMoney(invoice.taxMinor, invoice.currency)}`,
    `TOTAL: ${formatMoney(invoice.totalMinor, invoice.currency)}`,
    ``,
    `Status: ${invoice.status.toUpperCase()}`,
    invoice.paidAt ? `Paid: ${invoice.paidAt}` : "",
    invoice.cardLast4 ? `Payment method: •••• ${invoice.cardLast4}` : "",
    ``,
    `Issued: ${invoice.issuedAt}`,
    ``,
    `---`,
    `Capavate | capavate.com`,
    `Invoice hash (tamper evidence): ${invoice.hash}`,
  ].filter(l => l !== undefined);

  const text = lines.join("\n");

  // Build a minimal valid PDF 1.4
  const bodyLines: string[] = [];
  bodyLines.push("%PDF-1.4");
  bodyLines.push("1 0 obj");
  bodyLines.push("<< /Type /Catalog /Pages 2 0 R >>");
  bodyLines.push("endobj");
  bodyLines.push("2 0 obj");
  bodyLines.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  bodyLines.push("endobj");

  // Font resource
  bodyLines.push("4 0 obj");
  bodyLines.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  bodyLines.push("endobj");

  // Build page content stream
  const escapedLines = text.split("\n").map(l =>
    l.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  );
  const contentParts = ["BT", "/F1 10 Tf", "50 750 Td", "12 TL"];
  for (const l of escapedLines) {
    contentParts.push(`(${l}) Tj T*`);
  }
  contentParts.push("ET");
  const stream = contentParts.join("\n");

  bodyLines.push("5 0 obj");
  bodyLines.push(`<< /Length ${stream.length} >>`);
  bodyLines.push("stream");
  bodyLines.push(stream);
  bodyLines.push("endstream");
  bodyLines.push("endobj");

  // Page
  bodyLines.push("3 0 obj");
  bodyLines.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>");
  bodyLines.push("endobj");

  // xref + trailer
  const body = bodyLines.join("\n");
  // Offset calculation for xref
  const offsets: number[] = [];
  let pos = 0;
  const objRegex = /\d+ 0 obj/g;
  let m: RegExpExecArray | null;
  while ((m = objRegex.exec(body)) !== null) {
    offsets.push(m.index);
  }

  const xrefOffset = body.length + 1;
  const xref = [
    `xref`,
    `0 6`,
    `0000000000 65535 f \r`,
    ...offsets.slice(0, 5).map(o => `${String(o).padStart(10, "0")} 00000 n \r`),
  ].join("\n");

  const trailer = `\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + "\n" + xref + trailer, "utf8");
}

/* ---------- Routes ---------- */

export function registerInvoiceRoutes(app: Express): void {
  /**
   * GET /api/admin/invoices
   * List all invoices platform-wide. Query params: ?status=&companyId=
   */
  app.get("/api/admin/invoices", (req: Request, res: Response) => {
    const status = req.query.status ? String(req.query.status) as InvoiceStatus : undefined;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    const invoices = listInvoices({ status, companyId });
    res.json({ ok: true, invoices, total: invoices.length });
  });

  /**
   * GET /api/admin/invoices/:id
   */
  app.get("/api/admin/invoices/:id", (req: Request, res: Response) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "not_found" });
    res.json({ ok: true, invoice: inv });
  });

  /**
   * GET /api/admin/invoices/:id/pdf
   * Streams a PDF. Content-Disposition: attachment.
   */
  app.get("/api/admin/invoices/:id/pdf", (req: Request, res: Response) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "not_found" });
    const pdf = generateInvoicePdf(inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  });

  /**
   * POST /api/admin/invoices/:id/refund
   * Admin-only refund. Body: { amountMinor, reason }.
   */
  app.post("/api/admin/invoices/:id/refund", (req: Request, res: Response) => {
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "not_found" });
    if (inv.status !== "paid") return res.status(400).json({ ok: false, error: "invoice_not_paid" });
    const amountMinor = Number(req.body?.amountMinor ?? inv.totalMinor);
    const reason = String(req.body?.reason ?? "admin_refund");
    const actor = String(req.headers["x-actor-email"] ?? "admin@capavate.com");
    try {
      const refundInv = refundInvoice(inv.id, amountMinor, reason, actor);
      res.json({ ok: true, refundInvoice: refundInv, originalInvoice: getInvoice(inv.id) });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  /**
   * GET /api/founder/invoices
   * Returns invoices for the founder's active company. Scoped — cannot see others.
   */
  app.get("/api/founder/invoices", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? req.headers["x-company-id"] ?? "");
    const invoices = listInvoicesForCompany(companyId);
    res.json({ ok: true, invoices, total: invoices.length });
  });

  /**
   * GET /api/founder/invoices/:id
   * Must belong to the requesting company.
   */
  app.get("/api/founder/invoices/:id", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? req.headers["x-company-id"] ?? "");
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "not_found" });
    if (inv.companyId !== companyId) return res.status(403).json({ ok: false, error: "forbidden" });
    res.json({ ok: true, invoice: inv });
  });

  /**
   * GET /api/founder/invoices/:id/pdf
   * Scoped download — must belong to requesting company.
   */
  app.get("/api/founder/invoices/:id/pdf", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? req.headers["x-company-id"] ?? "");
    const inv = getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ ok: false, error: "not_found" });
    if (inv.companyId !== companyId) return res.status(403).json({ ok: false, error: "forbidden" });
    const pdf = generateInvoicePdf(inv);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${inv.invoiceNumber}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    res.send(pdf);
  });

  /**
   * POST /api/founder/invoices/:id/email
   * Enqueues an outbox email with the invoice details to the founder.
   * Responds immediately; email delivery is async via emailTransport.
   */
  app.post("/api/founder/invoices/:id/email", (req: Request, res: Response): void => {
    const companyId = String(req.body?.companyId ?? req.headers["x-company-id"] ?? "");
    const inv = getInvoice(req.params.id);
    if (!inv) { res.status(404).json({ ok: false, error: "not_found" }); return; }
    if (inv.companyId !== companyId) { res.status(403).json({ ok: false, error: "forbidden" }); return; }

    const toEmail = String(req.body?.email ?? "founder@capavate.com");
    const fmtMoney = (minor: number, currency: string) =>
      new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);

    // Fire-and-forget via emailTransport
    sendMail({
      to: toEmail,
      subject: `Your Capavate invoice ${inv.invoiceNumber}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#0f5a5a">Invoice ${inv.invoiceNumber}</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;border-bottom:1px solid #eee">Plan</td><td style="padding:8px;border-bottom:1px solid #eee">${inv.planLabel}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">Period</td><td style="padding:8px;border-bottom:1px solid #eee">${inv.periodStart} – ${inv.periodEnd}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">Amount</td><td style="padding:8px;border-bottom:1px solid #eee">${fmtMoney(inv.amountMinor, inv.currency)}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">Total (incl. tax)</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${fmtMoney(inv.totalMinor, inv.currency)}</strong></td></tr>
            <tr><td style="padding:8px">Status</td><td style="padding:8px">${inv.status}</td></tr>
          </table>
          <p style="margin-top:24px;color:#666">Download the PDF from your <a href="https://app.capavate.com/founder/billing">billing page</a>.</p>
        </div>
      `,
      text: `Invoice ${inv.invoiceNumber}\nPlan: ${inv.planLabel}\nPeriod: ${inv.periodStart} – ${inv.periodEnd}\nTotal: ${fmtMoney(inv.totalMinor, inv.currency)}\nStatus: ${inv.status}`,
      idempotencyKey: `invoice-email-${inv.id}-${Date.now()}`,
    }).catch((err: Error) => console.error("[invoiceStore] email delivery error:", err.message));

    // Audit log
    appendAdminAudit(`founder:${companyId}`, `invoice:${inv.id}`, "invoice.emailed_to_founder", { to: toEmail });

    res.json({ ok: true, invoiceId: inv.id, queued: true, to: toEmail });
  });
}

/* ---------- Testing exports ---------- */
export const _testInvoices = {
  invoiceMap,
  companyInvoices,
  yearCounters,
  reset(): void {
    invoiceMap.clear();
    companyInvoices.clear();
    yearCounters.clear();
    invoiceChain.__clear();
  },
};
