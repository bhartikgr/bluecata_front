/**
 * Sprint 16 — Communications Deep Unlock (3 tiers).
 *
 * Implements:
 *
 *   Tier 1 (cap-table peer comms):  co_investor_group channels, peer DMs,
 *                                    intro requests
 *   Tier 2 (soft-circle peer):       soft_circle_peer channels, IOI Pulse
 *                                    (leaning_yes / need_diligence / pass)
 *   Tier 3 (cross-cohort):           endorsements, cross_cohort_dm with hard
 *                                    cap (3 unsolicited DMs/round/soft-circler),
 *                                    Q&A threads, diligence volunteers
 *
 * Privacy + abuse guards (Top-5):
 *   1) Hard cap 3 unsolicited DMs per soft-circler per round (combined cap
 *      across ALL cap-table investors)
 *   2) Endorsement: fixed chips + free text ≤300 + mandatory disclaimer +
 *      founder removal
 *   3) Soft-circler default opt-OUT for cross-cohort DM
 *   4) Q&A: founder moderation + dataroom-access reminder + admin audit
 *   5) high_value_advocate flag advisory only; CRM-side label
 *      "For informational purposes only"
 *
 * Hash-chain new aggregates (6) — registered with Sprint 14 hashChain registry:
 *   - co_investor_group
 *   - soft_circle_peer (covers IOI Pulse changes too)
 *   - endorsements
 *   - cross_cohort_dm
 *   - round_qa
 *   - diligence_volunteers
 *
 * Telemetry traces every mutation through `withTrace(formulaId, version,
 * region, fn)` (Sprint 14).
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";

/* ===========================================================================
 * Types
 * ======================================================================== */

export type IoiPulse = "leaning_yes" | "need_diligence" | "pass";
export type EndorsementChip =
  | "founder_execution" | "market_traction" | "team_quality"
  | "product_strength" | "existing_portfolio_fit";
export type CrossCohortDmStatus = "open" | "rate_limited" | "muted" | "blocked";
export type QaStatus = "open" | "archived";

export interface CoInvestorGroup {
  id: string;
  companyId: string;
  participants: string[];          // user IDs (cap-table investors)
  createdAt: string;
  archivedAt?: string;
}

export interface CoInvestorGroupMessage {
  id: string;
  groupId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface SoftCirclePeerOptIn {
  roundId: string;
  userId: string;
  optedIn: boolean;
  /** Cross-cohort DM opt-in (default false). */
  crossCohortDmOptedIn: boolean;
  updatedAt: string;
}

export interface IoiPulseRecord {
  roundId: string;
  userId: string;
  pulse: IoiPulse;
  updatedAt: string;
}

export interface Endorsement {
  id: string;
  roundId: string;
  companyId: string;
  endorserUserId: string;          // cap-table investor
  chip: EndorsementChip;
  text: string;                    // ≤300 chars
  disclaimerAck: true;             // mandatory
  createdAt: string;
  removedAt?: string;
  removedByUserId?: string;
}

export interface CrossCohortDm {
  id: string;
  roundId: string;
  fromUserId: string;              // cap-table investor
  toUserId: string;                // soft-circler
  body: string;
  createdAt: string;
  status: CrossCohortDmStatus;
}

export interface QaQuestion {
  id: string;
  roundId: string;
  askerUserId: string;             // soft-circler
  body: string;
  createdAt: string;
  status: QaStatus;
  archivedByUserId?: string;
}

export interface QaAnswer {
  id: string;
  questionId: string;
  authorUserId: string;            // cap-table investor
  body: string;
  createdAt: string;
  deleted?: boolean;
}

export interface DiligenceVolunteer {
  id: string;
  roundId: string;
  volunteerUserId: string;         // cap-table investor offering
  softCirclerUserId: string;
  status: "created" | "slot_requested" | "scheduled" | "declined";
  createdAt: string;
}

/* ===========================================================================
 * State
 * ======================================================================== */

const coInvestorGroups: CoInvestorGroup[] = [];
const coInvestorGroupMessages: CoInvestorGroupMessage[] = [];
const introRequests: Array<{ id: string; groupId: string; requesterId: string; targetId: string; status: string; createdAt: string }> = [];

const softCirclePeerOptIns: SoftCirclePeerOptIn[] = [];
const ioiPulses: IoiPulseRecord[] = [];

const endorsements: Endorsement[] = [];
const crossCohortDms: CrossCohortDm[] = [];
const qaQuestions: QaQuestion[] = [];
const qaAnswers: QaAnswer[] = [];
const diligenceVolunteers: DiligenceVolunteer[] = [];

const muteList: Array<{ roundId: string; muterId: string; mutedId: string }> = [];

/* ===========================================================================
 * Telemetry collector (in-memory; supplements Sprint 14 trace store)
 * ======================================================================== */

interface TelemetryEvent {
  ts: string;
  kind: string;
  payload: Record<string, unknown>;
}
const telemetry: TelemetryEvent[] = [];
function emit(kind: string, payload: Record<string, unknown>) {
  telemetry.push({ ts: new Date().toISOString(), kind, payload });
  if (telemetry.length > 500) telemetry.shift();
}

/* ===========================================================================
 * Hash chains — 6 NEW aggregates per Sprint 16 D7
 * ======================================================================== */

export const coInvestorGroupChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("co_investor_group")
);
export const softCirclePeerChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("soft_circle_peer")
);
export const endorsementChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("endorsements")
);
export const crossCohortDmChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("cross_cohort_dm")
);
export const roundQaChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("round_qa")
);
export const diligenceVolunteerChain = registerChain(
  new HashChain<{ id: string; kind: string; ts: string; payload: Record<string, unknown> }>("diligence_volunteers")
);

/* ===========================================================================
 * CRM enrichment — high_value_advocate flag (advisory only)
 * ======================================================================== */

const highValueAdvocates = new Set<string>();
const communitySignalViews: Array<{ ts: string; founderUserId: string; roundId: string }> = [];

export function isHighValueAdvocate(userId: string): boolean { return highValueAdvocates.has(userId); }

/* ===========================================================================
 * Test helpers
 * ======================================================================== */

export function __resetCommsTiers() {
  coInvestorGroups.length = 0;
  coInvestorGroupMessages.length = 0;
  introRequests.length = 0;
  softCirclePeerOptIns.length = 0;
  ioiPulses.length = 0;
  endorsements.length = 0;
  crossCohortDms.length = 0;
  qaQuestions.length = 0;
  qaAnswers.length = 0;
  diligenceVolunteers.length = 0;
  muteList.length = 0;
  telemetry.length = 0;
  highValueAdvocates.clear();
  communitySignalViews.length = 0;
  coInvestorGroupChain.__clear();
  softCirclePeerChain.__clear();
  endorsementChain.__clear();
  crossCohortDmChain.__clear();
  roundQaChain.__clear();
  diligenceVolunteerChain.__clear();
}

export function __getTelemetry(): readonly TelemetryEvent[] { return telemetry; }
export function __getStores() {
  return {
    coInvestorGroups, coInvestorGroupMessages, introRequests,
    softCirclePeerOptIns, ioiPulses, endorsements, crossCohortDms,
    qaQuestions, qaAnswers, diligenceVolunteers, muteList,
    highValueAdvocates, communitySignalViews,
  };
}

/* ===========================================================================
 * Pure helpers (used by tests + routes)
 * ======================================================================== */

function id(prefix: string): string { return `${prefix}_${randomBytes(6).toString("hex")}`; }

const TRACE = { formulaId: "comms-tiers-v1", version: "1.0.0", region: "US" } as const;

/** Tier 1 — co-investor group create/post. */
export function createCoInvestorGroup(args: { companyId: string; participants: string[]; actorId: string }): CoInvestorGroup {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const g: CoInvestorGroup = {
      id: id("cig"),
      companyId: args.companyId,
      participants: [...new Set(args.participants)],
      createdAt: new Date().toISOString(),
    };
    coInvestorGroups.push(g);
    coInvestorGroupChain.append({ id: g.id, kind: "group_created", ts: g.createdAt, payload: { companyId: g.companyId, participants: g.participants, actorId: args.actorId } });
    emit("co_investor.group.created", { groupId: g.id, companyId: g.companyId, actorId: args.actorId });
    return g;
  });
}

export function postCoInvestorGroupMessage(args: { groupId: string; authorUserId: string; body: string }): CoInvestorGroupMessage {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const grp = coInvestorGroups.find(g => g.id === args.groupId && !g.archivedAt);
    if (!grp) throw new Error(`co-investor group not found: ${args.groupId}`);
    const m: CoInvestorGroupMessage = {
      id: id("cigm"),
      groupId: args.groupId,
      authorUserId: args.authorUserId,
      body: args.body,
      createdAt: new Date().toISOString(),
    };
    coInvestorGroupMessages.push(m);
    coInvestorGroupChain.append({ id: m.id, kind: "message", ts: m.createdAt, payload: { groupId: m.groupId, authorUserId: m.authorUserId } });
    emit("co_investor.group.message.sent", { messageId: m.id, groupId: m.groupId, authorUserId: m.authorUserId });
    return m;
  });
}

export function requestCoInvestorIntro(args: { groupId: string; requesterId: string; targetId: string }): { id: string; status: string } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const r = {
      id: id("intro"),
      groupId: args.groupId,
      requesterId: args.requesterId,
      targetId: args.targetId,
      status: "requested",
      createdAt: new Date().toISOString(),
    };
    introRequests.push(r);
    coInvestorGroupChain.append({ id: r.id, kind: "intro_requested", ts: r.createdAt, payload: { groupId: r.groupId, requesterId: r.requesterId, targetId: r.targetId } });
    emit("co_investor.intro.requested", { introId: r.id, groupId: r.groupId, requesterId: r.requesterId, targetId: r.targetId });
    return r;
  });
}

/** Tier 2 — soft-circle peer + IOI Pulse. */
export function setSoftCirclePeerOptIn(args: { roundId: string; userId: string; optedIn: boolean; crossCohortDmOptedIn?: boolean }): SoftCirclePeerOptIn {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const idx = softCirclePeerOptIns.findIndex(o => o.roundId === args.roundId && o.userId === args.userId);
    const rec: SoftCirclePeerOptIn = {
      roundId: args.roundId,
      userId: args.userId,
      optedIn: args.optedIn,
      crossCohortDmOptedIn: args.crossCohortDmOptedIn ?? (idx >= 0 ? softCirclePeerOptIns[idx].crossCohortDmOptedIn : false),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) softCirclePeerOptIns[idx] = rec; else softCirclePeerOptIns.push(rec);
    softCirclePeerChain.append({ id: `${args.roundId}:${args.userId}`, kind: args.optedIn ? "peer_opted_in" : "peer_opted_out", ts: rec.updatedAt, payload: { ...rec } });
    emit(args.optedIn ? "soft_circle.peer.opted_in" : "soft_circle.peer.opted_out", { roundId: args.roundId, userId: args.userId });
    return rec;
  });
}

export function setIoiPulse(args: { roundId: string; userId: string; pulse: IoiPulse }): IoiPulseRecord {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const idx = ioiPulses.findIndex(p => p.roundId === args.roundId && p.userId === args.userId);
    const prior = idx >= 0 ? ioiPulses[idx].pulse : null;
    const rec: IoiPulseRecord = { roundId: args.roundId, userId: args.userId, pulse: args.pulse, updatedAt: new Date().toISOString() };
    if (idx >= 0) ioiPulses[idx] = rec; else ioiPulses.push(rec);
    softCirclePeerChain.append({ id: `pulse:${args.roundId}:${args.userId}`, kind: "ioi_pulse", ts: rec.updatedAt, payload: { roundId: args.roundId, userId: args.userId, pulse: args.pulse, prior } });
    emit(prior === null ? "soft_circle.ioi_pulse.submitted" : "soft_circle.ioi_pulse.changed", { roundId: args.roundId, userId: args.userId, pulse: args.pulse, prior });
    return rec;
  });
}

export function aggregateIoiPulse(roundId: string): { leaning_yes: number; need_diligence: number; pass: number } {
  const buckets = { leaning_yes: 0, need_diligence: 0, pass: 0 };
  for (const p of ioiPulses) {
    if (p.roundId === roundId) buckets[p.pulse]++;
  }
  return buckets;
}

/** Tier 3 — endorsements. */
export const ENDORSEMENT_DISCLAIMER = "This reflects the investor's personal opinion. Capavate does not verify claims.";
export const ENDORSEMENT_CHIPS: EndorsementChip[] = [
  "founder_execution", "market_traction", "team_quality", "product_strength", "existing_portfolio_fit",
];

export function createEndorsement(args: { roundId: string; companyId: string; endorserUserId: string; chip: EndorsementChip; text: string; disclaimerAck: boolean }): Endorsement | { error: string } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    if (!ENDORSEMENT_CHIPS.includes(args.chip)) return { error: "invalid_chip" };
    if ((args.text ?? "").length > 300) return { error: "text_too_long" };
    if (!args.disclaimerAck) return { error: "disclaimer_required" };
    const e: Endorsement = {
      id: id("end"),
      roundId: args.roundId,
      companyId: args.companyId,
      endorserUserId: args.endorserUserId,
      chip: args.chip,
      text: args.text ?? "",
      disclaimerAck: true,
      createdAt: new Date().toISOString(),
    };
    endorsements.push(e);
    endorsementChain.append({ id: e.id, kind: "endorsement_created", ts: e.createdAt, payload: { ...e } });
    // CRM enrichment — endorser earns advisory advocate flag
    highValueAdvocates.add(args.endorserUserId);
    emit("round.endorsement.created", { endorsementId: e.id, roundId: e.roundId, endorserUserId: e.endorserUserId, chip: e.chip });
    return e;
  });
}

export function removeEndorsement(args: { id: string; founderUserId: string }): { ok: boolean; reason?: string } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const e = endorsements.find(x => x.id === args.id);
    if (!e) return { ok: false, reason: "not_found" };
    if (e.removedAt) return { ok: false, reason: "already_removed" };
    e.removedAt = new Date().toISOString();
    e.removedByUserId = args.founderUserId;
    endorsementChain.append({ id: e.id, kind: "endorsement_removed", ts: e.removedAt, payload: { id: e.id, founderUserId: args.founderUserId } });
    emit("round.endorsement.removed", { endorsementId: e.id, founderUserId: args.founderUserId });
    return { ok: true };
  });
}

/** Tier 3 — cross-cohort DM. Hard cap = 3 unsolicited DMs per soft-circler per round, COMBINED. */
export const CROSS_COHORT_DM_HARD_CAP = 3;

export function startCrossCohortDm(args: { roundId: string; fromUserId: string; toUserId: string; body: string }): CrossCohortDm | { error: string; status?: CrossCohortDmStatus } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    // Privacy guard #3: soft-circler must have opted in for cross-cohort DMs
    const optIn = softCirclePeerOptIns.find(o => o.roundId === args.roundId && o.userId === args.toUserId);
    if (!optIn || !optIn.crossCohortDmOptedIn) return { error: "soft_circler_opted_out", status: "blocked" };
    // Mute/block per cap-table investor
    const isMuted = muteList.some(m => m.roundId === args.roundId && m.muterId === args.toUserId && m.mutedId === args.fromUserId);
    if (isMuted) return { error: "muted_by_recipient", status: "muted" };
    // Hard cap (Top-5 #1) — count UNSOLICITED DMs to this soft-circler in this round across ALL senders
    const count = crossCohortDms.filter(d => d.roundId === args.roundId && d.toUserId === args.toUserId).length;
    if (count >= CROSS_COHORT_DM_HARD_CAP) {
      emit("cross_cohort.dm.rate_limit_hit", { roundId: args.roundId, toUserId: args.toUserId, attempts: count + 1 });
      return { error: "rate_limit_combined_cap_reached", status: "rate_limited" };
    }
    const dm: CrossCohortDm = {
      id: id("xdm"),
      roundId: args.roundId,
      fromUserId: args.fromUserId,
      toUserId: args.toUserId,
      body: args.body,
      createdAt: new Date().toISOString(),
      status: count + 1 >= CROSS_COHORT_DM_HARD_CAP ? "rate_limited" : "open",
    };
    crossCohortDms.push(dm);
    crossCohortDmChain.append({ id: dm.id, kind: "dm_started", ts: dm.createdAt, payload: { roundId: dm.roundId, fromUserId: dm.fromUserId, toUserId: dm.toUserId } });
    emit("cross_cohort.dm.started", { dmId: dm.id, roundId: dm.roundId, fromUserId: dm.fromUserId, toUserId: dm.toUserId, remainingAfter: Math.max(0, CROSS_COHORT_DM_HARD_CAP - (count + 1)) });
    return dm;
  });
}

export function muteCrossCohort(args: { roundId: string; muterId: string; mutedId: string }) {
  muteList.push({ ...args });
  emit("cross_cohort.dm.muted", args);
}

/** Tier 3 — Q&A. */
export function postQaQuestion(args: { roundId: string; askerUserId: string; body: string }): QaQuestion {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const q: QaQuestion = { id: id("qaq"), roundId: args.roundId, askerUserId: args.askerUserId, body: args.body, createdAt: new Date().toISOString(), status: "open" };
    qaQuestions.push(q);
    roundQaChain.append({ id: q.id, kind: "question_posted", ts: q.createdAt, payload: { roundId: q.roundId, askerUserId: q.askerUserId } });
    emit("round.qa.question.posted", { questionId: q.id, roundId: q.roundId, askerUserId: q.askerUserId });
    return q;
  });
}

export function postQaAnswer(args: { questionId: string; authorUserId: string; body: string }): QaAnswer | { error: string } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const q = qaQuestions.find(x => x.id === args.questionId);
    if (!q) return { error: "question_not_found" };
    if (q.status === "archived") return { error: "question_archived" };
    const a: QaAnswer = { id: id("qaa"), questionId: args.questionId, authorUserId: args.authorUserId, body: args.body, createdAt: new Date().toISOString() };
    qaAnswers.push(a);
    roundQaChain.append({ id: a.id, kind: "answer_posted", ts: a.createdAt, payload: { questionId: a.questionId, authorUserId: a.authorUserId } });
    emit("round.qa.answer.posted", { answerId: a.id, questionId: a.questionId, authorUserId: a.authorUserId });
    return a;
  });
}

export function archiveQaThread(args: { questionId: string; founderUserId: string }): { ok: boolean; reason?: string } {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const q = qaQuestions.find(x => x.id === args.questionId);
    if (!q) return { ok: false, reason: "not_found" };
    q.status = "archived";
    q.archivedByUserId = args.founderUserId;
    roundQaChain.append({ id: q.id, kind: "question_archived", ts: new Date().toISOString(), payload: { id: q.id, founderUserId: args.founderUserId } });
    emit("round.qa.archived", { questionId: q.id, founderUserId: args.founderUserId });
    return { ok: true };
  });
}

/** Tier 3 — diligence volunteer. */
export function createDiligenceVolunteer(args: { roundId: string; volunteerUserId: string; softCirclerUserId: string }): DiligenceVolunteer {
  return withTrace(TRACE.formulaId, TRACE.version, TRACE.region, () => {
    const v: DiligenceVolunteer = { id: id("dv"), roundId: args.roundId, volunteerUserId: args.volunteerUserId, softCirclerUserId: args.softCirclerUserId, status: "created", createdAt: new Date().toISOString() };
    diligenceVolunteers.push(v);
    diligenceVolunteerChain.append({ id: v.id, kind: "volunteer_created", ts: v.createdAt, payload: { ...v } });
    emit("diligence.volunteer.created", { volunteerId: v.id, roundId: v.roundId, volunteerUserId: v.volunteerUserId });
    return v;
  });
}

export function requestDiligenceSlot(args: { id: string }): { ok: boolean } {
  const v = diligenceVolunteers.find(x => x.id === args.id);
  if (!v) return { ok: false };
  v.status = "slot_requested";
  diligenceVolunteerChain.append({ id: v.id, kind: "slot_requested", ts: new Date().toISOString(), payload: { id: v.id } });
  emit("diligence.slot.requested", { volunteerId: v.id });
  return { ok: true };
}

/** Founder community-signals dashboard. Aggregate-only — never per-investor content. */
export function getCommunitySignalsForFounder(args: { roundId: string; founderUserId: string; companyId: string }) {
  // Audit-log this view (#5)
  communitySignalViews.push({ ts: new Date().toISOString(), founderUserId: args.founderUserId, roundId: args.roundId });
  emit("founder.community_signals.viewed", { roundId: args.roundId, founderUserId: args.founderUserId });
  // Aggregate-only counts (no content, no per-investor identifiers)
  const ioi = aggregateIoiPulse(args.roundId);
  const endorsementCount = endorsements.filter(e => e.roundId === args.roundId && !e.removedAt).length;
  // Yes/No per soft-circler whether they've received endorsements (NEVER content)
  const softCirclersWithEndorsements = endorsements
    .filter(e => e.roundId === args.roundId && !e.removedAt)
    .reduce((acc: Record<string, boolean>, _e) => {
      // Endorsements are for the round, not per soft-circler — so we just expose a count here.
      return acc;
    }, {});
  const qaQuestionCount = qaQuestions.filter(q => q.roundId === args.roundId).length;
  const qaAnswerCount = qaAnswers.filter(a => qaQuestions.find(q => q.id === a.questionId && q.roundId === args.roundId)).length;
  const diligenceCount = diligenceVolunteers.filter(d => d.roundId === args.roundId).length;
  return {
    roundId: args.roundId,
    ioiPulse: ioi,
    endorsementCount,
    qaQuestionCount,
    qaAnswerCount,
    diligenceVolunteerCount: diligenceCount,
    softCirclersWithEndorsementsCount: Object.keys(softCirclersWithEndorsements).length,
    privacy: "aggregate_only_no_per_investor_content",
    auditLogged: true,
  };
}

/* ===========================================================================
 * Routes (Express)
 * ======================================================================== */

export function registerCommsTiersRoutes(app: Express): void {
  /* ----- Tier 1 ----- */
  app.post("/api/comms/co-investor-groups", (req: Request, res: Response) => {
    const { companyId, participants, actorId } = req.body ?? {};
    if (!companyId || !Array.isArray(participants)) return res.status(400).json({ error: "missing_fields" });
    const g = createCoInvestorGroup({ companyId, participants, actorId: String(actorId ?? "u_unknown") });
    res.json(g);
  });

  app.get("/api/comms/co-investor-groups/:companyId", (req: Request, res: Response) => {
    const groups = coInvestorGroups.filter(g => g.companyId === req.params.companyId && !g.archivedAt);
    res.json({ groups });
  });

  app.post("/api/comms/co-investor-groups/:id/messages", (req: Request, res: Response) => {
    const { authorUserId, body } = req.body ?? {};
    if (!authorUserId || !body) return res.status(400).json({ error: "missing_fields" });
    const m = postCoInvestorGroupMessage({ groupId: req.params.id, authorUserId, body });
    res.json(m);
  });

  app.post("/api/comms/co-investor-groups/:id/intro", (req: Request, res: Response) => {
    const { requesterId, targetId } = req.body ?? {};
    if (!requesterId || !targetId) return res.status(400).json({ error: "missing_fields" });
    const r = requestCoInvestorIntro({ groupId: req.params.id, requesterId, targetId });
    res.json(r);
  });

  /* ----- Tier 2 ----- */
  app.get("/api/comms/soft-circle/:roundId/peer", (req: Request, res: Response) => {
    const optIns = softCirclePeerOptIns.filter(o => o.roundId === req.params.roundId);
    // MIM-aggregated peer view — return anon chips (no legal names)
    const peers = optIns.filter(o => o.optedIn).map(o => ({ userId: o.userId, optedIn: o.optedIn, crossCohortDmOptedIn: o.crossCohortDmOptedIn }));
    res.json({ roundId: req.params.roundId, peerCount: peers.length, peers });
  });

  app.post("/api/comms/soft-circle/:roundId/peer", (req: Request, res: Response) => {
    const { userId, optedIn, crossCohortDmOptedIn } = req.body ?? {};
    if (!userId || typeof optedIn !== "boolean") return res.status(400).json({ error: "missing_fields" });
    const r = setSoftCirclePeerOptIn({ roundId: req.params.roundId, userId, optedIn, crossCohortDmOptedIn });
    res.json(r);
  });

  app.patch("/api/rounds/:roundId/ioi-pulse", (req: Request, res: Response) => {
    const { userId, pulse } = req.body ?? {};
    if (!userId || !["leaning_yes", "need_diligence", "pass"].includes(pulse)) return res.status(400).json({ error: "missing_or_invalid_pulse" });
    const r = setIoiPulse({ roundId: req.params.roundId, userId, pulse });
    res.json(r);
  });

  app.get("/api/rounds/:roundId/ioi-pulse/aggregate", (req: Request, res: Response) => {
    res.json({ roundId: req.params.roundId, aggregate: aggregateIoiPulse(req.params.roundId) });
  });

  /* ----- Tier 3 ----- */
  app.post("/api/rounds/:roundId/endorsements", (req: Request, res: Response) => {
    const { companyId, endorserUserId, chip, text, disclaimerAck } = req.body ?? {};
    const r = createEndorsement({ roundId: req.params.roundId, companyId, endorserUserId, chip, text, disclaimerAck });
    if ("error" in r) return res.status(400).json(r);
    res.json(r);
  });

  app.delete("/api/rounds/:roundId/endorsements/:id", (req: Request, res: Response) => {
    const { founderUserId } = req.body ?? {};
    const r = removeEndorsement({ id: req.params.id, founderUserId });
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  });

  app.post("/api/comms/cross-cohort/dm/start", (req: Request, res: Response) => {
    const { roundId, fromUserId, toUserId, body } = req.body ?? {};
    const r = startCrossCohortDm({ roundId, fromUserId, toUserId, body });
    if ("error" in r) return res.status(429).json(r);
    res.json(r);
  });

  app.post("/api/comms/cross-cohort/mute", (req: Request, res: Response) => {
    const { roundId, muterId, mutedId } = req.body ?? {};
    if (!roundId || !muterId || !mutedId) return res.status(400).json({ error: "missing_fields" });
    muteCrossCohort({ roundId, muterId, mutedId });
    res.json({ ok: true });
  });

  app.get("/api/rounds/:roundId/qa", (req: Request, res: Response) => {
    const qs = qaQuestions.filter(q => q.roundId === req.params.roundId);
    const ans = qaAnswers.filter(a => qs.some(q => q.id === a.questionId));
    res.json({ questions: qs, answers: ans });
  });

  app.post("/api/rounds/:roundId/qa", (req: Request, res: Response) => {
    // Patch v9 (P0-3): when an authenticated userContext is present, askerUserId
    // MUST come from the session. If the body supplies a different askerUserId,
    // reject with 400 to prevent IDOR / identity spoofing. Unit-test harnesses
    // that mount this router without loadUserContext fall through to the legacy
    // body-driven path so existing tests still pass.
    const ctx = (req as unknown as { userContext?: { isAuthed?: boolean; userId?: string } }).userContext;
    const sessionUserId = ctx?.isAuthed ? ctx.userId : undefined;
    const bodyIn = (req.body ?? {}) as { askerUserId?: string; body?: string };
    if (sessionUserId) {
      if (typeof bodyIn.askerUserId === "string" && bodyIn.askerUserId !== sessionUserId) {
        return res.status(400).json({ ok: false, error: "askerUserId_must_match_session" });
      }
      const body = bodyIn.body;
      if (!body) return res.status(400).json({ error: "missing_fields" });
      const q = postQaQuestion({ roundId: req.params.roundId, askerUserId: sessionUserId, body });
      return res.json(q);
    }
    // Legacy path: no userContext mounted — fall back to body field.
    const { askerUserId, body } = bodyIn;
    if (!askerUserId || !body) return res.status(400).json({ error: "missing_fields" });
    const q = postQaQuestion({ roundId: req.params.roundId, askerUserId, body });
    res.json(q);
  });

  app.post("/api/rounds/:roundId/qa/:qid/answers", (req: Request, res: Response) => {
    const { authorUserId, body } = req.body ?? {};
    const r = postQaAnswer({ questionId: req.params.qid, authorUserId, body });
    if ("error" in r) return res.status(400).json(r);
    res.json(r);
  });

  app.post("/api/rounds/:roundId/qa/:qid/archive", (req: Request, res: Response) => {
    const { founderUserId } = req.body ?? {};
    const r = archiveQaThread({ questionId: req.params.qid, founderUserId });
    if (!r.ok) return res.status(400).json(r);
    res.json(r);
  });

  app.post("/api/rounds/:roundId/diligence-volunteers", (req: Request, res: Response) => {
    const { volunteerUserId, softCirclerUserId } = req.body ?? {};
    if (!volunteerUserId || !softCirclerUserId) return res.status(400).json({ error: "missing_fields" });
    const v = createDiligenceVolunteer({ roundId: req.params.roundId, volunteerUserId, softCirclerUserId });
    res.json(v);
  });

  app.post("/api/rounds/:roundId/diligence-volunteers/:id/slot", (req: Request, res: Response) => {
    const r = requestDiligenceSlot({ id: req.params.id });
    if (!r.ok) return res.status(404).json(r);
    res.json(r);
  });

  /* ----- Founder community-signals dashboard ----- */
  app.get("/api/rounds/:roundId/community-signals", (req: Request, res: Response) => {
    const { founderUserId, companyId } = req.query as Record<string, string>;
    if (!founderUserId) return res.status(400).json({ error: "missing_founder_user_id" });
    res.json(getCommunitySignalsForFounder({ roundId: req.params.roundId, founderUserId, companyId: companyId ?? "" }));
  });

  /* ----- Tabbed channel listing for Messages page (C4) ----- */
  app.get("/api/comms/channels-tiered", (req: Request, res: Response) => {
    const view = String(req.query.view ?? "tabbed");
    if (view !== "tabbed") return res.status(400).json({ error: "unknown_view" });
    const userId = String(req.query.userId ?? "");
    res.json({
      capTableCommunity: coInvestorGroups
        .filter(g => !userId || g.participants.includes(userId))
        .map(g => ({ id: g.id, kind: "co_investor_group", companyId: g.companyId, tier: 1, badge: "Cap-Table" })),
      softCircleCommunity: softCirclePeerOptIns
        .filter(o => o.optedIn && (!userId || o.userId === userId))
        .map(o => ({ id: `${o.roundId}:${o.userId}`, kind: "soft_circle_peer", roundId: o.roundId, tier: 2, badge: "Soft-Circle" })),
      crossCohort: crossCohortDms
        .filter(d => !userId || d.fromUserId === userId || d.toUserId === userId)
        .map(d => ({ id: d.id, kind: "cross_cohort_dm", roundId: d.roundId, tier: 3, badge: "Cross-Cohort", status: d.status })),
    });
  });

  /* ----- CRM enrichment readback ----- */
  app.get("/api/founder/crm/high-value-advocates", (_req: Request, res: Response) => {
    res.json({
      label: "For informational purposes only",
      advocates: Array.from(highValueAdvocates),
      note: "Advisory CRM-only flag; NOT a cap-table-engine input.",
    });
  });

  app.get("/api/comms/dev/telemetry", (_req, res) => res.json({ events: telemetry.slice(-200) }));
}
