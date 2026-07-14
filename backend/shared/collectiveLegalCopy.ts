/**
 * W2 A7 (v26.2.0-w2) — Collective legal / indemnity copy slots.
 *
 * Browser-safe, sacred-free shared types. The actual copy is loaded server-side
 * (see server/collectiveLegalCopyStore.ts) with a placeholder fallback that is
 * EXPLICITLY flagged NON_LEGAL_ADVICE until counsel supplies final text. This
 * module holds ONLY types + slot ids so both client and server agree on shape.
 */

export type CollectiveLegalCopySlot =
  | "collective_gate_indemnity"
  | "accreditation_declaration_indemnity"
  | "profile_kyc_indemnity";

export const COLLECTIVE_LEGAL_COPY_SLOTS: CollectiveLegalCopySlot[] = [
  "collective_gate_indemnity",
  "accreditation_declaration_indemnity",
  "profile_kyc_indemnity",
];

export interface CollectiveLegalCopy {
  slot: CollectiveLegalCopySlot;
  version: string;
  /** NON_LEGAL_ADVICE until Ozan/counsel supplies final copy, then COUNSEL_APPROVED. */
  status: "NON_LEGAL_ADVICE" | "COUNSEL_APPROVED";
  title: string;
  body: string;
  updatedAt: string | null;
  /** True when user-supplied config was present but malformed (served placeholder). */
  degraded?: boolean;
}

export function isCollectiveLegalCopySlot(v: unknown): v is CollectiveLegalCopySlot {
  return typeof v === "string" && (COLLECTIVE_LEGAL_COPY_SLOTS as string[]).includes(v);
}
