/**
 * ============================================================================
 * Wave C-2.e / D3 — re-export shim for `runWaveC2PipelineKvBackfill`
 * ============================================================================
 *
 * WHY THIS FILE EXISTS (D1/D3 integration reconciliation — logged as assumption
 * D3-LOC1 in the Wave C-2 apply report):
 *
 * The D3 deliverable's own header and `ASSUMPTIONS_D3.md:4` both declare its
 * apply path as `server/db/backfills/runWaveC2PipelineKvBackfill.ts`, and its
 * four relative imports are written for exactly that location:
 *
 *     import { rawDb }         from "../connection";               // server/db/connection
 *     import { log }           from "../../lib/logger";            // server/lib/logger
 *     import { hydrateEntries} from "../../lib/storePersistenceShim";
 *     import type { ... }      from "../../partnerWorkspaceStore";
 *
 * The apply brief, however, names `server/lib/` as the destination. Rather than
 * rewriting four import specifiers inside a 952-line hash-chain-critical module
 * (and thereby breaking byte-preservation against the D3 deliverable), the real
 * module is installed VERBATIM at its canonical path and this shim provides the
 * `server/lib/` entry point the brief asks for. Both import paths therefore
 * resolve, the D3 body is byte-identical to the delivered artifact, and there is
 * exactly one implementation — no duplicated logic, no drift surface.
 *
 * This file contains no logic of its own. It re-exports only; adding behaviour
 * here would defeat its purpose.
 */

export {
  runWaveC2PipelineKvBackfill,
  verifyTenantChain,
  verifyAllTenantChains,
  BACKFILL_LOCK_ID,
  PIPELINE_STAGE_MACHINE_TYPE,
  SKIP_LOG_SOURCE_TABLE,
  MINOR_UNITS_PER_MAJOR,
  KV_TO_V19_FIELD_MAP,
  KV_STAGE_TO_V19_STAGE,
  SKIP_REASON_NULL_COMPANY,
  SKIP_REASON_LEGACY_ID_CONFLICT,
} from "../db/backfills/runWaveC2PipelineKvBackfill";

export type {
  V19WrittenStage,
  BackfillSkipCode,
  ChainStatus,
  TenantChainVerifyResult,
  PipelineKvBackfillResult,
} from "../db/backfills/runWaveC2PipelineKvBackfill";
