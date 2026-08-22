/**
 * shared/investorDisplayLabels.ts — WAVE 90 · ITEM 3.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The 2026-08-21 live audit (OPEN_ITEMS_REGISTER PART 11 · M-3) found an
 * INVESTOR looking at `Safe_post` in a column headed "Instrument". That string
 * is the database enum value `safe_post` put through a CSS `capitalize`. It is
 * the same class of defect as the `u_redeemed_...` holder name Wave 83 fixed on
 * the founder cap table, and the same class as the `fully_diluted` leak in M-8:
 * an internal machine token reaching a customer's eyes because nothing stood
 * between the column and the row.
 *
 * `scripts/lint/internalLanguageFence.ts` cannot catch this class. That fence
 * reads STRING LITERALS in the source; `{r.instrument}` is an expression whose
 * value only exists at runtime. So the fence was green while an investor read a
 * snake_case enum. This module plus `shared/__tests__/w90_investor_labels.test.ts`
 * are the runtime half of that protection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE IMPLEMENTS (OWNER RULING R77)
 * ─────────────────────────────────────────────────────────────────────────────
 * Raw enums, codes and ids are BANNED IN RENDERED TEXT and ALLOWED as
 * machine-readable values in payloads, props and `data-testid` attributes. So
 * nothing here changes any wire format: every resolver is a DISPLAY function
 * applied at the render site. The API responses keep carrying `safe_post`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE LABELS COME FROM — DATA, NOT A SWITCH
 * ─────────────────────────────────────────────────────────────────────────────
 * The owner's standing rule is "EVERYTHING needs to work dynamically and
 * db-driven. No dead variables." A `switch (instrument) { case "safe_post": …`
 * inside a component is exactly the dead variable that rule forbids: it drifts
 * the moment a new instrument is added to the domain, and it drifts silently.
 *
 * So every label here is read from the domain table that already governs the
 * value:
 *
 *   instrument      ← `INSTRUMENTS` in shared/schema.ts (the SAME table the
 *                     round wizard renders its options from, so a new
 *                     instrument gets a label the day it is added and
 *                     `w90_investor_labels.test.ts` fails if one is added
 *                     without a `shortLabel`).
 *   round state     ← `ROUND_STATE_LABELS`, declared beside `ROUND_STATES`.
 *   decision state  ← `YOUR_DECISION_STATE_LABELS`, declared beside
 *                     `YOUR_DECISION_STATES`.
 *   holder type     ← `HOLDER_TYPE_LABELS`, declared beside the securities
 *                     shape in shared/schema.ts.
 *
 * The completeness test walks the DOMAIN LIST and requires a label for every
 * member, which is what makes these tables data rather than a copy of the data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THERE IS NO LABEL: DESCRIBE THE ROW, NEVER PRINT THE ID
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 83's precedent, set by the owner: the holder id `u_redeemed_...` became
 * "Redeemed holder". It did NOT become "u_redeemed_…4f2a" and it did NOT become
 * a blank cell — a blank cell is the "failure presented as emptiness" class
 * this register opens with. `describeUnnamed()` is that precedent generalised:
 * given a kind and an id it returns a human description of WHAT the row is, and
 * it never returns any part of the id.
 *
 * `humaniseToken()` is the LAST resort for a value that arrives from outside
 * every domain table (a server that added a state before the client shipped).
 * It is deliberately NOT the primary path: it turns `safe_post` into
 * "Safe post", which is better than `Safe_post` and still not a label. Every
 * resolver prefers its domain table and only falls through to it, and the test
 * asserts the domain path is the one actually taken for every known value.
 */
import {
  INSTRUMENTS,
  ROUND_STATES,
  YOUR_DECISION_STATES,
  HOLDER_TYPE_LABELS,
  ROUND_STATE_LABELS,
  YOUR_DECISION_STATE_LABELS,
  INVESTOR_ALIAS_BASIS_LABELS,
  GENERIC_STATUS_LABELS,
} from "./schema";

/** The empty/unknown marker used across the investor surface. Never an id. */
export const NO_LABEL = "—";

/**
 * A token that a user must never read: snake_case machine values and the
 * prefixed opaque identifiers this codebase mints (`u_…`, `usr_…`, `ext_…`,
 * `co_…`, `rnd_…`, `inv_…`, `sc_…`, `sec_…`, `spv_…`).
 *
 * Exported because the runtime fence test and the render tests both assert
 * against the SAME predicate. Two copies of "what counts as raw" is how the
 * first six cap-table sinks stayed open.
 */
export const RAW_ID_PREFIX_RE = /^(u|usr|ext|co|rnd|inv|in|sc|sec|spv|pos|tx|cmt|al)_[A-Za-z0-9_-]+$/;

export function looksLikeRawId(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  return RAW_ID_PREFIX_RE.test(s);
}

/** snake_case or SCREAMING_SNAKE machine token (e.g. `safe_post`, `TIER_UNPRICED`). */
export function looksLikeRawToken(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (looksLikeRawId(s)) return true;
  return /^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)+$/.test(s);
}

/**
 * Absolute last resort — see the header. `safe_post` -> "Safe post".
 * NEVER applied to an identifier: an id run through this is still an id.
 */
export function humaniseToken(value: string): string {
  const s = String(value ?? "").trim();
  if (!s) return NO_LABEL;
  const words = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fromTable(
  table: Readonly<Record<string, string>>,
  value: unknown,
): string | null {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return null;
  const hit = table[key];
  return hit ? hit : null;
}

/* ── INSTRUMENT ─────────────────────────────────────────────────────────────
 * The M-3 defect. `INSTRUMENTS[].shortLabel` is the column-width label; the
 * long `label` stays what the wizard shows, because a table cell reading
 * "SAFE — Post-Money Valuation Cap (YC v1.2)" is a different usability defect.
 */
const INSTRUMENT_SHORT: Record<string, string> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.value, i.shortLabel]),
);
const INSTRUMENT_LONG: Record<string, string> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.value, i.label]),
);

/** Column-width human label for an instrument value. `safe_post` -> "SAFE (post-money)". */
export function instrumentLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(INSTRUMENT_SHORT, value) ?? humaniseToken(String(value));
}

/** The full domain label, for tooltips and detail rows. */
export function instrumentLongLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(INSTRUMENT_LONG, value) ?? instrumentLabel(value);
}

/* ── HOLDER TYPE / STATES ───────────────────────────────────────────────────*/

export function holderTypeLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(HOLDER_TYPE_LABELS, value) ?? humaniseToken(String(value));
}

export function roundStateLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(ROUND_STATE_LABELS, value) ?? humaniseToken(String(value));
}

export function decisionStateLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return (
    fromTable(YOUR_DECISION_STATE_LABELS, value) ??
    fromTable(ROUND_STATE_LABELS, value) ??
    humaniseToken(String(value))
  );
}

/**
 * A status-ish enum whose domain this module does not own: a disclosure
 * submission status, an SPV status, an SPV type.
 *
 * DELIBERATELY NEUTRAL, AND THIS IS A CORRECTION. The first cut of this function
 * delegated to `decisionStateLabel`, which maps `pending` -> "Awaiting your
 * decision". On a disclosure submission that is FALSE: `pending` there means
 * awaiting REVIEW, and the investor has no decision to make.
 * `wave18_orp040_investor_panels.test.ts` caught it, and it was right to — a
 * confidently wrong label is worse than a raw enum, because a raw enum at least
 * does not assert something untrue. See GENERIC_STATUS_LABELS in shared/schema.ts.
 *
 * A caller that genuinely means the Your-Decision machine must call
 * `decisionStateLabel` explicitly rather than relying on this.
 */
export function statusLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(GENERIC_STATUS_LABELS, value) ?? humaniseToken(String(value));
}

/** The basis on which an earlier-investment claim was linked. */
export function aliasBasisLabel(value: unknown): string {
  if (value == null || String(value).trim() === "") return NO_LABEL;
  return fromTable(INVESTOR_ALIAS_BASIS_LABELS, value) ?? humaniseToken(String(value));
}

/* ── NO NAME EXISTS: DESCRIBE THE ROW (WAVE 83 PRECEDENT) ───────────────────*/

export type UnnamedKind =
  | "round"
  | "company"
  | "holder"
  | "investor"
  | "position"
  | "invitation"
  | "vehicle";

const UNNAMED_DESCRIPTION: Record<UnnamedKind, string> = {
  round: "Unnamed round",
  company: "Unnamed company",
  holder: "Unnamed holder",
  investor: "Unnamed investor",
  position: "Unnamed position",
  invitation: "Unnamed invitation",
  vehicle: "Unnamed vehicle",
};

/**
 * The row has no name. Describe WHAT it is. Returns no part of `_id` — the
 * parameter exists so call sites read honestly and so a future variant can log
 * it, never so it can be printed.
 */
export function describeUnnamed(kind: UnnamedKind, _id?: unknown): string {
  return UNNAMED_DESCRIPTION[kind];
}

/**
 * THE STANDARD RENDER HELPER. Prefer the name the data carries; if it is
 * absent, or if it is itself a raw id (the `u_redeemed_...` case — a name field
 * populated with an identifier), describe the row instead.
 */
export function displayName(
  name: unknown,
  kind: UnnamedKind,
  id?: unknown,
): string {
  const n = String(name ?? "").trim();
  if (n && !looksLikeRawId(n)) return n;
  return describeUnnamed(kind, id ?? name);
}

/* ── A REFERENCE A USER MAY LEGITIMATELY NEED TO QUOTE ──────────────────────
 * R77 permits an identifier in rendered text where the USER must quote it.
 * `referenceLabel` exists so those sites are explicit and countable rather than
 * indistinguishable from a leak: the value passes through unchanged, and the
 * caller must supply the reason it is shown.
 */
export function referenceLabel(value: unknown): string {
  const s = String(value ?? "").trim();
  return s || NO_LABEL;
}

/** The domain lists, re-exported so tests can walk them without importing schema.ts. */
export const LABEL_DOMAINS = {
  INSTRUMENTS,
  ROUND_STATES,
  YOUR_DECISION_STATES,
} as const;
