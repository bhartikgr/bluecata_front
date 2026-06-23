/**
 * Sprint 21 Wave B — Investor Invitations enhancements server routes.
 *
 * Registers:
 *   GET  /api/investor/companies/:companyId/my-history      — investor's historical engagement with this company
 *   GET  /api/rounds/:roundId/co-soft-circle-members        — co-soft-circle peer list (privacy-respecting)
 *   GET  /api/rounds/:roundId/founder-qa                    — Q&A thread for the round
 *   POST /api/rounds/:roundId/founder-qa                    — post a question to the founder
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { emitMutation } from "./lib/eventBus";
import { getUserContext } from "./lib/userContext";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";

// ---------------------------------------------------------------------------
// DEF-041/028: COMPANY_NAME_MAP — maps companyId to display name
// ---------------------------------------------------------------------------
// Patch v4: demo seed only when demo gate is on.
const COMPANY_NAME_MAP: Record<string, string> = DEMO_SEED_ENABLED ? {
  co_novapay: "NovaPay AI",
  co_arboreal: "Arboreal",
  co_quanta: "Quanta Robotics",
  co_helia: "Helia",
  co_tideline: "Tideline",
} : {};

/** Derives a companyId from a roundId for channelId construction. */
function roundIdToCompanyId(roundId: string): string {
  // Round IDs follow pattern: rnd_<companyId>_<suffix>
  // e.g. rnd_novapay_seed -> co_novapay
  const match = roundId.match(/^rnd_([a-z0-9]+)_/);
  if (match) return `co_${match[1]}`;
  // Fallback: try direct lookup or use "unknown"
  return "unknown";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryEvent {
  id: string;
  date: string;
  roundName: string;
  action: string;
  amount?: number;
  currency?: string;
  capTablePosition?: string;
}

interface CoSoftCircleMember {
  id: string;
  displayLabel: string;
  areaOfExpertise: string;
  activityTier: string;
  amountBucket?: string; // "$50k-$100k" | "$100k-$250k" | "$250k+" | undefined if confidential
  disclosesAmount: boolean;
}

interface QAMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorRole: "founder" | "investor";
  body: string;
  publicWithinRound: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

// History store: companyId → investorId → events
const historyStore = new Map<string, HistoryEvent[]>();

function seedHistory(companyId: string): HistoryEvent[] {
  // Patch v4: defaults only populated when demo gate on.
  if (!DEMO_SEED_ENABLED) return [];
  const defaults: Record<string, HistoryEvent[]> = {
    co_novapay: [
      {
        id: "hist_1",
        date: "2024-03-01T00:00:00Z",
        roundName: "NovaPay Pre-Seed",
        action: "invitation_received",
        amount: undefined,
        capTablePosition: undefined,
      },
      {
        id: "hist_2",
        date: "2024-03-15T12:00:00Z",
        roundName: "NovaPay Pre-Seed",
        action: "soft_circle",
        amount: 100_000,
        currency: "USD",
        capTablePosition: undefined,
      },
      {
        id: "hist_3",
        date: "2024-08-20T08:00:00Z",
        roundName: "NovaPay Seed (Closed)",
        action: "transferred_out",
        amount: 100_000,
        currency: "USD",
        capTablePosition: "0.42% (transferred out 2024-08)",
      },
    ],
    co_arboreal: [
      {
        id: "hist_4",
        date: "2025-06-10T09:00:00Z",
        roundName: "Arboreal Angel Round",
        action: "invitation_received",
        amount: undefined,
        capTablePosition: undefined,
      },
      {
        id: "hist_5",
        date: "2025-06-25T14:30:00Z",
        roundName: "Arboreal Angel Round",
        action: "declined",
        amount: undefined,
        capTablePosition: undefined,
      },
    ],
  };
  return defaults[companyId] ?? [];
}

// Co-soft-circle store: roundId → members
const coSoftCircleStore = new Map<string, CoSoftCircleMember[]>();

function seedCoSoftCircle(roundId: string): CoSoftCircleMember[] {
  if (!DEMO_SEED_ENABLED) return [];
  const defaults: Record<string, CoSoftCircleMember[]> = {
    rnd_novapay_seed: [
      {
        id: "u_hydra_capital",
        displayLabel: "Hydra Capital",
        areaOfExpertise: "Fintech / Payments",
        activityTier: "Tier 1 — Lead",
        amountBucket: "$250k+",
        disclosesAmount: true,
      },
      {
        id: "u_forge_ventures",
        displayLabel: "[Anonymous Holder]",
        areaOfExpertise: "Enterprise SaaS",
        activityTier: "Tier 2 — Active",
        amountBucket: undefined,
        disclosesAmount: false,
      },
      {
        id: "u_bluepoint_ang",
        displayLabel: "Bluepoint Angels",
        areaOfExpertise: "AI / ML",
        activityTier: "Tier 2 — Active",
        amountBucket: "$100k-$250k",
        disclosesAmount: true,
      },
    ],
    rnd_pre: [
      {
        id: "u_avocado_angels",
        displayLabel: "Avocado Angels",
        areaOfExpertise: "Digital Health",
        activityTier: "Tier 3 — Observer",
        amountBucket: "$50k-$100k",
        disclosesAmount: true,
      },
    ],
  };
  return defaults[roundId] ?? [];
}

// QA messages store: roundId → messages
const qaMessagesStore = new Map<string, QAMessage[]>();

/**
 * v25.11 NH5 — hydrate qaMessagesStore from kv on boot so the founder Q&A
 * thread survives a server restart. Each persisted message is grouped back
 * into its roundId bucket.
 */
export function hydrateQaMessagesStore(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");
    const rows = hydrateEntries("qaMessagesStore") as Array<[string, QAMessage & { roundId: string }]>;
    let n = 0;
    for (const [, msg] of rows) {
      if (!msg || !msg.roundId) continue;
      const arr = qaMessagesStore.get(msg.roundId) ?? [];
      if (!arr.some((x) => x.id === msg.id)) {
        arr.push(msg);
        qaMessagesStore.set(msg.roundId, arr);
        n++;
      }
    }
    /* Sort each thread chronologically. */
    const ridList: string[] = [];
    qaMessagesStore.forEach((_arr, rid) => { ridList.push(rid); });
    for (const rid of ridList) {
      const arr = qaMessagesStore.get(rid)!;
      arr.sort((a: QAMessage, b: QAMessage) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      qaMessagesStore.set(rid, arr);
    }
    return n;
  } catch {
    return 0;
  }
}

function seedQaMessages(roundId: string): QAMessage[] {
  if (!DEMO_SEED_ENABLED) return [];
  const defaults: Record<string, QAMessage[]> = {
    rnd_novapay_seed: [
      {
        id: "qa_msg_1",
        channelId: `qa_co_novapay_${roundId}`,
        authorId: "u_aisha_patel",
        authorName: "Aisha Patel",
        authorRole: "investor",
        body: "What is your current customer acquisition cost (CAC) vs LTV ratio?",
        publicWithinRound: true,
        createdAt: "2026-04-20T10:00:00Z",
      },
      {
        id: "qa_msg_2",
        channelId: `qa_co_novapay_${roundId}`,
        authorId: "u_maya_chen",
        authorName: "Maya Chen (NovaPay Founder)",
        authorRole: "founder",
        body: "Great question — our LTV:CAC is currently 4.2:1, up from 2.8:1 six months ago. We're seeing strong payback at 14 months average.",
        publicWithinRound: true,
        createdAt: "2026-04-20T14:30:00Z",
      },
      {
        id: "qa_msg_3",
        channelId: `qa_co_novapay_${roundId}`,
        authorId: "u_hydra_capital",
        authorName: "Hydra Capital",
        authorRole: "investor",
        body: "Are you planning to expand to EU markets in 2027?",
        publicWithinRound: true,
        createdAt: "2026-04-21T09:00:00Z",
      },
    ],
  };
  return defaults[roundId] ?? [];
}

function getQaMessages(roundId: string): QAMessage[] {
  if (!qaMessagesStore.has(roundId)) {
    qaMessagesStore.set(roundId, seedQaMessages(roundId));
  }
  return qaMessagesStore.get(roundId)!;
}

function getCoSoftCircleMembers(roundId: string): CoSoftCircleMember[] {
  if (!coSoftCircleStore.has(roundId)) {
    coSoftCircleStore.set(roundId, seedCoSoftCircle(roundId));
  }
  return coSoftCircleStore.get(roundId)!;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSprint21InvitationsRoutes(app: Express): void {
  /**
   * GET /api/investor/companies/:companyId/my-history
   * Returns chronological list of this investor's past engagement events with a company.
   */
  app.get(
    "/api/investor/company-history/:companyId",
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "unauthenticated" });
      }
      const { companyId } = req.params;
      const cacheKey = `${companyId}:${ctx.userId}`;
      if (!historyStore.has(cacheKey)) {
        historyStore.set(cacheKey, seedHistory(companyId));
      }
      const events = historyStore.get(cacheKey)!;
      // Return in chronological order
      const sorted = [...events].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
      return res.json({ companyId, investorId: ctx.userId, events: sorted });
    },
  );

  /**
   * GET /api/rounds/:roundId/co-soft-circle-members
   * Returns list of investors who have soft-circled this round.
   * Requires authenticated investor who has themselves soft-circled.
   * Honors privacy: coMembersOff → anonymize; disclosesAmount:false → hide amount.
   */
  app.get(
    "/api/rounds/:roundId/co-soft-circle-members",
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "unauthenticated" });
      }
      const { roundId } = req.params;

      /* v25.11 NH5 fix — the previous check trusted a `hasSoftCircled=true`
       * query param straight from the client, which any authenticated caller
       * could pass to bypass the soft-circle gate and read the co-investor
       * list. Now we verify against the canonical softCircleStore (DB-backed).
       * Admin can still see everything. */
      let hasSoftCircled = ctx.isAdmin;
      if (!hasSoftCircled) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { listForRound } = require("./softCircleStore");
          const rows = listForRound(roundId) as Array<{ investorUserId?: string }>;
          hasSoftCircled = rows.some((r) => r?.investorUserId === ctx.userId);
        } catch {
          /* If the soft-circle store can't be read, fail closed. */
          hasSoftCircled = false;
        }
      }
      if (!hasSoftCircled) {
        return res.status(403).json({ error: "investor_has_not_soft_circled" });
      }

      const members = getCoSoftCircleMembers(roundId);
      // Filter out the requesting investor from co-members list
      const filtered = members.filter((m) => m.id !== ctx.userId);
      // Apply privacy: coMembersOff (represented by displayLabel already set to "[Anonymous Holder]")
      // Amount visibility is honoured via disclosesAmount field already in the data
      const result = filtered.map((m) => ({
        id: m.id,
        displayLabel: m.displayLabel,
        areaOfExpertise: m.areaOfExpertise,
        activityTier: m.activityTier,
        amountBucket: m.disclosesAmount ? m.amountBucket : undefined,
        disclosesAmount: m.disclosesAmount,
      }));
      return res.json({ roundId, members: result });
    },
  );

  /**
   * GET /api/rounds/:roundId/founder-qa
   * Returns thread messages for this round (last 10).
   */
  app.get(
    "/api/rounds/:roundId/founder-qa",
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "unauthenticated" });
      }
      const { roundId } = req.params;
      const allMessages = getQaMessages(roundId);
      // Filter: public messages OR messages involving this user
      const visible = allMessages.filter(
        (m) =>
          m.publicWithinRound ||
          m.authorId === ctx.userId ||
          ctx.founder.companies.length > 0 ||
          ctx.isAdmin,
      );
      // Return last 10
      const last10 = visible.slice(-10);
      const channelId = `qa_co_${roundIdToCompanyId(roundId)}_${roundId}`;
      return res.json({ roundId, messages: last10, channelId });
    },
  );

  /**
   * POST /api/rounds/:roundId/founder-qa
   * Post a question/reply to the founder Q&A channel.
   */
  app.post(
    "/api/rounds/:roundId/founder-qa",
    async (req: Request, res: Response) => {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "unauthenticated" });
      }
      const { roundId } = req.params;
      const { body, publicWithinRound = true } = req.body ?? {};

      if (!body || typeof body !== "string" || body.trim().length === 0) {
        return res.status(400).json({ error: "body_required" });
      }

      const messages = getQaMessages(roundId);
      const newMsg: QAMessage = {
        id: `qa_msg_${randomBytes(4).toString("hex")}`,
        channelId: `qa_co_${roundIdToCompanyId(roundId)}_${roundId}`,
        authorId: ctx.userId,
        authorName: ctx.identity.name || ctx.userId,
        authorRole: ctx.founder.companies.length > 0 ? "founder" : "investor",
        body: body.trim(),
        publicWithinRound: Boolean(publicWithinRound),
        createdAt: new Date().toISOString(),
      };
      messages.push(newMsg);
      qaMessagesStore.set(roundId, messages);
      /* v25.11 NH5 — persist the new Q&A message via kv shim so the thread
       * survives a server restart. The Map remains as the hot read path. */
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { persistEntry } = require("./lib/storePersistenceShim");
        persistEntry("qaMessagesStore", newMsg.id, { ...newMsg, roundId });
      } catch { /* non-fatal */ }

      // Emit SSE event so clients refresh
      emitMutation({ aggregate: "commsThread", id: roundId, change: "update" });

      return res.status(201).json({ ok: true, message: newMsg });
    },
  );
}
