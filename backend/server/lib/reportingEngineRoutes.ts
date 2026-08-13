// server/lib/reportingEngineRoutes.ts
//
// WAVE 10 — the routes for EN-1 (ILPA cash-flow ledger), EN-2 (valuation marks
// / mark-to-market) and EN-3 (LP identity aliasing).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE IS THE POINT OF THE WHOLE ITEM.
//
//   "An engine with no route is NOT shipped."
//
// WAVE 9 built a complete reporting engine — `server/wave9ReportingStore.ts`,
// 990 lines, with mark derivation, staleness badging, GP overrides, monthly
// snapshots, cohort benchmarks and a full investor metric bundle — and wired
// almost none of it to anything. Verified by grepping every export for a
// non-test caller:
//
//   recordCashflow            :144   0 non-test callers
//   listCashflows             :185   0
//   deriveMarkForCompany      :271   0
//   effectiveMarkForCompany   :317   0
//   persistValuationEvent     :343   0
//   latestValuationEvent      :376   0
//   createMarkOverride        :456   0
//   decideMarkOverride        :494   0
//   listOverrides             :554   0
//   writeMonthlySnapshot      :594   0
//   snapshotInvestor          :934   0
//   setW9Config / listW9Config:119/100  0
//
// Only `getChartSeries` (:693) and `computeCohortBenchmark` (:746) had a caller
// at all, from server/portfolioAnalyticsStore.ts:311 and :350. Everything else
// was an orphan: tables created, immutability triggers armed, tests green, and
// no production code path could reach any of it. That is the same shape as
// `allocation_rule` — a table with triggers that nothing reads — and it is the
// tenth instance in this build of something believed missing already existing
// and only needing wiring.
//
// So EN-1 and EN-2 are WIRED, not built. What is genuinely new is the chain
// (migration 0165), the producers (server/lib/ilpaCashflowLedger.ts projectors)
// and this file.
//
// ─────────────────────────────────────────────────────────────────────────────
// AUTHORISATION SHAPE. Two audiences, deliberately separated:
//   /api/reporting/**   — GP/operator surface. requireAuth, and every write
//                         that decides an override is admin-gated.
//   /api/me/**          — LP self-serve. requireAuth, scoped to the caller's
//                         OWN resolved identity set and nothing else.
// EN-3's alias resolution appears ONLY on the /api/me/** side and only ever
// widens the caller's id set to other spellings of themselves. It is never used
// to decide whether an action is permitted (see the module header of
// server/lib/investorIdentityAliasStore.ts).
//
// PERCENTAGES. Every ratio returned here (DPI, TVPI, IRR) is a FRACTION, per
// the owner ruling. Nothing multiplies by 100 on the server; the client renders
// through client/src/lib/percentDisplay.ts.
//
// MONEY. Integer minor units end to end. No `Math.round` on a per-party share
// occurs in this file — there is no per-party division here at all.
import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin } from "./authMiddleware";
import { log } from "./logger";
import {
  appendFlow,
  listFlows,
  listFlowsForInvestor,
  verifyVehicleChain,
  cashflowChainInstalled,
  CashflowLedgerError,
  type VehicleKind,
} from "./ilpaCashflowLedger";
import {
  deriveMarkForCompany,
  effectiveMarkForCompany,
  persistValuationEvent,
  latestValuationEvent,
  createMarkOverride,
  decideMarkOverride,
  listOverrides,
  getOverrideById,
  getOverrideApprovalMode,
  overrideIsEffective,
  getMarkThresholds,
  listW9Config,
  setW9Config,
  writeMonthlySnapshot,
  listSnapshots,
  monthStart,
} from "../wave9ReportingStore";
import {
  selfClaimByEmail,
  listAliasesForUser,
  listAliases,
  claimAlias,
  revokeAlias,
  resolveInvestorIdSet,
  deriveExternalInvestorId,
  AliasError,
} from "./investorIdentityAliasStore";
import { computeFundMetrics, type IlpaFlow } from "@capavate/math-fns";
import { normalizeCurrency } from "./currencyScalar";

/* ============================================================
 * WAVE 21 · ITEM 2 site 3 (REVIEW A CRITICAL, was :284-315)
 *
 * WAS: both reporting endpoints mapped every ledger row into one flat
 * `IlpaFlow[]` regardless of `r.currency` and handed it to
 * `computeFundMetrics`, which sums `paidInMinor` and `distributedMinor` across
 * the whole array. The snapshot endpoint then did the same for
 * `contributedMinor`/`distributedMinor` and PERSISTED the row with
 * `currency: rows[0]?.currency ?? "USD"` — the FIRST row's currency stamped
 * onto a total containing every other currency. That is a durable, auditable
 * financial record containing money that does not exist.
 *
 * NOW: currency is a precondition. A vehicle whose ledger spans currencies
 * gets metrics reported as UNAVAILABLE (with the per-currency breakdown), and
 * the snapshot write is REFUSED with 409 rather than written wrong. The
 * residual mark's own currency must also agree with the flows — a JPY mark on
 * a USD ledger is the same defect wearing a different hat.
 *
 * NOT IN SCOPE (reported, not invented): there is no FX rate source in this
 * repository. Producing real converted metrics needs rate ingestion with
 * as-of-date semantics and an audit trail. No rate is fabricated here.
 * ============================================================ */

/** Distinct, normalized currency codes across ledger rows (+ optional mark). */
function currencySetOf(
  rows: Array<{ currency?: string | null }>,
  markCurrency?: string | null,
): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const c = normalizeCurrency(r.currency);
    if (c) set.add(c);
  }
  const m = normalizeCurrency(markCurrency);
  if (m) set.add(m);
  return Array.from(set).sort();
}

/** Per-currency contributed/distributed, computed WITHIN each currency only. */
function flowTotalsByCurrency(
  rows: Array<{ currency?: string | null; amountMinor: number }>,
): Array<{ currency: string; contributedMinor: number; distributedMinor: number }> {
  const map: Record<string, { contributedMinor: number; distributedMinor: number }> = {};
  for (const r of rows) {
    const c = normalizeCurrency(r.currency) || "USD";
    if (!map[c]) map[c] = { contributedMinor: 0, distributedMinor: 0 };
    if (r.amountMinor < 0) map[c].contributedMinor += Math.abs(r.amountMinor);
    else map[c].distributedMinor += r.amountMinor;
  }
  return Object.entries(map)
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/* A frozen ARRAY, not a Set. A `Set` here reads better but `[...set]` costs a
 * TS2802 under this tsconfig target, and the error budget is zero net-new. */
const VEHICLE_KINDS: readonly VehicleKind[] = Object.freeze(["spv", "fund", "company", "portfolio"] as const);

function ctxOf(req: Request): any {
  return (req as any).userContext ?? {};
}

function actorOf(req: Request): string {
  const c = ctxOf(req);
  return String(c?.userId ?? c?.identity?.email ?? "unknown");
}

function tenantOf(req: Request): string {
  const c = ctxOf(req);
  return String(c?.tenantId ?? c?.partner?.tenantId ?? "default");
}

function badVehicle(res: Response, kind: string): boolean {
  if (!VEHICLE_KINDS.includes(kind as VehicleKind)) {
    res.status(400).json({ ok: false, error: "BAD_VEHICLE_KIND", message: `expected one of ${VEHICLE_KINDS.join(", ")}` });
    return true;
  }
  return false;
}

function fail(res: Response, e: unknown): void {
  if (e instanceof CashflowLedgerError || e instanceof AliasError) {
    res.status(400).json({ ok: false, error: e.code, message: e.message });
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  log.warn(`[reportingEngineRoutes] ${msg}`);
  res.status(500).json({ ok: false, error: "INTERNAL", message: msg });
}

export function registerReportingEngineRoutes(app: Express): void {
  /* ======================================================================
   * EN-1 — the ILPA cash-flow ledger.
   * ==================================================================== */

  /**
   * Read a vehicle's flows. The response carries `chainInstalled` so a client
   * can tell "no flows" apart from "this deployment has not run migration
   * 0165" — two very different facts that a bare empty array conflates.
   */
  app.get("/api/reporting/vehicles/:kind/:id/cashflows", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const flows = listFlows({ vehicleKind: kind as VehicleKind, vehicleId: String(req.params.id) });
      res.json({
        ok: true,
        vehicleKind: kind,
        vehicleId: String(req.params.id),
        chainInstalled: cashflowChainInstalled(),
        flows,
        total: flows.length,
      });
    } catch (e) { fail(res, e); }
  });

  /** Append a flow by hand. GP/operator entry for anything with no producer. */
  app.post("/api/reporting/vehicles/:kind/:id/cashflows", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const row = appendFlow({
        tenantId: tenantOf(req),
        vehicleKind: kind as VehicleKind,
        vehicleId: String(req.params.id),
        lpId: typeof b.lpId === "string" ? b.lpId : null,
        txnType: b.txnType as any,
        valueDate: String(b.valueDate ?? ""),
        amountMinor: Number(b.amountMinor),
        currency: String(b.currency ?? ""),
        isRecallable: b.isRecallable === true,
        sourceKind: typeof b.sourceKind === "string" && b.sourceKind ? b.sourceKind : "manual",
        sourceRef: typeof b.sourceRef === "string" ? b.sourceRef : null,
        createdBy: actorOf(req),
      });
      res.status(201).json({ ok: true, flow: row });
    } catch (e) { fail(res, e); }
  });

  /**
   * Verify the hash chain. THIS ENDPOINT MUST BE ABLE TO RETURN ok:false — see
   * verifyVehicleChain's header. It reports unchained rows separately and does
   * NOT count them as verified, so a caller cannot read "OK" off a vehicle
   * whose rows predate the chain.
   */
  app.get("/api/reporting/vehicles/:kind/:id/cashflows/verify", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const result = verifyVehicleChain(kind, String(req.params.id));
      res.json({ ok: true, verification: result });
    } catch (e) { fail(res, e); }
  });

  /**
   * IRR / DPI / TVPI / RVPI / PIC for a vehicle, computed from the ledger.
   *
   * THE RESIDUAL VALUE COMES FROM EN-2, NOT FROM A GUESS. If the vehicle has no
   * effective mark, `residualValueMinor` is null and `computeFundMetrics`
   * returns TVPI/RVPI with a STATUS rather than a number. A fabricated residual
   * would turn "we do not know what this is worth" into a figure on a page in
   * front of a limited partner, which is the one outcome worth failing to
   * avoid.
   */
  app.get("/api/reporting/vehicles/:kind/:id/metrics", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const vehicleId = String(req.params.id);
      const asOfDate = String(req.query.asOf ?? new Date().toISOString()).slice(0, 10);

      const rows = listFlows({ vehicleKind: kind as VehicleKind, vehicleId });
      const flows: IlpaFlow[] = rows.map((r) => ({
        lpId: r.lpId ?? null,
        txnType: r.txnType,
        valueDate: r.valueDate,
        amountMinor: r.amountMinor,
        currency: r.currency,
        isRecallable: r.isRecallable,
      }));

      const ev = latestValuationEvent(kind, vehicleId);
      const residualValueMinor = ev ? ev.fairValueMinor : null;
      const committedRaw = req.query.committedMinor;
      const committedMinor =
        committedRaw !== undefined && Number.isSafeInteger(Number(committedRaw))
          ? Number(committedRaw)
          : null;

      const thresholds = getMarkThresholds();
      const marksStale = (() => {
        if (!ev) return false;
        const age = Math.floor(
          (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${ev.valuationDate}T00:00:00Z`)) / 86400000,
        );
        return age >= thresholds.staleWarnDays;
      })();

      /* WAVE 21 · ITEM 2 — refuse to compute a single set of fund metrics over
         a mixed-currency ledger. PIC / distributed / TVPI all rest on summing
         minor units, which is only meaningful within one currency. */
      const metricCurrencies = currencySetOf(rows, ev?.currency ?? null);
      if (metricCurrencies.length > 1) {
        return res.json({
          ok: true,
          vehicleKind: kind,
          vehicleId,
          asOfDate,
          flowCount: flows.length,
          valuation: ev,
          marksStale,
          metrics: null,
          metricsAvailable: false,
          metricsUnavailable: {
            reason: "needs_fx_conversion",
            currencies: metricCurrencies,
            message:
              "This vehicle's cashflow ledger spans more than one currency. " +
              "Fund metrics (PIC, DPI, TVPI, RVPI, IRR) require a single currency; " +
              "no FX conversion source is configured, so no combined figure is reported.",
          },
          byCurrency: flowTotalsByCurrency(rows),
        });
      }

      const metrics = computeFundMetrics({
        flows,
        residualValueMinor,
        committedMinor,
        asOfDate,
        marksStale,
      });
      res.json({
        ok: true,
        vehicleKind: kind,
        vehicleId,
        asOfDate,
        flowCount: flows.length,
        valuation: ev,
        marksStale,
        metrics,
        metricsAvailable: true,
        metricsUnavailable: null,
        currency: metricCurrencies[0] ?? null,
        byCurrency: flowTotalsByCurrency(rows),
      });
    } catch (e) { fail(res, e); }
  });

  /**
   * Persist this month's snapshot for a vehicle (Q9: MONTHLY; a chart renders
   * only at >= 3 points). Idempotent within a month by the UNIQUE key on
   * (subject, period_start) — re-running updates the month rather than
   * appending a second point.
   */
  app.post("/api/reporting/vehicles/:kind/:id/snapshot", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      if (kind === "company" || kind === "portfolio") {
        return res.status(400).json({
          ok: false,
          error: "SNAPSHOT_SUBJECT_UNSUPPORTED",
          message: "snapshots are kept for investor, spv, fund and platform subjects",
        });
      }
      const vehicleId = String(req.params.id);
      const asOfDate = new Date().toISOString().slice(0, 10);
      const rows = listFlows({ vehicleKind: kind as VehicleKind, vehicleId });
      const flows: IlpaFlow[] = rows.map((r) => ({
        lpId: r.lpId ?? null,
        txnType: r.txnType,
        valueDate: r.valueDate,
        amountMinor: r.amountMinor,
        currency: r.currency,
        isRecallable: r.isRecallable,
      }));
      const ev = latestValuationEvent(kind, vehicleId);

      /* WAVE 21 · ITEM 2 — a DURABLE snapshot must never carry a mixed sum.
         The old code wrote `currency: rows[0]?.currency ?? "USD"` next to
         totals accumulated over every currency in the ledger. Refuse the write
         and say exactly why; a missing data point is recoverable, a wrong
         persisted financial record is not. */
      const snapshotCurrencies = currencySetOf(rows, ev?.currency ?? null);
      if (snapshotCurrencies.length > 1) {
        return res.status(409).json({
          ok: false,
          error: "CROSS_CURRENCY_SNAPSHOT_BLOCKED",
          currencies: snapshotCurrencies,
          byCurrency: flowTotalsByCurrency(rows),
          message:
            "Refusing to persist a monthly snapshot for a vehicle whose cashflows span " +
            `${snapshotCurrencies.join(", ")}. A snapshot row carries a single currency; ` +
            "writing one would record totals that are not denominated in any real currency. " +
            "No FX conversion source is configured.",
        });
      }
      const snapshotCurrency = snapshotCurrencies[0] ?? "USD";

      const metrics = computeFundMetrics({
        flows,
        residualValueMinor: ev ? ev.fairValueMinor : null,
        committedMinor: null,
        asOfDate,
      });
      const contributedMinor = rows
        .filter((r) => r.amountMinor < 0)
        .reduce((s, r) => s + Math.abs(r.amountMinor), 0);
      const distributedMinor = rows
        .filter((r) => r.amountMinor > 0)
        .reduce((s, r) => s + r.amountMinor, 0);
      const id = writeMonthlySnapshot({
        tenantId: tenantOf(req),
        subjectKind: kind as "spv" | "fund",
        subjectId: vehicleId,
        periodStart: monthStart(asOfDate),
        contributedMinor,
        distributedMinor,
        residualValueMinor: ev ? ev.fairValueMinor : 0,
        // Single-currency by construction: the mixed case returned 409 above.
        currency: snapshotCurrency,
        metrics,
        markedPositions: ev ? 1 : 0,
        unmarkedPositions: ev ? 0 : 1,
      });
      res.status(201).json({ ok: true, snapshotId: id, periodStart: monthStart(asOfDate) });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/reporting/vehicles/:kind/:id/snapshots", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const points = listSnapshots(kind, String(req.params.id));
      res.json({
        ok: true,
        points,
        total: points.length,
        // Q9: a chart renders only at >= 3 points. The server states the rule
        // so two clients cannot disagree about it.
        chartable: points.length >= 3,
        minPointsForChart: 3,
      });
    } catch (e) { fail(res, e); }
  });

  /* ======================================================================
   * EN-2 — valuation marks.
   * ==================================================================== */

  /** The derived mark, the effective mark, and the thresholds behind the badge. */
  app.get("/api/reporting/companies/:companyId/mark", requireAuth, (req: Request, res: Response) => {
    try {
      const companyId = String(req.params.companyId);
      const asOf = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
      const derived = deriveMarkForCompany(companyId, asOf);
      const effective = effectiveMarkForCompany(companyId, { asOf });
      res.json({
        ok: true,
        companyId,
        derived,
        effective,
        thresholds: getMarkThresholds(),
        overrideApprovalMode: getOverrideApprovalMode(),
        // An honest empty state, not a zero. Q5 marks AUTO-DERIVE from the last
        // PRICED round; a company whose only rounds are SAFEs has no mark, and
        // saying so is the correct answer.
        reason: derived ? null : "NO_PRICED_ROUND",
      });
    } catch (e) { fail(res, e); }
  });

  /** Freeze the current derived mark as an auditable `valuation_event`. */
  app.post("/api/reporting/companies/:companyId/mark/persist", requireAuth, (req: Request, res: Response) => {
    try {
      const companyId = String(req.params.companyId);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const mark = effectiveMarkForCompany(companyId);
      if (!mark) {
        return res.status(409).json({
          ok: false,
          error: "NO_MARK_TO_PERSIST",
          message: "this company has no priced round and no override, so there is no mark to freeze",
        });
      }
      const fairValueMinor = Number(b.fairValueMinor);
      if (!Number.isSafeInteger(fairValueMinor) || fairValueMinor < 0) {
        return res.status(400).json({
          ok: false,
          error: "FAIR_VALUE_REQUIRED",
          message: "fairValueMinor must be a non-negative integer in minor units",
        });
      }
      const id = persistValuationEvent({
        tenantId: tenantOf(req),
        vehicleKind: "company",
        vehicleId: companyId,
        valuationDate: mark.valuationDate,
        fairValueMinor,
        currency: String(b.currency ?? "USD"),
        method: mark.method,
        source: mark.source,
        sourceRef: mark.roundId,
        preparer: actorOf(req),
        isExternal: false,
        createdBy: actorOf(req),
      });
      res.status(201).json({ ok: true, valuationEventId: id, mark });
    } catch (e) { fail(res, e); }
  });

  /** Q5: marks are GP-OVERRIDABLE. The reason is mandatory (>= 10 chars). */
  app.post("/api/reporting/vehicles/:kind/:id/mark/override", requireAuth, (req: Request, res: Response) => {
    try {
      const kind = String(req.params.kind);
      if (badVehicle(res, kind)) return;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const ov = createMarkOverride({
        tenantId: tenantOf(req),
        valuationEventId: String(b.valuationEventId ?? ""),
        vehicleKind: kind,
        vehicleId: String(req.params.id),
        holdingId: typeof b.holdingId === "string" ? b.holdingId : null,
        priorFairValueMinor: Number.isSafeInteger(Number(b.priorFairValueMinor))
          ? Number(b.priorFairValueMinor) : null,
        fairValueMinor: Number(b.fairValueMinor),
        currency: String(b.currency ?? "USD"),
        reason: String(b.reason ?? ""),
        overriddenBy: actorOf(req),
        pricePerShareOverride: Number.isFinite(Number(b.pricePerShareOverride))
          ? Number(b.pricePerShareOverride) : null,
      });
      // WAVE 23 · ITEM 5: report what `overrideIsEffective()` decides, not a
      // re-derivation of it. A freshly created override is `pending`, so under
      // the new "required" default this correctly reports effective=false —
      // the caller is told plainly that their override is awaiting approval.
      res.status(201).json({
        ok: true,
        override: ov,
        effective: overrideIsEffective(ov),
        approvalMode: getOverrideApprovalMode(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "MARK_OVERRIDE_REASON_REQUIRED" || msg === "MARK_OVERRIDE_VALUE_INVALID") {
        return res.status(400).json({ ok: false, error: msg });
      }
      fail(res, e);
    }
  });

  app.get("/api/reporting/mark-overrides", requireAuth, (req: Request, res: Response) => {
    try {
      const approvalState = typeof req.query.approvalState === "string" ? req.query.approvalState : undefined;
      const rows = listOverrides(approvalState ? { approvalState } : undefined);
      res.json({ ok: true, overrides: rows, total: rows.length, approvalMode: getOverrideApprovalMode() });
    } catch (e) { fail(res, e); }
  });

  /** Approve or reject. Admin-gated: this is a review action, not a GP action. */
  app.post("/api/admin/reporting/mark-overrides/:id/decision", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : null;
      if (!decision) {
        return res.status(400).json({ ok: false, error: "BAD_DECISION", message: "decision must be 'approved' or 'rejected'" });
      }
      const existing = getOverrideById(String(req.params.id));
      if (!existing) return res.status(404).json({ ok: false, error: "OVERRIDE_NOT_FOUND" });
      // WAVE 24 · ITEM 1. A REJECTION WITH NO RECORDED REASON is a rejection
      // nobody can audit, and `approval_note` is nullable, so nothing stopped
      // one. `createMarkOverride()` already holds the GP proposing an override
      // to a >= 10-character reason (wave9ReportingStore.ts); the admin
      // REFUSING it is held to the same bar. Enforced HERE, at the only route
      // that reaches `decideMarkOverride()`, so the client cannot be the only
      // guard — a curl caller is refused identically. Approval is deliberately
      // NOT gated the same way: "this is correct" is fully expressed by the
      // approver id and timestamp, whereas "this is wrong" is not.
      const note = typeof b.note === "string" ? b.note.trim() : "";
      if (decision === "rejected" && note.length < 10) {
        return res.status(400).json({
          ok: false,
          error: "REJECTION_REASON_REQUIRED",
          message: "a rejection must record a reason of at least 10 characters",
        });
      }
      const out = decideMarkOverride(
        String(req.params.id),
        decision,
        actorOf(req),
        note === "" ? undefined : note,
      );
      res.json({ ok: true, override: out });
    } catch (e) { fail(res, e); }
  });

  /** The thresholds behind every badge, and the ability to change them. */
  app.get("/api/admin/reporting/config", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, config: listW9Config(), thresholds: getMarkThresholds() });
    } catch (e) { fail(res, e); }
  });

  app.put("/api/admin/reporting/config/:key", requireAdmin, (req: Request, res: Response) => {
    try {
      const key = String(req.params.key);
      const b = (req.body ?? {}) as Record<string, unknown>;
      if (b.value === undefined) return res.status(400).json({ ok: false, error: "VALUE_REQUIRED" });
      setW9Config(key, b.value, actorOf(req));
      res.json({ ok: true, key, config: listW9Config() });
    } catch (e) { fail(res, e); }
  });

  /* ======================================================================
   * EN-3 — LP self-serve identity.
   * ==================================================================== */

  /**
   * "Is there a position on this platform recorded against my email under a
   * synthetic id?" Read-only, and derives the candidate id from the CALLER'S
   * OWN session email — never from the request body. A caller cannot probe for
   * someone else's synthetic id here.
   */
  app.get("/api/me/investor-identity", requireAuth, (req: Request, res: Response) => {
    try {
      const c = ctxOf(req);
      const email = String(c?.identity?.email ?? "");
      const userId = actorOf(req);
      const derivedId = email ? deriveExternalInvestorId(email) : null;
      res.json({
        ok: true,
        canonicalUserId: userId,
        email: email || null,
        derivedExternalId: derivedId,
        aliases: listAliasesForUser(userId),
        resolvedIdSet: resolveInvestorIdSet(userId),
      });
    } catch (e) { fail(res, e); }
  });

  /**
   * Claim it. `basis` is always `email_verified` on this route and the alias id
   * is always derived server-side, so the claim reduces to "show me the rows
   * recorded against the hash of the email I am signed in as".
   */
  app.post("/api/me/investor-identity/claim", requireAuth, (req: Request, res: Response) => {
    try {
      const c = ctxOf(req);
      const email = String(c?.identity?.email ?? "");
      if (!email) {
        return res.status(409).json({
          ok: false,
          error: "NO_SESSION_EMAIL",
          message: "your account has no verified email, so there is nothing to match against",
        });
      }
      const out = selfClaimByEmail({ tenantId: tenantOf(req), email, canonicalUserId: actorOf(req) });
      if (!out.alias) {
        return res.status(404).json({
          ok: false,
          error: "NOTHING_TO_CLAIM",
          derivedExternalId: out.derivedId,
          message: "no ledger, roster or cash-flow row is recorded against this email's synthetic id",
        });
      }
      res.status(201).json({ ok: true, alias: out.alias, resolvedIdSet: resolveInvestorIdSet(actorOf(req)) });
    } catch (e) { fail(res, e); }
  });

  /** An LP's own cash flows, across every spelling of their identity. */
  app.get("/api/me/cashflows", requireAuth, (req: Request, res: Response) => {
    try {
      const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
      const flows = listFlowsForInvestor(actorOf(req), vehicleId);
      res.json({ ok: true, flows, total: flows.length, resolvedIdSet: resolveInvestorIdSet(actorOf(req)) });
    } catch (e) { fail(res, e); }
  });

  /** Admin view and manual linkage. Not self-serve; the actor is recorded. */
  app.get("/api/admin/investor-aliases", requireAdmin, (req: Request, res: Response) => {
    try {
      const state = req.query.state === "revoked" ? "revoked" : req.query.state === "active" ? "active" : undefined;
      const rows = listAliases(state ? { state } : undefined);
      res.json({ ok: true, aliases: rows, total: rows.length });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/admin/investor-aliases", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const alias = claimAlias({
        tenantId: tenantOf(req),
        aliasInvestorId: String(b.aliasInvestorId ?? ""),
        canonicalUserId: String(b.canonicalUserId ?? ""),
        matchEmail: typeof b.matchEmail === "string" ? b.matchEmail : null,
        basis: "admin_manual",
        actorId: actorOf(req),
      });
      res.status(201).json({ ok: true, alias });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/admin/investor-aliases/:aliasInvestorId/revoke", requireAdmin, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const out = revokeAlias({
        aliasInvestorId: String(req.params.aliasInvestorId),
        actorId: actorOf(req),
        reason: typeof b.reason === "string" ? b.reason : null,
      });
      if (!out) return res.status(404).json({ ok: false, error: "ALIAS_NOT_FOUND" });
      res.json({ ok: true, alias: out });
    } catch (e) { fail(res, e); }
  });
}
