/**
 * W3-B / C-5 — Investor accredited-investor SELF-DECLARATION capture.
 *
 * Individual-facing, fail-closed routes that let an authenticated user read the
 * current self-certification clause and submit a signed attestation. The
 * attestation is persisted APPEND-ONLY (never mutated) in
 * `investor_accreditation_declaration`, hash-chained per investor. A denormalized
 * fast-flag is mirrored onto the existing (non-sacred)
 * `investor_compliance_profile` via `upsertComplianceProfile` so the existing SPV
 * commit gate + gateStatus() stay consistent.
 *
 * Identity is ALWAYS taken from `req.userContext.userId` (set by requireAuth) — a
 * body-supplied investor id is never trusted.
 *
 * Routes:
 *   POST /api/investor/compliance/accreditation-declaration
 *   GET  /api/investor/compliance/accreditation-declaration
 *
 * Also exports the read helper the C-5 individual-membership gate consumes:
 *   getLatestDeclaration(userId), hasAccreditedDeclaration(userId),
 * and the shared capture helper reused by the Collective-application path:
 *   recordAccreditationDeclaration(userId, input).
 *
 * NOTE (corrected model): accreditation is a C-5 individual-MEMBERSHIP concern.
 * The C-4 founder-company application (founderCollectiveApplyStore.ts) has NO
 * accreditation gate and is intentionally untouched.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { requireAuth } from "./lib/authMiddleware";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";
import { appendAdminAudit } from "./adminPlatformStore";
import { spvEngineStore } from "./spvEngineStore";
import { fitToGate } from "@shared/refusalHeadlineGate";
import {
  ACCREDITATION_CLAUSE_VERSION,
  ACCREDITATION_CLAUSE_TEXT,
  ACCREDITATION_CLAUSE_ACK,
  ACCREDITATION_CRITERIA,
  ACCREDITATION_VALIDITY_DAYS,
  ACCREDITATION_JURISDICTIONS_V0_3,
  ACCREDITATION_JURISDICTION_CRITERIA,
  ALL_KNOWN_CRITERION_IDS,
  SUPERSEDED_ONLY_CRITERION_IDS,
  clauseTextForVersion,
  criteriaForVersion,
  resolveJurisdictionCode,
  type AccreditationJurisdictionCode,
} from "@shared/accreditationClause";

/**
 * WAVE 215 — the exact wording an investor was shown, made provable.
 *
 * R187.3 was raised because a prior wave recorded a declaration without keeping
 * the words behind it. The clause body itself is not written into
 * `investor_accreditation_declaration` — that table is created by migration 0103
 * and this wave adds no migration, because the only file that could carry one
 * (`server/db/connection.ts`) is under a ratified freeze and a tenth waiver is
 * not available. Instead the wording is bound two ways, both of which are
 * verifiable after the fact and neither of which is a promise:
 *
 *   1. `clause_version` on the row resolves to an IMMUTABLE per-version constant
 *      in `shared/accreditationClause.ts` via `clauseTextForVersion()`. The
 *      constants for superseded versions are never edited, so the row's words
 *      can always be reproduced.
 *   2. the sha256 of that exact text is written into the admin audit trail
 *      alongside the declaration id, so a later reader can prove the constant
 *      has not drifted since the signature.
 *
 * This is weaker than a per-row text column and is reported as such in
 * `build_log/wave215/W215_FOR_THE_OWNER.md`. It is NOT weaker than what R187.3
 * asks for: the exact text shown is recoverable, and its hash is stored.
 */
export function clauseTextSha256(version: string): string | null {
  const text = clauseTextForVersion(version);
  if (text === null) return null;
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Server-OBSERVED network address. R187.1: never client-supplied, never invented.
 * `X-Forwarded-For` is deliberately not read — no `trust proxy` is configured
 * anywhere in this app, so that header is attacker-controlled and would turn a
 * piece of evidence into a field the signer chooses. Pattern matches the
 * existing observed-IP reads in `server/lib/rateLimit.ts` and
 * `server/lib/esignatureRoutes.ts`.
 *
 * Returns `null` when the socket address is genuinely unavailable. `null` means
 * "not observed" and must never be replaced by a placeholder like "unknown" or
 * "0.0.0.0", which would read as evidence while being fiction.
 */
export function observedIpFromRequest(req: Request): string | null {
  const socketAddr = (req as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress;
  if (typeof socketAddr === "string" && socketAddr.trim()) return socketAddr.trim();
  const expressIp = (req as unknown as { ip?: string }).ip;
  if (typeof expressIp === "string" && expressIp.trim()) return expressIp.trim();
  return null;
}

/** Server-observed user agent. Client-declared by nature; stored as declared, never as fact. */
export function observedUserAgent(req: Request): string | null {
  const ua = req.headers?.["user-agent"];
  if (typeof ua === "string" && ua.trim()) return ua.trim().slice(0, 512);
  return null;
}

/**
 * The single jurisdiction a criteria set can belong to, or `null` if the set is
 * empty, spans more than one jurisdiction, or contains an id with no
 * jurisdiction at all (every v0.2-only id, including the retired global tick).
 *
 * This is what makes a jurisdiction inferable from an old caller that never sent
 * one: `["us_income"]` can only be a United States declaration. It is NOT a
 * blanket tick — the criterion itself is jurisdiction-bound, which is stronger
 * evidence than a free-text country field the signer types.
 */
export function soleJurisdictionOfCriteria(criteria: readonly string[]): AccreditationJurisdictionCode | null {
  const found = new Set<AccreditationJurisdictionCode>();
  for (const id of criteria) {
    let owner: AccreditationJurisdictionCode | null = null;
    for (const code of Object.keys(ACCREDITATION_JURISDICTION_CRITERIA) as AccreditationJurisdictionCode[]) {
      if (ACCREDITATION_JURISDICTION_CRITERIA[code].some((c) => c.id === id)) {
        owner = code;
        break;
      }
    }
    if (!owner) return null;
    found.add(owner);
  }
  if (found.size !== 1) return null;
  let only: AccreditationJurisdictionCode | null = null;
  found.forEach((c) => { only = c; });
  return only;
}

export interface AccreditationDeclarationRow {
  id: string;
  investorId: string;
  clauseVersion: string;
  criteria: string[];
  signatureName: string;
  signedAt: string;
  jurisdiction: string | null;
  createdAt: string;
  /**
   * WAVE 215 — the per-investor tamper-evidence chain, surfaced so a declaration
   * can be shown to be provable rather than merely asserted to be. Optional
   * because a legacy caller constructing this shape by hand may not have them;
   * every row this module writes or reads from the table carries both.
   */
  prevHash?: string | null;
  currHash?: string | null;
}

function mapRow(r: any): AccreditationDeclarationRow {
  let criteria: string[] = [];
  try {
    const parsed = JSON.parse(r.criteria_json ?? "[]");
    if (Array.isArray(parsed)) criteria = parsed.map((c) => String(c));
  } catch { /* tolerate a malformed legacy blob → empty list */ }
  return {
    id: r.id,
    investorId: r.investor_id,
    clauseVersion: r.clause_version,
    criteria,
    signatureName: r.signature_name,
    signedAt: r.signed_at,
    jurisdiction: r.jurisdiction ?? null,
    createdAt: r.created_at,
    prevHash: r.prev_hash ?? null,
    currHash: r.curr_hash ?? null,
  };
}

/** Latest attestation for an investor (append-only table ⇒ read the newest row). */
export function getLatestDeclaration(userId: string): AccreditationDeclarationRow | null {
  if (!userId) return null;
  const row = rawDb()
    .prepare(
      `SELECT * FROM investor_accreditation_declaration
        WHERE investor_id = ?
        ORDER BY signed_at DESC, rowid DESC
        LIMIT 1`,
    )
    .get(userId);
  return row ? mapRow(row) : null;
}

/**
 * C-5 read used by requireCollectiveMember. Throws are the CALLER's concern: the
 * gate wraps this so a read error is treated as "not declared" (deny in strict).
 *
 * GRACE semantics (rollout): an investor counts as having a valid declaration if
 * EITHER
 *   (a) they have a self-declaration row within the validity window, OR
 *   (b) their compliance profile already reads self_certified/verified (covers
 *       investors accredited before the capture path existed).
 * NOTE: the gate's accreditation sub-check is UNCONDITIONAL — it is not behind a
 * feature flag. A member with nothing on file is denied with
 * ACCREDITATION_DECLARATION_REQUIRED plus the declaration endpoint, which the
 * client turns into a first-sign-on capture prompt rather than a dead end.
 */
export function hasAccreditedDeclaration(userId: string): boolean {
  if (!userId) return false;
  const latest = getLatestDeclaration(userId);
  if (latest) {
    const signedMs = Date.parse(latest.signedAt);
    if (!Number.isNaN(signedMs)) {
      const ageDays = (Date.now() - signedMs) / (1000 * 60 * 60 * 24);
      if (ageDays <= ACCREDITATION_VALIDITY_DAYS) return true;
    } else {
      // Unparseable timestamp but a row exists → treat as present (grace).
      return true;
    }
  }
  /* (b) denormalized fast-flag fallback.
     WAVE 227 / ITEM 1 — THIS IS G6. It is UNCHANGED here, deliberately: it is the
     only thing standing between an already-accepted investor and a 412 at the
     funding gate (`captableCommitStore`), and the population relying on it cannot
     be enumerated from this tree. Closing it here would be a lockout, which the
     brief forbids over a documented gap. What WAVE 227 does instead: (i) fences the
     one HTTP writer that can mint a new unscoped grant — see
     `accreditationAssertionRefusal`, wired into the partner compliance PUT in
     `spvEngineRoutes.ts`; and (ii) makes every grant report the jurisdiction it is
     scoped to via `getAccreditationGateStatus().scope`, so an unscoped tick is no
     longer indistinguishable from a jurisdiction-scoped declaration. The residual
     is escalated in build_log/wave227/W227_FOR_THE_OWNER.md. */
  const prof = spvEngineStore.getComplianceProfile(userId);
  if (prof && (prof.accreditationStatus === "self_certified" || prof.accreditationStatus === "verified")) {
    return true;
  }
  return false;
}

/**
 * W2 A2 (v26.2.0-w2) — gate-facing accreditation status used by the Collective
 * first-sign-on capture. Unlike the boolean `hasAccreditedDeclaration`, this
 * distinguishes verified vs self_certified vs none and reports the source, so
 * the gate can (a) block only genuine "none" members and (b) never downgrade a
 * verified investor. Reads the SAME store path as `hasAccreditedDeclaration`
 * (compliance profile + latest declaration). Throws are the CALLER's concern:
 * the gate wraps this and fails CLOSED (deny) on a read error.
 */
export type AccreditationGateStatus = "none" | "self_certified" | "verified";

/**
 * WAVE 227 / ITEM 1 — the JURISDICTION SCOPE of an accreditation grant.
 *
 * R189.5 is the authority: the accredited / sophisticated / professional investor
 * tests "are mutually incompatible across the US, UK, EU, HK, Singapore, Canada,
 * DIFC and Australia", DIFC's exemption "excludes individuals entirely", and
 * therefore "no global checkbox is possible". An accreditation assertion that
 * names no jurisdiction is not a weak assertion — it is a meaningless one, because
 * there is no test it could be an assertion ABOUT.
 *
 * Before this wave a caller of `getAccreditationGateStatus` could not tell a
 * jurisdiction-scoped declaration apart from a bare denormalized profile tick:
 * both arrived as `status: "self_certified"`. They are now distinguishable.
 *
 *   "jurisdiction_scoped"    — the grant resolves to one of the nine v0.3 codes.
 *   "unscoped_legacy_grace"  — granted, but names no jurisdiction. Pre-existing
 *                              rollout grace (see `hasAccreditedDeclaration`).
 *                              GRANDFATHERED DELIBERATELY: revoking it would
 *                              refuse investors the platform already accepted,
 *                              and their population cannot be enumerated from
 *                              this tree. Escalated, not silently honoured.
 *   "none"                   — no grant at all.
 */
export type AccreditationScope = "jurisdiction_scoped" | "unscoped_legacy_grace" | "none";

/**
 * WAVE 227 / ITEM 1 — resolve the jurisdiction an existing grant is scoped to.
 *
 * Reads, in order: the compliance profile's own `jurisdiction` column (written by
 * the declaration mirror below, and by the fenced partner PUT), then the latest
 * declaration row's. Returns null when neither yields one of the nine codes —
 * and per `@shared/accreditationClause` §5.7 null is NEVER treated as a
 * jurisdiction downstream; it means "not recorded".
 *
 * This is a READ. It grants nothing and revokes nothing.
 */
export function resolveAccreditationJurisdiction(
  profileJurisdiction: unknown,
  declaration: AccreditationDeclarationRow | null,
): AccreditationJurisdictionCode | null {
  return resolveJurisdictionCode(profileJurisdiction) ?? resolveJurisdictionCode(declaration?.jurisdiction);
}

/**
 * WAVE 227 / ITEM 1 — the WRITER fence for the denormalized fast-flag.
 *
 * The flag is writable from exactly two places (grep `upsertComplianceProfile`):
 * the declaration mirror in this module, which always has a real signed row
 * behind it, and `PUT /api/partner/me/compliance/:investorId` in
 * `spvEngineRoutes.ts`, which has nothing behind it at all — a partner could set
 * `accreditationStatus: "verified"` for a related investor with no jurisdiction,
 * no criteria, no signature and no clause version, and that unlocked the cap-table
 * funding gate. This function is the fence on that second path.
 *
 * It refuses exactly two shapes and nothing else:
 *
 *  1. `verified` without a resolvable jurisdiction. `verified` is the value that
 *     reads as a check Capavate performed. R188.3: the platform "advertises a
 *     506(c) standard while operating a 506(b) verification posture" — so no
 *     route may mint an unscoped `verified`.
 *  2. A `jurisdiction` that is PRESENT but resolves to none of the nine codes
 *     while accreditation is being asserted. This is what refuses "Global",
 *     "Worldwide", "All", "N/A".
 *
 * It deliberately does NOT refuse an unscoped `self_certified` with no
 * `jurisdiction` key: eighteen suites set fixtures that way, wave 211's money-event
 * suite among them, and more importantly a live partner doing the same thing today
 * is not doing anything the platform told them was wrong. That residual is
 * escalated in W227_FOR_THE_OWNER, not closed here — an unannounced lockout is
 * worse than a documented gap.
 *
 * Returns null to allow. Returns a refusal descriptor to refuse.
 */
export const ACCREDITATION_JURISDICTION_REQUIRED = "ACCREDITATION_JURISDICTION_REQUIRED";

export function accreditationAssertionRefusal(
  patch: { accreditationStatus?: string | null; jurisdiction?: unknown },
  storedJurisdiction: unknown,
): { status: number; payload: { error: string; message: string; jurisdictions: string[] } } | null {
  const asserting = patch.accreditationStatus === "verified" || patch.accreditationStatus === "self_certified";
  if (!asserting) return null;

  const jurisdictionKeyPresent =
    typeof patch.jurisdiction === "string" && patch.jurisdiction.trim().length > 0;
  const resolved = jurisdictionKeyPresent
    ? resolveJurisdictionCode(patch.jurisdiction)
    : resolveJurisdictionCode(storedJurisdiction);

  // (1) an unresolvable jurisdiction was supplied outright, or (2) `verified` is
  // being asserted and nothing on the patch or the profile scopes it.
  const refuse = jurisdictionKeyPresent ? resolved === null : patch.accreditationStatus === "verified" && resolved === null;
  if (!refuse) return null;

  const codes = ACCREDITATION_JURISDICTIONS_V0_3.map((j) => j.code);
  return {
    status: 422,
    payload: {
      error: ACCREDITATION_JURISDICTION_REQUIRED,
      message: fitToGate(
        () =>
          `Capavate did not record that accreditation status because it names no jurisdiction it could apply to. Accreditation tests differ by country and there is no worldwide one. Send the investor's jurisdiction and try again. Nothing was changed.`,
      ),
      jurisdictions: [...codes],
    },
  };
}

export function getAccreditationGateStatus(userId: string): {
  status: AccreditationGateStatus;
  signedCurrent: boolean;
  declaration: AccreditationDeclarationRow | null;
  source: "profile" | "declaration" | "none";
  /* WAVE 227 / ITEM 1 — APPENDED, never replacing a field. Every pre-existing
     reader destructures `.status` (and `adminPlatformStore` also `.source`), so
     widening the object is signature-compatible. */
  jurisdiction: AccreditationJurisdictionCode | null;
  scope: AccreditationScope;
} {
  if (!userId) {
    return { status: "none", signedCurrent: false, declaration: null, source: "none", jurisdiction: null, scope: "none" };
  }

  // Rule 1 — read the compliance profile through the same store path.
  const prof = spvEngineStore.getComplianceProfile(userId);
  const latest = getLatestDeclaration(userId);

  /* WAVE 227 — resolved ONCE for every granting rule below, so a grant and its
     scope can never disagree about which jurisdiction was read. */
  const jurisdiction = resolveAccreditationJurisdiction(prof?.jurisdiction, latest);
  const scope: AccreditationScope = jurisdiction ? "jurisdiction_scoped" : "unscoped_legacy_grace";

  // Rule 2 — verified wins outright; never downgraded by a self-cert row.
  if (prof && prof.accreditationStatus === "verified") {
    if (!jurisdiction) {
      log.warn(
        "[getAccreditationGateStatus] UNSCOPED accreditation grant for",
        userId,
        "- profile says verified but names no jurisdiction (W227 unscoped_legacy_grace; R189.5 says no global test exists).",
      );
    }
    return {
      status: "verified",
      signedCurrent: true,
      declaration: latest,
      source: "profile",
      jurisdiction,
      scope,
    };
  }

  // Rule 3 — profile self_certified.
  if (prof && prof.accreditationStatus === "self_certified") {
    if (!jurisdiction) {
      log.warn(
        "[getAccreditationGateStatus] UNSCOPED accreditation grant for",
        userId,
        "- profile says self_certified but names no jurisdiction (W227 unscoped_legacy_grace; R189.5 says no global test exists).",
      );
    }
    return {
      status: "self_certified",
      signedCurrent: true,
      declaration: latest,
      source: "profile",
      jurisdiction,
      scope,
    };
  }

  // Rule 4 — else inspect the latest declaration + validity window.
  if (latest) {
    const signedMs = Date.parse(latest.signedAt);
    if (!Number.isNaN(signedMs)) {
      const ageDays = (Date.now() - signedMs) / (1000 * 60 * 60 * 24);
      if (ageDays <= ACCREDITATION_VALIDITY_DAYS) {
        return { status: "self_certified", signedCurrent: true, declaration: latest, source: "declaration", jurisdiction, scope };
      }
    } else {
      // Legacy grace (mirrors hasAccreditedDeclaration): an unparseable signed
      // timestamp with a row present is treated as current. Preserved to avoid
      // behavior drift; logged so operators can spot bad timestamps.
      log.warn(
        "[getAccreditationGateStatus] unparseable signed_at for",
        userId,
        "- applying legacy grace (treated as self_certified).",
      );
      return { status: "self_certified", signedCurrent: true, declaration: latest, source: "declaration", jurisdiction, scope };
    }
  }

  // Rule 5 — nothing current.
  return { status: "none", signedCurrent: false, declaration: latest, source: "none", jurisdiction: null, scope: "none" };
}

export interface RecordDeclarationInput {
  signatureName: string;
  criteria: unknown;
  jurisdiction?: unknown;
  /**
   * WAVE 215 — server-OBSERVED provenance, populated only by a caller that holds
   * the request. Never read from a request body: `observedIpFromRequest()` and
   * `observedUserAgent()` are the only sanctioned producers. A caller with no
   * request (a seed, a fixture) omits this and nothing is fabricated in its place.
   */
  provenance?: {
    observedIp: string | null;
    userAgent: string | null;
  };
}

export type RecordDeclarationResult =
  | { ok: true; declaration: AccreditationDeclarationRow }
  | { ok: false; error: string; message: string };

/**
 * Shared capture primitive — validates + persists an append-only, hash-chained
 * self-declaration row and mirrors the compliance fast-flag. Reused by BOTH the
 * dedicated POST route and the individual Collective-application path (so the
 * declaration is captured at apply time, mirroring W2's sign-at-application).
 *
 * Server-authoritative: the clause version and criterion ids come from the
 * served config, never from a client-supplied text blob.
 */
export function recordAccreditationDeclaration(
  userId: string,
  input: RecordDeclarationInput,
): RecordDeclarationResult {
  // Rule #13 — full legal name (typed signature) is MANDATORY.
  const signatureName = typeof input.signatureName === "string" ? input.signatureName.trim() : "";
  if (signatureName.length < 2) {
    return {
      ok: false,
      error: "SIGNATURE_REQUIRED",
      message: "Type your full legal name to sign the accreditation self-certification.",
    };
  }

  // At least one eligibility criterion must be checked, and every submitted id
  // must be a criterion the platform has ACTUALLY served at some version
  // (server-authoritative). The union across versions is used rather than the
  // current set alone, so an investor holding a superseded criterion can still
  // be read back and re-affirmed; §"legacy re-affirmation" below is the only
  // route by which a superseded id reaches a new row.
  const knownIds = new Set(ALL_KNOWN_CRITERION_IDS);
  const rawCriteria = Array.isArray(input.criteria) ? input.criteria : [];
  const criteria = rawCriteria.map((c) => String(c)).filter((c) => knownIds.has(c));
  if (criteria.length === 0) {
    return {
      ok: false,
      error: "CRITERIA_REQUIRED",
      message: "Select at least one eligibility criterion that applies to you.",
    };
  }

  /* ── LEGACY RE-AFFIRMATION CARVE-OUT ─────────────────────────────────
     An investor who signed under a superseded version must be able to re-affirm
     WHAT THEY ALREADY SIGNED without being blocked by rules that did not exist
     when they signed it. The live production row on this platform is exactly
     that case: criteria ["intl_equivalent"], jurisdiction NULL. Under the v0.3
     rules alone, that investor's "confirm my accreditation" button would start
     returning 400 — a genuinely eligible investor locked out by a correction
     that was supposed to protect them.

     The carve-out is deliberately narrow. It requires an EXACT re-affirmation:
     the same criteria set and the same typed signature as that investor's own
     latest row. It stamps the PRIOR version, never the current one, so the row
     never claims the investor read words they did not read. Anything else — a
     different criteria set, a different name, a first-ever declaration — goes
     through the full v0.3 rules below.

     This does NOT reopen the global tick. `intl_equivalent` cannot be selected
     by anyone who did not already sign it, and it cannot be combined with
     anything, because the set must match a prior row exactly. */
  const priorRow = getLatestDeclaration(userId);
  const isExactReaffirmation =
    !!priorRow &&
    priorRow.signatureName === signatureName &&
    priorRow.criteria.length === criteria.length &&
    [...priorRow.criteria].sort().join("\u0000") === [...criteria].sort().join("\u0000");

  /* ── JURISDICTION ── no declaration without one, and no unrecognised one ──── */
  const rawJurisdiction =
    typeof input.jurisdiction === "string" && input.jurisdiction.trim() ? input.jurisdiction.trim() : null;
  const statedJurisdiction = resolveJurisdictionCode(rawJurisdiction);

  let jurisdictionCode: AccreditationJurisdictionCode | null = null;
  if (!isExactReaffirmation) {
    // A jurisdiction string that resolves to nothing is refused rather than
    // stored. Draft 07 C10: "Prefer refusing to admit over recording a
    // declaration that would not be recognised anywhere."
    if (rawJurisdiction !== null && statedJurisdiction === null) {
      return {
        ok: false,
        error: "JURISDICTION_UNRECOGNISED",
        message: fitToGate(
          (budget) =>
            `Capavate does not offer a declaration for "${rawJurisdiction.slice(0, budget)}". Choose one of the nine listed jurisdictions, or ask us to add yours before you sign.`,
        ),
      };
    }
    // Fall back to the jurisdiction the CRITERIA themselves can only belong to,
    // so an existing caller that never sent the field keeps working without the
    // platform guessing: `["us_income"]` is a United States declaration or it is
    // nothing.
    jurisdictionCode = statedJurisdiction ?? soleJurisdictionOfCriteria(criteria);
    if (jurisdictionCode === null) {
      return {
        ok: false,
        error: "JURISDICTION_REQUIRED",
        message:
          "Choose the one jurisdiction whose law you are declaring under. Eligibility tests differ by country and are not interchangeable.",
      };
    }
    // Every submitted criterion must belong to THAT jurisdiction. This is the
    // rule that makes a blanket assertion impossible: there is no criterion in
    // v0.3 that spans jurisdictions, so a mixed or out-of-scope set is refused.
    const permitted = new Set(ACCREDITATION_JURISDICTION_CRITERIA[jurisdictionCode].map((c) => c.id));
    const offending = criteria.filter((c) => !permitted.has(c));
    if (offending.length > 0) {
      const isRetired = offending.some((c) => SUPERSEDED_ONLY_CRITERION_IDS.includes(c));
      const jName =
        ACCREDITATION_JURISDICTIONS_V0_3.find((j) => j.code === jurisdictionCode)?.name ?? jurisdictionCode;
      return {
        ok: false,
        error: "CRITERIA_JURISDICTION_MISMATCH",
        message: isRetired
          ? fitToGate(
              (budget) =>
                `"${offending[0].slice(0, budget)}" was a single worldwide eligibility tick and is no longer accepted. Choose the criteria your own jurisdiction actually sets.`,
            )
          : fitToGate(
              (budget) =>
                `${offending.length} of the criteria you selected are not ${jName.slice(0, budget)} criteria. Select only criteria listed under the jurisdiction you chose.`,
            ),
      };
    }
  }

  /* The version stamped on the row. A legacy re-affirmation keeps the version
     the investor actually read; everything else is stamped current. */
  const clauseVersion = isExactReaffirmation && priorRow ? priorRow.clauseVersion : ACCREDITATION_CLAUSE_VERSION;

  /* Stored jurisdiction. New declarations store the resolved CODE so nine
     spellings of one country stop being nine jurisdictions. A re-affirmation
     keeps whatever the prior row held — including NULL — because rewriting it
     would assert a jurisdiction the investor never selected. */
  const jurisdiction: string | null = isExactReaffirmation
    ? (priorRow?.jurisdiction ?? null)
    : jurisdictionCode;

  const id = `iad_${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();
  const criteriaJson = JSON.stringify(criteria);

  let row: AccreditationDeclarationRow;
  try {
    const db = rawDb();
    // Per-investor hash chain over the append-only rows (tamper-evidence).
    const prevRow = db
      .prepare(
        `SELECT curr_hash FROM investor_accreditation_declaration
          WHERE investor_id = ? ORDER BY signed_at DESC, rowid DESC LIMIT 1`,
      )
      .get(userId) as { curr_hash?: string } | undefined;
    const prevHash = prevRow?.curr_hash ?? null;
    /* CHAIN FORMULA UNCHANGED — same fields, same order, same "|" separator, same
       sha256. The literal `ACCREDITATION_CLAUSE_VERSION` becomes the `clauseVersion`
       variable ONLY so that the hashed version always equals the version written
       to the row; a legacy re-affirmation stamps a prior version, and a chain
       computed over a different string than the row stores would be a chain no
       auditor could reproduce from the row. No existing hash changes: for every
       non-re-affirmation path `clauseVersion === ACCREDITATION_CLAUSE_VERSION`. */
    const currHash = createHash("sha256")
      .update([prevHash ?? "", id, userId, clauseVersion, criteriaJson, signatureName, now].join("|"))
      .digest("hex");

    db.prepare(
      `INSERT INTO investor_accreditation_declaration
         (id, investor_id, clause_version, criteria_json, signature_name, signed_at, jurisdiction, created_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, userId, clauseVersion, criteriaJson, signatureName, now, jurisdiction, now, prevHash, currHash);

    row = {
      id,
      investorId: userId,
      clauseVersion,
      criteria,
      signatureName,
      signedAt: now,
      jurisdiction,
      createdAt: now,
      prevHash,
      currHash,
    };
  } catch (err) {
    // Fail-closed: do not report success if the durable write failed.
    log.error("[investorCompliance] declaration persist failed:", (err as Error).message);
    return {
      ok: false,
      error: "DECLARATION_PERSIST_FAILED",
      message: "Could not record your certification; please retry.",
    };
  }

  // Mirror the denormalized fast-flag so gateStatus()/SPV commit gate agree.
  // Non-fatal: the declaration row is the source of truth.
  try {
    spvEngineStore.upsertComplianceProfile(userId, {
      accreditationStatus: "self_certified",
      accreditationCertifiedAt: now,
      ...(jurisdiction ? { jurisdiction } : {}),
    });
  } catch (err) {
    log.warn("[investorCompliance] compliance-profile mirror failed (non-fatal):", (err as Error).message);
  }

  try {
    /* WAVE 215 / ITEM D — provenance goes through WAVE 186's EXISTING writer
       (`appendAdminAudit`, server/adminPlatformStore.ts). No second store, no new
       table, no new migration. Every field here is either server-observed or
       server-derived; `null` is written when something was not observed, and no
       value is ever invented to fill a gap.

         signatureName      — what the investor typed (also on the row)
         signedAt           — the SERVER's clock, not the browser's
         observedIp         — the SERVER's socket, never a request header
         userAgent          — as declared by the browser, stored as declared
         jurisdiction       — the one jurisdiction declared under
         criteria           — the exact ids selected
         clauseVersion      — resolves to the immutable text via clauseTextForVersion()
         clauseTextSha256   — digest of that exact text (R187.3) */
    appendAdminAudit(userId, "investor_accreditation_declaration", "accreditation_self_certified", {
      declarationId: row.id,
      clauseVersion,
      clauseTextSha256: clauseTextSha256(clauseVersion),
      criteria,
      jurisdiction,
      signatureName,
      signedAt: now,
      observedIp: input.provenance?.observedIp ?? null,
      userAgent: input.provenance?.userAgent ?? null,
      reaffirmationOfPriorVersion: isExactReaffirmation ? (priorRow?.id ?? null) : null,
      currHash: row.currHash ?? null,
    });
  } catch { /* audit is best-effort; never blocks the attestation */ }

  return { ok: true, declaration: row };
}

export function registerInvestorAccreditationRoutes(app: Express): void {
  // GET — the clause to display + this user's current declaration status.
  app.get("/api/investor/compliance/accreditation-declaration", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    let latest: AccreditationDeclarationRow | null = null;
    let accredited = false;
    try {
      latest = getLatestDeclaration(userId);
      accredited = hasAccreditedDeclaration(userId);
    } catch (err) {
      // Fail-closed on the STATUS read: report not-accredited rather than crash.
      log.error("[investorCompliance.GET] declaration read failed (fail-closed):", (err as Error).message);
    }
    const signedCurrent = !!latest && latest.clauseVersion === ACCREDITATION_CLAUSE_VERSION;
    return res.json({
      ok: true,
      clause: {
        version: ACCREDITATION_CLAUSE_VERSION,
        text: ACCREDITATION_CLAUSE_TEXT,
        ack: ACCREDITATION_CLAUSE_ACK,
        criteria: ACCREDITATION_CRITERIA,
        validityDays: ACCREDITATION_VALIDITY_DAYS,
        /* WAVE 215 — the nine jurisdictions, and the criteria grouped by them.
           The client renders ONE jurisdiction's criteria at a time; there is no
           payload shape here that would let it render a single blanket tick. */
        jurisdictions: ACCREDITATION_JURISDICTIONS_V0_3,
        criteriaByJurisdiction: ACCREDITATION_JURISDICTION_CRITERIA,
        /* The platform's posture, stated by the server rather than left to the
           surface to remember: Capavate RECORDS a declaration. It does not check
           it, and it does not act for the investor. */
        posture: "records_declaration_does_not_verify",
        clauseTextSha256: clauseTextSha256(ACCREDITATION_CLAUSE_VERSION),
      },
      accredited,
      signedCurrent,
      declaration: latest,
      /* WAVE 215 — what the investor ACTUALLY signed, so an older declaration can
         be read back in the words it was signed in rather than today's words.
         `null` when this build no longer holds that version's text, which is the
         honest answer and is never silently replaced by the current text. */
      signedClause: latest
        ? {
            version: latest.clauseVersion,
            text: clauseTextForVersion(latest.clauseVersion),
            textSha256: clauseTextSha256(latest.clauseVersion),
            criteria: criteriaForVersion(latest.clauseVersion).filter((c) =>
              latest!.criteria.includes(c.id),
            ),
            supersededByCurrentVersion: latest.clauseVersion !== ACCREDITATION_CLAUSE_VERSION,
          }
        : null,
    });
  });

  // POST — record a signed self-certification (append-only).
  app.post("/api/investor/compliance/accreditation-declaration", requireAuth, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const body = (req.body ?? {}) as {
      signatureName?: unknown;
      criteria?: unknown;
      jurisdiction?: unknown;
    };

    /* R187.1 — the provenance is taken from the REQUEST OBJECT here, never from
       `body`. A signer cannot choose the address or the time recorded against
       their own declaration, and nothing is substituted when the socket does not
       expose an address. */
    const result = recordAccreditationDeclaration(userId, {
      signatureName: typeof body.signatureName === "string" ? body.signatureName : "",
      criteria: body.criteria,
      jurisdiction: body.jurisdiction,
      provenance: {
        observedIp: observedIpFromRequest(req),
        userAgent: observedUserAgent(req),
      },
    });

    if (!result.ok) {
      const status = result.error === "DECLARATION_PERSIST_FAILED" ? 500 : 400;
      return res.status(status).json(result);
    }
    return res.status(201).json({ ok: true, declaration: result.declaration });
  });
}

export default registerInvestorAccreditationRoutes;
