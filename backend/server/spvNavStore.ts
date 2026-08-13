/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — NAV STORE.
 *
 * The DB-backed half of the NAV capability. `server/lib/spvNav.ts` holds the
 * pure computation (exact shares × price arithmetic, refusal statuses,
 * per-LP allocation); this file reads the real rows it computes over and
 * persists explicit freezes.
 *
 * NO IN-MEMORY STATE. Every function reads and writes SQLite. The only
 * module-level variable is the `ensureSchema` memo flag, which caches nothing
 * except "have I already run the idempotent installer in this process".
 *
 * WHERE THE DATA COMES FROM — named sinks, because rule 2 is "fix where the
 * data flows, name the sink, prove it by execution":
 *   holdings  <- `spv_deployment`   (shares TEXT, amount_minor, currency, status)
 *   marks     <- `effectiveMarkForCompany()` in server/wave9ReportingStore.ts,
 *                which is the SAME function the investor mark-history surface
 *                uses, so a NAV and a mark badge can never disagree
 *   register  <- `spv_subscription` rows with status 'committed', matching
 *                `spvEngineStore.committedRegister`
 *   freezes   -> `spv_nav_snapshot` (migration 0178)
 *
 * A DERIVED NAV IS NOT PERSISTED ON READ. Reading a NAV must never write one:
 * a frozen NAV is a governance artifact with a named signer, and manufacturing
 * one as a side effect of a page load would put an unsigned number into the
 * audit record.
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { log } from "./lib/logger";
import { applySpvInstitutionalSchema } from "./lib/applySpvInstitutionalSchema";
import {
  computeSpvNav,
  allocateLpNavShares,
  type SpvNavResult,
  type NavHoldingInput,
  type LpNavShare,
} from "./lib/spvNav";
import { effectiveMarkForCompany, getMarkThresholds } from "./wave9ReportingStore";

/* ── schema heal (A-22) ──────────────────────────────────────────────────── */

let _schemaEnsured = false;
/**
 * `connection.ts`'s inline baseline does not create `spv_nav_snapshot` — it did
 * not exist before migration 0178 — and connection.ts is SACRED, so no
 * installer can be registered there. Without this heal a `NODE_ENV=test`
 * `:memory:` database has no table, and the reads would not merely fail: they
 * would return empty and PASS VACUOUSLY. Same pattern as
 * `spvTemplateStore.ensureSchema`.
 */
function ensureSchema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applySpvInstitutionalSchema(rawDb() as any);
  } catch (err) {
    log.warn(`[spvNavStore] schema heal skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Exported so tests can force the heal on a freshly opened database. */
export function ensureNavSchemaForTests(): void {
  _schemaEnsured = false;
  ensureSchema();
}

/* ── errors ──────────────────────────────────────────────────────────────── */

export class SpvNavNotFoundError extends Error {
  readonly code = "SPV_NOT_FOUND";
  constructor() {
    super("SPV not found.");
    this.name = "SpvNavNotFoundError";
  }
}

/* ── row readers ─────────────────────────────────────────────────────────── */

interface SpvBasics {
  id: string;
  sponsorPartnerId: string;
  currency: string;
  tenantId: string;
}

/**
 * Vehicle basics WITHOUT a partner scope. Callers are responsible for the
 * authorization decision; every route in Wave 32 does it before calling in, and
 * a cross-tenant miss is rendered as 404 (rule 6 — no enumeration oracle).
 */
export function spvBasics(spvId: string): SpvBasics | null {
  const row = rawDb()
    .prepare(`SELECT s.id, s.sponsor_partner_id, s.currency, p.tenant_id
              FROM spv s LEFT JOIN partner_organizations p ON p.id = s.sponsor_partner_id
              WHERE s.id = ?`)
    .get(spvId) as
    | { id: string; sponsor_partner_id: string; currency: string; tenant_id?: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sponsorPartnerId: row.sponsor_partner_id,
    currency: row.currency || "USD",
    tenantId: row.tenant_id || "tenant_platform",
  };
}

/** Deployed holdings of a vehicle, straight from `spv_deployment`. */
export function navHoldingsForSpv(spvId: string): NavHoldingInput[] {
  const rows = rawDb()
    .prepare(`SELECT id, company_id, shares, amount_minor, currency, status
              FROM spv_deployment WHERE spv_id = ? ORDER BY created_at ASC, id ASC`)
    .all(spvId) as Array<{
      id: string; company_id: string; shares: string | null;
      amount_minor: number; currency: string; status: string;
    }>;
  return rows.map((r) => ({
    deploymentId: r.id,
    companyId: r.company_id,
    shares: r.shares === null || r.shares === "" ? null : String(r.shares),
    costMinor: Number(r.amount_minor ?? 0),
    currency: r.currency || "USD",
    status: String(r.status ?? ""),
  }));
}

/** Committed register, matching `spvEngineStore.committedRegister`'s predicate. */
export function committedRegisterRows(spvId: string): Array<{ investorId: string; commitmentMinor: number }> {
  const rows = rawDb()
    .prepare(`SELECT investor_id, commitment_minor FROM spv_subscription
              WHERE spv_id = ? AND status = 'committed' ORDER BY created_at ASC, id ASC`)
    .all(spvId) as Array<{ investor_id: string; commitment_minor: number }>;
  return rows.map((r) => ({ investorId: r.investor_id, commitmentMinor: Number(r.commitment_minor ?? 0) }));
}

/* ── derivation ──────────────────────────────────────────────────────────── */

/**
 * The LIVE NAV of a vehicle, derived now from real rows. Writes nothing.
 */
export function deriveNav(spvId: string, asOfDate?: string): SpvNavResult {
  ensureSchema();
  const spv = spvBasics(spvId);
  if (!spv) throw new SpvNavNotFoundError();
  const asOf = (asOfDate ?? new Date().toISOString()).slice(0, 10);
  const t = getMarkThresholds();
  return computeSpvNav({
    spvId,
    asOfDate: asOf,
    vehicleCurrency: spv.currency,
    holdings: navHoldingsForSpv(spvId),
    markLookup: (companyId, at) => effectiveMarkForCompany(companyId, { asOf: at }),
    thresholds: { staleWarnDays: t.staleWarnDays, staleExpiredDays: t.staleExpiredDays },
  });
}

/** Live NAV plus each committed LP's allocated share of it. */
export function deriveNavWithLpShares(
  spvId: string,
  asOfDate?: string,
): { nav: SpvNavResult; lpShares: LpNavShare[] } {
  const nav = deriveNav(spvId, asOfDate);
  return { nav, lpShares: allocateLpNavShares(nav.totalNavMinor, committedRegisterRows(spvId)) };
}

/**
 * ONE LP's own NAV position, and nothing else.
 *
 * LP PRIVACY (WAIVER-4). This returns a single entry and never the register.
 * The allocation is nonetheless computed over the WHOLE register — an LP's
 * share of a total is only meaningful relative to every other commitment — and
 * then filtered to the caller. The other LPs' figures exist for microseconds
 * inside this function and are never returned, logged or serialised. Returning
 * null (not an error) for a non-LP keeps the caller's refusal shape uniform.
 */
export function lpOwnNavPosition(spvId: string, investorId: string, asOfDate?: string): {
  nav: SpvNavResult;
  own: LpNavShare | null;
} {
  const { nav, lpShares } = deriveNavWithLpShares(spvId, asOfDate);
  const own = lpShares.find((s) => s.investorId === investorId) ?? null;
  return { nav, own };
}

/* ── freezing ────────────────────────────────────────────────────────────── */

export interface FrozenNavRow {
  id: string;
  spvId: string;
  asOfDate: string;
  totalNavMinor: number | null;
  currency: string;
  status: string;
  worstMarkBadge: string | null;
  markedHoldings: number;
  unmarkedHoldings: number;
  holdings: unknown;
  staleWarnDays: number;
  staleExpiredDays: number;
  frozenBy: string;
  frozenAt: string;
  supersededAt: string | null;
}

function mapFrozen(r: any): FrozenNavRow {
  let holdings: unknown = [];
  try { holdings = JSON.parse(r.holdings_json ?? "[]"); } catch { holdings = []; }
  return {
    id: r.id,
    spvId: r.spv_id,
    asOfDate: r.as_of_date,
    totalNavMinor: r.total_nav_minor === null || r.total_nav_minor === undefined ? null : Number(r.total_nav_minor),
    currency: r.currency,
    status: r.status,
    worstMarkBadge: r.worst_mark_badge ?? null,
    markedHoldings: Number(r.marked_holdings ?? 0),
    unmarkedHoldings: Number(r.unmarked_holdings ?? 0),
    holdings,
    staleWarnDays: Number(r.stale_warn_days ?? 0),
    staleExpiredDays: Number(r.stale_expired_days ?? 0),
    frozenBy: r.frozen_by,
    frozenAt: r.frozen_at,
    supersededAt: r.superseded_at ?? null,
  };
}

/**
 * Freeze the current derived NAV as a governance artifact.
 *
 * A REFUSAL IS FROZEN TOO, deliberately. "As of 30 June we could not value this
 * vehicle because two holdings were unmarked" is a true and useful record; a
 * freeze that silently declines to record itself leaves a gap in the series
 * that reads as "nobody looked". `total_nav_minor` is NULL in that row, never 0.
 *
 * Superseding, not overwriting: an earlier freeze for the same as-of date is
 * stamped `superseded_at` and kept. Restating a NAV is a normal fund-admin
 * event and the prior figure must remain auditable.
 */
export function freezeNav(args: {
  spvId: string;
  asOfDate?: string;
  frozenBy: string;
}): FrozenNavRow {
  ensureSchema();
  const spv = spvBasics(args.spvId);
  if (!spv) throw new SpvNavNotFoundError();
  const nav = deriveNav(args.spvId, args.asOfDate);
  const now = new Date().toISOString();
  const db = rawDb();
  db.prepare(
    `UPDATE spv_nav_snapshot SET superseded_at = ?
     WHERE spv_id = ? AND as_of_date = ? AND superseded_at IS NULL`,
  ).run(now, args.spvId, nav.asOfDate);
  const id = `nav_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  db.prepare(
    `INSERT INTO spv_nav_snapshot
       (id, tenant_id, spv_id, as_of_date, total_nav_minor, currency, status, worst_mark_badge,
        marked_holdings, unmarked_holdings, holdings_json, stale_warn_days, stale_expired_days,
        frozen_by, frozen_at, superseded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
  ).run(
    id, spv.tenantId, args.spvId, nav.asOfDate, nav.totalNavMinor, nav.currency, nav.status,
    nav.worstMarkBadge, nav.markedHoldings, nav.unmarkedHoldings, JSON.stringify(nav.holdings),
    nav.thresholds.staleWarnDays, nav.thresholds.staleExpiredDays, args.frozenBy, now,
  );
  log.info(`[wave32] NAV frozen spv=${args.spvId} asOf=${nav.asOfDate} status=${nav.status}`);
  return getFrozenNav(id)!;
}

export function getFrozenNav(id: string): FrozenNavRow | null {
  ensureSchema();
  const r = rawDb().prepare(`SELECT * FROM spv_nav_snapshot WHERE id = ?`).get(id);
  return r ? mapFrozen(r) : null;
}

/** Full freeze history for a vehicle, newest as-of date first. */
export function listFrozenNavs(spvId: string): FrozenNavRow[] {
  ensureSchema();
  const rows = rawDb()
    .prepare(`SELECT * FROM spv_nav_snapshot WHERE spv_id = ?
              ORDER BY as_of_date DESC, frozen_at DESC`)
    .all(spvId) as any[];
  return rows.map(mapFrozen);
}

/** The current (non-superseded) freeze for a vehicle, if any. */
export function latestFrozenNav(spvId: string): FrozenNavRow | null {
  ensureSchema();
  const r = rawDb()
    .prepare(`SELECT * FROM spv_nav_snapshot WHERE spv_id = ? AND superseded_at IS NULL
              ORDER BY as_of_date DESC, frozen_at DESC LIMIT 1`)
    .get(spvId);
  return r ? mapFrozen(r) : null;
}
