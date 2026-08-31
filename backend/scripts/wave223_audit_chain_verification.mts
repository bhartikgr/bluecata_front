/**
 * WAVE 223 — AUDIT CHAIN VERIFICATION, READ-ONLY.
 *
 * WHAT THIS IS
 *   A verification run the platform can execute and a human can read. It walks
 *   every tenant that has audit_log rows and reports, per tenant, whether the
 *   hash chain verifies, and if not, the index of the first divergent link.
 *
 * WHAT IT IS NOT
 *   It is not a repair tool. It contains no INSERT, UPDATE, DELETE, ALTER or
 *   re-anchor statement. It does not touch platform_audit_incident,
 *   audit_chain_genesis, audit_chain_health or audit_chain_verifications. A
 *   standing audit-chain integrity incident is REPORTED, never cleared: a
 *   hash-chained record is evidence, and evidence is added beside, never
 *   rewritten (ENGINEERING_NOTES §4.6 / §4.7).
 *
 * WHY IT IMPORTS RATHER THAN REIMPLEMENTS
 *   The chain arithmetic lives in exactly one place. This script imports the
 *   real exported `verifyTenantAuditChain` from server/adminPlatformStore.ts —
 *   the same function the production route GET /api/admin/audit-log/verify
 *   calls, and the same function named by the standing incident's clearing
 *   condition. It computes no hash of its own. A second implementation would
 *   prove a replica, not the platform (§8).
 *
 * HONESTY RULES OBSERVED
 *   - The absolute path of the database actually opened is printed, because a
 *     verification result means nothing without naming its subject.
 *   - Counts printed are counts read. Nothing is defaulted to 0 to look tidy;
 *     an unreadable count prints "unreadable" with the reason.
 *   - "All chains verified" is never printed as a bare green tick: it is
 *     printed with the tenant count, the link count and the file name, and with
 *     the standing incident state alongside it.
 *
 * Run (from work/):
 *   DATABASE_URL=file:$PWD/data.db npx tsx scripts/wave223_audit_chain_verification.mts
 *   ... --json     machine-readable output on stdout
 *   ... --failures only the tenants that did not verify
 *
 * Exit code: 0 when every chain verified, 1 when any chain did not, 2 on a
 * failure to run at all. A non-zero exit is a finding, not a crash.
 */

import path from "node:path";

/* The real store and the real connection handle, imported statically so the
   symbol is resolvable by a type checker. No local hash arithmetic anywhere in
   this file. */
import { verifyTenantAuditChain } from "../server/adminPlatformStore.js";
import { rawDb } from "../server/db/connection.js";

type ChainResult = {
  tenantId: string;
  ok: boolean;
  brokenAt: number;
  totalLinks: number;
  genesisApplied: boolean;
  genesisHash: string | null;
  preGenesisRowCount: number;
};

const ARG_JSON = process.argv.includes("--json");
const ARG_FAILURES_ONLY = process.argv.includes("--failures");

/** Where the handle actually points, so the report names its subject. */
function describeSubject(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (raw.startsWith("file:")) return path.resolve(raw.slice("file:".length));
  if (raw) return raw;
  return "(DATABASE_URL unset — the connection module chose the file; see server/db/connection.ts)";
}

/**
 * brokenAt is a sentinel below zero. These are the verifier's own fail-closed
 * codes, restated for a human rather than reinvented.
 */
function explainBroken(r: ChainResult): string {
  if (r.brokenAt === -2)
    return "the genesis anchor row recorded for this tenant is MISSING from audit_log, so the chain cannot be re-based and verification fails closed";
  if (r.brokenAt === -3)
    return "the genesis anchor's stored hash does not match the anchor row's hash, so the re-base point is not trustworthy and verification fails closed";
  if (r.brokenAt < 0)
    return `verification failed closed with sentinel ${r.brokenAt} (see verifyTenantAuditChain in server/adminPlatformStore.ts)`;
  return `link ${r.brokenAt} of ${r.totalLinks} is the FIRST divergent row: either its recorded prev_hash does not equal the previous row's hash, or its recorded hash does not equal the hash recomputed from its own stored fields`;
}

function main(): number {
  const subject = describeSubject();
  let db: ReturnType<typeof rawDb>;
  try {
    db = rawDb();
  } catch (err) {
    console.error(`WAVE 223 — could not open a database handle: ${(err as Error).message}`);
    return 2;
  }

  /* Tenants are enumerated FROM audit_log, not from a tenant table: a tenant
     with no audit rows has no chain to verify, and counting it as "verified"
     would inflate the result. */
  let tenantIds: string[];
  let totalRows: number | null = null;
  try {
    tenantIds = (
      db
        .prepare("SELECT DISTINCT tenant_id AS tenantId FROM audit_log ORDER BY tenant_id ASC")
        .all() as Array<{ tenantId: string }>
    ).map((r) => r.tenantId);
  } catch (err) {
    console.error(`WAVE 223 — could not read audit_log: ${(err as Error).message}`);
    return 2;
  }
  try {
    totalRows = (db.prepare("SELECT COUNT(*) AS c FROM audit_log").get() as { c: number }).c;
  } catch {
    totalRows = null;
  }

  const results: ChainResult[] = [];
  const errors: Array<{ tenantId: string; message: string }> = [];
  for (const tenantId of tenantIds) {
    try {
      results.push(verifyTenantAuditChain(db, tenantId) as ChainResult);
    } catch (err) {
      errors.push({ tenantId, message: (err as Error).message });
    }
  }

  const failures = results.filter((r) => !r.ok);
  const linksWalked = results.reduce((sum, r) => sum + r.totalLinks, 0);
  const rebased = results.filter((r) => r.genesisApplied);

  /* The standing incident is READ and REPORTED. It is never written. */
  type IncidentRow = {
    incidentKey: string;
    state: string;
    openedAt: string | null;
    clearedAt: string | null;
    headline: string | null;
  };
  let incidents: IncidentRow[] | null = null;
  let incidentReadError: string | null = null;
  try {
    incidents = db
      .prepare(
        `SELECT incident_key AS incidentKey, state, opened_at AS openedAt,
                cleared_at AS clearedAt, headline
           FROM platform_audit_incident
          WHERE state = 'open'
          ORDER BY opened_at ASC`,
      )
      .all() as IncidentRow[];
  } catch (err) {
    incidentReadError = (err as Error).message;
  }

  if (ARG_JSON) {
    console.log(
      JSON.stringify(
        {
          wave: 223,
          databaseFile: subject,
          auditLogRows: totalRows,
          tenantsWithChains: tenantIds.length,
          tenantsVerified: results.length - failures.length,
          tenantsFailed: failures.length,
          linksWalked,
          tenantsRebasedOnGenesisAnchor: rebased.length,
          verifierErrors: errors,
          failures: failures.map((r) => ({
            tenantId: r.tenantId,
            brokenAt: r.brokenAt,
            totalLinks: r.totalLinks,
            genesisApplied: r.genesisApplied,
            preGenesisRowCount: r.preGenesisRowCount,
            reason: explainBroken(r),
          })),
          openIncidents: incidents,
          openIncidentsReadError: incidentReadError,
        },
        null,
        2,
      ),
    );
    return failures.length > 0 || errors.length > 0 ? 1 : 0;
  }

  const L = (s = "") => console.log(s);
  L("WAVE 223 — AUDIT CHAIN VERIFICATION (read-only)");
  L("=".repeat(72));
  L(`Database read:        ${subject}`);
  L(`audit_log rows:       ${totalRows === null ? "unreadable (COUNT(*) failed)" : totalRows}`);
  L(`Tenants with a chain: ${tenantIds.length}`);
  L(`Links walked:         ${linksWalked}`);
  L(`Chains re-based on a recorded genesis anchor: ${rebased.length}`);
  L();
  L(
    "Every link commits the previous hash, the row id, the action, the target, the",
  );
  L(
    "timestamp and the stored payload bytes; from hash version 2 it also commits the",
  );
  L("actor. Rows are read in (created_at ASC, id ASC) order, per tenant.");
  L();

  if (errors.length > 0) {
    L(`VERIFIER ERRORS — ${errors.length} tenant(s) could not be checked at all:`);
    for (const e of errors) L(`  ${e.tenantId}: ${e.message}`);
    L();
  }

  if (failures.length === 0) {
    L(`RESULT: every one of the ${results.length} tenant chain(s) verified.`);
    L(`        ${linksWalked} link(s) recomputed and matched, in the file named above.`);
    L("        This statement covers only that file. It is not a statement about");
    L("        any other deployment of this platform.");
  } else {
    L(`RESULT: ${failures.length} of ${results.length} tenant chain(s) DID NOT VERIFY.`);
    L();
    for (const r of failures) {
      L(`  tenant ${r.tenantId}`);
      L(`    ${explainBroken(r)}`);
      L(
        `    links=${r.totalLinks}  genesisApplied=${r.genesisApplied}  preGenesisRows=${r.preGenesisRowCount}`,
      );
      L();
    }
    L("  A divergent link is not repaired by this run and must not be repaired by");
    L("  hand. The row is evidence. Investigate what wrote or altered it.");
  }
  if (!ARG_FAILURES_ONLY) {
    L();
    L("STANDING INCIDENTS (read, not modified)");
    if (incidentReadError !== null) {
      L(`  could not read platform_audit_incident: ${incidentReadError}`);
    } else if (incidents === null || incidents.length === 0) {
      L("  no open rows in platform_audit_incident.");
    } else {
      for (const i of incidents) {
        L(`  ${i.incidentKey}  state=${i.state}  opened=${i.openedAt ?? "unknown"}`);
        if (i.headline) L(`    ${i.headline}`);
      }
      L();
      L("  This run does not clear any incident. Clearing one is an operator");
      L("  decision recorded through the platform, with this run's output as the");
      L("  evidence it cites.");
    }
  }
  L();
  L("=".repeat(72));
  return failures.length > 0 || errors.length > 0 ? 1 : 0;
}

process.exit(main());
