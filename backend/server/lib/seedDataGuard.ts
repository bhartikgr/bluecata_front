/**
 * W3.1 — Seed/test-data guard for admin list surfaces (NON-sacred).
 *
 * Presentation/admin-list filter ONLY. Hides QA/test seed rows from routine
 * admin list views when HIDE_SEED_DATA=true, without deleting rows, changing
 * eligibility, changing bootstrap, or changing audit history. Filtering is
 * deterministic and explainable: callers should surface `hiddenSeedCount` /
 * `hideSeedData` in response metadata so operators can tell why rows
 * disappeared.
 *
 * Recognized seed signal is INTENTIONALLY narrow to avoid silent drops of
 * real data:
 *   - explicit seed flags: isSeed === true, is_seed === 1/true,
 *     metadata.seed === true, source === "seed"
 *   - the reserved QA email domain @capavate-qa.local (case-insensitive)
 *
 * Does NOT infer seed status from weak signals like a name containing "test".
 */

/** True only when HIDE_SEED_DATA is the literal string "true". Never infers
 *  from NODE_ENV. */
export function hideSeedDataEnabled(): boolean {
  return process.env.HIDE_SEED_DATA === "true";
}

const QA_EMAIL_RE = /@capavate-qa\.local$/i;

/** True when the given email belongs to the reserved QA domain. */
export function isQaEmail(email?: string | null): boolean {
  if (!email) return false;
  const trimmed = String(email).trim();
  if (!trimmed) return false;
  return QA_EMAIL_RE.test(trimmed.toLowerCase());
}

/**
 * True when a row carries an EXPLICIT seed flag. Deliberately does not infer
 * seed status from names/text — that would risk hiding real rows.
 */
export function isSeedRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.isSeed === true) return true;
  if (row.is_seed === 1 || row.is_seed === true) return true;
  const metadata = row.metadata as Record<string, unknown> | null | undefined;
  if (metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).seed === true) return true;
  if (row.source === "seed") return true;
  return false;
}

export interface FilterSeedRowsOptions {
  /** Field names on each row to check for a QA email address. */
  emailFields: string[];
}

export interface FilterSeedRowsResult<T> {
  rows: T[];
  hiddenSeedCount: number;
}

/**
 * Filters seed/QA rows out of `rows` when `hideSeedDataEnabled()` is true.
 * When disabled, returns all rows unchanged with hiddenSeedCount === 0 so
 * callers can always report accurate metadata regardless of the flag state.
 */
export function filterSeedRows<T extends Record<string, unknown>>(
  rows: T[],
  opts: FilterSeedRowsOptions,
): FilterSeedRowsResult<T> {
  const shouldHide = (row: T): boolean => {
    if (isSeedRow(row)) return true;
    for (const field of opts.emailFields) {
      const val = row[field];
      if (typeof val === "string" && isQaEmail(val)) return true;
    }
    return false;
  };

  if (!hideSeedDataEnabled()) {
    return { rows, hiddenSeedCount: 0 };
  }

  let hiddenSeedCount = 0;
  const kept: T[] = [];
  for (const row of rows) {
    if (shouldHide(row)) {
      hiddenSeedCount++;
    } else {
      kept.push(row);
    }
  }
  return { rows: kept, hiddenSeedCount };
}
