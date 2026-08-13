/**
 * server/lib/wave15AuditIncidents.ts
 *
 * WAVE 15 — A-2. Clear the platform-wide audit incident banner HONESTLY.
 *
 * SINK: `platform_audit_incident` (migration 0170:—). Wave 14 created the table
 * with an honesty CHECK — a `cleared` row must carry `cleared_at`,
 * `cleared_by`, and at least 20 characters of `cleared_evidence` — and then
 * wrote NO code against it: zero writers, zero readers tree-wide (verified by
 * grep). This module is its only writer and reader.
 *
 * WHY THE DB CHECK IS NOT ENOUGH, AND WHAT THIS FILE ADDS.
 * One of the five "a check that passes may be checking nothing" instances paid
 * for in blood tonight was AN INCIDENT RECORD WHOSE NAMED MITIGATION FILE DID
 * NOT EXIST. The DB CHECK counts characters; it cannot tell whether the
 * evidence is true. So this module adds `verifyEvidenceReferences()`: every
 * repo-relative path mentioned in the evidence text MUST resolve on disk, and a
 * clear attempt naming a non-existent file is REJECTED with the missing paths
 * listed. Evidence that names nothing verifiable is also rejected — "looks
 * fine" is not evidence.
 *
 * FIX WHERE THE DATA FLOWS. The banner the admin sees is driven by
 * `GET /api/admin/audit-chain-health`, whose `incident` boolean is COMPUTED
 * live from chain health (client/src/pages/admin/AuditChainVerifyPage.tsx:86).
 * That live signal is deliberately NOT replaced: a durable "cleared" row must
 * never be able to hide a live chain break. The two are combined by
 * `platformBannerState()`, which reports an incident when EITHER the live check
 * or an open durable row says so. A cleared row suppresses only the durable
 * row, never the live signal. That is the second path, and it is the one that
 * matters.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";

export class AuditIncidentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AuditIncidentError";
  }
}

export interface AuditIncidentRow {
  id: string;
  incidentKey: string;
  severity: "info" | "warn" | "critical";
  state: "open" | "cleared";
  headline: string;
  detail: string;
  scope: "platform" | "tenant";
  tenantId: string | null;
  openedAt: string;
  clearedAt: string | null;
  clearedBy: string | null;
  clearedEvidence: string | null;
}

/** The repo root, so evidence paths are resolved against the TREE, not cwd. */
function repoRoot(): string {
  // server/lib/<this file> -> ../..
  return resolve(__dirname, "..", "..");
}

/**
 * Pull repo-relative path-looking tokens out of free text. Conservative on
 * purpose: it must not invent a reference that was never made, because a false
 * positive would reject honest evidence. A token qualifies when it contains a
 * `/` and ends in a known source extension, optionally followed by `:<line>`.
 */
export function extractEvidencePaths(evidence: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s('"`])((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:ts|tsx|js|sql|md|json|sh|css))(?::\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(evidence)) !== null) {
    const p = m[1];
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export interface EvidenceVerification {
  ok: boolean;
  referenced: string[];
  missing: string[];
  reason?: string;
}

/**
 * Verify that the evidence offered for clearing an incident is CHECKABLE and
 * CHECKS OUT.
 *
 * Both poles are exercised by server/__tests__/wave15_audit_incident.test.ts:
 *   - evidence naming a file that exists            -> ok: true
 *   - evidence naming a file that does NOT exist    -> ok: false, path listed
 *   - evidence naming nothing verifiable            -> ok: false, NO_REFERENCES
 */
export function verifyEvidenceReferences(evidence: string): EvidenceVerification {
  const referenced = extractEvidencePaths(evidence ?? "");
  if (referenced.length === 0) {
    return {
      ok: false,
      referenced,
      missing: [],
      reason:
        "AUDIT_EVIDENCE_NO_REFERENCES: the evidence names no file, migration or test that can be checked. " +
        "An incident is cleared by pointing at something that exists, not by asserting that it is fine.",
    };
  }
  const root = repoRoot();
  const missing = referenced.filter((p) => !existsSync(resolve(root, p)));
  if (missing.length > 0) {
    return {
      ok: false,
      referenced,
      missing,
      reason:
        `AUDIT_EVIDENCE_MISSING_FILE: ${missing.join(", ")} — named as mitigation but absent from the tree. ` +
        `This is the exact failure mode that produced a "cleared" incident with no mitigation.`,
    };
  }
  return { ok: true, referenced, missing: [] };
}

function mapRow(r: any): AuditIncidentRow {
  return {
    id: r.id,
    incidentKey: r.incident_key,
    severity: r.severity,
    state: r.state,
    headline: r.headline,
    detail: r.detail,
    scope: r.scope,
    tenantId: r.tenant_id ?? null,
    openedAt: r.opened_at,
    clearedAt: r.cleared_at ?? null,
    clearedBy: r.cleared_by ?? null,
    clearedEvidence: r.cleared_evidence ?? null,
  };
}

export function listIncidents(filter?: { state?: "open" | "cleared" }): AuditIncidentRow[] {
  try {
    const rows = filter?.state
      ? (rawDb()
          .prepare(`SELECT * FROM platform_audit_incident WHERE state = ? ORDER BY opened_at DESC`)
          .all(filter.state) as any[])
      : (rawDb()
          .prepare(`SELECT * FROM platform_audit_incident ORDER BY state = 'cleared', opened_at DESC`)
          .all() as any[]);
    return rows.map(mapRow);
  } catch (err) {
    log.warn(`[w15-audit] listIncidents failed: ${String(err)}`);
    return [];
  }
}

export function openIncident(args: {
  incidentKey: string;
  severity: AuditIncidentRow["severity"];
  headline: string;
  detail: string;
  scope?: AuditIncidentRow["scope"];
  tenantId?: string | null;
}): string {
  const id = `pai_${randomUUID()}`;
  rawDb()
    .prepare(
      `INSERT INTO platform_audit_incident
         (id, incident_key, severity, state, headline, detail, scope, tenant_id, opened_at)
       VALUES (?,?,?,'open',?,?,?,?,?)
       ON CONFLICT(incident_key) DO UPDATE SET
         severity=excluded.severity, headline=excluded.headline, detail=excluded.detail`,
    )
    .run(
      id,
      args.incidentKey,
      args.severity,
      args.headline,
      args.detail,
      args.scope ?? "platform",
      args.tenantId ?? null,
      new Date().toISOString(),
    );
  const row = rawDb()
    .prepare(`SELECT id FROM platform_audit_incident WHERE incident_key = ?`)
    .get(args.incidentKey) as { id: string } | undefined;
  return row?.id ?? id;
}

/**
 * Clear an incident. Refuses unless the evidence is verifiable AND verified.
 *
 * @throws {AuditIncidentError} AUDIT_INCIDENT_NOT_FOUND
 * @throws {AuditIncidentError} AUDIT_EVIDENCE_NO_REFERENCES / AUDIT_EVIDENCE_MISSING_FILE
 * @throws {AuditIncidentError} AUDIT_LIVE_SIGNAL_STILL_FAILING when the caller
 *   supplies a live-signal probe that is still red. A durable clear must never
 *   silence a condition that is still true.
 */
export function clearIncident(args: {
  incidentKey: string;
  clearedBy: string;
  evidence: string;
  /**
   * The live probe result. `false` REJECTS the clear. `null` also rejects it:
   * "could not verify" is not "verified", and treating an unavailable verifier
   * as healthy is the precise shape of the bug where a genuine schema break was
   * downgraded to a warning and CI exited 0. `undefined` means the caller is
   * not supplying a probe at all (evidence-only clear, e.g. a non-chain
   * incident).
   */
  liveSignalOk?: boolean | null;
  /** Free-text provenance for the probe, appended to the stored evidence. */
  liveSignalDetail?: string;
}): AuditIncidentRow {
  const existing = rawDb()
    .prepare(`SELECT * FROM platform_audit_incident WHERE incident_key = ?`)
    .get(args.incidentKey) as any;
  if (!existing) {
    throw new AuditIncidentError("AUDIT_INCIDENT_NOT_FOUND", `AUDIT_INCIDENT_NOT_FOUND: ${args.incidentKey}`);
  }
  if (!args.clearedBy || !args.clearedBy.trim()) {
    throw new AuditIncidentError("AUDIT_CLEARED_BY_REQUIRED", "AUDIT_CLEARED_BY_REQUIRED: name the actor clearing the incident.");
  }
  const v = verifyEvidenceReferences(args.evidence ?? "");
  if (!v.ok) {
    throw new AuditIncidentError(v.missing.length ? "AUDIT_EVIDENCE_MISSING_FILE" : "AUDIT_EVIDENCE_NO_REFERENCES", v.reason!);
  }
  if (args.liveSignalOk === false || args.liveSignalOk === null) {
    throw new AuditIncidentError(
      "AUDIT_LIVE_SIGNAL_STILL_FAILING",
      "AUDIT_LIVE_SIGNAL_STILL_FAILING: the live audit-chain check is still red or " +
        "could not be evaluated. Clearing the durable record now would leave the " +
        `banner on and the record lying. Probe: ${args.liveSignalDetail ?? "(none supplied)"}`,
    );
  }
  /* The probe result is stored WITH the evidence, so a future reader can see
     what was true at the moment of the clear rather than taking the clear on
     trust. `cleared_evidence` has a >= 20 char DB CHECK; appending only ever
     lengthens it. */
  const storedEvidence =
    args.liveSignalDetail && args.liveSignalDetail.trim()
      ? `${args.evidence}\n[live-probe] ${args.liveSignalDetail.trim()}`
      : args.evidence;
  rawDb()
    .prepare(
      `UPDATE platform_audit_incident
          SET state='cleared', cleared_at=?, cleared_by=?, cleared_evidence=?
        WHERE incident_key=?`,
    )
    .run(new Date().toISOString(), args.clearedBy.trim(), storedEvidence, args.incidentKey);
  const row = rawDb()
    .prepare(`SELECT * FROM platform_audit_incident WHERE incident_key = ?`)
    .get(args.incidentKey) as any;
  return mapRow(row);
}

export interface BannerState {
  incident: boolean;
  /** Which signal(s) raised it. Never a bare boolean with no provenance. */
  sources: Array<"live_chain_check" | "durable_open_incident">;
  openIncidents: AuditIncidentRow[];
  liveChainOk: boolean | null;
}

/**
 * The banner state an admin surface should render. OR of the live signal and
 * the durable open rows, with the sources named so "why is the banner on?" is
 * answerable from the payload.
 *
 * @param liveChainOk pass the result of the live chain check, or null when it
 *   could not be evaluated. `null` is NOT treated as healthy.
 */
export function platformBannerState(liveChainOk: boolean | null): BannerState {
  const open = listIncidents({ state: "open" });
  const sources: BannerState["sources"] = [];
  if (liveChainOk === false) sources.push("live_chain_check");
  if (open.length > 0) sources.push("durable_open_incident");
  return { incident: sources.length > 0, sources, openIncidents: open, liveChainOk };
}
