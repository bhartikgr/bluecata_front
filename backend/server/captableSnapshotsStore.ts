/**
 * server/captableSnapshotsStore.ts — W-CT (2026-07-14).
 *
 * Read-only cap-table presentation surface:
 *   - "pending"  : the projected / illustrative cap-table positions for rounds
 *                  that are still active/live (NOT yet closed). These are shown
 *                  with a banner clarifying the final cap table is set at round
 *                  close.
 *   - "previous" : the last COMMITTED round snapshot from the immutable ledger
 *                  (ASK ACT.1 = Option A: last committed snapshot from the
 *                  existing read API). Hidden when no prior committed round
 *                  exists.
 *
 * BOUNDARIES (rule #2 / #14): this file performs **zero writes**. It only calls
 * the existing READERS `listMembersForCompany` (captableCommitStore) and
 * `getRoundsForCompany` / `getRoundById` (roundsStore), and reuses the demo
 * `securities` array via a getter injected at registration. The sacred money
 * core `captableCommitStore.ts` sha (`32ba97cbcdf97750`) is untouched — nothing
 * here imports a writer or mutates ledger state.
 */
import type { Express, Request, Response } from "express";
import { listMembersForCompany } from "./captableCommitStore";
import { getRoundsForCompany, getRoundById, ACTIVE_LIVE_ROUND_STATES } from "./roundsStore";
import { getUserContext } from "./lib/userContext";
import { log } from "./lib/logger";
/* WAVE 35 · F6 — THE FOURTH CAP-TABLE SINK. This route authorised with the same
   `capTablePositions.some(...)` equality check as the gate, then enumerated the
   ledger with no SPV exclusion. Review A probed it as a real-but-wrong LP and
   LP Alpha received LP Beta's name and a $7,500,000 position. Shared decision,
   static import — see server/lib/capTableSinkScope.ts. */
import {
  decideCapTableSinkAccess,
  scopeCapTableRows,
  CAP_TABLE_SINK_NOT_FOUND,
  CAP_TABLE_SINK_NOT_FOUND_STATUS,
  type CapTableSinkAccess,
} from "./lib/capTableSinkScope";

/** The client engine consumes this shape (subset of ApiSecurity). */
export interface SnapshotPosition {
  id: string;
  companyId: string;
  holderName: string;
  holderType: string;
  instrument: string;
  series: string | null;
  shares: number;
  pricePerShare: number | null;
  investmentAmount: number;
  cap: number | null;
  discount: number | null;
  issuedAt: string | null;
  roundId: string | null;
  investorId: string | null;
  accruedInterest: number;
}

export interface CaptableSnapshotsResponse {
  ok: true;
  /** Rounds still active/live — their positions are projected/illustrative. */
  pending: {
    hasPending: boolean;
    roundIds: string[];
    positions: SnapshotPosition[];
  };
  /** Last COMMITTED round snapshot (Option A), or null when none exists. */
  previous: {
    hasPrevious: boolean;
    roundId: string | null;
    roundName: string | null;
    committedAt: string | null;
    positions: SnapshotPosition[];
  };
}

/**
 * Registration injects a `getSecurities` reader so this file does not need to
 * reach into routes.ts's in-memory demo `securities` array directly (keeping it
 * decoupled + testable). The reader returns the full securities array; we filter
 * by companyId here.
 */
type SecuritiesReader = () => any[];

/* WAVE 83 · ITEM 3 — NEVER RENDER A KEY WHERE A NAME BELONGS.
   `u_redeemed_1782888492403` was shown to a founder in the Holder column of the
   projected cap table. Both builders below fell back to the raw `investorId`,
   and for an invite-redeemed persona that id is a synthetic `u_redeemed_<ts>`
   minted at runtime with no `users` row — the same root cause as the unbound
   actor records tracked elsewhere. This says WHAT THE ROW IS instead. */
function humanHolderLabel(raw: unknown, investorId: unknown): string {
  const name = String(raw ?? "").trim();
  const isRawId = (v: string) => /^u_[A-Za-z0-9_]*$/.test(v);
  if (name && !isRawId(name)) return name;
  const id = String(investorId ?? "").trim();
  if (/^u_redeemed_/.test(id)) return "Redeemed holder";
  if (id === "u_public") return "Public applicant";
  if (id && isRawId(id)) return "Holder (name not recorded)";
  if (id) return id.length <= 40 && !isRawId(id) ? id : "Holder (name not recorded)";
  return "Holder (name not recorded)";
}

function ledgerRowToPosition(e: any): SnapshotPosition {
  const holderName = (e.holderFirstName || e.holderLastName)
    ? `${e.holderFirstName ?? ""} ${e.holderLastName ?? ""}`.trim()
    : humanHolderLabel(null, e.investorId);
  const unpriced = (e.instrumentClass ?? "priced") === "unpriced";
  let instrument = unpriced ? "safe" : "equity";
  try {
    const rnd = getRoundById(String(e.roundId ?? ""));
    const inst = String((rnd as any)?.instrument ?? "").toLowerCase();
    if (unpriced && /note|convertible/.test(inst)) instrument = "note";
    else if (!unpriced && inst) instrument = inst;
  } catch { /* keep default */ }
  const principal = Number(e.principalAmount ?? e.amount ?? 0);
  const sharesNum = Number(e.shares ?? 0);
  return {
    id: `ccm_sec_${e.invitationId}`,
    companyId: String(e.companyId),
    holderName,
    holderType: "investor",
    instrument,
    series: null,
    shares: Number.isFinite(sharesNum) ? sharesNum : 0,
    pricePerShare: null,
    investmentAmount: Number.isFinite(principal) ? principal : 0,
    cap: e.valuationCap != null ? Number(e.valuationCap) : null,
    discount: e.discountPct != null ? Number(e.discountPct) : null,
    issuedAt: e.ts ?? null,
    roundId: e.roundId ?? null,
    investorId: e.investorId ?? null,
    accruedInterest: 0,
  };
}

function baseSecToPosition(s: any): SnapshotPosition {
  return {
    id: String(s.id),
    companyId: String(s.companyId),
    holderName: humanHolderLabel(s.holderName, s.investorId),
    holderType: String(s.holderType ?? "investor"),
    instrument: String(s.instrument ?? "equity"),
    series: s.series ?? null,
    shares: Number(s.shares ?? 0),
    pricePerShare: s.pricePerShare != null ? Number(s.pricePerShare) : null,
    investmentAmount: Number(s.investmentAmount ?? 0),
    cap: s.cap != null ? Number(s.cap) : null,
    discount: s.discount != null ? Number(s.discount) : null,
    issuedAt: s.issuedAt ?? null,
    roundId: s.roundId ?? null,
    investorId: s.investorId ?? null,
    accruedInterest: Number(s.accruedInterest ?? 0),
  };
}

/**
 * Compute the pending + previous snapshots for a company using readers only.
 * Exported for direct unit testing.
 */
export function computeCaptableSnapshots(
  companyId: string,
  getSecurities: SecuritiesReader,
): CaptableSnapshotsResponse {
  const rounds = (getRoundsForCompany(companyId) ?? []) as Array<any>;
  const activeLiveRoundIds = new Set(
    rounds
      .filter((r) => ACTIVE_LIVE_ROUND_STATES.has(String(r.state ?? "").toLowerCase()))
      .map((r) => String(r.id)),
  );

  // ---- PENDING: base securities + committed unpriced positions whose round is
  //      still active/live (projected / illustrative until the round closes). ----
  const baseSecurities = (getSecurities() ?? []).filter((s: any) => String(s.companyId) === companyId);
  const committed = listMembersForCompany(companyId) as Array<any>; // state === 'committed'

  const pendingPositions: SnapshotPosition[] = [];
  const pendingRoundIds = new Set<string>();
  for (const s of baseSecurities) {
    const rid = s.roundId != null ? String(s.roundId) : null;
    if (rid && activeLiveRoundIds.has(rid)) {
      pendingPositions.push(baseSecToPosition(s));
      pendingRoundIds.add(rid);
    }
  }
  for (const e of committed) {
    const rid = e.roundId != null ? String(e.roundId) : null;
    if (rid && activeLiveRoundIds.has(rid)) {
      pendingPositions.push(ledgerRowToPosition(e));
      pendingRoundIds.add(rid);
    }
  }

  // ---- PREVIOUS (Option A): last COMMITTED round snapshot from the ledger.
  //      Group committed entries by roundId, order rounds by their latest
  //      commit seq; "previous" = the most recent round that is NOT still
  //      active/live (i.e. a genuinely prior, closed/committed round). If only
  //      active/live rounds have commits, there is no previous snapshot. ----
  const byRound = new Map<string, { positions: SnapshotPosition[]; maxSeq: number }>();
  for (const e of committed) {
    const rid = e.roundId != null ? String(e.roundId) : null;
    if (!rid) continue;
    const seq = Number(e.seq ?? 0);
    const bucket = byRound.get(rid) ?? { positions: [], maxSeq: -1 };
    bucket.positions.push(ledgerRowToPosition(e));
    if (seq > bucket.maxSeq) bucket.maxSeq = seq;
    byRound.set(rid, bucket);
  }
  // Candidate "previous" rounds = committed rounds that are NOT active/live now.
  const priorRounds = Array.from(byRound.entries())
    .filter(([rid]) => !activeLiveRoundIds.has(rid))
    .sort((a, b) => b[1].maxSeq - a[1].maxSeq); // most-recent committed first

  let previous: CaptableSnapshotsResponse["previous"] = {
    hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [],
  };
  if (priorRounds.length > 0) {
    const [rid, bucket] = priorRounds[0];
    let roundName: string | null = null;
    let committedAt: string | null = null;
    try {
      const rnd = getRoundById(rid);
      roundName = (rnd as any)?.name ?? (rnd as any)?.roundName ?? null;
    } catch (err) {
      // W-FIX4 item 9-N1 — observability-only: name resolution stays best-effort
      // (roundName falls back to null). Emit a warning so the miss is auditable;
      // control flow and the snapshot response are UNCHANGED.
      log.warn(`[captableSnapshotsStore.previous] round name resolution failed for ${rid}:`, (err as Error).message);
    }
    // committedAt = latest commit ts in that round.
    const tsList = committed
      .filter((e) => String(e.roundId ?? "") === rid)
      .map((e) => String(e.ts ?? ""))
      .filter(Boolean)
      .sort();
    committedAt = tsList.length ? tsList[tsList.length - 1] : null;
    previous = {
      hasPrevious: true,
      roundId: rid,
      roundName,
      committedAt,
      positions: bucket.positions,
    };
  }

  return {
    ok: true,
    pending: {
      hasPending: pendingPositions.length > 0,
      roundIds: Array.from(pendingRoundIds),
      positions: pendingPositions,
    },
    previous,
  };
}

/**
 * Register the read-only snapshots route. `getSecurities` is the same in-memory
 * demo securities reader routes.ts already owns; passing it in avoids importing
 * routes.ts (circular) and keeps this file a pure reader.
 */
export function registerCaptableSnapshotsRoutes(app: Express, getSecurities: SecuritiesReader): void {
  app.get("/api/companies/:id/captable/snapshots", (req: Request, res: Response) => {
    const cid = String(req.params.id);
    const ctx = (req as any).userContext ?? getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "missing_identity" });
    /* WAVE 35 · F6 + F9. Was: a local `capTablePositions.some(...)` check and a
       403 refusal. Both were wrong — the predicate is the gate's, which an SPV
       LP passes for their own vehicle, and the 403 enumerated SPV ids. */
    const access = decideCapTableSinkAccess(ctx as any, cid);
    if (access.outcome === "refuse") {
      return res.status(CAP_TABLE_SINK_NOT_FOUND_STATUS).json(CAP_TABLE_SINK_NOT_FOUND);
    }
    try {
      const snapshots = computeCaptableSnapshots(cid, getSecurities);
      return res.json(scopeSnapshotsResponse(access, snapshots));
    } catch (err) {
      log.warn("[captableSnapshotsStore] compute failed:", (err as Error).message);
      // Fail-soft: empty snapshots never break the existing cap-table page.
      return res.json({
        ok: true,
        pending: { hasPending: false, roundIds: [], positions: [] },
        previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
      } as CaptableSnapshotsResponse);
    }
  });

  log.info("[captableSnapshotsStore] registered W-CT read-only cap-table snapshots route");
}

/**
 * WAVE 35 · F6 — apply the shared scope decision to what this route EMITS.
 *
 * Exported so the falsification harness can assert on the EMISSION rather than
 * on what the handler merely consults: a Wave-34-era harness asserted the
 * latter and was wrong twice. `allow` returns the response untouched (the
 * genuine-counterparty pole); `scope_to_self` keeps only the caller's own
 * positions in BOTH buckets and recomputes `hasPending` / `hasPrevious` from
 * what actually survives, so the booleans cannot contradict the arrays.
 */
export function scopeSnapshotsResponse(
  access: CapTableSinkAccess,
  snapshots: CaptableSnapshotsResponse,
): CaptableSnapshotsResponse {
  if (access.outcome === "allow") return snapshots;
  const investorIdOf = (p: SnapshotPosition) => p?.investorId ?? null;
  const pendingPositions = scopeCapTableRows(access, snapshots.pending?.positions ?? [], investorIdOf);
  const previousPositions = scopeCapTableRows(access, snapshots.previous?.positions ?? [], investorIdOf);
  const pendingRoundIds = Array.from(
    new Set(pendingPositions.map((p) => String(p?.roundId ?? "")).filter(Boolean)),
  );
  return {
    ok: true,
    pending: {
      hasPending: pendingPositions.length > 0,
      roundIds: pendingRoundIds,
      positions: pendingPositions,
    },
    previous: {
      hasPrevious: previousPositions.length > 0,
      roundId: previousPositions.length > 0 ? snapshots.previous?.roundId ?? null : null,
      roundName: previousPositions.length > 0 ? snapshots.previous?.roundName ?? null : null,
      committedAt: previousPositions.length > 0 ? snapshots.previous?.committedAt ?? null : null,
      positions: previousPositions,
    },
  };
}
