/* ════════════════════════════════════════════════════════════════════════════
   WAVE 238 — ONE NAME FOR THE AUDIT-LOG CHAIN, ONE NAME FOR EACH VERIFIER.

   The platform contains TWO chain verifiers and they are not equivalent:

     • verifyTenantAuditChain   (server/adminPlatformStore.ts)
       CANONICAL for `audit_log`. Applies the audit_chain_genesis re-base,
       recomputes each body under the hash version THE ROW DECLARES, and fails
       closed on a dangling or disagreeing anchor.

     • verifyChainForTable      (server/lib/auditChainVerifier.ts)
       A generic 23-table catalog walker. It does NOT consult
       audit_chain_genesis. For every table OTHER than `audit_log` it is the
       only verifier there is, and it stays in place for all of them.

   Wave 238 records a HISTORY of verification runs. Two separate places have to
   agree on the string `audit_log` for that history to be findable: the writer
   (runAuditChainBootVerifier in server/lib/hydrateStores.ts) and the reader
   (/api/admin/audit/verification-history, filtered by ?table=). A history that
   is written under one spelling and read under another is invisible while every
   individual piece of code looks correct — which is the exact failure this
   wave exists to end. Both sides therefore import the SAME constant from here.

   R220.4 STANDING PROHIBITION, restated so it is next to the code: the
   quarterly sweep in server/jobs/auditChainQuarterly.ts writes this same table
   using the TWIN. It has ZERO callers and wave 238 does not give it one.
   ════════════════════════════════════════════════════════════════════════════ */

/** The one spelling of the audit-log chain table name. Writer and reader both
 *  import this; neither is allowed a literal of its own. */
export const AUDIT_LOG_CHAIN_TABLE = "audit_log";

/** Recorded in details_json.verifier so a history row states which of the two
 *  verifiers produced it. A row that does not say cannot be trusted to mean
 *  what the reader assumes. */
export const AUDIT_CHAIN_VERIFIER_CANONICAL = "verifyTenantAuditChain";
export const AUDIT_CHAIN_VERIFIER_TWIN = "verifyChainForTable";

/** Human-readable one-liners for the admin screen. */
export const AUDIT_CHAIN_VERIFIER_LABELS: Readonly<Record<string, string>> = {
  [AUDIT_CHAIN_VERIFIER_CANONICAL]:
    "canonical audit-log verifier (chain_genesis re-base applied)",
  [AUDIT_CHAIN_VERIFIER_TWIN]:
    "generic catalog walker (no chain_genesis re-base)",
};

/** Where a history row came from. */
export const AUDIT_CHAIN_HISTORY_SOURCE_BOOT = "boot_verifier";

/* ── Retention ──────────────────────────────────────────────────────────────
   The boot verifier runs on every process start, once per tenant with
   audit_log rows. On live that is roughly 730 rows per restart, so an
   unbounded history would grow without limit and the useful recent rows would
   be buried.

   THE CHOICE, stated: keep the newest AUDIT_CHAIN_HISTORY_RETENTION_PER_KEY
   rows per (tenant_id, table_name) — and NEVER prune a row that recorded a
   break. Pruning is restricted to rows with broken_count = 0. A row that
   witnessed a broken chain is evidence and is kept for as long as the database
   exists, however old it becomes.

   This is deletion of clean, superseded observations only. It is not a rewrite:
   no existing row's bytes, hash, order or contents are ever modified. The
   2026-08-10 incident is a broken-chain record and is therefore outside the
   prune set entirely.
   ────────────────────────────────────────────────────────────────────────── */
export const AUDIT_CHAIN_HISTORY_RETENTION_PER_KEY = 50;
