/**
 * Sprint 13 — Migration runner.
 *
 * Mock migration mode: walks seed data, produces a per-entity dry-run report
 * (would-add / would-update / would-skip / errors). Commit fires bridge events
 * via BridgeOutbound to sync everything to Collective.
 *
 * Idempotent + cursor-resumable: rerunning the same export is safe.
 */
import type { Express, Request, Response } from "express";
import { ALL_ENTITY_KEYS, buildSample, type EntityKey, Registry } from "@shared/schemas/sync";
import { BridgeOutbound } from "./bridgeOutbound";
import { recordLocalSnapshot, recordOutbound, recordAck } from "./driftDetector";

export interface MigrationDryRun {
  entityKey: EntityKey;
  wouldAdd: number;
  wouldUpdate: number;
  wouldSkip: number;
  errors: Array<{ aggregateId: string; reason: string }>;
  fieldsMapped: string[];
}

export interface MigrationCommitResult {
  entityKey: EntityKey;
  added: number;
  updated: number;
  skipped: number;
  bridgeEventsEmitted: number;
}

const seenAggIds = new Set<string>(); // idempotency cursor

export function clearMigrationCursor() {
  seenAggIds.clear();
}

/** Build a synthetic export from the seed samples. */
function buildExport(): Array<{ entityKey: EntityKey; rows: Record<string, unknown>[] }> {
  return ALL_ENTITY_KEYS.map(k => ({
    entityKey: k,
    rows: [buildSample(k)], // 1 row per entity for the demo export
  }));
}

export function dryRun(exportData = buildExport()): MigrationDryRun[] {
  const out: MigrationDryRun[] = [];
  for (const e of exportData) {
    const reg = (Registry as Record<string, unknown>)[e.entityKey] as { CompanyCanonicalSchema?: unknown };
    void reg;
    let add = 0, upd = 0, skip = 0;
    const errs: MigrationDryRun["errors"] = [];
    const fieldsMapped = new Set<string>();
    for (const row of e.rows) {
      const id = String(row.id ?? row.userId ?? row.companyId ?? row.subjectId ?? row.policyVersion ?? "");
      if (!id) {
        errs.push({ aggregateId: "<missing>", reason: "no id-like field" });
        continue;
      }
      const key = `${e.entityKey}:${id}`;
      if (seenAggIds.has(key)) skip++;
      else add++;
      Object.keys(row).forEach(k => fieldsMapped.add(k));
    }
    out.push({
      entityKey: e.entityKey,
      wouldAdd: add,
      wouldUpdate: upd,
      wouldSkip: skip,
      errors: errs,
      fieldsMapped: Array.from(fieldsMapped),
    });
  }
  return out;
}

export function commit(exportData = buildExport()): MigrationCommitResult[] {
  const results: MigrationCommitResult[] = [];
  for (const e of exportData) {
    let added = 0, updated = 0, skipped = 0, fired = 0;
    for (const row of e.rows) {
      const id = String(row.id ?? row.userId ?? row.companyId ?? row.subjectId ?? row.policyVersion ?? "");
      if (!id) continue;
      const key = `${e.entityKey}:${id}`;
      if (seenAggIds.has(key)) {
        skipped++;
        continue;
      }
      seenAggIds.add(key);
      added++;
      recordLocalSnapshot(e.entityKey, id, row);
      // Fire the right bridge event by entity key.
      switch (e.entityKey) {
        case "company":
          BridgeOutbound.companyProfileUpdated(id, row); fired++; break;
        case "investor":
          BridgeOutbound.investorProfileUpdated(id, row); fired++; break;
        case "round":
          // Migration of historical rounds emits a `round.closed` for closed ones,
          // otherwise a generic profile update on the company.
          if (row.status === "closed") {
            BridgeOutbound.roundClosed(id, row); fired++;
          }
          break;
        case "capTablePosition":
          BridgeOutbound.capTableMutated(String(row.companyId ?? id), row); fired++; break;
        case "auditEntry":
          BridgeOutbound.auditLogAppended(String(row.aggregateId ?? id), row); fired++; break;
        case "lifecyclePolicy":
          BridgeOutbound.lifecyclePolicyChanged(row); fired++; break;
        case "maIntelligence":
          BridgeOutbound.companyMaIntelligenceUpdated(String(row.companyId ?? id), row); fired++; break;
        default:
          // Other entities don't have a 1:1 outbound event; skip emit but still count migration.
          break;
      }
      recordOutbound(e.entityKey, id, row);
      // Mock immediate ack — in real life the drainer would do this asynchronously.
      recordAck(e.entityKey, id, row);
    }
    results.push({ entityKey: e.entityKey, added, updated, skipped, bridgeEventsEmitted: fired });
  }
  return results;
}

export function registerMigrationRoutes(app: Express): void {
  app.get("/api/admin/migration/dry-run", (_req: Request, res: Response) => {
    res.json({ rows: dryRun() });
  });

  app.post("/api/admin/migration/commit", (_req: Request, res: Response) => {
    const r = commit();
    res.json({ rows: r, totalAdded: r.reduce((s, x) => s + x.added, 0), totalEvents: r.reduce((s, x) => s + x.bridgeEventsEmitted, 0) });
  });

  app.post("/api/admin/migration/reset-cursor", (_req: Request, res: Response) => {
    clearMigrationCursor();
    res.json({ ok: true });
  });

  app.get("/api/admin/migration/mapping", (_req: Request, res: Response) => {
    // Source-field → canonical-field mapping per entity (simplified — every key maps to itself).
    const sample = buildExport();
    res.json({
      mapping: sample.map(e => ({
        entityKey: e.entityKey,
        fields: Object.keys(e.rows[0] ?? {}).map(k => ({ source: k, canonical: k })),
      })),
    });
  });
}
