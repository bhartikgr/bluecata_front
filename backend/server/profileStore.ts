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
// Avi 22-May Issue 1 — third-tier fallback: synthesise an empty profile so a
// brand-new founder (or a freshly-created company) does not lock the Company
// page on an infinite "Loading company profile…" spinner.
import { makeEmptyCompanyProfile } from "./lib/emptyCompanyProfile";
// v24.1 Bug E — synthesise an empty investor profile for the authenticated
// investor when no row exists yet (e.g. runtime-redeemed investors).
import { makeEmptyInvestorProfile } from "./lib/emptyInvestorProfile";
import { getDb, rawDb } from "./db/connection";
import { companies as companiesTable } from "../shared/schema";
import { eq, isNull, and } from "drizzle-orm";
import { log as profileLog } from "./lib/logger";

/* ---------------- Stores ---------------- */
const companyProfiles = new Map<string, CompanyProfile>();
const investorProfiles = new Map<string, InvestorProfile>();

/* ------------------------------------------------------------------ */
/* v24.2 Bug 6 — durable persistence for the profileStore CompanyProfile */
/*                                                                     */
/* Previously PATCH /api/companies/:id/profile only wrote the rich      */
/* CompanyProfile into the in-memory `companyProfiles` Map, so any      */
/* process restart reverted a founder's saved sector/contact/legal      */
/* edits. We now write-through to a dedicated side table FIRST; only    */
/* when the durable write succeeds do we update the cache, and a DB     */
/* failure surfaces as a 500 (no silent cache/DB divergence).           */
/* ------------------------------------------------------------------ */

/** Persist a CompanyProfile durably. Throws on DB failure (route → 500). */
function writeProfileDurable(companyId: string, profile: CompanyProfile): void {
  const db = rawDb();
  db.prepare(
    `INSERT INTO profilestore_company_profile (company_id, tenant_id, profile_json, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(company_id) DO UPDATE SET
       tenant_id = excluded.tenant_id,
       profile_json = excluded.profile_json,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run(companyId, profile.tenantId ?? "tenant_unknown", JSON.stringify(profile), new Date().toISOString());
}

/** Read a durably-stored CompanyProfile, or null if none/parse failure. */
function readProfileDurable(companyId: string): CompanyProfile | null {
  try {
    const db = rawDb();
    const row = db.prepare(
      `SELECT profile_json FROM profilestore_company_profile WHERE company_id = ? AND deleted_at IS NULL`,
    ).get(companyId) as { profile_json?: string } | undefined;
    if (!row?.profile_json) return null;
    return JSON.parse(row.profile_json) as CompanyProfile;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* v24.4.1 — durable persistence for investorProfiles                  */
/*                                                                     */
/* Mirrors writeProfileDurable/readProfileDurable. The investorProfiles */
/* Map was pure-RAM through v24.4: every server restart wiped investor */
/* edits (privacy, KYC, accreditation). This closes that gap.          */
/* ------------------------------------------------------------------ */

/** Persist an InvestorProfile durably. Logged on failure; cache stays in sync. */
function writeInvestorProfileDurable(investorId: string, profile: InvestorProfile): void {
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO profilestore_investor_profile (investor_id, profile_json, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL)
       ON CONFLICT(investor_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    ).run(investorId, JSON.stringify(profile), new Date().toISOString());
  } catch (err) {
    profileLog.warn("[profileStore] investor write-through failed:", (err as Error).message);
  }
}

/** Read a durably-stored InvestorProfile, or null if none/parse failure. */
function readInvestorProfileDurable(investorId: string): InvestorProfile | null {
  try {
    const db = rawDb();
    const row = db.prepare(
      `SELECT profile_json FROM profilestore_investor_profile WHERE investor_id = ? AND deleted_at IS NULL`,
    ).get(investorId) as { profile_json?: string } | undefined;
    if (!row?.profile_json) return null;
    return JSON.parse(row.profile_json) as InvestorProfile;
  } catch {
    return null;
  }
}

/** v24.4.1 — rebuild the investorProfiles cache from durable rows on boot. */
export async function hydrateProfileStore(): Promise<void> {
  try {
    const db = rawDb();
    // Investor profiles. (Company profiles are already loaded on demand via
    // readProfileDurable; no eager hydration needed.)
    const rows = db
      .prepare(`SELECT investor_id, profile_json FROM profilestore_investor_profile WHERE deleted_at IS NULL`)
      .all() as Array<{ investor_id: string; profile_json: string }>;
    // Don't clear() — SEED_INVESTOR_PROFILE was set at module load and may
    // already be in the Map. Just overlay durable rows on top so any DB row
    // wins over the seed for the same id.
    for (const r of rows) {
      try {
        investorProfiles.set(r.investor_id, JSON.parse(r.profile_json) as InvestorProfile);
      } catch (parseErr) {
        profileLog.warn(`[hydrate] profileStore: skipping investor ${r.investor_id} — ${(parseErr as Error).message}`);
      }
    }
    if (rows.length > 0) {
      profileLog.info(`[hydrate] profileStore: ${rows.length} investor profiles loaded`);
    }
  } catch (err) {
    profileLog.warn("[hydrate] profileStore: DB read failed:", (err as Error).message);
  }
}

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
  // v14 (Tier-1 Fix 1) — actor identity comes ONLY from session userContext.
  // x-actor-id header and ?actorId= query are no longer trusted.
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  const actorId = ctx?.userId;
  if (!actorId) {
    const err: Error & { status?: number } = new Error("missing_identity");
    err.status = 401;
    throw err;
  }
  return { actorId, ip: req.ip };
}

/* ---------------- Route registration ---------------- */

export function registerProfileRoutes(app: Express): void {
  /* ----- COMPANY PROFILE ----- */

  // Sprint 18 Phase 2 — T3.4 M&A Readiness summary endpoint.
  app.get("/api/companies/:id/ma-readiness", (req, res) => {
    const id = req.params.id;
    const p = companyProfiles.get(id);
    if (!p) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${id} not found.` });
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
    // Avi 22-May Issue 1 — guard against accidental empty-id requests caused
    // by the client firing the query before useActiveCompanyId resolves. The
    // route pattern already forbids the empty case (Express never matches
    // /api/companies//profile against the `:id` placeholder — it 404s before
    // reaching us) but we keep this defensive check for parity tests.
    if (!id || id.trim() === "") {
      return res.status(400).json({ message: "companyId required" });
    }
    // v24.4 Bug D — DB-FIRST read precedence.
    //
    // Precedence (highest to lowest):
    //   1. Durable DB row (profilestore_company_profile) — the source of truth
    //      for any profile a founder has actually saved, including the seeded
    //      `co-fixture` company. This MUST win over the in-memory seed so real
    //      edits are never masked by SEED_COMPANY_PROFILE after a restart.
    //   2. In-memory cache / seed map (companyProfiles) — preserves the
    //      co-fixture demo profile when no durable row exists yet.
    //   3. Legacy companyProfileStore fallback (below).
    //   4. Synthesised empty profile for a known-but-unprofiled company (below).
    //
    // Prior to v24.4 the in-memory map was read FIRST, so a durable saved row
    // for a seeded company (e.g. co-fixture) was masked by the seed.
    let p: CompanyProfile | undefined;
    const durable = readProfileDurable(id);
    if (durable) {
      // DB wins. Refresh the cache so subsequent GETs stay fast.
      companyProfiles.set(id, durable);
      p = durable;
    } else {
      // No durable row — fall back to the in-memory cache / seed map (preserves
      // co-fixture demo behavior).
      p = companyProfiles.get(id);
    }
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
      // Avi 22-May Issue 1 — third-tier fallback. If the company exists in
      // the `companies` table but neither store has a profile row yet (e.g.
      // freshly-created via POST /api/founder/companies/new, or any
      // production deploy whose seed never populated this Map), synthesise
      // an empty-but-schema-complete CompanyProfile so the Founder Company
      // wizard renders at Step 1 instead of stalling on "Loading…".
      try {
        const db = getDb();
        // CROSS-TENANT (admin) — profile lookup is keyed by company id, not
        // tenant; tenant comes from the row itself. Ownership is enforced
        // separately on PATCH.
        const row = db
          .select({ id: companiesTable.id, tenantId: companiesTable.tenantId, name: companiesTable.name })
          .from(companiesTable)
          .where(and(eq(companiesTable.id, id), isNull(companiesTable.deletedAt)))
          .get() as { id: string; tenantId: string; name: string } | undefined;
        if (row) {
          const seeded = makeEmptyCompanyProfile({
            id: row.id,
            tenantId: row.tenantId,
            companyName: row.name,
          });
          // Cache in the Map so subsequent reads stay fast AND so the PATCH
          // handler (which reads `companyProfiles.get(id)`) sees a base
          // object to merge into. This is a read-through cache pattern;
          // the legacy hydrate path is untouched.
          companyProfiles.set(id, seeded);
          const score = computeMaReadinessScore(seeded.ma);
          return res.json({ ...seeded, maScore: score, source: "synthesised_empty" });
        }
      } catch (err) {
        profileLog.warn("[profileStore.getCompanyProfile] companies lookup failed:", (err as Error).message);
      }
      return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${id} not found.` });
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
    // v24.2 Bug 6 — durable read-through so a PATCH after a restart merges into
    // the founder's last-saved profile rather than 404ing on a cold cache.
    let current = companyProfiles.get(id);
    if (!current) {
      const durable = readProfileDurable(id);
      if (durable) {
        companyProfiles.set(id, durable);
        current = durable;
      }
    }
    if (!current) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${id} not found.` });

    // v14 Tier-1 Fix 2 — ownership: founder of this company or admin only.
    const ctxOwn = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean; founder?: { companies: { companyId: string }[] } } }).userContext;
    if (!ctxOwn?.userId) return res.status(401).json({ message: "missing_identity" });
    const ownsCompany = ctxOwn.isAdmin || (ctxOwn.founder?.companies ?? []).some((c) => c.companyId === id);
    if (!ownsCompany) return res.status(403).json({ message: "not_authorized" });

    const parsed = companyProfilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      // v23.4.5 Phase 7 — normalise zod issues into `{ field: "message" }` so
      // the client can render inline field errors without parsing zod’s raw
      // `issues` shape. Field paths are dot-joined (e.g. `contact.companyName`).
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.length ? issue.path.join(".") : "_root";
        // First error per field wins (matches react-hook-form behaviour).
        if (!(path in errors)) errors[path] = issue.message;
      }
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_FAILED",
        message: "Invalid patch",
        errors,
        issues: parsed.error.issues,
      });
    }

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

    // v24.2 Bug 6 — DB-FIRST write-through. Persist the patched profile to its
    // durable side table BEFORE touching the in-memory cache. If the durable
    // write fails we return 500 and leave the cache untouched, so the client is
    // never told a save succeeded that did not actually persist (the root cause
    // of "edit reverts on reload").
    try {
      writeProfileDurable(id, patched);
    } catch (err) {
      profileLog.error("[profileStore] PATCH /api/companies/:id/profile durable write failed:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "PROFILE_PERSIST_FAILED", message: (err as Error).message });
    }
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
    if (!current) return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${id} not found.` });

    // v14 Tier-1 Fix 2 — ownership: founder of this company or admin only.
    const ctxMa = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean; founder?: { companies: { companyId: string }[] } } }).userContext;
    if (!ctxMa?.userId) return res.status(401).json({ message: "missing_identity" });
    const ownsCo = ctxMa.isAdmin || (ctxMa.founder?.companies ?? []).some((c) => c.companyId === id);
    if (!ownsCo) return res.status(403).json({ message: "not_authorized" });

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
    if (p) return res.json(p);

    // v24.1 Bug E: synthesise + persist a schema-complete blank profile when the
    // AUTHENTICATED INVESTOR owns the requested id. This fixes the infinite
    // skeleton for runtime-redeemed investors who never got an investorProfiles
    // row. Tenant isolation is preserved: only the owner (id === userId) — or an
    // admin — triggers synthesis; everyone else still gets a 404.
    const ctxInv = (req as Request & {
      userContext?: { userId?: string; isAdmin?: boolean; identity?: { email?: string } };
    }).userContext;
    const ownsId = !!ctxInv?.userId && ctxInv.userId === id;
    if (ownsId || ctxInv?.isAdmin) {
      const tenantId = SEED_INVESTOR_PROFILE.tenantId;
      const email = ctxInv?.identity?.email ?? "";
      const synthesized = makeEmptyInvestorProfile(id, tenantId, email);
      // Server-side persistence so subsequent GETs return it without re-synthesis
      // and so the PATCH ownership path finds an existing row.
      investorProfiles.set(id, synthesized);
      writeInvestorProfileDurable(String(id), synthesized);
      return res.json(synthesized);
    }

    return res.status(404).json({ message: "Investor profile not found" });
  });

  app.patch("/api/investors/:id/profile", (req, res) => {
    const id = req.params.id;
    const current = investorProfiles.get(id);
    if (!current) return res.status(404).json({ message: "Investor profile not found" });

    // v14 Tier-1 Fix 2 — ownership: only the profile owner (or admin) may edit.
    const ctxInv = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
    if (!ctxInv?.userId) return res.status(401).json({ message: "missing_identity" });
    if (ctxInv.userId !== id && !ctxInv.isAdmin) return res.status(403).json({ message: "not_authorized" });

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
    writeInvestorProfileDurable(String(id), patched as unknown as InvestorProfile);

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

    // v14 Tier-1 Fix 2 — ownership: only the profile owner (or admin) may edit privacy.
    const ctxPv = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
    if (!ctxPv?.userId) return res.status(401).json({ message: "missing_identity" });
    if (ctxPv.userId !== id && !ctxPv.isAdmin) return res.status(403).json({ message: "not_authorized" });

    const parsed = investorPrivacyPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid privacy patch", issues: parsed.error.issues });

    const patched = applyProfilePatch(current, { visibility: { ...current.visibility, ...parsed.data } });
    patched.updatedAt = nowIso();
    investorProfiles.set(id, patched);
    writeInvestorProfileDurable(String(id), patched as unknown as InvestorProfile);

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
    writeInvestorProfileDurable(String(id), patched as unknown as InvestorProfile);

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
  // v24.2 Bug 6 — merge in-memory + durable, with the durable store taking
  // priority on a cold cache (hydration). When both exist the in-memory copy is
  // authoritative for the current process (it is updated atomically after every
  // successful durable write), so we return it; otherwise fall back to durable.
  const mem = companyProfiles.get(companyId);
  if (mem) return mem;
  const durable = readProfileDurable(companyId);
  if (durable) {
    companyProfiles.set(companyId, durable);
    return durable;
  }
  return null;
}
