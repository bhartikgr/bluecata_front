/**
 * Sprint 13 — Shared canonical sync primitives.
 *
 * Every entity schema imports from here. Privacy filter, conflict-resolver
 * rules, and the round-trip contract live in this file.
 */
import { z } from "zod";

/* --------------------------------------------------------------------- */
/*                       Source-of-truth (SOT) types                     */
/* --------------------------------------------------------------------- */

export type Sot =
  | "capavate" // Capavate authoritative
  | "collective" // Collective authoritative
  | "shared" // both write — last-writer-wins by occurredAt
  | "derived"; // computed downstream — never replicated raw

/** Declarative field policy used by the conflict resolver + privacy filter. */
export interface FieldPolicy<T = unknown> {
  /** Source of truth — drives conflict resolution. */
  sot: Sot;
  /** Privacy rule label (VIS-1..10) — when set, field is stripped on outbound. */
  privacy?: string;
  /** When true, this field is computed locally and never accepted from inbound. */
  derived?: boolean;
  /** Default value when missing. */
  default?: T;
}

/** Audience type used by `applyVisibilityFilter`. */
export type Audience =
  | "collective_public" // cap-table-gated peers, MIM panels, social
  | "collective_dsc" // DSC committee + admin
  | "collective_admin" // platform admin only
  | "internal"; // never leaves Capavate

/* --------------------------------------------------------------------- */
/*                        Privacy filter machinery                       */
/* --------------------------------------------------------------------- */

/**
 * Strips fields whose `privacy` rule does not allow the given audience.
 * VIS-1..10 rules are encoded directly here.
 */
export function shouldStripField(privacy: string | undefined, audience: Audience): boolean {
  if (!privacy) return false;
  switch (privacy) {
    case "VIS-1": // PII never leaves Capavate
      return audience !== "internal";
    case "VIS-2": // real names → screenName for non-cap-table audiences
      return audience === "collective_public";
    case "VIS-3": // co-member visibility opt-in
      return audience === "collective_public";
    case "VIS-4": // DSC scores visible to DSC committee + admin only
      return audience !== "collective_dsc" && audience !== "collective_admin" && audience !== "internal";
    case "VIS-5": // ledger entries never replicated
      return audience !== "internal";
    case "VIS-6": // dataroom file bytes never replicated
      return audience !== "internal";
    case "VIS-7": // soft-circle amounts founder-private
      return audience === "collective_public";
    case "VIS-8": // burn rate never shared
      return audience !== "internal";
    case "VIS-9": // commitments private
      return audience === "collective_public";
    case "VIS-10":
      return audience === "collective_public";
    default:
      return false;
  }
}

export function filterPayloadByPolicy<T extends Record<string, unknown>>(
  payload: T,
  policies: Record<string, FieldPolicy>,
  audience: Audience,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) {
    const p = policies[k];
    if (p && shouldStripField(p.privacy, audience)) continue;
    out[k] = payload[k as keyof T];
  }
  return out as Partial<T>;
}

/* --------------------------------------------------------------------- */
/*                        Conflict resolver core                         */
/* --------------------------------------------------------------------- */

export interface ConflictInputs<T> {
  local: T;
  remote: Partial<T>;
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
  policies: Record<string, FieldPolicy>;
}

export interface ConflictResolution<T> {
  merged: T;
  conflicts: Array<{
    field: string;
    chose: "local" | "remote" | "rejected_derived";
    reason: string;
  }>;
}

/**
 * Generic SOT-aware merge. Per audit §13:
 *   - sot=capavate → local always wins
 *   - sot=collective → remote always wins
 *   - sot=derived → remote rejected (locally recomputed)
 *   - sot=shared → last-writer-wins by occurredAt timestamp
 */
export function resolveConflicts<T extends Record<string, unknown>>(
  inp: ConflictInputs<T>,
): ConflictResolution<T> {
  const { local, remote, localUpdatedAt, remoteUpdatedAt, policies } = inp;
  const merged: Record<string, unknown> = { ...local };
  const conflicts: ConflictResolution<T>["conflicts"] = [];

  for (const k of Object.keys(remote)) {
    const policy = policies[k] ?? { sot: "shared" as const };
    const remoteVal = (remote as Record<string, unknown>)[k];
    const localVal = (local as Record<string, unknown>)[k];

    if (policy.sot === "capavate") {
      conflicts.push({ field: k, chose: "local", reason: "sot=capavate" });
      continue;
    }
    if (policy.derived || policy.sot === "derived") {
      conflicts.push({ field: k, chose: "rejected_derived", reason: "field is derived" });
      continue;
    }
    if (policy.sot === "collective") {
      merged[k] = remoteVal;
      conflicts.push({ field: k, chose: "remote", reason: "sot=collective" });
      continue;
    }
    // shared → LWW
    const remoteNewer =
      !!remoteUpdatedAt &&
      (!localUpdatedAt || new Date(remoteUpdatedAt).getTime() >= new Date(localUpdatedAt).getTime());
    if (remoteNewer) {
      merged[k] = remoteVal;
      conflicts.push({ field: k, chose: "remote", reason: "shared LWW remote newer" });
    } else if (localVal === undefined) {
      merged[k] = remoteVal;
      conflicts.push({ field: k, chose: "remote", reason: "local empty" });
    } else {
      conflicts.push({ field: k, chose: "local", reason: "shared LWW local newer" });
    }
  }
  return { merged: merged as T, conflicts };
}

/* --------------------------------------------------------------------- */
/*                         Common envelope schema                        */
/* --------------------------------------------------------------------- */

export const TraceEntrySchema = z.object({
  formulaId: z.string(),
  version: z.string(),
  region: z.string(),
  defHash: z.string(),
});

export const EnvelopeSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  aggregateId: z.string(),
  aggregateKind: z.enum(["company", "investor", "round", "platform"]),
  occurredAt: z.string(),
  tenantId: z.string(),
  actor: z.object({ userId: z.string(), ip: z.string().optional() }),
  payload: z.record(z.unknown()),
  trace: z.array(TraceEntrySchema),
  auditChain: z.object({ priorHash: z.string(), hash: z.string() }),
  schemaVersion: z.literal("1.0"),
});

export type CanonicalEnvelope = z.infer<typeof EnvelopeSchema>;
