/**
 * WAVE 230B — THE ADMIN CONTROLS FOR TEST-DATA EXCLUSION.
 *
 * Wave 230 built the engine and shipped no way to use it: the mark could only be
 * changed by running a script. R230.3 records that **no test/demo/archive control
 * exists anywhere in the admin** — confirmed absent on Companies, Investors and
 * the Audit Log. These routes are that control.
 *
 * WHAT IS DELIBERATE HERE, and why:
 *
 * 1. **PER-RECORD, NEVER PER-TENANT (R230.6).** Every endpoint addresses ONE row
 *    by its own key. There is no tenant parameter anywhere in this file, and no
 *    bulk "mark this tenant" verb exists, because a round named "QA Note Round"
 *    sits inside BluePrint Catalyst Limited — the owner's real operating company.
 *
 * 2. **NOTHING AUTO-MARKS.** `/proposals` PROPOSES. The classifier is read-only by
 *    construction (`wave230TestDataClassifier.ts` never writes), and no route here
 *    applies a proposal. Every mark is one explicit operator decision, audited.
 *
 * 3. **PROBABLE IS SEPARATED FROM CERTAIN IN THE PAYLOAD ITSELF (R230.2).**
 *    `Kestrel Holdings Ltd` and `Live Audit Client Ltd` are PROBABLE, not certain.
 *    They are returned under `needsOwnerConfirmation`, a distinct array, so a
 *    surface cannot render them in the same list as the unambiguous ones by
 *    accident. Wave 230's own caught defect was exactly this failure — its
 *    `confidenceOf` tested membership of the wrong array and reported PROBABLE
 *    rules as CERTAIN, which would have excluded records **without flagging them
 *    for confirmation**. It found that only by disbelieving its own numbers.
 *    So this file's tests assert the split the endpoint PRODUCES on the real
 *    population, never the confidence a rule declares.
 *
 * 4. **NULL MEANS NOT DETERMINED, NEVER ZERO (R224.1).** `wave230Counts` returns
 *    `number | null`, and this file passes the null straight through rather than
 *    coalescing it. A fabricated zero on this surface reads as "nothing is
 *    excluded", which is an absence rendering as reassurance.
 *
 * 5. **MONEY.** `/revenue-impact` carries `bigint` minor units as EXACT DECIMAL
 *    STRINGS. There is no `Number()`, `parseInt` or `parseFloat` in this file,
 *    no currency is ever converted or summed across currencies, and no price is
 *    hardcoded. `undetermined: true` means the consuming surface must render a
 *    dash (R228.2 forbids adjusting a money figure silently).
 *
 * 6. **NOTHING IS DELETED AND NO AUDIT ROW IS EVER REWRITTEN.** The only write
 *    verb is `wave230SetExcluded`, which sets or clears three nullable columns on
 *    the record itself and appends an audit entry. Unsetting restores the record
 *    to every surface it was on.
 *
 * Mounted under `/api/admin`, so the blanket `app.use("/api/admin", requireAdmin)`
 * gate in `server/routes.ts` applies; `requireAdmin` is ALSO named on every route
 * here so the guard is visible at the call site and survives a remount.
 */
import type { Express, Request, Response } from "express";

import { requireAdmin } from "./lib/authMiddleware";
import type { UserContext } from "./lib/userContext";
import {
  WAVE230_TABLES,
  isWave230Table,
  wave230AllCounts,
  wave230IsExcluded,
  wave230ListExcluded,
  type Wave230Table,
} from "./lib/wave230TestDataFlags";
import { wave230SetExcluded } from "./lib/wave230TestDataExclusion";
import { wave230ClassifyTable } from "./lib/wave230TestDataClassifier";
import { wave230RevenueImpact } from "./lib/wave230RevenueImpact";

/** The route prefix, named once so the tests and the client cannot drift from it. */
export const WAVE230_ADMIN_BASE = "/api/admin/test-data";

function actorOf(req: Request): string | null {
  const ctx = (req as Request & { userContext?: UserContext }).userContext;
  const id = ctx?.userId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Read a `table` query/body value, or null. Never defaults to a table. */
function tableOf(v: unknown): Wave230Table | null {
  const s = typeof v === "string" ? v.trim() : "";
  return isWave230Table(s) ? s : null;
}

export function registerWave230AdminRoutes(app: Express): void {
  /* ── COUNTS ───────────────────────────────────────────────────────────────
     Total / excluded / kept for each population. `null` is passed through
     untouched: it means NOT DETERMINED and the screen must render a dash. */
  app.get(`${WAVE230_ADMIN_BASE}/counts`, requireAdmin, (_req: Request, res: Response): void => {
    res.json({ ok: true, tables: WAVE230_TABLES, counts: wave230AllCounts() });
  });

  /* ── THE EXCLUDED-RECORDS FILTER ──────────────────────────────────────────
     "View excluded records". Nothing this wave hides becomes unreachable: every
     excluded record is one click away here, with WHEN it was excluded, WHY, and
     BY WHOM, and can be restored from the same screen. */
  app.get(`${WAVE230_ADMIN_BASE}/excluded`, requireAdmin, (req: Request, res: Response): void => {
    const raw = req.query.table;
    if (raw !== undefined && String(raw).trim() !== "") {
      const table = tableOf(raw);
      if (!table) {
        res.status(400).json({ ok: false, error: "unknown_table", table: String(raw) });
        return;
      }
      res.json({ ok: true, records: wave230ListExcluded(table) });
      return;
    }
    const records = WAVE230_TABLES.flatMap((t) => wave230ListExcluded(t));
    res.json({ ok: true, records });
  });

  /* ── SET / UNSET THE MARK ON ONE RECORD ───────────────────────────────────
     `excluded: true` marks; `excluded: false` restores. Both go through the same
     audited writer. The actor is the SERVER-OBSERVED session user — never a value
     supplied by the caller, and never a fabricated placeholder: if there is no
     session user the write is REFUSED rather than attributed to someone invented. */
  app.post(`${WAVE230_ADMIN_BASE}/mark`, requireAdmin, (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const table = tableOf(body.table);
    if (!table) {
      res.status(400).json({ ok: false, error: "unknown_table", table: String(body.table ?? "") });
      return;
    }
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      res.status(400).json({ ok: false, error: "missing_record_id" });
      return;
    }
    /* Strictly boolean. A missing or non-boolean value is REFUSED rather than
       coerced, because coercion here would decide, silently, whether a record is
       hidden from the owner's own dashboard. */
    if (typeof body.excluded !== "boolean") {
      res.status(400).json({ ok: false, error: "excluded_must_be_boolean" });
      return;
    }
    const actorId = actorOf(req);
    if (actorId === null) {
      res.status(403).json({ ok: false, error: "no_session_actor" });
      return;
    }
    const reason =
      typeof body.reason === "string" && body.reason.trim().length > 0 ? body.reason.trim() : null;

    const outcome = wave230SetExcluded({
      table,
      id,
      excluded: body.excluded,
      reason,
      actorId,
      tenantId: typeof body.tenantId === "string" ? body.tenantId : undefined,
    });
    if (!outcome.ok) {
      const notFound = outcome.reason.startsWith("RECORD_NOT_FOUND");
      res.status(notFound ? 404 : 500).json({ ok: false, error: outcome.reason });
      return;
    }
    /* Read back through the SAME reader every display surface uses, and report
       what the database now says rather than what was requested. A route that
       echoes its own input proves nothing about whether the write landed. */
    res.json({ ok: true, table, id, excluded: wave230IsExcluded(table, id), outcome });
  });

  /* ── PROPOSALS, SPLIT BY CONFIDENCE ───────────────────────────────────────
     Read-only. AMBIGUOUS never appears in either list, because ambiguous defaults
     to KEPT and an operator scanning a list of proposals should not have to
     remember that. */
  app.get(`${WAVE230_ADMIN_BASE}/proposals`, requireAdmin, (req: Request, res: Response): void => {
    const raw = req.query.table;
    let tables: readonly Wave230Table[] = WAVE230_TABLES;
    if (raw !== undefined && String(raw).trim() !== "") {
      const t = tableOf(raw);
      if (!t) {
        res.status(400).json({ ok: false, error: "unknown_table", table: String(raw) });
        return;
      }
      tables = [t];
    }
    const verdicts = tables.flatMap((t) => wave230ClassifyTable(t));
    const certain = verdicts.filter((v) => v.proposeExclude && !v.needsOwnerConfirmation);
    const needsOwnerConfirmation = verdicts.filter((v) => v.needsOwnerConfirmation);
    const kept = verdicts.filter((v) => !v.proposeExclude).length;
    res.json({
      ok: true,
      /* Two separate arrays, deliberately. R230.2: a PROBABLE record must reach
         the owner as a question, not as a conclusion. */
      certain,
      needsOwnerConfirmation,
      keptCount: kept,
      totalClassified: verdicts.length,
    });
  });

  /* ── BEFORE / AFTER REVENUE ───────────────────────────────────────────────
     R228.2: the fall in the reported figure must be a REPORTED RESULT, never a
     side effect. Minor units travel as exact decimal strings so no consumer can
     round them through a float. */
  app.get(
    `${WAVE230_ADMIN_BASE}/revenue-impact`,
    requireAdmin,
    (_req: Request, res: Response): void => {
      const impact = wave230RevenueImpact();
      res.json({
        ok: true,
        installed: impact.installed,
        undetermined: impact.undetermined,
        unreadable: impact.unreadable,
        byCurrency: impact.byCurrency.map((c) => ({
          currency: c.currency,
          beforeMinor: c.beforeMinor.toString(),
          afterMinor: c.afterMinor.toString(),
          excludedMinor: c.excludedMinor.toString(),
          excludedCount: c.excludedCount,
          keptCount: c.keptCount,
        })),
      });
    },
  );
}
