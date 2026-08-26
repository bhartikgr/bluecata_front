/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 154 · BATCH 2 · ITEM K — THE ROUTE-LEVEL GUARD.
                                                            R114, R116.3, R77
   ═══════════════════════════════════════════════════════════════════════════
   One function, used by every gated path, so the refusal is worded and shaped
   identically everywhere and cannot drift route by route. The decision itself
   lives in `spvEligibilityGate.ts`; this file only turns a decision into an HTTP
   response.

   AUDIENCE (R77 + the owner's disclosure split):
     · "partner" / "admin" — the sentence NAMES the company and the next step.
     · "lp"                — the sentence gives the STATE only. An LP is never
                             told another party's billing status.

   `advisory` is for the ADMIN create path: an admin creating an SPV on someone's
   behalf is not refused — they are TOLD, in the success body, that the company is
   not a paid member, because a Capavate admin is precisely the person entitled to
   decide to proceed anyway (and to record an override afterwards).

   `warn` mode (R114, retained but NOT the shipping default) allows the request
   and returns the warning alongside the success payload rather than refusing.
   ═══════════════════════════════════════════════════════════════════════════ */
import type { Response } from "express";
import {
  evaluateLaunchGate,
  renderMembershipStanding,
  companyLabel,
  type GateDecision,
} from "./spvEligibilityGate";
import { log } from "./logger";

export type GateAudience = "partner" | "admin" | "lp";

export interface GateOutcome {
  /** True when the caller already sent a 402 refusal and MUST return now. */
  handled: boolean;
  decision: GateDecision;
  /** Present when the request was allowed but the gate had something to say. */
  advisory: {
    launchGate: {
      eligible: boolean;
      mode: string;
      message: string;
      companies?: {
        companyId: string;
        companyName: string;
        state: string;
        /* W159 — the HONEST label: a comp is never rendered by the same word as a
           payment. See `renderMembershipStanding`. */
        stateLabel: string;
        basis?: string | null;
      }[];
    };
  } | null;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 159 · R126.4 — A COMP IS NOT A PAYMENT, ON EVERY AUDIENCE'S SCREEN.
   ══════════════════════════════════════════════════════════════════════════════
   These rows were built with `renderMembershipState`, which maps the internal
   state `paid` to the word **"Paid"** with no knowledge of WHY the company counts
   as paid. A company comped by Capavate carries `state:"paid", basis:"comped"`, so
   partner, admin and LP payloads all said "Paid" about a company that has never
   paid anything. The reviewer captured it:

     PROBE_GUARD_PAYLOAD [{"companyId":"co_probe_typo","state":"paid","stateLabel":"Paid"}]

   `spvEligibilityGate.ts` already carries the fix and says so in its own docblock
   ("Every admin surface that shows a membership state renders THIS"): wave 155's
   `renderMembershipStanding`. This file simply never used it. It does now.

   This is latent only because the gate is unwired — which is exactly why it is
   fixed BEFORE anything is wired to it (R126.4). Nothing here wires the gate.
   ══════════════════════════════════════════════════════════════════════════════ */
function companyRows(decision: GateDecision) {
  return decision.memberships.map((m) => ({
    companyId: m.companyId,
    companyName: companyLabel(m.companyId),
    state: m.state,
    stateLabel: renderMembershipStanding(m),
    basis: m.basis ?? null,
  }));
}

/**
 * Evaluate the gate for a create/money-in request.
 *
 * Returns `handled: true` when a refusal has ALREADY been written to `res` —
 * the caller must `return` immediately and must not write.
 *
 * HTTP 402 Payment Required is used deliberately: it is the one status whose
 * meaning is "this is a billing state, not a permissions problem and not a bug",
 * which is exactly what a partner needs to understand here. The body always
 * carries a plain sentence next to the code.
 */
export function enforceLaunchGate(
  res: Response,
  input: {
    spvId?: string | null;
    companyIds: string[];
    /** R122.2 — the partner account creating/funding the vehicle. Consulted ONLY
     *  when no company is named (blind pool / no-target SPV), where the gate
     *  applies to this account's own standing rather than to a company that does
     *  not exist. Absence of a company is never by itself a refusal. */
    partnerId?: string | null;
    audience: GateAudience;
    /** Never refuse; report instead (admin create path). */
    advisoryOnly?: boolean;
    /** For the log line, so a blocked launch is traceable to its route. */
    where: string;
  },
): GateOutcome {
  const decision = evaluateLaunchGate({
    spvId: input.spvId ?? null,
    companyIds: input.companyIds,
    partnerId: input.partnerId ?? null,
  });

  if (decision.allowed && !decision.warned && !decision.blocking.length) {
    return { handled: false, decision, advisory: null };
  }

  const message =
    input.audience === "lp" ? decision.lpMessage : decision.partnerMessage;

  /* ALLOWED-BUT-NOTABLE: warn mode, or an admin acting deliberately. */
  if (decision.allowed || input.advisoryOnly) {
    log.warn(
      `[spvLaunchGate:${input.where}] allowed with a membership warning (mode=${decision.mode}, advisory=${!!input.advisoryOnly}): ${decision.partnerMessage}`,
    );
    return {
      handled: false,
      decision,
      advisory: {
        launchGate: {
          eligible: false,
          mode: decision.mode,
          message,
          /* W159 · R113.3 — an LP is told the STATE, never which company lapsed or
             what any third party's billing looks like. The refusal path below has
             always withheld these rows from an LP; the advisory path leaked them,
             so it withholds them now too. */
          companies: input.audience === "lp" ? undefined : companyRows(decision),
        },
      },
    };
  }

  log.warn(`[spvLaunchGate:${input.where}] refused: ${decision.partnerMessage}`);
  res.status(402).json({
    error: decision.code ?? "SPV_COMPANY_MEMBERSHIP_REQUIRED",
    message,
    /* The per-company detail is disclosed ONLY to a partner or admin. */
    companies: input.audience === "lp" ? undefined : companyRows(decision),
    /* Stated on every refusal so nobody has to guess: a gate refusal never
       touches an existing record, a distribution, or a transfer. */
    affectsExistingRecords: false,
    affectsDistributions: false,
    affectsTransfers: false,
  });
  return { handled: true, decision, advisory: null };
}
