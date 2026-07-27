/**
 * W-SHADIE 3a — single source of truth for invite-expiry dialog defaults.
 *
 * Before this, the round-creation manual dialog defaulted to 14 days and the
 * round-detail invite dialog defaulted to 30, and only the former offered a
 * 7-day option at all. Both now default to 7 and share this option set.
 *
 * Scope: CLIENT DIALOG DEFAULTS ONLY. The server applies `?? 14` when the
 * field is omitted (roundInvitationsStore.ts:397) — both dialogs always send
 * an explicit value, so that fallback is unchanged and unreached from here.
 */
export const INVITE_EXPIRY_OPTIONS = [7, 14, 30, 60, 90] as const;

export const DEFAULT_INVITE_EXPIRY_DAYS = 7;
