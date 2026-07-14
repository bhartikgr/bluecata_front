/**
 * W2 A7 (v26.2.0-w2) — Collective legal / indemnity copy loader.
 *
 * Ozan supplies final indemnity/assumption-of-vetting copy (his decision:
 * "You supply final copy"). Until then we serve an explicit placeholder marked
 * NON_LEGAL_ADVICE. User-supplied copy is read from the COLLECTIVE_LEGAL_COPY_JSON
 * env var (a JSON object keyed by slot). Malformed JSON must NOT crash Collective
 * pages — we log, mark the slot `degraded:true`, and serve the placeholder.
 *
 * Sacred-free, additive, no payments/Airwallex, no DB writes.
 */
import {
  type CollectiveLegalCopy,
  type CollectiveLegalCopySlot,
  COLLECTIVE_LEGAL_COPY_SLOTS,
} from "@shared/collectiveLegalCopy";
import { log } from "./lib/logger";

const PLACEHOLDER_VERSION = "PLACEHOLDER-v0.1";
const PLACEHOLDER_BODY =
  "Placeholder copy pending counsel review. This is not legal advice. " +
  "Capavate does not independently verify the accredited-investor status, KYC/AML, " +
  "or eligibility of Collective members; each member is responsible for their own " +
  "compliance and representations.";

const PLACEHOLDER_TITLES: Record<CollectiveLegalCopySlot, string> = {
  collective_gate_indemnity: "Before you enter Collective",
  accreditation_declaration_indemnity: "Accredited-investor self-declaration",
  profile_kyc_indemnity: "Optional KYC documents",
};

function placeholder(slot: CollectiveLegalCopySlot, degraded = false): CollectiveLegalCopy {
  return {
    slot,
    version: PLACEHOLDER_VERSION,
    status: "NON_LEGAL_ADVICE",
    title: PLACEHOLDER_TITLES[slot],
    body: PLACEHOLDER_BODY,
    updatedAt: null,
    ...(degraded ? { degraded: true } : {}),
  };
}

/** Parse the env JSON once per call (cheap; env may be swapped without restart in tests). */
function loadSuppliedMap(): { map: Record<string, unknown> | null; degraded: boolean } {
  const raw = process.env.COLLECTIVE_LEGAL_COPY_JSON;
  if (!raw || !raw.trim()) return { map: null, degraded: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { map: parsed as Record<string, unknown>, degraded: false };
    }
    log.warn("[collectiveLegalCopyStore] COLLECTIVE_LEGAL_COPY_JSON is not an object; serving placeholders.");
    return { map: null, degraded: true };
  } catch (err) {
    log.warn(
      "[collectiveLegalCopyStore] COLLECTIVE_LEGAL_COPY_JSON is malformed JSON; serving placeholders. -",
      (err as Error).message,
    );
    return { map: null, degraded: true };
  }
}

export function getCollectiveLegalCopy(slot: CollectiveLegalCopySlot): CollectiveLegalCopy {
  const { map, degraded } = loadSuppliedMap();
  if (!map) return placeholder(slot, degraded);
  const supplied = map[slot];
  if (supplied && typeof supplied === "object") {
    const s = supplied as Record<string, unknown>;
    const title = typeof s.title === "string" ? s.title : PLACEHOLDER_TITLES[slot];
    const body = typeof s.body === "string" ? s.body : PLACEHOLDER_BODY;
    const version = typeof s.version === "string" ? s.version : "SUPPLIED-v1";
    // Only allow COUNSEL_APPROVED when explicitly set; default remains cautious.
    const status: CollectiveLegalCopy["status"] =
      s.status === "COUNSEL_APPROVED" ? "COUNSEL_APPROVED" : "NON_LEGAL_ADVICE";
    const updatedAt = typeof s.updatedAt === "string" ? s.updatedAt : null;
    return { slot, version, status, title, body, updatedAt };
  }
  return placeholder(slot, false);
}

export function getCollectiveLegalCopyBundle(
  slots: CollectiveLegalCopySlot[],
): Record<CollectiveLegalCopySlot, CollectiveLegalCopy> {
  const out = {} as Record<CollectiveLegalCopySlot, CollectiveLegalCopy>;
  const requested = slots.length ? slots : COLLECTIVE_LEGAL_COPY_SLOTS;
  for (const slot of requested) out[slot] = getCollectiveLegalCopy(slot);
  return out;
}
