/**
 * Sprint 14 D4 — Transaction-prep channel lifecycle.
 *
 * Per harvest §3 Bullet 2: when a founder enters M&A mode, a single
 * `transaction_prep` channel is auto-created with 30 thread anchors keyed
 * to the M&A intelligence dimensions. Members default to founder + cap-table
 * investors with `boardSeatPreference=true`.
 *
 * Archive triggers:
 *   - `maStatus=not_pursuing`
 *   - `transaction_closed`
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";

export const TRANSACTION_PREP_THREADS = [
  "ip_dd_readiness", "customer_contracts_readiness", "financial_audit_readiness",
  "tax_compliance", "employment_law_readiness", "data_protection_readiness",
  "regulatory_filings", "board_minutes_complete", "cap_table_clean",
  "option_grants_complete", "shareholder_consents", "rofr_waivers",
  "vendor_contracts", "lease_assignments", "insurance_review",
  "key_employee_retention", "non_compete_review", "ip_assignment_complete",
  "litigation_disclosure", "environmental_review", "kyc_aml_screening",
  "anti_bribery_policy", "data_room_organization", "financial_projections",
  "customer_concentration", "vendor_concentration", "tech_stack_audit",
  "security_audit", "esg_disclosure", "press_strategy",
] as const;

export interface TransactionPrepChannel {
  id: string;
  companyId: string;
  founderUserId: string;
  memberUserIds: string[];
  threads: { anchor: string; messageCount: number; openIssues: number }[];
  createdAt: string;
  archivedAt?: string;
  archiveReason?: "not_pursuing" | "transaction_closed";
}

const channels = new Map<string, TransactionPrepChannel>();
export const transactionPrepChain = registerChain(new HashChain<{
  channelId: string;
  companyId: string;
  event: "created" | "archived" | "member_added" | "member_removed";
  ts: string;
}>("transaction_prep"));

export const createTransactionPrepSchema = z.object({
  companyId: z.string().min(1),
  founderUserId: z.string().min(1),
  initialMemberUserIds: z.array(z.string()).default([]),
});

export function listChannels(): TransactionPrepChannel[] { return Array.from(channels.values()); }
export function getChannelByCompany(companyId: string): TransactionPrepChannel | undefined {
  return Array.from(channels.values()).find((c) => c.companyId === companyId);
}

export function createChannel(input: { companyId: string; founderUserId: string; initialMemberUserIds?: string[] }): TransactionPrepChannel {
  return withTrace("comms.transaction_prep.create", "1.0.0", "US", () => {
    // One per company — return existing if already there.
    const existing = getChannelByCompany(input.companyId);
    if (existing && !existing.archivedAt) return existing;
    const id = `txprep_${randomBytes(6).toString("hex")}`;
    const initial = input.initialMemberUserIds ?? [];
    const ch: TransactionPrepChannel = {
      id,
      companyId: input.companyId,
      founderUserId: input.founderUserId,
      memberUserIds: Array.from(new Set([input.founderUserId, ...initial])),
      threads: TRANSACTION_PREP_THREADS.map((anchor) => ({ anchor, messageCount: 0, openIssues: 0 })),
      createdAt: new Date().toISOString(),
    };
    channels.set(id, ch);
    transactionPrepChain.append({ channelId: id, companyId: ch.companyId, event: "created", ts: ch.createdAt });
    emitSync({
      eventType: "transaction_prep_channel_created",
      aggregateId: ch.companyId,
      aggregateKind: "company",
      payload: { channelId: id, threads: ch.threads.length, members: ch.memberUserIds.length },
      actorUserId: input.founderUserId,
    });
    return ch;
  });
}

export function archiveChannel(channelId: string, reason: "not_pursuing" | "transaction_closed", actorUserId: string): TransactionPrepChannel | undefined {
  const ch = channels.get(channelId);
  if (!ch || ch.archivedAt) return ch;
  return withTrace("comms.transaction_prep.archive", "1.0.0", "US", () => {
    ch.archivedAt = new Date().toISOString();
    ch.archiveReason = reason;
    transactionPrepChain.append({ channelId, companyId: ch.companyId, event: "archived", ts: ch.archivedAt! });
    emitSync({
      eventType: "transaction_prep_channel_archived",
      aggregateId: ch.companyId,
      aggregateKind: "company",
      payload: { channelId, reason },
      actorUserId,
    });
    return ch;
  });
}

export function addMember(channelId: string, userId: string): TransactionPrepChannel | undefined {
  const ch = channels.get(channelId);
  if (!ch || ch.archivedAt) return ch;
  if (ch.memberUserIds.includes(userId)) return ch;
  ch.memberUserIds.push(userId);
  transactionPrepChain.append({ channelId, companyId: ch.companyId, event: "member_added", ts: new Date().toISOString() });
  return ch;
}

export function __clearTransactionPrep(): void {
  channels.clear();
  transactionPrepChain.__clear();
}

export function registerTransactionPrepRoutes(app: Express): void {
  app.get("/api/founder/comms/transaction-prep", (req: Request, res: Response) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId) {
      const ch = getChannelByCompany(companyId);
      if (!ch) return res.json({ channel: null });
      return res.json({ channel: ch });
    }
    res.json({ channels: listChannels() });
  });

  app.post("/api/founder/comms/transaction-prep", (req: Request, res: Response) => {
    const parsed = createTransactionPrepSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const ch = createChannel(parsed.data);
    res.status(201).json(ch);
  });

  app.post("/api/founder/comms/transaction-prep/:id/archive", (req: Request, res: Response) => {
    const reason = (req.body?.reason as "not_pursuing" | "transaction_closed") ?? "not_pursuing";
    const actor = String((req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const ch = archiveChannel(req.params.id, reason, actor);
    if (!ch) return res.status(404).json({ error: "not_found" });
    res.json(ch);
  });
}
