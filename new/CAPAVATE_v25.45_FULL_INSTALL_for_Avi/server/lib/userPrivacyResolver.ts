/**
 * v25.45 F13b — userPrivacyResolver: the SINGLE SOURCE OF TRUTH for how a
 * user's name renders anywhere in the product.
 *
 * Every surface that displays a person's name (messaging sender, investor
 * names on external cap tables, the Collective member directory, chapter
 * rosters) MUST route through `resolveDisplayName()` so privacy preferences are
 * applied consistently. No surface may reimplement the visibility logic.
 *
 * Privacy data is DB-driven: it is read from the profilestore_user_privacy
 * table (profilestore_user_privacy.privacy_json) — the same row the
 * Settings → Privacy tab (F13a) writes via PUT /api/founder/privacy. No
 * Map-backed mock. (v25.45 ROUND 2 — corrected a stale doc reference here that
 * previously named a table which does not exist in this codebase.)
 *
 * Hard rule (F13c): on a founder's OWN company cap table they ALWAYS appear
 * with their legal name — this is NON-CONFIGURABLE.
 */
import { rawDb } from "../db/connection";

/** F13c — encoded so callers/readers see the intent. Always TRUE; not user-editable. */
export const legalNameOnOwnCapTable = true as const;

export type DisplayNameContext =
  | "ownCapTable"
  | "externalCapTable"
  | "message"
  | "collectiveDirectory"
  | "chapterRoster";

export interface UserPrivacyPrefs {
  screenName: string;
  visibleToCoMembers: boolean;
  visibleInCollectiveDirectory: boolean;
}

const DEFAULT_PREFS: UserPrivacyPrefs = {
  screenName: "",
  // POLICY (v25.45 round 7): cap-table co-members see each other by default
  // (counterparty principle). Cap-table membership is a legal relationship
  // between known counterparties; defaulting visible enables the founder/
  // co-investor collaboration that is core to Capavate's value prop. The
  // resolver only uses this flag when isCoMember=true is passed; cross-cap-table
  // and social contexts fail private regardless.
  visibleToCoMembers: true,
  // POLICY (v25.45 round 7): Collective directory + social surfaces always
  // require explicit opt-in. No social presence without explicit consent.
  visibleInCollectiveDirectory: false,
};

/** Idempotent create of the durable privacy table (F13a). */
function ensurePrivacyTable(): void {
  const db: any = rawDb();
  db.exec(`CREATE TABLE IF NOT EXISTS profilestore_user_privacy (
    user_id TEXT PRIMARY KEY NOT NULL,
    privacy_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );`);
}

/** Persist a user's privacy prefs durably (F13a). Throws on DB failure. */
export function writeUserPrivacy(userId: string, prefs: Partial<UserPrivacyPrefs>): void {
  if (!userId) return;
  ensurePrivacyTable();
  const db: any = rawDb();
  const merged: UserPrivacyPrefs = { ...readUserPrivacy(userId), ...prefs };
  db.prepare(
    `INSERT INTO profilestore_user_privacy (user_id, privacy_json, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       privacy_json = excluded.privacy_json,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run(userId, JSON.stringify(merged), new Date().toISOString());
}

/** Read raw prefs in the API shape (legacy key included) for the GET endpoint. */
export function readUserPrivacyRaw(userId: string): (UserPrivacyPrefs & { visibleToCollectiveNetwork: boolean }) | null {
  if (!userId) return null;
  try {
    ensurePrivacyTable();
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
      .get(userId) as { privacy_json?: string } | undefined;
    if (!row?.privacy_json) return null;
    const p = JSON.parse(row.privacy_json) as UserPrivacyPrefs;
    return { ...p, visibleToCollectiveNetwork: p.visibleInCollectiveDirectory };
  } catch {
    return null;
  }
}

/**
 * Read a user's privacy prefs from the DB-backed profilestore_user_privacy
 * table. The PUT handler writes { screenName, visibleToCoMembers,
 * visibleToCollectiveNetwork, ... }. We normalise the legacy
 * `visibleToCollectiveNetwork` key into `visibleInCollectiveDirectory`.
 */
export function readUserPrivacy(userId: string): UserPrivacyPrefs {
  if (!userId) return { ...DEFAULT_PREFS };
  try {
    ensurePrivacyTable();
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
      .get(userId) as { privacy_json?: string } | undefined;
    if (!row?.privacy_json) return { ...DEFAULT_PREFS };
    const p = JSON.parse(row.privacy_json) as Record<string, unknown>;
    return {
      screenName: typeof p.screenName === "string" ? p.screenName : "",
      visibleToCoMembers: typeof p.visibleToCoMembers === "boolean" ? p.visibleToCoMembers : true,
      // Accept the new key, fall back to the legacy network key.
      visibleInCollectiveDirectory:
        typeof p.visibleInCollectiveDirectory === "boolean"
          ? p.visibleInCollectiveDirectory
          : typeof (p as any).visibleToCollectiveNetwork === "boolean"
            ? (p as any).visibleToCollectiveNetwork
            : false,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Resolve the name to display for `userId` to `viewerUserId` in `context`.
 *
 * @param legalName  the user's real/legal name (caller supplies it — typically
 *                   already in hand from the row being rendered).
 * @param isOwnCompany when context is a cap table, whether `userId` is the
 *                   founder OF the company whose cap table is being viewed.
 * @param isCoMember v25.45 ROUND 7 — whether the VIEWER is a cap-table
 *                   counterparty of `userId` (i.e. they share at least one
 *                   cap table). Defaults to FALSE (fail-private). When TRUE,
 *                   the counterparty default makes co-investors visible to one
 *                   another in `externalCapTable` / `message` contexts unless
 *                   the subject has explicitly set `visibleToCoMembers:false`.
 *                   Social contexts (collectiveDirectory / chapterRoster /
 *                   network posts) IGNORE this flag and always require explicit
 *                   opt-in.
 */
export function resolveDisplayName(
  userId: string,
  viewerUserId: string | null | undefined,
  context: DisplayNameContext,
  opts: { legalName: string; isOwnCompany?: boolean; isCoMember?: boolean } = { legalName: "" },
): string {
  const legalName = opts.legalName || "";
  const prefs = readUserPrivacy(userId);
  // v25.45 ROUND 7 — isCoMember defaults to FALSE (fail-private): if a caller
  // does not explicitly assert a cap-table counterparty relationship, treat the
  // viewer as a non-counterparty.
  const isCoMember = opts.isCoMember === true;

  // v25.45 ROUND 5 — RB1: Self-view rule. When the viewer IS the subject (the
  // user is looking at their own data), ALWAYS return the legal name regardless
  // of privacy settings. An opted-out user must never see themselves masked as
  // "Private Investor" on external surfaces (broken UX).
  // This short-circuits ALL five contexts BEFORE the context-specific branches.
  // v25.45 ROUND 7 — Strict viewerUserId normalization. Treat ANY of the
  // following as anonymous (fail-CLOSED):
  //   - null / undefined
  //   - empty string
  //   - whitespace-only string
  //   - any non-string type (number, boolean, object, etc. — defensive against
  //     malformed inputs from JSON request bodies or untyped callers)
  // Per GPT-5.5 round-5/6 adversarial sweep: empty string, whitespace, numbers,
  // booleans, and objects each had distinct fail-open paths.
  // Also: if `userId` itself is empty/non-string, the subject can't be identified
  // — fail private across all contexts.
  const isValidId = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;

  if (!isValidId(userId)) {
    // No identifiable subject — always fail private.
    if (context === "externalCapTable" || context === "message") return "Private Investor";
    return "Private Investor";
  }

  const normalizedViewerId: string | null = isValidId(viewerUserId) ? viewerUserId : null;

  if (normalizedViewerId !== null && normalizedViewerId === userId) {
    return legalName || prefs.screenName || "You";
  }

  // v25.45 ROUND 5 — RB2: Anonymous / null-viewer fail-CLOSED. An anonymous
  // viewer (no authenticated identity) cannot resolve another user's identity.
  // Default-private across ALL contexts so a missing privacy row + supplied
  // legalName can never leak to an unauthenticated caller (no fail-open).
  if (normalizedViewerId === null) {
    switch (context) {
      case "ownCapTable":
        // ownCapTable is "you viewing your own cap table" — anonymous should not
        // reach here, but if it does, fail private.
        return "Private Investor";
      case "externalCapTable":
      case "message":
        return "Private Investor";
      case "collectiveDirectory":
      case "chapterRoster":
        return "Private Investor";
    }
  }

  // F13c — founder always appears with legal name on their own cap table.
  if (context === "ownCapTable") {
    return legalName;
  }

  // v25.45 ROUND 7 — counterparty contexts. Cap-table co-members are KNOWN
  // counterparties who may collaborate; an authenticated non-counterparty must
  // NOT see the subject's identity.
  //   - Explicit opt-out (visibleToCoMembers:false) ALWAYS wins, even between
  //     co-members → mask to screen name or "Private Investor".
  //   - isCoMember === true (and no explicit opt-out) → counterparty default
  //     reveals the legal name (or screen name if the user set one).
  //   - isCoMember === false / undefined → non-counterparty → "Private Investor".
  if (context === "externalCapTable" || context === "message") {
    // Explicit opt-out wins over the counterparty default.
    if (!prefs.visibleToCoMembers) return prefs.screenName || "Private Investor";
    if (!isCoMember) return "Private Investor";
    return prefs.screenName || legalName;
  }

  // v25.45 ROUND 7 — social contexts. Collective directory, chapter rosters,
  // and network posts ALWAYS require explicit opt-in regardless of isCoMember.
  // No social presence without explicit consent.
  if (context === "collectiveDirectory" || context === "chapterRoster") {
    if (!prefs.visibleInCollectiveDirectory) return "Private Investor";
    return prefs.screenName || legalName;
  }

  // Exhaustive fallback.
  return prefs.screenName || legalName;
}
