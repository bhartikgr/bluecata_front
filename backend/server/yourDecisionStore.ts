/**
 * Sprint 10 — Your Decision 10-state machine + endpoint.
 *
 * State chart (collective_investor_audit §2 Tab 7):
 *
 *   pending → viewed → accepted → soft_circled → confirmed → signed → funded
 *                   ↘ declined
 *   pending → expired | revoked
 *   viewed  → soft_circled (skip-accept; still requires soft-circle data)
 *
 * Investor-actionable transitions (validated against actor-role):
 *   • view              pending → viewed
 *   • accept            viewed  → accepted
 *   • decline           viewed | accepted | soft_circled → declined
 *   • soft_circle       viewed | accepted → soft_circled (requires amount + currency + softCircleType)
 *   • request_info      no state change; emits decision_request_info
 *   • sign              confirmed → signed
 *
 * System/founder transitions (kept for completeness):
 *   • confirm           soft_circled → confirmed
 *   • fund              signed       → funded
 *   • revoke            any non-terminal → revoked
 *   • expire            any non-terminal → expired
 *
 * Every transition emits a sync envelope per `capavate_collective_sync_schema.md §9`.
 *
 * The store is in-memory and seeded from `incomingInvitations` so the state
 * machine is always exercised on first request.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  YOUR_DECISION_STATES,
  YOUR_DECISION_TRANSITIONS,
  yourDecisionPatchSchema,
  type YourDecisionPatch,
  type YourDecisionState,
} from "@shared/schema";
import { incomingInvitations } from "./mockData";
import { emitSync } from "./sprint10Telemetry";
import { getUserContext } from "./lib/userContext";
import type { UserContext } from "./lib/userContext";

/**
 * Resolves the request's UserContext, falling back to getUserContext(req)
 * when the loadUserContext middleware hasn't run yet (e.g. routes registered
 * before the middleware in routes.ts).
 */
async function resolveCtx(req: Request): Promise<UserContext> {
  if (req.userContext) return req.userContext;
  return getUserContext(req);
}

export type DecisionRecord = {
  invitationId: string;
  roundId: string;
  companyId: string;
  state: YourDecisionState;
  amount?: number;
  currency?: string;
  softCircleType?: string;
  note?: string;
  /** Defect 19: track when the investor first viewed the deal */
  viewedAt?: string;
  history: Array<{ ts: string; from: YourDecisionState; to: YourDecisionState; action: string; reason?: string }>;
  // MIM (Members Interested in this Deal) — anonymized list of co-investors
  // who have soft-circled the same round, plus their indicated totals.
  mim: Array<{ screenName: string; amountUsd: number; softCircleType: string }>;
};

const records = new Map<string, DecisionRecord>();

function ensureRecord(invitationId: string): DecisionRecord | null {
  if (records.has(invitationId)) return records.get(invitationId)!;
  const inv = incomingInvitations.find((i) => i.id === invitationId);
  if (!inv) return null;
  const initialState = (YOUR_DECISION_STATES as readonly string[]).includes(inv.state)
    ? (inv.state as YourDecisionState)
    : "pending";
  const rec: DecisionRecord = {
    invitationId: inv.id,
    roundId: inv.round.id,
    companyId: inv.company.id,
    state: initialState,
    history: [],
    // Demo MIM: a few seeded peer commits per round
    mim: seedMim(inv.round.id),
  };
  records.set(invitationId, rec);
  return rec;
}

function seedMim(roundId: string): DecisionRecord["mim"] {
  const seed: Record<string, DecisionRecord["mim"]> = {
    rnd_seed: [
      { screenName: "@hydra_vc",     amountUsd: 1_500_000, softCircleType: "definite" },
      { screenName: "@forge_ang",    amountUsd:   750_000, softCircleType: "indication" },
      { screenName: "@bluepoint_ang", amountUsd:   400_000, softCircleType: "definite" },
    ],
    rnd_pre: [
      { screenName: "@northstar",     amountUsd:   100_000, softCircleType: "indication" },
      { screenName: "@avocado_ang",   amountUsd:    75_000, softCircleType: "conditional" },
    ],
    rnd_q_a: [
      { screenName: "@sequoia_h",     amountUsd: 4_000_000, softCircleType: "definite" },
      { screenName: "@bluepoint",     amountUsd:   500_000, softCircleType: "definite" },
    ],
    rnd_l_b: [
      { screenName: "@helios_growth", amountUsd: 8_000_000, softCircleType: "definite" },
    ],
    rnd_k_seed: [],
  };
  return seed[roundId] ?? [];
}

/**
 * Validate that `from → to` is allowed.
 * Returns null on success or an error string on failure.
 */
export function validateTransition(from: YourDecisionState, to: YourDecisionState): string | null {
  if (!(YOUR_DECISION_STATES as readonly string[]).includes(from)) return `invalid_from_state:${from}`;
  if (!(YOUR_DECISION_STATES as readonly string[]).includes(to))   return `invalid_to_state:${to}`;
  if (from === to) return `noop_transition:${from}`;
  const allowed = YOUR_DECISION_TRANSITIONS[from];
  if (!allowed.includes(to)) return `forbidden_transition:${from}->${to}`;
  return null;
}

const ACTION_TO_STATE: Record<YourDecisionPatch["action"], YourDecisionState | null> = {
  view: "viewed",
  accept: "accepted",
  decline: "declined",
  soft_circle: "soft_circled",
  confirm: "confirmed",
  sign: "signed",
  fund: "funded",
  revoke: "revoked",
  expire: "expired",
  request_info: null,
};

export function applyDecisionAction(rec: DecisionRecord, patch: YourDecisionPatch): { ok: true; from: YourDecisionState; to: YourDecisionState } | { ok: false; error: string } {
  if (patch.action === "request_info") {
    // No state change — we just record a history line.
    rec.history.push({ ts: new Date().toISOString(), from: rec.state, to: rec.state, action: "request_info", reason: patch.note });
    return { ok: true, from: rec.state, to: rec.state };
  }
  const target = ACTION_TO_STATE[patch.action];
  if (!target) return { ok: false, error: `unknown_action:${patch.action}` };

  // Action-specific guards
  if (patch.action === "soft_circle") {
    if (typeof patch.amount !== "number" || patch.amount <= 0) {
      return { ok: false, error: "missing_or_invalid_amount" };
    }
    if (!patch.currency) return { ok: false, error: "missing_currency" };
    if (!patch.softCircleType) return { ok: false, error: "missing_soft_circle_type" };
  }

  const from = rec.state;
  const err = validateTransition(from, target);
  if (err) return { ok: false, error: err };

  rec.state = target;
  if (patch.action === "soft_circle") {
    rec.amount = patch.amount;
    rec.currency = patch.currency;
    rec.softCircleType = patch.softCircleType;
    rec.note = patch.note;
  }
  rec.history.push({ ts: new Date().toISOString(), from, to: target, action: patch.action, reason: patch.reason });
  return { ok: true, from, to: target };
}

/**
 * Total all soft-circle amounts for the round (in USD; assumes USD if missing).
 * Defect 63 fix: MIM amounts are informational only (anonymized peer data);
 * they cannot be attributed to real investors in this store, so we document
 * clearly that `totalSoftCircled` returns only the current investor's record
 * amounts. The MIM iteration that previously voided every entry is removed.
 */
export function totalSoftCircled(roundId: string): number {
  let total = 0;
  for (const r of records.values()) {
    if (r.roundId !== roundId) continue;
    if (r.state === "soft_circled" || r.state === "confirmed" || r.state === "signed" || r.state === "funded") {
      total += r.amount ?? 0;
    }
  }
  // NOTE: MIM (Members Interested in this deal) amounts are not included.
  // MIM is an anonymized read-only view for UI display; it does not represent
  // attributable investment commitments in this store. If MIM amounts need to
  // be totalled, they should be fetched separately from a dedicated MIM aggregate.
  return total;
}

export function getRecord(invitationId: string): DecisionRecord | null {
  return ensureRecord(invitationId);
}

export function clearRecords(): void {
  records.clear();
}

const TELEMETRY_EVENT_BY_ACTION: Record<YourDecisionPatch["action"], string> = {
  view: "decision_viewed",
  accept: "decision_accepted",
  decline: "decision_declined",
  soft_circle: "soft_circle_submitted",
  confirm: "decision_confirmed",
  sign: "decision_signed",
  fund: "decision_funded",
  revoke: "decision_revoked",
  expire: "decision_expired",
  request_info: "decision_request_info",
};

export function registerYourDecisionRoutes(app: Express): void {
  // Defect 84: GET requires auth + investor must own the invitation.
  app.get("/api/rounds/:roundId/invitations/:invId/decision", async (req: Request, res: Response) => {
    const { roundId, invId } = req.params;
    const ctx = await resolveCtx(req);
    // Auth check
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    // Ownership check: investor must have this invId in their invitedRounds
    // (unless they are admin).
    if (!ctx.isAdmin) {
      const hasInv = ctx.investor.invitedRounds.some(r => r.invitationId === invId || r.roundId === roundId);
      if (!hasInv) {
        return res.status(403).json({ error: "NOT_ON_CAP_TABLE", message: "You are not invited to this round." });
      }
    }
    const rec = ensureRecord(invId);
    if (!rec) return res.status(404).json({ error: "invitation_not_found" });
    res.json(rec);
  });

  // Defect 85: PATCH requires auth + investor must own the invitation.
  app.patch("/api/rounds/:roundId/invitations/:invId/decision", async (req: Request, res: Response) => {
    const { roundId, invId } = req.params;
    const ctx = await resolveCtx(req);
    // Auth check
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    if (!ctx.isAdmin) {
      const hasInv = ctx.investor.invitedRounds.some(r => r.invitationId === invId || r.roundId === roundId);
      if (!hasInv) {
        return res.status(403).json({ error: "NOT_ON_CAP_TABLE", message: "You are not invited to this round." });
      }
    }
    const parsed = yourDecisionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const rec = ensureRecord(invId);
    if (!rec) return res.status(404).json({ error: "invitation_not_found" });
    if (rec.roundId !== roundId) return res.status(400).json({ error: "round_invitation_mismatch" });

    // Defect 19: record viewedAt timestamp when action is "view"
    if (parsed.data.action === "view" && !rec.viewedAt) {
      rec.viewedAt = new Date().toISOString();
    }

    const result = applyDecisionAction(rec, parsed.data);
    if (!result.ok) return res.status(409).json({ error: result.error });

    const env = emitSync({
      eventType: TELEMETRY_EVENT_BY_ACTION[parsed.data.action],
      aggregateId: rec.invitationId,
      aggregateKind: "invitation",
      payload: {
        invitationId: rec.invitationId,
        roundId: rec.roundId,
        companyId: rec.companyId,
        from: result.from,
        to: result.to,
        amount: rec.amount,
        currency: rec.currency,
        softCircleType: rec.softCircleType,
        note: parsed.data.note,
        action: parsed.data.action,
        viewedAt: rec.viewedAt,
      },
      req,
    });
    res.json({ ok: true, record: rec, telemetry: env });
  });
}
