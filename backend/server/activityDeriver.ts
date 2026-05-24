/**
 * Wave C-2 — Auto-derived activity timestamps + telemetry counters.
 *
 * All values computed live from existing stores — no static data, no duplicates.
 * READ-ONLY access to all upstream stores (cap-table, rounds, soft-circles).
 *
 * Exposed via:
 *   GET /api/admin/companies/:id/activity   (admin)
 *   GET /api/founder/companies/:id/activity (founder, scoped)
 *
 * Also included in company.profile.updated bridge payloads.
 */

/* ============================================================
 * Imports from existing stores — READ-ONLY
 * ============================================================ */
import { getAuditLog } from "./adminPlatformStore";
import { _commsTest } from "./commsStore";
import { getRecentEvents } from "./sprint10Telemetry";

/* ============================================================
 * Types
 * ============================================================ */
export interface CompanyActivityTimestamps {
  lastActiveAt: string | null;
  lastEditedBy: string | null;
  lastInvestorContactAt: string | null;
  lastFounderUpdateAt: string | null;
  lastInvestorMessageAt: string | null;
  lastFounderMessageAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CompanyTelemetryCounters {
  totalInvestorViews: number;
  totalInvestorMessages: number;
  totalCapTableMutations: number;
  totalRoundsCreated: number;
  totalCommitsRecorded: number;
}

/* ============================================================
 * Helper: normalize companyId for entity lookups
 * ============================================================ */
function matchesCompany(entity: string, companyId: string): boolean {
  return (
    entity === companyId ||
    entity === `company:${companyId}` ||
    entity.startsWith(`${companyId}:`) ||
    entity.startsWith(`company:${companyId}`)
  );
}

/* ============================================================
 * getCompanyActivityTimestamps
 * ============================================================ */
export function getCompanyActivityTimestamps(companyId: string): CompanyActivityTimestamps {
  const auditLog = getAuditLog();

  // Filter to entries relevant to this company
  const companyEntries = auditLog.filter(e => matchesCompany(e.entity, companyId));

  // lastActiveAt: max timestamp from all company-related audit entries
  let lastActiveAt: string | null = null;
  for (const e of companyEntries) {
    if (!lastActiveAt || e.ts > lastActiveAt) lastActiveAt = e.ts;
  }

  // lastEditedBy: actor on the most recent audit entry for this company
  let lastEditedBy: string | null = null;
  if (companyEntries.length > 0) {
    const sorted = [...companyEntries].sort((a, b) => b.ts.localeCompare(a.ts));
    lastEditedBy = sorted[0].actor;
  }

  // Retrieve messages from commsStore
  const allMessages = Array.from(_commsTest.messages.values());

  // lastInvestorContactAt: most recent message sent TO company where sender is investor
  // We approximate: messages in cap-table or company-followers channels for this company,
  // where the author's roles include "investor"
  const investorUsers = new Set(
    Object.values(_commsTest.COMMS_USERS)
      .filter(u => u.roles.includes("investor"))
      .map(u => u.id)
  );
  const founderUsers = new Set(
    Object.values(_commsTest.COMMS_USERS)
      .filter(u => u.roles.includes("founder"))
      .map(u => u.id)
  );

  // Also check channels that belong to this company
  const companyChannelIds = new Set(
    Array.from(_commsTest.channels.values())
      .filter(ch =>
        ch.companyId === companyId ||
        (typeof (ch as any).context === "string" && (ch as any).context.includes(companyId))
      )
      .map(ch => ch.id)
  );

  let lastInvestorContactAt: string | null = null;
  let lastFounderUpdateAt: string | null = null;
  let lastInvestorMessageAt: string | null = null;
  let lastFounderMessageAt: string | null = null;

  for (const msg of allMessages) {
    const inCompanyChannel =
      companyChannelIds.has(msg.channelId) ||
      msg.channelId.includes(companyId);

    if (!inCompanyChannel) continue;

    const isInvestorSender = investorUsers.has(msg.authorId);
    const isFounderSender = founderUsers.has(msg.authorId);

    if (isInvestorSender) {
      if (!lastInvestorContactAt || msg.sentAt > lastInvestorContactAt) {
        lastInvestorContactAt = msg.sentAt;
      }
      if (!lastInvestorMessageAt || msg.sentAt > lastInvestorMessageAt) {
        lastInvestorMessageAt = msg.sentAt;
      }
      if (!lastActiveAt || msg.sentAt > lastActiveAt) lastActiveAt = msg.sentAt;
    }

    if (isFounderSender) {
      if (!lastFounderMessageAt || msg.sentAt > lastFounderMessageAt) {
        lastFounderMessageAt = msg.sentAt;
      }
      if (!lastActiveAt || msg.sentAt > lastActiveAt) lastActiveAt = msg.sentAt;
    }
  }

  // lastFounderUpdateAt: most recent audit entry where actor looks like a founder for this company
  const founderUpdates = companyEntries.filter(e =>
    founderUsers.has(e.actor) ||
    e.actor.includes("founder") ||
    e.eventType.includes("profile") ||
    e.eventType.includes("company_profile")
  );
  if (founderUpdates.length > 0) {
    const sorted = [...founderUpdates].sort((a, b) => b.ts.localeCompare(a.ts));
    lastFounderUpdateAt = sorted[0].ts;
  }

  // createdAt: earliest audit entry for this company
  let createdAt: string | null = null;
  if (companyEntries.length > 0) {
    const sorted = [...companyEntries].sort((a, b) => a.ts.localeCompare(b.ts));
    createdAt = sorted[0].ts;
  }

  // updatedAt: same as lastActiveAt for now
  const updatedAt = lastActiveAt;

  return {
    lastActiveAt,
    lastEditedBy,
    lastInvestorContactAt,
    lastFounderUpdateAt,
    lastInvestorMessageAt,
    lastFounderMessageAt,
    createdAt,
    updatedAt,
  };
}

/* ============================================================
 * getCompanyTelemetryCounters
 * ============================================================ */
export function getCompanyTelemetryCounters(companyId: string): CompanyTelemetryCounters {
  const auditLog = getAuditLog();
  const telemetryEvents = getRecentEvents(2000);
  const allMessages = Array.from(_commsTest.messages.values());

  // totalInvestorViews: telemetry events of type "company.viewed.by_investor" for this company
  const totalInvestorViews = telemetryEvents.filter(
    e => e.eventType === "company.viewed.by_investor" && e.aggregateId === companyId
  ).length;

  // totalInvestorMessages: all messages received by company from investors
  const investorUsers = new Set(
    Object.values(_commsTest.COMMS_USERS)
      .filter(u => u.roles.includes("investor"))
      .map(u => u.id)
  );
  const companyChannelIds = new Set(
    Array.from(_commsTest.channels.values())
      .filter(ch =>
        ch.companyId === companyId ||
        (typeof (ch as any).context === "string" && (ch as any).context.includes(companyId))
      )
      .map(ch => ch.id)
  );
  const totalInvestorMessages = allMessages.filter(
    msg =>
      investorUsers.has(msg.authorId) &&
      (companyChannelIds.has(msg.channelId) || msg.channelId.includes(companyId))
  ).length;

  // totalCapTableMutations: audit log entries with entity prefix "captable:co_..." for this company
  // READ-ONLY: we just count audit entries
  const totalCapTableMutations = auditLog.filter(
    e =>
      (e.entity.startsWith(`captable:${companyId}`) ||
       e.entity.startsWith(`captable:co_`) ||
       e.eventType === "cap_table.mutated") &&
      matchesCompany(e.entity, companyId)
  ).length;

  // totalRoundsCreated: count audit entries where eventType is "round.created" or "round.closed" for company
  // READ-ONLY from audit log to avoid touching roundsStore
  const totalRoundsCreated = auditLog.filter(
    e =>
      matchesCompany(e.entity, companyId) &&
      (e.eventType.startsWith("round.") || e.eventType === "round.closed")
  ).length;

  // totalCommitsRecorded: audit entries for commit events for this company
  const totalCommitsRecorded = auditLog.filter(
    e =>
      matchesCompany(e.entity, companyId) &&
      (e.eventType.includes("commit") || e.eventType === "soft_circle.submitted")
  ).length;

  return {
    totalInvestorViews,
    totalInvestorMessages,
    totalCapTableMutations,
    totalRoundsCreated,
    totalCommitsRecorded,
  };
}
