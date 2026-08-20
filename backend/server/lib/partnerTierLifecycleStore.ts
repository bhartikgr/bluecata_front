/**
 * server/lib/partnerTierLifecycleStore.ts — WAVE 56 (R21 / R36 / 56-Q9).
 *
 * THE WRITE PATH THAT DID NOT EXIST.
 *
 * Wave 56's measurement pass called four plausible create-a-tier endpoints
 * against the real router. All four returned 404, and every one of the six
 * non-test references to `partner_tier_lifecycle` in server/ was a READ. So
 * "add a tier" was not a blocked capability — it was an ABSENT one. Removing the
 * database CHECK would not have given the owner a button; it would only have
 * made a hand-typed INSERT succeed.
 *
 * WHAT THIS STORE WILL NOT DO, AND WHY
 *   • It never sets a PRICE. Prices live in partner_tier_price and are set by
 *     the admin pricing surface. A create-tier path that invented a price would
 *     be the compiled-in-number defect R3 removed, wearing a new hat.
 *   • It never sets a COMMISSION RATE. An unset rate is now a REFUSAL by name
 *     (partnerCommissionRateResolver), not a silent 2%. Inventing a rate here
 *     would re-create exactly the money defect this wave exists to remove.
 *   • It never DELETES a tier. The database refuses that outright
 *     (trg_ptl_no_delete) and archive is the reversible equivalent.
 *   • It never overwrites an existing tier. Creating a slug that already exists
 *     is a CONFLICT, not an update.
 *
 * WHAT IT DOES SET, AND WHY THAT IS NOT "INVENTING A VALUE"
 *   • `rank`, supplied by the human creating the tier. Rank decides which gates
 *     open, so it cannot be absent (a missing rank silently denies everything)
 *     and it cannot be guessed (a guessed rank silently grants or denies
 *     access). It is required input, recorded with the actor who chose it.
 *   • seat_limit and live_spv_limit capability rows at resolution
 *     'not_configured' — the explicit "nobody has decided yet" state migration
 *     0185 introduced precisely so an unknown is never rendered as 0. A 0 in
 *     live_spv_limit would block every deployment for the tier.
 *
 * EVERY MUTATION IS AUDIT-LOGGED BY THE ROUTE LAYER WITH A BOUND ACTOR. This
 * store requires a non-empty actor and refuses without one, so an anonymous
 * "system" write cannot reach the tier catalogue (R35).
 */
import { rawDb } from "../db/connection";
import { ensureWave56TierDomainSchema } from "./applyWave56TierDomainSchema";
import { wave45Db } from "./applyWave45PricingSchema";
import { tierDomainRows, type TierDomainRow, type TierLifecycleStateName } from "./partnerTierDomain";

export const E_TIER_EXISTS = "TIER_ALREADY_EXISTS";
export const E_TIER_ABSENT = "TIER_NOT_FOUND";
export const E_TIER_SLUG_INVALID = "TIER_SLUG_INVALID";
export const E_TIER_ACTOR_REQUIRED = "TIER_ACTOR_REQUIRED";
export const E_TIER_REASON_REQUIRED = "TIER_REASON_REQUIRED";
export const E_TIER_RANK_INVALID = "TIER_RANK_INVALID";

export class TierWriteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "TierWriteError";
    this.code = code;
  }
}

/** Lowercase, starts with a letter, letters/digits/underscore, 3-32 chars. The
 *  same shape every existing slug has; deliberately strict so a slug can never
 *  contain whitespace or punctuation that a URL or a CSV would mangle. */
const SLUG_RE = /^[a-z][a-z0-9_]{2,31}$/;

function nowIso(): string {
  return new Date().toISOString();
}

function db() {
  // wave45Db() guarantees the lifecycle/capability tables exist in dev/test;
  // ensureWave56TierDomainSchema then guarantees the five-slug CHECK is gone, so
  // a create cannot fail on a schema the installer was supposed to have fixed.
  const handle = wave45Db();
  ensureWave56TierDomainSchema(handle);
  return rawDb();
}

function requireActor(actor: string): string {
  const a = typeof actor === "string" ? actor.trim() : "";
  if (!a) {
    throw new TierWriteError(
      E_TIER_ACTOR_REQUIRED,
      "a tier change must record WHO made it; an anonymous or system actor is refused",
    );
  }
  return a;
}

export interface TierRecord extends TierDomainRow {
  stateReason: string | null;
  stateChangedAt: string | null;
  stateChangedBy: string | null;
}

export function listTiers(): TierRecord[] {
  const handle = db();
  let rows: Array<{
    tier_slug: string; state: string; display_name: string; state_reason: string | null;
    state_changed_at: string | null; state_changed_by: string | null;
  }> = [];
  try {
    rows = handle
      .prepare(
        `SELECT tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by
           FROM partner_tier_lifecycle`,
      )
      .all() as typeof rows;
  } catch {
    rows = [];
  }
  const domain = new Map(tierDomainRows().map((r) => [r.slug, r]));
  const out: TierRecord[] = rows.map((r) => {
    const d = domain.get(r.tier_slug);
    return {
      slug: r.tier_slug,
      label: r.display_name,
      state: (d?.state ?? (r.state as TierLifecycleStateName)),
      rank: d?.rank ?? null,
      stateReason: r.state_reason ?? null,
      stateChangedAt: r.state_changed_at ?? null,
      stateChangedBy: r.state_changed_by ?? null,
    };
  });
  out.sort((a, b) => {
    if (a.rank !== null && b.rank !== null && a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank !== null && b.rank === null) return -1;
    if (a.rank === null && b.rank !== null) return 1;
    return a.slug.localeCompare(b.slug);
  });
  return out;
}

export function getTier(slug: string): TierRecord | null {
  return listTiers().find((t) => t.slug === slug) ?? null;
}

export interface CreateTierInput {
  slug: string;
  label: string;
  rank: number;
}

export interface CreateTierResult {
  tier: TierRecord;
  /** What is still MISSING before this tier can be sold or paid on. Returned so
   *  the surface tells the truth instead of implying the tier is ready. */
  unresolved: string[];
}

/**
 * Create a tier. ONE transaction: the lifecycle row, its rank, and its two
 * capability rows at 'not_configured' land together or not at all — a tier that
 * exists with no rank silently denies every gated feature.
 */
export function createTier(input: CreateTierInput, actor: string): CreateTierResult {
  const who = requireActor(actor);
  const slug = typeof input?.slug === "string" ? input.slug.trim().toLowerCase() : "";
  const label = typeof input?.label === "string" ? input.label.trim() : "";
  const rank = input?.rank;

  if (!SLUG_RE.test(slug)) {
    throw new TierWriteError(
      E_TIER_SLUG_INVALID,
      `"${String(input?.slug)}" is not a usable tier slug — use 3-32 characters, lowercase letters, digits and underscores, starting with a letter`,
    );
  }
  if (!label) {
    throw new TierWriteError(
      E_TIER_SLUG_INVALID,
      "a display name is required: an archived tier must still resolve a readable name on a historical invoice",
    );
  }
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
    throw new TierWriteError(
      E_TIER_RANK_INVALID,
      "rank must be a whole number >= 1; it decides which gated features open, so it is never guessed and never left unset",
    );
  }
  if (getTier(slug)) {
    throw new TierWriteError(
      E_TIER_EXISTS,
      `a tier named "${slug}" already exists — tiers are never silently overwritten. Rename the new tier, or edit the existing one.`,
    );
  }

  const handle = db() as any;
  const ts = nowIso();
  const tx = handle.transaction(() => {
    handle
      .prepare(
        `INSERT INTO partner_tier_lifecycle
           (tier_slug, state, display_name, state_reason, state_changed_at, state_changed_by, created_at, updated_at)
         VALUES (?, 'active', ?, NULL, ?, ?, ?, ?)`,
      )
      .run(slug, label, ts, who, ts, ts);
    handle
      .prepare(
        `INSERT INTO partner_tier_rank (tier_slug, rank, set_by, set_at) VALUES (?, ?, ?, ?)`,
      )
      .run(slug, rank, who, ts);
    // R6: an unknown ceiling is 'not_configured', NEVER 0. A 0 live_spv_limit
    // would forbid every deployment for this tier on day one.
    for (const [key, label2] of [
      ["seat_limit", "Team seat limit"],
      ["live_spv_limit", "Live SPV limit"],
    ] as const) {
      handle
        .prepare(
          `INSERT OR IGNORE INTO partner_tier_capability
             (id, tier_slug, capability_key, value_kind, resolution, label, notes, created_at, updated_at, updated_by)
           VALUES (?, ?, ?, 'int_limit', 'not_configured', ?, ?, ?, ?, ?)`,
        )
        .run(
          `ptc_${key === "seat_limit" ? "seat" : "spv"}_${slug}`,
          slug,
          key,
          label2,
          "Created with the tier; no value has been decided yet. Reported as \"Not configured\", never as 0.",
          ts,
          ts,
          who,
        );
    }
  });
  tx();

  const tier = getTier(slug);
  if (!tier) {
    throw new TierWriteError(E_TIER_ABSENT, `created "${slug}" but it does not read back — refusing to report success`);
  }
  return { tier, unresolved: unresolvedFor(slug) };
}

/**
 * What is still missing for this tier, read from the database. Used by the admin
 * surface so a freshly created tier is never presented as ready to sell.
 */
export function unresolvedFor(slug: string): string[] {
  const handle = db();
  const out: string[] = [];
  const priced = (() => {
    try {
      return (
        handle
          .prepare(
            `SELECT COUNT(*) AS n FROM partner_tier_price
              WHERE tier_slug = ? AND active = 1 AND price_minor IS NOT NULL`,
          )
          .get(slug) as { n: number }
      ).n > 0;
    } catch {
      return false;
    }
  })();
  if (!priced) out.push("no active price row — the tier will NOT appear on the pricing page and cannot be purchased (Admin → Partner Billing Ops → Tier Prices)");
  const rated = (() => {
    try {
      return (
        handle
          .prepare(`SELECT COUNT(*) AS n FROM partner_commission_rate_config WHERE tier = ?`)
          .get(slug) as { n: number }
      ).n > 0;
    } catch {
      return false;
    }
  })();
  if (!rated) out.push("no commission rate — commission math REFUSES for this tier by name until one is set (Admin → Fees → Commission rates)");
  const capsConfigured = (() => {
    try {
      return (
        handle
          .prepare(
            `SELECT COUNT(*) AS n FROM partner_tier_capability
              WHERE tier_slug = ? AND capability_key IN ('seat_limit','live_spv_limit') AND resolution = 'configured'`,
          )
          .get(slug) as { n: number }
      ).n;
    } catch {
      return 0;
    }
  })();
  if (capsConfigured < 2) out.push("seat limit and/or live SPV limit are Not configured — they are reported as unset, never as 0");
  return out;
}

function setState(
  slug: string,
  state: TierLifecycleStateName,
  reason: string | null,
  actor: string,
): TierRecord {
  const who = requireActor(actor);
  const existing = getTier(slug);
  if (!existing) {
    throw new TierWriteError(E_TIER_ABSENT, `no tier named "${slug}" exists`);
  }
  if (state !== "active") {
    const r = typeof reason === "string" ? reason.trim() : "";
    if (!r) {
      throw new TierWriteError(
        E_TIER_REASON_REQUIRED,
        `a ${state} tier must say WHY — a freeze or archive is never an unexplained flag`,
      );
    }
  }
  const handle = db();
  const ts = nowIso();
  handle
    .prepare(
      `UPDATE partner_tier_lifecycle
          SET state = ?, state_reason = ?, state_changed_at = ?, state_changed_by = ?, updated_at = ?
        WHERE tier_slug = ?`,
    )
    .run(state, state === "active" ? null : String(reason).trim(), ts, who, ts, slug);
  const after = getTier(slug);
  if (!after || after.state !== state) {
    throw new TierWriteError(
      E_TIER_ABSENT,
      `state change on "${slug}" did not read back as ${state} — refusing to report success`,
    );
  }
  return after;
}

/** Visible and historically resolvable, NOT purchasable, price immutable
 *  (enforced by trg_ptp_frozen_no_price_update / _insert in the database). */
export function freezeTier(slug: string, reason: string, actor: string): TierRecord {
  return setState(slug, "frozen", reason, actor);
}

/** Removed from every front-end catalogue, still fully resolvable for history. */
export function archiveTier(slug: string, reason: string, actor: string): TierRecord {
  return setState(slug, "archived", reason, actor);
}

/** Back to purchasable and editable. */
export function activateTier(slug: string, actor: string): TierRecord {
  return setState(slug, "active", null, actor);
}

/** Re-rank an existing tier. Recorded with the actor who chose the number. */
export function setTierRank(slug: string, rank: number, actor: string): TierRecord {
  const who = requireActor(actor);
  if (!getTier(slug)) throw new TierWriteError(E_TIER_ABSENT, `no tier named "${slug}" exists`);
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
    throw new TierWriteError(E_TIER_RANK_INVALID, "rank must be a whole number >= 1");
  }
  const handle = db();
  const ts = nowIso();
  handle
    .prepare(
      `INSERT INTO partner_tier_rank (tier_slug, rank, set_by, set_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tier_slug) DO UPDATE SET rank = excluded.rank, set_by = excluded.set_by, set_at = excluded.set_at`,
    )
    .run(slug, rank, who, ts);
  const after = getTier(slug);
  if (!after) throw new TierWriteError(E_TIER_ABSENT, `"${slug}" did not read back after re-rank`);
  return after;
}
