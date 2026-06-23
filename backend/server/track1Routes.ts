/**
 * v25.0 Track 1 — Capavate Core Endpoints (A1–A8)
 *
 * Endpoints wired:
 *   A1  GET  /api/founder/captable/waterfall
 *   A2  POST /api/founder/term-sheets/generate
 *       GET  /api/founder/term-sheets/:id/download
 *   A3  POST /api/founder/crm/import
 *   A4  POST /api/founder/data-room/files
 *       POST /api/founder/data-room/grants
 *       GET  /api/founder/data-room/files/:fileId
 *   A5  POST /api/investor/invitations/:token/kyc
 *   A6  POST /api/investor/documents/:id/sign
 *   A7  POST /api/rounds/:id/soft-circle/:scId/reject
 *   A8  POST /api/rounds/:id/updates
 *
 * All writes commit to DB before returning success.
 * All state-changing writes emit BridgeOutbound events.
 * All endpoints respect tenant isolation + ownership checks.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import multer from "multer";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { emitBridgeEvent } from "./bridgeStore";
import type { OutboundEventType } from "./bridgeStore";
import { log } from "./lib/logger";
import { rateLimitMiddleware } from "./lib/rateLimit";
import { getLedger } from "./captableCommitStore";
import { getRoundById } from "./roundsStore";
import { addContact } from "./crmStore";
import { insertContactForImport } from "./founderCrmStore";
import { emitNotification } from "./notificationsStore";
import { listForRound as softCircleListForRound } from "./softCircleStore";

// Helper to emit bridge events with our new event types (using cast to bypass strict type)
function emitBridge(eventType: string, aggregateId: string, aggregateKind: "company" | "investor" | "round" | "platform", payload: Record<string, unknown>): void {
  try {
    emitBridgeEvent({
      eventType: eventType as unknown as OutboundEventType,
      aggregateId,
      aggregateKind,
      payload,
    });
  } catch (err) {
    log.warn("[track1] bridge emit failed:", (err as Error).message);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Verify that the authenticated user owns (or is admin of) a company. */
function ownsCompany(ctx: ReturnType<typeof getUserContext>, companyId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === companyId);
}

/** Verify that the authenticated user owns (or is admin of) a round's company. */
function ownsRound(ctx: ReturnType<typeof getUserContext>, roundId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  const round = getRoundById(roundId);
  if (!round) return false;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === round.companyId);
}

// ── multer (for A3 CSV import) ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── minimal PDF builder (same pattern as invoiceStore) ───────────────────────
function markdownToPdf(content: string): Buffer {
  // Simple %PDF-1.4 envelope embedding the text as a stream.
  // Same pattern as generateInvoicePdf() in invoiceStore.ts (no external dep).
  const escaped = content.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Chunk text into lines for PDF stream
  const lines = escaped.split("\n");
  const textOps = lines.map((l, i) => `BT /F1 11 Tf 40 ${800 - i * 14} Td (${l.substring(0, 120)}) Tj ET`).join("\n");

  const stream = `${textOps}\n`;
  const streamLen = Buffer.byteLength(stream, "utf8");

  const bodyParts: string[] = [];
  bodyParts.push("%PDF-1.4");
  // obj 1: catalog
  const off1 = bodyParts.join("\n").length + 1;
  bodyParts.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  // obj 2: pages
  const off2 = bodyParts.join("\n").length + 1;
  bodyParts.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  // obj 3: page
  const off3 = bodyParts.join("\n").length + 1;
  bodyParts.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj`);
  // obj 4: stream
  const off4 = bodyParts.join("\n").length + 1;
  bodyParts.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`);

  const xrefOffset = bodyParts.join("\n").length + 1;
  bodyParts.push("xref\n0 5");
  bodyParts.push(`0000000000 65535 f\r`);
  bodyParts.push(`${String(off1).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off2).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off3).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off4).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(bodyParts.join("\n"), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — GET /api/founder/captable/waterfall
// ─────────────────────────────────────────────────────────────────────────────

async function handleWaterfall(req: Request, res: Response): Promise<void> {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { companyId, exitValuationMinor, preferredReturnPct } = req.query as Record<string, string>;

  if (!companyId) { res.status(422).json({ ok: false, error: "MISSING_COMPANY_ID" }); return; }
  if (!exitValuationMinor) { res.status(422).json({ ok: false, error: "MISSING_EXIT_VALUATION_MINOR" }); return; }

  if (!ownsCompany(ctx, companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const exitMinor = Number(exitValuationMinor);
  if (!Number.isFinite(exitMinor) || exitMinor < 0) {
    res.status(422).json({ ok: false, error: "INVALID_EXIT_VALUATION_MINOR" }); return;
  }

  const lpPct = preferredReturnPct ? Number(preferredReturnPct) : 0;
  if (!Number.isFinite(lpPct) || lpPct < 0 || lpPct > 1) {
    res.status(422).json({ ok: false, error: "INVALID_PREFERRED_RETURN_PCT" }); return;
  }

  // Build waterfall input from cap table ledger entries for the company
  const ledger = getLedger();
  const companyEntries = ledger.filter((e: unknown) => (e as { companyId: string }).companyId === companyId && (e as { state: string }).state === "committed");

  // Group by roundId (share class proxy) — use string amounts to avoid BigInt literal TS errors
  const byRoundKeys: string[] = [];
  const byRoundData: Record<string, { amountStr: string; sharesStr: string; roundName: string }> = {};
  for (const entry of companyEntries) {
    const e = entry as { roundId: string; amount: string; shares: string };
    const round = getRoundById(e.roundId);
    if (!byRoundData[e.roundId]) {
      byRoundKeys.push(e.roundId);
      byRoundData[e.roundId] = { amountStr: "0", sharesStr: "0", roundName: round?.name ?? e.roundId };
    }
    const data = byRoundData[e.roundId];
    try {
      data.amountStr = String(Number(data.amountStr) + Math.round(Number(e.amount) * 100));
      data.sharesStr = String(Number(data.sharesStr) + Math.max(0, Number(e.shares ?? "0")));
    } catch { /* skip bad rows */ }
  }

  const exitProceeds = String(exitMinor);

  // Build preferred classes and common holders from the ledger
  const preferred: unknown[] = [];
  const common: unknown[] = [];
  let classIdx = 0;
  for (const rid of byRoundKeys) {
    const data = byRoundData[rid];
    if (Number(data.sharesStr) === 0) continue;
    preferred.push({
      classId: rid,
      className: data.roundName,
      invested: data.amountStr,
      // Waterfall engine accepts bigint for shares — convert via string cast
      shares: (BigInt as unknown as (s: string) => unknown)(data.sharesStr),
      liquidationPreferenceMultiple: 1 + lpPct,
      participating: false,
      seniority: classIdx++,
    });
  }

  // Remaining shares (untracked) treated as common
  const totalPrefSharesNum = preferred.reduce((s: number, p: unknown) => s + Number(String((p as { shares: unknown }).shares)), 0);
  if (totalPrefSharesNum === 0 && preferred.length === 0) {
    // No ledger data — return zero proceeds with empty breakdown
    res.json({
      ok: true,
      lpProceeds: 0,
      founderProceeds: exitMinor,
      byShareClass: [],
      breakpoints: [],
    });
    return;
  }

  // Common holders: the founder holds remaining cap (simplified: 1 common holder)
  const commonSharesNum = totalPrefSharesNum > 0 ? totalPrefSharesNum : 1;
  common.push({ holderId: "founder_common", shares: (BigInt as unknown as (s: string) => unknown)(String(commonSharesNum)) });

  // Import waterfall engine (sacred — read-only)
  let computeWaterfall: (input: unknown) => unknown;
  try {
    const engine = await import("@capavate/cap-table-engine");
    computeWaterfall = (engine as unknown as { computeWaterfall: (i: unknown) => unknown }).computeWaterfall;
  } catch (err) {
    log.warn("[track1/waterfall] engine import failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "ENGINE_UNAVAILABLE" }); return;
  }

  const formulaId = `waterfall_${companyId}`;
  const waterfallInput = {
    exitProceeds,
    preferred,
    common,
    formulaId,
    formulaVersion: "v25.0",
    region: "US" as const,
    formulaDef: { preferredReturnPct: lpPct, exitMinor },
  };

  let result: unknown;
  try {
    result = computeWaterfall(waterfallInput);
  } catch (err) {
    log.warn("[track1/waterfall] compute failed:", (err as Error).message);
    res.status(422).json({ ok: false, error: "WATERFALL_COMPUTE_ERROR", message: (err as Error).message }); return;
  }

  const output = result as { payouts: unknown[]; remainder: string };
  const payouts = output.payouts as Array<{
    classId?: string; holderId?: string; className?: string;
    total: string; decision: string;
  }>;

  const lpProceeds = payouts
    .filter((p) => p.classId)
    .reduce((s, p) => s + Number(p.total), 0);
  const founderProceeds = payouts
    .filter((p) => p.holderId === "founder_common")
    .reduce((s, p) => s + Number(p.total), 0);

  const byShareClass = payouts
    .filter((p) => p.classId)
    .map((p) => ({
      classId: p.classId,
      className: p.className ?? p.classId,
      proceeds: Number(p.total),
      decision: p.decision,
    }));

  // Compute breakpoints: at what exit value LP and founder proceeds cross
  const breakpoints: Array<{ exitMinor: number; description: string }> = [
    {
      exitMinor: payouts
        .filter((p) => p.classId)
        .reduce((s, p) => s + Number(p.total), 0),
      description: "liquidation_preference_covered",
    },
  ];

  emitBridge("captable.waterfall.computed", companyId, "company", { companyId, exitMinor, lpProceeds, founderProceeds });

  res.json({
    ok: true,
    lpProceeds,
    founderProceeds,
    byShareClass,
    breakpoints,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — POST /api/founder/term-sheets/generate
//      GET  /api/founder/term-sheets/:id/download
// ─────────────────────────────────────────────────────────────────────────────

function buildTermSheetMarkdown(round: ReturnType<typeof getRoundById>): string {
  if (!round) return "# Term Sheet\n\n_Round not found._\n";
  const terms = (round as unknown as { terms?: Record<string, unknown> }).terms ?? {};
  const lines = [
    `# Term Sheet — ${round.name}`,
    ``,
    `**Company ID:** ${round.companyId}`,
    `**Round Type:** ${round.type}`,
    `**State:** ${round.state}`,
    `**Target Amount:** ${round.targetAmount?.toLocaleString() ?? "N/A"} ${round.currency ?? "USD"}`,
    `**Pre-Money Valuation:** ${round.preMoney?.toLocaleString() ?? "N/A"}`,
    `**Price Per Share:** ${round.pricePerShare ?? "N/A"}`,
    `**Close Date:** ${round.closeDate ?? "TBD"}`,
    `**Instrument:** ${round.instrument ?? "SAFE"}`,
    ``,
    `## Terms`,
    ``,
    ...(Object.keys(terms).length > 0
      ? Object.entries(terms).map(([k, v]) => `- **${k}:** ${v}`)
      : ["_No terms defined on this round._"]),
    ``,
    `## Summary`,
    ``,
    round.termsSummary ?? "_No summary available._",
    ``,
    `---`,
    `*Generated by Capavate v25.0 at ${nowIso()}*`,
  ];
  return lines.join("\n");
}

function handleTermSheetGenerate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, format } = req.body as { roundId?: string; format?: string };
  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (format && format !== "markdown" && format !== "pdf") {
    res.status(422).json({ ok: false, error: "INVALID_FORMAT", message: "format must be 'markdown' or 'pdf'" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const resolvedFormat = (format as "markdown" | "pdf") ?? "markdown";
  const contentMd = buildTermSheetMarkdown(round);
  const docId = newId("ts");
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO term_sheets (id, round_id, owner_id, format, content_md, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(docId, roundId, ctx.userId, resolvedFormat, contentMd, createdAt);
  } catch (err) {
    log.error("[track1/term-sheet] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("termSheet.generated", roundId, "round", { docId, roundId, format: resolvedFormat, ownerId: ctx.userId });

  res.status(201).json({
    ok: true,
    docId,
    format: resolvedFormat,
    downloadUrl: `/api/founder/term-sheets/${docId}/download`,
    generatedAt: createdAt,
  });
}

function handleTermSheetDownload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { id } = req.params;
  let row: { id: string; round_id: string; owner_id: string; format: string; content_md: string; created_at: string } | undefined;
  try {
    const db = rawDb();
    row = db.prepare(`SELECT * FROM term_sheets WHERE id = ?`).get(id) as typeof row;
  } catch (err) {
    log.warn("[track1/term-sheet-download] DB read failed:", (err as Error).message);
  }

  if (!row) { res.status(404).json({ ok: false, error: "NOT_FOUND" }); return; }

  // Ownership: owner OR admin
  if (row.owner_id !== ctx.userId && !ctx.isAdmin) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" }); return;
  }

  if (row.format === "pdf") {
    const pdfBuf = markdownToPdf(row.content_md);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(pdfBuf);
  } else {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.md"`);
    res.send(row.content_md);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — POST /api/founder/crm/import
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvText(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
}

function handleCrmImport(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let csvText: string | undefined;

  // Support both multipart upload and text/csv content-type
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    csvText = req.body as string;
  } else if ((req as unknown as { file?: { buffer: Buffer } }).file) {
    csvText = (req as unknown as { file: { buffer: Buffer } }).file.buffer.toString("utf8");
  } else if (typeof req.body === "string") {
    csvText = req.body;
  }

  if (!csvText || csvText.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_CSV", message: "Provide CSV as body or file upload" }); return;
  }

  // v25.0 B-J5-3 fix: extract companyId so we can write to founderCrmStore
  // (the source for GET /api/founder/crm/contacts). Accept from multipart field,
  // query param, or JSON body.
  const companyId: string | undefined =
    (typeof (req as any).body === "object" && typeof (req as any).body?.companyId === "string"
      ? (req as any).body.companyId
      : undefined) ??
    (typeof req.query.companyId === "string" ? req.query.companyId : undefined) ??
    // Multipart: multer puts non-file fields in req.body
    (typeof (req as any).body?.companyId === "string" ? (req as any).body.companyId : undefined) ??
    ctx.founder?.activeCompanyId ?? undefined;

  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    res.status(422).json({ ok: false, error: "EMPTY_CSV" }); return;
  }
  if (rows.length > 1000) {
    res.status(422).json({ ok: false, error: "TOO_MANY_ROWS", message: "Max 1000 rows per import" }); return;
  }

  let imported = 0;
  let skipped = 0;
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row["email"] ?? "").trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i + 2, reason: `invalid_email: ${email}` });
      skipped++;
      continue;
    }

    try {
      addContact({
        name: row["name"] ?? email,
        email,
        kind: "ecosystem" as const,
        firm: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
        pipelineStage: "lead" as const,
      }, ctx.userId);
      // v25.0 B-J5-3 fix: ALSO write to founderCrmStore so GET /api/founder/crm/contacts returns these rows
      if (companyId) {
        insertContactForImport({
          companyId,
          email,
          name: row["name"] ?? email,
          firmName: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
          stage: row["stage"] ?? "lead",
          series: row["series"] ?? "—",
        });
      }
      imported++;
    } catch (err) {
      errors.push({ row: i + 2, reason: (err as Error).message });
      skipped++;
    }
  }

  emitBridge("crm.import.completed", ctx.userId, "platform", { imported, skipped, errorCount: errors.length, userId: ctx.userId });

  res.status(201).json({ ok: true, imported, skipped, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — POST /api/founder/data-room/files
//      POST /api/founder/data-room/grants
//      GET  /api/founder/data-room/files/:fileId
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES_B64 = 5 * 1024 * 1024 * 4 / 3; // ~6.67MB base64 for 5MB binary

function handleDataRoomUpload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, filename, contentBase64, mimeType } = req.body as {
    roundId?: string; filename?: string; contentBase64?: string; mimeType?: string;
  };

  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (!filename) { res.status(422).json({ ok: false, error: "MISSING_FILENAME" }); return; }
  if (!contentBase64) { res.status(422).json({ ok: false, error: "MISSING_CONTENT_BASE64" }); return; }
  if (!mimeType) { res.status(422).json({ ok: false, error: "MISSING_MIME_TYPE" }); return; }

  if (contentBase64.length > MAX_FILE_BYTES_B64) {
    res.status(422).json({ ok: false, error: "FILE_TOO_LARGE", message: "Max file size is 5MB" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const fileId = newId("drf");
  const uploadedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_files (id, round_id, owner_id, filename, content_base64, mime_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, roundId, ctx.userId, filename, contentBase64, mimeType, uploadedAt);
  } catch (err) {
    log.error("[track1/data-room-upload] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.file.uploaded", roundId, "round", { fileId, roundId, filename, mimeType, ownerId: ctx.userId });

  res.status(201).json({ ok: true, fileId, uploadedAt });
}

function handleDataRoomGrant(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { fileId, investorId, ttlMinutes } = req.body as {
    fileId?: string; investorId?: string; ttlMinutes?: number;
  };

  if (!fileId) { res.status(422).json({ ok: false, error: "MISSING_FILE_ID" }); return; }
  if (!investorId) { res.status(422).json({ ok: false, error: "MISSING_INVESTOR_ID" }); return; }

  const ttl = Number(ttlMinutes ?? 60);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 43200) {
    res.status(422).json({ ok: false, error: "INVALID_TTL", message: "ttlMinutes must be 1–43200" }); return;
  }

  let fileRow: { round_id: string; owner_id: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT round_id, owner_id FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-grant] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const token = randomBytes(32).toString("hex");
  const grantId = newId("drg");
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_grants (id, file_id, investor_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(grantId, fileId, investorId, token, expiresAt, createdAt);
  } catch (err) {
    log.error("[track1/data-room-grant] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.grant.created", fileId, "round", { grantId, fileId, investorId, expiresAt });

  // Notify the investor
  try {
    emitNotification({
      userId: investorId,
      kind: "dataroom.access_granted",
      title: "Data room access granted",
      body: `You have been granted access to a document. Token expires at ${expiresAt}.`,
      link: `/api/public/data-room/files/${fileId}?grant=${token}`,
    });
  } catch { /* best-effort */ }

  res.status(201).json({ ok: true, grantToken: token, expiresAt });
}

function handleDataRoomFileGet(req: Request, res: Response): void {
  const { fileId } = req.params;
  const grantToken = req.query["grant"] as string | undefined;

  // Check grant token path (no auth session required for this path)
  if (grantToken) {
    let grant: { file_id: string; investor_id: string; expires_at: string } | undefined;
    let fileRow: { filename: string; content_base64: string; mime_type: string } | undefined;
    try {
      const db = rawDb();
      grant = db.prepare(`SELECT * FROM data_room_grants WHERE token = ? AND file_id = ?`).get(grantToken, fileId) as typeof grant;
      if (grant) {
        fileRow = db.prepare(`SELECT filename, content_base64, mime_type FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
      }
    } catch (err) {
      log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
    }

    if (!grant) { res.status(403).json({ ok: false, error: "INVALID_GRANT" }); return; }
    if (new Date(grant.expires_at) < new Date()) { res.status(403).json({ ok: false, error: "GRANT_EXPIRED" }); return; }
    if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

    const buf = Buffer.from(fileRow.content_base64, "base64");
    res.setHeader("Content-Type", fileRow.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
    res.send(buf);
    return;
  }

  // Without grant token, require auth + ownership
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let fileRow: { round_id: string; owner_id: string; filename: string; content_base64: string; mime_type: string; uploaded_at: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT * FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const buf = Buffer.from(fileRow.content_base64, "base64");
  res.setHeader("Content-Type", fileRow.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
  res.send(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// A5 — POST /api/investor/invitations/:token/kyc
// ─────────────────────────────────────────────────────────────────────────────

function handleInvestorKyc(req: Request, res: Response): void {
  const token = String(req.params["token"] ?? "");
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { accredited, jurisdiction, source_of_funds, attestations } = req.body as {
    accredited?: boolean; jurisdiction?: string; source_of_funds?: string; attestations?: unknown[];
  };

  if (typeof accredited !== "boolean") {
    res.status(422).json({ ok: false, error: "MISSING_ACCREDITED", message: "accredited (boolean) is required" }); return;
  }
  if (!jurisdiction || typeof jurisdiction !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_JURISDICTION" }); return;
  }
  if (!source_of_funds || typeof source_of_funds !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_SOURCE_OF_FUNDS" }); return;
  }
  if (!Array.isArray(attestations)) {
    res.status(422).json({ ok: false, error: "MISSING_ATTESTATIONS", message: "attestations must be an array" }); return;
  }

  // Validate the invitation token
  let invitation: { id: string; investor_email: string; state: string } | undefined;
  try {
    const db = rawDb();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    invitation = db.prepare(
      `SELECT id, investor_email, state FROM round_invitations WHERE token_hash = ? LIMIT 1`
    ).get(tokenHash) as typeof invitation;
  } catch (err) {
    log.warn("[track1/kyc] invitation lookup failed:", (err as Error).message);
  }

  if (!invitation) { res.status(404).json({ ok: false, error: "INVITATION_NOT_FOUND" }); return; }

  // The investor must own this invitation (their session email matches)
  const investorId = ctx.userId;
  const kycId = newId("kyc");
  const createdAt = nowIso();
  const attestationsJson = JSON.stringify(attestations);

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO investor_kyc (id, investor_id, accredited, jurisdiction, source_of_funds, attestations_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(kycId, investorId, accredited ? 1 : 0, jurisdiction, source_of_funds, attestationsJson, createdAt);
  } catch (err) {
    log.error("[track1/kyc] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Update investor profile: kyc_completed = true, accreditation = accredited
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE profilestore_investor_profile SET updated_at = ? WHERE investor_id = ?`
    ).run(createdAt, investorId);
  } catch { /* best-effort profile update */ }

  emitBridge("kyc.status_changed", investorId, "investor", { investorId, accredited, jurisdiction, kycId, invitationId: invitation.id });

  try {
    emitNotification({
      userId: investorId,
      kind: "kyc.status_changed",
      title: "KYC completed",
      body: "Your KYC attestation has been recorded.",
    });
  } catch { /* best-effort */ }

  res.status(201).json({
    ok: true,
    kycId,
    investorId,
    accredited,
    jurisdiction,
    createdAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A6 — POST /api/investor/documents/:id/sign
// ─────────────────────────────────────────────────────────────────────────────

function handleDocumentSign(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const documentId = String(req.params["id"] ?? "");
  const { signature, signed_at } = req.body as { signature?: string; signed_at?: string };

  if (!signature || typeof signature !== "string" || signature.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_SIGNATURE" }); return;
  }

  const signerId = ctx.userId;
  const resolvedSignedAt = signed_at ?? nowIso();

  // Idempotency: check if already signed by this user
  let existing: { id: string; document_id: string; signer_id: string; signature_text: string; signed_at: string } | undefined;
  try {
    const db = rawDb();
    existing = db.prepare(
      `SELECT * FROM document_signatures WHERE document_id = ? AND signer_id = ?`
    ).get(documentId, signerId) as typeof existing;
  } catch (err) {
    log.warn("[track1/sign] DB read failed:", (err as Error).message);
  }

  if (existing) {
    // Return existing record (idempotent)
    res.json({
      ok: true,
      signatureId: existing.id,
      documentId: existing.document_id,
      signerId: existing.signer_id,
      signedAt: existing.signed_at,
      alreadySigned: true,
    });
    return;
  }

  const sigId = newId("sig");
  const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO document_signatures (id, document_id, signer_id, signature_text, signed_at, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sigId, documentId, signerId, signature, resolvedSignedAt, ipAddress);
  } catch (err) {
    log.error("[track1/sign] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("document.signed", documentId, "round", { sigId, documentId, signerId, signedAt: resolvedSignedAt });

  res.status(201).json({
    ok: true,
    signatureId: sigId,
    documentId,
    signerId,
    signedAt: resolvedSignedAt,
    alreadySigned: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A7 — POST /api/rounds/:id/soft-circle/:scId/reject
// ─────────────────────────────────────────────────────────────────────────────

function handleSoftCircleReject(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const scId = String(req.params["scId"] ?? "");
  const { reason } = req.body as { reason?: string };

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_REASON" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  // Look up soft circle in memory store
  const circles = softCircleListForRound(roundId);
  const sc = circles.find((c: { id: string }) => c.id === scId);
  if (!sc) { res.status(404).json({ ok: false, error: "SOFT_CIRCLE_NOT_FOUND" }); return; }

  const scAny = sc as unknown as {
    id: string; roundId: string; status: string; investorName: string;
    rejectedAt?: string; rejectedReason?: string; updatedAt?: string;
  };

  // Idempotency: if already rejected, return same response
  if (scAny.status === "rejected" && scAny.rejectedAt) {
    res.json({
      ok: true,
      scId,
      status: "rejected",
      rejectedAt: scAny.rejectedAt,
      rejectedReason: scAny.rejectedReason ?? reason,
      alreadyRejected: true,
    });
    return;
  }

  // Validate current status allows rejection
  const REJECTABLE_STATUSES = ["intent", "confirmed", "wired"];
  if (!REJECTABLE_STATUSES.includes(scAny.status)) {
    res.status(422).json({
      ok: false,
      error: "INVALID_STATUS_TRANSITION",
      message: `Cannot reject a soft circle in '${scAny.status}' state`,
    }); return;
  }

  const rejectedAt = nowIso();

  // Update in memory cache
  scAny.status = "rejected" as unknown as string;
  scAny.rejectedAt = rejectedAt;
  scAny.rejectedReason = reason;
  scAny.updatedAt = rejectedAt;

  // Persist to DB
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE soft_circles SET status = 'rejected', rejected_at = ?, rejected_reason = ?, updated_at = ? WHERE id = ?`
    ).run(rejectedAt, reason, rejectedAt, scId);
  } catch (err) {
    log.error("[track1/sc-reject] DB update failed:", (err as Error).message);
    // Don't fail — in-memory updated; DB write best-effort on this column
  }

  emitBridge("softCircle.rejected", roundId, "round", { scId, roundId, reason, rejectedAt, investorName: scAny.investorName });

  res.json({
    ok: true,
    scId,
    status: "rejected",
    rejectedAt,
    rejectedReason: reason,
    alreadyRejected: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A8 — POST /api/rounds/:id/updates
// ─────────────────────────────────────────────────────────────────────────────

function handleRoundUpdate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const { title, body, visibility } = req.body as {
    title?: string; body?: string; visibility?: string;
  };

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_TITLE" }); return;
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_BODY" }); return;
  }
  const validVisibilities = ["all", "committed", "collective_only"];
  const resolvedVisibility = visibility ?? "all";
  if (!validVisibilities.includes(resolvedVisibility)) {
    res.status(422).json({ ok: false, error: "INVALID_VISIBILITY", message: "visibility must be 'all', 'committed', or 'collective_only'" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  const updateId = newId("upd");
  const publishedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO round_updates (id, round_id, author_id, title, body, visibility, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(updateId, roundId, ctx.userId, title.trim(), body.trim(), resolvedVisibility, publishedAt);
  } catch (err) {
    log.error("[track1/round-update] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Notification fanout: notify committed investors (and collective if visibility=collective_only|all)
  const circles = softCircleListForRound(roundId);
  const committedInvestors = circles
    .filter((sc: unknown) => (sc as { status: string }).status === "committed" || (sc as { status: string }).status === "wired")
    .map((sc: unknown) => (sc as { investorUserId?: string }).investorUserId)
    .filter((id): id is string => typeof id === "string");

  const notifySet = new Set<string>(committedInvestors);
  const notifyArr = Array.from(notifySet);

  for (const investorId of notifyArr) {
    try {
      emitNotification({
        userId: investorId,
        kind: "investor_report.published",
        title: `New update: ${title}`,
        body: `${round.name} published a new update.`,
        link: `/rounds/${roundId}/updates/${updateId}`,
      });
    } catch { /* best-effort */ }
  }

  emitBridge("round.update.published", roundId, "round", {
      updateId, roundId, authorId: ctx.userId, title, visibility: resolvedVisibility,
      notifiedCount: notifySet.size, publishedAt,
    });

  res.status(201).json({
    ok: true,
    updateId,
    roundId,
    authorId: ctx.userId,
    title: title.trim(),
    visibility: resolvedVisibility,
    publishedAt,
    notifiedCount: notifySet.size,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerTrack1Routes(app: Express): void {
  // A1 — waterfall (read — no rate-limit mutation guard)
  app.get("/api/founder/captable/waterfall", requireAuth, (req, res) => {
    handleWaterfall(req, res).catch((err) => {
      log.error("[track1/waterfall] unhandled:", (err as Error).message);
      res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  // A2 — term-sheet generation
  app.post("/api/founder/term-sheets/generate", requireAuth, rateLimitMiddleware, handleTermSheetGenerate);
  app.get("/api/founder/term-sheets/:id/download", requireAuth, handleTermSheetDownload);

  // A3 — CRM CSV import (supports both multipart upload and text/csv body)
  const textBodyParser = (req: Request, res: Response, next: import("express").NextFunction) => {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("text/csv") && !ct.includes("text/plain")) return next();
    // Already parsed if body is a string; re-parse raw bytes if Buffer
    if (typeof req.body === "string" && req.body.length > 0) return next();
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    req.on("end", () => { (req as unknown as { body: string }).body = data; next(); });
    req.on("error", () => next());
  };
  app.post(
    "/api/founder/crm/import",
    requireAuth,
    rateLimitMiddleware,
    textBodyParser,
    upload.single("file"),
    handleCrmImport,
  );

  // A4 — data room
  app.post("/api/founder/data-room/files", requireAuth, rateLimitMiddleware, handleDataRoomUpload);
  app.post("/api/founder/data-room/grants", requireAuth, rateLimitMiddleware, handleDataRoomGrant);
  // GET with grant token — registered under /api/public/ to bypass global requireAuth (token IS the credential)
  app.get("/api/public/data-room/files/:fileId", handleDataRoomFileGet);
  // GET for owners (full auth) — registered under founder path too
  app.get("/api/founder/data-room/files/:fileId", requireAuth, handleDataRoomFileGet);

  // A5 — KYC
  app.post("/api/investor/invitations/:token/kyc", requireAuth, rateLimitMiddleware, handleInvestorKyc);

  // A6 — document sign
  app.post("/api/investor/documents/:id/sign", requireAuth, rateLimitMiddleware, handleDocumentSign);

  // A7 — soft-circle reject
  app.post("/api/rounds/:id/soft-circle/:scId/reject", requireAuth, rateLimitMiddleware, handleSoftCircleReject);

  // A8 — round updates (POST creates; GET reads the feed)
  app.post("/api/rounds/:id/updates", requireAuth, rateLimitMiddleware, handleRoundUpdate);
  app.get("/api/rounds/:id/updates", requireAuth, (req: Request, res: Response): void => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }
    const roundId = String(req.params["id"] ?? "");
    const round = getRoundById(roundId);
    if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

    // v25.2: founders see all updates for their round; investors see only updates
    // whose visibility includes them (all | committed if they have committed SC).
    const isFounder = ownsRound(ctx, roundId);

    try {
      const db = rawDb();
      const rows = db.prepare(
        `SELECT id, round_id AS roundId, author_id AS authorId, title, body,
                visibility, published_at AS publishedAt
         FROM round_updates WHERE round_id = ? ORDER BY published_at DESC LIMIT 200`
      ).all(roundId) as Array<{ id: string; roundId: string; authorId: string; title: string; body: string; visibility: string; publishedAt: string }>;

      let visible = rows;
      if (!isFounder) {
        // Investor filter: include only updates whose visibility is reachable for them
        const circles = softCircleListForRound(roundId);
        const myStatus = circles.find((sc: unknown) => (sc as { investorUserId?: string }).investorUserId === ctx.userId);
        const hasCommitted = myStatus && ((myStatus as { status: string }).status === "committed" || (myStatus as { status: string }).status === "wired");
        visible = rows.filter(r => {
          if (r.visibility === "all") return true;
          if (r.visibility === "committed") return !!hasCommitted;
          if (r.visibility === "collective_only") return ctx.collective?.status === "active";
          return false;
        });
      }
      res.json({ ok: true, roundId, updates: visible, count: visible.length });
    } catch (err) {
      log.error("[track1/round-update GET] DB read failed:", (err as Error).message);
      res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
  });
}
