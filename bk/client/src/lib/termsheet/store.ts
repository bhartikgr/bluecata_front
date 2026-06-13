/**
 * Sprint 6 in-memory term-sheet + soft-circle e-sig store.
 *
 * Backed by createStore (no persistence; sandbox-safe). Holds:
 *  - per-round generated/uploaded term-sheet drafts
 *  - signed term sheets (with SESSignature + chain)
 *  - soft-circle SES signatures (investor + founder)
 *  - consortium intro requests
 */
import { create } from "@/lib/createStore";
import type { Region, InstrumentValue } from "@shared/schema";
import type { SESSignature } from "@/lib/esign/ses";
import type { UploadedTerms, ReconciliationDiff } from "./templates";
import type { ClauseDescription } from "./types";

export type TermSheetSource = "generated" | "uploaded";
export type TermSheetStatus = "draft" | "signed";

/**
 * Sprint 26 — every section draft carries both the editable clause body AND
 * an editable structured description (what it means / why it matters /
 * common variants / founder watch-outs / citation). Both are persisted
 * server-side via the credentialed save endpoint.
 */
export interface SectionDraft {
  id: string;
  heading: string;
  body: string;       // resolved text — may be edited
  edited: boolean;
  description?: ClauseDescription;
  descriptionEdited?: boolean;
}

export interface TermSheetRecord {
  roundId: string;
  source: TermSheetSource;
  region: Region;
  instrument: InstrumentValue;
  templateId: string;       // e.g. "US-preferred-1.0.0" or "uploaded-<filename>"
  templateName: string;
  sections: SectionDraft[];
  citations: string[];
  status: TermSheetStatus;
  documentHash?: string;    // sha256 of rendered text at sign time
  signature?: SESSignature; // founder's e-sig
  signedAt?: string;
  // upload-specific
  uploadFilename?: string;
  uploadMimeType?: string;
  extractedTerms?: UploadedTerms;
  reconciliation?: ReconciliationDiff[];
  acknowledgedMismatches?: string[]; // field names the founder explicitly acknowledged
  // Sprint 26 — server revision tracking. Set by the credentialed save endpoint.
  revision?: number;        // monotonic per-roundId counter
  revisionHash?: string;    // sha256 of canonical revision body (prev + payload)
  prevRevisionHash?: string; // chain link to the prior revision
  savedAt?: string;         // ISO of the most recent server save
  savedBy?: string;         // user id of the most recent saver
}

export interface ConsortiumRequest {
  id: string;
  roundId: string;
  partnerIds: string[];
  contextMessage: string;
  createdAt: string;
}

export interface SoftCircleSignature {
  softCircleId: string;
  roundId: string;
  invitationId?: string;
  signature: SESSignature;
  founderConfirmation?: SESSignature;
  amount: number;
  withdrawn?: boolean;
}

type State = {
  termSheets: Record<string, TermSheetRecord>;       // by roundId
  consortiumRequests: ConsortiumRequest[];
  softCircleSigs: Record<string, SoftCircleSignature>; // by softCircleId
  saveTermSheet: (rec: TermSheetRecord) => void;
  removeTermSheet: (roundId: string) => void;
  addConsortium: (r: ConsortiumRequest) => void;
  saveSoftCircleSig: (s: SoftCircleSignature) => void;
};

export const useTermSheetStore = create<State>((set) => ({
  termSheets: {},
  consortiumRequests: [],
  softCircleSigs: {},
  saveTermSheet: (rec) => set((s) => ({ termSheets: { ...s.termSheets, [rec.roundId]: rec } })),
  removeTermSheet: (roundId) =>
    set((s) => {
      const next = { ...s.termSheets };
      delete next[roundId];
      return { termSheets: next };
    }),
  addConsortium: (r) => set((s) => ({ consortiumRequests: [...s.consortiumRequests, r] })),
  saveSoftCircleSig: (sig) =>
    set((s) => ({ softCircleSigs: { ...s.softCircleSigs, [sig.softCircleId]: sig } })),
}));

export function termSheetForRound(roundId: string): TermSheetRecord | undefined {
  return useTermSheetStore.getState().termSheets[roundId];
}
