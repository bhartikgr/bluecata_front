/**
 * Sprint 8 — In-memory profile store + production-shape PATCH endpoints.
 *
 * This file implements the *server-side* version of the production schemas
 * defined in `client/src/lib/profile/types.ts`. The store is intentionally
 * Map-based — production migration is a one-line swap to Drizzle/Postgres
 * with the same schemas (per the user's "production-shape" mandate).
 *
 * Outbox events emitted on every successful PATCH:
 *   - company.profile.updated
 *   - company.ma_intelligence.updated
 *   - investor.profile.updated
 *   - privacy.visibility.changed
 *   - investor.accreditation.changed
 *   - investor.kyc.uploaded
 *
 * Payload shape: per `capavate_collective_sync_schema.md` §9.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import multer from "multer";
import { z } from "zod";

import {
  companyProfilePatchSchema,
  investorProfilePatchSchema,
  investorPrivacyPatchSchema,
  applyProfilePatch,
  diffChangedFields,
  deriveLegalFields,
  deriveInvestorKycVariant,
  computeMaReadinessScore,
  type CompanyProfile,
  type InvestorProfile,
} from "../client/src/lib/profile/types";
import {
  SEED_COMPANY_PROFILE,
  SEED_INVESTOR_PROFILE,
} from "../client/src/lib/profile/seed";
import { BridgeOutbound } from "./lib/bridgeOutbound";
// V2 (Patch v8): legacy Sprint-29 profile store used as fallback when this
// store has no entry for a companyId (founder PATCH path writes there).
import { getCompanyProfile as getLegacyCompanyProfile } from "./companyProfileStore";

/* ---------------- Stores ---------------- */
const companyProfiles = new Map<string, CompanyProfile>();
const investorProfiles = new Map<string, InvestorProfile>();

companyProfiles.set(SEED_COMPANY_PROFILE.id, SEED_COMPANY_PROFILE);
investorProfiles.set(SEED_INVESTOR_PROFILE.id, SEED_INVESTOR_PROFILE);

/* ---------------- Audit / outbox ---------------- */

interface OutboxEvent {
  eventId: string;
  eventType:
    | "company.profile.updated"
    | "company.ma_intelligence.updated"
    | "investor.profile.updated"
    | "privacy.visibility.changed"
    | "investor.accreditation.changed"
    | "investor.kyc.uploaded";
  aggregateId: string;
  aggregateKind: "company" | "investor";
  occurredAt: string;
  tenantId: string;
  actor: { userId: string; ip?: string };
  payload: Record<string, unknown>;
  changedFields: string[];
  auditChain: { priorHash: string; hash: string };
  schemaVersion: "1.0";
}

const outbox: OutboxEvent[] = [];
const auditEntries: Array<{
  id: string;
  ts: string;
  action: string;
  target: string;
  targetId: string;
  actorId: string;
  payloadJson: string;
  prevHash: string;
  hash: string;
}> = [];

let lastAuditHash = "0".repeat(64);

function appendAudit(action: string, target: string, targetId: string, actorId: string, payload: unknown): { hash: string; prev: string } {
  const id = `audit_${randomBytes(8).toString("hex")}`;
  const ts = new Date().toISOString();
  const prev = lastAuditHash;
  const payloadJson = JSON.stringify(payload);
  const hash = createHash("sha256")
    .update(prev + "|" + id + "|" + action + "|" + target + "|" + targetId + "|" + actorId + "|" + payloadJson + "|" + ts)
    .digest("hex");
  auditEntries.push({ id, ts, action, target, targetId, actorId, payloadJson, prevHash: prev, hash });
  lastAuditHash = hash;
  return { hash, prev };
}

function emitOutbox(
  eventType: OutboxEvent["eventType"],
  aggregateId: string,
  aggregateKind: OutboxEvent["aggregateKind"],
  tenantId: string,
  actorId: string,
  ip: string | undefined,
  payload: Record<string, unknown>,
  changedFields: string[],
) {
  const id = `evt_${randomBytes(10).toString("hex")}`;
  const auditPayload = { eventType, aggregateId, payloadKeys: Object.keys(payload), changedFields };
  const { hash, prev } = appendAudit(eventType, aggregateKind, aggregateId, actorId, auditPayload);
  const evt: OutboxEvent = {
    eventId: id,
    eventType,
    aggregateId,
    aggregateKind,
    occurredAt: new Date().toISOString(),
    tenantId,
    actor: { userId: actorId, ip },
    payload,
    changedFields,
    auditChain: { priorHash: prev, hash },
    schemaVersion: "1.0",
  };
  outbox.push(evt);
  // Cap to last 200 to keep memory bounded in long preview sessions.
  if (outbox.length > 200) outbox.splice(0, outbox.length - 200);

  // Sprint 13 — bridge fan-out for the canonical outbound event types.
  switch (eventType) {
    case "company.profile.updated":
      BridgeOutbound.companyProfileUpdated(aggregateId, { ...payload, changedFields });
      break;
    case "company.ma_intelligence.updated":
      BridgeOutbound.companyMaIntelligenceUpdated(aggregateId, { ...payload, changedFields });
      break;
    case "investor.profile.updated":
      BridgeOutbound.investorProfileUpdated(aggregateId, { ...payload, changedFields });
      break;
    default:
      // Other event types stay local; bridge fan-out happens at their call sites.
      break;
  }
}

/* ---------------- Helpers ---------------- */

function nowIso(): string { return new Date().toISOString(); }

function actorOf(req: Request): { actorId: string; ip: string | undefined } {
  // Production: read the JWT subject from req.user (Auth0 middleware).
  // Preview: trust ?actorId=... or default to the requested resource owner.
  const actorId = String(req.query.actorId ?? req.headers["x-actor-id"] ?? "u_demo");
  return { actorId, ip: req.ip };
}

/* ---------------- Route registration ---------------- */

export function registerProfileRoutes(app: Express): void {
  /* ----- COMPANY PROFILE ----- */

  // Sprint 18 Phase 2 — T3.4 M&A Readiness summary endpoint.
  app.get("/api/companies/:id/ma-readiness", (req, res) => {
    const id = req.params.id;
    const p = companyProfiles.get(id);
    if (!p) return res.status(404).json({ message: "Company not found" });
    const { score, components } = computeMaReadinessScore(p.ma);
    // Synthesize a 30-day history with a slight upward drift towards the current
    // score — a stand-in for production where we'd persist daily snapshots.
    const history: Array<{ ts: string; score: number }> = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const drift = Math.round(score * (0.85 + ((30 - i) / 30) * 0.15));
      history.push({ ts: d.toISOString().slice(0, 10), score: Math.max(0, Math.min(100, drift)) });
    }
    const dimensions = components.map(c => ({
      name: c.label,
      score: Math.round((c.awarded / c.weight) * 100),
      // Synth deltas — production: diff against last week's snapshot.
      deltaPct: Math.round(((c.awarded / c.weight) - 0.5) * 20 * 10) / 10,
    }));
    res.json({ companyId: id, score, history, dimensions });
  });

  app.get("/api/companies/:id/profile", (req, res) => {
    const id = req.params.id;
    const p = companyProfiles.get(id);
    if (!p) {
      // V2 (Patch v8): fall back to the Sprint 29 companyProfileStore so a
      // founder edit (which writes to that store) is visible to investors
      // hitting this endpoint. Phase 1 B2 root cause: profile drift between
      // the two stores. The adapter normalizes the alt-shape to the minimum
      // fields this endpoint emits; deeper fields default to safe values.
      const legacy = getLegacyCompanyProfile(id) as any;
      if (legacy && (legacy.description || legacy.tagline)) {
        return res.json({
          id,
          companyId: id,
          description: legacy.description ?? "",
          tagline: legacy.tagline ?? "",
          sector: legacy.sector ?? null,
          stage: legacy.stage ?? null,
          logoUrl: legacy.logoUrl ?? null,
          version: legacy.version ?? 0,
          updatedAt: legacy.updatedAt ?? null,
          source: "companyProfileStore",
        });
      }
      return res.status(404).json({ message: "Company profile not found" });
    }
    const role = String(req.query.as ?? "founder");
    const score = computeMaReadinessScore(p.ma);
    if (role === "investor" || role === "viewer") {
      // Strip Capavate-private fields before returning to non-owners.
      const { contact, ...rest } = p;
      const sanitisedContact = {
        ...contact,
        // PII redaction per sync schema §3.1
        companyEmail: "",
        phoneNumber: "",
      };
      return res.json({ ...rest, contact: sanitisedContact, maScore: score });
    }
    return res.json({ ...p, maScore: score });
  });

  app.patch("/api/companies/:id/profile", (req, res) => {
    const id = req.params.id;
    const current = companyProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Company profile not found" });

    const parsed = companyProfilePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid patch", issues: parsed.error.issues });

    // Reject read-only mutations on Auth0-driven fields. companyEmail can be
    // changed by founder, but tenantId and id are immutable.
    if ((req.body as Record<string, unknown>)?.id || (req.body as Record<string, unknown>)?.tenantId) {
      return res.status(403).json({ message: "id and tenantId are read-only" });
    }

    const patched = applyProfilePatch(current, parsed.data);

    // Re-derive legal fields whenever the country changes.
    if (patched.legal.countryOfIncorporationCode !== current.legal.countryOfIncorporationCode) {
      const derived = deriveLegalFields(patched.legal.countryOfIncorporationCode);
      patched.legal = { ...patched.legal, ...derived };
    }

    patched.updatedAt = nowIso();
    companyProfiles.set(id, patched);

    const changedFields = diffChangedFields(current, patched);
    const { actorId, ip } = actorOf(req);

    // Emit company.profile.updated.
    emitOutbox(
      "company.profile.updated",
      id, "company", patched.tenantId, actorId, ip,
      { profile: patched, prior: current },
      changedFields,
    );

    // If any M&A field changed, ALSO emit the more specific event.
    const maChanged = changedFields.some(f => f.startsWith("ma."));
    if (maChanged) {
      emitOutbox(
        "company.ma_intelligence.updated",
        id, "company", patched.tenantId, actorId, ip,
        { ma: patched.ma, score: computeMaReadinessScore(patched.ma).score },
        changedFields.filter(f => f.startsWith("ma.")),
      );
    }

    return res.json({ ...patched, maScore: computeMaReadinessScore(patched.ma) });
  });

  app.patch("/api/companies/:id/ma-intelligence", (req, res) => {
    const id = req.params.id;
    const current = companyProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Company profile not found" });

    const parsed = companyProfilePatchSchema.shape.ma.unwrap().partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid M&A patch", issues: parsed.error.issues });

    const patched = applyProfilePatch(current, { ma: { ...current.ma, ...parsed.data } });
    patched.updatedAt = nowIso();
    companyProfiles.set(id, patched);

    const changedFields = diffChangedFields(current, patched).filter(f => f.startsWith("ma."));
    const { actorId, ip } = actorOf(req);

    emitOutbox(
      "company.ma_intelligence.updated",
      id, "company", patched.tenantId, actorId, ip,
      { ma: patched.ma, score: computeMaReadinessScore(patched.ma).score },
      changedFields,
    );

    return res.json({ ...patched, maScore: computeMaReadinessScore(patched.ma) });
  });

  /* ----- INVESTOR PROFILE ----- */

  app.get("/api/investors/:id/profile", (req, res) => {
    const id = req.params.id;
    const p = investorProfiles.get(id);
    if (!p) return res.status(404).json({ message: "Investor profile not found" });
    return res.json(p);
  });

  app.patch("/api/investors/:id/profile", (req, res) => {
    const id = req.params.id;
    const current = investorProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Investor profile not found" });

    const parsed = investorProfilePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid patch", issues: parsed.error.issues });

    // Email is read-only (set at Auth0 invitation redemption).
    if (parsed.data.contact?.email && parsed.data.contact.email !== current.contact.email) {
      return res.status(403).json({ message: "email is read-only — set by Auth0 at invitation redemption" });
    }

    const patched = applyProfilePatch(current, parsed.data);

    // Re-derive KYC variant when the tax-residency country changes.
    if (patched.profile.countryOfTaxResidencyCode !== current.profile.countryOfTaxResidencyCode) {
      patched.profile = { ...patched.profile, kycVariant: deriveInvestorKycVariant(patched.profile.countryOfTaxResidencyCode) };
    }

    // Sync screenNameSet derived flag with the role.screenName.
    const sn = (patched.role.screenName ?? "").toString().trim();
    patched.visibility = { ...patched.visibility, screenNameSet: sn.length > 0 };

    // Accreditation transition: clear verified flag when status changes.
    const accreditationChanged = patched.profile.accreditedStatus !== current.profile.accreditedStatus;
    if (accreditationChanged) {
      patched.profile.accreditationVerified = false;
      patched.profile.accreditationVerifiedAt = null;
    }

    patched.updatedAt = nowIso();
    investorProfiles.set(id, patched);

    const changedFields = diffChangedFields(current, patched);
    const { actorId, ip } = actorOf(req);

    emitOutbox(
      "investor.profile.updated",
      id, "investor", patched.tenantId, actorId, ip,
      { profile: patched, prior: current },
      changedFields,
    );

    if (accreditationChanged) {
      emitOutbox(
        "investor.accreditation.changed",
        id, "investor", patched.tenantId, actorId, ip,
        { from: current.profile.accreditedStatus, to: patched.profile.accreditedStatus },
        ["profile.accreditedStatus", "profile.accreditationVerified"],
      );
    }

    if (changedFields.some(f => f.startsWith("visibility."))) {
      emitOutbox(
        "privacy.visibility.changed",
        id, "investor", patched.tenantId, actorId, ip,
        { visibility: patched.visibility },
        changedFields.filter(f => f.startsWith("visibility.") || f === "role.screenName"),
      );
    }

    return res.json(patched);
  });

  app.patch("/api/investors/:id/privacy", (req, res) => {
    const id = req.params.id;
    const current = investorProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Investor profile not found" });

    const parsed = investorPrivacyPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid privacy patch", issues: parsed.error.issues });

    const patched = applyProfilePatch(current, { visibility: { ...current.visibility, ...parsed.data } });
    patched.updatedAt = nowIso();
    investorProfiles.set(id, patched);

    const changedFields = diffChangedFields(current, patched);
    const { actorId, ip } = actorOf(req);

    emitOutbox(
      "privacy.visibility.changed",
      id, "investor", patched.tenantId, actorId, ip,
      { visibility: patched.visibility },
      changedFields,
    );

    return res.json(patched);
  });

  /* ----- KYC upload ----- */
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 10 } });

  app.post("/api/investors/:id/kyc", upload.array("files", 10), (req: Request, res: Response) => {
    const id = req.params.id;
    const current = investorProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Investor profile not found" });

    type MulterReq = Request & { files?: Array<{ originalname: string; size: number; buffer: Buffer; mimetype: string }> };
    const r = req as MulterReq;
    const files = r.files ?? [];
    if (files.length === 0) return res.status(400).json({ message: "No files uploaded" });

    const newDocs = files.map(f => ({
      name: f.originalname,
      sizeBytes: f.size,
      sha256: createHash("sha256").update(f.buffer).digest("hex"),
      uploadedAt: nowIso(),
    }));

    const patched: InvestorProfile = {
      ...current,
      profile: {
        ...current.profile,
        kycDocuments: [...current.profile.kycDocuments, ...newDocs],
      },
      updatedAt: nowIso(),
    };
    investorProfiles.set(id, patched);

    const { actorId, ip } = actorOf(req);
    emitOutbox(
      "investor.kyc.uploaded",
      id, "investor", patched.tenantId, actorId, ip,
      { added: newDocs },
      newDocs.map((_, i) => `profile.kycDocuments[${current.profile.kycDocuments.length + i}]`),
    );

    return res.json({ ok: true, added: newDocs, profile: patched });
  });

  /* ----- READ HELPERS for telemetry / audit visibility ----- */

  app.get("/api/dev/profile-outbox", (_req, res) => res.json(outbox.slice(-50)));
  app.get("/api/dev/profile-audit", (_req, res) => res.json(auditEntries.slice(-50)));

  /* ----- Idempotency-Key support (production-shape) ----- */
  // Production: a real middleware would dedupe by key + (route + body-hash).
  // For preview, we expose a no-op endpoint that confirms the header is read.
  app.get("/api/dev/idempotency-echo", (req, res) => {
    res.json({ idempotencyKey: req.header("Idempotency-Key") ?? null });
  });
}

/* Export accessors so other server modules + tests can introspect. */
export const _testAccess = { companyProfiles, investorProfiles, outbox, auditEntries };

/* V7 (Patch v8): Public scoped reader replacing _testAccess.companyProfiles.get(id)
 * for production callers (routes.ts). Returns the in-memory profileStore entry,
 * or null if not present. Callers should fall back to companyProfileStore.getCompanyProfile
 * for legacy entries (see GET /api/companies/:id/profile fallback).
 */
export function getCompanyProfileSnapshot(companyId: string): unknown | null {
  return companyProfiles.get(companyId) ?? null;
}
