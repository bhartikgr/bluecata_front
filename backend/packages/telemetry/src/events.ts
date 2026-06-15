/**
 * Telemetry event schema (R200 §10 — investor-grade close-gate telemetry).
 *
 * Every event is hash-chained, immutable, and timestamped. The schema is a
 * discriminated union — each variant has a strongly-typed payload.
 *
 * Categories (top-level prefixes):
 *   round.*           — round lifecycle (created → terms_set → invitations → ... → closed)
 *   invitation.*      — per-investor invitations
 *   softcircle.*      — soft commitments → confirmation → signing → funding
 *   document.*        — generated documents lifecycle
 *   cap_table.*       — engine-emitted cap-table mutations
 *   eligibility.*     — eligibility recomputes
 *   formula.*         — formula registry events
 *   lifecycle_policy.* — admin policy changes
 *   reconciliation.*  — primary-vs-reference reconciliations
 *   signoff.*         — close-gate sign-off requests / grants / declines
 */

export type EventCategory =
  | "round" | "invitation" | "softcircle" | "document" | "cap_table"
  | "eligibility" | "formula" | "lifecycle_policy" | "reconciliation" | "signoff"
  | "termsheet" | "consortium"
  // Sprint 9 — communications
  | "message" | "post" | "dm" | "cap_table_channel" | "soft_circle_channel" | "visibility";

// ----- Round events -----
export type RoundCreated = { type: "round.created"; payload: { roundId: string; series: string; targetRaise: string; instrument: string } };
export type RoundTermsSet = { type: "round.terms_set"; payload: { roundId: string; preMoney?: string; pps?: string; cap?: string; discount?: string } };
export type RoundInvitationsSent = { type: "round.invitations_sent"; payload: { roundId: string; count: number } };
export type RoundSoftCircleOpened = { type: "round.soft_circle_opened"; payload: { roundId: string } };
export type RoundSoftCircleClosed = { type: "round.soft_circle_closed"; payload: { roundId: string; circledAmount: string } };
export type RoundDocsGenerated = { type: "round.docs_generated"; payload: { roundId: string; docCount: number } };
export type RoundSigningOpened = { type: "round.signing_opened"; payload: { roundId: string } };
export type RoundSigned = { type: "round.signed"; payload: { roundId: string; signedAmount: string } };
export type RoundFundsReceived = { type: "round.funds_received"; payload: { roundId: string; amount: string } };
export type RoundClosed = { type: "round.closed"; payload: { roundId: string; primaryHash: string; referenceHash: string; finalAmount: string } };
export type RoundAmended = { type: "round.amended"; payload: { roundId: string; field: string; oldValue: string; newValue: string } };
export type RoundPaused = { type: "round.paused"; payload: { roundId: string; reason: string } };
export type RoundCancelled = { type: "round.cancelled"; payload: { roundId: string; reason: string } };
export type RoundPartialClose = { type: "round.partial_close"; payload: { roundId: string; tranche: number; amount: string } };

// ----- Invitation events -----
export type InvitationCreated = { type: "invitation.created"; payload: { invitationId: string; roundId: string; investorId: string } };
export type InvitationViewed = { type: "invitation.viewed"; payload: { invitationId: string } };
export type InvitationSoftCircled = { type: "invitation.soft_circled"; payload: { invitationId: string; amount: string } };
export type InvitationDeclined = { type: "invitation.declined"; payload: { invitationId: string; reason?: string } };
export type InvitationExpired = { type: "invitation.expired"; payload: { invitationId: string } };
export type InvitationRevoked = { type: "invitation.revoked"; payload: { invitationId: string; reason?: string } };

// ----- Soft-circle events -----
export type SoftCircleCreated = { type: "softcircle.created"; payload: { softCircleId: string; roundId: string; investorId: string; amount: string } };
export type SoftCircleConfirmed = { type: "softcircle.confirmed"; payload: { softCircleId: string } };
export type SoftCircleSigned = { type: "softcircle.signed"; payload: { softCircleId: string } };
export type SoftCircleFunded = { type: "softcircle.funded"; payload: { softCircleId: string; amount: string } };
export type SoftCircleCancelled = { type: "softcircle.cancelled"; payload: { softCircleId: string; reason?: string } };

// ----- Document events -----
export type DocumentGenerated = { type: "document.generated"; payload: { documentId: string; roundId?: string; kind: string } };
export type DocumentSent = { type: "document.sent"; payload: { documentId: string; recipientId: string } };
export type DocumentViewed = { type: "document.viewed"; payload: { documentId: string } };
export type DocumentSigned = { type: "document.signed"; payload: { documentId: string; signerId: string } };
export type DocumentDeclined = { type: "document.declined"; payload: { documentId: string; signerId: string; reason?: string } };

// ----- Cap-table -----
export type CapTableMutated = { type: "cap_table.mutated"; payload: { beforeHash: string; afterHash: string; reason: string } };

// ----- Eligibility -----
export type EligibilityRecomputed = { type: "eligibility.recomputed"; payload: { investorId: string; status: string } };

// ----- Formula registry -----
export type FormulaPublished = { type: "formula.published"; payload: { formulaId: string; version: string; region: string } };

// ----- Policy -----
export type LifecyclePolicyChanged = { type: "lifecycle_policy.changed"; payload: { policy: string; oldValue: string | number; newValue: string | number } };

// ----- Reconciliation -----
export type ReconciliationRun = { type: "reconciliation.run"; payload: { runId: string; companyId: string; status: "match" | "divergence"; durationMs: number; primaryHash: string; referenceHash: string } };
export type ReconciliationDivergence = { type: "reconciliation.divergence_detected"; payload: { runId: string; companyId: string; diffCount: number } };

// ----- Term sheet -----
export type TermSheetCreated = { type: "termsheet.created"; payload: { templateId: string; region: string; instrument: string; roundId: string } };
export type TermSheetSigned = { type: "termsheet.signed"; payload: { documentHash: string; signature: unknown; roundId: string } };
export type TermSheetUploaded = { type: "termsheet.uploaded"; payload: { filename: string; mimeType: string; roundId: string } };
export type TermSheetReconciled = { type: "termsheet.reconciled"; payload: { mismatches: string[]; matches: string[]; roundId: string } };
export type TermSheetSentToInvestors = { type: "termsheet.sent_to_investors"; payload: { invitationIds: string[]; roundId: string } };

// ----- Consortium -----
export type ConsortiumIntroductionRequested = { type: "consortium.introduction.requested"; payload: { partnerIds: string[]; roundId: string; contextMessage: string } };

// ----- Sprint 9: communications -----
export type MessageSent           = { type: "message.sent";           payload: { messageId: string; channelId: string; channelKind: string; authorUserId: string; recipientCount: number } };
export type MessageEdited         = { type: "message.edited";         payload: { messageId: string; channelId: string } };
export type MessageDeleted        = { type: "message.deleted";        payload: { messageId: string; channelId: string } };
export type MessageStarred        = { type: "message.starred";        payload: { messageId: string; channelId: string; userId: string } };
export type MessageUnstarred      = { type: "message.unstarred";      payload: { messageId: string; channelId: string; userId: string } };
export type MessageReactionAdded  = { type: "message.reaction.added"; payload: { messageId: string; channelId: string; userId: string; emoji: string } };
export type MessageReactionRemoved= { type: "message.reaction.removed"; payload: { messageId: string; channelId: string; userId: string; emoji: string } };

export type PostCreated   = { type: "post.created";   payload: { postId: string; channelId: string; authorUserId: string; authorKind: "user" | "company"; companyId?: string; visibility: string } };
export type PostLiked     = { type: "post.liked";     payload: { postId: string; userId: string } };
export type PostUnliked   = { type: "post.unliked";   payload: { postId: string; userId: string } };
export type PostCommented = { type: "post.commented"; payload: { postId: string; userId: string; commentId: string } };
export type PostShared    = { type: "post.shared";    payload: { postId: string; userId: string } };
export type PostFollowed  = { type: "post.followed";  payload: { postId: string; userId: string; companyId: string } };

export type DmChannelOpened = { type: "dm.channel.opened"; payload: { channelId: string; fromUserId: string; toUserId: string; sharedContext: { capTables: string[]; chapters: string[] } } };
export type DmChannelBlocked = { type: "dm.channel.blocked"; payload: { fromUserId: string; toUserId: string; reason: "no_visibility" | "no_shared_context" } };

export type CapTableChannelMemberAdded   = { type: "cap_table_channel.member_added";   payload: { channelId: string; userId: string; reason: "founder" | "issuance" | "visibility_opt_in" } };
export type CapTableChannelMemberRemoved = { type: "cap_table_channel.member_removed"; payload: { channelId: string; userId: string; reason: "transfer" | "visibility_opt_out" } };

export type SoftCircleChannelCreated     = { type: "soft_circle_channel.created";     payload: { channelId: string; roundId: string } };
export type SoftCircleChannelMemberAdded = { type: "soft_circle_channel.member_added"; payload: { channelId: string; userId: string; role: "founder" | "soft_circler" } };
export type SoftCircleChannelGraduated   = { type: "soft_circle_channel.graduated";   payload: { channelId: string; userId: string; toCapTableChannelId: string } };
export type SoftCircleChannelArchived    = { type: "soft_circle_channel.archived";    payload: { channelId: string; roundId: string } };

export type VisibilityUnmaskedMessage = { type: "visibility.unmasked_message"; payload: { userId: string; channelId: string; previousLabel: string; newLabel: string } };

// ----- Sign-off -----
export type SignoffRequested = { type: "signoff.requested"; payload: { signoffId: string; roundId: string; signerRole: "founder" | "admin" } };
export type SignoffGranted = { type: "signoff.granted"; payload: { signoffId: string; roundId: string; signerRole: "founder" | "admin"; identityHash: string } };
export type SignoffDeclined = { type: "signoff.declined"; payload: { signoffId: string; roundId: string; signerRole: "founder" | "admin"; reason?: string } };

export type TelemetryEventBody =
  | RoundCreated | RoundTermsSet | RoundInvitationsSent
  | RoundSoftCircleOpened | RoundSoftCircleClosed
  | RoundDocsGenerated | RoundSigningOpened | RoundSigned | RoundFundsReceived
  | RoundClosed | RoundAmended | RoundPaused | RoundCancelled | RoundPartialClose
  | InvitationCreated | InvitationViewed | InvitationSoftCircled
  | InvitationDeclined | InvitationExpired | InvitationRevoked
  | SoftCircleCreated | SoftCircleConfirmed | SoftCircleSigned | SoftCircleFunded | SoftCircleCancelled
  | DocumentGenerated | DocumentSent | DocumentViewed | DocumentSigned | DocumentDeclined
  | CapTableMutated
  | EligibilityRecomputed
  | FormulaPublished
  | LifecyclePolicyChanged
  | ReconciliationRun | ReconciliationDivergence
  | SignoffRequested | SignoffGranted | SignoffDeclined
  | TermSheetCreated | TermSheetSigned | TermSheetUploaded
  | TermSheetReconciled | TermSheetSentToInvestors
  | ConsortiumIntroductionRequested
  // Sprint 9 — communications
  | MessageSent | MessageEdited | MessageDeleted
  | MessageStarred | MessageUnstarred
  | MessageReactionAdded | MessageReactionRemoved
  | PostCreated | PostLiked | PostUnliked | PostCommented | PostShared | PostFollowed
  | DmChannelOpened | DmChannelBlocked
  | CapTableChannelMemberAdded | CapTableChannelMemberRemoved
  | SoftCircleChannelCreated | SoftCircleChannelMemberAdded
  | SoftCircleChannelGraduated | SoftCircleChannelArchived
  | VisibilityUnmaskedMessage;

export type TelemetryEventType = TelemetryEventBody["type"];

export type TelemetryLocation = { city?: string; region?: string; country?: string };

/** Envelope: every event includes the universal context fields. */
export type TelemetryEvent = TelemetryEventBody & {
  id: string;
  companyId: string;
  roundId?: string;
  actorId: string;
  actorRole: "founder" | "admin" | "investor" | "system" | "lawyer" | "platform";
  timestamp: string;        // ISO 8601
  ipAddress?: string;
  location?: TelemetryLocation;
  userAgent?: string;
  sessionId?: string;
  prevHash: string;
  hash: string;
};

/** All event types as a const array — handy for filters / dropdowns. */
export const ALL_EVENT_TYPES: TelemetryEventType[] = [
  "round.created", "round.terms_set", "round.invitations_sent",
  "round.soft_circle_opened", "round.soft_circle_closed",
  "round.docs_generated", "round.signing_opened", "round.signed",
  "round.funds_received", "round.closed", "round.amended",
  "round.paused", "round.cancelled", "round.partial_close",
  "invitation.created", "invitation.viewed", "invitation.soft_circled",
  "invitation.declined", "invitation.expired", "invitation.revoked",
  "softcircle.created", "softcircle.confirmed", "softcircle.signed",
  "softcircle.funded", "softcircle.cancelled",
  "document.generated", "document.sent", "document.viewed",
  "document.signed", "document.declined",
  "cap_table.mutated",
  "eligibility.recomputed",
  "formula.published",
  "lifecycle_policy.changed",
  "reconciliation.run", "reconciliation.divergence_detected",
  "signoff.requested", "signoff.granted", "signoff.declined",
  "termsheet.created", "termsheet.signed", "termsheet.uploaded",
  "termsheet.reconciled", "termsheet.sent_to_investors",
  "consortium.introduction.requested",
  // Sprint 9 — communications
  "message.sent", "message.edited", "message.deleted",
  "message.starred", "message.unstarred",
  "message.reaction.added", "message.reaction.removed",
  "post.created", "post.liked", "post.unliked", "post.commented", "post.shared", "post.followed",
  "dm.channel.opened", "dm.channel.blocked",
  "cap_table_channel.member_added", "cap_table_channel.member_removed",
  "soft_circle_channel.created", "soft_circle_channel.member_added",
  "soft_circle_channel.graduated", "soft_circle_channel.archived",
  "visibility.unmasked_message",
];

export function categoryOf(type: TelemetryEventType): EventCategory {
  return type.split(".")[0] as EventCategory;
}
