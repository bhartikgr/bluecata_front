/**
 * WAVE 30 · ENGINE 3 — `spv_template`.
 *
 * ── VERIFIED ABSENT AT SOURCE BEFORE THIS FILE WAS WRITTEN ────────────────
 * A tree-wide grep for `spv_template` / `spvTemplate` / `SpvTemplate` across
 * every `.ts`, `.tsx` and `.sql` (excluding node_modules, the built bundles and
 * .g0-snapshot) returned NOTHING. The only mention anywhere was
 * `docs/WAVE_D_LINE_DELTA_AUDIT.md:121` — "zero `spv_template` hits anywhere",
 * tracked as an expected-but-missing surface. Unlike Engines 1 and 2, this one
 * had no schema either: migration 0177 creates the tables in the same wave.
 *
 * ── WHAT A TEMPLATE IS, AND DELIBERATELY IS NOT ───────────────────────────
 * A template is a saved set of DEFAULTS for the SPV create form. Applying one
 * returns a PREFILL PAYLOAD. It does NOT create an SPV, and this store has no
 * code path that can.
 *
 * That boundary is an AUTHORIZATION boundary, not a stylistic one. SPV creation
 * is gated by the Wave 1c launch sign-off: `POST /api/partner/me/spv` records a
 * durable attested signature (signer legal name + versioned attestation, taken
 * from the SESSION identity, never a client-supplied id) BEFORE any SPV row
 * exists, and fails closed with 500/SIGNOFF_PERSIST_FAILED if that record
 * cannot be written — so an SPV can never exist without its authorization
 * record. A convenient "apply template and launch" shortcut would route
 * straight around that gate and silently undo Wave 1c. Apply therefore hands
 * back values for a form the operator still has to sign.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────
 * All amounts are INTEGER MINOR UNITS and travel with their currency, which is
 * NOT NULL. A bare minor-unit integer is meaningless: 5000 is $50.00 in USD and
 * ¥5,000 in JPY, a zero-decimal currency. Consequences enforced here:
 *
 *   • Nothing is ever summed across templates. There is no total, because a
 *     total across currencies would be a fabricated number. `countsByCurrency`
 *     returns a PER-CURRENCY breakdown instead.
 *   • Absent amounts are NULL, never 0. "No minimum check" and "a minimum check
 *     of zero" are different statements and the UI renders them differently.
 *     `normaliseMinor` maps undefined/null/"" to null and REFUSES to coerce.
 *   • Rendering is `formatMinor(minor, currency)`, never `minor / 100`.
 *     Division by 100 is wrong for JPY by a factor of one hundred.
 *
 * ── CARRY IS AN INTEGER COUNT OF BILLIONTHS, NOT A PERCENT ────────────────
 * `carryFractionScaled` is the carry FRACTION times `CARRY_FRACTION_SCALE`
 * (1e9, `server/lib/money.ts:324`). 20% carry is 200000000.
 *
 * Wave 5 / P-4 is why. The SPV wizard's "Hurdle %" field posted the number 8
 * for an 8% hurdle; the store read it as a fraction and `Math.min(1, n)`
 * clamped it, silently giving the SPV a 100% preferred return. The ambiguity
 * lived in the representation, so the representation is what changed: an
 * integer count of billionths cannot be misread as a percent. The forbidden
 * `n > 1 ? n / 100 : n` "repair" appears nowhere in this file — it cannot
 * distinguish a 1% carry written as 1 from a 100% carry written as 1, and
 * guessing about carry is how LPs get quietly diluted. Out-of-domain values
 * REJECT; they are never clamped, and migration 0177 carries a CHECK
 * constraint so a bypassing writer is refused at the database too.
 *
 * ── NO IN-MEMORY STATE ────────────────────────────────────────────────────
 * Every function reads and writes SQLite. The only module-level variable is the
 * `ensureSchema` memo flag, which caches nothing but "have I already run the
 * idempotent installer this process".
 */
import { randomUUID } from "node:crypto";
import { rawDb } from "./db/connection";
import { isSqlite } from "./db/portable";
import { log } from "./lib/logger";
import { applyWave30SpvTemplateSchema } from "./lib/applyWave30SpvTemplateSchema";
import { CARRY_FRACTION_SCALE } from "./lib/money";
import {
  isSpvJurisdiction,
  isSpvCarryBasis,
  isSpvType,
  isSpvDistributionScope,
  isSpvLpVisibility,
} from "../shared/spvEngine";

/* ── errors ──────────────────────────────────────────────────────────────── */

export class SpvTemplateNotFoundError extends Error {
  readonly code = "SPV_TEMPLATE_NOT_FOUND";
  constructor() {
    super("Template not found for this partner.");
    this.name = "SpvTemplateNotFoundError";
  }
}

export class SpvTemplateValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SpvTemplateValidationError";
  }
}

/* ── schema heal (A-22) ──────────────────────────────────────────────────── */

let _schemaEnsured = false;
/**
 * `connection.ts`'s inline baseline does not create these tables — they did not
 * exist before migration 0177 — and connection.ts is SACRED, so no installer
 * can be registered there. Without this heal a `NODE_ENV=test` `:memory:`
 * database would have no `spv_template`, and the tests would not merely fail:
 * the reads would return empty and PASS VACUOUSLY. Same pattern as
 * `partnerClassificationStore.ensureSchema`.
 */
function ensureSchema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applyWave30SpvTemplateSchema(rawDb() as any);
  } catch (err) {
    log.warn(
      `[spvTemplateStore] schema heal skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* ── types ───────────────────────────────────────────────────────────────── */

export interface SpvTemplateRow {
  id: string;
  partnerId: string;
  name: string;
  description: string | null;
  spvType: string;
  jurisdiction: string;
  carryBasis: string;
  distributionScope: string | null;
  lpVisibility: string | null;
  /** ISO-4217. Never null — a minor-unit amount without its currency is unusable. */
  currency: string;
  /** Integer minor units, or null for "not set". NEVER 0-as-unset. */
  minCheckMinor: number | null;
  targetRaiseMinor: number | null;
  capMinor: number | null;
  /** Carry FRACTION × 1e9, or null. NOT a percent. */
  carryFractionScaled: number | null;
  isArchived: boolean;
  usageCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface SpvTemplateInput {
  name: string;
  description?: string | null;
  spvType?: string | null;
  jurisdiction: string;
  carryBasis: string;
  distributionScope?: string | null;
  lpVisibility?: string | null;
  currency?: string | null;
  minCheckMinor?: number | string | null;
  targetRaiseMinor?: number | string | null;
  capMinor?: number | string | null;
  carryFractionScaled?: number | string | null;
}

/** What `applyTemplate` hands back: the SPV create form's fields, prefilled. */
export interface SpvTemplatePrefill {
  templateId: string;
  templateName: string;
  spvType: string;
  jurisdiction: string;
  carryBasis: string;
  distributionScope: string | null;
  lpVisibility: string | null;
  currency: string;
  minCheckMinor: number | null;
  targetRaiseMinor: number | null;
  capMinor: number | null;
  carryFractionScaled: number | null;
  /**
   * Always false, and asserted false by the tests. Applying a template must
   * never produce an SPV — see the header note on the Wave 1c sign-off gate.
   */
  spvCreated: false;
  applicationId: string;
}

/* ── validation helpers ──────────────────────────────────────────────────── */

function reqStr(v: unknown, code: string, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new SpvTemplateValidationError(code, `${label} is required.`);
  return s;
}

function optStr(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

/**
 * Minor units. Absent stays ABSENT — undefined/null/"" become null, never 0.
 * Anything present must be a non-negative safe integer; a fractional value is
 * REJECTED rather than rounded, because rounding a money amount silently is
 * precisely the class of defect the money rules exist to prevent.
 */
function normaliseMinor(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new SpvTemplateValidationError("INVALID_AMOUNT", `${label} must be a number.`);
  }
  if (!Number.isInteger(n)) {
    throw new SpvTemplateValidationError(
      "INVALID_AMOUNT",
      `${label} must be an integer number of minor units (no fractional minor units).`,
    );
  }
  if (n < 0) {
    throw new SpvTemplateValidationError("INVALID_AMOUNT", `${label} cannot be negative.`);
  }
  if (!Number.isSafeInteger(n)) {
    throw new SpvTemplateValidationError("INVALID_AMOUNT", `${label} is out of range.`);
  }
  return n;
}

/**
 * Carry, as an integer count of billionths of 1 (fraction × 1e9).
 *
 * REJECTS out of domain. It does NOT clamp, and it does NOT apply the forbidden
 * `n > 1 ? n / 100 : n` guess. A caller sending 20 means 0.00000002 carry and
 * will be told so by the round-trip, rather than having 20% invented for them.
 */
function normaliseCarryScaled(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new SpvTemplateValidationError(
      "INVALID_CARRY",
      `Carry must be an integer fraction scaled by ${CARRY_FRACTION_SCALE} (20% carry = ${
        0.2 * CARRY_FRACTION_SCALE
      }).`,
    );
  }
  if (n < 0 || n > CARRY_FRACTION_SCALE) {
    throw new SpvTemplateValidationError(
      "INVALID_CARRY",
      `Carry must be between 0 and ${CARRY_FRACTION_SCALE} (0% to 100%). Received ${n}.`,
    );
  }
  return n;
}

/**
 * Currency. Stored uppercase, exactly three letters. Not validated against a
 * closed list here — `server/lib/currency.ts` owns the minor-unit exponent
 * table and unknown codes fall back safely there — but the SHAPE is enforced so
 * a null/blank can never reach a column that other code trusts to be present.
 */
function normaliseCurrency(v: unknown): string {
  const s = (typeof v === "string" ? v.trim() : "") || "USD";
  if (!/^[A-Za-z]{3}$/.test(s)) {
    throw new SpvTemplateValidationError(
      "INVALID_CURRENCY",
      `Currency must be a 3-letter ISO-4217 code. Received "${s}".`,
    );
  }
  return s.toUpperCase();
}

/**
 * Structure fields are validated against the SAME shared predicates the SPV
 * create path uses (`shared/spvEngine.ts`). A template whose jurisdiction would
 * be rejected by `createSpv` is a trap: it saves cleanly, sits in the picker,
 * and fails at the moment the operator is trying to launch a vehicle. Refusing
 * it at save time is the whole value of validating here.
 */
function validateStructure(input: {
  spvType: string;
  jurisdiction: string;
  carryBasis: string;
  distributionScope: string | null;
  lpVisibility: string | null;
}): void {
  if (!isSpvType(input.spvType)) {
    throw new SpvTemplateValidationError("INVALID_SPV_TYPE", `Unknown SPV type "${input.spvType}".`);
  }
  if (!isSpvJurisdiction(input.jurisdiction)) {
    throw new SpvTemplateValidationError(
      "INVALID_JURISDICTION",
      `Unknown jurisdiction "${input.jurisdiction}".`,
    );
  }
  if (!isSpvCarryBasis(input.carryBasis)) {
    throw new SpvTemplateValidationError(
      "INVALID_CARRY_BASIS",
      `Unknown carry basis "${input.carryBasis}".`,
    );
  }
  if (input.distributionScope !== null && !isSpvDistributionScope(input.distributionScope)) {
    throw new SpvTemplateValidationError(
      "INVALID_DISTRIBUTION_SCOPE",
      `Unknown distribution scope "${input.distributionScope}".`,
    );
  }
  if (input.lpVisibility !== null && !isSpvLpVisibility(input.lpVisibility)) {
    throw new SpvTemplateValidationError(
      "INVALID_LP_VISIBILITY",
      `Unknown LP visibility "${input.lpVisibility}".`,
    );
  }
}

/* ── tenant resolution ───────────────────────────────────────────────────── */

/**
 * DB-driven, per the standing rule against hardcoding. The tenant is read from
 * the partner's own organisation row rather than assumed to be the platform
 * tenant, so a template written for a partner on a non-default tenant lands on
 * that tenant. Falls back to the column default only when the organisation row
 * is genuinely absent.
 */
function resolveTenantId(partnerId: string): string {
  const row = rawDb()
    .prepare(`SELECT tenant_id FROM partner_organizations WHERE id = ?`)
    .get(partnerId) as { tenant_id?: string } | undefined;
  return row?.tenant_id || "tenant_platform";
}

/* ── hydration ───────────────────────────────────────────────────────────── */

function hydrate(r: Record<string, any>): SpvTemplateRow {
  return {
    id: String(r.id),
    partnerId: String(r.partner_id),
    name: String(r.name),
    description: r.description ?? null,
    spvType: String(r.spv_type),
    jurisdiction: String(r.jurisdiction),
    carryBasis: String(r.carry_basis),
    distributionScope: r.distribution_scope ?? null,
    lpVisibility: r.lp_visibility ?? null,
    currency: String(r.currency),
    // `?? null` and NOT `|| null` — `|| null` would turn a legitimate stored 0
    // into "not set", losing the distinction the column exists to preserve.
    minCheckMinor: r.min_check_minor ?? null,
    targetRaiseMinor: r.target_raise_minor ?? null,
    capMinor: r.cap_minor ?? null,
    carryFractionScaled: r.carry_fraction_scaled ?? null,
    isArchived: Number(r.is_archived) === 1,
    usageCount: Number(r.usage_count ?? 0),
    lastAppliedAt: r.last_applied_at ?? null,
    createdAt: String(r.created_at),
    createdBy: r.created_by ?? null,
    updatedAt: String(r.updated_at),
  };
}

const SELECT_COLS = `
  id, partner_id, name, description, spv_type, jurisdiction, carry_basis,
  distribution_scope, lp_visibility, currency, min_check_minor,
  target_raise_minor, cap_minor, carry_fraction_scaled, is_archived,
  usage_count, last_applied_at, created_at, created_by, updated_at`;

/* ── reads ───────────────────────────────────────────────────────────────── */

/**
 * EVERY read is partner-scoped in SQL. The scoping is not applied in JavaScript
 * after the fact, because a filter that lives outside the query is one early
 * return away from being skipped.
 */
export function listTemplatesForPartner(
  partnerId: string,
  opts: { includeArchived?: boolean } = {},
): SpvTemplateRow[] {
  ensureSchema();
  const pid = reqStr(partnerId, "PARTNER_REQUIRED", "Partner");
  const includeArchived = opts.includeArchived === true;
  const rows = rawDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM spv_template
        WHERE partner_id = ? AND deleted_at IS NULL
          AND (? = 1 OR is_archived = 0)
        ORDER BY is_archived ASC, updated_at DESC, id ASC`,
    )
    .all(pid, includeArchived ? 1 : 0) as Array<Record<string, any>>;
  return rows.map(hydrate);
}

/**
 * Cross-partner reads return NOT FOUND, never FORBIDDEN.
 *
 * A 403 would confirm the id exists, turning the endpoint into an enumeration
 * oracle: a caller could walk ids and learn which other firms hold templates.
 * The refusal for "another partner's real template" is byte-identical to the
 * refusal for "no such id anywhere", so the error carries no information.
 */
export function getTemplate(partnerId: string, templateId: string): SpvTemplateRow {
  ensureSchema();
  const pid = reqStr(partnerId, "PARTNER_REQUIRED", "Partner");
  const tid = reqStr(templateId, "TEMPLATE_REQUIRED", "Template id");
  const row = rawDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM spv_template
        WHERE id = ? AND partner_id = ? AND deleted_at IS NULL`,
    )
    .get(tid, pid) as Record<string, any> | undefined;
  if (!row) throw new SpvTemplateNotFoundError();
  return hydrate(row);
}

/**
 * Counts grouped BY CURRENCY, deliberately. There is no "total templates value"
 * anywhere in this engine: adding a JPY minimum check to a USD one produces a
 * number that is not money in any currency. The UI renders one row per
 * currency for the same reason.
 */
export function countsByCurrency(
  partnerId: string,
): Array<{ currency: string; templates: number; withMinCheck: number }> {
  ensureSchema();
  const pid = reqStr(partnerId, "PARTNER_REQUIRED", "Partner");
  const rows = rawDb()
    .prepare(
      `SELECT currency,
              COUNT(*) AS templates,
              SUM(CASE WHEN min_check_minor IS NOT NULL THEN 1 ELSE 0 END) AS with_min_check
         FROM spv_template
        WHERE partner_id = ? AND deleted_at IS NULL AND is_archived = 0
        GROUP BY currency
        ORDER BY currency ASC`,
    )
    .all(pid) as Array<Record<string, any>>;
  return rows.map((r) => ({
    currency: String(r.currency),
    templates: Number(r.templates ?? 0),
    withMinCheck: Number(r.with_min_check ?? 0),
  }));
}

/** Append-only application log for one template, newest first. */
export function listApplications(
  partnerId: string,
  templateId: string,
): Array<{ id: string; appliedBy: string | null; resultingSpvId: string | null; appliedAt: string }> {
  ensureSchema();
  // Resolving through getTemplate keeps the partner scope on ONE code path: an
  // unscoped application query here would leak another firm's usage history.
  const tpl = getTemplate(partnerId, templateId);
  const rows = rawDb()
    .prepare(
      `SELECT id, applied_by, resulting_spv_id, applied_at
         FROM spv_template_application
        WHERE template_id = ? AND partner_id = ?
        ORDER BY applied_at DESC, id ASC`,
    )
    .all(tpl.id, partnerId) as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: String(r.id),
    appliedBy: r.applied_by ?? null,
    resultingSpvId: r.resulting_spv_id ?? null,
    appliedAt: String(r.applied_at),
  }));
}

/**
 * Is this insert failure the partial unique index on (partner_id, name)?
 *
 * EXPORTED, and pure, DELIBERATELY. Inlined in the catch block this predicate
 * was UNFALSIFIABLE: mutation testing (M14) replaced it with the loose
 * `/UNIQUE|constraint/i` pattern that Wave 28's case (15) shipped — the one
 * that happily matched a NOT NULL error thrown on every run, so the check
 * passed while checking nothing — and the mutant SURVIVED the whole harness.
 * It survived not because the store was fine either way but because no input
 * to `createTemplate` can produce a NON-unique database error: the store
 * pre-validates every other column, so the wrong branch was unreachable from
 * outside and therefore untestable from outside.
 *
 * Lifting it out makes the negative pole assertable. A test can now hand it a
 * NOT NULL error directly and require a `false`, which kills M14.
 *
 * The match is on the driver's STRUCTURED code plus BOTH offending column
 * names. `SQLITE_CONSTRAINT_NOTNULL` cannot reach the true branch, and
 * requiring both columns means a unique violation on some other index is not
 * mislabelled as a duplicate name either. (The index NAME would be a more
 * precise anchor, but SQLite reports the columns rather than the index for a
 * UNIQUE violation — verified by execution against the real driver.)
 */
export function isDuplicateNameError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const sqliteCode = String((err as any)?.code ?? "");
  return (
    sqliteCode === "SQLITE_CONSTRAINT_UNIQUE" &&
    msg.includes("spv_template.partner_id") &&
    msg.includes("spv_template.name")
  );
}

/* ── writes ──────────────────────────────────────────────────────────────── */

export function createTemplate(
  partnerId: string,
  input: SpvTemplateInput,
  actor?: string | null,
): SpvTemplateRow {
  ensureSchema();
  const pid = reqStr(partnerId, "PARTNER_REQUIRED", "Partner");
  const name = reqStr(input?.name, "NAME_REQUIRED", "Template name");
  const spvType = optStr(input?.spvType) ?? "spv";
  const jurisdiction = reqStr(input?.jurisdiction, "JURISDICTION_REQUIRED", "Jurisdiction");
  // No default for carry basis — the SPV create path requires the GP to choose
  // it explicitly ("carry_basis has NO default", spvEngineStore:373). A
  // template that quietly picked one would defeat that deliberate friction.
  const carryBasis = reqStr(input?.carryBasis, "CARRY_BASIS_REQUIRED", "Carry basis");
  const distributionScope = optStr(input?.distributionScope);
  const lpVisibility = optStr(input?.lpVisibility);
  validateStructure({ spvType, jurisdiction, carryBasis, distributionScope, lpVisibility });

  const currency = normaliseCurrency(input?.currency);
  const minCheckMinor = normaliseMinor(input?.minCheckMinor, "Minimum check");
  const targetRaiseMinor = normaliseMinor(input?.targetRaiseMinor, "Target raise");
  const capMinor = normaliseMinor(input?.capMinor, "Cap");
  const carryFractionScaled = normaliseCarryScaled(input?.carryFractionScaled);

  if (capMinor !== null && targetRaiseMinor !== null && capMinor < targetRaiseMinor) {
    throw new SpvTemplateValidationError(
      "CAP_BELOW_TARGET",
      "Cap cannot be below the target raise.",
    );
  }

  const now = new Date().toISOString();
  const id = `spvtpl_${randomUUID()}`;
  try {
    rawDb()
      .prepare(
        `INSERT INTO spv_template
           (id, tenant_id, partner_id, name, description, spv_type, jurisdiction,
            carry_basis, distribution_scope, lp_visibility, currency,
            min_check_minor, target_raise_minor, cap_minor, carry_fraction_scaled,
            is_archived, usage_count, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      )
      .run(
        id,
        resolveTenantId(pid),
        pid,
        name,
        optStr(input?.description),
        spvType,
        jurisdiction,
        carryBasis,
        distributionScope,
        lpVisibility,
        currency,
        minCheckMinor,
        targetRaiseMinor,
        capMinor,
        carryFractionScaled,
        now,
        optStr(actor),
        now,
      );
  } catch (err) {
    if (isDuplicateNameError(err)) {
      throw new SpvTemplateValidationError(
        "DUPLICATE_NAME",
        `You already have a template named "${name}".`,
      );
    }
    throw err;
  }
  return getTemplate(pid, id);
}

export function updateTemplate(
  partnerId: string,
  templateId: string,
  input: Partial<SpvTemplateInput>,
): SpvTemplateRow {
  ensureSchema();
  // Existence + ownership resolved first, so a cross-partner id 404s BEFORE any
  // write is attempted rather than updating zero rows and reporting success.
  const existing = getTemplate(partnerId, templateId);

  const name = input?.name === undefined ? existing.name : reqStr(input.name, "NAME_REQUIRED", "Template name");
  const spvType = input?.spvType === undefined ? existing.spvType : (optStr(input.spvType) ?? "spv");
  const jurisdiction =
    input?.jurisdiction === undefined
      ? existing.jurisdiction
      : reqStr(input.jurisdiction, "JURISDICTION_REQUIRED", "Jurisdiction");
  const carryBasis =
    input?.carryBasis === undefined
      ? existing.carryBasis
      : reqStr(input.carryBasis, "CARRY_BASIS_REQUIRED", "Carry basis");
  const distributionScope =
    input?.distributionScope === undefined ? existing.distributionScope : optStr(input.distributionScope);
  const lpVisibility =
    input?.lpVisibility === undefined ? existing.lpVisibility : optStr(input.lpVisibility);
  validateStructure({ spvType, jurisdiction, carryBasis, distributionScope, lpVisibility });

  const currency = input?.currency === undefined ? existing.currency : normaliseCurrency(input.currency);
  const minCheckMinor =
    input?.minCheckMinor === undefined ? existing.minCheckMinor : normaliseMinor(input.minCheckMinor, "Minimum check");
  const targetRaiseMinor =
    input?.targetRaiseMinor === undefined
      ? existing.targetRaiseMinor
      : normaliseMinor(input.targetRaiseMinor, "Target raise");
  const capMinor = input?.capMinor === undefined ? existing.capMinor : normaliseMinor(input.capMinor, "Cap");
  const carryFractionScaled =
    input?.carryFractionScaled === undefined
      ? existing.carryFractionScaled
      : normaliseCarryScaled(input.carryFractionScaled);

  if (capMinor !== null && targetRaiseMinor !== null && capMinor < targetRaiseMinor) {
    throw new SpvTemplateValidationError("CAP_BELOW_TARGET", "Cap cannot be below the target raise.");
  }

  rawDb()
    .prepare(
      `UPDATE spv_template
          SET name = ?, description = ?, spv_type = ?, jurisdiction = ?, carry_basis = ?,
              distribution_scope = ?, lp_visibility = ?, currency = ?, min_check_minor = ?,
              target_raise_minor = ?, cap_minor = ?, carry_fraction_scaled = ?, updated_at = ?
        WHERE id = ? AND partner_id = ? AND deleted_at IS NULL`,
    )
    .run(
      name,
      input?.description === undefined ? existing.description : optStr(input.description),
      spvType,
      jurisdiction,
      carryBasis,
      distributionScope,
      lpVisibility,
      currency,
      minCheckMinor,
      targetRaiseMinor,
      capMinor,
      carryFractionScaled,
      new Date().toISOString(),
      existing.id,
      partnerId,
    );
  return getTemplate(partnerId, existing.id);
}

/**
 * Archive, NOT delete. An archived template stops appearing in the create-form
 * picker but its application history stays readable, so "which template did we
 * launch that vehicle from?" survives the template falling out of use. Reversible.
 */
export function setArchived(partnerId: string, templateId: string, archived: boolean): SpvTemplateRow {
  ensureSchema();
  const existing = getTemplate(partnerId, templateId);
  rawDb()
    .prepare(
      `UPDATE spv_template SET is_archived = ?, updated_at = ?
        WHERE id = ? AND partner_id = ? AND deleted_at IS NULL`,
    )
    .run(archived ? 1 : 0, new Date().toISOString(), existing.id, partnerId);
  return getTemplate(partnerId, existing.id);
}

/**
 * Soft delete. Sets `deleted_at`, which also releases the name for re-use
 * because the unique index is partial (`WHERE deleted_at IS NULL`).
 */
export function deleteTemplate(partnerId: string, templateId: string): boolean {
  ensureSchema();
  const existing = getTemplate(partnerId, templateId);
  const res = rawDb()
    .prepare(
      `UPDATE spv_template SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND partner_id = ? AND deleted_at IS NULL`,
    )
    .run(new Date().toISOString(), new Date().toISOString(), existing.id, partnerId);
  return Number((res as any)?.changes ?? 0) > 0;
}

/**
 * Apply a template: return prefill values and record the application.
 *
 * This function CANNOT create an SPV and contains no path that writes to
 * `spvs`. `spvCreated` is hardcoded false and the tests assert both that flag
 * and the `spvs` row count across the call. See the header note: the Wave 1c
 * launch sign-off must stay on the critical path, so the operator carries these
 * values into the signed create flow themselves.
 *
 * An archived template refuses to apply — archiving exists precisely to take a
 * structure out of circulation, and letting it still be applied by direct id
 * would make the control decorative.
 */
export function applyTemplate(
  partnerId: string,
  templateId: string,
  actor?: string | null,
): SpvTemplatePrefill {
  ensureSchema();
  const tpl = getTemplate(partnerId, templateId);
  if (tpl.isArchived) {
    throw new SpvTemplateValidationError(
      "TEMPLATE_ARCHIVED",
      "This template is archived. Restore it before applying.",
    );
  }
  const now = new Date().toISOString();
  const applicationId = `spvtplapp_${randomUUID()}`;
  const db = rawDb();
  // One transaction: the log row and the denormalised counter must not be able
  // to disagree. `usage_count` is a convenience for the list view;
  // `spv_template_application` is the record of truth and the two are
  // reconcilable by construction because they are written together.
  const tx = (db as any).transaction(() => {
    db.prepare(
      `INSERT INTO spv_template_application
         (id, tenant_id, template_id, partner_id, applied_by, resulting_spv_id, applied_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(applicationId, resolveTenantId(partnerId), tpl.id, partnerId, optStr(actor), now);
    db.prepare(
      `UPDATE spv_template SET usage_count = usage_count + 1, last_applied_at = ?, updated_at = ?
        WHERE id = ? AND partner_id = ?`,
    ).run(now, now, tpl.id, partnerId);
  });
  tx();

  return {
    templateId: tpl.id,
    templateName: tpl.name,
    spvType: tpl.spvType,
    jurisdiction: tpl.jurisdiction,
    carryBasis: tpl.carryBasis,
    distributionScope: tpl.distributionScope,
    lpVisibility: tpl.lpVisibility,
    currency: tpl.currency,
    minCheckMinor: tpl.minCheckMinor,
    targetRaiseMinor: tpl.targetRaiseMinor,
    capMinor: tpl.capMinor,
    carryFractionScaled: tpl.carryFractionScaled,
    spvCreated: false,
    applicationId,
  };
}

/**
 * Link an application to the SPV it eventually produced. Separate from
 * `applyTemplate` on purpose: the SPV does not exist yet at apply time, and
 * many applications never become one. Partner-scoped, and refuses to overwrite
 * an existing link so the audit trail cannot be rewritten.
 */
export function linkApplicationToSpv(
  partnerId: string,
  applicationId: string,
  spvId: string,
): boolean {
  ensureSchema();
  const pid = reqStr(partnerId, "PARTNER_REQUIRED", "Partner");
  const aid = reqStr(applicationId, "APPLICATION_REQUIRED", "Application id");
  const sid = reqStr(spvId, "SPV_REQUIRED", "SPV id");
  const res = rawDb()
    .prepare(
      `UPDATE spv_template_application SET resulting_spv_id = ?
        WHERE id = ? AND partner_id = ? AND resulting_spv_id IS NULL`,
    )
    .run(sid, aid, pid);
  return Number((res as any)?.changes ?? 0) > 0;
}
