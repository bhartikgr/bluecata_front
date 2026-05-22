/**
 * Sprint 29 — CSV Roster Importer
 *
 * Endpoint: POST /api/admin/contacts/import-csv
 *   Multipart form upload. Accepts CSV with columns:
 *     legalName, displayName, email, kind, type, region, hqCountry, hqCity,
 *     industries (comma-separated), aumMinor, checkSizeMinMinor, checkSizeMaxMinor,
 *     partnerWeight, partnerSince, tags (comma-separated)
 *
 * Dry-run mode (no x-confirm header): returns preview + validation errors
 * Apply mode (x-confirm: true): creates/updates contacts idempotently on email
 *
 * GET /api/admin/contacts/sample-csv → returns 3-row sample CSV
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { randomBytes, createHash } from "node:crypto";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import {
  getAllContacts,
  createContact,
  updateContact,
  type AdminContact,
  type ContactKind,
  type ContactType,
} from "./adminContactsStore";

const VALID_KINDS: ContactKind[] = ["investor", "founder", "consortium_partner"];
const VALID_TYPES: ContactType[] = ["institutional", "family_office", "angel", "syndicate", "founder", "partner_org"];
const VALID_REGIONS = ["US", "CA", "UK", "EU", "AU", "SG", "HK", "JP", "IN", "CN", "OTHER"];

/* ============================================================
 * CSV parsing utilities
 * ============================================================ */

/** Parse a single CSV line respecting quoted fields. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const EXPECTED_HEADERS = [
  "legalName", "displayName", "email", "kind", "type", "region",
  "hqCountry", "hqCity", "industries", "aumMinor", "checkSizeMinMinor",
  "checkSizeMaxMinor", "partnerWeight", "partnerSince", "tags",
] as const;

type HeaderKey = typeof EXPECTED_HEADERS[number];

export interface ParsedRow {
  rowNumber: number;
  legalName: string;
  displayName: string;
  email: string;
  kind: ContactKind;
  type: ContactType;
  region: string;
  hqCountry: string;
  hqCity: string;
  industries: string[];
  aumMinor: number | null;
  checkSizeMinMinor: number | null;
  checkSizeMaxMinor: number | null;
  partnerWeight: number | null;
  partnerSince: string | null;
  tags: string[];
}

export interface ParseError {
  row: number;
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: ParseError[];
}

function parseMinorUnit(s: string): number | null {
  if (!s || s.trim() === "") return null;
  const n = parseInt(s.trim(), 10);
  return isNaN(n) ? null : n;
}

export function parseCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], errors: [{ row: 0, reason: "Empty CSV file" }] };
  }

  const headerLine = parseCsvLine(lines[0]);
  const normalised = headerLine.map((h) => h.trim().replace(/\s+/g, ""));

  // Validate that at minimum legalName, displayName, email, kind are present
  const required: HeaderKey[] = ["legalName", "displayName", "email", "kind"];
  for (const req of required) {
    if (!normalised.includes(req)) {
      return { rows: [], errors: [{ row: 1, reason: `Missing required column: ${req}` }] };
    }
  }

  const colIndex: Partial<Record<HeaderKey, number>> = {};
  for (const h of EXPECTED_HEADERS) {
    const idx = normalised.indexOf(h);
    if (idx !== -1) colIndex[h] = idx;
  }

  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const cells = parseCsvLine(lines[i]);

    const get = (key: HeaderKey): string => {
      const idx = colIndex[key];
      if (idx === undefined) return "";
      return cells[idx]?.trim() ?? "";
    };

    const rowErrors: string[] = [];

    const legalName = get("legalName");
    const displayName = get("displayName");
    const email = get("email");
    const kind = get("kind") as ContactKind;
    const type = (get("type") || "institutional") as ContactType;
    const region = (get("region") || "US").toUpperCase();
    const hqCountry = get("hqCountry") || "";
    const hqCity = get("hqCity") || "";

    if (!legalName) rowErrors.push("legalName is required");
    if (!displayName) rowErrors.push("displayName is required");
    if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) rowErrors.push("email is invalid");
    if (!VALID_KINDS.includes(kind)) rowErrors.push(`kind must be one of: ${VALID_KINDS.join(", ")}`);
    if (!VALID_TYPES.includes(type)) rowErrors.push(`type must be one of: ${VALID_TYPES.join(", ")}`);
    if (!VALID_REGIONS.includes(region)) rowErrors.push(`region must be one of: ${VALID_REGIONS.join(", ")}`);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, reason: rowErrors.join("; ") });
      continue;
    }

    const industriesRaw = get("industries");
    const tagsRaw = get("tags");

    rows.push({
      rowNumber: rowNum,
      legalName,
      displayName,
      email,
      kind,
      type,
      region,
      hqCountry,
      hqCity,
      industries: industriesRaw ? industriesRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
      aumMinor: parseMinorUnit(get("aumMinor")),
      checkSizeMinMinor: parseMinorUnit(get("checkSizeMinMinor")),
      checkSizeMaxMinor: parseMinorUnit(get("checkSizeMaxMinor")),
      partnerWeight: parseMinorUnit(get("partnerWeight")),
      partnerSince: get("partnerSince") || null,
      tags: tagsRaw ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    });
  }

  return { rows, errors };
}

/* ============================================================
 * Sample CSV
 * ============================================================ */
const SAMPLE_CSV = [
  "legalName,displayName,email,kind,type,region,hqCountry,hqCity,industries,aumMinor,checkSizeMinMinor,checkSizeMaxMinor,partnerWeight,partnerSince,tags",
  '"Hydra Ventures LP","Hydra Ventures","contact@hydravc.com",investor,institutional,US,US,"San Francisco","Fintech,SaaS",500000000000,25000000,5000000000,,,"tier-a,strategic"',
  '"Maya Chen","Maya Chen","maya@novapay.ai",founder,founder,US,US,"San Francisco","Payments,B2B SaaS",,,,,,founder-tier-1',
  '"YC Partner Network","YC Partners","partners@ycombinator.com",consortium_partner,partner_org,US,US,"Mountain View","All Sectors",,,,3,2020-01-01,"yc,consortium"',
].join("\n");

/* ============================================================
 * Apply a single parsed row (create or update)
 * ============================================================ */
async function applyRow(
  row: ParsedRow,
  actor: string,
): Promise<{ action: "created" | "updated"; contact: AdminContact }> {
  const all = getAllContacts();
  const existing = all.find((c) => c.email.toLowerCase() === row.email.toLowerCase());

  if (existing) {
    // Update
    const updated = updateContact(
      existing.id,
      {
        legalName: row.legalName,
        displayName: row.displayName,
        kind: row.kind,
        type: row.type,
        region: row.region,
        hqCountry: row.hqCountry,
        hqCity: row.hqCity,
        industries: row.industries,
        aumMinor: row.aumMinor,
        checkSizeMinMinor: row.checkSizeMinMinor,
        checkSizeMaxMinor: row.checkSizeMaxMinor,
        partnerWeight: row.partnerWeight,
        partnerSince: row.partnerSince,
        tags: row.tags,
      },
      actor,
    );
    appendAdminAudit(actor, `contact:${existing.id}`, "contact.updated", { source: "csv_import", email: row.email });
    emitBridgeEvent({
      eventType: "contact.updated",
      aggregateId: existing.id,
      aggregateKind: "contact",
      actor: { userId: actor },
      payload: { source: "csv_import", email: row.email },
    });
    return { action: "updated", contact: updated };
  } else {
    // Create
    const contactData: Omit<AdminContact, "id" | "createdAt" | "updatedAt" | "version" | "prevRevisionHash" | "revisionHash"> = {
      kind: row.kind,
      legalName: row.legalName,
      displayName: row.displayName,
      email: row.email,
      type: row.type,
      status: "active",
      verification: "unverified",
      region: row.region,
      hqCountry: row.hqCountry,
      hqCity: row.hqCity,
      industries: row.industries,
      stages: [],
      companyIds: [],
      aumMinor: row.aumMinor,
      aumCurrency: "USD",
      checkSizeMinMinor: row.checkSizeMinMinor,
      checkSizeMaxMinor: row.checkSizeMaxMinor,
      partnerWeight: row.partnerWeight,
      partnerSince: row.partnerSince,
      tags: row.tags,
      notes: "",
      phone: null,
      website: null,
      linkedinUrl: null,
      createdBy: actor,
      updatedBy: actor,
    };
    const created = createContact(contactData, actor);
    appendAdminAudit(actor, `contact:${created.id}`, "contact.created", { source: "csv_import", email: row.email });
    emitBridgeEvent({
      eventType: "contact.created",
      aggregateId: created.id,
      aggregateKind: "contact",
      actor: { userId: actor },
      payload: { source: "csv_import", email: row.email },
    });
    return { action: "created", contact: created };
  }
}

/* ============================================================
 * Route registration
 * ============================================================ */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export function registerContactRosterImporterRoutes(app: Express): void {
  /**
   * GET /api/admin/contacts/sample-csv
   * Returns a sample CSV file for download.
   */
  app.get("/api/admin/contacts/sample-csv", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=\"contacts_sample.csv\"");
    res.send(SAMPLE_CSV);
  });

  /**
   * POST /api/admin/contacts/import-csv
   *
   * Without x-confirm: true → dry-run preview
   * With x-confirm: true → apply (idempotent on email)
   */
  app.post(
    "/api/admin/contacts/import-csv",
    upload.single("file"),
    async (req: Request, res: Response) => {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: "No file uploaded. Use multipart/form-data with field 'file'." });
      }

      const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
      const confirm = req.headers["x-confirm"] === "true";

      const csvText = req.file.buffer.toString("utf8");
      const { rows, errors } = parseCsv(csvText);

      if (!confirm) {
        // Dry-run: validate only
        return res.status(200).json({
          ok: true,
          dryRun: true,
          message: "Dry-run complete. Add header x-confirm: true to apply.",
          preview: rows,
          errors,
          validRows: rows.length,
          invalidRows: errors.length,
        });
      }

      // Apply phase
      let importedCount = 0;
      let skippedCount = 0;
      const applyErrors: ParseError[] = [...errors]; // include parse errors

      const results: Array<{ row: number; action: string; email: string }> = [];

      for (const row of rows) {
        try {
          const { action } = await applyRow(row, actor);
          importedCount++;
          results.push({ row: row.rowNumber, action, email: row.email });
        } catch (e) {
          skippedCount++;
          applyErrors.push({ row: row.rowNumber, reason: (e as Error).message });
        }
      }

      appendAdminAudit(actor, "contacts", "contacts.csv_imported", {
        importedCount,
        skippedCount,
        errorCount: applyErrors.length,
      });

      res.json({
        ok: true,
        importedCount,
        skippedCount,
        errors: applyErrors,
        results,
      });
    },
  );
}

/* ============================================================
 * Test exports
 * ============================================================ */
export const _testImporter = {
  parseCsv,
  SAMPLE_CSV,
};
